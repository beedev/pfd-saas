import type { Meta, StoryObj } from '@storybook/react';
import { Badge } from '../primitives/Badge';

const meta: Meta<typeof Badge> = {
  title: 'Primitives/Badge',
  component: Badge,
  argTypes: {
    variant: { control: 'select', options: ['default', 'success', 'warning', 'danger', 'info', 'brand'] },
    children: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<typeof Badge>;

export const Default: Story = { args: { children: 'Draft', variant: 'default' } };
export const Success: Story = { args: { children: 'Active', variant: 'success' } };
export const Warning: Story = { args: { children: 'Pending', variant: 'warning' } };
export const Danger: Story = { args: { children: 'Rejected', variant: 'danger' } };
export const Info: Story = { args: { children: 'Processing', variant: 'info' } };
export const Brand: Story = { args: { children: 'Policy', variant: 'brand' } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
      <Badge variant="default">Draft</Badge>
      <Badge variant="success">Active</Badge>
      <Badge variant="warning">Pending</Badge>
      <Badge variant="danger">Rejected</Badge>
      <Badge variant="info">Processing</Badge>
      <Badge variant="brand">Policy</Badge>
    </div>
  ),
};
