import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { PlaybackPage } from '@/components/PlaybackPage';
import { locales } from '@/i18n/routing';

export default async function LocalizedPlaybackPage({
  params
}: {
  params: Promise<{ locale: string; id: string; episodeId: string }>;
}) {
  const { locale, id, episodeId } = await params;
  if (!hasLocale(locales, locale)) notFound();

  setRequestLocale(locale);
  return <PlaybackPage dramaId={id} episodeId={episodeId} />;
}
