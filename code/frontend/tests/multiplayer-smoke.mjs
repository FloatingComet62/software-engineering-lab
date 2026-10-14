import assert from "node:assert/strict";
import { io } from "socket.io-client";

const base = process.env.TEST_BACKEND_URL ?? "http://localhost:8787";
const origin = process.env.TEST_FRONTEND_URL ?? "http://localhost:3000";
const clients = [];
const ranked = process.env.RATED_SMOKE === "true";
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function once(socket, event, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out: ${event}`));
    }, timeout);
    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }
    socket.once(event, handler);
  });
}
async function account(name) {
  const response = await fetch(`${base}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      name,
      email: `race-${crypto.randomUUID()}@example.com`,
      password: crypto.randomUUID(),
    }),
  });
  assert.equal(response.status, 200, `Could not create ${name}`);
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
  const socket = io(base, {
    transports: ["websocket"],
    extraHeaders: { Cookie: cookies, Origin: origin },
    autoConnect: false,
  });
  clients.push(socket);
  const connected = once(socket, "connect");
  socket.connect();
  await connected;
  return { socket, cookies, user: (await response.json()).user };
}
async function request(client, path, body) {
  const response = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: client.cookies,
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
const command = (socket, event, payload) =>
  socket.timeout(8000).emitWithAck(event, payload);
try {
  const host = await account("Smoke Host");
  const player = await account("Smoke Racer");
  const { lobby } = await request(host, "/lobbies", {
    visibility: "private",
    rated: ranked,
    promptLength: "short",
  });
  await request(player, "/lobbies/join", { code: lobby.code });
  for (const client of [host, player])
    assert.ok(
      (await command(client.socket, "lobby:join", { lobbyId: lobby.id })).ok,
    );
  const early = await command(host.socket, "race:start", { lobbyId: lobby.id });
  assert.equal(early.ok, false);
  assert.equal(early.error.code, "players_not_ready");
  assert.ok(
    (
      await command(player.socket, "lobby:ready", {
        lobbyId: lobby.id,
        ready: true,
      })
    ).ok,
  );
  const hostCountdown = once(host.socket, "race:countdown");
  const playerCountdown = once(player.socket, "race:countdown");
  const started = once(host.socket, "race:started");
  assert.ok(
    (await command(host.socket, "race:start", { lobbyId: lobby.id })).ok,
  );
  const [first, second] = await Promise.all([hostCountdown, playerCountdown]);
  assert.equal(first.text, second.text);
  assert.equal(first.startsAt, second.startsAt);
  console.log(
    "PASS: separate accounts, room code, readiness, shared passage and countdown",
  );
  const spectator = await account("Smoke Spectator");
  await request(spectator, "/lobbies/join", { code: lobby.code });
  const watched = await command(spectator.socket, "lobby:join", {
    lobbyId: lobby.id,
  });
  assert.equal(watched.data.race.spectating, true);
  await started;
  await pause(100);
  const tick = once(player.socket, "race:tick");
  host.socket.emit("race:progress", {
    lobbyId: lobby.id,
    cursor: 1,
    keystrokes: 2,
    clientTime: Date.now(),
  });
  assert.equal((await tick).cursors[0].cursor, 1);
  assert.equal(
    (await command(host.socket, "race:resync", { lobbyId: lobby.id })).data.you
      .keystrokes,
    2,
  );
  player.socket.disconnect();
  await pause(200);
  const reconnected = once(player.socket, "connect");
  player.socket.connect();
  await reconnected;
  const restored = await command(player.socket, "lobby:join", {
    lobbyId: lobby.id,
  });
  assert.equal(restored.data.race.spectating, false);
  assert.equal(restored.data.race.status, "running");
  console.log(
    "PASS: live progress, mistake accounting, late spectator and reconnect",
  );
  const hostResults = once(host.socket, "race:finished", 60000);
  const playerResults = once(player.socket, "race:finished", 60000);
  for (let cursor = 2; cursor < first.text.length; cursor++) {
    await pause(90);
    for (const client of [host, player])
      client.socket.emit("race:progress", {
        lobbyId: lobby.id,
        cursor,
        keystrokes: cursor + (client === host ? 1 : 0),
        clientTime: Date.now(),
      });
  }
  await pause(90);
  const finish = await command(host.socket, "race:finish", {
    lobbyId: lobby.id,
    cursor: first.text.length,
    keystrokes: first.text.length + 1,
  });
  assert.ok(finish.ok);
  assert.equal(finish.data.position, 1);
  await pause(100);
  assert.ok(
    (
      await command(player.socket, "race:finish", {
        lobbyId: lobby.id,
        cursor: first.text.length,
        keystrokes: first.text.length,
      })
    ).ok,
  );
  const [a, b] = await Promise.all([hostResults, playerResults]);
  assert.deepEqual(a, b);
  assert.equal(a.results.length, 2);
  assert.ok(a.results.every((result) => result.finished));
  assert.ok(a.results.every((result) => result.flags.length === 0));
  assert.equal(
    a.results.find((result) => result.userId === host.user.id).accuracy < 1,
    true,
  );
  if (ranked) {
    const winner = a.results.find((result) => result.userId === host.user.id);
    const loser = a.results.find((result) => result.userId === player.user.id);
    assert.equal(winner.ratingBefore, 1000);
    assert.equal(winner.ratingAfter, 1016);
    assert.equal(winner.ratingChange, 16);
    assert.equal(loser.ratingAfter, 984);
    assert.equal(loser.ratingChange, -16);
    const response = await fetch(`${base}/api/profile`, {
      headers: { Cookie: host.cookies, Origin: origin },
    });
    const { profile } = await response.json();
    assert.equal(profile.rating, 1016);
    assert.equal(profile.races, 1);
    assert.equal(profile.wins, 1);
    assert.equal(profile.provisional, true);
    const history = await fetch(`${base}/api/lobbies/${lobby.id}/races`, {
      headers: { Cookie: host.cookies, Origin: origin },
    });
    const saved = await history.json();
    assert.equal(
      saved.races[0].results.find((result) => result.userId === host.user.id)
        .ratingChange,
      16,
    );
    console.log(
      "PASS: ranked rating changes, profile persistence and saved race history",
    );
  } else {
    assert.ok(a.results.every((result) => result.ratingChange === undefined));
  }
  console.log(
    "PASS: reliable finish, identical authoritative standings, accuracy and clean fair-play flags",
  );
  await pause(Math.max(0, a.lobbyReopensAt - Date.now()) + 300);
  const reopened = await command(host.socket, "lobby:join", {
    lobbyId: lobby.id,
  });
  assert.equal(reopened.data.snapshot.status, "in_lobby");
  assert.equal(
    reopened.data.snapshot.members.find(
      (member) => member.userId === spectator.user.id,
    ).role,
    "player",
  );
  assert.ok(reopened.data.snapshot.members.every((member) => !member.isReady));
  console.log("PASS: rematch, ready reset and spectator promotion");
  for (const client of [spectator, player, host])
    await command(client.socket, "lobby:leave", { lobbyId: lobby.id });
} finally {
  for (const socket of clients) socket.disconnect();
}
