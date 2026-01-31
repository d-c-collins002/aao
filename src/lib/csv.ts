export function csvEscape(s: string): string {
  const needs = /[",\n\r]/.test(s);
  const v = s.replace(/"/g, '""');
  return needs ? `"${v}"` : v;
}

export function toCsvRow(cols: string[]): string {
  return cols.map(csvEscape).join(",");
}
