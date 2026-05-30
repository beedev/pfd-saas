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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Download, FileSpreadsheet, Loader2, RefreshCw } from 'lucide-react';

interface B2BInvoice {
  customerGstin: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  placeOfSupply: string;
  reverseCharge: string;
  invoiceType: string;
  supplyType: string;
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
}

interface B2CSSummary {
  placeOfSupply: string;
  rate: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  cessAmount: number;
}

interface B2CLInvoice {
  placeOfSupply: string;
  invoiceNumber: string;
  invoiceDate: string;
  invoiceValue: number;
  rate: number;
  taxableValue: number;
  igstAmount: number;
  cessAmount: number;
}

interface SACHSNSummary {
  sacCode: string;
  description: string;
  uqc: string;
  totalQuantity: number;
  totalValue: number;
  taxableValue: number;
  cgstAmount: number;
  sgstAmount: number;
  igstAmount: number;
  cessAmount: number;
}

interface GSTR1Summary {
  period: string;
  supplierGstin: string;
  supplierName: string;
  summary: {
    totalInvoices: number;
    b2bCount: number;
    b2csCount: number;
    b2clCount: number;
    totalTaxableValue: number;
    totalTax: number;
  };
  b2b: B2BInvoice[];
  b2cs: B2CSSummary[];
  b2cl: B2CLInvoice[];
  hsn: SACHSNSummary[];
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

export default function GSTR1Page() {
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [data, setData] = useState<GSTR1Summary | null>(null);
  const periodOptions = generatePeriodOptions();

  useEffect(() => {
    // Set default to current month
    if (periodOptions.length > 0 && !selectedPeriod) {
      setSelectedPeriod(periodOptions[0].value);
    }
  }, [periodOptions, selectedPeriod]);

  const loadSummary = async () => {
    if (!selectedPeriod) return;

    setIsLoading(true);
    try {
      const response = await fetch(`/api/gst/gstr-1/summary?period=${selectedPeriod}`);
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

  // Round to 2 decimal places (GST portal requirement)
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Extract 2-digit state code from "33 - Tamil Nadu" format
  const posCode = (pos: string) => pos.split(' - ')[0].trim().padStart(2, '0');

  // Map supply type to GST portal inv_typ codes
  const getInvTypCode = (supplyType: string): string => {
    switch (supplyType) {
      case 'EXPORT_WITH_IGST': return 'SEWP';
      case 'EXPORT_LUT': return 'SEWOP';
      case 'SEZ': return 'SEWP';
      default: return 'R';
    }
  };

  // UQC format: "NOS-NUMBERS", "NA-NOT APPLICABLE" etc.
  const formatUqc = (uqc: string): string => {
    if (!uqc || uqc === 'OTH' || uqc === 'NA') return 'NA-NOT APPLICABLE';
    if (uqc === 'NOS') return 'NOS-NUMBERS';
    if (uqc === 'KGS') return 'KGS-KILOGRAMS';
    if (uqc === 'MTR') return 'MTR-METERS';
    if (uqc === 'LTR') return 'LTR-LITRES';
    if (uqc === 'SQM') return 'SQM-SQUARE METERS';
    if (uqc === 'PCS') return 'PCS-PIECES';
    if (uqc.includes('-')) return uqc; // already formatted
    return `${uqc}-OTHERS`;
  };

  const groupB2BByGstin = (invoices: B2BInvoice[]) => {
    const grouped = new Map<string, B2BInvoice[]>();
    for (const inv of invoices) {
      const existing = grouped.get(inv.customerGstin) || [];
      existing.push(inv);
      grouped.set(inv.customerGstin, existing);
    }

    return Array.from(grouped.entries()).map(([gstin, invs]) => ({
      ctin: gstin,
      inv: invs.map((inv) => ({
        inum: inv.invoiceNumber,
        idt: format(new Date(inv.invoiceDate), 'dd-MM-yyyy'),
        val: r2(inv.invoiceValue),
        pos: posCode(inv.placeOfSupply),
        rchrg: inv.reverseCharge,
        inv_typ: getInvTypCode(inv.supplyType),
        itms: [
          {
            num: 1,
            itm_det: {
              rt: inv.rate,
              txval: r2(inv.taxableValue),
              iamt: r2(inv.igstAmount),
              camt: r2(inv.cgstAmount),
              samt: r2(inv.sgstAmount),
              csamt: r2(inv.cessAmount),
            },
          },
        ],
      })),
    }));
  };

  const groupB2CLByPos = (invoices: B2CLInvoice[]) => {
    const grouped = new Map<string, B2CLInvoice[]>();
    for (const inv of invoices) {
      const pos = posCode(inv.placeOfSupply);
      const existing = grouped.get(pos) || [];
      existing.push(inv);
      grouped.set(pos, existing);
    }

    return Array.from(grouped.entries()).map(([pos, invs]) => ({
      pos,
      inv: invs.map((inv) => ({
        inum: inv.invoiceNumber,
        idt: format(new Date(inv.invoiceDate), 'dd-MM-yyyy'),
        val: r2(inv.invoiceValue),
        itms: [
          {
            num: 1,
            itm_det: {
              rt: inv.rate,
              txval: r2(inv.taxableValue),
              iamt: r2(inv.igstAmount),
              csamt: r2(inv.cessAmount),
            },
          },
        ],
      })),
    }));
  };

  const exportJSON = () => {
    if (!data) return;

    // Collect ALL invoice numbers for doc_issue (B2B + B2CL + B2CS sources)
    const allInvoiceNumbers = [
      ...data.b2b.map((inv) => inv.invoiceNumber),
      ...data.b2cl.map((inv) => inv.invoiceNumber),
    ].sort();
    const fromNum = allInvoiceNumbers[0] || '';
    const toNum = allInvoiceNumbers[allInvoiceNumbers.length - 1] || '';
    const totalIssued = allInvoiceNumbers.length;

    const exportData: Record<string, unknown> = {
      gstin: data.supplierGstin,
      fp: data.period,
      version: 'GST3.0.4',
      hash: 'hash',
      gt: 0,
      cur_gt: 0,
      b2b: groupB2BByGstin(data.b2b),
      b2cs: data.b2cs.map((item) => {
        const isInter = item.cgstAmount === 0 && item.sgstAmount === 0;
        return {
          sply_ty: isInter ? 'INTER' : 'INTRA',
          pos: posCode(item.placeOfSupply),
          typ: 'OE',
          rt: item.rate,
          txval: r2(item.taxableValue),
          iamt: r2(isInter ? (item.taxableValue * item.rate / 100) : 0),
          camt: r2(item.cgstAmount),
          samt: r2(item.sgstAmount),
          csamt: r2(item.cessAmount),
        };
      }),
      hsn: {
        data: data.hsn
          .filter((item) => item.taxableValue > 0)
          .map((item, idx) => ({
            num: idx + 1,
            hsn_sc: item.sacCode,
            desc: item.description,
            uqc: formatUqc(item.uqc),
            qty: item.totalQuantity || 0,
            rt: item.igstAmount > 0
              ? r2((item.igstAmount / item.taxableValue) * 100)
              : item.cgstAmount > 0
                ? r2((item.cgstAmount + item.sgstAmount) / item.taxableValue * 100)
                : 0,
            val: r2(item.totalValue),
            txval: r2(item.taxableValue),
            iamt: r2(item.igstAmount),
            camt: r2(item.cgstAmount),
            samt: r2(item.sgstAmount),
            csamt: r2(item.cessAmount),
          })),
      },
      doc_issue: {
        doc_det: [
          {
            doc_num: 1,
            docs: totalIssued > 0
              ? [{
                  num: 1,
                  from: fromNum,
                  to: toNum,
                  totnum: totalIssued,
                  cancel: 0,
                  net_issue: totalIssued,
                }]
              : [],
          },
        ],
      },
    };

    // Only include b2cl if there are B2C large invoices
    if (data.b2cl.length > 0) {
      exportData.b2cl = groupB2CLByPos(data.b2cl);
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `GSTR1_${data.period}.json`;
    a.click();
    window.URL.revokeObjectURL(url);

    toast.success('GSTR-1 JSON exported successfully');
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">GSTR-1</h1>
          <p className="text-muted-foreground">
            Prepare and export your outward supplies return
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
          <Button onClick={exportJSON} disabled={!data || data.summary.totalInvoices === 0}>
            <Download className="mr-2 h-4 w-4" />
            Export JSON
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.summary.totalInvoices || 0}</div>
            <p className="text-xs text-muted-foreground">For {selectedPeriod}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">B2B Invoices</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.b2b.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              ₹{formatAmount(data?.b2b.reduce((s, i) => s + i.taxableValue, 0) || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">B2C Small</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.b2cs.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              ₹{formatAmount(data?.b2cs.reduce((s, i) => s + i.taxableValue, 0) || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">B2C Large</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{data?.b2cl.length || 0}</div>
            <p className="text-xs text-muted-foreground">
              ₹{formatAmount(data?.b2cl.reduce((s, i) => s + i.taxableValue, 0) || 0)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Total Tax</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">
              ₹{formatAmount(data?.summary.totalTax || 0)}
            </div>
            <p className="text-xs text-muted-foreground">CGST + SGST + IGST</p>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Sections */}
      {data && data.summary.totalInvoices > 0 && (
        <Accordion type="multiple" className="space-y-4">
          {/* B2B Invoices */}
          {data.b2b.length > 0 && (
            <AccordionItem value="b2b" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-4">
                  <span className="font-semibold">B2B Invoices</span>
                  <span className="text-sm text-muted-foreground">
                    ({data.b2b.length} entries)
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>GSTIN</TableHead>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Place of Supply</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Taxable Value</TableHead>
                      <TableHead className="text-right">IGST/CGST+SGST</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.b2b.map((inv, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono text-xs">{inv.customerGstin}</TableCell>
                        <TableCell>{inv.invoiceNumber}</TableCell>
                        <TableCell>{format(new Date(inv.invoiceDate), 'dd MMM yyyy')}</TableCell>
                        <TableCell>{inv.placeOfSupply}</TableCell>
                        <TableCell className="text-right">{inv.rate}%</TableCell>
                        <TableCell className="text-right">₹{formatAmount(inv.taxableValue)}</TableCell>
                        <TableCell className="text-right">
                          {inv.igstAmount > 0 ? (
                            `₹${formatAmount(inv.igstAmount)}`
                          ) : (
                            `₹${formatAmount(inv.cgstAmount + inv.sgstAmount)}`
                          )}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          ₹{formatAmount(inv.invoiceValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* B2CS Summary */}
          {data.b2cs.length > 0 && (
            <AccordionItem value="b2cs" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-4">
                  <span className="font-semibold">B2C Small (Summary)</span>
                  <span className="text-sm text-muted-foreground">
                    ({data.b2cs.length} entries)
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Place of Supply</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Taxable Value</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.b2cs.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{item.placeOfSupply}</TableCell>
                        <TableCell className="text-right">{item.rate}%</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.taxableValue)}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.cgstAmount)}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.sgstAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* B2CL Invoices */}
          {data.b2cl.length > 0 && (
            <AccordionItem value="b2cl" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-4">
                  <span className="font-semibold">B2C Large (Interstate &gt; ₹2.5L)</span>
                  <span className="text-sm text-muted-foreground">
                    ({data.b2cl.length} entries)
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice #</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Place of Supply</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Taxable Value</TableHead>
                      <TableHead className="text-right">IGST</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.b2cl.map((inv, idx) => (
                      <TableRow key={idx}>
                        <TableCell>{inv.invoiceNumber}</TableCell>
                        <TableCell>{format(new Date(inv.invoiceDate), 'dd MMM yyyy')}</TableCell>
                        <TableCell>{inv.placeOfSupply}</TableCell>
                        <TableCell className="text-right">{inv.rate}%</TableCell>
                        <TableCell className="text-right">₹{formatAmount(inv.taxableValue)}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(inv.igstAmount)}</TableCell>
                        <TableCell className="text-right font-medium">
                          ₹{formatAmount(inv.invoiceValue)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          )}

          {/* HSN/SAC Summary */}
          {data.hsn.length > 0 && (
            <AccordionItem value="hsn" className="border rounded-lg px-4">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-4">
                  <FileSpreadsheet className="h-4 w-4" />
                  <span className="font-semibold">SAC/HSN Summary</span>
                  <span className="text-sm text-muted-foreground">
                    ({data.hsn.length} codes)
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>SAC Code</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Taxable Value</TableHead>
                      <TableHead className="text-right">CGST</TableHead>
                      <TableHead className="text-right">SGST</TableHead>
                      <TableHead className="text-right">IGST</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.hsn.map((item, idx) => (
                      <TableRow key={idx}>
                        <TableCell className="font-mono">{item.sacCode}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{item.description}</TableCell>
                        <TableCell className="text-right">{item.totalQuantity}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.taxableValue)}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.cgstAmount)}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.sgstAmount)}</TableCell>
                        <TableCell className="text-right">₹{formatAmount(item.igstAmount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </AccordionContent>
            </AccordionItem>
          )}
        </Accordion>
      )}

      {/* Empty State */}
      {data && data.summary.totalInvoices === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileSpreadsheet className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No invoices for this period</h3>
            <p className="text-muted-foreground text-center max-w-md">
              There are no finalized invoices for the selected period. Create invoices and mark them as &quot;Final&quot; to include them in GSTR-1.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
