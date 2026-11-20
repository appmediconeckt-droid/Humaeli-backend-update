import Call from '../models/Call.js';
import Chat from '../models/Chat.js';
import User from '../models/userModel.js';
import Message from '../models/Message.js';

const pickUserLocationForCall = (user) => {
  const current = user?.locationData?.current;
  const coords = current?.coordinates;
  const hasCoords = Array.isArray(coords) && coords.length === 2;

  const locationData = hasCoords
    ? {
        coordinates: coords,
        address: current.address || '',
        city: current.city || '',
        state: current.state || '',
        country: current.country || '',
        capturedAt: current.capturedAt || null,
      }
    : null;

  const locationText = (current?.address && String(current.address).trim()) || user?.location || null;

  return { locationText, locationData };
};

// Initiate a new call
export const initiateCall = async (req, res) => {
  try {
    const { chatId, callType, receiverId } = req.body;
    
    if (!chatId || !callType || !receiverId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Check if chat exists
    const chat = await Chat.findOne({ chatId: chatId })
      .populate('userId', 'fullName profilePhoto location locationData.current')
      .populate('counselorId', 'fullName profilePhoto location locationData.current');
    
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check authorization
    const isAuthorized = (req.user.role === 'user' && chat.userId._id.toString() === req.user._id.toString()) ||
                        (req.user.role === 'counsellor' && chat.counselorId._id.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }

    if (chat.blockedByUser) {
      return res.status(403).json({ code: 'CHAT_BLOCKED', error: 'Calls are unavailable because this conversation is blocked.' });
    }

    const expectedReceiver = req.user.role === 'user' ? chat.counselorId : chat.userId;
    if (String(expectedReceiver._id) !== String(receiverId)) {
      return res.status(403).json({ error: 'Receiver is not a participant in this conversation' });
    }
    
    // Get caller and receiver info
    const isCallerUser = req.user.role === 'user';
    const caller = isCallerUser ? chat.userId : chat.counselorId;
    const receiver = await User.findById(receiverId).select('fullName profilePhoto location locationData.current');
    
    if (!receiver) {
      return res.status(404).json({ error: 'Receiver not found' });
    }
    
    // Check if there's an active call already
    const existingActiveCall = await Call.findOne({
      $or: [
        { chatId: chat._id, status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] }, isActive: true },
        { callerId: req.user._id, status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] }, isActive: true },
        { receiverId: req.user._id, status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] }, isActive: true }
      ]
    });
    
    if (existingActiveCall) {
      return res.status(409).json({ 
        error: 'You already have an active call',
        callId: existingActiveCall.callId,
        status: existingActiveCall.status
      });
    }
    
    // Create call record
    const callerLoc = pickUserLocationForCall(caller);
    const receiverLoc = pickUserLocationForCall(receiver);

    const call = await Call.create({
      chatId: chat._id,
      callerId: req.user._id,
      receiverId: receiverId,
      callType: callType,
      status: 'initiated',
      callerName: caller.fullName,
      receiverName: receiver.fullName,
      callerAvatar: caller.profilePhoto?.url || null,
      receiverAvatar: receiver.profilePhoto?.url || null,
      callerLocation: callerLoc.locationText,
      receiverLocation: receiverLoc.locationText,
      callerLocationData: callerLoc.locationData || undefined,
      receiverLocationData: receiverLoc.locationData || undefined
    });
    
    // Add call message to chat
    await Message.create({
      chatId: chat._id,
      senderId: req.user._id,
      senderRole: req.user.role,
      content: `📞 ${callType === 'audio' ? 'Audio' : 'Video'} call initiated`,
      contentType: 'TEXT'
    });
    
    res.status(201).json({
      success: true,
      call: {
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        caller: {
          id: call.callerId,
          name: call.callerName,
          avatar: call.callerAvatar,
          location: call.callerLocation,
          locationData: call.callerLocationData || null
        },
        receiver: {
          id: call.receiverId,
          name: call.receiverName,
          avatar: call.receiverAvatar,
          location: call.receiverLocation,
          locationData: call.receiverLocationData || null
        },
        createdAt: call.createdAt
      }
    });
  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({ error: 'Error initiating call' });
  }
};

// Get call details
export const getCallDetails = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check authorization
    const isAuthorized = (call.callerId.toString() === req.user._id.toString()) ||
                        (call.receiverId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    res.json({
      success: true,
      call: {
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        caller: {
          id: call.callerId,
          name: call.callerName,
          avatar: call.callerAvatar,
          location: call.callerLocation,
          locationData: call.callerLocationData || null
        },
        receiver: {
          id: call.receiverId,
          name: call.receiverName,
          avatar: call.receiverAvatar,
          location: call.receiverLocation,
          locationData: call.receiverLocationData || null
        },
        isMuted: call.isMuted,
        isSpeakerOn: call.isSpeakerOn,
        isOnHold: call.isOnHold,
        callQuality: call.callQuality,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        duration: call.duration,
        formattedDuration: call.formattedDuration,
        createdAt: call.createdAt,
        endedBy: call.endedBy
      }
    });
  } catch (error) {
    console.error('Error getting call details:', error);
    res.status(500).json({ error: 'Error getting call details' });
  }
};

