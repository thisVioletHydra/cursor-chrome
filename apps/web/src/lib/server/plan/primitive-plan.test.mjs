import { primitivePlanner } from './primitive-plan.ts';

import test from 'node:test';
import assert from 'node:assert/strict';
const form = {
  found: true,
  html: '<form/>',
  fields: [
    { id: 'q', type: 'text', selector: '#q', required: true },
    {
      id: 'resume',
      type: 'select',
      selector: '#resume',
      options: [
        { text: 'Frontend', value: '1' },
        { text: 'Fullstack', value: '2' },
      ],
    },
  ],
};
test('server owns resume choice, answer typing, submit and confirmation; wire has six primitives only', async () => {
  const commands = [];
  let clicked = false;
  const send = async (login, c) => {
    assert.equal(login, 'a');
    commands.push(c);
    if (c.kind === 'click') clicked = true;
    return {
      ok: true,
      result:
        c.kind === 'readDOM'
          ? clicked
            ? { html: 'Отклик отправлен' }
            : form
          : {},
    };
  };
  const result = await primitivePlanner(send)('a', {
    kind: 'hh_apply',
    params: { answers: { q: '6 лет', __resumeKind: 'fullstack' } },
  });
  assert.equal(result.result.status, 'sent');
  assert.ok(
    commands.every((c) =>
      ['navigate', 'click', 'type', 'select', 'readDOM', 'wait'].includes(
        c.kind,
      ),
    ),
  );
  assert.deepEqual(commands.find((c) => c.kind === 'select').params.values, [
    '2',
  ]);
  assert.equal(commands.find((c) => c.kind === 'type').params.text, '6 лет');
  assert.equal(commands.filter((c) => c.kind === 'click').length, 1);
});
test('missing required answer and failed fill never submit; failed confirmation never retries submit', async () => {
  for (const fail of ['required', 'type', 'confirm']) {
    const commands = [];
    const send = async (l, c) => {
      commands.push(c);
      if (fail === 'type' && c.kind === 'type')
        return { ok: false, error: 'missing' };
      return { ok: true, result: form };
    };
    const out = await primitivePlanner(send)('a', {
      kind: 'hh_apply',
      params: { answers: fail === 'required' ? {} : { q: 'yes' } },
    });
    assert.equal(out.ok && out.result?.status === 'sent', false);
    assert.equal(
      commands.filter((c) => c.kind === 'click').length,
      fail === 'confirm' ? 1 : 0,
    );
  }
});
