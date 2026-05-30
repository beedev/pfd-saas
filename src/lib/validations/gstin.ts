import { isValidStateCode } from '@/constants/state-codes';

// GSTIN Format: 2-digit state code + 10-char PAN + 1-digit entity + 'Z' + 1-char checksum
// Example: 29AABCU9603R1ZM

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;

// Character set for checksum calculation
const CHECKSUM_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export interface GSTINValidationResult {
  isValid: boolean;
  stateCode: string | null;
  pan: string | null;
  entityCode: string | null;
  checkDigit: string | null;
  error: string | null;
}

/**
 * Validates a GSTIN and returns detailed information
 */
export function validateGSTIN(gstin: string): GSTINValidationResult {
  if (!gstin) {
    return {
      isValid: false,
      stateCode: null,
      pan: null,
      entityCode: null,
      checkDigit: null,
      error: 'GSTIN is required',
    };
  }

  const upperGstin = gstin.toUpperCase().trim();

  if (upperGstin.length !== 15) {
    return {
      isValid: false,
      stateCode: null,
      pan: null,
      entityCode: null,
      checkDigit: null,
      error: 'GSTIN must be exactly 15 characters',
    };
  }

  if (!GSTIN_REGEX.test(upperGstin)) {
    return {
      isValid: false,
      stateCode: null,
      pan: null,
      entityCode: null,
      checkDigit: null,
      error: 'Invalid GSTIN format',
    };
  }

  const stateCode = upperGstin.substring(0, 2);
  const pan = upperGstin.substring(2, 12);
  const entityCode = upperGstin.substring(12, 13);
  const checkDigit = upperGstin.substring(14, 15);

  // Validate state code (01-38 are valid)
  if (!isValidStateCode(stateCode)) {
    return {
      isValid: false,
      stateCode,
      pan,
      entityCode,
      checkDigit,
      error: 'Invalid state code in GSTIN',
    };
  }

  // Validate PAN format
  if (!PAN_REGEX.test(pan)) {
    return {
      isValid: false,
      stateCode,
      pan,
      entityCode,
      checkDigit,
      error: 'Invalid PAN in GSTIN',
    };
  }

  // Validate checksum
  const calculatedCheckDigit = calculateGSTINChecksum(upperGstin.substring(0, 14));
  if (calculatedCheckDigit !== checkDigit) {
    return {
      isValid: false,
      stateCode,
      pan,
      entityCode,
      checkDigit,
      error: 'Invalid GSTIN checksum',
    };
  }

  return {
    isValid: true,
    stateCode,
    pan,
    entityCode,
    checkDigit,
    error: null,
  };
}

/**
 * Calculates the checksum digit for a 14-character GSTIN prefix
 */
function calculateGSTINChecksum(gstinPrefix: string): string {
  let sum = 0;

  for (let i = 0; i < 14; i++) {
    const char = gstinPrefix[i];
    const value = CHECKSUM_CHARS.indexOf(char);
    const factor = i % 2 === 0 ? 1 : 2;
    const product = value * factor;
    sum += Math.floor(product / 36) + (product % 36);
  }

  const remainder = sum % 36;
  const checkDigit = CHECKSUM_CHARS[(36 - remainder) % 36];

  return checkDigit;
}

/**
 * Extracts state code from GSTIN
 */
export function extractStateCode(gstin: string): string | null {
  if (!gstin || gstin.length < 2) return null;
  const stateCode = gstin.substring(0, 2);
  return isValidStateCode(stateCode) ? stateCode : null;
}

/**
 * Extracts PAN from GSTIN
 */
export function extractPAN(gstin: string): string | null {
  if (!gstin || gstin.length < 12) return null;
  const pan = gstin.substring(2, 12).toUpperCase();
  return PAN_REGEX.test(pan) ? pan : null;
}

/**
 * Quick check if GSTIN format is valid (without checksum verification)
 */
export function isGSTINFormat(gstin: string): boolean {
  if (!gstin) return false;
  return GSTIN_REGEX.test(gstin.toUpperCase().trim());
}

/**
 * Validates PAN format
 */
export function validatePAN(pan: string): { isValid: boolean; error: string | null } {
  if (!pan) {
    return { isValid: false, error: 'PAN is required' };
  }

  const upperPan = pan.toUpperCase().trim();

  if (upperPan.length !== 10) {
    return { isValid: false, error: 'PAN must be exactly 10 characters' };
  }

  if (!PAN_REGEX.test(upperPan)) {
    return { isValid: false, error: 'Invalid PAN format' };
  }

  return { isValid: true, error: null };
}

/**
 * Gets the entity type from GSTIN
 * Entity type is derived from the 4th character of PAN (position 5 in GSTIN)
 *
 * GSTIN Format: SS + PAN(10) + N + Z + C
 * - SS: State code (2 digits)
 * - PAN: 10 characters (4th char indicates entity type)
 * - N: Registration number (1-9, then A-Z)
 * - Z: Reserved character (always Z)
 * - C: Check digit
 *
 * PAN 4th character meanings:
 * P - Individual/Person
 * C - Company
 * H - Hindu Undivided Family (HUF)
 * F - Firm (Partnership)
 * A - Association of Persons (AOP)
 * T - Trust
 * B - Body of Individuals (BOI)
 * L - Local Authority
 * J - Artificial Juridical Person
 * G - Government
 */
export function getEntityType(gstin: string): string | null {
  if (!gstin || gstin.length < 15) return null;

  // 4th character of PAN is at position 5 (index 4) in GSTIN
  const entityCode = gstin.charAt(5).toUpperCase();

  const entityTypes: Record<string, string> = {
    'P': 'Individual/Proprietorship',
    'C': 'Company',
    'H': 'HUF',
    'F': 'Partnership Firm',
    'A': 'Association of Persons',
    'T': 'Trust',
    'B': 'Body of Individuals',
    'L': 'Local Authority',
    'J': 'Artificial Juridical Person',
    'G': 'Government',
  };

  return entityTypes[entityCode] || 'Unknown';
}
