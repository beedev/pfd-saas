import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { LinkPreview } from '../composed/LinkPreview';

const meta: Meta<typeof LinkPreview> = { title: 'Composed/LinkPreview', component: LinkPreview };
export default meta;
type Story = StoryObj<typeof LinkPreview>;

export const WithImage: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <LinkPreview
        url="https://acme-insurance.com/blog/understanding-deductibles"
        title="Understanding Your Deductible: A Complete Guide"
        description="Learn how deductibles work, how to choose the right amount, and when it makes sense to file a claim vs pay out of pocket."
        image="https://picsum.photos/seed/link1/200/200"
        siteName="Acme Insurance Blog"
      />
    </div>
  ),
};
export const WithoutImage: Story = {
  render: () => (
    <div style={{ maxWidth: 500 }}>
      <LinkPreview
        url="https://naic.org/consumer-resources"
        title="Consumer Insurance Resources"
        description="Official insurance consumer guidance from the National Association of Insurance Commissioners."
      />
    </div>
  ),
};
