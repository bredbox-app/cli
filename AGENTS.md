# Agents Instructions

This project is the `bredbox` command line interface for the Bredbox API, a Node.js package whose commands are generated from the API's OpenAPI document with Cloudflare Forge.

## Project Structure

- `src` - The CLI runtime and its unit tests (`*.spec.ts`)
    - `cli.ts` resolves a command from the words given, parses its arguments, sends the request and prints the response
    - `args.ts`, `client.ts`, `config.ts`, `help.ts`, `output.ts` are the pieces it uses
    - `local.ts` holds the hand-written `auth` commands
    - `types.ts` holds the types the generated files and the runtime share
    - `generated/` is written by `npm run generate`. **Never edit it by hand.** Change `generator/` and regenerate.
- `generator` - The generation pipeline
    - `mapping.ts` names every operation (`operationId` to `group.method`), describes the groups, and words the confirmations
    - `annotate.ts` adds the Forge extensions to the OpenAPI document before Forge reads it
    - `plugin/` is the Forge plugin, compiled to WebAssembly, that turns Forge's model into `src/generated/`
    - `openapi.json` is the last fetched copy of the OpenAPI document, used by `npm run generate:offline` and by the tests
- `scripts/generate.ts` - Runs the pipeline
- `tests` - Integration tests using Vitest (`*.test.ts`), including one that checks `src/generated/` matches `generator/openapi.json`

## Code Style and Patterns

Read [`.github/instructions/javascript.instructions.md`](.github/instructions/javascript.instructions.md) for full code style guide.

### Error Handling

- Use specific error messages: "Expected an array argument.", "Expected at least one entry."
- Throw `TypeError` for type validation, `Error` for business logic
- `UsageError` for a wrong command line (exit code 2), `ApiError` for an error response (exit code 1)
- Always validate inputs at method entry points

### Generated Code

- To rename a command, change its entry in `generator/mapping.ts`, then run `npm run generate:offline`
- To change what a command sends or how it is described, change `generator/plugin/command.ts`, then regenerate
- To pick up API changes, run `npm run generate`, which fetches the live document and refreshes `generator/openapi.json`
- The generation drift test fails until `src/generated/` is regenerated after any of these changes

## Dependencies and Tools

- Node.js 22.18 or later with ES modules; `scripts/generate.ts` runs with Node's built-in TypeScript type stripping
- No runtime dependencies: argument parsing uses `util.parseArgs`, requests use `fetch`
- `@cloudflare/forge` (the `forge` binary and the plugin library) and `@bytecodealliance/jco` (compiles the plugin) are development dependencies; Forge is installed from a pkg.pr.new preview build pinned by commit
- Vitest for testing
- ESLint for linting
- Prettier for formatting
- TypeScript for source code and type checking
- tsc for building

## Testing Requirements

- All new methods need comprehensive tests
- Test both success and error paths
- Verify exact error messages
- Test async behavior and concurrent operations
- Mock external dependencies appropriately: pass a fake `fetch`, fake streams and a temporary `configPath` to `run()`
- Unit tests
- Run `npx vitest run <filename>` to execute tests for specific files; always do this until all tests pass for this file.
- Run `npm test` to run all tests

## Pull Requests

When creating pull requests, the title should follow Conventional Commits format (fetch https://www.conventionalcommits.org/en/v1.0.0/) using the following prefixes:

- `feat: ` When adding new functionality
- `fix: ` when fixing a bug
- `docs: ` when updating only `.md` files
- `chore: ` when making changes that do not affect users
- `ci: ` when making changes to continuous integration workflows
- `build: ` when making changes to the build process

The title should reflect the primary goal of the pull request so if new functionality is added and documentation is updated, then `feat: ` is the appropriate title prefix.
