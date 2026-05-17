import path from "node:path";
import { fileURLToPath } from "node:url";

export interface MainWindowLoadTarget {
  kind: "file" | "url";
  value: string;
}

export function isAllowedRendererNavigation(targetUrl: string, loadTarget: MainWindowLoadTarget): boolean {
  try {
    const parsed = new URL(targetUrl);
    if (loadTarget.kind === "url") {
      const allowed = new URL(loadTarget.value);
      return parsed.origin === allowed.origin;
    }
    const targetPath = path.normalize(fileURLToPath(parsed));
    const rendererRoot = path.dirname(loadTarget.value);
    return targetPath === rendererRoot || targetPath.startsWith(`${rendererRoot}${path.sep}`);
  } catch {
    return false;
  }
}
