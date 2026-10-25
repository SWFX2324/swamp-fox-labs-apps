'use strict';
// Ham Radio Dashboard front end. All API paths are relative so the page works
// behind Home Assistant ingress (/api/hassio_ingress/<token>/).

(() => {
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SVGNS = 'http://www.w3.org/2000/svg';
  const RAD = Math.PI / 180;

  const state = {
    defaults: { callsign: '', grid: '', distance_units: 'mi' },
    settings: loadSettings(),
    solar: null, iono: [], spots: null, psk: null, cycle: null, land: null,
    bandFilter: storeGet('hamdash.band') || '',
  };

  // ------------------------------------------------------------ storage

  function storeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
  function storeSet(key, val) { try { val == null ? localStorage.removeItem(key) : localStorage.setItem(key, val); } catch { /* private mode */ } }
  function loadSettings() { try { return JSON.parse(storeGet('hamdash.settings')) || {}; } catch { return {}; } }

  function station() {
    const s = state.settings, d = state.defaults;
    return {
      callsign: (s.callsign || d.callsign || '').toUpperCase(),
      grid: s.grid || d.grid || '',
      units: s.units || d.distance_units || 'mi',
    };
  }

  async function api(path) {
    const r = await fetch(path, { cache: 'no-store' });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  // ------------------------------------------------------------ geo + sun math

  function gridToLatLon(grid) {
    const m = String(grid || '').trim().toUpperCase().match(/^([A-R])([A-R])(\d)(\d)([A-X])?([A-X])?/);
    if (!m) return null;
    let lon = (m[1].charCodeAt(0) - 65) * 20 - 180 + +m[3] * 2;
    let lat = (m[2].charCodeAt(0) - 65) * 10 - 90 + +m[4];
    if (m[5] && m[6]) {
      lon += (m[5].charCodeAt(0) - 65) / 12 + 1 / 24;
      lat += (m[6].charCodeAt(0) - 65) / 24 + 1 / 48;
    } else { lon += 1; lat += 0.5; }
    return { lat, lon };
  }

  function latLonToGrid(lat, lon) {
    const L = lon + 180, A = lat + 90;
    const c = n => String.fromCharCode(65 + n);
    return c(Math.floor(L / 20)) + c(Math.floor(A / 10)) +
      Math.floor((L % 20) / 2) + Math.floor(A % 10) +
      c(Math.floor((L % 2) * 12)).toLowerCase() + c(Math.floor((A % 1) * 24)).toLowerCase();
  }

  function distanceKm(a, b) {
    const dLat = (b.lat - a.lat) * RAD, dLon = (b.lon - a.lon) * RAD;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLon / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function fmtDist(km) {
    if (km == null) return '—';
    const mi = station().units === 'mi';
    return `${Math.round(mi ? km * 0.621371 : km).toLocaleString()} ${mi ? 'mi' : 'km'}`;
  }

  // Subsolar point (low-precision almanac, good to ~0.1°).
  function sunPosition(date) {
    const d = date.getTime() / 86400000 + 2440587.5 - 2451545.0;
    const g = (357.529 + 0.98560028 * d) * RAD;
    const q = 280.459 + 0.98564736 * d;
    const L = (q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * RAD;
    const e = (23.439 - 0.00000036 * d) * RAD;
    const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / RAD;
    const dec = Math.asin(Math.sin(e) * Math.sin(L)) / RAD;
    const gmst = (280.46061837 + 360.98564736629 * d) % 360;
    return { lat: dec, lon: ((ra - gmst + 540) % 360) - 180 };
  }

  function sunAltitude(sun, lat, lon) {
    const s = Math.sin(lat * RAD) * Math.sin(sun.lat * RAD) +
      Math.cos(lat * RAD) * Math.cos(sun.lat * RAD) * Math.cos((lon - sun.lon) * RAD);
    return Math.asin(Math.max(-1, Math.min(1, s))) / RAD;
  }

  // Scan the local day for horizon crossings (sunrise/set and civil twilight).
  function sunTimes(pos, day = new Date()) {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const out = {};
    let prev = null;
    for (let m = 0; m <= 1440; m++) {
      const t = new Date(start.getTime() + m * 60000);
      const alt = sunAltitude(sunPosition(t), pos.lat, pos.lon);
      if (prev !== null) {
        if (prev < -0.833 && alt >= -0.833) out.sunrise = t;
        if (prev >= -0.833 && alt < -0.833) out.sunset = t;
        if (prev < -6 && alt >= -6) out.dawn = t;
        if (prev >= -6 && alt < -6) out.dusk = t;
      }
      prev = alt;
    }
    return out;
  }

  // ------------------------------------------------------------ formatting

  const pad = n => String(n).padStart(2, '0');
  const utcHM = d => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const localHM = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const utcDay = d => `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const ago = t => {
    const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
    if (s < 90) return 'just now';
    if (s < 5400) return `${Math.round(s / 60)} min ago`;
    if (s < 129600) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };

  // ------------------------------------------------------------ tooltip

  const tip = $('#tooltip');
  function showTip(html, x, y) {
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > innerHeight - 8) top = y - r.height - 14;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.top = `${Math.max(8, top)}px`;
  }
  const hideTip = () => { tip.hidden = true; };
  const tipRow = (k, v) => `<div class="row"><span class="k">${esc(k)}</span><b>${v}</b></div>`;

  // ------------------------------------------------------------ status scales

  const RATING = ['closed', 'poor', 'fair', 'good'];
  const RATING_LABEL = { closed: 'Closed', poor: 'Poor', fair: 'Fair', good: 'Good' };
  const pill = (cls, label, title = '') => `<span class="pill s-${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
  const ratingPill = (r, title) => (r ? pill(r, RATING_LABEL[r], title) : pill('none', 'n/a', title));
  const hamqslPill = v => {
    const k = String(v || '').toLowerCase();
    return RATING.includes(k) ? pill(k, RATING_LABEL[k]) : pill('none', v || 'n/a');
  };

  function kpStatus(kp) {
    if (kp == null) return { cls: 'none', label: 'n/a', color: css('--closed') };
    if (kp < 3) return { cls: 'good', label: 'Quiet', color: css('--good') };
    if (kp < 4) return { cls: 'good', label: 'Unsettled', color: css('--good') };
    if (kp < 5) return { cls: 'fair', label: 'Active', color: css('--warning') };
    if (kp < 6) return { cls: 'serious', label: 'G1 minor storm', color: css('--serious') };
    if (kp < 7) return { cls: 'serious', label: 'G2 moderate storm', color: css('--serious') };
    if (kp < 8) return { cls: 'poor', label: 'G3 strong storm', color: css('--critical') };
    if (kp < 9) return { cls: 'poor', label: 'G4 severe storm', color: css('--critical') };
    return { cls: 'poor', label: 'G5 extreme storm', color: css('--critical') };
  }

  function scaleColor(n) {
    if (!n) return css('--good');
    if (n <= 2) return css('--warning');
    if (n === 3) return css('--serious');
    return css('--critical');
  }

  function currentKp() {
    const kp = state.solar?.kp;
    if (kp?.length) {
      const now = Date.now();
      const past = kp.filter(k => k.kind !== 'predicted' && Date.parse(k.time) <= now);
      if (past.length) return past[past.length - 1].kp;
    }
    return state.solar?.hamqsl?.k ?? null;
  }

  // ------------------------------------------------------------ header / clocks

  function tickClocks() {
    const now = new Date();
    $('#clockUtc').textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())}`;
    $('#clockLocal').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function renderHeader() {
    const st = station();
    $('#hdrCall').textContent = st.callsign || 'Set callsign';
    $('#hdrGrid').textContent = st.grid || 'Set grid';
    $('#pskCall').textContent = st.callsign || 'you';
  }

  // ------------------------------------------------------------ solar tiles

  function tile(label, value, unit, sub, extra = '') {
    return `<div class="tile"><span class="label">${esc(label)}${extra}</span>
      <span class="value">${value == null || value === '' ? '—' : esc(value)}${unit && value != null ? `<span class="unit">${esc(unit)}</span>` : ''}</span>
      <span class="sub" title="${esc(sub)}">${esc(sub || '')}</span></div>`;
  }

  function renderTiles() {
    const s = state.solar;
    if (!s) return;
    const h = s.hamqsl || {}, w = s.wind || {}, x = s.xray || {};
    const kp = currentKp();
    const ks = kpStatus(kp);
    const bz = w.bz ?? h.bz;
    $('#tiles').innerHTML = [
      tile('Solar flux (SFI)', h.sfi ?? w.f107, '', '10.7 cm radio flux'),
      tile('Sunspot number', h.ssn, '', 'Daily SSN'),
      tile('A-index', h.a, '', h.geomagfield ? `Field ${h.geomagfield.toLowerCase()}` : 'Daily geomagnetic'),
      tile('K-index', kp == null ? null : (Math.round(kp * 100) / 100).toString(), '', ks.label, ' ' + pill(ks.cls, ks.cls === 'good' ? 'OK' : ks.cls === 'fair' ? 'Active' : 'Storm')),
      tile('X-ray flux', x.current || h.xray, '', x.max6h ? `6 h peak ${x.max6h}` : 'GOES 0.1–0.8 nm'),
      tile('Solar wind', w.speed ?? h.solarwind, 'km/s', w.bt != null ? `Bt ${w.bt} nT` : 'Proton speed'),
      tile('Bz (IMF)', bz, 'nT', bz == null ? '' : bz < 0 ? 'Southward: storms more likely' : 'Northward: quieter'),
      tile('Noise floor', h.signalnoise, '', 'Estimated band noise'),
    ].join('');
    $('#solarUpdated').textContent = h.updated ? `HamQSL updated ${h.updated}` : '';
  }

  // ------------------------------------------------------------ NOAA R/S/G

  function renderScales() {
    const sc = state.solar?.scales;
    if (!sc?.current) { $('#rsg').innerHTML = '<div class="empty">NOAA scales unavailable</div>'; return; }
    const names = { R: 'Radio blackouts', S: 'Radiation storms', G: 'Geomagnetic storms' };
    $('#rsg').innerHTML = ['R', 'S', 'G'].map(k => {
      const v = sc.current[k] || {};
      const n = v.scale ?? 0;
      return `<div class="scale" style="--c:${scaleColor(n)}">
        <div class="letter">${names[k]}</div>
        <div class="big">${k}${n}</div>
        <div class="desc">${esc(v.text && v.text !== 'none' ? v.text : 'None')}</div></div>`;
    }).join('');
    const y = sc.yesterday;
    $('#rsgDate').textContent = y ? `Yesterday's max: R${y.R.scale ?? 0} S${y.S.scale ?? 0} G${y.G.scale ?? 0}` : '';
    const pct = v => (v == null ? '—' : `${v}%`);
    $('#rsgForecast').innerHTML = `<thead><tr><th>Forecast</th><th>R1–R2</th><th>R3+</th><th>S1+</th><th>G max</th></tr></thead><tbody>${
      sc.forecast.map(f => `<tr><td>${esc(utcDay(new Date(f.date + 'T12:00:00Z')))}</td><td>${pct(f.R.minorProb)}</td><td>${pct(f.R.majorProb)}</td><td>${pct(f.S.prob)}</td><td>G${f.G.scale ?? 0}</td></tr>`).join('')
    }</tbody>`;
  }

  // ------------------------------------------------------------ bands

  const HF_BANDS = [
    ['80m', 3.6, '80m-40m'], ['60m', 5.36, '80m-40m'], ['40m', 7.1, '80m-40m'],
    ['30m', 10.12, '30m-20m'], ['20m', 14.1, '30m-20m'], ['17m', 18.1, '17m-15m'],
    ['15m', 21.2, '17m-15m'], ['12m', 24.94, '12m-10m'], ['10m', 28.4, '12m-10m'], ['6m', 50.15, null],
  ];

  function nearestIonosonde(pos) {
    if (!pos || !state.iono.length) return null;
    let best = null;
    for (const s of state.iono) {
      const d = distanceKm(pos, s);
      if (!best || d < best.dist) best = { ...s, dist: d };
    }
    return best && best.dist <= 3000 ? best : null;
  }

  // Heuristic DX rating for one band at the QTH: compares the band to the
  // nearest ionosonde's MUF(3000), then applies daytime D-layer absorption on
  // the low bands and a geomagnetic penalty.
  function rateBand(mhz, muf, sunAlt, kp) {
    if (!muf) return null;
    const r = mhz / muf;
    let score = r <= 0.85 ? 3 : r <= 0.95 ? 2 : r <= 1.05 ? 1 : 0;
    if (score > 0 && sunAlt > 10) {
      if (mhz < 4) score = Math.min(score, 1);
      else if (mhz < 6) score = Math.min(score, 2);
      else if (mhz < 8 && sunAlt > 40) score = Math.min(score, 2);
    }
    if (score > 0 && kp >= 7) score = Math.max(1, score - 2);
    else if (score > 0 && kp >= 5) score = Math.max(1, score - 1);
    return RATING[score];
  }

  function renderBands() {
    const h = state.solar?.hamqsl;
    const pos = gridToLatLon(station().grid);
    const sunAlt = pos ? sunAltitude(sunPosition(new Date()), pos.lat, pos.lon) : null;
    const isDay = sunAlt == null ? new Date().getUTCHours() >= 12 && new Date().getUTCHours() < 24 : sunAlt > -0.833;
    const iono = nearestIonosonde(pos);
    const kp = currentKp();
    const groups = Object.fromEntries((h?.bands || []).map(b => [b.name, b]));

    const head = `<thead><tr><th>Band</th><th class="freq">MHz</th>
      <th>At your QTH now<small>${iono ? `MUF ${iono.mufd.toFixed(1)} MHz` : pos ? 'no nearby ionosonde' : 'set grid'}</small></th>
      <th class="${isDay ? 'now' : ''}">HamQSL day${isDay ? '<small>now</small>' : '<small>&nbsp;</small>'}</th>
      <th class="${!isDay ? 'now' : ''}">HamQSL night${!isDay ? '<small>now</small>' : '<small>&nbsp;</small>'}</th></tr></thead>`;
    const body = HF_BANDS.map(([name, mhz, group]) => {
      const g = groups[group];
      const r = iono ? rateBand(mhz, iono.mufd, sunAlt ?? 0, kp ?? 0) : null;
      const why = iono ? `${mhz} MHz vs MUF ${iono.mufd.toFixed(1)} MHz${name === '6m' && r === 'closed' ? ' (sporadic-E can still open 6m)' : ''}` : '';
      return `<tr><td class="band">${name}</td><td class="freq">${mhz}</td>
        <td>${ratingPill(r, why)}</td>
        <td class="${isDay ? '' : 'dim'}">${g ? hamqslPill(g.day) : '<span class="meta">—</span>'}</td>
        <td class="${!isDay ? '' : 'dim'}">${g ? hamqslPill(g.night) : '<span class="meta">—</span>'}</td></tr>`;
    }).join('');
    $('#bandsTable').innerHTML = head + `<tbody>${body}</tbody>`;
    $('#bandsMeta').textContent = sunAlt == null ? '' : `Sun ${sunAlt >= 0 ? 'up' : 'down'} at QTH (${sunAlt.toFixed(0)}°)`;

    let note = 'HamQSL ratings are N0NBH’s global estimates for band pairs. ';
    if (iono) {
      note += `“At your QTH” is an estimate from the ${iono.name} ionosonde (${fmtDist(iono.dist)} away, measured ${ago(iono.time)}), with daytime absorption and the current Kp of ${kp ?? '?'} factored in.`;
    } else if (pos) {
      note += 'No ionosonde within 3000 km has reported in the last 3 hours, so the local estimate is unavailable.';
    } else {
      note += 'Set your grid square for a local estimate.';
    }
    $('#bandsNote').textContent = note;

    const VHF_LABEL = {
      'vhf-aurora|northern_hemi': 'Aurora (N. hemisphere)',
      'E-Skip|north_america': '2 m Es · N. America',
      'E-Skip|europe': '2 m Es · Europe',
      'E-Skip|europe_6m': '6 m Es · Europe',
      'E-Skip|europe_4m': '4 m Es · Europe',
    };
    $('#vhf').innerHTML = (h?.vhf || []).map(v => {
      const open = !/closed/i.test(v.status);
      return `<span class="item">${esc(VHF_LABEL[`${v.name}|${v.location}`] || `${v.name} ${v.location}`)} ${pill(open ? 'good' : 'closed', open ? v.status : 'Closed')}</span>`;
    }).join('');
  }

  // ------------------------------------------------------------ gray line map

  function decodeLand(topo) {
    const [sx, sy] = topo.transform.scale, [tx, ty] = topo.transform.translate;
    const arcs = topo.arcs.map(arc => {
      let x = 0, y = 0;
      return arc.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
    });
    // world-atlas rings may cross the antimeridian. Unwrap longitudes so each
    // ring is continuous (drawn again at ±360°), and close rings that wrap all
    // the way around a pole (Antarctica) along that pole.
    const unwrap = pts => {
      const out = [pts[0].slice()];
      for (let i = 1; i < pts.length; i++) {
        let lon = pts[i][0];
        const prev = out[i - 1][0];
        while (lon - prev > 180) lon -= 360;
        while (lon - prev < -180) lon += 360;
        out.push([lon, pts[i][1]]);
      }
      if (Math.abs(out[out.length - 1][0] - out[0][0]) > 180) {
        const pole = out.reduce((s, p) => s + p[1], 0) / out.length < 0 ? -90 : 90;
        out.push([out[out.length - 1][0], pole], [out[0][0], pole]);
      }
      return out;
    };
    const ring = idx => {
      const pts = [];
      for (const i of idx) {
        const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
        pts.push(...(pts.length ? a.slice(1) : a));
      }
      return unwrap(pts);
    };
    const polys = [];
    for (const g of topo.objects.land.geometries) {
      for (const p of g.type === 'Polygon' ? [g.arcs] : g.arcs) polys.push(p.map(ring));
    }
    return polys;
  }

  let mapDots = [];

  function drawGrayline() {
    const canvas = $('#grayline');
    const w = canvas.clientWidth;
    if (!w) return;
    const h = w / 2;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const X = lon => ((lon + 180) / 360) * w;
    const Y = lat => ((90 - lat) / 180) * h;

    ctx.fillStyle = css('--ocean');
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = css('--grid-line');
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    for (let lon = -150; lon < 180; lon += 30) { ctx.moveTo(X(lon), 0); ctx.lineTo(X(lon), h); }
    for (let lat = -60; lat <= 60; lat += 30) { ctx.moveTo(0, Y(lat)); ctx.lineTo(w, Y(lat)); }
    ctx.stroke();

    if (state.land) {
      ctx.fillStyle = css('--land');
      ctx.strokeStyle = css('--land-edge');
      ctx.lineWidth = 0.6;
      for (const poly of state.land) {
        const lons = poly[0].map(p => p[0]);
        const offsets = [0];
        if (Math.min(...lons) < -180) offsets.push(360);
        if (Math.max(...lons) > 180) offsets.push(-360);
        for (const off of offsets) {
          ctx.beginPath();
          for (const ring of poly) {
            ring.forEach(([lon, lat], i) => (i ? ctx.lineTo(X(lon + off), Y(lat)) : ctx.moveTo(X(lon + off), Y(lat))));
            ctx.closePath();
          }
          ctx.fill('evenodd');
          ctx.stroke();
        }
      }
    }

    // Night shading at low resolution, scaled up smoothly.
    const now = new Date();
    const sun = sunPosition(now);
    const ow = 720, oh = 360;
    const off = document.createElement('canvas');
    off.width = ow; off.height = oh;
    const octx = off.getContext('2d');
    const img = octx.createImageData(ow, oh);
    const [nr, ng, nb] = css('--night').split(',').map(Number);
    const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    for (let y = 0; y < oh; y++) {
      const lat = 90 - ((y + 0.5) * 180) / oh;
      for (let x = 0; x < ow; x++) {
        const lon = -180 + ((x + 0.5) * 360) / ow;
        const alt = sunAltitude(sun, lat, lon);
        if (alt > 1) continue;
        const i = (y * ow + x) * 4;
        // Night darkens smoothly from the terminator to astronomical night;
        // the gray line (sun 0..-6°) gets a warm tint that fades at both edges.
        const night = smooth(1, -2, alt) * (0.4 + 0.3 * smooth(-6, -18, alt));
        const gray = Math.max(0, 1 - Math.abs(alt + 3) / 4);
        img.data[i] = nr + (214 - nr) * gray;
        img.data[i + 1] = ng + (160 - ng) * gray;
        img.data[i + 2] = nb + (60 - nb) * gray;
        img.data[i + 3] = Math.round(255 * (night * (1 - gray) + 0.32 * gray));
      }
    }
    octx.putImageData(img, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, 0, 0, w, h);

    mapDots = [];
    const st = station();
    const pos = gridToLatLon(st.grid);

    // PSKReporter receivers.
    const reports = state.psk?.reports || [];
    if (reports.length) {
      ctx.fillStyle = css('--series-2');
      ctx.strokeStyle = css('--card');
      ctx.lineWidth = 1.5;
      const seen = new Set();
      for (const r of reports) {
        if (seen.has(r.rx)) continue;
        seen.add(r.rx);
        const p = gridToLatLon(r.rxGrid);
        if (!p) continue;
        const x = X(p.lon), y = Y(p.lat);
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        mapDots.push({ x, y, html: `<b class="mono">${esc(r.rx)}</b><br>${esc(r.rxCountry || '')}${tipRow('Band', bandName(r.freq) || '—')}${tipRow('Mode', esc(r.mode))}${tipRow('SNR', `${r.snr ?? '—'} dB`)}${pos ? tipRow('Distance', fmtDist(distanceKm(pos, p))) : ''}` });
      }
    }

    // Ionosonde used for the band estimate.
    const iono = nearestIonosonde(pos);
    if (iono) {
      const x = X(iono.lon), y = Y(iono.lat);
      ctx.fillStyle = css('--series-1');
      ctx.strokeStyle = css('--card');
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5.5, y + 4); ctx.lineTo(x - 5.5, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
      mapDots.push({ x, y, html: `<b>${esc(iono.name)}</b> ionosonde${tipRow('MUF(3000)', `${iono.mufd.toFixed(1)} MHz`)}${tipRow('foF2', `${iono.fof2?.toFixed(1) ?? '—'} MHz`)}${tipRow('Measured', ago(iono.time))}` });
    }

    // Subsolar point.
    {
      const x = X(sun.lon), y = Y(sun.lat);
      ctx.fillStyle = '#fab219';
      ctx.strokeStyle = '#8a5a00';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      mapDots.push({ x, y, html: `<b>Sun overhead</b>${tipRow('Lat', sun.lat.toFixed(1) + '°')}${tipRow('Lon', sun.lon.toFixed(1) + '°')}` });
    }

    // QTH.
    if (pos) {
      const x = X(pos.lon), y = Y(pos.lat);
      ctx.strokeStyle = css('--card');
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
      ctx.strokeStyle = css('--text');
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillStyle = css('--text');
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
      mapDots.push({ x, y, html: `<b class="mono">${esc(st.callsign || 'Your QTH')}</b>${tipRow('Grid', esc(st.grid))}` });
    }

    $('#graylineLegend').innerHTML = `
      <span><span class="sw" style="background:rgb(${nr} ${ng} ${nb} / .6)"></span>Night</span>
      <span><span class="sw" style="background:rgb(214 160 60 / .55)"></span>Gray line (civil twilight)</span>
      <span><span class="sw dot" style="background:#fab219"></span>Sun overhead</span>
      ${pos ? `<span><span class="sw dot" style="border:2px solid ${css('--text')}"></span>Your QTH</span>` : ''}
      ${iono ? `<span><span class="sw" style="background:${css('--series-1')};clip-path:polygon(50% 0,100% 100%,0 100%)"></span>Ionosonde used</span>` : ''}
      ${reports.length ? `<span><span class="sw dot" style="background:${css('--series-2')}"></span>Stations hearing you (PSKReporter)</span>` : ''}`;

    renderSunTimes(pos, sun);
  }

  function renderSunTimes(pos, sun) {
    if (!pos) { $('#sunTimes').innerHTML = '<div class="empty">Set your grid square to see sunrise, sunset and gray line times.</div>'; return; }
    const t = sunTimes(pos);
    const alt = sunAltitude(sun, pos.lat, pos.lon);
    const both = d => (d ? `${localHM(d)}` : '—');
    const sub = d => (d ? `${utcHM(d)} UTC` : 'n/a today');
    const phase = alt > 0 ? 'Daytime' : alt > -6 ? 'Gray line now!' : alt > -12 ? 'Nautical twilight' : 'Night';
    $('#sunTimes').innerHTML = [
      tile('Sun at QTH', phase, '', `Elevation ${alt.toFixed(1)}°`),
      tile('Morning gray line', both(t.dawn), '', t.dawn ? `${utcHM(t.dawn)}–${t.sunrise ? utcHM(t.sunrise) : '?'} UTC` : 'n/a today'),
      tile('Sunrise', both(t.sunrise), '', sub(t.sunrise)),
      tile('Sunset', both(t.sunset), '', sub(t.sunset)),
      tile('Evening gray line', both(t.sunset), '', t.sunset ? `${utcHM(t.sunset)}–${t.dusk ? utcHM(t.dusk) : '?'} UTC` : 'n/a today'),
    ].join('');
  }

  function bindMapHover() {
    const canvas = $('#grayline');
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 12;
      for (const d of mapDots) {
        const dd = Math.hypot(d.x - x, d.y - y);
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best) showTip(best.html, e.clientX, e.clientY); else hideTip();
    });
    canvas.addEventListener('mouseleave', hideTip);
  }

  function bindMapTabs() {
    const tabs = [...document.querySelectorAll('#mapTabs [role=tab]')];
    const select = name => {
      for (const t of tabs) {
        const on = t.dataset.map === name;
        t.setAttribute('aria-selected', on);
        const panel = $(`#panel-${t.dataset.map}`);
        panel.hidden = !on;
        const img = panel.querySelector('img[data-src]');
        if (on && img) img.src = `${img.dataset.src}?t=${Math.floor(Date.now() / 600000)}`;
      }
      storeSet('hamdash.map', name);
      if (name === 'grayline') drawGrayline();
    };
    tabs.forEach(t => t.addEventListener('click', () => select(t.dataset.map)));
    const saved = storeGet('hamdash.map');
    if (saved && tabs.some(t => t.dataset.map === saved)) select(saved);
  }

  // ------------------------------------------------------------ SVG helpers

  function svg(tag, attrs = {}, parent) {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (parent) parent.appendChild(n);
    return n;
  }

  // Bar with 4px rounded data end, square at the baseline.
  function barPath(x, y, w, h, r = 4) {
    r = Math.max(0, Math.min(r, w / 2, h));
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  // ------------------------------------------------------------ Kp chart

  function renderKp() {
    const box = $('#kpChart');
    const all = state.solar?.kp || [];
    const from = Date.now() - 4 * 86400000;
    const data = all.filter(k => Date.parse(k.time) >= from);
    box.innerHTML = '';
    if (!data.length) { box.innerHTML = '<div class="empty">Kp data unavailable</div>'; return; }

    const W = Math.max(300, box.clientWidth), H = 210;
    const m = { l: 26, r: 8, t: 10, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Planetary K-index bar chart' }, box);
    const y = v => m.t + ih - (v / 9) * ih;
    const step = iw / data.length;
    const bw = Math.max(1.5, step - 2);

    const ax = svg('g', { class: 'axis' }, s);
    for (const v of [0, 3, 6, 9]) {
      svg('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: y(v), y2: y(v) }, s);
      svg('text', { x: m.l - 6, y: y(v) + 4, 'text-anchor': 'end' }, ax).textContent = v;
    }
    svg('line', { class: 'threshold', x1: m.l, x2: W - m.r, y1: y(5), y2: y(5) }, s);
    svg('text', { class: 'threshold-label', x: W - m.r, y: y(5) - 4, 'text-anchor': 'end' }, s).textContent = 'G1 storm (Kp 5)';

    let lastDay = null;
    data.forEach((k, i) => {
      const t = new Date(k.time);
      const x = m.l + i * step + (step - bw) / 2;
      const st = kpStatus(k.kp);
      const top = y(Math.max(k.kp, 0.15));
      svg('path', {
        d: barPath(x, top, bw, m.t + ih - top, Math.min(4, bw / 2)),
        fill: st.color, 'fill-opacity': k.kind === 'predicted' ? 0.4 : k.kind === 'estimated' ? 0.7 : 1,
      }, s);
      const day = t.getUTCDate();
      if (day !== lastDay && t.getUTCHours() === 0) {
        svg('text', { x: m.l + i * step, y: H - 6, 'text-anchor': 'start' }, ax).textContent = utcDay(t);
        if (i > 0) svg('line', { class: 'gridline', x1: m.l + i * step, x2: m.l + i * step, y1: m.t, y2: m.t + ih }, s);
      }
      lastDay = day;
      const hit = svg('rect', { x: m.l + i * step, y: m.t, width: step, height: ih, fill: 'transparent' }, s);
      hit.addEventListener('mousemove', e => showTip(
        `<b>${utcDay(t)} ${utcHM(t)}–${utcHM(new Date(t.getTime() + 3 * 3600000))} UTC</b>
         ${tipRow('Kp', k.kp.toFixed(2))}${tipRow('Level', esc(st.label))}${tipRow('Type', esc(k.kind))}`, e.clientX, e.clientY));
      hit.addEventListener('mouseleave', hideTip);
    });

    const nowIdx = data.findIndex(k => Date.parse(k.time) > Date.now());
    if (nowIdx > 0) {
      const nx = m.l + nowIdx * step;
      svg('line', { class: 'now-line', x1: nx, x2: nx, y1: m.t, y2: m.t + ih }, s);
      svg('text', { class: 'threshold-label', x: nx + 4, y: m.t + 10 }, s).textContent = 'now';
    }
    svg('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, s);

    $('#kpLegend').innerHTML = `
      <span class="key"><span class="sw" style="background:${css('--good')}"></span>Quiet–unsettled (0–3)</span>
      <span class="key"><span class="sw" style="background:${css('--warning')}"></span>Active (4)</span>
      <span class="key"><span class="sw" style="background:${css('--serious')}"></span>G1–G2 storm (5–6)</span>
      <span class="key"><span class="sw" style="background:${css('--critical')}"></span>G3+ storm (7–9)</span>
      <span class="key"><span class="sw" style="background:${css('--text-2')};opacity:.4"></span>Faded = forecast</span>`;
  }

  // ------------------------------------------------------------ solar cycle chart

  function renderCycle() {
    const box = $('#cycleChart');
    const c = state.cycle;
    box.innerHTML = '';
    if (!c) { box.innerHTML = '<div class="empty">Solar cycle data unavailable</div>'; return; }
    const tOf = s => { const [yy, mm] = s.split('-').map(Number); return Date.UTC(yy, mm - 1, 15); };
    const obs = c.observed.map(d => ({ ...d, x: tOf(d.t) }));
    const pred = c.predicted.map(d => ({ ...d, x: tOf(d.t) }));
    const x0 = obs[0].x, x1 = Math.max(obs[obs.length - 1].x, pred.length ? pred[pred.length - 1].x : 0);
    const ymax = Math.ceil(Math.max(...obs.map(d => d.ssn || 0), ...pred.map(d => d.high || 0)) / 50) * 50;

    const W = Math.max(300, box.clientWidth), H = 210;
    const m = { l: 32, r: 10, t: 10, b: 24 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const X = t => m.l + ((t - x0) / (x1 - x0)) * iw;
    const Y = v => m.t + ih - (v / ymax) * ih;
    const s = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Monthly sunspot number since 2008 with NOAA prediction' }, box);
    const ax = svg('g', { class: 'axis' }, s);
    for (let v = 0; v <= ymax; v += ymax > 200 ? 100 : 50) {
      svg('line', { class: 'gridline', x1: m.l, x2: W - m.r, y1: Y(v), y2: Y(v) }, s);
      svg('text', { x: m.l - 6, y: Y(v) + 4, 'text-anchor': 'end' }, ax).textContent = v;
    }
    const yStep = W < 520 ? 4 : 2;
    for (let yr = 2008; Date.UTC(yr, 0, 1) <= x1; yr += yStep) {
      svg('text', { x: X(Date.UTC(yr, 0, 1)), y: H - 6, 'text-anchor': 'middle' }, ax).textContent = yr;
    }
    const line = (pts, key) => pts.filter(p => p[key] != null).map((p, i) => `${i ? 'L' : 'M'}${X(p.x).toFixed(1)},${Y(p[key]).toFixed(1)}`).join('');

    const band = pred.filter(p => p.high != null && p.low != null);
    if (band.length) {
      const d = band.map((p, i) => `${i ? 'L' : 'M'}${X(p.x)},${Y(p.high)}`).join('') +
        band.slice().reverse().map(p => `L${X(p.x)},${Y(p.low)}`).join('') + 'Z';
      svg('path', { d, fill: css('--series-2'), 'fill-opacity': 0.15 }, s);
    }
    svg('path', { d: line(obs, 'ssn'), fill: 'none', stroke: css('--muted'), 'stroke-width': 1, 'stroke-opacity': 0.8 }, s);
    svg('path', { d: line(obs, 'smoothed'), fill: 'none', stroke: css('--series-1'), 'stroke-width': 2, 'stroke-linejoin': 'round' }, s);
    svg('path', { d: line(pred, 'ssn'), fill: 'none', stroke: css('--series-2'), 'stroke-width': 2, 'stroke-dasharray': '5 4' }, s);
    svg('line', { class: 'baseline', x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih }, s);

    const cross = svg('line', { class: 'crosshair', y1: m.t, y2: m.t + ih, visibility: 'hidden' }, s);
    const dot = svg('circle', { r: 4, fill: css('--series-1'), stroke: css('--card'), 'stroke-width': 2, visibility: 'hidden' }, s);
    const byMonth = new Map();
    for (const p of obs) byMonth.set(p.t, { ...byMonth.get(p.t), obs: p });
    for (const p of pred) byMonth.set(p.t, { ...byMonth.get(p.t), pred: p });
    const months = [...byMonth.keys()].sort();
    const hit = svg('rect', { x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent' }, s);
    hit.addEventListener('mousemove', e => {
      const r = s.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      const t = x0 + ((px - m.l) / iw) * (x1 - x0);
      const d = new Date(t);
      const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
      const k = months.includes(key) ? key : months[months.length - 1];
      const v = byMonth.get(k);
      const cx = X(tOf(k));
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.setAttribute('visibility', 'visible');
      const yv = v.obs?.smoothed ?? v.pred?.ssn ?? v.obs?.ssn;
      if (yv != null) { dot.setAttribute('cx', cx); dot.setAttribute('cy', Y(yv)); dot.setAttribute('visibility', 'visible'); }
      const [yy, mm] = k.split('-');
      showTip(`<b>${MONTHS[+mm - 1]} ${yy}</b>
        ${v.obs?.ssn != null ? tipRow('Monthly SSN', v.obs.ssn.toFixed(0)) : ''}
        ${v.obs?.smoothed != null ? tipRow('Smoothed', v.obs.smoothed.toFixed(0)) : ''}
        ${v.pred?.ssn != null ? tipRow('Predicted', v.pred.ssn.toFixed(0)) : ''}
        ${v.pred?.low != null ? tipRow('Range', `${v.pred.low.toFixed(0)}–${v.pred.high.toFixed(0)}`) : ''}`, e.clientX, e.clientY);
    });
    hit.addEventListener('mouseleave', () => { hideTip(); cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); });

    $('#cycleLegend').innerHTML = `
      <span class="key"><span class="ln" style="border-color:${css('--muted')};border-top-width:1px"></span>Monthly</span>
      <span class="key"><span class="ln" style="border-color:${css('--series-1')}"></span>13-month smoothed</span>
      <span class="key"><span class="ln dash" style="border-color:${css('--series-2')}"></span>NOAA prediction</span>
      <span class="key"><span class="sw" style="background:${css('--series-2')};opacity:.25"></span>Prediction range</span>`;
  }

  // ------------------------------------------------------------ DX spots

  const SPOT_BANDS = ['160m', '80m', '60m', '40m', '30m', '20m', '17m', '15m', '12m', '10m', '6m', '2m'];
  const DIGI = new Set(['FT8', 'FT4', 'RTTY', 'PSK31', 'PSK63', 'JT65', 'JS8', 'SSTV', 'MSK144', 'Q65']);

  function bandName(hz) {
    const k = hz / 1000;
    const ranges = [['160m', 1800, 2000], ['80m', 3500, 4000], ['60m', 5330, 5410], ['40m', 7000, 7300], ['30m', 10100, 10150], ['20m', 14000, 14350], ['17m', 18068, 18168], ['15m', 21000, 21450], ['12m', 24890, 24990], ['10m', 28000, 29700], ['6m', 50000, 54000], ['2m', 144000, 148000]];
    return (ranges.find(([, lo, hi]) => k >= lo && k <= hi) || [null])[0];
  }

  function renderSpots() {
    const d = state.spots;
    const status = $('#spotsStatus');
    $('#clusterHost').textContent = d?.host || '';
    if (!d) { status.textContent = ''; return; }
    const STATUS = { connected: `Live · ${d.host}`, connecting: 'Connecting…', reconnecting: 'Reconnecting…', disabled: 'Disabled in add-on options', 'no-callsign': 'Set a callsign in the add-on options to connect' };
    status.textContent = STATUS[d.status] || d.status;

    const mode = $('#modeFilter').value, cont = $('#contFilter').value;
    const recent = Date.now() - 30 * 60000;
    const counts = {};
    for (const s of d.spots) if (Date.parse(s.time) >= recent && s.band) counts[s.band] = (counts[s.band] || 0) + 1;
    $('#bandChips').innerHTML = [['', 'All bands'], ...SPOT_BANDS.map(b => [b, b])].map(([v, label]) =>
      `<button type="button" class="chip" data-band="${v}" aria-pressed="${state.bandFilter === v}">${label}${v && counts[v] ? `<span class="n">${counts[v]}</span>` : ''}</button>`).join('');

    const rows = d.spots.filter(s =>
      (!state.bandFilter || s.band === state.bandFilter) &&
      (!mode || (mode === 'DIGI' ? DIGI.has(s.mode) : s.mode === mode)) &&
      (!cont || s.spotterConts.includes(cont))).slice(0, 150);

    if (!rows.length) {
      $('#spotsTable').innerHTML = `<tbody><tr><td class="empty">${d.status === 'connected' ? 'No spots match these filters yet.' : 'No spots yet.'}</td></tr></tbody>`;
      return;
    }
    const fresh = Date.now() - 2 * 60000;
    $('#spotsTable').innerHTML = `<thead><tr><th>UTC</th><th class="num">kHz</th><th>DX</th><th>Mode</th><th>Spotter</th><th>Comment</th></tr></thead><tbody>${
      rows.map(s => `<tr class="${Date.parse(s.time) > fresh ? 'fresh' : ''}">
        <td class="mono">${utcHM(new Date(s.time))}</td>
        <td class="mono num">${s.freq.toFixed(1)}</td>
        <td class="mono call" title="${esc(s.dxCont || '')}">${esc(s.dx)}</td>
        <td><span class="tag">${esc(s.mode)}</span></td>
        <td class="mono">${esc(s.spotter)}${s.count > 1 ? `<span class="count">+${s.count - 1}</span>` : ''}</td>
        <td class="comment">${esc(s.comment)}</td></tr>`).join('')
    }</tbody>`;
  }

  // ------------------------------------------------------------ PSKReporter

  function renderPsk(errorMsg) {
    const st = station();
    const sum = $('#pskSummary'), table = $('#pskTable');
    if (!st.callsign) {
      sum.innerHTML = '';
      table.innerHTML = '<tbody><tr><td class="empty">Set your callsign (top right) to see who is hearing you.</td></tr></tbody>';
      return;
    }
    if (errorMsg) { sum.innerHTML = ''; table.innerHTML = `<tbody><tr><td class="empty">PSKReporter unavailable: ${esc(errorMsg)}</td></tr></tbody>`; return; }
    const p = state.psk;
    if (!p) { table.innerHTML = '<tbody><tr><td class="empty">Loading…</td></tr></tbody>'; return; }
    const me = gridToLatLon(st.grid);
    const reports = p.reports.map(r => {
      const rx = gridToLatLon(r.rxGrid), tx = me || gridToLatLon(r.txGrid);
      return { ...r, band: bandName(r.freq), dist: rx && tx ? distanceKm(tx, rx) : null };
    });
    if (!reports.length) {
      sum.innerHTML = '';
      table.innerHTML = `<tbody><tr><td class="empty">No reception reports for ${esc(p.call)} in this window. Call CQ on FT8 and check back in a few minutes.</td></tr></tbody>`;
      return;
    }
    const uniq = new Set(reports.map(r => r.rx)).size;
    const far = reports.reduce((a, b) => ((b.dist ?? -1) > (a.dist ?? -1) ? b : a));
    const best = reports.reduce((a, b) => ((b.snr ?? -99) > (a.snr ?? -99) ? b : a));
    const byBand = {};
    for (const r of reports) if (r.band) byBand[r.band] = (byBand[r.band] || 0) + 1;
    sum.innerHTML = [
      tile('Reports', reports.length, '', `${uniq} stations`),
      tile('Farthest', far.dist != null ? fmtDist(far.dist) : null, '', far.rx),
      tile('Best SNR', best.snr, 'dB', best.rx),
    ].join('') + `<div class="psk-bands">${SPOT_BANDS.filter(b => byBand[b]).map(b => `<span class="tag">${b} · ${byBand[b]}</span>`).join('')}</div>`;
    table.innerHTML = `<thead><tr><th>UTC</th><th>Heard by</th><th>Band</th><th>Mode</th><th class="num">SNR</th><th class="num">Distance</th></tr></thead><tbody>${
      reports.slice(0, 200).map(r => `<tr>
        <td class="mono">${utcHM(new Date(r.time * 1000))}</td>
        <td class="mono call" title="${esc(r.rxCountry || '')} ${esc(r.rxGrid || '')}">${esc(r.rx)}</td>
        <td>${esc(r.band || '—')}</td><td><span class="tag">${esc(r.mode)}</span></td>
        <td class="mono num">${r.snr ?? '—'}</td><td class="mono num">${fmtDist(r.dist)}</td></tr>`).join('')
    }</tbody>`;
  }

  // ------------------------------------------------------------ alerts

  function renderAlerts() {
    const al = state.solar?.alerts;
    const box = $('#alerts');
    if (!al) { box.innerHTML = '<div class="empty">Alerts unavailable</div>'; }
    else if (!al.length) { box.innerHTML = '<div class="empty">No alerts in the last 72 hours.</div>'; }
    else {
      box.innerHTML = al.map(a => {
        const kind = (a.title.match(/^(CONTINUED ALERT|EXTENDED WARNING|ALERT|WARNING|WATCH|SUMMARY|CANCEL\w*)/) || ['', 'NOTICE'])[1];
        const cls = /WARNING|ALERT/.test(kind) ? 'fair' : /WATCH/.test(kind) ? 'serious' : 'none';
        const t = new Date(a.time);
        return `<details><summary><span class="t">${utcDay(t)} ${utcHM(t)} UTC</span>${pill(cls, kind)}<span>${esc(a.title.replace(/^[^:]+:\s*/, ''))}</span></summary><pre>${esc(a.message)}</pre></details>`;
      }).join('');
    }
    $('#forecastText').textContent = state.solar?.forecast || 'Unavailable';
  }

  // ------------------------------------------------------------ settings dialog

  function openSettings() {
    const s = state.settings, d = state.defaults;
    $('#setCall').value = s.callsign || '';
    $('#setCall').placeholder = d.callsign ? `Add-on default: ${d.callsign}` : 'e.g. KR4FCD';
    $('#setGrid').value = s.grid || '';
    $('#setGrid').placeholder = d.grid ? `Add-on default: ${d.grid}` : 'e.g. DM14xd';
    $('#setUnits').value = s.units || '';
    $('#settingsError').hidden = true;
    $('#settings').showModal();
  }

  function bindSettings() {
    $('#stationBtn').addEventListener('click', openSettings);
    $('#cancelSettings').addEventListener('click', () => $('#settings').close());
    $('#resetSettings').addEventListener('click', () => {
      state.settings = {};
      storeSet('hamdash.settings', null);
      $('#settings').close();
      stationChanged();
    });
    $('#locateBtn').addEventListener('click', () => {
      const err = $('#settingsError');
      if (!navigator.geolocation) { err.textContent = 'Location is not available in this browser.'; err.hidden = false; return; }
      navigator.geolocation.getCurrentPosition(
        p => { $('#setGrid').value = latLonToGrid(p.coords.latitude, p.coords.longitude); err.hidden = true; },
        e => { err.textContent = `Couldn't get your location (${e.message}). Enter the grid manually.`; err.hidden = false; },
        { timeout: 10000 });
    });
    $('#settingsForm').addEventListener('submit', e => {
      const call = $('#setCall').value.trim().toUpperCase();
      const grid = $('#setGrid').value.trim();
      const err = $('#settingsError');
      if (call && !/^[A-Z0-9/]{3,15}$/.test(call)) { e.preventDefault(); err.textContent = 'That callsign doesn’t look right.'; err.hidden = false; return; }
      if (grid && !/^[A-R]{2}\d{2}([A-X]{2})?$/i.test(grid)) { e.preventDefault(); err.textContent = 'Grid must be 4 or 6 characters, like DM14 or DM14xd.'; err.hidden = false; return; }
      const g = grid.length === 6 ? grid.slice(0, 4).toUpperCase() + grid.slice(4).toLowerCase() : grid.toUpperCase();
      state.settings = { callsign: call, grid: g, units: $('#setUnits').value };
      storeSet('hamdash.settings', JSON.stringify(state.settings));
      stationChanged();
    });
  }

  function stationChanged() {
    renderHeader();
    renderBands();
    drawGrayline();
    state.psk = null;
    renderPsk();
    loadPsk();
  }

  // ------------------------------------------------------------ loaders

  async function loadSolar() {
    try {
      state.solar = await api('api/solar');
      renderTiles(); renderScales(); renderBands(); renderKp(); renderAlerts();
    } catch (e) { console.warn(e); }
  }
  async function loadIono() {
    try { state.iono = await api('api/ionosondes'); renderBands(); drawGrayline(); } catch (e) { console.warn(e); }
  }
  async function loadSpots() {
    try { state.spots = await api('api/spots'); renderSpots(); } catch (e) { console.warn(e); }
  }
  async function loadPsk() {
    const call = station().callsign;
    if (!call) { renderPsk(); return; }
    try {
      state.psk = await api(`api/psk?call=${encodeURIComponent(call)}&minutes=${$('#pskWindow').value}`);
      renderPsk(); drawGrayline();
    } catch (e) { renderPsk(e.message); }
  }
  async function loadCycle() {
    try { state.cycle = await api('api/cycle'); renderCycle(); } catch (e) { console.warn(e); renderCycle(); }
  }
  async function loadLand() {
    try { state.land = decodeLand(await api('land-110m.json')); drawGrayline(); } catch (e) { console.warn(e); }
  }

  // ------------------------------------------------------------ boot

  async function init() {
    tickClocks();
    setInterval(tickClocks, 1000);
    bindSettings();
    bindMapTabs();
    bindMapHover();

    $('#bandChips').addEventListener('click', e => {
      const b = e.target.closest('[data-band]');
      if (!b) return;
      state.bandFilter = b.dataset.band;
      storeSet('hamdash.band', state.bandFilter || null);
      renderSpots();
    });
    for (const id of ['modeFilter', 'contFilter']) {
      const sel = $(`#${id}`);
      sel.value = storeGet(`hamdash.${id}`) || '';
      sel.addEventListener('change', () => { storeSet(`hamdash.${id}`, sel.value || null); renderSpots(); });
    }
    const win = $('#pskWindow');
    win.value = storeGet('hamdash.pskWindow') || '60';
    win.addEventListener('change', () => { storeSet('hamdash.pskWindow', win.value); state.psk = null; renderPsk(); loadPsk(); });

    try {
      const cfg = await api('api/config');
      state.defaults = { callsign: cfg.callsign || '', grid: cfg.grid || '', distance_units: cfg.distance_units || 'mi' };
    } catch (e) { console.warn(e); }
    renderHeader();
    renderPsk();
    if (!station().callsign && !station().grid) openSettings();

    loadLand(); loadSolar(); loadIono(); loadSpots(); loadPsk(); loadCycle();
    setInterval(loadSolar, 5 * 60000);
    setInterval(loadIono, 10 * 60000);
    setInterval(loadSpots, 30000);
    setInterval(loadPsk, 5 * 60000);
    setInterval(loadCycle, 12 * 3600000);
    setInterval(() => { if (!$('#panel-grayline').hidden) drawGrayline(); renderBands(); }, 60000);

    let rt;
    new ResizeObserver(() => {
      clearTimeout(rt);
      rt = setTimeout(() => { drawGrayline(); renderKp(); renderCycle(); }, 150);
    }).observe($('.grid'));
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      drawGrayline(); renderKp(); renderCycle(); renderScales(); renderTiles();
    });
  }

  init();
})();
