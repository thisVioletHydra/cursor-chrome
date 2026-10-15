import { checkLink } from './src/local/link-gate.ts';
import { viewItems } from './src/diary/history-view.ts';

import test from 'node:test';
import assert from 'node:assert/strict';

test('transient failure: one bounded observation → down, the next (backoff) check recovers', async () => {
  let calls = 0;
  const fetcher = async (url, init) => {
    assert.equal(url, 'https://example.test/api/link');
    assert.ok(init.signal instanceof AbortSignal);

    return ++calls === 1 ? new Response(null, {status: 503}) : Response.json({login: 'roman'});
  };
  const first = await checkLink('https://example.test', 'token', fetcher);
  assert.equal(calls, 1);
  assert.equal(first.state, 'down');
  const gate = await checkLink('https://example.test', 'token', fetcher);
  assert.equal(calls, 2);
  assert.equal(gate.state, 'ok');
  assert.equal(gate.login, 'roman');
});
test('unknown login sees no legacy owner history', () => {
  assert.deepEqual(viewItems([{title:'X',company:'',url:'',vacancyId:'1'}], {linked:true,login:''}), []);
});
