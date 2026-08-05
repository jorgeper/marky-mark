import { describe, expect, test } from 'vitest';
import {
  AWAITING_PUBLISH_MARKER,
  buildDraftReport,
  buildMalformedComment,
  buildOutOfOrderComment,
  CI_GREEN_MARKER,
  classifyReleaseIssue,
  compareVersions,
  CUT_FAILED_MARKER,
  DRAFT_REPORT_MARKER,
  DRAFT_VERIFIED_MARKER,
  GATE_PASSED_MARKER,
  MALFORMED_MARKER,
  newestReleaseTag,
  OUT_OF_ORDER_MARKER,
  parseBlockedBy,
  parseDraftTags,
  parseMarkerPresent,
  PRETAG_CI_GREEN_MARKER,
  parseReleaseIssueBody,
  parseTagNames,
  PREFLIGHT_ACK_MARKER,
  releaseOutcome,
  TAG_PUSHED_MARKER,
  WINDOWS_APPENDED_MARKER,
} from '../../.sandcastle/release-lane.mts';

/** A well-formed release-issue body per the release-prompt.md contract. */
const body = (version = '0.5.0', platforms = 'both', changelog = '- Added things.') =>
  `**Version:** ${version}\n**Platforms:** ${platforms}\n\n## Changelog\n\n${changelog}\n`;

// The repo's real tag list at the time of writing, including the rolling
// `updater` tag that must never win the "newest" comparison.
const TAGS = [
  'updater',
  'v0.2.0-alpha.6',
  'v0.3.0-alpha.1',
  'v0.4.0-alpha.1',
  'v0.4.0-alpha.3',
  'v0.4.0-alpha.4',
  'v0.4.0-alpha.5',
];

describe('PRD 008 §R5 release-issue body parse', () => {
  test('U194: parses a well-formed body — version with its pre-release id kept, platforms, changelog verbatim', () => {
    const parsed = parseReleaseIssueBody(
      body('0.4.0-alpha.6', 'mac', '- Fixed the sidebar.\n- Faster startup.'),
    );
    expect(parsed).toEqual({
      ok: true,
      spec: {
        version: '0.4.0-alpha.6',
        platforms: 'mac',
        changelog: '- Fixed the sidebar.\n- Faster startup.',
      },
    });
  });

  test('U195: the changelog section ends at the next ## heading and must be non-empty', () => {
    const parsed = parseReleaseIssueBody(
      `${body('1.0.0', 'windows', '- Entry.')}\n## Notes\n\nnot changelog\n`,
    );
    expect(parsed.ok && parsed.spec.changelog).toBe('- Entry.');

    const empty = parseReleaseIssueBody('**Version:** 1.0.0\n**Platforms:** mac\n\n## Changelog\n\n');
    expect(empty.ok).toBe(false);
    expect(!empty.ok && empty.problems.join(' ')).toMatch(/Changelog.*empty/);
  });

  test('U196: malformed bodies collect every problem — missing version, leading v, unknown platform, missing changelog', () => {
    const missingAll = parseReleaseIssueBody('please release something');
    expect(missingAll.ok).toBe(false);
    expect(!missingAll.ok && missingAll.problems).toHaveLength(3);

    const leadingV = parseReleaseIssueBody(body('v0.5.0'));
    expect(!leadingV.ok && leadingV.problems.join(' ')).toMatch(/leading `v`/);

    const junkVersion = parseReleaseIssueBody(body('0.5'));
    expect(!junkVersion.ok && junkVersion.problems.join(' ')).toMatch(/not strict semver/);

    const badPlatform = parseReleaseIssueBody(body('0.5.0', 'linux'));
    expect(!badPlatform.ok && badPlatform.problems.join(' ')).toMatch(/unknown platform `linux`/);
  });
});

