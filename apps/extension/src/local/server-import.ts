// First run: copy the account's personal data from our server (GET /api/account-data) into local storage.
// The server keeps serving it (backward compatible); local data is never overwritten by this import.
import type { LocalStore } from './store.ts';

import { parseLocalData } from './schema.ts';

export type ImportOutcome = { done: boolean; reason: string };

export async function importFromServer(store: LocalStore, base: string, key: string, fetcher: typeof fetch = fetch, force = false): Promise<ImportOutcome> {
  if (force === false && await store.initialized())
    return { done: false, reason: 'локальные данные уже есть' };

  if (!base || !key)
    return { done: false, reason: 'нет адреса сервера или ключа расширения' };

  let body: unknown;
  try {
    const res = await fetcher(`${base}/api/account-data`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (res.ok === false)
      return { done: false, reason: `сервер ответил ${res.status}` };

    body = await res.json();
  }
  catch {
    return { done: false, reason: 'сервер недоступен' };
  }

  const parsed = parseLocalData(body);
  if (parsed.ok === false)
    return { done: false, reason: parsed.error };

  if (force) {
    // explicit re-import: keep local memory and rules the user already has, take the rest from the server
    const current = await store.load();
    await store.save(current ? { ...parsed.data, memory: current.memory.length > 0 ? current.memory : parsed.data.memory, rules: current.rules.length > 0 ? current.rules : parsed.data.rules } : parsed.data);
  }
  else {
    await store.save(parsed.data);
  }

  return { done: true, reason: 'импортировано с сервера' };
}
