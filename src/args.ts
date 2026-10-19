/**
 * @fileoverview Parses the command line of a command into argument values.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { UsageError } from "./errors.js";
import { RESERVED_FLAGS, type Arg, type Command } from "./types.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * The flags every command accepts.
 */
export interface GlobalFlags {
	/** Whether to show help. */
	help: boolean;

	/** Whether to show the version. */
	version: boolean;

	/** The access token to use. */
	token?: string | undefined;

	/** The API base URL to use. */
	apiUrl?: string | undefined;

	/** The raw JSON body, or `@path` of a file holding it. */
	body?: string | undefined;

	/** The file to write the response to. */
	output?: string | undefined;

	/** Whether to pretty-print JSON. */
	pretty: boolean;

	/** Whether to print JSON on one line. */
	compact: boolean;

	/** Whether to skip confirmations. */
	force: boolean;

	/** Whether to print the request instead of sending it. */
	dryRun: boolean;
}

/**
 * The values of the arguments of a command, by argument name.
 */
export type ArgValues = Record<string, unknown>;

/**
 * What a command line parses to.
 */
export interface ParsedCommandLine {
	/** The values of the arguments of the command, by argument name. */
	values: ArgValues;

	/** The body given with `--body`, parsed, or undefined. */
	body: unknown;

