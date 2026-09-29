#!/usr/bin/env node
// killer-saas mechanical helpers. Every answer is derived from files and git — no state file.
// Run `git fetch` first: the target branch is read from `origin/<target>` when it exists,
// because with `Merge mode: pr` merges happen on the remote and the local branch lags.
//
//   budget                      session budget → how many subagents may run at once
//   deps <id>...                unmet dependencies (a dependency is met once shipped)
//   conflicts <id>... [--running=<id,…>]   what may be planned and executed now without collisions;
//                               --running names the stories whose implementer the conductor launched
//   stale <id>...               what moved on the target since each plan's `base:`
//   footprint-check <id>...     files the branch really touches that its footprint does not declare
//   next-adr                    next free ADR number, across the target and every worktree
//   slot <id> [--write]         per-worktree ports, so parallel worktrees never share one
//   verif-current <id>          does docs/verif/<id>.md still describe the committed code?
//
// Exit codes: 0 clear · 1 negative answer (unmet, stale, extra files, record not current) · 2 usage or setting error.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
const tryGit = (...args) => { try { return git(...args) } catch { return null } }
const die = (msg, code = 2) => { process.stderr.write(`ks: ${msg}\n`); process.exit(code) }
const out = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n')

const top = tryGit('rev-parse', '--show-toplevel') ?? die('not inside a git repository')
// The repository base directory: the first entry of `git worktree list`, whatever worktree we run from.
const base = (tryGit('worktree', 'list', '--porcelain') ?? '').split('\n').find((l) => l.startsWith('worktree '))?.slice(9) ?? top

// ---------- settings (AGENTS.local.md: `Name: value`, everything after the colon, trimmed) ----------
const localFile = [join(top, 'AGENTS.local.md'), join(base, 'AGENTS.local.md')].find(existsSync)
if (!localFile) die('no AGENTS.local.md — run /ks-setup')
const localText = readFileSync(localFile, 'utf8')
function setting(name, { optional = false } = {}) {
  const m = localText.match(new RegExp(`^${name.replace(/ /g, ' +')}:[ \\t]*(.+)$`, 'm'))
  if (!m) return optional ? null : die(`missing setting "${name}" in AGENTS.local.md`)
  const v = m[1].trim()
  return v === '—' ? null : v
}
const list = (v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [])
const num = (name) => {
  const v = setting(name)
  if (v === null || Number.isNaN(Number(v))) die(`setting "${name}" must be a number`)
  return Number(v)
}
const target = () => setting('Target branch') ?? die('Target branch is — ; nothing to compare against')
let _ref
const targetRef = () => (_ref ??= tryGit('rev-parse', '--verify', '--quiet', `origin/${target()}`) ? `origin/${target()}` : target())
const worktreeRoot = () => join(base, setting('Worktree root', { optional: true }) ?? '.worktrees/')
const wt = (id) => join(worktreeRoot(), id)

