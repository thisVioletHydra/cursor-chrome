import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(path.join(tmpdir(), 'relook-'));
process.env.HH_STORE = path.join(dir, 'hh.sqlite');

test('relook opens a canned hide and leaves a real skip', async () => {
  const db = await import('./src/diary/seen-db.ts');
  await db.openStore();
  db.savePassed([
    { id: '137776562', reason: 'скрыл, уже видели', company: 'ТОО Freedom Soft', title: 'Front-end TypeScript разработчик' },
    { id: '2', reason: 'стоп-слово «php»', company: 'X', title: 'PHP разработчик' },
    { id: '3', reason: 'скрыл, уже видели', company: 'Уже', title: 'В очереди' },
  ]);
  await db.insertSeen(['137776562', '3'], Date.now());
  const claimed = db.claimRelook(['3'], 8);
  assert.deepEqual(claimed.map(row => row.id), ['137776562']);
  assert.deepEqual(await db.lookupSeen(['137776562', '3']), ['3']);
  assert.deepEqual(db.claimRelook([], 8).map(row => row.id), []);
  const again = db.claimRelook([], 8, Date.now() + 21 * 60 * 1000);
  assert.equal(again[0]?.id, '137776562');
  db.forgetPassed(['137776562']);
  db.savePassed([{ id: '9', reason: 'скрыл, уже видели', company: '', title: '' }]);
  assert.equal(db.listPassed().some(row => row.id === '9'), false);
  assert.equal(db.listPassed().some(row => row.reason === 'стоп-слово «php»'), true);
  assert.equal(db.countPassed(), 1);
  db.savePassed([{ id: '11', reason: 'вопросы работодателя', company: 'Фирма', title: 'Frontend' }]);
  db.savePassed([{ id: '11', reason: 'протухло', company: 'Фирма', title: 'Frontend' }]);
  assert.equal(db.listPassed().find(item => item.id === '11')?.reason, 'протухло');
});

test.after(() => {
  rmSync(dir, { recursive: true, force: true });
});
