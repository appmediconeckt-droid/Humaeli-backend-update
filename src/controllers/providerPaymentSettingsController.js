import User from '../models/userModel.js';
import ProviderPaymentSettings from '../models/providerPaymentSettingsModel.js';
import { actorId, fail, handle } from '../utils/clinicAccess.js';
import { expandPaymentMethods, providerRoles, publicPaymentSettings, validateProviderPaymentSettings } from '../services/providerPaymentSettingsService.js';

const ownProvider = async (req) => {
  const provider = await User.findById(actorId(req));
  if (!provider || !providerRoles.includes(provider.role)) throw fail(403, 'Only doctors and consultants can manage payment settings.');
  return provider;
};
export const getOwnPaymentSettings = handle(async (req, res) => {
  const provider = await ownProvider(req);
  const saved = await ProviderPaymentSettings.findOne({ providerId: provider._id }).lean();
  res.json({ success: true, methods: expandPaymentMethods(saved?.methods || provider.acceptedPaymentMethods || ['cash']), bankAccount: saved?.bankAccount || {}, upiId: saved?.upiId || '', upiApp: saved?.upiApp || '' });
});
export const saveOwnPaymentSettings = handle(async (req, res) => {
  const provider = await ownProvider(req);
  const settings = validateProviderPaymentSettings(req.body);
  await ProviderPaymentSettings.findOneAndUpdate({ providerId: provider._id }, { $set: settings }, { upsert: true, returnDocument: 'after' });
  await User.updateOne({ _id: provider._id }, { $set: { acceptedPaymentMethods: settings.methods } });
  res.json({ success: true, ...settings });
});
export const getProviderPaymentMethods = handle(async (req, res) => {
  const provider = await User.findOne({ _id: req.params.providerId, isActive: true });
  if (!provider || !providerRoles.includes(provider.role)) throw fail(404, 'Provider not found.');
  const saved = await ProviderPaymentSettings.findOne({ providerId: provider._id }).lean();
  res.json({ success: true, ...publicPaymentSettings(provider, saved) });
});
