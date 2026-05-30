import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Select } from '../primitives/Select';

const meta: Meta<typeof Select> = { title: 'Primitives/Select', component: Select };
export default meta;
type Story = StoryObj<typeof Select>;

export const Default: Story = {
  render: () => {
    const [v, setV] = useState('');
    return <Select label="Policy Type" options={[{ value: 'auto', label: 'Auto' }, { value: 'home', label: 'Home' }, { value: 'life', label: 'Life' }]} value={v} onChange={setV} />;
  },
};
export const WithError: Story = {
  render: () => <Select label="Required Field" error options={[{ value: 'a', label: 'Option A' }]} />,
};
