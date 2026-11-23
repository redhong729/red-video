import { useEffect, type ReactNode } from 'react';
import { ConfigProvider } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import './i18n';
import './style.css';

type Crumb = { label: string; path?: string };

function GridIcon() {
  return <svg aria-hidden="true" width="17" height="17" viewBox="0 0 20 20" fill="none"><rect x="2.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11.5" y="2.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="2.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/><rect x="11.5" y="11.5" width="6" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5"/></svg>;
}

export function Dashboard({ username, onLogout, route, navigate, children }: { username: string; onLogout: () => void; route: string; navigate: (path: string) => void; children?: ReactNode }) {
  const { t, i18n } = useTranslation();

  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);

  const crumbs: Crumb[] = [];
  if (route.startsWith('/dramas')) {
    crumbs.push({ label: t('dramas'), ...(route === '/dramas' ? {} : { path: '/dramas' }) });
    if (route === '/dramas/new') crumbs.push({ label: t('newDrama') });
    else if (/^\/dramas\/[^/]+\/edit$/.test(route)) crumbs.push({ label: t('editDrama') });
    else if (/^\/dramas\/[^/]+\/episodes$/.test(route)) crumbs.push({ label: t('episodes') });
    else if (/^\/dramas\/[^/]+\/uploads$/.test(route)) crumbs.push({ label: t('uploadTitle') });
  } else if (route === '/categories' || route === '/tags') {
    crumbs.push({ label: t(route === '/categories' ? 'categoryManagement' : 'tagManagement') });
  } else if (route === '/home-operations') {
    crumbs.push({ label: t('homeOperations') });
  } else {
    crumbs.push({ label: t('dramas') });
  }

  const english = i18n.language === 'en';
  const navButton = (path: string, label: string, icon: ReactNode) => (
    <button type="button" className={route === path || (path === '/dramas' && route.startsWith('/dramas')) ? 'nav-active nav-button' : 'nav-button'} aria-current={route === path || (path === '/dramas' && route.startsWith('/dramas')) ? 'page' : undefined} onClick={() => navigate(path)}>
      {icon}<span>{label}</span>
    </button>
  );

  return <ConfigProvider locale={english ? enUS : zhCN} theme={{ token: { colorPrimary: '#d64e45', borderRadius: 8, fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' } }}>
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><span /></span><div><strong>RED VIDEO</strong><small>{t('product')}</small></div></div>
        <div className="sidebar-label">{t('contentSection')}</div>
        <nav aria-label={t('contentSection')}>
          {navButton('/home-operations', t('homeOperations'), <span className="nav-film" aria-hidden="true">⌖</span>)}
          {navButton('/dramas', t('dramas'), <GridIcon />)}
        </nav>
        <nav aria-label={t('classification')}>
          {navButton('/categories', t('categoryManagement'), <span className="nav-film" aria-hidden="true">▦</span>)}
          {navButton('/tags', t('tagManagement'), <span className="nav-film" aria-hidden="true">◇</span>)}
        </nav>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <nav className="topbar-breadcrumb" aria-label={t('breadcrumbLabel')}><ol>{crumbs.map((crumb, index) => <li key={crumb.path ?? crumb.label}>{index > 0 && <span className="breadcrumb-separator" aria-hidden="true">/</span>}{index === crumbs.length - 1 ? <span className="breadcrumb-current" aria-current="page">{crumb.label}</span> : <button type="button" onClick={() => navigate(crumb.path!)}>{crumb.label}</button>}</li>)}</ol></nav>
          <div className="topbar-right"><span className="account-name">{username}</span><button type="button" className="logout-button" onClick={onLogout}>{t('logout')}</button><div className="language-switch" role="group" aria-label={t('language')}><button type="button" className={!english ? 'selected' : ''} aria-pressed={!english} onClick={() => void i18n.changeLanguage('zh-CN')}>中</button><button type="button" className={english ? 'selected' : ''} aria-pressed={english} onClick={() => void i18n.changeLanguage('en')}>EN</button></div></div>
        </header>
        <main className="content wide-content">{children}</main>
      </div>
    </div>
  </ConfigProvider>;
}
