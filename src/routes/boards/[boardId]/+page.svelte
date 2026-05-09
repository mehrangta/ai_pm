<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { SHADOW_ITEM_MARKER_PROPERTY_NAME, dndzone } from 'svelte-dnd-action';
	import {
		boardAction,
		getBoard,
		ApiError,
		signOut,
		type BoardColumn,
		type BoardCard
	} from '$lib/api';

	type BoardInfo = {
		id: string;
		title: string;
		userId: string;
	};

	type OrderAction = 'reorderColumns' | 'moveCards';

	type OrderSaveState = {
		inFlight: boolean;
		pending: Record<string, unknown> | null;
	};

	const flipDurationMs = 160;
	const maxImageBytes = 1_500_000;
	const orderSaveState: Record<OrderAction, OrderSaveState> = {
		reorderColumns: { inFlight: false, pending: null },
		moveCards: { inFlight: false, pending: null }
	};

	let board = $state<BoardInfo | null>(null);
	let columns = $state<BoardColumn[]>([]);
	let selectedColumnId = $state('');
	let notice = $state('');
	let pasteError = $state('');
	let orderError = $state('');
	let copyMessage = $state('');

	onMount(() => {
		void loadBoard();
	});

	const currentBoardId = () => page.params.boardId ?? '';

	async function loadBoard() {
		try {
			const data = await getBoard(currentBoardId());
			board = data.board;
			columns = data.columns.map((column) => ({
				...column,
				cards: column.cards.map((card) => ({ ...card }))
			}));

			if (!columns.some((column) => column.id === selectedColumnId)) {
				selectedColumnId = columns[0]?.id ?? '';
			}
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				await goto('/login');
				return;
			}

			notice = error instanceof Error ? error.message : 'Board could not be loaded';
		}
	}

	function handleColumnConsider(event: CustomEvent<{ items: BoardColumn[] }>) {
		columns = event.detail.items;
	}

	function handleColumnFinalize(event: CustomEvent<{ items: BoardColumn[] }>) {
		columns = event.detail.items;
		persistOrder('reorderColumns', {
			order: columns.map((column) => column.id)
		});
	}

	function isShadowCard(card: BoardCard) {
		return Boolean((card as BoardCard & { [SHADOW_ITEM_MARKER_PROPERTY_NAME]?: boolean })[
			SHADOW_ITEM_MARKER_PROPERTY_NAME
		]);
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
		persistOrder('moveCards', {
			columns: columns.map((column) => ({
				id: column.id,
				cardIds: column.cards.filter((card) => !isShadowCard(card)).map((card) => card.id)
			}))
		});
	}

	function persistOrder(action: OrderAction, fields: Record<string, unknown>) {
		notice = '';
		orderError = '';
		orderSaveState[action].pending = fields;

		if (!orderSaveState[action].inFlight) {
			void flushOrder(action);
		}
	}

	async function flushOrder(action: OrderAction) {
		const state = orderSaveState[action];
		state.inFlight = true;

		while (state.pending) {
			const fields = state.pending;
			state.pending = null;

			try {
				await boardAction(currentBoardId(), { action, ...fields });
			} catch {
				if (!state.pending) {
					orderError = 'The new order could not be saved.';
					await loadBoard();
				}
			}
		}

		state.inFlight = false;
	}

	async function postAction(action: string, fields: Record<string, unknown>) {
		notice = '';
		orderError = '';

		try {
			await boardAction(currentBoardId(), { action, ...fields });
			await loadBoard();
		} catch (error) {
			orderError = error instanceof Error ? error.message : 'Board update failed';
			await loadBoard();
		}
	}

	async function submitBoardForm(event: SubmitEvent, action: string) {
		event.preventDefault();
		const form = event.currentTarget as HTMLFormElement;
		const values = Object.fromEntries(
			Array.from(new FormData(form).entries()).map(([key, value]) => [key, value.toString()])
		);

		await postAction(action, values);

		if (!orderError && (action === 'createColumn' || action === 'createCard')) {
			form.reset();
		}
	}

	async function handleSignOut(event: SubmitEvent) {
		event.preventDefault();
		await signOut();
		await goto('/login');
	}

	function resetTransientMessages() {
		notice = '';
		pasteError = '';
		orderError = '';
		copyMessage = '';
	}

	async function handlePaste(event: ClipboardEvent) {
		const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
			entry.type.startsWith('image/')
		);

		if (!item) return;

		event.preventDefault();
		resetTransientMessages();

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

			await boardAction(currentBoardId(), {
				action: 'createImageCard',
				columnId: selectedColumnId,
				description: 'Pasted image',
				color: '#ffffff',
				dataUrl: image.dataUrl,
				mimeType: image.mimeType,
				byteSize: image.byteSize,
				width: image.width,
				height: image.height
			});
			await loadBoard();
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

	async function dataUrlToRgba(dataUrl: string) {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('Canvas is unavailable');
		}

		context.drawImage(bitmap, 0, 0);
		const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);

		return {
			rgba: new Uint8Array(pixels.data),
			width: bitmap.width,
			height: bitmap.height
		};
	}

	async function copyImageWithTauri(card: BoardCard) {
		const [{ isTauri }, { Image }, { writeImage }] = await Promise.all([
			import('@tauri-apps/api/core'),
			import('@tauri-apps/api/image'),
			import('@tauri-apps/plugin-clipboard-manager')
		]);

		if (!isTauri()) {
			return false;
		}

		const { rgba, width, height } = await dataUrlToRgba(card.image!.dataUrl);
		const image = await Image.new(rgba, width, height);

		try {
			await writeImage(image);
		} finally {
			await image.close();
		}

		return true;
	}

	async function copyImageWithBrowserClipboard(card: BoardCard) {
		if (!('ClipboardItem' in window) || !navigator.clipboard?.write) {
			return false;
		}

		const response = await fetch(card.image!.dataUrl);
		const blob = await response.blob();
		await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);

		return true;
	}

	async function copyImage(card: BoardCard) {
		copyMessage = '';

		if (!card.image) return;

		try {
			if ((await copyImageWithTauri(card)) || (await copyImageWithBrowserClipboard(card))) {
				copyMessage = 'Image copied.';
				return;
			}
		} catch {
			// Fall through to the user-facing unsupported message.
		}

		copyMessage = 'Image clipboard copy is not available in this environment.';
	}
