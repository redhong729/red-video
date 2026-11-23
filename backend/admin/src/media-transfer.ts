export type Chunk = { number: number; size: number; sha256: string };
export type UploadItem = { id: string; batchId: string; episodeId: string; episode: { number: number; draftMediaId: string | null }; filename: string; size: number; fingerprint: string; chunkSize: number; chunkCount: number; status: string; phase: string; detectStatus: string; transcodeStatus: string; coverStatus: string; previewStatus: string; error: string | null; duration: number | null; selectedCover: string | null; uploadedAt: string | null; chunks: Chunk[] };
export type Batch = { id: string; dramaId: string; dramaTitle: string | null; createdAt: string; expiresAt: string; items: UploadItem[] };
export type Transfer = { batchId: string; loaded: number; total: number; status: 'QUEUED' | 'UPLOADING' | 'SENT' | 'ERROR' | 'CANCELLED'; error?: string };
type Work = { item: UploadItem; file: File; hashes: string[]; abort: AbortController };
const transfers = new Map<string, Transfer>();
const controllers = new Map<string, AbortController>();
const queue: Work[] = [];
let running = 0;
const event = 'red-video-media-transfer';
const emit = () => window.dispatchEvent(new Event(event));
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, '0')).join('');
const digest = async (bytes: BufferSource) => hex(await crypto.subtle.digest('SHA-256', bytes));

export function subscribeTransfers(callback: () => void) { window.addEventListener(event, callback); return () => window.removeEventListener(event, callback); }
export function getTransfer(id: string) { return transfers.get(id); }
export function abortBatchTransfers(batchId: string) {
  for (const [id, state] of transfers) if (state.batchId === batchId && ['QUEUED', 'UPLOADING'].includes(state.status)) {
    controllers.get(id)?.abort(); transfers.set(id, { ...state, status: 'CANCELLED' });
  }
  emit();
}
export async function fingerprint(file: File, chunkSize: number, progress?: (done: number) => void) {
  const hashes: string[] = [];
  for (let offset = 0; offset < file.size; offset += chunkSize) {
    hashes.push(await digest(await file.slice(offset, Math.min(offset + chunkSize, file.size)).arrayBuffer()));
    progress?.(Math.min(offset + chunkSize, file.size));
  }
  const bytes = new Uint8Array(hashes.length * 32);
  hashes.forEach((hash, index) => { for (let i = 0; i < 32; i++) bytes[index * 32 + i] = parseInt(hash.slice(i * 2, i * 2 + 2), 16); });
  return { fingerprint: await digest(bytes), hashes };
}
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function send(url: string, options: RequestInit, signal: AbortSignal) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, { ...options, signal });
      if (response.ok) return;
      if (response.status < 500 || attempt === 2) throw new Error(`HTTP ${response.status}`);
    } catch (error) {
      if (signal.aborted || (error instanceof Error && /^HTTP 4/.test(error.message)) || attempt === 2) throw error;
    }
    await delay(400 * (attempt + 1));
  }
}
async function run(work: Work) {
  const { item, file, hashes, abort } = work;
  const previous = new Set(item.chunks.map((chunk) => chunk.number));
  let loaded = item.chunks.reduce((sum, chunk) => sum + chunk.size, 0);
  const update = (status: Transfer['status'], error?: string) => { transfers.set(item.id, { batchId: item.batchId, loaded, total: item.size, status, error }); emit(); };
  try {
    update('UPLOADING');
    for (let index = 0; index < item.chunkCount; index++) {
      if (abort.signal.aborted) throw new Error('cancelled');
      if (previous.has(index)) continue;
      const part = file.slice(index * item.chunkSize, Math.min((index + 1) * item.chunkSize, file.size));
      await send(`/api/media/items/${item.id}/chunks/${index}`, { method: 'PUT', headers: { 'Content-Type': 'application/octet-stream', 'X-Chunk-Sha256': hashes[index] }, body: part }, abort.signal);
      loaded += part.size; update('UPLOADING');
    }
    await send(`/api/media/items/${item.id}/complete`, { method: 'POST' }, abort.signal);
    update('SENT');
  } catch (error) { update(abort.signal.aborted ? 'CANCELLED' : 'ERROR', error instanceof Error ? error.message : 'Network error'); }
  finally { controllers.delete(item.id); }
}
function pump() {
  while (running < 2 && queue.length) {
    const work = queue.shift()!;
    if (work.abort.signal.aborted) continue;
    running++;
    void run(work).finally(() => { running--; pump(); });
  }
}
export function queueUpload(item: UploadItem, file: File, hashes: string[]) {
  if (controllers.has(item.id)) return;
  const abort = new AbortController(); controllers.set(item.id, abort);
  transfers.set(item.id, { batchId: item.batchId, loaded: item.chunks.reduce((sum, chunk) => sum + chunk.size, 0), total: item.size, status: 'QUEUED' });
  queue.push({ item, file, hashes, abort }); emit(); pump();
}
