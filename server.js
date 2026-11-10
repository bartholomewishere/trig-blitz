/*
 * Trig Blitz server. No npm packages needed: Node 18 or newer.
 *
 *   node server.js
 *
 * Environment variables (all optional):
 *   PORT                       port to listen on (default 3000)
 *   UPSTASH_REDIS_REST_URL     use Upstash Redis for storage (needed on Render)
 *   UPSTASH_REDIS_REST_TOKEN
 *   DATA_DIR                   folder for the local data file (default ./data)
 *   ADMIN_KEY                  turns on the admin page at /admin.html
 *   TIMEZONE                   decides what "today" is on the recitation page
 *                              (default Asia/Manila)
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { createStore } = require('./storage');
const Gen = require('./public/generator');

const PORT = Number(process.env.PORT) || 3000;
const TIMEZONE = process.env.TIMEZONE || 'Asia/Manila';
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const PUBLIC_DIR = path.join(__dirname, 'public');

// Game rules. The client reads these from /api/config.
const GAME_MS = 60000;          // length of a ranked game
const COUNTDOWN_MS = 3000;      // 3-2-1 before the clock starts
const SKIP_PENALTY_MS = 2000;   // a skip freezes the player for this long
const MIN_GAP_MS = 100;         // faster than this between answers is not human
const SESSION_TTL_MS = 5 * 60000;
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

// Who can sign up. Students pick one section, a class number and a group.
const SECTIONS = ['Aristotle', 'Confucius', 'Lao Tzu', 'Plato', 'Socrates'];
const NO_SECTION = 'none';   // "not a student": can play, only sees the all-time board
const GROUPS = 6;            // groups per section
const MAX_CLASS = 39;        // class numbers 01 to 39
const CACHE_MS = 15000;      // leaderboards are rebuilt at most this often, however many students look

const store = createStore();
let SECRET = '';
let dbError = 'starting up';

/* ---------------------------------------------------------------- helpers */
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 64 * 1024) { reject(new Error('too_large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('bad_json')); }
    });
    req.on('error', reject);
  });
}
function todayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
const pad2 = (n) => String(n).padStart(2, '0');

/* -------------------------------------------------------------- passwords */
// Async, so a sign-in doesn't freeze every other student while it does the maths.
function scrypt(pw, salt) {
  return new Promise((resolve, reject) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? reject(e) : resolve(k))));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt);
  return salt.toString('hex') + ':' + hash.toString('hex');
}
async function checkPassword(pw, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const hash = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  const want = Buffer.from(hashHex, 'hex');
  return want.length === hash.length && crypto.timingSafeEqual(want, hash);
}

/* ----------------------------------------------------------------- tokens */
// token = base64url(userId.expiry.passwordVersion).signature
function makeToken(id, pwv) {
  const payload = Buffer.from(id + '.' + (Date.now() + TOKEN_TTL_MS) + '.' + pwv).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + sig;
}
async function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const want = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const [id, exp, pwv] = Buffer.from(payload, 'base64url').toString().split('.');
  if (!id || Number(exp) < Date.now()) return null;
  const user = await store.getUser(id);
  // Changing a password (e.g. an admin reset) logs out old sessions.
  if (!user || String(user.pwv || 0) !== pwv) return null;
  if (user.locked) return null; // a locked account is signed out immediately
  return { id, user };
}

/* ------------------------------------------------------ login rate limits */
/*
 * School Wi-Fi puts a whole class behind one public address, so limiting by
 * address alone would lock out everyone after a few typos. Instead:
 *   - wrong passwords are counted per account (8 tries, then 10 minutes)
 *   - each address has a much higher ceiling, only to stop scripted floods
 *   - "username taken" is not counted at all
 */
const WINDOW_MS = 10 * 60000;
const fails = new Map(); // key -> { n, reset }
function tooMany(key, max) {
  const a = fails.get(key);
  return !!a && a.reset > Date.now() && a.n >= max;
}
function noteFail(key) {
  const a = fails.get(key);
  if (!a || a.reset < Date.now()) fails.set(key, { n: 1, reset: Date.now() + WINDOW_MS });
  else a.n++;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, a] of fails) if (a.reset < now) fails.delete(k);
}, 60000).unref();
const IP_CEILING = 300;

/* ------------------------------------------------------------ validation */
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
function validName(n) { return typeof n === 'string' && NAME_RE.test(n); }
function validPassword(p) { return typeof p === 'string' && p.length >= 6 && p.length <= 72; }

// A profile is { section, cls, group }. Not-a-student accounts have cls 0 and group 0.
function validProfile(p) {
  if (p.section === NO_SECTION) return { section: NO_SECTION, cls: 0, group: 0 };
  if (!SECTIONS.includes(p.section)) return null;
  const cls = Number(p.cls), group = Number(p.group);
  if (!Number.isInteger(cls) || cls < 1 || cls > MAX_CLASS) return null;
  if (!Number.isInteger(group) || group < 1 || group > GROUPS) return null;
  return { section: p.section, cls, group };
}
// Accounts made before sections existed have no profile, so they count as "not a student".
function profileOf(u) {
  return validProfile({ section: u.section, cls: u.cls, group: u.group }) || { section: NO_SECTION, cls: 0, group: 0 };
}
function slotKey(p) { return p.section === NO_SECTION ? null : p.section + ':' + pad2(p.cls); }

