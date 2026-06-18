export function createPaymentGateway({ env, store }) {
  const provider = env.PAYMENT_PROVIDER || "mock";

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

    if (provider === "yookassa" && env.YOOKASSA_SHOP_ID && env.YOOKASSA_SECRET_KEY) {
      return startYooKassaPayment({ env, store, user, payment, origin });
    }

    const confirmationUrl = `${origin}/api/payments/mock/${payment.id}/complete`;
    store.updatePayment(payment.id, { confirmationUrl });
    return {
      status: "pending",
      provider: "mock",
      paymentId: payment.id,
      confirmationUrl
    };
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

  return { startPayment, handleYooKassaWebhook };
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

function formatRubAmount(amount) {
  return (Math.round(Number(amount) * 100) / 100).toFixed(2);
}

function amountToKopecks(value) {
  return Math.round(Number(value) * 100);
}
