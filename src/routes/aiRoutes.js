// import express from "express";
// import axios from "axios";
// import { translatePlainText } from "../controllers/translateController.js";

// const router = express.Router();
// const aiCache = new Map();
// const REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
// const REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || "alloy";
// const REALTIME_ROUTE_VERSION = "webrtc-blob-sdp-2026-06-27";

// const REALTIME_SYSTEM_INSTRUCTIONS = `
// You are Humaeli AI Assistant, a warm voice companion for mental health and general wellbeing support.
// Keep voice replies short, natural, and supportive. Ask one gentle follow-up question only when it helps.
// You are not a replacement for a doctor, therapist, emergency service, or crisis line.
// If the user mentions self-harm, suicide, harming others, abuse, coercion, feeling unsafe, or a medical emergency:
// 1. Respond calmly and directly.
// 2. Encourage immediate help from local emergency services or a trusted person nearby.
// 3. For India, mention iCall 9152987821, AASRA 9820466726, Vandrevala Foundation 1860 2662 345, and Childline 1098 for minors.
// 4. Encourage connecting with a human counselor in the app.
// Do not give instructions for self-harm, violence, illegal activity, sexual content involving minors, diagnosis, or medication.
// `;

// const buildRealtimeSession = () => ({
//   type: "realtime",
//   model: REALTIME_MODEL,
//   audio: {
//     output: {
//       voice: REALTIME_VOICE,
//     },
//   },
//   instructions: REALTIME_SYSTEM_INSTRUCTIONS,
// });

// const exchangeRealtimeSdp = async (offerSdp) => {
//   const normalizedOfferSdp = String(offerSdp || "").replace(/\r?\n/g, "\r\n");
//   const sessionConfig = JSON.stringify(buildRealtimeSession());
//   const formData = new FormData();
//   formData.set(
//     "sdp",
//     new Blob([normalizedOfferSdp], { type: "application/sdp" }),
//     "offer.sdp",
//   );
//   formData.set(
//     "session",
//     new Blob([sessionConfig], { type: "application/json" }),
//     "session.json",
//   );

//   const response = await fetch("https://api.openai.com/v1/realtime/calls", {
//     method: "POST",
//     headers: {
//       Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
//     },
//     body: formData,
//     signal: AbortSignal.timeout(30000),
//   });

//   const responseText = await response.text();

//   if (!response.ok) {
//     const error = new Error(responseText || response.statusText);
//     error.response = {
//       status: response.status,
//       data: responseText,
//     };
//     throw error;
//   }

//   return responseText;
// };

// const extractSdpOffer = (body) => {
//   if (Buffer.isBuffer(body)) return body.toString("utf8").trim();
//   if (typeof body === "string") {
//     const text = body.trim();
//     if (text.startsWith("{")) {
//       try {
//         const parsed = JSON.parse(text);
//         return String(parsed.sdp || parsed.offer || parsed.offerSdp || "").trim();
//       } catch {
//         return text;
//       }
//     }
//     return text;
//   }
//   if (body && typeof body === "object") {
//     return String(body.sdp || body.offer || body.offerSdp || "").trim();
//   }
//   return "";
// };

// router.post(
//   "/realtime/session",
//   express.text({ type: ["application/sdp", "text/plain", "application/octet-stream"], limit: "1mb" }),
//   async (req, res) => {
//     try {
//       const offerSdp = extractSdpOffer(req.body);
//       res.set("X-AI-Realtime-Route", REALTIME_ROUTE_VERSION);

//       if (!offerSdp || !offerSdp.includes("v=0")) {
//         console.warn("Invalid realtime SDP offer received:", {
//           routeVersion: REALTIME_ROUTE_VERSION,
//           contentType: req.headers["content-type"],
//           bodyType: Buffer.isBuffer(req.body) ? "buffer" : typeof req.body,
//           bodyLength:
//             typeof req.body === "string"
//               ? req.body.length
//               : Buffer.isBuffer(req.body)
//               ? req.body.length
//               : JSON.stringify(req.body || {}).length,
//         });
//         return res.status(400).json({
//           success: false,
//           message: "Valid SDP offer is required",
//           routeVersion: REALTIME_ROUTE_VERSION,
//         });
//       }

//       if (!process.env.OPENAI_API_KEY) {
//         return res.status(500).json({
//           success: false,
//           message: "OpenAI API key is not configured on the backend",
//         });
//       }

//       const answerSdp = await exchangeRealtimeSdp(offerSdp);

