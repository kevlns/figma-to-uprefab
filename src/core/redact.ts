/**
 * Token redaction: a Figma access token must never appear in logs, reports,
 * or exception text. `redactSecrets` masks every registered secret plus
 * anything that looks like a Figma personal token (length 32-200, mixed
 * alphanumerics, optionally dashes/underscores).
 */

const FIGMA_TOKEN_PATTERN =
  /(figd_|figfp_)?[A-Za-z0-9_-]{32,200}/g;

export class Redactor {
  private readonly secrets: Set<string> = new Set();

  addSecret(secret: string | undefined): void {
    if (secret && secret.length >= 8) {
      this.secrets.add(secret);
    }
  }

  redact(text: string): string {
    let out = text;
    for (const secret of this.secrets) {
      if (out.includes(secret)) {
        out = out.split(secret).join("[REDACTED]");
      }
    }

    // Fallback for a token that was never registered explicitly.
    return out.replace(FIGMA_TOKEN_PATTERN, (match) => {
      // Do not mask short, obviously-not-a-token words like hex hashes in URLs.
      if (match.length < 32) {
        return match;
      }

      // SCREAMING_SNAKE_CASE tokens are our own stable error codes
      // (e.g. EXP_IDENTIFIER_TRANSLATION_MISSING), never Figma credentials.
      if (/^[A-Z0-9_]+$/.test(match)) {
        return match;
      }

      // Skip masking if it is clearly a file path or a known-safe word.
      if (match.startsWith("C:") || match.startsWith("/") || match.endsWith(".json")) {
        return match;
      }

      return "[REDACTED]";
    });
  }
}

export function maskToken(token: string | undefined): string {
  if (!token) {
    return "(none)";
  }

  if (token.length <= 8) {
    return "[REDACTED]";
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
