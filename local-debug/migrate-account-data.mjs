#!/usr/bin/env node
// Copy personal account data (facts, canonSeed, profile, coverLetter) from a source JSON into a target
// account file. Dry-run by default; --apply writes (with a backup next to the target). Idempotent: only
// empty target fields are filled, profile fields are merged per key (existing target keys win).
// Never prints values — only field names, counts and lengths.
//
//   node local-debug/migrate-account-data.mjs --source <file.json> --target <accounts/login.json> [--apply] [--only facts,canonSeed,profile,coverLetter]
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const FIELDS = ['facts', 'canonSeed', 'profile', 'coverLetter'];

export function parseArgs(argv) {
  const out = { source: '', target: '', apply: false, only: FIELDS };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply')
      out.apply = true;
    else if (arg === '--source')
      out.source = argv[++index] ?? '';
    else if (arg === '--target')
      out.target = argv[++index] ?? '';
    else if (arg === '--only')
      out.only = String(argv[++index] ?? '').split(',').map(item => item.trim()).filter(item => FIELDS.includes(item));
  }

  return out;
}

function asObject(raw) {
  if (typeof raw === 'object' && raw !== null)
    return raw;

  if (typeof raw === 'string' && raw.trim().length > 0) {
    try {
      const parsed = JSON.parse(raw);

      return typeof parsed === 'object' && parsed !== null ? parsed : null;
    }
    catch {
      return null;
    }
  }

  return null;
}

const isEmpty = value => value === undefined || value === null || (typeof value === 'string' && value.trim().length === 0);

function describe(field, value) {
  if (field === 'coverLetter')
    return `${String(value).length} знаков`;

  const obj = asObject(value) ?? {};
  if (field === 'facts')
    return `правил ${Array.isArray(obj.rules) ? obj.rules.length : 0}, заметки ${String(obj.notes ?? '').length} зн., резюме ${String(obj.resume ?? '').length} зн.`;

  if (field === 'canonSeed')
    return `правил ${Array.isArray(obj.items) ? obj.items.length : 0}`;

  return `полей ${Object.keys(obj.fields ?? {}).length}, своих ${Array.isArray(obj.custom) ? obj.custom.length : 0}`;
}

// Pure plan: what would change. Returns { next, changes: [{ field, action, detail }] }.
export function plan(source, target, only = FIELDS) {
  const next = { ...target };
  const changes = [];
  for (const field of only) {
    const from = source[field];
    if (isEmpty(from)) {
      changes.push({ field, action: 'skip', detail: 'в источнике пусто' });
      continue;
    }

    if (field === 'profile' && !isEmpty(target.profile)) {
      const have = asObject(target.profile) ?? { fields: {}, custom: [] };
      const add = asObject(from) ?? { fields: {}, custom: [] };
      const fields = { ...(add.fields ?? {}), ...(have.fields ?? {}) };
      const customKeys = new Set((have.custom ?? []).map(item => item.key));
      const custom = [...(have.custom ?? []), ...(add.custom ?? []).filter(item => !customKeys.has(item.key))];
      const added = Object.keys(fields).length - Object.keys(have.fields ?? {}).length + custom.length - (have.custom ?? []).length;
      if (added === 0) {
        changes.push({ field, action: 'keep', detail: 'всё уже есть' });
        continue;
      }

      next.profile = JSON.stringify({ version: 1, savedAt: have.savedAt || Date.now(), fields, custom });
      changes.push({ field, action: 'merge', detail: `добавить ${added} (существующие не трогаются)` });
      continue;
    }

    if (!isEmpty(target[field])) {
      changes.push({ field, action: 'keep', detail: `в цели уже есть (${describe(field, target[field])})` });
      continue;
    }

    next[field] = typeof from === 'string' ? from : JSON.stringify(from);
    changes.push({ field, action: 'set', detail: describe(field, from) });
  }

  return { next, changes };
}

export function run(argv, log = line => console.log(line)) {
  const args = parseArgs(argv);
  if (!args.source || !args.target) {
    log('нужны --source и --target (и --apply, чтобы записать)');

    return 2;
  }

  const source = JSON.parse(fs.readFileSync(args.source, 'utf8'));
  const target = fs.existsSync(args.target) ? JSON.parse(fs.readFileSync(args.target, 'utf8')) : null;
  if (target === null) {
    log(`цель не найдена: ${args.target} — сначала нужен аккаунт (вход в админку)`);

    return 2;
  }

  const { next, changes } = plan(source, target, args.only);
  log(`${args.apply ? 'ПРИМЕНЯЮ' : 'DRY-RUN'}: ${path.basename(args.source)} → ${args.target}`);
  for (const change of changes)
    log(`  ${change.field}: ${change.action} · ${change.detail}`);
  const dirty = changes.some(change => change.action === 'set' || change.action === 'merge');
  if (!dirty) {
    log('  изменений нет');

    return 0;
  }

  if (!args.apply) {
    log('  ничего не записано; добавь --apply');

    return 0;
  }

  const backup = `${args.target}.bak-${Date.now()}`;
  fs.copyFileSync(args.target, backup);
  const tmp = `${args.target}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, args.target);
  log(`  записано; бэкап: ${backup}`);

  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`)
  process.exitCode = run(process.argv.slice(2));
