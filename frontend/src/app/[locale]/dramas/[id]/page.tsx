import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { DramaDetailPage } from '@/components/DramaDetailPage';
import { locales } from '@/i18n/routing';

export default async function LocalizedDramaDetailPage({
  params
}: {
  params: Promise<{ locale: string; id: string }>;
}) {
  const { locale, id } = await params;
  if (!hasLocale(locales, locale)) notFound();

  setRequestLocale(locale);
  return <DramaDetailPage dramaId={id} />;
}
