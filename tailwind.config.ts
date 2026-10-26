import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: "rgb(var(--bg-primary-ch) / <alpha-value>)",
          secondary: "rgb(var(--bg-secondary-ch) / <alpha-value>)",
          tertiary: "rgb(var(--bg-tertiary-ch) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--accent-ch) / <alpha-value>)",
          hover: "rgb(var(--accent-hover-ch) / <alpha-value>)",
          muted: "rgb(var(--accent-ch) / 0.15)",
        },
        text: {
          DEFAULT: "#CCCCDD",
          muted: "#9494B8",
          inverted: "#080812",
        },
        border: {
          DEFAULT: "rgb(var(--accent-ch) / 0.15)",
          strong: "rgb(var(--accent-ch) / 0.4)",
        },
        gaming: {
          blue: "#00D4FF",
          purple: "#8B5CF6",
          gold: "#FFD700",
          red: "#EF4444",
          orange: "#F97316",
          green: "#1DB954",
        },
      },
      fontFamily: {
        orbitron: ["var(--font-orbitron)", "monospace"],
        rajdhani: ["var(--font-rajdhani)", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "monospace"],
        inter: ["var(--font-inter)", "Inter", "system-ui", "sans-serif"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)",
        "radial-glow":
          "radial-gradient(circle at center, rgb(var(--accent-ch) / 0.07) 0%, transparent 70%)",
        "gradient-accent":
          "linear-gradient(135deg, rgb(var(--accent-ch)) 0%, rgb(var(--accent-hover-ch)) 100%)",
      },
      backgroundSize: {
        grid: "60px 60px",
      },
      boxShadow: {
        glow: "0 0 20px rgb(var(--accent-ch) / 0.3)",
        "glow-lg": "0 0 40px rgb(var(--accent-ch) / 0.4)",
        "glow-blue": "0 0 20px rgba(0, 212, 255, 0.3)",
        "glow-purple": "0 0 20px rgba(139, 92, 246, 0.3)",
        card: "0 4px 24px rgba(0, 0, 0, 0.4)",
      },
      keyframes: {
        flicker: {
          "0%, 94%, 96%, 100%": { opacity: "1" },
          "95%": { opacity: "0.7" },
        },
        // pulse-border defined in globals.css using CSS variables
        "pulse-border": {},
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        flicker: "flicker 6s ease-in-out infinite",
        "pulse-border": "pulse-border 3s ease-in-out infinite",
        "slide-up": "slide-up 0.5s ease-out",
        "fade-in": "fade-in 0.4s ease-out",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
