import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/RequireAuth";
import { SignupPage } from "./pages/SignupPage";
import { LoginPage } from "./pages/LoginPage";
import { CallbackPage } from "./pages/CallbackPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FeedPage } from "./pages/FeedPage";
import { SettingsPage } from "./pages/SettingsPage";
import { GitHubCallbackPage } from "./pages/GitHubCallbackPage";
import { SlackCallbackPage } from "./pages/SlackCallbackPage";
import { GoogleCallbackPage } from "./pages/GoogleCallbackPage";
import { GuidePage } from "./pages/GuidePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { TermsPage } from "./pages/TermsPage";
import { SupportPage } from "./pages/SupportPage";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/callback" element={<CallbackPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/feed" element={<FeedPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/github/callback" element={<GitHubCallbackPage />} />
            <Route path="/slack/callback" element={<SlackCallbackPage />} />
            <Route path="/google/callback" element={<GoogleCallbackPage />} />
          </Route>
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
