'use strict';
// Reference data for the Reference tab: US amateur privileges (FCC Part 97,
// sections 97.301, 97.305 and 97.313), GMRS and FRS channels (Part 95), and the
// license-free MURS and CB services. Frequencies in MHz.

(function (root) {
  // Segment modes: 'cw' = CW, RTTY and data; 'phone' = phone and image (CW is
  // allowed too); 'all' = every mode; 'cwonly' = CW only.
  // Classes: T = Technician, G = General, A = Advanced, E = Amateur Extra.
  const US_BAND_PLAN = [
    { band: '160m', lo: 1.8, hi: 2.0, segments: [[1.8, 2.0, 'all', 'GAE']] },
    {
      band: '80m', lo: 3.5, hi: 4.0, segments: [
        [3.5, 3.525, 'cw', 'E'], [3.525, 3.6, 'cw', 'TGAE'],
        [3.6, 3.7, 'phone', 'E'], [3.7, 3.8, 'phone', 'AE'], [3.8, 4.0, 'phone', 'GAE'],
      ], note: { T: 'Technicians: CW only, 200 W.' },
    },
    {
      band: '60m', lo: 5.3305, hi: 5.4035, channels: [5.3305, 5.3465, 5.357, 5.3715, 5.4035], classes: 'GAE',
      note: { all: 'Five channels, shown as USB dial frequencies (each channel’s center is 1.5 kHz higher). USB phone, CW and data, 100 W ERP. 60 m rules have been changing, so check the current FCC rules.' },
    },
    {
      band: '40m', lo: 7.0, hi: 7.3, segments: [
        [7.0, 7.025, 'cw', 'E'], [7.025, 7.125, 'cw', 'TGAE'],
        [7.125, 7.175, 'phone', 'AE'], [7.175, 7.3, 'phone', 'GAE'],
      ], note: { T: 'Technicians: CW only, 200 W.' },
    },
    { band: '30m', lo: 10.1, hi: 10.15, segments: [[10.1, 10.15, 'cw', 'GAE']], note: { all: '200 W PEP. No phone.' } },
    {
      band: '20m', lo: 14.0, hi: 14.35, segments: [
        [14.0, 14.025, 'cw', 'E'], [14.025, 14.15, 'cw', 'GAE'],
        [14.15, 14.175, 'phone', 'E'], [14.175, 14.225, 'phone', 'AE'], [14.225, 14.35, 'phone', 'GAE'],
      ],
    },
    { band: '17m', lo: 18.068, hi: 18.168, segments: [[18.068, 18.11, 'cw', 'GAE'], [18.11, 18.168, 'phone', 'GAE']] },
    {
      band: '15m', lo: 21.0, hi: 21.45, segments: [
        [21.0, 21.025, 'cw', 'E'], [21.025, 21.2, 'cw', 'TGAE'],
        [21.2, 21.225, 'phone', 'E'], [21.225, 21.275, 'phone', 'AE'], [21.275, 21.45, 'phone', 'GAE'],
      ], note: { T: 'Technicians: CW only, 200 W.' },
    },
    { band: '12m', lo: 24.89, hi: 24.99, segments: [[24.89, 24.93, 'cw', 'GAE'], [24.93, 24.99, 'phone', 'GAE']] },
    {
      band: '10m', lo: 28.0, hi: 29.7, segments: [
        [28.0, 28.3, 'cw', 'TGAE'], [28.3, 28.5, 'phone', 'TGAE'], [28.5, 29.7, 'phone', 'GAE'],
      ], note: { T: 'Technicians: 200 W PEP; phone from 28.300 to 28.500 only.' },
    },
    { band: '6m', lo: 50, hi: 54, segments: [[50, 50.1, 'cwonly', 'TGAE'], [50.1, 54, 'all', 'TGAE']] },
    { band: '2m', lo: 144, hi: 148, segments: [[144, 144.1, 'cwonly', 'TGAE'], [144.1, 148, 'all', 'TGAE']] },
    { band: '1.25m', lo: 222, hi: 225, segments: [[222, 225, 'all', 'TGAE']] },
    { band: '70cm', lo: 420, hi: 450, segments: [[420, 450, 'all', 'TGAE']] },
  ];

  const LICENSE_CLASSES = [['T', 'Technician'], ['G', 'General'], ['A', 'Advanced'], ['E', 'Amateur Extra']];
  const MODE_LABEL = { cw: 'CW, RTTY, data', phone: 'Phone, image, CW', all: 'All modes', cwonly: 'CW only' };

  // GMRS and FRS share 22 channels (FCC 95.1763, 95.1767 and 95.567).
  // Power is ERP for GMRS and FRS handhelds.
  const ch = (n, mhz, gmrs, frs, note = '') => ({ n, mhz, gmrs, frs, note });
  const GMRS_FRS = [
    ...[462.5625, 462.5875, 462.6125, 462.6375, 462.6625, 462.6875, 462.7125].map((f, i) => ch(i + 1, f, '5 W', '2 W')),
    ...[467.5625, 467.5875, 467.6125, 467.6375, 467.6625, 467.6875, 467.7125].map((f, i) => ch(i + 8, f, '0.5 W', '0.5 W', 'Narrowband')),
    ...[462.55, 462.575, 462.6, 462.625, 462.65, 462.675, 462.7, 462.725].map((f, i) => ch(i + 15, f, '50 W', '2 W',
      `Repeater output; input ${(f + 5).toFixed(4)} MHz (${i + 15}R)${i + 15 === 20 ? '. Often used for emergency and travel help (not official).' : ''}`)),
  ];

  // MURS (FCC 95.2763): license-free, 2 W.
  const MURS = [
    { n: 1, mhz: 151.82, note: 'Narrowband (11.25 kHz)' },
    { n: 2, mhz: 151.88, note: 'Narrowband (11.25 kHz)' },
    { n: 3, mhz: 151.94, note: 'Narrowband (11.25 kHz)' },
    { n: 4, mhz: 154.57, note: 'Wideband allowed (20 kHz)' },
    { n: 5, mhz: 154.6, note: 'Wideband allowed (20 kHz)' },
  ];

  // CB (FCC 95.963): license-free, 4 W AM or 12 W PEP SSB.
  const CB_MHZ = [26.965, 26.975, 26.985, 27.005, 27.015, 27.025, 27.035, 27.055, 27.065, 27.075, 27.085, 27.105, 27.115, 27.125,
    27.135, 27.155, 27.165, 27.175, 27.185, 27.205, 27.215, 27.225, 27.255, 27.235, 27.245, 27.265, 27.275, 27.285, 27.295, 27.305,
    27.315, 27.325, 27.335, 27.345, 27.355, 27.365, 27.375, 27.385, 27.395, 27.405];
  const CB = CB_MHZ.map((mhz, i) => ({ n: i + 1, mhz, note: i + 1 === 9 ? 'Emergency' : i + 1 === 19 ? 'Highway / road' : '' }));

  // What a license class may use on a band, as [lo, hi, mode] with neighboring
  // segments of the same mode merged. Technicians are CW-only on 80, 40 and 15 m.
  function privileges(entry, cls) {
    if (entry.channels) return entry.classes.includes(cls) ? entry.channels.map(f => [f, f, 'channel']) : [];
    const out = [];
    for (const [lo, hi, mode, classes] of entry.segments) {
      if (!classes.includes(cls)) continue;
      const m = cls === 'T' && ['80m', '40m', '15m'].includes(entry.band) ? 'cwonly' : mode;
      const last = out[out.length - 1];
      if (last && last[2] === m && Math.abs(last[1] - lo) < 1e-9) last[1] = hi;
      else out.push([lo, hi, m]);
    }
    return out;
  }

  // NCDXF/IARU International Beacon Project: 18 beacons take turns on five
  // bands. Each sends for 10 seconds (its call in CW, then dashes at 100, 10, 1
  // and 0.1 W); the full cycle repeats every 3 minutes, starting with 4U1UN on
  // 14.100 MHz at 00:00:00 UTC, and each band runs one beacon behind the last.
  const BEACON_BANDS = [['20m', 14.1], ['17m', 18.11], ['15m', 21.15], ['12m', 24.93], ['10m', 28.2]];
  const BEACONS = [
    ['4U1UN', 'United Nations, New York', 40.75, -73.97], ['VE8AT', 'Eureka, Nunavut', 79.99, -85.84],
    ['W6WX', 'Mt Umunhum, California', 37.16, -121.9], ['KH6RS', 'Maui, Hawaii', 20.75, -156.43],
    ['ZL6B', 'Masterton, New Zealand', -41.06, 175.59], ['VK6RBP', 'Rolystone, Australia', -32.11, 116.05],
    ['JA2IGY', 'Mt Asama, Japan', 34.46, 136.78], ['RR9O', 'Novosibirsk, Russia', 54.98, 82.89],
    ['VR2B', 'Hong Kong', 22.27, 114.15], ['4S7B', 'Colombo, Sri Lanka', 6.9, 79.87],
    ['ZS6DN', 'Pretoria, South Africa', -25.9, 28.27], ['5Z4B', 'Kikuyu, Kenya', -1.25, 36.67],
    ['4X6TU', 'Tel Aviv, Israel', 32.05, 34.78], ['OH2B', 'Lohja, Finland', 60.32, 24.83],
    ['CS3B', 'Madeira, Portugal', 32.82, -17.22], ['LU4AA', 'Buenos Aires, Argentina', -34.62, -58.36],
    ['OA4B', 'Lima, Peru', -12.07, -76.98], ['YV5B', 'Caracas, Venezuela', 9.09, -67.83],
  ].map(([call, place, lat, lon]) => ({ call, place, lat, lon }));

  // Which beacon is on each band at time t (ms), and seconds until the next.
  function beaconSchedule(t) {
    const s = Math.floor(t / 1000) % 180;
    const slot = Math.floor(s / 10);
    return {
      remaining: 10 - (s % 10),
      bands: BEACON_BANDS.map(([band, mhz], b) => ({ band, mhz, now: (slot - b + 18) % 18, next: (slot - b + 19) % 18 })),
    };
  }

  // NIST time-signal stations. Both send the time around the clock in voice
  // and tones, and read out a geophysical alert (solar flux, A and K index)
  // once an hour: WWV at 18 minutes past, WWVH at 45. Power in kW.
  const TIME_STATIONS = [
    {
      call: 'WWV', place: 'Fort Collins, Colorado', lat: 40.6781, lon: -105.0469, alertMinute: 18, voice: 'male',
      freqs: [[2.5, 2.5], [5, 10], [10, 10], [15, 10], [20, 2.5], [25, 2.5]],
    },
    {
      call: 'WWVH', place: 'Kekaha, Kauai, Hawaii', lat: 21.9886, lon: -159.7642, alertMinute: 45, voice: 'female',
      freqs: [[2.5, 5], [5, 10], [10, 10], [15, 10]],
    },
  ];

  // Minutes until a station's next geophysical alert at time t (ms).
  function minutesToAlert(station, t) {
    const d = new Date(t);
    const now = d.getUTCMinutes() + d.getUTCSeconds() / 60;
    return Math.ceil((station.alertMinute - now + 60) % 60);
  }

  root.HamReference = {
    US_BAND_PLAN, LICENSE_CLASSES, MODE_LABEL, GMRS_FRS, MURS, CB, BEACON_BANDS, BEACONS, beaconSchedule,
    TIME_STATIONS, minutesToAlert, privileges,
  };
})(typeof self !== 'undefined' ? self : this);
