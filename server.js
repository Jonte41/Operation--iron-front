const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 8080);
const PUBLIC = path.join(__dirname, "public");
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  const requested = urlPath === "/" ? "/index.html" : urlPath;
  const file = path.join(PUBLIC, requested.replace(/^\/+/, ""));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    const ext = path.extname(file);
    const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json" };
    res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control":"no-store" });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server });
const rooms = new Map();
const sockets = new Map();
const MAX_PLAYERS = 7;
const MIN_PLAYERS = 2;

function code() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}
function send(ws, type, data = {}) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...data }));
}
function roomSnapshot(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    mode: room.mode,
    camera: room.camera,
    map: room.map,
    state: room.state,
    players: [...room.players.values()].map(p => ({
      id:p.id, name:p.name, x:p.x, z:p.z, yaw:p.yaw, pitch:p.pitch,
      hp:p.hp, alive:p.alive, kills:p.kills, deaths:p.deaths, team:p.team, ready:p.ready
    }))
  };
}
function broadcast(room, type, data = {}) {
  const payload = JSON.stringify({ type, ...data });
  for (const p of room.players.values()) {
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(payload);
  }
}
function broadcastState(room) { broadcast(room, "state", { room: roomSnapshot(room) }); }
function assignTeams(room) {
  let i = 0;
  for (const p of room.players.values()) p.team = room.mode === "teams" ? (i++ % 2 === 0 ? "A" : "B") : null;
}
function spawn(p, index) {
  const angle = (index / Math.max(1, MAX_PLAYERS)) * Math.PI * 2;
  p.x = Math.cos(angle) * 12;
  p.z = Math.sin(angle) * 12;
  p.yaw = -angle + Math.PI;
  p.pitch = 0;
  p.hp = 100;
  p.alive = true;
}
function endMatch(room, winnerText) {
  room.state = "ended";
  room.endText = winnerText;
  broadcast(room, "matchEnd", { text:winnerText, room:roomSnapshot(room) });
}
function leave(ws) {
  const meta = sockets.get(ws);
  if (!meta) return;
  sockets.delete(ws);
  const room = rooms.get(meta.roomCode);
  if (!room) return;
  room.players.delete(meta.playerId);
  if (room.players.size === 0) rooms.delete(room.code);
  else {
    if (room.hostId === meta.playerId) room.hostId = room.players.keys().next().value;
    if (room.state === "playing" && room.players.size < MIN_PLAYERS) {
      room.state = "lobby";
      broadcast(room, "notice", { text:"Not enough players remain. Match returned to lobby." });
    }
    broadcastState(room);
  }
}
wss.on("connection", ws => {
  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg.type !== "string") return;

    if (msg.type === "create") {
      if (sockets.has(ws)) return;
      if (rooms.size > 500) return send(ws, "error", { message:"Server is busy. Try again shortly." });
      let roomCode;
      do { roomCode = code(); } while (rooms.has(roomCode));
      const id = crypto.randomUUID();
      const name = String(msg.name || "Operator").trim().slice(0, 18) || "Operator";
      const room = { code:roomCode, hostId:id, mode:msg.mode === "teams" ? "teams" : "ffa",
        camera:msg.camera === "third" ? "third" : "first", map:"Ash City", state:"lobby",
        players:new Map(), createdAt:Date.now(), endText:"" };
      const p = { id, name, ws, x:0, z:0, yaw:0, pitch:0, hp:100, alive:true, kills:0, deaths:0, team:null, ready:false, lastShot:0 };
      room.players.set(id,p); rooms.set(roomCode,room); sockets.set(ws,{roomCode,playerId:id});
      assignTeams(room);
      send(ws,"joined",{ id, room:roomSnapshot(room) });
      broadcastState(room);
      return;
    }

    if (msg.type === "join") {
      if (sockets.has(ws)) return;
      const roomCode = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g,"").slice(0,6);
      const room = rooms.get(roomCode);
      if (!room) return send(ws,"error",{message:"Room code not found. Check the code and try again."});
      if (room.players.size >= MAX_PLAYERS) return send(ws,"error",{message:"This room is full (maximum 7 players)."});
      if (room.state === "playing") return send(ws,"error",{message:"This match has already started."});
      const id = crypto.randomUUID();
      const name = String(msg.name || "Operator").trim().slice(0,18) || "Operator";
      const p = { id, name, ws, x:0, z:0, yaw:0, pitch:0, hp:100, alive:true, kills:0, deaths:0, team:null, ready:false, lastShot:0 };
      room.players.set(id,p); sockets.set(ws,{roomCode,playerId:id});
      assignTeams(room);
      send(ws,"joined",{ id, room:roomSnapshot(room) });
      broadcastState(room);
      return;
    }

    const meta = sockets.get(ws);
    if (!meta) return send(ws,"error",{message:"Create or join a room first."});
    const room = rooms.get(meta.roomCode);
    if (!room) return;
    const p = room.players.get(meta.playerId);
    if (!p) return;

    if (msg.type === "settings") {
      if (p.id !== room.hostId || room.state !== "lobby") return;
      if (msg.mode === "teams" || msg.mode === "ffa") room.mode = msg.mode;
      if (msg.camera === "first" || msg.camera === "third") room.camera = msg.camera;
      assignTeams(room); broadcastState(room); return;
    }
    if (msg.type === "ready") {
      p.ready = !!msg.ready; broadcastState(room); return;
    }
    if (msg.type === "start") {
      if (p.id !== room.hostId) return send(ws,"error",{message:"Only the room host can start the match."});
      if (room.players.size < MIN_PLAYERS) return send(ws,"error",{message:"At least 2 players are needed to start."});
      if (room.state === "playing") return;
      room.state = "playing"; room.endText = ""; assignTeams(room);
      let i = 0; for (const player of room.players.values()) { player.kills = 0; player.deaths = 0; spawn(player, i++); player.ready = true; }
      broadcast(room,"matchStart",{ room:roomSnapshot(room), duration:300 });
      broadcastState(room);
      room.startedAt = Date.now();
      if (room.timer) clearTimeout(room.timer);
      room.timer = setTimeout(() => {
        if (room.state !== "playing") return;
        const scores = [...room.players.values()].sort((a,b)=>b.kills-a.kills);
        endMatch(room, scores.length ? `${scores[0].name} wins on eliminations!` : "Time expired.");
      },300000);
      return;
    }
    if (msg.type === "move" && room.state === "playing") {
      const x = Number(msg.x), z = Number(msg.z), yaw = Number(msg.yaw), pitch = Number(msg.pitch);
      if (![x,z,yaw,pitch].every(Number.isFinite)) return;
      p.x = Math.max(-29,Math.min(29,x)); p.z = Math.max(-29,Math.min(29,z));
      p.yaw = yaw; p.pitch = Math.max(-1.4,Math.min(1.4,pitch));
      broadcast(room,"playerMove",{ id:p.id, x:p.x,z:p.z,yaw:p.yaw,pitch:p.pitch });
      return;
    }
    if (msg.type === "shoot" && room.state === "playing" && p.alive) {
      const now = Date.now();
      if (now - p.lastShot < 180) return;
      p.lastShot = now;
      const targetId = String(msg.targetId || "");
      const target = room.players.get(targetId);
      if (!target || target.id === p.id || !target.alive) return;
      if (room.mode === "teams" && target.team === p.team) return;
      const dist = Math.hypot(target.x-p.x,target.z-p.z);
      if (dist > 45) return;
      target.hp -= Math.max(10,Math.min(55,Number(msg.damage) || 25));
      broadcast(room,"shot",{ shooterId:p.id,targetId:target.id,hp:Math.max(0,target.hp) });
      if (target.hp <= 0) {
        target.alive = false; target.deaths++; p.kills++;
        broadcast(room,"elimination",{ shooterId:p.id, targetId:target.id, shooterName:p.name,targetName:target.name,kills:p.kills });
        if (room.mode === "ffa" && [...room.players.values()].filter(q=>q.alive).length <= 1) {
          endMatch(room, `${p.name} is the last operator standing!`);
        } else {
          setTimeout(() => {
            if (room.state === "playing" && room.players.has(target.id)) spawn(target, [...room.players.keys()].indexOf(target.id));
            broadcast(room,"respawn",{id:target.id,x:target.x,z:target.z,hp:target.hp,alive:target.alive});
            broadcastState(room);
          }, room.mode === "teams" ? 3000 : 999999999);
        }
      }
      broadcastState(room); return;
    }
    if (msg.type === "finish") {
      if (p.id === room.hostId && room.state === "playing") endMatch(room,"Match ended by host.");
    }
  });
  ws.on("close",()=>leave(ws));
  ws.on("error",()=>leave(ws));
});
server.listen(PORT,()=>console.log(`Operation Iron Front server running at http://localhost:${PORT}`));
