/**
 * @fileoverview Writes responses to the terminal or a file.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { writeFileSync } from "node:fs";
import type { ApiResponse } from "./client.js";
import { UsageError } from "./errors.js";
import { formatHuman } from "./human.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * A stream the CLI writes to.
 */
export interface OutputStream {
	write(chunk: string | Uint8Array): unknown;
	isTTY?: boolean | undefined;

	/** The width of the terminal, if it is one. */
	columns?: number | undefined;
}

/**
 * A stream the CLI reads from.
 */
export interface InputStream extends NodeJS.ReadableStream {
	isTTY?: boolean | undefined;

	/** Turns raw mode on or off, if it is a terminal. */
	setRawMode?: ((mode: boolean) => unknown) | undefined;
}

/**
 * The streams the CLI talks to.
 */
export interface Io {
	stdout: OutputStream;
	stderr: OutputStream;
	stdin: InputStream;
}

/**
 * How to write a response.
 */
export interface WriteOptions {
	/** The streams to write to. */
	io: Io;

	/** Whether to pretty-print JSON regardless of the terminal. */
	pretty?: boolean | undefined;

	/** Whether to print JSON on one line regardless of the terminal. */
	compact?: boolean | undefined;

	/** A file to write the response to instead of standard output. */
	output?: string | undefined;

	/** Whether to print JSON regardless of the terminal. */
	json?: boolean | undefined;

	/** Whether to print a table regardless of the terminal. */
	table?: boolean | undefined;

	/** The columns of a table, from the command. */
	columns?: readonly string[] | undefined;

	/** Whether to embolden the headings of a table on a terminal. */
	color?: boolean | undefined;

	/** The time that dates in a table are relative to; now by default. */
	now?: Date | undefined;
}

/**
 * How JSON is written: as JSON, or formatted for people.
 */
export type OutputFormat = "json" | "table";

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Formats a JSON value for output.
 * @param data The value.
 * @param pretty Whether to indent it.
 * @returns The JSON text, ending in a newline.
 */
export function formatJson(data: unknown, pretty: boolean): string {
	return `${JSON.stringify(data, null, pretty ? 2 : 0)}\n`;
}

/**
 * Decides whether JSON should be indented: when asked, or when writing to a
 * terminal and not asked otherwise.
 * @param options The write options.
 * @returns Whether to indent.
 */
export function shouldPrettyPrint(options: WriteOptions): boolean {
	if (options.pretty) {
		return true;
	}

	if (options.compact) {
		return false;
	}

	return options.io.stdout.isTTY === true;
}

/**
 * Decides how JSON is written: as a table when asked, or when writing to a
 * terminal and not asked for JSON in any way, and as JSON otherwise.
 * @param options The write options.
 * @returns The format.
 */
export function outputFormat(options: WriteOptions): OutputFormat {
	if (options.table) {
		return "table";
	}

	if (
		options.json ||
		options.pretty ||
		options.compact ||
		options.output !== undefined
	) {
		return "json";
	}

	return options.io.stdout.isTTY === true ? "table" : "json";
}

/**
 * Formats JSON data the way `options` asks, and returns notes about it for
 * standard error.
 * @param data The data.
 * @param options How to write it.
 * @returns The text, and notes about it.
 */
export function formatData(
	data: unknown,
	options: WriteOptions,
): { text: string; notes: string[] } {
	if (outputFormat(options) === "json") {
		return {
			text: formatJson(data, shouldPrettyPrint(options)),
			notes: [],
		};
	}

	const toTerminal =
		options.output === undefined && options.io.stdout.isTTY === true;

	return formatHuman(data, {
		columns: options.columns,
		width: toTerminal ? options.io.stdout.columns : undefined,
		color: toTerminal && options.color === true,
		now: options.now,
	});
}

/**
 * Writes JSON data to standard output, or to the file `options.output`
 * names, and any notes about it to standard error.
 * @param data The data.
 * @param options How to write it.
 * @returns Nothing.
 */
export function writeData(data: unknown, options: WriteOptions): void {
	const { text, notes } = formatData(data, options);

	if (options.output !== undefined) {
		writeFileSync(options.output, text);
	} else if (text !== "") {
		options.io.stdout.write(text);
	}

	for (const note of notes) {
		options.io.stderr.write(`${note}\n`);
	}
}

/**
 * Writes a response to standard output, or to the file `options.output`
 * names.
 * @param response The response.
 * @param options How to write it.
 * @returns Nothing.
 * @throws {UsageError} If a binary response would go to a terminal.
 */
export function writeResponse(
	response: ApiResponse,
	options: WriteOptions,
): void {
	const { io, output } = options;

	if (response.kind === "none") {
		return;
	}

	if (response.kind === "json") {
		writeData(response.data, options);
		return;
	}

	let chunk: string | Uint8Array;

	if (response.kind === "text") {
		const text = response.data as string;
		chunk = text.endsWith("\n") ? text : `${text}\n`;
	} else {
		chunk = response.data as Uint8Array;
	}

	if (output !== undefined) {
		writeFileSync(output, chunk);
		return;
	}

	if (response.kind === "binary" && io.stdout.isTTY) {
		throw new UsageError(
			`The response is binary (${response.contentType ?? "unknown type"}); pass --output <file> to save it.`,
		);
	}

	io.stdout.write(chunk);
}
