import { SettingsTabs } from '@/components/settings/settings-tabs';

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Configure your profile, the Telegram assistant, projection assumptions, and your data
        </p>
      </div>

      <SettingsTabs />
    </div>
  );
}
