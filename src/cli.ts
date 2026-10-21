/**
 * @fileoverview The command line interface: resolves a command from the
 * words given, parses its arguments, sends its request, and prints the
 * response.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { createRequire } from "node:module";
import { createInterface } from "node:readline/promises";
import {
	globalFlagLength,
	parseCommandLine,
	parseGlobals,
	type GlobalFlags,
} from "./args.js";
import { BredboxClient } from "./client.js";
import {
	configPath as defaultConfigPath,
	readConfig,
	resolveSettings,
} from "./config.js";
import {
	ApiError,
	CancelledError,
	EXIT_FAILURE,
	EXIT_USAGE,
	UsageError,
} from "./errors.js";
import { api, groups as generatedGroups } from "./generated/index.js";
import {
	commandHelp,
	commandSchema,
	groupHelp,
	groupSchema,
	PROGRAM,
	rootHelp,
	rootSchema,
} from "./help.js";
import { isLocalCommand, localGroups } from "./local.js";
import {
	formatJson,
	shouldPrettyPrint,
	writeResponse,
	type Io,
} from "./output.js";
import type { Command, CommandGroup } from "./types.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * The options of a run.
 */
export interface RunOptions {
	/** The streams to talk to; the process streams by default. */
	io?: Io | undefined;

	/** The environment to read; the process environment by default. */
	env?: NodeJS.ProcessEnv | undefined;

	/** The fetch function to send requests with; the global one by default. */
	fetch?: typeof fetch | undefined;

	/** The path of the config file; the default location by default. */
	configPath?: string | undefined;

	/** The command groups to run; the generated and local ones by default. */
	groups?: readonly CommandGroup[] | undefined;

	/**
	 * Asks the user to confirm a command; by default, asks on the terminal,
	 * and refuses when there is no terminal.
	 */
	confirm?: ((message: string, io: Io) => Promise<boolean>) | undefined;
}

/**
 * What the words of a command line resolve to.
 */
export type Resolution =
	| { kind: "root"; rest: string[] }
	| { kind: "group"; group: CommandGroup; path: string[]; rest: string[] }
	| { kind: "command"; command: Command; path: string[]; rest: string[] };

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const { version: VERSION } = require("../package.json") as {
	version: string;
};

/**
 * The description shown at the top of the root help.
 */
const DESCRIPTION = `Command line interface for the Bredbox API (${api.title} ${api.version}).`;

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The version of the CLI.
 */
export const version = VERSION;

/**
 * Resolves the leading words of `argv` to a group or command of `groups`.
 * Global flags may come between the words, and are moved to the front of
 * the arguments left over. Words stop at any other flag, or at the first
 * word that names a command.
 * @param groups The top-level groups.
 * @param argv The arguments after the program name.
 * @returns What the words resolve to, and the arguments left over.
 * @throws {UsageError} If a word names nothing.
 */
export function resolveCommand(
	groups: readonly CommandGroup[],
	argv: readonly string[],
): Resolution {
	const path: string[] = [];
	const globals: string[] = [];
	let group: CommandGroup | undefined;
	let index = 0;

	while (index < argv.length) {
		const flagLength = globalFlagLength(argv, index);

		if (flagLength > 0) {
			globals.push(...argv.slice(index, index + flagLength));
			index += flagLength;
			continue;
		}

		if (argv[index].startsWith("-")) {
			break;
		}

		const word = argv[index];
		const candidates = group ? group.groups : groups;
		const subgroup = candidates.find(candidate => candidate.name === word);

		if (subgroup) {
			group = subgroup;
			path.push(word);
			index++;
			continue;
		}

		const command = group?.commands.find(
			candidate => candidate.name === word,
		);

		if (command) {
			path.push(word);
			return {
				kind: "command",
				command,
				path,
				rest: [...globals, ...argv.slice(index + 1)],
			};
		}

		if (group) {
			throw new UsageError(
				`Unknown command "${word}" in "${[PROGRAM, ...path].join(" ")}".`,
				path,
			);
		}

		throw new UsageError(`Unknown command "${word}".`);
	}

	const rest = [...globals, ...argv.slice(index)];

	return group
		? { kind: "group", group, path, rest }
		: { kind: "root", rest };
}

/**
 * Runs the CLI.
 * @param argv The arguments after the program name.
 * @param options The options of the run.
 * @returns The exit code.
 */
