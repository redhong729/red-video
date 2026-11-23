import { useEffect, useState } from 'react';
import { Alert, Button, Input, Modal, Popconfirm, Select, Table, Tag } from 'antd';
import { useTranslation } from 'react-i18next';
import { dedupeGet } from './dedupe-get';

type Translation = { locale: string; name: string };
type Entry = { id: string; active: boolean; usageCount: number; systemKey?: string | null; translations: Translation[] };
type Kind = 'categories' | 'tags';
class ApiError extends Error { constructor(public status: number) { super(`HTTP ${status}`); } }
function request<T>(url: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();
  const { signal, ...requestOptions } = init ?? {};
  const load = async () => {
    const response = await fetch(url, { ...requestOptions, ...(method === 'GET' ? {} : { signal }), cache: 'no-store' });
    if (!response.ok) throw new ApiError(response.status);
    return response.json() as Promise<T>;
  };
  return method === 'GET' ? dedupeGet(url, load) : load();
}
const blank = (): Translation[] => [{ locale: 'zh-CN', name: '' }, { locale: 'en', name: '' }];

export function Taxonomy({ kind, onExpired }: { kind: Kind; onExpired: () => void }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<Entry[]>([]), [loading, setLoading] = useState(true), [loadError, setLoadError] = useState(false), [reload, setReload] = useState(0);
  const [keyword, setKeyword] = useState(''), [filter, setFilter] = useState('all');
  const [editing, setEditing] = useState<Entry | 'new' | null>(null), [names, setNames] = useState<Translation[]>(blank), [newLocale, setNewLocale] = useState(''), [formError, setFormError] = useState(''), [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const refresh = () => setReload((n) => n + 1);
  const path = `/api/taxonomy/${kind}`;
  useEffect(() => {
    let active = true; setLoading(true); setLoadError(false);
    request<Entry[]>(path).then((value) => { if (active) setItems(value); }).catch((err: unknown) => {
      if (!active) return;
      if (err instanceof ApiError && err.status === 401) onExpired(); else setLoadError(true);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, reload, onExpired]);
  function open(entry: Entry | 'new') {
    const initial = entry === 'new' ? blank() : [...entry.translations];
    for (const locale of ['zh-CN', 'en']) if (!initial.some((row) => row.locale.toLowerCase() === locale.toLowerCase())) initial.push({ locale, name: '' });
    setNames(initial); setEditing(entry); setFormError(''); setNewLocale('');
  }
  async function save() {
    const rows = names.map((row) => ({ locale: row.locale, name: row.name.trim() })).filter((row) => row.name);
    if (!rows.length) { setFormError('taxonomyNameRequired'); return; }
    setBusy(true); setFormError('');
    try {
      await request(editing === 'new' ? path : `${path}/${(editing as Entry).id}`, { method: editing === 'new' ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ translations: rows }) });
      setEditing(null); refresh();
    } catch (err) { setFormError(err instanceof ApiError && err.status === 409 ? 'taxonomyDuplicate' : err instanceof ApiError && err.status === 401 ? 'sessionSaveError' : 'taxonomySaveError'); }
    finally { setBusy(false); }
  }
  async function action(entry: Entry, operation: 'status' | 'delete') {
    setActionError('');
    try {
      await request(`${path}/${entry.id}${operation === 'status' ? '/status' : ''}`, operation === 'status' ? { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !entry.active }) } : { method: 'DELETE' });
      refresh();
    } catch (err) { if (err instanceof ApiError && err.status === 401) onExpired(); else setActionError(err instanceof ApiError && err.status === 409 ? 'taxonomyInUse' : 'taskFailed'); }
  }
  const search = keyword.trim().toLowerCase();
  const visible = items.filter((entry) => (filter === 'all' || entry.active === (filter === 'active')) && (!search || entry.id.toLowerCase().includes(search) || entry.translations.some((row) => row.name.toLowerCase().includes(search))));
  const name = (entry: Entry) => entry.translations.find((row) => row.locale.toLowerCase() === i18n.language.toLowerCase())?.name ?? null;
  const columns = [
    { title: t('taxonomyName'), key: 'name', render: (_: unknown, row: Entry) => <><strong>{name(row) ?? t('missingTranslation')}</strong>{row.systemKey && <Tag color="blue">{t('taxonomySystemTag')}</Tag>}<span className="drama-id">{row.id}</span></> },
    { title: t('taxonomyLanguages'), key: 'translations', render: (_: unknown, row: Entry) => <div className="taxonomy-translations">{row.translations.map((item) => <span key={item.locale}><strong>{item.locale}</strong> {item.name}</span>)}</div> },
    { title: t('status'), key: 'status', render: (_: unknown, row: Entry) => <Tag color={row.active ? 'green' : undefined}>{t(row.active ? 'taxonomyActive' : 'taxonomyInactive')}</Tag> },
    { title: t('taxonomyUsage'), dataIndex: 'usageCount', key: 'usage' },
    { title: t('operations'), key: 'actions', render: (_: unknown, row: Entry) => row.systemKey ? <Tag color="blue">{t('taxonomyLocked')}</Tag> : <div className="taxonomy-actions"><Button type="link" onClick={() => open(row)}>{t('edit')}</Button><Popconfirm title={t(row.active ? 'taxonomyDisableConfirm' : 'taxonomyEnableConfirm')} onConfirm={() => void action(row, 'status')} okText={t('confirm')} cancelText={t('episodeCancel')}><Button type="link">{t(row.active ? 'taxonomyDisable' : 'taxonomyEnable')}</Button></Popconfirm><Popconfirm title={t('taxonomyDeleteConfirm')} onConfirm={() => void action(row, 'delete')} okText={t('confirm')} cancelText={t('episodeCancel')} disabled={row.usageCount > 0}><Button type="link" danger disabled={row.usageCount > 0} title={row.usageCount > 0 ? t('taxonomyInUse') : undefined}>{t('taxonomyDelete')}</Button></Popconfirm></div> },
  ];
  return <div className="taxonomy-page"><div className="drama-heading"><div><h1>{t(kind === 'categories' ? 'categoryManagement' : 'tagManagement')}</h1><p>{t('taxonomyIntro')}</p></div><Button type="primary" onClick={() => open('new')}>＋ {t(kind === 'categories' ? 'addCategory' : 'addTag')}</Button></div>
    <section className="drama-panel">{actionError && <Alert className="episode-notice" type="error" title={t(actionError)} closable onClose={() => setActionError('')} />}{loadError && <Alert className="episode-notice" type="error" title={t('loadError')} action={<Button onClick={refresh}>{t('retry')}</Button>} />}
      <div className="taxonomy-filters"><Input.Search aria-label={t('taxonomySearch')} placeholder={t('taxonomySearch')} allowClear value={keyword} onChange={(e) => setKeyword(e.target.value)} /><Select aria-label={t('status')} value={filter} onChange={setFilter} options={[{ value: 'all', label: t('all') }, { value: 'active', label: t('taxonomyActive') }, { value: 'inactive', label: t('taxonomyInactive') }]} /></div>
      <Table<Entry> rowKey="id" columns={columns} dataSource={visible} loading={loading} scroll={{ x: 760 }} locale={{ emptyText: t('taxonomyEmpty') }} pagination={{ pageSize: 20, showSizeChanger: false }} />
    </section>
    <Modal open={!!editing} title={t(editing === 'new' ? (kind === 'categories' ? 'addCategory' : 'addTag') : (kind === 'categories' ? 'editCategory' : 'editTag'))} onCancel={() => { if (!busy) setEditing(null); }} onOk={() => void save()} okText={t('taxonomySave')} cancelText={t('episodeCancel')} confirmLoading={busy} closable={!busy} maskClosable={!busy} destroyOnHidden>
      <p className="media-note">{t('taxonomyFormHint')}</p>{formError && <Alert className="episode-notice" type="error" title={t(formError)} />}
      <div className="taxonomy-form">{names.map((row) => <div className="taxonomy-language-row" key={row.locale}><label htmlFor={`taxonomy-${row.locale}`}>{row.locale}</label><Input id={`taxonomy-${row.locale}`} value={row.name} maxLength={200} disabled={busy} onChange={(e) => setNames((old) => old.map((item) => item.locale === row.locale ? { ...item, name: e.target.value } : item))} />{!['zh-cn', 'en'].includes(row.locale.toLowerCase()) && <Button disabled={busy} onClick={() => setNames((old) => old.filter((item) => item.locale !== row.locale))}>{t('remove')}</Button>}</div>)}</div>
      <div className="locale-add"><Input aria-label={t('localePlaceholder')} placeholder={t('localePlaceholder')} value={newLocale} disabled={busy} onChange={(e) => setNewLocale(e.target.value)} /><Button disabled={busy} onClick={() => { const locale = newLocale.trim(); if (!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(locale) || names.some((row) => row.locale.toLowerCase() === locale.toLowerCase())) { setFormError('localeInvalid'); return; } setNames((old) => [...old, { locale, name: '' }]); setNewLocale(''); setFormError(''); }}>{t('addLanguage')}</Button></div>
    </Modal>
  </div>;
}
