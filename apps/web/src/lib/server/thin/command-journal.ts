// Atomic file journal on the existing volume. No database, headers, tokens or background jobs.
import fs from 'node:fs';
import path from 'node:path';
export interface CommandJournal { load(): unknown; save(value: unknown): void }
export function commandJournal(file = path.join(process.env.WEB_SECRETS ? path.dirname(process.env.WEB_SECRETS) : process.env.RAILWAY_ENVIRONMENT ? '/data' : path.join(process.cwd(), 'data'), 'ext-commands.json')): CommandJournal {
  return {
    load() {
      if (!fs.existsSync(file)) return null;
      // A damaged journal must not silently become an empty queue and replay actions.
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    },
    save(value) {
      fs.mkdirSync(path.dirname(file), {recursive:true});
      const tmp = `${file}.tmp`;
      const fd = fs.openSync(tmp, 'w', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(tmp, file);
    },
  };
}
