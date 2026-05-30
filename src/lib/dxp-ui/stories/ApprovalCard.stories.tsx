import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ApprovalCard } from '../composed/ApprovalCard';

const meta: Meta<typeof ApprovalCard> = { title: 'Composed/ApprovalCard', component: ApprovalCard };
export default meta;
type Story = StoryObj<typeof ApprovalCard>;

export const Pending: Story = {
  render: () => {
    const [status, setStatus] = useState<'pending' | 'approved' | 'rejected'>('pending');
    return (
      <div style={{ maxWidth: 500 }}>
        <ApprovalCard
          title="Policy Change Request"
          description="Add comprehensive coverage to POL-001"
          metadata={[
            { label: 'Policy', value: 'POL-001' },
            { label: 'Change', value: 'Add Comprehensive' },
            { label: 'New Premium', value: '$215/mo (+$30)' },
            { label: 'Effective', value: 'Apr 1, 2026' },
          ]}
          status={status}
          onApprove={() => setStatus('approved')}
          onReject={() => setStatus('rejected')}
        />
      </div>
    );
  },
};

export const Approved: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <ApprovalCard title="Claim Payment" description="Approve $4,200 for CLM-2024-001" status="approved" />
    </div>
  ),
};

export const Rejected: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <ApprovalCard title="Coverage Upgrade" description="Upgrade from basic to premium tier" status="rejected" />
    </div>
  ),
};
