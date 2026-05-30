import React, { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FileUploadZone, type UploadedFile } from '../composed/FileUploadZone';

const meta: Meta<typeof FileUploadZone> = {
  title: 'Composed/FileUploadZone',
  component: FileUploadZone,
};
export default meta;
type Story = StoryObj<typeof FileUploadZone>;

const mockFiles: UploadedFile[] = [
  { id: '1', name: 'collision-photo.jpg', size: '2.4 MB', type: 'image' },
  { id: '2', name: 'repair-estimate.pdf', size: '340 KB', type: 'document' },
];

export const WithFiles: Story = {
  render: () => {
    const [files, setFiles] = useState(mockFiles);
    return <FileUploadZone files={files} onRemove={(id) => setFiles(files.filter((f) => f.id !== id))} />;
  },
};

export const Empty: Story = {
  render: () => <FileUploadZone files={[]} onRemove={() => {}} />,
};
