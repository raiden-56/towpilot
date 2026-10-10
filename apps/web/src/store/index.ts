import { configureStore, createSlice, type PayloadAction } from '@reduxjs/toolkit';
import { useDispatch, useSelector, type TypedUseSelectorHook } from 'react-redux';
import type { Me } from '@/api/types';

export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

const authSlice = createSlice({
  name: 'auth',
  initialState: { status: 'unknown' as AuthStatus, user: null as Me | null },
  reducers: {
    signedIn: (s, a: PayloadAction<Me>) => {
      s.status = 'authenticated';
      s.user = a.payload;
    },
    userUpdated: (s, a: PayloadAction<Me>) => {
      s.user = a.payload;
    },
    signedOut: (s) => {
      s.status = 'anonymous';
      s.user = null;
    },
  },
});

function readThemePref(): 'light' | 'dark' | 'system' {
  try {
    const v = localStorage.getItem('tp.theme');
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

const uiSlice = createSlice({
  name: 'ui',
  initialState: { themeMode: readThemePref(), online: typeof navigator === 'undefined' ? true : navigator.onLine, socketConnected: false },
  reducers: {
    setThemeMode: (s, a: PayloadAction<'light' | 'dark' | 'system'>) => {
      s.themeMode = a.payload;
      try {
        localStorage.setItem('tp.theme', a.payload);
      } catch {
        /* storage unavailable */
      }
    },
    setOnline: (s, a: PayloadAction<boolean>) => {
      s.online = a.payload;
    },
    setSocketConnected: (s, a: PayloadAction<boolean>) => {
      s.socketConnected = a.payload;
    },
  },
});

export const { signedIn, userUpdated, signedOut } = authSlice.actions;
export const { setThemeMode, setOnline, setSocketConnected } = uiSlice.actions;

export const store = configureStore({ reducer: { auth: authSlice.reducer, ui: uiSlice.reducer } });
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
