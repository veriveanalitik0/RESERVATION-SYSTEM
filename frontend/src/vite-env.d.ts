/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Ara gün (haftanın tek tek günleri) seçimini açar — varsayılan kapalı. */
  readonly VITE_FEATURE_WEEKDAY_SELECTION?: string;
  readonly VITE_PROXY_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
