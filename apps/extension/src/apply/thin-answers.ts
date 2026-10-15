// Thin hh_apply params from the planner: answers may carry service keys (`__resumeKind`) that steer the form
// and must never be typed into a question. Pure, shared by background and tests.
export type ThinResumeKind = 'frontend' | 'fullstack';

export function splitThinAnswers(params: unknown): { resumeKind: ThinResumeKind | null; answers: Record<string, string> } {
  const raw = params !== null && typeof params === 'object' ? (params as { answers?: unknown }).answers : null;
  const answers: Record<string, string> = {};
  let resumeKind: ThinResumeKind | null = null;
  if (raw === null || typeof raw !== 'object')
    return { resumeKind, answers };
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === '__resumeKind') {
      if (value === 'frontend' || value === 'fullstack')
        resumeKind = value;
      continue;
    }
    if (key.startsWith('__'))
      continue; // other service keys: never an answer
    if (typeof value === 'string')
      answers[key] = value;
  }
  return { resumeKind, answers };
}
