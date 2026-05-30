import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { Input } from '../primitives/Input';

const meta: Meta<typeof Input> = {
  title: 'Primitives/Input',
  component: Input,
  argTypes: {
    placeholder: { control: 'text' },
    type: { control: 'select', options: ['text', 'email', 'password', 'date', 'number'] },
    error: { control: 'boolean' },
    disabled: { control: 'boolean' },
  },
};
export default meta;
type Story = StoryObj<typeof Input>;

export const TypingDemo: Story = {
  args: { placeholder: 'Enter your email...' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('Enter your email...');
    await userEvent.clear(input);
    await userEvent.type(input, 'sarah@acme-insurance.com', { delay: 50 });
    await expect(input).toHaveValue('sarah@acme-insurance.com');
  },
};

export const WithError: Story = {
  args: { placeholder: 'Invalid input', error: true, defaultValue: 'bad-email' },
};

export const DateInput: Story = { args: { type: 'date' } };

export const Disabled: Story = {
  args: { placeholder: 'Cannot edit', disabled: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByPlaceholderText('Cannot edit')).toBeDisabled();
  },
};
