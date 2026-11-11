import { cn, inputClass } from './ui'

export function ReasoningEffortSelect({ options, value, onChange }: {
  options: { value: string; label?: string }[]
  value: string | undefined
  onChange: (value: string) => void
}) {
  if (!options.length) return null
  return (
    <select
      aria-label="思考强度"
      title="思考强度"
      className={cn(inputClass, 'h-8 w-28! shrink-0 py-0 text-xs')}
      value={value ?? '__mixed__'}
      onChange={(e) => onChange(e.target.value)}
    >
      {value === undefined && <option value="__mixed__" disabled>Mixed</option>}
      <option value="">Default</option>
      {options.map(({ value, label }) => <option key={value} value={value}>{label ?? value}</option>)}
    </select>
  )
}
