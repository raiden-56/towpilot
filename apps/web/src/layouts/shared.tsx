import { IconButton, Tooltip, useMediaQuery } from '@mui/material';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import { setThemeMode, useAppDispatch, useAppSelector } from '@/store';

export function useEffectiveMode(): 'light' | 'dark' {
  const pref = useAppSelector((s) => s.ui.themeMode);
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  return pref === 'system' ? (systemDark ? 'dark' : 'light') : pref;
}

export function ThemeToggle() {
  const dispatch = useAppDispatch();
  const effective = useEffectiveMode();
  return (
    <Tooltip title={effective === 'dark' ? 'Light mode' : 'Dark mode'}>
      <IconButton color="inherit" aria-label="Toggle colour theme" onClick={() => dispatch(setThemeMode(effective === 'dark' ? 'light' : 'dark'))}>
        {effective === 'dark' ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}

export function Brand({ light }: { light?: boolean }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontWeight: 800, letterSpacing: '-0.02em', fontSize: 18, color: light ? '#fff' : undefined }}>
      <img src="/favicon.svg" alt="" width={26} height={26} />
      TowPilot
    </span>
  );
}
