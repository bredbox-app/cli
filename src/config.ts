/**
 * @fileoverview Where the CLI keeps its settings, and how it resolves them.
 *
 * The access token and API URL come, in order of precedence, from flags,
 * environment variables, and the config file that `bredbox auth login`
 * writes.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * The settings saved on disk.
 */
export interface Config {
	/** The API access token. */
	token?: string;

	/** The base URL of the API, when not the default. */
	apiUrl?: string;
}

/**
 * The settings a command runs with.
 */
export interface Settings {
	/** The API access token, or nothing if none is configured. */
	token: string | undefined;

	/** The base URL of the API. */
	apiUrl: string;
}

/**
 * The flags that affect settings.
 */
export interface SettingsFlags {
	token?: string | undefined;
	apiUrl?: string | undefined;
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The environment variable that holds the access token.
 */
export const TOKEN_ENV = "BREDBOX_TOKEN";

/**
 * The environment variable that holds the API base URL.
 */
export const API_URL_ENV = "BREDBOX_API_URL";

/**
 * The environment variable that holds the path of the config file.
 */
export const CONFIG_PATH_ENV = "BREDBOX_CONFIG";

/**
 * Returns the path of the config file: `$BREDBOX_CONFIG` if set, else
 * `bredbox/config.json` under `$XDG_CONFIG_HOME`, `%APPDATA%` on Windows,
 * or `~/.config`.
 * @param env The environment to read.
 * @param platform The platform, for the default directory.
 * @returns The path of the config file.
 */
export function configPath(
	env: NodeJS.ProcessEnv = process.env,
	platform: NodeJS.Platform = process.platform,
): string {
	if (env[CONFIG_PATH_ENV]) {
		return env[CONFIG_PATH_ENV];
	}

	let base: string | undefined = env.XDG_CONFIG_HOME;

	if (!base && platform === "win32") {
		base = env.APPDATA;
	}

	if (!base) {
		base = join(homedir(), ".config");
	}

	return join(base, "bredbox", "config.json");
}

/**
 * Reads the config file, or returns an empty config if there is none.
 * @param path The path of the config file.
 * @returns The config.
 * @throws {Error} If the file exists but is not valid JSON.
 */
export function readConfig(path: string): Config {
	let text: string;

	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return {};
		}

		throw error;
	}

	let data: unknown;

	try {
		data = JSON.parse(text);
	} catch {
		throw new Error(`Expected ${path} to contain JSON.`);
	}

	if (typeof data !== "object" || data === null || Array.isArray(data)) {
		throw new Error(`Expected ${path} to contain a JSON object.`);
	}

	const config: Config = {};
	const record = data as Record<string, unknown>;

	if (typeof record.token === "string") {
		config.token = record.token;
	}

	if (typeof record.apiUrl === "string") {
		config.apiUrl = record.apiUrl;
	}

	return config;
}

/**
 * Writes the config file, creating its directory. The file is readable by
 * its owner only, since it holds a token.
 * @param path The path of the config file.
 * @param config The config to write.
 * @returns Nothing.
 */
export function writeConfig(path: string, config: Config): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, `${JSON.stringify(config, null, "\t")}\n`, {
		mode: 0o600,
	});
}

/**
 * Deletes the config file, if there is one.
 * @param path The path of the config file.
 * @returns Nothing.
 */
export function deleteConfig(path: string): void {
	rmSync(path, { force: true });
}

/**
 * Resolves the settings a command runs with from flags, the environment,
 * and the config file, in that order of precedence.
 * @param options The sources to resolve from.
 * @param options.flags The flags given on the command line.
 * @param options.env The environment.
 * @param options.config The saved config.
 * @param options.defaultApiUrl The API URL to use when nothing else gives one.
 * @returns The settings.
 */
export function resolveSettings({
	flags,
	env,
	config,
	defaultApiUrl,
}: {
	flags: SettingsFlags;
	env: NodeJS.ProcessEnv;
	config: Config;
	defaultApiUrl: string;
}): Settings {
	const token = firstNonEmpty(flags.token, env[TOKEN_ENV], config.token);
	const apiUrl =
		firstNonEmpty(flags.apiUrl, env[API_URL_ENV], config.apiUrl) ??
		defaultApiUrl;

	return { token, apiUrl: apiUrl.replace(/\/+$/u, "") };
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Returns the first value that is a non-empty string.
 * @param values The values to look through.
 * @returns The first non-empty string, or undefined.
 */
function firstNonEmpty(...values: (string | undefined)[]): string | undefined {
	for (const value of values) {
		if (typeof value === "string" && value.trim() !== "") {
			return value.trim();
		}
	}

	return undefined;
}
