<script lang="ts">
import type { Lane, Pace } from '$lib/imitation-pace';

import { imitationPicture } from '$lib/imitation-pace';

let { pace }: { pace: Pace } = $props();

const picture = $derived(imitationPicture(pace));
const labelW = 220;
const plotW = 520;
const noteW = 268;
const width = labelW + plotW + noteW;
const rowH = 32;
const axisTop = 28;

type Row = { lane: Lane; y: number; caption: string };

const rows = $derived.by(() => {
  const list: Row[] = [];
  let y = axisTop + 16;
  let seenRare = false;
  for (const lane of picture.lanes) {
    let caption = '';
    if (lane.tone === 'rare' && seenRare === false) {
      caption = 'Иногда, не каждый отклик';
      seenRare = true;
      y += 22;
    }

    if (lane.tone === 'caption') {
      caption = lane.note;
      y += 22;
    }

    if (lane.tone === 'cycle') {
      caption = 'Между кругами, не пауза вакансии';
      y += 28;
    }

    list.push({ lane, y, caption });
    y += rowH;
  }

  return list;
});

const sceneTop = $derived((rows.at(-1)?.y ?? axisTop) + rowH + 28);
const height = $derived(sceneTop + picture.scenarios.length * 36 + 12);

function xOf(seconds: number): number {
  if (picture.axisMax <= 0)
    return labelW;

  return labelW + (seconds / picture.axisMax) * plotW;
}

function ticks(max: number): number[] {
  const step = max <= 60 ? 10 : max <= 180 ? 30 : max <= 600 ? 60 : 300;
  const list: number[] = [];
  for (let mark = 0; mark <= max; mark += step)
    list.push(mark);

  return list;
}

const axis = $derived(ticks(picture.axisMax));
const plotBottom = $derived(sceneTop - 16);
</script>

<section class="rounded-2xl border border-white/8 bg-[#151922] px-5 py-4" aria-labelledby="pace-chart-title">
  <h2 id="pace-chart-title" class="text-base font-semibold text-white">От открыл до откликнулся</h2>
  <p class="mt-1 text-sm text-zinc-400">Одна вакансия. Ось в секундах, длина полосы — длительность. Янтарная полоса — таймер, засечка — сразу.</p>
  <svg class="mt-4 w-full" viewBox="0 0 {width} {height}" role="img" aria-labelledby="pace-chart-title">
    <line x1={labelW} y1={axisTop} x2={labelW + plotW} y2={axisTop} stroke="#ffffff" stroke-opacity="0.16" />
    {#each axis as mark (mark)}
      <line x1={xOf(mark)} y1={axisTop} x2={xOf(mark)} y2={plotBottom} stroke="#ffffff" stroke-opacity="0.06" />
      <text x={xOf(mark)} y={axisTop - 8} fill="#a1a1aa" font-size="11" text-anchor="middle">{mark}</text>
    {/each}
    {#each rows as row (row.lane.label)}
      {#if row.caption}
        <text x={labelW} y={row.y - 14} fill="#a1a1aa" font-size="12">{row.caption}</text>
      {/if}
      <text x="0" y={row.y + 16} fill="#e4e4e7" font-size="13">
        {row.lane.label}
        <tspan dx="6" fill={row.lane.tone === 'mark' ? '#a1a1aa' : '#e0b15a'} font-size="11">{row.lane.tag}</tspan>
      </text>
      {#if row.lane.tone === 'mark'}
        <circle class="fill-zinc-300 transition hover:fill-white" cx={xOf(row.lane.start)} cy={row.y + 12} r="4">
          <title>{row.lane.label}. {row.lane.note}</title>
        </circle>
      {:else}
        <rect
          class="transition {row.lane.tone === 'cycle' ? 'fill-[#8a8178] hover:fill-[#b3aa9e]' : 'fill-[#e0b15a] hover:fill-[#f3d7a1]'} {row.lane.tone === 'rare' ? 'opacity-50 hover:opacity-100' : ''}"
          x={xOf(row.lane.start)}
          y={row.y + 6}
          width={Math.max((row.lane.seconds / picture.axisMax) * plotW, row.lane.seconds > 0 ? 2 : 0)}
          height="12"
          rx="3"
        >
          <title>{row.lane.label}. {row.lane.note}</title>
        </rect>
      {/if}
      {#if row.lane.tone !== 'caption'}
        <text x={xOf(row.lane.start + row.lane.seconds) + 8} y={row.y + 16} fill="#a1a1aa" font-size="12">{row.lane.note}</text>
      {/if}
    {/each}
    <text x="0" y={sceneTop - 6} fill="#e4e4e7" font-size="13">Темп на одну</text>
    {#each picture.scenarios as scene, index (scene.title)}
      <text x="0" y={sceneTop + index * 36 + 16} fill="#d4d4d8" font-size="13">{scene.title}</text>
      <rect
        class="fill-[#e0b15a] opacity-80 transition hover:opacity-100"
        x={labelW}
        y={sceneTop + index * 36 + 6}
        width={Math.max((scene.seconds / picture.axisMax) * plotW, scene.seconds > 0 ? 2 : 0)}
        height="8"
        rx="3"
      >
        <title>{scene.title}. {scene.value}. {scene.line}</title>
      </rect>
      <text x={xOf(scene.seconds) + 8} y={sceneTop + index * 36 + 14} fill="#e4e4e7" font-size="12">{scene.value}</text>
      <text x={labelW} y={sceneTop + index * 36 + 30} fill="#a1a1aa" font-size="11">{scene.line}</text>
    {/each}
  </svg>

  <div class="mt-5 grid gap-4 lg:grid-cols-3">
    <div>
      <h3 class="text-sm font-medium text-white">Вакансий ожидается</h3>
      <p class="mt-3 text-xs text-zinc-500">{picture.cap.title}</p>
      <p class="text-lg text-white">{picture.cap.value}</p>
      <p class="text-xs text-zinc-500">{picture.cap.line}</p>
      {#each picture.windows as item (item.title)}
        <p class="mt-3 text-xs text-zinc-500">{item.title}</p>
        <p class="text-lg text-white">{item.value}</p>
        <p class="text-xs leading-snug text-zinc-500">{item.line}</p>
      {/each}
    </div>
    <div>
      <h3 class="text-sm font-medium text-white">Часов требуется на {picture.dayCap}</h3>
      {#each picture.hours as item (item.title)}
        <p class="mt-3 text-xs text-zinc-500">{item.title}</p>
        <p class="text-lg text-white">{item.value}</p>
        <p class="text-xs leading-snug text-zinc-500">{item.line}</p>
      {/each}
      <p class="mt-3 text-xs leading-snug text-zinc-500">Отдых между кругами в эти часы не входит.</p>
    </div>
    <div>
      <h3 class="text-sm font-medium text-white">Простой, сумма задержек на {picture.dayCap}</h3>
      {#each picture.idle as item (item.title)}
        <p class="mt-3 text-xs text-zinc-500">{item.title}</p>
        <p class="text-lg text-white">{item.value}</p>
        <p class="text-xs leading-snug text-zinc-500">{item.line}</p>
      {/each}
      <p class="mt-3 text-xs text-zinc-500">{picture.rest.title}</p>
      <p class="text-lg text-white">{picture.rest.value}</p>
      <p class="text-xs leading-snug text-zinc-500">{picture.rest.line}</p>
    </div>
  </div>
</section>
