'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import type { HomeStory } from '@/lib/catalog';

const posterTints = ['#86505b', '#4c6661', '#6c566e', '#8b684e', '#4d6478'];

export function StoryCard({ story, index = 0 }: { story: HomeStory; index?: number }) {
  const locale = useLocale();
  const detailHref = `/${locale}/dramas/${encodeURIComponent(story.id)}`;
  const coverStyle = story.coverUrl
    ? `linear-gradient(180deg, rgba(17,15,19,.02) 36%, rgba(17,15,19,.45) 100%), url("${story.coverUrl}")`
    : `linear-gradient(145deg, ${posterTints[index % posterTints.length]}, #201a21)`;
  const image = (
    <div className="poster-image" style={{ backgroundColor: posterTints[index % posterTints.length], backgroundImage: coverStyle }}>
    </div>
  );

  return (
    <article className="drama-card">
      <Link className="poster-button" href={detailHref} aria-label={story.title}>{image}</Link>
      <div className="drama-card-info">
        <Link className="drama-card-title-link" href={detailHref}><h3>{story.title}</h3></Link>
        {story.tags.length > 0 && <div className="story-tag-list" aria-label="Tags">{story.tags.map((tag) => <span className="story-tag" key={tag}>{tag}</span>)}</div>}
      </div>
    </article>
  );
}
