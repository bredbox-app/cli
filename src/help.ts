/**
 * @fileoverview Renders help for the program, a group, or a command.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import type { Arg, Command, CommandGroup } from "./types.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * A line of a two-column listing.
 */
type Row = [string, string];

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The name of the program, as shown in help.
 */
export const PROGRAM = "bredbox";

/**
 * The global options, as rows of help.
 */
export const GLOBAL_OPTION_ROWS: readonly Row[] = [
	["--api-url <url>", "API base URL (or set BREDBOX_API_URL)"],
	["--body <json|@file>", "Send this JSON as the request body"],
	["-o, --output <file>", "Write the response to a file"],
	["--pretty", "Indent JSON output (default when writing to a terminal)"],
	["--compact", "Print JSON on one line (default when piped)"],
	["--json", "Print JSON, even on a terminal"],
	["--table", "Print tables and fields (default on a terminal)"],
	["-f, --force", "Skip confirmation prompts"],
	["--dry-run", "Print the request instead of sending it"],
	["-h, --help", "Show help"],
	["-v, --version", "Show the version"],
];

/**
 * Renders the help of the whole program.
 * @param groups The top-level groups, in the order to list them.
 * @param description A sentence about the program.
 * @returns The help text.
 */
export function rootHelp(
	groups: readonly CommandGroup[],
	description: string,
): string {
	const lines = [
		`Usage: ${PROGRAM} <command> [options]`,
		"",
		description,
		"",
		"Commands:",
		...table(groups.map((group): Row => [group.name, group.description])),
		"",
		"Options:",
		...table(GLOBAL_OPTION_ROWS),
		"",
		`Run '${PROGRAM} <command> --help' for the commands in a group.`,
	];

	return `${lines.join("\n")}\n`;
}

/**
 * Renders the help of a group.
 * @param group The group.
 * @param path The words that name the group, top level first.
 * @returns The help text.
 */
export function groupHelp(
	group: CommandGroup,
	path: readonly string[],
): string {
	const full = [PROGRAM, ...path].join(" ");
	const lines = [`Usage: ${full} <command> [options]`, "", group.description];
	const commands = group.commands.filter(command => !command.hidden);

	if (commands.length > 0) {
		lines.push("", "Commands:");
		lines.push(
			...table(
				commands.map((command): Row => [
					command.name,
					command.deprecated
						? `${command.summary} (deprecated)`
						: command.summary,
				]),
			),
		);
	}

	if (group.groups.length > 0) {
		lines.push("", "Groups:");
		lines.push(
			...table(
				group.groups.map((sub): Row => [sub.name, sub.description]),
			),
		);
	}

	lines.push(
		"",
		`Run '${full} <command> --help' for the options of a command.`,
	);

	return `${lines.join("\n")}\n`;
}

/**
 * Renders the help of a command.
 * @param command The command.
 * @param path The words that name the command, top level first.
 * @returns The help text.
 */
export function commandHelp(command: Command, path: readonly string[]): string {
	const positionals = command.args.filter(arg => arg.positional);
	const flags = command.args.filter(arg => !arg.positional);
	const usage = [
		PROGRAM,
		...path,
		...positionals.map(arg => positionalLabel(arg)),
		"[options]",
	].join(" ");
	const lines = [`Usage: ${usage}`, "", command.summary];

	if (command.description && command.description !== command.summary) {
		lines.push("", wrap(command.description, 78));
	}

	if (command.deprecated) {
		lines.push("", "This command is deprecated.");
	}

	if (command.method !== "") {
		lines.push("", `Request: ${command.method} ${command.path}`);
	}

	if (positionals.length > 0) {
		lines.push("", "Arguments:");
		lines.push(
			...table(
				positionals.map((arg): Row => [
					positionalLabel(arg),
					argDescription(arg),
				]),
			),
		);
	}

	if (flags.length > 0) {
		lines.push("", "Options:");
		lines.push(
			...table(
				flags.map((arg): Row => [flagLabel(arg), argDescription(arg)]),
			),
		);
	}

	if (command.body === "object" || command.body === "array") {
		lines.push(
			"",
			wrap(
				command.body === "object"
					? "Body fields may also be given together with --body <json|@file>; flags override its fields."
					: "The body may also be given as a JSON array with --body <json|@file>.",
				78,
			),
		);
	}

	if (command.confirmation !== undefined) {
		lines.push(
			"",
			wrap(
				"This command asks for confirmation; pass --force to skip it.",
				78,
			),
		);
	}

	lines.push("", "Global options:", ...table(GLOBAL_OPTION_ROWS));

	return `${lines.join("\n")}\n`;
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Returns how a positional is written in a usage line.
 * @param arg The argument.
 * @returns The label.
 */
function positionalLabel(arg: Arg): string {
	const name = arg.array ? `${arg.name}...` : arg.name;

	return arg.required ? `<${name}>` : `[${name}]`;
}

/**
 * Returns how a flag is written in a listing.
 * @param arg The argument.
 * @returns The label.
 */
function flagLabel(arg: Arg): string {
	if (arg.type === "boolean") {
		return `--${arg.name}`;
	}

	const value = arg.type === "json" ? "json" : arg.type;
	const label = `--${arg.name} <${value}>`;

	return arg.array ? `${label}...` : label;
}

/**
 * Describes an argument: its description, choices, default and whether it
 * is required.
 * @param arg The argument.
 * @returns The description.
 */
function argDescription(arg: Arg): string {
	const parts: string[] = [];

	if (arg.description) {
		parts.push(arg.description.replace(/\s+/gu, " ").trim());
	}

	if (arg.choices) {
		parts.push(`One of: ${arg.choices.map(String).join(", ")}.`);
	}

	if (arg.file) {
		parts.push("Path of a file to upload.");
	}

	if (arg.array && !arg.positional) {
		parts.push("Repeat the flag for several values.");
	}

	if (arg.default !== undefined) {
		parts.push(`Default: ${JSON.stringify(arg.default)}.`);
	}

	if (arg.required && !arg.positional) {
		parts.push("Required.");
	}

	return parts.join(" ");
}

/**
 * Lays out rows in two aligned columns, indented by two spaces.
 * @param rows The rows.
 * @returns The lines.
 */
function table(rows: readonly Row[]): string[] {
	if (rows.length === 0) {
		return [];
	}

	const width = Math.min(
		Math.max(...rows.map(([label]) => label.length)),
		36,
	);

	const indent = `  ${" ".repeat(width)}  `;
	const columns = Math.max(80 - indent.length, 30);

	return rows.map(([label, text]) => {
		if (text === "") {
			return `  ${label}`;
		}

		const wrapped = wrap(text, columns).split("\n");
		const first =
			label.length > width
				? `  ${label}\n${indent}${wrapped[0]}`
				: `  ${label.padEnd(width)}  ${wrapped[0]}`;

		return [
			first,
			...wrapped.slice(1).map(line => `${indent}${line}`),
		].join("\n");
	});
}

/**
 * Wraps text at a column, breaking at spaces.
 * @param text The text.
 * @param columns The column to wrap at.
 * @returns The wrapped text.
 */
function wrap(text: string, columns: number): string {
	const words = text.replace(/\s+/gu, " ").trim().split(" ");
	const lines: string[] = [];
	let line = "";

	for (const word of words) {
		if (line !== "" && line.length + 1 + word.length > columns) {
			lines.push(line);
			line = word;
		} else {
			line = line === "" ? word : `${line} ${word}`;
		}
	}

	if (line !== "") {
		lines.push(line);
	}

	return lines.join("\n");
}
