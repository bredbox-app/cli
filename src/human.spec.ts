/**
 * @fileoverview Tests for formatting responses for people.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { formatHuman } from "./human.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

const now = new Date("2026-10-19T12:00:00Z");

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("formatHuman()", () => {
	describe("lists", () => {
		it("should format the items of a page as a table of the columns given", () => {
			const { text, notes } = formatHuman(
				{
					items: [
						{
							id: "a1",
							title: "First",
							site_name: "Site",
							extra: 1,
						},
						{ id: "b22", title: null, site_name: "Other" },
					],
					pagination: { page: 1, total_pages: 1, total_count: 2 },
				},
				{ columns: ["id", "title", "site_name"], now },
			);

			expect(text).toBe(
				[
					"ID   TITLE  SITE NAME",
					"a1   First  Site",
					"b22         Other",
					"",
				].join("\n"),
			);
			expect(notes).toEqual([]);
		});

		it("should format an array of objects as a table", () => {
			const { text } = formatHuman([{ name: "One" }, { name: "Two" }], {
				now,
			});

			expect(text).toBe("NAME\nOne\nTwo\n");
		});

		it("should read dotted columns from nested objects", () => {
			const { text } = formatHuman(
				{ items: [{ snippet: "…a match…", save: { title: "Found" } }] },
				{ columns: ["save.title", "snippet"], now },
			);

			expect(text).toBe("TITLE  SNIPPET\nFound  …a match…\n");
		});

		it("should take columns from the rows, id first, when none are given", () => {
			const { text } = formatHuman(
				[
					{
						name: "n",
						id: "1",
						nested: { a: 1 },
						rows: [{ a: 1 }],
						tags: ["x", "y"],
						a: 1,
						b: 2,
						c: 3,
						d: 4,
					},
				],
				{ now },
			);

			expect(text).toBe(
				"ID  NAME  TAGS  A  B  C\n1   n     x, y  1  2  3\n",
			);
		});

		it("should format cells: booleans, dates, lists, objects and line breaks", () => {
			const { text } = formatHuman(
				[
					{
						done: true,
						at: "2026-10-16T12:00:00Z",
						tags: ["a", "b"],
						meta: { k: 1 },
						note: "two\nlines",
					},
					{
						done: false,
						at: "2026-10-19T11:59:30.000Z",
						tags: [],
						meta: null,
						note: "",
					},
				],
				{ columns: ["done", "at", "tags", "meta", "note"], now },
			);

			expect(text).toBe(
				[
					"DONE  AT          TAGS  META     NOTE",
					'yes   3 days ago  a, b  {"k":1}  two lines',
					"no    just now",
					"",
				].join("\n"),
			);
		});

		it("should describe future dates and larger units", () => {
			const { text } = formatHuman(
				[
					{ at: "2026-10-19T15:00:00Z" },
					{ at: "2026-11-20T12:00:00Z" },
					{ at: "2024-10-19T12:00:00Z" },
				],
				{ now },
			);

			expect(text).toBe("AT\nin 3 hours\nnext month\n2 years ago\n");
		});

		it("should leave strings that are not dates as they are", () => {
			const { text } = formatHuman([{ at: "2026-99-99T99:99:99Z" }], {
				now,
			});

			expect(text).toBe("AT\n2026-99-99T99:99:99Z\n");
		});

		it("should narrow the last columns first to fit the width, never cutting ids", () => {
			const { text } = formatHuman(
				[
					{
						id: "0123456789-abcdef",
						title: "A rather long title for a save",
						site: "A long site name",
					},
				],
				{ columns: ["id", "title", "site"], width: 50, now },
			);
			const lines = text.trimEnd().split("\n");

			expect(lines).toEqual([
				"ID                 TITLE                SITE",
				"0123456789-abcdef  A rather long titl…  A long si…",
			]);
		});

		it("should stop narrowing at the narrowest a column goes", () => {
			const { text } = formatHuman(
				[{ id: "0123456789", title: "A rather long title" }],
				{ columns: ["id", "title"], width: 5, now },
			);

			expect(text).toBe("ID          TITLE\n0123456789  A rather …\n");
		});

		it("should embolden headings with color", () => {
			const { text } = formatHuman([{ a: 1 }], { color: true, now });

			expect(text).toBe("\u001B[1mA\u001B[22m\n1\n");
		});

		it("should write a list of scalars one per line", () => {
			const { text } = formatHuman(
				{
					items: ["one", "two"],
					pagination: { page: 1, total_pages: 1 },
				},
				{ now },
			);

			expect(text).toBe("one\ntwo\n");
		});

		it("should note an empty list and print nothing", () => {
			expect(formatHuman({ items: [] }, { now })).toEqual({
				text: "",
				notes: ["No results."],
			});
		});

		it("should note the next page when there is one", () => {
			const { notes } = formatHuman(
				{
					items: ["a"],
					pagination: { page: 2, total_pages: 5, total_count: 41 },
				},
				{ now },
			);

			expect(notes).toEqual([
				"Page 2 of 5 (41 total). Pass --page 3 for the next page.",
			]);
		});

		it("should note the last page without a next page or a missing count", () => {
			const { notes } = formatHuman(
				{ items: ["a"], pagination: { page: 3, total_pages: 3 } },
				{ now },
			);

			expect(notes).toEqual(["Page 3 of 3."]);
		});

		it("should ignore pagination it cannot read", () => {
			for (const pagination of [
				null,
				"1",
				{ page: "1", total_pages: 2 },
			]) {
				expect(
					formatHuman({ items: ["a"], pagination }, { now }).notes,
				).toEqual([]);
			}
		});
	});

	describe("objects", () => {
		it("should format an object as aligned fields with readable labels", () => {
			const { text, notes } = formatHuman(
				{
					id: "1",
					image_url: "https://example.com/a.png",
					is_public: false,
					tags: ["a", "b"],
					description: null,
					created_at: "2026-10-18T12:00:00Z",
				},
				{ now },
			);

			expect(text).toBe(
				[
					"ID:          1",
					"Image URL:   https://example.com/a.png",
					"Is public:   no",
					"Tags:        a, b",
					"Description:",
					"Created at:  2026-10-18T12:00:00Z (yesterday)",
					"",
				].join("\n"),
			);
			expect(notes).toEqual([]);
		});

		it("should label camelCase fields as words", () => {
			const { text } = formatHuman(
				{ configPath: "/c", apiUrlSource: "flag" },
				{ now },
			);

			expect(text).toBe("Config path:    /c\nAPI URL source: flag\n");
		});

		it("should nest objects below their labels", () => {
			const { text } = formatHuman(
				{ ok: true, job: { id: "j1", status: "done" }, empty: {} },
				{ now },
			);

			expect(text).toBe(
				[
					"Ok:    yes",
					"Job:",
					"  ID:     j1",
					"  Status: done",
					"Empty:",
					"",
				].join("\n"),
			);
		});

		it("should show a list of objects in a field as a table", () => {
			const { text } = formatHuman(
				{ name: "n", parts: [{ id: "p1" }, { id: "p2" }] },
				{ width: 40, now },
			);

			expect(text).toBe(
				["Name:  n", "Parts:", "  ID", "  p1", "  p2", ""].join("\n"),
			);
		});

		it("should indent the lines of a value that has several", () => {
			const { text } = formatHuman(
				{ note: "first\nsecond", id: "1" },
				{ now },
			);

			expect(text).toBe("Note: first\n      second\nID:   1\n");
		});

		it("should embolden labels with color", () => {
			const { text } = formatHuman({ a: 1 }, { color: true, now });

			expect(text).toBe("\u001B[1mA:\u001B[22m 1\n");
		});
	});

	describe("scalars", () => {
		it("should format a scalar on a line of its own", () => {
			expect(formatHuman("hello", { now }).text).toBe("hello\n");
			expect(formatHuman(3, { now }).text).toBe("3\n");
			expect(formatHuman(null, { now }).text).toBe("\n");
		});
	});
});
