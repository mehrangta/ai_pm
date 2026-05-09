<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import { dndzone } from 'svelte-dnd-action';
	import type { ActionData, PageServerData } from './$types';

	type BoardColumn = PageServerData['columns'][number];
	type BoardCard = BoardColumn['cards'][number];

	const flipDurationMs = 160;
	const maxImageBytes = 1_500_000;

	let { data, form }: { data: PageServerData; form: ActionData } = $props();
	let columns = $state<BoardColumn[]>([]);
	let selectedColumnId = $state('');
	let pasteError = $state('');
	let orderError = $state('');
	let copyMessage = $state('');

	$effect(() => {
		columns = data.columns.map((column) => ({
			...column,
			cards: column.cards.map((card) => ({ ...card }))
		}));
	});

	$effect(() => {
		if (!data.columns.some((column) => column.id === selectedColumnId)) {
			selectedColumnId = data.columns[0]?.id ?? '';
		}
	});

	function handleColumnConsider(event: CustomEvent<{ items: BoardColumn[] }>) {
		columns = event.detail.items;
	}

	function handleColumnFinalize(event: CustomEvent<{ items: BoardColumn[] }>) {
		columns = event.detail.items;
		void postAction('reorderColumns', {
			order: JSON.stringify(columns.map((column) => column.id))
		});
	}

	function handleCardConsider(columnId: string, event: CustomEvent<{ items: BoardCard[] }>) {
		columns = columns.map((column) =>
			column.id === columnId
				? {
						...column,
						cards: event.detail.items.map((card, position) => ({ ...card, columnId, position }))
					}
				: column
		);
	}

	function handleCardFinalize(columnId: string, event: CustomEvent<{ items: BoardCard[] }>) {
		handleCardConsider(columnId, event);
		void postAction('moveCards', {
			columns: JSON.stringify(
				columns.map((column) => ({
					id: column.id,
					cardIds: column.cards.map((card) => card.id)
				}))
			)
		});
	}

	async function postAction(action: string, fields: Record<string, string>) {
		orderError = '';
		const body = new FormData();

		for (const [key, value] of Object.entries(fields)) {
			body.set(key, value);
		}

		const response = await fetch(`?/${action}`, {
			method: 'POST',
			body
		});

		if (!response.ok) {
			orderError = 'The new order could not be saved.';
			await invalidateAll();
			return;
		}

		await invalidateAll();
	}

	async function handlePaste(event: ClipboardEvent) {
		const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
			entry.type.startsWith('image/')
		);

		if (!item) return;

		event.preventDefault();
		pasteError = '';
		copyMessage = '';

		if (!selectedColumnId) {
			pasteError = 'Create a column before pasting an image.';
			return;
		}

		const file = item.getAsFile();

		if (!file) {
			pasteError = 'The clipboard image could not be read.';
			return;
		}

		try {
			const image = await compressImage(file);

			if (image.dataUrl.length > maxImageBytes) {
				pasteError = 'Compressed image is still over 1.5 MB.';
				return;
			}

			const body = new FormData();
			body.set('columnId', selectedColumnId);
			body.set('description', 'Pasted image');
			body.set('color', '#ffffff');
			body.set('dataUrl', image.dataUrl);
			body.set('mimeType', image.mimeType);
			body.set('byteSize', String(image.byteSize));
			body.set('width', String(image.width));
			body.set('height', String(image.height));

			const response = await fetch('?/createImageCard', {
				method: 'POST',
				body
			});

			if (!response.ok) {
				pasteError = 'Image is too large or unsupported.';
				return;
			}

			await invalidateAll();
		} catch {
			pasteError = 'The pasted image could not be compressed.';
		}
	}

	async function compressImage(file: File) {
		const bitmap = await createImageBitmap(file);
		const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
		const width = Math.max(1, Math.round(bitmap.width * scale));
		const height = Math.max(1, Math.round(bitmap.height * scale));
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('Canvas is unavailable');
		}

		context.drawImage(bitmap, 0, 0, width, height);
		const blob =
			(await canvasToBlob(canvas, 'image/webp', 0.82)) ??
			(await canvasToBlob(canvas, 'image/jpeg', 0.82));

		if (!blob) {
			throw new Error('Image encoding failed');
		}

		const dataUrl = await blobToDataUrl(blob);

		return {
			dataUrl,
			mimeType: blob.type,
			byteSize: blob.size,
			width,
			height
		};
	}

	function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number) {
		return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mimeType, quality));
	}

	function blobToDataUrl(blob: Blob) {
		return new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.addEventListener('load', () => resolve(reader.result?.toString() ?? ''));
			reader.addEventListener('error', () => reject(reader.error));
			reader.readAsDataURL(blob);
		});
	}

	async function copyImage(card: BoardCard) {
		copyMessage = '';

		if (!card.image) return;

		try {
			if ('ClipboardItem' in window && navigator.clipboard?.write) {
				const response = await fetch(card.image.dataUrl);
				const blob = await response.blob();
				await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
				copyMessage = 'Image copied.';
				return;
			}
		} catch {
			copyMessage = 'Clipboard copy failed; opened image instead.';
		}

		window.open(card.image.dataUrl, '_blank', 'noopener,noreferrer');
	}