// Accept call
export const acceptCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check if user is the receiver
    if (call.receiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the receiver can accept the call' });
    }
    
    // Check if call is still active
    if (call.status !== 'initiated' && call.status !== 'ringing') {
      return res.status(400).json({ error: `Cannot accept call in ${call.status} state` });
    }
    
    call.status = 'connected';
    call.startedAt = new Date();
    await call.save();
    
    // Add call accepted message to chat
    const chat = await Chat.findById(call.chatId);
    if (chat) {
      await Message.create({
        chatId: chat._id,
        senderId: req.user._id,
        senderRole: req.user.role,
        content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call accepted`,
        contentType: 'TEXT'
      });
    }
    
    res.json({
      success: true,
      message: 'Call accepted',
      call: {
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        startedAt: call.startedAt
      }
    });
  } catch (error) {
    console.error('Error accepting call:', error);
    res.status(500).json({ error: 'Error accepting call' });
  }
};

// Reject call
export const rejectCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check if user is the receiver
    if (call.receiverId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Only the receiver can reject the call' });
    }
    
    // Check if call is still active
    if (call.status !== 'initiated' && call.status !== 'ringing') {
      return res.status(400).json({ error: 'Call already ended' });
    }
    
    call.status = 'rejected';
    call.endedAt = new Date();
    call.isActive = false;
    call.endedBy = req.user._id;
    await call.save();
    
    // Add call rejected message to chat
    const chat = await Chat.findById(call.chatId);
    if (chat) {
      await Message.create({
        chatId: chat._id,
        senderId: req.user._id,
        senderRole: req.user.role,
        content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call rejected`,
        contentType: 'TEXT'
      });
    }
    
    res.json({
      success: true,
      message: 'Call rejected'
    });
  } catch (error) {
    console.error('Error rejecting call:', error);
    res.status(500).json({ error: 'Error rejecting call' });
  }
};

