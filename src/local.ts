/**
 * @fileoverview Commands written by hand, which the API does not describe:
 * saving and clearing the access token.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import type { ArgValues, GlobalFlags } from "./args.js";
import type { BredboxClient } from "./client.js";
import {
	API_URL_ENV,
	deleteConfig,
	TOKEN_ENV,
	writeConfig,
	type Config,
	type Settings,
} from "./config.js";
import { UsageError } from "./errors.js";
import { formatJson, shouldPrettyPrint, type Io } from "./output.js";
import type { Command, CommandGroup } from "./types.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * What a local command runs with.
 */
export interface LocalContext {
	/** The values of the arguments of the command, by argument name. */
	values: ArgValues;

	/** The global flags. */
	globals: GlobalFlags;

	/** The streams. */
	io: Io;

	/** The environment. */
	env: NodeJS.ProcessEnv;

	/** The path of the config file. */
	configPath: string;

	/** The saved config. */
	config: Config;

	/** The settings resolved from flags, environment and config. */
	settings: Settings;

	/** A client with those settings. */
	client: BredboxClient;

	/** The version of the CLI. */
	version: string;
}

/**
 * A command that runs locally instead of sending a request.
 */
export interface LocalCommand extends Command {
	run(context: LocalContext): Promise<void>;
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * The operation that checks a token: the profile of its user.
 */
const ME: Command = {
	name: "get",
	summary: "Get current user profile",
	method: "GET",
	path: "/me",
	args: [],
	body: "none",
	response: "json",
};

/**
 * Reads everything from a stream.
 * @param stream The stream.
 * @returns Its text.
 */
async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
	let text = "";

	for await (const chunk of stream) {
		text += typeof chunk === "string" ? chunk : chunk.toString();
	}

	return text;
}

/**
 * Describes where the token in use comes from.
 * @param context The context of the command.
 * @returns A JSON-friendly summary of the auth settings.
 */
function status(context: LocalContext): Record<string, unknown> {
	const { globals, env, config, settings, configPath } = context;
	let tokenSource: string | null = null;

	if (globals.token) {
		tokenSource = "flag";
	} else if (env[TOKEN_ENV]) {
		tokenSource = "environment";
	} else if (config.token) {
		tokenSource = "config";
	}

	let apiUrlSource = "default";

	if (globals.apiUrl) {
		apiUrlSource = "flag";
	} else if (env[API_URL_ENV]) {
		apiUrlSource = "environment";
	} else if (config.apiUrl) {
		apiUrlSource = "config";
	}

	return {
		configPath,
		authenticated: settings.token !== undefined,
		tokenSource,
		apiUrl: settings.apiUrl,
		apiUrlSource,
	};
}

/**
 * Writes a JSON result the way responses are written.
 * @param context The context of the command.
 * @param data The result.
 * @returns Nothing.
 */
function writeJson(context: LocalContext, data: unknown): void {
	const { io, globals } = context;

	io.stdout.write(
		formatJson(
			data,
			shouldPrettyPrint({
				io,
				pretty: globals.pretty,
				compact: globals.compact,
			}),
		),
	);
}

//-----------------------------------------------------------------------------
// Commands
//-----------------------------------------------------------------------------

const login: LocalCommand = {
	name: "login",
	summary: "Save an access token for later commands",
	description:
		"Checks the token given with --token against the API, then saves it in the config file. Create tokens in your Bredbox account settings. The token may also be piped on standard input instead.",
	method: "",
	path: "",
	args: [
		{
			name: "verify",
			wire: "verify",
			in: "none",
			type: "boolean",
			required: false,
			default: true,
			description:
				"Check the token against the API before saving it; pass --no-verify to skip.",
		},
	],
	body: "none",
	response: "json",
	async run(context) {
		const { values, globals, io, config, configPath, client } = context;
		let token = globals.token;

		if (token === undefined && !io.stdin.isTTY) {
			token = (await readAll(io.stdin)).trim();
		}

		if (!token) {
			throw new UsageError(
				"Expected --token <token>, or a token on standard input.",
				["auth", "login"],
			);
		}

		let user: unknown;

		if (values.verify !== false) {
			user = (await client.withToken(token).send(ME, {})).data;
		}

		const next: Config = { ...config, token };

		if (globals.apiUrl) {
			next.apiUrl = globals.apiUrl;
		}

		writeConfig(configPath, next);

		writeJson(context, {
			...status({
				...context,
				config: next,
				settings: { ...context.settings, token },
			}),
			tokenSource: "config",
			...(user === undefined ? {} : { user }),
		});
	},
};

const logout: LocalCommand = {
	name: "logout",
	summary: "Delete the saved access token",
	method: "",
	path: "",
	args: [],
	body: "none",
	response: "json",
	async run(context) {
		deleteConfig(context.configPath);
		writeJson(context, {
			...status({
				...context,
				config: {},
				settings: {
					...context.settings,
					token:
						context.globals.token ??
						context.env[TOKEN_ENV] ??
						undefined,
				},
			}),
		});
	},
};

const authStatus: LocalCommand = {
	name: "status",
	summary: "Show where the access token and API URL come from",
	method: "",
	path: "",
	args: [],
	body: "none",
	response: "json",
	async run(context) {
		writeJson(context, status(context));
	},
};

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The groups of local commands.
 */
export const localGroups: readonly CommandGroup[] = [
	{
		name: "auth",
		description: "Save, check, or delete the access token the CLI uses",
		commands: [login, logout, authStatus],
		groups: [],
	},
];

/**
 * Reports whether a command runs locally.
 * @param command The command.
 * @returns Whether it has a `run` function.
 */
export function isLocalCommand(command: Command): command is LocalCommand {
	return typeof (command as LocalCommand).run === "function";
}
