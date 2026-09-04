/**
 * Bootstrap portable VapourSynth + vs-mlrt (vstrt) + FFMS2 for Green Sparkle.
 * Downloads happen on first enable (Windows). Linux is not supported in this pass.
 *
 * R79+ "VapourSynth64-Portable" zip is only docs + a wheel + bat stubs — not a full
 * tree. We mirror the official Install-Portable script: embed Python 3.12, then
 * `pip install` the VapourSynth wheel so vspipe.exe lands under site-packages.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import http from 'http'
import https from 'https'
import path from 'path'
import { getGstRuntimeDir, getGstScriptsDir, getGstVsDir } from './paths'

const VS_VERSION = 79
const VS_PORTABLE_URL = `https://github.com/vapoursynth/vapoursynth/releases/download/R${VS_VERSION}/VapourSynth64-Portable-R${VS_VERSION}.zip`
const PYTHON_EMBED_URL =
  'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
const GET_PIP_URL = 'https://bootstrap.pypa.io/get-pip.py'
const VS_MLRT_TAG = 'v15.15'
const VSTRT_URL = `https://github.com/AmusementClub/vs-mlrt/releases/download/${VS_MLRT_TAG}/VSTRT-Windows-x64.${VS_MLRT_TAG}.7z`
const VS_SCRIPTS_URL = `https://github.com/AmusementClub/vs-mlrt/releases/download/${VS_MLRT_TAG}/scripts.${VS_MLRT_TAG}.7z`
const SEVEN_ZR_URL = 'https://www.7-zip.org/a/7zr.exe'
const FFMS2_URL =
  'https://github.com/FFMS/ffms2/releases/download/2.40/ffms2-2.40-msvc.7z'
const BESTSOURCE_URL =
  'https://github.com/vapoursynth/bestsource/releases/download/R20/BestSource-R20-win64-clang-vs-only.zip'

const READY_MARKER = 'ready.json'

export function getVsPortableRoot(): string {
  return path.join(getGstVsDir(), 'portable')
}

export function getVsPythonPath(): string | null {
  const p = path.join(getVsPortableRoot(), 'python.exe')
  return fs.existsSync(p) ? p : null
}

export function getVsPluginsDir(): string {
  const root = getVsPortableRoot()
  const candidates = [
    path.join(root, 'vapoursynth64', 'plugins'),
    path.join(root, 'plugins'),
    path.join(root, 'Lib', 'site-packages', 'vapoursynth', 'plugins')
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  const fallback = path.join(root, 'vapoursynth64', 'plugins')
  fs.mkdirSync(fallback, { recursive: true })
  return fallback
}

export function getVspipePath(): string | null {
  const root = getVsPortableRoot()
  const candidates = [
    path.join(root, 'Lib', 'site-packages', 'vapoursynth', 'vspipe.exe'),
    path.join(root, 'Lib', 'site-packages', 'vapoursynth', 'VSPipe.exe'),
    path.join(root, 'Scripts', 'vspipe.exe'),
    path.join(root, 'vspipe.exe'),
    path.join(root, 'VSPipe.exe')
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  // Deep search (wheel layout can vary slightly)
  const found = findFileRecursive(root, ['vspipe.exe', 'VSPipe.exe'])
  if (found) return found
  // Official portable stubs expose vspipe.bat after install
  const bat = path.join(root, 'vspipe.bat')
  if (fs.existsSync(bat) && getVsPythonPath()) return bat
  return null
}

export function vsRuntimeReady(): boolean {
  if (process.platform !== 'win32') return false
  const marker = path.join(getGstVsDir(), READY_MARKER)
  if (!fs.existsSync(marker)) return false
  if (!getVspipePath()) return false
  const plugins = getVsPluginsDir()
  if (!fs.existsSync(path.join(plugins, 'vstrt.dll'))) return false
  if (!sourcePluginReady(plugins)) return false
  // Marker without source revision → repair pass (pull BestSource + x64 FFMS2)
  try {
    const meta = JSON.parse(fs.readFileSync(marker, 'utf-8')) as { source?: string }
    if (!meta.source || !String(meta.source).includes('ffms2-x64')) return false
  } catch {
    return false
  }
  return true
}

export function getGstVsScriptPath(): string {
  return path.join(getGstScriptsDir(), 'gst_vs_upscale.vpy')
}

function downloadFile(url: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    const tmpPath = destPath + '.tmp'
    const file = fs.createWriteStream(tmpPath)

    const request = (requestUrl: string, redirects = 0): void => {
      if (redirects > 8) {
        reject(new Error(`Too many redirects for ${url}`))
        return
      }
      const client = requestUrl.startsWith('https') ? https : http
      client
        .get(requestUrl, { headers: { 'User-Agent': 'NeuralUpscale' } }, (response) => {
          const code = response.statusCode ?? 0
          if (code >= 300 && code < 400 && response.headers.location) {
            request(response.headers.location, redirects + 1)
            return
          }
          if (code !== 200) {
            reject(new Error(`Download failed: HTTP ${code} for ${requestUrl}`))
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

function runCapture(
  bin: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv }
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      cwd: opts?.cwd,
      env: opts?.env,
      windowsHide: true
    })
    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => {
      stdout += d.toString()
    })
    proc.stderr.on('data', (d: Buffer) => {
      stderr += d.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr })
    })
  })
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const result = await runCapture('tar', ['-xf', zipPath, '-C', destDir])
  if (result.code !== 0) {
    throw new Error(`Failed to extract zip: ${result.stderr || result.stdout}`)
  }
}

async function ensureSevenZr(vsDir: string): Promise<string> {
  const exe = path.join(vsDir, '7zr.exe')
  if (!fs.existsSync(exe)) {
    await downloadFile(SEVEN_ZR_URL, exe)
  }
  return exe
}

async function extract7z(sevenZr: string, archive: string, destDir: string): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  const result = await runCapture(sevenZr, ['x', archive, `-o${destDir}`, '-y'])
  if (result.code !== 0) {
    throw new Error(`7z extract failed: ${result.stderr || result.stdout}`)
  }
}

function findFileRecursive(
  root: string,
  names: string[],
  opts?: { preferPathSubstr?: string[] }
): string | null {
  if (!fs.existsSync(root)) return null
  const prefer = (opts?.preferPathSubstr || []).map((s) => s.toLowerCase())
  const matches: string[] = []
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        if (ent.name === 'doc' || ent.name === '__pycache__' || ent.name.toLowerCase() === 'x86') {
          continue
        }
        stack.push(full)
      } else if (names.some((n) => n.toLowerCase() === ent.name.toLowerCase())) {
        matches.push(full)
      }
    }
  }
  if (!matches.length) return null
  if (prefer.length) {
    const ranked = matches.find((m) => {
      const lower = m.toLowerCase()
      return prefer.some((p) => lower.includes(p))
    })
    if (ranked) return ranked
  }
  return matches[0]
}

/** True if a PE DLL is AMD64 (rejects the 32-bit FFMS2 we previously installed). */
function isPeAmd64(filePath: string): boolean {
  try {
    const fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(64)
    fs.readSync(fd, buf, 0, 64, 0)
    if (buf.toString('ascii', 0, 2) !== 'MZ') {
      fs.closeSync(fd)
      return false
    }
    const peOffset = buf.readUInt32LE(0x3c)
    const pe = Buffer.alloc(6)
    fs.readSync(fd, pe, 0, 6, peOffset)
    fs.closeSync(fd)
    if (pe.toString('ascii', 0, 2) !== 'PE') return false
    const machine = pe.readUInt16LE(4)
    return machine === 0x8664
  } catch {
    return false
  }
}

