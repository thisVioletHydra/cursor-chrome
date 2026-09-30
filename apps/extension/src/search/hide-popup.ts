export const HIDE_LOOK_MS = 700;
export const HIDE_CLOSE_MS = 1_200;
export const HIDE_POLL_MS = 40;
export const HIDE_POPUP_STUCK = 'попап скрытия не закрылся';

export type HideFace = {
  menuVacancy: boolean;
  menuEmployer: boolean;
  dialog: boolean;
  wrong: boolean;
  ask: boolean;
  submit: boolean;
};

export type HideAction = 'vacancy' | 'wrong' | 'ask' | 'submit';

export type HideStep = {
  phase: 'look' | 'after-menu' | 'form' | 'close' | 'retry' | 'done' | 'stuck';
  retried: boolean;
  form: 0 | 1 | 2;
  retryMenu: boolean;
};

export type HideDom = HideFace & {
  ok: boolean;
  resume: boolean;
};

export function hideStart(): HideStep {
  return { phase: 'look', retried: false, form: 0, retryMenu: false };
}

export function hideBlocks(face: HideFace): boolean {
  return face.menuVacancy || face.menuEmployer || face.dialog;
}

export function hideLimit(phase: HideStep['phase']): number {
  if (phase === 'close')
    return HIDE_CLOSE_MS;

  return HIDE_LOOK_MS;
}

export function stepHide(step: HideStep, face: HideFace, waited: boolean): { step: HideStep; action: HideAction | null } {
  if (step.phase === 'look')
    return lookHide(step, face, waited);

  if (step.phase === 'after-menu')
    return afterMenu(step, face, waited);

  if (step.phase === 'form' || step.phase === 'retry')
    return formHide(step, face, waited);

  if (step.phase === 'close')
    return closeHide(step, face, waited);

  return { step, action: null };
}

export function hideFaceOf(raw: unknown): HideFace | 'resume' | null {
  if (typeof raw !== 'object' || raw === null)
    return null;

  if (flag(raw, 'resume'))
    return 'resume';

  if ('menuVacancy' in raw === false || 'dialog' in raw === false)
    return null;

  return {
    menuVacancy: flag(raw, 'menuVacancy'),
    menuEmployer: flag(raw, 'menuEmployer'),
    dialog: flag(raw, 'dialog'),
    wrong: flag(raw, 'wrong'),
    ask: flag(raw, 'ask'),
    submit: flag(raw, 'submit'),
  };
}

export function hideClickOk(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null)
    return false;

  if (flag(raw, 'resume'))
    return false;

  return flag(raw, 'ok');
}

function lookHide(step: HideStep, face: HideFace, waited: boolean): { step: HideStep; action: HideAction | null } {
  if (face.dialog)
    return next(step, { phase: 'form', form: 0 }, null);

  if (face.menuVacancy)
    return next(step, { phase: 'after-menu' }, 'vacancy');

  if (face.menuEmployer && waited)
    return giveUp(step);

  if (waited)
    return next(step, { phase: 'done' }, null);

  return { step, action: null };
}

function afterMenu(step: HideStep, face: HideFace, waited: boolean): { step: HideStep; action: HideAction | null } {
  if (face.dialog)
    return next(step, { phase: 'form', form: 0 }, null);

  if (hideBlocks(face) === false)
    return next(step, { phase: 'close' }, null);

  if (waited)
    return giveUp(step);

  return { step, action: null };
}

function formHide(step: HideStep, face: HideFace, waited: boolean): { step: HideStep; action: HideAction | null } {
  if (hideBlocks(face) === false)
    return next(step, { phase: 'done' }, null);

  if (step.phase === 'retry' && face.menuVacancy && step.retryMenu === false)
    return next(step, { retryMenu: true }, 'vacancy');

  if (face.dialog === false) {
    if (waited)
      return giveUp(step);

    return { step, action: null };
  }

  if (step.form === 0)
    return next(step, { form: 1 }, 'wrong');

  if (step.form === 1)
    return next(step, { form: 2 }, 'ask');

  if (face.submit)
    return next(step, { phase: 'close', form: 0 }, 'submit');

  if (waited)
    return giveUp(step);

  return { step, action: null };
}

function closeHide(step: HideStep, face: HideFace, waited: boolean): { step: HideStep; action: HideAction | null } {
  if (hideBlocks(face) === false)
    return next(step, { phase: 'done' }, null);

  if (waited)
    return giveUp(step);

  return { step, action: null };
}

function giveUp(step: HideStep): { step: HideStep; action: HideAction | null } {
  if (step.retried || step.phase === 'retry')
    return next(step, { phase: 'stuck' }, null);

  return next(step, { phase: 'retry', retried: true, form: 0, retryMenu: false }, null);
}

function next(step: HideStep, patch: Partial<HideStep>, action: HideAction | null): { step: HideStep; action: HideAction | null } {
  return { step: { ...step, ...patch }, action };
}

function flag(raw: object, key: string): boolean {
  if (key in raw === false)
    return false;

  return Reflect.get(raw, key) === true;
}
