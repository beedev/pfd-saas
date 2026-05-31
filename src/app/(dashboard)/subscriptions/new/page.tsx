'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button, Input, Card, CardHeader, CardContent, Select } from '@dxp/ui';
import {
  Repeat2,
  Loader2,
  ArrowLeft,
  Tv,
  Code,
  Cloud,
  Dumbbell,
  Newspaper,
  Gamepad2,
  Sparkles,
  GraduationCap,
  Briefcase,
  Package,
} from 'lucide-react';

type Category =
  | 'STREAMING'
  | 'SOFTWARE'
  | 'CLOUD'
  | 'FITNESS'
  | 'NEWS'
  | 'GAMING'
  | 'AI'
  | 'EDUCATION'
  | 'PRODUCTIVITY'
  | 'OTHER';

type BillingFrequency = 'MONTHLY' | 'QUARTERLY' | 'SEMI_ANNUAL' | 'ANNUAL' | 'LIFETIME';

const CATEGORY_CARDS: Array<{
  key: Category;
  title: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'STREAMING', title: 'Streaming', description: 'Netflix, Prime, Hotstar, YouTube', Icon: Tv },
  { key: 'SOFTWARE', title: 'Software', description: 'Adobe, Microsoft 365, JetBrains', Icon: Code },
  { key: 'CLOUD', title: 'Cloud', description: 'iCloud, Google One, Dropbox', Icon: Cloud },
  { key: 'FITNESS', title: 'Fitness', description: 'Cult.fit, gym, Peloton', Icon: Dumbbell },
  { key: 'NEWS', title: 'News', description: 'NYT, Bloomberg, magazines', Icon: Newspaper },
  { key: 'GAMING', title: 'Gaming', description: 'Game Pass, PSN+, Steam', Icon: Gamepad2 },
  { key: 'AI', title: 'AI', description: 'ChatGPT, Claude Pro, Copilot', Icon: Sparkles },
  { key: 'EDUCATION', title: 'Education', description: 'Coursera, Udemy, Khan', Icon: GraduationCap },
  { key: 'PRODUCTIVITY', title: 'Productivity', description: 'Notion, Linear, Figma, 1Password', Icon: Briefcase },
  { key: 'OTHER', title: 'Other', description: 'Anything else recurring', Icon: Package },
];

const FREQ_OPTIONS: Array<{ value: BillingFrequency; label: string }> = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUAL', label: 'Semi-annual' },
  { value: 'ANNUAL', label: 'Annual' },
  { value: 'LIFETIME', label: 'Lifetime (one-time)' },
];

