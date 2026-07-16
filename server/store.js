import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dayKeysBetween, gameWindowDateKeys, nowIso, previousDateKey, zonedDateKey } from "./time.js";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "db.json");

const DEFAULT_PARTICIPATION_FEE_RUB = 3000;

const COLORS = ["#ffcc5c", "#5ce1e6", "#ff6f91", "#a0f06b", "#f9a8ff", "#7bb0ff"];

export class Store {
  constructor(env = process.env) {
    this.env = env;
    this.ensure();
  }

  ensure() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(DB_FILE)) {
      this.write({
        users: [],
        aliveChecks: [],
        payments: [],
        audit: [],
        game: {
          title: "Live to see it",
          timezone: this.env.GAME_TIMEZONE || "Europe/Moscow",
          participationFeeRub: defaultParticipationFee(this.env),
          organizerFeePercent: Number(this.env.ORGANIZER_FEE_PERCENT || 10),
          startAt: null,
          endAt: null,
          state: "draft"
        }
      });
    }

  }

  read() {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }

  write(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
  }

  mutate(fn) {
    const data = this.read();
    const result = fn(data);
    this.write(data);
    return result;
  }

  createUser(email, password) {
    const normalizedEmail = email.trim().toLowerCase();
    const verificationToken = crypto.randomBytes(32).toString("hex");

    return this.mutate((data) => {
      if (data.users.some((user) => user.email === normalizedEmail)) {
        const error = new Error("EMAIL_EXISTS");
        error.status = 409;
        throw error;
      }

      const playerCount = data.users.filter((user) => user.role === "player").length;
      const user = {
        id: crypto.randomUUID(),
        email: normalizedEmail,
        passwordHash: hashPassword(password),
        role: "player",
        verifiedAt: null,
        verificationToken,
        paidAt: null,
        status: "alive",
        deathAt: null,
        deathReason: null,
        position: randomStartPosition(playerCount),
        color: COLORS[playerCount % COLORS.length],
        spriteVariant: playerCount % 3,
        createdAt: nowIso(),
        lastSeenAt: nowIso()
      };

      data.users.push(user);
      data.audit.push(audit("user.registered", user.id));
      return sanitizeUser(user);
    });
  }

  verifyEmail(token) {
    return this.mutate((data) => {
      const user = data.users.find((candidate) => candidate.verificationToken === token);
      if (!user) return null;

      user.verifiedAt = nowIso();
      user.verificationToken = null;
      data.audit.push(audit("user.verified", user.id));
      return sanitizeUser(user);
    });
  }

  findUserByEmail(email) {
    const data = this.read();
    return data.users.find((user) => user.email === email.trim().toLowerCase()) || null;
  }

  findUserById(id) {
    const data = this.read();
    return data.users.find((user) => user.id === id) || null;
  }

  touchUser(userId) {
    this.mutate((data) => {
      const user = data.users.find((candidate) => candidate.id === userId);
      if (user) user.lastSeenAt = nowIso();
    });
  }

  createPayment(userId, provider) {
    return this.mutate((data) => {
      const game = data.game;
      const paidPayment = data.payments.find((payment) => payment.userId === userId && payment.status === "paid");
      if (paidPayment) return paidPayment;

      assertJoinOpen(game);

      const amount = normalizeParticipationFee(game.participationFeeRub) || defaultParticipationFee(this.env);
      const organizerFee = Math.round(amount * Number(game.organizerFeePercent)) / 100;
      const prizeContribution = amount - organizerFee;
      const existingPending = data.payments.find((payment) => payment.userId === userId && payment.status === "pending");
      if (existingPending) {
        if (existingPending.amount === amount && existingPending.organizerFee === organizerFee && existingPending.provider === provider) {
          return existingPending;
        }

        existingPending.status = "expired";
        existingPending.expiredAt = nowIso();
        data.audit.push(audit("payment.expired", userId, { paymentId: existingPending.id, reason: "config-changed" }));
      }

      const payment = {
        id: crypto.randomUUID(),
        userId,
        provider,
        providerPaymentId: null,
        amount,
        organizerFee,
        prizeContribution,
        status: "pending",
        confirmationUrl: null,
        createdAt: nowIso(),
        paidAt: null
      };

      data.payments.push(payment);
      data.audit.push(audit("payment.created", userId, { paymentId: payment.id, provider }));
      return payment;
    });
  }

  updatePayment(paymentId, patch) {
    return this.mutate((data) => {
      const payment = data.payments.find((candidate) => candidate.id === paymentId);
      if (!payment) return null;
      Object.assign(payment, patch);
      return payment;
    });
  }

  getPayment(paymentId) {
    const data = this.read();
    const payment = data.payments.find((candidate) => candidate.id === paymentId);
    return payment ? { ...payment } : null;
  }

  getPendingPaymentForUser(userId, provider = null) {
    const data = this.read();
    const payment = data.payments
      .slice()
      .reverse()
      .find(
        (candidate) =>
          candidate.userId === userId &&
          candidate.status === "pending" &&
          (!provider || candidate.provider === provider)
      );
    return payment ? { ...payment } : null;
  }

  markPaymentCanceled(paymentId, reason = "provider-canceled") {
    return this.mutate((data) => {
      const payment = data.payments.find((candidate) => candidate.id === paymentId);
      if (!payment || payment.status !== "pending") return payment || null;
      payment.status = "canceled";
      payment.canceledAt = nowIso();
      payment.cancelReason = reason;
      data.audit.push(audit("payment.canceled", payment.userId, { paymentId, reason }));
      return payment;
    });
  }

  markPaymentPaid(paymentId, providerPaymentId = null) {
    return this.mutate((data) => {
      const payment = data.payments.find((candidate) => candidate.id === paymentId);
      if (!payment) return null;
      if (payment.status === "paid") return payment;
      if (!["pending", "canceled"].includes(payment.status)) return payment;

      if (!canJoinGame(data.game)) {
        payment.status = "expired";
        payment.expiredAt = nowIso();
        data.audit.push(audit("payment.expired", payment.userId, { paymentId }));
        return payment;
      }

      payment.status = "paid";
      payment.paidAt = payment.paidAt || nowIso();
      payment.providerPaymentId = providerPaymentId || payment.providerPaymentId;

      const user = data.users.find((candidate) => candidate.id === payment.userId);
      if (user) {
        user.paidAt = user.paidAt || payment.paidAt;
        user.status = user.status || "alive";
      }

      data.audit.push(audit("payment.paid", payment.userId, { paymentId }));
      return payment;
    });
  }

  markAlive(userId) {
    this.sweepDeaths();

    return this.mutate((data) => {
      const user = data.users.find((candidate) => candidate.id === userId);
      if (!user || user.status === "dead") {
        const error = new Error("PLAYER_DEAD");
        error.status = 409;
        throw error;
      }

      if (!user.paidAt) {
        const error = new Error("PAYMENT_REQUIRED");
        error.status = 402;
        throw error;
      }

      if (deriveGameState(data.game) !== "running") {
        const error = new Error("GAME_NOT_RUNNING");
        error.status = 409;
        throw error;
      }

      if (!isParticipantForGame(user, data.game)) {
        const error = new Error("NOT_CURRENT_PARTICIPANT");
        error.status = 409;
        throw error;
      }

      const today = zonedDateKey(new Date(), data.game.timezone);
      const existing = data.aliveChecks.find((check) => check.userId === userId && check.date === today);
      if (existing) return existing;

      const check = {
        id: crypto.randomUUID(),
        userId,
        date: today,
        at: nowIso()
      };

      data.aliveChecks.push(check);
      data.audit.push(audit("player.alive", userId, { date: today }));
      return check;
    });
  }

  movePlayer(userId, x, y) {
    this.sweepDeaths();

    return this.mutate((data) => {
      const user = data.users.find((candidate) => candidate.id === userId);
      if (!user || user.status === "dead") {
        const error = new Error("PLAYER_DEAD");
        error.status = 409;
        throw error;
      }

      user.position = {
        x: clampInteger(x, -999999, 999999),
        y: clampInteger(y, -999999, 999999)
      };
      user.lastSeenAt = nowIso();
      return user.position;
    });
  }

  setGameConfig(adminId, patch) {
    return this.mutate((data) => {
      data.game = {
        ...data.game,
        ...pickDefined({
          startAt: patch.startAt || null,
          endAt: patch.endAt || null,
          timezone: patch.timezone,
          participationFeeRub:
            patch.participationFeeRub !== undefined ? normalizeParticipationFee(patch.participationFeeRub) : undefined,
          organizerFeePercent: Number(patch.organizerFeePercent)
        })
      };

      data.game.state = deriveGameState(data.game);
      data.audit.push(audit("game.updated", adminId, patch));
      return data.game;
    });
  }

  endGameNow(adminId) {
    return this.mutate((data) => {
      data.game.endAt = nowIso();
      data.game.state = "ended";
      data.audit.push(audit("game.ended", adminId));
      return data.game;
    });
  }

  sweepDeaths() {
    return this.mutate((data) => {
      const game = data.game;
      game.state = deriveGameState(game);

      if (!game.startAt) return [];

      const today = zonedDateKey(new Date(), game.timezone);
      const startKey = zonedDateKey(new Date(game.startAt), game.timezone);
      const lastRequiredDay = previousDateKey(today);
      const requiredDays = dayKeysBetween(startKey, lastRequiredDay);
      const deaths = [];

      if (requiredDays.length === 0) return deaths;

      for (const user of data.users) {
        if (user.role !== "player" || !isParticipantForGame(user, game) || user.status === "dead") continue;

        const checkedDays = new Set(
          data.aliveChecks
            .filter((check) => check.userId === user.id)
            .map((check) => check.date)
        );
        const missed = requiredDays.find((day) => !checkedDays.has(day));

        if (missed) {
          user.status = "dead";
          user.deathAt = nowIso();
          user.deathReason = `missed-${missed}`;
          deaths.push({ userId: user.id, missed });
          data.audit.push(audit("player.dead", user.id, { missed }));
        }
      }

      return deaths;
    });
  }

  getWorld(currentUserId = null) {
    this.sweepDeaths();
    const data = this.read();
    const game = {
      ...data.game,
      participationFeeRub: normalizeParticipationFee(data.game.participationFeeRub) || defaultParticipationFee(this.env),
      state: deriveGameState(data.game)
    };
    const bank = calculateBank(data.payments);
    const today = zonedDateKey(new Date(), game.timezone);
    const winners = calculateWinners(data);
    const currentUser = currentUserId ? data.users.find((user) => user.id === currentUserId) : null;

    return {
      game,
      bank,
      today,
      round: currentUser ? getRoundStatus(game, currentUser) : getRoundStatus(game, null),
      latestPayment: currentUser ? sanitizePayment(latestPaymentForUser(data.payments, currentUser.id)) : null,
      aliveToday: currentUserId
        ? data.aliveChecks.some((check) => check.userId === currentUserId && check.date === today)
        : false,
      me: currentUser ? sanitizeUser(currentUser) : null,
      players: data.users
        .filter((user) => user.role === "player")
        .map((user) => ({
          id: user.id,
          email: maskEmail(user.email),
          status: user.status,
          position: user.position,
          color: user.color,
          spriteVariant: user.spriteVariant,
          lastSeenAt: user.lastSeenAt,
          deathAt: user.deathAt
        })),
      winners
    };
  }

  getAdminOverview() {
    this.sweepDeaths();
    const data = this.read();
    return {
      game: {
        ...data.game,
        participationFeeRub: normalizeParticipationFee(data.game.participationFeeRub) || defaultParticipationFee(this.env)
      },
      bank: calculateBank(data.payments),
      users: data.users
        .filter((user) => user.role === "player")
        .map((user) => ({
          ...sanitizeUser(user),
          checks: data.aliveChecks.filter((check) => check.userId === user.id).length,
          payments: data.payments.filter((payment) => payment.userId === user.id)
        })),
      winners: calculateWinners(data),
      audit: data.audit.slice(-80).reverse()
    };
  }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 210000, 64, "sha512").toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const candidate = crypto.pbkdf2Sync(password, salt, 210000, 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(candidate, "hex"));
}

