import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const publicDir = path.join(rootDir, "public");
const distDir = path.join(rootDir, "dist");
const pkgPath = path.join(rootDir, "package.json");

async function clean() {
  await rm(distDir, { recursive: true, force: true });
  console.log("Cleaned ui/dist");
}

async function build() {
  await rm(distDir, { recursive: true, force: true });
  await mkdir(distDir, { recursive: true });
  await cp(publicDir, distDir, { recursive: true });

  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const meta = {
    name: pkg.name,
    version: pkg.version,
    builtAt: new Date().toISOString(),
    output: "dist",
    deployHint: "Copy the contents of ui/dist into your web server ui directory.",
  };

  await writeFile(
    path.join(distDir, "build-meta.json"),
    `${JSON.stringify(meta, null, 2)}\n`,
    "utf8"
  );

  console.log("Built UI into ui/dist");
}

if (process.argv.includes("--clean")) {
  await clean();
} else {
  await build();
}
