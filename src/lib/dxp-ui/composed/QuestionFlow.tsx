import React, { useState, useCallback } from 'react';
import { Card, CardHeader, CardContent, CardFooter } from '../primitives/Card';
import { Button } from '../primitives/Button';

export interface QuestionOption {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode;
}

export interface Question {
  id: string;
  title: string;
  description?: string;
  options: QuestionOption[];
  multiSelect?: boolean;
}

export interface QuestionFlowProps {
  questions: Question[];
  onComplete: (answers: Record<string, string | string[]>) => void;
  onCancel?: () => void;
  submitLabel?: string;
}

export function QuestionFlow({ questions, onComplete, onCancel, submitLabel = 'Submit' }: QuestionFlowProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string | string[]>>({});
  const [focusedOption, setFocusedOption] = useState(0);

  const question = questions[currentIndex];
  const isLast = currentIndex === questions.length - 1;
  const currentAnswer = answers[question.id];

  const isSelected = (optionId: string) => {
    if (!currentAnswer) return false;
    return Array.isArray(currentAnswer) ? currentAnswer.includes(optionId) : currentAnswer === optionId;
  };

  const selectOption = useCallback((optionId: string) => {
    setAnswers((prev) => {
      if (question.multiSelect) {
        const current = (prev[question.id] as string[]) || [];
        const updated = current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId];
        return { ...prev, [question.id]: updated };
      }
      return { ...prev, [question.id]: optionId };
    });
  }, [question]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedOption((prev) => Math.min(prev + 1, question.options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedOption((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        selectOption(question.options[focusedOption].id);
        break;
    }
  };

  const goNext = () => {
    if (isLast) {
      onComplete(answers);
    } else {
      setCurrentIndex(currentIndex + 1);
      setFocusedOption(0);
    }
  };

  const goPrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setFocusedOption(0);
    }
  };

  const hasAnswer = currentAnswer && (Array.isArray(currentAnswer) ? currentAnswer.length > 0 : true);

  return (
    <Card>
      <CardHeader>
        {/* Progress dots */}
        <div className="flex items-center gap-1.5 mb-4">
          {questions.map((_, i) => (
            <div
              key={i}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                i < currentIndex ? 'bg-[var(--dxp-brand)]' : i === currentIndex ? 'bg-[var(--dxp-brand)]' : 'bg-[var(--dxp-border)]'
              }`}
            />
          ))}
        </div>
        <p className="text-xs text-[var(--dxp-text-muted)] mb-1">
          Question {currentIndex + 1} of {questions.length}
          {question.multiSelect && ' (select multiple)'}
        </p>
        <h3 className="text-lg font-bold text-[var(--dxp-text)]">{question.title}</h3>
        {question.description && (
          <p className="text-sm text-[var(--dxp-text-secondary)] mt-1">{question.description}</p>
        )}
      </CardHeader>

      <CardContent onKeyDown={handleKeyDown} tabIndex={0} className="outline-none">
        <div className="space-y-2">
          {question.options.map((option, i) => {
            const selected = isSelected(option.id);
            const focused = focusedOption === i;
            return (
              <button
                key={option.id}
                onClick={() => selectOption(option.id)}
                onMouseEnter={() => setFocusedOption(i)}
                className={`w-full text-left rounded-[var(--dxp-radius)] border-2 p-4 transition-all ${
                  selected
                    ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand-light)]'
                    : focused
                      ? 'border-[var(--dxp-border)] bg-[var(--dxp-border-light)]'
                      : 'border-[var(--dxp-border)] hover:border-[var(--dxp-text-muted)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* Radio / Checkbox indicator */}
                  <div className={`flex-shrink-0 w-5 h-5 rounded-${question.multiSelect ? '[var(--dxp-radius)]' : 'full'} border-2 flex items-center justify-center ${
                    selected ? 'border-[var(--dxp-brand)] bg-[var(--dxp-brand)]' : 'border-[var(--dxp-border)]'
                  }`}>
                    {selected && (
                      <svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
                        <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                  {option.icon && <div className="flex-shrink-0 text-[var(--dxp-text-muted)]">{option.icon}</div>}
                  <div>
                    <span className="text-sm font-medium text-[var(--dxp-text)]">{option.label}</span>
                    {option.description && (
                      <p className="text-xs text-[var(--dxp-text-muted)] mt-0.5">{option.description}</p>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>

      <CardFooter className="flex items-center justify-between">
        <div>
          {currentIndex === 0 && onCancel ? (
            <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          ) : (
            <Button variant="secondary" onClick={goPrev} disabled={currentIndex === 0}>Previous</Button>
          )}
        </div>
        <Button onClick={goNext} disabled={!hasAnswer}>
          {isLast ? submitLabel : 'Next'}
        </Button>
      </CardFooter>
    </Card>
  );
}
