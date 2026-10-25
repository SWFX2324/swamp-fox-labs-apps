'use strict';
// Ham Radio Dashboard front end. All API paths are relative so the page works
// behind Home Assistant ingress (/api/hassio_ingress/<token>/).

(() => {
  const $ = sel => document.querySelector(sel);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const SVGNS = 'http://www.w3.org/2000/svg';

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

  const {
    RAD, gridToLatLon, latLonToGrid, distanceKm, bearingDeg, compass,
    sunPosition, sunAltitude, sunTimes, HF_BANDS, RATING, rateBand,
  } = HamCore;
  const nearestIonosonde = pos => HamCore.nearestIonosonde(pos, state.iono);

  function fmtDist(km) {
    if (km == null) return '—';
    const mi = station().units === 'mi';
    return `${Math.round(mi ? km * 0.621371 : km).toLocaleString()} ${mi ? 'mi' : 'km'}`;
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

  function activityCell(a) {
    if (!a) return '<span class="meta">—</span>';
    if (!a.stations) return '<span class="meta">0</span>';
    const title = a.farthest ? `Farthest: ${a.farthest.call} (${a.farthest.country || a.farthest.grid}), ${fmtDist(a.farthest.km)}` : '';
    return `<span class="mono" title="${esc(title)}">${a.stations}</span><div class="sub">${a.dx ? `${a.dx} DX` : 'local'}${a.farthest ? ` · ${fmtDist(a.farthest.km)}` : ''}</div>`;
  }

  function renderBands() {
    const h = state.solar?.hamqsl;
    const pos = gridToLatLon(station().grid);
    const sunAlt = pos ? sunAltitude(sunPosition(new Date()), pos.lat, pos.lon) : null;
    const isDay = sunAlt == null ? new Date().getUTCHours() >= 12 && new Date().getUTCHours() < 24 : sunAlt > -0.833;
    const iono = nearestIonosonde(pos);
    const kp = currentKp();
    const groups = Object.fromEntries((h?.bands || []).map(b => [b.name, b]));

    const act = state.activity;
    const head = `<thead><tr><th>Band</th><th class="freq">MHz</th>
      <th>At your QTH now<small>${iono ? `MUF ${iono.mufd.toFixed(1)} MHz` : pos ? 'no nearby ionosonde' : 'set grid'}</small></th>
      <th class="num">Heard nearby<small>last ${act?.windowMin ?? 15} min</small></th>
      <th class="${isDay ? 'now' : 'hide-sm'}">HamQSL day${isDay ? '<small>now</small>' : '<small>&nbsp;</small>'}</th>
      <th class="${!isDay ? 'now' : 'hide-sm'}">HamQSL night${!isDay ? '<small>now</small>' : '<small>&nbsp;</small>'}</th></tr></thead>`;
    const body = HF_BANDS.map(([name, mhz, group]) => {
      const g = groups[group];
      const r = iono ? rateBand(mhz, iono.mufd, sunAlt ?? 0, kp ?? 0) : null;
      const why = iono ? `${mhz} MHz vs MUF ${iono.mufd.toFixed(1)} MHz${name === '6m' && r === 'closed' ? ' (sporadic-E can still open 6m)' : ''}` : '';
      return `<tr><td class="band">${name}</td><td class="freq">${mhz}</td>
        <td>${ratingPill(r, why)}</td>
        <td class="num">${activityCell(act?.bands?.[name])}</td>
        <td class="${isDay ? '' : 'dim hide-sm'}">${g ? hamqslPill(g.day) : '<span class="meta">—</span>'}</td>
        <td class="${!isDay ? '' : 'dim hide-sm'}">${g ? hamqslPill(g.night) : '<span class="meta">—</span>'}</td></tr>`;
    }).join('');
    $('#bandsTable').innerHTML = head + `<tbody>${body}</tbody>`;
    $('#bandsMeta').textContent = sunAlt == null ? '' : `Sun ${sunAlt >= 0 ? 'up' : 'down'} at QTH (${sunAlt.toFixed(0)}°)`;

    let note = 'HamQSL ratings are N0NBH’s global estimates for band pairs. ';
    if (iono) {
      note += `“At your QTH” is an estimate from the ${iono.name} ionosonde (${fmtDist(iono.dist)} away, measured ${ago(iono.time)}), with daytime absorption and the current Kp of ${kp ?? '?'} factored in. `;
    } else if (pos) {
      note += 'No ionosonde within 3000 km has reported in the last 3 hours, so the local estimate is unavailable. ';
    } else {
      note += 'Set your grid square for a local estimate. ';
    }
    if (act) {
      note += `“Heard nearby” is measured: distinct stations that PSKReporter monitors within ${fmtDist(act.radiusKm)} of you decoded in the last ${act.windowMin} minutes (mostly FT8/FT4), with how many were DX (over ${fmtDist(act.dxKm)} away). Zero can also mean nobody nearby is listening on that band.`;
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

  const canvasDots = new WeakMap();

  // Size a canvas to its CSS box at device resolution; returns a 2D context.
  function fitCanvas(canvas, w, h) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  }

  // Equirectangular world map with land, live night/gray-line shading and the
  // subsolar point. `overlay(ctx, X, Y, dots)` draws extra markers and pushes
  // hover targets ({x, y, html}) into `dots`.
  function drawWorld(canvas, overlay) {
    const w = canvas.clientWidth;
    if (!w) return null;
    const h = w / 2;
    const ctx = fitCanvas(canvas, w, h);
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
    const sun = sunPosition(new Date());
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

    const dots = [];
    const sx = X(sun.lon), sy = Y(sun.lat);
    ctx.fillStyle = '#fab219';
    ctx.strokeStyle = '#8a5a00';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(sx, sy, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
    dots.push({ x: sx, y: sy, html: `<b>Sun overhead</b>${tipRow('Lat', sun.lat.toFixed(1) + '°')}${tipRow('Lon', sun.lon.toFixed(1) + '°')}` });

    overlay?.(ctx, X, Y, dots);
    canvasDots.set(canvas, dots);
    return { sun, night: [nr, ng, nb] };
  }

  // Ringed dot marking the operator's QTH.
  function drawQth(ctx, x, y) {
    ctx.strokeStyle = css('--card');
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.strokeStyle = css('--text');
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.stroke();
    ctx.fillStyle = css('--text');
    ctx.beginPath(); ctx.arc(x, y, 2.5, 0, 2 * Math.PI); ctx.fill();
  }

  const legendKey = (swatch, label) => `<span><span class="sw" style="${swatch}"></span>${esc(label)}</span>`;
  const nightLegend = night => legendKey(`background:rgb(${night.join(' ')} / .6)`, 'Night') +
    legendKey('background:rgb(214 160 60 / .55)', 'Gray line (civil twilight)') +
    legendKey('background:#fab219;border-radius:50%', 'Sun overhead');

  function drawGrayline() {
    const st = station();
    const pos = gridToLatLon(st.grid);
    const reports = state.psk?.reports || [];
    const iono = nearestIonosonde(pos);

    const res = drawWorld($('#grayline'), (ctx, X, Y, dots) => {
      // PSKReporter receivers.
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
        dots.push({ x, y, html: `<b class="mono">${esc(r.rx)}</b><br>${esc(r.rxCountry || '')}${tipRow('Band', bandName(r.freq) || '—')}${tipRow('Mode', esc(r.mode))}${tipRow('SNR', `${r.snr ?? '—'} dB`)}${pos ? tipRow('Distance', fmtDist(distanceKm(pos, p))) : ''}` });
      }

      // Ionosonde used for the band estimate.
      if (iono) {
        const x = X(iono.lon), y = Y(iono.lat);
        ctx.fillStyle = css('--series-1');
        ctx.strokeStyle = css('--card');
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 5.5, y + 4); ctx.lineTo(x - 5.5, y + 4); ctx.closePath(); ctx.fill(); ctx.stroke();
        dots.push({ x, y, html: `<b>${esc(iono.name)}</b> ionosonde${tipRow('MUF(3000)', `${iono.mufd.toFixed(1)} MHz`)}${tipRow('foF2', `${iono.fof2?.toFixed(1) ?? '—'} MHz`)}${tipRow('Measured', ago(iono.time))}` });
      }

      if (pos) {
        drawQth(ctx, X(pos.lon), Y(pos.lat));
        dots.push({ x: X(pos.lon), y: Y(pos.lat), html: `<b class="mono">${esc(st.callsign || 'Your QTH')}</b>${tipRow('Grid', esc(st.grid))}` });
      }
    });
    if (!res) return;

    $('#graylineLegend').innerHTML = nightLegend(res.night) +
      (pos ? legendKey(`border:2px solid ${css('--text')};border-radius:50%`, 'Your QTH') : '') +
      (iono ? legendKey(`background:${css('--series-1')};clip-path:polygon(50% 0,100% 100%,0 100%)`, 'Ionosonde used') : '') +
      (reports.length ? legendKey(`background:${css('--series-2')};border-radius:50%`, 'Stations hearing you (PSKReporter)') : '');

    renderSunTimes(pos, res.sun);
  }

  function renderSunTimes(pos, sun) {
    if (!pos) { $('#sunTimes').innerHTML = '<div class="empty">Set your grid square to see sunrise, sunset and gray line times.</div>'; return; }
    const t = sunTimes(pos);
    const alt = sunAltitude(sun, pos.lat, pos.lon);
    const both = d => (d ? `${localHM(d)}` : '—');
    const sub = d => (d ? `${utcHM(d)} UTC` : 'n/a today');
    $('#sunTimes').innerHTML = [
      tile('Sun at QTH', sunPhase(alt), '', `Elevation ${alt.toFixed(1)}°`),
      tile('Morning gray line', both(t.dawn), '', t.dawn ? `${utcHM(t.dawn)}–${t.sunrise ? utcHM(t.sunrise) : '?'} UTC` : 'n/a today'),
      tile('Sunrise', both(t.sunrise), '', sub(t.sunrise)),
      tile('Sunset', both(t.sunset), '', sub(t.sunset)),
      tile('Evening gray line', both(t.sunset), '', t.sunset ? `${utcHM(t.sunset)}–${t.dusk ? utcHM(t.dusk) : '?'} UTC` : 'n/a today'),
    ].join('');
  }

  const sunPhase = alt => (alt > 0 ? 'Daytime' : alt > -6 ? 'Gray line now!' : alt > -12 ? 'Nautical twilight' : 'Night');

  // Tooltips for canvas markers: the nearest registered dot within 12px.
  function bindCanvasHover(canvas) {
    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 12;
      for (const d of canvasDots.get(canvas) || []) {
        const dd = Math.hypot(d.x - x, d.y - y);
        if (dd < bd) { bd = dd; best = d; }
      }
      if (best) showTip(best.html, e.clientX, e.clientY); else hideTip();
      canvas.style.cursor = best?.onClick ? 'pointer' : '';
      canvas._hoverDot = best;
    });
    canvas.addEventListener('click', () => canvas._hoverDot?.onClick?.());
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

  const watched = call => (state.defaults.spot_watch || []).some(w => call === w || call.startsWith(w));

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
      rows.map(s => `<tr class="${Date.parse(s.time) > fresh ? 'fresh' : ''}${watched(s.dx) ? ' watched' : ''}" title="${watched(s.dx) ? 'On your watch list' : ''}">
        <td class="mono">${utcHM(new Date(s.time))}</td>
        <td class="mono num">${s.freq.toFixed(1)}</td>
        <td class="call" title="${esc(s.dxCont || '')}">${callLink(s.dx)}</td>
        <td><span class="tag">${esc(s.mode)}</span></td>
        <td>${callLink(s.spotter)}${s.count > 1 ? `<span class="count">+${s.count - 1}</span>` : ''}</td>
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
        <td class="call" title="${esc(r.rxCountry || '')} ${esc(r.rxGrid || '')}">${callLink(r.rx)}</td>
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

  // ------------------------------------------------------------ storm safety

  const STORM_LEVEL = {
    safe: { cls: 'good', label: 'Safe', icon: '✓', text: 'No lightning or storm warnings for your station.' },
    caution: { cls: 'fair', label: 'Caution', icon: '!', text: 'Storms possible. Be ready to disconnect antennas.' },
    danger: { cls: 'poor', label: 'Danger', icon: '⚡', text: 'Disconnect and ground your antennas now.' },
  };

  async function loadStorm() {
    try { state.storm = await api('api/storm'); } catch (e) { console.warn(e); }
    renderStorm();
  }

  function renderStorm() {
    const s = state.storm;
    if (!s) return;
    const lv = STORM_LEVEL[s.level] || STORM_LEVEL.safe;

    const banner = $('#stormBanner');
    banner.hidden = s.level !== 'danger';
    if (s.level === 'danger') banner.innerHTML = `<b>⚡ Lightning danger:</b> ${esc(s.reasons.join(' · '))}. ${esc(lv.text)}`;

    $('#stormMeta').textContent = `Checked ${ago(s.updated)}`;
    $('#stormStatus').innerHTML = `
      <div class="storm-level s-${lv.cls}"><span class="storm-icon" aria-hidden="true">${lv.icon}</span>${esc(lv.label)}</div>
      <p class="storm-text">${esc(s.reasons.length ? s.reasons.join(' · ') : lv.text)}</p>
      ${s.reasons.length ? `<p class="note">${esc(lv.text)}</p>` : ''}`;

    const sen = s.sensor;
    $('#stormSensor').innerHTML = !sen
      ? `<div class="tile"><span class="label">Lightning sensor</span><span class="value small">Not set up</span>
          <span class="sub wrap">Add an Ecowitt WH57, Ambient Weather or ESPHome AS3935 sensor to Home Assistant, then put its entity ID in the add-on’s <b>Lightning sensor entity</b> option to get strike distances.</span></div>`
      : sen.error
        ? `<div class="tile"><span class="label">Lightning sensor</span><span class="value small">Unavailable</span><span class="sub wrap">${esc(sen.entity)}: ${esc(sen.error)}</span></div>`
        : `<div class="tile"><span class="label">Last strike · ${esc(sen.name)}</span>
            <span class="value">${sen.distance ?? '—'}<span class="unit">${esc(s.units)}</span></span>
            <span class="sub">${sen.lastStrike ? `${ago(sen.lastStrike)}${sen.recent ? '' : ' (older than 30 min)'}` : 'No strikes yet'} · alert inside ${s.alertDistance} ${esc(s.units)}</span></div>`;

    const hours = s.nws?.hourly || [];
    $('#stormForecast').innerHTML = !s.nws
      ? `<div class="tile"><span class="label">NWS forecast</span><span class="value small">Off</span><span class="sub wrap">Turn on NWS weather alerts in the add-on options (US only).</span></div>`
      : !hours.length
        ? `<div class="tile"><span class="label">NWS forecast</span><span class="value small">Unavailable</span><span class="sub wrap">The National Weather Service only covers the US.</span></div>`
        : `<div class="tile"><span class="label">Next 12 hours · thunder ${hours.some(h => /thunder/i.test(h.forecast)) ? 'in forecast' : 'not expected'}</span>
            <div class="hour-strip">${hours.map(h => {
              const t = /thunder/i.test(h.forecast);
              return `<span class="hour${t ? ' thunder' : ''}" title="${esc(h.forecast)}${h.pop != null ? ` · ${h.pop}% rain` : ''}">${esc(new Date(h.start).toLocaleTimeString([], { hour: 'numeric' }))}${t ? ' ⚡' : ''}</span>`;
            }).join('')}</div></div>`;

    const alerts = s.nws?.alerts || [];
    $('#nwsAlerts').innerHTML = !s.nws ? ''
      : !s.nws.available ? '<p class="note">NWS alerts are unavailable right now.</p>'
        : !alerts.length ? '<p class="note">No active National Weather Service alerts for your location.</p>'
          : alerts.map(a => `<details><summary>${pill(a.storm === 'danger' ? 'poor' : a.storm === 'caution' ? 'fair' : 'none', a.event)}<span>${esc(a.headline)}</span></summary>
              <pre>${esc([a.description, a.instruction].filter(Boolean).join('\n\n'))}</pre></details>`).join('');
  }

  // ------------------------------------------------------------ views

  const VIEWS = ['weather', 'repeaters', 'aprs', 'pota', 'sats', 'lookup'];
  let currentView = 'weather';

  function showView(name) {
    if (!VIEWS.includes(name)) name = 'weather';
    currentView = name;
    for (const v of VIEWS) $(`#view-${v}`).hidden = v !== name;
    for (const b of document.querySelectorAll('#viewTabs [data-view]')) b.setAttribute('aria-selected', b.dataset.view === name);
    // On phones the tab row scrolls sideways; keep the active tab visible.
    const tab = $(`#viewTabs [data-view="${name}"]`), row = $('#viewTabs');
    if (row.scrollWidth > row.clientWidth) row.scrollLeft = tab.offsetLeft - (row.clientWidth - tab.offsetWidth) / 2;
    storeSet('hamdash.view', name);
    if (location.hash.slice(1) !== name) history.replaceState(null, '', `#${name}`);
    hideTip();
    redrawVisible();
    if (name === 'repeaters') loadRepeaters();
    if (name === 'lookup') renderLookup();
    // Poll live data only while its tab is open.
    for (const v of [aprs, pota, sats]) clearInterval(v.timer);
    if (name === 'aprs') { loadAprs(); aprs.timer = setInterval(loadAprs, 15000); }
    if (name === 'pota') { loadPota(); pota.timer = setInterval(loadPota, 60000); }
    if (name === 'sats') { loadSats(); sats.timer = setInterval(loadSats, 30000); }
  }

  // Canvases and charts can only be sized while their view is visible.
  function redrawVisible() {
    if (currentView === 'weather') {
      if (!$('#panel-grayline').hidden) drawGrayline();
      renderKp(); renderCycle();
    } else if (currentView === 'repeaters') {
      drawRepeaterMap();
    } else if (currentView === 'aprs') {
      drawAprsMap();
    } else if (currentView === 'pota') {
      drawPotaMap();
    } else if (currentView === 'sats') {
      renderSats();
    } else {
      drawLookupMap();
    }
  }

  const callLink = c => `<button type="button" class="call-link mono" data-call="${esc(c)}" title="Look up ${esc(c)}">${esc(c)}</button>`;

  // Background, four range rings labelled in the user's units, and N/E/S/W,
  // centred in a w×h canvas with outer ring radius R.
  function drawRangeRings(ctx, w, h, R, radius) {
    const cx = w / 2, cy = h / 2, units = station().units;
    ctx.fillStyle = css('--card-2');
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = css('--grid-line');
    ctx.lineWidth = 1;
    ctx.fillStyle = css('--muted');
    ctx.font = '11px system-ui, sans-serif';
    for (let i = 1; i <= 4; i++) {
      ctx.beginPath(); ctx.arc(cx, cy, (R * i) / 4, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillText(`${+((radius * i) / 4).toFixed(1)} ${units}`, cx + 4, cy - (R * i) / 4 + 12);
    }
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [t, x, y] of [['N', cx, cy - R - 12], ['S', cx, cy + R + 12], ['E', cx + R + 12, cy], ['W', cx - R - 12, cy]]) ctx.fillText(t, x, y);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  // ------------------------------------------------------------ repeaters

  const RPT_BANDS = [['10m', 28, 29.7], ['6m', 50, 54], ['2m', 144, 148], ['1.25m', 219, 225], ['70cm', 420, 450], ['33cm', 902, 928], ['23cm', 1240, 1300]];
  const rptBand = hz => (RPT_BANDS.find(([, lo, hi]) => hz / 1e6 >= lo && hz / 1e6 <= hi) || ['Other'])[0];
  const RADII = { mi: [10, 25, 50, 75, 100, 150], km: [15, 40, 80, 120, 160, 240] };
  const fmtMHz = hz => (hz / 1e6).toFixed(hz % 1000 ? 4 : 3);

  const rpt = { data: null, pos: null, key: '', band: storeGet('hamdash.rptBand') || '', highlight: null, error: null };

  const rptRadiusKm = () => +$('#rptRadius').value * (station().units === 'mi' ? 1.609344 : 1);

  function fillRadiusOptions() {
    const units = station().units;
    const saved = +storeGet(`hamdash.rptRadius.${units}`) || (units === 'mi' ? 50 : 80);
    $('#rptRadius').innerHTML = RADII[units].map(r => `<option value="${r}"${r === saved ? ' selected' : ''}>${r} ${units}</option>`).join('');
  }

  async function loadRepeaters() {
    const pos = gridToLatLon(station().grid);
    $('#rptGrid').textContent = station().grid || 'you';
    if (!pos) {
      rpt.data = null;
      rpt.error = 'Set your grid square (top right) to find nearby repeaters.';
      renderRepeaters();
      return;
    }
    const radius = rptRadiusKm();
    const key = `${pos.lat.toFixed(3)},${pos.lon.toFixed(3)},${radius}`;
    if (key === rpt.key && rpt.data) { renderRepeaters(); return; }
    rpt.key = key;
    rpt.error = null;
    if (!rpt.data) $('#rptTable').innerHTML = '<tbody><tr><td class="empty">Loading repeaters… The first load downloads the HearHam directory and can take a few seconds.</td></tr></tbody>';
    try {
      const d = await api(`api/repeaters?lat=${pos.lat.toFixed(4)}&lon=${pos.lon.toFixed(4)}&radius=${radius.toFixed(1)}`);
      if (rpt.key !== key) return; // a newer request superseded this one
      rpt.data = d;
      rpt.pos = pos;
    } catch (e) {
      rpt.data = null;
      rpt.key = '';
      rpt.error = `Couldn't load repeaters: ${e.message}`;
    }
    renderRepeaters();
  }

  function filteredRepeaters() {
    if (!rpt.data) return [];
    const mode = $('#rptMode').value, onAir = $('#rptOnAir').checked;
    const q = $('#rptSearch').value.trim().toUpperCase();
    return rpt.data.repeaters.filter(r =>
      (!rpt.band || rptBand(r.freq) === rpt.band) &&
      (!mode || r.mode.split('/').includes(mode)) &&
      (!onAir || r.operational) &&
      (!q || r.call.includes(q) || r.city.toUpperCase().includes(q)));
  }

  function toneText(r) {
    if (r.mode.includes('DMR') && r.encode && +r.encode < 16) return `CC${r.encode}`;
    if (!r.encode && !r.decode) return 'none';
    if (r.decode && r.decode !== r.encode) return `${r.encode || 'none'} / ${r.decode}`;
    return r.encode;
  }

  const offsetText = r => (r.offset === 0 ? 'simplex' : `${r.offset > 0 ? '+' : '−'}${+(Math.abs(r.offset) / 1e6).toFixed(4)}`);

  function renderRepeaters() {
    const d = rpt.data;
    const counts = {};
    for (const r of d?.repeaters || []) { const b = rptBand(r.freq); counts[b] = (counts[b] || 0) + 1; }
    const bands = [...RPT_BANDS.map(b => b[0]), 'Other'].filter(b => counts[b] || b === rpt.band);
    $('#rptBandChips').innerHTML = [['', 'All bands'], ...bands.map(b => [b, b])].map(([v, label]) =>
      `<button type="button" class="chip" data-band="${v}" aria-pressed="${rpt.band === v}">${label}${v && counts[v] ? `<span class="n">${counts[v]}</span>` : ''}</button>`).join('');

    if (rpt.error || !d) {
      $('#rptMeta').textContent = '';
      $('#rptSource').textContent = '';
      if (rpt.error) $('#rptTable').innerHTML = `<tbody><tr><td class="empty">${esc(rpt.error)}</td></tr></tbody>`;
      drawRepeaterMap();
      return;
    }

    const rows = filteredRepeaters();
    const units = station().units;
    $('#rptMeta').textContent = `${rows.length} of ${d.total} within ${$('#rptRadius').value} ${units}` +
      (d.total > d.repeaters.length ? ` (closest ${d.repeaters.length} loaded)` : '');
    $('#rptSource').textContent = `Directory downloaded from HearHam ${ago(d.fetched)}.`;

    $('#rptTable').innerHTML = rows.length ? `<thead><tr><th class="num">Output</th><th>Offset</th><th>Tone</th><th>Mode</th><th>Repeater</th><th class="num hide-sm">Distance</th><th class="hide-sm">Status</th><th class="hide-sm">Details</th></tr></thead><tbody>${
      rows.map(r => {
        const status = !r.operational ? pill('closed', 'Off air')
          : r.restriction ? pill('fair', r.restriction.toLowerCase().includes('closed') ? 'Closed access' : r.restriction)
            : pill('good', 'On air');
        const net = r.node ? `${r.group || 'Node'} ${r.node}` : r.group;
        return `<tr data-id="${r.id}" class="${r.operational ? '' : 'off'}">
          <td class="mono num freq-out">${fmtMHz(r.freq)}</td>
          <td class="mono" title="Input ${fmtMHz(r.freq + r.offset)} MHz">${offsetText(r)}</td>
          <td class="mono">${esc(toneText(r))}</td>
          <td><span class="tag">${esc(r.mode)}</span>${net ? `<div class="sub net">${esc(net)}</div>` : ''}</td>
          <td>${callLink(r.call)}<div class="sub" title="${esc(r.description)}"><span class="show-sm">${fmtDist(r.dist)} ${compass(r.bearing)} · </span>${esc(r.city)}</div></td>
          <td class="mono num hide-sm">${fmtDist(r.dist)}<div class="sub">${compass(r.bearing)}</div></td>
          <td class="hide-sm">${status}</td>
          <td class="links hide-sm"><a href="https://hearham.com/repeaters/${encodeURIComponent(r.id)}" target="_blank" rel="noopener">HearHam</a><a href="https://www.repeaterbook.com/repeaters/callResult.php?call=${encodeURIComponent(r.call)}" target="_blank" rel="noopener">RepeaterBook</a></td>
        </tr>`;
      }).join('')
    }</tbody>` : '<tbody><tr><td class="empty">No repeaters match these filters. Try a bigger radius or another band.</td></tr></tbody>';
    drawRepeaterMap();
  }

  // Local map centred on the QTH with range rings; repeaters at the same site
  // are fanned out around it so they stay hoverable.
  function drawRepeaterMap() {
    const canvas = $('#rptMap');
    const w = canvas.clientWidth;
    if (!w) return;
    const ctx = fitCanvas(canvas, w, w);
    const cx = w / 2, cy = w / 2, R = w / 2 - 24;
    const radiusKm = rptRadiusKm();
    drawRangeRings(ctx, w, w, R, +$('#rptRadius').value);

    const pos = rpt.pos || gridToLatLon(station().grid);
    const dots = [];
    canvasDots.set(canvas, dots);
    if (!pos) return;

    const kx = 111.32 * Math.cos(pos.lat * RAD), ky = 110.57;
    const color = { '2m': css('--series-1'), '70cm': css('--series-2') };
    const other = css('--series-3');
    const sites = new Map();
    for (const r of filteredRepeaters()) {
      const x = cx + (((r.lon - pos.lon) * kx) / radiusKm) * R;
      const y = cy - (((r.lat - pos.lat) * ky) / radiusKm) * R;
      const k = `${Math.round(x / 6)},${Math.round(y / 6)}`;
      if (!sites.has(k)) sites.set(k, { x, y, items: [] });
      sites.get(k).items.push(r);
    }
    for (const s of sites.values()) {
      const n = s.items.length, spread = n > 1 ? Math.min(4 + n, 10) : 0;
      s.items.forEach((r, i) => {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        const x = s.x + spread * Math.cos(a), y = s.y + spread * Math.sin(a);
        const c = color[rptBand(r.freq)] || other;
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = r.operational ? css('--card') : c;
        ctx.fillStyle = r.operational ? c : css('--card');
        ctx.beginPath(); ctx.arc(x, y, 4.5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        if (r.id === rpt.highlight) {
          ctx.strokeStyle = css('--text');
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI); ctx.stroke();
        }
      });
      const first = s.items[0];
      dots.push({
        x: s.x, y: s.y,
        html: `<b>${esc(first.city || 'Repeater site')}</b><br><span class="k">${fmtDist(first.dist)} ${compass(first.bearing)}</span>` +
          s.items.slice(0, 8).map(r => tipRow(`${r.call} ${r.mode}`, `${fmtMHz(r.freq)} ${esc(toneText(r))}`)).join('') +
          (n > 8 ? `<div class="k">+${n - 8} more</div>` : ''),
        onClick: () => focusRepeaterRow(first.id),
      });
    }
    drawQth(ctx, cx, cy);

    $('#rptLegend').innerHTML =
      legendKey(`background:${color['2m']};border-radius:50%`, '2 m') +
      legendKey(`background:${color['70cm']};border-radius:50%`, '70 cm') +
      legendKey(`background:${other};border-radius:50%`, 'Other bands') +
      legendKey(`border:2px solid ${css('--muted')};border-radius:50%`, 'Hollow = off air') +
      legendKey(`border:2px solid ${css('--text')};border-radius:50%`, 'Your QTH');
  }

  function focusRepeaterRow(id) {
    const row = document.querySelector(`#rptTable tr[data-id="${CSS.escape(String(id))}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1500);
  }

  // ------------------------------------------------------------ APRS

  const APRS_SYMBOLS = {
    '/!': 'Police station', '/#': 'Digipeater', '/$': 'Phone', '/%': 'DX cluster', '/&': 'HF gateway',
    "/'": 'Small aircraft', '/+': 'Red Cross', '/-': 'House', '/;': 'Campground', '/<': 'Motorcycle',
    '/=': 'Train', '/>': 'Car', '/?': 'Server', '/A': 'Aid station', '/E': 'Event', '/F': 'Farm vehicle',
    '/H': 'Hotel', '/I': 'TCP/IP', '/K': 'School', '/O': 'Balloon', '/P': 'Police', '/R': 'RV', '/U': 'Bus',
    '/W': 'NWS site', '/X': 'Helicopter', '/Y': 'Yacht', '/[': 'Person', '/^': 'Aircraft', '/_': 'Weather station',
    '/a': 'Ambulance', '/b': 'Bicycle', '/c': 'Command post', '/d': 'Fire department', '/e': 'Horse',
    '/f': 'Fire truck', '/g': 'Glider', '/h': 'Hospital', '/j': 'Jeep', '/k': 'Truck', '/l': 'Laptop',
    '/m': 'Mic-E repeater', '/n': 'Node', '/o': 'EOC', '/p': 'Rover', '/r': 'Repeater', '/s': 'Boat',
    '/u': 'Semi truck', '/v': 'Van', '/w': 'Water station', '/y': 'House with Yagi',
    '\\!': 'Emergency', '\\#': 'Digipeater', '\\&': 'iGate / gateway', '\\-': 'House', '\\>': 'Car',
    '\\K': 'Kenwood radio', '\\O': 'Rocket', '\\R': 'Restaurant', '\\S': 'Satellite', '\\W': 'NWS site',
    '\\_': 'Weather site', '\\a': 'ARES/RACES', '\\j': 'Jeep', '\\k': 'SUV', '\\m': 'Milepost',
    '\\n': 'Triangle', '\\s': 'Boat', '\\u': 'Truck', '\\v': 'Van', '\\y': 'Skywarn', '\\^': 'Aircraft',
    '\\0': 'Circle', '\\9': 'Gas station', '\\D': 'Depot', '\\L': 'Lighthouse',
  };
  const APRS_MOBILE = new Set(['/>', '/<', '/=', '/O', "/'", '/R', '/U', '/X', '/Y', '/[', '/^', '/a', '/b', '/e', '/f', '/g', '/j', '/k', '/p', '/s', '/u', '/v', '/F', '/P', '\\>', '\\j', '\\k', '\\u', '\\v', '\\s', '\\^']);
  const APRS_INFRA = new Set(['/#', '\\#', '/&', '\\&', '/r', '/I', '/n', '/m', '/%']);
  const APRS_CATS = [['mobile', 'Mobile'], ['fixed', 'Fixed'], ['infra', 'Digi / iGate'], ['weather', 'Weather'], ['object', 'Objects']];

  const aprs = { data: null, cat: storeGet('hamdash.aprsCat') || '', highlight: null, timer: null };

  function aprsCategory(st) {
    if (st.kind !== 'station') return 'object';
    if (st.wx || st.symbol === '/_' || st.symbol === '\\_' || st.symbol === '/W') return 'weather';
    if (APRS_MOBILE.has(st.symbol) || st.speed > 8) return 'mobile';
    if (APRS_INFRA.has(st.symbol)) return 'infra';
    return 'fixed';
  }

  function aprsColor(cat) {
    return { mobile: css('--series-1'), infra: css('--series-2'), weather: css('--series-3'), fixed: css('--text-2') }[cat] || css('--muted');
  }

  const symbolName = st => `${APRS_SYMBOLS[st.symbol] || 'Station'}${st.overlay ? ` (${st.overlay})` : ''}`;
  // Callsign without SSID, if it looks like a real callsign (objects often aren't).
  const lookupCallOf = name => { const c = name.replace(/-[A-Z0-9]{1,2}$/, ''); return /^[A-Z0-9]{3,7}$/.test(c) && /\d/.test(c) && /[A-Z]/.test(c) ? c : null; };
  const agoShort = t => {
    const s = Math.max(0, (Date.now() - t) / 1000);
    return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  };
  const metric = () => station().units === 'km';
  const fmtSpeed = kmh => (metric() ? `${Math.round(kmh)} km/h` : `${Math.round(kmh / 1.609344)} mph`);
  const fmtAlt = m => (metric() ? `${Math.round(m).toLocaleString()} m` : `${Math.round(m / 0.3048).toLocaleString()} ft`);
  const fmtTemp = f => (metric() ? `${Math.round((f - 32) / 1.8)}°C` : `${Math.round(f)}°F`);
  const fmtWind = mph => (metric() ? `${Math.round(mph * 1.609344)} km/h` : `${Math.round(mph)} mph`);
  const fmtRain = inch => (metric() ? `${(inch * 25.4).toFixed(1)} mm` : `${inch.toFixed(2)} in`);

  function aprsZoomOptions() {
    const d = aprs.data, units = station().units;
    const feed = d?.radiusKm ? Math.round(d.radiusKm / (units === 'mi' ? 1.609344 : 1)) : 100;
    const opts = [...new Set([10, 25, 50, 100, 150, 200, 300].filter(v => v < feed).concat(feed))];
    const sel = $('#aprsZoom');
    const want = +storeGet(`hamdash.aprsZoom.${units}`) || feed;
    if (sel.dataset.sig !== `${units}:${feed}`) {
      sel.innerHTML = opts.map(v => `<option value="${v}"${v === want ? ' selected' : ''}>${v} ${units}</option>`).join('');
      if (!opts.includes(want)) sel.value = String(feed);
      sel.dataset.sig = `${units}:${feed}`;
    }
  }

  async function loadAprs() {
    try { aprs.data = await api('api/aprs'); } catch (e) { aprs.data = { status: 'error', error: e.message, stations: [] }; }
    renderAprs();
  }

  function aprsVisible() {
    const d = aprs.data;
    if (!d) return [];
    const since = Date.now() - +$('#aprsSince').value * 60000;
    const q = $('#aprsSearch').value.trim().toUpperCase();
    const here = gridToLatLon(station().grid) || d.center;
    return d.stations
      .filter(st => st.lastHeard >= since)
      .map(st => ({ ...st, cat: aprsCategory(st), dist: here ? distanceKm(here, st) : null, bearing: here ? bearingDeg(here, st) : null }))
      .filter(st => !q || st.name.includes(q) || (st.comment || '').toUpperCase().includes(q) || (st.owner || '').includes(q));
  }

  function renderAprs() {
    const d = aprs.data;
    $('#aprsGrid').textContent = station().grid || 'you';
    if (!d) return;
    const STATUS = {
      connected: `Live · ${d.server}`, connecting: 'Connecting…', reconnecting: 'Reconnecting…',
      disabled: 'Turned off in the add-on options', 'no-callsign': 'Set a callsign in the add-on options',
      'no-grid': 'Set a grid square in the add-on options', error: `Unavailable: ${d.error || ''}`,
    };
    $('#aprsStatus').textContent = STATUS[d.status] || d.status;
    aprsZoomOptions();

    const all = aprsVisible();
    const counts = {};
    for (const st of all) counts[st.cat] = (counts[st.cat] || 0) + 1;
    $('#aprsCatChips').innerHTML = [['', 'All', all.length], ...APRS_CATS.map(([k, l]) => [k, l, counts[k] || 0])]
      .filter(([k, , n]) => !k || n || k === aprs.cat)
      .map(([k, l, n]) => `<button type="button" class="chip" data-cat="${k}" aria-pressed="${aprs.cat === k}">${l}<span class="n">${n}</span></button>`).join('');

    const rows = all.filter(st => !aprs.cat || st.cat === aprs.cat).sort((a, b) => b.lastHeard - a.lastHeard);
    $('#aprsMeta').textContent = `${rows.length} station${rows.length === 1 ? '' : 's'}`;

    const here = gridToLatLon(station().grid);
    const far = here && d.center && distanceKm(here, d.center) > (d.radiusKm || 0) / 2;
    $('#aprsNote').textContent = far
      ? `The live feed covers ${fmtDist(d.radiusKm)} around the add-on’s grid square, not your browser’s. Change the grid in the add-on options to move it.`
      : d.status === 'connected' ? `Receiving everything heard within ${fmtDist(d.radiusKm)} of the add-on’s grid square. Stations drop off after 3 hours of silence.` : '';

    if (!rows.length) {
      $('#aprsTable').innerHTML = `<tbody><tr><td class="empty">${d.status === 'connected'
        ? 'No stations heard in this window yet. APRS stations beacon every few minutes to every half hour, so give it a little time.'
        : esc(STATUS[d.status] || 'Not connected')}</td></tr></tbody>`;
    } else {
      $('#aprsTable').innerHTML = `<thead><tr><th>Station</th><th>Heard</th><th class="num">Distance</th><th>Info</th></tr></thead><tbody>${
        rows.map(st => {
          const call = st.kind === 'station' ? lookupCallOf(st.name) : null;
          const who = call ? `<button type="button" class="call-link mono" data-call="${esc(call)}" title="Look up ${esc(call)}">${esc(st.name)}</button>` : `<span class="mono call-plain">${esc(st.name)}</span>`;
          const kind = st.kind === 'station' ? symbolName(st) : `${st.kind === 'object' ? 'Object' : 'Item'} by ${st.owner || '?'}`;
          const moving = st.speed > 3;
          const info = moving ? `${fmtSpeed(st.speed)} ${st.course !== undefined ? compass(st.course) : ''}`
            : st.wx?.tempF !== undefined && st.wx.tempF !== null ? fmtTemp(st.wx.tempF)
              : st.alt ? fmtAlt(st.alt) : '';
          const note = st.comment || st.status || '';
          return `<tr data-key="${esc(st.kind + ':' + st.name)}">
            <td>${who}<div class="sub">${esc(kind)} · <a href="https://aprs.fi/info/a/${encodeURIComponent(st.name)}" target="_blank" rel="noopener">aprs.fi</a></div></td>
            <td class="mono">${agoShort(st.lastHeard)}</td>
            <td class="mono num">${st.dist !== null ? fmtDist(st.dist) : '—'}<div class="sub">${st.bearing !== null ? compass(st.bearing) : ''}</div></td>
            <td>${esc(info)}<div class="sub" title="${esc(note)}">${esc(note)}</div></td>
          </tr>`;
        }).join('')
      }</tbody>`;
    }
    renderAprsWeather(all);
    drawAprsMap();
  }

  function renderAprsWeather(all) {
    const wx = all.filter(st => st.wx && st.wxTime > Date.now() - 2 * 3600000 && st.wx.tempF != null)
      .sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9)).slice(0, 8);
    $('#aprsWx').innerHTML = wx.length ? wx.map(st => {
      const w = st.wx;
      const call = lookupCallOf(st.name);
      const wind = w.windMph == null ? ''
        : w.windMph === 0 && !w.gustMph ? 'Calm'
          : `${w.windDir != null ? compass(w.windDir) + ' ' : ''}${fmtWind(w.windMph)}${w.gustMph ? `, gust ${fmtWind(w.gustMph)}` : ''}`;
      const rows = [
        ['Wind', wind],
        ['Humidity', w.humidity != null ? `${w.humidity}%` : ''],
        ['Pressure', w.pressureHpa ? `${w.pressureHpa.toFixed(1)} hPa` : ''],
        ['Rain today', w.rainMidnightIn != null ? fmtRain(w.rainMidnightIn) : ''],
      ].filter(([, v]) => v);
      return `<div class="tile wx-card">
        <span class="label">${call ? `<button type="button" class="call-link mono" data-call="${esc(call)}">${esc(st.name)}</button>` : esc(st.name)}</span>
        <span class="value">${fmtTemp(w.tempF)}</span>
        <span class="sub">${st.dist != null ? `${fmtDist(st.dist)} ${compass(st.bearing)} · ` : ''}${agoShort(st.wxTime)} ago</span>
        <dl class="wx-rows">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      </div>`;
    }).join('') : '<div class="empty">No weather stations heard in this window yet.</div>';
  }

  function drawAprsMap() {
    const canvas = $('#aprsMap');
    const w = canvas.clientWidth;
    if (!w) return;
    const h = Math.round(w * 0.75);
    const ctx = fitCanvas(canvas, w, h);
    const R = Math.min(w, h) / 2 - 24, cx = w / 2, cy = h / 2;
    const zoom = +$('#aprsZoom').value || 100;
    const radiusKm = zoom * (station().units === 'mi' ? 1.609344 : 1);
    drawRangeRings(ctx, w, h, R, zoom);

    const dots = [];
    canvasDots.set(canvas, dots);
    const d = aprs.data;
    const center = gridToLatLon(station().grid) || d?.center;
    if (!center) return;
    const kx = 111.32 * Math.cos(center.lat * RAD), ky = 110.57;
    const P = (lat, lon) => [cx + (((lon - center.lon) * kx) / radiusKm) * R, cy - (((lat - center.lat) * ky) / radiusKm) * R];
    const list = aprsVisible().filter(st => (!aprs.cat || st.cat === aprs.cat) && st.dist <= radiusKm * 1.05);

    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R + 6, 0, 2 * Math.PI); ctx.clip();
    if ($('#aprsTracks').checked) {
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.5;
      for (const st of list) {
        if (st.track.length < 2) continue;
        ctx.strokeStyle = aprsColor(st.cat);
        ctx.beginPath();
        st.track.forEach(([lat, lon], i) => { const [x, y] = P(lat, lon); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    const labels = $('#aprsLabels').checked;
    const placed = []; // label boxes already drawn, to skip overlapping ones
    ctx.font = '11px system-ui, sans-serif';
    for (const st of list) {
      const [x, y] = P(st.lat, st.lon);
      const c = aprsColor(st.cat);
      const key = `${st.kind}:${st.name}`;
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = css('--card');
      ctx.fillStyle = c;
      ctx.beginPath();
      if (st.cat === 'object') {
        ctx.moveTo(x, y - 5.5); ctx.lineTo(x + 5.5, y); ctx.lineTo(x, y + 5.5); ctx.lineTo(x - 5.5, y); ctx.closePath();
        ctx.fillStyle = css('--card'); ctx.strokeStyle = c; ctx.fill(); ctx.stroke();
      } else {
        ctx.arc(x, y, 5, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      }
      if (st.speed > 3 && st.course !== undefined) {
        const a = (st.course - 90) * RAD;
        ctx.strokeStyle = c;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + 6 * Math.cos(a), y + 6 * Math.sin(a)); ctx.lineTo(x + 13 * Math.cos(a), y + 13 * Math.sin(a)); ctx.stroke();
      }
      if (key === aprs.highlight) {
        ctx.strokeStyle = css('--text');
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x, y, 10, 0, 2 * Math.PI); ctx.stroke();
      }
      const box = { x: x + 7, y: y - 7, w: ctx.measureText(st.name).width + 2, h: 14 };
      const free = !placed.some(b => box.x < b.x + b.w && b.x < box.x + box.w && box.y < b.y + b.h && b.y < box.y + box.h);
      if (labels && free) {
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = css('--card-2');
        ctx.fillStyle = css('--text-2');
        ctx.strokeText(st.name, x + 8, y + 4);
        ctx.fillText(st.name, x + 8, y + 4);
      }
      const via = st.path?.digis?.length ? `via ${st.path.digis.join(', ')}` : st.path?.internet ? 'via internet' : 'direct to iGate';
      dots.push({
        x, y,
        html: `<b class="mono">${esc(st.name)}</b> <span class="k">${esc(st.kind === 'station' ? symbolName(st) : st.kind)}</span>` +
          tipRow('Heard', `${agoShort(st.lastHeard)} ago`) +
          tipRow('Distance', `${fmtDist(st.dist)} ${compass(st.bearing)}`) +
          (st.speed > 3 ? tipRow('Moving', `${fmtSpeed(st.speed)} ${st.course !== undefined ? compass(st.course) : ''}`) : '') +
          (st.alt ? tipRow('Altitude', fmtAlt(st.alt)) : '') +
          (st.wx?.tempF != null ? tipRow('Temperature', fmtTemp(st.wx.tempF)) : '') +
          tipRow('Path', esc(`${via}${st.path?.igate ? ` · iGate ${st.path.igate}` : ''}`)) +
          (st.comment ? `<div class="k">${esc(st.comment)}</div>` : ''),
        onClick: () => focusAprsRow(key),
      });
    }
    ctx.restore();
    drawQth(ctx, cx, cy);

    $('#aprsLegend').innerHTML = APRS_CATS.map(([k, l]) => legendKey(k === 'object'
      ? `border:2px solid ${aprsColor(k)};transform:rotate(45deg) scale(.8)`
      : `background:${aprsColor(k)};border-radius:50%`, l)).join('') +
      legendKey(`border:2px solid ${css('--text')};border-radius:50%`, 'You');
  }

  function focusAprsRow(key) {
    const row = document.querySelector(`#aprsTable tr[data-key="${CSS.escape(key)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1500);
  }

  // ------------------------------------------------------------ POTA

  const pota = { data: null, error: null, band: storeGet('hamdash.potaBand') || '', timer: null };
  const POTA_RANGES = { mi: [250, 500, 1000, 2500], km: [400, 800, 1600, 4000] };
  const DIGI_MODES = new Set(['FT8', 'FT4', 'RTTY', 'PSK31', 'JS8', 'DATA', 'DIGI', 'PSK', 'OLIVIA']);
  const potaModeGroup = m => (m === 'CW' ? 'CW' : DIGI_MODES.has(m) ? 'DIGI' : m ? 'SSB' : '');
  const potaColor = g => ({ CW: css('--series-1'), SSB: css('--series-2'), DIGI: css('--series-3') }[g] || css('--muted'));
  const isQrt = s => /\bQRT\b/i.test(s.comments);

  function fillPotaRanges() {
    const units = station().units, sel = $('#potaRange');
    const saved = storeGet(`hamdash.potaRange.${units}`) || '';
    sel.innerHTML = `<option value="">Anywhere</option>` + POTA_RANGES[units].map(r => `<option value="${r}">${r.toLocaleString()} ${units}</option>`).join('');
    sel.value = POTA_RANGES[units].includes(+saved) ? saved : '';
  }

  async function loadPota() {
    try { pota.data = await api('api/pota'); pota.error = null; } catch (e) { pota.error = e.message; }
    renderPota();
  }

  function potaVisible() {
    if (!pota.data) return [];
    const here = gridToLatLon(station().grid);
    const mode = $('#potaMode').value, range = +$('#potaRange').value * (station().units === 'mi' ? 1.609344 : 1);
    const q = $('#potaSearch').value.trim().toUpperCase();
    return pota.data.spots
      .map(s => ({
        ...s, group: potaModeGroup(s.mode),
        dist: here && s.lat !== null ? distanceKm(here, s) : null,
        bearing: here && s.lat !== null ? bearingDeg(here, s) : null,
      }))
      .filter(s => (!mode || s.group === mode) && (!range || (s.dist !== null && s.dist <= range)) &&
        (!q || s.activator.includes(q) || s.reference.toUpperCase().includes(q) || s.park.toUpperCase().includes(q) || s.location.toUpperCase().includes(q)));
  }

  function renderPota() {
    $('#potaStatus').textContent = pota.error ? `Unavailable: ${pota.error}` : pota.data ? `${pota.data.spots.length} spots worldwide` : 'Loading…';
    const all = potaVisible();
    const counts = {};
    for (const s of all) if (s.band) counts[s.band] = (counts[s.band] || 0) + 1;
    $('#potaBandChips').innerHTML = [['', 'All bands', all.length], ...SPOT_BANDS.filter(b => counts[b] || b === pota.band).map(b => [b, b, counts[b] || 0])]
      .map(([v, l, n]) => `<button type="button" class="chip" data-band="${v}" aria-pressed="${pota.band === v}">${l}<span class="n">${n}</span></button>`).join('');

    const rows = all.filter(s => !pota.band || s.band === pota.band);
    if ($('#potaSort').value === 'near') rows.sort((a, b) => (a.dist ?? 1e9) - (b.dist ?? 1e9));
    else rows.sort((a, b) => b.time.localeCompare(a.time));
    $('#potaMeta').textContent = `${rows.length} shown`;

    $('#potaTable').innerHTML = !pota.data ? '<tbody><tr><td class="empty">Loading spots…</td></tr></tbody>'
      : !rows.length ? '<tbody><tr><td class="empty">No activators match these filters right now.</td></tr></tbody>'
        : `<thead><tr><th>Activator</th><th class="num">kHz</th><th class="num">Distance</th><th class="hide-sm">Age</th></tr></thead><tbody>${
          rows.slice(0, 200).map(s => {
            const call = lookupCallOf(s.activator.replace(/\/.*$/, '')) || null;
            const who = call ? `<button type="button" class="call-link mono" data-call="${esc(call)}" title="Look up ${esc(call)}">${esc(s.activator)}</button>` : `<span class="mono call-plain">${esc(s.activator)}</span>`;
            return `<tr class="${isQrt(s) ? 'off' : ''}" data-ref="${esc(s.reference)}">
              <td>${who}<span class="show-sm count">${agoShort(Date.parse(s.time))}</span>${isQrt(s) ? ' ' + pill('closed', 'QRT') : ''}<div class="sub" title="${esc(s.park)}"><a href="https://pota.app/#/park/${encodeURIComponent(s.reference)}" target="_blank" rel="noopener">${esc(s.reference)}</a> · ${esc(s.park)}</div></td>
              <td class="mono num freq-out">${s.freq ?? '—'}<div class="sub">${esc([s.band, s.mode].filter(Boolean).join(' · '))}</div></td>
              <td class="mono num">${s.dist !== null ? fmtDist(s.dist) : '—'}<div class="sub">${s.bearing !== null ? compass(s.bearing) : esc(s.location)}</div></td>
              <td class="mono hide-sm">${agoShort(Date.parse(s.time))}<div class="sub">${esc(s.location)}</div></td>
            </tr>`;
          }).join('')
        }</tbody>`;
    drawPotaMap(rows);
  }

  function drawPotaMap(rows = potaVisible().filter(s => !pota.band || s.band === pota.band)) {
    const here = gridToLatLon(station().grid);
    const res = drawWorld($('#potaMap'), (ctx, X, Y, dots) => {
      for (const s of rows) {
        if (s.lat === null || s.lon === null) continue;
        const x = X(s.lon), y = Y(s.lat), c = potaColor(s.group);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isQrt(s) ? c : css('--card');
        ctx.fillStyle = isQrt(s) ? css('--card') : c;
        ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
        dots.push({
          x, y,
          html: `<b class="mono">${esc(s.activator)}</b> <span class="k">${esc(s.reference)}</span><br>${esc(s.park)}` +
            tipRow('Frequency', `${s.freq ?? '—'} kHz ${esc(s.mode)}`) +
            (s.dist !== null ? tipRow('Distance', `${fmtDist(s.dist)} ${compass(s.bearing)}`) : '') +
            tipRow('Spotted', `${agoShort(Date.parse(s.time))} ago`) +
            (s.comments ? `<div class="k">${esc(s.comments)}</div>` : ''),
          onClick: () => focusRow('#potaTable', `tr[data-ref="${CSS.escape(s.reference)}"]`),
        });
      }
      if (here) drawQth(ctx, X(here.lon), Y(here.lat));
    });
    if (!res) return;
    $('#potaLegend').innerHTML = nightLegend(res.night) +
      legendKey(`background:${potaColor('CW')};border-radius:50%`, 'CW') +
      legendKey(`background:${potaColor('SSB')};border-radius:50%`, 'Phone') +
      legendKey(`background:${potaColor('DIGI')};border-radius:50%`, 'Digital') +
      legendKey(`border:2px solid ${css('--muted')};border-radius:50%`, 'Hollow = QRT') +
      (here ? legendKey(`border:2px solid ${css('--text')};border-radius:50%`, 'You') : '');
  }

  function focusRow(table, selector) {
    const row = document.querySelector(`${table} ${selector}`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 1500);
  }

  // ------------------------------------------------------------ satellites

  const sats = { data: null, error: null, type: storeGet('hamdash.satType') || '', selected: null, key: '', timer: null };
  const C_KMS = 299792.458;
  const dopplerDown = (mhz, rr) => mhz * (1 - rr / C_KMS);
  const dopplerUp = (mhz, rr) => mhz * (1 + rr / C_KMS);
  const fmtMHz3 = f => f.toFixed(3);
  const passKey = (s, p) => `${s.id}|${p.aos}`;
  const satBand = f => (Array.isArray(f) ? (f[0] + f[1]) / 2 : f);

  async function loadSats() {
    const pos = gridToLatLon(station().grid);
    $('#satGrid').textContent = station().grid || 'you';
    if (!pos) { sats.data = null; sats.error = 'Set your grid square (top right) to predict passes.'; renderSats(); return; }
    try {
      sats.data = await api(`api/satellites?lat=${pos.lat.toFixed(4)}&lon=${pos.lon.toFixed(4)}`);
      sats.error = null;
    } catch (e) { sats.error = `Couldn't load predictions: ${e.message}`; }
    renderSats();
  }

  function upcomingPasses() {
    if (!sats.data) return [];
    const now = Date.now(), minEl = +$('#satMinEl').value;
    return sats.data.sats
      .filter(s => !s.missing && (!sats.type || s.type === sats.type))
      .flatMap(s => s.passes.filter(p => Date.parse(p.los) > now && p.maxEl >= minEl).map(p => ({ s, p })))
      .sort((a, b) => Date.parse(a.p.aos) - Date.parse(b.p.aos));
  }

  const untilText = ms => {
    const m = Math.round(ms / 60000);
    return m < 60 ? `in ${m} min` : `in ${Math.floor(m / 60)}h ${m % 60}m`;
  };

  function renderSats() {
    const types = ['', 'FM', 'Linear'];
    $('#satTypeChips').innerHTML = types.map(t => `<button type="button" class="chip" data-type="${t}" aria-pressed="${sats.type === t}">${t || 'All satellites'}</button>`).join('');
    if (sats.error) {
      $('#passTable').innerHTML = `<tbody><tr><td class="empty">${esc(sats.error)}</td></tr></tbody>`;
      $('#passDetail').innerHTML = '';
      drawSkyPlot(null);
      return;
    }
    if (!sats.data) { $('#passTable').innerHTML = '<tbody><tr><td class="empty">Computing passes…</td></tr></tbody>'; return; }

    const list = upcomingPasses();
    const missing = sats.data.sats.filter(s => s.missing).map(s => s.name);
    $('#satMeta').textContent = `Next 24 hours · ${list.length} passes${missing.length ? ` · no data for ${missing.join(', ')}` : ''}`;
    const now = Date.now();
    if (!list.some(x => passKey(x.s, x.p) === sats.selected)) {
      const pick = list.find(x => Date.parse(x.p.aos) <= now) || list.find(x => x.p.maxEl >= 20) || list[0];
      sats.selected = pick ? passKey(pick.s, pick.p) : null;
    }

    $('#passTable').innerHTML = list.length ? `<thead><tr><th>Satellite</th><th>Starts</th><th class="num">Max el</th><th>Path</th></tr></thead><tbody>${
      list.map(({ s, p }) => {
        const aos = new Date(p.aos), up = Date.parse(p.aos) <= now;
        return `<tr class="pass-row${passKey(s, p) === sats.selected ? ' selected' : ''}" data-pass="${esc(passKey(s, p))}" tabindex="0">
          <td><span class="mono call-plain">${esc(s.name)}</span><div class="sub">${esc(s.type)} · ${esc(s.mode)}</div></td>
          <td class="mono">${localHM(aos)}<div class="sub">${up ? pill('good', 'Up now') : esc(untilText(aos - now))}</div></td>
          <td class="mono num">${Math.round(p.maxEl)}°<div class="el-bar"><span style="width:${Math.min(100, (p.maxEl / 90) * 100)}%"></span></div></td>
          <td class="mono">${compass(p.aosAz)} → ${compass(p.losAz)}<div class="sub">${Math.round(p.durationMin)} min</div></td>
        </tr>`;
      }).join('')
    }</tbody>` : '<tbody><tr><td class="empty">No passes match these filters in the next 24 hours.</td></tr></tbody>';

    const sel = list.find(x => passKey(x.s, x.p) === sats.selected);
    renderPassDetail(sel);
    drawSkyPlot(sel);
  }

  function renderPassDetail(sel) {
    const box = $('#passDetail');
    if (!sel) { box.innerHTML = '<div class="empty">Select a pass to see its sky track and Doppler-corrected frequencies.</div>'; $('#skyMeta').textContent = ''; return; }
    const { s, p } = sel;
    $('#skyMeta').textContent = `${s.name} · ${localHM(new Date(p.aos))}`;
    const rr = p.rangeRate;
    const freqRow = (label, f, up) => {
      if (f === undefined) return '';
      const fmt = rate => (Array.isArray(f)
        ? `${((up ? dopplerUp : dopplerDown)(satBand(f), rate) - satBand(f)) * 1000 >= 0 ? '+' : ''}${(((up ? dopplerUp : dopplerDown)(satBand(f), rate) - satBand(f)) * 1000).toFixed(1)} kHz`
        : fmtMHz3((up ? dopplerUp : dopplerDown)(f, rate)));
      const nominal = Array.isArray(f) ? `${fmtMHz3(f[0])}–${fmtMHz3(f[1])}` : fmtMHz3(f);
      return `<tr><td>${label}<div class="sub mono">${nominal}${up && s.tone ? ` · PL ${s.tone}` : ''}</div></td><td class="mono">${fmt(rr.aos)}</td><td class="mono">${fmt(rr.tca)}</td><td class="mono">${fmt(rr.los)}</td></tr>`;
    };
    box.innerHTML = `
      <div class="sun-times">
        ${tile('Rise (AOS)', localHM(new Date(p.aos)), '', `${utcHM(new Date(p.aos))} UTC · ${Math.round(p.aosAz)}° ${compass(p.aosAz)}`)}
        ${tile('Highest (TCA)', `${Math.round(p.maxEl)}°`, '', `${localHM(new Date(p.tca))}`)}
        ${tile('Set (LOS)', localHM(new Date(p.los)), '', `${utcHM(new Date(p.los))} UTC · ${Math.round(p.losAz)}° ${compass(p.losAz)}`)}
      </div>
      <table class="mini-table doppler">
        <thead><tr><th>Doppler</th><th>AOS</th><th>TCA</th><th>LOS</th></tr></thead>
        <tbody>${freqRow('Downlink (listen)', s.downlink, false)}${freqRow('Uplink (transmit)', s.uplink, true)}</tbody>
      </table>
      <p class="note">${esc(s.mode)}${s.notes ? ` · ${esc(s.notes)}` : ''}. ${Array.isArray(s.downlink) ? 'Linear passbands show the shift at the centre of the passband.' : 'Frequencies are corrected for Doppler shift; most radios tune in 5 kHz steps.'}</p>`;
  }

  // Polar plot: centre is straight up, the edge is the horizon.
  function drawSkyPlot(sel) {
    const canvas = $('#skyPlot');
    const w = canvas.clientWidth;
    if (!w) return;
    const ctx = fitCanvas(canvas, w, w);
    const cx = w / 2, cy = w / 2, R = w / 2 - 26;
    ctx.fillStyle = css('--card-2');
    ctx.fillRect(0, 0, w, w);
    ctx.strokeStyle = css('--grid-line');
    ctx.fillStyle = css('--muted');
    ctx.lineWidth = 1;
    ctx.font = '11px system-ui, sans-serif';
    for (const el of [0, 30, 60]) {
      const r = (R * (90 - el)) / 90;
      ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
      ctx.fillText(`${el}°`, cx + 4, cy - r + 12);
    }
    ctx.beginPath(); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.stroke();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [t, x, y] of [['N', cx, cy - R - 13], ['S', cx, cy + R + 13], ['E', cx + R + 13, cy], ['W', cx - R - 13, cy]]) ctx.fillText(t, x, y);
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
    const dots = [];
    canvasDots.set(canvas, dots);
    if (!sel) return;

    const P = (az, el) => { const r = (R * (90 - Math.max(0, el))) / 90; return [cx + r * Math.sin(az * RAD), cy - r * Math.cos(az * RAD)]; };
    const { s, p } = sel;
    ctx.strokeStyle = css('--series-1');
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    p.track.forEach(([az, el], i) => { const [x, y] = P(az, el); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke();
    // Arrowhead showing direction of travel at the end of the track.
    const [x1, y1] = P(...p.track[p.track.length - 2]), [x2, y2] = P(...p.track[p.track.length - 1]);
    const a = Math.atan2(y2 - y1, x2 - x1);
    ctx.fillStyle = css('--series-1');
    ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - 9 * Math.cos(a - 0.45), y2 - 9 * Math.sin(a - 0.45)); ctx.lineTo(x2 - 9 * Math.cos(a + 0.45), y2 - 9 * Math.sin(a + 0.45)); ctx.closePath(); ctx.fill();

    const mark = (az, el, label, html) => {
      const [x, y] = P(az, el);
      ctx.fillStyle = css('--card'); ctx.strokeStyle = css('--series-1'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 4, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      ctx.fillStyle = css('--text-2');
      ctx.fillText(label, x + 7, y - 6);
      dots.push({ x, y, html });
    };
    const tcaPt = p.track.reduce((b, t) => (t[1] > b[1] ? t : b));
    mark(p.track[0][0], p.track[0][1], `AOS ${localHM(new Date(p.aos))}`, `<b>Rise</b>${tipRow('Time', localHM(new Date(p.aos)))}${tipRow('Azimuth', `${Math.round(p.aosAz)}°`)}`);
    mark(tcaPt[0], tcaPt[1], `${Math.round(p.maxEl)}°`, `<b>Highest</b>${tipRow('Time', localHM(new Date(p.tca)))}${tipRow('Elevation', `${Math.round(p.maxEl)}°`)}${tipRow('Azimuth', `${Math.round(tcaPt[0])}°`)}`);
    mark(p.losAz, 0, `LOS ${localHM(new Date(p.los))}`, `<b>Set</b>${tipRow('Time', localHM(new Date(p.los)))}${tipRow('Azimuth', `${Math.round(p.losAz)}°`)}`);

    const now = sats.data?.now?.[s.id];
    if (now && now.el > 0 && Date.parse(p.aos) <= Date.now()) {
      const [x, y] = P(now.az, now.el);
      ctx.fillStyle = css('--series-2'); ctx.strokeStyle = css('--card'); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 7, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      dots.push({ x, y, html: `<b>${esc(s.name)} now</b>${tipRow('Azimuth', `${Math.round(now.az)}° ${compass(now.az)}`)}${tipRow('Elevation', `${Math.round(now.el)}°`)}${tipRow('Range', `${fmtDist(now.range)}`)}` });
    }
  }

  // ------------------------------------------------------------ callsign lookup

  const look = { result: null, loading: null, error: null };
  const recentCalls = () => { try { return JSON.parse(storeGet('hamdash.recent')) || []; } catch { return []; } };
  const titleCase = s => (s && s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()) : s || '');
  const LICENSE_CLASS = { E: 'Amateur Extra', EXTRA: 'Amateur Extra', A: 'Advanced', ADVANCED: 'Advanced', G: 'General', GENERAL: 'General', T: 'Technician', TECHNICIAN: 'Technician', N: 'Novice', NOVICE: 'Novice', P: 'Technician Plus' };

  async function lookup(call) {
    call = String(call || '').trim().toUpperCase();
    $('#lookupInput').value = call;
    if (currentView !== 'lookup') showView('lookup');
    if (!/^[A-Z0-9/]{3,15}$/.test(call)) { look.error = 'Enter a valid callsign.'; look.result = null; renderLookup(); return; }
    look.loading = call;
    look.error = null;
    renderLookup();
    try {
      const r = await api(`api/lookup?call=${encodeURIComponent(call)}`);
      if (look.loading !== call) return;
      look.result = r;
      if (!r.notFound) storeSet('hamdash.recent', JSON.stringify([call, ...recentCalls().filter(c => c !== call)].slice(0, 10)));
    } catch (e) {
      look.result = null;
      look.error = `Lookup failed: ${e.message}`;
    }
    look.loading = null;
    renderLookup();
  }

  const lookupPos = r => (r && r.lat != null && r.lon != null ? { lat: r.lat, lon: r.lon } : gridToLatLon(r?.grid));

  function renderLookup() {
    const recent = recentCalls();
    $('#lookupRecent').innerHTML = recent.length
      ? `<span class="meta">Recent:</span>${recent.map(c => `<button type="button" class="chip mono" data-call="${esc(c)}">${esc(c)}</button>`).join('')}`
      : '';
    $('#lookupNote').innerHTML = state.defaults.qrz
      ? 'Lookups use your QRZ account, with FCC data filling gaps for US calls.'
      : 'US callsigns are looked up free from FCC data. For worldwide lookups, add your QRZ username and password on the add-on’s Configuration tab. Full QRZ details need a <a href="https://www.qrz.com/page/xml_data.html" target="_blank" rel="noopener">QRZ XML subscription</a>.';

    const out = $('#lookupResult');
    const r = look.result;
    $('#lookupPathCard').hidden = true;
    if (look.loading) { out.innerHTML = `<div class="empty">Looking up ${esc(look.loading)}…</div>`; return; }
    if (look.error) { out.innerHTML = `<p class="error">${esc(look.error)}</p>`; return; }
    if (!r) { out.innerHTML = '<div class="empty">Enter a callsign above, or click any callsign in the spots, PSKReporter or repeater lists.</div>'; return; }
    if (r.notFound) {
      out.innerHTML = `<div class="empty">No record found for <b class="mono">${esc(r.call)}</b>.${
        r.qrz ? '' : ' Without a QRZ account, only US callsigns can be looked up.'}</div>${
        r.warning ? `<p class="error">${esc(r.warning)}</p>` : ''}`;
      return;
    }

    const cls = LICENSE_CLASS[String(r.class || '').toUpperCase()] || titleCase(r.class);
    const qsl = [r.lotw && 'LoTW', r.eqsl && 'eQSL', r.mqsl && 'Direct (mail)'].filter(Boolean).join(', ');
    const facts = [
      ['Address', [r.addr1, r.addr2].filter(Boolean).map(titleCase)
        .map(s => s.replace(/, ([A-Z][a-z]) (\d{5})/, (m, st, zip) => `, ${st.toUpperCase()} ${zip}`)).map(esc).join('<br>')],
      ['County', esc(r.county)],
      ['Country', esc(r.country)],
      ['Grid', r.grid ? `<span class="mono">${esc(r.grid)}</span>` : ''],
      ['License class', esc(cls)],
      ['Granted', esc(r.effective)],
      ['Expires', esc(r.expires)],
      ['Trustee', r.trustee ? callLink(r.trustee) : ''],
      ['Previous call', r.previous ? `<span class="mono">${esc(r.previous)}</span>` : ''],
      ['Aliases', r.aliases ? `<span class="mono">${esc(r.aliases)}</span>` : ''],
      ['QSL', esc(qsl)],
      ['QSL manager', esc(r.qslmgr)],
      ['Zones', [r.dxcc && `DXCC ${r.dxcc}`, r.cqzone && `CQ ${r.cqzone}`, r.ituzone && `ITU ${r.ituzone}`].filter(Boolean).map(esc).join(' · ')],
      ['Time zone', esc(r.timezone)],
    ].filter(([, v]) => v);

    out.innerHTML = `
      <div class="lookup-head">
        ${r.image ? `<img class="lookup-photo" src="${esc(r.image)}" alt="Photo from QRZ for ${esc(r.call)}" referrerpolicy="no-referrer">` : ''}
        <div>
          <div class="lookup-call mono">${esc(r.call)}</div>
          <div class="lookup-name">${esc(titleCase(r.name))}${r.nickname ? ` “${esc(r.nickname)}”` : ''}</div>
          <div class="lookup-tags">${cls ? `<span class="tag">${esc(cls)}</span>` : ''}${(r.sources || []).map(s => `<span class="tag">${esc(s)}</span>`).join('')}</div>
        </div>
      </div>
      <dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
      <div class="lookup-links">
        <a href="${esc(r.url)}" target="_blank" rel="noopener">QRZ.com page</a>
        ${r.uls ? `<a href="${esc(r.uls)}" target="_blank" rel="noopener">FCC license record</a>` : ''}
      </div>
      ${r.warning ? `<p class="error">QRZ lookup failed (${esc(r.warning)}), so this shows FCC data only.</p>` : ''}`;

    const there = lookupPos(r), here = gridToLatLon(station().grid);
    if (there && here) {
      $('#lookupPathCard').hidden = false;
      const d = distanceKm(here, there), b = bearingDeg(here, there);
      const alt = sunAltitude(sunPosition(new Date()), there.lat, there.lon);
      $('#lookupPath').innerHTML = [
        tile('Distance', fmtDist(d), '', 'Short path'),
        tile('Beam heading', `${Math.round(b)}°`, '', `${compass(b)} · short path`),
        tile('Long path', `${Math.round((b + 180) % 360)}°`, '', fmtDist(40075 - d)),
        tile('Sun at station', sunPhase(alt), '', `Elevation ${alt.toFixed(0)}°`),
      ].join('');
      drawLookupMap();
    }
  }

  // Points along the great circle from a to b (spherical interpolation).
  function greatCircle(a, b, n = 160) {
    const v = p => [Math.cos(p.lat * RAD) * Math.cos(p.lon * RAD), Math.cos(p.lat * RAD) * Math.sin(p.lon * RAD), Math.sin(p.lat * RAD)];
    const A = v(a), B = v(b);
    const d = Math.acos(Math.max(-1, Math.min(1, A[0] * B[0] + A[1] * B[1] + A[2] * B[2])));
    if (d < 1e-6) return [a, b];
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, s1 = Math.sin((1 - t) * d) / Math.sin(d), s2 = Math.sin(t * d) / Math.sin(d);
      const [x, y, z] = [0, 1, 2].map(k => s1 * A[k] + s2 * B[k]);
      pts.push({ lat: Math.atan2(z, Math.hypot(x, y)) / RAD, lon: Math.atan2(y, x) / RAD });
    }
    return pts;
  }

  function drawLookupMap() {
    const r = look.result;
    const there = lookupPos(r), here = gridToLatLon(station().grid);
    if ($('#lookupPathCard').hidden || !there || !here) return;
    const res = drawWorld($('#lookupMap'), (ctx, X, Y, dots) => {
      ctx.strokeStyle = css('--series-1');
      ctx.lineWidth = 2;
      ctx.beginPath();
      let prev = null;
      for (const p of greatCircle(here, there)) {
        if (prev && Math.abs(p.lon - prev.lon) > 180) ctx.moveTo(X(p.lon), Y(p.lat));
        else if (prev) ctx.lineTo(X(p.lon), Y(p.lat));
        else ctx.moveTo(X(p.lon), Y(p.lat));
        prev = p;
      }
      ctx.stroke();
      const x = X(there.lon), y = Y(there.lat);
      ctx.fillStyle = css('--series-2');
      ctx.strokeStyle = css('--card');
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      dots.push({ x, y, html: `<b class="mono">${esc(r.call)}</b><br>${esc(titleCase(r.name))}` });
      drawQth(ctx, X(here.lon), Y(here.lat));
      dots.push({ x: X(here.lon), y: Y(here.lat), html: `<b class="mono">${esc(station().callsign || 'Your QTH')}</b>` });
    });
    if (!res) return;
    $('#lookupLegend').innerHTML = nightLegend(res.night) +
      legendKey(`border:2px solid ${css('--text')};border-radius:50%`, 'Your QTH') +
      legendKey(`background:${css('--series-2')};border-radius:50%`, r.call) +
      legendKey(`height:0;border-top:2px solid ${css('--series-1')};border-radius:0`, 'Short path');
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
    fillRadiusOptions();
    fillPotaRanges();
    state.activity = null;
    loadActivity();
    renderStorm();
    rpt.key = '';
    rpt.pos = null;
    if (currentView === 'repeaters') loadRepeaters();
    if (currentView === 'pota') renderPota();
    if (currentView === 'sats') loadSats();
    if (look.result) renderLookup();
  }

  // ------------------------------------------------------------ loaders

  async function loadSolar() {
    try {
      state.solar = await api('api/solar');
      renderTiles(); renderScales(); renderBands(); renderKp(); renderAlerts();
    } catch (e) { console.warn(e); }
  }
  async function loadActivity() {
    const pos = gridToLatLon(station().grid);
    if (!pos) return;
    try { state.activity = await api(`api/activity?lat=${pos.lat.toFixed(4)}&lon=${pos.lon.toFixed(4)}`); renderBands(); } catch (e) { console.warn(e); }
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
    try { state.land = decodeLand(await api('land-110m.json')); redrawVisible(); } catch (e) { console.warn(e); }
  }

  // ------------------------------------------------------------ boot

  async function init() {
    tickClocks();
    setInterval(tickClocks, 1000);
    bindSettings();
    bindMapTabs();
    for (const id of ['#grayline', '#rptMap', '#aprsMap', '#potaMap', '#skyPlot', '#lookupMap']) bindCanvasHover($(id));

    $('#potaBandChips').addEventListener('click', e => {
      const b = e.target.closest('[data-band]');
      if (!b) return;
      pota.band = b.dataset.band;
      storeSet('hamdash.potaBand', pota.band || null);
      renderPota();
    });
    for (const id of ['potaMode', 'potaSort']) {
      const sel = $(`#${id}`);
      sel.value = storeGet(`hamdash.${id}`) || sel.options[0].value;
      sel.addEventListener('change', () => { storeSet(`hamdash.${id}`, sel.value); renderPota(); });
    }
    $('#potaRange').addEventListener('change', () => { storeSet(`hamdash.potaRange.${station().units}`, $('#potaRange').value); renderPota(); });
    $('#potaSearch').addEventListener('input', renderPota);

    $('#satTypeChips').addEventListener('click', e => {
      const b = e.target.closest('[data-type]');
      if (!b) return;
      sats.type = b.dataset.type;
      storeSet('hamdash.satType', sats.type || null);
      renderSats();
    });
    const satMinEl = $('#satMinEl');
    satMinEl.value = storeGet('hamdash.satMinEl') || '10';
    satMinEl.addEventListener('change', () => { storeSet('hamdash.satMinEl', satMinEl.value); renderSats(); });
    const pickPass = e => {
      const row = e.target.closest('tr[data-pass]');
      if (!row || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
      e.preventDefault();
      sats.selected = row.dataset.pass;
      renderSats();
    };
    $('#passTable').addEventListener('click', pickPass);
    $('#passTable').addEventListener('keydown', pickPass);

    $('#aprsCatChips').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (!b) return;
      aprs.cat = b.dataset.cat;
      storeSet('hamdash.aprsCat', aprs.cat || null);
      renderAprs();
    });
    const aprsSince = $('#aprsSince');
    aprsSince.value = storeGet('hamdash.aprsSince') || '60';
    aprsSince.addEventListener('change', () => { storeSet('hamdash.aprsSince', aprsSince.value); renderAprs(); });
    $('#aprsSearch').addEventListener('input', renderAprs);
    $('#aprsZoom').addEventListener('change', () => { storeSet(`hamdash.aprsZoom.${station().units}`, $('#aprsZoom').value); drawAprsMap(); });
    for (const id of ['aprsTracks', 'aprsLabels']) {
      const box = $(`#${id}`);
      box.checked = storeGet(`hamdash.${id}`) !== 'false';
      box.addEventListener('change', () => { storeSet(`hamdash.${id}`, String(box.checked)); drawAprsMap(); });
    }
    $('#aprsTable').addEventListener('mouseover', e => {
      const key = e.target.closest('tr[data-key]')?.dataset.key;
      if (key && key !== aprs.highlight) { aprs.highlight = key; drawAprsMap(); }
    });
    $('#aprsTable').addEventListener('mouseleave', () => { aprs.highlight = null; drawAprsMap(); });

    $('#viewTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-view]');
      if (b) showView(b.dataset.view);
    });
    window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
    // Any element with data-call (callsigns in tables, recent chips) opens a lookup.
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-call]');
      if (b) lookup(b.dataset.call);
    });
    $('#lookupForm').addEventListener('submit', e => { e.preventDefault(); lookup($('#lookupInput').value); });

    $('#rptBandChips').addEventListener('click', e => {
      const b = e.target.closest('[data-band]');
      if (!b) return;
      rpt.band = b.dataset.band;
      storeSet('hamdash.rptBand', rpt.band || null);
      renderRepeaters();
    });
    $('#rptRadius').addEventListener('change', () => { storeSet(`hamdash.rptRadius.${station().units}`, $('#rptRadius').value); loadRepeaters(); });
    const rptMode = $('#rptMode'), rptOnAir = $('#rptOnAir');
    rptMode.value = storeGet('hamdash.rptMode') || '';
    rptOnAir.checked = storeGet('hamdash.rptOnAir') !== 'false';
    rptMode.addEventListener('change', () => { storeSet('hamdash.rptMode', rptMode.value || null); renderRepeaters(); });
    rptOnAir.addEventListener('change', () => { storeSet('hamdash.rptOnAir', String(rptOnAir.checked)); renderRepeaters(); });
    $('#rptSearch').addEventListener('input', renderRepeaters);
    $('#rptTable').addEventListener('mouseover', e => {
      const id = e.target.closest('tr[data-id]')?.dataset.id;
      if (id && +id !== rpt.highlight) { rpt.highlight = +id; drawRepeaterMap(); }
    });
    $('#rptTable').addEventListener('mouseleave', () => { rpt.highlight = null; drawRepeaterMap(); });

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
      state.defaults = {
        callsign: cfg.callsign || '', grid: cfg.grid || '', distance_units: cfg.distance_units || 'mi',
        qrz: Boolean(cfg.qrz), spot_watch: cfg.spot_watch || [],
      };
    } catch (e) { console.warn(e); }
    renderHeader();
    renderPsk();
    fillRadiusOptions();
    fillPotaRanges();
    showView(location.hash.slice(1) || storeGet('hamdash.view') || 'weather');
    if (!station().callsign && !station().grid) openSettings();

    loadLand(); loadSolar(); loadIono(); loadSpots(); loadPsk(); loadCycle(); loadActivity(); loadStorm();
    setInterval(loadSolar, 5 * 60000);
    setInterval(loadIono, 10 * 60000);
    setInterval(loadSpots, 30000);
    setInterval(loadPsk, 5 * 60000);
    setInterval(loadCycle, 12 * 3600000);
    setInterval(loadActivity, 5 * 60000);
    setInterval(loadStorm, 60000);
    setInterval(() => { if (currentView === 'weather' && !$('#panel-grayline').hidden) drawGrayline(); renderBands(); }, 60000);

    // Redraw canvases and charts only when the width changes, not on every
    // content-height change.
    let rt, lastWidth = innerWidth;
    window.addEventListener('resize', () => {
      if (innerWidth === lastWidth) return;
      lastWidth = innerWidth;
      clearTimeout(rt);
      rt = setTimeout(redrawVisible, 150);
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      redrawVisible(); renderScales(); renderTiles();
    });
  }

  init();
})();
