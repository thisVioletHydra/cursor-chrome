const MARK = 'data-qa="vacancy-description"';

export function descriptionText(html: string): string {
  const at = html.indexOf(MARK);
  if (at < 0)
    return '';

  const open = html.lastIndexOf('<', at);
  if (open < 0)
    return '';

  return decode(sliceTag(html.slice(open))).slice(0, 6000);
}

function sliceTag(html: string): string {
  const name = /^<([a-z0-9]+)/i.exec(html)?.[1];
  if (name === undefined)
    return html.slice(0, 20_000);

  const openRe = new RegExp(`<${name}\\b`, 'gi');
  const closeRe = new RegExp(`</${name}>`, 'gi');
  let depth = 0;
  let cursor = 0;
  const end = Math.min(html.length, 80_000);
  while (cursor < end) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    const openAt = nextOpen === null || nextOpen.index >= end ? -1 : nextOpen.index;
    const closeAt = nextClose === null || nextClose.index >= end ? -1 : nextClose.index;
    if (nextOpen !== null && (closeAt < 0 || openAt < closeAt)) {
      if (openAt < 0)
        break;

      depth += 1;
      cursor = openAt + nextOpen[0].length;
      continue;
    }

    if (nextClose === null || closeAt < 0)
      break;

    depth -= 1;
    cursor = closeAt + nextClose[0].length;
    if (depth === 0)
      return html.slice(0, cursor);
  }

  return html.slice(0, end);
}

function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
