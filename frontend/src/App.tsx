import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import { ProtectedRoute } from './components/ProtectedRoute';
// İlk boyamada gereken sayfalar eager (landing + auth ekranları); gerisi route
// bazlı code-splitting ile lazy — 33 sayfa tek 700KB+ bundle'a gömülmesin.
import Landing from './pages/Landing';
import Login from './pages/Login';

const Register = lazy(() => import('./pages/Register'));
const ForgotPassword = lazy(() => import('./pages/ForgotPassword'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const Profile = lazy(() => import('./pages/Profile'));
const UserRooms = lazy(() => import('./pages/UserRooms'));
const UserBookings = lazy(() => import('./pages/UserBookings'));
const UserCalendar = lazy(() => import('./pages/UserCalendar'));
const UserDashboard = lazy(() => import('./pages/UserDashboard'));
const IzleyiciDashboard = lazy(() => import('./pages/IzleyiciDashboard'));
const UserLibrary = lazy(() => import('./pages/UserLibrary'));
const UserFAQ = lazy(() => import('./pages/UserFAQ'));
const UserLicenses = lazy(() => import('./pages/UserLicenses'));
const UserWaitlist = lazy(() => import('./pages/UserWaitlist'));
const Chat = lazy(() => import('./pages/Chat'));
const Showcase = lazy(() => import('./pages/Showcase'));
const Leaderboard = lazy(() => import('./pages/Leaderboard'));
const KioskIndex = lazy(() => import('./pages/KioskIndex'));
const KioskScreen = lazy(() => import('./pages/KioskScreen'));
const PrivacySettings = lazy(() => import('./pages/PrivacySettings'));
const PublicProfile = lazy(() => import('./pages/PublicProfile'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminRooms = lazy(() => import('./pages/AdminRooms'));
const AdminLibrary = lazy(() => import('./pages/AdminLibrary'));
const AdminUsers = lazy(() => import('./pages/AdminUsers'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminCalendar = lazy(() => import('./pages/AdminCalendar'));
const AdminWaitlist = lazy(() => import('./pages/AdminWaitlist'));
const AdminSecurity = lazy(() => import('./pages/AdminSecurity'));
const AdminAuditLog = lazy(() => import('./pages/AdminAuditLog'));
const AdminLicenses = lazy(() => import('./pages/AdminLicenses'));
const AdminProjects = lazy(() => import('./pages/AdminProjects'));
const AdminHardwareRequests = lazy(() => import('./pages/AdminHardwareRequests'));
const AdminSupportRequests = lazy(() => import('./pages/AdminSupportRequests'));
const ArgeDashboard = lazy(() => import('./pages/ArgeDashboard'));
const DanismanDashboard = lazy(() => import('./pages/DanismanDashboard'));

/** Lazy chunk yüklenirken gösterilen hafif yer tutucu. */
function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-kt-gray-50">
      <div className="animate-spin w-8 h-8 border-3 border-kt-gold-500 border-t-transparent rounded-full" />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/showcase" element={<Showcase />} />
            <Route path="/u/:userId" element={<PublicProfile />} />
            {/* Kiosk — oda ekranı (public, login yok) (#5b) */}
            <Route path="/kiosk" element={<KioskIndex />} />
            <Route path="/kiosk/:roomId" element={<KioskScreen />} />
            {/* Eski URL'ler /login'e yönlendirilir — backwards compat */}
            <Route path="/admin/login" element={<Navigate to="/login" replace />} />

            <Route
              path="/dashboard"
              element={
                <ProtectedRoute kind="user">
                  <UserDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/rooms"
              element={
                <ProtectedRoute kind="user">
                  <UserRooms />
                </ProtectedRoute>
              }
            />
            <Route
              path="/kutuphane"
              element={
                <ProtectedRoute kind="user">
                  <UserLibrary />
                </ProtectedRoute>
              }
            />
            <Route
              path="/bookings"
              element={
                <ProtectedRoute kind="user">
                  <UserBookings />
                </ProtectedRoute>
              }
            />
            <Route
              path="/profile"
              element={
                <ProtectedRoute kind="user">
                  <Profile />
                </ProtectedRoute>
              }
            />
            <Route
              path="/waitlist"
              element={
                <ProtectedRoute kind="user">
                  <UserWaitlist />
                </ProtectedRoute>
              }
            />
            <Route
              path="/takvim"
              element={
                <ProtectedRoute kind="user">
                  <UserCalendar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/licenses"
              element={
                <ProtectedRoute kind="user">
                  <UserLicenses />
                </ProtectedRoute>
              }
            />
            <Route
              path="/yardim"
              element={
                <ProtectedRoute kind="user">
                  <UserFAQ />
                </ProtectedRoute>
              }
            />
            {/* Görsel Üret artık Profil sayfasının sekmesi — eski linkler kırılmasın. */}
            <Route path="/gorsel" element={<Navigate to="/profile?tab=gorsel" replace />} />
            <Route
              path="/liderlik"
              element={
                <ProtectedRoute kind="user">
                  <Leaderboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/sohbet"
              element={
                <ProtectedRoute kind="any">
                  <Chat />
                </ProtectedRoute>
              }
            />
            <Route
              path="/privacy"
              element={
                <ProtectedRoute kind="user">
                  <PrivacySettings />
                </ProtectedRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <ProtectedRoute kind="admin">
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/users"
              element={
                <ProtectedRoute kind={['admin', 'danisman', 'arge', 'izleyici']}>
                  <AdminUsers />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/analytics"
              element={
                <ProtectedRoute kind="admin">
                  <AdminAnalytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/calendar"
              element={
                <ProtectedRoute kind={['admin', 'danisman', 'arge', 'izleyici']}>
                  <AdminCalendar />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/rooms"
              element={
                <ProtectedRoute kind={['admin', 'danisman', 'arge', 'izleyici']}>
                  <AdminRooms />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/kutuphane"
              element={
                <ProtectedRoute kind={['admin', 'danisman', 'arge', 'izleyici']}>
                  <AdminLibrary />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/waitlist"
              element={
                <ProtectedRoute kind="admin">
                  <AdminWaitlist />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/security"
              element={
                <ProtectedRoute kind="admin">
                  <AdminSecurity />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/audit"
              element={
                <ProtectedRoute kind="admin">
                  <AdminAuditLog />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/licenses"
              element={
                <ProtectedRoute kind={['admin', 'danisman', 'arge', 'izleyici']}>
                  <AdminLicenses />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/projects"
              element={
                <ProtectedRoute kind={['admin', 'danisman', 'arge', 'izleyici']}>
                  <AdminProjects />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/hardware"
              element={
                <ProtectedRoute kind="admin">
                  <AdminHardwareRequests />
                </ProtectedRoute>
              }
            />
            <Route
              path="/admin/support"
              element={
                <ProtectedRoute kind="admin">
                  <AdminSupportRequests />
                </ProtectedRoute>
              }
            />

            {/* Yönetişim rolü dashboard'ları — her biri kendi kind'ında */}
            <Route
              path="/danisman"
              element={
                <ProtectedRoute kind="danisman">
                  <DanismanDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/izleyici"
              element={
                <ProtectedRoute kind="izleyici">
                  <IzleyiciDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="/arge"
              element={
                <ProtectedRoute kind="arge">
                  <ArgeDashboard />
                </ProtectedRoute>
              }
            />

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
