// Retired test campaigns must not send device pushes, including saved rules.
const greeting = /^good[\s_-]*(morning|afternoon|evening|night)\b/i;
export function isDisabledGreetingNotification({ title, body, data = {} } = {}) {
  const type = String(data.type || data.notificationType || data.event || '').toLowerCase();
  if (['greeting', 'daily_greeting', 'test_greeting'].includes(type)) return true;
  if (greeting.test(String(title || '').trim())) return true;
  // A greeting in a chat message is patient content, not a test campaign.
  return (!type || ['promotion', 'promotional', 'test'].includes(type)) &&
    greeting.test(String(body || '').trim());
}
