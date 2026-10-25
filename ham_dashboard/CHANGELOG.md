# Changelog

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
