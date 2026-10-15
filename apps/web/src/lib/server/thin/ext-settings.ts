import { accountJson, volumeFile } from './account-json.ts';

export const MANAGED = [
  'hideJunk',
  'keepSession',
  'showPop',
  'showMachine',
] as const;
export type Managed = (typeof MANAGED)[number];
export type ExtSettings = Partial<Record<Managed, boolean>>;
export function extSettingsPath() {
  return volumeFile('ext-settings.json');
}
export function cleanSettings(raw: unknown): ExtSettings {
  if (!raw || typeof raw !== 'object') return {};

  return Object.fromEntries(
    MANAGED.filter((k) => typeof (raw as any)[k] === 'boolean').map((k) => [
      k,
      (raw as any)[k],
    ]),
  );
}
export function createExtSettings(file = extSettingsPath()) {
  const store = accountJson(file, 'ext_setting');
  const get = (login: string): ExtSettings | null => {
    const raw = cleanSettings(store.get(login));
    return Object.keys(raw).length ? raw : null;
  };
  return {
    get,
    set: (login: string, patch: unknown, _now = Date.now()) => {
      const value = { ...(get(login) || {}), ...cleanSettings(patch) };
      store.set(login, value);
      return value;
    },
    seed: (login: string, values: unknown, _now = Date.now()) => {
      const clean = cleanSettings(values);
      if (get(login) !== null || !Object.keys(clean).length) return false;
      store.set(login, clean);
      return true;
    },
    close: () => store.close(),
  };
}
export type ExtSettingsStore = ReturnType<typeof createExtSettings>;
export const extSettings = createExtSettings();
