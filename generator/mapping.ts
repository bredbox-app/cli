/**
 * @fileoverview Where the commands of the CLI differ from the names the
 * Bredbox OpenAPI document gives its operations.
 *
 * Forge builds its command tree from the `x-fern-sdk-group-name` and
 * `x-fern-sdk-method-name` extensions of each operation, which the Bredbox
 * API document carries. Those names are chosen for an SDK, where
 * `client.saves.getContent()` reads well; on the command line the verb is
 * noise, so `annotate.ts` turns a `get` or `list` method that names a thing
 * into that thing (`saves content`, `tags usage`). The tables here hold what
 * that rule does not cover, and `annotate.ts` lays them over the document.
 *
 * Group descriptions come from the document's `x-forge-commands`; a group
 * that `OPERATIONS` moves keeps the description it has there.
 *
 * To rename a command, add or change its entry in `OPERATIONS`.
 * `npm run generate` warns about an entry that the document already agrees
 * with, or whose operation no longer exists, so the tables stay small.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The command of each operation, by `operationId`, as
 * `group[.subgroup].method`, where it differs from the document. Names are
 * written in camelCase and spelt in kebab-case on the command line.
 */
export const OPERATIONS: Readonly<Record<string, string>> = {
	// "create", as in every other group, rather than the document's "add".
	// post_SavesCreate: "saves.create",
};

/**
 * The sentence shown before a command that cannot be undone, by
 * `operationId`, where the document's `x-forge-require-confirmation` does
 * not suit the command line. A `DELETE` operation with neither uses a
 * sentence made from its summary.
 */
export const CONFIRMATIONS: Readonly<Record<string, string>> = {
	// The document speaks of the `permanent` parameter; this names the flag.
	delete_SavesDelete:
		"This moves the save to the trash, or deletes it for good with --permanent.",
};
