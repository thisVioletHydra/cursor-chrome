// Negotiations page parsing, ported (read-only) from extension apply/negotiations.ts:
// first HH-Lux-InitialState JSON, then a fallback over [data-qa^="negotiations-item"] cards.
export interface NegotiationRow { vacancyId: string; state: 'invitation' | 'discard' | 'response'; employer: string; title: string; url: string; updatedAt: number }
type Rec = Record<string, unknown>;

const asRec = (v: unknown): Rec | null => (typeof v === 'object' && v !== null ? v as Rec : null);
const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const stateOf = (raw: string): NegotiationRow['state'] => /invit|приглаш/i.test(raw) ? 'invitation' : /discard|reject|decline|отказ/i.test(raw) ? 'discard' : 'response';
const stampOf = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? (v < 1e12 ? v * 1000 : v) : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : 0;
const rawState = (v: unknown) => typeof v === 'string' ? v : text(asRec(v)?.id) || text(asRec(v)?.name) || text(asRec(v)?.code);
const unescape = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function fromRecord(rec: Rec, now: number): NegotiationRow | null {
  const vac = asRec(rec.vacancy);
  const vacancyId = text(vac?.id !== undefined ? String(vac.id) : '') || text(rec.vacancyId !== undefined ? String(rec.vacancyId) : '');
  if (!/^\d+$/.test(vacancyId))
    return null;
  const state = rawState(rec.substate) || rawState(rec.state) || rawState(rec.lastState);
  if (!state)
    return null;
  const emp = asRec(vac?.employer) || asRec(vac?.company) || asRec(rec.employer);
  const stamp = [rec.updatedAt, rec.lastChangeTime, rec.updated_at, rec.createdAt, rec.created_at, rec.date].map(stampOf).find(v => v > 0);
  return { vacancyId, state: stateOf(state), employer: text(emp?.name) || text(rec.employerName) || text(rec.company), title: text(vac?.name) || text(vac?.title) || text(rec.vacancyName) || text(rec.name), url: text(vac?.alternateUrl) || `https://hh.ru/vacancy/${vacancyId}`, updatedAt: stamp ?? now };
}

export function parseNegotiations(html: string, now = Date.now()): NegotiationRow[] {
  const out = new Map<string, NegotiationRow>();
  const add = (r: NegotiationRow | null) => { if (r && !out.has(r.vacancyId)) out.set(r.vacancyId, r); };
  const tpl = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/)?.[1];
  if (tpl) {
    try {
      const walk = (v: unknown, depth: number) => {
        if (depth > 12) return;
        if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return; }
        const r = asRec(v);
        if (!r) return;
        add(fromRecord(r, now));
        for (const x of Object.values(r)) walk(x, depth + 1);
      };
      walk(JSON.parse(unescape(tpl)), 0);
    }
    catch { /* broken JSON → fallback */ }
  }
  if (out.size === 0) {
    for (const chunk of html.split(/data-qa="negotiations-item[^"]*"/).slice(1)) {
      const id = chunk.match(/href="[^"]*\/vacancy\/(\d+)/)?.[1];
      if (!id) continue;
      const body = chunk.slice(0, 4000).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
      const title = chunk.match(/<a[^>]*\/vacancy\/\d+[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '';
      const emp = chunk.match(/<a[^>]*\/employer\/[^>]*>([\s\S]*?)<\/a>/)?.[1]?.replace(/<[^>]*>/g, '').trim() ?? '';
      add({ vacancyId: id, state: /приглашение/i.test(body) ? 'invitation' : /отказ/i.test(body) ? 'discard' : 'response', employer: emp, title, url: `https://hh.ru/vacancy/${id}`, updatedAt: now });
    }
  }
  return [...out.values()];
}
