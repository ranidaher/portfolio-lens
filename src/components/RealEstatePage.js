import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { COUNTRIES, CURRENCIES, REGIONS, fmt } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';

export default function RealEstatePage({ user }) {
  const [properties, setProperties] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [toast, setToast] = useState(null);
  const [fxRates, setFxRates] = useState({ USD: 1 });
  const [form, setForm] = useState({
    name: '', country: 'Canada', currency: 'CAD', region: 'Canada',
    current_value: '', mortgage_balance: '', net_rental_income: '', account_id: '',
  });

  const [valuations, setValuations] = useState([]);
  const [showValuations, setShowValuations] = useState(null);
  const [showValModal, setShowValModal] = useState(false);
  const [valForm, setValForm] = useState({ property_id: '', valuation_date: new Date().toISOString().slice(0, 10), value: '', mortgage_balance: '' }); // property id to show history

  const fetchData = useCallback(async () => {
    const [propRes, accRes, valRes] = await Promise.all([
      supabase.from('properties').select('*, accounts(name, tax_sheltered)').eq('user_id', user.id).order('name'),
      supabase.from('accounts').select('*').eq('user_id', user.id).eq('account_type', 'real_estate').order('name'),
      supabase.from('property_valuations').select('*').eq('user_id', user.id).order('valuation_date', { ascending: false }),
    ]);
    setProperties(propRes.data || []);
    setAccounts(accRes.data || []);
    setValuations(valRes.data || []);
    setLoading(false);

    // Fetch FX rates for display
    const currencies = [...new Set((propRes.data || []).map(p => p.currency))];
    if (currencies.length > 0) {
      fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies }) })
        .then(r => r.json())
        .then(data => setFxRates({ USD: 1, ...data.rates }))
        .catch(() => {});
    }
  }, [user.id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '', country: 'Canada', currency: 'CAD', region: 'Canada',
      current_value: '', mortgage_balance: '0', net_rental_income: '0',
      account_id: accounts[0]?.id || '',
    });
    setShowModal(true);
  };

  const openEdit = (prop) => {
    setEditing(prop);
    setForm({
      name: prop.name, country: prop.country, currency: prop.currency, region: prop.region,
      current_value: String(prop.current_value), mortgage_balance: String(prop.mortgage_balance),
      net_rental_income: String(prop.net_rental_income), account_id: prop.account_id,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    const payload = {
      name: form.name,
      country: form.country,
      currency: form.currency,
      region: form.region,
      current_value: parseFloat(form.current_value) || 0,
      mortgage_balance: parseFloat(form.mortgage_balance) || 0,
      net_rental_income: parseFloat(form.net_rental_income) || 0,
      account_id: form.account_id,
      user_id: user.id,
      last_updated: new Date().toISOString().slice(0, 10),
    };

    let propertyId;
    if (editing) {
      await supabase.from('properties').update(payload).eq('id', editing.id);
      propertyId = editing.id;
      setToast({ message: 'Property updated', type: 'success' });
    } else {
      const { data } = await supabase.from('properties').insert(payload).select().single();
      propertyId = data?.id;
      setToast({ message: 'Property added', type: 'success' });
    }

    // Record valuation history
    if (propertyId) {
      await supabase.from('property_valuations').insert({
        user_id: user.id,
        property_id: propertyId,
        valuation_date: new Date().toISOString().slice(0, 10),
        value: parseFloat(form.current_value) || 0,
        mortgage_balance: parseFloat(form.mortgage_balance) || 0,
      });
    }

    setShowModal(false);
    fetchData();
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this property?')) return;
    await supabase.from('properties').delete().eq('id', id);
    setToast({ message: 'Property deleted', type: 'success' });
    fetchData();
  };

  // Quick-create a real estate shadow account
  const [showAccountModal, setShowAccountModal] = useState(false);
  const [accForm, setAccForm] = useState({ name: '', country: 'Canada', currency: 'CAD', tax_sheltered: false });

  const handleCreateAccount = async () => {
    const payload = { ...accForm, account_type: 'real_estate', user_id: user.id };
    await supabase.from('accounts').insert(payload);
    setToast({ message: 'Real estate account created', type: 'success' });
    setShowAccountModal(false);
    fetchData();
  };

  // Calculations
  const totalValue = properties.reduce((sum, p) => sum + Number(p.current_value) * (fxRates[p.currency] || 1), 0);
  const totalMortgage = properties.reduce((sum, p) => sum + Number(p.mortgage_balance) * (fxRates[p.currency] || 1), 0);
  const totalEquity = totalValue - totalMortgage;
  const totalRental = properties.reduce((sum, p) => sum + Number(p.net_rental_income) * (fxRates[p.currency] || 1), 0);

  if (loading) return <div className="loading"><div className="spinner" /> Loading properties...</div>;

  const needsAccount = accounts.length === 0;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Real Estate</h2>
        <p>Track your properties, mortgages, and rental income.</p>
      </div>

      {properties.length > 0 && (
        <div className="stats-row">
          <div className="stat-card">
            <div className="stat-label">Total Value (USD)</div>
            <div className="stat-value">${fmt(totalValue)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Total Mortgages</div>
            <div className="stat-value" style={{ color: 'var(--danger)' }}>-${fmt(totalMortgage)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Net Equity</div>
            <div className="stat-value" style={{ color: 'var(--success)' }}>${fmt(totalEquity)}</div>
          </div>
          <div className="stat-card">
            <div className="stat-label">Annual Rental Income</div>
            <div className="stat-value" style={{ fontSize: 20 }}>${fmt(totalRental)}</div>
          </div>
        </div>
      )}

      {needsAccount ? (
        <div className="empty-state">
          {Icons.alert}
          <p>You need a real estate account first. This is a "shadow account" that groups your properties.</p>
          <button className="btn btn-primary" onClick={() => {
            setAccForm({ name: 'Real Estate', country: 'Canada', currency: 'CAD', tax_sheltered: false });
            setShowAccountModal(true);
          }}>{Icons.plus} Create Real Estate Account</button>
        </div>
      ) : (
        <>
          <div className="action-row">
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-secondary btn-sm" onClick={() => {
                setAccForm({ name: '', country: 'Canada', currency: 'CAD', tax_sheltered: false });
                setShowAccountModal(true);
              }}>{Icons.plus} New Account</button>
            </div>
            <button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Property</button>
          </div>

          {properties.length === 0 ? (
            <div className="empty-state">
              {Icons.empty}
              <p>No properties yet. Add your first property to track its value and rental income.</p>
              <button className="btn btn-primary" onClick={openNew}>{Icons.plus} Add Property</button>
            </div>
          ) : (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Country</th>
                    <th>Account</th>
                    <th style={{ textAlign: 'right' }}>Value</th>
                    <th style={{ textAlign: 'right' }}>Mortgage</th>
                    <th style={{ textAlign: 'right' }}>Equity</th>
                    <th style={{ textAlign: 'right' }}>Rental Income</th>
                    <th>Updated</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {properties.map(p => {
                    const equity = Number(p.current_value) - Number(p.mortgage_balance);
                    return (
                      <React.Fragment key={p.id}>
                      <tr>
                        <td style={{ fontWeight: 500 }}>{p.name}</td>
                        <td><span className={`badge badge-${p.region.toLowerCase()}`}>{p.country}</span></td>
                        <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{p.accounts?.name || '\u2014'}</td>
                        <td style={{ textAlign: 'right' }}>{p.currency} {fmt(p.current_value)}</td>
                        <td style={{ textAlign: 'right', color: 'var(--danger)' }}>{Number(p.mortgage_balance) > 0 ? `-${p.currency} ${fmt(p.mortgage_balance)}` : '\u2014'}</td>
                        <td style={{ textAlign: 'right', fontWeight: 500, color: 'var(--success)' }}>{p.currency} {fmt(equity)}</td>
                        <td style={{ textAlign: 'right' }}>{Number(p.net_rental_income) > 0 ? `${p.currency} ${fmt(p.net_rental_income)}/yr` : '\u2014'}</td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.last_updated}</td>
                        <td>
                          <span style={{ display: 'flex', gap: 4 }}>
                            <button className="btn-icon" onClick={() => setShowValuations(showValuations === p.id ? null : p.id)} title="Valuation History" style={{ fontSize: 11 }}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 14, height: 14 }}><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                            </button>
                            <button className="btn-icon" onClick={() => openEdit(p)}>{Icons.edit}</button>
                            <button className="btn-icon danger" onClick={() => handleDelete(p.id)}>{Icons.trash}</button>
                          </span>
                        </td>
                      </tr>
                      {showValuations === p.id && (
                        <tr>
                          <td colSpan={9} style={{ padding: 0 }}>
                            <div style={{ background: 'var(--bg-card)', padding: '12px 24px', borderTop: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Valuation History — {p.name}</div>
                                <button className="btn btn-primary btn-sm" style={{ fontSize: 11, padding: '3px 10px' }} onClick={() => {
                                  setValForm({ property_id: p.id, valuation_date: new Date().toISOString().slice(0, 10), value: String(p.current_value), mortgage_balance: String(p.mortgage_balance) });
                                  setShowValModal(true);
                                }}>{Icons.plus} Add Valuation</button>
                              </div>
                              {valuations.filter(v => v.property_id === p.id).length === 0 ? (
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>No valuation history yet.</div>
                              ) : (
                                <table style={{ width: '100%' }}>
                                  <thead><tr><th style={{ fontSize: 11 }}>Date</th><th style={{ textAlign: 'right', fontSize: 11 }}>Value</th><th style={{ textAlign: 'right', fontSize: 11 }}>Mortgage</th><th style={{ textAlign: 'right', fontSize: 11 }}>Equity</th><th style={{ width: 30 }}></th></tr></thead>
                                  <tbody>
                                    {valuations.filter(v => v.property_id === p.id).map(v => (
                                      <tr key={v.id}>
                                        <td style={{ fontSize: 13 }}>{v.valuation_date}</td>
                                        <td style={{ textAlign: 'right', fontSize: 13 }}>{p.currency} {fmt(v.value)}</td>
                                        <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--danger)' }}>{Number(v.mortgage_balance) > 0 ? `-${p.currency} ${fmt(v.mortgage_balance)}` : '\u2014'}</td>
                                        <td style={{ textAlign: 'right', fontSize: 13, fontWeight: 500, color: 'var(--success)' }}>{p.currency} {fmt(Number(v.value) - Number(v.mortgage_balance))}</td>
                                        <td><button onClick={async () => { await supabase.from('property_valuations').delete().eq('id', v.id); setToast({ message: 'Valuation deleted', type: 'success' }); fetchData(); }} style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 14, padding: 2 }}>×</button></td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                      </React.Fragment>
                    );
                  })}
                  {/* Totals row */}
                  <tr style={{ background: 'var(--bg-secondary)' }}>
                    <td colSpan={3} style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Total (USD)</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: "'Playfair Display', serif" }}>${fmt(totalValue)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--danger)' }}>-${fmt(totalMortgage)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)', fontFamily: "'Playfair Display', serif" }}>${fmt(totalEquity)}</td>
                    <td style={{ textAlign: 'right', fontWeight: 500 }}>${fmt(totalRental)}/yr</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Property Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{editing ? 'Edit Property' : 'New Property'}</h3>
            <div className="form-group">
              <label className="form-label">Property Name</label>
              <input className="form-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder='e.g. "Paris Apartment" or "Toronto Condo"' />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Account</label>
                <select className="form-select" value={form.account_id} onChange={e => setForm({ ...form, account_id: e.target.value })}>
                  {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Country</label>
                <select className="form-select" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })}>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
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
              <label className="form-label">Current Estimated Value</label>
              <input className="form-input" type="number" step="any" value={form.current_value} onChange={e => setForm({ ...form, current_value: e.target.value })} placeholder="0.00" />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Mortgage Balance</label>
                <input className="form-input" type="number" step="any" value={form.mortgage_balance} onChange={e => setForm({ ...form, mortgage_balance: e.target.value })} placeholder="0.00" />
              </div>
              <div className="form-group">
                <label className="form-label">Net Rental Income (yearly)</label>
                <input className="form-input" type="number" step="any" value={form.net_rental_income} onChange={e => setForm({ ...form, net_rental_income: e.target.value })} placeholder="0.00" />
              </div>
            </div>
            {form.current_value && (
              <div style={{ background: 'var(--accent-glow)', border: '1px solid rgba(79,125,245,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 8, fontSize: 14 }}>
                Equity: <strong>{form.currency} {fmt((parseFloat(form.current_value) || 0) - (parseFloat(form.mortgage_balance) || 0))}</strong>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={!form.name || !form.current_value || !form.account_id}>
                {editing ? 'Save Changes' : 'Add Property'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Quick Account Creation Modal */}
      {showAccountModal && (
        <div className="modal-overlay" onClick={() => setShowAccountModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>New Real Estate Account</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              This creates a "shadow account" to group your properties. You can have multiple (e.g., one per country).
            </p>
            <div className="form-group">
              <label className="form-label">Account Name</label>
              <input className="form-input" value={accForm.name} onChange={e => setAccForm({ ...accForm, name: e.target.value })} placeholder='e.g. "European Real Estate" or "Canadian Properties"' />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Country</label>
                <select className="form-select" value={accForm.country} onChange={e => setAccForm({ ...accForm, country: e.target.value })}>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-select" value={accForm.currency} onChange={e => setAccForm({ ...accForm, currency: e.target.value })}>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group" style={{ display: 'flex', alignItems: 'center' }}>
              <label className="form-checkbox">
                <input type="checkbox" checked={accForm.tax_sheltered} onChange={e => setAccForm({ ...accForm, tax_sheltered: e.target.checked })} />
                Tax Sheltered
              </label>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowAccountModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleCreateAccount} disabled={!accForm.name}>Create Account</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Valuation Modal */}
      {showValModal && (
        <div className="modal-overlay" onClick={() => setShowValModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Add Valuation</h3>
            <div className="form-group">
              <label className="form-label">Valuation Date</label>
              <input className="form-input" type="date" value={valForm.valuation_date} onChange={e => setValForm({ ...valForm, valuation_date: e.target.value })} />
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Property Value</label>
                <input className="form-input" type="number" step="any" value={valForm.value} onChange={e => setValForm({ ...valForm, value: e.target.value })} placeholder="500000" />
              </div>
              <div className="form-group">
                <label className="form-label">Mortgage Balance</label>
                <input className="form-input" type="number" step="any" value={valForm.mortgage_balance} onChange={e => setValForm({ ...valForm, mortgage_balance: e.target.value })} placeholder="0" />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowValModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={async () => {
                await supabase.from('property_valuations').insert({
                  user_id: user.id,
                  property_id: valForm.property_id,
                  valuation_date: valForm.valuation_date,
                  value: parseFloat(valForm.value) || 0,
                  mortgage_balance: parseFloat(valForm.mortgage_balance) || 0,
                });
                // Also update the property's current value to the latest valuation
                const prop = properties.find(p => p.id === valForm.property_id);
                const allVals = [...valuations.filter(v => v.property_id === valForm.property_id), { valuation_date: valForm.valuation_date, value: valForm.value, mortgage_balance: valForm.mortgage_balance }];
                const latest = allVals.sort((a, b) => b.valuation_date.localeCompare(a.valuation_date))[0];
                if (latest) {
                  await supabase.from('properties').update({
                    current_value: parseFloat(latest.value) || 0,
                    mortgage_balance: parseFloat(latest.mortgage_balance) || 0,
                    last_updated: latest.valuation_date,
                  }).eq('id', valForm.property_id);
                }
                setShowValModal(false);
                setToast({ message: 'Valuation added', type: 'success' });
                fetchData();
              }} disabled={!valForm.value}>Add Valuation</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
