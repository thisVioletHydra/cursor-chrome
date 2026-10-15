import { serverMode } from '../local/server-mode';
import { splitThinAnswers } from '../apply/thin-answers.ts';
// Stage B executor: one server primitive → existing extension functions (runCommand, worker tab, captcha/detect checks).
// Acts only in the pinned worker tab. navigate: https only. Results are size-capped for /api/ext/report.
import type { Outcome, Wire } from './server-link.ts';

import { httpsOnly } from './server-link.ts';

import { browser } from '../browser-host';
import { runCommand } from './commands';
import { runHhApplyThin } from '../apply/hh-apply-cmd';
import { requireTabId } from './inject';
import { requireWorkerTab } from '../tab/worker-tab';
import { pinnedCaptcha } from '../tab/hh-captcha';
import { pinnedDetect } from '../tab/hh-detect';

const RESULT_MAX = 200_000;
const WAIT_MAX_MS = 60_000;

// Runs inside the page (self-contained). Snapshot: {url, html} + {fields} of a form.
export function pageSnap(selector: string | null, maxChars: number): { url: string; html: string; fields: unknown[]; controls: unknown[]; found: boolean } {
  const root = selector ? document.querySelector(selector) : document.documentElement;
  const html = root ? (root as HTMLElement).outerHTML.slice(0, maxChars) : '';
  const fields: unknown[] = [];
  if (root && selector) {
    for (const el of Array.from(root.querySelectorAll('input, textarea, select'))) {
      const input = el as HTMLInputElement;
      if (input.type === 'hidden' || input.type === 'submit' || input.type === 'password')
        continue;
      const id = input.id || input.name || '';
      const label = (input.id ? document.querySelector(`label[for="${CSS.escape(input.id)}"]`)?.textContent : '') || input.closest('label')?.textContent || input.getAttribute('aria-label') || input.placeholder || '';
      const options = el.tagName === 'SELECT' ? Array.from((el as HTMLSelectElement).options).map(o => ({text:o.text.trim(),value:o.value})) : undefined;
      const selector = input.id ? `#${CSS.escape(input.id)}` : input.name ? `[name=${JSON.stringify(input.name)}]${input.type==='radio'||input.type==='checkbox'?`[value=${JSON.stringify(input.value)}]`:''}` : '';
      fields.push({ id, selector, value:input.type==='radio'||input.type==='checkbox'?input.value:'', name: input.name || '', type: el.tagName === 'SELECT' ? 'select' : el.tagName === 'TEXTAREA' ? 'textarea' : input.type, label: label.trim().slice(0, 500), required: input.required === true, ...(options ? { options } : {}) });
    }
  }
  const controls = root ? Array.from(root.querySelectorAll('button, [role="option"], [data-qa="resume-title"]')).map((el) => {
    const parts:string[]=[]; let node:Element|null=el;
    while(node && node!==document.documentElement){const parent=node.parentElement;parts.unshift(`${node.tagName}:nth-child(${Array.from(parent?.children || []).indexOf(node)+1})`);node=parent;}
    const all=Array.from(document.querySelectorAll(el.tagName));
    return {text:el.textContent?.trim().slice(0,300)||'', selector:el.id?`#${CSS.escape(el.id)}`:`html > ${parts.join(' > ')}` , path:all.indexOf(el)};
  }) : [];
  return { url: location.href, html, fields, controls, found: root !== null };
}

export function pageRead(selector: string, attr: string | null, all: boolean, maxChars: number): { url: string; values: string[]; text: string } {
  const list = all ? Array.from(document.querySelectorAll(selector)) : [document.querySelector(selector)].filter(Boolean) as Element[];
  const values = list.map(el => (attr ? el.getAttribute(attr) ?? '' : (el as HTMLElement).innerText ?? el.textContent ?? '').slice(0, maxChars));
  return { url: location.href, values, text: values.join('\n').slice(0, maxChars) };
}

