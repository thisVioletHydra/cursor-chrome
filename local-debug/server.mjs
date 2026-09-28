import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4317);
const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const db = new DatabaseSync(join(root, 'session.sqlite'));

db.exec(`
  CREATE TABLE IF NOT EXISTS draft (
    id INTEGER PRIMARY KEY,
    json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )
`);

const readDraftStmt = db.prepare('SELECT json FROM draft WHERE id = 1');
const writeDraftStmt = db.prepare(`
  INSERT INTO draft (id, json, updated_at) VALUES (1, ?, ?)
  ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at
`);
const clearDraftStmt = db.prepare('DELETE FROM draft WHERE id = 1');
let draftFloor = 0;

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = await readFile(join(root, 'index.html'), 'utf8');
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(embedDraft(html));
    return;
  }

  if (req.method === 'POST' && req.url === '/api/check') {
    const body = await readJson(req);
    const result = await check(body);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/draft') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(readDraft()));
    return;
  }

  if (req.method === 'DELETE' && req.url === '/api/draft') {
    clearDraft();
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/draft') {
    const body = await readJson(req);
    if (body?.reset === true)
      clearDraft(Number(body.rev));
    else
      saveDraft(body);
    res.writeHead(204);
    res.end();
    return;
  }

  res.writeHead(404);
  res.end('нет');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`);
});

function embedDraft(html) {
  const json = JSON.stringify(readDraft()).replaceAll('<', '\\u003c');
  const tag = `<script id="draft" type="application/json">${json}</script>`;
  return html.replace('  </head>', `    ${tag}\n  </head>`);
}

function readDraft() {
  const row = readDraftStmt.get();
  if (!row)
    return draftPayload({});

  try {
    const data = JSON.parse(row.json);
    return draftPayload(data && typeof data === 'object' ? data : {});
  }
  catch {
    return draftPayload({});
  }
}

function saveDraft(body) {
  const rev = Number(body?.rev);
  if (Number.isFinite(rev) && rev <= draftFloor)
    return;

  if (Number.isFinite(rev))
    draftFloor = rev;

  writeDraftStmt.run(JSON.stringify(draftPayload(body)), Date.now());
}

function clearDraft(rev) {
  if (Number.isFinite(rev))
    draftFloor = Math.max(draftFloor, rev);
  else
    draftFloor = Math.max(draftFloor, Date.now());

  clearDraftStmt.run();
}

function draftPayload(body) {
  const source = body && typeof body === 'object' ? body : {};
  const incoming = source.drafts && typeof source.drafts === 'object' ? source.drafts : {};
  const drafts = {};

  for (const [id, item] of Object.entries(incoming)) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 64)
      continue;
    if (item === null || typeof item !== 'object')
      continue;
    drafts[id] = {
      key: typeof item.key === 'string' ? item.key : '',
      model: typeof item.model === 'string' ? item.model : '',
    };
  }

  return {
    tab: source.tab === 'models' ? 'models' : 'link',
    chip: typeof source.chip === 'string' ? source.chip : 'groq',
    token: typeof source.token === 'string' ? source.token : '',
    resume: typeof source.resume === 'string' ? source.resume : '',
    drafts,
    passes: cleanPasses(source.passes),
  };
}

function cleanDetail(value) {
  if (typeof value !== 'string')
    return '';
  return value.trim().slice(0, 160);
}

function cleanPasses(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const incoming = source.models && typeof source.models === 'object' ? source.models : {};
  const models = {};

  for (const [id, detail] of Object.entries(incoming)) {
    if (typeof id !== 'string' || /^[A-Za-z0-9._:/-]{1,80}$/.test(id) === false)
      continue;
    const text = cleanDetail(detail);
    if (text.length === 0)
      continue;
    models[id] = text;
  }

  return {
    telegram: cleanDetail(source.telegram),
    resume: cleanDetail(source.resume),
    models,
  };
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req)
    chunks.push(chunk);

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  catch {
    return {};
  }
}

async function check(body) {
  if (body.what === 'telegram')
    return telegram(String(body.token || ''));

  if (body.what === 'list')
    return listModels(body);

  if (body.what === 'model')
    return modelCheck(body);

  if (body.what === 'gemini') {
    return modelCheck({
      url: geminiUrl,
      key: body.key,
      model: body.model,
      name: 'Gemini',
    });
  }

  return { ok: false, detail: 'не тот тест' };
}

async function telegram(token) {
  if (/^\d+:[A-Za-z0-9_-]{20,}$/.test(token) === false)
    return { ok: false, detail: 'это не токен бота' };

  const res = await fetch(`https://api.telegram.org/bot${token}/getMe`).catch(() => null);
  if (res === null)
    return { ok: false, detail: 'telegram не ответил' };

  if (res.ok === false)
    return { ok: false, detail: `telegram ${res.status}` };

  const data = await res.json();
  const name = data.result?.username || 'бот';

  return { ok: true, detail: `@${name}` };
}

