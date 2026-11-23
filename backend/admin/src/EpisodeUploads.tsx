import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, InputNumber, Popconfirm, Progress, Select, Spin, Tag, Upload } from 'antd';
import { useTranslation } from 'react-i18next';
import { BackIcon } from './BackIcon';
import { VideoPreview } from './VideoPreview';
import { abortBatchTransfers, fingerprint, getTransfer, queueUpload, subscribeTransfers, type Batch, type UploadItem } from './media-transfer';
import { dedupeGet } from './dedupe-get';

type Config = { maxFiles: number; maxBytes: number; chunkSize: number; uploadDays: number; workerOnline?: boolean };
type Identifiers = { title: string | null; status: string; totalEpisodes: number | null; episodes: { number: number; status: string; draftMediaId: string | null; pendingStatus: string | null }[] };
type Row = { key: string; file: File; number: number | null; replace: boolean; serverError?: string };
class ApiError extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }
function json<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const { signal, ...requestOptions } = init ?? {};
  const load = async () => {
    const response = await fetch(url, { ...requestOptions, ...(method === 'GET' ? {} : { signal }), cache: 'no-store' });
    if (!response.ok) throw new ApiError(response.status);
    return response.json() as Promise<T>;
  };
  return method === 'GET' ? dedupeGet(url, load) : load();
}
const post = <T,>(url: string, body: unknown, method = 'POST') => json<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
function size(value: number) { if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(1)} GiB`; if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(1)} MiB`; return `${(value / 1024).toFixed(1)} KiB`; }
function identify(name: string) {
  const match = /^(?:0*(\d+)|ep[\s_-]*0*(\d+)|第\s*0*(\d+)\s*集)\.mp4$/i.exec(name.trim());
  const value = match ? Number(match[1] ?? match[2] ?? match[3]) : 0;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}
const activeStatuses = ['UPLOADING', 'QUEUED', 'PROCESSING', 'CANCEL_REQUESTED'];

