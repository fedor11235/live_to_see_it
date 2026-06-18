import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  Coins,
  FileText,
  HeartPulse,
  Landmark,
  LogOut,
  Mail,
  MapPin,
  Scroll,
  ShieldCheck,
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

const DATE_TIME = new Intl.DateTimeFormat("ru-RU", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

const SoundContext = createContext({ soundEnabled: true, toggleSound: () => {}, audioEngine: null });

function useSound() {
  return useContext(SoundContext);
}

function SoundProvider({ children }) {
  const [soundEnabled, setSoundEnabled] = useState(readSoundPreference);
  const audioRef = useRef(getPixelAudioEngine());

  useEffect(() => {
    if (!soundEnabled) {
      audioRef.current.stop();
      return undefined;
    }

    const engine = audioRef.current;
    engine.start();

    function unlock() {
      engine.start();
    }

    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundEnabled]);

  const toggleSound = useCallback(() => {
    setSoundEnabled((current) => {
      const next = !current;
      window.localStorage.setItem("ltsi-sound", next ? "on" : "off");
      return next;
    });
  }, []);

  return (
    <SoundContext.Provider value={{ soundEnabled, toggleSound, audioEngine: audioRef.current }}>
      {children}
    </SoundContext.Provider>
  );
}

function SoundToggle() {
  const { soundEnabled, toggleSound } = useSound();
  return (
    <IconButton label={soundEnabled ? "Выключить звук" : "Включить звук"} onClick={toggleSound}>
      {soundEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
    </IconButton>
  );
}

function App() {
  const path = normalizedPath();
  return (
    <SoundProvider>
      {path === OPS_PATH ? (
        <OperatorApp />
      ) : path === "/cookies" ? (
        <CookiePolicyApp />
      ) : path === "/rules" ? (
        <RulesApp />
      ) : path === "/privacy" ? (
        <PrivacyApp />
      ) : path === "/contacts" ? (
        <ContactsApp />
      ) : path === "/offer" ? (
        <OfferApp />
      ) : (
        <GameApp />
      )}
      <CookieNotice />
    </SoundProvider>
  );
}

function GameApp() {
  const [me, setMe] = useState(null);
  const [world, setWorld] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const { soundEnabled, audioEngine } = useSound();

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
    if (params.get("payment") === "closed") setNotice("Набор в текущий раунд уже закрыт.");

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
    setMe(null);
    setWorld(null);
  }

  if (loading) {
    return <BootScreen />;
  }

  return (
    <main className="app-shell">
      <PixelBackdrop world={world} me={me} audioEngine={soundEnabled ? audioEngine : null} />

      {world && <TopHud world={world} me={me} />}

      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
        <GameLinks />
        <SoundToggle />
      </header>

      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice}
        </button>
      )}

      {me && (
        <div className="session-bar">
          <IconButton label="Выйти" onClick={logout}>
            <LogOut size={18} />
          </IconButton>
        </div>
      )}

      {!me && <AuthPanel onAuth={refreshMe} />}
      {me && world && <RoundPanel me={me} world={world} onPaid={refreshWorld} />}
      {me && <GameControls me={me} world={world} refreshWorld={refreshWorld} />}
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

function GameLinks() {
  return (
    <nav className="brand-links" aria-label="Документы">
      <a href="/rules" title="Правила игры">
        <FileText size={15} />
        <span>Правила</span>
      </a>
      <a href="/offer" title="Публичная оферта">
        <Scroll size={15} />
        <span>Оферта</span>
      </a>
      <a href="/contacts" title="Контакты и реквизиты">
        <Landmark size={15} />
        <span>Контакты</span>
      </a>
      <a href="/privacy" title="Политика конфиденциальности">
        <ShieldCheck size={15} />
        <span>Данные</span>
      </a>
    </nav>
  );
}