function sourcePluginReady(pluginsDir: string): boolean {
  const candidates = ['bestsource.dll', 'BestSource.dll', 'ffms2.dll', 'FFMS2.dll']
  return candidates.some((n) => {
    const p = path.join(pluginsDir, n)
    return fs.existsSync(p) && isPeAmd64(p)
  })
}

function copyIntoPlugins(srcFile: string, pluginsDir: string): void {
  fs.mkdirSync(pluginsDir, { recursive: true })
  const dest = path.join(pluginsDir, path.basename(srcFile))
  fs.copyFileSync(srcFile, dest)
}

function enableEmbedSitePackages(portable: string): void {
  const pth = fs
    .readdirSync(portable)
    .find((f) => /^python\d+\._pth$/i.test(f) || /^python\d{2,3}\._pth$/i.test(f))
  if (!pth) return
  const pthPath = path.join(portable, pth)
  let text = fs.readFileSync(pthPath, 'utf-8')
  if (!/Lib\\site-packages/i.test(text) && !/Lib\/site-packages/i.test(text)) {
    text = text.trimEnd() + '\nLib\\site-packages\n'
    fs.writeFileSync(pthPath, text, 'utf-8')
  }
  // Uncomment import site if present as #import site
  text = fs.readFileSync(pthPath, 'utf-8')
  if (/^#\s*import\s+site/m.test(text)) {
    fs.writeFileSync(pthPath, text.replace(/^#\s*import\s+site/m, 'import site'), 'utf-8')
  }
}

/** TensorRT / CUDA DLL dirs from the GST embed Python pip install. */
export function tensorrtPathDirs(): string[] {
  const python = path.join(getGstRuntimeDir(), 'python', 'python.exe')
  const site = path.join(path.dirname(python), 'Lib', 'site-packages')
  return [
    path.join(site, 'nvidia', 'cuda_runtime', 'bin'),
    path.join(site, 'nvidia', 'cublas', 'bin'),
    path.join(site, 'nvidia', 'cudnn', 'bin'),
    path.join(site, 'nvidia', 'cuda_nvrtc', 'bin'),
    path.join(site, 'nvidia', 'cufft', 'bin'),
    path.join(site, 'tensorrt_libs'),
    path.join(site, 'tensorrt'),
    // cuda-python / nvidia-cuda-runtime alternate layouts
    path.join(site, 'cuda', 'bin'),
    path.join(site, 'cuda_bindings.libs')
  ].filter((p) => fs.existsSync(p))
}

/**
 * vstrt looks for nvinfer*.dll under plugins/vsmlrt-cuda. Point that at the
 * pip-installed tensorrt_libs so preload succeeds (avoids errno 126 noise).
 */
export function ensureVsmlrtCudaLink(): void {
  if (process.platform !== 'win32') return
  const siteTrt = path.join(
    getGstRuntimeDir(),
    'python',
    'Lib',
    'site-packages',
    'tensorrt_libs'
  )
  if (!fs.existsSync(siteTrt)) return
  const link = path.join(getVsPluginsDir(), 'vsmlrt-cuda')
  try {
    if (fs.existsSync(link)) {
      const st = fs.lstatSync(link)
      if (st.isSymbolicLink() || (st.isDirectory() && fs.readdirSync(link).some((f) => /nvinfer/i.test(f)))) {
        // Already a usable link or populated folder
        const nvinfer = path.join(link, 'nvinfer_10.dll')
        if (fs.existsSync(nvinfer)) return
      }
      fs.rmSync(link, { recursive: true, force: true })
    }
  } catch {
    // fall through and try create
  }
  try {
    fs.symlinkSync(siteTrt, link, 'junction')
  } catch (err) {
    console.warn('[gst-vs] Could not create vsmlrt-cuda junction:', err)
  }
}

export function buildVsProcessEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  ensureVsmlrtCudaLink()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...extra,
    PYTHONUNBUFFERED: '1',
    CUDA_MODULE_LOADING: 'LAZY'
  }
  const portable = getVsPortableRoot()
  const plugins = getVsPluginsDir()
  const pathParts = [
    portable,
    path.join(portable, 'Lib', 'site-packages', 'vapoursynth'),
    plugins,
    path.join(portable, 'vapoursynth64'),
    ...tensorrtPathDirs(),
    env.PATH || env.Path || ''
  ]
  const joined = pathParts.filter(Boolean).join(path.delimiter)
  env.PATH = joined
  env.Path = joined
  env.VS_PLUGINDIR = plugins
  env.GST_VS_PLUGIN_DIRS = [plugins, path.join(getGstVsDir(), 'scripts')]
    .filter((p) => fs.existsSync(p))
    .join(path.delimiter)
  return env
}

