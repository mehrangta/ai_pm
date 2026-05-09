import { APIError } from 'better-auth/api';
import { apiError, apiJson, optionsResponse } from '$lib/server/api';
import type { RequestHandler } from './$types';

const readBody = async (request: Request) => {
	try {
		return (await request.json()) as Record<string, unknown>;
	} catch {
		return {};
	}
};

const textField = (body: Record<string, unknown>, key: string) =>
	typeof body[key] === 'string' ? body[key].trim() : '';

export const OPTIONS: RequestHandler = (event) => optionsResponse(event);

export const POST: RequestHandler = async (event) => {
	const body = await readBody(event.request);
	const action = textField(body, 'action');

	try {
		if (action === 'signInEmail') {
			const result = await event.locals.auth.api.signInEmail({
				headers: event.request.headers,
				returnHeaders: true,
				body: {
					email: textField(body, 'email'),
					password: typeof body.password === 'string' ? body.password : '',
					callbackURL: '/boards'
				}
			});

			return apiJson(event, { ok: true }, { headers: result.headers });
		}

		if (action === 'signUpEmail') {
			const email = textField(body, 'email');
			const name = textField(body, 'name');

			const result = await event.locals.auth.api.signUpEmail({
				headers: event.request.headers,
				returnHeaders: true,
				body: {
					email,
					password: typeof body.password === 'string' ? body.password : '',
					name: name || email,
					callbackURL: '/boards'
				}
			});

			return apiJson(event, { ok: true }, { headers: result.headers });
		}

		if (action === 'signOut') {
			const result = await event.locals.auth.api.signOut({
				headers: event.request.headers,
				returnHeaders: true
			});

			return apiJson(event, { ok: true }, { headers: result.headers });
		}
	} catch (error) {
		if (error instanceof APIError) {
			return apiError(event, 400, error.message || 'Authentication failed');
		}

		return apiError(event, 500, 'Unexpected authentication error');
	}

	return apiError(event, 400, 'Unknown authentication action');
};
