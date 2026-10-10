<script lang="ts">
import LoginScene from '$lib/LoginScene.svelte';

let { data } = $props();
</script>

<LoginScene expired={data.expired} blocked={data.blocked} demo={data.demo} demoVersion={data.demoVersion} />
