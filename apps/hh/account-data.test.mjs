import { applyAccount, loadOwnerAccount } from './src/model/account.ts';
import { answerPrompt, hintLines } from './src/model/answer.ts';
import * as copy from './src/model/copy.ts';
import { plan, run } from '../../local-debug/migrate-account-data.mjs';
import { leaks, personalValues } from './personal-guard.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import test from 'node:test';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const question = { context: '', prompt: 'Ваши зарплатные ожидания?', kind: 'number', options: [] };
const PROFILE = { version: 1, savedAt: 1, custom: [], fields: { salary: { mode: 'fixed', value: 'по договорённости' }, salaryNumber: { mode: 'fixed', value: '123000' }, contacts: { mode: 'fixed', value: 'Telegram @someone' } } };

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'acct-'));
}

const OWNER = personalValues();

test('answer.ts and copy.ts carry no values from the local account', { skip: !OWNER && 'нет локального файла аккаунта' }, () => {
  for (const file of ['./src/model/answer.ts', './src/model/copy.ts'])
    assert.deepEqual(leaks(read(file), OWNER), [], file);
});

test('answer.ts and copy.ts defaults are empty', () => {
  applyAccount(null);
  assert.equal(copy.COVER_LETTER, '');
  assert.deepEqual(copy.ANSWER_HINTS, { salary: '', salaryNumber: '', contacts: '' });
  const prompt = answerPrompt(question);
  assert.match(prompt, /Зарплату не придумывай/);
  assert.match(prompt, /Контакты не выдумывай/);
});

test('answer hints come from the account profile', () => {
  applyAccount({ profile: JSON.stringify(PROFILE), facts: JSON.stringify({ rules: ['Правило X'] }), coverLetter: 'Письмо' });
  try {
    assert.deepEqual(hintLines(), ['Зарплата: «по договорённости». Если поле числовое — 123000.', 'Связь: Telegram @someone. Телефон и почту не пиши.']);
    assert.match(answerPrompt(question), /Правило X/);
    assert.equal(copy.COVER_LETTER, 'Письмо');
  }
  finally {
    applyAccount(null);
  }
});

test('scan CLI loads the owner account the same way the server does', async () => {
  const dir = tmpDir();
  const file = path.join(dir, 'owner.json');
  fs.writeFileSync(file, JSON.stringify({ facts: JSON.stringify({ rules: ['Город: Тест.'] }), profile: JSON.stringify(PROFILE), coverLetter: 'CL' }));
  const loaded = await loadOwnerAccount(file);
  try {
    assert.equal(loaded.found, true);
    assert.equal(copy.FACTS, 'Город: Тест.');
    assert.equal(copy.COVER_LETTER, 'CL');
    assert.equal(copy.ANSWER_HINTS.contacts, 'Telegram @someone');
  }
  finally {
    applyAccount(null);
  }
  const missing = await loadOwnerAccount(path.join(dir, 'nope.json'));
  assert.equal(missing.found, false);
  assert.equal(copy.FACTS, '');
  process.env.HH_ACCOUNTS_DIR = dir;
  process.env.HH_OWNER = 'owner';
  try {
    assert.equal((await import('./src/model/account.ts')).ownerAccountFile(), file);
  }
  finally {
    delete process.env.HH_ACCOUNTS_DIR;
    delete process.env.HH_OWNER;
  }
  const cli = read('./src/cli/cli.ts');
  assert.match(cli, /await loadOwnerAccount\(\)/);
  assert.match(read('../web/src/lib/server/secrets.ts'), /applyAccount\(saved\)/);
});

test('migration: dry-run writes nothing, --apply fills empty fields with a backup, second run is a no-op', () => {
  const dir = tmpDir();
  const source = path.join(dir, 'source.json');
  const target = path.join(dir, 'target.json');
  fs.writeFileSync(source, JSON.stringify({ facts: JSON.stringify({ rules: ['секретный факт'] }), canonSeed: JSON.stringify({ key: 'k', items: [{ title: 't', answer: 'a', aliases: [] }] }), profile: JSON.stringify(PROFILE), coverLetter: 'письмо', modelChain: 'КЛЮЧ' }));
  fs.writeFileSync(target, JSON.stringify({ modelChain: 'свой', coverLetter: '', profile: JSON.stringify({ version: 1, savedAt: 5, custom: [], fields: { city: { mode: 'fixed', value: 'X' }, salary: { mode: 'fixed', value: 'своё' } } }) }));
  const before = fs.readFileSync(target, 'utf8');
  const lines = [];
  assert.equal(run(['--source', source, '--target', target], line => lines.push(line)), 0);
  assert.equal(fs.readFileSync(target, 'utf8'), before, 'dry-run does not write');
  assert.ok(lines.join('\n').includes('DRY-RUN'));
  assert.equal(/секретный факт|письмо|КЛЮЧ|123000|someone/.test(lines.join('\n')), false, 'no values printed');

  lines.length = 0;
  assert.equal(run(['--source', source, '--target', target, '--apply'], line => lines.push(line)), 0);
  const after = JSON.parse(fs.readFileSync(target, 'utf8'));
  assert.equal(after.modelChain, 'свой', 'secrets/other fields untouched');
  assert.equal(after.coverLetter, 'письмо');
  assert.equal(JSON.parse(after.facts).rules[0], 'секретный факт');
  const profile = JSON.parse(after.profile);
  assert.equal(profile.fields.salary.value, 'своё', 'existing target keys win');
  assert.equal(profile.fields.contacts.value, 'Telegram @someone');
  assert.equal(profile.fields.city.value, 'X');
  assert.equal(fs.readdirSync(dir).filter(name => name.includes('.bak-')).length, 1);
  assert.equal(/секретный факт|письмо|КЛЮЧ/.test(lines.join('\n')), false);

  const snapshot = fs.readFileSync(target, 'utf8');
  lines.length = 0;
  assert.equal(run(['--source', source, '--target', target, '--apply'], line => lines.push(line)), 0);
  assert.equal(fs.readFileSync(target, 'utf8'), snapshot, 'idempotent');
  assert.ok(lines.join('\n').includes('изменений нет'));
  assert.equal(fs.readdirSync(dir).filter(name => name.includes('.bak-')).length, 1, 'no extra backup');
  assert.equal(plan({}, {}).changes.every(change => change.action === 'skip'), true);
});
