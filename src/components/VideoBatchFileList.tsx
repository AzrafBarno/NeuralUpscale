import { memo, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import {
  Check,
  Circle,
  Film,
  LayoutGrid,
  LayoutList,
  List,
  Loader2,
  Square,
  SquareCheck,
  Trash2,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { type BatchViewMode } from '@/components/BatchFileList'
import { cn, formatBytes } from '@/lib/utils'

export type { BatchViewMode }
export type VideoBatchStatus = 'queued' | 'processing' | 'done' | 'error'

export interface VideoBatchItem {
  path: string
  size: number
  fps?: number
  status: VideoBatchStatus
  selected: boolean
  progress?: number
  message?: string
  error?: string
}

interface VideoBatchFileListProps {
  files: VideoBatchItem[]
  viewMode: BatchViewMode
  onViewModeChange: (mode: BatchViewMode) => void
  canEdit: boolean
  onToggle: (index: number) => void
  onSelectRange: (from: number, to: number) => void
  onSelectAll: (selected: boolean) => void
  onRemove: (index: number) => void
  onRemoveSelected: () => void
  onClear: () => void
}

export function VideoBatchFileList({
  files,
  viewMode,
  onViewModeChange,
  canEdit,
  onToggle,
  onSelectRange,
  onSelectAll,
  onRemove,
  onRemoveSelected,
  onClear
}: VideoBatchFileListProps): JSX.Element {
  const lastAnchorRef = useRef<number | null>(null)
  const selectedCount = files.filter((f) => f.selected).length
  const allSelected = files.length > 0 && selectedCount === files.length

  const handleSelectClick = useCallback(
    (index: number, e: MouseEvent) => {
      if (!canEdit) return
      if (e.shiftKey && lastAnchorRef.current !== null) {
        onSelectRange(lastAnchorRef.current, index)
      } else {
        onToggle(index)
        lastAnchorRef.current = index
      }
    },
    [canEdit, onSelectRange, onToggle]
  )

  if (files.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--text-muted)] text-sm">
        Select an input folder to see the video queue
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
            onClick={() => onSelectAll(!allSelected)}
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
            title="Remove selected videos"
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
            {selectedCount} / {files.length} selected
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
            {files.map((file, index) => (
              <TileItem
                key={file.path}
                file={file}
                index={index}
                canEdit={canEdit}
                onRemove={onRemove}
                onSelectClick={handleSelectClick}
              />
            ))}
          </div>
        ) : viewMode === 'compact' ? (
          <div className="flex flex-col gap-0.5">
            {files.map((file, index) => (
              <CompactItem
                key={file.path}
                file={file}
                index={index}
                canEdit={canEdit}
                onRemove={onRemove}
                onSelectClick={handleSelectClick}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {files.map((file, index) => (
              <ListItem
                key={file.path}
                file={file}
                index={index}
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
  file: VideoBatchItem
  index: number
  canEdit: boolean
  onRemove: (index: number) => void
  onSelectClick: (index: number, e: MouseEvent) => void
}

function filePropsEqual(a: ItemProps, b: ItemProps): boolean {
  return (
    a.file.path === b.file.path &&
    a.index === b.index &&
    a.file.status === b.file.status &&
    a.file.progress === b.file.progress &&
    a.file.message === b.file.message &&
    a.file.error === b.file.error &&
    a.file.size === b.file.size &&
    a.file.selected === b.file.selected &&
    a.canEdit === b.canEdit &&
    a.onRemove === b.onRemove &&
    a.onSelectClick === b.onSelectClick
  )
}

function fileName(file: VideoBatchItem): string {
  return file.path.split(/[/\\]/).pop() ?? file.path
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
  index,
  canEdit,
  onRemove,
  onSelectClick
}: ItemProps): JSX.Element {
  const name = fileName(file)
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
        onClick={(e) => onSelectClick(index, e)}
      />
      <StatusIcon status={file.status} />
      <span className="flex-1 truncate text-sm font-mono-path" title={name}>
        {name}
      </span>
      {(file.status === 'processing' || (file.progress ?? 0) > 0) && (
        <div className="w-28">
          <Progress value={file.progress ?? 0} shimmer={file.status === 'processing'} />
        </div>
      )}
      <span className={cn('text-xs w-16 text-right', statusColor(file.status))}>
        {statusLabel(file)}
      </span>
      <RemoveButton canEdit={canEdit} onClick={() => onRemove(index)} />
    </div>
  )
}, filePropsEqual)

const CompactItem = memo(function CompactItem({
  file,
  index,
  canEdit,
  onRemove,
  onSelectClick
}: ItemProps): JSX.Element {
  const name = fileName(file)
  const detail = file.error || file.message || formatBytes(file.size)
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
        onClick={(e) => onSelectClick(index, e)}
      />
      <LazyThumbnail path={file.path} size="sm" />
      <StatusIcon status={file.status} />
      <div className="flex-1 min-w-0">
        <p className="truncate text-sm font-mono-path" title={name}>
          {name}
        </p>
        {detail && (
          <p className="truncate text-[10px] text-[var(--text-muted)]" title={detail}>
            {detail}
          </p>
        )}
      </div>
      {(file.status === 'processing' || (file.progress ?? 0) > 0) && (
        <div className="w-24">
          <Progress value={file.progress ?? 0} shimmer={file.status === 'processing'} />
        </div>
      )}
      <span className={cn('text-xs w-16 text-right', statusColor(file.status))}>
        {statusLabel(file)}
      </span>
      <RemoveButton canEdit={canEdit} onClick={() => onRemove(index)} />
    </div>
  )
}, filePropsEqual)

const TileItem = memo(function TileItem({
  file,
  index,
  canEdit,
  onRemove,
  onSelectClick
}: ItemProps): JSX.Element {
  const name = fileName(file)
  return (
    <div
      className={cn(
        'group relative rounded-lg border bg-[var(--bg-secondary)] overflow-hidden transition-colors',
        file.selected
          ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]'
          : 'border-[var(--border)] hover:border-[var(--accent)]'
      )}
    >
      <div className="relative aspect-square bg-[var(--bg-tertiary)]">
        <LazyThumbnail path={file.path} size="lg" className="absolute inset-0" />
        <div className="absolute top-1.5 left-1.5 z-10">
          <SelectionCheckbox
            selected={file.selected}
            disabled={!canEdit}
            onClick={(e) => onSelectClick(index, e)}
          />
        </div>
        <div className="absolute top-1.5 right-8 rounded-full bg-black/60 p-1">
          <StatusIcon status={file.status} />
        </div>
        {canEdit && (
          <button
            type="button"
            title="Remove"
            onClick={() => onRemove(index)}
            className="absolute top-1.5 right-1.5 rounded-full bg-black/60 p-1.5 text-white opacity-0 group-hover:opacity-100 hover:bg-[var(--error)] transition-opacity no-drag"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        {file.status === 'processing' && (
          <div className="absolute inset-x-0 bottom-0 p-1.5">
            <Progress value={file.progress ?? 0} shimmer />
          </div>
        )}
      </div>
      <div className="p-2 space-y-0.5">
        <p className="text-xs font-mono-path truncate" title={name}>
          {name}
        </p>
        <p className={cn('text-[10px]', statusColor(file.status))}>{statusLabel(file)}</p>
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
          <Film className="h-4 w-4 opacity-40" />
        </div>
      )}
    </div>
  )
}

function StatusIcon({ status }: { status: VideoBatchStatus }): JSX.Element {
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

function statusLabel(file: VideoBatchItem): string {
  switch (file.status) {
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

function statusColor(status: VideoBatchStatus): string {
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
