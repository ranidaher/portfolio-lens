import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { ASSET_CLASS_LABELS, fmt, fmtRound } from '@/lib/constants';

function buildPortfolioContext(data) {
  const { accounts, securities, trades, properties, savingsEntries, prices, fxRates } = data;
  const secMap = {};
  securities.forEach(s => { secMap[s.id] = s; });
  const accMap = {};
  accounts.forEach(a => { accMap[a.id] = a; });

  // Build holdings
  const posMap = {};
  trades.forEach(t => {
    const key = `${t.security_id}__${t.account_id}`;
    if (!posMap[key]) posMap[key] = { security_id: t.security_id, account_id: t.account_id, shares: 0, totalCost: 0 };
    if (t.trade_type === 'buy') { posMap[key].shares += Number(t.quantity); posMap[key].totalCost += Number(t.quantity) * Number(t.price); }
    else { posMap[key].shares -= Number(t.quantity); posMap[key].totalCost -= Number(t.quantity) * Number(t.price); }
  });

  const holdings = [];
  Object.values(posMap).forEach(pos => {
    if (pos.shares <= 0.0001) return;
    const sec = secMap[pos.security_id];
    const acc = accMap[pos.account_id];
    if (!sec || !acc) return;
    const price = prices[sec.ticker]?.price || 0;
    const fxRate = fxRates[sec.currency] || 1;
    const marketValueUSD = pos.shares * price * fxRate;
    const costBasisUSD = pos.totalCost * fxRate;
    holdings.push({
      ticker: sec.ticker, name: sec.name, currency: sec.currency,
      assetClass: ASSET_CLASS_LABELS[sec.asset_class] || sec.asset_class,
      region: sec.region, account: acc.name, taxSheltered: acc.tax_sheltered,
      shares: Math.round(pos.shares * 100) / 100,
      currentPrice: price, marketValueUSD: Math.round(marketValueUSD),
      costBasisUSD: Math.round(costBasisUSD),
      plUSD: Math.round(marketValueUSD - costBasisUSD),
      returnPct: costBasisUSD > 0 ? Math.round((marketValueUSD - costBasisUSD) / costBasisUSD * 1000) / 10 : 0,
    });
  });
  holdings.sort((a, b) => b.marketValueUSD - a.marketValueUSD);

  // Real estate
  const realEstate = properties.map(p => {
    const fxRate = fxRates[p.currency] || 1;
    return {
      name: p.name, country: p.country, currency: p.currency,
      value: Number(p.current_value), valueUSD: Math.round(Number(p.current_value) * fxRate),
      mortgage: Number(p.mortgage_balance), mortgageUSD: Math.round(Number(p.mortgage_balance) * fxRate),
      equityUSD: Math.round((Number(p.current_value) - Number(p.mortgage_balance)) * fxRate),
      rentalIncome: Number(p.net_rental_income),
    };
  });

  // Savings
  const savingsAccs = accounts.filter(a => a.account_type === 'savings');
  const savings = savingsAccs.map(sAcc => {
    const al = savingsEntries.filter(l => l.account_id === sAcc.id).sort((a, b) => a.year_month.localeCompare(b.year_month));
    if (al.length === 0) return { name: sAcc.name, currency: sAcc.currency, balance: 0, balanceUSD: 0, rate: 0 };
    const first = al[0]; const dm = {}; al.forEach(d => { dm[d.year_month] = d; });
    const [sy, sm] = first.year_month.split('-').map(Number);
    const now = new Date();
    let y = sy, m = sm, pc = Number(first.balance), cr = Number(first.annual_rate);
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const st = dm[ym]; const op = ym === first.year_month ? Number(first.balance) : pc;
      if (st && st.annual_rate != null) cr = Number(st.annual_rate);
      const dep = st ? Number(st.deposits_withdrawals || 0) : 0;
      const isOv = st?.is_override || false;
      const intr = isOv ? Number(st.interest_earned) : Math.round((op * cr / 100) / 12 * 100) / 100;
      pc = op + dep + intr; m++; if (m > 12) { m = 1; y++; }
    }
    const fxRate = fxRates[sAcc.currency] || 1;
    return { name: sAcc.name, currency: sAcc.currency, balance: Math.round(pc), balanceUSD: Math.round(pc * fxRate), rate: cr };
  });

  // Totals
  const totalEquities = holdings.reduce((s, h) => s + h.marketValueUSD, 0);
  const totalRE = realEstate.reduce((s, r) => s + r.equityUSD, 0);
  const totalSavings = savings.reduce((s, s2) => s + s2.balanceUSD, 0);
  const totalNetWorth = totalEquities + totalRE + totalSavings;

  // Allocation
  const allocationByClass = {};
  holdings.forEach(h => { allocationByClass[h.assetClass] = (allocationByClass[h.assetClass] || 0) + h.marketValueUSD; });
  if (totalRE > 0) allocationByClass['Real Estate'] = totalRE;
  if (totalSavings > 0) allocationByClass['Cash / MMF'] = (allocationByClass['Cash / MMF'] || 0) + totalSavings;

  const allocationByRegion = {};
  holdings.forEach(h => { allocationByRegion[h.region] = (allocationByRegion[h.region] || 0) + h.marketValueUSD; });

  // Currency exposure
  const currencyExposure = {};
  holdings.forEach(h => {
    const sec = securities.find(s => s.ticker === h.ticker);
    const expCcy = sec?.exposure_currency || h.currency;
    currencyExposure[expCcy] = (currencyExposure[expCcy] || 0) + h.marketValueUSD;
  });
  savings.forEach(s => { currencyExposure[s.currency] = (currencyExposure[s.currency] || 0) + s.balanceUSD; });

  return `
PORTFOLIO SUMMARY (all values in USD):
- Total Net Worth: $${fmtRound(totalNetWorth)}
- Investments: $${fmtRound(totalEquities)}
- Real Estate Equity: $${fmtRound(totalRE)}
- Savings/Cash: $${fmtRound(totalSavings)}

ALLOCATION BY ASSET CLASS:
${Object.entries(allocationByClass).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: $${fmtRound(v)} (${totalNetWorth > 0 ? (v / totalNetWorth * 100).toFixed(1) : 0}%)`).join('\n')}

