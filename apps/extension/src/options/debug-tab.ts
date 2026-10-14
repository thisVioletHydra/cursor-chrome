// Debug panel: token field, deviceId, every fingerprint signal (raw local + hash), score, reason, slot, pass,
// what went to the server and what stays local.
import { browser } from '../browser-host';
import { checkIn, loadAccess, saveAccess } from '../local/access.ts';
import { localStore } from '../local/chrome-store.ts';
import { INDEX_KEY } from '../local/store.ts';
import { collectRaw, hashSignals, SIGNALS } from '../local/fingerprint.ts';
import { getSyncKey, getSyncUrl } from '../diary/apply-log';

const area = {
  get: (keys: string | string[]) => browser.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
};

const mask = (text: string) => (text.length > 8 ? `${text.slice(0, 4)}…${text.slice(-2)}` : text ? '••••' : '');

async function base(): Promise<string> {
  try {
    const url = new URL((await getSyncUrl()).trim());

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}

export function renderDebug(): HTMLElement {
  const box = document.createElement('div');
  void fill(box);

  return box;
}

async function fill(box: HTMLElement): Promise<void> {
  const state = await loadAccess(area);
  const raw = collectRaw(state.deviceId);
  const hashes = await hashSignals(raw);
  const data = await localStore.loadOrEmpty();
  const lay = await localStore.layout();
  const index = ((await area.get(INDEX_KEY))[INDEX_KEY] ?? []) as Array<{ id: number; k: string; a: string; long: boolean; t: string; h?: boolean }>;
  const indexRows = index.slice(0, 8).map(row => `<tr><td>${row.id}</td><td>${esc(row.k.slice(0, 60))}</td><td>${row.long ? '<span class="tag">full answer in IndexedDB</span>' : esc(row.a.slice(0, 60))}</td><td>${row.t}</td><td>${row.h ? 'yours' : 'AI'}</td></tr>`).join('');
  const server = await base();
  const per = state.last?.perSignal ?? {};
  const rows = SIGNALS.map(name => `<tr><td>${name}</td><td>${esc(raw[name] || '—')}</td><td class="dim">${hashes[name].slice(0, 16)}…</td><td>${name in per ? (per[name] ? '✓ same' : '✗ differs') : ''}</td></tr>`).join('');
  box.innerHTML = `
    <div class="card"><b>Memory storage</b> <span class="dim">schema ${lay.schema}</span>
      <div class="row"><label>chrome.storage.local</label><div>${(lay.storageBytes / 1024).toFixed(1)} KB · index ${lay.indexRows} rows (${lay.longRows} long → IndexedDB only)</div></div>
      <div class="row"><label>IndexedDB (extension)</label><div>${lay.idbRows ?? 'n/a'} full rows · ${(JSON.stringify(data.memory).length / 1024 / 1024).toFixed(2)} MB</div></div>
      <div class="row"><label>Lookup order</label><div>apply-fill → index (storage) → background → IndexedDB</div></div>
      <table><tr><th>id</th><th>Normalized question</th><th>Short answer (index)</th><th>Type</th><th>Origin</th></tr>${indexRows}</table></div>
    <div class="card"><b>Access</b>
      <div class="row"><label>Server</label><div>${esc(server || 'not linked')}</div></div>
      <div class="row"><label>Access token</label><div class="tools"><input id="tok" placeholder="cct_…" value=""><button class="btn" id="save">Save &amp; check</button><button class="btn ghost" id="again">Check now</button><button class="btn ghost" id="probe">Test extension endpoint</button></div></div>
      <div class="row"><label>Saved token</label><div>${esc(mask(state.token)) || 'none'}</div></div>
      <div class="row"><label>deviceId</label><div>${esc(state.deviceId)}</div></div>
      <div class="row"><label>Last check</label><div>${state.last ? `${new Date(state.last.at).toLocaleString()} · HTTP ${state.last.status} · score <b>${state.last.score}/10</b> (${esc(state.last.zone ?? '-')}) · ${esc(state.last.reason)}` : 'never'}</div></div>
      <div class="row"><label>Slot</label><div>${state.last?.slot ?? '—'} of 2</div></div>
      <div class="row"><label>Pass</label><div>${state.pass ? `${esc(mask(state.pass))} until ${new Date(state.passExpires).toLocaleString()}` : 'none'}</div></div>
    </div>
    <div class="card"><b>Fingerprint signals</b> <span class="dim">raw values stay in this browser, server gets only hashes</span>
      <table><tr><th>Signal</th><th>Raw (local only)</th><th>Hash (sent)</th><th>vs reference</th></tr>${rows}</table></div>
    <div class="card"><b>Sent to server (last request body, no keys)</b><pre>${esc(JSON.stringify(state.last?.sent ?? null, null, 2))}</pre>
      <div class="dim">Header: authorization: Bearer ${esc(mask(state.token))} (token itself never logged)</div></div>
    <div class="card"><b>Stays local</b><pre>${esc(JSON.stringify({ profileFields: Object.keys(data.profile?.fields ?? {}), facts: data.facts.rules.length, rules: data.rules.length, memory: data.memory.length, coverLetterChars: data.coverLetter.length, rawSignals: 'all', token: 'chrome.storage.local' }, null, 2))}</pre></div>
    <div class="card"><b>Log</b><pre>${esc(state.log.slice(-20).reverse().map(item => `${new Date(item.at).toLocaleTimeString()} ${item.text}`).join('\n') || 'empty')}</pre></div>`;
  const run = async () => {
    await checkIn(area, server, raw);
    await fill(box);
  };
  box.querySelector<HTMLButtonElement>('#save')!.onclick = async () => {
    const token = box.querySelector<HTMLInputElement>('#tok')!.value.trim();
    if (token)
      await saveAccess(area, { ...(await loadAccess(area)), token, pass: '', passExpires: 0 });
    await run();
  };
  box.querySelector<HTMLButtonElement>('#again')!.onclick = () => void run();
  // calls a normal extension endpoint with the extToken + current pass: shows what the gate answers
  box.querySelector<HTMLButtonElement>('#probe')!.onclick = async () => {
    const now = await loadAccess(area);
    let text: string;
    try {
      const res = await fetch(`${server}/api/resume`, { headers: { authorization: `Bearer ${await getSyncKey()}`, ...(now.pass ? { 'x-access-pass': now.pass } : {}) } });
      const body = await res.json().catch(() => ({})) as { error?: string };
      text = `GET /api/resume → ${res.status}${body.error ? ` (${body.error})` : ''}${now.pass ? ' · with pass' : ' · no pass'}`;
    }
    catch {
      text = 'GET /api/resume → server unreachable';
    }
    await saveAccess(area, { ...now, log: [...now.log, { at: Date.now(), text }] });
    await fill(box);
  };
}

function esc(text: string): string {
  return text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}
