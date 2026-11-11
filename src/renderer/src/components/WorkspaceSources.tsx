import type { Message } from '../lib/types'

type Source = NonNullable<Message['workspaceSources']>[number]

function label(source: Source) {
  const range = source.firstLine === source.lastLine ? 'line ' + source.firstLine : 'lines ' + source.firstLine + '–' + source.lastLine
  return (source.citation ? '[' + source.citation + '] ' : '') + source.file
    + (source.section ? ' · ' + source.section : '') + ' (' + range + ')'
}

export function WorkspaceSources({ sources }: { sources?: Source[] }) {
  if (!sources?.length) return null
  return (
    <div className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs text-muted">
      <div className="font-medium">{sources[0].citation ? 'Workspace sources' : 'Workspace excerpts reviewed'}</div>
      <ul className="space-y-1 [overflow-wrap:anywhere]">
        {sources.map((source) => <li key={source.file + ':' + source.firstLine}>{label(source)}</li>)}
      </ul>
    </div>
  )
}

export function copyWorkspaceReply(message: Message): string {
  const sources = message.workspaceSources
  if (!sources?.length) return message.content
  const heading = sources[0].citation ? 'Workspace sources' : 'Workspace excerpts reviewed'
  return message.content + '\n\n' + heading + '\n' + sources.map(label).join('\n')
}
