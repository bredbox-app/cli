/**
 * @fileoverview Tests for the settings and the config file.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Imports
//-----------------------------------------------------------------------------

import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	configPath,
	deleteConfig,
	readConfig,
	resolveSettings,
	writeConfig,
} from "./config.js";

//-----------------------------------------------------------------------------
// Fixtures
//-----------------------------------------------------------------------------

let dir: string;

beforeAll(() => {
	dir = mkdtempSync(join(tmpdir(), "bredbox-config-"));
});

afterAll(() => {
	rmSync(dir, { recursive: true, force: true });
});

//-----------------------------------------------------------------------------
// Tests
//-----------------------------------------------------------------------------

describe("configPath()", () => {
	it("should use BREDBOX_CONFIG when set", () => {
		expect(configPath({ BREDBOX_CONFIG: "/etc/bb.json" }, "linux")).toBe(
			"/etc/bb.json",
		);
	});

	it("should use XDG_CONFIG_HOME when set", () => {
		expect(configPath({ XDG_CONFIG_HOME: "/xdg" }, "linux")).toBe(
			join("/xdg", "bredbox", "config.json"),
		);
	});

	it("should use APPDATA on Windows", () => {
		expect(
			configPath({ APPDATA: "C:\\Users\\me\\AppData\\Roaming" }, "win32"),
		).toBe(
			join("C:\\Users\\me\\AppData\\Roaming", "bredbox", "config.json"),
		);
	});

	it("should fall back to ~/.config", () => {
		expect(configPath({}, "darwin")).toBe(
			join(homedir(), ".config", "bredbox", "config.json"),
		);
	});
});

describe("readConfig()", () => {
	it("should return an empty config when the file does not exist", () => {
		expect(readConfig(join(dir, "missing.json"))).toEqual({});
	});

	it("should throw when the file is not JSON", () => {
		const path = join(dir, "bad.json");
		writeFileSync(path, "{nope");

		expect(() => readConfig(path)).toThrow(
			`Expected ${path} to contain JSON.`,
		);
	});

	it("should throw when the file is not an object", () => {
		const path = join(dir, "array.json");
		writeFileSync(path, "[1]");

		expect(() => readConfig(path)).toThrow(
			`Expected ${path} to contain a JSON object.`,
		);
	});

	it("should read only the known string keys", () => {
		const path = join(dir, "ok.json");
		writeFileSync(
			path,
			JSON.stringify({ token: "t", apiUrl: "u", other: 1, extra: true }),
		);

		expect(readConfig(path)).toEqual({ token: "t", apiUrl: "u" });
	});
});

describe("writeConfig() and deleteConfig()", () => {
	it("should round-trip a config, creating the directory", () => {
		const path = join(dir, "nested", "deeper", "config.json");

		writeConfig(path, { token: "abc" });

		expect(readFileSync(path, "utf8")).toBe('{\n\t"token": "abc"\n}\n');
		expect(readConfig(path)).toEqual({ token: "abc" });

		deleteConfig(path);

		expect(existsSync(path)).toBe(false);
	});

	it("should not throw when deleting a missing file", () => {
		expect(() => deleteConfig(join(dir, "nope.json"))).not.toThrow();
	});
});

describe("resolveSettings()", () => {
	const defaultApiUrl = "https://api.bredbox.app/v2";

	it("should prefer flags over the environment and the config", () => {
		const settings = resolveSettings({
			flags: { apiUrl: "https://flag/" },
			env: { BREDBOX_TOKEN: "env", BREDBOX_API_URL: "https://env" },
			config: { token: "config", apiUrl: "https://config" },
			defaultApiUrl,
		});

		expect(settings).toEqual({ token: "env", apiUrl: "https://flag" });
	});

	it("should prefer the environment over the config", () => {
		const settings = resolveSettings({
			flags: {},
			env: { BREDBOX_TOKEN: "env", BREDBOX_API_URL: "https://env" },
			config: { token: "config", apiUrl: "https://config" },
			defaultApiUrl,
		});

		expect(settings).toEqual({ token: "env", apiUrl: "https://env" });
	});

	it("should use the config, then the default API URL", () => {
		const settings = resolveSettings({
			flags: {},
			env: {},
			config: { token: "config" },
			defaultApiUrl,
		});

		expect(settings).toEqual({ token: "config", apiUrl: defaultApiUrl });
	});

	it("should treat blank values as missing", () => {
		const settings = resolveSettings({
			flags: {},
			env: { BREDBOX_TOKEN: "  " },
			config: { token: "" },
			defaultApiUrl,
		});

		expect(settings.token).toBeUndefined();
	});
});