function CookiePolicyApp() {
  return (
    <main className="operator-shell document-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
        <GameLinks />
        <SoundToggle />
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
        <div className="document-links">
          <a className="dev-link" href="/rules">Правила игры</a>
          <a className="dev-link" href="/privacy">Политика конфиденциальности</a>
        </div>
        <a className="dev-link" href="/">Вернуться в игру</a>
      </article>
    </main>
  );
}

function RulesApp() {
  return (
    <main className="operator-shell document-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
        <GameLinks />
        <SoundToggle />
      </header>

      <article className="panel document-panel rules-document">
        <div className="panel-title">
          <span className="panel-kicker">Live to see it</span>
          <h1>Правила игры</h1>
        </div>

        <section className="document-section">
          <h2>Суть</h2>
          <p>
            У каждого зарегистрированного игрока есть пиксельный персонаж на бесконечном поле. Игрок может ходить по полю, видеть координаты и встречать других игроков или могилки тех, кто выбыл.
          </p>
        </section>

        <section className="document-section">
          <h2>Участие</h2>
          <ol className="document-list">
            <li>Нужно зарегистрироваться по почте и подтвердить email.</li>
            <li>До старта игры можно оплатить взнос, который указан в текущем раунде.</li>
            <li>После старта новые пользователи могут ходить по полю, но не входят в банк текущего раунда.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>Ежедневная отметка</h2>
          <p>
            Когда раунд начался, участник должен каждый игровой день нажать кнопку Я живой. День считается по таймзоне, указанной в панели оператора. Если участник пропускает хотя бы один день, персонаж умирает, а на поле остается могилка.
          </p>
        </section>

        <section className="document-section">
          <h2>Банк и победители</h2>
          <p>
            Взносы формируют общий банк. Организаторский процент удерживается отдельно, остальная сумма становится призовым фондом. После финиша призовой фонд делится поровну между участниками, которые не пропустили ни одной отметки.
          </p>
        </section>

        <section className="document-section">
          <h2>Честная игра</h2>
          <p>
            Запрещены попытки обходить авторизацию, подделывать оплату, ломать клиент или мешать другим игрокам. Администратор может отменять подозрительные участия и проверять спорные ситуации по логам.
          </p>
        </section>

        <p className="legal-note">
          Перед запуском денежных призов нужно отдельно проверить юридическую модель, налоги, оферту, правила возвратов и выплаты.
        </p>
        <div className="document-links">
          <a className="dev-link" href="/privacy">Политика конфиденциальности</a>
          <a className="dev-link" href="/cookies">Cookie</a>
        </div>
        <a className="dev-link" href="/">Вернуться в игру</a>
      </article>
    </main>
  );
}

function PrivacyApp() {
  return (
    <main className="operator-shell document-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
        <GameLinks />
        <SoundToggle />
      </header>

      <article className="panel document-panel privacy-document">
        <div className="panel-title">
          <span className="panel-kicker">Персональные данные</span>
          <h1>Политика конфиденциальности</h1>
        </div>

        <section className="document-section">
          <h2>Оператор</h2>
          <p>
            Оператор проекта Live to see it обрабатывает данные пользователей для регистрации, участия в игре, приема взносов, защиты сервиса и связи с пользователями. Контакт для запросов: main.hubbox@mail.ru.
          </p>
        </section>

        <section className="document-section">
          <h2>Какие данные обрабатываются</h2>
          <ol className="document-list">
            <li>Email, хеш пароля, дата регистрации и подтверждения почты.</li>
            <li>Игровые данные: координаты, статус персонажа, ежедневные отметки, дата смерти и видимые игровые события.</li>
            <li>Платежные данные: сумма, статус, идентификатор платежа и провайдер. Реквизиты банковских карт хранятся на стороне платежного провайдера.</li>
            <li>Технические cookie сессии, настройки интерфейса и служебные логи безопасности.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>Зачем это нужно</h2>
          <p>
            Данные используются для входа в аккаунт, подтверждения почты, работы игрового поля, учета участников, проверки оплаты, расчета банка, предотвращения злоупотреблений и выполнения обязательств перед пользователями.
          </p>
        </section>

        <section className="document-section">
          <h2>Передача данных</h2>
          <p>
            Данные могут передаваться сервисам хостинга, почтовому сервису для подтверждения регистрации и платежному провайдеру для приема взноса. Платежный провайдер самостоятельно обрабатывает платежные реквизиты по своим правилам.
          </p>
        </section>

        <section className="document-section">
          <h2>Права пользователя</h2>
          <p>
            Пользователь может запросить доступ к своим данным, исправление, удаление аккаунта или отзыв согласия. Запрос можно отправить на main.hubbox@mail.ru. Часть данных может сохраняться дольше, если это требуется для бухгалтерии, безопасности, споров или закона.
          </p>
        </section>

        <p className="legal-note">
          Перед публичным запуском текст нужно адаптировать под юридическое лицо или ИП, фактический хостинг, платежного провайдера и сроки хранения данных.
        </p>
        <div className="document-links">
          <a className="dev-link" href="/rules">Правила игры</a>
          <a className="dev-link" href="/cookies">Cookie</a>
        </div>
        <a className="dev-link" href="/">Вернуться в игру</a>
      </article>
    </main>
  );
}

