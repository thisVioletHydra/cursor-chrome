// Text normalisation for answer memory: case, ё/е, punctuation, stopwords, a light Russian/English stemmer
// and a few concept groups so that «портфолио», «примеры работ» and «ссылка на GitHub» land together.

const STOP = new Set('а в во вы вам вас ваш ваша ваше ваши вашего вашей вашим ваших да для до же за и из или им их к как ли на над не нет о об от по под при про с со то ты у что это этот эта есть был была укажите пожалуйста напишите опишите расскажите приложите поделитесь какой какая какие каким каких сколько ли можете ли a an the of to in on for and or your you is are do please'.split(' '));

const ENDINGS = 'иями ями ами ого его ому ему ыми ими иях ях ах ией ий ый ой ая яя ое ее ые ие ую юю ов ев ей ом ем ам ям ия ие ть ться ешь ет ют ут ал ил ла ли а я о е ы и у ю ь ing es s'.split(' ').sort((left, right) => right.length - left.length);

// stem → concept tag. Kept tiny on purpose; the semantic layer covers the rest.
// The weight is how sure a shared concept alone makes two questions the same (experience with X ≠ experience with Y).
const CONCEPTS: Array<[string, string[]]> = [
  ['#portfolio', ['портфол', 'пример', 'проект', 'github', 'гитхаб', 'gitlab', 'репозитор', 'кейс', 'portfolio']],
  ['#salary', ['зарплат', 'оплат', 'доход', 'вилк', 'ожидан', 'salary']],
  ['#remote', ['удален', 'удалён', 'remote', 'формат', 'офис', 'гибрид']],
  ['#experience', ['опыт', 'стаж', 'лет', 'experienc']],
  ['#contact', ['связ', 'telegram', 'телеграм', 'контакт']],
  ['#english', ['английск', 'english']],
  ['#test', ['тестов', 'задан', 'задач']],
];

export function stem(word: string): string {
  if (word.length <= 4 || /\d/.test(word))
    return word;

  for (const ending of ENDINGS) {
    if (word.endsWith(ending) && word.length - ending.length >= 3)
      return word.slice(0, -ending.length);
  }

  return word;
}

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function tokens(text: string): string[] {
  return normalizeText(text).split(' ').filter(word => word.length > 1 && STOP.has(word) === false).map(stem);
}

function concepts(stems: readonly string[]): string[] {
  return CONCEPTS.filter(([, roots]) => stems.some(item => roots.some(root => item.startsWith(stem(normalizeText(root)))))).map(([tag]) => tag);
}

const WEIGHT: Record<string, number> = { '#portfolio': 0.75, '#contact': 0.75, '#salary': 0.7, '#english': 0.7, '#remote': 0.5, '#test': 0.5, '#experience': 0.4 };

// max(Dice over stems, strongest shared concept weight), 0..1.
export function lexicalScore(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 || b.length === 0)
    return 0;

  const setB = new Set(b);
  const setA = new Set(a);
  let shared = 0;
  for (const item of setA) {
    if (setB.has(item))
      shared += 1;
  }

  const dice = (2 * shared) / (setA.size + setB.size);
  const right2 = new Set(concepts(b));
  const concept = Math.max(0, ...concepts(a).filter(tag => right2.has(tag)).map(tag => WEIGHT[tag] ?? 0));

  return Math.max(dice, concept);
}

export type QuestionType = 'link' | 'number' | 'yesno' | 'text';

const URL_RE = /(https?:\/\/|www\.|github\.com|gitlab\.com|t\.me\/)\S+/i;

// Coarse question type from the wording. Used for the «Память» filter and the compatibility gate.
export function questionType(prompt: string): QuestionType {
  const text = normalizeText(prompt);
  if (/(ссылк|github|гитхаб|gitlab|портфол|репозитор|url|link|линк)/.test(text))
    return 'link';

  if (/(сколько|лет опыта|стаж|зарплат|ожидани|вилк|salary|how many|years)/.test(text))
    return 'number';

  if (/^(готовы|готов|есть ли|можете|могли бы|согласны|рассматриваете|имеется|are you|do you|can you|have you)/.test(text))
    return 'yesno';

  return 'text';
}

export function hasUrl(text: string): boolean {
  return URL_RE.test(text);
}

// A remembered answer may only fill a question of a compatible type: a link question needs a link,
// a number question needs a digit. Prevents «Ссылка на GitHub» → «Vue; TypeScript».
export function compatibleAnswer(prompt: string, answer: string): boolean {
  const type = questionType(prompt);
  if (type === 'link')
    return hasUrl(answer);

  // Only count questions («сколько лет…») need a digit; salary may be «по рынку».
  if (type === 'number' && /(сколько|лет|стаж|years|how many)/.test(normalizeText(prompt)))
    return /\d/.test(answer) || /^(нет|не|без)/i.test(answer.trim());

  return true;
}

// Word-overlap threshold for a question match (shared by memory matching and the profile).
export const LEXICAL_MIN = 0.6;
