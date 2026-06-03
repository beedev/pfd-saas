import { BusinessProfileForm } from '@/components/forms/business-profile-form';
import { PersonalModulesForm } from '@/components/forms/personal-modules-form';
import { TelegramConnectionForm } from '@/components/forms/telegram-connection-form';
import { AssetClassReturnsForm } from '@/components/forms/asset-class-returns-form';
import { TaxSetupForm } from '@/components/forms/tax-setup-form';
import { RetirementTaxBracketsForm } from '@/components/forms/retirement-tax-brackets-form';
import { WipeDemoDataCard } from '@/components/forms/wipe-demo-data-card';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your business profile, projection assumptions, and master data
        </p>
      </div>

      <BusinessProfileForm />
      <TaxSetupForm />
      <PersonalModulesForm />
      <TelegramConnectionForm />
      <AssetClassReturnsForm />
      <RetirementTaxBracketsForm />
      {/* Sprint 6.1.6 — wipe demo data CTA. Visible to everyone; harmless
          when no demo rows exist (the endpoint is idempotent). */}
      <WipeDemoDataCard />
    </div>
  );
}
