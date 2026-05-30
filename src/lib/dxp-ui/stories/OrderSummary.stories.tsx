import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { OrderSummary } from '../composed/OrderSummary';

const meta: Meta<typeof OrderSummary> = { title: 'Composed/OrderSummary', component: OrderSummary };
export default meta;
type Story = StoryObj<typeof OrderSummary>;

export const PolicyPurchase: Story = {
  render: () => (
    <div style={{ maxWidth: 400 }}>
      <OrderSummary
        title="Policy Purchase Summary"
        items={[
          { label: 'Auto Insurance — Premium', detail: '2024 Tesla Model 3', amount: '$185/mo' },
          { label: 'Comprehensive Coverage', detail: '$500 deductible', amount: '$45/mo' },
          { label: 'Roadside Assistance', amount: '$12/mo' },
          { label: 'Bundle Discount', amount: '-$25/mo', highlight: true },
        ]}
        taxes={{ label: 'Taxes & Fees', amount: '$8.50/mo' }}
        total={{ label: 'Monthly Total', amount: '$225.50/mo' }}
        onConfirm={() => alert('Confirmed!')}
        onCancel={() => alert('Cancelled')}
        confirmLabel="Purchase Policy"
        note="You can cancel anytime within 30 days for a full refund."
      />
    </div>
  ),
};
