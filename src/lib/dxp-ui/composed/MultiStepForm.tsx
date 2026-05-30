import React, { useState } from 'react';
import { Card, CardContent, CardFooter, CardHeader } from '../primitives/Card';
import { Button } from '../primitives/Button';

export interface FormStep {
  title: string;
  description?: string;
  content: React.ReactNode;
  validate?: () => boolean;
}

export interface MultiStepFormProps {
  steps: FormStep[];
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export function MultiStepForm({ steps, onSubmit, onCancel, submitLabel = 'Submit' }: MultiStepFormProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const goNext = () => {
    const step = steps[currentStep];
    if (step.validate && !step.validate()) return;
    if (currentStep < steps.length - 1) setCurrentStep(currentStep + 1);
  };

  const goPrev = () => { if (currentStep > 0) setCurrentStep(currentStep - 1); };

  const handleSubmit = () => {
    const step = steps[currentStep];
    if (step.validate && !step.validate()) return;
    onSubmit();
  };

  const isLast = currentStep === steps.length - 1;

  return (
    <Card>
      <CardHeader>
        <nav className="flex items-center gap-2">
          {steps.map((step, i) => (
            <React.Fragment key={i}>
              {i > 0 && <div className="h-px w-8 bg-[var(--dxp-border)]" />}
              <button
                onClick={() => i < currentStep && setCurrentStep(i)}
                className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium transition-colors ${
                  i === currentStep
                    ? 'bg-[var(--dxp-brand)] text-white'
                    : i < currentStep
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                      : 'bg-[var(--dxp-border-light)] text-[var(--dxp-text-muted)]'
                }`}
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full text-xs">
                  {i < currentStep ? '\u2713' : i + 1}
                </span>
                <span className="hidden sm:inline">{step.title}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>
      </CardHeader>
      <CardContent>
        <h3 className="text-lg font-semibold text-[var(--dxp-text)]">{steps[currentStep].title}</h3>
        {steps[currentStep].description && (
          <p className="mt-1 text-sm text-[var(--dxp-text-secondary)]">{steps[currentStep].description}</p>
        )}
        <div className="mt-4">{steps[currentStep].content}</div>
      </CardContent>
      <CardFooter className="flex items-center justify-between">
        <div>{onCancel && <Button variant="ghost" onClick={onCancel}>Cancel</Button>}</div>
        <div className="flex gap-3">
          {currentStep > 0 && <Button variant="secondary" onClick={goPrev}>Previous</Button>}
          {isLast
            ? <Button onClick={handleSubmit}>{submitLabel}</Button>
            : <Button onClick={goNext}>Next</Button>}
        </div>
      </CardFooter>
    </Card>
  );
}
