// The Munch mark: a cookie with a bite taken out (and a little sparkle where it happened).
// One source of truth, used for the Android icon set, the favicon and the in-app logo.
//
// Geometry (64-unit box): a cookie of radius 19 at (30,34); three overlapping circles bite the upper right, which gives
// the scalloped teeth-mark edge; four chips sit well away from the bite; a four-point sparkle floats beside it.

export const COLORS = { a: '#6a4cf5', b: '#c04df0', c: '#ff5c9d', chip: '#6a3fd8', cookieTop: '#ffffff', cookieBottom: '#ffd6e8' }

const COOKIE = { cx: 30, cy: 35, r: 19 }
const BITES = [
  { cx: 39.5, cy: 16.5, r: 6.4 },
  { cx: 47.6, cy: 22.2, r: 6.6 },
  { cx: 51.2, cy: 31.2, r: 6.2 },
]
const CHIPS = [
  { cx: 22.5, cy: 29.5, r: 2.7 },
  { cx: 31.2, cy: 42.8, r: 3 },
  { cx: 38.5, cy: 36.2, r: 2.4 },
  { cx: 21.5, cy: 41, r: 2.1 },
]
const SPARK = 'M50.5 6.2l1.7 4.1 4.1 1.7-4.1 1.7-1.7 4.1-1.7-4.1-4.1-1.7 4.1-1.7z'

/** Gradient background (full bleed). */
export const background = (id = 'bg') => `
  <linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${COLORS.a}"/>
    <stop offset=".55" stop-color="${COLORS.b}"/>
    <stop offset="1" stop-color="${COLORS.c}"/>
  </linearGradient>
  <radialGradient id="${id}-glow" cx=".3" cy=".18" r=".75">
    <stop offset="0" stop-color="#fff" stop-opacity=".28"/>
    <stop offset="1" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>`

export const backgroundRect = (id = 'bg', rx = 0) => `<rect width="64" height="64" rx="${rx}" fill="url(#${id})"/><rect width="64" height="64" rx="${rx}" fill="url(#${id}-glow)"/>`

/**
 * The cookie. `mode`: 'color' = white cookie with violet chips and a soft shadow;
 * 'mono' = single colour with the chips cut out (for Android's themed icons).
 */
export function mark({ mode = 'color', scale = 1, id = 'm', mono = '#000' } = {}) {
  const bite = BITES.map((b) => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="#000"/>`).join('')
  const chipsCut = mode === 'mono' ? CHIPS.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="#000"/>`).join('') : ''
  const body = `
    <mask id="${id}-cut" maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
      <rect width="64" height="64" fill="#fff"/>${bite}${chipsCut}
    </mask>`
  const cookie = `<circle cx="${COOKIE.cx}" cy="${COOKIE.cy}" r="${COOKIE.r}" mask="url(#${id}-cut)"`
  if (mode === 'mono') {
    return `<defs>${body}</defs><g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${cookie} fill="${mono}"/><path d="${SPARK}" fill="${mono}"/></g>`
  }
  return `
    <defs>
      ${body}
      <linearGradient id="${id}-fill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${COLORS.cookieTop}"/>
        <stop offset="1" stop-color="${COLORS.cookieBottom}"/>
      </linearGradient>
      <filter id="${id}-shadow" x="-30%" y="-30%" width="160%" height="170%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
    </defs>
    <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
      <g transform="translate(0 2.2)" opacity=".28" filter="url(#${id}-shadow)">${cookie} fill="#3a1190"/></g>
      ${cookie} fill="url(#${id}-fill)"/>
      ${CHIPS.map((c) => `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="${COLORS.chip}"/>`).join('')}
      <path d="${SPARK}" fill="#fff"/>
    </g>`
}

export const iconSvg = ({ rx = 0, scale = 1 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${background()}</defs>${backgroundRect('bg', rx)}${mark({ scale })}</svg>`
