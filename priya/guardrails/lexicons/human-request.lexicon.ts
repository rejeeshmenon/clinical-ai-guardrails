/**
 * Explicit human request lexicon.
 *
 * Patient wants to talk to a real person. Priya's own honesty line
 * ("I'm an automated assistant") means these requests are EXPECTED —
 * respect them immediately. No attempt to continue the LLM conversation.
 *
 * Distinguish:
 *   - "are you a bot?" — this IS a request-to-escalate (user wants to
 *     know if they're stuck with a bot). Matches here.
 *   - "you're not a bot right?" — same — hand off.
 *   - "AI is helpful" / "this bot is great" — affirmative commentary.
 *     Don't match.
 *
 * Marker: isSelfAuthored
 */

import { LanguageLexicon } from './types';

export const HUMAN_REQUEST_LEXICON: LanguageLexicon = {
  en: [
    { name: 'talk_to_real_person',   pattern: /\b(talk|speak|chat|connect|transfer)\s+(?:me\s+)?(?:to|with)\s+(a\s+)?(real|actual|human|live)\s+(person|human|agent|doctor|someone)\b/i },
    { name: 'real_person',           pattern: /\breal\s+(person|human|doctor|receptionist)\b/i },
    { name: 'want_human',             pattern: /\b(I\s+want|i\s*d\s*like|can\s+I)\s+(a\s+)?(human|real\s+person|person|agent)\b/i },
    { name: 'are_you_bot',           pattern: /\b(are\s+you\s+(a\s+)?(bot|robot|ai|chatbot)|you'?re\s+(a\s+)?(bot|robot|ai)|is\s+this\s+(a\s+)?bot)\b/i },
    { name: 'not_a_bot',              pattern: /\b(not\s+a\s+bot\s+right|this\s+isn'?t\s+(a\s+)?bot)\b/i },
    { name: 'connect_me',             pattern: /\bconnect\s+me\s+(to|with|please)\b/i },
    { name: 'human_please',          pattern: /\b(human|real person|manager)\s+please\b/i },
  ],
  manglish: [
    { name: 'manushyan',             pattern: /\b(manushya(?:n|r)?|alkaran|real\s+person)\s+(venam|aayi|aanu)\b/i },
    { name: 'bot_aano',              pattern: /\b(bot\s+aano|robot\s+aano|AI\s+aano)\b/i },
    { name: 'ningal_bot',            pattern: /\b(ningal\s+bot|bot\s+alle)\b/i },
  ],
  ml: [
    { name: 'manushyan_venam',       pattern: /(മനുഷ്യനുമായി\s*സംസാരിക്കണം|ആളുമായി\s*സംസാരിക്കണം|യഥാർത്ഥ\s*വ്യക്തി)/ },
    { name: 'bot_aano_ml',           pattern: /(bot\s*ആണോ|റോബോട്ട്\s*ആണോ)/ },
  ],
  tanglish: [
    { name: 'manushan',               pattern: /\b(manushan|actual\s+person|alkaran|real\s+person)\s+(venum|veyynu)\b/i },
    { name: 'bot_aa',                 pattern: /\b(bot\s+(a|aa)|robot\s+(a|aa))\b/i },
  ],
  ta: [
    { name: 'manithan_pesanum',      pattern: /(மனிதனுடன்\s*பேசணும்|உண்மையான\s*நபர்)/ },
    { name: 'bot_a',                  pattern: /(bot\s*ஆ|robot\s*ஆ)/ },
  ],
};
