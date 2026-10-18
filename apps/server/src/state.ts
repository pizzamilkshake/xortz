import { MapSchema, Schema, type, view } from "@colyseus/schema";

export class UnitState extends Schema {
  @type("string") id = "";
  @type("string") owner = "";
  @view(1) @type("number") x = 0;
  @view(1) @type("number") y = 0;
  @type("number") health = 100;
  @type("boolean") eliminated = false;
  @type("boolean") exposed = false;
}

export class PlayerState extends Schema {
  @type("string") sessionId = "";
  @type("string") team = "";
  @type("string") displayName = "Player";
  @type("boolean") ready = false;
  @type("number") readyRevision = -1;
}

export class MatchState extends Schema {
  @type("string") phase = "waiting";
  @type("string") hostSessionId = "";
  @type("number") optionsRevision = 0;
  @type("string") mapId = "starter-houses";
  @type("number") turnDurationSeconds = 60;
  @type("string") activeUnitId = "A1";
  @type("number") windAcceleration = 0;
  @type("number") windIntensity = 0;
  @type("string") windDirection = "calm";
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
  @type({ map: UnitState }) units = new MapSchema<UnitState>();

  constructor() {
    super();
    for (const [id, owner, x, y] of [
      ["A1", "A", 155, 728], ["A2", "A", 304, 660], ["A3", "A", 453, 592],
      ["B1", "B", 1381, 728], ["B2", "B", 1232, 660], ["B3", "B", 1083, 592],
    ] as const) {
      const unit = new UnitState();
      unit.id = id;
      unit.owner = owner;
      unit.x = x;
      unit.y = y;
      this.units.set(id, unit);
    }
  }
}
