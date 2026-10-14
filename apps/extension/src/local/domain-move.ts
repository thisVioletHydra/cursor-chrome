// Server moved: old Railway hosts web-production-<hex>.up.railway.app → nojobnoproblem.up.railway.app.
// Read-time migration: rewrites only the host inside the stored server URL (applySyncUrl) and linkGate.host.
// Token/keys/other fields are never touched or deleted; idempotent (a second run changes nothing).
export const NEW_HOST = 'nojobnoproblem.up.railway.app';
const OLD_HOST = /^web-production-[0-9a-f]{4,8}\.up\.railway\.app$/i;

export function isOldHost(host: string): boolean {
  return OLD_HOST.test(host.trim());
}

export function moveHost(url: string): string {
  try {
    const parsed = new URL(url.trim());
    if (isOldHost(parsed.host) === false)
      return url;
    parsed.host = NEW_HOST;
    const out = parsed.toString();

    // keep the stored shape: an origin stays an origin (no trailing «/» added)
    return /\/$/.test(url.trim()) || parsed.pathname !== '/' ? out : out.replace(/\/$/, '');
  }
  catch {
    return url;
  }
}

type Area = { get: (keys: string[]) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> };

export const SYNC_URL_KEY = 'applySyncUrl';
export const GATE_KEY = 'linkGate';

export async function migrateOldDomain(area: Area): Promise<string[]> {
  const stored = await area.get([SYNC_URL_KEY, GATE_KEY]);
  const changed: string[] = [];
  const url = stored[SYNC_URL_KEY];
  if (typeof url === 'string') {
    const next = moveHost(url);
    if (next !== url) {
      await area.set({ [SYNC_URL_KEY]: next });
      changed.push(SYNC_URL_KEY);
    }
  }
  const gate = stored[GATE_KEY] as { host?: unknown } | undefined;
  if (gate && typeof gate === 'object' && typeof gate.host === 'string' && isOldHost(gate.host)) {
    await area.set({ [GATE_KEY]: { ...gate, host: NEW_HOST } });
    changed.push(GATE_KEY);
  }

  return changed;
}
