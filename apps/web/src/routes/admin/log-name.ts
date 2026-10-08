const STEP: Record<string, string> = {
  'hh-search.ts': 'поиск',
  'page-load.ts': 'поиск',
  'hide-popup.ts': 'поиск',
  'queue-run.ts': 'очередь',
  'tea.ts': 'очередь',
  'page-log.ts': 'чтение',
  'apply-run.ts': 'отклик',
  'apply-click.ts': 'отклик',
  'apply-fill.ts': 'форма',
};

const MODE_TAG = /\[(?:full|light|target)\]\s+/g;

export function showLog(line: string): string {
  return line.replace(MODE_TAG, '').replace(/[a-z0-9-]+\.ts/g, file => STEP[file] ?? file);
}

export function searchModeLabel(mode: string): string {
  if (mode === 'target')
    return 'точечный';

  if (mode === 'light')
    return 'лайт';

  if (mode === 'full')
    return 'жёсткий';

  return '';
}
