import { v4 as uuidv4 } from "uuid";
import User from "../models/userModel.js";
import Call from "../models/Call.js";
import { chargeCallByDuration } from "../services/paidSessionService.js";
import { createNotificationSafely } from "../services/notificationService.js";

const isValidId = (id) => id != null && String(id).length >= 12;



// In-memory storage (replace with database in production)
const callHistory = [];
const activeCalls = new Map();
const userCallHistory = new Map(); // userId -> array of calls
const userStatus = new Map(); // Track online/busy status of users
const CALL_REQUEST_TIMEOUT_SECONDS = 30;

const normalizeParticipantType = (type) => {
  const normalized = String(type || "")
    .trim()
    .toLowerCase();

  if (normalized === "counselor") {
    return "counsellor";
  }

  return normalized;
};

const TERMINAL_CALL_STATUSES = ["ended", "rejected", "missed", "cancelled"];

export const videoCallController = {
  emitToParticipant(io, participantId, participantType, eventName, payload) {
    if (!io || !participantId) return;

    const normalizedType =
      participantType === "counselor" ? "counsellor" : participantType;
    const roomNames = new Set([
      `user_${participantId}`,
      `${normalizedType}_${participantId}`,
    ]);

    if (normalizedType === "counsellor") {
      roomNames.add(`counselor_${participantId}`);
    }

    for (const roomName of roomNames) {
      io.to(roomName).emit(eventName, payload);
    }
  },

  // Helper function to get user details from your database
  async getUserDetails(userId, userType) {
    try {
      if (!userId || !isValidId(userId)) {
        console.log(`Invalid user ID format: ${userId}`);
        return null;
      }

      const user = await User.findById(userId).select(
        "fullName email role profilePhoto specialization rating experience location qualification languages aboutMe isActive anonymous",
      );

      if (!user) {
        console.log(`User not found with ID: ${userId}`);
        return null;
      }

      if (!user.isActive) {
        console.log(`User is inactive: ${userId}`);
        return null;
      }

      return {
        id: user._id,
        fullName: user.fullName,
        name: user.fullName,
        anonymous: user.anonymous || false,
        email: user.email,
        type: user.role,
        profilePhoto: user.profilePhoto?.url || null,
        specialization: user.specialization || [],
        rating: user.rating || 0,
        experience: user.experience || 0,
        qualification: user.qualification || "",
        location: user.location || "",
        languages: user.languages || [],
        aboutMe: user.aboutMe || "",
        isActive: user.isActive,
      };
    } catch (error) {
      console.error("Error in getUserDetails:", error);
      return null;
    }
  },

  // Get display name based on who is viewing
  // Rules:
  // 1. If viewer is counselor and target is user -> protect the patient's
  //    identity and show only their anonymous handle.
  // 2. If viewer is user and target is counselor -> show counselor's real name (ignore anonymous)
  // 3. If both are counselors -> show real names
  // 4. If both are users -> respect anonymous setting (show "Anonymous" if target.anonymous === true)
  getDisplayName(targetUser, viewerId, viewerRole, targetRole) {
    if (!targetUser) return "Unknown User";

    // Normalize role spellings
    const vRole = viewerRole === "counsellor" ? "counselor" : viewerRole;
    const tRole = targetRole === "counsellor" ? "counselor" : targetRole;

    // Case 1: Viewer is counselor, target is user -> never expose real name.
    if (vRole === "counselor" && tRole === "user") {
      return (
        (typeof targetUser.anonymous === "string" &&
          targetUser.anonymous.trim()) ||
        "Anonymous User"
      );
    }

    // Case 2: Viewer is user, target is counselor -> show counselor's real name
    if (vRole === "user" && tRole === "counselor") {
      return targetUser.fullName;
    }

    // Case 3: Both are counselors -> show real names
    if (vRole === "counselor" && tRole === "counselor") {
      return targetUser.fullName;
    }

    // Case 4: Both are users -> respect anonymous setting
    if (vRole === "user" && tRole === "user") {
      if (targetUser.anonymous === true) {
        return "Anonymous";
      }
      return targetUser.fullName;
    }

    // Default fallback
    return targetUser.fullName;
  },

  // 1. Initiate a video call request
  initiateCall: async (req, res) => {
    try {
      const {
        receiverId,
        receiverType,
        callType = "video",
        message = "I'd like to start a video call with you.",
        initiatorName,
      } = req.body;

      const initiatorId = req.user?._id;
      const initiatorType = normalizeParticipantType(req.user?.role || "user");
      const receiverTypeNormalized = normalizeParticipantType(receiverType);

      if (!initiatorId || !receiverType || !receiverId) {
        return res.status(400).json({
          success: false,
          error:
            "Authenticated initiator, receiverId, and receiverType are required",
        });
      }

      // Validate ObjectIds
      if (!isValidId(initiatorId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid initiatorId format",
        });
      }

      if (!isValidId(receiverId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid receiverId format",
        });
      }

      // Get user details
      const initiatorDetails = await videoCallController.getUserDetails(
        initiatorId,
        initiatorType,
      );
      const receiverDetails = await videoCallController.getUserDetails(
        receiverId,
        receiverTypeNormalized,
      );

      if (!initiatorDetails) {
        return res.status(404).json({
          success: false,
          error: `Initiator not found`,
        });
      }

      if (!receiverDetails) {
        return res.status(404).json({
          success: false,
          error: `Receiver not found`,
        });
      }

      // Check for existing active call request
      let existingCall = null;
      for (const [callId, call] of activeCalls.entries()) {
        if (
          ((String(call.initiator.id) === String(initiatorId) &&
            String(call.receiver.id) === String(receiverId)) ||
            (String(call.initiator.id) === String(receiverId) &&
              String(call.receiver.id) === String(initiatorId))) &&
          call.status === "pending" &&
          call.isActive
        ) {
          existingCall = call;
          break;
        }
      }

      const callId = uuidv4();
      const roomId = uuidv4();

      // Set expiration time for unanswered call requests.
      const expiresAt = new Date();
      expiresAt.setSeconds(
        expiresAt.getSeconds() + CALL_REQUEST_TIMEOUT_SECONDS,
      );

      // If existing pending call exists, check if expired
      if (existingCall) {
        if (existingCall.expiresAt && new Date() > existingCall.expiresAt) {
          console.log("Call request expired, reactivating");

          existingCall.status = "pending";
          existingCall.isActive = true;
          existingCall.expiresAt = expiresAt;
          existingCall.initiator = {
            id: initiatorId,
            fullName: initiatorDetails.fullName,
            anonymous: initiatorDetails.anonymous,
            type: initiatorType,
            profilePhoto: initiatorDetails.profilePhoto,
          };
          existingCall.receiver = {
            id: receiverId,
            fullName: receiverDetails.fullName,
            anonymous: receiverDetails.anonymous,
            type: receiverTypeNormalized,
            profilePhoto: receiverDetails.profilePhoto,
          };
          existingCall.requestMessage = message;
          existingCall.updatedAt = new Date();

          // Update in DB
          await Call.findOneAndUpdate(
            { callId: existingCall.callId },
            {
              status: "pending",
              callerId: initiatorId,
              initiatorType: initiatorType,
              receiverId: receiverId,
              receiverType: receiverTypeNormalized,
              callType: (callType === "voice" || callType === "audio") ? "voice" : "video",
              isActive: true,
              updatedAt: new Date(),
              expiresAt: expiresAt
            }
          );

          // Emit real-time notification with appropriate display name
          if (global.io) {
            const initiatorDisplayName = videoCallController.getDisplayName(
              initiatorDetails,
              receiverId,
              receiverTypeNormalized,
              initiatorType,
            );

            videoCallController.emitToParticipant(
              global.io,
              receiverId,
              receiverType,
              "incoming_call_request",
              {
                callId: existingCall.callId,
                roomId: existingCall.roomId,
                from: initiatorDisplayName,
                fromId: initiatorId,
                fromType: initiatorType,
                fromProfilePhoto: initiatorDetails.profilePhoto,
                callType,
                message,
                expiresAt,
                remainingSeconds: CALL_REQUEST_TIMEOUT_SECONDS,
                timestamp: new Date(),
              },
            );
          }

          await createNotificationSafely({
            recipientId: receiverId,
            actorId: initiatorId,
            type: "call",
            title: `Incoming ${callType === "voice" || callType === "audio" ? "voice" : "video"} call request`,
            message: `${initiatorDetails.fullName} sent a new call request.`,
            data: {
              callId: existingCall.callId,
              roomId: existingCall.roomId,
              callType,
              status: "pending",
              expiresAt,
            },
            actionUrl: "/calls",
          });

          return res.status(201).json({
            success: true,
            message: "New call request sent",
            callId: existingCall.callId,
            roomId: existingCall.roomId,
            status: "pending",
            expiresAt,
            callData: {
              id: existingCall.callId,
              roomId: existingCall.roomId,
              initiator: {
                id: initiatorId,
                displayName: videoCallController.getDisplayName(
                  initiatorDetails,
                  receiverId,
                  receiverType,
                  initiatorType,
                ),
                fullName: initiatorDetails.fullName,
                isAnonymous: initiatorDetails.anonymous,
                type: initiatorType,
                profilePhoto: initiatorDetails.profilePhoto,
              },
              receiver: {
                id: receiverId,
                displayName: videoCallController.getDisplayName(
                  receiverDetails,
                  initiatorId,
                  initiatorType,
                  receiverType,
                ),
                fullName: receiverDetails.fullName,
                isAnonymous: receiverDetails.anonymous,
                type: receiverType,
                profilePhoto: receiverDetails.profilePhoto,
              },
              status: "pending",
              expiresAt,
              createdAt: new Date(),
            },
          });
        } else {
          // Active pending request exists
          const remainingSeconds = Math.max(
            0,
            Math.floor((existingCall.expiresAt - new Date()) / 1000),
          );

          return res.status(400).json({
            success: false,
            error: `Call request already active. Please wait ${remainingSeconds} seconds before sending another request.`,
            status: existingCall.status,
            callId: existingCall.callId,
            expiresAt: existingCall.expiresAt,
            remainingSeconds,
          });
        }
      }

      // Create new call request (pending)
      const callData = {
        callId,
        roomId,
        type: callType,
        status: "pending",
        initiatedBy: initiatorType,
        initiator: {
          id: initiatorId,
          fullName: initiatorDetails.fullName,
          anonymous: initiatorDetails.anonymous,
          type: initiatorType,
          profilePhoto: initiatorDetails.profilePhoto,
          email: initiatorDetails.email,
          specialization: initiatorDetails.specialization,
          rating: initiatorDetails.rating,
        },
        receiver: {
          id: receiverId,
          fullName: receiverDetails.fullName,
          anonymous: receiverDetails.anonymous,
          type: receiverTypeNormalized,
          profilePhoto: receiverDetails.profilePhoto,
          email: receiverDetails.email,
          specialization: receiverDetails.specialization,
          rating: receiverDetails.rating,
        },
        requestMessage: message,
        createdAt: new Date(),
        expiresAt: expiresAt,
        startTime: null,
        endTime: null,
        duration: 0,
        participants: new Map(),
        endedBy: null,
        isActive: true,
      };

      // Add initiator to participants
      callData.participants.set(initiatorId, {
        userId: initiatorId,
        fullName: initiatorDetails.fullName,
        anonymous: initiatorDetails.anonymous,
        role: "initiator",
        type: initiatorType,
        joinedAt: new Date(),
        isVideoEnabled: true,
        isAudioEnabled: true,
        isScreenSharing: false,
        profilePhoto: initiatorDetails.profilePhoto,
      });

      activeCalls.set(callId, callData);

      // Emit real-time notification to receiver with appropriate display name
      if (global.io) {
        const initiatorDisplayName = videoCallController.getDisplayName(
          initiatorDetails,
          receiverId,
          receiverTypeNormalized,
          initiatorType,
        );

        videoCallController.emitToParticipant(
          global.io,
          receiverId,
          receiverTypeNormalized,
          "incoming_call_request",
          {
            callId,
            roomId,
            from: initiatorDisplayName,
            fromId: initiatorId,
            fromType: initiatorType,
            fromProfilePhoto: initiatorDetails.profilePhoto,
            callType,
            message,
            expiresAt,
            remainingSeconds: CALL_REQUEST_TIMEOUT_SECONDS,
            timestamp: new Date(),
          },
        );
      }

      // Create new call record in DB
      await Call.create({
        callId,
        roomId,
        callType: (callType === "voice" || callType === "audio") ? "voice" : "video",
        status: "pending",
        callerId: initiatorId,
        initiatorType: initiatorType,
        receiverId: receiverId,
        receiverType: receiverTypeNormalized,
        callerName: initiatorDetails.fullName,
        receiverName: receiverDetails.fullName,
        callerAvatar: initiatorDetails.profilePhoto,
        receiverAvatar: receiverDetails.profilePhoto,
        isActive: true,
        expiresAt,
      });

      await createNotificationSafely({
        recipientId: receiverId,
        actorId: initiatorId,
        type: "call",
        title: `Incoming ${callType === "voice" || callType === "audio" ? "voice" : "video"} call request`,
        message: `${initiatorDetails.fullName} wants to start a ${callType === "voice" || callType === "audio" ? "voice" : "video"} call.`,
        data: { callId, roomId, callType, status: "pending", expiresAt },
        actionUrl: "/calls",
      });

      res.status(201).json({
        success: true,
        message: "Call request sent successfully",
        callId,
        roomId,
        status: "pending",
        expiresAt,
        callData: {
          id: callId,
          roomId,
          initiator: {
            id: initiatorId,
            displayName: videoCallController.getDisplayName(
              initiatorDetails,
              receiverId,
              receiverTypeNormalized,
              initiatorType,
            ),
            fullName: initiatorDetails.fullName,
            isAnonymous: initiatorDetails.anonymous,
            type: initiatorType,
            profilePhoto: initiatorDetails.profilePhoto,
          },
          receiver: {
            id: receiverId,
            displayName: videoCallController.getDisplayName(
              receiverDetails,
              initiatorId,
              initiatorType,
              receiverTypeNormalized,
            ),
            fullName: receiverDetails.fullName,
            isAnonymous: receiverDetails.anonymous,
            type: receiverTypeNormalized,
            profilePhoto: receiverDetails.profilePhoto,
          },
          status: "pending",
          expiresAt,
          createdAt: new Date(),
        },
      });
    } catch (error) {
      console.error("Error initiating call:", error);
      res.status(500).json({
        success: false,
        error: "Failed to initiate call",
        details: error.message,
      });
    }
  },

  // 2. Get pending call requests
  getPendingRequests: async (req, res) => {
    try {
      const { userId } = req.params;
      const { userType } = req.query;

      const pendingRequests = [];

      for (const [callId, call] of activeCalls.entries()) {
        if (
          String(call.receiver.id) === String(userId) &&
          call.status === "pending" &&
          call.isActive &&
          call.expiresAt &&
          new Date() < call.expiresAt
        ) {
          const remainingSeconds = Math.max(
            0,
            Math.floor((call.expiresAt - new Date()) / 1000),
          );

          // Get display name for the caller based on receiver's perspective
          const callerDisplayName = videoCallController.getDisplayName(
            {
              fullName: call.initiator.fullName,
              anonymous: call.initiator.anonymous,
            },
            userId,
            userType,
            call.initiator.type,
          );

          pendingRequests.push({
            callId: call.callId,
            roomId: call.roomId,
            from: {
              id: call.initiator.id,
              displayName: callerDisplayName,
              fullName: call.initiator.fullName,
              ...(String(call.initiator.type).toLowerCase() === "user"
                ? {
                    anonymous:
                      call.initiator.anonymous || "Anonymous User",
                    isAnonymous: true,
                  }
                : { isAnonymous: false }),
              type: call.initiator.type,
              profilePhoto: call.initiator.profilePhoto,
              specialization: call.initiator.specialization,
              rating: call.initiator.rating,
            },
            callType: call.type,
            requestMessage: call.requestMessage,
            requestedAt: call.createdAt,
            expiresAt: call.expiresAt,
            remainingSeconds,
          });
        }
      }

      res.json({
        success: true,
        pendingRequests,
        count: pendingRequests.length,
      });
    } catch (error) {
      console.error("Error getting pending requests:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get pending requests",
        details: error.message,
      });
    }
  },

  // 3. Accept call request
  acceptCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const acceptorId = String(
        req.user?._id || req.user?.id || "",
      ).trim();
      const requestedAcceptorType = normalizeParticipantType(
        req.body?.acceptorType || req.body?.userType,
      );

      if (!acceptorId || !isValidId(acceptorId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid acceptorId format",
        });
      }

      const call = activeCalls.get(callId);

      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Call request not found",
        });
      }

      const acceptorType =
        requestedAcceptorType || normalizeParticipantType(call.receiver.type);

      // Verify the acceptor is the intended receiver
      if (String(call.receiver.id) !== String(acceptorId)) {
        return res.status(403).json({
          success: false,
          error: "You are not the intended recipient of this call",
        });
      }

      // Check if request has expired
      if (
        call.status === "pending" &&
        call.expiresAt &&
        new Date() > call.expiresAt
      ) {
        call.status = "cancelled";
        call.isActive = false;
        call.cancelledAt = new Date();
        activeCalls.set(callId, call);

        await Call.findOneAndUpdate(
          { callId },
          {
            status: "cancelled",
            cancelledAt: call.cancelledAt,
            isActive: false,
          },
        );

        return res.status(400).json({
          success: false,
          error: "Call request has expired. User needs to send a new request.",
          status: "expired",
          canResend: true,
          callId: call._id,
        });
      }

      if (call.status !== "pending") {
        return res.status(400).json({
          success: false,
          error: `Cannot accept call. Current status: ${call.status}`,
          status: call.status,
        });
      }

      // Get acceptor details
      const acceptorDetails = await videoCallController.getUserDetails(
        acceptorId,
        acceptorType,
      );

      if (!acceptorDetails) {
        return res.status(404).json({
          success: false,
          error: "Acceptor not found",
        });
      }

      const initiatorIsUser =
        normalizeParticipantType(call.initiator.type) === "user";
      const receiverIsUser =
        normalizeParticipantType(call.receiver.type) === "user";
      if (!initiatorIsUser && !receiverIsUser) {
        return res.status(400).json({
          success: false,
          error: "A paid call must include one user and one counselor",
        });
      }
      // Billing starts when the receiver accepts the call. Some clients establish
      // the media connection without calling the optional /join endpoint, so
      // waiting for join left startTime empty and produced a zero-value payment.
      const acceptedAt = new Date();

      // Update call status to accepted/active
      call.status = "active";
      call.acceptedAt = acceptedAt;
      call.startTime = acceptedAt;
      call.expiresAt = null;
      call.receiver.fullName = acceptorDetails.fullName;
      call.receiver.anonymous = acceptorDetails.anonymous;
      call.receiver.type = acceptorType || call.receiver.type;
      call.receiver.profilePhoto = acceptorDetails.profilePhoto;
      call.receiver.specialization = acceptorDetails.specialization;
      call.receiver.rating = acceptorDetails.rating;

      // Add receiver to participants
      call.participants.set(acceptorId, {
        userId: acceptorId,
        fullName: acceptorDetails.fullName,
        anonymous: acceptorDetails.anonymous,
        role: "receiver",
        type: acceptorType,
        joinedAt: new Date(),
        isVideoEnabled: true,
        isAudioEnabled: true,
        isScreenSharing: false,
        profilePhoto: acceptorDetails.profilePhoto,
      });

      // Update user status
      userStatus.set(call.initiator.id, {
        status: "busy",
        currentCall: callId,
      });
      userStatus.set(call.receiver.id, { status: "busy", currentCall: callId });

      activeCalls.set(callId, call);

      // Update call in DB
      await Call.findOneAndUpdate(
        { callId: callId },
        {
          status: "active",
          acceptedAt,
          startedAt: acceptedAt,
          isActive: true,
          paymentTransactionId: null,
          paymentAmount: 0,
          paymentStatus: "unpaid",
        },
      );

      // Notify initiator that call was accepted with appropriate display name
      if (global.io) {
        const acceptorDisplayName = videoCallController.getDisplayName(
          acceptorDetails,
          call.initiator.id,
          call.initiator.type,
          call.receiver.type,
        );

        const statusPayload = {
          callId,
          status: "active",
          from: acceptorId,
          timestamp: acceptedAt,
        };

        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          "call_accepted",
          {
            callId,
            roomId: call.roomId,
            by: acceptorDisplayName,
            byProfilePhoto: acceptorDetails.profilePhoto,
            timestamp: acceptedAt,
          },
        );

        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          "call-status-update",
          statusPayload,
        );

        videoCallController.emitToParticipant(
          global.io,
          call.receiver.id,
          call.receiver.type,
          "call-status-update",
          statusPayload,
        );
      }

      // Prepare response with appropriate display names
      const initiatorDisplayName = videoCallController.getDisplayName(
        {
          fullName: call.initiator.fullName,
          anonymous: call.initiator.anonymous,
        },
        acceptorId,
        acceptorType,
        call.initiator.type,
      );

      const receiverDisplayName = videoCallController.getDisplayName(
        {
          fullName: acceptorDetails.fullName,
          anonymous: acceptorDetails.anonymous,
        },
        call.initiator.id,
        call.initiator.type,
        call.receiver.type,
      );

      res.json({
        success: true,
        message: "Call request accepted",
        callId,
        roomId: call.roomId,
        status: "active",
        acceptedAt: call.acceptedAt,
        participants: Array.from(call.participants.values()).map((p) => ({
          ...p,
          displayName:
            p.userId === call.initiator.id
              ? initiatorDisplayName
              : p.userId === acceptorId
                ? receiverDisplayName
                : p.fullName,
        })),
      });
    } catch (error) {
      console.error("Error accepting call:", error);
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || "Failed to accept call",
        walletBalance: error.walletBalance,
        requiredAmount: error.requiredAmount,
        details: error.message,
      });
    }
  },

  // 4. Reject call request
  rejectCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const rejectingUserId = String(
        req.body?.userId || req.body?.rejectorId || req.body?.acceptorId || "",
      ).trim();
      const { reason = "declined" } = req.body;

      if (
        !rejectingUserId ||
        !isValidId(rejectingUserId)
      ) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId format",
        });
      }

      const call = activeCalls.get(callId);

      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Call not found",
        });
      }

      // Only receiver can reject
      if (String(call.receiver.id) !== String(rejectingUserId)) {
        return res.status(403).json({
          success: false,
          error: "Only the receiver can reject this call",
        });
      }

      if (call.status !== "pending") {
        return res.status(400).json({
          success: false,
          error: `Cannot reject call. Current status: ${call.status}`,
        });
      }

      // Check if expired
      if (call.expiresAt && new Date() > call.expiresAt) {
        return res.status(400).json({
          success: false,
          error: "Call request has already expired",
        });
      }

      // Save to history
      const historyEntry = {
        id: call.callId,
        roomId: call.roomId,
        type: call.type,
        status: "rejected",
        initiatedBy: call.initiatedBy,
        initiator: call.initiator,
        receiver: call.receiver,
        createdAt: call.createdAt,
        rejectedAt: new Date(),
        reason,
        rejectedBy: rejectingUserId,
      };

      // Save to history (DB)
      await Call.findOneAndUpdate(
        { callId: callId },
        {
          status: "rejected",
          rejectedAt: new Date(),
          isActive: false,
        },
      );

      call.status = "rejected";
      call.rejectedAt = historyEntry.rejectedAt;
      call.isActive = false;

      callHistory.unshift(historyEntry);

      [call.initiator.id, call.receiver.id].forEach((uid) => {
        if (!userCallHistory.has(uid)) {
          userCallHistory.set(uid, []);
        }
        userCallHistory.get(uid).push(historyEntry);
      });

      // Notify initiator
      if (global.io) {
        const rejectedAt = new Date();
        const rejectedPayload = {
          callId,
          reason,
          status: "rejected",
          by: call.receiver.fullName,
          timestamp: rejectedAt,
        };

        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          "call_rejected",
          rejectedPayload,
        );

        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          "call-status-update",
          {
            callId,
            status: "rejected",
            from: rejectingUserId,
            timestamp: rejectedAt,
          },
        );

        videoCallController.emitToParticipant(
          global.io,
          call.receiver.id,
          call.receiver.type,
          "call-status-update",
          {
            callId,
            status: "rejected",
            from: rejectingUserId,
            timestamp: rejectedAt,
          },
        );
      }

      // Remove from active calls
      activeCalls.delete(callId);

      res.json({
        success: true,
        message: "Call rejected",
        call: historyEntry,
      });
    } catch (error) {
      console.error("Error rejecting call:", error);
      res.status(500).json({
        success: false,
        error: "Failed to reject call",
        details: error.message,
      });
    }
  },

  // 5. Join active call (after accepted)
  joinCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const { userId, userType } = req.body;

      if (!isValidId(userId)) {
        return res.status(400).json({
          success: false,
          error: "Invalid userId format",
        });
      }

      const call = activeCalls.get(callId);

      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Call not found",
        });
      }

      // Check if user is authorized
      const isInitiator = String(call.initiator.id) === String(userId);
      const isReceiver = String(call.receiver.id) === String(userId);

      if (!isInitiator && !isReceiver) {
        return res.status(403).json({
          success: false,
          error: "Not authorized to join this call",
        });
      }

      // Check if call is already ended
      if (call.status === "ended") {
        return res.status(400).json({
          success: false,
          error: "Call has already ended",
        });
      }

      // Check if call request expired (only for pending)
      if (
        call.status === "pending" &&
        call.expiresAt &&
        new Date() > call.expiresAt
      ) {
        call.status = "cancelled";
        call.isActive = false;
        call.cancelledAt = new Date();
        activeCalls.set(callId, call);

        await Call.findOneAndUpdate(
          { callId },
          {
            status: "cancelled",
            cancelledAt: call.cancelledAt,
            isActive: false,
          },
        );

        return res.status(400).json({
          success: false,
          error: "Call request has expired",
          status: "expired",
        });
      }

      if (call.status === "pending") {
        return res.status(409).json({
          success: false,
          error: "Call request must be accepted before joining",
          status: "pending",
          callId,
        });
      }

      // Get user details
      const userDetails = await videoCallController.getUserDetails(
        userId,
        userType,
      );

      if (!userDetails) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        });
      }

      // Add participant
      if (!call.participants.has(userId)) {
        call.participants.set(userId, {
          userId,
          fullName: userDetails.fullName,
          anonymous: userDetails.anonymous,
          role: isInitiator ? "initiator" : "receiver",
          type: userType,
          joinedAt: new Date(),
          isVideoEnabled: true,
          isAudioEnabled: true,
          isScreenSharing: false,
          profilePhoto: userDetails.profilePhoto,
        });
      }

      // Set start time when first participant joins
      if (!call.startTime && call.participants.size >= 1) {
        call.startTime = new Date();
      }

      // Set call to active
      call.status = "active";
      call.isActive = true;

      activeCalls.set(callId, call);

      // Update user status
      userStatus.set(userId, { status: "busy", currentCall: callId });

      // Notify other participant that someone joined
      if (global.io) {
        const otherUserId = isInitiator ? call.receiver.id : call.initiator.id;

        // Update other user's status if they're also in call
        const otherStatus = userStatus.get(otherUserId);
        if (otherStatus && otherStatus.currentCall === callId) {
          userStatus.set(otherUserId, { status: "busy", currentCall: callId });
        }

        videoCallController.emitToParticipant(
          global.io,
          otherUserId,
          isInitiator ? call.receiver.type : call.initiator.type,
          "participant_joined",
          {
            callId,
            userId,
            userName: userDetails.fullName,
            userType,
            timestamp: new Date(),
          },
        );
      }

      // Prepare response with display names
      const participantsList = Array.from(call.participants.values()).map(
        (p) => {
          let displayName;
          if (userId === p.userId) {
            displayName = p.fullName;
          } else {
            displayName = videoCallController.getDisplayName(
              { fullName: p.fullName, anonymous: p.anonymous },
              userId,
              userType,
              p.type,
            );
          }
          return { ...p, displayName };
        },
      );

      res.json({
        success: true,
        callId,
        roomId: call.roomId,
        status: call.status,
        participants: participantsList,
        startTime: call.startTime,
        token: call.roomId,
        currentUser: {
          id: userId,
          type: userType,
          displayName: userDetails.fullName,
        },
      });
    } catch (error) {
      console.error("Error joining call:", error);
      res.status(500).json({
        success: false,
        error: "Failed to join call",
        details: error.message,
      });
    }
  },

  // 6. End active call
  endCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const userId = String(
        req.body?.userId || req.user?._id || req.user?.id || "",
      ).trim();

      const call = activeCalls.get(callId);

      if (!call) {
        const historicalCall = callHistory.find((entry) => entry.id === callId);

        if (historicalCall) {
          return res.json({
            success: true,
            message: "Call already ended",
            callSummary: {
              callId,
              duration: historicalCall.duration || 0,
              endedAt:
                historicalCall.endTime ||
                historicalCall.rejectedAt ||
                historicalCall.cancelledAt ||
                historicalCall.createdAt,
              endedBy:
                historicalCall.endedBy?.name ||
                historicalCall.endedBy ||
                "unknown",
            },
          });
        }

        return res.status(404).json({
          success: false,
          error: "Call not found",
        });
      }

      // Check if user is a participant
      const isParticipant =
        String(call.initiator.id) === String(userId) || String(call.receiver.id) === String(userId);

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: "Only call participants can end the call",
        });
      }

      const endTime = new Date();
      // acceptedAt is a safe fallback for calls created before startTime was
      // initialized during acceptance.
      const billingStartedAt = call.startTime || call.acceptedAt;
      const duration = billingStartedAt
        ? Math.max(0, Math.floor((endTime - new Date(billingStartedAt)) / 1000))
        : 0;
      const wasPendingRequest = ["pending", "ringing", "waiting", "requested"].includes(
        String(call.status || "").toLowerCase(),
      );
      const finalStatus = wasPendingRequest ? "cancelled" : "ended";

      const initiatorIsUser =
        normalizeParticipantType(call.initiator.type) === "user";
      const receiverIsUser =
        normalizeParticipantType(call.receiver.type) === "user";
      const billing = !wasPendingRequest && (initiatorIsUser || receiverIsUser)
        ? await chargeCallByDuration({
            callId,
            userId: initiatorIsUser ? call.initiator.id : call.receiver.id,
            counselorId: initiatorIsUser ? call.receiver.id : call.initiator.id,
            sessionType:
              call.type === "voice" || call.type === "audio" ? "voice" : "video",
            durationSeconds: duration,
          })
        : null;

      const endedBy =
        String(call.initiator.id) === String(userId) ? call.initiator : call.receiver;

      // Save to history
      const historyEntry = {
        id: call.callId,
        roomId: call.roomId,
        type: call.type,
        status: wasPendingRequest ? "cancelled" : "completed",
        initiatedBy: call.initiatedBy,
        initiator: call.initiator,
        receiver: call.receiver,
        createdAt: call.createdAt,
        acceptedAt: call.acceptedAt,
        startTime: billingStartedAt,
        endTime: wasPendingRequest ? null : endTime,
        cancelledAt: wasPendingRequest ? endTime : call.cancelledAt,
        duration,
        endedBy: {
          id: endedBy.id,
          name: endedBy.fullName,
          type: endedBy.type,
        },
        participants: Array.from(call.participants.values()),
      };

      // Save to history (DB)
      await Call.findOneAndUpdate(
        { callId: callId },
        {
          status: finalStatus,
          endedAt: wasPendingRequest ? null : endTime,
          cancelledAt: wasPendingRequest ? endTime : call.cancelledAt,
          duration: duration,
          isActive: false,
          endedBy: endedBy.id,
          paymentTransactionId: billing?.transaction?._id || null,
          paymentAmount: billing?.amount || 0,
          paymentStatus: billing?.transaction ? "paid" : "unpaid",
        },
      );

      callHistory.unshift(historyEntry);

      [call.initiator.id, call.receiver.id].forEach((uid) => {
        if (!userCallHistory.has(uid)) {
          userCallHistory.set(uid, []);
        }
        userCallHistory.get(uid).push(historyEntry);
      });

      // Update user status
      userStatus.set(call.initiator.id, {
        status: "online",
        currentCall: null,
      });
      userStatus.set(call.receiver.id, { status: "online", currentCall: null });

      // Remove from active calls
      activeCalls.delete(callId);

      // Notify both participants and the call room so both UIs close immediately.
      if (global.io) {
        const endedAt = new Date();
        const endedPayload = {
          callId,
          roomId: call.roomId,
          duration,
          status: finalStatus,
          endedBy: endedBy.fullName,
          endedById: endedBy.id,
          endedByType: endedBy.type,
          timestamp: endedAt,
        };

        const statusPayload = {
          callId,
          status: finalStatus,
          from: endedBy.id,
          timestamp: endedAt,
        };

        const terminationEvent = wasPendingRequest ? "call_cancelled" : "call_ended";
        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          terminationEvent,
          endedPayload,
        );
        videoCallController.emitToParticipant(
          global.io,
          call.receiver.id,
          call.receiver.type,
          terminationEvent,
          endedPayload,
        );
        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          "call_ended",
          endedPayload,
        );
        videoCallController.emitToParticipant(
          global.io,
          call.receiver.id,
          call.receiver.type,
          "call_ended",
          endedPayload,
        );

        // Compatibility event name for clients expecting kebab-case.
        global.io.to(`call_${callId}`).emit("call-ended", endedPayload);
        global.io.to(`call_${callId}`).emit("call_ended", endedPayload);
        if (wasPendingRequest) {
          global.io.to(`call_${callId}`).emit("call_cancelled", endedPayload);
        }
        global.io
          .to(`call_${callId}`)
          .emit("call-status-update", statusPayload);

        videoCallController.emitToParticipant(
          global.io,
          call.initiator.id,
          call.initiator.type,
          "call-status-update",
          statusPayload,
        );
        videoCallController.emitToParticipant(
          global.io,
          call.receiver.id,
          call.receiver.type,
          "call-status-update",
          statusPayload,
        );
      }

      res.json({
        success: true,
        message: wasPendingRequest
          ? "Call request cancelled successfully"
          : "Call ended successfully",
        callSummary: {
          callId,
          duration,
          endedAt: endTime,
          endedBy: endedBy.fullName,
          billedAmount: billing?.amount || 0,
          walletBalance: billing?.walletBalance,
        },
      });
    } catch (error) {
      console.error("Error ending call:", error);
      res.status(500).json({
        success: false,
        error: "Failed to end call",
        details: error.message,
      });
    }
  },

  // 7. Resend expired call request
  resendCallRequest: async (req, res) => {
    try {
      const { callId } = req.params;
      const { userId, userType } = req.body;

      const call = activeCalls.get(callId);

      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Call not found",
        });
      }

      // Check authorization
      if (String(call.initiator.id) !== String(userId)) {
        return res.status(403).json({
          success: false,
          error: "Only the initiator can resend the request",
        });
      }

      // Only allow resend if call is cancelled or rejected
      if (call.status !== "cancelled" && call.status !== "rejected") {
        return res.status(400).json({
          success: false,
          error: `Cannot resend. Call is ${call.status}`,
        });
      }

      // Reset the call for new request
      const expiresAt = new Date();
      expiresAt.setSeconds(
        expiresAt.getSeconds() + CALL_REQUEST_TIMEOUT_SECONDS,
      );

      call.status = "pending";
      call.isActive = true;
      call.expiresAt = expiresAt;
      call.cancelledAt = null;
      call.rejectedAt = null;
      call.updatedAt = new Date();
      activeCalls.set(callId, call);

      // Update in DB
      await Call.findOneAndUpdate(
        { callId: callId },
        {
          status: "pending",
          isActive: true,
          updatedAt: new Date(),
          expiresAt: expiresAt,
          cancelledAt: null,
          rejectedAt: null
        }
      );

      // Emit new request notification
      if (global.io) {
        const initiatorDisplayName = videoCallController.getDisplayName(
          {
            fullName: call.initiator.fullName,
            anonymous: call.initiator.anonymous,
          },
          call.receiver.id,
          call.receiver.type,
          call.initiator.type,
        );

        videoCallController.emitToParticipant(
          global.io,
          call.receiver.id,
          call.receiver.type,
          "incoming_call_request",
          {
            callId,
            roomId: call.roomId,
            from: initiatorDisplayName,
            fromId: call.initiator.id,
            fromType: call.initiator.type,
            fromProfilePhoto: call.initiator.profilePhoto,
            callType: call.type,
            message: call.requestMessage,
            expiresAt,
            remainingSeconds: CALL_REQUEST_TIMEOUT_SECONDS,
            timestamp: new Date(),
          },
        );
      }

      await createNotificationSafely({
        recipientId: call.receiver.id,
        actorId: call.initiator.id,
        type: "call",
        title: `Incoming ${call.type === "voice" || call.type === "audio" ? "voice" : "video"} call request`,
        message: `${call.initiator.fullName} resent the call request.`,
        data: {
          callId,
          roomId: call.roomId,
          callType: call.type,
          status: "pending",
          expiresAt,
        },
        actionUrl: "/calls",
      });

      res.json({
        success: true,
        message: "Call request resent successfully",
        callId,
        status: "pending",
        expiresAt,
      });
    } catch (error) {
      console.error("Error resending request:", error);
      res.status(500).json({
        success: false,
        error: "Failed to resend request",
        details: error.message,
      });
    }
  },

  // 8. Auto-cancel expired call requests (background job)
  cancelExpiredRequests: async () => {
    try {
      const now = new Date();
      let cancelledCount = 0;

      for (const [callId, call] of activeCalls.entries()) {
        if (
          call.status === "pending" &&
          call.expiresAt &&
          new Date(call.expiresAt) < now &&
          call.isActive
        ) {
          call.status = "cancelled";
          call.isActive = false;
          call.cancelledAt = now;
          activeCalls.set(callId, call);

          // Update in DB
          await Call.findOneAndUpdate(
            { callId: callId },
            {
              status: "cancelled",
              cancelledAt: now,
              isActive: false,
            },
          );

          cancelledCount++;

          console.log(`Cancelled expired call request: ${callId}`);

          // Notify both participants so any ringing modal closes immediately.
          if (global.io) {
            const expiredPayload = {
              callId,
              roomId: call.roomId,
              status: "expired",
              message: `Call request expired after ${CALL_REQUEST_TIMEOUT_SECONDS} seconds`,
              timestamp: now,
            };

            videoCallController.emitToParticipant(
              global.io,
              call.initiator.id,
              call.initiator.type,
              "call_expired",
              expiredPayload,
            );
            videoCallController.emitToParticipant(
              global.io,
              call.receiver.id,
              call.receiver.type,
              "call_expired",
              expiredPayload,
            );
            videoCallController.emitToParticipant(
              global.io,
              call.initiator.id,
              call.initiator.type,
              "call-status-update",
              expiredPayload,
            );
            videoCallController.emitToParticipant(
              global.io,
              call.receiver.id,
              call.receiver.type,
              "call-status-update",
              expiredPayload,
            );
          }
        }
      }

      return cancelledCount;
    } catch (error) {
      console.error("Error cancelling expired requests:", error);
      return 0;
    }
  },

  // ==================== STATUS MANAGEMENT ====================

  // 9. Update user status
  updateUserStatus: async (req, res) => {
    try {
      const { userId, status } = req.body;

      if (!["online", "offline", "busy", "away"].includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status",
        });
      }

      const currentStatus = userStatus.get(userId) || {
        status: "offline",
        currentCall: null,
      };
      currentStatus.status = status;
      userStatus.set(userId, currentStatus);

      if (isValidId(userId)) {
        await User.findByIdAndUpdate(userId, {
          $set: { isActive: status === "online" },
        });
      }

      if (global.io) {
        global.io.emit("user_status_changed", {
          userId,
          status,
          timestamp: new Date(),
        });
      }

      res.json({
        success: true,
        message: "Status updated successfully",
        status: currentStatus,
      });
    } catch (error) {
      console.error("Error updating status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to update status",
      });
    }
  },

  // 10. Get user status
  getUserStatus: async (req, res) => {
    try {
      const { userId } = req.params;
      const status = userStatus.get(userId) || {
        status: "offline",
        currentCall: null,
      };

      res.json({
        success: true,
        userId,
        status: status.status,
        currentCall: status.currentCall,
        isAvailable: status.status === "online",
      });
    } catch (error) {
      console.error("Error getting status:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get status",
      });
    }
  },

  // ==================== CALL HISTORY ====================

  // 11. Get call history
