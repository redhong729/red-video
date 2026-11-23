'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { BottomTabBar } from '@/components/BottomTabBar';
import { ViewerHeader } from '@/components/ViewerHeader';
import { InstallHomeScreenCard } from '@/components/InstallHomeScreenCard';

export function MePage() {
  const t = useTranslations('home');
  const locale = useLocale();
  const otherLocale = locale === 'en' ? 'zh-CN' : 'en';

  return (
    <div className="site-shell">
      <ViewerHeader page="me" />
      <main className="subpage-main page-width me-page">
        <section className="profile-page-card">
          <span className="profile-avatar"><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg></span>
          <p className="eyebrow">{t('yourSpace')}</p>
          <h1>{t('guest')}</h1>
          <p className="profile-page-intro">{t('guestCopy')}</p>
        </section>

        <InstallHomeScreenCard />

        <section className="watchlist-card profile-watchlist">
          <span className="watchlist-heart"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.4 8.7c0 4.1-8.4 9.3-8.4 9.3S3.6 12.8 3.6 8.7A4.2 4.2 0 0 1 12 6.8a4.2 4.2 0 0 1 8.4 1.9Z" /></svg></span>
          <div><strong>{t('savedSoon')}</strong><p>{t('savedCopy')}</p></div>
        </section>

        <Link className="language-row profile-language-row" href={'/' + otherLocale + '/me'}>
          <span>{t('languageSetting')}</span>
          <span className="language-row-current">{locale === 'en' ? 'English' : '简体中文'}</span>
        </Link>
      </main>
      <BottomTabBar active="me" />
    </div>
  );
}
