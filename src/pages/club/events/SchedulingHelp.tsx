import type { ClubInfo } from '../ClubContext'

/** Shows the university admin's room-booking link/instructions. */
export default function SchedulingHelp({ scheduling }: { scheduling: ClubInfo['scheduling'] }) {
  if (!scheduling?.scheduling_url && !scheduling?.scheduling_instructions) return null
  return (
    <div className="rounded-md border border-accent-100 bg-accent-50 p-3 text-sm">
      <p className="font-medium text-accent-700">How to book a room at your university</p>
      {scheduling.scheduling_url && (
        <p className="mt-1">
          <a href={scheduling.scheduling_url} target="_blank" rel="noreferrer" className="text-accent-700 underline">
            Open the scheduling system
          </a>
        </p>
      )}
      {scheduling.scheduling_instructions && <p className="mt-1 whitespace-pre-line text-slate-700">{scheduling.scheduling_instructions}</p>}
    </div>
  )
}
