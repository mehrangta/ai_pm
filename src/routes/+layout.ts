import { browser } from '$app/environment';
import { initDebugTools } from '$lib/debug-tools';

export const ssr = false;

if (browser) {
	void initDebugTools();
}
