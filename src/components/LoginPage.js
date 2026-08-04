import { useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function LoginPage({ onAuth }) {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setSuccess(''); setLoading(true);
    try {
      if (isSignUp) {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.user && !data.session) {
          setSuccess('Check your email for a confirmation link, then sign in.');
        } else {
          onAuth(data.session);
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        onAuth(data.session);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-bg" />
      <div className="login-card fade-in">
        <h1>Portfolio Lens</h1>
        <p className="subtitle">Investment Tracking</p>
        {error && <div className="login-error">{error}</div>}
        {success && <div className="login-success">{success}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" value={email} onChange={e => setEmail(e.target.value)} required placeholder="you@email.com" />
          </div>
          <div className="form-group">
            <label className="form-label">Password</label>
            <input className="form-input" type="password" value={password} onChange={e => setPassword(e.target.value)} required placeholder="••••••••" minLength={6} />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Please wait...' : isSignUp ? 'Create Account' : 'Sign In'}
          </button>
        </form>
        <div className="login-toggle">
          {isSignUp ? 'Already have an account? ' : "Don't have an account? "}
          <a onClick={() => { setIsSignUp(!isSignUp); setError(''); setSuccess(''); }}>
            {isSignUp ? 'Sign in' : 'Sign up'}
          </a>
        </div>
      </div>
    </div>
  );
}
