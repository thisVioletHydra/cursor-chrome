import type { Provider } from './model.ts';

import { FACTS } from './copy.ts';
import { PING_MS } from './limits.ts';
import { askChain, chainFromEnv } from './model.ts';

export type FormQuestion = {
  entry: string;
  label: string;
};

const FILE = /type="file"|file upload|загруз/i;
const CAPTCHA = /recaptcha|hcaptcha/i;

export async function readForm(url: string): Promise<{ questions: FormQuestion[]; blocked: boolean }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(PING_MS) });
  if (res.ok === false)
    return { questions: [], blocked: true };

  const html = await res.text();
  if (FILE.test(html) || CAPTCHA.test(html))
    return { questions: [], blocked: true };

  return { questions: questionsFrom(html), blocked: false };
}

export function questionsFrom(html: string): FormQuestion[] {
  const questions: FormQuestion[] = [];
  const re = /name="(entry\.\d+)"[\s\S]{0,400}?aria-label="([^"]+)"|aria-label="([^"]+)"[\s\S]{0,400}?name="(entry\.\d+)"/g;
  for (const match of html.matchAll(re)) {
    const entry = match[1] || match[4] || '';
    const label = match[2] || match[3] || '';
    if (entry.length > 0 && label.length > 0)
      questions.push({ entry, label });
  }
  return questions;
}

export async function answerForm(chain: Provider[], questions: FormQuestion[]): Promise<Record<string, string> | null> {
  const list = questions.map(q => `${q.entry}: ${q.label}`).join('\n');
  const prompt = [
    'Ответь на вопросы формы только из фактов. Если факта нет, верни null целиком.',
    FACTS,
    list,
    'JSON объект entry -> короткий ответ, или null.',
  ].join('\n');
  const raw = await askChain(chain, prompt).then(reply => reply.text, () => '');
  if (raw.length === 0 || raw.includes('null'))
    return null;

  const match = raw.match(/\{[\s\S]*\}/);
  if (match === null)
    return null;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>;
  }
  catch {
    return null;
  }
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const value = parsed[question.entry];
    if (typeof value !== 'string' || value.length === 0)
      return null;

    answers[question.entry] = value;
  }

  return answers;
}

export async function submitForm(url: string, answers: Record<string, string>): Promise<boolean> {
  const endpoint = url.includes('formResponse') ? url : `${url.replace(/\/viewform.*/, '')}/formResponse`;
  const body = new URLSearchParams(answers);
  const res = await fetch(endpoint, {
    method: 'POST',
    signal: AbortSignal.timeout(PING_MS),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  return res.ok || res.status === 200 || res.type === 'opaqueredirect';
}

export async function fillKnownForm(url: string): Promise<'sent' | 'human'> {
  const chain = chainFromEnv();
  const form = await readForm(url);
  if (form.blocked || form.questions.length === 0 || chain.length === 0)
    return 'human';

  const answers = await answerForm(chain, form.questions);
  if (answers === null)
    return 'human';

  const ok = await submitForm(url, answers);

  return ok ? 'sent' : 'human';
}
