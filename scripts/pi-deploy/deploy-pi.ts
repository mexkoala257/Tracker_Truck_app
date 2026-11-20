#!/usr/bin/env node
/**
 * Per-Raspberry Pi Remote SSH Provisioner & Kiosk Manager
 *
 * Usage (via npm scripts or deploy-pi.ps1):
 *   npm run pi:list
 *   npm run pi:inspect  -- <pi-key>
 *   npm run pi:deploy   -- <pi-key> [--reboot] [--dry-run]
 *   npm run pi:status   -- <pi-key>
 *   npm run pi:restart  -- <pi-key>
 *   npm run pi:rollback -- <pi-key>
 *   npm run pi:sync-tokens -- [--local | --admin-user admin --admin-pass ...]
 *
 * Inventory file (gitignored so per-Pi passwords are never committed):
 *   scripts/pi-deploy/pi-inventory.json
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline";
import { fileURLToPath } from "node:url";
import { Client, type ConnectConfig } from "ssh2";
import {
  generateRaspberryPiInspectScript,
  generateRaspberryPiKioskScript,
  generateRaspberryPiStatusScript,
} from "../../shared/piKioskScript";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_INVENTORY_PATH = path.join(__dirname, "pi-inventory.json");
const EXAMPLE_INVENTORY_PATH = path.join(__dirname, "pi-inventory.example.json");
const LOCAL_STORE_PATH = path.join(REPO_ROOT, "data", "display-store.json");

interface PiEntry {
  label?: string;
  location?: string;
  host: string;
  port?: number;
  username: string;
  password?: string;
  sudoPassword?: string;
  privateKeyPath?: string;
  displayId: string;
  deviceToken?: string;
}

interface PiInventory {
  serverUrl: string;
  defaultPort?: number;
  pis: Record<string, PiEntry>;
}

type CommandAction =
  | "list"
  | "inspect"
  | "deploy"
  | "status"
  | "restart"
  | "reboot"
  | "rollback"
  | "sync-tokens"
  | "help";

interface ParsedCli {
  action: CommandAction;
  targetKey: string;
  flags: Record<string, string | boolean>;
}

function parseCli(argv: string[]): ParsedCli {
  const flags: Record<string, string | boolean> = {};
  const positionals: string[] = [];
  const booleanFlags = new Set(["dry-run", "reboot", "local", "help"]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const k = arg.slice(2, eqIdx);
        flags[k] = arg.slice(eqIdx + 1);
      } else {
        const k = arg.slice(2);
        const next = argv[i + 1];
        if (!booleanFlags.has(k) && next && !next.startsWith("-")) {
          flags[k] = next;
          i++;
        } else {
          flags[k] = true;
        }
      }
    } else if (arg === "-h") {
      flags.help = true;
    } else {
      positionals.push(arg);
    }
  }

  if (flags.help) {
    return { action: "help", targetKey: "", flags };
  }

  const validActions = new Set<CommandAction>([
    "list",
    "inspect",
    "deploy",
    "status",
    "restart",
    "reboot",
    "rollback",
    "sync-tokens",
    "help",
  ]);

  let action: CommandAction = "deploy";
  let targetKey = "";

  if (positionals.length === 0) {
    action = "list";
  } else if (validActions.has(positionals[0] as CommandAction)) {
    action = positionals[0] as CommandAction;
    targetKey = positionals[1] || "";
  } else {
    // Allow shorthand: `npm run pi:deploy -- breakroom` (when script passes `deploy` or user runs directly)
    action = "deploy";
    targetKey = positionals[0];
  }

  return { action, targetKey, flags };
}

function printHelp(): void {
  console.log(`
======================================================================
 FLEET TV — PER-RASPBERRY PI SSH DEPLOYMENT TOOLKIT
======================================================================
Inventory Config (gitignored):
  scripts/pi-deploy/pi-inventory.json

Commands (run one Pi at a time by its key in pi-inventory.json):
  npm run pi:list
      Show all configured Raspberry Pis and credential readiness.

  npm run pi:inspect -- <pi-key>
      Read-only SSH check: prints OS, Pi model, user, display stack,
      and current DAKboard / Chromium URL without changing anything.

  npm run pi:deploy -- <pi-key> [--reboot] [--dry-run]
      Backs up existing DAKboard setup, installs Fleet TV fullscreen
      kiosk + HDMI-CEC watchdog, and switches the live TV immediately.

  npm run pi:status -- <pi-key>
      Check live CPU temp, HDMI-CEC TV power, watchdog & Chromium PID.

  npm run pi:restart -- <pi-key>
      Restart Chromium kiosk browser on that Pi without rebooting.

  npm run pi:rollback -- <pi-key>
      Restore the backed-up original DAKboard config and reboot Pi.

  npm run pi:sync-tokens -- [--local | --admin-user <u > --admin-pass <p>]
      Pull display IDs & secret deviceTokens from your server (or local
      data/display-store.json with --local) into pi-inventory.json.

Optional Ad-Hoc Flags (override inventory values for a single run):
  --host <ip/hostname>   --port <22>         --user <ssh-username>
  --password <ssh-pass>  --display <id>      --token <dtk_...>
  --server <https://...> --inventory <path>  --dry-run   --reboot
======================================================================
`);
}

function ensureInventoryFile(invPath: string): PiInventory {
  if (!fs.existsSync(invPath)) {
    if (fs.existsSync(EXAMPLE_INVENTORY_PATH)) {
      fs.copyFileSync(EXAMPLE_INVENTORY_PATH, invPath);
      console.log(`Created ${invPath} from pi-inventory.example.json.`);
    } else {
      const initial: PiInventory = {
        serverUrl: "https://srv1205734.hstgr.cloud",
        defaultPort: 22,
        pis: {},
      };
      fs.writeFileSync(invPath, JSON.stringify(initial, null, 2) + "\n", "utf8");
    }
  }
  const raw = fs.readFileSync(invPath, "utf8");
  return JSON.parse(raw) as PiInventory;
}

function askPrompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return Promise.resolve("");
  }
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function pad(str: string, width: number): string {
  const s = String(str ?? "");
  return s.length >= width ? s.slice(0, width - 1) + "…" : s + " ".repeat(width - s.length);
}

function runList(inv: PiInventory, invPath: string): void {
  const keys = Object.keys(inv.pis || {});
  console.log("======================================================================================");
  console.log(` FLEET TV — PI SSH INVENTORY (${path.relative(REPO_ROOT, invPath)})`);
  console.log(` Target Server URL : ${inv.serverUrl}`);
  console.log("======================================================================================");
  if (keys.length === 0) {
    console.log(" (No Pis configured in pi-inventory.json yet. Add entries or run: npm run pi:sync-tokens)");
    return;
  }

  console.log(
    `${pad("PI KEY", 14)} ${pad("DISPLAY ID", 14)} ${pad("HOST:PORT", 22)} ${pad("USER", 11)} ${pad("AUTH", 12)} ${pad("TOKEN", 10)} LABEL`,
  );
  console.log("-".repeat(102));

  for (const key of keys) {
    const p = inv.pis[key];
    const port = p.port || inv.defaultPort || 22;
    const hostCol = p.host ? `${p.host}:${port}` : "(set host)";
    const authCol = p.privateKeyPath
      ? "ssh-key"
      : p.password && p.password !== "CHANGE_ME"
        ? "password"
        : "(missing)";
    const hasToken =
      Boolean(p.deviceToken) &&
      !String(p.deviceToken).startsWith("PASTE_") &&
      String(p.deviceToken).length > 8;
    const tokenCol = hasToken ? "ready" : "pair-6dig";
    const label = [p.label, p.location].filter(Boolean).join(" • ");
    console.log(
      `${pad(key, 14)} ${pad(p.displayId || key, 14)} ${pad(hostCol, 22)} ${pad(p.username || "pi", 11)} ${pad(authCol, 12)} ${pad(tokenCol, 10)} ${label}`,
    );
  }
  console.log("======================================================================================");
  console.log(" Next step for any single Pi:");
  console.log("   1) Fill in host, username, and password in scripts/pi-deploy/pi-inventory.json");
  console.log("   2) Inspect safely first : npm run pi:inspect -- <pi-key>");
  console.log("   3) Deploy Fleet Kiosk   : npm run pi:deploy  -- <pi-key>");
}

async function syncTokens(inv: PiInventory, invPath: string, flags: Record<string, string | boolean>): Promise<void> {
  const useLocal = Boolean(flags.local);
  const serverUrl = String(flags.server || inv.serverUrl || "").replace(/\/+$/, "");

  let displayProfiles: Record<string, any> = {};

  if (useLocal) {
    if (!fs.existsSync(LOCAL_STORE_PATH)) {
      throw new Error(`Local display store not found at ${LOCAL_STORE_PATH}`);
    }
    const store = JSON.parse(fs.readFileSync(LOCAL_STORE_PATH, "utf8"));
    displayProfiles = store?.settings?.displayProfiles || {};
    console.log(`Loaded ${Object.keys(displayProfiles).length} display profile(s) from local data/display-store.json.`);
  } else {
    if (!serverUrl) {
      throw new Error("Missing serverUrl in pi-inventory.json (or pass --server https://...).");
    }
    let username = String(flags["admin-user"] || process.env.FLEET_ADMIN_USER || "");
    let password = String(flags["admin-pass"] || process.env.FLEET_ADMIN_PASS || "");

    if (!username) {
      username = await askPrompt(`Admin username for ${serverUrl} [admin]: `);
      if (!username) username = "admin";
    }
    if (!password) {
      password = await askPrompt(`Admin password for ${username}@${serverUrl}: `);
    }
    if (!password) {
      throw new Error("Admin password is required to fetch deviceTokens from server (or pass --local).");
    }

    const loginRes = await fetch(`${serverUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!loginRes.ok) {
      const txt = await loginRes.text();
      throw new Error(`Login failed (${loginRes.status}): ${txt}`);
    }

    const setCookies: string[] =
      typeof (loginRes.headers as any).getSetCookie === "function"
        ? (loginRes.headers as any).getSetCookie()
        : [loginRes.headers.get("set-cookie") || ""].filter(Boolean);
    const sidCookie = setCookies
      .map((c) => c.split(";")[0])
      .find((c) => c.startsWith("fleet_sid="));

    if (!sidCookie) {
      throw new Error("Login succeeded but no fleet_sid session cookie was returned.");
    }

    const stateRes = await fetch(`${serverUrl}/api/display/state`, {
      headers: { Cookie: sidCookie },
    });
    if (!stateRes.ok) {
      throw new Error(`Failed to fetch /api/display/state (${stateRes.status})`);
    }
    const stateJson = (await stateRes.json()) as any;
    displayProfiles = stateJson?.settings?.displayProfiles || {};
    console.log(`Fetched ${Object.keys(displayProfiles).length} display profile(s) from ${serverUrl}.`);
  }

  inv.pis = inv.pis || {};
  let updatedCount = 0;
  let addedCount = 0;

  for (const [dispId, prof] of Object.entries(displayProfiles)) {
    // Match either a Pi entry whose displayId === dispId or key === dispId
    const matchingKeys = Object.keys(inv.pis).filter(
      (k) => inv.pis[k].displayId === dispId || k === dispId,
    );

    if (matchingKeys.length > 0) {
      for (const k of matchingKeys) {
        if (prof.deviceToken) inv.pis[k].deviceToken = prof.deviceToken;
        if (!inv.pis[k].label && prof.name) inv.pis[k].label = prof.name;
        if (!inv.pis[k].location && prof.locationNote) inv.pis[k].location = prof.locationNote;
        updatedCount++;
      }
    } else {
      inv.pis[dispId] = {
        label: prof.name || dispId,
        location: prof.locationNote || "",
        host: "",
        port: inv.defaultPort || 22,
        username: "pi",
        password: "",
        displayId: dispId,
        deviceToken: prof.deviceToken || "",
      };
      addedCount++;
    }
  }

  fs.writeFileSync(invPath, JSON.stringify(inv, null, 2) + "\n", "utf8");
  console.log(`Synced pi-inventory.json (${updatedCount} updated, ${addedCount} added).`);
}

function connectSsh(cfg: {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKeyPath?: string;
}): Promise<Client> {
  return new Promise((resolve, reject) => {
    const conn = new Client();

    const connectConfig: ConnectConfig = {
      host: cfg.host,
      port: cfg.port,
      username: cfg.username,
      readyTimeout: 15000,
      keepaliveInterval: 10000,
      tryKeyboard: true,
    };

    if (cfg.privateKeyPath) {
      const resolvedKey = path.isAbsolute(cfg.privateKeyPath)
        ? cfg.privateKeyPath
        : path.resolve(REPO_ROOT, cfg.privateKeyPath);
      connectConfig.privateKey = fs.readFileSync(resolvedKey);
    } else if (cfg.password) {
      connectConfig.password = cfg.password;
    }

    conn.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => cfg.password || ""));
    });

    conn.once("ready", () => resolve(conn));
    conn.once("error", (err) => reject(err));
    conn.connect(connectConfig);
  });
}

function execOverSsh(
  conn: Client,
  command: string,
  options: { stdinData?: string; streamOutput?: boolean } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = "";
      let stderr = "";

      stream.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stdout += text;
        if (options.streamOutput) {
          process.stdout.write(text);
        }
      });

      stream.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString("utf8");
        stderr += text;
        if (options.streamOutput) {
          // Suppress empty sudo prompt noise if any
          const cleaned = text.replace(/^\[sudo\] password for [^:]+:\s*/gm, "");
          if (cleaned) process.stderr.write(cleaned);
        }
      });

      stream.on("close", (code: number | null) => {
        resolve({ code: code ?? 0, stdout, stderr });
      });

      if (options.stdinData !== undefined) {
        stream.end(options.stdinData);
      } else {
        stream.end();
      }
    });
  });
}

