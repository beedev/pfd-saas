import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { OptionList } from '../composed/OptionList';

const meta: Meta<typeof OptionList> = { title: 'Composed/OptionList', component: OptionList };
export default meta;
type Story = StoryObj<typeof OptionList>;

export const SingleSelect: Story = {
  render: () => {
    const [v, setV] = useState<string | string[]>('');
    return (
      <OptionList
        options={[
          { id: 'auto', label: 'Auto Insurance', description: 'Cars, trucks, motorcycles' },
          { id: 'home', label: 'Home Insurance', description: 'House, condo, rental' },
          { id: 'life', label: 'Life Insurance', description: 'Term, whole, universal' },
        ]}
        value={v}
        onChange={setV}
      />
    );
  },
};

export const MultiSelect: Story = {
  render: () => {
    const [v, setV] = useState<string | string[]>([]);
    return (
      <OptionList
        multiSelect
        columns={2}
        options={[
          { id: 'roadside', label: 'Roadside Assistance' },
          { id: 'rental', label: 'Rental Car Coverage' },
          { id: 'accident', label: 'Accident Forgiveness' },
          { id: 'gap', label: 'GAP Coverage' },
        ]}
        value={v}
        onChange={setV}
      />
    );
  },
};
