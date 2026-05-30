import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../primitives/Card';
import { Button } from '../primitives/Button';
import { Input } from '../primitives/Input';
import { Select } from '../primitives/Select';
import { Badge } from '../primitives/Badge';
import { Tabs } from '../primitives/Tabs';
import { FormField, type FieldSchema } from './FormField';
import type { FormSchema } from './DynamicForm';

interface FieldTemplate {
  type: FieldSchema['type'];
  label: string;
  icon: string;
}

const fieldTemplates: FieldTemplate[] = [
  { type: 'text', label: 'Text Input', icon: 'Aa' },
  { type: 'textarea', label: 'Text Area', icon: '\u00b6' },
  { type: 'select', label: 'Dropdown', icon: '\u25bc' },
  { type: 'checkbox', label: 'Checkboxes', icon: '\u2611' },
  { type: 'radio', label: 'Radio Group', icon: '\u25c9' },
  { type: 'date', label: 'Date Picker', icon: '\u2630' },
  { type: 'slider', label: 'Slider', icon: '\u2194' },
  { type: 'upload', label: 'File Upload', icon: '\u2191' },
  { type: 'section', label: 'Section', icon: '\u2014' },
];

export interface FormDesignerProps {
  initialSchema?: FormSchema;
  onSave: (schema: FormSchema) => void;
}

