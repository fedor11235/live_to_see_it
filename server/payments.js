import crypto from "node:crypto";

export function createPaymentGateway({ env, store }) {
  const provider = normalizeProvider(env.PAYMENT_PROVIDER || "mock");

  async function startPayment(user, origin) {
    if (provider === "disabled") {
      const error = new Error("PAYMENT_PROVIDER_DISABLED");
      error.status = 503;
      throw error;
    }

    const payment = store.createPayment(user.id, provider);

    if (payment.status === "paid") {
      return { status: "paid", confirmationUrl: null };
    }

    if (payment.status === "pending" && payment.confirmationUrl) {
      return {
        status: "pending",
        provider: payment.provider,
        paymentId: payment.id,
        confirmationUrl: payment.confirmationUrl
      };
    }

    if (provider === "yookassa") {
      if (!env.YOOKASSA_SHOP_ID || !env.YOOKASSA_SECRET_KEY) throw providerNotConfigured("YOOKASSA");
      return startYooKassaPayment({ env, store, user, payment, origin });
    }

    if (provider === "tbank") {
      if (!env.TBANK_TERMINAL_KEY || !env.TBANK_PASSWORD) throw providerNotConfigured("TBANK");
      return startTBankPayment({ env, store, user, payment, origin });
    }

    if (provider === "mock") {
      const confirmationUrl = `${origin}/api/payments/mock/${payment.id}/complete`;
      store.updatePayment(payment.id, { confirmationUrl });
      return {
        status: "pending",
        provider: "mock",
        paymentId: payment.id,
        confirmationUrl
      };
    }

    const error = new Error("UNKNOWN_PAYMENT_PROVIDER");
    error.status = 500;
    throw error;
  }

  async function handleYooKassaWebhook(payload) {
    const event = payload?.event;
    const object = payload?.object;
    const paymentId = object?.metadata?.paymentId;
    if (!paymentId) return false;

    if (event === "payment.canceled") {
      store.markPaymentCanceled(paymentId, object?.cancellation_details?.reason || "provider-canceled");
      return true;
    }

    if (event === "payment.succeeded") {
      const remotePayment = await getYooKassaPayment(env, object.id);
      const localPayment = store.getPayment(paymentId);
      if (!isVerifiedYooKassaPayment(localPayment, remotePayment)) {
        const error = new Error("YOOKASSA_WEBHOOK_MISMATCH");
        error.status = 400;
        throw error;
      }

      store.markPaymentPaid(paymentId, remotePayment.id);
      return true;
    }

    return false;
  }

  async function handleTBankWebhook(payload) {
    if (!isValidTBankToken(payload, env.TBANK_PASSWORD)) {
      const error = new Error("TBANK_WEBHOOK_BAD_TOKEN");
      error.status = 400;
      throw error;
    }

    const localPaymentId = String(payload?.OrderId || readTBankData(payload)?.paymentId || "");
    const localPayment = store.getPayment(localPaymentId);
    if (!isVerifiedTBankNotification(localPayment, payload, env)) {
      const error = new Error("TBANK_WEBHOOK_MISMATCH");
      error.status = 400;
      throw error;
    }

    applyTBankPaymentState({ env, store, localPayment, remotePayment: payload });
    return true;
  }

  async function syncPayment(paymentId) {
    const payment = store.getPayment(paymentId);
    if (!payment || payment.provider !== "tbank" || !payment.providerPaymentId) return payment;
    return syncTBankPayment(payment);
  }

  async function syncUserPayments(user) {
    if (provider !== "tbank" || !user?.id) return null;
    const payment = store.getPendingPaymentForUser(user.id, "tbank");
    if (!payment?.providerPaymentId) return payment;
    return syncTBankPayment(payment);
  }

  async function syncTBankPayment(payment) {
    const remotePayment = await getTBankPaymentState(env, payment.providerPaymentId);
    const localPayment = store.getPayment(payment.id);
    if (!isVerifiedTBankState(localPayment, remotePayment, env)) {
      const error = new Error("TBANK_STATE_MISMATCH");
      error.status = 400;
      throw error;
    }
    return applyTBankPaymentState({ env, store, localPayment, remotePayment });
  }

  return { startPayment, handleYooKassaWebhook, handleTBankWebhook, syncPayment, syncUserPayments };
}

