import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { Tabs } from '../primitives/Tabs';

const meta: Meta<typeof Tabs> = {
  title: 'Primitives/Tabs',
  component: Tabs,
};
export default meta;
type Story = StoryObj<typeof Tabs>;

const tabs = [
  { key: 'all', label: 'All' },
  { key: 'policy', label: 'Policy Documents' },
  { key: 'claim', label: 'Claim Documents' },
  { key: 'uploads', label: 'Uploads' },
];

export const InteractiveDemo: Story = {
  render: () => {
    const [active, setActive] = useState('all');
    return (
      <div>
        <Tabs tabs={tabs} active={active} onChange={setActive} variant="pill" />
        <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--dxp-text-secondary)' }}>
          Active tab: <strong>{active}</strong>
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Policy Documents'));
    await userEvent.click(canvas.getByText('Claim Documents'));
    await userEvent.click(canvas.getByText('Uploads'));
    await userEvent.click(canvas.getByText('All'));
  },
};

export const Underline: Story = {
  render: () => {
    const [active, setActive] = useState('all');
    return <Tabs tabs={tabs} active={active} onChange={setActive} variant="underline" />;
  },
};
