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

/**
 * The columns of the table a list command prints on a terminal, by
 * `operationId`, as dotted paths into each item of the list: `save.title`.
 * A list command not here shows the first few short fields of its items,
 * `id` first. The generator checks each path against the document.
 */
export const COLUMNS: Readonly<Record<string, readonly string[]>> = {
	get_SavesList: ["id", "title", "site_name", "tags", "created_at"],
	get_SavesSearch: ["save.id", "save.title", "snippet"],
	get_TagSaves: ["id", "title", "site_name", "tags", "created_at"],
	get_HighlightsList: ["id", "text", "comment", "created_at"],
	get_ImportsList: [
		"id",
		"format",
		"status",
		"processed_count",
		"error_count",
		"created_at",
	],
	get_ExportsList: [
		"id",
		"format",
		"status",
		"saves_exported",
		"created_at",
		"expires_at",
	],
	get_CollectionsList: ["id", "name", "item_count", "is_public"],
	get_CollectionItemsList: ["id", "position", "save.title", "note"],
	get_TokensList: ["id", "name", "scopes", "expires_at", "last_used_at"],
	get_TokensScopes: ["scope", "description"],
	get_WebhooksEvents: ["event_type", "category", "description"],
	get_WebhooksList: ["id", "name", "url", "status", "event_types"],
	get_AuthorizationsList: [
		"id",
		"oauth_client.name",
		"scopes",
		"last_used_at",
	],
};

/**
 * The flag of each query parameter or body field, by `operationId` and then
 * by the field's name in the document, where the name the document gives
 * it reads poorly on the command line. Flags are written in kebab-case. The
 * generator checks each field against the document.
 */
export const FLAGS: Readonly<Record<string, Readonly<Record<string, string>>>> =
	{
		// The save is a save of the user's; "user" adds nothing.
		post_AddCollectionItem: { user_save_id: "save-id" },
	};
