/**
 * Drug catalog — DCGI-approved medications used by the GLP-1 metabolic
 * health program.
 *
 * Stone rule #8: store BOTH generic_name and brand_name. Print BOTH on
 * the prescription PDF. NEVER compounded GLP-1s.
 *
 * Stone rule (CLAUDE.md ADR-001): branded/DCGI-generic only — Novo
 * Nordisk v. Hims & Hers (Feb 9, 2026, US Patent 8,129,343) precedent
 * avoidance. The legal firewall is in the catalog itself.
 *
 * The drug catalog ships in code (not a DB table) because:
 *   - Changes are rare and require physician review
 *   - Reviewing a PR on the catalog is the audit trail
 *   - DB-backed catalog would let an admin silently add compounded
 *     formulations, which is exactly what we are guarding against
 */

export type DoseUnit = 'mg' | 'mcg' | 'IU' | 'mL';
export type Route = 'subcutaneous' | 'oral' | 'intramuscular';
export type Frequency = 'once_weekly' | 'once_daily' | 'twice_daily' | 'as_needed';
export type DrugClass = 'glp1_agonist' | 'biguanide' | 'sglt2_inhibitor' | 'statin' | 'other';

export interface DrugBrand {
  brandName: string;
  manufacturer: string;
  /** DCGI / CDSCO approval reference if known */
  dcgiApprovalRef?: string;
}

export interface DrugFormulation {
  id: string;
  genericName: string;
  drugClass: DrugClass;
  route: Route;
  /** Available strengths in the package leaflet. */
  strengths: Array<{ value: number; unit: DoseUnit }>;
  defaultFrequency: Frequency;
  /** Brands available in India — at least one DCGI-approved entry. */
  brands: DrugBrand[];
  /**
   * Reference titration ladder (NOT auto-prescribed; informs UI only).
   * For each step: dose value + unit + duration before titrating up.
   */
  titration?: Array<{ value: number; unit: DoseUnit; durationWeeks: number }>;
  /** Schedule H = ℞-only in India, mandatory warning text. */
  scheduleH: boolean;
}

export const drugCatalog: ReadonlyArray<DrugFormulation> = Object.freeze([
  // -----------------------------------------------------------------
  // GLP-1 receptor agonists — DCGI-approved (no compounded items)
  // -----------------------------------------------------------------
  {
    id: 'semaglutide-sc',
    genericName: 'semaglutide',
    drugClass: 'glp1_agonist',
    route: 'subcutaneous',
    strengths: [
      { value: 0.25, unit: 'mg' },
      { value: 0.5,  unit: 'mg' },
      { value: 1.0,  unit: 'mg' },
      { value: 1.7,  unit: 'mg' },
      { value: 2.4,  unit: 'mg' }
    ],
    defaultFrequency: 'once_weekly',
    brands: [
      { brandName: 'Obeda', manufacturer: "Dr. Reddy's Laboratories" },
      { brandName: 'Sematrinity', manufacturer: 'Sun Pharmaceutical Industries' }
    ],
    titration: [
      { value: 0.25, unit: 'mg', durationWeeks: 4 },
      { value: 0.5,  unit: 'mg', durationWeeks: 4 },
      { value: 1.0,  unit: 'mg', durationWeeks: 4 },
      { value: 1.7,  unit: 'mg', durationWeeks: 4 },
      { value: 2.4,  unit: 'mg', durationWeeks: 999 }
    ],
    scheduleH: true
  },
  {
    id: 'semaglutide-oral',
    genericName: 'semaglutide (oral)',
    drugClass: 'glp1_agonist',
    route: 'oral',
    strengths: [
      { value: 3,  unit: 'mg' },
      { value: 7,  unit: 'mg' },
      { value: 14, unit: 'mg' }
    ],
    defaultFrequency: 'once_daily',
    brands: [{ brandName: 'Rybelsus', manufacturer: 'Novo Nordisk' }],
    scheduleH: true
  },
  {
    id: 'tirzepatide-sc',
    genericName: 'tirzepatide',
    drugClass: 'glp1_agonist',
    route: 'subcutaneous',
    strengths: [
      { value: 2.5,  unit: 'mg' },
      { value: 5,    unit: 'mg' },
      { value: 7.5,  unit: 'mg' },
      { value: 10,   unit: 'mg' },
      { value: 12.5, unit: 'mg' },
      { value: 15,   unit: 'mg' }
    ],
    defaultFrequency: 'once_weekly',
    brands: [{ brandName: 'Mounjaro', manufacturer: 'Eli Lilly and Company' }],
    titration: [
      { value: 2.5,  unit: 'mg', durationWeeks: 4 },
      { value: 5,    unit: 'mg', durationWeeks: 4 },
      { value: 7.5,  unit: 'mg', durationWeeks: 4 },
      { value: 10,   unit: 'mg', durationWeeks: 4 },
      { value: 12.5, unit: 'mg', durationWeeks: 4 },
      { value: 15,   unit: 'mg', durationWeeks: 999 }
    ],
    scheduleH: true
  },
  {
    id: 'liraglutide-sc',
    genericName: 'liraglutide',
    drugClass: 'glp1_agonist',
    route: 'subcutaneous',
    strengths: [
      { value: 0.6, unit: 'mg' },
      { value: 1.2, unit: 'mg' },
      { value: 1.8, unit: 'mg' },
      { value: 2.4, unit: 'mg' },
      { value: 3.0, unit: 'mg' }
    ],
    defaultFrequency: 'once_daily',
    brands: [{ brandName: 'Victoza', manufacturer: 'Novo Nordisk' }],
    titration: [
      { value: 0.6, unit: 'mg', durationWeeks: 1 },
      { value: 1.2, unit: 'mg', durationWeeks: 1 },
      { value: 1.8, unit: 'mg', durationWeeks: 1 },
      { value: 2.4, unit: 'mg', durationWeeks: 1 },
      { value: 3.0, unit: 'mg', durationWeeks: 999 }
    ],
    scheduleH: true
  },
  // -----------------------------------------------------------------
  // Adjuncts
  // -----------------------------------------------------------------
  {
    id: 'metformin',
    genericName: 'metformin',
    drugClass: 'biguanide',
    route: 'oral',
    strengths: [
      { value: 500,  unit: 'mg' },
      { value: 850,  unit: 'mg' },
      { value: 1000, unit: 'mg' }
    ],
    defaultFrequency: 'twice_daily',
    brands: [
      { brandName: 'Glycomet', manufacturer: 'USV' },
      { brandName: 'Glyciphage', manufacturer: 'Franco Indian' }
    ],
    scheduleH: true
  }
]);

export function findDrug(id: string): DrugFormulation | undefined {
  return drugCatalog.find((d) => d.id === id);
}

export const SCHEDULE_H_WARNING = Object.freeze({
  text: 'Schedule H — Warning: To be sold by retail on the prescription of a Registered Medical Practitioner only.',
  symbol: '℞'
} as const);
