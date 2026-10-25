# Ham Radio Dashboard

A read-only propagation, space-weather and station-lookup dashboard for amateur radio
operators. It adds a **Ham Radio** panel to the Home Assistant sidebar, with three
tabs: **Space weather**, **Repeaters** and **Callsign lookup**.

## Space weather

- **Solar & geomagnetic conditions** – SFI, sunspot number, A and K index, X-ray flux,
  solar wind speed, Bz and estimated noise floor.
- **NOAA space weather scales** – current R (radio blackout), S (radiation) and G
  (geomagnetic) levels, yesterday's maximum and the 3-day probability forecast.
- **HF band conditions, 80 m – 6 m**
  - *HamQSL* day/night ratings by N0NBH.
  - *At your QTH now* – a local estimate that compares each band with the MUF(3000)
    measured by the nearest ionosonde (within 3000 km, last 3 hours), adjusted for
    daytime D-layer absorption on 80/60/40 m and for geomagnetic storms.
  - VHF: aurora and sporadic-E status.
- **Maps** – live gray line (day/night/twilight) with sunrise, sunset and gray-line
  times at your QTH, plus the KC2G MUF and foF2 maps.
- **Kp chart** – the past 4 days and the 3-day forecast.
- **Solar cycle** – monthly sunspot number since 2008 and the NOAA prediction.
- **DX cluster spots** – live telnet feed, filterable by band, mode and the
  spotter's continent.
- **Who's hearing you** – PSKReporter reception reports for your callsign, plotted
  on the gray line map.
- **NOAA alerts, watches and warnings** from the last 72 hours, plus the full 3-day
  forecast text.

## Repeaters

Repeaters near your grid square, from the community-maintained
[HearHam](https://hearham.com/) directory.

- A map centred on your QTH with range rings. Hover a dot for the repeaters at that
  site, and click it to jump to the row in the list.
- A list sorted by distance, with output frequency, offset (hover it for the input
  frequency), CTCSS tone or DMR color code, mode, linked network (AllStar, IRLP,
  EchoLink, DMR) and on-air status.
- Filters for band, mode, search radius, on-air only, and callsign/city search.
- Links to each repeater's HearHam and RepeaterBook pages.

The add-on downloads the HearHam directory at most once a day and keeps a copy in
its data folder, so the list keeps working across restarts and changing your grid
updates it instantly. Listings can be out of date, so confirm frequency and tone
before you transmit.

## Callsign lookup

Type a callsign, or click any callsign in the DX spots, PSKReporter or repeater
lists. The lookup shows name, address, grid, license class and dates, QSL methods,
the QRZ photo when there is one, and the distance, beam heading (short and long
path) and great-circle path from your QTH.

- **US callsigns** work with no setup, using FCC data from
  [callook.info](https://callook.info/).
- **Worldwide callsigns** need your QRZ.com login in the add-on options. A
  [QRZ XML Logbook Data subscription](https://www.qrz.com/page/xml_data.html) unlocks
  full details; without one, QRZ returns basic information only and US calls are
  filled in from FCC data.

Each callsign is cached for a day so repeated lookups don't hit QRZ again.

## Configuration

| Option | Description |
| --- | --- |
| `callsign` | Your callsign. Used to log in to the DX cluster and as the default for PSKReporter. |
| `grid` | Your Maidenhead grid square (4 or 6 characters, e.g. `DM14xd`). |
| `distance_units` | `mi` or `km`. |
| `dx_cluster_enabled` | Keep a telnet connection to a DX cluster for live spots. |
| `dx_cluster_host` / `dx_cluster_port` | The cluster to use. Default: `dxc.ve7cc.net:23`. |
| `qrz_username` / `qrz_password` | Optional. Your QRZ.com login, for worldwide callsign lookups. The password is only sent to QRZ and is never shown in the dashboard or logs. |

`callsign`, `grid` and `distance_units` are the defaults for everyone who opens the
panel. Each person can also click the callsign/grid chip at the top right and enter
their own. That choice is saved in their browser only, so several operators can
share one Home Assistant. The QRZ login is shared by everyone using the panel.

## Data sources

- [N0NBH / HamQSL](https://www.hamqsl.com/solar.html) solar XML (cached 30 min)
- [NOAA SWPC](https://www.swpc.noaa.gov/) JSON and text products (5–60 min)
- [KC2G](https://prop.kc2g.com/) ionosonde data and MUF/foF2 maps (10 min)
- [PSKReporter](https://pskreporter.info/) (cached 5 min per callsign, as they request)
- [HearHam](https://hearham.com/) repeater directory (downloaded at most once a day)
- [QRZ.com](https://www.qrz.com/) XML callbook and [callook.info](https://callook.info/)
  FCC data (cached a day per callsign, fetched only when you look a call up)
- DX cluster via telnet (live)

The add-on caches everything server-side, so opening the dashboard on several
devices doesn't multiply the requests to these free services.

## Notes

- The "At your QTH" rating is a rule-of-thumb estimate, not a VOACAP prediction.
  It is most useful when an ionosonde is reasonably close to you.
- The DX cluster requires a callsign to log in. Without one, the spots panel stays
  empty.
- RepeaterBook isn't used as a data source. Its API is limited to approved apps and
  excludes nearby-repeater finders, so the dashboard only links to its pages.
