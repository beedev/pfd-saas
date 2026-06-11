'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import {
  LogOut,
  Menu,
  X,
  MessageSquare,
  UserCircle,
  ArrowLeftRight,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';
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
  Car,
  Tag,
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
  Activity,
  Sparkles,
  ClipboardCheck,
  FileCheck2,
} from 'lucide-react';

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard };
type NavSection = { section: string; items: NavItem[] };

// Sprint 3.5 Phase 1: Sidebar IA regroup. Three principles:
//   • Top-level sections match the user's mental model (Investments are
//     *what you own*, Insurance is *what protects you*, Liabilities are
//     *what you owe*).
//   • URLs are stable. The detail pages still live under /investments/*
//     where they always did — only the sidebar groupings change.
//     Bookmarks and external links continue to work.
//   • Retirement moves under Planning (it's a planning horizon, not an
//     analytics report).
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
      { name: 'Overview', href: '/investments', icon: TrendingUp },
      { name: 'Stocks', href: '/investments/stocks', icon: LineChart },
      { name: 'Mutual Funds', href: '/investments/mutual-funds', icon: PiggyBank },
      { name: 'SIPs', href: '/investments/sips', icon: Repeat },
      { name: 'Gold', href: '/investments/gold', icon: Coins },
      { name: 'NPS', href: '/investments/nps', icon: Landmark },
      { name: 'EPF', href: '/investments/pf', icon: ShieldCheck },
      { name: 'Small Savings', href: '/investments/small-savings', icon: PiggyBank },
      { name: 'Fixed Deposits', href: '/investments/fixed-deposits', icon: Banknote },
      { name: 'Real Estate', href: '/investments/real-estate', icon: Home },
      // Sprint 5.10d — Forex deposits asset class.
      { name: 'Forex Deposits', href: '/investments/forex-deposits', icon: Banknote },
      { name: 'Chit Funds', href: '/investments/chit-funds', icon: Users },
      // Sprint 5.6e — EPF / NPS PDF statement importer.
      { name: 'Import from statement', href: '/investments/import-statement', icon: Upload },
    ],
  },
  {
    section: 'Insurance',
    items: [
      { name: 'Overview', href: '/insurance', icon: Umbrella },
      { name: 'Life', href: '/investments/insurance', icon: Umbrella },
      { name: 'Health', href: '/investments/health-insurance', icon: HeartPulse },
      { name: 'Vehicles', href: '/investments/vehicles', icon: Car },
    ],
  },
  {
    section: 'Liabilities',
    items: [
      { name: 'Loans & Credit Cards', href: '/investments/liabilities', icon: CreditCard },
    ],
  },
  {
    section: 'Planning',
    items: [
      { name: 'Subscriptions', href: '/subscriptions', icon: Tag },
      { name: 'Budget', href: '/budget', icon: Wallet },
      { name: 'Monthly Expenses', href: '/budget/monthly', icon: Wallet },
      { name: 'Cashflow Events', href: '/planning/cashflows', icon: Activity },
      { name: 'Goals', href: '/goals', icon: Target },
      { name: 'Projections', href: '/projections', icon: BarChart3 },
      { name: 'Retirement', href: '/retirement', icon: Sunset },
    ],
  },
  {
    section: 'Personal',
    items: [
      { name: 'Today', href: '/health/transformation', icon: Sparkles },
      { name: 'History', href: '/health/transformation/history', icon: CalendarCheck },
    ],
  },
  {
    section: 'Income Tax',
    items: [
      { name: 'Income', href: '/income', icon: Banknote },
      { name: 'Deductions', href: '/tax', icon: Receipt },
      // Sprint C — reconciliation triangle (books vs Form 16 vs 26AS)
      { name: 'Reconciliation', href: '/tax/reconciliation', icon: Calculator },
      { name: 'Form 16', href: '/tax/form-16', icon: FileText },
      { name: '80G Donations', href: '/tax/80g', icon: PiggyBank },
      { name: 'Capital Gains', href: '/tax/ltcg-stcg', icon: Calculator },
      { name: 'Form 26AS', href: '/tax/form-26as', icon: ClipboardCheck },
      { name: 'Documents', href: '/tax/documents', icon: FolderOpen },
      { name: 'Filing Pack', href: '/tax/filing-pack', icon: Package },
      { name: 'ITR Wizard', href: '/tax/itr-wizard', icon: FileCheck2 },
      { name: 'ITR-1 Sahaj', href: '/tax/itr1', icon: FileText },
      { name: 'ITR-2', href: '/tax/itr2', icon: FileText },
      { name: 'ITR-3', href: '/tax/itr3', icon: FileText },
      { name: 'ITR-4 Sugam', href: '/tax/itr4', icon: FileText },
      { name: 'Import from TaxCalc', href: '/tax/import', icon: Upload },
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
    ],
  },
  {
    // Sprint 6.2h — Reports hub. 10th sidebar section between
    // Analytics and Settings. Single entry; the hub itself groups
    // the 9 reports into three category cards (tax / wealth /
    // planning) so the sidebar stays clean.
    section: 'Reports',
    items: [
      { name: 'Reports', href: '/reports', icon: FileText },
    ],
  },
  {
    section: 'Settings',
    items: [
      { name: 'Settings', href: '/settings', icon: Settings },
      { name: 'Tax Rates & Rules', href: '/settings/tax-rules', icon: Calculator },
      { name: 'FY Close', href: '/settings/fy-close', icon: CalendarCheck },
    ],
  },
];

