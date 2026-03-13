require("dotenv").config();
const { Telegraf, Markup, session } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN fehlt in der .env");
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());

// ================= CONFIG =================

const CHANNELS = {
  Fitness: -1003710017996,
  Premium: -1002309468751,
  Nutrition: -1002273059833,
};

const TIERS = {
  "25": { stars: 1250, euros: 25 },
  "50": { stars: 2500, euros: 50 },
  "100": { stars: 5000, euros: 100 },
  "150": { stars: 7500, euros: 150 },
};

// ================= FLOW STATE =================

function resetFlow(ctx) {
  ctx.session.flow = {
    step: "idle",
    channelName: null,
    channelId: null,
    tierKey: null,
    tier: null,
    mediaType: null,
  };
}

function getFlow(ctx) {
  if (!ctx.session.flow) {
    resetFlow(ctx);
  }
  return ctx.session.flow;
}

// ================= KEYBOARDS =================

function channelsKeyboard() {
  const rows = Object.keys(CHANNELS).map((name) => [
    Markup.button.callback(name, `channel:${name}`),
  ]);

  rows.push([Markup.button.callback("Abbrechen", "cancel")]);

  return Markup.inlineKeyboard(rows);
}

function tiersKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("25€ / 1250 ⭐", "tier:25"),
      Markup.button.callback("50€ / 2500 ⭐", "tier:50"),
    ],
    [
      Markup.button.callback("100€ / 5000 ⭐", "tier:100"),
      Markup.button.callback("150€ / 7500 ⭐", "tier:150"),
    ],
    [
      Markup.button.callback("← Zurück", "back:channels"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);
}

function mediaChoiceKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("Bild", "media:photo"),
      Markup.button.callback("Video", "media:video"),
    ],
    [Markup.button.callback("Kein Medium", "media:none")],
    [
      Markup.button.callback("← Zurück", "back:tiers"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);
}

function waitingUploadKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("← Zurück", "back:media-choice"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);
}

// ================= UI HELPERS =================

async function safeEditOrReply(ctx, text, extra = {}) {
  try {
    if (ctx.callbackQuery?.message) {
      return await ctx.editMessageText(text, extra);
    }
  } catch (error) {
    // Fallback auf reply
  }

  return await ctx.reply(text, extra);
}

async function showChannels(ctx) {
  const flow = getFlow(ctx);
  flow.step = "choose_channel";

  const list = Object.keys(CHANNELS)
    .map((name) => `• ${name}`)
    .join("\n");

  await safeEditOrReply(
    ctx,
    `Wähle die Gruppe / den Kanal aus:\n\n${list}`,
    channelsKeyboard()
  );
}

async function showTiers(ctx) {
  const flow = getFlow(ctx);

  if (!flow.channelId || !flow.channelName) {
    return showChannels(ctx);
  }

  flow.step = "choose_tier";

  await safeEditOrReply(
    ctx,
    `Ziel: ${flow.channelName}\n\nWähle jetzt die Sterne / den Preis:`,
    tiersKeyboard()
  );
}

async function showMediaChoice(ctx) {
  const flow = getFlow(ctx);

  if (!flow.channelId || !flow.channelName || !flow.tierKey || !flow.tier) {
    return showTiers(ctx);
  }

  flow.step = "choose_media";

  await safeEditOrReply(
    ctx,
    `Ziel: ${flow.channelName}\nPreis: ${flow.tier.euros}€ / ${flow.tier.stars} ⭐\n\nWillst du ein Bild, ein Video oder kein Medium senden?`,
    mediaChoiceKeyboard()
  );
}

async function askForUpload(ctx, mediaType) {
  const flow = getFlow(ctx);
  flow.step = "wait_media";
  flow.mediaType = mediaType;

  const text =
    mediaType === "photo"
      ? `Sende jetzt bitte ein Bild.\n\nZiel: ${flow.channelName}\nPreis: ${flow.tier.euros}€ / ${flow.tier.stars} ⭐`
      : `Sende jetzt bitte ein Video.\n\nZiel: ${flow.channelName}\nPreis: ${flow.tier.euros}€ / ${flow.tier.stars} ⭐`;

  await safeEditOrReply(ctx, text, waitingUploadKeyboard());
}

// ================= TELEGRAM STARS / INVOICE =================

