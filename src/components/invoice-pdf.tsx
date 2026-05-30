'use client';

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
} from '@react-pdf/renderer';
import { paisaToRupees } from '@/lib/calculations/tax';

// Register fonts (using default for now)
Font.register({
  family: 'Roboto',
  fonts: [
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-regular-webfont.ttf', fontWeight: 'normal' },
    { src: 'https://cdnjs.cloudflare.com/ajax/libs/ink/3.1.10/fonts/Roboto/roboto-bold-webfont.ttf', fontWeight: 'bold' },
  ],
});

const styles = StyleSheet.create({
  page: {
    padding: 25,
    fontSize: 8,
    fontFamily: 'Roboto',
  },
  header: {
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    paddingBottom: 6,
  },
  title: {
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 7,
    textAlign: 'center',
    color: '#666',
  },
  row: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  col: {
    flex: 1,
  },
  label: {
    fontWeight: 'bold',
    marginRight: 4,
  },
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 'bold',
    backgroundColor: '#f0f0f0',
    padding: 3,
    marginBottom: 4,
  },
  table: {
    marginTop: 6,
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#333',
    color: '#fff',
    padding: 4,
    fontWeight: 'bold',
    fontSize: 7,
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    padding: 4,
    fontSize: 7,
  },
  tableRowAlt: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    padding: 4,
    fontSize: 7,
    backgroundColor: '#f9f9f9',
  },
  cellSno: { width: '4%' },
  cellDesc: { width: '32%' },
  cellSac: { width: '10%' },
  cellQty: { width: '6%', textAlign: 'right' },
  cellRate: { width: '12%', textAlign: 'right' },
  cellTaxable: { width: '12%', textAlign: 'right' },
  cellTax: { width: '10%', textAlign: 'right' },
  cellTotal: { width: '14%', textAlign: 'right' },
  totalsSection: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#333',
    paddingTop: 6,
  },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginBottom: 2,
  },
  totalLabel: {
    width: 120,
    textAlign: 'right',
    paddingRight: 8,
  },
  totalValue: {
    width: 80,
    textAlign: 'right',
    fontWeight: 'bold',
  },
  grandTotal: {
    fontSize: 9,
    fontWeight: 'bold',
    backgroundColor: '#333',
    color: '#fff',
    padding: 4,
  },
  amountInWords: {
    marginTop: 6,
    padding: 6,
    backgroundColor: '#f5f5f5',
    fontSize: 7,
  },
  footer: {
    marginTop: 8,
    textAlign: 'center',
    color: '#666',
    fontSize: 7,
    borderTopWidth: 1,
    borderTopColor: '#ddd',
    paddingTop: 6,
  },
  signature: {
    marginTop: 15,
    textAlign: 'right',
    fontSize: 8,
  },
  signatureLine: {
    marginTop: 20,
    borderTopWidth: 1,
    borderTopColor: '#333',
    width: 120,
    marginLeft: 'auto',
  },
  notesSection: {
    marginTop: 6,
    padding: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  notesTitle: {
    fontWeight: 'bold',
    marginBottom: 2,
    fontSize: 8,
  },
  notesText: {
    fontSize: 7,
    color: '#333',
    lineHeight: 1.3,
  },
  declarationSection: {
    marginTop: 6,
    padding: 6,
    backgroundColor: '#fff8dc',
    borderWidth: 1,
    borderColor: '#daa520',
  },
  declarationTitle: {
    fontWeight: 'bold',
    marginBottom: 2,
    fontSize: 8,
    color: '#8b4513',
  },
  declarationText: {
    fontSize: 7,
    color: '#333',
    lineHeight: 1.3,
  },
  infoText: {
    fontSize: 8,
    marginBottom: 1,
  },
  infoTextSmall: {
    fontSize: 7,
    marginBottom: 1,
  },
});

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

type SupplyType = 'REGULAR' | 'EXPORT_WITH_IGST' | 'EXPORT_LUT' | 'SEZ';

