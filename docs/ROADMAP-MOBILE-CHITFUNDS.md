# Roadmap — Chit Funds + iOS Mobile App via TestFlight

Status: **APPROVED PLAN, AWAITING USER GO-AHEAD**. Do not execute until user returns and confirms.

## Summary

Two parallel workstreams:

1. **Chit Funds module** (Phase 8) — 4 hours agent work, ₹0 cost
2. **iOS Mobile App via TestFlight** (Phases M1-M5) — ~17 hours agent work, ₹8,200/yr Apple Developer Program

Recommended order: **Chit Funds first**, then M1-M5, so the first TestFlight build is feature-complete.

---

## Phase 8 — Chit Funds

### Background
Chit funds are a combined savings + zero-interest borrowing product regulated by the
Chit Funds Act 1982. Subscribers contribute a fixed monthly installment for a fixed
duration. Each month, the pot is auctioned; the winner takes home (chit value − bid
discount − foreman's 5% commission). The discount amount is distributed pro-rata as
dividend to all subscribers, reducing their net outgo.

Early winners get an implicit loan. Late winners earn ~6-10% annualised returns.
XIRR reflects the actual realised/projected return.

### 2 new Drizzle tables

```ts
chitFunds {
  id, foremanName, schemeName, registrationNumber, isRegistered,
  chitValuePaisa, monthlyInstallmentPaisa, durationMonths, groupSize,
  ticketNumber, startDate, expectedEndDate, foremanCommissionPct,
  installmentsPaid, totalPaidPaisa, totalDividendsPaisa, netContributionPaisa,
  status ('ACTIVE'|'WON'|'COMPLETED'|'WITHDRAWN'),
  winMonth, winDate, winBidDiscountPct, winAmountReceivedPaisa,
  xirr, nextDueDate, notes,
}

chitFundInstallments {
  id, chitFundId, monthNumber, dueDate,
  installmentPaidPaisa, dividendReceivedPaisa, netOutgoPaisa,
  paidOn, paymentMethod, winnerName, winnerBidDiscountPct, notes,
}
```

### Pages
- `/investments/chit-funds` — list with StatsDisplay (Active count / Total deployed /
  Dividends received / Winnings / Avg XIRR), due-this-month strip, DataTable
- `/investments/chit-funds/new` — register scheme with starting-position toggle
  for already-running chits
- `/investments/chit-funds/[id]` — detail with installment history, "Record installment"
  modal, "Mark as won" modal, cash flow Recharts chart

### API routes
- `GET/POST /api/investments/chit-funds`
- `GET/PATCH/DELETE /api/investments/chit-funds/[id]`
- `GET/POST /api/investments/chit-funds/[id]/installments`
- `POST /api/investments/chit-funds/[id]/win`
- `POST /api/investments/chit-funds/[id]/close`

### Integration
- Sidebar: add Chit Funds under Investments (icon: `Users`)
- Home dashboard: 9th asset class tile
- Retirement projection: include active chit fund contributions in monthly outflow
- Tax page: note dividends are taxable as "Income from Other Sources"

---

## Mobile App — Architecture

```
┌──────────────────────────┐                    ┌─────────────────────┐
│      iPhone              │                    │   Mac (desktop)     │
│                          │                    │                     │
│  TestFlight-installed    │     HTTPS API      │  Next.js dev        │
│  Capacitor app           │ ◄────────────────► │  server :3000       │
└────────────┬─────────────┘                    └──────────┬──────────┘
             │                                             │
             ▼                                             ▼
┌────────────────────────────────────────────────────────────────────┐
│                     Vercel (free tier)                             │
│   Next.js app at https://bharath-finance.vercel.app                │
└─────────────────────────┬──────────────────────────────────────────┘
                          │
                          ▼
┌────────────────────────────────────────────────────────────────────┐
│                     Turso (free tier)                              │
│   Cloud-hosted SQLite (libSQL) · single source of truth            │
└────────────────────────────────────────────────────────────────────┘
```

### Key decisions locked in
- **Capacitor** (not React Native, not pure PWA, not native Swift)
- **TestFlight Internal Testing** for private distribution to the user's iPhone only
- **Turso** for cloud DB (free tier, libSQL = SQLite-compatible, Drizzle supports it)
- **Vercel** for hosting Next.js (free tier)
- **Shared-password middleware auth** on Vercel (simplest for one user)
- **Bundle ID**: `com.bharath.personalfinance`
- **App name**: "Personal Finance"

---

## Prerequisites the user must complete

| Prereq | Action | Cost |
|--------|--------|------|
| Apple Developer Program | Sign up at [developer.apple.com](https://developer.apple.com). 24-48 hr activation | **$99/yr ≈ ₹8,200** |
| Xcode 15+ | Install from Mac App Store (~10 GB) | Free |
| iPhone iOS 16+ | Already have | — |
| TestFlight app on iPhone | Install from App Store | Free |
| Turso account | Sign up at [turso.tech](https://turso.tech) | Free |
| Vercel account | Sign up at [vercel.com](https://vercel.com) | Free |
| Choose Vercel subdomain | e.g., `bharath-finance.vercel.app` | — |

---

## Phase M1 — SQLite → Turso migration (~2 hours agent work)

- Replace `better-sqlite3` with `@libsql/client` in `src/db/index.ts`
- Update Drizzle config for libSQL driver
- Add `.env.local` with `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`
- Write one-shot migration script to copy `personal-finance.db` rows into Turso
- Update all 40+ API routes (mechanical — Drizzle API identical)
- Embedded replica config for Mac dev: reads hit local libSQL file, writes sync
- Verify all GST + investment routes work via Turso
- **Blocking**: user needs to sign up at turso.tech and paste credentials

## Phase M2 — Vercel deployment (~3 hours)

- Add `vercel.json` config
- Set env vars for Turso on Vercel
- **Copy `@dxp/ui` source into `src/lib/dxp-ui/`** (currently a symlink; Vercel can't follow symlinks outside project root)
- Remove `turbopack.root` workaround from `next.config.ts`
- Migrate file uploads from local filesystem → Vercel Blob (free tier: 500 MB)
- Add middleware for shared-password auth via httpOnly cookie
- Deploy via Vercel CLI or GitHub integration
- Verify all 50+ routes work in production
- **Blocking**: user picks subdomain + provides Vercel account

## Phase M3 — Mobile-responsive polish (~4 hours)

- Responsive sidebar → bottom tab bar on `<md` screens (5 tabs: Home / Investments / Tax / Documents / Settings)
- Responsive `DataTable` → card view breakpoint
- Safe-area insets via `env(safe-area-inset-*)` for notch + home indicator
- Apple Web App meta tags in root `layout.tsx`
- Dark mode auto-detect via `prefers-color-scheme`
- 44pt minimum touch targets audit
- Pull-to-refresh on list pages
- Haptic feedback on key actions via `navigator.vibrate`
- Verify by hitting Vercel URL from real iPhone Safari

## Phase M4 — Capacitor iOS shell (~6 hours)

- Install `@capacitor/core` + `@capacitor/ios` + `@capacitor/cli`
- `npx cap init "Personal Finance" com.bharath.personalfinance`
- `npx cap add ios` (creates `ios/` Xcode project)
- `capacitor.config.ts` pointing server.url to Vercel deployment
- Generate 18 iOS icon sizes via `@capacitor/assets` from 1024×1024 source
- Design custom splash screen (amber #b45309 background + ₹ logo)
- Update `Info.plist`:
  - `NSCameraUsageDescription` — "Take photos of tax receipts"
  - `NSPhotoLibraryUsageDescription` — "Attach existing photos of receipts"
  - `NSFaceIDUsageDescription` — "Unlock the app with Face ID"
  - `ITSAppUsesNonExemptEncryption = false`
- Add Capacitor plugins:
  - `@capacitor/camera` — receipt capture
  - `capacitor-native-biometric` — Face ID unlock
  - `@capacitor/haptics`
  - `@capacitor/status-bar`
  - `@capacitor/splash-screen`
- Add `npm run ios:build` and `npm run ios:open` scripts
- Verify build in Xcode iPhone 15 Pro simulator
- **Blocking**: user has Apple Developer Account + Xcode installed

## Phase M5 — TestFlight submission (~2 hours + Apple processing)

- Create App Store Connect app record (bundle ID, name, primary category)
- Configure signing in Xcode → Team = user's Apple Developer account
- Write privacy policy one-pager (required by Apple even for private apps)
- Beta Test Information: app name, description, feedback email, what to test
- Export compliance: declare "no encryption beyond standard HTTPS"
- Xcode: Product → Archive → Distribute → App Store Connect → Upload
- Wait ~10-15 minutes for Apple processing
- Add user's Apple ID as Internal Tester
- Receive TestFlight invite → install via TestFlight app → open → use
- **No App Review required** for Internal Testing — ships in ~15 minutes

---

## Total effort + cost

| | Agent work | User work | Cost |
|---|---|---|---|
| Apple Developer enrolment | — | 10 min + 24-48 hr wait | **$99/yr** |
| Turso + Vercel signups | — | 10 min | $0 |
| Phase 8: Chit Funds | ~4 hr | — | $0 |
| M1: Turso migration | ~2 hr | 5 min | $0 |
| M2: Vercel deploy | ~3 hr | 15 min | $0 |
| M3: Mobile polish | ~4 hr | 10 min verify | $0 |
| M4: Capacitor shell | ~6 hr | 30 min Xcode | $0 |
| M5: TestFlight submit | ~2 hr | 30 min + wait | $0 |
| **Total** | **~21 hr** | **~2 hr + waits** | **$99/yr** |

## Final deliverable

- Private iOS app on user's iPhone via TestFlight
- Same data on Mac + iPhone (single Turso source of truth)
- Offline-capable (bundled UI shell)
- Face ID unlock
- Camera integration for tax receipt capture
- Proper iOS chrome (splash, status bar, haptics, safe areas)
- Production backend on Vercel (no Mac required)
- Private — only user's Apple ID can install
- Updates push instantly via Vercel auto-deploy (no TestFlight resubmit for content changes)

---

## Open decisions (user to confirm when back)

1. **Approve plan?** (or revise)
2. **Has Apple Developer account yet?** If not, start immediately — 24-48 hr activation
3. **Chit funds before or after mobile?** Recommendation: **before**, so first TestFlight build is feature-complete
4. **Vercel auth**: shared password (simple) vs magic link email (nicer)? Recommendation: shared password
5. **Vercel subdomain**: `bharath-finance.vercel.app` / `finance.bharath.dev` / other?
6. **@dxp/ui handling**: copy source into project (simple, loses live link) or publish as private npm (complex, keeps link)? Recommendation: copy
