/**
 * Design tokens — the single source of truth for colour, type, spacing,
 * radius and motion. Components must reference CSS variables derived from
 * these values instead of hard-coding values.
 */

export const themes = {
  paper: {
    label: '纸',
    swatchBg: '#F7F4EC',
    swatchInk: '#2A2A28',
    colors: {
      bg: '#F7F4EC',
      surface: '#FBF8F2',
      raised: '#F0ECE2',
      text: '#2A2A28',
      muted: '#6A655B',
      faint: '#8C8679',
      line: 'rgba(42, 42, 40, 0.09)',
      lineStrong: 'rgba(42, 42, 40, 0.17)',
      accent: '#8A6A4F',
      accentSoft: 'rgba(138, 106, 79, 0.10)',
      danger: '#8B4A3B',
      dangerSoft: 'rgba(139, 74, 59, 0.09)',
      warn: '#7C6327',
      warnSoft: 'rgba(124, 99, 39, 0.11)',
      selection: 'rgba(138, 106, 79, 0.20)'
    }
  },
  white: {
    label: '白',
    swatchBg: '#FFFFFF',
    swatchInk: '#1F1F1F',
    colors: {
      bg: '#FFFFFF',
      surface: '#FAFAF8',
      raised: '#F2F2EF',
      text: '#1F1F1F',
      muted: '#5C5C58',
      faint: '#8A8A85',
      line: 'rgba(0, 0, 0, 0.08)',
      lineStrong: 'rgba(0, 0, 0, 0.16)',
      accent: '#6B5A48',
      accentSoft: 'rgba(107, 90, 72, 0.08)',
      danger: '#8B4A3B',
      dangerSoft: 'rgba(139, 74, 59, 0.08)',
      warn: '#7C6327',
      warnSoft: 'rgba(124, 99, 39, 0.10)',
      selection: 'rgba(107, 90, 72, 0.18)'
    }
  },
  sage: {
    label: '豆沙绿',
    swatchBg: '#E9EFE4',
    swatchInk: '#2B332B',
    colors: {
      bg: '#E9EFE4',
      surface: '#EFF4EB',
      raised: '#DFE8D9',
      text: '#2B332B',
      muted: '#5A665A',
      faint: '#7B867B',
      line: 'rgba(43, 51, 43, 0.10)',
      lineStrong: 'rgba(43, 51, 43, 0.18)',
      accent: '#5F6B5A',
      accentSoft: 'rgba(95, 107, 90, 0.10)',
      danger: '#85483C',
      dangerSoft: 'rgba(133, 72, 60, 0.09)',
      warn: '#6F5D28',
      warnSoft: 'rgba(111, 93, 40, 0.11)',
      selection: 'rgba(95, 107, 90, 0.20)'
    }
  },
  night: {
    label: '夜',
    swatchBg: '#16161A',
    swatchInk: '#C9C7C2',
    colors: {
      bg: '#16161A',
      surface: '#1B1B20',
      raised: '#232329',
      text: '#C9C7C2',
      muted: '#98958E',
      faint: '#7A7771',
      line: 'rgba(255, 255, 255, 0.10)',
      lineStrong: 'rgba(255, 255, 255, 0.18)',
      accent: '#B39B7C',
      accentSoft: 'rgba(179, 155, 124, 0.12)',
      danger: '#C98A7B',
      dangerSoft: 'rgba(201, 138, 123, 0.12)',
      warn: '#C2A265',
      warnSoft: 'rgba(194, 162, 101, 0.12)',
      selection: 'rgba(179, 155, 124, 0.24)'
    }
  },
  black: {
    label: '纯黑',
    swatchBg: '#000000',
    swatchInk: '#BDBDBD',
    colors: {
      bg: '#000000',
      surface: '#080808',
      raised: '#121212',
      text: '#C7C7C7',
      muted: '#929292',
      faint: '#6E6E6E',
      line: 'rgba(255, 255, 255, 0.10)',
      lineStrong: 'rgba(255, 255, 255, 0.18)',
      accent: '#B8A184',
      accentSoft: 'rgba(184, 161, 132, 0.12)',
      danger: '#D08C7D',
      dangerSoft: 'rgba(208, 140, 125, 0.12)',
      warn: '#C9A96D',
      warnSoft: 'rgba(201, 169, 109, 0.12)',
      selection: 'rgba(184, 161, 132, 0.24)'
    }
  }
} as const

