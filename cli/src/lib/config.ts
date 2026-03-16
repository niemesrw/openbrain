import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".openbrain");
const CREDENTIALS_FILE = path.join(CONFIG_DIR, "credentials.json");

export interface Credentials {
  apiUrl: string;
  region: string;
  clientId: string;
  accessToken: string;
  idToken: string;
  refreshToken: string;
  expiresAt: number;
}

function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
}

export function loadCredentials(): Credentials | null {
  try {
    const raw = fs.readFileSync(CREDENTIALS_FILE, "utf-8");
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export function saveCredentials(creds: Credentials): void {
  ensureConfigDir();
  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
}

export function clearCredentials(): void {
  try {
    fs.unlinkSync(CREDENTIALS_FILE);
  } catch {
    // Already gone
  }
}
