const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { test } = require("node:test");

test("score reset clears score records while preserving player accounts and skins", () => {
  const databaseFile = path.join(os.tmpdir(), `slither-reset-${crypto.randomUUID()}.sqlite`);
  const db = new DatabaseSync(databaseFile);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE players (id TEXT PRIMARY KEY, points INTEGER NOT NULL, games INTEGER NOT NULL, best_score INTEGER NOT NULL);
    CREATE TABLE skins (id TEXT PRIMARY KEY);
    CREATE TABLE inventory (player_id TEXT REFERENCES players(id), skin_id TEXT REFERENCES skins(id));
    CREATE TABLE games (id INTEGER PRIMARY KEY, player_id TEXT REFERENCES players(id));
    CREATE TABLE arena_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    INSERT INTO players VALUES ('p-1', 140, 3, 82);
    INSERT INTO skins VALUES ('mint'), ('neon');
    INSERT INTO inventory VALUES ('p-1', 'mint'), ('p-1', 'neon');
    INSERT INTO games VALUES (1, 'p-1'), (2, 'p-1');
    INSERT INTO arena_meta VALUES ('scores_epoch', '4');
  `);
  db.close();

  try {
    const result = spawnSync(process.execPath, ["scripts/reset-scores.js", "--confirm"], {
      cwd: path.resolve(__dirname, ".."),
      env: { ...process.env, DATABASE_FILE: databaseFile },
      encoding: "utf8"
    });
    assert.equal(result.status, 0, result.stderr);
    const verify = new DatabaseSync(databaseFile);
    const player = verify.prepare("SELECT points,games,best_score FROM players WHERE id='p-1'").get();
    assert.equal(player.points, 0);
    assert.equal(player.games, 0);
    assert.equal(player.best_score, 0);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM games").get().count, 0);
    assert.equal(verify.prepare("SELECT COUNT(*) AS count FROM inventory WHERE player_id='p-1'").get().count, 2);
    assert.equal(verify.prepare("SELECT value FROM arena_meta WHERE key='scores_epoch'").get().value, "5");
    verify.close();
  } finally {
    for (const suffix of ["", "-shm", "-wal"]) {
      try { fs.rmSync(databaseFile + suffix, { force: true, maxRetries: 5, retryDelay: 100 }); } catch {}
    }
  }
});