//       res
//         .status(200)
//         .type("application/sdp")
//         .send(answerSdp);
//     } catch (error) {
//       const statusCode = error?.response?.status || 500;
//       const providerMessage =
//         typeof error?.response?.data === "string"
//           ? error.response.data
//           : error?.response?.data?.error?.message ||
//             error?.response?.data?.message ||
//             error.message;

//       console.error("OpenAI realtime session error:", {
//         routeVersion: REALTIME_ROUTE_VERSION,
//         statusCode,
//         message: providerMessage,
//         sdpLength: extractSdpOffer(req.body).length,
//         sdpStartsWith: extractSdpOffer(req.body).slice(0, 12),
//       });

//       res.status(statusCode).json({
//         success: false,
//         message: "AI voice call session start nahi ho paya",
//         error: providerMessage,
//         routeVersion: REALTIME_ROUTE_VERSION,
//         sdpLength: extractSdpOffer(req.body).length,
//       });
//     }
//   },
// );

// const getBaseLanguage = (language = "en-IN") => {
//   return String(language || "en-IN").trim().split("-")[0].toLowerCase();
// };

// const getQuickReply = (message, language = "hi-IN") => {
//   const text = String(message || "").toLowerCase().trim();
//   const lang = getBaseLanguage(language || "hi-IN");

//   if (["hi", "hello", "hey", "hii", "namaste"].includes(text)) {
//     if (lang === "en") {
//       return "Hello! I am Humaeli AI. How are you feeling today?";
//     }

//     if (lang === "mr") {
//       return "Namaskar! Mi Humaeli AI aahe. Tumhala kase vatate aahe?";
//     }

//     return "Namaste! Main Humaeli AI hu. Aap kaise feel kar rahe ho?";
//   }

//   if (
//     text.includes("mood off") ||
//     text.includes("stress") ||
//     text.includes("tension") ||
//     text.includes("sad") ||
//     text.includes("mood thik nahi") ||
//     text.includes("mood thik nhi")
//   ) {
//     if (lang === "en") {
//       return "I understand. Some days feel heavy. Take a few deep breaths, drink some water, and rest for a few minutes. If you want, tell me what happened today.";
//     }

//     if (lang === "mr") {
//       return "Samajhu shakto, kadhi-kadhi mood thik nasane normal aahe. Thoda deep breathing kara, pani pya ani 5 minute shant basa. Jar mann asel tar mala sanga, aaj kay zala?";
//     }

//     return "Samajh sakta hu, kabhi-kabhi mood off hona normal hai. Aap 2 minute deep breathing karo aur thoda pani piyo. Agar mann ho to batao, aaj kya hua?";
//   }

//   return null;
// };

// router.post("/message", async (req, res) => {
//   const startTime = Date.now();
//   console.log("AI request started");

//   try {
//     const { message, language } = req.body;

//     if (!message || !message.trim()) {
//       return res.status(400).json({
//         success: false,
//         message: "Message is required",
//       });
//     }

//     const quickReply = getQuickReply(message, language);

//     if (quickReply) {
//       console.log("Quick reply time:", Date.now() - startTime, "ms");
//       console.log("Total AI route time:", Date.now() - startTime, "ms");

//       return res.json({
//         success: true,
//         reply: quickReply,
//         source: "quick_reply",
//         language: language || "en-IN",
//         data: {
//           aiResponse: quickReply,
//           quickReplies: null,
//           sessionId: null,
//         },
//       });
//     }

//     const cacheKey = `${language || "en-IN"}:${message.trim().toLowerCase()}`;

//     if (aiCache.has(cacheKey)) {
//       const cachedReply = aiCache.get(cacheKey);

//       console.log("Cache reply time:", Date.now() - startTime, "ms");
//       console.log("Total AI route time:", Date.now() - startTime, "ms");

//       return res.json({
//         success: true,
//         reply: cachedReply,
//         source: "cache",
//         language: language || "en-IN",
//         data: {
//           aiResponse: cachedReply,
//           quickReplies: null,
//           sessionId: null,
//         },
//       });
//     }

//     const targetLang = getBaseLanguage(language);

//     let englishMessage = message.trim();

//     // 1. User message selected language se English me translate hoga
//     const t1 = Date.now();
//     if (targetLang !== "en") {
//       const translatedUserMessage = await translatePlainText({
//         text: message,
//         from: targetLang,
//         to: "en",
//       });

//       englishMessage = translatedUserMessage.translatedText;
//     }
//     console.log("Translate to English time:", Date.now() - t1, "ms");

//     console.log("User original:", message);
//     console.log("User English:", englishMessage);

