/**
 * Rasterize assets/neuralupscale-icon.svg → build/icon.png (green #10b981)
 * for Electron window + electron-builder packaging.
 */
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'

const ACCENT = '#10b981'
const SIZE = 512

async function main(): Promise<void> {
  const root = path.join(__dirname, '..')
  const svgPath = path.join(root, 'assets/neuralupscale-icon.svg')
  const outDir = path.join(root, 'build')
  const outPng = path.join(outDir, 'icon.png')
  const outIcoPng = path.join(outDir, 'icon-256.png')

  if (!fs.existsSync(svgPath)) {
    throw new Error(`Missing icon SVG: ${svgPath}`)
  }

  let svg = fs.readFileSync(svgPath, 'utf8')
  // Force brand green fill on all shapes
  if (!/fill=/.test(svg)) {
    svg = svg.replace('<svg ', `<svg fill="${ACCENT}" `)
  } else {
    svg = svg.replace(/fill="[^"]*"/g, `fill="${ACCENT}"`)
    if (!svg.includes(`fill="${ACCENT}"`)) {
      svg = svg.replace('<svg ', `<svg fill="${ACCENT}" `)
    }
  }
  // Ensure root has fill even if paths inherit
  if (!svg.includes(`fill="${ACCENT}"`)) {
    svg = svg.replace(/<svg([^>]*)>/, `<svg$1 fill="${ACCENT}">`)
  }

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const buf = Buffer.from(svg)
  await sharp(buf, { density: 300 })
    .resize(SIZE, SIZE, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPng)

  await sharp(buf, { density: 300 })
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outIcoPng)

  // Also copy into resources for runtime BrowserWindow icon in packaged app
  const resIcon = path.join(root, 'resources/icon.png')
  fs.copyFileSync(outPng, resIcon)

  console.log(`Wrote ${outPng}`)
  console.log(`Wrote ${outIcoPng}`)
  console.log(`Wrote ${resIcon}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
