/**
 * Frustration / complaint lexicon.
 *
 * Patient is upset with past treatment, billing, wait time, or the
 * clinic generally. De-escalation belongs to a human — Priya hands off.
 *
 * Avoid matching generic dissatisfaction with a PRODUCT ("I don't like
 * laser hair removal") — that's a conversational objection, not a
 * complaint against DermaVue.
 *
 * Marker: isSelfAuthored
 */

import { LanguageLexicon } from './types';

export const FRUSTRATION_LEXICON: LanguageLexicon = {
  en: [
    { name: 'angry_explicit',      pattern: /\b(angry|furious|pissed|livid|upset)\b/i },
    { name: 'worst_horrible',      pattern: /\b(horrible|worst|terrible|pathetic|awful)\s+(service|experience|clinic|staff|doctor)\b/i },
    { name: 'complaint',           pattern: /\b(file (a )?complaint|complaint against|lodge (a )?complaint)\b/i },
    { name: 'waste_scam',          pattern: /\b(waste of (money|time)|scam|cheated|fraud|fraudulent)\b/i },
    { name: 'demand_refund',       pattern: /\b(want|demand|need|asking for) (a |my )?(refund|money back)\b/i },
    { name: 'dissatisfied',        pattern: /\b(not (at all )?(happy|satisfied)|dissatisfied|disappointing\s+(service|experience))\b/i },
    { name: 'will_report',         pattern: /\b(will (report|post|tell|sue)|report you|leave a bad review|post (on|a) review)\b/i },
  ],
  manglish: [
    { name: 'angry_deshyam',       pattern: /\b(deshyam|deshyapp|kopam)\b/i },
    { name: 'worst_cheekutichu',   pattern: /\b(cheekutichu|kevalam|mosham\s+aanu)\b/i },
    { name: 'complaint_parathi',   pattern: /\b(parathi|consumer\s+court)\b/i },
    { name: 'refund_back',         pattern: /\b(panam\s+thirich|refund|poor\s+service|ente\s+panam)\b/i },
  ],
  ml: [
    { name: 'angry',               pattern: /(ദേഷ്യം|കോപം)/ },
    { name: 'complaint_parathi',   pattern: /(പരാതി|കംപ്ലയിന്റ്)/ },
    { name: 'refund',              pattern: /(പണം\s*തിരിച്ച്|റീഫണ്ട്)/ },
    { name: 'bad_service',         pattern: /(മോശം\s*സേവനം|കേവലം\s*സേവനം)/ },
  ],
  tanglish: [
    { name: 'angry_kovam',         pattern: /\b(kovam|kovama\s+irukku|kobam)\b/i },
    { name: 'worst_mosama',        pattern: /\b(mosamana|mosama|kevalam(a)?)\b/i },
    { name: 'complaint',           pattern: /\b(complaint|puthi\s+sera)\b/i },
    { name: 'refund_money_back',   pattern: /\b(pana\s+thirumba|refund)\b/i },
  ],
  ta: [
    { name: 'angry',               pattern: /(கோபம்)/ },
    { name: 'worst',               pattern: /(மோசமான\s*சேவை|கடுமையான\s*முறையீடு)/ },
    { name: 'complaint',           pattern: /(புகார்|நுகர்வோர்\s*நீதிமன்றம்)/ },
    { name: 'refund',              pattern: /(பணம்\s*திரும்ப)/ },
  ],
};
