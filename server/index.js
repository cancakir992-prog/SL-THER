require("dotenv").config();

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const express = require("express");
const helmet = require("helmet");
const { DatabaseSync } = require("node:sqlite");
const { Server } = require("socket.io");

const port = Number(process.env.PORT || 3000);
const world = { width: 3600, height: 2400 };
const databaseFile = path.resolve(process.env.DATABASE_FILE || "./data/arena.sqlite");
fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
const db = new DatabaseSync(databaseFile);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
db.transaction = fn => (...args) => {
  db.exec("BEGIN");
  try {
    const result = fn(...args);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
};
db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, token_hash TEXT UNIQUE NOT NULL,
    points INTEGER NOT NULL DEFAULT 0 CHECK(points >= 0), games INTEGER NOT NULL DEFAULT 0,
    best_score INTEGER NOT NULL DEFAULT 0, equipped_skin TEXT NOT NULL DEFAULT 'mint',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS skins (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, rarity TEXT NOT NULL,
    price INTEGER NOT NULL CHECK(price >= 0), color TEXT NOT NULL, accent TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inventory (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    skin_id TEXT NOT NULL REFERENCES skins(id), PRIMARY KEY(player_id, skin_id)
  );
  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL REFERENCES players(id),
    username TEXT NOT NULL, mode TEXT NOT NULL, score INTEGER NOT NULL, reward INTEGER NOT NULL,
    duration INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS arena_meta (
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS games_recent_idx ON games(id DESC);
`);
db.prepare("INSERT OR IGNORE INTO arena_meta(key,value) VALUES('scores_epoch','0')").run();

const skinNames = [
  ["mint", "Nane", "Klasik"], ["coral", "Mercan", "Klasik"], ["ocean", "Okyanus", "Klasik"],
  ["violet", "Menekşe", "Klasik"], ["lemon", "Limon", "Klasik"], ["neon-pink", "Neon Pembe", "Neon"],
  ["neon-blue", "Neon Mavi", "Neon"], ["neon-lime", "Neon Yeşil", "Neon"], ["neon-orange", "Neon Turuncu", "Neon"],
  ["neon-purple", "Neon Mor", "Neon"], ["sunset", "Gün Batımı", "Gradyan"], ["aurora", "Kutup Işığı", "Gradyan"],
  ["ember", "Kor", "Ateş"], ["frost", "Ayaz", "Buz"], ["galaxy", "Galaksi", "Uzay"], ["cosmos", "Kozmoz", "Uzay"],
  ["rainbow", "Gökkuşağı", "Gökkuşağı"], ["gold", "Altın", "Metalik"], ["silver", "Gümüş", "Metalik"],
  ["copper", "Bakır", "Metalik"], ["forest", "Orman", "Doğa"], ["meadow", "Çayır", "Doğa"],
  ["lava", "Lav", "Element"], ["storm", "Fırtına", "Element"], ["camo-wood", "Kamuflaj Orman", "Kamuflaj"],
  ["camo-night", "Gece Devriyesi", "Kamuflaj"], ["zebra", "Zebra", "Çizgili"], ["candy", "Şeker", "Çizgili"],
  ["geo-cyan", "Geometri", "Geometrik"], ["arcade", "Arcade", "Retro"], ["8bit", "8-Bit", "Retro"],
  ["shadow", "Gölge", "Özel"], ["royal", "Kraliyet", "Özel"], ["prism", "Prizma", "Animasyonlu"],
  ["comet", "Kuyruklu Yıldız", "Animasyonlu"], ["jungle", "Jungle", "Doğa"], ["ice-crystal", "Buz Kristali", "Buz"],
  ["pink-cloud", "Pembe Bulut", "Özel"], ["deep-sea", "Derin Deniz", "Doğa"], ["solar", "Solar", "Uzay"]
];
const palette = [
  ["#56e0bd","#b6ffe9"],["#ff6e78","#ffd0a6"],["#48a9ff","#9deaff"],["#a77bff","#edbcff"],
  ["#d5ec62","#fff4a8"],["#ff4fd8","#ffb5f2"],["#3ce7ff","#b6f7ff"],["#91ff4a","#ddff9c"],
  ["#ff9f3f","#ffe29a"],["#a755ff","#e7b5ff"],["#ff6f61","#ffc857"],["#40e0b0","#8b7bff"],
  ["#ff572e","#ffcf5c"],["#7be7ff","#ffffff"],["#6c53ff","#ff73e8"],["#172552","#71d9ff"],
  ["#ff5d91","#ffe76b"],["#f5b942","#fff0a8"],["#8da2b8","#e4f4ff"],["#bd7047","#ffd1a6"],
  ["#388e62","#a9e586"],["#8ecb51","#fff084"],["#8e211d","#ffb12b"],["#485979","#87eaff"],
  ["#516b3b","#a79d59"],["#303b57","#7787a7"],["#252a3b","#f2f1e8"],["#f05d9e","#ffe177"],
  ["#267b9c","#80f4ff"],["#5533aa","#68f9b5"],["#d24d65","#f4df58"],["#303446","#a69cff"],
  ["#322052","#ffd76a"],["#f95b7b","#70e8ff"],["#293a88","#fff29c"],["#206c50","#c5e65a"],
  ["#7fc8ff","#efffff"],["#fa87c8","#fff0fa"],["#124e78","#31d6c6"],["#ef6d29","#fff166"]
];
const rare = ["Sıradan", "Sıradışı", "Nadir", "Epik", "Efsanevi"];
const insertSkin = db.prepare("INSERT OR IGNORE INTO skins VALUES (?, ?, ?, ?, ?, ?, ?)");
skinNames.forEach(([id, name, category], i) => {
  const rarity = i < 5 ? "Sıradan" : i % 9 === 0 ? "Efsanevi" : i % 4 === 0 ? "Epik" : i % 3 === 0 ? "Nadir" : rare[1];
  const price = i < 5 ? 0 : 70 + i * 13;
  insertSkin.run(id, name, category, rarity, price, ...palette[i]);
});

const app = express();
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.resolve(__dirname, "..", "public")));
const server = http.createServer(app);
const origins = (process.env.ALLOWED_ORIGINS || "").split(",").map(x => x.trim()).filter(Boolean);
const io = new Server(server, {
  cors: { origin: (origin, done) => done(null, !origin || origins.length === 0 || origins.includes(origin)) },
  pingInterval: 10000, pingTimeout: 20000, maxHttpBufferSize: 1e5
});
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const namePattern = /^[\p{L}\p{N}_ -]{2,18}$/u;
const rateLimits = new Map();
app.use("/api", (req, res, next) => {
  const now = Date.now(), limit = rateLimits.get(req.ip);
  if (!limit || now - limit.start > 60000) rateLimits.set(req.ip, { start: now, count: 1 });
  else if (++limit.count > 180) return res.status(429).json({ error: "Çok fazla istek." });
  next();
});
function requirePlayer(req, res, next) {
  const token = req.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || token.length > 200) return res.status(401).json({ error: "Oturum gerekli." });
  const player = db.prepare("SELECT id,username,points,games,best_score,equipped_skin FROM players WHERE token_hash=?").get(digest(token));
  if (!player) return res.status(401).json({ error: "Oturum geçersiz." });
  req.player = player;
  next();
}
app.post("/api/guest", (req, res, next) => {
  try {
    const name = typeof req.body?.username === "string" ? req.body.username.trim() : "";
    if (!namePattern.test(name)) return res.status(400).json({ error: "İsim 2-18 karakter olmalı." });
    const token = crypto.randomBytes(32).toString("base64url"), id = crypto.randomUUID();
    const username = `${name}#${id.slice(0, 6).toUpperCase()}`;
    db.prepare("INSERT INTO players(id,username,token_hash) VALUES(?,?,?)").run(id, username, digest(token));
    db.prepare("INSERT INTO inventory(player_id,skin_id) VALUES(?,'mint')").run(id);
    res.json({ token, player: { id, username, points: 0, games: 0, best_score: 0, equipped_skin: "mint" } });
  } catch (error) { next(error); }
});
app.get("/api/me", requirePlayer, (req, res) => {
  const owned = db.prepare(`SELECT s.id,s.name,s.category,s.rarity,s.price,s.color,s.accent
    FROM inventory i JOIN skins s ON s.id=i.skin_id WHERE i.player_id=? ORDER BY s.price,s.name`).all(req.player.id);
  res.json({ player: req.player, skins: owned });
});
app.get("/api/skins", (req, res) => res.json(db.prepare("SELECT id,name,category,rarity,price,color,accent FROM skins ORDER BY price,name").all()));
app.get("/api/leaderboard", (req, res) => res.json({
  best: db.prepare("SELECT username,best_score AS score FROM players WHERE best_score>0 ORDER BY best_score DESC LIMIT 10").all(),
  daily: db.prepare(`SELECT username,MAX(score) AS score FROM games
    WHERE created_at>=datetime('now','start of day') GROUP BY player_id ORDER BY score DESC LIMIT 10`).all(),
  weekly: db.prepare(`SELECT username,MAX(score) AS score FROM games
    WHERE created_at>=datetime('now','-7 days') GROUP BY player_id ORDER BY score DESC LIMIT 10`).all(),
  recent: db.prepare("SELECT username,score,mode,created_at FROM games ORDER BY id DESC LIMIT 8").all(),
  players: db.prepare("SELECT username,points,games,best_score FROM players ORDER BY points DESC,best_score DESC LIMIT 10").all(),
  online: sockets.size
}));
app.get("/api/history", requirePlayer, (req, res) => res.json(db.prepare(
  "SELECT mode,score,reward,duration,created_at FROM games WHERE player_id=? ORDER BY id DESC LIMIT 20"
).all(req.player.id)));

