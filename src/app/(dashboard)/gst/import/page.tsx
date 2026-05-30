'use client';

import { useState, useRef } from 'react';
import { toast } from 'sonner';
import Papa from 'papaparse';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { Badge } from '@/components/ui/badge';
import { Upload, FileSpreadsheet, Check, X, Loader2, Download } from 'lucide-react';

interface CsvRow {
  [key: string]: string;
}

interface MappedRow {
  invoiceNumber: string;
  invoiceDate: string;
  customerName: string;
  customerGstin?: string;
  customerStateCode: string;
  placeOfSupply: string;
  description: string;
  sacCode: string;
  quantity?: number;
  unitPrice: number;
  taxRate: number;
}

interface ImportResult {
  success: boolean;
  invoiceNumber: string;
  error?: string;
}

const REQUIRED_FIELDS = [
  { key: 'invoiceNumber', label: 'Invoice Number', required: true },
  { key: 'invoiceDate', label: 'Invoice Date', required: true },
  { key: 'customerName', label: 'Customer Name', required: true },
  { key: 'customerGstin', label: 'Customer GSTIN', required: false },
  { key: 'customerStateCode', label: 'Customer State Code', required: false },
  { key: 'placeOfSupply', label: 'Place of Supply', required: true },
  { key: 'description', label: 'Description', required: true },
  { key: 'sacCode', label: 'SAC Code', required: true },
  { key: 'quantity', label: 'Quantity', required: false },
  { key: 'unitPrice', label: 'Unit Price', required: true },
  { key: 'taxRate', label: 'Tax Rate (%)', required: true },
];

