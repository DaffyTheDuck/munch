// Renders public/favicon.svg to the PNG sizes needed for installing the app (PWA / home screen).
// Usage: node scripts/make-icons.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { Resvg } from '@resvg/resvg-js'

const svg = await readFile(new URL('../public/favicon.svg', import.meta.url), 'utf8')

for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  await writeFile(new URL(`../public/${name}`, import.meta.url), png)
  console.log(`wrote public/${name}`)
}
