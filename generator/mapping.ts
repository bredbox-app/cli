/**
 * @fileoverview How the operations of the Bredbox API become commands.
 *
 * Forge builds its command tree from the `x-fern-sdk-group-name` and
 * `x-fern-sdk-method-name` extensions of each operation. The Bredbox API
 * document carries neither, so `annotate.ts` adds them from the tables
 * here before the document reaches Forge. The plugin reads the group
 * descriptions through the `x-forge-commands` extension, which
 * `annotate.ts` writes from `GROUPS`.
 *
 * To rename a command, change its entry in `OPERATIONS`. An operation that
 * is not listed gets a name derived from its tag and `operationId`, and
 * `npm run generate` warns about it, so new endpoints show up without being
 * lost, and can then be given a better name here.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Each operation, by `operationId`, as `group[.subgroup].method`. Names
 * are written in camelCase and spelt in kebab-case on the command line.
 */
export const OPERATIONS: Readonly<Record<string, string>> = {
	// Saves
	get_SavesList: "saves.list",
	post_SavesCreate: "saves.create",
	get_SavesSearch: "saves.search",
	get_SavesStatus: "saves.status",
	get_SavesByUrl: "saves.getByUrl",
	get_SavesGet: "saves.get",
	patch_SavesUpdate: "saves.update",
	delete_SavesDelete: "saves.delete",
	get_SavesContent: "saves.content",
	post_SavesRestore: "saves.restore",
	get_SaveTagsList: "saves.tags.list",
	post_SaveTagsAdd: "saves.tags.add",
	put_SaveTagsSet: "saves.tags.set",

	// Reading and listening progress
	get_ReadingProgressGet: "saves.progress.get",
	put_ReadingProgressPut: "saves.progress.set",
	get_ListeningProgressGet: "saves.listening.get",
	put_ListeningProgressPut: "saves.listening.set",

	// Highlights
	get_HighlightsList: "highlights.list",
	post_HighlightsCreate: "highlights.create",
	patch_HighlightsUpdate: "highlights.update",
	delete_HighlightsDelete: "highlights.delete",

	// Imports and exports
	get_ImportsList: "imports.list",
	post_ImportsCreate: "imports.create",
	post_ExportsCreate: "exports.create",
	get_ExportsList: "exports.list",
	get_ExportsDownload: "exports.download",

	// Tags
	get_TagsList: "tags.list",
	get_TagSaves: "tags.saves",
	patch_TagRename: "tags.rename",
	delete_TagDelete: "tags.delete",
	get_TagUsage: "tags.usage",

	// Collections
	get_CollectionsList: "collections.list",
	post_CollectionsCreate: "collections.create",
	get_CollectionsGet: "collections.get",
	patch_CollectionsUpdate: "collections.update",
	delete_CollectionsDelete: "collections.delete",
	get_CollectionItemsList: "collections.items.list",
	post_AddCollectionItem: "collections.items.add",
	get_GetCollectionItem: "collections.items.get",
	patch_UpdateCollectionItem: "collections.items.update",
	delete_DeleteCollectionItem: "collections.items.remove",

	// The current user
	get_MeGet: "me.get",
	delete_MeDelete: "me.delete",
	get_MeInterestsGet: "me.interests.get",
	put_MeInterestsPut: "me.interests.set",
	get_MePersonalizationGet: "me.personalization.get",
	put_MePersonalizationPut: "me.personalization.set",
	delete_MeDataDelete: "me.data.delete",
	post_MePrivacyConfirm: "me.privacy.confirm",
	get_MeJobStatus: "me.jobs.get",
	get_EmailInboundShow: "me.emails.inbound.get",
	post_EmailInboundCreate: "me.emails.inbound.create",
	patch_EmailInboundUpdate: "me.emails.inbound.update",

	// API tokens
	get_TokensList: "tokens.list",
	post_TokensCreate: "tokens.create",
	get_TokensScopes: "tokens.scopes",
	get_TokensGet: "tokens.get",
	patch_TokensUpdate: "tokens.update",
	delete_TokensDelete: "tokens.delete",
	post_TokensRegenerate: "tokens.regenerate",

	// Webhooks
	get_WebhooksEvents: "webhooks.events",
	get_WebhooksList: "webhooks.list",
	post_WebhooksCreate: "webhooks.create",
	get_WebhooksGet: "webhooks.get",
	patch_WebhooksUpdate: "webhooks.update",
	delete_WebhooksDelete: "webhooks.delete",

	// Connected applications
	get_AuthorizationsList: "authorizations.list",
	delete_AuthorizationsDelete: "authorizations.delete",
};

/**
 * The description of each group, by its dotted path. A group without an
 * entry is described as "Operations for <name>".
 */
export const GROUPS: Readonly<Record<string, string>> = {
	authorizations: "Applications connected to your account",
	collections: "Collections of saves",
	"collections.items": "The saves in a collection",
	exports: "Exports of your data",
	highlights: "Highlights on saves",
	imports: "Imports of saves from other services",
	me: "Your profile, settings, and account",
	"me.data": "Everything stored in your account",
	"me.emails": "Email addresses tied to your account",
	"me.emails.inbound": "The address that saves what is emailed to it",
	"me.interests": "The topics you are interested in",
	"me.jobs": "Background jobs running for your account",
	"me.personalization": "Whether recommendations are personalized",
	"me.privacy": "Privacy requests, such as deleting your data",
	saves: "Saved articles, videos, documents, and other content",
	"saves.listening": "How far you have listened to a save",
	"saves.progress": "How far you have read a save",
	"saves.tags": "The tags on a save",
	tags: "Tags across all of your saves",
	tokens: "API tokens for scripts and integrations",
	webhooks: "Webhooks that notify your services of events",
};

/**
 * The sentence shown before a command that cannot be undone, by
 * `operationId`. Every `DELETE` operation asks for confirmation; those not
 * listed here use a sentence made from their summary.
 */
export const CONFIRMATIONS: Readonly<Record<string, string>> = {
	delete_MeDelete:
		"This requests the deletion of your Bredbox account and everything in it.",
	delete_MeDataDelete:
		"This requests the deletion of every save, tag, collection, and highlight in your account.",
	delete_SavesDelete:
		"This moves the save to the trash, or deletes it for good with --permanent.",
	delete_TagDelete: "This removes the tag from every save that carries it.",
	delete_TokensDelete:
		"This revokes the token; anything using it stops working.",
	delete_AuthorizationsDelete:
		"This disconnects the application from your account.",
};
