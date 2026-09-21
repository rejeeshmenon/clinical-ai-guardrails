/**
 * Drug names lexicon — active molecules + Indian brand names.
 *
 * Triggers: patient asks about a specific medicine ("can I take X?",
 *           "what is the dose of Y?", "my doctor prescribed Z, is it ok?").
 *
 * Covers:
 *   - International non-proprietary names (INN)
 *   - Common Indian brand names (Tretiva, Isotroin, Aknecutan, Finpecia,
 *     Finax, Mintop, Tugain, Morr-F, Kenacort, Dermacort, Dermovate,
 *     Rogaine, Betnovate, Kz, etc.)
 *   - Common misspellings (accutane, roaccutane, retin-a)
 *
 * Drug names typically appear in Latin even when the rest of the
 * message is Malayalam/Tamil script — so the `en` bucket handles
 * most practical cases.
 *
 * Marker: isSelfAuthored
 */

import { LanguageLexicon } from './types';

export const DRUG_NAMES_LEXICON: LanguageLexicon = {
  en: [
    // Isotretinoin family (acne)
    { name: 'isotretinoin',        pattern: /\b(isotretinoin|accutane|roaccutane)\b/i },
    { name: 'isotretinoin_brands_in', pattern: /\b(tretiva|isotroin|sotret|aknecutan)\b/i },
    // Tretinoin / retinoids
    { name: 'tretinoin',           pattern: /\b(tretinoin|retin[-\s]?a|atralin)\b/i },
    { name: 'adapalene',           pattern: /\b(adapalene|differin|adaferin)\b/i },
    // Finasteride / dutasteride (hair)
    { name: 'finasteride',         pattern: /\b(finasteride|propecia|finpecia|finax|fincar)\b/i },
    { name: 'dutasteride',         pattern: /\b(dutasteride|dutas|dutagen|avodart)\b/i },
    // Minoxidil (hair)
    { name: 'minoxidil',           pattern: /\b(minoxidil|rogaine|mintop|tugain|morr[\-\s]?f)\b/i },
    // Topical steroids
    { name: 'clobetasol',          pattern: /\b(clobetasol|dermovate|tenovate|clobeta)\b/i },
    { name: 'betamethasone',       pattern: /\b(betamethasone|betnovate|betnesol)\b/i },
    { name: 'hydrocortisone',      pattern: /\b(hydrocortisone|cortaid)\b/i },
    { name: 'triamcinolone',       pattern: /\b(triamcinolone|kenacort|aristocort)\b/i },
    { name: 'mometasone',          pattern: /\b(mometasone|elocon|momate)\b/i },
    // Depigmenters
    { name: 'hydroquinone',        pattern: /\b(hydroquinone|melalite|eukroma)\b/i },
    // Antibiotics topical
    { name: 'clindamycin',         pattern: /\b(clindamycin|cleocin|clincin|clinda)\b/i },
    { name: 'erythromycin',        pattern: /\b(erythromycin|eryacne)\b/i },
    { name: 'benzoyl_peroxide',    pattern: /\b(benzoyl\s+peroxide|benzaclin|brevoxyl|persol)\b/i },
    // Azole antifungals
    { name: 'ketoconazole',        pattern: /\b(ketoconazole|nizoral|keto[\-\s]?z|\bkz\b)\b/i },
    { name: 'itraconazole',        pattern: /\b(itraconazole|sporanox|itrin|canditral)\b/i },
    // Generic "dose of X" question template — catches unknown drugs
    { name: 'dose_query',          pattern: /\b(what\s+(?:is\s+)?(the\s+)?dose|dosage\s+of|how\s+much\s+should\s+I\s+take)\b/i },
    { name: 'can_i_take',           pattern: /\bcan\s+I\s+(?:take|use|start|stop)\s+(?:this\s+)?(medicine|tablet|capsule|cream|lotion)\b/i },
    { name: 'prescribed_by_other', pattern: /\b(doctor\s+prescribed|my\s+doctor\s+(?:gave|prescribed)|this\s+prescription)\b/i },
  ],
  manglish: [
    { name: 'medicine_generic',    pattern: /\b(ee\s+medicine|ee\s+tablet|dose\s+enthu|dose\s+ethra)\b/i },
    { name: 'cream_ointment',      pattern: /\b(cream\s+apply|ointment\s+apply|thavanna\s+cream)\b/i },
  ],
  ml: [
    { name: 'medicine_dose',       pattern: /(മരുന്നിന്റെ\s*dose|എത്ര\s*tablet)/ },
  ],
  tanglish: [
    { name: 'medicine_dose',       pattern: /\b(dose\s+enna|enga\s+tablet|enna\s+medicine)\b/i },
  ],
  ta: [
    { name: 'medicine_dose',       pattern: /(மருந்து\s*எவ்வளவு|மாத்திரை\s*எத்தனை)/ },
  ],
};
