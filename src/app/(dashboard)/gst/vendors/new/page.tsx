import { VendorForm } from '@/components/forms/vendor-form';

export default function NewVendorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add Vendor</h1>
        <p className="text-muted-foreground">
          Create a new vendor for purchase invoices and ITC claims
        </p>
      </div>

      <VendorForm />
    </div>
  );
}
