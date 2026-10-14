import type { FormQuestion } from './form.ts';
import type { DraftRow, DraftSource } from './store.ts';
import type { VacancyInfo } from './vacancy.ts';
import type { Provider } from '../model/model.ts';

import { closestChoice, isChoice, questionKey } from './form.ts';
import type { AccountFacts } from '../model/copy.ts';
import type { Profile } from './profile.ts';

import { listCanon, listMemory, touchUsed, unlinkedFor } from './memory.ts';
import { fillTemplate, isPersonalQuestion, NEED_HUMAN, profileAnswer } from './profile.ts';
import { embedFromChain, judgeFromChain, matchAnswer } from './semantic.ts';
import { saveDrafts } from './store.ts';
import { FACTS, factsText, notesText, PROFILE_NOTES } from '../model/copy.ts';
import { providerName } from '../model/model.ts';

import timers from 'node:timers/promises';

export type DraftInput = {
  id: string;
  title: string;
  company: string;
  info: VacancyInfo | null;
  questions: FormQuestion[];
  formText: string;
  resume: string;
  // the account's «Профиль»: personal facts and conditional rules; null = not filled yet
  profile?: Profile | null;
  // account facts (rules/notes/resume); undefined = server-wide owner facts (legacy callers)
  facts?: AccountFacts;
};

export type DraftResult = { drafts: DraftRow[]; error: string };

const GAP_MS = 3_000;
const TIMEOUT_MS = 90_000;
const MAX_TOKENS = 6_000;

let line: Promise<unknown> = Promise.resolve();
let lastAt = 0;

// Memory first, then one reasoning call for the rest. Calls are serialised with a gap so a page of
// cards never fans out into a burst against free-tier limits.
export async function draftAnswers(chain: Provider[], input: DraftInput): Promise<DraftResult> {
  const [memory, canon] = await Promise.all([listMemory(), listCanon()]);
  const embed = embedFromChain(chain);
  const judge = judgeFromChain(chain);
  const drafts = new Map<string, DraftRow>();
  const ask: FormQuestion[] = [];
  for (const question of input.questions) {
    const key = questionKey(question.prompt);
    const unlinked = await unlinkedFor(question.prompt);
    const facts = input.info ?? {};
    const found = await matchAnswer(question, { memory, canon, unlinked, judge, embed });
    // canon rule > profile > memory > model; canon answers may use {{profile.x}} / {{vacancy.x}}
    const own = found?.source.kind === 'canon' ? null : profileAnswer(question, input.profile ?? null, facts);
    const hit = own ?? (found ? { ...found, answer: fillTemplate(found.answer, input.profile ?? null, facts) } : null);
    if (hit !== null && hit.answer.trim().length > 0) {
      if (hit.source.kind !== 'profile')
        await touchUsed(hit.source.target);
      drafts.set(key, { key, prompt: question.prompt, answer: hit.answer, missing: false, why: sourceWhy(hit.source), model: hit.source.kind, source: hit.source });
    }
    else if (isPersonalQuestion(question.prompt))
      drafts.set(key, needHuman(question));
    else
      ask.push(question);
  }

  let error = '';
  if (ask.length > 0) {
    const job = line.then(() => askModel(reasoningChain(chain), input, ask));
    line = job.catch(() => null);
    try {
      for (const row of await job) {
        const question = ask.find(item => questionKey(item.prompt) === row.key);
        // post-filter: a model must never supply personal facts
        drafts.set(row.key, question && isPersonalQuestion(question.prompt) ? needHuman(question) : row);
      }
    }
    catch (failure) {
      error = failure instanceof Error ? failure.message : 'модель не ответила';
    }
  }

  const ordered = input.questions.map(question => drafts.get(questionKey(question.prompt)) ?? emptyDraft(question, error));
  await saveDrafts(input.id, ordered.filter(row => row.model.length > 0));

  return { drafts: ordered, error };
}

function needHuman(question: FormQuestion): DraftRow {
  return { key: questionKey(question.prompt), prompt: question.prompt, answer: '', missing: true, why: `${NEED_HUMAN}: личный факт, его нет в профиле и памяти`, model: 'need-human' };
}

function sourceWhy(source: DraftSource): string {
  const where = source.kind === 'canon' ? `канон «${source.from}»` : source.kind === 'profile' ? `профиль «${source.from}»` : `твой ответ на «${source.from}»`;

  return `${where} · ${Math.round(source.score * 100)}% (${source.method})`;
}

function emptyDraft(question: FormQuestion, error: string): DraftRow {
  return { key: questionKey(question.prompt), prompt: question.prompt, answer: '', missing: true, why: error || 'нет черновика', model: '' };
}

export function reasoningChain(chain: readonly Provider[]): Provider[] {
  const rank = (provider: Provider) => {
    if (/gpt-oss/.test(provider.model))
      return 0;

    if (provider.id === 'gemini')
      return 1;

    if (/qwen3|deepseek|glm/.test(provider.model))
      return 2;

    return 3;
  };

  return [...chain].sort((left, right) => rank(left) - rank(right));
}

