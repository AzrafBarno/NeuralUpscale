import fs from 'fs'
import path from 'path'
import https from 'https'
import http from 'http'
// @ts-expect-error no types
import AdmZip from 'adm-zip'

const RELEASE_BASE =
  'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0'

const BINARIES = {
  win32: {
    url: `${RELEASE_BASE}/realesrgan-ncnn-vulkan-20220424-windows.zip`,
    dest: 'resources/bin/win32/realesrgan-ncnn-vulkan.exe',
    zipEntry: 'realesrgan-ncnn-vulkan.exe'
  },
  darwin: {
    url: `${RELEASE_BASE}/realesrgan-ncnn-vulkan-20220424-macos.zip`,
    dest: 'resources/bin/darwin/realesrgan-ncnn-vulkan',
    zipEntry: 'realesrgan-ncnn-vulkan'
  },
  linux: {
    url: `${RELEASE_BASE}/realesrgan-ncnn-vulkan-20220424-ubuntu.zip`,
    dest: 'resources/bin/linux/realesrgan-ncnn-vulkan',
    zipEntry: 'realesrgan-ncnn-vulkan'
  }
} as const

const OPTIONAL_MODELS_BASE =
  'https://github.com/TransparentLC/realesrgan-gui/releases/download/additional-models'

const OPTIONAL_MODELS = ['realesrnet-x4plus']

const FFBINARIES_BASE =
  'https://github.com/ffbinaries/ffbinaries-prebuilt/releases/download/v6.1'

const FFMPEG_BUNDLES = {
  win32: {
    ffmpegUrl: `${FFBINARIES_BASE}/ffmpeg-6.1-win-64.zip`,
    ffprobeUrl: `${FFBINARIES_BASE}/ffprobe-6.1-win-64.zip`,
    ffmpegDest: 'resources/bin/win32/ffmpeg.exe',
    ffprobeDest: 'resources/bin/win32/ffprobe.exe',
    ffmpegEntry: 'ffmpeg.exe',
    ffprobeEntry: 'ffprobe.exe'
  },
  darwin: {
    ffmpegUrl: `${FFBINARIES_BASE}/ffmpeg-6.1-macos-64.zip`,
    ffprobeUrl: `${FFBINARIES_BASE}/ffprobe-6.1-macos-64.zip`,
    ffmpegDest: 'resources/bin/darwin/ffmpeg',
    ffprobeDest: 'resources/bin/darwin/ffprobe',
    ffmpegEntry: 'ffmpeg',
    ffprobeEntry: 'ffprobe'
  },
  linux: {
    ffmpegUrl: `${FFBINARIES_BASE}/ffmpeg-6.1-linux-64.zip`,
    ffprobeUrl: `${FFBINARIES_BASE}/ffprobe-6.1-linux-64.zip`,
    ffmpegDest: 'resources/bin/linux/ffmpeg',
    ffprobeDest: 'resources/bin/linux/ffprobe',
    ffmpegEntry: 'ffmpeg',
    ffprobeEntry: 'ffprobe'
  }
} as const

const RIFE_RELEASE = '20221029'
const RIFE_BASE = `https://github.com/nihui/rife-ncnn-vulkan/releases/download/${RIFE_RELEASE}`

const RIFE_BUNDLES = {
  win32: {
    url: `${RIFE_BASE}/rife-ncnn-vulkan-${RIFE_RELEASE}-windows.zip`,
    binaryDest: 'resources/bin/win32/rife-ncnn-vulkan.exe',
    binaryEntry: 'rife-ncnn-vulkan.exe',
    dllEntry: 'vcomp140.dll',
    dllDest: 'resources/bin/win32/vcomp140.dll'
  },
  darwin: {
    url: `${RIFE_BASE}/rife-ncnn-vulkan-${RIFE_RELEASE}-macos.zip`,
    binaryDest: 'resources/bin/darwin/rife-ncnn-vulkan',
    binaryEntry: 'rife-ncnn-vulkan'
  },
  linux: {
    url: `${RIFE_BASE}/rife-ncnn-vulkan-${RIFE_RELEASE}-ubuntu.zip`,
    binaryDest: 'resources/bin/linux/rife-ncnn-vulkan',
    binaryEntry: 'rife-ncnn-vulkan'
  }
} as const

