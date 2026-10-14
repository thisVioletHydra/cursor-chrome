import { EMPTY_FACTS, FACTS, factsText, notesText, parseFacts, PROFILE_NOTES, setAccountFacts } from './src/model/copy.ts';
import * as copy from './src/model/copy.ts';
import { draftPrompt } from './src/review/draft.ts';
import { leaks, personalValues } from './personal-guard.mjs';

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const q = prompt => ({ prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' });
const input = extra => ({ id: '1', title: 'Frontend', company: 'X', info: null, questions: [q('Опыт с Vue?')], formText: '', resume: '', ...extra });

test('code ships empty defaults only', () => {
  assert.equal(FACTS, '');
  assert.equal(PROFILE_NOTES, '');
  assert.deepEqual(EMPTY_FACTS, { rules: [], notes: '', resume: '' });
  const source = fs.readFileSync(new URL('./src/model/copy.ts', import.meta.url), 'utf8');
  assert.equal(/facts\.data|Город:|Telegram @/.test(source), false, 'no personal facts in copy.ts');
  const store = fs.readFileSync(new URL('./src/review/store.ts', import.meta.url), 'utf8');
  assert.equal(/CANON_SEED/.test(store), false, 'no portfolio links in store.ts');
});

const OWNER = personalValues();

test('copy.ts and store.ts carry no values from the local account', { skip: !OWNER && 'нет локального файла аккаунта' }, () => {
  for (const file of ['./src/model/copy.ts', './src/review/store.ts'])
    assert.deepEqual(leaks(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), OWNER), [], file);
});

test('facts come from account data into the draft prompt', () => {
  const facts = parseFacts(JSON.stringify({ rules: ['Город: Тестоград.', 'Стек: Vue.'], notes: 'заметка', resume: 'резюме' }));
  assert.equal(factsText(facts), 'Город: Тестоград.\nСтек: Vue.');
  assert.equal(notesText(facts), 'заметка\n\nрезюме');
  const prompt = draftPrompt(input({ facts }), [q('Опыт с Vue?')]);
  assert.match(prompt, /Город: Тестоград/);
  assert.match(prompt, /Факты и резюме кандидата:\nзаметка/);
});

test('empty account facts → no personal facts in the prompt, even if server-wide facts are set', () => {
  setAccountFacts(parseFacts({ rules: ['Город: Владелецград.'], notes: 'n', resume: '' }));
  try {
    assert.equal(copy.FACTS, 'Город: Владелецград.', 'live binding for server-wide callers');
    const prompt = draftPrompt(input({ facts: parseFacts('') }), [q('Опыт с Vue?')]);
    assert.equal(prompt.includes('Владелецград'), false, 'another user never sees the owner facts');
    assert.match(prompt, /Правил и фактов кандидата нет/);
  }
  finally {
    setAccountFacts(null);
  }
  assert.equal(copy.FACTS, '');
});

test('parseFacts tolerates junk', () => {
  assert.deepEqual(parseFacts('not json'), EMPTY_FACTS);
  assert.deepEqual(parseFacts({ rules: ['  a  ', '', 3], notes: 1 }).rules, ['a', '3']);
});
