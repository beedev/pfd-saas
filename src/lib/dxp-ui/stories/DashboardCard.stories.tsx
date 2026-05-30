import type { Meta, StoryObj } from '@storybook/react';
import { DashboardCard } from '../composed/DashboardCard';

const meta: Meta<typeof DashboardCard> = {
  title: 'Composed/DashboardCard',
  component: DashboardCard,
  argTypes: {
    title: { control: 'text' },
    value: { control: 'text' },
    subtitle: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<typeof DashboardCard>;

export const WithTrend: Story = {
  args: { title: 'Active Policies', value: 3, trend: { value: 12, label: 'vs last month' } },
};

export const WithSubtitle: Story = {
  args: { title: 'Next Payment', value: '$482', subtitle: 'Due April 15, 2026' },
};

export const NegativeTrend: Story = {
  args: { title: 'Open Claims', value: 1, trend: { value: -50, label: 'vs last month' } },
};

export const Clickable: Story = {
  args: { title: 'Pending Documents', value: 2, subtitle: 'Action Needed', onClick: () => alert('Clicked!') },
};

export const Grid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '1.5rem' }}>
      <DashboardCard title="Active Policies" value={3} subtitle="Standard Care" />
      <DashboardCard title="Open Claims" value={1} trend={{ value: -50, label: 'vs last month' }} />
      <DashboardCard title="Pending Docs" value={2} subtitle="Action Needed" />
      <DashboardCard title="Next Payment" value="$482" subtitle="Due Apr 15" />
    </div>
  ),
};
