import { CustomerForm } from '@/components/forms/customer-form';

export default function NewCustomerPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Add Customer</h1>
        <p className="text-muted-foreground">
          Create a new customer for invoicing
        </p>
      </div>

      <CustomerForm />
    </div>
  );
}
