/**
 * @fileoverview Tests for the generation pipeline: annotating the OpenAPI
 * document, and the generated files being up to date.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { annotate, commandName, deriveName } from "../generator/annotate.ts";
import {
	COLUMNS,
	CONFIRMATIONS,
	FLAGS,
	POSITIONALS,
} from "../generator/mapping.ts";
import type { CommandGroup } from "../src/types.ts";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVED_SPEC = join(ROOT, "generator", "openapi.json");

const NO_MAPPING = {
	operations: {},
	confirmations: {},
	columns: {},
	flags: {},
	positionals: {},
};

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
 * Collects the group descriptions of a document's `x-forge-commands` by
 * dotted path, whether it nests subgroups under `groups` or gives them
 * dotted keys.
 * @param value The value of `x-forge-commands`, or of one of its `groups`.
 * @param prefix The dotted path of the group holding `value`.
 * @returns The descriptions, as the document writes them.
 */
function groupDescriptions(
	value: unknown,
	prefix = "",
): Record<string, string> {
	const descriptions: Record<string, string> = {};

	for (const [name, group] of Object.entries(
		value as Record<string, { description?: string; groups?: unknown }>,
	)) {
		const path = prefix === "" ? name : `${prefix}.${name}`;

		if (group.description) {
			descriptions[path] = group.description;
		}

		Object.assign(
			descriptions,
			groupDescriptions(group.groups ?? {}, path),
		);
	}

	return descriptions;
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
		const source = savedSpec() as Record<string, unknown>;
		const expected = groupDescriptions(source["x-forge-commands"]);
		const { document } = annotate(source);
		const commands = document["x-forge-commands"] as Record<
			string,
			{ description: string }
		>;

		expect(Object.keys(commands)).toContain("saves");
		expect(Object.keys(commands)).toContain("me.emails.inbound");

		for (const [path, { description }] of Object.entries(commands)) {
			expect(description).not.toMatch(/\.$/u);
			expect(description).toBe(expected[path]?.replace(/\.$/u, ""));
		}
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
			columns: {},
			flags: {},
			positionals: {},
		});

		expect(warnings).toEqual([]);
		expect(commands).toEqual(["widgets.create", "widgets.delete"]);
		expect(
			document.paths!["/widgets/{id}"]!.delete![
				"x-forge-require-confirmation"
			],
		).toBe("This removes it with --hard.");
	});

	it("should give operations the columns of the mapping", () => {
		const { document, warnings } = annotate(WIDGETS, {
			operations: {},
			confirmations: {},
			columns: { post_WidgetsAdd: ["id", "part.name"] },
			flags: {},
			positionals: {},
		});

		expect(warnings).toEqual([]);
		expect(document.paths!["/widgets"]!.post!["x-bredbox-columns"]).toEqual(
			["id", "part.name"],
		);
		expect(
			document.paths!["/widgets/{id}"]!.delete!["x-bredbox-columns"],
		).toBeUndefined();
	});

	it("should give list commands of the saved document the columns of the mapping", () => {
		const { document } = annotate(savedSpec());

		expect(document.paths!["/saves"]!.get!["x-bredbox-columns"]).toEqual(
			COLUMNS.get_SavesList,
		);
	});

	it("should give operations the flags of the mapping", () => {
		const { document, warnings } = annotate(WIDGETS, {
			...NO_MAPPING,
			flags: { post_WidgetsAdd: { part_name: "name" } },
			positionals: {},
		});

		expect(warnings).toEqual([]);
		expect(document.paths!["/widgets"]!.post!["x-bredbox-flags"]).toEqual({
			part_name: "name",
		});
		expect(
			document.paths!["/widgets/{id}"]!.delete!["x-bredbox-flags"],
		).toBeUndefined();
	});

	it("should give operations of the saved document the flags of the mapping", () => {
		const { document } = annotate(savedSpec());

		expect(
			document.paths!["/collections/{collectionId}/items"]!.post![
				"x-bredbox-flags"
			],
		).toEqual(FLAGS.post_AddCollectionItem);
	});

	it("should give operations the positional of the mapping", () => {
		const { document, warnings } = annotate(WIDGETS, {
			...NO_MAPPING,
			positionals: { post_WidgetsAdd: "part_ids" },
		});

		expect(warnings).toEqual([]);
		expect(document.paths!["/widgets"]!.post!["x-bredbox-positional"]).toBe(
			"part_ids",
		);
		expect(
			document.paths!["/widgets/{id}"]!.delete!["x-bredbox-positional"],
		).toBeUndefined();
	});

	it("should give operations of the saved document the positional of the mapping", () => {
		const { document } = annotate(savedSpec());

		expect(
			document.paths!["/saves/{saveId}/tags"]!.put![
				"x-bredbox-positional"
			],
		).toBe(POSITIONALS.put_SaveTagsSet);
	});

	it("should mark operations whose JSON array body needs at least one item", () => {
		const items = { type: "array", items: { type: "string" } };
		const { document } = annotate(
			{
				components: {
					schemas: { Tags: { ...items, minItems: 1 } },
					requestBodies: {
						Tags: {
							content: {
								"application/json": {
									schema: {
										$ref: "#/components/schemas/Tags",
									},
								},
							},
						},
					},
				},
				paths: {
					"/inline": {
						post: {
							operationId: "post_Inline",
							"x-fern-sdk-group-name": "widgets",
							"x-fern-sdk-method-name": "inline",
							requestBody: {
								content: {
									"application/json": {
										schema: { ...items, minItems: 2 },
									},
								},
							},
						},
					},
					"/referenced": {
						post: {
							operationId: "post_Referenced",
							"x-fern-sdk-group-name": "widgets",
							"x-fern-sdk-method-name": "referenced",
							requestBody: {
								$ref: "#/components/requestBodies/Tags",
							},
						},
					},
					"/optional": {
						post: {
							operationId: "post_Optional",
							"x-fern-sdk-group-name": "widgets",
							"x-fern-sdk-method-name": "optional",
							requestBody: {
								content: {
									"application/json": {
										schema: { ...items, minItems: 0 },
									},
								},
							},
						},
					},
					"/object": {
						post: {
							operationId: "post_Object",
							"x-fern-sdk-group-name": "widgets",
							"x-fern-sdk-method-name": "object",
							requestBody: {
								content: {
									"application/json": {
										schema: { type: "object", minItems: 1 },
									},
								},
							},
						},
					},
				},
			},
			NO_MAPPING,
		);
		const required = (path: string) =>
			document.paths![path]!.post!["x-bredbox-items-required"];

		expect(required("/inline")).toBe(true);
		expect(required("/referenced")).toBe(true);
		expect(required("/optional")).toBeUndefined();
		expect(required("/object")).toBeUndefined();
	});

	it("should give a group the mapping moves the description it had in the document", () => {
		const { document } = annotate(WIDGETS, {
			operations: { post_WidgetsAdd: "parts.add" },
			confirmations: {},
			columns: {},
			flags: {},
			positionals: {},
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
			columns: { get_Gone: ["id"] },
			flags: { put_Gone: { gone_id: "id" } },
			positionals: { put_Gone: "ids" },
		});

		expect(warnings).toEqual([
			'post_WidgetsAdd is "widgets.parts.add" in both generator/mapping.ts and the OpenAPI document; remove it from generator/mapping.ts.',
			"post_Gone is in OPERATIONS in generator/mapping.ts but not in the OpenAPI document.",
			"delete_Gone is in CONFIRMATIONS in generator/mapping.ts but not in the OpenAPI document.",
			"get_Gone is in COLUMNS in generator/mapping.ts but not in the OpenAPI document.",
			"put_Gone is in FLAGS in generator/mapping.ts but not in the OpenAPI document.",
			"put_Gone is in POSITIONALS in generator/mapping.ts but not in the OpenAPI document.",
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

	it(
		"should take the items of an array body from its schema",
		{ timeout: 120_000 },
		async () => {
			const dir = mkdtempSync(join(tmpdir(), "bredbox-generated-"));
			const spec = savedSpec() as {
				paths: Record<
					string,
					Record<
						string,
						{
							requestBody: {
								content: Record<
									string,
									{ schema: Record<string, unknown> }
								>;
							};
						}
					>
				>;
			};
			const schema =
				spec.paths["/saves/{saveId}/tags"]!.post!.requestBody.content[
					"application/json"
				]!.schema;

			schema.minItems = 1;
			schema.description = "The tags to add.";
			writeFileSync(join(dir, "openapi.json"), JSON.stringify(spec));

			try {
				execFileSync(
					process.execPath,
					[
						join(ROOT, "scripts", "generate.ts"),
						"--spec",
						join(dir, "openapi.json"),
						"--out",
						join(dir, "out"),
					],
					{ cwd: ROOT, stdio: ["ignore", "ignore", "pipe"] },
				);

				const { saves } = (await import(
					join(dir, "out", "saves.ts")
				)) as { saves: CommandGroup };
				const add = saves.groups
					.find(group => group.name === "tags")!
					.commands.find(command => command.name === "add")!;

				expect(add.args.at(-1)).toEqual({
					name: "tag",
					wire: "body",
					in: "body",
					type: "string",
					positional: true,
					array: true,
					required: true,
					description: "The tags to add.",
				});
			} finally {
				rmSync(dir, { recursive: true, force: true });
			}
		},
	);
});
