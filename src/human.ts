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
 * Formats a value for a cell, on one line.
 * @param value The value.
 * @param now The time dates are relative to.
 * @returns The text.
 */
function cell(value: unknown, now: Date): string {
	return formatValue(value, now).replace(/\s+/gu, " ").trim();
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
 * Cuts text to a width, ending it with an ellipsis if it was cut.
 * @param text The text.
 * @param width The width.
 * @returns The text, no wider than `width`.
 */
function truncate(text: string, width: number): string {
	return text.length <= width ? text : `${text.slice(0, width - 1)}…`;
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
 * Formats rows as a table.
 * @param rows The rows.
 * @param columns The columns, as dotted paths into each row.
 * @param options How to format the table.
 * @returns The lines of the table.
 */
function table(
	rows: readonly Record<string, unknown>[],
	columns: readonly string[],
	options: Required<Pick<HumanOptions, "color" | "now">> &
		Pick<HumanOptions, "width">,
): string[] {
	const headings = columns.map(column =>
		label(column.split(".").pop() ?? column).toUpperCase(),
	);
	const cells = rows.map(row =>
		columns.map(column => cell(pick(row, column), options.now)),
	);
	const widths = headings.map((heading, i) =>
		Math.max(heading.length, ...cells.map(line => line[i].length)),
	);

	if (options.width !== undefined) {
		const total = () =>
			widths.reduce((sum, width) => sum + width, 0) +
			GAP.length * (widths.length - 1);

		// Columns come in order of importance, so narrow the last ones
		// first, as far as they go, until the table fits.
		for (let i = widths.length - 1; i >= 0; i--) {
			const excess = total() - options.width;

			if (excess <= 0) {
				break;
			}

			if (isIdColumn(columns[i])) {
				continue;
			}

			const floor = Math.max(MIN_WIDTH, headings[i].length);

			widths[i] = Math.max(floor, widths[i] - excess);
		}
	}

	const line = (values: string[], style = (text: string) => text) =>
		values
			.map((value, i) => {
				const text = truncate(value, widths[i]);
				const padding =
					i === values.length - 1
						? ""
						: " ".repeat(widths[i] - text.length);

				return style(text) + padding;
			})
			.join(GAP)
			.trimEnd();

	return [
		line(headings, text => bold(text, options.color)),
		...cells.map(values => line(values)),
	];
}

/**
 * Formats an object as aligned fields, nesting objects below their labels.
 * @param object The object.
 * @param options How to format it.
 * @param indent The indent of each line.
 * @returns The lines.
 */
function fields(
	object: Record<string, unknown>,
	options: Required<Pick<HumanOptions, "color" | "now">> &
		Pick<HumanOptions, "width">,
	indent = "",
): string[] {
	const entries = Object.entries(object);
	const width = Math.max(0, ...entries.map(([key]) => label(key).length));
	const lines: string[] = [];

	for (const [key, value] of entries) {
		const name = bold(`${label(key)}:`, options.color);

		if (isObject(value) && Object.keys(value).length > 0) {
			lines.push(`${indent}${name}`);
			lines.push(...fields(value, options, `${indent}  `));
			continue;
		}

		if (Array.isArray(value) && value.length > 0 && value.every(isObject)) {
			const rows = value as Record<string, unknown>[];

			lines.push(`${indent}${name}`);
			lines.push(
				...table(rows, columnsOf(rows), {
					...options,
					width:
						options.width === undefined
							? undefined
							: options.width - indent.length - 2,
				}).map(row => `${indent}  ${row}`),
			);
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
			? fields(data, settings)
			: [formatValue(data, settings.now, true)];
	} else if (rows.length === 0) {
		lines = [];
		notes.unshift("No results.");
	} else if (rows.every(isObject)) {
		const columns =
			options.columns && options.columns.length > 0
				? options.columns
				: columnsOf(rows);

		lines = table(rows, columns, settings);
	} else {
		lines = rows.map(row => formatValue(row, settings.now, true));
	}

	return {
		text: lines.length === 0 ? "" : `${lines.join("\n")}\n`,
		notes,
	};
}
