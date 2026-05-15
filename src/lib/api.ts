import { env } from '$env/dynamic/public';
import { recordDebugLog } from '$lib/debug-tools';

export type AppUser = {
	id: string;
	name?: string | null;
	email: string;
};

export type BoardSummary = {
	id: string;
	title: string;
	projectLocation: string;
	updatedAt: string | Date;
};

export type CardImage = {
	dataUrl: string;
	mimeType: string;
	byteSize: number;
	width: number;
	height: number;
};

export type BoardCard = {
	id: string;
	columnId: string;
	description: string;
	color: string;
	position: number;
	image: CardImage | null;
};

export type BoardColumn = {
	id: string;
	title: string;
	color: string;
	position: number;
	cards: BoardCard[];
};

export type BoardsResponse = {
	user: AppUser;
	boards: BoardSummary[];
};

export type BoardResponse = {
	user: AppUser;
	board: {
		id: string;
		title: string;
		projectLocation: string;
		userId: string;
	};
	columns: BoardColumn[];
};

export class ApiError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'ApiError';
	}
}

const baseUrl = () => (env.PUBLIC_API_BASE_URL ?? '').replace(/\/$/, '');
const apiUrl = (path: string) => `${baseUrl()}${path}`;

const appOrigin = () => (typeof window === 'undefined' ? 'server' : window.location.origin);

const readJson = async <T>(response: Response, path: string) => {
	const contentType = response.headers.get('content-type') ?? '';

	if (!contentType.toLowerCase().includes('application/json')) {
		const text = await response.text();
		const returnedHtml = text.trimStart().startsWith('<');
		const message = returnedHtml
			? 'API returned the app page instead of JSON. Set PUBLIC_API_BASE_URL to the deployed backend URL and rebuild the desktop app.'
			: `API response for ${path} was not JSON.`;

		throw new ApiError(message, response.status);
	}

	return (await response.json()) as T;
};

export async function apiFetch<T>(path: string, init: RequestInit = {}) {
	let response: Response;
	const url = apiUrl(path);
	const method = init.method ?? 'GET';

	try {
		response = await fetch(url, {
			credentials: 'include',
			...init,
			headers: {
				accept: 'application/json',
				...(init.body ? { 'content-type': 'application/json' } : {}),
				...init.headers
			}
		});
	} catch (error) {
		if (error instanceof TypeError) {
			console.error('API fetch failed', {
				method,
				path,
				url,
				origin: appOrigin(),
				message: error.message
			});
			recordDebugLog('error', [
				'API fetch failed',
				{ method, path, url, origin: appOrigin(), message: error.message }
			]);

			throw new ApiError(
				`API is unreachable for ${method} ${url} from ${appOrigin()}: ${error.message}`,
				0
			);
		}

		throw error;
	}

	if (!response.ok) {
		let message = response.statusText || 'Request failed';

		try {
			const payload = await readJson<{ message?: string }>(response, path);
			message = payload.message ?? message;
		} catch {
			// Keep status text fallback.
		}
		recordDebugLog('error', [
			'API request failed',
			{ method, path, url, origin: appOrigin(), status: response.status, message }
		]);

		throw new ApiError(message, response.status);
	}

	if (response.status === 204) {
		return undefined as T;
	}

	return readJson<T>(response, path);
}

export const getSession = () => apiFetch<{ user: AppUser | null }>('/api/app/session');

export const signInEmail = (email: string, password: string) =>
	apiFetch<{ ok: true }>('/api/app/auth', {
		method: 'POST',
		body: JSON.stringify({ action: 'signInEmail', email, password })
	});

export const signUpEmail = (email: string, password: string, name: string) =>
	apiFetch<{ ok: true }>('/api/app/auth', {
		method: 'POST',
		body: JSON.stringify({ action: 'signUpEmail', email, password, name })
	});

export const signOut = () =>
	apiFetch<{ ok: true }>('/api/app/auth', {
		method: 'POST',
		body: JSON.stringify({ action: 'signOut' })
	});

export const getBoards = () => apiFetch<BoardsResponse>('/api/app/boards');

export const createBoard = (title: string) =>
	apiFetch<{ ok: true; boardId: string }>('/api/app/boards', {
		method: 'POST',
		body: JSON.stringify({ title })
	});

export const renameBoard = (boardId: string, title: string) =>
	apiFetch<{ ok: true }>('/api/app/boards', {
		method: 'PATCH',
		body: JSON.stringify({ boardId, title })
	});

export const deleteBoard = (boardId: string) =>
	apiFetch<{ ok: true }>('/api/app/boards', {
		method: 'DELETE',
		body: JSON.stringify({ boardId })
	});

export const getBoard = (boardId: string) => apiFetch<BoardResponse>(`/api/app/boards/${boardId}`);

export const boardAction = <T = { ok: true }>(boardId: string, body: Record<string, unknown>) =>
	apiFetch<T>(`/api/app/boards/${boardId}`, {
		method: 'POST',
		body: JSON.stringify(body)
	});
