# Changelog

## 0.8.0

- **Setup on first run**: pick licensed amateur, GMRS or just listening, then your
  callsign (if any), grid square (typed, from your device's location, or from your
  FCC license) and units, and which connections to use. It saves to the app's
  Configuration tab and restarts the app. It can be skipped and rerun from settings.
- **Guided tour**: a short, skippable walk through the tabs, shown once per browser
  and replayable from settings.
- **Station types**: new `station_type` option. GMRS users and listeners get APRS
  through a receive-only listener ID; the DX cluster and "who's hearing you" are
  amateur-only and say so instead of showing empty panels.
- **Hide tabs** per browser from settings.
- The HF band table now runs **160 m to 10 m**: 6 m (VHF) is replaced by 160 m. In
  Home Assistant, `sensor.ham_band_6m` and `sensor.ham_activity_6m` are replaced by
  `sensor.ham_band_160m` and `sensor.ham_activity_160m`; update any automations that
  used the 6 m sensors. 6 m stays in the DX spot, POTA and repeater band filters.
- Existing installs keep working as before (station type defaults to amateur) and
  see the tour once.

## 0.7.1

- Map markers are easy to click again: a click within about 15 pixels of a station
  or repeater counts, like before the switch to zoomable maps. Arrow and diamond
  markers have bigger click areas too.
- The APRS and POTA maps no longer refresh while your pointer is over them, so a
  marker can't disappear mid-click. They catch up as soon as the pointer leaves.
- Fix: the Repeaters and APRS maps could open zoomed all the way in to street
  level in a new browser tab.

## 0.7.0

- **Zoomable maps**: the gray line, Repeaters, APRS, POTA and Lookup maps can be
  zoomed and panned (scroll wheel after clicking the map, pinch on phones, or the
  + and − buttons). A ⌂ button resets the view.
- **Map layers**: pick Dark, Streets, Satellite (US), Topo (US) or Plain on each
  map; the choice is remembered per map. Day/night shading is an overlay you can
  turn off, and now lines up exactly at every zoom.
- The APRS "Show within" picker is replaced by real zoom.
- Maps use Leaflet 1.9.4 (BSD license, included), OpenStreetMap tiles and USGS
  National Map imagery.

## 0.6.0

- **MQTT entities**: when the Mosquitto broker app is installed, the sensors are
  registered through MQTT discovery under one **Ham Radio** device. They can be
  renamed, assigned to areas and hidden, keep their values across Home Assistant
  restarts, and show as unavailable when the add-on stops. Broker settings come
  from Supervisor automatically. Without Mosquitto, the REST API is used as before.
  Switching clears the old entities so entity IDs stay the same. New `ha_mqtt`
  option (on by default).
- The add-on now backs off for 15 minutes when a data source answers "too many
  requests" (HTTP 429), instead of retrying every minute.
- Build: the base image is now set in the Dockerfile and `build.yaml` is gone,
  as Supervisor 2026.04 and later require.

## 0.5.0

- **Measured band activity**: the band table has a new "Heard nearby" column
  showing how many stations PSKReporter monitors within about 500 miles decoded
  on each band in the last 15 minutes, how many were DX, and the farthest. Also
  published as `sensor.ham_activity_80m` … `sensor.ham_activity_6m`.
- **Station storm safety**: Safe / Caution / Danger from National Weather Service
  alerts and hourly forecast, plus an optional lightning sensor already in Home
  Assistant (Ecowitt, Ambient, ESPHome AS3935). Danger shows a banner on every
  tab, turns on `binary_sensor.ham_lightning_danger` and fires
  `ham_dashboard_storm_danger`, so an automation can disconnect your antennas.
- New `nws_alerts`, `lightning_entity` and `lightning_alert_distance` options.

## 0.4.1

- Fix: Home Assistant sensors and alerts didn't start. The add-on now finds its
  Supervisor token in s6-overlay's saved container environment, where the base
  image keeps it, instead of only looking in its own environment.

## 0.4.0

- **Home Assistant sensors**: solar and geomagnetic indices, NOAA R/S/G scales,
  storm and blackout binary sensors, local MUF, per-band conditions (80 m to 6 m),
  next satellite passes and nearby POTA activations, as `sensor.ham_*` and
  `binary_sensor.ham_*` entities.
- **Alerts**: `ham_dashboard_dx_spot` events for callsigns on your new `spot_watch`
  list, and `ham_dashboard_pota_spot` events for activations within the new
  `pota_alert_radius`. Watched callsigns are highlighted in the DX spots table.
- New **POTA** tab: activators on the air on a world map and in a filterable list.
- New **Satellites** tab: 24-hour pass predictions for ISS, SO-50, PO-101, AO-91,
  RS-44, FO-29 and AO-7, with a sky plot and Doppler-corrected frequencies.
- The band estimate now lives in one shared module used by both the dashboard and
  the Home Assistant sensors, so they always agree.
- On phones the tab bar scrolls sideways and keeps the active tab in view.

## 0.3.0

- New **APRS** tab: live stations around you from APRS-IS (receive-only), on a
  range-ring map with tracks and headings, plus a filterable list of stations heard
  and a panel of local weather stations. Each station links to aprs.fi.
- New `aprs_enabled` and `aprs_radius` options.

## 0.2.0

- New **Repeaters** tab: repeaters near your grid square from the HearHam directory,
  with a range-ring map, distance and direction, tone, offset, mode, linked network,
  on-air status, and band, mode, radius and search filters.
- New **Callsign lookup** tab: QRZ.com lookups with your own QRZ login, plus free
  FCC data from callook.info for US calls. Shows license details, QSL info, the QRZ
  photo, and the beam heading, distance and great-circle path from your QTH.
- Callsigns in DX spots, PSKReporter reports and the repeater list are clickable
  and open a lookup.
- New optional `qrz_username` and `qrz_password` options.
- The top-level tabs are linkable (`#weather`, `#repeaters`, `#lookup`) and the last
  one you used is remembered.
- Phone layout: the header no longer sticks to the top, and tables drop secondary
  columns to fit the screen.

## 0.1.0

- First release: solar and geomagnetic tiles, NOAA R/S/G scales and forecast,
  HF band conditions (HamQSL plus a local ionosonde estimate), gray line, MUF and
  foF2 maps, Kp and solar cycle charts, DX cluster spots, PSKReporter
  "who's hearing me", and NOAA alerts.
