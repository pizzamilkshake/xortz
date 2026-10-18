import { defineServer, defineRoom, LobbyRoom } from "colyseus";
import { GameRoom } from "./game-room.js";

const server = defineServer({
  rooms: {
    lobby: defineRoom(LobbyRoom),
    game: defineRoom(GameRoom).enableRealtimeListing(),
  },
  express: (app) => {
    app.get("/health", (_req, res) => res.json({ ok: true }));
  },
});

server.listen(2567);
