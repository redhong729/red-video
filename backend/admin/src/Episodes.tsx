import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, InputNumber, message, Modal, Popconfirm, Select, Spin, Table, Typography } from 'antd';
import { useTranslation } from 'react-i18next';
import { BackIcon } from './BackIcon';
import { VideoPreview } from './VideoPreview';
import { EpisodeCover } from './EpisodeCover';
import { OfflineButton } from './OfflineButton';
import { PublishActionButton } from './PublishActionButton';
import { StatePill, type StateTone } from './StatePill';
import { dedupeGet } from './dedupe-get';

type Translation = { locale: string; title: string };
type MediaInfo = { id: string; status: string; uploadedAt: string | null; detectStatus: string; transcodeStatus: string };
type Episode = { pendingMedia: MediaInfo | null; draftMedia: (MediaInfo & { selectedCover: string | null; duration: number | null; previewStatus: string; previewSeconds: number | null }) | null; previewCurrent: boolean | null; id: string; number: number; title: string; translations: Translation[]; status: string; priceMode: 'FREE' | 'CREDITS' | null; priceCredits: number | null; previewSeconds: number | null; effectivePrice: { mode: 'FREE' | 'CREDITS' | 'UNCONFIGURED'; credits: number | null }; effectivePreviewSeconds: number };
type Result = { drama: { id: string; title: string | null; status: string; totalEpisodes: number | null }; items: Episode[]; total: number; page: number; pageSize: number };
type PublicationEpisode = { id: string; number: number; title: string; status: string; fingerprint: string; blockers: string[]; warnings: string[] };
type PublicationReport = { drama: { id: string; title: string; status: string; hasPublished: boolean; fingerprint: string }; blockers: string[]; warnings: string[]; episodes: PublicationEpisode[] };
type Form = { number: number | null; translations: Translation[]; priceMode: 'FREE' | 'CREDITS' | null; priceCredits: number | null; previewMode: 'FOLLOW' | 'CUSTOM' | 'OFF'; previewValue: number };
class ApiError extends Error { constructor(public status: number, detail: string) { super(detail); } }
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
const blank = (): Form => ({ number: null, translations: [{ locale: 'zh-CN', title: '' }, { locale: 'en', title: '' }], priceMode: null, priceCredits: null, previewMode: 'FOLLOW', previewValue: 30 });

