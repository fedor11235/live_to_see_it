import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import crypto from "node:crypto";
import http from "node:http";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { Store, sanitizeUser, verifyPassword } from "./store.js";
import { createMailer } from "./mailer.js";
import { createPaymentGateway } from "./payments.js";
import { getLastModified, publicOrigin, renderHtmlWithSeo, renderRobots, renderSitemap } from "./seo.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3001);
const store = new Store(process.env);
const mailer = createMailer(process.env);
const payments = createPaymentGateway({ env: process.env, store });
const server = http.createServer(app);
const realtime = createRealtime(server);

app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.use((req, _res, next) => {
  const session = readSession(req.cookies.session);
  req.user = session?.sub ? store.findUserById(session.sub) : null;
  req.operator = readOperatorSession(req.cookies.ops_session);
  if (req.user) store.touchUser(req.user.id);
  next();
});

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    validateEmailPassword(email, password);

    const user = store.createUser(email, password);
    const storedUser = store.findUserById(user.id);
    const emailResult = await mailer.sendVerificationEmail(storedUser.email, storedUser.verificationToken);

    res.status(201).json({
      user,
      message: "verification_sent",
      devVerificationUrl: emailResult.devUrl
    });
  } catch (error) {
    next(error);
  }
});

app.get("/api/auth/verify", (req, res) => {
  const user = store.verifyEmail(String(req.query.token || ""));
  if (!user) return res.redirect("/?verified=failed");
  res.cookie("session", createSession(user.id), sessionCookieOptions());
  res.redirect("/?verified=ok");
});

app.post("/api/auth/login", (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    validateEmailPassword(email, password);

    const user = store.findUserByEmail(email);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      const error = new Error("INVALID_CREDENTIALS");
      error.status = 401;
      throw error;
    }
    if (!user.verifiedAt) {
      const error = new Error("EMAIL_NOT_VERIFIED");
      error.status = 403;
      throw error;
    }
    if (user.role !== "player") {
      const error = new Error("INVALID_CREDENTIALS");
      error.status = 401;
      throw error;
    }

    res.cookie("session", createSession(user.id), sessionCookieOptions());
    res.json({ user: sanitizeUser(user) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("session", sessionCookieOptions());
  res.json({ ok: true });
});

app.get("/api/ops/me", (req, res) => {
  res.json({ operator: req.operator ? { login: req.operator.login } : null });
});

app.post("/api/ops/login", (req, res, next) => {
  try {
    const { login, password } = req.body || {};
    if (login !== operatorLogin() || password !== operatorPassword()) {
      const error = new Error("INVALID_CREDENTIALS");
      error.status = 401;
      throw error;
    }

    res.cookie("ops_session", createOperatorSession(login), sessionCookieOptions());
    res.json({ operator: { login } });
  } catch (error) {
    next(error);
  }
});

app.post("/api/ops/logout", (_req, res) => {
  res.clearCookie("ops_session", sessionCookieOptions());
  res.json({ ok: true });
});

app.get("/api/me", (req, res) => {
  res.json({ user: req.user?.role === "player" ? sanitizeUser(req.user) : null });
});

app.get("/api/world", requireUser, (req, res) => {
  res.json(store.getWorld(req.user.id));
});

app.post("/api/alive", requireUser, (req, res, next) => {
  try {
    const check = store.markAlive(req.user.id);
    res.json({ check, world: store.getWorld(req.user.id) });
  } catch (error) {
    next(error);
  }
});

app.post("/api/player/move", requireUser, (req, res, next) => {
  try {
    const { x, y } = req.body || {};
    const position = store.movePlayer(req.user.id, x, y);
    realtime.broadcast({
      type: "playerMoved",
      playerId: req.user.id,
      position
    });
    res.json({ position });
  } catch (error) {
    next(error);
  }
});

app.post("/api/payments/start", requireUser, async (req, res, next) => {
  try {
    if (!req.user.verifiedAt) {
      const error = new Error("EMAIL_NOT_VERIFIED");
      error.status = 403;
      throw error;
    }

    const origin = `${req.protocol}://${req.get("host")}`;
    const result = await payments.startPayment(req.user, origin);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/api/payments/mock/:paymentId/complete", (req, res) => {
  store.markPaymentPaid(req.params.paymentId);
  res.redirect("/?payment=paid");
});

app.post("/api/payments/yookassa/webhook", async (req, res, next) => {
  try {
    const handled = await payments.handleYooKassaWebhook(req.body);
    res.json({ ok: true, handled });
  } catch (error) {
    next(error);
  }
});

app.get("/api/admin/overview", requireAdmin, (_req, res) => {
  res.json(store.getAdminOverview());
});

app.post("/api/admin/game", requireAdmin, (req, res, next) => {
  try {
    const game = store.setGameConfig(req.operator.login, req.body || {});
    res.json({ game });
  } catch (error) {
    next(error);
  }
});

app.post("/api/admin/game/end", requireAdmin, (req, res) => {
  const game = store.endGameNow(req.operator.login);
  res.json({ game, overview: store.getAdminOverview() });
});

const distPath = path.join(__dirname, "..", "dist", "client");

app.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(renderRobots(publicOrigin(req)));
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(renderSitemap(publicOrigin(req), getLastModified(distPath)));
});

