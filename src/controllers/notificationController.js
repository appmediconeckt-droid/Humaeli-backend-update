import NotificationToken from '../models/NotificationToken.js';
import Notification from '../models/Notification.js';
import User from '../models/userModel.js';
import Appointment from '../models/appointmentModel.js';
import CounselorOnlineSubscription from '../models/CounselorOnlineSubscription.js';
import { createNotificationSafely as persistNotification } from '../services/notificationService.js';

const counselorRoles = ['counselor', 'counsellor'];
const getAuthenticatedUserId = (req) => req.userId || req.user?._id || req.user?.userId;
const getRecipientId = getAuthenticatedUserId;

const isSameUser = (left, right) => String(left) === String(right);

const getRequestedRecipient = (req) => {
  const recipientId = req.body?.user_id ?? req.params?.user_id;
  if (!recipientId || !isSameUser(recipientId, getAuthenticatedUserId(req))) {
    return null;
  }
  return recipientId;
};

// Compatibility API for clients that use the older SQL notification contract.
// It intentionally stores data in the current Notification model so all
// notification producers and the existing bell UI share one data source.
export const createNotification = async (req, res) => {
  try {
    const { user_id, title, message, type = 'system', related_id, related_type, action_url } = req.body || {};
    if (!user_id || !title || !message) {
      return res.status(400).json({ success: false, message: 'user_id, title and message are required' });
    }
    if (!isSameUser(user_id, getAuthenticatedUserId(req)) && req.user?.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You can only create notifications for your account' });
    }
    const notification = await persistNotification({
      recipientId: user_id,
      actorId: getAuthenticatedUserId(req),
      type: ['appointment', 'payment', 'message', 'call', 'system'].includes(type) ? type : 'system',
      title,
      message,
      data: { relatedId: related_id ?? null, relatedType: related_type ?? null },
      actionUrl: action_url || '',
    });
    return res.status(201).json({ success: true, message: 'Notification created successfully', notification });
  } catch (error) {
    console.error('Create notification error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getUserNotifications = async (req, res) => {
  try {
    const recipientId = getRequestedRecipient(req);
    if (!recipientId) return res.status(403).json({ success: false, message: 'You can only access your own notifications' });
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
    const query = { recipientId };
    if (req.query.is_read !== undefined) query.isRead = req.query.is_read === 'true';
    if (req.query.type) query.type = req.query.type;
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Notification.countDocuments({ recipientId, isRead: false }),
    ]);
    return res.json({ success: true, data: notifications, notifications, unread_count: unreadCount, pagination: { page, limit } });
  } catch (error) {
    console.error('Get user notifications error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const markAsRead = async (req, res) => {
  req.body = { ...(req.body || {}), user_id: getAuthenticatedUserId(req) };
  return markNotificationRead(req, res);
};

export const markAllAsRead = async (req, res) => {
  try {
    const recipientId = getAuthenticatedUserId(req);
    const result = await Notification.updateMany({ recipientId, isRead: false }, { $set: { isRead: true, readAt: new Date() } });
    return res.json({ success: true, message: `${result.modifiedCount} notifications marked as read`, updated_count: result.modifiedCount });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getNotificationStats = async (req, res) => {
  try {
    const recipientId = getRequestedRecipient(req);
    if (!recipientId) return res.status(403).json({ success: false, message: 'You can only access your own notification stats' });
    const notifications = await Notification.find({ recipientId }).select('type isRead createdAt title message data').sort({ createdAt: -1 }).lean();
    const stats = {
      total: notifications.length,
      unread: notifications.filter((item) => !item.isRead).length,
      appointment_count: notifications.filter((item) => item.type === 'appointment').length,
      payment_count: notifications.filter((item) => item.type === 'payment').length,
      reminder_count: notifications.filter((item) => item.data?.reminderType).length,
      high_priority: 0,
    };
    return res.json({ success: true, stats, recent_notifications: notifications.slice(0, 5) });
  } catch (error) {
    console.error('Notification stats error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

const findAppointmentForNotification = async (appointmentId) => {
  if (!appointmentId) return null;
  return Appointment.findById(appointmentId).populate('patient counselor', 'fullName');
};

export const sendPaymentNotification = async (req, res) => {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Payment notifications require an administrator' });
    const { appointment_id, payment_status, amount, payment_method } = req.body || {};
    const appointment = await findAppointmentForNotification(appointment_id);
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
    const notifications = [];
    if (payment_status === 'completed' || payment_status === 'pending') {
      notifications.push({ recipientId: appointment.patient?._id || appointment.patient, type: 'payment', title: payment_status === 'completed' ? 'Payment Successful' : 'Payment Pending', message: payment_status === 'completed' ? `Payment of Rs ${amount ?? ''} for your appointment has been completed via ${payment_method ?? 'selected method'}.` : `Please complete payment of Rs ${amount ?? ''} for your appointment.`, data: { appointmentId: appointment._id, paymentStatus: payment_status } });
    }
    if (payment_status === 'completed') {
      notifications.push({ recipientId: appointment.counselor?._id || appointment.counselor, type: 'payment', title: 'Payment Received', message: `Payment of Rs ${amount ?? ''} received for an appointment.`, data: { appointmentId: appointment._id, paymentStatus: payment_status } });
    }
    const inserted = await Promise.all(notifications.filter((item) => item.recipientId).map((item) => persistNotification(item)));
    return res.status(201).json({ success: true, message: 'Payment notifications sent', notifications: inserted });
  } catch (error) {
    console.error('Payment notification error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const sendAppointmentReminder = async (req, res) => {
  try {
    const { appointment_id, reminder_type = 'now' } = req.body || {};
    const appointment = await findAppointmentForNotification(appointment_id);
    if (!appointment) return res.status(404).json({ success: false, message: 'Appointment not found' });
    const ownerId = appointment.counselor?._id || appointment.counselor;
    if (req.user?.role !== 'admin' && !isSameUser(ownerId, getAuthenticatedUserId(req))) return res.status(403).json({ success: false, message: 'Only the assigned professional can send this reminder' });
    const appointmentDate = appointment.date ? new Date(appointment.date).toLocaleString('en-IN') : 'your scheduled time';
    const notifications = [{ recipientId: appointment.patient?._id || appointment.patient, type: 'appointment', title: reminder_type === '24h' ? 'Appointment Tomorrow' : reminder_type === '1h' ? 'Appointment in 1 Hour' : 'Appointment Reminder', message: `Reminder: your appointment is scheduled for ${appointmentDate}.`, data: { appointmentId: appointment._id, reminderType: reminder_type } }];
    if (reminder_type === '1h' && (appointment.counselor?._id || appointment.counselor)) notifications.push({ recipientId: appointment.counselor?._id || appointment.counselor, type: 'appointment', title: 'Patient Appointment', message: `A patient appointment is scheduled in 1 hour.`, data: { appointmentId: appointment._id, reminderType: reminder_type } });
    const inserted = await Promise.all(notifications.map((item) => persistNotification(item)));
    return res.status(201).json({ success: true, message: 'Appointment reminders sent', notifications: inserted });
  } catch (error) {
    console.error('Appointment reminder error:', error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const subscribeToCounselorOnline = async (req, res) => {
  try {
    // Some clients POST the desired bell state instead of using DELETE.
    // Never turn an explicit OFF request into an ON subscription.
    const states = ['subscribed', 'enabled']
      .filter((key) => Object.hasOwn(req.body || {}, key))
      .map((key) => req.body[key]);
    if (states.some((value) => typeof value !== 'boolean') ||
        (states.length > 1 && states[0] !== states[1])) {
      return res.status(400).json({ success: false, message: 'subscribed/enabled must be matching boolean values' });
    }
    if (states[0] === false) return unsubscribeFromCounselorOnline(req, res);

    const userId = getAuthenticatedUserId(req);
    const { counselorId } = req.params;
    const counselor = await User.findOne({ _id: counselorId, role: { $in: counselorRoles }, isActive: true })
      .select('_id')
      .lean();

    if (!counselor) {
      return res.status(404).json({ success: false, message: 'Counselor not found' });
    }
    if (String(userId) === String(counselorId)) {
      return res.status(400).json({ success: false, message: 'You cannot subscribe to yourself' });
    }

    await CounselorOnlineSubscription.findOneAndUpdate(
      { userId, counselorId },
      { $setOnInsert: { userId, counselorId } },
      { upsert: true, returnDocument: 'after' },
    );

    return res.json({ success: true, subscribed: true, counselorId });
  } catch (error) {
    console.error('Subscribe counselor online error:', error);
    return res.status(500).json({ success: false, message: 'Unable to subscribe to counselor' });
  }
};

export const unsubscribeFromCounselorOnline = async (req, res) => {
  try {
    const userId = getAuthenticatedUserId(req);
    const { counselorId } = req.params;
    await CounselorOnlineSubscription.deleteOne({ userId, counselorId });
    return res.json({ success: true, subscribed: false, counselorId });
  } catch (error) {
    console.error('Unsubscribe counselor online error:', error);
    return res.status(500).json({ success: false, message: 'Unable to unsubscribe from counselor' });
  }
};

export const getCounselorOnlineSubscription = async (req, res) => {
  try {
    const subscribed = Boolean(await CounselorOnlineSubscription.exists({
      userId: getAuthenticatedUserId(req),
      counselorId: req.params.counselorId,
    }));
    return res.json({ success: true, subscribed, counselorId: req.params.counselorId });
  } catch (error) {
    console.error('Get counselor online subscription error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load subscription status' });
  }
};

const visibleNotificationTypes = ["appointment", "payment", "message", "call", "system"];

export const getNotifications = async (req, res) => {
  try {
    const recipientId = getRecipientId(req);
    const page = Math.max(1, parseInt(req.query?.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query?.limit, 10) || 20));
    const query = { recipientId, type: { $in: visibleNotificationTypes } };

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query),
      Notification.countDocuments({ recipientId, isRead: false }),
    ]);

    return res.json({
      success: true,
      notifications,
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load notifications' });
  }
};

export const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await Notification.countDocuments({
      recipientId: getRecipientId(req),
      isRead: false,
    });
    return res.json({ success: true, count, unreadCount: count });
  } catch (error) {
    console.error('Unread notification count error:', error);
    return res.status(500).json({ success: false, message: 'Unable to load unread count' });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, recipientId: getRecipientId(req) },
      { $set: { isRead: true, readAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true, notification });
  } catch (error) {
    console.error('Mark notification read error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update notification' });
  }
};

export const markAllNotificationsRead = async (req, res) => {
  try {
    const result = await Notification.updateMany(
      { recipientId: getRecipientId(req), isRead: false },
      { $set: { isRead: true, readAt: new Date() } },
    );
    return res.json({ success: true, updatedCount: result.modifiedCount });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    return res.status(500).json({ success: false, message: 'Unable to update notifications' });
  }
};

export const deleteNotification = async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({
      _id: req.params.id,
      recipientId: getRecipientId(req),
    });
    if (!notification) {
      return res.status(404).json({ success: false, message: 'Notification not found' });
    }
    return res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    console.error('Delete notification error:', error);
    return res.status(500).json({ success: false, message: 'Unable to delete notification' });
  }
};

export const registerFCMToken = async (
  req,
  res,
) => {
  try {
    const userId = req.userId || req.user?._id || req.body?.userId;
    const token = (req.body?.token || req.body?.fcmToken || '').trim();
    const platform = req.body?.platform;

    if (!userId || !token) {
      return res.status(400).json({
        success: false,
        message:
          'userId and token are required',
      });
    }

    // The existing User field remains the canonical token store. Keeping this
    // first also makes registration compatible with databases created before
    // the separate NotificationToken collection existed.
    const updatedUser = await User.findByIdAndUpdate(userId, {
      $set: {
        fcmToken: token,
        ...(platform ? { devicePlatform: platform } : {}),
      },
    }, { returnDocument: 'after' });

    if (!updatedUser) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // A phone can switch accounts. Its current token must not remain a
    // fallback delivery address for the previous account's subscriptions.
    await User.updateMany(
      { _id: { $ne: userId }, fcmToken: token },
      { $unset: { fcmToken: '' } },
    );

    let savedToken = null;
    try {
      savedToken = await NotificationToken.findOneAndUpdate(
        {
          token,
        },
        {
          userId,
          token,
          platform:
            platform || 'android',
          active: true,
          lastUpdatedAt: new Date(),
        },
        {
          returnDocument: 'after',
          upsert: true,
        },
      );
    } catch (tokenStoreError) {
      // Do not reject a valid registration if the optional token collection
      // has an old/conflicting index; push delivery can use User.fcmToken.
      console.warn('Secondary FCM token store failed:', tokenStoreError.message);
    }

    return res.status(200).json({
      success: true,
      message:
        'FCM token saved successfully',
      data: savedToken,
    });
  } catch (error) {
    console.error(
      'FCM token save error:',
      error,
    );

    return res.status(500).json({
      success: false,
      message:
        'Unable to save FCM token',
    });
  }
};
