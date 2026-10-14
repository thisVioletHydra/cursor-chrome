// Admin page inside the extension. All data comes from and goes to local storage (localStore).
import type { LocalData } from '../local/schema.ts';

import { PROFILE_QUESTIONS } from '../../../hh/src/review/profile-questions.ts';
import { localStore } from '../local/chrome-store.ts';
import { exportLocalData, parseLocalData } from '../local/schema.ts';
import { importFromServer } from '../local/server-import.ts';
import { getSyncKey, getSyncUrl } from '../diary/apply-log';
import { renderDebug } from './debug-tab.ts';
import { browser } from '../browser-host';
import { byokInfo, idbKeyStore, saveByok } from '../local/byok.ts';
import { bannerHtml, updateFlag } from '../local/version.ts';
import { watchUpdating } from '../local/updating.ts';
import { maskKey, readClipboardKey, STEPS, testKey, validXaiKey, XAI_KEYS_URL } from '../local/key-wizard.ts';
// provider ids the server accepts in x-llm-provider (server-side presets; no custom URLs from the client)
const PRESETS = [{ id: 'xai', name: 'xAI Grok' }, { id: 'groq', name: 'Groq' }, { id: 'gemini', name: 'Gemini' }, { id: 'zai', name: 'Z.ai' }, { id: 'openrouter', name: 'OpenRouter' }, { id: 'cohere', name: 'Cohere' }, { id: 'deepseek', name: 'DeepSeek' }, { id: 'mistral', name: 'Mistral' }];

type Tab = { id: string; label: string; render: (data: LocalData) => HTMLElement };

const TABS: Tab[] = [
  { id: 'profile', label: 'Profile', render: profileTab },
  { id: 'facts', label: 'Facts', render: factsTab },
  { id: 'memory', label: 'Memory', render: memoryTab },
  { id: 'rules', label: 'Rules', render: rulesTab },
  { id: 'letter', label: 'Cover letter', render: letterTab },
  { id: 'data', label: 'Export / import', render: dataTab },
  { id: 'llm', label: 'LLM key', render: () => llmTab() },
  { id: 'debug', label: 'Debug', render: () => renderDebug() },
];

let current = location.hash.slice(1) || 'profile';
let data: LocalData;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const el = (tag: string, props: Record<string, any> = {}, ...kids: Array<Node | string>): any => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...kids);

  return node;
};

function status(text: string, fail = false): void {
  const node = document.getElementById('status')!;
  node.textContent = text;
  node.className = fail ? 'fail' : '';
  setTimeout(() => { if (node.textContent === text) node.textContent = ''; }, 4_000);
}

async function save(next: LocalData, text = 'Saved locally'): Promise<void> {
  await localStore.save(next);
  data = next;
  status(text);
}

function draw(): void {
  const nav = document.getElementById('tabs')!;
  nav.replaceChildren(...TABS.map(tab => el('button', { className: tab.id === current ? 'on' : '', textContent: tab.label, onclick: () => { current = tab.id; location.hash = tab.id; draw(); } })));
  const tab = TABS.find(item => item.id === current) ?? TABS[0]!;
  document.getElementById('view')!.replaceChildren(tab.render(data));
}

function fixedValue(key: string): string {
  const rule = data.profile?.fields[key];
  if (!rule)
    return '';

  return rule.mode === 'fixed' ? rule.value : rule.mode === 'conditions' ? `${rule.otherwise}` : rule.fallback ?? '';
}

