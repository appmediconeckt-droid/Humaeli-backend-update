// import {
//   detectLanguageWithGoogle,
//   translateTextWithGoogle,
// } from "../services/googleTranslateService.js";

// const SUPPORTED_LANGUAGES = [
//   { code: "en", name: "English" },
//   { code: "hi", name: "Hindi" },
//   { code: "ta", name: "Tamil" },
//   { code: "te", name: "Telugu" },
//   { code: "kn", name: "Kannada" },
//   { code: "ml", name: "Malayalam" },
//   { code: "bn", name: "Bengali" },
//   { code: "pa", name: "Punjabi" },
//   { code: "mr", name: "Marathi" },
//   { code: "gu", name: "Gujarati" },
//   { code: "ur", name: "Urdu" },
// ];

// export const translateText = async (req, res) => {
//   try {
//     const { text, targetLanguage, sourceLanguage, format } = req.body || {};
//     const trimmedText = typeof text === "string" ? text.trim() : "";

//     if (!trimmedText) {
//       return res.status(400).json({
//         success: false,
//         message: "text is required",
//       });
//     }

//     if (!targetLanguage || typeof targetLanguage !== "string") {
//       return res.status(400).json({
//         success: false,
//         message: "targetLanguage is required",
//       });
//     }

//     const translation = await translateTextWithGoogle({
//       text: trimmedText,
//       targetLanguage,
//       sourceLanguage,
//       format,
//     });

//     return res.json({
//       success: true,
//       ...translation,
//     });
//   } catch (error) {
//     console.error("Google translate error:", error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to translate text",
//       error: error.message,
//     });
//   }
// };

// export const detectLanguage = async (req, res) => {
//   try {
//     const { text } = req.body || {};
//     const trimmedText = typeof text === "string" ? text.trim() : "";

//     if (!trimmedText) {
//       return res.status(400).json({
//         success: false,
//         message: "text is required",
//       });
//     }

//     const detection = await detectLanguageWithGoogle({ text: trimmedText });

//     return res.json({
//       success: true,
//       ...detection,
//     });
//   } catch (error) {
//     console.error("Google language detect error:", error.message);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to detect language",
//       error: error.message,
//     });
//   }
// };

// export const getSupportedLanguages = (_req, res) => {
//   return res.json({
//     success: true,
//     languages: SUPPORTED_LANGUAGES,
//   });
// };


import axios from "axios";
import OpenAI from "openai";

let translationOpenAIClient = null;
const translateWithOpenAI = async ({ trimmedText, targetLanguage }) => {
  if (!process.env.OPENAI_API_KEY) return null;
  if (!translationOpenAIClient) {
    translationOpenAIClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }

  const response = await translationOpenAIClient.chat.completions.create({
    model: process.env.OPENAI_TRANSLATION_MODEL || "gpt-4o-mini",
    temperature: 0,
    max_tokens: 500,
    messages: [
      {
        role: "system",
        content:
          "Translate the text into the requested language. Return only the translated text. Preserve meaning, names, numbers, emojis, and medical terms. Use the target language's normal native script.",
      },
      {
        role: "user",
        content: `Target language code: ${targetLanguage}\nText: ${trimmedText}`,
      },
    ],
  });

  const translatedText = response.choices?.[0]?.message?.content?.trim();
  if (!translatedText) return null;
  return {
    originalText: trimmedText,
    translatedText,
    source: "openai",
    sourceLanguage: null,
    targetLanguage,
  };
};

const translationChanged = (result, originalText) =>
  Boolean(
    result?.translatedText?.trim() &&
      result.translatedText.trim().toLocaleLowerCase() !==
        originalText.trim().toLocaleLowerCase(),
  );

const normalizeLanguageCode = (language) => {
  if (!language || typeof language !== "string") return undefined;
  return language.trim().split("-")[0].toLowerCase();
};

const GOOGLE_LANGUAGE_MAP = {
  he: "iw",
  fil: "tl",
  no: "no",
  "zh-cn": "zh-CN",
  "zh-tw": "zh-TW",
};

