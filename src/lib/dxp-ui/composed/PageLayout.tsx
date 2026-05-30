import React, { useState } from 'react';
import { Button } from '../primitives/Button';
import { Breadcrumb, type BreadcrumbItem } from './Breadcrumb';

export interface NavItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  active?: boolean;
}

export interface PageLayoutProps {
  appName: string;
  navItems: NavItem[];
  userMenu?: React.ReactNode;
  actions?: React.ReactNode;
  /** Breadcrumb trail rendered above page content. Falls back to home only when not provided. */
  breadcrumbs?: BreadcrumbItem[];
  children: React.ReactNode;
  onNavigate: (href: string) => void;
}

export function PageLayout({ appName, navItems, userMenu, actions, breadcrumbs, children, onNavigate }: PageLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen" style={{ background: 'var(--dxp-bg)', fontFamily: 'var(--dxp-font)' }}>
      <aside className={`${sidebarOpen ? 'w-60' : 'w-16'} flex flex-col border-r border-[var(--dxp-border)] bg-[var(--dxp-surface)] transition-all duration-200`}>
        <div className="flex h-14 items-center gap-2 border-b border-[var(--dxp-border)] px-4">
          <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)}>
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </Button>
          {sidebarOpen && <span className="text-sm font-bold text-[var(--dxp-text)]">{appName}</span>}
        </div>
        <nav className="flex-1 space-y-0.5 px-2 py-3">
          {navItems.map((item) => (
            <button
              key={item.href}
              onClick={() => onNavigate(item.href)}
              className={`flex w-full items-center gap-3 rounded-[var(--dxp-radius)] px-3 py-2 text-sm font-medium transition-colors ${
                item.active
                  ? 'bg-[var(--dxp-brand-light)] text-[var(--dxp-brand)]'
                  : 'text-[var(--dxp-text-secondary)] hover:bg-[var(--dxp-border-light)] hover:text-[var(--dxp-text)]'
              }`}
            >
              {item.icon && <span className="flex-shrink-0">{item.icon}</span>}
              {sidebarOpen && <span>{item.label}</span>}
            </button>
          ))}
        </nav>
        {userMenu && sidebarOpen && <div className="border-t border-[var(--dxp-border)] p-3">{userMenu}</div>}
      </aside>
      <main className="flex-1 overflow-y-auto">
        {actions && (
          <div className="flex items-center justify-end border-b border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-6 py-2">
            {actions}
          </div>
        )}
        <div className="mx-auto max-w-6xl px-6 py-6">
          {breadcrumbs && breadcrumbs.length > 1 && (
            <div className="mb-4">
              <Breadcrumb items={breadcrumbs} onNavigate={onNavigate} />
            </div>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}
