# Turnbound

TypeScript monorepo scaffold for a 1v1, turn-based artillery game. The server owns match rules and authoritative state; Phaser renders the client; `packages/shared` holds stable contracts and tunable game data.

## Stack

- TypeScript + npm workspaces
- Phaser 4 + Vite client
- Colyseus server and schema state

Keep the Colyseus client SDK and server on the same minor line. This scaffold targets `0.18.x` on both sides.

## Start locally

Use Node.js 20 or later, then run `npm install`, `npm run dev:server`, and in another terminal `npm run dev:client`. The client expects the room server at `http://localhost:2567`.

The client now includes the create/join lobby flow, live open-lobby browser, invite-code sharing, player display names, host map/timer controls, readiness display, and the synchronized start transition. The first battlefield scene draws two six-floor houses, separated platforms and a lethal gap, visible friendly units, a fogged enemy house, and turn/wind HUD elements. This is a visual scaffold; movement, firing, real turn countdowns, and authoritative combat are follow-up work. Open lobbies are listed through Colyseus `LobbyRoom` and realtime room metadata. Names are stored locally in the browser and validated by the server (up to 20 characters). The first map catalog contains Twin Houses; add map definitions to `AVAILABLE_MAPS` to make more options selectable. Authentication and persistence remain follow-up work.

## Rule model captured here

- Teams are `A` and `B`; unit IDs are A1–A3 and B1–B3.
- Activation order interleaves teams by slot: A1, B1, A2, B2, A3, B3. Eliminated units are skipped.
- The lobby owner can edit map and turn duration until the match starts. Readiness applies to the current option revision; changing options clears both ready flags. Both players must ready before starting.
- A unit can move and choose a weapon before firing. Aim is the pointer position. Holding fire charges launch power. Firing ends the normal activation; the shooter receives a five-second post-fire move window unless it took damage from that shot.
- Wind is generated per activation and shown to players. Gravity curves projectile flight. Weapon tuning is data-driven. Blast damage and structural damage are resolved by the server.
- Visibility is player-specific: units are concealed inside intact house areas, exposed outside, briefly revealed by shots entering a house corridor, and permanently revealed in the blast area when damage occurs.
- Health reaching zero eliminates a unit. Falling into the platform gap is lethal. Destroyed structures can affect cover and fog behavior as rules are implemented.

## Visibility boundary

Unit coordinates are tagged for per-client visibility. On join, each player is given a Colyseus `StateView` containing their own units. The room has a seam for adding enemy units when exposed. Corridor reveal timers, persistent reveal zones, and removing units from the opposing view when they re-enter cover still need implementation; hidden coordinates should never be sent and then merely hidden by client rendering.

## Layout

```
apps/client/       Phaser + Vite browser client
apps/server/       Colyseus authoritative room
packages/shared/   contracts, configuration and turn-order helpers
```
