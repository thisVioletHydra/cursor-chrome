import type { HideDom } from './hide-popup';

export function hideDom(op: string, id: string): HideDom {
  if (onResume())
    return blank(false, true);

  if (op === 'read')
    return shot(true);

  if (op === 'eye')
    return shot(clickEye(id));

  if (op === 'vacancy')
    return shot(clickVacancy());

  if (op === 'wrong')
    return shot(clickWrong());

  if (op === 'ask')
    return shot(clickAsk());

  if (op === 'submit')
    return shot(clickSubmit());

  return blank(false, false);

  function onResume(): boolean {
    return /\/resume(?:_converter|_print)?(?:\/|$)/i.test(location.pathname);
  }

  function blank(ok: boolean, resume: boolean): HideDom {
    return {
      ok,
      resume,
      menuVacancy: false,
      menuEmployer: false,
      dialog: false,
      wrong: false,
      ask: false,
      submit: false,
    };
  }

  function shot(ok: boolean): HideDom {
    const open = reasonDialog();

    return {
      ok,
      resume: false,
      menuVacancy: vacancyButton() !== null,
      menuEmployer: employerOpen(),
      dialog: open !== null,
      wrong: open !== null && wrongOn(open),
      ask: open !== null && askOn(open),
      submit: open !== null && submitButton(open) !== null,
    };
  }

  function shown(node: HTMLElement): boolean {
    if (node.hidden || node.getAttribute('aria-hidden') === 'true')
      return false;

    if (node.closest('[hidden], [aria-hidden="true"]') !== null)
      return false;

    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden')
      return false;

    return node.getClientRects().length > 0;
  }

  function clickEye(vacancyId: string): boolean {
    if (/^\d+$/.test(vacancyId) === false)
      return false;

    const link = document.querySelector(`a[href*="/vacancy/${vacancyId}"]`);
    const card = link?.closest('[data-qa="vacancy-serp__vacancy"]');
    const button = card?.querySelector('button[aria-label="Скрыть"], button[data-qa="vacancy__blacklist-show-add_narrow-card"]');
    if ((button instanceof HTMLElement) === false || shown(button) === false)
      return false;

    button.scrollIntoView({ block: 'center' });
    button.click();

    return true;
  }

  function clickVacancy(): boolean {
    const button = vacancyButton();
    if (button === null)
      return false;

    button.click();

    return true;
  }

  function clickWrong(): boolean {
    const root = reasonDialog();
    if (root === null)
      return false;

    const radio = root.querySelector('input[name="blacklistReason"][value="WRONG_PROFESSION"]')
      ?? document.querySelector('input[name="blacklistReason"][value="WRONG_PROFESSION"]');
    if (radio instanceof HTMLInputElement) {
      const host = radio.closest('label');
      const text = host?.textContent ?? '';
      if (text.length === 0 || text.includes('Не подходит профессия')) {
        radio.click();
        radio.checked = true;
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        host?.click();

        return true;
      }
    }

    const label = smallest(root, 'Не подходит профессия');
    if (label === null)
      return false;

    const owned = (label.closest('label') ?? label).querySelector('input[name="blacklistReason"]');
    if (owned instanceof HTMLInputElement && owned.value !== 'WRONG_PROFESSION')
      return false;

    (label.closest('label') ?? label).click();

    return true;
  }

  function clickAsk(): boolean {
    const root = reasonDialog();
    if (root === null)
      return false;

    const label = smallest(root, 'Больше не спрашивать меня');
    if (label === null)
      return false;

    const host = label.closest('label') ?? label;
    const box = host.querySelector('input[type="checkbox"]');
    if (box instanceof HTMLInputElement) {
      if (box.checked === false)
        box.click();

      return true;
    }

    const role = host.closest('[role="checkbox"]') ?? host.querySelector('[role="checkbox"]');
    if (role instanceof HTMLElement) {
      if (role.getAttribute('aria-checked') !== 'true')
        role.click();

      return true;
    }

    host.click();

    return true;
  }

  function clickSubmit(): boolean {
    const root = reasonDialog();
    if (root === null)
      return false;

    const button = submitButton(root);
    if (button === null)
      return false;

    button.click();

    return true;
  }

  function vacancyButton(): HTMLElement | null {
    const marked = document.querySelector('[data-qa="vacancy__blacklist-menu-add-vacancy"]');
    if (marked instanceof HTMLElement && shown(marked) && companyItem(marked) === false)
      return marked;

    for (const node of document.querySelectorAll('button, [role="menuitem"], [role="button"]')) {
      if ((node instanceof HTMLElement) === false || shown(node) === false || companyItem(node))
        continue;

      if ((node.textContent ?? '').includes('Скрыть эту вакансию'))
        return node;
    }

    return null;
  }

  function employerOpen(): boolean {
    const marked = document.querySelector('[data-qa="vacancy__blacklist-menu-add-employer"]');
    if (marked instanceof HTMLElement && shown(marked))
      return true;

    for (const node of document.querySelectorAll('button, [role="menuitem"], [role="button"]')) {
      if (node instanceof HTMLElement && shown(node) && (node.textContent ?? '').includes('Скрыть вакансии компании'))
        return true;
    }

    return false;
  }

  function companyItem(node: HTMLElement): boolean {
    const qa = node.getAttribute('data-qa') ?? '';
    if (qa.includes('add-employer'))
      return true;

    return (node.textContent ?? '').includes('Скрыть вакансии компании');
  }

  function reasonDialog(): HTMLElement | null {
    for (const node of document.querySelectorAll('[role="dialog"]')) {
      if ((node instanceof HTMLElement) === false || shown(node) === false)
        continue;

      if (dialogTitle(node).includes('Почему скрываете'))
        return node;
    }

    return null;
  }

  function dialogTitle(node: HTMLElement): string {
    const labelled = node.getAttribute('aria-labelledby');
    const fromId = labelled === null ? '' : document.getElementById(labelled)?.textContent ?? '';

    return `${node.textContent ?? ''} ${fromId} ${node.getAttribute('aria-label') ?? ''}`;
  }

  function wrongOn(root: HTMLElement): boolean {
    const radio = root.querySelector('input[name="blacklistReason"][value="WRONG_PROFESSION"]')
      ?? document.querySelector('input[name="blacklistReason"][value="WRONG_PROFESSION"]');

    return radio instanceof HTMLInputElement && radio.checked;
  }

  function askOn(root: HTMLElement): boolean {
    const label = smallest(root, 'Больше не спрашивать меня');
    if (label === null)
      return false;

    const host = label.closest('label') ?? label;
    const box = host.querySelector('input[type="checkbox"]');
    if (box instanceof HTMLInputElement)
      return box.checked;

    const role = host.closest('[role="checkbox"]') ?? host.querySelector('[role="checkbox"]');
    if (role instanceof HTMLElement)
      return role.getAttribute('aria-checked') === 'true';

    return false;
  }

  function submitButton(root: HTMLElement): HTMLElement | null {
    const local = root.querySelector('[data-qa="blacklist-reason-modal-submit"]');
    const node = local instanceof HTMLElement
      ? local
      : document.querySelector('[data-qa="blacklist-reason-modal-submit"]');
    if ((node instanceof HTMLElement) === false || shown(node) === false)
      return null;

    if (node instanceof HTMLButtonElement && node.disabled)
      return null;

    if (node.getAttribute('aria-disabled') === 'true')
      return null;

    return node;
  }

  function smallest(root: ParentNode, text: string): HTMLElement | null {
    let best: HTMLElement | null = null;
    for (const node of root.querySelectorAll('label, button, span, div, p')) {
      if ((node instanceof HTMLElement) === false)
        continue;

      const value = node.textContent ?? '';
      if (value.includes(text) === false)
        continue;

      if (best === null || value.length < (best.textContent ?? '').length)
        best = node;
    }

    return best;
  }
}
