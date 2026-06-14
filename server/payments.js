export function createPaymentGateway({ env, store }) {
  const provider = env.PAYMENT_PROVIDER || "mock";

  async function startPayment(user, origin) {
    const payment = store.createPayment(user.id, provider);

    if (payment.status === "paid") {
      return { status: "paid", confirmationUrl: null };
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
    const paymentId = payload?.object?.metadata?.paymentId;
    const event = payload?.event;
    if (event === "payment.succeeded" && paymentId) {
      store.markPaymentPaid(paymentId);
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
        value: `${payment.amount}.00`,
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
