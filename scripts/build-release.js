const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const CleanCSS = require("clean-css");
const { resolvePackageBin } = require("./package-bin");

function copyRecursiveSync(src, dest) {
  if (fs.statSync(src).isDirectory()) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest);
    fs.readdirSync(src).forEach((child) => {
      copyRecursiveSync(path.join(src, child), path.join(dest, child));
    });
    return;
  }
  fs.copyFileSync(src, dest);
}

function getAllFiles(dir, files = []) {
  fs.readdirSync(dir).forEach((file) => {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      getAllFiles(name, files);
    } else {
      files.push(name);
    }
  });
  return files;
}

function runPackageBin(rootDir, packageName, binName, args) {
  const binPath = resolvePackageBin(rootDir, packageName, binName);
  execFileSync(process.execPath, [binPath, ...args], { stdio: "ignore" });
}

function minifyCssFile(filePath) {
  const source = fs.readFileSync(filePath, "utf8");
  const result = new CleanCSS().minify(source);

  if (result.errors.length > 0) {
    throw new Error(`CSS minify failed for ${filePath}: ${result.errors.join("; ")}`);
  }

  fs.writeFileSync(filePath, result.styles);
}

function minifyFiles(distDir) {
  const rootDir = path.join(__dirname, "..");
  const jsFiles = getAllFiles(distDir).filter((f) => f.endsWith(".js"));
  jsFiles.forEach((file) => {
    runPackageBin(rootDir, "terser", "terser", [
      file,
      "-o",
      file,
      "--compress",
      "--mangle",
    ]);
  });

  const htmlFiles = getAllFiles(distDir).filter((f) => f.endsWith(".html"));
  htmlFiles.forEach((file) => {
    runPackageBin(rootDir, "html-minifier-terser", "html-minifier-terser", [
      file,
      "-o",
      file,
      "--collapse-whitespace",
      "--remove-comments",
      "--minify-js",
      "true",
      "--minify-css",
      "true",
    ]);
  });

  const cssFiles = getAllFiles(distDir).filter((f) => f.endsWith(".css"));
  cssFiles.forEach((file) => {
    minifyCssFile(file);
  });
}

function archiveDist(distDir, outputPath) {
  if (process.platform === "win32") {
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Add-Type -AssemblyName System.IO.Compression.FileSystem; " +
          "[System.IO.Compression.ZipFile]::CreateFromDirectory($env:LAZYLEARN_ZIP_SOURCE, " +
          "$env:LAZYLEARN_ZIP_DEST, [System.IO.Compression.CompressionLevel]::Optimal, $false)",
      ],
      {
        env: {
          ...process.env,
          LAZYLEARN_ZIP_SOURCE: distDir,
          LAZYLEARN_ZIP_DEST: outputPath,
        },
        stdio: "inherit",
      },
    );
    return;
  }

  execFileSync("zip", ["-r", "-q", outputPath, "."], {
    cwd: distDir,
    stdio: "inherit",
  });
}

function buildWebAssets(rootDir) {
  const webBuildScript = path.join(rootDir, "scripts", "web-build.js");
  execFileSync(process.execPath, [webBuildScript], {
    cwd: rootDir,
    stdio: "inherit",
  });

  const webIndexPath = path.join(rootDir, "src", "web-dist", "index.html");
  if (!fs.existsSync(webIndexPath)) {
    throw new Error(`Web dist entry missing: ${webIndexPath}`);
  }
}

function build() {
  const rootDir = path.join(__dirname, "..");
  const pkg = JSON.parse(
    fs.readFileSync(path.join(rootDir, "package.json"), "utf8"),
  );
  if (typeof pkg.name !== "string" || !pkg.name.trim()) {
    throw new Error("package.json缺少有效name，无法生成发布文件名");
  }
  const addonName = pkg.name.trim().replace(/^@/, "").replace(/\//g, "-");
  const distDir = path.join(rootDir, "dist");
  const srcDir = path.join(rootDir, "src");
  const outputName = `${addonName}-v${pkg.version}.mnaddon`;
  const outputPath = path.join(rootDir, outputName);

  buildWebAssets(rootDir);

  if (fs.existsSync(distDir)) {
    fs.rmSync(distDir, { recursive: true, force: true });
  }
  fs.mkdirSync(distDir, { recursive: true });

  copyRecursiveSync(srcDir, distDir);
  minifyFiles(distDir);

  if (fs.existsSync(outputPath)) {
    fs.unlinkSync(outputPath);
  }

  archiveDist(distDir, path.resolve(outputPath));
  console.log(`Build successful: ${outputName}`);
}

build();
