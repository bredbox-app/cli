/**
 * @fileoverview Prepares the Bredbox OpenAPI document for Forge.
 *
 * Forge turns an operation into a method from its `x-fern-sdk-group-name`
 * and `x-fern-sdk-method-name` extensions, reads group descriptions from
 * `x-forge-commands`, and asks before running an operation that carries
 * `x-forge-require-confirmation`. The document has all of these, written
 * for an SDK. This rewrites them for the command line: a method that gets
 * or lists a named thing becomes that thing, and the tables in `mapping.ts`
 * are laid over the rest.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { COLUMNS, CONFIRMATIONS, OPERATIONS } from "./mapping.ts";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * An operation of the document, with the keys this reads and writes.
 */
export interface OpenApiOperation {
	operationId?: string;
	summary?: string;
	tags?: string[];
	[key: string]: unknown;
}

/**
 * The document, with the keys this reads and writes.
 */
export interface OpenApiDocument {
	openapi?: string;
	info?: { title?: string; version?: string };
	paths?: Record<string, Record<string, OpenApiOperation | undefined>>;
	[key: string]: unknown;
}

/**
 * The tables of `mapping.ts`, which `annotate()` can be given others of.
 */
export interface Mapping {
	/** The command of each operation, by `operationId`. */
	operations: Readonly<Record<string, string>>;

	/** The confirmation of each operation, by `operationId`. */
	confirmations: Readonly<Record<string, string>>;

	/** The table columns of each list operation, by `operationId`. */
	columns: Readonly<Record<string, readonly string[]>>;
}

/**
 * The outcome of annotating a document.
 */
export interface AnnotateResult {
	/** The annotated copy of the document. */
	document: OpenApiDocument;

	/** Problems with the document or with `mapping.ts` worth fixing. */
	warnings: string[];

