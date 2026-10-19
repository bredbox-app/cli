/**
 * @fileoverview Tests for command resolution and the run loop.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveCommand, run, version } from "./cli.js";
import { UsageError } from "./errors.js";
import type { Io } from "./output.js";
import type { Command, CommandGroup } from "./types.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

const get: Command = {
	name: "get",
	summary: "Get a thing",
	method: "GET",
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
	],
	body: "none",
	response: "json",
};

const remove: Command = {
	name: "delete",
	summary: "Delete a thing",
	method: "DELETE",
	path: "/things/{thingId}",
	args: get.args,
	body: "none",
	response: "none",
	confirmation: "This deletes the thing.",
};

const groups: CommandGroup[] = [
	{
		name: "things",
		description: "Things",
		commands: [get, remove],
		groups: [
			{
				name: "parts",
				description: "Parts",
				commands: [{ ...get, name: "list", path: "/parts" }],
				groups: [],
			},
		],
	},
];

interface Fake {
	io: Io;
	out: string[];
	err: string[];
}

/**
 * Creates streams that remember what was written.
 * @param tty Whether the streams are a terminal.
 * @returns The streams and what was written.
 */
function fakeIo(tty = false): Fake {
	const out: string[] = [];
	const err: string[] = [];

	return {
		out,
		err,
		io: {
			stdout: { write: chunk => out.push(String(chunk)), isTTY: tty },
			stderr: { write: chunk => err.push(String(chunk)), isTTY: tty },
			stdin: Object.assign(Readable.from([]), { isTTY: tty }),
		},
	};
}

/**
 * Creates a fetch that answers with JSON and records requests.
 * @param status The status to answer with.
 * @param body The JSON body to answer with.
 * @returns The fetch and the requests.
 */
function jsonFetch(
	status: number,
	body: unknown,
): { fetch: typeof fetch; calls: { url: string; init: RequestInit }[] } {
	const calls: { url: string; init: RequestInit }[] = [];

	return {
		calls,
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			calls.push({ url: String(input), init: init ?? {} });
			return new Response(
				body === undefined ? null : JSON.stringify(body),
				{
					status,
					headers:
						body === undefined
							? {}
							: { "Content-Type": "application/json" },
				},
			);
		}) as typeof fetch,
	};
}

let dir: string;
let configPath: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "bredbox-cli-"));
	configPath = join(dir, "config.json");
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

const env = {};

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("resolveCommand()", () => {
	it("should resolve nothing for an empty line", () => {
		expect(resolveCommand(groups, [])).toEqual({ kind: "root", rest: [] });
	});

	it("should stop at the first flag that is not global", () => {
		expect(resolveCommand(groups, ["--thing", "things"])).toEqual({
			kind: "root",
			rest: ["--thing", "things"],
		});
	});

	it("should move global flags before the words to the rest", () => {
		expect(resolveCommand(groups, ["--help", "things"])).toEqual({
			kind: "group",
			group: groups[0],
			path: ["things"],
			rest: ["--help"],
		});
	});

	it("should move global flags between the words to the rest", () => {
		const resolution = resolveCommand(groups, [
			"--api-url",
			"https://api.test",
			"things",
			"--api-url=https://api.test",
			"-f",
			"delete",
			"abc",
			"--pretty",
		]);

		expect(resolution).toMatchObject({
			kind: "command",
			path: ["things", "delete"],
			rest: [
				"--api-url",
				"https://api.test",
				"--api-url=https://api.test",
				"-f",
				"abc",
				"--pretty",
			],
		});
	});

	it("should keep global flags with no command in the rest", () => {
		expect(resolveCommand(groups, ["-o", "t", "--version"])).toEqual({
			kind: "root",
			rest: ["-o", "t", "--version"],
		});
	});

	it("should resolve a group", () => {
		const resolution = resolveCommand(groups, ["things", "--help"]);

		expect(resolution.kind).toBe("group");
		expect(resolution).toMatchObject({
			path: ["things"],
			rest: ["--help"],
		});
	});

	it("should resolve a command in a nested group", () => {
		const resolution = resolveCommand(groups, [
			"things",
			"parts",
			"list",
			"abc",
			"--pretty",
		]);

		expect(resolution).toMatchObject({
			kind: "command",
			path: ["things", "parts", "list"],
			rest: ["abc", "--pretty"],
		});
	});

	it("should throw for an unknown top-level word", () => {
		expect(() => resolveCommand(groups, ["nope"])).toThrow(
			new UsageError('Unknown command "nope".'),
		);
	});

	it("should throw for an unknown word in a group", () => {
		expect(() => resolveCommand(groups, ["things", "nope"])).toThrow(
			'Unknown command "nope" in "bredbox things".',
		);
	});
});

