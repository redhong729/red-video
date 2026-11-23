'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';

export type ViewerTab = 'home' | 'categories' | 'me';

function TabIcon({ name }: { name: ViewerTab }) {
  const iconProps = { 'aria-hidden': true as const, width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  if (name === 'home') return <svg {...iconProps}><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></svg>;
  if (name === 'categories') return <svg {...iconProps}><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></svg>;
  return <svg {...iconProps}><circle cx="12" cy="8" r="3.5" /><path d="M4.5 20a7.5 7.5 0 0 1 15 0" /></svg>;
}

export function BottomTabBar({ active }: { active: ViewerTab }) {
  const locale = useLocale();
  const t = useTranslations('home');
  const tabs: { id: ViewerTab; href: string; label: string }[] = [
    { id: 'home', href: `/${locale}`, label: t('homeTab') },
    { id: 'categories', href: `/${locale}/categories`, label: t('categoriesTab') },
    { id: 'me', href: `/${locale}/me`, label: t('meTab') },
  ];

  return (
    <nav className="bottom-nav" aria-label={t('mainNavigation')}>
      {tabs.map((tab) => (
        <Link key={tab.id} href={tab.href} className={'nav-item' + (active === tab.id ? ' active' : '')} aria-current={active === tab.id ? 'page' : undefined}>
          <TabIcon name={tab.id} />
          <span>{tab.label}</span>
        </Link>
      ))}
    </nav>
  );
}
