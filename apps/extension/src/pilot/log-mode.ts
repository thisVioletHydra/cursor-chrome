export type RunMode = 'full' | 'light' | 'target';

export function tagLine(mode: RunMode, line: string): string {
  const tag = `[${mode}]`;
  if (line.includes(tag))
    return line;

  const dot = line.indexOf(' · ');
  if (dot === -1)
    return `${tag} ${line}`;

  return `${line.slice(0, dot)} · ${tag} ${line.slice(dot + 3)}`;
}
