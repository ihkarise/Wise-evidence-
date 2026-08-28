/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  theme: {
    extend: {
      colors: {
        // Neutral, restrained palette. Outcome/quality/criticism colours are
        // introduced deliberately in later milestones (docs/15), not here.
        ink: {
          DEFAULT: "#1a2233",
          muted: "#4a5568",
        },
        brand: {
          DEFAULT: "#2b5c8a",
          dark: "#1e4266",
        },
      },
    },
  },
  plugins: [],
};
