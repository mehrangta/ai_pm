import { json, type RequestEvent } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const DEFAULT_ALLOWED_ORIGINS = [
	'http://localhost:5173',
	'http://127.0.0.1:5173',
	'tauri://localhost',
	'http://tauri.localhost'
];

const configuredOrigins = () =>
	(env.CORS_ORIGINS ?? env.PUBLIC_CORS_ORIGINS ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

const isAllowedOrigin = (origin: string) =>
	[...DEFAULT_ALLOWED_ORIGINS, ...configuredOrigins()].includes(origin) ||
	/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);

export const corsHeaders = (request: Request): Record<string, string> => {
	const origin = request.headers.get('origin');

	if (!origin || !isAllowedOrigin(origin)) {
		return {};
	}

	return {
		'access-control-allow-origin': origin,
		'access-control-allow-credentials': 'true',
		vary: 'Origin'
	};
};

export const optionsResponse = (event: RequestEvent) =>
	new Response(null, {
		status: 204,
		headers: mergeHeaders(corsHeaders(event.request), {
			'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
			'access-control-allow-headers': 'content-type'
		})
	});

const mergeHeaders = (base: HeadersInit, overrides?: HeadersInit) => {
	const headers = new Headers(base);

	if (overrides) {
		new Headers(overrides).forEach((value, key) => headers.set(key, value));
	}

	return headers;
};

export const apiJson = (
	event: RequestEvent,
	data: unknown,
	init: ResponseInit = {}
) =>
	json(data, {
		...init,
		headers: mergeHeaders(corsHeaders(event.request), init.headers)
	});

export const apiError = (event: RequestEvent, status: number, message: string) =>
	apiJson(event, { message }, { status });

export const requireApiUser = (event: RequestEvent) => {
	if (!event.locals.user) {
		return null;
	}

	return event.locals.user;
};
