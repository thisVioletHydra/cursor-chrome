<script lang="ts">
import type { Cond, CondOp, Profile, ProfileCustom, ValueRule, VacancyField } from '@cursor-chrome/hh';

let { data } = $props();

type Mode = 'none' | 'fixed' | 'vacancy' | 'conditions';
type Case = { field: VacancyField; op: CondOp; value: string; answer: string };
type Row = { mode: Mode; value: string; fallback: string; field: VacancyField; cases: Case[]; otherwise: string };

const FIELDS: Array<[VacancyField, string]> = [['city', 'город вакансии'], ['format', 'формат'], ['title', 'название'], ['company', 'компания'], ['salary', 'зарплата до'], ['office', 'офис/гибрид']];
const OPS: Array<[CondOp, string]> = [['is', '='], ['isNot', '≠'], ['contains', 'содержит'], ['gte', '≥'], ['lte', '≤']];

function rowOf(rule: ValueRule | undefined, vacancyField?: VacancyField): Row {
  const base: Row = { mode: 'none', value: '', fallback: '', field: vacancyField ?? 'city', cases: [], otherwise: '' };
  if (rule === undefined)
    return base;

  if (rule.mode === 'fixed')
    return { ...base, mode: 'fixed', value: rule.value };

  if (rule.mode === 'vacancy')
    return { ...base, mode: 'vacancy', field: rule.field, fallback: rule.fallback ?? '' };

  return { ...base, mode: 'conditions', otherwise: rule.otherwise, cases: rule.cases.map(item => ({ ...(item.when[0] as Cond), answer: item.value })) };
}

function ruleOf(row: Row): ValueRule | null {
  if (row.mode === 'fixed')
    return row.value.trim() ? { mode: 'fixed', value: row.value.trim() } : null;

  if (row.mode === 'vacancy')
    return { mode: 'vacancy', field: row.field, fallback: row.fallback.trim() };

  if (row.mode === 'conditions')
    return { mode: 'conditions', otherwise: row.otherwise.trim(), cases: row.cases.filter(item => item.value.trim()).map(item => ({ when: [{ field: item.field, op: item.op, value: item.value.trim() }], value: item.answer.trim() })) };

  return null;
}

const initial = data.profile as Profile | null;
let custom = $state<Array<ProfileCustom & { aliasText: string }>>((initial?.custom ?? []).map(item => ({ ...item, aliasText: item.aliases.join('\n') })));
let rows = $state<Record<string, Row>>(Object.fromEntries([
  ...data.questions.map(question => [question.key, rowOf(initial?.fields[question.key], question.vacancyField)]),
  ...(initial?.custom ?? []).map(item => [item.key, rowOf(initial?.fields[item.key])]),
]));
let note = $state('');
let saving = $state(false);
let newLabel = $state('');

const filled = $derived(Object.values(rows).filter(row => row.mode !== 'none').length);

function addCustom(): void {
  const label = newLabel.trim();
  if (label.length === 0)
    return;

  const key = `c${Date.now().toString(36)}`;
  custom = [...custom, { key, label, aliases: [], aliasText: label }];
  rows[key] = rowOf({ mode: 'fixed', value: '' });
  rows[key].mode = 'fixed';
  newLabel = '';
}

