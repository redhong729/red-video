'use client';

import { useLocale, useTranslations } from 'next-intl';

export function SearchForm({ initialQuery = '' }: { initialQuery?: string }) {
  const locale = useLocale();
  const t = useTranslations('home');

  return (
    <form className="search-box" role="search" action={'/' + locale + '/search'} method="get">
      <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="6.5" />
        <path d="m16 16 4.5 4.5" />
      </svg>
      <input
        type="search"
        name="q"
        defaultValue={initialQuery}
        maxLength={120}
        aria-label={t('search')}
        placeholder={t('search')}
        required
      />
      <button className="search-submit" type="submit" aria-label={t('search')}>
        <svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12h14" />
          <path d="m13 6 6 6-6 6" />
        </svg>
      </button>
    </form>
  );
}
