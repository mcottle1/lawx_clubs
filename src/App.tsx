import { Route, Routes } from 'react-router-dom'
import DashboardRedirect from './auth/DashboardRedirect'
import RequireRole from './auth/RequireRole'
import Layout from './components/Layout'
import AdminInvite from './pages/AdminInvite'
import ClubHome from './pages/club/ClubHome'
import ForgotPassword from './pages/ForgotPassword'
import Landing from './pages/Landing'
import Login from './pages/Login'
import PartnerHome from './pages/partner/PartnerHome'
import ResetPassword from './pages/ResetPassword'
import SignupClub from './pages/SignupClub'
import SignupPartner from './pages/SignupPartner'
import SiteAdmin from './pages/site-admin/SiteAdmin'
import Status from './pages/Status'
import UniversityAdminHome from './pages/university-admin/UniversityAdminHome'

export default function App() {
  return (
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

        <Route path="club" element={<RequireRole roles={['club']}><ClubHome /></RequireRole>} />
        <Route path="partner" element={<RequireRole roles={['partner']}><PartnerHome /></RequireRole>} />
        <Route path="university-admin" element={<RequireRole roles={['university_admin']}><UniversityAdminHome /></RequireRole>} />
        <Route path="site-admin" element={<RequireRole roles={['site_admin']}><SiteAdmin /></RequireRole>} />

        <Route path="status" element={<Status />} />
        <Route path="*" element={<p>Page not found.</p>} />
      </Route>
    </Routes>
  )
}
