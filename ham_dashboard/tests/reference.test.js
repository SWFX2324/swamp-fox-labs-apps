'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { HamReference: R } = require('../app/static/reference');

const plan = band => R.US_BAND_PLAN.find(e => e.band === band);
const text = (band, cls) => R.privileges(plan(band), cls).map(([lo, hi, m]) => `${lo}-${hi} ${m}`).join(', ');

test('beacon schedule matches the published NCDXF table', () => {
  const t0 = Date.parse('2026-10-26T00:00:00Z');
  const calls = t => R.beaconSchedule(t).bands.map(b => R.BEACONS[b.now].call);
  assert.deepEqual(calls(t0), ['4U1UN', 'YV5B', 'OA4B', 'LU4AA', 'CS3B']);
  assert.deepEqual(calls(t0 + 10_000), ['VE8AT', '4U1UN', 'YV5B', 'OA4B', 'LU4AA']);
  assert.deepEqual(calls(t0 + 170_000), ['YV5B', 'OA4B', 'LU4AA', 'CS3B', 'OH2B']);
  // The cycle repeats every 3 minutes.
  assert.deepEqual(calls(t0 + 180_000), calls(t0));
  assert.deepEqual(calls(t0 + 37 * 180_000 + 20_000), calls(t0 + 20_000));
});

test('beacon countdown and next beacon', () => {
  const t0 = Date.parse('2026-10-26T00:00:00Z');
  const s = R.beaconSchedule(t0 + 23_000);
  assert.equal(s.remaining, 7);
  assert.equal(R.BEACONS[s.bands[0].now].call, 'W6WX');
  assert.equal(R.BEACONS[s.bands[0].next].call, 'KH6RS');
  assert.equal(R.BEACONS.length, 18);
});

test('Technicians: CW only on 80, 40 and 15 m; data and phone on 10 m', () => {
  assert.equal(text('80m', 'T'), '3.525-3.6 cwonly');
  assert.equal(text('40m', 'T'), '7.025-7.125 cwonly');
  assert.equal(text('15m', 'T'), '21.025-21.2 cwonly');
  assert.equal(text('10m', 'T'), '28-28.3 cw, 28.3-28.5 phone');
  assert.equal(text('20m', 'T'), '');
  assert.equal(text('2m', 'T'), '144-144.1 cwonly, 144.1-148 all');
});

test('General and Extra phone and CW edges on 20 m and 40 m', () => {
  assert.equal(text('20m', 'G'), '14.025-14.15 cw, 14.225-14.35 phone');
  assert.equal(text('20m', 'A'), '14.025-14.15 cw, 14.175-14.35 phone');
  assert.equal(text('20m', 'E'), '14-14.15 cw, 14.15-14.35 phone');
  assert.equal(text('40m', 'G'), '7.025-7.125 cw, 7.175-7.3 phone');
  assert.equal(text('40m', 'E'), '7-7.125 cw, 7.125-7.3 phone');
});

test('60 m channels are General and up', () => {
  assert.equal(R.privileges(plan('60m'), 'T').length, 0);
  assert.equal(R.privileges(plan('60m'), 'G').length, 5);
});

test('GMRS/FRS channels and power', () => {
  assert.equal(R.GMRS_FRS.length, 22);
  assert.deepEqual([R.GMRS_FRS[0].mhz, R.GMRS_FRS[0].gmrs, R.GMRS_FRS[0].frs], [462.5625, '5 W', '2 W']);
  assert.deepEqual([R.GMRS_FRS[7].mhz, R.GMRS_FRS[7].gmrs], [467.5625, '0.5 W']);
  assert.deepEqual([R.GMRS_FRS[14].mhz, R.GMRS_FRS[14].gmrs], [462.55, '50 W']);
  assert.match(R.GMRS_FRS[14].note, /467\.5500/);
});

test('CB channels keep the out-of-order 23-25', () => {
  assert.equal(R.CB.length, 40);
  assert.deepEqual(R.CB.slice(22, 25).map(c => c.mhz), [27.255, 27.235, 27.245]);
  assert.equal(R.CB[8].note, 'Emergency');
});
