/**
 * Seed script for financial tracking data.
 * Run with: npx tsx src/db/seed-finance.ts
 */

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';
import path from 'path';

// Database connection
const dbPath = process.env.DATABASE_PATH || path.join(process.cwd(), 'personal-finance.db');
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
const db = drizzle(sqlite, { schema });

// Helper: convert rupees to paisa
const toPaisa = (rupees: number) => Math.round(rupees * 100);

async function seedFinanceData() {
  console.log('Seeding financial data...');

  // =========================================================================
  // 1. BUDGET CATEGORIES (from Excel Budget sheet)
  // =========================================================================
  console.log('Creating budget categories...');

  const budgetCategoryData: Array<{
    name: string;
    type: 'INCOME' | 'EXPENSE';
    sortOrder: number;
  }> = [
    { name: 'Salary', type: 'INCOME', sortOrder: 1 },
    { name: 'RD (PF)', type: 'EXPENSE', sortOrder: 2 },
    { name: 'SIP', type: 'EXPENSE', sortOrder: 3 },
    { name: 'SMSF', type: 'EXPENSE', sortOrder: 4 },
    { name: 'Chit', type: 'EXPENSE', sortOrder: 5 },
    { name: 'ICICI', type: 'EXPENSE', sortOrder: 6 },
    { name: 'Axis', type: 'EXPENSE', sortOrder: 7 },
    { name: 'HDFC', type: 'EXPENSE', sortOrder: 8 },
    { name: 'Nanditha', type: 'EXPENSE', sortOrder: 9 },
    { name: 'Father', type: 'EXPENSE', sortOrder: 10 },
    { name: 'Pachu/Vasantha', type: 'EXPENSE', sortOrder: 11 },
    { name: 'Misc', type: 'EXPENSE', sortOrder: 12 },
  ];

  const insertedCategories = await db.insert(schema.budgetCategories)
    .values(budgetCategoryData)
    .returning();

  const categoryMap = new Map(insertedCategories.map(c => [c.name, c.id]));
  console.log(`Created ${insertedCategories.length} budget categories`);

  // =========================================================================
  // 2. BUDGET ENTRIES (from Excel Budget sheet - Oct 2025 to May 2026)
  // =========================================================================
  console.log('Creating budget entries...');

  // Budget data from Excel (values in rupees)
  // Format: { period: MMYYYY, category: name, planned: amount, actual: amount }
  const budgetData = [
    // October 2025
    { period: '102025', category: 'Salary', planned: 367000, actual: 367000 },
    { period: '102025', category: 'RD (PF)', planned: 38000, actual: 38000 },
    { period: '102025', category: 'SIP', planned: 36000, actual: 36000 },
    { period: '102025', category: 'SMSF', planned: 5000, actual: 5000 },
    { period: '102025', category: 'Chit', planned: 42000, actual: 42000 },
    { period: '102025', category: 'ICICI', planned: 114000, actual: 114000 },
    { period: '102025', category: 'Axis', planned: 35000, actual: 35000 },
    { period: '102025', category: 'HDFC', planned: 12000, actual: 12000 },
    { period: '102025', category: 'Nanditha', planned: 42000, actual: 42000 },
    { period: '102025', category: 'Father', planned: 15000, actual: 15000 },
    { period: '102025', category: 'Pachu/Vasantha', planned: 10000, actual: 10000 },
    { period: '102025', category: 'Misc', planned: 10000, actual: 10000 },

    // November 2025
    { period: '112025', category: 'Salary', planned: 367000, actual: 367000 },
    { period: '112025', category: 'RD (PF)', planned: 40000, actual: 40000 },
    { period: '112025', category: 'SIP', planned: 36000, actual: 36000 },
    { period: '112025', category: 'SMSF', planned: 5000, actual: 5000 },
    { period: '112025', category: 'Chit', planned: 42000, actual: 42000 },
    { period: '112025', category: 'ICICI', planned: 135000, actual: 135000 },
    { period: '112025', category: 'Axis', planned: 14000, actual: 14000 },
    { period: '112025', category: 'HDFC', planned: 10000, actual: 10000 },
    { period: '112025', category: 'Nanditha', planned: 42000, actual: 42000 },
    { period: '112025', category: 'Father', planned: 15000, actual: 15000 },
    { period: '112025', category: 'Pachu/Vasantha', planned: 4500, actual: 4500 },
    { period: '112025', category: 'Misc', planned: 10000, actual: 10000 },

    // December 2025
    { period: '122025', category: 'Salary', planned: 363831, actual: 0 },
    { period: '122025', category: 'RD (PF)', planned: 60000, actual: 0 },
    { period: '122025', category: 'SIP', planned: 36000, actual: 0 },
    { period: '122025', category: 'SMSF', planned: 5000, actual: 0 },
    { period: '122025', category: 'Chit', planned: 44000, actual: 0 },
    { period: '122025', category: 'ICICI', planned: 148500, actual: 0 },
    { period: '122025', category: 'Axis', planned: 34000, actual: 0 },
    { period: '122025', category: 'HDFC', planned: 48110, actual: 0 },
    { period: '122025', category: 'Nanditha', planned: 50000, actual: 0 },
    { period: '122025', category: 'Father', planned: 25000, actual: 0 },
    { period: '122025', category: 'Pachu/Vasantha', planned: 4500, actual: 0 },
    { period: '122025', category: 'Misc', planned: 0, actual: 0 },

    // January 2026
    { period: '012026', category: 'Salary', planned: 363831, actual: 0 },
    { period: '012026', category: 'RD (PF)', planned: 50000, actual: 0 },
    { period: '012026', category: 'SIP', planned: 36000, actual: 0 },
    { period: '012026', category: 'SMSF', planned: 5000, actual: 0 },
    { period: '012026', category: 'Chit', planned: 44000, actual: 0 },
    { period: '012026', category: 'ICICI', planned: 100000, actual: 0 },
    { period: '012026', category: 'Axis', planned: 0, actual: 0 },
    { period: '012026', category: 'HDFC', planned: 0, actual: 0 },
    { period: '012026', category: 'Nanditha', planned: 50000, actual: 0 },
    { period: '012026', category: 'Father', planned: 25000, actual: 0 },
    { period: '012026', category: 'Pachu/Vasantha', planned: 10000, actual: 0 },
    { period: '012026', category: 'Misc', planned: 10000, actual: 0 },

    // February 2026
    { period: '022026', category: 'Salary', planned: 363831, actual: 0 },
    { period: '022026', category: 'RD (PF)', planned: 50000, actual: 0 },
    { period: '022026', category: 'SIP', planned: 36000, actual: 0 },
    { period: '022026', category: 'SMSF', planned: 5000, actual: 0 },
    { period: '022026', category: 'Chit', planned: 44000, actual: 0 },
    { period: '022026', category: 'ICICI', planned: 100000, actual: 0 },
    { period: '022026', category: 'Axis', planned: 0, actual: 0 },
    { period: '022026', category: 'HDFC', planned: 0, actual: 0 },
    { period: '022026', category: 'Nanditha', planned: 50000, actual: 0 },
    { period: '022026', category: 'Father', planned: 25000, actual: 0 },
    { period: '022026', category: 'Pachu/Vasantha', planned: 10000, actual: 0 },
    { period: '022026', category: 'Misc', planned: 10000, actual: 0 },

    // March 2026
    { period: '032026', category: 'Salary', planned: 363831, actual: 0 },
    { period: '032026', category: 'RD (PF)', planned: 60000, actual: 0 },
    { period: '032026', category: 'SIP', planned: 50000, actual: 0 },
    { period: '032026', category: 'SMSF', planned: 5000, actual: 0 },
    { period: '032026', category: 'Chit', planned: 42000, actual: 0 },
    { period: '032026', category: 'ICICI', planned: 100000, actual: 0 },
    { period: '032026', category: 'Axis', planned: 10000, actual: 0 },
    { period: '032026', category: 'HDFC', planned: 10000, actual: 0 },
    { period: '032026', category: 'Nanditha', planned: 42000, actual: 0 },
    { period: '032026', category: 'Father', planned: 15000, actual: 0 },
    { period: '032026', category: 'Pachu/Vasantha', planned: 10000, actual: 0 },
    { period: '032026', category: 'Misc', planned: 10000, actual: 0 },

    // April 2026
    { period: '042026', category: 'Salary', planned: 367000, actual: 0 },
    { period: '042026', category: 'RD (PF)', planned: 60000, actual: 0 },
    { period: '042026', category: 'SIP', planned: 50000, actual: 0 },
    { period: '042026', category: 'SMSF', planned: 5000, actual: 0 },
    { period: '042026', category: 'Chit', planned: 42000, actual: 0 },
    { period: '042026', category: 'ICICI', planned: 100000, actual: 0 },
    { period: '042026', category: 'Axis', planned: 10000, actual: 0 },
    { period: '042026', category: 'HDFC', planned: 10000, actual: 0 },
    { period: '042026', category: 'Nanditha', planned: 42000, actual: 0 },
    { period: '042026', category: 'Father', planned: 15000, actual: 0 },
    { period: '042026', category: 'Pachu/Vasantha', planned: 10000, actual: 0 },
    { period: '042026', category: 'Misc', planned: 10000, actual: 0 },

    // May 2026
    { period: '052026', category: 'Salary', planned: 367000, actual: 0 },
    { period: '052026', category: 'RD (PF)', planned: 60000, actual: 0 },
    { period: '052026', category: 'SIP', planned: 50000, actual: 0 },
    { period: '052026', category: 'SMSF', planned: 5000, actual: 0 },
    { period: '052026', category: 'Chit', planned: 42000, actual: 0 },
    { period: '052026', category: 'ICICI', planned: 100000, actual: 0 },
    { period: '052026', category: 'Axis', planned: 10000, actual: 0 },
    { period: '052026', category: 'HDFC', planned: 10000, actual: 0 },
    { period: '052026', category: 'Nanditha', planned: 42000, actual: 0 },
    { period: '052026', category: 'Father', planned: 15000, actual: 0 },
    { period: '052026', category: 'Pachu/Vasantha', planned: 10000, actual: 0 },
    { period: '052026', category: 'Misc', planned: 10000, actual: 0 },
  ];

  const budgetEntryValues = budgetData.map(entry => ({
    categoryId: categoryMap.get(entry.category)!,
    period: entry.period,
    plannedAmount: toPaisa(entry.planned),
    actualAmount: toPaisa(entry.actual),
  }));

  await db.insert(schema.budgetEntries).values(budgetEntryValues);
  console.log(`Created ${budgetEntryValues.length} budget entries`);

  // =========================================================================
  // 3. FINANCIAL GOALS (from Excel Three year projections)
  // =========================================================================
  console.log('Creating financial goals...');

  const goalsData = [
    { name: 'SIP Corpus', targetAmount: toPaisa(5000000), targetDate: '2028-08-31', color: '#4CAF50' },
    { name: 'Marriage Fund', targetAmount: toPaisa(6700000), targetDate: '2028-01-31', color: '#E91E63' },
    { name: 'Pilot Training', targetAmount: toPaisa(10000000), targetDate: '2028-08-31', color: '#2196F3' },
    { name: 'Emergency Fund', targetAmount: toPaisa(1000000), targetDate: null, color: '#FF9800' },
    { name: 'Gratuity', targetAmount: toPaisa(1700000), targetDate: null, color: '#9C27B0' },
  ];

  const insertedGoals = await db.insert(schema.financialGoals)
    .values(goalsData)
    .returning();

  const goalMap = new Map(insertedGoals.map(g => [g.name, g.id]));
  console.log(`Created ${insertedGoals.length} financial goals`);

  // =========================================================================
  // 4. PROJECTION CATEGORIES (columns in 3-year projection grid)
  // =========================================================================
  console.log('Creating projection categories...');

  const projectionCategoryData = [
    { name: 'SIP', isInflow: true, goalId: goalMap.get('SIP Corpus'), sortOrder: 1 },
    { name: 'RD', isInflow: true, goalId: null, sortOrder: 2 },
    { name: 'Car Loan', isInflow: false, goalId: null, sortOrder: 3 },
    { name: 'Chit', isInflow: true, goalId: null, sortOrder: 4 },  // Can be inflow (maturity) or outflow
    { name: 'LIC Inflow', isInflow: true, goalId: null, sortOrder: 5 },
    { name: 'Gratuity', isInflow: true, goalId: goalMap.get('Gratuity'), sortOrder: 6 },
    { name: 'Pilot Loan', isInflow: false, goalId: goalMap.get('Pilot Training'), sortOrder: 7 },
    { name: 'Marriage', isInflow: false, goalId: goalMap.get('Marriage Fund'), sortOrder: 8 },
    { name: 'Pilot', isInflow: false, goalId: goalMap.get('Pilot Training'), sortOrder: 9 },
    { name: 'Emergency', isInflow: false, goalId: goalMap.get('Emergency Fund'), sortOrder: 10 },
  ];

  const insertedProjCategories = await db.insert(schema.projectionCategories)
    .values(projectionCategoryData)
    .returning();

  const projCategoryMap = new Map(insertedProjCategories.map(c => [c.name, c.id]));
  console.log(`Created ${insertedProjCategories.length} projection categories`);

  // =========================================================================
  // 5. CARRYFORWARD BALANCES (opening balances from Excel)
  // =========================================================================
  console.log('Creating carryforward balances...');

  const carryforwardData = [
    { categoryId: projCategoryMap.get('SIP')!, amount: toPaisa(5000000), asOfDate: '2025-09-01' },
    { categoryId: projCategoryMap.get('Gratuity')!, amount: toPaisa(1700000), asOfDate: '2025-09-01' },
    { categoryId: projCategoryMap.get('Marriage')!, amount: toPaisa(6700000), asOfDate: '2025-09-01' },
    { categoryId: projCategoryMap.get('Pilot')!, amount: toPaisa(10000000), asOfDate: '2025-09-01' },
    { categoryId: projCategoryMap.get('Emergency')!, amount: toPaisa(1000000), asOfDate: '2025-09-01' },
  ];

  await db.insert(schema.carryforwardBalances).values(carryforwardData);
  console.log(`Created ${carryforwardData.length} carryforward balances`);

  // =========================================================================
  // 6. PROJECTION ENTRIES (monthly data from Excel Three year projections)
  // =========================================================================
  console.log('Creating projection entries...');

  // Generate projection entries from Sep 2025 to Aug 2028 (36 months)
  const projectionEntryData: Array<{
    categoryId: number;
    period: string;
    amount: number;
    notes?: string;
  }> = [];

  // Helper to add entry
  const addProjection = (category: string, period: string, rupees: number, notes?: string) => {
    const catId = projCategoryMap.get(category);
    if (catId && rupees > 0) {
      projectionEntryData.push({
        categoryId: catId,
        period,
        amount: toPaisa(rupees),
        notes,
      });
    }
  };

  // Sep 2025 - Marriage (Gold purchase)
  addProjection('Marriage', '092025', 1700000, 'Gold purchase');

  // Oct 2025 - Aug 2028: Regular monthly entries
  // SIP: 36K monthly
  // RD: 40K Oct, 50K Nov-Dec, 60K from Jan onwards
  // From Jan 2027: Car Loan 70K
  // From Mar 2027: Chit maturity 20L, then 50K monthly
  // Jan 2028: LIC Inflow 15L
  // Various Pilot payments

  const months = [
    '102025', '112025', '122025', '012026', '022026', '032026', '042026', '052026',
    '062026', '072026', '082026', '092026', '102026', '112026', '122026',
    '012027', '022027', '032027', '042027', '052027', '062027', '072027', '082027', '092027', '102027', '112027', '122027',
    '012028', '022028', '032028', '042028', '052028', '062028', '072028', '082028'
  ];

  months.forEach(period => {
    // SIP - 36K monthly throughout
    addProjection('SIP', period, 36000);

    // RD - varies
    const rdAmount = period === '102025' ? 40000 :
                     ['112025', '122025'].includes(period) ? 50000 : 60000;
    addProjection('RD', period, rdAmount);

    // Car Loan - 70K from Jan 2027
    if (period >= '012027') {
      addProjection('Car Loan', period, 70000);
    }

    // Chit - 20L in Mar 2027 (maturity), then 50K monthly
    if (period === '032027') {
      addProjection('Chit', period, 2000000, 'Chit maturity');
    } else if (period >= '042027') {
      addProjection('Chit', period, 50000);
    }
  });

  // LIC Inflow - 15L in Jan 2028
  addProjection('LIC Inflow', '012028', 1500000);

  // Pilot Loan from Pachu - 20L in Jan 2028
  addProjection('Pilot Loan', '012028', 2000000);

  // Marriage expense - 50L in Jan 2028
  addProjection('Marriage', '012028', 5000000, 'Marriage Hall 10L + Food 20L + Gifts 10L + Misc 10L');

  // Pilot payments - 25L each in Nov 2026, Apr 2027, Oct 2027, Apr 2028
  addProjection('Pilot', '112026', 2500000);
  addProjection('Pilot', '042027', 2500000);
  addProjection('Pilot', '102027', 2500000);
  addProjection('Pilot', '042028', 2500000);

  await db.insert(schema.projectionEntries).values(projectionEntryData);
  console.log(`Created ${projectionEntryData.length} projection entries`);

  console.log('\nFinancial data seeding complete!');
  console.log('Summary:');
  console.log(`  - ${insertedCategories.length} budget categories`);
  console.log(`  - ${budgetEntryValues.length} budget entries`);
  console.log(`  - ${insertedGoals.length} financial goals`);
  console.log(`  - ${insertedProjCategories.length} projection categories`);
  console.log(`  - ${carryforwardData.length} carryforward balances`);
  console.log(`  - ${projectionEntryData.length} projection entries`);
}

// Run seed
seedFinanceData()
  .then(() => {
    console.log('Done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Seed failed:', error);
    process.exit(1);
  });
