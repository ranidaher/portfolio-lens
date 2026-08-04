import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ASSET_CLASS_LABELS, fmt } from '@/lib/constants';

function fmtRound(n) {
  if (!n && n !== 0) return '0';
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(0) + 'K';
  return Math.round(n).toLocaleString();
}
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import xirr from 'xirr';

// ============================================================
// XIRR wrapper — safe calculation with error handling
// ============================================================
function calcXIRR(cashFlows) {
  // cashFlows: [{ amount: number, when: Date }]
  // Negative amounts = money going out (investments/deposits)
  // Positive amounts = money coming back (current value/withdrawals)
  if (!cashFlows || cashFlows.length < 2) return null;

  // Need at least one negative and one positive
  const hasNeg = cashFlows.some(cf => cf.amount < 0);
  const hasPos = cashFlows.some(cf => cf.amount > 0);
  if (!hasNeg || !hasPos) return null;

  // Need at least 1 day between first and last flow
  const sorted = [...cashFlows].sort((a, b) => a.when - b.when);
  const daySpan = (sorted[sorted.length - 1].when - sorted[0].when) / (24 * 60 * 60 * 1000);
  if (daySpan < 1) return null;

  try {
    const result = xirr(cashFlows);
    // Sanity check: XIRR should be between -100% and +100,000%
    if (result === null || result === undefined || !isFinite(result) || result < -1 || result > 1000) return null;
    return result; // Returns annualized rate, e.g., 0.08 = 8%
  } catch (e) {
    return null;
  }
}

const PERIODS = [
  { key: 'ytd', label: 'YTD' },
  { key: '1y', label: '1 Year' },
  { key: '3y', label: '3 Year' },
];

function getPeriodStartDate(key) {
  const now = new Date();
  switch (key) {
    case 'ytd': return new Date(now.getFullYear(), 0, 1);
    case '1y': return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    case '3y': return new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
    default: return new Date(now.getFullYear(), 0, 1);
  }
}

const VIEW_TABS = [
  { key: 'total', label: 'Total Portfolio' },
  { key: 'account', label: 'By Account' },
  { key: 'asset', label: 'By Asset Class' },
  { key: 'holding', label: 'By Holding' },
  { key: 'yearreview', label: 'Year in Review' },
];

function ReturnCell({ value }) {
  if (value === null || value === undefined) {
    return <span style={{ color: 'var(--text-muted)' }}>{'\u2014'}</span>;
  }
  const pct = value * 100;
  return (
    <span style={{ fontWeight: 600, color: pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
      {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
    </span>
  );
}

function PerformanceTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    const val = payload[0].value;
    return (
      <div style={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: '#8896b3' }}>{label}</div>
        <div style={{ color: val >= 0 ? '#34d399' : '#f87171', fontWeight: 600 }}>
          {val >= 0 ? '+' : ''}{val.toFixed(1)}%
        </div>
      </div>
    );
  }
  return null;
}