/* --------------------------------------------------------- game sessions */
const sessions = new Map(); // sessionId -> { userId, pools, startedAt, done }
setInterval(() => {
  const now = Date.now();
  for (const [sid, s] of sessions) if (now - s.startedAt > SESSION_TTL_MS) sessions.delete(sid);
}, 60000).unref();

/*
 * Replays a submitted game against the server's own copy of the problems.
 * answers: [{ v: number | null, t: ms since the clock started }]
 * v === null means the player skipped that problem.
 */
function scoreGame(session, answers, serverElapsed) {
  if (!Array.isArray(answers) || answers.length > 400) return { error: 'Game data is malformed.' };
  const ptr = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const shown = [];
  let solved = 0, points = 0, skips = 0, lastT = 0, lastWasSkip = false;
  for (const a of answers) {
    if (!a || typeof a.t !== 'number' || !(a.v === null || Number.isInteger(a.v))) return { error: 'Game data is malformed.' };
    const tier = Gen.tierForSolved(solved);
    const pool = session.pools[tier.tier];
    const p = pool[ptr[tier.tier]++];
    if (!p) return { error: 'Game data is malformed.' };
    shown.push(p.key);
    if (a.t < lastT || a.t > GAME_MS + 500) return { error: 'Answer times are out of order.' };
    const gap = a.t - lastT;
    if (lastWasSkip && gap < SKIP_PENALTY_MS - 150) return { error: 'Answer came in during a skip penalty.' };
    if (a.v === null) { skips++; lastWasSkip = true; lastT = a.t; continue; }
    if (a.v !== p.answer) return { error: 'An answer did not match its problem.' };
    if (gap < MIN_GAP_MS) return { error: 'Answers came in faster than anyone can type.' };
    solved++; points += tier.points; lastT = a.t; lastWasSkip = false;
  }
  // The clock only starts after the countdown, so the real time spent must
  // cover the last answer. A second of slack covers timer jitter.
  if (serverElapsed + 1000 < lastT) return { error: 'The game finished faster than its own clock.' };
  // The problem left on screen when time ran out also counts as seen.
  const tier = Gen.tierForSolved(solved);
  const next = session.pools[tier.tier][ptr[tier.tier]];
  if (next) shown.push(next.key);
  return { solved, points, skips, shown };
}

/* ---------------------------------------------------------- leaderboards */
/*
 * Every board is computed from the user records, in one pass, and cached for
 * CACHE_MS. So the database cost stays flat no matter how many students are
 * looking at the boards. Which board a student may see is decided here on the
 * server, from their own account, never from anything the browser sends.
 */
const byName = (a, b) => String(a.name || a.label).localeCompare(String(b.name || b.label));
// Tied scores share a rank (1, 2, 2, 4).
function ranked(items, value, tie) {
  items.sort((a, b) => value(b) - value(a) || tie(a, b));
  let last = null, rank = 0;
  return items.map((item, i) => {
    const v = value(item);
    if (v !== last) { rank = i + 1; last = v; }
    return { rank, item };
  });
}
const avgOf = (total, n) => (n ? total / n : 0);
const round1 = (x) => Math.round(x * 10) / 10;

