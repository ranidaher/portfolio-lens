import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { Icons } from '@/components/Icons';
import LoginPage from '@/components/LoginPage';
import DashboardPage from '@/components/DashboardPage';
import AccountsPage from '@/components/AccountsPage';
import SecuritiesPage from '@/components/SecuritiesPage';
import TradesPage from '@/components/TradesPage';
import CashFlowsPage from '@/components/CashFlowsPage';
import PerformancePage from '@/components/PerformancePage';
import RealEstatePage from '@/components/RealEstatePage';
import SavingsPage from '@/components/SavingsPage';
import ScenariosPage from '@/components/ScenariosPage';
import AIChatPage from '@/components/AIChatPage';
import GeographyPage from '@/components/GeographyPage';

const PORTFOLIO_NAV = [
  { key: 'dashboard', label: 'Dashboard', icon: Icons.dashboard },
  { key: 'performance', label: 'Performance', icon: Icons.performance },
  { key: 'scenarios', label: 'Scenarios', icon: Icons.trades },
  { key: 'geography', label: 'Geography', icon: Icons.accounts },
  { key: 'aichat', label: 'AI Advisor', icon: Icons.performance },
];

const MANAGE_NAV = [
  { key: 'accounts', label: 'Accounts', icon: Icons.accounts },
  { key: 'securities', label: 'Securities', icon: Icons.securities },
  { key: 'trades', label: 'Trades', icon: Icons.trades },
  { key: 'cashflows', label: 'Cash Flows', icon: Icons.cashflow },
  { key: 'savings', label: 'Savings', icon: Icons.savings },
  { key: 'realestate', label: 'Real Estate', icon: Icons.realestate },
];

