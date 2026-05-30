'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Pencil, Trash2, Loader2, Users } from 'lucide-react';
import { getStateName } from '@/constants/state-codes';

interface Customer {
  id: number;
  name: string;
  gstin: string | null;
  pan: string | null;
  stateCode: string;
  address: string | null;
  city: string | null;
  pincode: string | null;
  email: string | null;
  phone: string | null;
  isB2B: boolean;
  createdAt: string;
}

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadCustomers = async () => {
    try {
      const response = await fetch('/api/gst/customers');
      const data = await response.json();
      setCustomers(data.customers || []);
    } catch (error) {
      console.error('Failed to load customers:', error);
      toast.error('Failed to load customers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const handleDelete = async () => {
    if (!customerToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/gst/customers/${customerToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete customer');
      }

      toast.success('Customer deleted', {
        description: `${customerToDelete.name} has been deleted.`,
      });

      setCustomers(customers.filter((c) => c.id !== customerToDelete.id));
    } catch (error) {
      toast.error('Failed to delete', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setCustomerToDelete(null);
    }
  };

  const confirmDelete = (customer: Customer) => {
    setCustomerToDelete(customer);
    setDeleteDialogOpen(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Customers</h1>
          <p className="text-muted-foreground">
            Manage your customer master data
          </p>
        </div>
        <Button asChild>
          <Link href="/gst/customers/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Customer
          </Link>
        </Button>
      </div>

      {customers.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Users className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No customers yet</h3>
            <p className="text-muted-foreground mb-4">
              Add your first customer to start creating invoices
            </p>
            <Button asChild>
              <Link href="/gst/customers/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Customer
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Customer List</CardTitle>
            <CardDescription>
              {customers.length} customer{customers.length !== 1 ? 's' : ''} registered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customers.map((customer) => (
                  <TableRow key={customer.id}>
                    <TableCell className="font-medium">{customer.name}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {customer.gstin || '-'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={customer.isB2B ? 'default' : 'secondary'}>
                        {customer.isB2B ? 'B2B' : 'B2C'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {customer.stateCode} - {getStateName(customer.stateCode)}
                    </TableCell>
                    <TableCell>{customer.city || '-'}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {customer.email && <div>{customer.email}</div>}
                        {customer.phone && <div>{customer.phone}</div>}
                        {!customer.email && !customer.phone && '-'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/customers/${customer.id}/edit`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => confirmDelete(customer)}
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Customer</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{customerToDelete?.name}&quot;?
              This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={isDeleting}
            >
              {isDeleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
