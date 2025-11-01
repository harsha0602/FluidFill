import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import pg from "pg";
import dotenv from "dotenv";
async function main() {
    const rootEnvPath = path.resolve(process.cwd(), "../../.env");
    if (existsSync(rootEnvPath)) {
        dotenv.config({ path: rootEnvPath });
    }
    else {
        dotenv.config();
    }
    const { Client } = pg;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    const dir = path.resolve(process.cwd(), "../../db/migrations");
    const files = readdirSync(dir).filter(f => f.endsWith(".sql")).sort();
    for (const f of files) {
        const sql = readFileSync(path.join(dir, f), "utf8");
        console.log("Applying migration:", f);
        await client.query(sql);
    }
    await client.end();
    console.log("Migrations applied");
}
main().catch((e) => { console.error(e); process.exit(1); });
