'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { SourceStatus } = require('../app/status');

const byName = (s, name) => s.report().find(r => r.name === name);
const http = (status, msg = `HTTP ${status}`) => Object.assign(new Error(msg), { status });

test('sources start unused and turn ok after a fetch', () => {
  const s = new SourceStatus();
  assert.equal(byName(s, 'HamQSL').state, 'unused');
  s.note('hamqsl', null, 1000);
  const r = byName(s, 'HamQSL');
  assert.equal(r.state, 'ok');
  assert.equal(r.ok, new Date(1000).toISOString());
});

test('keys map to their source, unknown keys are ignored', () => {
  const s = new SourceStatus();
  s.note('kp', null, 1); s.note('map-mufd', null, 1); s.note('nws-alerts-34.150,-116.040', null, 1);
  s.note('lookup-KR4FCD', null, 1); s.note('sats-34.15,-116.04', null, 1);
  assert.equal(byName(s, 'NOAA SWPC').state, 'ok');
  assert.equal(byName(s, 'KC2G').state, 'ok');
  assert.equal(byName(s, 'National Weather Service').state, 'ok');
  assert.equal(s.keys.size, 3);
});

test('a failing query is not hidden by another query from the same source', () => {
  const s = new SourceStatus();
  s.note('psk-area-DM', http(429), 1000);
  s.note('psk-KR4FCD-60', null, 2000);
  const r = byName(s, 'PSKReporter');
  assert.equal(r.state, 'stale');
  assert.equal(r.limited, true);
  assert.match(r.error, /429/);
  assert.equal(r.ok, new Date(2000).toISOString());
});

test('error with nothing to show, then recovery', () => {
  const s = new SourceStatus();
  s.note('pota', http(503), 1000);
  assert.equal(byName(s, 'POTA').state, 'error');
  assert.equal(byName(s, 'POTA').limited, false);
  s.note('pota', null, 2000);
  assert.equal(byName(s, 'POTA').state, 'ok');
  assert.equal(byName(s, 'POTA').error, null);
});

test('a query that worked before and now fails is stale', () => {
  const s = new SourceStatus();
  s.note('tles', null, 1000);
  s.note('tles', new Error('timeout'), 2000);
  assert.equal(byName(s, 'CelesTrak').state, 'stale');
  assert.equal(byName(s, 'CelesTrak').error, 'timeout');
});
