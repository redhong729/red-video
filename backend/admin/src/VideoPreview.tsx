import { useState } from 'react';
import { Alert, Modal } from 'antd';
import { useTranslation } from 'react-i18next';

export function VideoPreview({ mediaId, title, onClose, src }: { mediaId: string; title: string; onClose: () => void; src?: string }) {
  const { t } = useTranslation();
  const [error, setError] = useState(false);
  return <Modal open centered className="video-preview-modal" title={`${t('previewVideo')} · ${title}`} onCancel={onClose} footer={null} width="min(420px, calc(100vw - 32px), calc(56.25dvh - 24px))" destroyOnHidden>
    {error && <Alert className="episode-notice" type="error" title={t('videoPreviewError')} />}
    <video className="video-preview-player" controls playsInline preload="metadata" src={src ?? `/api/media/items/${mediaId}/video`} aria-label={t('previewVideo')} onError={() => setError(true)} />
  </Modal>;
}