ALLOCATION BY REGION:
${Object.entries(allocationByRegion).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: $${fmtRound(v)} (${totalEquities > 0 ? (v / totalEquities * 100).toFixed(1) : 0}%)`).join('\n')}

CURRENCY EXPOSURE:
${Object.entries(currencyExposure).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: $${fmtRound(v)}`).join('\n')}

CURRENT FX RATES:
${Object.entries(fxRates).filter(([k]) => k !== 'USD').map(([k, v]) => `- ${k}/USD: ${v.toFixed(4)}`).join('\n')}

HOLDINGS (${holdings.length} positions):
${holdings.map(h => `- ${h.ticker} (${h.name}): ${h.shares} shares @ ${h.currency} ${fmt(h.currentPrice)}, Value: $${fmtRound(h.marketValueUSD)}, P&L: ${h.plUSD >= 0 ? '+' : ''}$${fmtRound(h.plUSD)} (${h.returnPct}%), Class: ${h.assetClass}, Region: ${h.region}, Account: ${h.account}${h.taxSheltered ? ' [Tax Sheltered]' : ''}`).join('\n')}

REAL ESTATE (${realEstate.length} properties):
${realEstate.map(r => `- ${r.name} (${r.country}): Value ${r.currency} ${fmtRound(r.value)}, Mortgage ${r.currency} ${fmtRound(r.mortgage)}, Equity $${fmtRound(r.equityUSD)}, Rental ${r.currency} ${fmtRound(r.rentalIncome)}/yr`).join('\n')}

SAVINGS ACCOUNTS (${savings.length}):
${savings.map(s => `- ${s.name}: ${s.currency} ${fmtRound(s.balance)} ($${fmtRound(s.balanceUSD)}), Rate: ${s.rate}%`).join('\n')}

Today's date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
Base currency: USD
`.trim();
}

export default function AIChatPage({ user }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [portfolioData, setPortfolioData] = useState(null);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const chatEndRef = useRef(null);

  // Fetch all portfolio data
  useEffect(() => {
    async function loadData() {
      const [accRes, secRes, trRes, propRes, savRes] = await Promise.all([
        supabase.from('accounts').select('*').eq('user_id', user.id),
        supabase.from('securities').select('*').eq('user_id', user.id),
        supabase.from('trades').select('*').eq('user_id', user.id).order('trade_date'),
        supabase.from('properties').select('*').eq('user_id', user.id),
        supabase.from('savings_ledger').select('*').eq('user_id', user.id).order('year_month'),
      ]);
      const accounts = accRes.data || [];
      const securities = secRes.data || [];
      const trades = trRes.data || [];
      const properties = propRes.data || [];
      const savingsEntries = savRes.data || [];

      // Fetch prices and FX
      let prices = {}, fxRates = { USD: 1 };
      if (securities.length > 0) {
        const tickers = securities.map(s => s.ticker);
        const currencies = [...new Set(securities.map(s => s.currency).concat(accounts.map(a => a.currency)).concat(properties.map(p => p.currency)))];
        try {
          const [pRes, fRes] = await Promise.all([
            fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()),
            fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies }) }).then(r => r.json()),
          ]);
          prices = pRes.prices || {};
          fxRates = { USD: 1, ...fRes.rates };
        } catch {}
      }

      setPortfolioData({ accounts, securities, trades, properties, savingsEntries, prices, fxRates });
      setDataLoading(false);
    }
    loadData();
  }, [user.id]);

  // Auto scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const context = portfolioData ? buildPortfolioContext(portfolioData) : 'Portfolio data not available.';
      const recentMessages = messages.slice(-10);
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system: `You are an AI investment advisor embedded in Portfolio Lens, a personal investment tracking application. You have access to the user's complete portfolio data below. Use this data to answer questions accurately. You can perform calculations on this data.${webSearchEnabled ? ' You also have web search to look up current market data, news, and prices.' : ''}

