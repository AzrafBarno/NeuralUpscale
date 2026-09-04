import { execFileSync, execSync, spawn } from 'child_process'
import fs from 'fs'
import type { GpuInfo } from '../types'
import { getBinaryPath } from './paths'

export function buildGpuFingerprint(info: Pick<GpuInfo, 'nvidiaName' | 'gpuName' | 'computeCap' | 'gpuUuid'>): string {
  const raw = info.nvidiaName || info.gpuName || 'gpu'
  const name = raw.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'gpu'
  const sm = (info.computeCap || 'unknown').replace(/[^\d.]+/g, '')
  const uuid = (info.gpuUuid || '').replace(/[^A-Za-z0-9-]+/g, '').slice(0, 8)
  return uuid ? `${name}-sm${sm}-${uuid}` : `${name}-sm${sm}`
}

export class GpuDetectService {
  async detect(): Promise<GpuInfo> {
    let gpuName = this.detectSystemGpuName()
    let vulkanSupported = false

    const binaryPath = getBinaryPath()
    if (fs.existsSync(binaryPath)) {
      try {
        const output = await this.runBinaryHelp(binaryPath)
        vulkanSupported = /vulkan/i.test(output) && !/no vulkan/i.test(output)
        const adapterMatch = output.match(/\[(\d+)\]\s+(.+)/)
        if (adapterMatch && vulkanSupported) {
          gpuName = adapterMatch[2].trim()
        }
      } catch {
        vulkanSupported = false
      }
    }

    const nvidia = this.detectNvidia()
    const displayName = vulkanSupported ? gpuName : nvidia.nvidia ? nvidia.nvidiaName || gpuName : 'CPU fallback'

    const info: GpuInfo = {
      gpuName: displayName,
      vulkanSupported,
      gpuIndex: vulkanSupported ? 0 : -1,
      nvidia: nvidia.nvidia,
      nvidiaName: nvidia.nvidiaName,
      computeCap: nvidia.computeCap,
      vramMB: nvidia.vramMB,
      gpuUuid: nvidia.gpuUuid
    }
    if (info.nvidia) {
      info.fingerprint = buildGpuFingerprint(info)
    }
    return info
  }

  private detectNvidia(): Pick<GpuInfo, 'nvidia' | 'nvidiaName' | 'computeCap' | 'vramMB' | 'gpuUuid'> {
    if (process.platform === 'darwin') {
      return { nvidia: false }
    }

    const smi = this.findNvidiaSmi()
    if (smi) {
      try {
        const out = execFileSync(
          smi,
          ['--query-gpu=name,compute_cap,memory.total,uuid', '--format=csv,noheader,nounits'],
          { encoding: 'utf-8', timeout: 5000, windowsHide: true }
        )
        const line = out
          .split('\n')
          .map((l) => l.trim())
          .find(Boolean)
        if (line) {
          const parts = line.split(',').map((p) => p.trim())
          const nvidiaName = parts[0] || undefined
          const computeCap = parts[1] || undefined
          const vramMB = parts[2] ? parseInt(parts[2], 10) : undefined
          const gpuUuid = parts[3] || undefined
          return {
            nvidia: true,
            nvidiaName,
            computeCap,
            vramMB: Number.isFinite(vramMB) ? vramMB : undefined,
            gpuUuid
          }
        }
      } catch {
        // fall through to name heuristic
      }
    }

    const systemName = this.detectSystemGpuName()
    if (/nvidia/i.test(systemName)) {
      return { nvidia: true, nvidiaName: systemName }
    }
    return { nvidia: false }
  }

  private findNvidiaSmi(): string | null {
    const candidates =
      process.platform === 'win32'
        ? [
            'nvidia-smi',
            'C:\\Windows\\System32\\nvidia-smi.exe',
            'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe'
          ]
        : ['nvidia-smi', '/usr/bin/nvidia-smi', '/usr/local/bin/nvidia-smi']

    for (const cmd of candidates) {
      try {
        execFileSync(cmd, ['-L'], { encoding: 'utf-8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] })
        return cmd
      } catch {
        // try next
      }
    }
    return null
  }

  private runBinaryHelp(binaryPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath, ['-h'])
      let output = ''
      proc.stdout.on('data', (d: Buffer) => {
        output += d.toString()
      })
      proc.stderr.on('data', (d: Buffer) => {
        output += d.toString()
      })
      proc.on('close', () => resolve(output))
      proc.on('error', reject)
    })
  }

  private detectSystemGpuName(): string {
    try {
      if (process.platform === 'win32') {
        try {
          const out = execSync('wmic path win32_VideoController get name', {
            encoding: 'utf-8',
            timeout: 5000
          })
          const lines = out
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l && l !== 'Name')
          if (lines.length > 0) return lines[0]
        } catch {
          const psOut = execSync(
            'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"',
            { encoding: 'utf-8', timeout: 5000 }
          )
          const lines = psOut.split('\n').map((l) => l.trim()).filter(Boolean)
          if (lines.length > 0) return lines[0]
        }
      } else if (process.platform === 'darwin') {
        const out = execSync('system_profiler SPDisplaysDataType', {
          encoding: 'utf-8',
          timeout: 8000
        })
        const match = out.match(/Chipset Model:\s*(.+)/)
        if (match) return match[1].trim()
      } else {
        const out = execSync('lspci | grep -i vga', { encoding: 'utf-8', timeout: 5000 })
        if (out.trim()) return out.trim()
      }
    } catch {
      // fall through
    }
    return 'Unknown GPU'
  }
}
