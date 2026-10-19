/**
 * @fileoverview Integration tests: the CLI running the generated commands
 * against a fake API.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { api, groups, run } from "../src/index.js";
import type { Io } from "../src/output.js";
import type { Command, CommandGroup } from "../src/types.js";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

interface Call {
	url: string;
	method: string;
	headers: Record<string, string>;
	body: string | FormData | undefined;
}

interface Fake {
	io: Io;
	out: (string | Uint8Array)[];
	err: string[];
	text: () => string;
}

/**
 * Creates streams that remember what was written.
 * @param options The options.
 * @param options.tty Whether standard output is a terminal.
 * @param options.stdin Text to offer on standard input, which is then not a terminal.
 * @returns The streams and what was written.
 */
function fakeIo({
	tty = false,
	stdin,
}: { tty?: boolean; stdin?: string } = {}): Fake {
	const out: (string | Uint8Array)[] = [];
	const err: string[] = [];
	const input = Object.assign(
		Readable.from(stdin === undefined ? [] : [stdin]),
		{
			isTTY: stdin === undefined ? tty : false,
		},
	);

	return {
		out,
		err,
		text: () => out.map(String).join(""),
		io: {
			stdout: { write: chunk => out.push(chunk), isTTY: tty },
			stderr: { write: chunk => err.push(String(chunk)), isTTY: tty },
			stdin: input,
		},
	};
}

/**
 * Creates a fetch that records requests and answers them with `respond`.
 * @param respond Builds the response for a request.
 * @returns The fetch and the requests.
 */
function fakeFetch(respond: (call: Call) => Response): {
	fetch: typeof fetch;
	calls: Call[];
} {
	const calls: Call[] = [];

	return {
		calls,
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			const call: Call = {
				url: String(input),
				method: init?.method ?? "GET",
				headers: (init?.headers as Record<string, string>) ?? {},
				body: init?.body as string | FormData | undefined,
			};
			calls.push(call);
			return respond(call);
		}) as typeof fetch,
	};
}

/**
 * A JSON response.
 * @param status The status.
 * @param body The body.
 * @returns The response.
 */
function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}

/**
 * Finds a generated command by its words.
 * @param words The words.
 * @returns The command.
 */
function find(...words: string[]): Command {
	let list: readonly CommandGroup[] = groups;
	let group: CommandGroup | undefined;

	for (const word of words.slice(0, -1)) {
		group = list.find(candidate => candidate.name === word);

		if (!group) {
			throw new Error(`No group ${word}`);
		}

		list = group.groups;
	}

	const command = group?.commands.find(
		candidate => candidate.name === words.at(-1),
	);

	if (!command) {
		throw new Error(`No command ${words.join(" ")}`);
	}

	return command;
}

/**
 * Lists every generated command with its words.
 * @param list The groups to walk.
 * @param prefix The words so far.
 * @returns Each command and its words.
 */
function allCommands(
	list: readonly CommandGroup[],
	prefix: string[] = [],
): { words: string[]; command: Command }[] {
	return list.flatMap(group => [
		...group.commands.map(command => ({
			words: [...prefix, group.name, command.name],
			command,
		})),
		...allCommands(group.groups, [...prefix, group.name]),
	]);
}

let dir: string;
let configPath: string;
const env = {
	BREDBOX_TOKEN: "test-token",
	BREDBOX_API_URL: "https://api.test/v2",
};

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "bredbox-it-"));
	configPath = join(dir, "config.json");
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("generated commands", () => {
	it("should cover every operation in the OpenAPI document", () => {
		const document = JSON.parse(
			readFileSync(
				new URL("../generator/openapi.json", import.meta.url),
				"utf8",
			),
		) as { paths: Record<string, Record<string, { operationId: string }>> };
		const operations = Object.values(document.paths).flatMap(item =>
			Object.values(item).map(op => op.operationId),
		);
		const commands = allCommands(groups);

		expect(commands).toHaveLength(operations.length);
		expect(api.baseUrl).toBe("https://api.bredbox.app/v2");
	});

	it("should render help for every command", async () => {
		for (const { words } of allCommands(groups)) {
			const { io, text } = fakeIo();

			expect(
				await run([...words, "--help"], { io, env, configPath }),
			).toBe(0);
			expect(text()).toContain(`Usage: bredbox ${words.join(" ")}`);
		}
	});

	it("should ask confirmation for every DELETE and nothing else", () => {
		for (const { words, command } of allCommands(groups)) {
			expect(
				command.confirmation !== undefined,
				`${words.join(" ")} (${command.method})`,
			).toBe(command.method === "DELETE");
		}
	});

	it("should put path parameters first as positionals, in path order", () => {
		const update = find("highlights", "update");

		expect(update.args.slice(0, 2)).toMatchObject([
			{ name: "save-id", in: "path", positional: true },
			{ name: "highlight-id", in: "path", positional: true },
		]);
		expect(update.path).toBe("/saves/{saveId}/highlights/{highlightId}");
	});

	it("should turn a body field that clashes with a global flag into a positional", () => {
		const confirm = find("me", "privacy", "confirm");

		expect(confirm.args).toEqual([
			{
				name: "token",
				wire: "token",
				in: "body",
				type: "string",
				required: true,
				positional: true,
			},
		]);
	});
});

