<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		createBoard,
		deleteBoard,
		ApiError,
		getBoards,
		renameBoard,
		signOut,
		type AppUser,
		type BoardSummary
	} from '$lib/api';

	let user = $state<AppUser | null>(null);
	let boards = $state<BoardSummary[]>([]);
	let message = $state('');
	let loading = $state(true);

	onMount(() => {
		void loadBoards();
	});

	async function loadBoards() {
		message = '';
		loading = true;

		try {
			const data = await getBoards();
			user = data.user;
			boards = data.boards;
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				await goto('/login');
				return;
			}

			message = error instanceof Error ? error.message : 'Boards could not be loaded';
		} finally {
			loading = false;
		}
	}

	async function handleCreate(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const title = new FormData(form).get('title')?.toString().trim() ?? '';

		try {
			const result = await createBoard(title);
			await goto(`/boards/${result.boardId}`);
		} catch (error) {
			message = error instanceof Error ? error.message : 'Board could not be created';
		}
	}

	async function handleRename(event: SubmitEvent) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const formData = new FormData(form);

		try {
			await renameBoard(
				formData.get('boardId')?.toString() ?? '',
				formData.get('title')?.toString().trim() ?? ''
			);
			await loadBoards();
		} catch (error) {
			message = error instanceof Error ? error.message : 'Board could not be renamed';
		}
	}

	async function handleDelete(event: SubmitEvent) {
		event.preventDefault();
		const boardId = new FormData(event.currentTarget as HTMLFormElement).get('boardId')?.toString() ?? '';

		try {
			await deleteBoard(boardId);
			await loadBoards();
		} catch (error) {
			message = error instanceof Error ? error.message : 'Board could not be deleted';
		}
	}

	async function handleSignOut(event: SubmitEvent) {
		event.preventDefault();
		await signOut();
		await goto('/login');
	}
</script>

