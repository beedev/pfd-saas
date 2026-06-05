'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

import { validateGSTIN, extractStateCode } from '@/lib/validations/gstin';
import { STATE_CODE_OPTIONS, getStateName } from '@/constants/state-codes';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const SUPPLY_TYPE_OPTIONS = [
  { value: 'REGULAR', label: 'Regular (Domestic)', description: 'Standard domestic supply' },
  { value: 'EXPORT_WITH_IGST', label: 'Export with IGST', description: 'Export with payment of IGST' },
  { value: 'EXPORT_LUT', label: 'Export under LUT', description: 'Export without payment of IGST under Letter of Undertaking' },
  { value: 'SEZ', label: 'SEZ Supply', description: 'Supply to SEZ Unit/Developer' },
] as const;

const customerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  gstin: z.string().optional(),
  pan: z.string().optional(),
  stateCode: z.string().min(2, 'State is required'),
  supplyType: z.enum(['REGULAR', 'EXPORT_WITH_IGST', 'EXPORT_LUT', 'SEZ']),
  address: z.string().optional(),
  city: z.string().optional(),
  pincode: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  // Sprint A.1 — TDS deduction config. The number input emits a number;
  // the API also clamps + normalises defensively. NaN handling is in the
  // submit path so the form stays forgiving.
  tdsRatePct: z.number().min(0).max(100).optional(),
  tdsSection: z.string().optional(),
});

type CustomerFormData = z.infer<typeof customerSchema>;

interface GSTINInfo {
  isValid: boolean;
  stateCode: string | null;
  stateName: string | null;
  error: string | null;
}

interface CustomerFormProps {
  customerId?: number;
  initialData?: CustomerFormData;
}

export function CustomerForm({ customerId, initialData }: CustomerFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [gstinInfo, setGstinInfo] = useState<GSTINInfo | null>(null);
  const isEditing = !!customerId;

  const form = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: initialData || {
      name: '',
      gstin: '',
      pan: '',
      stateCode: '',
      supplyType: 'REGULAR',
      address: '',
      city: '',
      pincode: '',
      email: '',
      phone: '',
      tdsRatePct: 10,
      tdsSection: '194J',
    },
  });

  // Auto-fill state code from GSTIN
  useEffect(() => {
    if (gstinInfo?.isValid && gstinInfo.stateCode) {
      form.setValue('stateCode', gstinInfo.stateCode);
    }
  }, [gstinInfo, form]);

  const validateAndSetGSTIN = (gstin: string) => {
    if (!gstin || gstin.length < 15) {
      setGstinInfo(null);
      return;
    }

    const validation = validateGSTIN(gstin);
    const stateCode = extractStateCode(gstin);

    setGstinInfo({
      isValid: validation.isValid,
      stateCode,
      stateName: stateCode ? getStateName(stateCode) : null,
      error: validation.error,
    });
  };

  const handleGSTINChange = (value: string) => {
    const upperValue = value.toUpperCase();
    form.setValue('gstin', upperValue);
    validateAndSetGSTIN(upperValue);
  };

  const onSubmit = async (data: CustomerFormData) => {
    // Validate GSTIN if provided
    if (data.gstin && data.gstin.length > 0) {
      const validation = validateGSTIN(data.gstin);
      if (!validation.isValid) {
        toast.error('Invalid GSTIN', {
          description: validation.error,
        });
        return;
      }

      // Verify state code matches
      const gstinStateCode = extractStateCode(data.gstin);
      if (gstinStateCode !== data.stateCode) {
        toast.error('State mismatch', {
          description: 'GSTIN state code does not match selected state',
        });
        return;
      }
    }

    setIsSaving(true);
    try {
      const url = isEditing ? `/api/gst/customers/${customerId}` : '/api/gst/customers';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save customer');
      }

      toast.success(isEditing ? 'Customer updated' : 'Customer created', {
        description: `${data.name} has been saved successfully.`,
      });

      router.push('/gst/customers');
      router.refresh();
    } catch (error) {
      toast.error('Failed to save', {
        description: error instanceof Error ? error.message : 'An error occurred',
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Customer Information</CardTitle>
            <CardDescription>
              Enter customer details. GSTIN is optional for B2C customers.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Customer Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Customer or business name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="gstin"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>GSTIN (for B2B)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          placeholder="e.g., 29AABCU9603R1ZM"
                          maxLength={15}
                          className="uppercase pr-10"
                          onChange={(e) => handleGSTINChange(e.target.value)}
                        />
                        {gstinInfo && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            {gstinInfo.isValid ? (
                              <CheckCircle2 className="h-5 w-5 text-green-500" />
                            ) : (
                              <AlertCircle className="h-5 w-5 text-red-500" />
                            )}
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      Leave empty for B2C (unregistered) customers
                    </FormDescription>
                    {gstinInfo && !gstinInfo.isValid && gstinInfo.error && (
                      <p className="text-sm text-red-500">{gstinInfo.error}</p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="ABCDE1234F"
                        maxLength={10}
                        className="uppercase"
                        onChange={(e) => field.onChange(e.target.value.toUpperCase())}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="stateCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>State *</FormLabel>
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
                  {gstinInfo?.isValid && (
                    <FormDescription className="text-green-600">
                      Auto-filled from GSTIN: {gstinInfo.stateCode} - {gstinInfo.stateName}
                    </FormDescription>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="supplyType"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Supply Type</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select supply type" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {SUPPLY_TYPE_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    {SUPPLY_TYPE_OPTIONS.find(o => o.value === field.value)?.description}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* TDS Deduction (Sprint A.1) */}
        <Card>
          <CardHeader>
            <CardTitle>TDS Deduction</CardTitle>
            <CardDescription>
              If this customer deducts TDS on your invoices, set the rate and section.
              Defaults to 10% u/s 194J (most common for professional / consulting income).
              Auto-emits a tds_credits row when an invoice to this customer is finalised.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="tdsRatePct"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>TDS rate (%)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step="0.01"
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          field.onChange(v === '' ? undefined : Number(v));
                        }}
                        placeholder="10"
                      />
                    </FormControl>
                    <FormDescription>
                      Set to 0 if this customer does not deduct TDS.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tdsSection"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Section</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        value={field.value ?? ''}
                        placeholder="194J"
                        className="uppercase"
                      />
                    </FormControl>
                    <FormDescription>
                      Common: 194J (professional), 194C (contract), 194A (interest), 194-IA (property).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Address & Contact */}
        <Card>
          <CardHeader>
            <CardTitle>Address & Contact</CardTitle>
            <CardDescription>
              Optional contact information for the customer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Street address" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="City" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="pincode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Pincode</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="6-digit pincode" maxLength={6} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="customer@example.com" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="10-digit phone number" maxLength={10} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex justify-end gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push('/gst/customers')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Update Customer' : 'Create Customer'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
