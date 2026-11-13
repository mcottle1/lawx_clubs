import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export interface BarPoint {
  /** Short x-axis label, e.g. "Oct 3". */
  label: string
  value: number
  /** Extra lines for the tooltip / table, e.g. ["Fall Social", "$360 spent"]. */
  details: string[]
}

/**
 * Single-series bar chart: thin rounded bars on a recessive grid, a hover
 * tooltip, a text summary for screen readers, and a "show as table" view.
 * One series per chart (no dual axes); the card title names the measure.
 */
export default function BarMetric({
  data, color, valueLabel, summary,
}: {
  data: BarPoint[]
  color: string
  valueLabel: string
  summary: string
}) {
  return (
    <div>
      <div className="h-52" role="img" aria-label={summary}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="30%">
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#cbd5e1' }} fontSize={12} stroke="#64748b" interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} fontSize={12} stroke="#64748b" width={48} />
            <Tooltip
              cursor={{ fill: 'rgba(74, 58, 224, 0.06)' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as BarPoint
                return (
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                    <p className="font-semibold text-slate-900">{p.details[0] ?? p.label}</p>
                    <p className="text-slate-700">{p.value} {valueLabel}</p>
                    {p.details.slice(1).map((d) => <p key={d} className="text-slate-500">{d}</p>)}
                  </div>
                )
              }}
            />
            <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-xs font-medium text-accent-700">Show as table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-slate-500"><tr><th scope="col" className="py-1 pr-2">Event</th><th scope="col" className="py-1 pr-2">Date</th><th scope="col" className="py-1 text-right">{valueLabel}</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.map((d, i) => (
                <tr key={i}><td className="py-1 pr-2">{d.details[0] ?? '—'}</td><td className="py-1 pr-2">{d.label}</td><td className="py-1 text-right font-medium">{d.value}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  )
}
