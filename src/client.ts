/**
 * @fileoverview Sends the requests of the generated commands.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { ApiError } from "./errors.js";
import type { Command, ResponseKind } from "./types.js";

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * The options of a client.
 */
export interface ClientOptions {
	/** The URL the paths of the API are relative to. */
	baseUrl: string;

	/** The access token, or nothing to send requests unauthenticated. */
	token?: string | undefined;

	/** The `User-Agent` to send. */
	userAgent?: string | undefined;

	/** The fetch function to send requests with; the global one by default. */
	fetch?: typeof fetch | undefined;
}

/**
 * The values of the arguments of a command, by argument name.
 */
export type ArgValues = Record<string, unknown>;

/**
 * A request ready to send.
 */
export interface PreparedRequest {
	/** The full URL, with the query string. */
	url: string;

	/** The HTTP method. */
	method: string;

	/** The headers to send. */
	headers: Record<string, string>;

	/** The body, or nothing. */
	body: string | FormData | undefined;
}

/**
 * The response of a command.
 */
export interface ApiResponse {
	/** The HTTP status. */
	status: number;

	/** The `Content-Type` of the response, or null if there is none. */
	contentType: string | null;

	/** How `data` was read. */
	kind: ResponseKind;

	/** The parsed JSON, the text, the bytes, or undefined for no body. */
	data: unknown;
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Sends the requests of the generated commands.
 */
export class BredboxClient {
	/**
	 * The options the client was created with.
	 */
	#options: ClientOptions;

	/**
	 * Creates a new instance.
	 * @param options The options.
	 * @throws {TypeError} If the base URL is missing.
	 */
	constructor(options: ClientOptions) {
		if (typeof options?.baseUrl !== "string" || options.baseUrl === "") {
			throw new TypeError("Expected a base URL.");
		}

		this.#options = options;
	}

	/**
	 * The URL the paths of the API are relative to.
	 * @returns The base URL.
	 */
	get baseUrl(): string {
		return this.#options.baseUrl;
	}

