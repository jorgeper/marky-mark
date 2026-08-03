'use strict';

const $ = (s) => document.querySelector(s);
const state = {
  tab: 'agents',
  filter: 'all',
  page: 0,
  pageSize: 20,
  runs: [],
  issues: [],
  prs: [],
  log: null, // {file, runIndex, title, running}
  expandedIssue: null,
};

// ---------- helpers ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function rel(ts) {
  if (!ts) return '—';
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${Math.floor(s)}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
function dur(ms) {
  if (ms == null) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// ---------- agents ----------

const ROLE_ICONS = {
  implementer: '🔨', reviewer: '🔍', 'spec-writer': '📝', planner: '🗺️',
  decomposer: '🧩', merger: '🔀', filer: '📁', designer: '🎨',
};

function renderAgents() {
  const list = $('#agent-list');
  const running = state.runs.filter((r) => r.status === 'running');
  const badge = $('#running-badge');
  badge.hidden = running.length === 0;
  badge.textContent = running.length;
  badge.className = 'badge live';

  const isFail = (r) => r.status === 'failed' || r.status === 'interrupted';
  let rows = state.runs;
  if (state.filter === 'running') rows = running;
  else if (state.filter === 'failed') rows = state.runs.filter(isFail);
  else if (state.filter === 'hidefail') rows = state.runs.filter((r) => !isFail(r));
  const pages = Math.max(1, Math.ceil(rows.length / state.pageSize));
  state.page = Math.min(state.page, pages - 1);
  const pageRows = rows.slice(state.page * state.pageSize, (state.page + 1) * state.pageSize);

  if (!pageRows.length) {
    list.innerHTML = `<div class="empty">${state.filter === 'running' ? 'No agents running right now 😴'
      : state.filter === 'failed' ? 'No failed runs 🎉'
      : 'No agent runs found'}</div>`;
  } else {
    list.innerHTML = pageRows.map((r) => {
      const icon = ROLE_ICONS[r.role] || '🤖';
      const runningNow = r.status === 'running';
      const stChip = `<span class="badge st-${r.status}">${r.status}</span>`;
      const issueChip = r.issue
        ? `<a class="chip-link" data-issue="${r.issue}" href="#issues">#${r.issue}</a>` : '';
      const meta = [
        runningNow ? `started ${rel(r.startedAt)}` : rel(r.lastActivity),
        r.durationMs != null ? dur(r.durationMs) : (runningNow && r.startedAt ? dur(Date.now() - new Date(r.startedAt)) + ' elapsed' : ''),
        r.iteration || '',
        r.contextWindow ? `ctx ${r.contextWindow}` : '',
      ].filter(Boolean).map(esc).join(' · ');
      return `<div class="card tappable ${runningNow ? '' : 'dim'}" data-log="${esc(r.file)}" data-run="${r.runIndex}"
                data-title="${esc(r.role)}${r.issue ? ' · #' + esc(r.issue) : ''}" data-running="${runningNow}"
                data-issueref="${esc(r.issue || '')}">
        <div class="row1">
          ${runningNow ? '<span class="dot pulse"></span>' : ''}
          <span>${icon}</span><span class="role">${esc(r.role)}</span>
          ${issueChip}<span class="spacer"></span>${stChip}
        </div>
        <div class="row2">${meta}</div>
        ${r.error ? `<div class="errline">${esc(r.error)}</div>` : (r.lastLine ? `<div class="preview">${esc(r.lastLine)}</div>` : '')}
      </div>`;
    }).join('');
  }

  const pager = $('#agent-pager');
  pager.hidden = rows.length <= state.pageSize;
  $('#pg-info').textContent = `${state.page + 1} / ${pages} · ${rows.length} runs`;
  $('#pg-prev').disabled = state.page === 0;
  $('#pg-next').disabled = state.page >= pages - 1;
  $('#status-line').textContent = `${running.length} running · ${state.runs.length} total runs · updated ${new Date().toLocaleTimeString()}`;
}

// ---------- issues ----------

function agentChipsFor(issueNum) {
  const runs = state.runs.filter((r) => String(r.issue) === String(issueNum));
  const seen = new Map(); // role -> best run (running preferred, else latest)
  for (const r of runs) {
    const prev = seen.get(r.role);
    if (!prev || r.status === 'running' || (prev.status !== 'running' && r.lastActivity > prev.lastActivity)) seen.set(r.role, r);
  }
  return [...seen.values()].map((r) =>
    `<span class="badge st-${r.status === 'running' ? 'running' : r.status}"
       data-log="${esc(r.file)}" data-run="${r.runIndex}" data-title="${esc(r.role)} · #${esc(r.issue)}"
       data-running="${r.status === 'running'}" data-issueref="${esc(r.issue)}"
       style="cursor:pointer">${r.status === 'running' ? '<span class="dot pulse"></span>' : ''}${esc(r.role)}</span>`
  ).join(' ');
}

function prDotCls(prState) {
  return prState === 'MERGED' ? 'merged' : prState === 'OPEN' ? 'open' : 'closed';
}

function prRowsFor(issueNum) {
  return state.prs.filter((p) => p.linkedIssues.includes(Number(issueNum)))
    .map((p) => `
      <div class="trow${p.state === 'OPEN' ? '' : ' done'}">
        <span class="tdot ${prDotCls(p.state)}"></span>
        <a class="tnum pr" href="${esc(p.url)}" target="_blank" rel="noopener">PR #${p.number}</a>
        <span class="ttitle">${esc(p.title)}&nbsp;<a class="gh-link" href="${esc(p.url)}" target="_blank" rel="noopener">↗</a></span>
      </div>`).join('');
}

function issueTree(iss, byNumber) {
  const subs = (iss.subIssues || []).map((n) => byNumber.get(n)).filter(Boolean)
    .sort((a, b) =>
      (a.state === 'OPEN' ? 0 : 1) - (b.state === 'OPEN' ? 0 : 1) || a.number - b.number);
  // children: PRs first, then open sub-issues, then closed ones
  const kids = prRowsFor(iss.number) + subs.map((s) => issueTree(s, byNumber)).join('');
  const chips = agentChipsFor(iss.number);
  const done = iss.state !== 'OPEN' ? ' done' : '';
  return `<div class="tnode">
    <div class="trow${done}" id="issue-${iss.number}">
      <span class="tdot ${iss.state === 'OPEN' ? 'open' : 'closed'}"></span>
      <span class="tnum">#${iss.number}</span>
      <span class="ttitle">${esc(iss.title)}&nbsp;<a class="gh-link" href="${esc(iss.url)}" target="_blank" rel="noopener">↗</a></span>
    </div>
    ${chips ? `<div class="tchips${done}">${chips}</div>` : ''}
    ${kids ? `<div class="tkids">${kids}</div>` : ''}
  </div>`;
}

const LEGEND = `<div class="legend">
  <span><span class="tdot open"></span> open</span>
  <span><span class="tdot closed"></span> closed / merged</span>
  <span><span class="dot pulse"></span> agent running</span>
</div>`;

function renderIssues() {
  const list = $('#issue-list');
  if (!state.issues.length) { list.innerHTML = '<div class="empty">No issues (or still loading)</div>'; return; }
  const byNumber = new Map(state.issues.map((i) => [i.number, i]));
  const top = state.issues.filter((i) => i.parent == null)
    .sort((a, b) => (a.state === 'OPEN' ? 0 : 1) - (b.state === 'OPEN' ? 0 : 1));
  list.innerHTML = LEGEND + top.map((i) => `<div class="card tree">${issueTree(i, byNumber)}</div>`).join('');
  if (state.expandedIssue) {
    const el = document.getElementById(`issue-${state.expandedIssue}`) ||
      // sub-issues render inside their parent — scroll the parent into view
      document.getElementById(`issue-${(byNumber.get(state.expandedIssue) || {}).parent}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    state.expandedIssue = null;
  }
}

// ---------- PRs ----------

function renderPrs() {
  const list = $('#pr-list');
  if (!state.prs.length) { list.innerHTML = '<div class="empty">No pull requests</div>'; return; }
  list.innerHTML = state.prs.map((p) => `
    <div class="card">
      <div class="row1">
        <span class="badge st-${p.state.toLowerCase()}">${p.state.toLowerCase()}${p.isDraft ? ' · draft' : ''}</span>
        <span class="issue-title">#${p.number} ${esc(p.title)}</span>
        <span class="spacer"></span>
        <a class="gh-link" href="${esc(p.url)}" target="_blank" rel="noopener">GitHub ↗</a>
      </div>
      <div class="row2">
        ${rel(p.updatedAt)} · <code>${esc(p.headRefName)}</code>
        ${p.linkedIssues.map((n) => `<a class="chip-link" data-issue="${n}" href="#issues">#${n}</a>`).join(' ')}
      </div>
    </div>`).join('');
}

// ---------- run time breakdown (layer cake) ----------

function renderSummary(s) {
  const el = $('#log-summary');
  if (!s || !s.totalMs || s.totalMs < 3000) { el.hidden = true; return; }
  const cats = s.cats.filter((c) => c.ms > 0);
  el.hidden = false;
  el.innerHTML = `
    <div class="cake-title">⏱ Where the time went · <b>${dur(s.totalMs)}</b>${s.running ? ' <span class="badge live">so far</span>' : ''}</div>
    <div class="cake">
      ${cats.map((c) => `<span class="seg" style="flex-grow:${c.ms};background:var(--cat-${c.key})"
        title="${esc(c.label)} — ${dur(c.ms)} (${c.pct}%)"></span>`).join('')}
    </div>
    <div class="cake-legend">
      ${cats.map((c) => `<span class="cl-row"><span class="swatch" style="background:var(--cat-${c.key})"></span>${esc(c.label)} <b>${dur(c.ms)}</b> · ${c.pct}%</span>`).join('')}
    </div>
    ${s.steps.length ? `
    <div class="cake-steps">
      <div class="cake-caption">slowest steps</div>
      ${s.steps.map((t) => `<div class="cs-row"><span class="swatch" style="background:var(--cat-${t.key})"></span><span class="cs-dur">${dur(t.ms)}</span><span class="cs-label">${esc(t.label)}</span></div>`).join('')}
    </div>` : ''}`;
}

async function refreshSummary() {
  if (!state.log) return;
  try {
    renderSummary(await api(`/api/summary?file=${encodeURIComponent(state.log.file)}&run=${state.log.runIndex}`));
  } catch { $('#log-summary').hidden = true; }
}

// ---------- log view ----------

async function refreshLog() {
  if (!state.log) return;
  try {
    const data = await api(`/api/log?file=${encodeURIComponent(state.log.file)}&run=${state.log.runIndex}`);
    const body = $('#log-body');
    const atBottom = body.scrollHeight - window.scrollY - window.innerHeight < 200;
    body.textContent = (data.truncated ? '… (older lines truncated)\n' : '') + data.text;
    if (state.log.running && atBottom) window.scrollTo(0, document.body.scrollHeight);
  } catch (e) {
    $('#log-body').textContent = 'Failed to load log: ' + e.message;
  }
}

function openLog(file, runIndex, title, running, issue) {
  state.log = { file, runIndex: Number(runIndex), title, running: running === 'true' || running === true };
  $('#log-title').textContent = title;
  $('#log-live').hidden = !state.log.running;
  // chips linking back to the issue this agent works on, and that issue's PRs
  const links = [];
  if (issue) {
    links.push(`<a class="chip-link" data-issue="${esc(issue)}" href="#issues">issue #${esc(issue)}</a>`);
    for (const p of state.prs.filter((pr) => pr.linkedIssues.includes(Number(issue)))) {
      links.push(`<a class="chip-link" href="${esc(p.url)}" target="_blank" rel="noopener">PR #${p.number}</a>`);
    }
  }
  $('#log-links').innerHTML = links.join(' ');
  $('#log-body').textContent = 'Loading…';
  $('#log-summary').hidden = true;
  showView('log');
  refreshLog();
  refreshSummary();
}

// ---------- navigation / refresh loops ----------

function showView(tab) {
  state.tab = tab;
  for (const v of document.querySelectorAll('.view')) v.hidden = true;
  $(`#view-${tab}`).hidden = false;
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab !== 'log') state.log = null;
  window.scrollTo(0, 0);
}

async function refreshAgents() {
  try {
    const data = await api('/api/agents');
    state.runs = data.runs || [];
    if (state.tab === 'agents') renderAgents();
    if (state.tab === 'issues') renderIssues(); // agent chips inside issues
  } catch { /* transient */ }
}
async function refreshGh() {
  try {
    const [i, p] = await Promise.all([api('/api/issues'), api('/api/prs')]);
    state.issues = i.issues || [];
    state.prs = p.prs || [];
    if (state.tab === 'issues') renderIssues();
    if (state.tab === 'prs') renderPrs();
  } catch { /* transient */ }
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('nav button');
  if (nav) { showView(nav.dataset.tab); render(); return; }

  // data-issue chips live inside data-log cards, so check the inner target first
  const issueEl = e.target.closest('[data-issue]');
  if (issueEl) {
    e.preventDefault();
    state.expandedIssue = Number(issueEl.dataset.issue);
    showView('issues');
    renderIssues();
    return;
  }
  const logEl = e.target.closest('[data-log]');
  if (logEl) {
    e.preventDefault();
    openLog(logEl.dataset.log, logEl.dataset.run, logEl.dataset.title, logEl.dataset.running, logEl.dataset.issueref);
    return;
  }
});
$('#log-back').addEventListener('click', () => { showView('agents'); renderAgents(); });
$('#agent-filter').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  state.filter = c.dataset.f;
  state.page = 0;
  for (const x of document.querySelectorAll('#agent-filter .chip')) x.classList.toggle('active', x === c);
  renderAgents();
});
$('#page-size').addEventListener('change', (e) => { state.pageSize = Number(e.target.value); state.page = 0; renderAgents(); });
$('#pg-prev').addEventListener('click', () => { state.page--; renderAgents(); });
$('#pg-next').addEventListener('click', () => { state.page++; renderAgents(); });

