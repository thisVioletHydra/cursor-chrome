import { httpsOnly, isWire, nextAfterMs, pauseMs, serverLinkLoop, wakeableSleep, wakeServerLink } from './src/link/server-link.ts';
import { scrubHtml, fixtureName } from './src/local/fixture-scrub.ts';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const base = { base: async () => 'https://s.example', key: async () => 'k'.repeat(24) };

function rig(responses, over = {}) {
  const calls = [];
  const sleeps = [];
  const execs = [];
  let t = 0;
  const fetcher = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', auth: init.headers?.authorization, body: init.body });
    t += 2000;
    const next = responses.shift();
    if (next instanceof Error)
      throw next;

    return typeof next === 'function' ? next() : next ?? new Response(null, { status: 204 });
  };
  return { calls, sleeps, execs, deps: { ...base, gateOpen: async () => true, fetcher, sleep: async (ms) => { sleeps.push(ms); }, now: () => t, exec: async (cmd) => { execs.push(cmd);
    return { ok: true, result: { url: 'https://hh.ru/x', html: '<b>' } };
  }, ...over } };
}

test('loop: gate closed → no requests at all', async () => {
  const r = rig([], { gateOpen: async () => false });
  assert.equal(await serverLinkLoop(r.deps), 'closed');
  assert.equal(r.calls.length, 0);
});

test('loop: no key → nothing, 401 → stops and calls onUnauthorized', async () => {
  const none = rig([], { key: async () => '' });
  assert.equal(await serverLinkLoop(none.deps), 'closed');
  assert.equal(none.calls.length, 0);
  let told = 0;
  const r = rig([json({ error: 'нет' }, 401)], { onUnauthorized: () => { told += 1; } });
  assert.equal(await serverLinkLoop(r.deps), 'unauthorized');
  assert.equal(told, 1);
  assert.equal(r.calls.length, 1);
  assert.match(r.calls[0].auth, /^Bearer /);
});

test('loop: network errors back off 30 s, 1 min, 2 min…; success resets', async () => {
  const r = rig([new TypeError('x'), new TypeError('x'), new TypeError('x'), new Response(null, { status: 204 }), new TypeError('x')], { maxRounds: 5 });
  assert.equal(await serverLinkLoop(r.deps), 'rounds');
  assert.deepEqual(r.sleeps, [30_000, 60_000, 120_000, 30_000]);
});

test('loop: command → exec → report with the same id; nothing executed without a command', async () => {
  const cmd = { id: 'c1', kind: 'snapshot', params: { selector: 'form' }, deadline: 1 };
  const r = rig([new Response(null, { status: 204 }), json(cmd), json({ ok: true })], { maxRounds: 2 });
  await serverLinkLoop(r.deps);
  assert.equal(r.execs.length, 1);
  assert.equal(r.execs[0].id, 'c1');
  const report = r.calls.find(c => c.method === 'POST');
  assert.equal(report.url, 'https://s.example/api/ext/report');
  assert.deepEqual(JSON.parse(report.body), { id: 'c1', ok: true, result: { url: 'https://hh.ru/x', html: '<b>' } });
  assert.deepEqual(r.sleeps, [], 'held 204 → poll again at once, no extra sleep');
});

test('loop: gate closes while waiting → command refused, site untouched', async () => {
  let open = true;
  const r = rig([() => {
    open = false;

    return json({ id: 'c2', kind: 'click', params: { selector: '#a' } });
  }, json({ ok: true })], { gateOpen: async () => open, maxRounds: 2 });
  assert.equal(await serverLinkLoop(r.deps), 'closed');
  assert.equal(r.execs.length, 0);
  assert.equal(JSON.parse(r.calls[1].body).ok, false);
});

test('loop: planner idle/stop are pauses; quick 204 is backed off; old server 404 ends quietly', async () => {
  const r = rig([json({ type: 'idle', reason: 'чай', retryMs: 120_000 }), json({ type: 'stop', reason: 'капча', needsHuman: true })], { maxRounds: 2 });
  await serverLinkLoop(r.deps);
  assert.deepEqual(r.sleeps, [120_000, 900_000]);
  assert.equal(pauseMs({ type: 'idle', reason: '', retryMs: 10 * 3600_000 }), 900_000);
  const quick = rig([new Response(null, { status: 204 })], { maxRounds: 1, now: () => 0 });
  await serverLinkLoop(quick.deps);
  assert.deepEqual(quick.sleeps, [30_000]);
  const old = rig([new Response('', { status: 404 })]);
  assert.equal(await serverLinkLoop(old.deps), 'no-server');
});

