import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { MePage } from '@/components/MePage';
import { locales } from '@/i18n/routing';

export default async function LocalizedMePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);
  return <MePage />;
}