export default function NewSubscriptionPage() {
  const router = useRouter();
  const [category, setCategory] = useState<Category | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [name, setName] = useState('');
  const [provider, setProvider] = useState('');
  const [planName, setPlanName] = useState('');
  const [amountRupees, setAmountRupees] = useState('');
  const [billingFrequency, setBillingFrequency] = useState<BillingFrequency>('MONTHLY');
  const [startDate, setStartDate] = useState('');
  const [nextRenewalDate, setNextRenewalDate] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [url, setUrl] = useState('');
  const [notes, setNotes] = useState('');

  const isLifetime = billingFrequency === 'LIFETIME';

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) {
      toast.error('Pick a category');
      return;
    }
    if (!name.trim() || !provider.trim()) {
      toast.error('Name and provider are required');
      return;
    }
    if (!amountRupees) {
      toast.error('Amount is required');
      return;
    }
    if (!startDate) {
      toast.error('Start date is required');
      return;
    }
    if (!isLifetime && !nextRenewalDate) {
      toast.error('Next renewal date is required for non-Lifetime plans');
      return;
    }

    setIsSaving(true);
    try {
      const r = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          provider: provider.trim(),
          category,
          planName: planName.trim() || undefined,
          amountRupees: parseFloat(amountRupees) || 0,
          billingFrequency,
          startDate,
          nextRenewalDate: isLifetime ? undefined : nextRenewalDate,
          paymentMethod: paymentMethod.trim() || undefined,
          autoRenew,
          url: url.trim() || undefined,
          notes: notes.trim() || undefined,
        }),
      });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(data.error || 'Failed to add subscription');
      toast.success('Subscription added');
      const newId = data.subscription?.id;
      if (newId) {
        router.push(`/subscriptions/${newId}`);
      } else {
        router.push('/subscriptions');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add subscription';
      toast.error(msg);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/subscriptions"
          className="inline-flex items-center text-sm text-[var(--dxp-text-secondary)] hover:text-[var(--dxp-brand)]"
        >
          <ArrowLeft className="mr-1 h-4 w-4" /> Back to subscriptions
        </Link>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-[var(--dxp-text)]">
          Add Subscription
        </h1>
        <p className="text-[var(--dxp-text-secondary)]">
          Pick a category, then fill the details.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
        {CATEGORY_CARDS.map(({ key, title, description, Icon }) => {
          const active = category === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setCategory(key)}
              className={`flex flex-col items-start gap-2 rounded-lg border-2 p-4 text-left transition-all ${
                active
                  ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)] shadow-md'
                  : 'border-[var(--dxp-border)] bg-[var(--dxp-surface)] hover:border-[var(--dxp-brand)]/40'
              }`}
            >
              <Icon
                className={`h-5 w-5 ${
                  active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text-muted)]'
                }`}
              />
              <p
                className={`font-semibold ${
                  active ? 'text-[var(--dxp-brand-dark)]' : 'text-[var(--dxp-text)]'
                }`}
              >
                {title}
              </p>
              <p className="text-xs text-[var(--dxp-text-secondary)]">{description}</p>
            </button>
          );
        })}
      </div>

      {category && (
        <Card>
          <CardHeader>
            <h3 className="flex items-center gap-2 text-base font-bold text-[var(--dxp-text)]">
              <Repeat2 className="h-5 w-5 text-[var(--dxp-brand)]" />
              Subscription details
            </h3>
            <p className="text-xs text-[var(--dxp-text-secondary)]">
              Amount in rupees (₹) — stored internally as paisa.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Name
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder='e.g. "Netflix Premium"'
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Provider
                  </label>
                  <Input
                    value={provider}
                    onChange={(e) => setProvider(e.target.value)}
                    placeholder='e.g. "Netflix"'
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Plan name
                  </label>
                  <Input
                    value={planName}
                    onChange={(e) => setPlanName(e.target.value)}
                    placeholder='"Premium 4K", "Family"'
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Amount (₹)
                  </label>
                  <Input
                    type="number"
                    step="0.01"
                    value={amountRupees}
                    onChange={(e) => setAmountRupees(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Billing frequency
                  </label>
                  <Select
                    value={billingFrequency}
                    onChange={(v) => setBillingFrequency(v as BillingFrequency)}
                    options={FREQ_OPTIONS}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Payment method
                  </label>
                  <Input
                    value={paymentMethod}
                    onChange={(e) => setPaymentMethod(e.target.value)}
                    placeholder='"ICICI credit card", "UPI"'
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Start date
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    Next renewal date
                  </label>
                  <Input
                    type="date"
                    value={nextRenewalDate}
                    onChange={(e) => setNextRenewalDate(e.target.value)}
                    disabled={isLifetime}
                  />
                  {isLifetime && (
                    <p className="mt-1 text-xs text-[var(--dxp-text-muted)]">
                      Not needed for Lifetime plans.
                    </p>
                  )}
                </div>
                <div className="md:col-span-2">
                  <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                    URL
                  </label>
                  <Input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://account.provider.com"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-sm text-[var(--dxp-text)]">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(e) => setAutoRenew(e.target.checked)}
                  className="h-4 w-4 rounded border-[var(--dxp-border)]"
                />
                Auto-renew on next billing date
              </label>

              <div>
                <label className="text-sm font-semibold text-[var(--dxp-text)] block mb-1">
                  Notes
                </label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full rounded border border-[var(--dxp-border)] bg-[var(--dxp-surface)] p-2 text-sm text-[var(--dxp-text)] focus:border-[var(--dxp-brand)] focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => router.back()}
                  disabled={isSaving}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={isSaving}>
                  {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save subscription
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
