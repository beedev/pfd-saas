'use client';

/**
 * Settings, organised into tabs (Settings IA redesign).
 *
 * Replaces the flat ~14-card scroll with four focused groups:
 *   Profile · Assistant · Projections · Data
 * Each card is an independent client component that fetches its own data, so
 * grouping them is pure composition. Cards that render null when not applicable
 * (e.g. OpenAiKeyForm off the self-host build) simply drop out of their tab.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { InstanceNameForm } from '@/components/forms/instance-name-form';
import { BusinessProfileForm } from '@/components/forms/business-profile-form';
import { PersonalModulesForm } from '@/components/forms/personal-modules-form';
import { TelegramConnectionForm } from '@/components/forms/telegram-connection-form';
import { AssistantApisForm } from '@/components/forms/assistant-apis-form';
import { AssistantActivityCard } from '@/components/forms/assistant-activity-card';
import { OpenAiKeyForm } from '@/components/forms/openai-key-form';
import { AssetClassReturnsForm } from '@/components/forms/asset-class-returns-form';
import { TaxSetupForm } from '@/components/forms/tax-setup-form';
import { RetirementTaxBracketsForm } from '@/components/forms/retirement-tax-brackets-form';
import { WipeDemoDataCard } from '@/components/forms/wipe-demo-data-card';
import { DataPortabilityCard } from '@/components/forms/data-portability-card';

export function SettingsTabs() {
  return (
    <Tabs defaultValue="profile" className="space-y-6">
      <TabsList>
        <TabsTrigger value="profile">Profile &amp; Tax</TabsTrigger>
        <TabsTrigger value="assistant">Assistant</TabsTrigger>
        <TabsTrigger value="projections">Projections</TabsTrigger>
        <TabsTrigger value="data">Data</TabsTrigger>
      </TabsList>

      <TabsContent value="profile" className="space-y-6">
        <InstanceNameForm />
        <BusinessProfileForm />
        <TaxSetupForm />
        <PersonalModulesForm />
      </TabsContent>

      <TabsContent value="assistant" className="space-y-6">
        <TelegramConnectionForm />
        <AssistantApisForm />
        <AssistantActivityCard />
        <OpenAiKeyForm />
      </TabsContent>

      <TabsContent value="projections" className="space-y-6">
        <AssetClassReturnsForm />
        <RetirementTaxBracketsForm />
      </TabsContent>

      <TabsContent value="data" className="space-y-6">
        {/* Sprint 6.4e — export everything as JSON, or replace from JSON
            (destructive, gated behind a typed "REPLACE" confirm). */}
        <DataPortabilityCard />
        {/* Sprint 6.1.6 — wipe demo data CTA (idempotent). */}
        <WipeDemoDataCard />
      </TabsContent>
    </Tabs>
  );
}
