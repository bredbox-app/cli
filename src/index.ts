/**
 * @fileoverview The programmatic entry point: runs the CLI from code, and
 * exposes the pieces it is made of.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

export { run, resolveCommand, version } from "./cli.js";
export type { RunOptions, Resolution } from "./cli.js";
export { BredboxClient, substitutePath } from "./client.js";
export type { ApiResponse, ClientOptions, PreparedRequest } from "./client.js";
export { ApiError, CancelledError, UsageError } from "./errors.js";
export { api, groups } from "./generated/index.js";
export type * from "./types.js";