export function EpisodeUploads({ dramaId, navigate, onExpired }: { dramaId: string; navigate: (path: string) => void; onExpired: () => void }) {
  const { t, i18n } = useTranslation();
  const episodeParam = new URLSearchParams(window.location.search).get('episode');
  const targetEpisode = episodeParam && /^[1-9]\d*$/.test(episodeParam) && Number.isSafeInteger(Number(episodeParam)) ? Number(episodeParam) : null;
  const [config, setConfig] = useState<Config | null>(null), [drama, setDrama] = useState<Identifiers | null>(null), [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [reload, setReload] = useState(0), [filter, setFilter] = useState('all');
  const [rows, setRows] = useState<Row[]>([]), [hashing, setHashing] = useState(''), [notice, setNotice] = useState('');
  const [previewing, setPreviewing] = useState<UploadItem | null>(null);
  const [resumeId, setResumeId] = useState(''), [resumeError, setResumeError] = useState('');
  const [tick, setTick] = useState(0); const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => subscribeTransfers(() => setTick((value) => value + 1)), []);
  void tick;
  const refresh = useCallback(() => setReload((value) => value + 1), []);
  useEffect(() => {
    let mounted = true;
    async function load(initial: boolean) {
      try {
        const query = new URLSearchParams({ locale: i18n.language, dramaId });
        const [cfg, result, context] = await Promise.all([
          json<Config>('/api/media/config'),
          json<Batch[]>(`/api/media/batches?${query}`),
          json<Identifiers>(`/api/dramas/${dramaId}/episodes/identifiers?locale=${encodeURIComponent(i18n.language)}`),
        ]);
        if (mounted) { setConfig(cfg); setBatches(result); setDrama(context); setError(''); }
      } catch (err) { if (mounted) { if (err instanceof ApiError && err.status === 401) onExpired(); else setError('episodeLoadError'); } }
      finally { if (mounted && initial) setLoading(false); }
    }
    setLoading(true); void load(true);
    const timer = window.setInterval(() => void load(false), 2500);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [dramaId, i18n.language, onExpired, reload]);
  const numberCounts = useMemo(() => { const counts = new Map<number, number>(); for (const row of rows) if (row.number) counts.set(row.number, (counts.get(row.number) ?? 0) + 1); return counts; }, [rows]);
  function problem(row: Row, index: number): string | null {
    if (row.serverError) return row.serverError;
    if (row.file.name.length > 255 || /[\x00-\x1f/\\]/.test(row.file.name)) return 'fileInvalidName';
    if (!/\.mp4$/i.test(row.file.name)) return 'fileInvalidType';
    if (!row.file.size || (config && row.file.size > config.maxBytes)) return 'fileInvalidSize';
    if (config && index >= config.maxFiles) return 'fileLimit';
    if (!row.number || !Number.isSafeInteger(row.number) || row.number < 1) return 'fileInvalidNumber';
    if ((numberCounts.get(row.number) ?? 0) > 1) return 'fileDuplicate';
    if (!drama?.totalEpisodes || row.number > drama.totalEpisodes) return 'fileExceeds';
    const episode = drama.episodes.find((item) => item.number === row.number);
    if (episode && episode.pendingStatus && activeStatuses.includes(episode.pendingStatus)) return 'fileBusy';
    if (episode && !row.replace) return 'fileNeedsConfirm';
    return null;
  }
  async function start() {
    if (!config || !dramaId || hashing) return;
    const eligible = rows.filter((row, index) => !problem(row, index));
    if (!eligible.length) { setNotice(t('noValidFiles')); return; }
    setNotice(''); const prepared: { row: Row; fingerprint: string; hashes: string[] }[] = [];
    try {
      for (let i = 0; i < eligible.length; i++) {
        const row = eligible[i];
        const result = await fingerprint(row.file, config.chunkSize, (done) => setHashing(t('computingFingerprint', { index: i + 1, total: eligible.length, percent: Math.floor(done / row.file.size * 100) })));
        prepared.push({ row, ...result });
      }
      setHashing(t('loading'));
      const response = await post<Batch & { rejected: { index: number; reason: string }[] }>('/api/media/batches', { dramaId, items: prepared.map(({ row, fingerprint: value }) => ({ filename: row.file.name, size: row.file.size, number: row.number, replace: row.replace, fingerprint: value })) });
      for (const item of response.items) {
        const match = prepared.find((entry) => entry.row.number === item.episode.number);
        if (match) queueUpload(item, match.row.file, match.hashes);
      }
      const rejected = new Map(response.rejected.map((item) => [prepared[item.index]?.row.key, item.reason]));
      const accepted = new Set(response.items.map((item) => item.episode.number));
      const reasonKeys: Record<string, string> = { INVALID_FILE: 'fileInvalidType', DUPLICATE_NUMBER: 'fileDuplicate', EXCEEDS_TOTAL: 'fileExceeds', CONFIRM_REPLACE: 'fileNeedsConfirm', EPISODE_NOT_EDITABLE: 'fileBusy', ACTIVE_TASK: 'fileBusy' };
      setRows((current) => current.filter((row) => !accepted.has(row.number ?? -1)).map((row) => rejected.has(row.key) ? { ...row, serverError: reasonKeys[rejected.get(row.key)!] ?? 'fileBusy' } : row));
      setNotice(t('uploadStarted', { accepted: response.items.length, rejected: rows.length - response.items.length })); refresh();
    } catch (err) { setNotice(err instanceof ApiError && err.status === 401 ? t('sessionSaveError') : t('batchCreateFailed')); }
    finally { setHashing(''); }
  }
  async function resume(item: UploadItem, file?: File) {
    if (!file) return;
    setResumeId(item.id); setResumeError('');
    try {
      if (file.size !== item.size) throw new Error('mismatch');
      const result = await fingerprint(file, item.chunkSize);
      if (result.fingerprint !== item.fingerprint) throw new Error('mismatch');
      queueUpload(item, file, result.hashes);
    } catch { setResumeError(t('invalidFileMessage')); }
    finally { setResumeId(''); }
  }
  async function action(url: string, batchId?: string) {
    try { if (batchId) abortBatchTransfers(batchId); await post(url, {}); refresh(); }
    catch (err) { if (err instanceof ApiError && err.status === 401) onExpired(); else setError('taskFailed'); }
  }
  const visible = batches.filter((batch) => filter === 'all' || (filter === 'processing' && batch.items.some((item) => activeStatuses.includes(item.status))) || (filter === 'failed' && batch.items.some((item) => item.status === 'FAILED')) || (filter === 'finished' && batch.items.every((item) => !activeStatuses.includes(item.status))));
  const queuedCount = batches.reduce((count, batch) => count + batch.items.filter((item) => item.status === 'QUEUED').length, 0);
  const statusKeys: Record<string, string> = { UPLOADING: 'statusUploading', QUEUED: 'statusQueued', PROCESSING: 'statusProcessing', READY: 'statusReady', FAILED: 'statusFailed', CANCEL_REQUESTED: 'statusCancelling', CANCELLED: 'statusCancelled' };
  const stageKeys: Record<string, string> = { PENDING: 'stagePending', RUNNING: 'stageRunning', SUCCEEDED: 'stageSucceeded', FAILED: 'stageFailed', NOT_REQUIRED: 'stageNotRequired', NOT_CONFIGURED: 'stageNotConfigured' };
  if (loading && !config) return <Spin />;
  return <div className="media-page">
    <button type="button" className="editor-back" onClick={() => navigate(`/dramas/${dramaId}/episodes`)}><BackIcon />{t('episodes')}</button>
    <div className="drama-heading"><div><h1>{drama?.title ?? t('uploadTitle')}</h1><p>{t('uploadIntro')}</p></div><Button onClick={refresh}>{t('refreshUploads')}</Button></div>
    {error && <Alert className="episode-notice" type="error" title={t(error)} action={<Button onClick={refresh}>{t('retry')}</Button>} />}
    {config && <section className="drama-panel media-upload-panel">
      <div className="episode-list-header"><h2>{targetEpisode ? t('uploadForEpisode', { number: targetEpisode }) : t('batchUpload')}</h2><p>{t('uploadLimits', { count: config.maxFiles, size: size(config.maxBytes) })}</p></div>
      <div className="media-select"><input ref={fileRef} type="file" multiple={!targetEpisode} accept=".mp4,video/mp4" onChange={(event) => { const files = Array.from(event.target.files ?? []); const added = files.map((file) => ({ key: crypto.randomUUID(), file, number: targetEpisode ?? identify(file.name), replace: false })); setRows((old) => targetEpisode ? added : [...old, ...added]); event.target.value = ''; }} hidden /><Button onClick={() => fileRef.current?.click()} disabled={!!hashing || !drama || drama.status === 'IN_REVIEW'}>{t('chooseFiles')}</Button>{rows.length > 0 && <Button disabled={!!hashing} onClick={() => setRows([])}>{t('clearFiles')}</Button>}</div>
      {drama?.totalEpisodes === null && <Alert type="warning" title={t('episodeNeedTotal')} action={<Button onClick={() => navigate(`/dramas/${dramaId}/edit`)}>{t('goEditDrama')}</Button>} />}
      {rows.length > 0 && <><p className="media-note">{t('uploadPartialNote')}</p><div className="media-file-list">{rows.map((row, index) => { const issue = problem(row, index); const existing = drama?.episodes.find((episode) => episode.number === row.number); return <div className="media-file" key={row.key}><div className="media-file-info"><strong>{row.file.name}</strong><span>{size(row.file.size)}</span></div><div className="media-file-controls"><InputNumber aria-label={`${t('mappedNumber')} ${row.file.name}`} min={1} precision={0} value={row.number} disabled={!!targetEpisode} onChange={(value) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, number: value, replace: false, serverError: undefined } : item))} />{existing && <Checkbox checked={row.replace} onChange={(event) => setRows((current) => current.map((item) => item.key === row.key ? { ...item, replace: event.target.checked, serverError: undefined } : item))}>{t(existing.draftMediaId ? 'confirmReplaceVideo' : 'replaceExisting')}</Checkbox>}<Button type="link" onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}>{t('removeFile')}</Button></div><div className={issue ? 'media-file-error' : 'media-file-ready'}>{t(issue ?? 'fileReady')}</div></div>; })}</div><Button type="primary" onClick={() => void start()} disabled={!!hashing}>{t('uploadConfirm')}</Button></>}
      {hashing && <p role="status" className="media-note">{hashing}</p>}{notice && <Alert className="media-feedback" type="info" title={notice} />}
    </section>}
    <section className="drama-panel media-task-panel"><div className="media-task-heading"><h2>{t('uploadProgress')}</h2><Select value={filter} onChange={setFilter} options={[{ value: 'all', label: t('tasksAll') }, { value: 'processing', label: t('tasksProcessing') }, { value: 'finished', label: t('tasksFinished') }, { value: 'failed', label: t('tasksFailed') }]} /></div>
      {queuedCount > 0 && config?.workerOnline !== undefined && <Alert className="media-worker-alert" type={config.workerOnline ? 'info' : 'warning'} title={t(config.workerOnline ? 'queuedWorkerOnline' : 'queuedWorkerOffline')} />}
      {resumeError && <Alert className="episode-notice" type="error" title={resumeError} />}
      {!visible.length && <div className="media-empty">{t('noUploads')}</div>}
      {visible.map((batch) => <article className="media-batch" key={batch.id}><div className="media-batch-header"><div><strong>{batch.dramaTitle ?? t('dramas')}</strong><span>{t('batchTime')}: {new Date(batch.createdAt).toLocaleString(i18n.language)}</span><span>{t('batchSummary', { total: batch.items.length, ready: batch.items.filter((item) => item.status === 'READY').length, uploading: batch.items.filter((item) => item.status === 'UPLOADING').length, queued: batch.items.filter((item) => item.status === 'QUEUED').length, processing: batch.items.filter((item) => item.status === 'PROCESSING').length, cancelling: batch.items.filter((item) => item.status === 'CANCEL_REQUESTED').length, failed: batch.items.filter((item) => item.status === 'FAILED').length, cancelled: batch.items.filter((item) => item.status === 'CANCELLED').length })}</span></div><div className="media-batch-actions">{batch.items.some((item) => item.status === 'FAILED') && <Button onClick={() => void action(`/api/media/batches/${batch.id}/retry`)}>{t('retryFailed')}</Button>}{batch.items.some((item) => [...activeStatuses, 'FAILED'].includes(item.status)) && <Popconfirm title={t('cancelConfirm')} onConfirm={() => void action(`/api/media/batches/${batch.id}/cancel`, batch.id)}><Button danger>{t('cancelBatch')}</Button></Popconfirm>}</div></div>
        {batch.items.map((item) => { const transfer = getTransfer(item.id), done = transfer?.loaded ?? item.chunks.reduce((sum, chunk) => sum + chunk.size, 0), expired = new Date(batch.expiresAt).getTime() <= Date.now(), current = item.episode.draftMediaId === item.id; return <div className="media-task" key={item.id}><div className="media-task-title"><strong>{t('episodeNumber')} {item.episode.number} · {item.filename}</strong><Tag>{t(statusKeys[item.status] ?? 'statusFailed')}</Tag></div><div className="media-task-meta">{t('bytesProgress', { done: size(done), total: size(item.size) })}</div>{item.status === 'UPLOADING' && <Progress percent={Math.min(100, Math.floor(done / item.size * 100))} size="small" />}
          <div className="media-stage"><span>{t('taskStages')}:</span> {[item.detectStatus, item.transcodeStatus, item.coverStatus, item.previewStatus].map((stage, i) => <span key={i}>{t(stageKeys[stage] ?? 'stagePending')}{i < 3 ? ' / ' : ''}</span>)}</div>{item.error && <p className="media-task-error">{t(({ DETECT: 'mediaDetectError', TRANSCODE: 'mediaTranscodeError', COVER: 'mediaCoverError', PREVIEW: 'mediaPreviewError' } as Record<string, string>)[item.phase] ?? 'mediaGenericError')}</p>}{transfer?.status === 'ERROR' && <p className="media-task-error">{t('uploadError')}</p>}{item.status === 'FAILED' && <p className="media-task-hint">{t('processingFailedHint')}</p>}{item.status === 'CANCELLED' && <p className="media-task-hint">{t('cancelledTaskHint')}</p>}
          <div className="media-task-actions">{item.status === 'UPLOADING' && (expired ? <span>{t('uploadExpired')}</span> : transfer && ['UPLOADING', 'QUEUED'].includes(transfer.status) ? null : <Upload accept=".mp4,video/mp4" showUploadList={false} beforeUpload={(file) => { void resume(item, file); return Upload.LIST_IGNORE; }}><Button disabled={resumeId === item.id}>{resumeId === item.id ? t('resuming') : t('resume')}</Button></Upload>)}{current && item.transcodeStatus === 'SUCCEEDED' && <Button onClick={() => setPreviewing(item)}>{t('previewAction')}</Button>}</div>
        </div>; })}</article>)}
    </section>
    {previewing && <VideoPreview mediaId={previewing.id} title={`${t('episodeNumber')} ${previewing.episode.number}`} onClose={() => setPreviewing(null)} />}
  </div>;
}
