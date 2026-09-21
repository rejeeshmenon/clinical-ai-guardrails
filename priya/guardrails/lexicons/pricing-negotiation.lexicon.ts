/**
 * Pricing negotiation lexicon.
 *
 * Triggers: ACTIVE negotiation ("can you discount?", "any offer?",
 *           "price is too high, reduce?", "I can't afford X").
 *
 * Deliberately excludes generic price concern:
 *   - "I'm worried about the cost"  → NOT a match (conversational)
 *   - "what's the cost?"             → NOT a match (information seeking;
 *                                       prompt handles as deflection)
 *   - "the price seems fair"          → NOT a match (positive)
 *
 * Only "reduce price / offer / discount / negotiate / can't afford /
 * bargain / cheaper" — verbs and concrete negotiation language.
 *
 * Marker: isSelfAuthored
 */

import { LanguageLexicon } from './types';

export const PRICING_NEGOTIATION_LEXICON: LanguageLexicon = {
  en: [
    { name: 'discount',             pattern: /\b(discount|any\s+offers?|special\s+(price|rate|offer)|deal\s+for\s+me)\b/i },
    { name: 'lower_reduce_price',   pattern: /\b(lower\s+(the\s+)?price|reduce\s+(the\s+)?price|bring\s+(the\s+)?price\s+down|can\s+you\s+do\s+cheaper)\b/i },
    { name: 'too_expensive',        pattern: /\b(too\s+(?:expensive|costly)|way\s+too\s+(?:expensive|high)|price\s+(?:is\s+)?(?:very\s+)?high)\b/i },
    { name: 'cannot_afford',        pattern: /\b(can\s*(?:'|no)?t\s+afford|unable\s+to\s+afford|not\s+affordable\s+for\s+me)\b/i },
    { name: 'negotiate_bargain',    pattern: /\b(negotiate|negotiable|bargain|haggle)\b/i },
    { name: 'cheaper_option',       pattern: /\b(cheaper\s+(option|alternative|package)|cheapest\s+(option|package))\b/i },
    { name: 'installments',         pattern: /\b(EMI|installments?|pay\s+in\s+parts|monthly\s+payment\s+plan)\b/i },
  ],
  manglish: [
    { name: 'discount_manglish',    pattern: /\b(discount\s+tharamo|offer\s+undo|kammi\s+cheyyamo|special\s+rate)\b/i },
    { name: 'too_expensive',        pattern: /\b(kooduthal\s+aanu|valare\s+kooduthal|costly\s+aanu)\b/i },
    { name: 'cannot_afford',        pattern: /\b(ente\s+budget\s+illa|ennikku\s+pattilla|pattilla\s+ethra)\b/i },
  ],
  ml: [
    { name: 'discount_ml',          pattern: /(ഡിസ്കൗണ്ട്|വില\s*കുറയ്ക്കാൻ|ഓഫർ)/ },
    { name: 'too_expensive_ml',     pattern: /(വളരെ\s*കൂടുതൽ|വളരെ\s*വില)/ },
  ],
  tanglish: [
    { name: 'discount_tanglish',    pattern: /\b(discount\s+kudunga|offer\s+irukka|less\s+panna\s+mudiyuma)\b/i },
    { name: 'too_expensive',        pattern: /\b(jasthi\s+aachu|romba\s+jasthi|athigam\s+aanathu)\b/i },
    { name: 'cannot_afford',        pattern: /\b(en\s+budget-kku\s+varaathu|affordable\s+illa)\b/i },
  ],
  ta: [
    { name: 'discount_ta',          pattern: /(தள்ளுபடி|விலை\s*குறை)/ },
    { name: 'too_expensive_ta',     pattern: /(அதிக\s*விலை|மிகவும்\s*விலை)/ },
  ],
};
