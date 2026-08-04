import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { CURRENCIES, fmt, fmtRound } from '@/lib/constants';
import { Icons } from './Icons';
import Toast from './Toast';

function generateMonths(startYM) {
  const months = [];
  const [sy, sm] = startYM.split('-').map(Number);
  const now = new Date();
  let y = sy, m = sm;
  while (y < now.getFullYear() || (y === now.getFullYear() && m <= now.getMonth() + 1)) {
    months.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) { m = 1; y++; }
  }
  return months;
}

function formatMonthLabel(ym) {
  const [y, m] = ym.split('-');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[parseInt(m) - 1]} ${y}`;
}

// Build the full ledger from stored data — all calculations happen here
function buildLedger(months, storedData, startingBalance, startingRate) {
  const dataMap = {};
  storedData.forEach(d => { dataMap[d.year_month] = d; });

  const rows = [];
  let prevClose = startingBalance;
  let currentRate = startingRate;

  for (let i = 0; i < months.length; i++) {
    const ym = months[i];
    const stored = dataMap[ym];

    const openingBalance = i === 0 ? startingBalance : prevClose;

    // Rate: use stored rate if changed this month, otherwise carry forward
    if (stored && stored.annual_rate !== null && stored.annual_rate !== undefined && stored.annual_rate !== '') {
      currentRate = Number(stored.annual_rate);
    }

    const depositsWithdrawals = stored ? Number(stored.deposits_withdrawals || 0) : 0;

    // Interest: auto-calculate on opening balance, or use override
    const autoInterest = Math.round((openingBalance * currentRate / 100) / 12 * 100) / 100;
    const isOverride = stored?.is_override || false;
    const interest = isOverride ? Number(stored.interest_earned) : autoInterest;

    const closingBalance = openingBalance + depositsWithdrawals + interest;

    rows.push({
      year_month: ym,
      openingBalance,
      depositsWithdrawals,
      annual_rate: currentRate,
      autoInterest,
      interest,
      isOverride,
      closingBalance,
      hasStoredData: !!stored,
      storedId: stored?.id,
      notes: stored?.notes || '',
    });

    prevClose = closingBalance;
  }

  return rows;
}

export default function SavingsPage({ user }) {
  const [accounts, setAccounts] = useState([]);
  const [ledgerData, setLedgerData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [fxRates, setFxRates] = useState({ USD: 1 });

  // Edit modal
  const [showModal, setShowModal] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [form, setForm] = useState({
    annual_rate: '', deposits_withdrawals: '', interest_earned: '',
    is_override: false, notes: '',
  });

  // Setup modal (first time)
  const [showSetupModal, setShowSetupModal] = useState(false);
  const [setupForm, setSetupForm] = useState({
    start_year: new Date().getFullYear(), start_month: new Date().getMonth() + 1,
    balance: '', annual_rate: '',
  });

  // Edit starting values modal
  const [showEditStart, setShowEditStart] = useState(false);
  const [editStartForm, setEditStartForm] = useState({ balance: '', annual_rate: '', start_year: '', start_month: '' });

  const fetchData = useCallback(async () => {
    const [accRes, ledgerRes] = await Promise.all([
      supabase.from('accounts').select('*').eq('user_id', user.id).eq('account_type', 'savings').order('name'),
      supabase.from('savings_ledger').select('*').eq('user_id', user.id).order('year_month'),
    ]);
    const accs = accRes.data || [];
    setAccounts(accs);
    setLedgerData(ledgerRes.data || []);
    if (accs.length > 0 && !selectedAccount) setSelectedAccount(accs[0].id);
    setLoading(false);

    const currencies = [...new Set(accs.map(a => a.currency))];
    if (currencies.length > 0) {
      fetch('/api/fx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ currencies }) })
        .then(r => r.json()).then(d => setFxRates({ USD: 1, ...d.rates })).catch(() => {});
    }
  }, [user.id, selectedAccount]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const selectedAcc = accounts.find(a => a.id === selectedAccount);
  const accountLedger = ledgerData.filter(l => l.account_id === selectedAccount).sort((a, b) => a.year_month.localeCompare(b.year_month));

  // Get starting values from first ledger entry
  const firstEntry = accountLedger[0];
  const startingBalance = firstEntry ? Number(firstEntry.balance) : 0;
  const startingRate = firstEntry ? Number(firstEntry.annual_rate) : 0;
  const startYM = firstEntry?.year_month;

  // Build full calculated ledger
  const months = startYM ? generateMonths(startYM) : [];
  const displayRows = buildLedger(months, accountLedger, startingBalance, startingRate);

  const totalInterest = displayRows.reduce((sum, r) => sum + r.interest, 0);
  const totalDeposits = displayRows.reduce((sum, r) => sum + (r.depositsWithdrawals > 0 ? r.depositsWithdrawals : 0), 0);
  const totalWithdrawals = displayRows.reduce((sum, r) => sum + (r.depositsWithdrawals < 0 ? Math.abs(r.depositsWithdrawals) : 0), 0);
  const currentBalance = displayRows.length > 0 ? displayRows[displayRows.length - 1].closingBalance : 0;
  const currentRate = displayRows.length > 0 ? displayRows[displayRows.length - 1].annual_rate : 0;

  // Totals across all savings accounts
  const allAccountTotals = accounts.map(acc => {
    const accLedger = ledgerData.filter(l => l.account_id === acc.id).sort((a, b) => a.year_month.localeCompare(b.year_month));
    const first = accLedger[0];
    if (!first) return { name: acc.name, currency: acc.currency, balance: 0, balanceUSD: 0 };
    const ms = generateMonths(first.year_month);
    const rows = buildLedger(ms, accLedger, Number(first.balance), Number(first.annual_rate));
    const lastRow = rows[rows.length - 1];
    const bal = lastRow ? lastRow.closingBalance : 0;
    const fxRate = fxRates[acc.currency] || 1;
    return { name: acc.name, currency: acc.currency, balance: bal, balanceUSD: bal * fxRate };
  });
  const grandTotalUSD = allAccountTotals.reduce((sum, a) => sum + a.balanceUSD, 0);

  // Open edit modal
  const openEdit = (row, isFirst) => {
    setEditingRow({ ...row, isFirst });
    setForm({
      annual_rate: String(row.annual_rate),
      deposits_withdrawals: String(row.depositsWithdrawals || 0),
      interest_earned: String(row.interest),
      is_override: row.isOverride,
      notes: row.notes,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    const row = editingRow;
    const rate = parseFloat(form.annual_rate) || 0;
    const depWith = parseFloat(form.deposits_withdrawals) || 0;

    // Recalculate auto interest with new values
    const autoInterest = Math.round((row.openingBalance * rate / 100) / 12 * 100) / 100;
    const interest = form.is_override ? parseFloat(form.interest_earned) || 0 : autoInterest;

    const payload = {
      user_id: user.id,
      account_id: selectedAccount,
      year_month: row.year_month,
      balance: row.isFirst ? row.openingBalance : (row.hasStoredData ? (accountLedger.find(l => l.year_month === row.year_month)?.balance || 0) : 0),
      annual_rate: rate,
      deposits_withdrawals: depWith,
      interest_earned: interest,
      is_override: form.is_override,
      notes: form.notes,
    };

    if (row.storedId) {
      await supabase.from('savings_ledger').update(payload).eq('id', row.storedId);
    } else {
      await supabase.from('savings_ledger').upsert(payload, { onConflict: 'user_id,account_id,year_month' });
    }

    setToast({ message: 'Month updated', type: 'success' });
    setShowModal(false);
    fetchData();
  };

  // Setup: initialize tracking
  const handleSetup = async () => {
    const ym = `${setupForm.start_year}-${String(setupForm.start_month).padStart(2, '0')}`;
    await supabase.from('savings_ledger').upsert({
      user_id: user.id,
      account_id: selectedAccount,
      year_month: ym,
      balance: parseFloat(setupForm.balance) || 0,
      annual_rate: parseFloat(setupForm.annual_rate) || 0,
      interest_earned: 0,
      deposits_withdrawals: 0,
      is_override: false,
    }, { onConflict: 'user_id,account_id,year_month' });

    setToast({ message: 'Savings tracking started', type: 'success' });
    setShowSetupModal(false);
    fetchData();
  };

  // Edit starting values
  const handleEditStart = async () => {
    if (!firstEntry) return;
    const newYM = `${editStartForm.start_year}-${String(editStartForm.start_month).padStart(2, '0')}`;
    const oldYM = firstEntry.year_month;

    if (newYM !== oldYM) {
      // Start date changed — delete old first entry, create new one
      await supabase.from('savings_ledger').delete().eq('id', firstEntry.id);
      await supabase.from('savings_ledger').upsert({
        user_id: user.id,
        account_id: selectedAccount,
        year_month: newYM,
        balance: parseFloat(editStartForm.balance) || 0,
        annual_rate: parseFloat(editStartForm.annual_rate) || 0,
        interest_earned: 0,
        deposits_withdrawals: 0,
        is_override: false,
      }, { onConflict: 'user_id,account_id,year_month' });
    } else {
      // Same date, just update values
      await supabase.from('savings_ledger').update({
        balance: parseFloat(editStartForm.balance) || 0,
        annual_rate: parseFloat(editStartForm.annual_rate) || 0,
      }).eq('id', firstEntry.id);
    }

    setToast({ message: 'Starting values updated — all months recalculated', type: 'success' });
    setShowEditStart(false);
    fetchData();
  };

  if (loading) return <div className="loading"><div className="spinner" /> Loading...</div>;

  return (
    <div className="fade-in">
      <div className="page-header">
        <h2>Savings Accounts</h2>
        <p>Track balances, interest rates, deposits, and compounding interest.</p>
      </div>

      {accounts.length === 0 ? (
        <div className="empty-state">
          {Icons.alert}
          <p>You need a savings account first. Go to <strong>Accounts</strong> and create one with type "Savings".</p>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="stats-row">
            <div className="stat-card"><div className="stat-label">Total Savings (USD)</div><div className="stat-value">${fmtRound(grandTotalUSD)}</div></div>
            <div className="stat-card"><div className="stat-label">Accounts</div><div className="stat-value">{accounts.length}</div></div>
            {selectedAccount && displayRows.length > 0 && (
              <>
                <div className="stat-card"><div className="stat-label">Current Balance</div><div className="stat-value">{selectedAcc?.currency} {fmtRound(currentBalance)}</div></div>
                <div className="stat-card"><div className="stat-label">Current Rate</div><div className="stat-value" style={{ color: 'var(--accent)' }}>{currentRate}%</div></div>
                <div className="stat-card"><div className="stat-label">Total Interest Earned</div><div className="stat-value" style={{ color: 'var(--success)' }}>{selectedAcc?.currency} {fmtRound(totalInterest)}</div></div>
              </>
            )}
          </div>

          {/* Account Tabs */}
          <div className="filter-group" style={{ marginBottom: 24 }}>
            {accounts.map(acc => (
              <button key={acc.id} className={`filter-btn ${selectedAccount === acc.id ? 'active' : ''}`} onClick={() => setSelectedAccount(acc.id)}>
                {acc.name}
              </button>
            ))}
          </div>

          {/* Selected Account Content */}
          {selectedAccount && (
            <>
              {accountLedger.length === 0 ? (
                <div className="empty-state">
                  {Icons.empty}
                  <p>No data yet for this account. Set up the starting balance and rate to begin tracking.</p>
                  <button className="btn btn-primary" onClick={() => {
                    setSetupForm({ start_year: new Date().getFullYear(), start_month: new Date().getMonth() + 1, balance: '', annual_rate: '' });
                    setShowSetupModal(true);
                  }}>{Icons.plus} Start Tracking</button>
                </div>
              ) : (
                <>
                  <div className="action-row" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                      Click any row to edit. Interest compounds monthly. Started {formatMonthLabel(startYM)} at {selectedAcc?.currency} {fmtRound(startingBalance)}.
                    </div>
                    <button className="btn btn-secondary btn-sm" style={{ fontSize: 12, padding: '4px 12px' }} onClick={() => {
                      setEditStartForm({ balance: String(startingBalance), annual_rate: String(startingRate), start_year: String(startYM.split('-')[0]), start_month: String(parseInt(startYM.split('-')[1])) });
                      setShowEditStart(true);
                    }}>Edit Starting Values</button>
                  </div>

                  <div className="table-container">
                    <table>
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th style={{ textAlign: 'right' }}>Opening</th>
                          <th style={{ textAlign: 'right' }}>Deposits / Withdrawals</th>
                          <th style={{ textAlign: 'right' }}>Rate</th>
                          <th style={{ textAlign: 'right' }}>Interest</th>
                          <th style={{ textAlign: 'right' }}>Closing Balance</th>
                          <th>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {[...displayRows].reverse().map((row, i) => (
                          <tr key={row.year_month} onClick={() => openEdit(row, row.year_month === startYM)} style={{ cursor: 'pointer' }}>
                            <td style={{ fontWeight: 500 }}>{formatMonthLabel(row.year_month)}</td>
                            <td style={{ textAlign: 'right' }}>{selectedAcc?.currency} {fmtRound(row.openingBalance)}</td>
                            <td style={{ textAlign: 'right', color: row.depositsWithdrawals > 0 ? 'var(--success)' : row.depositsWithdrawals < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                              {row.depositsWithdrawals !== 0 ? `${row.depositsWithdrawals > 0 ? '+' : ''}${selectedAcc?.currency} ${fmtRound(row.depositsWithdrawals)}` : '\u2014'}
                            </td>
                            <td style={{ textAlign: 'right', color: 'var(--accent)' }}>{row.annual_rate}%</td>
                            <td style={{ textAlign: 'right', color: 'var(--success)' }}>
                              {selectedAcc?.currency} {fmt(row.interest)}
                              {row.isOverride && <span style={{ marginLeft: 4, fontSize: 10, color: 'var(--text-muted)', verticalAlign: 'super' }}>M</span>}
                            </td>
                            <td style={{ textAlign: 'right', fontWeight: 600 }}>{selectedAcc?.currency} {fmtRound(row.closingBalance)}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.notes || '\u2014'}</td>
                          </tr>
                        ))}
                        {/* Totals row */}
                        <tr style={{ background: 'var(--bg-secondary)' }}>
                          <td style={{ fontWeight: 600, textTransform: 'uppercase', fontSize: 12, letterSpacing: '0.06em', color: 'var(--text-muted)' }}>Totals</td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>
                            {totalDeposits > 0 && <div style={{ color: 'var(--success)' }}>+{selectedAcc?.currency} {fmtRound(totalDeposits)}</div>}
                            {totalWithdrawals > 0 && <div style={{ color: 'var(--danger)' }}>-{selectedAcc?.currency} {fmtRound(totalWithdrawals)}</div>}
                          </td>
                          <td></td>
                          <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--success)', fontFamily: "'Playfair Display', serif", fontSize: 16 }}>
                            {selectedAcc?.currency} {fmtRound(totalInterest)}
                          </td>
                          <td style={{ textAlign: 'right', fontWeight: 700, fontFamily: "'Playfair Display', serif", fontSize: 16 }}>
                            {selectedAcc?.currency} {fmtRound(currentBalance)}
                          </td>
                          <td></td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {/* Edit Month Modal */}
      {showModal && editingRow && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>{formatMonthLabel(editingRow.year_month)}</h3>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
              Opening balance: <strong>{selectedAcc?.currency} {fmtRound(editingRow.openingBalance)}</strong>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Annual Rate (%)</label>
                <input className="form-input" type="number" step="any" value={form.annual_rate}
                  onChange={e => setForm({ ...form, annual_rate: e.target.value })} placeholder="4.5" />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Change only applies from this month forward</div>
              </div>
              <div className="form-group">
                <label className="form-label">Deposits (+) / Withdrawals (-)</label>
                <input className="form-input" type="number" step="any" value={form.deposits_withdrawals}
                  onChange={e => setForm({ ...form, deposits_withdrawals: e.target.value })} placeholder="0" />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>Positive = deposit, negative = withdrawal</div>
              </div>
            </div>

            {/* Auto-calculated preview */}
            {!form.is_override && form.annual_rate && (
              <div style={{ background: 'var(--accent-glow)', border: '1px solid rgba(79,125,245,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 16, fontSize: 14 }}>
                Auto interest: <strong>{selectedAcc?.currency} {fmt((editingRow.openingBalance * parseFloat(form.annual_rate || 0) / 100) / 12)}</strong> /month
                {parseFloat(form.deposits_withdrawals || 0) !== 0 && (
                  <span style={{ marginLeft: 8 }}>
                    → Closing: <strong>{selectedAcc?.currency} {fmtRound(editingRow.openingBalance + parseFloat(form.deposits_withdrawals || 0) + (editingRow.openingBalance * parseFloat(form.annual_rate || 0) / 100) / 12)}</strong>
                  </span>
                )}
              </div>
            )}

            <div className="form-group">
              <label className="form-checkbox">
                <input type="checkbox" checked={form.is_override} onChange={e => setForm({ ...form, is_override: e.target.checked })} />
                Override interest manually
              </label>
            </div>

            {form.is_override && (
              <div className="form-group">
                <label className="form-label">Manual Interest Amount</label>
                <input className="form-input" type="number" step="any" value={form.interest_earned}
                  onChange={e => setForm({ ...form, interest_earned: e.target.value })} placeholder="0.00" />
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Notes (optional)</label>
              <input className="form-input" value={form.notes}
                onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="e.g. rate changed, bonus deposit" />
            </div>

            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Setup Modal */}
      {showSetupModal && (
        <div className="modal-overlay" onClick={() => setShowSetupModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Start Tracking</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              Set the starting month, balance, and interest rate. Interest compounds monthly — each month's closing balance becomes next month's opening balance.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Year</label>
                <input className="form-input" type="number" value={setupForm.start_year}
                  onChange={e => setSetupForm({ ...setupForm, start_year: parseInt(e.target.value) })} />
              </div>
              <div className="form-group">
                <label className="form-label">Start Month</label>
                <select className="form-select" value={setupForm.start_month}
                  onChange={e => setSetupForm({ ...setupForm, start_month: parseInt(e.target.value) })}>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Starting Balance</label>
                <input className="form-input" type="number" step="any" value={setupForm.balance}
                  onChange={e => setSetupForm({ ...setupForm, balance: e.target.value })} placeholder="50000" />
              </div>
              <div className="form-group">
                <label className="form-label">Annual Interest Rate (%)</label>
                <input className="form-input" type="number" step="any" value={setupForm.annual_rate}
                  onChange={e => setSetupForm({ ...setupForm, annual_rate: e.target.value })} placeholder="4.5" />
              </div>
            </div>
            {setupForm.balance && setupForm.annual_rate && (
              <div style={{ background: 'var(--accent-glow)', border: '1px solid rgba(79,125,245,0.2)', borderRadius: 'var(--radius-sm)', padding: '10px 14px', marginBottom: 8, fontSize: 14 }}>
                Monthly interest: <strong>{selectedAcc?.currency} {fmt((parseFloat(setupForm.balance) * parseFloat(setupForm.annual_rate) / 100) / 12)}</strong>
              </div>
            )}
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowSetupModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSetup} disabled={!setupForm.balance || !setupForm.annual_rate}>Start Tracking</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Starting Values Modal */}
      {showEditStart && (
        <div className="modal-overlay" onClick={() => setShowEditStart(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3>Edit Starting Values</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
              Changing these will recalculate every month from the beginning.
            </p>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Start Year</label>
                <input className="form-input" type="number" value={editStartForm.start_year}
                  onChange={e => setEditStartForm({ ...editStartForm, start_year: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Start Month</label>
                <select className="form-select" value={editStartForm.start_month}
                  onChange={e => setEditStartForm({ ...editStartForm, start_month: parseInt(e.target.value) })}>
                  {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) => (
                    <option key={i} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">Starting Balance</label>
                <input className="form-input" type="number" step="any" value={editStartForm.balance}
                  onChange={e => setEditStartForm({ ...editStartForm, balance: e.target.value })} />
              </div>
              <div className="form-group">
                <label className="form-label">Starting Annual Rate (%)</label>
                <input className="form-input" type="number" step="any" value={editStartForm.annual_rate}
                  onChange={e => setEditStartForm({ ...editStartForm, annual_rate: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn btn-secondary" onClick={() => setShowEditStart(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleEditStart}>Save & Recalculate</button>
            </div>
          </div>
        </div>
      )}

      {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    </div>
  );
}
