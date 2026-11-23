import { useEffect, useImperativeHandle, useMemo, useState, forwardRef } from 'react';
import { Alert, Button, ConfigProvider, Input, InputNumber, message, Modal, Popconfirm, Select, Spin, Table, Tabs, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { BackIcon } from './BackIcon';
import { DramaCover } from './DramaCover';
import { OfflineButton } from './OfflineButton';
import { PublishActionButton } from './PublishActionButton';
import { StatePill } from './StatePill';
import { dedupeGet } from './dedupe-get';

type Option = { id: string; name: string | null; active?: boolean };
type Options = { categories: Option[]; tags: Option[] };
type Translation = { locale: string; title: string; description: string };
type Actor = { name: string; roleName: string };
type Draft = { translations: Translation[]; categoryId: string | null; tagIds: string[]; actors: Actor[]; totalEpisodes: number | null; sortOrder: number; pricingMode: string | null; freeEpisodes: number | null; priceCredits: number | null; previewSeconds: number };
type Row = { id: string; status: string; title: string | null; categoryName: string | null; categoryId: string | null; coverKey: string | null; tags: Option[]; totalEpisodes: number | null; publishedEpisodes: number; uploadedEpisodes: number; sortOrder: number; pricingMode: string | null; updatedAt: string };
type ListResult = { items: Row[]; total: number; page: number; pageSize: number };
type Detail = { id: string; status: string; draft: { coverKey: string | null; translations: { locale: string; title: string | null; description: string | null }[]; categoryId: string | null; tags: { tagId: string }[]; actors: { name: string; roleName: string | null }[]; totalEpisodes: number | null; sortOrder: number; pricingMode: string | null; freeEpisodes: number | null; priceCredits: number | null; previewSeconds: number } };

class ApiError extends Error { constructor(public status: number, detail = '') { super(detail || `HTTP ${status}`); } }
function request<T>(url: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase();
  const { signal, ...requestOptions } = options ?? {};
  const load = async () => {
    const response = await fetch(url, { ...requestOptions, ...(method === 'GET' ? {} : { signal }), cache: 'no-store' });
    if (!response.ok) {
      const data: unknown = await response.json().catch(() => null);
      const detail = data && typeof data === 'object' && 'message' in data && typeof data.message === 'string' ? data.message : '';
      throw new ApiError(response.status, detail);
    }
    return response.json() as Promise<T>;
  };
  return method === 'GET' ? dedupeGet(url, load) : load();
}
const makeEmpty = (): Draft => ({ translations: [{ locale: 'zh-CN', title: '', description: '' }, { locale: 'en', title: '', description: '' }], categoryId: null, tagIds: [], actors: [], totalEpisodes: null, sortOrder: 0, pricingMode: null, freeEpisodes: null, priceCredits: null, previewSeconds: 30 });
const label = (item: Option, missing: string, inactive?: string) => `${item.name ?? `${missing} · ${item.id.slice(0, 8)}`}${item.active === false && inactive ? ` (${inactive})` : ''}`;

function useOptions(locale: string, onExpired: () => void, preserveOnExpired = false) {
  const [options, setOptions] = useState<Options>({ categories: [], tags: [] });
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError(false);
    request<Options>(`/api/dramas/options?locale=${encodeURIComponent(locale)}`).then((value) => { if (active) setOptions(value); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401 && !preserveOnExpired) onExpired();
      else setError(true);
    });
    return () => { active = false; };
  }, [locale, onExpired, reload, preserveOnExpired]);
  return { options, error, retry: () => setReload((n) => n + 1) };
}