</script>

<svelte:window onpaste={handlePaste} />

<main class="board-page">
	<header class="topbar">
		<div>
			<a class="back-link" href="/boards">Boards</a>
			<h1>{data.board.title}</h1>
			<p>{columns.length} columns</p>
		</div>

		<div class="top-actions">
			<label>
				Paste target
				<select bind:value={selectedColumnId} disabled={!columns.length}>
					{#each columns as column}
						<option value={column.id}>{column.title}</option>
					{/each}
				</select>
			</label>

			<form method="post" action="?/signOut" use:enhance>
				<button class="ghost">Sign out</button>
			</form>
		</div>
	</header>

	<section class="create-column" aria-labelledby="new-column-title">
		<h2 id="new-column-title">New column</h2>
		<form method="post" action="?/createColumn" use:enhance>
			<input name="title" placeholder="Column title" maxlength="100" required />
			<input type="color" name="color" value="#f4f4f5" aria-label="Column color" />
			<button class="primary">Add column</button>
		</form>
	</section>

	{#if form?.message || pasteError || orderError || copyMessage}
		<div class:error-state={form?.message || pasteError || orderError} class="notice">
			{form?.message || pasteError || orderError || copyMessage}
		</div>
	{/if}

	<section
		class="columns"
		aria-label="Kanban columns"
		use:dndzone={{ items: columns, flipDurationMs, type: 'columns' }}
		onconsider={handleColumnConsider}
		onfinalize={handleColumnFinalize}
	>
		{#each columns as column (column.id)}
			<article class="column" style:background-color={column.color} animate:flip={{ duration: flipDurationMs }}>
				<header class="column-header">
					<form method="post" action="?/updateColumn" use:enhance>
						<input type="hidden" name="columnId" value={column.id} />
						<input name="title" value={column.title} maxlength="100" aria-label="Column title" required />
						<input type="color" name="color" value={column.color} aria-label="Column color" />
						<button>Save</button>
					</form>

					<form method="post" action="?/deleteColumn" use:enhance>
						<input type="hidden" name="columnId" value={column.id} />
						<button class="danger">Delete</button>
					</form>
				</header>

				<form class="new-card" method="post" action="?/createCard" use:enhance>
					<input type="hidden" name="columnId" value={column.id} />
					<textarea name="description" rows="2" maxlength="2000" placeholder="Add a card" required></textarea>
					<div>
						<input type="color" name="color" value="#ffffff" aria-label="Card color" />
						<button class="primary">Add card</button>
					</div>
				</form>

				<div
					class="cards"
					use:dndzone={{ items: column.cards, flipDurationMs, type: 'cards' }}
					onconsider={(event: CustomEvent<{ items: BoardCard[] }>) =>
						handleCardConsider(column.id, event)}
					onfinalize={(event: CustomEvent<{ items: BoardCard[] }>) =>
						handleCardFinalize(column.id, event)}
				>
					{#each column.cards as card (card.id)}
						<article class="card" style:background-color={card.color} animate:flip={{ duration: flipDurationMs }}>
							{#if card.image}
								<img
									src={card.image.dataUrl}
									alt={card.description}
									width={card.image.width}
									height={card.image.height}
								/>
								<button class="copy-button" type="button" onclick={() => copyImage(card)}>
									Copy image
								</button>
							{/if}

							<form method="post" action="?/updateCard" use:enhance>
								<input type="hidden" name="cardId" value={card.id} />
								<textarea name="description" rows="3" maxlength="2000" required>{card.description}</textarea>
								<div class="card-actions">
									<input type="color" name="color" value={card.color} aria-label="Card color" />
									<button>Save</button>
								</div>
							</form>

							<form method="post" action="?/deleteCard" use:enhance>
								<input type="hidden" name="cardId" value={card.id} />
								<button class="danger full">Delete card</button>
							</form>
						</article>
					{/each}
				</div>
			</article>
		{:else}
			<div class="empty-board">
				<h2>Add a column to start</h2>
				<p>Cards and pasted images need a column destination.</p>
			</div>
		{/each}
	</section>
</main>

<style>
	.board-page {
		display: grid;
		grid-template-rows: auto auto auto 1fr;
		gap: 18px;
		min-height: 100vh;
		padding: 20px;
		overflow: hidden;
	}

	.topbar,
	.create-column {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
	}

	.back-link {
		color: #0f766e;
		font-size: 0.9rem;
		font-weight: 750;
		text-decoration: none;
	}

	h1,
	h2,
	p {
		margin: 0;
	}

	h1 {
		margin-top: 4px;
		font-size: clamp(1.8rem, 5vw, 3.1rem);
		line-height: 1;
		overflow-wrap: anywhere;
	}

	.topbar p {
		margin-top: 6px;
		color: #64748b;
	}

	.top-actions {
		display: flex;
		align-items: end;
		gap: 10px;
	}

	label {
		display: grid;
		gap: 6px;
		color: #475569;
		font-size: 0.82rem;
		font-weight: 750;
	}

	.create-column {
		padding: 14px;
		border: 1px solid #d8d9d2;
		border-radius: 8px;
		background: #ffffff;
	}

	.create-column form,
	.column-header,
	.column-header form,
	.new-card div,
	.card-actions,
	.top-actions form {
		display: flex;
		gap: 8px;
	}

	input,
	textarea,
	select {
		min-width: 0;
		border: 1px solid #cbd5d1;
		border-radius: 7px;
		padding: 9px 10px;
		background: rgba(255, 255, 255, 0.9);
		color: #1f2933;
	}

	textarea {
		width: 100%;
		resize: vertical;
	}

	input[type='color'] {
		width: 42px;
		min-width: 42px;
		padding: 3px;
	}

	input:focus,
	textarea:focus,
	select:focus {
		border-color: #0f766e;
		outline: 3px solid rgba(15, 118, 110, 0.14);
	}

	button {
		min-height: 38px;
		border: 1px solid #cbd5d1;
		border-radius: 7px;
		padding: 8px 11px;
		background: #ffffff;
		color: #1f2933;
		font-weight: 750;
		white-space: nowrap;
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

	.full {
		width: 100%;
	}

	.notice {
		padding: 11px 13px;
		border: 1px solid #bbf7d0;
		border-radius: 8px;
		background: #f0fdf4;
		color: #166534;
		font-weight: 700;
	}

	.error-state {
		border-color: #fecaca;
		background: #fff1f2;
		color: #b42318;
	}

	.columns {
		display: flex;
		align-items: flex-start;
		gap: 16px;
		min-height: 0;
		overflow-x: auto;
		overflow-y: hidden;
		padding-bottom: 16px;
	}

	.column {
		display: grid;
		flex: 0 0 min(360px, calc(100vw - 40px));
		grid-template-rows: auto auto 1fr;
		gap: 12px;
		max-height: 100%;
		padding: 12px;
		border: 1px solid rgba(31, 41, 51, 0.12);
		border-radius: 8px;
		box-shadow: 0 14px 32px rgba(31, 41, 51, 0.08);
	}

	.column-header {
		align-items: start;
		justify-content: space-between;
	}

	.column-header form:first-child {
		flex: 1;
	}

	.column-header input[name='title'] {
		flex: 1;
		font-weight: 750;
	}

	.new-card {
		display: grid;
		gap: 8px;
		padding: 10px;
		border: 1px dashed rgba(31, 41, 51, 0.22);
		border-radius: 8px;
		background: rgba(255, 255, 255, 0.45);
	}

	.new-card div,
	.card-actions {
		justify-content: space-between;
	}

	.cards {
		display: grid;
		align-content: start;
		gap: 10px;
		min-height: 96px;
		overflow-y: auto;
		padding: 2px 2px 12px;
	}

	.card {
		display: grid;
		gap: 10px;
		padding: 10px;
		border: 1px solid rgba(31, 41, 51, 0.12);
		border-radius: 8px;
		box-shadow: 0 8px 18px rgba(31, 41, 51, 0.08);
	}

	.card img {
		display: block;
		width: 100%;
		height: auto;
		max-height: 320px;
		border-radius: 7px;
		object-fit: contain;
		background: #111827;
	}

	.copy-button {
		justify-self: start;
		border-color: #99f6e4;
		color: #0f766e;
	}

	.card form {
		display: grid;
		gap: 8px;
	}

	.empty-board {
		display: grid;
		flex: 1;
		min-width: min(600px, calc(100vw - 40px));
		min-height: 280px;
		place-items: center;
		border: 1px dashed #cbd5d1;
		border-radius: 8px;
		background: #ffffff;
		text-align: center;
	}

	.empty-board p {
		margin-top: 6px;
		color: #64748b;
	}

	@media (max-width: 780px) {
		.board-page {
			padding: 14px;
			overflow: visible;
		}

		.topbar,
		.create-column,
		.top-actions,
		.create-column form {
			align-items: stretch;
			flex-direction: column;
		}

		.top-actions {
			width: 100%;
		}

		.create-column input:not([type='color']),
		.create-column button,
		.top-actions button,
		select {
			width: 100%;
		}
	}
</style>
