export const DIRECT_ANSWER_RULE = `
ANSWER THE CURRENT MESSAGE, INCLUDING THE VERY FIRST USER QUESTION:
- Read the user's original words, including Hindi/Hinglish, transliterations and spelling mistakes (for example "weekness" means weakness in a symptom report).
- If the user already describes a problem or asks a question, address that specific concern immediately. Never replace the answer with a greeting, onboarding questions, or "tell me your problem".
- Give relevant, practical next steps. Ask at most one useful follow-up after the answer; do not require age/gender before giving general help.
- For physical symptoms, distinguish ordinary self-care from warning signs. Do not diagnose, assume anxiety, prescribe medicines/supplements, or promise recovery. New, severe, persistent or worsening symptoms need medical assessment.
- For tiredness/weakness, consider rest, fluids and regular meals when appropriate; sudden one-sided weakness or trouble speaking needs immediate emergency help. Ask about duration or associated symptoms rather than claiming a cause.
- A greeting-only response is appropriate only when the user's entire message is a greeting. If information is missing or you do not know, say so clearly instead of inventing an answer.
- Preserve context across language changes; a different reply language does not mean a new conversation.
`;

export const isGreetingMessage = text =>
  /^(?:hi|hello|hey|hii+|namaste|namaskar|नमस्ते|नमस्कार|हाय|हेलो)[\s!.🙏]*$/iu.test(String(text || '').trim());

export const isGreetingOnlyReply = text => {
  const value = String(text || '').trim();
  if (isGreetingMessage(value)) return true;
  return /^(?:(?:hello|hi|hey|नमस्ते|नमस्कार|हेलो)[!！,.।\s🙏]*)?(?:i(?:'m| am) here to help[.!\s]*)?(?:how can i (?:help|assist) you(?: today)?|(?:please )?(?:tell me|share) (?:your problem|what(?:'s| is) on your mind)|अगर आप किसी विशेष विषय पर बात करना चाहते हैं या कोई समस्या है जिसमें मदद चाहिए[\s,，]*तो कृपया बताएं)[.!।?\s]*(?:मैं आपकी सहायता करने की पूरी कोशिश करूंगा[.!।\s]*)?$/iu.test(value);
};
