/**
 * @fileoverview Generates `src/generated/` from the Bredbox OpenAPI document.
 *
 * Steps:
 *
 * 1. Fetch the document from the API, or read the saved copy with
 *    `--offline`, or a file with `--spec <path>`. A fetched document is
 *    saved to `generator/openapi.json` so that generation and tests can run
 *    without the network.
 * 2. Annotate it for Forge (`generator/annotate.ts`).
 * 3. Compile the Forge plugin (`generator/plugin/index.ts`) to WebAssembly
 *    with `forge-plugin build`.
 * 4. Run `forge` with the plugin to write the output directory.
 * 5. Format the output with Prettier.
 *
 * Usage:
 *
 *     node scripts/generate.ts [--offline] [--spec <path>] [--out <dir>]
 *
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { annotate } from "../generator/annotate.ts";

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

const SPEC_URL = "https://api.bredbox.app/v2/openapi.json";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SAVED_SPEC = join(ROOT, "generator", "openapi.json");
const PLUGIN_ENTRY = join(ROOT, "generator", "plugin", "index.ts");
const PLUGIN_WASM = join(ROOT, "generator", "plugin.wasm");
const DEFAULT_OUT = join(ROOT, "src", "generated");

const require = createRequire(import.meta.url);

/**
 * Finds a script in an installed package.
 * @param pkg The package name.
 * @param relativePath The path of the script inside the package.
 * @returns The absolute path.
 */
function packageScript(pkg: string, relativePath: string): string {
	return join(dirname(require.resolve(`${pkg}/package.json`)), relativePath);
}

/**
 * Runs a Node script, inheriting the terminal.
 * @param script The script.
 * @param args Its arguments.
 * @returns Nothing.
 */
function node(script: string, args: string[]): void {
	execFileSync(process.execPath, [script, ...args], { stdio: "inherit" });
}

/**
 * Writes a line to standard error.
 * @param message The line.
 * @returns Nothing.
 */
function log(message: string): void {
	process.stderr.write(`[generate] ${message}\n`);
}

/**
 * Fetches the OpenAPI document from the API.
 * @returns The document.
 * @throws {Error} If the request fails.
 */
async function fetchSpec(): Promise<unknown> {
	log(`Fetching ${SPEC_URL}`);

	const response = await fetch(SPEC_URL, {
		headers: { Accept: "application/json" },
	});

	if (!response.ok) {
		throw new Error(
			`Could not fetch ${SPEC_URL}: ${response.status} ${response.statusText}`,
		);
	}

	return response.json();
}

//-----------------------------------------------------------------------------
// Main
//-----------------------------------------------------------------------------

const { values } = parseArgs({
	options: {
		offline: { type: "boolean", default: false },
		spec: { type: "string" },
		out: { type: "string", default: DEFAULT_OUT },
		"skip-format": { type: "boolean", default: false },
	},
});

const outDir = resolve(values.out);
let source: unknown;

if (values.spec) {
	log(`Reading ${values.spec}`);
	source = JSON.parse(readFileSync(values.spec, "utf8"));
} else if (values.offline) {
	if (!existsSync(SAVED_SPEC)) {
		throw new Error(
			`${SAVED_SPEC} does not exist; run without --offline once to fetch it.`,
		);
	}

	log(`Reading ${SAVED_SPEC}`);
	source = JSON.parse(readFileSync(SAVED_SPEC, "utf8"));
} else {
	source = await fetchSpec();
	writeFileSync(SAVED_SPEC, `${JSON.stringify(source, null, "\t")}\n`);
	log(`Saved ${SAVED_SPEC}`);
}

const { document, warnings, commands } = annotate(source);

for (const warning of warnings) {
	log(`warning: ${warning}`);
}

log(`${commands.length} operations mapped to commands`);

const tempDir = mkdtempSync(join(tmpdir(), "bredbox-cli-"));

try {
	const specPath = join(tempDir, "openapi.json");
	writeFileSync(specPath, JSON.stringify(document));

	log("Compiling the Forge plugin");
	node(packageScript("@cloudflare/forge", "bin/forge-plugin.mjs"), [
		"build",
		PLUGIN_ENTRY,
		"-o",
		PLUGIN_WASM,
	]);

	log(`Generating ${outDir}`);
	rmSync(outDir, { recursive: true, force: true });
	mkdirSync(outDir, { recursive: true });
	node(packageScript("@cloudflare/forge", "bin/forge.cjs"), [
		specPath,
		"--target",
		`wasm://${PLUGIN_WASM}`,
		"--out",
		outDir,
	]);
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}

if (!values["skip-format"]) {
	log("Formatting");
	// The config is named so that an output directory outside the project,
	// as the tests use, is formatted the same way. Only `.prettierignore`
	// is read: the `tmp` entry of `.gitignore` would otherwise skip an
	// output directory under `/tmp`.
	node(packageScript("prettier", "bin/prettier.cjs"), [
		"--write",
		"--log-level",
		"warn",
		"--config",
		join(ROOT, "prettier.config.js"),
		"--ignore-path",
		join(ROOT, ".prettierignore"),
		outDir,
	]);
}

log("Done");
