/**
 * UX Kit design tokens — TypeScript mirror of the CSS variables in app/globals.css.
 * Use these for inline styles or computed values. For component styling, prefer
 * the CSS Modules in components/ui/* which read the same variables.
 */
export const colors = {
  bg: "var(--bg)",
  bgSubtle: "var(--bg-subtle)",
  bgMuted: "var(--bg-muted)",
  bgHover: "var(--bg-hover)",

  text: "var(--text)",
  textSecondary: "var(--text-secondary)",
  textMuted: "var(--text-muted)",
  textPlaceholder: "var(--text-placeholder)",
  textOnAccent: "var(--text-on-accent)",

  border: "var(--border)",
  borderStrong: "var(--border-strong)",
  borderFocus: "var(--border-focus)",

  accent: "var(--accent)",
  accentHover: "var(--accent-hover)",
  accentActive: "var(--accent-active)",

  success: "var(--success)",
  successBg: "var(--success-bg)",
  warning: "var(--warning)",
  warningBg: "var(--warning-bg)",
  danger: "var(--danger)",
  dangerBg: "var(--danger-bg)",
  info: "var(--info)",
  infoBg: "var(--info-bg)",
} as const;

export const space = {
  s1: "var(--space-1)",
  s2: "var(--space-2)",
  s3: "var(--space-3)",
  s4: "var(--space-4)",
  s5: "var(--space-5)",
  s6: "var(--space-6)",
  s8: "var(--space-8)",
  s10: "var(--space-10)",
  s12: "var(--space-12)",
  s16: "var(--space-16)",
} as const;

export const radius = {
  sm: "var(--radius-sm)",
  md: "var(--radius)",
  lg: "var(--radius-lg)",
  full: "var(--radius-full)",
} as const;

export const shadow = {
  sm: "var(--shadow-sm)",
  md: "var(--shadow)",
  lg: "var(--shadow-lg)",
} as const;

export const fontSize = {
  xs: "var(--text-xs)",
  sm: "var(--text-sm)",
  base: "var(--text-base)",
  md: "var(--text-md)",
  lg: "var(--text-lg)",
  xl: "var(--text-xl)",
  "2xl": "var(--text-2xl)",
} as const;