describe("bredbox saves list", () => {
	it("should send query parameters and print the JSON response", async () => {
		const { io, out } = fakeIo();
		const { fetch, calls } = fakeFetch(() => json(200, { items: [] }));

		const code = await run(
			[
				"saves",
				"list",
				"--filter",
				"inbox",
				"--type",
				"article",
				"--type",
				"video",
			],
			{ io, env, configPath, fetch },
		);

		expect(code).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].method).toBe("GET");
		expect(calls[0].url).toBe(
			"https://api.test/v2/saves?filter=inbox&type=article&type=video",
		);
		expect(calls[0].headers.Authorization).toBe("Bearer test-token");
		expect(calls[0].headers.Accept).toBe("application/json");
		expect(out).toEqual(['{"items":[]}\n']);
	});
});

describe("bredbox saves create", () => {
	it("should send body flags as JSON", async () => {
		const { io } = fakeIo();
		const { fetch, calls } = fakeFetch(() => json(201, { id: "new" }));

		await run(
			[
				"saves",
				"create",
				"--url",
				"https://example.com/a",
				"--tags",
				"one",
				"--tags",
				"two",
				"--is-favorite",
			],
			{ io, env, configPath, fetch },
		);

		expect(calls[0].method).toBe("POST");
		expect(calls[0].headers["Content-Type"]).toBe("application/json");
		expect(JSON.parse(calls[0].body as string)).toEqual({
			url: "https://example.com/a",
			tags: ["one", "two"],
			is_favorite: true,
		});
	});
});

describe("bredbox saves tags add", () => {
	it("should send trailing positionals as a JSON array body", async () => {
		const { io } = fakeIo();
		const { fetch, calls } = fakeFetch(() =>
			json(200, { tags: ["a", "b"] }),
		);

		await run(["saves", "tags", "add", "save-1", "a", "b"], {
			io,
			env,
			configPath,
			fetch,
		});

		expect(calls[0].url).toBe("https://api.test/v2/saves/save-1/tags");
		expect(calls[0].body).toBe('["a","b"]');
	});
});

describe("bredbox saves content", () => {
	it("should print a text response as-is", async () => {
		const { io, text } = fakeIo();
		const { fetch, calls } = fakeFetch(
			() =>
				new Response("The article text", {
					status: 200,
					headers: { "Content-Type": "text/plain; charset=utf-8" },
				}),
		);

		await run(["saves", "content", "save-1", "--format", "text"], {
			io,
			env,
			configPath,
			fetch,
		});

		expect(calls[0].url).toBe(
			"https://api.test/v2/saves/save-1/content?format=text",
		);
		expect(text()).toBe("The article text\n");
	});
});

describe("bredbox exports download", () => {
	it("should write a binary response to --output", async () => {
		const { io, out } = fakeIo({ tty: true });
		const path = join(dir, "export.zip");
		const { fetch } = fakeFetch(
			() =>
				new Response(new Uint8Array([80, 75, 3, 4]), {
					status: 200,
					headers: { "Content-Type": "application/zip" },
				}),
		);

		const code = await run(
			["exports", "download", "exp-1", "--output", path],
			{
				io,
				env,
				configPath,
				fetch,
			},
		);

		expect(code).toBe(0);
		expect(out).toEqual([]);
		expect([...readFileSync(path)]).toEqual([80, 75, 3, 4]);
	});

	it("should refuse to print a binary response to a terminal", async () => {
		const { io, err } = fakeIo({ tty: true });
		const { fetch } = fakeFetch(
			() =>
				new Response(new Uint8Array([1]), {
					status: 200,
					headers: { "Content-Type": "application/zip" },
				}),
		);

		const code = await run(["exports", "download", "exp-1"], {
			io,
			env,
			configPath,
			fetch,
		});

		expect(code).toBe(2);
		expect(err[0]).toContain("pass --output <file>");
	});
});

describe("bredbox imports create", () => {
	it("should upload the file as multipart form data", async () => {
		const { io } = fakeIo();
		const path = join(dir, "bookmarks.html");
		writeFileSync(path, "<html></html>");
		const { fetch, calls } = fakeFetch(() => json(202, { ok: true }));

		await run(["imports", "create", "--file", path], {
			io,
			env,
			configPath,
			fetch,
		});

		const form = calls[0].body as FormData;

		expect(form).toBeInstanceOf(FormData);
		expect(calls[0].headers["Content-Type"]).toBeUndefined();

		const file = form.get("file") as File;

		expect(file.name).toBe("bookmarks.html");
		expect(await file.text()).toBe("<html></html>");
	});
});