/**
 * Stages a bash script on the remote Pi in `/tmp` (`chmod 700`), runs it either as
 * the SSH user or via `sudo` (supporting root, NOPASSWD sudo, and password-required sudo),
 * streams live output, and deletes the temporary script automatically.
 */
async function runScriptOnPi(
  conn: Client,
  scriptContent: string,
  opts: { asRoot: boolean; sudoPassword?: string },
): Promise<number> {
  const normalized = scriptContent.replace(/\r\n/g, "\n");
  const nonce = crypto.randomBytes(6).toString("hex");
  const remoteTmp = `/tmp/.fleet-tv-task-${nonce}.sh`;

  // Step 1: Upload script cleanly over SSH stdin -> /tmp/.fleet-tv-task-<nonce>.sh
  const stageRes = await execOverSsh(
    conn,
    `umask 077 && cat > ${remoteTmp} && chmod 700 ${remoteTmp}`,
    { stdinData: normalized, streamOutput: false },
  );
  if (stageRes.code !== 0) {
    throw new Error(`Failed staging script to ${remoteTmp}: ${stageRes.stderr || stageRes.stdout}`);
  }

  // Step 2: Execute script (with automatic cleanup trap)
  try {
    if (!opts.asRoot) {
      const res = await execOverSsh(
        conn,
        `trap 'rm -f ${remoteTmp}' EXIT; bash ${remoteTmp} </dev/null`,
        { streamOutput: true },
      );
      return res.code;
    }

    const runnerCmd = [
      `trap 'rm -f ${remoteTmp}' EXIT`,
      `if [ "$(id -u)" -eq 0 ]; then`,
      `  bash ${remoteTmp} </dev/null`,
      `elif sudo -n true 2>/dev/null; then`,
      `  sudo bash ${remoteTmp} </dev/null`,
      `else`,
      `  sudo -S -p '' bash -c "exec bash ${remoteTmp} </dev/null"`,
      `fi`,
    ].join("\n");

    const sudoStdin = opts.sudoPassword ? `${opts.sudoPassword}\n` : "";
    const res = await execOverSsh(conn, runnerCmd, {
      stdinData: sudoStdin,
      streamOutput: true,
    });
    return res.code;
  } finally {
    // Belt-and-suspenders cleanup in case connection stayed up after an interruption
    await execOverSsh(conn, `rm -f ${remoteTmp} 2>/dev/null || true`, { streamOutput: false }).catch(
      () => {},
    );
  }
}

