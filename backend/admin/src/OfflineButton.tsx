import { useState } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useTranslation } from 'react-i18next';

type Target = { id: string; label: string };
type Result = { id: string; result: 'SUCCEEDED' | 'SKIPPED' | 'FAILED'; reason?: string };

export function OfflineButton({ targets, dramaId, onDone, onExpired, link = false }: { targets: Target[]; dramaId?: string; onDone: () => void; onExpired: () => void; link?: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(false), [results, setResults] = useState<Result[] | null>(null), [labels, setLabels] = useState<Record<string, string>>({});
  async function submit() {
    setBusy(true); setError(false);
    try {
      const response = await fetch(dramaId ? `/api/visibility/dramas/${dramaId}/episodes/offline` : '/api/visibility/dramas/offline', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: targets.map((target) => target.id) }) });
      if (response.status === 401) { onExpired(); return; }
      if (!response.ok) throw new Error('Offline failed');
      const data = await response.json() as { results: Result[] };
      setLabels(Object.fromEntries(targets.map((target) => [target.id, target.label]))); setOpen(false); setResults(data.results);
    } catch { setError(true); } finally { setBusy(false); }
  }
  return <><Button type={link ? 'link' : 'default'} danger disabled={!targets.length} onClick={() => { setError(false); setOpen(true); }}>{t(link ? 'takeOffline' : 'batchTakeOffline')}</Button>
    <Modal open={open} title={t('offlineTitle')} okText={t('takeOffline')} okButtonProps={{ danger: true }} cancelText={t('episodeCancel')} confirmLoading={busy} onOk={() => void submit()} onCancel={() => { if (!busy) setOpen(false); }} closable={!busy} maskClosable={!busy}>
      <p>{t(dramaId ? 'offlineEpisodesConfirm' : 'offlineDramasConfirm', { count: targets.length })}</p><ul>{targets.map((target) => <li key={target.id}>{target.label}</li>)}</ul>{error && <Alert type="error" title={t('taskFailed')} />}
    </Modal>
    <Modal open={!!results} title={t('offlineResult')} footer={<Button type="primary" onClick={() => { setResults(null); onDone(); }}>{t('confirm')}</Button>} onCancel={() => { setResults(null); onDone(); }}>
      <ul>{results?.map((item) => <li key={item.id}>{labels[item.id] ?? item.id}：{t(item.result === 'SUCCEEDED' ? 'offlineSucceeded' : item.result === 'SKIPPED' ? 'offlineSkipped' : 'offlineFailed')}</li>)}</ul>
    </Modal></>;
}
