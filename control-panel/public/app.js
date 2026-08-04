'use strict';

const $ = (s) => document.querySelector(s);
const state = {
  tab: 'agents',
  filter: 'all',
  page: 0,
  pageSize: 20,
  range: 24 * 3600e3, // shared window for Timeline + Stats
  runs: [],
  issues: [],
  prs: [],
  docs: [],
  cats: {}, // run id -> {verify: ms, edit: ms, ...} from /api/stats
  log: null, // {file, runIndex, title, running}
  expandedIssue: null,
  issueDetail: null, // issue number shown in the detail view
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
function clock(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function dayLabel(ts) {
  const d = new Date(ts);
  return `${DAYS[d.getDay()]} ${d.getDate()}`;
}
async function api(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

// Concrete [start, end] of a run in epoch ms; null when the log block never
// carried a start marker (those runs can't be placed on a time axis).
function runSpan(r) {
  if (!r.startedAt) return null;
  const start = new Date(r.startedAt).getTime();
  let end;
  if (r.status === 'running') end = Date.now();
  else if (r.endedAt) end = new Date(r.endedAt).getTime();
  else if (r.durationMs) end = start + r.durationMs;
  else end = start + 60e3;
  return { start, end: Math.max(end, start + 20e3) };
}

// Runs overlapping [winStart, winEnd], each with its span attached.
function runsInWindow(winStart, winEnd, issueNums) {
  const only = issueNums ? new Set(issueNums.map(String)) : null;
  const out = [];
  for (const r of state.runs) {
    if (only && !only.has(String(r.issue))) continue;
    const span = runSpan(r);
    if (!span || span.end < winStart || span.start > winEnd) continue;
    out.push({ r, span });
  }
  return out;
}

// ---------- roles: icons + colors ----------

const ROLE_ICONS = {
  implementer: '🔨', reviewer: '🔍', 'spec-writer': '📝', planner: '🗺️',
  decomposer: '🧩', merger: '🔀', filer: '📁', designer: '🎨',
};
// Dark-mode categorical slots in their validated order (see style.css note).
// Everything past the 8 named roles folds to gray — never a generated 9th hue.
const ROLE_COLORS = {
  implementer: '#3987e5',
  reviewer: '#d95926',
  'spec-writer': '#199e70',
  'pr-writer': '#c98500',
  'pr-reviewer': '#d55181',
  addresser: '#008300',
  planner: '#9085e9',
  decomposer: '#e66767',
};
const ROLE_OTHER = '#768390';
const roleColor = (role) => ROLE_COLORS[role] || ROLE_OTHER;

// ---------- agents ----------

// Median duration of finished successful runs of this role — the yardstick
// the elapsed meter fills against.
function typicalMs(role) {
  const ds = state.runs
    .filter((r) => r.role === role && r.status === 'success' && r.durationMs)
    .map((r) => r.durationMs)
    .sort((a, b) => a - b);
  return ds.length ? ds[Math.floor(ds.length / 2)] : null;
}

function timebarHtml(r) {
  const typ = typicalMs(r.role);
  const elapsed = Date.now() - new Date(r.startedAt).getTime();
  const pct = typ ? Math.min(100, (elapsed / typ) * 100) : 0;
  const over = typ && elapsed > typ;
  return `<div class="timebar" data-started="${esc(r.startedAt)}" data-typical="${typ || ''}">
    <span class="tb-clock" title="started ${esc(clock(r.startedAt))}">▶ ${esc(clock(r.startedAt))}</span>
    ${typ ? `<div class="meter"><div class="meter-fill${over ? ' over' : ''}" style="width:${pct}%"></div></div>` : '<div class="meter meter-empty"></div>'}
    <span class="tb-elapsed">${dur(elapsed)}</span>
    ${typ ? `<span class="tb-typical">/ ~${dur(typ)} typical</span>` : ''}
  </div>`;
}

// Live tick: update elapsed text + meter fill in place (no re-render, so
// scroll position and tap targets stay put).
function tickTimebars() {
  const now = Date.now();
  for (const el of document.querySelectorAll('.timebar[data-started]')) {
    const started = new Date(el.dataset.started).getTime();
    const typ = Number(el.dataset.typical) || 0;
    const elapsed = now - started;
    const val = el.querySelector('.tb-elapsed');
    if (val) val.textContent = dur(elapsed);
    const fill = el.querySelector('.meter-fill');
    if (fill && typ) {
      fill.style.width = Math.min(100, (elapsed / typ) * 100) + '%';
      fill.classList.toggle('over', elapsed > typ);
    }
  }
}

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
        r.startedAt && !runningNow ? `▶ ${clock(r.startedAt)}` : '',
        runningNow ? '' : rel(r.lastActivity),
        !runningNow && r.durationMs != null ? `took ${dur(r.durationMs)}` : '',
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
        ${runningNow && r.startedAt ? timebarHtml(r) : ''}
        ${meta ? `<div class="row2">${meta}</div>` : ''}
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
      <button class="statbtn" data-issuestats="${iss.number}" title="history &amp; stats for #${iss.number}">📊</button>
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

// ---------- range picker (shared by Timeline + Stats) ----------

const RANGES = [
  { ms: 3600e3, label: '1h' },
  { ms: 6 * 3600e3, label: '6h' },
  { ms: 12 * 3600e3, label: '12h' },
  { ms: 24 * 3600e3, label: '24h' },
  { ms: 3 * 86400e3, label: '3d' },
  { ms: 7 * 86400e3, label: '7d' },
];

function initRangeChips() {
  for (const box of document.querySelectorAll('.range-chips')) {
    box.innerHTML = RANGES.map((r) =>
      `<button class="chip${r.ms === state.range ? ' active' : ''}" data-r="${r.ms}">${r.label}</button>`).join('');
  }
}

function setRange(ms) {
  state.range = ms;
  for (const c of document.querySelectorAll('.range-chips .chip')) {
    c.classList.toggle('active', Number(c.dataset.r) === ms);
  }
  if (state.tab === 'timeline') renderTimeline();
  if (state.tab === 'stats') renderStats();
}

// ---------- timeline (vertical git-graph) ----------

// Taller windows get more pixels, but sublinearly — a 7-day wall is scrollable,
// not endless.
function tlHeight(windowMs) {
  const h = windowMs / 3600e3;
  if (h <= 1.1) return 950;
  if (h <= 6.5) return 1500;
  if (h <= 13) return 1900;
  if (h <= 26) return 2300;
  if (h <= 80) return 3000;
  return 3600;
}

function tickEvery(windowMs) {
  if (windowMs <= 2 * 3600e3) return 10 * 60e3;
  if (windowMs <= 13 * 3600e3) return 3600e3;
  if (windowMs <= 26 * 3600e3) return 2 * 3600e3;
  if (windowMs <= 80 * 3600e3) return 6 * 3600e3;
  return 24 * 3600e3;
}

function segTip(r, span, live) {
  const endTxt = r.status === 'running' && live ? 'now' : clock(span.end);
  return `${r.role}${r.issue ? ' · #' + r.issue : ''}\n${clock(span.start)} → ${endTxt} · ${dur(span.end - span.start)} · ${r.status}`;
}

// One <line> per run, rounded caps, 1px shaved per end so back-to-back runs
// keep a surface gap between them.
function segmentSvg(x, r, span, y, yMin, yMax, live) {
  let y1 = Math.max(y(span.end), yMin);
  let y2 = Math.min(y(span.start), yMax);
  if (y2 - y1 < 10) { const mid = (y1 + y2) / 2; y1 = mid - 5; y2 = mid + 5; }
  const attrs = `data-log="${esc(r.file)}" data-run="${r.runIndex}" data-title="${esc(r.role)}${r.issue ? ' · #' + esc(r.issue) : ''}"
    data-running="${r.status === 'running'}" data-issueref="${esc(r.issue || '')}" data-tip="${esc(segTip(r, span, live))}"`;
  let extra = '';
  if (r.status === 'failed' || r.status === 'interrupted') {
    extra = `<circle cx="${x}" cy="${y1 - 1}" r="5" fill="#0d1117" stroke="#d03b3b" stroke-width="2" data-tip="${esc(segTip(r, span, live))}"></circle>`;
  }
  return `<line x1="${x}" y1="${y1 + 1}" x2="${x}" y2="${y2 - 1}" stroke="${roleColor(r.role)}" stroke-width="11" stroke-linecap="round" class="tl-seg" ${attrs}></line>${extra}`;
}

// entries: [{r, span}] overlapping the window. live: winEnd ≈ now.
function timelineSVG({ entries, winStart, winEnd, width, height, live }) {
  const windowMs = winEnd - winStart;
  const tick = tickEvery(windowMs);
  const wideLabels = tick >= 6 * 3600e3;
  const trunkX = wideLabels ? 92 : 52;
  const padTop = 36, padBottom = 30;
  const y = (t) => padTop + ((winEnd - t) / windowMs) * height;
  const totalH = padTop + height + padBottom;
  const byNumber = new Map(state.issues.map((i) => [i.number, i]));

  const trunkRuns = entries.filter((e) => e.r.issue == null);
  const laneMap = new Map();
  for (const e of entries.filter((x) => x.r.issue != null)) {
    const k = String(e.r.issue);
    if (!laneMap.has(k)) laneMap.set(k, []);
    laneMap.get(k).push(e);
  }
  let lanes = [...laneMap.entries()].map(([issue, es]) => {
    es.sort((a, b) => a.span.start - b.span.start);
    return {
      issue,
      es,
      first: Math.min(...es.map((e) => e.span.start)),
      last: Math.max(...es.map((e) => e.span.end)),
      running: es.some((e) => e.r.status === 'running'),
    };
  }).sort((a, b) => a.first - b.first);

  // Lane density: shrink the gap down to 16px, then drop the oldest lanes
  // (noted below the chart — never silently).
  const rightPad = 16;
  const laneArea = width - trunkX - 26 - rightPad;
  const maxLanes = Math.max(1, Math.floor(laneArea / 20) + 1);
  let droppedNote = '';
  if (lanes.length > maxLanes) {
    const dropped = lanes.length - maxLanes;
    lanes = lanes.slice(lanes.length - maxLanes); // keep the most recent
    droppedNote = `+${dropped} older issue${dropped > 1 ? 's' : ''} not shown — narrow the range`;
  }
  const laneGap = lanes.length > 1 ? Math.min(40, laneArea / (lanes.length - 1 || 1)) : 0;
  const laneX = (i) => trunkX + 26 + i * laneGap;

  // Strict paint layers so thin chrome never crosses over data or labels:
  // gridlines → connector lines/trunk → bars & dots → text on top.
  const grid = [], lineLayer = [], marks = [], text = [];

  // hour/day gridlines + labels in the left gutter
  for (let t = Math.ceil(winStart / tick) * tick; t <= winEnd; t += tick) {
    const yy = y(t);
    if (yy < padTop + 8) continue;
    const label = tick >= 24 * 3600e3 ? dayLabel(t) : wideLabels ? `${dayLabel(t)} ${clock(t)}` : clock(t);
    grid.push(`<line x1="${trunkX - 6}" y1="${yy}" x2="${width - 4}" y2="${yy}" stroke="#1c2129" stroke-width="1"></line>`);
    text.push(`<text x="${trunkX - 10}" y="${yy + 3.5}" text-anchor="end" class="tickl">${esc(label)}</text>`);
  }

  // trunk (main branch)
  lineLayer.push(`<line x1="${trunkX}" y1="${padTop}" x2="${trunkX}" y2="${padTop + height}" stroke="#2d333b" stroke-width="3"></line>`);

  // top edge: "now" (or the window end) marker
  const topLabel = live ? `now · ${clock(winEnd)}` : `${dayLabel(winEnd)} ${clock(winEnd)}`;
  grid.push(`<line x1="${trunkX - 6}" y1="${padTop}" x2="${width - 4}" y2="${padTop}" stroke="#23582f" stroke-width="1"></line>`);
  text.push(`<text x="${trunkX + 12}" y="${padTop - 8}" class="nowl">${esc(topLabel)}</text>`);
  text.push(`<text x="${trunkX + 12}" y="${padTop + height + 16}" class="tickl">${esc(`${dayLabel(winStart)} ${clock(winStart)}`)}</text>`);
  if (live && trunkRuns.some((e) => e.r.status === 'running')) {
    marks.push(`<circle cx="${trunkX}" cy="${padTop}" r="5" fill="#3fb950" class="pulse-svg"></circle>`);
  }

  // main-scope runs live on the trunk itself
  for (const e of trunkRuns) marks.push(segmentSvg(trunkX, e.r, e.span, y, padTop, padTop + height, live));

  // merge dots: every PR merged inside the window sits on the trunk
  for (const p of state.prs) {
    if (!p.mergedAt) continue;
    const t = new Date(p.mergedAt).getTime();
    if (t < winStart || t > winEnd) continue;
    marks.push(`<a href="${esc(p.url)}" target="_blank" rel="noopener">
      <circle cx="${trunkX}" cy="${y(t)}" r="5" fill="#bc8cff" stroke="#0d1117" stroke-width="2"
        data-tip="${esc(`PR #${p.number} merged · ${dayLabel(t)} ${clock(t)}\n${p.title}`)}"></circle></a>`);
  }

  lanes.forEach((lane, i) => {
    const lx = laneX(i);
    const iss = byNumber.get(Number(lane.issue));

    // where does this branch rejoin the trunk? PR merge time, else issue close
    let mergeT = null;
    for (const p of state.prs) {
      if (!p.mergedAt || !p.linkedIssues.includes(Number(lane.issue))) continue;
      const t = new Date(p.mergedAt).getTime();
      if (t >= lane.first - 60e3 && t <= winEnd && (mergeT == null || t > mergeT)) mergeT = t;
    }
    if (mergeT == null && iss && iss.closedAt) {
      const t = new Date(iss.closedAt).getTime();
      if (t >= lane.first - 60e3 && t <= winEnd) mergeT = t;
    }

    const laneEndT = lane.running ? winEnd : Math.max(lane.last, mergeT || 0);
    const yBottom = Math.min(y(lane.first), padTop + height);
    const yTop = Math.max(y(laneEndT), padTop);

    // base line under the segments (bridges gaps between runs)
    lineLayer.push(`<line x1="${lx}" y1="${yTop}" x2="${lx}" y2="${yBottom}" stroke="#2c3542" stroke-width="1.5"></line>`);

    // fork out of the trunk (only when the branch point is inside the window)
    if (lane.first >= winStart) {
      const y0 = Math.min(yBottom + 24, padTop + height + 12);
      const ym = (y0 + yBottom) / 2;
      lineLayer.push(`<path d="M ${trunkX} ${y0} C ${trunkX} ${ym}, ${lx} ${y0}, ${lx} ${yBottom}" fill="none" stroke="#2c3542" stroke-width="1.5"></path>`);
    }
    // merge back into the trunk
    if (mergeT != null && !lane.running) {
      const my = Math.max(y(mergeT), padTop);
      const ym = my + 10;
      lineLayer.push(`<path d="M ${lx} ${my + 20} C ${lx} ${ym}, ${trunkX} ${my + 20}, ${trunkX} ${my}" fill="none" stroke="#2c3542" stroke-width="1.5"></path>`);
    }

    for (const e of lane.es) marks.push(segmentSvg(lx, e.r, e.span, y, padTop, padTop + height, live));

    if (lane.running) marks.push(`<circle cx="${lx}" cy="${padTop}" r="5" fill="#3fb950" class="pulse-svg"></circle>`);

    const title = iss ? `#${lane.issue} ${iss.title}` : `#${lane.issue}`;
    text.push(`<text x="${lx}" y="${Math.max(yTop - 10, 12)}" text-anchor="middle" class="tl-issuenum"
      data-issuestats="${esc(lane.issue)}" data-tip="${esc(title)}">#${esc(lane.issue)}</text>`);
    if (yBottom - yTop > 240) {
      text.push(`<text x="${lx}" y="${Math.min(yBottom + 36, totalH - 4)}" text-anchor="middle" class="tl-issuenum"
        data-issuestats="${esc(lane.issue)}" data-tip="${esc(title)}">#${esc(lane.issue)}</text>`);
    }
  });

  return {
    svg: `<svg viewBox="0 0 ${width} ${totalH}" width="${width}" height="${totalH}" xmlns="http://www.w3.org/2000/svg">${grid.join('')}${lineLayer.join('')}${marks.join('')}${text.join('')}</svg>`,
    droppedNote,
    roles: [...new Set(entries.map((e) => e.r.role))],
  };
}

function timelineLegendHtml(roles) {
  const named = roles.filter((r) => ROLE_COLORS[r]);
  const other = roles.some((r) => !ROLE_COLORS[r]);
  return [
    ...named.map((r) => `<span><span class="swatch" style="background:${roleColor(r)}"></span>${esc(r)}</span>`),
    other ? `<span><span class="swatch" style="background:${ROLE_OTHER}"></span>other</span>` : '',
    `<span><span class="tdot merged"></span> PR merged</span>`,
    `<span><span class="tdot" style="background:#0d1117;border:2px solid #d03b3b;width:7px;height:7px"></span> failed</span>`,
    `<span><span class="dot pulse"></span> running</span>`,
  ].filter(Boolean).join('');
}

function renderTimeline() {
  const wrap = $('#tl-wrap');
  const winEnd = Date.now();
  const winStart = winEnd - state.range;
  const entries = runsInWindow(winStart, winEnd);
  if (!entries.length) {
    $('#tl-legend').innerHTML = '';
    wrap.innerHTML = '<div class="empty">No agent activity in this window</div>';
    return;
  }
  const width = Math.max(340, (wrap.clientWidth || 700) - 14);
  const { svg, droppedNote, roles } = timelineSVG({
    entries, winStart, winEnd, width, height: tlHeight(state.range), live: true,
  });
  $('#tl-legend').innerHTML = timelineLegendHtml(roles);
  wrap.innerHTML = svg + (droppedNote ? `<div class="tl-note">${esc(droppedNote)}</div>` : '');
}

// ---------- stats ----------

const CAT_LIST = [
  ['verify', 'tests / verify'],
  ['edit', 'edit / write'],
  ['explore', 'read / search'],
  ['git', 'git / github'],
  ['think', 'thinking'],
  ['other', 'other / sync'],
];

function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

function tile(label, value, sub) {
  return `<div class="tile"><div class="t-label">${esc(label)}</div><div class="t-value">${value}</div>${sub ? `<div class="t-sub">${esc(sub)}</div>` : ''}</div>`;
}

function statSection(title, body) {
  return `<div class="card statcard"><div class="sec-title">${esc(title)}</div>${body}</div>`;
}

// Aggregate the per-run category breakdowns for a set of run ids.
function catTotals(runIds) {
  const totals = {};
  let sum = 0;
  for (const id of runIds) {
    const c = state.cats[id];
    if (!c) continue;
    for (const [k, ms] of Object.entries(c)) { totals[k] = (totals[k] || 0) + ms; sum += ms; }
  }
  return { totals, sum };
}

function catCakeHtml(runIds) {
  const { totals, sum } = catTotals(runIds);
  if (!sum) return '<div class="empty" style="padding:12px 0">No breakdown yet (stats refresh every few minutes)</div>';
  const cats = CAT_LIST.filter(([k]) => totals[k] > 0).map(([k, label]) => ({ k, label, ms: totals[k], pct: Math.round((totals[k] / sum) * 100) }));
  return `
    <div class="cake">${cats.map((c) => `<span class="seg" style="flex-grow:${c.ms};background:var(--cat-${c.k})"
      data-tip="${esc(`${c.label} — ${dur(c.ms)} (${c.pct}%)`)}"></span>`).join('')}</div>
    <div class="cake-legend">${cats.map((c) => `<span class="cl-row"><span class="swatch" style="background:var(--cat-${c.k})"></span>${esc(c.label)} <b>${dur(c.ms)}</b> · ${c.pct}%</span>`).join('')}</div>`;
}

function renderStats() {
  const body = $('#stats-body');
  const winEnd = Date.now();
  const winStart = winEnd - state.range;
  const entries = runsInWindow(winStart, winEnd);
  const rangeLabel = (RANGES.find((r) => r.ms === state.range) || { label: '' }).label;
  if (!entries.length) {
    body.innerHTML = '<div class="empty">No agent activity in this window</div>';
    return;
  }

  const clip = (e) => Math.min(e.span.end, winEnd) - Math.max(e.span.start, winStart);
  const finished = entries.filter((e) => e.r.status !== 'running');
  const ok = finished.filter((e) => e.r.status === 'success').length;
  const failed = finished.filter((e) => e.r.status === 'failed').length;
  const interrupted = finished.filter((e) => e.r.status === 'interrupted').length;
  const agentMs = entries.reduce((a, e) => a + clip(e), 0);
  const issuesTouched = new Set(entries.filter((e) => e.r.issue != null).map((e) => String(e.r.issue))).size;
  const runningNow = entries.filter((e) => e.r.status === 'running').length;

  const kpis = `<div class="kpis">
    ${tile('Agent runs', String(entries.length), runningNow ? `${runningNow} running now` : `last ${rangeLabel}`)}
    ${tile('Success rate', finished.length ? Math.round((ok / finished.length) * 100) + '%' : '—', `${ok} ok · ${failed} failed · ${interrupted} cut short`)}
    ${tile('Agent time', dur(agentMs), 'busy time inside window')}
    ${tile('Issues touched', String(issuesTouched), `last ${rangeLabel}`)}
  </div>`;

  // -- time share by role (part-to-whole stacked bar, categorical colors)
  const byRole = new Map();
  for (const e of entries) byRole.set(e.r.role, (byRole.get(e.r.role) || 0) + clip(e));
  let roleRows = [...byRole.entries()].sort((a, b) => b[1] - a[1]);
  if (roleRows.length > 6) {
    const rest = roleRows.slice(5).reduce((a, x) => a + x[1], 0);
    roleRows = roleRows.slice(0, 5).concat([['other', rest]]);
  }
  const roleSum = roleRows.reduce((a, x) => a + x[1], 0) || 1;
  const roleShare = `
    <div class="cake">${roleRows.map(([role, ms]) => `<span class="seg" style="flex-grow:${ms};background:${role === 'other' ? ROLE_OTHER : roleColor(role)}"
      data-tip="${esc(`${role} — ${dur(ms)} (${Math.round((ms / roleSum) * 100)}%)`)}"></span>`).join('')}</div>
    <div class="cake-legend">${roleRows.map(([role, ms]) => `<span class="cl-row"><span class="swatch" style="background:${role === 'other' ? ROLE_OTHER : roleColor(role)}"></span>${esc(role)} <b>${dur(ms)}</b> · ${Math.round((ms / roleSum) * 100)}%</span>`).join('')}</div>`;

  // -- duration per role: median bar + p90 whisker (one hue: it's magnitude)
  const dursByRole = new Map();
  for (const e of finished) {
    if (!e.r.durationMs) continue;
    if (!dursByRole.has(e.r.role)) dursByRole.set(e.r.role, []);
    dursByRole.get(e.r.role).push(e.r.durationMs);
  }
  const durRows = [...dursByRole.entries()].map(([role, ds]) => {
    ds.sort((a, b) => a - b);
    return { role, n: ds.length, med: quantile(ds, 0.5), p90: quantile(ds, 0.9) };
  }).sort((a, b) => b.med - a.med);
  const maxP90 = Math.max(...durRows.map((r) => r.p90), 1);
  const durationChart = durRows.length ? durRows.map((r) => `
    <div class="hrow" data-tip="${esc(`${r.role} · ${r.n} runs\nmedian ${dur(r.med)} · p90 ${dur(r.p90)}`)}">
      <span class="h-label">${esc(r.role)}</span>
      <div class="h-track">
        <div class="h-p90" style="width:${(r.p90 / maxP90) * 100}%"></div>
        <div class="h-bar" style="width:${(r.med / maxP90) * 100}%"></div>
      </div>
      <span class="h-val">${dur(r.med)} <span class="h-p90l">· p90 ${dur(r.p90)}</span></span>
    </div>`).join('') : '<div class="empty" style="padding:8px 0">No finished runs in window</div>';

  // -- activity histogram: agent-minutes per bucket across the window
  const BUCKETS = 36;
  const bMs = state.range / BUCKETS;
  const buckets = new Array(BUCKETS).fill(0);
  for (const e of entries) {
    const s = Math.max(e.span.start, winStart), en = Math.min(e.span.end, winEnd);
    let b0 = Math.floor((s - winStart) / bMs), b1 = Math.min(BUCKETS - 1, Math.floor((en - winStart) / bMs));
    for (let b = b0; b <= b1; b++) {
      const bs = winStart + b * bMs, be = bs + bMs;
      buckets[b] += Math.max(0, Math.min(en, be) - Math.max(s, bs));
    }
  }
  const maxB = Math.max(...buckets, 1);
  const maxIdx = buckets.indexOf(maxB);
  const wideAxis = state.range > 26 * 3600e3;
  const axisAt = (t) => wideAxis ? `${dayLabel(t)} ${clock(t)}` : clock(t);
  const histogram = `
    <div class="histo">${buckets.map((v, i) => {
      const bs = winStart + i * bMs;
      return `<div class="hb-slot" data-tip="${esc(`${axisAt(bs)} – ${axisAt(bs + bMs)}\n${dur(v)} agent time`)}">
        ${i === maxIdx && v > 0 ? `<span class="hb-max">${dur(v)}</span>` : ''}
        <div class="hb" style="height:${Math.max(v > 0 ? 3 : 0, (v / maxB) * 56)}px"></div>
      </div>`;
    }).join('')}</div>
    <div class="histo-axis"><span>${esc(axisAt(winStart))}</span><span>${esc(axisAt(winStart + state.range / 2))}</span><span>now</span></div>`;

  // -- outcomes per role (the table twin for everything above)
  const outcome = new Map();
  for (const e of entries) {
    if (!outcome.has(e.r.role)) outcome.set(e.r.role, { runs: 0, ok: 0, failed: 0, interrupted: 0, running: 0 });
    const o = outcome.get(e.r.role);
    o.runs++;
    if (e.r.status === 'success') o.ok++;
    else if (e.r.status === 'failed') o.failed++;
    else if (e.r.status === 'interrupted') o.interrupted++;
    else if (e.r.status === 'running') o.running++;
  }
  const table = `<table class="stat-table">
    <thead><tr><th>role</th><th>runs</th><th>ok</th><th>failed</th><th>cut</th><th>live</th></tr></thead>
    <tbody>${[...outcome.entries()].sort((a, b) => b[1].runs - a[1].runs).map(([role, o]) =>
      `<tr><td>${esc(role)}</td><td>${o.runs}</td><td>${o.ok}</td><td>${o.failed || ''}</td><td>${o.interrupted || ''}</td><td>${o.running || ''}</td></tr>`).join('')}</tbody>
  </table>`;

  // -- busiest issues by agent time (single hue: magnitude)
  const byIssue = new Map();
  for (const e of entries) {
    if (e.r.issue == null) continue;
    const k = String(e.r.issue);
    byIssue.set(k, (byIssue.get(k) || 0) + clip(e));
  }
  const issRows = [...byIssue.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxIss = Math.max(...issRows.map((x) => x[1]), 1);
  const byNumber = new Map(state.issues.map((i) => [i.number, i]));
  const issueChart = issRows.length ? issRows.map(([n, ms]) => {
    const iss = byNumber.get(Number(n));
    return `<div class="hrow" data-tip="${esc(`#${n}${iss ? ' ' + iss.title : ''}\n${dur(ms)} agent time`)}">
      <span class="h-label"><a class="chip-link" data-issuestats="${esc(n)}" href="#stats">#${esc(n)}</a></span>
      <div class="h-track"><div class="h-bar" style="width:${(ms / maxIss) * 100}%"></div></div>
      <span class="h-val">${dur(ms)}</span>
    </div>`;
  }).join('') : '<div class="empty" style="padding:8px 0">No issue-scoped runs</div>';

  body.innerHTML = kpis +
    statSection('Where the time went', catCakeHtml(entries.map((e) => e.r.id))) +
    statSection('Agent time by role', roleShare) +
    statSection('Run duration by role — median, p90 whisker', durationChart) +
    statSection('Activity over the window', histogram) +
    statSection('Busiest issues', issueChart) +
    statSection('Outcomes by role', table);
}

// ---------- per-issue detail (timeline + stats + history) ----------

function openIssueDetail(n) {
  state.issueDetail = Number(n);
  showView('issue');
  renderIssueDetail();
  refreshStats(); // pick up category breakdowns if stale
}

function renderIssueDetail() {
  const n = state.issueDetail;
  if (n == null) return;
  const body = $('#issue-body');
  const iss = state.issues.find((i) => i.number === n);
  $('#issue-head-title').innerHTML = `#${n} ${esc(iss ? iss.title : '')}
    ${iss ? `<span class="badge st-${iss.state === 'OPEN' ? 'open' : 'closed'}">${iss.state.toLowerCase()}</span>` : ''}
    ${iss ? `<a class="gh-link" href="${esc(iss.url)}" target="_blank" rel="noopener">↗</a>` : ''}`;

  // roll sub-issues into the parent's page — that's where the actual runs live
  const family = [n, ...((iss && iss.subIssues) || [])];
  const familySet = new Set(family.map(String));
  const entries = state.runs
    .map((r) => ({ r, span: runSpan(r) }))
    .filter((e) => familySet.has(String(e.r.issue)) && e.span)
    .sort((a, b) => a.span.start - b.span.start);

  const prs = state.prs.filter((p) => p.linkedIssues.some((x) => familySet.has(String(x))));

  const links = (prs.length || family.length > 1 || (iss && iss.parent) ? `<div class="card"><div class="row2" style="margin:0">
    ${iss && iss.parent ? `<a class="chip-link" data-issuestats="${iss.parent}" href="#issue">parent #${iss.parent}</a>` : ''}
    ${family.slice(1).map((s) => `<a class="chip-link" data-issuestats="${s}" href="#issue">sub #${s}</a>`).join(' ')}
    ${prs.map((p) => `<a class="chip-link" href="${esc(p.url)}" target="_blank" rel="noopener">PR #${p.number} · ${esc(p.state.toLowerCase())}</a>`).join(' ')}
  </div></div>` : '');

  if (!entries.length) {
    body.innerHTML = links + '<div class="empty">No agent runs recorded for this issue</div>';
    return;
  }

  const finished = entries.filter((e) => e.r.status !== 'running');
  const okN = finished.filter((e) => e.r.status === 'success').length;
  const agentMs = entries.reduce((a, e) => a + (e.span.end - e.span.start), 0);
  const first = Math.min(...entries.map((e) => e.span.start));
  const last = Math.max(...entries.map((e) => e.span.end));
  const stillRunning = entries.some((e) => e.r.status === 'running');

  const kpis = `<div class="kpis">
    ${tile('Agent time', dur(agentMs), `${entries.length} runs`)}
    ${tile('Wall clock', stillRunning ? dur(Date.now() - first) + '…' : dur(last - first), `${dayLabel(first)} ${clock(first)} → ${stillRunning ? 'now' : clock(last)}`)}
    ${tile('Success rate', finished.length ? Math.round((okN / finished.length) * 100) + '%' : '—', `${okN}/${finished.length} finished ok`)}
    ${tile('Agents involved', String(new Set(entries.map((e) => e.r.role)).size), [...new Set(entries.map((e) => e.r.role))].slice(0, 4).join(', '))}
  </div>`;

  // timeline scoped to this issue's life, padded 4% each side
  const pad = Math.max((last - first) * 0.04, 5 * 60e3);
  const winStart = first - pad;
  const winEnd = stillRunning ? Date.now() : last + pad;
  const spanH = Math.min(1200, Math.max(420, ((winEnd - winStart) / 3600e3) * 240));
  const width = Math.max(320, (body.clientWidth || 680) - 40);
  const { svg, roles } = timelineSVG({
    entries: entries.filter((e) => e.span.end >= winStart && e.span.start <= winEnd),
    winStart, winEnd, width, height: spanH, live: stillRunning,
  });
  const timeline = statSection('Timeline', `<div class="legend">${timelineLegendHtml(roles)}</div><div class="tl-inline">${svg}</div>`);

  // chronological history — what ran, in what order, and how it went
  const history = statSection('History', `<div class="hist">${entries.map((e) => {
    const r = e.r;
    const icon = ROLE_ICONS[r.role] || '🤖';
    const runningNow = r.status === 'running';
    return `<div class="card tappable hist-item" data-log="${esc(r.file)}" data-run="${r.runIndex}"
        data-title="${esc(r.role)} · #${esc(r.issue)}" data-running="${runningNow}" data-issueref="${esc(r.issue)}">
      <span class="hist-dot" style="background:${roleColor(r.role)}"></span>
      <div class="row1">
        ${runningNow ? '<span class="dot pulse"></span>' : ''}
        <span>${icon}</span><span class="role">${esc(r.role)}</span>
        ${String(r.issue) !== String(n) ? `<span class="tnum">#${esc(r.issue)}</span>` : ''}
        <span class="spacer"></span><span class="badge st-${r.status}">${r.status}</span>
      </div>
      <div class="row2">${esc(`${dayLabel(e.span.start)} ${clock(e.span.start)}`)} · ${runningNow ? esc(dur(Date.now() - e.span.start)) + ' elapsed' : esc(dur(e.span.end - e.span.start))}</div>
      ${r.error ? `<div class="errline">${esc(r.error)}</div>` : ''}
    </div>`;
  }).join('')}</div>`);

  const cake = statSection('Where the time went', catCakeHtml(entries.map((e) => e.r.id)));

  body.innerHTML = kpis + links + timeline + history + cake;
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
    links.push(`<a class="chip-link" data-issuestats="${esc(issue)}" href="#issue">history</a>`);
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

// ---------- docs ----------

// Long-form write-ups from the repo's archive/articles, served by the panel so
// they're readable on a phone without cloning anything.
function renderDocs() {
  const list = $('#doc-list');
  if (!state.docs.length) {
    list.innerHTML = '<div class="empty">No articles in <code>archive/articles</code></div>';
    return;
  }
  list.innerHTML = state.docs.map((d) => `
    <div class="card">
      <div class="row1">
        <span class="issue-title">📖 ${esc(d.title)}</span>
        <span class="spacer"></span>
        <a class="gh-link" href="${esc(d.url)}" target="_blank" rel="noopener">Read ↗</a>
      </div>
      ${d.blurb ? `<div class="row2">${esc(d.blurb)}</div>` : ''}
      <div class="row2">
        ${rel(d.updatedAt)} · ${d.sizeKb} KB · <code>${esc(d.name)}</code>
        ${d.markdownUrl ? `<a class="chip-link" href="${esc(d.markdownUrl)}" target="_blank" rel="noopener">markdown</a>` : ''}
      </div>
    </div>`).join('');
}

async function refreshDocs() {
  try {
    const data = await api('/api/docs');
    state.docs = data.docs || [];
    if (state.tab === 'docs') renderDocs();
  } catch { /* transient */ }
}

// ---------- navigation / refresh loops ----------

function showView(tab) {
  state.tab = tab;
  for (const v of document.querySelectorAll('.view')) v.hidden = true;
  $(`#view-${tab}`).hidden = false;
  for (const b of document.querySelectorAll('nav button')) b.classList.toggle('active', b.dataset.tab === tab);
  if (tab !== 'log') state.log = null;
  if (tab !== 'issue') state.issueDetail = null;
  window.scrollTo(0, 0);
}

function render() {
  if (state.tab === 'agents') renderAgents();
  else if (state.tab === 'issues') renderIssues();
  else if (state.tab === 'prs') renderPrs();
  else if (state.tab === 'timeline') renderTimeline();
  else if (state.tab === 'stats') renderStats();
  else if (state.tab === 'issue') renderIssueDetail();
  else if (state.tab === 'docs') renderDocs();
}

async function refreshAgents() {
  try {
    const data = await api('/api/agents');
    state.runs = data.runs || [];
    if (state.tab === 'agents') renderAgents();
    if (state.tab === 'issues') renderIssues(); // agent chips inside issues
    if (state.tab === 'timeline') renderTimeline();
    if (state.tab === 'stats') renderStats();
    if (state.tab === 'issue') renderIssueDetail();
  } catch { /* transient */ }
}
async function refreshGh() {
  try {
    const [i, p] = await Promise.all([api('/api/issues'), api('/api/prs')]);
    state.issues = i.issues || [];
    state.prs = p.prs || [];
    if (state.tab === 'issues') renderIssues();
    if (state.tab === 'prs') renderPrs();
    if (state.tab === 'issue') renderIssueDetail();
  } catch { /* transient */ }
}
async function refreshStats() {
  try {
    const data = await api('/api/stats');
    state.cats = data.cats || {};
    if (state.tab === 'stats') renderStats();
    if (state.tab === 'issue') renderIssueDetail();
  } catch { /* transient */ }
}

document.addEventListener('click', (e) => {
  const nav = e.target.closest('nav button');
  if (nav) {
    showView(nav.dataset.tab);
    render();
    if (nav.dataset.tab === 'docs') refreshDocs(); // cheap, and picks up new articles
    if (nav.dataset.tab === 'stats' || nav.dataset.tab === 'timeline') refreshStats();
    return;
  }

  const rangeEl = e.target.closest('.range-chips .chip');
  if (rangeEl) { setRange(Number(rangeEl.dataset.r)); return; }

  const statsEl = e.target.closest('[data-issuestats]');
  if (statsEl) {
    e.preventDefault();
    openIssueDetail(statsEl.dataset.issuestats);
    return;
  }

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
$('#issue-back').addEventListener('click', () => { showView('issues'); renderIssues(); });
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

// ---------- hover tooltips (desktop) ----------

const tipEl = $('#tl-tip');
document.addEventListener('mouseover', (e) => {
  const t = e.target.closest && e.target.closest('[data-tip]');
  if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.dataset.tip; // textContent: tip strings carry untrusted titles
  tipEl.hidden = false;
});
document.addEventListener('mousemove', (e) => {
  if (tipEl.hidden) return;
  const pad = 12;
  let x = e.clientX + pad, y = e.clientY + pad;
  const r = tipEl.getBoundingClientRect();
  if (x + r.width > window.innerWidth - 8) x = e.clientX - r.width - pad;
  if (y + r.height > window.innerHeight - 8) y = e.clientY - r.height - pad;
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
});
document.addEventListener('mouseout', (e) => {
  if (e.target.closest && e.target.closest('[data-tip]')) tipEl.hidden = true;
});

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

initRangeChips();
refreshAgents();
refreshGh();
refreshDocs();
refreshSc();
refreshStats();
setInterval(refreshSc, 5000);
setInterval(refreshAgents, 5000);
setInterval(refreshGh, 45000);
setInterval(refreshStats, 120000);
setInterval(tickTimebars, 1000);
setInterval(() => { if (state.tab === 'log' && state.log && state.log.running) { refreshLog(); refreshSummary(); } }, 4000);