export function FormDesigner({ initialSchema, onSave }: FormDesignerProps) {
  const [title, setTitle] = useState(initialSchema?.title || 'Untitled Form');
  const [fields, setFields] = useState<FieldSchema[]>(initialSchema?.fields || []);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState('design');
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});

  const addField = useCallback((type: FieldSchema['type']) => {
    const key = `field_${Date.now()}`;
    const label = fieldTemplates.find((t) => t.type === type)?.label || type;
    const newField: FieldSchema = {
      type,
      key,
      label,
      ...(type === 'select' || type === 'checkbox' || type === 'radio'
        ? { options: [{ value: 'opt1', label: 'Option 1' }, { value: 'opt2', label: 'Option 2' }] }
        : {}),
      ...(type === 'slider' ? { min: 0, max: 100, step: 1 } : {}),
    };
    setFields([...fields, newField]);
    setSelectedIdx(fields.length);
  }, [fields]);

  const updateField = (idx: number, updates: Partial<FieldSchema>) => {
    setFields(fields.map((f, i) => i === idx ? { ...f, ...updates } : f));
  };

  const removeField = (idx: number) => {
    setFields(fields.filter((_, i) => i !== idx));
    setSelectedIdx(null);
  };

  const moveField = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= fields.length) return;
    const updated = [...fields];
    [updated[idx], updated[target]] = [updated[target], updated[idx]];
    setFields(updated);
    setSelectedIdx(target);
  };

  const schema: FormSchema = { title, fields, submitLabel: 'Submit' };
  const selectedField = selectedIdx !== null ? fields[selectedIdx] : null;

  const tabs = [
    { key: 'design', label: 'Design' },
    { key: 'preview', label: 'Preview' },
    { key: 'json', label: 'JSON' },
  ];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-bold border-none shadow-none p-0 focus:ring-0 bg-transparent"
            placeholder="Form Title"
          />
          <Button onClick={() => onSave(schema)}>Save Form</Button>
        </div>
      </Card>

      <Tabs tabs={tabs} active={activeTab} onChange={setActiveTab} variant="underline" />

      {/* Design Tab */}
      {activeTab === 'design' && (
        <div className="grid grid-cols-12 gap-4">
          {/* Field Palette */}
          <div className="col-span-2">
            <Card>
              <CardHeader><span className="text-xs font-bold uppercase text-[var(--dxp-text-muted)]">Fields</span></CardHeader>
              <CardContent className="p-2 space-y-1">
                {fieldTemplates.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => addField(t.type)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded-[var(--dxp-radius)] hover:bg-[var(--dxp-brand-light)] hover:text-[var(--dxp-brand)] transition-colors text-[var(--dxp-text-secondary)]"
                  >
                    <span className="w-5 text-center font-mono text-xs">{t.icon}</span>
                    <span>{t.label}</span>
                  </button>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Canvas */}
          <div className="col-span-6">
            <Card>
              <CardHeader><span className="text-xs font-bold uppercase text-[var(--dxp-text-muted)]">Canvas</span></CardHeader>
              <CardContent>
                {fields.length === 0 ? (
                  <div className="text-center py-12 text-[var(--dxp-text-muted)]">
                    <p className="text-sm font-medium">No fields yet</p>
                    <p className="text-xs mt-1">Click a field type on the left to add it</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {fields.map((field, i) => (
                      <div
                        key={field.key}
                        onClick={() => setSelectedIdx(i)}
                        className={`relative group rounded-[var(--dxp-radius)] border-2 p-4 cursor-pointer transition-colors ${
                          selectedIdx === i
                            ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)]'
                            : 'border-transparent hover:border-[var(--dxp-border)]'
                        }`}
                      >
                        {/* Field preview */}
                        <div className="pointer-events-none opacity-80">
                          <FormField field={field} value={undefined} onChange={() => {}} />
                        </div>

                        {/* Actions overlay */}
                        <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={(e) => { e.stopPropagation(); moveField(i, -1); }} className="w-6 h-6 rounded bg-[var(--dxp-surface)] border border-[var(--dxp-border)] text-xs hover:bg-[var(--dxp-border-light)]">{'\u2191'}</button>
                          <button onClick={(e) => { e.stopPropagation(); moveField(i, 1); }} className="w-6 h-6 rounded bg-[var(--dxp-surface)] border border-[var(--dxp-border)] text-xs hover:bg-[var(--dxp-border-light)]">{'\u2193'}</button>
                          <button onClick={(e) => { e.stopPropagation(); removeField(i); }} className="w-6 h-6 rounded bg-[var(--dxp-surface)] border border-[var(--dxp-danger)]/30 text-xs text-[var(--dxp-danger)] hover:bg-red-50">{'\u00d7'}</button>
                        </div>

                        {/* Type badge */}
                        <Badge variant="default" className="absolute top-2 left-2 text-[9px]">{field.type}</Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Property Panel */}
          <div className="col-span-4">
            <Card>
              <CardHeader><span className="text-xs font-bold uppercase text-[var(--dxp-text-muted)]">Properties</span></CardHeader>
              <CardContent>
                {!selectedField ? (
                  <p className="text-sm text-[var(--dxp-text-muted)] text-center py-8">Select a field to edit its properties</p>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Label</label>
                      <Input value={selectedField.label} onChange={(e) => updateField(selectedIdx!, { label: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Field Key</label>
                      <Input value={selectedField.key} onChange={(e) => updateField(selectedIdx!, { key: e.target.value })} className="font-mono text-xs" />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Placeholder</label>
                      <Input value={selectedField.placeholder || ''} onChange={(e) => updateField(selectedIdx!, { placeholder: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Description</label>
                      <Input value={selectedField.description || ''} onChange={(e) => updateField(selectedIdx!, { description: e.target.value })} />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={selectedField.required || false} onChange={(e) => updateField(selectedIdx!, { required: e.target.checked })} className="rounded border-[var(--dxp-border)]" />
                      <span className="text-sm text-[var(--dxp-text)]">Required</span>
                    </label>

                    {/* Options editor for select/checkbox/radio */}
                    {(selectedField.type === 'select' || selectedField.type === 'checkbox' || selectedField.type === 'radio') && (
                      <div>
                        <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Options</label>
                        <div className="space-y-2 mt-1">
                          {(selectedField.options || []).map((opt, oi) => (
                            <div key={oi} className="flex gap-2">
                              <Input
                                value={opt.label}
                                onChange={(e) => {
                                  const opts = [...(selectedField.options || [])];
                                  opts[oi] = { ...opts[oi], label: e.target.value, value: e.target.value.toLowerCase().replace(/\s+/g, '-') };
                                  updateField(selectedIdx!, { options: opts });
                                }}
                                placeholder="Option label"
                                className="flex-1"
                              />
                              <button
                                onClick={() => updateField(selectedIdx!, { options: selectedField.options?.filter((_, j) => j !== oi) })}
                                className="text-[var(--dxp-danger)] text-xs px-2"
                              >{'\u00d7'}</button>
                            </div>
                          ))}
                          <Button variant="ghost" size="sm" onClick={() => {
                            const opts = [...(selectedField.options || []), { value: `opt${Date.now()}`, label: 'New Option' }];
                            updateField(selectedIdx!, { options: opts });
                          }}>+ Add Option</Button>
                        </div>
                      </div>
                    )}

                    {/* Slider properties */}
                    {selectedField.type === 'slider' && (
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Min</label>
                          <Input type="number" value={selectedField.min ?? 0} onChange={(e) => updateField(selectedIdx!, { min: Number(e.target.value) })} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Max</label>
                          <Input type="number" value={selectedField.max ?? 100} onChange={(e) => updateField(selectedIdx!, { max: Number(e.target.value) })} />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Step</label>
                          <Input type="number" value={selectedField.step ?? 1} onChange={(e) => updateField(selectedIdx!, { step: Number(e.target.value) })} />
                        </div>
                        <div className="col-span-3">
                          <label className="text-xs font-medium text-[var(--dxp-text-secondary)]">Unit</label>
                          <Input value={selectedField.unit || ''} onChange={(e) => updateField(selectedIdx!, { unit: e.target.value })} placeholder="e.g. $, %, dB" />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Preview Tab */}
      {activeTab === 'preview' && (
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <h2 className="text-lg font-bold text-[var(--dxp-text)]">{title}</h2>
            </CardHeader>
            <CardContent className="space-y-5">
              {fields.map((field) => (
                <FormField
                  key={field.key}
                  field={field}
                  value={previewValues[field.key]}
                  onChange={(k, v) => setPreviewValues({ ...previewValues, [k]: v })}
                />
              ))}
            </CardContent>
            <CardFooter>
              <Button onClick={() => alert(JSON.stringify(previewValues, null, 2))}>Submit (Preview)</Button>
            </CardFooter>
          </Card>
        </div>
      )}

      {/* JSON Tab */}
      {activeTab === 'json' && (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase text-[var(--dxp-text-muted)]">JSON Schema</span>
            <Button variant="ghost" size="sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(schema, null, 2))}>Copy</Button>
          </CardHeader>
          <CardContent>
            <pre className="rounded-[var(--dxp-radius)] bg-gray-900 text-green-400 p-4 font-mono text-xs overflow-auto max-h-96 whitespace-pre">
              {JSON.stringify(schema, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
