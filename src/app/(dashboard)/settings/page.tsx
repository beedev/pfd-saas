import { BusinessProfileForm } from '@/components/forms/business-profile-form';
import { PersonalModulesForm } from '@/components/forms/personal-modules-form';
import { TelegramConnectionForm } from '@/components/forms/telegram-connection-form';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your business profile, optional modules, and master data
        </p>
      </div>

      <BusinessProfileForm />
      <PersonalModulesForm />
      <TelegramConnectionForm />
    </div>
  );
}
