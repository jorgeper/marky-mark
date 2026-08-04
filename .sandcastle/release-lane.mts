// Release lane (prd/008 R4–R7): pure classification for `sandcastle:release`
// issues. Every state is derived from GitHub alone — issue body, tag list,
// release list, existing comments. The impure lane runner lives in main.ts
// (agent call sites stay there, template convention); everything here is
// unit-testable, no `gh` or fs calls.

// prd/008 R5: the structured, machine-parseable release-issue body. The
// full contract (what `/new-release` files and the publish close-out reads)
// is documented in release-prompt.md; this module is the one parser of it.
export interface ReleaseSpec {
  /** Strict semver, pre-release id kept, no leading `v` (the tag adds it). */
  version: string;
  platforms: "mac" | "windows" | "both";
  /** The approved changelog entry, verbatim markdown. */
  changelog: string;
}

export type ParsedReleaseBody =
  | { ok: true; spec: ReleaseSpec }
  | { ok: false; problems: string[] };

// Strict semver: MAJOR.MINOR.PATCH with an optional pre-release id. No
// leading `v`, no build metadata — the body carries what release-prepare
// and the tag consume.
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

const PLATFORM_VALUES = ["mac", "windows", "both"] as const;

/** Contents of the `## Changelog` section: everything after the heading up
 * to the next `## ` heading (or EOF), trimmed. Null when the heading is
 * absent. */
const changelogSection = (body: string): string | null => {
  const heading = body.match(/^## Changelog[ \t]*\r?\n/m);
  if (heading === null || heading.index === undefined) return null;
  const rest = body.slice(heading.index + heading[0].length);
  const next = rest.match(/^## /m);
  return (next?.index !== undefined ? rest.slice(0, next.index) : rest).trim();
};

/** prd/008 R5: parse the release-issue body. Collects every problem instead
 * of stopping at the first, so the guard comment names all of them at once. */
export const parseReleaseIssueBody = (body: string): ParsedReleaseBody => {
  const problems: string[] = [];

  const versionLine = body.match(/^\*\*Version:\*\*[ \t]*(.*?)[ \t]*$/m);
  const version = versionLine?.[1] ?? null;
  if (version === null || version === "") {
    problems.push("missing a `**Version:** <semver>` line");
  } else if (!SEMVER_RE.test(version)) {
    problems.push(
      /^v\d/.test(version)
        ? `version \`${version}\` carries a leading \`v\` — the body holds the bare semver (the tag adds the \`v\`)`
        : `version \`${version}\` is not strict semver (MAJOR.MINOR.PATCH with an optional pre-release id, e.g. \`0.4.0-alpha.6\`)`,
    );
  }

  const platformsLine = body.match(/^\*\*Platforms:\*\*[ \t]*(.*?)[ \t]*$/m);
  const platforms = platformsLine?.[1] ?? null;
  if (platforms === null || platforms === "") {
    problems.push("missing a `**Platforms:** mac | windows | both` line");
  } else if (!(PLATFORM_VALUES as readonly string[]).includes(platforms)) {
    problems.push(
      `unknown platform \`${platforms}\` — expected exactly \`mac\`, \`windows\`, or \`both\``,
    );
  }

  const changelog = changelogSection(body);
  if (changelog === null) {
    problems.push("missing the `## Changelog` section");
  } else if (changelog === "") {
    problems.push("the `## Changelog` section is empty");
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    spec: {
      version: version as string,
      platforms: platforms as ReleaseSpec["platforms"],
      changelog: changelog as string,
    },
  };
};

// ---------------------------------------------------------------------------
// prd/008 R6: prerelease-aware semver ordering. Mirrors parseVersion /
// compareVersions in scripts/updater-manifest.mjs (the monotonic updater
// pointer guard from issue #19) — mirrored rather than imported because that
// file is untyped .mjs and this module is pulled into `npm run typecheck`
// by its tests/unit importers.
// ---------------------------------------------------------------------------

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** `undefined` = a full release, which outranks all of its pre-releases. */
  prerelease?: string[];
}

/** Accepts an optional leading `v` (tag names carry one); returns null —
 * never throws — for anything unparseable, e.g. the rolling `updater` tag. */
export const parseVersion = (version: unknown): ParsedVersion | null => {
  if (typeof version !== "string") return null;
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] === undefined ? undefined : m[4].split("."),
  };
};

/** Semver precedence: -1 if a < b, 0 if equal, 1 if a > b. Throws on input
 * that does not parse (callers that tolerate junk use parseVersion first). */
