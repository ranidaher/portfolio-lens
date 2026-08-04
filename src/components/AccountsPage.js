import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { COUNTRIES, CURRENCIES, ACCOUNT_TYPES, ACCOUNT_TYPE_LABELS } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';

export default function AccountsPage({ user }) {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ name: '', country: 'Canada', currency: 'CAD', account_type: 'brokerage', tax_sheltered: false, notes: '' });

  const fetchAccounts = useCallback(async () => {
    const { data } = await supabase.from('accounts').select('*').eq('user_id', user.id).order('name');
    setAccounts(data || []);
    setLoading(false);
  }, [user.id]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', country: 'Canada', currency: 'CAD', account_type: 'brokerage', tax_sheltered: false, notes: '' });
    setShowModal(true);
  };
  const openEdit = (acc) => {
    setEditing(acc);
    setForm({ name: acc.name, country: acc.country, currency: acc.currency, account_type: acc.account_type, tax_sheltered: acc.tax_sheltered, notes: acc.notes || '' });
    setShowModal(true);
  };
  const handleSave = async () => {
    const payload = { ...form, user_id: user.id };
    if (editing) {
      await supabase.from('accounts').update(payload).eq('id', editing.id);
      setToast({ message: 'Account updated', type: 'success' });
    } else {
      await supabase.from('accounts').insert(payload);
      setToast({ message: 'Account added', type: 'success' });
    }
    setShowModal(false);
    fetchAccounts();
  };
  const handleDelete = async (id) => {
    if (!confirm('Delete this account? All trades in this account will also be deleted.')) return;
    await supabase.from('accounts').delete().eq('id', id);
    setToast({ message: 'Account deleted', type: 'success' });
    fetchAccounts();
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading accounts...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Accounts</h2>
        <p>Manage your brokerage and real estate accounts across all countries.</p>
      </div>
      <div className="stats-row">
        <div className="stat-card"><div className="stat-label">Total Accounts</div><div className="stat-value">{accounts.length}</div></div>
        <div className="stat-card"><div className="stat-label">Brokerage</div><div className="stat-value">{accounts.filter(a => a.account_type === 'brokerage').length}</div></div>
        <div className="stat-card"><div className="stat-label">Real Estate</div><div className="stat-value">{accounts.filter(a => a.account_type === 'real_estate').length}</div></div>
        <div className="stat-card"><div className="stat-label">Tax Sheltered</div><div className="stat-value">{accounts.filter(a => a.tax_sheltered).length}</div></div>
      </div>
      <div className="action-row">
        <div />
        <button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Account</button>
      </div>
      {accounts.length === 0 ? (
        <div className="empty-state">{Icons.empty}<p>No accounts yet. Add your first brokerage or real estate account to get started.</p><button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Account</button></div>
      ) : (
        <div className="table-container">
          <table>
            <thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Currency</th><th>Tax Status</th><th>Notes</th><th style={{width: 80}}></th></tr></thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.id}>
                  <td style={{ fontWeight: 500 }}>{acc.name}</td>
                  <td><span className={`badge badge-${acc.account_type === 'brokerage' ? 'equity' : 'bond'}`}>{ACCOUNT_TYPE_LABELS[acc.account_type]}</span></td>
                  <td>{acc.country}</td>
                  <td>{acc.currency}</td>
                  <td><span className={`badge ${acc.tax_sheltered ? 'badge-tax-sheltered' : 'badge-taxable'}`}>{acc.tax_sheltered ? 'Tax Sheltered' : 'Taxable'}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{acc.notes || '—'}</td>
                  <td>
                    <span style={{ display: 'flex', gap: 4 }}>
                      <button className="btn-icon" onClick={() => openEdit(acc)}>{Icons.edit}</button>
                      <button className="btn-icon danger" onClick={() => handleDelete(acc.id)}>{Icons.trash}</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? 'Edit Account' : 'New Account'}</h3>
            <div className="form-group"><label className="form-label">Account Name</label><input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder='e.g. "TD Waterhouse RRSP"' /></div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Account Type</label><select className="form-select" value={form.account_type} onChange={e => setForm({ ...form, account_type: e.target.value })}>{ACCOUNT_TYPES.map(t => <option key={t} value={t}>{ACCOUNT_TYPE_LABELS[t]}</option>)}</select></div>
              <div className="form-group"><label className="form-label">Country</label><select className="form-select" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}>{COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            </div>
            <div className="form-row">
              <div className="form-group"><label className="form-label">Currency</label><select className="form-select" value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })}>{CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
              <div className="form-group" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 2 }}>
                <label className="form-checkbox"><input type="checkbox" checked={form.tax_sheltered} onChange={e => setForm({ ...form, tax_sheltered: e.target.checked })} />Tax Sheltered</label>
              </div>
            </div>
            <div className="form-group"><label className="form-label">Notes (optional)</label><input className="form-input" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Optional notes" /></div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.name}>{editing ? 'Save Changes' : 'Add Account'}</button>
            </div>
          </div>
        </div>
      )}
      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
