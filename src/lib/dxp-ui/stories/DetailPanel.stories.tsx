import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { DetailPanel } from '../composed/DetailPanel';
import { Button } from '../primitives/Button';
import { StatusBadge } from '../composed/StatusBadge';

const meta: Meta<typeof DetailPanel> = {
  title: 'Composed/DetailPanel',
  component: DetailPanel,
};
export default meta;
type Story = StoryObj<typeof DetailPanel>;

// Open panel, read content, close it
export const OpenAndClose: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    return (
      <>
        <Button onClick={() => setOpen(true)}>Open Detail Panel</Button>
        <DetailPanel
          open={open}
          onClose={() => setOpen(false)}
          title="Policy POL-001"
          footer={
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <Button variant="secondary">Download Declaration</Button>
              <Button>Request Change</Button>
            </div>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--dxp-text-muted)' }}>Status</p>
              <StatusBadge status="Active" />
            </div>
            <div>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--dxp-text-muted)' }}>Description</p>
              <p style={{ fontSize: '0.875rem' }}>2024 Tesla Model 3</p>
            </div>
            <div>
              <p style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--dxp-text-muted)' }}>Coverage</p>
              <p style={{ fontSize: '0.875rem' }}>$500,000</p>
            </div>
          </div>
        </DetailPanel>
      </>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Click the button to open the panel
    const openButton = canvas.getByText('Open Detail Panel');
    await userEvent.click(openButton);

    // Verify panel content is visible (search the whole document since panel is fixed-position)
    const body = within(document.body);
    await expect(body.getByText('Policy POL-001')).toBeInTheDocument();
    await expect(body.getByText('2024 Tesla Model 3')).toBeInTheDocument();
    await expect(body.getByText('$500,000')).toBeInTheDocument();
    await expect(body.getByText('Active')).toBeInTheDocument();

    // Verify footer actions are present
    await expect(body.getByText('Download Declaration')).toBeInTheDocument();
    await expect(body.getByText('Request Change')).toBeInTheDocument();
  },
};
