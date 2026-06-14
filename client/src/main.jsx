import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Coins,
  HeartPulse,
  LogOut,
  MapPin,
  Skull,
  Volume2,
  VolumeX
} from "lucide-react";
import { getPixelAudioEngine } from "./audio.js";
import "./styles.css";

const OPS_PATH = "/admon";
const COOKIE_NOTICE_KEY = "ltsi-cookie-notice";

const RUB = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0
});

function App() {
  const path = normalizedPath();
  return (
    <>
      {path === OPS_PATH ? <OperatorApp /> : path === "/cookies" ? <CookiePolicyApp /> : <GameApp />}
      <CookieNotice />
    </>
  );
}

function GameApp() {
  const [me, setMe] = useState(null);
  const [world, setWorld] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference);
  const audioRef = useRef(getPixelAudioEngine());

  const refreshMe = useCallback(async () => {
    const response = await api("/api/me");
    setMe(response.user);
    return response.user;
  }, []);

  const refreshWorld = useCallback(async () => {
    const response = await api("/api/world");
    setWorld(response);
    setMe(response.me);
    return response;
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("verified") === "ok") setNotice("Почта подтверждена.");

    refreshMe()
      .catch(() => setMe(null))
      .finally(() => setLoading(false));
  }, [refreshMe]);

  useEffect(() => {
    if (!me) return undefined;
    refreshWorld().catch(() => {});
    const id = window.setInterval(() => refreshWorld().catch(() => {}), 2500);
    return () => window.clearInterval(id);
  }, [me?.id, refreshWorld]);

  useEffect(() => {
    if (!me?.paidAt || !soundEnabled) {
      audioRef.current.stop();
      return undefined;
    }

    function unlockAudio() {
      audioRef.current.start();
    }

    window.addEventListener("pointerdown", unlockAudio, { once: true });
    window.addEventListener("keydown", unlockAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlockAudio);
      window.removeEventListener("keydown", unlockAudio);
    };
  }, [me?.paidAt, soundEnabled]);

  useEffect(() => {
    if (!me) return undefined;

    const socket = new WebSocket(realtimeUrl());
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.type !== "playerMoved") return;

      setWorld((current) => {
        if (!current) return current;
        return {
          ...current,
          players: current.players.map((player) =>
            player.id === message.playerId ? { ...player, position: message.position } : player
          )
        };
      });
    });

    return () => socket.close();
  }, [me?.id]);

  useEffect(() => {
    function onLocalPosition(event) {
      const position = event.detail;
      setMe((user) => (user ? { ...user, position } : user));
      setWorld((current) =>
        current
          ? {
              ...current,
              me: current.me ? { ...current.me, position } : current.me
            }
          : current
      );
    }

    window.addEventListener("player-position", onLocalPosition);
    return () => window.removeEventListener("player-position", onLocalPosition);
  }, []);

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    audioRef.current.stop();
    setMe(null);
    setWorld(null);
  }

  function toggleSound() {
    const next = !soundEnabled;
    setSoundEnabled(next);
    window.localStorage.setItem("ltsi-sound", next ? "on" : "off");
    if (next && me?.paidAt) {
      audioRef.current.start();
    } else {
      audioRef.current.stop();
    }
  }

  if (loading) {
    return <BootScreen />;
  }

  return (
    <main className="app-shell">
      <PixelBackdrop world={world} me={me} audioEngine={soundEnabled ? audioRef.current : null} />

      {world && <TopHud world={world} me={me} />}

      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
      </header>

      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}

      {me && (
        <div className="session-bar">
          <IconButton label={soundEnabled ? "Выключить звук" : "Включить звук"} onClick={toggleSound}>
            {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </IconButton>
          <IconButton label="Выйти" onClick={logout}>
            <LogOut size={18} />
          </IconButton>
        </div>
      )}

      {!me && <AuthPanel onAuth={refreshMe} />}
      {me && !me.paidAt && <PaymentPanel me={me} world={world} onPaid={refreshWorld} />}
      {me && me.paidAt && <GameControls me={me} world={world} refreshWorld={refreshWorld} />}
    </main>
  );
}

