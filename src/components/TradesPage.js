import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { CURRENCIES, fmt } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';

export default function TradesPage({ user }) {
  const [trades, setTrades] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [securities, setSecurities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ account_id: '', security_id: '', trade_type: 'buy', trade_date: new Date().toISOString().slice(0, 10), quantity: '', price: '', fees: '0', currency: 'USD', notes: '' });

  const fetchAll = useCallback(async () => {
    const [tRes, aRes, sRes] = await Promise.all([
      supabase.from('trades').select('*, accounts(name), securities(ticker, name)').eq('user_id', user.id).order('trade_date', { ascending: false }),
      supabase.from('accounts').select('*').eq('user_id', user.id).eq('account_type', 'brokerage').order('name'),
      supabase.from('securities').select('*').eq('user_id', user.id).order('ticker'),
    ]);
    setTrades(tRes.data || []);
    setAccounts(aRes.data || []);
    setSecurities(sRes.data || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openNew = () => {
    setEditing(null);
    setForm({ account_id: accounts[0]?.id || '', security_id: securities[0]?.id || '', trade_type: 'buy', trade_date: new Date().toISOString().slice(0, 10), quantity: '', price: '', fees: '0', currency: 'USD', notes: '' });
    setShowModal(true);
  };
  const openEdit = (t) => {
    setEditing(t);
    setForm({ account_id: t.account_id, security_id: t.security_id, trade_type: t.trade_type, trade_date: t.trade_date, quantity: String(t.quantity), price: String(t.price), fees: String(t.fees || 0), currency: t.currency, notes: t.notes || '' });
    setShowModal(true);
  };
  const handleSave = async () => {
    const sec = securities.find(s => s.id === form.security_id);
    const currency = sec?.currency || form.currency || 'USD';
    const payload = { ...form, quantity: parseFloat(form.quantity), price: parseFloat(form.price), fees: parseFloat(form.fees || 0), user_id: user.id };

    // Auto-fetch FX rate for trade date
    let fxRate = 1;
    if (currency !== 'USD') {
      try {
        const res = await fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies: [currency] }) });
        const data = await res.json();
        fxRate = data.rates?.[currency] || 1;
      } catch {}
    }
    payload.fx_rate_to_usd = fxRate;

    let tradeId;
    if (editing) {
      await supabase.from('trades').update(payload).eq('id', editing.id);
      tradeId = editing.id;
      // Delete old auto-generated cash flow for this trade
      await supabase.from('cash_flows').delete().eq('user_id', user.id).eq('notes', `auto:trade:${editing.id}`);
      setToast({ message: 'Trade updated', type: 'success' });
    } else {
      const { data } = await supabase.from('trades').insert(payload).select().single();
      tradeId = data?.id;
      setToast({ message: 'Trade recorded', type: 'success' });
    }

    // Auto-create matching cash flow
    if (tradeId && form.account_id) {
      const tradeAmount = parseFloat(form.quantity) * parseFloat(form.price) + parseFloat(form.fees || 0);
      await supabase.from('cash_flows').insert({
        user_id: user.id,
        account_id: form.account_id,
        flow_type: form.trade_type === 'buy' ? 'deposit' : 'withdrawal',
        amount: tradeAmount,
        currency: currency,
        flow_date: form.trade_date,
        notes: `auto:trade:${tradeId}`,
      });
    }

    setShowModal(false);
    fetchAll();
  };
  const handleDelete = async (id) => {
    if (!confirm('Delete this trade?')) return;
    await supabase.from('trades').delete().eq('id', id);
    setToast({ message: 'Trade deleted', type: 'success' });
    fetchAll();
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading trades...</div>;

  const needsSetup = accounts.length === 0 || securities.length === 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Trades</h2>
        <p>Record your buy and sell transactions.</p>
      </div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Trades</div><div className="stat-value">{trades.length}</div></div>
        <div className="stat-card"><div className="stat-label">Buys</div><div className="stat-value">{trades.filter(t => t.trade_type === 'buy').length}</div></div>
        <div className="stat-card"><div className="stat-label">Sells</div><div className="stat-value">{trades.filter(t => t.trade_type === 'sell').length}</div></div>
      </div>
      {needsSetup ? (
        <div className="empty-state">
          {Icons.alert}
          <p>Before adding trades, you need at least one brokerage account and one security.<br/>Go to <strong>Accounts</strong> and <strong>Securities</strong> first.</p>
        </div>
      ) : (
        <>
          <div className="action-row"><div /><button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Trade</button></div>
          {trades.length === 0 ? (
            <div className="empty-state">{Icons.empty}<p>No trades yet. Record your first buy or sell.</p><button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Trade</button></div>
          ) : (
            <div className="table-container">
              <table>
                <thead><tr><th>Date</th><th>Type</th><th>Ticker</th><th>Account</th><th>Qty</th><th>Price</th><th>Total</th><th>Fees</th><th style={{width: 80}}></th></tr></thead>
                <tbody>
                  {trades.map(t => (
                    <tr key={t.id}>
                      <td>{t.trade_date}</td>
                      <td><span className={`badge badge-${t.trade_type}`}>{t.trade_type.toUpperCase()}</span></td>
                      <td style={{ fontWeight: 600, fontFamily: 'monospace' }}>{t.securities?.ticker || '—'}</td>
                      <td>{t.accounts?.name || '—'}</td>
                      <td>{fmt(t.quantity)}</td>
                      <td>{t.currency} {fmt(t.price)}</td>
                      <td style={{ fontWeight: 500 }}>{t.currency} {fmt(t.quantity * t.price)}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{t.fees > 0 ? fmt(t.fees) : '—'}</td>
                      <td>
                        <span style={{ display: 'flex', gap: 4 }}>
                          <button className="btn-icon" onClick={() => openEdit(t)}>{Icons.edit}</button>
                          <button className="btn-icon danger" onClick={() => handleDelete(t.id)}>{Icons.trash}</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? 'Edit Trade' : 'New Trade'}</h3>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Account</label><select className="form-select" value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Security</label><select className="form-select" value={form.security_id} onChange={e => { const sec = securities.find(s => s.id === e.target.value); setForm({ ...form, security_id: e.target.value, currency: sec?.currency || form.currency }); }}>{securities.map(s => <option key={s.id} value={s.id}>{s.ticker} — {s.name}</option>)}</select></div>
            </div>
            <div className="form-row-3">
              <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={form.trade_type} onChange={e => setForm({ ...form, trade_type: e.target.value })}><option value="buy">Buy</option><option value="sell">Sell</option></select></div>
              <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={form.trade_date} onChange={e => setForm({ ...form, trade_date: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Currency</label><select className="form-select" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className="form-row-3">
              <div className="form-group"><label className="form-label">Quantity</label><input className="form-input" type="number" step="any" value={form.quantity} onChange={e => setForm({ ...form, quantity: e.target.value })} placeholder="0.00" /></div>
              <div className="form-group"><label className="form-label">Price per Share</label><input className="form-input" type="number" step="any" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0.00" /></div>
              <div className="form-group"><label className="form-label">Fees</label><input className="form-input" type="number" step="any" value={form.fees} onChange={e => setForm({ ...form, fees: e.target.value })} placeholder="0.00" /></div>
            </div>
            {form.quantity && form.price && (
              <div style={{ background: 'var(--accent-glow)', border: '1px solid rgba(79,125,245,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 8, fontSize: 14 }}>
                Total: <strong>{form.currency} {fmt(parseFloat(form.quantity || 0) * parseFloat(form.price || 0))}</strong>
              </div>
            )}
            <div className="form-group"><label className="form-label">Notes (optional)</label><input className="form-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.account_id || !form.security_id || !form.quantity || !form.price}>{editing ? 'Save Changes' : 'Record Trade'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
