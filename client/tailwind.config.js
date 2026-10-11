/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { 950: '#050912', 900: '#070b14', 800: '#0b1220', 700: '#0f1a2e', 600: '#15233c', 500: '#1d2e4d' },
        pitch: { 700: '#0d7a3f', 600: '#12994f', 500: '#1fb760', 400: '#3fd582', 300: '#86ebb4' },
        gold: { 600: '#b8902f', 500: '#d9ae44', 400: '#e8c566', 300: '#f2d98f' },
        mist: { 100: '#f4f7fb', 300: '#c3cde0', 400: '#9aa8c4', 500: '#7185a8' },
        alert: { 500: '#ef5359', 400: '#f57c80' },
      },
      fontFamily: {
        display: ['"Barlow Condensed"', '"Arial Narrow"', 'sans-serif'],
        sans: ['Barlow', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      keyframes: {
        pop: { '0%': { transform: 'scale(.96)', opacity: '0' }, '100%': { transform: 'scale(1)', opacity: '1' } },
        flash: { '0%': { backgroundColor: 'rgba(217,174,68,.35)' }, '100%': { backgroundColor: 'transparent' } },
      },
      animation: { pop: 'pop .18s ease-out', flash: 'flash .9s ease-out' },
    },
  },
  plugins: [],
};
