'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';
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
      { name: 'Insurance', href: '/investments/insurance', icon: Umbrella },
      { name: 'Liabilities', href: '/investments/liabilities', icon: CreditCard },
      { name: 'Chit Funds', href: '/investments/chit-funds', icon: Users },
    ],
  },
  {
    section: 'Planning & Budget',
    items: [
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

export function Sidebar() {
  const pathname = usePathname();

  return (
    <div className="flex h-full w-64 flex-col bg-gray-900">
      <div className="flex h-16 items-center justify-center border-b border-gray-800 px-4">
        <h1 className="text-lg font-bold text-white text-center leading-tight">
          Personal Finance
          <br />
          Dashboard
        </h1>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-2 py-4">
        {navigation.map((section) => (
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
                    className={cn(
                      'group flex items-center rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-gray-800 text-white'
                        : 'text-gray-300 hover:bg-gray-700 hover:text-white'
                    )}
                  >
                    <item.icon
                      className={cn(
                        'mr-3 h-5 w-5 flex-shrink-0',
                        isActive
                          ? 'text-white'
                          : 'text-gray-400 group-hover:text-white'
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
    </div>
  );
}
