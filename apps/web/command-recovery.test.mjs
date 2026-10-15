import test from 'node:test';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { commandJournal } from './src/lib/server/thin/command-journal.ts';
import { createBus } from './src/lib/server/thin/cmd-bus.ts';
import { idempotentExecutor } from '../extension/src/link/command-receipts.ts';
test('restart: picked click/type/hh_apply are lost, never re-sent; journal keeps only id/kind/status', async (t) => {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'cmd-recovery-'));
  t.after(() => fsPromises.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'commands.json');
  const journal = commandJournal(file);
  const one = createBus({ journal, log: () => {} });
  void one.enqueue('a', { kind: 'type', params: { selector: '#q', text: 'ЛИЧНЫЙ-ОТВЕТ', submit: true } });
  void one.enqueue('a', { kind: 'hh_apply', params: { vacancyId: '123', letter: 'ПИСЬМО', answers: { q: 'СЕКРЕТ' } } });
  const wire = await one.next('a', undefined, 0, 'tab-1');
  const disk = await fsPromises.readFile(file, 'utf8');
  for (const secret of ['ЛИЧНЫЙ-ОТВЕТ', 'ПИСЬМО', 'СЕКРЕТ', '#q', 'params', '123"'])
    assert.equal(disk.includes(secret), false, `journal must not hold ${secret}`);
  for (const row of JSON.parse(disk).rows)
    assert.deepEqual(Object.keys(row).sort(), ['at', 'id', 'kind', 'login', 'status']);
  // restart
  const two = createBus({ journal, log: () => {} });
  assert.equal(await two.next('a', undefined, 0, 'tab-1'), null, 'nothing re-sent after restart');
  assert.ok(two.journal().every(r => r.status === 'lost'));
  assert.deepEqual(two.report('a', { id: wire.id, ok: true, result: 1 }), { status: 'lost' });
  assert.equal(two.report('b', { id: wire.id, ok: true, result: 1 }).status, 'unknown', 'other account cannot report');
  // resolve the first in-memory waiter and cancel its timer
  one.report('a', { id: wire.id, ok: true, result: 1 });
});
test('v1 journal with params is converted to lost rows and rewritten without params', async (t) => {
  const dir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'cmd-recovery-'));
  t.after(() => fsPromises.rm(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'commands.json');
  await fsPromises.writeFile(file, JSON.stringify({ version: 1, pending: [{ login: 'a', wire: { id: 'w1', kind: 'type', params: { selector: '#x', text: 'ТАЙНА' }, deadline: 1 }, queuedAt: Date.now(), execMs: 1000 }], completed: [{ login: 'a', id: 'w0', at: Date.now() }] }));
  const bus = createBus({ journal: commandJournal(file), log: () => {} });
  assert.equal((await fsPromises.readFile(file, 'utf8')).includes('ТАЙНА'), false);
  assert.deepEqual(bus.report('a', { id: 'w1', ok: true }), { status: 'lost' });
  assert.deepEqual(bus.report('a', { id: 'w0', ok: true }), { status: 'ok' });
});
test('worker crash receipt refuses ambiguous operation, expiry and token scope are enforced', async () => {
  const area={data:{},async get(k){return {[k]:structuredClone(this.data[k])}},async set(p){Object.assign(this.data,structuredClone(p))}};
  let calls=0;
  const exec=async()=>({ok:true,result:++calls});
  const wire={id:'id',kind:'click',params:{selector:'#send'},deadline:2000};
  const run=idempotentExecutor(area,async()=>'a',exec,()=>1000);
  await Promise.all([run(wire),run(wire)]);assert.equal(calls,1);
  for(const receipts of Object.values(area.data)) delete receipts[0].outcome;
  assert.equal((await idempotentExecutor(area,async()=>'a',exec,()=>1000)(wire)).ok,false);
  assert.equal((await idempotentExecutor(area,async()=>'b',exec,()=>3000)(wire)).ok,false);
  assert.equal(calls,1);
});