function ContactsApp() {
  return (
    <main className="operator-shell document-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
        <GameLinks />
        <SoundToggle />
      </header>

      <article className="panel document-panel">
        <div className="panel-title">
          <span className="panel-kicker">Реквизиты и контакты</span>
          <h1>Live to see it</h1>
        </div>

        <section className="document-section">
          <h2>Исполнитель</h2>
          <p>
            Услугу оказывает Индивидуальный предприниматель Авдеев Фёдор Васильевич, действующий на основании выписки из ЕГРИП.
          </p>
          <ol className="document-list">
            <li>Полное наименование: Индивидуальный предприниматель Авдеев Фёдор Васильевич.</li>
            <li>ИНН: 121526595037.</li>
            <li>ОГРНИП: 325120000052090.</li>
            <li>Дата регистрации: 26 декабря 2025 г.</li>
            <li>Регистрирующий орган: УФНС России по Республике Марий Эл.</li>
            <li>Основной вид деятельности: 62.01 — Разработка компьютерного программного обеспечения.</li>
            <li>Адрес: Республика Марий Эл, город Йошкар-Ола.</li>
            <li>Налоговый режим: УСН.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>Связь</h2>
          <ol className="document-list">
            <li>Электронная почта: <a className="dev-link" href="mailto:main.hubbox@mail.ru">main.hubbox@mail.ru</a>.</li>
            <li>Телефон: <a className="dev-link" href="tel:+79027369322">+7 (902) 736-93-22</a>.</li>
            <li>Время ответа: в рабочие дни, в течение суток с момента обращения.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>Услуга и стоимость</h2>
          <p>
            Услуга — платный доступ к раунду браузерной игры Live to see it: участие на игровом поле, ежедневная отметка и участие в распределении призового фонда раунда по правилам игры.
          </p>
          <ol className="document-list">
            <li>Стоимость участия в раунде: 2000 ₽.</li>
            <li>Услуга цифровая, оказывается онлайн, физическая доставка не предусмотрена.</li>
            <li>Доступ открывается автоматически после подтверждения оплаты платёжным провайдером.</li>
            <li>Порядок оплаты, возвратов и расторжения договора описан в <a className="dev-link" href="/offer">публичной оферте</a>.</li>
          </ol>
        </section>

        <div className="document-links">
          <a className="dev-link" href="/offer">Публичная оферта</a>
          <a className="dev-link" href="/rules">Правила игры</a>
          <a className="dev-link" href="/privacy">Политика конфиденциальности</a>
          <a className="dev-link" href="/cookies">Cookie</a>
        </div>
        <a className="dev-link" href="/">Вернуться в игру</a>
      </article>
    </main>
  );
}

