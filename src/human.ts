/**
 * @fileoverview Formats JSON responses for people: a list as a table, an
 * object as aligned fields, and a list of words one per line.
 *
 * A list is an array, or an object whose `items` is an array, as the API
 * pages its lists. The columns of a table come from the command, which the
 * generator gives the fields its rows have, or else from the rows.
 * @author Nicholas C. Zakas
 */

//-----------------------------------------------------------------------------
// Types
//-----------------------------------------------------------------------------

/**
 * How to format a value for people.
 */
export interface HumanOptions {
	/**
	 * The fields to show as the columns of a table, as dotted paths into each
	 * row: `save.title`. Columns come from the rows if there are none.
	 */
	columns?: readonly string[] | undefined;

	/** The width to fit a table in, or nothing for no limit. */
	width?: number | undefined;

	/** Whether to embolden headings with terminal escapes. */
	color?: boolean | undefined;

	/** The time that dates are relative to; now by default. */
	now?: Date | undefined;
}

/**
 * A value formatted for people.
 */
export interface HumanOutput {
	/** The text for standard output, ending in a newline, or empty. */
	text: string;

	/** Lines about the output, such as more pages, for standard error. */
	notes: string[];
}

//-----------------------------------------------------------------------------
// Helpers
//-----------------------------------------------------------------------------

/**
 * The space between the columns of a table.
 */
const GAP = "  ";

/**
 * The narrowest a column is truncated to.
 */
const MIN_WIDTH = 10;

/**
 * The narrowest a column is truncated to while there are columns after it
 * that can be hidden to make room.
 */
const SHARE_WIDTH = 20;

/**
 * Text that a search marks as matching: `<mark>bread</mark>`.
 */
const MARK = /<mark>(.*?)<\/mark>/gsu;

/**
 * Characters that take no space on a terminal: combining marks and
 * variation selectors, controls, and format characters such as joiners.
 */
const ZERO_WIDTH = /^[\p{Mn}\p{Me}\p{Cc}\p{Cf}]$/u;

/**
 * Characters that take two columns on a terminal: East Asian wide and
 * full-width characters, and emoji.
 */
const DOUBLE_WIDTH =
	/^[\u1100-\u115F\u2E80-\u303E\u3041-\u33FF\u3400-\u4DBF\u4E00-\u9FFF\uA000-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F900}-\u{1F9FF}\u{20000}-\u{3FFFD}]$/u;

/**
 * The most columns taken from the rows when the command gives none.
 */
const MAX_COLUMNS = 6;

/**
 * An ISO 8601 date and time, as the API writes them.
 */
const DATE_TIME =
	/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/u;

/**
 * The units of a relative time, largest first, in seconds.
 */
const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
	["year", 365 * 24 * 60 * 60],
	["month", 30 * 24 * 60 * 60],
	["week", 7 * 24 * 60 * 60],
	["day", 24 * 60 * 60],
	["hour", 60 * 60],
	["minute", 60],
	["second", 1],
];

const RELATIVE = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Determines whether a value is a plain object.
 * @param value The value.
 * @returns Whether it is an object that is not an array or null.
 */
function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Determines whether a value fits in one cell: not an object or an array.
 * @param value The value.
 * @returns Whether it is a scalar.
 */
function isScalar(value: unknown): boolean {
	return value === null || typeof value !== "object";
}

/**
 * Determines whether a value is an array of scalars.
 * @param value The value.
 * @returns Whether it is.
 */
function isScalarArray(value: unknown): value is unknown[] {
	return Array.isArray(value) && value.every(isScalar);
}

/**
 * Reads the value at a dotted path.
 * @param row The object to read.
 * @param path The path: `save.title`.
 * @returns The value, or undefined if the path leads nowhere.
 */
function pick(row: unknown, path: string): unknown {
	let value = row;

	for (const key of path.split(".")) {
		if (!isObject(value)) {
			return undefined;
		}

		value = value[key];
	}

	return value;
}

/**
 * Describes a date and time relative to now: "3 days ago", "in 2 hours".
 * @param date The date.
 * @param now The time it is relative to.
 * @returns The description.
 */
function relativeTime(date: Date, now: Date): string {
	const seconds = (date.getTime() - now.getTime()) / 1000;

	if (Math.abs(seconds) < 45) {
		return "just now";
	}

	for (const [unit, size] of UNITS) {
		if (Math.abs(seconds) >= size) {
			return RELATIVE.format(Math.round(seconds / size), unit);
		}
	}

	return "just now";
}

