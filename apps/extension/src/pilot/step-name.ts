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

export function nameStep(line: string): string {
  return line.replace(/[a-z0-9-]+\.ts/g, file => STEP[file] ?? file);
}
