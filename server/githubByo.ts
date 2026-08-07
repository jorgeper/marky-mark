// PRD 010 Req 2+4+16: the small server surface the connect-your-GitHub-repo
// wizard reads GitHub through. EVERY GitHub call in the flow is made here,
// with the deployment's App credentials; the client only ever talks to this
// app's own origin, so no GitHub host string appears in `src/` at all.
//
// The surface is exactly what the wizard's steps need and no more:
//
//   GET  /api/github/byo            — is connecting a repo available at all?
//   POST /api/github/byo/session    — start a wizard session; answer the URL
//                                     to send the admin to for the install
//   POST /api/github/byo/return     — resolve GitHub's return into that session
//   GET  /api/github/byo/repos      — the session's installation's repos
//   GET  /api/github/byo/branches   — one repo's branches + default branch
//
// PRD 010 Req 2: enumeration is bounded. No route hands a signed-in caller
// the deployment's installation list, or any repo list they did not just
// complete a round trip for: repos and branches are answerable only for the
// installation named by the caller's OWN wizard session, and asking for
// another one is a named 403. The deployment's installations are read only to
// confirm the one GitHub just returned, and only that one is ever described
// back.
//
// PRD 010 Req 11: GitHub failures surface through `githubFailureDetail`'s
// vocabulary as actionable messages. No credential, App JWT or installation
// token is logged or returned — nothing here even holds one.

import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readBody, sendJson } from './http.ts';
import { githubFailureDetail, type GitHubAppAuth } from './providers/github/auth.ts';
import type { RequestAuth } from './providers/types.ts';

/** The route prefix this module owns. */
export const GITHUB_BYO_PREFIX = '/api/github/byo';

/**
 * PRD 010 Req 16: a wizard session — one admin's round trip out to GitHub and
 * back. It is the ONLY thing that can name an installation to this API, so it
 * records who started it and, once the return is resolved, which installation
 * it is allowed to read.
 */
interface WizardSession {
  /** The signed-in user who started it; nobody else may use it. */
  userId: string;
  createdAtMs: number;
  installationId?: number;
}

/**
 * A session outlives the trip to GitHub's consent page and a slow admin, and
 * no longer: an hour is generous for a form and short enough that an
 * abandoned session is not a permanent grant.
 */
const SESSION_TTL_MS = 60 * 60 * 1000;

/** Bounded so an abandoned session cannot grow the process without limit. */
const MAX_SESSIONS = 500;

export interface GitHubByoOptions {
  /** The deployment's App auth, or undefined when there is no App section. */
  auth?: GitHubAppAuth;
  /** The App's URL slug; without it no install URL can be built. */
  appSlug?: string;
  /** Web host the install URL is built on. */
  webBase?: string;
  /** Injected clock (epoch ms) so session expiry is testable without sleeping. */
  now?: () => number;
  /** Injected id source; the default is a random UUID per session. */
  newSessionId?: () => string;
}

export interface GitHubByo {
  /** PRD 010 Req 15: whether the deployment can connect a repo at all. */
  availability(): { available: boolean; reason?: string };
  /** Handle a request under {@link GITHUB_BYO_PREFIX}. */
  handle(req: IncomingMessage, res: ServerResponse, url: URL, auth: RequestAuth): Promise<void>;
}

/** One repo of an installation, as the wizard's pick-repo step needs it. */
interface RepoOption {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
}

/** What GitHub's `/installation/repositories` answers, in the parts read. */
interface RepositoriesBody {
  repositories?: {
    name?: unknown;
    full_name?: unknown;
    default_branch?: unknown;
    owner?: { login?: unknown };
    permissions?: { push?: unknown };
  }[];
}

/**
 * PRD 010 Req 16: the reason the choice is unavailable, phrased for an admin
 * looking at the New Workspace dialog — one line naming what the deployment
 * is missing, never a dead end and never a 500.
 */
const NO_APP =
  'This deployment has no GitHub App configured, so a repository cannot be connected. ' +
  'Ask an operator to set MM_GITHUB_APP_ID and MM_GITHUB_PRIVATE_KEY.';
const NO_SLUG =
  'This deployment’s GitHub App has no install URL configured, so a repository cannot be connected. ' +
  'Ask an operator to set MM_GITHUB_APP_SLUG.';

/**
 * PRD 010 Req 11: a failed GitHub response becomes an actionable message and
 * a status that says whose fault it is — GitHub blaming the request is a 400,
 * GitHub itself failing is a 502. Only the status and GitHub's own short
 * message are read; no header and no body dump.
 */
async function failure(res: ServerResponse, response: Response, what: string): Promise<void> {
  const detail = await githubFailureDetail(response, 'nothing was created');
  sendJson(res, response.status >= 500 ? 502 : 400, { error: `${what}: ${detail}` });
}

