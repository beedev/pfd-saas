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

import { validateGSTIN, extractStateCode, extractPAN } from '@/lib/validations/gstin';
import { STATE_CODE_OPTIONS, getStateName } from '@/constants/state-codes';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

const vendorSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  gstin: z.string().length(15, 'GSTIN is required for vendors (15 characters)'),
  pan: z.string().optional(),
  stateCode: z.string().min(2, 'State is required'),
  address: z.string().optional(),
  city: z.string().optional(),
  pincode: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
});

type VendorFormData = z.infer<typeof vendorSchema>;

interface GSTINInfo {
  isValid: boolean;
  stateCode: string | null;
  stateName: string | null;
  pan: string | null;
  error: string | null;
}

interface VendorFormProps {
  vendorId?: number;
  initialData?: VendorFormData;
}

export function VendorForm({ vendorId, initialData }: VendorFormProps) {
  const router = useRouter();
  const [isSaving, setIsSaving] = useState(false);
  const [gstinInfo, setGstinInfo] = useState<GSTINInfo | null>(null);
  const isEditing = !!vendorId;

  const form = useForm<VendorFormData>({
    resolver: zodResolver(vendorSchema),
    defaultValues: initialData || {
      name: '',
      gstin: '',
      pan: '',
      stateCode: '',
      address: '',
      city: '',
      pincode: '',
      email: '',
      phone: '',
    },
  });

  // Auto-fill state code and PAN from GSTIN
  useEffect(() => {
    if (gstinInfo?.isValid) {
      if (gstinInfo.stateCode) {
        form.setValue('stateCode', gstinInfo.stateCode);
      }
      if (gstinInfo.pan) {
        form.setValue('pan', gstinInfo.pan);
      }
    }
  }, [gstinInfo, form]);

  const validateAndSetGSTIN = (gstin: string) => {
    if (!gstin || gstin.length < 15) {
      setGstinInfo(null);
      return;
    }

    const validation = validateGSTIN(gstin);
    const stateCode = extractStateCode(gstin);
    const pan = extractPAN(gstin);

    setGstinInfo({
      isValid: validation.isValid,
      stateCode,
      stateName: stateCode ? getStateName(stateCode) : null,
      pan,
      error: validation.error,
    });
  };

  const handleGSTINChange = (value: string) => {
    const upperValue = value.toUpperCase();
    form.setValue('gstin', upperValue);
    validateAndSetGSTIN(upperValue);
  };

  const onSubmit = async (data: VendorFormData) => {
    // Validate GSTIN
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

    setIsSaving(true);
    try {
      const url = isEditing ? `/api/gst/vendors/${vendorId}` : '/api/gst/vendors';
      const method = isEditing ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save vendor');
      }

      toast.success(isEditing ? 'Vendor updated' : 'Vendor created', {
        description: `${data.name} has been saved successfully.`,
      });

      router.push('/gst/vendors');
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
        {/* GST Information */}
        <Card>
          <CardHeader>
            <CardTitle>GST Registration Details</CardTitle>
            <CardDescription>
              GSTIN is required for vendors to claim Input Tax Credit
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="gstin"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>GSTIN *</FormLabel>
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
                  {gstinInfo && !gstinInfo.isValid && gstinInfo.error && (
                    <p className="text-sm text-red-500">{gstinInfo.error}</p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Auto-extracted information */}
            {gstinInfo && gstinInfo.isValid && (
              <div className="grid gap-4 rounded-lg bg-green-50 p-4 md:grid-cols-2">
                <div>
                  <p className="text-xs text-green-700">PAN (Auto-extracted)</p>
                  <p className="font-medium text-green-900">{gstinInfo.pan}</p>
                </div>
                <div>
                  <p className="text-xs text-green-700">State (Auto-extracted)</p>
                  <p className="font-medium text-green-900">
                    {gstinInfo.stateCode} - {gstinInfo.stateName}
                  </p>
                </div>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="pan"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>PAN</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        placeholder="Auto-filled from GSTIN"
                        maxLength={10}
                        className="uppercase"
                        readOnly={gstinInfo?.isValid}
                      />
                    </FormControl>
                    <FormDescription>
                      Auto-extracted from GSTIN
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="stateCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>State *</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      value={field.value}
                      disabled={gstinInfo?.isValid}
                    >
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
                    <FormDescription>
                      Auto-filled from GSTIN
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Basic Information */}
        <Card>
          <CardHeader>
            <CardTitle>Vendor Information</CardTitle>
            <CardDescription>
              Enter vendor business details
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Vendor Name *</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Vendor or business name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </CardContent>
        </Card>

        {/* Address & Contact */}
        <Card>
          <CardHeader>
            <CardTitle>Address & Contact</CardTitle>
            <CardDescription>
              Optional contact information for the vendor
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
                      <Input {...field} type="email" placeholder="vendor@example.com" />
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
            onClick={() => router.push('/gst/vendors')}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditing ? 'Update Vendor' : 'Create Vendor'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
