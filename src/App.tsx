import { useState, useEffect, type ComponentType } from 'react'
import { Settings, Sun, Moon, Minus, Square, X, Image as ImageIcon, Film, Gauge, Info } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { useGpuInfo } from '@/hooks/useGpuInfo'
import { useSettings } from '@/hooks/useSettings'
import { GpuStatusBadge } from '@/components/GpuStatusBadge'
import { SettingsDialog } from '@/components/SettingsDialog'
import { AboutDialog } from '@/components/AboutDialog'
import { FirstRunModal } from '@/components/FirstRunModal'
import { Toaster } from '@/components/Toaster'
import { TooltipProvider } from '@/components/ui/tooltip'
import { AppIcon } from '@/components/AppIcon'
import { ImageUpscalePage } from '@/pages/ImageUpscalePage'
import { VideoUpscalePage } from '@/pages/VideoUpscalePage'
import { InterpolationPage } from '@/pages/InterpolationPage'
import { cn } from '@/lib/utils'

function NavItem({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  active?: boolean
  onClick: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-2.5 w-full rounded-xl px-2 py-5 no-drag transition-colors',
        active
          ? 'bg-[var(--bg-tertiary)] text-[var(--text-primary)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]/70 hover:text-[var(--text-primary)]'
      )}
    >
      <Icon className={cn('h-9 w-9', active && 'text-[var(--accent)]')} strokeWidth={1.5} />
      <span className="text-[11px] font-medium leading-snug text-center px-0.5 whitespace-pre-line">{label}</span>
    </button>
  )
}

export default function App(): JSX.Element {
  const settings = useAppStore((s) => s.settings)
  const modelsMissing = useAppStore((s) => s.modelsMissing)
  const setModelsMissing = useAppStore((s) => s.setModelsMissing)
  const page = useAppStore((s) => s.page)
  const setPage = useAppStore((s) => s.setPage)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [firstRunOpen, setFirstRunOpen] = useState(false)
  const [showWindowControls, setShowWindowControls] = useState(true)

  useGpuInfo()
  const { saveSettings } = useSettings()

  useEffect(() => {
    setShowWindowControls(window.electronAPI.getPlatform() !== 'darwin')
  }, [])

  useEffect(() => {
    window.electronAPI.checkModelsExist().then((exists) => {
      setModelsMissing(!exists)
      if (!exists) setFirstRunOpen(true)
    })
  }, [setModelsMissing])

  const toggleTheme = async (): Promise<void> => {
    const next = settings?.theme === 'dark' ? 'light' : 'dark'
    await saveSettings({ theme: next })
  }

  return (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <header className="flex items-center h-12 px-4 border-b border-[var(--border)] bg-[var(--bg-secondary)] drag-region shrink-0 select-none">
          <div className="flex items-center gap-2">
            <AppIcon className="h-5 w-5 text-[var(--accent)]" />
            <span className="font-semibold text-base">NeuralUpscale</span>
          </div>

          <div className="flex-1 flex justify-center min-w-0 px-4">
            <GpuStatusBadge />
          </div>

          <div className="flex items-center gap-1 no-drag">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
              title="Toggle theme"
            >
              {settings?.theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setAboutOpen(true)}
              className="p-2 rounded-md hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
              title="About"
            >
              <Info className="h-4 w-4" />
            </button>
            {showWindowControls && (
              <div className="flex items-center ml-2 border-l border-[var(--border)] pl-2">
                <button onClick={() => window.electronAPI.windowMinimize()} className="p-2 hover:bg-[var(--bg-tertiary)]">
                  <Minus className="h-4 w-4" />
                </button>
                <button onClick={() => window.electronAPI.windowMaximize()} className="p-2 hover:bg-[var(--bg-tertiary)]">
                  <Square className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => window.electronAPI.windowClose()} className="p-2 hover:bg-[var(--error)] hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="flex flex-1 min-h-0">
          <aside className="w-[128px] shrink-0 border-r border-[var(--border)] bg-[var(--bg-secondary)] flex flex-col">
            <nav className="flex-1 flex flex-col gap-2 p-2.5 pt-3 min-h-0">
              <NavItem
                icon={ImageIcon}
                label={"Image Upscale"}
                active={page === 'image'}
                onClick={() => setPage('image')}
              />
              <NavItem
                icon={Film}
                label={"Video Upscale"}
                active={page === 'video'}
                onClick={() => setPage('video')}
              />
              <NavItem
                icon={Gauge}
                label="Interpolation"
                active={page === 'interpolation'}
                onClick={() => setPage('interpolation')}
              />
            </nav>
            <div className="p-2.5 pb-3 border-t border-[var(--border)]">
              <NavItem
                icon={Settings}
                label="Settings"
                active={settingsOpen}
                onClick={() => setSettingsOpen(true)}
              />
            </div>
          </aside>

          <main className="flex-1 overflow-auto p-6 min-w-0">
            {page === 'image' ? (
              <ImageUpscalePage />
            ) : page === 'video' ? (
              <VideoUpscalePage />
            ) : (
              <InterpolationPage />
            )}
          </main>
        </div>

        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
        <FirstRunModal
          open={firstRunOpen && modelsMissing}
          onOpenChange={setFirstRunOpen}
          onSetupComplete={() => setModelsMissing(false)}
        />
        <Toaster />
      </div>
    </TooltipProvider>
  )
}
