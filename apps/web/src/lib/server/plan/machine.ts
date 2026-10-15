// Step machine: advance(state, lastOutcome) → next Step. No timers: the extension asks "what next"
// (next/report), the server answers with one command or "idle, ask again in N ms".
// Long pauses (tea, out of hours, nap) are idle steps, never server-side sleeps; short pauses (≤60 s)
// are wait commands executed by the extension.
import type { Deps, Item, Kind, Outcome, Settings, Status, Step } from './types.ts';
import type { PlanState } from './state.ts';
import { dayOf } from './state.ts';
import { distractWait, hoursOpen, msToOpen, NEGOTIATIONS, negotiationsDue, pageSignal, paceOf, readWait, TEA, teaRoll, titleStop } from './rules.ts';
import { FEED, LIGHT, parseSerp, searchUrl } from './search.ts';
import { answerProblem, FORM_SEL, parseForm } from './form.ts';
import { parseNegotiations } from './negotiations.ts';
import { hideSelector, JOB_OFFER, JOB_OFFER_CLOSE, msToMonday, murkyBlock, on, resumeKind, testTask } from './scenarios.ts';
import { feedDry, FEED_DRY_STOP, LIGHT_BATCH, LIGHT_SLEEP_MS } from './rules.ts';

export type PlanDeps = Deps; // kept as alias

export const SNAP_MAX = 100_000;
const WAIT_MAX = 60_000;
const APPLY_EXEC_MS = 120_000;
const DONE_MARK = /Вы откликнулись|Отклик отправлен|vacancy-response-link-view-topic|Резюме доставлено/i;

const cmd = (kind: Kind, params: Record<string, unknown>, execMs?: number): Step => (execMs ? { type: 'cmd', cmd: { kind, params }, execMs } : { type: 'cmd', cmd: { kind, params } });
const idle = (reason: string, retryMs: number): Step => ({ type: 'idle', reason, retryMs: Math.max(1000, retryMs) });

function textOf(o: Outcome | undefined): { url: string; text: string; captcha?: boolean; detect?: boolean } {
  if (!o || o.ok === false)
    return { url: '', text: '' };
  const r = o.result as Record<string, unknown> | string | undefined;
  if (typeof r === 'string')
    return { url: '', text: r };
  const v = (k: string) => (r && typeof r[k] === 'string' ? r[k] as string : '');
  return { url: v('url'), text: v('html') || v('text') || v('snapshot'), captcha: r?.captcha === true, detect: r?.detect === true };
}

function hold(st: PlanState, reason: string, now: number): Step {
  st.hold = { reason, needsHuman: true, at: now };
  st.phase = 'start';
  return { type: 'stop', reason, needsHuman: true };
}

const SIGNAL_REASON = { captcha: 'капча', detect: 'детект: площадка просит подтверждение (смс)', login: 'площадка просит войти (login)' } as const;

// Returns stop step if page shows captcha/detect/login; 'limit' → stop for today.
function guard(st: PlanState, page: ReturnType<typeof textOf>, now: number): Step | null {
  const sig = pageSignal(page);
  if (sig === null)
    return null;
  if (sig === 'limit') {
    st.phase = 'start';
    st.sentToday = Number.POSITIVE_INFINITY;
    return idle('лимит откликов на сегодня', msToOpen(now));
  }
  return hold(st, SIGNAL_REASON[sig], now);
}

function answersObject(list: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const a of list) {
    const row = a as { id?: unknown; name?: unknown; value?: unknown; answer?: unknown };
    const key = typeof row?.id === 'string' ? row.id : typeof row?.name === 'string' ? row.name : '';
    if (key)
      out[key] = row.value ?? row.answer ?? '';
  }
  return out;
}

function fieldsOf(o: Outcome | undefined): unknown[] {
  if (!o || o.ok === false)
    return [];
  const r = o.result as { fields?: unknown } | undefined;
  return Array.isArray(r?.fields) ? r.fields : [];
}