/**
 * Full portable install matching Install-Portable-VapourSynth-R79.ps1:
 * embed Python 3.12 → get-pip → extract VS zip → pip install wheel.
 */
async function ensureVsPortableInstall(
  onProgress: (percent: number, message: string) => void,
  throwIfCancelled: () => void
): Promise<void> {
  const vsDir = getGstVsDir()
  const downloads = path.join(vsDir, 'downloads')
  const portable = getVsPortableRoot()
  fs.mkdirSync(downloads, { recursive: true })

  if (getVspipePath() && getVsPythonPath()) {
    return
  }

  onProgress(42, 'Downloading Python 3.12 embed for VapourSynth…')
  const pyZip = path.join(downloads, 'python-3.12.10-embed-amd64.zip')
  if (!fs.existsSync(pyZip) || fs.statSync(pyZip).size < 1000) {
    await downloadFile(PYTHON_EMBED_URL, pyZip)
  }
  throwIfCancelled()

  onProgress(43, 'Downloading VapourSynth R79 package…')
  const vsZip = path.join(downloads, `VapourSynth64-Portable-R${VS_VERSION}.zip`)
  if (!fs.existsSync(vsZip) || fs.statSync(vsZip).size < 1000) {
    await downloadFile(VS_PORTABLE_URL, vsZip)
  }
  throwIfCancelled()

  onProgress(44, 'Setting up VapourSynth portable Python…')
  if (fs.existsSync(portable)) {
    fs.rmSync(portable, { recursive: true, force: true })
  }
  fs.mkdirSync(portable, { recursive: true })
  await extractZip(pyZip, portable)
  enableEmbedSitePackages(portable)
  throwIfCancelled()

  const python = getVsPythonPath()
  if (!python) {
    throw new Error('python.exe missing after extracting embeddable Python for VapourSynth')
  }

  onProgress(45, 'Installing pip into VapourSynth Python…')
  const getPip = path.join(downloads, 'get-pip.py')
  if (!fs.existsSync(getPip) || fs.statSync(getPip).size < 1000) {
    await downloadFile(GET_PIP_URL, getPip)
  }
  let pipResult = await runCapture(python, [getPip, '--no-warn-script-location'], {
    cwd: portable
  })
  if (pipResult.code !== 0) {
    throw new Error(`get-pip failed: ${pipResult.stderr || pipResult.stdout}`)
  }
  throwIfCancelled()

  onProgress(46, 'Extracting VapourSynth wheel package…')
  await extractZip(vsZip, portable)
  throwIfCancelled()

  let wheelPath =
    findFileRecursive(path.join(portable, 'wheel'), [
      `vapoursynth-${VS_VERSION}-cp312-abi3-win_amd64.whl`,
      `VapourSynth-${VS_VERSION}-cp312-abi3-win_amd64.whl`
    ]) || findWhl(path.join(portable, 'wheel')) || findWhl(portable)
  if (!wheelPath) {
    throw new Error('VapourSynth wheel (.whl) not found in portable package')
  }

  onProgress(47, 'Installing VapourSynth wheel (this provides vspipe)…')
  pipResult = await runCapture(
    python,
    ['-m', 'pip', 'install', '--no-warn-script-location', wheelPath],
    { cwd: portable }
  )
  if (pipResult.code !== 0) {
    throw new Error(`pip install vapoursynth failed: ${pipResult.stderr || pipResult.stdout}`)
  }
  throwIfCancelled()

  // Official script deletes Scripts\*.exe (broken hardcoded paths); we use site-packages vspipe.exe
  const scriptsDir = path.join(portable, 'Scripts')
  if (fs.existsSync(scriptsDir)) {
    for (const f of fs.readdirSync(scriptsDir)) {
      if (f.toLowerCase().endsWith('.exe')) {
        try {
          fs.unlinkSync(path.join(scriptsDir, f))
        } catch {
          // ignore
        }
      }
    }
  }

  if (!getVspipePath()) {
    throw new Error(
      'vspipe.exe still missing after installing the VapourSynth wheel. Try deleting %AppData%\\neuralupscale\\gst\\vs and re-enable Green Sparkle.'
    )
  }
}

