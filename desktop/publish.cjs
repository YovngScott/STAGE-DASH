const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const envPath = path.join(root, ".env.local");

if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator < 1 || line.trim().startsWith("#")) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

if (!process.env.GH_TOKEN && process.env.STAGE_GITHUB_TOKEN) {
  process.env.GH_TOKEN = process.env.STAGE_GITHUB_TOKEN;
}

if (!process.env.GH_TOKEN) {
  throw new Error("STAGE_GITHUB_TOKEN or GH_TOKEN is required to publish a desktop update.");
}

const builderPath = process.platform === "win32"
  ? path.join(root, "node_modules", ".bin", "electron-builder.cmd")
  : path.join(root, "node_modules", ".bin", "electron-builder");
const command = process.platform === "win32" ? process.env.ComSpec || "cmd.exe" : builderPath;
const args = process.platform === "win32"
  ? ["/d", "/s", "/c", `"${builderPath}" --win nsis --publish always`]
  : ["--win", "nsis", "--publish", "always"];

const result = spawnSync(command, args, {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});

if (result.error) throw result.error;
process.exit(result.status ?? 1);
