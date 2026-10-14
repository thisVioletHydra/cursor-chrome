import type { FormQuestion } from './form.ts';
import type { CanonAnswer, MemoryRow } from './memory.ts';
import type { DraftSource } from './store.ts';
import type { Provider } from '../model/model.ts';

import { closestChoice, questionKey } from './form.ts';
import { cachedScore, cachedVector, cacheScore, cacheVector } from './memory.ts';
import { compatibleAnswer, lexicalScore } from './normalize.ts';
import { completion } from '../model/model.ts';

export type Candidate = { target: string; kind: 'memory' | 'canon'; text: string; from: string; answer: string; human?: boolean };

export type Match = { answer: string; source: DraftSource };

export type Judge = (question: string, texts: string[]) => Promise<number[]>;

export type Embed = { model: string; vectors: (texts: string[]) => Promise<number[][]> };

export type MatchContext = { memory: MemoryRow[]; canon: CanonAnswer[]; unlinked: Set<string>; judge?: Judge; embed?: Embed };

import { LEXICAL_MIN } from './normalize.ts';

export { LEXICAL_MIN };
export const EMBED_MIN = 0.82;
export const JUDGE_MIN = 0.8;
const JUDGE_TOP = 20;

export function candidatesOf(ctx: Pick<MatchContext, 'memory' | 'canon'>): Candidate[] {
  const canon = ctx.canon.flatMap(row => [row.title, ...row.aliases].map(text => ({ target: `c:${row.id}`, kind: 'canon' as const, text, from: row.title, answer: row.answer })));
  const memory = ctx.memory.map(row => ({ target: `m:${row.key}`, kind: 'memory' as const, text: row.prompt, from: row.prompt, answer: row.answer, human: row.human === true }));

  return [...canon, ...memory];
}

type Scored = Candidate & { score: number; method: string; ok: boolean };

// Canonical answers win over memory whenever one passes its threshold; then the best memory hit.
export async function matchAnswer(question: FormQuestion, ctx: MatchContext): Promise<Match | null> {
  const pool = candidatesOf(ctx)
    .filter(item => ctx.unlinked.has(item.target) === false && compatibleAnswer(question.prompt, item.answer))
    .flatMap((item) => {
      const answer = closestChoice(question, item.answer);

      return answer === null ? [] : [{ ...item, answer }];
    });
  if (pool.length === 0)
    return null;

  const scored = await scoreAll(question.prompt, pool, ctx);
  const best = (kind: Candidate['kind'], human = false) => scored.filter(item => item.kind === kind && item.ok && (human === false || item.human === true)).sort((left, right) => right.score - left.score)[0];
  // rule > Roman's own correction > older memory
  const hit = best('canon') ?? best('memory', true) ?? best('memory');
  if (hit === undefined)
    return null;

  return { answer: hit.answer, source: { kind: hit.kind, target: hit.target, from: hit.from, score: Math.round(hit.score * 100) / 100, method: hit.method, ...(hit.human ? { human: true } : {}) } };
}

async function scoreAll(prompt: string, pool: Candidate[], ctx: MatchContext): Promise<Scored[]> {
  const key = questionKey(prompt);
  const scored: Scored[] = pool.map((item) => {
    if (questionKey(item.text) === key)
      return { ...item, score: 1, method: 'точное', ok: true };

    const score = lexicalScore(prompt, item.text);

    return { ...item, score, method: 'слова', ok: score >= LEXICAL_MIN };
  });
  // A word match is enough; the semantic layers only run when words found nothing.
  if (scored.some(item => item.ok))
    return scored;

  const embedded = ctx.embed ? await withEmbeddings(prompt, scored, ctx.embed) : scored;
  if (embedded.some(item => item.ok) || ctx.judge === undefined)
    return embedded;

  return withJudge(prompt, embedded, ctx.judge);
}

async function withEmbeddings(prompt: string, scored: Scored[], embed: Embed): Promise<Scored[]> {
  try {
    const texts = [prompt, ...new Set(scored.map(item => item.text))];
    const vectors = await vectorsFor(texts, embed);
    const base = vectors.get(prompt);
    if (base === undefined)
      return scored;

    return scored.map((item) => {
      const vec = vectors.get(item.text);
      const sim = vec ? cosine(base, vec) : 0;

      return sim >= EMBED_MIN && sim > item.score ? { ...item, score: sim, method: `эмбеддинги ${embed.model}`, ok: true } : item;
    });
  }
  catch {
    return scored;
  }
}

