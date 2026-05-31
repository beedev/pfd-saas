'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LogOut, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  FileText,
  Users,
  Building2,
  Settings,
  FileSpreadsheet,
  Receipt,
  Calculator,
  Upload,
  TrendingUp,
  Target,
  LineChart,
  BarChart3,
  Wallet,
  PiggyBank,
  Repeat,
  Coins,
  Landmark,
  ShieldCheck,
  HeartPulse,
  Banknote,
  Home,
  Umbrella,
  CreditCard,
  FolderOpen,
  Package,
  Sunset,
  Newspaper,
  Bell,
  CalendarCheck,
} from 'lucide-react';

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard };
type NavSection = { section: string; items: NavItem[] };

const navigation: NavSection[] = [
  {
    section: 'Overview',
    items: [
      { name: 'Net Worth', href: '/', icon: LayoutDashboard },
      { name: 'Daily Digest', href: '/daily-digest', icon: Newspaper },
      { name: 'Alerts', href: '/alerts', icon: Bell },
    ],
  },
  {
    section: 'Investments',
    items: [
      { name: 'Investments', href: '/investments', icon: TrendingUp },
      { name: 'Stocks', href: '/investments/stocks', icon: LineChart },
      { name: 'Mutual Funds', href: '/investments/mutual-funds', icon: PiggyBank },
      { name: 'SIPs', href: '/investments/sips', icon: Repeat },
      { name: 'Gold', href: '/investments/gold', icon: Coins },
      { name: 'NPS', href: '/investments/nps', icon: Landmark },
      { name: 'PF', href: '/investments/pf', icon: ShieldCheck },
      { name: 'Fixed Deposits', href: '/investments/fixed-deposits', icon: Banknote },
      { name: 'Real Estate', href: '/investments/real-estate', icon: Home },
      { name: 'Insurance (Life)', href: '/investments/insurance', icon: Umbrella },
      { name: 'Health Insurance', href: '/investments/health-insurance', icon: HeartPulse },
      { name: 'Liabilities', href: '/investments/liabilities', icon: CreditCard },
      { name: 'Chit Funds', href: '/investments/chit-funds', icon: Users },
    ],
  },
  {
    section: 'Planning & Budget',
    items: [
      { name: 'Income', href: '/income', icon: Banknote },
      { name: 'Budget', href: '/budget', icon: Wallet },
      { name: 'Monthly Expenses', href: '/budget/monthly', icon: Wallet },
      { name: 'Goals', href: '/goals', icon: Target },
      { name: 'Projections', href: '/projections', icon: BarChart3 },
    ],
  },
  {
    section: 'Income Tax',
    items: [
      { name: 'Deductions', href: '/tax', icon: Receipt },
      { name: '80G Donations', href: '/tax/80g', icon: PiggyBank },
      { name: 'Capital Gains', href: '/tax/ltcg-stcg', icon: Calculator },
      { name: 'Documents', href: '/tax/documents', icon: FolderOpen },
      { name: 'Filing Pack', href: '/tax/filing-pack', icon: Package },
      { name: 'ITR-3 Filing', href: '/tax/itr3', icon: FileText },
    ],
  },
  {
    section: 'GST',
    items: [
      { name: 'Sales Invoices', href: '/gst/invoices', icon: FileText },
      { name: 'Purchases', href: '/gst/purchases', icon: Receipt },
      { name: 'GSTR-1', href: '/gst/gstr-1', icon: FileSpreadsheet },
      { name: 'GSTR-3B', href: '/gst/gstr-3b', icon: Calculator },
      { name: 'Customers', href: '/gst/customers', icon: Users },
      { name: 'Vendors', href: '/gst/vendors', icon: Building2 },
      { name: 'Import CSV', href: '/gst/import', icon: Upload },
    ],
  },
  {
    section: 'Analytics',
    items: [
      { name: 'Net Worth History', href: '/networth', icon: TrendingUp },
      { name: 'Retirement', href: '/retirement', icon: Sunset },
    ],
  },
  {
    section: 'Settings',
    items: [
      { name: 'Settings', href: '/settings', icon: Settings },
      { name: 'FY Close', href: '/settings/fy-close', icon: CalendarCheck },
    ],
  },
];

type SidebarProps = {
  /** Whether the current user filed GST during onboarding. When false,
   *  the GST section is hidden — the rest of the app still loads. */
  hasBusinessProfile: boolean;
};

/**
 * Renders BOTH the persistent desktop sidebar (≥md) and the mobile
 * top bar + slide-in drawer (<md). Layout chooses which one to show via
 * Tailwind responsive classes — both elements exist in the DOM but
 * only one is visible at any width. Drawer state lives here.
 */
export function Sidebar({ hasBusinessProfile }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const visibleNav = hasBusinessProfile
    ? navigation
    : navigation.filter((s) => s.section !== 'GST');

  // Close drawer when navigating to a new page. usePathname triggers a
  // re-render on navigation, so this side-effect runs naturally.
  // (No useEffect needed — the close happens via onClick on each Link.)

  const navBody = (
    <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
      {visibleNav.map((section) => (
        <div key={section.section}>
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {section.section}
          </p>
          <div className="space-y-1">
            {section.items.map((item) => {
              const isActive =
                pathname === item.href ||
                (item.href !== '/' && pathname.startsWith(item.href));

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  onClick={() => setMobileOpen(false)}
                  className={cn(
                    'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-300 hover:bg-gray-700 hover:text-white',
                  )}
                >
                  <item.icon
                    className={cn(
                      'mr-3 h-5 w-5 flex-shrink-0',
                      isActive
                        ? 'text-white'
                        : 'text-gray-400 group-hover:text-white',
                    )}
                  />
                  {item.name}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  const footer = (
    <div className="border-t border-gray-800 p-4 space-y-3">
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      >
        <LogOut className="mr-3 h-5 w-5 text-gray-400" />
        Sign out
      </button>
      <p className="text-xs text-gray-500">pfd-saas · v0.1</p>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar — hidden on mobile */}
      <div className="hidden md:flex h-full w-64 flex-col bg-gray-900">
        <div className="flex h-16 items-center justify-center border-b border-gray-800 px-4">
          <h1 className="text-lg font-bold text-white text-center leading-tight">
            Personal Finance
            <br />
            Dashboard
          </h1>
        </div>
        {navBody}
        {footer}
      </div>

      {/* Mobile top bar — hidden on desktop. Fixed position so it doesn't
          eat the main-content height; the dashboard layout adds top
          padding on <md to compensate. */}
      <div className="md:hidden fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-4">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open navigation"
          className="rounded-md p-2 text-gray-300 hover:bg-gray-800 hover:text-white"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-sm font-bold text-white">Personal Finance</h1>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: '/login' })}
          aria-label="Sign out"
          className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-white"
        >
          <LogOut className="h-5 w-5" />
        </button>
      </div>

      {/* Mobile drawer — animates in from the left when mobileOpen */}
      {mobileOpen && (
        <div className="md:hidden fixed inset-0 z-40 flex">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <div className="relative flex h-full w-64 flex-col bg-gray-900 shadow-xl">
            <div className="flex h-14 items-center justify-between border-b border-gray-800 px-4">
              <h1 className="text-sm font-bold text-white">Personal Finance</h1>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close navigation"
                className="rounded-md p-2 text-gray-300 hover:bg-gray-800 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            {navBody}
            {footer}
          </div>
        </div>
      )}
    </>
  );
}
