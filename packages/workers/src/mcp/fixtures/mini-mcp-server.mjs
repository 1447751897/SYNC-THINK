/**
 * Minimal MCP-compatible stdio server for tests.
 * Content-Length framed JSON-RPC 2.0. Tools: echo, ping, write_file.
 */
const PROTOCOL_VERSION = "2024-11-05";

function writeMessage(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write("Content-Length: " + body.length + "\r\n\r\n");
  process.stdout.write(body);
}

function handleRequest(msg) {
  if (!msg || typeof msg !== "object") return;
  const id = msg.id;
  const method = msg.method;
  const params = msg.params;
  if (method === "initialize") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: "sync-think-mini-mcp", version: "0.0.1" },
      },
    });
    return;
  }
  if (method === "notifications/initialized" || method === "initialized") return;
  if (method === "tools/list") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Echo text back",
            inputSchema: { type: "object", properties: { text: { type: "string" } } },
          },
          {
            name: "ping",
            description: "Health ping",
            inputSchema: { type: "object", properties: {} },
          },
          {
            name: "write_file",
            description: "Simulated write (does not touch disk)",
            inputSchema: {
              type: "object",
              properties: { path: { type: "string" }, content: { type: "string" } },
            },
          },
        ],
      },
    });
    return;
  }
  if (method === "tools/call") {
    const name = String((params && params.name) || "");
    const args =
      params && params.arguments && typeof params.arguments === "object"
        ? params.arguments
        : {};
    if (name === "echo") {
      const text = typeof args.text === "string" ? args.text : JSON.stringify(args);
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "ECHO:" + text }], isError: false },
      });
      return;
    }
    if (name === "ping") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: "PONG" }], isError: false },
      });
      return;
    }
    if (name === "write_file") {
      writeMessage({
        jsonrpc: "2.0",
        id,
        result: {
          content: [
            {
              type: "text",
              text:
                "SIMULATED_WRITE:" +
                String(args.path || "") +
                ":" +
                String(args.content || "").slice(0, 40),
            },
          ],
          isError: false,
        },
      });
      return;
    }
    writeMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Unknown tool: " + name },
    });
    return;
  }
  if (typeof id !== "undefined") {
    writeMessage({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found: " + String(method) },
    });
  }
}

let buffer = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd < 0) break;
    const header = buffer.subarray(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.subarray(headerEnd + 4);
      continue;
    }
    const len = Number(match[1]);
    const bodyStart = headerEnd + 4;
    if (buffer.length < bodyStart + len) break;
    const body = buffer.subarray(bodyStart, bodyStart + len).toString("utf8");
    buffer = buffer.subarray(bodyStart + len);
    try {
      handleRequest(JSON.parse(body));
    } catch (err) {
      process.stderr.write("[mini-mcp] parse error: " + String(err) + "\n");
    }
  }
});
process.stdin.on("end", () => process.exit(0));