// Transit context for the server planner: POST /api/ext/next body { context: { profile, letter, canon, memory, facts? } }.
// Kept in memory only while the planner chain runs (like the BYOK headers); never written to disk or logs.
export const CONTEXT_LIMITS = { bodyBytes: 65_536, profileBytes: 32_768, letter: 10_000, canon: 300, memory: 500, facts: 200, text: 2_000 };

export interface TransitContext {
  profile: Record<string, unknown> | null;
  letter: string;
  canon: { title: string; aliases: string[]; answer: string }[];
  memory: { prompt: string; answer: string; human: boolean }[];
  facts: string[];
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && Array.isArray(v) === false;
const text = (v: unknown, max = CONTEXT_LIMITS.text) => (typeof v === 'string' && v.length <= max ? v : null);

// null + reason when the body is not a valid context; caller answers needsHuman, never falls back to stored data
export function parseTransit(raw: string): { ok: true; context: TransitContext } | { ok: false; error: string } {
  if (Buffer.byteLength(raw) > CONTEXT_LIMITS.bodyBytes)
    return { ok: false, error: 'контекст больше 64 КБ' };

  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { return { ok: false, error: 'контекст не JSON' }; }
  const c = isObj(body) ? body.context : undefined;
  if (isObj(c) === false)
    return { ok: false, error: 'нет context' };

  const profile = c.profile === null || c.profile === undefined ? null : c.profile;
  if (profile !== null && (isObj(profile) === false || Buffer.byteLength(JSON.stringify(profile)) > CONTEXT_LIMITS.profileBytes))
    return { ok: false, error: 'profile: объект до 32 КБ' };

  const letter = c.letter === undefined ? '' : text(c.letter, CONTEXT_LIMITS.letter);
  if (letter === null)
    return { ok: false, error: 'letter: строка до 10000' };

  const list = (v: unknown, max: number) => (v === undefined ? [] : Array.isArray(v) && v.length <= max ? v : null);
  const canon = list(c.canon, CONTEXT_LIMITS.canon);
  const memory = list(c.memory, CONTEXT_LIMITS.memory);
  const facts = list(c.facts, CONTEXT_LIMITS.facts);
  if (canon === null || memory === null || facts === null)
    return { ok: false, error: 'canon ≤300, memory ≤500, facts ≤200' };

  const rules = canon.filter(isObj).map(r => ({ title: text(r.title) ?? '', aliases: Array.isArray(r.aliases) ? r.aliases.map(a => text(a, 500)).filter((a): a is string => a !== null).slice(0, 20) : [], answer: text(r.answer) ?? '' })).filter(r => r.title !== '' && r.answer !== '');
  const mem = memory.filter(isObj).map(m => ({ prompt: text(m.prompt, 500) ?? '', answer: text(m.answer) ?? '', human: m.human === true })).filter(m => m.prompt !== '' && m.answer !== '');

  return { ok: true, context: { profile: profile as Record<string, unknown> | null, letter, canon: rules, memory: mem, facts: facts.map(f => text(f, 500)).filter((f): f is string => f !== null) } };
}
