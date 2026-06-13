import { InstanceNameForm } from '@/components/forms/instance-name-form';
import { BusinessProfileForm } from '@/components/forms/business-profile-form';
import { PersonalModulesForm } from '@/components/forms/personal-modules-form';
import { TelegramConnectionForm } from '@/components/forms/telegram-connection-form';
import { OpenAiKeyForm } from '@/components/forms/openai-key-form';
import { AssetClassReturnsForm } from '@/components/forms/asset-class-returns-form';
import { TaxSetupForm } from '@/components/forms/tax-setup-form';
import { RetirementTaxBracketsForm } from '@/components/forms/retirement-tax-brackets-form';
import { WipeDemoDataCard } from '@/components/forms/wipe-demo-data-card';
import { DataPortabilityCard } from '@/components/forms/data-portability-card';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your business profile, projection assumptions, and master data
        </p>
      </div>

      <InstanceNameForm />
      <BusinessProfileForm />
      <TaxSetupForm />
      <PersonalModulesForm />
      <TelegramConnectionForm />
      <OpenAiKeyForm />
      <AssetClassReturnsForm />
      <RetirementTaxBracketsForm />
      {/* Sprint 6.1.6 — wipe demo data CTA. Visible to everyone; harmless
          when no demo rows exist (the endpoint is idempotent). */}
      <WipeDemoDataCard />
      {/* Sprint 6.4e — export everything as JSON, or replace everything
          from a saved JSON. Replace mode is destructive and gated behind
          a typed "REPLACE" confirmation in the modal. */}
      <DataPortabilityCard />
    </div>
  );
}
