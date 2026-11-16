import { model as geminiModel } from "../config/gemini.js";
import OpenAI from "openai";

// The main function your Chat Controller will call
export const generateAIResponse = async (
  message,
  chatHistory = [],
  systemInstruction = "",
) => {
  // OpenAI is the production default. Gemini remains available only when
  // explicitly selected, so quota issues there do not break the main chat.
  const provider = (process.env.ACTIVE_AI_PROVIDER || "openai").toLowerCase();

  try {
    if (provider === "openai") {
      return await handleOpenAI(message, chatHistory, systemInstruction);
    } else if (provider === "groq") {
      return await handleGroq(message, chatHistory, systemInstruction);
    } else {
      return await handleGemini(message, chatHistory, systemInstruction);
    }
  } catch (error) {
    if (provider !== "openai" && process.env.OPENAI_API_KEY) {
      console.warn(
        `[AI_SERVICE] ${provider} provider failed, retrying with OpenAI:`,
        error.message,
      );
      return await handleOpenAI(message, chatHistory, systemInstruction);
    }

    throw error;
  }
};

// --- OPEN AI LOGIC ---
const handleOpenAI = async (message, history, systemInstruction) => {
  // Initialize OpenAI here so it doesn't crash the server on startup if key is missing
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || "missing_key",
  });

  // OpenAI uses a specific format: { role: "system" | "user" | "assistant", content: "..." }
  const messages = [];

  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  // Add prior history
  messages.push(...history);

  // Add the new user message
  messages.push({ role: "user", content: message });

  const response = await openai.chat.completions.create({
    model: "gpt-4o", // Latest most capable OpenAI model - best for mental health support
    messages: messages,
    temperature: 0.7, // Balanced for empathy and accuracy
    max_tokens: 1000, // Allow detailed psychological responses
  });

  return response.choices[0].message.content;
};

// --- GEMINI LOGIC ---
const handleGemini = async (message, history, systemInstruction) => {
  // Map generic { role, content } history to Gemini's format
  // OpenAI uses "assistant", Gemini uses "model".
  const formattedHistory = history.map((msg) => ({
    role: msg.role === "assistant" ? "model" : "user",
    parts: [{ text: msg.content || "" }],
  }));

  // Add system instruction as the first exchange if present.
  // Keep provider behavior consistent: answer actual questions from the first turn.
  if (systemInstruction) {
    formattedHistory.unshift(
      {
        role: "user",
        parts: [{ text: systemInstruction }],
      },
      {
        role: "model",
        parts: [
          {
            text: "Understood. I will answer the current question directly, including the first question, with relevant practical guidance in the selected language. I will not replace a specific question with greetings or onboarding. I will avoid diagnosis, invented facts and unsafe advice.",
          },
        ],
      },
    );
  }

  // Start the chat session with the formatted history
  const chatSession = geminiModel.startChat({
    history: formattedHistory,
  });

  // Send the user's message and await the response
  const result = await chatSession.sendMessage(message);

  return result.response.text();
};

// --- GROQ LOGIC ---
// Groq provides an OpenAI‑compatible API at a custom base URL.
// We reuse the OpenAI client library, pointing it at Groq's endpoint.
const handleGroq = async (message, history, systemInstruction) => {
  const groq = new OpenAI({
    apiKey: process.env.GROQ_API_KEY,
    baseURL: "https://api.groq.com/openai/v1",
  });

  const messages = [];

  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  messages.push(...history.filter((msg) => msg && msg.content));

  messages.push({ role: "user", content: message });

  const models = [
    process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    "llama-3.1-8b-instant",
  ];

  for (const model of models) {
    try {
      const response = await groq.chat.completions.create({
        model,
        messages,
      });

      return response.choices[0].message.content;
    } catch (err) {
      console.log(`Groq model ${model} failed:`, err.message);
    }
  }

  throw new Error("All Groq models failed");
};
