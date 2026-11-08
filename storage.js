/*
 * Storage for Trig Blitz.
 *
 * Two backends with the same interface:
 *   - FileStore:    a JSON file on disk. Good for local and LAN play.
 *   - UpstashStore: Upstash Redis over its REST API. Use this when hosting on
 *                   Render's free tier, whose disk is wiped on every restart.
 *
 * Upstash is picked automatically when UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set. No npm packages are needed for either.
 *
 * What is stored:
 *   users   username -> profile, password hash and best score
 *   slots   "Plato:07" -> username   (one account per section + class number)
 *   recit   "Plato|2026-11-09" -> { "7": 2, "12": 1 }   recitations per day
 *   seen    problems each player has already been shown
 */
'use strict';
const fs = require('fs');
const path = require('path');

const SEEN_CAP = 5000; // problems remembered per player to avoid repeats

// Redis hashes come back as a flat [k, v, k, v] array (or an object, depending on the client).
function toPairs(r) {
  if (!r) return [];
  if (Array.isArray(r)) {
    const out = [];
    for (let i = 0; i < r.length; i += 2) out.push([r[i], r[i + 1]]);
    return out;
  }
  return Object.entries(r);
}

/* ------------------------------------------------------------ file store */
class FileStore {
  constructor(dir) {
    this.kind = 'file';
    this.file = path.join(dir, 'db.json');
    fs.mkdirSync(dir, { recursive: true });
    this.db = { meta: {}, users: {}, slots: {}, recit: {}, seen: {} };
    if (fs.existsSync(this.file)) {
      try { Object.assign(this.db, JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
      catch (e) { console.error('Could not read ' + this.file + ', starting empty:', e.message); }
    }
    for (const k of ['meta', 'users', 'slots', 'recit', 'seen']) if (!this.db[k]) this.db[k] = {};
    this.timer = null;
  }
  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.db));
      fs.renameSync(tmp, this.file);
    }, 250);
  }
  flushSync() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    fs.writeFileSync(this.file, JSON.stringify(this.db));
  }
  async getSecret(fresh) {
    if (!this.db.meta.secret) { this.db.meta.secret = fresh; this.save(); }
    return this.db.meta.secret;
  }
  async getUser(id) { return this.db.users[id] || null; }
  async listUsers() { return Object.entries(this.db.users); }
  async createUser(id, rec) {
    if (this.db.users[id]) return false;
    this.db.users[id] = rec; this.save(); return true;
  }
  async putUser(id, rec) { this.db.users[id] = rec; this.save(); }
  async putUsers(map) { Object.assign(this.db.users, map); this.save(); }
  async deleteUser(id) { delete this.db.users[id]; delete this.db.seen[id]; this.save(); }

  async claimSlot(slot, id) {
    if (this.db.slots[slot]) return false;
    this.db.slots[slot] = id; this.save(); return true;
  }
  async releaseSlot(slot) { delete this.db.slots[slot]; this.save(); }
  async slotKeys() { return Object.keys(this.db.slots); }

  async getRecit() { return Object.entries(this.db.recit); }
  async setRecit(field, obj) {
    if (obj) this.db.recit[field] = obj; else delete this.db.recit[field];
    this.save();
  }
  async clearRecit() { this.db.recit = {}; this.save(); }

  async getSeen(id) { return this.db.seen[id] || []; }
  async addSeen(id, keys) {
    const list = (this.db.seen[id] || []).filter((k) => !keys.includes(k)).concat(keys);
    this.db.seen[id] = list.slice(-SEEN_CAP);
    this.save();
  }
}

