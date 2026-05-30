import { BusinessProfileForm } from '@/components/forms/business-profile-form';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your business profile and master data
        </p>
      </div>

      <BusinessProfileForm />
    </div>
  );
}
