import { freshPilot, pilotStep, SERVER_SILENT, SERVER_WAIT, TEA_PERIOD_MS } from './src/chrome/pilot.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('server fault keeps an enabled bot on and the tab open', () => {
  const on = { ...freshPilot(), on: true };
  const down = pilotStep(on, { type: 'server', fault: '502' });
  assert.equal(down.on, true);
  assert.equal(down.closeBotTab, false);
  assert.equal(down.status, SERVER_WAIT);

  const timeout = pilotStep(on, { type: 'server', fault: 'timeout' });
  assert.equal(timeout.on, true);
  assert.equal(timeout.closeBotTab, false);
  assert.equal(timeout.status, SERVER_WAIT);

  const gone = pilotStep(on, { type: 'server', fault: 'unreachable' });
  assert.equal(gone.on, true);
  assert.equal(gone.closeBotTab, false);
  assert.equal(gone.status, SERVER_WAIT);
});

test('user, captcha, hang, and daily limit turn the bot off and close the tab', () => {
  const on = { ...freshPilot(), on: true };
  for (const reason of ['user', 'captcha', 'hang', 'daily']) {
    const next = pilotStep(on, { type: 'stop', reason });
    assert.equal(next.on, false);
    assert.equal(next.closeBotTab, true);
  }

  assert.equal(pilotStep(on, { type: 'stop', reason: 'daily' }).status, 'лимит на сегодня');
});

test('pin, wake, focus, popup, discard, and tab id are not a stop', () => {
  const on = { ...freshPilot(), on: true };
  for (const action of ['pin', 'wake', 'restore', 'popup', 'discarded', 'tab']) {
    const next = pilotStep(on, { type: 'touch', action });
    assert.equal(next.on, true);
    assert.equal(next.closeBotTab, false);
  }
});

test('off plus an open bot tab closes, a bot tab without a stop stays on', () => {
  const off = freshPilot();
  const stopped = pilotStep(off, { type: 'pair', botTab: true, explicitStop: true });
  assert.equal(stopped.on, false);
  assert.equal(stopped.closeBotTab, true);

  const held = pilotStep(off, { type: 'pair', botTab: true, explicitStop: false });
  assert.equal(held.on, true);
  assert.equal(held.closeBotTab, false);

  const bare = pilotStep(off, { type: 'pair', botTab: false, explicitStop: false });
  assert.equal(bare.on, false);
  assert.equal(bare.closeBotTab, true);
});

test('tea waits one full period and ignores a missing or ancient due', () => {
  const on = { ...freshPilot(), on: true };
  const ancient = 1;
  assert.equal(pilotStep(on, { type: 'tea', runMs: 0, needMs: TEA_PERIOD_MS, teaDue: null }).tea, false);
  assert.equal(pilotStep(on, { type: 'tea', runMs: 0, needMs: TEA_PERIOD_MS, teaDue: ancient }).tea, false);
  assert.equal(pilotStep(on, { type: 'tea', runMs: TEA_PERIOD_MS - 1, needMs: TEA_PERIOD_MS, teaDue: ancient }).tea, false);
  assert.equal(pilotStep(on, { type: 'tea', runMs: TEA_PERIOD_MS, needMs: Math.round(TEA_PERIOD_MS * 0.84), teaDue: null }).tea, true);
  assert.equal(pilotStep(on, { type: 'tea', runMs: TEA_PERIOD_MS, needMs: TEA_PERIOD_MS, teaDue: ancient }).tea, true);
});

test('closing the pinned tab does not clear on', () => {
  const on = { ...freshPilot(), on: true };
  const next = pilotStep(on, { type: 'close-tab' });
  assert.equal(next.on, true);
  assert.equal(next.closeBotTab, true);
});

test('search walks past page 5 and 20 until hh has no next page', () => {
  const on = freshPilot();
  assert.equal(pilotStep(on, { type: 'page', page: 4, hasNext: true }).page, 5);
  assert.equal(pilotStep(on, { type: 'page', page: 5, hasNext: true }).page, 6);
  assert.equal(pilotStep(on, { type: 'page', page: 19, hasNext: true }).page, 20);
  assert.equal(pilotStep(on, { type: 'page', page: 20, hasNext: true }).page, 21);
  assert.equal(pilotStep(on, { type: 'page', page: 5, hasNext: false }).page, null);
  assert.equal(pilotStep(on, { type: 'page', page: 20, hasNext: false }).page, null);
});
