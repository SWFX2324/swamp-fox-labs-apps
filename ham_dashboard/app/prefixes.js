'use strict';
// Approximate location for a callsign from its prefix, for paths to stations
// that QRZ/FCC lookups can't place. Covers the common DXCC entities; big
// countries are split by call-area digit. Positions are rough (a country or
// call-area center), which is plenty for propagation.

// [name, lat, lon, prefixes, { digit: [lat, lon, area] }]
const ENTITIES = [
  ['United States', 39, -98, 'K W N AA AB AC AD AE AF AG AI AJ AK', {
    1: [42.8, -71.8, 'New England'], 2: [41.3, -74.5, 'NY/NJ'], 3: [40.2, -77, 'PA/MD/DE'], 4: [34, -83, 'Southeast'],
    5: [32.5, -97, 'South central'], 6: [37, -120, 'California'], 7: [43.5, -114, 'Northwest'], 8: [40.5, -82.5, 'OH/MI/WV'],
    9: [41.5, -88, 'IL/IN/WI'], 0: [41.5, -97, 'Plains'],
  }],
  ['Alaska', 62, -150, 'KL7 AL7 NL7 WL7 KL AL NL WL'],
  ['Hawaii', 20.8, -156.5, 'KH6 AH6 NH6 WH6 KH7'],
  ['Puerto Rico', 18.2, -66.5, 'KP4 NP4 WP4 KP3 NP3 WP3'],
  ['US Virgin Islands', 18.3, -64.8, 'KP2 NP2 WP2'],
  ['Guam', 13.4, 144.8, 'KH2 AH2 NH2 WH2'],
  ['Canada', 52, -95, 'VE VA VO VY CY CF CG CJ CK XL XM XN XO', {
    1: [45, -63.5, 'Nova Scotia'], 2: [47, -72, 'Quebec'], 3: [44.5, -79.5, 'Ontario'], 4: [50, -97, 'Manitoba'],
    5: [52, -106, 'Saskatchewan'], 6: [52.5, -113.5, 'Alberta'], 7: [49.5, -123, 'British Columbia'], 8: [62.5, -114, 'Northwest Territories'],
    9: [46, -66, 'New Brunswick'],
  }],
  ['Newfoundland', 48.5, -56, 'VO1 VO2'],
  ['Mexico', 23, -102, 'XE XF XA XB XC XD XG XH XI 4A 4B 4C 6D 6E 6F 6G 6H 6I 6J'],
  ['Guatemala', 15.5, -90.3, 'TG TD'], ['El Salvador', 13.7, -89, 'YS HU'], ['Honduras', 14.8, -86.8, 'HR HQ'],
  ['Nicaragua', 12.9, -85.2, 'YN H6 H7 HT'], ['Costa Rica', 9.9, -84, 'TI TE'], ['Panama', 8.8, -80, 'HP HO H3 H8 H9 3E 3F'],
  ['Cuba', 22, -79.5, 'CO CM CL T4'], ['Dominican Republic', 18.8, -70.5, 'HI'], ['Haiti', 19, -72.5, 'HH 4V'],
  ['Jamaica', 18.1, -77.3, '6Y'], ['Bahamas', 24.5, -77.5, 'C6'], ['Bermuda', 32.3, -64.8, 'VP9'],
  ['Cayman Islands', 19.3, -81.3, 'ZF'], ['Barbados', 13.2, -59.5, '8P'], ['Trinidad & Tobago', 10.5, -61.3, '9Y 9Z'],
  ['Leeward Islands', 17.5, -62.5, 'VP2 V4 J6 J7 J8 V2'], ['Curacao', 12.2, -69, 'PJ2'], ['Aruba', 12.5, -70, 'P4'], ['Bonaire', 12.2, -68.3, 'PJ4'],
  ['Martinique', 14.6, -61, 'FM'], ['Guadeloupe', 16.2, -61.6, 'FG'], ['Greenland', 66, -45, 'OX XP'],
  ['Brazil', -12, -50, 'PP PQ PR PS PT PU PV PW PX PY ZV ZW ZX ZY ZZ', {
    1: [-22.5, -43.5, 'RJ/ES'], 2: [-23, -47, 'Sao Paulo'], 3: [-30, -52, 'Rio Grande do Sul'], 4: [-19, -44, 'Minas Gerais'],
    5: [-26, -50, 'PR/SC'], 6: [-12.5, -39, 'Bahia'], 7: [-7, -37, 'Northeast'], 8: [-3, -60, 'North'], 9: [-16, -52, 'Center-west'],
  }],
  ['Argentina', -34, -64, 'LU LO LP LQ LR LS LT LV LW AY AZ L2 L3 L4 L5 L6 L7 L8 L9'],
  ['Chile', -33.5, -70.7, 'CE CA CB CC CD XQ XR 3G'], ['Uruguay', -33, -56, 'CX CV CW'], ['Paraguay', -23.5, -58, 'ZP'],
  ['Peru', -10, -76, 'OA OB OC 4T'], ['Ecuador', -1.5, -78.5, 'HC HD'], ['Galapagos', -0.7, -90.5, 'HC8 HD8'],
  ['Colombia', 4.5, -74, 'HK HJ 5J 5K'], ['Venezuela', 8, -66, 'YV YW YX YY 4M'], ['Bolivia', -16.5, -65, 'CP'],
  ['Guyana', 5, -59, '8R'], ['Suriname', 4, -56, 'PZ'], ['French Guiana', 4, -53, 'FY'], ['Falkland Islands', -51.7, -59, 'VP8'],
  ['England', 52.5, -1.5, 'G M 2E 2M 2W'], ['Scotland', 56.8, -4.2, 'GM MM 2M GS'], ['Wales', 52.3, -3.7, 'GW MW 2W'],
  ['Northern Ireland', 54.6, -6.7, 'GI MI 2I'], ['Ireland', 53.3, -8, 'EI EJ'], ['Isle of Man', 54.2, -4.5, 'GD MD'],
  ['Jersey', 49.2, -2.1, 'GJ MJ'], ['Guernsey', 49.5, -2.6, 'GU MU'],
  ['France', 46.5, 2.5, 'F TM TO TP TQ TV'], ['Germany', 51, 10, 'DL DA DB DC DD DE DF DG DH DI DJ DK DM DN DO DP DQ DR'],
  ['Netherlands', 52.2, 5.5, 'PA PB PC PD PE PF PG PH PI'], ['Belgium', 50.7, 4.5, 'ON OO OP OQ OR OS OT'],
  ['Luxembourg', 49.7, 6.1, 'LX'], ['Switzerland', 46.8, 8.2, 'HB HE'], ['Liechtenstein', 47.1, 9.5, 'HB0'],
  ['Austria', 47.5, 14.5, 'OE'], ['Italy', 42.5, 12.5, 'I IA IB IC ID IE IF IG IH II IJ IK IL IM IN IO IP IQ IR IS IT IU IV IW IX IY IZ'],
  ['Sardinia', 40, 9, 'IS0 IM0 IW0U'], ['Sicily', 37.5, 14, 'IT9 IW9 IG9'], ['Spain', 40, -3.7, 'EA EB EC ED EE EF EG EH AM AN AO'],
  ['Balearic Islands', 39.5, 2.9, 'EA6 EB6 EC6 ED6'], ['Canary Islands', 28.3, -16, 'EA8 EB8 EC8 ED8'],
  ['Portugal', 39.5, -8, 'CT CQ CR CS'], ['Madeira', 32.7, -17, 'CT3 CQ3 CR3'], ['Azores', 38.5, -28, 'CU CT8'],
  ['Andorra', 42.5, 1.5, 'C3'], ['Monaco', 43.7, 7.4, '3A'], ['Malta', 35.9, 14.4, '9H'], ['San Marino', 43.9, 12.4, 'T7'],
  ['Vatican', 41.9, 12.45, 'HV'], ['Denmark', 56, 10, 'OZ OU OV 5P 5Q'], ['Faroe Islands', 62, -7, 'OY'],
  ['Norway', 61, 9, 'LA LB LC LD LE LF LG LH LI LJ LK LL LM LN'], ['Svalbard', 78.2, 15.6, 'JW'],
  ['Sweden', 60, 15, 'SM SA SB SC SD SE SF SG SH SI SJ SK SL 7S 8S'], ['Finland', 62.5, 25.5, 'OH OF OG OI'],
  ['Aland Islands', 60.2, 20, 'OH0 OF0 OG0'], ['Iceland', 64.9, -18.5, 'TF'],
  ['Estonia', 58.7, 25.5, 'ES'], ['Latvia', 56.9, 24.5, 'YL'], ['Lithuania', 55.3, 24, 'LY'],
  ['Poland', 52, 19.5, 'SP SN SO SQ SR 3Z HF'], ['Czech Republic', 49.8, 15.5, 'OK OL'], ['Slovakia', 48.7, 19.5, 'OM'],
  ['Hungary', 47.2, 19.5, 'HA HG'], ['Slovenia', 46.1, 14.8, 'S5'], ['Croatia', 45.2, 15.5, '9A'],
  ['Bosnia-Herzegovina', 44, 17.8, 'E7'], ['Serbia', 44, 20.8, 'YU YT'], ['Montenegro', 42.7, 19.3, '4O'],
  ['North Macedonia', 41.6, 21.7, 'Z3'], ['Albania', 41, 20, 'ZA'], ['Kosovo', 42.6, 20.9, 'Z6'],
  ['Greece', 39, 22, 'SV SW SX SY SZ J4'], ['Crete', 35.2, 24.9, 'SV9 SW9 SX9 J49'], ['Bulgaria', 42.7, 25.3, 'LZ'],
  ['Romania', 45.9, 25, 'YO YP YQ YR'], ['Moldova', 47.2, 28.5, 'ER'], ['Ukraine', 49, 31.5, 'UR US UT UU UV UW UX UY UZ EM EN EO'],
  ['Belarus', 53.7, 28, 'EU EV EW'], ['Cyprus', 35, 33.2, '5B C4 H2 P3'], ['Turkey', 39, 35, 'TA TB TC YM'],
  ['Russia', 56, 40, 'R U RA RK RN RU RV RW RX RZ UA UB UC UD UE UF UG UH UI', {
    1: [59.9, 30.3, 'Northwest'], 2: [54.7, 20.5, 'Kaliningrad'], 3: [55.8, 37.6, 'Moscow'], 4: [53.2, 50.2, 'Volga'],
    6: [45, 40, 'South'], 7: [45, 40, 'South'], 8: [55, 73, 'Siberia'], 9: [55, 73, 'Siberia'], 0: [56, 125, 'Far East'],
  }],
  ['Georgia', 42.2, 43.5, '4L'], ['Armenia', 40.2, 44.8, 'EK'], ['Azerbaijan', 40.4, 49, '4J 4K'],
  ['Kazakhstan', 48, 67, 'UN UO UP UQ'], ['Uzbekistan', 41.3, 64.5, 'UK'], ['Kyrgyzstan', 41.5, 74.5, 'EX'],
  ['Tajikistan', 38.6, 69.5, 'EY'], ['Turkmenistan', 39, 59.5, 'EZ'],
  ['Israel', 31.5, 34.9, '4X 4Z'], ['Jordan', 31.3, 36.5, 'JY'], ['Lebanon', 33.9, 35.8, 'OD'], ['Syria', 35, 38.5, 'YK'],
  ['Iraq', 33, 44, 'YI'], ['Iran', 32.5, 53.5, 'EP EQ'], ['Kuwait', 29.3, 47.7, '9K'], ['Saudi Arabia', 24, 45, 'HZ 7Z 8Z'],
  ['Bahrain', 26, 50.5, 'A9'], ['Qatar', 25.3, 51.2, 'A7'], ['United Arab Emirates', 24.3, 54.4, 'A6'], ['Oman', 21, 57, 'A4'],
  ['Yemen', 15.5, 47.5, '7O'], ['Afghanistan', 34, 66, 'YA T6'], ['Pakistan', 30, 70, 'AP AS'],
  ['India', 22, 79, 'VU AT AU AV AW 8T 8U 8V 8W 8X 8Y'], ['Sri Lanka', 7.8, 80.7, '4S'], ['Bangladesh', 23.8, 90.3, 'S2'],
  ['Nepal', 28, 84, '9N'], ['Bhutan', 27.5, 90.4, 'A5'], ['Maldives', 3.2, 73.2, '8Q'],
  ['China', 34, 108, 'BY BA BD BG BH BI BJ BL BM BN BO BP BQ BR BS BT BZ 3H 3I 3J 3K 3L 3M 3N 3O 3P 3Q 3R 3S 3T 3U XS'],
  ['Taiwan', 23.7, 121, 'BV BU BW BX BM'], ['Hong Kong', 22.3, 114.2, 'VR2'], ['Macao', 22.2, 113.55, 'XX9'],
  ['Mongolia', 47, 104, 'JT JU JV'], ['South Korea', 36.5, 127.8, 'HL DS DT 6K 6L 6M 6N D7 D8 D9'], ['North Korea', 40, 127, 'P5'],
  ['Japan', 36, 138, 'JA JE JF JG JH JI JJ JK JL JM JN JO JP JQ JR JS 7J 7K 7L 7M 7N 8J 8N', {
    1: [35.7, 139.7, 'Kanto'], 2: [35, 137, 'Tokai'], 3: [34.7, 135.5, 'Kansai'], 4: [34.5, 133, 'Chugoku'], 5: [33.7, 133.5, 'Shikoku'],
    6: [32.5, 130.8, 'Kyushu'], 7: [39, 140.5, 'Tohoku'], 8: [43.2, 142.5, 'Hokkaido'], 9: [36.5, 136.7, 'Hokuriku'], 0: [36.6, 138.2, 'Shinetsu'],
  }],
  ['Philippines', 12.5, 122, 'DU DV DW DX DY DZ 4D 4E 4F 4G 4H 4I'], ['Vietnam', 16, 107, 'XV 3W'], ['Laos', 18.5, 103, 'XW'],
  ['Cambodia', 12.5, 105, 'XU'], ['Thailand', 15, 101, 'HS E2'], ['Myanmar', 21, 96, 'XZ XY'],
  ['West Malaysia', 4, 102, '9M2 9M4 9W2 9W4'], ['East Malaysia', 3, 114, '9M6 9M8 9W6 9W8'], ['Singapore', 1.35, 103.8, '9V S6'],
  ['Brunei', 4.5, 114.7, 'V8'], ['Indonesia', -2.5, 118, 'YB YC YD YE YF YG YH 7A 7B 7C 7D 7E 7F 7G 7H 7I 8A 8B 8C 8D 8E 8F 8G 8H 8I'],
  ['Timor-Leste', -8.8, 125.7, '4W'],
  ['Australia', -25, 134, 'VK AX VH VI VJ VL VM VN VZ', {
    1: [-35.3, 149.1, 'ACT'], 2: [-33, 147, 'New South Wales'], 3: [-37.5, 144.5, 'Victoria'], 4: [-22, 145, 'Queensland'],
    5: [-32, 136.5, 'South Australia'], 6: [-30, 118, 'Western Australia'], 7: [-42, 146.5, 'Tasmania'], 8: [-16, 133, 'Northern Territory'],
  }],
  ['New Zealand', -41, 174, 'ZL ZK ZM'], ['Papua New Guinea', -6.5, 145, 'P2'], ['Fiji', -17.8, 178, '3D2'],
  ['New Caledonia', -21.3, 165.5, 'FK'], ['French Polynesia', -17.6, -149.4, 'FO'], ['Samoa', -13.8, -172, '5W'],
  ['American Samoa', -14.3, -170.7, 'KH8 AH8 NH8 WH8'], ['Tonga', -21.2, -175.2, 'A3'], ['Vanuatu', -16, 167.5, 'YJ'],
  ['Solomon Islands', -9.4, 160, 'H4'], ['Kiribati', 1.4, 173, 'T30'], ['Marshall Islands', 7.1, 171.4, 'V7'],
  ['Micronesia', 6.9, 158.2, 'V6'], ['Palau', 7.5, 134.6, 'T8'], ['Northern Mariana Islands', 15.2, 145.75, 'KH0 AH0 NH0 WH0'],
  ['Cook Islands', -21.2, -159.8, 'E5'],
  ['Egypt', 27, 30, 'SU SS 6A 6B'], ['Libya', 27, 17, '5A'], ['Tunisia', 34, 9.5, '3V TS'], ['Algeria', 28, 3, '7X 7R 7T 7U 7V 7W 7Y'],
  ['Morocco', 32, -6, 'CN 5C 5D 5E 5F 5G'], ['Western Sahara', 24.5, -13, 'S0'], ['Mauritania', 20, -10.5, '5T'],
  ['Senegal', 14.5, -14.5, '6W 6V'], ['Gambia', 13.4, -16, 'C5'], ['Guinea', 10.5, -10.5, '3X'], ['Sierra Leone', 8.5, -11.8, '9L'],
  ['Liberia', 6.5, -9.5, 'EL 5L 5M 6Z A8 D5'], ['Cote d’Ivoire', 7.5, -5.5, 'TU'], ['Ghana', 7.9, -1, '9G'], ['Togo', 8.6, 1, '5V'],
  ['Benin', 9.3, 2.3, 'TY'], ['Nigeria', 9, 8, '5N 5O'], ['Cameroon', 5.5, 12.5, 'TJ'], ['Mali', 17, -4, 'TZ'],
  ['Burkina Faso', 12.3, -1.6, 'XT'], ['Niger', 17, 9, '5U'], ['Chad', 15, 19, 'TT'], ['Sudan', 15.5, 30, 'ST 6T 6U'],
  ['South Sudan', 7.5, 30, 'Z8'], ['Ethiopia', 9, 39.5, 'ET 9E 9F'], ['Eritrea', 15.3, 39, 'E3'], ['Djibouti', 11.6, 43, 'J2'],
  ['Somalia', 5, 46, 'T5 6O'], ['Kenya', 0.2, 37.9, '5Z 5Y'], ['Uganda', 1.4, 32.3, '5X'], ['Tanzania', -6.4, 35, '5H 5I'],
  ['Rwanda', -2, 30, '9X'], ['Burundi', -3.4, 29.9, '9U'], ['DR Congo', -2.9, 23.6, '9Q 9R 9S 9O 9P 9T'], ['Congo', -0.7, 15.5, 'TN'],
  ['Gabon', -0.8, 11.6, 'TR'], ['Equatorial Guinea', 1.6, 10.3, '3C'], ['Central African Republic', 6.6, 20.9, 'TL'],
  ['Angola', -12.3, 17.5, 'D2 D3'], ['Zambia', -13.5, 27.8, '9J 9I'], ['Malawi', -13.5, 34, '7Q'], ['Mozambique', -18, 35.5, 'C9 C8'],
  ['Zimbabwe', -19, 29.8, 'Z2'], ['Botswana', -22.3, 24.7, 'A2 8O'], ['Namibia', -22.5, 17.5, 'V5'],
  ['South Africa', -29, 25, 'ZS ZR ZT ZU S8'], ['Lesotho', -29.6, 28.2, '7P'], ['Eswatini', -26.5, 31.5, '3DA'],
  ['Madagascar', -19, 46.7, '5R 5S 6X'], ['Mauritius', -20.3, 57.6, '3B8'], ['Reunion', -21.1, 55.5, 'FR'],
  ['Seychelles', -4.6, 55.5, 'S7'], ['Comoros', -11.8, 43.3, 'D6'], ['Cape Verde', 15.1, -23.6, 'D4'],
  ['Sao Tome & Principe', 0.3, 6.7, 'S9'], ['Ascension Island', -7.95, -14.4, 'ZD8'], ['St Helena', -15.95, -5.7, 'ZD7'],
  ['Antarctica', -75, 0, 'KC4 VP8 DP0 RI1 CE9 LU1Z 8J1R'],
];

