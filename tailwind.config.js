/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: 'var(--color-bg)',
        surface: 'var(--color-surface)',
        raised: 'var(--color-raised)',
        ink: 'var(--color-text)',
        muted: 'var(--color-muted)',
        faint: 'var(--color-faint)',
        line: 'var(--color-line)',
        'line-strong': 'var(--color-line-strong)',
        accent: 'var(--color-accent)',
        'accent-soft': 'var(--color-accent-soft)',
        danger: 'var(--color-danger)',
        'danger-soft': 'var(--color-danger-soft)',
        warn: 'var(--color-warn)',
        'warn-soft': 'var(--color-warn-soft)'
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)'
      },
      fontFamily: {
        ui: 'var(--font-ui)',
        serif: 'var(--font-serif)',
        sans: 'var(--font-sans)',
        kai: 'var(--font-kai)'
      },
      fontSize: {
        xs: 'var(--text-xs)',
        sm: 'var(--text-sm)',
        base: 'var(--text-base)',
        md: 'var(--text-md)',
        lg: 'var(--text-lg)',
        xl: 'var(--text-xl)',
        title: 'var(--text-title)'
      },
      transitionTimingFunction: {
        quiet: 'cubic-bezier(.2,0,0,1)'
      },
      transitionDuration: {
        160: '160ms',
        180: '180ms',
        200: '200ms'
      },
      boxShadow: {
        hairline: '0 1px 2px rgba(0,0,0,.04)'
      },
      maxWidth: {
        reading: 'var(--reader-measure)'
      }
    }
  },
  plugins: []
}
