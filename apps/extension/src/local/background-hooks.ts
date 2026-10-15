// Background side of local data + access: first-run import from the server and the 4-hour device check.
import { browser } from '../browser-host';
import { getSyncKey, getSyncUrl } from '../diary/apply-log';
import { CHECK_EVERY_MS, checkIn, loadAccess, needsCheck } from './access.ts';
import { localStore } from './chrome-store.ts';
import { collectRaw } from './fingerprint.ts';
import { importFromServer } from './server-import.ts';
import { installPassHeader } from './pass-header.ts';
import { refreshConfig } from './config-cache.ts';
import { forgetBadge } from '../link/offscreen-ctl';
import { FAST_PROBE_MS, gateOpen, gateText, LINK_GATE_KEY, probeDue, readGate, refreshGate } from './link-gate.ts';
import { installGateFetch } from './gate-fetch.ts';

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

const LINK_ALARM = 'cc-link-gate';

// true = not linked to the admin (no token / 401 / dead server): all site actions pause quietly.
export async function linkPaused(): Promise<boolean> {
  let gate = await readGate(area);
  // closed gate: probe on a growing interval (30 s … 15 min), not on every alarm/message
  if (probeDue(gate)) {
    const prev = gate;
    gate = await refreshGate(area, await getSyncUrl(), await getSyncKey(), fetch, prev).catch(() => prev);
  }
  void paintGateBadge(gate);

  return gateOpen(gate) === false;
}

// popup open: every 3 s it asks for a live check of an OPEN gate, so a dead server shows within ~5 s.
// Closed gate → nothing here (the backoff probe owns it). One request in flight, at most one per 2.5 s.
let pingAt = 0;
let pinging = false;
export async function pingGate(now = Date.now()): Promise<void> {
  if (pinging || now - pingAt < 2500)
    return;
  const gate = await readGate(area);
  if (gateOpen(gate) === false)
    return;
  pinging = true;
  pingAt = now;
  try {
    await refreshGate(area, await getSyncUrl(), await getSyncKey(), fetch, gate);
  }
  catch {
  }
  finally {
    pinging = false;
  }
}

let repaintBadge: () => Promise<void> = async () => {};
let lastGateOpen: boolean | null = null;
let closedPainted = '';

// background.ts hands over setBadge(connected): when the link comes back, the «!» is replaced at once.
export function onGateReopen(repaint: () => Promise<void>): void {
  repaintBadge = repaint;
}

async function paintGateBadge(gate: Awaited<ReturnType<typeof readGate>>): Promise<void> {
  const open = gateOpen(gate);
  const reopened = open && lastGateOpen !== true;
  lastGateOpen = open;
  if (open) {
    closedPainted = '';
    if (reopened)
      await repaintBadge().catch(() => {});

    return;
  }
  // paint «!» once per closed spell: repainting it on every probe made the toolbar icon flicker
  const title = gateText(gate);
  if (closedPainted === title)
    return;
  closedPainted = title;
  forgetBadge();
  try {
    await browser.action.setBadgeText({ text: '!' });
    await browser.action.setBadgeBackgroundColor({ color: '#b45309' });
    await browser.action.setTitle({ title: gateText(gate) });
  }
  catch {
  }
}

export function startLocalHooks(): void {
  const version = browser.runtime.getManifest().version;
  installPassHeader(area, base, listener => browser.storage.onChanged.addListener(listener), version);
  installGateFetch(area, base, listener => browser.storage.onChanged.addListener(listener));
  // gate written elsewhere (401 seen by the fetch guard, popup check): badge follows at once
  browser.storage.onChanged.addListener((changes) => {
    if (LINK_GATE_KEY in changes) {
      const next = (changes[LINK_GATE_KEY].newValue ?? null) as Awaited<ReturnType<typeof readGate>>;
      void paintGateBadge(next);
      // lost by a live failure: one quick re-check in 2 s (a single dropped request does not stick)
      if (next?.fast === true && next.state !== 'ok')
        setTimeout(() => void linkPaused().catch(() => null), FAST_PROBE_MS + 50);
    }
  });
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
  void browser.alarms.create(LINK_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LINK_ALARM)
      void linkPaused().catch(() => null);
  });
  browser.storage.onChanged.addListener((changes) => {
    if ('applySyncUrl' in changes || 'applySyncKey' in changes)
      void getSyncUrl().then(async url => refreshGate(area, url, await getSyncKey())).catch(() => null);
  });
  void accessTick();
}
