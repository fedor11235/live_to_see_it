# Live to see it

Pixel-browser survival game prototype: each paid participant gets a tiny character on an endless field. Every game day they must press `Я живой`; if a required day is missed, the character dies and leaves a tombstone.

## What is included

- React/Vite client with a full-screen pixel canvas world.
- Express API with cookie sessions and email verification links.
- File-backed MVP storage in `data/db.json`.
- Daily alive checks, death sweep, public bank calculation, winner calculation.
- Mock payment flow for local testing.
- YooKassa payment creation/webhook adapter stub.
- Separate operator panel for game start/end, fee, organizer percentage, users, and winner overview.

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

The current adapter creates a redirect payment and marks local payments as paid on `payment.succeeded`.

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
