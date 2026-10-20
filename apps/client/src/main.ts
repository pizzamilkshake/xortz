import Phaser from "phaser";
import { Client, type Room } from "@colyseus/sdk";
import { AVAILABLE_MAPS, MAX_PLAYER_NAME_LENGTH, sanitizePlayerName, TURN_ORDER, WORLD, type LobbyOptions } from "@turnbound/shared";
import "./style.css";

interface PlayerStateView {
  sessionId: string;
  team: string;
  displayName: string;
  ready: boolean;
  readyRevision: number;
}

interface LobbyStateView {
  phase: string;
  hostSessionId: string;
  optionsRevision: number;
  mapId: string;
  turnDurationSeconds: number;
  activeUnitId: string;
  windIntensity: number;
  windDirection: string;
  units: { values(): Iterable<UnitStateView>; get(id: string): UnitStateView | undefined };
  players: {
    size: number;
    get(sessionId: string): PlayerStateView | undefined;
    values(): Iterable<PlayerStateView>;
  };
}

interface UnitStateView { id: string; owner: string; x: number; y: number; health: number; eliminated: boolean; exposed: boolean; }

interface LobbyListingMetadata {
  hostName?: string;
  mapId?: string;
  turnDurationSeconds?: number;
  phase?: string;
}

interface ListedLobby {
  roomId: string;
  name: string;
  clients: number;
  maxClients: number;
  locked?: boolean;
  metadata?: LobbyListingMetadata;
}

const serverUrl = import.meta.env.VITE_GAME_SERVER ?? "http://localhost:2567";
const colyseus = new Client(serverUrl);
const byId = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const homeScreen = byId<HTMLElement>("home-screen");
const lobbyScreen = byId<HTMLElement>("lobby-screen");
const matchScreen = byId<HTMLElement>("match-screen");
const homeFeedback = byId<HTMLElement>("home-feedback");
const lobbyFeedback = byId<HTMLElement>("lobby-feedback");
const createButton = byId<HTMLButtonElement>("create-lobby");
const playerNameInput = byId<HTMLInputElement>("player-name");
playerNameInput.maxLength = MAX_PLAYER_NAME_LENGTH;
const joinForm = byId<HTMLFormElement>("join-form");
const roomCodeInput = byId<HTMLInputElement>("room-code");
const refreshLobbiesButton = byId<HTMLButtonElement>("refresh-lobbies");
const lobbyListStatus = byId<HTMLElement>("lobby-list-status");
const openLobbyList = byId<HTMLElement>("open-lobby-list");
const roomCodeDisplay = byId<HTMLElement>("room-code-display");
const copyInviteButton = byId<HTMLButtonElement>("copy-invite");
const mapSelect = byId<HTMLSelectElement>("map-select");
const timerSelect = byId<HTMLSelectElement>("timer-select");
const readyButton = byId<HTMLButtonElement>("ready-button");
const playersList = byId<HTMLElement>("players-list");
const lobbyStatus = byId<HTMLElement>("lobby-status");
const hostNote = byId<HTMLElement>("host-note");
const settingsHelp = byId<HTMLElement>("settings-help");
const readyHeading = byId<HTMLElement>("ready-heading");
const readyHelp = byId<HTMLElement>("ready-help");
const matchHeading = byId<HTMLElement>("match-heading");
const activeUnitId = byId<HTMLElement>("active-unit-id");
const activePlayerName = byId<HTMLElement>("active-player-name");
const turnLimit = byId<HTMLElement>("turn-limit");
const windReadout = byId<HTMLElement>("wind-readout");
const windMeterFill = byId<HTMLElement>("wind-meter-fill");
const windIntensity = byId<HTMLElement>("wind-intensity");
const turnOrderElement = byId<HTMLElement>("turn-order");
turnOrderElement.replaceChildren(...TURN_ORDER.map((id) => {
  const token = document.createElement("span");
  token.className = `turn-token team-${id[0].toLowerCase()}`;
  token.dataset.unitId = id;
  token.textContent = id;
  return token;
}));

let currentRoom: Room<LobbyStateView> | undefined;
let lobbyBrowser: Room | undefined;
let openLobbies: ListedLobby[] = [];
let lobbyBrowserConnected = false;
let currentOptionsRevision = -1;
const PLAYER_NAME_KEY = "turnbound.playerName";

