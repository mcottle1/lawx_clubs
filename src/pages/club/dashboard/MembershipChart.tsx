import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDay } from '../../../lib/format'
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
              <XAxis dataKey="date" tickFormatter={(d: string) => formatDay(d).split(', ').slice(1).join(', ')} fontSize={12} stroke="#64748b" />
              <YAxis allowDecimals={false} fontSize={12} stroke="#64748b" />
              <Tooltip labelFormatter={(d) => formatDay(String(d))} formatter={(v) => [v, 'Members']} />
              <Line type="monotone" dataKey="count" stroke="#234bb0" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  )
}