/**
 * Formats a scalar, or an array of them, as text on one line.
 * @param value The value.
 * @param now The time dates are relative to.
 * @param exact Whether to show a date as written, as well as relatively.
 * @returns The text.
 */
function formatValue(value: unknown, now: Date, exact = false): string {
	if (value === null || value === undefined) {
		return "";
	}

	if (typeof value === "boolean") {
		return value ? "yes" : "no";
	}

	if (typeof value === "string") {
		if (DATE_TIME.test(value)) {
			const date = new Date(value);

			if (!Number.isNaN(date.getTime())) {
				const relative = relativeTime(date, now);
				return exact ? `${value} (${relative})` : relative;
			}
		}

		return value;
	}

	if (Array.isArray(value) && value.every(isScalar)) {
		return value.map(item => formatValue(item, now)).join(", ");
	}

	if (typeof value === "object") {
		return JSON.stringify(value);
	}

	return String(value);
}

/**
 * The text of a cell of a table, and the parts of it a search matched.
 */
interface Cell {
	/** The text, on one line. */
	text: string;

	/** Where the matches start and end in the text. */
	marks: [start: number, end: number][];
}

/**
 * Formats a value for a cell, on one line, taking `<mark>` tags out of the
 * text and noting where they were.
 * @param value The value.
 * @param now The time dates are relative to.
 * @returns The cell.
 */
function cell(value: unknown, now: Date): Cell {
	const raw = formatValue(value, now).replace(/\s+/gu, " ").trim();
	const marks: Cell["marks"] = [];
	let text = "";
	let last = 0;

	for (const match of raw.matchAll(MARK)) {
		text += raw.slice(last, match.index);
		marks.push([text.length, text.length + match[1].length]);
		text += match[1];
		last = match.index + match[0].length;
	}

	return { text: text + raw.slice(last), marks };
}

/**
 * Measures how many columns of a terminal a character takes.
 * @param char The character.
 * @returns 0, 1 or 2.
 */
function charWidth(char: string): number {
	if (ZERO_WIDTH.test(char)) {
		return 0;
	}

	return DOUBLE_WIDTH.test(char) ? 2 : 1;
}

/**
 * Measures how many columns of a terminal text takes.
 * @param text The text.
 * @returns The width.
 */
function textWidth(text: string): number {
	let width = 0;

	for (const char of text) {
		width += charWidth(char);
	}

	return width;
}

/**
 * The words of labels that are written in capitals.
 */
const ACRONYMS = new Set(["id", "url", "uri", "api", "html"]);

/**
 * Turns a field name into a label: `site_name` gives "Site name", and
 * `image_url` and `imageUrl` give "Image URL".
 * @param key The field name.
 * @returns The label.
 */
