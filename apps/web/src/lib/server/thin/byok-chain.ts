// Key wizard → the logged-in account's own provider chain (xai + grok model). Only the given login is read and written.
import type { Provider } from '../../../../../hh/src/model/model.ts';
import type { KeyCheck } from './byok-check.ts';

import { presetOf } from '../../../../../hh/src/model/model.ts';
import { validXaiKey } from './byok-check.ts';

type Stored = { modelChain: string };
export type ChainDeps<A extends Stored> = {
  read: (login: string) => Promise<A>;
  write: (login: string, next: A) => Promise<void>;
  test: (key: string) => Promise<KeyCheck>;
};

export function xaiProvider(key: string): Provider {
  const preset = presetOf('xai')!;

  return { id: 'xai', key: key.trim(), model: preset.model, url: preset.url };
}

// Valid key (works or «ключ верный, но нет кредитов») → replaces this login's xai entry, others kept in order.
export async function addXaiToChain<A extends Stored>(login: string, key: string, deps: ChainDeps<A>): Promise<{ ok: boolean; detail: string }> {
  if (validXaiKey(key) === false)
    return { ok: false, detail: 'не похоже на ключ xAI (xai-…)' };

  const check = await deps.test(key);
  if (check.ok === false && check.code !== 'key-no-credits')
    return { ok: false, detail: check.message };

  const saved = await deps.read(login);
  let chain: Provider[] = [];
  try {
    chain = saved.modelChain ? JSON.parse(saved.modelChain) as Provider[] : [];
  }
  catch {
    chain = [];
  }
  const next = [...chain.filter(item => item.id !== 'xai'), xaiProvider(key)];
  await deps.write(login, { ...saved, modelChain: JSON.stringify(next) });

  return { ok: true, detail: check.ok ? 'Grok добавлен в цепочку' : 'Grok добавлен в цепочку (ключ верный, но нет кредитов)' };
}
