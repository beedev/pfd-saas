'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { VendorForm } from '@/components/forms/vendor-form';
import { Loader2 } from 'lucide-react';

interface Vendor {
  id: number;
  name: string;
  gstin: string;
  pan: string | null;
  stateCode: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  email: string | null;
  phone: string | null;
}

export default function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [vendor, setVendor] = useState<Vendor | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadVendor() {
      try {
        const response = await fetch(`/api/gst/vendors/${resolvedParams.id}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Vendor not found');
        }

        setVendor(data.vendor);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load vendor');
      } finally {
        setIsLoading(false);
      }
    }

    loadVendor();
  }, [resolvedParams.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !vendor) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Vendor Not Found</h1>
          <p className="text-muted-foreground">{error || 'The vendor could not be found.'}</p>
        </div>
        <button
          onClick={() => router.push('/gst/vendors')}
          className="text-primary hover:underline"
        >
          Back to Vendors
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit Vendor</h1>
        <p className="text-muted-foreground">Update vendor information</p>
      </div>

      <VendorForm
        vendorId={vendor.id}
        initialData={{
          name: vendor.name,
          gstin: vendor.gstin,
          pan: vendor.pan || '',
          stateCode: vendor.stateCode,
          address: vendor.address || '',
          city: vendor.city || '',
          pincode: vendor.pincode || '',
          email: vendor.email || '',
          phone: vendor.phone || '',
        }}
      />
    </div>
  );
}
