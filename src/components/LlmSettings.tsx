import { useEffect, useRef, useState } from 'react';
import {
  canTestConnection,
  LLM_PROVIDER_KINDS,
  LLM_PROVIDERS,
  llmAreaState,
  testFailureMessage,
  type LlmCapabilities,
  type LlmSettingsValues,
  type LlmTestResult,
} from '../lib/llmSettings';
import type { LlmProviderKind } from '../lib/llmSeam';

/**
 * PRD 011 Reqs 4+5+6+7+9+10: the LLM providers settings page. It is the
 * Settings window's own tab — not a row bolted onto General — and it is
 * written for LLM configuration in general: it names no single consumer,
 * renders no zoom control, and imports nothing from the semantic-zoom modules.
 *
 * Every rule it renders comes from `lib/llmSettings.ts`; this file decides
 * nothing on its own beyond which inputs to draw. In particular:
 *
 *  - PRD 011 Req 9: it branches on the Platform CAPABILITIES it is handed
 *    (`transport`, `hosted`), never on a flavor, and it offers no control that
 *    cannot work — with no LLM path it renders the sentence and nothing else,
 *    and on hosted the key field does not exist.
 *  - PRD 011 Req 10: it never calls `runLlmRequest`, never reads
 *    `platform.llmTransport` and never invokes an IPC command. `onTest` is
 *    supplied by whichever window actually holds the capability; in the desktop
 *    aux window that is a round trip to the main window over the bus.
 *  - PRD 011 Req 7: the key is a password input and its value is rendered
 *    nowhere else — no title, no hint, no scope note, no notice, no log.
 */
interface Props {
  /** The four persisted values (PRD 011 Req 7). */
  values: LlmSettingsValues;
  /** PRD 011 Req 9: what the capability-holding window can do. */
  capabilities: LlmCapabilities;
  /** Write the changed keys to the settings layer this panel targets. */
  onChange(patch: Partial<LlmSettingsValues>): void;
  /**
   * PRD 011 Req 10: run exactly one `trigger: 'test-connection'` request.
   * Absent when no window offered one, which is the same "cannot work" answer
   * as an unavailable area: the action is then disabled with its reason.
   */
  onTest?: () => Promise<LlmTestResult>;
}

/** PRD 011 Req 10: the action's own state — idle until the user clicks. */
type TestState = { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; result: LlmTestResult };

