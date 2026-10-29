/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAP_TILE_URL?: string;
  readonly VITE_MAP_ATTRIBUTION?: string;
  /** 'true' shows "Continue as guest" on the login page (frontend-only demo with sample data). */
  readonly VITE_GUEST_MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
