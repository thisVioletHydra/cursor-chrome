import type { Outcome } from '@cursor-chrome/hh';
import type { RequestHandler } from './$types';

import { applyOutcomes, remember } from '@cursor-chrome/hh';
import { json } from '@sveltejs/kit';
import { extLogin } from '$lib/server/ext-auth';

type Row = { id: string; outcome: Outcome; at: number };

export const POST: RequestHandler = async ({ request }) => {
  if (await extLogin(request) === null)
    return json({ error: 'нет' }, { status: 401 });

  const body = await request.json().catch(() => null) as { items?: unknown } | null;
  if (Array.isArray(body?.items) === false)
    return json({ error: 'items' }, { status: 400 });

  const items = body.items.flatMap(asRow);
  if (items.length === 0)
    return json({ ok: true, count: 0 });

  await remember([...new Set(items.map(row => row.id))]);
  await applyOutcomes(items.map(row => ({ id: row.id, outcome: row.outcome, at: row.at })));

  return json({ ok: true, count: items.length });
};

function asRow(value: unknown): Row[] {
  if (typeof value !== 'object' || value === null)
    return [];

  const row = value as Record<string, unknown>;
  const id = typeof row.vacancyId === 'string' ? row.vacancyId.trim() : '';
  if (id.length === 0 || isOutcome(row.state) === false)
    return [];

  const at = typeof row.updatedAt === 'number' && Number.isFinite(row.updatedAt) && row.updatedAt > 0
    ? row.updatedAt
    : Date.now();

  return [{ id, outcome: row.state, at }];
}

function isOutcome(value: unknown): value is Outcome {
  return value === 'invitation' || value === 'discard' || value === 'response';
}
