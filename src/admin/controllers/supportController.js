import crypto from "node:crypto";
import SupportTicket from "../models/SupportTicket.js";
import User from "../models/User.js";

const escapeHtml = (value = "") => String(value)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const newTicketNumber = () => `SUP-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}`;

const extractAddress = (value) => {
  if (typeof value === "string") return value.match(/<([^>]+)>/)?.[1] || value;
  return value?.email || value?.address || "";
};

const sendSupportEmail = async ({ to, subject, body, ticketNumber }) => {
  if (!process.env.BREVO_API_KEY || !process.env.EMAIL_FROM) {
    const err = new Error("Email delivery is not configured. Set BREVO_API_KEY and EMAIL_FROM.");
    err.statusCode = 503;
    throw err;
  }
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Mediconeckt Support", email: process.env.EMAIL_FROM },
      to: [{ email: to }],
      subject: `[Ticket #${ticketNumber}] ${subject}`,
      htmlContent: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#202124"><p>${escapeHtml(body).replaceAll("\n", "<br>")}</p><hr><p style="font-size:12px;color:#5f6368">Mediconeckt Support · Ticket #${ticketNumber}</p></div>`,
      textContent: `${body}\n\nMediconeckt Support · Ticket #${ticketNumber}`,
      replyTo: { email: process.env.SUPPORT_REPLY_TO || process.env.EMAIL_FROM, name: "Mediconeckt Support" }
    })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Brevo email error ${response.status}`);
  return data;
};

export const incomingSupportEmail = async (req, res) => {
  try {
    const configuredSecret = process.env.SUPPORT_WEBHOOK_SECRET;
    if (!configuredSecret || req.headers["x-webhook-secret"] !== configuredSecret) {
      return res.status(401).json({ success: false, message: "Invalid webhook secret" });
    }

    const email = extractAddress(req.body.from || req.body.sender || req.body.email).trim().toLowerCase();
    const name = String(req.body.name || req.body.sender?.name || "").trim();
    const subject = String(req.body.subject || "Support request").trim();
    const body = String(req.body.text || req.body.body || req.body.strippedText || "").trim();
    const externalMessageId = String(req.body.messageId || req.body["message-id"] || "");
    if (!email || !body) return res.status(400).json({ success: false, message: "Sender email and message body are required" });

    const ticketMatch = subject.match(/\[Ticket\s*#([^\]]+)\]/i);
    let ticket = ticketMatch ? await SupportTicket.findOne({ ticketNumber: ticketMatch[1] }) : null;
    const user = await User.findOne({ email }).select("_id fullName").lean();

    if (!ticket) {
      ticket = await SupportTicket.create({
        ticketNumber: newTicketNumber(),
        userId: user?._id || null,
        requesterName: name || user?.fullName || email.split("@")[0],
        requesterEmail: email,
        subject: subject.replace(/\[Ticket\s*#[^\]]+\]\s*/i, "") || "Support request",
        source: "EMAIL",
        messages: [{ direction: "INBOUND", from: email, body, externalMessageId }],
        unreadByAdmin: true,
        lastMessageAt: new Date()
      });
    } else {
      ticket.messages.push({ direction: "INBOUND", from: email, body, externalMessageId });
      ticket.status = "OPEN";
      ticket.unreadByAdmin = true;
      ticket.lastMessageAt = new Date();
      ticket.resolvedAt = null;
      await ticket.save();
    }
    res.status(201).json({ success: true, ticketNumber: ticket.ticketNumber });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getSupportTickets = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, search = "" } = req.query;
    const safePage = Math.max(1, parseInt(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, parseInt(limit) || 20));
    const filter = {};
    if (status) filter.status = status.toUpperCase();
    if (search.trim()) {
      const regex = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ ticketNumber: regex }, { requesterName: regex }, { requesterEmail: regex }, { subject: regex }];
    }
    const [tickets, total] = await Promise.all([
      SupportTicket.find(filter).select("-messages.body").sort({ lastMessageAt: -1 }).skip((safePage - 1) * safeLimit).limit(safeLimit).lean(),
      SupportTicket.countDocuments(filter)
    ]);
    res.json({ success: true, data: tickets, pagination: { total, page: safePage, limit: safeLimit, pages: Math.ceil(total / safeLimit) } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const getSupportTicket = async (req, res) => {
  try {
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, { unreadByAdmin: false }, { new: true }).populate("userId", "fullName email phone");
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });
    res.json({ success: true, data: ticket });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

export const updateSupportTicket = async (req, res) => {
  try {
    const update = {};
    if (req.body.status) {
      update.status = req.body.status.toUpperCase();
      update.resolvedAt = update.status === "RESOLVED" ? new Date() : null;
    }
    if (req.body.priority) update.priority = req.body.priority.toUpperCase();
    const ticket = await SupportTicket.findByIdAndUpdate(req.params.id, update, { new: true, runValidators: true });
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });
    res.json({ success: true, data: ticket });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
};

export const replyToSupportTicket = async (req, res) => {
  try {
    const body = String(req.body.message || "").trim();
    if (!body) return res.status(400).json({ success: false, message: "Reply message is required" });
    const ticket = await SupportTicket.findById(req.params.id);
    if (!ticket) return res.status(404).json({ success: false, message: "Ticket not found" });
    const delivery = await sendSupportEmail({ to: ticket.requesterEmail, subject: ticket.subject, body, ticketNumber: ticket.ticketNumber });
    ticket.messages.push({ direction: "OUTBOUND", from: process.env.EMAIL_FROM, to: ticket.requesterEmail, body, externalMessageId: delivery.messageId, sentBy: req.user?.email || "Admin" });
    ticket.status = req.body.status?.toUpperCase() || "PENDING";
    ticket.unreadByAdmin = false;
    ticket.lastMessageAt = new Date();
    await ticket.save();
    res.json({ success: true, message: "Reply sent", data: ticket });
  } catch (err) { res.status(err.statusCode || 500).json({ success: false, message: err.message }); }
};

export const getSupportStats = async (req, res) => {
  try {
    const [rows, unread] = await Promise.all([
      SupportTicket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      SupportTicket.countDocuments({ unreadByAdmin: true })
    ]);
    const count = status => rows.find(row => row._id === status)?.count || 0;
    res.json({ success: true, data: { total: rows.reduce((sum, row) => sum + row.count, 0), open: count("OPEN"), pending: count("PENDING"), resolved: count("RESOLVED"), unread } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};
