import { useEffect, useRef, useState } from 'react';
import {
  canRemoveLlmKey,
  canTestConnection,
  LLM_PROVIDER_KINDS,
  LLM_PROVIDERS,
  llmAreaState,
  testFailureMessage,
  type LlmCapabilities,
  type LlmSettingsValues,
  type LlmTestResult,
} from '../lib/llmSettings';
import {
  offersSummaryCacheSection,
  summaryCacheIsShared,
  summaryCacheReport,
  SUMMARY_CACHE_CLEAR_FAILED,
  SUMMARY_CACHE_SHARED_NOTE,
  SUMMARY_CACHE_UNREADABLE_MESSAGE,
  type SummaryCacheClearResult,
  type SummaryCacheSizeResult,
} from '../lib/summaryCacheReport';
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
  /**
   * PRD 011 Reqs 9+30: did the window holding the platform reach a
   * `SummaryCacheStore`? A CAPABILITY, not a flavor — false draws no Summary
   * cache section at all rather than a dead size line and a disabled button.
   */
  summaryCacheAvailable?: boolean;
  /**
   * PRD 011 Req 30: read what the cache holds. A store read, never an LLM
   * request. Supplied by whichever window holds the store — the main window
   * inline, or the aux window's round trip over the bus.
   */
  onCacheSize?: () => Promise<SummaryCacheSizeResult>;
  /**
   * PRD 011 Req 30: clear the store AND the session memo behind it, in one
   * action. Supplied by the same window, because dropping the memo is half of
   * what makes a cleared cache really empty.
   */
  onCacheClear?: () => Promise<SummaryCacheClearResult>;
}

/** PRD 011 Req 10: the action's own state — idle until the user clicks. */
type TestState = { phase: 'idle' } | { phase: 'running' } | { phase: 'done'; result: LlmTestResult };

/**
 * PRD 011 Req 30: what the Summary cache section shows right now. `reading` is
 * the state the page opens in; a refused read and a refused clear are states of
 * their own, so neither can be mistaken for an empty cache.
 */
type CacheState =
  | { phase: 'reading' }
  | { phase: 'size'; report: string }
  | { phase: 'error'; message: string };

/** The one line the section shows for the state it is in — one sentence each. */
function cacheSentence(state: CacheState): string {
  switch (state.phase) {
    case 'reading':
      return 'Reading the cache…';
    case 'size':
      return state.report;
    case 'error':
      return state.message;
  }
}

export function LlmSettings({
  values,
  capabilities,
  onChange,
  onTest,
  summaryCacheAvailable,
  onCacheSize,
  onCacheClear,
}: Props) {
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

  // --- PRD 011 Req 30: the Summary cache section -----------------------------
  const [cache, setCache] = useState<CacheState>({ phase: 'reading' });
  const [clearing, setClearing] = useState(false);
  const [clearFailure, setClearFailure] = useState<string | null>(null);
  // PRD 011 Req 9: whether the section exists at all is the pure rule's answer,
  // over the capability this window was handed and the area state.
  const cacheOffered = offersSummaryCacheSection(area, summaryCacheAvailable === true);
  // The reader supplies a fresh closure on every render of the mount point;
  // holding it in a ref keeps the read below a mount-time effect rather than
  // something that re-fires on each render (PRD 011 Req 16 — no polling).
  const sizeRef = useRef(onCacheSize);
  sizeRef.current = onCacheSize;

  const readCacheSize = () => {
    const read = sizeRef.current;
    if (!read) {
      setCache({ phase: 'error', message: SUMMARY_CACHE_UNREADABLE_MESSAGE });
      return;
    }
    setCache({ phase: 'reading' });
    void read().then(
      (result) => {
        if (!live.current) return;
        setCache(
          result.ok
            ? { phase: 'size', report: summaryCacheReport(result.size) }
            : { phase: 'error', message: result.message }
        );
      },
      () => {
        if (live.current) setCache({ phase: 'error', message: SUMMARY_CACHE_UNREADABLE_MESSAGE });
      }
    );
  };

  /**
   * PRD 011 Req 30: read when the page is SHOWN, and never again on a timer.
   * The only other read is the one after a successful clear, below.
   */
  useEffect(() => {
    if (cacheOffered) readCacheSize();
  }, [cacheOffered]);

  /**
   * PRD 011 Req 30: one click clears. It issues no LLM request of its own and
   * starts no run — it clears the store, and the handler the mount point
   * supplied drops the session memo with it. A refusal is reported in place and
   * the displayed size is left exactly as it was, because nothing was deleted.
   */
  const clearCache = () => {
    if (!onCacheClear || clearing) return;
    setClearing(true);
    setClearFailure(null);
    void onCacheClear().then(
      (result) => {
        if (!live.current) return;
        setClearing(false);
        if (result.ok) readCacheSize();
        else setClearFailure(result.message);
      },
      () => {
        // A broken bus, not a refusal the store reported — but the reader's
        // question is the same one, so it gets the answer about the CLEAR
        // ("nothing was deleted"), never the read failure's sentence.
        if (!live.current) return;
        setClearing(false);
        setClearFailure(SUMMARY_CACHE_CLEAR_FAILED);
      }
    );
  };

  const cacheSection = cacheOffered && (
    <>
      <h3 className="tab-section">Summary cache</h3>
      <p className="hotkey-hint" data-testid="summary-cache-size">
        {cacheSentence(cache)}
      </p>
      {/* PRD 011 Req 30: on hosted the cache is the workspace's, so what Clear
          throws away is said before the click rather than after it. */}
      {summaryCacheIsShared(area) && (
        <p className="hotkey-hint" data-testid="summary-cache-shared">
          {SUMMARY_CACHE_SHARED_NOTE}
        </p>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <button data-testid="summary-cache-clear" disabled={!onCacheClear || clearing} onClick={clearCache}>
          {clearing ? 'Clearing…' : 'Clear cache'}
        </button>
        {clearFailure && (
          <span className="hotkey-hint" data-testid="summary-cache-clear-failure">
            {clearFailure}
          </span>
        )}
      </div>
    </>
  );

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
        {/* PRD 011 Req 30: hosted has no key field, but it does have a cache. */}
        {cacheSection}
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
        {/* PRD 011 Req 3: one click takes the key out, through the ordinary
            settings-edit path — no second persistence route, and nothing
            workspace-scoped. It is disabled when there is nothing to remove, so
            it can never claim to have removed something it did not, and it says
            NOTHING about the key's value (PRD 011 Req 7). It does not touch the
            cache: the two stand-down actions are separate, one click each. */}
        {canRemoveLlmKey(area) && (
          <div className="row" style={{ marginBottom: 12 }}>
            <button
              data-testid="llm-remove-key"
              disabled={values.llmApiKey === ''}
              title={values.llmApiKey === '' ? 'No key is stored.' : undefined}
              onClick={() => onChange({ llmApiKey: '' })}
            >
              Remove key
            </button>
          </div>
        )}
      </div>

      {availability}
      {testButton}
      {cacheSection}
    </>
  );
}
