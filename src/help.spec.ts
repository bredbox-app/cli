/**
 * @fileoverview Tests for help rendering.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import {
	commandHelp,
	commandSchema,
	groupHelp,
	groupSchema,
	rootHelp,
	rootSchema,
} from "./help.js";
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
		expect(help).toContain("--api-url <url>");
		expect(help).not.toContain("--token");
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
		expect(help).toContain("Can also be given as --thing-id.");
		expect(help).toMatch(/--title <string>\s+Required\./u);
		expect(help).toContain("--starred");
		expect(help).toContain("together with --body <json|@file>");
		expect(help).toContain("asks for confirmation; pass --force");
	});

	it("should give the flag of a variadic positional, and none for a positional named like a global flag", () => {
		const command: Command = {
			name: "confirm",
			summary: "Confirm",
			method: "POST",
			path: "/confirm/{token}",
			args: [
				{
					name: "token",
					wire: "token",
					in: "path",
					type: "string",
					required: true,
					positional: true,
				},
				{
					name: "item",
					wire: "body",
					in: "body",
					type: "string",
					required: false,
					positional: true,
					array: true,
				},
			],
			body: "array",
			response: "json",
		};
		const help = commandHelp(command, ["confirm"]);

		expect(help).toContain(
			"Can also be given as --item, once for each value.",
		);
		expect(help).not.toContain("--token");
		expect(
			commandSchema(command, ["confirm"]).arguments[0],
		).not.toHaveProperty("flag");
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

describe("rootSchema()", () => {
	it("should describe the program, the global options and every group", () => {
		const schema = rootSchema([things], "A CLI.", "1.2.3");

		expect(schema.program).toBe("bredbox");
		expect(schema.version).toBe("1.2.3");
		expect(schema.description).toBe("A CLI.");
		expect(schema.options).toContainEqual({
			name: "--output",
			short: "-o",
			value: "file",
			description: "Write the response to a file",
		});
		expect(schema.options.map(option => option.name)).not.toContain(
			"--token",
		);
		expect(schema.groups).toEqual([groupSchema(things, ["things"])]);
	});
});

describe("groupSchema()", () => {
	it("should list commands by full name, hiding hidden commands and marking deprecated ones", () => {
		expect(groupSchema(things, ["things"])).toEqual({
			group: "things",
			description: "Things to do",
			commands: [
				{ command: "things list", summary: "List things" },
				{ command: "things update", summary: "Update a thing" },
				{
					command: "things old",
					summary: "List things",
					deprecated: true,
				},
			],
			groups: [
				{
					group: "things parts",
					description: "Parts of things",
					commands: [],
					groups: [],
				},
			],
		});
	});
});

describe("commandSchema()", () => {
	it("should describe the request and the arguments", () => {
		expect(commandSchema(list, ["things", "list"])).toEqual({
			command: "things list",
			summary: "List things",
			request: { method: "GET", path: "/things" },
			arguments: [
				{
					name: "filter",
					positional: false,
					flag: "--filter",
					type: "string",
					required: false,
					in: "query",
					field: "filter",
					description: "Which things to list",
					choices: ["all", "some"],
					default: "all",
				},
				{
					name: "type",
					positional: false,
					flag: "--type",
					type: "string",
					required: false,
					array: true,
					in: "query",
					field: "type",
				},
			],
			body: "none",
			response: "json",
		});
	});

	it("should include the description, positionals, body fields and confirmation", () => {
		const schema = commandSchema(update, ["things", "update"]);

		expect(schema.description).toBe(update.description);
		expect(schema.confirmation).toBe("This changes the thing.");
		expect(schema.body).toBe("object");
		expect(schema.arguments[0]).toEqual({
			name: "thing-id",
			positional: true,
			flag: "--thing-id",
			type: "string",
			required: true,
			in: "path",
			field: "thingId",
		});
		expect(schema.arguments[1]).toMatchObject({
			name: "title",
			in: "body",
			field: "title",
			required: true,
		});
	});

	it("should leave out the field of an array body and of a local argument, and the request of a local command", () => {
		const tag: Command = {
			name: "add",
			summary: "Add tags",
			method: "POST",
			path: "/things/{thingId}/tags",
			args: [
				{
					name: "tag",
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
		const local: Command = {
			name: "login",
			summary: "Log in",
			method: "",
			path: "",
			args: [
				{
					name: "token",
					wire: "token",
					in: "none",
					type: "string",
					required: false,
					secret: true,
				},
			],
			body: "none",
			response: "none",
		};

		expect(commandSchema(tag, ["things", "tags", "add"]).arguments).toEqual(
			[
				{
					name: "tag",
					positional: true,
					flag: "--tag",
					type: "string",
					required: false,
					array: true,
					in: "body",
				},
			],
		);

		const schema = commandSchema(local, ["auth", "login"]);

		expect(schema).not.toHaveProperty("request");
		expect(schema.arguments).toEqual([
			{
				name: "token",
				positional: false,
				flag: "--token",
				type: "string",
				required: false,
				in: "none",
				secret: true,
			},
		]);
	});

	it("should collapse whitespace in descriptions and include columns", () => {
		const schema = commandSchema(
			{
				...list,
				columns: ["id", "title"],
				args: [{ ...list.args[0], description: "Which\n  things" }],
			},
			["things", "list"],
		);

		expect(schema.columns).toEqual(["id", "title"]);
		expect(schema.arguments[0].description).toBe("Which things");
	});
});