const MAP = new Map();
for (const [name, lat, lon, prefixes, areas] of ENTITIES) {
  for (const p of prefixes.split(' ')) if (!MAP.has(p)) MAP.set(p, { name, lat, lon, areas });
}

// The part of a callsign that carries the prefix: "KH6/K1ABC" -> "KH6",
// "K1ABC/P" -> "K1ABC", "VE3/G4XYZ" -> "VE3".
function baseCall(call) {
  const parts = String(call).toUpperCase().replace(/-.*$/, '').split('/')
    .filter(p => p && !/^(P|M|MM|AM|QRP|A|\d+)$/.test(p));
  if (!parts.length) return String(call).toUpperCase();
  return parts.reduce((a, b) => (b.length < a.length ? b : a));
}

// Longest-prefix match. Returns { name, area, lat, lon, approximate: true } or null.
function locate(call) {
  const c = baseCall(call);
  for (let n = Math.min(4, c.length); n > 0; n--) {
    const e = MAP.get(c.slice(0, n));
    if (!e) continue;
    // Call area: the first digit after the prefix letters.
    const digit = c.slice(n - 1).match(/\d/)?.[0] ?? c.match(/\d/)?.[0];
    const area = e.areas && digit != null ? e.areas[digit] : null;
    return area
      ? { name: e.name, area: area[2], lat: area[0], lon: area[1], approximate: true }
      : { name: e.name, area: null, lat: e.lat, lon: e.lon, approximate: true };
  }
  return null;
}

module.exports = { ENTITIES, baseCall, locate };
