/** Type surface of style-lint.mjs for the unit suite (U1015–U1024). */
export interface StyleLintFinding {
  line: number;
  message: string;
}
export interface StyleLintFileFinding extends StyleLintFinding {
  file: string;
}
export interface CssLintOptions {
  contractVars: Set<string>;
  definedVars: Set<string>;
}
export declare function stripCssComments(css: string): string;
export declare function blankSkippedRegions(css: string): string;
export declare function cssCustomProps(css: string): Set<string>;
export declare function themesTokenNames(themesMd: string): Set<string>;
export declare function themesContractVars(themesMd: string): Set<string>;
export declare function lintCss(css: string, opts: CssLintOptions): StyleLintFinding[];
export declare function lintTsx(source: string): StyleLintFinding[];
export declare function listTsxFiles(root: string): string[];
export declare function runStyleLint(root: string): StyleLintFileFinding[];
