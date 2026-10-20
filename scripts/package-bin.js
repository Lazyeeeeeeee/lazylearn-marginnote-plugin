const fs = require("fs");
const path = require("path");

function resolvePackageBin(rootDir, packageName, binName = packageName) {
  const packageDir = path.join(rootDir, "node_modules", ...packageName.split("/"));
  const manifestPath = path.join(packageDir, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const relativePath =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin && manifest.bin[binName];

  if (!relativePath) {
    throw new Error(`Missing "${binName}" executable in ${packageName}`);
  }

  const binPath = path.resolve(packageDir, relativePath);
  if (!fs.existsSync(binPath)) {
    throw new Error(`Package executable not found: ${binPath}`);
  }
  return binPath;
}

module.exports = { resolvePackageBin };
