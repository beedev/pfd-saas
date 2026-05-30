import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';

// Database connection
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'personal-finance.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite, { schema });

// Helper to convert rupees to paisa
const rupeesToPaisa = (rupees: number) => Math.round(rupees * 100);

async function seed() {
  console.log('🌱 Seeding database...\n');

  // Clear existing data
  console.log('Clearing existing data...');
  sqlite.exec('DELETE FROM invoice_items');
  sqlite.exec('DELETE FROM invoices');
  sqlite.exec('DELETE FROM purchase_invoices');
  sqlite.exec('DELETE FROM customers');
  sqlite.exec('DELETE FROM vendors');
  sqlite.exec('DELETE FROM sac_codes');
  sqlite.exec('DELETE FROM business_profile');
  sqlite.exec('DELETE FROM tax_payments');

  // 1. Seed Business Profile
  console.log('Creating business profile...');
  await db.insert(schema.businessProfile).values({
    businessName: 'Bharath Consulting Services',
    tradeName: 'Bharath Consulting',
    gstin: '29AABPB1234F1ZM',  // P = Individual, 1 = first registration, Z = default, M = checksum
    pan: 'AABPB1234F',
    stateCode: '29',
    address: '123, Tech Park, Electronic City',
    city: 'Bangalore',
    pincode: '560100',
    email: 'bharath@consulting.in',
    phone: '9876543210',
    financialYear: '2024-25',
    invoicePrefix: 'BCS-',
    invoiceStartNumber: 1,
  });

  // 2. Seed SAC Codes
  console.log('Creating SAC codes...');
  const sacCodes = [
    { code: '998311', description: 'Management consulting services', defaultTaxRate: 18 },
    { code: '998312', description: 'Business consulting services', defaultTaxRate: 18 },
    { code: '998313', description: 'IT consulting services', defaultTaxRate: 18 },
    { code: '998314', description: 'IT design and development services', defaultTaxRate: 18 },
    { code: '998315', description: 'Hosting and IT infrastructure services', defaultTaxRate: 18 },
    { code: '998316', description: 'IT infrastructure management services', defaultTaxRate: 18 },
    { code: '998319', description: 'Other IT services', defaultTaxRate: 18 },
    { code: '998331', description: 'Accounting and auditing services', defaultTaxRate: 18 },
    { code: '998332', description: 'Bookkeeping services', defaultTaxRate: 18 },
    { code: '998333', description: 'Tax consultancy and preparation services', defaultTaxRate: 18 },
    { code: '998511', description: 'Software licensing services', defaultTaxRate: 18 },
    { code: '998512', description: 'Software download services', defaultTaxRate: 18 },
  ];

  for (const sac of sacCodes) {
    await db.insert(schema.sacCodes).values(sac);
  }

  // 3. Seed Customers (mix of B2B and B2C)
  console.log('Creating customers...');
  const customersData = [
    // B2B Customers (with GSTIN) - Same state (Karnataka)
    // GSTIN format: SS(2) + PAN(10) + REG(1) + Z + CHECK
    // PAN 4th char: C=Company, P=Person, H=HUF, F=Firm
    {
      name: 'Infosys Limited',
      gstin: '29AAACI1681G1ZS',  // C at position 5 = Company
      pan: 'AAACI1681G',
      stateCode: '29',
      address: 'Electronics City, Hosur Road',
      city: 'Bangalore',
      pincode: '560100',
      email: 'vendor@infosys.com',
      phone: '8012345678',
      isB2B: true,
    },
    {
      name: 'Wipro Technologies',
      gstin: '29AABCW0447G1ZP',  // C at position 5 = Company
      pan: 'AABCW0447G',
      stateCode: '29',
      address: 'Sarjapur Road',
      city: 'Bangalore',
      pincode: '560035',
      email: 'accounts@wipro.com',
      phone: '8023456789',
      isB2B: true,
    },
    // B2B Customers - Different state (Maharashtra - Inter-state)
    {
      name: 'TCS Mumbai',
      gstin: '27AAACT2727Q1ZV',  // C at position 5 = Company
      pan: 'AAACT2727Q',
      stateCode: '27',
      address: 'TCS House, Ravindra Annexe',
      city: 'Mumbai',
      pincode: '400001',
      email: 'billing@tcs.com',
      phone: '9012345678',
      isB2B: true,
    },
    {
      name: 'Reliance Digital',
      gstin: '27AABCR6421L1ZQ',  // C at position 5 = Company
      pan: 'AABCR6421L',
      stateCode: '27',
      address: 'Maker Chambers IV, Nariman Point',
      city: 'Mumbai',
      pincode: '400021',
      email: 'vendor@reliance.com',
      phone: '9123456789',
      isB2B: true,
    },
    // B2B Customer - Tamil Nadu (Inter-state)
    {
      name: 'HCL Technologies Chennai',
      gstin: '33AAACH6013K1ZA',  // C at position 5 = Company
      pan: 'AAACH6013K',
      stateCode: '33',
      address: 'HCL Avenue, Sholinganallur',
      city: 'Chennai',
      pincode: '600119',
      email: 'accounts@hcl.com',
      phone: '9234567890',
      isB2B: true,
    },
    // B2C Customers (without GSTIN)
    {
      name: 'Rahul Sharma',
      gstin: null,
      pan: null,
      stateCode: '29',
      address: 'HSR Layout',
      city: 'Bangalore',
      pincode: '560102',
      email: 'rahul.sharma@gmail.com',
      phone: '9345678901',
      isB2B: false,
    },
    {
      name: 'Priya Patel',
      gstin: null,
      pan: null,
      stateCode: '29',
      address: 'Koramangala',
      city: 'Bangalore',
      pincode: '560034',
      email: 'priya.patel@gmail.com',
      phone: '9456789012',
      isB2B: false,
    },
  ];

  const customerIds: number[] = [];
  for (const customer of customersData) {
    const result = await db.insert(schema.customers).values(customer).returning({ id: schema.customers.id });
    customerIds.push(result[0].id);
  }

  // 4. Seed Vendors
  console.log('Creating vendors...');
  const vendorsData = [
    {
      name: 'Amazon Web Services India',
      gstin: '29AAACN1234M1ZQ',  // C at position 5 = Company
      pan: 'AACN1234M',
      stateCode: '29',
      address: 'World Trade Center',
      city: 'Bangalore',
      pincode: '560001',
      email: 'billing@aws.amazon.com',
      phone: '1800123456',
    },
    {
      name: 'Microsoft India',
      gstin: '27AAACM5678K1ZP',  // C at position 5 = Company
      pan: 'AAACM5678K',
      stateCode: '27',
      address: 'DLF Building, Cyber City',
      city: 'Gurgaon',
      pincode: '122002',
      email: 'invoice@microsoft.com',
      phone: '1800789456',
    },
    {
      name: 'Google India Pvt Ltd',
      gstin: '29AAACG9012N1ZR',  // C at position 5 = Company
      pan: 'AAACG9012N',
      stateCode: '29',
      address: 'RMZ Infinity',
      city: 'Bangalore',
      pincode: '560016',
      email: 'billing@google.com',
      phone: '1800567890',
    },
  ];

  const vendorIds: number[] = [];
  for (const vendor of vendorsData) {
    const result = await db.insert(schema.vendors).values(vendor).returning({ id: schema.vendors.id });
    vendorIds.push(result[0].id);
  }

  // 5. Seed Invoices
  console.log('Creating invoices...');
  const currentDate = new Date();
  const currentMonth = (currentDate.getMonth() + 1).toString().padStart(2, '0');
  const currentYear = currentDate.getFullYear();
  const returnPeriod = currentMonth + currentYear.toString();

  // Invoice helper function
  const createInvoice = async (
    invoiceNumber: string,
    customerId: number,
    customerName: string,
    customerGstin: string | null,
    customerStateCode: string,
    items: Array<{ description: string; sacCode: string; quantity: number; unitPrice: number; taxRate: number }>,
    daysAgo: number
  ) => {
    const invoiceDate = new Date();
    invoiceDate.setDate(invoiceDate.getDate() - daysAgo);

    const isInterState = customerStateCode !== '29';
    let totalTaxable = 0;
    let totalCgst = 0;
    let totalSgst = 0;
    let totalIgst = 0;

    for (const item of items) {
      const taxable = item.quantity * item.unitPrice;
      totalTaxable += taxable;
      if (isInterState) {
        totalIgst += (taxable * item.taxRate) / 100;
      } else {
        totalCgst += (taxable * item.taxRate) / 200;
        totalSgst += (taxable * item.taxRate) / 200;
      }
    }

    const totalAmount = totalTaxable + totalCgst + totalSgst + totalIgst;
    const invoiceType = customerGstin ? 'B2B' : 'B2C';

    const invoiceResult = await db.insert(schema.invoices).values({
      invoiceNumber,
      invoiceDate: invoiceDate.toISOString(),
      customerId,
      customerName,
      customerGstin,
      invoiceType: invoiceType as 'B2B' | 'B2C',
      placeOfSupplyCode: customerStateCode,
      isInterState,
      isReverseCharge: false,
      taxableAmount: rupeesToPaisa(totalTaxable),
      cgstAmount: rupeesToPaisa(totalCgst),
      sgstAmount: rupeesToPaisa(totalSgst),
      igstAmount: rupeesToPaisa(totalIgst),
      cessAmount: 0,
      totalAmount: rupeesToPaisa(totalAmount),
      returnPeriod,
      status: 'FINAL',
    }).returning({ id: schema.invoices.id });

    for (const item of items) {
      const taxable = item.quantity * item.unitPrice;
      const cgst = isInterState ? 0 : (taxable * item.taxRate) / 200;
      const sgst = isInterState ? 0 : (taxable * item.taxRate) / 200;
      const igst = isInterState ? (taxable * item.taxRate) / 100 : 0;
      const total = taxable + cgst + sgst + igst;

      await db.insert(schema.invoiceItems).values({
        invoiceId: invoiceResult[0].id,
        description: item.description,
        sacCode: item.sacCode,
        quantity: item.quantity,
        unitPrice: rupeesToPaisa(item.unitPrice),
        discount: 0,
        taxableAmount: rupeesToPaisa(taxable),
        taxRate: item.taxRate,
        cgstRate: isInterState ? 0 : item.taxRate / 2,
        cgstAmount: rupeesToPaisa(cgst),
        sgstRate: isInterState ? 0 : item.taxRate / 2,
        sgstAmount: rupeesToPaisa(sgst),
        igstRate: isInterState ? item.taxRate : 0,
        igstAmount: rupeesToPaisa(igst),
        totalAmount: rupeesToPaisa(total),
      });
    }

    return invoiceResult[0].id;
  };

  // Create sample invoices
  await createInvoice('BCS-0001', customerIds[0], 'Infosys Limited', '29AAACI1681G1ZS', '29', [
    { description: 'Software Development Services - Phase 1', sacCode: '998314', quantity: 1, unitPrice: 150000, taxRate: 18 },
    { description: 'Cloud Infrastructure Setup', sacCode: '998315', quantity: 1, unitPrice: 50000, taxRate: 18 },
  ], 25);

  await createInvoice('BCS-0002', customerIds[1], 'Wipro Technologies', '29AABCW0447G1ZP', '29', [
    { description: 'IT Consulting Services - Monthly', sacCode: '998313', quantity: 1, unitPrice: 200000, taxRate: 18 },
  ], 20);

  await createInvoice('BCS-0003', customerIds[2], 'TCS Mumbai', '27AAACT2727Q1ZV', '27', [
    { description: 'API Development Services', sacCode: '998314', quantity: 1, unitPrice: 300000, taxRate: 18 },
    { description: 'Technical Documentation', sacCode: '998319', quantity: 1, unitPrice: 25000, taxRate: 18 },
  ], 15);

  await createInvoice('BCS-0004', customerIds[3], 'Reliance Digital', '27AABCR6421L1ZQ', '27', [
    { description: 'E-commerce Platform Development', sacCode: '998314', quantity: 1, unitPrice: 500000, taxRate: 18 },
  ], 10);

  await createInvoice('BCS-0005', customerIds[4], 'HCL Technologies Chennai', '33AAACH6013K1ZA', '33', [
    { description: 'Data Analytics Services', sacCode: '998314', quantity: 1, unitPrice: 175000, taxRate: 18 },
    { description: 'Machine Learning Model Development', sacCode: '998314', quantity: 1, unitPrice: 225000, taxRate: 18 },
  ], 8);

  await createInvoice('BCS-0006', customerIds[5], 'Rahul Sharma', null, '29', [
    { description: 'Website Development - Personal Portfolio', sacCode: '998314', quantity: 1, unitPrice: 35000, taxRate: 18 },
  ], 5);

  await createInvoice('BCS-0007', customerIds[6], 'Priya Patel', null, '29', [
    { description: 'Mobile App Development - Basic', sacCode: '998314', quantity: 1, unitPrice: 75000, taxRate: 18 },
  ], 3);

  // 6. Seed Purchase Invoices (for ITC)
  console.log('Creating purchase invoices...');

  const purchaseInvoicesData = [
    {
      vendorId: vendorIds[0],
      vendorName: 'Amazon Web Services India',
      vendorGstin: '29AAACN1234M1ZQ',
      invoiceNumber: 'AWS-2024-001234',
      invoiceDate: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000).toISOString(),
      placeOfSupplyCode: '29',
      isInterState: false,
      isReverseCharge: false,
      taxableAmount: rupeesToPaisa(45000),
      cgstAmount: rupeesToPaisa(4050),
      sgstAmount: rupeesToPaisa(4050),
      igstAmount: 0,
      cessAmount: 0,
      totalAmount: rupeesToPaisa(53100),
      itcEligible: true,
      itcClaimed: false,
      returnPeriod,
    },
    {
      vendorId: vendorIds[1],
      vendorName: 'Microsoft India',
      vendorGstin: '27AAACM5678K1ZP',
      invoiceNumber: 'MS-INV-78945',
      invoiceDate: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
      placeOfSupplyCode: '29',
      isInterState: true,
      isReverseCharge: false,
      taxableAmount: rupeesToPaisa(85000),
      cgstAmount: 0,
      sgstAmount: 0,
      igstAmount: rupeesToPaisa(15300),
      cessAmount: 0,
      totalAmount: rupeesToPaisa(100300),
      itcEligible: true,
      itcClaimed: false,
      returnPeriod,
    },
    {
      vendorId: vendorIds[2],
      vendorName: 'Google India Pvt Ltd',
      vendorGstin: '29AAACG9012N1ZR',
      invoiceNumber: 'GOOG-2024-56789',
      invoiceDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString(),
      placeOfSupplyCode: '29',
      isInterState: false,
      isReverseCharge: false,
      taxableAmount: rupeesToPaisa(120000),
      cgstAmount: rupeesToPaisa(10800),
      sgstAmount: rupeesToPaisa(10800),
      igstAmount: 0,
      cessAmount: 0,
      totalAmount: rupeesToPaisa(141600),
      itcEligible: true,
      itcClaimed: false,
      returnPeriod,
    },
  ];

  for (const purchase of purchaseInvoicesData) {
    await db.insert(schema.purchaseInvoices).values(purchase);
  }

  console.log('\n✅ Seeding complete!\n');
  console.log('Summary:');
  console.log('  - 1 Business profile');
  console.log('  - ' + sacCodes.length + ' SAC codes');
  console.log('  - ' + customersData.length + ' Customers (' + customersData.filter(c => c.isB2B).length + ' B2B, ' + customersData.filter(c => !c.isB2B).length + ' B2C)');
  console.log('  - ' + vendorsData.length + ' Vendors');
  console.log('  - 7 Sales invoices');
  console.log('  - ' + purchaseInvoicesData.length + ' Purchase invoices');
  console.log('\nReturn period: ' + returnPeriod);

  sqlite.close();
}

seed().catch((error) => {
  console.error('Seeding failed:', error);
  process.exit(1);
});
