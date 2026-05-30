import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect, fn } from '@storybook/test';
import { Button } from '../primitives/Button';

const meta: Meta<typeof Button> = {
  title: 'Primitives/Button',
  component: Button,
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary', 'danger', 'ghost', 'link'] },
    size: { control: 'select', options: ['sm', 'md', 'lg', 'icon'] },
    disabled: { control: 'boolean' },
    children: { control: 'text' },
  },
  args: { onClick: fn() },
};
export default meta;
type Story = StoryObj<typeof Button>;

// Basic — click and verify the handler fires
export const Primary: Story = {
  args: { children: 'Submit Claim', variant: 'primary', size: 'md' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button', { name: /submit claim/i });

    // Verify it renders
    await expect(button).toBeInTheDocument();

    // Click it
    await userEvent.click(button);

    // Verify onClick was called
    await expect(args.onClick).toHaveBeenCalledTimes(1);
  },
};

// Disabled — click should NOT fire handler
export const Disabled: Story = {
  args: { children: 'Cannot Click', variant: 'primary', disabled: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole('button');

    await expect(button).toBeDisabled();
    await userEvent.click(button);
    await expect(args.onClick).not.toHaveBeenCalled();
  },
};

export const Secondary: Story = { args: { children: 'Cancel', variant: 'secondary', size: 'md' } };
export const Danger: Story = { args: { children: 'Delete Policy', variant: 'danger', size: 'md' } };
export const Ghost: Story = { args: { children: 'View Details', variant: 'ghost', size: 'md' } };

export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="link">Link</Button>
      <Button variant="primary" disabled>Disabled</Button>
    </div>
  ),
};
