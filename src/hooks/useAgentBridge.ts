// PRD 027 Req 13 (issue #366): the app's wiring of the agent-bridge
// executor — built ONCE from the editor handle refs and the registry
// callbacks the App already owns, then handed to the platform's optional
// `attachAgentBridge` seam (implemented today only by the dev/e2e shim;
// issue #367 adds the hosted transport). Lives outside App.tsx's body so the
// shell gains one hook call, not another block.
import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { EditorSyncHandle, SelectSourceRange, SmartEditHandle } from '@marky-mark/editor';
import type { Platform } from '../platform/types';
import { createBridgeExecutor, type BridgeDocument, type BridgeExecutor } from '../lib/agentBridgeClient';

export interface AgentBridgeHost {
  smartEditRef: MutableRefObject<SmartEditHandle | null>;
  editorSyncRef: MutableRefObject<EditorSyncHandle | null>;
  editorSelectRef: MutableRefObject<SelectSourceRange | null>;
  /** The host's document — path, CANONICAL buffer, dirty flag — read live. */
  document(): BridgeDocument;
  /** Open a path through the command registry (`dispatchRecent`). */
  openFile(path: string): Promise<void>;
  /** The registry's own save handler; `false` when refused. */
  save(): Promise<boolean>;
}

/**
 * PRD 027 Req 13 (issue #366): one executor for the app's lifetime; the
 * host callbacks are read through a ref so the executor never captures a
 * stale render. Attaches to the platform seam when a platform arrives,
 * detaches on unmount or platform change. Returns the executor so the App
 * feeds it every `onEditState` report.
 */
export function useAgentBridge(platform: Platform | null, host: AgentBridgeHost): BridgeExecutor {
  const hostRef = useRef(host);
  hostRef.current = host;
  const [executor] = useState(() =>
    createBridgeExecutor({
      smartEdit: () => hostRef.current.smartEditRef.current,
      editorSync: () => hostRef.current.editorSyncRef.current,
      selectRange: () => hostRef.current.editorSelectRef.current,
      document: () => hostRef.current.document(),
      openFile: (path) => hostRef.current.openFile(path),
      save: () => hostRef.current.save(),
    })
  );
  useEffect(() => platform?.attachAgentBridge?.(executor), [platform, executor]);
  return executor;
}
