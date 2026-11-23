'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ViewerTab } from '@/components/BottomTabBar';

export function ViewerHeader({ page }: { page: Exclude<ViewerTab, 'home'> }) {
  const locale = useLocale();
  const t = useTranslations('home');
  const otherLocale = locale === 'en' ? 'zh-CN' : 'en';
  const route = page === 'categories' ? '/categories' : '/me';

  return (
    <header className="topbar">
      <div className="topbar-inner viewer-topbar-inner">
        <Link className="brand" href={'/' + locale} aria-label="RED Stories home">
          <span className="brand-mark"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24"><path d="m9 6 10 6-10 6V6Z" fill="currentColor" stroke="none" /></svg></span>
          <span className="brand-word"><strong>RED</strong><span>STORIES</span></span>
        </Link>
        <span className="brand-tagline">{t('tagline')}</span>
        <div className="topbar-actions">
          <Link href={'/' + otherLocale + route} className="language-toggle" aria-label={t('changeLanguage')}>
            {locale === 'en' ? 'EN' : '中文'}
          </Link>
        </div>
      </div>
    </header>
  );
}
