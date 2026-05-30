'use client';

import { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { pdf } from '@react-pdf/renderer';

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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import {
  ArrowLeft,
  Download,
  Loader2,
  MoreHorizontal,
  CheckCircle,
  XCircle,
  Trash2,
  Pencil,
} from 'lucide-react';

import { InvoicePDF, type InvoiceData } from '@/components/invoice-pdf';
import { STATE_CODE_OPTIONS } from '@/constants/state-codes';

interface InvoiceItem {
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
}

interface Invoice {
  id: number;
  invoiceNumber: string;
  invoiceDate: string;
  customerId: number | null;
  customerName: string;
  customerGstin: string | null;
  invoiceType: string;
  placeOfSupplyCode: string;
  isInterState: boolean;
  supplyType?: 'REGULAR' | 'EXPORT_WITH_IGST' | 'EXPORT_LUT' | 'SEZ';
  taxableAmount: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
  totalAmount: number;
  status: string;
  returnPeriod: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Customer {
  id: number;
  name: string;
  gstin: string | null;
  address: string | null;
  city: string | null;
  stateCode: string;
  pincode: string | null;
}

interface Business {
  businessName: string;
  tradeName: string | null;
  gstin: string;
  pan: string;
  address: string | null;
  city: string | null;
  stateCode: string;
  pincode: string | null;
  email: string | null;
  phone: string | null;
}

export default function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [items, setItems] = useState<InvoiceItem[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    loadInvoice();
  }, [id]);

  const loadInvoice = async () => {
    try {
      const response = await fetch(`/api/gst/invoices/${id}`);
      if (!response.ok) {
        throw new Error('Invoice not found');
      }
      const data = await response.json();
      setInvoice(data.invoice);
      setItems(data.items || []);
      setCustomer(data.customer);
      setBusiness(data.business);
    } catch (error) {
      console.error('Failed to load invoice:', error);
      toast.error('Failed to load invoice');
      router.push('/gst/invoices');
    } finally {
      setIsLoading(false);
    }
  };

  const formatAmount = (paisa: number) => {
    return (paisa / 100).toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const getStateName = (code: string) => {
    const state = STATE_CODE_OPTIONS.find((s) => s.value === code);
    return state ? `${code} - ${state.name}` : code;
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

  const handleStatusChange = async (newStatus: string) => {
    if (!invoice) return;

    setIsUpdating(true);
    try {
      const response = await fetch(`/api/gst/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update status');
      }

      const data = await response.json();
      setInvoice(data.invoice);
      toast.success('Status updated', {
        description: `Invoice marked as ${newStatus.toLowerCase()}.`,
      });
    } catch (error) {
      toast.error('Failed to update status', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/gst/invoices/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete invoice');
      }

      toast.success('Invoice deleted');
      router.push('/gst/invoices');
    } catch (error) {
      toast.error('Failed to delete', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const handleDownloadPDF = async () => {
    if (!invoice || !business) return;

    setIsDownloading(true);
    try {
      const pdfData: InvoiceData = {
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.invoiceDate,
          customerName: invoice.customerName,
          customerGstin: invoice.customerGstin,
          invoiceType: invoice.invoiceType,
          placeOfSupplyCode: invoice.placeOfSupplyCode,
          isInterState: invoice.isInterState,
          supplyType: invoice.supplyType,
          taxableAmount: invoice.taxableAmount,
          cgstAmount: invoice.cgstAmount,
          sgstAmount: invoice.sgstAmount,
          igstAmount: invoice.igstAmount,
          cessAmount: invoice.cessAmount || 0,
          totalAmount: invoice.totalAmount,
          notes: invoice.notes,
        },
        items: items.map((item) => ({
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
        business: {
          businessName: business.businessName,
          tradeName: business.tradeName,
          gstin: business.gstin,
          pan: business.pan,
          address: business.address,
          city: business.city,
          stateCode: business.stateCode,
          pincode: business.pincode,
          email: business.email,
          phone: business.phone,
        },
        customer: customer
          ? {
              name: customer.name,
              gstin: customer.gstin,
              address: customer.address,
              city: customer.city,
              stateCode: customer.stateCode,
              pincode: customer.pincode,
            }
          : null,
      };

      const blob = await pdf(<InvoicePDF data={pdfData} />).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${invoice.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast.success('PDF downloaded');
    } catch (error) {
      console.error('Failed to download PDF:', error);
      toast.error('Failed to download PDF');
    } finally {
      setIsDownloading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Invoice not found</p>
        <Button asChild className="mt-4">
          <Link href="/gst/invoices">Back to Invoices</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" asChild>
            <Link href="/gst/invoices">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">
                {invoice.invoiceNumber}
              </h1>
              {getStatusBadge(invoice.status)}
            </div>
            <p className="text-muted-foreground">
              Created on {format(new Date(invoice.createdAt), 'dd MMM yyyy, HH:mm')}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {invoice.status === 'DRAFT' && (
            <>
              <Button variant="outline" asChild>
                <Link href={`/gst/invoices/${id}/edit`}>
                  <Pencil className="mr-2 h-4 w-4" />
                  Edit
                </Link>
              </Button>
              <Button
                onClick={() => handleStatusChange('FINAL')}
                disabled={isUpdating}
              >
                {isUpdating ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle className="mr-2 h-4 w-4" />
                )}
                Finalize
              </Button>
            </>
          )}

          <Button
            variant="outline"
            onClick={handleDownloadPDF}
            disabled={isDownloading}
          >
            {isDownloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download PDF
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {invoice.status !== 'CANCELLED' && (
                <DropdownMenuItem
                  onClick={() => handleStatusChange('CANCELLED')}
                  className="text-amber-600"
                >
                  <XCircle className="mr-2 h-4 w-4" />
                  Cancel Invoice
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => setDeleteDialogOpen(true)}
                className="text-red-600"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete Invoice
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Invoice Details */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Number</p>
                  <p className="font-medium">{invoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Date</p>
                  <p className="font-medium">
                    {format(new Date(invoice.invoiceDate), 'dd MMM yyyy')}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Invoice Type</p>
                  <p className="font-medium">
                    <Badge variant={invoice.invoiceType === 'B2B' ? 'default' : 'secondary'}>
                      {invoice.invoiceType}
                    </Badge>
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Place of Supply</p>
                  <p className="font-medium">{getStateName(invoice.placeOfSupplyCode)}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Supply Type</p>
                  <p className="font-medium">
                    {invoice.isInterState ? (
                      <Badge variant="outline">Inter-State (IGST)</Badge>
                    ) : (
                      <Badge variant="outline">Intra-State (CGST+SGST)</Badge>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Return Period</p>
                  <p className="font-medium">{invoice.returnPeriod}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
              <CardDescription>{items.length} item(s)</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>SAC</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Rate</TableHead>
                    <TableHead className="text-right">Taxable</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item, index) => (
                    <TableRow key={item.id}>
                      <TableCell>{index + 1}</TableCell>
                      <TableCell className="max-w-[200px]">
                        <p className="truncate">{item.description}</p>
                      </TableCell>
                      <TableCell className="font-mono text-sm">
                        {item.sacCode}
                      </TableCell>
                      <TableCell className="text-right">{item.quantity}</TableCell>
                      <TableCell className="text-right">
                        ₹{formatAmount(item.unitPrice)}
                      </TableCell>
                      <TableCell className="text-right">
                        ₹{formatAmount(item.taxableAmount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-muted-foreground">{item.taxRate}%</span>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        ₹{formatAmount(item.totalAmount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Notes */}
          {invoice.notes && (
            <Card>
              <CardHeader>
                <CardTitle>Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground whitespace-pre-wrap">
                  {invoice.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Customer */}
          <Card>
            <CardHeader>
              <CardTitle>Bill To</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="font-semibold">{invoice.customerName}</p>
              {invoice.customerGstin && (
                <p className="text-sm font-mono text-muted-foreground">
                  GSTIN: {invoice.customerGstin}
                </p>
              )}
              {customer && (
                <>
                  {customer.address && (
                    <p className="text-sm text-muted-foreground mt-2">
                      {customer.address}
                    </p>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {customer.city}
                    {customer.pincode && ` - ${customer.pincode}`}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {getStateName(customer.stateCode)}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          {/* Totals */}
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Taxable Value</span>
                <span>₹{formatAmount(invoice.taxableAmount)}</span>
              </div>

              {!invoice.isInterState ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">CGST</span>
                    <span>₹{formatAmount(invoice.cgstAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">SGST</span>
                    <span>₹{formatAmount(invoice.sgstAmount)}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">IGST</span>
                  <span>₹{formatAmount(invoice.igstAmount)}</span>
                </div>
              )}

              {invoice.cessAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Cess</span>
                  <span>₹{formatAmount(invoice.cessAmount)}</span>
                </div>
              )}

              <Separator />

              <div className="flex justify-between text-lg font-bold">
                <span>Total</span>
                <span className="text-green-600">
                  ₹{formatAmount(invoice.totalAmount)}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Supplier */}
          {business && (
            <Card>
              <CardHeader>
                <CardTitle>From</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-semibold">{business.businessName}</p>
                {business.tradeName && (
                  <p className="text-sm text-muted-foreground">
                    ({business.tradeName})
                  </p>
                )}
                <p className="text-sm font-mono text-muted-foreground">
                  GSTIN: {business.gstin}
                </p>
                {business.address && (
                  <p className="text-sm text-muted-foreground mt-2">
                    {business.address}
                  </p>
                )}
                <p className="text-sm text-muted-foreground">
                  {business.city}
                  {business.pincode && ` - ${business.pincode}`}
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Invoice</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete invoice &quot;{invoice.invoiceNumber}&quot;?
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