async function sendStarsInvoice({
  chatId,
  channelName,
  tierKey,
  mediaType = "none",
}) {
  const tier = TIERS[tierKey];

  const title = `${tier.stars} ⭐`;
  const description = `Freischalten für ${tier.euros}€ / ${tier.stars} Stars`;

  // Für digitale Güter mit Stars:
  // - currency = "XTR"
  // - provider_token leer/weg
  // - genau die Star-Anzahl als amount
  return bot.telegram.sendInvoice(
    chatId,
    title,
    description,
    JSON.stringify({
      channelName,
      tierKey,
      stars: tier.stars,
      euros: tier.euros,
      mediaType,
      createdAt: Date.now(),
    }),
    undefined,
    "XTR",
    [
      {
        label: title,
        amount: tier.stars,
      },
    ]
  );
}

// ================= START / COMMANDS =================

bot.start(async (ctx) => {
  resetFlow(ctx);
  await showChannels(ctx);
});

bot.hears(/^start$/i, async (ctx) => {
  resetFlow(ctx);
  await showChannels(ctx);
});

bot.command("cancel", async (ctx) => {
  resetFlow(ctx);
  await ctx.reply("Vorgang abgebrochen.");
});

bot.command("chatid", async (ctx) => {
  await ctx.reply(
    `Chat-ID: ${ctx.chat.id}\nTyp: ${ctx.chat.type}\nTitel: ${ctx.chat.title || "-"}`
  );
});

// ================= CALLBACKS =================

bot.action("cancel", async (ctx) => {
  await ctx.answerCbQuery();
  resetFlow(ctx);
  await safeEditOrReply(ctx, "Vorgang abgebrochen.");
});

bot.action("back:channels", async (ctx) => {
  await ctx.answerCbQuery();
  await showChannels(ctx);
});

bot.action("back:tiers", async (ctx) => {
  await ctx.answerCbQuery();
  await showTiers(ctx);
});

bot.action("back:media-choice", async (ctx) => {
  await ctx.answerCbQuery();
  await showMediaChoice(ctx);
});

bot.action(/^channel:(.+)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const flow = getFlow(ctx);
  const channelName = ctx.match[1];

  if (!(channelName in CHANNELS)) {
    resetFlow(ctx);
    return safeEditOrReply(ctx, "Unbekannte Gruppe / unbekannter Kanal.");
  }

  flow.channelName = channelName;
  flow.channelId = CHANNELS[channelName];
  flow.tierKey = null;
  flow.tier = null;
  flow.mediaType = null;

  await showTiers(ctx);
});

bot.action(/^tier:(25|50|100|150)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const flow = getFlow(ctx);
  const tierKey = ctx.match[1];

  if (!flow.channelId || !flow.channelName) {
    resetFlow(ctx);
    return safeEditOrReply(ctx, "Bitte starte neu und wähle zuerst eine Gruppe.");
  }

  if (!(tierKey in TIERS)) {
    return safeEditOrReply(ctx, "Ungültiger Preis.");
  }

  flow.tierKey = tierKey;
  flow.tier = TIERS[tierKey];
  flow.mediaType = null;

  await showMediaChoice(ctx);
});

bot.action(/^media:(photo|video|none)$/, async (ctx) => {
  await ctx.answerCbQuery();

  const flow = getFlow(ctx);
  const mediaType = ctx.match[1];

  if (!flow.channelId || !flow.channelName || !flow.tierKey || !flow.tier) {
    resetFlow(ctx);
    return safeEditOrReply(ctx, "Bitte starte neu. Auswahl unvollständig.");
  }

  if (mediaType === "none") {
    try {
      await sendStarsInvoice({
        chatId: flow.channelId,
        channelName: flow.channelName,
        tierKey: flow.tierKey,
        mediaType: "none",
      });

      const confirmation =
        `✅ Erfolgreich gesendet.\n\n` +
        `Ziel: ${flow.channelName}\n` +
        `Preis: ${flow.tier.euros}€ / ${flow.tier.stars} ⭐\n` +
        `Medium: keines\n\n` +
        `Die Kaufmöglichkeit läuft über die separate Invoice-Nachricht.`;

      resetFlow(ctx);
      return safeEditOrReply(ctx, confirmation);
    } catch (error) {
      console.error("Invoice-Fehler:", error);
      resetFlow(ctx);
      return safeEditOrReply(
        ctx,
        "❌ Fehler beim Senden der Stars-Invoice.\n\nPrüfe:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- XTR/Stars ist korrekt eingerichtet"
      );
    }
  }

  await askForUpload(ctx, mediaType);
});

