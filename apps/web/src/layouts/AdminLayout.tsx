import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AppBar, Avatar, Box, Divider, Drawer, IconButton, InputBase, List, ListItemButton, ListItemIcon, ListItemText, ListSubheader, Menu, MenuItem, Toolbar, Tooltip, Typography, alpha, useMediaQuery, useTheme } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SearchIcon from '@mui/icons-material/Search';
import DashboardOutlinedIcon from '@mui/icons-material/DashboardOutlined';
import MapOutlinedIcon from '@mui/icons-material/MapOutlined';
import ListAltOutlinedIcon from '@mui/icons-material/ListAltOutlined';
import BadgeOutlinedIcon from '@mui/icons-material/BadgeOutlined';
import LocalShippingOutlinedIcon from '@mui/icons-material/LocalShippingOutlined';
import PeopleOutlineIcon from '@mui/icons-material/PeopleOutline';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import SellOutlinedIcon from '@mui/icons-material/SellOutlined';
import CardMembershipOutlinedIcon from '@mui/icons-material/CardMembershipOutlined';
import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined';
import PaymentsOutlinedIcon from '@mui/icons-material/PaymentsOutlined';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import SupportAgentOutlinedIcon from '@mui/icons-material/SupportAgentOutlined';
import ReportProblemOutlinedIcon from '@mui/icons-material/ReportProblemOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import HistoryEduOutlinedIcon from '@mui/icons-material/HistoryEduOutlined';
import { NotificationsBell } from '@/components/NotificationsBell';
import { OfflineBanner, SandboxBanner } from '@/components/common';
import { useAuth } from '@/hooks/useAuth';
import { useAppSelector } from '@/store';
import { Brand, ThemeToggle } from './shared';
import { brand } from '@/theme';

const DRAWER = 252;

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
  perms: string[];
}

const sections: { title: string; items: NavItem[] }[] = [
  {
    title: 'Operations',
    items: [
      { to: '/admin', label: 'Overview', icon: <DashboardOutlinedIcon />, perms: ['reports:read', 'finance:read'] },
      { to: '/admin/dispatch', label: 'Dispatch centre', icon: <MapOutlinedIcon />, perms: ['dispatch:manage'] },
      { to: '/admin/bookings', label: 'Bookings', icon: <ListAltOutlinedIcon />, perms: ['booking:read_any'] },
      { to: '/admin/incidents', label: 'Incidents & escalations', icon: <ReportProblemOutlinedIcon />, perms: ['incident:manage'] },
      { to: '/admin/support', label: 'Support desk', icon: <SupportAgentOutlinedIcon />, perms: ['support:manage'] },
    ],
  },
  {
    title: 'Resources',
    items: [
      { to: '/admin/employees', label: 'Employees', icon: <BadgeOutlinedIcon />, perms: ['employee:read'] },
      { to: '/admin/fleet', label: 'Fleet', icon: <LocalShippingOutlinedIcon />, perms: ['fleet:read'] },
      { to: '/admin/customers', label: 'Customers', icon: <PeopleOutlineIcon />, perms: ['customer:read'] },
      { to: '/admin/accounts', label: 'Business accounts', icon: <BusinessOutlinedIcon />, perms: ['customer:read'] },
    ],
  },
  {
    title: 'Commercial',
    items: [
      { to: '/admin/pricing', label: 'Services & pricing', icon: <SellOutlinedIcon />, perms: ['pricing:read'] },
      { to: '/admin/memberships', label: 'Memberships', icon: <CardMembershipOutlinedIcon />, perms: ['membership:manage'] },
      { to: '/admin/finance', label: 'Finance', icon: <AccountBalanceOutlinedIcon />, perms: ['finance:read'] },
      { to: '/admin/payroll', label: 'Payroll & payouts', icon: <PaymentsOutlinedIcon />, perms: ['payroll:manage'] },
      { to: '/admin/reports', label: 'Reports & analytics', icon: <InsightsOutlinedIcon />, perms: ['reports:read', 'finance:read'] },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/admin/settings', label: 'Settings', icon: <SettingsOutlinedIcon />, perms: ['settings:manage'] },
      { to: '/admin/audit', label: 'Audit log', icon: <HistoryEduOutlinedIcon />, perms: ['audit:read'] },
    ],
  },
];

export function useAdminNav() {
  const { can } = useAuth();
  return sections.map((s) => ({ ...s, items: s.items.filter((i) => i.perms.some((p) => can(p))) })).filter((s) => s.items.length);
}

