import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"

export type ThemePreference = "system" | "light" | "dark"

type ThemeContextValue = {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const storageKey = "home-ledger.theme"

function readInitialPreference(): ThemePreference {
  const value = window.localStorage.getItem(storageKey)
  return value === "light" || value === "dark" || value === "system" ? value : "system"
}

function applyTheme(preference: ThemePreference) {
  const dark =
    preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
  document.documentElement.style.colorScheme = dark ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readInitialPreference)

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    window.localStorage.setItem(storageKey, next)
    applyTheme(next)
  }, [])

  useEffect(() => {
    applyTheme(preference)
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => preference === "system" && applyTheme("system")
    media.addEventListener("change", handleChange)
    return () => media.removeEventListener("change", handleChange)
  }, [preference])

  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used inside ThemeProvider")
  return context
}
