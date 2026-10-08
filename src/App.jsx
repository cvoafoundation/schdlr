import { Routes, Route, Navigate } from "react-router-dom";
import CvoaConnector from "./components/CvoaConnector.jsx";
import Layout from "./components/Layout.jsx";
import { useAuth } from "./hooks/useAuth";
import { LoadingBlock } from "./components/ui.jsx";

import BookingPage from "./pages/BookingPage.jsx";
import ManagePage from "./pages/ManagePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import OnboardingPage from "./pages/OnboardingPage.jsx";
import AcceptInvitePage from "./pages/AcceptInvitePage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import TeamAvailabilityPage from "./pages/TeamAvailabilityPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

function RequireAuth({ children }) {
  const { user, membership, loading } = useAuth();
  if (loading) return <Layout><LoadingBlock label="Checking your session…" /></Layout>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function RequireAdmin({ children }) {
  const { user, profile, loading } = useAuth();
  if (loading) return <Layout><LoadingBlock label="Checking your session…" /></Layout>;
  if (!user) return <Navigate to="/login" replace />;
  if (!profile?.is_admin) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  const { orgId } = useAuth();
  return (
    <>
    <CvoaConnector />
    <Routes>
      <Route path="/" element={<Layout><BookingPage /></Layout>} />
      <Route path="/book/:slug" element={<Layout><BookingPage /></Layout>} />
      <Route path="/integrations/cvoa" element={<Layout><LoadingBlock label="Open Scheduling in CVOA.ONE to connect your staff account." /></Layout>} />
      <Route path="/manage" element={<Layout><ManagePage /></Layout>} />
      <Route path="/login" element={<Layout><LoginPage /></Layout>} />
      <Route path="/onboarding" element={<RequireAuth><Layout><OnboardingPage /></Layout></RequireAuth>} />
      <Route path="/accept-invite/:token" element={<Layout><AcceptInvitePage /></Layout>} />
      <Route path="/reset-password" element={<Layout><ResetPasswordPage /></Layout>} />
      <Route path="/team" element={<RequireAuth><Layout><TeamAvailabilityPage key={orgId} /></Layout></RequireAuth>} />
      <Route path="/dashboard" element={<RequireAuth><Layout><DashboardPage key={orgId} /></Layout></RequireAuth>} />
      <Route path="/analytics" element={<RequireAdmin><Layout><AnalyticsPage key={orgId} /></Layout></RequireAdmin>} />
      <Route path="/settings" element={<RequireAdmin><Layout><SettingsPage key={orgId} /></Layout></RequireAdmin>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  );
}
