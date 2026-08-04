import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { ASSET_CLASS_LABELS, ASSET_CLASSES, REGIONS, fmt, fmtRound } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, LabelList } from 'recharts';

const ASSET_COLORS = { equity: '#4f7df5', bond: '#fbbf24', cash_mmf: '#34d399', commodity: '#f59e0b', real_estate: '#a78bfa' };
const REGION_COLORS = { US: '#4f7df5', Canada: '#f87171', UK: '#38bdf8', Europe: '#fbbf24', Global: '#a78bfa', Other: '#8896b3' };
const EUROPE_COUNTRIES = ['France','Germany','Greece','Switzerland','Italy','Spain','Netherlands','Belgium','Portugal','Ireland','Austria','Sweden','Norway','Denmark','Finland','Poland'];
function countryToRegion(c) { if (c === 'United States') return 'US'; if (c === 'Canada') return 'Canada'; if (c === 'United Kingdom') return 'UK'; if (EUROPE_COUNTRIES.includes(c)) return 'Europe'; return 'Other'; }

function PieChartCard({ title, data }) {
  if (!data || data.length === 0) return null;
  const total = data.reduce((s, d) => s + d.value, 0);
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, textAlign: 'center' }}>{title}</div>
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" strokeWidth={0}>
            {data.map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          <Tooltip content={({ active, payload }) => {
            if (!active || !payload?.[0]) return null;
            const d = payload[0].payload;
            return (
              <div style={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
                <div style={{ fontWeight: 600, color: d.color }}>{d.name}</div>
                <div>${fmtRound(d.value)} ({total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%)</div>
              </div>
            );
          }} />
        </PieChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
        {data.map(d => (
          <div key={d.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12, padding: '2px 0' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: d.color, display: 'inline-block' }} />
              {d.name}
            </span>
            <span style={{ fontWeight: 500 }}>{total > 0 ? ((d.value / total) * 100).toFixed(1) : 0}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ScenariosPage({ user }) {
  const [loading, setLoading] = useState(true);
  const [scenarios, setScenarios] = useState([]);
  const [scenarioTrades, setScenarioTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [securities, setSecurities] = useState([]);
  const [trades, setTrades] = useState([]);
  const [properties, setProperties] = useState([]);
  const [savingsEntries, setSavingsEntries] = useState([]);
  const [prices, setPrices] = useState({});
  const [fxRates, setFxRates] = useState({ USD: 1 });
  const [volatilityData, setVolatilityData] = useState({});
  const [tradeVolatility, setTradeVolatility] = useState(null); // volatility for ticker being added
  const [toast, setToast] = useState(null);
  const [selectedScenario, setSelectedScenario] = useState(null);
  const [showNewScenario, setShowNewScenario] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newScenarioDesc, setNewScenarioDesc] = useState('');
  const [showAddTrade, setShowAddTrade] = useState(false);
  const [editingTradeId, setEditingTradeId] = useState(null); // null = new trade, id = editing
  const [tradeForm, setTradeForm] = useState({
    trade_type: 'buy', ticker: '', security_name: '', quantity: '', price: '',
    currency: 'CAD', asset_class: 'equity', region: 'US', account_id: '', amount: '',
  });
  const [tickerSearchResults, setTickerSearchResults] = useState([]);
  const [viewMode, setViewMode] = useState('trades'); // 'trades' or 'stress'
  const [stressPreset, setStressPreset] = useState(null);

  const STRESS_PRESETS = [
    { key: 'mild', name: 'Mild Correction', shocks: { equity: -10, bond: 0, cash_mmf: 0, commodity: -5, real_estate: 0 } },
    { key: 'bear', name: 'Bear Market', shocks: { equity: -25, bond: 2, cash_mmf: 0, commodity: -10, real_estate: -5 } },
    { key: '2008', name: '2008 Financial Crisis', shocks: { equity: -40, bond: 5, cash_mmf: 0, commodity: -20, real_estate: -25 } },
  ];

  const fetchData = useCallback(async () => {
    const [scRes, stRes, accRes, secRes, trRes, propRes, savRes] = await Promise.all([
      supabase.from('scenarios').select('*').eq('user_id', user.id).order('created_at', { ascending: false }),
      supabase.from('scenario_trades').select('*').eq('user_id', user.id),
      supabase.from('accounts').select('*').eq('user_id', user.id),
      supabase.from('securities').select('*').eq('user_id', user.id),
      supabase.from('trades').select('*').eq('user_id', user.id).order('trade_date'),
      supabase.from('properties').select('*').eq('user_id', user.id),
      supabase.from('savings_ledger').select('*').eq('user_id', user.id).order('year_month'),
    ]);
    setScenarios(scRes.data || []);
    setScenarioTrades(stRes.data || []);
    setAccounts(accRes.data || []);
    setSecurities(secRes.data || []);
    setTrades(trRes.data || []);
    setProperties(propRes.data || []);
    setSavingsEntries(savRes.data || []);
    if ((scRes.data || []).length > 0 && !selectedScenario) setSelectedScenario(scRes.data[0].id);
    setLoading(false);

    const secs = secRes.data || [];
    const stTrades = stRes.data || [];
    // Always fetch FX regardless of whether there are securities,
    // because scenario trades may use currencies not in the portfolio.
    {
      const tickers = secs.map(s => s.ticker);
      // Include currencies from scenario trades (e.g. NOK, SEK, etc.)
      const scenarioTradeCurrencies = stTrades.map(t => t.currency).filter(Boolean);
      const currencies = [...new Set(
        secs.map(s => s.currency)
          .concat((accRes.data || []).map(a => a.currency))
          .concat((propRes.data || []).map(p => p.currency))
          .concat(scenarioTradeCurrencies)
      )];
      Promise.all([
        fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ prices: {} })),
        fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies }) }).then(r => r.json()).catch(() => ({ rates: {} })),
        fetch('/api/volatility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers }) }).then(r => r.json()).catch(() => ({ volatility: {} })),
      ]).then(([p, f, v]) => {
        setPrices(p.prices || {});
        setFxRates({ USD: 1, ...f.rates });
        setVolatilityData(v.volatility || {});
      });
    }
  }, [user.id, selectedScenario]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const searchTicker = async (q) => {
    if (q.length < 2) { setTickerSearchResults([]); return; }
    try {
      const r = await fetch('/api/search-ticker', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) });
      const d = await r.json();
      setTickerSearchResults(d.results || []);
    } catch { setTickerSearchResults([]); }
  };

  const fetchTickerPrice = async (ticker) => {
    try {
      const [priceRes, volRes] = await Promise.all([
        fetch('/api/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: [ticker] }) }).then(r => r.json()),
        fetch('/api/volatility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tickers: [ticker] }) }).then(r => r.json()),
      ]);
      const p = priceRes.prices?.[ticker];
      if (p?.price) setTradeForm(prev => ({ ...prev, price: String(p.price), currency: p.currency || 'USD', security_name: p.name || '' }));
      setTradeVolatility(volRes.volatility?.[ticker] || null);
    } catch { setTradeVolatility(null); }
  };

  const accMap = {};
  accounts.forEach(a => { accMap[a.id] = a; });
  const secMap = {};
  securities.forEach(s => { secMap[s.id] = s; });

  // ============================================================
  // Current allocation (same as dashboard)
  // ============================================================
  function getCurrentAllocation() {
    const assetClass = {};
    const region = {};

    // Holdings
    const positions = {};
    trades.forEach(t => {
      const key = `${t.security_id}__${t.account_id}`;
      if (!positions[key]) positions[key] = { security_id: t.security_id, account_id: t.account_id, shares: 0 };
      positions[key].shares += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity);
    });
    Object.values(positions).forEach(pos => {
      if (pos.shares <= 0.0001) return;
      const sec = secMap[pos.security_id];
      if (!sec) return;
      const price = prices[sec.ticker]?.price || 0;
      const fxRate = fxRates[sec.currency] || 1;
      const acc = accMap[pos.account_id];
      const taxHaircut = acc?.tax_sheltered ? 0.75 : 1;
      const valueUSD = pos.shares * price * fxRate * taxHaircut;
      const label = ASSET_CLASS_LABELS[sec.asset_class] || sec.asset_class;
      assetClass[label] = (assetClass[label] || 0) + valueUSD;
      region[sec.region] = (region[sec.region] || 0) + valueUSD;
    });

    // Real estate
    properties.forEach(p => {
      const fxRate = fxRates[p.currency] || 1;
      const equity = (Number(p.current_value) - Number(p.mortgage_balance)) * fxRate;
      assetClass['Real Estate'] = (assetClass['Real Estate'] || 0) + equity;
      const acc = accMap[p.account_id];
      const reg = acc ? countryToRegion(acc.country) : 'Other';
      region[reg] = (region[reg] || 0) + equity;
    });

    // Savings (compounded)
    accounts.filter(a => a.account_type === 'savings').forEach(sAcc => {
      const al = savingsEntries.filter(l => l.account_id === sAcc.id).sort((a, b) => a.year_month.localeCompare(b.year_month));
      if (al.length === 0) return;
      const first = al[0];
      const dm = {};
      al.forEach(d => { dm[d.year_month] = d; });
      const [sy, sm] = first.year_month.split('-').map(Number);
      const now = new Date();
      let y = sy, m = sm, pc = Number(first.balance), cr = Number(first.annual_rate);
      while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
        const ym = `${y}-${String(m).padStart(2, '0')}`;
        const st = dm[ym];
        const op = ym === first.year_month ? Number(first.balance) : pc;
        if (st && st.annual_rate != null) cr = Number(st.annual_rate);
        const dep = st ? Number(st.deposits_withdrawals || 0) : 0;
        const isOv = st?.is_override || false;
        const intr = isOv ? Number(st.interest_earned) : Math.round((op * cr / 100) / 12 * 100) / 100;
        pc = op + dep + intr;
        m++;
        if (m > 12) { m = 1; y++; }
      }
      const fxRate = fxRates[sAcc.currency] || 1;
      const balUSD = pc * fxRate;
      assetClass['Cash / MMF'] = (assetClass['Cash / MMF'] || 0) + balUSD;
      region[countryToRegion(sAcc.country)] = (region[countryToRegion(sAcc.country)] || 0) + balUSD;
    });

    return { assetClass, region };
  }

  // ============================================================
  // Scenario allocation
  // FIX: Equity buys/sells do NOT auto-deduct from Cash/MMF.
  // The user explicitly adds savings withdrawals to fund purchases.
  // ============================================================
  function getScenarioAllocation(scenarioId) {
    const { assetClass, region } = getCurrentAllocation();
    const sTrades = scenarioTrades.filter(t => t.scenario_id === scenarioId);

    sTrades.forEach(t => {
      if (t.trade_type === 'buy') {
        const fxRate = fxRates[t.currency] || 1;
        const valueUSD = Number(t.quantity) * Number(t.price) * fxRate;
        const label = ASSET_CLASS_LABELS[t.asset_class] || t.asset_class;
        assetClass[label] = (assetClass[label] || 0) + valueUSD;
        region[t.region] = (region[t.region] || 0) + valueUSD;
        // NO auto deduction from Cash/MMF
      } else if (t.trade_type === 'sell') {
        const fxRate = fxRates[t.currency] || 1;
        const valueUSD = Number(t.quantity) * Number(t.price) * fxRate;
        const label = ASSET_CLASS_LABELS[t.asset_class] || t.asset_class;
        assetClass[label] = (assetClass[label] || 0) - valueUSD;
        region[t.region] = (region[t.region] || 0) - valueUSD;
        // Sell proceeds go to Cash/MMF
        assetClass['Cash / MMF'] = (assetClass['Cash / MMF'] || 0) + valueUSD;
      } else if (t.trade_type === 'savings_deposit') {
        const acc = accMap[t.account_id];
        const fxRate = acc ? (fxRates[acc.currency] || 1) : 1;
        const valueUSD = Number(t.amount) * fxRate;
        assetClass['Cash / MMF'] = (assetClass['Cash / MMF'] || 0) + valueUSD;
        const reg = acc ? countryToRegion(acc.country) : 'Other';
        region[reg] = (region[reg] || 0) + valueUSD;
      } else if (t.trade_type === 'savings_withdrawal') {
        const acc = accMap[t.account_id];
        const fxRate = acc ? (fxRates[acc.currency] || 1) : 1;
        const valueUSD = Number(t.amount) * fxRate;
        assetClass['Cash / MMF'] = (assetClass['Cash / MMF'] || 0) - valueUSD;
        const reg = acc ? countryToRegion(acc.country) : 'Other';
        region[reg] = (region[reg] || 0) - valueUSD;
      }
    });

    // Clamp negatives
    Object.keys(assetClass).forEach(k => { if (assetClass[k] < 0) assetClass[k] = 0; });
    Object.keys(region).forEach(k => { if (region[k] < 0) region[k] = 0; });

    return { assetClass, region };
  }

  function toChartData(data, colorMap) {
    return Object.entries(data).filter(([, v]) => v > 0).map(([name, value]) => {
      const ck = name === 'Equities' ? 'equity' : name === 'Bonds' ? 'bond' : name === 'Cash / MMF' ? 'cash_mmf' : name === 'Commodities' ? 'commodity' : name === 'Real Estate' ? 'real_estate' : name.toLowerCase();
      return { name, value, color: colorMap[ck] || colorMap[name] || '#8896b3' };
    }).sort((a, b) => b.value - a.value);
  }

  // ============================================================
  // CRUD
  // ============================================================
  const createScenario = async () => {
    if (!newScenarioName.trim()) return;
    const { data } = await supabase.from('scenarios').insert({ user_id: user.id, name: newScenarioName.trim(), description: newScenarioDesc.trim() }).select().single();
    if (data) setSelectedScenario(data.id);
    setNewScenarioName('');
    setNewScenarioDesc('');
    setShowNewScenario(false);
    setToast({ message: 'Scenario created', type: 'success' });
    fetchData();
  };

  const deleteScenario = async (id) => {
    await supabase.from('scenario_trades').delete().eq('scenario_id', id);
    await supabase.from('scenarios').delete().eq('id', id);
    setSelectedScenario(null);
    setToast({ message: 'Scenario deleted', type: 'success' });
    fetchData();
  };

  const openNewTrade = () => {
    setEditingTradeId(null);
    setTradeForm({ trade_type: 'buy', ticker: '', security_name: '', quantity: '', price: '', currency: 'CAD', asset_class: 'equity', region: 'US', account_id: '', amount: '' });
    setTickerSearchResults([]);
    setShowAddTrade(true);
  };

  const openEditTrade = (t) => {
    setEditingTradeId(t.id);
    if (t.trade_type === 'buy' || t.trade_type === 'sell') {
      setTradeForm({ trade_type: t.trade_type, ticker: t.ticker || '', security_name: t.security_name || '', quantity: String(t.quantity || ''), price: String(t.price || ''), currency: t.currency || 'CAD', asset_class: t.asset_class || 'equity', region: t.region || 'US', account_id: '', amount: '' });
    } else {
      setTradeForm({ trade_type: t.trade_type, ticker: '', security_name: '', quantity: '', price: '', currency: 'CAD', asset_class: 'equity', region: 'US', account_id: t.account_id || '', amount: String(t.amount || '') });
    }
    setTickerSearchResults([]);
    setShowAddTrade(true);
  };

  const saveTrade = async () => {
    const f = tradeForm;
    const payload = { user_id: user.id, scenario_id: selectedScenario, trade_type: f.trade_type };
    if (f.trade_type === 'buy' || f.trade_type === 'sell') {
      payload.ticker = f.ticker;
      payload.security_name = f.security_name;
      payload.quantity = parseFloat(f.quantity) || 0;
      payload.price = parseFloat(f.price) || 0;
      payload.currency = f.currency;
      payload.asset_class = f.asset_class;
      payload.region = f.region;
    } else {
      payload.account_id = f.account_id;
      payload.amount = parseFloat(f.amount) || 0;
    }

    if (editingTradeId) {
      await supabase.from('scenario_trades').update(payload).eq('id', editingTradeId);
      setToast({ message: 'Trade updated', type: 'success' });
    } else {
      await supabase.from('scenario_trades').insert(payload);
      setToast({ message: 'Trade added', type: 'success' });
    }
    setShowAddTrade(false);
    setEditingTradeId(null);
    fetchData();
  };

  const deleteTrade = async (id) => {
    await supabase.from('scenario_trades').delete().eq('id', id);
    setToast({ message: 'Trade removed', type: 'success' });
    fetchData();
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading...</div>;

  const currentScenario = scenarios.find(s => s.id === selectedScenario);
  const currentScenarioTrades = scenarioTrades.filter(t => t.scenario_id === selectedScenario);
  const currentAlloc = getCurrentAllocation();
  const scenarioAlloc = selectedScenario ? getScenarioAllocation(selectedScenario) : null;
  const currentAssetData = toChartData(currentAlloc.assetClass, ASSET_COLORS);
  const currentRegionData = toChartData(currentAlloc.region, REGION_COLORS);
  const scenarioAssetData = scenarioAlloc ? toChartData(scenarioAlloc.assetClass, ASSET_COLORS) : [];
  const scenarioRegionData = scenarioAlloc ? toChartData(scenarioAlloc.region, REGION_COLORS) : [];
  const currentTotal = currentAssetData.reduce((s, d) => s + d.value, 0);
  const scenarioTotal = scenarioAssetData.reduce((s, d) => s + d.value, 0);
  const savingsAccounts = accounts.filter(a => a.account_type === 'savings');
  const isEquityTrade = tradeForm.trade_type === 'buy' || tradeForm.trade_type === 'sell';

  // Build aggregated holdings for risk analysis
  const positionsMap = {};
  trades.forEach(t => {
    const key = t.security_id;
    if (!positionsMap[key]) positionsMap[key] = { security_id: t.security_id, shares: 0 };
    positionsMap[key].shares += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity);
  });
  const aggregatedHoldings = [];
  const tickerAgg = {};
  Object.values(positionsMap).forEach(pos => {
    if (pos.shares <= 0.0001) return;
    const sec = secMap[pos.security_id]; if (!sec) return;
    const price = prices[sec.ticker]?.price || 0;
    const fxRate = fxRates[sec.currency] || 1;
    const valueUSD = pos.shares * price * fxRate;
    if (!tickerAgg[sec.ticker]) tickerAgg[sec.ticker] = { ticker: sec.ticker, name: sec.name, assetClass: sec.asset_class, region: sec.region, currency: sec.currency, classification: sec.classification || 'core', marketValueUSD: 0 };
    tickerAgg[sec.ticker].marketValueUSD += valueUSD;
  });
  Object.values(tickerAgg).forEach(h => aggregatedHoldings.push(h));

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Scenarios</h2>
        <p>What-if analysis and stress testing for your portfolio.</p>
      </div>

      {/* Mode Toggle */}
      <div className="filter-group" style={{ marginBottom: 24 }}>
        <button className={`filter-btn ${viewMode === 'trades' ? 'active' : ''}`} onClick={() => setViewMode('trades')}>What-If Trades</button>
        <button className={`filter-btn ${viewMode === 'stress' ? 'active' : ''}`} onClick={() => setViewMode('stress')}>Stress Test</button>
      </div>

      {/* ============ STRESS TEST MODE ============ */}
      {viewMode === 'stress' && (() => {
        const preset = STRESS_PRESETS.find(p => p.key === stressPreset);
        const curAlloc = getCurrentAllocation();
        const stressedAsset = { ...curAlloc.assetClass };
        if (preset) {
          Object.entries(preset.shocks).forEach(([ac, pct]) => {
            const label = ASSET_CLASS_LABELS[ac] || ac;
            if (stressedAsset[label]) {
              stressedAsset[label] = stressedAsset[label] * (1 + pct / 100);
              if (stressedAsset[label] < 0) stressedAsset[label] = 0;
            }
          });
        }
        const curTotal = Object.values(curAlloc.assetClass).reduce((s, v) => s + v, 0);
        const stressTotal = Object.values(stressedAsset).reduce((s, v) => s + v, 0);
        const loss = stressTotal - curTotal;

        // Per-holding impact
        const holdingsImpact = [];
        const positions = {};
        trades.forEach(t => { const key = `${t.security_id}__${t.account_id}`; if (!positions[key]) positions[key] = { security_id: t.security_id, account_id: t.account_id, shares: 0 }; positions[key].shares += t.trade_type === 'buy' ? Number(t.quantity) : -Number(t.quantity); });
        if (preset) {
          const tickerMap = {};
          Object.values(positions).forEach(pos => {
            if (pos.shares <= 0.0001) return;
            const sec = secMap[pos.security_id]; if (!sec) return;
            const price = prices[sec.ticker]?.price || 0;
            const fxRate = fxRates[sec.currency] || 1;
            const valueUSD = pos.shares * price * fxRate;
            if (!tickerMap[sec.ticker]) tickerMap[sec.ticker] = { ticker: sec.ticker, name: sec.name, assetClass: sec.asset_class, marketValueUSD: 0 };
            tickerMap[sec.ticker].marketValueUSD += valueUSD;
          });
          Object.values(tickerMap).forEach(h => {
            const shock = preset.shocks[h.assetClass] || 0;
            if (shock === 0) return;
            const lossUSD = h.marketValueUSD * (shock / 100);
            holdingsImpact.push({ ...h, shock, lossUSD, stressedValue: h.marketValueUSD + lossUSD });
          });
          holdingsImpact.sort((a, b) => a.lossUSD - b.lossUSD);
        }

        return (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
              {STRESS_PRESETS.map(p => (
                <button key={p.key} className={`filter-btn ${stressPreset === p.key ? 'active' : ''}`} onClick={() => setStressPreset(stressPreset === p.key ? null : p.key)}>{p.name}</button>
              ))}
            </div>

            {!preset ? (
              <div className="empty-state" style={{ paddingTop: 40 }}>{Icons.empty}<p style={{ fontSize: 16, maxWidth: 400, margin: '16px auto' }}>Select a stress scenario above to see the impact on your portfolio.</p></div>
            ) : (
              <>
                <div className="card" style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{preset.name} — Assumptions</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
                    {Object.entries(preset.shocks).filter(([, v]) => v !== 0).map(([ac, pct]) => (
                      <div key={ac} style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ color: 'var(--text-muted)' }}>{ASSET_CLASS_LABELS[ac] || ac}:</span>
                        <span style={{ fontWeight: 600, color: pct >= 0 ? 'var(--success)' : 'var(--danger)' }}>{pct >= 0 ? '+' : ''}{pct}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="stats-row" style={{ marginBottom: 24 }}>
                  <div className="stat-card"><div className="stat-label">Current Value</div><div className="stat-value">${fmtRound(curTotal)}</div></div>
                  <div className="stat-card"><div className="stat-label">Stressed Value</div><div className="stat-value" style={{ color: 'var(--danger)' }}>${fmtRound(stressTotal)}</div></div>
                  <div className="stat-card"><div className="stat-label">Loss</div><div className="stat-value" style={{ fontSize: 20, color: 'var(--danger)' }}>${fmtRound(loss)} ({curTotal > 0 ? (loss / curTotal * 100).toFixed(1) : 0}%)</div></div>
                </div>

                <div className="card" style={{ marginBottom: 24 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Allocation Impact</div>
                  <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                    <table>
                      <thead><tr><th>Asset Class</th><th style={{ textAlign: 'right' }}>Current $</th><th style={{ textAlign: 'right' }}>Current %</th><th style={{ textAlign: 'right' }}>Shock</th><th style={{ textAlign: 'right' }}>Stressed $</th><th style={{ textAlign: 'right' }}>Stressed %</th></tr></thead>
                      <tbody>
                        {Object.keys(stressedAsset).filter(k => stressedAsset[k] > 0 || (curAlloc.assetClass[k] || 0) > 0).sort().map(k => {
                          const cur = curAlloc.assetClass[k] || 0;
                          const str = stressedAsset[k] || 0;
                          const curPct = curTotal > 0 ? (cur / curTotal * 100) : 0;
                          const strPct = stressTotal > 0 ? (str / stressTotal * 100) : 0;
                          const acKey = k === 'Equities' ? 'equity' : k === 'Bonds' ? 'bond' : k === 'Cash / MMF' ? 'cash_mmf' : k === 'Commodities' ? 'commodity' : 'real_estate';
                          const shock = preset.shocks[acKey] || 0;
                          return (
                            <tr key={k}>
                              <td style={{ fontWeight: 500 }}>{k}</td>
                              <td style={{ textAlign: 'right' }}>${fmtRound(cur)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{curPct.toFixed(1)}%</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: shock >= 0 ? 'var(--success)' : 'var(--danger)' }}>{shock !== 0 ? `${shock > 0 ? '+' : ''}${shock}%` : '\u2014'}</td>
                              <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmtRound(str)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{strPct.toFixed(1)}%</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {holdingsImpact.length > 0 && (
                  <div className="card">
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Holdings Impact (sorted by loss)</div>
                    <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                      <table>
                        <thead><tr><th>Ticker</th><th>Name</th><th style={{ textAlign: 'right' }}>Current Value</th><th style={{ textAlign: 'right' }}>Shock</th><th style={{ textAlign: 'right' }}>Loss</th><th style={{ textAlign: 'right' }}>Stressed Value</th></tr></thead>
                        <tbody>
                          {holdingsImpact.map(h => (
                            <tr key={h.ticker}>
                              <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{h.ticker}</td>
                              <td>{h.name}</td>
                              <td style={{ textAlign: 'right' }}>${fmtRound(h.marketValueUSD)}</td>
                              <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{h.shock}%</td>
                              <td style={{ textAlign: 'right', fontWeight: 600, color: 'var(--danger)' }}>${fmtRound(h.lossUSD)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmtRound(h.stressedValue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        );
      })()}

      {/* ============ WHAT-IF TRADES MODE ============ */}
      {viewMode === 'trades' && (
      <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
        {scenarios.map(s => (
          <button key={s.id} className={`filter-btn ${selectedScenario === s.id ? 'active' : ''}`} onClick={() => setSelectedScenario(s.id)}>{s.name}</button>
        ))}
        <button className="btn btn-primary btn-sm" style={{ fontSize: 12, padding: '5px 14px' }} onClick={() => setShowNewScenario(true)}>{Icons.plus} New Scenario</button>
      </div>

      {!selectedScenario ? (
        <div className="empty-state" style={{ paddingTop: 60 }}>{Icons.empty}<p style={{ fontSize: 16, maxWidth: 400, margin: '16px auto' }}>Create a scenario to start exploring what-if trades.</p></div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>{currentScenario?.name}</div>
              {currentScenario?.description && <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{currentScenario.description}</div>}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary btn-sm" style={{ fontSize: 12, padding: '5px 14px' }} onClick={openNewTrade}>{Icons.plus} Add Trade</button>
              <button className="btn btn-secondary btn-sm" style={{ fontSize: 12, padding: '5px 14px', color: 'var(--danger)' }} onClick={() => { if (confirm('Delete this scenario?')) deleteScenario(selectedScenario); }}>Delete</button>
            </div>
          </div>

          {currentScenarioTrades.length > 0 && (
            <div className="table-container" style={{ marginBottom: 24 }}>
              <table>
                <thead><tr><th>Type</th><th>Details</th><th style={{ textAlign: 'right' }}>Value (USD)</th><th style={{ width: 40 }}></th></tr></thead>
                <tbody>
                  {currentScenarioTrades.map(t => {
                    let details = '', valueUSD = 0;
                    if (t.trade_type === 'buy' || t.trade_type === 'sell') {
                      const fxRate = fxRates[t.currency] || 1;
                      valueUSD = Number(t.quantity) * Number(t.price) * fxRate;
                      details = `${t.ticker} — ${Number(t.quantity)} shares @ ${t.currency} ${fmt(t.price)}`;
                    } else {
                      const acc = accMap[t.account_id];
                      const fxRate = acc ? (fxRates[acc.currency] || 1) : 1;
                      valueUSD = Number(t.amount) * fxRate;
                      details = `${acc?.name || 'Unknown'} — ${acc?.currency || ''} ${fmtRound(t.amount)}`;
                    }
                    return (
                      <tr key={t.id} onClick={() => openEditTrade(t)} style={{ cursor: 'pointer' }}>
                        <td>
                          <span className={`badge ${t.trade_type === 'buy' ? 'badge-equity' : t.trade_type === 'sell' ? 'badge-commodity' : t.trade_type === 'savings_deposit' ? 'badge-cash_mmf' : 'badge-bond'}`}>
                            {t.trade_type === 'savings_deposit' ? 'Deposit' : t.trade_type === 'savings_withdrawal' ? 'Withdraw' : t.trade_type.charAt(0).toUpperCase() + t.trade_type.slice(1)}
                          </span>
                        </td>
                        <td style={{ fontSize: 13 }}>{details}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmtRound(valueUSD)}</td>
                        <td>
                          <button onClick={(e) => { e.stopPropagation(); deleteTrade(t.id); }} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 16, padding: 4 }}>×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <div className="stats-row" style={{ marginBottom: 16 }}>
            <div className="stat-card"><div className="stat-label">Current Portfolio</div><div className="stat-value">${fmtRound(currentTotal)}</div></div>
            <div className="stat-card"><div className="stat-label">After Scenario</div><div className="stat-value" style={{ color: 'var(--accent)' }}>${fmtRound(scenarioTotal)}</div></div>
            <div className="stat-card"><div className="stat-label">Difference</div><div className="stat-value" style={{ fontSize: 20, color: scenarioTotal - currentTotal >= 0 ? 'var(--success)' : 'var(--danger)' }}>{scenarioTotal - currentTotal >= 0 ? '+' : ''}${fmtRound(scenarioTotal - currentTotal)}</div></div>
          </div>

          {/* Scenario Risk Impact */}
          {currentScenarioTrades.length > 0 && (() => {
            const BROAD_INDEXES = ['SPY','QQQ','VTI','VXUS','IVV','VOO','VEA','VWO','CSPX','VWRL','VWRP','IWDA','SWRD','EIMI','AGG','BND','VT','SCHB','ITOT','SPDW'];

            // Build scenario holdings
            const scenarioHoldings = {};
            aggregatedHoldings.forEach(h => { scenarioHoldings[h.ticker] = { ...h, scenarioValue: h.marketValueUSD }; });
            currentScenarioTrades.forEach(t => {
              if (t.trade_type === 'buy' || t.trade_type === 'sell') {
                const fxRate = fxRates[t.currency] || 1;
                const valueUSD = Number(t.quantity) * Number(t.price) * fxRate;
                if (!scenarioHoldings[t.ticker]) {
                  scenarioHoldings[t.ticker] = { ticker: t.ticker, name: t.security_name || t.ticker, assetClass: t.asset_class, region: t.region, currency: t.currency, classification: t.classification || 'core', marketValueUSD: 0, scenarioValue: 0 };
                }
                scenarioHoldings[t.ticker].scenarioValue += t.trade_type === 'buy' ? valueUSD : -valueUSD;
              }
            });

            // VaR calculation
            let currentVaR = 0, scenarioVaR = 0;
            const positionChanges = [];
            Object.values(scenarioHoldings).forEach(h => {
              if (h.assetClass === 'cash_mmf') return;
              const vol = volatilityData[h.ticker];
              const dailyVol = vol?.daily || 0;
              const curVaR = h.marketValueUSD * (dailyVol / 100) * 1.65;
              const scnVaR = Math.max(0, h.scenarioValue) * (dailyVol / 100) * 1.65;
              currentVaR += curVaR;
              scenarioVaR += scnVaR;

              const curWeight = currentTotal > 0 ? (h.marketValueUSD / currentTotal * 100) : 0;
              const scnWeight = scenarioTotal > 0 ? (h.scenarioValue / scenarioTotal * 100) : 0;
              if (Math.abs(scnWeight - curWeight) > 0.1 || h.marketValueUSD === 0) {
                const isBroad = BROAD_INDEXES.includes(h.ticker);
                const varContribPct = scenarioVaR > 0 ? (scnVaR / scenarioVaR * 100) : 0;
                const isHighVaR = varContribPct > 5 && dailyVol > 0;

                let sizeLabel, sizeColor;
                if (scnWeight < 2) {
                  sizeLabel = 'Too small to matter'; sizeColor = 'var(--text-muted)';
                } else if (scnWeight < 5) {
                  sizeLabel = 'Minor position'; sizeColor = 'var(--text-secondary)';
                } else if (scnWeight < 15) {
                  if (isHighVaR && !isBroad) { sizeLabel = 'Small but volatile — watch'; sizeColor = '#fbbf24'; }
                  else { sizeLabel = isBroad ? 'Core position' : 'Meaningful'; sizeColor = 'var(--success)'; }
                } else if (scnWeight < 25) {
                  if (isBroad) { sizeLabel = 'Concentrated but diversified'; sizeColor = '#fbbf24'; }
                  else if (isHighVaR) { sizeLabel = 'High risk concentration'; sizeColor = 'var(--danger)'; }
                  else { sizeLabel = 'Concentrated, low volatility'; sizeColor = '#fbbf24'; }
                } else {
                  if (isBroad) { sizeLabel = 'Overweight — broad index'; sizeColor = '#fbbf24'; }
                  else { sizeLabel = 'Overweight — review'; sizeColor = 'var(--danger)'; }
                }
                positionChanges.push({ ticker: h.ticker, name: h.name, curWeight, scnWeight, sizeLabel, sizeColor, annualVol: vol?.annual || null, varContribPct, isBroad });
              }
            });

            // Similar exposure warnings
            const scenarioByClassRegion = {};
            Object.values(scenarioHoldings).forEach(h => {
              if (h.scenarioValue <= 0 || h.assetClass === 'cash_mmf') return;
              const key = `${h.assetClass}__${h.region}`;
              if (!scenarioByClassRegion[key]) scenarioByClassRegion[key] = [];
              scenarioByClassRegion[key].push(h);
            });
            const similarWarnings = Object.values(scenarioByClassRegion).filter(group => group.length > 1).map(group => {
              const combined = group.reduce((s, h) => s + h.scenarioValue, 0);
              const pct = scenarioTotal > 0 ? (combined / scenarioTotal * 100).toFixed(1) : 0;
              return { tickers: group.map(h => h.ticker), combined: pct, assetClass: group[0].assetClass, region: group[0].region };
            });

            // Holdings allocation: scenario holdings breakdown by ticker
            const holdingsAlloc = Object.values(scenarioHoldings)
              .filter(h => h.scenarioValue > 0)
              .sort((a, b) => b.scenarioValue - a.scenarioValue);

            return (
              <div className="card" style={{ marginBottom: 24 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Scenario Risk Impact</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16, marginBottom: 20 }}>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Current VaR (95%)</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-primary)' }}>${fmtRound(currentVaR)}/day</div>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Scenario VaR (95%)</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: scenarioVaR > currentVaR ? 'var(--danger)' : 'var(--success)' }}>${fmtRound(scenarioVaR)}/day</div>
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 14, textAlign: 'center' }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>VaR Change</div>
                    <div style={{ fontSize: 18, fontWeight: 600, color: scenarioVaR - currentVaR > 0 ? 'var(--danger)' : 'var(--success)' }}>
                      {scenarioVaR - currentVaR >= 0 ? '+' : ''}${fmtRound(scenarioVaR - currentVaR)}
                    </div>
                  </div>
                </div>

                {positionChanges.length > 0 && (
                  <div className="table-container" style={{ border: 'none', borderRadius: 0, marginBottom: 12 }}>
                    <table>
                      <thead><tr><th>Ticker</th><th>Name</th><th style={{ textAlign: 'right' }}>Current %</th><th style={{ textAlign: 'right' }}>Scenario %</th><th style={{ textAlign: 'right' }}>Ann. Vol</th><th style={{ textAlign: 'right' }}>VaR Contrib</th><th style={{ textAlign: 'right' }}>Assessment</th></tr></thead>
                      <tbody>
                        {positionChanges.sort((a, b) => b.scnWeight - a.scnWeight).map(p => (
                          <tr key={p.ticker}>
                            <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{p.ticker}{p.isBroad && <span style={{ fontSize: 10, color: 'var(--accent)', marginLeft: 4 }}>idx</span>}</td>
                            <td>{p.name}</td>
                            <td style={{ textAlign: 'right' }}>{p.curWeight.toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', fontWeight: 500, color: 'var(--accent)' }}>{p.scnWeight.toFixed(1)}%</td>
                            <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{p.annualVol ? `${p.annualVol.toFixed(1)}%` : '\u2014'}</td>
                            <td style={{ textAlign: 'right', color: 'var(--text-secondary)' }}>{p.varContribPct > 0 ? `${p.varContribPct.toFixed(1)}%` : '\u2014'}</td>
                            <td style={{ textAlign: 'right' }}><span style={{ fontSize: 12, fontWeight: 600, color: p.sizeColor }}>{p.sizeLabel}</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {similarWarnings.length > 0 && (
                  <div style={{ fontSize: 13, color: '#fbbf24', padding: '8px 12px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(251, 191, 36, 0.2)', marginBottom: 16 }}>
                    {similarWarnings.map((w, i) => (
                      <div key={i} style={{ marginBottom: i < similarWarnings.length - 1 ? 4 : 0 }}>
                        Similar exposure: {w.tickers.join(' + ')} ({ASSET_CLASS_LABELS[w.assetClass]}, {w.region}) - combined {w.combined}% of portfolio
                      </div>
                    ))}
                  </div>
                )}

                {/* Holdings allocation breakdown */}
                {holdingsAlloc.length > 0 && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10, marginTop: 4 }}>Holdings Allocation</div>
                    <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
                      <table>
                        <thead><tr><th>Ticker</th><th>Name</th><th>Region</th><th style={{ textAlign: 'right' }}>Value (USD)</th><th style={{ textAlign: 'right' }}>Weight</th></tr></thead>
                        <tbody>
                          {[
                            { label: 'CORE EQUITIES', items: holdingsAlloc.filter(h => h.assetClass === 'equity' && h.classification !== 'thematic') },
                            { label: 'THEMATIC EQUITIES', items: holdingsAlloc.filter(h => h.assetClass === 'equity' && h.classification === 'thematic') },
                            { label: 'COMMODITIES', items: holdingsAlloc.filter(h => h.assetClass === 'commodity') },
                            { label: 'CASH / MMF', items: holdingsAlloc.filter(h => h.assetClass === 'cash_mmf') },
                            { label: 'OTHER', items: holdingsAlloc.filter(h => !['equity','commodity','cash_mmf'].includes(h.assetClass)) },
                          ].filter(g => g.items.length > 0).map((group, gi) => (
                            <React.Fragment key={group.label}>
                              <tr>
                                <td colSpan={5} style={{ background: 'var(--bg-secondary)', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.08em', padding: '6px 12px' }}>{group.label}</td>
                              </tr>
                              {group.items.map(h => (
                                <tr key={h.ticker}>
                                  <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{h.ticker}</td>
                                  <td style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{h.name}</td>
                                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{h.region}</td>
                                  <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmtRound(h.scenarioValue)}</td>
                                  <td style={{ textAlign: 'right', color: 'var(--accent)', fontWeight: 500 }}>{scenarioTotal > 0 ? (h.scenarioValue / scenarioTotal * 100).toFixed(1) : 0}%</td>
                                </tr>
                              ))}
                            </React.Fragment>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            );
          })()}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 24 }}>
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16, textAlign: 'center' }}>By Asset Class</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <PieChartCard title="Current" data={currentAssetData} />
                <PieChartCard title="Scenario" data={scenarioAssetData} />
              </div>
            </div>
            <div className="card">
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16, textAlign: 'center' }}>By Region</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
                <PieChartCard title="Current" data={currentRegionData} />
                <PieChartCard title="Scenario" data={scenarioRegionData} />
              </div>
            </div>
          </div>

          <div className="card">
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Allocation Comparison</div>
            <div className="table-container" style={{ border: 'none', borderRadius: 0 }}>
              <table>
                <thead><tr><th>Asset Class</th><th style={{ textAlign: 'right' }}>Current $</th><th style={{ textAlign: 'right' }}>Current %</th><th style={{ textAlign: 'right' }}>Scenario $</th><th style={{ textAlign: 'right' }}>Scenario %</th><th style={{ textAlign: 'right' }}>Change</th></tr></thead>
                <tbody>
                  {[...new Set([...Object.keys(currentAlloc.assetClass), ...Object.keys(scenarioAlloc?.assetClass || {})])].sort().map(k => {
                    const cur = currentAlloc.assetClass[k] || 0;
                    const scn = scenarioAlloc?.assetClass[k] || 0;
                    const curPct = currentTotal > 0 ? (cur / currentTotal * 100) : 0;
                    const scnPct = scenarioTotal > 0 ? (scn / scenarioTotal * 100) : 0;
                    const diff = scnPct - curPct;
                    return (
                      <tr key={k}>
                        <td style={{ fontWeight: 500 }}>{k}</td>
                        <td style={{ textAlign: 'right' }}>${fmtRound(cur)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--text-muted)' }}>{curPct.toFixed(1)}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmtRound(scn)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{scnPct.toFixed(1)}%</td>
                        <td style={{ textAlign: 'right', fontWeight: 600, color: diff > 0 ? 'var(--success)' : diff < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>{diff > 0 ? '+' : ''}{diff.toFixed(1)}pp</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Holdings from/to allocation chart */}
          {(() => {
            const RELEVANT_CLASSES = ['equity', 'commodity', 'cash_mmf'];
            const allHoldings = aggregatedHoldings.filter(h => RELEVANT_CLASSES.includes(h.assetClass));
            // Merge scenario trades into holdings
            const scenarioMap = {};
            allHoldings.forEach(h => { scenarioMap[h.ticker] = { ...h, scenarioValue: h.marketValueUSD }; });
            currentScenarioTrades.forEach(t => {
              if (t.trade_type !== 'buy' && t.trade_type !== 'sell') return;
              const fxRate = fxRates[t.currency] || 1;
              const val = Number(t.quantity) * Number(t.price) * fxRate;
              if (!scenarioMap[t.ticker]) {
                if (!RELEVANT_CLASSES.includes(t.asset_class)) return;
                scenarioMap[t.ticker] = { ticker: t.ticker, name: t.security_name || t.ticker, assetClass: t.asset_class, marketValueUSD: 0, scenarioValue: 0 };
              }
              scenarioMap[t.ticker].scenarioValue += t.trade_type === 'buy' ? val : -val;
            });

            const byClass = {};
            Object.values(scenarioMap).forEach(h => {
              if (!byClass[h.assetClass]) byClass[h.assetClass] = [];
              byClass[h.assetClass].push(h);
            });

            return Object.entries(byClass).map(([cls, items]) => {
              const label = ASSET_CLASS_LABELS[cls] || cls;
              const chartData = items
                .filter(h => h.marketValueUSD > 0 || h.scenarioValue > 0)
                .sort((a, b) => b.scenarioValue - a.scenarioValue)
                .map(h => ({
                  ticker: h.ticker,
                  current: currentTotal > 0 ? parseFloat((h.marketValueUSD / currentTotal * 100).toFixed(1)) : 0,
                  scenario: scenarioTotal > 0 ? parseFloat((Math.max(0, h.scenarioValue) / scenarioTotal * 100).toFixed(1)) : 0,
                }));
              if (chartData.length === 0) return null;
              const chartHeight = Math.max(120, chartData.length * 36 + 40);
              return (
                <div key={cls} className="card" style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>{label} — Holdings Allocation</div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 2, background: '#4f7df5', display: 'inline-block' }} /> Current</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 12, height: 12, borderRadius: 2, background: '#34d399', display: 'inline-block' }} /> Scenario</span>
                  </div>
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 40, top: 0, bottom: 0 }} barCategoryGap="30%">
                      <XAxis type="number" domain={[0, 'auto']} tickFormatter={v => `${v}%`} tick={{ fontSize: 11, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="ticker" tick={{ fontSize: 12, fontFamily: 'monospace', fill: 'var(--text-primary)' }} axisLine={false} tickLine={false} width={60} />
                      <Tooltip formatter={(v, n) => [`${v}%`, n === 'current' ? 'Current' : 'Scenario']} contentStyle={{ background: '#1a2236', border: '1px solid #2a3654', borderRadius: 8, fontSize: 12 }} />
                      <Bar dataKey="current" fill="#4f7df5" radius={[0, 3, 3, 0]}>
                        <LabelList dataKey="current" position="right" formatter={v => v > 0 ? `${v}%` : ''} style={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                      </Bar>
                      <Bar dataKey="scenario" fill="#34d399" radius={[0, 3, 3, 0]}>
                        <LabelList dataKey="scenario" position="right" formatter={v => v > 0 ? `${v}%` : ''} style={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              );
            });
          })()}

          <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
            <strong>How it works:</strong> Equity buys increase the target asset class. Equity sells reduce that class and add proceeds to Cash/MMF. Savings withdrawals reduce Cash/MMF. Savings deposits increase Cash/MMF. To model "withdraw $20K savings and buy equities", add both a savings withdrawal and an equity buy.
          </div>
        </>
      )}

      {/* New Scenario Modal */}
      {showNewScenario && (
        <div className="modal-overlay" onClick={() => setShowNewScenario(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Scenario</h3>
            <div className="form-group"><label className="form-label">Scenario Name</label><input className="form-input" value={newScenarioName} onChange={e => setNewScenarioName(e.target.value)} placeholder="e.g. Rebalance to US equities" /></div>
            <div className="form-group"><label className="form-label">Description (optional)</label><input className="form-input" value={newScenarioDesc} onChange={e => setNewScenarioDesc(e.target.value)} placeholder="What does this scenario explore?" /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowNewScenario(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createScenario} disabled={!newScenarioName.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Trade Modal */}
      {showAddTrade && (
        <div className="modal-overlay" style={{ alignItems: 'flex-start', paddingTop: Math.max(20, window.scrollY + 40) }} onClick={() => { setShowAddTrade(false); setEditingTradeId(null); }}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}>
            <h3>{editingTradeId ? 'Edit Trade' : 'Add Hypothetical Trade'}</h3>
            <div className="form-group">
              <label className="form-label">Trade Type</label>
              <select className="form-select" value={tradeForm.trade_type} onChange={e => setTradeForm({ ...tradeForm, trade_type: e.target.value })}>
                <option value="buy">Buy Equity</option>
                <option value="sell">Sell Equity</option>
                <option value="savings_withdrawal">Withdraw from Savings</option>
                <option value="savings_deposit">Deposit to Savings</option>
              </select>
            </div>

            {isEquityTrade ? (
              <>
                <div className="form-group">
                  <label className="form-label">Ticker</label>
                  <input className="form-input" value={tradeForm.ticker} onChange={e => { setTradeForm({ ...tradeForm, ticker: e.target.value.toUpperCase() }); searchTicker(e.target.value); }} placeholder="Search ticker..." />
                  {tickerSearchResults.length > 0 && (
                    <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', maxHeight: 150, overflowY: 'auto', marginTop: 4 }}>
                      {tickerSearchResults.map(r => (
                        <div key={r.symbol} onClick={() => { setTradeForm({ ...tradeForm, ticker: r.symbol, security_name: r.name, currency: r.currency || 'USD' }); setTickerSearchResults([]); fetchTickerPrice(r.symbol); }}
                          style={{ padding: '8px 12px', cursor: 'pointer', fontSize: 13, borderBottom: '1px solid var(--border)' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                          onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                          <strong>{r.symbol}</strong> — {r.name}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {tradeForm.security_name && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>{tradeForm.security_name}</div>}
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Quantity</label><input className="form-input" type="number" step="any" value={tradeForm.quantity} onChange={e => setTradeForm({ ...tradeForm, quantity: e.target.value })} placeholder="100" /></div>
                  <div className="form-group"><label className="form-label">Price ({tradeForm.currency})</label><input className="form-input" type="number" step="any" value={tradeForm.price} onChange={e => setTradeForm({ ...tradeForm, price: e.target.value })} placeholder="58.00" /></div>
                </div>
                {tradeForm.quantity && tradeForm.price && (
                  <div style={{ background: 'var(--accent-glow)', border: '1px solid rgba(79,125,245,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 12, fontSize: 14 }}>
                    Total: <strong>{tradeForm.currency} {fmtRound(parseFloat(tradeForm.quantity) * parseFloat(tradeForm.price))}</strong>
                    {tradeForm.currency !== 'USD' && fxRates[tradeForm.currency] && (
                      <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>\u2248 USD {fmtRound(parseFloat(tradeForm.quantity) * parseFloat(tradeForm.price) * fxRates[tradeForm.currency])}</span>
                    )}
                  </div>
                )}
                <div className="form-row">
                  <div className="form-group"><label className="form-label">Asset Class</label><select className="form-select" value={tradeForm.asset_class} onChange={e => setTradeForm({ ...tradeForm, asset_class: e.target.value })}>{ASSET_CLASSES.map(ac => <option key={ac} value={ac}>{ASSET_CLASS_LABELS[ac]}</option>)}</select></div>
                  <div className="form-group"><label className="form-label">Region</label><select className="form-select" value={tradeForm.region} onChange={e => setTradeForm({ ...tradeForm, region: e.target.value })}>{REGIONS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
                </div>
              </>
            ) : (
              <>
                <div className="form-group"><label className="form-label">Savings Account</label><select className="form-select" value={tradeForm.account_id} onChange={e => setTradeForm({ ...tradeForm, account_id: e.target.value })}><option value="">Select account...</option>{savingsAccounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.currency})</option>)}</select></div>
                <div className="form-group"><label className="form-label">Amount</label><input className="form-input" type="number" step="any" value={tradeForm.amount} onChange={e => setTradeForm({ ...tradeForm, amount: e.target.value })} placeholder="20000" /></div>
              </>
            )}

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => { setShowAddTrade(false); setEditingTradeId(null); }}>Cancel</button>
              <button className="btn btn-primary" onClick={saveTrade} disabled={isEquityTrade ? (!tradeForm.ticker || !tradeForm.quantity || !tradeForm.price) : (!tradeForm.account_id || !tradeForm.amount)}>
                {editingTradeId ? 'Update' : 'Add Trade'}
              </button>
            </div>
          </div>
        </div>
      )}

      </>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
