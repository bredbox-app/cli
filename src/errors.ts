/**
 * @fileoverview Errors the CLI reports to the user.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * The exit code of a process that fails.
 */
export const EXIT_FAILURE = 1;

/**
 * The exit code of a process whose command line was wrong.
 */
export const EXIT_USAGE = 2;

/**
 * An error in how the command was invoked: an unknown command, a missing
 * argument, or a value that could not be read.
 */
export class UsageError extends Error {
	/**
	 * The words of the command the error is about, for a usage hint.
	 */
	readonly commandPath: readonly string[];

	/**
	 * Creates a new instance.
	 * @param message The message to show.
	 * @param commandPath The words of the command the error is about.
	 */
	constructor(message: string, commandPath: readonly string[] = []) {
		super(message);
		this.name = "UsageError";
		this.commandPath = commandPath;
	}
}

/**
 * An error response from the API.
 */
export class ApiError extends Error {
	/**
	 * The HTTP status code.
	 */
	readonly status: number;

	/**
	 * The response body, parsed as JSON when it was JSON, or as text.
	 */
	readonly body: unknown;

	/**
	 * Creates a new instance.
	 * @param status The HTTP status code.
	 * @param body The response body.
	 */
	constructor(status: number, body: unknown) {
		super(ApiError.describe(status, body));
		this.name = "ApiError";
		this.status = status;
		this.body = body;
	}

	/**
	 * Builds the message for an error response.
	 * @param status The HTTP status code.
	 * @param body The response body.
	 * @returns The message.
	 */
	static describe(status: number, body: unknown): string {
		if (
			typeof body === "object" &&
			body !== null &&
			"error" in body &&
			typeof body.error === "string"
		) {
			const code =
				"code" in body && typeof body.code === "string"
					? ` [${body.code}]`
					: "";
			return `${body.error}${code} (HTTP ${status})`;
		}

		if (typeof body === "string" && body.trim() !== "") {
			return `${body.trim()} (HTTP ${status})`;
		}

		return `Request failed (HTTP ${status})`;
	}
}

/**
 * The user declined a confirmation, or ran a command that needs one where
 * nobody can answer.
 */
export class CancelledError extends Error {
	/**
	 * Creates a new instance.
	 * @param message The message to show.
	 */
	constructor(message: string) {
		super(message);
		this.name = "CancelledError";
	}
}
