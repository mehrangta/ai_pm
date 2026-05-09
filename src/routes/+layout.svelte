<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<style>
	:global(*) {
		box-sizing: border-box;
	}

	:global(body) {
		margin: 0;
		background: #f7f7f4;
		color: #1f2933;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}

	:global(button),
	:global(input),
	:global(textarea),
	:global(select) {
		font: inherit;
	}

	:global(button) {
		cursor: pointer;
	}

	:global(a) {
		color: inherit;
	}
</style>
