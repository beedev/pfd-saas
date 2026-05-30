import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ProgressTracker } from '../composed/ProgressTracker';

const meta: Meta<typeof ProgressTracker> = { title: 'Composed/ProgressTracker', component: ProgressTracker };
export default meta;
type Story = StoryObj<typeof ProgressTracker>;

const steps = [
  { label: 'Claim Filed', description: 'Submitted via portal', status: 'completed' as const, timestamp: 'Mar 10, 9:15 AM' },
  { label: 'Documents Received', description: 'Photos + estimate uploaded', status: 'completed' as const, timestamp: 'Mar 12, 2:30 PM' },
  { label: 'Adjuster Review', description: 'Assigned to Sarah M.', status: 'in-progress' as const, timestamp: 'Mar 18, 10:00 AM' },
  { label: 'Estimate Approved', status: 'pending' as const },
  { label: 'Payment Issued', status: 'pending' as const },
];

export const InProgress: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <ProgressTracker steps={steps} title="CLM-2024-001 — Collision" estimatedCompletion="Apr 5, 2026" />
    </div>
  ),
};

export const AllComplete: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <ProgressTracker steps={steps.map((s) => ({ ...s, status: 'completed' as const }))} title="CLM-2023-003 — Windshield" />
    </div>
  ),
};

export const WithFailure: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <ProgressTracker steps={[
        { label: 'Submitted', status: 'completed' },
        { label: 'Review', status: 'completed' },
        { label: 'Verification', status: 'failed', description: 'Missing documentation' },
        { label: 'Approval', status: 'pending' },
      ]} title="Verification Failed" />
    </div>
  ),
};
