import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { createAuth } from '$lib/server/auth';
import { corsHeaders } from '$lib/server/api';
import { svelteKitHandler } from 'better-auth/svelte-kit';

const isAppApiRequest = (event: Parameters<Handle>[0]['event']) =>
	event.url.pathname.startsWith('/api/app/');

const withCorsHeaders = (request: Request, response: Response) => {
	const headers = new Headers(response.headers);
	new Headers(corsHeaders(request)).forEach((value, key) => headers.set(key, value));

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
};

const handleBetterAuth: Handle = async ({ event, resolve }) => {
	const d1 = event.platform?.env?.ai_pm_db;

	if (!d1) {
		if (building || process.env.TAURI_BUILD === 'true' || process.env.NODE_ENV !== 'production') {
			return resolve(event);
		}

		throw new Error('D1 binding "ai_pm_db" not found - are you running with wrangler?');
	}

	event.locals.auth = createAuth(d1);

	const { auth } = event.locals;
	const session = await auth.api.getSession({ headers: event.request.headers });

	if (session) {
		event.locals.session = session.session;
		event.locals.user = session.user;
	}

	return svelteKitHandler({ event, resolve, auth, building });
};

export const handle: Handle = async ({ event, resolve }) => {
	if (!isAppApiRequest(event)) {
		return handleBetterAuth({ event, resolve });
	}

	try {
		return withCorsHeaders(event.request, await handleBetterAuth({ event, resolve }));
	} catch (error) {
		console.error('API request failed', error);

		return new Response(JSON.stringify({ message: 'API request failed' }), {
			status: 500,
			headers: {
				...corsHeaders(event.request),
				'content-type': 'application/json'
			}
		});
	}
};
