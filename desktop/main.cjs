const { app, BrowserWindow, dialog, shell } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const APP_NAME = "Stage AI Labs Owner Console";
const LOCAL_HOST = "127.0.0.1";
const DESKTOP_PORT = Number(process.env.STAGE_DESKTOP_PORT || 41973);
const DEVELOPMENT_PORT = Number(process.env.STAGE_DEV_PORT || 5173);
const isDevelopment = process.argv.includes("--dev");

let mainWindow;
let localServer;

function isInstalledBuild() {
  return app.isPackaged && !process.execPath.includes(`${path.sep}win-unpacked${path.sep}`);
}

function configPath() {
  return isDevelopment
    ? path.resolve(__dirname, "..", ".env.local")
    : path.join(app.getPath("userData"), ".env.local");
}

function loadLocalEnvironment() {
  const filePath = configPath();
  if (!fs.existsSync(filePath)) return false;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/, "$2");
    if (key && process.env[key] === undefined) process.env[key] = value;
  }

  return true;
}

function probe(url) {
  return new Promise((resolve) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve(response.statusCode && response.statusCode < 500);
    });
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForServer(url, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await probe(url)) return;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`The local dashboard did not start at ${url}.`);
}

function startProductionServer() {
  const serverRoot = path.join(process.resourcesPath, "app-server");
  const entry = path.join(serverRoot, "server", "index.mjs");
  if (!fs.existsSync(entry)) {
    throw new Error("The packaged dashboard server is missing. Rebuild the desktop installer.");
  }

  localServer = spawn(process.execPath, [entry], {
    cwd: serverRoot,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      HOST: LOCAL_HOST,
      NITRO_HOST: LOCAL_HOST,
      PORT: String(DESKTOP_PORT),
      NITRO_PORT: String(DESKTOP_PORT),
    },
    stdio: "ignore",
    windowsHide: true,
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: 1120,
    minHeight: 720,
    title: APP_NAME,
    show: false,
    backgroundColor: "#070b0e",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const localOrigin = `http://${LOCAL_HOST}:`;
    if (!url.startsWith(localOrigin)) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, "splash.html"));
}

function configureAutoUpdates() {
  if (isDevelopment || !isInstalledBuild()) return;

  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("error", (error) => {
      console.warn("Desktop update check failed:", error.message);
    });
    autoUpdater.checkForUpdates().catch((error) => {
      console.warn("Desktop update check could not start:", error.message);
    });
  } catch (error) {
    console.warn("Desktop auto-update is unavailable:", error);
  }
}

async function launchDashboard() {
  const targetUrl = isDevelopment
    ? `http://${LOCAL_HOST}:${DEVELOPMENT_PORT}`
    : `http://${LOCAL_HOST}:${DESKTOP_PORT}`;

  if (!isDevelopment) startProductionServer();
  await waitForServer(targetUrl);
  await mainWindow.loadURL(targetUrl);
}

app.whenReady().then(async () => {
  app.setName(APP_NAME);
  loadLocalEnvironment();

  if (!isDevelopment) {
    app.setLoginItemSettings({
      openAtLogin: true,
      openAsHidden: false,
    });
  }

  createWindow();
  configureAutoUpdates();

  try {
    await launchDashboard();
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    await dialog.showMessageBox({
      type: "error",
      title: APP_NAME,
      message: "No se pudo iniciar el dashboard local.",
      detail: `${details}\n\nConfiguración esperada: ${configPath()}`,
    });
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  if (localServer && !localServer.killed) localServer.kill();
});
