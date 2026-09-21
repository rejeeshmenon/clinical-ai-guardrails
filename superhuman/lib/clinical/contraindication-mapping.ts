/**
 * Stone Rule #58 — single source of truth for which STRUCTURED problem-list
 * conditions contraindicate a drug class. Referenced by the contraindication
 * engine (lib/clinical/contraindications.ts) and, later, the problem-list UI.
 * It is NOT duplicated into the intake form or the UI — there is exactly one
 * structured record to consult.
 *
 * Scope of THIS module: condition-based rules matched against
 * `patient_medical_history`. The three COMPUTED contraindications from the v0
 * mapping live in the engine's value path, not here, because they derive from
 * vitals/labs rather than a problem-list row:
 *   - BMI < 23 (Indian threshold)        — HARD, computed from latest vitals
 *   - eGFR < 30 (CKD 4-5)                — HARD, computed from latest lab
 *   - BMI 23-25 + low waist circumference — SOFT, computed from vitals + sex
 * (The CKD 4-5 *condition* N18.4/N18.5 is ALSO matched here as defense-in-depth
 * alongside the computed eGFR check.)
 *
 * v0 mapping approved by founder 2026-06-24 (gap-analysis Q2). The ICD-10 +
 * name patterns are deliberately conservative — specific enough to catch real
 * entries, tight enough to avoid the known false positives (e.g. "pancreatic
 * cancer" must NOT match the pancreatitis rule). **The patterns are a v0 to be
 * clinically refined by the founder before this is relied on at scale** — the
 * mechanism is final, the patterns are v0.
 */
import type { DrugClass } from './drug-catalog';

export type ContraindicationLevel = 'hard_block' | 'soft_block_requires_override';

/**
 * `history`      — a permanent risk: the condition contraindicates even after
 *                  it is marked 'resolved' or in remission (personal history of
 *                  MTC / pancreatitis / T1DM / prior bariatric surgery). Only an
 *                  'entered_in_error' status clears it.
 * `active_state` — a current-state risk: clears when 'resolved', in remission,
 *                  or 'entered_in_error' (active gallbladder disease, current
 *                  pregnancy, active eating disorder).
 */
export type RulePersistence = 'history' | 'active_state';

export interface ContraindicationRule {
  /** Stable identifier, e.g. 'mtc_personal_history'. Never reused/renumbered. */
  code: string;
  level: ContraindicationLevel;
  /** Patient-safe display string surfaced in the physician UI. */
  display: string;
  /** Case-insensitive regex strings tested against patient_medical_history.icd10Code. */
  icd10Patterns: readonly string[];
  /** Fallback when ICD-10 is absent/unstructured — tested against the condition text. */
  conditionNamePatterns?: readonly RegExp[];
  appliesToDrugs: readonly DrugClass[];
  persistence: RulePersistence;
}

const GLP1: readonly DrugClass[] = ['glp1_agonist'] as const;

