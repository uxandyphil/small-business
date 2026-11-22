// Minimal read-only database interface. Satisfied by node:sqlite on the server
// and by the sql.js (WebAssembly) adapter in the static GitHub Pages build, so
// the same query code runs in both places.
export interface ReadStatement {
  all(...params: any[]): unknown[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  get(...params: any[]): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any
}
export interface ReadDB {
  prepare(sql: string): ReadStatement;
}
export type Row = Record<string, unknown>;