async function save(): Promise<void> {
  saving = true;
  const fields: Record<string, ValueRule> = {};
  for (const [key, row] of Object.entries(rows)) {
    const rule = ruleOf(row);
    if (rule)
      fields[key] = rule;
  }
  const body = { fields, custom: custom.map(item => ({ key: item.key, label: item.label, aliases: item.aliasText.split('\n').map(line => line.trim()).filter(Boolean) })) };
  const res = await fetch('/admin/profile/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  const reply = res ? await res.json().catch(() => null) as { ok?: boolean; detail?: string } | null : null;
  saving = false;
  note = reply?.ok ? 'Сохранено. Ответы подставятся в «Разборе» (↻ для уже открытых вакансий).' : `не сохранилось: ${reply?.detail ?? 'сервер не ответил'}`;
}

let backupNote = $state('');
let backingUp = $state(false);

async function downloadBackup(): Promise<void> {
  backingUp = true;
  backupNote = '';
  const res = await fetch('/admin/backup', { method: 'POST' }).catch(() => null);
  backingUp = false;
  if (res === null || res.ok === false) {
    backupNote = 'не скачалось: сервер не ответил';
    return;
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'nojobnoproblem-backup.zip';
  const url = URL.createObjectURL(await res.blob());
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
  backupNote = 'Бэкап скачан. Секреты в нём замаскированы.';
}

const input = 'rounded-lg border border-white/10 bg-[#0b0d12] px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-400';
</script>

<svelte:head><title>Профиль · анкета</title></svelte:head>

<header class="mb-5 flex flex-wrap items-end justify-between gap-4">
  <div>
    <h1 class="text-xl font-semibold text-white">Профиль</h1>
    {#if data.isDemo === true}
      <p class="mt-1 text-sm text-zinc-400" data-testid="demo-login">Аккаунт: <span class="font-medium text-zinc-200">{data.login}</span></p>
    {/if}
    <p class="mt-1 max-w-2xl text-xs text-zinc-500">Факты о тебе для ответов работодателям. Нейронка личные факты не придумывает: если поля нет ни здесь, ни в правилах, ни в памяти, в «Разборе» будет пусто с пометкой «нужен твой ответ». Значение может зависеть от вакансии.</p>
  </div>
  <p class="text-sm text-zinc-400 tabular-nums">заполнено {filled} из {Object.keys(rows).length}</p>
</header>

<section class="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-white/8 bg-[#10131a] px-4 py-3 text-xs" data-testid="backup">
  <button class="rounded-lg bg-white/5 px-3 py-1.5 text-zinc-200 hover:bg-white/10 disabled:opacity-50" type="button" disabled={backingUp} onclick={downloadBackup}>{backingUp ? 'Собираю…' : 'Скачать бэкап'}</button>
  <span class="text-zinc-500">Серверные данные твоего аккаунта, без секретов. Данные расширения сохраняй через «Экспорт JSON» в расширении.</span>
  {#if backupNote}<span class="text-zinc-300">{backupNote}</span>{/if}
</section>

{#if data.first}
  <p class="mb-4 rounded-xl border border-indigo-400/40 bg-indigo-500/10 px-4 py-3 text-sm text-indigo-100">Первый вход: ответь на частые вопросы с hh. Можно заполнить не всё и вернуться позже — пустые поля в откликах останутся пустыми.</p>
{/if}

<ul class="flex flex-col gap-2">
  {#each [...data.questions, ...custom] as question (question.key)}
    {@const row = rows[question.key]}
    {@const vacancyField = 'vacancyField' in question ? question.vacancyField : undefined}
    {#if row}
      <li class={['rounded-2xl border bg-[#10131a] px-4 py-3', row.mode === 'none' ? 'border-white/8' : 'border-indigo-400/30']}>
        <div class="flex flex-wrap items-start gap-3">
          <div class="w-60 shrink-0">
            <p class="text-sm text-zinc-100">{question.label}</p>
            <p class="mt-0.5 text-[11px] text-zinc-500">{'hint' in question ? question.hint : 'своё поле'}</p>
          </div>
          <select class={input} bind:value={row.mode} aria-label="Режим «{question.label}»">
            <option value="none">не задано</option>
            <option value="fixed">фиксированное</option>
            {#if vacancyField}<option value="vacancy">как в вакансии</option>{/if}
            <option value="conditions">по условиям</option>
          </select>
          <div class="min-w-0 flex-1">
            {#if row.mode === 'none'}
              <p class="pt-1.5 text-xs text-amber-300/80">нужен твой ответ — пока не подставляется</p>
            {:else if row.mode === 'fixed'}
              <input class="{input} w-full" bind:value={row.value} placeholder="ответ" />
            {:else if row.mode === 'vacancy'}
              <div class="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                <span>берётся из поля «{FIELDS.find(([key]) => key === row.field)?.[1]}» вакансии, если пусто:</span>
                <input class={input} bind:value={row.fallback} placeholder="запасной ответ" />
              </div>
            {:else}
              <div class="flex flex-col gap-1.5 text-xs text-zinc-400">
                {#each row.cases as item, index (index)}
                  <div class="flex flex-wrap items-center gap-2">
                    <span>если</span>
                    <select class={input} bind:value={item.field}>{#each FIELDS as [key, label] (key)}<option value={key}>{label}</option>{/each}</select>
                    <select class={input} bind:value={item.op}>{#each OPS as [key, label] (key)}<option value={key}>{label}</option>{/each}</select>
                    <input class="{input} w-32" bind:value={item.value} placeholder="значение" />
                    <span>→</span>
                    <input class="{input} w-40" bind:value={item.answer} placeholder="ответ" />
                    <button class="rounded px-1.5 text-rose-300 hover:bg-rose-500/15" type="button" aria-label="убрать условие" onclick={() => row.cases.splice(index, 1)}>✕</button>
                  </div>
                {/each}
                <div class="flex flex-wrap items-center gap-2">
                  <button class="rounded-lg bg-white/5 px-2 py-1 text-zinc-200 hover:bg-white/10" type="button" onclick={() => row.cases.push({ field: vacancyField ?? 'city', op: 'is', value: '', answer: '' })}>+ условие</button>
                  <span>иначе →</span>
                  <input class="{input} w-40" bind:value={row.otherwise} placeholder="ответ по умолчанию" />
                </div>
              </div>
            {/if}
          </div>
        </div>
        {#if !('hint' in question)}
          {@const own = custom.find(item => item.key === question.key)}
          {#if own}
            <label class="mt-2 flex flex-col gap-1 text-[11px] text-zinc-500">формулировки вопроса на сайте вакансий (по одной в строке)
              <textarea class="{input} min-h-12" bind:value={own.aliasText}></textarea>
            </label>
          {/if}
        {/if}
      </li>
    {/if}
  {/each}
</ul>

<div class="mt-3 flex flex-wrap items-center gap-2 text-xs">
  <input class="{input} w-72" bind:value={newLabel} placeholder="своё поле, напр. «Есть ли ИП?»" />
  <button class="rounded-lg bg-white/5 px-3 py-1.5 text-zinc-200 hover:bg-white/10" type="button" onclick={addCustom}>+ добавить поле</button>
</div>

<div class="sticky bottom-0 mt-5 flex items-center gap-3 border-t border-white/8 bg-[#0b0d12]/90 py-3 backdrop-blur">
  <button class="rounded-lg bg-indigo-500/30 px-4 py-2 text-sm text-white hover:bg-indigo-500/40 disabled:opacity-50" type="button" disabled={saving} onclick={save}>{saving ? 'Сохраняю…' : 'Сохранить профиль'}</button>
  {#if data.first}<a class="text-xs text-zinc-400 underline decoration-dotted hover:text-white" href="/admin/review" onclick={(event) => { event.preventDefault(); void save().then(() => { location.href = '/admin/review'; }); }}>сохранить и к разбору</a>{/if}
  {#if note}<span class="text-xs text-zinc-300">{note}</span>{/if}
</div>
