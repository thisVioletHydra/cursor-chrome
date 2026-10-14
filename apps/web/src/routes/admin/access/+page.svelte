<script lang="ts">
  let { data } = $props();
  const fmt = (at: number) => new Date(at).toLocaleString('ru-RU');
</script>

<div class="p-4 grid gap-4">
  <h1 class="text-xl font-semibold">Access debug</h1>
  <p class="text-sm opacity-70">Slots per token: {data.slots} · pass lifetime: {data.passHours} h · weights: {Object.entries(data.weights).map(([k, v]) => `${k} ${v}`).join(', ')}. Server stores only hashes.</p>
  {#each data.tokens as token (token.id)}
    <div class="card bg-base-200 p-4" data-token={token.id}>
      <div class="font-semibold">{token.label} <span class="badge">{token.login}</span> {#if token.revoked}<span class="badge badge-error">revoked</span>{/if}</div>
      <div class="text-sm opacity-70">token id {token.id}… · today {token.usedToday}/{token.limit}</div>
      <table class="table table-sm mt-2">
        <thead><tr><th>Slot</th><th>Device</th><th>Last score</th><th>Zone</th><th>Pass until</th><th>Reference hashes</th><th></th></tr></thead>
        <tbody>
          {#each [1, 2] as slot (slot)}
            {@const d = token.devices.find(item => Number(item.slot) === slot)}
            {@const p = token.passes.find(item => item.slot === slot)}
            <tr>
              <td>{slot}</td>
              <td>{d ? `${d.device_hash}…` : 'free'}</td>
              <td>{d ? `${d.last_score}/10` : ''}</td>
              <td>{d?.last_zone ?? ''}</td>
              <td>{p ? fmt(p.expires) : ''}</td>
              <td class="font-mono text-xs">{#if d}{#each Object.entries(d.ref) as [k, v] (k)}<div>{k}: {String(v).slice(0, 12)}…</div>{/each}{/if}</td>
              <td>{#if d}<form method="POST" action="?/unbind"><input type="hidden" name="id" value={token.id}><input type="hidden" name="slot" value={slot}><button class="btn btn-xs">Unbind</button></form>{/if}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p>No tokens for this account.</p>
  {/each}
  <div class="card bg-base-200 p-4">
    <div class="font-semibold mb-2">Access log</div>
    {#each data.events as e, i (i)}
      <div class="font-mono text-xs">{fmt(e.at)} · {e.token}… · {e.kind} · {e.detail}</div>
    {/each}
  </div>
</div>