async function record(deps: Deps, st: PlanState, status: Status, reason: string) {
  const it = st.current;
  if (it) { st.seen.push(it.id); if (st.seen.length > 500) st.seen.splice(0, st.seen.length - 500); }
  if (it && deps.recordApplied)
    await deps.recordApplied(st.login, { id: it.id, url: it.url, title: it.title, status, reason });
  if (status === 'sent')
    st.sentToday++;
  st.current = null;
  st.answers = [];
}

async function begin(st: PlanState, deps: Deps, set: Settings, now: number, rand: () => number): Promise<Step> {
  if (st.hold)
    return { type: 'stop', reason: st.hold.reason, needsHuman: st.hold.needsHuman };
  if (st.day !== dayOf(now)) { st.day = dayOf(now); st.sentToday = 0; st.mode = 'feed'; st.page = 0; st.wordIdx = 0; st.sleepUntil = 0; st.dryStreak = 0; st.relookLeft = 8; st.quietUntil = 0; }
  if (hoursOpen(now, set.keepWorkHours !== false) === false)
    return idle('вне рабочих часов (09–22 МСК)', msToOpen(now));
  if (st.quietUntil > now)
    return idle('лимит админки', st.quietUntil - now);
  if (on(set, 'quota') && deps.quota && now - st.quotaAt >= 10 * 60_000) {
    st.quotaAt = now;
    const q = await deps.quota(st.login);
    if (q.week === false) { st.quietUntil = now + msToMonday(now); return idle('неделя кончилась', st.quietUntil - now); }
    if (q.day === false) { st.quietUntil = now + msToOpen(now); return idle('лимит на сегодня', st.quietUntil - now); }
  }
  if (set.dailyCap && st.sentToday >= set.dailyCap)
    return idle('дневной лимит', msToOpen(now));
  // Tea: after ~45 min of work roll once; hit → long idle, miss → short idle.
  if (now - st.teaAt >= TEA.everyMs) {
    st.teaAt = now;
    const t = teaRoll(rand);
    return idle(t.hit ? 'чай' : 'чай мимо', t.ms);
  }
  if (negotiationsDue(now, st.negotiationsAt) && (deps.onNegotiations || deps.onNegotiationRows)) {
    st.negotiationsAt = now;
    st.phase = 'neg_open';
    return cmd('navigate', { url: NEGOTIATIONS.url });
  }
  if (st.queue.length === 0 && on(set, 'savedLinks') && deps.fetchLinks && now - st.linksAt >= 10 * 60_000) {
    st.linksAt = now;
    const links = await deps.fetchLinks(st.login);
    const fresh = deps.filterKnown ? await deps.filterKnown(st.login, links) : links;
    st.queue.push(...fresh.filter(l => !st.seen.includes(l.id)));
  }
  if (st.queue.length === 0 && on(set, 'relook') && deps.claimRelook && st.relookLeft > 0) {
    const rows = await deps.claimRelook(st.login);
    if (rows.length > 0) { st.relookLeft--; st.queue.push(rows[0]); }
    else st.relookLeft = 0;
  }
  const item = st.queue.shift();
  if (item) {
    const stop = titleStop(item.title);
    st.current = item;
    if (stop) {
      await record(deps, st, 'skip', stop);
      return begin(st, deps, set, now, rand);
    }
    st.phase = 'vac_open';
    return cmd('navigate', { url: item.url });
  }
  return search(st, set, now);
}

// Modes from queue-run: feed → words → light (remote, 24 h, 10 cards, then 1 h sleep; bare → again 1 h).
function search(st: PlanState, set: Settings, now: number): Step {
  const words = set.words ?? [];
  if (st.sleepUntil > now)
    return idle('лайт, сплю час', st.sleepUntil - now);
  if (set.feed === 'light' && st.mode === 'feed')
    st.mode = 'light';
  if (st.mode === 'words' && st.wordIdx >= words.length) { st.mode = 'light'; st.page = 0; st.lightLeft = LIGHT_BATCH; st.lightBare = true; }
  if (st.mode === 'light' && st.lightLeft <= 0) {
    if (st.sleepUntil > 0) { // woke up after a nap → new batch
      st.sleepUntil = 0; st.lightLeft = LIGHT_BATCH; st.lightBare = true; st.page = 0;
    }
    else {
      st.sleepUntil = now + LIGHT_SLEEP_MS;
      return idle(st.lightBare ? 'лайт: ничего нормального, сплю час' : 'лайт, сплю час', LIGHT_SLEEP_MS);
    }
  }
  const base = st.mode === 'light' ? LIGHT : FEED;
  const text = st.mode === 'words' ? words[st.wordIdx] : undefined;
  st.phase = 'serp_open';
  return cmd('navigate', { url: searchUrl(base, { text, page: st.page }) });
}

