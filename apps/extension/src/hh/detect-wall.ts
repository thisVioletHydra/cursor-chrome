export const DETECT_WALL = 'Вам недоступна эта вакансия';
export const DETECT_LINE = 'аларм, нас детектят';

export function detectWall(text: string): boolean {
  return text.includes(DETECT_WALL);
}

export function hhDetectShown(): boolean {
  const root = document.body;
  if (root === null)
    return false;

  return (root.innerText || root.textContent || '').includes('Вам недоступна эта вакансия');
}
