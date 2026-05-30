import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DynamicForm } from '../composed/DynamicForm';

const meta: Meta<typeof DynamicForm> = { title: 'Composed/DynamicForm', component: DynamicForm };
export default meta;
type Story = StoryObj<typeof DynamicForm>;

export const SingleStep: Story = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <DynamicForm
        schema={{
          title: 'Contact Information',
          fields: [
            { type: 'text', key: 'name', label: 'Full Name', required: true, placeholder: 'John Doe' },
            { type: 'text', key: 'email', label: 'Email', required: true, placeholder: 'john@example.com' },
            { type: 'select', key: 'reason', label: 'Reason for Contact', required: true, options: [{ value: 'quote', label: 'Get a Quote' }, { value: 'claim', label: 'File a Claim' }, { value: 'support', label: 'General Support' }] },
            { type: 'textarea', key: 'message', label: 'Message', placeholder: 'Tell us more...', maxLength: 500 },
          ],
          submitLabel: 'Send Message',
        }}
        onSubmit={(data) => alert(JSON.stringify(data, null, 2))}
      />
    </div>
  ),
};

export const MultiStep: Story = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <DynamicForm
        schema={{
          title: 'File a Claim',
          description: 'Complete this form to submit your claim.',
          steps: [
            {
              title: 'Incident Details',
              fields: [
                { type: 'select', key: 'policy', label: 'Policy', required: true, options: [{ value: 'POL-001', label: 'Auto — Tesla Model 3' }, { value: 'POL-002', label: 'Home — 742 Evergreen' }] },
                { type: 'select', key: 'type', label: 'Claim Type', required: true, options: [{ value: 'collision', label: 'Collision' }, { value: 'water', label: 'Water Damage' }, { value: 'theft', label: 'Theft' }] },
                { type: 'date', key: 'date', label: 'Date of Incident', required: true },
                { type: 'textarea', key: 'description', label: 'What happened?', required: true },
              ],
            },
            {
              title: 'Damage Assessment',
              fields: [
                { type: 'slider', key: 'amount', label: 'Estimated Damage', min: 0, max: 50000, step: 500, unit: '$' },
                { type: 'upload', key: 'photos', label: 'Upload Photos', accept: 'image/*', multiple: true },
                { type: 'checkbox', key: 'injuries', label: 'Were there injuries?', options: [{ value: 'driver', label: 'Driver' }, { value: 'passenger', label: 'Passenger' }, { value: 'third-party', label: 'Third Party' }, { value: 'none', label: 'No injuries' }] },
              ],
            },
            {
              title: 'Review',
              fields: [
                { type: 'section', key: 'review-header', label: 'Review Your Claim', description: 'Please verify all information is correct before submitting.' },
                { type: 'radio', key: 'confirm', label: 'I confirm this information is accurate', required: true, options: [{ value: 'yes', label: 'Yes, submit my claim' }, { value: 'no', label: 'No, I need to make changes' }] },
              ],
            },
          ],
          submitLabel: 'Submit Claim',
        }}
        onSubmit={(data) => alert('Claim submitted:\n' + JSON.stringify(data, null, 2))}
      />
    </div>
  ),
};

export const WithAllFieldTypes: Story = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <DynamicForm
        schema={{
          title: 'All Field Types Demo',
          fields: [
            { type: 'section', key: 's1', label: 'Text Inputs' },
            { type: 'text', key: 'text', label: 'Text', placeholder: 'Type here...' },
            { type: 'textarea', key: 'textarea', label: 'Text Area', placeholder: 'Long text...', maxLength: 200 },
            { type: 'date', key: 'date', label: 'Date' },
            { type: 'section', key: 's2', label: 'Selection' },
            { type: 'select', key: 'select', label: 'Dropdown', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
            { type: 'radio', key: 'radio', label: 'Radio', options: [{ value: 'x', label: 'Option X' }, { value: 'y', label: 'Option Y' }] },
            { type: 'checkbox', key: 'checkbox', label: 'Checkboxes', options: [{ value: '1', label: 'Choice 1' }, { value: '2', label: 'Choice 2' }, { value: '3', label: 'Choice 3' }] },
            { type: 'section', key: 's3', label: 'Other' },
            { type: 'slider', key: 'slider', label: 'Slider', min: 0, max: 100, step: 5, unit: '%' },
            { type: 'upload', key: 'upload', label: 'File Upload', accept: '.pdf,.jpg,.png' },
          ],
        }}
        onSubmit={(data) => alert(JSON.stringify(data, null, 2))}
      />
    </div>
  ),
};
