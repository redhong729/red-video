const pendingGets = new Map<string, Promise<unknown>>();

export function dedupeGet<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = pendingGets.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = Promise.resolve().then(load);
  pendingGets.set(key, request);
  const clear = () => {
    if (pendingGets.get(key) === request) pendingGets.delete(key);
  };
  void request.then(clear, clear);
  return request;
}
