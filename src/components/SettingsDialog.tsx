import { useState, useEffect } from 'react'
import { Cpu, HardDrive, Monitor, Sparkles } from 'lucide-react'
import type { DeviceInfo } from '@/types/electron'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSettings } from '@/hooks/useSettings'
import { useAppStore, type AppSettings, type ScaleFactor } from '@/store/app.store'
import {
  DEFAULT_FORMAT_MODEL_DEFAULTS,
  FORMAT_LABELS,
  INPUT_FILE_FORMATS,
  mergeFormatModelDefaults,
  type InputFileFormat
} from '@/lib/format-models'
import { findModel, parseSelectValue, toSelectValue } from '@/lib/model-select'
import type { GstStatus } from '@/types/electron'

interface SettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** True when the pattern would resolve to the bare original basename (collision risk). */
function namingPatternMayCollide(pattern?: string): boolean {
  const trimmed = (pattern ?? '').trim()
  if (!trimmed) return true
  const sampleName = 'photo'
  const resolved = trimmed
    .split('{filename}')
    .join(sampleName)
    .split('{scale}')
    .join('4')
    .split('{model}')
    .join('model')
    .split('{date}')
    .join('2026-01-01')
  return resolved === sampleName
}

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps): JSX.Element {
  const { settings, saveSettings } = useSettings()
  const models = useAppStore((s) => s.models)
  const setModels = useAppStore((s) => s.setModels)
  const selectedModel = useAppStore((s) => s.selectedModel)
  const selectedModelPath = useAppStore((s) => s.selectedModelPath)
  const selectedScale = useAppStore((s) => s.selectedScale)
  const setSettings = useAppStore((s) => s.setSettings)
  const [local, setLocal] = useState<Partial<AppSettings>>({})
  const [gstStatus, setGstStatus] = useState<GstStatus | null>(null)
  const [gstBusy, setGstBusy] = useState(false)
  const [gstMessage, setGstMessage] = useState('')
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null)
  const [deviceInfoLoading, setDeviceInfoLoading] = useState(false)

  useEffect(() => {
    if (settings) {
      setLocal({
        ...settings,
        formatModelDefaults: mergeFormatModelDefaults(settings.formatModelDefaults)
      })
    }
  }, [settings, open])

  useEffect(() => {
    if (!open) return
    void window.electronAPI.getAvailableModels().then(setModels)
    setDeviceInfoLoading(true)
    void window.electronAPI.getDeviceInfo().then((info) => {
      setDeviceInfo(info)
      setDeviceInfoLoading(false)
    }).catch(() => setDeviceInfoLoading(false))
  }, [open, setModels])

  useEffect(() => {
    if (!open) return
    void window.electronAPI
      .getGstStatus({
        modelName: selectedModel,
        scale: selectedScale,
        modelPath: selectedModelPath
      })
      .then(setGstStatus)
  }, [open, selectedModel, selectedScale, selectedModelPath, local.greenSparkleEnabled])

  const formatDefaults = mergeFormatModelDefaults(local.formatModelDefaults)

  const setFormatModel = (format: InputFileFormat, value: string): void => {
    const { id, modelPath } = parseSelectValue(value)
    const model = findModel(models, id, modelPath)
    setLocal({
      ...local,
      formatModelDefaults: {
        ...formatDefaults,
        [format]: {
          modelId: model?.id ?? id,
          modelPath: model?.modelPath ?? modelPath
        }
      }
    })
  }

  const handleSave = async (): Promise<void> => {
    await saveSettings({
      ...local,
      formatModelDefaults: mergeFormatModelDefaults(local.formatModelDefaults)
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Configure upscaling and interpolation preferences.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <label className="text-sm text-[var(--text-secondary)]">GPU Index (-1 = CPU)</label>
            <input
              type="number"
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 text-sm no-drag"
              value={local.gpuIndex ?? 0}
              onChange={(e) => setLocal({ ...local, gpuIndex: parseInt(e.target.value, 10) })}
            />
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm text-[var(--text-secondary)]">Tile Size</label>
            <Select
              value={String(local.tileSize ?? 0)}
              onValueChange={(v) => setLocal({ ...local, tileSize: parseInt(v, 10) })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">Auto (0)</SelectItem>
                <SelectItem value="100">100</SelectItem>
                <SelectItem value="200">200</SelectItem>
                <SelectItem value="400">400</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm text-[var(--text-secondary)]">Thread Count (-j)</label>
            <input
              type="text"
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 text-sm font-mono-path no-drag"
              value={local.threads ?? '1:2:2'}
              onChange={(e) => setLocal({ ...local, threads: e.target.value })}
              placeholder="1:2:2"
            />
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm text-[var(--text-secondary)]">Default Output Format</label>
            <Tabs
              value={local.defaultOutputFormat ?? 'png'}
              onValueChange={(v) =>
                setLocal({ ...local, defaultOutputFormat: v as 'auto' | 'jpg' | 'png' })
              }
            >
              <TabsList>
                <TabsTrigger value="auto">Auto</TabsTrigger>
                <TabsTrigger value="jpg">JPG</TabsTrigger>
                <TabsTrigger value="png">PNG</TabsTrigger>
              </TabsList>
            </Tabs>
            {local.defaultOutputFormat === 'auto' && (
              <p className="text-xs text-[var(--text-muted)]">
                Matches each input file&apos;s original extension (.jpg / .png)
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <label className="text-sm text-[var(--text-secondary)]">Default Scale</label>
              <p className="text-xs text-[var(--text-muted)] -mt-0.5">Images</p>
              <Tabs
                value={String(local.defaultScale ?? 4)}
                onValueChange={(v) => setLocal({ ...local, defaultScale: parseInt(v, 10) as ScaleFactor })}
              >
                <TabsList>
                  <TabsTrigger value="2">2x</TabsTrigger>
                  <TabsTrigger value="3">3x</TabsTrigger>
                  <TabsTrigger value="4">4x</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="grid gap-1.5">
              <label className="text-sm text-[var(--text-secondary)]">Default Scale</label>
              <p className="text-xs text-[var(--text-muted)] -mt-0.5">Videos</p>
              <Tabs
                value={String(local.defaultVideoScale ?? 4)}
                onValueChange={(v) => setLocal({ ...local, defaultVideoScale: parseInt(v, 10) as ScaleFactor })}
              >
                <TabsList>
                  <TabsTrigger value="2">2x</TabsTrigger>
                  <TabsTrigger value="3">3x</TabsTrigger>
                  <TabsTrigger value="4">4x</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm text-[var(--text-secondary)]">Output Naming Pattern</label>
            <input
              type="text"
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-3 text-sm font-mono-path no-drag"
              value={local.outputNamingPattern ?? '{filename}_upscaled_{scale}x'}
              onChange={(e) => setLocal({ ...local, outputNamingPattern: e.target.value })}
            />
            <p className="text-xs text-[var(--text-muted)]">
              Tokens: {'{filename}'}, {'{scale}'}, {'{model}'}, {'{date}'}
            </p>
            {namingPatternMayCollide(local.outputNamingPattern) && (
              <p className="text-xs text-amber-500">
                This pattern may match the original filename (same folder and format). Use{' '}
                <span className="font-mono-path">{'{filename}-{scale}'}</span> to avoid overwriting
                the source file.
              </p>
            )}
          </div>

          <div className="grid gap-1.5">
            <label className="text-sm text-[var(--text-secondary)]">JPEG Quality: {local.jpegQuality ?? 95}</label>
            <Slider
              value={[local.jpegQuality ?? 95]}
              min={60}
              max={100}
              step={1}
              onValueChange={([v]) => setLocal({ ...local, jpegQuality: v })}
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div>
              <label className="text-sm text-[var(--text-secondary)]">Completion sound</label>
              <p className="text-xs text-[var(--text-muted)]">Play a sound when a job finishes</p>
            </div>
            <Switch
              checked={local.playCompletionSound !== false}
              onCheckedChange={(on) => setLocal({ ...local, playCompletionSound: on })}
            />
          </div>

          <div className="border-t border-[var(--border)] pt-4 mt-1">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <p className="text-sm font-medium">Default model for file formats</p>
                <p className="text-xs text-[var(--text-muted)]">
                  Assign a model per input type. When on, the main model picker is locked and batch
                  jobs switch models automatically.
                </p>
              </div>
              <Switch
                checked={!!local.useFormatModelDefaults}
                onCheckedChange={(on) => setLocal({ ...local, useFormatModelDefaults: on })}
              />
            </div>

            <div
              className={`grid gap-3 ${local.useFormatModelDefaults ? '' : 'opacity-50 pointer-events-none'}`}
            >
              {INPUT_FILE_FORMATS.map((format) => {
                const choice = formatDefaults[format] ?? DEFAULT_FORMAT_MODEL_DEFAULTS[format]
                const value = toSelectValue(choice.modelId, choice.modelPath)
                const known = models.some(
                  (m) => toSelectValue(m.id, m.modelPath) === value
                )
                return (
                  <div key={format} className="grid gap-1.5">
                    <label className="text-sm text-[var(--text-secondary)]">
                      {FORMAT_LABELS[format]}
                    </label>
                    <Select value={known ? value : choice.modelId} onValueChange={(v) => setFormatModel(format, v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {models.map((m) => (
                          <SelectItem
                            key={toSelectValue(m.id, m.modelPath)}
                            value={toSelectValue(m.id, m.modelPath)}
                          >
                            {m.isCustom ? `${m.label} (custom)` : m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="border-t border-[var(--border)] pt-4 mt-1">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-[#76B900]" />
                  Green Sparkle Technology
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  NVIDIA-only TensorRT video upscale. Compiles an engine on this GPU once.
                </p>
              </div>
              <Switch
                checked={!!local.greenSparkleEnabled}
                disabled={gstBusy || !gstStatus?.platformSupported}
                className={local.greenSparkleEnabled ? '!bg-[#76B900] !border-[#76B900]' : undefined}
                onCheckedChange={(on) => {
                  void (async () => {
                    if (!on) {
                      await window.electronAPI.disableGst()
                      const next = await window.electronAPI.getSettings()
                      setSettings(next)
                      setLocal({ ...local, greenSparkleEnabled: false })
                      setGstStatus(await window.electronAPI.getGstStatus({
                        modelName: selectedModel,
                        scale: selectedScale,
                        modelPath: selectedModelPath
                      }))
                      return
                    }
                    setGstBusy(true)
                    setGstMessage('Starting…')
                    window.electronAPI.onGstProgress((ev) => setGstMessage(ev.message))
                    try {
                      const status = await window.electronAPI.enableGst({
                        modelName: selectedModel,
                        scale: selectedScale,
                        modelPath: selectedModelPath
                      })
                      const next = await window.electronAPI.getSettings()
                      setSettings(next)
                      setLocal({ ...local, greenSparkleEnabled: true })
                      setGstStatus(status)
                    } catch (err) {
                      setGstMessage((err as Error).message)
                    } finally {
                      window.electronAPI.offGstProgress()
                      setGstBusy(false)
                    }
                  })()
                }}
              />
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              {gstBusy ? gstMessage : gstStatus?.message || 'Checking GPU…'}
            </p>
            {gstStatus?.gpuName && gstStatus.nvidia && (
              <p className="text-xs text-[var(--text-muted)] mt-1">
                GPU: {gstStatus.gpuName}
                {gstStatus.engineReady ? ' · engine ready' : ''}
              </p>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              disabled={gstBusy || !gstStatus?.platformSupported || !gstStatus.modelSupported}
              onClick={() => {
                void (async () => {
                  setGstBusy(true)
                  setGstMessage('Recompiling engine…')
                  window.electronAPI.onGstProgress((ev) => setGstMessage(ev.message))
                  try {
                    const status = await window.electronAPI.recompileGst({
                      modelName: selectedModel,
                      scale: selectedScale,
                      modelPath: selectedModelPath
                    })
                    const next = await window.electronAPI.getSettings()
                    setSettings(next)
                    setLocal({ ...local, greenSparkleEnabled: true })
                    setGstStatus(status)
                    setGstMessage('Engine recompiled.')
                  } catch (err) {
                    setGstMessage((err as Error).message)
                  } finally {
                    window.electronAPI.offGstProgress()
                    setGstBusy(false)
                  }
                })()
              }}
            >
              Recompile engine
            </Button>
          </div>

          <div className="border-t border-[var(--border)] pt-4 mt-1">
            <p className="text-sm font-medium mb-3">Interpolation defaults</p>

            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <label className="text-sm text-[var(--text-secondary)]">Mode</label>
                <Tabs
                  value={local.defaultInterpolationMode ?? 'multiplier'}
                  onValueChange={(v) =>
                    setLocal({
                      ...local,
                      defaultInterpolationMode: v as 'multiplier' | 'targetFps'
                    })
                  }
                >
                  <TabsList>
                    <TabsTrigger value="multiplier">Multiplier</TabsTrigger>
                    <TabsTrigger value="targetFps">Target FPS</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm text-[var(--text-secondary)]">Default Multiplier</label>
                <Tabs
                  value={String(local.defaultInterpolationMultiplier ?? 2)}
                  onValueChange={(v) =>
                    setLocal({
                      ...local,
                      defaultInterpolationMultiplier: parseInt(v, 10) as 2 | 4
                    })
                  }
                >
                  <TabsList>
                    <TabsTrigger value="2">2×</TabsTrigger>
                    <TabsTrigger value="4">4×</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <div className="grid gap-1.5">
                <label className="text-sm text-[var(--text-secondary)]">Default Target FPS</label>
                <div className="flex items-center gap-2">
                  <Tabs
                    value={
                      [48, 60, 90, 120].includes(local.defaultInterpolationTargetFps ?? 60)
                        ? String(local.defaultInterpolationTargetFps ?? 60)
                        : 'custom'
                    }
                    onValueChange={(v) => {
                      if (v !== 'custom') {
                        setLocal({ ...local, defaultInterpolationTargetFps: parseInt(v, 10) })
                      }
                    }}
                  >
                    <TabsList>
                      {[48, 60, 90, 120].map((fps) => (
                        <TabsTrigger key={fps} value={String(fps)}>
                          {fps}
                        </TabsTrigger>
                      ))}
                    </TabsList>
                  </Tabs>
                  <input
                    type="number"
                    min={1}
                    max={240}
                    step={1}
                    className="h-9 w-20 rounded-md border border-[var(--border)] bg-[var(--bg-tertiary)] px-2 text-sm no-drag"
                    value={local.defaultInterpolationTargetFps ?? 60}
                    onChange={(e) =>
                      setLocal({
                        ...local,
                        defaultInterpolationTargetFps: Math.max(
                          1,
                          Math.min(240, parseInt(e.target.value, 10) || 60)
                        )
                      })
                    }
                  />
                </div>
                <p className="text-xs text-[var(--text-muted)]">
                  Applied when you open the Interpolation page
                </p>
              </div>
            </div>
          </div>
          {/* ── Device Info ── */}
          <div className="border-t border-[var(--border)] pt-4 mt-1">
            <p className="text-sm font-medium mb-3">Device Info</p>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] overflow-hidden">
              {deviceInfoLoading || !deviceInfo ? (
                <div className="flex items-center justify-center py-6 text-sm text-[var(--text-muted)]">
                  {deviceInfoLoading ? 'Detecting hardware…' : 'No data'}
                </div>
              ) : (
                <div className="divide-y divide-[var(--border)]">
                  {/* OS */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <Monitor className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Operating System</p>
                      <p className="text-sm text-[var(--text-primary)] break-words">{deviceInfo.osName}</p>
                      <p className="text-xs text-[var(--text-muted)]">Architecture: {deviceInfo.osArch}</p>
                    </div>
                  </div>

                  {/* CPU */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <Cpu className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">Processor</p>
                      <p className="text-sm text-[var(--text-primary)] break-words">{deviceInfo.cpuModel}</p>
                      <p className="text-xs text-[var(--text-muted)]">
                        {deviceInfo.cpuCores} cores · {deviceInfo.cpuThreads} threads
                      </p>
                    </div>
                  </div>

                  {/* RAM */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <HardDrive className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">System Memory</p>
                      <p className="text-sm text-[var(--text-primary)]">
                        {deviceInfo.totalRamMB >= 1024
                          ? `${(deviceInfo.totalRamMB / 1024).toFixed(1)} GB RAM`
                          : `${deviceInfo.totalRamMB} MB RAM`}
                      </p>
                    </div>
                  </div>

                  {/* GPU */}
                  <div className="flex items-start gap-3 px-4 py-3">
                    <Sparkles className="h-4 w-4 mt-0.5 shrink-0 text-[var(--accent)]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wider mb-0.5">GPU</p>
                      <p className="text-sm text-[var(--text-primary)] break-words">{deviceInfo.gpuName}</p>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                        <span className={`text-xs font-medium ${deviceInfo.gpuVulkan ? 'text-[var(--success)]' : 'text-[var(--error)]'}`}>
                          {deviceInfo.gpuVulkan ? '✓ Vulkan' : '✗ No Vulkan (CPU fallback)'}
                        </span>
                        {deviceInfo.gpuNvidia && (
                          <span className="text-xs font-medium text-[#76B900]">✓ NVIDIA · TensorRT ready</span>
                        )}
                        {deviceInfo.gpuVramMB != null && (
                          <span className="text-xs text-[var(--text-muted)]">
                            {deviceInfo.gpuVramMB >= 1024
                              ? `${(deviceInfo.gpuVramMB / 1024).toFixed(1)} GB VRAM`
                              : `${deviceInfo.gpuVramMB} MB VRAM`}
                          </span>
                        )}
                        {deviceInfo.gpuComputeCap && (
                          <span className="text-xs text-[var(--text-muted)]">SM {deviceInfo.gpuComputeCap}</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
