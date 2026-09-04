/** Type surface of editor-boundary.mjs for the unit suite (U1095–U1101). */
export interface BoundaryFinding {
  line: number;
  message: string;
}
export interface BoundaryFileFinding extends BoundaryFinding {
  file: string;
}
export declare function importSpecifiers(source: string): { line: number; spec: string }[];
export declare function editorImportViolation(spec: string, fileDirRel: string): string | null;
export declare function appImportViolation(spec: string, allowedDeepSpecs?: Set<string>): string | null;
export declare function lintEditorSource(source: string, fileDirRel: string): BoundaryFinding[];
export declare function lintAppSource(source: string, allowedDeepSpecs?: Set<string>): BoundaryFinding[];
export declare function declaredDeepSpecs(packageJsonText: string): Set<string>;
export declare function runEditorBoundary(root: string): BoundaryFileFinding[];
