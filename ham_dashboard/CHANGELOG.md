# Changelog

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
