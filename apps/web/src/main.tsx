import { StrictMode, useEffect, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider } from '@mui/material';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import { store, signedOut, signedIn } from '@/store';
import { buildTheme } from '@/theme';
import { configureClient, ApiError } from '@/api/client';
import type { Me } from '@/api/types';
import { bootstrapSession } from '@/hooks/useAuth';
import { useRealtimeConnection } from '@/hooks/useRealtime';
import { useOnlineTracking } from '@/hooks/useOnline';
import { useEffectiveMode } from '@/layouts/shared';
import { router } from '@/routes';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Never retry auth/permission/validation errors; retry transient ones.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
    mutations: { retry: false, networkMode: 'online' },
  },
});

configureClient({
  onSessionExpired: () => {
    store.dispatch(signedOut());
    queryClient.clear();
  },
  onTokenRefreshed: (_t, user) => store.dispatch(signedIn(user as Me)),
});
void bootstrapSession();

function Shell() {
  const mode = useEffectiveMode();
  const theme = useMemo(() => buildTheme(mode), [mode]);
  useRealtimeConnection();
  useOnlineTracking();
  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', mode === 'dark' ? '#0b1220' : '#0f1b2d');
  }, [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline enableColorScheme />
      <RouterProvider router={router} />
    </ThemeProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <Shell />
      </QueryClientProvider>
    </Provider>
  </StrictMode>,
);
