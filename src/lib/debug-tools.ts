import { browser } from '$app/environment';

type DebugToolsModule = typeof import('tauri-plugin-debug-tools/consoleLogger');
type DebugLevel = Parameters<DebugToolsModule['debugTools']['record']>[0];

let debugToolsPromise: Promise<DebugToolsModule | null> | null = null;
let initialized = false;

const loadDebugTools = async () => {
	if (!browser) return null;

	try {
		const { isTauri } = await import('@tauri-apps/api/core');

		if (!isTauri()) return null;

		return await import('tauri-plugin-debug-tools/consoleLogger');
	} catch {
		return null;
	}
};

const getDebugTools = () => {
	debugToolsPromise ??= loadDebugTools();
	return debugToolsPromise;
};

export const initDebugTools = async () => {
	const tools = await getDebugTools();

	if (!tools || initialized) return;

	initialized = true;
	tools.debugTools.info('AI PM debug tools initialized', {
		origin: window.location.origin,
		pathname: window.location.pathname
	});
};

export const recordDebugLog = (level: DebugLevel, args: unknown[]) => {
	if (!browser) return;

	void getDebugTools()
		.then((tools) => tools?.debugTools.record(level, args))
		.catch(() => {
			// Debug logging must never affect app behavior.
		});
};