describe("bredbox saves delete", () => {
	it("should not send without confirmation or --force", async () => {
		const { io, err } = fakeIo();
		const { fetch, calls } = fakeFetch(
			() => new Response(null, { status: 204 }),
		);

		const code = await run(["saves", "delete", "save-1"], {
			io,
			env,
			configPath,
			fetch,
		});

		expect(code).toBe(1);
		expect(calls).toEqual([]);
		expect(err[0]).toContain("Pass --force");
	});

	it("should send with --force and print nothing for a 204", async () => {
		const { io, out } = fakeIo();
		const { fetch, calls } = fakeFetch(
			() => new Response(null, { status: 204 }),
		);

		const code = await run(
			["saves", "delete", "save-1", "--permanent", "-f"],
			{
				io,
				env,
				configPath,
				fetch,
			},
		);

		expect(code).toBe(0);
		expect(calls[0].method).toBe("DELETE");
		expect(calls[0].url).toBe(
			"https://api.test/v2/saves/save-1?permanent=true",
		);
		expect(out).toEqual([]);
	});
});

describe("errors", () => {
	it("should report a 401 from the API", async () => {
		const { io, err } = fakeIo();
		const { fetch } = fakeFetch(() => json(401, { error: "Unauthorized" }));

		const code = await run(["me", "get"], { io, env, configPath, fetch });

		expect(code).toBe(1);
		expect(err[0]).toBe("bredbox: Unauthorized (HTTP 401)\n");
	});
});

describe("bredbox auth", () => {
	it("should verify and save a token with login, then show and clear it", async () => {
		const ownConfig = join(dir, "auth", "config.json");
		const { fetch, calls } = fakeFetch(() => json(200, { id: "user-1" }));
		const quiet = { BREDBOX_API_URL: "https://api.test/v2" };

		const login = fakeIo();
		const code = await run(["auth", "login", "--token", "saved-token"], {
			io: login.io,
			env: quiet,
			configPath: ownConfig,
			fetch,
		});

		expect(code).toBe(0);
		expect(calls[0].url).toBe("https://api.test/v2/me");
		expect(calls[0].headers.Authorization).toBe("Bearer saved-token");
		expect(JSON.parse(login.text())).toMatchObject({
			authenticated: true,
			tokenSource: "config",
			user: { id: "user-1" },
		});
		expect(JSON.parse(readFileSync(ownConfig, "utf8"))).toEqual({
			token: "saved-token",
		});

		const status = fakeIo();
		await run(["auth", "status"], {
			io: status.io,
			env: quiet,
			configPath: ownConfig,
			fetch,
		});
		expect(JSON.parse(status.text())).toEqual({
			configPath: ownConfig,
			authenticated: true,
			tokenSource: "config",
			apiUrl: "https://api.test/v2",
			apiUrlSource: "environment",
		});

		const me = fakeIo();
		await run(["me", "get"], {
			io: me.io,
			env: quiet,
			configPath: ownConfig,
			fetch,
		});
		expect(calls.at(-1)?.headers.Authorization).toBe("Bearer saved-token");

		const logout = fakeIo();
		await run(["auth", "logout"], {
			io: logout.io,
			env: quiet,
			configPath: ownConfig,
			fetch,
		});
		expect(JSON.parse(logout.text())).toMatchObject({
			authenticated: false,
			tokenSource: null,
		});
	});

	it("should read the token from standard input", async () => {
		const ownConfig = join(dir, "stdin", "config.json");
		const { fetch } = fakeFetch(() => json(200, {}));
		const { io } = fakeIo({ stdin: "piped-token\n" });

		const code = await run(["auth", "login", "--no-verify"], {
			io,
			env: {},
			configPath: ownConfig,
			fetch,
		});

		expect(code).toBe(0);
		expect(JSON.parse(readFileSync(ownConfig, "utf8"))).toEqual({
			token: "piped-token",
		});
	});

	it("should not save a token the API rejects", async () => {
		const ownConfig = join(dir, "rejected", "config.json");
		const { fetch } = fakeFetch(() => json(401, { error: "Unauthorized" }));
		const { io, err } = fakeIo();

		const code = await run(["auth", "login", "--token", "bad"], {
			io,
			env: {},
			configPath: ownConfig,
			fetch,
		});

		expect(code).toBe(1);
		expect(err[0]).toBe("bredbox: Unauthorized (HTTP 401)\n");
		expect(() => readFileSync(ownConfig)).toThrow();
	});

	it("should fail without a token or standard input", async () => {
		const { io, err } = fakeIo({ tty: true });

		const code = await run(["auth", "login"], { io, env: {}, configPath });

		expect(code).toBe(2);
		expect(err[0]).toBe(
			"bredbox: Expected --token <token>, or a token on standard input.\n",
		);
	});
});
