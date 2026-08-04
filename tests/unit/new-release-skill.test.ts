import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { parseReleaseIssueBody } from '../../.sandcastle/release-lane.mts';

// prd/008 R3 drift guard: /new-release files bodies built from the template
// embedded in its SKILL.md. This test builds a body the same way — read the
// fenced template, substitute the placeholders — and holds it to the one
// parser, so the skill and parseReleaseIssueBody cannot drift apart silently.
const template = (() => {
  const source = readFileSync(
    fileURLToPath(new URL('../../.claude/skills/new-release/SKILL.md', import.meta.url)),
    'utf8',
  );
  const fence = source.match(/```release-issue-body\r?\n([\s\S]*?)```/);
  if (!fence) throw new Error('SKILL.md lost its ```release-issue-body fenced template');
  return fence[1];
})();

const fill = (version: string, platforms: string, changelog: string) =>
  template
    .replace('{{VERSION}}', version)
    .replace('{{PLATFORMS}}', platforms)
    .replace('{{CHANGELOG}}', changelog);

describe('PRD 008 §R3 /new-release body template', () => {
  test('U210: a body built from the embedded template parses ok with every field verbatim', () => {
    expect(
      parseReleaseIssueBody(fill('0.4.0-alpha.6', 'both', '- Fixed the sidebar.\n- Faster startup.')),
    ).toEqual({
      ok: true,
      spec: {
        version: '0.4.0-alpha.6',
        platforms: 'both',
        changelog: '- Fixed the sidebar.\n- Faster startup.',
      },
    });

    // A full release (no pre-release id) and each remaining platform parse too.
    for (const platforms of ['mac', 'windows'] as const) {
      const parsed = parseReleaseIssueBody(fill('1.0.0', platforms, '- One entry.'));
      expect(parsed.ok && parsed.spec.platforms).toBe(platforms);
    }
  });

  test('U211: the template carries exactly the three placeholders, once each', () => {
    const placeholders = (template.match(/\{\{[A-Z]+\}\}/g) ?? []).sort();
    expect(placeholders).toEqual(['{{CHANGELOG}}', '{{PLATFORMS}}', '{{VERSION}}']);
  });
});
