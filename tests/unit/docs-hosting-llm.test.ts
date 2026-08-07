import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { LLM_ENV_VARS, loadConfig } from '../../server/config.ts';

// PRD 011 Req 8: the drift guard for the LLM section of BOTH operator hosting
// guides, mirroring U478/U479 (tests/unit/docs-hosting-github.test.ts) so the
// Azure guide is covered too. Every claim here is read out of the documents and
// checked against the code, so neither guide can rot while the configuration
// moves — and neither can invent a variable the loader does not read.

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const GUIDES = [
  ['docs/HOSTING-AZURE.md', read('../../docs/HOSTING-AZURE.md')],
  ['docs/HOSTING-GITHUB.md', read('../../docs/HOSTING-GITHUB.md')],
] as const;

/** Every `MM_*` variable `server/config.ts` really reads. */
const configSource = read('../../server/config.ts');
const variablesInCode = [...new Set(configSource.match(/\bMM_[A-Z_]*[A-Z]\b/g) ?? [])].sort();

describe('PRD 011 Req 8 the LLM section in the operator hosting guides', () => {
  test('U536: both guides document every LLM variable the loader reads, and invent none', () => {
    for (const [path, guide] of GUIDES) {
      // The loader's own list, not a hand-copied one: adding a knob to
      // LLM_ENV_VARS fails here until both guides gain a row for it.
      for (const name of LLM_ENV_VARS) {
        expect(guide, `${name} is read by server/config.ts but missing from ${path}`).toContain(name);
        // A row, not a passing mention: name, default, required/optional, meaning.
        expect(guide, `${name} is named in ${path} but not in a table row`).toMatch(
          new RegExp(`^\\|\\s*\`${name}\`\\s*\\|.*\\|.*\\|.*\\S.*\\|`, 'm'),
        );
      }
      // …and the other direction, for every `MM_*` in the document: no guide
      // names a variable that exists only in prose.
      for (const name of guide.match(/\bMM_[A-Z_]*[A-Z]\b/g) ?? []) {
        expect(variablesInCode, `${name} is named in ${path} but read nowhere in server/config.ts`).toContain(name);
      }
    }
  });

  test('U537: both guides state the credential is the operator’s, deployment-wide, and optional', () => {
    for (const [path, guide] of GUIDES) {
      const at = guide.indexOf("### The deployment's LLM provider");
      expect(at, `${path} has no LLM section`).toBeGreaterThanOrEqual(0);
      // Unwrapped, so a sentence's claim does not depend on where it broke.
      const section = guide.slice(at).replace(/\s+/g, ' ');
      // One credential, shared by everyone in this deployment, never shown to a
      // member and not changeable by one.
      expect(section, path).toContain("**The key is deployment-wide, and it is yours, not your members'.**");
      expect(section, path).toContain('never shown to a member and cannot be changed by one');
      // Leaving it unset simply means no LLM features — and that really is what
      // the loader does with an empty environment.
      expect(section, path).toContain('Set none of these four and the deployment starts exactly as it does today');
    }
    expect(loadConfig({}).llm).toBeUndefined();
  });

  test('U538: the refusals and the startup line the guides quote are the ones the code produces', () => {
    const quoted: [Record<string, string>, string][] = [
      [{ MM_LLM_PROVIDER: 'openai' }, 'LLM configuration is incomplete, missing: MM_LLM_MODEL, MM_LLM_API_KEY'],
      [
        { MM_LLM_PROVIDER: 'gpt5', MM_LLM_MODEL: 'm', MM_LLM_API_KEY: 'k' },
        "MM_LLM_PROVIDER must be one of openai, anthropic, gemini, openrouter, custom, got 'gpt5'",
      ],
      [
        { MM_LLM_PROVIDER: 'custom', MM_LLM_MODEL: 'm', MM_LLM_API_KEY: 'k' },
        'MM_LLM_PROVIDER=custom requires environment variables: MM_LLM_BASE_URL',
      ],
    ];
    for (const [env, message] of quoted) {
      expect(() => loadConfig(env), message).toThrowError(message);
      for (const [path, guide] of GUIDES) expect(guide, `${path} does not quote: ${message}`).toContain(message);
    }
    // The startup line both guides promise is the one server/index.ts builds
    // out of the parsed config — kind and model, and nothing else.
    const config = loadConfig({ MM_LLM_PROVIDER: 'openai', MM_LLM_MODEL: 'gpt-4o-mini', MM_LLM_API_KEY: 'sk-secret' });
    for (const [path, guide] of GUIDES) {
      expect(guide, path).toContain(`llm=${config.llm!.kind}:${config.llm!.model}`);
      expect(guide, path).toContain('llm=none');
    }
    expect(read('../../server/index.ts')).toContain('llm=${config.llm ? `${config.llm.kind}:${config.llm.model}`');
  });

  test('U539: no log line anywhere in server/ can carry the key', () => {
    // PRD 011 Req 7: static, and therefore total — every `console.*` in the
    // server tree, checked for the one field that must never reach a log.
    const root = fileURLToPath(new URL('../../server', import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const source = readFileSync(`${root}/${file}`, 'utf8');
      for (const call of source.match(/console\.\w+\([\s\S]*?\n?.*?\);/g) ?? []) {
        expect(call, `server/${file} logs a key`).not.toMatch(/apiKey|MM_LLM_API_KEY/);
      }
    }
  });
});
