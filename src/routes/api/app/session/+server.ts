import { apiJson, optionsResponse } from '$lib/server/api';
import type { RequestHandler } from './$types';

export const OPTIONS: RequestHandler = (event) => optionsResponse(event);

export const GET: RequestHandler = (event) =>
	apiJson(event, {
		user: event.locals.user ?? null
	});