export const GLP1_CONTRAINDICATIONS: readonly ContraindicationRule[] = [
  // ---- HARD blocks (cannot prescribe; not overridable from the UI) ----
  {
    code: 'mtc_personal_history',
    level: 'hard_block',
    display: 'Personal history of medullary thyroid carcinoma (MTC)',
    icd10Patterns: ['^Z85\\.850'], // bare C73 is any thyroid Ca (incl. papillary) — require the name to say medullary
    conditionNamePatterns: [/medullary.{0,15}thyroid/i, /\bMTC\b/i],
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'men2',
    level: 'hard_block',
    display: 'Multiple Endocrine Neoplasia type 2 (MEN-2)',
    icd10Patterns: ['^E31\\.22'],
    conditionNamePatterns: [/\bMEN[-\s]?2\b/i, /multiple endocrine neoplasia.{0,6}2/i],
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'pancreatitis_history',
    level: 'hard_block',
    display: 'Personal history of pancreatitis',
    icd10Patterns: ['^K85', '^K86\\.[01]'], // acute (K85) / chronic (K86.0,K86.1). NOT C25 (pancreatic Ca).
    conditionNamePatterns: [/pancreatit/i], // "pancreatic cancer" lacks "pancreatit" → no false positive
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'type1_diabetes',
    level: 'hard_block',
    display: 'Type 1 diabetes mellitus',
    icd10Patterns: ['^E10'],
    conditionNamePatterns: [/type[-\s]?1\s*diabet/i, /\bT1DM\b/i, /\bIDDM\b/i],
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'pregnancy_current',
    level: 'hard_block',
    display: 'Current pregnancy',
    // Current pregnancy / supervision only (O00-O79 complications + supervision,
    // Z33.1 pregnant state, Z34 normal-pregnancy supervision). Deliberately
    // EXCLUDES O80-O9A (delivery + puerperium) so a postpartum patient is not
    // nuisance-blocked (Priya review 2026-06-24).
    icd10Patterns: ['^Z33\\.1', '^Z34', '^O0', '^O[1-7]'],
    conditionNamePatterns: [/pregnan/i],
    appliesToDrugs: GLP1,
    persistence: 'active_state'
  },
  {
    code: 'severe_gastroparesis',
    level: 'hard_block',
    display: 'Severe gastroparesis',
    icd10Patterns: ['^K31\\.84'],
    conditionNamePatterns: [/gastroparesis/i],
    appliesToDrugs: GLP1,
    persistence: 'active_state'
  },
  {
    code: 'active_gallbladder_disease',
    level: 'hard_block',
    display: 'Active gallbladder disease',
    icd10Patterns: ['^K80', '^K81'],
    conditionNamePatterns: [/cholelithiasis/i, /cholecystitis/i, /gallstone/i, /gall ?bladder/i],
    appliesToDrugs: GLP1,
    persistence: 'active_state'
  },
  {
    code: 'severe_ckd',
    level: 'hard_block',
    display: 'Severe chronic kidney disease (CKD stage 4-5 / eGFR <30)',
    icd10Patterns: ['^N18\\.[456]', '^N18\\.5', '^N18\\.6'],
    conditionNamePatterns: [
      /ckd.{0,8}stage.{0,4}[45]/i,
      /chronic kidney.{0,20}stage.{0,4}[45]/i,
      /end[-\s]?stage renal/i,
      /\bESRD\b/i
    ],
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'active_eating_disorder',
    level: 'hard_block',
    display: 'Active eating disorder',
    icd10Patterns: ['^F50'],
    conditionNamePatterns: [/anorexia/i, /bulimia/i, /eating disorder/i, /binge[-\s]?eating/i],
    appliesToDrugs: GLP1,
    persistence: 'active_state'
  },

  // ---- SOFT blocks (physician override + audit row required) ----
  {
    code: 'family_mtc_first_degree',
    level: 'soft_block_requires_override',
    display: 'First-degree family history of MTC',
    icd10Patterns: ['^Z80\\.828'],
    conditionNamePatterns: [/family history.{0,30}(medullary|thyroid|mtc)/i],
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'diabetic_retinopathy',
    level: 'soft_block_requires_override',
    // v0: matches retinopathy PRESENCE. The "+ rapid HbA1c drop history"
    // qualifier from the mapping needs lab-trend analysis — deferred to the
    // founder clinical refinement; presence alone is the conservative soft signal.
    display: 'Diabetic retinopathy (caution: rapid HbA1c reduction)',
    icd10Patterns: ['^H35\\.0', '^E1[0-4]\\.3'],
    conditionNamePatterns: [/diabetic retinopathy/i, /\bretinopathy\b/i],
    appliesToDrugs: GLP1,
    persistence: 'history'
  },
  {
    code: 'prior_bariatric_surgery',
    level: 'soft_block_requires_override',
    display: 'Prior bariatric surgery',
    icd10Patterns: ['^Z98\\.84'],
    conditionNamePatterns: [
      /bariatric/i,
      /gastric (bypass|sleeve|band)/i,
      /sleeve gastrectomy/i,
      /roux[-\s]?en[-\s]?y/i
    ],
    appliesToDrugs: GLP1,
    persistence: 'history'
  }
];

// --- pure matcher -----------------------------------------------------------

export interface ProblemListEntry {
  id?: string;
  condition: string;
  icd10Code?: string | null;
  status: string; // 'active' | 'resolved' | 'monitoring' | 'entered_in_error'
  inRemission?: boolean | null;
}

export interface MappingFinding {
  ruleCode: string;
  level: ContraindicationLevel;
  display: string;
  matchedCondition: string;
  matchedField: 'icd10' | 'condition_name';
  medicalHistoryId?: string;
}

/** A problem-list row no longer contraindicates if cleared per the rule's persistence. */
function isCleared(entry: ProblemListEntry, rule: ContraindicationRule): boolean {
  if (entry.status === 'entered_in_error') return true; // erroneous entry — never blocks
  if (rule.persistence === 'history') return false; // history persists through resolved/remission
  // active_state: clears when no longer current
  if (entry.status === 'resolved') return true;
  if (entry.inRemission === true) return true;
  return false; // 'active' or 'monitoring' → still blocks
}

function icd10Matches(rule: ContraindicationRule, code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim().toUpperCase();
  return rule.icd10Patterns.some((p) => new RegExp(p, 'i').test(c));
}

function nameMatches(rule: ContraindicationRule, condition: string): boolean {
  return (rule.conditionNamePatterns ?? []).some((re) => re.test(condition));
}

/**
 * Pure: match a patient's problem-list entries against the rules for a drug
 * class. ICD-10 is preferred (structured); the condition name is the fallback
 * when ICD-10 is absent. De-duplicates to one finding per (rule, entry).
 */
export function matchProblemListContraindications(
  entries: ProblemListEntry[],
  drug: DrugClass
): MappingFinding[] {
  const out: MappingFinding[] = [];
  for (const entry of entries) {
    if (!entry?.condition && !entry?.icd10Code) continue;
    for (const rule of GLP1_CONTRAINDICATIONS) {
      if (!rule.appliesToDrugs.includes(drug)) continue;
      if (isCleared(entry, rule)) continue;
      const byIcd10 = icd10Matches(rule, entry.icd10Code);
      const byName = !byIcd10 && nameMatches(rule, entry.condition ?? '');
      if (!byIcd10 && !byName) continue;
      out.push({
        ruleCode: rule.code,
        level: rule.level,
        display: rule.display,
        matchedCondition: entry.condition,
        matchedField: byIcd10 ? 'icd10' : 'condition_name',
        medicalHistoryId: entry.id
      });
    }
  }
  return out;
}
