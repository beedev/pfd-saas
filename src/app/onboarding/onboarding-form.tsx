'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PRODUCT_NAME } from '@/lib/brand';

const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

/**
 * Compute the current Indian financial year string in `YYYY-YY` form.
 * FY runs April → March, so the FY for 2026-04-10 is "2026-27".
 */
function currentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const fyStart = month >= 4 ? year : year - 1;
  const fyEndShort = String((fyStart + 1) % 100).padStart(2, '0');
  return `${fyStart}-${fyEndShort}`;
}

type Props = {
  defaultName: string;
  email: string;
};

export function OnboardingForm({ defaultName, email }: Props) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [displayName, setDisplayName] = useState(defaultName);
  const [fyStartMonth, setFyStartMonth] = useState(4);
  const [filesGst, setFilesGst] = useState(false);

  // GST-specific fields — only sent when filesGst is true.
  const [gstin, setGstin] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [pan, setPan] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!displayName.trim()) {
      setError('Display name is required');
      return;
    }
    if (filesGst) {
      if (!gstin.trim() || gstin.trim().length !== 15) {
        setError('GSTIN must be 15 characters');
        return;
      }
      if (!businessName.trim()) {
        setError('Business name is required when filing GST');
        return;
      }
      if (!pan.trim() || pan.trim().length !== 10) {
        setError('PAN must be 10 characters');
        return;
      }
      if (!stateCode.trim() || !/^\d{2}$/.test(stateCode.trim())) {
        setError('State code must be 2 digits (e.g. 33 for Tamil Nadu)');
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: displayName.trim(),
          financialYearStartMonth: fyStartMonth,
          filesGst,
          gstin: filesGst ? gstin.trim() : null,
          businessName: filesGst ? businessName.trim() : null,
          pan: filesGst ? pan.trim().toUpperCase() : null,
          stateCode: filesGst ? stateCode.trim() : null,
          financialYear: filesGst ? financialYear.trim() : null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Could not complete onboarding');
        return;
      }
      router.push('/');
      router.refresh();
    } catch {
      setError('Network error — please try again');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-amber-100 py-12">
      <div className="mx-auto max-w-xl px-4">
        <div className="rounded-2xl bg-white p-8 shadow-xl border border-amber-200">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-semibold text-gray-900">
              Welcome to {PRODUCT_NAME}
            </h1>
            <p className="text-sm text-gray-500 mt-2">
              Signed in as <span className="font-medium text-gray-700">{email}</span>.
              A couple of quick questions and we&rsquo;ll set up your account.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Display name */}
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1.5">
                Your name
              </label>
              <input
                id="displayName"
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Full name"
                autoFocus
                required
                className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
              />
              <p className="text-xs text-gray-500 mt-1">
                Shown across the app. You can change it later.
              </p>
            </div>

            {/* Currency — locked for v1, shown so the user knows */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Currency
              </label>
              <div className="px-3.5 py-2.5 rounded-lg border border-gray-200 bg-gray-100 text-gray-700">
                INR · Indian Rupee
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {PRODUCT_NAME} is India-only for now. More currencies later.
              </p>
            </div>

            {/* Financial year */}
            <div>
              <label htmlFor="fyStartMonth" className="block text-sm font-medium text-gray-700 mb-1.5">
                Financial year starts in
              </label>
              <select
                id="fyStartMonth"
                value={fyStartMonth}
                onChange={(e) => setFyStartMonth(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">
                Indian standard is April. Affects tax / budget rollover dates.
              </p>
            </div>

            {/* GST toggle */}
            <div className="border-t pt-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={filesGst}
                  onChange={(e) => setFilesGst(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-gray-300 text-amber-700 focus:ring-amber-500"
                />
                <div>
                  <span className="text-sm font-medium text-gray-700">
                    I file GST returns
                  </span>
                  <p className="text-xs text-gray-500 mt-0.5">
                    Enables the GST section: customers, vendors, invoices, GSTR-1, GSTR-3B.
                    Leave unchecked if you don&rsquo;t run a GST-registered business.
                  </p>
                </div>
              </label>
            </div>

            {/* GST details, revealed conditionally */}
            {filesGst && (
              <div className="space-y-4 pl-7 border-l-2 border-amber-200">
                <div>
                  <label htmlFor="gstin" className="block text-sm font-medium text-gray-700 mb-1.5">
                    GSTIN
                  </label>
                  <input
                    id="gstin"
                    type="text"
                    value={gstin}
                    onChange={(e) => setGstin(e.target.value.toUpperCase())}
                    placeholder="22ABCDE1234F1Z5"
                    maxLength={15}
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors font-mono uppercase"
                  />
                </div>

                <div>
                  <label htmlFor="businessName" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Business name
                  </label>
                  <input
                    id="businessName"
                    type="text"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    placeholder="As on GST certificate"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="pan" className="block text-sm font-medium text-gray-700 mb-1.5">
                      PAN
                    </label>
                    <input
                      id="pan"
                      type="text"
                      value={pan}
                      onChange={(e) => setPan(e.target.value.toUpperCase())}
                      placeholder="ABCDE1234F"
                      maxLength={10}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors font-mono uppercase"
                    />
                  </div>
                  <div>
                    <label htmlFor="stateCode" className="block text-sm font-medium text-gray-700 mb-1.5">
                      State code
                    </label>
                    <input
                      id="stateCode"
                      type="text"
                      value={stateCode}
                      onChange={(e) => setStateCode(e.target.value)}
                      placeholder="33"
                      maxLength={2}
                      className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="financialYear" className="block text-sm font-medium text-gray-700 mb-1.5">
                    Current financial year
                  </label>
                  <input
                    id="financialYear"
                    type="text"
                    value={financialYear}
                    onChange={(e) => setFinancialYear(e.target.value)}
                    placeholder="2026-27"
                    className="w-full px-3.5 py-2.5 rounded-lg border border-gray-300 bg-gray-50 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-amber-500 transition-colors font-mono"
                  />
                </div>
              </div>
            )}

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-amber-700 hover:bg-amber-800 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
            >
              {submitting ? 'Setting up…' : 'Get started'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
