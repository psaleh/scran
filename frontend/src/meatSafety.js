/**
 * USDA FSIS Appendix A — Salmonella lethality time/temperature data, plus the
 * fat-content reference used to pick a sensible fat% for a given cut.
 *
 * Source: US FSIS "Cooking Guideline for Ready-to-Eat Meat & Poultry Products
 * (Appendix A)", as structured by the CFIA.
 *   - beef            → non-poultry meat, 6.5-log reduction. Rows: [tempC, seconds]
 *   - chicken/turkey  → poultry, 7-log reduction. Rows: [tempC, [12 fat% columns]]
 *                       Fat columns are 1%…12% (index 0 = 1% fat).
 *
 * This module is pure data + maths — no React, no DOM. The UI lives in
 * pages/MeatTempsPage.jsx and components/HoldTimeChart.jsx.
 */

export const LETHALITY_DATA = {
  beef: [[54.4,6720],[55,5340],[55.6,4260],[56.1,3360],[56.7,2700],[57.2,2160],[57.8,1680],[58.4,1380],[58.9,1080],[59.5,900],[60,720],[60.6,540],[61.1,480],[61.7,360],[62.2,300],[62.8,240],[63.3,169],[63.9,134],[64.4,107],[65,85],[65.6,67],[66.1,54],[66.7,43],[67.2,34],[67.8,27],[68.3,22],[68.9,17],[69.4,14],[70,9],[70.6,9],[71.1,9]],
  chicken: [[57.8,[3798,3870,3942,4020,4104,4194,4284,4380,4488,4602,4734,4884]],[58.3,[3006,3060,3126,3192,3258,3330,3408,3492,3582,3684,3798,3930]],[58.9,[2382,2430,2478,2532,2592,2652,2718,2784,2862,2952,3054,3174]],[59.4,[1896,1932,1974,2016,2064,2112,2172,2232,2298,2376,2466,2580]],[60,[1512,1542,1572,1608,1650,1692,1740,1788,1848,1920,2004,2100]],[60.6,[1206,1230,1260,1290,1320,1356,1392,1440,1494,1554,1626,1722]],[61.1,[966,984,1008,1032,1056,1086,1122,1164,1206,1260,1326,1410]],[61.7,[780,792,810,828,852,876,906,936,978,1026,1086,1158]],[62.2,[624,636,648,666,684,708,732,756,792,834,888,954]],[62.8,[504,516,522,534,552,570,588,612,642,678,726,780]],[63.3,[408,414,420,432,444,456,474,492,516,546,588,636]],[63.9,[330,330,336,342,354,366,378,396,414,444,474,516]],[64.4,[264,264,270,270,282,288,300,312,330,348,378,408]],[65,[210,210,210,216,216,228,234,246,258,276,294,324]],[65.6,[162,162,162,162,168,174,180,186,198,210,228,252]],[66.1,[126,120,120,126,126,126,132,138,150,156,174,186]],[66.7,[90,90,90,96,96,96,102,102,108,114,126,138]],[67.2,[72,72,72,72,78,78,78,78,84,84,84,96]],[67.8,[55.9,56.9,58,59.1,60,60,60,66,66,66,66,66]],[68.3,[44.2,45,45.9,46.8,47.7,48.6,49.5,50.4,51.4,52.4,53.4,54.4]],[68.9,[35,35.6,36.3,37,37.7,38.4,39.2,39.9,40.7,41.4,42.2,43]],[69.4,[27.7,28.2,28.7,29.3,29.8,30.4,31,31.6,32.2,32.8,33.4,34]],[70,[21.9,22.3,22.7,23.2,23.6,24,24.5,25,25.4,25.9,26.4,26.9]],[70.6,[17.3,17.6,18,18.3,18.7,19,19.4,19.8,20.1,20.5,20.9,21.3]],[71.1,[13.7,14,14.2,14.5,14.8,15,15.3,15.6,15.9,16.2,16.5,16.9]],[71.7,[10.8,11,11.2,11.5,11.7,11.9,12.1,12.4,12.6,12.8,13.1,13.3]],[72.2,[9,9,9,9,9,9,9.6,9.8,10,10.2,10.3,10.5]],[72.8,[9,9,9,9,9,9,9,9,9,9,9,9]],[73.3,[9,9,9,9,9,9,9,9,9,9,9,9]]],
  turkey: [[57.8,[3840,3858,3876,3894,3918,3948,3978,4014,4056,4104,4170,4248]],[58.4,[3114,3132,3144,3168,3192,3216,3246,3282,3318,3372,3432,3510]],[58.9,[2532,2550,2562,2580,2604,2628,2652,2688,2724,2772,2832,2910]],[59.5,[2064,2076,2094,2106,2124,2148,2172,2202,2238,2286,2346,2424]],[60,[1686,1698,1710,1722,1740,1758,1782,1812,1848,1890,1950,2022]],[60.6,[1380,1392,1398,1410,1428,1446,1464,1494,1530,1572,1626,1692]],[61.1,[1134,1140,1146,1158,1170,1188,1206,1230,1266,1302,1356,1422]],[61.7,[930,936,942,954,966,978,996,1020,1044,1080,1128,1188]],[62.2,[768,768,774,780,792,804,822,840,864,900,942,996]],[62.8,[630,636,636,642,648,660,678,690,714,744,780,828]],[63.3,[522,522,522,528,534,540,552,570,588,612,648,690]],[63.9,[426,426,426,432,438,444,450,462,480,504,528,564]],[64.4,[348,348,348,348,354,360,366,378,390,408,432,462]],[65,[282,282,282,282,282,288,294,300,312,324,348,372]],[65.6,[228,222,222,222,222,228,234,240,246,258,270,294]],[66.1,[180,174,174,174,174,174,180,186,192,198,210,228]],[66.7,[138,138,138,138,138,138,138,138,144,150,162,168]],[67.2,[108,108,114,114,114,114,114,114,114,114,114,126]],[67.8,[90,90,90,90,90,90,90,90,90,96,96,96]],[68.3,[72,72,72,72,72,72,72,78,78,78,78,78]],[68.9,[59,59.3,59.5,59.8,60,60,60,60,60,60,60,60]],[69.4,[47.9,48.1,48.3,48.5,48.8,49,49.2,49.5,49.7,49.9,50.2,50.4]],[70,[38.8,39,39.2,39.4,39.6,39.8,40,40.1,40.3,40.5,40.7,40.9]],[70.6,[31.5,31.7,31.8,32,32.1,32.3,32.4,32.6,32.7,32.9,33,33.2]],[71.1,[25.6,25.7,25.8,26,26.1,26.2,26.3,26.4,26.6,26.7,26.8,26.9]],[71.7,[20.8,20.9,21,21.1,21.2,21.3,21.4,21.5,21.6,21.7,21.8,21.9]],[72.3,[16.9,16.9,17,17.1,17.2,17.3,17.3,17.4,17.5,17.6,17.7,17.7]],[72.8,[13.7,13.7,13.8,13.9,13.9,14,14.1,14.1,14.2,14.3,14.3,14.4]],[73.3,[11.1,11.2,11.2,11.3,11.3,11.4,11.4,11.5,11.5,11.6,11.6,11.7]],[73.9,[9,9,9,9,9,9,9,9,9,9,9,9]]],
}

