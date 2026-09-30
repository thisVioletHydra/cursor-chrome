let kept = true;

export function keepWorkHours(): boolean {
  return kept;
}

export function noteHours(body: unknown): void {
  if (typeof body !== 'object' || body === null)
    return;

  if ('hours' in body && typeof body.hours === 'boolean')
    kept = body.hours;
}
