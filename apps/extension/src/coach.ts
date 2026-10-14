// Content script for https://console.x.ai/* only (host access comes from the <all_urls> host permission).
// Overlay only: element lookup + getBoundingClientRect, no clicks, no reading page values.
import { browser } from './browser-host';
import { cachedConfig } from './local/config-cache';
import { coachSteps, coachView, locate, paint } from './local/coach';

void (async () => {
  if (location.hostname !== 'console.x.ai' || document.getElementById('nojob-coach'))
    return;

  const config = await cachedConfig({ get: keys => browser.storage.local.get(keys) as Promise<Record<string, unknown>>, set: items => browser.storage.local.set(items) });
  const steps = coachSteps(config.selectors);
  const host = document.createElement('div');
  host.id = 'nojob-coach';
  const root = host.attachShadow({ mode: 'closed' });
  const layer = document.createElement('div');
  root.append(layer);
  document.documentElement.append(host);
  let stopped = false;
  layer.addEventListener('click', (event) => {
    if ((event.target as HTMLElement | null)?.hasAttribute('data-cc-close')) {
      stopped = true;
      host.remove();
    }
  });
  const tick = () => {
    if (stopped)
      return;
    paint(layer, coachView(locate(document, steps), steps, { width: innerWidth, height: innerHeight }));
  };
  tick();
  setInterval(tick, 700);
  addEventListener('resize', tick);
})();
