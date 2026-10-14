// Fails on the dead old domain, foreign *.up.railway.app and localhost in extension/web sources and the built dist.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const here = path.dirname(new URL(import.meta.url).pathname);
const DEAD = ['f8', 'ad5'].join('');
const RAILWAY = /([a-z0-9-]+)\.up\.railway\.app/gi;
const OK_RAILWAY = 'nojobnoproblem';

function files(dir, skip = /node_modules|\.svelte-kit|build$/) {
  if (fs.existsSync(dir) === false)
    return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory())
      return skip.test(p) ? [] : files(p, skip);
    return /\.(ts|js|mjs|svelte|html|json|css)$/.test(e.name) ? [p] : [];
  });
}

function bad(text, { prod }) {
  const out = [];
  if (text.includes(DEAD))
    out.push(DEAD);
  for (const m of text.matchAll(RAILWAY)) {
    if (m[1].toLowerCase() !== OK_RAILWAY)
      out.push(m[0]);
  }
  if (prod) {
    // the only allowed loopback: local Cursor MCP bridge (WS_HOST '127.0.0.1', port 18765) on the user's own machine
    const rest = text.replaceAll('ws://127.0.0.1:18765', '').replaceAll('127.0.0.1:18765', '').replaceAll('"127.0.0.1"', '').replaceAll('\'127.0.0.1\'', '');
    if (/localhost/i.test(rest))
      out.push('localhost');
    if (rest.includes('127.0.0.1'))
      out.push('127.0.0.1');
  }
  return out;
}

test('sources of extension and web: no dead domain, no foreign *.up.railway.app', () => {
  const roots = [path.join(here, 'src'), path.join(here, '../web/src')];
  const hits = roots.flatMap(r => files(r)).flatMap(f => bad(fs.readFileSync(f, 'utf8'), { prod: false }).map(b => `${path.relative(here, f)}: ${b}`));
  assert.deepEqual(hits, []);
});

test('built extension dist: no dead domain, no foreign railway, no localhost', () => {
  const dist = path.join(here, 'dist');
  const list = files(dist);
  if (list.length === 0)
    return; // not built yet: the build script runs tests before tsdown
  const hits = list.flatMap(f => bad(fs.readFileSync(f, 'utf8'), { prod: true }).map(b => `${path.relative(here, f)}: ${b}`));
  assert.deepEqual(hits, []);
});

test('the checker itself catches bad strings', () => {
  assert.deepEqual(bad(`https://web-production-${DEAD}.up.railway.app`, { prod: false }).length > 0, true);
  assert.deepEqual(bad('https://x1.up.railway.app', { prod: false }), ['x1.up.railway.app']);
  assert.deepEqual(bad('https://nojobnoproblem.up.railway.app/admin', { prod: true }), []);
  assert.deepEqual(bad('http://localhost:5173', { prod: true }), ['localhost']);
  assert.deepEqual(bad("const WS_HOST = '127.0.0.1'; 'ws://127.0.0.1:18765'", { prod: true }), []);
});
