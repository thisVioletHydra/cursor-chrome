import { click } from '../page/actions';
import { applyMeta, applySucceeded } from './apply-watch';
import { ctaApplied, findSubmit, formErrors, freshSuccess, pageSkip, planOpen } from './apply-click';
import { applyBlocker, formReady, humanPayload } from './apply-detect';
import { asHumanBlock, fillApply } from './apply-fill';
import { ask } from './bridge';
import { until } from './dom';
import { markReviewing, setApplyLock } from './screen-questions';

export type ApplyStatus = 'sent' | 'needsHuman' | 'skip';

export type ApplyResult = {
  ok: boolean;
  status: ApplyStatus;
  reason: string;
  title?: string;
  company?: string;
  url?: string;
  vacancyId?: string;
  hints?: string[];
  navigateTo?: string;
};

let running: Promise<ApplyResult> | null = null;
let hadToast = false;

export function runApply(resume = false): Promise<ApplyResult> {
  if (running)
    return running;

  running = applyOnce(resume).finally(() => {
    running = null;
    setApplyLock(false);
  });

  return running;
}

async function applyOnce(resume: boolean): Promise<ApplyResult> {
  setApplyLock(true);
  hadToast = resume ? hadToast : applySucceeded();
  if (resume)
    await until(() => formReady() || ctaApplied(), 8000);

  const steps: Array<() => Promise<ApplyResult | null>> = [
    async () => hhHostStep(),
    async () => pageSkip(),
    async () => humanOrNull(applyBlocker()),
    async () => openStep(),
    async () => humanOrNull(applyBlocker()),
    async () => fillStep(),
    async () => submitStep(),
  ];
  for (const step of steps) {
    const hit = await step();
    if (hit)
      return hit;
  }

  return fail('не вышло отправить');
}

function hhHostStep(): ApplyResult | null {
  if (/(?:^|\.)hh\.ru$/i.test(location.hostname))
    return null;

  return humanResult({ reason: 'гугл-форма / тест', hints: ['гугл-форма / тест'] });
}

async function openStep(): Promise<ApplyResult | null> {
  const plan = planOpen();
  const dispatch: Record<string, () => Promise<ApplyResult | null>> = {
    ready: async () => null,
    sent: async () => sentResult(),
    skip: async () => fail('reason' in plan ? plan.reason : 'нет кнопки Откликнуться'),
    navigate: async () => ({
      ok: true,
      status: 'skip',
      reason: 'открываю форму',
      navigateTo: 'url' in plan ? plan.url : '',
    }),
    click: async () => clickOpen(plan),
  };

  return (dispatch[plan.kind] || dispatch.skip)();
}

async function clickOpen(plan: ReturnType<typeof planOpen>): Promise<ApplyResult | null> {
  if (plan.kind !== 'click')
    return fail('нет кнопки Откликнуться');

  click(plan.el);
  const ok = await until(() => formReady() || freshSuccess(hadToast), 8000);
  if (freshSuccess(hadToast))
    return sentResult();

  return ok ? null : fail('форма отклика не открылась');
}

async function fillStep(): Promise<ApplyResult | null> {
  const failFill = await fillApply();
  if (failFill === null)
    return null;

  if (failFill.status === 'needsHuman')
    return humanResult(asHumanBlock(failFill));

  return { ok: false, status: 'skip', reason: failFill.reason, ...applyMeta() };
}

async function submitStep(): Promise<ApplyResult> {
  const blocked = applyBlocker();
  if (blocked)
    return humanResult(blocked);

  const btn = findSubmit();
  if (btn === null)
    return fail('нет кнопки отправки');

  click(btn);
  await until(() => freshSuccess(hadToast) || formErrors().length > 0, 8000);
  const errors = formErrors();
  const outcomes: Array<[boolean, () => ApplyResult]> = [
    [errors.length > 0, () => humanResult({ reason: errors[0] || 'ошибка формы', hints: errors.slice(0, 8) })],
    [freshSuccess(hadToast), () => sentResult()],
  ];
  const hit = outcomes.find(([on]) => on);

  return hit ? hit[1]() : fail('нет подтверждения отправки');
}

function humanOrNull(block: ReturnType<typeof applyBlocker>): ApplyResult | null {
  return block ? humanResult(block) : null;
}

function humanResult(block: { reason: string; hints: string[] }): ApplyResult {
  markReviewing();

  return { ok: true, status: 'needsHuman', ...humanPayload(block) };
}

async function sentResult(): Promise<ApplyResult> {
  const meta = applyMeta();
  await ask({ type: 'apply-log', ...meta });

  return { ok: true, status: 'sent', reason: 'отклик отправлен', ...meta };
}

function fail(reason: string): ApplyResult {
  return { ok: false, status: 'skip', reason, ...applyMeta() };
}