export function pageHas(selector: string): boolean {
  return document.querySelector(selector) !== null;
}

async function inTab<A extends unknown[], R>(func: (...args: A) => R, args: A): Promise<R> {
  const tab = await requireWorkerTab();
  const out = await browser.scripting.executeScript({ target: { tabId: requireTabId(tab) }, func, args } as never) as Array<{ result?: R }>;
  return out?.[0]?.result as R;
}

async function signals(): Promise<{ captcha?: true; detect?: true }> {
  const [captcha, detect] = await Promise.all([pinnedCaptcha().catch(() => null), pinnedDetect().catch(() => false)]);
  return { ...(captcha === true ? { captcha: true as const } : {}), ...(detect === true ? { detect: true as const } : {}) };
}

const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
const num = (v: unknown, dflt: number, max: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(0, v)) : dflt);

export async function execServerCmd(cmd: Wire): Promise<Outcome> {
  if (await serverMode() && !['navigate','click','type','select','readDOM','wait'].includes(cmd.kind)) return {ok:false,error:'разрешены только примитивы'};
  const p = cmd.params ?? {};
  switch (cmd.kind) {
    case 'readDOM': {
      const result = p.mode === 'text'
        ? await inTab(pageRead, [String(p.selector || 'html'), typeof p.attr === 'string' ? p.attr : null, p.all === true, num(p.maxChars, 4000, RESULT_MAX)])
        : await inTab(pageSnap, [typeof p.selector === 'string' ? p.selector : null, num(p.maxChars, RESULT_MAX, RESULT_MAX)]);
      return {ok:true,result};
    }
    case 'navigate': {
      const url = httpsOnly(p.url);
      if (url === null)
        return { ok: false, error: 'url только https' };
      return { ok: true, result: { ...(await runCommand('browser_navigate', { url }, true) as object), ...(await signals()) } };
    }
    case 'click':
      return { ok: true, result: await runCommand('browser_click', { selector: String(p.selector) }, true) };
    case 'type':
      return { ok: true, result: await runCommand('browser_type', { selector: String(p.selector), text: String(p.text ?? ''), submit: p.submit === true }, true) };
    case 'select':
      return { ok: true, result: await runCommand('browser_select_option', { selector: String(p.selector), values: Array.isArray(p.values) ? p.values.map(String) : [] }, true) };
    case 'press_key':
      return { ok: true, result: await runCommand('browser_press_key', { key: String(p.key) }, true) };
    case 'read':
      return { ok: true, result: { ...(await inTab(pageRead, [String(p.selector), typeof p.attr === 'string' ? p.attr : null, p.all === true, num(p.maxChars, 4000, 4000)])), ...(await signals()) } };
    case 'snapshot': {
      const snap = await inTab(pageSnap, [typeof p.selector === 'string' ? p.selector : null, num(p.maxChars, RESULT_MAX, RESULT_MAX)]);
      return { ok: true, result: { ...snap, ...(await signals()) } };
    }
    case 'wait': {
      if (typeof p.selector !== 'string') {
        await sleep(num(p.ms, 0, WAIT_MAX_MS));
        return { ok: true, result: { waited: num(p.ms, 0, WAIT_MAX_MS) } };
      }
      const until = Date.now() + num(p.timeoutMs, 10_000, WAIT_MAX_MS);
      for (;;) {
        const has = await inTab(pageHas, [p.selector]).catch(() => false);
        if (has !== (p.gone === true))
          return { ok: true, result: { found: has } };
        if (Date.now() >= until)
          return { ok: false, error: 'не дождался элемента' };
        await sleep(500);
      }
    }
    case 'hh_apply':
      // the planner already clicked «Откликнуться» and waited for the form: fill + submit only, no second click
      return { ok: true, result: await runHhApplyThin(splitThinAnswers(p).resumeKind) };
  }
  return { ok: false, error: 'неизвестная команда' };
}