	/**
	 * Returns a client with the same options but another token.
	 * @param token The token, or nothing to send requests unauthenticated.
	 * @returns The new client.
	 */
	withToken(token: string | undefined): BredboxClient {
		return new BredboxClient({ ...this.#options, token });
	}

	/**
	 * Builds the request of `command` with `values`, without sending it.
	 * @param command The command.
	 * @param values The values of its arguments, by argument name.
	 * @param body The body given with `--body`, if any, which fields merge into.
	 * @returns The request.
	 * @throws {TypeError} If a value cannot be sent where its argument goes.
	 */
	prepare(
		command: Command,
		values: ArgValues,
		body?: unknown,
	): PreparedRequest {
		const url = new URL(
			substitutePath(command, values),
			`${this.#options.baseUrl.replace(/\/+$/u, "")}/`,
		);

		for (const arg of command.args) {
			if (arg.in !== "query") {
				continue;
			}

			const value = values[arg.name];

			if (value === undefined) {
				continue;
			}

			for (const item of Array.isArray(value) ? value : [value]) {
				url.searchParams.append(arg.wire, String(item));
			}
		}

		const headers: Record<string, string> = {
			Accept: acceptFor(command.response),
		};

		if (this.#options.userAgent) {
			headers["User-Agent"] = this.#options.userAgent;
		}

		if (this.#options.token) {
			headers.Authorization = `Bearer ${this.#options.token}`;
		}

		let requestBody: string | FormData | undefined;

		switch (command.body) {
			case "object": {
				if (
					body !== undefined &&
					(typeof body !== "object" ||
						body === null ||
						Array.isArray(body))
				) {
					throw new TypeError("Expected --body to be a JSON object.");
				}

				const fields: Record<string, unknown> = {
					...((body as Record<string, unknown> | undefined) ?? {}),
				};

				for (const arg of command.args) {
					if (arg.in === "body" && values[arg.name] !== undefined) {
						fields[arg.wire] = values[arg.name];
					}
				}

				headers["Content-Type"] = "application/json";
				requestBody = JSON.stringify(fields);
				break;
			}

			case "array": {
				const arg = command.args.find(a => a.in === "body");
				const items = arg ? values[arg.name] : undefined;
				const payload = items ?? body ?? [];

				if (!Array.isArray(payload)) {
					throw new TypeError("Expected --body to be a JSON array.");
				}

				headers["Content-Type"] = "application/json";
				requestBody = JSON.stringify(payload);
				break;
			}

			case "multipart": {
				const form = new FormData();

				for (const arg of command.args) {
					if (arg.in !== "form") {
						continue;
					}

					const value = values[arg.name];

					if (value === undefined) {
						continue;
					}

					if (arg.file) {
						const path = String(value);
						const bytes = readFileSync(path);
						form.append(
							arg.wire,
							new Blob([new Uint8Array(bytes)]),
							basename(path),
						);
					} else {
						form.append(
							arg.wire,
							typeof value === "object"
								? JSON.stringify(value)
								: String(value),
						);
					}
				}

				requestBody = form;
				break;
			}

			default:
				break;
		}

		return {
			url: url.toString(),
			method: command.method,
			headers,
			body: requestBody,
		};
	}

	/**
	 * Sends the request of `command` with `values` and reads the response.
	 * @param command The command.
	 * @param values The values of its arguments, by argument name.
	 * @param body The body given with `--body`, if any.
	 * @returns The response.
	 * @throws {ApiError} If the API answers with an error status.
	 */
	async send(
		command: Command,
		values: ArgValues,
		body?: unknown,
	): Promise<ApiResponse> {
		const request = this.prepare(command, values, body);
		const doFetch = this.#options.fetch ?? fetch;
		const response = await doFetch(request.url, {
			method: request.method,
			headers: request.headers,
			body: request.body,
		});

		const contentType = response.headers.get("content-type");
		const { kind, data } = await readBody(response, contentType);

		if (response.status >= 400) {
			throw new ApiError(response.status, data);
		}

		return { status: response.status, contentType, kind, data };
	}
}

/**
 * Substitutes the path parameters of `command` from `values`.
 * @param command The command.
 * @param values The values of its arguments, by argument name.
 * @returns The path, relative to the base URL, without a leading slash.
 * @throws {TypeError} If a path parameter has no value.
 */
export function substitutePath(command: Command, values: ArgValues): string {
	const path = command.path.replace(/\{([^}]+)\}/gu, (_match, wire) => {
		const arg = command.args.find(a => a.in === "path" && a.wire === wire);
		const value = arg ? values[arg.name] : undefined;

		if (value === undefined || value === "") {
			throw new TypeError(`Expected a value for path parameter ${wire}.`);
		}

		return encodeURIComponent(String(value));
	});

	return path.replace(/^\/+/u, "");
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * Returns the `Accept` header for a response kind.
 * @param kind The kind of response the command expects.
 * @returns The header value.
 */
function acceptFor(kind: ResponseKind): string {
	switch (kind) {
		case "json":
			return "application/json";
		case "text":
			return "text/plain, text/html;q=0.9, application/json;q=0.8, */*;q=0.5";
		default:
			return "*/*";
	}
}

/**
 * Reads the body of a response by its content type.
 * @param response The response.
 * @param contentType Its `Content-Type`.
 * @returns How the body was read, and the body.
 */
async function readBody(
	response: Response,
	contentType: string | null,
): Promise<{ kind: ResponseKind; data: unknown }> {
	if (response.status === 204 || response.status === 205) {
		return { kind: "none", data: undefined };
	}

	const type = (contentType ?? "").split(";")[0].trim().toLowerCase();

	if (type === "application/json" || type.endsWith("+json")) {
		const text = await response.text();

		if (text.trim() === "") {
			return { kind: "none", data: undefined };
		}

		try {
			return { kind: "json", data: JSON.parse(text) };
		} catch {
			return { kind: "text", data: text };
		}
	}

	if (type.startsWith("text/") || type === "") {
		const text = await response.text();

		if (text === "") {
			return { kind: "none", data: undefined };
		}

		return { kind: "text", data: text };
	}

	const bytes = new Uint8Array(await response.arrayBuffer());

	if (bytes.byteLength === 0) {
		return { kind: "none", data: undefined };
	}

	return { kind: "binary", data: bytes };
}
