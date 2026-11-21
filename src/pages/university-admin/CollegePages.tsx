import { useOutletContext } from 'react-router-dom'
import AdminCalendar from './AdminCalendar'
import AdminEventDetail from './AdminEventDetail'
import EventHistory from './EventHistory'

type Where = { college: string; university: string; unit: string } | null

/** College admin pages (the college comes from AdminLayout). */
export function CollegeCalendar() {
  const where = useOutletContext<Where>()
  return <AdminCalendar base="/university-admin" orgName={where?.college ?? 'Your college'} />
}
export function CollegeHistory() {
  return <EventHistory base="/university-admin" />
}
export function CollegeEventDetail() {
  return <AdminEventDetail base="/university-admin" />
}