const translateWithGoogle = async ({
  trimmedText,
  sourceLanguage,
  targetLanguage,
}) => {
  const target = GOOGLE_LANGUAGE_MAP[targetLanguage] || targetLanguage;
  const source = GOOGLE_LANGUAGE_MAP[sourceLanguage] || sourceLanguage || "auto";
  const googleUrl =
    "https://translate.googleapis.com/translate_a/single" +
    `?client=gtx&sl=${encodeURIComponent(source)}` +
    `&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(trimmedText)}`;

  const response = await axios.get(googleUrl, { timeout: 12000 });
  const segments = response.data?.[0];
  const translatedText = Array.isArray(segments)
    ? segments.map((segment) => segment?.[0] || "").join("")
    : trimmedText;

  return {
    originalText: trimmedText,
    translatedText: translatedText || trimmedText,
    source: "google",
    sourceLanguage: sourceLanguage || null,
    targetLanguage,
    data: response.data,
  };
};

const translateWithMyMemory = async ({
  trimmedText,
  sourceLanguage,
  targetLanguage,
}) => {
  const fallbackSourceLanguage = sourceLanguage || "Autodetect";
  const langPair = `${fallbackSourceLanguage}|${targetLanguage}`;
  const myMemoryUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(trimmedText)}&langpair=${encodeURIComponent(langPair)}`;

  const response = await axios.get(myMemoryUrl, { timeout: 10000 });
  const translatedText =
    response.data?.responseData?.translatedText || trimmedText;

  return {
    originalText: trimmedText,
    translatedText,
    source: "mymemory",
    sourceLanguage: sourceLanguage || null,
    targetLanguage,
    data: response.data,
  };
};

export const translatePlainText = async ({ text, to, from }) => {
  const trimmedText = typeof text === "string" ? text.trim() : "";
  const targetLanguage = normalizeLanguageCode(to);
  const sourceLanguage = normalizeLanguageCode(from);

  if (!trimmedText) {
    const error = new Error("text is required");
    error.statusCode = 400;
    throw error;
  }

  if (!targetLanguage) {
    const error = new Error("to language is required");
    error.statusCode = 400;
    throw error;
  }

  if (sourceLanguage && sourceLanguage === targetLanguage) {
    return {
      originalText: trimmedText,
      translatedText: trimmedText,
      source: "none",
      sourceLanguage,
      targetLanguage,
    };
  }

  // Try Azure first if credentials exist.
  // Azure Translator auto-detects source language when `from` is omitted.
  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT?.trim().replace(/\/$/, "");
  const key = process.env.AZURE_TRANSLATOR_KEY?.trim();
  const region = process.env.AZURE_TRANSLATOR_REGION?.trim();

  if (endpoint && key) {
    try {
      const params = new URLSearchParams({
        "api-version": "3.0",
        to: targetLanguage,
      });

      if (sourceLanguage) {
        params.set("from", sourceLanguage);
      }

      const headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json; charset=UTF-8",
      };

      if (region) {
        headers["Ocp-Apim-Subscription-Region"] = region;
      }

      const response = await axios.post(
        `${endpoint}/translate?${params.toString()}`,
        [{ Text: trimmedText }],
        {
          headers,
          timeout: 8000,
        },
      );

      const result = response.data?.[0];
      return {
        originalText: trimmedText,
        translatedText: result?.translations?.[0]?.text || trimmedText,
        source: "azure",
        sourceLanguage:
          sourceLanguage || result?.detectedLanguage?.language || null,
        targetLanguage,
        data: response.data,
      };
    } catch (azureError) {
      const status = azureError?.response?.status;

      console.warn("Azure Translator failed, using fallback:", {
        status,
        data: azureError?.response?.data,
        message: azureError.message,
      });
    }
  }

  // Use the same Google translator flow as the mobile application before
  // falling back to MyMemory, whose public endpoint is frequently rate-limited.
  let unchangedTranslation = null;
  try {
    const googleTranslation = await translateWithGoogle({
      trimmedText,
      sourceLanguage,
      targetLanguage,
    });
    if (translationChanged(googleTranslation, trimmedText)) {
      return googleTranslation;
    }
    unchangedTranslation = googleTranslation;
  } catch (googleError) {
    console.warn("Google Translator failed, using MyMemory:", {
      status: googleError?.response?.status,
      message: googleError.message,
    });
  }

  // Last fallback: MyMemory Translation API.
  try {
    const memoryTranslation = await translateWithMyMemory({
      trimmedText,
      sourceLanguage,
      targetLanguage,
    });
    if (translationChanged(memoryTranslation, trimmedText)) {
      return memoryTranslation;
    }
    unchangedTranslation = memoryTranslation;
  } catch (fallbackError) {
    console.warn("MyMemory Translator failed, using AI fallback:", {
      status: fallbackError?.response?.status,
      data: fallbackError?.response?.data,
      message: fallbackError.message,
    });
  }

  try {
    const aiTranslation = await translateWithOpenAI({
      trimmedText,
      targetLanguage,
    });
    if (aiTranslation) return aiTranslation;
  } catch (aiError) {
    console.warn("AI Translator fallback failed:", aiError.message);
  }

  if (unchangedTranslation) return unchangedTranslation;
  const error = new Error("Translation service unavailable.");
  error.statusCode = 503;
  throw error;
};

export const translatePlainTextBatch = async ({ texts, to, from }) => {
  const cleanTexts = Array.isArray(texts)
    ? texts.map((text) => (typeof text === "string" ? text.trim() : ""))
    : [];
  const targetLanguage = normalizeLanguageCode(to);
  const sourceLanguage = normalizeLanguageCode(from);

  if (!cleanTexts.length || cleanTexts.some((text) => !text)) {
    const error = new Error("texts must be a non-empty array of strings");
    error.statusCode = 400;
    throw error;
  }

  if (!targetLanguage) {
    const error = new Error("to language is required");
    error.statusCode = 400;
    throw error;
  }

  if (sourceLanguage && sourceLanguage === targetLanguage) {
    return cleanTexts;
  }

  const endpoint = process.env.AZURE_TRANSLATOR_ENDPOINT?.trim().replace(/\/$/, "");
  const key = process.env.AZURE_TRANSLATOR_KEY?.trim();
  const region = process.env.AZURE_TRANSLATOR_REGION?.trim();

  if (endpoint && key) {
    try {
      const params = new URLSearchParams({ "api-version": "3.0", to: targetLanguage });
      if (sourceLanguage) params.set("from", sourceLanguage);

      const headers = {
        "Ocp-Apim-Subscription-Key": key,
        "Content-Type": "application/json; charset=UTF-8",
      };
      if (region) headers["Ocp-Apim-Subscription-Region"] = region;

      const response = await axios.post(
        `${endpoint}/translate?${params.toString()}`,
        cleanTexts.map((Text) => ({ Text })),
        { headers, timeout: 15000 },
      );

      return cleanTexts.map(
        (text, index) => response.data?.[index]?.translations?.[0]?.text || text,
      );
    } catch (azureError) {
      console.warn("Azure batch translation failed, using fallback:", azureError.message);
    }
  }

  // Keep fallback traffic controlled when Azure credentials are unavailable.
  const translatedTexts = [];
  for (let index = 0; index < cleanTexts.length; index += 4) {
    const group = cleanTexts.slice(index, index + 4);
    const results = await Promise.all(
      group.map(async (text) => {
        try {
          const result = await translateWithMyMemory({
            trimmedText: text,
            sourceLanguage,
            targetLanguage,
          });
          return result.translatedText;
        } catch {
          return text;
        }
      }),
    );
    translatedTexts.push(...results);
  }

  return translatedTexts;
};

export const translateText = async (req, res) => {
  try {
    const translation = await translatePlainText({
      text: req.body?.text,
      to: req.body?.to || req.body?.targetLanguage,
      from: req.body?.from || req.body?.sourceLanguage,
    });

    return res.status(200).json({
      success: true,
      ...translation,
    });
  } catch (error) {
    console.error("Translation error:", {
      statusCode: error.statusCode,
      message: error.message,
    });

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Translation failed",
      error: error.message,
    });
  }
};

export const translateBatchText = async (req, res) => {
  try {
    const translatedTexts = await translatePlainTextBatch({
      texts: req.body?.texts,
      to: req.body?.to || req.body?.targetLanguage,
      from: req.body?.from || req.body?.sourceLanguage,
    });

    return res.status(200).json({ success: true, translatedTexts });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.statusCode ? error.message : "Batch translation failed",
      error: error.message,
    });
  }
};
