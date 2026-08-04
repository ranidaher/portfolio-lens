import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

const COUNTRY_FLAGS = {
  'United States': '🇺🇸',
  'Canada': '🇨🇦',
  'United Kingdom': '🇬🇧',
  'France': '🇫🇷',
  'Germany': '🇩🇪',
  'Greece': '🇬🇷',
  'Switzerland': '🇨🇭',
  'Japan': '🇯🇵',
  'Australia': '🇦🇺',
  'Other': '🌐',
};

function fmtRound(n) {
  if (!n && n !== 0) return '0';
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + 'K';
  return Math.round(n).toLocaleString();
}

export default function GeographyPage({ user }) {
  const [securities, setSecurities] = useState([]);
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [savingsEntries, setSavingsEntries] = useState([]);
  const [properties, setProperties] = useState([]);
  const [prices, setPrices] = useState({});
  const [fxRates, setFxRates] = useState({ USD: 1 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.id) return;
    Promise.all([
      supabase.from('securities').select('*').eq('user_id', user.id),
      supabase.from('trades').select('*').eq('user_id', user.id),
      supabase.from('accounts').select('*').eq('user_id', user.id),
      supabase.from('savings_ledger').select('*').eq('user_id', user.id).order('year_month', { ascending: false }),
      supabase.from('properties').select('*').eq('user_id', user.id),
    ]).then(([secRes, tradeRes, accRes, savRes, propRes]) => {
      const secs = secRes.data || [];
      const accs = accRes.data || [];
      setSecurities(secs);
      setTrades(tradeRes.data || []);
      setAccounts(accs);
      setSavingsEntries(savRes.data || []);
      setProperties(propRes.data || []);

      const tickers = secs.map(s => s.ticker);
      const currencies = [...new Set([
        ...secs.map(s => s.currency),
        ...accs.map(a => a.currency),
        ...(propRes.data || []).map(p => p.currency),
      ])].filter(c => c && c !== 'USD');

      Promise.all([
        tickers.length > 0
          ? fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ prices: {} }))
          : Promise.resolve({ prices: {} }),
        currencies.length > 0
          ? fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies }) }).then(r => r.json()).catch(() => ({ rates: {} }))
          : Promise.resolve({ rates: {} }),
      ]).then(([priceData, fxData]) => {
        setPrices(priceData.prices || {});
        const rawRates = fxData.rates || {};
        // Filter out null rates (API failures) — fall back to 1 only if truly missing
        const cleanRates = { USD: 1 };
        Object.entries(rawRates).forEach(([k, v]) => { if (v !== null && v !== undefined) cleanRates[k] = v; });
        setFxRates(cleanRates);
        setLoading(false);
      });
    });
  }, [user?.id]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><div className="spinner" /></div>;

  // Build positions by account+ticker
  const posByAccTicker = {};
  trades.forEach(t => {
    const sec = securities.find(s => s.id === t.security_id);
    if (!sec) return;
    const key = `${t.account_id}__${sec.ticker}`;
    if (!posByAccTicker[key]) posByAccTicker[key] = { sec, accountId: t.account_id, shares: 0, costBasisLocal: 0 };
    if (t.trade_type === 'buy') {
      posByAccTicker[key].shares += Number(t.quantity);
      posByAccTicker[key].costBasisLocal += Number(t.quantity) * Number(t.price);
    } else {
      posByAccTicker[key].shares -= Number(t.quantity);
    }
  });

  // Group by country (from account.country)
  const byCountry = {};

  // Brokerage accounts
  Object.values(posByAccTicker).forEach(({ sec, accountId, shares, costBasisLocal }) => {
    if (shares < 0.001) return;
    const acc = accounts.find(a => a.id === accountId);
    if (!acc) return;
    const country = acc.country || 'Other';
    if (!byCountry[country]) byCountry[country] = { accounts: {}, savingsTotal: 0, savingsAccounts: [] };
    if (!byCountry[country].accounts[accountId]) byCountry[country].accounts[accountId] = { name: acc.name, currency: acc.currency, taxSheltered: acc.tax_sheltered, holdings: [] };

    const price = prices[sec.ticker]?.price || 0;
    const fxRate = fxRates[sec.currency] || 1;
    const marketValue = shares * price * fxRate;
    const costBasisUSD = costBasisLocal * fxRate;
    const marketValueNative = shares * price;
    const secCurrency = sec.currency;

    byCountry[country].accounts[accountId].holdings.push({
      ticker: sec.ticker, name: sec.name, assetClass: sec.asset_class,
      classification: sec.classification || 'core', shares, costBasisUSD, marketValue,
      costBasisNative: costBasisLocal, marketValueNative, secCurrency,
    });
  });

  // Savings accounts
  accounts.filter(a => a.account_type === 'savings').forEach(acc => {
    const accLedger = savingsEntries.filter(e => String(e.account_id) === String(acc.id)).sort((a, b) => a.year_month.localeCompare(b.year_month));
    if (accLedger.length === 0) return;

    // Calculate running balance (same as DashboardPage)
    const first = accLedger[0];
    const dataMap = {};
    accLedger.forEach(d => { dataMap[d.year_month] = d; });
    const [sy, sm] = first.year_month.split('-').map(Number);
    const now = new Date();
    let y = sy, m = sm, prevClose = Number(first.balance), currentRate = Number(first.annual_rate);
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const stored = dataMap[ym];
      const opening = ym === first.year_month ? Number(first.balance) : prevClose;
      if (stored?.annual_rate !== null && stored?.annual_rate !== undefined) currentRate = Number(stored.annual_rate);
      const dep = stored ? Number(stored.deposits_withdrawals || 0) : 0;
      const isOverride = stored?.is_override || false;
      const interest = isOverride ? Number(stored.interest_earned) : Math.round((opening * currentRate / 100) / 12 * 100) / 100;
      prevClose = opening + dep + interest;
      m++; if (m > 12) { m = 1; y++; }
    }
    const currentBalance = prevClose;

    const fxRate = fxRates[acc.currency] || 1;
    const balanceUSD = currentBalance * fxRate;
    const country = acc.country || 'Other';
    if (!byCountry[country]) byCountry[country] = { accounts: {}, savingsTotal: 0, savingsAccounts: [] };
    byCountry[country].savingsTotal += balanceUSD;
    byCountry[country].savingsAccounts.push({ name: acc.name, currency: acc.currency, balance: currentBalance, balanceUSD });
  });

  const totalUSD = Object.values(byCountry).reduce((s, c) => {
    const invTotal = Object.values(c.accounts).reduce((ss, a) => ss + a.holdings.reduce((sss, h) => sss + h.marketValue, 0), 0);
    return s + invTotal + c.savingsTotal;
  }, 0);

  // True total net worth includes real estate equity
  const realEstateTotalUSD = properties.reduce((s, p) => {
    const fxRate = fxRates[p.currency] || 1;
    const equity = (Number(p.current_value) - Number(p.mortgage_balance || 0)) * fxRate;
    return s + equity;
  }, 0);
  const trueNetWorth = totalUSD + realEstateTotalUSD;

  const sortedCountries = Object.keys(byCountry).sort((a, b) => {
    const totA = Object.values(byCountry[a].accounts).reduce((s, ac) => s + ac.holdings.reduce((ss, h) => ss + h.marketValue, 0), 0) + byCountry[a].savingsTotal;
    const totB = Object.values(byCountry[b].accounts).reduce((s, ac) => s + ac.holdings.reduce((ss, h) => ss + h.marketValue, 0), 0) + byCountry[b].savingsTotal;
    return totB - totA;
  });

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">Geography</h1>
          <p className="page-subtitle">Where your money is held around the world</p>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => window.print()} style={{ fontSize: 12, padding: '5px 12px', marginTop: 8 }}>Print / Save PDF</button>
      </div>

      {/* Summary bar */}
      <div className="card" style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 0 }}>
          {sortedCountries.map(country => {
            const c = byCountry[country];
            const invTotal = Object.values(c.accounts).reduce((s, a) => s + a.holdings.reduce((ss, h) => ss + h.marketValue, 0), 0);
            const total = invTotal + c.savingsTotal;
            const pct = trueNetWorth > 0 ? (total / trueNetWorth * 100) : 0;
            return (
              <div key={country} style={{ flex: 1, minWidth: 130, padding: '16px 20px', borderRight: '1px solid var(--border)' }}>
                <div style={{ fontSize: 24 }}>{COUNTRY_FLAGS[country] || '🌐'}</div>
                <div style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>{country}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--accent)', marginTop: 4 }}>${fmtRound(total)}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct.toFixed(1)}% of total</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-country detail */}
      {sortedCountries.map(country => {
        const c = byCountry[country];
        const invTotal = Object.values(c.accounts).reduce((s, a) => s + a.holdings.reduce((ss, h) => ss + h.marketValue, 0), 0);
        const total = invTotal + c.savingsTotal;
        const pct = trueNetWorth > 0 ? (total / trueNetWorth * 100).toFixed(1) : 0;

        return (
          <div key={country} className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 32 }}>{COUNTRY_FLAGS[country] || '🌐'}</span>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 700 }}>{country}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{pct}% of total portfolio</div>
                </div>
              </div>
              <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--accent)' }}>${fmtRound(total)}</div>
            </div>

            {/* Investment accounts */}
            {Object.entries(c.accounts).filter(([, a]) => a.holdings.length > 0).map(([accId, acc]) => {
              const accTotal = acc.holdings.reduce((s, h) => s + h.marketValue, 0);
              return (
                <div key={accId} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-secondary)' }}>
                      {acc.name}
                      {acc.taxSheltered && <span style={{ marginLeft: 8, fontSize: 10, background: 'rgba(167,139,250,0.15)', color: '#a78bfa', padding: '2px 6px', borderRadius: 4 }}>Tax Sheltered</span>}
                    </div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>${fmtRound(accTotal)}</div>
                  </div>
                  <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Security</th>
                          <th>Name</th>
                          <th>Type</th>
                          <th style={{ textAlign: 'right' }}>Shares</th>
                          <th style={{ textAlign: 'right' }}>Cost Basis</th>
                          <th style={{ textAlign: 'right' }}>Current Value</th>
                          <th style={{ textAlign: 'right' }}>Gain / Loss</th>
                        </tr>
                      </thead>
                      <tbody>
                        {acc.holdings.sort((a, b) => b.marketValue - a.marketValue).map(h => {
                          const pl = h.marketValue - h.costBasisUSD;
                          const plPct = h.costBasisUSD > 0 ? (pl / h.costBasisUSD * 100) : 0;
                          return (
                            <tr key={h.ticker}>
                              <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{h.ticker}</td>
                              <td>{h.name}</td>
                              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                {h.classification === 'thematic' ? 'Thematic' : h.assetClass === 'commodity' ? 'Commodity' : 'Core'}
                              </td>
                              <td style={{ textAlign: 'right' }}>{Number(h.shares.toFixed(4)).toLocaleString()}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{h.secCurrency} {fmtRound(h.costBasisNative)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600 }}>{h.secCurrency} {fmtRound(h.marketValueNative)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: pl >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {pl >= 0 ? '+' : ''}{h.secCurrency} {fmtRound(Math.abs(pl / (fxRates[h.secCurrency] || 1)))} ({pl >= 0 ? '+' : ''}{plPct.toFixed(1)}%)
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}

            {/* Savings accounts */}
            {c.savingsAccounts.length > 0 && (
              <div style={{ marginTop: Object.values(c.accounts).some(a => a.holdings.length > 0) ? 12 : 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>SAVINGS & CASH</div>
                <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                  <table>
                    <thead>
                      <tr>
                        <th>Account</th>
                        <th>Currency</th>
                        <th style={{ textAlign: 'right' }}>Balance</th>
                        <th style={{ textAlign: 'right' }}>Value (USD)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {c.savingsAccounts.map((a, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{a.name}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{a.currency}</td>
                          <td style={{ textAlign: 'right' }}>{a.balance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })} {a.currency}</td>
                          <td style={{ textAlign: 'right', fontWeight: 600 }}>${fmtRound(a.balanceUSD)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
