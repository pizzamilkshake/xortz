export type PlayerId = "A" | "B";
export type UnitId = "A1" | "A2" | "A3" | "B1" | "B2" | "B3";
export type MatchPhase = "waiting" | "ready" | "active" | "finished";

export interface LobbyOptions {
  mapId: string;
  turnDurationSeconds: number;
}

export interface UnitSnapshot {
  id: UnitId;
  owner: PlayerId;
  x: number;
  y: number;
  health: number;
  eliminated: boolean;
  exposed: boolean;
}

export interface WindState {
  /** World-space horizontal acceleration; sign indicates direction. */
  acceleration: number;
  intensity: number;
  direction: "left" | "right" | "calm";
}

export interface WeaponDefinition {
  id: string;
  displayName: string;
  projectile: "ballistic" | "custom";
  minLaunchSpeed: number;
  maxLaunchSpeed: number;
  maxDirectDamage: number;
  blastRadius: number;
  blastDamageAtEdge: number;
  structureDamage: number;
  corridorRevealMs: number;
  persistentRevealRadius: number;
}

export const WORLD = { width: 1536, height: 864 } as const;
export const MAX_PLAYER_NAME_LENGTH = 20;

export function sanitizePlayerName(value: unknown): string {
  if (typeof value !== "string") return "";
  const withoutControls = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return Array.from(withoutControls).slice(0, MAX_PLAYER_NAME_LENGTH).join("");
}

export const AVAILABLE_MAPS = [
  { id: "starter-houses", displayName: "Twin Houses" },
] as const;

export const INITIAL_WEAPONS: readonly WeaponDefinition[] = [
  {
    id: "small-missile",
    displayName: "Small Missile",
    projectile: "ballistic",
    minLaunchSpeed: 240,
    maxLaunchSpeed: 720,
    maxDirectDamage: 100,
    blastRadius: 110,
    blastDamageAtEdge: 0,
    structureDamage: 70,
    corridorRevealMs: 4500,
    persistentRevealRadius: 110,
  },
];

/** Interleaved slot order, filtering eliminated units at activation time. */
export const TURN_ORDER: readonly UnitId[] = ["A1", "B1", "A2", "B2", "A3", "B3"];

export function nextLivingUnit(current: UnitId, living: ReadonlySet<UnitId>): UnitId | undefined {
  const start = TURN_ORDER.indexOf(current);
  for (let offset = 1; offset <= TURN_ORDER.length; offset += 1) {
    const candidate = TURN_ORDER[(start + offset) % TURN_ORDER.length];
    if (living.has(candidate)) return candidate;
  }
  return undefined;
}

export function isValidLobbyOptions(value: LobbyOptions): boolean {
  return typeof value?.mapId === "string"
    && AVAILABLE_MAPS.some((map) => map.id === value.mapId)
    && Number.isInteger(value.turnDurationSeconds)
    && value.turnDurationSeconds >= 10 && value.turnDurationSeconds <= 300;
}
