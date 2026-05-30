import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { DataTable, type Column } from '../composed/DataTable';
import { StatusBadge } from '../composed/StatusBadge';

const meta: Meta<typeof DataTable> = {
  title: 'Composed/DataTable',
  component: DataTable,
  argTypes: {
    loading: { control: 'boolean' },
    emptyMessage: { control: 'text' },
  },
};
export default meta;
type Story = StoryObj<typeof DataTable>;

interface Policy {
  id: string; type: string; name: string; status: string; premium: string; coverage: string;
}

const policies: Policy[] = [
  { id: 'POL-001', type: 'Auto', name: '2024 Tesla Model 3', status: 'Active', premium: '$185/mo', coverage: '$500K' },
  { id: 'POL-002', type: 'Home', name: '742 Evergreen Terrace', status: 'Active', premium: '$215/mo', coverage: '$850K' },
  { id: 'POL-003', type: 'Life', name: 'Term Life 20yr', status: 'Active', premium: '$82/mo', coverage: '$1M' },
  { id: 'POL-004', type: 'Auto', name: '2022 Honda Civic', status: 'Expired', premium: '$142/mo', coverage: '$300K' },
];

const columns: Column<Policy>[] = [
  { key: 'id', header: 'Policy #', sortable: true, width: '120px' },
  { key: 'type', header: 'Type', sortable: true, width: '80px' },
  { key: 'name', header: 'Description', sortable: true },
  { key: 'status', header: 'Status', render: (v) => <StatusBadge status={String(v)} />, width: '100px' },
  { key: 'premium', header: 'Premium', width: '100px' },
  { key: 'coverage', header: 'Coverage', width: '100px' },
];

// Sorting — click column headers, watch rows reorder
export const SortingDemo: Story = {
  render: () => <DataTable columns={columns} data={policies} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify all 4 rows render
    await expect(canvas.getByText('POL-001')).toBeInTheDocument();
    await expect(canvas.getByText('POL-004')).toBeInTheDocument();

    // Click "Policy #" header to sort ascending
    const policyHeader = canvas.getByText('Policy #');
    await userEvent.click(policyHeader);

    // Click again for descending
    await userEvent.click(policyHeader);

    // Click "Type" header to sort by type
    const typeHeader = canvas.getByText('Type');
    await userEvent.click(typeHeader);
  },
};

// Row click — click a row, alert shows
export const RowClick: Story = {
  render: () => <DataTable columns={columns} data={policies} onRowClick={(row) => alert(`Selected: ${row.id} — ${row.name}`)} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Hover over first row (visual feedback)
    const row = canvas.getByText('2024 Tesla Model 3');
    await userEvent.hover(row);
  },
};

// Pagination — navigate between pages
export const PaginationDemo: Story = {
  render: () => {
    const [page, setPage] = useState(1);
    return (
      <DataTable
        columns={columns}
        data={policies.slice((page - 1) * 2, page * 2)}
        pagination={{ page, pageSize: 2, total: 4, onChange: setPage }}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Verify page 1 content
    await expect(canvas.getByText('POL-001')).toBeInTheDocument();
    await expect(canvas.getByText('Page 1 of 2')).toBeInTheDocument();

    // Click Next
    const nextButton = canvas.getByText('Next');
    await userEvent.click(nextButton);

    // Verify page 2 content
    await expect(canvas.getByText('Page 2 of 2')).toBeInTheDocument();

    // Click Previous
    const prevButton = canvas.getByText('Previous');
    await userEvent.click(prevButton);
  },
};

export const Loading: Story = {
  render: () => <DataTable columns={columns} data={[]} loading />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('Loading...')).toBeInTheDocument();
  },
};

export const Empty: Story = {
  render: () => <DataTable columns={columns} data={[]} emptyMessage="No policies found" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('No policies found')).toBeInTheDocument();
  },
};
