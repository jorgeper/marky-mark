# Marky Mark control panel

Mobile-friendly web dashboard for watching sandcastle agents, GitHub issues (with sub-issues), and PRs.

Zero dependencies — plain Node.

```sh
MARKY_REPO=/workspace/marky-mark PORT=8080 KEY=<secret> node server.js
```

- `MARKY_REPO` — repo checkout whose `.sandcastle/logs` to watch (defaults to walking up from this folder).
- `KEY` — optional access key; visitors must open the URL once with `?key=<secret>` (a cookie remembers it).
- Requires `gh` authenticated for the issues/PRs tabs.

The ▶ button in the header starts `npm run sandcastle` (detached, output appended to `.sandcastle/logs/main-orchestrator.log`, pidfile `/tmp/sandcastle-orchestrator.pid`). It becomes a ⏹ stop button for panel-started runs; runs started elsewhere show as a disabled "running" pill.

Every start is wrapped in `flock -n .sandcastle/logs/orchestrator.lock`, and the status check probes that same lock, so the panel both refuses to start a second orchestrator and can *see* one running on the VPS host — which `pgrep` in this container cannot. The lock path is deliberately inside the repo rather than `/tmp`: the host and this container do not share `/tmp`, but they do share the repo bind mount, and flock locks the inode. A host-side supervisor loop must take the same lock to be visible here:

```bash
while true; do
  echo "=== $(date -Is) ==="
  flock -n .sandcastle/logs/orchestrator.lock npm run sandcastle
  sleep 300
done 2>&1 | tee -a .sandcastle/logs/main-orchestrator.log
```

Data sources:
- **Agents** — parsed from `.sandcastle/logs/*.log` (`--- Run started ---` blocks) + `timings.jsonl`. A run with no completion marker and a log file modified in the last 3 minutes counts as *running*.
- **Issues** — `gh issue list` + the sub-issues REST API, nested parent → children.
- **PRs** — `gh pr list`, linked to issues via branch names (`issue-N`) and `#N` in titles.
