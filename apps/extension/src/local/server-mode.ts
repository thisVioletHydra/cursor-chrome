import { browser } from '../browser-host';

export async function serverMode(): Promise<boolean> {
  const cache = (await browser.storage.local.get('extConfig:v1'))['extConfig:v1'] as { serverPlanner?: boolean; settings?: { serverPlanner?: boolean } | null } | undefined;

  // config v2: top-level serverPlanner; v1 cache: inside settings
  return cache?.serverPlanner === true || cache?.settings?.serverPlanner === true;
}
