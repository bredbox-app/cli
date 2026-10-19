/**
 * @fileoverview Tests for the HTTP client.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BredboxClient, substitutePath } from "./client.js";
import { ApiError } from "./errors.js";
import type { Command } from "./types.js";

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
		{
			name: "type",
			wire: "type",
			in: "query",
			type: "string",
			array: true,
			required: false,
		},
		{
			name: "page",
			wire: "page",
			in: "query",
			type: "number",
			required: false,
		},
	],
	body: "none",
	response: "json",
};

const create: Command = {
	name: "create",
	summary: "Create a thing",
	method: "POST",
	path: "/things",
	args: [
		{
			name: "title",
			wire: "title",
			in: "body",
			type: "string",
			required: false,
		},
		{
			name: "starred",
			wire: "starred",
			in: "body",
			type: "boolean",
			required: false,
		},
	],
	body: "object",
	response: "json",
};

const setItems: Command = {
	name: "set",
	summary: "Set items",
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

const upload: Command = {
	name: "upload",
	summary: "Upload",
	method: "POST",
	path: "/uploads",
	args: [
		{
			name: "file",
			wire: "file",
			in: "form",
			type: "string",
			required: true,
			file: true,
		},
		{
			name: "note",
			wire: "note",
			in: "form",
			type: "string",
			required: false,
		},
	],
	body: "multipart",
	response: "json",
};

/**
 * Creates a fetch function that answers every request with `response` and
 * records the requests it got.
 * @param respond Builds the response for a request.
 * @returns The fetch function and the requests.
 */
function fakeFetch(respond: (url: string, init: RequestInit) => Response): {
	fetch: typeof fetch;
	calls: { url: string; init: RequestInit }[];
} {
	const calls: { url: string; init: RequestInit }[] = [];

	return {
		calls,
		fetch: (async (input: string | URL | Request, init?: RequestInit) => {
			const url = String(input);
			calls.push({ url, init: init ?? {} });
			return respond(url, init ?? {});
		}) as typeof fetch,
	};
}

