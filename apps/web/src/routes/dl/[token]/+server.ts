import type { RequestHandler } from './$types';

import { readAccount } from '$lib/server/secrets';
import { distDir, dlSecret, verifyDl, zipDir } from '$lib/server/thin/dl';

import fs from 'node:fs';
import process from 'node:process';

// Signed 24 h link → zip of the current extension dist, built by the server.
export const GET: RequestHandler = async ({ params }) => {
  const check = await verifyDl(params.token, dlSecret(process.env), async login => (await readAccount(login)).extToken);
  if (check.ok === false)
    return new Response(check.reason, { status: 403, headers: { 'cache-control': 'no-store' } });

  const dir = distDir(process.env, process.cwd());
  if (fs.existsSync(path(dir)) === false)
    return new Response('сборка расширения не найдена', { status: 503 });

  return new Response(zipDir(dir), { headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="cursor-chrome-extension.zip"', 'cache-control': 'no-store' } });
};

function path(dir: string): string {
  return `${dir}/manifest.json`;
}