getCallHistory: async (req, res) => {
  try {
    const { userId } = req.params;
    const { page = 1, limit = 20, status = "all", type = "all" } = req.query;

    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const query = {
      $and: [
        {
          $or: [
            { callerId: userId },
            { receiverId: userId },
          ],
        },
        {
          $or: [
            { isActive: false },
            { status: { $in: TERMINAL_CALL_STATUSES } },
            { endedAt: { $ne: null } },
            { rejectedAt: { $ne: null } },
            { cancelledAt: { $ne: null } },
          ],
        },
      ],
    };

    if (status !== "all") {
      query.$and.push({ status });
    }

    if (type === "initiated") {
      query.$and.push({ callerId: userId });
    } else if (type === "received") {
      query.$and.push({ receiverId: userId });
    }

    const skip = (parsedPage - 1) * parsedLimit;

    const [total, calls] = await Promise.all([
      Call.countDocuments(query),

      Call.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
    ]);

    const participantIds = [
      ...new Set(
        calls
          .flatMap((call) => [
            call.callerId?.toString(),
            call.receiverId?.toString(),
          ])
          .filter(Boolean)
          .filter((id) => isValidId(id))
      ),
    ];

    const users = participantIds.length
      ? await User.find({
          _id: { $in: participantIds },
        })
          .select("_id fullName full_name name role anonymous avatar profilePhoto")
          .lean()
      : [];

    const userMap = {};

    users.forEach((user) => {
      userMap[user._id.toString()] = user;
    });

    const getDisplayName = (user, fallbackName = "Anonymous User") => {
      if (!user) return fallbackName || "Anonymous User";

      if (user.role === "user") {
        return (
          user.anonymous ||
          user.fullName ||
          user.full_name ||
          user.name ||
          "Anonymous User"
        );
      }

      return (
        user.fullName ||
        user.full_name ||
        user.name ||
        fallbackName ||
        "Unknown User"
      );
    };

    const getAvatar = (user, fallbackAvatar = null) => {
      if (!user) return fallbackAvatar;

      return (
        user.profilePhoto?.url ||
        user.avatar?.url ||
        fallbackAvatar ||
        null
      );
    };

    const formattedCalls = calls.map((call) => {
      const callerId = call.callerId?.toString();
      const receiverId = call.receiverId?.toString();

      const isInitiator = callerId === userId.toString();

      const otherParticipantId = isInitiator ? receiverId : callerId;
      const otherUser = userMap[otherParticipantId];

      const fallbackOtherName = isInitiator
        ? call.receiverName
        : call.callerName;

      const fallbackOtherAvatar = isInitiator
        ? call.receiverAvatar
        : call.callerAvatar;

      const otherParticipantType = isInitiator
        ? call.receiverType
        : call.initiatorType;

      return {
        id: call.callId,

        // Frontend me ye naam show karo
        with: getDisplayName(otherUser, fallbackOtherName),

        withId: otherParticipantId,
        withType: otherParticipantType,
        withProfilePhoto: getAvatar(otherUser, fallbackOtherAvatar),

        type: call.callType,
        duration: call.duration,
        timestamp: call.createdAt,
        status: call.status,

        role: isInitiator ? "initiator" : "receiver",
        endedBy: call.endedBy,
        acceptedAt: call.acceptedAt,
        rejectedAt: call.rejectedAt,

        callerName: getDisplayName(userMap[callerId], call.callerName),
        receiverName: getDisplayName(userMap[receiverId], call.receiverName),

        callerAnonymousName: userMap[callerId]?.anonymous || null,
        receiverAnonymousName: userMap[receiverId]?.anonymous || null,
      };
    });

    return res.json({
      success: true,
      history: formattedCalls,
      total,
      page: parsedPage,
      totalPages: Math.ceil(total / parsedLimit),
    });
  } catch (error) {
    console.error("Error fetching history:", error);

    return res.status(500).json({
      success: false,
      error: "Failed to fetch history",
      message: error.message,
    });
  }
},

  deleteCall: async (req, res) => {
    try {
      const { callId } = req.params;
      const userId = req.user?._id || req.user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: "Authentication required",
        });
      }

      const query = isValidId(callId)
        ? { $or: [{ callId }, { _id: callId }] }
        : { callId };

      const call = await Call.findOne(query);

      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Call not found",
        });
      }

      const isParticipant =
        String(call.callerId) === String(userId) ||
        String(call.receiverId) === String(userId);

      if (!isParticipant) {
        return res.status(403).json({
          success: false,
          error: "You can delete only your own call history",
        });
      }

      const canDelete =
        !call.isActive ||
        TERMINAL_CALL_STATUSES.includes(call.status) ||
        call.endedAt ||
        call.rejectedAt ||
        call.cancelledAt;

      if (!canDelete) {
        return res.status(409).json({
          success: false,
          error: "Active call cannot be deleted",
        });
      }

      await call.deleteOne();

      return res.json({
        success: true,
        message: "Call deleted successfully",
        deletedCallId: call.callId,
      });
    } catch (error) {
      console.error("Error deleting call:", error);
      return res.status(500).json({
        success: false,
        error: "Failed to delete call",
        message: error.message,
      });
    }
  },

  // 12. Get active calls
  getActiveCalls: async (req, res) => {
    try {
      const { userId } = req.params;
      const { userType } = req.query;
      const activeCallsList = [];

      for (const [callId, call] of activeCalls.entries()) {
        if (
          call.status !== "ended" &&
          call.isActive &&
          (String(call.initiator.id) === String(userId) || String(call.receiver.id) === String(userId))
        ) {
          const isInitiator = String(call.initiator.id) === String(userId);
          const otherParticipant = isInitiator ? call.receiver : call.initiator;

          // Get display name for the other participant
          const otherDisplayName = videoCallController.getDisplayName(
            {
              fullName: otherParticipant.fullName,
              anonymous: otherParticipant.anonymous,
            },
            userId,
            userType,
            otherParticipant.type,
          );

          activeCallsList.push({
            callId,
            roomId: call.roomId,
            with: {
              id: otherParticipant.id,
              displayName: otherDisplayName,
              fullName: otherParticipant.fullName,
              type: otherParticipant.type,
              profilePhoto: otherParticipant.profilePhoto,
            },
            status: call.status,
            startTime: call.startTime,
            createdAt: call.createdAt,
            participants: Array.from(call.participants.values()),
            duration: call.startTime
              ? Math.floor((new Date() - call.startTime) / 1000)
              : 0,
          });
        }
      }

      res.json({
        success: true,
        activeCalls: activeCallsList,
        count: activeCallsList.length,
      });
    } catch (error) {
      console.error("Error fetching active calls:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch active calls",
      });
    }
  },

  // 13. Get call details
  getCallDetails: async (req, res) => {
    try {
      const { callId } = req.params;
      const { userId, userType } = req.query;

      let call = activeCalls.get(callId);
      let isActive = true;

      if (!call) {
        call = callHistory.find((c) => c.id === callId);
        isActive = false;
      }

      if (!call) {
        return res.status(404).json({
          success: false,
          error: "Call not found",
        });
      }

      // Get display names from the perspective of the requesting user
      const initiatorDisplayName = videoCallController.getDisplayName(
        {
          fullName: call.initiator.fullName,
          anonymous: call.initiator.anonymous,
        },
        userId,
        userType,
        call.initiator.type,
      );

      const receiverDisplayName = videoCallController.getDisplayName(
        {
          fullName: call.receiver.fullName,
          anonymous: call.receiver.anonymous,
        },
        userId,
        userType,
        call.receiver.type,
      );

      res.json({
        success: true,
        call: {
          id: call.id || call.callId,
          roomId: call.roomId,
          type: call.type,
          status: call.status,
          initiator: {
            ...call.initiator,
            displayName: initiatorDisplayName,
          },
          receiver: {
            ...call.receiver,
            displayName: receiverDisplayName,
          },
          requestMessage: call.requestMessage,
          createdAt: call.createdAt,
          acceptedAt: call.acceptedAt,
          rejectedAt: call.rejectedAt,
          cancelledAt: call.cancelledAt,
          startTime: call.startTime,
          endTime: call.endTime,
          duration: call.duration,
          participants: isActive
            ? Array.from(call.participants.values())
            : call.participants,
          endedBy: call.endedBy,
          expiresAt: call.expiresAt,
        },
        isActive,
      });
    } catch (error) {
      console.error("Error fetching call details:", error);
      res.status(500).json({
        success: false,
        error: "Failed to fetch call details",
      });
    }
  },

  // ==================== UTILITY ENDPOINTS ====================

  // 14. Get all pending calls (for debugging)
  getAllPendingCalls: async (req, res) => {
    try {
      const pendingCalls = [];

      for (const [callId, call] of activeCalls.entries()) {
        if (call.status === "pending" && call.isActive) {
          const remainingSeconds = call.expiresAt
            ? Math.max(0, Math.floor((call.expiresAt - new Date()) / 1000))
            : null;

          pendingCalls.push({
            callId: call.callId,
            initiator: call.initiator,
            receiver: call.receiver,
            expiresAt: call.expiresAt,
            remainingSeconds,
            createdAt: call.createdAt,
          });
        }
      }

      res.json({
        success: true,
        pendingCalls,
        count: pendingCalls.length,
      });
    } catch (error) {
      console.error("Error getting pending calls:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get pending calls",
      });
    }
  },

  // 15. Test endpoint - get all calls
  getAllCalls: async (req, res) => {
    try {
      const allCalls = [];

      for (const [callId, call] of activeCalls.entries()) {
        allCalls.push({
          callId: call.callId,
          initiator: call.initiator,
          receiver: call.receiver,
          status: call.status,
          isActive: call.isActive,
          expiresAt: call.expiresAt,
          participants: Array.from(call.participants.values()),
        });
      }

      res.json({
        success: true,
        activeCalls: allCalls,
        history: callHistory,
        userStatus: Array.from(userStatus.entries()),
        activeCount: activeCalls.size,
        historyCount: callHistory.length,
      });
    } catch (error) {
      console.error("Error getting all calls:", error);
      res.status(500).json({
        success: false,
        error: "Failed to get calls",
      });
    }
  },
  handleWebRTCSignaling: (io, socket) => {
    // When user joins a call room
    socket.on("join-call", ({ callId, userId }) => {
      socket.join(`call_${callId}`);
      socket.to(`call_${callId}`).emit("user-joined", { userId });
      console.log(`User ${userId} joined call room ${callId}`);
    });

    // Offer (from caller to receiver)
    socket.on("offer", ({ callId, offer, userId }) => {
      socket.to(`call_${callId}`).emit("offer", {
        callId,
        offer,
        userId,
        from: userId,
      });
      console.log(`Offer sent from ${userId} in call ${callId}`);
    });

    // Answer (from receiver to caller)
    socket.on("answer", ({ callId, answer, userId }) => {
      socket.to(`call_${callId}`).emit("answer", {
        callId,
        answer,
        userId,
        from: userId,
      });
      console.log(`Answer sent from ${userId} in call ${callId}`);
    });

    // ICE Candidates (for NAT traversal)
    socket.on("ice-candidate", ({ callId, candidate, userId }) => {
      socket.to(`call_${callId}`).emit("ice-candidate", {
        callId,
        candidate,
        userId,
        from: userId,
      });
      console.log(`ICE candidate from ${userId} in call ${callId}`);
    });

    // Toggle video/audio
    socket.on("toggle-video", ({ callId, userId, enabled }) => {
      socket.to(`call_${callId}`).emit("video-toggled", { userId, enabled });
    });

    socket.on("toggle-audio", ({ callId, userId, enabled }) => {
      socket.to(`call_${callId}`).emit("audio-toggled", { userId, enabled });
    });

    // Leave call
    socket.on("leave-call", ({ callId, userId }) => {
      socket.leave(`call_${callId}`);
      socket.to(`call_${callId}`).emit("user-left", { userId });
      console.log(`User ${userId} left call room ${callId}`);
    });
  },
};

// Auto-cancel expired requests every second
if (process.env.NODE_ENV !== "test") setInterval(async () => {
  const cancelled = await videoCallController.cancelExpiredRequests();
  if (cancelled > 0) {
    console.log(`Auto-cancelled ${cancelled} expired call requests`);
  }
}, 1000);