function findWhl(dir: string): string | null {
  if (!fs.existsSync(dir)) return null
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop()!
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const ent of entries) {
      const full = path.join(cur, ent.name)
      if (ent.isDirectory()) stack.push(full)
      else if (ent.name.toLowerCase().endsWith('.whl') && /vapoursynth/i.test(ent.name)) {
        return full
      }
    }
  }
  return null
}

export async function ensureVsRuntime(
  onProgress: (percent: number, message: string) => void,
  throwIfCancelled: () => void
): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error(
      'Green Sparkle VapourSynth path currently requires Windows. Turn off Green Sparkle or use Vulkan.'
    )
  }

  if (vsRuntimeReady()) {
    ensureVsmlrtCudaLink()
    onProgress(52, 'VapourSynth + vs-mlrt ready')
    return
  }

  const vsDir = getGstVsDir()
  fs.mkdirSync(vsDir, { recursive: true })

  // Wipe incomplete prior extract (docs-only zip without python/vspipe)
  if (!getVspipePath() || !getVsPythonPath()) {
    const marker = path.join(vsDir, READY_MARKER)
    if (fs.existsSync(marker)) fs.unlinkSync(marker)
  }

  await ensureVsPortableInstall(onProgress, throwIfCancelled)
  throwIfCancelled()

  onProgress(48, 'Downloading 7-Zip extractor…')
  const sevenZr = await ensureSevenZr(vsDir)
  throwIfCancelled()

  const downloads = path.join(vsDir, 'downloads')

  // Fast repair: portable + vstrt already OK — refresh source plugins / marker
  const pluginsDir = getVsPluginsDir()
  const vstrtOk = fs.existsSync(path.join(pluginsDir, 'vstrt.dll'))
  if (getVspipePath() && vstrtOk) {
    await ensureSourcePlugins(downloads, sevenZr, onProgress, throwIfCancelled)
    ensureVsmlrtCudaLink()
    if (sourcePluginReady(pluginsDir)) {
      fs.writeFileSync(
        path.join(vsDir, READY_MARKER),
        JSON.stringify(
          {
            vapoursynth: `R${VS_VERSION}`,
            python: '3.12.10',
            vsmlrt: VS_MLRT_TAG,
            source: 'bestsource+ffms2-x64',
            readyAt: new Date().toISOString()
          },
          null,
          2
        ),
        'utf-8'
      )
      onProgress(52, 'VapourSynth + vs-mlrt ready')
      return
    }
  }

  onProgress(49, 'Downloading vs-mlrt TensorRT plugin…')
  const vstrt7z = path.join(downloads, `VSTRT-Windows-x64.${VS_MLRT_TAG}.7z`)
  if (!fs.existsSync(vstrt7z) || fs.statSync(vstrt7z).size < 100) {
    await downloadFile(VSTRT_URL, vstrt7z)
  }
  throwIfCancelled()

  const vstrtExtract = path.join(downloads, 'vstrt_extract')
  fs.mkdirSync(vstrtExtract, { recursive: true })
  await extract7z(sevenZr, vstrt7z, vstrtExtract)
  const vstrtDll = findFileRecursive(vstrtExtract, ['vstrt.dll'], {
    preferPathSubstr: ['x64', 'win64', 'amd64']
  })
  if (!vstrtDll) {
    throw new Error('vstrt.dll not found in vs-mlrt TensorRT package')
  }
  // Only install the VS plugin itself — do not dump bundled CUDA/TRT redistributables
  // into the plugins folder (they break autoload / cause errno 126 noise).
  copyIntoPlugins(vstrtDll, getVsPluginsDir())
  // Remove leftover incomplete vsmlrt-cuda trees; replace with junction to pip TRT
  const staleCuda = path.join(getVsPluginsDir(), 'vsmlrt-cuda')
  if (fs.existsSync(staleCuda)) {
    try {
      const nvinfer = path.join(staleCuda, 'nvinfer_10.dll')
      if (!fs.existsSync(nvinfer)) {
        fs.rmSync(staleCuda, { recursive: true, force: true })
      }
    } catch {
      // ignore
    }
  }
  ensureVsmlrtCudaLink()
  throwIfCancelled()

  onProgress(50, 'Downloading vs-mlrt scripts…')
  const scripts7z = path.join(downloads, `scripts.${VS_MLRT_TAG}.7z`)
  if (!fs.existsSync(scripts7z) || fs.statSync(scripts7z).size < 100) {
    await downloadFile(VS_SCRIPTS_URL, scripts7z)
  }
  const scriptsDir = path.join(vsDir, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  await extract7z(sevenZr, scripts7z, scriptsDir)
  throwIfCancelled()

  await ensureSourcePlugins(downloads, sevenZr, onProgress, throwIfCancelled)

  if (!getVspipePath()) {
    throw new Error('vspipe.exe not found after VapourSynth portable install')
  }
  if (!fs.existsSync(path.join(getVsPluginsDir(), 'vstrt.dll'))) {
    throw new Error('vs-mlrt vstrt.dll failed to install into the VapourSynth plugins folder')
  }
  if (!sourcePluginReady(getVsPluginsDir())) {
    throw new Error(
      'No working 64-bit video source plugin (BestSource/FFMS2). Re-enable Green Sparkle after deleting %AppData%\\neuralupscale\\gst\\vs\\portable\\Lib\\site-packages\\vapoursynth\\plugins\\ffms2.dll'
    )
  }

  ensureVsmlrtCudaLink()

  fs.writeFileSync(
    path.join(vsDir, READY_MARKER),
    JSON.stringify(
      {
        vapoursynth: `R${VS_VERSION}`,
        python: '3.12.10',
        vsmlrt: VS_MLRT_TAG,
        source: 'bestsource+ffms2-x64',
        readyAt: new Date().toISOString()
      },
      null,
      2
    ),
    'utf-8'
  )
  onProgress(52, 'VapourSynth + vs-mlrt ready')
}

