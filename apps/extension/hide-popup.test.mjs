import { HIDE_CLOSE_MS, HIDE_LOOK_MS, HIDE_POLL_MS, HIDE_POPUP_STUCK, hideClickOk, hideFaceOf, hideStart, stepHide } from './src/search/hide-popup.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

function face(patch = {}) {
  return {
    menuVacancy: false,
    menuEmployer: false,
    dialog: false,
    wrong: false,
    ask: false,
    submit: false,
    ...patch,
  };
}

test('a hide popup is polled briefly', () => {
  assert.equal(HIDE_LOOK_MS, 700);
  assert.equal(HIDE_CLOSE_MS, 1_200);
  assert.equal(HIDE_POLL_MS, 40);
  assert.equal(HIDE_LOOK_MS < 3_000, true);
  assert.equal(HIDE_CLOSE_MS < 3_000, true);
  assert.equal(HIDE_POPUP_STUCK, 'попап скрытия не закрылся');
});

test('nothing after the eye click finishes the card', () => {
  const waiting = stepHide(hideStart(), face(), false);
  assert.equal(waiting.step.phase, 'look');
  assert.equal(waiting.action, null);
  const done = stepHide(waiting.step, face(), true);
  assert.equal(done.step.phase, 'done');
  assert.equal(done.action, null);
});

test('the menu hides this vacancy and never the company', () => {
  const both = stepHide(hideStart(), face({ menuVacancy: true, menuEmployer: true }), false);
  assert.equal(both.action, 'vacancy');
  assert.equal(both.step.phase, 'after-menu');
  const company = stepHide(hideStart(), face({ menuEmployer: true }), true);
  assert.equal(company.action, null);
  assert.equal(company.step.phase, 'retry');
});

test('the reason dialog is wrong profession, then do not ask, then submit', () => {
  const open = stepHide(hideStart(), face({ dialog: true, submit: true }), false);
  assert.equal(open.action, null);
  assert.equal(open.step.phase, 'form');
  const wrong = stepHide(open.step, face({ dialog: true, submit: true }), false);
  assert.equal(wrong.action, 'wrong');
  const ask = stepHide(wrong.step, face({ dialog: true, submit: true }), false);
  assert.equal(ask.action, 'ask');
  const submit = stepHide(ask.step, face({ dialog: true, wrong: true, ask: true, submit: true }), false);
  assert.equal(submit.action, 'submit');
  assert.equal(submit.step.phase, 'close');
  const clear = stepHide(submit.step, face(), false);
  assert.equal(clear.step.phase, 'done');
});

test('submit stays put until the reason button is enabled', () => {
  let step = stepHide(hideStart(), face({ dialog: true }), false).step;
  step = stepHide(step, face({ dialog: true }), false).step;
  step = stepHide(step, face({ dialog: true }), false).step;
  const held = stepHide(step, face({ dialog: true, submit: false }), false);
  assert.equal(held.action, null);
  assert.equal(held.step.phase, 'form');
  const armed = stepHide(held.step, face({ dialog: true, submit: true }), false);
  assert.equal(armed.action, 'submit');
});

test('an open dialog blocks the next card until it is gone', () => {
  const submitted = walk([
    face({ menuVacancy: true, menuEmployer: true }),
    face({ dialog: true }),
    face({ dialog: true }),
    face({ dialog: true }),
    face({ dialog: true, submit: true }),
    face({ dialog: true }),
  ]);
  assert.deepEqual(submitted.actions, ['vacancy', 'wrong', 'ask', 'submit']);
  assert.equal(submitted.step.phase, 'close');
  const retry = stepHide(submitted.step, face({ dialog: true }), true);
  assert.equal(retry.step.phase, 'retry');
  assert.equal(retry.action, null);
  const again = stepHide(retry.step, face({ dialog: true, submit: true }), false);
  assert.equal(again.action, 'wrong');
  const asked = stepHide(again.step, face({ dialog: true, submit: true }), false);
  assert.equal(asked.action, 'ask');
  const sent = stepHide(asked.step, face({ dialog: true, submit: true }), false);
  assert.equal(sent.action, 'submit');
  assert.equal(sent.step.phase, 'close');
  const stuck = stepHide(sent.step, face({ dialog: true }), true);
  assert.equal(stuck.step.phase, 'stuck');
  assert.equal(stuck.action, null);
});

test('a closed popup lets the next card start', () => {
  const after = stepHide(hideStart(), face({ menuVacancy: true }), false);
  const clear = stepHide(after.step, face(), false);
  assert.equal(clear.step.phase, 'close');
  const done = stepHide(clear.step, face(), false);
  assert.equal(done.step.phase, 'done');
});

test('a hide script result is read without trusting the shape', () => {
  assert.equal(hideFaceOf(null), null);
  assert.equal(hideFaceOf('menu'), null);
  assert.equal(hideFaceOf({ resume: true, menuVacancy: true }), 'resume');
  assert.deepEqual(hideFaceOf({ menuVacancy: true, dialog: false, submit: 1 }), face({ menuVacancy: true }));
  assert.equal(hideClickOk({ ok: true }), true);
  assert.equal(hideClickOk({ ok: true, resume: true }), false);
  assert.equal(hideClickOk({ ok: 'yes' }), false);
});

function walk(frames) {
  const actions = [];
  let step = hideStart();
  for (const frame of frames) {
    const move = stepHide(step, frame, false);
    if (move.action !== null)
      actions.push(move.action);

    step = move.step;
  }

  return { actions, step };
}