function reasoningExtra(provider: Provider): Record<string, unknown> {
  if (/gpt-oss/.test(provider.model) || provider.id === 'gemini')
    return { reasoning_effort: 'high' };

  return {};
}

async function askModel(chain: Provider[], input: DraftInput, questions: FormQuestion[]): Promise<DraftRow[]> {
  if (chain.length === 0)
    throw new Error('нет ключа модели');

  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0)
    await timers.setTimeout(wait);

  const prompt = draftPrompt(input, questions);
  const reasons: string[] = [];
  for (const provider of chain) {
    lastAt = Date.now();
    try {
      const text = await call(provider, prompt);

      return parseDrafts(text, questions, `${providerName(provider)} · ${provider.model}`);
    }
    catch (error) {
      reasons.push(`${providerName(provider)}: ${error instanceof Error ? error.message : 'упал'}`);
    }
  }

  throw new Error(`модели не ответили (${reasons.join('; ')})`);
}

async function call(provider: Provider, prompt: string): Promise<string> {
  const res = await fetch(provider.url, {
    method: 'POST',
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { authorization: `Bearer ${provider.key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: provider.model,
      max_tokens: MAX_TOKENS,
      ...reasoningExtra(provider),
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (res.ok === false)
    throw new Error(String(res.status));

  const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };

  return body.choices?.[0]?.message?.content ?? '';
}

export function draftPrompt(input: DraftInput, questions: FormQuestion[]): string {
  const rules = input.facts ? factsText(input.facts) : FACTS;
  const notes = input.facts ? notesText(input.facts) : PROFILE_NOTES;
  const info = input.info;
  const vacancy = [
    `Вакансия: ${input.title} — ${input.company}`,
    info ? `Город: ${info.city}. Формат: ${info.format || 'не указан'}. Зарплата: ${info.salaryText || 'не указана'}.` : '',
    info?.description ? `Описание: ${info.description.slice(0, 3_000)}` : '',
    input.formText ? `Текст формы: ${input.formText.slice(0, 1_500)}` : '',
  ].filter(part => part.length > 0).join('\n');
  const list = questions.map((question, index) => {
    const opts = question.options.length > 0 ? `\n   варианты (ответ слово в слово один из них${question.kind === 'multi' ? ' или несколько через «; »' : ''}): ${question.options.join(' | ')}` : '';

    return `${index + 1}. [${question.kind}${question.required ? ', обязательный' : ''}] ${question.prompt}${opts}`;
  }).join('\n');

  return [
    'Ты готовишь черновики ответов кандидата на вопросы работодателя в отклике на hh.ru. Черновики проверит сам кандидат.',
    'Сначала подумай: что именно спрашивают, какой факт кандидата на это отвечает и есть ли он ниже. Рассуждения не выводи.',
    'Правила: опирайся только на факты и резюме ниже. Ничего не выдумывай: ни опыт, ни цифры, ни технологии, ни гражданство, ни контакты.',
    'Личные факты (город, гражданство, документы, переезд, зарплата, дата выхода, контакты) бери только если они явно есть ниже; иначе answer: "", missing: true, why: "нужен твой ответ". Город вакансии — это не город кандидата.',
    'Если фактов для ответа нет или их не хватает — missing: true, answer: "" (или частичный ответ только из фактов), why: каких фактов не хватает.',
    'Пиши от первого лица, по-русски, коротко и по делу, без приветствий и подписи. Числовые поля — только цифры.',
    rules ? 'Правила кандидата (приоритетнее резюме):' : 'Правил и фактов кандидата нет — личные факты не указывать.',
    rules,
    notes ? `Факты и резюме кандидата:\n${notes}` : '',
    input.resume ? `Резюме с hh:\n${input.resume.slice(0, 6_000)}` : '',
    vacancy,
    `Вопросы:\n${list}`,
    'Верни одной строкой JSON без markdown: {"answers":[{"n":1,"answer":"...","missing":false,"why":"какой факт использован или чего не хватает"}]}',
  ].filter(part => part.length > 0).join('\n\n');
}

export function parseDrafts(raw: string, questions: FormQuestion[], model: string): DraftRow[] {
  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    throw new Error('модель вернула не JSON');

  const parsed = JSON.parse(match[0]) as { answers?: Array<{ n?: unknown; answer?: unknown; missing?: unknown; why?: unknown }> };
  const rows = Array.isArray(parsed.answers) ? parsed.answers : [];

  return questions.map((question, index) => {
    const hit = rows.find(row => Number(row.n) === index + 1) ?? rows[index];
    const answer = typeof hit?.answer === 'string' ? hit.answer.trim() : '';
    const why = typeof hit?.why === 'string' ? hit.why.trim().slice(0, 300) : '';
    const fitted = answer.length > 0 ? closestChoice(question, answer) : '';
    const offList = isChoice(question) && answer.length > 0 && fitted === null;
    const missing = hit?.missing === true || answer.length === 0 || offList;

    return {
      key: questionKey(question.prompt),
      prompt: question.prompt,
      answer: offList ? '' : fitted ?? '',
      missing,
      why: offList ? `ответ не из списка вариантов. ${why}` : why,
      model,
    };
  });
}