async function startYooKassaPayment({ env, store, user, payment, origin }) {
  const idempotenceKey = payment.id;
  const credentials = Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString("base64");

  const response = await fetch("https://api.yookassa.ru/v3/payments", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotence-Key": idempotenceKey,
      Authorization: `Basic ${credentials}`
    },
    body: JSON.stringify({
      amount: {
        value: formatRubAmount(payment.amount),
        currency: "RUB"
      },
      capture: true,
      confirmation: {
        type: "redirect",
        return_url: `${origin}/?payment=return`
      },
      description: "Участие в Live to see it",
      metadata: {
        paymentId: payment.id,
        userId: user.id
      }
    })
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`YOOKASSA_ERROR: ${body}`);
    error.status = 502;
    throw error;
  }

  const body = await response.json();
  const confirmationUrl = body.confirmation?.confirmation_url || null;
  store.updatePayment(payment.id, {
    providerPaymentId: body.id,
    confirmationUrl
  });

  return {
    status: "pending",
    provider: "yookassa",
    paymentId: payment.id,
    confirmationUrl
  };
}

async function startTBankPayment({ env, store, user, payment, origin }) {
  const amount = amountToKopecks(payment.amount);
  const payload = compactObject({
    TerminalKey: env.TBANK_TERMINAL_KEY,
    Amount: amount,
    OrderId: payment.id,
    Description: "Участие в Live to see it",
    CustomerKey: user.id,
    PayType: "O",
    Language: "ru",
    NotificationURL: `${origin}/api/payments/tbank/webhook`,
    SuccessURL: `${origin}/api/payments/tbank/return/${payment.id}`,
    FailURL: `${origin}/api/payments/tbank/fail/${payment.id}`,
    DATA: {
      paymentId: payment.id,
      userId: user.id
    },
    Receipt: shouldSendTBankReceipt(env) ? buildTBankReceipt(env, user, payment, amount) : undefined
  });
  payload.Token = createTBankToken(payload, env.TBANK_PASSWORD);

  const response = await fetch(`${tbankApiBaseUrl(env)}/Init`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readJsonResponse(response);

  if (!response.ok || body.Success === false) {
    const error = new Error(`TBANK_ERROR: ${body.Message || body.Details || body.ErrorCode || "request failed"}`);
    error.status = 502;
    throw error;
  }

  if (!body.PaymentURL || !body.PaymentId) {
    const error = new Error("TBANK_BAD_RESPONSE");
    error.status = 502;
    throw error;
  }

  store.updatePayment(payment.id, {
    providerPaymentId: String(body.PaymentId),
    confirmationUrl: body.PaymentURL
  });

  return {
    status: "pending",
    provider: "tbank",
    paymentId: payment.id,
    confirmationUrl: body.PaymentURL
  };
}

async function getYooKassaPayment(env, providerPaymentId) {
  const credentials = Buffer.from(`${env.YOOKASSA_SHOP_ID}:${env.YOOKASSA_SECRET_KEY}`).toString("base64");
  const response = await fetch(`https://api.yookassa.ru/v3/payments/${encodeURIComponent(providerPaymentId)}`, {
    headers: {
      Authorization: `Basic ${credentials}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    const error = new Error(`YOOKASSA_VERIFY_ERROR: ${body}`);
    error.status = 502;
    throw error;
  }

  return response.json();
}

async function getTBankPaymentState(env, providerPaymentId) {
  const payload = {
    TerminalKey: env.TBANK_TERMINAL_KEY,
    PaymentId: providerPaymentId
  };
  payload.Token = createTBankToken(payload, env.TBANK_PASSWORD);

  const response = await fetch(`${tbankApiBaseUrl(env)}/GetState`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const body = await readJsonResponse(response);

  if (!response.ok || body.Success === false) {
    const error = new Error(`TBANK_STATE_ERROR: ${body.Message || body.Details || body.ErrorCode || "request failed"}`);
    error.status = 502;
    throw error;
  }

  return body;
}

function isValidTBankToken(payload, password) {
  if (!payload?.Token || !password) return false;
  return payload.Token === createTBankToken(payload, password);
}

function isVerifiedTBankNotification(localPayment, payload, env) {
  if (!localPayment || !payload) return false;
  if (localPayment.provider !== "tbank") return false;
  if (!["pending", "paid", "expired", "canceled", "test_confirmed"].includes(localPayment.status)) return false;
  if (payload.TerminalKey !== env.TBANK_TERMINAL_KEY) return false;
  if (payload.Amount !== undefined && amountToKopecks(localPayment.amount) !== Number(payload.Amount)) return false;
  if (localPayment.providerPaymentId && String(payload.PaymentId || "") !== localPayment.providerPaymentId) return false;
  return true;
}

function isVerifiedTBankState(localPayment, remotePayment, env) {
  if (!localPayment || !remotePayment) return false;
  if (localPayment.provider !== "tbank") return false;
  if (remotePayment.TerminalKey !== env.TBANK_TERMINAL_KEY) return false;
  if (String(remotePayment.OrderId || "") !== localPayment.id) return false;
  if (String(remotePayment.PaymentId || "") !== String(localPayment.providerPaymentId || "")) return false;
  if (remotePayment.Amount !== undefined && amountToKopecks(localPayment.amount) !== Number(remotePayment.Amount)) {
    return false;
  }
  return true;
}

function isVerifiedYooKassaPayment(localPayment, remotePayment) {
  if (!localPayment || !remotePayment) return false;
  if (localPayment.provider !== "yookassa") return false;
  if (localPayment.status !== "pending") return false;
  if (remotePayment.status !== "succeeded" || remotePayment.paid !== true) return false;
  if (remotePayment.metadata?.paymentId !== localPayment.id) return false;
  if (remotePayment.metadata?.userId !== localPayment.userId) return false;
  if (localPayment.providerPaymentId && remotePayment.id !== localPayment.providerPaymentId) return false;
  if (remotePayment.amount?.currency !== "RUB") return false;
  return amountToKopecks(remotePayment.amount?.value) === amountToKopecks(localPayment.amount);
}

function applyTBankPaymentState({ env, store, localPayment, remotePayment }) {
  const status = String(remotePayment.Status || "").toUpperCase();
  store.updatePayment(localPayment.id, {
    providerStatus: status,
    providerCheckedAt: new Date().toISOString()
  });

  if (status === "CONFIRMED") {
    if (!shouldGrantAccessOnPaymentSuccess(env)) {
      return store.updatePayment(localPayment.id, {
        status: "test_confirmed",
        paidAt: null,
        testConfirmedAt: new Date().toISOString(),
        cancelReason: "test-confirmed-not-saved"
      });
    }

    return store.markPaymentPaid(localPayment.id, String(remotePayment.PaymentId || ""));
  }

  if (["CANCELED", "DEADLINE_EXPIRED", "REJECTED", "REVERSED"].includes(status)) {
    return store.markPaymentCanceled(localPayment.id, `tbank-${status.toLowerCase()}`);
  }

  return store.getPayment(localPayment.id);
}

function createTBankToken(payload, password) {
  const tokenPayload = {
    Password: password
  };

  for (const [key, value] of Object.entries(payload || {})) {
    if (key === "Token" || value === undefined || value === null || typeof value === "object") continue;
    tokenPayload[key] = value;
  }

  const signSource = Object.keys(tokenPayload)
    .sort()
    .map((key) => String(tokenPayload[key]))
    .join("");

  return crypto.createHash("sha256").update(signSource).digest("hex");
}

function readTBankData(payload) {
  const data = payload?.DATA || payload?.Data;
  if (!data || typeof data === "object") return data || null;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function buildTBankReceipt(env, user, payment, amount) {
  return {
    Email: user.email,
    Taxation: env.TBANK_TAXATION || "usn_income",
    Items: [
      {
        Name: "Участие в Live to see it",
        Price: amount,
        Quantity: 1,
        Amount: amount,
        Tax: env.TBANK_VAT || "none",
        PaymentMethod: "full_prepayment",
        PaymentObject: "service"
      }
    ]
  };
}

function shouldSendTBankReceipt(env) {
  return env.TBANK_SEND_RECEIPT !== "false";
}

function tbankApiBaseUrl(env) {
  return (env.TBANK_API_BASE_URL || "https://securepay.tinkoff.ru/v2").replace(/\/+$/, "");
}

function shouldGrantAccessOnPaymentSuccess(env) {
  return env.PAYMENT_GRANT_ACCESS_ON_SUCCESS !== "false";
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { Success: false, Message: text };
  }
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null));
}

function normalizeProvider(provider) {
  const normalized = String(provider || "mock").trim().toLowerCase();
  return normalized === "tinkoff" ? "tbank" : normalized;
}

function providerNotConfigured(prefix) {
  const error = new Error(`${prefix}_NOT_CONFIGURED`);
  error.status = 500;
  return error;
}

function formatRubAmount(amount) {
  return (Math.round(Number(amount) * 100) / 100).toFixed(2);
}

function amountToKopecks(value) {
  return Math.round(Number(value) * 100);
}