describe('PRD 008 §R6 ordering guard', () => {
  test('U197: newest tag is prerelease-aware and skips unparseable tags like the rolling `updater`', () => {
    expect(newestReleaseTag(TAGS)).toBe('v0.4.0-alpha.5');
    expect(newestReleaseTag(['updater', 'nonsense'])).toBeNull();
    // alpha.10 outranks alpha.9 numerically, and a full release outranks its pre-releases.
    expect(compareVersions('0.4.0-alpha.10', '0.4.0-alpha.9')).toBe(1);
    expect(compareVersions('0.4.0', 'v0.4.0-alpha.5')).toBe(1);
  });

  test('U198: the #19 incident shape — cutting 0.4.0-alpha.4 when v0.4.0-alpha.5 exists is refused', () => {
    const action = classifyReleaseIssue({
      body: body('0.4.0-alpha.4'),
      tagNames: TAGS,
      draftTags: [],
      draftReportPosted: false,
      awaitingPublishPosted: false,
      tagPushedPosted: false,
      cutFailedActive: false,
      blockedByBug: null,
      blockingBugOpen: null,
    });
    expect(action).toEqual({
      kind: 'out-of-order',
      version: '0.4.0-alpha.4',
      newestTag: 'v0.4.0-alpha.5',
    });
  });

  test('U199: equal to the newest tag is refused too; strictly newer proceeds', () => {
    const equal = classifyReleaseIssue({
      body: body('0.4.0-alpha.5'),
      tagNames: TAGS,
      draftTags: [],
      draftReportPosted: false,
      awaitingPublishPosted: false,
      tagPushedPosted: false,
      cutFailedActive: false,
      blockedByBug: null,
      blockingBugOpen: null,
    });
    expect(equal.kind).toBe('out-of-order');

    const newer = classifyReleaseIssue({
      body: body('0.4.0-alpha.6'),
      tagNames: TAGS,
      draftTags: [],
      draftReportPosted: false,
      awaitingPublishPosted: false,
      tagPushedPosted: false,
      cutFailedActive: false,
      blockedByBug: null,
      blockingBugOpen: null,
    });
    expect(newer.kind).toBe('proceed');
  });
});

describe('PRD 008 §R7 abandoned-draft report', () => {
  // The two real abandoned drafts in the repo today.
  const DRAFTS = ['v0.3.0-alpha.1', 'v0.2.0-alpha.3'];

  test('U200: the report lists the exact gh release delete command per draft and carries its marker line', () => {
    const report = buildDraftReport(DRAFTS);
    expect(report.startsWith(DRAFT_REPORT_MARKER)).toBe(true);
    expect(report).toContain('`gh release delete v0.3.0-alpha.1`');
    expect(report).toContain('`gh release delete v0.2.0-alpha.3`');
    expect(report).toContain('never deletes a release');
  });

  test('U201: drafts classify to drafts-to-report only until the report is posted, then the issue proceeds', () => {
    const input = {
      body: body('0.4.0-alpha.6'),
      tagNames: TAGS,
      draftTags: DRAFTS,
      draftReportPosted: false,
      awaitingPublishPosted: false,
      tagPushedPosted: false,
      cutFailedActive: false,
      blockedByBug: null,
      blockingBugOpen: null,
    };
    const first = classifyReleaseIssue(input);
    expect(first.kind).toBe('drafts-to-report');
    expect(first.kind === 'drafts-to-report' && first.drafts).toEqual(DRAFTS);

    const second = classifyReleaseIssue({ ...input, draftReportPosted: true });
    expect(second.kind).toBe('proceed');
    expect(second.kind === 'proceed' && second.spec.version).toBe('0.4.0-alpha.6');
  });

  test('U202: guards dominate the draft report — a malformed body stays malformed with drafts pending', () => {
    const action = classifyReleaseIssue({
      body: 'no structure at all',
      tagNames: TAGS,
      draftTags: DRAFTS,
      draftReportPosted: false,
      awaitingPublishPosted: false,
      tagPushedPosted: false,
      cutFailedActive: false,
      blockedByBug: null,
      blockingBugOpen: null,
    });
    expect(action.kind).toBe('malformed');
  });
});

describe('PRD 008 release-lane gh JSON parsers and guard comments', () => {
  test('U203: parseTagNames and parseDraftTags read gh output; drafts filter on isDraft', () => {
    expect(parseTagNames(JSON.stringify([{ name: 'v0.4.0-alpha.5' }, { name: 'updater' }]))).toEqual([
      'v0.4.0-alpha.5',
      'updater',
    ]);
    expect(
      parseDraftTags(
        JSON.stringify([
          { tagName: 'v0.4.0-alpha.5', isDraft: false },
          { tagName: 'v0.3.0-alpha.1', isDraft: true },
          { tagName: 'v0.2.0-alpha.3', isDraft: true },
        ]),
      ),
    ).toEqual(['v0.3.0-alpha.1', 'v0.2.0-alpha.3']);
  });

  test('U204: guard comments carry their marker line, so parseMarkerPresent suppresses duplicates on later passes', () => {
    const malformed = buildMalformedComment(['missing a `**Version:** <semver>` line']);
    const refusal = buildOutOfOrderComment('0.4.0-alpha.4', 'v0.4.0-alpha.5');
    expect(malformed.startsWith(MALFORMED_MARKER)).toBe(true);
    expect(refusal.startsWith(OUT_OF_ORDER_MARKER)).toBe(true);
    expect(refusal).toContain('#19');

    const comments = JSON.stringify({ comments: [{ body: refusal }] });
    expect(parseMarkerPresent(comments, OUT_OF_ORDER_MARKER)).toBe(true);
    expect(parseMarkerPresent(comments, MALFORMED_MARKER)).toBe(false);
    expect(parseMarkerPresent(JSON.stringify({}), OUT_OF_ORDER_MARKER)).toBe(false);
  });
});

