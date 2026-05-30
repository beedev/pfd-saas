import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus } from 'lucide-react';
import Link from 'next/link';

export default function PurchasesPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Purchases</h1>
          <p className="text-muted-foreground">
            Track purchase invoices for Input Tax Credit (ITC)
          </p>
        </div>
        <Link href="/gst/purchases/new">
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Purchase
          </Button>
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Purchase Invoice List</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground">
            No purchase invoices yet. Add purchases to track your ITC.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
