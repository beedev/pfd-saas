import React from 'react';
import { Card, CardHeader, CardContent } from '../primitives/Card';

export interface PreferenceItem {
  id: string;
  label: string;
  description?: string;
  type: 'toggle' | 'select';
  value: boolean | string;
  options?: { value: string; label: string }[];
}

export interface PreferenceGroup {
  title: string;
  items: PreferenceItem[];
}

export interface PreferencesPanelProps {
  groups: PreferenceGroup[];
  onChange: (id: string, value: boolean | string) => void;
}

export function PreferencesPanel({ groups, onChange }: PreferencesPanelProps) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <h3 className="text-sm font-bold text-[var(--dxp-text)]">{group.title}</h3>
          </CardHeader>
          <CardContent className="space-y-0">
            {group.items.map((item, i) => (
              <div key={item.id} className={`flex items-center justify-between py-4 ${i > 0 ? 'border-t border-[var(--dxp-border-light)]' : ''}`}>
                <div>
                  <span className="text-sm font-medium text-[var(--dxp-text)]">{item.label}</span>
                  {item.description && <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{item.description}</p>}
                </div>
                {item.type === 'toggle' && (
                  <button
                    onClick={() => onChange(item.id, !item.value)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${item.value ? 'bg-[var(--dxp-brand)]' : 'bg-[var(--dxp-border)]'}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${item.value ? 'translate-x-5' : ''}`} />
                  </button>
                )}
                {item.type === 'select' && item.options && (
                  <select
                    value={item.value as string}
                    onChange={(e) => onChange(item.id, e.target.value)}
                    className="rounded-[var(--dxp-radius)] border border-[var(--dxp-border)] bg-[var(--dxp-surface)] px-2 py-1 text-sm"
                  >
                    {item.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
