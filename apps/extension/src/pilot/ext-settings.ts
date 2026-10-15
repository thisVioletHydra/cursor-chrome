// Stage D: extension settings managed in the admin. Pure helpers (no browser imports) shared by
// background, popup and content scripts. Admin value wins; missing admin value → local `flags` value.
// Local `flags` are never rewritten with admin values and never deleted (lossless switch).
export const EXT_CONFIG_KEY = 'extConfig:v1'; // new key: cache of GET /api/ext/config {etag, settings, at}
export const EXT_SEED_KEY = 'extSettingsSeed:v1'; // new key: local → admin seed done (once)
export const MANAGED = ['hideJunk', 'keepSession', 'showPop', 'showMachine'] as const;
export type Managed = (typeof MANAGED)[number];
export type AdminSettings = Partial<Record<Managed, boolean>>;
export type ExtConfigCache = { etag: string; settings: AdminSettings | null; at: number };

export function cleanSettings(raw: unknown): AdminSettings | null {
  if (raw === null || typeof raw !== 'object')
    return null;
  const out: AdminSettings = {};
  for (const key of MANAGED) {
    const v = (raw as Record<string, unknown>)[key];
    if (typeof v === 'boolean')
      out[key] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function adminSettingsOf(stored: unknown): AdminSettings | null {
  const cache = stored !== null && typeof stored === 'object' ? (stored as Record<string, unknown>)[EXT_CONFIG_KEY] : null;
  return cache !== null && typeof cache === 'object' ? cleanSettings((cache as Record<string, unknown>).settings) : null;
}

export function managedBy(admin: AdminSettings | null): Managed[] {
  return admin === null ? [] : MANAGED.filter(key => typeof admin[key] === 'boolean');
}

export function mergeSettings<T extends Record<Managed, boolean>>(local: T, admin: AdminSettings | null): T {
  if (admin === null)
    return local;
  const out = { ...local };
  for (const key of managedBy(admin))
    (out as Record<Managed, boolean>)[key] = admin[key] === true;
  return out;
}

// admin-managed keys are read-only locally: drop them from a local patch
export function localPatch<P extends Record<string, unknown>>(patch: P, admin: AdminSettings | null): P {
  const out = { ...patch };
  for (const key of managedBy(admin))
    delete (out as Record<string, unknown>)[key];
  return out;
}