	/** The `group.method` name of every operation that became a command. */
	commands: string[];
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const GROUP_NAME = "x-fern-sdk-group-name";
const METHOD_NAME = "x-fern-sdk-method-name";
const CONFIRMATION = "x-forge-require-confirmation";
const FORGE_COMMANDS = "x-forge-commands";

/**
 * The extension that carries the columns of `COLUMNS` to the plugin.
 */
export const COLUMNS_EXTENSION = "x-bredbox-columns";

const HTTP_METHODS = new Set([
	"get",
	"put",
	"post",
	"delete",
	"options",
	"head",
	"patch",
	"trace",
]);

/**
 * Lower-cases the first letter of a sentence.
 * @param text The text.
 * @returns The text with its first letter lower-cased.
 */
function lowerFirst(text: string): string {
	return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Spells a tag as a camelCase group name: "Reading Progress" becomes
 * "readingProgress".
 * @param tag The tag.
 * @returns The group name.
 */
function groupFromTag(tag: string): string {
	const words = tag.split(/[^A-Za-z0-9]+/u).filter(Boolean);

	return words
		.map((word, i) =>
			i === 0
				? word.toLowerCase()
				: word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
		)
		.join("");
}

/**
 * Reads the group of an operation from the document, which gives it as a
 * name or as the names of its path: "saves" or `["saves", "tags"]`.
 * @param value The value of `x-fern-sdk-group-name`.
 * @returns The dotted group path, or `undefined` if there is none.
 */
function documentGroup(value: unknown): string | undefined {
	const parts = Array.isArray(value) ? value : [value];

	if (
		parts.length === 0 ||
		!parts.every(part => typeof part === "string" && part !== "")
	) {
		return undefined;
	}

	return parts.join(".");
}

/**
 * Collects the group descriptions of the document's `x-forge-commands`,
 * which nests subgroups under `groups`, by dotted path.
 * @param value The value of `x-forge-commands`, or of one of its `groups`.
 * @param prefix The dotted path of the group holding `value`.
 * @param descriptions The descriptions found so far, added to.
 * @returns The descriptions.
 */
function documentGroups(
	value: unknown,
	prefix = "",
	descriptions: Record<string, string> = {},
): Record<string, string> {
	if (typeof value !== "object" || value === null) {
		return descriptions;
	}

	for (const [name, group] of Object.entries(value)) {
		if (typeof group !== "object" || group === null) {
			continue;
		}

		const path = prefix === "" ? name : `${prefix}.${name}`;
		const { description, groups } = group as {
			description?: unknown;
			groups?: unknown;
		};

		if (typeof description === "string" && description !== "") {
			// The tables of --help list phrases, not sentences.
			descriptions[path] = description.replace(/\.$/u, "");
		}

		documentGroups(groups, path, descriptions);
	}

	return descriptions;
}

/**
 * Derives a `group.method` name for an operation that has no names in the
 * document and is not in `OPERATIONS`, from its first tag and its
 * `operationId`.
 * @param operationId The `operationId`.
 * @param httpMethod The HTTP method, in lower case.
 * @param tags The tags of the operation.
 * @returns The derived name.
 */
export function deriveName(
	operationId: string,
	httpMethod: string,
	tags: readonly string[] | undefined,
): string {
	const tag = tags?.[0] ?? "other";
	const group = groupFromTag(tag);
	let method = operationId;

	if (method.toLowerCase().startsWith(`${httpMethod}_`)) {
		method = method.slice(httpMethod.length + 1);
	}

	// Drop the tag from the front of the method: "SavesList" -> "List",
	// and the singular "SaveTagsList" -> "TagsList".
	const tagWord = tag.replace(/[^A-Za-z0-9]+/gu, "");
	const singular = tagWord.replace(/s$/u, "");

	if (method === tagWord || method === singular) {
		// Nothing but the tag, as in "get_Saves": the verb is the method.
		method = "";
	} else {
		for (const prefix of [tagWord, singular]) {
			if (prefix !== "" && method.startsWith(prefix)) {
				method = method.slice(prefix.length);
				break;
			}
		}
	}

	if (method === "") {
		method = httpMethod;
	}

	return `${group}.${lowerFirst(method)}`;
}

/**
 * Turns the name of an SDK method into the name of a command. A method that
 * gets or lists a named thing is named for the thing, as the command line
 * reads `bredbox tags usage <tag>` better than `bredbox tags get-usage
 * <tag>`: "getContent" becomes "content" and "listSaves" becomes "saves".
 * A plain "get" or "list" stays, as does "getByUrl", where what follows the
 * verb is not a thing.
 * @param method The SDK method name.
 * @returns The command name.
 */
export function commandName(method: string): string {
	const match = /^(?:get|list)([A-Z].*)$/u.exec(method);

	if (!match || /^By[A-Z]/u.test(match[1]!)) {
		return method;
	}

	return lowerFirst(match[1]!);
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Annotates a copy of the document for Forge.
 * @param source The document, as fetched.
 * @param mapping The tables to lay over the document; those of `mapping.ts`
 * by default.
 * @returns The annotated document, with warnings about the document and
 * `mapping.ts`.
 * @throws {TypeError} If the document has no paths.
 * @throws {Error} If two operations would be the same command.
 */
export function annotate(
	source: unknown,
	mapping: Mapping = {
		operations: OPERATIONS,
		confirmations: CONFIRMATIONS,
		columns: COLUMNS,
	},
): AnnotateResult {
	const { operations, confirmations, columns } = mapping;

	if (typeof source !== "object" || source === null) {
		throw new TypeError("Expected an OpenAPI document object.");
	}

	const document = structuredClone(source) as OpenApiDocument;

	if (typeof document.paths !== "object" || document.paths === null) {
		throw new TypeError("Expected the OpenAPI document to have paths.");
	}

	const warnings: string[] = [];
	const operationIds = new Set<string>();
	const owners = new Map<string, string>();
	const groupPaths = new Set<string>();

	// The document's group for each group that mapping.ts moved operations
	// into, so that the moved group keeps the document's description.
	const movedFrom = new Map<string, string>();

	for (const [path, item] of Object.entries(document.paths)) {
		if (!item) {
			continue;
		}

		for (const [httpMethod, operation] of Object.entries(item)) {
			if (!HTTP_METHODS.has(httpMethod) || !operation) {
				continue;
			}

			const { operationId } = operation;
			const where = `${httpMethod.toUpperCase()} ${path}`;

			if (!operationId) {
				warnings.push(`${where} has no operationId and was skipped.`);
				continue;
			}

			operationIds.add(operationId);

			const group = documentGroup(operation[GROUP_NAME]);
			const method = operation[METHOD_NAME];
			const named =
				group && typeof method === "string" && method !== ""
					? `${group}.${commandName(method)}`
					: undefined;
			let full = operations[operationId];

			if (full && full === named) {
				warnings.push(
					`${operationId} is "${full}" in both generator/mapping.ts and the OpenAPI document; remove it from generator/mapping.ts.`,
				);
			} else if (!full && named) {
				full = named;
			} else if (!full) {
				full = deriveName(operationId, httpMethod, operation.tags);
				warnings.push(
					`${operationId} (${where}) has no ${GROUP_NAME} and ${METHOD_NAME}, and is not in generator/mapping.ts; using "${full}".`,
				);
			}

			const parts = full.split(".");
			const methodName = parts.pop();
			const groupName = parts.join(".");

			if (!methodName || !groupName) {
				throw new TypeError(
					`Expected "${full}" for ${operationId} to be "group.method".`,
				);
			}

			const owner = owners.get(full);

			if (owner) {
				throw new Error(
					`${owner} and ${operationId} are both "${full}"; give one of them another name in generator/mapping.ts.`,
				);
			}

			if (group && group !== groupName && !movedFrom.has(groupName)) {
				movedFrom.set(groupName, group);
			}

			owners.set(full, operationId);
			operation[GROUP_NAME] = groupName;
			operation[METHOD_NAME] = methodName;

			if (confirmations[operationId]) {
				operation[CONFIRMATION] = confirmations[operationId];
			} else if (
				operation[CONFIRMATION] === undefined &&
				httpMethod === "delete"
			) {
				operation[CONFIRMATION] =
					`This will ${lowerFirst(operation.summary ?? "delete something")}.`;
			}

			if (columns[operationId]) {
				operation[COLUMNS_EXTENSION] = [...columns[operationId]];
			}

			for (let i = 1; i <= parts.length; i++) {
				groupPaths.add(parts.slice(0, i).join("."));
			}
		}
	}

	for (const [full, operationId] of owners) {
		if (groupPaths.has(full)) {
			throw new Error(
				`${operationId} is "${full}", which is also a group; give it another name in generator/mapping.ts.`,
			);
		}
	}

	for (const [table, ids] of [
		["OPERATIONS", Object.keys(operations)],
		["CONFIRMATIONS", Object.keys(confirmations)],
		["COLUMNS", Object.keys(columns)],
	] as const) {
		for (const operationId of ids) {
			if (!operationIds.has(operationId)) {
				warnings.push(
					`${operationId} is in ${table} in generator/mapping.ts but not in the OpenAPI document.`,
				);
			}
		}
	}

	// Rewritten from scratch, flat, so that only the groups the commands
	// end up in are described.
	const described = documentGroups(document[FORGE_COMMANDS]);
	const forgeCommands: Record<string, { description: string }> = {};

	for (const groupPath of [...groupPaths].sort()) {
		const from = movedFrom.get(groupPath);
		const description =
			described[groupPath] ??
			(from === undefined ? undefined : described[from]);

		if (description) {
			forgeCommands[groupPath] = { description };
		}
	}

	document[FORGE_COMMANDS] = forgeCommands;

	return { document, warnings, commands: [...owners.keys()].sort() };
}
