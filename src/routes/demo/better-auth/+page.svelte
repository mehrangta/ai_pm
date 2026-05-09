<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getSession, signOut, type AppUser } from '$lib/api';

	let user = $state<AppUser | null>(null);
	let message = $state('Loading...');

	onMount(async () => {
		try {
			const session = await getSession();

			if (!session.user) {
				await goto('/demo/better-auth/login');
				return;
			}

			user = session.user;
			message = '';
		} catch (error) {
			message = error instanceof Error ? error.message : 'Session could not be loaded';
		}
	});

	async function handleSignOut(event: SubmitEvent) {
		event.preventDefault();
		await signOut();
		await goto('/demo/better-auth/login');
	}
</script>

{#if user}
	<h1>Hi, {user.name}!</h1>
	<p>Your user ID is {user.id}.</p>
	<form onsubmit={handleSignOut}>
		<button>Sign out</button>
	</form>
{:else}
	<p>{message}</p>
{/if}
