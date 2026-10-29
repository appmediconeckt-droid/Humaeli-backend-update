import { expect } from 'chai';
import sinon from 'sinon';
import { clearGatewayMethodsCache, gatewayMethodsRepository, requireGatewayUpi, withGatewayUpiAvailability } from '../src/services/gatewayPaymentMethodsService.js';

describe('Actual Razorpay UPI availability', () => {
  let saved;
  beforeEach(() => {
    saved = [process.env.PAYMENTS_MODE, process.env.RAZORPAY_KEY_ID];
    process.env.PAYMENTS_MODE = 'test'; process.env.RAZORPAY_KEY_ID = 'rzp_test_fixture';
    clearGatewayMethodsCache();
  });
  afterEach(() => {
    sinon.restore(); clearGatewayMethodsCache();
    ['PAYMENTS_MODE', 'RAZORPAY_KEY_ID'].forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key]; else process.env[key] = saved[i];
    });
  });
  const options = () => ({ methods: ['upi', 'credit_card', 'cash'], configuredMethods: ['upi', 'credit_card', 'cash'], unavailableMethods: {} });
  it('disables test UPI when only the intent capability is enabled', async () => {
    sinon.stub(gatewayMethodsRepository, 'fetch').resolves({ entity: 'methods', upi: false, upi_intent: true });
    const result = await withGatewayUpiAvailability(options());
    expect(result.methods).to.deep.equal(['credit_card', 'cash']);
    expect(result.configuredMethods).to.include('upi');
    expect(result.unavailableMethods.upi).to.include('Razorpay test account');
    let error;
    try { await requireGatewayUpi(); } catch (caught) { error = caught; }
    expect(error.statusCode || error.status).to.equal(409);
  });
  it('allows enabled UPI and shares one capability read between concurrent callers', async () => {
    const fetch = sinon.stub(gatewayMethodsRepository, 'fetch').resolves({ entity: 'methods', upi: true });
    await Promise.all([requireGatewayUpi(), requireGatewayUpi()]);
    expect(fetch.calledOnce).to.equal(true);
    expect((await withGatewayUpiAvailability(options())).methods).to.include('upi');
  });
  it('allows the enabled live intent flow', async () => {
    process.env.PAYMENTS_MODE = 'live'; process.env.RAZORPAY_KEY_ID = 'rzp_live_fixture';
    sinon.stub(gatewayMethodsRepository, 'fetch').resolves({ entity: 'methods', upi: false, upi_intent: true });
    await requireGatewayUpi();
  });
  it('does not cache a failed availability check or disable the other methods', async () => {
    const fetch = sinon.stub(gatewayMethodsRepository, 'fetch');
    fetch.onFirstCall().rejects(new Error('Gateway availability could not be verified.'));
    fetch.onSecondCall().resolves({ entity: 'methods', upi: true });
    const result = await withGatewayUpiAvailability(options());
    expect(result.methods).to.deep.equal(['credit_card', 'cash']);
    expect(result.unavailableMethods.upi).to.include('could not be verified');
    await requireGatewayUpi();
    expect(fetch.calledTwice).to.equal(true);
  });
  it('does not reuse another key availability after a credential change', async () => {
    const fetch = sinon.stub(gatewayMethodsRepository, 'fetch').resolves({ entity: 'methods', upi: true });
    await requireGatewayUpi();
    process.env.RAZORPAY_KEY_ID = 'rzp_test_other';
    await requireGatewayUpi();
    expect(fetch.calledTwice).to.equal(true);
  });
});
