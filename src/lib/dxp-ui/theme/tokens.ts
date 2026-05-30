// Design tokens — the ONLY theming API exposed to portal developers.
// These map to CSS custom properties that the foundation layer consumes.

export interface DxpTheme {
  colors: {
    brand: string;
    brandDark: string;
    brandLight: string;
    success: string;
    warning: string;
    danger: string;
    info: string;
    background: string;
    surface: string;
    textPrimary: string;
    textSecondary: string;
    textMuted: string;
    border: string;
    borderLight: string;
    /** Chat user-message bubble background. Optional — when unset, the
     * chat falls back to `brand`. Lets tenants whose brand color is
     * very prominent (Meijer red, ACE red) paint user bubbles in a
     * complementary secondary color instead of doubling up. */
    chatUserBubble?: string;
  };
  radius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  density: 'compact' | 'comfortable' | 'spacious';
  fontFamily: string;
}

export const defaultTheme: DxpTheme = {
  colors: {
    brand: '#1d6fb8',
    brandDark: '#175a96',
    brandLight: '#eff8ff',
    success: '#059669',
    warning: '#d97706',
    danger: '#dc2626',
    info: '#2563eb',
    background: '#f9fafb',
    surface: '#ffffff',
    textPrimary: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#9ca3af',
    border: '#e5e7eb',
    borderLight: '#f3f4f6',
  },
  radius: 'md',
  density: 'comfortable',
  fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
};

const radiusMap = { none: '0px', sm: '0.25rem', md: '0.5rem', lg: '0.75rem', full: '9999px' };
const densityMap = {
  compact: { px: '0.5rem', py: '0.25rem', gap: '0.5rem', text: '0.8125rem' },
  comfortable: { px: '0.75rem', py: '0.5rem', gap: '0.75rem', text: '0.875rem' },
  spacious: { px: '1rem', py: '0.75rem', gap: '1rem', text: '0.9375rem' },
};

export function themeToCSS(theme: DxpTheme): string {
  const d = densityMap[theme.density];
  return `:root {
  --dxp-brand: ${theme.colors.brand};
  --dxp-brand-dark: ${theme.colors.brandDark};
  --dxp-brand-light: ${theme.colors.brandLight};
  --dxp-success: ${theme.colors.success};
  --dxp-warning: ${theme.colors.warning};
  --dxp-danger: ${theme.colors.danger};
  --dxp-info: ${theme.colors.info};
  --dxp-bg: ${theme.colors.background};
  --dxp-surface: ${theme.colors.surface};
  --dxp-text: ${theme.colors.textPrimary};
  --dxp-text-secondary: ${theme.colors.textSecondary};
  --dxp-text-muted: ${theme.colors.textMuted};
  --dxp-border: ${theme.colors.border};
  --dxp-border-light: ${theme.colors.borderLight};
  --dxp-radius: ${radiusMap[theme.radius]};
  --dxp-density-px: ${d.px};
  --dxp-density-py: ${d.py};
  --dxp-density-gap: ${d.gap};
  --dxp-density-text: ${d.text};
  --dxp-font: ${theme.fontFamily};
  --dxp-chart-1: ${theme.colors.brand};
  --dxp-chart-2: ${theme.colors.success};
  --dxp-chart-3: ${theme.colors.warning};
  --dxp-chart-4: ${theme.colors.info};
  --dxp-chart-5: ${theme.colors.danger};
  --dxp-chat-user-bubble: ${theme.colors.chatUserBubble ?? theme.colors.brand};
}`;
}
