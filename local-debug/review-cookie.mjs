// Prints a local session cookie signed with the dev default secret (SESSION_SECRET unset).
// It only works on a dev server without SESSION_SECRET; production sets its own secret.
import crypto from 'node:crypto';
import process from 'node:process';

const login = process.argv[2] || 'thisVioletHydra';
const payload = Buffer.from(JSON.stringify({ login, exp: Date.now() + 7 * 86_400_000 })).toString('base64url');
const sig = crypto.createHmac('sha256', 'dev-only-change-me').update(payload).digest('base64url');
console.log(`${payload}.${sig}`);
