import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Outlet, createBrowserRouter, useLocation } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import { useAuth, homePathFor } from '@/hooks/useAuth';
import type { Role } from '@/api/types';
import CustomerLayout from '@/layouts/CustomerLayout';
import DriverLayout from '@/layouts/DriverLayout';
import AdminLayout from '@/layouts/AdminLayout';
import Login from '@/pages/auth/Login';
import TrackShared from '@/pages/public/TrackShared';
import NotFound from '@/pages/public/NotFound';

const page = (loader: () => Promise<{ default: React.ComponentType }>) => {
  const C = lazy(loader);
  return (
    <Suspense
      fallback={
        <Box sx={{ display: 'grid', placeItems: 'center', py: 10 }}>
          <CircularProgress />
        </Box>
      }
    >
      <C />
    </Suspense>
  );
};

function FullPageSpinner() {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress />
    </Box>
  );
}

/** Client-side guard for UX only — every API call is independently authorised by the server. */
function RequireRole({ roles, children }: { roles: Role[]; children?: ReactNode }) {
  const { status, user } = useAuth();
  const loc = useLocation();
  if (status === 'unknown') return <FullPageSpinner />;
  if (status === 'anonymous' || !user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (!roles.some((r) => user.roles.includes(r))) return <Navigate to={homePathFor(user)} replace />;
  return <>{children ?? <Outlet />}</>;
}

function RootRedirect() {
  const { status, user } = useAuth();
  if (status === 'unknown') return <FullPageSpinner />;
  return <Navigate to={homePathFor(user)} replace />;
}

export const router = createBrowserRouter([
  { path: '/', element: <RootRedirect /> },
  { path: '/login', element: <Login /> },
  { path: '/track/:token', element: <TrackShared /> },
  {
    path: '/app',
    element: (
      <RequireRole roles={['customer']}>
        <CustomerLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import('@/pages/customer/Home')) },
      { path: 'request', element: page(() => import('@/pages/customer/RequestWizard')) },
      { path: 'bookings', element: page(() => import('@/pages/customer/Bookings')) },
      { path: 'bookings/:id', element: page(() => import('@/pages/customer/BookingDetail')) },
      { path: 'vehicles', element: page(() => import('@/pages/customer/Vehicles')) },
      { path: 'billing', element: page(() => import('@/pages/customer/Billing')) },
      { path: 'billing/:id', element: page(() => import('@/pages/customer/InvoiceDetail')) },
      { path: 'memberships', element: page(() => import('@/pages/customer/Memberships')) },
      { path: 'support', element: page(() => import('@/pages/customer/Support')) },
      { path: 'support/:id', element: page(() => import('@/pages/customer/TicketDetail')) },
      { path: 'account', element: page(() => import('@/pages/customer/Account')) },
      { path: 'notifications', element: page(() => import('@/pages/customer/Notifications')) },
    ],
  },
  {
    path: '/driver',
    element: (
      <RequireRole roles={['driver', 'worker']}>
        <DriverLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import('@/pages/driver/DriverHome')) },
      { path: 'jobs', element: page(() => import('@/pages/driver/DriverJobs')) },
      { path: 'jobs/:id', element: page(() => import('@/pages/driver/DriverJob')) },
      { path: 'earnings', element: page(() => import('@/pages/driver/DriverEarnings')) },
      { path: 'profile', element: page(() => import('@/pages/driver/DriverProfile')) },
    ],
  },
  {
    path: '/admin',
    element: (
      <RequireRole roles={['admin', 'dispatcher', 'finance']}>
        <AdminLayout />
      </RequireRole>
    ),
    children: [
      { index: true, element: page(() => import('@/pages/admin/Dashboard')) },
      { path: 'dispatch', element: page(() => import('@/pages/admin/Dispatch')) },
      { path: 'bookings', element: page(() => import('@/pages/admin/Bookings')) },
      { path: 'bookings/:id', element: page(() => import('@/pages/admin/BookingDetail')) },
      { path: 'incidents', element: page(() => import('@/pages/admin/Incidents')) },
      { path: 'support', element: page(() => import('@/pages/admin/SupportDesk')) },
      { path: 'employees', element: page(() => import('@/pages/admin/Employees')) },
      { path: 'employees/:id', element: page(() => import('@/pages/admin/EmployeeDetail')) },
      { path: 'fleet', element: page(() => import('@/pages/admin/Fleet')) },
      { path: 'fleet/:id', element: page(() => import('@/pages/admin/TruckDetail')) },
      { path: 'customers', element: page(() => import('@/pages/admin/Customers')) },
      { path: 'customers/:id', element: page(() => import('@/pages/admin/CustomerDetail')) },
      { path: 'accounts', element: page(() => import('@/pages/admin/BusinessAccounts')) },
      { path: 'accounts/:id', element: page(() => import('@/pages/admin/BusinessAccountDetail')) },
      { path: 'pricing', element: page(() => import('@/pages/admin/Pricing')) },
      { path: 'memberships', element: page(() => import('@/pages/admin/Memberships')) },
      { path: 'finance', element: page(() => import('@/pages/admin/Finance')) },
      { path: 'finance/invoices/:id', element: page(() => import('@/pages/admin/FinanceInvoice')) },
      { path: 'payroll', element: page(() => import('@/pages/admin/Payroll')) },
      { path: 'reports', element: page(() => import('@/pages/admin/Reports')) },
      { path: 'settings', element: page(() => import('@/pages/admin/Settings')) },
      { path: 'audit', element: page(() => import('@/pages/admin/AuditLog')) },
    ],
  },
  { path: '*', element: <NotFound /> },
], { basename: import.meta.env.BASE_URL });
