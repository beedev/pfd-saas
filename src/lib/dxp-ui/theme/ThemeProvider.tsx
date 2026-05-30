import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { DxpTheme, defaultTheme, themeToCSS } from './tokens';

const ThemeContext = createContext<DxpTheme>(defaultTheme);

export function useTheme() {
  return useContext(ThemeContext);
}

type DeepPartial<T> = { [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P] };

export interface ThemeProviderProps {
  theme?: DeepPartial<DxpTheme>;
  children: React.ReactNode;
}

export function ThemeProvider({ theme: overrides, children }: ThemeProviderProps) {
  const merged = useMemo<DxpTheme>(
    () => ({
      ...defaultTheme,
      ...overrides,
      colors: { ...defaultTheme.colors, ...overrides?.colors },
    }),
    [overrides],
  );

  useEffect(() => {
    const id = 'dxp-theme-vars';
    let style = document.getElementById(id) as HTMLStyleElement;
    if (!style) {
      style = document.createElement('style');
      style.id = id;
      document.head.appendChild(style);
    }
    style.textContent = themeToCSS(merged);
    return () => { style.textContent = ''; };
  }, [merged]);

  return <ThemeContext.Provider value={merged}>{children}</ThemeContext.Provider>;
}
