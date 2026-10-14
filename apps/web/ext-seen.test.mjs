import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'extseen-'));
process.env.WEB_SECRETS = path.join(dir, 'secrets.json');
const { extSeenLamp, markExtSeen, readExtSeen, EXT_STALE_MS } = await import('./src/lib/server/ext-seen.ts');

test('D: lamp never / stale / ok', () => {
  const now = 10_000_000;
  assert.equal(extSeenLamp(0, now), 'never');
  assert.equal(extSeenLamp(now - EXT_STALE_MS - 1, now), 'stale');
  assert.equal(extSeenLamp(now - 1000, now), 'ok');
});

test('D: markExtSeen writes its own file, not accounts/*.json; throttled', async () => {
  assert.equal(await readExtSeen('bob'), 0);
  await markExtSeen('bob', 5000);
  assert.equal(await readExtSeen('bob'), 5000);
  await markExtSeen('bob', 6000);
  assert.equal(await readExtSeen('bob'), 5000);
  assert.equal(fs.existsSync(path.join(dir, 'accounts')), false);
  await markExtSeen('../x', 1);
});

test('D: wiring — hooks mark, /api/link answers 401 without token, admin shows lamp + download', () => {
  const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  assert.match(read('./src/hooks.server.ts'), /if \(ext !== null\)\n    void markExtSeen\(ext\);/);
  assert.match(read('./src/routes/api/link/+server.ts'), /status: login === null \? 401 : 200/);
  const page = read('./src/routes/admin/+page.svelte');
  assert.match(page, /Расширение не установлено/);
  assert.match(page, /Расширение не на связи/);
  assert.match(page, /Скачать расширение/);
  assert.match(read('./src/routes/admin/+layout.server.ts'), /extDownload: preview \|\| !account\.extToken \? '' : `\/dl\/\$\{signDl/);
});

test('До старта: warning next to «Скачать расширение» — do not delete the old extension', () => {
  const page = fs.readFileSync(new URL('./src/routes/admin/+page.svelte', import.meta.url), 'utf8');
  const at = page.indexOf('Скачать расширение');
  const warn = page.indexOf('Для обновления не удаляй старое расширение — данные хранятся в нём.');
  assert.ok(at > 0 && warn > at && warn - at < 400);
});
