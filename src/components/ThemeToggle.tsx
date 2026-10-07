import type { Theme } from "~lib/theme"

// Ícones de sol e lua (Feather Icons, MIT).
const iconProps = {
  className: "h-4 w-4",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true
} as const

const SunIcon = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
  </svg>
)

const MoonIcon = () => (
  <svg {...iconProps}>
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
)

/** Botão para o cabeçalho preto: mostra o tema para o qual vai trocar. */
export const ThemeToggle = ({ theme, onChange }: { theme: Theme; onChange: (theme: Theme) => void }) => {
  const next: Theme = theme === "dark" ? "light" : "dark"
  const label = next === "light" ? "Usar tema claro" : "Usar tema escuro"
  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-gray-400 transition hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-brand">
      {next === "light" ? <SunIcon /> : <MoonIcon />}
    </button>
  )
}