export function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    verifiedAt: user.verifiedAt,
    paidAt: user.paidAt,
    status: user.status,
    deathAt: user.deathAt,
    deathReason: user.deathReason,
    position: user.position,
    color: user.color,
    spriteVariant: user.spriteVariant,
    createdAt: user.createdAt,
    lastSeenAt: user.lastSeenAt
  };
}

function sanitizePayment(payment) {
  if (!payment) return null;
  return {
    id: payment.id,
    provider: payment.provider,
    amount: payment.amount,
    status: payment.status,
    providerStatus: payment.providerStatus || null,
    createdAt: payment.createdAt,
    paidAt: payment.paidAt,
    canceledAt: payment.canceledAt || null,
    expiredAt: payment.expiredAt || null,
    testConfirmedAt: payment.testConfirmedAt || null,
    cancelReason: payment.cancelReason || null,
    providerCheckedAt: payment.providerCheckedAt || null
  };
}

export function calculateBank(payments) {
  const paid = payments.filter((payment) => payment.status === "paid");
  return paid.reduce(
    (sum, payment) => ({
      grossRub: sum.grossRub + payment.amount,
      prizeRub: sum.prizeRub + payment.prizeContribution,
      organizerRub: sum.organizerRub + payment.organizerFee,
      paidCount: sum.paidCount + 1
    }),
    { grossRub: 0, prizeRub: 0, organizerRub: 0, paidCount: 0 }
  );
}

