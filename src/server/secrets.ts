// AI provider credentials entered in the app (More → Settings → AI provider).
// Kept in a separate file on the data volume — NOT in the database — so they never appear in
// the JSON export or the nightly database backups. The key is write-only: no API returns it.
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";

export const SECRETS_FILE = process.env.SECRETS_FILE || path.join(DATA_DIR, "secrets.json");

export interface AiSecrets {
  provider: string;
  apiKey: string | null;
  model: string | null;
  baseUrl: string | null;
}

export function readSecrets(): AiSecrets | null {
  try {
    const j = JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
    return j?.ai ?? null;
  } catch {
    return null;
  }
}

export function writeSecrets(ai: AiSecrets | null) {
  if (!ai) {
    fs.rmSync(SECRETS_FILE, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
  const tmp = `${SECRETS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ai }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SECRETS_FILE);
}
