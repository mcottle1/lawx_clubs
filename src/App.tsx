import { Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import Status from './pages/Status'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="status" element={<Status />} />
        <Route path="*" element={<p>Page not found.</p>} />
      </Route>
    </Routes>
  )
}
