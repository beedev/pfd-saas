import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { DocumentCard } from '../composed/DocumentCard';

const meta: Meta<typeof DocumentCard> = {
  title: 'Composed/DocumentCard',
  component: DocumentCard,
  argTypes: {
    category: { control: 'select', options: ['policy', 'claim', 'upload'] },
    fileType: { control: 'select', options: ['pdf', 'image', 'zip', 'doc'] },
    name: { control: 'text' },
    reference: { control: 'text' },
    date: { control: 'text' },
    size: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<typeof DocumentCard>;

export const PolicyDoc: Story = {
  args: { name: 'Auto Policy Declaration', category: 'policy', reference: 'POL-001', date: 'Jan 15', size: '245 KB', fileType: 'pdf', onDownload: () => alert('Download') },
};

export const ClaimDoc: Story = {
  args: { name: 'Collision Photos', category: 'claim', reference: 'CLM-2024-001', date: 'Mar 10', size: '8.4 MB', fileType: 'zip' },
};

export const ImageDoc: Story = {
  args: { name: 'Damage Assessment Photo', category: 'claim', reference: 'CLM-2024-001', date: 'Mar 12', size: '1.2 MB', fileType: 'image' },
};

export const Grid: Story = {
  render: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
      <DocumentCard name="Auto Policy Declaration" category="policy" reference="POL-001" date="Jan 15" size="245 KB" fileType="pdf" onDownload={() => {}} />
      <DocumentCard name="Home Inspection Report" category="policy" reference="POL-002" date="Nov 10" size="1.2 MB" fileType="pdf" onDownload={() => {}} />
      <DocumentCard name="Collision Photos" category="claim" reference="CLM-2024-001" date="Mar 10" size="8.4 MB" fileType="zip" onDownload={() => {}} />
    </div>
  ),
};