export const compareVersions = (a: string, b: string): -1 | 0 | 1 => {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa) throw new Error(`compareVersions: unparseable version ${JSON.stringify(a)}`);
  if (!pb) throw new Error(`compareVersions: unparseable version ${JSON.stringify(b)}`);

  for (const part of ["major", "minor", "patch"] as const) {
    if (pa[part] !== pb[part]) return pa[part] < pb[part] ? -1 : 1;
  }
  // 0.4.0 > 0.4.0-alpha.5: a release outranks its own pre-releases.
  if (!pa.prerelease && !pb.prerelease) return 0;
  if (!pa.prerelease) return 1;
  if (!pb.prerelease) return -1;

  for (let i = 0; i < Math.max(pa.prerelease.length, pb.prerelease.length); i++) {
    const ia = pa.prerelease[i];
    const ib = pb.prerelease[i];
    // A shorter set of identifiers loses: alpha < alpha.1.
    if (ia === undefined) return -1;
    if (ib === undefined) return 1;
    if (ia === ib) continue;
    const na = /^\d+$/.test(ia);
    const nb = /^\d+$/.test(ib);
    // Numeric identifiers compare numerically (alpha.10 > alpha.9, not
    // '10' < '9') and always rank below alphanumeric ones.
    if (na && nb) return Number(ia) < Number(ib) ? -1 : 1;
    if (na !== nb) return na ? -1 : 1;
    return ia < ib ? -1 : 1;
  }
  return 0;
};

/** Newest release tag among `tagNames` by semver precedence. Unparseable
 * names (the rolling `updater` tag, random branches-as-tags) are ignored.
 * Input: parseTagNames(...) below, or any tag listing. */
export const newestReleaseTag = (tagNames: string[]): string | null => {
  const parseable = tagNames.filter((t) => parseVersion(t) !== null);
  if (parseable.length === 0) return null;
  return parseable.reduce((a, b) => (compareVersions(a, b) >= 0 ? a : b));
};

// ---------------------------------------------------------------------------
// Raw-JSON parsers (gh output in, plain data out — same shape as prd-lane).
// ---------------------------------------------------------------------------

/** Input: `gh api repos/<slug>/tags` (a JSON array of `{ name }`). */
export const parseTagNames = (json: string): string[] =>
  (JSON.parse(json) as { name?: string }[]).map((t) => t.name ?? "").filter(Boolean);

/** Input: `gh release list --json tagName,isDraft`. Returns draft tags only. */
export const parseDraftTags = (json: string): string[] =>
  (JSON.parse(json) as { tagName?: string; isDraft?: boolean }[])
    .filter((r) => r.isDraft === true)
    .map((r) => r.tagName ?? "")
    .filter(Boolean);

/** Input: `gh issue view <n> --json comments`. Generalizes prd-lane's
 * parseCloseMarkerPresent: guard comments are posted once per marker. */
export const parseMarkerPresent = (json: string, marker: string): boolean => {
  const view = JSON.parse(json) as { comments?: { body?: string }[] };
  return (view.comments ?? []).some((c) => (c.body ?? "").includes(marker));
};

// ---------------------------------------------------------------------------
// Guard comments. Each carries a recognizable first line (the
// PARENT_CLOSE_MARKER pattern) so a later loop pass re-classifying the same
// unchanged issue detects the existing comment and does not spam the thread.
// ---------------------------------------------------------------------------

export const MALFORMED_MARKER = "🏰 Sandcastle releaser: malformed release request";
export const OUT_OF_ORDER_MARKER = "🏰 Sandcastle releaser: version refused by the ordering guard";
export const DRAFT_REPORT_MARKER = "🏰 Sandcastle releaser: abandoned draft releases";

// prd/008 R17: the release issue is the running log of the cut — every phase
// transition the runbook (release-prompt.md) completes lands as exactly one
// comment beginning with one of these fixed lines. They are deliberately NOT
// built from the agent marker (which embeds the model string and so varies
// across runs): resume detection via parseMarkerPresent needs stable text.
// main.ts passes them into the runbook as promptArgs, so the prompt can never
// drift from what the classifier below matches. None of the markers in this
// file may contain another (substring matching would then misfire) — unit
// test U209 holds that invariant.
export const PREFLIGHT_ACK_MARKER = "🏰 Sandcastle releaser: preflight acknowledged";
export const GATE_PASSED_MARKER = "🏰 Sandcastle releaser: gate passed";
/** prd/008 R10: the one failure comment — a failed gate (or failed CI run). */
export const CUT_FAILED_MARKER = "🏰 Sandcastle releaser: cut failed";
export const TAG_PUSHED_MARKER = "🏰 Sandcastle releaser: tag pushed";
export const CI_GREEN_MARKER = "🏰 Sandcastle releaser: CI green";
export const DRAFT_VERIFIED_MARKER = "🏰 Sandcastle releaser: draft verified";
export const WINDOWS_APPENDED_MARKER = "🏰 Sandcastle releaser: windows appended";
/** prd/008 R12: the final hand-over — after this, only the human publishes. */
export const AWAITING_PUBLISH_MARKER = "🏰 Sandcastle releaser: cut complete, awaiting publish";

