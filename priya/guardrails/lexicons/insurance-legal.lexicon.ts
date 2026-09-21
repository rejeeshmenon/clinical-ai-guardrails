/**
 * Insurance / legal / records lexicon.
 *
 * Triggers: questions about insurance claims, bills for reimbursement,
 *           medical-legal certificates, records requests, lawyers,
 *           consumer forums.
 *
 * None of these are Priya's domain. Straight to a human.
 *
 * Avoid:   "do you have insurance?" from Priya-to-patient direction
 *           — Priya never asks these, so one-way filtering is fine.
 *           Generic mention ("covered by insurance?") is a valid trigger.
 *
 * Marker: isSelfAuthored
 */

import { LanguageLexicon } from './types';

export const INSURANCE_LEGAL_LEXICON: LanguageLexicon = {
  en: [
    { name: 'insurance_mention',    pattern: /\b(insurance|mediclaim|health\s+cover|covered\s+by)\b/i },
    { name: 'claim',                pattern: /\b(claim\s+(amount|process)|make\s+a\s+claim|file\s+a\s+claim|insurance\s+claim|reimburs(e|ement))\b/i },
    { name: 'medical_records',      pattern: /\b(medical\s+records?|case\s+file|past\s+(reports|records)|release\s+of\s+records)\b/i },
    { name: 'certificate',          pattern: /\b(medical\s+certificate|fitness\s+certificate|cost\s+estimate\s+letter|doctor'?s\s+letter)\b/i },
    { name: 'lawyer_legal',         pattern: /\b(lawyer|advocate|attorney|legal\s+notice|legal\s+action)\b/i },
    { name: 'court',                pattern: /\b(court|consumer\s+forum|consumer\s+court)\b/i },
    { name: 'bill_receipt',         pattern: /\b(itemized\s+bill|detailed\s+(bill|invoice)|duplicate\s+receipt|tax\s+invoice)\b/i },
  ],
  manglish: [
    { name: 'insurance_claim',      pattern: /\b(insurance\s+claim|mediclaim|medical\s+record|case\s+file)\b/i },
    { name: 'vakeel_attorney',      pattern: /\b(vakeel|vakil|advocate|vakkilineyum)\b/i },
    { name: 'bill_invoice',         pattern: /\b(detailed\s+bill|invoice|tax\s+invoice|receipt)\b/i },
  ],
  ml: [
    { name: 'insurance_claim_ml',   pattern: /(ഇൻഷുറൻസ്|ക്ലെയിം|മെഡിക്കൽ\s*റെക്കോർഡ്)/ },
    { name: 'vakeel_ml',            pattern: /(വക്കീൽ|കോടതി|ലീഗൽ)/ },
  ],
  tanglish: [
    { name: 'insurance',            pattern: /\b(insurance|mediclaim|health\s+cover|claim\s+panna)\b/i },
    { name: 'lawyer',               pattern: /\b(vakkeel|advocate|lawyer|legal\s+notice)\b/i },
  ],
  ta: [
    { name: 'insurance_ta',         pattern: /(இன்சூரன்ஸ்|ஹெல்த்\s*கவர்|கிளைம்)/ },
    { name: 'lawyer_ta',            pattern: /(வக்கீல்|அட்வகேட்|சட்ட\s*அறிவிப்பு)/ },
  ],
};
