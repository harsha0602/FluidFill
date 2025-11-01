import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        background: "#1a1b1f",
        primary: "#9d76dd",
        text: "#f4f4f5"
      },
      fontFamily: {
        sans: ["var(--font-inter)", "sans-serif"]
      }
    }
  },
  plugins: []
};

export default config;