async function vectorsFor(texts: string[], embed: Embed): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  const missing: string[] = [];
  for (const text of texts) {
    const cached = await cachedVector(text, embed.model);
    if (cached)
      out.set(text, cached);
    else
      missing.push(text);
  }

  if (missing.length > 0) {
    const fresh = await embed.vectors(missing);
    for (const [index, text] of missing.entries()) {
      const vec = fresh[index];
      if (vec) {
        out.set(text, vec);
        await cacheVector(text, embed.model, vec);
      }
    }
  }

  return out;
}

async function withJudge(prompt: string, scored: Scored[], judge: Judge): Promise<Scored[]> {
  const top = [...scored].filter(item => item.ok === false).sort((left, right) => right.score - left.score).slice(0, JUDGE_TOP);
  const ask: Scored[] = [];
  const judged = new Map<string, number>();
  for (const item of top) {
    const cached = await cachedScore(prompt, item.target, 'llm');
    if (cached === null)
      ask.push(item);
    else
      judged.set(item.target, cached);
  }

  if (ask.length > 0) {
    try {
      const scores = await judge(prompt, ask.map(item => item.text));
      for (const [index, item] of ask.entries()) {
        const value = Math.min(1, Math.max(0, Number(scores[index] ?? 0)));
        judged.set(item.target, value);
        await cacheScore(prompt, item.target, 'llm', value);
      }
    }
    catch {
      return scored;
    }
  }

  return scored.map((item) => {
    const value = judged.get(item.target);

    return value !== undefined && value >= JUDGE_MIN && value > item.score ? { ...item, score: value, method: 'LLM', ok: true } : item;
  });
}

export function cosine(left: readonly number[], right: readonly number[]): number {
  let dot = 0;
  let a = 0;
  let b = 0;
  for (const [index, value] of left.entries()) {
    const other = right[index] ?? 0;
    dot += value * other;
    a += value * value;
    b += other * other;
  }

  return a === 0 || b === 0 ? 0 : dot / Math.sqrt(a * b);
}

const EMBED_MODELS: Partial<Record<string, string>> = { gemini: 'gemini-embedding-001', mistral: 'mistral-embed' };

// Embeddings only with a key that is already configured (gemini / mistral in the model chain).
export function embedFromChain(chain: readonly Provider[]): Embed | undefined {
  const provider = chain.find(item => EMBED_MODELS[item.id] !== undefined && item.key.length > 0);
  const model = provider ? EMBED_MODELS[provider.id] : undefined;
  if (provider === undefined || model === undefined)
    return undefined;

  const url = provider.url.replace(/chat\/completions$/, 'embeddings');

  return {
    model,
    vectors: async (texts) => {
      const res = await fetch(url, {
        method: 'POST',
        signal: AbortSignal.timeout(20_000),
        headers: { authorization: `Bearer ${provider.key}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model, input: texts }),
      });
      if (res.ok === false)
        throw new Error(`embeddings ${res.status}`);

      const body = await res.json() as { data?: Array<{ embedding?: number[] }> };

      return (body.data ?? []).map(row => row.embedding ?? []);
    },
  };
}

// LLM fallback with the same chain as draft generation (Groq preferred, else the first keyed provider):
// the model picks the best remembered question and a confidence; the others score 0.
export function judgeFromChain(chain: readonly Provider[]): Judge | undefined {
  const provider = chain.find(item => item.id === 'groq' && item.key.length > 0) ?? chain.find(item => item.key.length > 0 && item.url.length > 0);
  if (provider === undefined)
    return undefined;

  return async (question, texts) => {
    const list = texts.map((text, index) => `${index + 1}. ${text}`).join('\n');
    const prompt = [
      'Новый вопрос работодателя и список вопросов, на которые кандидат уже отвечал.',
      'Выбери один вопрос из списка, который спрашивает о том же (тот же смысл, тот же факт: перефразировка, синоним, другой порядок слов), и оцени уверенность.',
      'Если ни один не подходит, верни best = 0.',
      `Новый вопрос: ${question}`,
      `Список:\n${list}`,
      'Верни только JSON: {"best": номер или 0, "confidence": 0.0..1.0}',
    ].join('\n');
    const text = await completion(provider, prompt, { timeoutMs: 20_000, maxTokens: 400 });
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = match ? JSON.parse(match[0]) as { scores?: unknown; best?: unknown; confidence?: unknown } : {};

    return judgeScores(parsed, texts.length);
  };
}

// {"best":n,"confidence":c} → per-candidate scores (only the chosen one gets c). Old {"scores":[…]} still accepted.
export function judgeScores(parsed: { scores?: unknown; best?: unknown; confidence?: unknown }, count: number): number[] {
  if (Array.isArray(parsed.scores))
    return parsed.scores.map(Number);

  const best = Number(parsed.best);
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence ?? 0) || 0));

  return Array.from({ length: count }, (_, index) => (index + 1 === best ? confidence : 0));
}
