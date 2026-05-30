import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Citation } from '../composed/Citation';

const meta: Meta<typeof Citation> = { title: 'Composed/Citation', component: Citation };
export default meta;
type Story = StoryObj<typeof Citation>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <Citation number={1} source="State Insurance Code" title="Section 11580 — Uninsured Motorist Coverage" url="https://example.com/code/11580" excerpt="Every policy of bodily injury liability insurance shall provide uninsured motorist coverage..." date="Effective Jan 1, 2024" />
      <Citation number={2} source="NAIC Model Law" title="Property and Casualty Insurance Guaranty Association" excerpt="This Act shall apply to all kinds of direct insurance..." />
      <Citation number={3} source="Company Policy" title="Acme Insurance Claims Handling Procedures" date="Rev. March 2026" />
    </div>
  ),
};