export default function PerformancePage({ user }) {
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState('total');
  const [accounts, setAccounts] = useState([]);
  const [securities, setSecurities] = useState([]);
  const [trades, setTrades] = useState([]);
  const [cashFlows, setCashFlows] = useState([]);
  const [prices, setPrices] = useState({});
  const [fxRates, setFxRates] = useState({ USD: 1 });
  const [pricesLoading, setPricesLoading] = useState(true);
  const [historicalPrices, setHistoricalPrices] = useState({});
  const [historicalFx, setHistoricalFx] = useState({});
  const [dividendData, setDividendData] = useState({});

  const fetchData = useCallback(async () => {
    const [accRes, secRes, tradeRes, cfRes] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', user.id),
      supabase.from('securities').select('*').eq('user_id', user.id),
      supabase.from('trades').select('*').eq('user_id', user.id).order('trade_date'),
      supabase.from('cash_flows').select('*').eq('user_id', user.id).order('flow_date'),
    ]);
    setAccounts(accRes.data || []);
    setSecurities(secRes.data || []);
    setTrades(tradeRes.data || []);
    setCashFlows(cfRes.data || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (securities.length === 0) { setPricesLoading(false); return; }
    const tickers = securities.map(s => s.ticker);
    const uniqueCurrencies = [...new Set(securities.map(s => s.currency))];

    // Build month keys for period start dates we need historical prices for
    const now = new Date();
    const periodMonths = [
      `${now.getFullYear()}-01`, // YTD start
      `${now.getFullYear() - 1}-${String(now.getMonth() + 1).padStart(2, '0')}`, // 1Y start
      `${now.getFullYear() - 3}-${String(now.getMonth() + 1).padStart(2, '0')}`, // 3Y start
    ];

    Promise.all([
      fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ prices: {} })),
      fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies: uniqueCurrencies }) }).then(r => r.json()).catch(() => ({ rates: { USD: 1 } })),
      tickers.length > 0 ? fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers, months: periodMonths.map(m => ({ year: parseInt(m.split('-')[0]), month: parseInt(m.split('-')[1]) })) }) }).then(r => r.json()).catch(() => ({ history: {} })) : Promise.resolve({ history: {} }),
      uniqueCurrencies.filter(c => c !== 'USD').length > 0 ? fetch('/api/fx-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies: uniqueCurrencies.filter(c => c !== 'USD'), months: periodMonths.map(m => ({ year: parseInt(m.split('-')[0]), month: parseInt(m.split('-')[1]) })) }) }).then(r => r.json()).catch(() => ({ history: {} })) : Promise.resolve({ history: {} }),
      tickers.length > 0 ? fetch('/api/dividends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ dividends: {} })) : Promise.resolve({ dividends: {} }),
    ]).then(([priceData, fxData, histPriceData, histFxData, divData]) => {
      setPrices(priceData.prices || {});
      setFxRates({ USD: 1, ...fxData.rates });
      setHistoricalPrices(histPriceData.history || {});
      setHistoricalFx(histFxData.history || {});
      setDividendData(divData.dividends || {});
      setPricesLoading(false);
    });
  }, [securities]);

  // Maps
  const secMap = {};
  securities.forEach(s => { secMap[s.id] = s; });
  const accMap = {};
  accounts.forEach(a => { accMap[a.id] = a; });

  // ============================================================
  // Calculate XIRR for a given period and trade filter
  // 
  // How it works:
  // 1. If there were positions BEFORE the period start, add a negative
  //    cash flow for their value at period start (money "already invested")
  // 2. During the period, buys are negative (money out), sells are positive (money in)
  // 3. At the end, current portfolio value is a positive cash flow (money "back")
  // 4. XIRR calculates the annualized return that makes NPV of all flows = 0
  // ============================================================
  function calcPeriodReturn(periodKey, filterFn) {
    const periodStart = getPeriodStartDate(periodKey);
    const periodEnd = new Date();
    const earliestTradeDate = trades.filter(filterFn).length > 0 ? new Date(trades.filter(filterFn)[0].trade_date) : null;
    if (!earliestTradeDate) return { returnPct: null, beginValue: 0, endValue: 0, actualDays: 0 };

    const effectiveStart = earliestTradeDate > periodStart ? earliestTradeDate : periodStart;
    const actualDays = (periodEnd - effectiveStart) / (24 * 60 * 60 * 1000);

    // Positions before period start
    const tradesBeforePeriod = trades.filter(t => new Date(t.trade_date) < periodStart && filterFn(t));
    const beginPositions = {};
    tradesBeforePeriod.forEach(t => {
      const key = t.security_id;
      if (!beginPositions[key]) beginPositions[key] = 0;
      beginPositions[key] += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity);
    });

    // End positions (all trades up to now)
    const allTrades = trades.filter(t => new Date(t.trade_date) <= periodEnd && filterFn(t));
    const endPositions = {};
    allTrades.forEach(t => {
      const key = t.security_id;
      if (!endPositions[key]) endPositions[key] = 0;
      endPositions[key] += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity);
    });

    // Trades during the period
    const periodTrades = trades.filter(t => {
      const d = new Date(t.trade_date);
      return d >= periodStart && d <= periodEnd && filterFn(t);
    });

    // Build XIRR cash flows
    const xirrFlows = [];

    // Beginning value as negative cash flow (money already at work)
    // Use historical price at period start, not current price
    const periodStartMonthKey = `${periodStart.getFullYear()}-${String(periodStart.getMonth() + 1).padStart(2, '0')}`;
    let beginValue = 0;
    Object.entries(beginPositions).forEach(([secId, shares]) => {
      if (shares <= 0.0001) return;
      const sec = secMap[secId];
      if (!sec) return;
      // Try historical price first, fall back to current
      const histPrice = historicalPrices[sec.ticker]?.prices?.[periodStartMonthKey];
      const price = histPrice || prices[sec.ticker]?.price || 0;
      // Try historical FX first, fall back to current
      let fxRate = 1;
      if (sec.currency !== 'USD') {
        fxRate = historicalFx[sec.currency]?.[periodStartMonthKey] || fxRates[sec.currency] || 1;
      }
      beginValue += shares * price * fxRate;
    });
    if (beginValue > 0) {
      xirrFlows.push({ amount: -beginValue, when: periodStart });
    }

    // Each trade during the period
    periodTrades.forEach(t => {
      const sec = secMap[t.security_id];
      if (!sec) return;
      // Use stored FX rate if available, otherwise fall back to current rate
      const fxRate = t.fx_rate_to_usd || fxRates[sec.currency] || 1;
      const amount = Number(t.quantity) * Number(t.price) * fxRate;
      xirrFlows.push({
        amount: t.trade_type === 'buy' ? -amount : amount,
        when: new Date(t.trade_date),
      });
    });

    // Cash flows (deposits/withdrawals) during the period for matching accounts
    const accountIds = new Set(periodTrades.map(t => t.account_id));
    // Also include accounts from beginning positions
    Object.entries(beginPositions).forEach(([secId, shares]) => {
      if (shares > 0.0001) {
        const matchingTrades = trades.filter(t => t.security_id === secId && filterFn(t));
        matchingTrades.forEach(t => accountIds.add(t.account_id));
      }
    });

    cashFlows.forEach(cf => {
      const d = new Date(cf.flow_date);
      // Skip auto-generated cash flows from trades (already counted as trade flows)
      if (cf.notes && cf.notes.startsWith('auto:trade:')) return;
      if (d >= periodStart && d <= periodEnd && accountIds.has(cf.account_id)) {
        const acc = accMap[cf.account_id];
        const fxRate = acc ? (fxRates[acc.currency] || 1) : 1;
        xirrFlows.push({
          amount: cf.flow_type === 'deposit' ? -Number(cf.amount) * fxRate : Number(cf.amount) * fxRate,
          when: d,
        });
      }
    });

    // Dividends as positive cash flows (income received)
    const allSecIds = new Set([...Object.keys(beginPositions), ...periodTrades.map(t => t.security_id)]);
    allSecIds.forEach(secId => {
      const sec = secMap[secId];
      if (!sec) return;
      if (!filterFn({ security_id: secId, account_id: Object.values(beginPositions)[0]?.account_id || periodTrades[0]?.account_id })) return;
      const divs = dividendData[sec.ticker] || [];
      divs.forEach(d => {
        const divDate = new Date(d.date);
        if (divDate >= periodStart && divDate <= periodEnd) {
          // Get shares held at dividend date
          let sharesAtDate = beginPositions[secId] || 0;
          periodTrades.filter(t => t.security_id === secId && new Date(t.trade_date) <= divDate).forEach(t => {
            sharesAtDate += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity);
          });
          if (sharesAtDate > 0.0001) {
            const fxRate = fxRates[sec.currency] || 1;
            xirrFlows.push({ amount: sharesAtDate * d.amount * fxRate, when: divDate });
          }
        }
      });
    });

    // End value as positive cash flow (getting money back)
    let endValue = 0;
    Object.entries(endPositions).forEach(([secId, shares]) => {
      if (shares <= 0.0001) return;
      const sec = secMap[secId];
      if (!sec) return;
      const price = prices[sec.ticker]?.price || 0;
      const fxRate = fxRates[sec.currency] || 1;
      endValue += shares * price * fxRate;
    });
    if (endValue > 0) {
      xirrFlows.push({ amount: endValue, when: periodEnd });
    }

    // Calculate XIRR (returns annualized rate)
    const xirrResult = calcXIRR(xirrFlows);

    // For periods less than 1 year, de-annualize to show actual period return
    let displayReturn = xirrResult;
    if (xirrResult !== null && actualDays < 365) {
      // Convert annualized rate to actual period return: (1 + annual)^(days/365) - 1
      displayReturn = Math.pow(1 + xirrResult, actualDays / 365) - 1;
    }

    return { returnPct: displayReturn, annualizedPct: xirrResult, beginValue, endValue, actualDays };
  }

  // ============================================================
  // TOTAL PORTFOLIO returns
  // ============================================================
  const totalPeriodReturns = PERIODS.map(p => {
    const result = calcPeriodReturn(p.key, () => true);
    return { ...p, ...result };
  });

  // ============================================================
  // BY ACCOUNT returns
  // ============================================================
  const accountPeriodReturns = accounts
    .filter(a => a.account_type === 'brokerage')
    .map(acc => {
      const periods = PERIODS.map(p => {
        const result = calcPeriodReturn(p.key, t => t.account_id === acc.id);
        return { ...p, ...result };
      });
      const currentValue = periods.find(p => p.key === 'ytd')?.endValue || 0;
      return { name: acc.name, currency: acc.currency, taxSheltered: acc.tax_sheltered, periods, currentValue };
    })
    .filter(a => a.currentValue > 0)
    .sort((a, b) => b.currentValue - a.currentValue);

  // ============================================================
  // BY ASSET CLASS returns
  // ============================================================
  const assetClassPeriodReturns = ['equity', 'bond', 'cash_mmf', 'commodity']
    .map(ac => {
      const secIds = securities.filter(s => s.asset_class === ac).map(s => s.id);
      const periods = PERIODS.map(p => {
        const result = calcPeriodReturn(p.key, t => secIds.includes(t.security_id));
        return { ...p, ...result };
      });
      const currentValue = periods.find(p => p.key === 'ytd')?.endValue || 0;
      return { name: ASSET_CLASS_LABELS[ac], assetClass: ac, periods, currentValue };
    })
    .filter(a => a.currentValue > 0);

  // ============================================================
  // BY HOLDING (simple return + XIRR per holding)
  // ============================================================
  const holdingReturns = [];
  const posMap = {};
  trades.forEach(t => {
    const key = t.security_id;
    if (!posMap[key]) posMap[key] = { security_id: t.security_id, shares: 0, totalCost: 0 };
    if (t.trade_type === 'buy') {
      posMap[key].shares += Number(t.quantity);
      posMap[key].totalCost += Number(t.quantity) * Number(t.price) + Number(t.fees || 0);
    } else {
      posMap[key].shares -= Number(t.quantity);
      posMap[key].totalCost -= Number(t.quantity) * Number(t.price) - Number(t.fees || 0);
    }
  });
  Object.values(posMap).forEach(pos => {
    if (pos.shares <= 0.0001) return;
    const sec = secMap[pos.security_id];
    if (!sec) return;
    const currentPrice = prices[sec.ticker]?.price || 0;
    const fxRate = fxRates[sec.currency] || 1;
    const marketValueUSD = pos.shares * currentPrice * fxRate;
    const costBasisUSD = pos.totalCost * fxRate;
    const returnPct = costBasisUSD > 0 ? ((marketValueUSD - costBasisUSD) / costBasisUSD) * 100 : 0;

    // Per-holding XIRR
    const holdingTrades = trades.filter(t => t.security_id === pos.security_id);
    const xirrFlows = [];
    holdingTrades.forEach(t => {
      const tFxRate = t.fx_rate_to_usd || fxRates[sec.currency] || 1;
      const amount = Number(t.quantity) * Number(t.price) * tFxRate;
      xirrFlows.push({ amount: t.trade_type === 'buy' ? -amount : amount, when: new Date(t.trade_date) });
    });
    xirrFlows.push({ amount: marketValueUSD, when: new Date() });
    const holdingXirr = calcXIRR(xirrFlows);

    holdingReturns.push({
      ticker: sec.ticker, name: sec.name, currency: sec.currency, assetClass: sec.asset_class, region: sec.region, classification: sec.classification || 'core',
      shares: pos.shares, costBasisUSD, marketValueUSD, returnPct, plUSD: marketValueUSD - costBasisUSD, xirr: holdingXirr,
    });
  });
  holdingReturns.sort((a, b) => b.marketValueUSD - a.marketValueUSD);

  // ============================================================
  // Chart data
  // ============================================================
  const chartData = totalPeriodReturns
    .filter(r => r.returnPct !== null)
    .map(r => ({
      name: r.label,
      value: r.returnPct * 100,
      color: r.returnPct >= 0 ? '#34d399' : '#f87171',
    }));

  if (loading || pricesLoading) return <div className="loading"><div className="spinner" /> Loading performance...</div>;
  const hasTrades = trades.length > 0;

  const earliestTradeDate = trades.length > 0 ? new Date(trades[0].trade_date) : null;
  const tradingDays = earliestTradeDate ? Math.floor((new Date() - earliestTradeDate) / (24 * 60 * 60 * 1000)) : 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Performance</h2>
        <p>
          Returns calculated using XIRR (extended internal rate of return), which properly accounts for the timing and size of all your deposits and withdrawals.
          {earliestTradeDate && ` Trading since ${earliestTradeDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })} (${tradingDays} days).`}
        </p>
      </div>

      {!hasTrades ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 64, height: 64, opacity: 0.3 }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
          <p style={{ fontSize: 16, maxWidth: 400, margin: '16px auto' }}>Add trades to see your performance data.</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="stats-row">
            {totalPeriodReturns.map(r => (
              <div className="stat-card" key={r.key}>
                <div className="stat-label">{r.label} Return</div>
                <div className="stat-value" style={{ color: r.returnPct === null ? 'var(--text-muted)' : r.returnPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                  {r.returnPct !== null ? `${r.returnPct >= 0 ? '+' : ''}${(r.returnPct * 100).toFixed(1)}%` : 'N/A'}
                </div>
                {r.returnPct !== null && r.actualDays < 365 && (
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    Based on {Math.floor(r.actualDays)} days
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Bar Chart */}
          {chartData.length > 0 && (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Returns by Period</div>
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={chartData} margin={{ left: 10, right: 10, top: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#2a3654" horizontal={true} vertical={false} />
                  <XAxis dataKey="name" stroke="#5a6a8a" fontSize={13} tickLine={false} />
                  <YAxis stroke="#5a6a8a" fontSize={11} tickLine={false} tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(0)}%`} />
                  <Tooltip content={<PerformanceTooltip />} />
                  <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={60}>
                    {chartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* View Tabs */}
          <div className="filter-group" style={{ marginBottom: 24 }}>
            {VIEW_TABS.map(tab => (
              <button key={tab.key} className={`filter-btn ${activeView === tab.key ? 'active' : ''}`} onClick={() => setActiveView(tab.key)}>{tab.label}</button>
            ))}
          </div>

          {/* TOTAL PORTFOLIO VIEW */}
          {activeView === 'total' && (
            <div className="table-container">
              <table>
                <thead><tr><th>Period</th><th style={{ textAlign: 'right' }}>Start Value</th><th style={{ textAlign: 'right' }}>End Value</th><th style={{ textAlign: 'right' }}>XIRR</th></tr></thead>
                <tbody>
                  {totalPeriodReturns.map(r => (
                    <tr key={r.key}>
                      <td style={{ fontWeight: 500 }}>{r.label}</td>
                      <td style={{ textAlign: 'right' }}>{r.beginValue > 0 ? `$${fmt(r.beginValue)}` : '\u2014'}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmt(r.endValue)}</td>
                      <td style={{ textAlign: 'right' }}><ReturnCell value={r.returnPct} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* BY ACCOUNT VIEW */}
          {activeView === 'account' && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Tax Status</th>
                    <th style={{ textAlign: 'right' }}>Current Value</th>
                    {PERIODS.map(p => <th key={p.key} style={{ textAlign: 'right' }}>{p.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {accountPeriodReturns.map(acc => (
                    <tr key={acc.name}>
                      <td style={{ fontWeight: 500 }}>{acc.name}</td>
                      <td><span className={`badge ${acc.taxSheltered ? 'badge-tax-sheltered' : 'badge-taxable'}`}>{acc.taxSheltered ? 'Sheltered' : 'Taxable'}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmt(acc.currentValue)}</td>
                      {PERIODS.map(p => {
                        const period = acc.periods.find(pr => pr.key === p.key);
                        return <td key={p.key} style={{ textAlign: 'right' }}><ReturnCell value={period?.returnPct} /></td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* BY ASSET CLASS VIEW */}
          {activeView === 'asset' && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Asset Class</th>
                    <th style={{ textAlign: 'right' }}>Current Value</th>
                    <th style={{ textAlign: 'right' }}>P&L (USD)</th>
                    {PERIODS.map(p => <th key={p.key} style={{ textAlign: 'right' }}>{p.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {assetClassPeriodReturns.map(ac => {
                    const ytdPeriod = ac.periods.find(p => p.key === 'ytd');
                    const absoluteReturn = ytdPeriod ? ytdPeriod.endValue - (ytdPeriod.beginValue || 0) : 0;
                    return (
                    <tr key={ac.name}>
                      <td><span className={`badge badge-${ac.assetClass}`}>{ac.name}</span></td>
                      <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmt(ac.currentValue)}</td>
                      <td style={{ textAlign: 'right', fontWeight: 500, color: absoluteReturn >= 0 ? 'var(--success)' : 'var(--danger)' }}>{absoluteReturn >= 0 ? '+' : ''}${fmt(absoluteReturn)}</td>
                      {PERIODS.map(p => {
                        const period = ac.periods.find(pr => pr.key === p.key);
                        return <td key={p.key} style={{ textAlign: 'right' }}><ReturnCell value={period?.returnPct} /></td>;
                      })}
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* BY HOLDING VIEW */}
          {activeView === 'holding' && (
            <div className="table-container">
              <table>
                <thead><tr><th>Ticker</th><th>Name</th><th>Ccy</th><th style={{ textAlign: 'right' }}>Shares</th><th style={{ textAlign: 'right' }}>Cost Basis</th><th style={{ textAlign: 'right' }}>Market Value</th><th style={{ textAlign: 'right' }}>P&L</th><th style={{ textAlign: 'right' }}>Return</th><th style={{ textAlign: 'right' }}>XIRR</th></tr></thead>
                <tbody>
                  {[
                    { label: 'CORE EQUITIES', items: holdingReturns.filter(h => h.assetClass === 'equity' && h.classification !== 'thematic') },
                    { label: 'THEMATIC EQUITIES', items: holdingReturns.filter(h => h.assetClass === 'equity' && h.classification === 'thematic') },
                    { label: 'COMMODITIES', items: holdingReturns.filter(h => h.assetClass === 'commodity') },
                    { label: 'CASH / MMF', items: holdingReturns.filter(h => h.assetClass === 'cash_mmf') },
                    { label: 'OTHER', items: holdingReturns.filter(h => !['equity','commodity','cash_mmf'].includes(h.assetClass)) },
                  ].filter(g => g.items.length > 0).map(group => (
                    <React.Fragment key={group.label}>
                      <tr>
                        <td colSpan={9} style={{ background: 'var(--bg-secondary)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', padding: '6px 12px' }}>{group.label}</td>
                      </tr>
                      {group.items.map(h => (
                        <tr key={h.ticker}>
                          <td style={{ fontWeight: 600, fontFamily: 'monospace', letterSpacing: '0.04em' }}>{h.ticker}</td>
                          <td>{h.name}</td>
                          <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.currency}</td>
                          <td style={{ textAlign: 'right' }}>{fmt(h.shares)}</td>
                          <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>${fmt(h.costBasisUSD)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmt(h.marketValueUSD)}</td>
                          <td style={{ textAlign: 'right', fontWeight: 500, color: h.plUSD >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {h.plUSD >= 0 ? '+' : ''}${fmt(h.plUSD)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 600, color: h.returnPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                            {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(1)}%
                          </td>
                          <td style={{ textAlign: 'right' }}><ReturnCell value={h.xirr} /></td>
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {activeView === 'yearreview' && (() => {
            const now = new Date();
            const year = now.getFullYear();
            const yearStr = `${year}`;

            // Split holdings into new (first trade this year) and existing (held before)
            const newPositions = [];
            const existingPositions = [];
            holdingReturns.forEach(h => {
              const sec = securities.find(s => s.ticker === h.ticker);
              if (!sec) return;
              const secTrades = trades.filter(t => t.security_id === sec.id).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
              if (secTrades.length === 0) return;
              const firstTrade = secTrades[0];
              if (firstTrade.trade_date.startsWith(yearStr)) {
                newPositions.push(h);
              } else {
                existingPositions.push(h);
              }
            });

            const yearTrades = trades.filter(t => t.trade_date.startsWith(yearStr));
            const contributions = yearTrades.reduce((s, t) => {
              const sec = securities.find(sec => sec.id === t.security_id);
              const fxRate = sec ? (fxRates[sec.currency] || 1) : 1;
              const val = Number(t.quantity) * Number(t.price) * fxRate;
              return s + (t.trade_type === 'buy' ? val : -val);
            }, 0);

            return (
              <div>
                <div className="card" style={{ marginBottom: 20 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 16 }}>{year} Year in Review</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 24 }}>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>New Money Deployed</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>${fmtRound(Math.abs(contributions))}</div>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Trades Made</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{yearTrades.length}</div>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: 8, padding: 14, textAlign: 'center' }}>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>New Positions</div>
                      <div style={{ fontSize: 18, fontWeight: 700 }}>{newPositions.length}</div>
                    </div>
                  </div>

                  {newPositions.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>NEW POSITIONS THIS YEAR</div>
                      <div className="table-container" style={{ border: 'none', borderRadius: 0, marginBottom: 20 }}>
                        <table>
                          <thead><tr><th>Ticker</th><th>Name</th><th style={{ textAlign: 'right' }}>Cost Basis</th><th style={{ textAlign: 'right' }}>Current Value</th><th style={{ textAlign: 'right' }}>Return</th></tr></thead>
                          <tbody>
                            {newPositions.sort((a, b) => b.marketValueUSD - a.marketValueUSD).map(h => (
                              <tr key={h.ticker}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{h.ticker}</td>
                                <td>{h.name}</td>
                                <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>${fmt(h.costBasisUSD)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>${fmt(h.marketValueUSD)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: h.returnPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                  {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}

                  {existingPositions.length > 0 && (
                    <>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', marginBottom: 8 }}>EXISTING POSITIONS</div>
                      <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                        <table>
                          <thead><tr><th>Ticker</th><th>Name</th><th style={{ textAlign: 'right' }}>Current Value</th><th style={{ textAlign: 'right' }}>Return (All Time)</th></tr></thead>
                          <tbody>
                            {existingPositions.sort((a, b) => b.marketValueUSD - a.marketValueUSD).map(h => (
                              <tr key={h.ticker}>
                                <td style={{ fontFamily: 'monospace', fontWeight: 700 }}>{h.ticker}</td>
                                <td>{h.name}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600 }}>${fmt(h.marketValueUSD)}</td>
                                <td style={{ textAlign: 'right', fontWeight: 600, color: h.returnPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                                  {h.returnPct >= 0 ? '+' : ''}{h.returnPct.toFixed(1)}%
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong>How XIRR works:</strong> XIRR (Extended Internal Rate of Return) calculates your annualized return by accounting for the exact dates and amounts of every deposit, withdrawal, buy, and sell. It answers the question: "Given when I put money in and took money out, what annualized return did I earn?" This is the same method used by professional portfolio management software.
          </div>
        </>
      )}
    </div>
  );
}
