import { useNavigate } from 'react-router-dom';
import { Alert, Button } from '@mui/material';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import { useAuth } from '@/hooks/useAuth';
import { GUEST_ROLES, guestRole } from './session';

/** Shown on every screen while a guest session is active (replaces the sandbox banner). */
export function GuestBanner() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const role = guestRole();
  if (!role) return null;
  const label = GUEST_ROLES.find((r) => r.role === role)?.label ?? role;
  return (
    <Alert
      severity="info"
      icon={<ExploreOutlinedIcon />}
      role="status"
      sx={{ borderRadius: 0, py: 0, '& .MuiAlert-message': { py: 0.75 }, '& .MuiAlert-action': { py: 0.25 } }}
      action={
        <Button color="inherit" size="small" onClick={() => void logout().then(() => nav('/login'))}>
          Exit
        </Button>
      }
    >
      <strong>Guest mode ({label})</strong> – sample data, changes aren&apos;t saved.
    </Alert>
  );
}