let dir: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "bredbox-client-"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("BredboxClient", () => {
	describe("constructor", () => {
		it("should throw when there is no base URL", () => {
			expect(
				() => new BredboxClient({ baseUrl: "" } as { baseUrl: string }),
			).toThrow(new TypeError("Expected a base URL."));
		});

		it("should expose the base URL", () => {
			const client = new BredboxClient({ baseUrl: "https://x.test/v2" });

			expect(client.baseUrl).toBe("https://x.test/v2");
		});
	});

	describe("prepare()", () => {
		const client = new BredboxClient({
			baseUrl: "https://api.test/v2/",
			token: "secret",
			userAgent: "test/1.0",
		});

		it("should build the URL with encoded path and repeated query parameters", () => {
			const request = client.prepare(get, {
				"thing-id": "a/b c",
				type: ["x", "y"],
				page: 2,
			});

			expect(request.method).toBe("GET");
			expect(request.url).toBe(
				"https://api.test/v2/things/a%2Fb%20c?type=x&type=y&page=2",
			);
			expect(request.headers).toEqual({
				Accept: "application/json",
				"User-Agent": "test/1.0",
				Authorization: "Bearer secret",
			});
			expect(request.body).toBeUndefined();
		});

		it("should leave the Authorization header out without a token", () => {
			const anonymous = new BredboxClient({
				baseUrl: "https://api.test",
			});
			const request = anonymous.prepare(get, { "thing-id": "1" });

			expect(request.headers.Authorization).toBeUndefined();
			expect(request.url).toBe("https://api.test/things/1");
		});

		it("should send body fields as JSON, over the fields of --body", () => {
			const request = client.prepare(
				create,
				{ title: "Flag", starred: false },
				{ title: "Body", extra: 1 },
			);

			expect(request.headers["Content-Type"]).toBe("application/json");
			expect(JSON.parse(request.body as string)).toEqual({
				title: "Flag",
				extra: 1,
				starred: false,
			});
		});

		it("should send an empty object when an object body has no fields", () => {
			const request = client.prepare(create, {});

			expect(request.body).toBe("{}");
		});

		it("should throw when --body is not an object for an object body", () => {
			expect(() => client.prepare(create, {}, [1])).toThrow(
				new TypeError("Expected --body to be a JSON object."),
			);
		});

		it("should send positionals as a JSON array body", () => {
			const request = client.prepare(setItems, { item: ["a", "b"] });

			expect(request.body).toBe('["a","b"]');
		});

		it("should send --body as the array body when there are no positionals", () => {
			const request = client.prepare(setItems, {}, ["c"]);

			expect(request.body).toBe('["c"]');
		});

		it("should send an empty array when nothing is given for an array body", () => {
			const request = client.prepare(setItems, {});

			expect(request.body).toBe("[]");
		});

		it("should throw when --body is not an array for an array body", () => {
			expect(() => client.prepare(setItems, {}, { a: 1 })).toThrow(
				new TypeError("Expected --body to be a JSON array."),
			);
		});

		it("should send a multipart body with the file contents", async () => {
			const path = join(dir, "upload.txt");
			writeFileSync(path, "hello");

			const request = client.prepare(upload, { file: path, note: "n" });
			const form = request.body as FormData;

			expect(form).toBeInstanceOf(FormData);
			expect(request.headers["Content-Type"]).toBeUndefined();
			expect(form.get("note")).toBe("n");

			const file = form.get("file") as File;

			expect(file.name).toBe("upload.txt");
			expect(await file.text()).toBe("hello");
		});
	});

	describe("send()", () => {
		it("should parse a JSON response", async () => {
			const { fetch, calls } = fakeFetch(
				() =>
					new Response('{"ok":true}', {
						status: 200,
						headers: {
							"Content-Type": "application/json; charset=utf-8",
						},
					}),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});
			const response = await client.send(get, { "thing-id": "1" });

			expect(calls).toHaveLength(1);
			expect(calls[0].init.method).toBe("GET");
			expect(response).toEqual({
				status: 200,
				contentType: "application/json; charset=utf-8",
				kind: "json",
				data: { ok: true },
			});
		});

		it("should read a 204 as no body", async () => {
			const { fetch } = fakeFetch(
				() => new Response(null, { status: 204 }),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});
			const response = await client.send(get, { "thing-id": "1" });

			expect(response.kind).toBe("none");
			expect(response.data).toBeUndefined();
		});

		it("should read text responses as text", async () => {
			const { fetch } = fakeFetch(
				() =>
					new Response("plain", {
						status: 200,
						headers: { "Content-Type": "text/plain" },
					}),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});
			const response = await client.send(get, { "thing-id": "1" });

			expect(response.kind).toBe("text");
			expect(response.data).toBe("plain");
		});

		it("should read other responses as bytes", async () => {
			const { fetch } = fakeFetch(
				() =>
					new Response(new Uint8Array([1, 2, 3]), {
						status: 200,
						headers: { "Content-Type": "application/zip" },
					}),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});
			const response = await client.send(get, { "thing-id": "1" });

			expect(response.kind).toBe("binary");
			expect(response.data).toEqual(new Uint8Array([1, 2, 3]));
		});

		it("should fall back to text when JSON cannot be parsed", async () => {
			const { fetch } = fakeFetch(
				() =>
					new Response("not json", {
						status: 200,
						headers: { "Content-Type": "application/json" },
					}),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});
			const response = await client.send(get, { "thing-id": "1" });

			expect(response.kind).toBe("text");
			expect(response.data).toBe("not json");
		});

		it("should throw an ApiError with the parsed body on an error status", async () => {
			const { fetch } = fakeFetch(
				() =>
					new Response('{"error":"Not found","code":"not_found"}', {
						status: 404,
						headers: { "Content-Type": "application/json" },
					}),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});

			await expect(client.send(get, { "thing-id": "1" })).rejects.toThrow(
				new ApiError(404, { error: "Not found", code: "not_found" }),
			);
			await expect(client.send(get, { "thing-id": "1" })).rejects.toThrow(
				"Not found [not_found] (HTTP 404)",
			);
		});

		it("should describe an error without a JSON body by its status", async () => {
			const { fetch } = fakeFetch(
				() => new Response(null, { status: 500 }),
			);
			const client = new BredboxClient({
				baseUrl: "https://api.test",
				fetch,
			});

			await expect(client.send(get, { "thing-id": "1" })).rejects.toThrow(
				"Request failed (HTTP 500)",
			);
		});
	});
});

describe("substitutePath()", () => {
	it("should substitute and encode every path parameter", () => {
		expect(substitutePath(get, { "thing-id": "x y" })).toBe("things/x%20y");
	});

	it("should throw when a path parameter has no value", () => {
		expect(() => substitutePath(get, {})).toThrow(
			new TypeError("Expected a value for path parameter thingId."),
		);
	});
});
