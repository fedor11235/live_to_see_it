# Live to see it

Pixel-browser survival game prototype: each paid participant gets a tiny character on an endless field. Every game day they must press `Я живой`; if a required day is missed, the character dies and leaves a tombstone.

## What is included

- React/Vite client with a full-screen pixel canvas world.
- Express API with cookie sessions and email verification links.
- File-backed MVP storage in `data/db.json`.
- Daily alive checks, death sweep, public bank calculation, winner calculation.
- Mock payment flow for local testing.
- YooKassa payment creation/webhook adapter with fixed-fee verification.
- T-Bank acquiring payment creation/webhook adapter for test and production terminals.
- Separate operator panel for game start/end, fee, organizer percentage, users, and winner overview.
- Public rules, privacy, and cookie pages.

## Local Run

```bash
npm install
npm run dev
```

Open the game at `http://localhost:5173/`.

Open the operator panel at `http://localhost:5173/admon`.

Default local operator login:

```text
keeper
change-me-now
```

The API runs on `http://localhost:3002` during `npm run dev`.

## Environment

Copy `.env.example` to `.env` for real credentials:

```bash
cp .env.example .env
```

Set these before production:

- `SESSION_SECRET`
- `SITE_URL`
- `OPS_LOGIN`
- `OPS_PASSWORD`
- `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
- `APP_URL`
- `PAYMENT_PROVIDER`

Without SMTP, verification links are printed to the server console and returned to the UI as a dev link.

## Payments

Local development uses `PAYMENT_PROVIDER=mock`. A participant clicks `Оплатить участие`, the mock route marks the payment as paid, and the prize bank receives the participation fee minus the organizer fee.

Use `PAYMENT_PROVIDER=disabled` on a public pre-payment deployment so the site can show the rules and price without granting free paid access.

For YooKassa:

```env
PAYMENT_PROVIDER=yookassa
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
```

Configure the YooKassa webhook to:

```text
https://your-domain.example/api/payments/yookassa/webhook
```

Subscribe to `payment.succeeded`; `payment.canceled` is also supported.

For T-Bank acquiring:

```env
PAYMENT_PROVIDER=tbank
TBANK_TERMINAL_KEY=...
TBANK_PASSWORD=...
TBANK_API_BASE_URL=https://securepay.tinkoff.ru/v2
TBANK_SEND_RECEIPT=true
TBANK_TAXATION=usn_income
TBANK_VAT=none
PAYMENT_GRANT_ACCESS_ON_SUCCESS=true
```

The test terminal from T-Bank usually ends with `DEMO`. The default API base URL above is suitable for it.

Configure the T-Bank notification URL to:

```text
https://your-domain.example/api/payments/tbank/webhook
```

The T-Bank adapter sends the participation amount in kopecks, redirects the user to the returned `PaymentURL`, verifies notification tokens, and grants game access only after the `CONFIRMED` status. The webhook responds with plain `OK`, as required by T-Bank. As a fallback, T-Bank return URLs and `/api/world` also call `GetState` for pending payments, so the UI updates even if the webhook is delayed.

For temporary payment testing, set `PAYMENT_GRANT_ACCESS_ON_SUCCESS=false`. A confirmed T-Bank payment will be shown as `test_confirmed`, but the user will not receive `paidAt` and can pay again without a manual database reset. Turn it back to `true` before real launch.

How the production payment flow works:

- The participant clicks `Оплатить участие`.
- The server creates a payment using the configured provider and the current `Взнос` from the operator panel.
- The user cannot type a custom amount on the game side.
- If the operator changes `Взнос`, an old pending payment with the previous amount expires locally and the next attempt creates a new payment with the new amount.
- On provider confirmation, the server verifies status, exact amount, local `paymentId`/`OrderId`, and provider payment id before granting game access.

Before real launch, also decide the refund rule for payments that were opened before the start but completed after the start. The current game does not admit them into the running round.

## Legal Note

The proposed model is not a normal donation if the entry payment forms a money prize pool. Before launch, check the legal structure, taxes, user agreement, refund rules, age limits, and payout process with a lawyer/payment provider.

A safer first production variant is either:

- free participation with optional donations that do not affect prizes;
- paid access with non-cash rewards;
- a properly documented skill contest through an eligible legal entity.

## Production Build

```bash
npm run build
npm start
```

`npm start` serves the built client from `dist/client`.

## Docker

Production container:

```bash
docker compose up --build -d
```

The compose file expects `.env.production` and keeps app data in the `live_to_see_it_data` Docker volume. The app listens on `127.0.0.1:3002` for a host Nginx reverse proxy.

Nginx example for `livetoseeit.ru` is in `deploy/nginx/livetoseeit.ru.conf`.
