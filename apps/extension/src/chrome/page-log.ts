import { browser } from '../browser-host';

const MAX_LINES = 12;
const STALL_MS = 90_000;
const HH_URLS = ['https://hh.ru/*', 'https://*.hh.ru/*'];

const lines: string[] = [];
let armed = 0;
let notedAt = 0;
let stall: ReturnType<typeof setTimeout> | undefined;

export function liveLines(): string[] {
  return lines.slice();
}

export function armLiveLog(): void {
  armed += 1;
  if (armed === 1)
    notedAt = Date.now();

  planStall();
}

export function disarmLiveLog(): void {
  armed = Math.max(0, armed - 1);
  if (armed > 0)
    return;

  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
}

export async function tellPage(line: string): Promise<void> {
  const text = line.trim();
  if (text.length === 0)
    return;

  notedAt = Date.now();
  if (text === 'я завис' && lines[lines.length - 1] === 'я завис') {
    planStall();

    return;
  }

  lines.push(text);
  if (lines.length > MAX_LINES)
    lines.shift();

  planStall();
  await broadcast(lines);
}

export async function tickPage(label: string, ms: number): Promise<void> {
  if (ms <= 0)
    return;

  const steps = Math.max(1, Math.round(ms / 1000));
  const started = Date.now();
  for (let sec = 1; sec <= steps; sec++) {
    await tellPage(`${label} ${sec}…`);
    const pause = started + Math.round(ms * sec / steps) - Date.now();
    if (pause > 0)
      await delay(pause);
  }
}

function planStall(): void {
  if (stall !== undefined)
    clearTimeout(stall);

  stall = undefined;
  if (armed === 0)
    return;

  stall = setTimeout(() => {
    stall = undefined;
    if (armed === 0)
      return;

    if (Date.now() - notedAt < STALL_MS - 1000) {
      planStall();

      return;
    }

    void tellPage('я завис');
  }, STALL_MS);
}

// Сообщение во вкладку не активирует её.
async function broadcast(rows: string[]): Promise<void> {
  const tabs = await browser.tabs.query({ url: HH_URLS }).catch(() => []);
  await Promise.all(tabs.map(async (tab) => {
    if (typeof tab.id !== 'number')
      return;

    await browser.tabs.sendMessage(tab.id, { type: 'hh-log', lines: rows }).catch(() => {});
  }));
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