/* --------------------------------------------------------- upstash store */
class UpstashStore {
  constructor(url, token) {
    this.kind = 'upstash';
    this.url = url.replace(/\/+$/, '');
    this.token = token;
  }
  async req(pathPart, body) {
    let res;
    try {
      res = await fetch(this.url + pathPart, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000)
      });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new Error('Upstash did not answer within 8 seconds');
      throw new Error('Could not reach Upstash at ' + this.url + ' (' + ((e.cause && e.cause.code) || e.message) + ')');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok || !data) throw new Error('Upstash request failed (' + res.status + '): ' + JSON.stringify(data));
    return data;
  }
  async cmd(...args) {
    const data = await this.req('', args.map(String));
    if (data.error) throw new Error('Upstash: ' + data.error);
    return data.result;
  }
  async pipe(cmds) {
    if (!cmds.length) return [];
    const data = await this.req('/pipeline', cmds.map((c) => c.map(String)));
    return data.map((d) => { if (d.error) throw new Error('Upstash: ' + d.error); return d.result; });
  }
  async getSecret(fresh) {
    await this.cmd('SET', 'tb:secret', fresh, 'NX');
    return this.cmd('GET', 'tb:secret');
  }
  async getUser(id) {
    const raw = await this.cmd('HGET', 'tb:users', id);
    return raw ? JSON.parse(raw) : null;
  }
  async listUsers() {
    return toPairs(await this.cmd('HGETALL', 'tb:users')).map(([id, raw]) => [id, JSON.parse(raw)]);
  }
  async createUser(id, rec) {
    return (await this.cmd('HSETNX', 'tb:users', id, JSON.stringify(rec))) === 1;
  }
  async putUser(id, rec) { await this.cmd('HSET', 'tb:users', id, JSON.stringify(rec)); }
  async putUsers(map) {
    const ids = Object.keys(map);
    const cmds = [];
    for (let i = 0; i < ids.length; i += 100) {
      const cmd = ['HSET', 'tb:users'];
      for (const id of ids.slice(i, i + 100)) cmd.push(id, JSON.stringify(map[id]));
      cmds.push(cmd);
    }
    await this.pipe(cmds);
  }
  async deleteUser(id) { await this.pipe([['HDEL', 'tb:users', id], ['DEL', 'tb:seen:' + id]]); }

  async claimSlot(slot, id) { return (await this.cmd('HSETNX', 'tb:slots', slot, id)) === 1; }
  async releaseSlot(slot) { await this.cmd('HDEL', 'tb:slots', slot); }
  async slotKeys() { return (await this.cmd('HKEYS', 'tb:slots')) || []; }

  async getRecit() {
    return toPairs(await this.cmd('HGETALL', 'tb:recit')).map(([f, raw]) => [f, JSON.parse(raw)]);
  }
  async setRecit(field, obj) {
    if (obj) await this.cmd('HSET', 'tb:recit', field, JSON.stringify(obj));
    else await this.cmd('HDEL', 'tb:recit', field);
  }
  async clearRecit() { await this.cmd('DEL', 'tb:recit'); }

  async getSeen(id) { return (await this.cmd('ZRANGE', 'tb:seen:' + id, 0, -1)) || []; }
  async addSeen(id, keys) {
    if (!keys.length) return;
    const now = Date.now();
    const zadd = ['ZADD', 'tb:seen:' + id];
    keys.forEach((k, i) => zadd.push(now + i, k));
    await this.pipe([zadd, ['ZREMRANGEBYRANK', 'tb:seen:' + id, 0, -(SEEN_CAP + 1)]]);
  }
}

// Be forgiving about how the values were pasted: stray quotes, spaces, a missing https://
function cleanEnv(v) { return String(v || '').trim().replace(/^["']+|["']+$/g, '').trim(); }
function createStore() {
  let url = cleanEnv(process.env.UPSTASH_REDIS_REST_URL);
  const token = cleanEnv(process.env.UPSTASH_REDIS_REST_TOKEN);
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  if (url && token) return new UpstashStore(url, token);
  return new FileStore(process.env.DATA_DIR || path.join(__dirname, 'data'));
}

module.exports = { createStore, FileStore, UpstashStore, SEEN_CAP };
