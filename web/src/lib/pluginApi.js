import MNBridge from "./mnBridge";

function formatBridgeError(error) {
  if (!error) return "插件调用失败";
  if (typeof error === "string") return error;
  return error.message || "插件调用失败";
}

async function call(command, payload = null) {
  try {
    return await MNBridge.send(command, payload);
  } catch (error) {
    throw new Error(formatBridgeError(error));
  }
}

export const getSelection = () => call("getSelection");
export const getSession = () => call("getSession");
export const saveBaseUrl = (baseUrl) => call("saveBaseUrl", { baseUrl });
export const login = (username, password) => call("login", { username, password });
export const logout = () => call("logout");
export const me = () => call("me");
export const createCard = (card) => call("createCard", card);
export const searchQuestions = (q, limit = 10) => call("searchQuestions", { q, limit });
export const makeCards = (options = {}) => call("makeCards", options);
export const askTutor = (prompt, options = {}) => call("askTutor", { prompt, ...options });
export const resetTutor = () => call("resetTutor");
export const getTutorSession = () => call("getTutorSession");
export const saveNote = (note) => call("saveNote", note);
export const previewPullCards = (options = {}) => call("previewPullCards", options);
export const pullCards = (options = {}) => call("pullCards", options);
export const previewNotebook = (mode) => call("previewNotebook", { mode });
export const importNotebook = (options = {}) => call("importNotebook", options);
export const ping = () => call("ping");
