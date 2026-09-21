/**
 * PriyaState — per-conversation state (reduced copy for this extract).
 *
 * The production file carries about thirty fields (CRM identifiers, language
 * detection state, lead-creation latches, a bounded message log). The
 * escalation engine only reads the four fields below, so this copy keeps
 * the type contract the engine depends on and drops the rest. Two invariants
 * from the original are worth keeping in view:
 *
 *   - humanAssigned LATCHES true. Once a human is on the conversation the
 *     assistant is silent for its lifetime; evaluate() returns early on it.
 *   - Counters reflect the state AT ENTRY of the current turn; the
 *     orchestrator increments them after the reply and the escalation
 *     decision, in one end-of-handler write.
 */
export interface PriyaState {
  /** Times the assistant has asked for a phone number so far. */
  phoneAskCount: number;
  /** Patient turns so far in this conversation. */
  turnCount: number;
  /** Normalised 10-digit phone once captured, else null. */
  patientPhone: string | null;
  /** LATCHING. Never flips back to false. */
  humanAssigned: boolean;
}
