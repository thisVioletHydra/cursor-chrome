import { runTenant } from './src/diary/tenant.ts';
import { listCanon, listEntries, listMemory, saveCanon, unlinkAnswer, unlinkedFor } from './src/review/memory.ts';
import { canWrite, isTenantDb, migrateOwner, ownerWhere } from './src/review/owner.ts';
import { rememberAnswers, reviewDb } from './src/review/store.ts';

import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const VASYA = 'vasya-pupkin';
const asVasya = job => runTenant(VASYA, job);

async function romanData() {
  process.env.HH_STORE = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), 'review-owner-')), 'hh.json');
  await rememberAnswers([{ key: 'k', prompt: 'Сколько лет опыта с Vue?', answer: '5 лет', origin: 'human' }]);
  const rule = await saveCanon({ title: 'Ссылка на GitHub', answer: 'https://github.com/roman', aliases: ['портфолио'] });
  await unlinkAnswer('Ваш GitHub?', `c:${rule.id}`);


}

for (const migrated of [false, true]) {
  test(`Vasya does not see the owner's memory and rules (${migrated ? 'after' : 'before'} owner migration)`, async () => {
    await romanData();
    const root = await reviewDb();
    if (migrated) {
      assert.deepEqual(migrateOwner(root, 'thisVioletHydra').map(r => r.assigned), [1, 1, 1]);
      assert.deepEqual(migrateOwner(root, 'thisVioletHydra').map(r => r.assigned), [0, 0, 0]);
    }
    assert.equal(isTenantDb(root), false);
    await asVasya(async () => {
      const own = await reviewDb();
      assert.notEqual(own, root);
      assert.equal(isTenantDb(own), true);
      assert.deepEqual(await listMemory(), []);
      assert.deepEqual(await listCanon(), []);
      assert.deepEqual(await listEntries(), []);
      assert.equal((await unlinkedFor('Ваш GitHub?')).size, 0);
      // Vasya's own writes work in his own DB and never touch the owner's rows
      await rememberAnswers([{ key: 'k', prompt: 'Сколько лет опыта с Vue?', answer: '1 год' }]);
      await saveCanon({ title: 'Ссылка на GitHub', answer: 'https://github.com/vasya', aliases: [] });
      assert.deepEqual((await listMemory()).map(r => r.answer), ['1 год']);
      assert.deepEqual((await listCanon()).map(r => r.answer), ['https://github.com/vasya']);
    });
    // shared root DB scoped by owner: a non-owner query returns nothing and may not write memory
    const scoped = ownerWhere(root, 'answer_memory', VASYA);
    assert.equal(root.prepare(`SELECT COUNT(*) AS n FROM answer_memory WHERE ${scoped.sql}`).get(...scoped.args).n, 0);
    assert.equal(canWrite(root, 'answer_memory', VASYA), false);
    assert.equal((await listMemory())[0].answer, '5 лет');
    assert.deepEqual((await listCanon()).map(r => r.answer), ['https://github.com/roman']);
    assert.equal((await unlinkedFor('Ваш GitHub?')).size, 1);
  });
}