async function ensureSourcePlugins(
  downloads: string,
  sevenZr: string,
  onProgress: (percent: number, message: string) => void,
  throwIfCancelled: () => void
): Promise<void> {
  const plugins = getVsPluginsDir()

  // Remove known-bad 32-bit FFMS2 if present
  const existingFfms = path.join(plugins, 'ffms2.dll')
  if (fs.existsSync(existingFfms) && !isPeAmd64(existingFfms)) {
    try {
      fs.unlinkSync(existingFfms)
    } catch {
      // ignore
    }
  }

  onProgress(51, 'Downloading BestSource (64-bit)…')
  const bsZip = path.join(downloads, 'BestSource-R20-win64-clang-vs-only.zip')
  if (!fs.existsSync(bsZip) || fs.statSync(bsZip).size < 1000) {
    await downloadFile(BESTSOURCE_URL, bsZip)
  }
  throwIfCancelled()
  const bsExtract = path.join(downloads, 'bs_extract')
  fs.mkdirSync(bsExtract, { recursive: true })
  await extractZip(bsZip, bsExtract)
  // Release zip ships BestSource-R*-win64-*.dll (not always literally bestsource.dll)
  let resolvedBs =
    findFileRecursive(bsExtract, ['bestsource.dll', 'BestSource.dll'], {
      preferPathSubstr: ['x64', 'win64', 'amd64']
    }) || null
  if (!resolvedBs) {
    const stack = [bsExtract]
    while (stack.length && !resolvedBs) {
      const dir = stack.pop()!
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const ent of entries) {
        const full = path.join(dir, ent.name)
        if (ent.isDirectory()) stack.push(full)
        else if (/bestsource.*\.dll$/i.test(ent.name)) {
          resolvedBs = full
          break
        }
      }
    }
  }
  if (resolvedBs && isPeAmd64(resolvedBs)) {
    const dest = path.join(plugins, 'bestsource.dll')
    fs.mkdirSync(plugins, { recursive: true })
    fs.copyFileSync(resolvedBs, dest)
    const bsDir = path.dirname(resolvedBs)
    for (const f of fs.readdirSync(bsDir)) {
      if (/\.dll$/i.test(f) && !/bestsource/i.test(f)) {
        copyIntoPlugins(path.join(bsDir, f), plugins)
      }
    }
  } else {
    console.warn('[gst-vs] BestSource DLL not found or not AMD64')
  }
  throwIfCancelled()

  onProgress(51, 'Installing FFMS2 x64 source plugin…')
  const ffms7z = path.join(downloads, 'ffms2-2.40-msvc.7z')
  if (!fs.existsSync(ffms7z) || fs.statSync(ffms7z).size < 100) {
    await downloadFile(FFMS2_URL, ffms7z)
  }
  const ffmsExtract = path.join(downloads, 'ffms2_extract')
  fs.mkdirSync(ffmsExtract, { recursive: true })
  await extract7z(sevenZr, ffms7z, ffmsExtract)
  const ffmsDll = findFileRecursive(ffmsExtract, ['ffms2.dll', 'FFMS2.dll'], {
    preferPathSubstr: ['x64', 'win64', 'amd64']
  })
  if (ffmsDll && isPeAmd64(ffmsDll)) {
    copyIntoPlugins(ffmsDll, plugins)
  } else if (ffmsDll) {
    console.warn('[gst-vs] Refusing to install non-AMD64 ffms2.dll from', ffmsDll)
  } else {
    console.warn('[gst-vs] ffms2.dll not found')
  }
}
