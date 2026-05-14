import { and, asc, eq, inArray } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { apiError, apiJson, optionsResponse, requireApiUser } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import {
	kanbanBoard,
	kanbanCard,
	kanbanCardImage,
	kanbanColumn
} from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

const MAX_IMAGE_BYTES = 1_500_000;
const DEFAULT_COLUMN_COLOR = '#f4f4f5';
const DEFAULT_CARD_COLOR = '#ffffff';
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const readBody = async (request: Request) => {
	try {
		return (await request.json()) as Record<string, unknown>;
	} catch {
		return {};
	}
};

const textFrom = (body: Record<string, unknown>, key: string, max = 300) =>
	typeof body[key] === 'string' ? body[key].trim().slice(0, max) : '';

const colorFrom = (body: Record<string, unknown>, key: string, fallback: string) => {
	const color = typeof body[key] === 'string' ? body[key] : '';
	return COLOR_PATTERN.test(color) ? color : fallback;
};

const stringArrayFrom = (value: unknown) =>
	Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];

const dbFor = (event: RequestEvent) => {
	const d1 = event.platform?.env.ai_pm_db;

	if (!d1) {
		throw new Error('D1 binding "ai_pm_db" not found');
	}

	return getDb(d1);
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

const requireBoard = async (event: RequestEvent) => {
	const user = requireApiUser(event);

	if (!user) {
		return { ok: false as const, response: apiError(event, 401, 'Authentication required') };
	}

	const boardId = event.params.boardId;

	if (!boardId) {
		return { ok: false as const, response: apiError(event, 400, 'Board is required') };
	}

	const db = dbFor(event);
	const [board] = await db
		.select({
			id: kanbanBoard.id,
			title: kanbanBoard.title,
			projectLocation: kanbanBoard.projectLocation,
			userId: kanbanBoard.userId
		})
		.from(kanbanBoard)
		.where(and(eq(kanbanBoard.id, boardId), eq(kanbanBoard.userId, user.id)))
		.limit(1);

	if (!board) {
		return { ok: false as const, response: apiError(event, 404, 'Board not found') };
	}

	return { ok: true as const, db, user, board };
};

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
		.where(eq(kanbanCard.id, cardId))
		.limit(1);

	if (!card || !(await requireColumn(db, boardId, card.columnId))) {
		return null;
	}

	return card;
};

export const OPTIONS: RequestHandler = (event) => optionsResponse(event);

export const GET: RequestHandler = async (event) => {
	const context = await requireBoard(event);

	if (!context.ok) {
		return context.response;
	}

	const { db, user, board } = context;
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

	return apiJson(event, {
		user,
		board,
		columns: columns.map((column) => ({
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
		}))
	});
};

