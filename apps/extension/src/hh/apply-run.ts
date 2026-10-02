import { click } from '../page/actions';
import { budgetSec, waitMark, waitPulse, type WaitMark } from '../pilot/wait-pulse';
import { applyMeta, applySucceeded } from './apply-watch';
import { ctaApplied, findSubmit, formErrors, freshSuccess, pageSkip, planOpen, relocationConfirm } from './apply-click';
import { applyBlocker, captchaOnPage, formReady, humanPayload } from './apply-detect';
import { asHumanBlock, fillApply } from './apply-fill';
import { ask } from './bridge';
import { sleep, until } from './dom';
import { noteLive } from './live-log';
import { murkyBlock, vacancyAndFormText } from './murky';
import { employerQuestionnaire, markReviewing, setApplyLock } from './screen-questions';

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
let abroadNoted = false;

const ANSWER_WAIT = waitMark({
  id: 'apply.answer',
  human: 'ответ hh',
  budget: 8,
  next: 'apply.done',
  hold: true,
});

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
  abroadNoted = false;
  hadToast = resume ? hadToast : applySucceeded();
  if (resume)
    await until(() => formReady() || ctaApplied() || employerQuestionnaire() !== null, 8000);

  const steps: Array<() => Promise<ApplyResult | null>> = [
    async () => humanOrNull(captchaOnPage()),
    async () => hhHostStep(),
    async () => pageSkip(),
    async () => murkyStep(),
    async () => humanOrNull(applyBlocker()),
    async () => openStep(),
    async () => murkyStep(),
    async () => humanOrNull(applyBlocker()),
    async () => fillStep(),
    async () => submitStep(),
  ];
  for (const step of steps) {
    acceptAbroad();
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
  let plan = planOpen();
  if (plan.kind === 'skip' && plan.reason === 'нет кнопки Откликнуться') {
    await until(() => {
      plan = planOpen();

      return plan.kind !== 'skip' || employerQuestionnaire() !== null;
    }, 8_000);
    const asked = askedResult();
    if (asked)
      return asked;

    plan = planOpen();
  }

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

  const before = askedResult();
  if (before)
    return before;

  await noteLive('apply-run.ts · жму Откликнуться');
  const pause = between(700, 2_600);
  await beat(pause, () => employerQuestionnaire() !== null, waitMark({
    id: 'apply.pause',
    human: 'перед кликом',
    budget: budgetSec(pause),
    next: 'apply.click',
    hold: true,
  }));
  const mid = askedResult();
  if (mid)
    return mid;

  click(plan.el);
  const ok = await beat(8_000, () => {
    acceptAbroad();

    return employerQuestionnaire() !== null || formReady() || freshSuccess(hadToast);
  }, waitMark({
    id: 'apply.form',
    human: 'форма отклика',
    budget: 8,
    next: 'apply.fill',
    hold: true,
  }));
  const after = askedResult();
  if (after)
    return after;

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

  await noteLive('apply-run.ts · отправляю отклик');
  const pause = between(900, 3_200);
  await beat(pause, () => employerQuestionnaire() !== null, waitMark({
    id: 'apply.pause',
    human: 'перед отправкой',
    budget: budgetSec(pause),
    next: 'apply.send',
    hold: true,
  }));
  const paused = askedResult();
  if (paused)
    return paused;

  click(btn);
  await noteLive('apply-run.ts · жду ответ hh');
  await beat(8_000, () => {
    acceptAbroad();

    return employerQuestionnaire() !== null || freshSuccess(hadToast) || formErrors().length > 0;
  }, ANSWER_WAIT);
  const asked = askedResult();
  if (asked)
    return asked;

  const stepButton = btn.matches('[data-qa*="response-submit"]') === false;
  if (stepButton && freshSuccess(hadToast) === false && formErrors().length === 0 && formReady()) {
    const filled = await fillStep();
    if (filled)
      return filled;

    const again = findSubmit();
    if (again !== null) {
      click(again);
      await beat(8_000, () => {
        acceptAbroad();

        return employerQuestionnaire() !== null || freshSuccess(hadToast) || formErrors().length > 0;
      }, ANSWER_WAIT);
    }
  }
  const afterAgain = askedResult();
  if (afterAgain)
    return afterAgain;

  const errors = formErrors();
  const outcomes: Array<[boolean, () => ApplyResult]> = [
    [errors.length > 0, () => humanResult({ reason: errors[0] || 'ошибка формы', hints: errors.slice(0, 8) })],
    [freshSuccess(hadToast), () => sentResult()],
  ];
  const hit = outcomes.find(([on]) => on);

  return hit ? hit[1]() : fail('нет подтверждения отправки');
}

function murkyStep(): ApplyResult | null {
  const block = murkyBlock(vacancyAndFormText());
  if (block === null)
    return null;

  noteLive('apply-run.ts · форма мутная, в ждуны');

  return humanResult(block);
}

function humanOrNull(block: ReturnType<typeof applyBlocker>): ApplyResult | null {
  return block ? humanResult(block) : null;
}

function acceptAbroad(): void {
  const button = relocationConfirm();
  if (button === null)
    return;

  click(button);
  if (abroadNoted)
    return;

  abroadNoted = true;
  void noteLive('apply-run.ts · другая страна, всё равно откликнуться');
}

function askedResult(): ApplyResult | null {
  const captcha = captchaOnPage();
  if (captcha)
    return humanResult(captcha);

  const block = employerQuestionnaire();
  if (block === null)
    return null;

  return humanResult(block);
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

function between(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1));
}

async function beat(ms: number, done: () => boolean, mark: WaitMark): Promise<boolean> {
  const end = Date.now() + ms;
  let sec = 0;
  let next = 0;
  while (Date.now() < end) {
    if (done())
      return true;

    if (Date.now() >= next) {
      sec += 1;
      next = Date.now() + 1000;
      await noteLive(waitPulse(mark, sec));
    }

    await sleep(150);
  }

  return done();
}

function fail(reason: string): ApplyResult {
  return { ok: false, status: 'skip', reason, ...applyMeta() };
}
