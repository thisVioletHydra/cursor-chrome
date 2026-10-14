// Display-only filter for the popup/overlay history. Never writes storage: Roman's saved records stay as they are.
// - no link to the admin → nothing is shown as current;
// - records of another account are hidden (records without owner = the owner account);
// - duplicates collapse by vacancy id (from the field or the url);
// - the hh page heading «Отклик на вакансию» is not a vacancy name.
export const DEFAULT_OWNER = 'thisVioletHydra';
const GENERIC_TITLE = /^отклик на вакансию$/i;

export type ViewItem = { title: string; company: string; url: string; vacancyId: string; sentAt?: number; status?: string; hints?: string[]; owner?: string };

export function vacancyIdFromUrl(url: string): string {
  const m = /[?&]vacancyId=(\d+)/.exec(url) ?? /\/vacancy\/(\d+)/.exec(url);
  return m?.[1] ?? '';
}

export function ownerOf(item: { owner?: string }): string {
  return (item.owner || DEFAULT_OWNER).toLowerCase();
}

export function displayTitle(item: ViewItem): string {
  const title = item.title.trim();
  if (title.length > 0 && GENERIC_TITLE.test(title) === false)
    return title;
  // only with a stored id: «убрать» matches id-less rows by title, so their title must stay as stored
  return item.vacancyId ? `вакансия ${item.vacancyId}` : title;
}

function keyOf(item: ViewItem): string {
  const id = item.vacancyId || vacancyIdFromUrl(item.url);
  if (id)
    return `${item.status ?? 'sent'}:id:${id}`;
  return `${item.status ?? 'sent'}:t:${item.title.trim()}|${item.company.trim()}|${item.hints?.[0] ?? ''}`;
}

export function viewItems<T extends ViewItem>(items: T[], view: { linked: boolean; login: string }): T[] {
  if (view.linked === false)
    return [];
  const me = (view.login || DEFAULT_OWNER).toLowerCase();
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    if (ownerOf(item) !== me)
      continue;
    const key = keyOf(item);
    if (seen.has(key))
      continue;
    seen.add(key);
    out.push({ ...item, title: displayTitle(item) });
  }
  return out;
}
