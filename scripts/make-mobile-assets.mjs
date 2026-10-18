// Renders the Munch mark into the Android icon set, the splash image, the favicon and the PWA icons.
// Usage (from the repo root): node scripts/make-mobile-assets.mjs
import { writeFile, mkdir } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'
import { background, backgroundRect, iconSvg, mark } from './munch-mark.mjs'

const out = new URL('../mobile/assets/', import.meta.url)
const pub = new URL('../public/', import.meta.url)
await mkdir(out, { recursive: true })

const wrap = (inner, defs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs>${defs}</defs>${inner}</svg>`
const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

const files = {
  // full-bleed square; the OS rounds it
  'icon.png': [1024, iconSvg()],
  // adaptive icons keep important content inside the central 66%
  'android-icon-background.png': [1024, wrap(backgroundRect(), background())],
  'android-icon-foreground.png': [1024, wrap(mark({ scale: 0.68, id: 'fg' }))],
  // themed (monochrome) icon: one colour, chips cut out
  'android-icon-monochrome.png': [1024, wrap(mark({ mode: 'mono', scale: 0.68, id: 'mono' }))],
  // splash: the rounded-square logo on a plain background
  'splash-icon.png': [512, iconSvg({ rx: 15 })],
  'favicon.png': [64, iconSvg({ rx: 15 })],
}
for (const [name, [size, svg]] of Object.entries(files)) {
  await writeFile(new URL(name, out), render(svg, size))
  console.log('wrote mobile/assets/' + name)
}

// web: the vector favicon and the PWA / home-screen PNGs
const favicon = iconSvg({ rx: 15 })
await writeFile(new URL('favicon.svg', pub), favicon)
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  await writeFile(new URL(name, pub), render(iconSvg(), size)) // full-bleed: the OS rounds these too
  console.log('wrote public/' + name)
}
