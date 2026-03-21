import type { PartyKitServer } from "partykit/server";
import { onConnect } from "y-partykit";

export default {
  onConnect(conn, room) {
    return onConnect(conn, room);
  },
} satisfies PartyKitServer;
