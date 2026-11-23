import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Select, Spin, Tag, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { dedupeGet } from './dedupe-get';

type SectionKey = 'featured' | 'popular' | 'ranking';
type Candidate = { id: string; title: string; categoryName: string | null; episodeCount: number; coverUrl: string | null };
type Sections = Record<SectionKey, string[]>;
type OperationsPayload = { sections: Sections; candidates: Candidate[]; configured: boolean; updatedAt: string | null };

const emptySections: Sections = { featured: [], popular: [], ranking: [] };
const sectionKeys: SectionKey[] = ['featured', 'popular', 'ranking'];
const limits: Record<SectionKey, number> = { featured: 10, popular: 12, ranking: 10 };

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string'
      ? body.message
      : '';
    const error = new Error(detail || `Request failed (${response.status})`);
    Object.assign(error, { status: response.status });
    throw error;
  }
  return response.json() as Promise<T>;
}

function loadOperations(locale: string): Promise<OperationsPayload> {
  const key = '/api/home-operations?locale=' + encodeURIComponent(locale);
  return dedupeGet(key, () => request<OperationsPayload>(key));
}

export function HomeOperations({ onExpired }: { onExpired: () => void }) {
  const { t, i18n } = useTranslation();
  const [sections, setSections] = useState<Sections>(emptySections);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [baseline, setBaseline] = useState('');
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState<Partial<Record<SectionKey, string>>>({});
  const current = JSON.stringify(sections);
  const dirty = !configured || (!!baseline && baseline !== current);
  const candidateById = useMemo(() => new Map(candidates.map((candidate) => [candidate.id, candidate])), [candidates]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    loadOperations(i18n.language)
      .then((result) => {
        if (!active) return;
        const loaded = {
          featured: Array.isArray(result.sections?.featured) ? result.sections.featured : [],
          popular: Array.isArray(result.sections?.popular) ? result.sections.popular : [],
          ranking: Array.isArray(result.sections?.ranking) ? result.sections.ranking : [],
        };
        setSections(loaded);
        setBaseline(JSON.stringify(loaded));
        setConfigured(result.configured === true);
        setCandidates(Array.isArray(result.candidates) ? result.candidates : []);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        if (typeof reason === 'object' && reason !== null && 'status' in reason && reason.status === 401) onExpired();
        else setError('loadError');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [i18n.language, reload, onExpired]);

  function add(section: SectionKey) {
    const id = selectedCandidate[section];
    if (!id || sections[section].includes(id) || sections[section].length >= limits[section]) return;
    setSections((previous) => ({ ...previous, [section]: [...previous[section], id] }));
    setSelectedCandidate((previous) => ({ ...previous, [section]: undefined }));
  }

  function move(section: SectionKey, index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= sections[section].length) return;
    setSections((previous) => {
      const rows = [...previous[section]];
      [rows[index], rows[nextIndex]] = [rows[nextIndex], rows[index]];
      return { ...previous, [section]: rows };
    });
  }

  function remove(section: SectionKey, id: string) {
    setSections((previous) => ({ ...previous, [section]: previous[section].filter((item) => item !== id) }));
  }

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setError('');
    try {
      await request('/api/home-operations', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sections),
      });
      setBaseline(current);
      setConfigured(true);
      void message.success(t('homeSaved'));
    } catch (reason) {
      if (typeof reason === 'object' && reason !== null && 'status' in reason && reason.status === 401) onExpired();
      else if (reason instanceof Error && reason.message.includes('Only published dramas')) setError('homeUnavailableDrama');
      else if (reason instanceof Error && reason.message.includes('Invalid') || reason instanceof Error && reason.message.includes('Duplicate')) setError('homeInvalidConfig');
      else setError('saveError');
    } finally { setSaving(false); }
  }

  if (loading) return <div className="home-operations-loading"><Spin /></div>;

  return <div className="home-operations-page">
    <div className="drama-heading"><div><h1>{t('homeOperations')}</h1><p>{t('homeOperationsIntro')}</p></div></div>
    <Alert className="home-operations-notice" type="info" showIcon title={t('homeOperationsHint')} />
    {error && <Alert className="home-operations-notice" type="error" showIcon title={t(error)} action={<Button onClick={() => error === 'loadError' ? setReload((value) => value + 1) : setError('')}>{error === 'loadError' ? t('retry') : t('dismiss')}</Button>} />}

    <div className="home-operations-sections">
      {sectionKeys.map((section) => {
        const available = candidates.filter((candidate) => !sections[section].includes(candidate.id));
        return <section className="home-operations-panel" key={section} aria-labelledby={`home-${section}-heading`}>
          <div className="home-operations-panel-heading"><div><h2 id={`home-${section}-heading`}>{t(`homeSection_${section}`)}</h2><p>{t(`homeSection_${section}_hint`)}</p></div><Tag>{sections[section].length} / {limits[section]}</Tag></div>
          {sections[section].length ? <ol className="home-placement-list">
            {sections[section].map((id, index) => {
              const item = candidateById.get(id);
              return <li className="home-placement" key={id}>
                <span className="home-placement-rank">{String(index + 1).padStart(2, '0')}</span>
                {item?.coverUrl ? <img className="home-placement-cover" src={item.coverUrl} alt="" /> : <span className="home-placement-cover home-placement-cover-empty" aria-hidden="true">{t('noCover')}</span>}
                <span className="home-placement-copy"><strong>{item?.title ?? t('homeUnavailable')}</strong><small>{item ? [item.categoryName, t('homeEpisodeCount', { count: item.episodeCount })].filter(Boolean).join(' · ') : id}</small></span>
                <div className="home-placement-actions">
                  <Button size="small" aria-label={t('homeMoveUp')} disabled={index === 0} onClick={() => move(section, index, -1)}>↑</Button>
                  <Button size="small" aria-label={t('homeMoveDown')} disabled={index === sections[section].length - 1} onClick={() => move(section, index, 1)}>↓</Button>
                  <Button size="small" danger onClick={() => remove(section, id)}>{t('remove')}</Button>
                </div>
              </li>;
            })}
          </ol> : <div className="home-operations-empty">{t('homeSectionEmpty')}</div>}
          <div className="home-add-row">
            <Select
              showSearch
              allowClear
              value={selectedCandidate[section]}
              placeholder={t('homeSelectDrama')}
              options={available.map((item) => ({ value: item.id, label: `${item.title} · ${t('homeEpisodeCount', { count: item.episodeCount })}` }))}
              filterOption={(input, option) => String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())}
              onChange={(value) => setSelectedCandidate((previous) => ({ ...previous, [section]: value }))}
              disabled={available.length === 0 || sections[section].length >= limits[section]}
            />
            <Button onClick={() => add(section)} disabled={!selectedCandidate[section] || sections[section].length >= limits[section]}>{t('homeAddDrama')}</Button>
          </div>
        </section>;
      })}
    </div>
    <div className="home-operations-footer"><span>{!configured ? t('homeNotConfigured') : dirty ? t('homeUnsaved') : t('homeSavedHint')}</span><Button type="primary" onClick={() => void save()} loading={saving} disabled={!dirty}>{t('homeSave')}</Button></div>
  </div>;
}