describe('PRD 008 §R12–R13 cut-phase classification', () => {
  /** Classifier input with no phase markers posted yet. */
  const fresh = (b: string) => ({
    body: b,
    tagNames: TAGS,
    draftTags: [],
    draftReportPosted: false,
    awaitingPublishPosted: false,
    tagPushedPosted: false,
    cutFailedActive: false,
    blockedByBug: null as number | null,
    blockingBugOpen: null as boolean | null,
  });

  test('U205: a windows request for an existing tag classifies windows-append; mac/both for the same version stay refused (#19 guard)', () => {
    const windows = classifyReleaseIssue(fresh(body('0.4.0-alpha.5', 'windows')));
    expect(windows.kind).toBe('windows-append');
    expect(windows.kind === 'windows-append' && windows.spec.version).toBe('0.4.0-alpha.5');

    expect(classifyReleaseIssue(fresh(body('0.4.0-alpha.5', 'mac'))).kind).toBe('out-of-order');
    expect(classifyReleaseIssue(fresh(body('0.4.0-alpha.5', 'both'))).kind).toBe('out-of-order');
  });

  test('U206: a windows request whose tag does not exist takes the full-cut path, ordering guard included', () => {
    expect(classifyReleaseIssue(fresh(body('0.4.0-alpha.6', 'windows'))).kind).toBe('proceed');
    // No v0.4.0-alpha.2 tag exists, so no append — and the version is behind
    // the newest tag, so the ordering guard refuses as for any full cut.
    expect(classifyReleaseIssue(fresh(body('0.4.0-alpha.2', 'windows'))).kind).toBe('out-of-order');
  });

  test('U207: the awaiting-publish marker ends the lane host-side, even though the cut’s own tag now trips the ordering guard', () => {
    const done = classifyReleaseIssue({
      ...fresh(body('0.4.0-alpha.5', 'both')),
      awaitingPublishPosted: true,
    });
    expect(done.kind).toBe('awaiting-publish');
    expect(done.kind === 'awaiting-publish' && done.spec.version).toBe('0.4.0-alpha.5');

    // Guards still dominate: a body that stopped parsing is malformed first.
    expect(
      classifyReleaseIssue({ ...fresh('no structure'), awaitingPublishPosted: true }).kind,
    ).toBe('malformed');
  });

  test('U208: a posted tag-pushed marker means mid-flight resume — proceed despite the cut’s own tag and own draft', () => {
    const resumed = classifyReleaseIssue({
      ...fresh(body('0.4.0-alpha.5', 'both')),
      draftTags: ['v0.4.0-alpha.5'],
      tagPushedPosted: true,
    });
    // Neither refused over its own tag (out-of-order) nor stalled reporting
    // its own in-flight draft (drafts-to-report).
    expect(resumed).toEqual({
      kind: 'proceed',
      spec: { version: '0.4.0-alpha.5', platforms: 'both', changelog: '- Added things.' },
    });

    // A mid-flight `windows` FULL cut resumes as the full cut it is — the
    // append shortcut is only for issues that never pushed a tag themselves.
    const windowsMidFlight = classifyReleaseIssue({
      ...fresh(body('0.4.0-alpha.5', 'windows')),
      tagPushedPosted: true,
    });
    expect(windowsMidFlight.kind).toBe('proceed');
  });

  test('U209: phase markers are pairwise distinct and none contains another, so parseMarkerPresent cannot misfire', () => {
    const markers = [
      MALFORMED_MARKER,
      OUT_OF_ORDER_MARKER,
      DRAFT_REPORT_MARKER,
      PREFLIGHT_ACK_MARKER,
      GATE_PASSED_MARKER,
      PRETAG_CI_GREEN_MARKER,
      CUT_FAILED_MARKER,
      TAG_PUSHED_MARKER,
      CI_GREEN_MARKER,
      DRAFT_VERIFIED_MARKER,
      WINDOWS_APPENDED_MARKER,
      AWAITING_PUBLISH_MARKER,
    ];
    expect(new Set(markers).size).toBe(markers.length);
    for (const a of markers) {
      for (const b of markers) {
        if (a !== b) expect(a.includes(b)).toBe(false);
      }
    }
  });

  test('U214: an active cut-failed parks the release while its bug is open, unknown, or unlinked — never dispatching a sandbox', () => {
    expect(
      classifyReleaseIssue({
        ...fresh(body('0.5.0-alpha.1', 'both')),
        tagPushedPosted: true,
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: true,
      }),
    ).toEqual({ kind: 'parked', bug: 67 });
    // Unknown bug state fails safe: parked.
    expect(
      classifyReleaseIssue({
        ...fresh(body('0.5.0-alpha.1', 'both')),
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: null,
      }).kind,
    ).toBe('parked');
    // Legacy cut-failed with no Blocked-by line: parked with bug null.
    expect(
      classifyReleaseIssue({
        ...fresh(body('0.5.0-alpha.1', 'both')),
        tagPushedPosted: true,
        cutFailedActive: true,
      }),
    ).toEqual({ kind: 'parked', bug: null });
  });

  test('U215: a closed blocking bug un-parks — the cut resumes (proceed), and terminal/guard states still dominate', () => {
    expect(
      classifyReleaseIssue({
        ...fresh(body('0.5.0-alpha.1', 'both')),
        tagPushedPosted: true,
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: false,
      }).kind,
    ).toBe('proceed');
    // Pre-tag failure (no tag pushed): closed bug resumes through the
    // ordering guard as a fresh cut of the same, still-unspent version.
    expect(
      classifyReleaseIssue({
        ...fresh(body('0.5.0-alpha.1', 'both')),
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: false,
      }).kind,
    ).toBe('proceed');
    // awaiting-publish and malformed still outrank parking.
    expect(
      classifyReleaseIssue({
        ...fresh(body('0.5.0-alpha.1', 'both')),
        awaitingPublishPosted: true,
        cutFailedActive: true,
        blockedByBug: 67,
        blockingBugOpen: true,
      }).kind,
    ).toBe('awaiting-publish');
    expect(
      classifyReleaseIssue({
        ...fresh('no structure'),
        cutFailedActive: true,
      }).kind,
    ).toBe('malformed');
  });
});

