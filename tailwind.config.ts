// tailwind.config.ts
//
// Design tokens for the Event Registration ops console. This is a
// high-density staff tool used at a check-in desk under time pressure, not
// a marketing site — the palette and type choices below are picked for
// that job: cool neutral surfaces (not warm cream), one restrained accent
// for primary actions, a distinct hue per registration status so a table
// full of badges scans instantly, and a monospace face reserved
// specifically for timestamps/counts where column alignment matters.

import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#14171F", // primary text
        "ink-muted": "#5B6270", // secondary text, captions
        "ink-faint": "#8A8F9C", // placeholders, disabled
        bg: "#F5F6F8", // page background — cool neutral, not warm cream
        surface: "#FFFFFF", // cards, table rows, panels
        border: "#E2E4EA",
        "border-strong": "#C7CBD4",
        accent: {
          DEFAULT: "#2F5D9F", // primary actions, links, focus ring
          dark: "#24487F", // hover/active
          tint: "#E9EFF8", // subtle backgrounds (selected nav item, info banners)
        },
        success: { DEFAULT: "#1F8A5F", tint: "#E4F5EC" },
        warning: { DEFAULT: "#B45309", tint: "#FCEEDD" },
        danger: { DEFAULT: "#B42318", tint: "#FBEAE8" },
        reserved: { DEFAULT: "#6B5CA5", tint: "#EFECF7" }, // dedicated hue for RESERVED status
      },
      fontFamily: {
        sans: ["var(--font-plex-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        lg: "10px",
      },
      boxShadow: {
        panel: "0 4px 16px -4px rgba(20, 23, 31, 0.12)",
      },
    },
  },
  plugins: [],
};

export default config;
