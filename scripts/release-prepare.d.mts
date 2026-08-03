/** Type surface of release-prepare.mjs for the unit suite (U148/U149). */
export declare function isValidSemver(v: unknown): boolean;
export declare function setJsonVersion(content: string, version: string): string;
export declare function setCargoVersion(content: string, version: string): string;
export declare function readmeVersion(content: string): string | null;
export declare function setReadmeVersion(content: string, version: string): string;