// ---------- paths and globs ----------
const literalPrefix = (p) => p.split(/[*?[{]/)[0]
const globRe = (g) => new RegExp('^' + g.replace(/^\.\//, '').replace(/[.+^$()|\\]/g, '\\$&')
  .replace(/\*\*\/?/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/\u0000/g, '(.*/)?') + (g.endsWith('/') ? '.*' : '(/.*)?') + '$')
const matchesAny = (path, globs) => globs.some((g) => globRe(g).test(path))
// Two entries overlap when one's literal prefix contains the other's. Deliberately wide:
// a false conflict costs a wave, a missed one costs a broken merge.
function overlaps(a, b) {
  const pa = literalPrefix(a), pb = literalPrefix(b)
  if (pa === '' || pb === '') return true
  return pa.startsWith(pb) || pb.startsWith(pa)
}
// A footprint entry as a human may write it → a repository path, or null when it is not one.
function normalize(entry) {
  let p = entry.replace(/\s+#.*$/, '').replace(/[`"']/g, '').trim().replace(/:\d+(-\d+)?$/, '').replace(/^\.?\//, '')
  if (!p || /[\s<>]/.test(p)) return null
  return p
}
const union = () => list(setting('Union paths'))
const exclusive = () => list(setting('Exclusive paths'))

// ---------- stories ----------
let _stories
function readStories() {
  if (_stories) return _stories
  const file = [join(top, 'docs/stories.md'), join(base, 'docs/stories.md')].find(existsSync) ?? die('no docs/stories.md')
  const stories = parseStories(readFileSync(file, 'utf8'))
  const resolve = (tok) => stories.has(tok) ? tok : [...stories.keys()].find((k) => k.startsWith(tok + '-')) ?? null
  for (const st of stories.values()) st.deps = [...new Set(st.rawDeps.map(resolve).filter((d) => d && d !== st.id))]
  return (_stories = { stories, resolve })
}
function parseStories(text) {
  const stories = new Map()
  for (const s of text.split(/^## Story /m).slice(1)) {
    const id = s.match(/^(s\d+[a-z0-9]*(?:-[a-z0-9]+)*)/)?.[1]
    if (!id) continue
    const deps = s.match(/^### Dependencies\s*\n([\s\S]*?)(?=^###|^---|(?![\s\S]))/m)?.[1] ?? ''
    stories.set(id, { id, text: s.trim(), rawDeps: deps.match(/\bs\d+[a-z0-9]*(?:-[a-z0-9]+)*/g) ?? [] })
  }
  return stories
}
const resolveIds = (ids) => ids.map((t) => readStories().resolve(t) ?? die(`unknown story "${t}" — not in docs/stories.md`))
// Shipped = its review is on the target and its last verdict says yes (reviews reach it only through a merge).
function shipped(id) {
  const text = tryGit('show', `${targetRef()}:docs/reviews/${id}.md`)
  const verdicts = text ? [...text.matchAll(/^Ship allowed:\s*(\w+)/gm)] : []
  return verdicts.length > 0 && verdicts.at(-1)[1] === 'yes'
}
function unmetDeps(id, seen = new Set()) {
  for (const d of readStories().stories.get(id)?.deps ?? []) {
    if (seen.has(d) || shipped(d)) continue
    seen.add(d); unmetDeps(d, seen)
  }
  return [...seen]
}

// ---------- plans and branches ----------
function planOf(id) {
  const file = [join(wt(id), 'docs/plans', `${id}.md`), join(top, 'docs/plans', `${id}.md`)].find(existsSync)
  if (!file) return null
  const text = readFileSync(file, 'utf8')
  const fm = text.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? ''
  const scalar = (k) => fm.match(new RegExp(`^${k}:[ \\t]*(.*)$`, 'm'))?.[1].trim() || null
  const block = fm.match(/^footprint:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)*)/m)?.[1]
  const inline = fm.match(/^footprint:[ \t]*\[(.*)\]/m)?.[1]
  const raw = inline !== undefined ? inline.split(',') : block ? block.split('\n').map((l) => l.replace(/^[ \t]*-[ \t]*/, '')) : []
  const entries = raw.map((r) => r.trim()).filter(Boolean)
  const normalized = entries.map(normalize)
  const invalid = entries.filter((_, i) => normalized[i] === null)
  // Declared, complete and path-shaped, or unknown. Never "touches nothing".
  const footprint = entries.length && !invalid.length ? [...new Set(normalized)] : null
  const baseSha = normalize(scalar('base') ?? '') && /^[0-9a-f]{7,40}$/.test(scalar('base')) ? scalar('base') : null
  return { file, text, validated: scalar('validated') === 'yes', base: baseSha, track: scalar('track'), footprint, invalid }
}
// Files the story's branch really changes: committed since it left the target, plus uncommitted
// work (the implementer commits once, at the end). Union paths excluded.
function touched(id) {
  const dir = wt(id)
  if (!existsSync(dir)) return []
  const branch = `feature/${id}`
  const mb = tryGit('merge-base', targetRef(), branch)
  const committed = mb ? (tryGit('diff', '--name-only', mb, branch) ?? '').split('\n') : []
  const dirty = (tryGit('-C', dir, 'status', '--porcelain') ?? '').split('\n').map((l) => l.slice(3).split(' -> ').at(-1))
  return [...new Set([...committed, ...dirty].filter((f) => f && !matchesAny(f, union())))]
}
// Paths a research or flow plan cites — what the facts were read from.
function reads(id) {
  const files = [join(wt(id), 'docs/research', `${id}.md`), planOf(id)?.file].filter((f) => f && existsSync(f))
  const cited = files.flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/`([^`\s]+\/[^`\s]+?)(?::\d+(?:-\d+)?)?`/g)].map((m) => normalize(m[1])))
  return [...new Set(cited.filter((p) => p && /\.[a-z0-9]+$|\/$/.test(p)))]
}

// ---------- commands ----------
const [cmd, ...rest] = process.argv.slice(2)
const args = rest.filter((a) => !a.startsWith('--'))
const flag = (name) => rest.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? null

if (cmd === 'budget') {
  const maxParallel = num('Max parallel')
  const serialAt = num('Budget serial at')
  const holdAt = num('Budget hold at')
  const weeklyHoldAt = num('Budget weekly hold at')
  const boostWindow = num('Budget boost window')

  // Sources, first readable wins: an explicit file, the statusline tee, ccstatusline's cache.
  const sources = [process.env.KS_USAGE_FILE, join(homedir(), '.claude/ks-usage.json'), join(homedir(), '.cache/ccstatusline/usage.json')].filter(Boolean)
  let usage = null
  for (const f of sources) {
    if (!existsSync(f)) continue
    try {
      const j = JSON.parse(readFileSync(f, 'utf8'))
      const ageMin = (Date.now() - statSync(f).mtimeMs) / 60000
      const rl = j.rate_limits
      const epoch = (s) => (s ? new Date(s * 1000).toISOString() : null)
      usage = rl
        ? { source: f, ageMin, session: rl.five_hour?.used_percentage ?? null, sessionResetAt: epoch(rl.five_hour?.resets_at), weekly: rl.seven_day?.used_percentage ?? null, weeklyResetAt: epoch(rl.seven_day?.resets_at) }
        : { source: f, ageMin, session: j.sessionUsage ?? null, sessionResetAt: j.sessionResetAt ?? null, weekly: j.weeklyUsage ?? null, weeklyResetAt: j.weeklyResetAt ?? null }
      usage.ageMin = Math.round(usage.ageMin)
      break
    } catch { /* unreadable: try the next source */ }
  }

  const res = { maxParallel, allowed: 1, verdict: 'serial', reason: '', resumeAt: null, usage }
  if (!usage || usage.session === null || usage.ageMin > 30) {
    res.reason = !usage ? 'no usage data (statusline cache not found) — safe default: one at a time'
      : `usage data ${usage.ageMin} min old — safe default: one at a time`
  } else {
    const minToReset = usage.sessionResetAt ? Math.max(0, (Date.parse(usage.sessionResetAt) - Date.now()) / 60000) : null
    res.minutesToReset = minToReset === null ? null : Math.round(minToReset)
    if (minToReset === null) res.note = 'session reset time unknown (ccstatusline cache) — no boost; .killer-saas/bin/statusline-tee.sh provides it'
    const s = usage.session
    if (usage.weekly !== null && usage.weekly >= weeklyHoldAt) {
      Object.assign(res, { allowed: 0, verdict: 'hold', resumeAt: usage.weeklyResetAt, reason: `weekly usage ${usage.weekly}% ≥ ${weeklyHoldAt}% — start nothing new until the weekly reset` })
    } else if (s >= holdAt) {
      Object.assign(res, { allowed: 0, verdict: 'hold', resumeAt: usage.sessionResetAt, reason: `session ${s}% ≥ ${holdAt}% — let running phases finish, start nothing, resume after the reset` })
    } else if (minToReset !== null && minToReset <= boostWindow) {
      // The window resets soon: unused budget is lost, so spend it — as far as the headroom allows.
      const allowed = Math.max(1, Math.min(maxParallel, Math.floor((holdAt - s) / 10)))
      Object.assign(res, { allowed, verdict: allowed > 1 ? 'boost' : 'serial', reason: `reset in ${Math.round(minToReset)} min with ${s}% used — unused budget is lost at the reset` })
    } else if (s >= serialAt) {
      Object.assign(res, { allowed: 1, verdict: 'serial', reason: `session ${s}% ≥ ${serialAt}% with ${minToReset === null ? 'an unknown time' : Math.round(minToReset) + ' min'} to the reset — one at a time` })
    } else {
      const allowed = Math.max(1, Math.ceil(maxParallel * (serialAt - s) / serialAt))
      Object.assign(res, { allowed, verdict: allowed > 1 ? 'parallel' : 'serial', reason: `session ${s}% — ${allowed} of ${maxParallel} lanes` })
    }
  }
  out(res)
  process.exit(0)
}

if (cmd === 'deps') {
  const ids = resolveIds(args)
  const res = {}
  for (const id of ids) res[id] = { deps: readStories().stories.get(id).deps, unmet: unmetDeps(id) }
  out({ target: targetRef(), stories: res })
  process.exit(Object.values(res).some((r) => r.unmet.length) ? 1 : 0)
}

if (cmd === 'conflicts') {
  const ids = resolveIds(args)
  const info = {}
  for (const id of ids) {
    const plan = planOf(id)
    const actual = touched(id)
    const isShipped = shipped(id)
    const running = list(flag('running') ?? '').map((t) => readStories().resolve(t)).includes(id)
    const declared = plan?.footprint ? plan.footprint.filter((p) => !matchesAny(p, union())) : null
    // What the story occupies: what it declared, plus whatever it has really touched so far.
    const effective = declared ? [...new Set([...declared, ...actual])] : null
    info[id] = {
      shipped: isShipped,
      planned: !!plan,
      planValidated: !!plan?.validated,
      // Launched counts as started: a fresh implementer has touched nothing yet, and holds its files already.
      started: actual.length > 0 || running,
      footprint: plan?.footprint ?? null,
      invalidEntries: plan?.invalid?.length ? plan.invalid : undefined,
      exclusive: (effective ?? []).filter((p) => exclusive().some((e) => overlaps(p, e))),
      unmet: unmetDeps(id),
      effective,
    }
  }
  const live = ids.filter((id) => !info[id].shipped)
  const pairs = []
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j], A = info[a], B = info[b]
    if (A.unmet.includes(b) || B.unmet.includes(a)) { pairs.push({ a, b, reason: 'dependency' }); continue }
    if (!A.effective || !B.effective) { pairs.push({ a, b, reason: 'unknown-footprint' }); continue }
    if (A.exclusive.length || B.exclusive.length) { pairs.push({ a, b, reason: 'exclusive', paths: [...A.exclusive, ...B.exclusive] }); continue }
    const shared = A.effective.flatMap((p) => B.effective.filter((q) => overlaps(p, q)).map((q) => (p === q ? p : `${p} ~ ${q}`)))
    if (shared.length) pairs.push({ a, b, reason: 'footprint', paths: shared.slice(0, 10) })
  }
  const conflict = (a, b) => pairs.some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a))
  // A story may start executing only if every dependency is shipped and nothing it conflicts
  // with has started — started stories hold their files until they ship, not until they finish.
  const occupied = live.filter((id) => info[id].started)
  const executeNow = []
  for (const id of live) {
    const s = info[id]
    if (!s.planValidated || s.started || s.unmet.length) continue
    if ([...occupied, ...executeNow].some((o) => conflict(id, o))) continue
    executeNow.push(id)
  }
  // Planning reads the code: a story whose dependency is not shipped would plan against code that lacks it.
  const planNow = live.filter((id) => !info[id].planned && !info[id].unmet.length)
  const waiting = Object.fromEntries(live.filter((id) => !executeNow.includes(id) && !planNow.includes(id) && !info[id].started)
    .map((id) => [id, info[id].unmet.length ? `dependencies: ${info[id].unmet.join(', ')}`
      : !info[id].planned ? 'not planned' : !info[id].planValidated ? 'plan not validated'
      : `conflicts with ${pairs.filter((p) => p.a === id || p.b === id).map((p) => `${p.a === id ? p.b : p.a} (${p.reason})`).join(', ')}`]))
  for (const s of Object.values(info)) delete s.effective
  out({ target: targetRef(), stories: info, pairs, planNow, executeNow, waiting })
  process.exit(0)
}

