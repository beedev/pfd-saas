'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Plus, Trash2, Loader2, FileText, Eye, Download, Pencil } from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { InvoicePDF, type InvoiceData } from '@/components/invoice-pdf';

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceType: string;
  placeOfSupplyCode: string;
  isInterState: boolean;
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  totalAmount: number;
  status: string;
  returnPeriod: string;
  customer: {
    id: number;
    name: string;
    gstin: string | null;
  } | null;
}

function getCurrentFy(): string {
  const now = new Date();
  const startYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${startYear}-${String(startYear + 1).slice(2)}`;
}

function generateFyOptions(): Array<{ value: string; label: string }> {
  const currentStart = parseInt(getCurrentFy().split('-')[0], 10);
  const opts: Array<{ value: string; label: string }> = [];
  for (let i = 2; i >= -1; i--) {
    const s = currentStart - i;
    const e = String(s + 1).slice(2);
    opts.push({ value: `${s}-${e}`, label: `FY ${s}-${e}` });
  }
  return opts;
}

export default function InvoicesPage() {
  const [fy, setFy] = useState(getCurrentFy());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [invoiceToDelete, setInvoiceToDelete] = useState<Invoice | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);

  const loadInvoices = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`/api/gst/invoices?fy=${encodeURIComponent(fy)}`);
      const data = await response.json();
      setInvoices(data.invoices || []);
    } catch (error) {
      console.error('Failed to load invoices:', error);
      toast.error('Failed to load invoices');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
  }, [fy]);

  const handleDelete = async () => {
    if (!invoiceToDelete) return;

    setIsDeleting(true);
    try {
      const response = await fetch(`/api/gst/invoices/${invoiceToDelete.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete invoice');
      }

      toast.success('Invoice deleted', {
        description: `Invoice ${invoiceToDelete.invoiceNumber} has been deleted.`,
      });

      setInvoices(invoices.filter((i) => i.id !== invoiceToDelete.id));
    } catch (error) {
      toast.error('Failed to delete', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
      setInvoiceToDelete(null);
    }
  };

  const confirmDelete = (invoice: Invoice) => {
    setInvoiceToDelete(invoice);
    setDeleteDialogOpen(true);
  };

  const handleDownloadPDF = async (invoice: Invoice) => {
    setDownloadingId(invoice.id);
    try {
      // Fetch full invoice data with items, customer, and business profile
      const response = await fetch(`/api/gst/invoices/${invoice.id}`);
      if (!response.ok) {
        throw new Error('Failed to fetch invoice data');
      }
      const data = await response.json();

      // Prepare data for PDF
      const pdfData: InvoiceData = {
        invoice: {
          id: data.invoice.id,
          invoiceNumber: data.invoice.invoiceNumber,
          invoiceDate: data.invoice.invoiceDate,
          customerName: data.invoice.customerName,
          customerGstin: data.invoice.customerGstin,
          invoiceType: data.invoice.invoiceType,
          placeOfSupplyCode: data.invoice.placeOfSupplyCode,
          isInterState: data.invoice.isInterState,
          supplyType: data.invoice.supplyType,
          taxableAmount: data.invoice.taxableAmount,
          cgstAmount: data.invoice.cgstAmount,
          sgstAmount: data.invoice.sgstAmount,
          igstAmount: data.invoice.igstAmount,
          cessAmount: data.invoice.cessAmount || 0,
          totalAmount: data.invoice.totalAmount,
          notes: data.invoice.notes,
        },
        items: data.items.map((item: {
          id: number;
          description: string;
          sacCode: string;
          quantity: number;
          unitPrice: number;
          taxableAmount: number;
          taxRate: number;
          cgstAmount: number;
          sgstAmount: number;
          igstAmount: number;
          totalAmount: number;
        }) => ({
          id: item.id,
          description: item.description,
          sacCode: item.sacCode,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          taxableAmount: item.taxableAmount,
          taxRate: item.taxRate,
          cgstAmount: item.cgstAmount,
          sgstAmount: item.sgstAmount,
          igstAmount: item.igstAmount,
          totalAmount: item.totalAmount,
        })),
        business: data.business ? {
          businessName: data.business.businessName,
          tradeName: data.business.tradeName,
          gstin: data.business.gstin,
          pan: data.business.pan,
          address: data.business.address,
          city: data.business.city,
          stateCode: data.business.stateCode,
          pincode: data.business.pincode,
          email: data.business.email,
          phone: data.business.phone,
        } : {
          businessName: 'Business Name',
          tradeName: null,
          gstin: 'GSTIN',
          pan: 'PAN',
          address: null,
          city: null,
          stateCode: '29',
          pincode: null,
          email: null,
          phone: null,
        },
        customer: data.customer ? {
          name: data.customer.name,
          gstin: data.customer.gstin,
          address: data.customer.address,
          city: data.customer.city,
          stateCode: data.customer.stateCode,
          pincode: data.customer.pincode,
        } : null,
      };

      // Generate PDF blob
      const blob = await pdf(<InvoicePDF data={pdfData} />).toBlob();

      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('PDF downloaded', {
        description: `Invoice ${invoice.invoiceNumber} has been downloaded.`,
      });
    } catch (error) {
      console.error('Failed to download PDF:', error);
      toast.error('Failed to download PDF', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const formatAmount = (paisa: number) => {
    return (paisa / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'FINAL':
        return <Badge variant="default">Final</Badge>;
      case 'CANCELLED':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="secondary">Draft</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Summary — all invoices are already filtered by FY from the API
  const totalTaxableValue = invoices.reduce((sum, inv) => sum + inv.taxableAmount, 0);
  const totalTax = invoices.reduce(
    (sum, inv) => sum + inv.cgstAmount + inv.sgstAmount + inv.igstAmount, 0,
  );
  const totalAmount = invoices.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const b2bCount = invoices.filter((inv) => inv.invoiceType === 'B2B').length;
  const b2cCount = invoices.filter((inv) => inv.invoiceType === 'B2C').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Sales Invoices</h1>
          <p className="text-muted-foreground">
            Manage your outward supplies and sales invoices
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {generateFyOptions().map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button asChild>
            <Link href="/gst/invoices/new">
              <Plus className="mr-2 h-4 w-4" />
              New Invoice
            </Link>
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Invoices (FY {fy})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{invoices.length}</div>
            <p className="text-xs text-muted-foreground">
              {b2bCount} B2B, {b2cCount} B2C
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Taxable Value</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">₹{formatAmount(totalTaxableValue)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tax</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              ₹{formatAmount(totalTax)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Amount</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ₹{formatAmount(totalAmount)}
            </div>
          </CardContent>
        </Card>
      </div>

      {invoices.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No invoices yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first invoice to start tracking sales
            </p>
            <Button asChild>
              <Link href="/gst/invoices/new">
                <Plus className="mr-2 h-4 w-4" />
                New Invoice
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Invoice List</CardTitle>
            <CardDescription>
              {invoices.length} invoice{invoices.length !== 1 ? 's' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Taxable</TableHead>
                  <TableHead className="text-right">Tax</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((invoice) => (
                  <TableRow key={invoice.id}>
                    <TableCell className="font-medium">
                      <Link href={`/gst/invoices/${invoice.id}`} className="text-primary hover:underline">
                        {invoice.invoiceNumber}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {format(new Date(invoice.invoiceDate), 'dd MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <div>
                        {invoice.customer?.name || 'Unknown'}
                        {invoice.customer?.gstin && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {invoice.customer.gstin}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={invoice.invoiceType === 'B2B' ? 'default' : 'secondary'}>
                        {invoice.invoiceType}
                      </Badge>
                      {invoice.isInterState && (
                        <Badge variant="outline" className="ml-1">
                          IGST
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      ₹{formatAmount(invoice.taxableAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      ₹{formatAmount(
                        invoice.cgstAmount +
                          invoice.sgstAmount +
                          invoice.igstAmount
                      )}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ₹{formatAmount(invoice.totalAmount)}
                    </TableCell>
                    <TableCell>{getStatusBadge(invoice.status)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" asChild title="View">
                          <Link href={`/gst/invoices/${invoice.id}`}>
                            <Eye className="h-4 w-4" />
                          </Link>
                        </Button>
                        {invoice.status === 'DRAFT' && (
                          <Button variant="ghost" size="icon" asChild title="Edit">
                            <Link href={`/gst/invoices/${invoice.id}/edit`}>
                              <Pencil className="h-4 w-4" />
                            </Link>
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDownloadPDF(invoice)}
                          disabled={downloadingId === invoice.id}
                          title="Download PDF"
                        >
                          {downloadingId === invoice.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Download className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => confirmDelete(invoice)}
                          title="Delete"
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
            <DialogTitle>Delete Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete invoice &quot;{invoiceToDelete?.invoiceNumber}&quot;?
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