async function buildSnapshot() {
  const [pairs, recitPairs] = await Promise.all([store.listUsers(), store.getRecit()]);
  const secs = {};
  for (const s of SECTIONS) {
    secs[s] = {
      name: s, registered: 0, played: 0, total: 0, students: [], recitTotals: {},
      groups: Array.from({ length: GROUPS }, (_, i) => ({ group: i + 1, registered: 0, played: 0, total: 0 }))
    };
  }
  const everyone = [];
  for (const [id, u] of pairs) {
    if (u.locked) continue; // locked accounts are hidden from every board
    const p = profileOf(u);
    const best = u.best || 0;
    const played = (u.games || 0) > 0 || best > 0; // an edited score counts even with no games
    const row = { id, name: u.name || id, section: p.section, cls: p.cls, group: p.group, best, games: u.games || 0, played };
    if (played) everyone.push(row);
    if (p.section === NO_SECTION) continue;
    const S = secs[p.section], G = S.groups[p.group - 1];
    S.students.push(row);
    S.registered++; G.registered++;
    S.total += best; G.total += best;
    if (played) { S.played++; G.played++; }
  }
  for (const [field, counts] of recitPairs) {
    const S = secs[field.split('|')[0]];
    if (!S) continue;
    for (const [cls, n] of Object.entries(counts)) S.recitTotals[cls] = (S.recitTotals[cls] || 0) + n;
  }

  const out = { sections: {} };
  out.all = ranked(everyone.slice(), (r) => r.best, byName);
  for (const s of SECTIONS) {
    const S = secs[s];
    S.avg = avgOf(S.total, S.registered);
    const players = S.students.filter((r) => r.played);
    const recitRows = S.students.filter((r) => S.recitTotals[r.cls] > 0).map((r) => ({ ...r, count: S.recitTotals[r.cls] }));
    const registeredCls = new Set(S.students.map((r) => r.cls));
    out.sections[s] = {
      name: s, registered: S.registered, played: S.played, total: S.total, avg: S.avg,
      students: ranked(players, (r) => r.best, byName),
      groups: ranked(S.groups.filter((g) => g.registered > 0), (g) => avgOf(g.total, g.registered), (a, b) => a.group - b.group),
      recit: ranked(recitRows, (r) => r.count, byName),
      recitUnregistered: Object.keys(S.recitTotals).map(Number).filter((c) => !registeredCls.has(c) && S.recitTotals[c] > 0)
        .sort((a, b) => a - b).map((c) => ({ cls: c, count: S.recitTotals[c] }))
    };
  }
  const all5 = SECTIONS.map((s) => out.sections[s]);
  // The public showdown leaves out sections where nobody has scored yet.
  out.showdown = ranked(all5.filter((S) => S.played > 0), (S) => S.avg, byName);
  out.showdownAdmin = out.showdown.concat(all5.filter((S) => S.played === 0).map((S) => ({ rank: null, item: S })));
  return out;
}

let snap = null, snapAt = 0, snapPromise = null, snapVersion = 0;
function snapshot(force) {
  if (!force && snap && Date.now() - snapAt < CACHE_MS) return Promise.resolve(snap);
  if (!force && snapPromise) return snapPromise;
  const v = snapVersion;
  const p = buildSnapshot().then((s) => {
    if (v === snapVersion) { snap = s; snapAt = Date.now(); }
    return s;
  }).finally(() => { if (snapPromise === p) snapPromise = null; });
  if (!force) snapPromise = p;
  return p;
}
function invalidateSnapshot() { snapVersion++; snap = null; }

// Turns a ranked list into the rows the game page draws.
function boardRows(type, s, me, mine) {
  if (type === 'all') {
    const rows = s.all.slice(0, 50).map(({ rank, item }) => ({ rank, label: item.name, value: item.best, mine: item.id === me.id }));
    const found = s.all.find(({ item }) => item.id === me.id);
    const extra = found && found.rank > 50 ? { rank: found.rank, label: found.item.name, value: found.item.best, mine: true } : null;
    return { rows, extra };
  }
  const S = s.sections[mine.section];
  if (type === 'section') {
    return { rows: S.students.map(({ rank, item }) => ({ rank, label: item.name, value: item.best, mine: item.id === me.id })) };
  }
  if (type === 'groups') {
    return { rows: S.groups.map(({ rank, item }) => ({
      rank, label: 'Group ' + item.group, value: round1(avgOf(item.total, item.registered)),
      sub: 'total ' + item.total + ' \u00b7 ' + item.played + ' of ' + item.registered + ' played', mine: item.group === mine.group })) };
  }
  if (type === 'showdown') {
    return { rows: s.showdown.map(({ rank, item }) => ({
      rank, label: item.name, value: round1(item.avg),
      sub: 'total ' + item.total + ' \u00b7 ' + item.played + ' of ' + item.registered + ' played', mine: item.name === mine.section })) };
  }
  if (type === 'recit') {
    return { rows: S.recit.map(({ rank, item }) => ({ rank, label: item.name, value: item.count, mine: item.id === me.id })) };
  }
  return null;
}

/* --------------------------------------------------------------- accounts */
// Claims the section + class number first, then the username, so two students can
// never end up with the same seat, even if they sign up in the same second.
async function createAccount(id, rec) {
  const slot = slotKey(profileOf(rec));
  if (slot && !(await store.claimSlot(slot, id))) return 'slot';
  if (!(await store.createUser(id, rec))) {
    if (slot) await store.releaseSlot(slot);
    return 'name';
  }
  return 'ok';
}
function describeSlot(p) { return p.section + ' ' + pad2(p.cls); }

