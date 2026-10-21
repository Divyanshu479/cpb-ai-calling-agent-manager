import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Provider, useSelector } from 'react-redux';
import store from './store';
import ToastProvider from './components/common/ToastProvider';
import Login from './pages/Login';
import DashboardLayout from './components/layout/DashboardLayout';
import AdminDashboard from './pages/admin/Dashboard';
import QueueDashboard from './pages/admin/QueueDashboard';
import Managers from './pages/admin/Managers';
import CMDashboard from './pages/cm/Dashboard';
import Callers from './pages/cm/Callers';
import ScriptBuilder from './pages/cm/ScriptBuilder';
import Campaigns from './pages/cm/Campaigns';
import CampaignDetail from './pages/cm/CampaignDetail';
import CampaignSessions from './pages/cm/CampaignSessions';
import CallLogs from './pages/cm/CallLogs';
import CallLogDetail from './pages/cm/CallLogDetail';
import TelephonySettings from './pages/admin/TelephonySettings';
import AllCampaigns from './pages/admin/AllCampaigns';
import AllCallLogs from './pages/admin/AllCallLogs';
import AdminCallLogDetail from './pages/admin/CallLogDetail';
import UsageReports from './pages/admin/UsageReports';
import Integrations from './pages/admin/Integrations';
import { ROLES } from './utils/constants';
import SessionDetails from './pages/cm/SessionDetails';

// Protected Route Component
const ProtectedRoute = ({ children, allowedRoles }) => {
  const { isAuthenticated, user } = useSelector((state) => state.auth);

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    // Redirect to appropriate dashboard based on role
    const redirectPath = user?.role === ROLES.ADMIN ? '/admin/dashboard' : '/cm/dashboard';
    return <Navigate to={redirectPath} replace />;
  }

  return children;
};

// Placeholder component for unimplemented routes
const ComingSoon = ({ title }) => (
  <div className="p-6">
    <div className="bg-white rounded-lg shadow p-12 text-center">
      <div className="text-6xl mb-4">🚧</div>
      <h2 className="text-2xl font-bold text-gray-900 mb-2">{title}</h2>
      <p className="text-gray-600">This feature is coming soon!</p>
    </div>
  </div>
);

function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Public Routes */}
        <Route path="/login" element={<Login />} />

        {/* Admin Routes */}
        <Route
          path="/admin"
          element={
            <ProtectedRoute allowedRoles={[ROLES.ADMIN]}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="dashboard" element={<AdminDashboard />} />
          <Route path="queue" element={<QueueDashboard />} />
          <Route path="managers" element={<Managers />} />
          <Route path="integrations" element={<Integrations />} />
          <Route path="telephony" element={<TelephonySettings />} />
          <Route path="campaigns" element={<AllCampaigns />} />
          <Route path="logs" element={<AllCallLogs />} />
          <Route path="logs/:callId" element={<AdminCallLogDetail />} />
          <Route path="reports" element={<UsageReports />} />
        </Route>

        {/* Campaign Manager Routes */}
        <Route
          path="/cm"
          element={
            <ProtectedRoute allowedRoles={[ROLES.CAMPAIGN_MANAGER]}>
              <DashboardLayout />
            </ProtectedRoute>
          }
        >
          <Route path="dashboard" element={<CMDashboard />} />
          <Route path="callers" element={<Callers />} />
          <Route path="callers/:callerId/script" element={<ScriptBuilder />} />
          <Route path="campaigns" element={<Campaigns />} />
          <Route path="campaigns/:campaignId" element={<CampaignDetail />} />
          <Route path="campaigns/:campaignId/sessions" element={<CampaignSessions />} />
          <Route path="campaigns/:campaignId/sessions/:sid" element={<SessionDetails />} />
          <Route path="leads" element={<Navigate to="/cm/campaigns" replace />} />
          <Route path="logs" element={<CallLogs />} />
          <Route path="logs/:callId" element={<CallLogDetail />} />
        </Route>

        {/* Root redirect */}
        <Route path="/" element={<Navigate to="/login" replace />} />

        {/* 404 */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function App() {
  return (
    <Provider store={store}>
      <ToastProvider />
      <AppRoutes />
    </Provider>
  );
}

export default App;
