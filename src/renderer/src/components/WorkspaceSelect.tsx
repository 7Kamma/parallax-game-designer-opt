import { useState } from 'react'
import { FolderOpen } from 'lucide-react'
import type { WorkspaceRef } from '../../../shared/bridge'
import { bridge } from '../lib/platform'
import { Button, Popover } from './ui'

export function WorkspaceSelect({ value, mixed, disabled, onChange }: {
  value?: WorkspaceRef
  mixed?: boolean
  disabled?: boolean
  onChange: (value?: WorkspaceRef) => void
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState('')
  const access = bridge?.workspace
  if (!access) return null

  const choose = async () => {
    setChoosing(true)
    setError('')
    try {
      const selected = await access.choose(value?.id)
      if (selected) {
        onChange(selected)
        setAnchor(null)
      }
    } catch {
      setError('Could not open that folder. Choose it again.')
    } finally {
      setChoosing(false)
    }
  }

  const label = mixed ? 'Mixed workspaces' : value?.name ?? 'Workspace'
  return (
    <>
      <Button
        size="sm"
        disabled={disabled}
        aria-label={label === 'Workspace' ? label : 'Workspace: ' + label}
        aria-expanded={!!anchor}
        title={label}
        className="h-8 max-w-36 shrink-0 rounded-full text-muted"
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        <FolderOpen className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </Button>
      {anchor && (
        <Popover anchor={anchor} open onClose={() => setAnchor(null)} className="w-64 space-y-2 p-3">
          <div className="break-words text-sm font-medium">{label}</div>
          <p className="text-xs text-muted">Models can search this folder. Matching excerpts are sent to their providers.</p>
          {error && <p role="alert" className="text-xs text-danger">{error}</p>}
          <div className="flex flex-wrap gap-1">
            <Button size="sm" disabled={choosing || disabled} onClick={() => void choose()}>Choose folder…</Button>
            {(value || mixed) && (
              <Button size="sm" variant="ghost" disabled={choosing || disabled} onClick={() => {
                onChange(undefined)
                setAnchor(null)
              }}>Clear</Button>
            )}
          </div>
        </Popover>
      )}
    </>
  )
}
