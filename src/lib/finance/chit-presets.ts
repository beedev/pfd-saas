// Preset foreman (chit fund operator) options for the Add Chit Fund dropdown.
// These are pre-seeded in the form's foreman dropdown for quick selection.
// "Other" lets the user enter any other name freehand.

export interface ChitForeman {
  key: string;
  name: string;
  headquarters: string;
  foundedYear?: number;
  note?: string;
}

export const CHIT_FOREMEN: ChitForeman[] = [
  {
    key: 'dnc',
    name: 'DNC Chits',
    headquarters: 'Chennai, Tamil Nadu',
    note: 'One of the oldest registered chit fund operators in South India',
  },
  {
    key: 'dhanalakshmi',
    name: 'Dhanalakshmi Chits',
    headquarters: 'Tamil Nadu',
    note: 'Tamil Nadu-based registered chit fund company',
  },
  {
    key: 'shriram',
    name: 'Shriram Chits',
    headquarters: 'Chennai, Tamil Nadu',
    foundedYear: 1974,
  },
  {
    key: 'margadarsi',
    name: 'Margadarsi Chit Fund',
    headquarters: 'Hyderabad, Telangana',
    foundedYear: 1962,
  },
  {
    key: 'ksfe',
    name: 'KSFE (Kerala State Financial Enterprises)',
    headquarters: 'Thrissur, Kerala',
    foundedYear: 1969,
    note: 'Kerala government owned chit fund',
  },
  {
    key: 'kapil',
    name: 'Kapil Chits',
    headquarters: 'Hyderabad, Telangana',
  },
  {
    key: 'mysore',
    name: 'Mysore Sales International / Mysore Chits',
    headquarters: 'Karnataka',
  },
  {
    key: 'other',
    name: 'Other',
    headquarters: '',
    note: 'Unregistered or any other operator — enter name manually',
  },
];