/** The same, for a thrown {@link GitHubApiError} from an App-level call. */
function thrownFailure(res: ServerResponse, err: unknown): void {
  const status = (err as { status?: unknown } | null)?.status;
  sendJson(res, typeof status === 'number' && status >= 500 ? 502 : 400, { error: (err as Error).message });
}

export function createGitHubByo(options: GitHubByoOptions = {}): GitHubByo {
  const { auth: appAuth, appSlug, webBase } = options;
  const now = options.now ?? Date.now;
  const newSessionId = options.newSessionId ?? (() => randomUUID());
  const sessions = new Map<string, WizardSession>();

  const availability = (): { available: boolean; reason?: string } => {
    if (!appAuth) return { available: false, reason: NO_APP };
    if (!appSlug || !webBase) return { available: false, reason: NO_SLUG };
    return { available: true };
  };

  /** Expired sessions are dropped lazily — there is no timer to leak. */
  const sweep = (): void => {
    const cutoff = now() - SESSION_TTL_MS;
    for (const [id, session] of sessions) {
      if (session.createdAtMs < cutoff) sessions.delete(id);
    }
    while (sessions.size >= MAX_SESSIONS) {
      const oldest = sessions.keys().next();
      if (oldest.done) break;
      sessions.delete(oldest.value);
    }
  };

  /**
   * PRD 010 Req 2: the caller's own session, or the named refusal. A session
   * another user started, one this process never issued (a restarted server,
   * a stale tab) and an expired one are all 404 — the wizard turns that into
   * a clean restart, and none of them leaks whether the id exists.
   */
  const sessionFor = (
    url: URL,
    user: string,
  ): { ok: true; id: string; session: WizardSession } | { ok: false; status: number; error: string } => {
    const id = url.searchParams.get('session') ?? '';
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.userId !== user || session.createdAtMs < now() - SESSION_TTL_MS) {
      return {
        ok: false,
        status: 404,
        error: 'That connection is no longer in progress — start connecting a repository again.',
      };
    }
    return { ok: true, id, session };
  };

  /**
   * PRD 010 Req 2: an installation is readable ONLY through the session that
   * completed the round trip for it. A caller naming any other installation —
   * including a real one belonging to another admin — is refused by name
   * rather than served.
   */
  const installationFor = (
    url: URL,
    session: WizardSession,
  ): { ok: true; id: number } | { ok: false; status: number; error: string } => {
    if (session.installationId === undefined) {
      return {
        ok: false,
        status: 409,
        error: 'This connection has not come back from GitHub yet — install the app first.',
      };
    }
    const asked = url.searchParams.get('installation');
    if (asked !== null && Number(asked) !== session.installationId) {
      return {
        ok: false,
        status: 403,
        error: 'That installation is not the one this connection was started for.',
      };
    }
    return { ok: true, id: session.installationId };
  };

  const readJson = async (req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | undefined> => {
    try {
      const body = (await readBody(req)) || '{}';
      const parsed = JSON.parse(body) as unknown;
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an object');
      return parsed as Record<string, unknown>;
    } catch {
      sendJson(res, 400, { error: 'malformed JSON body' });
      return undefined;
    }
  };

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, auth: RequestAuth): Promise<void> {
    const rest = url.pathname.slice(GITHUB_BYO_PREFIX.length);

    // PRD 010 Req 15: availability answers whatever the deployment looks
    // like — an unconfigured deployment says why, it does not 404.
    if (rest === '' && req.method === 'GET') {
      sendJson(res, 200, availability());
      return;
    }

    const usable = availability();
    if (!usable.available || !appAuth) {
      sendJson(res, 409, { error: usable.reason ?? NO_APP });
      return;
    }

    // PRD 010 Req 16: start the round trip. The state is this server's own
    // opaque value; GitHub echoes it back untouched, which is what lets the
    // return be matched to the session that started it.
    if (rest === '/session' && req.method === 'POST') {
      sweep();
      const id = newSessionId();
      sessions.set(id, { userId: auth.user.id, createdAtMs: now() });
      sendJson(res, 200, {
        session: id,
        installUrl: `${webBase}/apps/${appSlug}/installations/new?state=${encodeURIComponent(id)}`,
      });
      return;
    }

    // PRD 010 Req 16: resolve GitHub's return into the session. The
    // installation is confirmed against the App's own installations before it
    // is bound — an id invented by a caller is refused here, not later.
    if (rest === '/return' && req.method === 'POST') {
      const body = await readJson(req, res);
      if (body === undefined) return;
      const id = typeof body.session === 'string' ? body.session : '';
      const session = sessions.get(id);
      if (!session || session.userId !== auth.user.id || session.createdAtMs < now() - SESSION_TTL_MS) {
        sendJson(res, 404, {
          error: 'That connection is no longer in progress — start connecting a repository again.',
        });
        return;
      }
      if (body.setupAction === 'cancel') {
        sessions.delete(id);
        sendJson(res, 400, { error: 'The GitHub install was cancelled, so there is no installation to read.' });
        return;
      }
      const installationId = Number(body.installationId);
      if (!Number.isInteger(installationId) || installationId <= 0) {
        sendJson(res, 400, { error: 'GitHub returned no installation id — start connecting a repository again.' });
        return;
      }
      let found;
      try {
        // The list is read to CONFIRM one id, never to answer with. Only the
        // matching installation is described back to the caller.
        found = (await appAuth.listInstallations()).find((i) => i.id === installationId);
      } catch (err) {
        thrownFailure(res, err);
        return;
      }
      if (!found) {
        sendJson(res, 404, {
          error: 'This deployment’s GitHub App is not installed there — install it and come back.',
        });
        return;
      }
      session.installationId = found.id;
      sendJson(res, 200, { installationId: found.id, account: found.account });
      return;
    }

    if (rest === '/repos' && req.method === 'GET') {
      const owned = sessionFor(url, auth.user.id);
      if (!owned.ok) {
        sendJson(res, owned.status, { error: owned.error });
        return;
      }
      const installation = installationFor(url, owned.session);
      if (!installation.ok) {
        sendJson(res, installation.status, { error: installation.error });
        return;
      }
      // PRD 010 Req 2: the installation's OWN repositories, read as that
      // installation — the App JWT could see more, and is not used here.
      const response = await appAuth.requestAsInstallation(
        installation.id,
        '/installation/repositories?per_page=100',
      );
      if (!response.ok) {
        await failure(res, response, 'The repositories of that installation could not be read');
        return;
      }
      const body = (await response.json()) as RepositoriesBody;
      const repos: RepoOption[] = [];
      for (const entry of body.repositories ?? []) {
        const owner = entry.owner?.login;
        // A repo the installation cannot write is not one a workspace can be
        // stored in, so it is not offered as a choice at all.
        if (typeof owner !== 'string' || typeof entry.name !== 'string' || entry.permissions?.push === false) continue;
        repos.push({
          owner,
          repo: entry.name,
          fullName: typeof entry.full_name === 'string' ? entry.full_name : `${owner}/${entry.name}`,
          defaultBranch: typeof entry.default_branch === 'string' ? entry.default_branch : 'main',
        });
      }
      // PRD 010 Req 16: an installation that grants no usable repo says so
      // rather than showing an empty list with no explanation.
      sendJson(res, 200, {
        repos,
        ...(repos.length
          ? {}
          : {
              message:
                'That installation does not grant this app write access to any repository. ' +
                'Add one on GitHub, then start again.',
            }),
      });
      return;
    }

    if (rest === '/branches' && req.method === 'GET') {
      const owned = sessionFor(url, auth.user.id);
      if (!owned.ok) {
        sendJson(res, owned.status, { error: owned.error });
        return;
      }
      const installation = installationFor(url, owned.session);
      if (!installation.ok) {
        sendJson(res, installation.status, { error: installation.error });
        return;
      }
      const owner = url.searchParams.get('owner') ?? '';
      const repo = url.searchParams.get('repo') ?? '';
      if (!owner || !repo) {
        sendJson(res, 400, { error: 'name the owner and repo whose branches to list' });
        return;
      }
      const path = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
      const meta = await appAuth.requestAsInstallation(installation.id, path);
      if (!meta.ok) {
        await failure(res, meta, `${owner}/${repo} could not be read`);
        return;
      }
      const defaultBranch = ((await meta.json()) as { default_branch?: unknown }).default_branch;
      const listed = await appAuth.requestAsInstallation(installation.id, `${path}/branches?per_page=100`);
      if (!listed.ok) {
        await failure(res, listed, `The branches of ${owner}/${repo} could not be read`);
        return;
      }
      const branches = ((await listed.json()) as { name?: unknown }[])
        .map((b) => b.name)
        .filter((name): name is string => typeof name === 'string');
      sendJson(res, 200, {
        // PRD 010 Req 16: the repo's own default branch is the wizard's
        // default — the branch step never invents one.
        defaultBranch: typeof defaultBranch === 'string' ? defaultBranch : (branches[0] ?? 'main'),
        branches,
      });
      return;
    }

    sendJson(res, 404, { error: 'no such endpoint' });
  }

  return { availability, handle };
}
