/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brain: {
          base: "#0e0e0e",
          low: "#131313",
          surface: "#1a1a1a",
          high: "#20201f",
          highest: "#262626",
          bright: "#2c2c2c",
          primary: "#9aa8ff",
          "primary-dim": "#8998f0",
          "primary-on": "#122479",
          secondary: "#00e3fd",
          "secondary-dim": "#00d4ec",
          "secondary-on": "#004d57",
          tertiary: "#a68cff",
          muted: "#adaaaa",
          outline: "#484847",
          error: "#ff6e84",
        },
      },
      fontFamily: {
        headline: ["Space Grotesk", "sans-serif"],
        body: ["Inter", "sans-serif"],
        label: ["Manrope", "sans-serif"],
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