function label(key: string): string {
	const words = key
		.replace(/(?<=[a-z0-9])(?=[A-Z])/gu, " ")
		.split(/[_\s-]+/u)
		.filter(word => word !== "")
		.map(word => word.toLowerCase())
		.map(word => (ACRONYMS.has(word) ? word.toUpperCase() : word))
		.join(" ");

	return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Emboldens text, if color is on.
 * @param text The text.
 * @param color Whether color is on.
 * @returns The text, with escapes if color is on.
 */
function bold(text: string, color: boolean): string {
	return color ? `\u001B[1m${text}\u001B[22m` : text;
}

/**
 * Finds how much of a text fits in a width, leaving a column for an
 * ellipsis if not all of it does.
 * @param text The text.
 * @param width The width.
 * @returns How many code units of the text to keep, which is all of them
 *      if it fits.
 */
function fitting(text: string, width: number): number {
	if (textWidth(text) <= width) {
		return text.length;
	}

	let used = 0;
	let kept = 0;

	for (const char of text) {
		used += charWidth(char);

		if (used > width - 1) {
			break;
		}

		kept += char.length;
	}

	return kept;
}

/**
 * Emboldens the parts of a cell a search matched, as far as `end`.
 * @param content The cell.
 * @param end Where the text is cut.
 * @param color Whether color is on.
 * @returns The text before `end`, with escapes if color is on.
 */
function highlight(content: Cell, end: number, color: boolean): string {
	let text = "";
	let last = 0;

	for (const [start, stop] of content.marks) {
		if (!color || start >= end) {
			break;
		}

		text += content.text.slice(last, start);
		text += bold(content.text.slice(start, Math.min(stop, end)), true);
		last = Math.min(stop, end);
	}

	return text + content.text.slice(last, end);
}

/**
 * Shares space out among columns: each gets as much as it needs or an
 * equal share of what the narrower ones leave, whichever is less.
 * @param needs The width each column needs.
 * @param space The space to share.
 * @returns The width of each column.
 */
function share(needs: readonly number[], space: number): number[] {
	const order = needs.map((_, i) => i).sort((a, b) => needs[a] - needs[b]);
	const widths = [...needs];
	let left = space;

	order.forEach((index, n) => {
		widths[index] = Math.min(
			needs[index],
			Math.floor(left / (order.length - n)),
		);
		left -= widths[index];
	});

	return widths;
}

/**
 * Picks columns from the rows themselves: the fields that hold scalars or
 * lists of them, `id` first.
 * @param rows The rows.
 * @returns The columns.
 */
function columnsOf(rows: readonly Record<string, unknown>[]): string[] {
	const keys: string[] = [];

	for (const row of rows) {
		for (const [key, value] of Object.entries(row)) {
			if (
				!keys.includes(key) &&
				(isScalar(value) || isScalarArray(value))
			) {
				keys.push(key);
			}
		}
	}

	const id = keys.indexOf("id");

	if (id > 0) {
		keys.splice(id, 1);
		keys.unshift("id");
	}

	return keys.slice(0, MAX_COLUMNS);
}

/**
 * Determines whether a column holds identifiers, which are never cut, so
 * that they can be copied into the next command.
 * @param column The column.
 * @returns Whether it does.
 */
function isIdColumn(column: string): boolean {
	const key = column.split(".").pop() ?? column;

	return key === "id" || key.endsWith("_id") || key.endsWith("Id");
}

/**
 * Formats rows as a table. On a terminal, the columns share its width:
 * ids keep theirs, so that they can be copied, and if the other columns
 * would be cut too narrow, the last of them are hidden.
 * @param rows The rows.
 * @param columns The columns, as dotted paths into each row, most
 *      important first.
 * @param options How to format the table.
 * @returns The lines of the table, and the headings of hidden columns.
 */
function table(
	rows: readonly Record<string, unknown>[],
	columns: readonly string[],
	options: Required<Pick<HumanOptions, "color" | "now">> &
		Pick<HumanOptions, "width">,
): { lines: string[]; hidden: string[] } {
	const headings = columns.map(column =>
		label(column.split(".").pop() ?? column).toUpperCase(),
	);
	const cells = rows.map(row =>
		columns.map(column => cell(pick(row, column), options.now)),
	);
	const needs = headings.map((heading, i) =>
		Math.max(
			textWidth(heading),
			...cells.map(line => textWidth(line[i].text)),
		),
	);
	const widths = [...needs];
	const shown = columns.map((_, i) => i);

	if (options.width !== undefined) {
		for (;;) {
			const flexible = shown.filter(i => !isIdColumn(columns[i]));
			const space =
				options.width -
				GAP.length * (shown.length - 1) -
				shown
					.filter(i => isIdColumn(columns[i]))
					.reduce((sum, i) => sum + needs[i], 0);
			const shares = share(
				flexible.map(i => needs[i]),
				space,
			);
			const cramped = shares.some(
				(width, n) => width < Math.min(needs[flexible[n]], SHARE_WIDTH),
			);

			// Columns come in order of importance, so rather than cut
			// every column short, hide the last one and share again.
			if (cramped && flexible.length > 1) {
				shown.splice(shown.indexOf(flexible[flexible.length - 1]), 1);
				continue;
			}

			flexible.forEach((i, n) => {
				widths[i] = Math.max(shares[n], Math.min(needs[i], MIN_WIDTH));
			});
			break;
		}
	}

	const line = (contents: Cell[], color: boolean) =>
		shown
			.map((i, n) => {
				const content = contents[i];
				const kept = fitting(content.text, widths[i]);
				const cut = kept < content.text.length;
				const text = `${highlight(content, kept, color)}${cut ? "…" : ""}`;
				const used =
					textWidth(content.text.slice(0, kept)) + (cut ? 1 : 0);
				const padding =
					n === shown.length - 1 ? "" : " ".repeat(widths[i] - used);

				return text + padding;
			})
			.join(GAP)
			.trimEnd();

	return {
		lines: [
			line(
				headings.map(text => ({ text, marks: [[0, text.length]] })),
				options.color,
			),
			...cells.map(contents => line(contents, options.color)),
		],
		hidden: columns
			.map((_, i) => i)
			.filter(i => !shown.includes(i))
			.map(i => headings[i]),
	};
}

/**
 * Formats an object as aligned fields, nesting objects below their labels.
 * @param object The object.
 * @param options How to format it.
 * @param hidden Where to add the headings of columns hidden from tables.
 * @param indent The indent of each line.
 * @returns The lines.
 */
function fields(
	object: Record<string, unknown>,
	options: Required<Pick<HumanOptions, "color" | "now">> &
		Pick<HumanOptions, "width">,
	hidden: Set<string>,
	indent = "",
): string[] {
	const entries = Object.entries(object);
	const width = Math.max(0, ...entries.map(([key]) => label(key).length));
	const lines: string[] = [];

	for (const [key, value] of entries) {
		const name = bold(`${label(key)}:`, options.color);

		if (isObject(value) && Object.keys(value).length > 0) {
			lines.push(`${indent}${name}`);
			lines.push(...fields(value, options, hidden, `${indent}  `));
			continue;
		}

		if (Array.isArray(value) && value.length > 0 && value.every(isObject)) {
			const rows = value as Record<string, unknown>[];
			const nested = table(rows, columnsOf(rows), {
				...options,
				width:
					options.width === undefined
						? undefined
						: options.width - indent.length - 2,
			});

			lines.push(`${indent}${name}`);
			lines.push(...nested.lines.map(row => `${indent}  ${row}`));
			nested.hidden.forEach(heading => hidden.add(heading));
			continue;
		}

		const padding = " ".repeat(width - label(key).length + 1);
		const text = isObject(value)
			? ""
			: formatValue(value, options.now, true);
		const [first = "", ...rest] = text.split("\n");
		const hanging = " ".repeat(indent.length + width + 2);

		lines.push(`${indent}${name}${padding}${first}`.trimEnd());
		lines.push(...rest.map(more => `${hanging}${more}`.trimEnd()));
	}

	return lines;
}

/**
 * Describes where a page of a list is, if there are more pages.
 * @param pagination The `pagination` of the response.
 * @returns The note, or undefined if the list fits on one page.
 */
function pageNote(pagination: unknown): string | undefined {
	if (!isObject(pagination)) {
		return undefined;
	}

	const { page, total_pages: pages, total_count: count } = pagination;

	if (typeof page !== "number" || typeof pages !== "number" || pages <= 1) {
		return undefined;
	}

	const total = typeof count === "number" ? ` (${count} total)` : "";
	const next =
		page < pages ? ` Pass --page ${page + 1} for the next page.` : "";

	return `Page ${page} of ${pages}${total}.${next}`;
}

//-----------------------------------------------------------------------------
// Exports
//-----------------------------------------------------------------------------

/**
 * Formats a JSON value for people.
 * @param data The value.
 * @param options How to format it.
 * @returns The text, and notes about it.
 */
export function formatHuman(
	data: unknown,
	options: HumanOptions = {},
): HumanOutput {
	const settings = {
		color: options.color ?? false,
		now: options.now ?? new Date(),
		width: options.width,
	};
	const notes: string[] = [];
	const hidden = new Set<string>();
	let rows: unknown[] | undefined;

	if (Array.isArray(data)) {
		rows = data;
	} else if (isObject(data) && Array.isArray(data.items)) {
		rows = data.items;

		const note = pageNote(data.pagination);

		if (note) {
			notes.push(note);
		}
	}

	let lines: string[];

	if (rows === undefined) {
		lines = isObject(data)
			? fields(data, settings, hidden)
			: [formatValue(data, settings.now, true)];
	} else if (rows.length === 0) {
		lines = [];
		notes.unshift("No results.");
	} else if (rows.every(isObject)) {
		const columns =
			options.columns && options.columns.length > 0
				? options.columns
				: columnsOf(rows);

		const result = table(rows, columns, settings);

		lines = result.lines;
		result.hidden.forEach(heading => hidden.add(heading));
	} else {
		lines = rows.map(row => formatValue(row, settings.now, true));
	}

	if (hidden.size > 0) {
		notes.push(
			`Hidden to fit the terminal: ${[...hidden].join(", ")}. Pass --json to see every field.`,
		);
	}

	return {
		text: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
		notes,
	};
}
