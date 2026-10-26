'use strict';
// Cache for data from outside services. It:
// - serves a fresh copy, or shares one in-flight request between callers;
// - backs off after a failure (15 minutes after a rate limit, as the services
//   ask; 1 minute otherwise), serving the last good copy meanwhile;
// - stays bounded: entries long past their lifetime are swept, and the oldest
//   go first if there are ever more than maxEntries;
// - optionally saves keys matching `persist` (and their back-off) to a file
//   and loads them at start, so a restart doesn't refetch them straight away
//   and run into a rate limit.

const fs = require('fs');

const MIN = 60_000;

function createCache({
  maxEntries = 500,
  keepMs = 6 * 60 * MIN,
  persist = null,
  persistFile = null,
  onResult = null,
  log = console,
  now = () => Date.now(),
} = {}) {
  const entries = new Map(); // key -> { t, v, ttl, p }
  const blockedUntil = new Map(); // key -> time before which we don't retry
  let saveTimer = null;

  const persisted = key => !!(persist && persistFile && persist.test(key));
  const has = e => e && 'v' in e;

  function cached(key, ttlMs, fn) {
    const hit = entries.get(key);
    const t = now();
    if (has(hit) && t - hit.t < ttlMs) return Promise.resolve(hit.v);
    if (hit && hit.p) return hit.p;
    if (blockedUntil.get(key) > t) {
      if (has(hit)) return Promise.resolve(hit.v);
      return Promise.reject(new Error(`${key}: rate limited by the source, retrying later`));
    }
    const p = fn()
      .then(v => {
        entries.set(key, { t: now(), v, ttl: ttlMs });
        blockedUntil.delete(key);
        onResult?.(key);
        if (persisted(key)) scheduleSave();
        return v;
      })
      .catch(err => {
        onResult?.(key, err);
        const wait = err.status === 429 ? 15 * MIN : MIN;
        if (err.status === 429) {
          blockedUntil.set(key, now() + wait);
          if (persisted(key)) scheduleSave();
        }
        if (has(hit)) {
          log.warn(`[cache] ${key}: ${err.message} (serving stale)`);
          // Keep the old copy, and try again after the wait.
          entries.set(key, { t: now() - ttlMs + wait, v: hit.v, ttl: ttlMs });
          return hit.v;
        }
        entries.delete(key);
        throw err;
      });
    entries.set(key, { ...(hit || {}), ttl: ttlMs, p });
    return p;
  }

  // The value if it's younger than ttl, without fetching.
  function fresh(key, ttl) {
    const h = entries.get(key);
    return has(h) && now() - h.t < ttl ? h.v : null;
  }

  function sweep() {
    const t = now();
    for (const [k, e] of entries) if (!e.p && t - e.t > Math.max(keepMs, (e.ttl || 0) * 4)) entries.delete(k);
    for (const [k, until] of blockedUntil) if (until <= t) blockedUntil.delete(k);
    if (entries.size > maxEntries) {
      const oldest = [...entries].filter(([, e]) => !e.p).sort((a, b) => a[1].t - b[1].t);
      for (const [k] of oldest.slice(0, entries.size - maxEntries)) entries.delete(k);
    }
  }

  function scheduleSave() {
    if (saveTimer) return;
    saveTimer = setTimeout(save, 30_000);
    saveTimer.unref?.();
  }

  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!persistFile) return;
    const out = { saved: now(), entries: {}, blocked: {} };
    for (const [k, e] of entries) if (persisted(k) && has(e)) out.entries[k] = { t: e.t, v: e.v };
    for (const [k, until] of blockedUntil) if (persisted(k) && until > now()) out.blocked[k] = until;
    try {
      // Write then rename, so a crash mid-write can't leave a broken file.
      fs.writeFileSync(`${persistFile}.tmp`, JSON.stringify(out));
      fs.renameSync(`${persistFile}.tmp`, persistFile);
    } catch (e) { log.warn(`[cache] couldn't save: ${e.message}`); }
  }

  // Load saved entries younger than maxAgeMs, and any back-off still running.
  function load(maxAgeMs = 30 * MIN) {
    if (!persistFile) return 0;
    let data;
    try { data = JSON.parse(fs.readFileSync(persistFile, 'utf8')); } catch { return 0; }
    const t = now();
    let n = 0;
    for (const [k, e] of Object.entries(data.entries || {})) {
      if (!persisted(k) || !(e.t > t - maxAgeMs) || entries.has(k)) continue;
      entries.set(k, { t: e.t, v: e.v, ttl: 0 });
      n++;
    }
    for (const [k, until] of Object.entries(data.blocked || {})) if (persisted(k) && until > t) blockedUntil.set(k, until);
    return n;
  }

  return { cached, fresh, sweep, save, load, entries, blockedUntil };
}

module.exports = { createCache };
