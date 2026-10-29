import type { Config } from "tailwindcss";

// Every color resolves to a theme channel declared in app/globals.css, so the
// light and dark themes share the same utility classes.
const channel = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;
const scale = (name: string) =>
  Object.fromEntries(
    [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((step) => [
      step,
      channel(name),
    ]),
  );

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // `white` is the foreground ink: `bg-white/5` is a subtle tint in both themes.
        white: channel("fg"),
        backdrop: channel("backdrop"),
        sheet: channel("sheet"),
        surface: { DEFAULT: channel("surface"), 2: channel("surface-2") },
        ink: {
          DEFAULT: channel("fg"),
          dim: channel("ink-dim"),
          faint: channel("ink-faint"),
        },
        accent: {
          DEFAULT: channel("accent"),
          hover: channel("accent-hover"),
          soft: channel("accent-soft"),
          ink: channel("accent-ink"),
          on: channel("on-accent"),
        },
        orange: scale("accent"),
        amber: scale("accent-hover"),
        rose: scale("danger"),
        red: scale("danger"),
        emerald: scale("success"),
        green: scale("success"),
        blue: scale("info"),
        yellow: scale("warn"),
        media: channel("media"),
      },
      fontFamily: {
        sans: ["var(--font-figtree)", "system-ui", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sheet: "var(--radius-sheet)",
        card: "var(--radius-card)",
      },
      boxShadow: {
        lift: "var(--shadow-1)",
        float: "var(--shadow-2)",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
