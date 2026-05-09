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

	async function handleRenameBoard(board: BoardSummary) {
		const title = window.prompt('Board title', board.title)?.trim();

		if (!title || title === board.title) {
			return;
		}

		try {
			await renameBoard(board.id, title);
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
		<div class="topbar-title">
			<p class="eyebrow">Signed in as {user?.email ?? '...'}</p>
			<h1>Boards</h1>
		</div>

		<div class="topbar-actions">
			<button class="icon-button" aria-label="Notifications" title="Notifications" type="button">
				<span aria-hidden="true">!</span>
			</button>
			<button class="icon-button" aria-label="Settings" title="Settings" type="button">
				<span aria-hidden="true">*</span>
			</button>
		</div>

		<form class="sign-out-form" onsubmit={handleSignOut}>
			<button class="ghost">Sign out</button>
		</form>
	</header>

	{#if message}
		<p class="form-error">{message}</p>
	{/if}

	<section class="board-grid" aria-label="Your boards">
		{#if loading}
			<div class="empty-state">
				<h2>Loading boards</h2>
			</div>
		{:else}
			{#each boards as board, index (board.id)}
				<article class="board-card">
					<div class="card-rail"></div>
					<a class="board-link" href={`/boards/${board.id}`}>
						<span>{board.title}</span>
						<small>#BRD-{String(index + 1).padStart(3, '0')}</small>
					</a>

					<div class="card-footer">
						<a class="open-link" href={`/boards/${board.id}`}>Open board <span aria-hidden="true">-&gt;</span></a>
						<div class="card-actions">
							<button
								class="icon-button compact"
								type="button"
								aria-label="Rename board"
								title="Rename"
								onclick={() => handleRenameBoard(board)}
							>
								<span aria-hidden="true">E</span>
							</button>
							<form onsubmit={handleDelete}>
								<input type="hidden" name="boardId" value={board.id} />
								<button class="icon-button compact danger" aria-label="Delete board" title="Delete">
									<span aria-hidden="true">X</span>
								</button>
							</form>
						</div>
					</div>
				</article>
			{:else}
				<div class="empty-state">
					<h2>No boards yet</h2>
					<p>Create your first board to add columns, cards, and pasted image notes.</p>
				</div>
			{/each}

			<form class="create-card" onsubmit={handleCreate} aria-labelledby="create-board-title">
				<div class="create-icon" aria-hidden="true">+</div>
				<label id="create-board-title" for="board-title">Create board</label>
				<div class="create-controls">
					<input id="board-title" name="title" placeholder="Board title" maxlength="120" required />
					<button class="primary icon-button" aria-label="Create board">
						<span aria-hidden="true">+</span>
					</button>
				</div>
			</form>
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
		--surface-container-highest: #353435;
		--surface-bright: #3a3939;
		--on-surface: #e5e2e1;
		--on-surface-variant: #c8c5cb;
		--outline: #919095;
		--outline-variant: #47464b;
		--tertiary: #abd600;
		--error: #ffb4ab;
		display: flex;
		flex-direction: column;
		gap: 32px;
		min-height: 100vh;
		padding: 0 40px 40px;
		background:
			linear-gradient(rgba(20, 19, 19, 0.95), rgba(20, 19, 19, 0.95)),
			repeating-linear-gradient(0deg, transparent, transparent 1px, rgba(255, 255, 255, 0.025) 1px, rgba(255, 255, 255, 0.025) 2px),
			var(--surface);
		background-size:
			100% 100%,
			100% 4px,
			auto;
		color: var(--on-surface);
		font-family: Inter, ui-sans-serif, system-ui, sans-serif;
	}

	.topbar {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: 24px;
		min-height: 64px;
		margin: 0 -40px;
		padding: 0 40px;
		border-bottom: 1px solid var(--outline-variant);
		background: var(--surface-container);
		box-shadow: inset 0 -1px 0 rgba(255, 255, 255, 0.05);
	}

	.topbar-title {
		display: flex;
		min-width: 0;
		align-items: center;
		gap: 24px;
	}

	.topbar-actions,
	.card-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.eyebrow {
		margin: 0;
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.8125rem;
		font-weight: 500;
		letter-spacing: 0.05em;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		color: var(--tertiary);
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1;
		text-transform: uppercase;
	}

	h2 {
		font-size: 1.1rem;
	}

	form {
		display: flex;
		gap: 8px;
	}

	input {
		min-width: 0;
		border: 1px solid var(--outline-variant);
		border-radius: 2px;
		padding: 9px 11px;
		background: var(--surface-container-lowest);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.5);
		color: var(--on-surface);
	}

	input:focus {
		border-color: var(--tertiary);
		outline: 2px solid rgba(171, 214, 0, 0.25);
	}

	button,
	.open-link {
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
	.open-link:hover {
		border-color: var(--tertiary);
		background: var(--surface-bright);
		color: var(--tertiary);
	}

	button:active,
	.open-link:active {
		transform: translateY(2px);
	}

	.primary {
		border-color: var(--tertiary);
		background: var(--tertiary);
		color: #161e00;
	}

	.ghost {
		background: transparent;
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.8125rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.danger {
		color: var(--error);
	}

	.form-error {
		width: min(1280px, 100%);
		margin: 0 auto;
		color: var(--error);
		font-weight: 650;
	}

	.board-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
		gap: 24px;
		width: min(1280px, 100%);
		margin: 0 auto;
	}

	.board-card {
		position: relative;
		display: flex;
		min-height: 140px;
		flex-direction: column;
		gap: 12px;
		overflow: hidden;
		padding: 16px;
		border: 1px solid rgba(245, 245, 245, 0.1);
		background: var(--surface-container);
		background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.035), transparent);
		box-shadow:
			0 0 8px rgba(171, 214, 0, 0.08),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		transition:
			border-color 150ms ease,
			box-shadow 150ms ease;
	}

	.board-card:hover {
		border-color: var(--outline-variant);
		box-shadow:
			0 0 8px rgba(171, 214, 0, 0.16),
			inset 0 1px 0 rgba(255, 255, 255, 0.06);
	}

	.card-rail {
		position: absolute;
		top: 0;
		left: 0;
		width: 100%;
		height: 4px;
		background: var(--surface-container-highest);
		transition: background 150ms ease;
	}

	.board-card:hover .card-rail {
		background: rgba(171, 214, 0, 0.22);
	}

	.board-link {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		color: var(--on-surface);
		text-decoration: none;
	}

	.board-link span {
		min-width: 0;
		overflow-wrap: anywhere;
		font-size: 1.5rem;
		font-weight: 700;
		line-height: 1.35;
		transition: color 150ms ease;
	}

	.board-card:hover .board-link span {
		color: var(--tertiary);
	}

	.board-link small {
		flex-shrink: 0;
		padding: 2px 8px;
		border: 1px solid rgba(71, 70, 75, 0.5);
		background: var(--surface-container-highest);
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.6875rem;
		line-height: 1.3;
		text-transform: uppercase;
	}

	.card-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-top: auto;
		padding-top: 8px;
		border-top: 1px solid rgba(71, 70, 75, 0.45);
	}

	.open-link {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-height: auto;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--tertiary);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.8125rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.icon-button {
		display: inline-grid;
		width: 40px;
		height: 40px;
		min-height: 40px;
		place-items: center;
		padding: 0;
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
	}

	.icon-button.compact {
		width: 32px;
		height: 32px;
		min-height: 32px;
		font-size: 0.75rem;
	}

	.empty-state,
	.create-card {
		display: grid;
		gap: 14px;
		grid-column: 1 / -1;
		min-height: 180px;
		place-items: center;
		border: 1px dashed rgba(71, 70, 75, 0.75);
		background: var(--surface-container-lowest);
		text-align: center;
	}

	.empty-state p {
		color: var(--on-surface-variant);
	}

	.create-card {
		grid-column: auto;
		min-height: 140px;
		padding: 20px;
		cursor: default;
		transition: border-color 150ms ease;
	}

	.create-card:hover {
		border-color: rgba(171, 214, 0, 0.55);
	}

	.create-icon {
		display: grid;
		width: 48px;
		height: 48px;
		place-items: center;
		border: 1px solid var(--outline-variant);
		border-radius: 999px;
		background: var(--surface-container);
		color: var(--on-surface-variant);
		font-size: 1.5rem;
		font-weight: 700;
		transition:
			border-color 150ms ease,
			color 150ms ease;
	}

	.create-card:hover .create-icon,
	.create-card:hover label {
		border-color: var(--tertiary);
		color: var(--tertiary);
	}

	.create-card label {
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.8125rem;
		font-weight: 500;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.create-controls {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 8px;
		width: 100%;
	}

	@media (max-width: 720px) {
		.boards-page {
			padding: 0 16px 24px;
		}

		.topbar {
			grid-template-columns: 1fr;
			align-items: stretch;
			gap: 14px;
			margin: 0 -16px;
			padding: 16px;
		}

		.topbar-title {
			align-items: flex-start;
			flex-direction: column;
			gap: 8px;
		}

		.topbar-actions {
			display: none;
		}

		.sign-out-form,
		.sign-out-form button {
			width: 100%;
		}

		.card-footer {
			align-items: flex-start;
			flex-direction: column;
		}

		.create-controls {
			grid-template-columns: 1fr;
		}

		.create-controls button {
			width: 100%;
		}
	}
</style>
