// Coach marks over the xAI console (like mobile onboarding): dim the screen, pulse a ring around the element,
// «нажми сюда». Only element lookup by selector + getBoundingClientRect: never clicks, never reads values,
// texts or fields from the page. The key reaches us only via the clipboard and the «Вставить» button.
export type CoachStep = { id: string; selector: string; text: string };
export type Rect = { top: number; left: number; width: number; height: number };
export type Finder = { querySelector: (selector: string) => { getBoundingClientRect: () => Rect } | null };

export const COACH_STEPS: Array<{ id: string; key: string; text: string }> = [
  { id: 'login', key: 'xaiLogin', text: 'Нажми сюда, чтобы войти. Можно через Google.' },
  { id: 'apiKeys', key: 'xaiApiKeys', text: 'Нажми сюда: раздел API Keys.' },
  { id: 'create', key: 'xaiCreateKey', text: 'Нажми сюда: Create API key. Подожди, пока появится ключ.' },
  { id: 'copy', key: 'xaiCopyKey', text: 'Нажми сюда, чтобы скопировать ключ. Потом вернись в расширение и нажми «Вставить из буфера».' },
];

export const FALLBACK_TEXT = 'Подожди, страница грузится. Если подсказка не появилась: войди → API Keys → Create API key → скопируй ключ → вернись в расширение и нажми «Вставить из буфера».';

export function coachSteps(selectors: Record<string, string>): CoachStep[] {
  return COACH_STEPS.map(step => ({ id: step.id, selector: selectors[step.key] ?? '', text: step.text }));
}

// The furthest step whose element is on the page wins; nothing found → text fallback.
export function locate(doc: Finder, steps: CoachStep[]): { step: CoachStep; rect: Rect } | null {
  for (const step of [...steps].reverse()) {
    if (!step.selector)
      continue;
    let el: ReturnType<Finder['querySelector']> = null;
    try {
      el = doc.querySelector(step.selector);
    }
    catch {
      el = null;
    }
    if (!el)
      continue;
    const box = el.getBoundingClientRect();
    if (box.width > 0 && box.height > 0)
      return { step, rect: { top: box.top, left: box.left, width: box.width, height: box.height } };
  }

  return null;
}

export type CoachView = { mode: 'ring'; ring: Rect; tip: { top: number; left: number }; text: string; index: number } | { mode: 'text'; text: string };

export function coachView(found: ReturnType<typeof locate>, steps: CoachStep[], viewport = { width: 1280, height: 800 }): CoachView {
  if (!found)
    return { mode: 'text', text: FALLBACK_TEXT };

  const pad = 8;
  const ring = { top: found.rect.top - pad, left: found.rect.left - pad, width: found.rect.width + pad * 2, height: found.rect.height + pad * 2 };
  const below = ring.top + ring.height + 12;
  const tip = { top: below + 90 < viewport.height ? below : Math.max(12, ring.top - 102), left: Math.min(Math.max(12, ring.left), viewport.width - 332) };

  return { mode: 'ring', ring, tip, text: found.step.text, index: steps.findIndex(step => step.id === found.step.id) + 1 };
}

export const COACH_CSS = `
:host { all: initial; }
.dim { position: fixed; inset: 0; pointer-events: none; z-index: 2147483646; }
.ring { position: fixed; border-radius: 12px; box-shadow: 0 0 0 9999px rgba(0,0,0,.62); border: 3px solid #a78bfa; pointer-events: none; z-index: 2147483646; animation: pulse 1.2s ease-in-out infinite; }
@keyframes pulse { 0%,100% { outline: 0 solid rgba(167,139,250,.55); } 50% { outline: 10px solid rgba(167,139,250,0); } }
.tip { position: fixed; width: 300px; padding: 12px 14px; border-radius: 12px; background: #1e1b4b; color: #ede9fe; font: 14px/1.45 -apple-system, system-ui, sans-serif; box-shadow: 0 10px 30px rgba(0,0,0,.5); z-index: 2147483647; pointer-events: auto; }
.tip b { display: block; margin-bottom: 4px; color: #c4b5fd; font-size: 12px; letter-spacing: .4px; text-transform: uppercase; }
.tip button { margin-top: 8px; background: transparent; color: #c4b5fd; border: 1px solid #6d28d9; border-radius: 8px; padding: 3px 10px; cursor: pointer; font: inherit; font-size: 12px; }
.banner { position: fixed; left: 50%; top: 16px; transform: translateX(-50%); width: min(560px, 92vw); }
`;

// Writes our own nodes only (shadow root we created); never touches page nodes.
export function paint(root: { innerHTML: string }, view: CoachView): void {
  const esc = (text: string) => text.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const close = '<button data-cc-close>Скрыть подсказки</button>';
  root.innerHTML = view.mode === 'ring'
    ? `<style>${COACH_CSS}</style><div class="ring" style="top:${view.ring.top}px;left:${view.ring.left}px;width:${view.ring.width}px;height:${view.ring.height}px"></div><div class="tip" style="top:${view.tip.top}px;left:${view.tip.left}px"><b>NoJobNoProblemBuddy · шаг ${view.index} из ${COACH_STEPS.length}</b>${esc(view.text)}<br>${close}</div>`
    : `<style>${COACH_CSS}</style><div class="tip banner"><b>NoJobNoProblemBuddy</b>${esc(view.text)}<br>${close}</div>`;
}
