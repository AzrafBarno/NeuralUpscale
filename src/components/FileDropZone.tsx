import { useCallback, useState } from 'react'
import { ImageIcon, Upload, X } from 'lucide-react'
import { useAppStore } from '@/store/app.store'
import { cn, formatBytes } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface FileDropZoneProps {
  onFileSelected?: (path: string) => void
  onCleared?: () => void
}

export function FileDropZone({ onFileSelected, onCleared }: FileDropZoneProps): JSX.Element {
  const inputFile = useAppStore((s) => s.inputFile)
  const setInputFile = useAppStore((s) => s.setInputFile)
  const setOutputFile = useAppStore((s) => s.setOutputFile)
  const setOutputPath = useAppStore((s) => s.setOutputPath)
  const setProgress = useAppStore((s) => s.setProgress)
  const [dragOver, setDragOver] = useState(false)

  const loadFile = useCallback(
    async (filePath: string) => {
      const info = await window.electronAPI.getFileInfo(filePath)
      const previewUrl = await window.electronAPI.getImageUrl(filePath)
      setInputFile({ ...info, previewUrl })
      setOutputFile(null)
      onFileSelected?.(filePath)
    },
    [setInputFile, setOutputFile, onFileSelected]
  )

  const handleClear = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setInputFile(null)
      setOutputFile(null)
      setOutputPath('')
      setProgress(0, '')
      onCleared?.()
    },
    [setInputFile, setOutputFile, setOutputPath, setProgress, onCleared]
  )

  const handleBrowse = async (): Promise<void> => {
    const path = await window.electronAPI.openFileDialog()
    if (path) await loadFile(path)
  }

  const handleDrop = async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    setDragOver(false)
    const path = e.dataTransfer.files[0]?.path
    if (path) await loadFile(path)
  }

  if (inputFile) {
    return (
      <div className="flex items-center gap-4 p-4 rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        {inputFile.previewUrl && (
          <img
            src={inputFile.previewUrl}
            alt="Preview"
            className="h-16 w-16 object-cover rounded-md"
          />
        )}
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{inputFile.path.split(/[/\\]/).pop()}</p>
          <p className="text-sm text-[var(--text-secondary)]">
            {inputFile.width} × {inputFile.height} · {formatBytes(inputFile.size)}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            className="text-sm text-[var(--accent)] hover:underline no-drag"
            onClick={handleBrowse}
          >
            Change
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5 no-drag"
            onClick={handleClear}
            title="Clear image"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 p-8 rounded-lg border-2 border-dashed border-[var(--border)] cursor-pointer transition-all no-drag',
        dragOver && 'border-[var(--accent)] bg-[var(--accent)]/5 scale-[1.02]',
        'hover:border-[var(--accent)]'
      )}
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={handleBrowse}
    >
      <div className="p-3 rounded-full bg-[var(--bg-tertiary)]">
        {dragOver ? (
          <Upload className="h-8 w-8 text-[var(--accent)]" />
        ) : (
          <ImageIcon className="h-8 w-8 text-[var(--text-muted)]" />
        )}
      </div>
      <div className="text-center">
        <p className="font-medium">Drag image here</p>
        <p className="text-sm text-[var(--text-muted)]">or click to browse · JPG, PNG</p>
      </div>
    </div>
  )
}
