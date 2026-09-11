import Settings from "../models/Settings.js";

const GENERAL_KEYS = ["platform_name", "support_email"];

const DEFAULTS = {
  platform_name: { value: "Mediconeckt", description: "Platform display name", type: "STRING", category: "GENERAL" },
  support_email: { value: "", description: "Support contact email", type: "STRING", category: "EMAIL" },
};

export const getGeneralSettings = async (req, res) => {
  try {
    const docs = await Settings.find({ key: { $in: GENERAL_KEYS } }).lean();
    const map = {};
    for (const d of docs) map[d.key] = d.value;

    // fill in defaults for missing keys
    for (const key of GENERAL_KEYS) {
      if (map[key] === undefined) map[key] = DEFAULTS[key].value;
    }

    res.json({ success: true, data: map });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to load settings" });
  }
};

export const updateGeneralSettings = async (req, res) => {
  try {
    const { platform_name, support_email } = req.body;

    if (platform_name !== undefined && typeof platform_name !== "string") {
      return res.status(400).json({ success: false, message: "platform_name must be a string" });
    }
    if (support_email !== undefined) {
      if (typeof support_email !== "string") {
        return res.status(400).json({ success: false, message: "support_email must be a string" });
      }
      if (support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(support_email)) {
        return res.status(400).json({ success: false, message: "Invalid support email address" });
      }
    }

    const updates = [];
    if (platform_name !== undefined) {
      updates.push(Settings.findOneAndUpdate(
        { key: "platform_name" },
        { $set: { value: platform_name.trim(), description: DEFAULTS.platform_name.description, type: DEFAULTS.platform_name.type, category: DEFAULTS.platform_name.category, updatedBy: req.user?.id || null } },
        { upsert: true, new: true }
      ));
    }
    if (support_email !== undefined) {
      updates.push(Settings.findOneAndUpdate(
        { key: "support_email" },
        { $set: { value: support_email.trim(), description: DEFAULTS.support_email.description, type: DEFAULTS.support_email.type, category: DEFAULTS.support_email.category, updatedBy: req.user?.id || null } },
        { upsert: true, new: true }
      ));
    }

    await Promise.all(updates);
    res.json({ success: true, message: "Settings saved successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to save settings" });
  }
};
