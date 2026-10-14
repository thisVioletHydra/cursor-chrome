// Background: answer a form field via the server (thin client). Context = local data + index candidates,
// BYOK key (decrypted only for this request) in x-llm-key. The server decides; we only fill. Never submits.
import { getSyncKey } from '../diary/apply-log';
import { browser } from '../browser-host';
import { idbKeyStore, loadByok } from '../local/byok.ts';
import { localStore } from '../local/chrome-store.ts';
import { askServer, contextFor } from '../local/thin-answer.ts';
import { syncBase } from './queue-run';

export type CloudAnswer = { answer?: string; human?: boolean; reason?: string; source?: string };

const area = {
  get: (keys: string | string[]) => browser.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
};

export async function askCloud(question: Record<string, unknown>): Promise<CloudAnswer> {
  const base = await syncBase();
  const key = await getSyncKey();
  if (base.length === 0 || key.length === 0)
    return { human: true, reason: 'админка не подключена' };

  const field = { id: 'q', prompt: String(question.prompt ?? ''), kind: (question.kind === 'number' || question.kind === 'choice' ? question.kind : 'text') as 'text' | 'number' | 'choice', options: Array.isArray(question.options) ? question.options.map(String) : [] };
  const data = await localStore.load().catch(() => null);
  const vacancy = typeof question.vacancyTitle === 'string' ? { title: question.vacancyTitle } : {};
  const byok = await loadByok(area, idbKeyStore()).catch(() => null);
  const [reply] = await askServer(base, key, [field], contextFor([field], data, vacancy, String(question.context ?? '')), { llmKey: byok?.key, llmProvider: byok?.provider, version: browser.runtime.getManifest().version });

  return typeof reply?.answer === 'string' ? { answer: reply.answer, source: reply.source } : { human: true, reason: reply?.reason || 'нет факта' };
}
