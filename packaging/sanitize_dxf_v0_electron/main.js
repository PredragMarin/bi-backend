"use strict";

const { app, BrowserWindow, dialog } = require("electron");
const { fork } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3010);
let serverProcess = null;

function resolveServerScript() {
  if (!app.isPackaged) {
    const localWorkspacePath = path.resolve(__dirname, "src/api/sanitize_dxf_v0_server.js");
    if (fs.existsSync(localWorkspacePath)) {
      return localWorkspacePath;
    }
    return path.resolve(__dirname, "../../src/api/sanitize_dxf_v0_server.js");
  }
  return path.join(process.resourcesPath, "sanitize_app_src", "api", "sanitize_dxf_v0_server.js");
}

function waitForHealth(url, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    function attempt() {
      const req = http.get(url, (res) => {
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
        res.resume();
        if (ok) {
          resolve();
          return;
        }
        retry(new Error(`Health check returned status ${res.statusCode}`));
      });
      req.on("error", retry);
      req.setTimeout(1500, () => {
        req.destroy(new Error("Health check timeout"));
      });
    }

    function retry(error) {
      if (Date.now() - startedAt >= timeoutMs) {
        reject(error);
        return;
      }
      setTimeout(attempt, 300);
    }

    attempt();
  });
}

function startEmbeddedServer() {
  const serverScript = resolveServerScript();
  const packagedNodePaths = [
    path.join(app.getAppPath(), "node_modules"),
    path.join(process.resourcesPath, "app.asar", "node_modules"),
    path.join(process.resourcesPath, "app", "node_modules"),
    process.env.NODE_PATH || ""
  ].filter(Boolean);
  serverProcess = fork(serverScript, [], {
    cwd: app.isPackaged ? process.resourcesPath : __dirname,
    execPath: process.execPath,
    env: {
      ...process.env,
      PORT: String(PORT),
      ELECTRON_RUN_AS_NODE: "1",
      NODE_PATH: packagedNodePaths.join(path.delimiter)
    },
    stdio: "ignore"
  });
  return waitForHealth(`http://127.0.0.1:${PORT}/health`);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    backgroundColor: "#eef4ea",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadURL(`http://127.0.0.1:${PORT}/ui/sanitize-dxf`);
  return win;
}

async function bootstrap() {
  try {
    await startEmbeddedServer();
    createWindow();
  } catch (error) {
    await dialog.showMessageBox({
      type: "error",
      title: "Sanitize DXF startup failed",
      message: "Standalone sanitize server could not start.",
      detail: error && error.message ? error.message : String(error)
    });
    app.quit();
  }
}

app.whenReady().then(bootstrap);

app.on("window-all-closed", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
  app.quit();
});

app.on("before-quit", () => {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill();
  }
});
