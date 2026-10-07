import { WEEK_MS, type PassedRow, type QueueItem } from '@cursor-chrome/hh';

const when = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Bishkek', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const GENERIC = new Set(['вопросы работодателя', 'вопросы работодателя, обязательные поля']);

function waitWhy(hints: string[] | undefined): string {
  const rows = (hints ?? []).map(row => row.trim()).filter(row => row.length > 0);
  const specific = rows.filter(row => GENERIC.has(row) === false);

  return (specific.length > 0 ? specific : rows).join(' · ');
}

export function boardFrom(queue: QueueItem[], passed: PassedRow[], now = Date.now()) {
  const waiting = queue.filter(row => row.status === 'needsHuman' && now - (row.doneAt ?? row.at) < WEEK_MS);
  const clicks = queue.filter(row => row.status === 'sent');

  return {
    accepted: clicks.length,
    waiting: waiting.length,
    stale: 0,
    rows: [...clicks, ...waiting].map((row) => {
      const at = row.doneAt ?? row.at;

      return {
        id: row.id,
        company: row.company,
        title: row.title,
        url: row.url,
        status: row.status,
        reason: row.status === 'needsHuman' ? waitWhy(row.hints) : '',
        at,
        when: when.format(at),
      };
    }),
    passed: passed.map(row => ({
      id: row.id,
      company: row.company,
      title: row.title,
      url: `https://hh.ru/vacancy/${row.id}`,
      reason: row.reason,
      at: row.at,
      when: when.format(row.at),
    })),
  };
}
