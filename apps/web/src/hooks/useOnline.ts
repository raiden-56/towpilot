import { useEffect } from 'react';
import { onlineManager } from '@tanstack/react-query';
import { setOnline, useAppDispatch, useAppSelector } from '@/store';

/** Tracks browser connectivity and keeps TanStack Query's online manager in sync. */
export function useOnlineTracking() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    const update = () => {
      dispatch(setOnline(navigator.onLine));
      onlineManager.setOnline(navigator.onLine);
    };
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, [dispatch]);
}

export const useIsOnline = () => useAppSelector((s) => s.ui.online);

/**
 * Local drafts for low-connectivity mode. Only non-sensitive form data is stored (no OTPs,
 * tokens or payment data), and drafts never count as submitted.
 */
export const drafts = {
  save(key: string, value: unknown) {
    try {
      localStorage.setItem(`tp.draft.${key}`, JSON.stringify({ savedAt: Date.now(), value }));
    } catch {
      /* storage unavailable */
    }
  },
  load<T>(key: string, maxAgeMs = 24 * 3600_000): T | null {
    try {
      const raw = localStorage.getItem(`tp.draft.${key}`);
      if (!raw) return null;
      const d = JSON.parse(raw) as { savedAt: number; value: T };
      return Date.now() - d.savedAt > maxAgeMs ? null : d.value;
    } catch {
      return null;
    }
  },
  clear(key: string) {
    try {
      localStorage.removeItem(`tp.draft.${key}`);
    } catch {
      /* storage unavailable */
    }
  },
};