function OfferApp() {
  return (
    <main className="operator-shell document-shell">
      <header className="brand-plate" aria-label="Live to see it">
        <span className="brand-mark">LTSI</span>
        <span>Live to see it</span>
        <GameLinks />
        <SoundToggle />
      </header>

      <article className="panel document-panel">
        <div className="panel-title">
          <span className="panel-kicker">Публичная оферта</span>
          <h1>Платный доступ к игре Live to see it</h1>
        </div>

        <p>
          Настоящий документ является публичной офертой Индивидуального предпринимателя Авдеева Фёдора Васильевича (ИНН 121526595037, ОГРНИП 325120000052090), далее Исполнитель, в адрес любого дееспособного физического лица, далее Пользователь, и определяет условия оказания платной услуги участия в игре Live to see it.
        </p>

        <section className="document-section">
          <h2>1. Предмет</h2>
          <p>
            Исполнитель предоставляет Пользователю платный доступ к одному раунду браузерной игры Live to see it, размещённой на сайте livetoseeit.ru. Услуга включает возможность зарегистрировать персонажа, выполнять ежедневную отметку Я живой и участвовать в распределении призового фонда раунда на условиях правил игры.
          </p>
        </section>

        <section className="document-section">
          <h2>2. Акцепт</h2>
          <p>
            Акцептом оферты считается совокупность действий Пользователя: регистрация на сайте, подтверждение электронной почты и оплата участия в текущем раунде. С момента акцепта между Исполнителем и Пользователем заключается возмездный договор оказания услуг на условиях настоящей оферты.
          </p>
        </section>

        <section className="document-section">
          <h2>3. Стоимость и порядок оплаты</h2>
          <ol className="document-list">
            <li>Стоимость участия в одном раунде составляет 2000 ₽ и не зависит от времени, проведённого в раунде.</li>
            <li>Оплата производится единовременно через платёжного провайдера ЮKassa (ООО НКО ЮMoney). Реквизиты банковской карты обрабатываются на стороне провайдера.</li>
            <li>Услуга считается оказанной с момента, когда Пользователю открыт доступ к участию в раунде по подтверждённой оплате.</li>
            <li>Оплата возможна только до момента старта раунда, объявленного в панели игры. После старта приём оплат закрывается.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>4. Доставка</h2>
          <p>
            Услуга является цифровой и оказывается дистанционно через интернет. Физическая доставка не предусмотрена. Доступ открывается автоматически после успешной оплаты в личном кабинете Пользователя на сайте.
          </p>
        </section>

        <section className="document-section">
          <h2>5. Возвраты</h2>
          <ol className="document-list">
            <li>До старта раунда Пользователь может отказаться от участия и потребовать возврат уплаченной суммы. Возврат производится тем же способом, которым была произведена оплата, в срок до 10 рабочих дней.</li>
            <li>После старта раунда услуга считается оказанной в момент открытия доступа: возврат возможен только при доказанной невозможности оказания услуги по вине Исполнителя.</li>
            <li>Запрос на возврат направляется на адрес main.hubbox@mail.ru с указанием email учётной записи, даты оплаты и причины.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>6. Права и обязанности</h2>
          <ol className="document-list">
            <li>Исполнитель обязуется поддерживать работоспособность сайта в течение раунда и обеспечивать сохранность игровых данных Пользователя в разумных пределах.</li>
            <li>Пользователь обязуется не нарушать правила игры, не предпринимать попытки обхода авторизации и оплаты, не использовать автоматизацию и не мешать другим участникам.</li>
            <li>Исполнитель вправе отменить участие Пользователя без возврата стоимости, если установлено нарушение пункта 6.2, мошенничество с оплатой или иное недобросовестное поведение.</li>
          </ol>
        </section>

        <section className="document-section">
          <h2>7. Ответственность и форс-мажор</h2>
          <p>
            Стороны не несут ответственности за неисполнение обязательств, если это вызвано обстоятельствами непреодолимой силы, действиями третьих лиц или сбоями инфраструктуры провайдеров связи, хостинга и приёма платежей. В остальном ответственность сторон определяется законодательством Российской Федерации.
          </p>
        </section>

        <section className="document-section">
          <h2>8. Персональные данные</h2>
          <p>
            Порядок обработки персональных данных описан в <a className="dev-link" href="/privacy">Политике конфиденциальности</a>. Принимая оферту, Пользователь подтверждает согласие с её условиями.
          </p>
        </section>

        <section className="document-section">
          <h2>9. Изменение оферты</h2>
          <p>
            Исполнитель вправе изменять условия оферты в одностороннем порядке. Новая редакция вступает в силу с момента публикации на сайте livetoseeit.ru/offer и не распространяется на уже заключённые договоры до завершения соответствующего раунда.
          </p>
        </section>

        <section className="document-section">
          <h2>10. Реквизиты Исполнителя</h2>
          <ol className="document-list">
            <li>Индивидуальный предприниматель Авдеев Фёдор Васильевич.</li>
            <li>ИНН: 121526595037.</li>
            <li>ОГРНИП: 325120000052090.</li>
            <li>Адрес: Республика Марий Эл, город Йошкар-Ола.</li>
            <li>Электронная почта: main.hubbox@mail.ru.</li>
            <li>Телефон: +7 (902) 736-93-22.</li>
          </ol>
        </section>

        <div className="document-links">
          <a className="dev-link" href="/contacts">Контакты и реквизиты</a>
          <a className="dev-link" href="/rules">Правила игры</a>
          <a className="dev-link" href="/privacy">Политика конфиденциальности</a>
          <a className="dev-link" href="/cookies">Cookie</a>
        </div>
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
        <SoundToggle />
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
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [devLink, setDevLink] = useState("");
  const [busy, setBusy] = useState(false);

  function changeMode(nextMode) {
    setMode(nextMode);
    setError("");
    setMessage("");
    setDevLink("");
    setPasswordConfirm("");
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setDevLink("");

    try {
      if (mode === "register") {
        if (password !== passwordConfirm) {
          setError("Пароли не совпадают.");
          return;
        }

        const result = await api("/api/auth/register", {
          method: "POST",
          body: JSON.stringify({ email, password, passwordConfirm })
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
        <button className={mode === "login" ? "active" : ""} onClick={() => changeMode("login")} type="button">
          Вход
        </button>
        <button className={mode === "register" ? "active" : ""} onClick={() => changeMode("register")} type="button">
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
        {mode === "register" && (
          <label>
            Подтвердите пароль
            <input value={passwordConfirm} onChange={(event) => setPasswordConfirm(event.target.value)} type="password" minLength={8} autoComplete="new-password" required />
          </label>
        )}
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

function RoundPanel({ me, world, onPaid }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const game = world?.game;
  const fee = game?.participationFeeRub || 3000;
  const round = world?.round || {};
  const canPay = round.canJoin && !round.isParticipant && me.status !== "dead";
  const headline = roundHeadline(game, round);
  const note = roundNote(game, round);

  async function startPayment() {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/payments/start", { method: "POST" });
      if (result.status === "paid") {
        await onPaid();
        setBusy(false);
        return;
      }
      window.location.href = result.confirmationUrl;
    } catch (caught) {
      setError(humanError(caught.message));
      setBusy(false);
    }
  }

  return (
    <section className="panel round-panel" aria-label="Раунд">
      <div className="panel-title">
        <span className="panel-kicker">{me.email}</span>
        <h1>{headline}</h1>
      </div>
      <div className="round-grid">
        <Metric label="Старт игры" value={formatGameDate(game?.startAt)} />
        <Metric label="Финиш игры" value={formatGameDate(game?.endAt)} />
        <Metric label="Взнос" value={RUB.format(fee)} />
        <Metric label="Орг. процент" value={`${game?.organizerFeePercent || 10}%`} />
        <Metric label="Банк" value={RUB.format(world?.bank?.prizeRub || 0)} />
        <Metric label="Участников" value={String(world?.bank?.paidCount || 0)} />
      </div>
      <p className="legal-note">{note}</p>
      {error && <p className="form-error">{error}</p>}
      {canPay && (
        <button className="primary" disabled={busy} onClick={startPayment}>
          {busy ? "..." : "Оплатить участие"}
        </button>
      )}
    </section>
  );
}

function GameControls({ me, world, refreshWorld }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canMarkAlive = Boolean(world?.round?.canMarkAlive);

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
      {canMarkAlive && (
        <section className="alive-dock" aria-label="Дневная отметка">
          <button className="alive-button" disabled={busy || world?.aliveToday} onClick={markAlive}>
            <HeartPulse size={20} />
            {world?.aliveToday ? "Сегодня живой" : busy ? "..." : "Я живой"}
          </button>
          {error && <span className="inline-error">{error}</span>}
        </section>
      )}
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
  const [localPosition, setLocalPosition] = useState(me?.position || { x: 0, y: 0 });
  const positionRef = useRef(me?.position || { x: 0, y: 0 });
  const movementRef = useRef({ x: 0, y: 0 });
  const lastSentRef = useRef(0);

  const applyMovement = useCallback((delta, forceSend = false) => {
    const user = meRef.current;
    if (!user || user.status === "dead") return;

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
    }
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
      if (!user || user.status === "dead") return;
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

function drawScene(ctx, { width, height, world, me, localPosition, frame }) {
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
  if (me && !players.some((player) => player.id === me.id)) {
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

  actors
    .sort((a, b) => a.position.y - b.position.y)
    .forEach((actor) => {
      const sx = Math.round(width / 2 + (actor.position.x - camera.x) * tile);
      const sy = Math.round(height / 2 + (actor.position.y - camera.y) * tile);
      if (sx < -80 || sy < -80 || sx > width + 80 || sy > height + 80) return;
      if (actor.player.status === "dead") {
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
    PASSWORD_MISMATCH: "Пароли не совпадают.",
    AUTH_REQUIRED: "Нужно войти.",
    ADMIN_REQUIRED: "Нужны права администратора.",
    PAYMENT_REQUIRED: "Нужно оплатить участие.",
    PAYMENT_PROVIDER_DISABLED: "Оплата скоро будет подключена.",
    GAME_START_REQUIRED: "Старт игры еще не назначен.",
    GAME_NOT_RUNNING: "Игра еще не идет.",
    JOIN_CLOSED: "Набор в текущий раунд уже закрыт.",
    NOT_CURRENT_PARTICIPANT: "Ты не участник текущего раунда.",
    PLAYER_DEAD: "Игрок уже умер.",
    REQUEST_FAILED: "Запрос не прошел."
  };
  return map[error] || error;
}

function roundHeadline(game, round) {
  if (round.isParticipant && round.state === "running") return "Раунд идет";
  if (round.isParticipant) return "Ты в раунде";
  if (!game?.startAt) return "Старт скоро";
  if (round.canJoin) return "Набор идет";
  if (round.state === "running") return "Набор закрыт";
  if (round.state === "ended") return "Финиш";
  return statusText(round.state || game?.state);
}

function roundNote(game, round) {
  if (round.isParticipant && round.state === "running") {
    return "Отмечайся каждый день до финиша. Если пропустить день, персонаж умрет и останется могилка.";
  }

  if (round.isParticipant) {
    return "Взнос принят до старта. Кнопка Я живой появится, когда игра начнется.";
  }

  if (!game?.startAt) {
    return "Можно ходить по полю и пробовать игру. Оплата откроется после того, как будет назначен старт.";
  }

  if (round.canJoin) {
    return "Можно ходить по полю бесплатно. Чтобы попасть в текущий банк, нужно оплатить взнос до старта игры.";
  }

  if (round.state === "running") {
    return "Игра уже началась, поэтому вступить в текущий банк нельзя. Можно ходить по полю и ждать следующий раунд.";
  }

  return "Раунд завершен. Можно ходить по полю и ждать следующую игру.";
}

function formatGameDate(iso) {
  if (!iso) return "не задано";
  return DATE_TIME.format(new Date(iso));
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