export function Episodes({ dramaId, navigate, onExpired }: { dramaId: string; navigate: (path: string) => void; onExpired: () => void }) {
  const { t, i18n } = useTranslation();
  const [result, setResult] = useState<Result | null>(null);
  const [publication, setPublication] = useState<PublicationReport | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0);
  const [page, setPage] = useState(1), [pageSize, setPageSize] = useState(20);
  const [selected, setSelected] = useState<string[]>([]);
  const [deleting, setDeleting] = useState<string[]>([]);
  const [editing, setEditing] = useState<Episode | 'new' | null>(null);
  const [previewing, setPreviewing] = useState<Episode | null>(null);
  const [covering, setCovering] = useState<Episode | null>(null);
  const [form, setForm] = useState<Form>(blank);
  const [locale, setLocale] = useState('zh-CN'), [newLocale, setNewLocale] = useState(''), [formError, setFormError] = useState(''), [saving, setSaving] = useState(false);
  const base = `/api/dramas/${dramaId}/episodes`;
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), locale: i18n.language });
    Promise.all([
      request<Result>(`${base}?${query}`),
      request<PublicationReport>(`/api/publication/dramas/${dramaId}?version=draft`),
    ]).then(async ([episodeResult, draftReport]) => {
      if (!active) return;
      const publicationReport = draftReport.drama.hasPublished
        ? await request<PublicationReport>(`/api/publication/dramas/${dramaId}?version=live`)
        : draftReport;
      if (active) { setResult(episodeResult); setPublication(publicationReport); }
    }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) onExpired(); else setError('episodeLoadError');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [base, page, pageSize, i18n.language, onExpired, reload]);
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  async function deleteEpisode(row: Episode) {
    if (deleting.includes(row.id)) return;
    setDeleting((current) => [...current, row.id]);
    try {
      await request(`${base}/${row.id}`, { method: 'DELETE' });
      void message.success(t('episodeDeleted'));
      setSelected((current) => current.filter((id) => id !== row.id));
      if (result?.items.length === 1 && page > 1) setPage((current) => current - 1);
      else refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onExpired();
      else if (err instanceof ApiError && err.status === 409) void message.error(t(err.message.toLowerCase().includes('media tasks') ? 'deleteWaitForTasks' : 'deleteUnavailable'));
      else void message.error(t('episodeDeleteError'));
    } finally {
      setDeleting((current) => current.filter((id) => id !== row.id));
    }
  }
  function openEditor(item: Episode | 'new') {
    setEditing(item); setFormError(''); setNewLocale('');
    if (item === 'new') { setForm(blank()); setLocale('zh-CN'); return; }
    const translations = [...item.translations];
    for (const language of ['zh-CN', 'en']) if (!translations.some((row) => row.locale.toLowerCase() === language.toLowerCase())) translations.push({ locale: language, title: '' });
    setForm({ number: item.number, translations, priceMode: item.priceMode, priceCredits: item.priceCredits, previewMode: item.previewSeconds === null ? 'FOLLOW' : item.previewSeconds === 0 ? 'OFF' : 'CUSTOM', previewValue: item.previewSeconds && item.previewSeconds > 0 ? item.previewSeconds : 30 });
    setLocale(translations[0]?.locale ?? 'zh-CN');
  }
  async function save() {
    if (!form.number || !Number.isInteger(form.number) || form.number < 1) { setFormError('episodeNumberRequired'); return; }
    if (form.priceMode === 'CREDITS' && (!form.priceCredits || form.priceCredits < 1)) { setFormError('episodeCreditsRequired'); return; }
    if (form.previewMode === 'CUSTOM' && (!Number.isInteger(form.previewValue) || form.previewValue < 1)) { setFormError('episodeSaveError'); return; }
    setSaving(true); setFormError('');
    try {
      const editingId = editing !== 'new' && editing ? editing.id : null;
      await request(`${base}${editingId ? `/${editingId}` : ''}`, { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number: form.number, translations: form.translations, priceMode: form.priceMode, priceCredits: form.priceMode === 'CREDITS' ? form.priceCredits : null, previewSeconds: form.previewMode === 'FOLLOW' ? null : form.previewMode === 'OFF' ? 0 : form.previewValue }) });
      setEditing(null); refresh();
    } catch (err) {
      setFormError(err instanceof ApiError && err.status === 401 ? 'sessionSaveError' : err instanceof ApiError && err.message.includes('already exists') ? 'episodeNumberConflict' : err instanceof ApiError && err.message.includes('planned episode count') ? 'episodeNumberTooLarge' : 'episodeSaveError');
    } finally { setSaving(false); }
  }
  const current = form.translations.find((row) => row.locale === locale);
  const checkFor = (row: Episode) => publication?.episodes.find((item) => item.id === row.id);
  const stagePill = (status: string) => {
    const keys: Record<string, string> = { PENDING: 'stagePending', RUNNING: 'stageRunning', SUCCEEDED: 'stageSucceeded', FAILED: 'stageFailed' };
    const tones: Record<string, StateTone> = { PENDING: 'warning', RUNNING: 'info', SUCCEEDED: 'success', FAILED: 'danger' };
    return <StatePill tone={tones[status] ?? 'neutral'}>{t(keys[status] ?? 'stagePending')}</StatePill>;
  };
  const columns = [
    { title: t('episodeNumber'), dataIndex: 'number', key: 'number', width: 85 },
    { title: t('cover'), key: 'cover', width: 90, render: (_: unknown, row: Episode) => row.draftMedia?.selectedCover ? <img className="episode-cover" alt={t('cover')} src={`/api/media/items/${row.draftMedia.id}/cover/${row.draftMedia.selectedCover}`} /> : <div className="cover-placeholder">{t('noCover')}</div> },
    { title: t('episodeTitle'), key: 'title', width: 225, render: (_: unknown, row: Episode) => <div className="episode-identity"><strong>{row.title}</strong><span className="episode-subtext">{t('episodeId')}</span><Typography.Text copyable={{ text: row.id }} className="episode-id">{row.id}</Typography.Text></div> },
    { title: t('currentUpload'), key: 'upload', width: 210, render: (_: unknown, row: Episode) => {
      const media = row.pendingMedia ?? row.draftMedia;
      if (!media) return <StatePill>{t('notSet')}</StatePill>;
      const keys: Record<string, string> = { UPLOADING: 'statusUploading', QUEUED: 'statusQueued', PROCESSING: 'statusProcessing', CANCEL_REQUESTED: 'statusCancelling', CANCELLED: 'statusCancelled', FAILED: 'statusFailed' };
      const tones: Record<string, StateTone> = { UPLOADING: 'info', QUEUED: 'warning', PROCESSING: 'info', CANCEL_REQUESTED: 'warning', CANCELLED: 'neutral', FAILED: 'danger' };
      return <div className="episode-identity">{media.uploadedAt ? <StatePill tone="success">{t('stageSucceeded')}</StatePill> : <StatePill tone={tones[media.status] ?? 'neutral'}>{t(keys[media.status] ?? 'notSet')}</StatePill>}<span className="episode-subtext">{t('mediaId')}</span><Typography.Text copyable={{ text: media.id }} className="episode-id">{media.id}</Typography.Text>{row.pendingMedia && <Button type="link" className="episode-progress-link" onClick={() => navigate(`/dramas/${dramaId}/uploads?episode=${row.number}`)}>{t('uploadProgress')}</Button>}</div>;
    } },
    { title: t('processingState'), key: 'processing', render: (_: unknown, row: Episode) => { const media = row.pendingMedia ?? row.draftMedia; return media ? <div className="episode-status-stack"><span>{t('detectStage')}: {stagePill(media.detectStatus)}</span><span>{t('transcodeStage')}: {stagePill(media.transcodeStatus)}</span></div> : <StatePill>{t('notSet')}</StatePill>; } },
    { title: t('episodePricing'), key: 'price', render: (_: unknown, row: Episode) => <div className="episode-status-stack"><StatePill tone={row.effectivePrice.mode === 'FREE' ? 'success' : row.effectivePrice.mode === 'CREDITS' ? 'info' : 'warning'}>{row.effectivePrice.mode === 'FREE' ? t('priceFree') : row.effectivePrice.mode === 'CREDITS' ? `${row.effectivePrice.credits} ${t('creditsUnit')}` : t('episodeUnconfigured')}</StatePill><span className="episode-subtext">{row.priceMode ? t(row.priceMode === 'FREE' ? 'overrideFree' : 'overrideCredits') : t('followDrama')}</span></div> },
    { title: t('episodePreview'), key: 'preview', render: (_: unknown, row: Episode) => <div className="episode-status-stack"><StatePill tone={row.previewCurrent === false ? 'danger' : 'info'}>{row.effectivePreviewSeconds === 0 ? t('previewOff') : `${row.effectivePreviewSeconds} ${t('seconds')}`}</StatePill><span className="episode-subtext">{row.previewSeconds === null ? t('followDrama') : t('previewOverride')}</span>{row.previewCurrent === false && <StatePill tone="danger">{t('previewStale')}</StatePill>}</div> },
    { title: t('publicationChecks'), key: 'checks', render: (_: unknown, row: Episode) => { const check = checkFor(row); return check ? <div className="episode-check-cell"><StatePill tone={check.blockers.length ? 'danger' : 'success'}>{t(check.blockers.length ? 'episodeNeedsWork' : 'publicationReady')}</StatePill>{check.blockers.map((key) => <span className="episode-check-reason" key={key}>{t(`block${key}`)}</span>)}{check.warnings.map((key) => <span className="episode-check-reminder" key={key}>{t(`warn${key}`)}</span>)}</div> : <StatePill>{t('loading')}</StatePill>; } },
    { title: t('status'), key: 'status', render: (_: unknown, row: Episode) => <StatePill tone={row.status === 'PUBLISHED' ? 'success' : 'neutral'}>{t(row.status === 'PUBLISHED' ? 'published' : 'offline')}</StatePill> },
    { title: t('operations'), key: 'action', width: 290, fixed: 'right' as const, render: (_: unknown, row: Episode) => {
      const check = checkFor(row);
      const deleteDisabled = result?.drama.status === 'IN_REVIEW' || row.status === 'PUBLISHED';
      return <div className="episode-row-actions">
        <Button type="link" disabled={result?.drama.status === 'IN_REVIEW'} onClick={() => openEditor(row)}>{t('edit')}</Button>
        {row.draftMedia && <Button type="link" onClick={() => setPreviewing(row)}>{t('previewAction')}</Button>}
        {row.draftMedia?.status === 'READY' && <Button type="link" disabled={result?.drama.status === 'IN_REVIEW'} onClick={() => setCovering(row)}>{t('chooseCover')}</Button>}
        <Button type="link" disabled={result?.drama.status === 'IN_REVIEW'} onClick={() => navigate(`/dramas/${dramaId}/uploads?episode=${row.number}`)}>{t(row.draftMedia || row.pendingMedia?.uploadedAt ? 'replaceVideo' : 'uploadVideo')}</Button>
        {row.previewCurrent === false && row.draftMedia?.status === 'READY' && result?.drama.status !== 'IN_REVIEW' && <Button type="link" onClick={() => { void request(`/api/media/items/${row.draftMedia!.id}/regenerate-preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(refresh).catch(() => setError('taskFailed')); }}>{t('regeneratePreview')}</Button>}
        {row.status === 'PUBLISHED' ? <OfflineButton link dramaId={dramaId} targets={[{ id: row.id, label: row.title }]} onDone={() => { setSelected([]); refresh(); }} onExpired={onExpired} /> : <PublishActionButton dramaId={dramaId} episodeIds={[row.id]} label={t('publishEpisode')} onDone={() => { setSelected([]); refresh(); }} onExpired={onExpired} navigate={navigate} link disabled={result?.drama.status === 'IN_REVIEW' || !check || check.blockers.length > 0} />}
        <Popconfirm title={t('episodeDeleteConfirm')} onConfirm={() => void deleteEpisode(row)} okText={t('confirm')} cancelText={t('episodeCancel')} okButtonProps={{ danger: true }} disabled={deleteDisabled || deleting.includes(row.id)}>
          <Button type="link" danger disabled={deleteDisabled || deleting.includes(row.id)} loading={deleting.includes(row.id)} title={deleteDisabled ? t('deleteUnavailable') : undefined}>{t('taxonomyDelete')}</Button>
        </Popconfirm>
      </div>;
    } },
  ];
  const selectedRows = result?.items.filter((row) => selected.includes(row.id)) ?? [];
  const selectedToPublish = selectedRows.filter((row) => row.status !== 'PUBLISHED' && (checkFor(row)?.blockers.length ?? 1) === 0);
  const selectedToOffline = selectedRows.filter((row) => row.status === 'PUBLISHED');
  if (loading && !result) return <Spin />;
  if (!result || !publication) return <Alert type="error" title={t(error || 'episodeLoadError')} action={<Button onClick={refresh}>{t('retry')}</Button>} />;
  return <div className="episodes-page">
    <button type="button" className="editor-back" onClick={() => navigate('/dramas')}><BackIcon />{t('backToList')}</button>
    <div className="drama-heading"><div><h1>{result.drama.title ?? t('notSet')}</h1><p>{t('episodesIntro')}</p></div><div className="episode-heading-actions"><Button onClick={() => navigate(`/dramas/${dramaId}/uploads`)}>{t('batchUpload')}</Button><Button type="primary" disabled={result.drama.totalEpisodes === null || result.drama.status === 'IN_REVIEW'} onClick={() => openEditor('new')}>＋ {t('addEpisode')}</Button></div></div>

    {['PUBLISHED', 'OFFLINE'].includes(result.drama.status) && <Alert className="episode-notice" type="info" title={t('draftChangesHint')} />}
    <div className="episode-stats"><div><span>{t('episodeCountLabel')}</span><strong>{result.total}</strong></div><div><span>{t('episodePlanned')}</span><strong>{result.drama.totalEpisodes ?? <StatePill tone="warning">{t('notSet')}</StatePill>}</strong></div><div><span>{t('status')}</span><strong><StatePill tone={result.drama.status === 'PUBLISHED' ? 'success' : result.drama.status === 'OFFLINE' ? 'neutral' : result.drama.status === 'IN_REVIEW' ? 'warning' : 'info'}>{t(({ DRAFT: 'draft', PUBLISHED: 'published', IN_REVIEW: 'inReview', OFFLINE: 'offline' } as Record<string, string>)[result.drama.status] ?? 'notSet')}</StatePill></strong></div></div>
    <section className="drama-panel"><div className="episode-list-header"><div><h2>{t('episodes')}</h2><p>{t('episodeNumberOrder')}</p></div></div>
      {error && <Alert className="episode-notice" type="error" title={t(error)} action={<Button onClick={refresh}>{t('retry')}</Button>} />}
      {selectedRows.length > 0 && <div className="episode-bulk-actions"><span>{t('selectedCount', { count: selectedRows.length })}</span>{selectedToPublish.length > 0 && <PublishActionButton dramaId={dramaId} episodeIds={selectedToPublish.map((row) => row.id)} label={t('batchPublishEpisodes')} onDone={() => { setSelected([]); refresh(); }} onExpired={onExpired} navigate={navigate} />}{selectedToOffline.length > 0 && <OfflineButton dramaId={dramaId} targets={selectedToOffline.map((row) => ({ id: row.id, label: row.title }))} onDone={() => { setSelected([]); refresh(); }} onExpired={onExpired} />}{selectedRows.length > 0 && <Button type="link" onClick={() => setSelected([])}>{t('clearSelection')}</Button>}</div>}
      <Table<Episode> rowKey="id" columns={columns} dataSource={result.items} rowSelection={{ selectedRowKeys: selected, onChange: (keys) => setSelected(keys.map(String)), getCheckboxProps: (row) => ({ disabled: row.status !== 'PUBLISHED' && (!checkFor(row) || (checkFor(row)?.blockers.length ?? 0) > 0) }) }} loading={loading} locale={{ emptyText: t('episodeEmpty') }} scroll={{ x: 1600 }} pagination={{ current: page, pageSize, total: result.total, showSizeChanger: true, pageSizeOptions: [20, 50, 100], onChange: (next, size) => { setSelected([]); setPage(size !== pageSize ? 1 : next); setPageSize(size); } }} />
    </section>
    {previewing?.draftMedia && <VideoPreview mediaId={previewing.draftMedia.id} title={previewing.title} onClose={() => setPreviewing(null)} />}
    {covering?.draftMedia && <EpisodeCover key={covering.draftMedia.id} dramaId={dramaId} media={covering.draftMedia} title={covering.title} onClose={() => setCovering(null)} onSaved={refresh} />}
    <Modal open={!!editing} title={t(editing === 'new' ? 'addEpisode' : 'editEpisode')} onCancel={() => { if (!saving) setEditing(null); }} confirmLoading={saving} onOk={() => void save()} okText={t('episodeSave')} cancelText={t('episodeCancel')} destroyOnHidden>
      {formError && <Alert className="episode-notice" type="error" title={t(formError)} />}
      <div className="episode-form"><label htmlFor="episode-number">{t('episodeNumber')}</label><InputNumber id="episode-number" min={1} max={result.drama.totalEpisodes ?? undefined} precision={0} value={form.number} disabled={editing !== 'new' || saving} onChange={(value) => setForm((old) => ({ ...old, number: value }))} /><p>{t('episodeNumberHint')}</p>
        <label htmlFor="episode-locale">{t('episodeLanguage')}</label><Select id="episode-locale" value={locale} options={form.translations.map((row) => ({ value: row.locale, label: row.locale }))} onChange={setLocale} />
        <label htmlFor="episode-title">{t('episodeTitle')}</label><Input id="episode-title" value={current?.title ?? ''} maxLength={500} onChange={(e) => setForm((old) => ({ ...old, translations: old.translations.map((row) => row.locale === locale ? { ...row, title: e.target.value } : row) }))} /><p>{t('episodeTitleHint')}</p>
        <div className="episode-locale"><Input aria-label={t('localePlaceholder')} placeholder={t('localePlaceholder')} value={newLocale} onChange={(event) => setNewLocale(event.target.value)} /><Button onClick={() => { const next = newLocale.trim(); if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(next) || form.translations.some((row) => row.locale.toLowerCase() === next.toLowerCase())) { setFormError('episodeLocaleInvalid'); return; } setForm((old) => ({ ...old, translations: [...old.translations, { locale: next, title: '' }] })); setLocale(next); setNewLocale(''); setFormError(''); }}>{t('episodeLanguageAdd')}</Button>{form.translations.length > 1 && <Button onClick={() => { const rows = form.translations.filter((row) => row.locale !== locale); setForm((old) => ({ ...old, translations: rows })); setLocale(rows[0].locale); }}>{t('episodeLanguageRemove')}</Button>}</div>
        <label htmlFor="episode-price">{t('episodePricing')}</label><Select id="episode-price" value={form.priceMode ?? 'FOLLOW'} options={[{ value: 'FOLLOW', label: t('followDrama') }, { value: 'FREE', label: t('overrideFree') }, { value: 'CREDITS', label: t('overrideCredits') }]} onChange={(value) => setForm((old) => ({ ...old, priceMode: value === 'FOLLOW' ? null : value as 'FREE' | 'CREDITS', priceCredits: value === 'CREDITS' ? old.priceCredits : null }))} />
        {form.priceMode === 'CREDITS' && <><label htmlFor="episode-credits">{t('priceCredits')}</label><InputNumber id="episode-credits" min={1} precision={0} value={form.priceCredits} onChange={(value) => setForm((old) => ({ ...old, priceCredits: value }))} /></>}
        <label htmlFor="episode-preview">{t('episodePreview')}</label><Select id="episode-preview" value={form.previewMode} options={[{ value: 'FOLLOW', label: t('previewFollow') }, { value: 'CUSTOM', label: t('previewCustom') }, { value: 'OFF', label: t('previewOff') }]} onChange={(value) => setForm((old) => ({ ...old, previewMode: value }))} />
        {form.previewMode === 'CUSTOM' && <InputNumber aria-label={t('episodePreview')} min={1} precision={0} value={form.previewValue} onChange={(value) => setForm((old) => ({ ...old, previewValue: value ?? 0 }))} />}<p>{t('episodePreviewHint')}</p>
      </div>
    </Modal>
  </div>;
}
