import { alpha, createTheme, type PaletteMode } from '@mui/material/styles';

/**
 * TowPilot design system: deep navy structure, amber accent for primary and emergency actions,
 * neutral surfaces with restrained borders. Contrast-checked for WCAG AA on both modes.
 */
export const brand = {
  navy: '#0f1b2d',
  navy2: '#16263d',
  amber: '#f59e0b',
  amberDark: '#b45309',
  emergency: '#dc2626',
};

export function buildTheme(mode: PaletteMode) {
  const dark = mode === 'dark';
  return createTheme({
    palette: {
      mode,
      primary: { main: dark ? '#fbbf24' : brand.amberDark, light: '#fcd34d', dark: '#92400e', contrastText: dark ? '#111827' : '#ffffff' },
      secondary: { main: dark ? '#93c5fd' : brand.navy, contrastText: dark ? '#0b1220' : '#ffffff' },
      error: { main: dark ? '#f87171' : '#b91c1c' },
      warning: { main: dark ? '#fbbf24' : '#b45309' },
      success: { main: dark ? '#4ade80' : '#15803d' },
      info: { main: dark ? '#60a5fa' : '#1d4ed8' },
      background: { default: dark ? '#0b1220' : '#f5f7fa', paper: dark ? '#111a2b' : '#ffffff' },
      text: { primary: dark ? '#e5e7eb' : '#0f172a', secondary: dark ? '#9ca3af' : '#475569' },
      divider: dark ? 'rgba(148,163,184,0.16)' : 'rgba(15,23,42,0.08)',
    },
    shape: { borderRadius: 12 },
    typography: {
      fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      h1: { fontWeight: 800, fontSize: '2rem', letterSpacing: '-0.02em' },
      h2: { fontWeight: 800, fontSize: '1.6rem', letterSpacing: '-0.02em' },
      h3: { fontWeight: 700, fontSize: '1.3rem', letterSpacing: '-0.01em' },
      h4: { fontWeight: 700, fontSize: '1.15rem' },
      h5: { fontWeight: 700, fontSize: '1.05rem' },
      h6: { fontWeight: 700, fontSize: '0.95rem' },
      button: { textTransform: 'none', fontWeight: 650 },
      overline: { fontWeight: 700, letterSpacing: '0.08em' },
    },
    components: {
      MuiCssBaseline: {
        styleOverrides: {
          body: { WebkitFontSmoothing: 'antialiased' },
          '@media (prefers-reduced-motion: reduce)': { '*': { animationDuration: '0.01ms !important', transitionDuration: '0.01ms !important' } },
        },
      },
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: { root: { borderRadius: 10, paddingInline: 16 }, sizeLarge: { minHeight: 52, fontSize: '1rem' } },
      },
      MuiPaper: {
        defaultProps: { elevation: 0 },
        styleOverrides: { root: ({ theme }) => ({ backgroundImage: 'none', border: `1px solid ${theme.palette.divider}` }) },
      },
      MuiCard: { defaultProps: { elevation: 0 } },
      MuiAppBar: { styleOverrides: { root: { border: 'none' } } },
      MuiDrawer: { styleOverrides: { paper: { border: 'none' } } },
      MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
      MuiTextField: { defaultProps: { fullWidth: true } },
      MuiTableCell: { styleOverrides: { head: ({ theme }) => ({ fontWeight: 700, color: theme.palette.text.secondary, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.04em' }) } },
      MuiTooltip: { defaultProps: { arrow: true } },
      MuiAlert: { styleOverrides: { root: { borderRadius: 10 } } },
      MuiListItemButton: {
        styleOverrides: {
          root: ({ theme }) => ({
            borderRadius: 10,
            '&.Mui-selected': { backgroundColor: alpha(theme.palette.primary.main, 0.14), color: theme.palette.mode === 'dark' ? theme.palette.primary.main : theme.palette.primary.dark },
          }),
        },
      },
    },
  });
}
