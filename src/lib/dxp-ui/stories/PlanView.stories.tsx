import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { PlanView } from '../composed/PlanView';

const meta: Meta<typeof PlanView> = { title: 'Composed/PlanView', component: PlanView };
export default meta;
type Story = StoryObj<typeof PlanView>;

export const Default: Story = {
  render: () => (
    <div style={{ maxWidth: 600 }}>
      <PlanView
        title="Policy Renewal Checklist"
        description="Complete all tasks before Aug 15 renewal date"
        tasks={[
          { id: '1', title: 'Review current coverage', status: 'done', assignee: 'Sarah', subtasks: [{ title: 'Check deductibles', done: true }, { title: 'Review limits', done: true }] },
          { id: '2', title: 'Update vehicle information', status: 'done', assignee: 'Sarah' },
          { id: '3', title: 'Upload new photos', status: 'in-progress', assignee: 'You', subtasks: [{ title: 'Front view', done: true }, { title: 'Rear view', done: false }, { title: 'Interior', done: false }] },
          { id: '4', title: 'Choose new premium tier', status: 'todo' },
          { id: '5', title: 'Sign renewal agreement', status: 'todo', dueDate: 'Aug 10' },
        ]}
      />
    </div>
  ),
};
