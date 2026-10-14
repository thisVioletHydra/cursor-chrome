import type { RequestEvent } from '@sveltejs/kit';
import type { Provider } from '@cursor-chrome/hh';
import type { CapturedForm, Decision, DecisionAnswer, DraftRow, QueueItem, ReviewAction, VacancyInfo } from '@cursor-chrome/hh';
import type { DraftReply, ReviewCard, ReviewCounts } from '$lib/review-types';

import { chainFromEnv, draftAnswers, parseFacts, dropPassed, embedFromChain, judgeFromChain, recheckDraftsOnce, dropWaiters, hintQuestions, isStale, notePassed, readDecisions, readDrafts, readQueue, readVacancyInfo, readWaiterForms, rememberCorrections, restoreWaiter, saveDecision, takeDecision, vacancyInfo } from '@cursor-chrome/hh';
import { error } from '@sveltejs/kit';
import { chainOf, isCreator, readAccount, readResume } from './secrets';
import { readProfile } from './profile';
import { githubLogin, readSession } from './session';

export const REJECT_REASONS = ['офис', 'зарплата', 'стек', 'мусор'] as const;

const LATER_MS = 24 * 60 * 60 * 1000;

export function reviewLogin(event: Pick<RequestEvent, 'cookies'>): string {
  const session = readSession(event.cookies.get('session'));
  if (session === null || githubLogin(session.login) === false)
    error(401, 'нет');

  if (isCreator(session.login) && event.cookies.get('preview') === 'guest')
    error(403, 'это просмотр');

  return session.login;
}

function waiting(queue: readonly QueueItem[], now: number): QueueItem[] {
  return queue.filter(row => row.status === 'needsHuman' && isStale(row.doneAt ?? row.at, now) === false);
}

function hidden(decisions: readonly Decision[], now: number): Set<string> {
  return new Set(decisions.filter(row => row.action !== 'later' || row.until > now).map(row => row.id));
}

// Same model chain everywhere: the account's «Модель» tab first, else the server env (MODEL_CHAIN / MISTRAL_API_KEY).
export async function reviewChain(login: string): Promise<Provider[]> {
  const own = chainOf(await readAccount(login));

  return own.length > 0 ? own : chainFromEnv();
}

export async function reviewBoard(login = '', now = Date.now()): Promise<{ cards: ReviewCard[]; counts: ReviewCounts }> {
  const chain = login ? await reviewChain(login) : [];
  await recheckDraftsOnce({ judge: judgeFromChain(chain), embed: embedFromChain(chain) }).catch(() => null);
  const [queue, decisions] = await Promise.all([readQueue(), readDecisions()]);
  const skip = hidden(decisions, now);
  const rows = waiting(queue, now).filter(row => skip.has(row.id) === false);
  const ids = rows.map(row => row.id);
  const [forms, infos, drafts] = await Promise.all([readWaiterForms(ids), readVacancyInfo(ids), readDrafts(ids)]);
  const cards = rows.map(row => cardOf(row, forms.get(row.id), infos, drafts.get(row.id) ?? []));

  return { cards, counts: countsOf(decisions, cards.length, now) };
}

function countsOf(decisions: readonly Decision[], left: number, now: number): ReviewCounts {
  return {
    left,
    sent: decisions.filter(row => row.action === 'approved').length,
    rejected: decisions.filter(row => row.action === 'rejected').length,
    later: decisions.filter(row => row.action === 'later' && row.until > now).length,
  };
}

function cardOf(row: QueueItem, form: CapturedForm | undefined, infos: Map<string, VacancyInfo | null>, drafts: DraftRow[]): ReviewCard {
  return {
    id: row.id,
    title: row.title,
    company: row.company,
    url: row.url || `https://hh.ru/vacancy/${row.id}`,
    place: row.place ?? '',
    at: row.doneAt ?? row.at,
    partial: form === undefined,
    questions: form?.questions ?? hintQuestions(row.hints ?? []),
    info: infos.get(row.id) ?? null,
    infoKnown: infos.has(row.id),
    drafts,
  };
}

export async function draftCard(login: string, id: string): Promise<DraftReply> {
  const queue = await readQueue();
  const row = queue.find(item => item.id === id && item.status === 'needsHuman');
  if (row === undefined)
    return { info: null, drafts: [], error: 'уже не в ждунах' };

  const notes: string[] = [];
  const info = await vacancyInfo(id).catch((failure: unknown) => {
    notes.push(`hh: ${failure instanceof Error ? failure.message : 'не ответил'}`);

    return null;
  });
  const form = (await readWaiterForms([id])).get(id);
  const questions = form?.questions ?? hintQuestions(row.hints ?? []);
  if (questions.length === 0)
    return { info, drafts: [], error: notes.join('; ') };

  const [chain, resume, profile, account] = await Promise.all([reviewChain(login), readResume(login), readProfile(login), readAccount(login)]);
  const result = await draftAnswers(chain, {
    id,
    title: row.title,
    company: row.company,
    info,
    questions,
    formText: form?.text ?? '',
    resume: resume?.text ?? '',
    profile,
    facts: parseFacts(account.facts),
  });
  if (result.error)
    notes.push(result.error);

  return { info, drafts: result.drafts, error: notes.join('; ') };
}

export type DecideInput = { id: string; action: ReviewAction; reason: string; answers: DecisionAnswer[] };

// «Ок» only records the approved answers; sending them to hh is plan item 8 and not wired yet.
export async function decide(input: DecideInput, now = Date.now()): Promise<{ ok: boolean; detail: string }> {
  const queue = await readQueue();
  const row = queue.find(item => item.id === input.id && item.status === 'needsHuman');
  if (row === undefined)
    return { ok: false, detail: 'уже не в ждунах' };

  if (input.action === 'rejected' && REJECT_REASONS.includes(input.reason as typeof REJECT_REASONS[number]) === false)
    return { ok: false, detail: 'нет причины' };

  await saveDecision({
    id: input.id,
    action: input.action,
    reason: input.reason,
    answers: input.answers,
    row: JSON.stringify(row),
    at: now,
    until: input.action === 'later' ? now + LATER_MS : 0,
  });
  if (input.action === 'approved')
    await rememberCorrections(input.answers);

  if (input.action === 'rejected') {
    await notePassed([{ id: row.id, reason: `разбор: ${input.reason}`, company: row.company, title: row.title }]);
    await dropWaiters([row.id]);
  }

  return { ok: true, detail: input.action === 'approved' ? 'ответы сохранены, отправка — п.8' : 'готово' };
}

export async function undoDecision(id: string): Promise<{ ok: boolean; detail: string }> {
  const decision = await takeDecision(id);
  if (decision === null)
    return { ok: false, detail: 'нечего отменять' };

  if (decision.action === 'rejected' && decision.row.length > 0) {
    const row = JSON.parse(decision.row) as QueueItem;
    await restoreWaiter(row);
    await dropPassed([row.id]);
  }

  return { ok: true, detail: 'вернул' };
}
