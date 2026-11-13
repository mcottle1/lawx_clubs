/** A headline number with a label (a stat tile is clearer than a chart for one value). */
export default function StatTile({ label, value, tone = 'accent' }: { label: string; value: string | number; tone?: 'accent' | 'pop' | 'fresh' }) {
  const bar = { accent: 'bg-accent-500', pop: 'bg-pop-400', fresh: 'bg-fresh-500' }[tone]
  return (
    <div className="relative overflow-hidden rounded-lg bg-slate-50 px-3 py-2">
      <span aria-hidden className={`absolute inset-y-0 left-0 w-1 ${bar}`} />
      <p className="text-xs text-slate-500">{label}</p>
      <p className="text-xl font-bold text-slate-900">{value}</p>
    </div>
  )
}
