/**
 * @fileoverview Tests for the generation pipeline: annotating the OpenAPI
 * document, and the generated files being up to date.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotate, commandName, deriveName } from "../generator/annotate.ts";
import { CONFIRMATIONS } from "../generator/mapping.ts";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVED_SPEC = join(ROOT, "generator", "openapi.json");

const NO_MAPPING = { operations: {}, confirmations: {} };

/**
 * A small document whose operations the Forge extensions name.
 */
const WIDGETS = {
	"x-forge-commands": {
		widgets: {
			description: "Manage widgets.",
			groups: { parts: { description: "Manage parts." } },
		},
	},
	paths: {
		"/widgets": {
			post: {
				operationId: "post_WidgetsAdd",
				"x-fern-sdk-group-name": ["widgets", "parts"],
				"x-fern-sdk-method-name": "add",
			},
		},
		"/widgets/{id}": {
			delete: {
				operationId: "delete_Widget",
				"x-fern-sdk-group-name": "widgets",
				"x-fern-sdk-method-name": "delete",
				"x-forge-require-confirmation": "Gone for good.",
			},
		},
	},
};

/**
 * Reads the saved OpenAPI document.
 * @returns The document.
 */
function savedSpec(): unknown {
	return JSON.parse(readFileSync(SAVED_SPEC, "utf8"));
}

/**
 * Reads every file in a directory into a map by name.
 * @param dir The directory.
 * @returns The files.
 */