if (cmd === 'stale') {
  if (!args[0]) die('usage: stale <id>...')
  const ids = resolveIds(args)
  const ref = targetRef()
  const res = {}
  for (const id of ids) {
    const plan = planOf(id)
    const research = join(wt(id), 'docs/research', `${id}.md`)
    const researchSha = existsSync(research) ? readFileSync(research, 'utf8').match(/`([0-9a-f]{7,40})`/)?.[1] : null
    const baseSha = plan?.base ?? researchSha
    if (!baseSha) { res[id] = { stale: true, why: 'no `base:` in the plan, no sha in the research header' }; continue }
    const diff = tryGit('diff', '--name-only', baseSha, ref)
    if (diff === null) { res[id] = { stale: true, base: baseSha, why: `cannot diff ${baseSha}..${ref} (unknown or unfetched commit)` }; continue }
    const changed = diff.split('\n').filter((f) => f && !matchesAny(f, union()))
    const watched = [...(plan?.footprint ?? []), ...reads(id)]
    // No footprint: anything that moved outside the union paths may matter.
    const hits = plan?.footprint ? changed.filter((f) => watched.some((p) => overlaps(f, p))) : changed
    // The story's own text is a fact too: an amendment applied since `base` changes what is built.
    const before = tryGit('show', `${baseSha}:docs/stories.md`), after = tryGit('show', `${ref}:docs/stories.md`)
    const storyChanged = !!(before && after) && parseStories(before).get(id)?.text !== parseStories(after).get(id)?.text
    const decisions = (tryGit('diff', '--name-only', '--diff-filter=A', baseSha, ref, '--', 'docs/decisions') ?? '').split('\n').filter(Boolean)
    res[id] = { stale: hits.length > 0 || storyChanged || decisions.length > 0, base: baseSha, footprintKnown: !!plan?.footprint, storyChanged, changed: hits.length, inFootprintOrReads: hits.slice(0, 20), newDecisions: decisions }
  }
  out({ target: ref, stories: res })
  process.exit(Object.values(res).some((r) => r.stale) ? 1 : 0)
}

