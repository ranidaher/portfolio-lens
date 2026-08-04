import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { CURRENCIES, fmt } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';

export default function CashFlowsPage({ user }) {
  const [flows, setFlows] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ account_id: '', flow_type: 'deposit', flow_date: new Date().toISOString().slice(0, 10), amount: '', currency: 'USD', notes: '' });

  const fetchAll = useCallback(async () => {
    const [fRes, aRes] = await Promise.all([
      supabase.from('cash_flows').select('*, accounts(name)').eq('user_id', user.id).order('flow_date', { ascending: false }),
      supabase.from('accounts').select('*').eq('user_id', user.id).order('name'),
    ]);
    setFlows(fRes.data || []);
    setAccounts(aRes.data || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const openNew = () => { setEditing(null); setForm({ account_id: accounts[0]?.id || '', flow_type: 'deposit', flow_date: new Date().toISOString().slice(0, 10), amount: '', currency: accounts[0]?.currency || 'USD', notes: '' }); setShowModal(true); };
  const openEdit = (f) => { setEditing(f); setForm({ account_id: f.account_id, flow_type: f.flow_type, flow_date: f.flow_date, amount: String(f.amount), currency: f.currency, notes: f.notes || '' }); setShowModal(true); };
  const handleSave = async () => {
    const payload = { ...form, amount: parseFloat(form.amount), user_id: user.id };
    if (editing) { await supabase.from('cash_flows').update(payload).eq('id', editing.id); setToast({ message: 'Cash flow updated', type: 'success' }); }
    else { await supabase.from('cash_flows').insert(payload); setToast({ message: 'Cash flow recorded', type: 'success' }); }
    setShowModal(false); fetchAll();
  };
  const handleDelete = async (id) => { if (!confirm('Delete this cash flow?')) return; await supabase.from('cash_flows').delete().eq('id', id); setToast({ message: 'Deleted', type: 'success' }); fetchAll(); };

  if (loading) return <div className="loading"><div className="spinner" /> Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header"><h2>Cash Flows</h2><p>Track deposits and withdrawals for accurate return calculations.</p></div>
      <div className="action-row"><div /><button className="btn btn-primary" onClick={openNew} disabled={accounts.length === 0}>{Icons.plus} Add Cash Flow</button></div>
      {accounts.length === 0 ? (
        <div className="empty-state">{Icons.alert}<p>Add accounts first before recording cash flows.</p></div>
      ) : flows.length === 0 ? (
        <div className="empty-state">{Icons.empty}<p>No cash flows yet. Record deposits and withdrawals to your accounts.</p></div>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Date</th><th>Type</th><th>Account</th><th>Amount</th><th>Notes</th><th style={{width:80}}></th></tr></thead>
            <tbody>
              {flows.map(f => (
                <tr key={f.id}>
                  <td>{f.flow_date}</td>
                  <td><span className={`badge badge-${f.flow_type === 'deposit' ? 'buy' : 'sell'}`}>{f.flow_type.toUpperCase()}</span></td>
                  <td>{f.accounts?.name || '—'}</td>
                  <td style={{ fontWeight: 500 }}>{f.currency} {fmt(f.amount)}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{f.notes || '—'}</td>
                  <td><span style={{display:'flex',gap:4}}><button className="btn-icon" onClick={() => openEdit(f)}>{Icons.edit}</button><button className="btn-icon danger" onClick={() => handleDelete(f.id)}>{Icons.trash}</button></span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? 'Edit Cash Flow' : 'New Cash Flow'}</h3>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Account</label><select className="form-select" value={form.account_id} onChange={e => { const acc = accounts.find(a => a.id === e.target.value); setForm({ ...form, account_id: e.target.value, currency: acc?.currency || form.currency }); }}>{accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Type</label><select className="form-select" value={form.flow_type} onChange={e => setForm({ ...form, flow_type: e.target.value })}><option value="deposit">Deposit</option><option value="withdrawal">Withdrawal</option></select></div>
            </div>
            <div className="form-row-3">
              <div className="form-group"><label className="form-label">Date</label><input className="form-input" type="date" value={form.flow_date} onChange={e => setForm({ ...form, flow_date: e.target.value })} /></div>
              <div className="form-group"><label className="form-label">Amount</label><input className="form-input" type="number" step="any" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} placeholder="0.00" /></div>
              <div className="form-group"><label className="form-label">Currency</label><select className="form-select" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className="form-group"><label className="form-label">Notes (optional)</label><input className="form-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.account_id || !form.amount}>{editing ? 'Save Changes' : 'Record Cash Flow'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
