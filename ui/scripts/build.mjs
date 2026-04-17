import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const srcDir = path.join(rootDir, "src");
const distDir = path.join(rootDir, "dist");
const pkgPath = path.join(rootDir, "package.json");
const tsconfigPath = path.join(rootDir, "tsconfig.json");
const publicScriptsDir = path.join(publicDir, "scripts");

async function runTypeScriptCheck() {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        path.join(rootDir, "node_modules", "typescript", "bin", "tsc"),
        "-p",
        tsconfigPath,
        "--noEmit",
      ],
      { cwd: rootDir, stdio: "inherit" }
    );
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`TypeScript type check failed with code ${code}`));
    });
    child.on("error", reject);
  });
}

async function collectEntryPoints() {
  const files = await readdir(srcDir);
  return files
    .filter((name) => name.endsWith(".ts"))
    .map((name) => path.join(srcDir, name));
}

async function runEsbuild() {
  const entries = await collectEntryPoints();
  await esbuild.build({
    entryPoints: entries,
    bundle: true,
    format: "esm",
    target: ["es2020"],
    platform: "browser",
    outdir: publicScriptsDir,
    outExtension: { ".js": ".js" },
    sourcemap: "linked",
    logLevel: "info",
    splitting: false,
    minify: false,
    legalComments: "none",
    tsconfig: tsconfigPath,
  });
}

async function clean() {
  await rm(distDir, { recursive: true, force: true });
  await rm(publicScriptsDir, { recursive: true, force: true });
  console.log("Cleaned ui/dist and ui/public/scripts");
}

async function build() {
  await runTypeScriptCheck();
  await rm(publicScriptsDir, { recursive: true, force: true });
  await runEsbuild();

  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });

  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const builtAt = new Date().toISOString();
  const buildHash = Date.now().toString(36);

  const meta = {
    name: pkg.name,
    version: pkg.version,
    builtAt,
    buildHash,
    output: "dist",
    deployHint: "Copy the contents of ui/dist into your web server ui directory.",
  };

  await writeFile(
    path.join(distDir, "build-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(publicDir, "build-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  );

  console.log(`Built UI into ui/dist (hash: ${buildHash})`);
}

if (process.argv.includes("--clean")) {
  await clean();
} else {
  await build();
}
