import { useEffect, useState } from 'react';
import { Alert, Button, InputNumber, message, Modal, Popconfirm, Spin } from 'antd';
import { useTranslation } from 'react-i18next';
import { dedupeGet } from './dedupe-get';

type Covers = { names: string[]; selected: string | null };
type Media = { id: string; duration: number | null };

function request<T>(url: string, body?: unknown, method = 'POST'): Promise<T> {
  const load = async () => {
    const response = await fetch(url, body === undefined ? { cache: 'no-store' } : {
      method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(response.status === 401 ? 'sessionSaveError' : 'coverError');
    return response.json() as Promise<T>;
  };
  return body === undefined ? dedupeGet(url, load) : load();
}

export function EpisodeCover({ dramaId, media, title, onClose, onSaved }: {
  dramaId: string; media: Media; title: string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [covers, setCovers] = useState<Covers | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [frameTime, setFrameTime] = useState<number | null>(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    setCovers(null); setError('');
    request<Covers>(`/api/media/items/${media.id}/covers`).then((result) => {
      if (active) { setCovers(result); setChosen(result.selected); }
    }).catch((err: unknown) => { if (active) setError(err instanceof Error && err.message === 'sessionSaveError' ? err.message : 'coverError'); });
    return () => { active = false; };
  }, [media.id, reload]);

  async function save() {
    if (!chosen || busy) return;
    setBusy(true); setError('');
    try {
      await request(`/api/media/items/${media.id}/cover`, { name: chosen }, 'PUT');
      onSaved(); onClose();
    } catch (err) { setError(err instanceof Error && err.message === 'sessionSaveError' ? err.message : 'coverError'); }
    finally { setBusy(false); }
  }
  async function frame() {
    if (frameTime === null || busy) return;
    setBusy(true); setError('');
    try {
      await request(`/api/media/items/${media.id}/frames`, { seconds: frameTime });
      setCovers(await request<Covers>(`/api/media/items/${media.id}/covers`));
    } catch (err) { setError(err instanceof Error && err.message === 'sessionSaveError' ? err.message : 'frameError'); }
    finally { setBusy(false); }
  }
  async function setDramaCover() {
    if (!chosen || busy) return;
    setBusy(true); setError('');
    try {
      await request(`/api/dramas/${dramaId}/cover/from-frame`, { mediaId: media.id, name: chosen });
      void message.success(t('dramaCoverSaved'));
    } catch (err) { setError(err instanceof Error && err.message === 'sessionSaveError' ? err.message : 'coverError'); }
    finally { setBusy(false); }
  }

  return <Modal open title={`${t('coverWorkspace')} · ${title}`} onCancel={() => { if (!busy) onClose(); }} onOk={() => void save()}
    okText={t('confirmCover')} cancelText={t('episodeCancel')} okButtonProps={{ disabled: !chosen || chosen === covers?.selected }}
    confirmLoading={busy} cancelButtonProps={{ disabled: busy }} closable={!busy} maskClosable={!busy} width={760} destroyOnHidden>
    <p className="media-note">{t('coverIntro')}</p>
    <video className="media-video" controls preload="metadata" src={`/api/media/items/${media.id}/video`} aria-label={t('previewVideo')} />
    {error && <Alert type="error" title={t(error)} action={!covers ? <Button onClick={() => setReload((value) => value + 1)}>{t('retry')}</Button> : undefined} />}
    {covers ? <div className="media-covers">{covers.names.map((name) => <button type="button" key={name} disabled={busy}
      className={chosen === name ? 'media-cover selected' : 'media-cover'} aria-pressed={chosen === name} onClick={() => setChosen(name)}>
      <img src={`/api/media/items/${media.id}/cover/${name}`} alt="" />
      <span>{chosen === name ? t('coverChosen') : t('selectCoverCandidate')}{covers.selected === name ? ` · ${t('selectedCover')}` : ''}</span>
    </button>)}</div> : !error && <Spin />}
    <div className="media-frame"><label htmlFor="frame-time">{t('frameTime')}</label>
      <InputNumber id="frame-time" min={0} max={media.duration ?? undefined} value={frameTime} onChange={setFrameTime} disabled={busy} />
      <Button loading={busy} disabled={!covers || frameTime === null} onClick={() => void frame()}>{t('createFrame')}</Button>
      <Popconfirm title={t('dramaCoverFrameConfirm')} onConfirm={() => void setDramaCover()} okText={t('confirm')} cancelText={t('episodeCancel')} disabled={!chosen || busy}>
        <Button disabled={!chosen || busy}>{t('dramaCoverFromFrame')}</Button>
      </Popconfirm>
    </div>
  </Modal>;
}
