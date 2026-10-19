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
import { annotate, deriveName } from "../generator/annotate.ts";
import { GROUPS, OPERATIONS } from "../generator/mapping.ts";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SAVED_SPEC = join(ROOT, "generator", "openapi.json");

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
		const { warnings, commands } = annotate(savedSpec());

		expect(warnings).toEqual([]);
		expect(commands).toHaveLength(Object.keys(OPERATIONS).length);
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

	it("should add the Fern names, confirmations and group descriptions", () => {
		const { document } = annotate(savedSpec());
		const paths = document.paths!;
		const list = paths["/saves"]!.get!;
		const remove = paths["/saves/{saveId}"]!.delete!;
		const confirm = paths["/me/privacy/confirm"]!.post!;

		expect(list["x-fern-sdk-group-name"]).toBe("saves");
		expect(list["x-fern-sdk-method-name"]).toBe("list");
		expect(list["x-forge-require-confirmation"]).toBeUndefined();

		expect(remove["x-forge-require-confirmation"]).toBe(
			"This moves the save to the trash, or deletes it for good with --permanent.",
		);

		expect(confirm["x-fern-sdk-group-name"]).toBe("me.privacy");
		expect(confirm["x-fern-sdk-method-name"]).toBe("confirm");

		const commands = document["x-forge-commands"] as Record<
			string,
			{ description: string }
		>;

		expect(commands.saves).toEqual({ description: GROUPS.saves });
		expect(commands["me.emails.inbound"]).toEqual({
			description: GROUPS["me.emails.inbound"],
		});
	});

	it("should derive a name for an operation that is not mapped, and warn", () => {
		const { document, warnings, commands } = annotate({
			paths: {
				"/widgets/{id}/spin": {
					post: {
						operationId: "post_WidgetsSpin",
						summary: "Spin a widget",
						tags: ["Widgets"],
					},
					delete: {
						operationId: "delete_WidgetsSpin",
						summary: "Stop spinning",
						tags: ["Widgets"],
					},
				},
				"/nothing": {
					get: {},
				},
			},
		});
		const operation = document.paths!["/widgets/{id}/spin"]!.post!;
		const remove = document.paths!["/widgets/{id}/spin"]!.delete!;

		expect(operation["x-fern-sdk-group-name"]).toBe("widgets");
		expect(operation["x-fern-sdk-method-name"]).toBe("spin");
		expect(remove["x-forge-require-confirmation"]).toBe(
			"This will stop spinning.",
		);
		expect(commands).toEqual(["widgets.spin", "widgets.spin"]);
		expect(warnings).toEqual([
			'post_WidgetsSpin (POST /widgets/{id}/spin) is not in generator/mapping.ts; using "widgets.spin".',
			'delete_WidgetsSpin (DELETE /widgets/{id}/spin) is not in generator/mapping.ts; using "widgets.spin".',
			"GET /nothing has no operationId and was skipped.",
		]);
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