function BootScreen() {
  return (
    <main className="boot">
      <div className="boot-loader" />
      <span>Live to see it</span>
    </main>
  );
}

function CookieNotice() {
  const [accepted, setAccepted] = useState(() => window.localStorage.getItem(COOKIE_NOTICE_KEY) === "accepted");

  if (accepted) return null;

  function accept() {
    window.localStorage.setItem(COOKIE_NOTICE_KEY, "accepted");
    setAccepted(true);
  }

  return (
    <section className="cookie-notice" aria-label="Уведомление о cookie">
      <p>
        Используем необходимые cookie для входа и сохранения игровой сессии. <a href="/cookies">Подробнее</a>
      </p>
      <button className="ghost" type="button" onClick={accept}>Понятно</button>
    </section>
  );
}

function CookiePolicyApp() {
  return (
    <main className="operator-shell document-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
      </header>

      <article className="panel document-panel">
        <div className="panel-title">
          <span className="panel-kicker">Cookie</span>
          <h1>Cookie</h1>
        </div>
        <p>
          Live to see it использует только необходимые cookie: игровую сессию, вход в закрытую панель и базовые настройки интерфейса.
        </p>
        <p>
          Эти cookie нужны, чтобы пользователь оставался авторизованным, мог отмечаться в игре и безопасно выходить из аккаунта.
        </p>
        <p>
          Маркетинговые и рекламные cookie сейчас не используются. Если аналитика будет добавлена позже, для нее появится отдельное согласие.
        </p>
        <a className="dev-link" href="/">Вернуться в игру</a>
      </article>
    </main>
  );
}

function OperatorApp() {
  const [operator, setOperator] = useState(null);
  const [loading, setLoading] = useState(true);

  const refreshOperator = useCallback(async () => {
    const response = await api("/api/ops/me");
    setOperator(response.operator);
    return response.operator;
  }, []);

  useEffect(() => {
    refreshOperator()
      .catch(() => setOperator(null))
      .finally(() => setLoading(false));
  }, [refreshOperator]);

  async function logout() {
    await api("/api/ops/logout", { method: "POST" });
    setOperator(null);
  }

  if (loading) return <BootScreen />;

  return (
    <main className="operator-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
      </header>

      {operator && (
        <div className="session-bar">
          <IconButton label="Выйти" onClick={logout}>
            <LogOut size={18} />
          </IconButton>
        </div>
      )}

      {operator ? <AdminPanel /> : <OperatorLogin onAuth={refreshOperator} />}
    </main>
  );
}

function OperatorLogin({ onAuth }) {
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      await api("/api/ops/login", {
        method: "POST",
        body: JSON.stringify({ login, password })
      });
      await onAuth();
    } catch (caught) {
      setError(humanError(caught.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel auth-panel" aria-label="Закрытый вход">
      <div className="panel-title">
        <span className="panel-kicker">Live to see it</span>
        <h1>Вход</h1>
      </div>

      <form className="stack" onSubmit={submit}>
        <label>
          Логин
          <input value={login} onChange={(event) => setLogin(event.target.value)} autoComplete="username" required />
        </label>
        <label>
          Пароль
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "..." : "Войти"}
        </button>
      </form>
    </section>
  );
}

