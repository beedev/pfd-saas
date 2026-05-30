import React from 'react';

export interface Step {
  label: string;
  description?: string;
}

export interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

export function StepIndicator({ steps, currentStep }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-4 py-4">
      {steps.map((step, i) => (
        <React.Fragment key={i}>
          {i > 0 && (
            <div className={`w-16 h-1 rounded-full ${i <= currentStep ? 'bg-[var(--dxp-brand)] opacity-30' : 'bg-[var(--dxp-border)]'}`} />
          )}
          <div className="flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                i < currentStep
                  ? 'bg-[var(--dxp-success)] text-white'
                  : i === currentStep
                    ? 'bg-[var(--dxp-brand)] text-white ring-4 ring-[var(--dxp-brand)]/10'
                    : 'bg-[var(--dxp-border)] text-[var(--dxp-text-muted)]'
              }`}
            >
              {i < currentStep ? '\u2713' : i + 1}
            </div>
            <span
              className={`text-sm font-medium hidden sm:inline ${
                i === currentStep
                  ? 'text-[var(--dxp-brand)] font-bold'
                  : i < currentStep
                    ? 'text-[var(--dxp-text-secondary)]'
                    : 'text-[var(--dxp-text-muted)]'
              }`}
            >
              {step.label}
            </span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}
