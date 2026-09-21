import { scanApplied, watchToasts } from './hh-apply-watch';
import { mountOverlay, refreshOverlay } from './hh-overlay';
import { pickFullstack } from './hh-resume';

const HOST_OK = /(?:^|\.)hh\.ru$/i;

export function startHhJob(): void {
  if (window !== window.top)
    return;

  if (HOST_OK.test(location.hostname) === false)
    return;

  mountOverlay();
  watchToasts();
  setInterval(() => {
    pickFullstack();
    scanApplied();
    void refreshOverlay();
  }, 500);
}
