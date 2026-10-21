/**
 * @fileoverview Tests for the command line parser.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	globalFlagLength,
	parseCommandLine,
	parseGlobals,
	readAtFile,
} from "./args.js";
import { UsageError } from "./errors.js";
import type { Command } from "./types.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

const command: Command = {
	name: "update",
	summary: "Update a thing",
	method: "PATCH",
	path: "/things/{thingId}",
	args: [
		{
			name: "thing-id",
			wire: "thingId",
			in: "path",
			type: "string",
			required: true,
			positional: true,
		},
		{
			name: "page",
			wire: "page",
			in: "query",
			type: "number",
			required: false,
		},
		{
			name: "filter",
			wire: "filter",
			in: "query",
			type: "string",
			required: false,
			choices: ["all", "inbox"],
		},
		{
			name: "tag",
			wire: "tags",
			in: "body",
			type: "string",
			array: true,
			required: false,
		},
		{
			name: "starred",
			wire: "starred",
			in: "body",
			type: "boolean",
			required: false,
		},
		{
			name: "meta",
			wire: "meta",
			in: "body",
			type: "json",
			required: false,
		},
		{
			name: "title",
			wire: "title",
			in: "body",
			type: "string",
			required: true,
		},
	],
	body: "object",
	response: "json",
};

const variadic: Command = {
	name: "set",
	summary: "Set the items",
	method: "PUT",
	path: "/items",
	args: [
		{
			name: "item",
			wire: "body",
			in: "body",
			type: "string",
			positional: true,
			array: true,
			required: false,
		},
	],
	body: "array",
	response: "json",
};

const noBody: Command = {
	name: "get",
	summary: "Get a thing",
	method: "GET",
	path: "/things",
	args: [],
	body: "none",
	response: "json",
};

let dir: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "bredbox-args-"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("parseCommandLine()", () => {
	it("should read positionals and typed flags", () => {
		const { values, body } = parseCommandLine(command, [
			"abc",
			"--page",
			"3",
			"--filter",
			"inbox",
			"--tag",
			"a",
			"--tag",
			"b",
			"--starred",
			"--meta",
			'{"x":1}',
			"--title",
			"Hello",
		]);

		expect(values).toEqual({
			"thing-id": "abc",
			page: 3,
			filter: "inbox",
			tag: ["a", "b"],
			starred: true,
			meta: { x: 1 },
			title: "Hello",
		});
		expect(body).toBeUndefined();
	});

	it("should read a negated boolean flag as false", () => {
		const { values } = parseCommandLine(command, [
			"abc",
			"--no-starred",
			"--title",
			"t",
		]);

		expect(values.starred).toBe(false);
	});

	it("should read the global flags from anywhere on the line", () => {
		const { globals } = parseCommandLine(command, [
			"abc",
			"--api-url",
			"http://localhost:8787",
			"--title",
			"t",
			"-o",
			"out.json",
			"--pretty",
			"--compact",
			"-f",
			"--dry-run",
		]);

		expect(globals).toEqual({
			help: false,
			version: false,
			apiUrl: "http://localhost:8787",
			body: undefined,
			output: "out.json",
			pretty: true,
			compact: true,
			json: false,
			table: false,
			force: true,
			dryRun: true,
		});
	});

	it("should read --json and --table", () => {
		expect(
			parseCommandLine(command, ["abc", "--title", "t", "--json"]).globals
				.json,
		).toBe(true);
		expect(
			parseCommandLine(command, ["abc", "--title", "t", "--table"])
				.globals.table,
		).toBe(true);
	});

	it("should throw for --table with a flag that asks for JSON", () => {
		for (const flag of ["json", "pretty", "compact"]) {
			expect(() =>
				parseCommandLine(command, ["--table", `--${flag}`], ["things"]),
			).toThrow(
				new UsageError(`Expected only one of --table and --${flag}.`, [
					"things",
				]),
			);
		}
	});

	it("should stop at --help without checking required arguments", () => {
		const { globals, values } = parseCommandLine(command, ["--help"]);

		expect(globals.help).toBe(true);
		expect(values).toEqual({});
	});

	it("should throw when a required positional is missing", () => {
		expect(() =>
			parseCommandLine(command, ["--title", "t"], ["things", "update"]),
		).toThrow(
			new UsageError(
				"Missing required argument <thing-id> (or --thing-id).",
				["things", "update"],
			),
		);
	});

	it("should throw when a required flag is missing", () => {
		expect(() => parseCommandLine(command, ["abc"])).toThrow(
			"Missing required argument --title.",
		);
	});

	it("should not require body flags when --body is given", () => {
		const { values, body } = parseCommandLine(command, [
			"abc",
			"--body",
			'{"title":"from body"}',
		]);

		expect(values).toEqual({ "thing-id": "abc" });
		expect(body).toEqual({ title: "from body" });
	});

	it("should throw when a number is not a number", () => {
		expect(() =>
			parseCommandLine(command, ["abc", "--page", "x", "--title", "t"]),
		).toThrow('Expected a number for --page, got "x".');
	});

	it("should throw when a value is not one of the choices", () => {
		expect(() =>
			parseCommandLine(command, [
				"abc",
				"--filter",
				"nope",
				"--title",
				"t",
			]),
		).toThrow('Expected --filter to be one of all, inbox, got "nope".');
	});

	it("should throw when JSON cannot be parsed", () => {
		expect(() =>
			parseCommandLine(command, [
				"abc",
				"--meta",
				"{oops",
				"--title",
				"t",
			]),
		).toThrow(/^Expected JSON for --meta: /u);
	});

	it("should throw when --body cannot be parsed", () => {
		expect(() =>
			parseCommandLine(command, ["abc", "--body", "nope"]),
		).toThrow(/^Expected JSON for --body: /u);
	});

	it("should throw when --body is given to a command without a body", () => {
		expect(() => parseCommandLine(noBody, ["--body", "{}"])).toThrow(
			"This command does not send a JSON body, so --body cannot be used.",
		);
	});

	it("should throw on an unknown flag", () => {
		expect(() => parseCommandLine(command, ["abc", "--wat"])).toThrow(
			"Unknown option '--wat'.",
		);
	});

	it("should throw on an extra positional", () => {
		expect(() =>
			parseCommandLine(command, ["abc", "def", "ghi", "--title", "t"]),
		).toThrow('Unexpected arguments "def", "ghi".');
	});

	it("should throw when a command argument clashes with a global flag", () => {
		const clashing: Command = {
			...noBody,
			args: [
				{
					name: "output",
					wire: "output",
					in: "query",
					type: "string",
					required: false,
				},
			],
		};

		expect(() => parseCommandLine(clashing, [])).toThrow(
			"Command argument --output clashes with a global flag.",
		);
	});

	it("should collect trailing positionals into a variadic argument", () => {
		const { values } = parseCommandLine(variadic, ["a", "b c", "d"]);

		expect(values).toEqual({ item: ["a", "b c", "d"] });
	});

	it("should leave a variadic argument out when no words are given", () => {
		const { values } = parseCommandLine(variadic, []);

		expect(values).toEqual({});
	});

	it("should read a positional given as a flag", () => {
		const { values } = parseCommandLine(command, [
			"--title",
			"t",
			"--thing-id",
			"abc",
		]);

		expect(values).toEqual({ "thing-id": "abc", title: "t" });
	});

	it("should give the words to the positionals not given as flags", () => {
		const twoIds: Command = {
			...noBody,
			args: [
				{
					name: "thing-id",
					wire: "thingId",
					in: "path",
					type: "string",
					required: true,
					positional: true,
				},
				{
					name: "part-id",
					wire: "partId",
					in: "path",
					type: "string",
					required: true,
					positional: true,
				},
			],
		};

		const { values } = parseCommandLine(twoIds, ["--thing-id", "a", "b"]);

		expect(values).toEqual({ "thing-id": "a", "part-id": "b" });
	});

	it("should read a variadic positional given as a repeated flag", () => {
		const { values } = parseCommandLine(variadic, [
			"--item",
			"a",
			"--item",
			"b c",
		]);

		expect(values).toEqual({ item: ["a", "b c"] });
	});

	it("should read the words after a positional given as a flag into a variadic argument", () => {
		const tagged: Command = {
			...variadic,
			args: [
				{
					name: "thing-id",
					wire: "thingId",
					in: "path",
					type: "string",
					required: true,
					positional: true,
				},
				...variadic.args,
			],
		};

		const { values } = parseCommandLine(tagged, [
			"--thing-id",
			"abc",
			"a",
			"b",
		]);

		expect(values).toEqual({ "thing-id": "abc", item: ["a", "b"] });
	});

	it("should throw for words left over when a variadic positional is given as a flag", () => {
		expect(() => parseCommandLine(variadic, ["--item", "a", "b"])).toThrow(
			new UsageError('Unexpected argument "b".'),
		);
	});

	it("should name the flag when a positional given as a flag has a bad value", () => {
		const numbered: Command = {
			...noBody,
			args: [
				{
					name: "count",
					wire: "count",
					in: "path",
					type: "number",
					required: true,
					positional: true,
				},
			],
		};

		expect(() => parseCommandLine(numbered, ["--count", "x"])).toThrow(
			'Expected a number for --count, got "x".',
		);
		expect(() => parseCommandLine(numbered, ["x"])).toThrow(
			'Expected a number for <count>, got "x".',
		);
	});

	it("should not give a flag to a positional named like a global flag", () => {
		const confirm: Command = {
			...noBody,
			args: [
				{
					name: "token",
					wire: "token",
					in: "path",
					type: "string",
					required: true,
					positional: true,
				},
			],
		};

		expect(parseCommandLine(confirm, ["abc"]).values).toEqual({
			token: "abc",
		});
		expect(() => parseCommandLine(confirm, [])).toThrow(
			new UsageError("Missing required argument <token>."),
		);
		expect(() => parseCommandLine(confirm, ["--token", "abc"])).toThrow(
			"The --token flag was removed",
		);
	});

	it("should read JSON and body strings from @file", () => {
		const jsonPath = join(dir, "meta.json");
		const textPath = join(dir, "title.txt");

		writeFileSync(jsonPath, '{"from":"file"}');
		writeFileSync(textPath, "A title");

		const { values } = parseCommandLine(command, [
			"abc",
			"--meta",
			`@${jsonPath}`,
			"--title",
			`@${textPath}`,
		]);

		expect(values.meta).toEqual({ from: "file" });
		expect(values.title).toBe("A title");
	});

	it("should not read @file for query and path arguments", () => {
		const { values } = parseCommandLine(command, [
			"@abc",
			"--filter",
			"all",
			"--title",
			"t",
		]);

		expect(values["thing-id"]).toBe("@abc");
	});

	it("should throw when an @file cannot be read", () => {
		expect(() =>
			parseCommandLine(command, [
				"abc",
				"--title",
				`@${join(dir, "missing.txt")}`,
			]),
		).toThrow(/^Could not read /u);
	});
});

describe("parseGlobals()", () => {
	it("should read the global flags and the words", () => {
		const { globals, words } = parseGlobals([
			"saves",
			"list",
			"--api-url",
			"https://api.test",
			"-h",
		]);

		expect(words).toEqual(["saves", "list"]);
		expect(globals.apiUrl).toBe("https://api.test");
		expect(globals.help).toBe(true);
	});
});

describe("globalFlagLength()", () => {
	it("should take up one argument for a boolean flag", () => {
		expect(globalFlagLength(["--pretty", "x"], 0)).toBe(1);
		expect(globalFlagLength(["-f", "x"], 0)).toBe(1);
	});

	it("should take up one argument for a negated boolean flag", () => {
		expect(globalFlagLength(["--no-pretty", "x"], 0)).toBe(1);
	});

	it("should take up two arguments for a flag and its value", () => {
		expect(
			globalFlagLength(["--api-url", "https://api.test", "x"], 0),
		).toBe(2);
		expect(globalFlagLength(["x", "-o", "out.json"], 1)).toBe(2);
	});

	it("should take up one argument for a flag with an inline value", () => {
		expect(globalFlagLength(["--api-url=https://api.test", "x"], 0)).toBe(
			1,
		);
	});

	it("should take up one argument for a flag missing its value", () => {
		expect(globalFlagLength(["--api-url"], 0)).toBe(1);
	});

	it("should take up nothing for a flag that is not global", () => {
		expect(globalFlagLength(["--filter", "inbox"], 0)).toBe(0);
		expect(globalFlagLength(["--no-api-url"], 0)).toBe(0);
		expect(globalFlagLength(["--constructor"], 0)).toBe(0);
		expect(globalFlagLength(["-x"], 0)).toBe(0);
	});

	it("should take up nothing for a word or past the end", () => {
		expect(globalFlagLength(["saves"], 0)).toBe(0);
		expect(globalFlagLength([], 0)).toBe(0);
	});
});

describe("readAtFile()", () => {
	it("should return a value that does not start with @ unchanged", () => {
		expect(readAtFile("plain")).toBe("plain");
	});

	it("should read the file a value starting with @ names", () => {
		const path = join(dir, "value.txt");

		writeFileSync(path, "contents");

		expect(readAtFile(`@${path}`)).toBe("contents");
	});
});
