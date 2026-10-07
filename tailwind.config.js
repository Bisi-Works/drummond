const defaultTheme = require("tailwindcss/defaultTheme")

/** @type {import('tailwindcss').Config} */
module.exports = {
  mode: "jit",
  content: ["./src/**/*.{ts,tsx}"],
  // Tema escuro (o padrão) pela classe `dark`: ver src/hooks/useTheme.ts.
  darkMode: "class",
  theme: {
    extend: {
      // Identidade Bisi Works (bisi.works): o vermelho do site, preto e branco puros e os cinzas
      // neutros do Tailwind (`gray`), os mesmos do site. O vermelho fica para a ação principal; erros
      // e remoções seguem com `rose`, para não se confundirem com ela.
      colors: {
        brand: {
          DEFAULT: "#e7191f",
          dark: "#c01318"
        },
        // Neutros que mudam com o tema; os valores ficam em src/style.css.
        surface: "var(--surface)",
        muted: "var(--muted)",
        line: {
          DEFAULT: "var(--line)",
          strong: "var(--line-strong)"
        },
        fg: {
          DEFAULT: "var(--fg)",
          muted: "var(--fg-muted)",
          subtle: "var(--fg-subtle)"
        }
      },
      fontFamily: {
        // Registrada em runtime por `registerBrandFont` (src/lib/brand-font.ts).
        sans: ['"Drummond Geist"', ...defaultTheme.fontFamily.sans]
      }
    }
  },
  plugins: []
}
