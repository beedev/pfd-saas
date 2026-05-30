'use client';

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { format } from 'date-fns';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Loader2, RefreshCw, ArrowRight, FileText } from 'lucide-react';

interface Section3_1 {
  description: string;
  taxableValue: number;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface Section4 {
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface Section6_1 {
  description: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
}

interface ITCUtilization {
  igstToIgst: number;
  igstToCgst: number;
  igstToSgst: number;
  cgstToCgst: number;
  cgstToIgst: number;
  sgstToSgst: number;
  sgstToIgst: number;
}

interface GSTR3BSummary {
  period: string;
  supplierGstin: string;
  supplierName: string;
  summary: {
    totalSalesInvoices: number;
    totalPurchaseInvoices: number;
    totalOutwardTax: number;
    totalItcAvailable: number;
    totalPayableInCash: number;
  };
  section3_1: Section3_1[];
  section4: Section4[];
  section6_1: Section6_1[];
  itcUtilization: ITCUtilization;
}

// Generate period options (last 12 months)
const generatePeriodOptions = () => {
  const options = [];
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear().toString();
    const value = `${month}${year}`;
    const label = format(date, 'MMMM yyyy');
    options.push({ value, label });
  }
  return options;
};

export default function GSTR3BPage() {
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<GSTR3BSummary | null>(null);
  const periodOptions = generatePeriodOptions();

  useEffect(() => {
    if (periodOptions.length > 0 && !selectedPeriod) {
      setSelectedPeriod(periodOptions[0].value);
    }
  }, [periodOptions, selectedPeriod]);

  const loadSummary = async () => {
    if (!selectedPeriod) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/gst/gstr-3b/summary?period=${selectedPeriod}`);
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to load summary');
      }

      setData(result);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load summary');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (selectedPeriod) {
      loadSummary();
    }
  }, [selectedPeriod]);

  const formatAmount = (amount: number) => {
    return amount.toLocaleString('en-IN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">GSTR-3B</h1>
          <p className="text-muted-foreground">
            View tax liability, ITC, and payment summary
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Select value={selectedPeriod} onValueChange={setSelectedPeriod}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select period" />
            </SelectTrigger>
            <SelectContent>
              {periodOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={loadSummary} disabled={isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Sales Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalSalesInvoices || 0}</div>
            <p className="text-xs text-muted-foreground">Finalized invoices</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Output Tax</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ₹{formatAmount(data?.summary.totalOutwardTax || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Tax liability</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Purchase Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalPurchaseInvoices || 0}</div>
            <p className="text-xs text-muted-foreground">ITC eligible</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Input Tax Credit</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              ₹{formatAmount(data?.summary.totalItcAvailable || 0)}
            </div>
            <p className="text-xs text-muted-foreground">Available ITC</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Cash Payable</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              ₹{formatAmount(data?.summary.totalPayableInCash || 0)}
            </div>
            <p className="text-xs text-muted-foreground">After ITC set-off</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="summary">
        <TabsList>
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="outward">3.1 Outward Supplies</TabsTrigger>
          <TabsTrigger value="itc">4. Eligible ITC</TabsTrigger>
          <TabsTrigger value="liability">6.1 Tax Payment</TabsTrigger>
          <TabsTrigger value="setoff">ITC Set-off</TabsTrigger>
        </TabsList>

        <TabsContent value="summary" className="space-y-6">
          {data && data.summary.totalSalesInvoices === 0 && data.summary.totalPurchaseInvoices === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <FileText className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No data for this period</h3>
                <p className="text-muted-foreground text-center max-w-md">
                  There are no finalized invoices for the selected period. Create and finalize invoices to see the GSTR-3B summary.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-6 md:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Tax Liability Summary</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tax Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>CGST</TableCell>
                        <TableCell className="text-right">
                          ₹{formatAmount(data?.section6_1[0]?.cgst || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>SGST</TableCell>
                        <TableCell className="text-right">
                          ₹{formatAmount(data?.section6_1[0]?.sgst || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>IGST</TableCell>
                        <TableCell className="text-right">
                          ₹{formatAmount(data?.section6_1[0]?.igst || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="font-medium">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">
                          ₹{formatAmount(data?.summary.totalOutwardTax || 0)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">ITC Available</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tax Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow>
                        <TableCell>CGST</TableCell>
                        <TableCell className="text-right text-green-600">
                          ₹{formatAmount(data?.section4[7]?.cgst || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>SGST</TableCell>
                        <TableCell className="text-right text-green-600">
                          ₹{formatAmount(data?.section4[7]?.sgst || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell>IGST</TableCell>
                        <TableCell className="text-right text-green-600">
                          ₹{formatAmount(data?.section4[7]?.igst || 0)}
                        </TableCell>
                      </TableRow>
                      <TableRow className="font-medium">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right text-green-600">
                          ₹{formatAmount(data?.summary.totalItcAvailable || 0)}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        <TabsContent value="outward">
          <Card>
            <CardHeader>
              <CardTitle>3.1 Details of Outward Supplies and Inward Supplies Liable to Reverse Charge</CardTitle>
              <CardDescription>
                Nature of supplies and their tax details
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Nature of Supplies</TableHead>
                    <TableHead className="text-right">Taxable Value</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.section3_1.map((row, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="text-sm">{row.description}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.taxableValue)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.cgst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.sgst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.igst)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="itc">
          <Card>
            <CardHeader>
              <CardTitle>4. Eligible ITC</CardTitle>
              <CardDescription>
                Details of ITC available for the tax period
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40%]">Details</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                    <TableHead className="text-right">Cess</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.section4.map((row, idx) => (
                    <TableRow key={idx} className={row.description.startsWith('(') ? '' : 'font-medium'}>
                      <TableCell className="text-sm">{row.description}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.cgst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.sgst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.igst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.cess)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="liability">
          <Card>
            <CardHeader>
              <CardTitle>6.1 Payment of Tax</CardTitle>
              <CardDescription>
                Tax payment details after ITC set-off
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[30%]">Description</TableHead>
                    <TableHead className="text-right">CGST</TableHead>
                    <TableHead className="text-right">SGST</TableHead>
                    <TableHead className="text-right">IGST</TableHead>
                    <TableHead className="text-right">Cess</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data?.section6_1.map((row, idx) => (
                    <TableRow key={idx} className={idx === 2 ? 'font-medium bg-muted/50' : ''}>
                      <TableCell>{row.description}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.cgst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.sgst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.igst)}</TableCell>
                      <TableCell className="text-right">₹{formatAmount(row.cess)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="setoff">
          <Card>
            <CardHeader>
              <CardTitle>ITC Set-off Details</CardTitle>
              <CardDescription>
                How ITC is utilized against tax liability
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data?.itcUtilization && (
                <div className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">IGST ITC Utilization</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            IGST <ArrowRight className="h-3 w-3" /> IGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.igstToIgst)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            IGST <ArrowRight className="h-3 w-3" /> CGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.igstToCgst)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            IGST <ArrowRight className="h-3 w-3" /> SGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.igstToSgst)}</span>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">CGST ITC Utilization</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            CGST <ArrowRight className="h-3 w-3" /> CGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.cgstToCgst)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            CGST <ArrowRight className="h-3 w-3" /> IGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.cgstToIgst)}</span>
                        </div>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm">SGST ITC Utilization</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            SGST <ArrowRight className="h-3 w-3" /> SGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.sgstToSgst)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="flex items-center gap-1">
                            SGST <ArrowRight className="h-3 w-3" /> IGST
                          </span>
                          <span>₹{formatAmount(data.itcUtilization.sgstToIgst)}</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <div className="rounded-lg bg-muted p-4">
                    <h4 className="font-medium mb-2">ITC Set-off Priority</h4>
                    <p className="text-sm text-muted-foreground">
                      As per GST rules, ITC is set off in the following order:
                    </p>
                    <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                      <li>IGST credit is first used against IGST liability, then CGST, then SGST</li>
                      <li>CGST credit is used against CGST liability, then IGST (not SGST)</li>
                      <li>SGST credit is used against SGST liability, then IGST (not CGST)</li>
                    </ul>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
