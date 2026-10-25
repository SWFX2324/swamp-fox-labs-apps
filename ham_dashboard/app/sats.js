'use strict';
// Amateur satellite pass prediction: CelesTrak TLEs propagated with SGP4
// (satellite.js), searched for passes over the observer, with az/el tracks and
// Doppler-corrected frequencies at AOS, TCA and LOS.

const sat = require('./lib/satellite.min.js');

const RAD = Math.PI / 180;
const C_KMS = 299792.458;

// Popular FM and linear birds. Status changes often, so the UI links to the
// AMSAT status page. Frequencies are MHz; linear passbands are low-high.
const SATELLITES = [
  { id: 25544, name: 'ISS', type: 'FM', mode: 'Cross-band repeater, APRS, voice', uplink: 145.990, tone: '67.0', downlink: 437.800, notes: 'Voice 145.800 · APRS 145.825' },
  { id: 27607, name: 'SO-50', type: 'FM', mode: 'FM repeater', uplink: 145.850, tone: '67.0', downlink: 436.795 },
  { id: 43678, name: 'PO-101', type: 'FM', mode: 'FM repeater (scheduled)', uplink: 437.500, tone: '141.3', downlink: 145.900 },
  { id: 43017, name: 'AO-91', type: 'FM', mode: 'FM repeater (sunlight only)', uplink: 435.250, tone: '67.0', downlink: 145.960 },
  { id: 44909, name: 'RS-44', type: 'Linear', mode: 'Linear transponder, inverting', uplink: [145.935, 145.995], downlink: [435.610, 435.670], notes: 'CW beacon 435.605' },
  { id: 24278, name: 'FO-29', type: 'Linear', mode: 'Linear transponder, inverting', uplink: [145.900, 146.000], downlink: [435.800, 435.900] },
  { id: 7530, name: 'AO-7', type: 'Linear', mode: 'Mode B linear (sunlight only)', uplink: [432.125, 432.175], downlink: [145.925, 145.975] },
];

function parseTles(text) {
  const lines = text.split(/\r?\n/).map(l => l.trimEnd()).filter(Boolean);
  const out = new Map();
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    if (lines[i].startsWith('1 ') && lines[i + 1]?.startsWith('2 ')) {
      const id = +lines[i].slice(2, 7);
      try { out.set(id, sat.twoline2satrec(lines[i], lines[i + 1])); } catch { /* bad element set */ }
      i++;
    }
  }
  return out;
}

function look(satrec, date, obs) {
  const pv = sat.propagate(satrec, date);
  if (!pv || !pv.position) return null;
  const la = sat.ecfToLookAngles(obs, sat.eciToEcf(pv.position, sat.gstime(date)));
  return { az: la.azimuth / RAD, el: la.elevation / RAD, range: la.rangeSat };
}

// Range rate in km/s (positive = moving away), by central difference.
function rangeRate(satrec, date, obs) {
  const a = look(satrec, new Date(date.getTime() - 500), obs);
  const b = look(satrec, new Date(date.getTime() + 500), obs);
  return a && b ? b.range - a.range : 0;
}

// Refine an elevation zero crossing between t0 (below/above) and t1 to ~1 s.
function crossing(satrec, obs, t0, t1) {
  const up0 = look(satrec, new Date(t0), obs).el > 0;
  while (t1 - t0 > 1000) {
    const mid = (t0 + t1) / 2;
    if ((look(satrec, new Date(mid), obs).el > 0) === up0) t0 = mid; else t1 = mid;
  }
  return Math.round((t0 + t1) / 2);
}

function findPasses(satrec, obs, start, hours) {
  const step = 30_000, end = start + hours * 3600_000;
  const passes = [];
  let prev = look(satrec, new Date(start), obs);
  if (!prev) return passes;
  let cur = null;
  if (prev.el > 0) {
    // Already up: walk back to the real rise time (LEO passes last < 30 min).
    let t = start;
    while (t > start - 30 * 60_000 && look(satrec, new Date(t - step), obs).el > 0) t -= step;
    cur = { aos: t > start - 30 * 60_000 ? crossing(satrec, obs, t - step, t) : t, inProgress: true };
  }
  for (let t = start + step; t <= end; t += step) {
    const p = look(satrec, new Date(t), obs);
    if (!p) break;
    if (!cur && p.el > 0 && prev.el <= 0) cur = { aos: crossing(satrec, obs, t - step, t) };
    if (cur && p.el <= 0 && prev.el > 0) {
      cur.los = crossing(satrec, obs, t - step, t);
      passes.push(cur);
      cur = null;
      if (passes.length >= 8) break;
    }
    prev = p;
  }
  return passes.map(pass => describePass(satrec, obs, pass));
}

function describePass(satrec, obs, pass) {
  const track = [];
  let tca = pass.aos, maxEl = -90;
  const span = pass.los - pass.aos;
  const stepMs = Math.max(5000, Math.round(span / 60));
  for (let t = pass.aos; t <= pass.los; t += stepMs) {
    const p = look(satrec, new Date(t), obs);
    track.push([+p.az.toFixed(1), +Math.max(0, p.el).toFixed(1), t]);
    if (p.el > maxEl) { maxEl = p.el; tca = t; }
  }
  const lp = look(satrec, new Date(pass.los), obs);
  track.push([+lp.az.toFixed(1), 0, pass.los]);
  return {
    aos: new Date(pass.aos).toISOString(), los: new Date(pass.los).toISOString(), tca: new Date(tca).toISOString(),
    inProgress: Boolean(pass.inProgress), maxEl: +maxEl.toFixed(1),
    aosAz: track[0][0], losAz: lp.az, durationMin: +(span / 60000).toFixed(1),
    track,
    rangeRate: { aos: rangeRate(satrec, new Date(pass.aos + 1000), obs), tca: rangeRate(satrec, new Date(tca), obs), los: rangeRate(satrec, new Date(pass.los - 1000), obs) },
  };
}

// What you hear on the downlink, and what to transmit so the satellite hears
// its nominal uplink, given range rate rr (km/s).
const doppler = (mhz, rr, uplink) => (uplink ? mhz * (1 + rr / C_KMS) : mhz * (1 - rr / C_KMS));

function predict(tles, pos, hours = 24) {
  const obs = { latitude: pos.lat * RAD, longitude: pos.lon * RAD, height: 0.3 };
  const now = Date.now();
  return SATELLITES.map(s => {
    const satrec = tles.get(s.id);
    if (!satrec) return { ...s, missing: true, passes: [] };
    const nowLook = look(satrec, new Date(now), obs);
    return {
      ...s,
      epoch: new Date((satrec.jdsatepoch - 2440587.5) * 86400000).toISOString(),
      now: nowLook && { az: +nowLook.az.toFixed(1), el: +nowLook.el.toFixed(1), range: Math.round(nowLook.range) },
      passes: findPasses(satrec, obs, now, hours),
    };
  });
}

// Current az/el only (cheap), for refreshing an already-computed prediction.
function positionsNow(tles, pos) {
  const obs = { latitude: pos.lat * RAD, longitude: pos.lon * RAD, height: 0.3 };
  const out = {};
  for (const s of SATELLITES) {
    const satrec = tles.get(s.id);
    const l = satrec && look(satrec, new Date(), obs);
    if (l) out[s.id] = { az: +l.az.toFixed(1), el: +l.el.toFixed(1), range: Math.round(l.range), rangeRate: +rangeRate(satrec, new Date(), obs).toFixed(3) };
  }
  return out;
}

module.exports = { SATELLITES, parseTles, predict, positionsNow, doppler };