function profileTab(): HTMLElement {
  const box = el('div');
  if (data.profile === null || Object.keys(data.profile.fields).length === 0)
    box.append(el('div', { className: 'card' }, el('b', { textContent: 'Welcome! Fill in your questionnaire' }), el('div', { className: 'dim', textContent: 'These answers fill employer questions on hh. They stay in this browser only.' })));

  const card = el('div', { className: 'card' });
  const inputs = new Map<string, HTMLInputElement>();
  for (const q of PROFILE_QUESTIONS) {
    const rule = data.profile?.fields[q.key];
    const input = el('input', { value: fixedValue(q.key), placeholder: q.hint });
    inputs.set(q.key, input);
    const note = rule && rule.mode === 'conditions' ? el('div', { className: 'dim', textContent: `conditional: ${rule.cases.map(c => `${c.when.map(w => `${w.field} ${w.op} ${w.value}`).join(' & ')} → ${c.value}`).join('; ')}; otherwise → ${rule.otherwise}` }) : '';
    card.append(el('div', { className: 'row' }, el('label', { textContent: q.label }), el('div', {}, input, note)));
  }
  card.append(el('button', { className: 'btn', textContent: 'Save profile', onclick: () => {
    const fields = { ...data.profile?.fields };
    for (const [key, input] of inputs) {
      const value = input.value.trim();
      const old = fields[key];
      if (old?.mode === 'conditions')
        fields[key] = { ...old, otherwise: value };
      else if (value)
        fields[key] = { mode: 'fixed', value };
      else
        delete fields[key];
    }
    void save({ ...data, profile: { version: 1, savedAt: Date.now(), fields, custom: data.profile?.custom ?? [] } });
  } }));
  box.append(card);

  return box;
}

function factsTab(): HTMLElement {
  const rules = el('textarea', { value: data.facts.rules.join('\n'), rows: 10 });
  const notes = el('textarea', { value: data.facts.notes, rows: 6 });
  const resume = el('textarea', { value: data.facts.resume, rows: 6 });

  return el('div', { className: 'card' },
    el('div', { className: 'row' }, el('label', { textContent: 'Rules (one per line)' }), rules),
    el('div', { className: 'row' }, el('label', { textContent: 'Notes' }), notes),
    el('div', { className: 'row' }, el('label', { textContent: 'Resume' }), resume),
    el('button', { className: 'btn', textContent: 'Save facts', onclick: () => void save({ ...data, facts: { rules: rules.value.split('\n').map(s => s.trim()).filter(Boolean), notes: notes.value, resume: resume.value } }) }));
}

function memoryTab(): HTMLElement {
  const table = el('table', {}, el('tr', {}, el('th', { textContent: 'Question' }), el('th', { textContent: 'Answer' }), el('th')));
  data.memory.slice(0, 300).forEach((row, index) => {
    const answer = el('textarea', { value: row.answer, rows: 2 });
    table.append(el('tr', {},
      el('td', {}, row.prompt, row.human ? el('span', { className: 'tag human', textContent: 'yours' }) : el('span', { className: 'tag', textContent: 'AI' })),
      el('td', {}, answer),
      el('td', {}, el('button', { className: 'btn ghost', textContent: 'Save', onclick: () => {
        const memory = [...data.memory];
        memory[index] = { ...row, answer: answer.value.trim(), human: true };
        void save({ ...data, memory });
      } }), ' ', el('button', { className: 'btn ghost', textContent: 'Delete', onclick: () => void save({ ...data, memory: data.memory.filter((_, i) => i !== index) }).then(draw) }))));
  });

  return el('div', { className: 'card' }, el('div', { className: 'dim', textContent: `${data.memory.length} remembered answers` }), table);
}

function rulesTab(): HTMLElement {
  const box = el('div');
  const add = () => void save({ ...data, rules: [...data.rules, { id: Date.now(), title: 'New rule', answer: '-', aliases: [] }] }).then(draw);
  box.append(el('div', { className: 'tools' }, el('button', { className: 'btn', textContent: 'Add rule', onclick: add }), el('span', { className: 'dim', textContent: `${data.rules.length} rules · templates: {{profile.city}}, {{vacancy.city}}` })));
  data.rules.slice(0, 200).forEach((rule, index) => {
    const title = el('input', { value: rule.title });
    const aliases = el('textarea', { value: rule.aliases.join('\n'), rows: 3 });
    const answer = el('textarea', { value: rule.answer, rows: 3 });
    box.append(el('div', { className: 'card' },
      el('div', { className: 'row' }, el('label', { textContent: 'Question' }), title),
      el('div', { className: 'row' }, el('label', { textContent: 'Also matches' }), aliases),
      el('div', { className: 'row' }, el('label', { textContent: 'Answer' }), answer),
      el('div', { className: 'tools' },
        el('button', { className: 'btn ghost', textContent: 'Save', onclick: () => {
          const rules = [...data.rules];
          rules[index] = { ...rule, title: title.value.trim(), answer: answer.value.trim(), aliases: aliases.value.split('\n').map(s => s.trim()).filter(Boolean) };
          void save({ ...data, rules });
        } }),
        el('button', { className: 'btn ghost', textContent: 'Delete', onclick: () => void save({ ...data, rules: data.rules.filter((_, i) => i !== index) }).then(draw) }))));
  });

  return box;
}

