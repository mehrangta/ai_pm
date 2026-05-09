import { fail, redirect } from '@sveltejs/kit';
import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '$lib/server/db';
import { kanbanBoard } from '$lib/server/db/schema';
import type { Actions, PageServerLoad } from './$types';

const titleFrom = (formData: FormData) => formData.get('title')?.toString().trim().slice(0, 120) ?? '';

export const load: PageServerLoad = async (event) => {
	const user = event.locals.user;

	if (!user) {
		redirect(302, '/login');
	}

	const db = getDb(event.platform!.env.ai_pm_db);
	const boards = await db
		.select({
			id: kanbanBoard.id,
			title: kanbanBoard.title,
			updatedAt: kanbanBoard.updatedAt
		})
		.from(kanbanBoard)
		.where(eq(kanbanBoard.userId, user.id))
		.orderBy(desc(kanbanBoard.updatedAt));

	return { user, boards };
};

export const actions: Actions = {
	createBoard: async (event) => {
		const user = event.locals.user;

		if (!user) {
			redirect(302, '/login');
		}

		const formData = await event.request.formData();
		const title = titleFrom(formData);

		if (!title) {
			return fail(400, { message: 'Board title is required' });
		}

		const db = getDb(event.platform!.env.ai_pm_db);
		const [board] = await db
			.insert(kanbanBoard)
			.values({ title, userId: user.id })
			.returning({ id: kanbanBoard.id });

		redirect(302, `/boards/${board.id}`);
	},
	renameBoard: async (event) => {
		const user = event.locals.user;

		if (!user) {
			redirect(302, '/login');
		}

		const formData = await event.request.formData();
		const boardId = formData.get('boardId')?.toString() ?? '';
		const title = titleFrom(formData);

		if (!boardId || !title) {
			return fail(400, { message: 'Board and title are required' });
		}

		const db = getDb(event.platform!.env.ai_pm_db);
		const owned = await db
			.select({ id: kanbanBoard.id })
			.from(kanbanBoard)
			.where(and(eq(kanbanBoard.id, boardId), eq(kanbanBoard.userId, user.id)))
			.limit(1);

		if (!owned[0]) {
			return fail(404, { message: 'Board not found' });
		}

		await db
			.update(kanbanBoard)
			.set({ title, updatedAt: new Date() })
			.where(eq(kanbanBoard.id, boardId));

		return { ok: true };
	},
	deleteBoard: async (event) => {
		const user = event.locals.user;

		if (!user) {
			redirect(302, '/login');
		}

		const boardId = (await event.request.formData()).get('boardId')?.toString() ?? '';

		if (!boardId) {
			return fail(400, { message: 'Board is required' });
		}

		const db = getDb(event.platform!.env.ai_pm_db);
		const [board] = await db
			.select({ id: kanbanBoard.id, userId: kanbanBoard.userId })
			.from(kanbanBoard)
			.where(eq(kanbanBoard.id, boardId))
			.limit(1);

		if (!board || board.userId !== user.id) {
			return fail(404, { message: 'Board not found' });
		}

		await db.delete(kanbanBoard).where(eq(kanbanBoard.id, boardId));

		return { ok: true };
	},
	signOut: async (event) => {
		await event.locals.auth.api.signOut({
			headers: event.request.headers
		});

		redirect(302, '/login');
	}
};