/* --------------------------------------------------------------- admin */
function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csv(rows) { return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_CLAIM = 20; // most recitations a student can claim for one day
const adminLog = []; // recent admin changes, newest last

async function adminAction(body) {
  const A = body.action;
  const id = String(body.username || '').trim().toLowerCase();
  const fail = (status, error) => ({ status, data: { error } });
  const ok = (data) => ({ status: 200, data });
  const needUser = async () => {
    const user = await store.getUser(id);
    return user || null;
  };

  if (A === 'overview') {
    const s = await snapshot(true);
    const sec = (S) => ({
      name: S.name, registered: S.registered, played: S.played, total: S.total, avg: round1(S.avg),
      students: S.students.map(({ rank, item }) => ({ rank, name: item.name, cls: item.cls, group: item.group, score: item.best })),
      groups: S.groups.map(({ rank, item }) => ({ rank, group: item.group, avg: round1(avgOf(item.total, item.registered)), total: item.total, played: item.played, registered: item.registered })),
      recit: S.recit.map(({ rank, item }) => ({ rank, name: item.name, cls: item.cls, count: item.count })),
      recitUnregistered: S.recitUnregistered
    });
    const pendingClaims = (await store.getClaims()).filter(([, c]) => c.status === 'pending').length;
    return ok({
      pendingClaims, today: todayKey(), sections: SECTIONS.map((n) => sec(s.sections[n])),
      showdown: s.showdownAdmin.map(({ rank, item }) => ({ rank, name: item.name, avg: round1(item.avg), total: item.total, played: item.played, registered: item.registered })),
      all: s.all.slice(0, 50).map(({ rank, item }) => ({ rank, name: item.name, section: item.section, cls: item.cls, score: item.best }))
    });
  }

  if (A === 'list-section') {
    const section = body.section;
    if (section !== NO_SECTION && !SECTIONS.includes(section)) return fail(400, 'Unknown section.');
    const users = (await store.listUsers()).map(([uid, u]) => ({ uid, u, p: profileOf(u) })).filter((x) => x.p.section === section);
    const mk = (x) => ({ cls: x.p.cls, section: x.p.section, username: x.u.name, group: x.p.group, best: x.u.best || 0, games: x.u.games || 0,
      created: x.u.created || 0, locked: !!x.u.locked, adjusted: x.u.adjusted || null });
    if (section === NO_SECTION) {
      return ok({ section, rows: users.map(mk).sort((a, b) => a.username.localeCompare(b.username)) });
    }
    const rows = [];
    for (let c = 1; c <= MAX_CLASS; c++) {
      const x = users.find((y) => y.p.cls === c);
      rows.push(x ? mk(x) : { cls: c, empty: true });
    }
    return ok({ section, rows });
  }

  if (A === 'reset-password') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    if (!validPassword(body.newPassword)) return fail(400, 'New passwords need at least 6 characters.');
    user.pw = await hashPassword(body.newPassword); user.pwv = (user.pwv || 0) + 1;
    await store.putUser(id, user);
    return ok({ ok: true, message: 'Password reset for ' + user.name + '. They have been signed out everywhere.' });
  }
  if (A === 'remove-scores') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    user.best = 0; user.games = 0; user.solvedTotal = 0; delete user.adjusted;
    await store.putUser(id, user); invalidateSnapshot();
    return ok({ ok: true, message: user.name + '\u2019s scores were reset to zero.' });
  }
  if (A === 'delete-user') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    const slot = slotKey(profileOf(user));
    await store.deleteUser(id);
    if (slot) await store.releaseSlot(slot);
    invalidateSnapshot();
    return ok({ ok: true, message: user.name + ' was deleted. Their seat and username are free again.' });
  }
  if (A === 'update-profile') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    const old = profileOf(user);
    const np = validProfile({ section: body.section, cls: body.cls, group: body.group });
    if (!np) return fail(400, 'Pick a section, a class number from 01 to ' + MAX_CLASS + ' and a group from 1 to ' + GROUPS + '.');
    const oldSlot = slotKey(old), newSlot = slotKey(np);
    if (newSlot && newSlot !== oldSlot && !(await store.claimSlot(newSlot, id))) {
      return fail(409, describeSlot(np) + ' already belongs to another account.');
    }
    user.section = np.section; user.cls = np.cls; user.group = np.group;
    await store.putUser(id, user);
    if (oldSlot && oldSlot !== newSlot) await store.releaseSlot(oldSlot);
    invalidateSnapshot();
    return ok({ ok: true, message: user.name + ' is now ' + (np.section === NO_SECTION ? 'a non-student account' : describeSlot(np) + ', group ' + np.group) + '.' });
  }
  // Changes a student's best score directly (for a mistake, a bonus or a penalty).
  if (A === 'set-score') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    const n = Number(body.best);
    if (!Number.isInteger(n) || n < 0 || n > 9999) return fail(400, 'The score must be a whole number from 0 to 9999.');
    const from = user.best || 0;
    user.best = n;
    user.adjusted = { from, to: n, at: Date.now() }; // so you can see later that this score was edited
    await store.putUser(id, user); invalidateSnapshot();
    return ok({ ok: true, message: user.name + '’s best score changed from ' + from + ' to ' + n + '. A later game only replaces it if it scores higher.' });
  }
  if (A === 'rename-user') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    const newName = String(body.newName || '').trim();
    if (!validName(newName)) return fail(400, 'Usernames are 3 to 16 letters, numbers or underscores.');
    const newId = newName.toLowerCase();
    if (newId === id) { // only the capital letters changed
      user.name = newName; await store.putUser(id, user); invalidateSnapshot();
      return ok({ ok: true, message: 'Username is now ' + newName + '.' });
    }
    if (await store.getUser(newId)) return fail(409, 'The username "' + newName + '" is already taken.');
    const copy = { ...user, name: newName, pwv: (user.pwv || 0) + 1 };
    if (!(await store.createUser(newId, copy))) return fail(409, 'The username "' + newName + '" is already taken.');
    const slot = slotKey(profileOf(user));
    if (slot) { await store.releaseSlot(slot); await store.claimSlot(slot, newId); }
    const seen = await store.getSeen(id);
    if (seen.length) await store.addSeen(newId, seen);
    await store.deleteUser(id);
    invalidateSnapshot();
    return ok({ ok: true, message: user.name + ' is now called ' + newName + '. They were signed out and must sign in with the new name.' });
  }
  if (A === 'lock-user') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    user.locked = !!body.locked;
    if (user.locked) user.pwv = (user.pwv || 0) + 1;
    await store.putUser(id, user); invalidateSnapshot();
    return ok({ ok: true, message: user.name + (user.locked ? ' is locked: no sign-in, hidden from every leaderboard. Their seat is kept.' : ' is unlocked and back on the leaderboards.') });
  }
  if (A === 'sign-out') {
    const user = await needUser(); if (!user) return fail(404, 'No player named "' + body.username + '".');
    user.pwv = (user.pwv || 0) + 1;
    await store.putUser(id, user);
    return ok({ ok: true, message: user.name + ' was signed out everywhere. Their password still works.' });
  }
  if (A === 'find-user') {
    const q = String(body.q || '').trim().toLowerCase();
    if (q.length < 1) return fail(400, 'Type part of a username.');
    const rows = (await store.listUsers()).filter(([uid, u]) => uid.includes(q) || String(u.name || '').toLowerCase().includes(q))
      .map(([, u]) => { const p = profileOf(u); return { cls: p.cls, section: p.section, username: u.name, group: p.group, best: u.best || 0, games: u.games || 0, locked: !!u.locked, adjusted: u.adjusted || null }; })
      .sort((a, b) => a.username.localeCompare(b.username)).slice(0, 50);
    return ok({ rows });
  }
  // Zero the scores of one section, or one group inside it.
  if (A === 'reset-section-scores') {
    if (!SECTIONS.includes(body.section)) return fail(400, 'Unknown section.');
    const g = body.group ? Number(body.group) : 0;
    if (g && (!Number.isInteger(g) || g < 1 || g > GROUPS)) return fail(400, 'Unknown group.');
    const map = {};
    for (const [uid, u] of await store.listUsers()) {
      const p = profileOf(u);
      if (p.section !== body.section || (g && p.group !== g)) continue;
      u.best = 0; u.games = 0; u.solvedTotal = 0; delete u.adjusted; map[uid] = u;
    }
    const n = Object.keys(map).length;
    if (n) await store.putUsers(map);
    invalidateSnapshot();
    return ok({ ok: true, message: 'Scores reset to zero for ' + n + ' accounts in ' + body.section + (g ? ', group ' + g : '') + '.' });
  }
  if (A === 'log') return ok({ log: adminLog.slice().reverse() });

  // Recitation requests sent by students. They only count once approved here.
  if (A === 'claims-list') {
    const all = (await store.getClaims()).map(([field, c]) => ({ field, name: c.name, section: c.section, cls: c.cls, date: c.date, count: c.count, status: c.status, approved: c.approved || 0, at: c.at, decidedAt: c.decidedAt || 0 }));
    return ok({
      today: todayKey(), max: MAX_CLAIM,
      pending: all.filter((c) => c.status === 'pending').sort((a, b) => a.at - b.at),
      decided: all.filter((c) => c.status !== 'pending').sort((a, b) => b.decidedAt - a.decidedAt).slice(0, 40)
    });
  }
  if (A === 'claim-approve' || A === 'claim-reject') {
    const claim = await store.getClaim(String(body.field || ''));
    if (!claim) return fail(404, 'That request no longer exists.');
    if (claim.status !== 'pending') return fail(409, 'That request was already ' + claim.status + '.');
    if (A === 'claim-reject') {
      claim.status = 'rejected'; claim.decidedAt = Date.now();
      await store.putClaim(body.field, claim);
      return ok({ ok: true, message: 'Rejected ' + claim.name + '\u2019s request for ' + claim.date + '.' });
    }
    const user = await store.getUser(claim.id);
    if (!user) return fail(404, claim.name + ' no longer has an account.');
    const p = profileOf(user);
    if (p.section === NO_SECTION) return fail(400, claim.name + ' is not a student any more.');
    const n = body.count == null || body.count === '' ? claim.count : Number(body.count);
    if (!Number.isInteger(n) || n < 1 || n > 99) return fail(400, 'The count must be a whole number from 1 to 99.');
    const field = p.section + '|' + claim.date;
    const found = (await store.getRecit()).find(([f]) => f === field);
    const counts = found ? found[1] : {};
    counts[p.cls] = (counts[p.cls] || 0) + n; // adds to whatever is already recorded for that day
    await store.setRecit(field, counts);
    claim.status = 'approved'; claim.approved = n; claim.decidedAt = Date.now();
    await store.putClaim(body.field, claim);
    invalidateSnapshot();
    return ok({ ok: true, message: 'Approved +' + n + ' for ' + user.name + ' (' + describeSlot(p) + ') on ' + claim.date + '.' });
  }
  // Tidy up answered requests from earlier days. Today's stay, so nobody can send twice.
  if (A === 'claims-clear-decided') {
    const today = todayKey();
    const old = (await store.getClaims()).filter(([, c]) => c.status !== 'pending' && c.date < today).map(([f]) => f);
    await store.delClaims(old);
    return ok({ ok: true, message: 'Removed ' + old.length + ' answered requests from earlier days.' });
  }

  if (A === 'reset-all-scores') {
    const all = await store.listUsers();
    const map = {};
    for (const [uid, u] of all) { u.best = 0; u.games = 0; u.solvedTotal = 0; delete u.adjusted; map[uid] = u; }
    if (all.length) await store.putUsers(map);
    invalidateSnapshot();
    return ok({ ok: true, message: 'Every score was reset to zero for ' + all.length + ' accounts. Accounts and passwords were kept.' });
  }

  if (A === 'get-recitation') {
    if (!SECTIONS.includes(body.section) || !DATE_RE.test(String(body.date))) return fail(400, 'Pick a section and a date.');
    const field = body.section + '|' + body.date;
    const found = (await store.getRecit()).find(([f]) => f === field);
    return ok({ counts: found ? found[1] : {} });
  }
  if (A === 'set-recitation') {
    if (!SECTIONS.includes(body.section) || !DATE_RE.test(String(body.date))) return fail(400, 'Pick a section and a date.');
    const clean = {};
    for (const [k, v] of Object.entries(body.counts || {})) {
      const c = Number(k), n = Number(v);
      if (!Number.isInteger(c) || c < 1 || c > MAX_CLASS || !Number.isInteger(n) || n < 0 || n > 99) return fail(400, 'Counts must be whole numbers from 0 to 99.');
      if (n > 0) clean[c] = n;
    }
    await store.setRecit(body.section + '|' + body.date, Object.keys(clean).length ? clean : null);
    invalidateSnapshot();
    return ok({ ok: true, message: 'Saved ' + Object.keys(clean).length + ' classes for ' + body.section + ' on ' + body.date + '.' });
  }
  if (A === 'clear-recitation') {
    await store.clearRecit(); invalidateSnapshot();
    return ok({ ok: true, message: 'All recitation counts were cleared.' });
  }

  if (A === 'export') {
    const users = await store.listUsers();
    if (body.what === 'recitation') {
      const names = {};
      for (const [, u] of users) { const p = profileOf(u); if (p.section !== NO_SECTION) names[p.section + ':' + p.cls] = u.name; }
      const rows = [['section', 'date', 'class', 'username', 'recitations']];
      for (const [field, counts] of (await store.getRecit()).sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        const [section, date] = field.split('|');
        for (const c of Object.keys(counts).map(Number).sort((a, b) => a - b)) rows.push([section, date, pad2(c), names[section + ':' + c] || '', counts[c]]);
      }
      return ok({ filename: 'trig-blitz-recitation.csv', csv: csv(rows) });
    }
    const rows = [['section', 'class', 'username', 'group', 'best score', 'games played', 'problems solved']];
    users.map(([, u]) => ({ u, p: profileOf(u) }))
      .sort((a, b) => (a.p.section === NO_SECTION) - (b.p.section === NO_SECTION) || a.p.section.localeCompare(b.p.section) || a.p.cls - b.p.cls || a.u.name.localeCompare(b.u.name))
      .forEach(({ u, p }) => rows.push([p.section === NO_SECTION ? 'not a student' : p.section, p.cls ? pad2(p.cls) : '', u.name, p.group || '', u.best || 0, u.games || 0, u.solvedTotal || 0]));
    return ok({ filename: 'trig-blitz-profiles.csv', csv: csv(rows) });
  }

  return fail(400, 'Unknown action.');
}