export default function ImportPage() {
  const [csvData, setCsvData] = useState<CsvRow[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<Record<string, string>>({});
  const [isImporting, setIsImporting] = useState(false);
  const [importResults, setImportResults] = useState<ImportResult[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data as CsvRow[];
        if (data.length === 0) {
          toast.error('No data found in CSV');
          return;
        }

        const csvHeaders = Object.keys(data[0]);
        setCsvData(data);
        setHeaders(csvHeaders);
        setImportResults(null);

        // Auto-map fields based on header names
        const autoMapping: Record<string, string> = {};
        for (const field of REQUIRED_FIELDS) {
          const matchingHeader = csvHeaders.find((h) => {
            const normalizedHeader = h.toLowerCase().replace(/[_\s-]/g, '');
            const normalizedKey = field.key.toLowerCase();
            const normalizedLabel = field.label.toLowerCase().replace(/[_\s-]/g, '');
            return (
              normalizedHeader === normalizedKey ||
              normalizedHeader === normalizedLabel ||
              normalizedHeader.includes(normalizedKey) ||
              normalizedHeader.includes(normalizedLabel)
            );
          });
          if (matchingHeader) {
            autoMapping[field.key] = matchingHeader;
          }
        }
        setFieldMapping(autoMapping);

        toast.success(`Loaded ${data.length} rows from CSV`);
      },
      error: (error) => {
        toast.error(`Failed to parse CSV: ${error.message}`);
      },
    });
  };

  const handleMappingChange = (fieldKey: string, headerValue: string) => {
    setFieldMapping((prev) => ({
      ...prev,
      [fieldKey]: headerValue === 'none' ? '' : headerValue,
    }));
  };

  const getMappedData = (): MappedRow[] => {
    return csvData.map((row) => ({
      invoiceNumber: row[fieldMapping.invoiceNumber] || '',
      invoiceDate: row[fieldMapping.invoiceDate] || '',
      customerName: row[fieldMapping.customerName] || '',
      customerGstin: row[fieldMapping.customerGstin] || undefined,
      customerStateCode: row[fieldMapping.customerStateCode] || '',
      placeOfSupply: row[fieldMapping.placeOfSupply] || '',
      description: row[fieldMapping.description] || '',
      sacCode: row[fieldMapping.sacCode] || '',
      quantity: fieldMapping.quantity ? parseFloat(row[fieldMapping.quantity]) || 1 : 1,
      unitPrice: parseFloat(row[fieldMapping.unitPrice]) || 0,
      taxRate: parseFloat(row[fieldMapping.taxRate]) || 18,
    }));
  };

  const validateMapping = (): boolean => {
    const requiredFields = REQUIRED_FIELDS.filter((f) => f.required);
    for (const field of requiredFields) {
      if (!fieldMapping[field.key]) {
        toast.error(`Please map the required field: ${field.label}`);
        return false;
      }
    }
    return true;
  };

  const handleImport = async () => {
    if (!validateMapping()) return;

    setIsImporting(true);
    try {
      const mappedData = getMappedData();

      const response = await fetch('/api/gst/invoices/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: mappedData }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Import failed');
      }

      setImportResults(result.results);

      if (result.successCount > 0) {
        toast.success(`Successfully imported ${result.successCount} invoices`);
      }
      if (result.failCount > 0) {
        toast.error(`${result.failCount} invoices failed to import`);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to import');
    } finally {
      setIsImporting(false);
    }
  };

  const downloadSampleCsv = () => {
    const sampleData = [
      {
        invoice_number: 'INV-001',
        invoice_date: '01-04-2024',
        customer_name: 'ABC Company',
        customer_gstin: '29ABCDE1234F1Z5',
        customer_state_code: '29',
        place_of_supply: '29',
        description: 'IT Consulting Services',
        sac_code: '998313',
        quantity: '1',
        unit_price: '50000',
        tax_rate: '18',
      },
      {
        invoice_number: 'INV-002',
        invoice_date: '05-04-2024',
        customer_name: 'XYZ Corp',
        customer_gstin: '27XYZAB5678G1Z3',
        customer_state_code: '27',
        place_of_supply: '27',
        description: 'Software Development',
        sac_code: '998314',
        quantity: '1',
        unit_price: '100000',
        tax_rate: '18',
      },
    ];

    const csv = Papa.unparse(sampleData);
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sample_invoices.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Import Invoices</h1>
        <p className="text-muted-foreground">
          Import invoices from CSV file for bulk data entry
        </p>
      </div>

      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle>Upload CSV</CardTitle>
          <CardDescription>
            Upload a CSV file containing invoice data. Download the sample to see the expected format.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <Input
              type="file"
              accept=".csv"
              ref={fileInputRef}
              onChange={handleFileUpload}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" />
              Choose File
            </Button>
            <Button variant="secondary" onClick={downloadSampleCsv}>
              <Download className="mr-2 h-4 w-4" />
              Download Sample
            </Button>
          </div>

          {headers.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <FileSpreadsheet className="h-4 w-4" />
              <span>{csvData.length} rows loaded with {headers.length} columns</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Field Mapping */}
      {headers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Field Mapping</CardTitle>
            <CardDescription>
              Map your CSV columns to the required fields. Required fields are marked with *.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {REQUIRED_FIELDS.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label>
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </Label>
                  <Select
                    value={fieldMapping[field.key] || 'none'}
                    onValueChange={(value) => handleMappingChange(field.key, value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select column" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">-- Not mapped --</SelectItem>
                      {headers.map((header) => (
                        <SelectItem key={header} value={header}>
                          {header}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-4">
              <Button onClick={handleImport} disabled={isImporting}>
                {isImporting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import Invoices
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setCsvData([]);
                  setHeaders([]);
                  setFieldMapping({});
                  setImportResults(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              >
                Clear
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {csvData.length > 0 && !importResults && (
        <Card>
          <CardHeader>
            <CardTitle>Data Preview</CardTitle>
            <CardDescription>
              Showing first 5 rows of mapped data
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Place of Supply</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>SAC</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Tax</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getMappedData().slice(0, 5).map((row, index) => (
                    <TableRow key={index}>
                      <TableCell className="font-medium">{row.invoiceNumber || '-'}</TableCell>
                      <TableCell>{row.invoiceDate || '-'}</TableCell>
                      <TableCell>
                        <div>{row.customerName || '-'}</div>
                        {row.customerGstin && (
                          <div className="text-xs text-muted-foreground font-mono">
                            {row.customerGstin}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{row.placeOfSupply || '-'}</TableCell>
                      <TableCell className="max-w-[200px] truncate">
                        {row.description || '-'}
                      </TableCell>
                      <TableCell className="font-mono">{row.sacCode || '-'}</TableCell>
                      <TableCell className="text-right">
                        {row.unitPrice ? `₹${(row.unitPrice * (row.quantity || 1)).toLocaleString('en-IN')}` : '-'}
                      </TableCell>
                      <TableCell className="text-right">{row.taxRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Import Results */}
      {importResults && (
        <Card>
          <CardHeader>
            <CardTitle>Import Results</CardTitle>
            <CardDescription>
              {importResults.filter((r) => r.success).length} succeeded,{' '}
              {importResults.filter((r) => !r.success).length} failed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {importResults.map((result, index) => (
                <div
                  key={index}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    result.success ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {result.success ? (
                      <Check className="h-5 w-5 text-green-600" />
                    ) : (
                      <X className="h-5 w-5 text-red-600" />
                    )}
                    <span className="font-medium">{result.invoiceNumber}</span>
                  </div>
                  {result.error && (
                    <Badge variant="destructive">{result.error}</Badge>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help Section */}
      <Card>
        <CardHeader>
          <CardTitle>CSV Format Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="font-medium mb-2">Required Fields</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Invoice Number - Unique identifier</li>
                <li>Invoice Date - DD-MM-YYYY or YYYY-MM-DD</li>
                <li>Customer Name - Customer&apos;s legal name</li>
                <li>Place of Supply - 2-digit state code (e.g., 29 for Karnataka)</li>
                <li>Description - Service description</li>
                <li>SAC Code - 6-digit service code</li>
                <li>Unit Price - Amount in rupees</li>
                <li>Tax Rate - 0, 5, 12, 18, or 28</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Optional Fields</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Customer GSTIN - Required for B2B invoices</li>
                <li>Customer State Code - Defaults to Place of Supply</li>
                <li>Quantity - Defaults to 1</li>
              </ul>
              <h4 className="font-medium mt-4 mb-2">Notes</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>Multiple rows with same invoice number are treated as line items</li>
                <li>Tax is auto-calculated based on interstate/intrastate</li>
                <li>Existing customers are matched by GSTIN</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
