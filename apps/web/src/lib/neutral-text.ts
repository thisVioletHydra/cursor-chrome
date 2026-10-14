// Старые причины в БД не мигрируем: подменяем только при показе.
const OLD: ReadonlyArray<readonly [RegExp, string]> = [
  [/свои вопросы HH/g, 'свои вопросы площадки'],
  [/лимит откликов hh/g, 'лимит откликов площадки'],
  [/не прочиталась страница hh/g, 'не прочиталась страница площадки'],
  [/нет запиненной вкладки hh/g, 'нет запиненной вкладки площадки'],
  [/hh\.ru просит войти/g, 'площадка просит войти'],
  [/слетел вход на hh\.ru/g, 'слетел вход на площадку'],
];

export function neutralText(text: string | null | undefined): string {
  let out = String(text ?? '');
  for (const [from, to] of OLD)
    out = out.replace(from, to);
  return out;
}
