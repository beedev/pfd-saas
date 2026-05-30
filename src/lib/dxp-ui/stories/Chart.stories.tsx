import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Chart } from '../composed/Chart';

const meta: Meta<typeof Chart> = { title: 'Composed/Chart', component: Chart };
export default meta;
type Story = StoryObj<typeof Chart>;

const data = [
  { month: 'Jan', sales: 4000, returns: 400 },
  { month: 'Feb', sales: 3000, returns: 300 },
  { month: 'Mar', sales: 5000, returns: 500 },
  { month: 'Apr', sales: 4500, returns: 200 },
  { month: 'May', sales: 6000, returns: 350 },
  { month: 'Jun', sales: 5500, returns: 400 },
];

export const BarChart: Story = {
  render: () => <Chart type="bar" data={data} xKey="month" yKeys={['sales', 'returns']} title="Monthly Sales" description="Sales vs returns — H1 2026" />,
};

export const LineChart: Story = {
  render: () => <Chart type="line" data={data} xKey="month" yKeys={['sales']} title="Revenue Trend" height={250} />,
};

export const MultiLine: Story = {
  render: () => <Chart type="line" data={data} xKey="month" yKeys={['sales', 'returns']} title="Sales vs Returns" />,
};
