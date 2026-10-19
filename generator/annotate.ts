/**
 * @fileoverview Prepares the Bredbox OpenAPI document for Forge.
 *
 * Forge only turns an operation into a method when it carries the
 * `x-fern-sdk-group-name` and `x-fern-sdk-method-name` extensions, and reads
 * group descriptions from `x-forge-commands`. This adds all three from the
 * tables in `mapping.ts`, and marks destructive operations with
 * `x-forge-require-confirmation`.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { CONFIRMATIONS, GROUPS, OPERATIONS } from "./mapping.ts";

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
 * The outcome of annotating a document.
 */
export interface AnnotateResult {
	/** The annotated copy of the document. */
	document: OpenApiDocument;

	/** Operations that had no entry in `OPERATIONS` and got a derived name. */
	warnings: string[];

	/** The `group.method` name of every operation that became a command. */
	commands: string[];
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

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
 * Derives a `group.method` name for an operation that `OPERATIONS` does not
 * list, from its first tag and its `operationId`.
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

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Annotates a copy of the document for Forge.
 * @param source The document, as fetched.
 * @returns The annotated document, with warnings about derived names.
 * @throws {TypeError} If the document has no paths.
 */
export function annotate(source: unknown): AnnotateResult {
	if (typeof source !== "object" || source === null) {
		throw new TypeError("Expected an OpenAPI document object.");
	}

	const document = structuredClone(source) as OpenApiDocument;

	if (typeof document.paths !== "object" || document.paths === null) {
		throw new TypeError("Expected the OpenAPI document to have paths.");
	}

	const warnings: string[] = [];
	const commands: string[] = [];
	const groupPaths = new Set<string>();

	for (const [path, item] of Object.entries(document.paths)) {
		if (!item) {
			continue;
		}

		for (const [httpMethod, operation] of Object.entries(item)) {
			if (!HTTP_METHODS.has(httpMethod) || !operation) {
				continue;
			}

			const { operationId } = operation;

			if (!operationId) {
				warnings.push(
					`${httpMethod.toUpperCase()} ${path} has no operationId and was skipped.`,
				);
				continue;
			}

			let full = OPERATIONS[operationId];

			if (!full) {
				full = deriveName(operationId, httpMethod, operation.tags);
				warnings.push(
					`${operationId} (${httpMethod.toUpperCase()} ${path}) is not in generator/mapping.ts; using "${full}".`,
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

			operation["x-fern-sdk-group-name"] = groupName;
			operation["x-fern-sdk-method-name"] = methodName;

			if (httpMethod === "delete") {
				operation["x-forge-require-confirmation"] =
					CONFIRMATIONS[operationId] ??
					`This will ${lowerFirst(operation.summary ?? "delete something")}.`;
			}

			for (let i = 1; i <= parts.length; i++) {
				groupPaths.add(parts.slice(0, i).join("."));
			}

			commands.push(full);
		}
	}

	const forgeCommands: Record<string, { description: string }> = {};

	for (const groupPath of [...groupPaths].sort()) {
		const description = GROUPS[groupPath];

		if (description) {
			forgeCommands[groupPath] = { description };
		}
	}

	document["x-forge-commands"] = forgeCommands;
	commands.sort();

	return { document, warnings, commands };
}
