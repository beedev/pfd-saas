'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Plus, Pencil, Trash2, Loader2, Building2 } from 'lucide-react';
import { getStateName } from '@/constants/state-codes';

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
  createdAt: string;
}

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [vendorToDelete, setVendorToDelete] = useState<Vendor | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadVendors = async () => {
    try {
      const response = await fetch('/api/gst/vendors');
      const data = await response.json();
      setVendors(data.vendors || []);
    } catch (error) {
      console.error('Failed to load vendors:', error);
      toast.error('Failed to load vendors');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadVendors();
  }, []);

  const handleDelete = async () => {
    if (!vendorToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/gst/vendors/${vendorToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete vendor');
      }

      toast.success('Vendor deleted', {
        description: `${vendorToDelete.name} has been deleted.`,
      });

      setVendors(vendors.filter((v) => v.id !== vendorToDelete.id));
    } catch (error) {
      toast.error('Failed to delete', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setVendorToDelete(null);
    }
  };

  const confirmDelete = (vendor: Vendor) => {
    setVendorToDelete(vendor);
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
          <h1 className="text-3xl font-bold tracking-tight">Vendors</h1>
          <p className="text-muted-foreground">
            Manage vendors for purchase tracking and ITC claims
          </p>
        </div>
        <Button asChild>
          <Link href="/gst/vendors/new">
            <Plus className="mr-2 h-4 w-4" />
            Add Vendor
          </Link>
        </Button>
      </div>

      {vendors.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No vendors yet</h3>
            <p className="text-muted-foreground mb-4">
              Add your first vendor to track purchases and claim ITC
            </p>
            <Button asChild>
              <Link href="/gst/vendors/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Vendor
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Vendor List</CardTitle>
            <CardDescription>
              {vendors.length} vendor{vendors.length !== 1 ? 's' : ''} registered
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>GSTIN</TableHead>
                  <TableHead>PAN</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>City</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map((vendor) => (
                  <TableRow key={vendor.id}>
                    <TableCell className="font-medium">{vendor.name}</TableCell>
                    <TableCell className="font-mono text-sm">{vendor.gstin}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {vendor.pan || '-'}
                    </TableCell>
                    <TableCell>
                      {vendor.stateCode} - {getStateName(vendor.stateCode)}
                    </TableCell>
                    <TableCell>{vendor.city || '-'}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        {vendor.email && <div>{vendor.email}</div>}
                        {vendor.phone && <div>{vendor.phone}</div>}
                        {!vendor.email && !vendor.phone && '-'}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="icon" asChild>
                          <Link href={`/vendors/${vendor.id}/edit`}>
                            <Pencil className="h-4 w-4" />
                          </Link>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => confirmDelete(vendor)}
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
            <DialogTitle>Delete Vendor</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{vendorToDelete?.name}&quot;?
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
