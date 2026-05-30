import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { ImageGallery } from '../composed/ImageGallery';

const meta: Meta<typeof ImageGallery> = { title: 'Composed/ImageGallery', component: ImageGallery };
export default meta;
type Story = StoryObj<typeof ImageGallery>;

const images = [
  { src: 'https://picsum.photos/seed/dxp1/400/400', alt: 'Damage photo 1', caption: 'Front bumper damage' },
  { src: 'https://picsum.photos/seed/dxp2/400/400', alt: 'Damage photo 2', caption: 'Side panel scratch' },
  { src: 'https://picsum.photos/seed/dxp3/400/400', alt: 'Damage photo 3', caption: 'Rear fender dent' },
  { src: 'https://picsum.photos/seed/dxp4/400/400', alt: 'Damage photo 4', caption: 'Windshield crack' },
  { src: 'https://picsum.photos/seed/dxp5/400/400', alt: 'Damage photo 5', caption: 'Interior overview' },
  { src: 'https://picsum.photos/seed/dxp6/400/400', alt: 'Damage photo 6', caption: 'VIN plate' },
];

export const ThreeColumns: Story = { render: () => <ImageGallery images={images} columns={3} /> };
export const FourColumns: Story = { render: () => <ImageGallery images={images} columns={4} /> };
export const TwoColumns: Story = { render: () => <ImageGallery images={images.slice(0, 4)} columns={2} /> };
