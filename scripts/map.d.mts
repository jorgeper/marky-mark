/** Type surface of map.mjs for the unit suite (U155–U161) and validate.mjs. */
export interface MapFile {
  path: string;
  text: string;
}
export interface MapRow {
  key: string;
  file: string;
  title: string;
  src: string[];
  tests: string[];
}
export interface MapTree {
  specs: MapFile[];
  srcFiles: MapFile[];
  e2eFiles: MapFile[];
}
export declare function citedSpecKeys(text: string): string[];
export declare function compareSpecKeys(a: string, b: string): number;
export declare function specNumber(key: string): number;
export declare function parseSpec(fileName: string, text: string): { key: string; file: string; title: string };
export declare function e2eCitations(source: string): { key: string; test: string | null }[];
export declare function buildRows(tree: MapTree): { rows: MapRow[]; unknown: string[] };
export declare function renderMap(rows: MapRow[]): string;
export declare function readTree(dir: string): MapTree;
export declare function mapFromTree(dir: string): { markdown: string; rows: MapRow[]; unknown: string[] };