//     // 2. Python private AI API call hogi
//     const t2 = Date.now();
//     const aiResponse = await axios.post(
//       `${process.env.AI_SERVICE_URL}/chat`,
//       {
//         message: englishMessage,
//         language: "en",
//         use_rag: true,
//       },
//       {
//         headers: {
//           "x-api-key": process.env.PRIVATE_AI_KEY,
//           "Content-Type": "application/json",
//         },
//         timeout: 180000,
//       }
//     );
//     console.log("Python AI time:", Date.now() - t2, "ms");

//     const englishReply = aiResponse.data?.reply || "";

//     if (!englishReply) {
//       throw new Error("AI reply missing");
//     }

//     console.log("AI English reply:", englishReply);

//     let finalReply = englishReply;

//     // 3. English reply ko user selected language me translate karna
//     const t3 = Date.now();
//     if (targetLang !== "en") {
//       const translatedAiReply = await translatePlainText({
//         text: englishReply,
//         from: "en",
//         to: targetLang,
//       });

//       finalReply = translatedAiReply.translatedText;
//     }
//     console.log("Translate final time:", Date.now() - t3, "ms");

//     console.log("Final reply:", finalReply);
//     console.log("Total AI route time:", Date.now() - startTime, "ms");

//     aiCache.set(cacheKey, finalReply);

//     return res.json({
//       success: true,
//       reply: finalReply,
//       source: "ai",
//       language: language || "en-IN",
//       data: {
//         aiResponse: finalReply,
//         englishMessage,
//         englishReply,
//         quickReplies: null,
//         sessionId: null,
//       },
//     });
//     } catch (error) {
//     const statusCode =
//       error.statusCode ||
//       error?.response?.status ||
//       500;

//     console.error("AI message error:", {
//       statusCode,
//       message: error.message,
//       data: error?.response?.data,
//     });

//     return res.status(statusCode).json({
//       success: false,
//       message:
//         statusCode === 401
//           ? "Azure Translator authorization failed. Please check Azure key, endpoint and region."
//           : statusCode === 429
//           ? "Translator quota/rate limit exceeded. Please try again later."
//           : "AI reply generate nahi ho paya",
//       error: error.message,
//     });
//   }
// });

// export default router;


import express from "express";
import axios from "axios";
import { translatePlainText } from "../controllers/translateController.js";
import { optionalAuth } from "../middleware/authMiddleware.js";
import { buildRealtimeDataContext } from "../services/aiRealtimeContext.js";

const router = express.Router();
const aiCache = new Map();
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
  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  if (typeof body === "string") {
    const rawText = body;

    if (rawText.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(rawText);
        return String(parsed.sdp || parsed.offer || parsed.offerSdp || "");
      } catch {
        return rawText;
      }
    }

    return rawText;
  }

  if (body && typeof body === "object") {
    return String(body.sdp || body.offer || body.offerSdp || "");
  }

  return "";
};