const RIFE_MODEL = 'rife-v4.6'

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const tmpPath = destPath + '.tmp'
    const file = fs.createWriteStream(tmpPath)

    const request = (requestUrl: string): void => {
      const client = requestUrl.startsWith('https') ? https : http
      client
        .get(requestUrl, (response) => {
          if (response.statusCode === 301 || response.statusCode === 302) {
            const redirect = response.headers.location
            if (redirect) {
              request(redirect)
              return
            }
          }
          if (response.statusCode !== 200) {
            reject(new Error(`Download failed: HTTP ${response.statusCode} for ${requestUrl}`))
            return
          }
          response.pipe(file)
          file.on('finish', () => {
            file.close()
            fs.renameSync(tmpPath, destPath)
            resolve()
          })
        })
        .on('error', (err) => {
          fs.unlink(tmpPath, () => reject(err))
        })
    }

    request(url)
  })
}

function extractFromZip(zipPath: string, entryName: string, destPath: string): void {
  const zip = new AdmZip(zipPath)
  const entry = zip.getEntry(entryName)
  if (!entry) {
    const entries = zip.getEntries().map((e: { entryName: string }) => e.entryName)
    const match = entries.find((e: string) => e.endsWith(entryName) || e.endsWith(entryName.replace(/\\/g, '/')))
    if (!match) throw new Error(`Entry ${entryName} not found in zip. Available: ${entries.slice(0, 5).join(', ')}...`)
    const data = zip.readFile(match)
    if (!data) throw new Error(`Could not read ${match}`)
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, data)
  } else {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    fs.writeFileSync(destPath, entry.getData())
  }
}

function extractModelsFromZip(zipPath: string, modelsDir: string): number {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries() as Array<{ entryName: string; isDirectory: boolean; getData: () => Buffer }>
  let extracted = 0

  if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true })

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    if (!name.includes('models/')) continue
    if (!name.endsWith('.bin') && !name.endsWith('.param')) continue

    const baseName = path.basename(name)
    const destPath = path.join(modelsDir, baseName)
    if (fs.existsSync(destPath)) continue

    fs.writeFileSync(destPath, entry.getData())
    console.log(`  [done] models/${baseName}`)
    extracted++
  }

  return extracted
}

async function setupOptionalModels(modelsDir: string): Promise<void> {
  console.log('\nOptional models:')
  for (const model of OPTIONAL_MODELS) {
    for (const ext of ['.bin', '.param']) {
      const destPath = path.join(modelsDir, `${model}${ext}`)
      if (fs.existsSync(destPath)) {
        console.log(`  [skip] models/${model}${ext}`)
        continue
      }
      const url = `${OPTIONAL_MODELS_BASE}/${model}${ext}`
      try {
        console.log(`  [download] ${url}`)
        await downloadFile(url, destPath)
        console.log(`  [done] models/${model}${ext}`)
      } catch (err) {
        console.warn(`  [warn] Could not download ${model}${ext}: ${(err as Error).message}`)
      }
    }
  }
}

async function setupFfmpeg(platform: keyof typeof FFMPEG_BUNDLES): Promise<void> {
  const config = FFMPEG_BUNDLES[platform]
  const root = path.join(__dirname, '..')
  const ffmpegDest = path.join(root, config.ffmpegDest)
  const ffprobeDest = path.join(root, config.ffprobeDest)

  console.log('\nFFmpeg:')

  const ensureBinary = async (
    url: string,
    destPath: string,
    entryName: string,
    label: string
  ): Promise<void> => {
    if (fs.existsSync(destPath)) {
      console.log(`  [skip] ${label}`)
      return
    }
    const zipPath = path.join(root, 'resources', `${path.basename(destPath)}.zip`)
    try {
      console.log(`  [download] ${url}`)
      await downloadFile(url, zipPath)
      extractFromZip(zipPath, entryName, destPath)
      if (platform !== 'win32') fs.chmodSync(destPath, 0o755)
      console.log(`  [done] ${label}`)
    } catch (err) {
      console.warn(`  [warn] Could not install ${label}: ${(err as Error).message}`)
    } finally {
      if (fs.existsSync(zipPath)) {
        try {
          fs.unlinkSync(zipPath)
        } catch {
          // ignore
        }
      }
    }
  }

  await ensureBinary(config.ffmpegUrl, ffmpegDest, config.ffmpegEntry, config.ffmpegDest)
  await ensureBinary(config.ffprobeUrl, ffprobeDest, config.ffprobeEntry, config.ffprobeDest)
}

function extractRifeModelFromZip(zipPath: string, modelsRoot: string): number {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries() as Array<{ entryName: string; isDirectory: boolean; getData: () => Buffer }>
  let extracted = 0
  const modelDir = path.join(modelsRoot, RIFE_MODEL)
  if (!fs.existsSync(modelDir)) fs.mkdirSync(modelDir, { recursive: true })

  for (const entry of entries) {
    if (entry.isDirectory) continue
    const name = entry.entryName.replace(/\\/g, '/')
    // Match ".../rife-v4.6/flownet.bin" or "rife-v4.6/flownet.bin"
    const marker = `${RIFE_MODEL}/`
    const idx = name.indexOf(marker)
    if (idx < 0) continue
    const rel = name.slice(idx + marker.length)
    if (!rel || rel.includes('/')) continue // only top-level model files
    const destPath = path.join(modelDir, path.basename(rel))
    if (fs.existsSync(destPath)) continue
    fs.writeFileSync(destPath, entry.getData())
    console.log(`  [done] rife-models/${RIFE_MODEL}/${path.basename(rel)}`)
    extracted++
  }
  return extracted
}

