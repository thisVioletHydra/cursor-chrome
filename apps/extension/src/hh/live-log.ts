import { ask } from './bridge';

const HOST_ID = 'cc-hh-log';
const CSS_ID = 'cc-hh-log-css';

export function noteLive(line: string): Promise<void> {
  return ask({ type: 'page-log', line }).then(() => undefined);
}

export function mountLiveLog(): void {
  dropLiveLog();
}

export function keepLiveLog(): void {
  dropLiveLog();
}

function dropLiveLog(): void {
  const host = document.getElementById(HOST_ID);
  if (host !== null)
    host.remove();

  const css = document.getElementById(CSS_ID);
  if (css !== null)
    css.remove();
}