export type ThemeName = keyof typeof themes

export const themeOrder: ThemeName[] = ['paper', 'white', 'sage', 'night', 'black']

export const fonts = {
  ui: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", system-ui, sans-serif',
  serif:
    '"Source Han Serif SC", "Noto Serif SC", "Songti SC", "STSong", "SimSun", serif',
  sans: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  kai: '"Kaiti SC", "STKaiti", "KaiTi", "BiauKai", serif'
} as const

export type ReaderFont = keyof typeof fonts

export const typography = {
  ui: {
    xs: '12px',
    sm: '13px',
    base: '14px',
    md: '15px',
    lg: '17px',
    xl: '20px',
    title: '26px'
  },
  reader: {
    minSize: 16,
    defaultSize: 19,
    maxSize: 24,
    leading: 1.95,
    measure: '34em',
    paragraphGap: '0.75em',
    titleSize: '26px',
    titleLeading: 1.5
  }
} as const

export const layout = {
  topbar: 48,
  banner: 36,
  panel: 380,
  toc: 296,
  readingPadTop: 68,
  readingPadBottom: 128
} as const

export const radius = {
  sm: 4,
  md: 6,
  lg: 10
} as const

export const motion = {
  quick: 160,
  normal: 200,
  easing: 'cubic-bezier(.2,0,0,1)'
} as const

/** Line weights used by Lucide icons. */
export const iconStroke = 1.5

export function buildTokenCss(): string {
  const rootVars = [
    `--radius-sm: ${radius.sm}px`,
    `--radius-md: ${radius.md}px`,
    `--radius-lg: ${radius.lg}px`,
    `--font-ui: ${fonts.ui}`,
    `--font-serif: ${fonts.serif}`,
    `--font-sans: ${fonts.sans}`,
    `--font-kai: ${fonts.kai}`,
    `--text-xs: ${typography.ui.xs}`,
    `--text-sm: ${typography.ui.sm}`,
    `--text-base: ${typography.ui.base}`,
    `--text-md: ${typography.ui.md}`,
    `--text-lg: ${typography.ui.lg}`,
    `--text-xl: ${typography.ui.xl}`,
    `--text-title: ${typography.ui.title}`,
    `--reader-measure: ${typography.reader.measure}`,
    `--reader-leading: ${typography.reader.leading}`,
    `--reader-paragraph-gap: ${typography.reader.paragraphGap}`,
    `--reader-title-size: ${typography.reader.titleSize}`,
    `--reader-title-leading: ${typography.reader.titleLeading}`,
    `--layout-topbar: ${layout.topbar}px`,
    `--layout-banner: ${layout.banner}px`,
    `--layout-panel: ${layout.panel}px`,
    `--layout-toc: ${layout.toc}px`,
    `--layout-reading-top: ${layout.readingPadTop}px`,
    `--layout-reading-bottom: ${layout.readingPadBottom}px`,
    `--motion-quick: ${motion.quick}ms`,
    `--motion-normal: ${motion.normal}ms`,
    `--motion-ease: ${motion.easing}`
  ]

  const themeRules = Object.entries(themes).map(([name, theme]) => {
    const vars = Object.entries(theme.colors)
      .map(([key, value]) => `--color-${toKebab(key)}: ${value};`)
      .join('\n  ')
    return `:root[data-theme="${name}"] {\n  ${vars}\n}`
  })

  return [`:root {\n  ${rootVars.join(';\n  ')};\n}`, ...themeRules].join('\n\n')
}

function toKebab(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
}
