import net from "node:net";

/**
 * Bridge stdio to a Unix domain socket, byte for byte.
 *
 * MCP clients like Claude Code speak stdio to a process they spawn, or HTTP - not
 * sockets. The desktop app hosts the MCP conversation on a socket it owns (so every
 * tool call and result flows through it and drives native panels), and this command
 * is how a stdio client joins that conversation:
 *
 *   claude mcp add datactx -- querypad mcp-attach /tmp/datactx.sock
 *
 * Deliberately dumb: no framing, no parsing, no buffering policy of its own. The
 * app and the engine own the protocol; this is a wire.
 */
export function runMcpAttach(socketPath: string): Promise<number> {
  return new Promise((resolve) => {
    const socket = net.connect({ path: socketPath });

    socket.on("connect", () => {
      process.stdin.pipe(socket);
      socket.pipe(process.stdout);
    });

    // stdout is the MCP transport; diagnostics go to stderr only.
    socket.on("error", (err) => {
      console.error(`mcp-attach: ${err.message}`);
      resolve(1);
    });

    // Either side closing ends the bridge: the socket closing means the host app
    // went away; stdin ending means the client hung up.
    socket.on("close", () => resolve(0));
    process.stdin.on("end", () => socket.end());
  });
}
