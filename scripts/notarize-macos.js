import { notarize } from "@electron/notarize";
import process from "node:process";

export default async function notarizeMacos(context) {
  if (process.platform !== "darwin" || process.env.FALLBACK_NOTARIZE !== "1") return;
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`;
  const appleApiKey = process.env.APPLE_API_KEY_PATH;
  const appleApiKeyId = process.env.APPLE_API_KEY_ID;
  const appleApiIssuer = process.env.APPLE_API_ISSUER;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;

  if (appleApiKey && appleApiKeyId && appleApiIssuer) {
    await notarize({
      appBundleId: "sh.fallback.app",
      appPath,
      appleApiKey,
      appleApiKeyId,
      appleApiIssuer
    });
    return;
  }

  if (!appleId || !appleIdPassword || !teamId) {
    throw new Error(
      "Set APPLE_API_KEY_PATH, APPLE_API_KEY_ID, and APPLE_API_ISSUER, or APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, and APPLE_TEAM_ID before notarizing Fallback."
    );
  }

  await notarize({
    appBundleId: "sh.fallback.app",
    appPath,
    appleId,
    appleIdPassword,
    teamId
  });
}