function AuthPanel({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setDevLink("");

    try {
      if (mode === "register") {
        const result = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
        setDevLink(result.devVerificationUrl || "");
        setMessage("Письмо подтверждения отправлено.");
        setMode("login");
      } else {
        await api("/api/auth/login", {
          method: "POST",
          body: JSON.stringify({ email, password })
        });
        await onAuth();
      }
    } catch (caught) {
      setError(humanError(caught.message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel auth-panel" aria-label="Вход">
      <div className="panel-title">
        <span className="panel-kicker">{mode === "login" ? "Вход" : "Регистрация"}</span>
        <h1>Live to see it</h1>
      </div>

      <div className="tabs" role="tablist">
        <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">
          Вход
        </button>
        <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">
          Регистрация
        </button>
      </div>

      <form className="stack" onSubmit={submit}>
        <label>
          Почта
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
        </label>
        <label>
          Пароль
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} required />
        </label>
        {error && <p className="form-error">{error}</p>}
        {message && <p className="form-success">{message}</p>}
        {devLink && (
          <a className="dev-link" href={devLink}>
            Dev-ссылка подтверждения
          </a>
        )}
        <button className="primary" disabled={busy} type="submit">
          {busy ? "..." : mode === "login" ? "Войти" : "Создать игрока"}
        </button>
      </form>
    </section>
  );
}

function PaymentPanel({ me, world, onPaid }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const game = world?.game;
  const fee = game?.participationFeeRub || 3000;

  async function startPayment() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/payments/start", { method: "POST" });
      if (result.status === "paid") {
        await onPaid();
        return;
      }
      window.location.href = result.confirmationUrl;
    } catch (caught) {
      setError(humanError(caught.message));
      setBusy(false);
    }
  }

  return (
    <section className="panel pay-panel" aria-label="Оплата участия">
      <div className="panel-title">
        <span className="panel-kicker">{me.email}</span>
        <h1>{RUB.format(fee)}</h1>
      </div>
      <div className="pay-grid">
        <Metric label="Банк" value={RUB.format(world?.bank?.prizeRub || 0)} />
        <Metric label="Орг. сбор" value={`${game?.organizerFeePercent || 10}%`} />
      </div>
      <p className="legal-note">Денежный призовой фонд подключайте только после юридической проверки модели.</p>
      {error && <p className="form-error">{error}</p>}
      <button className="primary" disabled={busy} onClick={startPayment}>
        {busy ? "..." : "Оплатить участие"}
      </button>
    </section>
  );
}

function GameControls({ me, world, refreshWorld }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function markAlive() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/alive", { method: "POST" });
      await refreshWorld();
      if (result.world?.aliveToday) {
        setError("");
      }
    } catch (caught) {
      setError(humanError(caught.message));
    } finally {
      setBusy(false);
    }
  }

  if (me.status === "dead") {
    return (
      <section className="death-strip" aria-label="Игрок умер">
        <Skull size={20} />
        <span>Пропущен день. На поле осталась могилка.</span>
      </section>
    );
  }

  return (
    <>
      <section className="alive-dock" aria-label="Дневная отметка">
        <button className="alive-button" disabled={busy || world?.aliveToday} onClick={markAlive}>
          <HeartPulse size={20} />
          {world?.aliveToday ? "Сегодня живой" : busy ? "..." : "Я живой"}
        </button>
        {error && <span className="inline-error">{error}</span>}
      </section>
      <Dpad />
    </>
  );
}

