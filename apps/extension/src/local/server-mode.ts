import { browser } from '../browser-host';
export async function serverMode(): Promise<boolean> {
  const cache=(await browser.storage.local.get('extConfig:v1'))['extConfig:v1'] as {settings?:{serverPlanner?:boolean}}|undefined;
  return cache?.settings?.serverPlanner === true;
}
