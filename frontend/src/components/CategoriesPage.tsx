'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BottomTabBar } from '@/components/BottomTabBar';
import { StoryCard } from '@/components/StoryCard';
import { ViewerHeader } from '@/components/ViewerHeader';
import { useCategoriesDirectory } from '@/lib/home-data';

export function CategoriesPage() {
  const t = useTranslations('home');
  const locale = useLocale();
  const { stories, taxonomy, loading, failed, retry } = useCategoriesDirectory(locale);
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [activeTagId, setActiveTagId] = useState<string | null>(null);
  const activeCategory = taxonomy.categories.find((category) => category.id === activeCategoryId) ?? null;
  const activeTag = taxonomy.tags.find((tag) => tag.id === activeTagId) ?? null;
  const visibleStories = useMemo(() => stories.filter((story) =>
    (!activeCategoryId || story.categoryId === activeCategoryId)
    && (!activeTagId || story.tagIds.includes(activeTagId))), [activeCategoryId, activeTagId, stories]);

  return (
    <div className="site-shell">
      <ViewerHeader page="categories" />
      <main className="subpage-main categories-main page-width">
        <section className="category-directory" aria-label={t('categoriesTab')}>
          <div className="category-filter-row category-filter-categories">
            <div className="category-filter-options">
              <button type="button" className={'category-chip' + (activeCategoryId === null ? ' selected' : '')} aria-pressed={activeCategoryId === null} onClick={() => { setActiveCategoryId(null); setActiveTagId(null); }}>{t('allCategories')}</button>
              {taxonomy.categories.map((category) => <button type="button" className={'category-chip' + (activeCategoryId === category.id ? ' selected' : '')} aria-pressed={activeCategoryId === category.id} key={category.id} onClick={() => { setActiveCategoryId(activeCategoryId === category.id ? null : category.id); setActiveTagId(null); }}>{category.name}</button>)}
            </div>
          </div>
          <div className="category-filter-row category-filter-tags">
            <div className="category-filter-options">
              <button type="button" className={'category-chip' + (activeTagId === null ? ' selected' : '')} aria-pressed={activeTagId === null} onClick={() => setActiveTagId(null)}>{t('allTags')}</button>
              {taxonomy.tags.map((tag) => <button type="button" className={'category-chip' + (activeTagId === tag.id ? ' selected' : '')} aria-pressed={activeTagId === tag.id} key={tag.id} onClick={() => setActiveTagId(activeTagId === tag.id ? null : tag.id)}>{tag.name}</button>)}
            </div>
          </div>
        </section>

        <section className="category-results">
          <div className="series-heading">
            <div className="series-heading-copy"><p className="eyebrow">{activeCategory?.name ?? activeTag?.name ?? t('popularEyebrow')}</p><h2>{activeTag?.name ?? activeCategory?.name ?? t('popularTitle')}</h2></div>
            <span className="category-result-count">{t('storyCount', { count: visibleStories.length })}</span>
          </div>
          {loading ? <div className="story-empty-state">{t('storiesLoading')}</div>
            : failed ? <div className="story-empty-state"><p>{t('storiesFailed')}</p><button className="text-button" type="button" onClick={retry}>{t('retry')}</button></div>
              : visibleStories.length ? <div className="drama-rail category-story-rail">{visibleStories.map((story, index) => <StoryCard key={story.id} story={story} index={index} />)}</div>
                : <div className="story-empty-state"><h2>{t('categoriesEmptyTitle')}</h2><p>{t('categoriesEmptyBody')}</p></div>}
        </section>
      </main>
      <BottomTabBar active="categories" />
    </div>
  );
}
