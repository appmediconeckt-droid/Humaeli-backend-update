import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { buildRealtimeDataContext } from "../services/aiRealtimeContext.js";

const router = express.Router();

const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "shimmer";
const REALTIME_ROUTE_VERSION = "webrtc-text-sdp-2026-06-27";

const REALTIME_SYSTEM_INSTRUCTIONS = `
You are Humaeli AI Assistant, a warm voice companion for mental health and general wellbeing support.
Do not speak first when a voice call starts. Stay silent and wait until the user says something, then respond to that user message.
Keep voice replies short, natural, and supportive. Ask one gentle follow-up question only when it helps.
Use a warm female-presenting assistant persona. In Hindi, Hinglish, and other gendered languages, always refer to yourself with feminine grammar, for example "main bol rahi hoon", "main samajh rahi hoon", "main madad kar rahi hoon". Never say masculine self-references like "main bol raha hoon" or "main kar raha hoon".
You are not a replacement for a doctor, therapist, emergency service, or crisis line.
If the user mentions self-harm, suicide, harming others, abuse, coercion, feeling unsafe, or a medical emergency:
1. Respond calmly and directly.
2. Encourage immediate help from local emergency services or a trusted person nearby.
3. For India, mention iCall 9152987821, AASRA 9820466726, Vandrevala Foundation 1860 2662 345, and Childline 1098 for minors.
4. Encourage connecting with a human counselor in the app.
Do not give instructions for self-harm, violence, illegal activity, sexual content involving minors, diagnosis, or medication.
`;

const buildRealtimeSession = (dataContext = "") => ({
  type: "realtime",
  model: REALTIME_MODEL,
  audio: {
    input: {
      transcription: {
        model: "gpt-4o-mini-transcribe",
      },
      turn_detection: {
        type: "server_vad",
        create_response: true,
        interrupt_response: true,
      },
    },
    output: {
      voice: REALTIME_VOICE,
    },
  },
  instructions: dataContext
    ? `${REALTIME_SYSTEM_INSTRUCTIONS}\n\n${dataContext}`
    : REALTIME_SYSTEM_INSTRUCTIONS,
});

const exchangeRealtimeSdp = async (offerSdp, user) => {
  const normalizedOfferSdp = String(offerSdp || "").replace(/\r?\n/g, "\r\n");
  const dataContext = await buildRealtimeDataContext(user);
  const sessionConfig = JSON.stringify(buildRealtimeSession(dataContext));

  const formData = new FormData();

  // Important fix: Blob/file field nahi bhejna hai.
  // OpenAI ko sdp aur session plain form fields chahiye.
  formData.set("sdp", normalizedOfferSdp);
  formData.set("session", sessionConfig);

  const response = await fetch("https://api.openai.com/v1/realtime/calls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: formData,
    signal: AbortSignal.timeout(30000),
  });

  const responseText = await response.text();

  if (!response.ok) {
    const error = new Error(responseText || response.statusText);
    error.response = {
      status: response.status,
      data: responseText,
    };
    throw error;
  }

  return responseText;
};

const extractSdpOffer = (body) => {
  if (Buffer.isBuffer(body)) return body.toString("utf8").trim();

  if (typeof body === "string") {
    const text = body.trim();

    if (text.startsWith("{")) {
      try {
        const parsed = JSON.parse(text);
        return String(parsed.sdp || parsed.offer || parsed.offerSdp || "").trim();
      } catch {
        return text;
      }
    }

    return text;
  }

  if (body && typeof body === "object") {
    return String(body.sdp || body.offer || body.offerSdp || "").trim();
  }

  return "";
};

router.post(
  "/session",
  optionalAuth,
  express.text({
    type: ["application/sdp", "text/plain", "application/octet-stream"],
    limit: "1mb",
  }),
  async (req, res) => {
    try {
      const offerSdp = extractSdpOffer(req.body);
      res.set("X-AI-Realtime-Route", REALTIME_ROUTE_VERSION);

      if (!offerSdp || !offerSdp.includes("v=0")) {
        return res.status(400).json({
          success: false,
          message: "Valid SDP offer is required",
          routeVersion: REALTIME_ROUTE_VERSION,
        });
      }

      if (!process.env.OPENAI_API_KEY) {
        return res.status(500).json({
          success: false,
          message: "OpenAI API key is not configured on the backend",
        });
      }

      const answerSdp = await exchangeRealtimeSdp(offerSdp, req.user);

      return res.status(200).type("application/sdp").send(answerSdp);
    } catch (error) {
      const statusCode = error?.response?.status || 500;

      const providerMessage =
        typeof error?.response?.data === "string"
          ? error.response.data
          : error?.response?.data?.error?.message ||
            error?.response?.data?.message ||
            error.message;

      console.error("OpenAI realtime session error:", {
        routeVersion: REALTIME_ROUTE_VERSION,
        statusCode,
        message: providerMessage,
        sdpLength: extractSdpOffer(req.body).length,
        sdpStartsWith: extractSdpOffer(req.body).slice(0, 12),
      });

      return res.status(statusCode).json({
        success: false,
        message: "AI voice call session start nahi ho paya",
        error: providerMessage,
        routeVersion: REALTIME_ROUTE_VERSION,
        sdpLength: extractSdpOffer(req.body).length,
      });
    }
  }
);

export default router;
