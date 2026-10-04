import type { ChannelPost } from '../channel-post';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 45;
const CACHE_MS = 10 * 60 * 1000;
const NAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

const cached = new Map<string, { at: number; posts: ChannelPost[] }>();
const pending = new Map<string, Promise<ChannelPost[]>>();

export function channelName(input: string): string | null {
  const text = input.trim();
  const fromAt = text.match(/^@([A-Za-z][A-Za-z0-9_]{3,31})$/)?.[1];
  if (fromAt)
    return fromAt.toLowerCase();

  if (NAME.test(text))
    return text.toLowerCase();

  return nameFromUrl(text);
}

export function channelProblem(input: string): string {
  const text = input.trim();
  if (text === '')
    return 'Вставь ссылку на канал или группу.';

  if (/joinchat/i.test(text) || /t\.me\/\+/i.test(text) || text.startsWith('+'))
    return 'Закрытую ссылку не прочитать. Нужен открытый адрес t.me/имя.';

  if (channelName(text) === null)
    return 'Нужна ссылка вида t.me/имя.';

  return '';
}

export function channelWeek(name: string): Promise<ChannelPost[]> {
  const key = name.toLowerCase();
  const hit = cached.get(key);
  if (hit !== undefined && Date.now() - hit.at < CACHE_MS)
    return Promise.resolve(hit.posts);

  const running = pending.get(key);
  if (running !== undefined)
    return running;

  const job = pullWeek(key).then((posts) => {
    cached.set(key, { at: Date.now(), posts });
    return posts;
  }, (error: unknown) => {
    throw error;
  }).finally(() => {
    pending.delete(key);
  });
  pending.set(key, job);

  return job;
}

async function pullWeek(channel: string): Promise<ChannelPost[]> {
  const cutoff = Date.now() - WEEK_MS;
  const posts: ChannelPost[] = [];
  const seen = new Set<number>();
  let before: number | null = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = before === null
      ? `https://t.me/s/${channel}`
      : `https://t.me/s/${channel}?before=${before}`;
    const html = await readPage(url);
    const batch = parsePage(html, channel).filter(post => seen.has(post.id) === false);
    if (page === 0 && batch.length === 0)
      throw new Error('открытой ленты нет');

    if (batch.length === 0)
      break;

    let crossed = false;
    for (const post of batch) {
      seen.add(post.id);
      if (post.at < cutoff) {
        crossed = true;
        continue;
      }

      posts.push(post);
    }

    const oldest = batch.reduce((min, post) => Math.min(min, post.id), batch[0]?.id ?? 0);
    if (crossed || oldest === before)
      break;

    before = oldest;
  }

  posts.sort((left, right) => right.at - left.at || right.id - left.id);

  return posts;
}

async function readPage(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { 'user-agent': 'Mozilla/5.0', accept: 'text/html' },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.ok === false)
    throw new Error('канал не открылся');

  return response.text();
}

function parsePage(html: string, channel: string): ChannelPost[] {
  return html.split('tgme_widget_message_wrap').slice(1).flatMap(chunk => parsePost(channel, chunk));
}

function parsePost(channel: string, chunk: string): ChannelPost[] {
  const found = chunk.match(/data-post="([^"/]+)\/(\d+)"/);
  const id = Number(found?.[2] ?? '');
  const at = Date.parse(chunk.match(/datetime="([^"]+)"/)?.[1] ?? '');
  if (keptPost(channel, found?.[1], id, at) === false)
    return [];

  const raw = chunk.match(/js-message_text[^>]*>([\s\S]*?)<\/div>/)?.[1] ?? '';
  const apply = firstLink(raw, channel);
  const text = plain(raw);
  const title = line(text, 0).replace(/^[^A-Za-zА-Яа-я0-9]+/u, '').trim();
  const company = shown(field(text, 'Company'));
  const location = shown(field(text, 'Location'));
  const salary = shown(field(text, 'Salary'));
  const description = shown(field(text, 'Description'));
  const rest = text.split('\n').slice(1).join('\n');

  return [{
    id,
    at,
    title: title || 'пост',
    company,
    location,
    salary,
    description: description || (company ? '' : rest),
    apply,
    post: `https://t.me/${channel}/${id}`,
  }];
}

function keptPost(channel: string, slug: string | undefined, id: number, at: number): boolean {
  if (slug?.toLowerCase() !== channel)
    return false;

  if (Number.isInteger(id) === false || id <= 0)
    return false;

  return Number.isNaN(at) === false;
}

function nameFromUrl(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text.includes('://') ? text : `https://${text}`);
  }
  catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  if (host !== 't.me' && host !== 'telegram.me')
    return null;

  const parts = url.pathname.split('/').filter(Boolean);
  const head = parts[0] ?? '';
  if (head === 's')
    return cleanName(parts[1] ?? '');

  if (head === 'joinchat' || head.startsWith('+'))
    return null;

  return cleanName(head);
}

function cleanName(value: string): string | null {
  const name = value.toLowerCase();
  return NAME.test(name) ? name : null;
}

function firstLink(html: string, channel: string): string {
  for (const match of html.matchAll(/href="(https?:\/\/[^"]+)"/g)) {
    const href = decode(match[1] ?? '');
    if (sameChannel(href, channel))
      continue;

    try {
      const url = new URL(href);
      if (url.protocol === 'https:' || url.protocol === 'http:')
        return url.href;
    }
    catch {
      continue;
    }
  }

  return '';
}

function sameChannel(href: string, channel: string): boolean {
  try {
    const url = new URL(href);
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    if (host !== 't.me' && host !== 'telegram.me')
      return false;

    const parts = url.pathname.split('/').filter(Boolean);
    const head = (parts[0] === 's' ? parts[1] : parts[0]) ?? '';

    return head.toLowerCase() === channel;
  }
  catch {
    return false;
  }
}

function plain(html: string): string {
  return decode(html.replace(/<i class="emoji"[\s\S]*?<\/i>/g, '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .split('\n')
    .map(row => row.trim())
    .filter(row => row.length > 0 && row !== 'APPLY NOW')
    .join('\n');
}

function line(text: string, index: number): string {
  return text.split('\n')[index] ?? '';
}

function field(text: string, label: string): string {
  return text.match(new RegExp(`${label}:\\s*([^\\n]+)`))?.[1]?.trim() ?? '';
}

const hidden = new Set(['', 'not specified', 'зп не указана', 'описания нет']);

function shown(value: string): string {
  const trimmed = value.trim();
  if (hidden.has(trimmed.toLowerCase()))
    return '';

  return trimmed;
}

function decode(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}
