import { expect } from 'chai';
import sinon from 'sinon';
import User from '../src/models/userModel.js';
import { getNearbyProfessionals } from '../src/controllers/nearbyProfessionalsController.js';
import { distanceKm, findNearbyProfessionals, validCoordinates } from '../src/services/nearbyProfessionals.js';

describe('Nearby professional directory', () => {
  afterEach(() => sinon.restore());
  const profile = (id, coordinates) => ({ _id: id, locationData: { current: { coordinates } } });
  it('only includes profiles within 25 km and sorts nearest first', () => {
    const result = findNearbyProfessionals([
      profile('far', [77, 29]), profile('near', [77, 28.1]),
      profile('closest', [77, 28.01]), profile('unknown', undefined),
      { _id: 'address-only', location: 'Delhi' },
    ], [77, 28]);
    expect(result.map((item) => item.id)).to.deep.equal(['closest', 'near']);
    expect(result[1].distanceKm).to.be.closeTo(11.12, 0.02);
  });
  it('validates numeric coordinates including zero and rejects absent values', () => {
    expect(validCoordinates([0, 0])).to.equal(true);
    for (const coordinates of [[null, null], ['', ''], [181, 20], [20, 91], [NaN, 0], ['77', '28']]) {
      expect(validCoordinates(coordinates)).to.equal(false);
    }
    expect(distanceKm([0, 0], [0, 0])).to.equal(0);
  });
  it('rejects a location request without coordinates', async () => {
    const res = { status: sinon.stub().returnsThis(), json: sinon.spy() };
    await getNearbyProfessionals({ body: {} }, res);
    expect(res.status.firstCall.args[0]).to.equal(400);
  });
  it('queries active professional roles and returns distances without coordinates', async () => {
    const find = sinon.stub(User, 'find').returns({ select: () => ({ lean: async () => [profile('near', [77, 28.01])] }) });
    const res = { json: sinon.spy() };
    await getNearbyProfessionals({ body: { latitude: 28, longitude: 77 } }, res);
    expect(find.firstCall.args[0].isActive).to.equal(true);
    expect(find.firstCall.args[0].$or[0].role.$in).to.include('doctor').and.include('counsellor');
    const data = res.json.firstCall.args[0];
    expect(data.radiusKm).to.equal(25);
    expect(data.professionals[0]).to.have.keys('id', 'distanceKm');
  });
});
