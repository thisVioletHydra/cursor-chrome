// Real flags.ts / pilot-apply.ts / power-wish.ts with a chrome.* mock (storage with onChanged, tabs): who may write autoQueue=true.
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import { registerHooks } from 'node:module';
import test from 'node:test';

// src imports are extensionless (bundler style): resolve './x' → './x.ts' for this test only
registerHooks({
  resolve(spec, ctx, next) {
    try {
      return next(spec, ctx);
    }
    catch (error) {
      if (spec.startsWith('.') && /\.[cm]?[jt]s$/.test(spec) === false)
        return next(`${spec}.ts`, ctx);
      throw error;
    }
  },
});

const data = {};
const delay = { get: 0 };
const sleep = ms => new Promise(done => setTimeout(done, ms));
const pick = (keys) => {
  if (keys == null) return structuredClone(data);
  const list = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys);
  const out = {};
  for (const k of list) if (k in data) out[k] = structuredClone(data[k]);
  return out;
};
const event = () => ({ addListener() {}, removeListener() {}, hasListener: () => false });
globalThis.chrome = {
  runtime: { id: 'test', getURL: p => p, onMessage: event(), sendMessage: async () => {} },
  storage: {
    local: {
      get: async (k) => { if (delay.get) await sleep(delay.get); return pick(k); },
      set: async (items) => { Object.assign(data, structuredClone(items)); },
      remove: async (k) => { for (const key of [k].flat()) delete data[key]; },
    },
    onChanged: event(),
  },
  tabs: { query: async () => [], get: async () => { throw new Error('no tab'); }, remove: async () => {}, onUpdated: event(), onRemoved: event() },
  windows: { getLastFocused: async () => ({ id: 1 }), getAll: async () => [] },
};

const { applyPilot } = await import('./src/pilot/pilot-apply.ts');
const { getFlags, setFlags } = await import('./src/pilot/flags.ts');
const { noteUserWish } = await import('./src/pilot/power-wish.ts');

async function reset(on) {
  for (const k of Object.keys(data)) delete data[k];
  data.flags = { autoQueue: on };
}

test('after a user «off», server / pair / enable / plain setFlags cannot write autoQueue=true', async () => {
  await reset(true);
  noteUserWish(false);
  await applyPilot({ type: 'stop', reason: 'user' }, { user: true });
  assert.equal((await getFlags()).autoQueue, false);
  await applyPilot({ type: 'enable' });
  await applyPilot({ type: 'pair', botTab: true, explicitStop: false });
  await applyPilot({ type: 'server', fault: 'timeout' });
  await setFlags({ autoQueue: true });
  assert.equal((await getFlags()).autoQueue, false);
});

test('the newest user «on» enables; parity on → off → on', async () => {
  await reset(false);
  for (const on of [true, false, true]) {
    noteUserWish(on);
    await applyPilot(on ? { type: 'enable' } : { type: 'stop', reason: 'user' }, { user: true });
    assert.equal((await getFlags()).autoQueue, on);
  }
});

test('race: slow «enable» in flight, then user «off» → final off, off written in < 200 ms', async () => {
  await reset(false);
  noteUserWish(true);
  delay.get = 30; // slow storage: the enable is mid-way when «off» arrives
  const enable = applyPilot({ type: 'enable' });
  await sleep(40);
  const t = Date.now();
  noteUserWish(false);
  await applyPilot({ type: 'stop', reason: 'user' }, { user: true });
  const offMs = Date.now() - t;
  await enable;
  delay.get = 0;
  assert.equal((await getFlags()).autoQueue, false);
  assert.ok(offMs < 1000, `off took ${offMs} ms`);
});

test('rpc: «off» is not under the lock and does not wait for the opening tab; enable tail closes its tab after «off»', async () => {
  const rpc = await fsPromises.readFile(new URL('./src/link/rpc.ts', import.meta.url), 'utf8');
  const off = rpc.slice(rpc.indexOf('async function disablePilot'), rpc.indexOf('bindPilotSettle('));
  assert.doesNotMatch(off, /powerGate\.locked/);
  assert.match(off, /applyPilot\(\{ type: 'stop', reason: 'user' \}, \{ user: true \}\)/);
  assert.match(rpc, /noteUserWish\(patch\.autoQueue\)/);
  assert.match(rpc, /if \(userWishOff\(\)\)\n {8}await closePinnedHh\(\);/);
  const flags = await fsPromises.readFile(new URL('./src/pilot/flags.ts', import.meta.url), 'utf8');
  assert.match(flags, /turningOff && opts\.user !== true && openingTab\(\)/);
});
