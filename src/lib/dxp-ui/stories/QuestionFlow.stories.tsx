import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { QuestionFlow } from '../composed/QuestionFlow';

const meta: Meta<typeof QuestionFlow> = { title: 'Composed/QuestionFlow', component: QuestionFlow };
export default meta;
type Story = StoryObj<typeof QuestionFlow>;

const questions = [
  {
    id: 'type',
    title: 'What type of insurance do you need?',
    description: 'Select the coverage that fits your needs.',
    options: [
      { id: 'auto', label: 'Auto Insurance', description: 'Cars, trucks, motorcycles' },
      { id: 'home', label: 'Home Insurance', description: 'House, condo, rental' },
      { id: 'life', label: 'Life Insurance', description: 'Term, whole, universal' },
      { id: 'bundle', label: 'Bundle & Save', description: 'Combine policies for a discount' },
    ],
  },
  {
    id: 'level',
    title: 'What level of coverage?',
    options: [
      { id: 'basic', label: 'Basic', description: 'State minimum' },
      { id: 'standard', label: 'Standard', description: 'Balanced protection' },
      { id: 'premium', label: 'Premium', description: 'Maximum coverage' },
    ],
  },
  {
    id: 'priorities',
    title: 'What matters most?',
    description: 'Select all that apply.',
    multiSelect: true,
    options: [
      { id: 'low-premium', label: 'Lowest monthly premium' },
      { id: 'low-deductible', label: 'Low deductible' },
      { id: 'roadside', label: 'Roadside assistance' },
      { id: 'rental', label: 'Rental car coverage' },
    ],
  },
];

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <QuestionFlow
        questions={questions}
        onComplete={(answers) => alert(JSON.stringify(answers, null, 2))}
        submitLabel="Get My Quote"
      />
    </div>
  ),
};