function letterTab(): HTMLElement {
  const text = el('textarea', { value: data.coverLetter, rows: 14 });

  return el('div', { className: 'card' }, text, el('div', { className: 'tools' }, el('button', { className: 'btn', textContent: 'Save letter', onclick: () => void save({ ...data, coverLetter: text.value.trim() }) })));
}

function dataTab(): HTMLElement {
  const file = el('input', { type: 'file', accept: 'application/json' });
  const out = el('pre');
  const doExport = () => {
    const blob = new Blob([exportLocalData(data)], { type: 'application/json' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `NoJobNoProblemBuddy-data-${new Date().toISOString().slice(0, 10)}.json` });
    link.click();
    status('Exported (model keys are never included)');
  };
  const doImport = async () => {
    const picked = file.files?.[0];
    if (!picked)
      return status('Choose a file first', true);

    const parsed = parseLocalData(await picked.text());
    if (parsed.ok === false)
      return status(`Import failed: ${parsed.error}`, true);

    await save(parsed.data, 'Imported');
    out.textContent = parsed.dropped.length > 0 ? `Ignored secret fields: ${parsed.dropped.join(', ')}` : 'No secret fields found';
  };
  const doServer = async () => {
    const result = await importFromServer(localStore, await syncBaseOf(), await getSyncKey(), fetch, true);
    data = await localStore.loadOrEmpty();
    status(result.reason, result.done === false);
  };

  return el('div', { className: 'card' },
    el('div', { className: 'tools' }, el('button', { className: 'btn', textContent: 'Export to file', onclick: doExport })),
    el('div', { className: 'tools' }, file, el('button', { className: 'btn ghost', textContent: 'Import file', onclick: () => void doImport() })),
    el('div', { className: 'tools' }, el('button', { className: 'btn ghost', textContent: 'Re-import from server', onclick: () => void doServer() })),
    el('div', { className: 'dim', textContent: 'File format: cursor-chrome/local-data v1. API keys, tokens and model chain are never exported and are ignored on import.' }),
    out);
}

