import { answerProblem, markHuman } from './src/lib/server/plan/form.ts';
import { handleConfig } from './src/lib/server/thin/ext-cmd-api.ts';
import { parseTransit } from './src/lib/server/thin/plan-context.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import test from 'node:test';

const req = () => new Request('https://x.test/api/ext/config', { headers: { authorization: 'Bearer t' } });

test('config: no admin settings → settings: null, serverPlanner as its own field', async () => {
  const empty = await (await handleConfig(req(), async () => 'roman', () => null, () => ({ serverPlanner: true }))).json();
  assert.equal(empty.settings, null);
  assert.equal(empty.serverPlanner, true);
  const set = await (await handleConfig(req(), async () => 'roman', () => ({ showPop: false }), () => ({ serverPlanner: false }))).json();
  assert.deepEqual(set.settings, { showPop: false });
  assert.equal(set.serverPlanner, false);
});

test('answers: human: true on empty required and on a choice with no matching option', () => {
  const fields = [{ id: 'a', label: 'Город', kind: 'text', required: true, options: [] }, { id: 'b', label: 'Опыт', kind: 'choice', options: ['да', 'нет'] }, { id: 'c', label: 'Ок', kind: 'text', options: [] }];
  const out = markHuman(fields, [{ id: 'b', answer: 'может' }, { id: 'c', answer: 'ок' }]);
  assert.equal(out.find(a => a.id === 'a').human, true);
  assert.equal(out.find(a => a.id === 'b').human, true);
  assert.equal(out.find(a => a.id === 'c').human, undefined);
  assert.match(answerProblem(fields, out), /обязательное поле: Город/);
});

test('transit context: limits enforced, unknown junk dropped', () => {
  assert.equal(parseTransit('{}').ok, false);
  assert.equal(parseTransit(JSON.stringify({ context: { canon: Array.from({ length: 301 }, () => ({})) } })).ok, false);
  const ok = parseTransit(JSON.stringify({ context: { letter: 'L', canon: [{ title: 't', answer: 'a', junk: 1 }], memory: [{ prompt: 'p', answer: 'a', human: true }] } }));
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.context.canon, [{ title: 't', aliases: [], answer: 'a' }]);
});

test('admin save updates only fields present in the form; review keeps first-login redirect', async () => {
  const src = await fsPromises.readFile(new URL('./src/lib/server/admin-actions.ts', import.meta.url), 'utf8');
  assert.match(src, /form\.getAll\('present'\)/);
  assert.match(src, /if \(present\.has\('serverPlanner'\)\)/);
  const page = await fsPromises.readFile(new URL('./src/routes/admin/extension/+page.svelte', import.meta.url), 'utf8');
  assert.equal((page.match(/name="present"/g) || []).length, 3);
  const review = await fsPromises.readFile(new URL('./src/routes/admin/review/+page.server.ts', import.meta.url), 'utf8');
  assert.match(review, /redirect\(303, '\/admin\/profile\?first=1'\)/);
  const deps = await fsPromises.readFile(new URL('./src/lib/server/thin/plan-deps.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(deps, /coverLetter: login => inTenant|account\.coverLetter|listMemory|listCanon/);
});
