// Down mode: the yellow status (#pill) must be visible in the REAL popup.html after paintBind(true, false).
// A small tag-stack parser builds the tree; the hidden rule is taken verbatim from popup.ts paintBind.
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import test from 'node:test';

const VOID = new Set(['meta', 'link', 'br', 'img', 'input', 'hr', 'circle', 'path']);

function parse(html) {
  const root = { tag: '#root', attrs: {}, kids: [], parent: null };
  let cur = root;
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)([a-z][\w-]*)([^>]*?)(\/?)>/gi)) {
    const [, close, tag, rawAttrs, selfClose] = m;
    if (close) {
      while (cur !== root && cur.tag !== tag.toLowerCase()) cur = cur.parent;
      if (cur !== root) cur = cur.parent;
      continue;
    }
    const attrs = {};
    for (const a of rawAttrs.matchAll(/([\w-]+)(?:="([^"]*)")?/g)) attrs[a[1]] = a[2] ?? '';
    const node = { tag: tag.toLowerCase(), attrs, kids: [], parent: cur, classes: (attrs.class || '').split(/\s+/).filter(Boolean) };
    node.classList = { contains: c => node.classes.includes(c) };
    cur.kids.push(node);
    if (!selfClose && !VOID.has(node.tag)) cur = node;
  }
  return root;
}

const all = (n, out = []) => { for (const k of n.kids) { out.push(k); all(k, out); } return out; };

test('popup.html + paintBind(down): #pill and all its ancestors are visible', async () => {
  const html = await fsPromises.readFile(new URL('./src/popup.html', import.meta.url), 'utf8');
  const src = await fsPromises.readFile(new URL('./src/popup/popup.ts', import.meta.url), 'utf8');
  const bind = src.slice(src.indexOf('function paintBind('), src.indexOf('connectForm.hidden = false;', src.indexOf('function paintBind(')));
  const loop = bind.match(/querySelectorAll<HTMLElement>\('([^']+)'\)\)\n\s+el\.hidden = ([^;]+);/);
  assert.ok(loop, 'paintBind hide loop not found');
  const selectors = loop[1].split(',').map(s => s.trim().slice(1));
  // eslint-disable-next-line no-new-func
  const rule = new Function('el', 'on', 'key', `return ${loop[2]};`);

  const nodes = all(parse(html));
  const hidden = new Set(nodes.filter(n => 'hidden' in n.attrs));
  for (const n of nodes) {
    if (n.classes.some(c => selectors.includes(c)))
      rule(n, true, false) ? hidden.add(n) : hidden.delete(n);
  }
  for (const id of ['tabs', 'view-history', 'pin-note', 'view-settings', 'connect-form']) {
    const n = nodes.find(x => x.attrs.id === id);
    if (n) hidden.add(n);
  }
  const main = nodes.find(n => n.attrs.id === 'view-main');
  hidden.delete(main); // paintBind: main.hidden = false
  const pill = nodes.find(n => n.attrs.id === 'pill');
  hidden.delete(pill); // paintStatus: pillEl.hidden = false
  assert.ok(pill, '#pill exists');
  for (let n = pill; n.tag !== '#root'; n = n.parent)
    assert.equal(hidden.has(n), false, `hidden ancestor: <${n.tag} id="${n.attrs.id || ''}" class="${n.attrs.class || ''}">`);
  // the key screen (bind) still hides the card
  const card = nodes.find(n => n.classes.includes('autopilot-card'));
  assert.equal(rule(card, true, true), true);
  assert.equal(rule(card, false, false), false);
  assert.match(bind, /powerBtn\.disabled = on \|\| powerBtn\.disabled;/); // actions stay blocked while down
});
