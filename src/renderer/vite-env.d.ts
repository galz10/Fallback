/// <reference types="vite/client" />

import type { FallbackApi } from "../shared/contracts/fallback-api.js";

declare global {
  interface Window {
    fallback: FallbackApi;
  }
}
