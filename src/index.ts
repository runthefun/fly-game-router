import "dotenv/config";
import express from "express";
import cors from "cors";
import basicAuth from "express-basic-auth";
import { JoinReqBody } from "./types";
import { RoomManager } from "./RoomManager";
import { FlyApi } from "./FlyApi";
import { ENV } from "./env";
import { CreateReqBodySchema, joinReqBodySchema } from "./schemas";
import { MachinesPool } from "./MachinesPool";
import { MachinesGC } from "./MachineGC";

//#region middleware
const corsOptions = {
  origin: "*",
  methods: "GET,HEAD,PUT,PATCH,POST,DELETE",
  preflightContinue: false,
  optionsSuccessStatus: 204,
  credentials: true,
};

const basicAuthMiddleware = basicAuth({
  users: {
    admin: ENV.MONITOR_PASSWORD,
  },
  challenge: true,
});

const app = express();
const port = 3333;

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));

app.use(express.json());

// Ensure all responses include CORS headers
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Credentials", "true");
  next();
});
//#endregion

app.get("/", (req, res) => {
  //
  res.send(`🥸🥸🥸🥸🥸🥸🥸`);
});

const pool = new MachinesPool({
  minSize: 10,
  maxSize: 100,
  templateApp: ENV.TEMPLATE_APP,
  templateMachineId: ENV.TEMPLATE_MACHINE,
  api: new FlyApi({
    appId: ENV.POOL_APP,
    apiKey: ENV.FLY_API_KEY,
  }),
});

const roomManager = new RoomManager({ pool });

const gc = new MachinesGC({
  pool,
  pollInterval: 5 * 60 * 1000, // 5mins
  idleTimeout: 30 * 60 * 1000, // 30m
  onShouldRelease: (mid) => {
    console.log("[GC] Machine", mid, "reached idle timeout. Releasing...");
    roomManager.deleteMachine(mid);
  },
});

if (process.env.NODE_ENV === "production" && ENV.CURRENT_APP) {
  // roomManager.pool.start();
  gc.start();
}

app.post("/join", async (req, res) => {
  //
  try {
    //
    const body = joinReqBodySchema.parse(req.body);

    let { roomId, gameId, specs } = body;
    roomId = roomId || gameId;

    const region = req.get("Fly-Region");
    const ip = req.get("Fly-Client-IP");

    console.log(`Join request for ${gameId}; region: ${region}; ip: ${ip}`);

    const st = Date.now();
    const machineId = await roomManager.getOrCreateMachineForRoom({
      gameId,
      roomId: gameId,
      region,
      ip,
      specs,
    });

    console.log("Got machine ", machineId, "in", Date.now() - st, "ms");

    const replayHeader = `app=${ENV.POOL_APP};instance=${machineId}`;

    res.set("fly-replay", replayHeader).send();
    //
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.post("/create", async (req, res) => {
  //
  try {
    //
    const body = CreateReqBodySchema.parse(req.body);

    let { gameId, roomId } = body;
    roomId = roomId || gameId;

    const region = req.get("Fly-Region");
    const ip = req.get("Fly-Client-IP");

    console.log(
      `Create request for ${gameId}/${roomId}; region: ${region}; ip: ${ip}`
    );

    const st = Date.now();
    const machineId = await roomManager.getOrCreateMachineForRoom({
      roomId,
      gameId,
      region,
      ip,
    });

    console.log("Got machine ", machineId, "in", Date.now() - st, "ms");

    const replayHeader = `app=${ENV.POOL_APP};instance=${machineId}`;

    res.set("fly-replay", replayHeader).send();

    //
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.post("/pool-reset", basicAuthMiddleware, async (req, res) => {
  //
  try {
    //
    await roomManager.pool.stop();
    res.json({
      success: true,
      message: "Pool reset",
    });
    //
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.post("/config-pool", basicAuthMiddleware, async (req, res) => {
  //
  try {
    //
    const body = req.body;

    if (!body?.minSize || !body?.maxSize) {
      //
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    roomManager.pool.config({
      minSize: body.minSize,
      maxSize: body.maxSize,
    });

    res.json({
      success: true,
      message: "Pool config updated",
    });
    //
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.get("/rooms", basicAuthMiddleware, async (req, res) => {
  //
  try {
    //
    const machines = await roomManager.getMachines();

    return res.json({
      success: true,
      machines,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.get("/room-stats/:mid", basicAuthMiddleware, async (req, res) => {
  //
  const mid = req.params.mid;

  if (!mid) {
    return res.status(400).json({
      success: false,
      message: "Invalid request",
    });
  }

  const endpoint = `https://${ENV.POOL_APP}.fly.dev/getRooms`;

  const data = await fetch(endpoint, {
    headers: {
      "fly-force-instance-id": mid,
    },
  }).then((res) => res.json());

  res.json(data);
});

app.get("/pool-status", basicAuthMiddleware, async (req, res) => {
  //
  try {
    //
    const { free, total } = await roomManager.pool.getPoolSize();

    return res.json({
      success: true,
      free,
      total,
      active: roomManager.pool.active,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.post("/pool/start", basicAuthMiddleware, async (req, res) => {
  //
  try {
    //
    if (roomManager.pool.active) {
      return res.json({
        success: true,
        message: "Pool already started",
      });
    }

    roomManager.pool.start();

    return res.json({
      success: true,
      message: "Pool started",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

app.post("/pool/stop", basicAuthMiddleware, async (req, res) => {
  //
  try {
    //
    if (!roomManager.pool.active) {
      return res.json({
        success: true,
        message: "Pool already stopped",
      });
    }

    roomManager.pool.stop();

    return res.json({
      success: true,
      message: "Pool stopped",
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({
      success: false,
      message: e.message || "Internal Server Error",
    });
  }
});

const server = app.listen(port, () => {
  console.log(`🕸️  NODE_ENV: ${process.env.NODE_ENV}`);
  console.log(`🕸️  Listening on port http://localhost:${port}`);
});

server.on("upgrade", async (req, socket, head) => {
  //
  // req is like machineId/iptyMnQxE/WhGtZtJej?sessionId=bQtRBIY2t
  // where iptyMnQxE is the process id
  // and WhGtZtJej is the room id

  console.log("wss connection", req.url);

  // extract machine id
  const machineId = req.url.split("/")[1];

  if (!machineId) {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }

  // reset idle time
  gc.touchMachine(machineId);

  const headers = [
    "HTTP/1.1 101 Switching Protocols",
    `fly-replay: app=${ENV.POOL_APP};instance=${machineId}`,
  ];

  const response = headers.concat("\r\n").join("\r\n");

  socket.end(response);

  console.log("socket replay", response);
  //
});
