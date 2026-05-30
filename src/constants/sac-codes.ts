export interface SacCodeData {
  code: string;
  description: string;
  defaultRate: number;
}

// Common SAC codes for service providers
export const COMMON_SAC_CODES: SacCodeData[] = [
  // IT Services
  { code: '998311', description: 'Management consulting services', defaultRate: 18 },
  { code: '998312', description: 'Business consulting services', defaultRate: 18 },
  { code: '998313', description: 'Information technology consulting', defaultRate: 18 },
  { code: '998314', description: 'IT design and development services', defaultRate: 18 },
  { code: '998315', description: 'Hosting and IT infrastructure provisioning', defaultRate: 18 },
  { code: '998316', description: 'IT infrastructure and network management', defaultRate: 18 },
  { code: '998319', description: 'Other IT services', defaultRate: 18 },

  // Legal and Accounting
  { code: '998321', description: 'Legal advisory and representation services', defaultRate: 18 },
  { code: '998322', description: 'Legal documentation and certification', defaultRate: 18 },
  { code: '998331', description: 'Accounting and auditing services', defaultRate: 18 },
  { code: '998332', description: 'Financial statement preparation', defaultRate: 18 },
  { code: '998333', description: 'Tax consultancy and preparation', defaultRate: 18 },

  // Engineering and Technical
  { code: '998341', description: 'Architectural advisory services', defaultRate: 18 },
  { code: '998342', description: 'Urban planning services', defaultRate: 18 },
  { code: '998343', description: 'Landscape architectural advisory', defaultRate: 18 },
  { code: '998351', description: 'Scientific and technical consulting', defaultRate: 18 },
  { code: '998352', description: 'Geological and prospecting services', defaultRate: 18 },

  // Marketing and Research
  { code: '998361', description: 'Advertising services', defaultRate: 18 },
  { code: '998362', description: 'Media planning and buying', defaultRate: 18 },
  { code: '998371', description: 'Market research services', defaultRate: 18 },
  { code: '998372', description: 'Public opinion polling', defaultRate: 18 },

  // Design Services
  { code: '998391', description: 'Specialty design services', defaultRate: 18 },
  { code: '998392', description: 'Interior design services', defaultRate: 18 },
  { code: '998393', description: 'Industrial design services', defaultRate: 18 },
  { code: '998394', description: 'Fashion design services', defaultRate: 18 },
  { code: '998395', description: 'Graphic design services', defaultRate: 18 },

  // HR and Recruitment
  { code: '998511', description: 'Employment placement services', defaultRate: 18 },
  { code: '998512', description: 'Executive search services', defaultRate: 18 },
  { code: '998513', description: 'Temporary staffing services', defaultRate: 18 },
  { code: '998514', description: 'Labour supply services', defaultRate: 18 },

  // Other Business Services
  { code: '998591', description: 'Credit reporting services', defaultRate: 18 },
  { code: '998592', description: 'Collection agency services', defaultRate: 18 },
  { code: '998593', description: 'Telephone answering services', defaultRate: 18 },
  { code: '998594', description: 'Translation and interpretation', defaultRate: 18 },
  { code: '998595', description: 'Document copying services', defaultRate: 18 },
  { code: '998596', description: 'Mailing list compilation', defaultRate: 18 },
  { code: '998599', description: 'Other support services', defaultRate: 18 },

  // Education and Training
  { code: '999211', description: 'Primary education services', defaultRate: 0 },
  { code: '999212', description: 'Secondary education services', defaultRate: 0 },
  { code: '999213', description: 'Higher education services', defaultRate: 0 },
  { code: '999291', description: 'Commercial training services', defaultRate: 18 },
  { code: '999292', description: 'Technical vocational training', defaultRate: 18 },

  // Healthcare (mostly exempt)
  { code: '999311', description: 'Hospital services', defaultRate: 0 },
  { code: '999312', description: 'Medical and dental services', defaultRate: 0 },

  // Hospitality
  { code: '996311', description: 'Room or unit accommodation (tariff <1000)', defaultRate: 0 },
  { code: '996312', description: 'Room or unit accommodation (tariff 1000-7500)', defaultRate: 12 },
  { code: '996313', description: 'Room or unit accommodation (tariff >7500)', defaultRate: 18 },
  { code: '996321', description: 'Food serving services (non-AC restaurants)', defaultRate: 5 },
  { code: '996322', description: 'Food serving services (AC restaurants)', defaultRate: 5 },
  { code: '996331', description: 'Catering services', defaultRate: 18 },

  // Transport
  { code: '996511', description: 'Passenger transport by road (AC)', defaultRate: 5 },
  { code: '996512', description: 'Passenger transport by road (non-AC)', defaultRate: 5 },
  { code: '996521', description: 'Freight transport by road', defaultRate: 5 },

  // Real Estate
  { code: '997211', description: 'Residential property rental', defaultRate: 0 },
  { code: '997212', description: 'Commercial property rental', defaultRate: 18 },
  { code: '997213', description: 'Real estate services on fee basis', defaultRate: 18 },
];

export function getSacCodeByCode(code: string): SacCodeData | undefined {
  return COMMON_SAC_CODES.find((sac) => sac.code === code);
}

export function searchSacCodes(query: string): SacCodeData[] {
  const lowerQuery = query.toLowerCase();
  return COMMON_SAC_CODES.filter(
    (sac) =>
      sac.code.includes(query) ||
      sac.description.toLowerCase().includes(lowerQuery)
  );
}
