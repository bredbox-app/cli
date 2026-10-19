/**
 * @fileoverview Types shared by the generated commands and the CLI runtime.
 *
 * The files in `src/generated/` are produced by the Forge plugin in
 * `generator/plugin/` and describe every API operation as data of these
 * types. The runtime in `cli.ts` interprets that data: it parses the command
 * line, builds the HTTP request, and prints the response.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * How a value is read from the command line. A `json` argument is parsed as
 * JSON text and may name a file with `@path`.
 */
export type ArgType = "string" | "number" | "boolean" | "json";

/**
 * Where the value of an argument is sent: substituted into the path,
 * appended to the query string, placed in the JSON body, sent as a
 * multipart field, or nowhere, for a command that runs locally.
 */
export type ArgLocation = "path" | "query" | "body" | "form" | "none";

/**
 * The names of the global flags, which no command argument may use. The
 * generator renames or repositions an API field with one of these names.
 */
export const RESERVED_FLAGS: readonly string[] = [
	"help",
	"version",
	"token",
	"api-url",
	"body",
	"output",
	"pretty",
	"compact",
	"force",
	"dry-run",
];

/**
 * An argument of a command: a positional or a flag.
 */
export interface Arg {
	/** The name on the command line, in kebab-case: `per-page`. */
	name: string;

	/** The name as it is sent: `per_page`. For an array body, `body`. */
	wire: string;

	/** Where the value is sent. */
	in: ArgLocation;

	/** How the value is read. */
	type: ArgType;

	/** Whether the argument is a positional rather than a flag. */
	positional?: boolean;

	/**
	 * Whether the argument takes several values: a flag that may be repeated,
	 * or a positional that takes every remaining word.
	 */
	array?: boolean;

	/** Whether the argument must be given. */
	required: boolean;

	/** A short description, or nothing. */
	description?: string;

	/** The values allowed, for an enumeration. */
	choices?: readonly (string | number | boolean)[];

	/** The value the API uses when the argument is left out. */
	default?: unknown;

	/** Whether the value names a file whose contents are uploaded. */
	file?: boolean;

	/** Whether the value is a secret that should not be echoed. */
	secret?: boolean;
}

/**
 * What a command sends as a request body.
 */
export type BodyKind = "none" | "object" | "array" | "multipart";

/**
 * How the response of a command is expected to be read. The runtime still
 * looks at the `Content-Type` of the actual response; this is a hint for
 * help text and for the `Accept` header.
 */
export type ResponseKind = "json" | "text" | "binary" | "none";

/**
 * One API operation, as a command.
 */
export interface Command {
	/** The name on the command line, in kebab-case. */
	name: string;

	/** A one-line summary. */
	summary: string;

	/** A longer description, when the API gives one. */
	description?: string;

	/** The HTTP method, in upper case. */
	method: string;

	/** The path template, with `{name}` placeholders: `/saves/{saveId}`. */
	path: string;

	/** The arguments, positionals first in the order they are given. */
	args: Arg[];

	/** What the command sends as a body. */
	body: BodyKind;

	/** How the response is read. */
	response: ResponseKind;

	/**
	 * A sentence to confirm before running the command, which changes or
	 * deletes something irreversibly, or nothing if it needs no confirmation.
	 */
	confirmation?: string;

	/** Whether the command is left out of help. */
	hidden?: boolean;

	/** Whether the API deprecates the operation. */
	deprecated?: boolean;
}

/**
 * A group of commands and subgroups: `bredbox saves ...`.
 */
export interface CommandGroup {
	/** The name on the command line, in kebab-case. */
	name: string;

	/** A short description. */
	description: string;

	/** The commands directly in the group, sorted by name. */
	commands: Command[];

	/** The subgroups, sorted by name. */
	groups: CommandGroup[];
}

/**
 * Facts about the API the commands were generated from.
 */
export interface ApiInfo {
	/** The title of the API. */
	title: string;

	/** The version of the API document. */
	version: string;

	/** The default base URL of the API. */
	baseUrl: string;
}
