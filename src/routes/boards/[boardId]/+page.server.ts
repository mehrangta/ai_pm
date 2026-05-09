import { error, fail, redirect } from '@sveltejs/kit';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import {
	kanbanBoard,
	kanbanCard,
	kanbanCardImage,
	kanbanColumn
} from '$lib/server/db/schema';
import type { Actions, PageServerLoad, RequestEvent } from './$types';

const MAX_IMAGE_BYTES = 1_500_000;
const DEFAULT_COLUMN_COLOR = '#f4f4f5';
const DEFAULT_CARD_COLOR = '#ffffff';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

const textFrom = (formData: FormData, key: string, max = 300) =>
	formData.get(key)?.toString().trim().slice(0, max) ?? '';

const colorFrom = (formData: FormData, key: string, fallback: string) => {
	const color = formData.get(key)?.toString() ?? '';
	return COLOR_PATTERN.test(color) ? color : fallback;
};

const parseOrder = (value: FormDataEntryValue | null) => {
	if (!value) return [];

	try {
		const parsed = JSON.parse(value.toString());
		return Array.isArray(parsed) && parsed.every((item) => typeof item === 'string') ? parsed : [];
	} catch {
		return [];
	}
};

const requireUser = (event: RequestEvent) => {
	const user = event.locals.user;

	if (!user) {
		redirect(302, '/login');
	}

	return user;
};

const dbFor = (event: RequestEvent) => getDb(event.platform!.env.ai_pm_db);

const getOwnedBoard = async (event: RequestEvent) => {
	const user = requireUser(event);
	const db = dbFor(event);
	const [board] = await db
		.select({ id: kanbanBoard.id, title: kanbanBoard.title, userId: kanbanBoard.userId })
		.from(kanbanBoard)
		.where(and(eq(kanbanBoard.id, event.params.boardId), eq(kanbanBoard.userId, user.id)))
		.limit(1);

	return { db, user, board };
};

const requireBoard = async (event: RequestEvent) => {
	const context = await getOwnedBoard(event);

	if (!context.board) {
		error(404, 'Board not found');
	}

	return context as typeof context & { board: NonNullable<typeof context.board> };
};

const getColumns = async (db: ReturnType<typeof getDb>, boardId: string) =>
	db
		.select({
			id: kanbanColumn.id,
			title: kanbanColumn.title,
			color: kanbanColumn.color,
			position: kanbanColumn.position
		})
		.from(kanbanColumn)
		.where(eq(kanbanColumn.boardId, boardId))
		.orderBy(asc(kanbanColumn.position), asc(kanbanColumn.createdAt));

const requireColumn = async (db: ReturnType<typeof getDb>, boardId: string, columnId: string) => {
	const [column] = await db
		.select({ id: kanbanColumn.id })
		.from(kanbanColumn)
		.where(and(eq(kanbanColumn.id, columnId), eq(kanbanColumn.boardId, boardId)))
		.limit(1);

	return column;
};

const requireCard = async (db: ReturnType<typeof getDb>, boardId: string, cardId: string) => {
	const [card] = await db
		.select({ id: kanbanCard.id, columnId: kanbanCard.columnId })
		.from(kanbanCard)
		.innerJoin(kanbanColumn, eq(kanbanCard.columnId, kanbanColumn.id))
		.where(and(eq(kanbanCard.id, cardId), eq(kanbanColumn.boardId, boardId)))
		.limit(1);

	return card;
};

export const load: PageServerLoad = async (event) => {
	const { db, user, board } = await requireBoard(event);
	const columns = await getColumns(db, board.id);
	const columnIds = columns.map((column) => column.id);

	const cards = columnIds.length
		? await db
				.select({
					id: kanbanCard.id,
					columnId: kanbanCard.columnId,
					description: kanbanCard.description,
					color: kanbanCard.color,
					position: kanbanCard.position,
					imageDataUrl: kanbanCardImage.dataUrl,
					imageMimeType: kanbanCardImage.mimeType,
					imageByteSize: kanbanCardImage.byteSize,
					imageWidth: kanbanCardImage.width,
					imageHeight: kanbanCardImage.height
				})
				.from(kanbanCard)
				.leftJoin(kanbanCardImage, eq(kanbanCard.id, kanbanCardImage.cardId))
				.where(inArray(kanbanCard.columnId, columnIds))
				.orderBy(asc(kanbanCard.position), asc(kanbanCard.createdAt))
		: [];

	const columnsWithCards = columns.map((column) => ({
		...column,
		cards: cards
			.filter((card) => card.columnId === column.id)
			.map((card) => ({
				id: card.id,
				columnId: card.columnId,
				description: card.description,
				color: card.color,
				position: card.position,
				image: card.imageDataUrl
					? {
							dataUrl: card.imageDataUrl,
							mimeType: card.imageMimeType!,
							byteSize: card.imageByteSize!,
							width: card.imageWidth!,
							height: card.imageHeight!
						}
					: null
			}))
	}));

	return { user, board, columns: columnsWithCards };
};