app.use(express.static(distPath, { index: false }));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api")) return next();
  const indexPath = path.join(distPath, "index.html");
  if (!fs.existsSync(indexPath)) {
    res.status(404).send("Client is not built yet. Run npm run dev or npm run build.");
    return;
  }

  const lastModified = getLastModified(distPath);
  res.set("Last-Modified", lastModified.toUTCString());
  res.type("html").send(
    renderHtmlWithSeo(fs.readFileSync(indexPath, "utf8"), {
      origin: publicOrigin(req),
      pathname: req.path,
      lastModified
    })
  );
});

app.use((error, _req, res, _next) => {
  const status = error.status || 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message || "SERVER_ERROR" });
});

setInterval(() => {
  try {
    store.sweepDeaths();
  } catch (error) {
    console.error("Death sweep failed", error);
  }
}, 15 * 60 * 1000).unref();

server.listen(port, () => {
  console.log(`Live to see it API running on http://localhost:${port}`);
});

function createRealtime(serverInstance) {
  const wss = new WebSocketServer({ server: serverInstance, path: "/ws" });
  const clients = new Set();

  wss.on("connection", (socket, request) => {
    const session = readSession(readCookie(request.headers.cookie || "", "session"));
    const user = session?.sub ? store.findUserById(session.sub) : null;

    if (!user || user.role !== "player") {
      socket.close(1008, "AUTH_REQUIRED");
      return;
    }

    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.send(JSON.stringify({ type: "hello", userId: user.id }));
  });

  return {
    broadcast(message) {
      const payload = JSON.stringify(message);
      for (const socket of clients) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
    }
  };
}

function requireUser(req, _res, next) {
  if (!req.user || req.user.role !== "player") {
    const error = new Error("AUTH_REQUIRED");
    error.status = 401;
    return next(error);
  }
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.operator) {
    const error = new Error("ADMIN_REQUIRED");
    error.status = 403;
    return next(error);
  }
  next();
}

function validateEmailPassword(email, password) {
  if (!String(email || "").includes("@") || String(password || "").length < 8) {
    const error = new Error("BAD_EMAIL_OR_PASSWORD");
    error.status = 400;
    throw error;
  }
}

function createSession(userId) {
  const payload = {
    sub: userId,
    kind: "player",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function createOperatorSession(login) {
  const payload = {
    login,
    kind: "operator",
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = sign(encoded);
  return `${encoded}.${signature}`;
}

function readSession(token) {
  if (!token || !token.includes(".")) return null;
  const [encoded, signature] = token.split(".");
  if (sign(encoded) !== signature) return null;

  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readOperatorSession(token) {
  const session = readSession(token);
  if (!session || session.kind !== "operator" || session.login !== operatorLogin()) return null;
  return session;
}

function readCookie(header, name) {
  return header
    .split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function sign(value) {
  return crypto
    .createHmac("sha256", process.env.SESSION_SECRET || "dev-secret-change-me")
    .update(value)
    .digest("base64url");
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/"
  };
}

function operatorLogin() {
  return process.env.OPS_LOGIN || process.env.ADMIN_PANEL_LOGIN || "keeper";
}

function operatorPassword() {
  return process.env.OPS_PASSWORD || process.env.ADMIN_PANEL_PASSWORD || "change-me-now";
}