if (cmd === 'footprint-check') {
  const ids = resolveIds(args)
  const res = {}
  for (const id of ids) {
    const plan = planOf(id)
    const actual = touched(id)
    const declared = plan?.footprint ?? []
    const extra = actual.filter((f) => !declared.some((p) => overlaps(f, p)))
    res[id] = { declared: !!plan?.footprint, extra, extraExclusive: extra.filter((f) => exclusive().some((e) => overlaps(f, e))) }
  }
  out(res)
  process.exit(Object.values(res).some((r) => r.extra.length) ? 1 : 0)
}

if (cmd === 'next-adr') {
  const nums = new Set()
  const add = (name) => { const m = name.match(/^(\d{3})-/); if (m) nums.add(Number(m[1])) }
  ;(tryGit('ls-tree', '--name-only', `${targetRef()}:docs/decisions`) ?? '').split('\n').forEach(add)
  ;(tryGit('ls-tree', '--name-only', `${target()}:docs/decisions`) ?? '').split('\n').forEach(add)
  const roots = [base, ...(existsSync(worktreeRoot()) ? readdirSync(worktreeRoot()).map((d) => join(worktreeRoot(), d)) : [])]
  for (const r of roots) { const d = join(r, 'docs/decisions'); if (existsSync(d)) readdirSync(d).forEach(add) }
  out({ next: String(Math.max(0, ...nums) + 1).padStart(3, '0'), taken: nums.size })
  process.exit(0)
}

