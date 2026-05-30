import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PreferencesPanel, type PreferenceGroup } from '../composed/PreferencesPanel';

const meta: Meta<typeof PreferencesPanel> = { title: 'Composed/PreferencesPanel', component: PreferencesPanel };
export default meta;
type Story = StoryObj<typeof PreferencesPanel>;

export const Default: Story = {
  render: () => {
    const [groups, setGroups] = useState<PreferenceGroup[]>([
      {
        title: 'Notifications',
        items: [
          { id: 'email', label: 'Email Notifications', description: 'Receive updates via email', type: 'toggle', value: true },
          { id: 'sms', label: 'SMS Alerts', description: 'Critical alerts via text', type: 'toggle', value: false },
          { id: 'frequency', label: 'Digest Frequency', type: 'select', value: 'daily', options: [{ value: 'realtime', label: 'Real-time' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }] },
        ],
      },
      {
        title: 'Privacy',
        items: [
          { id: 'analytics', label: 'Usage Analytics', description: 'Help us improve the portal', type: 'toggle', value: true },
          { id: 'marketing', label: 'Marketing Emails', description: 'Product updates and offers', type: 'toggle', value: false },
        ],
      },
    ]);
    const handleChange = (id: string, value: boolean | string) => {
      setGroups((prev) => prev.map((g) => ({
        ...g,
        items: g.items.map((item) => item.id === id ? { ...item, value } : item),
      })));
    };
    return <div style={{ maxWidth: 500 }}><PreferencesPanel groups={groups} onChange={handleChange} /></div>;
  },
};
