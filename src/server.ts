import { startServer } from "./server/app.js";
import { startDemoServer } from "./server/demo.js";

if (process.env.DEMO === "1") await startDemoServer();
else startServer();
