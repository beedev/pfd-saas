import React from 'react';
import { Input } from '../primitives/Input';
import { Select } from '../primitives/Select';
import { Slider } from '../primitives/Slider';
import { Badge } from '../primitives/Badge';

export interface FieldSchema {
  type: 'text' | 'textarea' | 'select' | 'checkbox' | 'radio' | 'date' | 'slider' | 'upload' | 'section';
  key: string;
  label: string;
  placeholder?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  multiline?: boolean;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  accept?: string;
  multiple?: boolean;
  description?: string;
  showWhen?: { field: string; equals: string | string[] };
}

interface FormFieldProps {
  field: FieldSchema;
  value: unknown;
  onChange: (key: string, value: unknown) => void;
  error?: string;
}

export function FormField({ field, value, onChange, error }: FormFieldProps) {
  const id = `field-${field.key}`;

  const wrapper = (children: React.ReactNode) => (
    <div>
      {field.type !== 'section' && (
        <div className="flex items-center gap-1.5 mb-1.5">
          <label htmlFor={id} className="text-sm font-medium text-[var(--dxp-text)]">{field.label}</label>
          {field.required && <span className="text-[var(--dxp-danger)] text-xs">*</span>}
        </div>
      )}
      {field.description && <p className="text-xs text-[var(--dxp-text-muted)] mb-2">{field.description}</p>}
      {children}
      {error && <p className="text-xs text-[var(--dxp-danger)] mt-1">{error}</p>}
    </div>
  );

  switch (field.type) {
    case 'text':
    case 'date':
      return wrapper(
        <Input
          id={id}
          type={field.type === 'date' ? 'date' : 'text'}
          placeholder={field.placeholder}
          value={(value as string) || ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          error={!!error}
        />
      );

    case 'textarea':
      return wrapper(
        <textarea
          id={id}
          placeholder={field.placeholder}
          value={(value as string) || ''}
          onChange={(e) => onChange(field.key, e.target.value)}
          maxLength={field.maxLength}
          rows={4}
          className={`w-full rounded-[var(--dxp-radius)] border bg-[var(--dxp-surface)] px-3 py-2 text-sm text-[var(--dxp-text)] placeholder:text-[var(--dxp-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--dxp-brand)] ${error ? 'border-[var(--dxp-danger)]' : 'border-[var(--dxp-border)]'}`}
        />
      );

    case 'select':
      return wrapper(
        <Select
          options={field.options || []}
          value={(value as string) || ''}
          onChange={(v) => onChange(field.key, v)}
          placeholder={field.placeholder || `Select ${field.label}...`}
          error={!!error}
        />
      );

    case 'checkbox':
      return wrapper(
        <div className="space-y-2">
          {(field.options || []).map((opt) => {
            const checked = Array.isArray(value) ? value.includes(opt.value) : false;
            return (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded flex items-center justify-center border-2 transition-colors ${checked ? 'bg-[var(--dxp-brand)] border-[var(--dxp-brand)]' : 'border-[var(--dxp-border)] group-hover:border-[var(--dxp-text-muted)]'}`}>
                  {checked && <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none"><path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>}
                </div>
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => {
                  const arr = Array.isArray(value) ? [...value] : [];
                  onChange(field.key, checked ? arr.filter((v) => v !== opt.value) : [...arr, opt.value]);
                }} />
                <span className="text-sm text-[var(--dxp-text)]">{opt.label}</span>
              </label>
            );
          })}
        </div>
      );

    case 'radio':
      return wrapper(
        <div className="space-y-2">
          {(field.options || []).map((opt) => {
            const checked = value === opt.value;
            return (
              <label key={opt.value} className="flex items-center gap-3 cursor-pointer group">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center border-2 transition-colors ${checked ? 'border-[var(--dxp-brand)]' : 'border-[var(--dxp-border)] group-hover:border-[var(--dxp-text-muted)]'}`}>
                  {checked && <div className="w-2.5 h-2.5 rounded-full bg-[var(--dxp-brand)]" />}
                </div>
                <input type="radio" className="sr-only" name={field.key} checked={checked} onChange={() => onChange(field.key, opt.value)} />
                <span className="text-sm text-[var(--dxp-text)]">{opt.label}</span>
              </label>
            );
          })}
        </div>
      );

    case 'slider':
      return (
        <Slider
          min={field.min ?? 0}
          max={field.max ?? 100}
          step={field.step ?? 1}
          value={(value as number) || field.min || 0}
          onChange={(v) => onChange(field.key, v)}
          label={field.label}
          unit={field.unit}
          variant="default"
        />
      );

    case 'upload':
      return wrapper(
        <div className="border-2 border-dashed border-[var(--dxp-border)] rounded-[var(--dxp-radius)] p-6 text-center hover:border-[var(--dxp-brand)] transition-colors cursor-pointer">
          <input type="file" className="sr-only" id={id} accept={field.accept} multiple={field.multiple} onChange={(e) => onChange(field.key, e.target.files)} />
          <label htmlFor={id} className="cursor-pointer">
            <svg className="w-8 h-8 mx-auto text-[var(--dxp-text-muted)] mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
            <p className="text-sm text-[var(--dxp-text-secondary)]">Click to upload or drag files here</p>
            {field.accept && <p className="text-xs text-[var(--dxp-text-muted)] mt-1">{field.accept}</p>}
          </label>
        </div>
      );

    case 'section':
      return (
        <div className="pt-4 pb-2 border-b border-[var(--dxp-border-light)]">
          <h3 className="text-base font-bold text-[var(--dxp-text)]">{field.label}</h3>
          {field.description && <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{field.description}</p>}
        </div>
      );

    default:
      return null;
  }
}
