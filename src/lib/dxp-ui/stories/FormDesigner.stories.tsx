import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FormDesigner } from '../composed/FormDesigner';

const meta: Meta<typeof FormDesigner> = { title: 'Composed/FormDesigner', component: FormDesigner };
export default meta;
type Story = StoryObj<typeof FormDesigner>;

export const Empty: Story = {
  render: () => <FormDesigner onSave={(schema) => alert('Saved:\n' + JSON.stringify(schema, null, 2))} />,
};

export const WithInitialSchema: Story = {
  render: () => (
    <FormDesigner
      initialSchema={{
        title: 'Claim Intake Form',
        fields: [
          { type: 'select', key: 'policy', label: 'Policy', required: true, options: [{ value: 'POL-001', label: 'Auto' }, { value: 'POL-002', label: 'Home' }] },
          { type: 'textarea', key: 'description', label: 'Description', required: true },
          { type: 'slider', key: 'amount', label: 'Estimated Amount', min: 0, max: 50000, step: 500, unit: '$' },
          { type: 'upload', key: 'photos', label: 'Photos', accept: 'image/*', multiple: true },
        ],
      }}
      onSave={(schema) => alert('Saved:\n' + JSON.stringify(schema, null, 2))}
    />
  ),
};