export default function AdminLayout() {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('lg'));
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const { user, logout } = useAuth();
  const socketConnected = useAppSelector((s) => s.ui.socketConnected);
  const navSections = useAdminNav();

  const drawer = (
    <Box sx={{ height: '100%', bgcolor: brand.navy, color: '#cbd5e1', display: 'flex', flexDirection: 'column' }}>
      <Toolbar sx={{ px: 2.5 }}>
        <Brand light />
      </Toolbar>
      <Box sx={{ flex: 1, overflow: 'auto', px: 1.5, pb: 2 }}>
        {navSections.map((s) => (
          <List key={s.title} dense subheader={<ListSubheader sx={{ bgcolor: 'transparent', color: '#64748b', fontWeight: 700, fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', lineHeight: '32px' }}>{s.title}</ListSubheader>}>
            {s.items.map((i) => {
              const active = i.to === '/admin' ? loc.pathname === '/admin' : loc.pathname.startsWith(i.to);
              return (
                <ListItemButton
                  key={i.to}
                  component={NavLink}
                  to={i.to}
                  selected={active}
                  onClick={() => setOpen(false)}
                  sx={{ mb: 0.25, color: active ? '#fbbf24' : '#cbd5e1', '&.Mui-selected': { bgcolor: alpha('#f59e0b', 0.14), color: '#fbbf24' }, '&:hover': { bgcolor: alpha('#fff', 0.06) } }}
                >
                  <ListItemIcon sx={{ color: 'inherit', minWidth: 36 }}>{i.icon}</ListItemIcon>
                  <ListItemText primary={i.label} slotProps={{ primary: { fontSize: 14, fontWeight: active ? 700 : 500 } }} />
                </ListItemButton>
              );
            })}
          </List>
        ))}
      </Box>
      <Divider sx={{ borderColor: alpha('#fff', 0.08) }} />
      <Box sx={{ p: 2, fontSize: 12, color: '#64748b' }}>
        Live updates: <span style={{ color: socketConnected ? '#4ade80' : '#f87171' }}>{socketConnected ? 'connected' : 'reconnecting…'}</span>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Box component="nav" sx={{ width: { lg: DRAWER }, flexShrink: { lg: 0 } }}>
        {desktop ? (
          <Drawer variant="permanent" open sx={{ '& .MuiDrawer-paper': { width: DRAWER, boxSizing: 'border-box' } }}>
            {drawer}
          </Drawer>
        ) : (
          <Drawer variant="temporary" open={open} onClose={() => setOpen(false)} ModalProps={{ keepMounted: true }} sx={{ '& .MuiDrawer-paper': { width: DRAWER } }}>
            {drawer}
          </Drawer>
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <AppBar position="sticky" color="inherit" sx={{ bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar sx={{ gap: 1 }}>
            {!desktop && (
              <IconButton edge="start" aria-label="Open navigation" onClick={() => setOpen(true)}>
                <MenuIcon />
              </IconButton>
            )}
            <Box
              component="form"
              onSubmit={(e) => {
                e.preventDefault();
                const q = search.trim();
                if (q) nav(`/admin/bookings?q=${encodeURIComponent(q)}`);
              }}
              sx={{ flex: 1, maxWidth: 420, display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 0.5, borderRadius: 2, bgcolor: 'action.hover' }}
            >
              <SearchIcon fontSize="small" sx={{ color: 'text.secondary' }} />
              <InputBase placeholder="Search booking code, vehicle number, customer…" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ flex: 1, fontSize: 14 }} inputProps={{ 'aria-label': 'Search bookings' }} />
            </Box>
            <Box sx={{ flex: 1 }} />
            <ThemeToggle />
            <NotificationsBell />
            <Tooltip title={user?.fullName ?? ''}>
              <IconButton onClick={(e) => setMenu(e.currentTarget)} aria-label="Account menu">
                <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.main', fontSize: 14 }}>{user?.fullName?.[0] ?? '?'}</Avatar>
              </IconButton>
            </Tooltip>
            <Menu anchorEl={menu} open={!!menu} onClose={() => setMenu(null)}>
              <Box sx={{ px: 2, py: 1 }}>
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  {user?.fullName}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {user?.roles.join(', ')}
                </Typography>
              </Box>
              <Divider />
              <MenuItem onClick={() => void logout().then(() => nav('/login'))}>Sign out</MenuItem>
            </Menu>
          </Toolbar>
        </AppBar>
        <OfflineBanner />
        <SandboxBanner compact />
        <Box component="main" sx={{ flex: 1, p: { xs: 2, sm: 3 }, maxWidth: 1600, width: '100%', mx: 'auto' }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
