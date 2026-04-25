import { Routes, Route, Navigate } from "react-router-dom";
import { Suspense, lazy } from "react";
import AppLayout from "./layouts/AppLayout";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Cases = lazy(() => import("./pages/Cases"));
const CaseDetail = lazy(() => import("./pages/CaseDetail"));
const Prospects = lazy(() => import("./pages/Prospects"));
const CRM = lazy(() => import("./pages/CRM"));
const CheckIns = lazy(() => import("./pages/CheckIns"));
const Calendar = lazy(() => import("./pages/Calendar"));
const PaymentsRoutes = lazy(() => import("./pages/PaymentsRoutes"));
const Messages = lazy(() => import("./pages/Messages"));
const Admin = lazy(() => import("./pages/Admin"));
const Reports = lazy(() => import("./pages/Reports"));
const CallQueue = lazy(() => import("./pages/CallQueue"));
const AuthPreview = lazy(() => import("./pages/AuthPreview"));
const AuthRoutes = lazy(() => import("./pages/AuthRoutes"));
import { UserProvider } from "./components/UserContext";
import RequireAuth from "./components/RequireAuth";
import { ToastProvider } from "./components/ToastContext";

const AUTH_PREVIEW_ENABLED = import.meta.env.VITE_ENABLE_AUTH_PREVIEW === "true" || import.meta.env.DEV;

export default function App() {
  return (
    <UserProvider>
      <Suspense fallback={<div />}> {/* Keep fallback minimal to avoid layout shift */}
        <Routes>
          <Route path="/login" element={<Navigate to="/auth/login" replace />} />
          <Route path="/auth" element={<ToastProvider><AuthRoutes /></ToastProvider>} />
          <Route path="/auth/:screen" element={<ToastProvider><AuthRoutes /></ToastProvider>} />
          {AUTH_PREVIEW_ENABLED && (
            <Route path="/auth/preview" element={<ToastProvider><AuthPreview /></ToastProvider>} />
          )}
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cases" element={<Cases />} />
            <Route path="/cases/:caseId" element={<CaseDetail />} />
            <Route path="/prospects" element={<Prospects />} />
            <Route path="/crm" element={<CRM />} />
            <Route path="/check-ins" element={<CheckIns />} />
            <Route path="/call-queue" element={<CallQueue />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/payments/*" element={<PaymentsRoutes />} />
            <Route path="/messages" element={<Messages />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/admin" element={<Admin />} />
          </Route>
        </Routes>
      </Suspense>
    </UserProvider>
  );
}
