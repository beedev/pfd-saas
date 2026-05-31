'use client';

import { useEffect } from 'react';

/**
 * Registers /sw.js with the browser. Mounted once from the root layout
 * so it runs on every page (but registration itself is idempotent —
 * registering an existing SW is a no-op).
 *
 * Only registers in production builds; in dev the build artefacts move
 * around and a cached SW can serve stale chunks across Turbopack hot
 * reloads. Disabling in dev keeps the inner-loop tight.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        // Service worker is best-effort. A failed registration shouldn't
        // crash the app — just log it.
        console.warn('[pfd-saas] service worker registration failed:', err);
      });
    };

    if (document.readyState === 'complete') {
      onLoad();
    } else {
      window.addEventListener('load', onLoad, { once: true });
      return () => window.removeEventListener('load', onLoad);
    }
  }, []);

  return null;
}
