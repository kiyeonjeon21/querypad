import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(join(root, path), "utf8"));
}

function normalizeVersion(version) {
  const parts = version.split(".");
  if (parts.length === 2) return `${version}.0`;
  return version;
}

function fail(message) {
  console.error(`Version check failed: ${message}`);
  process.exitCode = 1;
}

const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const readme = readFileSync(join(root, "README.md"), "utf8");

const packageVersion = normalizeVersion(packageJson.version);
const lockVersion = normalizeVersion(packageLock.version);
const lockRootVersion = normalizeVersion(packageLock.packages?.[""]?.version ?? "");
const changelogMatch = readme.match(/^### v(\d+\.\d+(?:\.\d+)?)\b/m);
const changelogVersion = changelogMatch
  ? normalizeVersion(changelogMatch[1])
  : null;

if (packageVersion !== lockVersion) {
  fail(`package.json (${packageVersion}) and package-lock.json (${lockVersion}) differ.`);
}

if (packageVersion !== lockRootVersion) {
  fail(`package.json (${packageVersion}) and package-lock root (${lockRootVersion}) differ.`);
}

if (!changelogVersion) {
  fail("README.md does not contain a changelog heading like `### v0.6`.");
} else if (packageVersion !== changelogVersion) {
  fail(`package.json (${packageVersion}) and README latest changelog (${changelogVersion}) differ.`);
}

if (!process.exitCode) {
  console.log(`Version metadata is consistent at v${packageVersion}.`);
}
