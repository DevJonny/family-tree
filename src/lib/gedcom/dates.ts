const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const QUALIFIERS = new Set(["ABT", "BEF", "AFT", "EST", "CAL", "BET", "FROM", "TO", "INT"]);

/**
 * A number that orders GEDCOM dates chronologically, or undefined when the
 * date can't be placed. Used to insert a new child among their siblings.
 * Qualifiers (ABT, BEF, EST, ...) are ignored, and a range or period
 * (BET x AND y, FROM x TO y) sorts by its first date.
 */
export function dateSortKey(date: string): number | undefined {
  let words = date
    .toUpperCase()
    .replace(/\(.*\)/, "") // INT's date phrase
    .replace(/@#D[^@]*@/g, "") // calendar escapes
    .split(/\s+/)
    .filter(Boolean);
  if (QUALIFIERS.has(words[0])) words = words.slice(1);
  const end = words.findIndex((w) => w === "AND" || w === "TO");
  if (end >= 0) words = words.slice(0, end);
  if (words.length === 0 || words.length > 3) return undefined;

  // A dual year ("1731/32", Old Style / New Style) sorts by its first year.
  const year = /^(\d+)(\/\d+)?$/.exec(words.pop()!);
  if (!year) return undefined;
  let month = 0;
  if (words.length) {
    month = MONTHS.indexOf(words.pop()!) + 1;
    if (month === 0) return undefined;
  }
  let day = 0;
  if (words.length) {
    day = Number(words.pop());
    if (!Number.isInteger(day) || day < 1 || day > 31) return undefined;
  }
  return Number(year[1]) * 10000 + month * 100 + day;
}
