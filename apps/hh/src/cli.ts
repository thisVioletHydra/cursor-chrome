import { ping } from './ping.ts';
import { preflight } from './preflight.ts';
import { scan } from './scan.ts';

import process from 'node:process';

const command = process.argv[2] ?? 'scan';

if (command === 'preflight')
  await preflight();
else if (command === 'ping')
  await ping();
else if (command === 'scan')
  await dryScan();
else {
  console.error('scan | preflight | ping');
  process.exitCode = 1;
}

async function dryScan(): Promise<void> {
  const query = process.argv.slice(3).find(part => part !== '--')
    ?? process.env.HH_QUERY
    ?? 'typescript react nestjs';
  const reports = await scan({ query, dry: true, live: false });
  for (const report of reports)
    console.log(report.line);
}
