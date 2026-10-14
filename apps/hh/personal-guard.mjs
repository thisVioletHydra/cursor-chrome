// Test helper: checks sources against the local owner account without putting any real value into the repo.
import fs from 'node:fs';
import process from 'node:process';

const ACCOUNTS = process.env.HH_GUARD_ACCOUNTS ? new URL(`file://${process.env.HH_GUARD_ACCOUNTS}/`) : new URL('../../local-debug/data/review/accounts/', import.meta.url);
const SECRET_KEYS = ['telegramToken', 'hhAccessToken', 'hhClientSecret', 'extToken', 'modelChain'];

const parse = text => {
  try {
    return JSON.parse(text || '');
  }
  catch {
    return null;
  }
};

function collect(account) {
  const out = [];
  const add = (key, value) => {
    const text = String(value ?? '').trim();
    if (text.length >= 6)
      out.push({ key, value: text });
  };
  for (const key of SECRET_KEYS)
    add(key, account[key]);
  for (const line of String(account.coverLetter || '').split('\n'))
    add('coverLetter', line);
  const profile = parse(account.profile);
  for (const [name, field] of Object.entries(profile?.fields || {}))
    add(`profile.${name}`, field?.value);
  for (const rule of parse(account.facts)?.rules || [])
    add('facts.rule', rule);
  for (const item of parse(account.canonSeed)?.items || [])
    add('canonSeed.answer', item?.answer);
  return out;
}

/** Local account values (read-only), or null when there is no local account file. */
export function personalValues() {
  let dir;
  try {
    dir = fs.readdirSync(ACCOUNTS).filter(name => name.endsWith('.json'));
  }
  catch {
    return null;
  }
  const values = dir.flatMap(name => collect(parse(fs.readFileSync(new URL(name, ACCOUNTS), 'utf8')) || {}));
  return values.length ? values : null;
}

/** Keys (never values) of personal data found in the given source text. */
export function leaks(source, values) {
  return [...new Set(values.filter(item => source.includes(item.value)).map(item => item.key))];
}


// Every source file under the given dirs (relative to the repo root), minus untracked personal files.
const REPO = new URL('../../', import.meta.url);
const SKIP = /(^|\/)(node_modules|dist|dist-local|build|\.svelte-kit)(\/|$)|facts\.data\.ts$/;

export function sourceFiles(dirs) {
  const out = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(new URL(rel, REPO), { withFileTypes: true })) {
      const next = `${rel}/${entry.name}`;
      if (SKIP.test(next))
        continue;
      if (entry.isDirectory())
        walk(next);
      else if (/\.(ts|js|mjs|svelte|html|css|json)$/.test(entry.name))
        out.push(next);
    }
  };
  for (const dir of dirs)
    walk(dir);

  return out;
}

export function readRepo(rel) {
  return fs.readFileSync(new URL(rel, REPO), 'utf8');
}

/** Local owner account (read-only) or null. */
export function ownerAccount() {
  try {
    const name = fs.readdirSync(ACCOUNTS).find(file => file.endsWith('.json'));

    return name ? parse(fs.readFileSync(new URL(name, ACCOUNTS), 'utf8')) : null;
  }
  catch {
    return null;
  }
}