test('primitives: navigate https only; wire check; executor maps all kinds', () => {
  assert.equal(httpsOnly('https://hh.ru/a'), 'https://hh.ru/a');
  assert.equal(httpsOnly('http://hh.ru/a'), null);
  assert.equal(httpsOnly('javascript:alert(1)'), null);
  assert.equal(isWire({ id: 'a', kind: 'rm -rf', params: {} }), false);
  const src = fs.readFileSync(new URL('./src/link/server-exec.ts', import.meta.url), 'utf8');
  for (const kind of ['navigate', 'click', 'type', 'select', 'press_key', 'read', 'snapshot', 'wait', 'hh_apply'])
    assert.match(src, new RegExp(`case '${kind}':`), kind);

  assert.match(src, /runHhApplyThin\(splitThinAnswers\(p\)\.resumeKind\)/);
  assert.match(src, /captcha: true/);
  assert.match(src, /detect: true/);
  const bg = fs.readFileSync(new URL('./src/background.ts', import.meta.url), 'utf8');
  assert.match(bg, /gateOpen: async \(\) => \(await linkPaused\(\)\) === false/);
});

test('thin hh_apply: no second «Откликнуться» click, no form → error', () => {
  const run = fs.readFileSync(new URL('./src/hh/apply-run.ts', import.meta.url), 'utf8');
  assert.match(run, /async \(\) => \(thin \? null : openStep\(\)\)/);
  assert.match(run, /if \(thin && await until\([^\n]*3000\) === false\)\n    return fail\(THIN_NO_FORM\);/);
  assert.match(fs.readFileSync(new URL('./src/content.ts', import.meta.url), 'utf8'), /runApply\(message\.resume === true, message\.thin === true, message\.resumeKind/);
});

test('fixture scrub: no emails, phones, input values, scripts, applicant name', () => {
  const html = '<div data-qa="mainmenu_applicantProfile"><span>Роман Иванов</span></div><script>window.token="abc"</script><input name="q" value="секрет"><p>mail me roman@mail.ru, +7 (999) 123-45-67</p><a href="/resume/0123456789abcdef0123456789">r</a><textarea>моё письмо</textarea>';
  const out = scrubHtml(html);
  for (const bad of ['Роман', 'abc', 'секрет', 'roman@mail.ru', '999', '0123456789abcdef', 'моё письмо'])
    assert.equal(out.includes(bad), false, bad);

  assert.match(fixtureName('https://hh.ru/vacancy/123?x=1', new Date('2026-10-15T00:00:00Z')), /^hh-vacancy-N-2026-10-15-00-00-00\.html$/);
});

test('loop: 204 + x-next-after → sleeps that long (cap 15 min), no 30 s backoff; popup wake cuts the sleep', async () => {
  const slept = [];
  let calls = 0;
  const end = await serverLinkLoop({
    base: async () => 'https://x.test',
    key: async () => 'k',
    gateOpen: async () => true,
    exec: async () => ({ ok: true, result: null }),
    fetcher: async () => { calls += 1;
      return new Response(null, { status: 204, headers: { 'x-next-after': '900000' } });
    },
    sleep: async (ms) => { slept.push(ms); },
    maxRounds: 3,
  });
  assert.equal(end, 'rounds');
  assert.equal(calls, 3);
  assert.deepEqual(slept, [900000, 900000, 900000]);
  assert.equal(nextAfterMs(new Response(null, { status: 204, headers: { 'x-next-after': '99999999' } })), 900000);
  assert.equal(nextAfterMs(new Response(null, { status: 204 })), null);
  const t0 = Date.now();
  const p = wakeableSleep(900000);
  setTimeout(wakeServerLink, 20);
  await p;
  assert.ok(Date.now() - t0 < 1000, 'woken early');
});
