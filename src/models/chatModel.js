// AI conversations use the existing MySQL aichats table.
// Keep this separate from Chat.js, which stores counselor conversations.
export { default } from "./mysql/AIChatModel.js";
