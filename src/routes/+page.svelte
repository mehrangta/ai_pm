<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getSession } from '$lib/api';

	onMount(async () => {
		try {
			const { user } = await getSession();
			await goto(user ? '/boards' : '/login', { replaceState: true });
		} catch {
			await goto('/login', { replaceState: true });
		}
	});
</script>

<main class="redirecting">
	<p>Redirecting...</p>
</main>

<style>
	.redirecting {
		display: grid;
		min-height: 100vh;
		place-items: center;
		color: #64748b;
	}
</style>
