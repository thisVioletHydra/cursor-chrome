import type { FormQuestion } from './form.ts';
import type { DraftRow, DraftSource } from './store.ts';

import { closestChoice, isChoice, questionKey } from './form.ts';
import { listCanon, listMemory, unlinkedFor } from './memory.ts';
import type { Embed, Judge } from './semantic.ts';

import { matchAnswer } from './semantic.ts';
import { readDrafts, readWaiterForms, reviewDb, saveDrafts } from './store.ts';

export const RECHECK_KEY = 'drafts_recheck_v4';

export type RecheckReport = { cards: number; updated: number; dropped: number; filled: number };

function textQuestion(prompt: string): FormQuestion {
  return { prompt, kind: 'text', options: [], choices: [], multi: false, required: false, fieldKey: '' };
}

// Re-run memory/canon matching (lexical only, no model calls) over saved drafts with today's rules:
// type compatibility, raised thresholds, closest-option mapping. Stale memory/canon drafts are replaced
// or dropped; empty choice drafts are filled from memory when an option now fits; model drafts on
// choice questions are snapped to the closest option.
export async function recheckDrafts(semantic: { judge?: Judge; embed?: Embed } = {}): Promise<RecheckReport> {
  const opened = await reviewDb();
  const ids = [...new Set([
    ...(opened.prepare('SELECT DISTINCT id FROM review_draft').all() as Array<{ id: number }>).map(row => String(row.id)),
    ...(opened.prepare('SELECT id FROM waiter_form').all() as Array<{ id: number }>).map(row => String(row.id)),
  ])];
  const [forms, drafts, memory, canon] = await Promise.all([readWaiterForms(ids), readDrafts(ids), listMemory(), listCanon()]);
  const report: RecheckReport = { cards: 0, updated: 0, dropped: 0, filled: 0 };
  const drop = opened.prepare('DELETE FROM review_draft WHERE id = ? AND q_key = ?');
  for (const id of ids) {
    const rows = drafts.get(id) ?? [];
    const questions = forms.get(id)?.questions ?? rows.map(row => textQuestion(row.prompt));
    const next: DraftRow[] = [];
    let touched = false;
    for (const question of questions) {
      const key = questionKey(question.prompt);
      const old = rows.find(row => row.key === key || row.prompt === question.prompt);
      if (old?.source?.kind === 'profile' || old?.model === 'need-human')
        continue; // profile answers are recomputed on ↻ from the account, not from memory

      const fromStore = old?.source !== undefined;
      if (old !== undefined && fromStore === false && old.answer.length > 0) {
        const snapped = isChoice(question) ? closestChoice(question, old.answer) : old.answer;
        if (snapped !== null && snapped !== old.answer) {
          next.push({ ...old, answer: snapped });
          report.updated += 1;
          touched = true;
        }
        continue;
      }

      const hit = await matchAnswer(question, { memory, canon, unlinked: await unlinkedFor(question.prompt), ...semantic });
      if (hit !== null) {
        if (old?.answer !== hit.answer || old?.source?.target !== hit.source.target) {
          next.push({ key: old?.key ?? key, prompt: question.prompt, answer: hit.answer, missing: false, why: whyOf(hit.source), model: hit.source.kind, source: hit.source });
          if (old === undefined || old.answer.length === 0)
            report.filled += 1;
          else
            report.updated += 1;
          touched = true;
        }
      }
      else if (fromStore && old) {
        drop.run(Number(id), old.key);
        report.dropped += 1;
        touched = true;
      }
    }
    if (next.length > 0)
      await saveDrafts(id, next);
    if (touched)
      report.cards += 1;
  }

  return report;
}

function whyOf(source: DraftSource): string {
  const where = source.kind === 'canon' ? `канон «${source.from}»` : `твой ответ на «${source.from}»`;

  return `${where} · ${Math.round(source.score * 100)}% · ${source.method}`;
}

// One-off maintenance for drafts saved before the matching fix; remembered in review_meta.
export async function recheckDraftsOnce(semantic: { judge?: Judge; embed?: Embed } = {}): Promise<RecheckReport | null> {
  const opened = await reviewDb();
  if (opened.prepare('SELECT 1 FROM review_meta WHERE key = ?').get(RECHECK_KEY) !== undefined)
    return null;

  const report = await recheckDrafts(semantic);
  opened.prepare('INSERT OR REPLACE INTO review_meta (key, value) VALUES (?, ?)').run(RECHECK_KEY, JSON.stringify({ at: Date.now(), ...report }));

  return report;
}
