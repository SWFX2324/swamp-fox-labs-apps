'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parsePacket } = require('../app/aprs');

const near = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `expected ${b}, got ${a}`);

test('uncompressed position with course, speed and altitude', () => {
  const p = parsePacket('KR4FCD-9>APRS,TCPIP*,qAC,T2:!3407.50N/11603.00W>090/045/A=001234 Hello');
  near(p.lat, 34.125);
  near(p.lon, -116.05);
  assert.equal(p.symbol, '/>');
  assert.equal(p.course, 90);
  near(p.speed, 45 * 1.852, 0.01);
  near(p.alt, 1234 * 0.3048, 0.01);
  assert.equal(p.comment, 'Hello');
  assert.equal(p.path.internet, true);
});

test('compressed position (APRS spec example)', () => {
  const p = parsePacket('N0CALL>APRS:=/5L!!<*e7>7P[');
  near(p.lat, 49.5);
  near(p.lon, -72.75);
  assert.equal(p.compressed, true);
});

test('Mic-E position', () => {
  const p = parsePacket('W1AW-7>T2SP0W,WIDE1-1:`c51l#Q>/]"4-}=');
  near(p.lat, 42.5012, 1e-3);
  near(p.lon, -71.4202, 1e-3);
  assert.equal(p.course, 353);
});

test('weather report with position', () => {
  const p = parsePacket('WX1>APRS:@092345z3407.50N/11603.00W_090/005g010t072r000p000P000h50b10150');
  assert.equal(p.symbol, '/_');
  assert.deepEqual(
    { dir: p.wx.windDir, wind: p.wx.windMph, gust: p.wx.gustMph, temp: p.wx.tempF, hum: p.wx.humidity, hpa: p.wx.pressureHpa },
    { dir: 90, wind: 5, gust: 10, temp: 72, hum: 50, hpa: 1015 });
});

test('objects, killed objects and status', () => {
  const o = parsePacket('OBJ>APRS:;LEADER   *092345z4903.50N/07201.75WA comment');
  assert.equal(o.kind, 'object');
  assert.equal(o.name, 'LEADER');
  assert.equal(o.owner, 'OBJ');
  assert.equal(parsePacket('OBJ>APRS:;LEADER   _092345z4903.50N/07201.75WA').killed, true);
  assert.equal(parsePacket('N0CALL>APRS:>Net tonight 7pm').status, 'Net tonight 7pm');
});

test('third-party packets are unwrapped', () => {
  const p = parsePacket('IGATE>APRS:}KR4FCD>APRS,TCPIP,IGATE*:!3407.50N/11603.00W-');
  assert.equal(p.src, 'KR4FCD');
  near(p.lat, 34.125);
});

test('junk is rejected', () => {
  assert.equal(parsePacket('no colon here'), null);
  assert.equal(parsePacket('N0CALL>APRS:!0000.00N/00000.00W-'), null);
  assert.equal(parsePacket('N0CALL>APRS:!garbage'), null);
});