async function main(): Promise<void> {
  const { action, targetKey, flags } = parseCli(process.argv.slice(2));

  if (action === "help") {
    printHelp();
    return;
  }

  const invPath = flags.inventory
    ? path.resolve(process.cwd(), String(flags.inventory))
    : DEFAULT_INVENTORY_PATH;
  const inv = ensureInventoryFile(invPath);

  if (action === "list") {
    runList(inv, invPath);
    return;
  }

  if (action === "sync-tokens") {
    await syncTokens(inv, invPath, flags);
    return;
  }

  // All remaining actions operate on ONE specific Raspberry Pi
  const hasAdHocHost = Boolean(flags.host);
  if (!targetKey && !hasAdHocHost) {
    console.error(`ERROR: Please specify which Raspberry Pi to ${action}.`);
    console.error(`Example: npm run pi:${action === "reboot" ? "deploy" : action} -- breakroom\n`);
    runList(inv, invPath);
    process.exit(1);
  }

  const baseEntry: PiEntry =
    (targetKey && inv.pis?.[targetKey]) || {
      label: targetKey || String(flags.host),
      host: "",
      port: inv.defaultPort || 22,
      username: "pi",
      password: "",
      displayId: targetKey || "breakroom",
      deviceToken: "",
    };

  if (targetKey && !inv.pis?.[targetKey] && !hasAdHocHost) {
    console.error(
      `ERROR: Pi "${targetKey}" was not found in ${path.relative(REPO_ROOT, invPath)}.`,
    );
    console.error(`Available Pi keys: ${Object.keys(inv.pis || {}).join(", ") || "(none)"}`);
    process.exit(1);
  }

  const host = String(flags.host || baseEntry.host || "").trim();
  const port = Number(flags.port || baseEntry.port || inv.defaultPort || 22);
  const username = String(flags.user || baseEntry.username || "pi").trim();
  let password = String(flags.password || baseEntry.password || "");
  if (password === "CHANGE_ME") password = "";
  const privateKeyPath = String(flags.key || baseEntry.privateKeyPath || "").trim();
  const displayId = String(flags.display || baseEntry.displayId || targetKey || "breakroom").trim();
  let deviceToken = String(flags.token || baseEntry.deviceToken || "").trim();
  if (deviceToken.startsWith("PASTE_")) deviceToken = "";
  const serverUrl = String(flags.server || inv.serverUrl || "").trim().replace(/\/+$/, "");
  const isDryRun = Boolean(flags["dry-run"]);
  const wantReboot = Boolean(flags.reboot);

  if (action === "deploy") {
    if (!serverUrl) {
      throw new Error("Missing serverUrl in pi-inventory.json (or pass --server https://...).");
    }

    const deployScript =
      generateRaspberryPiKioskScript(serverUrl, displayId, deviceToken) +
      (wantReboot
        ? `\necho "Rebooting Pi in 3 seconds (--reboot requested)..."\n( sleep 3 && reboot ) </dev/null >/dev/null 2>&1 &\n`
        : "");

    if (isDryRun) {
      console.log("==================================================================");
      console.log(` DRY RUN — No SSH connection made`);
      console.log(` Target Pi  : ${targetKey || host} (${username}@${host || "<unset-host>"}:${port})`);
      console.log(` Display ID : ${displayId}`);
      console.log(` Server URL : ${serverUrl}`);
      console.log(` Token Auth : ${deviceToken ? "Yes (pre-authenticated token)" : "No (6-digit pairing screen)"}`);
      console.log(` Script Len : ${deployScript.split("\n").length} lines`);
      console.log("==================================================================");
      if (flags.out) {
        const outPath = path.resolve(process.cwd(), String(flags.out));
        fs.writeFileSync(outPath, deployScript, "utf8");
        console.log(`Wrote generated bash script to ${outPath}`);
      } else {
        console.log(deployScript);
      }
      return;
    }
  }

  if (!host) {
    console.error(
      `ERROR: Host/IP is empty for "${targetKey}" in ${path.relative(REPO_ROOT, invPath)}.`,
    );
    console.error(
      `Open scripts/pi-deploy/pi-inventory.json and set "host" (e.g. "192.168.1.50"), "username", and "password".`,
    );
    process.exit(1);
  }

  if (!password && !privateKeyPath) {
    password = await askPrompt(`SSH password for ${username}@${host}:${port}: `);
    if (!password) {
      console.error(
        `ERROR: No SSH password or privateKeyPath provided for "${targetKey}" (${username}@${host}).`,
      );
      process.exit(1);
    }
  }

  const sudoPassword = String(baseEntry.sudoPassword || password || "");

  console.log(
    `\nConnecting via SSH to [${targetKey || host}] -> ${username}@${host}:${port} (action: ${action})...`,
  );

  const conn = await connectSsh({
    host,
    port,
    username,
    password,
    privateKeyPath: privateKeyPath || undefined,
  });

  try {
    console.log(`SSH connected to ${username}@${host}.\n`);
    let exitCode = 0;

    if (action === "inspect") {
      exitCode = await runScriptOnPi(conn, generateRaspberryPiInspectScript(), {
        asRoot: false,
      });
    } else if (action === "status") {
      exitCode = await runScriptOnPi(conn, generateRaspberryPiStatusScript(), {
        asRoot: false,
      });
    } else if (action === "deploy") {
      const deployScript =
        generateRaspberryPiKioskScript(serverUrl, displayId, deviceToken) +
        (wantReboot
          ? `\necho "Rebooting Pi in 3 seconds (--reboot requested)..."\n( sleep 3 && reboot ) </dev/null >/dev/null 2>&1 &\n`
          : "");
      exitCode = await runScriptOnPi(conn, deployScript, {
        asRoot: true,
        sudoPassword,
      });
    } else if (action === "restart") {
      const restartScript = `#!/usr/bin/env bash
set -e
rm -f /tmp/fleet-tv-stop
echo "Restarting Chromium kiosk on $(hostname)..."
pkill -f chromium 2>/dev/null || true
sleep 2
if ! pgrep -f "fleet-tv-launch.sh" >/dev/null 2>&1 && [ -x /usr/local/bin/fleet-tv-launch.sh ]; then
  if [ -f /etc/fleet-tv-kiosk.env ]; then . /etc/fleet-tv-kiosk.env; fi
  if [ -n "\${KIOSK_USER:-}" ] && [ "\$KIOSK_USER" != "root" ] && command -v runuser >/dev/null 2>&1; then
    runuser -u "\$KIOSK_USER" -- setsid /usr/local/bin/fleet-tv-launch.sh </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &
  else
    setsid /usr/local/bin/fleet-tv-launch.sh </dev/null >/var/log/fleet-tv-kiosk.log 2>&1 &
  fi
fi
sleep 2
echo "Done. Active Chromium process:"
ps -eo user,pid,args | grep -E "[c]hromium" | grep -v "type=renderer" | head -n 3 || echo "(Starting up...)"
`;
      exitCode = await runScriptOnPi(conn, restartScript, {
        asRoot: true,
        sudoPassword,
      });
    } else if (action === "reboot") {
      const rebootScript = `#!/usr/bin/env bash
echo "Scheduling clean reboot on $(hostname) in 2 seconds..."
( sleep 2 && reboot ) </dev/null >/dev/null 2>&1 &
`;
      exitCode = await runScriptOnPi(conn, rebootScript, {
        asRoot: true,
        sudoPassword,
      });
    } else if (action === "rollback") {
      const rollbackTrigger = `#!/usr/bin/env bash
set -e
if [ ! -x /usr/local/bin/fleet-tv-restore-dakboard.sh ]; then
  echo "ERROR: /usr/local/bin/fleet-tv-restore-dakboard.sh not found on this Pi." >&2
  exit 1
fi
/usr/local/bin/fleet-tv-restore-dakboard.sh
`;
      exitCode = await runScriptOnPi(conn, rollbackTrigger, {
        asRoot: true,
        sudoPassword,
      });
    }

    if (exitCode !== 0) {
      console.error(`\nRemote command exited with status code ${exitCode}.`);
      process.exitCode = exitCode;
    }
  } finally {
    conn.end();
  }
}

main().catch((err: any) => {
  console.error(`\n[SSH DEPLOY ERROR] ${err?.message || err}`);
  process.exit(1);
});
