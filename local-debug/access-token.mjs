// Admin script for access tokens (local). Prints a new token ONCE; the DB keeps only its hash.
//   node local-debug/access-token.mjs issue <login> [label] [dailyLimit]
//   node local-debug/access-token.mjs revoke <token|id>
//   node local-debug/access-token.mjs unbind <id> <slot>
//   node local-debug/access-token.mjs list
// DB: $ACCESS_DB or apps/web/data/access.sqlite (same file the dev server uses).
import { openAccess } from '../apps/web/src/lib/server/access.ts';

import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const store = openAccess(process.env.ACCESS_DB || path.join(root, 'apps/web/data/access.sqlite'));
const [cmd, a, b, c] = process.argv.slice(2);

if (cmd === 'issue' && a)
  console.log(store.issue(b || a, a, c ? Number(c) : undefined));
else if (cmd === 'revoke' && a)
  console.log(store.revoke(a) ? 'revoked' : 'not found');
else if (cmd === 'unbind' && a && b)
  console.log(store.unbind(a, Number(b)) ? 'unbound' : 'not found');
else if (cmd === 'list')
  console.log(JSON.stringify(store.list().map(t => ({ ...t, devices: t.devices.map(d => ({ slot: d.slot, device: d.device_hash, score: d.last_score, zone: d.last_zone })) })), null, 2));
else
  console.log('usage: issue <login> [label] [limit] | revoke <token|id> | unbind <id> <slot> | list');
