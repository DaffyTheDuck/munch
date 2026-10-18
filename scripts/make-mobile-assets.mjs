// Renders the Journable mark into the icon, adaptive-icon and splash PNGs the Android app needs.
// Usage (from the repo root): node scripts/make-mobile-assets.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

const out = new URL('../mobile/assets/', import.meta.url)
await mkdir(out, { recursive: true })

const GRAD = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c4dee"/><stop offset="1" stop-color="#3b82f6"/></linearGradient>`

// The mark (ring + sparkle) in a 64-unit box, optionally scaled about the centre.
const mark = (color, scale = 1, track = true) => `
  <g transform="translate(32 32) scale(${scale}) translate(-32 -32)">
    ${track ? `<circle cx="32" cy="32" r="18" fill="none" stroke="${color}" stroke-opacity=".28" stroke-width="6"/>` : ''}
    <circle cx="32" cy="32" r="18" fill="none" stroke="${color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="82 31" transform="rotate(-100 32 32)"/>
    <path d="M32 23.5l2.7 5.8 5.8 2.7-5.8 2.7-2.7 5.8-2.7-5.8-5.8-2.7 5.8-2.7z" fill="${color}"/>
  </g>`

const svg = (inner, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${inner}</svg>`
const files = {
  // full-bleed square; the OS rounds it
  'icon.png': [1024, svg(`<rect width="64" height="64" fill="url(#g)"/>${mark('#fff')}`, GRAD)],
  'android-icon-background.png': [1024, svg(`<rect width="64" height="64" fill="url(#g)"/>`, GRAD)],
  // adaptive icons keep important content inside the central 66%
  'android-icon-foreground.png': [1024, svg(mark('#fff', 0.78))],
  'android-icon-monochrome.png': [1024, svg(mark('#000', 0.78, false))],
  // splash: the rounded-square logo on a plain background
  'splash-icon.png': [512, svg(`<rect width="64" height="64" rx="15" fill="url(#g)"/>${mark('#fff')}`, GRAD)],
  'favicon.png': [64, svg(`<rect width="64" height="64" rx="15" fill="url(#g)"/>${mark('#fff')}`, GRAD)],
}

for (const [name, [size, markup]] of Object.entries(files)) {
  await writeFile(new URL(name, out), new Resvg(markup, { fitTo: { mode: 'width', value: size } }).render().asPng())
  console.log('wrote mobile/assets/' + name)
}