export async function run(
	argv: readonly string[],
	options: RunOptions = {},
): Promise<number> {
	const io: Io = options.io ?? {
		stdout: process.stdout,
		stderr: process.stderr,
		stdin: process.stdin,
	};
	const groups = options.groups ?? [...localGroups, ...generatedGroups];
	let path: readonly string[] = [];

	try {
		const resolution = resolveCommand(groups, argv);

		switch (resolution.kind) {
			case "root":
				return runRoot(resolution.rest, groups, io);

			case "group":
				path = resolution.path;
				return runGroup(resolution, io);

			default:
				path = resolution.path;
				return await runCommand(resolution, { ...options, io });
		}
	} catch (error) {
		return report(error, path, io);
	}
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Handles a command line that names no command.
 * @param rest The arguments.
 * @param groups The top-level groups.
 * @param io The streams.
 * @returns The exit code.
 */
function runRoot(
	rest: readonly string[],
	groups: readonly CommandGroup[],
	io: Io,
): number {
	if (rest.includes("--version") || rest.includes("-v")) {
		io.stdout.write(`${VERSION}\n`);
		return 0;
	}

	if (wantsHelp(rest)) {
		const { globals } = parseGlobals(rest);

		if (globals.json) {
			writeHelpJson(
				rootSchema(groups, DESCRIPTION, VERSION),
				globals,
				io,
			);
			return 0;
		}
	}

	const help = rootHelp(groups, DESCRIPTION);

	if (rest.length === 0 || wantsHelp(rest)) {
		io.stdout.write(help);
		return 0;
	}

	io.stderr.write(help);
	io.stderr.write(`\n${PROGRAM}: Expected a command.\n`);
	return EXIT_USAGE;
}

/**
 * Handles a command line that names a group but no command in it.
 * @param resolution The group and the arguments left over.
 * @param io The streams.
 * @returns The exit code.
 */
function runGroup(
	resolution: Extract<Resolution, { kind: "group" }>,
	io: Io,
): number {
	if (wantsHelp(resolution.rest)) {
		const { globals } = parseGlobals(resolution.rest);

		if (globals.json) {
			writeHelpJson(
				groupSchema(resolution.group, resolution.path),
				globals,
				io,
			);
			return 0;
		}
	}

	const help = groupHelp(resolution.group, resolution.path);

	if (resolution.rest.length === 0 || wantsHelp(resolution.rest)) {
		io.stdout.write(help);
		return 0;
	}

	io.stderr.write(help);
	io.stderr.write(`\n${PROGRAM}: Expected a command.\n`);
	return EXIT_USAGE;
}

/**
 * Runs a command.
 * @param resolution The command, its path, and its arguments.
 * @param options The options of the run, with the streams filled in.
 * @returns The exit code.
 */
async function runCommand(
	resolution: Extract<Resolution, { kind: "command" }>,
	options: RunOptions & { io: Io },
): Promise<number> {
	const { command, path, rest } = resolution;
	const { io } = options;
	const env = options.env ?? process.env;
	const configPath = options.configPath ?? defaultConfigPath(env);
	const parsed = parseCommandLine(command, rest, path);

	if (parsed.globals.help) {
		if (parsed.globals.json) {
			writeHelpJson(commandSchema(command, path), parsed.globals, io);
			return 0;
		}

		io.stdout.write(commandHelp(command, path));
		return 0;
	}

	const config = readConfig(configPath);
	const settings = resolveSettings({
		flags: { apiUrl: parsed.globals.apiUrl },
		env,
		config,
		defaultApiUrl: api.baseUrl,
	});
	const client = new BredboxClient({
		baseUrl: settings.apiUrl,
		token: settings.token,
		userAgent: `${PROGRAM}-cli/${VERSION}`,
		fetch: options.fetch,
	});

	if (isLocalCommand(command)) {
		await command.run({
			values: parsed.values,
			globals: parsed.globals,
			io,
			env,
			configPath,
			config,
			settings,
			client,
			version: VERSION,
		});
		return 0;
	}

	if (parsed.globals.dryRun) {
		const request = client.prepare(command, parsed.values, parsed.body);
		io.stdout.write(
			formatJson(describeRequest(request), !parsed.globals.compact),
		);
		return 0;
	}

	if (settings.token === undefined) {
		throw new UsageError(
			`No access token. Run '${PROGRAM} auth login' to save one, or set BREDBOX_TOKEN.`,
			path,
		);
	}

	if (command.confirmation !== undefined && !parsed.globals.force) {
		const confirm = options.confirm ?? confirmOnTerminal;
		const message =
			command.confirmation === ""
				? "This command cannot be undone."
				: command.confirmation;

		if (!(await confirm(message, io))) {
			throw new CancelledError("Cancelled.");
		}
	}

	const response = await client.send(command, parsed.values, parsed.body);

	writeResponse(response, {
		io,
		pretty: parsed.globals.pretty,
		compact: parsed.globals.compact,
		json: parsed.globals.json,
		table: parsed.globals.table,
		output: parsed.globals.output,
		columns: command.columns,
		color: !env.NO_COLOR,
	});

	return 0;
}

/**
 * Asks for confirmation on the terminal. Without a terminal to ask on,
 * refuses, so that scripts pass `--force` on purpose.
 * @param message The sentence that says what the command does.
 * @param io The streams.
 * @returns Whether the user agreed.
 * @throws {CancelledError} If there is no terminal to ask on.
 */
async function confirmOnTerminal(message: string, io: Io): Promise<boolean> {
	if (!io.stdin.isTTY) {
		throw new CancelledError(
			`${message} Pass --force to run without confirmation.`,
		);
	}

	const rl = createInterface({
		input: io.stdin,
		output: io.stderr as unknown as NodeJS.WritableStream,
	});

	try {
		const answer = await rl.question(`${message} Continue? [y/N] `);
		return /^y(?:es)?$/iu.test(answer.trim());
	} finally {
		rl.close();
	}
}

/**
 * Describes a prepared request for `--dry-run`, with the token masked.
 * @param request The request.
 * @returns A JSON-friendly description.
 */
function describeRequest(request: {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string | FormData | undefined;
}): Record<string, unknown> {
	const headers = { ...request.headers };

	if (headers.Authorization) {
		headers.Authorization = "Bearer ***";
	}

	let body: unknown;

	if (typeof request.body === "string") {
		try {
			body = JSON.parse(request.body);
		} catch {
			body = request.body;
		}
	} else if (request.body instanceof FormData) {
		body = Object.fromEntries(
			[...request.body.entries()].map(([key, value]) => [
				key,
				typeof value === "string" ? value : `<file ${value.name}>`,
			]),
		);
	}

	return {
		method: request.method,
		url: request.url,
		headers,
		...(body === undefined ? {} : { body }),
	};
}

/**
 * Reports whether the arguments ask for help.
 * @param argv The arguments.
 * @returns Whether `--help` or `-h` is among them.
 */
function wantsHelp(argv: readonly string[]): boolean {
	return argv.includes("--help") || argv.includes("-h");
}

/**
 * Writes help as JSON, for `--help --json`, indented as a response would be.
 * @param schema The description of the program, group or command.
 * @param globals The global flags.
 * @param io The streams.
 */
function writeHelpJson(schema: unknown, globals: GlobalFlags, io: Io): void {
	io.stdout.write(
		formatJson(
			schema,
			shouldPrettyPrint({
				io,
				pretty: globals.pretty,
				compact: globals.compact,
			}),
		),
	);
}

/**
 * Writes an error to standard error and returns the exit code for it.
 * @param error The error.
 * @param path The words of the command that was running, if any.
 * @param io The streams.
 * @returns The exit code.
 */
function report(error: unknown, path: readonly string[], io: Io): number {
	if (error instanceof UsageError) {
		const words = error.commandPath.length > 0 ? error.commandPath : path;
		io.stderr.write(`${PROGRAM}: ${error.message}\n`);
		io.stderr.write(
			`Run '${[PROGRAM, ...words].join(" ")} --help' for usage.\n`,
		);
		return EXIT_USAGE;
	}

	if (error instanceof ApiError) {
		io.stderr.write(`${PROGRAM}: ${error.message}\n`);

		if (typeof error.body === "object" && error.body !== null) {
			io.stderr.write(formatJson(error.body, true));
		}

		return EXIT_FAILURE;
	}

	if (error instanceof CancelledError) {
		io.stderr.write(`${PROGRAM}: ${error.message}\n`);
		return EXIT_FAILURE;
	}

	const message = error instanceof Error ? error.message : String(error);
	io.stderr.write(`${PROGRAM}: ${message}\n`);
	return EXIT_FAILURE;
}

/**
 * The flags every command accepts, re-exported for callers of `run`.
 */
export type { GlobalFlags };