if (cmd === 'slot') {
  if (!args[0]) die('usage: slot <id> [--write]')
  const [id] = resolveIds(args.slice(0, 1))
  const spec = list(setting('Worktree ports')).map((kv) => kv.split('=').map((s) => s.trim()))
  if (!spec.length) { out({ id, slot: null, ports: {}, note: 'Worktree ports is — : no local service per worktree' }); process.exit(0) }
  const root = worktreeRoot()
  const envOf = (d) => join(root, d, '.env')
  const slotIn = (f) => (existsSync(f) ? Number(readFileSync(f, 'utf8').match(/^KS_SLOT=(\d+)$/m)?.[1] ?? NaN) : NaN)
  let slot = slotIn(envOf(id))
  if (Number.isNaN(slot)) {
    const used = new Set(readdirSync(root).filter((d) => d !== id).map((d) => slotIn(envOf(d))).filter((n) => !Number.isNaN(n)))
    slot = 1; while (used.has(slot)) slot++
  }
  const ports = Object.fromEntries(spec.map(([k, v]) => [k, Number(v) + slot]))
  if (process.argv.includes('--write')) {
    const f = envOf(id)
    if (!existsSync(f)) die(`${f} missing — import the .env files first`)
    let text = readFileSync(f, 'utf8')
    const set = (k, v) => { text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : text.replace(/\n?$/, `\n${k}=${v}\n`) }
    // A URL that still points at a base port (DATABASE_URL…) follows it.
    for (const [, v] of spec) text = text.replace(new RegExp(`((?:localhost|127\\.0\\.0\\.1):)${v}\\b`, 'g'), `$1${Number(v) + slot}`)
    for (const [k, v] of Object.entries(ports)) set(k, v)
    set('KS_SLOT', slot)
    writeFileSync(f, text)
  }
  out({ id, slot, ports })
  process.exit(0)
}

