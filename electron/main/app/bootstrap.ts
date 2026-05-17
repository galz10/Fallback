import { app } from "electron";
import { createAppServices } from "../app-services.js";
import { createHealthChecks } from "./health-checks.js";
import { wireAppLifecycle } from "./lifecycle.js";
import { registerIpcHandlers } from "../ipc/register-ipc.js";
import { ProtocolClient } from "../shell/protocol-client.js";
import { WindowManager } from "../window-manager.js";

export function bootstrap(): void {
  if (process.env.FALLBACK_PERF_SMOKE === "1") {
    app.setPath("userData", `${app.getPath("userData")}-perf-smoke-${process.pid}`);
  }
  const services = createAppServices();
  const protocolClient = new ProtocolClient(services);
  const healthChecks = createHealthChecks(services);
  const windowManager = new WindowManager(services);

  wireAppLifecycle({
    services,
    createWindow: (context) => windowManager.createWindow(context),
    createInitialWindows: () => windowManager.createInitialWindows(),
    prepareForQuit: () => windowManager.prepareForQuit(),
    healthChecks,
    protocolClient,
    registerIpcHandlers: () => registerIpcHandlers(services, { protocolClient, windowManager })
  });
}
