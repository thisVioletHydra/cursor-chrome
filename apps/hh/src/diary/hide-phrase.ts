const ASIDE = new Set([
  '',
  'уже видели',
  'уже в очереди',
  'пересмотр',
  'скрыл, уже видели',
  'не подходит профессия',
]);

export function hidePhrase(status: string | undefined, reason: string): string {
  if (status === 'sent')
    return 'уже откликались';

  if (status === 'needsHuman')
    return 'в ждунах';

  if (status === 'pending')
    return 'в очереди';

  const text = reason.trim().slice(0, 60);
  if (text.length === 0 || ASIDE.has(text))
    return '';

  return `в корзине: ${text}`;
}