function latestPaymentForUser(payments, userId) {
  return payments
    .filter((payment) => payment.userId === userId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0] || null;
}

function calculateWinners(data) {
  const game = data.game;
  if (!game.startAt || !game.endAt || deriveGameState(game) !== "ended") {
    return { players: [], payoutRub: 0 };
  }

  const requiredDays = gameWindowDateKeys(game, game.timezone);
  const winners = data.users
    .filter((user) => user.role === "player" && isParticipantForGame(user, game) && user.status !== "dead")
    .filter((user) => {
      const checkedDays = new Set(
        data.aliveChecks.filter((check) => check.userId === user.id).map((check) => check.date)
      );
      return requiredDays.every((day) => checkedDays.has(day));
    });

  const bank = calculateBank(data.payments);
  return {
    players: winners.map((user) => ({
      id: user.id,
      email: maskEmail(user.email),
      position: user.position
    })),
    payoutRub: winners.length ? Math.floor(bank.prizeRub / winners.length) : 0
  };
}

function deriveGameState(game) {
  const now = Date.now();
  if (game.endAt && now > new Date(game.endAt).getTime()) return "ended";
  if (game.startAt && now >= new Date(game.startAt).getTime()) return "running";
  return "draft";
}

function assertJoinOpen(game) {
  if (!game.startAt) {
    const error = new Error("GAME_START_REQUIRED");
    error.status = 409;
    throw error;
  }

  if (!canJoinGame(game)) {
    const error = new Error("JOIN_CLOSED");
    error.status = 409;
    throw error;
  }
}

