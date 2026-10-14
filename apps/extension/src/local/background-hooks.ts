// Background side of local data + access: first-run import from the server and the 4-hour device check.
import { browser } from '../browser-host';
import { getSyncKey, getSyncUrl } from '../diary/apply-log';
import { CHECK_EVERY_MS, checkIn, loadAccess, needsCheck } from './access.ts';
import { localStore } from './chrome-store.ts';
import { collectRaw } from './fingerprint.ts';
import { importFromServer } from './server-import.ts';
import { installPassHeader } from './pass-header.ts';
import { refreshConfig } from './config-cache.ts';

const ACCESS_ALARM = 'cc-access-check';

const area = {
  get: (keys: string | string[]) => browser.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
};

async function base(): Promise<string> {
  try {
    const url = new URL((await getSyncUrl()).trim());

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}

async function accessTick(): Promise<void> {
  const state = await loadAccess(area);
  if (needsCheck(state) === false)
    return;

  // no document in the worker: fonts come from the last check made on the extension page
  const raw = { ...collectRaw(state.deviceId), fonts: state.fontsCache ?? '' };
  await checkIn(area, await base(), raw);
}

export function startLocalHooks(): void {
  const version = browser.runtime.getManifest().version;
  installPassHeader(area, base, listener => browser.storage.onChanged.addListener(listener), version);
  void localStore.migrate().catch(() => null);
  // remote config (selectors, dictionaries, rule order): cached, last valid one wins
  void base().then(origin => refreshConfig(area, origin, version)).catch(() => null);
  browser.storage.onChanged.addListener((changes) => {
    if ('applySyncUrl' in changes)
      void base().then(origin => refreshConfig(area, origin, version)).catch(() => null);
  });
  void importFromServer(localStore, '', '').then(async (first) => {
    if (first.reason !== 'локальные данные уже есть')
      await importFromServer(localStore, await base(), await getSyncKey());
  }).catch(() => null);
  void browser.alarms.create(ACCESS_ALARM, { periodInMinutes: CHECK_EVERY_MS / 60_000 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ACCESS_ALARM) {
      void accessTick();
      void base().then(origin => refreshConfig(area, origin, version)).catch(() => null);
    }
  });
  browser.runtime.onStartup.addListener(() => void accessTick());
  void accessTick();
}
