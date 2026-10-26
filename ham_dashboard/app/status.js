'use strict';
// Last success and last failure of each data source, for the status list in
// settings. Cache keys map to the service they come from. Results are kept per
// cache key, so one working query (a callsign) can't hide another that's
// failing (the area query) from the same source.

const SOURCES = [
  [/^hamqsl$/, 'HamQSL'],
  [/^(scales|kp|wind|xray|alerts|3day|cycle)$/, 'NOAA SWPC'],
  [/^(iono|map-)/, 'KC2G'],
  [/^psk-/, 'PSKReporter'],
  [/^pota$/, 'POTA'],
  [/^tles$/, 'CelesTrak'],
  [/^nws-/, 'National Weather Service'],
  [/^hearham$/, 'HearHam'],
];

class SourceStatus {
  constructor(sources = SOURCES) {
    this.sources = sources;
    this.keys = new Map();
  }

  note(key, err, now = Date.now()) {
    if (!this.sources.some(([re]) => re.test(key))) return;
    const s = this.keys.get(key) || {};
    if (err) Object.assign(s, { errorAt: now, error: err.message, limited: err.status === 429 });
    else s.okAt = now;
    this.keys.delete(key);
    this.keys.set(key, s);
    // Map order is insertion order, so the first key is the least recently
    // updated. Keep at most 200 (lookups for new areas add keys over time).
    if (this.keys.size > 200) this.keys.delete(this.keys.keys().next().value);
  }

  // state: 'unused' (not fetched yet), 'ok', 'stale' (a query is failing but
  // earlier data is still shown) or 'error' (failing with nothing to show).
  report() {
    const iso = t => (t ? new Date(t).toISOString() : null);
    return this.sources.map(([re, name]) => {
      const keys = [...this.keys].filter(([k]) => re.test(k)).map(([, s]) => s);
      const okAt = Math.max(0, ...keys.map(s => s.okAt || 0)) || null;
      const failing = keys.filter(s => s.errorAt && !(s.okAt > s.errorAt)).sort((a, b) => b.errorAt - a.errorAt)[0];
      const state = !keys.length ? 'unused' : !failing ? 'ok' : failing.okAt || okAt ? 'stale' : 'error';
      return {
        name, state, ok: iso(okAt),
        errorAt: iso(failing?.errorAt), error: failing?.error ?? null, limited: !!failing?.limited,
      };
    });
  }
}

module.exports = { SOURCES, SourceStatus };
