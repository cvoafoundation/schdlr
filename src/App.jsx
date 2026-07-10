import { Routes, Route, Navigate } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import { useAuth } from "./hooks/useAuth";
import { LoadingBlock } from "./components/ui.jsx";

import BookingPage from "./pages/BookingPage.jsx";
import ManagePage from "./pages/ManagePage.jsx";
import LoginPage from "./pages/LoginPage.jsx";
import ResetPasswordPage from "./pages/ResetPasswordPage.jsx";
import TeamAvailabilityPage from "./pages/TeamAvailabilityPage.jsx";
import DashboardPage from "./pages/DashboardPage.jsx";
import AnalyticsPage from "./pages/AnalyticsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Layout><LoadingBlock label="Checking your session…" /></Layout>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><BookingPage /></Layout>} />
      <Route path="/manage" element={<Layout><ManagePage /></Layout>} />
      <Route path="/login" element={<Layout><LoginPage /></Layout>} />
      <Route path="/reset-password" element={<Layout><ResetPasswordPage /></Layout>} />
      <Route path="/team" element={<RequireAuth><Layout><TeamAvailabilityPage /></Layout></RequireAuth>} />
      <Route path="/dashboard" element={<RequireAuth><Layout><DashboardPage /></Layout></RequireAuth>} />
      <Route path="/analytics" element={<RequireAuth><Layout><AnalyticsPage /></Layout></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><Layout><SettingsPage /></Layout></RequireAuth>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
