#!/usr/bin/env node
// Marky Mark control panel — zero-dependency Node server.
// Reads sandcastle agent logs from the main repo checkout and GitHub state via `gh`.
//
//   MARKY_REPO=/workspace/marky-mark PORT=8080 KEY=secret node server.js
//
// KEY (optional): when set, requests need ?key=<KEY> once; a cookie keeps the session.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync, spawn } = require('child_process');

const PORT = Number(process.env.PORT || 8080);
const KEY = process.env.KEY || '';
const REPO = process.env.MARKY_REPO || findRepoRoot();
const LOG_DIR = path.join(REPO, '.sandcastle', 'logs');
const PUBLIC_DIR = path.join(__dirname, 'public');
// No "Run complete" marker + log touched within this window => running. Generous
// because agents go quiet for many minutes during validate/build steps.
const RUNNING_WINDOW_MS = 15 * 60 * 1000;

function findRepoRoot() {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, '.sandcastle', 'logs'))) return dir;
    dir = path.dirname(dir);
  }
  return process.cwd();
}

// CLI tools (sandcastle's spinner among them) write ANSI escapes and cursor
// control codes into the logs — strip them before parsing or serving.
function stripAnsi(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b\][^\x07]*(\x07|\x1b\\)/g, '')
    .replace(/\r/g, '');
}

// Pull the most informative error line out of a failed run block.
function extractError(text) {
  for (const raw of text.split('\n')) {
    const l = raw.replace(/^\[\d\d:\d\d:\d\d\]\s*/, '').trim();
    if (!l || /^--- Run started/.test(l) || /\bRun (complete|failed|aborted)\b/.test(l)) continue;
    if (/^[A-Z][A-Za-z]*Error\b|\berror:|\bfailed:/i.test(l)) {
      return l.length > 300 ? l.slice(0, 300) + '…' : l;
    }
  }
  return null;
}

// ---------- agent log parsing ----------

