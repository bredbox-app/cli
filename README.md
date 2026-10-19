# Bredbox CLI

by [Nicholas C. Zakas](https://humanwhocodes.com)

## Description

`bredbox` is a command line interface for the [Bredbox](https://bredbox.app) API. Every operation of the [Bredbox REST API v2](https://api.bredbox.app/v2/docs) is a command, generated from the API's OpenAPI document with [Cloudflare Forge](https://github.com/cloudflare/forge), so the CLI stays in step with the API.

Responses are JSON: indented when written to a terminal, one line when piped, which suits scripts and agents alike.

**Using the API requires a [Bredbox Pro](https://bredbox.app/pricing) subscription.**

## Installation

```shell
npm install -g @bredbox/cli
```

Or run it without installing:

```shell
npx @bredbox/cli saves list
```

Node.js 22.18 or later is required.

## Usage

### Signing in

Create an API token in your Bredbox account settings, then save it:

```shell
bredbox auth login --token <token>
```

The token is checked against the API and saved in a config file (`~/.config/bredbox/config.json`, or `%APPDATA%\bredbox\config.json` on Windows). You can instead set the `BREDBOX_TOKEN` environment variable, or pass `--token` to any command. `bredbox auth status` shows which one is in use, and `bredbox auth logout` deletes the saved token.

### Commands

Commands follow the shape of the API: a group, sometimes a subgroup, then an operation.

```shell
bredbox saves list --filter inbox --type article
bredbox saves add --url https://example.com/article --tags reading
bredbox saves get <save-id>
bredbox saves content <save-id> --format text
bredbox saves tags add <save-id> one two
bredbox collections items add <collection-id> --user-save-id <save-id>
bredbox tags rename old-name --name new-name
bredbox me get
```

Run `bredbox --help` for the groups, `bredbox saves --help` for the commands in a group, and `bredbox saves list --help` for the options of a command. Every command's help shows the HTTP request it sends.

- **Path parameters** are positionals, in the order they appear in the URL.
- **Query parameters and body fields** are flags, in kebab-case: `per_page` is `--per-page`. Repeat a flag for an array value. Boolean flags take `--no-` to pass false: `--no-is-favorite`.
- **Nested objects** are given as JSON: `--location '{"kind":"pdf","page":3}'`.
- **`@file`** reads a value from a file: `--html @page.html`, `--body @request.json`.
- **`--body`** sends raw JSON as the body, with any flags merged over it.
- **Files** are uploaded from a path: `bredbox imports create --file bookmarks.html`.

### Output

JSON responses are indented on a terminal and compact when piped; `--pretty` and `--compact` override that. Text responses, such as a save's content, print as-is. Binary responses, such as an export archive, go to `--output <file>`:

```shell
bredbox exports download <export-id> --output export.zip
```

`--dry-run` prints the request that would be sent, with the token masked, without sending it.

### Destructive commands

Commands that delete something ask for confirmation on a terminal. Without a terminal they refuse, so scripts pass `--force` (or `-f`) on purpose:

```shell
bredbox saves delete <save-id> --force
```

### Exit codes

| Code | Meaning                                                 |
| ---- | ------------------------------------------------------- |
| 0    | Success                                                 |
| 1    | The API returned an error, or a confirmation was denied |
| 2    | The command line was wrong                              |

### Environment variables

| Variable          | Purpose                                                 |
| ----------------- | ------------------------------------------------------- |
| `BREDBOX_TOKEN`   | The access token                                        |
| `BREDBOX_API_URL` | The API base URL (default `https://api.bredbox.app/v2`) |
| `BREDBOX_CONFIG`  | The path of the config file                             |

## How it is built

The commands are generated, not written. `npm run generate`:

1. Downloads `https://api.bredbox.app/v2/openapi.json` and saves it to `generator/openapi.json`.
2. Annotates it for Forge (`generator/annotate.ts`): Forge groups operations by the `x-fern-sdk-group-name` and `x-fern-sdk-method-name` extensions, which the Bredbox document does not carry, so they are added from the table in `generator/mapping.ts`. `DELETE` operations are marked to ask for confirmation.
3. Compiles the Forge plugin in `generator/plugin/` to WebAssembly with `forge-plugin build`.
4. Runs `forge` with the plugin, which writes one file per group to `src/generated/`, describing each command as data of the types in `src/types.ts`.
5. Formats the output with Prettier.

The runtime in `src/` interprets that data: it parses the command line with Node's `util.parseArgs`, builds the request, and prints the response. It has no dependencies.

`npm run generate:offline` regenerates from the saved document, and the tests check that `src/generated/` matches it. A scheduled workflow regenerates from the live API and opens a pull request when anything changed.

To rename a command or describe a group, edit `generator/mapping.ts` and regenerate. A new endpoint that is not in the table still becomes a command, named from its tag and `operationId`, and `npm run generate` warns about it.

Forge is not yet published to npm; it is installed from Cloudflare's preview builds, pinned by commit in `package.json`. To move to a newer build, change the commit in the `@cloudflare/forge` URL, run `npm install`, and regenerate.

## Development

```shell
npm install
npm run generate:offline   # or npm run generate, to fetch the live document
npm run build
node dist/bin.js --help
npm test
```

## License

Copyright 2026 Nicholas C. Zakas

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
