const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { resolvePackageBin } = require("./package-bin");

function readDevServerFunctionName(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const match = content.match(/function\s+([A-Za-z0-9_]+)\s*\(/);
  if (!match) {
    throw new Error(`Cannot find dev server function in: ${filePath}`);
  }
  return match[1];
}

function writeDevServerConfig(filePath, fnName, url) {
  const content = `function ${fnName}() {\n  return ${JSON.stringify(url)};\n}\n`;
  fs.writeFileSync(filePath, content);
}

function clearDevServerConfig(filePath, fnName) {
  const content = `function ${fnName}() {\n  return \"\";\n}\n`;
  fs.writeFileSync(filePath, content);
}

function main() {
  const rootDir = path.join(__dirname, "..");
  const host = process.env.MN_WEB_DEV_HOST || "127.0.0.1";
  const port = String(process.env.MN_WEB_DEV_PORT || "5173");
  const devServerURL = process.env.MN_WEB_DEV_URL || `http://${host}:${port}`;
  const viteBin = resolvePackageBin(rootDir, "vite");
  const viteConfigPath = path.join(rootDir, "web", "vite.config.js");
  const devConfigPath = path.join(rootDir, "src", "WebDevServerConfig.js");
  const fnName = readDevServerFunctionName(devConfigPath);

  writeDevServerConfig(devConfigPath, fnName, devServerURL);
  console.log(`Web dev server URL injected: ${devServerURL}`);

  const child = spawn(
    process.execPath,
    [viteBin, "dev", "--host", host, "--port", port, "--strictPort", "--config", viteConfigPath],
    {
      cwd: rootDir,
      stdio: "inherit",
    },
  );

  const cleanup = () => {
    clearDevServerConfig(devConfigPath, fnName);
  };

  process.on("SIGINT", () => {
    cleanup();
    child.kill("SIGINT");
  });

  process.on("SIGTERM", () => {
    cleanup();
    child.kill("SIGTERM");
  });

  child.on("exit", (code) => {
    cleanup();
    process.exit(code || 0);
  });
}

main();