</script>

<svelte:window onpaste={handlePaste} />

<main class="board-page">
	<header class="topbar">
		<div>
			<a class="back-link" href="/boards">Boards</a>
			<h1>{board?.title ?? 'Loading board'}</h1>
			<p>{columns.length} columns</p>
		</div>

		<div class="top-actions">
			<label>
				Paste target
				<select bind:value={selectedColumnId} disabled={!columns.length}>
					{#each columns as column (column.id)}
						<option value={column.id}>{column.title}</option>
					{/each}
				</select>
			</label>

			<form onsubmit={handleSignOut}>
				<button class="ghost">Sign out</button>
			</form>
		</div>
	</header>

	<section class="create-column" aria-labelledby="new-column-title">
		<h2 id="new-column-title">New column</h2>
		<form onsubmit={(event) => submitBoardForm(event, 'createColumn')}>
			<input name="title" placeholder="Column title" maxlength="100" required />
			<input type="color" name="color" value="#f4f4f5" aria-label="Column color" />
			<button class="primary">Add column</button>
		</form>
	</section>

	{#if notice || pasteError || orderError || copyMessage}
		<div class:error-state={notice || pasteError || orderError} class="notice">
			{notice || pasteError || orderError || copyMessage}
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
					<form onsubmit={(event) => submitBoardForm(event, 'updateColumn')}>
						<input type="hidden" name="columnId" value={column.id} />
						<input name="title" value={column.title} maxlength="100" aria-label="Column title" required />
						<input type="color" name="color" value={column.color} aria-label="Column color" />
						<button>Save</button>
					</form>

					<form onsubmit={(event) => submitBoardForm(event, 'deleteColumn')}>
						<input type="hidden" name="columnId" value={column.id} />
						<button class="danger">Delete</button>
					</form>
				</header>

				<form class="new-card" onsubmit={(event) => submitBoardForm(event, 'createCard')}>
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

							<form onsubmit={(event) => submitBoardForm(event, 'updateCard')}>
								<input type="hidden" name="cardId" value={card.id} />
								<textarea name="description" rows="3" maxlength="2000" required>{card.description}</textarea>
								<div class="card-actions">
									<input type="color" name="color" value={card.color} aria-label="Card color" />
									<button>Save</button>
								</div>
							</form>

							<form onsubmit={(event) => submitBoardForm(event, 'deleteCard')}>
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
