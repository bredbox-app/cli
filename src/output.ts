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

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * A stream the CLI writes to.
 */
export interface OutputStream {
	write(chunk: string | Uint8Array): unknown;
	isTTY?: boolean | undefined;
}

/**
 * A stream the CLI reads from.
 */
export interface InputStream extends NodeJS.ReadableStream {
	isTTY?: boolean | undefined;
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
}

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

	let chunk: string | Uint8Array;

	switch (response.kind) {
		case "json":
			chunk = formatJson(response.data, shouldPrettyPrint(options));
			break;

		case "text": {
			const text = response.data as string;
			chunk = text.endsWith("\n") ? text : `${text}\n`;
			break;
		}

		default:
			chunk = response.data as Uint8Array;
			break;
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