type SidebarProps = {
  /** Whether the current user filed GST during onboarding. When false,
   *  the GST section is hidden — the rest of the app still loads. */
  hasBusinessProfile: boolean;
  /** Whether the user has opted into the optional personal-development
   *  modules (Transformation tracker, etc.). Off by default — pfd-saas
   *  is finance-first. Hide the "Personal" section when false. */
  habitsEnabled: boolean;
  /** Sprint 6.1.6 — destination for the sidebar "Send feedback" link.
   *  Read from the FEEDBACK_URL env var on the server (so runtime
   *  overrides work without rebuilding the image); defaults to a
   *  mailto: when unset. */
  feedbackUrl: string;
  /** Sprint 6.1.9d — Docker self-host built-in account switcher.
   *  When true (DEMO_PERSONAL_SWITCH=true on the server), the sidebar
   *  surfaces the current account label + a Switch button that flips
   *  to the other account via /api/auth/switch-account. Off in
   *  production SaaS — magic-link sessions hide the row. */
  accountSwitcherEnabled: boolean;
  /** Email of the signed-in user. Used by the switcher row to label
   *  the current account. */
  userEmail: string | null;
};

// Sprint: collapsible sidebar sections. localStorage key for the persisted
// expanded-section set. A user's manual expand/collapse choices stick across
// navigations and reloads; first load with no stored state auto-expands only
// the section containing the active route.
const EXPANDED_STORAGE_KEY = 'pfd-sidebar-expanded';

/**
 * Returns the set of section names that contain the active route, using the
 * SAME active-route test the NavItem highlight uses. A section is "active"
 * when any of its items matches the current pathname. Used both to seed the
 * default expanded set on first load and to auto-open the right section.
 */
function activeSectionsFor(sections: NavSection[], pathname: string): string[] {
  return sections
    .filter((s) =>
      s.items.some(
        (item) =>
          pathname === item.href ||
          (item.href !== '/' && pathname.startsWith(item.href)),
      ),
    )
    .map((s) => s.section);
}

/**
 * Renders BOTH the persistent desktop sidebar (≥md) and the mobile
 * top bar + slide-in drawer (<md). Layout chooses which one to show via
 * Tailwind responsive classes — both elements exist in the DOM but
 * only one is visible at any width. Drawer state lives here.
 */
