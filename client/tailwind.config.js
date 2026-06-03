/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#fdf4f0',
          100: '#fbe8de',
          200: '#f6ccb8',
          300: '#f0a989',
          400: '#e87f56',
          500: '#d95f32',
          600: '#c24825',
          700: '#a1371d',
          800: '#832e1c',
          900: '#6c281a',
        },
      },
    },
  },
  plugins: [],
};