const purchase = db.transaction((playerId, skinId) => {
  const item = db.prepare("SELECT price FROM skins WHERE id=?").get(skinId);
  const player = db.prepare("SELECT points FROM players WHERE id=?").get(playerId);
  if (!item || !player) return "Skin bulunamadı.";
  if (db.prepare("SELECT 1 FROM inventory WHERE player_id=? AND skin_id=?").get(playerId, skinId)) return "Bu skin zaten sende.";
  if (player.points < item.price) return "Yeterli ödül puanın yok.";
  if (!db.prepare("UPDATE players SET points=points-? WHERE id=? AND points>=?").run(item.price, playerId, item.price).changes) return "Yeterli ödül puanın yok.";
  db.prepare("INSERT INTO inventory(player_id,skin_id) VALUES(?,?)").run(playerId, skinId);
  return null;
});
app.post("/api/shop/buy", requirePlayer, (req, res, next) => {
  try {
    const error = purchase(req.player.id, typeof req.body?.skinId === "string" ? req.body.skinId : "");
    if (error) return res.status(400).json({ error });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
app.post("/api/shop/equip", requirePlayer, (req, res, next) => {
  try {
    const skin = typeof req.body?.skinId === "string" ? req.body.skinId : "";
    if (!db.prepare("SELECT 1 FROM inventory WHERE player_id=? AND skin_id=?").get(req.player.id, skin)) return res.status(400).json({ error: "Bu skine sahip değilsin." });
    db.prepare("UPDATE players SET equipped_skin=? WHERE id=?").run(skin, req.player.id);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

const rooms = new Map(), sockets = new Map();
const rnd = max => Math.random() * max;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const createFood = () => ({ id: crypto.randomUUID(), x: rnd(world.width), y: rnd(world.height), color: ["#ffe16a","#50e4c2","#fc78c7","#7bb8ff"][Math.floor(rnd(4))] });
function createRoom(code, mode) {
  const room = { code, mode, snakes: new Map(), food: Array.from({ length: 170 }, createFood) };
  rooms.set(code, room);
  return room;
}
function createSnake(socket, player, skin, isBot = false, difficulty = 1) {
  const x = 180 + rnd(world.width - 360), y = 180 + rnd(world.height - 360), angle = rnd(Math.PI * 2);
  return {
    id: socket?.id || crypto.randomUUID(), playerId: player?.id || null,
    username: player?.username || `Bot ${Math.floor(rnd(90) + 10)}`, skin: skin || "mint",
    color: isBot ? ["#ff806f","#77a7ff","#f2d86c","#bc8cff"][Math.floor(rnd(4))] : null,
    isBot, difficulty, x, y, angle, target: angle,
    body: Array.from({ length: 12 }, (_, i) => ({ x: x - Math.cos(angle) * i * 11, y: y - Math.sin(angle) * i * 11 })),
    score: 0, alive: true, boost: false, startedAt: Date.now(), lastInput: 0,
    disconnectedAt: null, scoreEpoch: Number(db.prepare("SELECT value FROM arena_meta WHERE key='scores_epoch'").get().value)
  };
}
function getRoom(socket) { for (const room of rooms.values()) if (room.snakes.has(socket.id)) return room; return null; }
function getRank(room, snake) { return [...room.snakes.values()].filter(s => s.alive).sort((a,b) => b.score-a.score).findIndex(s => s.id === snake.id) + 1; }
const persistGame = db.transaction((snake, mode, duration) => {
  const epoch = Number(db.prepare("SELECT value FROM arena_meta WHERE key='scores_epoch'").get().value);
  if (snake.scoreEpoch !== epoch) return 0;
  const reward = Math.max(0, Math.floor(snake.score * .6 + Math.min(duration, 600) * .2));
  db.prepare("INSERT INTO games(player_id,username,mode,score,reward,duration) VALUES(?,?,?,?,?,?)").run(snake.playerId,snake.username,mode,snake.score,reward,duration);
  db.prepare("UPDATE players SET points=points+?,games=games+1,best_score=MAX(best_score,?) WHERE id=?").run(reward,snake.score,snake.playerId);
  return reward;
});
function eliminate(room, snake) {
  if (!snake.alive) return;
  const rank = getRank(room, snake);
  snake.alive = false;
  for (let i=0; i<Math.min(20,Math.ceil(snake.body.length/2)); i++) {
    const part=snake.body[Math.min(snake.body.length-1,i*2)];
    room.food.push({...createFood(),x:part.x,y:part.y});
  }
  if (!snake.isBot && snake.playerId) {
    const duration=Math.max(1,Math.floor((Date.now()-snake.startedAt)/1000));
    const reward=persistGame(snake,room.mode,duration);
    sockets.get(snake.id)?.emit("gameOver", { score: snake.score, duration, rank, reward });
    room.snakes.delete(snake.id);
    sockets.get(snake.id)?.leave(room.code);
  } else room.snakes.delete(snake.id);
}
function nearestFood(room, snake) {
  let nearest=null,best=Infinity;
  for(const item of room.food){const d=(item.x-snake.x)**2+(item.y-snake.y)**2;if(d<best){best=d;nearest=item;}}
  return nearest;
}
function tick(room) {
  const snakes=[...room.snakes.values()].filter(s=>s.alive);
  for(const snake of snakes) {
    if(snake.disconnectedAt && Date.now()-snake.disconnectedAt>30000){eliminate(room,snake);continue;}
    if(snake.isBot) {
      const target=nearestFood(room,snake);
      if(target)snake.target=Math.atan2(target.y-snake.y,target.x-snake.x);
      const margin=180;
      if(snake.x<margin)snake.target=0;
      if(snake.x>world.width-margin)snake.target=Math.PI;
      if(snake.y<margin)snake.target=Math.PI/2;
      if(snake.y>world.height-margin)snake.target=-Math.PI/2;
      for(const other of snakes)if(other.id!==snake.id&&Math.hypot(snake.x-other.x,snake.y-other.y)<110){snake.target=Math.atan2(snake.y-other.y,snake.x-other.x);break;}
    }
    const delta=Math.atan2(Math.sin(snake.target-snake.angle),Math.cos(snake.target-snake.angle));
    snake.angle+=Math.max(-.09,Math.min(.09,delta));
    const speed=snake.boost&&snake.score>8?5.2:snake.isBot?3.2+snake.difficulty*.5:3.5;
    const nx=snake.x+Math.cos(snake.angle)*speed,ny=snake.y+Math.sin(snake.angle)*speed;
    if(nx<0||ny<0||nx>world.width||ny>world.height){eliminate(room,snake);continue;}
    snake.x=nx;snake.y=ny;snake.body.unshift({x:nx,y:ny});
    while(snake.body.length>12+Math.floor(snake.score/2))snake.body.pop();
    if(snake.boost&&snake.score>8&&Math.random()<.12)snake.score--;
    for(let i=room.food.length-1;i>=0;i--)if(distance(snake,room.food[i])<22){snake.score++;room.food.splice(i,1);}
    let dead=false;
    for(const other of snakes) {
      if(!other.alive||other.id===snake.id)continue;
      for(let i=8;i<other.body.length;i+=2)if(Math.hypot(snake.x-other.body[i].x,snake.y-other.body[i].y)<12){dead=true;break;}
      if(dead)break;
    }
    if(dead)eliminate(room,snake);
  }
  while(room.food.length<170)room.food.push(createFood());
  io.to(room.code).emit("state",{world,food:room.food,snakes:[...room.snakes.values()].filter(s=>s.alive).map(s=>({
    id:s.id,username:s.username,skin:s.skin,color:s.color,x:s.x,y:s.y,angle:s.angle,body:s.body,score:s.score,isBot:s.isBot
  })),online:[...room.snakes.values()].filter(s=>!s.isBot&&s.alive).length});
  if(room.snakes.size===0||(room.mode==="bots"&&![...room.snakes.values()].some(s=>!s.isBot)))rooms.delete(room.code);
}
const resetPlayerScores = db.transaction(playerId => {
  db.prepare("DELETE FROM games WHERE player_id=?").run(playerId);
  db.prepare("UPDATE players SET points=0,games=0,best_score=0 WHERE id=?").run(playerId);
});
app.post("/api/me/reset-scores", requirePlayer, (req, res, next) => {
  try {
    const confirmation = typeof req.body?.confirmation === "string" ? req.body.confirmation.trim().toUpperCase() : "";
    if (confirmation !== "RESET") return res.status(400).json({ error: "Sıfırlama onayı geçersiz." });
    resetPlayerScores(req.player.id);
    for (const room of rooms.values()) {
      for (const snake of room.snakes.values()) {
        if (snake.playerId === req.player.id) {
          snake.score = 0;
          snake.body.length = Math.min(snake.body.length, 12);
          snake.startedAt = Date.now();
        }
      }
    }
    for (const socket of sockets.values()) {
      if (socket.data.player.id === req.player.id) socket.emit("playerScoresReset");
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
setInterval(() => { for (const room of rooms.values()) tick(room); }, 1000 / 30).unref();
io.use((socket,next)=>{
  try {
    const token=socket.handshake.auth?.token;
    if(typeof token!=="string"||token.length>200)return next(new Error("Oturum gerekli."));
    const player=db.prepare("SELECT id,username,equipped_skin FROM players WHERE token_hash=?").get(digest(token));
    if(!player)return next(new Error("Oturum geçersiz."));
    socket.data.player=player;next();
  } catch(error){next(error);}
});
io.on("connection",socket=>{
  sockets.set(socket.id,socket);
  socket.on("join",(payload,callback)=>{
    const ack=typeof callback==="function"?callback:()=>{},mode=payload?.mode;
    if(mode!=="online"&&mode!=="bots")return ack({error:"Geçersiz oyun modu."});
    if(getRoom(socket))return ack({error:"Zaten bir oyundasın."});
    let room;
    if(mode==="bots"){
      room=createRoom(`bot-${socket.id}`,mode);
      room.snakes.set(socket.id,createSnake(socket,socket.data.player,socket.data.player.equipped_skin));
      for(let i=0;i<9;i++){const bot=createSnake(null,null,null,true,1+Math.floor(rnd(3)));room.snakes.set(bot.id,bot);}
    }else{
      const code=typeof payload.room==="string"?payload.room.trim().toUpperCase():"";
      if(code&&!/^[A-Z0-9]{4,8}$/.test(code))return ack({error:"Oda kodu geçersiz."});
      if(code)room=rooms.get(code)||createRoom(code,mode);
      else{
        room=[...rooms.values()].find(r=>r.mode===mode&&r.snakes.size<30);
        if(!room){let id;do{id=crypto.randomBytes(3).toString("hex").toUpperCase();}while(rooms.has(id));room=createRoom(id,mode);}
      }
      const reconnect = [...room.snakes.values()].find(s => s.playerId === socket.data.player.id && s.disconnectedAt && Date.now() - s.disconnectedAt < 30000);
      if (reconnect) {
        room.snakes.delete(reconnect.id);
        reconnect.id = socket.id;
        reconnect.disconnectedAt = null;
        room.snakes.set(socket.id, reconnect);
      }
      if (!reconnect && room.snakes.size >= 30) return ack({ error: "Oda dolu." });
      if (!reconnect) room.snakes.set(socket.id, createSnake(socket, socket.data.player, socket.data.player.equipped_skin));
    }
    socket.join(room.code);ack({room:room.code,world,mode});
    io.to(room.code).emit("onlineCount",[...room.snakes.values()].filter(s=>!s.isBot&&s.alive).length);
  });
  socket.on("leave", () => {
    const room = getRoom(socket), snake = room?.snakes.get(socket.id);
    if (room && snake) {
      if (snake.alive) eliminate(room, snake);
      room.snakes.delete(socket.id);
      socket.leave(room.code);
    }
  });
  socket.on("input",payload=>{
    const snake=getRoom(socket)?.snakes.get(socket.id);
    if(!snake||!snake.alive||typeof payload?.angle!=="number"||!Number.isFinite(payload.angle))return;
    if(Date.now()-snake.lastInput<20)return;
    snake.lastInput=Date.now();snake.target=Math.max(-Math.PI,Math.min(Math.PI,payload.angle));snake.boost=payload.boost===true;
  });
  socket.on("disconnect",()=>{
    sockets.delete(socket.id);const room=getRoom(socket),snake=room?.snakes.get(socket.id);
    if(snake){snake.disconnectedAt=Date.now();setTimeout(()=>{if(snake.disconnectedAt&&room.snakes.get(socket.id)===snake){eliminate(room,snake);room.snakes.delete(socket.id);}},30000);}
  });
});
app.use((error,req,res,next)=>{
  console.error(error);
  if(res.headersSent)return next(error);
  res.status(500).json({error:"Sunucu hatası."});
});
server.listen(port,()=>console.log(`Slither Arena listening on port ${port}`));
