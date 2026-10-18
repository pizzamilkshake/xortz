import { Client, Room } from "colyseus";
import { StateView } from "@colyseus/schema";
import { isValidLobbyOptions, nextLivingUnit, sanitizePlayerName, TURN_ORDER, type LobbyOptions, type UnitId } from "@turnbound/shared";
import { MatchState, PlayerState } from "./state.js";

export class GameRoom extends Room<MatchState> {
  maxClients = 2;
  state = new MatchState();
  private listingUpdateQueue = Promise.resolve();

  onCreate() {
    this.metadata = {
      hostName: "Player A",
      mapId: this.state.mapId,
      turnDurationSeconds: this.state.turnDurationSeconds,
      phase: this.state.phase,
    };

    this.onMessage("lobby:name", (client, payload: { name?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase === "active" || this.state.phase === "finished") return;
      const displayName = sanitizePlayerName(payload?.name);
      if (!displayName) return;
      player.displayName = displayName;
      this.updateListingMetadata();
    });

    this.onMessage("lobby:options", (client, options: LobbyOptions) => {
      if (client.sessionId !== this.state.hostSessionId || this.state.phase === "active" || this.state.phase === "finished") return;
      if (!options || !isValidLobbyOptions(options)) return;
      this.state.mapId = options.mapId;
      this.state.turnDurationSeconds = options.turnDurationSeconds;
      this.state.optionsRevision += 1;
      for (const player of this.state.players.values()) {
        player.ready = false;
        player.readyRevision = -1;
      }
      this.updateListingMetadata();
    });

    this.onMessage("lobby:ready", (client, ready: boolean) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || this.state.phase === "active" || typeof ready !== "boolean") return;
      player.ready = ready;
      player.readyRevision = ready ? this.state.optionsRevision : -1;
      this.state.phase = "ready";
      const allReady = this.state.players.size === 2
        && [...this.state.players.values()].every((p) => p.ready && p.readyRevision === this.state.optionsRevision);
      this.updateListingMetadata();
      if (allReady) this.startMatch();
    });

    // Action handlers are the authoritative validation boundary. The full movement,
    // ballistic and visibility rules will be implemented behind these message seams.
    this.onMessage("unit:move", (client, payload: { unitId: UnitId; x: number; y: number }) => {
      const unit = this.state.units.get(payload?.unitId);
      const player = this.state.players.get(client.sessionId);
      if (this.state.phase !== "active" || !unit || !player || unit.owner !== player.team || unit.id !== this.state.activeUnitId) return;
      if (!Number.isFinite(payload.x) || !Number.isFinite(payload.y)) return;
      // TODO: validate platform/floor/corridor movement and the post-fire window;
      // derive exposure from the map's cover geometry before changing client views.
      unit.x = payload.x;
      unit.y = payload.y;
    });

    this.onMessage("weapon:fire", (_client, _payload: unknown) => {
      // TODO: validate active unit, aim, charge, weapon; simulate wind/gravity;
      // resolve unit + structure damage; update temporary/permanent reveal; advance turn.
    });
  }

  onJoin(client: Client) {
    client.view = new StateView();
    if (this.state.players.size === 0) {
      this.state.hostSessionId = client.sessionId;
      this.addPlayer(client.sessionId, "A");
    } else {
      this.addPlayer(client.sessionId, "B");
    }
    const player = this.state.players.get(client.sessionId)!;
    for (const unit of this.state.units.values()) {
      if (unit.owner === player.team) client.view.add(unit, 1);
    }
    this.state.phase = "waiting";
    this.updateListingMetadata();
  }

  onLeave(client: Client) {
    this.state.players.delete(client.sessionId);
    if (client.sessionId === this.state.hostSessionId) {
      this.state.hostSessionId = this.state.players.keys().next().value ?? "";
    }
    if (this.state.phase !== "active") {
      this.state.phase = "waiting";
      for (const player of this.state.players.values()) {
        player.ready = false;
        player.readyRevision = -1;
      }
    }
    this.updateListingMetadata();
  }

  private addPlayer(sessionId: string, team: string) {
    const player = new PlayerState();
    player.sessionId = sessionId;
    player.team = team;
    player.displayName = `Player ${team}`;
    this.state.players.set(sessionId, player);
  }

  private startMatch() {
    this.state.phase = "active";
    this.lock();
    this.updateListingMetadata();
    this.state.activeUnitId = "A1";
    this.rollWind();
  }

  private advanceTurn(current: UnitId) {
    const living = new Set([...this.state.units.values()].filter((u) => !u.eliminated).map((u) => u.id as UnitId));
    const next = nextLivingUnit(current, living);
    if (!next) {
      this.state.phase = "finished";
      return;
    }
    this.state.activeUnitId = next;
    this.rollWind();
  }

  private rollWind() {
    const acceleration = Math.random() * 80 - 40;
    this.state.windAcceleration = acceleration;
    this.state.windIntensity = Math.abs(acceleration);
    this.state.windDirection = acceleration < -2 ? "left" : acceleration > 2 ? "right" : "calm";
  }

  private revealUnitToOpponent(unitId: UnitId) {
    const unit = this.state.units.get(unitId);
    if (!unit) return;
    for (const client of this.clients) {
      const player = this.state.players.get(client.sessionId);
      if (player && player.team !== unit.owner) client.view.add(unit, 1);
    }
  }

  private updateListingMetadata() {
    const host = this.state.players.get(this.state.hostSessionId);
    const metadata = {
      hostName: host?.displayName ?? "Player A",
      mapId: this.state.mapId,
      turnDurationSeconds: this.state.turnDurationSeconds,
      phase: this.state.phase,
    };
    this.listingUpdateQueue = this.listingUpdateQueue
      .then(() => this.setMetadata(metadata))
      .catch((error: unknown) => {
        console.error("Could not update lobby listing metadata", error);
      });
  }
}
