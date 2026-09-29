<script lang="ts">
let { name, class: className = '' }: { name: string; class?: string } = $props();

const marks: Record<string, string[]> = {
  home: ['M2.6 7.2 8 2.6l5.4 4.6', 'M3.5 7.5V13h9V7.5'],
  plane: ['M1.8 7.4 14.2 2.4 10 13.6 7.6 9.2z', 'M7.6 9.2 14.2 2.4'],
  spark: ['M8 1.8 9.15 6.85 14.2 8 9.15 9.15 8 14.2 6.85 9.15 1.8 8 6.85 6.85z'],
  briefcase: [
    'M6 6.1V4.3A1 1 0 0 1 7 3.3h2a1 1 0 0 1 1 1v1.8',
    'M2.6 6.2h10.8a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H2.6a1 1 0 0 1-1-1V7.2a1 1 0 0 1 1-1z',
    'M1.6 9.2h12.8',
  ],
  puzzle: [
    'M8 2.7a5.3 5.3 0 1 0 0 10.6 5.3 5.3 0 0 0 0-10.6',
    'M8 6.6a1.4 1.4 0 1 0 0 2.8 1.4 1.4 0 0 0 0-2.8',
    'M8 6.6V2.9',
    'M6.85 8.75 3.55 10.65',
    'M9.15 8.75 12.45 10.65',
  ],
  letter: ['M2.4 3.8h11.2v8.4H2.4z', 'M2.6 4.2 8 8.3l5.4-4.1'],
  card: ['M2 4h12v8H2z', 'M2 7h12'],
  file: ['M4.2 2.2h4.6L12 5.4v8.4H4.2z', 'M8.8 2.4V5.6H12'],
  person: [
    'M8 3.1a2.05 2.05 0 1 1 0 4.1 2.05 2.05 0 0 1 0-4.1',
    'M3.6 13.3c.55-2.2 2.25-3.35 4.4-3.35s3.85 1.15 4.4 3.35',
  ],
  mark: ['M8 2.2 13.4 8 8 13.8 2.6 8z'],
};

function strokes(icon: string): string[] {
  return marks[icon] ?? marks.mark ?? [];
}
</script>

<svg class="size-4 shrink-0 {className}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each strokes(name) as d}
    <path {d} />
  {/each}
</svg>