/* --------------------------------------------------------------- routes */
async function api(req, res, url) {
  const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const route = req.method + ' ' + url.pathname;

  // Visit /api/status in a browser to see whether the database is connected.
  if (route === 'GET /api/status') return send(res, 200, { db: SECRET ? 'ok' : 'not connected', storage: store.kind, error: SECRET ? '' : dbError });
  if (!SECRET && route !== 'GET /api/config') {
    return send(res, 503, { error: 'The game database is not answering yet (' + dbError + '). Wait a minute and try again.' });
  }

  if (route === 'GET /api/config') {
    return send(res, 200, { gameMs: GAME_MS, countdownMs: COUNTDOWN_MS, skipPenaltyMs: SKIP_PENALTY_MS,
      sections: SECTIONS, noSection: NO_SECTION, groups: GROUPS, maxClass: MAX_CLASS,
      tiers: Gen.TIERS.map((t) => ({ tier: t.tier, points: t.points, from: t.from })) });
  }

  // Which class numbers are already taken in a section. Shown greyed out on the sign-up form.
  if (route === 'GET /api/slots') {
    const section = url.searchParams.get('section');
    if (!SECTIONS.includes(section)) return send(res, 400, { error: 'Unknown section.' });
    const prefix = section + ':';
    const taken = (await store.slotKeys()).filter((k) => k.startsWith(prefix)).map((k) => Number(k.slice(prefix.length)));
    return send(res, 200, { taken });
  }

  if (route === 'POST /api/register' || route === 'POST /api/login') {
    if (tooMany('ip:' + ip, IP_CEILING)) return send(res, 429, { error: 'Too many tries from this network. Wait 10 minutes and try again.' });
    const body = await readBody(req);
    const name = String(body.username || '').trim();
    const pw = body.password;
    if (!validName(name)) return send(res, 400, { error: 'Usernames are 3 to 16 letters, numbers or underscores.' });
    if (!validPassword(pw)) return send(res, 400, { error: 'Passwords need at least 6 characters.' });
    const id = name.toLowerCase();

    if (route === 'POST /api/register') {
      const profile = validProfile({ section: body.section, cls: body.cls, group: body.group });
      if (!profile) return send(res, 400, { error: 'Pick your section, class number and group from the lists.' });
      const rec = { name, pw: await hashPassword(pw), pwv: 0, created: Date.now(), games: 0, best: 0, solvedTotal: 0,
        section: profile.section, cls: profile.cls, group: profile.group };
      const result = await createAccount(id, rec);
      if (result === 'slot') return send(res, 409, { error: describeSlot(profile) + ' already has an account. If that is you, sign in instead. If you forgot the password, ask your teacher.' });
      if (result === 'name') return send(res, 409, { error: 'That username is taken. Pick another one.' });
      invalidateSnapshot();
      return send(res, 200, { token: makeToken(id, 0), user: publicUser(rec) });
    }

    if (tooMany('u:' + id, 8)) return send(res, 429, { error: 'Too many wrong passwords for this account. Wait 10 minutes, or ask your teacher to reset it.' });
    const user = await store.getUser(id);
    if (!user || !(await checkPassword(pw, user.pw))) {
      noteFail('u:' + id); noteFail('ip:' + ip);
      return send(res, 401, { error: 'Wrong username or password.' });
    }
    fails.delete('u:' + id);
    if (user.locked) return send(res, 403, { error: 'This account is locked. Ask your teacher.' });
    return send(res, 200, { token: makeToken(id, user.pwv || 0), user: publicUser(user) });
  }

  if (route === 'GET /api/board') {
    const me = await authUser(req);
    if (!me) return send(res, 401, { error: 'Sign in to continue.' });
    const type = url.searchParams.get('type') || 'all';
    const mine = profileOf(me.user);
    if (type !== 'all' && mine.section === NO_SECTION) return send(res, 403, { error: 'Only students can see this board.' });
    const s = await snapshot(false);
    const built = boardRows(type, s, me, mine);
    if (!built) return send(res, 400, { error: 'Unknown board.' });
    return send(res, 200, { type, rows: built.rows, me: built.extra || null });
  }

  if (route === 'POST /api/admin') {
    if (!ADMIN_KEY) return send(res, 404, { error: 'The admin page is off. Set ADMIN_KEY to turn it on.' });
    if (tooMany('admin:' + ip, 10)) return send(res, 429, { error: 'Too many tries. Wait 10 minutes and try again.' });
    const body = await readBody(req);
    const given = Buffer.from(String(body.key || ''));
    const want = Buffer.from(ADMIN_KEY);
    if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) {
      noteFail('admin:' + ip); return send(res, 403, { error: 'Wrong admin key.' });
    }
    const r = await adminAction(body);
    // Remember what changed (kept in memory, so it is cleared when the server restarts).
    if (r.status === 200 && r.data && r.data.message && body.action !== 'export') {
      adminLog.push({ at: Date.now(), action: body.action, message: r.data.message });
      if (adminLog.length > 200) adminLog.shift();
    }
    return send(res, r.status, r.data);
  }

  // Everything below needs a signed-in player.
  const me = await authUser(req);
  if (!me) return send(res, 401, { error: 'Sign in to continue.' });

  if (route === 'GET /api/me') return send(res, 200, { user: publicUser(me.user) });

  // A student tells the teacher how many times they recited today. Nothing is recorded
  // on the recitation board until the teacher approves it on the admin page.
  if (route === 'GET /api/recit/claim') {
    if (profileOf(me.user).section === NO_SECTION) return send(res, 403, { error: 'Only students can do this.' });
    const date = todayKey();
    const c = await store.getClaim(date + '|' + me.id);
    return send(res, 200, { date, max: MAX_CLAIM, claim: c ? { count: c.count, status: c.status, approved: c.approved || 0 } : null });
  }
  if (route === 'POST /api/recit/claim') {
    const p = profileOf(me.user);
    if (p.section === NO_SECTION) return send(res, 403, { error: 'Only students can do this.' });
    const body = await readBody(req);
    const count = Number(body.count);
    if (!Number.isInteger(count) || count < 1 || count > MAX_CLAIM) return send(res, 400, { error: 'Pick a number from 1 to ' + MAX_CLAIM + '.' });
    const date = todayKey(), field = date + '|' + me.id;
    const old = await store.getClaim(field);
    if (old && old.status !== 'pending') return send(res, 409, { error: 'Your teacher already answered today\u2019s request. Ask your teacher if something is wrong.' });
    const claim = { id: me.id, name: me.user.name, section: p.section, cls: p.cls, date, count, status: 'pending', at: Date.now() };
    await store.putClaim(field, claim);
    return send(res, 200, { date, claim: { count, status: 'pending', approved: 0 } });
  }

  if (route === 'POST /api/game/start') {
    for (const [sid, s] of sessions) if (s.userId === me.id) sessions.delete(sid); // one game at a time
    const seen = await store.getSeen(me.id);
    const pools = Gen.buildRankedPools(seen);
    const sid = crypto.randomBytes(12).toString('base64url');
    sessions.set(sid, { userId: me.id, pools, startedAt: Date.now(), done: false });
    const clientPools = {};
    for (const k of Object.keys(pools)) clientPools[k] = pools[k].map((p) => ({ text: p.text, answer: p.answer }));
    return send(res, 200, { sessionId: sid, pools: clientPools });
  }

  if (route === 'POST /api/game/submit') {
    const body = await readBody(req);
    const s = sessions.get(body.sessionId);
    if (!s || s.userId !== me.id) return send(res, 404, { error: 'This game expired. Start a new one.' });
    if (s.done) return send(res, 409, { error: 'This game was already submitted.' });
    s.done = true;
    const elapsed = Date.now() - s.startedAt - COUNTDOWN_MS;
    if (elapsed > GAME_MS + 60000) return send(res, 400, { error: 'This game took too long to submit.' });
    const result = scoreGame(s, body.answers, elapsed);
    if (result.error) return send(res, 400, { error: result.error });

    const user = me.user;
    const newBest = result.points > (user.best || 0);
    user.games = (user.games || 0) + 1;
    user.solvedTotal = (user.solvedTotal || 0) + result.solved;
    if (newBest) user.best = result.points;
    await store.putUser(me.id, user);
    await store.addSeen(me.id, result.shown);
    sessions.delete(body.sessionId);
    return send(res, 200, { points: result.points, solved: result.solved, skips: result.skips, newBest, user: publicUser(user) });
  }

  return send(res, 404, { error: 'Not found.' });
}

