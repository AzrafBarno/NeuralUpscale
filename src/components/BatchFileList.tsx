import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  Check,
  Circle,
  LayoutGrid,
  LayoutList,
  List,
  Loader2,
  Square,
  SquareCheck,
  Trash2,
  X
} from 'lucide-react'
import { useAppStore, type BatchFileInfo } from '@/store/app.store'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type BatchViewMode = 'list' | 'compact' | 'tiles'

interface BatchFileListProps {
  viewMode: BatchViewMode
  onViewModeChange: (mode: BatchViewMode) => void
  canEdit: boolean
  onRemove: (index: number) => void
  onRemoveSelected: () => void
  onClear: () => void
}

export function BatchFileList({
  viewMode,
  onViewModeChange,
  canEdit,
  onRemove,
  onRemoveSelected,
  onClear
}: BatchFileListProps): JSX.Element {
  const batchFiles = useAppStore((s) => s.batchFiles)
  const toggleBatchSelection = useAppStore((s) => s.toggleBatchSelection)
  const selectBatchRange = useAppStore((s) => s.selectBatchRange)
  const selectAllBatchFiles = useAppStore((s) => s.selectAllBatchFiles)
  const lastAnchorRef = useRef<number | null>(null)

  const selectedCount = batchFiles.filter((f) => f.selected).length
  const allSelected = batchFiles.length > 0 && selectedCount === batchFiles.length

  const handleSelectClick = useCallback(
    (index: number, e: MouseEvent) => {
      if (!canEdit) return
      if (e.shiftKey && lastAnchorRef.current !== null) {
        selectBatchRange(lastAnchorRef.current, index)
      } else {
        toggleBatchSelection(index)
        lastAnchorRef.current = index
      }
    },
    [canEdit, selectBatchRange, toggleBatchSelection]
  )

  if (batchFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Select an input folder to see the file queue
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between gap-2 mb-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!canEdit}
            onClick={() => selectAllBatchFiles(!allSelected)}
            title={allSelected ? 'Deselect all' : 'Select all'}
          >
            {allSelected ? <Square className="h-3.5 w-3.5" /> : <SquareCheck className="h-3.5 w-3.5" />}
            {allSelected ? 'Deselect all' : 'Select all'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!canEdit || selectedCount === 0}
            onClick={onRemoveSelected}
            title="Remove selected images"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Remove selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-[var(--text-muted)]"
            disabled={!canEdit}
            onClick={onClear}
          >
            Clear all
          </Button>
          <span className="text-xs text-[var(--text-muted)]">
            {selectedCount} / {batchFiles.length} selected
          </span>
        </div>
        <div className="flex items-center gap-1">
          <ViewToggleButton
            active={viewMode === 'list'}
            title="List"
            onClick={() => onViewModeChange('list')}
          >
            <List className="h-4 w-4" />
          </ViewToggleButton>
          <ViewToggleButton
            active={viewMode === 'compact'}
            title="Compact with thumbnails"
            onClick={() => onViewModeChange('compact')}
          >
            <LayoutList className="h-4 w-4" />
          </ViewToggleButton>
          <ViewToggleButton
            active={viewMode === 'tiles'}
            title="Tiles"
            onClick={() => onViewModeChange('tiles')}
          >
            <LayoutGrid className="h-4 w-4" />
          </ViewToggleButton>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {viewMode === 'tiles' ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {batchFiles.map((file) => (
              <TileItem
                key={file.path}
                file={file}
                canEdit={canEdit}
                onRemove={onRemove}
                onSelectClick={handleSelectClick}
              />
            ))}
          </div>
        ) : viewMode === 'compact' ? (
          <div className="flex flex-col gap-0.5">
            {batchFiles.map((file) => (
              <CompactItem
                key={file.path}
                file={file}
                canEdit={canEdit}
                onRemove={onRemove}
                onSelectClick={handleSelectClick}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {batchFiles.map((file) => (
              <ListItem
                key={file.path}
                file={file}
                canEdit={canEdit}
                onRemove={onRemove}
                onSelectClick={handleSelectClick}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ViewToggleButton({
  active,
  title,
  onClick,
  children
}: {
  active: boolean
  title: string
  onClick: () => void
  children: ReactNode
}): JSX.Element {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={title}
      onClick={onClick}
      className={cn('h-8 w-8', active && 'bg-[var(--bg-tertiary)] text-[var(--accent)]')}
    >
      {children}
    </Button>
  )
}

interface ItemProps {
  file: BatchFileInfo
  canEdit: boolean
  onRemove: (index: number) => void
  onSelectClick: (index: number, e: MouseEvent) => void
}

function filePropsEqual(a: ItemProps, b: ItemProps): boolean {
  return (
    a.file.path === b.file.path &&
    a.file.index === b.file.index &&
    a.file.status === b.file.status &&
    a.file.filePercent === b.file.filePercent &&
    a.file.fileName === b.file.fileName &&
    a.file.selected === b.file.selected &&
    a.canEdit === b.canEdit &&
    a.onRemove === b.onRemove &&
    a.onSelectClick === b.onSelectClick
  )
}

function SelectionCheckbox({
  selected,
  disabled,
  onClick
}: {
  selected: boolean
  disabled: boolean
  onClick: (e: MouseEvent) => void
}): JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={cn(
        'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors no-drag',
        selected
          ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
          : 'border-[var(--border)] bg-transparent hover:border-[var(--accent)]',
        disabled && 'opacity-50 cursor-not-allowed'
      )}
      title={selected ? 'Deselect' : 'Select'}
    >
      {selected && <Check className="h-3 w-3" strokeWidth={3} />}
    </button>
  )
}

const ListItem = memo(function ListItem({
  file,
  canEdit,
  onRemove,
  onSelectClick
}: ItemProps): JSX.Element {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-[var(--bg-tertiary)]',
        file.selected && 'bg-[var(--accent)]/10'
      )}
    >
      <SelectionCheckbox
        selected={file.selected}
        disabled={!canEdit}
        onClick={(e) => onSelectClick(file.index, e)}
      />
      <StatusIcon status={file.status} />
      <span className="flex-1 truncate text-sm font-mono-path">{file.fileName}</span>
      {(file.status === 'processing' || file.filePercent > 0) && (
        <div className="w-28">
          <Progress value={file.filePercent} shimmer={file.status === 'processing'} />
        </div>
      )}
      <span className={cn('text-xs w-16 text-right', statusColor(file.status))}>
        {statusLabel(file.status)}
      </span>
      <RemoveButton canEdit={canEdit} onClick={() => onRemove(file.index)} />
    </div>
  )
}, filePropsEqual)

const CompactItem = memo(function CompactItem({
  file,
  canEdit,
  onRemove,
  onSelectClick
}: ItemProps): JSX.Element {
  return (
    <div
      className={cn(
        'group flex items-center gap-3 px-2 py-1.5 rounded-md hover:bg-[var(--bg-tertiary)]',
        file.selected && 'bg-[var(--accent)]/10'
      )}
    >
      <SelectionCheckbox
        selected={file.selected}
        disabled={!canEdit}
        onClick={(e) => onSelectClick(file.index, e)}
      />
      <LazyThumbnail path={file.path} size="sm" />
      <StatusIcon status={file.status} />
      <span className="flex-1 truncate text-sm font-mono-path">{file.fileName}</span>
      {(file.status === 'processing' || file.filePercent > 0) && (
        <div className="w-24">
          <Progress value={file.filePercent} shimmer={file.status === 'processing'} />
        </div>
      )}
      <span className={cn('text-xs w-16 text-right', statusColor(file.status))}>
        {statusLabel(file.status)}
      </span>
      <RemoveButton canEdit={canEdit} onClick={() => onRemove(file.index)} />
    </div>
  )
}, filePropsEqual)

const TileItem = memo(function TileItem({
  file,
  canEdit,
  onRemove,
  onSelectClick
}: ItemProps): JSX.Element {
  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-[var(--bg-secondary)] overflow-hidden transition-colors',
        file.selected ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border)] hover:border-[var(--accent)]'
      )}
    >
      <div className="relative aspect-square bg-[var(--bg-tertiary)]">
        <LazyThumbnail path={file.path} size="lg" className="absolute inset-0" />
        <div className="absolute top-1.5 left-1.5 z-10">
          <SelectionCheckbox
            selected={file.selected}
            disabled={!canEdit}
            onClick={(e) => onSelectClick(file.index, e)}
          />
        </div>
        <div className="absolute top-1.5 right-8 rounded-full bg-black/60 p-1">
          <StatusIcon status={file.status} />
        </div>
        {canEdit && (
          <button
            type="button"
            title="Remove"
            onClick={() => onRemove(file.index)}
            className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white opacity-0 group-hover:opacity-100 hover:bg-[var(--error)] transition-opacity no-drag"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {file.status === 'processing' && (
          <div className="absolute inset-x-0 bottom-0 p-1.5">
            <Progress value={file.filePercent} shimmer />
          </div>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-xs font-mono-path truncate" title={file.fileName}>
          {file.fileName}
        </p>
        <p className={cn('text-[10px]', statusColor(file.status))}>{statusLabel(file.status)}</p>
      </div>
    </div>
  )
}, filePropsEqual)

