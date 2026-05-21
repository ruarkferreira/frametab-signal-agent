import "dotenv/config";
import express from "express";
import signalAgentRouter from "./routes/signalAgent.js";

const app = express();
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "frametab-signal-agent", time: new Date().toISOString() });
});

app.use("/api", signalAgentRouter);

const PORT = parseInt(process.env.PORT ?? "3000", 10);
app.listen(PORT, () => {
  console.log(`FrameTab Signal Agent listening on port ${PORT}`);
});