function publicUser(u) {
  const p = profileOf(u);
  return { name: u.name, games: u.games || 0, best: u.best || 0, solvedTotal: u.solvedTotal || 0,
    section: p.section, cls: p.cls, group: p.group };
}

/* ----------------------------------------------------------- static files */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, p));
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) {
    try { await api(req, res, url); }
    catch (e) {
      if (e.message === 'bad_json' || e.message === 'too_large') return send(res, 400, { error: 'Bad request.' });
      console.error(e);
      send(res, 500, { error: 'The server hit an error. Try again in a moment.' });
    }
    return;
  }
  if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
  serveStatic(req, res, url);
});

// Keep trying until the database answers. The web server is already open by then,
// so visitors see a clear message instead of a page that never loads.
async function connectDb() {
  for (;;) {
    try {
      SECRET = await store.getSecret(crypto.randomBytes(32).toString('hex'));
      dbError = '';
      console.log('  Database connected (' + store.kind + ').');
      return;
    } catch (e) {
      dbError = e.message;
      console.error('  Database is not reachable: ' + e.message + ' (retrying in 5 s)');
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}

function main() {
  server.listen(PORT, '0.0.0.0', () => {
    console.log('\n  TRIG BLITZ is running!\n');
    console.log('  This computer:   http://localhost:' + PORT);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const n of list || []) {
        if (n.family === 'IPv4' && !n.internal) console.log('  Same Wi-Fi:      http://' + n.address + ':' + PORT);
      }
    }
    console.log('\n  Storage: ' + (store.kind === 'upstash' ? 'Upstash Redis' : 'local file in ' + (process.env.DATA_DIR || 'data/')));
    if (store.kind === 'file' && process.env.RENDER) {
      console.log('  WARNING: Render wipes local files on restart. Accounts and scores will be');
      console.log('  lost. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (see RENDER-DEPLOY.md).');
    }
    console.log('  Admin page: ' + (ADMIN_KEY ? '/admin.html' : 'off (set ADMIN_KEY to turn it on)') + '\n');
    connectDb();
  });
}
function shutdown() { if (store.flushSync) store.flushSync(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

if (require.main === module) main();
module.exports = { scoreGame, todayKey };
