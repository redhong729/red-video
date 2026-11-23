import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from 'antd';
import { useTranslation } from 'react-i18next';

export function DramaCover({ dramaId, coverKey, stagedUploadId, disabled = false, onStaged, onSaved }: { dramaId?: string; coverKey: string | null; stagedUploadId: string | null; disabled?: boolean; onStaged: (id: string | null) => void; onSaved: (key: string) => void }) {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null), [url, setUrl] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const previousStagedId = useRef(stagedUploadId);
  const stagedIdRef = useRef(stagedUploadId);
  useEffect(() => { stagedIdRef.current = stagedUploadId; }, [stagedUploadId]);
  useEffect(() => () => {
    const uploadId = stagedIdRef.current;
    if (uploadId) void fetch(`/api/drama-cover-staging/${uploadId}`, { method: 'DELETE' }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!file) { setUrl(''); return; }
    const objectUrl = URL.createObjectURL(file); setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  useEffect(() => {
    if (previousStagedId.current && !stagedUploadId && coverKey) {
      setFile(null);
      setSuccess(true);
      setError('');
    }
    previousStagedId.current = stagedUploadId;
  }, [coverKey, stagedUploadId]);
  function discardStage() {
    const uploadId = stagedUploadId;
    onStaged(null);
    if (uploadId) void fetch(`/api/drama-cover-staging/${uploadId}`, { method: 'DELETE' }).catch(() => undefined);
  }
  async function save() {
    if (!file || busy || disabled) return;
    setBusy(true); setError(''); setSuccess(false);
    try {
      const isStaging = !dramaId;
      const response = await fetch(isStaging ? '/api/drama-cover-staging' : `/api/dramas/${dramaId}/cover`, { method: isStaging ? 'POST' : 'PUT', headers: { 'Content-Type': file.type }, body: file });
      if (!response.ok) { setError(response.status === 401 ? 'sessionSaveError' : response.status === 400 ? 'dramaCoverInvalid' : 'dramaCoverError'); return; }
      if (isStaging) {
        const data = await response.json() as { uploadId: string };
        onStaged(data.uploadId);
      } else {
        const data = await response.json() as { coverKey: string };
        onSaved(data.coverKey);
        setFile(null);
      }
      setSuccess(true);
    } catch { setError('dramaCoverError'); } finally { setBusy(false); }
  }
  return <section className="editor-panel"><h2>{t('dramaCoverTitle')}</h2><p className="editor-help">{t('dramaCoverHint')}</p>
    {error && <Alert className="episode-notice" type="error" title={t(error)} />}
    <div className="drama-cover-editor">{url || (dramaId && coverKey) ? <img className="drama-cover-preview" src={url || `/api/dramas/${dramaId}/cover?v=${encodeURIComponent(coverKey!)}`} alt={t('dramaCoverTitle')} /> : <div className="drama-cover-empty">{t('noCover')}</div>}
      <div className="drama-cover-actions"><input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={disabled || busy} onChange={(event) => { const selected = event.target.files?.[0]; event.target.value = ''; setError(''); setSuccess(false); if (!selected) return; discardStage(); if (!['image/jpeg', 'image/png', 'image/webp'].includes(selected.type) || !selected.size || selected.size > 10 * 1024 * 1024) { setFile(null); setError('dramaCoverInvalid'); return; } setFile(selected); }} /><Button disabled={disabled || busy} onClick={() => input.current?.click()}>{t(coverKey || stagedUploadId ? 'dramaCoverReplace' : 'dramaCoverChoose')}</Button>{file && !stagedUploadId && <Button type="primary" loading={busy} disabled={disabled} onClick={() => void save()}>{t('dramaCoverConfirm')}</Button>}{file && <Button disabled={busy || disabled} onClick={() => { discardStage(); setFile(null); setError(''); setSuccess(false); }}>{t('episodeCancel')}</Button>}{success && <span className="editor-success" role="status">{t(stagedUploadId ? 'dramaCoverStaged' : 'dramaCoverSaved')}</span>}{stagedUploadId && !success && <span className="editor-success" role="status">{t('dramaCoverStaged')}</span>}</div>
    </div>
  </section>;
}
