import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ASSET_CLASS_LABELS, fmt } from '@/lib/constants';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, LineChart, Line, Area, AreaChart } from 'recharts';
import * as XLSX from 'xlsx';

// No-decimal formatter for dashboard values
const fmtRound = (n) => Math.round(Number(n)).toLocaleString();

const ASSET_COLORS = { equity: '#4f7df5', bond: '#fbbf24', cash_mmf: '#34d399', commodity: '#f59e0b', real_estate: '#a78bfa' };
const REGION_COLORS = { US: '#4f7df5', Canada: '#f87171', UK: '#38bdf8', Europe: '#fbbf24', Global: '#a78bfa', Other: '#8896b3' };

// Map any country to a region — add countries here as needed
const EUROPE_COUNTRIES = ['France', 'Germany', 'Greece', 'Switzerland', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Portugal', 'Ireland', 'Austria', 'Sweden', 'Norway', 'Denmark', 'Finland', 'Poland'];
function countryToRegion(country) {
  if (country === 'United States') return 'US';
  if (country === 'Canada') return 'Canada';
  if (country === 'United Kingdom') return 'UK';
  if (EUROPE_COUNTRIES.includes(country)) return 'Europe';
  return 'Other';
}
const TAX_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'sheltered', label: 'Tax Sheltered' },
  { key: 'taxable', label: 'Non-Sheltered' },
];

