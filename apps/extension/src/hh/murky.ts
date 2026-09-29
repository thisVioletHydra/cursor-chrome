import { compact } from './dom';
import { vacancyBody, vacancyTitle } from './resume';
import { applyRoot } from './screen-questions';

const MARKS: Array<[RegExp, string]> = [
  [/шарад/i, 'шарады'],
  [/ребус/i, 'ребусы'],
  [/головолом/i, 'головоломки'],
  [/цыганщин/i, 'цыганщина'],
  [/загадк/i, 'загадки'],
  [/\bpuzzle\b/i, 'puzzle'],
  [/\briddle\b/i, 'riddle'],
  [/кодовое слово/i, 'кодовое слово'],
  [/если[^.]{0,48}дочитал/i, 'если дочитал'],
  [/прочита(?:йте|л) до конца/i, 'прочитайте до конца'],
];

export function murkyBlock(text: string): { reason: string; hints: string[] } | null {
  const plain = compact(text);
  const hit = MARKS.find(([re]) => re.test(plain));
  if (hit === undefined)
    return null;

  return { reason: 'цыганщина', hints: [hit[1]] };
}

export function vacancyAndFormText(): string {
  const form = applyRoot()?.innerText || '';

  return `${vacancyTitle()}\n${vacancyBody()}\n${form}`;
}
