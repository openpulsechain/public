/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{ts,tsx}', './popup.html'],
  theme: {
    extend: {
      colors: {
        pulse: {
          cyan: '#00D4FF',
          purple: '#8000E0',
          dark: '#050510',
        },
      },
    },
  },
  plugins: [],
}