// Supply type declarations for invoices
const SUPPLY_TYPE_DECLARATIONS: Record<SupplyType, string | null> = {
  REGULAR: null,
  EXPORT_WITH_IGST: 'SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER LETTER OF UNDERTAKING WITH PAYMENT OF INTEGRATED TAX',
  EXPORT_LUT: 'SUPPLY MEANT FOR EXPORT/SUPPLY TO SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX',
  SEZ: 'SUPPLY MEANT FOR SEZ UNIT OR SEZ DEVELOPER FOR AUTHORISED OPERATIONS',
};

interface InvoiceData {
  invoice: {
    id: number;
    invoiceNumber: string;
    invoiceDate: string;
    customerName: string;
    customerGstin: string | null;
    invoiceType: string;
    placeOfSupplyCode: string;
    isInterState: boolean;
    supplyType?: SupplyType;
    taxableAmount: number;
    cgstAmount: number;
    sgstAmount: number;
    igstAmount: number;
    cessAmount: number;
    totalAmount: number;
    notes?: string | null;
  };
  items: InvoiceItem[];
  business: {
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
  };
  customer: {
    name: string;
    gstin: string | null;
    address: string | null;
    city: string | null;
    stateCode: string;
    pincode: string | null;
  } | null;
}

// Number to words converter
function numberToWords(num: number): string {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';

  function convertLessThanThousand(n: number): string {
    if (n === 0) return '';
    if (n < 20) return ones[n];
    if (n < 100) return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
    return ones[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + convertLessThanThousand(n % 100) : '');
  }

  function convert(n: number): string {
    if (n < 1000) return convertLessThanThousand(n);
    if (n < 100000) return convertLessThanThousand(Math.floor(n / 1000)) + ' Thousand' + (n % 1000 ? ' ' + convertLessThanThousand(n % 1000) : '');
    if (n < 10000000) return convertLessThanThousand(Math.floor(n / 100000)) + ' Lakh' + (n % 100000 ? ' ' + convert(n % 100000) : '');
    return convertLessThanThousand(Math.floor(n / 10000000)) + ' Crore' + (n % 10000000 ? ' ' + convert(n % 10000000) : '');
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  let result = 'Rupees ' + convert(rupees);
  if (paise > 0) {
    result += ' and ' + convert(paise) + ' Paise';
  }
  result += ' Only';

  return result;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function formatCurrency(paisa: number): string {
  return '₹' + paisaToRupees(paisa).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function InvoicePDF({ data }: { data: InvoiceData }) {
  const { invoice, items, business, customer } = data;
  const totalInRupees = paisaToRupees(invoice.totalAmount);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>TAX INVOICE</Text>
          <Text style={styles.subtitle}>
            (Under Section 31 of CGST Act, 2017 read with Rule 46 of CGST Rules, 2017)
          </Text>
        </View>

        {/* Business & Invoice Info - Side by Side */}
        <View style={styles.row}>
          {/* Supplier Details */}
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Supplier Details</Text>
            <Text style={{ fontWeight: 'bold', fontSize: 10, marginBottom: 2 }}>
              {business.businessName}
            </Text>
            {business.tradeName && (
              <Text style={styles.infoTextSmall}>Trade: {business.tradeName}</Text>
            )}
            <Text style={styles.infoTextSmall}>GSTIN: {business.gstin}</Text>
            <Text style={styles.infoTextSmall}>PAN: {business.pan}</Text>
            {business.address && <Text style={styles.infoTextSmall}>{business.address}</Text>}
            <Text style={styles.infoTextSmall}>
              {business.city}{business.pincode ? ` - ${business.pincode}` : ''}
            </Text>
          </View>

          {/* Invoice Details */}
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Invoice Details</Text>
            <View style={styles.row}>
              <Text style={styles.label}>Invoice No:</Text>
              <Text style={{ fontWeight: 'bold' }}>{invoice.invoiceNumber}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Date:</Text>
              <Text>{formatDate(invoice.invoiceDate)}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Place of Supply:</Text>
              <Text>{invoice.placeOfSupplyCode}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.label}>Type:</Text>
              <Text>{invoice.isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)'}</Text>
            </View>
          </View>

          {/* Bill To */}
          <View style={styles.col}>
            <Text style={styles.sectionTitle}>Bill To</Text>
            <Text style={{ fontWeight: 'bold', fontSize: 9, marginBottom: 2 }}>
              {invoice.customerName}
            </Text>
            {invoice.customerGstin && (
              <Text style={styles.infoTextSmall}>GSTIN: {invoice.customerGstin}</Text>
            )}
            {customer?.address && <Text style={styles.infoTextSmall}>{customer.address}</Text>}
            {customer && (
              <Text style={styles.infoTextSmall}>
                {customer.city}{customer.pincode ? ` - ${customer.pincode}` : ''}
              </Text>
            )}
          </View>
        </View>

        {/* Items Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellSno}>#</Text>
            <Text style={styles.cellDesc}>Description</Text>
            <Text style={styles.cellSac}>SAC</Text>
            <Text style={styles.cellQty}>Qty</Text>
            <Text style={styles.cellRate}>Rate</Text>
            <Text style={styles.cellTaxable}>Taxable</Text>
            <Text style={styles.cellTax}>Tax</Text>
            <Text style={styles.cellTotal}>Total</Text>
          </View>

          {items.map((item, index) => (
            <View key={item.id} style={index % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={styles.cellSno}>{index + 1}</Text>
              <Text style={styles.cellDesc}>{item.description}</Text>
              <Text style={styles.cellSac}>{item.sacCode}</Text>
              <Text style={styles.cellQty}>{item.quantity}</Text>
              <Text style={styles.cellRate}>{formatCurrency(item.unitPrice)}</Text>
              <Text style={styles.cellTaxable}>{formatCurrency(item.taxableAmount)}</Text>
              <Text style={styles.cellTax}>{item.taxRate}%</Text>
              <Text style={styles.cellTotal}>{formatCurrency(item.totalAmount)}</Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totalsSection}>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Taxable Amount:</Text>
            <Text style={styles.totalValue}>{formatCurrency(invoice.taxableAmount)}</Text>
          </View>

          {!invoice.isInterState ? (
            <>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>CGST:</Text>
                <Text style={styles.totalValue}>{formatCurrency(invoice.cgstAmount)}</Text>
              </View>
              <View style={styles.totalRow}>
                <Text style={styles.totalLabel}>SGST:</Text>
                <Text style={styles.totalValue}>{formatCurrency(invoice.sgstAmount)}</Text>
              </View>
            </>
          ) : (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>IGST:</Text>
              <Text style={styles.totalValue}>{formatCurrency(invoice.igstAmount)}</Text>
            </View>
          )}

          <View style={[styles.totalRow, styles.grandTotal]}>
            <Text style={[styles.totalLabel, { color: '#fff' }]}>Grand Total:</Text>
            <Text style={[styles.totalValue, { color: '#fff' }]}>{formatCurrency(invoice.totalAmount)}</Text>
          </View>
        </View>

        {/* Amount in Words */}
        <View style={styles.amountInWords}>
          <Text><Text style={styles.label}>Amount in Words: </Text>{numberToWords(totalInRupees)}</Text>
        </View>

        {/* Supply Type Declaration */}
        {invoice.supplyType && invoice.supplyType !== 'REGULAR' && SUPPLY_TYPE_DECLARATIONS[invoice.supplyType] && (
          <View style={styles.declarationSection}>
            <Text style={styles.declarationTitle}>Declaration:</Text>
            <Text style={styles.declarationText}>{SUPPLY_TYPE_DECLARATIONS[invoice.supplyType]}</Text>
          </View>
        )}

        {/* Notes/Terms */}
        {invoice.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.notesTitle}>Terms & Conditions / Notes:</Text>
            <Text style={styles.notesText}>{invoice.notes}</Text>
          </View>
        )}

        {/* Signature and Footer in a row */}
        <View style={{ flexDirection: 'row', marginTop: 15 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 7, color: '#666' }}>This is a computer generated invoice</Text>
          </View>
          <View style={{ flex: 1, alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 8 }}>For {business.businessName}</Text>
            <View style={styles.signatureLine} />
            <Text style={{ fontSize: 7, marginTop: 3 }}>Authorized Signatory</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export type { InvoiceData };
