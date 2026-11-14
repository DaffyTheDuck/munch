// Renders the preview pictures Android shows in the widget picker (before a widget is added).
// Usage (from the repo root): node scripts/make-widget-previews.mjs
import { mkdir, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

const out = new URL('../mobile/assets/widget-preview/', import.meta.url)
await mkdir(out, { recursive: true })

const c = { card: '#ffffff', card2: '#efeff6', text: '#16161d', muted: '#6a6a80', line: '#e3e3ee', accent: '#6d4ef0', accentStrong: '#5a3fd8', protein: '#3b82f6', carbs: '#f59e0b', fat: '#ec4899', a: '#7c4dee', b: '#3b82f6' }
const font = 'font-family="Roboto, Segoe UI, Arial, sans-serif"'
const shell = (w, h, rx, inner) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c.a}"/><stop offset="1" stop-color="${c.b}"/></linearGradient></defs>
  <rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${rx}" fill="${c.card}" stroke="${c.line}" stroke-width="3"/>${inner}</svg>`
const bar = (x, y, w, pct, color) => `<rect x="${x}" y="${y}" width="${w}" height="16" rx="8" fill="${c.card2}"/><rect x="${x}" y="${y}" width="${Math.round((w * pct) / 100)}" height="16" rx="8" fill="${color}"/>`

const files = {
  'calories.png': shell(400, 400, 56, `
    <text x="36" y="70" ${font} font-size="30" font-weight="600" fill="${c.accentStrong}">Munch</text>
    <text x="36" y="215" ${font} font-size="96" font-weight="700" fill="${c.text}">1,240</text>
    <text x="38" y="258" ${font} font-size="30" fill="${c.muted}">kcal left today</text>
    ${bar(36, 300, 328, 38, c.accent)}
    <text x="36" y="364" ${font} font-size="26" fill="${c.muted}">760 of 2,000</text>`),
  'today.png': shell(800, 400, 56, `
    <circle cx="150" cy="150" r="82" fill="none" stroke="${c.card2}" stroke-width="22"/>
    <circle cx="150" cy="150" r="82" fill="none" stroke="${c.accent}" stroke-width="22" stroke-linecap="round" stroke-dasharray="196 516" transform="rotate(-90 150 150)"/>
    <text x="150" y="300" ${font} font-size="50" font-weight="700" fill="${c.text}" text-anchor="middle">1,240</text>
    <text x="150" y="345" ${font} font-size="28" fill="${c.muted}" text-anchor="middle">kcal left</text>
    <text x="300" y="100" ${font} font-size="28" fill="${c.muted}">Protein</text><text x="740" y="100" ${font} font-size="28" fill="${c.muted}" text-anchor="end">48 / 120 g</text>${bar(300, 116, 440, 40, c.protein)}
    <text x="300" y="214" ${font} font-size="28" fill="${c.muted}">Carbs</text><text x="740" y="214" ${font} font-size="28" fill="${c.muted}" text-anchor="end">92 / 220 g</text>${bar(300, 230, 440, 42, c.carbs)}
    <text x="300" y="328" ${font} font-size="28" fill="${c.muted}">Fat</text><text x="740" y="328" ${font} font-size="28" fill="${c.muted}" text-anchor="end">22 / 60 g</text>${bar(300, 344, 440, 37, c.fat)}`),
  'quicklog.png': shell(800, 200, 100, `
    <text x="56" y="92" ${font} font-size="40" font-weight="600" fill="${c.text}">What did you eat?</text>
    <text x="58" y="138" ${font} font-size="28" fill="${c.muted}">Lunch · 1,240 kcal left</text>
    <circle cx="716" cy="100" r="52" fill="url(#g)"/>
    <text x="716" y="124" ${font} font-size="72" font-weight="500" fill="#fff" text-anchor="middle">+</text>`),
}

for (const [name, svg] of Object.entries(files)) {
  await writeFile(new URL(name, out), new Resvg(svg).render().asPng())
  console.log('wrote mobile/assets/widget-preview/' + name)
}
