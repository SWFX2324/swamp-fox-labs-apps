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

  // Plain-language explanations for the jargon on the dashboard, shown when a
  // dotted term is tapped and listed on the Reference tab.
  const GLOSSARY = {
    sfi: ['Solar flux (SFI)', 'Radio noise from the sun at 10.7 cm, a stand-in for how much ionizing ultraviolet reaches the ionosphere. Higher means the upper HF bands (20–10 m) open more often and longer. Below about 80 is poor, above about 150 is excellent.'],
    ssn: ['Sunspot number (SSN)', 'A daily count of sunspots and sunspot groups. It rises and falls over the roughly 11-year solar cycle and tracks the solar flux: more sunspots, better high-band conditions.'],
    aindex: ['A-index', 'A daily measure of how disturbed Earth’s magnetic field has been, from 0 (quiet) upward. Below about 10 is quiet and good for HF; above 30 means a storm that degrades propagation, especially on paths near the poles.'],
    kindex: ['K-index (Kp)', 'How disturbed Earth’s magnetic field is right now, on a 0–9 scale updated every 3 hours. 0–2 is quiet, 4 is unsettled, 5 or more is a geomagnetic storm: noisy bands, absorbed polar paths, and sometimes aurora.'],
    xray: ['X-ray flux', 'X-rays from solar flares, graded A, B, C, M and X (each 10 times the last). M and X flares can black out HF on the sunlit side of Earth for minutes to hours, starting with the low bands.'],
    solarwind: ['Solar wind', 'The stream of charged particles from the sun, in km/s. Faster than about 500 km/s, especially with a southward Bz, tends to stir up geomagnetic storms.'],
    bz: ['Bz (IMF)', 'The north–south direction of the sun’s magnetic field arriving at Earth. Negative (southward) Bz couples into Earth’s field and drives storms and aurora; positive (northward) Bz keeps things calmer.'],
    noise: ['Noise floor', 'HamQSL’s estimate of the background noise level in S-units. Higher noise (S3 and up) hides weak signals even when a band is open.'],
    rsg: ['NOAA R, S and G scales', 'NOAA’s 0–5 ratings for space weather. R is radio blackouts from flares (HF on the day side), S is solar radiation storms (polar HF absorption), and G is geomagnetic storms (noisy, unstable bands). 0 is none, 5 is extreme.'],
    muf: ['MUF', 'Maximum usable frequency: the highest frequency the ionosphere will bounce over a given path right now. Bands below the MUF can get through; bands above it go into space. It rises with the sun and falls at night.'],
    fot: ['Best working frequency', 'About 85% of the MUF (sometimes called the FOT). Bands near this frequency are usually the most reliable on a path.'],
    fof2: ['foF2', 'The highest frequency the ionosphere reflects straight up. It sets the MUF for every path and the best frequencies for short-range NVIS contacts (just below foF2).'],
    m3000: ['M(3000)', 'How much higher the MUF is for a 3000 km path than straight up (foF2), typically about 3. The dashboard uses measured values to estimate path MUFs.'],
    ionosonde: ['Ionosonde', 'A station that sounds the ionosphere straight up with a sweeping signal to measure foF2 and the MUF. The dashboard anchors its estimates to the live readings of the nearest ones.'],
    grayline: ['Gray line', 'The band of twilight around Earth between day and night. Low-band (160–40 m) signals travel unusually far along it, because the absorbing D layer has faded but the reflecting F layer hasn’t.'],
    absorption: ['D-layer absorption', 'In daylight the lowest layer of the ionosphere soaks up low-frequency signals. That’s why 160, 80 and often 40 m are short-range by day and open for long distance at night.'],
    hop: ['Hop', 'One bounce off the ionosphere, up to about 4000 km. Longer paths take several hops; each one loses some signal.'],
    takeoff: ['Takeoff angle', 'The angle above the horizon a signal leaves at for a path. Long DX needs low angles (a few degrees), so low-angle antennas work better for it.'],
    controlpoint: ['Control point', 'Where a path’s MUF is decided: the point in the ionosphere where the signal reflects. On long paths these are about 2000 km from each end, so the ionosphere near each station matters most.'],
    shortlong: ['Short path and long path', 'The short path is the direct great-circle route. The long path goes the other way round the world (40,000 km minus the short path). Long path sometimes works better, for example when it runs along the gray line.'],
    es: ['Sporadic-E', 'Patches of dense ionization in the E layer that appear without warning, mostly in summer. They open 10, 6 and sometimes 2 m for paths of about 800–2300 km, often for minutes to hours.'],
    tropo: ['Tropo ducting', 'Weather layers (temperature inversions) that bend VHF and UHF signals well beyond the horizon, sometimes for hundreds of kilometres. Common near coasts and with stable high pressure.'],
    meteorscatter: ['Meteor scatter', 'Signals reflected off the ionized trails of meteors, usually for less than a second. With the MSK144 mode it works on 6 and 2 m any day, so the dashboard leaves it out when deciding if a band is “open”.'],
    aurora: ['Aurora', 'During strong geomagnetic storms the aurora can reflect VHF signals, giving a raspy, distorted sound. It also absorbs HF on paths that cross the polar regions.'],
    ft8: ['FT8', 'A digital mode that decodes very weak signals in 15-second cycles. Because so many stations run it and report what they hear, it’s the best live picture of which bands are open.'],
    psk: ['PSKReporter', 'A free service that collects automatic reception reports from thousands of receiving stations, mostly decoding FT8. “Heard nearby” and the VHF openings are measured from it.'],
    hamqsl: ['HamQSL ratings', 'N0NBH’s worldwide day and night ratings for pairs of HF bands, based on solar flux and geomagnetic conditions. They’re a general guide, not specific to your location.'],
    dx: ['DX', 'Long-distance contacts, usually with other countries. A “DX spot” is a report that a station is on the air on a frequency.'],
    qth: ['QTH', 'Your station’s location. The dashboard uses your grid square for it.'],
    grid: ['Grid square', 'The Maidenhead locator system hams use to give a location compactly, like DM14xd. 4 characters is about 100 by 200 km; 6 characters is a few kilometres.'],
    ncdxf: ['NCDXF beacons', 'Eighteen beacons run by the Northern California DX Foundation and the IARU. They take turns on 14.100, 18.110, 21.150, 24.930 and 28.200 MHz, so a quick listen tells you which directions a band is open toward.'],
    aos: ['AOS, TCA and LOS', 'Satellite pass times: acquisition of signal (rises above the horizon), time of closest approach (highest point), and loss of signal (sets).'],
    doppler: ['Doppler shift', 'A satellite’s speed shifts its frequencies up as it approaches and down as it leaves, by up to several kHz on 70 cm. Tune to follow it during a pass.'],
    offset: ['Repeater offset', 'Repeaters listen on one frequency and transmit on another. The offset is the difference (for example −600 kHz on 2 m), so you transmit on the input and listen on the output.'],
    tone: ['Tone (CTCSS)', 'A low tone sent under your voice that many repeaters require before they’ll relay you. It’s set on your radio, for example 100.0 Hz.'],
    igate: ['iGate and digipeater', 'APRS relays. A digipeater repeats packets over the air to extend range; an iGate passes packets heard over the air to the internet (APRS-IS), which is where the dashboard gets them.'],
    pota: ['POTA', 'Parks on the Air: hams operating portable from parks (activators) and others contacting them (hunters). Spots show who’s on the air from which park.'],
  };

  root.HamReference = {
    GLOSSARY,
    US_BAND_PLAN, LICENSE_CLASSES, MODE_LABEL, GMRS_FRS, MURS, CB, BEACON_BANDS, BEACONS, beaconSchedule,
    TIME_STATIONS, minutesToAlert, privileges,
  };
})(typeof self !== 'undefined' ? self : this);
