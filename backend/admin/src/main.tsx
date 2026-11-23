import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Alert, Button, ConfigProvider, Input, Spin } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import { Dashboard } from './Dashboard';
import { DramaList, DramaEditor, type EditorHandle } from './Dramas';
import { Episodes } from './Episodes';
import { EpisodeUploads } from './EpisodeUploads';
import { Taxonomy } from './Taxonomy';
import { HomeOperations } from './HomeOperations';
import { dedupeGet } from './dedupe-get';
import './i18n';
import './style.css';

type Auth = { state: 'checking' } | { state: 'unavailable' } | { state: 'anonymous'; expired?: boolean } | { state: 'signedIn'; username: string };

function App() {
  const { t, i18n } = useTranslation();
  const [auth, setAuth] = useState<Auth>({ state: 'checking' });
  const [check, setCheck] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const english = i18n.language === 'en';
  const onExpired = useCallback(() => { setPassword(''); setAuth({ state: 'anonymous', expired: true }); }, []);

  useEffect(() => { document.documentElement.lang = i18n.language; }, [i18n.language]);
  useEffect(() => {
    let active = true;
    setAuth({ state: 'checking' });
    dedupeGet<Auth>('/api/auth/me', async () => {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (response.status === 401) return { state: 'anonymous' };
      if (!response.ok) throw new Error('Session check failed');
      const data: unknown = await response.json();
      if (typeof data !== 'object' || data === null || !('username' in data) || typeof data.username !== 'string') throw new Error('Invalid response');
      return { state: 'signedIn', username: data.username };
    }).then((result) => { if (active) setAuth(result); }).catch(() => { if (active) setAuth({ state: 'unavailable' }); });
    return () => { active = false; };
  }, [check]);

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
      if (response.status === 401) { setError('invalidCredentials'); return; }
      if (response.status === 429) { setError('tooMany'); return; }
      if (!response.ok) throw new Error('Login failed');
      const data: unknown = await response.json();
      if (typeof data !== 'object' || data === null || !('username' in data) || typeof data.username !== 'string') throw new Error('Invalid response');
      setPassword(''); setAuth({ state: 'signedIn', username: data.username });
    } catch { setError('authUnavailable'); } finally { setBusy(false); }
  }

  const logout = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok && response.status !== 401) throw new Error('Logout failed');
      setPassword(''); setError(''); setAuth({ state: 'anonymous' });
    } catch { setError('logoutFailed'); }
  }, []);

  if (auth.state === 'signedIn') return <><Workspace username={auth.username} onLogout={() => void logout()} onExpired={onExpired} />{error && <div className="global-error" role="alert">{t(error)}</div>}</>;

  return <ConfigProvider locale={english ? enUS : zhCN} theme={{ token: { colorPrimary: '#d64e45', borderRadius: 8, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>
    <main className="login-page">
      <header className="login-header"><div className="login-brand"><span className="brand-mark"><span /></span><div><strong>RED VIDEO</strong><small>{t('product')}</small></div></div><div className="language-switch" role="group" aria-label={t('language')}><button type="button" className={!english ? 'selected' : ''} aria-pressed={!english} onClick={() => void i18n.changeLanguage('zh-CN')}>中</button><button type="button" className={english ? 'selected' : ''} aria-pressed={english} onClick={() => void i18n.changeLanguage('en')}>EN</button></div></header>
      <div className="login-content"><div className="login-card"><div className="login-kicker">RED VIDEO / MANAGEMENT</div><h1>{t('loginTitle')}</h1><p className="login-intro">{t('loginIntro')}</p>
        {auth.state === 'checking' && <div className="auth-check"><Spin size="small" /> {t('checkingSession')}</div>}
        {auth.state === 'unavailable' && <div className="auth-error"><Alert type="error" showIcon title={t('authUnavailable')} /><Button onClick={() => setCheck((value) => value + 1)}>{t('retry')}</Button></div>}
        {auth.state === 'anonymous' && <form onSubmit={(event) => void login(event)}>
          {auth.expired && <Alert type="warning" showIcon title={t('sessionExpired')} className="login-alert" />}
          {error && <Alert type="error" showIcon title={t(error)} className="login-alert" />}
          <label htmlFor="username">{t('username')}</label><Input id="username" autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required maxLength={64} disabled={busy} />
          <label htmlFor="password">{t('password')}</label><Input.Password id="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required maxLength={256} disabled={busy} />
          <Button type="primary" htmlType="submit" loading={busy} block>{busy ? t('loggingIn') : t('login')}</Button>
        </form>}
      </div></div>
    </main>
  </ConfigProvider>;
}

function Workspace({ username, onLogout, onExpired }: { username: string; onLogout: () => void; onExpired: () => void }) {
  const [path, setPath] = useState(() => window.location.pathname === '/' ? '/dramas' : window.location.pathname);
  const editor = useRef<EditorHandle>(null);
  const listUrl = useRef(window.location.pathname === '/dramas' ? window.location.pathname + window.location.search : '/dramas');
  useEffect(() => {
    if (window.location.pathname === '/') window.history.replaceState(null, '', '/dramas');
  }, []);
  const go = useCallback((requested: string, replace = false) => {
    if (window.location.pathname === '/dramas') listUrl.current = window.location.pathname + window.location.search;
    const target = requested === '/' ? '/dramas' : requested === '/dramas' ? listUrl.current : requested;
    if (replace) window.history.replaceState(null, '', target); else window.history.pushState(null, '', target);
    setPath(window.location.pathname);
  }, []);
  const navigate = useCallback((requested: string) => {
    const next = () => go(requested);
    if (editor.current) editor.current.requestLeave(next); else next();
  }, [go]);
  useEffect(() => { if (path === '/media') go('/dramas', true); }, [path, go]);
  useEffect(() => {
    const pop = () => {
      const targetPath = window.location.pathname === '/' ? '/dramas' : window.location.pathname;
      const target = targetPath + window.location.search;
      if (window.location.pathname === '/') window.history.replaceState(null, '', target);
      if (editor.current?.isDirty()) {
        window.history.pushState(null, '', path);
        editor.current.requestLeave(() => go(target));
      } else {
        if (targetPath === '/dramas') listUrl.current = target;
        setPath(targetPath);
      }
    };
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, [go, path]);
  const match = path.match(/^\/dramas\/([0-9a-f-]+)\/edit$/i);
  const episodeMatch = path.match(/^\/dramas\/([0-9a-f-]+)\/episodes$/i);
  const uploadMatch = path.match(/^\/dramas\/([0-9a-f-]+)\/uploads$/i);
  const isEditor = path === '/dramas/new' || !!match;
  return <Dashboard username={username} onLogout={() => { if (editor.current) editor.current.requestLeave(onLogout); else onLogout(); }} route={path} navigate={navigate}>
    {isEditor ? <DramaEditor key={match?.[1] ?? 'new'} ref={editor} id={match?.[1]} onBack={() => navigate('/dramas')} onCreated={(id) => go(`/dramas/${id}/edit`, true)} onManage={(id) => go(`/dramas/${id}/episodes`)} onExpired={onExpired} /> : episodeMatch ? <Episodes key={episodeMatch[1]} dramaId={episodeMatch[1]} navigate={navigate} onExpired={onExpired} /> : uploadMatch ? <EpisodeUploads key={uploadMatch[1]} dramaId={uploadMatch[1]} navigate={navigate} onExpired={onExpired} /> : path === '/categories' || path === '/tags' ? <Taxonomy key={path} kind={path === '/categories' ? 'categories' : 'tags'} onExpired={onExpired} /> : path === '/home-operations' ? <HomeOperations onExpired={onExpired} /> : <DramaList navigate={navigate} onExpired={onExpired} />}
  </Dashboard>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