<main class="boards-page">
	<header class="topbar">
		<div>
			<p class="eyebrow">Signed in as {user?.email ?? '...'}</p>
			<h1>Boards</h1>
		</div>

		<form onsubmit={handleSignOut}>
			<button class="ghost">Sign out</button>
		</form>
	</header>

	<section class="create-row" aria-labelledby="create-board-title">
		<div>
			<h2 id="create-board-title">Create board</h2>
			<p>Start a separate workspace for each project, sprint, or personal plan.</p>
		</div>

		<form onsubmit={handleCreate}>
			<input name="title" placeholder="Board title" maxlength="120" required />
			<button class="primary">Create</button>
		</form>
	</section>

	{#if message}
		<p class="form-error">{message}</p>
	{/if}

	<section class="board-grid" aria-label="Your boards">
		{#if loading}
			<div class="empty-state">
				<h2>Loading boards</h2>
			</div>
		{:else}
			{#each boards as board (board.id)}
				<article class="board-card">
					<a class="board-link" href={`/boards/${board.id}`}>
						<span>{board.title}</span>
						<small>Open board</small>
					</a>

					<form class="rename" onsubmit={handleRename}>
						<input type="hidden" name="boardId" value={board.id} />
						<input name="title" value={board.title} maxlength="120" aria-label="Board title" required />
						<button>Rename</button>
					</form>

					<form onsubmit={handleDelete}>
						<input type="hidden" name="boardId" value={board.id} />
						<button class="danger">Delete</button>
					</form>
				</article>
			{:else}
				<div class="empty-state">
					<h2>No boards yet</h2>
					<p>Create your first board to add columns, cards, and pasted image notes.</p>
				</div>
			{/each}
		{/if}
	</section>
</main>

<style>
	.boards-page {
		--surface-container-lowest: #0e0e0e;
		--surface: #141313;
		--surface-container: #201f20;
		--surface-container-low: #1c1b1c;
		--surface-container-high: #2b2a2a;
		--surface-bright: #3a3939;
		--on-surface: #e5e2e1;
		--on-surface-variant: #c8c5cb;
		--outline-variant: #47464b;
		--tertiary: #abd600;
		--error: #ffb4ab;
		display: grid;
		grid-template-rows: auto auto auto 1fr;
		gap: 22px;
		min-height: 100vh;
		padding: 0 24px 24px;
		background:
			linear-gradient(rgba(18, 16, 16, 0) 50%, rgba(0, 0, 0, 0.25) 50%),
			linear-gradient(90deg, rgba(255, 0, 0, 0.06), rgba(0, 255, 0, 0.02), rgba(0, 0, 255, 0.06)),
			var(--surface-container-lowest);
		background-size:
			100% 2px,
			3px 100%,
			auto;
		color: var(--on-surface);
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		margin: 0 -24px;
		padding: 18px 24px;
		border-bottom: 1px solid var(--outline-variant);
		background: var(--surface-container);
		box-shadow:
			inset 0 -1px 0 rgba(255, 255, 255, 0.05),
			0 8px 24px rgba(0, 0, 0, 0.28);
	}

	.eyebrow {
		margin: 0 0 6px;
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.76rem;
		font-weight: 650;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		color: var(--tertiary);
		font-size: clamp(2rem, 5vw, 3.2rem);
		font-weight: 800;
		line-height: 1;
	}

	h2 {
		font-size: 1.1rem;
	}

	.create-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		width: min(1180px, 100%);
		margin: 0 auto;
		padding: 18px;
		border: 1px solid var(--outline-variant);
		border-radius: 4px;
		background: var(--surface-container);
		box-shadow:
			inset 0 0 4px rgba(0, 0, 0, 0.5),
			inset 0 1px 2px rgba(0, 0, 0, 0.8);
	}

	.create-row p {
		margin-top: 5px;
		color: var(--on-surface-variant);
	}

	form {
		display: flex;
		gap: 8px;
	}

	input {
		min-width: 0;
		border: 1px solid var(--outline-variant);
		border-radius: 2px;
		padding: 10px 11px;
		background: var(--surface-container-lowest);
		color: var(--on-surface);
	}

	input:focus {
		border-color: var(--tertiary);
		outline: 2px solid rgba(171, 214, 0, 0.25);
	}

	button,
	.board-link {
		min-height: 40px;
		border: 1px solid var(--outline-variant);
		border-radius: 2px;
		padding: 9px 12px;
		background: var(--surface-container-low);
		color: var(--on-surface);
		font-weight: 750;
		text-decoration: none;
		transition:
			transform 150ms ease,
			border-color 150ms ease,
			background 150ms ease,
			color 150ms ease;
	}

	button:hover,
	.board-link:hover {
		border-color: var(--tertiary);
		background: var(--surface-bright);
		color: var(--tertiary);
	}

	button:active,
	.board-link:active {
		transform: translateY(2px);
	}

	.primary {
		border-color: var(--tertiary);
		background: var(--tertiary);
		color: #161e00;
	}

	.ghost {
		background: transparent;
	}

	.danger {
		border-color: rgba(255, 180, 171, 0.5);
		color: var(--error);
	}

	.form-error {
		width: min(1180px, 100%);
		margin: 0 auto;
		color: var(--error);
		font-weight: 650;
	}

	.board-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 16px;
		width: min(1180px, 100%);
		margin: 0 auto;
	}

	.board-card,
	.empty-state {
		display: grid;
		gap: 14px;
		padding: 16px;
		border: 1px solid var(--outline-variant);
		border-radius: 4px;
		background: var(--surface-container);
		box-shadow:
			0 0 8px rgba(171, 214, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
	}

	.board-link {
		display: grid;
		gap: 4px;
		padding: 0;
		border: 0;
	}

	.board-link span {
		overflow-wrap: anywhere;
		font-size: 1.2rem;
	}

	.board-link small {
		color: var(--tertiary);
	}

	.rename {
		display: grid;
		grid-template-columns: 1fr auto;
	}

	.rename input {
		width: 100%;
	}

	.empty-state {
		grid-column: 1 / -1;
		min-height: 180px;
		place-items: center;
		text-align: center;
	}

	.empty-state p {
		color: var(--on-surface-variant);
	}

	@media (max-width: 720px) {
		.boards-page {
			padding: 0 16px 16px;
		}

		.topbar,
		.create-row {
			align-items: stretch;
			flex-direction: column;
		}

		.topbar {
			margin: 0 -16px;
			padding: 16px;
		}

		.create-row form,
		.topbar form {
			width: 100%;
		}

		.create-row input,
		.create-row button,
		.topbar button {
			width: 100%;
		}
	}
</style>
