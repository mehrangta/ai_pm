<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageServerData } from './$types';

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
</script>

<main class="boards-page">
	<header class="topbar">
		<div>
			<p class="eyebrow">Signed in as {data.user.email}</p>
			<h1>Boards</h1>
		</div>

		<form method="post" action="?/signOut" use:enhance>
			<button class="ghost">Sign out</button>
		</form>
	</header>

	<section class="create-row" aria-labelledby="create-board-title">
		<div>
			<h2 id="create-board-title">Create board</h2>
			<p>Start a separate workspace for each project, sprint, or personal plan.</p>
		</div>

		<form method="post" action="?/createBoard" use:enhance>
			<input name="title" placeholder="Board title" maxlength="120" required />
			<button class="primary">Create</button>
		</form>
	</section>

	{#if form?.message}
		<p class="form-error">{form.message}</p>
	{/if}

	<section class="board-grid" aria-label="Your boards">
		{#each data.boards as board}
			<article class="board-card">
				<a class="board-link" href={`/boards/${board.id}`}>
					<span>{board.title}</span>
					<small>Open board</small>
				</a>

				<form class="rename" method="post" action="?/renameBoard" use:enhance>
					<input type="hidden" name="boardId" value={board.id} />
					<input name="title" value={board.title} maxlength="120" aria-label="Board title" required />
					<button>Rename</button>
				</form>

				<form method="post" action="?/deleteBoard" use:enhance>
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
