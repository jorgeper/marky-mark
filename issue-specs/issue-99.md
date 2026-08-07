# Spec: GitHub App auth layer: installation tokens and a local GitHub API fake (#99)

## Goal

All acceptance criteria in issue-specs/issue-99.md are satisfied for issue #99,
with evidence visible in the session: a server-side GitHub App auth module mints
and caches short-lived installation tokens from an App ID + private key (no PAT
path, and no token, App JWT, or private key ever logged or carried in an error
message), a local fake of the GitHub API (installations, contents, refs,
commits) exists and is the only GitHub any test talks to — `api.github.com`
appears in exactly one source constant and no test reaches the network — new
U-numbered unit tests pin token minting, expiry/refresh and the never-log rule,
`npm run validate:quick` passes in the implementer's session, and a summary
comment from the implementer exists on issue #99.

## Acceptance criteria

### The GitHub App auth module (PRD 010 Req 4)

- A new server module (suggested: `server/providers/github/auth.ts`) exports a
  factory that takes the deployment's GitHub App credentials — App ID and PEM
  private key — plus an injectable `fetch`-shaped function and an API base URL,
  exactly the way `createGraphDirectoryProvider(fetchImpl)` in
  `server/providers/azure/graph.ts` takes its fetch. Constructing it performs no
  I/O (mirrors `createEntraAuthProvider`'s lazy JWKS).
- The module mints a **short-lived App JWT** signed RS256 with the private key:
  `iss` is the App ID, `iat` is backdated a few seconds to tolerate clock skew,
  and `exp` is at most 10 minutes out (GitHub rejects longer). `jose` is already
  a dependency — no new dependency is added for this.
- The module exchanges the App JWT for an **installation token** via
  `POST /app/installations/<id>/access_tokens` and can resolve an installation
  from a repo (`GET /repos/<owner>/<repo>/installation`) and list the App's
  installations (`GET /app/installations`).
- Installation tokens are **cached per installation id and refreshed before
  expiry** with a safety margin (a token within ~60s of `expires_at` is treated
  as expired and re-minted). Two concurrent callers asking for the same
  installation's token while a mint is in flight share one mint rather than
  issuing two — a unit test pins the request count.
- **No PAT, ever.** No code path accepts, reads from the environment, stores, or
  forwards a personal access token or any long-lived repo token; App ID +
  private key are the only credential inputs. A grep-checkable end state: no
  `GITHUB_TOKEN`/`GH_TOKEN`/PAT-shaped credential is read anywhere in `server/`.
- **Never logged.** No `console.*` in the new module; the private key, the App
  JWT, and every installation token are absent from thrown `Error` messages,
  from anything the module returns for diagnostics, and from any object it
  stringifies. GitHub failure responses (401/403/404, rate limit) surface as
  actionable errors naming the status and the operation with the credential
  redacted — consistent with how `server/app.ts` reports API errors today.
- Config carries the credentials without requiring them: `loadConfig` in
  `server/config.ts` gains an **optional** `github` section
  (`MM_GITHUB_APP_ID`, `MM_GITHUB_PRIVATE_KEY`, and an optional
  `MM_GITHUB_API_BASE` defaulting to `https://api.github.com`), parsed when
  present and absent otherwise. Startup does not newly require them and no
  backend selection knob is added — the `blob|github` knob, per-workspace
  backend record, and repo-reachability startup validation are **#101's**, not
  this issue's. A malformed App ID (non-numeric) or an unparsable PEM is
  rejected with an actionable message naming the variable, matching existing
  config strictness — and the message does not echo the key material.
- The PEM value is accepted both with literal newlines and with `\n`-escaped
  newlines (how a PEM survives an App Service app setting).

### The local GitHub API fake (no test reaches github.com)

- A local fake of the GitHub REST API exists in the repo and covers, at minimum,
  the surfaces the issue names: **installations** (`GET /app/installations`,
  `GET /repos/<o>/<r>/installation`, `POST /app/installations/<id>/access_tokens`),
  **contents** (`GET`/`PUT`/`DELETE /repos/<o>/<r>/contents/<path>` with base64
  content, `sha`, and `ref`), **refs** (`GET /repos/<o>/<r>/git/ref/heads/<branch>`),
  and **commits** (`GET /repos/<o>/<r>/commits`). Later sibling issues (#100–#107)
  build on it, so it is seedable with initial repo state and produces
  deterministic SHAs rather than random ones.
- The fake is usable **two ways from one implementation**: as a `fetch`-shaped
  function that can be injected straight into the auth module (and later into
  the storage provider), and mounted on a `node:http` listener so a future e2e
  lane can point a real server process at it. The second form need not be wired
  into `server:local` or `playwright.config.ts` in this issue — only be
  available.
- The fake **enforces the auth contract it is faking**: a request carrying no
  token, a stale/expired installation token, or an App JWT where an installation
  token is required answers 401; a valid, unexpired installation token succeeds.
  Minted tokens carry an `expires_at` the fake honours, so the expiry/refresh
  test above exercises a real rejection rather than a stubbed clock alone. Time
  is injectable (a clock function) so expiry can be tested without sleeping.
- The fake can be told to answer a **rate-limit (403 with rate-limit headers)**
  and a **transient 5xx**, so Req 11's error pathway is testable by later
  issues; this issue only needs the capability plus a test that the auth module
  surfaces such a response as an actionable error rather than a hang or a silent
  retry loop.
- `api.github.com` (or any `github.com` host) appears in **exactly one place** in
  `server/` — the default API base URL constant — and nowhere in `tests/`. Every
  other call site takes the base URL and fetch impl as arguments, the same way
  `blob.ts` is the only importer of `@azure/storage-blob`. This is stated as a
  grep in the implementer's issue comment with its result.
- No test added or changed by this issue performs a network request. The unit
  suite passes with the machine offline.

### Tests and citations

- New unit tests live in `tests/unit/` following the existing server naming
  (`server-azure-providers.test.ts` → suggested `server-github-auth.test.ts` and
  `server-github-fake.test.ts`), titles start with the next unused `U<n>`
  (**the current maximum is U357**, so new tests begin at U358), and `describe`
  blocks name the contract (`describe('PRD 010 Req 4 …')`).
- Unit coverage pins, at minimum: (a) the App JWT's claims and RS256 signature
  verify against the public key with `exp - iat <= 600`; (b) a successful mint
  returns the installation token and it is sent as `Authorization: Bearer` /
  `token` on subsequent installation-scoped calls; (c) a cached token is reused
  — no second `access_tokens` call — until it nears expiry, then is re-minted,
  and the fake accepts the fresh one after rejecting the stale one; (d)
  concurrent requests share one mint; (e) the never-log rule: no `console.*` in
  the module and neither the key, the App JWT, nor the token appears in the
  message of any error the module throws on 401/403/404/rate-limit/5xx paths.
- Every new or changed behaviour carries the citation comment the repo requires
  (`// PRD 010 Req 4: <what and why>`), per `.sandcastle/CODING_STANDARDS.md` §
  Style and `docs/COMMENT-FORMAT.md`.
- **Nothing is wired into the storage seam and no user-visible behaviour
  changes.** `server/providers/index.ts` still returns the same provider kinds
  for `local` and `azure` (U224 keeps passing unchanged), no `StorageProvider`
  implementation is added (that is #100), and `src/` is untouched.
- `server/README.md`'s env-var table lists the new optional variables, so the
  operator reference stays complete. The hosting-guide rewrite is Req 20's, a
  later issue — one table row each here, not a walkthrough.

### Verification

- Iteration used `npm run typecheck` and `npm run test:unit` (or a targeted
  `npx vitest run tests/unit/server-github-*.test.ts`) after each change — not
  the full gate after every edit, and no full-gate baseline at the start of the
  attempt. Baseline with the quick tier only if a baseline is wanted at all.
- `npm run validate:quick` has been run **ONCE**, at the end, in the
  implementer's session, and prints `QUICK VALIDATION: ALL PASSED`.
- A summary comment from the implementer exists on issue #99, naming the new
  module and fake paths, the new U numbers, the single-`api.github.com` grep
  result, and the gate result.

## Context

This is the foundation issue of PRD 010 (`prd/010-github-repo-storage.md`,
parent #97); siblings #100–#107 build the provider, config knob, merge-on-save,
and the BYO wizard on top of it. Keep the blast radius to `server/` +
`tests/unit/`.

Patterns to follow, all already in the tree:

- `server/providers/azure/graph.ts` + `tests/unit/server-azure-providers.test.ts`
  (U227) — the injectable-`fetch` provider and how it is tested with a stub
  `fetch` returning a `Response`. This is the exact shape the GitHub client and
  its fake should take.
- `server/providers/azure/entra.ts` — lazy construction, `jose` usage, and
  "verified by typecheck + unit tests only, no cloud calls in CI".
- `server/config.ts` / `loadConfig` — env parsing is pure with no I/O and throws
  actionable messages naming every offending variable at once; unit-pinned in
  `tests/unit/server-config.test.ts`.
- `server/providers/types.ts` — the `StorageProvider` seam this issue
  deliberately does **not** touch yet.

Gotchas worth knowing before you start:

- GitHub App private keys download as **PKCS#1** PEM (`BEGIN RSA PRIVATE KEY`).
  `jose`'s `importPKCS8` will not parse those. `node:crypto`'s
  `createPrivateKey` handles PKCS#1 and PKCS#8 alike and its `KeyObject` is
  accepted by `jose`'s `SignJWT.sign` — go through `createPrivateKey`, and let
  the unit test generate a keypair with `generateKeyPairSync('rsa', …)`.
- The server runs under plain `node server/index.ts` (native type stripping),
  so new server imports keep the explicit `.ts` extension, like every existing
  one.
- `docs/MAP.md` is generated from `src/` and `tests/e2e/` only — a server-only
  change should leave it untouched, so `npm run map` is not part of this issue.
- The unit suite runs with `isolate: false` (`vitest.config.ts`): tests must not
  depend on per-file module isolation or leak global state (e.g. a patched
  `globalThis.fetch`). Inject the fake; do not monkey-patch.