// End call
export const endCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check authorization
    const isAuthorized = (call.callerId.toString() === req.user._id.toString()) ||
                        (call.receiverId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Calculate duration if call was connected
    if (call.status === 'connected' && call.startedAt) {
      call.duration = Math.floor((Date.now() - new Date(call.startedAt).getTime()) / 1000);
    }
    
    call.status = 'ended';
    call.endedAt = new Date();
    call.isActive = false;
    call.endedBy = req.user._id;
    await call.save();
    
    // Add call ended message to chat
    const chat = await Chat.findById(call.chatId);
    if (chat) {
      await Message.create({
        chatId: chat._id,
        senderId: req.user._id,
        senderRole: req.user.role,
        content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call ended (${call.formattedDuration})`,
        contentType: 'TEXT'
      });
    }
    
    res.json({
      success: true,
      message: 'Call ended',
      duration: call.duration,
      formattedDuration: call.formattedDuration
    });
  } catch (error) {
    console.error('Error ending call:', error);
    res.status(500).json({ error: 'Error ending call' });
  }
};

// Update call status (mute, speaker, hold, quality)
export const updateCallStatus = async (req, res) => {
  try {
    const { callId } = req.params;
    const { isMuted, isSpeakerOn, isOnHold, callQuality, status } = req.body;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    // Check authorization
    const isAuthorized = (call.callerId.toString() === req.user._id.toString()) ||
                        (call.receiverId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Update fields
    if (isMuted !== undefined) call.isMuted = isMuted;
    if (isSpeakerOn !== undefined) call.isSpeakerOn = isSpeakerOn;
    if (isOnHold !== undefined) {
      call.isOnHold = isOnHold;
      if (isOnHold) {
        call.status = 'on-hold';
      } else if (call.status === 'on-hold') {
        call.status = 'connected';
      }
    }
    if (callQuality) call.callQuality = callQuality;
    if (status) call.status = status;
    
    await call.save();
    
    res.json({
      success: true,
      message: 'Call status updated',
      call: {
        isMuted: call.isMuted,
        isSpeakerOn: call.isSpeakerOn,
        isOnHold: call.isOnHold,
        callQuality: call.callQuality,
        status: call.status
      }
    });
  } catch (error) {
    console.error('Error updating call status:', error);
    res.status(500).json({ error: 'Error updating call status' });
  }
};

// Miss call (auto-mark when timeout)
export const missCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    if (call.status === 'initiated' || call.status === 'ringing') {
      call.status = 'missed';
      call.endedAt = new Date();
      call.isActive = false;
      await call.save();
      
      // Add call missed message to chat
      const chat = await Chat.findById(call.chatId);
      if (chat) {
        await Message.create({
          chatId: chat._id,
          senderId: call.callerId,
          senderRole: call.callerId.toString() === call.callerId ? 'user' : 'counsellor',
          content: `📞 ${call.callType === 'audio' ? 'Audio' : 'Video'} call missed`,
          contentType: 'TEXT'
        });
      }
    }
    
    res.json({
      success: true,
      message: 'Call marked as missed'
    });
  } catch (error) {
    console.error('Error missing call:', error);
    res.status(500).json({ error: 'Error missing call' });
  }
};

// Get call history for a chat
export const getCallHistory = async (req, res) => {
  try {
    const { chatId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const chat = await Chat.findById(chatId);
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Check authorization
    const isAuthorized = (req.user.role === 'user' && chat.userId.toString() === req.user._id.toString()) ||
                        (req.user.role === 'counsellor' && chat.counselorId.toString() === req.user._id.toString());
    
    if (!isAuthorized) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // ✅ Optimized: Fetch count & data in parallel with lean() for read-only data
    const query = { chatId: chat._id, isActive: false };
    const [calls, total] = await Promise.all([
      Call.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(), // ✅ Read-only data - faster
      Call.countDocuments(query)
    ]);
    
    res.json({
      success: true,
      calls: calls.map(call => ({
        id: call._id,
        callId: call.callId,
        callType: call.callType,
        status: call.status,
        caller: {
          id: call.callerId,
          name: call.callerName,
          avatar: call.callerAvatar
        },
        receiver: {
          id: call.receiverId,
          name: call.receiverName,
          avatar: call.receiverAvatar
        },
        duration: call.duration,
        formattedDuration: call.formattedDuration,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        createdAt: call.createdAt,
        endedBy: call.endedBy
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error getting call history:', error);
    res.status(500).json({ error: 'Error getting call history' });
  }
};

// Get recent calls for user
export const getRecentCalls = async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    
    const calls = await Call.find({
      $or: [
        { callerId: req.user._id },
        { receiverId: req.user._id }
      ],
      isActive: false
    })
    .sort({ createdAt: -1 })
    .limit(limit);
    
    res.json({
      success: true,
      calls: calls.map(call => {
        const isIncoming = call.receiverId.toString() === req.user._id.toString();
        const otherParty = isIncoming ? {
          id: call.callerId,
          name: call.callerName,
          avatar: call.callerAvatar,
          location: call.callerLocation,
          locationData: call.callerLocationData || null
        } : {
          id: call.receiverId,
          name: call.receiverName,
          avatar: call.receiverAvatar,
          location: call.receiverLocation,
          locationData: call.receiverLocationData || null
        };
        
        return {
          id: call._id,
          callId: call.callId,
          callType: call.callType,
          status: call.status,
          isIncoming,
          otherParty,
          duration: call.duration,
          formattedDuration: call.formattedDuration,
          startedAt: call.startedAt,
          createdAt: call.createdAt
        };
      })
    });
  } catch (error) {
    console.error('Error getting recent calls:', error);
    res.status(500).json({ error: 'Error getting recent calls' });
  }
};

// Get active call for user
export const getActiveCall = async (req, res) => {
  try {
    const activeCall = await Call.findOne({
      $or: [
        { callerId: req.user._id },
        { receiverId: req.user._id }
      ],
      status: { $in: ['initiated', 'ringing', 'connected', 'on-hold'] },
      isActive: true
    });
    
    if (!activeCall) {
      return res.json({ success: true, hasActiveCall: false });
    }
    
    const isCaller = activeCall.callerId.toString() === req.user._id.toString();
    const otherParty = isCaller ? {
      id: activeCall.receiverId,
      name: activeCall.receiverName,
      avatar: activeCall.receiverAvatar,
      location: activeCall.receiverLocation,
      locationData: activeCall.receiverLocationData || null
    } : {
      id: activeCall.callerId,
      name: activeCall.callerName,
      avatar: activeCall.callerAvatar,
      location: activeCall.callerLocation,
      locationData: activeCall.callerLocationData || null
    };
    
    res.json({
      success: true,
      hasActiveCall: true,
      call: {
        id: activeCall._id,
        callId: activeCall.callId,
        callType: activeCall.callType,
        status: activeCall.status,
        isCaller,
        otherParty,
        isMuted: activeCall.isMuted,
        isSpeakerOn: activeCall.isSpeakerOn,
        isOnHold: activeCall.isOnHold,
        callQuality: activeCall.callQuality,
        startedAt: activeCall.startedAt
      }
    });
  } catch (error) {
    console.error('Error getting active call:', error);
    res.status(500).json({ error: 'Error getting active call' });
  }
};

// Ring call (update status to ringing)
export const ringCall = async (req, res) => {
  try {
    const { callId } = req.params;
    
    const call = await Call.findOne({ callId: callId });
    if (!call) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    if (call.status === 'initiated') {
      call.status = 'ringing';
      await call.save();
    }
    
    res.json({
      success: true,
      message: 'Call is ringing'
    });
  } catch (error) {
    console.error('Error ringing call:', error);
    res.status(500).json({ error: 'Error ringing call' });
  }
};