export function Sidebar({
  hasBusinessProfile,
  habitsEnabled,
  feedbackUrl,
  accountSwitcherEnabled,
  userEmail,
}: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const visibleNav = useMemo(
    () =>
      navigation.filter((s) => {
        if (s.section === 'GST' && !hasBusinessProfile) return false;
        if (s.section === 'Personal' && !habitsEnabled) return false;
        return true;
      }),
    [hasBusinessProfile, habitsEnabled],
  );

  // ─── Collapsible-section state ──────────────────────────────────
  // `expanded` holds the set of currently-open section names. We seed it
  // synchronously from the active route (so SSR + the very first client
  // paint agree and there's no hydration flash), then, after mount, hydrate
  // from localStorage if the user has a stored preference.
  const initialExpanded = useMemo(
    () => new Set(activeSectionsFor(visibleNav, pathname)),
    // Seed once on mount; subsequent active-route changes are handled by the
    // effect below so we don't clobber the user's manual toggles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  // Tracks whether we've read the stored preference yet — guards the persist
  // effect from writing the seed value back before hydration completes.
  const [hydrated, setHydrated] = useState(false);

  // On mount: if the user has a saved expanded-set, use it. Otherwise keep
  // the active-route seed (which is already in state).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as string[];
        if (Array.isArray(stored)) setExpanded(new Set(stored));
      }
    } catch {
      // Corrupt/blocked storage — fall back to the active-route seed.
    }
    setHydrated(true);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-expand the active section on navigation. We only ADD the active
  // section(s); we never collapse what the user has open, so manual choices
  // stick. Runs after navigation (pathname change) once hydrated.
  useEffect(() => {
    if (!hydrated) return;
    const active = activeSectionsFor(visibleNav, pathname);
    if (active.length === 0) return;
    setExpanded((prev) => {
      const needsAdd = active.some((name) => !prev.has(name));
      if (!needsAdd) return prev;
      const next = new Set(prev);
      active.forEach((name) => next.add(name));
      return next;
    });
  }, [pathname, hydrated, visibleNav]);

  // Persist whenever the expanded set changes (after hydration only).
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(
        EXPANDED_STORAGE_KEY,
        JSON.stringify(Array.from(expanded)),
      );
    } catch {
      // Storage unavailable (private mode / quota) — non-fatal.
    }
  }, [expanded, hydrated]);

  const toggleSection = (section: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  // ─── Account-switcher state (Docker self-host only) ─────────────
  // Email → display label mapping. The Demo well-known account uses
  // demo@pfd-saas.local; anything else falls into the Personal bucket
  // (matches the spec at the route handler — only 'demo' vs 'personal'
  // exist as switch targets, no third state).
  const isDemo = userEmail === 'demo@pfd-saas.local';
  const currentLabel = isDemo ? 'Demo' : 'Personal';
  const switchTarget: 'demo' | 'personal' = isDemo ? 'personal' : 'demo';
  const switchTargetLabel = isDemo ? 'Personal' : 'Demo';

  async function handleSwitch() {
    if (switching) return;
    setSwitching(true);
    try {
      const res = await fetch(`/api/auth/switch-account?to=${switchTarget}`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      if (res.ok) {
        // Force a hard reload so server components re-fetch with the
        // new session cookie. router.refresh() alone keeps the stale
        // session in flight on some routes.
        window.location.href = '/';
        return;
      }
      console.error('[sidebar] switch failed:', await res.text());
    } catch (err) {
      console.error('[sidebar] switch threw:', err);
    } finally {
      setSwitching(false);
    }
  }

  // Close drawer when navigating to a new page. usePathname triggers a
  // re-render on navigation, so this side-effect runs naturally.
  // (No useEffect needed — the close happens via onClick on each Link.)

  // ─── Account-switcher row — Docker self-host only ───────────────
  // Sits above the nav. Hidden in production SaaS deployments because
  // the only paths to a session there are the magic-link or onboarding
  // flow — there is no other account to switch to.
  const accountSwitcherRow = accountSwitcherEnabled ? (
    <div className="border-b border-gray-800 px-3 py-3 space-y-1">
      <div className="flex items-center px-1 text-xs text-gray-300">
        <UserCircle className="mr-2 h-4 w-4 text-gray-400" />
        <span className="font-medium text-white">{currentLabel}</span>
        <span className="ml-auto text-[10px] uppercase tracking-wider text-gray-500">
          Account
        </span>
      </div>
      <button
        type="button"
        onClick={handleSwitch}
        disabled={switching}
        className="flex w-full items-center rounded-md px-2 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-800 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-wait"
        title={`Switch to the ${switchTargetLabel} account`}
      >
        <ArrowLeftRight className="mr-2 h-3.5 w-3.5 text-gray-400" />
        {switching ? 'Switching…' : `Switch to ${switchTargetLabel}`}
      </button>
    </div>
  ) : null;

  const navBody = (
    <nav className="flex-1 space-y-1 overflow-y-auto px-2 py-4">
      {visibleNav.map((section) => {
        const isOpen = expanded.has(section.section);
        return (
          <div key={section.section}>
            <button
              type="button"
              onClick={() => toggleSection(section.section)}
              aria-expanded={isOpen}
              className="group flex w-full items-center rounded-md px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-500 transition-colors hover:bg-gray-800/60 hover:text-gray-300"
            >
              {isOpen ? (
                <ChevronDown className="mr-1.5 h-3.5 w-3.5 flex-shrink-0 text-gray-500 group-hover:text-gray-300" />
              ) : (
                <ChevronRight className="mr-1.5 h-3.5 w-3.5 flex-shrink-0 text-gray-500 group-hover:text-gray-300" />
              )}
              <span>{section.section}</span>
            </button>
            {isOpen && (
              <div className="mt-1 mb-2 space-y-1">
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
            )}
          </div>
        );
      })}
    </nav>
  );

  const footer = (
    <div className="border-t border-gray-800 p-4 space-y-1">
      <a
        href={feedbackUrl}
        target={feedbackUrl.startsWith('http') ? '_blank' : undefined}
        rel={feedbackUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
        title="This is a preview build. Bug reports and feature requests welcome."
        className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      >
        <MessageSquare className="mr-3 h-5 w-5 text-gray-400" />
        Send feedback
      </a>
      <button
        type="button"
        onClick={() => signOut({ callbackUrl: '/login' })}
        className="flex w-full items-center rounded-md px-3 py-2 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
      >
        <LogOut className="mr-3 h-5 w-5 text-gray-400" />
        Sign out
      </button>
      <p className="pt-2 text-xs text-gray-500">pfd-saas · v0.1</p>
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
        {accountSwitcherRow}
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
            {accountSwitcherRow}
            {navBody}
            {footer}
          </div>
        </div>
      )}
    </>
  );
}
