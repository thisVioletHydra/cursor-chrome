import { click } from '../page/actions';

const OFFER = /приняли предложение о работе/i;

export function dismissJobOffer(): boolean {
  const button = jobOfferClose();
  if (button === null)
    return false;

  click(button);

  return true;
}

export function jobOfferClose(root: ParentNode = document): HTMLElement | null {
  const buttons = [...root.querySelectorAll<HTMLElement>('button[data-qa="banner-close"]')];

  return buttons.find(button => offerBanner(button) !== null) ?? null;
}

function offerBanner(button: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = button;
  for (let depth = 0; depth < 12 && node !== null && node !== document.body; depth += 1) {
    if (OFFER.test(node.textContent || ''))
      return node;

    node = node.parentElement;
  }

  return null;
}
