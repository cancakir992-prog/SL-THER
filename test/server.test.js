const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const net = require("node:net");
const { DatabaseSync } = require("node:sqlite");
const { before, after, test } = require("node:test");
const { io } = require("socket.io-client");

const databaseFile = path.join(os.tmpdir(), `slither-arena-${crypto.randomUUID()}.sqlite`);
let serverProcess;
let baseUrl;
let serverPort;
let firstGuest;
let secondGuest;
const clients = [];

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => listener.once("error", reject).listen(0, "127.0.0.1", resolve));
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function waitForServer() {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (serverProcess.exitCode !== null) throw new Error("Test server exited before becoming ready.");
    try {
      const response = await fetch(`${baseUrl}/api/skins`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  throw new Error("Test server did not become ready.");
}

async function startServer() {
  serverProcess = spawn(process.execPath, ["server/index.js"], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, PORT: String(serverPort), DATABASE_FILE: databaseFile, ALLOWED_ORIGINS: "" },
    stdio: ["ignore", "ignore", "inherit"]
  });
  await waitForServer();
}

async function stopServer() {
  if (!serverProcess || serverProcess.exitCode !== null) return;
  await new Promise(resolve => {
    serverProcess.once("exit", resolve);
    serverProcess.kill();
  });
}

async function createGuest(username) {
  const response = await fetch(`${baseUrl}/api/guest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username })
  });
  return { response, data: await response.json() };
}

async function connectPlayer(guest) {
  const socket = io(baseUrl, { auth: { token: guest.data.token }, transports: ["websocket"], timeout: 5000 });
  clients.push(socket);
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", reject);
  });
  return socket;
}

function join(socket, mode, room) {
  return new Promise((resolve, reject) => {
    socket.emit("join", { mode, room }, result => result?.error ? reject(new Error(result.error)) : resolve(result));
  });
}

function nextState(socket) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for game state.")), 3000);
    socket.once("state", value => { clearTimeout(timer); resolve(value); });
  });
}

before(async () => {
  serverPort = await unusedPort();
  baseUrl = `http://127.0.0.1:${serverPort}`;
  await startServer();
});

after(async () => {
  for (const client of clients) client.disconnect();
  await stopServer();
  for (const suffix of ["", "-shm", "-wal"]) {
    try { fs.rmSync(databaseFile + suffix, { force: true }); } catch {}
  }
});

test("guest profiles, catalog, and purchase validation are persistent and server-authoritative", async () => {
  const catalogResponse = await fetch(`${baseUrl}/api/skins`);
  const catalog = await catalogResponse.json();
  assert.equal(catalog.length, 40);
  const leaderboard = await (await fetch(`${baseUrl}/api/leaderboard`)).json();
  assert.ok(Array.isArray(leaderboard.daily));
  assert.ok(Array.isArray(leaderboard.weekly));

  const invalid = await createGuest("x");
  assert.equal(invalid.response.status, 400);

  firstGuest = await createGuest("PlayerOne");
  secondGuest = await createGuest("PlayerTwo");
  assert.equal(firstGuest.response.status, 200);
  assert.equal(secondGuest.response.status, 200);
  assert.notEqual(firstGuest.data.player.username, secondGuest.data.player.username);
  const homepage = await fetch(baseUrl);
  assert.equal(homepage.status, 200);
  assert.match(await homepage.text(), /Kay, büyü/);

  const headers = { authorization: `Bearer ${firstGuest.data.token}` };
  const profileResponse = await fetch(`${baseUrl}/api/me`, { headers });
  const profile = await profileResponse.json();
  assert.equal(profileResponse.status, 200);
  assert.equal(profile.skins.length, 1);
  assert.equal(profile.skins[0].id, "mint");

  const purchaseResponse = await fetch(`${baseUrl}/api/shop/buy`, {
    method: "POST", headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ skinId: "neon-pink" })
  });
  assert.equal(purchaseResponse.status, 400);

  await stopServer();
  await startServer();
  const afterRestart = await fetch(`${baseUrl}/api/me`, { headers });
  assert.equal(afterRestart.status, 200);
  assert.equal((await afterRestart.json()).player.username, firstGuest.data.player.username);
});