describe('spec 2026-08-04 §4 failure-flow parsing', () => {
  const comments = (...bodies: string[]) =>
    JSON.stringify({ comments: bodies.map((body) => ({ body })) });

  test('U212: parseBlockedBy reads the Blocked-by line of the newest cut-failed comment only', () => {
    expect(
      parseBlockedBy(
        comments(
          `${CUT_FAILED_MARKER}\n\nold failure\nBlocked-by: #41`,
          `${TAG_PUSHED_MARKER}\n\nretry got further`,
          `${CUT_FAILED_MARKER}\n\nnew failure\nBlocked-by: #67\nmore text`,
        ),
      ),
    ).toBe(67);
    expect(parseBlockedBy(comments(`${CUT_FAILED_MARKER}\n\nno link here`))).toBe(null);
    expect(parseBlockedBy(comments('owner chatter'))).toBe(null);
    expect(parseBlockedBy(JSON.stringify({}))).toBe(null);
  });

  test('U213: releaseOutcome maps the newest phase marker — awaiting-publish ok, cut-failed failed, all else incomplete', () => {
    expect(releaseOutcome(comments(`${AWAITING_PUBLISH_MARKER}\n\ndraft url`)).level).toBe('ok');
    expect(
      releaseOutcome(comments(`${GATE_PASSED_MARKER}\n\n…`, `${CUT_FAILED_MARKER}\n\nE150`)).level,
    ).toBe('failed');
    // A retry that got past its old failure is no longer "failed".
    expect(
      releaseOutcome(
        comments(`${CUT_FAILED_MARKER}\n\nold`, `${PREFLIGHT_ACK_MARKER}\n\nretrying`),
      ).level,
    ).toBe('incomplete');
    expect(releaseOutcome(comments('owner chatter')).level).toBe('incomplete');
    expect(releaseOutcome(JSON.stringify({})).level).toBe('incomplete');
  });
});
