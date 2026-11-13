import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDay } from '../../../lib/format'
import { brand } from '../../../lib/theme'
import type { MemberCount } from '../../../lib/types'
import { Card } from '../../../components/ui'

export default function MembershipChart({ counts }: { counts: MemberCount[] }) {
  return (
    <Card>
      <h2 className="font-medium">Membership over time</h2>
      {counts.length < 2 ? (
        <p className="mt-2 text-sm text-slate-500">
          Record your member count a few times (e.g. each month) to see a trend here.
        </p>
      ) : (
        <div className="mt-3 h-56" role="img" aria-label={`Member count from ${counts[0].count} to ${counts[counts.length - 1].count}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={counts.map((c) => ({ date: c.recorded_on, count: c.count }))} margin={{ top: 5, right: 10, bottom: 5, left: -10 }}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => formatDay(d).split(', ').slice(1).join(', ')} fontSize={12} stroke="#64748b" tickLine={false} />
              <YAxis allowDecimals={false} fontSize={12} stroke="#64748b" tickLine={false} axisLine={false} />
              <Tooltip labelFormatter={(d) => formatDay(String(d))} formatter={(v) => [v, 'Members']} />
              <Line type="monotone" dataKey="count" stroke={brand.fresh()} strokeWidth={2} dot={{ r: 4, strokeWidth: 2, stroke: '#fff', fill: brand.fresh() }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