// ================= MEDIA EMPFANG =================

bot.on("photo", async (ctx) => {
  const flow = getFlow(ctx);

  if (flow.step !== "wait_media") return;

  if (flow.mediaType !== "photo") {
    return ctx.reply(
      "Du hast Video gewählt. Bitte sende ein Video.",
      waitingUploadKeyboard()
    );
  }

  try {
    const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
    if (!photo) {
      return ctx.reply("Kein Bild gefunden.", waitingUploadKeyboard());
    }

    const caption = ctx.message.caption || "";

    await bot.telegram.sendPhoto(flow.channelId, photo.file_id, { caption });

    await sendStarsInvoice({
      chatId: flow.channelId,
      channelName: flow.channelName,
      tierKey: flow.tierKey,
      mediaType: "photo",
    });

    await ctx.reply(
      `✅ Erfolgreich gesendet.\n\nZiel: ${flow.channelName}\nPreis: ${flow.tier.euros}€ / ${flow.tier.stars} ⭐\nMedium: Bild\n\nDie Kaufmöglichkeit steht in der nächsten Invoice-Nachricht.`
    );

    resetFlow(ctx);
  } catch (error) {
    console.error("Foto-Fehler:", error);
    resetFlow(ctx);
    await ctx.reply(
      "❌ Fehler beim Senden.\n\nPrüfe:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- Bot darf Medien senden\n- XTR/Stars ist korrekt eingerichtet"
    );
  }
});

bot.on("video", async (ctx) => {
  const flow = getFlow(ctx);

  if (flow.step !== "wait_media") return;

  if (flow.mediaType !== "video") {
    return ctx.reply(
      "Du hast Bild gewählt. Bitte sende ein Bild.",
      waitingUploadKeyboard()
    );
  }

  try {
    const video = ctx.message.video;
    if (!video) {
      return ctx.reply("Kein Video gefunden.", waitingUploadKeyboard());
    }

    const caption = ctx.message.caption || "";

    await bot.telegram.sendVideo(flow.channelId, video.file_id, { caption });

    await sendStarsInvoice({
      chatId: flow.channelId,
      channelName: flow.channelName,
      tierKey: flow.tierKey,
      mediaType: "video",
    });

    await ctx.reply(
      `✅ Erfolgreich gesendet.\n\nZiel: ${flow.channelName}\nPreis: ${flow.tier.euros}€ / ${flow.tier.stars} ⭐\nMedium: Video\n\nDie Kaufmöglichkeit steht in der nächsten Invoice-Nachricht.`
    );

    resetFlow(ctx);
  } catch (error) {
    console.error("Video-Fehler:", error);
    resetFlow(ctx);
    await ctx.reply(
      "❌ Fehler beim Senden.\n\nPrüfe:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- Bot darf Medien senden\n- XTR/Stars ist korrekt eingerichtet"
    );
  }
});

// Falsche Eingaben während Upload
bot.on("message", async (ctx, next) => {
  const flow = getFlow(ctx);

  if (flow.step === "wait_media") {
    return ctx.reply(
      flow.mediaType === "photo"
        ? "Bitte sende jetzt ein Bild oder nutze Zurück/Abbrechen."
        : "Bitte sende jetzt ein Video oder nutze Zurück/Abbrechen.",
      waitingUploadKeyboard()
    );
  }

  return next();
});

// ================= PAYMENT EVENTS =================

// Telegram verlangt, dass pre_checkout_query beantwortet wird
bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (error) {
    console.error("PreCheckout-Fehler:", error);
  }
});

// Erfolgreiche Zahlung
bot.on("successful_payment", async (ctx) => {
  const payment = ctx.message.successful_payment;

  await ctx.reply(
    `✅ Zahlung erfolgreich.\n\n` +
      `Währung: ${payment.currency}\n` +
      `Betrag: ${payment.total_amount}\n` +
      `Charge-ID: ${payment.telegram_payment_charge_id}`
  );
});

// ================= ERROR HANDLING =================

bot.catch((err, ctx) => {
  console.error("Bot-Fehler:", err);

  if (ctx?.reply) {
    ctx.reply("❌ Interner Fehler. Bitte versuche es erneut.").catch(() => {});
  }
});

// ================= START BOT =================

bot.launch();
console.log("Bot läuft...");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
