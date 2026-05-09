import { betterAuth } from "better-auth/minimal";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { sveltekitCookies } from "better-auth/svelte-kit";
import { env } from "$env/dynamic/private";
import { getRequestEvent } from "$app/server";
import { getDb } from "$lib/server/db";

const trustedOrigins = () =>
	[
		env.ORIGIN,
		...(env.CORS_ORIGINS ?? env.PUBLIC_CORS_ORIGINS ?? '')
			.split(',')
			.map((origin) => origin.trim())
			.filter(Boolean),
		'http://localhost:5173',
		'http://127.0.0.1:5173',
		'tauri://localhost',
		'http://tauri.localhost'
	].filter(Boolean);

const isHttpsOrigin = () => env.ORIGIN?.startsWith('https://') ?? false;

const passwordHashPrefix = 'pbkdf2-sha256';
const passwordHashIterations = 75_000;
const passwordHashBytes = 32;
const passwordSaltBytes = 16;
const textEncoder = new TextEncoder();

const bytesToBase64 = (bytes: Uint8Array) => {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

const base64ToBytes = (value: string) => {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
	return bytes;
};

const derivePasswordHash = async (password: string, salt: Uint8Array, iterations: number) => {
	const key = await crypto.subtle.importKey('raw', textEncoder.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);
	const saltBuffer = new ArrayBuffer(salt.byteLength);
	new Uint8Array(saltBuffer).set(salt);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: saltBuffer, iterations },
		key,
		passwordHashBytes * 8
	);
	return new Uint8Array(bits);
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array) => {
	if (left.length !== right.length) return false;

	let diff = 0;
	for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
	return diff === 0;
};

const hashPassword = async (password: string) => {
	const salt = crypto.getRandomValues(new Uint8Array(passwordSaltBytes));
	const hash = await derivePasswordHash(password, salt, passwordHashIterations);

	return [passwordHashPrefix, passwordHashIterations, bytesToBase64(salt), bytesToBase64(hash)].join(':');
};

const verifyPassword = async ({ hash, password }: { hash: string; password: string }) => {
	const [prefix, iterationsValue, saltValue, hashValue] = hash.split(':');
	if (prefix !== passwordHashPrefix || !iterationsValue || !saltValue || !hashValue) return false;

	const iterations = Number(iterationsValue);
	if (!Number.isInteger(iterations) || iterations < 1) return false;

	const salt = base64ToBytes(saltValue);
	const expectedHash = base64ToBytes(hashValue);
	const actualHash = await derivePasswordHash(password, salt, iterations);

	return timingSafeEqual(actualHash, expectedHash);
};

const authConfig = ({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	trustedOrigins,
	emailAndPassword: {
		enabled: true,
		password: {
			hash: hashPassword,
			verify: verifyPassword
		}
	},
	advanced: {
		useSecureCookies: isHttpsOrigin(),
		defaultCookieAttributes: {
			sameSite: isHttpsOrigin() ? 'none' : 'lax',
			secure: isHttpsOrigin()
		}
	},
	plugins: [
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
}) satisfies Omit<Parameters<typeof betterAuth>[0], "database">;

export const createAuth = (d1: D1Database) => betterAuth({
	...authConfig,
	database: drizzleAdapter(getDb(d1), { provider: 'sqlite' })
});

/**
* DO NOT USE!
*
* This instance is used by the `better-auth` CLI for schema generation ONLY.
* To access `auth` at runtime, use `event.locals.auth`.
*/
export const auth = createAuth(null!);
