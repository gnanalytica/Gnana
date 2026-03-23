import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        phase: {
          trigger: "#a78bfa",
          analyze: "#60a5fa",
          plan: "#34d399",
          approve: "#f59e0b",
          execute: "#f472b6",
        },
        status: {
          completed: "#22c55e",
          failed: "#ef4444",
          active: "#3b82f6",
          awaiting: "#f59e0b",
          queued: "#6b7280",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