function CustomTooltip({ active, payload }) {
  if (active && payload && payload.length) {
    const d = payload[0].payload;
    return (
      <div style={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{d.name}</div>
        <div style={{ color: '#8896b3' }}>USD {fmtRound(d.value)}</div>
        <div style={{ color: '#5a6a8a' }}>{d.percent}%</div>
      </div>
    );
  }
  return null;
}

function NetWorthTooltip({ active, payload, label }) {
  if (active && payload && payload.length) {
    return (
      <div style={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
        <div style={{ fontWeight: 600, marginBottom: 4, color: '#8896b3' }}>{label}</div>
        <div style={{ color: '#e8ecf4' }}>Net Worth: <strong>${fmt(payload[0].value)}</strong></div>
      </div>
    );
  }
  return null;
}

function CustomPieLabel({ cx, cy, midAngle, outerRadius, name, percent }) {
  if (percent < 3) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius + 24;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text x={x} y={y} fill="#8896b3" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={12} fontFamily="DM Sans">
      {name} ({percent}%)
    </text>
  );
}

// Helper: generate list of month-end dates from earliest trade to now
function getMonthRange(trades) {
  if (!trades || trades.length === 0) return [];
  const dates = trades.map(t => new Date(t.trade_date));
  const earliest = new Date(Math.min(...dates));
  const now = new Date();
  const months = [];
  let y = earliest.getFullYear();
  let m = earliest.getMonth() + 1;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    months.push({ year: y, month: m });
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

// Calculate holdings at a given date based on trades up to that date
function getHoldingsAtDate(trades, targetDate) {
  const positions = {};
  for (const t of trades) {
    if (new Date(t.trade_date) > targetDate) continue;
    const key = `${t.security_id}__${t.account_id}`;
    if (!positions[key]) positions[key] = { security_id: t.security_id, account_id: t.account_id, shares: 0 };
    if (t.trade_type === 'buy') positions[key].shares += Number(t.quantity);
    else positions[key].shares -= Number(t.quantity);
  }
  // Remove closed positions
  Object.keys(positions).forEach(k => { if (positions[k].shares <= 0.0001) delete positions[k]; });
  return positions;
}

export default function DashboardPage({ user }) {
  const [loading, setLoading] = useState(true);
  const [taxFilter, setTaxFilter] = useState('all');
  const [selectedAccounts, setSelectedAccounts] = useState([]); // empty = all
  const [showAccountFilter, setShowAccountFilter] = useState(false);
  const [timeHorizon, setTimeHorizon] = useState('6m'); // 'all', '1y', '6m', '3m'
  const [accounts, setAccounts] = useState([]);
  const [securities, setSecurities] = useState([]);
  const [trades, setTrades] = useState([]);
  const [cashFlows, setCashFlows] = useState([]);
  const [properties, setProperties] = useState([]);
  const [savingsEntries, setSavingsEntries] = useState([]);
  const [propertyValuations, setPropertyValuations] = useState([]);
  const [targetAllocations, setTargetAllocations] = useState([]);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetForm, setTargetForm] = useState({ Equities: '', Bonds: '', 'Cash / MMF': '', Commodities: '', 'Real Estate': '' });
  const [prices, setPrices] = useState({});
  const [fxRates, setFxRates] = useState({ USD: 1 });
  const [pricesLoading, setPricesLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [netWorthHistory, setNetWorthHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [dividendData, setDividendData] = useState({});
  const [volatilityData, setVolatilityData] = useState({});

  const exportAudit = async () => {
    const [secRes2, tradeRes2, accRes2, savRes2, propRes2, taRes2] = await Promise.all([
      supabase.from('securities').select('*').eq('user_id', user.id),
      supabase.from('trades').select('*').eq('user_id', user.id).order('trade_date'),
      supabase.from('accounts').select('*').eq('user_id', user.id),
      supabase.from('savings_ledger').select('*').eq('user_id', user.id).order('year_month'),
      supabase.from('properties').select('*').eq('user_id', user.id),
      supabase.from('target_allocations').select('*').eq('user_id', user.id),
    ]);
    const data = {
      securities: secRes2.data || [],
      trades: tradeRes2.data || [],
      accounts: accRes2.data || [],
      savings_ledger: savRes2.data || [],
      properties: propRes2.data || [],
      target_allocations: taRes2.data || [],
    };
    const wb = XLSX.utils.book_new();

    // Tab 1: Securities
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.securities), 'Securities');

    // Tab 2: Trades
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.trades), 'Trades');

    // Tab 3: Accounts
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.accounts), 'Accounts');

    // Tab 4: Savings Ledger
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.savings_ledger), 'Savings Ledger');

    // Tab 5: Properties
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.properties), 'Properties');

    // Tab 6: Target Allocations
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data.target_allocations), 'Target Allocations');

    // Tab 7: Positions (computed)
    const secMap = {};
    data.securities.forEach(s => { secMap[s.id] = s; });
    const positions = {};
    data.trades.forEach(t => {
      const sec = secMap[t.security_id];
      if (!sec) return;
      if (!positions[sec.ticker]) positions[sec.ticker] = { ticker: sec.ticker, name: sec.name, asset_class: sec.asset_class, classification: sec.classification || 'core', currency: sec.currency, shares: 0, cost_basis_local: 0 };
      if (t.trade_type === 'buy') { positions[sec.ticker].shares += Number(t.quantity); positions[sec.ticker].cost_basis_local += Number(t.quantity) * Number(t.price); }
      else { positions[sec.ticker].shares -= Number(t.quantity); }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(Object.values(positions).filter(p => p.shares > 0.001)), 'Positions');

    // Tab 8: MTD/YTD Reconciliation
    const now = new Date();
    const mtdStart = now.toISOString().slice(0, 8) + '01';
    const ytdStart = `${now.getFullYear()}-01-01`;
    const mtdTrades = data.trades.filter(t => t.trade_date >= mtdStart);
    const ytdTrades = data.trades.filter(t => t.trade_date >= ytdStart);
    const mtdSavings = data.savings_ledger.filter(e => e.year_month >= mtdStart.slice(0, 7) && Number(e.deposits_withdrawals || 0) !== 0);
    const ytdSavings = data.savings_ledger.filter(e => e.year_month >= ytdStart.slice(0, 7) && Number(e.deposits_withdrawals || 0) !== 0);
    const recon = [
      { label: 'MTD Start Date', value: mtdStart },
      { label: 'YTD Start Date', value: ytdStart },
      { label: 'MTD Trades Count', value: mtdTrades.length },
      { label: 'YTD Trades Count', value: ytdTrades.length },
      { label: 'MTD Trade Buys (local ccy)', value: mtdTrades.filter(t => t.trade_type === 'buy').reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0).toFixed(2) },
      { label: 'YTD Trade Buys (local ccy)', value: ytdTrades.filter(t => t.trade_type === 'buy').reduce((s, t) => s + Number(t.quantity) * Number(t.price), 0).toFixed(2) },
      { label: 'MTD Savings Deposits', value: mtdSavings.reduce((s, e) => s + Number(e.deposits_withdrawals || 0), 0).toFixed(2) },
      { label: 'YTD Savings Deposits', value: ytdSavings.reduce((s, e) => s + Number(e.deposits_withdrawals || 0), 0).toFixed(2) },
    ];
    const reconRows = [['Label', 'Value'], ...recon.map(r => [r.label, r.value])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(reconRows), 'MTD-YTD Reconciliation');

    // Tab 9: Savings running balances (per account)
    const savBalances = [];
    data.accounts.filter(a => a.account_type === 'savings').forEach(acc => {
      const ledger = data.savings_ledger.filter(e => String(e.account_id) === String(acc.id)).sort((a, b) => a.year_month.localeCompare(b.year_month));
      if (!ledger.length) return;
      const first = ledger[0];
      const dataMap = {};
      ledger.forEach(d => { dataMap[d.year_month] = d; });
      const [sy, sm] = first.year_month.split('-').map(Number);
      let y = sy, m = sm, prevClose = Number(first.balance), currentRate = Number(first.annual_rate);
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const stored = dataMap[ym];
        const opening = ym === first.year_month ? Number(first.balance) : prevClose;
        if (stored?.annual_rate != null) currentRate = Number(stored.annual_rate);
        const dep = stored ? Number(stored.deposits_withdrawals || 0) : 0;
        const interest = stored?.is_override ? Number(stored.interest_earned) : Math.round((opening * currentRate / 100) / 12 * 100) / 100;
        prevClose = opening + dep + interest;
        savBalances.push({ account: acc.name, currency: acc.currency, year_month: ym, opening, deposits: dep, interest, closing: prevClose, rate: currentRate });
        m++; if (m > 12) { m = 1; y++; }
      }
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(savBalances), 'Savings Running Balances');

    // Tab 10: Detailed monthly breakdown — two blocks: Market Values, then Net Flows
    // Build month list (last 12 months)
    const monthList = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthList.push({ year: d.getFullYear(), month: d.getMonth() + 1, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, name: `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${d.getFullYear()}` });
    }

    // Fetch price + fx history
    const allTickers = data.securities.map(s => s.ticker);
    const allCurrencies = [...new Set([...data.securities.map(s => s.currency), ...data.accounts.map(a => a.currency), ...data.properties.map(p => p.currency)])].filter(c => c && c !== 'USD');
    const monthsForApi = monthList.map(m => ({ year: m.year, month: m.month }));
    const [priceHist, fxHist] = await Promise.all([
      allTickers.length ? fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: allTickers, months: monthsForApi }) }).then(r => r.json()).catch(() => ({ history: {} })) : Promise.resolve({ history: {} }),
      allCurrencies.length ? fetch('/api/fx-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies: allCurrencies, months: monthsForApi }) }).then(r => r.json()).catch(() => ({ history: {} })) : Promise.resolve({ history: {} }),
    ]);

    const fxFor = (ccy, key) => ccy === 'USD' ? 1 : (fxHist.history?.[ccy]?.[key] || fxRates[ccy] || 1);
    const secByTicker = {};
    data.securities.forEach(s => { if (!secByTicker[s.ticker]) secByTicker[s.ticker] = s; });
    const classForSec = (s) => s.asset_class === 'equity' ? (s.classification === 'thematic' ? 'Thematic Equity' : 'Core Equity') : s.asset_class === 'commodity' ? 'Commodity' : s.asset_class === 'cash_mmf' ? 'MMF' : s.asset_class;

    // Compute value and flow for each asset per month
    const computeAssetMonthly = () => {
      const assets = []; // { assetClass, asset, values: [], flows: [] }
      // Equities/commodities/mmf
      Object.values(secByTicker).filter(s => ['equity', 'commodity', 'cash_mmf'].includes(s.asset_class)).forEach(sec => {
        const values = [], flows = [];
        monthList.forEach(m => {
          const monthEnd = new Date(m.year, m.month, 0);
          let shares = 0;
          data.trades.forEach(t => {
            if (t.security_id !== sec.id) return;
            if (new Date(t.trade_date) > monthEnd) return;
            shares += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity);
          });
          const histPrice = priceHist.history?.[sec.ticker]?.prices?.[m.key];
          const isCurrent = m.key === monthList[monthList.length - 1].key;
          const price = histPrice || (isCurrent ? (prices[sec.ticker]?.price || 0) : 0);
          const fx = fxFor(sec.currency, m.key);
          values.push(Math.round(shares * price * fx));
          const monthFlows = data.trades.filter(t => t.security_id === sec.id && t.trade_date.slice(0, 7) === m.key)
            .reduce((s, t) => s + (t.trade_type === 'buy' ? 1 : -1) * Number(t.quantity) * Number(t.price) * fxFor(t.currency || sec.currency, m.key), 0);
          flows.push(Math.round(monthFlows));
        });
        assets.push({ assetClass: classForSec(sec), asset: sec.ticker, values, flows });
      });
      // Savings
      data.accounts.filter(a => a.account_type === 'savings').forEach(acc => {
        const values = [], flows = [];
        const ledger = data.savings_ledger.filter(e => String(e.account_id) === String(acc.id)).sort((a, b) => a.year_month.localeCompare(b.year_month));
        monthList.forEach(m => {
          if (ledger.length === 0) { values.push(0); flows.push(0); return; }
          const first = ledger[0];
          const dMap = {};
          ledger.forEach(d => { dMap[d.year_month] = d; });
          const [sy, sm] = first.year_month.split('-').map(Number);
          let y = sy, mo = sm, pc = Number(first.balance), cr = Number(first.annual_rate);
          while (true) {
            const ym = `${y}-${String(mo).padStart(2, '0')}`;
            if (ym > m.key) break;
            const st = dMap[ym];
            const op = ym === first.year_month ? Number(first.balance) : pc;
            if (st?.annual_rate != null) cr = Number(st.annual_rate);
            const dep = st ? Number(st.deposits_withdrawals || 0) : 0;
            const intr = st?.is_override ? Number(st.interest_earned) : Math.round((op * cr / 100) / 12 * 100) / 100;
            pc = op + dep + intr;
            mo++; if (mo > 12) { mo = 1; y++; }
          }
          const fx = fxFor(acc.currency, m.key);
          values.push(m.key >= first.year_month ? Math.round(pc * fx) : 0);
          flows.push(Math.round(dMap[m.key] ? Number(dMap[m.key].deposits_withdrawals || 0) * fx : 0));
        });
        assets.push({ assetClass: 'Savings', asset: acc.name, values, flows });
      });
      // Real estate
      data.properties.forEach(p => {
        const values = [], flows = [];
        monthList.forEach(m => {
          const fx = fxFor(p.currency, m.key);
          values.push(Math.round((Number(p.current_value) - Number(p.mortgage_balance || 0)) * fx));
          flows.push(0);
        });
        assets.push({ assetClass: 'Real Estate', asset: p.name || p.address || 'Property', values, flows });
      });
      return assets;
    };

    const assetsMonthly = computeAssetMonthly();
    const nMonths = monthList.length;

    // Block 1: Market Values
    const detailRows = [['MARKET VALUE (USD)'], ['Asset Class', 'Asset', ...monthList.map(m => m.name)]];
    assetsMonthly.forEach(a => detailRows.push([a.assetClass, a.asset, ...a.values]));
    const mvTotals = Array(nMonths).fill(0);
    assetsMonthly.forEach(a => a.values.forEach((v, i) => { mvTotals[i] += v; }));
    detailRows.push(['TOTAL', '', ...mvTotals]);

    // Spacer
    detailRows.push([]);
    detailRows.push([]);

    // Block 2: Net Flows
    detailRows.push(['NET FLOWS (USD)']);
    detailRows.push(['Asset Class', 'Asset', ...monthList.map(m => m.name)]);
    assetsMonthly.forEach(a => detailRows.push([a.assetClass, a.asset, ...a.flows]));
    const flowTotals = Array(nMonths).fill(0);
    assetsMonthly.forEach(a => a.flows.forEach((v, i) => { flowTotals[i] += v; }));
    detailRows.push(['TOTAL', '', ...flowTotals]);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(detailRows), 'Monthly Detail');

    XLSX.writeFile(wb, `portfolio-audit-${now.toISOString().slice(0, 10)}.xlsx`);
  };

  const fetchData = useCallback(async () => {
    const [accRes, secRes, tradeRes, cfRes, propRes, savRes, pvRes, taRes] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', user.id),
      supabase.from('securities').select('*').eq('user_id', user.id),
      supabase.from('trades').select('*').eq('user_id', user.id).order('trade_date'),
      supabase.from('cash_flows').select('*').eq('user_id', user.id).order('flow_date'),
      supabase.from('properties').select('*').eq('user_id', user.id),
      supabase.from('savings_ledger').select('*').eq('user_id', user.id).order('year_month', { ascending: false }),
      supabase.from('property_valuations').select('*').eq('user_id', user.id).order('valuation_date'),
      supabase.from('target_allocations').select('*').eq('user_id', user.id),
    ]);
    setAccounts(accRes.data || []);
    setSecurities(secRes.data || []);
    setTrades(tradeRes.data || []);
    setCashFlows(cfRes.data || []);
    setProperties(propRes.data || []);
    setSavingsEntries(savRes.data || []);
    setPropertyValuations(pvRes.data || []);
    setTargetAllocations(taRes.data || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Fetch current prices and FX rates (including property and savings currencies)
  useEffect(() => {
    if (securities.length === 0 && properties.length === 0 && savingsEntries.length === 0) return;
    const tickers = securities.map(s => s.ticker);
    const secCurrencies = securities.map(s => s.currency);
    const propCurrencies = properties.map(p => p.currency);
    const savCurrencies = savingsEntries.map(s => {
      const acc = accounts.find(a => a.id === s.account_id);
      return acc?.currency || 'USD';
    });
    const tradeCurrencies = trades.map(t => t.currency).filter(Boolean);
    const uniqueCurrencies = [...new Set([...secCurrencies, ...propCurrencies, ...savCurrencies, ...tradeCurrencies])];
    setPricesLoading(true);
    Promise.all([
      tickers.length > 0
        ? fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ prices: {} }))
        : Promise.resolve({ prices: {} }),
      fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies: uniqueCurrencies }) }).then(r => r.json()).catch(() => ({ rates: { USD: 1 } })),
      tickers.length > 0
        ? fetch('/api/dividends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ dividends: {} }))
        : Promise.resolve({ dividends: {} }),
      tickers.length > 0
        ? fetch('/api/volatility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ volatility: {} }))
        : Promise.resolve({ volatility: {} }),
    ]).then(([priceData, fxData, divData, volData]) => {
      setPrices(priceData.prices || {});
      const cleanFxRates = { USD: 1 };
      Object.entries(fxData.rates || {}).forEach(([k, v]) => { if (v !== null && v !== undefined) cleanFxRates[k] = v; });
      setFxRates(cleanFxRates);
      setDividendData(divData.dividends || {});
      setVolatilityData(volData.volatility || {});
      setLastUpdated(new Date());
      setPricesLoading(false);
    });
  }, [securities, properties, savingsEntries, accounts]);

  // Fetch historical prices for net worth over time
  useEffect(() => {
    // Need at least trades or savings to build a timeline
    const hasTrades = trades.length > 0;
    const hasSavings = savingsEntries.length > 0;
    if (!hasTrades && !hasSavings) return;

    // Build month range from earliest trade or savings entry
    let months = [];
    if (hasTrades) {
      months = getMonthRange(trades);
    }
    if (hasSavings) {
      const earliestSavings = savingsEntries.reduce((min, e) => e.year_month < min ? e.year_month : min, savingsEntries[0].year_month);
      const [sy, sm] = earliestSavings.split('-').map(Number);
      const savMonths = [];
      const now = new Date();
      let y = sy, m = sm;
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        savMonths.push({ year: y, month: m });
        m++; if (m > 12) { m = 1; y++; }
      }
      // Merge: use whichever starts earlier
      if (months.length === 0 || (savMonths.length > 0 && `${savMonths[0].year}-${String(savMonths[0].month).padStart(2,'0')}` < `${months[0]?.year}-${String(months[0]?.month).padStart(2,'0')}`)) {
        months = savMonths;
      }
    }
    if (months.length < 2) return;

    const tickers = securities.map(s => s.ticker);
    const secCurrencies = securities.map(s => s.currency).filter(c => c !== 'USD');
    const propCurrencies = properties.map(p => p.currency).filter(c => c !== 'USD');
    const savAccCurrencies = [...new Set(savingsEntries.map(e => { const acc = accounts.find(a => a.id === e.account_id); return acc?.currency; }).filter(c => c && c !== 'USD'))];
    const uniqueCurrencies = [...new Set([...secCurrencies, ...propCurrencies, ...savAccCurrencies])];

    setHistoryLoading(true);

    Promise.all([
      fetch('/api/history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers, months }) }).then(r => r.json()).catch(() => ({ history: {} })),
      uniqueCurrencies.length > 0
        ? fetch('/api/fx-history', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies: uniqueCurrencies, months }) }).then(r => r.json()).catch(() => ({ history: {} }))
        : Promise.resolve({ history: {} }),
    ]).then(([priceHistory, fxHistory]) => {
      const secMap = {};
      securities.forEach(s => { secMap[s.id] = s; });
      const accMap = {};
      accounts.forEach(a => { accMap[a.id] = a; });

      const chartData = [];

      for (const m of months) {
        const monthKey = `${m.year}-${String(m.month).padStart(2, '0')}`;
        const monthEnd = new Date(m.year, m.month, 0); // last day of month

        const positions = getHoldingsAtDate(trades, monthEnd);

        const assetValues = { Equities: 0, Bonds: 0, 'Cash / MMF': 0, Commodities: 0, 'Real Estate': 0 };

        // Helper: check if account passes current filters
        const passesFilter = (accountId) => {
          const acc = accMap[accountId];
          if (!acc) return false;
          if (selectedAccounts.length > 0 && !selectedAccounts.includes(accountId)) return false;
          if (taxFilter === 'sheltered' && !acc.tax_sheltered) return false;
          if (taxFilter === 'taxable' && acc.tax_sheltered) return false;
          return true;
        };

        Object.values(positions).forEach(pos => {
          if (!passesFilter(pos.account_id)) return;
          const sec = secMap[pos.security_id];
          if (!sec) return;

          const tickerHistory = priceHistory.history?.[sec.ticker];
          // For current month, fall back to live price if no historical data yet
          const histPrice = tickerHistory?.prices?.[monthKey];
          const now2 = new Date();
          const currentMonthKey = `${now2.getFullYear()}-${String(now2.getMonth() + 1).padStart(2, '0')}`;
          const prevMonth = new Date(now2.getFullYear(), now2.getMonth() - 1, 1);
          const prevMonthKey = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
          const price = histPrice || ((monthKey === currentMonthKey || monthKey === prevMonthKey) ? (prices[sec.ticker]?.price || 0) : 0);

          let fxRate = 1;
          if (sec.currency !== 'USD') {
            fxRate = fxHistory.history?.[sec.currency]?.[monthKey] || fxRates[sec.currency] || 1;
          }

          const acc = accMap[pos.account_id];
          const taxHaircut = acc?.tax_sheltered ? 0.75 : 1;
          const value = pos.shares * price * fxRate * taxHaircut;
          const label = sec.asset_class === 'equity' ? 'Equities'
            : sec.asset_class === 'bond' ? 'Bonds'
            : sec.asset_class === 'commodity' ? 'Commodities'
            : 'Cash / MMF';
          assetValues[label] += value;
        });

        // Add real estate — use valuation history if available, otherwise current value
        properties.forEach(p => {
          if (!passesFilter(p.account_id)) return;
          const acc = accMap[p.account_id];
          if (!acc) return;
          let fxRate = 1;
          if (p.currency !== 'USD') {
            fxRate = fxHistory.history?.[p.currency]?.[monthKey] || fxRates[p.currency] || 1;
          }
          // Find the most recent valuation at or before this month
          const propVals = propertyValuations.filter(v => v.property_id === p.id && v.valuation_date.slice(0, 7) <= monthKey).sort((a, b) => b.valuation_date.localeCompare(a.valuation_date));
          if (propVals.length > 0) {
            assetValues['Real Estate'] += (Number(propVals[0].value) - Number(propVals[0].mortgage_balance)) * fxRate;
          } else {
            assetValues['Real Estate'] += (Number(p.current_value) - Number(p.mortgage_balance)) * fxRate;
          }
        });

        // Add savings: calculate compounded balance at this month for each savings account
        const savingsAccs = accounts.filter(a => a.account_type === 'savings');
        savingsAccs.forEach(sAcc => {
          if (!passesFilter(sAcc.id)) return;
          const accLedger = (savingsEntries || []).filter(l => l.account_id === sAcc.id).sort((a, b) => a.year_month.localeCompare(b.year_month));
          if (accLedger.length === 0) return;
          const first = accLedger[0];
          if (monthKey < first.year_month) return; // before tracking started

          const dataMap = {};
          accLedger.forEach(d => { dataMap[d.year_month] = d; });

          // Walk forward from start to this month
          const [sy2, sm2] = first.year_month.split('-').map(Number);
          let yy = sy2, mm = sm2, pc = Number(first.balance), cr = Number(first.annual_rate);
          while (true) {
            const ym2 = `${yy}-${String(mm).padStart(2, '0')}`;
            if (ym2 > monthKey) break;
            const st = dataMap[ym2];
            const op = ym2 === first.year_month ? Number(first.balance) : pc;
            if (st && st.annual_rate !== null && st.annual_rate !== undefined) cr = Number(st.annual_rate);
            const dep = st ? Number(st.deposits_withdrawals || 0) : 0;
            const isOv = st?.is_override || false;
            const intr = isOv ? Number(st.interest_earned) : Math.round((op * cr / 100) / 12 * 100) / 100;
            pc = op + dep + intr;
            mm++;
            if (mm > 12) { mm = 1; yy++; }
          }

          const currency = sAcc.currency || 'USD';
          let fxRate = 1;
          if (currency !== 'USD') {
            fxRate = fxHistory.history?.[currency]?.[monthKey] || fxRates[currency] || 1;
          }
          assetValues['Cash / MMF'] += pc * fxRate;
        });

        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const label = `${monthNames[m.month - 1]} ${m.year}`;

        chartData.push({
          month: label,
          Equities: Math.round(assetValues.Equities * 100) / 100,
          Bonds: Math.round(assetValues.Bonds * 100) / 100,
          'Cash / MMF': Math.round(assetValues['Cash / MMF'] * 100) / 100,
          Commodities: Math.round(assetValues.Commodities * 100) / 100,
          'Real Estate': Math.round(assetValues['Real Estate'] * 100) / 100,
          value: Math.round(Object.values(assetValues).reduce((s, v) => s + v, 0) * 100) / 100,
          raw: monthKey,
        });
      }

      setNetWorthHistory(chartData);
      setHistoryLoading(false);
    });
  }, [securities, trades, accounts, properties, savingsEntries, propertyValuations, fxRates, selectedAccounts, taxFilter]);

  // ---- CURRENT HOLDINGS CALCULATIONS ----
  const secMap = {};
  securities.forEach(s => { secMap[s.id] = s; });
  const accMap = {};
  accounts.forEach(a => { accMap[a.id] = a; });

  const positionMap = {};
  trades.forEach(t => {
    const key = `${t.security_id}__${t.account_id}`;
    if (!positionMap[key]) positionMap[key] = { security_id: t.security_id, account_id: t.account_id, shares: 0, totalCost: 0 };
    if (t.trade_type === 'buy') {
      positionMap[key].shares += Number(t.quantity);
      positionMap[key].totalCost += Number(t.quantity) * Number(t.price) + Number(t.fees || 0);
    } else {
      positionMap[key].shares -= Number(t.quantity);
      positionMap[key].totalCost -= Number(t.quantity) * Number(t.price) - Number(t.fees || 0);
    }
  });

  const holdings = [];
  Object.values(positionMap).forEach(pos => {
    if (pos.shares <= 0.0001) return;
    const sec = secMap[pos.security_id];
    const acc = accMap[pos.account_id];
    if (!sec || !acc) return;
    const priceData = prices[sec.ticker];
    const currentPrice = priceData?.price || 0;
    const previousClose = priceData?.previousClose || 0;
    const fxRate = fxRates[sec.currency] || 1;
    const marketValueLocal = pos.shares * currentPrice;
    const marketValueUSD = marketValueLocal * fxRate;
    const prevValueUSD = pos.shares * previousClose * fxRate;
    const dailyChangeUSD = marketValueUSD - prevValueUSD;
    const dailyChangePct = prevValueUSD > 0 ? ((marketValueUSD - prevValueUSD) / prevValueUSD) * 100 : 0;
    const avgCost = pos.shares > 0 ? pos.totalCost / pos.shares : 0;
    const unrealizedPL = (currentPrice - avgCost) * pos.shares;
    const unrealizedPLUSD = unrealizedPL * fxRate;
    holdings.push({
      ticker: sec.ticker, name: sec.name, assetClass: sec.asset_class, region: sec.region,
      currency: sec.currency, accountName: acc.name, accountId: acc.id, taxSheltered: acc.tax_sheltered,
      classification: sec.classification || 'core',
      shares: pos.shares, currentPrice, previousClose, avgCost, marketValueLocal, marketValueUSD,
      costBasis: pos.totalCost, costBasisUSD: pos.totalCost * fxRate,
      unrealizedPL, unrealizedPLUSD, dailyChangeUSD, dailyChangePct, fxRate,
    });
  });

  const realEstateHoldings = properties.map(p => {
    const acc = accMap[p.account_id];
    const fxRate = fxRates[p.currency] || 1;
    return {
      name: p.name, country: p.country, currency: p.currency, accountId: p.account_id,
      taxSheltered: acc?.tax_sheltered || false,
      currentValue: Number(p.current_value), currentValueUSD: Number(p.current_value) * fxRate,
      mortgageBalance: Number(p.mortgage_balance), mortgageBalanceUSD: Number(p.mortgage_balance) * fxRate,
      netEquity: Number(p.current_value) - Number(p.mortgage_balance),
      netEquityUSD: (Number(p.current_value) - Number(p.mortgage_balance)) * fxRate,
      rentalIncome: Number(p.net_rental_income), fxRate,
    };
  });

  // Apply tax filter AND account filter
  const passesAccountFilter = (accountId) => {
    if (selectedAccounts.length === 0) return true; // no filter = all
    return selectedAccounts.includes(accountId);
  };

  const filteredHoldings = holdings.filter(h => {
    if (taxFilter === 'sheltered' && !h.taxSheltered) return false;
    if (taxFilter === 'taxable' && h.taxSheltered) return false;
    if (!passesAccountFilter(h.accountId)) return false;
    return true;
  });
  const filteredRealEstate = realEstateHoldings.filter(h => {
    if (taxFilter === 'sheltered' && !h.taxSheltered) return false;
    if (taxFilter === 'taxable' && h.taxSheltered) return false;
    if (!passesAccountFilter(h.accountId)) return false;
    return true;
  });

  const totalInvestments = filteredHoldings.reduce((sum, h) => sum + h.marketValueUSD, 0);
  const totalRealEstateValue = filteredRealEstate.reduce((sum, h) => sum + h.currentValueUSD, 0);
  const totalMortgages = filteredRealEstate.reduce((sum, h) => sum + h.mortgageBalanceUSD, 0);
  const totalRealEstateEquity = totalRealEstateValue - totalMortgages;
  const totalUnrealizedPL = filteredHoldings.reduce((sum, h) => sum + h.unrealizedPLUSD, 0);
  const totalCostBasis = filteredHoldings.reduce((sum, h) => sum + h.costBasisUSD, 0);

  // Savings: calculate current balance with compounding for each account
  const savingsAccounts = accounts.filter(a => a.account_type === 'savings');
  const savingsBalances = savingsAccounts.map(acc => {
    // Apply both account filter AND tax filter
    if (!passesAccountFilter(acc.id)) return { accountId: acc.id, balance: 0 };
    if (taxFilter === 'sheltered' && !acc.tax_sheltered) return { accountId: acc.id, balance: 0 };
    if (taxFilter === 'taxable' && acc.tax_sheltered) return { accountId: acc.id, balance: 0 };
    const accLedger = savingsEntries.filter(l => l.account_id === acc.id).sort((a, b) => a.year_month.localeCompare(b.year_month));
    if (accLedger.length === 0) return { accountId: acc.id, balance: 0 };

    const first = accLedger[0];
    const dataMap = {};
    accLedger.forEach(d => { dataMap[d.year_month] = d; });

    // Generate months from start to now
    const [sy, sm] = first.year_month.split('-').map(Number);
    const now = new Date();
    let y = sy, m = sm, prevClose = Number(first.balance), currentRate = Number(first.annual_rate);
    while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
      const ym = `${y}-${String(m).padStart(2, '0')}`;
      const stored = dataMap[ym];
      const opening = ym === first.year_month ? Number(first.balance) : prevClose;
      if (stored && stored.annual_rate !== null && stored.annual_rate !== undefined) currentRate = Number(stored.annual_rate);
      const dep = stored ? Number(stored.deposits_withdrawals || 0) : 0;
      const isOverride = stored?.is_override || false;
      const interest = isOverride ? Number(stored.interest_earned) : Math.round((opening * currentRate / 100) / 12 * 100) / 100;
      prevClose = opening + dep + interest;
      m++;
      if (m > 12) { m = 1; y++; }
    }
    return { accountId: acc.id, balance: prevClose };
  });

  const savingsAccountsList = savingsBalances.filter(s => s.balance > 0);
  const totalSavingsUSD = savingsAccountsList.reduce((sum, s) => {
    const acc = accMap[s.accountId];
    if (!acc) return sum;
    const currency = acc.currency || 'USD';
    const fxRate = currency === 'USD' ? 1 : (fxRates[currency] || 1);
    return sum + s.balance * fxRate;
  }, 0);

  const totalNetWorth = totalInvestments + totalRealEstateEquity + totalSavingsUSD;
  const totalLiquid = totalInvestments + totalSavingsUSD; // excludes real estate
  const totalEquityCommodity = filteredHoldings.filter(h => h.assetClass === 'equity' || h.assetClass === 'commodity').reduce((s, h) => s + h.marketValueUSD, 0);
  // Tax-adjusted: apply 25% haircut to holdings in registered/tax-sheltered accounts
  const totalInvestmentsTaxAdj = filteredHoldings.reduce((s, h) => s + (h.taxSheltered ? h.marketValueUSD * 0.75 : h.marketValueUSD), 0);
  const totalNetWorthTaxAdj = totalInvestmentsTaxAdj + totalRealEstateEquity + totalSavingsUSD;

  // Daily change for equities + commodities only (not MMF, savings, or RE)
  const equityHoldings = filteredHoldings.filter(h => h.assetClass === 'equity' || h.assetClass === 'commodity');
  const dailyChangeDollars = equityHoldings.reduce((sum, h) => sum + h.dailyChangeUSD, 0);
  const prevEquityTotal = equityHoldings.reduce((sum, h) => sum + (h.shares * h.previousClose * h.fxRate), 0);
  const dailyChangePctTotal = prevEquityTotal > 0 ? (dailyChangeDollars / prevEquityTotal) * 100 : 0;

  // Allocation by asset class
  const assetClassData = {};
  filteredHoldings.forEach(h => {
    const label = ASSET_CLASS_LABELS[h.assetClass] || h.assetClass;
    assetClassData[label] = (assetClassData[label] || 0) + h.marketValueUSD;
  });
  if (totalRealEstateEquity > 0) assetClassData['Real Estate'] = (assetClassData['Real Estate'] || 0) + totalRealEstateEquity;
  if (totalSavingsUSD > 0) assetClassData['Cash / MMF'] = (assetClassData['Cash / MMF'] || 0) + totalSavingsUSD;

  const assetClassChartData = Object.entries(assetClassData)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => {
      const colorKey = name === 'Equities' ? 'equity' : name === 'Bonds' ? 'bond' : name === 'Cash / MMF' ? 'cash_mmf' : name === 'Commodities' ? 'commodity' : 'real_estate';
      return { name, value, color: ASSET_COLORS[colorKey] || '#8896b3', percent: totalNetWorth > 0 ? ((value / totalNetWorth) * 100).toFixed(0) : 0 };
    }).sort((a, b) => b.value - a.value);

  // Allocation by region
  const regionData = {};
  filteredHoldings.forEach(h => { regionData[h.region] = (regionData[h.region] || 0) + h.marketValueUSD; });
  filteredRealEstate.forEach(h => {
    const region = countryToRegion(h.country);
    regionData[region] = (regionData[region] || 0) + h.netEquityUSD;
  });
  // Add savings to region based on account country
  savingsAccountsList.forEach(s => {
    const acc = accMap[s.accountId];
    if (!acc) return;
    const currency = acc.currency || 'USD';
    const fxRate = currency === 'USD' ? 1 : (fxRates[currency] || 1);
    const valueUSD = s.balance * fxRate;
    const region = countryToRegion(acc.country);
    regionData[region] = (regionData[region] || 0) + valueUSD;
  });
  const regionChartData = Object.entries(regionData)
    .filter(([, v]) => v > 0)
    .map(([name, value]) => ({ name, value, color: REGION_COLORS[name] || '#8896b3', percent: totalNetWorth > 0 ? ((value / totalNetWorth) * 100).toFixed(0) : 0 }))
    .sort((a, b) => b.value - a.value);

  // Top holdings — aggregate by ticker across accounts
  const holdingsByTicker = {};
  filteredHoldings.forEach(h => {
    if (!holdingsByTicker[h.ticker]) {
      holdingsByTicker[h.ticker] = { ticker: h.ticker, name: h.name, assetClass: h.assetClass, region: h.region, currency: h.currency, classification: h.classification, shares: 0, marketValueUSD: 0, costBasisUSD: 0, unrealizedPLUSD: 0, dailyChangeUSD: 0, currentPrice: h.currentPrice, previousClose: h.previousClose, fxRate: h.fxRate };
    }
    holdingsByTicker[h.ticker].shares += h.shares;
    holdingsByTicker[h.ticker].marketValueUSD += h.marketValueUSD;
    holdingsByTicker[h.ticker].costBasisUSD += h.costBasisUSD;
    holdingsByTicker[h.ticker].unrealizedPLUSD += h.unrealizedPLUSD;
    holdingsByTicker[h.ticker].dailyChangeUSD += h.dailyChangeUSD;
  });
  const aggregatedHoldings = Object.values(holdingsByTicker).map(h => {
    const prevValueUSD = h.shares * h.previousClose * h.fxRate;
    const dailyChangePct = prevValueUSD > 0 ? (h.dailyChangeUSD / prevValueUSD) * 100 : 0;
    const sensitivity1pct = h.marketValueUSD * 0.01; // value change per 1% move
    return { ...h, dailyChangePct, sensitivity1pct };
  }).sort((a, b) => b.marketValueUSD - a.marketValueUSD);

  const topHoldings = aggregatedHoldings.slice(0, 10)
    .map(h => ({ name: h.ticker, value: h.marketValueUSD, color: ASSET_COLORS[h.assetClass] || '#4f7df5' }));

  if (loading) return <div className="loading"><div className="spinner" /> Loading dashboard...</div>;
  const hasData = holdings.length > 0 || realEstateHoldings.length > 0 || totalSavingsUSD > 0;

  return (
    <div className="fade-in">
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h2>Dashboard</h2>
          <p>Your portfolio at a glance{lastUpdated ? ` \u2022 Prices updated ${lastUpdated.toLocaleTimeString()}` : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-secondary btn-sm" onClick={exportAudit} style={{ fontSize: 12, padding: '5px 12px' }}>Export Audit</button>
          {/* Tax Filter */}
          <div className="filter-group">
            {TAX_FILTERS.map(f => (
              <button key={f.key} className={`filter-btn ${taxFilter === f.key ? 'active' : ''}`} onClick={() => setTaxFilter(f.key)}>{f.label}</button>
            ))}
          </div>
          {/* Account Filter */}
          <div style={{ position: 'relative' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setShowAccountFilter(!showAccountFilter)}
              style={{ fontSize: 12, padding: '5px 12px' }}
            >
              {selectedAccounts.length === 0 ? 'All Accounts' : `${selectedAccounts.length} Account${selectedAccounts.length > 1 ? 's' : ''}`}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 12, height: 12, marginLeft: 4 }}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {showAccountFilter && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => setShowAccountFilter(false)} />
                <div style={{
                  position: 'absolute', top: '100%', right: 0, zIndex: 50, marginTop: 4,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: 8, minWidth: 220,
                  maxHeight: 300, overflowY: 'auto', boxShadow: 'var(--shadow-lg)',
                }}>
                  <div
                    onClick={() => setSelectedAccounts([])}
                    style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 4, fontSize: 13, fontWeight: 500, color: selectedAccounts.length === 0 ? 'var(--accent)' : 'var(--text-secondary)', background: selectedAccounts.length === 0 ? 'var(--accent-glow)' : 'transparent', marginBottom: 2 }}
                  >
                    All Accounts
                  </div>
                  <div
                    onClick={() => setSelectedAccounts(accounts.map(a => a.id))}
                    style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 4, fontSize: 13, fontWeight: 500, color: selectedAccounts.length === accounts.length ? 'var(--accent)' : 'var(--text-secondary)', background: selectedAccounts.length === accounts.length ? 'var(--accent-glow)' : 'transparent', marginBottom: 4, borderBottom: '1px solid var(--border)', paddingBottom: 10 }}
                  >
                    Select All
                  </div>
                  {accounts.map(acc => {
                    const isSelected = selectedAccounts.includes(acc.id);
                    return (
                      <div
                        key={acc.id}
                        onClick={() => {
                          if (isSelected) setSelectedAccounts(selectedAccounts.filter(id => id !== acc.id));
                          else setSelectedAccounts([...selectedAccounts, acc.id]);
                        }}
                        style={{ padding: '6px 10px', cursor: 'pointer', borderRadius: 4, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, color: isSelected ? 'var(--text-primary)' : 'var(--text-muted)' }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <div style={{ width: 16, height: 16, borderRadius: 3, border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`, background: isSelected ? 'var(--accent)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          {isSelected && <svg viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" style={{ width: 10, height: 10 }}><polyline points="20 6 9 17 4 12"/></svg>}
                        </div>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{acc.name}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }}>{acc.currency}</span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {!hasData ? (
        <div className="empty-state" style={{ paddingTop: 80 }}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 64, height: 64, opacity: 0.3 }}><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <p style={{ fontSize: 16, maxWidth: 400, margin: '16px auto' }}>Add your <strong>Accounts</strong>, <strong>Securities</strong>, and <strong>Trades</strong> to see your dashboard.</p>
        </div>
      ) : (
        <>
          {/* Alerts Banner */}
          {!pricesLoading && !loading && (() => {
            const alerts = [];
            aggregatedHoldings.forEach(h => {
              if (h.costBasisUSD <= 0 || h.assetClass === 'cash_mmf') return;
              const avgCost = h.costBasisUSD / h.shares;
              const currentPriceUSD = h.currentPrice * h.fxRate;
              const changePct = avgCost > 0 ? ((currentPriceUSD - avgCost) / avgCost * 100) : 0;
              if (changePct <= -20) {
                alerts.push({ ticker: h.ticker, type: 'stop_loss', msg: `${h.ticker} is down ${Math.abs(changePct).toFixed(1)}% from avg cost — stop-loss trigger (-20%)`, color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' });
              }
              const sec = securities.find(s => s.ticker === h.ticker);
              if (sec?.target_profit_pct != null && changePct >= Number(sec.target_profit_pct)) {
                alerts.push({ ticker: h.ticker, type: 'target', msg: `${h.ticker} is up ${changePct.toFixed(1)}% from avg cost — target profit reached (+${sec.target_profit_pct}%)`, color: 'var(--success)', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.2)' });
              }
            });
            if (alerts.length === 0) return null;
            return (
              <div style={{ marginBottom: 20 }}>
                {alerts.map((a, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', background: a.bg, border: `1px solid ${a.border}`, borderRadius: 'var(--radius-sm)', marginBottom: 8, fontSize: 13 }}>
                    <span style={{ color: a.color, fontWeight: 700, fontSize: 16 }}>{a.type === 'stop_loss' ? '⚠️' : '🎯'}</span>
                    <span style={{ color: a.color, fontWeight: 600 }}>{a.msg}</span>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Net Worth Cards */}
          {(() => {
            const now = new Date();

            // Get last month's total from chart data
            const lastMonthKey = (() => {
              const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            })();
            const decKey = `${now.getFullYear() - 1}-12`;
            const mtdStart = netWorthHistory.find(d => d.raw === lastMonthKey)?.value ?? null;
            const ytdStart = netWorthHistory.find(d => d.raw === decKey)?.value ?? null;

            // Money added calculation
            const mtdStartDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
            const ytdStartDate = `${now.getFullYear()}-01-01`;

            // Money added = savings deposits + security buys - security sells since startDate
            const calcMoneyAdded = (startDate) => {
              const startYM = startDate.slice(0, 7);

              // Savings: deposits/withdrawals from ledger in period
              const savAdded = savingsEntries.filter(e => e.year_month >= startYM && Number(e.deposits_withdrawals || 0) !== 0)
                .reduce((s, e) => {
                  const acc = accounts.find(a => a.id === e.account_id);
                  const fxRate = acc ? (fxRates[acc.currency] || 1) : 1;
                  return s + Number(e.deposits_withdrawals || 0) * fxRate;
                }, 0);

              // Initial savings balance if account was opened within the period
              const savInitial = accounts
                .filter(a => a.account_type === 'savings')
                .reduce((s, sAcc) => {
                  const ledger = savingsEntries.filter(e => e.account_id === sAcc.id).sort((a, b) => a.year_month.localeCompare(b.year_month));
                  if (ledger.length === 0) return s;
                  const first = ledger[0];
                  if (first.year_month >= startYM) {
                    const fxRate = fxRates[sAcc.currency] || 1;
                    return s + Number(first.balance) * fxRate;
                  }
                  return s;
                }, 0);

              // Security trades in period: buys add wealth, sells remove it
              // Apply same 25% haircut for sheltered accounts to match history baseline
              const tradesAdded = trades.filter(t => t.trade_date >= startDate)
                .reduce((s, t) => {
                  const fxRate = fxRates[t.currency] || 1;
                  const acc = accounts.find(a => a.id === t.account_id);
                  const taxHaircut = acc?.tax_sheltered ? 0.75 : 1;
                  const value = Number(t.quantity) * Number(t.price) * fxRate * taxHaircut;
                  return s + (t.trade_type === 'buy' ? value : -value);
                }, 0);

              return savAdded + savInitial + tradesAdded;
            };

            // MTD: use tax-adjusted NW on both sides for consistency with history
            const mtdTotal = mtdStart !== null ? totalNetWorthTaxAdj - mtdStart : null;
            const mtdAdded = mtdStart !== null ? calcMoneyAdded(mtdStartDate) : 0;
            const mtdMarket = mtdTotal !== null ? mtdTotal - mtdAdded : null;

            const ytdTotal = ytdStart !== null ? totalNetWorthTaxAdj - ytdStart : null;
            const ytdAdded = ytdStart !== null ? calcMoneyAdded(ytdStartDate) : 0;
            const ytdMarket = ytdTotal !== null ? ytdTotal - ytdAdded : null;

            const mmfTotal = aggregatedHoldings.filter(h => h.assetClass === 'cash_mmf').reduce((s, h) => s + h.marketValueUSD, 0);
            const emergencyGBP = 100000 * (fxRates['GBP'] || 1);
            const cashMMFTarget = targetAllocations.find(t => t.name === 'Cash / MMF');
            const targetCashMMFUSD = cashMMFTarget ? (Number(cashMMFTarget.target_pct) / 100) * totalNetWorth : 0;
            const cashReserve = Math.max(emergencyGBP, targetCashMMFUSD);
            const cashAvailable = Math.max(0, totalSavingsUSD + mmfTotal - cashReserve);

            return (
              <>
                <div className="stats-row">
                  <div className="stat-card"><div className="stat-label">Net Worth (USD)</div><div className="stat-value">${fmtRound(totalNetWorthTaxAdj)}</div><div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>Pre-tax: ${fmtRound(totalNetWorth)}</div></div>
                  <div className="stat-card">
                    <div className="stat-label">Daily P&L</div>
                    <div className="stat-value" style={{ fontSize: 20, color: dailyChangeDollars >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                      {dailyChangeDollars >= 0 ? '+' : ''}${fmtRound(dailyChangeDollars)}
                    </div>
                    <div style={{ fontSize: 13, color: dailyChangePctTotal >= 0 ? 'var(--success)' : 'var(--danger)', marginTop: 2, fontWeight: 500 }}>
                      {dailyChangePctTotal >= 0 ? '+' : ''}{dailyChangePctTotal.toFixed(2)}%
                    </div>
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">MTD Market Return</div>
                    {mtdMarket !== null ? (
                      <div className="stat-value" style={{ fontSize: 20, color: mtdMarket >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {mtdMarket >= 0 ? '+' : ''}${fmtRound(mtdMarket)}
                        <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 6 }}>({mtdStart > 0 ? ((mtdMarket / mtdStart) * 100).toFixed(1) : '0.0'}%)</span>
                      </div>
                    ) : <div className="stat-value" style={{ fontSize: 16, color: 'var(--text-muted)' }}>{'\u2014'}</div>}
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">YTD Market Return</div>
                    {ytdMarket !== null ? (
                      <div className="stat-value" style={{ fontSize: 20, color: ytdMarket >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        {ytdMarket >= 0 ? '+' : ''}${fmtRound(ytdMarket)}
                        <span style={{ fontSize: 13, fontWeight: 400, marginLeft: 6 }}>({ytdStart > 0 ? ((ytdMarket / ytdStart) * 100).toFixed(1) : '0.0'}%)</span>
                      </div>
                    ) : <div className="stat-value" style={{ fontSize: 16, color: 'var(--text-muted)' }}>{'\u2014'}</div>}
                  </div>
                  <div className="stat-card">
                    <div className="stat-label">Cash to Invest</div>
                    <div className="stat-value" style={{ fontSize: 20, color: 'var(--accent)' }}>${fmtRound(cashAvailable)}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      Reserve: ${fmtRound(cashReserve)} ({targetCashMMFUSD > emergencyGBP ? 'target alloc' : '£100K floor'})
                    </div>
                  </div>
                </div>
              </>
            );
          })()}

          {pricesLoading && (
            <div style={{ background: 'var(--accent-glow)', border: '1px solid rgba(79,125,245,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 20, fontSize: 13, color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> Fetching live prices...
            </div>
          )}

          {/* Net Worth Over Time — Stacked by Asset Class */}
          <div className="card" style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span>Net Worth Over Time</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {historyLoading && <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, textTransform: 'none' }}><div className="spinner" style={{ width: 12, height: 12, borderWidth: 2 }} /> Loading...</div>}
                <div className="filter-group" style={{ margin: 0 }}>
                  {[
                    { key: '3m', label: '3M' },
                    { key: '6m', label: '6M' },
                    { key: '1y', label: '1Y' },
                    { key: 'all', label: 'All' },
                  ].map(t => (
                    <button key={t.key} className={`filter-btn ${timeHorizon === t.key ? 'active' : ''}`} onClick={() => setTimeHorizon(t.key)} style={{ padding: '3px 10px', fontSize: 11 }}>{t.label}</button>
                  ))}
                </div>
              </div>
            </div>
            {(() => {
              // Filter chart data by time horizon
              let chartDataFiltered = netWorthHistory;
              if (timeHorizon !== 'all' && netWorthHistory.length > 0) {
                const now = new Date();
                let cutoff;
                if (timeHorizon === '3m') cutoff = new Date(now.getFullYear(), now.getMonth() - 3, 1);
                else if (timeHorizon === '6m') cutoff = new Date(now.getFullYear(), now.getMonth() - 6, 1);
                else if (timeHorizon === '1y') cutoff = new Date(now.getFullYear() - 1, now.getMonth(), 1);
                const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
                chartDataFiltered = netWorthHistory.filter(d => d.raw >= cutoffKey);
              }
              return chartDataFiltered.length > 1 ? (
              <>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartDataFiltered} margin={{ left: 20, right: 20, top: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2a3654" vertical={false} />
                    <XAxis dataKey="month" stroke="#5a6a8a" fontSize={11} tickLine={false} interval="preserveStartEnd" />
                    <YAxis stroke="#5a6a8a" fontSize={11} tickLine={false} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip content={({ active, payload, label }) => {
                      if (!active || !payload) return null;
                      const total = payload.reduce((s, p) => p.dataKey !== 'value' ? s + (p.value || 0) : s, 0);
                      return (
                        <div style={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, padding: '12px 16px', fontSize: 13 }}>
                          <div style={{ fontWeight: 600, marginBottom: 8, color: '#8896b3' }}>{label}</div>
                          {payload.filter(p => p.value > 0 && p.dataKey !== 'value').reverse().map(p => (
                            <div key={p.dataKey} style={{ display: 'flex', justifyContent: 'space-between', gap: 20, marginBottom: 3 }}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 8, height: 8, borderRadius: 2, background: p.fill || p.color, display: 'inline-block' }} />
                                {p.dataKey}
                              </span>
                              <span style={{ fontWeight: 500 }}>${fmtRound(p.value)}</span>
                            </div>
                          ))}
                          <div style={{ borderTop: '1px solid #2a3654', marginTop: 6, paddingTop: 6, display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: '#e8ecf4' }}>
                            <span>Total</span>
                            <span>${fmtRound(total)}</span>
                          </div>
                        </div>
                      );
                    }} />
                    <Bar dataKey="Real Estate" stackId="1" fill="#a78bfa" radius={0} />
                    <Bar dataKey="Commodities" stackId="1" fill="#f59e0b" radius={0} />
                    <Bar dataKey="Cash / MMF" stackId="1" fill="#34d399" radius={0} />
                    <Bar dataKey="Bonds" stackId="1" fill="#fbbf24" radius={0} />
                    <Bar dataKey="Equities" stackId="1" fill="#4f7df5" radius={[3, 3, 0, 0]} />
                    <Line dataKey="value" type="monotone" stroke="#ffffff" strokeWidth={2} dot={false} strokeDasharray="4 2" legendType="none" />
                  </BarChart>
                </ResponsiveContainer>
                {/* Legend */}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12, justifyContent: 'center' }}>
                  {[
                    { name: 'Equities', color: '#4f7df5' },
                    { name: 'Bonds', color: '#fbbf24' },
                    { name: 'Cash / MMF', color: '#34d399' },
                    { name: 'Commodities', color: '#f59e0b' },
                    { name: 'Real Estate', color: '#a78bfa' },
                    { name: 'Total', color: '#ffffff', dashed: true },
                  ].map(d => (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                      {d.dashed
                        ? <div style={{ width: 18, height: 2, background: d.color, borderTop: '2px dashed ' + d.color }} />
                        : <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />
                      }
                      {d.name}
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
                {historyLoading ? 'Calculating historical values...' : 'Need at least 2 months of trade history to show chart'}
              </div>
            );
            })()}
          </div>

          {/* Pie Charts Row */}
          <div className="pie-charts-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            {/* Asset Class */}
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Allocation by Asset Class</div>
              {assetClassChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={assetClassChartData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" label={CustomPieLabel} labelLine={false} strokeWidth={2} stroke="#0a0f1a">
                      {assetClassChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No data</div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
                {assetClassChartData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />{d.name}: ${fmtRound(d.value)}
                  </div>
                ))}
              </div>
            </div>

            {/* Region */}
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Exposure by Region</div>
              {regionChartData.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={regionChartData} cx="50%" cy="50%" outerRadius={90} innerRadius={50} dataKey="value" label={CustomPieLabel} labelLine={false} strokeWidth={2} stroke="#0a0f1a">
                      {regionChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>No data</div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
                {regionChartData.map(d => (
                  <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <div style={{ width: 10, height: 10, borderRadius: 3, background: d.color }} />{d.name}: ${fmtRound(d.value)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Target Allocation */}
          {(() => {
            const targetMap = {};
            targetAllocations.forEach(t => { targetMap[t.name] = Number(t.target_pct); });
            const hasTargets = Object.keys(targetMap).length > 0;
            const allClasses = ['Equities', 'Bonds', 'Cash / MMF', 'Commodities', 'Real Estate'];
            const driftData = allClasses.map(name => {
              const current = assetClassChartData.find(d => d.name === name);
              const currentPct = current ? parseFloat(current.percent) : 0;
              const currentUSD = current ? current.value : 0;
              const targetPct = targetMap[name] || 0;
              const targetUSD = targetPct / 100 * totalNetWorth;
              return { name, currentPct, targetPct, drift: currentPct - targetPct, currentUSD, targetUSD, gapUSD: targetUSD - currentUSD };
            }).filter(d => d.currentPct > 0 || d.targetPct > 0);

            const saveTargets = async () => {
              const entries = Object.entries(targetForm).filter(([, v]) => v !== '' && v !== null);
              // Delete existing
              await supabase.from('target_allocations').delete().eq('user_id', user.id);
              // Insert new
              if (entries.length > 0) {
                await supabase.from('target_allocations').insert(
                  entries.map(([name, pct]) => ({ user_id: user.id, name, target_pct: parseFloat(pct) || 0 }))
                );
              }
              setShowTargetModal(false);
              fetchData();
            };

            return (
              <div className="card" style={{ marginBottom: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target Allocation</div>
                  <button className="btn btn-secondary btn-sm" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => {
                    const f = {};
                    allClasses.forEach(c => { f[c] = targetMap[c] !== undefined ? String(targetMap[c]) : ''; });
                    setTargetForm(f);
                    setShowTargetModal(true);
                  }}>{hasTargets ? 'Edit Targets' : 'Set Targets'}</button>
                </div>
                {!hasTargets ? (
                  <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Set your target allocation to see how your portfolio compares.</div>
                ) : (
                  <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                    <table>
                      <thead><tr><th>Asset Class</th><th style={{ textAlign: 'right' }}>Current</th><th style={{ textAlign: 'right' }}>Target</th><th style={{ textAlign: 'right' }}>Drift</th><th style={{ textAlign: 'right' }}>$ Gap</th><th style={{ width: 200 }}>Visual</th></tr></thead>
                      <tbody>
                        {driftData.map(d => {
                          const colorKey = d.name === 'Equities' ? 'equity' : d.name === 'Bonds' ? 'bond' : d.name === 'Cash / MMF' ? 'cash_mmf' : d.name === 'Commodities' ? 'commodity' : 'real_estate';
                          const color = ASSET_COLORS[colorKey] || '#8896b3';
                          return (
                            <tr key={d.name}>
                              <td style={{ fontWeight: 500 }}>{d.name}</td>
                              <td style={{ textAlign: 'right' }}>{d.currentPct.toFixed(1)}%</td>
                              <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{d.targetPct.toFixed(1)}%</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: Math.abs(d.drift) < 2 ? 'var(--text-muted)' : d.drift > 0 ? 'var(--success)' : 'var(--danger)' }}>
                                {d.drift > 0 ? '+' : ''}{d.drift.toFixed(1)}pp
                              </td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: Math.abs(d.gapUSD) < 1000 ? 'var(--text-muted)' : d.gapUSD > 0 ? 'var(--danger)' : 'var(--success)' }}>
                                {d.gapUSD > 0 ? '+' : ''}${fmtRound(d.gapUSD)}
                              </td>
                              <td>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 20 }}>
                                  <div style={{ flex: 1, background: 'var(--bg-secondary)', borderRadius: 4, height: 8, position: 'relative', overflow: 'hidden' }}>
                                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${Math.min(d.currentPct, 100)}%`, background: color, borderRadius: 4, transition: 'width 0.3s' }} />
                                    {d.targetPct > 0 && <div style={{ position: 'absolute', left: `${Math.min(d.targetPct, 100)}%`, top: -2, width: 2, height: 12, background: 'var(--text-primary)', borderRadius: 1 }} />}
                                  </div>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Target Modal */}
                {showTargetModal && (
                  <div className="modal-overlay" onClick={() => setShowTargetModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                      <h3>Set Target Allocation</h3>
                      <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>Enter your target percentage for each asset class. Should add up to 100%.</p>
                      {allClasses.map(name => (
                        <div className="form-group" key={name}>
                          <label className="form-label">{name} (%)</label>
                          <input className="form-input" type="number" step="any" value={targetForm[name] || ''} onChange={e => setTargetForm({ ...targetForm, [name]: e.target.value })} placeholder="0" />
                        </div>
                      ))}
                      {(() => {
                        const sum = Object.values(targetForm).reduce((s, v) => s + (parseFloat(v) || 0), 0);
                        return (
                          <div style={{ fontSize: 13, fontWeight: 500, color: Math.abs(sum - 100) < 0.1 ? 'var(--success)' : 'var(--danger)', marginBottom: 12 }}>
                            Total: {sum.toFixed(1)}% {Math.abs(sum - 100) < 0.1 ? '✓' : `(${sum < 100 ? 'under' : 'over'} by ${Math.abs(sum - 100).toFixed(1)}%)`}
                          </div>
                        );
                      })()}
                      <div className="modal-actions">
                        <button className="btn btn-secondary" onClick={() => setShowTargetModal(false)}>Cancel</button>
                        <button className="btn btn-primary" onClick={saveTargets}>Save Targets</button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Allocation by Holding */}
          {aggregatedHoldings.length > 0 && (() => {
            const nonMMFHoldings = aggregatedHoldings.filter(h => h.assetClass !== 'cash_mmf');
            const mmfTotal = aggregatedHoldings.filter(h => h.assetClass === 'cash_mmf').reduce((s, h) => s + h.marketValueUSD, 0);
            const savingsMMFTotal = totalSavingsUSD + mmfTotal;

            // Group: core equities (blues), thematic equities (greens), commodities (ambers)
            const coreHoldings = nonMMFHoldings.filter(h => h.assetClass === 'equity' && h.classification !== 'thematic');
            const thematicHoldings = nonMMFHoldings.filter(h => h.assetClass === 'equity' && h.classification === 'thematic');
            const commodityHoldings = nonMMFHoldings.filter(h => h.assetClass === 'commodity');
            const otherHoldings = nonMMFHoldings.filter(h => h.assetClass !== 'equity' && h.assetClass !== 'commodity');

            const coreColors = ['#4f7df5','#2255cc','#1a40a0','#0f2d7a','#5a8fff','#3366dd','#1a4dbb'];
            const thematicColors = ['#00e5a0','#00b87a','#008f5c','#006b42','#00f5b0','#00cc8a','#00a870'];
            const commodityColors = ['#ffb800','#e07000','#c05000','#a03000','#ffd000','#ff9000','#ff7000'];
            const otherColors = ['#a78bfa','#9070e8','#7a58d4'];

            const getColor = (h, groupIdx) => {
              if (h.assetClass === 'commodity') return commodityColors[groupIdx % commodityColors.length];
              if (h.classification === 'thematic') return thematicColors[groupIdx % thematicColors.length];
              if (h.assetClass === 'equity') return coreColors[groupIdx % coreColors.length];
              return otherColors[groupIdx % otherColors.length];
            };

            // Build ordered data for pie: core first, then thematic, then commodities, then other
            const orderedHoldings = [...coreHoldings, ...thematicHoldings, ...commodityHoldings, ...otherHoldings];
            const pieData = orderedHoldings.map((h, i) => {
              let groupIdx = 0;
              if (h.assetClass === 'commodity') groupIdx = commodityHoldings.indexOf(h);
              else if (h.classification === 'thematic') groupIdx = thematicHoldings.indexOf(h);
              else if (h.assetClass === 'equity') groupIdx = coreHoldings.indexOf(h);
              else groupIdx = otherHoldings.indexOf(h);
              return { name: h.ticker, value: h.marketValueUSD, color: getColor(h, groupIdx) };
            });

            // Arc data for group rings (outer ring)
            const coreTotal = coreHoldings.reduce((s, h) => s + h.marketValueUSD, 0);
            const thematicTotal = thematicHoldings.reduce((s, h) => s + h.marketValueUSD, 0);
            const commodityTotal = commodityHoldings.reduce((s, h) => s + h.marketValueUSD, 0);
            const otherTotal = otherHoldings.reduce((s, h) => s + h.marketValueUSD, 0);
            const investTotal = nonMMFHoldings.reduce((s, h) => s + h.marketValueUSD, 0);

            const arcData = [
              coreTotal > 0 && { name: 'Core', value: coreTotal, fill: '#4f7df5' },
              thematicTotal > 0 && { name: 'Thematic', value: thematicTotal, fill: '#34d399' },
              commodityTotal > 0 && { name: 'Commodities', value: commodityTotal, fill: '#fbbf24' },
              otherTotal > 0 && { name: 'Other', value: otherTotal, fill: '#a78bfa' },
            ].filter(Boolean);

            return (
            <div className="card" style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Allocation by Holding</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'flex-start' }}>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    {/* Inner ring: individual holdings */}
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={88} innerRadius={50} dataKey="value" strokeWidth={2} stroke="#0a0f1a"
                      label={({ cx, cy, midAngle, innerRadius, outerRadius, name, percent }) => {
                        if (percent < 0.04) return null;
                        const RADIAN = Math.PI / 180;
                        const r = innerRadius + (outerRadius - innerRadius) * 0.5;
                        const x = cx + r * Math.cos(-midAngle * RADIAN);
                        const y = cy + r * Math.sin(-midAngle * RADIAN);
                        return <text x={x} y={y} fill="white" textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} style={{ pointerEvents: 'none' }}>{name}</text>;
                      }}
                      labelLine={false}
                    >
                      {pieData.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Pie>
                    {/* Outer ring: group arcs */}
                    <Pie data={arcData} cx="50%" cy="50%" outerRadius={108} innerRadius={94} dataKey="value" strokeWidth={3} stroke="#0a0f1a"
                      label={({ cx, cy, midAngle, outerRadius, name, value }) => {
                        const RADIAN = Math.PI / 180;
                        const x = cx + (outerRadius + 14) * Math.cos(-midAngle * RADIAN);
                        const y = cy + (outerRadius + 14) * Math.sin(-midAngle * RADIAN);
                        const pct = investTotal > 0 ? (value / investTotal * 100).toFixed(0) : 0;
                        return <text x={x} y={y} fill="var(--text-secondary)" textAnchor="middle" dominantBaseline="central" fontSize={10} fontWeight={600}>{name} {pct}%</text>;
                      }}
                      labelLine={false}
                    >
                      {arcData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.[0]) return null;
                      const d = payload[0].payload;
                      return (
                        <div style={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                          <div style={{ fontWeight: 600 }}>{d.name}</div>
                          <div>${fmtRound(d.value)} ({totalNetWorth > 0 ? ((d.value / totalNetWorth) * 100).toFixed(1) : 0}% of net worth)</div>
                        </div>
                      );
                    }} />
                  </PieChart>
                </ResponsiveContainer>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {[
                    { label: 'CORE', holdings: coreHoldings, colors: coreColors },
                    { label: 'THEMATIC', holdings: thematicHoldings, colors: thematicColors },
                    { label: 'COMMODITIES', holdings: commodityHoldings, colors: commodityColors },
                    { label: 'OTHER', holdings: otherHoldings, colors: otherColors },
                  ].filter(g => g.holdings.length > 0).map(group => (
                    <div key={group.label}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', padding: '8px 0 4px' }}>{group.label}</div>
                      {group.holdings.map((h, i) => {
                        const pct = totalNetWorth > 0 ? (h.marketValueUSD / totalNetWorth * 100) : 0;
                        const pctLiquid = totalLiquid > 0 ? (h.marketValueUSD / totalLiquid * 100) : 0;
                        const pctEqCmdty = (h.assetClass === 'equity' || h.assetClass === 'commodity') && totalEquityCommodity > 0 ? (h.marketValueUSD / totalEquityCommodity * 100) : null;
                        return (
                          <div key={h.ticker} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ width: 10, height: 10, borderRadius: 2, background: group.colors[i % group.colors.length], display: 'inline-block', flexShrink: 0 }} />
                              <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{h.ticker}</span>
                            </span>
                            <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                              <span style={{ color: 'var(--text-muted)', minWidth: 70, textAlign: 'right' }}>${fmtRound(h.marketValueUSD)}</span>
                              <span style={{ fontWeight: 600, minWidth: 42, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
                              <span style={{ color: 'var(--text-secondary)', minWidth: 50, textAlign: 'right', fontSize: 11 }}>{pctLiquid.toFixed(1)}% liq</span>
                              {pctEqCmdty !== null && <span style={{ color: 'var(--text-secondary)', minWidth: 48, textAlign: 'right', fontSize: 11 }}>{pctEqCmdty.toFixed(1)}% eq</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                  {savingsMMFTotal > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '3px 0', borderTop: '1px solid var(--border)', marginTop: 6, paddingTop: 8 }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#34d399', display: 'inline-block', flexShrink: 0 }} />Savings / MMF</span>
                      <span style={{ display: 'flex', gap: 16 }}><span style={{ color: 'var(--text-muted)' }}>${fmtRound(savingsMMFTotal)}</span><span style={{ fontWeight: 600, minWidth: 42, textAlign: 'right' }}>{totalNetWorth > 0 ? (savingsMMFTotal / totalNetWorth * 100).toFixed(1) : 0}%</span></span>
                    </div>
                  )}
                  {totalRealEstateEquity > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13, padding: '3px 0' }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#a78bfa', display: 'inline-block', flexShrink: 0 }} />Real Estate</span>
                      <span style={{ display: 'flex', gap: 16 }}><span style={{ color: 'var(--text-muted)' }}>${fmtRound(totalRealEstateEquity)}</span><span style={{ fontWeight: 600, minWidth: 42, textAlign: 'right' }}>{totalNetWorth > 0 ? (totalRealEstateEquity / totalNetWorth * 100).toFixed(1) : 0}%</span></span>
                    </div>
                  )}
                </div>
              </div>
            </div>
            );
          })()}

          {/* Currency Exposure */}
          {(() => {
            const currencyData = {};
            // Equities by exposure currency (not denomination currency)
            filteredHoldings.forEach(h => {
              const sec = securities.find(s => s.ticker === h.ticker);
              const exposureCcy = sec?.exposure_currency || h.currency;
              currencyData[exposureCcy] = (currencyData[exposureCcy] || 0) + h.marketValueUSD;
            });
            // Real estate by currency
            filteredRealEstate.forEach(h => {
              const prop = properties.find(p => p.name === h.name);
              const ccy = prop?.currency || 'USD';
              currencyData[ccy] = (currencyData[ccy] || 0) + h.netEquityUSD;
            });
            // Savings by account currency
            savingsAccountsList.forEach(s => {
              const acc = accMap[s.accountId];
              if (!acc) return;
              const ccy = acc.currency || 'USD';
              const fxRate = ccy === 'USD' ? 1 : (fxRates[ccy] || 1);
              currencyData[ccy] = (currencyData[ccy] || 0) + s.balance * fxRate;
            });
            const ccyColors = { USD: '#4f7df5', CAD: '#f87171', GBP: '#fbbf24', EUR: '#34d399', CHF: '#a78bfa', JPY: '#f59e0b', AUD: '#38bdf8' };
            const ccyChartData = Object.entries(currencyData).filter(([, v]) => v > 0).map(([name, value]) => ({
              name, value, color: ccyColors[name] || '#8896b3',
            })).sort((a, b) => b.value - a.value);
            const ccyTotal = ccyChartData.reduce((s, d) => s + d.value, 0);

            if (ccyChartData.length <= 1) return null;
            return (
              <div className="card" style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Currency Exposure</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'center' }}>
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={ccyChartData} cx="50%" cy="50%" outerRadius={85} innerRadius={50} dataKey="value" label={CustomPieLabel} labelLine={false} strokeWidth={2} stroke="#0a0f1a">
                        {ccyChartData.map((d, i) => <Cell key={i} fill={d.color} />)}
                      </Pie>
                      <Tooltip content={<CustomTooltip />} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {ccyChartData.map(d => (
                      <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 13 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ width: 10, height: 10, borderRadius: 2, background: d.color, display: 'inline-block', flexShrink: 0 }} />
                          <span style={{ fontWeight: 600 }}>{d.name}</span>
                        </span>
                        <span style={{ display: 'flex', gap: 16 }}>
                          <span style={{ color: 'var(--text-muted)' }}>${fmtRound(d.value)}</span>
                          <span style={{ fontWeight: 600, minWidth: 45, textAlign: 'right' }}>{ccyTotal > 0 ? (d.value / ccyTotal * 100).toFixed(1) : 0}%</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Combined Holdings & Risk Table */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Holdings & Risk</div>
              {(() => {
                const totalDailyVaR = aggregatedHoldings.filter(h => h.assetClass !== 'cash_mmf').reduce((s, h) => {
                  const vol = volatilityData[h.ticker];
                  return s + (vol?.daily ? h.marketValueUSD * (vol.daily / 100) * 1.65 : 0);
                }, 0);
                return totalDailyVaR > 0 ? <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Portfolio Daily VaR (95%): <strong style={{ color: 'var(--danger)' }}>${fmtRound(totalDailyVaR)} USD</strong></div> : null;
              })()}
            </div>
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead><tr><th>Ticker</th><th>Name</th><th style={{ textAlign: 'right' }}>Price</th><th style={{ textAlign: 'right' }}>Value (USD)</th><th style={{ textAlign: 'right' }}>% Net Worth</th><th style={{ textAlign: 'right' }}>% Liquid</th><th style={{ textAlign: 'right' }}>% Eq+Cmdty</th><th style={{ textAlign: 'right' }}>P&L</th><th style={{ textAlign: 'right' }}>Today</th><th style={{ textAlign: 'right' }}>Volatility</th><th style={{ textAlign: 'right' }}>Daily VaR (USD)</th><th style={{ textAlign: 'right' }}>Risk</th></tr></thead>
                <tbody>
                  {[
                    { label: 'CORE EQUITIES', holdings: aggregatedHoldings.filter(h => h.assetClass === 'equity' && h.classification !== 'thematic') },
                    { label: 'THEMATIC EQUITIES', holdings: aggregatedHoldings.filter(h => h.assetClass === 'equity' && h.classification === 'thematic') },
                    { label: 'COMMODITIES', holdings: aggregatedHoldings.filter(h => h.assetClass === 'commodity') },
                    { label: 'CASH / MMF', holdings: aggregatedHoldings.filter(h => h.assetClass === 'cash_mmf') },
                    { label: 'OTHER', holdings: aggregatedHoldings.filter(h => !['equity','commodity','cash_mmf'].includes(h.assetClass)) },
                  ].filter(g => g.holdings.length > 0).map(group => (
                    <React.Fragment key={group.label}>
                      <tr>
                        <td colSpan={12} style={{ background: 'var(--bg-secondary)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', padding: '6px 12px' }}>{group.label}</td>
                      </tr>
                      {group.holdings.map((h, i) => {
                        const vol = volatilityData[h.ticker];
                        const weight = totalNetWorth > 0 ? (h.marketValueUSD / totalNetWorth * 100) : 0;
                        const weightLiquid = totalLiquid > 0 ? (h.marketValueUSD / totalLiquid * 100) : 0;
                        const weightEqCmdty = (h.assetClass === 'equity' || h.assetClass === 'commodity') && totalEquityCommodity > 0 ? (h.marketValueUSD / totalEquityCommodity * 100) : null;
                        const annualVol = vol?.annual || null;
                        const dailyVol = vol?.daily || null;
                        const dailyVaR = dailyVol ? h.marketValueUSD * (dailyVol / 100) * 1.65 : null;
                        let riskLevel = 'Low', riskColor = 'var(--success)';
                        if (annualVol) {
                          const riskScore = weight * annualVol / 100;
                          if (riskScore > 5) { riskLevel = 'High'; riskColor = 'var(--danger)'; }
                          else if (riskScore > 2) { riskLevel = 'Medium'; riskColor = '#fbbf24'; }
                        }
                        const plPct = h.costBasisUSD > 0 ? (h.unrealizedPLUSD / h.costBasisUSD * 100) : 0;
                        return (
                          <tr key={i}>
                            <td style={{ fontWeight: 600, fontFamily: 'monospace', letterSpacing: '0.04em' }}>{h.ticker}</td>
                            <td>{h.name}</td>
                            <td style={{ textAlign: 'right', fontSize: 13 }}>{h.currency} {fmt(h.currentPrice)}</td>
                            <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmtRound(h.marketValueUSD)}</td>
                            <td style={{ textAlign: 'right' }}>{weight.toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{weightLiquid.toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{weightEqCmdty !== null ? `${weightEqCmdty.toFixed(1)}%` : '\u2014'}</td>
                            <td style={{ textAlign: 'right', fontWeight: 500, color: plPct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%
                            </td>
                            <td style={{ textAlign: 'right', color: h.dailyChangePct >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                              {h.dailyChangePct >= 0 ? '+' : ''}{h.dailyChangePct.toFixed(2)}%
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{annualVol ? `${annualVol.toFixed(1)}%` : '\u2014'}</td>
                            <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{dailyVaR ? `$${fmtRound(dailyVaR)}` : '\u2014'}</td>
                            <td style={{ textAlign: 'right' }}><span style={{ fontSize: 12, fontWeight: 600, color: riskColor }}>{riskLevel}</span></td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 24px 14px' }}>
              VaR = Value at Risk at 95% confidence. Based on 1-year historical volatility.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
