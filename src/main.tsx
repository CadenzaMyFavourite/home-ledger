import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "./index.css"
import { AppProviders } from "@/app/providers"

async function bootstrap() {
  if (import.meta.env.VITE_DESKTOP_E2E === "true") {
    await import("@wdio/tauri-plugin")
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <AppProviders>
        <App />
      </AppProviders>
    </React.StrictMode>,
  )
}

void bootstrap()
