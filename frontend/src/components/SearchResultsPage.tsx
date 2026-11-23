'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BottomTabBar } from '@/components/BottomTabBar';
import { SearchForm } from '@/components/SearchForm';
import { StoryCard } from '@/components/StoryCard';
import { requestSearchStories } from '@/lib/home-data';
import type { HomeStory } from '@/lib/catalog';

export function SearchResultsPage({ query }: { query: string }) {
  const locale = useLocale();
  const t = useTranslations('home');
  const [stories, setStories] = useState<HomeStory[]>([]);
  const [loading, setLoading] = useState(Boolean(query));
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);
  const normalizedQuery = query.trim();
  const otherLocale = locale === 'en' ? 'zh-CN' : 'en';
  const languageHref = normalizedQuery
    ? `/${otherLocale}/search?q=${encodeURIComponent(normalizedQuery)}`
    : `/${otherLocale}/search`;

  useEffect(() => {
    let active = true;
    if (!normalizedQuery) {
      setStories([]);
      setFailed(false);
      setLoading(false);
      return () => { active = false; };
    }

    setLoading(true);
    setFailed(false);
    requestSearchStories(locale, normalizedQuery)
      .then((items) => { if (active) setStories(items); })
      .catch(() => {
        if (!active) return;
        setStories([]);
        setFailed(true);
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [locale, normalizedQuery, reload]);

  return (
    <div className="site-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="brand" href={'/' + locale} aria-label="RED Stories home">
            <span className="brand-mark"><svg aria-hidden="true" width="17" height="17" viewBox="0 0 24 24"><path d="m9 6 10 6-10 6V6Z" fill="currentColor" stroke="none" /></svg></span>
            <span className="brand-word"><strong>RED</strong><span>STORIES</span></span>
          </Link>
          <span className="brand-tagline">{t('tagline')}</span>
          <SearchForm initialQuery={normalizedQuery} />
          <div className="topbar-actions">
            <Link href={languageHref} className="language-toggle" aria-label={t('changeLanguage')}>
              {locale === 'en' ? 'EN' : '中文'}
            </Link>
          </div>
        </div>
      </header>

      <main className="subpage-main search-results-main page-width">
        <section className="search-results-section" aria-labelledby="search-results-title">
          <div className="series-heading">
            <div className="series-heading-copy">
              <p className="eyebrow">{t('searchResultsLabel')}</p>
              <h1 id="search-results-title" className="search-results-title">
                {normalizedQuery ? t('searchResultsFor', { query: normalizedQuery }) : t('searchPromptTitle')}
              </h1>
            </div>
            {normalizedQuery && !loading && !failed && <span className="category-result-count">{t('storyCount', { count: stories.length })}</span>}
          </div>

          {loading ? <div className="story-empty-state">{t('storiesLoading')}</div>
            : failed ? <div className="story-empty-state"><p>{t('storiesFailed')}</p><button className="text-button" type="button" onClick={() => setReload((value) => value + 1)}>{t('retry')}</button></div>
              : !normalizedQuery ? <div className="story-empty-state"><h2>{t('searchPromptTitle')}</h2><p>{t('searchPromptBody')}</p></div>
                : stories.length > 0 ? <div className="drama-grid search-results-grid">{stories.map((story, index) => <StoryCard key={story.id} story={story} index={index} />)}</div>
                  : <div className="story-empty-state"><h2>{t('emptyTitle')}</h2><p>{t('emptyBody')}</p></div>}
        </section>
      </main>

      <BottomTabBar active="home" />
    </div>
  );
}
