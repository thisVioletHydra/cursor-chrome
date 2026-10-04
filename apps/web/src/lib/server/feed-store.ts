import type { ChannelPost } from '../channel-post';

import fsPromises from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

export async function readFeed(channel: string): Promise<{ at: number; posts: ChannelPost[] } | null> {
  try {
    const parsed = JSON.parse(await fsPromises.readFile(feedFile(channel), 'utf8')) as { at?: unknown; posts?: unknown };
    if (typeof parsed.at !== 'number' || Array.isArray(parsed.posts) === false)
      return null;

    return { at: parsed.at, posts: parsed.posts as ChannelPost[] };
  }
  catch {
    return null;
  }
}

export async function writeFeed(channel: string, posts: ChannelPost[]): Promise<void> {
  const file = feedFile(channel);
  await fsPromises.mkdir(path.dirname(file), { recursive: true });
  await fsPromises.writeFile(file, JSON.stringify({ at: Date.now(), posts }));
}

function feedFile(channel: string): string {
  return path.join(dataRoot(), 'feeds', `${channel}.json`);
}

function dataRoot(): string {
  if (process.env.WEB_SECRETS)
    return path.dirname(process.env.WEB_SECRETS);

  if (process.env.RAILWAY_ENVIRONMENT)
    return '/data';

  return path.join(process.cwd(), 'data');
}
