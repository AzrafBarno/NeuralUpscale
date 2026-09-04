import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { shell } from 'electron'
import type { FileInfo, CustomModelInfo } from '../types'
import { getFfmpegPath } from './paths'
import { killProcessTree } from './process-kill'

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])
const VIDEO_EXTENSIONS = new Set(['.mp4'])

export class FileService {
  async getFileInfo(filePath: string): Promise<FileInfo> {
    const stat = fs.statSync(filePath)
    const meta = await sharp(filePath).metadata()
    return {
      path: filePath,
      width: meta.width ?? 0,
      height: meta.height ?? 0,
      size: stat.size,
      format: meta.format ?? path.extname(filePath).slice(1)
    }
  }

  scanFolderRecursive(folderPath: string): string[] {
    return this.scanFolderByExtensions(folderPath, IMAGE_EXTENSIONS)
  }

  scanVideoFolder(folderPath: string): string[] {
    return this.scanFolderByExtensions(folderPath, VIDEO_EXTENSIONS)
  }

  private scanFolderByExtensions(folderPath: string, extensions: Set<string>): string[] {
    // Non-recursive: only matching files directly inside the selected folder
    const results: string[] = []
    if (!fs.existsSync(folderPath)) return results

    const entries = fs.readdirSync(folderPath, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile()) continue
      const ext = path.extname(entry.name).toLowerCase()
      if (extensions.has(ext)) {
        results.push(path.join(folderPath, entry.name))
      }
    }

    return results.sort()
  }

  buildOutputPath(
    inputPath: string,
    outputDir: string,
    scale: number,
    modelName: string,
    format: string,
    pattern = '{filename}_upscaled_{scale}x'
  ): string {
    const parsed = path.parse(inputPath)
    const date = new Date().toISOString().slice(0, 10)
    const effectivePattern = pattern.trim() || '{filename}_upscaled_{scale}x'
    const baseName = effectivePattern
      .split('{filename}')
      .join(parsed.name)
      .split('{scale}')
      .join(String(scale))
      .split('{model}')
      .join(modelName)
      .split('{date}')
      .join(date)

    const resolved = this.resolveOutputFormat(format, inputPath)
    const ext = resolved === 'jpg' ? '.jpg' : '.png'
    let result = path.join(outputDir, `${baseName}${ext}`)

    // Avoid overwriting the source when the pattern resolves to the same path
    if (path.resolve(result) === path.resolve(inputPath)) {
      result = path.join(outputDir, `${parsed.name}-${scale}${ext}`)
    }

    return result
  }

  resolveOutputFormat(format: string, inputPath: string): 'jpg' | 'png' {
    if (format === 'jpg' || format === 'jpeg') return 'jpg'
    if (format === 'png') return 'png'
    // auto — match input extension
    const ext = path.extname(inputPath).toLowerCase()
    if (ext === '.jpg' || ext === '.jpeg') return 'jpg'
    return 'png'
  }

  applyFormatExtension(filePath: string, format: 'jpg' | 'png'): string {
    const ext = format === 'jpg' ? '.jpg' : '.png'
    return filePath.replace(/\.[^.]+$/, '') + ext
  }

  ensureDistinctOutputPath(inputPath: string, outputPath: string, scale = 4, format = 'png'): string {
    const resolved = this.resolveOutputFormat(format, inputPath)
    let result = outputPath.trim()
      ? this.applyFormatExtension(outputPath, resolved)
      : this.buildOutputPath(inputPath, path.dirname(inputPath), scale, 'realesrgan-x4plus', resolved)

    if (path.resolve(inputPath) === path.resolve(result)) {
      const parsed = path.parse(inputPath)
      const ext = resolved === 'jpg' ? '.jpg' : '.png'
      result = path.join(parsed.dir, `${parsed.name}-${scale}${ext}`)
    }
    return result
  }

  async createThumbnailDataUrl(filePath: string, size = 160): Promise<string | null> {
    const ext = path.extname(filePath).toLowerCase()
    if (VIDEO_EXTENSIONS.has(ext)) {
      return this.createVideoThumbnailDataUrl(filePath, size)
    }
    try {
      const buffer = await sharp(filePath)
        .resize(size, size, { fit: 'cover', withoutEnlargement: true })
        .jpeg({ quality: 70, mozjpeg: true })
        .toBuffer()
      return `data:image/jpeg;base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  }

  private createVideoThumbnailDataUrl(filePath: string, size: number): Promise<string | null> {
    const ffmpeg = getFfmpegPath()
    if (!fs.existsSync(ffmpeg)) return Promise.resolve(null)

    return new Promise((resolve) => {
      const args = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-nostdin',
        '-i',
        filePath,
        '-an',
        '-frames:v',
        '1',
        '-vf',
        `scale=${size}:${size}:force_original_aspect_ratio=increase,crop=${size}:${size}`,
        '-f',
        'image2pipe',
        '-vcodec',
        'mjpeg',
        'pipe:1'
      ]
      const proc = spawn(ffmpeg, args, { windowsHide: true })
      const chunks: Buffer[] = []
      let settled = false
      const finish = (result: string | null): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve(result)
      }
      const timer = setTimeout(() => {
        killProcessTree(proc)
        finish(null)
      }, 12000)

      proc.stdout.on('data', (d: Buffer) => chunks.push(d))
      proc.on('error', () => finish(null))
      proc.on('close', (code) => {
        if (code !== 0 || chunks.length === 0) {
          finish(null)
          return
        }
        finish(`data:image/jpeg;base64,${Buffer.concat(chunks).toString('base64')}`)
      })
    })
  }

  openInExplorer(filePath: string): void {
    if (fs.existsSync(filePath)) {
      shell.showItemInFolder(filePath)
    } else {
      shell.openPath(path.dirname(filePath))
    }
  }

  ensureDir(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  }

  scanModelPairs(folderPath: string, recursive = true): CustomModelInfo[] {
    const results: CustomModelInfo[] = []
    const seen = new Set<string>()

    const scanDir = (dir: string): void => {
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (recursive) scanDir(fullPath)
          continue
        }
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.bin')) continue

        const paramPath = fullPath.replace(/\.bin$/i, '.param')
        if (!fs.existsSync(paramPath)) continue

        const id = path.basename(entry.name, '.bin')
        const key = `${path.dirname(fullPath)}::${id}`
        if (seen.has(key)) continue
        seen.add(key)

        results.push({
          id,
          label: id,
          modelPath: path.dirname(fullPath)
        })
      }
    }

    scanDir(folderPath)
    return results.sort((a, b) => a.label.localeCompare(b.label))
  }
}