function takeCards(st: PlanState, all: Item[], more: boolean, maxPages: number) {
  const cards = all.filter(c => !st.seen.includes(c.id) && !st.queue.some(q => q.id === c.id));
  let take = cards;
  if (st.mode === 'feed') {
    take = [];
    for (const c of cards) {
      const dry = feedDry(c.title, '');
      st.dryStreak = dry ? st.dryStreak + 1 : 0;
      if (st.dryStreak >= FEED_DRY_STOP) break;
      if (!dry) take.push(c); // off-stack/junk cards are not queued
    }
  }
  if (st.mode === 'light') {
    take = cards.slice(0, Math.max(0, st.lightLeft));
    st.lightLeft -= take.length;
    if (take.some(c => !feedDry(c.title, ''))) st.lightBare = false;
  }
  st.queue.push(...take);
  const dried = st.mode === 'feed' && st.dryStreak >= FEED_DRY_STOP;
  if (more && !dried && st.page + 1 < maxPages && !(st.mode === 'light' && st.lightLeft <= 0)) { st.page++; return; }
  st.page = 0;
  if (st.mode === 'feed') { st.mode = 'words'; st.dryStreak = 0; }
  else if (st.mode === 'words') st.wordIdx++;
  else st.lightLeft = 0;
}

// One transition. `last` is the outcome of the previously issued command (undefined on first call).
export async function advance(st: PlanState, last: Outcome | undefined, deps: PlanDeps): Promise<Step> {
  const now = (deps.now ?? Date.now)();
  const rand = deps.rand ?? Math.random;
  const set = (await deps.settings?.(st.login)) ?? {};
  const pace = paceOf(set.pace);
  if (st.hold)
    return { type: 'stop', reason: st.hold.reason, needsHuman: true };
  // Extension-side detect signal arrives as an error text from any command.
  if (last && last.ok === false && /капч|captcha|детект|smscode|недоступна эта вакансия/i.test(last.error))
    return hold(st, /капч|captcha/i.test(last.error) ? 'капча' : SIGNAL_REASON.detect, now);

  switch (st.phase) {
    case 'start':
      return begin(st, deps, set, now, rand);

    case 'neg_open':
    case 'serp_open':
    case 'vac_open':
      if (last && last.ok === false && st.phase === 'vac_open') { await record(deps, st, 'skip', 'вакансия не открылась'); st.phase = 'start'; return begin(st, deps, set, now, rand); }
      if (last && last.ok === false) { st.phase = 'start'; return idle(`страница не открылась: ${last.error}`, 60_000); }
      st.phase = st.phase === 'neg_open' ? 'neg_read' : st.phase === 'serp_open' ? 'serp_read' : 'vac_read';
      return cmd('snapshot', { maxChars: SNAP_MAX });

    case 'neg_read': {
      const page = textOf(last);
      const g = guard(st, page, now);
      if (g) return g;
      if (last?.ok) {
        await deps.onNegotiations?.(st.login, page.text);
        const rows = parseNegotiations(page.text, now);
        await deps.onNegotiationRows?.(st.login, rows);
        if (on(set, 'invites') && deps.onInvitation) {
          for (const r of rows.filter(r => r.state === 'invitation' && !st.invitesSeen.includes(r.vacancyId))) {
            st.invitesSeen.push(r.vacancyId);
            await deps.onInvitation(st.login, r);
          }
          if (st.invitesSeen.length > 1000) st.invitesSeen.splice(0, st.invitesSeen.length - 1000);
        }
      }
      st.phase = 'start';
      return begin(st, deps, set, now, rand);
    }

    case 'serp_read': {
      // navigate done → snapshot; snapshot done → parse.
      const page = textOf(last);
      const g = guard(st, page, now);
      if (g) return g;
      const { cards, more } = parseSerp(page.text);
      const fresh = deps.filterKnown ? await deps.filterKnown(st.login, cards) : cards;
      takeCards(st, fresh, more, set.maxPages ?? 5);
      if (on(set, 'hideJunk') && deps.postHidden) {
        st.hideQueue = fresh.filter(c => !st.queue.some(q => q.id === c.id) && (titleStop(c.title) || feedDry(c.title, ''))).slice(0, 5);
        const h = st.hideQueue[0];
        if (h) { st.phase = 'hide'; return cmd('click', { selector: hideSelector(h.id), timeoutMs: 5_000 }); }
      }
      st.phase = 'start';
      return begin(st, deps, set, now, rand);
    }

    case 'hide': {
      const h = st.hideQueue.shift();
      if (h && last?.ok) await deps.postHidden?.(st.login, { id: h.id, title: h.title, reason: titleStop(h.title) || 'мусор в ленте' });
      const nx = st.hideQueue[0];
      if (nx) return cmd('click', { selector: hideSelector(nx.id), timeoutMs: 5_000 });
      st.phase = 'start';
      return begin(st, deps, set, now, rand);
    }

    case 'vac_offer':
      st.phase = 'vac_wait';
      return cmd('wait', { ms: Math.min(WAIT_MAX, readWait(pace, rand).ms) });

    case 'vac_read': {
      const page = textOf(last);
      const g = guard(st, page, now);
      if (g) return g;
      if (DONE_MARK.test(page.text)) { st.log = st.log.filter(l => l !== 'apply:verify'); await record(deps, st, 'sent', 'уже откликались'); st.phase = 'start'; return begin(st, deps, set, now, rand); }
      if (st.log.includes('apply:verify')) {
        st.log = st.log.filter(l => l !== 'apply:verify');
        await record(deps, st, 'needsHuman', 'отклик не подтверждён после сбоя, повтор вслепую запрещён');
        st.phase = 'start';
        return begin(st, deps, set, now, rand);
      }
      const block = (on(set, 'murky') && murkyBlock(page.text)) || (on(set, 'testTask') && testTask(page.text) ? 'тестовое задание' : '');
      if (block) {
        await record(deps, st, 'needsHuman', block);
        st.phase = 'start';
        return begin(st, deps, set, now, rand);
      }
      if (on(set, 'jobOffer') && JOB_OFFER.test(page.text)) {
        st.phase = 'vac_offer';
        return cmd('click', { selector: JOB_OFFER_CLOSE, timeoutMs: 5_000 });
      }
      st.phase = 'vac_wait';
      return cmd('wait', { ms: Math.min(WAIT_MAX, readWait(pace, rand).ms) });
    }

    case 'vac_wait':
      st.phase = 'apply_click';
      return cmd('click', { selector: FORM_SEL.applyButton, timeoutMs: 10_000 });

    case 'apply_click':
      // no button or no form → look at the page: maybe the response went through without a form.
      if (!last || last.ok === false) { st.phase = 'page_check'; return cmd('snapshot', { maxChars: SNAP_MAX }); }
      st.phase = 'form_wait';
      return cmd('wait', { selector: FORM_SEL.root, timeoutMs: 10_000 });

    case 'form_wait':
      st.phase = last?.ok ? 'form_read' : 'page_check';
      return last?.ok ? cmd('snapshot', { selector: FORM_SEL.root, maxChars: SNAP_MAX }) : cmd('snapshot', { maxChars: SNAP_MAX });

    case 'page_check': {
      const page = textOf(last);
      const g = guard(st, page, now);
      if (g) return g;
      await record(deps, st, DONE_MARK.test(page.text) ? 'sent' : 'skip', DONE_MARK.test(page.text) ? 'отклик без формы' : 'нет кнопки или формы отклика');
      st.phase = 'after';
      return cmd('wait', { ms: Math.min(WAIT_MAX, distractWait(pace, rand)) });
    }

    case 'form_read': {
      const page = textOf(last);
      const g = guard(st, page, now);
      if (g) return g;
      if (DONE_MARK.test(page.text)) {
        await record(deps, st, 'sent', 'отклик без формы');
        st.phase = 'after';
        return cmd('wait', { ms: Math.min(WAIT_MAX, distractWait(pace, rand)) });
      }
      const parsed = parseForm(page.text);
      const formBlock = parsed.questionnaire ? 'анкета работодателя' : (on(set, 'murky') && murkyBlock(page.text)) || (on(set, 'testTask') && testTask(page.text) ? 'тестовое задание' : '');
      if (formBlock) {
        await record(deps, st, 'needsHuman', formBlock);
        st.phase = 'start';
        return begin(st, deps, set, now, rand);
      }
      const given = fieldsOf(last);
      const fields: unknown[] = (given.length > 0 ? given : parsed.fields).filter((f:any) => !/resume|letter/i.test(f.name || f.id || '')).map((f:any) => ({...f,prompt:f.prompt || f.label,kind:f.kind || (f.type==='select'?'select':f.type==='radio'||f.type==='checkbox'?'choice':'text'),options:(f.options || []).map((o:any)=>typeof o==='string'?o:o.text)}));
      if (fields.length > 0 && deps.answer) {
        try {
          const ctx = deps.context ? await deps.context(st.login) : {}; // transit, not stored
          st.answers = (await deps.answer(st.login, { fields, context: ctx })).answers;
        }
        catch (e) {
          await record(deps, st, 'needsHuman', `ответы не получены: ${e instanceof Error ? e.message : e}`);
          st.phase = 'start';
          return begin(st, deps, set, now, rand);
        }
      }
      const problem = fields.length > 0 && deps.answer ? answerProblem(fields, st.answers) : '';
      if (problem) {
        await record(deps, st, 'needsHuman', problem);
        st.phase = 'start';
        return begin(st, deps, set, now, rand);
      }
      st.phase = 'apply';
      const params: Record<string, unknown> = { vacancyId: st.current!.id };
      const answers: Record<string, unknown> = st.answers.length ? answersObject(st.answers) : {};
      if (on(set, 'resumePick')) answers.__resumeKind = resumeKind(st.current!.title);
      if (Object.keys(answers).length) params.answers = answers;
      if (on(set, 'letter') && deps.coverLetter) {
        const letter = (await deps.coverLetter(st.login)).trim(); // transit only
        if (!letter) {
          await record(deps, st, 'needsHuman', 'нужен твой ответ: сопроводительное письмо не задано в профиле');
          st.phase = 'start';
          return begin(st, deps, set, now, rand);
        }
        params.letter = letter.slice(0, 10_000);
      }
      return cmd('hh_apply', params, APPLY_EXEC_MS);
    }

    case 'apply': {
      if (!last || last.ok === false) {
        // Timeout ≠ not sent: never retry blindly, re-open and check.
        st.phase = 'vac_open';
        st.log.push('apply:verify');
        return cmd('navigate', { url: st.current!.url });
      }
      const r = (last.result ?? {}) as { status?: string; reason?: string; hints?: unknown };
      const hints = Array.isArray(r.hints) ? r.hints : [];
      if (r.reason === 'капча' || hints.includes('капча')) return hold(st, 'капча', now);
      if (/login|войти/i.test(r.reason ?? '')) return hold(st, SIGNAL_REASON.login, now);
      const status: Status = r.status === 'sent' || r.status === 'needsHuman' ? r.status : 'skip';
      await record(deps, st, status, r.reason ?? '');
      st.phase = 'after';
      return cmd('wait', { ms: Math.min(WAIT_MAX, distractWait(pace, rand)) });
    }

    case 'after':
      st.phase = 'start';
      return begin(st, deps, set, now, rand);
  }
}
