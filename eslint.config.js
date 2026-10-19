import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["dist", "tests/fixtures", "generator/plugin.wasm"],
	},
	js.configs.recommended,
	tseslint.configs.recommended,
	{
		files: ["src/**/*.ts", "generator/**/*.ts"],
		rules: {
			"no-console": "error",
		},
	},
	{
		files: ["src/generated/**/*.ts"],
		rules: {
			// Generated files are data; they are never written by hand.
			"@typescript-eslint/no-explicit-any": "off",
		},
	},
);
