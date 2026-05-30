'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { CustomerForm } from '@/components/forms/customer-form';
import { Loader2 } from 'lucide-react';

interface Customer {
  id: number;
  name: string;
  gstin: string | null;
  pan: string | null;
  stateCode: string;
  supplyType: 'REGULAR' | 'EXPORT_WITH_IGST' | 'EXPORT_LUT' | 'SEZ' | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  email: string | null;
  phone: string | null;
}

export default function EditCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const router = useRouter();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadCustomer() {
      try {
        const response = await fetch(`/api/gst/customers/${resolvedParams.id}`);
        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || 'Customer not found');
        }

        setCustomer(data.customer);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load customer');
      } finally {
        setIsLoading(false);
      }
    }

    loadCustomer();
  }, [resolvedParams.id]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customer Not Found</h1>
          <p className="text-muted-foreground">{error || 'The customer could not be found.'}</p>
        </div>
        <button
          onClick={() => router.push('/gst/customers')}
          className="text-primary hover:underline"
        >
          Back to Customers
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Edit Customer</h1>
        <p className="text-muted-foreground">Update customer information</p>
      </div>

      <CustomerForm
        customerId={customer.id}
        initialData={{
          name: customer.name,
          gstin: customer.gstin || '',
          pan: customer.pan || '',
          stateCode: customer.stateCode,
          supplyType: customer.supplyType || 'REGULAR',
          address: customer.address || '',
          city: customer.city || '',
          pincode: customer.pincode || '',
          email: customer.email || '',
          phone: customer.phone || '',
        }}
      />
    </div>
  );
}