/** Seconds. The source tables show "<10 s" for the top rows — treat as instant. */
export const INSTANT_FLOOR = 9

/** The poultry tables only have columns for 1%…12% fat. */
export const FAT_MIN = 1
export const FAT_MAX = 12

/**
 * The three datasets. `colorToken` is an Astryx token name resolved at render
 * time via useTheme (the matcha palette is muted, so `dash` carries identity as
 * well as hue — see the comment in HoldTimeChart).
 */
export const MEATS = [
  { id: 'chicken', label: 'Chicken', sub: '7-log', poultry: true, colorToken: '--color-icon-blue', dash: null },
  { id: 'turkey', label: 'Turkey', sub: '7-log', poultry: true, colorToken: '--color-icon-pink', dash: '2 4' },
  { id: 'beef', label: 'Beef & pork', sub: '6.5-log', poultry: false, colorToken: '--color-icon-orange', dash: '8 4' },
]

export const meatById = (id) => MEATS.find((m) => m.id === id) ?? MEATS[0]

/**
 * Typical fat content of raw cuts, as trimmed for sale. Ranges are approximate
 * (breed, feed and butchery all move them) and exist to turn the abstract fat%
 * slider into a concrete choice — they are not a nutrition table.
 *
 * Beef/pork rows are reference only: FSIS uses a single 6.5-log table for
 * non-poultry meat, so fat does not change its hold time.
 */
export const FAT_BY_CUT = {
  chicken: [
    { cut: 'Breast, skinless', min: 1, max: 3 },
    { cut: 'Breast, skin-on', min: 6, max: 11 },
    { cut: 'Thigh, skinless', min: 4, max: 8 },
    { cut: 'Thigh, skin-on', min: 12, max: 18 },
    { cut: 'Drumstick, skinless', min: 3, max: 6 },
    { cut: 'Drumstick, skin-on', min: 9, max: 13 },
    { cut: 'Wings, skin-on', min: 14, max: 20 },
    { cut: 'Whole bird, skin-on', min: 9, max: 15 },
    { cut: 'Mince', min: 8, max: 12 },
  ],
  turkey: [
    { cut: 'Breast, skinless', min: 1, max: 2 },
    { cut: 'Breast, skin-on', min: 4, max: 8 },
    { cut: 'Thigh, skinless', min: 4, max: 7 },
    { cut: 'Thigh, skin-on', min: 8, max: 12 },
    { cut: 'Drumstick, skin-on', min: 8, max: 12 },
    { cut: 'Wings, skin-on', min: 10, max: 14 },
    { cut: 'Whole bird, skin-on', min: 7, max: 12 },
    { cut: 'Mince, lean (93/7)', min: 6, max: 8 },
    { cut: 'Mince, standard (85/15)', min: 13, max: 17 },
  ],
  beef: [
    { cut: 'Beef fillet', min: 3, max: 8 },
    { cut: 'Beef sirloin / rump', min: 5, max: 10 },
    { cut: 'Beef ribeye', min: 12, max: 20 },
    { cut: 'Beef brisket', min: 15, max: 25 },
    { cut: 'Beef chuck / braising', min: 12, max: 20 },
    { cut: 'Beef mince, lean', min: 4, max: 6 },
    { cut: 'Beef mince, standard', min: 15, max: 20 },
    { cut: 'Pork tenderloin', min: 2, max: 5 },
    { cut: 'Pork loin chop', min: 5, max: 10 },
    { cut: 'Pork shoulder', min: 12, max: 20 },
    { cut: 'Pork belly', min: 30, max: 45 },
    { cut: 'Pork mince', min: 10, max: 20 },
  ],
}

