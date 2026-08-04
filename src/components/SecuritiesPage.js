import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { ASSET_CLASSES, REGIONS, CURRENCIES, ASSET_CLASS_LABELS } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';

export default function SecuritiesPage({ user }) {
  const [securities, setSecurities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ ticker: '', name: '', asset_class: 'equity', region: 'US', currency: 'USD', exposure_currency: '', target_profit_pct: '', classification: 'core' });

  // Ticker search state
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchTimeout = useRef(null);
  const dropdownRef = useRef(null);

  const fetchSecurities = useCallback(async () => {
    const { data } = await supabase.from('securities').select('*').eq('user_id', user.id).order('ticker');
    setSecurities(data || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetchSecurities(); }, [fetchSecurities]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Search ticker on Yahoo Finance with debounce
  const handleTickerChange = (value) => {
    setForm({ ...form, ticker: value });
    
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    if (value.length < 1) {
      setSearchResults([]);
      setShowDropdown(false);
      return;
    }

    setSearchLoading(true);
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/search-ticker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: value }),
        });
        const data = await res.json();
        setSearchResults(data.results || []);
        setShowDropdown(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
  };

  const selectTicker = (result) => {
    // Auto-detect currency from exchange
    let currency = form.currency;
    const exchange = (result.exchange || '').toLowerCase();
    if (exchange.includes('toronto') || result.symbol.endsWith('.TO') || result.symbol.endsWith('.V')) currency = 'CAD';
    else if (exchange.includes('london') || result.symbol.endsWith('.L')) currency = 'GBP';
    else if (exchange.includes('paris') || exchange.includes('xetra') || exchange.includes('frankfurt') || exchange.includes('amsterdam')) currency = 'EUR';
    else if (exchange.includes('nasdaq') || exchange.includes('nyse') || exchange.includes('nysearca') || exchange.includes('cboe')) currency = 'USD';
    else if (exchange.includes('zurich') || exchange.includes('swiss')) currency = 'CHF';
    else if (exchange.includes('tokyo')) currency = 'JPY';
    else if (exchange.includes('sydney') || exchange.includes('asx')) currency = 'AUD';

    // Auto-detect region
    let region = form.region;
    if (currency === 'USD') region = 'US';
    else if (currency === 'CAD') region = 'Canada';
    else if (['GBP', 'EUR', 'CHF'].includes(currency)) region = 'Europe';

    // Auto-detect asset class for commodities
    let assetClass = form.asset_class;
    if (result.type === 'COMMODITY') assetClass = 'commodity';

    setForm({
      ...form,
      ticker: result.symbol,
      name: result.name,
      currency,
      region,
      asset_class: assetClass,
    });
    setShowDropdown(false);
  };

  const openNew = () => { setEditing(null); setForm({ ticker: '', name: '', asset_class: 'equity', region: 'US', currency: 'USD', exposure_currency: '', target_profit_pct: '', classification: 'core' }); setSearchResults([]); setShowModal(true); };
  const openEdit = (sec) => { setEditing(sec); setForm({ ticker: sec.ticker, name: sec.name, asset_class: sec.asset_class, region: sec.region, currency: sec.currency, exposure_currency: sec.exposure_currency || '', target_profit_pct: (sec.target_profit_pct !== null && sec.target_profit_pct !== undefined) ? String(sec.target_profit_pct) : '', classification: sec.classification || 'core' }); setShowModal(true); };
  const handleSave = async () => {
    const payload = { ...form, ticker: form.ticker.toUpperCase(), user_id: user.id };
    if (payload.classification === 'thematic' && (!payload.target_profit_pct || payload.target_profit_pct === '')) {
      alert('Thematic securities require a target profit %.');
      return;
    }
    if (!payload.exposure_currency) payload.exposure_currency = payload.currency;
    payload.target_profit_pct = payload.target_profit_pct !== '' && payload.target_profit_pct !== null ? parseFloat(payload.target_profit_pct) : null;
    if (editing) {
      await supabase.from('securities').update(payload).eq('id', editing.id);
      setToast({ message: 'Security updated', type: 'success' });
    } else {
      const { error } = await supabase.from('securities').insert(payload);
      if (error && error.message.includes('duplicate')) { setToast({ message: 'This ticker already exists', type: 'error' }); return; }
      setToast({ message: 'Security added', type: 'success' });
    }
    setShowModal(false);
    fetchSecurities();
  };
  const handleDelete = async (id) => {
    if (!confirm('Delete this security? Any trades for it will also be deleted.')) return;
    await supabase.from('securities').delete().eq('id', id);
    setToast({ message: 'Security deleted', type: 'success' });
    fetchSecurities();
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading securities...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Securities</h2>
        <p>Your master list of tickers. Search by name or ticker to auto-fill details.</p>
      </div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Securities</div><div className="stat-value">{securities.length}</div></div>
        <div className="stat-card"><div className="stat-label">Equities</div><div className="stat-value">{securities.filter(s => s.asset_class === 'equity').length}</div></div>
        <div className="stat-card"><div className="stat-label">Bonds</div><div className="stat-value">{securities.filter(s => s.asset_class === 'bond').length}</div></div>
        <div className="stat-card"><div className="stat-label">Cash / MMF</div><div className="stat-value">{securities.filter(s => s.asset_class === 'cash_mmf').length}</div></div>
        <div className="stat-card"><div className="stat-label">Commodities</div><div className="stat-value">{securities.filter(s => s.asset_class === 'commodity').length}</div></div>
      </div>
      <div className="action-row"><div /><button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Security</button></div>
      {securities.length === 0 ? (
        <div className="empty-state">{Icons.empty}<p>No securities yet. Add the tickers you hold.</p><button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Security</button></div>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Ticker</th><th>Name</th><th>Asset Class</th><th>Region</th><th>Currency</th><th style={{width: 80}}></th></tr></thead>
            <tbody>
              {securities.map(sec => (
                <tr key={sec.id}>
                  <td style={{ fontWeight: 600, fontFamily: 'monospace', letterSpacing: '0.04em' }}>{sec.ticker}</td>
                  <td>{sec.name}</td>
                  <td><span className={`badge badge-${sec.asset_class}`}>{ASSET_CLASS_LABELS[sec.asset_class]}</span></td>
                  <td><span className={`badge badge-${sec.region.toLowerCase()}`}>{sec.region}</span></td>
                  <td>{sec.currency}</td>
                  <td><span style={{ display: 'flex', gap: 4 }}><button className="btn-icon" onClick={() => openEdit(sec)}>{Icons.edit}</button><button className="btn-icon danger" onClick={() => handleDelete(sec.id)}>{Icons.trash}</button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? 'Edit Security' : 'New Security'}</h3>
            
            {/* Ticker Search Field */}
            <div className="form-group" ref={dropdownRef} style={{ position: 'relative' }}>
              <label className="form-label">Ticker — type to search Yahoo Finance</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="form-input"
                  value={form.ticker}
                  onChange={e => handleTickerChange(e.target.value)}
                  onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
                  placeholder='Type ticker or company name (e.g. "AAPL" or "Apple")'
                  style={{ textTransform: 'uppercase', fontFamily: 'monospace' }}
                  autoComplete="off"
                />
                {searchLoading && (
                  <div style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)' }}>
                    <div className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  </div>
                )}
              </div>
              
              {/* Search Results Dropdown */}
              {showDropdown && searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', marginTop: 4,
                  maxHeight: 280, overflowY: 'auto', boxShadow: 'var(--shadow-lg)',
                }}>
                  {searchResults.map((r, i) => (
                    <div
                      key={i}
                      onClick={() => selectTicker(r)}
                      style={{
                        padding: '10px 14px', cursor: 'pointer',
                        borderBottom: i < searchResults.length - 1 ? '1px solid rgba(42,54,84,0.5)' : 'none',
                        transition: 'background 0.15s',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 14, color: 'var(--accent)' }}>{r.symbol}</span>
                          <span style={{ fontSize: 13, color: 'var(--text-primary)', marginLeft: 10 }}>{r.name}</span>
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', flexShrink: 0, marginLeft: 8 }}>{r.exchange}</span>
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{r.type}</div>
                    </div>
                  ))}
                </div>
              )}
              
              {showDropdown && searchResults.length === 0 && !searchLoading && form.ticker.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10,
                  background: 'var(--bg-secondary)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', marginTop: 4, padding: '12px 14px',
                  fontSize: 13, color: 'var(--text-muted)',
                }}>
                  No results found. You can still enter the ticker manually.
                </div>
              )}
            </div>

            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder='Auto-filled from search, or type manually' />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-select" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Region</label>
                <select className="form-select" value={form.region} onChange={e => setForm({ ...form, region: e.target.value })}>
                  {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">Asset Class</label>
              <select className="form-select" value={form.asset_class} onChange={e => setForm({ ...form, asset_class: e.target.value })}>
                {ASSET_CLASSES.map(a => <option key={a} value={a}>{ASSET_CLASS_LABELS[a]}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Currency Exposure</label>
              <select className="form-select" value={form.exposure_currency || form.currency} onChange={e => setForm({ ...form, exposure_currency: e.target.value })}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Defaults to instrument currency. Change for unhedged ETFs (e.g., XUS.TO trades in CAD but has USD exposure).</div>
            </div>
            <div className="form-group">
              <label className="form-label">Target Profit % {form.classification === 'thematic' ? <span style={{ color: 'var(--danger)', fontSize: 11 }}>* required for thematic</span> : <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>(optional)</span>}</label>
              <input className="form-input" type="number" min="1" max="1000" value={form.target_profit_pct} onChange={e => setForm({ ...form, target_profit_pct: e.target.value })} placeholder="e.g. 50 for +50% from avg cost" />
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Alert when position is up this % from average cost.</div>
            </div>
            <div className="form-group">
              <label className="form-label">Classification</label>
              <select className="form-select" value={form.classification} onChange={e => setForm({ ...form, classification: e.target.value })}>
                <option value="core">Core — long-term hold</option>
                <option value="thematic">Thematic — has a target exit</option>
              </select>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.ticker || !form.name}>{editing ? 'Save Changes' : 'Add Security'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
