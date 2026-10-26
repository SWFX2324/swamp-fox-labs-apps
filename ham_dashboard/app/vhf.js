'use strict';
// VHF openings (6 m and 2 m) measured from PSKReporter reception reports.
// A band counts as open when monitors near the QTH decode stations farther
// away than normal ground wave and tropo reach: past 800 km on 6 m (sporadic-E
// and beyond) or 500 km on 2 m (tropo ducting and Es). Meteor scatter (MSK144)
// is left out, since it reaches those distances on any day.

const HamCore = require('./static/hamcore');

const VHF_BANDS = [
  { band: '6m', lo: 50000, hi: 54000, minKm: 800 },
  { band: '2m', lo: 144000, hi: 148000, minKm: 500 },
];
const NEAR_KM = 800;
const MAX_PATHS = 60;
const CLOSE_AFTER_MISSES = 2;
const EVENT_COOLDOWN_MS = 60 * 60_000;

function likelyMode(band, km) {
  if (band === '6m') return km <= 2300 ? 'Sporadic-E' : 'Multi-hop Es or F2';
  return km < 1400 ? 'Tropo' : 'Sporadic-E or tropo duct';
}

// The compass points that hold at least 30% of the distant stations.
function towardOf(bearings) {
  if (!bearings.length) return '';
  const points = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const counts = new Array(8).fill(0);
  for (const b of bearings) counts[Math.round(b / 45) % 8]++;
  return counts.map((n, i) => [n, i]).filter(([n]) => n / bearings.length >= 0.3)
    .sort((a, b) => b[0] - a[0]).map(([, i]) => points[i]).join(', ');
}

// reports: [{ rx, rxGrid, tx, txGrid, txCountry, freq (Hz), mode }]
function analyze(reports, pos) {
  const bands = {};
  for (const def of VHF_BANDS) {
    const monitors = new Set(), receivers = new Set(), stations = new Map(), paths = new Map();
    for (const r of reports) {
      const khz = r.freq / 1000;
      if (!(khz >= def.lo && khz <= def.hi) || /^MSK/i.test(r.mode || '')) continue;
      const rx = HamCore.gridToLatLon(r.rxGrid);
      if (!rx || HamCore.distanceKm(pos, rx) > NEAR_KM) continue;
      monitors.add(r.rx);
      const tx = HamCore.gridToLatLon(r.txGrid);
      if (!tx) continue;
      const km = HamCore.distanceKm(rx, tx);
      if (km < def.minKm) continue;
      receivers.add(r.rx);
      const key = `${r.tx}|${r.rx}`;
      if (!paths.has(key)) {
        paths.set(key, {
          tx: r.tx, txGrid: r.txGrid, rx: r.rx, rxGrid: r.rxGrid, km: Math.round(km),
          mode: r.mode || '', freq: r.freq, country: r.txCountry || '',
        });
      }
      const prev = stations.get(r.tx);
      if (!prev || km > prev.km) stations.set(r.tx, { call: r.tx, grid: r.txGrid, country: r.txCountry || '', km: Math.round(km), bearing: HamCore.bearingDeg(pos, tx) });
    }
    const list = [...stations.values()];
    const n = list.length;
    const status = n >= 3 || (n >= 2 && receivers.size >= 2) ? 'open' : n >= 1 ? 'possible' : monitors.size ? 'closed' : 'quiet';
    const farthest = list.reduce((a, s) => (!a || s.km > a.km ? s : a), null);
    const fields = {};
    for (const s of list) { const f = s.grid.slice(0, 2).toUpperCase(); fields[f] = (fields[f] || 0) + 1; }
    bands[def.band] = {
      status, monitors: monitors.size, receivers: receivers.size, stations: n, minKm: def.minKm,
      farthest: farthest && { call: farthest.call, grid: farthest.grid, country: farthest.country, km: farthest.km },
      toward: towardOf(list.map(s => s.bearing)),
      likely: farthest ? likelyMode(def.band, farthest.km) : '',
      regions: Object.entries(fields).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([field, count]) => ({ field, count })),
      paths: [...paths.values()].sort((a, b) => b.km - a.km).slice(0, MAX_PATHS),
    };
  }
  return { nearKm: NEAR_KM, bands };
}

// Follows openings across polls so the dashboard can say how long a band has
// been open and Home Assistant gets one event per opening. An opening ends
// after two polls in a row without it, so one quiet poll doesn't end it. The
// first poll after a start only records what's already open.
class OpeningTracker {
  constructor(onOpen) {
    this.onOpen = onOpen;
    this.bands = {};
    this.lastFetched = null;
    this.seeded = false;
  }

  update(fetched, result) {
    if (fetched !== this.lastFetched) {
      this.lastFetched = fetched;
      for (const [band, b] of Object.entries(result.bands)) {
        const st = this.bands[band] || (this.bands[band] = { open: false, since: null, misses: 0, lastEvent: -Infinity });
        if (b.status === 'open') {
          st.misses = 0;
          if (!st.open) {
            st.open = true;
            st.since = fetched;
            if (this.seeded && fetched - st.lastEvent >= EVENT_COOLDOWN_MS) {
              st.lastEvent = fetched;
              this.onOpen?.(band, b);
            }
          }
        } else if (st.open && ++st.misses >= CLOSE_AFTER_MISSES) {
          st.open = false;
          st.since = null;
        }
      }
      this.seeded = true;
    }
    for (const [band, b] of Object.entries(result.bands)) {
      const st = this.bands[band];
      b.active = !!st?.open;
      b.openSince = st?.open ? new Date(st.since).toISOString() : null;
    }
    return result;
  }
}

module.exports = { VHF_BANDS, analyze, likelyMode, towardOf, OpeningTracker };