/**
 * Clamp a real-world fat% onto the 1–12% columns the tables actually have.
 * Fattier cuts land on the 12% column, which is the slowest (safest) one.
 */
export const clampFat = (pct) => Math.min(FAT_MAX, Math.max(FAT_MIN, Math.round(pct)))

/** The [tempC, seconds] series for a meat at a given fat% (poultry only). */
export function seriesFor(meat, fatPct) {
  const raw = LETHALITY_DATA[meat]
  if (meat === 'beef') return raw.map(([t, s]) => [t, s])
  const i = clampFat(fatPct) - 1
  return raw.map(([t, arr]) => [t, arr[i]])
}

/** Validated temperature range [min, max] in °C for a meat's table. */
export function tempRange(meat) {
  const s = LETHALITY_DATA[meat]
  return [s[0][0], s[s.length - 1][0]]
}

/**
 * The temperature range to plot and to bound the target slider by. Comparing
 * has to span every dataset, since the three tables start and end at
 * different temperatures.
 */
export function axisRange(meat, compare) {
  if (!compare) return tempRange(meat)
  const ranges = MEATS.map((m) => tempRange(m.id))
  return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))]
}

/**
 * Hold time in seconds at an arbitrary temperature. Interpolates log-linearly
 * in time against linear temperature, which matches the underlying D-value
 * decay. Returns null below the validated range — the source lists no safe
 * time there, and guessing one would be dangerous.
 */
export function getHoldTime(meat, tempC, fatPct = 1) {
  const s = seriesFor(meat, fatPct)
  const lo = s[0][0]
  const hi = s[s.length - 1][0]
  if (tempC < lo) return null
  if (tempC >= hi) return INSTANT_FLOOR
  for (let k = 0; k < s.length - 1; k++) {
    const [t0, y0] = s[k]
    const [t1, y1] = s[k + 1]
    if (tempC >= t0 && tempC <= t1) {
      const f = (tempC - t0) / (t1 - t0)
      return Math.pow(10, Math.log10(y0) + f * (Math.log10(y1) - Math.log10(y0)))
    }
  }
  return INSTANT_FLOOR
}

/* ── formatting ─────────────────────────────────────────────────────────── */

export const cToF = (c) => (c * 9) / 5 + 32
export const fToC = (f) => ((f - 32) * 5) / 9

/** Temperature in the display unit, rounded for reading off a thermometer. */
export function fmtTemp(tempC, unit) {
  const v = unit === 'F' ? cToF(tempC) : tempC
  return `${Math.round(v * 10) / 10}°${unit}`
}

/** Long form for the hero readout, e.g. "12 min 34 sec". */
export function fmtTime(sec) {
  if (sec == null) return 'No safe time'
  if (sec <= INSTANT_FLOOR) return 'Instant'
  if (sec < 60) return `${sec < 10 ? sec.toFixed(1) : Math.round(sec)} sec`
  if (sec < 3600) {
    const m = Math.floor(sec / 60)
    const s = Math.round(sec % 60)
    return s ? `${m} min ${s} sec` : `${m} min`
  }
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return m ? `${h} hr ${m} min` : `${h} hr`
}

/** Compact form for chart axis ticks, e.g. "30s", "5m", "2h". */
export function fmtTimeShort(sec) {
  if (sec <= INSTANT_FLOOR) return 'inst'
  if (sec < 60) return `${Math.round(sec)}s`
  if (sec < 3600) return `${Math.round(sec / 60)}m`
  const h = sec / 3600
  return `${h % 1 ? Math.round(h * 10) / 10 : h}h`
}

/**
 * Axis ticks at round numbers across [min, max], aiming for roughly `target`
 * of them. Steps snap to the usual 1/2/2.5/5/10 progression.
 */
export function niceTicks(min, max, target = 5) {
  const span = max - min
  if (!(span > 0)) return [min]
  const rough = span / target
  const mag = Math.pow(10, Math.floor(Math.log10(rough)))
  const norm = rough / mag
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag
  const ticks = []
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) {
    ticks.push(Math.round(t * 1000) / 1000)
  }
  return ticks
}
