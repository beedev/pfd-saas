import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { within, userEvent, expect } from '@storybook/test';
import { StepIndicator } from '../composed/StepIndicator';
import { Button } from '../primitives/Button';

const meta: Meta<typeof StepIndicator> = {
  title: 'Composed/StepIndicator',
  component: StepIndicator,
};
export default meta;
type Story = StoryObj<typeof StepIndicator>;

const steps = [
  { label: 'Incident Details' },
  { label: 'Supporting Documents' },
  { label: 'Review & Submit' },
];

// Walk through all steps
export const WalkThrough: Story = {
  render: () => {
    const [step, setStep] = useState(0);
    return (
      <div>
        <StepIndicator steps={steps} currentStep={step} />
        <div style={{ marginTop: '2rem', display: 'flex', gap: '0.75rem', justifyContent: 'center' }}>
          <Button variant="secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
            Previous
          </Button>
          <Button onClick={() => setStep(Math.min(steps.length, step + 1))} disabled={step > steps.length - 1}>
            {step >= steps.length - 1 ? 'Complete' : 'Next'}
          </Button>
        </div>
        <p style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem', color: 'var(--dxp-text-secondary)' }}>
          Step {step + 1} of {steps.length}: {steps[Math.min(step, steps.length - 1)]?.label}
        </p>
      </div>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Start at step 1
    await expect(canvas.getByText(/Step 1 of 3/)).toBeInTheDocument();

    // Click Next to step 2
    await userEvent.click(canvas.getByText('Next'));
    await expect(canvas.getByText(/Step 2 of 3/)).toBeInTheDocument();

    // Click Next to step 3
    await userEvent.click(canvas.getByText('Next'));
    await expect(canvas.getByText(/Step 3 of 3/)).toBeInTheDocument();

    // Click Previous back to step 2
    await userEvent.click(canvas.getByText('Previous'));
    await expect(canvas.getByText(/Step 2 of 3/)).toBeInTheDocument();
  },
};

export const AtStep1: Story = { args: { steps, currentStep: 0 } };
export const AtStep2: Story = { args: { steps, currentStep: 1 } };
export const AllComplete: Story = { args: { steps, currentStep: 3 } };
