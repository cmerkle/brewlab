// `npm run seed` — re-run the idempotent seed import and print counts.
import { openDb, DB_PATH } from "./server/db.js";
import { runSeed, counts } from "./server/seed.js";

const db = openDb();
const report = runSeed(db);
console.log(`Seeded ${DB_PATH}:`, report);
console.log("Counts:", counts(db));
