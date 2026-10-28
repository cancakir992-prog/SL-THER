require("dotenv").config();

const path = require("node:path");
const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const { DatabaseSync } = require("node:sqlite");

async function main() {
  const databaseFile = path.resolve(process.env.DATABASE_FILE || "./data/arena.sqlite");
  if (process.argv.includes("--confirm")) {
    console.log(`Resetting scores in ${databaseFile}`);
  } else {
    const prompt = readline.createInterface({ input: stdin, output: stdout });
    const answer = await prompt.question(`This clears all scores, points and match history in ${databaseFile}. Type RESET to continue: `);
    prompt.close();
    if (answer.trim().toUpperCase() !== "RESET") {
      console.log("Cancelled; no data was changed.");
      return;
    }
  }

  const db = new DatabaseSync(databaseFile);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("BEGIN IMMEDIATE");
    db.exec("DELETE FROM games");
    db.exec("UPDATE players SET points = 0, games = 0, best_score = 0");
    db.exec("UPDATE arena_meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'scores_epoch'");
    db.exec("COMMIT");
    console.log("Scores, points, player game counts and match history were reset. Accounts and skin inventory were preserved.");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error("Could not reset scores:", error.message);
  process.exitCode = 1;
});
