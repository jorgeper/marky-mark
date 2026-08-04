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
  parseDraftTags,
  parseMarkerPresent,
  parseReleaseIssueBody,
  parseTagNames,
  PREFLIGHT_ACK_MARKER,
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
    });
    expect(equal.kind).toBe('out-of-order');

    const newer = classifyReleaseIssue({
      body: body('0.4.0-alpha.6'),
      tagNames: TAGS,
      draftTags: [],
      draftReportPosted: false,
      awaitingPublishPosted: false,
      tagPushedPosted: false,
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
});