function apiKey(value) {
  return String(value || '').trim();
}

async function modelCheck(body) {
  const key = apiKey(body.key);
  const model = String(body.model || '');
  const url = String(body.url || '');
  const name = String(body.name || 'модель').slice(0, 40);

  if (key.length < 8)
    return { ok: false, detail: 'ключ короткий' };

  if (model.length === 0)
    return { ok: false, detail: 'нет имени модели' };

  if (/^https:\/\//.test(url) === false)
    return { ok: false, detail: 'кривой адрес' };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ok' }],
    }),
  }).catch(() => null);
  if (res === null)
    return { ok: false, detail: `${name} не ответил` };

  if (res.status === 404)
    return { ok: false, missing: true, detail: `модель ${model} не найдена` };

  if (res.status === 401 || res.status === 403)
    return { ok: false, detail: 'ключ не принят' };

  if (res.status === 402)
    return { ok: false, detail: 'ключ принят, нужна оплата' };

  if (res.ok === false)
    return { ok: false, detail: `${name} ${res.status}` };

  return { ok: true, detail: model };
}

async function listModels(body) {
  const key = apiKey(body.key);
  const url = String(body.url || '');
  const name = String(body.name || 'модель').slice(0, 40);

  if (key.length < 8)
    return { ok: false, detail: 'ключ короткий', models: [] };

  if (/^https:\/\//.test(url) === false)
    return { ok: false, detail: 'кривой адрес', models: [] };

  const headers = { authorization: `Bearer ${key}` };
  const preferFree = url.includes('openrouter.ai');
  const primary = modelsEndpoint(url);
  let result = await pullModels(primary, headers, name, preferFree);
  const originModels = originModelsEndpoint(url);

  if (result.ok === false && result.detail === `${name} 404` && originModels !== primary)
    result = await pullModels(originModels, headers, name, preferFree);

  if (result.ok || url.includes('generativelanguage.googleapis.com') === false)
    return result;

  if (result.detail === 'ключ не принят')
    return result;

  return pullModels(
    'https://generativelanguage.googleapis.com/v1beta/models?pageSize=100',
    { 'x-goog-api-key': key },
    name,
    false,
  );
}

function modelsEndpoint(url) {
  const base = url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  return `${base}/models`;
}

function originModelsEndpoint(url) {
  return `${new URL(url).origin}/openai/v1/models`;
}

async function pullModels(target, headers, name, preferFree) {
  const ids = [];
  let page = target;

  for (let i = 0; i < 3 && page; i++) {
    const res = await fetch(page, { headers }).catch(() => null);
    if (res === null)
      return { ok: false, detail: `${name} не ответил`, models: [] };

    if (res.status === 401 || res.status === 403)
      return { ok: false, detail: 'ключ не принят', models: [] };

    if (res.ok === false) {
      const models = uniqueChat(ids);
      if (models.length > 0)
        return packModels(models, preferFree);
      return { ok: false, detail: `${name} ${res.status}`, models: [] };
    }

    const data = await res.json().catch(() => null);
    for (const id of rawModelIds(data))
      ids.push(id);

    const token = typeof data?.nextPageToken === 'string' ? data.nextPageToken : '';
    page = token.length > 0 ? pageUrl(target, token) : '';
  }

  const models = uniqueChat(ids);
  if (models.length === 0)
    return { ok: false, detail: 'в списке нет chat-модели', models: [] };

  return packModels(models, preferFree);
}

function pageUrl(target, token) {
  const next = new URL(target);
  next.searchParams.set('pageToken', token);
  return next.toString();
}

function rawModelIds(data) {
  const ids = [];

  if (Array.isArray(data?.data)) {
    for (const item of data.data) {
      const id = typeof item?.id === 'string' ? item.id.replace(/^models\//, '') : '';
      if (id.length > 0)
        ids.push(id);
    }
    return ids;
  }

  if (Array.isArray(data?.models) === false)
    return ids;

  for (const item of data.models) {
    const methods = Array.isArray(item?.supportedGenerationMethods) ? item.supportedGenerationMethods : null;
    if (methods && methods.includes('generateContent') === false)
      continue;
    const id = typeof item?.name === 'string' ? item.name.replace(/^models\//, '') : '';
    if (id.length > 0)
      ids.push(id);
  }

  return ids;
}

function uniqueChat(ids) {
  const seen = new Set();
  const models = [];

  for (const id of ids) {
    if (id.length > 120 || isChatModel(id) === false || seen.has(id))
      continue;
    seen.add(id);
    models.push(id);
  }

  return models;
}

function isChatModel(id) {
  const name = id.toLowerCase();
  if (/-batch(?:$|:)/.test(name) || name.includes('vision-only'))
    return false;
  return /(?:^|[^a-z])(?:router|embed(?:ding)?s?|whisper|tts|audio|images?|guard|moderation)(?:[^a-z]|$)/.test(name) === false;
}

function packModels(models, preferFree) {
  const picked = pickAuto(models, preferFree === true);
  return { ok: true, models: chipList(models, picked?.id), picked };
}

function chipList(models, pickedId) {
  const chips = [];
  const seen = new Set();

  if (typeof pickedId === 'string' && models.includes(pickedId)) {
    chips.push(pickedId);
    seen.add(pickedId);
  }

  for (const id of models) {
    if (seen.has(id))
      continue;
    chips.push(id);
    if (chips.length >= 40)
      break;
  }

  return chips;
}

function pickAuto(models, preferFree) {
  const safe = models.filter(id => autoBanned(id) === false && tinyModel(id) === false);
  const fast = safe.find(id => fastMid(id));
  const mid = fast || safe.find(id => steadyMid(id));
  const id = mid || safe[0];
  if (typeof id !== 'string')
    return null;

  const chosen = preferFree ? freeTwin(id, models) : id;
  return { id: chosen, why: 'дешевле топа' };
}

function autoBanned(id) {
  const name = id.toLowerCase();
  if (/(?:^|[^a-z])(?:fable|opus|ultra)(?:[^a-z]|$)/.test(name))
    return true;
  if (/reasoner|thinking|pro-max/.test(name))
    return true;
  if (/(?:^|[^a-z0-9])r1(?:[^a-z0-9]|$)/.test(name))
    return true;
  return /(?:^|[^0-9])(?:405|480)b(?:[^a-z0-9]|$)/.test(name);
}

function tinyModel(id) {
  return /(?:^|[^0-9.])(?:0\.5|[13])b(?:[^a-z0-9]|$)/i.test(id);
}

function fastMid(id) {
  return /(?:^|[^a-z])(?:sonnet|haiku|flash|instant|mini|turbo)(?:[^a-z]|$)|gpt-oss/i.test(id);
}

function steadyMid(id) {
  return /qwen|llama|gpt-oss|command/i.test(id);
}

function freeTwin(id, models) {
  if (/:free$/i.test(id))
    return id;

  const exact = models.find(item => item.toLowerCase() === `${id.toLowerCase()}:free`);
  if (exact && autoBanned(exact) === false && tinyModel(exact) === false)
    return exact;

  const family = familyOf(id);
  const sibling = models.find(item => {
    return /:free$/i.test(item)
      && familyOf(item) === family
      && autoBanned(item) === false
      && tinyModel(item) === false;
  });

  return sibling || id;
}

function familyOf(id) {
  const bare = id.replace(/:free$/i, '').toLowerCase();
  const tags = ['gpt-oss', 'sonnet', 'haiku', 'qwen', 'llama', 'gemini', 'glm', 'deepseek', 'command', 'gpt', 'claude'];
  for (const tag of tags) {
    if (bare.includes(tag))
      return tag;
  }

  const slash = bare.indexOf('/');
  return slash === -1 ? bare : bare.slice(0, slash);
}