export function LlmSettings({ values, capabilities, onChange, onTest }: Props) {
  const [test, setTest] = useState<TestState>({ phase: 'idle' });
  // A result that lands after the panel closed must not set state on a dead
  // component; the round trip through the main window is genuinely async.
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const area = llmAreaState(capabilities, values);
  const presets = LLM_PROVIDERS[values.llmProvider].models;
  // The preset dropdown mirrors the free-text field: a typed id the curated
  // list does not have simply shows as the custom entry (PRD 011 Req 6 — no
  // validation rejects an id for being absent from the list).
  const presetValue = presets.includes(values.llmModel) ? values.llmModel : '';

  const runTest = () => {
    if (!onTest) return;
    setTest({ phase: 'running' });
    // PRD 011 Req 10: exactly one request per click, and the result is the
    // seam's own — already redacted — so nothing here builds a sentence per
    // failure kind or renders raw provider text.
    void onTest().then(
      (result) => {
        if (live.current) setTest({ phase: 'done', result });
      },
      () => {
        // The host promise is not expected to reject (the seam answers a typed
        // failure instead), but a broken bus must not leave a stuck spinner.
        if (live.current) setTest({ phase: 'idle' });
      }
    );
  };

  // Every branch below opens with this; they differ only in which controls the
  // capability makes it honest to draw.
  const heading = <h3 className="tab-section">LLM provider</h3>;
  const availability = (
    <p className="hotkey-hint" data-testid="llm-availability">
      {area.message}
    </p>
  );

  // PRD 011 Req 9: no LLM path at all — the sentence, and not one control.
  if (area.state === 'no-path') {
    return (
      <>
        {heading}
        {availability}
      </>
    );
  }

  const testable = canTestConnection(area) && onTest !== undefined;
  const testButton = (
    <div className="row" style={{ marginBottom: 12 }}>
      <button
        data-testid="llm-test"
        disabled={!testable || test.phase === 'running'}
        // The reason it cannot run is the availability sentence itself — never
        // a second wording, and never anything derived from the key.
        title={testable ? undefined : area.message}
        onClick={runTest}
      >
        {test.phase === 'running' ? 'Testing…' : 'Test connection'}
      </button>
      {test.phase === 'done' && (
        <span className="hotkey-hint" data-testid="llm-test-result">
          {test.result.ok
            ? 'Connection succeeded.'
            : `${test.result.failure.kind}: ${testFailureMessage(test.result.failure)}`}
        </span>
      )}
    </div>
  );

  // PRD 011 Req 8+9: hosted. The credential is the operator's, so there is no
  // key field to render and the provider/model are read-only facts.
  if (area.state === 'hosted' || area.state === 'operator-unconfigured') {
    return (
      <>
        {heading}
        {availability}
        {area.state === 'hosted' && (
          <div className="field">
            <label>Provider and model</label>
            <p className="hotkey-hint" data-testid="llm-hosted-provider">
              {`${LLM_PROVIDERS[area.provider].label} — ${area.model}`}
            </p>
          </div>
        )}
        {testButton}
      </>
    );
  }

  return (
    <>
      {heading}
      <div className="field">
        <label htmlFor="llm-provider">Provider</label>
        <select
          id="llm-provider"
          data-testid="llm-provider"
          value={values.llmProvider}
          onChange={(e) => onChange({ llmProvider: e.target.value as LlmProviderKind })}
        >
          {/* PRD 011 Req 5: exactly the seam's five kinds, and no sixth. */}
          {LLM_PROVIDER_KINDS.map((kind) => (
            <option value={kind} key={kind}>
              {LLM_PROVIDERS[kind].label}
            </option>
          ))}
        </select>
      </div>

      {values.llmProvider === 'custom' && (
        <div className="field">
          <label htmlFor="llm-base-url">Base URL (OpenAI-compatible endpoint)</label>
          <input
            id="llm-base-url"
            type="text"
            data-testid="llm-base-url"
            placeholder="https://llm.example.com/v1"
            value={values.llmBaseUrl}
            onChange={(e) => onChange({ llmBaseUrl: e.target.value })}
          />
        </div>
      )}

      <div className="field">
        <label htmlFor="llm-model">Model</label>
        <div className="inline-row">
          {presets.length > 0 && (
            <select
              id="llm-model-preset"
              data-testid="llm-model-preset"
              value={presetValue}
              onChange={(e) => e.target.value && onChange({ llmModel: e.target.value })}
            >
              <option value="">Known-good models…</option>
              {presets.map((m) => (
                <option value={m} key={m}>
                  {m}
                </option>
              ))}
            </select>
          )}
          <input
            id="llm-model"
            type="text"
            data-testid="llm-model"
            // PRD 011 Req 6: free text wins — any id the provider accepts can
            // be typed, and nothing rejects it for being off the list.
            placeholder="or type any model id"
            value={values.llmModel}
            onChange={(e) => onChange({ llmModel: e.target.value })}
          />
        </div>
      </div>

      <h3 className="tab-section">Credential</h3>
      <div className="field">
        <label htmlFor="llm-api-key">API key</label>
        <input
          id="llm-api-key"
          // PRD 011 Req 7: masked. The value is never rendered anywhere else.
          type="password"
          data-testid="llm-api-key"
          autoComplete="off"
          spellCheck={false}
          value={values.llmApiKey}
          onChange={(e) => onChange({ llmApiKey: e.target.value })}
        />
        <p className="hotkey-hint">
          Stored with your personal settings on this machine. It is never written to a workspace file, so it cannot be
          committed or shared by opening a workspace.
        </p>
      </div>

      {availability}
      {testButton}
    </>
  );
}