function readTimings() {
  try {
    return fs
      .readFileSync(path.join(LOG_DIR, 'timings.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function parseLogName(file) {
  let m = file.match(/^sandcastle-issue-(\d+)-(.+)\.log$/);
  if (m) return { scope: 'issue', issue: m[1], role: m[2] };
  m = file.match(/^main-(.+)\.log$/);
  if (m) return { scope: 'main', issue: null, role: m[1] };
  return { scope: 'other', issue: null, role: file.replace(/\.log$/, '') };
}

// Resolve a "[HH:MM:SS]" stamp against the run's start date (UTC, with midnight rollover).
function resolveClock(startIso, hms) {
  const start = new Date(startIso);
  if (isNaN(start)) return null;
  const [h, mi, s] = hms.split(':').map(Number);
  const t = new Date(start);
  t.setUTCHours(h, mi, s, 0);
  if (t.getTime() < start.getTime() - 5000) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

function parseRuns(file, content, mtimeMs, timings) {
  const meta = parseLogName(file);
  const marker = /^--- Run started: (.+?) ---$/gm;
  const blocks = [];
  let m;
  const starts = [];
  while ((m = marker.exec(content))) starts.push({ iso: m[1], idx: m.index });
  if (starts.length === 0 && content.trim()) starts.push({ iso: null, idx: 0 });
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1].idx : content.length;
    blocks.push({ iso: starts[i].iso, text: content.slice(starts[i].idx, end) });
  }

  return blocks.map((block, i) => {
    const lines = block.text.split('\n');
    const isLast = i === blocks.length - 1;
    const completeLine = lines.find((l) => /\bRun (complete|failed|aborted)\b/.test(l));
    const stamps = block.text.match(/^\[(\d\d:\d\d:\d\d)\]/gm) || [];
    const lastStamp = stamps.length ? stamps[stamps.length - 1].slice(1, 9) : null;
    const startedAt = block.iso ? new Date(block.iso) : null;
    let endedAt = null;
    if (completeLine && startedAt && lastStamp) endedAt = resolveClock(startedAt.toISOString(), lastStamp);

    // Match a timings entry: same phase AND same issue, entry start (ts - ms)
    // within 15s of run start. The issue check is load-bearing: parallel lanes
    // start the same phase seconds apart, so on phase+time alone a lane that is
    // still running adopts its sibling's finished entry and reports that
    // sibling's status and duration.
    let timing = null;
    if (startedAt) {
      timing = timings.find((t) => {
        if (t.phase !== meta.role) return false;
        if (String(t.issue ?? '') !== String(meta.issue ?? '')) return false;
        const entryStart = new Date(t.ts).getTime() - (t.ms || 0);
        return Math.abs(entryStart - startedAt.getTime()) < 15000;
      }) || null;
    }
    if (timing && !endedAt) endedAt = new Date(timing.ts);

    const tail = lines.filter((l) => l.trim()).slice(-1)[0] || '';
    // A node crash dump ends with "Node.js v22.x.y" — the run is dead, not quiet.
    const crashed = /^Node\.js v\d/.test(tail.trim());

    let status;
    if (completeLine) {
      if (timing) status = timing.ok ? 'success' : 'failed';
      else status = /failed|aborted/.test(completeLine) ? 'failed' : 'success';
    } else if (timing) {
      // A matched timings entry means the run already ended — don't let a fresh
      // mtime make a just-crashed run look running for 15 minutes.
      status = timing.ok ? 'success' : 'failed';
      if (!endedAt) endedAt = new Date(timing.ts);
    } else if (crashed) {
      status = 'failed';
    } else if (isLast && Date.now() - mtimeMs < RUNNING_WINDOW_MS) {
      status = 'running';
    } else {
      status = 'interrupted';
    }

    const iterMatches = block.text.match(/Iteration (\d+)\/(\d+)/g) || [];
    const lastIter = iterMatches.length ? iterMatches[iterMatches.length - 1] : null;
    const ctx = block.text.match(/Context window: (\S+)/);
    const issue = meta.issue || (timing && timing.issue != null ? String(timing.issue) : null);
    const lastActivity = status === 'running' ? mtimeMs : (endedAt ? endedAt.getTime() : (startedAt ? startedAt.getTime() : mtimeMs));

    const error = status === 'failed' || status === 'interrupted' ? extractError(block.text) : null;

    return {
      id: `${file}::${i}`,
      file,
      runIndex: i,
      role: meta.role,
      scope: meta.scope,
      issue,
      status,
      startedAt: startedAt ? startedAt.toISOString() : null,
      endedAt: endedAt ? endedAt.toISOString() : null,
      durationMs: timing ? timing.ms : (startedAt && endedAt ? endedAt - startedAt : null),
      iteration: lastIter,
      contextWindow: ctx ? ctx[1] : null,
      lastLine: tail.length > 220 ? tail.slice(0, 220) + '…' : tail,
      lastActivity,
      error,
    };
  });
}

function listAgentRuns() {
  let files = [];
  try {
    files = fs.readdirSync(LOG_DIR).filter((f) => f.endsWith('.log'));
  } catch {
    return { runs: [], error: `log dir not found: ${LOG_DIR}` };
  }
  const timings = readTimings();
  const runs = [];
  for (const file of files) {
    const full = path.join(LOG_DIR, file);
    try {
      const stat = fs.statSync(full);
      const content = stripAnsi(fs.readFileSync(full, 'utf8'));
      runs.push(...parseRuns(file, content, stat.mtimeMs, timings));
    } catch {
      // unreadable file — skip
    }
  }
  runs.sort((a, b) => {
    const ar = a.status === 'running' ? 1 : 0;
    const br = b.status === 'running' ? 1 : 0;
    if (ar !== br) return br - ar;
    return b.lastActivity - a.lastActivity;
  });
  return { runs, generatedAt: new Date().toISOString() };
}

function readRunLog(file, runIndex, maxLines) {
  if (!/^[\w.-]+\.log$/.test(file)) throw new Error('bad file name');
  const full = path.join(LOG_DIR, file);
  const content = stripAnsi(fs.readFileSync(full, 'utf8'));
  const marker = /^--- Run started: .+? ---$/gm;
  const starts = [];
  let m;
  while ((m = marker.exec(content))) starts.push(m.index);
  if (starts.length === 0) starts.push(0);
  const i = Math.min(Math.max(0, runIndex), starts.length - 1);
  const end = i + 1 < starts.length ? starts[i + 1] : content.length;
  let lines = content.slice(starts[i], end).split('\n');
  const truncated = lines.length > maxLines;
  if (truncated) lines = lines.slice(-maxLines);
  return { file, runIndex: i, truncated, text: lines.join('\n') };
}

// ---------- run time breakdown ----------

// Fixed category order — it is also the bar's segment order; the palette was
// validated for CVD-safe adjacency in exactly this sequence.
const CATS = [
  { key: 'verify', label: 'tests / verify' },
  { key: 'edit', label: 'edit / write' },
  { key: 'explore', label: 'read / search' },
  { key: 'git', label: 'git / github' },
  { key: 'think', label: 'thinking' },
  { key: 'other', label: 'other / sync' },
];

function categorizeEvent(text) {
  const bash = text.match(/^Bash\((.*)/);
  if (bash) {
    const cmd = bash[1];
    if (/validate|playwright|vitest|npm test|typecheck|\btsc\b/.test(cmd)) return 'verify';
    const tok = (cmd.match(/^[\s(]*([\w./-]+)/) || [])[1] || '';
    if (tok === 'git' || tok === 'gh') return 'git';
    if (/^(grep|rg|sed|cat|ls|find|head|tail|wc|tree|diff|awk|stat)$/.test(tok)) return 'explore';
    return 'other';
  }
  if (/^(Edit|Write|MultiEdit|NotebookEdit)\(/.test(text)) return 'edit';
  if (/^(Read|Grep|Glob)\(/.test(text)) return 'explore';
  if (/^(Iteration |Reusing |Agent (started|stopped)|Capturing |Syncing |Collecting |Run complete|Context window|Agent signaled)/.test(text)) return 'other';
  return 'think'; // narration between tool calls = the model thinking/responding
}

function summarizeRun(file, runIndex) {
  const { text } = readRunLog(file, runIndex, Infinity);
  const re = /^\[(\d\d):(\d\d):(\d\d)\] ?(.*)$/gm;
  const events = [];
  let m;
  let prev = null;
  let dayOff = 0;
  while ((m = re.exec(text))) {
    let sec = +m[1] * 3600 + +m[2] * 60 + +m[3] + dayOff;
    if (prev != null && sec < prev - 5) { dayOff += 86400; sec += 86400; }
    prev = sec;
    events.push({ sec, cat: categorizeEvent(m[4]), label: m[4] });
  }
  if (events.length < 2) return { totalMs: 0, cats: [], steps: [] };

  // A still-running block has no completion marker; its in-flight step (often a
  // long validate) has no next stamp yet, so extend the last event to "now".
  const finished = /\bRun (complete|failed|aborted)\b/.test(text);
  const startIso = (text.match(/^--- Run started: (.+?) ---$/m) || [])[1];
  let lastEnd = events[events.length - 1].sec;
  if (!finished && startIso) {
    const elapsed = (Date.now() - new Date(startIso).getTime()) / 1000;
    const tail = elapsed - (lastEnd - events[0].sec);
    if (tail > 0 && tail < 30 * 60) lastEnd += tail;
  }

  const totals = Object.fromEntries(CATS.map((c) => [c.key, 0]));
  const steps = [];
  for (let i = 0; i < events.length; i++) {
    const end = i + 1 < events.length ? events[i + 1].sec : lastEnd;
    const durS = Math.max(0, end - events[i].sec);
    totals[events[i].cat] += durS;
    if (durS >= 5) steps.push({ key: events[i].cat, ms: Math.round(durS * 1000), label: events[i].label.slice(0, 100) });
  }
  const totalS = Object.values(totals).reduce((a, b) => a + b, 0);
  return {
    totalMs: Math.round(totalS * 1000),
    running: !finished,
    cats: CATS.map((c) => ({
      key: c.key,
      label: c.label,
      ms: Math.round(totals[c.key] * 1000),
      pct: totalS ? Math.round((totals[c.key] / totalS) * 100) : 0,
    })),
    steps: steps.sort((a, b) => b.ms - a.ms).slice(0, 4),
  };
}

// ---------- sandcastle orchestrator control ----------

const PID_FILE = '/tmp/sandcastle-orchestrator.pid';
const ORCH_LOG = path.join(LOG_DIR, 'main-orchestrator.log');

// Shared with the owner's host-side tmux loop, so it must sit on the repo
// bind mount: this panel runs in a container whose /tmp is its own overlay,
// and a lock there would be a different inode than the host's. flock locks
// live on the inode and the kernel is shared, so a repo path locks across
// the container boundary. Lives under logs/ because that path is already
// gitignored — no main-repo change needed to keep the lock out of git.
const LOCK_FILE = path.join(LOG_DIR, 'orchestrator.lock');

// True when anyone holds the lock — including a run on the host, which
// pgrep in this container cannot see. Fails closed: if flock is missing or
// the lock path is unwritable we report "held" and refuse to start, which
// is the safe direction for a guard against concurrent orchestrators.
function lockHeld() {
  try {
    execFileSync('flock', ['-n', LOCK_FILE, '-c', 'true'], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

// Orchestrator started by this panel, if still alive.
function panelOrch() {
  try {
    const info = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    process.kill(info.pid, 0);
    return info;
  } catch {
    return null;
  }
}

// Best effort: an orchestrator running in this container that we didn't start.
// (Runs launched outside the container are invisible here.)
function externalOrchAlive() {
  try {
    const out = execFileSync('pgrep', ['-f', String.raw`\.sandcastle/main\.ts`], { encoding: 'utf8' });
    return out.trim().length > 0;
  } catch {
    return false; // pgrep exits 1 when nothing matches
  }
}

function orchStatus() {
  const mine = panelOrch();
  if (mine) return { running: true, startedAt: mine.startedAt, elapsedMs: Date.now() - new Date(mine.startedAt).getTime(), source: 'panel' };
  // Lock first: it is the only signal that sees the owner's host-side loop.
  // pgrep stays as a fallback for a container-side run started without flock.
  if (lockHeld()) return { running: true, source: 'external' };
  if (externalOrchAlive()) return { running: true, source: 'external' };
  return { running: false };
}

function startOrchestrator() {
  if (orchStatus().running) return { ok: false, error: 'orchestrator already running' };
  const startedAt = new Date().toISOString();
  fs.appendFileSync(ORCH_LOG, `--- Run started: ${startedAt} ---\n`);
  const fd = fs.openSync(ORCH_LOG, 'a');
  // flock holds the lock for as long as npm lives, so the host-side loop
  // skips its turn instead of running a second orchestrator over the same
  // worktrees. -n means "give up now" rather than queue behind the holder.
  const child = spawn('flock', ['-n', LOCK_FILE, 'npm', 'run', 'sandcastle'], { cwd: REPO, detached: true, stdio: ['ignore', fd, fd] });
  fs.closeSync(fd);
  child.unref();
  fs.writeFileSync(PID_FILE, JSON.stringify({ pid: child.pid, startedAt }));
  return { ok: true, pid: child.pid, startedAt };
}

function stopOrchestrator() {
  const mine = panelOrch();
  if (!mine) return { ok: false, error: 'no panel-started run to stop' };
  try { process.kill(-mine.pid, 'SIGTERM'); } catch { try { process.kill(mine.pid, 'SIGTERM'); } catch { } }
  try { fs.appendFileSync(ORCH_LOG, `[${new Date().toISOString().slice(11, 19)}] Run stopped from control panel\n`); } catch { }
  return { ok: true };
}

// ---------- gh (issues / PRs) ----------

const cache = new Map();
function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return Promise.resolve(hit.value);
  return fn().then((value) => {
    cache.set(key, { at: Date.now(), value });
    return value;
  });
}

function gh(args) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { cwd: REPO, maxBuffer: 16 * 1024 * 1024, timeout: 30000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

async function fetchIssues() {
  const raw = await gh(['issue', 'list', '--state', 'all', '--json',
    'number,title,state,labels,url,updatedAt', '--limit', '100']);
  const issues = JSON.parse(raw);
  // Sub-issue links (best effort — endpoint may not exist on older GitHub plans).
  await Promise.all(issues.map(async (iss) => {
    iss.subIssues = [];
    iss.parent = null;
    try {
      const subs = JSON.parse(await gh(['api', `repos/{owner}/{repo}/issues/${iss.number}/sub_issues`]));
      iss.subIssues = subs.map((s) => s.number);
    } catch { /* no sub-issues */ }
  }));
  const byNumber = new Map(issues.map((i) => [i.number, i]));
  for (const iss of issues) {
    for (const sub of iss.subIssues) {
      const child = byNumber.get(sub);
      if (child) child.parent = iss.number;
    }
  }
  return issues;
}

async function fetchPrs() {
  const raw = await gh(['pr', 'list', '--state', 'all', '--json',
    'number,title,state,url,headRefName,updatedAt,isDraft', '--limit', '50']);
  const prs = JSON.parse(raw);
  for (const pr of prs) {
    const linked = new Set();
    const bm = (pr.headRefName || '').match(/issue-(\d+)/);
    if (bm) linked.add(Number(bm[1]));
    for (const tm of (pr.title || '').matchAll(/#(\d+)/g)) linked.add(Number(tm[1]));
    pr.linkedIssues = [...linked];
  }
  return prs;
}

// ---------- docs ----------

// Long-form write-ups live in the repo at archive/articles. The HTML ones are
// self-contained single files, so they are served straight off disk.
const DOCS_DIR = path.join(REPO, 'archive', 'articles');

function listDocs() {
  let names;
  try {
    names = fs.readdirSync(DOCS_DIR).filter((n) => n.endsWith('.html'));
  } catch {
    return []; // no archive/articles in this checkout
  }
  return names
    .map((name) => {
      const full = path.join(DOCS_DIR, name);
      const st = fs.statSync(full);
      let title = name.replace(/\.html$/, '').replace(/[-_]+/g, ' ');
      let blurb = '';
      try {
        const head = fs.readFileSync(full, 'utf8').slice(0, 4096);
        const t = head.match(/<title>([^<]+)<\/title>/i);
        if (t) title = t[1].trim();
        const d = head.match(/<meta\s+name="description"\s+content="([^"]*)"/i);
        if (d) blurb = d[1].trim();
      } catch { /* unreadable — fall back to the filename */ }
      const md = name.replace(/\.html$/, '.md');
      return {
        name,
        title,
        blurb,
        url: `/docs/${name}`,
        markdownUrl: fs.existsSync(path.join(DOCS_DIR, md)) ? `/docs/${md}` : null,
        updatedAt: st.mtime.toISOString(),
        sizeKb: Math.round(st.size / 1024),
      };
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

// ---------- http ----------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function send(res, code, body, type) {
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
const json = (res, obj, code) => send(res, code || 200, JSON.stringify(obj));

function authorized(req, url, res) {
  if (!KEY) return true;
  const cookie = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith('cpkey='));
  if (cookie && cookie.slice(6) === KEY) return true;
  if (url.searchParams.get('key') === KEY) {
    res.setHeader('Set-Cookie', `cpkey=${KEY}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax`);
    return true;
  }
  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (!authorized(req, url, res)) {
      return send(res, 401, '<meta name="viewport" content="width=device-width">' +
        '<body style="font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0">' +
        '<div>🔒 Access key required — open the link with <code>?key=…</code></div></body>', 'text/html; charset=utf-8');
    }

    if (url.pathname === '/api/agents') {
      return json(res, listAgentRuns());
    }
    if (url.pathname === '/api/log') {
      const file = url.searchParams.get('file') || '';
      const run = Number(url.searchParams.get('run') || 0);
      return json(res, readRunLog(file, run, 600));
    }
    if (url.pathname === '/api/summary') {
      const file = url.searchParams.get('file') || '';
      const run = Number(url.searchParams.get('run') || 0);
      return json(res, summarizeRun(file, run));
    }
    if (url.pathname === '/api/sandcastle/status') {
      return json(res, orchStatus());
    }
    if (url.pathname === '/api/sandcastle/start' && req.method === 'POST') {
      return json(res, startOrchestrator());
    }
    if (url.pathname === '/api/sandcastle/stop' && req.method === 'POST') {
      return json(res, stopOrchestrator());
    }
    if (url.pathname === '/api/issues') {
      return json(res, { issues: await cached('issues', 30000, fetchIssues) });
    }
    if (url.pathname === '/api/prs') {
      return json(res, { prs: await cached('prs', 30000, fetchPrs) });
    }
    if (url.pathname === '/api/docs') {
      return json(res, { docs: listDocs() });
    }
    // Articles from archive/articles. basename() strips any traversal attempt.
    if (url.pathname.startsWith('/docs/')) {
      const name = path.basename(decodeURIComponent(url.pathname.slice('/docs/'.length)));
      const full = path.join(DOCS_DIR, name);
      if (name && fs.existsSync(full) && fs.statSync(full).isFile()) {
        return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
      }
      return send(res, 404, JSON.stringify({ error: 'not found' }));
    }

    // static
    let p = url.pathname === '/' ? '/index.html' : url.pathname;
    p = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
    const full = path.join(PUBLIC_DIR, p);
    if (full.startsWith(PUBLIC_DIR) && fs.existsSync(full) && fs.statSync(full).isFile()) {
      return send(res, 200, fs.readFileSync(full), MIME[path.extname(full)] || 'application/octet-stream');
    }
    return send(res, 404, JSON.stringify({ error: 'not found' }));
  } catch (err) {
    return json(res, { error: String(err.message || err) }, 500);
  }
});

// Only listen when run as a program — `require`ing this file (the unit test
// does) must not open a port.
if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`control panel on http://0.0.0.0:${PORT}  repo=${REPO}${KEY ? '  (key required)' : ''}`);
  });
}

module.exports = { parseRuns };
