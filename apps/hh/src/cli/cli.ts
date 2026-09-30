import { PRESETS, probeProvider } from '../model/model.ts';
import { ping } from './ping.ts';
import { preflight } from './preflight.ts';
import { scan } from '../scan/scan.ts';

import process from 'node:process';

const command = process.argv[2] ?? 'scan';

if (command === 'preflight')
  await preflight();
else if (command === 'ping')
  await ping();
else if (command === 'probe')
  await probe();
else if (command === 'scan')
  await dryScan();
else {
  console.error('scan | preflight | ping | probe');
  process.exitCode = 1;
}

async function probe(): Promise<void> {
  const preset = PRESETS.find(item => item.id === 'gemini');
  const key = process.env.GEMINI_API_KEY ?? '';
  const model = process.argv[3] || preset?.model || '';
  if (preset === undefined || key.length === 0 || model.length === 0) {
    console.error('Нужны GEMINI_API_KEY и имя модели: probe gemini-3.8-flash');
    process.exitCode = 1;
    return;
  }

  const result = await probeProvider({ ...preset, key, model }, 20_000);
  console.log(result.detail);
  if (result.ok === false)
    process.exitCode = 1;
}

async function dryScan(): Promise<void> {
  const query = process.argv.slice(3).find(part => part !== '--')
    ?? process.env.HH_QUERY
    ?? 'typescript react nestjs';
  const { reports } = await scan({ query, dry: true, live: false });
  for (const report of reports)
    console.log(report.line);
}
