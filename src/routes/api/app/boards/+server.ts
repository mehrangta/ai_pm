import { and, desc, eq } from 'drizzle-orm';
import type { RequestEvent } from '@sveltejs/kit';
import { apiError, apiJson, optionsResponse, requireApiUser } from '$lib/server/api';
import { getDb } from '$lib/server/db';
import { kanbanBoard } from '$lib/server/db/schema';
import type { RequestHandler } from './$types';

const titleFrom = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 120) : '');

const readBody = async (request: Request) => {
	try {
		return (await request.json()) as Record<string, unknown>;
	} catch {
		return {};
	}
};

const dbFor = (event: RequestEvent) => {
	const d1 = event.platform?.env.ai_pm_db;

	if (!d1) {
		throw new Error('D1 binding "ai_pm_db" not found');
	}

	return getDb(d1);
};

export const OPTIONS: RequestHandler = (event) => optionsResponse(event);

export const GET: RequestHandler = async (event) => {
	const user = requireApiUser(event);

	if (!user) {
		return apiError(event, 401, 'Authentication required');
	}

	const db = dbFor(event);
	const boards = await db
		.select({
			id: kanbanBoard.id,
			title: kanbanBoard.title,
			updatedAt: kanbanBoard.updatedAt
		})
		.from(kanbanBoard)
		.where(eq(kanbanBoard.userId, user.id))
		.orderBy(desc(kanbanBoard.updatedAt));

	return apiJson(event, { user, boards });
};

export const POST: RequestHandler = async (event) => {
	const user = requireApiUser(event);

	if (!user) {
		return apiError(event, 401, 'Authentication required');
	}

	const body = await readBody(event.request);
	const title = titleFrom(body.title);

	if (!title) {
		return apiError(event, 400, 'Board title is required');
	}

	const db = dbFor(event);
	const [board] = await db
		.insert(kanbanBoard)
		.values({ title, userId: user.id })
		.returning({ id: kanbanBoard.id });

	return apiJson(event, { ok: true, boardId: board.id }, { status: 201 });
};

export const PATCH: RequestHandler = async (event) => {
	const user = requireApiUser(event);

	if (!user) {
		return apiError(event, 401, 'Authentication required');
	}

	const body = await readBody(event.request);
	const boardId = typeof body.boardId === 'string' ? body.boardId : '';
	const title = titleFrom(body.title);

	if (!boardId || !title) {
		return apiError(event, 400, 'Board and title are required');
	}

	const db = dbFor(event);
	const owned = await db
		.select({ id: kanbanBoard.id })
		.from(kanbanBoard)
		.where(and(eq(kanbanBoard.id, boardId), eq(kanbanBoard.userId, user.id)))
		.limit(1);

	if (!owned[0]) {
		return apiError(event, 404, 'Board not found');
	}

	await db.update(kanbanBoard).set({ title, updatedAt: new Date() }).where(eq(kanbanBoard.id, boardId));

	return apiJson(event, { ok: true });
};

export const DELETE: RequestHandler = async (event) => {
	const user = requireApiUser(event);

	if (!user) {
		return apiError(event, 401, 'Authentication required');
	}

	const body = await readBody(event.request);
	const boardId = typeof body.boardId === 'string' ? body.boardId : '';

	if (!boardId) {
		return apiError(event, 400, 'Board is required');
	}

	const db = dbFor(event);
	const [board] = await db
		.select({ id: kanbanBoard.id, userId: kanbanBoard.userId })
		.from(kanbanBoard)
		.where(eq(kanbanBoard.id, boardId))
		.limit(1);

	if (!board || board.userId !== user.id) {
		return apiError(event, 404, 'Board not found');
	}

	await db.delete(kanbanBoard).where(eq(kanbanBoard.id, boardId));

	return apiJson(event, { ok: true });
};