try {
  playerNameInput.value = sanitizePlayerName(localStorage.getItem(PLAYER_NAME_KEY));
} catch {
  // Storage can be disabled by browser privacy settings; the field still works for this visit.
}

playerNameInput.addEventListener("input", () => {
  try { localStorage.setItem(PLAYER_NAME_KEY, sanitizePlayerName(playerNameInput.value)); } catch { /* Optional convenience only. */ }
});

for (const map of AVAILABLE_MAPS) {
  const option = document.createElement("option");
  option.value = map.id;
  option.textContent = map.displayName;
  mapSelect.append(option);
}

class LobbyBackdrop extends Phaser.Scene {
  private art?: Phaser.GameObjects.Graphics;
  private unitLabels: Phaser.GameObjects.Text[] = [];
  private battleState?: LobbyStateView;
  private ownTeam = "A";
  private draggingMap = false;
  private lastPointer = new Phaser.Math.Vector2();
  constructor() { super("lobby-backdrop"); }

  create() {
    this.art = this.add.graphics();
    const camera = this.cameras.main;
    camera.setBounds(0, 0, WORLD.width, WORLD.height);
    camera.setZoom(1);
    // Keep the render canvas fixed, but size the camera viewport to the visible
    // browser area so a small window can pan across the full map at 1×.
    const updateCameraViewport = () => {
      const width = Math.min(WORLD.width, window.innerWidth);
      const height = Math.min(WORLD.height, window.innerHeight);
      camera.setViewport((WORLD.width - width) / 2, (WORLD.height - height) / 2, width, height);
    };
    updateCameraViewport();
    camera.centerOn(WORLD.width / 2, WORLD.height / 2);
    window.addEventListener("resize", updateCameraViewport);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener("resize", updateCameraViewport));

