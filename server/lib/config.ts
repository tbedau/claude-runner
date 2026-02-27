import { load as loadYaml } from "js-yaml";
import { readFileSync } from "fs";
import { join } from "path";

export interface Config {
  server_port: number;
  auth_token: string;
  log_dir: string;
  state_file: string;
  default_workdir: string;
  claude_binary: string;
  max_budget_usd: string;
  ntfy_server: string;
  ntfy_topic: string;
  [key: string]: unknown;
}

export const SCRIPT_DIR = join(import.meta.dir, "../..");
const CONFIG_FILE = join(SCRIPT_DIR, "config.yaml");
const CONFIG_LOCAL = join(SCRIPT_DIR, "config.local.yaml");

export function loadConfig(): Config {
  const base = loadYaml(readFileSync(CONFIG_FILE, "utf8")) as Record<
    string,
    unknown
  >;
  let local: Record<string, unknown> = {};
  try {
    local = loadYaml(readFileSync(CONFIG_LOCAL, "utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    // config.local.yaml is optional
  }
  return { ...base, ...local } as Config;
}

export function expandHome(p: string): string {
  return p.replace(/^~/, process.env.HOME || "");
}

export const config = loadConfig();
export const PORT = config.server_port || 7429;
export const AUTH_TOKEN = config.auth_token || "";
