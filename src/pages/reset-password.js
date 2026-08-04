import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function ResetPassword() {
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Supabase will auto-detect the recovery token from the URL hash
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });
    // Also check if already in a session (token might already be processed)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
  }, []);

  const handleReset = async () => {
    if (newPw.length < 6) { setMessage({ type: 'error', text: 'Password must be at least 6 characters.' }); return; }
    if (newPw !== confirmPw) { setMessage({ type: 'error', text: 'Passwords do not match.' }); return; }
    setLoading(true);
    setMessage(null);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPw });
      if (error) throw error;
      setMessage({ type: 'success', text: 'Password updated! You can now close this page and log in with your new password.' });
      setNewPw(''); setConfirmPw('');
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-bg" />
      <div className="login-card fade-in">
        <h1>Portfolio Lens</h1>
        <p className="subtitle">Set New Password</p>

        {!ready ? (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '20px 0' }}>
            <div className="spinner" style={{ margin: '0 auto 12px' }} />
            Verifying reset link...
          </div>
        ) : (
          <>
            {message && (
              <div style={{
                background: message.type === 'error' ? 'var(--danger-bg)' : 'var(--success-bg)',
                border: `1px solid ${message.type === 'error' ? 'rgba(248,113,113,0.3)' : 'rgba(52,211,153,0.3)'}`,
                color: message.type === 'error' ? 'var(--danger)' : 'var(--success)',
                padding: '10px 14px', borderRadius: 'var(--radius-sm)', fontSize: 13, marginBottom: 16
              }}>
                {message.text}
              </div>
            )}
            <div className="form-group">
              <label className="form-label">New Password</label>
              <input className="form-input" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="••••••••" minLength={6} />
            </div>
            <div className="form-group">
              <label className="form-label">Confirm New Password</label>
              <input className="form-input" type="password" value={confirmPw} onChange={e => setConfirmPw(e.target.value)} placeholder="••••••••" minLength={6} />
            </div>
            <button className="btn btn-primary" onClick={handleReset} disabled={loading || !newPw || !confirmPw} style={{ width: '100%', justifyContent: 'center' }}>
              {loading ? 'Updating...' : 'Set New Password'}
            </button>
            <div style={{ textAlign: 'center', marginTop: 20 }}>
              <a href="/" style={{ color: 'var(--accent)', fontSize: 14, textDecoration: 'none' }}>Back to login</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
