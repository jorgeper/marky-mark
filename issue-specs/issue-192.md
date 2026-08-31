# Spec: Management: Invite… and Send are unstyled default buttons — use the app's primary button style (#192)

## Goal

All acceptance criteria in issue-specs/issue-192.md are satisfied for issue #192, with evidence visible in the session: the Invite… button (Management → People), the invite form's Send button, and the workspace picker's invite-row action all carry the app's shared primary/accent button styling from one shared CSS rule; nearby secondary actions remain non-primary; docs/AUTHENTICATION.md § "Adding people" notes that Microsoft's invitation email often lands in spam; and `npm run validate:quick` passes in the implementer's session.

## Acceptance criteria

- A single shared primary-button CSS rule exists in `src/styles.css` (accent-blue styling driven by `var(--mm-accent)` and theme variables — no per-component hard-coded colors), and all three of these buttons resolve to it:
  - the **Invite…** button in Management → People (`data-testid="admin-invite-open"`, `src/components/ManagementPanel.tsx` ~line 348 — currently a bare `<button>` with no class),
  - the invite form's **Send** button (`data-testid="admin-invite-send"` — currently `className="primary"`, which only matches the modal-scoped `.modal .actions button.primary` rule at `src/styles.css:1563`),
  - the picker's invite-row action (`data-testid="membership-picker-invite"`, class `membership-invite` in `src/components/MembershipPicker.tsx` — currently has no CSS rule at all).
- The shared rule is not newly scoped to `.modal .actions`; existing `className="primary"` buttons elsewhere (modals in `App.tsx`, `WorkspaceSwitcher.tsx`, `UpdateDialog.tsx`) keep their current primary appearance — either by consolidating onto the shared rule or by leaving the modal rule intact and consistent with it.
- The styling is theme-variable driven so it reads correctly in light and dark and across the bundled themes in `themes/` (no fixed light-only colors beyond the fallback values already used in `styles.css`, e.g. white text on accent).
- Secondary/neighboring actions (e.g. the close/cancel controls near these buttons, the picker's role `<select>`, `membership-remove`) remain visually non-primary so the action hierarchy still reads.
- `docs/AUTHENTICATION.md` § "Adding people" (heading at line 94) contains one added sentence noting that Microsoft's invitation email often lands in the invitee's spam folder (observed with Gmail), so invitees should be told to check there.
- Affected e2e tests (invite flows live in `tests/e2e/hosted.spec.ts`) are updated as needed, not deleted.
- `npm run validate:quick` passes, run once in the implementer's session right before declaring the goal met (it prints `QUICK VALIDATION: ALL PASSED`). Iterate with `npm run typecheck` and `npm run test:unit` (or a single targeted e2e via `npx playwright test -g '<title>'`) after each change — do not run the full gate repeatedly or as a starting baseline.
- A summary comment from the implementer exists on issue #192.

## Context

Owner feedback from the live deployment (2026-08-31). The root cause is CSS scoping: the app's only primary-button rule is `.modal .actions button.primary` (`src/styles.css:1563`), so `admin-invite-open` (no class) and `membership-picker-invite` (unstyled `membership-invite` class) fall through to browser defaults. The fix is a shared rule (e.g. promote `button.primary` out of the modal scope, or add a `.btn-primary`-style class) applied at all three sites — one rule, per the issue's "one shared rule, not per-component colors". `ManagementPanel` renders as `.modal management-modal`, and the picker rows are styled around `.membership-invite-row` (`src/styles.css:3731`). Citation comments (`// SPEC<n> §x.y` / PRD 017 Req 31–32) mark the invite surfaces; keep them intact. See `.sandcastle/CODING_STANDARDS.md` before writing code.
