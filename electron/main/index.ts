import { markStartup } from "./performance.js";
import { bootstrap } from "./app/bootstrap.js";

markStartup("process:start");
bootstrap();