describe("run()", () => {
	it("should print the version", async () => {
		const { io, out } = fakeIo();

		expect(await run(["--version"], { io, groups, env })).toBe(0);
		expect(out).toEqual([`${version}\n`]);
	});

	it("should print the root help with no arguments", async () => {
		const { io, out } = fakeIo();

		expect(await run([], { io, groups, env })).toBe(0);
		expect(out.join("")).toContain("Usage: bredbox <command> [options]");
		expect(out.join("")).toContain("  things  Things");
	});

	it("should print the root help and fail when only flags are given", async () => {
		const { io, out, err } = fakeIo();

		expect(await run(["--pretty"], { io, groups, env })).toBe(2);
		expect(out).toEqual([]);
		expect(err.join("")).toContain("Usage: bredbox <command>");
		expect(err.join("")).toContain("bredbox: Expected a command.");
	});

	it("should print the help of a group", async () => {
		const { io, out } = fakeIo();

		expect(await run(["things"], { io, groups, env })).toBe(0);
		expect(out.join("")).toContain("Usage: bredbox things <command>");
	});

	it("should print the help of a command", async () => {
		const { io, out } = fakeIo();

		expect(
			await run(["things", "get", "--help"], { io, groups, env }),
		).toBe(0);
		expect(out.join("")).toContain("Usage: bredbox things get <thing-id>");
	});

	it("should fail with usage for an unknown command", async () => {
		const { io, err } = fakeIo();

		expect(await run(["things", "nope"], { io, groups, env })).toBe(2);
		expect(err).toEqual([
			'bredbox: Unknown command "nope" in "bredbox things".\n',
			"Run 'bredbox things --help' for usage.\n",
		]);
	});

	it("should fail with usage when a required argument is missing", async () => {
		const { io, err } = fakeIo();

		expect(
			await run(["things", "get"], {
				io,
				groups,
				env: { BREDBOX_TOKEN: "t" },
				configPath,
			}),
		).toBe(2);
		expect(err[0]).toBe("bredbox: Missing required argument <thing-id>.\n");
		expect(err[1]).toBe("Run 'bredbox things get --help' for usage.\n");
	});

	it("should fail without a token", async () => {
		const { io, err } = fakeIo();

		expect(
			await run(["things", "get", "1"], { io, groups, env, configPath }),
		).toBe(2);
		expect(err[0]).toMatch(/^bredbox: No access token\./u);
	});

	it("should print the request with --dry-run, masking the token", async () => {
		const { io, out } = fakeIo();
		const { fetch, calls } = jsonFetch(200, {});

		expect(
			await run(["things", "get", "1", "--dry-run", "--compact"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "secret",
					BREDBOX_API_URL: "https://api.test",
				},
				configPath,
				fetch,
			}),
		).toBe(0);
		expect(calls).toEqual([]);
		expect(JSON.parse(out[0])).toMatchObject({
			method: "GET",
			url: "https://api.test/things/1",
			headers: { Authorization: "Bearer ***" },
		});
	});

	it("should send the request and print the response", async () => {
		const { io, out } = fakeIo();
		const { fetch, calls } = jsonFetch(200, { id: "1" });

		expect(
			await run(["things", "get", "1"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "secret",
					BREDBOX_API_URL: "https://api.test/",
				},
				configPath,
				fetch,
			}),
		).toBe(0);
		expect(calls[0].url).toBe("https://api.test/things/1");
		expect(
			(calls[0].init.headers as Record<string, string>).Authorization,
		).toBe("Bearer secret");
		expect(out).toEqual(['{"id":"1"}\n']);
	});

	it("should read global flags given before the command", async () => {
		const { io } = fakeIo();
		const { fetch, calls } = jsonFetch(200, {});

		expect(
			await run(["--api-url", "https://api.test", "things", "get", "1"], {
				io,
				groups,
				env: { BREDBOX_TOKEN: "secret" },
				configPath,
				fetch,
			}),
		).toBe(0);
		expect(calls[0].url).toBe("https://api.test/things/1");
		expect(
			(calls[0].init.headers as Record<string, string>).Authorization,
		).toBe("Bearer secret");
	});

	it("should reject --token without sending the request", async () => {
		const { io, err } = fakeIo();
		const { fetch, calls } = jsonFetch(200, {});

		const code = await run(["things", "get", "1", "--token", "flag"], {
			io,
			groups,
			env: { BREDBOX_TOKEN: "env", BREDBOX_API_URL: "https://api.test" },
			configPath,
			fetch,
		});

		expect(code).toBe(2);
		expect(calls).toEqual([]);
		expect(err[0]).toBe(
			"bredbox: The --token flag was removed because it exposes the token. Run 'bredbox auth login' to save one, or set BREDBOX_TOKEN.\n",
		);
	});

	it("should report an API error and exit with 1", async () => {
		const { io, err } = fakeIo();
		const { fetch } = jsonFetch(403, { error: "Forbidden", code: "scope" });

		expect(
			await run(["things", "get", "1"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "t",
					BREDBOX_API_URL: "https://api.test",
				},
				configPath,
				fetch,
			}),
		).toBe(1);
		expect(err[0]).toBe("bredbox: Forbidden [scope] (HTTP 403)\n");
		expect(JSON.parse(err[1])).toEqual({
			error: "Forbidden",
			code: "scope",
		});
	});

	it("should refuse a confirmed command without a terminal", async () => {
		const { io, err } = fakeIo(false);
		const { fetch, calls } = jsonFetch(204, undefined);

		expect(
			await run(["things", "delete", "1"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "t",
					BREDBOX_API_URL: "https://api.test",
				},
				configPath,
				fetch,
			}),
		).toBe(1);
		expect(calls).toEqual([]);
		expect(err[0]).toBe(
			"bredbox: This deletes the thing. Pass --force to run without confirmation.\n",
		);
	});

	it("should run a confirmed command with --force", async () => {
		const { io, out } = fakeIo(false);
		const { fetch, calls } = jsonFetch(204, undefined);

		expect(
			await run(["things", "delete", "1", "--force"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "t",
					BREDBOX_API_URL: "https://api.test",
				},
				configPath,
				fetch,
			}),
		).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].init.method).toBe("DELETE");
		expect(out).toEqual([]);
	});

	it("should ask for confirmation and stop when it is declined", async () => {
		const { io, err } = fakeIo(true);
		const { fetch, calls } = jsonFetch(204, undefined);
		const asked: string[] = [];

		expect(
			await run(["things", "delete", "1"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "t",
					BREDBOX_API_URL: "https://api.test",
				},
				configPath,
				fetch,
				confirm: async message => {
					asked.push(message);
					return false;
				},
			}),
		).toBe(1);
		expect(asked).toEqual(["This deletes the thing."]);
		expect(calls).toEqual([]);
		expect(err).toEqual(["bredbox: Cancelled.\n"]);
	});

	it("should run when the confirmation is accepted", async () => {
		const { io } = fakeIo(true);
		const { fetch, calls } = jsonFetch(204, undefined);

		expect(
			await run(["things", "delete", "1"], {
				io,
				groups,
				env: {
					BREDBOX_TOKEN: "t",
					BREDBOX_API_URL: "https://api.test",
				},
				configPath,
				fetch,
				confirm: async () => true,
			}),
		).toBe(0);
		expect(calls).toHaveLength(1);
	});
});