function SettingsPage({ user }) {
  const [pwLoading, setPwLoading] = useState(false);
  const [pwMessage, setPwMessage] = useState(null);

  const handleResetPassword = async () => {
    setPwLoading(true);
    setPwMessage(null);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(user.email, {
        redirectTo: window.location.origin + '?password_reset=true',
      });
      if (error) throw error;
      setPwMessage({ type: 'success', text: `Password reset email sent to ${user.email}. Check your inbox and follow the link to set a new password.` });
    } catch (err) {
      setPwMessage({ type: 'error', text: err.message });
    } finally {
      setPwLoading(false);
    }
  };

  return (
    <div className="fade-in">
      <div className="page-header"><h2>Settings</h2><p>Application preferences and account management.</p></div>
      <div className="card" style={{ maxWidth: 500, marginBottom: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Account Info</div>
        <div className="form-group"><label className="form-label">Email</label><div style={{ color: 'var(--text-primary)', fontSize: 14 }}>{user?.email}</div></div>
        <div className="form-group"><label className="form-label">Base Currency</label><div style={{ color: 'var(--text-primary)', fontSize: 14 }}>USD</div></div>
      </div>
      <div className="card" style={{ maxWidth: 500 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>Change Password</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 16 }}>
          Click below to receive a password reset email. You'll get a link to set a new password.
        </p>
        {pwMessage && (
          <div style={{ background: pwMessage.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)', border: `1px solid ${pwMessage.type === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)'}`, color: pwMessage.type === 'error' ? 'var(--danger)' : 'var(--success)', padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16 }}>
            {pwMessage.text}
          </div>
        )}
        <button className="btn btn-primary" onClick={handleResetPassword} disabled={pwLoading}>
          {pwLoading ? 'Sending...' : 'Send Password Reset Email'}
        </button>
      </div>
    </div>
  );
}

function AppShell({ session, onLogout }) {
  const [page, setPage] = useState('dashboard');
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const user = session.user;
  const renderPage = () => {
    switch (page) {
      case 'dashboard': return <DashboardPage user={user} />;
      case 'accounts': return <AccountsPage user={user} />;
      case 'securities': return <SecuritiesPage user={user} />;
      case 'trades': return <TradesPage user={user} />;
      case 'cashflows': return <CashFlowsPage user={user} />;
      case 'savings': return <SavingsPage user={user} />;
      case 'performance': return <PerformancePage user={user} />;
      case 'scenarios': return <ScenariosPage user={user} />;
      case 'geography': return <GeographyPage user={user} />;
      case 'aichat': return <AIChatPage user={user} />;
      case 'realestate': return <RealEstatePage user={user} />;
      case 'settings': return <SettingsPage user={user} />;
      default: return <DashboardPage user={user} />;
    }
  };
  const navigateTo = (key) => { setPage(key); setMenuOpen(false); };
  const isManagePage = MANAGE_NAV.some(item => item.key === page);
  return (
    <div className="app-container">
      {menuOpen && <div className="mobile-overlay" onClick={() => setMenuOpen(false)} />}
      <nav className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="sidebar-brand"><h1>Portfolio Lens</h1><span>Investment Tracker</span></div>
        <div className="nav-section">
          {/* Portfolio section */}
          {PORTFOLIO_NAV.map(item => (
            <div key={item.key} className={`nav-item ${page === item.key ? 'active' : ''}`} onClick={() => navigateTo(item.key)}>{item.icon}{item.label}</div>
          ))}

          {/* Manage section — collapsible */}
          <div
            onClick={() => setManageOpen(!manageOpen)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '11px 16px', borderRadius: 'var(--radius-sm)', cursor: 'pointer',
              color: isManagePage ? 'var(--accent)' : 'var(--text-muted)',
              fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em',
              marginTop: 12, marginBottom: 2, transition: 'var(--transition)',
            }}
          >
            <span>Manage</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 14, height: 14, transition: 'transform 0.2s', transform: manageOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </div>
          {manageOpen && MANAGE_NAV.map(item => (
            <div key={item.key} className={`nav-item ${page === item.key ? 'active' : ''}`} onClick={() => navigateTo(item.key)} style={{ paddingLeft: 20 }}>{item.icon}{item.label}</div>
          ))}

          {/* Settings */}
          <div style={{ marginTop: 12 }}>
            <div className={`nav-item ${page === 'settings' ? 'active' : ''}`} onClick={() => navigateTo('settings')}>{Icons.settings}Settings</div>
          </div>
        </div>
        <div className="sidebar-footer">
          <div className="user-badge">
            <div className="user-avatar">{(user.email || 'U')[0].toUpperCase()}</div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>{user.email}</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Free Plan</div>
            </div>
          </div>
          <button className="logout-btn" onClick={onLogout}>{Icons.logout} Sign Out</button>
        </div>
      </nav>
      <main className="main-content">
        <div className="mobile-header">
          <button className="mobile-menu-btn" onClick={() => setMenuOpen(true)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ width: 18, height: 18 }}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            Menu
          </button>
          <span style={{ fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 600 }}>Portfolio Lens</span>
          <div style={{ width: 70 }} />
        </div>
        {renderPage()}
      </main>
    </div>
  );
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  // Check URL synchronously on initial render for recovery mode
  const [isRecovery, setIsRecovery] = useState(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash;
      const search = window.location.search;
      const hashHasRecovery = hash && hash.includes('type=recovery');
      const queryHasReset = search && search.includes('password_reset=true');
      return hashHasRecovery || queryHasReset;
    }
    return false;
  });
  const [recoveryPw, setRecoveryPw] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setLoading(false); });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === 'PASSWORD_RECOVERY') {
        setIsRecovery(true);
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleRecoverySubmit = async () => {
    if (recoveryPw.length < 6) { setRecoveryMessage({ type: 'error', text: 'Password must be at least 6 characters.' }); return; }
    if (recoveryPw !== recoveryConfirm) { setRecoveryMessage({ type: 'error', text: 'Passwords do not match.' }); return; }
    setRecoveryLoading(true);
    setRecoveryMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: recoveryPw });
      if (error) throw error;
      setRecoveryMessage({ type: 'success', text: 'Password updated! Redirecting to your dashboard...' });
      window.location.hash = '';
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => { setIsRecovery(false); }, 2000);
    } catch (err) {
      setRecoveryMessage({ type: 'error', text: err.message });
    } finally {
      setRecoveryLoading(false);
    }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); setSession(null); };

  // Show password reset form FIRST — before any other rendering
  if (isRecovery) {
    return (
      <div className="login-container">
        <div className="login-bg" />
        <div className="login-card fade-in">
          <h1>Portfolio Lens</h1>
          <p className="subtitle">Set New Password</p>
          {recoveryMessage && (
            <div style={{
              background: recoveryMessage.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
              border: `1px solid ${recoveryMessage.type === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)'}`,
              color: recoveryMessage.type === 'error' ? 'var(--danger)' : 'var(--success)',
              padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16
            }}>
              {recoveryMessage.text}
            </div>
          )}
          <div className="form-group">
            <label className="form-label">New Password</label>
            <input className="form-input" type="password" value={recoveryPw} onChange={e => setRecoveryPw(e.target.value)} placeholder="••••••••" minLength={6} />
          </div>
          <div className="form-group">
            <label className="form-label">Confirm New Password</label>
            <input className="form-input" type="password" value={recoveryConfirm} onChange={e => setRecoveryConfirm(e.target.value)} placeholder="••••••••" minLength={6} />
          </div>
          <button className="btn btn-primary" onClick={handleRecoverySubmit} disabled={recoveryLoading || !recoveryPw || !recoveryConfirm} style={{ width: '100%', justifyContent: 'center' }}>
            {recoveryLoading ? 'Updating...' : 'Set New Password'}
          </button>
        </div>
      </div>
    );
  }

  if (loading) return <div className="loading" style={{ height: '100vh' }}><div className="spinner" /> Loading Portfolio Lens...</div>;

  if (!session) return <LoginPage onAuth={setSession} />;
  return <AppShell session={session} onLogout={handleLogout} />;
}
