import {
  DEFAULT_FLUID_EFFECTS,
  FLUID_ACTION_LABELS,
  FLUID_ACTIONS,
  FLUID_EFFECT_LABELS,
  type FluidAction,
  type FluidEffect,
  type FluidEffectMap,
  fluidEffectsFor,
  isFluidEffect,
  isFluidEffectApplicable,
} from '@marky-mark/editor';
import { SectionHeader } from './ui/SectionHeader';

/**
 * PRD 025 Reqs 4+5: the Fluid mode page — the Experimental row's nested
 * settings, fed by `values` + `onChange(patch)` exactly like the LLM
 * providers page so the dialog's pinned Save / Cancel footer governs it
 * (issue #246: nothing here writes live).
 */
export interface FluidSettingsProps {
  /** PRD 025 Req 5: the (pending) mapping the four pickers show. */
  values: { fluidEffects: FluidEffectMap };
  /** Issue #246: a pending edit, committed by the dialog's Save. */
  onChange(patch: { fluidEffects: FluidEffectMap }): void;
}

export function FluidSettings({ values, onChange }: FluidSettingsProps) {
  const pick = (action: FluidAction, raw: string) => {
    // PRD 025 Req 7: the picker only ever offers None plus the effects the
    // table ticks for this action, so the value is one of those by
    // construction; anything else (an impossible programmatic value) lands on
    // the action's default rather than an inapplicable name. Same guards as
    // the settings parser, so the two never disagree on what is admissible.
    let next: FluidEffect | 'none' = DEFAULT_FLUID_EFFECTS[action];
    if (raw === 'none') next = 'none';
    else if (isFluidEffect(raw) && isFluidEffectApplicable(action, raw)) next = raw;
    onChange({ fluidEffects: { ...values.fluidEffects, [action]: next } });
  };

  return (
    <>
      <SectionHeader>Effects</SectionHeader>
      <p className="hotkey-hint experimental-desc fluid-page-hint" data-testid="fluid-page-hint">
        Choose what each editor action does. Effects are purely visual: the document, the selection and the cursor
        change instantly, and the effect is drawn afterwards.
      </p>
      {/* PRD 025 Req 5: exactly four rows, in this order, one picker each. */}
      {FLUID_ACTIONS.map((action) => (
        <div className="field fluid-row" key={action}>
          <label htmlFor={`fluid-pick-${action}`}>{FLUID_ACTION_LABELS[action]}</label>
          <select
            id={`fluid-pick-${action}`}
            className="field"
            data-testid={`fluid-pick-${action}`}
            value={values.fluidEffects[action]}
            onChange={(e) => pick(action, e.target.value)}
          >
            {/* PRD 025 Req 5: None first, then the applicable effects (Req 7). */}
            <option value="none">None</option>
            {fluidEffectsFor(action).map((effect) => (
              <option value={effect} key={effect}>
                {FLUID_EFFECT_LABELS[effect]}
              </option>
            ))}
          </select>
        </div>
      ))}
    </>
  );
}
