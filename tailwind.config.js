/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        border: 'var(--border)',
        input: 'var(--border)',
        ring: 'var(--border-focus)',
        background: 'var(--bg-primary)',
        foreground: 'var(--text-primary)',
        primary: {
          DEFAULT: 'var(--accent)',
          foreground: '#ffffff'
        },
        secondary: {
          DEFAULT: 'var(--bg-secondary)',
          foreground: 'var(--text-secondary)'
        },
        muted: {
          DEFAULT: 'var(--bg-tertiary)',
          foreground: 'var(--text-muted)'
        },
        accent: {
          DEFAULT: 'var(--accent)',
          foreground: '#ffffff'
        },
        destructive: {
          DEFAULT: 'var(--error)',
          foreground: '#ffffff'
        },
        card: {
          DEFAULT: 'var(--bg-card)',
          foreground: 'var(--text-primary)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace']
      },
      borderRadius: {
        lg: '0.5rem',
        md: '0.375rem',
        sm: '0.25rem'
      }
    }
  },
  plugins: []
}