export const actions: Actions = {
	createColumn: async (event) => {
		const { db, board } = await requireBoard(event);
		const formData = await event.request.formData();
		const title = textFrom(formData, 'title', 100);
		const color = colorFrom(formData, 'color', DEFAULT_COLUMN_COLOR);

		if (!title) {
			return fail(400, { message: 'Column title is required' });
		}

		const columns = await getColumns(db, board.id);
		await db.insert(kanbanColumn).values({
			boardId: board.id,
			title,
			color,
			position: columns.length
		});

		return { ok: true };
	},
	updateColumn: async (event) => {
		const { db, board } = await requireBoard(event);
		const formData = await event.request.formData();
		const columnId = formData.get('columnId')?.toString() ?? '';
		const title = textFrom(formData, 'title', 100);
		const color = colorFrom(formData, 'color', DEFAULT_COLUMN_COLOR);

		if (!columnId || !title || !(await requireColumn(db, board.id, columnId))) {
			return fail(400, { message: 'Column update is invalid' });
		}

		await db
			.update(kanbanColumn)
			.set({ title, color, updatedAt: new Date() })
			.where(eq(kanbanColumn.id, columnId));

		return { ok: true };
	},
	deleteColumn: async (event) => {
		const { db, board } = await requireBoard(event);
		const columnId = (await event.request.formData()).get('columnId')?.toString() ?? '';

		if (!columnId || !(await requireColumn(db, board.id, columnId))) {
			return fail(400, { message: 'Column not found' });
		}

		await db.delete(kanbanColumn).where(eq(kanbanColumn.id, columnId));

		return { ok: true };
	},
	reorderColumns: async (event) => {
		const { db, board } = await requireBoard(event);
		const order = parseOrder((await event.request.formData()).get('order'));
		const existing = await getColumns(db, board.id);
		const existingIds = new Set(existing.map((column) => column.id));

		if (
			order.length !== existing.length ||
			new Set(order).size !== order.length ||
			order.some((id) => !existingIds.has(id))
		) {
			return fail(400, { message: 'Column order is invalid' });
		}

		for (const [position, id] of order.entries()) {
			await db.update(kanbanColumn).set({ position }).where(eq(kanbanColumn.id, id));
		}

		return { ok: true };
	},
	createCard: async (event) => {
		const { db, board } = await requireBoard(event);
		const formData = await event.request.formData();
		const columnId = formData.get('columnId')?.toString() ?? '';
		const description = textFrom(formData, 'description', 2000);
		const color = colorFrom(formData, 'color', DEFAULT_CARD_COLOR);

		if (!columnId || !description || !(await requireColumn(db, board.id, columnId))) {
			return fail(400, { message: 'Card details are invalid' });
		}

		const cards = await db
			.select({ id: kanbanCard.id })
			.from(kanbanCard)
			.where(eq(kanbanCard.columnId, columnId));

		await db.insert(kanbanCard).values({
			columnId,
			description,
			color,
			position: cards.length
		});

		return { ok: true };
	},
	createImageCard: async (event) => {
		const { db, board } = await requireBoard(event);
		const formData = await event.request.formData();
		const columnId = formData.get('columnId')?.toString() ?? '';
		const description = textFrom(formData, 'description', 2000) || 'Pasted image';
		const color = colorFrom(formData, 'color', DEFAULT_CARD_COLOR);
		const dataUrl = formData.get('dataUrl')?.toString() ?? '';
		const mimeType = formData.get('mimeType')?.toString() ?? '';
		const byteSize = Number(formData.get('byteSize') ?? 0);
		const width = Number(formData.get('width') ?? 0);
		const height = Number(formData.get('height') ?? 0);

		if (!columnId || !(await requireColumn(db, board.id, columnId))) {
			return fail(400, { message: 'Paste target is invalid' });
		}

		if (
			!['image/webp', 'image/jpeg'].includes(mimeType) ||
			!dataUrl.startsWith(`data:${mimeType};base64,`) ||
			!Number.isFinite(byteSize) ||
			byteSize <= 0 ||
			byteSize > MAX_IMAGE_BYTES ||
			dataUrl.length > MAX_IMAGE_BYTES ||
			!Number.isFinite(width) ||
			!Number.isFinite(height) ||
			width <= 0 ||
			height <= 0
		) {
			return fail(400, { message: 'Image is too large or unsupported' });
		}

		const cards = await db
			.select({ id: kanbanCard.id })
			.from(kanbanCard)
			.where(eq(kanbanCard.columnId, columnId));

		const [card] = await db
			.insert(kanbanCard)
			.values({
				columnId,
				description,
				color,
				position: cards.length
			})
			.returning({ id: kanbanCard.id });

		await db.insert(kanbanCardImage).values({
			cardId: card.id,
			dataUrl,
			mimeType,
			byteSize,
			width,
			height
		});

		return { ok: true };
	},
	updateCard: async (event) => {
		const { db, board } = await requireBoard(event);
		const formData = await event.request.formData();
		const cardId = formData.get('cardId')?.toString() ?? '';
		const description = textFrom(formData, 'description', 2000);
		const color = colorFrom(formData, 'color', DEFAULT_CARD_COLOR);

		if (!cardId || !description || !(await requireCard(db, board.id, cardId))) {
			return fail(400, { message: 'Card update is invalid' });
		}

		await db
			.update(kanbanCard)
			.set({ description, color, updatedAt: new Date() })
			.where(eq(kanbanCard.id, cardId));

		return { ok: true };
	},
	deleteCard: async (event) => {
		const { db, board } = await requireBoard(event);
		const cardId = (await event.request.formData()).get('cardId')?.toString() ?? '';

		if (!cardId || !(await requireCard(db, board.id, cardId))) {
			return fail(400, { message: 'Card not found' });
		}

		await db.delete(kanbanCard).where(eq(kanbanCard.id, cardId));

		return { ok: true };
	},
	moveCards: async (event) => {
		const { db, board } = await requireBoard(event);
		const formData = await event.request.formData();
		const rawColumns = formData.get('columns')?.toString() ?? '[]';
		const columns = await getColumns(db, board.id);
		const columnIds = new Set(columns.map((column) => column.id));
		let submitted: { id: string; cardIds: string[] }[];

		try {
			const parsed = JSON.parse(rawColumns);
			if (
				!Array.isArray(parsed) ||
				parsed.some(
					(column) =>
						typeof column?.id !== 'string' ||
						!Array.isArray(column.cardIds) ||
						column.cardIds.some((cardId: unknown) => typeof cardId !== 'string')
				)
			) {
				return fail(400, { message: 'Card order is invalid' });
			}
			submitted = parsed;
		} catch {
			return fail(400, { message: 'Card order is invalid' });
		}

		if (submitted.length !== columns.length || submitted.some((column) => !columnIds.has(column.id))) {
			return fail(400, { message: 'Card order is invalid' });
		}

		const submittedCardIds = submitted.flatMap((column) => column.cardIds);
		const existingCards = await db
			.select({ id: kanbanCard.id })
			.from(kanbanCard)
			.innerJoin(kanbanColumn, eq(kanbanCard.columnId, kanbanColumn.id))
			.where(eq(kanbanColumn.boardId, board.id));
		const existingCardIds = new Set(existingCards.map((card) => card.id));

		if (
			submittedCardIds.length !== existingCards.length ||
			new Set(submittedCardIds).size !== submittedCardIds.length ||
			submittedCardIds.some((id) => !existingCardIds.has(id))
		) {
			return fail(400, { message: 'Card order contains an unknown card' });
		}

		for (const column of submitted) {
			for (const [position, cardId] of column.cardIds.entries()) {
				await db
					.update(kanbanCard)
					.set({ columnId: column.id, position })
					.where(eq(kanbanCard.id, cardId));
			}
		}

		return { ok: true };
	},
	signOut: async (event) => {
		await event.locals.auth.api.signOut({
			headers: event.request.headers
		});

		redirect(302, '/login');
	}
};
