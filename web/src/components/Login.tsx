import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { Logo } from '../App';

declare global {
  interface Window {
    google?: any;
  }
}

export function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [cfg, setCfg] = useState<{ googleClientId: string | null; devLogin: boolean } | null>(null);
  const [err, setErr] = useState('');
  const [devEmail, setDevEmail] = useState('');
  const btn = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.authConfig().then(setCfg).catch((e) => setErr(e.message));
  }, []);

  useEffect(() => {
    if (!cfg?.googleClientId) return;
    const init = () => {
      window.google.accounts.id.initialize({
        client_id: cfg.googleClientId,
        callback: async (r: { credential: string }) => {
          try {
            await api.googleLogin(r.credential);
            onSignedIn();
          } catch (e) {
            setErr((e as Error).message);
          }
        },
      });
      if (btn.current) {
        window.google.accounts.id.renderButton(btn.current, { theme: 'outline', size: 'large', text: 'signin_with', width: 280 });
      }
    };
    if (window.google?.accounts) return init();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = init;
    document.head.appendChild(s);
  }, [cfg, onSignedIn]);

  return (
    <div className="auth">
      <div className="auth-card">
        <img src="/logo.png" alt="EquaRoots — everyday calm & clarity" className="auth-logo" />
        <p className="muted">Doctor Dashboard — sign in with your Google account.</p>
        {cfg?.googleClientId ? (
          <div ref={btn} className="gbtn" />
        ) : (
          cfg && <p className="muted small">Google sign-in isn’t configured (set GOOGLE_OAUTH_CLIENT_ID).</p>
        )}
        {cfg?.devLogin && (
          <form
            className="dev-login"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api.devLogin(devEmail);
                onSignedIn();
              } catch (e2) {
                setErr((e2 as Error).message);
              }
            }}
          >
            <div className="small muted">Dev login (AUTH_DEV_LOGIN=true)</div>
            <input type="email" placeholder="email@equaroots.com" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
            <button className="btn primary">Continue</button>
          </form>
        )}
        {err && <p className="error">{err}</p>}
      </div>
    </div>
  );
}

export function NotSetUp({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <Logo />
        <h1>You’re not set up as a doctor yet</h1>
        <p className="muted">
          You’re signed in as <b>{email}</b>, but this email isn’t in the doctors list. Ask an admin to add it, then
          sign in again.
        </p>
        <button className="btn ghost" onClick={onSignOut}>
          Sign in with a different account
        </button>
      </div>
    </div>
  );
}
