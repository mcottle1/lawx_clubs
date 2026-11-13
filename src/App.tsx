import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router-dom'
import DashboardRedirect from './auth/DashboardRedirect'
import RequireRole from './auth/RequireRole'
import Layout from './components/Layout'
import { Spinner } from './components/ui'
import AdminInvite from './pages/AdminInvite'
import ForgotPassword from './pages/ForgotPassword'
import Landing from './pages/Landing'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import SignupClub from './pages/SignupClub'
import SignupPartner from './pages/SignupPartner'
import Status from './pages/Status'

// Role areas load on demand so the public pages stay small
// (the calendar and chart libraries are only needed after login).
const ClubLayout = lazy(() => import('./pages/club/ClubLayout'))
const ClubDashboard = lazy(() => import('./pages/club/ClubDashboard'))
const ClubFiles = lazy(() => import('./pages/club/ClubFiles'))
const ClubSettings = lazy(() => import('./pages/club/ClubSettings'))
const EventDetail = lazy(() => import('./pages/club/events/EventDetail'))
const EventForm = lazy(() => import('./pages/club/events/EventForm'))
const EventReport = lazy(() => import('./pages/club/events/EventReport'))
const ReceiptsQueue = lazy(() => import('./pages/university-admin/ReceiptsQueue'))
const Partnerships = lazy(() => import('./pages/club/partnerships/Partnerships'))
const OpportunityForm = lazy(() => import('./pages/club/partnerships/OpportunityForm'))
const Inbox = lazy(() => import('./components/messaging/Inbox'))
const Thread = lazy(() => import('./components/messaging/Thread'))
const PartnerLayout = lazy(() => import('./pages/partner/PartnerLayout'))
const PartnerDashboard = lazy(() => import('./pages/partner/PartnerDashboard'))
const PartnerOpportunity = lazy(() => import('./pages/partner/PartnerOpportunity'))
const PartnerProposals = lazy(() => import('./pages/partner/PartnerProposals'))
const PartnerThread = lazy(() => import('./pages/partner/PartnerThread'))
const PartnerProfile = lazy(() => import('./pages/partner/PartnerProfile'))
const AdminLayout = lazy(() => import('./pages/university-admin/AdminLayout'))
const Approvals = lazy(() => import('./pages/university-admin/Approvals'))
const ClubsOverview = lazy(() => import('./pages/university-admin/ClubsOverview'))
const PublicOpportunity = lazy(() => import('./pages/PublicOpportunity'))
const UniversityAdminHome = lazy(() => import('./pages/university-admin/UniversityAdminHome'))
const SiteAdmin = lazy(() => import('./pages/site-admin/SiteAdmin'))

export default function App() {
  return (
    <Suspense fallback={<Spinner />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Landing />} />
          <Route path="login" element={<Login />} />
          <Route path="signup/club" element={<SignupClub />} />
          <Route path="signup/partner" element={<SignupPartner />} />
          <Route path="forgot-password" element={<ForgotPassword />} />
          <Route path="reset-password" element={<ResetPassword />} />
          <Route path="admin-invite/:token" element={<AdminInvite />} />
          <Route path="dashboard" element={<DashboardRedirect />} />

          <Route path="club" element={<RequireRole roles={['club']}><ClubLayout /></RequireRole>}>
            <Route index element={<ClubDashboard />} />
            <Route path="events/new" element={<EventForm />} />
            <Route path="events/:id" element={<EventDetail />} />
            <Route path="events/:id/edit" element={<EventForm />} />
            <Route path="events/:id/report" element={<EventReport />} />
            <Route path="partnerships" element={<Partnerships />} />
            <Route path="opportunities/new" element={<OpportunityForm />} />
            <Route path="opportunities/:id/edit" element={<OpportunityForm />} />
            <Route path="messages" element={<Inbox side="club" />} />
            <Route path="messages/:id" element={<Thread side="club" />} />
            <Route path="files" element={<ClubFiles />} />
            <Route path="settings" element={<ClubSettings />} />
          </Route>
          <Route path="partner" element={<RequireRole roles={['partner']}><PartnerLayout /></RequireRole>}>
            <Route index element={<PartnerDashboard />} />
            <Route path="opportunities/:id" element={<PartnerOpportunity />} />
            <Route path="proposals" element={<PartnerProposals />} />
            <Route path="messages" element={<Inbox side="partner" />} />
            <Route path="messages/:id" element={<PartnerThread />} />
            <Route path="profile" element={<PartnerProfile />} />
          </Route>
          <Route path="university-admin" element={<RequireRole roles={['university_admin']}><AdminLayout /></RequireRole>}>
            <Route index element={<Approvals />} />
            <Route path="receipts" element={<ReceiptsQueue />} />
            <Route path="clubs" element={<ClubsOverview />} />
            <Route path="settings" element={<UniversityAdminHome />} />
          </Route>
          <Route path="o/:id" element={<PublicOpportunity />} />
          <Route path="site-admin" element={<RequireRole roles={['site_admin']}><SiteAdmin /></RequireRole>} />

          <Route path="status" element={<Status />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Route>
      </Routes>
    </Suspense>
  )
}
