'use client';

import { useState, useEffect, use } from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

import { STATE_CODE_OPTIONS } from '@/constants/state-codes';
import { TAX_RATES } from '@/constants/tax-rates';
import { COMMON_SAC_CODES } from '@/constants/sac-codes';
import { Loader2, Plus, Trash2, ArrowLeft } from 'lucide-react';

const lineItemSchema = z.object({
  sacCode: z.string().min(1, 'SAC code is required'),
  description: z.string().min(1, 'Description is required'),
  quantity: z.number().min(1, 'Quantity must be at least 1'),
  unitPrice: z.number().min(0.01, 'Unit price must be greater than 0'),
  taxRate: z.number(),
});

const invoiceSchema = z.object({
  invoiceNumber: z.string().min(1, 'Invoice number is required'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  customerId: z.string().min(1, 'Customer is required'),
  placeOfSupply: z.string().min(2, 'Place of supply is required'),
  notes: z.string().optional(),
  items: z.array(lineItemSchema).min(1, 'At least one item is required'),
});

type InvoiceFormData = z.infer<typeof invoiceSchema>;

interface Customer {
  id: number;
  name: string;
  gstin: string | null;
  stateCode: string;
  isB2B: boolean;
}

interface BusinessProfile {
  stateCode: string;
}

export default function EditInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const form = useForm<InvoiceFormData>({
    resolver: zodResolver(invoiceSchema),
    defaultValues: {
      invoiceNumber: '',
      invoiceDate: format(new Date(), 'yyyy-MM-dd'),
      customerId: '',
      placeOfSupply: '',
      notes: '',
      items: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'items',
  });

  // Load invoice data and customers
  useEffect(() => {
    async function loadData() {
      try {
        const [invoiceRes, customersRes, profileRes] = await Promise.all([
          fetch(`/api/gst/invoices/${id}`),
          fetch('/api/gst/customers'),
          fetch('/api/business-profile'),
        ]);

        if (!invoiceRes.ok) {
          throw new Error('Invoice not found');
        }

        const invoiceData = await invoiceRes.json();
        const customersData = await customersRes.json();
        const profileData = await profileRes.json();

        // Check if invoice is editable
        if (invoiceData.invoice.status !== 'DRAFT') {
          toast.error('Only draft invoices can be edited');
          router.push(`/gst/invoices/${id}`);
          return;
        }

        setCustomers(customersData.customers || []);

        if (profileData.profile) {
          setProfile(profileData.profile);
        }

        // Pre-populate form with invoice data
        const invoice = invoiceData.invoice;
        const items = invoiceData.items || [];

        form.reset({
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: format(new Date(invoice.invoiceDate), 'yyyy-MM-dd'),
          customerId: invoice.customerId?.toString() || '',
          placeOfSupply: invoice.placeOfSupplyCode,
          notes: invoice.notes || '',
          items: items.map((item: {
            sacCode: string;
            description: string;
            quantity: number;
            unitPrice: number;
            taxRate: number;
          }) => ({
            sacCode: item.sacCode,
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unitPrice / 100, // Convert from paisa to rupees
            taxRate: item.taxRate,
          })),
        });
      } catch (error) {
        console.error('Failed to load data:', error);
        toast.error('Failed to load invoice');
        router.push('/gst/invoices');
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, [id, form, router]);

  // Auto-fill place of supply when customer is selected
  const handleCustomerChange = (customerId: string) => {
    form.setValue('customerId', customerId);
    const customer = customers.find((c) => c.id.toString() === customerId);
    if (customer) {
      form.setValue('placeOfSupply', customer.stateCode);
    }
  };

  // Calculate totals
  const watchItems = form.watch('items');
  const watchPlaceOfSupply = form.watch('placeOfSupply');

  const isInterState = profile?.stateCode !== watchPlaceOfSupply;

  const calculateTotals = () => {
    let taxableValue = 0;
    let cgst = 0;
    let sgst = 0;
    let igst = 0;

    watchItems.forEach((item) => {
      const itemTaxableValue = (item.quantity || 0) * (item.unitPrice || 0);
      taxableValue += itemTaxableValue;

      if (isInterState) {
        igst += (itemTaxableValue * (item.taxRate || 0)) / 100;
      } else {
        const halfRate = (item.taxRate || 0) / 2;
        cgst += (itemTaxableValue * halfRate) / 100;
        sgst += (itemTaxableValue * halfRate) / 100;
      }
    });

    return {
      taxableValue,
      cgst,
      sgst,
      igst,
      total: taxableValue + cgst + sgst + igst,
    };
  };

  const totals = calculateTotals();

  const onSubmit = async (data: InvoiceFormData) => {
    setIsSaving(true);
    try {
      const response = await fetch(`/api/gst/invoices/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...data,
          customerId: parseInt(data.customerId, 10),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to update invoice');
      }

      toast.success('Invoice updated', {
        description: `Invoice ${data.invoiceNumber} has been saved.`,
      });

      router.push(`/gst/invoices/${id}`);
      router.refresh();
    } catch (error) {
      toast.error('Failed to save', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!profile) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-muted-foreground mb-4">
            Business profile not found.
          </p>
          <Button onClick={() => router.push('/settings')}>
            Go to Settings
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/invoices/${id}`}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit Invoice</h1>
          <p className="text-muted-foreground">
            Update invoice details and line items
          </p>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Invoice Details */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Details</CardTitle>
              <CardDescription>
                Invoice number, date, and customer
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <FormField
                  control={form.control}
                  name="invoiceNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Number *</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="e.g., INV-0001" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="invoiceDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Invoice Date *</FormLabel>
                      <FormControl>
                        <Input {...field} type="date" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="customerId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Customer *</FormLabel>
                      <Select
                        onValueChange={handleCustomerChange}
                        value={field.value}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select customer" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {customers.map((customer) => (
                            <SelectItem
                              key={customer.id}
                              value={customer.id.toString()}
                            >
                              {customer.name}
                              {customer.gstin ? ` (${customer.gstin})` : ' (B2C)'}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="placeOfSupply"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Place of Supply *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select state" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {STATE_CODE_OPTIONS.map((state) => (
                          <SelectItem key={state.value} value={state.value}>
                            {state.value} - {state.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isInterState && (
                      <FormDescription className="text-amber-600">
                        Inter-state supply - IGST will be applied
                      </FormDescription>
                    )}
                    {!isInterState && watchPlaceOfSupply && (
                      <FormDescription className="text-green-600">
                        Intra-state supply - CGST + SGST will be applied
                      </FormDescription>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Line Items */}
          <Card>
            <CardHeader>
              <CardTitle>Line Items</CardTitle>
              <CardDescription>Services with SAC codes and tax rates</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">SAC Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[80px]">Qty</TableHead>
                    <TableHead className="w-[120px]">Unit Price</TableHead>
                    <TableHead className="w-[100px]">Tax Rate</TableHead>
                    <TableHead className="w-[120px] text-right">Amount</TableHead>
                    <TableHead className="w-[50px]"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fields.map((field, index) => {
                    const quantity = form.watch(`items.${index}.quantity`) || 0;
                    const unitPrice = form.watch(`items.${index}.unitPrice`) || 0;
                    const amount = quantity * unitPrice;

                    return (
                      <TableRow key={field.id}>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`items.${index}.sacCode`}
                            render={({ field }) => (
                              <Select
                                onValueChange={(value) => {
                                  field.onChange(value);
                                  const sac = COMMON_SAC_CODES.find(
                                    (s) => s.code === value
                                  );
                                  if (sac) {
                                    form.setValue(
                                      `items.${index}.description`,
                                      sac.description
                                    );
                                    form.setValue(`items.${index}.taxRate`, sac.defaultRate);
                                  }
                                }}
                                value={field.value}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue placeholder="SAC" />
                                </SelectTrigger>
                                <SelectContent>
                                  {COMMON_SAC_CODES.map((sac) => (
                                    <SelectItem key={sac.code} value={sac.code}>
                                      {sac.code}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`items.${index}.description`}
                            render={({ field }) => (
                              <Input {...field} className="h-8" placeholder="Description" />
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`items.${index}.quantity`}
                            render={({ field }) => (
                              <Input
                                {...field}
                                type="number"
                                className="h-8"
                                min={1}
                                onChange={(e) =>
                                  field.onChange(parseInt(e.target.value, 10) || 0)
                                }
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`items.${index}.unitPrice`}
                            render={({ field }) => (
                              <Input
                                {...field}
                                type="number"
                                className="h-8"
                                min={0}
                                step={0.01}
                                onChange={(e) =>
                                  field.onChange(parseFloat(e.target.value) || 0)
                                }
                              />
                            )}
                          />
                        </TableCell>
                        <TableCell>
                          <FormField
                            control={form.control}
                            name={`items.${index}.taxRate`}
                            render={({ field }) => (
                              <Select
                                onValueChange={(value) =>
                                  field.onChange(parseFloat(value))
                                }
                                value={field.value?.toString()}
                              >
                                <SelectTrigger className="h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TAX_RATES.map((rate) => (
                                    <SelectItem
                                      key={rate}
                                      value={rate.toString()}
                                    >
                                      {rate}%
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ₹{amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          {fields.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => remove(index)}
                            >
                              <Trash2 className="h-4 w-4 text-red-500" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>

              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() =>
                  append({
                    sacCode: '',
                    description: '',
                    quantity: 1,
                    unitPrice: 0,
                    taxRate: 18,
                  })
                }
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Line Item
              </Button>
            </CardContent>
          </Card>

          {/* Totals */}
          <Card>
            <CardHeader>
              <CardTitle>Invoice Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span>Taxable Value</span>
                  <span className="font-medium">
                    ₹{totals.taxableValue.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
                {!isInterState ? (
                  <>
                    <div className="flex justify-between text-sm">
                      <span>CGST</span>
                      <span>
                        ₹{totals.cgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span>SGST</span>
                      <span>
                        ₹{totals.sgst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex justify-between text-sm">
                    <span>IGST</span>
                    <span>
                      ₹{totals.igst.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-2 text-lg font-bold">
                  <span>Total</span>
                  <span>
                    ₹{totals.total.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Notes */}
          <Card>
            <CardHeader>
              <CardTitle>Notes</CardTitle>
              <CardDescription>Optional notes for this invoice</CardDescription>
            </CardHeader>
            <CardContent>
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <Textarea
                        {...field}
                        placeholder="Add any notes or terms..."
                        rows={3}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          {/* Submit */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => router.push(`/gst/invoices/${id}`)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