export function DramaList({ navigate, onExpired }: { navigate: (path: string) => void; onExpired: () => void }) {
  const { t, i18n } = useTranslation();
  const [params, setParams] = useState(() => new URLSearchParams(window.location.search));
  const [searchText, setSearchText] = useState(params.get('keyword') ?? '');
  const [from, setFrom] = useState(params.get('fromLocal') ?? '');
  const [to, setTo] = useState(params.get('toLocal') ?? '');
  const [advanced, setAdvanced] = useState(!!(params.get('pricingMode') || params.get('fromLocal') || params.get('toLocal')));
  const [dateError, setDateError] = useState(false);
  const [result, setResult] = useState<ListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const { options, error: optionsError, retry: retryOptions } = useOptions(i18n.language, onExpired);
  const category = params.get('categoryId') ?? '';
  const tags = (params.get('tagIds') ?? '').split(',').filter(Boolean);
  const page = Number(params.get('page') || '1'); const pageSize = Number(params.get('pageSize') || '20');
  function update(changes: Record<string, string | null>, resetPage = true) {
    setSelected([]);
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) { if (value) next.set(key, value); else next.delete(key); }
    if (resetPage) next.delete('page');
    setParams(next);
    window.history.replaceState(null, '', `/dramas${next.size ? `?${next}` : ''}`);
  }
  async function deleteDrama(row: Row) {
    if (deleting.includes(row.id)) return;
    setDeleting((current) => [...current, row.id]);
    try {
      await request(`/api/dramas/${row.id}`, { method: 'DELETE' });
      void message.success(t('dramaDeleted'));
      setSelected((current) => current.filter((id) => id !== row.id));
      if (result?.items.length === 1 && page > 1) update({ page: String(page - 1) }, false);
      else setReload((value) => value + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else if (err instanceof ApiError && err.status === 409) void message.error(t(err.message.toLowerCase().includes('media tasks') ? 'deleteWaitForTasks' : 'deleteUnavailable'));
      else void message.error(t('dramaDeleteError'));
    } finally {
      setDeleting((current) => current.filter((id) => id !== row.id));
    }
  }
  useEffect(() => {
    let active = true;
    setLoading(true); setError(false);
    const query = new URLSearchParams(params);
    const localFrom = query.get('fromLocal'); const localTo = query.get('toLocal');
    query.delete('fromLocal'); query.delete('toLocal');
    if ((localFrom && Number.isNaN(new Date(localFrom).getTime())) || (localTo && Number.isNaN(new Date(localTo).getTime()))) {
      setError(true); setLoading(false);
      return () => { active = false; };
    }
    if (localFrom) query.set('updatedFrom', new Date(localFrom).toISOString());
    if (localTo) query.set('updatedTo', new Date(localTo).toISOString());
    query.set('locale', i18n.language);
    request<ListResult>(`/api/dramas?${query}`).then((value) => { if (active) setResult(value); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) onExpired(); else setError(true);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [params, i18n.language, onExpired, reload]);
  const hasFilter = !!(params.get('keyword') || params.get('categoryId') || params.get('tagIds') || params.get('status') || params.get('pricingMode') || params.get('fromLocal') || params.get('toLocal'));
  const statusLabel: Record<string, string> = { DRAFT: t('draft'), IN_REVIEW: t('inReview'), PUBLISHED: t('published'), OFFLINE: t('offline') };
  const priceLabel: Record<string, string> = { FREE: t('free'), PER_EPISODE: t('perEpisode') };
  const columns = [
    { title: t('cover'), key: 'cover', width: 75, render: (_: unknown, row: Row) => row.coverKey ? <img className="episode-cover" src={`/api/dramas/${row.id}/cover?v=${encodeURIComponent(row.coverKey)}`} alt={t('cover')} /> : <div className="cover-placeholder">{t('noCover')}</div> },
    { title: t('titleColumn'), key: 'title', render: (_: unknown, row: Row) => <div className="drama-title">{row.title ?? '—'}<span className="drama-id">{row.id}</span></div> },
    { title: t('category'), key: 'category', render: (_: unknown, row: Row) => row.categoryId ? (row.categoryName ?? t('missingTranslation')) : <span className="table-muted">{t('notSet')}</span> },
    { title: t('tags'), key: 'tags', render: (_: unknown, row: Row) => row.tags.length ? row.tags.map((tag) => <Tag key={tag.id}>{label(tag, t('missingTranslation'))}</Tag>) : <span className="table-muted">—</span> },
    { title: t('episodeCount'), key: 'episodes', render: (_: unknown, row: Row) => <span>{row.publishedEpisodes} / {row.uploadedEpisodes} / {row.totalEpisodes ?? <StatePill tone="warning">{t('notSet')}</StatePill>}</span> },
    { title: t('status'), key: 'status', render: (_: unknown, row: Row) => <StatePill tone={row.status === 'PUBLISHED' ? 'success' : row.status === 'OFFLINE' ? 'neutral' : row.status === 'IN_REVIEW' ? 'warning' : 'info'}>{statusLabel[row.status] ?? row.status}</StatePill> },
    { title: t('pricePolicy'), key: 'pricing', render: (_: unknown, row: Row) => row.pricingMode ? <StatePill tone="info">{priceLabel[row.pricingMode]}</StatePill> : <StatePill tone="warning">{t('notSet')}</StatePill> },
    { title: t('sortOrder'), dataIndex: 'sortOrder', key: 'sortOrder' },
    { title: t('updatedTime'), key: 'updatedAt', render: (_: unknown, row: Row) => new Date(row.updatedAt).toLocaleString(i18n.language) },
    { title: t('operations'), key: 'action', width: 335, fixed: 'right' as const, render: (_: unknown, row: Row) => {
      const deleteDisabled = row.status === 'PUBLISHED' || row.status === 'IN_REVIEW';
      return <>
        <Button type="link" disabled={row.status === 'IN_REVIEW'} onClick={() => navigate(`/dramas/${row.id}/edit`)}>{t('edit')}</Button>
        <Button type="link" onClick={() => navigate(`/dramas/${row.id}/episodes`)}>{t('episodes')}</Button>
        {row.status === 'PUBLISHED' ? <><PublishActionButton dramaId={row.id} wholeDrama label={t('publishDramaUpdate')} onDone={() => { setSelected([]); setReload((n) => n + 1); }} onExpired={onExpired} navigate={navigate} link /><OfflineButton link targets={[{ id: row.id, label: row.title ?? row.id }]} onDone={() => { setSelected([]); setReload((n) => n + 1); }} onExpired={onExpired} /></> : ['DRAFT', 'OFFLINE'].includes(row.status) ? <PublishActionButton dramaId={row.id} wholeDrama label={t('publishDrama')} onDone={() => { setSelected([]); setReload((n) => n + 1); }} onExpired={onExpired} navigate={navigate} link /> : null}
        <Popconfirm title={t('dramaDeleteConfirm')} onConfirm={() => void deleteDrama(row)} okText={t('confirm')} cancelText={t('episodeCancel')} okButtonProps={{ danger: true }} disabled={deleteDisabled || deleting.includes(row.id)}>
          <Button type="link" danger disabled={deleteDisabled || deleting.includes(row.id)} loading={deleting.includes(row.id)} title={deleteDisabled ? t('deleteUnavailable') : undefined}>{t('taxonomyDelete')}</Button>
        </Popconfirm>
      </>;
    } },
  ];
  return <>
    <div className="drama-heading"><div><h1>{t('dramas')}</h1><p>{t('dramaIntro')}</p></div><Button type="primary" onClick={() => navigate('/dramas/new')}>＋ {t('addDrama')}</Button></div>
    <section className="drama-panel drama-filter-panel" aria-label={t('listFilters')}>
      {optionsError && <Alert className="episode-notice" type="error" title={t('loadError')} action={<Button onClick={retryOptions}>{t('retry')}</Button>} />}
      <div className="drama-query-row"><Input.Search value={searchText} onChange={(e) => setSearchText(e.target.value)} onSearch={() => update({ keyword: searchText.trim() })} placeholder={t('searchPlaceholder')} enterButton={t('search')} /><Select aria-label={t('status')} value={params.get('status') ?? ''} onChange={(value) => update({ status: value })} options={[{ value: '', label: `${t('status')}: ${t('all')}` }, ...['DRAFT', 'PUBLISHED', 'OFFLINE'].map((value) => ({ value, label: statusLabel[value] }))]} /><Button aria-expanded={advanced} aria-controls="drama-advanced-filters" onClick={() => setAdvanced(!advanced)}>{t('advanced')}</Button><Button onClick={() => { setSelected([]); setSearchText(''); setFrom(''); setTo(''); setDateError(false); const next = new URLSearchParams(); setParams(next); window.history.replaceState(null, '', '/dramas'); }}>{t('reset')}</Button></div>
      <div className="drama-filter-options"><div className="filter-row"><span className="filter-label">{t('category')}</span><div className="category-buttons" role="group" aria-label={t('category')}><button type="button" className={!category ? 'active' : ''} aria-pressed={!category} onClick={() => update({ categoryId: null })}>{t('all')}</button>{options.categories.map((item) => <button type="button" key={item.id} className={category === item.id ? 'active' : ''} aria-pressed={category === item.id} onClick={() => update({ categoryId: item.id })}>{label(item, t('missingTranslation'), t('taxonomyInactive'))}</button>)}</div>{!options.categories.length && !optionsError && <span className="empty-choices">{t('noCategories')}</span>}</div>
        <div className="filter-row"><span className="filter-label">{t('tags')}</span><div className="category-buttons" role="group" aria-label={t('tags')}><button type="button" className={!tags.length ? 'active' : ''} aria-pressed={!tags.length} onClick={() => update({ tagIds: null })}>{t('all')}</button>{options.tags.map((item) => <button type="button" key={item.id} className={tags.includes(item.id) ? 'active' : ''} aria-pressed={tags.includes(item.id)} onClick={() => update({ tagIds: (tags.includes(item.id) ? tags.filter((id) => id !== item.id) : [...tags, item.id]).join(',') })}>{label(item, t('missingTranslation'), t('taxonomyInactive'))}</button>)}</div>{!options.tags.length && !optionsError && <span className="empty-choices">{t('noTags')}</span>}</div></div>
      {advanced && <div id="drama-advanced-filters" className="advanced-filters"><Select aria-label={t('pricePolicy')} value={params.get('pricingMode') ?? ''} onChange={(value) => update({ pricingMode: value })} options={[{ value: '', label: `${t('pricePolicy')}: ${t('all')}` }, ...Object.entries(priceLabel).map(([value, name]) => ({ value, label: name }))]} /><span className="filter-label">{t('updatedTime')}</span><input aria-label={t('from')} type="datetime-local" value={from} onChange={(e) => setFrom(e.target.value)} /><span>–</span><input aria-label={t('to')} type="datetime-local" value={to} onChange={(e) => setTo(e.target.value)} /><Button onClick={() => { if (from && to && from > to) { setDateError(true); return; } setDateError(false); update({ fromLocal: from, toLocal: to }); }}>{t('search')}</Button>{dateError && <span role="alert">{t('invalidRange')}</span>}</div>}
    </section>
    <section className="drama-panel drama-results-panel"><div className="drama-results-toolbar"><div><h2>{t('dramaListTitle')}</h2><span>{t('dramaListCount', { count: result?.total ?? 0 })}</span></div><div className="drama-bulk-actions">{selected.length > 0 ? <><span>{t('selectedCount', { count: selected.length })}</span><Button type="link" onClick={() => setSelected([])}>{t('clearSelection')}</Button><OfflineButton targets={(result?.items ?? []).filter((row) => selected.includes(row.id)).map((row) => ({ id: row.id, label: row.title ?? row.id }))} onDone={() => { setSelected([]); setReload((n) => n + 1); }} onExpired={onExpired} /></> : <span>{t('bulkOfflineHint')}</span>}</div></div>
      <div className="table-wrap">{error ? <Alert type="error" title={t('loadError')} action={<Button onClick={() => setReload((n) => n + 1)}>{t('retry')}</Button>} /> : <Table<Row> className="drama-table" rowKey="id" columns={columns} dataSource={result?.items ?? []} rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)), getCheckboxProps: (row) => ({ disabled: row.status !== 'PUBLISHED' }) }} loading={loading} scroll={{ x: 1350 }} locale={{ emptyText: hasFilter ? t('noMatches') : t('noDramas') }} pagination={{ current: page, pageSize, total: result?.total ?? 0, showSizeChanger: true, pageSizeOptions: [20, 50, 100], onChange: (p, size) => update({ page: p === 1 ? null : String(p), pageSize: size === 20 ? null : String(size) }, false) }} />}</div>
    </section>
  </>;
}