function AdminPanel() {
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({
    startAt: "",
    endAt: "",
    timezone: "Europe/Moscow",
    participationFeeRub: 3000,
    organizerFeePercent: 10
  });
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const data = await api("/api/admin/overview");
    setOverview(data);
    setForm({
      startAt: toDatetimeLocal(data.game.startAt),
      endAt: toDatetimeLocal(data.game.endAt),
      timezone: data.game.timezone,
      participationFeeRub: data.game.participationFeeRub,
      organizerFeePercent: data.game.organizerFeePercent
    });
  }, []);

  useEffect(() => {
    load().catch((caught) => setError(humanError(caught.message)));
  }, [load]);

  async function save(event) {
    event.preventDefault();
    setError("");
    try {
      await api("/api/admin/game", {
        method: "POST",
        body: JSON.stringify({
          ...form,
          startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
          endAt: form.endAt ? new Date(form.endAt).toISOString() : null
        })
      });
      await load();
    } catch (caught) {
      setError(humanError(caught.message));
    }
  }

  async function endNow() {
    const confirmed = window.confirm("Завершить игру сейчас? Финиш будет выставлен на текущий момент.");
    if (!confirmed) return;
    await api("/api/admin/game/end", { method: "POST" });
    await load();
  }

  return (
    <section className="panel admin-panel" aria-label="Панель">
      <div className="panel-title compact">
        <span className="panel-kicker">Панель</span>
        <h1>Игра</h1>
      </div>

      {overview && (
        <div className="admin-metrics">
          <Metric label="Статус" value={statusText(overview.game.state)} />
          <Metric label="Банк" value={RUB.format(overview.bank.prizeRub)} />
          <Metric label="Игроки" value={String(overview.bank.paidCount)} />
          <Metric label="Победители" value={String(overview.winners.players.length)} />
        </div>
      )}

      <form className="admin-form" onSubmit={save}>
        <label className="date-field">
          Старт
          <input value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} type="datetime-local" />
        </label>
        <label className="date-field">
          Финиш
          <input value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} type="datetime-local" />
        </label>
        <label className="timezone-field">
          Таймзона
          <input value={form.timezone} onChange={(event) => setForm({ ...form, timezone: event.target.value })} />
        </label>
        <label>
          Взнос
          <input value={form.participationFeeRub} onChange={(event) => setForm({ ...form, participationFeeRub: Number(event.target.value) })} min="1" type="number" />
        </label>
        <label>
          Орг. %
          <input value={form.organizerFeePercent} onChange={(event) => setForm({ ...form, organizerFeePercent: Number(event.target.value) })} min="0" max="50" type="number" />
        </label>
        {error && <p className="form-error">{error}</p>}
        <div className="admin-actions">
          <button className="primary" type="submit">Сохранить</button>
          <button className="ghost danger-action" type="button" onClick={endNow}>Завершить игру</button>
        </div>
      </form>

      {overview && (
        <div className="admin-list">
          {overview.users.map((user) => (
            <div className="admin-row" key={user.id}>
              <span className={`status-dot ${user.status}`} />
              <span>{user.email}</span>
              <span>{user.paidAt ? "оплачен" : "нет оплаты"}</span>
              <span>{user.checks}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function PixelBackdrop({ world, me, audioEngine }) {
  const canvasRef = useRef(null);
  const meRef = useRef(me);
  const worldRef = useRef(world);
  const demoGraveRef = useRef(null);
  const [localPosition, setLocalPosition] = useState(me?.position || { x: 0, y: 0 });
  const positionRef = useRef(me?.position || { x: 0, y: 0 });
  const movementRef = useRef({ x: 0, y: 0 });
  const lastSentRef = useRef(0);

  const applyMovement = useCallback((delta, forceSend = false) => {
    const position = positionRef.current;
    const next = { x: position.x + delta.x, y: position.y + delta.y };
    positionRef.current = next;
    setLocalPosition(next);
    audioEngine?.playStep();
    window.dispatchEvent(new CustomEvent("player-position", { detail: next }));
    if (forceSend || Date.now() - lastSentRef.current > 140) {
      lastSentRef.current = Date.now();
      api("/api/player/move", {
        method: "POST",
        body: JSON.stringify(next)
      }).catch(() => {});
    }
  }, [audioEngine]);

  useEffect(() => {
    meRef.current = me;
    if (me?.position) {
      positionRef.current = me.position;
      setLocalPosition(me.position);
      if (me.paidAt && !demoGraveRef.current) {
        demoGraveRef.current = { x: me.position.x + 3, y: me.position.y + 1 };
      }
    }
    if (!me?.paidAt) demoGraveRef.current = null;
  }, [me?.id, me?.position?.x, me?.position?.y]);

  useEffect(() => {
    worldRef.current = world;
  }, [world]);

  useEffect(() => {
    function onKeyDown(event) {
      if (isTyping(event.target)) return;
      const delta = keyDelta(event.key);
      if (!delta) return;
      event.preventDefault();
      movementRef.current = delta;
      if (!event.repeat) applyMovement(delta, true);
    }

    function onKeyUp(event) {
      if (!keyDelta(event.key)) return;
      movementRef.current = { x: 0, y: 0 };
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [applyMovement]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const user = meRef.current;
      if (!user?.paidAt || user.status === "dead") return;
      const delta = movementRef.current;
      if (!delta.x && !delta.y) return;

      applyMovement(delta);
    }, 120);
    return () => window.clearInterval(id);
  }, [applyMovement]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    let frame = 0;
    let raf = 0;

    function resize() {
      const ratio = Math.max(1, window.devicePixelRatio || 1);
      canvas.width = Math.floor(window.innerWidth * ratio);
      canvas.height = Math.floor(window.innerHeight * ratio);
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = false;
    }

    function render() {
      frame += 1;
      drawScene(context, {
        width: window.innerWidth,
        height: window.innerHeight,
        world: worldRef.current,
        me: meRef.current,
        demoGrave: demoGraveRef.current,
        localPosition,
        frame
      });
      raf = window.requestAnimationFrame(render);
    }

    resize();
    window.addEventListener("resize", resize);
    render();
    return () => {
      window.removeEventListener("resize", resize);
      window.cancelAnimationFrame(raf);
    };
  }, [localPosition.x, localPosition.y]);

  return <canvas className="pixel-world" ref={canvasRef} aria-hidden="true" />;
}

function TopHud({ world, me }) {
  const position = me?.position || { x: 0, y: 0 };
  return (
    <aside className="top-hud" aria-label="Статус игры">
      <div className="hud-pill">
        <Coins size={15} />
        <span>{RUB.format(world.bank.prizeRub)}</span>
      </div>
      <div className="hud-pill">
        <MapPin size={15} />
        <span>{position.x}; {position.y}</span>
      </div>
      <div className="hud-pill">
        <CalendarDays size={15} />
        <span>{world.today}</span>
      </div>
    </aside>
  );
}

function Dpad() {
  return (
    <div className="dpad" aria-hidden="true">
      <button onPointerDown={() => pressVirtual("ArrowUp")} onPointerUp={releaseVirtual}><ArrowUp size={16} /></button>
      <button onPointerDown={() => pressVirtual("ArrowLeft")} onPointerUp={releaseVirtual}><ArrowLeft size={16} /></button>
      <button onPointerDown={() => pressVirtual("ArrowDown")} onPointerUp={releaseVirtual}><ArrowDown size={16} /></button>
      <button onPointerDown={() => pressVirtual("ArrowRight")} onPointerUp={releaseVirtual}><ArrowRight size={16} /></button>
    </div>
  );
}

function IconButton({ children, label, active, onClick }) {
  return (
    <button className={`icon-button ${active ? "active" : ""}`} onClick={onClick} title={label} aria-label={label} type="button">
      {children}
    </button>
  );
}

function Metric({ label, value }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function drawScene(ctx, { width, height, world, me, demoGrave, localPosition, frame }) {
  ctx.clearRect(0, 0, width, height);
  const tile = 32;
  const camera = localPosition || me?.position || { x: 0, y: 0 };
  const startX = Math.floor(camera.x - width / tile / 2) - 2;
  const endX = Math.ceil(camera.x + width / tile / 2) + 2;
  const startY = Math.floor(camera.y - height / tile / 2) - 2;
  const endY = Math.ceil(camera.y + height / tile / 2) + 2;

  ctx.fillStyle = "#12101d";
  ctx.fillRect(0, 0, width, height);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const sx = Math.round(width / 2 + (x - camera.x) * tile);
      const sy = Math.round(height / 2 + (y - camera.y) * tile);
      drawTile(ctx, x, y, sx, sy, tile, frame);
    }
  }

  const players = [...(world?.players || [])];
  if (me?.paidAt && !players.some((player) => player.id === me.id)) {
    players.push({
      id: me.id,
      email: me.email,
      status: me.status,
      position: localPosition,
      color: me.color,
      spriteVariant: me.spriteVariant
    });
  }

  const actors = players
    .map((player) => ({
      type: "player",
      player: player.id === me?.id ? { ...player, position: localPosition } : player,
      position: player.id === me?.id ? localPosition : player.position
    }));

  if (demoGrave) {
    actors.push({
      type: "demo-grave",
      position: demoGrave
    });
  }

  actors
    .sort((a, b) => a.position.y - b.position.y)
    .forEach((actor) => {
      const sx = Math.round(width / 2 + (actor.position.x - camera.x) * tile);
      const sy = Math.round(height / 2 + (actor.position.y - camera.y) * tile);
      if (sx < -80 || sy < -80 || sx > width + 80 || sy > height + 80) return;
      if (actor.type === "demo-grave") {
        drawTombstone(ctx, sx, sy, false);
      } else if (actor.player.status === "dead") {
        drawTombstone(ctx, sx, sy, actor.player.id === me?.id);
      } else {
        drawPlayer(ctx, sx, sy, actor.player.color, actor.player.spriteVariant, frame, actor.player.id === me?.id);
      }
    });

  drawVignette(ctx, width, height);
}

function drawTile(ctx, worldX, worldY, sx, sy, size, frame) {
  const noise = hash2(worldX, worldY);
  ctx.fillStyle = noise > 0.72 ? "#201b37" : noise > 0.38 ? "#272247" : "#2d2952";
  ctx.fillRect(sx, sy, size, size);

  ctx.fillStyle = "rgba(150, 130, 222, 0.18)";
  for (let i = 0; i < 3; i += 1) {
    const dot = hash2(worldX * (i + 3), worldY * (i + 5));
    if (dot > 0.58) {
      const px = sx + Math.floor(dot * 23) + i * 2;
      const py = sy + Math.floor(hash2(worldY + i, worldX - i) * 23);
      ctx.fillRect(px, py, 2, 2);
    }
  }

  if (noise < 0.045) {
    drawFlower(ctx, sx + 12, sy + 11, "#6cf7d0", frame + worldX);
  } else if (noise > 0.94) {
    ctx.fillStyle = "#171429";
    ctx.fillRect(sx + 4, sy + 22, 24, 4);
    ctx.fillStyle = "#443a72";
    ctx.fillRect(sx + 7, sy + 21, 18, 1);
  } else if (noise > 0.86) {
    ctx.fillStyle = "#e4d44b";
    ctx.fillRect(sx + 14, sy + 12, 4, 4);
    ctx.fillRect(sx + 12, sy + 14, 8, 2);
  }
}

function drawPlayer(ctx, x, y, color, variant, frame, isMe) {
  const bob = Math.sin(frame / 12) > 0 ? 0 : 1;
  const px = x - 12;
  const py = y - 25 + bob;
  const hair = variant === 1 ? "#23202c" : variant === 2 ? "#703b6b" : "#33273b";

  if (isMe) {
    ctx.fillStyle = "rgba(118, 248, 208, 0.22)";
    ctx.fillRect(x - 18, y + 6, 36, 6);
  }

  ctx.fillStyle = "#0c0a12";
  ctx.fillRect(px + 4, py + 28, 6, 6);
  ctx.fillRect(px + 15, py + 28, 6, 6);

  ctx.fillStyle = color;
  ctx.fillRect(px + 6, py + 15, 14, 13);
  ctx.fillStyle = shade(color, -30);
  ctx.fillRect(px + 5, py + 20, 4, 8);
  ctx.fillRect(px + 19, py + 20, 4, 8);

  ctx.fillStyle = "#ffd9a3";
  ctx.fillRect(px + 5, py + 6, 14, 11);
  ctx.fillStyle = hair;
  ctx.fillRect(px + 4, py + 3, 16, 6);
  ctx.fillRect(px + 3, py + 7, 4, 6);

  ctx.fillStyle = "#17111d";
  ctx.fillRect(px + 8, py + 11, 2, 2);
  ctx.fillRect(px + 15, py + 11, 2, 2);
  ctx.fillRect(px + 11, py + 15, 5, 1);

  ctx.fillStyle = "#f0ecff";
  ctx.fillRect(px + 8, py + 9, 1, 1);
  ctx.fillRect(px + 15, py + 9, 1, 1);
}

function drawTombstone(ctx, x, y, isMe) {
  const px = x - 13;
  const py = y - 24;

  if (isMe) {
    ctx.fillStyle = "rgba(255, 111, 145, 0.20)";
    ctx.fillRect(x - 18, y + 6, 36, 6);
  }

  ctx.fillStyle = "#0b0910";
  ctx.fillRect(px - 2, py + 25, 30, 5);
  ctx.fillStyle = "#817d93";
  ctx.fillRect(px + 4, py + 4, 18, 25);
  ctx.fillRect(px + 7, py + 1, 12, 6);
  ctx.fillStyle = "#b7b0c8";
  ctx.fillRect(px + 7, py + 5, 12, 3);
  ctx.fillStyle = "#403b53";
  ctx.fillRect(px + 10, py + 13, 6, 2);
  ctx.fillRect(px + 12, py + 10, 2, 8);
  ctx.fillStyle = "#5d576f";
  ctx.fillRect(px + 5, py + 26, 16, 3);
}

function drawFlower(ctx, x, y, color, frame) {
  const glow = Math.sin(frame / 18) > 0;
  ctx.fillStyle = "#57a888";
  ctx.fillRect(x + 6, y + 9, 2, 10);
  ctx.fillStyle = color;
  ctx.fillRect(x + 4, y + 3, 4, 4);
  ctx.fillRect(x + 8, y + 3, 4, 4);
  ctx.fillRect(x + 6, y + 1, 4, 4);
  ctx.fillRect(x + 6, y + 6, 4, 4);
  ctx.fillStyle = glow ? "#fbffe4" : "#f5e76f";
  ctx.fillRect(x + 7, y + 4, 2, 2);
}

function drawVignette(ctx, width, height) {
  const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) / 4, width / 2, height / 2, Math.max(width, height) / 1.05);
  gradient.addColorStop(0, "rgba(12, 9, 18, 0)");
  gradient.addColorStop(1, "rgba(12, 9, 18, 0.62)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

function shade(hex, amount) {
  const value = hex.replace("#", "");
  const number = Number.parseInt(value, 16);
  const r = Math.max(0, Math.min(255, (number >> 16) + amount));
  const g = Math.max(0, Math.min(255, ((number >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (number & 255) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function keyDelta(key) {
  if (!key) return null;
  const lowered = key.toLowerCase();
  if (key === "ArrowUp" || lowered === "w" || lowered === "ц") return { x: 0, y: -1 };
  if (key === "ArrowDown" || lowered === "s" || lowered === "ы") return { x: 0, y: 1 };
  if (key === "ArrowLeft" || lowered === "a" || lowered === "ф") return { x: -1, y: 0 };
  if (key === "ArrowRight" || lowered === "d" || lowered === "в") return { x: 1, y: 0 };
  return null;
}

function pressVirtual(key) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key }));
}

function releaseVirtual() {
  window.dispatchEvent(new KeyboardEvent("keyup", { key: "ArrowUp" }));
}

function isTyping(target) {
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
}

function realtimeUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.port === "5173" ? `${window.location.hostname}:3002` : window.location.host;
  return `${protocol}//${host}/ws`;
}

function normalizedPath() {
  return window.location.pathname.replace(/\/$/, "") || "/";
}

function readSoundPreference() {
  return window.localStorage.getItem("ltsi-sound") !== "off";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    ...options
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error || "REQUEST_FAILED");
  return body;
}

function humanError(error) {
  const map = {
    EMAIL_EXISTS: "Почта уже занята.",
    INVALID_CREDENTIALS: "Неверная почта или пароль.",
    EMAIL_NOT_VERIFIED: "Подтвердите почту.",
    BAD_EMAIL_OR_PASSWORD: "Почта и пароль от 8 символов.",
    AUTH_REQUIRED: "Нужно войти.",
    ADMIN_REQUIRED: "Нужны права администратора.",
    PAYMENT_REQUIRED: "Нужно оплатить участие.",
    PLAYER_DEAD: "Игрок уже умер.",
    REQUEST_FAILED: "Запрос не прошел."
  };
  return map[error] || error;
}

function toDatetimeLocal(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function statusText(status) {
  return {
    draft: "ожидание",
    running: "идет",
    ended: "финал"
  }[status] || status;
}

const rootElement = document.getElementById("root");
window.__liveToSeeItRoot ||= createRoot(rootElement);
window.__liveToSeeItRoot.render(<App />);