function RemoveButton({
  canEdit,
  onClick
}: {
  canEdit: boolean
  onClick: () => void
}): JSX.Element | null {
  if (!canEdit) return null
  return (
    <button
      type="button"
      title="Remove"
      onClick={onClick}
      className="p-1 rounded opacity-0 group-hover:opacity-100 text-[var(--text-muted)] hover:text-[var(--error)] transition-opacity no-drag"
    >
      <X className="h-4 w-4" />
    </button>
  )
}

const thumbnailCache = new Map<string, string | null>()
const thumbnailInflight = new Map<string, Promise<string | null>>()

function LazyThumbnail({
  path,
  size,
  className
}: {
  path: string
  size: 'sm' | 'lg'
  className?: string
}): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [src, setSrc] = useState<string | null>(() => thumbnailCache.get(path) ?? null)
  const [visible, setVisible] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const cached = thumbnailCache.get(path)
    if (cached !== undefined) {
      setSrc(cached)
      setFailed(cached === null)
    } else {
      setSrc(null)
      setFailed(false)
    }
  }, [path])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '160px' }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible || src !== null || failed) return
    if (thumbnailCache.has(path)) {
      setSrc(thumbnailCache.get(path) ?? null)
      return
    }

    let cancelled = false
    let promise = thumbnailInflight.get(path)
    if (!promise) {
      promise = window.electronAPI.getThumbnail(path).then((dataUrl) => {
        thumbnailCache.set(path, dataUrl)
        thumbnailInflight.delete(path)
        return dataUrl
      })
      thumbnailInflight.set(path, promise)
    }

    void promise.then((dataUrl) => {
      if (cancelled) return
      if (dataUrl) setSrc(dataUrl)
      else setFailed(true)
    })

    return () => {
      cancelled = true
    }
  }, [visible, src, failed, path])

  const box = size === 'sm' ? 'h-10 w-10 rounded shrink-0' : 'h-full w-full'

  return (
    <div ref={ref} className={cn(box, 'overflow-hidden bg-[var(--bg-tertiary)]', className)}>
      {src && !failed ? (
        <img
          src={src}
          alt=""
          draggable={false}
          decoding="async"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[var(--text-muted)]">
          <Circle className="h-4 w-4 opacity-40" />
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: string }): JSX.Element {
  switch (status) {
    case 'done':
      return <Check className="h-4 w-4 text-[var(--success)]" />
    case 'processing':
      return <Loader2 className="h-4 w-4 text-[var(--accent)] animate-spin" />
    case 'error':
      return <X className="h-4 w-4 text-[var(--error)]" />
    default:
      return <Circle className="h-4 w-4 text-[var(--text-muted)]" />
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'done':
      return 'Done'
    case 'processing':
      return 'Processing'
    case 'error':
      return 'Error'
    default:
      return 'Queued'
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'done':
      return 'text-[var(--success)]'
    case 'processing':
      return 'text-[var(--accent)]'
    case 'error':
      return 'text-[var(--error)]'
    default:
      return 'text-[var(--text-muted)]'
  }
}
