'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VHF = require('../app/vhf');

const QTH = { lat: 34.15, lon: -116.04 }; // DM14xd
const report = (tx, txGrid, rx, rxGrid, mhz, mode = 'FT8') =>
  ({ tx, txGrid, rx, rxGrid, freq: mhz * 1e6, mode, txCountry: 'United States' });

test('distant 6 m stations heard nearby mean an opening', () => {
  const r = VHF.analyze([
    report('W5AAA', 'EM12', 'K6RX', 'DM13', 50.313),
    report('W5BBB', 'EM13', 'K6RX', 'DM13', 50.313),
    report('N0CCC', 'EM29', 'W6RX', 'DM04', 50.313),
    report('K6LOC', 'DM03', 'K6RX', 'DM13', 50.313), // local, not an opening
  ], QTH);
  const b = r.bands['6m'];
  assert.equal(b.status, 'open');
  assert.equal(b.stations, 3);
  assert.equal(b.receivers, 2);
  assert.equal(b.monitors, 2);
  assert.equal(b.farthest.call, 'N0CCC');
  assert.equal(b.likely, 'Sporadic-E');
  assert.match(b.toward, /E/);
  assert.equal(b.regions[0].field, 'EM');
  assert.equal(r.bands['2m'].status, 'quiet');
});

test('one distant station is only a possible opening', () => {
  const b = VHF.analyze([report('W5AAA', 'EM12', 'K6RX', 'DM13', 50.313)], QTH).bands['6m'];
  assert.equal(b.status, 'possible');
});

test('only local paths means closed, not quiet', () => {
  const b = VHF.analyze([report('K6LOC', 'DM03', 'K6RX', 'DM13', 50.313)], QTH).bands['6m'];
  assert.equal(b.status, 'closed');
  assert.equal(b.monitors, 1);
});

test('meteor scatter, far receivers and HF reports are ignored', () => {
  const b = VHF.analyze([
    report('W5AAA', 'EM12', 'K6RX', 'DM13', 50.260, 'MSK144'),
    report('W5BBB', 'EM12', 'VE3RX', 'FN03', 50.313), // receiver far from the QTH
    report('W5CCC', 'EM12', 'K6RX', 'DM13', 14.074),
  ], QTH).bands['6m'];
  assert.equal(b.status, 'quiet');
  assert.equal(b.stations, 0);
});

test('2 m tropo needs only 500 km', () => {
  const b = VHF.analyze([
    report('K7AAA', 'CN85', 'K6RX', 'DM13', 144.174),
    report('K7BBB', 'CN87', 'K6RX', 'DM13', 144.174),
    report('K7CCC', 'CN88', 'W6RX', 'DM04', 144.174),
  ], QTH).bands['2m'];
  assert.equal(b.status, 'open');
  assert.match(b.likely, /Sporadic-E|Tropo/);
  assert.match(b.toward, /N/);
});

test('likely propagation mode by path length', () => {
  assert.equal(VHF.likelyMode('6m', 1500), 'Sporadic-E');
  assert.equal(VHF.likelyMode('6m', 3500), 'Multi-hop Es or F2');
  assert.equal(VHF.likelyMode('2m', 800), 'Tropo');
});

test('tracker: no event on the first poll, one event per opening, one quiet poll of grace', () => {
  const events = [];
  const t = new VHF.OpeningTracker(band => events.push(band));
  const open = { bands: { '6m': { status: 'open' } } };
  const closed = () => ({ bands: { '6m': { status: 'closed' } } });
  const min = 60_000;

  t.update(0, { bands: { '6m': { status: 'closed' } } });
  const r1 = t.update(5 * min, { bands: { '6m': { status: 'open' } } });
  assert.deepEqual(events, ['6m']);
  assert.equal(r1.bands['6m'].active, true);
  assert.equal(r1.bands['6m'].openSince, new Date(5 * min).toISOString());

  // Same poll seen again (another request) doesn't count twice.
  t.update(5 * min, open);
  // One quiet poll keeps it open; two close it.
  assert.equal(t.update(10 * min, closed()).bands['6m'].active, true);
  assert.equal(t.update(15 * min, closed()).bands['6m'].active, false);
  // Reopening within an hour of the last event doesn't fire again.
  t.update(20 * min, { bands: { '6m': { status: 'open' } } });
  assert.deepEqual(events, ['6m']);
  t.update(25 * min, closed());
  t.update(30 * min, closed());
  t.update(70 * min, { bands: { '6m': { status: 'open' } } });
  assert.deepEqual(events, ['6m', '6m']);
});

test('tracker: an opening already in progress at start-up is not announced', () => {
  const events = [];
  const t = new VHF.OpeningTracker(band => events.push(band));
  const r = t.update(0, { bands: { '6m': { status: 'open' } } });
  assert.equal(r.bands['6m'].active, true);
  assert.deepEqual(events, []);
});
