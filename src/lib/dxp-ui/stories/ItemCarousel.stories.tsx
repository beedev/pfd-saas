import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ItemCarousel } from '../composed/ItemCarousel';
import { Card, CardContent } from '../primitives/Card';
import { Badge } from '../primitives/Badge';

const meta: Meta<typeof ItemCarousel> = { title: 'Composed/ItemCarousel', component: ItemCarousel };
export default meta;
type Story = StoryObj<typeof ItemCarousel>;

export const PolicyCards: Story = {
  render: () => (
    <ItemCarousel
      title="Your Policies"
      items={[
        { id: '1', content: <PolicyCard type="Auto" name="2024 Tesla Model 3" premium="$185/mo" status="Active" /> },
        { id: '2', content: <PolicyCard type="Home" name="742 Evergreen Terrace" premium="$215/mo" status="Active" /> },
        { id: '3', content: <PolicyCard type="Life" name="Term Life 20yr" premium="$82/mo" status="Active" /> },
        { id: '4', content: <PolicyCard type="Auto" name="2022 Honda Civic" premium="$142/mo" status="Expired" /> },
      ]}
    />
  ),
};

function PolicyCard({ type, name, premium, status }: { type: string; name: string; premium: string; status: string }) {
  return (
    <Card className="p-4 h-full">
      <CardContent className="p-0 space-y-3">
        <div className="flex justify-between items-start">
          <span className="text-xs font-bold uppercase text-[var(--dxp-text-muted)]">{type}</span>
          <Badge variant={status === 'Active' ? 'success' : 'default'}>{status}</Badge>
        </div>
        <h4 className="text-sm font-bold text-[var(--dxp-text)]">{name}</h4>
        <p className="text-lg font-bold text-[var(--dxp-brand)]">{premium}</p>
      </CardContent>
    </Card>
  );
}
