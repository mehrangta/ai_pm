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
		display: grid;
		gap: 28px;
		min-height: 100vh;
		padding: 28px;
	}

	.topbar,
	.create-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 18px;
		width: min(1180px, 100%);
		margin: 0 auto;
	}

	.eyebrow {
		margin: 0 0 6px;
		color: #64748b;
		font-size: 0.84rem;
		font-weight: 650;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		font-size: clamp(2rem, 6vw, 3.6rem);
		line-height: 1;
	}

	h2 {
		font-size: 1.1rem;
	}

	.create-row {
		padding: 18px;
		border: 1px solid #d8d9d2;
		border-radius: 8px;
		background: #ffffff;
	}

	.create-row p {
		margin-top: 5px;
		color: #64748b;
	}

	form {
		display: flex;
		gap: 8px;
	}

	input {
		min-width: 0;
		border: 1px solid #cbd5d1;
		border-radius: 7px;
		padding: 10px 11px;
		background: #fbfbf8;
		color: #1f2933;
	}

	input:focus {
		border-color: #0f766e;
		outline: 3px solid rgba(15, 118, 110, 0.14);
	}

	button,
	.board-link {
		min-height: 40px;
		border: 1px solid #cbd5d1;
		border-radius: 7px;
		padding: 9px 12px;
		background: #ffffff;
		color: #1f2933;
		font-weight: 750;
		text-decoration: none;
	}

	.primary {
		border-color: #183b56;
		background: #183b56;
		color: #ffffff;
	}

	.ghost {
		background: transparent;
	}

	.danger {
		border-color: #fecaca;
		color: #b42318;
	}

	.form-error {
		width: min(1180px, 100%);
		margin: 0 auto;
		color: #b42318;
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
		border: 1px solid #d8d9d2;
		border-radius: 8px;
		background: #ffffff;
		box-shadow: 0 12px 28px rgba(31, 41, 51, 0.06);
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
		color: #0f766e;
	}

	.rename {
		display: grid;
		grid-template-columns: 1fr auto;
	}

	.empty-state {
		grid-column: 1 / -1;
		min-height: 180px;
		place-items: center;
		text-align: center;
	}

	.empty-state p {
		color: #64748b;
	}

	@media (max-width: 720px) {
		.boards-page {
			padding: 18px;
		}

		.topbar,
		.create-row {
			align-items: stretch;
			flex-direction: column;
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
