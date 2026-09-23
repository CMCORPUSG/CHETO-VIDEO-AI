import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "var(--color-background)",
        surface: "var(--color-surface)",
        card: "var(--color-card)",
        elevated: "var(--color-elevated)",
        line: "var(--color-border)",
        "line-bright": "var(--color-border-bright)",
        ink: "var(--color-text)",
        muted: "var(--color-text-muted)",
        primary: "var(--color-primary)",
        cyan: "var(--color-secondary)",
        accent: "var(--color-accent)",
        violet: "var(--color-violet)",
        success: "var(--color-success)",
        warning: "var(--color-warning)",
        danger: "var(--color-error)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
      },
      boxShadow: {
        card: "var(--shadow-card)",
        "card-hover": "var(--shadow-card-hover)",
        glow: "var(--shadow-glow)",
        modal: "var(--shadow-modal)",
      },
    },
  },
  plugins: [],
} satisfies Config;
