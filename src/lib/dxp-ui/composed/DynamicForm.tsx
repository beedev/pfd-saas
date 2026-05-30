import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { StepIndicator } from './StepIndicator';
import { FormField, type FieldSchema } from './FormField';

export interface FormStep {
  title: string;
  description?: string;
  fields: FieldSchema[];
}

export interface FormSchema {
  id?: string;
  title: string;
  description?: string;
  steps?: FormStep[];
  fields?: FieldSchema[];
  submitLabel?: string;
}

export interface DynamicFormProps {
  schema: FormSchema;
  onSubmit: (data: Record<string, unknown>) => void;
  onChange?: (data: Record<string, unknown>) => void;
  initialValues?: Record<string, unknown>;
  readOnly?: boolean;
}

export function DynamicForm({ schema, onSubmit, onChange, initialValues = {}, readOnly = false }: DynamicFormProps) {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [currentStep, setCurrentStep] = useState(0);

  const isMultiStep = !!schema.steps && schema.steps.length > 1;
  const steps = schema.steps || [{ title: schema.title, fields: schema.fields || [] }];
  const currentFields = steps[currentStep]?.fields || [];

  const handleChange = useCallback((key: string, value: unknown) => {
    const updated = { ...values, [key]: value };
    setValues(updated);
    setErrors((prev) => ({ ...prev, [key]: '' }));
    onChange?.(updated);
  }, [values, onChange]);

  const validateStep = (fields: FieldSchema[]): boolean => {
    const newErrors: Record<string, string> = {};
    for (const field of fields) {
      if (field.required) {
        const val = values[field.key];
        if (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0)) {
          newErrors[field.key] = `${field.label} is required`;
        }
      }
    }
    setErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0;
  };

  const isFieldVisible = (field: FieldSchema): boolean => {
    if (!field.showWhen) return true;
    const depValue = values[field.showWhen.field];
    const equals = field.showWhen.equals;
    if (Array.isArray(equals)) return equals.includes(depValue as string);
    return depValue === equals;
  };

  const handleNext = () => {
    if (!validateStep(currentFields)) return;
    if (currentStep < steps.length - 1) {
      setCurrentStep(currentStep + 1);
    } else {
      onSubmit(values);
    }
  };

  const handlePrev = () => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  };

  const isLast = currentStep === steps.length - 1;

  return (
    <Card>
      <CardHeader>
        <h2 className="text-lg font-bold text-[var(--dxp-text)]">{schema.title}</h2>
        {schema.description && <p className="text-sm text-[var(--dxp-text-secondary)] mt-1">{schema.description}</p>}
      </CardHeader>

      {isMultiStep && (
        <div className="px-5 pb-2">
          <StepIndicator
            steps={steps.map((s) => ({ label: s.title }))}
            currentStep={currentStep}
          />
        </div>
      )}

      <CardContent>
        {isMultiStep && (
          <div className="mb-4">
            <h3 className="text-base font-semibold text-[var(--dxp-text)]">{steps[currentStep].title}</h3>
            {steps[currentStep].description && (
              <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{steps[currentStep].description}</p>
            )}
          </div>
        )}
        <div className="space-y-5">
          {currentFields.filter(isFieldVisible).map((field) => (
            <FormField
              key={field.key}
              field={field}
              value={values[field.key]}
              onChange={handleChange}
              error={errors[field.key]}
            />
          ))}
        </div>
      </CardContent>

      {!readOnly && (
        <CardFooter className="flex items-center justify-between">
          <div>
            {isMultiStep && currentStep > 0 && (
              <Button variant="secondary" onClick={handlePrev}>Previous</Button>
            )}
          </div>
          <Button onClick={handleNext}>
            {isLast ? (schema.submitLabel || 'Submit') : 'Next'}
          </Button>
        </CardFooter>
      )}
    </Card>
  );
}