export type EditorHandle = { requestLeave: (next: () => void) => void; isDirty: () => boolean };
export const DramaEditor = forwardRef<EditorHandle, { id?: string; onBack: () => void; onCreated: (id: string) => void; onManage: (id: string) => void; onExpired: () => void }>(function DramaEditor({ id, onBack, onCreated, onManage, onExpired }, ref) {
  const { t, i18n } = useTranslation();
  const [form, setForm] = useState<Draft>(makeEmpty);
  const [coverKey, setCoverKey] = useState<string | null>(null);
  const [stagedCoverId, setStagedCoverId] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | undefined>();
  const [dramaStatus, setDramaStatus] = useState('DRAFT');
  const [baseline, setBaseline] = useState(() => JSON.stringify(makeEmpty()));
  const [currentLocale, setCurrentLocale] = useState('zh-CN');
  const [newLocale, setNewLocale] = useState('');
  const [localeError, setLocaleError] = useState(false);
  const [loading, setLoading] = useState(!!id);
  const [loadError, setLoadError] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const draftId = id ?? createdId;
  const dirty = JSON.stringify(form) !== baseline || !!stagedCoverId;
  const { options, error: optionsError, retry: retryOptions } = useOptions(i18n.language, onExpired, true);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true); setLoadError(false);
    request<Detail>(`/api/dramas/${id}`).then(({ draft, status }) => {
      if (!active) return;
      const value: Draft = { translations: draft.translations.map((item) => ({ locale: item.locale, title: item.title ?? '', description: item.description ?? '' })), categoryId: draft.categoryId, tagIds: draft.tags.map((item) => item.tagId), actors: draft.actors.map((item) => ({ name: item.name, roleName: item.roleName ?? '' })), totalEpisodes: draft.totalEpisodes, sortOrder: draft.sortOrder, pricingMode: draft.pricingMode, freeEpisodes: draft.freeEpisodes, priceCredits: draft.priceCredits, previewSeconds: draft.previewSeconds };
      setDramaStatus(status); setCoverKey(draft.coverKey); setForm(value); setBaseline(JSON.stringify(value)); setCurrentLocale(value.translations[0]?.locale ?? 'en');
    }).catch((err: unknown) => { if (active) { if (err instanceof ApiError && err.status === 401) onExpired(); else setLoadError(true); } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, reload, onExpired]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useImperativeHandle(ref, () => ({ requestLeave(next) { if (saving) return; if (dirty) setPending(() => next); else next(); }, isDirty: () => dirty || saving }), [dirty, saving]);
  const locales = useMemo(() => form.translations.map((item) => item.locale), [form.translations]);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => { setSaved(false); setError(''); setForm((old) => ({ ...old, [key]: value })); };
  function updateTranslation(locale: string, field: 'title' | 'description', value: string) { set('translations', form.translations.map((item) => item.locale === locale ? { ...item, [field]: value } : item)); }
  async function save(leaving = false, afterSave?: (id: string) => void): Promise<boolean> {
    if (!form.translations.some((item) => item.title.trim())) { setError('requiredTitle'); return false; }
    if (form.actors.some((item) => !item.name.trim())) { setError('actorRequired'); return false; }
    setSaving(true); setError('');
    try {
      const creating = !draftId;
      const response = await request<Detail>(draftId ? `/api/dramas/${draftId}` : '/api/dramas', { method: draftId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      if (creating) setCreatedId(response.id);
      setBaseline(JSON.stringify(form));
      if (stagedCoverId) {
        try {
          const cover = await request<{ coverKey: string }>(`/api/dramas/${response.id}/cover/from-staging`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uploadId: stagedCoverId }) });
          setCoverKey(cover.coverKey);
          setStagedCoverId(null);
        } catch (coverError) {
          setError(coverError instanceof ApiError && coverError.status === 401 ? 'sessionSaveError' : 'dramaCoverError');
          return false;
        }
      }
      setSaved(true);
      if (afterSave) afterSave(response.id);
      else if ((creating || createdId) && !leaving) { void message.success(t('saved')); onCreated(response.id); }
      return true;
    } catch (err) { setError(err instanceof ApiError && err.status === 401 ? 'sessionSaveError' : err instanceof ApiError && err.message.includes('Total episodes cannot be below') ? 'episodeTotalLimit' : err instanceof ApiError && err.message.includes('is inactive') ? 'taxonomyAssociationInactive' : 'saveError'); return false; }
    finally { setSaving(false); }
  }
  if (loading) return <Spin />;
  if (loadError) return <Alert type="error" title={t('loadError')} action={<Button onClick={() => setReload((n) => n + 1)}>{t('retry')}</Button>} />;
  return <div className="editor-container">
    <button type="button" className="editor-back" onClick={onBack} disabled={saving}><BackIcon />{t('backToList')}</button>
    <div className="editor-title"><h1>{t(draftId ? 'editDrama' : 'newDrama')}</h1><p>{t('editorIntro')}</p></div>
    {['PUBLISHED', 'OFFLINE'].includes(dramaStatus) && <Alert className="editor-error" type="info" title={t('draftChangesHint')} />}
    {optionsError && <Alert className="editor-error" type="error" title={t('loadError')} action={<Button onClick={retryOptions}>{t('retry')}</Button>} />}
    <ConfigProvider componentDisabled={saving}>
    <section className="editor-panel"><h2>{t('basicInfo')}</h2><p className="editor-help">{t('languageHint')}</p><Tabs activeKey={currentLocale} onChange={setCurrentLocale} items={form.translations.map((item) => ({ key: item.locale, label: item.locale, children: <div className="editor-grid"><div className="field field-full"><label htmlFor={`title-${item.locale}`}>{t('contentTitle')}</label><Input id={`title-${item.locale}`} maxLength={500} value={item.title} onChange={(event) => updateTranslation(item.locale, 'title', event.target.value)} /></div><div className="field field-full"><label htmlFor={`desc-${item.locale}`}>{t('description')}</label><Input.TextArea id={`desc-${item.locale}`} maxLength={10000} rows={4} value={item.description} onChange={(event) => updateTranslation(item.locale, 'description', event.target.value)} /></div>{form.translations.length > 1 && <Button danger onClick={() => { const next = form.translations.filter((v) => v.locale !== item.locale); set('translations', next); setCurrentLocale(next[0].locale); }}>{t('localeRemove')}</Button>}</div> }))} /><div className="locale-add"><Input aria-label={t('localePlaceholder')} placeholder={t('localePlaceholder')} value={newLocale} onChange={(e) => setNewLocale(e.target.value)} /><Button onClick={() => { const v = newLocale.trim(); if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(v) || locales.some((l) => l.toLowerCase() === v.toLowerCase())) { setLocaleError(true); return; } set('translations', [...form.translations, { locale: v, title: '', description: '' }]); setCurrentLocale(v); setNewLocale(''); setLocaleError(false); }}>{t('addLanguage')}</Button></div>{localeError && <div role="alert" className="option-hint">{t('localeInvalid')}</div>}</section>
    <DramaCover dramaId={draftId} coverKey={coverKey} stagedUploadId={stagedCoverId} disabled={saving} onStaged={(value) => { setStagedCoverId(value); setSaved(false); }} onSaved={setCoverKey} />
    <section className="editor-panel"><h2>{t('classification')}</h2><p className="editor-help">{t('optionNote')}</p><div className="editor-grid"><div className="field"><label htmlFor="editor-category">{t('category')}</label><Select id="editor-category" allowClear placeholder={t('noSelection')} value={form.categoryId} options={options.categories.map((v) => ({ value: v.id, label: label(v, t('missingTranslation'), t('taxonomyInactive')), disabled: v.active === false && form.categoryId !== v.id }))} onChange={(value) => set('categoryId', value ?? null)} />{!options.categories.length && <span className="option-hint">{t('noCategories')}</span>}</div><div className="field"><label htmlFor="editor-tags">{t('tags')}</label><Select id="editor-tags" mode="multiple" placeholder={t('noSelection')} value={form.tagIds} options={options.tags.map((v) => ({ value: v.id, label: label(v, t('missingTranslation'), t('taxonomyInactive')), disabled: v.active === false && !form.tagIds.includes(v.id) }))} onChange={(value) => set('tagIds', value)} />{!options.tags.length && <span className="option-hint">{t('noTags')}</span>}</div></div></section>
    <section className="editor-panel"><h2>{t('cast')}</h2><p className="editor-help">{t('castHint')}</p>{form.actors.map((actor, index) => <div className="actor-row" key={index}><Input aria-label={t('actorName')} placeholder={t('actorName')} value={actor.name} onChange={(e) => set('actors', form.actors.map((a, i) => i === index ? { ...a, name: e.target.value } : a))} /><Input aria-label={t('roleName')} placeholder={t('roleName')} value={actor.roleName} onChange={(e) => set('actors', form.actors.map((a, i) => i === index ? { ...a, roleName: e.target.value } : a))} /><Button onClick={() => set('actors', form.actors.filter((_, i) => i !== index))}>{t('remove')}</Button></div>)}<Button onClick={() => set('actors', [...form.actors, { name: '', roleName: '' }])}>{t('addActor')}</Button></section>
    <section className="editor-panel"><h2>{t('settings')}</h2><div className="editor-grid"><div className="field"><label htmlFor="total-episodes">{t('totalEpisodes')}</label><InputNumber id="total-episodes" min={1} precision={0} value={form.totalEpisodes} onChange={(v) => set('totalEpisodes', v)} /><span className="option-hint">{t('totalHint')}</span></div><div className="field"><label htmlFor="sort-order">{t('sortOrder')}</label><InputNumber id="sort-order" min={0} precision={0} value={form.sortOrder} onChange={(v) => set('sortOrder', v ?? 0)} /></div><div className="field"><label htmlFor="pricing-mode">{t('pricePolicy')}</label><Select id="pricing-mode" allowClear placeholder={t('notSet')} value={form.pricingMode} options={[{ value: 'FREE', label: t('free') }, { value: 'PER_EPISODE', label: t('perEpisode') }]} onChange={(value) => { setSaved(false); setError(''); setForm((old) => ({ ...old, pricingMode: value ?? null, freeEpisodes: value === 'PER_EPISODE' ? old.freeEpisodes : null, priceCredits: value === 'PER_EPISODE' ? old.priceCredits : null })); }} /></div><div className="field"><label htmlFor="preview-seconds">{t('previewSeconds')}</label><InputNumber id="preview-seconds" min={0} precision={0} value={form.previewSeconds} onChange={(v) => set('previewSeconds', v ?? 30)} /><span className="option-hint">{t('previewHint')}</span></div>{form.pricingMode === 'PER_EPISODE' && <><div className="field"><label htmlFor="free-episodes">{t('freeEpisodes')}</label><InputNumber id="free-episodes" min={0} precision={0} value={form.freeEpisodes} onChange={(v) => set('freeEpisodes', v)} /></div><div className="field"><label htmlFor="price-credits">{t('priceCredits')}</label><InputNumber id="price-credits" min={1} precision={0} value={form.priceCredits} onChange={(v) => set('priceCredits', v)} /></div></>}</div></section>
    </ConfigProvider>
    {error && <Alert className="editor-action-error login-expired-note" type="error" showIcon title={t(error)} />}
    <div className="editor-actions"><Button type="primary" loading={saving} onClick={() => void save()}>{t('save')}</Button><Button disabled={saving} onClick={() => void save(true, onManage)}>{t('saveManageEpisodes')}</Button>{saved && <span className="editor-success" role="status">{t('saved')}</span>}</div>
    <Modal open={!!pending} title={t('unsavedTitle')} onCancel={() => setPending(null)} footer={<><Button onClick={() => setPending(null)}>{t('stay')}</Button><Button danger onClick={() => { const next = pending; setPending(null); next?.(); }}>{t('discard')}</Button><Button type="primary" loading={saving} onClick={() => { void (async () => { if (await save(true)) { const next = pending; setPending(null); next?.(); } })(); }}>{t('saveLeave')}</Button></>}><p>{t('unsavedMessage')}</p>{error && <Alert type="error" title={t(error)} />}</Modal>
  </div>;
});