async function syncBaseOf(): Promise<string> {
  try {
    const url = new URL((await getSyncUrl()).trim());

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}

const storageArea = {
  get: (keys: string | string[]) => browser.storage.local.get(keys) as Promise<Record<string, unknown>>,
  set: (items: Record<string, unknown>) => browser.storage.local.set(items),
};

async function serverBase(): Promise<string> {
  try {
    const url = new URL((await getSyncUrl()).trim());

    return `${url.protocol}//${url.host}`;
  }
  catch {
    return '';
  }
}

// Outdated-version banner: the flag comes from the server's response headers (x-ext-outdated / 426).
async function drawUpdate(): Promise<void> {
  document.getElementById('update')!.innerHTML = bannerHtml(await updateFlag(storageArea), await serverBase());
  void watchUpdating(document.getElementById('updating'), await serverBase(), () => location.reload());
}

// BYOK: own LLM key, encrypted (WebCrypto AES-GCM) in chrome.storage.local, sent only as x-llm-key.
async function enableCoach(): Promise<boolean> {
  const origins = ['https://console.x.ai/*'];
  // host access is already covered by the required <all_urls> (page control on any tab), so no permission prompt
  if (await chrome.permissions.contains({ origins }) === false)
    return false;

  const have = await chrome.scripting.getRegisteredContentScripts({ ids: ['xai-coach'] });
  if (have.length === 0)
    await chrome.scripting.registerContentScripts([{ id: 'xai-coach', matches: origins, js: ['coach.js'], runAt: 'document_idle', persistAcrossSessions: true }]);

  return true;
}

// NoJobNoProblemBuddy key wizard: get an xAI Grok key, paste on click, test via our server, save encrypted.
function keyWizard(onSaved: () => Promise<void>): HTMLElement {
  let key = '';
  const card = el('div', { className: 'card wizard' });
  const masked = el('input', { className: 'masked', readOnly: true, placeholder: 'ключ появится здесь (замаскирован)' });
  const result = el('div', { className: 'result dim', textContent: '' });
  const show = (text: string, kind: '' | 'ok' | 'fail' = '') => { result.textContent = text; result.className = `result ${kind || 'dim'}`; };
  const testBtn = el('button', { className: 'btn', textContent: 'Проверить', disabled: true });
  const saveBtn = el('button', { className: 'btn', textContent: 'Сохранить', disabled: true });
  // coach overlay on console.x.ai: registered on this click only (host access comes from <all_urls>)
  const getBtn = el('button', { className: 'btn', textContent: 'Получить ключ Grok', onclick: async () => {
    const coach = await enableCoach().catch(() => false);
    window.open(XAI_KEYS_URL, '_blank', 'noopener');
    show(coach ? 'подсказки включены: следуй рамке на странице xAI' : 'подсказки поверх консоли выключены: шаги ниже', '');
  } });
  const pasteBtn = el('button', { className: 'btn ghost', textContent: 'Вставить из буфера', onclick: async () => {
    const got = await readClipboardKey();
    key = got.key;
    masked.value = key ? maskKey(key) : '';
    testBtn.disabled = !key;
    saveBtn.disabled = true;
    show(got.error || 'формат ок: xai-…, проверь ключ', got.error ? 'fail' : '');
  } });
  testBtn.onclick = async () => {
    if (!validXaiKey(key))
      return;
    show('проверяю…');
    const check = await testKey(await serverBase(), await getSyncKey(), key);
    show(check.message, check.ok ? 'ok' : 'fail');
    saveBtn.disabled = check.ok === false && check.code !== 'key-no-credits';
  };
  saveBtn.onclick = async () => {
    await saveByok(storageArea, idbKeyStore(), 'xai', key);
    key = '';
    masked.value = '';
    testBtn.disabled = true;
    saveBtn.disabled = true;
    show('ключ сохранён (AES-GCM, только в этом браузере)', 'ok');
    await onSaved();
  };
  card.append(
    el('b', { textContent: 'NoJobNoProblemBuddy · ключ xAI Grok' }),
    el('div', { className: 'tools' }, getBtn, el('span', { className: 'dim', textContent: XAI_KEYS_URL })),
    el('ol', { className: 'steps' }, ...STEPS.map(step => el('li', { textContent: step }))),
    el('div', { className: 'tools' }, pasteBtn, masked, testBtn, saveBtn),
    result,
  );

  return card;
}

function llmTab(): HTMLElement {
  const wrap = el('div');
  const box = el('div', { className: 'card' });
  const select = el('select', {}, ...PRESETS.map(item => el('option', { value: item.id, textContent: item.name })));
  const input = el('input', { type: 'password', placeholder: 'API key (stays encrypted in this browser)', autocomplete: 'off' });
  const info = el('div', { className: 'dim' });
  const refresh = async () => {
    const now = await byokInfo(storageArea);
    info.textContent = now.on ? `Own key on: ${now.provider} ••••${now.tail}. Sent only in the x-llm-key header of /api/answer; the server keeps it for that request only.` : 'No own key: the server uses its own model key.';
    if (now.provider)
      select.value = now.provider;
  };
  const saveBtn = el('button', { className: 'btn', textContent: 'Save encrypted', onclick: async () => { await saveByok(storageArea, idbKeyStore(), select.value, input.value); input.value = ''; status('Key saved (encrypted)'); await refresh(); } });
  const clearBtn = el('button', { className: 'btn ghost', textContent: 'Remove key', onclick: async () => { await saveByok(storageArea, idbKeyStore(), '', ''); status('Key removed'); await refresh(); } });
  box.append(el('b', { textContent: 'Own LLM key (BYOK)' }), el('div', { className: 'tools' }, select, input, saveBtn, clearBtn), info);
  void refresh();
  wrap.append(keyWizard(refresh), box);

  return wrap;
}

async function main(): Promise<void> {
  void drawUpdate();
  browser.storage.onChanged.addListener(() => void drawUpdate());
  data = await localStore.loadOrEmpty();
  if (await localStore.initialized() === false) {
    const result = await importFromServer(localStore, await syncBaseOf(), await getSyncKey());
    if (result.done)
      data = await localStore.loadOrEmpty();
  }
  draw();
}

void main();
