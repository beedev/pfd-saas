import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { StatsDisplay } from '../composed/StatsDisplay';

const meta: Meta<typeof StatsDisplay> = { title: 'Composed/StatsDisplay', component: StatsDisplay };
export default meta;
type Story = StoryObj<typeof StatsDisplay>;

export const Default: Story = {
  render: () => (
    <StatsDisplay stats={[
      { label: 'Active Policies', value: 3, delta: { value: 12, label: 'vs last month' } },
      { label: 'Open Claims', value: 1, delta: { value: -50, label: 'vs last month' } },
      { label: 'Revenue', value: 148500, format: 'currency', delta: { value: 8.2 } },
      { label: 'Conversion', value: 23.5, format: 'percent', delta: { value: -2.1, label: 'vs last week' } },
    ]} />
  ),
};

export const ThreeColumns: Story = {
  render: () => (
    <StatsDisplay columns={3} stats={[
      { label: 'Users', value: 12400, format: 'compact' },
      { label: 'Sessions', value: 48200, format: 'compact', delta: { value: 15 } },
      { label: 'Bounce Rate', value: 34.2, format: 'percent', delta: { value: -5.1 } },
    ]} />
  ),
};
