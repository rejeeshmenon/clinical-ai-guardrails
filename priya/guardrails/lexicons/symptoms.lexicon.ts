/**
 * Symptoms lexicon — acute clinical signs beyond casual mention.
 *
 * Highest-precedence escalation. Matches trigger an immediate handoff
 * regardless of anything else the patient wrote.
 *
 * Target: patient-described acute symptoms (bleeding, pus, spreading
 *         rash, facial swelling, breathing trouble, chest pain, severe
 *         pain, loss of consciousness, fever + rash, sudden-onset).
 * Avoid:  chronic conditions mentioned in passing ("I have psoriasis"),
 *         cosmetic concerns ("I want LHR"), historical references
 *         ("had acne last year"). Those stay conversational.
 *
 * Marker: isSelfAuthored
 */

import { LanguageLexicon } from './types';

export const SYMPTOM_LEXICON: LanguageLexicon = {
  en: [
    { name: 'bleeding',            pattern: /\bbleeding|bleeds|oozing blood\b/i },
    { name: 'pus_oozing',          pattern: /\b(pus|oozing|weeping)\b/i },
    { name: 'severe_pain',         pattern: /\b(severe|unbearable|extreme)\s+pain\b/i },
    { name: 'sudden_swelling',     pattern: /\bsudden(?:ly)?\s+swell|swollen\s+(?:face|lip|eye|tongue|throat)\b/i },
    { name: 'facial_swelling',     pattern: /\b(facial swelling|face is swollen|swollen face)\b/i },
    { name: 'breathing_trouble',   pattern: /\b(difficulty|trouble|problem)\s+(breathing|swallowing)\b/i },
    { name: 'spreading_rash',      pattern: /\b(spreading|growing|expanding)\s+(rash|lesion|patch|sore)\b/i },
    { name: 'fever_plus_rash',     pattern: /\b(fever|temperature).{0,30}(rash|spots|blisters)\b/i },
    { name: 'chest_pain',          pattern: /\bchest\s+pain\b/i },
    { name: 'loss_consciousness',  pattern: /\b(passed out|lost consciousness|fainted|blackout)\b/i },
    { name: 'blister_open_wound',  pattern: /\b(open wound|deep cut|gaping)\b/i },
  ],
  manglish: [
    { name: 'blood_chora',         pattern: /\b(chora|chorayodu|rakth?am?)\b/i },
    { name: 'pus_cheela',          pattern: /\b(cheela|cheel|mmha|mukulam)\b/i },
    { name: 'severe_pain',         pattern: /\b(valare\s+vedana|kashta?m?)\b/i },
    { name: 'swelling_veekkam',    pattern: /\b(veekkam|veerpp|veerthu|veerkkam|mukathu\s+veekkam)\b/i },
    { name: 'breathing_trouble',   pattern: /\b(shwasam.{0,10}(kashtam|pattunilla|prasn))\b/i },
    { name: 'fever_rash',          pattern: /\b(pani.{0,20}(kuru|chora|pimples))\b/i },
  ],
  ml: [
    { name: 'blood',               pattern: /(രക്തം|ചോര)/ },
    { name: 'pus',                 pattern: /(ചീള|ചീഴ്)/ },
    { name: 'severe_pain',         pattern: /(വളരെ\s*വേദന|കഠിനമായ\s*വേദന)/ },
    { name: 'swelling',            pattern: /(വീക്കം|വീർത്തു|വീർപ്പ്)/ },
    { name: 'breathing_trouble',   pattern: /(ശ്വാസം\s*കിട്ടുന്നില്ല|ശ്വാസതടസ്സം)/ },
    { name: 'fever_rash',          pattern: /(പനി[\s\S]{0,10}(കുരു|ചോര))/ },
    { name: 'chest_pain',          pattern: /(നെഞ്ചിൽ\s*വേദന)/ },
  ],
  tanglish: [
    { name: 'blood_rattham',       pattern: /\b(ratham|rattham|rathapoo)\b/i },
    { name: 'severe_pain_valuma',  pattern: /\b(miga\s+valuma|katumaiyana\s+valuma|athika\s+valuma)\b/i },
    { name: 'swelling_veekam',     pattern: /\b(veekam|veecham|veecham\s+aaguthu)\b/i },
    { name: 'breathing_trouble',   pattern: /\b(moochu\s+(vida\s+)?mudiyala|moochu\s+vida\s+kashtam)\b/i },
    { name: 'fever_rash',          pattern: /\b(kaichal.{0,20}(bumps|spots|kuru))\b/i },
  ],
  ta: [
    { name: 'blood',               pattern: /(இரத்தம்|ரத்தம்)/ },
    { name: 'pus',                 pattern: /(சீழ்)/ },
    { name: 'severe_pain',         pattern: /(கடுமையான\s*வலி|அதிக\s*வலி)/ },
    { name: 'swelling',            pattern: /(வீக்கம்|வீங்கியிருக்கு)/ },
    { name: 'breathing_trouble',   pattern: /(மூச்சு\s*விட\s*முடியவில்லை|மூச்சுத்\s*திணறல்)/ },
    { name: 'chest_pain',          pattern: /(நெஞ்சு\s*வலி)/ },
  ],
};
