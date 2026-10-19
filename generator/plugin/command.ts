/**
 * @fileoverview Turns a Forge method into the data of a command.
 *
 * Path parameters become positionals, in the order of the path template.
 * Query parameters and the fields of a JSON object body become flags. A
 * JSON array body becomes trailing positionals. A multipart body becomes
 * flags, with its file field taking a path to upload.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import type {
	Body,
	Field,
	Group,
	Method,
	ObjectType,
	Type,
} from "@cloudflare/forge/plugin";
import {
	RESERVED_FLAGS,
	type Arg,
	type ArgType,
	type BodyKind,
	type Command,
	type CommandGroup,
	type ResponseKind,
} from "../../src/types.ts";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Follows a type through the models and null unions around it.
 * @param type The type.
 * @returns The type a value has, if it is not null.
 */
function unwrap(type: Type): Type {
	let current = type;

	for (let i = 0; i < 32; i++) {
		if (current.kind === "model") {
			current = current.model.type;
			continue;
		}

		if (current.kind === "union") {
			const members = current.members.filter(
				member =>
					!(member.kind === "scalar" && member.scalar === "null"),
			);

			if (members.length === 1) {
				current = members[0];
				continue;
			}
		}

		break;
	}

	return current;
}

/**
 * Decides how a value of `type` is read from the command line, and whether
 * it is an array.
 * @param type The type.
 * @returns The argument type and choices.
 */
function argType(type: Type): {
	type: ArgType;
	array: boolean;
	choices?: readonly (string | number | boolean)[];
} {
	const resolved = unwrap(type);

	switch (resolved.kind) {
		case "scalar":
			switch (resolved.scalar) {
				case "number":
					return { type: "number", array: false };
				case "boolean":
					return { type: "boolean", array: false };
				case "unknown":
					return { type: "json", array: false };
				default:
					return { type: "string", array: false };
			}

		case "enum": {
			const kinds = new Set(resolved.values.map(value => typeof value));

			if (kinds.size === 1 && kinds.has("number")) {
				return {
					type: "number",
					array: false,
					choices: resolved.values,
				};
			}

			if (kinds.size === 1 && kinds.has("boolean")) {
				return { type: "boolean", array: false };
			}

			return {
				type: "string",
				array: false,
				choices: resolved.values.map(String),
			};
		}

		case "array": {
			const elem = argType(resolved.elem);

			// Nested arrays and arrays of objects are given as JSON.
			if (elem.array || elem.type === "json") {
				return { type: "json", array: false };
			}

			return { ...elem, array: true };
		}

		default:
			return { type: "json", array: false };
	}
}

/**
 * Returns a value of an unknown JSON type as a default, or undefined for
 * null, which the API would not send anyway.
 * @param value The default from the schema.
 * @returns The default to show.
 */
function defaultOf(value: unknown): unknown {
	return value === null ? undefined : value;
}

/**
 * Builds the argument for a field of the request or body.
 * @param field The field.
 * @param location Where the value is sent.
 * @param options What else to set.
 * @param options.positional Whether the argument is a positional.
 * @returns The argument.
 */
function fieldArg(
	field: Field,
	location: Arg["in"],
	options: { positional?: boolean } = {},
): Arg {
	const { type, array, choices } = argType(field.type);
	const arg: Arg = {
		name: field.name.kebab(),
		wire: field.wireName,
		in: location,
		type,
		required: field.required,
	};

	if (options.positional) {
		arg.positional = true;
	}

	if (array) {
		arg.array = true;
	}

	if (field.description !== "") {
		arg.description = field.description;
	}

	if (choices) {
		arg.choices = choices;
	}

	const fallback = defaultOf(field.default);

	if (fallback !== undefined) {
		arg.default = fallback;
	}

	if (field.sensitive) {
		arg.secret = true;
	}

	return arg;
}

/**
 * Finds the object of path and query parameters in a request type: the
 * request itself, or the member of an intersection whose fields have
 * locations.
 * @param method The method.
 * @returns The parameters object, or undefined if the method has none.
 */
function parametersOf(method: Method): ObjectType | undefined {
	const { request } = method;

	if (!request) {
		return undefined;
	}

	const candidates: Type[] =
		request.kind === "intersection" ? [...request.members] : [request];

	for (const candidate of candidates) {
		if (
			candidate.kind === "object" &&
			candidate.fields.some(field => method.location(field) !== undefined)
		) {
			return candidate;
		}
	}

	return undefined;
}

/**
 * Picks a name for the items of an array body from the group the method is
 * in: `tags` gives `tag`.
 * @param method The method.
 * @returns The singular name, in kebab-case.
 */
function itemName(method: Method): string {
	const words = [...method.group.name.words];
	const last = words.pop() ?? "item";

	words.push(last.endsWith("s") ? last.slice(0, -1) : last);

	return words.join("-");
}

