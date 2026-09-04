import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ExternalLink, Download } from 'lucide-react'
import { useState } from 'react'

interface FirstRunModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSetupComplete: () => void
}

export function FirstRunModal({ open, onOpenChange, onSetupComplete }: FirstRunModalProps): JSX.Element {
  const [settingUp, setSettingUp] = useState(false)
  const [message, setMessage] = useState('')

  const runSetup = async (): Promise<void> => {
    setSettingUp(true)
    setMessage('Downloading binaries and models...')
    const result = await window.electronAPI.runSetup()
    setMessage(result.message)
    setSettingUp(false)
    if (result.success) {
      onSetupComplete()
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Models Not Found</DialogTitle>
          <DialogDescription>
            NeuralUpscale requires Real-ESRGAN model weights and the ncnn-vulkan binary.
            Run the setup script to download them automatically, or download manually.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <a
            href="https://github.com/xinntao/Real-ESRGAN/releases"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[var(--accent)] hover:underline no-drag"
          >
            <ExternalLink className="h-4 w-4" />
            Real-ESRGAN Releases
          </a>
          <a
            href="https://github.com/upscayl/upscayl/releases"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2 text-[var(--accent)] hover:underline no-drag"
          >
            <ExternalLink className="h-4 w-4" />
            Upscayl Releases (alternative models)
          </a>
          <p className="text-[var(--text-muted)]">
            Place .bin and .param pairs in <code className="font-mono-path">resources/models/</code>
          </p>
          {message && <p className="text-sm">{message}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={settingUp}>
            Skip for now
          </Button>
          <Button onClick={runSetup} disabled={settingUp}>
            <Download className="h-4 w-4" />
            {settingUp ? 'Downloading...' : 'Run Setup'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