export const POST: RequestHandler = async (event) => {
	const context = await requireBoard(event);

	if (!context.ok) {
		return context.response;
	}

	const { db, board } = context;
	const body = await readBody(event.request);
	const action = textFrom(body, 'action', 80);

	if (action === 'updateProjectLocation') {
		const projectLocation = textFrom(body, 'projectLocation', 1024);

		await db
			.update(kanbanBoard)
			.set({ projectLocation, updatedAt: new Date() })
			.where(eq(kanbanBoard.id, board.id));

		return apiJson(event, { ok: true });
	}

	if (action === 'createColumn') {
		const title = textFrom(body, 'title', 100);
		const color = colorFrom(body, 'color', DEFAULT_COLUMN_COLOR);

		if (!title) {
			return apiError(event, 400, 'Column title is required');
		}

		const columns = await getColumns(db, board.id);
		await db.insert(kanbanColumn).values({
			boardId: board.id,
			title,
			color,
			position: columns.length
		});

		return apiJson(event, { ok: true }, { status: 201 });
	}

	if (action === 'updateColumn') {
		const columnId = textFrom(body, 'columnId');
		const title = textFrom(body, 'title', 100);
		const color = colorFrom(body, 'color', DEFAULT_COLUMN_COLOR);

		if (!columnId || !title || !(await requireColumn(db, board.id, columnId))) {
			return apiError(event, 400, 'Column update is invalid');
		}

		await db
			.update(kanbanColumn)
			.set({ title, color, updatedAt: new Date() })
			.where(eq(kanbanColumn.id, columnId));

		return apiJson(event, { ok: true });
	}

	if (action === 'deleteColumn') {
		const columnId = textFrom(body, 'columnId');

		if (!columnId || !(await requireColumn(db, board.id, columnId))) {
			return apiError(event, 400, 'Column not found');
		}

		await db.delete(kanbanColumn).where(eq(kanbanColumn.id, columnId));
		return apiJson(event, { ok: true });
	}

	if (action === 'reorderColumns') {
		const order = stringArrayFrom(body.order);
		const existing = await getColumns(db, board.id);
		const existingIds = new Set(existing.map((column) => column.id));

		if (
			order.length !== existing.length ||
			new Set(order).size !== order.length ||
			order.some((id) => !existingIds.has(id))
		) {
			return apiError(event, 400, 'Column order is invalid');
		}

		for (const [position, id] of order.entries()) {
			await db.update(kanbanColumn).set({ position }).where(eq(kanbanColumn.id, id));
		}

		return apiJson(event, { ok: true });
	}

	if (action === 'createCard' || action === 'createImageCard') {
		const columnId = textFrom(body, 'columnId');
		const description =
			textFrom(body, 'description', 2000) || (action === 'createImageCard' ? 'Pasted image' : '');
		const color = colorFrom(body, 'color', DEFAULT_CARD_COLOR);
		const requestedCardId = action === 'createImageCard' ? textFrom(body, 'cardId', 80) : '';
		const cardId = UUID_PATTERN.test(requestedCardId) ? requestedCardId : undefined;

		if (!columnId || !description || !(await requireColumn(db, board.id, columnId))) {
			return apiError(event, 400, 'Card details are invalid');
		}

		if (action === 'createImageCard') {
			const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
			const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
			const byteSize = Number(body.byteSize ?? 0);
			const width = Number(body.width ?? 0);
			const height = Number(body.height ?? 0);

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
				return apiError(event, 400, 'Image is too large or unsupported');
			}

			const cards = await db.select({ id: kanbanCard.id }).from(kanbanCard).where(eq(kanbanCard.columnId, columnId));
			const [card] = await db
				.insert(kanbanCard)
				.values({ ...(cardId ? { id: cardId } : {}), columnId, description, color, position: cards.length })
				.returning({ id: kanbanCard.id });

			await db.insert(kanbanCardImage).values({
				cardId: card.id,
				dataUrl,
				mimeType,
				byteSize,
				width,
				height
			});

			return apiJson(event, { ok: true, cardId: card.id, position: cards.length }, { status: 201 });
		}

		const cards = await db.select({ id: kanbanCard.id }).from(kanbanCard).where(eq(kanbanCard.columnId, columnId));
		await db.insert(kanbanCard).values({
			columnId,
			description,
			color,
			position: cards.length
		});

		return apiJson(event, { ok: true }, { status: 201 });
	}

	if (action === 'updateCard') {
		const cardId = textFrom(body, 'cardId');
		const description = textFrom(body, 'description', 2000);
		const color = colorFrom(body, 'color', DEFAULT_CARD_COLOR);

		if (!cardId || !description || !(await requireCard(db, board.id, cardId))) {
			return apiError(event, 400, 'Card update is invalid');
		}

		await db
			.update(kanbanCard)
			.set({ description, color, updatedAt: new Date() })
			.where(eq(kanbanCard.id, cardId));

		return apiJson(event, { ok: true });
	}

	if (action === 'deleteCard') {
		const cardId = textFrom(body, 'cardId');

		if (!cardId || !(await requireCard(db, board.id, cardId))) {
			return apiError(event, 400, 'Card not found');
		}

		await db.delete(kanbanCard).where(eq(kanbanCard.id, cardId));
		return apiJson(event, { ok: true });
	}

	if (action === 'moveCards') {
		const submitted = Array.isArray(body.columns) ? body.columns : [];
		const columns = await getColumns(db, board.id);
		const columnIds = new Set(columns.map((column) => column.id));

		if (
			submitted.length !== columns.length ||
			submitted.some(
				(column) =>
					typeof column !== 'object' ||
					column === null ||
					typeof (column as { id?: unknown }).id !== 'string' ||
					!Array.isArray((column as { cardIds?: unknown }).cardIds) ||
					(column as { cardIds: unknown[] }).cardIds.some((cardId) => typeof cardId !== 'string') ||
					!columnIds.has((column as { id: string }).id)
			)
		) {
			return apiError(event, 400, 'Card order is invalid');
		}

		const submittedColumns = submitted as { id: string; cardIds: string[] }[];
		const submittedCardIds = submittedColumns.flatMap((column) => column.cardIds);
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
			return apiError(event, 400, 'Card order contains an unknown card');
		}

		for (const column of submittedColumns) {
			for (const [position, cardId] of column.cardIds.entries()) {
				await db.update(kanbanCard).set({ columnId: column.id, position }).where(eq(kanbanCard.id, cardId));
			}
		}

		return apiJson(event, { ok: true });
	}

	return apiError(event, 400, 'Unknown board action');
};
