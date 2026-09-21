import { scanApplied, watchToasts } from './apply-watch';
import { pullRemoteNegotiations, scanNegotiations } from './negotiations';
import { mountOverlay, refreshOverlay } from './overlay';
import { pickFullstack } from './resume';

const HOST_OK = /(?:^|\.)hh\.ru$/i;

export function startHhJob(): void {
  if (window !== window.top)
    return;

  if (HOST_OK.test(location.hostname) === false)
    return;

  mountOverlay();
  watchToasts();
  void bootHistory();
  setInterval(() => {
    if (document.getElementById('cc-hh-overlay') === null)
      mountOverlay();

    pickFullstack();
    scanApplied();
    scanNegotiations();
    void refreshOverlay();
  }, 500);
}

async function bootHistory(): Promise<void> {
  await pullRemoteNegotiations();
  await refreshOverlay();
}