async function setupRife(platform: keyof typeof RIFE_BUNDLES): Promise<void> {
  const config = RIFE_BUNDLES[platform]
  const root = path.join(__dirname, '..')
  const binaryDest = path.join(root, config.binaryDest)
  const modelsRoot = path.join(root, 'resources/rife-models')
  const modelBin = path.join(modelsRoot, RIFE_MODEL, 'flownet.bin')
  const zipPath = path.join(root, 'resources', `rife-${platform}.zip`)

  console.log('\nRIFE (frame interpolation):')

  const hasBinary = fs.existsSync(binaryDest)
  const hasModel = fs.existsSync(modelBin)

  if (hasBinary && hasModel) {
    console.log('  [skip] RIFE binary and model already present')
    return
  }

  try {
    if (!fs.existsSync(zipPath)) {
      console.log(`  [download] ${config.url}`)
      console.log('  (this is a large download, please wait…)')
      await downloadFile(config.url, zipPath)
    }

    if (!hasBinary) {
      extractFromZip(zipPath, config.binaryEntry, binaryDest)
      if (platform !== 'win32') fs.chmodSync(binaryDest, 0o755)
      console.log(`  [done] ${config.binaryDest}`)

      if (platform === 'win32' && 'dllEntry' in config && config.dllEntry) {
        const dllDest = path.join(root, config.dllDest)
        if (!fs.existsSync(dllDest)) {
          try {
            extractFromZip(zipPath, config.dllEntry, dllDest)
            console.log(`  [done] ${config.dllDest}`)
          } catch {
            // optional
          }
        }
      }
    } else {
      console.log(`  [skip] ${config.binaryDest}`)
    }

    if (!hasModel) {
      const n = extractRifeModelFromZip(zipPath, modelsRoot)
      if (n === 0) {
        console.warn(`  [warn] Could not find ${RIFE_MODEL} in RIFE zip`)
      }
    } else {
      console.log(`  [skip] rife-models/${RIFE_MODEL}`)
    }
  } catch (err) {
    console.warn(`  [warn] RIFE setup failed: ${(err as Error).message}`)
    console.warn('  Frame interpolation will be unavailable until setup succeeds.')
  }
}

async function setupPlatform(platform: keyof typeof BINARIES): Promise<void> {
  const config = BINARIES[platform]
  const root = path.join(__dirname, '..')
  const destPath = path.join(root, config.dest)
  const modelsDir = path.join(root, 'resources/models')
  const zipPath = path.join(root, 'resources', `${platform}-bundle.zip`)

  const hasBinary = fs.existsSync(destPath)
  const hasModels = fs.existsSync(path.join(modelsDir, 'realesrgan-x4plus.bin'))

  if (hasBinary && hasModels) {
    console.log('  [skip] Binary and core models already present')
    await setupOptionalModels(modelsDir)
    await setupFfmpeg(platform)
    await setupRife(platform)
    return
  }

  if (!fs.existsSync(zipPath)) {
    console.log(`  [download] ${config.url}`)
    await downloadFile(config.url, zipPath)
  }

  if (!hasBinary) {
    extractFromZip(zipPath, config.zipEntry, destPath)
    console.log(`  [done] ${config.dest}`)
    if (platform !== 'win32') fs.chmodSync(destPath, 0o755)
  } else {
    console.log(`  [skip] ${config.dest}`)
  }

  console.log('\nModels:')
  const extracted = extractModelsFromZip(zipPath, modelsDir)
  if (extracted === 0 && hasModels) {
    console.log('  [skip] Core models present')
  }

  await setupOptionalModels(modelsDir)
  await setupFfmpeg(platform)
  await setupRife(platform)
}

async function main(): Promise<void> {
  console.log('NeuralUpscale — Resource Setup\n')

  const platform = process.platform as keyof typeof BINARIES
  if (!(platform in BINARIES)) {
    console.error(`Unsupported platform: ${platform}`)
    process.exit(1)
  }

  console.log(`Platform: ${platform}\nBinaries & Models:`)
  await setupPlatform(platform)

  console.log('\nSetup complete!')
}

main().catch((err) => {
  console.error('Setup failed:', err.message)
  process.exit(1)
})