    // Wheel zooms toward the pointer so the point under the cursor stays in place.
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _objects: unknown[], _dx: number, deltaY: number) => {
      pointer.event.preventDefault();
      const before = camera.getWorldPoint(pointer.x, pointer.y);
      const zoom = Phaser.Math.Clamp(camera.zoom * Math.exp(-deltaY * 0.001), 1, 3);
      camera.setZoom(zoom);
      const after = camera.getWorldPoint(pointer.x, pointer.y);
      camera.scrollX += before.x - after.x;
      camera.scrollY += before.y - after.y;
    });

    // Right or middle mouse drag pans without taking over left-click aiming later.
    this.input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (!pointer.rightButtonDown() && !pointer.middleButtonDown()) return;
      this.draggingMap = true;
      this.lastPointer.set(pointer.x, pointer.y);
      pointer.event.preventDefault();
    });
    this.input.on("pointerup", () => { this.draggingMap = false; });
    this.input.on("pointerupoutside", () => { this.draggingMap = false; });
    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (!this.draggingMap) return;
      camera.scrollX -= (pointer.x - this.lastPointer.x) / camera.zoom;
      camera.scrollY -= (pointer.y - this.lastPointer.y) / camera.zoom;
      this.lastPointer.set(pointer.x, pointer.y);
    });
    this.game.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
    this.drawBattlefield();
  }

  syncBattle(state: LobbyStateView, ownTeam: string) {
    this.battleState = state;
    this.ownTeam = ownTeam;
    this.drawBattlefield();
  }

  showLobbyBackdrop() { this.battleState = undefined; this.drawBattlefield(); }

  private drawBattlefield() {
    if (!this.art) return;
    this.unitLabels.forEach((label) => label.destroy());
    this.unitLabels = [];
    const art = this.art;
    art.clear();
    art.fillStyle(0x172633, 1).fillRect(0, 0, WORLD.width, WORLD.height);
    art.fillStyle(0x203342, 1).fillRect(0, 0, WORLD.width, 500);
    art.fillStyle(0x2b4251, 0.4).fillEllipse(768, 450, 1100, 300);
    art.lineStyle(1, 0x8098a4, 0.08);
    for (let y = 60; y < 650; y += 48) art.lineBetween(0, y, WORLD.width, y);
    art.fillStyle(0x18242c, 1).fillRect(0, 760, WORLD.width, 104);
    art.fillStyle(0x526c77, 1).fillRect(0, 750, 650, 14).fillRect(886, 750, 650, 14);
    art.fillStyle(0xc47b4a, 0.9).fillRect(638, 746, 12, 22).fillRect(886, 746, 12, 22);
    art.fillStyle(0x0c141b, 1).fillRect(650, 764, 236, 100);
    art.lineStyle(2, 0x536c79, 0.45).lineBetween(650, 770, 650, 850).lineBetween(886, 770, 886, 850);
    for (const side of [0, 1] as const) {
      const x = side === 0 ? 56 : 984;
      const color = side === 0 ? 0xd49a58 : 0x67a9cc;
      art.fillStyle(0x263945, 1).fillRect(x, 300, 496, 450);
      art.fillStyle(color, 0.22).fillRect(x, 300, 496, 8);
      for (let floor = 0; floor < 6; floor += 1) {
        const y = 342 + floor * 68;
        art.fillStyle(0x111b22, 1).fillRect(x + 12, y, 472, 54);
        art.fillStyle(0x283a45, 1).fillRect(x + 12, y + 48, 472, 10);
        art.lineStyle(2, color, 0.34).lineBetween(x + 12, y + 54, x + 484, y + 54);
        for (let bay = 0; bay < 5; bay += 1) {
          const bx = x + 28 + bay * 91;
          art.fillStyle(0x9fc0c7, 0.08).fillRect(bx, y + 9, 61, 31);
          art.lineStyle(1, 0x8ba4aa, 0.18).strokeRect(bx, y + 9, 61, 31);
        }
      }
      art.fillStyle(0x344b56, 1).fillRect(x, 744, 496, 10);
      if (this.battleState && (side === 0 ? "A" : "B") !== this.ownTeam) {
        art.fillStyle(0x080e13, 0.76).fillRect(x + 1, 308, 494, 434);
        art.lineStyle(1, 0x9cabb0, 0.12);
        for (let floor = 0; floor < 6; floor += 1) art.lineBetween(x + 10, 396 + floor * 68, x + 486, 396 + floor * 68);
      }
    }
    if (this.battleState) this.drawUnits(this.battleState);
  }

  private drawUnits(state: LobbyStateView) {
    if (!this.art) return;
    const art = this.art;
    for (const unit of state.units.values()) {
      if (unit.eliminated || (unit.owner !== this.ownTeam && !unit.exposed)) continue;
      const color = unit.owner === "A" ? 0xf0b665 : 0x78c5e7;
      art.fillStyle(0x080e13, 0.7).fillEllipse(unit.x, unit.y + 18, 34, 10);
      art.fillStyle(color, 1).fillRoundedRect(unit.x - 12, unit.y - 22, 24, 34, 7);
      art.fillStyle(0xf3eee0, 1).fillCircle(unit.x, unit.y - 25, 8);
      art.fillStyle(0x18232b, 1).fillRect(unit.x - 16, unit.y - 43, 32, 4);
      art.fillStyle(unit.health > 50 ? 0x8fcea1 : 0xe19a6d, 1).fillRect(unit.x - 16, unit.y - 43, 32 * Math.max(0, unit.health) / 100, 4);
      art.fillStyle(0x101820, 0.92).fillRoundedRect(unit.x - 19, unit.y + 17, 38, 18, 5);
      art.lineStyle(1, color, 0.75).strokeRoundedRect(unit.x - 19, unit.y + 17, 38, 18, 5);
      this.unitLabels.push(this.add.text(unit.x, unit.y + 26, unit.id, {
        fontFamily: "Space Grotesk, sans-serif", fontSize: "11px", fontStyle: "bold", color: unit.owner === "A" ? "#f0b665" : "#78c5e7",
      }).setOrigin(0.5));
    }
  }
}

const backdropScene = new LobbyBackdrop();
new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game-backdrop",
  width: WORLD.width,
  height: WORLD.height,
  backgroundColor: "#172330",
  // Keep the renderer viewport locked to the 1536×864 world. CSS clips the
  // fixed-size canvas to the browser window during a match; the camera handles navigation.
  scale: { mode: Phaser.Scale.NONE },
  scene: [backdropScene],
});

function setFeedback(message: string, isError = false) {
  const inLobby = !lobbyScreen.hidden;
  const target = inLobby ? lobbyFeedback : homeFeedback;
  target.textContent = message;
  target.classList.toggle("is-error", isError);
}