function filesOf(dir: string): Record<string, string> {
	const files: Record<string, string> = {};

	for (const name of readdirSync(dir).sort()) {
		files[name] = readFileSync(join(dir, name), "utf8").replaceAll(
			"\r\n",
			"\n",
		);
	}

	return files;
}

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("annotate()", () => {
	it("should throw for something that is not a document", () => {
		expect(() => annotate(null)).toThrow(
			new TypeError("Expected an OpenAPI document object."),
		);
		expect(() => annotate({})).toThrow(
			new TypeError("Expected the OpenAPI document to have paths."),
		);
	});

	it("should map every operation of the saved document without warnings", () => {
		const source = savedSpec() as {
			paths: Record<string, Record<string, object>>;
		};
		const { warnings, commands } = annotate(source);
		const operations = Object.values(source.paths).flatMap(item =>
			Object.values(item),
		);

		expect(warnings).toEqual([]);
		expect(commands).toHaveLength(operations.length);
		expect(commands).toContain("saves.list");
		expect(commands).toContain("me.emails.inbound.update");
	});

	it("should not change the document it is given", () => {
		const source = savedSpec() as {
			paths: Record<string, Record<string, object>>;
		};
		const before = JSON.stringify(source);

		annotate(source);

		expect(JSON.stringify(source)).toBe(before);
	});

	it("should name commands for the command line", () => {
		const { document } = annotate(savedSpec());
		const paths = document.paths!;
		const list = paths["/saves"]!.get!;
		const add = paths["/saves"]!.post!;
		const content = paths["/saves/{saveId}/content"]!.get!;
		const usage = paths["/tags/{tagName}/usage"]!.get!;
		const highlights = paths["/saves/{saveId}/highlights"]!.get!;
		const progress = paths["/saves/{saveId}/progress"]!.put!;

		expect(list["x-fern-sdk-group-name"]).toBe("saves");
		expect(list["x-fern-sdk-method-name"]).toBe("list");
		expect(add["x-fern-sdk-method-name"]).toBe("add");
		expect(content["x-fern-sdk-method-name"]).toBe("content");
		expect(usage["x-fern-sdk-group-name"]).toBe("tags");
		expect(usage["x-fern-sdk-method-name"]).toBe("usage");
		expect(highlights["x-fern-sdk-group-name"]).toBe("saves.highlights");
		expect(highlights["x-fern-sdk-method-name"]).toBe("list");
		expect(progress["x-fern-sdk-group-name"]).toBe("saves.progress");
		expect(progress["x-fern-sdk-method-name"]).toBe("set");
	});

	it("should keep the document's confirmations unless mapping.ts has one", () => {
		const { document } = annotate(savedSpec());
		const paths = document.paths!;

		expect(paths["/saves"]!.get!["x-forge-require-confirmation"]).toBe(
			undefined,
		);
		expect(
			paths["/saves/{saveId}"]!.delete!["x-forge-require-confirmation"],
		).toBe(CONFIRMATIONS.delete_SavesDelete);
		expect(
			paths["/me/privacy/confirm"]!.post!["x-forge-require-confirmation"],
		).toBe(
			"This confirms a pending deletion request. The data it covers is permanently deleted.",
		);
	});

	it("should describe groups as the document does, as phrases", () => {
		const { document } = annotate(savedSpec());
		const commands = document["x-forge-commands"] as Record<
			string,
			{ description: string }
		>;

		expect(commands.saves).toEqual({ description: "Manage your saves" });
		expect(commands["me.emails.inbound"]).toEqual({
			description: "Manage your inbound email address",
		});
	});

	it("should read array group names and nested group descriptions from the document", () => {
		const { document, warnings, commands } = annotate(
			{
				"x-forge-commands": {
					widgets: {
						description: "Manage widgets.",
						groups: { parts: { description: "Manage parts." } },
					},
				},
				paths: {
					"/widgets/{id}/parts": {
						get: {
							operationId: "get_WidgetParts",
							"x-fern-sdk-group-name": ["widgets", "parts"],
							"x-fern-sdk-method-name": "list",
						},
					},
					"/widgets/{id}/stats": {
						get: {
							operationId: "get_WidgetStats",
							"x-fern-sdk-group-name": "widgets",
							"x-fern-sdk-method-name": "getStats",
						},
					},
					"/widgets/{id}": {
						delete: {
							operationId: "delete_Widget",
							"x-fern-sdk-group-name": "widgets",
							"x-fern-sdk-method-name": "delete",
							"x-forge-require-confirmation": "Gone for good.",
						},
					},
				},
			},
			NO_MAPPING,
		);
		const parts = document.paths!["/widgets/{id}/parts"]!.get!;

		expect(warnings).toEqual([]);
		expect(parts["x-fern-sdk-group-name"]).toBe("widgets.parts");
		expect(
			document.paths!["/widgets/{id}"]!.delete![
				"x-forge-require-confirmation"
			],
		).toBe("Gone for good.");
		expect(commands).toEqual([
			"widgets.delete",
			"widgets.parts.list",
			"widgets.stats",
		]);
		expect(document["x-forge-commands"]).toEqual({
			widgets: { description: "Manage widgets" },
			"widgets.parts": { description: "Manage parts" },
		});
	});

	it("should rename commands and replace confirmations from the mapping", () => {
		const { document, warnings, commands } = annotate(WIDGETS, {
			operations: { post_WidgetsAdd: "widgets.create" },
			confirmations: { delete_Widget: "This removes it with --hard." },
		});

		expect(warnings).toEqual([]);
		expect(commands).toEqual(["widgets.create", "widgets.delete"]);
		expect(
			document.paths!["/widgets/{id}"]!.delete![
				"x-forge-require-confirmation"
			],
		).toBe("This removes it with --hard.");
	});

	it("should give a group the mapping moves the description it had in the document", () => {
		const { document } = annotate(WIDGETS, {
			operations: { post_WidgetsAdd: "parts.add" },
			confirmations: {},
		});

		expect(document["x-forge-commands"]).toEqual({
			parts: { description: "Manage parts" },
			widgets: { description: "Manage widgets" },
		});
	});

	it("should warn about mapping entries that are stale or that the document agrees with", () => {
		const { warnings } = annotate(WIDGETS, {
			operations: {
				post_WidgetsAdd: "widgets.parts.add",
				post_Gone: "widgets.gone",
			},
			confirmations: { delete_Gone: "Gone." },
		});

		expect(warnings).toEqual([
			'post_WidgetsAdd is "widgets.parts.add" in both generator/mapping.ts and the OpenAPI document; remove it from generator/mapping.ts.',
			"post_Gone is in OPERATIONS in generator/mapping.ts but not in the OpenAPI document.",
			"delete_Gone is in CONFIRMATIONS in generator/mapping.ts but not in the OpenAPI document.",
		]);
	});

	it("should throw when two operations would be the same command", () => {
		expect(() =>
			annotate({
				paths: {
					"/tags/{name}": {
						get: {
							operationId: "get_TagSaves",
							"x-fern-sdk-group-name": "tags",
							"x-fern-sdk-method-name": "listSaves",
						},
					},
					"/tags/{name}/saves": {
						get: {
							operationId: "get_TagSavesAgain",
							"x-fern-sdk-group-name": "tags",
							"x-fern-sdk-method-name": "getSaves",
						},
					},
				},
			}),
		).toThrow(
			new Error(
				'get_TagSaves and get_TagSavesAgain are both "tags.saves"; give one of them another name in generator/mapping.ts.',
			),
		);
	});

	it("should throw when a command has the name of a group", () => {
		expect(() =>
			annotate({
				paths: {
					"/saves/{id}/tags": {
						get: {
							operationId: "get_SaveTags",
							"x-fern-sdk-group-name": "saves",
							"x-fern-sdk-method-name": "getTags",
						},
						put: {
							operationId: "put_SaveTags",
							"x-fern-sdk-group-name": ["saves", "tags"],
							"x-fern-sdk-method-name": "set",
						},
					},
				},
			}),
		).toThrow(
			new Error(
				'get_SaveTags is "saves.tags", which is also a group; give it another name in generator/mapping.ts.',
			),
		);
	});

	it("should derive a name for an operation the document does not name, and warn", () => {
		const { document, warnings, commands } = annotate(
			{
				paths: {
					"/widgets/{id}/spin": {
						post: {
							operationId: "post_WidgetsSpin",
							summary: "Spin a widget",
							tags: ["Widgets"],
						},
						delete: {
							operationId: "delete_WidgetsSpinStop",
							summary: "Stop spinning",
							tags: ["Widgets"],
						},
					},
					"/nothing": {
						get: {},
					},
				},
			},
			NO_MAPPING,
		);
		const operation = document.paths!["/widgets/{id}/spin"]!.post!;
		const remove = document.paths!["/widgets/{id}/spin"]!.delete!;

		expect(operation["x-fern-sdk-group-name"]).toBe("widgets");
		expect(operation["x-fern-sdk-method-name"]).toBe("spin");
		expect(remove["x-forge-require-confirmation"]).toBe(
			"This will stop spinning.",
		);
		expect(commands).toEqual(["widgets.spin", "widgets.spinStop"]);
		expect(warnings).toEqual([
			'post_WidgetsSpin (POST /widgets/{id}/spin) has no x-fern-sdk-group-name and x-fern-sdk-method-name, and is not in generator/mapping.ts; using "widgets.spin".',
			'delete_WidgetsSpinStop (DELETE /widgets/{id}/spin) has no x-fern-sdk-group-name and x-fern-sdk-method-name, and is not in generator/mapping.ts; using "widgets.spinStop".',
			"GET /nothing has no operationId and was skipped.",
		]);
	});
});

