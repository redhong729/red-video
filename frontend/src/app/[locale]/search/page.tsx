import { hasLocale } from 'next-intl';
import { setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';
import { SearchResultsPage } from '@/components/SearchResultsPage';
import { locales } from '@/i18n/routing';

export default async function LocalizedSearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const [{ locale }, queryParams] = await Promise.all([params, searchParams]);
  if (!hasLocale(locales, locale)) notFound();
  setRequestLocale(locale);

  const rawQuery = Array.isArray(queryParams.q) ? queryParams.q[0] ?? '' : queryParams.q ?? '';
  return <SearchResultsPage query={rawQuery.trim().slice(0, 120)} />;
}
