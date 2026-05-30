'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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

import { validateGSTIN, extractPAN, extractStateCode, getEntityType } from '@/lib/validations/gstin';
import { STATE_CODE_OPTIONS, getStateName } from '@/constants/state-codes';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

// Financial years
const currentYear = new Date().getFullYear();
const financialYears = [
  `${currentYear - 1}-${(currentYear).toString().slice(-2)}`,
  `${currentYear}-${(currentYear + 1).toString().slice(-2)}`,
  `${currentYear + 1}-${(currentYear + 2).toString().slice(-2)}`,
];

// Form schema
const businessProfileSchema = z.object({
  businessName: z.string().min(3, 'Business name must be at least 3 characters'),
  tradeName: z.string(),
  gstin: z.string().length(15, 'GSTIN must be exactly 15 characters'),
  address: z.string(),
  city: z.string(),
  pincode: z.string(),
  email: z.string(),
  phone: z.string(),
  financialYear: z.string().min(1, 'Financial year is required'),
  invoicePrefix: z.string(),
  invoiceStartNumber: z.number().min(1, 'Must be at least 1'),
});

type BusinessProfileFormData = z.infer<typeof businessProfileSchema>;

interface GSTINInfo {
  isValid: boolean;
  pan: string | null;
  stateCode: string | null;
  stateName: string | null;
  entityType: string | null;
  error: string | null;
}

export function BusinessProfileForm() {
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [gstinInfo, setGstinInfo] = useState<GSTINInfo | null>(null);

  const form = useForm<BusinessProfileFormData>({
    resolver: zodResolver(businessProfileSchema),
    defaultValues: {
      businessName: '',
      tradeName: '',
      gstin: '',
      address: '',
      city: '',
      pincode: '',
      email: '',
      phone: '',
      financialYear: financialYears[0],
      invoicePrefix: 'INV-',
      invoiceStartNumber: 1,
    },
  });

  // Load existing profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const response = await fetch('/api/business-profile');
        const data = await response.json();
        if (data.profile) {
          form.reset({
            businessName: data.profile.businessName || '',
            tradeName: data.profile.tradeName || '',
            gstin: data.profile.gstin || '',
            address: data.profile.address || '',
            city: data.profile.city || '',
            pincode: data.profile.pincode || '',
            email: data.profile.email || '',
            phone: data.profile.phone || '',
            financialYear: data.profile.financialYear || financialYears[0],
            invoicePrefix: data.profile.invoicePrefix || 'INV-',
            invoiceStartNumber: data.profile.invoiceStartNumber || 1,
          });
          // Validate existing GSTIN
          if (data.profile.gstin) {
            validateAndSetGSTIN(data.profile.gstin);
          }
        }
      } catch (error) {
        console.error('Failed to load profile:', error);
      } finally {
        setIsLoading(false);
      }
    }
    loadProfile();
  }, [form]);

  // Validate GSTIN and extract info
  const validateAndSetGSTIN = (gstin: string) => {
    if (!gstin || gstin.length < 15) {
      setGstinInfo(null);
      return;
    }

    const validation = validateGSTIN(gstin);
    const pan = extractPAN(gstin);
    const stateCode = extractStateCode(gstin);
    const entityType = getEntityType(gstin);

    setGstinInfo({
      isValid: validation.isValid,
      pan,
      stateCode,
      stateName: stateCode ? getStateName(stateCode) : null,
      entityType,
      error: validation.error,
    });
  };

  // Handle GSTIN change
  const handleGSTINChange = (value: string) => {
    const upperValue = value.toUpperCase();
    form.setValue('gstin', upperValue);
    validateAndSetGSTIN(upperValue);
  };

  // Submit form
  const onSubmit = async (data: BusinessProfileFormData) => {
    // Validate GSTIN before submitting
    const validation = validateGSTIN(data.gstin);
    if (!validation.isValid) {
      toast.error('Invalid GSTIN', {
        description: validation.error,
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await fetch('/api/business-profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to save profile');
      }

      toast.success('Business profile saved', {
        description: 'Your business details have been saved successfully.',
      });
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

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* GSTIN Section */}
        <Card>
          <CardHeader>
            <CardTitle>GST Registration Details</CardTitle>
            <CardDescription>
              Enter your GSTIN. PAN and state will be auto-extracted.
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
                  <FormMessage />
                  {gstinInfo && !gstinInfo.isValid && gstinInfo.error && (
                    <p className="text-sm text-red-500">{gstinInfo.error}</p>
                  )}
                </FormItem>
              )}
            />

            {/* Auto-extracted information */}
            {gstinInfo && gstinInfo.isValid && (
              <div className="grid gap-4 rounded-lg bg-green-50 p-4 md:grid-cols-3">
                <div>
                  <Label className="text-xs text-green-700">PAN (Auto-extracted)</Label>
                  <p className="font-medium text-green-900">{gstinInfo.pan}</p>
                </div>
                <div>
                  <Label className="text-xs text-green-700">State (Auto-extracted)</Label>
                  <p className="font-medium text-green-900">
                    {gstinInfo.stateCode} - {gstinInfo.stateName}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-green-700">Entity Type</Label>
                  <p className="font-medium text-green-900">{gstinInfo.entityType}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Business Details */}
        <Card>
          <CardHeader>
            <CardTitle>Business Details</CardTitle>
            <CardDescription>
              Enter your business name and contact information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="businessName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Business Name *</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Legal name as per GST registration" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="tradeName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trade Name</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Trading name (if different)" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Address</FormLabel>
                  <FormControl>
                    <Input {...field} placeholder="Registered address" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="grid gap-4 md:grid-cols-3">
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

              <div>
                <Label className="text-sm font-medium">State</Label>
                <p className="mt-2 text-sm text-muted-foreground">
                  {gstinInfo?.isValid
                    ? `${gstinInfo.stateCode} - ${gstinInfo.stateName}`
                    : 'Enter GSTIN to auto-detect'}
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="contact@example.com" />
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

        {/* Invoice Settings */}
        <Card>
          <CardHeader>
            <CardTitle>Invoice Settings</CardTitle>
            <CardDescription>
              Configure your financial year and invoice numbering
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <FormField
                control={form.control}
                name="financialYear"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Financial Year *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select FY" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {financialYears.map((fy) => (
                          <SelectItem key={fy} value={fy}>
                            FY {fy}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoicePrefix"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Invoice Prefix</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="e.g., INV-" />
                    </FormControl>
                    <FormDescription>Auto-prefix for invoice numbers</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="invoiceStartNumber"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Starting Number</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={1}
                        value={field.value}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                      />
                    </FormControl>
                    <FormDescription>First invoice number</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="flex justify-end">
          <Button type="submit" disabled={isSaving} size="lg">
            {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Save Business Profile
          </Button>
        </div>
      </form>
    </Form>
  );
}
