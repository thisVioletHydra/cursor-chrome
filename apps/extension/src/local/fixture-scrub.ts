// Debug-only: turn a page snapshot into a test fixture without personal data.
// Runs only on a manual click in Options → Debug; the file is downloaded, the user moves it to
// apps/web/src/lib/server/plan/fixtures/. Nothing is sent anywhere.
const RULES: Array<[RegExp, string]> = [
  [/<script\b[^>]*>[\s\S]*?<\/script>/gi, ''],
  [/<script\b[^>]*\/?>/gi, ''],
  [/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ''],
  [/\s(href|src|action)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, ''],
  [/<style\b[^>]*>[\s\S]*?<\/style>/gi, ''],
  [/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ''],
  [/<template\b[^>]*>[\s\S]*?<\/template>/gi, ''],
  [/\s(value|data-value|data-initial-value)="[^"]*"/gi, ' $1=""'],
  [/<textarea\b([^>]*)>[\s\S]*?<\/textarea>/gi, '<textarea$1></textarea>'],
  [/\s(nonce|integrity|data-token|data-xsrf|data-csrf)="[^"]*"/gi, ''],
  [/name="_xsrf"[^>]*>/gi, 'name="_xsrf">'],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, 'user@example.com'],
  [/\+?\d[\d\s()-]{9,}\d/g, '+70000000000'],
  [/\/resume\/[0-9a-f]{20,}/gi, '/resume/RESUME_ID'],
  [/\bhhtoken=[^&"'\s]+/gi, 'hhtoken=X'],
];

// applicant header/menus carry the name, avatar and resume titles → emptied
const PRIVATE_QA = /(<([a-z]+)\b[^>]*data-qa="(?:mainmenu_[^"]*|applicant-?[^"]*name[^"]*|resume-title[^"]*|account[^"]*|user-name[^"]*|profile[^"]*)"[^>]*>)[\s\S]*?(<\/\2>)/gi;

export function scrubHtml(html: string): string {
  let out = html.replace(PRIVATE_QA, '$1$3');
  for (const [re, to] of RULES)
    out = out.replace(re, to);

  return out;
}

export function fixtureName(url: string, now = new Date()): string {
  let kind = 'page';
  try {
    const u = new URL(url);
    kind = u.pathname.split('/').filter(Boolean).slice(0, 2).join('-').replace(/\d+/g, 'N') || 'root';
  }
  catch {
  }
  const stamp = now.toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return `hh-${kind}-${stamp}.html`;
}
