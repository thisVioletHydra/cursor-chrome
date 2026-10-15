import assert from 'node:assert/strict';
import test from 'node:test';

import { handlePlanFlag, planFlagUi } from './src/lib/server/thin/plan-flag-api.ts';

const flagsMem = () => { const m = new Map(); return { m, enabled: l => m.get(l) === true, setEnabled: (l, on) => m.set(l, on) }; };
const post = (body, origin = 'http://localhost:5317') => new Request('http://localhost:5317/admin/plan-flag', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) });

test('prod: hidden (404) unless PLAN_FLAG_UI=1; dev: available', () => {
  assert.equal(planFlagUi({ RAILWAY_ENVIRONMENT: 'production' }), false);
  assert.equal(planFlagUi({ NODE_ENV: 'production' }), false);
  assert.equal(planFlagUi({}), true);
  assert.equal(planFlagUi({ RAILWAY_ENVIRONMENT: 'production', PLAN_FLAG_UI: '1' }), true);
});

test('dev: session owner toggles only own flag; default off; guest/foreign origin refused', async () => {
  const flags = flagsMem();
  const d = { env: {}, flags, sessionLogin: () => 'roman', guest: () => false };
  const get = await handlePlanFlag(new Request('http://localhost:5317/admin/plan-flag'), d);
  assert.deepEqual(await get.json(), { login: 'roman', enabled: false });
  assert.deepEqual(await (await handlePlanFlag(post({ on: true }), d)).json(), { login: 'roman', enabled: true });
  assert.equal(flags.enabled('vasya-pupkin'), false);
  assert.equal((await handlePlanFlag(post({ on: false }, 'https://evil.test'), d)).status, 403);
  assert.equal((await handlePlanFlag(post({}), { ...d, guest: () => true })).status, 401);
  assert.equal((await handlePlanFlag(post({}), { ...d, sessionLogin: () => null })).status, 401);
  assert.equal((await handlePlanFlag(post({ on: true }), { ...d, env: { RAILWAY_ENVIRONMENT: 'production' } })).status, 404);
});
