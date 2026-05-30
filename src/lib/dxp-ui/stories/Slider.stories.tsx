import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Slider } from '../primitives/Slider';

const meta: Meta<typeof Slider> = { title: 'Primitives/Slider', component: Slider };
export default meta;
type Story = StoryObj<typeof Slider>;

export const Default: Story = {
  render: () => <div style={{ maxWidth: 500 }}><Slider min={0} max={100} defaultValue={50} label="Coverage Amount" unit="%" /></div>,
};

export const Currency: Story = {
  render: () => <div style={{ maxWidth: 500 }}><Slider min={100} max={5000} step={100} defaultValue={1000} label="Deductible" formatValue={(v) => `$${v.toLocaleString()}`} /></div>,
};

export const CenterZero: Story = {
  render: () => (
    <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Slider min={-12} max={12} defaultValue={3} label="Bass" unit="dB" centerZero variant="card" color="#6366f1" />
      <Slider min={-12} max={12} defaultValue={-2} label="Mid" unit="dB" centerZero variant="card" color="#d946ef" />
      <Slider min={-12} max={12} defaultValue={5} label="Treble" unit="dB" centerZero variant="card" color="#f59e0b" />
    </div>
  ),
};

export const CardVariant: Story = {
  render: () => (
    <div style={{ maxWidth: 500, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <Slider min={0} max={500000} step={10000} defaultValue={250000} label="Coverage Limit" variant="card" formatValue={(v) => `$${(v/1000).toFixed(0)}K`} />
      <Slider min={0} max={100} defaultValue={75} label="Confidence Score" unit="%" variant="card" color="#059669" />
    </div>
  ),
};

export const NoTicks: Story = {
  render: () => <div style={{ maxWidth: 500 }}><Slider min={0} max={10} defaultValue={7} label="Rating" showTicks={false} /></div>,
};