function showHome(message = "") {
  homeScreen.hidden = false;
  lobbyScreen.hidden = true;
  matchScreen.hidden = true;
  byId<HTMLElement>("game-backdrop").classList.remove("is-match");
  history.replaceState(null, "", window.location.pathname);
  homeFeedback.textContent = message;
  homeFeedback.classList.toggle("is-error", Boolean(message));
}

function showLobby() {
  homeScreen.hidden = true;
  lobbyScreen.hidden = false;
  matchScreen.hidden = true;
  byId<HTMLElement>("game-backdrop").classList.remove("is-match");
  backdropScene.showLobbyBackdrop();
}

function showMatch() {
  homeScreen.hidden = true;
  lobbyScreen.hidden = true;
  matchScreen.hidden = false;
  byId<HTMLElement>("game-backdrop").classList.add("is-match");
}

function setBusy(busy: boolean) {
  createButton.disabled = busy;
  playerNameInput.disabled = busy;
  roomCodeInput.disabled = busy;
  joinForm.querySelector("button")!.disabled = busy;
  if (busy) setFeedback("Connecting to the game server…");
  else {
    for (const feedback of [homeFeedback, lobbyFeedback]) {
      if (feedback.textContent === "Connecting to the game server…") feedback.textContent = "";
    }
  }
}

function renderLobby(state: LobbyStateView) {
  if (state.phase === "active" || state.phase === "finished") {
    matchHeading.textContent = state.phase === "finished" ? "The match has ended" : "Both players are ready";
    showMatch();
    const local = currentRoom && state.players.get(currentRoom.sessionId);
    backdropScene.syncBattle(state, local?.team ?? "A");
    activeUnitId.textContent = state.activeUnitId;
    activePlayerName.textContent = [...state.players.values()].find((player) => player.team === state.activeUnitId[0])?.displayName ?? `Player ${state.activeUnitId[0]}`;
    turnLimit.innerHTML = `${state.turnDurationSeconds}<span>s</span>`;
    const direction = state.windDirection === "left" ? "←" : state.windDirection === "right" ? "→" : "—";
    windReadout.textContent = `${direction} ${state.windDirection.toUpperCase()}`;
    const strength = Math.max(0, Math.min(100, state.windIntensity / 40 * 100));
    windMeterFill.style.width = `${strength}%`;
    windIntensity.textContent = state.windIntensity < 3 ? "No wind" : state.windIntensity < 18 ? "Light wind" : state.windIntensity < 32 ? "Strong wind" : "Gale force";
    turnOrderElement.querySelectorAll<HTMLElement>(".turn-token").forEach((token) => token.classList.toggle("is-active", token.dataset.unitId === state.activeUnitId));
    return;
  }

  showLobby();
  if (!currentRoom) return;
  const localPlayer = state.players.get(currentRoom.sessionId);
  const players = [...state.players.values()];
  const isHost = state.hostSessionId === currentRoom.sessionId;
  const readyCount = players.filter((player) => player.ready && player.readyRevision === state.optionsRevision).length;

  if (currentOptionsRevision !== state.optionsRevision) {
    currentOptionsRevision = state.optionsRevision;
    const mapOption = [...mapSelect.options].find((option) => option.value === state.mapId);
    if (mapOption) mapSelect.value = state.mapId;
    timerSelect.value = String(state.turnDurationSeconds);
  }

  roomCodeDisplay.textContent = currentRoom.roomId;
  hostNote.textContent = isHost ? "HOST CONTROLS" : "HOST SELECTS";
  mapSelect.disabled = !isHost;
  timerSelect.disabled = !isHost;
  settingsHelp.textContent = isHost
    ? "Change either option before the match starts. Both players will need to ready up again."
    : "The host controls these options. You can ready up once the other player joins.";
  readyButton.disabled = state.players.size !== 2;
  readyButton.textContent = localPlayer?.ready ? "Cancel ready" : "Ready up";
  readyButton.classList.toggle("is-ready", Boolean(localPlayer?.ready));
  readyHeading.textContent = state.players.size < 2 ? "Waiting for your opponent" : `${readyCount} of 2 players ready`;
  readyHelp.textContent = state.players.size < 2
    ? "Share the room code so another player can join."
    : "Both players must agree to the current settings to start.";
  lobbyStatus.textContent = state.players.size < 2
    ? "Waiting for player"
    : state.phase === "ready" ? `${readyCount} / 2 ready` : "Lobby open";

  playersList.replaceChildren();
  for (const team of ["A", "B"]) {
    const player = players.find((candidate) => candidate.team === team);
    const card = document.createElement("div");
    card.className = `player-card${player?.ready ? " player-ready" : ""}`;
    const marker = document.createElement("span");
    marker.className = `player-marker team-${team.toLowerCase()}`;
    marker.textContent = team;
    const details = document.createElement("div");
    details.className = "player-details";
    const name = document.createElement("strong");
    name.textContent = player ? player.displayName : "Open seat";
    const status = document.createElement("span");
    status.textContent = player ? (player.ready && player.readyRevision === state.optionsRevision ? "Ready" : "Not ready") : "Waiting to join";
    const indicator = document.createElement("span");
    indicator.className = `ready-indicator${player?.ready ? " is-ready" : ""}`;
    indicator.setAttribute("aria-label", player?.ready ? "Ready" : "Not ready");
    details.append(name, status);
    card.append(marker, details, indicator);
    playersList.append(card);
  }
}

