import { useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppBar, BottomNavigation, BottomNavigationAction, Box, Chip, Container, Fab, Paper, Toolbar } from '@mui/material';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import HistoryIcon from '@mui/icons-material/History';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import ReportGmailerrorredIcon from '@mui/icons-material/ReportGmailerrorred';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import GpsOffIcon from '@mui/icons-material/GpsOff';
import { NotificationsBell } from '@/components/NotificationsBell';
import { OfflineBanner, SandboxBanner } from '@/components/common';
import { Brand, ThemeToggle } from './shared';
import { brand } from '@/theme';
import { useDriverLocationSharing } from '@/pages/driver/locationSharing';
import { SafetyDialog } from '@/pages/driver/SafetyDialog';

const tabs = [
  { to: '/driver', label: 'Today', icon: <LocalShippingOutlinedIcon /> },
  { to: '/driver/jobs', label: 'Jobs', icon: <HistoryIcon /> },
  { to: '/driver/earnings', label: 'Earnings', icon: <PaymentsOutlinedIcon /> },
  { to: '/driver/profile', label: 'Profile', icon: <BadgeOutlinedIcon /> },
];

/**
 * Field-worker shell: large touch targets, a persistent safety action, and an always-visible
 * indicator of whether location is being shared.
 */
export default function DriverLayout() {
  const loc = useLocation();
  const nav = useNavigate();
  const [safetyOpen, setSafetyOpen] = useState(false);
  const sharing = useDriverLocationSharing();
  const current = [...tabs].reverse().find((t) => loc.pathname === t.to || loc.pathname.startsWith(t.to + '/'))?.to ?? '/driver';
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="sticky" sx={{ bgcolor: brand.navy, color: '#fff' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Box sx={{ flex: 1 }}>
            <Brand light />
          </Box>
          <Chip
            size="small"
            icon={sharing.active ? <GpsFixedIcon /> : <GpsOffIcon />}
            label={sharing.active ? 'Sharing location' : sharing.reason}
            color={sharing.active ? 'success' : 'default'}
            sx={{ color: '#fff', '& .MuiChip-icon': { color: '#fff' } }}
            variant={sharing.active ? 'filled' : 'outlined'}
          />
          <ThemeToggle />
          <NotificationsBell />
        </Toolbar>
      </AppBar>
      <OfflineBanner />
      <SandboxBanner compact />
      <Container maxWidth="sm" component="main" sx={{ flex: 1, py: 2, px: 2, pb: 14 }}>
        <Outlet />
      </Container>
      <Fab color="error" variant="extended" onClick={() => setSafetyOpen(true)} sx={{ position: 'fixed', right: 16, bottom: 'calc(80px + env(safe-area-inset-bottom))', zIndex: 11, fontWeight: 800 }} aria-label="Safety and incident reporting">
        <ReportGmailerrorredIcon sx={{ mr: 1 }} /> Safety
      </Fab>
      <SafetyDialog open={safetyOpen} onClose={() => setSafetyOpen(false)} />
      <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10, borderRadius: 0, pb: 'env(safe-area-inset-bottom)' }} elevation={3}>
        <BottomNavigation showLabels value={current} onChange={(_, v: string) => nav(v)} sx={{ height: 68 }}>
          {tabs.map((t) => (
            <BottomNavigationAction key={t.to} value={t.to} label={t.label} icon={t.icon} sx={{ minWidth: 64 }} />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}