/** prd/008 R5: one explanatory comment naming every parse problem. */
export const buildMalformedComment = (problems: string[]): string =>
  [
    MALFORMED_MARKER,
    "",
    "The issue body does not parse as a release request, so the lane stopped before touching anything:",
    "",
    ...problems.map((p) => `- ${p}`),
    "",
    "The expected format is documented in `.sandcastle/release-prompt.md`. Edit the body (or re-file via `/new-release`) and the next loop pass will re-classify.",
  ].join("\n");

/** prd/008 R6: refusal for a version at or behind the newest existing tag —
 * the #19 (alpha.4 published after alpha.5) incident, made unreproducible. */
export const buildOutOfOrderComment = (version: string, newest: string): string =>
  [
    OUT_OF_ORDER_MARKER,
    "",
    `Refusing to cut \`${version}\`: the newest existing tag is \`${newest}\`, and the requested version is not newer (prerelease-aware semver compare). Cutting backwards is how the #19 incident (v0.4.0-alpha.4 published after v0.4.0-alpha.5) happened.`,
    "",
    "Pick a version newer than the newest tag and update the issue body; the next loop pass will re-classify.",
  ].join("\n");

/** prd/008 R7: report abandoned draft releases with the exact deletion
 * commands. Reporting only — no code path in the lane deletes a release. */
export const buildDraftReport = (draftTags: string[]): string =>
  [
    DRAFT_REPORT_MARKER,
    "",
    `Preflight found ${draftTags.length} abandoned draft release(s). To delete one, run the command yourself — the lane never deletes a release:`,
    "",
    ...draftTags.map((t) => `- \`gh release delete ${t}\``),
  ].join("\n");

// ---------------------------------------------------------------------------
// Classification.
// ---------------------------------------------------------------------------

export type ReleaseAction =
  | { kind: "malformed"; problems: string[] }
  | { kind: "awaiting-publish"; spec: ReleaseSpec }
  | { kind: "windows-append"; spec: ReleaseSpec }
  | { kind: "out-of-order"; version: string; newestTag: string }
  | { kind: "drafts-to-report"; spec: ReleaseSpec; drafts: string[] }
  | { kind: "proceed"; spec: ReleaseSpec };

/** The preflight state machine of prd/008 R5–R13. Guards dominate in order:
 * a body that does not parse ends the lane (R5); a fully-verified cut whose
 * awaiting-publish comment exists needs no sandbox at all — only the human
 * publish remains (R12), and its own tag would otherwise trip the ordering
 * guard; a cut that already posted its tag-pushed comment is mid-flight, so
 * it re-dispatches to resume rather than being refused over its own tag; a
 * `windows` request whose tag already exists appends the installer to that
 * release, bypassing the ordering guard for exactly that case (R13 —
 * `mac`/`both` for an existing version still refuse, preserving the #19
 * guard); a version at or behind the newest tag is refused (R6); unreported abandoned
 * drafts are surfaced once (R7) — informational, the runner posts the report
 * and still dispatches; otherwise the issue proceeds to the releaser agent. */
export const classifyReleaseIssue = (input: {
  body: string;
  tagNames: string[];
  draftTags: string[];
  /** DRAFT_REPORT_MARKER already present among the issue's comments. */
  draftReportPosted: boolean;
  /** AWAITING_PUBLISH_MARKER already present among the issue's comments. */
  awaitingPublishPosted: boolean;
  /** TAG_PUSHED_MARKER already present among the issue's comments. */
  tagPushedPosted: boolean;
}): ReleaseAction => {
  const parsed = parseReleaseIssueBody(input.body);
  if (!parsed.ok) return { kind: "malformed", problems: parsed.problems };
  if (input.awaitingPublishPosted) return { kind: "awaiting-publish", spec: parsed.spec };
  // Mid-flight resume: our own tag push made the version "not newer than the
  // newest tag", and the release's own draft is not an abandoned one — skip
  // those checks and let the runbook pick up from its phase markers. Checked
  // before windows-append: a `windows` full cut that pushed its tag resumes
  // as the full cut it is (merge-back, draft verification still pending) —
  // a true append issue never posts a tag-pushed marker.
  if (input.tagPushedPosted) return { kind: "proceed", spec: parsed.spec };
  if (parsed.spec.platforms === "windows" && input.tagNames.includes(`v${parsed.spec.version}`)) {
    return { kind: "windows-append", spec: parsed.spec };
  }
  const newest = newestReleaseTag(input.tagNames);
  if (newest !== null && compareVersions(parsed.spec.version, newest) <= 0) {
    return { kind: "out-of-order", version: parsed.spec.version, newestTag: newest };
  }
  if (input.draftTags.length > 0 && !input.draftReportPosted) {
    return { kind: "drafts-to-report", spec: parsed.spec, drafts: input.draftTags };
  }
  return { kind: "proceed", spec: parsed.spec };
};
