import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppBar, BottomNavigation, BottomNavigationAction, Box, Container, IconButton, Paper, Toolbar } from '@mui/material';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import ReceiptLongOutlinedIcon from '@mui/icons-material/ReceiptLongOutlined';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import { NotificationsBell } from '@/components/NotificationsBell';
import { OfflineBanner, SandboxBanner } from '@/components/common';
import { Brand, ThemeToggle } from './shared';
import { brand } from '@/theme';

const tabs = [
  { to: '/app', label: 'Home', icon: <HomeOutlinedIcon /> },
  { to: '/app/bookings', label: 'Bookings', icon: <ListAltOutlinedIcon /> },
  { to: '/app/billing', label: 'Billing', icon: <ReceiptLongOutlinedIcon /> },
  { to: '/app/account', label: 'Account', icon: <PersonOutlineIcon /> },
];

/** Mobile-first customer shell: compact top bar and bottom navigation. */
export default function CustomerLayout() {
  const loc = useLocation();
  const nav = useNavigate();
  const current = [...tabs].reverse().find((t) => loc.pathname === t.to || loc.pathname.startsWith(t.to + '/'))?.to ?? '/app';
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', bgcolor: 'background.default' }}>
      <AppBar position="sticky" sx={{ bgcolor: brand.navy, color: '#fff' }}>
        <Toolbar sx={{ gap: 1 }}>
          <Box sx={{ flex: 1, cursor: 'pointer' }} onClick={() => nav('/app')}>
            <Brand light />
          </Box>
          <IconButton color="inherit" aria-label="Support" onClick={() => nav('/app/support')}>
            <SupportAgentOutlinedIcon />
          </IconButton>
          <ThemeToggle />
          <NotificationsBell />
        </Toolbar>
      </AppBar>
      <OfflineBanner />
      <SandboxBanner compact />
      <Container maxWidth="md" component="main" sx={{ flex: 1, py: 2.5, px: { xs: 2, sm: 3 }, pb: 12 }}>
        <Outlet />
      </Container>
      <Paper sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 10, borderRadius: 0, pb: 'env(safe-area-inset-bottom)' }} elevation={3}>
        <BottomNavigation showLabels value={current} onChange={(_, v: string) => nav(v)}>
          {tabs.map((t) => (
            <BottomNavigationAction key={t.to} value={t.to} label={t.label} icon={t.icon} />
          ))}
        </BottomNavigation>
      </Paper>
    </Box>
  );
}