async function connectToRoom(connect: () => Promise<Room<LobbyStateView>>) {
  const displayName = sanitizePlayerName(playerNameInput.value);
  if (!displayName) {
    setFeedback("Enter a name before creating or joining a lobby.", true);
    playerNameInput.focus();
    return;
  }
  playerNameInput.value = displayName;
  try { localStorage.setItem(PLAYER_NAME_KEY, playerNameInput.value); } catch { /* Optional convenience only. */ }
  setBusy(true);
  try {
    const room = await connect();
    currentRoom = room;
    currentOptionsRevision = -1;
    room.send("lobby:name", { name: playerNameInput.value });
    history.replaceState(null, "", `${window.location.pathname}?roomId=${encodeURIComponent(room.roomId)}`);
    room.onStateChange((state) => renderLobby(state));
    room.onLeave(() => {
      if (currentRoom !== room) return;
      currentRoom = undefined;
      currentOptionsRevision = -1;
      showHome("The lobby connection ended.");
    });
    renderLobby(room.state);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not connect to that lobby.";
    showHome(message);
  } finally {
    setBusy(false);
  }
}

function renderOpenLobbies() {
  const joinable = openLobbies.filter((room) =>
    !room.locked
    && room.clients < room.maxClients
    && room.metadata?.phase !== "active"
    && room.metadata?.phase !== "finished",
  );

  openLobbyList.replaceChildren();
  if (joinable.length === 0) {
    lobbyListStatus.textContent = lobbyBrowserConnected
      ? "No open lobbies right now. Create one to get started."
      : "Lobby list disconnected. Refresh to try again.";
    lobbyListStatus.classList.toggle("is-offline", !lobbyBrowserConnected);
    return;
  }

  lobbyListStatus.textContent = `${joinable.length} open ${joinable.length === 1 ? "lobby" : "lobbies"}`;
  lobbyListStatus.classList.remove("is-offline");
  for (const room of joinable) {
    const metadata = room.metadata ?? {};
    const card = document.createElement("article");
    card.className = "open-lobby-card";

    const information = document.createElement("div");
    information.className = "open-lobby-info";
    const host = document.createElement("strong");
    host.textContent = metadata.hostName || "New lobby";
    const detail = document.createElement("span");
    const mapName = AVAILABLE_MAPS.find((map) => map.id === metadata.mapId)?.displayName ?? "Unknown map";
    const timer = Number.isInteger(metadata.turnDurationSeconds) ? `${metadata.turnDurationSeconds}s turns` : "Timer unset";
    detail.textContent = `${mapName} · ${timer} · ${room.clients}/${room.maxClients} players`;
    const code = document.createElement("small");
    code.textContent = room.roomId;
    information.append(host, detail, code);

    const joinButton = document.createElement("button");
    joinButton.className = "button button-small button-secondary";
    joinButton.type = "button";
    joinButton.textContent = "Join";
    joinButton.addEventListener("click", () => {
      void connectToRoom(() => colyseus.joinById<LobbyStateView>(room.roomId));
    });

    card.append(information, joinButton);
    openLobbyList.append(card);
  }
}