/**
 * Builds the arguments of a body.
 * @param body The body.
 * @returns The kind of body, and its arguments.
 */
function bodyArgs(body: Body | undefined): { kind: BodyKind; args: Arg[] } {
	if (!body) {
		return { kind: "none", args: [] };
	}

	const json = body.json;

	if (json) {
		const type = unwrap(json.type);

		if (type.kind === "array") {
			return { kind: "array", args: [] };
		}

		if (type.kind === "object") {
			return {
				kind: "object",
				args: type.fields
					.filter(field => !field.readOnly)
					.map(field => fieldArg(field, "body")),
			};
		}

		// A body of some other shape is given whole, with --body.
		return { kind: "object", args: [] };
	}

	const form = body.contents.find(
		content => content.mediaType === "multipart/form-data",
	);

	if (form) {
		const type = unwrap(form.type);
		const args: Arg[] = [];

		if (type.kind === "object") {
			for (const field of type.fields) {
				const resolved = unwrap(field.type);
				const isFile =
					field.wireName === "file" ||
					(resolved.kind === "scalar" &&
						(resolved.scalar === "binary" ||
							resolved.scalar === "bytes" ||
							resolved.scalar === "unknown"));
				const arg = fieldArg(field, "form");

				if (isFile) {
					arg.type = "string";
					arg.file = true;
					delete arg.array;
				}

				args.push(arg);
			}
		}

		return { kind: "multipart", args };
	}

	return { kind: "none", args: [] };
}

/**
 * Decides how the response of a method is read, from its first success
 * response that has content.
 * @param method The method.
 * @returns The response kind.
 */
function responseKind(method: Method): ResponseKind {
	const content = method.responses.find(
		response => response.contents.length > 0,
	)?.contents[0];

	if (!content) {
		return "none";
	}

	if (content.isJson) {
		return "json";
	}

	if (content.mediaType.startsWith("text/")) {
		return "text";
	}

	return "binary";
}

/**
 * Returns a name that no global flag uses.
 * @param arg The argument.
 * @returns The argument, renamed if it clashed.
 */
function avoidReserved(arg: Arg): Arg {
	if (!RESERVED_FLAGS.includes(arg.name)) {
		return arg;
	}

	if (arg.required && !arg.array) {
		return { ...arg, positional: true };
	}

	return { ...arg, name: `${arg.name}-field` };
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Builds the command of a method.
 * @param method The method.
 * @returns The command.
 */
export function command(method: Method): Command {
	const parameters = parametersOf(method);
	const pathArgs: Arg[] = [];
	const queryArgs: Arg[] = [];

	for (const field of parameters?.fields ?? []) {
		const location = method.location(field);

		if (location?.in === "path") {
			pathArgs.push(fieldArg(field, "path", { positional: true }));
		} else if (location?.in === "query") {
			queryArgs.push(avoidReserved(fieldArg(field, "query")));
		}
	}

	// Positionals follow the order of the path template, not the document.
	pathArgs.sort(
		(a, b) =>
			method.path.indexOf(`{${a.wire}}`) -
			method.path.indexOf(`{${b.wire}}`),
	);

	const body = bodyArgs(method.body);
	const bodyFlags = body.args.map(avoidReserved);
	const promoted = bodyFlags.filter(arg => arg.positional);
	const flags = bodyFlags.filter(arg => !arg.positional);
	const args: Arg[] = [...pathArgs, ...promoted];

	if (body.kind === "array") {
		args.push({
			name: itemName(method),
			wire: "body",
			in: "body",
			type: "string",
			positional: true,
			array: true,
			required: false,
			description: "The items to send as the JSON array body.",
		});
	}

	args.push(...queryArgs, ...flags);

	const summary =
		method.summary !== ""
			? method.summary
			: method.description.split(/(?<=\.)\s/u)[0] || method.name.kebab();
	const result: Command = {
		name: method.name.kebab(),
		summary,
		...(method.description !== "" && method.description !== summary
			? { description: method.description }
			: {}),
		method: method.httpMethod,
		path: method.path,
		args,
		body: body.kind,
		response: responseKind(method),
	};

	if (method.confirmation !== undefined) {
		result.confirmation = method.confirmation;
	}

	if (method.hidden) {
		result.hidden = true;
	}

	if (method.deprecated || method.availability === "deprecated") {
		result.deprecated = true;
	}

	return result;
}

/**
 * Builds the command group of a Forge group and everything below it.
 * @param group The group.
 * @returns The command group.
 */
export function commandGroup(group: Group): CommandGroup {
	const name = group.name.kebab();

	return {
		name,
		description:
			group.description !== ""
				? group.description
				: `Operations for ${group.path.map(part => part.kebab()).join(" ")}`,
		commands: group.methods.map(command),
		groups: group.children.map(commandGroup),
	};
}
