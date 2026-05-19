import fs from "node:fs";
import path from "node:path";

interface PackageJson {
  version?: string;
  build?: Record<string, unknown>;
}

const root = process.cwd();
const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 1) {
  const key = process.argv[index];
  if (key === "--") continue;
  const value = process.argv[index + 1];
  if (!key?.startsWith("--") || !value) throw new Error(`Expected --key value arguments, got ${key ?? "<empty>"}`);
  args.set(key.slice(2), value);
  index += 1;
}

const version = args.get("version") ?? process.env.FALLBACK_RELEASE_VERSION;
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Set --version X.Y.Z or FALLBACK_RELEASE_VERSION.");

const repository = args.get("repository") ?? process.env.FALLBACK_UPDATE_REPOSITORY ?? process.env.GITHUB_REPOSITORY;
if (!repository || !/^[^/\s]+\/[^/\s]+$/.test(repository)) {
  throw new Error("Set --repository owner/repo, FALLBACK_UPDATE_REPOSITORY, or GITHUB_REPOSITORY.");
}

const [owner, repo] = repository.split("/") as [string, string];
const packageJsonPath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as PackageJson;
const baseBuild = packageJson.build;
if (!baseBuild || typeof baseBuild !== "object") throw new Error("package.json is missing a build config.");
const azureSignOptions = readAzureSignOptions();

const config = {
  ...baseBuild,
  extraMetadata: {
    version
  },
  publish: [
    {
      provider: "github",
      owner,
      repo,
      releaseType: "release"
    }
  ],
  mac: {
    ...objectValue(baseBuild.mac),
    target: [
      {
        target: "dmg",
        arch: ["x64", "arm64"]
      },
      {
        target: "zip",
        arch: ["x64", "arm64"]
      }
    ]
  },
  win: {
    ...objectValue(baseBuild.win),
    ...(azureSignOptions ? { azureSignOptions } : {})
  }
};

const outputPath = path.join(root, ".build", "electron-builder.release.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
console.log(`Wrote ${path.relative(root, outputPath)} for Fallback v${version} (${repository}).`);

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function readAzureSignOptions(): Record<string, string> | null {
  const endpoint = envValue("AZURE_TRUSTED_SIGNING_ENDPOINT");
  const codeSigningAccountName = envValue("AZURE_TRUSTED_SIGNING_ACCOUNT_NAME");
  const certificateProfileName = envValue("AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME");
  const publisherName = envValue("WINDOWS_PUBLISHER_NAME");
  const values = [endpoint, codeSigningAccountName, certificateProfileName, publisherName];
  if (values.every(Boolean)) {
    return {
      endpoint: endpoint!,
      codeSigningAccountName: codeSigningAccountName!,
      certificateProfileName: certificateProfileName!,
      publisherName: publisherName!,
      ...(envValue("AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161")
        ? { timestampRfc3161: envValue("AZURE_TRUSTED_SIGNING_TIMESTAMP_RFC3161")! }
        : {})
    };
  }
  if (values.some(Boolean)) {
    throw new Error(
      "Azure Trusted Signing requires AZURE_TRUSTED_SIGNING_ENDPOINT, AZURE_TRUSTED_SIGNING_ACCOUNT_NAME, AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE_NAME, and WINDOWS_PUBLISHER_NAME."
    );
  }
  return null;
}
