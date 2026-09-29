import { fetchResumeId, postResume } from './admin-api';
import { getSyncKey, getSyncUrl } from './apply-log';
import { isHhUrl, requireWorkerTab, waitTab } from './worker-tab';
import { browser } from '../browser-host';

type Pulled = {
  url: string;
  text: string;
  ok: boolean;
  login: boolean;
  guard: boolean;
};

const HH_ROOT = 'https://hh.ru/';

export async function pullSavedResume(tabUrl: string): Promise<{ ok: boolean; reason: string }> {
  const base = (await getSyncUrl()).replace(/\/$/, '');
  const key = await getSyncKey();
  if (base.length === 0)
    return { ok: false, reason: 'нет адреса админки' };
  if (key.length === 0)
    return { ok: false, reason: 'нет ключа расширения' };
  if (adminTab(tabUrl, base) === false)
    return { ok: false, reason: 'открой админку в этом Chrome' };

  const id = await fetchResumeId(base, key);
  if (id === null)
    return { ok: false, reason: 'админка не ответила' };
  if (/^[A-Za-z0-9]{8,}$/.test(id) === false)
    return { ok: false, reason: 'ссылка не сохранена' };

  const text = await readPrint(id);
  if (typeof text !== 'string')
    return text;

  return postResume(base, key, id, text);
}

function adminTab(tabUrl: string, base: string): boolean {
  try {
    const page = new URL(tabUrl);
    const admin = new URL(base);

    return page.origin === admin.origin && page.pathname.startsWith('/admin');
  }
  catch {
    return false;
  }
}

function printUrl(id: string): string {
  const url = new URL(`https://hh.ru/resume/${id}`);
  url.searchParams.set('print', 'true');

  return url.toString();
}

async function readPrint(id: string): Promise<string | { ok: false; reason: string }> {
  const tabId = await hhTab();
  if (tabId === null)
    return { ok: false, reason: 'нет запиненной вкладки hh' };

  const here = await browser.tabs.get(tabId).catch(() => null);
  if (here !== null && isLogin(here.url || ''))
    return { ok: false, reason: 'на hh нужно войти' };

  const url = printUrl(id);
  const fetched = await fetchInPage(tabId, url);
  const fromFetch = taken(fetched, id);
  if (fromFetch !== null)
    return fromFetch;
  if (fetched?.login)
    return { ok: false, reason: 'на hh нужно войти' };

  await showUrl(tabId, url);
  const read = await readTab(tabId);
  if (read?.login)
    return { ok: false, reason: 'на hh нужно войти' };

  const fromTab = taken(read, id);
  if (fromTab !== null)
    return fromTab;
  if (read?.guard || fetched?.guard)
    return { ok: false, reason: 'hh отдал стену, не текст' };

  return { ok: false, reason: 'не прочиталась страница резюме' };
}

async function hhTab(): Promise<number | null> {
  let tab: chrome.tabs.Tab;
  try {
    tab = await requireWorkerTab();
  }
  catch {
    return null;
  }

  if (typeof tab.id !== 'number')
    return null;

  const url = tab.url || tab.pendingUrl || '';
  if (isHhUrl(url))
    return tab.id;

  await showUrl(tab.id, HH_ROOT);

  return tab.id;
}

function taken(page: Pulled | null, id: string): string | null {
  if (page === null || page.ok === false || page.login || page.guard)
    return null;
  if (page.url.includes(`/resume/${id}`) === false)
    return null;

  const text = page.text.trim();
  if (text.length < 80 || looksWall(text))
    return null;

  return text;
}

function looksWall(text: string): boolean {
  return /<!doctype|<html|account-login|ddos-guard|отключите vpn|turn off vpn|disable vpn/i.test(text.slice(0, 1500));
}

function isLogin(url: string): boolean {
  return url.includes('/account/login');
}

// Сессия hh есть у вкладки, не у service worker.
async function fetchInPage(tabId: number, url: string): Promise<Pulled | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: fetchPrint,
      args: [url],
    });

    return asPulled(results[0]?.result);
  }
  catch {
    return null;
  }
}

async function readTab(tabId: number): Promise<Pulled | null> {
  try {
    const results = await browser.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: readPrintPage,
    });

    return asPulled(results[0]?.result);
  }
  catch {
    return null;
  }
}

async function showUrl(tabId: number, url: string): Promise<void> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  const loaded = waitTab(tabId, 15_000);
  await browser.tabs.update(tabId, tab?.active === true ? { url } : { url, active: false });
  await loaded;
  await pause(800);
}

function fetchPrint(url: string): Promise<Pulled> {
  const wall = (html: string) => /отключите vpn|turn off vpn|disable vpn/i.test(html.slice(0, 2500));
  const textOf = (html: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,noscript,svg').forEach(node => node.remove());
    const root = doc.querySelector('main') || doc.body;
    const raw = root?.innerText || '';

    return raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 40_000);
  };

  return fetch(url, {
    credentials: 'include',
    redirect: 'follow',
    headers: { accept: 'text/html' },
  }).then(res => res.text().then((html) => {
    const login = res.url.includes('/account/login') || html.includes('data-qa="account-login"');
    const guard = html.includes('ddos-guard') || html.includes('__ddgfp') || wall(html);

    return {
      url: res.url,
      text: login || guard ? '' : textOf(html),
      ok: res.ok,
      login,
      guard,
    };
  })).catch(() => ({ url, text: '', ok: false, login: false, guard: false }));
}

function readPrintPage(): Pulled {
  const html = document.documentElement?.outerHTML.slice(0, 200_000) || '';
  const login = location.href.includes('/account/login') || html.includes('data-qa="account-login"');
  const guard = html.includes('ddos-guard') || html.includes('__ddgfp') || /отключите vpn|turn off vpn|disable vpn/i.test(html.slice(0, 2500));
  const root = document.querySelector('main') || document.body;
  let raw = root?.innerText || '';
  if (raw.trim().length < 80) {
    const frames = [...document.querySelectorAll('iframe')];
    const extra = frames.map((frame) => {
      try {
        return frame.contentDocument?.body?.innerText || '';
      }
      catch {
        return '';
      }
    }).join('\n');
    raw = `${raw}\n${extra}`;
  }

  return {
    url: location.href,
    text: login || guard ? '' : raw.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 40_000),
    ok: true,
    login,
    guard,
  };
}

function asPulled(raw: unknown): Pulled | null {
  if (typeof raw !== 'object' || raw === null)
    return null;
  if ('url' in raw === false || 'text' in raw === false || 'ok' in raw === false || 'login' in raw === false || 'guard' in raw === false)
    return null;
  if (typeof raw.url !== 'string' || typeof raw.text !== 'string')
    return null;
  if (typeof raw.ok !== 'boolean' || typeof raw.login !== 'boolean' || typeof raw.guard !== 'boolean')
    return null;

  return { url: raw.url, text: raw.text, ok: raw.ok, login: raw.login, guard: raw.guard };
}

function pause(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
