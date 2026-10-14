// Reissue an account's extToken (LOCAL account files only). NOT run automatically.
//   node local-debug/reissue-ext-token.mjs [--login thisVioletHydra] [--dir local-debug/data/review]          dry run
//   node local-debug/reissue-ext-token.mjs --apply ...                                                         backup → new token
// --apply: copies the account file and ext-tokens.json into local-debug/backups/, writes a new extToken,
// replaces the old index entry, prints the new token ONCE (paste it into the extension). The old token stops working.
// Prod (Railway) is never touched by this script: there use admin → Extension → «новый токен» (issueExtTokenAdmin).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import url from 'node:url';

const root = path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);

  return i > 0 ? process.argv[i + 1] : fallback;
};
const login = arg('--login', 'thisVioletHydra');
const dir = path.resolve(root, arg('--dir', 'local-debug/data/review'));
const accountFile = path.join(dir, 'accounts', `${login}.json`);
const indexFile = path.join(dir, 'ext-tokens.json');
const apply = process.argv.includes('--apply');

if (process.env.RAILWAY_ENVIRONMENT)
  throw new Error('не для Railway');

const account = JSON.parse(fs.readFileSync(accountFile, 'utf8'));
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
const plan = { login, accountFile, indexFile, hasToken: Boolean(account.extToken), indexEntries: Object.values(index).filter(v => v === login).length, apply };
if (!apply) {
  console.log(JSON.stringify({ ...plan, note: 'dry run: ничего не изменено; для перевыпуска добавьте --apply' }, null, 2));
  process.exit(0);
}

const stamp = Date.now();
const backups = path.join(root, 'local-debug/backups');
fs.mkdirSync(backups, { recursive: true });
fs.copyFileSync(accountFile, path.join(backups, `${login}.json.before-reissue-${stamp}`));
if (fs.existsSync(indexFile))
  fs.copyFileSync(indexFile, path.join(backups, `ext-tokens.json.before-reissue-${stamp}`));

const token = crypto.randomBytes(24).toString('base64url');
for (const [saved, owner] of Object.entries(index)) {
  if (owner === login)
    delete index[saved];
}
index[token] = login;
fs.writeFileSync(`${accountFile}.tmp`, JSON.stringify({ ...account, extToken: token }));
fs.renameSync(`${accountFile}.tmp`, accountFile);
fs.writeFileSync(`${indexFile}.tmp`, JSON.stringify(index));
fs.renameSync(`${indexFile}.tmp`, indexFile);
console.log(`новый extToken (показывается один раз): ${token}`);