describe("commandName()", () => {
	it("should name a method that gets or lists a thing for the thing", () => {
		expect(commandName("getContent")).toBe("content");
		expect(commandName("getUsage")).toBe("usage");
		expect(commandName("listSaves")).toBe("saves");
		expect(commandName("listScopes")).toBe("scopes");
	});

	it("should keep other methods as they are", () => {
		expect(commandName("get")).toBe("get");
		expect(commandName("list")).toBe("list");
		expect(commandName("getByUrl")).toBe("getByUrl");
		expect(commandName("regenerate")).toBe("regenerate");
		expect(commandName("listing")).toBe("listing");
	});
});

describe("deriveName()", () => {
	it("should drop the HTTP method and the tag from the operationId", () => {
		expect(deriveName("get_SavesList", "get", ["Saves"])).toBe(
			"saves.list",
		);
		expect(deriveName("get_SaveTagsList", "get", ["Saves"])).toBe(
			"saves.tagsList",
		);
		expect(
			deriveName("get_ReadingProgressGet", "get", ["Reading Progress"]),
		).toBe("readingProgress.get");
	});

	it("should fall back to the HTTP method and an 'other' group", () => {
		expect(deriveName("get_Saves", "get", ["Saves"])).toBe("saves.get");
		expect(deriveName("thing", "post", undefined)).toBe("other.thing");
	});
});

describe("src/generated", () => {
	it(
		"should match what the saved OpenAPI document generates",
		{ timeout: 120_000 },
		() => {
			const out = mkdtempSync(join(tmpdir(), "bredbox-generated-"));

			try {
				execFileSync(
					process.execPath,
					[
						join(ROOT, "scripts", "generate.ts"),
						"--offline",
						"--out",
						out,
					],
					{ cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
				);

				expect(filesOf(out)).toEqual(
					filesOf(join(ROOT, "src", "generated")),
				);
			} finally {
				rmSync(out, { recursive: true, force: true });
			}
		},
	);
});