async function connectLobbyBrowser() {
  refreshLobbiesButton.disabled = true;
  lobbyBrowserConnected = false;
  lobbyListStatus.textContent = "Connecting to lobby browser…";
  lobbyListStatus.classList.remove("is-offline");
  try {
    const browser = await colyseus.joinOrCreate("lobby", { filter: { name: "game" } });
    lobbyBrowser = browser;
    lobbyBrowserConnected = true;
    browser.onMessage("rooms", (rooms: ListedLobby[]) => {
      openLobbies = rooms;
      renderOpenLobbies();
    });
    browser.onMessage("+", (entry: [string, ListedLobby]) => {
      const [roomId, room] = entry;
      const existingIndex = openLobbies.findIndex((candidate) => candidate.roomId === roomId);
      if (existingIndex < 0) openLobbies.push(room);
      else openLobbies[existingIndex] = room;
      renderOpenLobbies();
    });
    browser.onMessage("-", (roomId: string) => {
      openLobbies = openLobbies.filter((room) => room.roomId !== roomId);
      renderOpenLobbies();
    });
    browser.onLeave(() => {
      if (lobbyBrowser !== browser) return;
      lobbyBrowser = undefined;
      lobbyBrowserConnected = false;
      renderOpenLobbies();
    });
  } catch {
    lobbyBrowserConnected = false;
    openLobbies = [];
    lobbyListStatus.textContent = "Could not load lobbies. Check that the game server is running, then refresh.";
    lobbyListStatus.classList.add("is-offline");
    openLobbyList.replaceChildren();
  } finally {
    refreshLobbiesButton.disabled = false;
  }
}

async function refreshLobbyBrowser() {
  const oldBrowser = lobbyBrowser;
  lobbyBrowser = undefined;
  if (oldBrowser) {
    try { await oldBrowser.leave(); } catch { /* Reconnect below will report the current status. */ }
  }
  void connectLobbyBrowser();
}

refreshLobbiesButton.addEventListener("click", () => { void refreshLobbyBrowser(); });

createButton.addEventListener("click", () => {
  void connectToRoom(() => colyseus.create<LobbyStateView>("game"));
});

joinForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomId = roomCodeInput.value.trim();
  if (!roomId) return;
  void connectToRoom(() => colyseus.joinById<LobbyStateView>(roomId));
});

copyInviteButton.addEventListener("click", async () => {
  if (!currentRoom) return;
  const inviteUrl = new URL(window.location.href);
  inviteUrl.searchParams.set("roomId", currentRoom.roomId);
  try {
    await navigator.clipboard.writeText(inviteUrl.toString());
    copyInviteButton.textContent = "Copied";
    window.setTimeout(() => { copyInviteButton.textContent = "Copy invite"; }, 1600);
  } catch {
    setFeedback("Copying is unavailable here. Share this room code: " + currentRoom.roomId);
  }
});

function sendLobbyOptions() {
  if (!currentRoom) return;
  const options: LobbyOptions = {
    mapId: mapSelect.value,
    turnDurationSeconds: Number(timerSelect.value),
  };
  currentRoom.send("lobby:options", options);
  setFeedback("Settings updated. Both players need to ready up again.");
}

mapSelect.addEventListener("change", sendLobbyOptions);
timerSelect.addEventListener("change", sendLobbyOptions);

readyButton.addEventListener("click", () => {
  const player = currentRoom?.state.players.get(currentRoom.sessionId);
  if (player) currentRoom?.send("lobby:ready", !player.ready);
});

byId<HTMLButtonElement>("leave-lobby").addEventListener("click", () => {
  const room = currentRoom;
  currentRoom = undefined;
  currentOptionsRevision = -1;
  if (room) void room.leave();
  showHome();
});

const inviteRoomId = new URLSearchParams(window.location.search).get("roomId");
if (inviteRoomId) {
  if (sanitizePlayerName(playerNameInput.value)) {
    void connectToRoom(() => colyseus.joinById<LobbyStateView>(inviteRoomId));
  } else {
    roomCodeInput.value = inviteRoomId;
    setFeedback("Enter your name to join this invite.");
    playerNameInput.focus();
  }
}

void connectLobbyBrowser();
