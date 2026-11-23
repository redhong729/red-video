import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { dedupeGet } from './dedupe-get';

type EpisodeCheck = { id: string; number: number; title: string; status: string; hasPublishedVersion?: boolean; fingerprint: string; blockers: string[]; warnings: string[] };
type Report = {
  drama: { id: string; title: string; status: string; hasPublished: boolean; fingerprint: string };
  blockers: string[];
  warnings: string[];
  episodes: EpisodeCheck[];
};
type Confirmation = { report: Report; version: 'draft' | 'live'; episodes: EpisodeCheck[]; warnings: string[]; updateExisting: boolean };
type Dialog = { kind: 'drama' | 'episodes' | 'failed' | 'changed' | 'success'; report?: Report; episodes?: EpisodeCheck[]; message?: string };

class ApiError extends Error {
  constructor(public status: number, public detail: string) { super(detail); }
}

function json<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const load = async () => {
    const response = await fetch(url, { ...init, cache: 'no-store' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { message?: string };
      throw new ApiError(response.status, typeof body.message === 'string' ? body.message : '');
    }
    return response.json() as Promise<T>;
  };
  return method === 'GET' ? dedupeGet(url, load) : load();
}

export function PublishActionButton({ dramaId, episodeIds, wholeDrama = false, label, onDone, onExpired, navigate, link = false, disabled = false }: {
  dramaId: string;
  episodeIds?: string[];
  wholeDrama?: boolean;
  label: string;
  onDone: () => void;
  onExpired: () => void;
  navigate: (path: string) => void;
  link?: boolean;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const base = `/api/publication/dramas/${dramaId}`;
  const reason = (key: string) => t(`block${key}`);
  const warning = (key: string) => t(`warn${key}`);

  async function prepare() {
    if (loading || publishing || disabled) return;
    setLoading(true);
    setDialog(null);
    try {
      let report = await json<Report>(`${base}?version=draft`);
      let version: 'draft' | 'live' = 'draft';
      if ((wholeDrama ? report.drama.status === 'OFFLINE' : report.drama.hasPublished) && report.drama.hasPublished) {
        report = await json<Report>(`${base}?version=live`);
        version = 'live';
      }
      const updateExisting = wholeDrama && report.drama.status === 'PUBLISHED';
      if (report.blockers.length) {
        setDialog({ kind: 'drama', report });
        return;
      }
      const episodeSet = new Set(episodeIds ?? []);
      const chosen = wholeDrama
        ? report.episodes.filter((item) => updateExisting
          ? item.status === 'PUBLISHED'
          : item.status === 'PUBLISHED' || (!item.hasPublishedVersion && item.blockers.length === 0))
        : report.episodes.filter((item) => episodeSet.has(item.id));
      if (!wholeDrama && (!chosen.length || chosen.length !== episodeSet.size)) {
        setDialog({ kind: 'changed', message: 'publicationChanged' });
        return;
      }
      const unready = chosen.filter((item) => item.blockers.length > 0);
      if (unready.length || (wholeDrama && !chosen.length)) {
        setDialog({ kind: 'episodes', report, episodes: wholeDrama ? report.episodes.filter((item) => item.blockers.length > 0) : unready });
        return;
      }
      const omittedOffline = wholeDrama && !updateExisting && report.episodes.some((item) => item.status !== 'PUBLISHED' && !chosen.some((selected) => selected.id === item.id));
      const warnings = wholeDrama
        ? [...report.warnings, ...(omittedOffline && !report.warnings.includes('EPISODES_INCOMPLETE') ? ['EPISODES_INCOMPLETE'] : [])]
        : [];
      setConfirmation({ report, version, episodes: chosen, warnings: [...new Set(warnings)], updateExisting });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      else setDialog({ kind: 'failed' });
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!confirmation || publishing) return;
    const { report, episodes, version } = confirmation;
    setPublishing(true);
    try {
      await json(`${base}/publish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version,
          scope: wholeDrama ? 'drama' : 'episodes',
          dramaFingerprint: report.drama.fingerprint,
          dramaStatus: report.drama.status,
          episodeIds: episodes.map((item) => item.id),
          episodeFingerprints: Object.fromEntries(episodes.map((item) => [item.id, item.fingerprint])),
          episodeStatuses: Object.fromEntries(episodes.map((item) => [item.id, item.status])),
        }),
      });
      setConfirmation(null);
      setDialog({ kind: 'success' });
      onDone();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) onExpired();
      else if (error instanceof ApiError && error.detail.includes('media tasks')) setDialog({ kind: 'changed', message: 'publicationActiveMedia' });
      else setDialog({ kind: 'changed', message: 'publicationChanged' });
      setConfirmation(null);
    } finally {
      setPublishing(false);
    }
  }

  const dialogTitle = dialog?.kind === 'drama' ? 'publicationDramaMissingTitle'
    : dialog?.kind === 'episodes' ? 'publicationEpisodesIncompleteTitle'
      : dialog?.kind === 'failed' ? 'publicationPrecheckFailedTitle'
        : dialog?.kind === 'success' ? 'publicationSucceeded' : 'publicationChanged';

  return <>
    <Button type={link ? 'link' : 'default'} disabled={disabled} loading={loading} onClick={() => void prepare()}>{label}</Button>
    <Modal
      open={!!dialog}
      title={t(dialogTitle)}
      okText={t(dialog?.kind === 'drama' ? 'goEditDrama' : dialog?.kind === 'episodes' && wholeDrama ? 'goEpisodes' : dialog?.kind === 'failed' ? 'retry' : 'confirm')}
      cancelButtonProps={{ style: { display: dialog?.kind === 'success' ? 'none' : undefined } }}
      onOk={() => {
        if (dialog?.kind === 'drama') navigate(`/dramas/${dramaId}/edit`);
        if (dialog?.kind === 'episodes' && wholeDrama) navigate(`/dramas/${dramaId}/episodes`);
        if (dialog?.kind === 'failed') { setDialog(null); void prepare(); return; }
        setDialog(null);
      }}
      onCancel={() => setDialog(null)}
      destroyOnHidden
    >
      {dialog?.kind === 'drama' && <><p>{t('publicationDramaMissingText')}</p><ul className="publication-reasons">{dialog.report?.blockers.map((key) => <li key={key}>{reason(key)}</li>)}</ul></>}
      {dialog?.kind === 'episodes' && <><p>{t(wholeDrama ? 'publicationEpisodesIncompleteText' : 'selectedEpisodesIncompleteText')}</p>{dialog.episodes?.length ? <ul className="publication-reasons">{dialog.episodes.map((episode) => <li key={episode.id}>{t('episodeNumber')} {episode.number} · {episode.title}<ul>{episode.blockers.map((key) => <li key={key}>{reason(key)}</li>)}</ul></li>)}</ul> : <p>{t('publicationNoEpisodesToPublish')}</p>}</>}
      {dialog?.kind === 'failed' && <p>{t('publicationPrecheckFailed')}</p>}
      {dialog?.kind === 'changed' && <p>{t(dialog.message ?? 'publicationChanged')}</p>}
      {dialog?.kind === 'success' && <p>{t('publicationSucceeded')}</p>}
    </Modal>
    <Modal
      open={!!confirmation}
      title={t('publishConfirmTitle')}
      okText={t('confirmPublish')}
      cancelText={t('episodeCancel')}
      confirmLoading={publishing}
      onOk={() => void publish()}
      onCancel={() => { if (!publishing) setConfirmation(null); }}
      closable={!publishing}
      maskClosable={!publishing}
      destroyOnHidden
    >
      {confirmation && <>
        <p>{t(wholeDrama ? confirmation.updateExisting ? 'updatePublishedDramaConfirm' : 'publishWholeDramaConfirm' : 'publishSelectedEpisodesConfirm', { count: confirmation.episodes.length })}</p>
        <ul>{confirmation.episodes.map((episode) => <li key={episode.id}>{t('episodeNumber')} {episode.number} · {episode.title}{episode.warnings.map((key) => <div className="publish-reminder" key={key}>{warning(key)}</div>)}</li>)}</ul>
        {confirmation.warnings.length > 0 && <Alert type="warning" showIcon title={t('publicationReminders')} description={<ul className="publication-reasons">{confirmation.warnings.map((key) => <li key={key}>{warning(key)}</li>)}</ul>} />}
      </>}
    </Modal>
  </>;
}