	/** The global flags. */
	globals: GlobalFlags;
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

export { RESERVED_FLAGS };

/**
 * Parses only the global flags from `argv`, tolerating anything else, and
 * returns the words that are not flags.
 * @param argv The arguments after the program name.
 * @returns The global flags and the positional words.
 */
export function parseGlobals(argv: readonly string[]): {
	globals: GlobalFlags;
	words: string[];
} {
	const { values, positionals } = parseArgs({
		args: [...argv],
		options: globalOptions(),
		strict: false,
		allowPositionals: true,
		allowNegative: true,
	});

	return { globals: toGlobals(values), words: positionals };
}

/**
 * Parses the command line of `command`.
 * @param command The command.
 * @param argv The arguments after the words that named the command.
 * @param commandPath The words that named the command, for error messages.
 * @returns The parsed command line.
 * @throws {UsageError} If the command line is wrong.
 */
export function parseCommandLine(
	command: Command,
	argv: readonly string[],
	commandPath: readonly string[] = [],
): ParsedCommandLine {
	const options: ParseArgsOptionsConfig = globalOptions();

	for (const arg of command.args) {
		if (arg.positional) {
			continue;
		}

		if (RESERVED_FLAGS.includes(arg.name)) {
			throw new UsageError(
				`Command argument --${arg.name} clashes with a global flag.`,
				commandPath,
			);
		}

		options[arg.name] = {
			type: arg.type === "boolean" ? "boolean" : "string",
			multiple: arg.array === true,
		};
	}

	let parsed: ReturnType<typeof parseArgs>;

	try {
		parsed = parseArgs({
			args: [...argv],
			options,
			strict: true,
			allowPositionals: true,
			allowNegative: true,
		});
	} catch (error) {
		throw new UsageError(cleanParseError(error), commandPath);
	}

	const globals = toGlobals(parsed.values);
	const values: ArgValues = {};

	if (globals.help) {
		return { values, body: undefined, globals };
	}

	const positionalArgs = command.args.filter(arg => arg.positional);
	const words = [...parsed.positionals];

	for (const arg of positionalArgs) {
		if (arg.array) {
			const rest = words.splice(0);

			if (rest.length > 0) {
				values[arg.name] = rest.map(word =>
					coerce(arg, word, commandPath),
				);
			}

			continue;
		}

		const word = words.shift();

		if (word !== undefined) {
			values[arg.name] = coerce(arg, word, commandPath);
		}
	}

	if (words.length > 0) {
		throw new UsageError(
			`Unexpected argument${words.length > 1 ? "s" : ""} ${words.map(word => JSON.stringify(word)).join(", ")}.`,
			commandPath,
		);
	}

	for (const arg of command.args) {
		if (arg.positional) {
			continue;
		}

		const raw = parsed.values[arg.name];

		if (raw === undefined) {
			continue;
		}

		if (Array.isArray(raw)) {
			values[arg.name] = raw.map(item =>
				coerce(arg, item as string | boolean, commandPath),
			);
		} else {
			values[arg.name] = coerce(
				arg,
				raw as string | boolean,
				commandPath,
			);
		}
	}

	let body: unknown;

	if (globals.body !== undefined) {
		if (command.body !== "object" && command.body !== "array") {
			throw new UsageError(
				"This command does not send a JSON body, so --body cannot be used.",
				commandPath,
			);
		}

		body = parseJson(readAtFile(globals.body), "--body", commandPath);
	}

	for (const arg of command.args) {
		if (!arg.required || values[arg.name] !== undefined) {
			continue;
		}

		if (body !== undefined && (arg.in === "body" || arg.in === "form")) {
			continue;
		}

		const label = arg.positional ? `<${arg.name}>` : `--${arg.name}`;
		throw new UsageError(
			`Missing required argument ${label}.`,
			commandPath,
		);
	}

	return { values, body, globals };
}

/**
 * Reads the text of a value, which names a file when it starts with `@`.
 * @param value The value.
 * @returns The value, or the contents of the file it names.
 * @throws {UsageError} If the file cannot be read.
 */
export function readAtFile(value: string): string {
	if (!value.startsWith("@")) {
		return value;
	}

	const path = value.slice(1);

	try {
		return readFileSync(path, "utf8");
	} catch (error) {
		throw new UsageError(
			`Could not read ${path}: ${(error as Error).message}`,
		);
	}
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Returns the `parseArgs` options of the global flags.
 * @returns The options.
 */
function globalOptions(): ParseArgsOptionsConfig {
	return {
		help: { type: "boolean", short: "h" },
		version: { type: "boolean", short: "v" },
		token: { type: "string" },
		"api-url": { type: "string" },
		body: { type: "string" },
		output: { type: "string", short: "o" },
		pretty: { type: "boolean" },
		compact: { type: "boolean" },
		force: { type: "boolean", short: "f" },
		"dry-run": { type: "boolean" },
	};
}

/**
 * Reads the global flags out of parsed values.
 * @param values The values `parseArgs` returned.
 * @returns The global flags.
 */
function toGlobals(values: Record<string, unknown>): GlobalFlags {
	return {
		help: values.help === true,
		version: values.version === true,
		token: optionalString(values.token),
		apiUrl: optionalString(values["api-url"]),
		body: optionalString(values.body),
		output: optionalString(values.output),
		pretty: values.pretty === true,
		compact: values.compact === true,
		force: values.force === true,
		dryRun: values["dry-run"] === true,
	};
}

/**
 * Returns a value if it is a string.
 * @param value The value.
 * @returns The string, or undefined.
 */
function optionalString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/**
 * Turns the message of a `parseArgs` error into one without the Node
 * details.
 * @param error The error.
 * @returns The message.
 */
function cleanParseError(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);

	return message
		.replace(/\. To specify a positional argument.*$/su, ".")
		.replace(/\s+/gu, " ")
		.trim();
}

/**
 * Converts the text of a value to the type of its argument.
 * @param arg The argument.
 * @param raw The text, or a boolean for a boolean flag.
 * @param commandPath The words of the command, for errors.
 * @returns The value.
 * @throws {UsageError} If the text is not a value of the type.
 */
function coerce(
	arg: Arg,
	raw: string | boolean,
	commandPath: readonly string[],
): unknown {
	const label = arg.positional ? `<${arg.name}>` : `--${arg.name}`;
	let value: unknown;

	switch (arg.type) {
		case "boolean":
			if (typeof raw === "boolean") {
				value = raw;
			} else if (raw === "true" || raw === "false") {
				value = raw === "true";
			} else {
				throw new UsageError(
					`Expected true or false for ${label}, got ${JSON.stringify(raw)}.`,
					commandPath,
				);
			}
			break;

		case "number": {
			const text = String(raw).trim();
			const number = text === "" ? NaN : Number(text);

			if (!Number.isFinite(number)) {
				throw new UsageError(
					`Expected a number for ${label}, got ${JSON.stringify(raw)}.`,
					commandPath,
				);
			}

			value = number;
			break;
		}

		case "json":
			value = parseJson(readAtFile(String(raw)), label, commandPath);
			break;

		default:
			value =
				arg.in === "body" || arg.in === "form"
					? readAtFile(String(raw))
					: String(raw);
			break;
	}

	if (arg.choices && !arg.choices.some(choice => choice === value)) {
		throw new UsageError(
			`Expected ${label} to be one of ${arg.choices.map(String).join(", ")}, got ${JSON.stringify(raw)}.`,
			commandPath,
		);
	}

	return value;
}

/**
 * Parses JSON text given on the command line.
 * @param text The text.
 * @param label What the text was given as, for errors.
 * @param commandPath The words of the command, for errors.
 * @returns The value.
 * @throws {UsageError} If the text is not JSON.
 */
function parseJson(
	text: string,
	label: string,
	commandPath: readonly string[],
): unknown {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw new UsageError(
			`Expected JSON for ${label}: ${(error as Error).message}`,
			commandPath,
		);
	}
}