router.post(
  "/realtime/session",
  optionalAuth,
  express.text({ type: ["application/sdp", "text/plain", "application/octet-stream"], limit: "1mb" }),
  async (req, res) => {
    try {
      const offerSdp = extractSdpOffer(req.body);
      res.set("X-AI-Realtime-Route", REALTIME_ROUTE_VERSION);

      if (!offerSdp || !offerSdp.includes("v=0")) {
        console.warn("Invalid realtime SDP offer received:", {
          routeVersion: REALTIME_ROUTE_VERSION,
          contentType: req.headers["content-type"],
          bodyType: Buffer.isBuffer(req.body) ? "buffer" : typeof req.body,
          bodyLength:
            typeof req.body === "string"
              ? req.body.length
              : Buffer.isBuffer(req.body)
              ? req.body.length
              : JSON.stringify(req.body || {}).length,
        });
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

      res
        .status(200)
        .type("application/sdp")
        .send(answerSdp);
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

      res.status(statusCode).json({
        success: false,
        message: "AI voice call session start nahi ho paya",
        error: providerMessage,
        routeVersion: REALTIME_ROUTE_VERSION,
        sdpLength: extractSdpOffer(req.body).length,
      });
    }
  },
);

const getBaseLanguage = (language = "en-IN") => {
  return String(language || "en-IN").trim().split("-")[0].toLowerCase();
};

const getQuickReply = (message, language = "hi-IN") => {
  const text = String(message || "").toLowerCase().trim();
  const lang = getBaseLanguage(language || "hi-IN");

  if (["hi", "hello", "hey", "hii", "namaste"].includes(text)) {
    if (lang === "en") {
      return "Hello! I am Humaeli AI. How are you feeling today?";
    }

    if (lang === "mr") {
      return "Namaskar! Mi Humaeli AI aahe. Tumhala kase vatate aahe?";
    }

    return "Namaste! Main Humaeli AI hu. Aap kaise feel kar rahe ho?";
  }

  if (
    text.includes("mood off") ||
    text.includes("stress") ||
    text.includes("tension") ||
    text.includes("sad") ||
    text.includes("mood thik nahi") ||
    text.includes("mood thik nhi")
  ) {
    if (lang === "en") {
      return "I understand. Some days feel heavy. Take a few deep breaths, drink some water, and rest for a few minutes. If you want, tell me what happened today.";
    }

    if (lang === "mr") {
      return "Samajhu shakto, kadhi-kadhi mood thik nasane normal aahe. Thoda deep breathing kara, pani pya ani 5 minute shant basa. Jar mann asel tar mala sanga, aaj kay zala?";
    }

    return "Samajh sakta hu, kabhi-kabhi mood off hona normal hai. Aap 2 minute deep breathing karo aur thoda pani piyo. Agar mann ho to batao, aaj kya hua?";
  }

  return null;
};

router.post("/message", async (req, res) => {
  const startTime = Date.now();
  console.log("AI request started");

  try {
    const { message, language } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const quickReply = getQuickReply(message, language);

    if (quickReply) {
      console.log("Quick reply time:", Date.now() - startTime, "ms");
      console.log("Total AI route time:", Date.now() - startTime, "ms");

      return res.json({
        success: true,
        reply: quickReply,
        source: "quick_reply",
        language: language || "en-IN",
        data: {
          aiResponse: quickReply,
          quickReplies: null,
          sessionId: null,
        },
      });
    }

    const cacheKey = `${language || "en-IN"}:${message.trim().toLowerCase()}`;

    if (aiCache.has(cacheKey)) {
      const cachedReply = aiCache.get(cacheKey);

      console.log("Cache reply time:", Date.now() - startTime, "ms");
      console.log("Total AI route time:", Date.now() - startTime, "ms");

      return res.json({
        success: true,
        reply: cachedReply,
        source: "cache",
        language: language || "en-IN",
        data: {
          aiResponse: cachedReply,
          quickReplies: null,
          sessionId: null,
        },
      });
    }

    const targetLang = getBaseLanguage(language);

    let englishMessage = message.trim();

    // 1. User message selected language se English me translate hoga
    const t1 = Date.now();
    if (targetLang !== "en") {
      const translatedUserMessage = await translatePlainText({
        text: message,
        from: targetLang,
        to: "en",
      });

      englishMessage = translatedUserMessage.translatedText;
    }
    console.log("Translate to English time:", Date.now() - t1, "ms");

    console.log("User original:", message);
    console.log("User English:", englishMessage);

    // 2. Python private AI API call hogi
    const t2 = Date.now();
    const aiResponse = await axios.post(
      `${process.env.AI_SERVICE_URL}/chat`,
      {
        message: englishMessage,
        language: "en",
        use_rag: true,
      },
      {
        headers: {
          "x-api-key": process.env.PRIVATE_AI_KEY,
          "Content-Type": "application/json",
        },
        timeout: 180000,
      }
    );
    console.log("Python AI time:", Date.now() - t2, "ms");

    const englishReply = aiResponse.data?.reply || "";

    if (!englishReply) {
      throw new Error("AI reply missing");
    }

    console.log("AI English reply:", englishReply);

    let finalReply = englishReply;

    // 3. English reply ko user selected language me translate karna
    const t3 = Date.now();
    if (targetLang !== "en") {
      const translatedAiReply = await translatePlainText({
        text: englishReply,
        from: "en",
        to: targetLang,
      });

      finalReply = translatedAiReply.translatedText;
    }
    console.log("Translate final time:", Date.now() - t3, "ms");

    console.log("Final reply:", finalReply);
    console.log("Total AI route time:", Date.now() - startTime, "ms");

    aiCache.set(cacheKey, finalReply);

    return res.json({
      success: true,
      reply: finalReply,
      source: "ai",
      language: language || "en-IN",
      data: {
        aiResponse: finalReply,
        englishMessage,
        englishReply,
        quickReplies: null,
        sessionId: null,
      },
    });
    } catch (error) {
    const statusCode =
      error.statusCode ||
      error?.response?.status ||
      500;

    console.error("AI message error:", {
      statusCode,
      message: error.message,
      data: error?.response?.data,
    });

    return res.status(statusCode).json({
      success: false,
      message:
        statusCode === 401
          ? "Azure Translator authorization failed. Please check Azure key, endpoint and region."
          : statusCode === 429
          ? "Translator quota/rate limit exceeded. Please try again later."
          : "AI reply generate nahi ho paya",
      error: error.message,
    });
  }
});

export default router;
