import { useEffect, useId, useState } from 'react';
import type { AgentControl as AgentControlSeam, AgentControlState } from '../platform/types';

/** PRD 027 Req 10 (issue #367): the words that make the opt-in unmistakable. */
export const AGENT_CONTROL_LABEL = 'Agent control';
export const AGENT_CONTROL_INDICATOR = 'An agent can read and edit this session';

/**
 * PRD 027 Req 9+10 (issue #367): the agent-control toggle and its persistent
 * indicator — hosted chrome, outside the Settings panel, rendered by App only
 * when the platform offers the `agentControl` seam AND the applied
 * `agentBridge` setting is on. The switch is checked exactly while the
 * channel is `'on'`; while it is, the indicator reads beside it in every
 * document mode with no hover or reveal gesture (it rides the fixed
 * bottom-right corner stack, never the auto-hiding toolbar). When another
 * tab takes over or the channel closes, the seam reports `'off'` and both
 * the check and the indicator go with no user action.
 */
export function AgentControl({ control }: { control: AgentControlSeam }) {
  const [state, setState] = useState<AgentControlState>('off');
  useEffect(() => control.subscribe(setState), [control]);
  const id = useId();
  const on = state === 'on';
  return (
    <div className="agent-control" data-testid="agent-control" data-state={state}>
      <input
        id={id}
        className="agent-control-switch"
        type="checkbox"
        role="switch"
        data-testid="agent-control-toggle"
        checked={on}
        aria-checked={on}
        onChange={() => (state === 'off' ? control.enable() : control.disable())}
      />
      <label className="agent-control-label" htmlFor={id}>
        {AGENT_CONTROL_LABEL}
      </label>
      {on && (
        <span className="agent-control-indicator" data-testid="agent-control-indicator" role="status">
          {AGENT_CONTROL_INDICATOR}
        </span>
      )}
    </div>
  );
}
