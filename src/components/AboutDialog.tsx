import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { AppIcon } from '@/components/AppIcon'
import csvMetaIcon from '../../assets/csv-meta-icon.svg'
import promptgenIcon from '../../assets/promptgen-icon.svg'

interface AboutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface OtherTool {
  name: string
  description: string
  icon: string
  url: string
}

const OTHER_TOOLS: OtherTool[] = [
  {
    name: 'CSV Meta',
    description:
      'Powerful microstock metadata generator with creative designer tools and unique features.',
    icon: csvMetaIcon,
    url: 'https://csvmeta.com'
  },
  {
    name: 'PromptGen',
    description: 'A lightweight handy Chrome extension to generate GenAI image generation prompts.',
    icon: promptgenIcon,
    url: 'https://chromewebstore.google.com/detail/promptgen-ai-image-to-pro/foliaahbfnegnbmclfomfeamfkmnncjm'
  }
]

export function AboutDialog({ open, onOpenChange }: AboutDialogProps): JSX.Element {
  const [version, setVersion] = useState('…')

  useEffect(() => {
    if (!open) return
    void window.electronAPI.getAppVersion().then(setVersion).catch(() => setVersion('1.0.0'))
  }, [open])

  const openTool = (url: string): void => {
    void window.electronAPI.openExternal(url)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader className="items-center sm:items-center text-center space-y-3 pb-1">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--bg-tertiary)] border border-[var(--border)]">
            <AppIcon className="h-8 w-8 text-[var(--accent)]" />
          </div>
          <div className="space-y-1">
            <DialogTitle className="text-xl">NeuralUpscale</DialogTitle>
            <DialogDescription className="text-center">Version {version}</DialogDescription>
          </div>
        </DialogHeader>

        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-tertiary)] px-4 py-3 text-center space-y-2">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              Developer
            </p>
            <p className="text-sm font-medium text-[var(--text-primary)]">Azraf Barno</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)] mb-1">
              License
            </p>
            <p className="text-sm font-medium text-[var(--text-primary)]">GNU GPLv3</p>
          </div>
        </div>

        <div className="space-y-3 pt-1">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            Try our other popular tools
          </p>

          <div className="space-y-2">
            {OTHER_TOOLS.map((tool) => (
              <div
                key={tool.name}
                className="flex gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-3"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] overflow-hidden p-1.5">
                  <img src={tool.icon} alt="" className="h-full w-full object-contain" />
                </div>
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--accent)] hover:underline no-drag"
                    onClick={() => openTool(tool.url)}
                    title={`Open ${tool.name}`}
                  >
                    {tool.name}
                    <ExternalLink className="h-3 w-3 opacity-70" />
                  </button>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {tool.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
