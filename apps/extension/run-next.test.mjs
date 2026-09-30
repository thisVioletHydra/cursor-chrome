import { nextRun, nextSearchPage, SERVER_WAIT, TEA_PERIOD_MS, teaFires } from './src/chrome/run-next.ts';

import assert from 'node:assert/strict';
import test from 'node:test';

test('server fault while enabling keeps the bot on', () => {
  for (const fault of ['502', 'timeout', 'network']) {
    const decision = nextRun({ type: 'server', fault, justEnabled: true });
    assert.equal(decision.on, true);
    assert.equal(decision.closeBotTab, false);
    assert.equal(decision.status, SERVER_WAIT);
  }
});

test('user, captcha, hang, and daily limit turn the bot off and close the tab', () => {
  for (const reason of ['user', 'captcha', 'hang', 'daily']) {
    const decision = nextRun({ type: 'stop', reason });
    assert.equal(decision.on, false);
    assert.equal(decision.closeBotTab, true);
  }

  assert.equal(nextRun({ type: 'stop', reason: 'daily' }).status, 'лимит на сегодня');
});

test('pin, wake, and restore are not a stop', () => {
  for (const action of ['pin', 'wake', 'restore']) {
    const decision = nextRun({ type: 'touch', action, on: true });
    assert.equal(decision.on, true);
    assert.equal(decision.closeBotTab, false);
  }
});

test('off plus a pinned bot tab closes, a bot tab without a stop stays on', () => {
  const stopped = nextRun({ type: 'pair', on: false, botTab: true, explicitStop: true });
  assert.equal(stopped.on, false);
  assert.equal(stopped.closeBotTab, true);

  const held = nextRun({ type: 'pair', on: false, botTab: true, explicitStop: false });
  assert.equal(held.on, true);
  assert.equal(held.closeBotTab, false);

  const bare = nextRun({ type: 'pair', on: false, botTab: false, explicitStop: false });
  assert.equal(bare.on, false);
  assert.equal(bare.closeBotTab, true);
});

test('tea waits one full period and ignores a missing or ancient due', () => {
  const ancient = 1;
  assert.equal(teaFires({ runMs: 0, needMs: TEA_PERIOD_MS, teaDue: null }), false);
  assert.equal(teaFires({ runMs: 0, needMs: TEA_PERIOD_MS, teaDue: ancient }), false);
  assert.equal(teaFires({ runMs: TEA_PERIOD_MS - 1, needMs: TEA_PERIOD_MS, teaDue: ancient }), false);
  assert.equal(teaFires({ runMs: TEA_PERIOD_MS, needMs: Math.round(TEA_PERIOD_MS * 0.84), teaDue: null }), true);
  assert.equal(teaFires({ runMs: TEA_PERIOD_MS, needMs: TEA_PERIOD_MS, teaDue: ancient }), true);
});

test('search walks past page 5 and 20 until hh has no next page', () => {
  assert.equal(nextSearchPage(4, true), 5);
  assert.equal(nextSearchPage(5, true), 6);
  assert.equal(nextSearchPage(19, true), 20);
  assert.equal(nextSearchPage(20, true), 21);
  assert.equal(nextSearchPage(5, false), null);
  assert.equal(nextSearchPage(20, false), null);
});