test("bot mode has distinct bots and online room shares state between real players", async () => {
  const botPlayer = await connectPlayer(firstGuest);
  const botRoom = await join(botPlayer, "bots");
  assert.match(botRoom.room, /^bot-/);
  const botState = await nextState(botPlayer);
  assert.ok(botState.snakes.some(snake => snake.isBot));
  assert.ok(botState.snakes.some(snake => !snake.isBot));
  const angleDistance=(first,second)=>Math.abs(Math.atan2(Math.sin(first-second),Math.cos(first-second)));
  botPlayer.emit("leave");
  botPlayer.disconnect();

  const controlPlayer=await connectPlayer(secondGuest);
  const controlRoom=await join(controlPlayer,"online","CONTROL");
  assert.equal(controlRoom.room,"CONTROL");
  const controlState=await nextState(controlPlayer);
  const controlInitial=controlState.snakes.find(snake=>snake.id===controlPlayer.id).angle;
  const controlTarget=controlInitial>=0?-1.5:1.5;
  for(let i=0;i<16;i++) {
    controlPlayer.emit("input",{angle:controlTarget,boost:false});
    await new Promise(resolve=>setTimeout(resolve,25));
  }
  const controlResult=await nextState(controlPlayer);
  const controlled=controlResult.snakes.find(snake=>snake.id===controlPlayer.id);
  assert.ok(controlled,"the isolated online player should still be active");
  assert.ok(angleDistance(controlled.angle,controlTarget)<angleDistance(controlInitial,controlTarget)-0.25,
    "online controls should continue steering at a steady input rate");
  controlPlayer.emit("leave");
  controlPlayer.disconnect();

  const playerOne = await connectPlayer(firstGuest);
  const playerTwo = await connectPlayer(secondGuest);
  const roomOne = await join(playerOne, "online");
  const roomTwo = await join(playerTwo, "online", roomOne.room);
  assert.equal(roomTwo.room, roomOne.room);
  const sharedState = await nextState(playerOne);
  assert.ok(sharedState.snakes.some(snake => snake.username === firstGuest.data.player.username && !snake.isBot));
  assert.ok(sharedState.snakes.some(snake => snake.username === secondGuest.data.player.username && !snake.isBot));
  const board = await (await fetch(`${baseUrl}/api/leaderboard`)).json();
  assert.ok(board.online >= 2);

  const resetDb = new DatabaseSync(databaseFile);
  resetDb.prepare("UPDATE players SET points=123,games=4,best_score=76 WHERE id=?").run(firstGuest.data.player.id);
  resetDb.prepare("UPDATE players SET points=456,games=8,best_score=99 WHERE id=?").run(secondGuest.data.player.id);
  resetDb.prepare("INSERT INTO games(player_id,username,mode,score,reward,duration) VALUES(?,?,'bots',76,123,60)").run(firstGuest.data.player.id, firstGuest.data.player.username);
  const secondGameCountBeforeReset = resetDb.prepare("SELECT COUNT(*) AS count FROM games WHERE player_id=?").get(secondGuest.data.player.id).count;
  resetDb.prepare("INSERT INTO games(player_id,username,mode,score,reward,duration) VALUES(?,?,'bots',99,456,60)").run(secondGuest.data.player.id, secondGuest.data.player.username);
  resetDb.close();

  const resetNotification = new Promise(resolve => playerOne.once("playerScoresReset", resolve));
  const unauthorizedReset = await fetch(`${baseUrl}/api/me/reset-scores`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "RESET" })
  });
  assert.equal(unauthorizedReset.status, 401);
  const unconfirmedReset = await fetch(`${baseUrl}/api/me/reset-scores`, {
    method: "POST", headers: { authorization: `Bearer ${firstGuest.data.token}`, "content-type": "application/json" },
    body: JSON.stringify({ confirmation: "NO" })
  });
  assert.equal(unconfirmedReset.status, 400);
  const resetResponse = await fetch(`${baseUrl}/api/me/reset-scores`, {
    method: "POST", headers: { authorization: `Bearer ${firstGuest.data.token}`, "content-type": "application/json" },
    body: JSON.stringify({ confirmation: " reset " })
  });
  assert.equal(resetResponse.status, 200);
  await resetNotification;
  const resetState = await nextState(playerOne);
  const activePlayerAfterReset = resetState.snakes.find(snake => snake.id === playerOne.id);
  assert.ok(activePlayerAfterReset);
  assert.equal(activePlayerAfterReset.score, 0);
  const resetBoard = await (await fetch(`${baseUrl}/api/leaderboard`)).json();
  assert.equal(resetBoard.best.length, 1);
  const afterResetDb = new DatabaseSync(databaseFile);
  const resetPlayer = afterResetDb.prepare("SELECT points,games,best_score FROM players WHERE id=?").get(firstGuest.data.player.id);
  assert.deepEqual({ ...resetPlayer }, { points: 0, games: 0, best_score: 0 });
  const preservedPlayer = afterResetDb.prepare("SELECT points,games,best_score FROM players WHERE id=?").get(secondGuest.data.player.id);
  assert.deepEqual({ ...preservedPlayer }, { points: 456, games: 8, best_score: 99 });
  assert.equal(afterResetDb.prepare("SELECT COUNT(*) AS count FROM games WHERE player_id=?").get(firstGuest.data.player.id).count, 0);
  assert.equal(afterResetDb.prepare("SELECT COUNT(*) AS count FROM games WHERE player_id=?").get(secondGuest.data.player.id).count, secondGameCountBeforeReset + 1);
  assert.equal(afterResetDb.prepare("SELECT COUNT(*) AS count FROM inventory WHERE player_id=?").get(firstGuest.data.player.id).count, 1);
  afterResetDb.close();
  const resetProfile = await fetch(`${baseUrl}/api/me`, { headers: { authorization: `Bearer ${firstGuest.data.token}` } });
  assert.equal((await resetProfile.json()).player.points, 0);
});
