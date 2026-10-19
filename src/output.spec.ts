/**
 * @fileoverview Tests for response output.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiResponse } from "./client.js";
import { UsageError } from "./errors.js";
import {
	formatJson,
	shouldPrettyPrint,
	writeResponse,
	type Io,
} from "./output.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

/**
 * Creates streams that remember what was written.
 * @param tty Whether standard output is a terminal.
 * @returns The streams and the chunks written to them.
 */
function fakeIo(tty = false): { io: Io; out: (string | Uint8Array)[] } {
	const out: (string | Uint8Array)[] = [];
	const io: Io = {
		stdout: { write: chunk => out.push(chunk), isTTY: tty },
		stderr: { write: () => true, isTTY: tty },
		stdin: Object.assign(Readable.from([]), { isTTY: false }),
	};

	return { io, out };
}

let dir: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "bredbox-output-"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("formatJson()", () => {
	it("should indent when pretty", () => {
		expect(formatJson({ a: 1 }, true)).toBe('{\n  "a": 1\n}\n');
	});

	it("should print one line when not pretty", () => {
		expect(formatJson({ a: 1 }, false)).toBe('{"a":1}\n');
	});
});

describe("shouldPrettyPrint()", () => {
	it("should follow --pretty and --compact, then the terminal", () => {
		const { io: tty } = fakeIo(true);
		const { io: pipe } = fakeIo(false);

		expect(shouldPrettyPrint({ io: pipe, pretty: true })).toBe(true);
		expect(shouldPrettyPrint({ io: tty, compact: true })).toBe(false);
		expect(shouldPrettyPrint({ io: tty })).toBe(true);
		expect(shouldPrettyPrint({ io: pipe })).toBe(false);
	});
});

describe("writeResponse()", () => {
	const json: ApiResponse = {
		status: 200,
		contentType: "application/json",
		kind: "json",
		data: { a: [1, 2] },
	};

	it("should write compact JSON when piped", () => {
		const { io, out } = fakeIo(false);

		writeResponse(json, { io });

		expect(out).toEqual(['{"a":[1,2]}\n']);
	});

	it("should write indented JSON on a terminal", () => {
		const { io, out } = fakeIo(true);

		writeResponse(json, { io });

		expect(out).toEqual(['{\n  "a": [\n    1,\n    2\n  ]\n}\n']);
	});

	it("should write text with a trailing newline", () => {
		const { io, out } = fakeIo(false);

		writeResponse(
			{
				status: 200,
				contentType: "text/plain",
				kind: "text",
				data: "hi",
			},
			{ io },
		);
		writeResponse(
			{
				status: 200,
				contentType: "text/plain",
				kind: "text",
				data: "yo\n",
			},
			{ io },
		);

		expect(out).toEqual(["hi\n", "yo\n"]);
	});

	it("should write nothing for an empty response", () => {
		const { io, out } = fakeIo(false);

		writeResponse(
			{ status: 204, contentType: null, kind: "none", data: undefined },
			{ io },
		);

		expect(out).toEqual([]);
	});

	it("should write bytes when piped", () => {
		const { io, out } = fakeIo(false);
		const bytes = new Uint8Array([80, 75]);

		writeResponse(
			{
				status: 200,
				contentType: "application/zip",
				kind: "binary",
				data: bytes,
			},
			{ io },
		);

		expect(out).toEqual([bytes]);
	});

	it("should refuse to write bytes to a terminal", () => {
		const { io } = fakeIo(true);

		expect(() =>
			writeResponse(
				{
					status: 200,
					contentType: "application/zip",
					kind: "binary",
					data: new Uint8Array([1]),
				},
				{ io },
			),
		).toThrow(
			new UsageError(
				"The response is binary (application/zip); pass --output <file> to save it.",
			),
		);
	});

	it("should write to the output file instead of standard output", () => {
		const { io, out } = fakeIo(true);
		const path = join(dir, "out.zip");

		writeResponse(
			{
				status: 200,
				contentType: "application/zip",
				kind: "binary",
				data: new Uint8Array([1, 2]),
			},
			{ io, output: path },
		);

		expect(out).toEqual([]);
		expect([...readFileSync(path)]).toEqual([1, 2]);
	});
});
