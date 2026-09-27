import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4317);
const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

const server = createServer(async (req, res) => {
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = await readFile(join(root, 'index.html'));
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  if (req.method === 'POST' && req.url === '/api/check') {
    const body = await readJson(req);
    const result = await check(body);
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
    return;
  }

  res.writeHead(404);
  res.end('нет');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`http://127.0.0.1:${port}`);
});

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

  if (body.what === 'gemini')
    return gemini(String(body.key || ''), String(body.model || ''));

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

async function gemini(key, model) {
  if (key.length < 20)
    return { ok: false, detail: 'ключ короткий' };

  if (model.length === 0)
    return { ok: false, detail: 'нет имени модели' };

  const res = await fetch(geminiUrl, {
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
    return { ok: false, detail: 'gemini не ответил' };

  if (res.status === 404)
    return { ok: false, detail: `модель ${model} не найдена` };

  if (res.status === 401 || res.status === 403)
    return { ok: false, detail: 'ключ не принят' };

  if (res.ok === false)
    return { ok: false, detail: `gemini ${res.status}` };

  return { ok: true, detail: model };
}
