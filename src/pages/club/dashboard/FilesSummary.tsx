import { Link } from 'react-router-dom'
import { FILE_RULES } from '../../../lib/files'
import type { ClubFile, ClubFileType } from '../../../lib/types'
import { Card } from '../../../components/ui'

export default function FilesSummary({ files }: { files: ClubFile[] }) {
  const types: ClubFileType[] = ['flyer', 'logo', 'constitution', 'other']
  return (
    <Card>
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Club files</h2>
        <Link to="/club/files" className="text-sm text-accent-700 hover:underline">Manage files</Link>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {types.map((t) => {
          const n = files.filter((f) => f.file_type === t).length
          return (
            <li key={t} className="rounded-md bg-slate-50 px-3 py-2">
              <Link to={`/club/files#${t}`} className="hover:underline">{FILE_RULES[t].label}</Link>
              <span className="block text-xs text-slate-500">{n === 0 ? 'None yet' : `${n} file${n === 1 ? '' : 's'}`}</span>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
