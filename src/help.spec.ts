/**
 * @fileoverview Tests for help rendering.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { commandHelp, groupHelp, rootHelp } from "./help.js";
import type { Command, CommandGroup } from "./types.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

const list: Command = {
	name: "list",
	summary: "List things",
	method: "GET",
	path: "/things",
	args: [
		{
			name: "filter",
			wire: "filter",
			in: "query",
			type: "string",
			required: false,
			choices: ["all", "some"],
			default: "all",
			description: "Which things to list",
		},
		{
			name: "type",
			wire: "type",
			in: "query",
			type: "string",
			array: true,
			required: false,
		},
	],
	body: "none",
	response: "json",
};

const update: Command = {
	name: "update",
	summary: "Update a thing",
	description:
		"Updates a thing. This description is long enough that it has to be wrapped onto more than one line when it is shown in the help of the command.",
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
			name: "title",
			wire: "title",
			in: "body",
			type: "string",
			required: true,
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
	confirmation: "This changes the thing.",
};

const hidden: Command = { ...list, name: "secret", hidden: true };
const old: Command = { ...list, name: "old", deprecated: true };

const things: CommandGroup = {
	name: "things",
	description: "Things to do",
	commands: [list, update, hidden, old],
	groups: [
		{
			name: "parts",
			description: "Parts of things",
			commands: [],
			groups: [],
		},
	],
};

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("rootHelp()", () => {
	it("should list the groups and the global options", () => {
		const help = rootHelp([things], "A CLI.");

		expect(help).toContain("Usage: bredbox <command> [options]");
		expect(help).toContain("A CLI.");
		expect(help).toContain("  things  Things to do");
		expect(help).toContain("--token <token>");
		expect(help).toContain("-h, --help");
	});
});

describe("groupHelp()", () => {
	it("should list commands and subgroups, hiding hidden commands", () => {
		const help = groupHelp(things, ["things"]);

		expect(help).toContain("Usage: bredbox things <command> [options]");
		expect(help).toContain("  list    List things");
		expect(help).toContain("  old     List things (deprecated)");
		expect(help).not.toContain("secret");
		expect(help).toContain("Groups:");
		expect(help).toContain("  parts  Parts of things");
	});
});

describe("commandHelp()", () => {
	it("should show the usage line, options, choices and defaults", () => {
		const help = commandHelp(list, ["things", "list"]);

		expect(help).toContain("Usage: bredbox things list [options]");
		expect(help).toContain("Request: GET /things");
		expect(help).toContain("--filter <string>");
		expect(help).toContain("Which things to list One of: all, some.");
		expect(help).toContain('Default: "all".');
		expect(help).toContain("--type <string>...");
		expect(help).toContain("Repeat the flag for several values.");
		expect(help).not.toContain("Arguments:");
	});

	it("should show positionals, required flags, the body note and the confirmation note", () => {
		const help = commandHelp(update, ["things", "update"]);

		expect(help).toContain(
			"Usage: bredbox things update <thing-id> [options]",
		);
		expect(help).toContain("Arguments:\n  <thing-id>");
		expect(help).toMatch(/--title <string>\s+Required\./u);
		expect(help).toContain("--starred");
		expect(help).toContain("together with --body <json|@file>");
		expect(help).toContain("asks for confirmation; pass --force");
	});

	it("should wrap a long description", () => {
		const help = commandHelp(update, ["things", "update"]);
		const lines = help.split("\n");
		const described = lines.filter(line =>
			line.startsWith("Updates a thing."),
		);

		expect(described).toHaveLength(1);
		expect(lines.every(line => line.length <= 80)).toBe(true);
	});
});