if (cmd === 'verif-current') {
  if (!args[0]) die('usage: verif-current <id>')
  const [id] = resolveIds(args.slice(0, 1))
  const f = join(top, 'docs/verif', `${id}.md`)
  if (!existsSync(f)) { out({ id, current: false, why: 'no verification record' }); process.exit(1) }
  const text = readFileSync(f, 'utf8')
  const tree = text.match(/^Tree:\s*([0-9a-f]{40})/m)?.[1]
  const complete = /^Verification status:\s*complete/m.test(text)
  // Only rows that record a run are judged: their Result cell (third column) starts with `exit`.
  const results = text.split('\n').filter((l) => /^\|/.test(l)).map((l) => l.split('|').map((c) => c.trim())[3] ?? '')
    .filter((r) => /^exit\b/.test(r))
  const failed = results.filter((r) => !/^exit 0\b/.test(r))
  // The record proves the suite and the type check only if it holds a run of each — a record of
  // focused tests alone proves neither.
  const rows = text.split('\n').filter((l) => /^\|/.test(l)).map((l) => l.split('|').map((c) => c.trim()))
  const ran = (re) => rows.some((c) => re.test(c[1] ?? '') && /^exit 0\b/.test(c[3] ?? ''))
  const missing = [
    setting('Test', { optional: true }) && !ran(/full suite/i) ? 'Test (full suite)' : null,
    setting('Typecheck', { optional: true }) && !ran(/typecheck/i) ? 'Typecheck' : null,
  ].filter(Boolean)
  let same = false
  if (tree) { try { execFileSync('git', ['diff', '--quiet', tree, 'HEAD', '--', '.', ':(exclude)docs'], { stdio: 'ignore' }); same = true } catch { same = false } }
  const current = !!tree && same && complete && results.length > 0 && failed.length === 0 && missing.length === 0
  out({ id, current, tree: tree ?? null, sameTreeOutsideDocs: same, complete, runsRecorded: results.length, nonZero: failed.length, missingRuns: missing })
  process.exit(current ? 0 : 1)
}

die('usage: ks.mjs <budget|deps|conflicts|stale|footprint-check|next-adr|slot|verif-current> …')
