/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        "mspo-mont": ["Montserrat", "ui-sans-serif", "system-ui", "sans-serif"],
        "mspo-work": ["Work Sans", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        "mspo-navy": "#004884",
        "mspo-blue": "#00aeef",
        "mspo-orange": "#f47b29",
        "mspo-dark": "#003366",
        "mspo-gray": {
          50: "#f9fafb",
          100: "#f2f2f2",
          200: "#e5e7eb",
          300: "#d1d5db",
          400: "#999999",
          500: "#6b7280",
          600: "#4b5563",
          700: "#374151",
          800: "#333333",
          900: "#111827",
        },
      },
    },
  },
  plugins: [],
}
