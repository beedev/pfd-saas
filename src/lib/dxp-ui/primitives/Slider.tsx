import React, { useState, useMemo } from 'react';
import { cn } from '../utils/cn';
import { Card } from './Card';

export interface SliderProps {
  min: number;
  max: number;
  step?: number;
  value?: number;
  defaultValue?: number;
  onChange?: (value: number) => void;
  label?: string;
  unit?: string;
  formatValue?: (value: number) => string;
  showTicks?: boolean;
  tickCount?: number;
  color?: string;
  centerZero?: boolean;
  variant?: 'default' | 'card';
  disabled?: boolean;
}

export function Slider({
  min, max, step = 1, value: controlledValue, defaultValue, onChange,
  label, unit, formatValue, showTicks = true, tickCount = 20,
  color, centerZero = false, variant = 'card', disabled,
}: SliderProps) {
  const [internalValue, setInternalValue] = useState(defaultValue ?? (centerZero ? 0 : min));
  const value = controlledValue ?? internalValue;
  const percent = ((value - min) / (max - min)) * 100;
  const displayValue = formatValue ? formatValue(value) : `${value >= 0 && centerZero ? '+' : ''}${value}`;
  const fillColor = color || 'var(--dxp-brand)';

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setInternalValue(v);
    onChange?.(v);
  };

  const centerPercent = centerZero ? ((0 - min) / (max - min)) * 100 : 0;

  // Build the gradient for the track
  const trackGradient = useMemo(() => {
    if (centerZero) {
      const left = Math.min(centerPercent, percent);
      const right = Math.max(centerPercent, percent);
      return `linear-gradient(to right,
        #e5e7eb 0%, #e5e7eb ${left}%,
        ${fillColor} ${left}%, ${fillColor} ${right}%,
        #e5e7eb ${right}%, #e5e7eb 100%)`;
    }
    return `linear-gradient(to right, ${fillColor} 0%, ${fillColor} ${percent}%, #e5e7eb ${percent}%, #e5e7eb 100%)`;
  }, [percent, centerPercent, centerZero, fillColor]);

  const ticks = useMemo(() => {
    if (!showTicks) return [];
    return Array.from({ length: tickCount + 1 }, (_, i) => i / tickCount * 100);
  }, [showTicks, tickCount]);

  const content = (
    <div className={cn(disabled && 'opacity-50 pointer-events-none')}>
      {/* Label row */}
      <div className="flex items-center justify-between mb-4">
        {label && <span className="text-base font-bold text-[var(--dxp-text)]">{label}</span>}
        <span className="text-base font-bold tabular-nums" style={{ color: fillColor }}>
          {displayValue}{unit ? ` ${unit}` : ''}
        </span>
      </div>

      {/* Track container */}
      <div className="relative">
        {/* Visual track */}
        <div
          className="h-4 rounded-full relative"
          style={{ background: trackGradient }}
        >
          {/* Center marker for center-zero */}
          {centerZero && (
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-[var(--dxp-text-secondary)] z-10"
              style={{ left: `${centerPercent}%` }}
            />
          )}
        </div>

        {/* Invisible range input overlaid */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={handleChange}
          disabled={disabled}
          className="absolute inset-0 w-full h-4 appearance-none cursor-pointer bg-transparent z-20
            [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-7
            [&::-webkit-slider-thumb]:rounded-sm [&::-webkit-slider-thumb]:cursor-pointer
            [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-gray-300
            [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-7 [&::-moz-range-thumb]:rounded-sm
            [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:shadow-md
            [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-gray-300
            [&::-moz-range-thumb]:cursor-pointer"
        />
      </div>

      {/* Tick marks */}
      {showTicks && (
        <div className="relative h-4 mt-1">
          {ticks.map((pos, i) => {
            const isMajor = i % 5 === 0;
            return (
              <div
                key={i}
                className={cn(
                  'absolute top-0',
                  isMajor ? 'w-px h-3 bg-gray-400' : 'w-px h-2 bg-gray-300',
                )}
                style={{ left: `${pos}%`, transform: 'translateX(-50%)' }}
              />
            );
          })}
        </div>
      )}
    </div>
  );

  if (variant === 'card') {
    return <Card className="px-5 py-4">{content}</Card>;
  }
  return content;
}
