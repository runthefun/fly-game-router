import "dotenv/config";
import express from "express";
import cors from "cors";
import basicAuth from "express-basic-auth";
import { JoinReqBody } from "./types";
import { RoomManager } from "./RoomManager";
import { FlyApi } from "./FlyApi";
import { ENV } from "./env";

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
const port = 3000;

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));

app.use(express.json());

app.get("/", (req, res) => {
  //
  /*
  // send a simple html that contains a form to join a game
  // and a list that shows state of the join requests (pending, then json response)


  res.send(`
    <html>
      <body>
        <h1>Join Game</h1>
        <p>Enter the Game ID to join</p>
        <input id="gameId" type="text" name="gameId" placeholder="Game ID" />
        <button type="submit">Join</button>
        <h2>Join Requests</h2>
        <ul id="join-requests">
          
        </ul>

        <script>
          const gameIdInput = document.getElementById("gameId");
          const joinRequestsList = document.getElementById("join-requests");
          const joinBtn = document.querySelector("button");

          const joinRequest = async (gameId) => {

            const li = document.createElement("li");
            li.innerText = "Joining " + gameId;

            joinRequestsList.appendChild(li);

            const res = await fetch("/join", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                gameId,
                userId: "user-" + Math.random().toString(36).substr(2, 9),
                username: "user-" + Math.random().toString(36).substr(2, 9),
              }),
            });

            const data = await res.json();

            li.innerText = JSON.stringify(data);
          };

          joinBtn.addEventListener("click", () => {
            joinRequest(gameIdInput.value);
          });
          
        </script>
      </body>
    </html>
  `);
  */
  res.send("🥸🥸🥸🥸🥸🥸🥸");
});

// Ensure all responses include CORS headers
app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.set("Access-Control-Allow-Credentials", "true");
  next();
});

const roomManager = new RoomManager({
  minSize: 10,
  maxSize: 100,
  templateApp: ENV.TEMPLATE_APP,
  templateMachineId: ENV.TEMPLATE_MACHINE,
  api: new FlyApi({
    appId: ENV.POOL_APP,
    apiKey: ENV.FLY_API_KEY,
  }),
});

roomManager.pool.start();

app.post("/join", async (req, res) => {
  //
  try {
    //
    const body = req.body as JoinReqBody;

    console.log("Join request", body);

    if (!body?.gameId || !body?.userId) {
      //
      return res.status(400).json({
        success: false,
        message: "Invalid request",
      });
    }

    const { gameId } = body;

    const region = req.get("Fly-Region");
    const ip = req.get("Fly-Client-IP");

    console.log(`Join request for ${gameId}; region: ${region}; ip: ${ip}`);

    const st = Date.now();
    const machineId = await roomManager.getOrCreateMachineForRoom({
      roomId: gameId,
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
    await roomManager.pool.reset();
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

app.listen(port, () => {
  console.log(`🕸️ listening on port http://localhost:${port}`);
});
