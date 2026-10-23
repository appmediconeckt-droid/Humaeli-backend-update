import { expect } from 'chai';
import { isDisabledGreetingNotification } from '../src/utils/disabledGreetingNotification.js';
import { sendPushNotification } from '../src/services/pushNotificationService.js';
import { processNotificationRule } from '../src/admin/services/notificationRuleProcessor.js';

describe('Retired greeting push campaigns', () => {
  for (const title of ['Good Morning', 'Good Afternoon!', 'Good Evening, Arun', 'Good Night', ' good_morning ']) {
    it(`skips ${title} before sending a device push or processing recipients`, async () => {
      expect(await sendPushNotification({ title })).to.deep.equal({ skipped: true, reason: 'disabled_test_greeting' });
      const result = await processNotificationRule({ _id: 'test-rule', title, status: 'active' }, { dryRun: false });
      expect(result.skippedReason).to.equal('disabled_test_greeting');
      expect(result.deliveryResults).to.deep.equal([]);
    });
  }
  it('blocks greeting text sent with a generic campaign title', () => {
    expect(isDisabledGreetingNotification({ title: 'Mediconeckt', body: 'Good morning! Have a great day.' })).to.equal(true);
  });
  it('keeps appointment, call and chat notifications', () => {
    for (const notification of [
      { title: 'Appointment confirmed', body: 'Your appointment is booked', data: { type: 'appointment' } },
      { title: 'Incoming call', data: { type: 'CALL' } },
      { title: 'Arun', body: 'Good morning doctor', data: { type: 'message' } },
    ]) expect(isDisabledGreetingNotification(notification)).to.equal(false);
  });
});