// ---------- sandcastle run button ----------

async function refreshSc() {
  try {
    const s = await api('/api/sandcastle/status');
    state.sc = s;
    const b = $('#sc-btn');
    b.hidden = false;
    if (s.running && s.source === 'panel') {
      b.className = 'running';
      b.textContent = `⏹ sandcastle · ${dur(s.elapsedMs)}`;
      b.disabled = false;
    } else if (s.running) {
      b.className = 'external';
      b.textContent = '● sandcastle running';
      b.disabled = true; // started outside the panel — can't stop it from here
    } else {
      b.className = '';
      b.textContent = '▶ sandcastle';
      b.disabled = false;
    }
  } catch { /* transient */ }
}

$('#sc-btn').addEventListener('click', async () => {
  const s = state.sc || {};
  try {
    if (s.running && s.source === 'panel') {
      if (!confirm('Stop the sandcastle run? Killing it mid-run can leave a worktree half-done.')) return;
      await fetch('/api/sandcastle/stop', { method: 'POST' });
    } else if (!s.running) {
      const agentsBusy = state.runs.some((r) => r.status === 'running');
      const warn = agentsBusy
        ? '\n\n⚠️ An agent looks active right now — a run started outside this panel may already be going.'
        : '';
      if (!confirm('Start "npm run sandcastle"? This kicks off the full agent loop.' + warn)) return;
      const r = await fetch('/api/sandcastle/start', { method: 'POST' }).then((x) => x.json());
      if (r.error) alert(r.error);
    }
  } finally {
    refreshSc();
    setTimeout(refreshAgents, 1500);
  }
});

function render() {
  if (state.tab === 'agents') renderAgents();
  else if (state.tab === 'issues') renderIssues();
  else if (state.tab === 'prs') renderPrs();
}

refreshAgents();
refreshGh();
refreshSc();
setInterval(refreshSc, 5000);
setInterval(refreshAgents, 5000);
setInterval(refreshGh, 45000);
setInterval(() => { if (state.tab === 'log' && state.log && state.log.running) { refreshLog(); refreshSummary(); } }, 4000);
