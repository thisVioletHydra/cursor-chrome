export function hhCaptchaShown(): boolean {
  const phrases = ['Подтвердите, что вы не робот', 'Текст с картинки'];

  function plain(root: ParentNode | null): string {
    if (root === null)
      return '';

    const chunks: string[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const parent = walker.currentNode.parentElement;
      const tag = parent?.tagName;
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT')
        continue;

      chunks.push(walker.currentNode.textContent || '');
    }

    return chunks.join('\n');
  }

  if (phrases.some(line => plain(document.body).includes(line)))
    return true;

  const nodes = document.querySelectorAll('[role="dialog"], [aria-modal="true"], [data-qa*="captcha" i], [class*="captcha" i], [id*="captcha" i]');
  for (const node of nodes) {
    if (node instanceof HTMLElement === false)
      continue;

    if (node.hidden)
      continue;

    const style = getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden')
      continue;

    const copy = `${plain(node)}${plain(node.shadowRoot)}`;
    if (phrases.some(line => copy.includes(line)))
      return true;

    const name = `${node.getAttribute('class') || ''} ${node.id} ${node.getAttribute('data-qa') || ''}`;
    if (/captcha/i.test(name) === false)
      continue;

    if (node.querySelector('img, canvas') === null)
      continue;

    if (node.querySelector('input, textarea') === null)
      continue;

    return true;
  }

  return false;
}
