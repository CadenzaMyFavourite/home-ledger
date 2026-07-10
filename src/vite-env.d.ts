/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_E2E?: string
}

interface Window {
  __HOME_LEDGER_DESKTOP_E2E_OPEN_FILE__?: () => Promise<string | null> | string | null
}
