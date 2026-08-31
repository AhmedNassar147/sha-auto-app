import { existsSync } from "fs";
import { spawn, execSync } from "child_process";
import createConsoleMessage from "./createConsoleMessage.mjs";

const getCloudflaredPath = () => {
  const candidates = [
    process.env.CLOUDFLARED_PATH,
    "C:\\Program Files\\cloudflared\\cloudflared.exe",
    "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe",
    `${process.env.LOCALAPPDATA}\\cloudflared\\cloudflared.exe`,
    `${process.env.LOCALAPPDATA}\\Programs\\cloudflared\\cloudflared.exe`,
  ].filter(Boolean);

  return candidates.find((path) => existsSync(path)) || null;
};

let publicActionBaseUrl = null;
let tunnelReadyPromise = null;

export const getPublicActionBaseUrl = () => publicActionBaseUrl;

export const waitForPublicActionBaseUrl = async () => {
  if (publicActionBaseUrl) return publicActionBaseUrl;

  if (!tunnelReadyPromise) {
    throw new Error("Cloudflare tunnel has not been started yet");
  }

  return tunnelReadyPromise;
};

const startCloudflareTunnel = () => {
  if (tunnelReadyPromise) {
    return tunnelReadyPromise;
  }

  const PORT = process.env.PORT;

  if (!PORT) {
    throw new Error(`PORT is missing or invalid PORT=${PORT}`);
  }

  const cloudflaredPath = getCloudflaredPath() || "cloudflared";
  // || "C:\\Program Files (x86)\\cloudflared\\cloudflared.exe";

  createConsoleMessage("warn", `Cloudflare path: ${cloudflaredPath}`);

  tunnelReadyPromise = new Promise((resolve, reject) => {
    let resolved = false;

    const url = `https://localhost:${PORT}`;

    createConsoleMessage("info", `Starting Cloudflare tunnel on ${url}`);

    const tunnel = spawn(
      cloudflaredPath,
      ["tunnel", "--url", url, "--no-tls-verify"],
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const startupTimeout = setTimeout(() => {
      if (!resolved) {
        publicActionBaseUrl = null;
        tunnelReadyPromise = null;

        reject(new Error("Timed out waiting for Cloudflare tunnel URL"));
      }
    }, 30000);

    const handleOutput = (data) => {
      const text = data.toString();
      const match = text.match(/https:\/\/[\w-]+\.trycloudflare\.com/);

      if (match && !resolved) {
        resolved = true;
        clearTimeout(startupTimeout);

        publicActionBaseUrl = match[0];

        createConsoleMessage(
          "info",
          `Cloudflare public URL: ${publicActionBaseUrl}`,
        );

        resolve(publicActionBaseUrl);
      }
    };

    tunnel.stdout.on("data", handleOutput);
    tunnel.stderr.on("data", handleOutput);

    tunnel.on("error", (error) => {
      clearTimeout(startupTimeout);
      publicActionBaseUrl = null;
      tunnelReadyPromise = null;

      if (!resolved) {
        reject(error);
      }
    });

    tunnel.on("exit", (code) => {
      clearTimeout(startupTimeout);

      createConsoleMessage("info", `cloudflared exited: ${code}`);

      publicActionBaseUrl = null;
      tunnelReadyPromise = null;

      if (!resolved) {
        reject(new Error(`cloudflared exited before URL was created: ${code}`));
      }
    });
  });

  return tunnelReadyPromise;
};

export default startCloudflareTunnel;
