import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'Liberation Mono',
          'monospace',
        ],
      },
      colors: {
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
        },
        ink: {
          950: '#070a12',
          900: '#0b0f1a',
          850: '#0f1424',
          800: '#151b2e',
          700: '#1d2440',
        },
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
      boxShadow: {
        // Accent-driven; the CSS vars fall back to the indigo brand and are
        // overridden at runtime by white-label branding.
        glow: '0 0 0 1px var(--accent-ring), 0 8px 40px -8px var(--accent-glow)',
        soft: '0 10px 40px -12px rgba(0,0,0,0.6)',
      },
      backdropBlur: {
        xs: '2px',
      },
      keyframes: {
        'blob-1': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(8%,-6%) scale(1.1)' },
          '66%': { transform: 'translate(-6%,4%) scale(0.95)' },
        },
        'blob-2': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '33%': { transform: 'translate(-7%,5%) scale(1.08)' },
          '66%': { transform: 'translate(5%,-8%) scale(0.92)' },
        },
        'blob-3': {
          '0%,100%': { transform: 'translate(0,0) scale(1)' },
          '50%': { transform: 'translate(6%,6%) scale(1.12)' },
        },
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
      animation: {
        'blob-1': 'blob-1 22s ease-in-out infinite',
        'blob-2': 'blob-2 26s ease-in-out infinite',
        'blob-3': 'blob-3 30s ease-in-out infinite',
        'fade-up': 'fade-up 0.5s ease-out both',
        shimmer: 'shimmer 1.6s infinite',
      },
    },
  },
  plugins: [],
};

export default config;