Be concise and direct. Use numbers from the portfolio data. When doing calculations, show your work briefly. Format currency values with $ and commas. 

Do NOT give specific buy/sell recommendations — instead provide analysis and let the user decide. Always note that you're not a licensed financial advisor.

USER'S PORTFOLIO DATA:
${context}`,
          messages: [
            ...recentMessages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMsg },
          ],
          webSearch: webSearchEnabled,
        }),
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      // Extract text from response (may include tool use blocks)
      const textParts = (data.content || [])
        .filter(item => item.type === 'text')
        .map(item => item.text);
      const reply = textParts.join('\n') || 'Sorry, I couldn\'t generate a response.';

      setMessages(prev => [...prev, { role: 'assistant', content: reply }]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}. Please try again.` }]);
    } finally {
      setLoading(false);
    }
  };

  const suggestedQuestions = [
    "What's my biggest concentration risk?",
    "How diversified is my portfolio across currencies?",
    "What's my total dividend yield?",
    "How would a 20% market drop affect me?",
    "What's my real estate as a % of net worth?",
  ];

  return (
    <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h2>AI Advisor</h2>
        <p>Ask questions about your portfolio. Claude has access to all your holdings, allocations, and can search the web for market data.</p>
      </div>

      {dataLoading ? (
        <div className="loading"><div className="spinner" /> Loading portfolio data...</div>
      ) : (
        <>
          {/* Chat messages */}
          <div style={{
            flex: 1, overflowY: 'auto', padding: '16px 0',
            display: 'flex', flexDirection: 'column', gap: 16,
          }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 40, marginBottom: 16, opacity: 0.3 }}>💬</div>
                <div style={{ fontSize: 16, color: 'var(--text-secondary)', marginBottom: 24 }}>Ask me anything about your portfolio</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' }}>
                  {suggestedQuestions.map((q, i) => (
                    <button key={i} onClick={() => { setInput(q); }}
                      style={{
                        background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius-sm)', padding: '8px 14px', fontSize: 13,
                        color: 'var(--text-secondary)', cursor: 'pointer', transition: 'var(--transition)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                    >{q}</button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} style={{
                display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                <div style={{
                  maxWidth: '80%', padding: '12px 16px', borderRadius: 12,
                  background: msg.role === 'user' ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: msg.role === 'user' ? 'white' : 'var(--text-primary)',
                  fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                }}>
                  {msg.content}
                </div>
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '12px 16px', borderRadius: 12, background: 'var(--bg-secondary)',
                  border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8,
                  fontSize: 13, color: 'var(--text-muted)',
                }}>
                  <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Thinking...
                </div>
              </div>
            )}
            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div style={{
            flexShrink: 0, padding: '12px 0', borderTop: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                <input type="checkbox" checked={webSearchEnabled} onChange={e => setWebSearchEnabled(e.target.checked)} style={{ cursor: 'pointer' }} />
                Web search (costs more — enable only when you need live data)
              </label>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="form-input"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              placeholder="Ask about your portfolio..."
              style={{ flex: 1 }}
              disabled={loading}
            />
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
              {input.trim() && (() => {
                const context = portfolioData ? buildPortfolioContext(portfolioData) : '';
                const sysPrompt = `You are an AI investment advisor embedded in Portfolio Lens...\n\nUSER'S PORTFOLIO DATA:\n${context}`;
                const historyText = messages.slice(-10).map(m => m.content).join(' ');
                const totalChars = sysPrompt.length + historyText.length + input.length;
                const estTokens = Math.round(totalChars / 4);
                const estCost = ((estTokens / 1000000) * 3 + (500 / 1000000) * 15).toFixed(4);
                return (
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'right', lineHeight: 1.3 }}>
                    ~{estTokens.toLocaleString()} tokens<br />~${estCost}
                  </div>
                );
              })()}
              <button className="btn btn-primary" onClick={sendMessage} disabled={loading || !input.trim()}
                style={{ padding: '8px 20px' }}>
                Send
              </button>
            </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
