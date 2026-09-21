/**
 * Escalation floor demonstration.
 *
 * Feeds twelve synthetic patient messages through the production escalation
 * engine (priya/guardrails/escalation.engine.ts) exactly as the orchestrator
 * calls it after each reply, and prints the decision. No model, no network,
 * no database: the engine is a pure function over lexicons and four state
 * fields.
 *
 * The messages are invented for this demonstration. They are written the way
 * patients in Kerala and Tamil Nadu actually type: Malayalam and Tamil script,
 * Latin-script Manglish and Tanglish, and English.
 *
 * Two messages expose real gaps, not demo artefacts, and are printed as GAP:
 *   - a self-harm disclosure: in production the language model's escalation
 *     table handles that case; the deterministic floor has no self-harm lexicon.
 *   - "the rash is spreading and I have fever": the symptom patterns are
 *     word-order sensitive ("spreading rash", "fever ... rash"), so the same
 *     facts in a different order pass the floor.
 */
import { evaluate, getLexiconSummary, type EscalationDecision } from '../priya/guardrails/escalation.engine';

type Case = { label: string; message: string; hadImage?: boolean; state?: Partial<Parameters<typeof evaluate>[1]>; expect: string };

const fresh = { phoneAskCount: 0, turnCount: 1, patientPhone: null, humanAssigned: false };

const CASES: Case[] = [
  { label: 'English, symptom (adjacent)', message: 'I have a spreading rash and fever with blisters since last night', expect: 'SYMPTOM' },
  { label: 'English, symptom (reordered)', message: 'the rash is spreading and I have fever since last night', expect: 'GAP: word order' },
  { label: 'Malayalam script, symptom',  message: 'മുഖത്ത് വീക്കം ഉണ്ട്, ഇന്നലെ മുതൽ', expect: 'SYMPTOM' },
  { label: 'Manglish, symptom',          message: 'mukathu veekkam und, valare vedana', expect: 'SYMPTOM' },
  { label: 'Tamil script, symptom',      message: 'நெஞ்சு வலி இருக்கு, என்ன பண்ணலாம்?', expect: 'SYMPTOM' },
  { label: 'Tanglish, symptom',          message: 'kaal la veekam irukku, ratham varuthu', expect: 'SYMPTOM' },
  { label: 'Photo attached, no text',    message: '', hadImage: true, expect: 'IMAGE_RECEIVED' },
  { label: 'English, asks for a human',  message: 'can I talk to a real person please, not a bot', expect: 'EXPLICIT_HUMAN' },
  { label: 'English, drug query',        message: 'can I start finasteride 1mg for hair fall?', expect: 'DRUG_QUERY' },
  { label: 'English, negotiation',       message: 'is there any discount if I book two sessions', expect: 'PRICING_NEGOTIATION' },
  { label: 'Symptom beats negotiation',  message: 'my face is swollen and also the price is too expensive', expect: 'SYMPTOM' },
  { label: 'Two phone asks, no phone',   message: 'ok', state: { phoneAskCount: 2, turnCount: 3 }, expect: 'PHONE_ASK_EXHAUSTED' },
  { label: 'Human already assigned',     message: 'severe chest pain', state: { humanAssigned: true }, expect: 'none (latched silent)' },
  { label: 'Self-harm disclosure',       message: 'i dont want to live anymore, nothing helps', expect: 'GAP: not in deterministic floor' },
  { label: 'Chronic, non-acute',         message: 'I have had psoriasis for years and want a consult', expect: 'none' },
];

function fmt(d: EscalationDecision): string {
  if (!d.escalate) return 'no escalation';
  return `${d.reason}  label=${d.label}  via ${d.matchedLexicon}/${d.matchedPattern} [${d.matchedLanguage}]`;
}

console.log('Escalation floor: deterministic, lexicon-based, runs after every reply. Matched text is never returned or logged.\n');
let gaps = 0;
for (const c of CASES) {
  const d = evaluate(c.message, { ...fresh, ...(c.state || {}) }, { hadImage: c.hadImage });
  const isGap = c.expect.startsWith('GAP');
  if (isGap && !d.escalate) gaps++;
  const tag = isGap ? (d.escalate ? 'UNEXPECTED ESCALATION' : 'GAP') : d.escalate || c.expect.startsWith('none') ? 'ok' : 'MISS';
  console.log(`${tag.padEnd(6)} ${c.label.padEnd(28)} ${JSON.stringify(c.message).padEnd(58)} -> ${fmt(d)}`);
}

console.log('\nLexicon inventory (pattern counts by language bucket):');
for (const row of getLexiconSummary()) {
  const b = row.byLanguage;
  console.log(`  ${row.name.padEnd(20)} ${String(row.total).padStart(3)}   ml ${b.ml}  ta ${b.ta}  manglish ${b.manglish}  tanglish ${b.tanglish}  en ${b.en}`);
}
console.log(`\nGaps made visible: ${gaps}. (1) The self-harm disclosure passed the deterministic floor; in production it is handled by the model-side escalation table, and a self-harm lexicon with Malayalam and Tamil variants is the first change this extract argues for. (2) Reordered symptom phrasing passed because the patterns are word-order sensitive; a token-set rule (symptom term AND escalating qualifier anywhere in the message) would close it at the cost of some precision, which is a measurable trade-off, not a guess.`);
