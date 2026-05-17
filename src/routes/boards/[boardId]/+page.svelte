<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { flip } from 'svelte/animate';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { SHADOW_ITEM_MARKER_PROPERTY_NAME, dndzone } from 'svelte-dnd-action';
	import {
		boardAction,
		getBoard,
		ApiError,
		type BoardColumn,
		type BoardCard
	} from '$lib/api';

	type BoardInfo = {
		id: string;
		title: string;
		projectLocation: string;
		userId: string;
	};

	type OrderAction = 'reorderColumns' | 'moveCards';

	type OrderSaveState = {
		inFlight: boolean;
		pending: Record<string, unknown> | null;
	};

	type CreateImageCardResponse = {
		ok: true;
		cardId: string;
		position: number;
	};

	type PendingImageUpload = {
		cardId: string;
		savedDescription: string;
		pendingDescription: string | null;
		syncPromise: Promise<void> | null;
	};

	type GitBranch = {
		name: string;
		current: boolean;
	};

	const flipDurationMs = 160;
	const maxImageBytes = 1_500_000;
	const pendingUploadEditGraceMs = 1_500;
	const pendingUploadSyncAttempts = 6;
	const pendingUploadSyncDelayMs = 500;
	const applyTargetStorageKeyPrefix = 'ai-pm:apply-target-column:';
	const orderSaveState: Record<OrderAction, OrderSaveState> = {
		reorderColumns: { inFlight: false, pending: null },
		moveCards: { inFlight: false, pending: null }
	};
	const pendingImageCardIds = new SvelteSet<string>();
	const pendingCardDescriptions = new SvelteMap<string, string>();
	const pendingImageUploads = new SvelteMap<string, PendingImageUpload>();

	let board = $state<BoardInfo | null>(null);
	let columns = $state<BoardColumn[]>([]);
	let selectedColumnId = $state('');
	let notice = $state('');
	let pasteError = $state('');
	let orderError = $state('');
	let copyMessage = $state('');
	let query = $state('');
	let projectLocationDraft = $state('');
	let projectLocationSaving = $state(false);
	let gitStatus = $state<'unknown' | 'checking' | 'git' | 'no-git'>('unknown');
	let deviceTools = $state<Record<string, 'unknown' | 'checking' | 'installed' | 'missing'>>({
		git: 'unknown',
		codex: 'unknown',
		gh: 'unknown'
	});
	let applyTargetColumnId = $state('');
	let applyingCardId = $state('');
	let applyProgress = $state('');
	let applyLogEntries = $state<string[]>([]);
	let applyLogStatus = $state<'idle' | 'running' | 'succeeded' | 'failed'>('idle');
	let applyLogText = $derived(applyLogEntries.join('\n'));
	let branches = $state<GitBranch[]>([]);
	let branchesLoading = $state(false);
	let branchMessage = $state('');
	let branchError = $state('');
	let branchActionName = $state('');
	let branchDeleteCandidate = $state('');

	onMount(() => {
		void loadBoard();
	});

	const currentBoardId = () => page.params.boardId ?? '';

	async function loadBoard() {
		try {
			const data = await getBoard(currentBoardId());
			board = data.board;
			projectLocationDraft = data.board.projectLocation;
			columns = data.columns.map((column) => ({
				...column,
				cards: column.cards.map((card) => ({ ...card }))
			}));

			if (!columns.some((column) => column.id === selectedColumnId)) {
				selectedColumnId = columns[0]?.id ?? '';
			}

			const savedApplyTargetColumnId = readApplyTargetColumnId(data.board.id);
			applyTargetColumnId = columns.some((column) => column.id === savedApplyTargetColumnId)
				? savedApplyTargetColumnId
				: (columns[0]?.id ?? '');

			void checkGitStatus(data.board.projectLocation);
			void checkDeviceTools();
			void loadBranches();
		} catch (error) {
			if (error instanceof ApiError && error.status === 401) {
				await goto('/login');
				return;
			}

			notice = error instanceof Error ? error.message : 'Board could not be loaded';
		}
	}

	async function checkGitStatus(location: string) {
		if (!location) {
			gitStatus = 'unknown';
			return;
		}

		gitStatus = 'checking';

		try {
			const { isTauri } = await import('@tauri-apps/api/core');

			if (!isTauri()) {
				gitStatus = 'unknown';
				return;
			}

			const { Command } = await import('@tauri-apps/plugin-shell');
			const command = Command.create('cmd', ['/c', 'git', 'rev-parse', '--git-dir'], { cwd: location });
			const output = await command.execute();
			gitStatus = output.code === 0 ? 'git' : 'no-git';
		} catch {
			gitStatus = 'no-git';
		}
	}

	function parseGitBranches(output: string) {
		return output
			.split('\n')
			.map((line) => {
				const normalized = line.trimEnd();
				return {
					name: normalized.slice(2).trim(),
					current: normalized.startsWith('*')
				};
			})
			.filter((branch) => branch.name);
	}

	function isProtectedBranch(branch: GitBranch) {
		return branch.name === 'main' || branch.name === 'master';
	}

	function branchRenameTitle(branch: GitBranch) {
		return isProtectedBranch(branch) ? 'main/master branches cannot be renamed' : 'Rename local branch';
	}

	function branchSwitchTargetForDelete(branch: GitBranch) {
		if (!branch.current) return '';

		return (
			branches.find((candidate) => candidate.name === 'main' && !candidate.current)?.name ??
			branches.find((candidate) => candidate.name === 'master' && !candidate.current)?.name ??
			branches.find((candidate) => !candidate.current)?.name ??
			''
		);
	}

	function branchDeleteTitle(branch: GitBranch) {
		if (isProtectedBranch(branch)) return 'main/master branches cannot be deleted';
		if (branch.current) {
			const switchTarget = branchSwitchTargetForDelete(branch);
			return switchTarget
				? `Switch to ${switchTarget} and delete local branch`
				: 'No other local branch is available for checkout before deleting';
		}
		return 'Delete local branch';
	}

	async function loadBranches() {
		branchError = '';

		if (!board?.projectLocation || gitStatus === 'no-git') {
			branches = [];
			return;
		}

		branchesLoading = true;

		try {
			const result = await execInProject('git', ['branch', '--list']);
			if (result.code !== 0) {
				throw new Error(result.stderr || 'Branches could not be loaded.');
			}

			branches = parseGitBranches(result.stdout);
			branchDeleteCandidate = '';
		} catch (error) {
			branches = [];
			branchError = error instanceof Error ? error.message : 'Branches could not be loaded.';
		} finally {
			branchesLoading = false;
		}
	}

	async function renameBranch(branch: GitBranch) {
		if (isProtectedBranch(branch)) {
			branchError = '';
			branchMessage = `${branch.name} is protected and cannot be renamed.`;
			return;
		}

		const nextName = window.prompt('Branch name', branch.name)?.trim();
		if (!nextName || nextName === branch.name || branchActionName) return;

		branchActionName = branch.name;
		branchError = '';
		branchMessage = '';

		try {
			const result = await execInProject('git', ['branch', '-m', branch.name, nextName]);
			if (result.code !== 0) {
				throw new Error(result.stderr || 'Branch rename failed.');
			}

			branchMessage = `Renamed ${branch.name} to ${nextName}.`;
			await loadBranches();
		} catch (error) {
			branchError = error instanceof Error ? error.message : 'Branch rename failed.';
		} finally {
			branchActionName = '';
		}
	}

	async function deleteBranch(branch: GitBranch) {
		if (isProtectedBranch(branch)) {
			branchError = '';
			branchMessage = `${branch.name} is protected and cannot be deleted.`;
			return;
		}

		if (branchActionName) return;

		const switchTarget = branchSwitchTargetForDelete(branch);
		if (branch.current && !switchTarget) {
			branchError = '';
			branchMessage = 'No other local branch is available for checkout before deleting it.';
			return;
		}

		if (branchDeleteCandidate !== branch.name) {
			branchDeleteCandidate = branch.name;
			branchError = '';
			branchMessage = switchTarget
				? `Press Confirm to switch to ${switchTarget} and delete ${branch.name}.`
				: `Press Confirm to delete ${branch.name}.`;
			return;
		}

		branchActionName = branch.name;
		branchError = '';
		branchMessage = '';
		let switchedBeforeDelete = false;

		try {
			if (switchTarget) {
				const checkoutResult = await execInProject('git', ['checkout', switchTarget]);
				if (checkoutResult.code !== 0) {
					throw new Error(checkoutResult.stderr || `Checkout ${switchTarget} failed.`);
				}
				switchedBeforeDelete = true;
			}

			const result = await execInProject('git', ['branch', '-D', branch.name]);
			if (result.code !== 0) {
				throw new Error(result.stderr || 'Branch delete failed.');
			}

			branchMessage = switchTarget
				? `Switched to ${switchTarget} and deleted ${branch.name}.`
				: `Deleted ${branch.name}.`;
			await loadBranches();
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Branch delete failed.';
			if (switchedBeforeDelete) {
				await loadBranches();
			}
			branchError = message;
		} finally {
			branchActionName = '';
			branchDeleteCandidate = '';
		}
	}

	function readApplyTargetColumnId(boardId: string) {
		if (typeof localStorage === 'undefined') return '';

		return localStorage.getItem(`${applyTargetStorageKeyPrefix}${boardId}`) ?? '';
	}

	function saveApplyTargetColumnId(columnId: string) {
		if (typeof localStorage === 'undefined') return;

		localStorage.setItem(`${applyTargetStorageKeyPrefix}${currentBoardId()}`, columnId);
	}

	function cardOrderPayload() {
		return {
			columns: columns.map((column) => ({
				id: column.id,
				cardIds: column.cards
					.filter((card) => !isShadowCard(card) && !isPendingCard(card))
					.map((card) => card.id)
			}))
		};
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

	function isPendingCard(card: BoardCard) {
		return isPendingCardId(card.id);
	}

	function isPendingCardId(cardId: string) {
		return pendingImageCardIds.has(cardId);
	}

	function hasPendingImageUpload(cardId: string) {
		return pendingImageUploads.has(cardId);
	}

	function handleCardConsider(columnId: string, event: CustomEvent<{ items: BoardCard[] }>) {
		if (isSearchActive()) return;

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
		if (isSearchActive()) return;

		handleCardConsider(columnId, event);
		persistOrder('moveCards', cardOrderPayload());
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

	async function saveProjectLocation(projectLocationValue = projectLocationDraft) {
		if (!board || projectLocationSaving || projectLocationValue.trim() === board.projectLocation) {
			return;
		}

		const projectLocation = projectLocationValue.trim();
		projectLocationSaving = true;
		notice = '';
		orderError = '';

		try {
			await boardAction(currentBoardId(), { action: 'updateProjectLocation', projectLocation });
			board = { ...board, projectLocation };
			copyMessage = 'Project location saved.';
			void checkGitStatus(projectLocation);
			void loadBranches();
		} catch (error) {
			orderError = error instanceof Error ? error.message : 'Project location could not be saved';
			projectLocationDraft = board.projectLocation;
		} finally {
			projectLocationSaving = false;
		}
	}

	async function browseProjectLocation() {
		if (!board || projectLocationSaving) return;

		notice = '';
		orderError = '';

		try {
			const [{ isTauri }, { open }] = await Promise.all([
				import('@tauri-apps/api/core'),
				import('@tauri-apps/plugin-dialog')
			]);

			if (!isTauri()) {
				const projectLocation = window.prompt('Project location', projectLocationDraft)?.trim();
				if (projectLocation) {
					await saveProjectLocation(projectLocation);
				}
				return;
			}

			const selected = await open({
				directory: true,
				multiple: false,
				title: 'Select project location',
				defaultPath: projectLocationDraft || undefined
			});

			if (typeof selected === 'string') {
				await saveProjectLocation(selected);
			}
		} catch (error) {
			orderError = error instanceof Error ? error.message : 'Project location could not be selected';
		}
	}

	async function createColumnFromPrompt() {
		const title = window.prompt('Column title')?.trim();

		if (!title) return;

		await postAction('createColumn', { title, color: '#2b2a2a' });
	}

	async function updateColumnFromPrompt(column: BoardColumn) {
		const title = window.prompt('Column title', column.title)?.trim();

		if (!title || title === column.title) return;

		await postAction('updateColumn', { columnId: column.id, title, color: column.color });
	}

	async function deleteColumnWithConfirm(column: BoardColumn) {
		if (!window.confirm(`Delete "${column.title}" and its cards?`)) return;

		await postAction('deleteColumn', { columnId: column.id });
	}

	async function createCardFromPrompt(column: BoardColumn) {
		const description = window.prompt('Card description')?.trim();

		if (!description) return;

		await postAction('createCard', {
			columnId: column.id,
			description,
			color: safeColor(column.color, '#abd600')
		});
	}

	async function updateCardFromPrompt(card: BoardCard) {
		const description = window.prompt('Card description', card.description)?.trim();

		if (!description || description === card.description) return;

		if (isPendingCard(card) || hasPendingImageUpload(card.id)) {
			updateLocalCardDescription(card.id, description);
			copyMessage = 'Card text updated. Image upload is still finishing.';
			return;
		}

		await postAction('updateCard', { cardId: card.id, description, color: card.color });
	}

	async function deleteCardWithConfirm(card: BoardCard) {
		if (isPendingCard(card)) {
			copyMessage = 'Image upload is still finishing.';
			return;
		}

		if (!window.confirm('Delete this card?')) return;

		notice = '';
		orderError = '';
		copyMessage = '';

		const snapshot = columns;
		removeCard(card.id);

		try {
			await boardAction(currentBoardId(), { action: 'deleteCard', cardId: card.id });
			copyMessage = 'Card deleted.';
		} catch (error) {
			columns = snapshot;
			orderError = error instanceof Error ? error.message : 'Card delete failed';
			await loadBoard();
		}
	}

	function resetTransientMessages() {
		notice = '';
		pasteError = '';
		orderError = '';
		copyMessage = '';
	}

	function addCardToColumn(columnId: string, card: BoardCard) {
		columns = columns.map((column) =>
			column.id === columnId ? { ...column, cards: [...column.cards, card] } : column
		);
	}

	function updateCardInColumns(cardId: string, updateCard: (card: BoardCard) => BoardCard) {
		let cardFound = false;

		columns = columns.map((column) => {
			if (!column.cards.some((card) => card.id === cardId)) {
				return column;
			}

			cardFound = true;
			return {
				...column,
				cards: column.cards.map((card) => (card.id === cardId ? updateCard(card) : card))
			};
		});

		return cardFound;
	}

	function removeCard(cardId: string) {
		columns = columns.map((column) => ({
			...column,
			cards: column.cards.filter((card) => card.id !== cardId)
		}));
	}

	function cardDescription(cardId: string, fallback: string) {
		return (
			columns.flatMap((column) => column.cards).find((card) => card.id === cardId)?.description ??
			fallback
		);
	}

	function updateLocalCardDescription(cardId: string, description: string) {
		if (isPendingCardId(cardId)) {
			pendingCardDescriptions.set(cardId, description);
		}

		if (isPendingCardId(cardId) || hasPendingImageUpload(cardId)) {
			void queuePendingUploadDescriptionSync(cardId, description)?.catch(() => {
				copyMessage = 'Card text updated, but upload text sync failed.';
			});
		}

		updateCardInColumns(cardId, (card) => ({ ...card, description }));
	}

	function queuePendingUploadDescriptionSync(cardId: string, description: string) {
		const upload = pendingImageUploads.get(cardId);

		if (!upload || description === upload.savedDescription) {
			return upload?.syncPromise ?? null;
		}

		upload.pendingDescription = description;
		upload.syncPromise ??= flushPendingUploadDescription(cardId);

		return upload.syncPromise;
	}

	async function flushPendingUploadDescription(cardId: string) {
		const upload = pendingImageUploads.get(cardId);

		if (!upload) return;

		try {
			while (upload.pendingDescription && upload.pendingDescription !== upload.savedDescription) {
				const description = upload.pendingDescription;

				await savePendingUploadDescription(upload.cardId, description);

				upload.savedDescription = description;
				if (upload.pendingDescription === description) {
					upload.pendingDescription = null;
				}
			}
		} finally {
			upload.syncPromise = null;
		}
	}

	async function savePendingUploadDescription(cardId: string, description: string) {
		let lastError: unknown;

		for (let attempt = 1; attempt <= pendingUploadSyncAttempts; attempt += 1) {
			try {
				await boardAction(currentBoardId(), {
					action: 'updateCard',
					cardId,
					description,
					color: '#ffffff'
				});
				return;
			} catch (error) {
				lastError = error;
				if (attempt === pendingUploadSyncAttempts) break;
				await delay(pendingUploadSyncDelayMs * attempt);
			}
		}

		throw lastError;
	}

	function errorMessage(error: unknown) {
		if (error instanceof Error) return error.message;
		if (typeof error === 'string') return error || 'Unknown error';

		try {
			return JSON.stringify(error) || 'Unknown error';
		} catch {
			return 'Unknown error';
		}
	}

	function delay(ms: number) {
		return new Promise((resolve) => window.setTimeout(resolve, ms));
	}

	async function handlePaste(event: ClipboardEvent) {
		const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
			entry.type.startsWith('image/')
		);

		if (!item) return;

		event.preventDefault();
		resetTransientMessages();

		const columnId = selectedColumnId;
		const column = columns.find((entry) => entry.id === columnId);

		if (!columnId || !column) {
			pasteError = 'Create a column before pasting an image.';
			return;
		}

		const file = item.getAsFile();

		if (!file) {
			pasteError = 'The clipboard image could not be read.';
			return;
		}

		const previewUrl = URL.createObjectURL(file);
		const pendingCard: BoardCard = {
			id: crypto.randomUUID(),
			columnId,
			description: 'Pasted image',
			color: '#ffffff',
			position: column.cards.length,
			image: {
				dataUrl: previewUrl,
				mimeType: file.type || 'image/png',
				byteSize: file.size,
				width: 1,
				height: 1
			}
		};

		pendingImageCardIds.add(pendingCard.id);
		pendingCardDescriptions.set(pendingCard.id, pendingCard.description);
		addCardToColumn(columnId, pendingCard);
		copyMessage = 'Image uploading...';

		let image: NonNullable<BoardCard['image']>;

		try {
			image = await compressImage(file);

			if (image.dataUrl.length > maxImageBytes) {
				removeCard(pendingCard.id);
				pendingImageCardIds.delete(pendingCard.id);
				pendingCardDescriptions.delete(pendingCard.id);
				URL.revokeObjectURL(previewUrl);
				copyMessage = '';
				pasteError = 'Compressed image is still over 1.5 MB.';
				return;
			}
		} catch {
			removeCard(pendingCard.id);
			pendingImageCardIds.delete(pendingCard.id);
			pendingCardDescriptions.delete(pendingCard.id);
			URL.revokeObjectURL(previewUrl);
			copyMessage = '';
			pasteError = 'The pasted image could not be compressed.';
			return;
		}

		await delay(pendingUploadEditGraceMs);

		const uploadedDescription =
			pendingCardDescriptions.get(pendingCard.id) ??
			cardDescription(pendingCard.id, pendingCard.description);
		let savedCard: CreateImageCardResponse;

		try {
			savedCard = await boardAction<CreateImageCardResponse>(currentBoardId(), {
				action: 'createImageCard',
				cardId: pendingCard.id,
				columnId,
				description: uploadedDescription,
				color: '#ffffff',
				dataUrl: image.dataUrl,
				mimeType: image.mimeType,
				byteSize: image.byteSize,
				width: image.width,
				height: image.height
			});
			const upload = {
				cardId: savedCard.cardId,
				savedDescription: uploadedDescription,
				pendingDescription: null,
				syncPromise: null
			};
			pendingImageUploads.set(pendingCard.id, upload);
			pendingImageUploads.set(savedCard.cardId, upload);
		} catch {
			removeCard(pendingCard.id);
			pendingImageCardIds.delete(pendingCard.id);
			pendingCardDescriptions.delete(pendingCard.id);
			pendingImageUploads.delete(pendingCard.id);
			copyMessage = '';
			pasteError = 'The pasted image could not be uploaded.';
			URL.revokeObjectURL(previewUrl);
			return;
		}

		const latestDescription =
			pendingCardDescriptions.get(pendingCard.id) ?? cardDescription(pendingCard.id, uploadedDescription);

		updateCardInColumns(pendingCard.id, (card) => ({
			...card,
			id: savedCard.cardId,
			description: latestDescription,
			position: savedCard.position,
			image
		}));

		try {
			let syncFailed = false;

			try {
				const syncPromise = queuePendingUploadDescriptionSync(pendingCard.id, latestDescription);

				if (syncPromise) {
					await syncPromise;
				}
			} catch (error) {
				syncFailed = true;
				copyMessage = `Image uploaded, but text sync failed: ${errorMessage(error)}`;
			}

			if (!syncFailed) {
				copyMessage = 'Image uploaded.';
				await loadBoard();
			}
		} finally {
			pendingImageCardIds.delete(pendingCard.id);
			pendingCardDescriptions.delete(pendingCard.id);
			pendingImageUploads.delete(pendingCard.id);
			pendingImageUploads.delete(savedCard.cardId);
			URL.revokeObjectURL(previewUrl);
		}
	}

	async function compressImage(file: File) {
		const sourceBitmap = await createImageBitmap(file);
		const scale = Math.min(1, 1600 / Math.max(sourceBitmap.width, sourceBitmap.height));
		const width = Math.max(1, Math.round(sourceBitmap.width * scale));
		const height = Math.max(1, Math.round(sourceBitmap.height * scale));
		let bitmap = sourceBitmap;

		if (scale < 1) {
			try {
				bitmap = await createImageBitmap(sourceBitmap, {
					resizeWidth: width,
					resizeHeight: height,
					resizeQuality: 'medium'
				});
				sourceBitmap.close();
			} catch {
				bitmap = sourceBitmap;
			}
		}

		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;
		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('Canvas is unavailable');
		}

		context.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();

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

	function dataUrlMimeType(dataUrl: string) {
		return /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? '';
	}

	async function dataUrlToBlob(dataUrl: string, fallbackMimeType = '') {
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		return blob.type || !fallbackMimeType
			? blob
			: new Blob([await blob.arrayBuffer()], { type: fallbackMimeType });
	}

	async function dataUrlToCanvas(dataUrl: string) {
		const blob = await dataUrlToBlob(dataUrl);
		const bitmap = await createImageBitmap(blob);
		const canvas = document.createElement('canvas');
		canvas.width = bitmap.width;
		canvas.height = bitmap.height;
		const context = canvas.getContext('2d');

		if (!context) {
			throw new Error('Canvas is unavailable');
		}

		context.drawImage(bitmap, 0, 0);
		const width = bitmap.width;
		const height = bitmap.height;
		bitmap.close();

		return { canvas, context, width, height };
	}

	async function dataUrlToPngBlob(dataUrl: string) {
		const { canvas } = await dataUrlToCanvas(dataUrl);
		const blob = await canvasToBlob(canvas, 'image/png', 1);

		if (!blob) {
			throw new Error('PNG encoding failed');
		}

		return blob;
	}

	async function dataUrlToRgba(dataUrl: string) {
		const { context, width, height } = await dataUrlToCanvas(dataUrl);
		const pixels = context.getImageData(0, 0, width, height);

		return {
			rgba: new Uint8Array(pixels.data),
			width,
			height
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
		if (!('ClipboardItem' in window) || !navigator.clipboard?.write || !card.image) {
			return false;
		}

		const item = window.ClipboardItem;
		const mimeType = card.image.mimeType || dataUrlMimeType(card.image.dataUrl) || 'image/png';
		const supports = (type: string) => !item.supports || item.supports(type);

		if (supports(mimeType)) {
			await navigator.clipboard.write([
				new item({ [mimeType]: dataUrlToBlob(card.image.dataUrl, mimeType) })
			]);
			return true;
		}

		if (!supports('image/png')) {
			return false;
		}

		await navigator.clipboard.write([
			new item({ 'image/png': dataUrlToPngBlob(card.image.dataUrl) })
		]);

		return true;
	}

	async function copyTextWithTauri(text: string) {
		const [{ isTauri }, { writeText }] = await Promise.all([
			import('@tauri-apps/api/core'),
			import('@tauri-apps/plugin-clipboard-manager')
		]);

		if (!isTauri()) {
			return false;
		}

		await writeText(text);

		return true;
	}

	async function copyTextWithBrowserClipboard(text: string) {
		if (!navigator.clipboard?.writeText) {
			return false;
		}

		await navigator.clipboard.writeText(text);

		return true;
	}

	async function copyCardText(card: BoardCard) {
		copyMessage = '';

		if (isPendingCard(card)) {
			copyMessage = 'Image upload is still finishing.';
			return;
		}

		try {
			if (
				(await copyTextWithTauri(card.description)) ||
				(await copyTextWithBrowserClipboard(card.description))
			) {
				copyMessage = 'Card text copied.';
				return;
			}
		} catch {
			// Fall through to the user-facing unsupported message.
		}

		copyMessage = 'Text clipboard copy is not available in this environment.';
	}

	async function copyImage(card: BoardCard) {
		copyMessage = '';

		if (!card.image) return;

		if (isPendingCard(card)) {
			copyMessage = 'Image upload is still finishing.';
			return;
		}

		try {
			if (await copyImageWithBrowserClipboard(card)) {
				copyMessage = 'Image copied.';
				return;
			}
		} catch {
			// Fall through to the Tauri fallback.
		}

		try {
			if (await copyImageWithTauri(card)) {
				copyMessage = 'Image copied.';
				return;
			}
		} catch {
			// Fall through to the user-facing unsupported message.
		}

		copyMessage = 'Image clipboard copy is not available in this environment.';
	}

	async function copyCardAll(card: BoardCard) {
		copyMessage = '';

		if (isPendingCard(card)) {
			copyMessage = 'Image upload is still finishing.';
			return;
		}

		if (!card.image) {
			await copyCardText(card);
			return;
		}

		// Try browser clipboard with both text + image in one ClipboardItem
		try {
			if ('ClipboardItem' in window && navigator.clipboard?.write) {
				const item = window.ClipboardItem;
				const textBlob = new Blob([card.description], { type: 'text/plain' });
				let imageBlob: Blob;

				const mimeType = card.image.mimeType || dataUrlMimeType(card.image.dataUrl) || 'image/png';
				const supports = (type: string) => !item.supports || item.supports(type);

				if (supports(mimeType) && supports('text/plain')) {
					imageBlob = await dataUrlToBlob(card.image.dataUrl, mimeType);
					await navigator.clipboard.write([
						new item({ 'text/plain': textBlob, [mimeType]: imageBlob })
					]);
					copyMessage = 'Text + image copied.';
					return;
				}

				if (supports('image/png') && supports('text/plain')) {
					imageBlob = await dataUrlToPngBlob(card.image.dataUrl);
					await navigator.clipboard.write([
						new item({ 'text/plain': textBlob, 'image/png': imageBlob })
					]);
					copyMessage = 'Text + image copied.';
					return;
				}
			}
		} catch {
			// Fall through to Tauri fallback (image only).
		}

		// Tauri fallback: copy image only (text gets overwritten by image)
		try {
			if (await copyImageWithTauri(card)) {
				copyMessage = 'Image copied (text not included in this mode).';
				return;
			}
		} catch {
			// Fall through.
		}

		copyMessage = 'Clipboard copy is not available in this environment.';
	}

	function shortId(id: string) {
		return id.replace(/-/g, '').slice(0, 6).toUpperCase();
	}

	function safeColor(color: string | null | undefined, fallback = '#abd600') {
		return /^#[0-9a-f]{6}$/i.test(color ?? '') ? color : fallback;
	}

	function cardKind(card: BoardCard) {
		if (isPendingCard(card) || hasPendingImageUpload(card.id)) return 'Uploading';
		return card.image ? 'Image' : 'Card';
	}

	function matchesQuery(card: BoardCard) {
		const value = query.trim().toLowerCase();

		return (
			!value ||
			card.description.toLowerCase().includes(value) ||
			shortId(card.id).toLowerCase().includes(value)
		);
	}

	function isSearchActive() {
		return query.trim().length > 0;
	}

	function visibleCards(column: BoardColumn) {
		return isSearchActive() ? column.cards.filter(matchesQuery) : column.cards;
	}

	async function checkDeviceTools() {
		try {
			const { isTauri } = await import('@tauri-apps/api/core');
			if (!isTauri()) return;

			const { Command } = await import('@tauri-apps/plugin-shell');

			for (const tool of ['git', 'codex', 'gh'] as const) {
				deviceTools = { ...deviceTools, [tool]: 'checking' };
				try {
					const output = await Command.create('cmd', ['/c', tool, '--version']).execute();
					deviceTools = { ...deviceTools, [tool]: output.code === 0 ? 'installed' : 'missing' };
				} catch {
					deviceTools = { ...deviceTools, [tool]: 'missing' };
				}
			}
		} catch {
			// Not running in Tauri.
		}
	}

	function slugify(text: string) {
		return text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 48);
	}

	function appendApplyLog(message: string) {
		const normalized = message.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
		if (!normalized) return;

		applyLogEntries = [...applyLogEntries, ...normalized.split('\n')];
	}

	function setApplyStep(message: string) {
		applyProgress = message;
		appendApplyLog(`[step] ${message.replace(/\.+$/, '')}`);
	}

	function quoteCommandPart(part: string) {
		return /[\s"]/u.test(part) ? JSON.stringify(part) : part;
	}

	function formatCommand(cmd: string, args: string[]) {
		return [cmd, ...args].map(quoteCommandPart).join(' ');
	}

	function quoteBatchArg(part: string) {
		return `"${part.replace(/%/g, '%%').replace(/"/g, '""')}"`;
	}

	function formatBatchCommand(cmd: string, args: string[], stdinFile = '') {
		const command = [cmd, ...args.map(quoteBatchArg)].join(' ');

		return stdinFile ? `${command} < ${quoteBatchArg(stdinFile)}` : command;
	}

	type CommandStream = 'stdout' | 'stderr';
	type JsonRecord = Record<string, unknown>;

	function isJsonRecord(value: unknown): value is JsonRecord {
		return typeof value === 'object' && value !== null && !Array.isArray(value);
	}

	function recordString(record: JsonRecord, key: string) {
		const value = record[key];
		return typeof value === 'string' ? value : '';
	}

	function textFromValue(value: unknown, depth = 0): string {
		if (depth > 4 || value === null || value === undefined) return '';
		if (typeof value === 'string') return value.trimEnd();
		if (typeof value === 'number' || typeof value === 'boolean') return String(value);
		if (Array.isArray(value)) {
			return value
				.map((entry) => textFromValue(entry, depth + 1))
				.filter(Boolean)
				.join('\n');
		}

		if (!isJsonRecord(value)) return '';

		const text = textFromRecord(value, [
			'text',
			'message',
			'content',
			'output',
			'summary',
			'error',
			'delta',
			'arguments',
			'command',
			'cmd'
		], depth + 1);
		if (text) return text;

		try {
			return JSON.stringify(value);
		} catch {
			return '';
		}
	}

	function textFromRecord(record: JsonRecord, keys: string[], depth = 0) {
		for (const key of keys) {
			const text = textFromValue(record[key], depth);
			if (text) return text;
		}

		return '';
	}

	function prefixedLines(prefix: string, text: string) {
		const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimEnd();
		if (!normalized.trim()) return [];

		return normalized.split('\n').map((line) => `${prefix} ${line}`);
	}

	function codexItemStatus(eventType: string) {
		if (eventType.endsWith('.started')) return 'started';
		if (eventType.endsWith('.completed')) return 'completed';
		if (eventType.endsWith('.failed')) return 'failed';
		return '';
	}

	function formatCodexItem(eventType: string, item: JsonRecord) {
		const itemType = recordString(item, 'type') || eventType;
		const status = codexItemStatus(eventType);
		const statusText = status ? ` ${status}` : '';

		if (['agent_message', 'assistant_message', 'message'].includes(itemType)) {
			return prefixedLines('[codex message]', textFromRecord(item, ['text', 'message', 'content']));
		}

		if (['reasoning', 'reasoning_summary'].includes(itemType)) {
			const text = textFromRecord(item, ['summary', 'text', 'content']);
			return text
				? prefixedLines('[codex reasoning]', text)
				: [`[codex reasoning]${statusText}`];
		}

		if (['function_call', 'tool_call', 'local_shell_call', 'shell_call'].includes(itemType)) {
			const name =
				recordString(item, 'name') ||
				recordString(item, 'tool_name') ||
				recordString(item, 'toolName') ||
				itemType;
			const detail = textFromRecord(item, ['command', 'cmd', 'arguments', 'args', 'input']);
			return detail
				? [`[codex tool] ${name}${statusText}`, ...prefixedLines('[codex args]', detail)]
				: [`[codex tool] ${name}${statusText}`];
		}

		if (['function_call_output', 'tool_call_output', 'command_output'].includes(itemType)) {
			const text = textFromRecord(item, ['output', 'content', 'text']);
			return text ? prefixedLines('[codex output]', text) : [`[codex output]${statusText}`];
		}

		const text = textFromRecord(item, ['message', 'text', 'content', 'output', 'error', 'delta']);
		return text
			? prefixedLines(`[codex ${itemType}]`, text)
			: [`[codex] ${eventType}: ${itemType}${statusText}`];
	}

	function formatCodexOutputLine(stream: CommandStream, line: string) {
		if (stream === 'stderr') return prefixedLines('[codex stderr]', line);

		try {
			const event: unknown = JSON.parse(line);
			if (!isJsonRecord(event)) return prefixedLines('[codex stdout]', line);

			const type = recordString(event, 'type') || 'event';
			const item = event.item;

			if (isJsonRecord(item)) return formatCodexItem(type, item);

			if (type === 'thread.started') {
				const threadId = recordString(event, 'thread_id');
				return [`[codex] thread started${threadId ? ` ${threadId}` : ''}`];
			}

			if (type === 'turn.started') return ['[codex] turn started'];
			if (type === 'turn.completed') return ['[codex] turn completed'];
			if (type === 'turn.failed') {
				const text = textFromRecord(event, ['error', 'message']);
				return text ? prefixedLines('[codex error]', text) : ['[codex error] turn failed'];
			}

			const text = textFromRecord(event, ['message', 'text', 'content', 'output', 'error', 'delta']);
			return text ? prefixedLines(`[codex ${type}]`, text) : [`[codex json] ${line}`];
		} catch {
			return prefixedLines('[codex stdout]', line);
		}
	}

	function appendCommandOutputLine(stream: CommandStream, line: string, isCodex = false) {
		const normalized = line.trimEnd();
		if (!normalized.trim()) return;

		const entries = isCodex ? formatCodexOutputLine(stream, normalized) : [`[${stream}] ${normalized}`];
		for (const entry of entries) {
			appendApplyLog(entry);
		}
	}

	async function saveImageToTempFile(card: BoardCard): Promise<string> {
		if (!card.image) return '';

		const base64 = card.image.dataUrl.split(',')[1];
		if (!base64) return '';

		const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
		const ext = card.image.mimeType === 'image/webp' ? 'webp' : 'jpg';
		const fileName = `codex-card-${Date.now()}.${ext}`;

		const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
		await writeFile(fileName, bytes, { baseDir: BaseDirectory.Temp });

		const { tempDir } = await import('@tauri-apps/api/path');
		const tmp = await tempDir();

		return `${tmp}${fileName}`;
	}

	async function saveTextToTempFile(text: string, prefix: string, ext = 'txt'): Promise<string> {
		const fileName = `${prefix}-${Date.now()}.${ext}`;
		const { writeTextFile, BaseDirectory } = await import('@tauri-apps/plugin-fs');
		await writeTextFile(fileName, text, { baseDir: BaseDirectory.Temp });

		const { tempDir } = await import('@tauri-apps/api/path');
		const tmp = await tempDir();

		return `${tmp}${fileName}`;
	}

	async function cleanupTempFile(path: string) {
		if (!path) return;
		try {
			const { remove, BaseDirectory } = await import('@tauri-apps/plugin-fs');
			const fileName = path.split(/[\\/]/).pop() ?? '';
			await remove(fileName, { baseDir: BaseDirectory.Temp });
		} catch {
			// Temp file cleanup is best-effort.
		}
	}

	async function execInProject(
		cmd: string,
		args: string[],
		options: { log?: boolean; stdinFile?: string } = {}
	): Promise<{ code: number; stdout: string; stderr: string }> {
		const { Command } = await import('@tauri-apps/plugin-shell');
		const cwd = board?.projectLocation;
		let scriptPath = '';

		if (cmd === 'codex' && options.log && options.stdinFile) {
			scriptPath = await saveTextToTempFile(
				`@echo off\r\n${formatBatchCommand('codex.cmd', args, options.stdinFile)}\r\nexit /b %ERRORLEVEL%\r\n`,
				'codex-run',
				'cmd'
			);
		}

		const command =
			cmd === 'codex' && options.log
				? Command.create(
						'cmd',
						scriptPath ? ['/d', '/c', scriptPath] : ['/c', 'codex.cmd', ...args],
						cwd ? { cwd } : undefined
					)
				: Command.create('cmd', ['/c', cmd, ...args], cwd ? { cwd } : undefined);

		if (options.log) {
			let stdout = '';
			let stderr = '';
			let stdoutBuffer = '';
			let stderrBuffer = '';
			const isCodexCommand = cmd === 'codex';

			appendApplyLog(`$ ${formatCommand(cmd, args)}`);

			const appendStreamData = (stream: CommandStream, data = '', flush = false) => {
				const normalized = data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
				if (stream === 'stdout') {
					stdoutBuffer += normalized;
					const lines = stdoutBuffer.split('\n');
					stdoutBuffer = flush ? '' : (lines.pop() ?? '');
					for (const line of lines) {
						appendCommandOutputLine(stream, line, isCodexCommand);
					}
					return;
				}

				stderrBuffer += normalized;
				const lines = stderrBuffer.split('\n');
				stderrBuffer = flush ? '' : (lines.pop() ?? '');
				for (const line of lines) {
					appendCommandOutputLine(stream, line, isCodexCommand);
				}
			};

			const closePromise = new Promise<{ code: number | null; signal: number | null }>((resolve, reject) => {
				command.on('close', resolve);
				command.on('error', reject);
				command.stdout.on('data', (data) => {
					stdout += data;
					appendStreamData('stdout', data);
				});
				command.stderr.on('data', (data) => {
					stderr += data;
					appendStreamData('stderr', data);
				});
			});

			try {
				await command.spawn();
				const result = await closePromise;
				const code = result.code ?? 1;
				appendStreamData('stdout', '', true);
				appendStreamData('stderr', '', true);
				appendApplyLog(`[exit] ${code}`);
				return { code, stdout, stderr };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				appendStreamData('stdout', '', true);
				appendStreamData('stderr', '', true);
				appendApplyLog(`[error] ${message}`);
				return { code: 1, stdout, stderr: message };
			} finally {
				await cleanupTempFile(scriptPath);
			}
		}

		const result = await command.execute();
		return { code: result.code ?? 1, stdout: result.stdout, stderr: result.stderr };
	}

	async function applyCard(card: BoardCard) {
		if (!board?.projectLocation) {
			orderError = 'Set a project location before applying.';
			return;
		}

		if (deviceTools.git !== 'installed') {
			orderError = 'Git is not installed on this device.';
			return;
		}

		if (deviceTools.codex !== 'installed') {
			orderError = 'Codex CLI is not installed on this device.';
			return;
		}

		const slug = slugify(card.description) || 'card-task';
		const branchName = `feat/${slug}`;
		const commitMsg = card.description.slice(0, 72);
		let imagePath = '';
		let promptPath = '';
		let originalBranch = 'main';
		let createdBranch = false;
		let pushedBranch = false;

		applyingCardId = card.id;
		applyProgress = '';
		applyLogEntries = [];
		applyLogStatus = 'running';
		orderError = '';
		copyMessage = '';
		appendApplyLog(`[start] ${new Date().toLocaleString()}`);
		appendApplyLog(`[branch] ${branchName}`);

		try {
			const currentBranchResult = await execInProject('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
				log: true
			});
			if (currentBranchResult.code === 0 && currentBranchResult.stdout.trim()) {
				originalBranch = currentBranchResult.stdout.trim();
			}

			const statusResult = await execInProject('git', ['status', '--porcelain'], { log: true });
			if (statusResult.code !== 0) {
				throw new Error(`Git status failed: ${statusResult.stderr}`);
			}

			if (statusResult.stdout.trim()) {
				throw new Error('Project has uncommitted changes. Commit, stash, or clean them before Apply.');
			}

			// 1. Save image temp file if needed
			if (card.image) {
				setApplyStep('Saving image...');
				imagePath = await saveImageToTempFile(card);
				appendApplyLog(`[image] ${imagePath}`);
			}

			// 2. Create feature branch
			setApplyStep('Creating branch...');
			const branchResult = await execInProject('git', ['checkout', '-b', branchName], { log: true });
			if (branchResult.code !== 0) {
				throw new Error(`Branch creation failed: ${branchResult.stderr}`);
			}
			createdBranch = true;

			// 3. Run codex exec
			setApplyStep('Running Codex...');
			promptPath = await saveTextToTempFile(card.description, 'codex-prompt');
			const codexArgs = [
				'--ask-for-approval',
				'never',
				'exec',
				'--json',
				'--cd',
				board.projectLocation,
				'--sandbox',
				'workspace-write'
			];
			if (imagePath) {
				codexArgs.push('--image', imagePath);
			}
			codexArgs.push('-');
			const codexResult = await execInProject('codex', codexArgs, {
				log: true,
				stdinFile: promptPath
			});
			if (codexResult.code !== 0) {
				throw new Error(`Codex failed: ${codexResult.stderr || codexResult.stdout}`);
			}

			// 4. Stage and commit
			setApplyStep('Committing...');
			await execInProject('git', ['add', '-A'], { log: true });
			const commitResult = await execInProject('git', ['commit', '-m', `feat: ${commitMsg}`], {
				log: true
			});
			if (commitResult.code !== 0 && !commitResult.stdout.includes('nothing to commit')) {
				throw new Error(`Commit failed: ${commitResult.stderr}`);
			}

			// 5. Push branch
			setApplyStep('Pushing...');
			const pushResult = await execInProject('git', ['push', '-u', 'origin', branchName], { log: true });
			if (pushResult.code !== 0) {
				throw new Error(`Push failed: ${pushResult.stderr}`);
			}
			pushedBranch = true;

			// 6. Create PR (if gh is available)
			if (deviceTools.gh === 'installed') {
				setApplyStep('Creating PR...');
				await execInProject('gh', [
					'pr', 'create', '--base', 'main', '--head', branchName,
					'--title', `feat: ${commitMsg}`,
					'--body', card.description
				], { log: true });
			} else {
				appendApplyLog('[skip] gh CLI not installed; PR creation skipped');
			}

			// 7. Switch back to main
			setApplyStep(`Switching back to ${originalBranch}...`);
			await execInProject('git', ['checkout', originalBranch], { log: true });

			// 8. Move card to apply target column
			if (applyTargetColumnId && applyTargetColumnId !== card.columnId) {
				setApplyStep('Moving card to apply target...');
				const targetColumn = columns.find((c) => c.id === applyTargetColumnId);
				if (targetColumn) {
					const sourceColumn = columns.find((c) => c.id === card.columnId);
					if (sourceColumn) {
						sourceColumn.cards = sourceColumn.cards.filter((c) => c.id !== card.id);
						targetColumn.cards = [...targetColumn.cards, { ...card, columnId: applyTargetColumnId }];
						columns = [...columns];
						try {
							await boardAction(currentBoardId(), { action: 'moveCards', ...cardOrderPayload() });
							appendApplyLog(`[move] card saved to "${targetColumn.title}"`);
						} catch {
							orderError = 'Applied, but the card move to the apply target could not be saved.';
							appendApplyLog(`[error] ${orderError}`);
							await loadBoard();
						}
					}
				}
			} else {
				appendApplyLog('[skip] apply target matches source column');
			}

			copyMessage = `Applied! ${deviceTools.gh === 'installed' ? 'PR created.' : 'Branch pushed (install gh CLI for auto PR).'}`;
			applyLogStatus = 'succeeded';
			appendApplyLog(`[done] ${copyMessage}`);
			await loadBranches();
		} catch (error) {
			orderError = errorMessage(error);
			applyLogStatus = 'failed';
			appendApplyLog(`[error] ${orderError}`);

			// Revert: discard changes, switch back, delete branch
			if (createdBranch) {
				setApplyStep('Cleaning failed apply...');
				const resetResult = await execInProject('git', ['reset', '--hard', 'HEAD'], { log: true });
				if (resetResult.code !== 0) {
					appendApplyLog(`[error] cleanup reset failed: ${resetResult.stderr}`);
				}

				const cleanResult = await execInProject('git', ['clean', '-fd'], { log: true });
				if (cleanResult.code !== 0) {
					appendApplyLog(`[error] cleanup clean failed: ${cleanResult.stderr}`);
				}

				const checkoutResult = await execInProject('git', ['checkout', originalBranch], { log: true });
				if (checkoutResult.code !== 0) {
					appendApplyLog(`[error] cleanup checkout failed: ${checkoutResult.stderr}`);
				}

				const deleteLocalResult = await execInProject('git', ['branch', '-D', branchName], { log: true });
				if (deleteLocalResult.code !== 0) {
					appendApplyLog(`[error] cleanup branch delete failed: ${deleteLocalResult.stderr}`);
				}

				if (pushedBranch) {
					const deleteRemoteResult = await execInProject(
						'git',
						['push', 'origin', '--delete', branchName],
						{ log: true }
					);
					if (deleteRemoteResult.code !== 0) {
						appendApplyLog(`[error] cleanup remote branch delete failed: ${deleteRemoteResult.stderr}`);
					}
				}
			} else {
				appendApplyLog('[cleanup] no apply branch was created');
			}
			await loadBranches();
		} finally {
			await cleanupTempFile(imagePath);
			await cleanupTempFile(promptPath);
			appendApplyLog(`[end] ${new Date().toLocaleString()}`);
			applyingCardId = '';
			applyProgress = '';
		}
	}
</script>

<svelte:window onpaste={handlePaste} />

<main class="board-page">
	<header class="topbar">
		<div class="brand-lockup">
			<a class="back-link" href="/boards">Boards</a>
			<div>
				<p class="eyebrow">Board</p>
				<h1>{board?.title ?? 'Loading board'}</h1>
			</div>
		</div>

		<div class="search-box">
			<span aria-hidden="true">/</span>
			<input bind:value={query} placeholder="Search cards" aria-label="Search cards" />
			<span class="cursor" aria-hidden="true">_</span>
		</div>

		<div class="top-actions">
			<div class="project-location-control">
				<span class="field-label" id="project-location-label">Project location</span>
				<div class="project-location-row" aria-labelledby="project-location-label">
					<span class:empty-location={!projectLocationDraft} class="project-location-value">
						{projectLocationDraft || 'No location selected'}
					</span>
					<button
						type="button"
						class="browse-button"
						onclick={browseProjectLocation}
						disabled={!board || projectLocationSaving}
					>
						Browse
					</button>
					{#if gitStatus !== 'unknown'}
						<span
							class="git-badge"
							class:git-yes={gitStatus === 'git'}
							class:git-no={gitStatus === 'no-git'}
							class:git-checking={gitStatus === 'checking'}
							title={gitStatus === 'git' ? 'Git repository detected' : gitStatus === 'no-git' ? 'No git repository' : 'Checking git...'}
						>
							<span class="git-dot" aria-hidden="true"></span>
							{gitStatus === 'git' ? 'Git' : gitStatus === 'no-git' ? 'No git' : '...'}
						</span>
					{/if}
				</div>
			</div>

			<label>
				Paste target
				<select bind:value={selectedColumnId} disabled={!columns.length}>
					{#each columns as column (column.id)}
						<option value={column.id}>{column.title}</option>
					{/each}
				</select>
			</label>

			<label>
				Apply target
				<select bind:value={applyTargetColumnId} disabled={!columns.length} onchange={() => saveApplyTargetColumnId(applyTargetColumnId)}>
					{#each columns as column (column.id)}
						<option value={column.id}>{column.title}</option>
					{/each}
				</select>
			</label>

			<div class="tool-badges">
				{#each Object.entries(deviceTools) as [tool, status]}
					<span
						class="tool-badge"
						class:tool-installed={status === 'installed'}
						class:tool-missing={status === 'missing'}
						title={`${tool}: ${status}`}
					>
						<span class="git-dot" aria-hidden="true"></span>
						{tool}
					</span>
				{/each}
			</div>
		</div>
	</header>

	{#if notice || pasteError || orderError || copyMessage}
		<div class:error-state={notice || pasteError || orderError} class="notice">
			{notice || pasteError || orderError || copyMessage}
		</div>
	{/if}

	<section class="apply-log-panel" class:log-empty={!applyLogEntries.length} aria-live="polite" aria-label="Apply log">
		<header>
			<span>Apply log</span>
			<span class:log-running={applyLogStatus === 'running'} class:log-failed={applyLogStatus === 'failed'} class:log-succeeded={applyLogStatus === 'succeeded'}>
				{applyLogStatus}
			</span>
		</header>
		<pre>{applyLogText || 'Waiting for Apply.'}</pre>
	</section>

	<section class="branches-panel" aria-label="Git branches">
		<header>
			<div>
				<span>Branches</span>
				<p>{branchesLoading ? 'Loading' : `${branches.length} local`}</p>
			</div>
			<button
				type="button"
				class="small-button"
				onclick={loadBranches}
				disabled={!board?.projectLocation || gitStatus !== 'git' || branchesLoading || Boolean(branchActionName)}
			>
				Refresh
			</button>
		</header>

		{#if branchError || branchMessage}
			<p class:error-text={branchError} class="branch-state">{branchError || branchMessage}</p>
		{/if}

		<div class="branches-list">
			{#if gitStatus !== 'git'}
				<p class="branch-empty">No git repository selected.</p>
			{:else if branchesLoading}
				<p class="branch-empty">Loading branches...</p>
			{:else if branches.length}
				{#each branches as branch (branch.name)}
					<div class="branch-row" class:current-branch={branch.current}>
						<span class="branch-name">
							<span class="git-dot" aria-hidden="true"></span>
							{branch.name}
						</span>
						<span class="branch-actions">
							{#if branch.current}
								<span class="current-label">Current</span>
							{/if}
							{#if isProtectedBranch(branch)}
								<span class="protected-label">Protected</span>
							{/if}
							<button
								type="button"
								class="small-button"
								onclick={() => renameBranch(branch)}
								disabled={isProtectedBranch(branch) || Boolean(branchActionName)}
								title={branchRenameTitle(branch)}
							>
								Rename
							</button>
							{#if branchDeleteCandidate === branch.name && !branchActionName}
								<button
									type="button"
									class="small-button"
									onclick={() => {
										branchDeleteCandidate = '';
										branchMessage = '';
									}}
								>
									Cancel
								</button>
							{/if}
							<button
								type="button"
								class="small-button danger"
								onclick={() => deleteBranch(branch)}
								disabled={
									isProtectedBranch(branch) ||
									Boolean(branchActionName) ||
									(branch.current && !branchSwitchTargetForDelete(branch))
								}
								title={branchDeleteTitle(branch)}
							>
								{branchActionName === branch.name
									? 'Deleting...'
									: branchDeleteCandidate === branch.name
										? 'Confirm'
										: 'Delete'}
							</button>
						</span>
					</div>
				{/each}
			{:else}
				<p class="branch-empty">No local branches found.</p>
			{/if}
		</div>
	</section>

	<div class="board-shell">
		<div class="board-track">
		<section
			class="columns"
			aria-label="Kanban columns"
			use:dndzone={{ items: columns, flipDurationMs, type: 'columns' }}
			onconsider={handleColumnConsider}
			onfinalize={handleColumnFinalize}
		>
			{#each columns as column (column.id)}
				<article
					class="column"
					style:--column-color={safeColor(column.color)}
					animate:flip={{ duration: flipDurationMs }}
				>
					<header class="column-header">
						<div class="column-heading">
							<span class="status-dot" aria-hidden="true"></span>
							<div>
								<h2>{column.title}</h2>
								<p>{visibleCards(column).length} cards</p>
							</div>
						</div>

						<div class="column-meta">
							<span>{visibleCards(column).length}</span>
							<button type="button" class="small-button" onclick={() => updateColumnFromPrompt(column)}>Edit</button>
							<button type="button" class="small-button danger" onclick={() => deleteColumnWithConfirm(column)}>
								Delete
							</button>
						</div>
					</header>

					<div
						class="cards"
						use:dndzone={{
							items: visibleCards(column),
							flipDurationMs,
							type: 'cards',
							dragDisabled: isSearchActive()
						}}
						onconsider={(event: CustomEvent<{ items: BoardCard[] }>) =>
							handleCardConsider(column.id, event)}
						onfinalize={(event: CustomEvent<{ items: BoardCard[] }>) =>
							handleCardFinalize(column.id, event)}
					>
						{#each visibleCards(column) as card (card.id)}
							<article
								class="card"
								style:--card-color={safeColor(card.color, '#8b5cf6')}
								animate:flip={{ duration: flipDurationMs }}
							>
								<div class="card-gloss" aria-hidden="true"></div>
								<div class="card-topline">
									<span class="tag">{cardKind(card)}</span>
									<span class="card-tools">
										<span class="card-id">#{shortId(card.id)}</span>
										<button
											type="button"
											class="copy-text-button"
											onclick={() => copyCardText(card)}
											disabled={isPendingCard(card)}
											aria-label="Copy card text"
											title="Copy card text"
										>
											<span class="copy-icon" aria-hidden="true"></span>
										</button>
									</span>
								</div>
								<h3>{card.description}</h3>

								{#if card.image}
									<img
										src={card.image.dataUrl}
										alt={card.description}
										width={card.image.width}
										height={card.image.height}
									/>
									<button
										class="copy-button"
										type="button"
										onclick={() => copyImage(card)}
										disabled={isPendingCard(card)}
									>
										Copy image
									</button>
									<button
										class="copy-button copy-all-button"
										type="button"
										onclick={() => copyCardAll(card)}
										disabled={isPendingCard(card)}
										title="Copy text (Ctrl+V) and image (Alt+V) to clipboard"
									>
										Copy all
									</button>
								{/if}

								<div class="card-actions">
									<button
										type="button"
										class="small-button"
										onclick={() => updateCardFromPrompt(card)}
									>
										Edit
									</button>
									<button
										type="button"
										class="small-button apply-button"
										onclick={() => applyCard(card)}
										disabled={isPendingCard(card) || applyingCardId !== '' || deviceTools.codex !== 'installed' || deviceTools.git !== 'installed' || !board?.projectLocation}
										title={!board?.projectLocation ? 'Set project location first' : deviceTools.git !== 'installed' ? 'Git not installed' : deviceTools.codex !== 'installed' ? 'Codex not installed' : 'Apply card via Codex'}
									>
										{applyingCardId === card.id ? applyProgress || 'Applying...' : 'Apply'}
									</button>
									<button
										type="button"
										class="small-button danger"
										onclick={() => deleteCardWithConfirm(card)}
										disabled={isPendingCard(card)}
									>
										Delete
									</button>
								</div>
							</article>
						{/each}
					</div>

					<button type="button" class="add-card-button" onclick={() => createCardFromPrompt(column)}>
						Add card
					</button>
				</article>
			{:else}
				<div class="empty-board">
					<h2>Add a column to start</h2>
					<p>Cards and pasted images need a column destination.</p>
				</div>
			{/each}
		</section>

		<button type="button" class="add-column-panel" onclick={createColumnFromPrompt} aria-label="Add column">
			<span>+</span>
		</button>
		</div>
	</div>
</main>

<style>
	.board-page {
		--surface-container-lowest: #101113;
		--surface: #17181b;
		--surface-container: #202226;
		--surface-container-low: #1b1d21;
		--surface-container-high: #2a2d33;
		--surface-container-highest: #343841;
		--surface-bright: #30343c;
		--on-surface: #f3f4f6;
		--on-surface-variant: #b9c0ca;
		--outline: #8c96a6;
		--outline-variant: #3c424c;
		--tertiary: #9bd400;
		--accent-violet: #8b5cf6;
		--error: #ffb4ab;
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: linear-gradient(180deg, #15171b 0%, var(--surface-container-lowest) 100%);
		color: var(--on-surface);
		overflow: hidden;
		font-family:
			Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
	}

	.topbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		min-height: 64px;
		padding: 12px 24px;
		border-bottom: 1px solid var(--outline-variant);
		background: var(--surface-container);
		box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
		z-index: 10;
	}

	.brand-lockup {
		display: flex;
		align-items: center;
		gap: 14px;
		min-width: 0;
	}

	.back-link {
		min-height: 38px;
		border: 1px solid var(--outline-variant);
		border-radius: 6px;
		padding: 9px 12px;
		background: var(--surface-container-low);
		color: var(--on-surface);
		font-weight: 750;
		text-decoration: none;
		white-space: nowrap;
		transition:
			transform 150ms ease,
			border-color 150ms ease,
			background 150ms ease,
			color 150ms ease;
	}

	h1,
	h2,
	h3,
	p {
		margin: 0;
	}

	h1 {
		max-width: 42vw;
		color: var(--tertiary);
		font-size: 1.5rem;
		font-weight: 800;
		line-height: 1.1;
		overflow-wrap: anywhere;
	}

	h2 {
		color: var(--on-surface);
		font-size: 0.82rem;
		line-height: 1rem;
		text-transform: uppercase;
	}

	h3 {
		position: relative;
		z-index: 1;
		color: var(--on-surface);
		font-size: 0.92rem;
		font-weight: 620;
		line-height: 1.38;
		overflow-wrap: anywhere;
		white-space: pre-wrap;
	}

	.eyebrow {
		margin-bottom: 3px;
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.68rem;
		font-weight: 600;
		letter-spacing: 0.08em;
	}

	.search-box {
		display: flex;
		align-items: center;
		width: min(340px, 30vw);
		min-width: 220px;
		padding: 7px 10px;
		border: 1px solid var(--outline-variant);
		border-radius: 6px;
		background: var(--surface-container-lowest);
		box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.6);
		color: var(--on-surface-variant);
	}

	.search-box:focus-within {
		border-color: var(--tertiary);
		box-shadow: 0 0 8px rgba(171, 214, 0, 0.4);
	}

	.search-box input {
		width: 100%;
		border: 0;
		padding: 0 8px;
		background: transparent;
	}

	.cursor {
		color: var(--tertiary);
		animation: pulse 1.2s infinite;
	}

	.top-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}

	.project-location-control {
		display: grid;
		gap: 6px;
		flex: 0 1 360px;
		min-width: 260px;
	}

	.project-location-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto auto;
		gap: 8px;
		align-items: center;
	}

	.project-location-value {
		min-width: 0;
		height: 38px;
		border: 1px solid var(--outline-variant);
		border-radius: 6px;
		padding: 9px 10px;
		background: var(--surface-container-lowest);
		color: var(--on-surface);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.75rem;
		line-height: 1.25;
		overflow: hidden;
		text-overflow: ellipsis;
		text-transform: none;
		white-space: nowrap;
	}

	.empty-location {
		color: var(--on-surface-variant);
	}

	.browse-button {
		min-width: 82px;
	}

	.git-badge {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 28px;
		padding: 0 9px;
		border: 1px solid var(--outline-variant);
		border-radius: 99px;
		background: var(--surface-container-high);
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.65rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
		transition: border-color 200ms ease, background 200ms ease;
	}

	.git-dot {
		display: inline-block;
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--outline);
		transition: background 200ms ease, box-shadow 200ms ease;
	}

	.git-yes {
		border-color: rgba(34, 197, 94, 0.5);
		color: #4ade80;
	}

	.git-yes .git-dot {
		background: #22c55e;
		box-shadow: 0 0 6px rgba(34, 197, 94, 0.6);
	}

	.git-no {
		border-color: rgba(239, 68, 68, 0.35);
		color: #f87171;
	}

	.git-no .git-dot {
		background: #ef4444;
		box-shadow: 0 0 4px rgba(239, 68, 68, 0.4);
	}

	.git-checking {
		color: var(--on-surface-variant);
	}

	.git-checking .git-dot {
		animation: pulse 1s infinite;
	}

	.tool-badges {
		display: flex;
		gap: 5px;
		flex-wrap: wrap;
	}

	.tool-badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0 7px;
		border: 1px solid var(--outline-variant);
		border-radius: 99px;
		background: var(--surface-container-high);
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.6rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		white-space: nowrap;
	}

	.tool-installed {
		border-color: rgba(34, 197, 94, 0.4);
		color: #4ade80;
	}

	.tool-installed .git-dot {
		background: #22c55e;
		box-shadow: 0 0 5px rgba(34, 197, 94, 0.5);
	}

	.tool-missing {
		border-color: rgba(239, 68, 68, 0.3);
		color: #f87171;
	}

	.tool-missing .git-dot {
		background: #ef4444;
		box-shadow: 0 0 4px rgba(239, 68, 68, 0.35);
	}

	.apply-button {
		border-color: color-mix(in srgb, var(--accent-violet) 60%, transparent);
		color: var(--accent-violet);
	}

	.apply-button:hover:not(:disabled) {
		border-color: var(--accent-violet);
		background: color-mix(in srgb, var(--accent-violet) 15%, var(--surface-container-lowest));
		color: #a78bfa;
	}

	.apply-button:disabled {
		opacity: 0.4;
	}

	.field-label,
	label {
		display: grid;
		gap: 6px;
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.66rem;
		font-weight: 600;
		text-transform: uppercase;
	}

	.column-header,
	.card-actions {
		display: flex;
		gap: 8px;
	}

	input,
	select {
		min-width: 0;
		border: 1px solid var(--outline-variant);
		border-radius: 6px;
		padding: 9px 10px;
		background: var(--surface-container-lowest);
		color: var(--on-surface);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.75rem;
	}

	input:focus,
	select:focus {
		border-color: var(--tertiary);
		outline: 2px solid rgba(171, 214, 0, 0.25);
	}

	button {
		min-height: 38px;
		border: 1px solid var(--outline-variant);
		border-radius: 6px;
		padding: 8px 11px;
		background: var(--surface-container-low);
		color: var(--on-surface);
		font-weight: 750;
		white-space: nowrap;
		transition:
			transform 150ms ease,
			border-color 150ms ease,
			background 150ms ease,
			color 150ms ease;
	}

	button:hover,
	.back-link:hover {
		border-color: var(--tertiary);
		background: var(--surface-bright);
		color: var(--tertiary);
	}

	button:active,
	.back-link:active {
		transform: translateY(2px);
	}

	.danger {
		border-color: rgba(255, 180, 171, 0.5);
		color: var(--error);
	}

	.notice {
		margin: 12px 18px 0;
		padding: 11px 13px;
		border: 1px solid rgba(171, 214, 0, 0.55);
		border-radius: 6px;
		background: rgba(21, 29, 0, 0.92);
		color: var(--tertiary);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.error-state {
		border-color: rgba(255, 180, 171, 0.65);
		background: rgba(72, 0, 5, 0.72);
		color: var(--error);
	}

	.apply-log-panel {
		display: grid;
		gap: 8px;
		margin: 12px 18px 0;
		border: 1px solid var(--outline-variant);
		border-radius: 8px;
		background: var(--surface-container-lowest);
		box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
		overflow: hidden;
	}

	.apply-log-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--outline-variant);
		background: var(--surface-container-low);
		color: var(--on-surface);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.68rem;
		font-weight: 750;
		text-transform: uppercase;
	}

	.apply-log-panel header span:last-child {
		color: var(--on-surface-variant);
	}

	.apply-log-panel header .log-running {
		color: var(--tertiary);
	}

	.apply-log-panel header .log-succeeded {
		color: #4ade80;
	}

	.apply-log-panel header .log-failed {
		color: var(--error);
	}

	.apply-log-panel pre {
		max-height: 280px;
		margin: 0;
		padding: 12px;
		overflow: auto;
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.72rem;
		line-height: 1.45;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.apply-log-panel.log-empty pre {
		max-height: 44px;
		color: var(--outline);
	}

	.branches-panel {
		display: grid;
		gap: 10px;
		margin: 12px 18px 0;
		border: 1px solid var(--outline-variant);
		border-radius: 8px;
		background: var(--surface-container-low);
		overflow: hidden;
	}

	.branches-panel header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 12px;
		border-bottom: 1px solid var(--outline-variant);
		background: var(--surface-container);
	}

	.branches-panel header span {
		color: var(--on-surface);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.68rem;
		font-weight: 750;
		text-transform: uppercase;
	}

	.branches-panel header p,
	.branch-state,
	.branch-empty {
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.68rem;
	}

	.branch-state {
		padding: 0 12px;
	}

	.error-text {
		color: var(--error);
	}

	.branches-list {
		display: grid;
		gap: 6px;
		max-height: 150px;
		overflow: auto;
		padding: 0 12px 12px;
	}

	.branch-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 38px;
		border: 1px solid var(--outline-variant);
		border-radius: 6px;
		padding: 5px 6px 5px 10px;
		background: var(--surface-container-lowest);
	}

	.current-branch {
		border-color: rgba(155, 212, 0, 0.45);
	}

	.branch-name,
	.branch-actions {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}

	.branch-actions {
		flex-wrap: wrap;
		justify-content: flex-end;
	}

	.branch-name {
		color: var(--on-surface);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.72rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.current-label,
	.protected-label {
		color: var(--tertiary);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.62rem;
		font-weight: 750;
		text-transform: uppercase;
	}

	.protected-label {
		color: #ffd166;
	}

	.branch-empty {
		padding: 8px 0;
	}

	.board-shell {
		flex: 1;
		min-height: 0;
		padding: 18px;
		overflow-x: auto;
		overflow-y: hidden;
	}

	.board-track {
		display: flex;
		align-items: stretch;
		gap: 16px;
		height: 100%;
		min-width: max-content;
		padding-bottom: 16px;
	}

	.columns {
		display: flex;
		align-items: stretch;
		gap: 16px;
		height: 100%;
		min-width: max-content;
	}

	.column {
		display: flex;
		flex-direction: column;
		flex: 0 0 312px;
		max-height: 100%;
		border: 1px solid var(--outline-variant);
		border-radius: 8px;
		background: var(--surface-container);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
		overflow: hidden;
	}

	.column-header {
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 14px;
		border-bottom: 1px solid var(--outline-variant);
		background: var(--surface-container-low);
	}

	.column-heading {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}

	.column-heading div {
		min-width: 0;
	}

	.column-heading h2 {
		max-width: 172px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.column-heading p {
		margin-top: 3px;
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.66rem;
		text-transform: uppercase;
	}

	.column-meta {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.column-meta > span {
		min-width: 30px;
		padding: 3px 8px;
		border: 1px solid var(--outline-variant);
		border-radius: 5px;
		background: var(--surface-container-lowest);
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.72rem;
		text-align: center;
	}

	.status-dot {
		flex: 0 0 auto;
		width: 8px;
		height: 8px;
		border-radius: 999px;
		background: var(--column-color);
		box-shadow: 0 0 8px color-mix(in srgb, var(--column-color) 60%, transparent);
	}

	.column-header button {
		min-height: 30px;
		padding: 4px 8px;
		font-weight: 750;
	}

	.cards {
		display: grid;
		align-content: start;
		gap: 12px;
		flex: 1;
		min-height: 96px;
		overflow-y: auto;
		padding: 12px;
	}

	.card {
		display: grid;
		position: relative;
		gap: 9px;
		padding: 12px;
		border: 1px solid color-mix(in srgb, var(--card-color) 78%, var(--outline-variant));
		border-radius: 7px;
		background: var(--surface);
		box-shadow:
			0 0 0 1px rgba(255, 255, 255, 0.02),
			inset 0 1px 0 rgba(255, 255, 255, 0.05);
		overflow: hidden;
		transition: transform 150ms ease;
	}

	.card:hover {
		transform: translateY(-2px);
	}

	.card-gloss {
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, rgba(255, 255, 255, 0.05), transparent);
		pointer-events: none;
	}

	.card-topline {
		display: flex;
		position: relative;
		z-index: 1;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.tag {
		padding: 3px 8px;
		border: 1px solid color-mix(in srgb, var(--card-color) 70%, transparent);
		background: color-mix(in srgb, var(--card-color) 16%, transparent);
		color: var(--card-color);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.68rem;
		text-transform: uppercase;
	}

	.card-id {
		color: var(--on-surface-variant);
		font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Consolas, monospace;
		font-size: 0.68rem;
	}

	.card-tools {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}

	.copy-text-button {
		display: inline-grid;
		width: 28px;
		min-width: 28px;
		min-height: 28px;
		place-items: center;
		padding: 0;
		border-color: color-mix(in srgb, var(--card-color) 45%, var(--outline-variant));
		background: color-mix(in srgb, var(--card-color) 8%, var(--surface-container-lowest));
	}

	.copy-icon {
		position: relative;
		width: 13px;
		height: 13px;
	}

	.copy-icon::before,
	.copy-icon::after {
		position: absolute;
		width: 8px;
		height: 8px;
		border: 1px solid currentColor;
		content: "";
	}

	.copy-icon::before {
		top: 0;
		left: 0;
		opacity: 0.65;
	}

	.copy-icon::after {
		right: 0;
		bottom: 0;
		background: var(--surface);
	}

	.card img {
		display: block;
		width: 100%;
		height: auto;
		max-height: 190px;
		border: 1px solid var(--outline-variant);
		border-radius: 5px;
		object-fit: contain;
		background: #060606;
	}

	.copy-button {
		justify-self: start;
		border-color: color-mix(in srgb, var(--card-color) 60%, transparent);
		color: var(--card-color);
		min-height: 34px;
		padding: 6px 10px;
	}

	.copy-all-button {
		border-color: color-mix(in srgb, var(--tertiary) 55%, transparent);
		color: var(--tertiary);
		background: color-mix(in srgb, var(--tertiary) 8%, var(--surface-container-lowest));
	}

	.copy-all-button:hover {
		border-color: var(--tertiary);
		background: color-mix(in srgb, var(--tertiary) 18%, var(--surface-container-lowest));
	}

	.card-actions {
		position: relative;
		z-index: 1;
		justify-content: space-between;
	}

	.small-button,
	.add-card-button {
		min-height: 30px;
		padding: 5px 9px;
		font-size: 0.78rem;
	}

	.empty-board {
		display: grid;
		flex: 1;
		min-width: min(600px, calc(100vw - 40px));
		min-height: 280px;
		place-items: center;
		border: 1px dashed var(--outline-variant);
		border-radius: 8px;
		background: var(--surface-container);
		text-align: center;
	}

	.empty-board p {
		margin-top: 6px;
		color: var(--on-surface-variant);
	}

	.add-column-panel {
		display: grid;
		flex: 0 0 56px;
		height: 100%;
		place-items: center;
		border: 1px dashed var(--outline-variant);
		border-radius: 8px;
		background: rgba(14, 14, 14, 0.72);
		color: var(--on-surface-variant);
		transition:
			transform 150ms ease,
			border-color 150ms ease,
			background 150ms ease;
	}

	.add-column-panel:hover {
		border-color: var(--tertiary);
		background: var(--surface);
		color: var(--tertiary);
	}

	.add-column-panel span {
		font-size: 1.5rem;
		font-weight: 800;
	}

	@keyframes pulse {
		50% {
			opacity: 0;
		}
	}

	@media (max-width: 780px) {
		.board-page {
			overflow: visible;
		}

		.topbar,
		.top-actions,
		.brand-lockup {
			align-items: stretch;
			flex-direction: column;
		}

		.topbar {
			padding: 12px 16px;
		}

		h1 {
			max-width: none;
		}

		.search-box {
			width: 100%;
		}

		.top-actions {
			width: 100%;
		}

		.project-location-row {
			grid-template-columns: minmax(0, 1fr);
		}

		.top-actions button,
		select {
			width: 100%;
		}

		.board-shell {
			padding: 16px;
		}

		.column {
			flex-basis: min(320px, calc(100vw - 32px));
		}
	}
</style>
