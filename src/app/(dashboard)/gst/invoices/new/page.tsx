import { InvoiceForm } from '@/components/forms/invoice-form';

export default function NewInvoicePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Create Invoice</h1>
        <p className="text-muted-foreground">
          Create a new sales invoice with tax calculations
        </p>
      </div>

      <InvoiceForm />
    </div>
  );
}
