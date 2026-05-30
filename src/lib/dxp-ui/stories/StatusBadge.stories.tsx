import type { Meta, StoryObj } from '@storybook/react';
import { StatusBadge } from '../composed/StatusBadge';

const meta: Meta<typeof StatusBadge> = {
  title: 'Composed/StatusBadge',
  component: StatusBadge,
  argTypes: {
    status: { control: 'text' },
    label: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<typeof StatusBadge>;

export const Active: Story = { args: { status: 'Active' } };
export const Pending: Story = { args: { status: 'Pending' } };
export const Processing: Story = { args: { status: 'Processing' } };
export const Approved: Story = { args: { status: 'Approved' } };
export const Rejected: Story = { args: { status: 'Rejected' } };
export const Expired: Story = { args: { status: 'Expired' } };
export const CustomLabel: Story = { args: { status: 'Active', label: 'In Force' } };

export const AllStatuses: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      {['Active', 'Approved', 'Completed', 'Pending', 'Processing', 'Review', 'Rejected', 'Denied', 'Failed', 'Expired', 'Draft'].map((s) => (
        <StatusBadge key={s} status={s} />
      ))}
    </div>
  ),
};
