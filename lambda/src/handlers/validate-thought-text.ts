const MAX_TEXT_LENGTH = 50_000;

export function validateThoughtText(text: unknown): string | null {
  if (!text || typeof text !== "string") {
    return "Error: text is required";
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return "Error: text exceeds maximum length of 50,000 characters";
  }
  return null;
}