function canJoinGame(game) {
  if (!game.startAt) return false;
  const now = Date.now();
  const startAt = new Date(game.startAt).getTime();
  const endAt = game.endAt ? new Date(game.endAt).getTime() : null;
  return Number.isFinite(startAt) && now < startAt && (!endAt || now < endAt);
}

function isParticipantForGame(user, game) {
  if (!user?.paidAt || !game?.startAt) return false;
  const paidAt = new Date(user.paidAt).getTime();
  const startAt = new Date(game.startAt).getTime();
  return Number.isFinite(paidAt) && Number.isFinite(startAt) && paidAt <= startAt;
}

function getRoundStatus(game, user) {
  const state = deriveGameState(game);
  const isParticipant = Boolean(user && isParticipantForGame(user, game));

  return {
    state,
    joinClosesAt: game.startAt || null,
    canJoin: Boolean(user && user.status !== "dead" && !isParticipant && canJoinGame(game)),
    isParticipant,
    canMarkAlive: Boolean(user && user.status !== "dead" && isParticipant && state === "running")
  };
}

function defaultParticipationFee(env) {
  return normalizeParticipationFee(env.PARTICIPATION_FEE_RUB) || DEFAULT_PARTICIPATION_FEE_RUB;
}

function normalizeParticipationFee(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 1) return undefined;
  return clampInteger(number, 1, 1_000_000);
}

function pickDefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && !Number.isNaN(value))
  );
}

function audit(type, userId, meta = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    userId,
    meta,
    at: nowIso()
  };
}

function randomStartPosition(seed) {
  const ring = Math.max(1, Math.ceil(Math.sqrt(seed + 1)));
  return {
    x: (seed % 7) * 3 - 9 + ring,
    y: Math.floor(seed / 7) * 3 - 4
  };
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(min, Math.min(max, Math.round(number)));
}

function maskEmail(email) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  return `${name.slice(0, 2)}***@${domain}`;
}
