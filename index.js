require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN fehlt in der .env");
}

const bot = new Telegraf(BOT_TOKEN);

// ================= CONFIG =================

const CHANNELS = {
  Private: -1003710017996,
 Extreme: -1002309468751,
  PrivateVideos: -1002273059833,
};

const TIERS = {
  "25": { stars: 1250, euros: 25 },
  "50": { stars: 2500, euros: 50 },
  "100": { stars: 5000, euros: 100 },
  "150": { stars: 7500, euros: 150 },
};

// ================= SIMPLE USER STATE =================

const userState = new Map();

function resetUser(userId) {
  userState.set(userId, {
    step: "idle",
    channelName: null,
    channelId: null,
    tierKey: null,
    tier: null,
    mediaType: null,
  });
}

function getUser(userId) {
  if (!userState.has(userId)) {
    resetUser(userId);
  }
  return userState.get(userId);
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

function mediaKeyboard() {
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

function waitUploadKeyboard() {
  return Markup.inlineKeyboard([
    [
      Markup.button.callback("← Zurück", "back:media"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);
}

// ================= UI HELPERS =================

async function safeAnswerCb(ctx) {
  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
    }
  } catch (_) {}
}

async function safeEditOrReply(ctx, text, markup) {
  const extra = markup ? { reply_markup: markup.reply_markup } : {};

  if (ctx.callbackQuery?.message) {
    try {
      return await ctx.editMessageText(text, extra);
    } catch (_) {}
  }

  return await ctx.reply(text, extra);
}

async function showChannels(ctx, userId) {
  const state = getUser(userId);
  state.step = "choose_channel";

  const list = Object.keys(CHANNELS)
    .map((name) => `• ${name}`)
    .join("\n");

  await safeEditOrReply(
    ctx,
    `Wähle die Gruppe / den Kanal aus:\n\n${list}`,
    channelsKeyboard()
  );
}

async function showTiers(ctx, userId) {
  const state = getUser(userId);

  if (!state.channelId || !state.channelName) {
    return showChannels(ctx, userId);
  }

  state.step = "choose_tier";

  await safeEditOrReply(
    ctx,
    `Ziel: ${state.channelName}\n\nWähle jetzt die Sterne / den Preis:`,
    tiersKeyboard()
  );
}

async function showMedia(ctx, userId) {
  const state = getUser(userId);

  if (!state.channelId || !state.tier) {
    return showTiers(ctx, userId);
  }

  state.step = "choose_media";

  await safeEditOrReply(
    ctx,
    `Ziel: ${state.channelName}\nPreis: ${state.tier.euros}€ / ${state.tier.stars} ⭐\n\nWillst du ein Bild, ein Video oder kein Medium senden?`,
    mediaKeyboard()
  );
}

async function askForUpload(ctx, userId, mediaType) {
  const state = getUser(userId);
  state.step = "wait_media";
  state.mediaType = mediaType;

  const text =
    mediaType === "photo"
      ? `Sende jetzt bitte ein Bild.\n\nZiel: ${state.channelName}\nPreis: ${state.tier.euros}€ / ${state.tier.stars} ⭐`
      : `Sende jetzt bitte ein Video.\n\nZiel: ${state.channelName}\nPreis: ${state.tier.euros}€ / ${state.tier.stars} ⭐`;

  await safeEditOrReply(ctx, text, waitUploadKeyboard());
}

// ================= TELEGRAM API HELPERS =================

async function sendStarsInvoice({ chatId, channelName, tierKey, mediaType = "none" }) {
  const tier = TIERS[tierKey];

  return await bot.telegram.callApi("sendInvoice", {
    chat_id: chatId,
    title: `${tier.stars} ⭐`,
    description: `Freischalten für ${tier.euros}€ / ${tier.stars} Stars`,
    payload: JSON.stringify({
      channelName,
      tierKey,
      mediaType,
      stars: tier.stars,
      euros: tier.euros,
      createdAt: Date.now(),
    }),
    currency: "XTR",
    prices: [
      {
        label: `${tier.stars} ⭐`,
        amount: tier.stars,
      },
    ],
  });
}

async function sendPhoto(chatId, fileId, caption = "") {
  return await bot.telegram.callApi("sendPhoto", {
    chat_id: chatId,
    photo: fileId,
    caption,
  });
}

async function sendVideo(chatId, fileId, caption = "") {
  return await bot.telegram.callApi("sendVideo", {
    chat_id: chatId,
    video: fileId,
    caption,
  });
}

// ================= START =================

async function startFlow(ctx) {
  const userId = ctx.from.id;
  resetUser(userId);
  await showChannels(ctx, userId);
}

bot.start(async (ctx) => {
  await startFlow(ctx);
});

bot.hears(/^start$/i, async (ctx) => {
  await startFlow(ctx);
});

bot.command("cancel", async (ctx) => {
  resetUser(ctx.from.id);
  await ctx.reply("Vorgang abgebrochen.");
});

bot.command("chatid", async (ctx) => {
  await ctx.reply(
    `Chat-ID: ${ctx.chat.id}\nTyp: ${ctx.chat.type}\nTitel: ${ctx.chat.title || "-"}`
  );
});

// ================= CALLBACKS =================

bot.action("cancel", async (ctx) => {
  await safeAnswerCb(ctx);
  resetUser(ctx.from.id);
  await safeEditOrReply(ctx, "Vorgang abgebrochen.");
});

bot.action("back:channels", async (ctx) => {
  await safeAnswerCb(ctx);
  await showChannels(ctx, ctx.from.id);
});

bot.action("back:tiers", async (ctx) => {
  await safeAnswerCb(ctx);
  await showTiers(ctx, ctx.from.id);
});

bot.action("back:media", async (ctx) => {
  await safeAnswerCb(ctx);
  await showMedia(ctx, ctx.from.id);
});

bot.action(/^channel:(.+)$/, async (ctx) => {
  await safeAnswerCb(ctx);

  const userId = ctx.from.id;
  const state = getUser(userId);
  const channelName = ctx.match[1];

  if (!(channelName in CHANNELS)) {
    resetUser(userId);
    return safeEditOrReply(ctx, "Unbekannte Gruppe / unbekannter Kanal.");
  }

  state.channelName = channelName;
  state.channelId = CHANNELS[channelName];
  state.tierKey = null;
  state.tier = null;
  state.mediaType = null;

  await showTiers(ctx, userId);
});

bot.action(/^tier:(25|50|100|150)$/, async (ctx) => {
  await safeAnswerCb(ctx);

  const userId = ctx.from.id;
  const state = getUser(userId);
  const tierKey = ctx.match[1];

  if (!state.channelId) {
    resetUser(userId);
    return safeEditOrReply(ctx, "Bitte starte neu und wähle zuerst eine Gruppe.");
  }

  state.tierKey = tierKey;
  state.tier = TIERS[tierKey];
  state.mediaType = null;

  await showMedia(ctx, userId);
});

bot.action(/^media:(photo|video|none)$/, async (ctx) => {
  await safeAnswerCb(ctx);

  const userId = ctx.from.id;
  const state = getUser(userId);
  const mediaType = ctx.match[1];

  if (!state.channelId || !state.channelName || !state.tierKey || !state.tier) {
    resetUser(userId);
    return safeEditOrReply(ctx, "Bitte starte neu. Auswahl unvollständig.");
  }

  if (mediaType === "none") {
    try {
      await sendStarsInvoice({
        chatId: state.channelId,
        channelName: state.channelName,
        tierKey: state.tierKey,
        mediaType: "none",
      });

      resetUser(userId);

      return await safeEditOrReply(
        ctx,
        `✅ Erfolgreich gesendet.\n\nZiel: ${state.channelName}\nPreis: ${state.tier.euros}€ / ${state.tier.stars} ⭐\nMedium: keines\n\nDie Kaufmöglichkeit erscheint in der separaten Invoice-Nachricht.`
      );
    } catch (error) {
      console.error("Invoice-Fehler:", error);
      resetUser(userId);
      return await safeEditOrReply(
        ctx,
        "❌ Fehler beim Senden der Stars-Invoice.\n\nPrüfe:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- Stars/XTR ist korrekt eingerichtet"
      );
    }
  }

  await askForUpload(ctx, userId, mediaType);
});

// ================= MEDIA RECEIVE =================

bot.on("photo", async (ctx) => {
  const userId = ctx.from.id;
  const state = getUser(userId);

  if (state.step !== "wait_media") return;

  if (state.mediaType !== "photo") {
    return await ctx.reply(
      "Du hast Video gewählt. Bitte sende ein Video.",
      { reply_markup: waitUploadKeyboard().reply_markup }
    );
  }

  try {
    const photo = ctx.message.photo?.[ctx.message.photo.length - 1];
    if (!photo) {
      return await ctx.reply("Kein Bild gefunden.");
    }

    const caption = ctx.message.caption || "";

    await sendPhoto(state.channelId, photo.file_id, caption);

    await sendStarsInvoice({
      chatId: state.channelId,
      channelName: state.channelName,
      tierKey: state.tierKey,
      mediaType: "photo",
    });

    await ctx.reply(
      `✅ Erfolgreich gesendet.\n\nZiel: ${state.channelName}\nPreis: ${state.tier.euros}€ / ${state.tier.stars} ⭐\nMedium: Bild\n\nDie Kaufmöglichkeit steht in der separaten Invoice-Nachricht.`
    );

    resetUser(userId);
  } catch (error) {
    console.error("Foto-Fehler:", error);
    resetUser(userId);
    await ctx.reply(
      "❌ Fehler beim Senden.\n\nPrüfe:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- Bot darf Medien senden\n- Stars/XTR ist korrekt eingerichtet"
    );
  }
});

bot.on("video", async (ctx) => {
  const userId = ctx.from.id;
  const state = getUser(userId);

  if (state.step !== "wait_media") return;

  if (state.mediaType !== "video") {
    return await ctx.reply(
      "Du hast Bild gewählt. Bitte sende ein Bild.",
      { reply_markup: waitUploadKeyboard().reply_markup }
    );
  }

  try {
    const video = ctx.message.video;
    if (!video) {
      return await ctx.reply("Kein Video gefunden.");
    }

    const caption = ctx.message.caption || "";

    await sendVideo(state.channelId, video.file_id, caption);

    await sendStarsInvoice({
      chatId: state.channelId,
      channelName: state.channelName,
      tierKey: state.tierKey,
      mediaType: "video",
    });

    await ctx.reply(
      `✅ Erfolgreich gesendet.\n\nZiel: ${state.channelName}\nPreis: ${state.tier.euros}€ / ${state.tier.stars} ⭐\nMedium: Video\n\nDie Kaufmöglichkeit steht in der separaten Invoice-Nachricht.`
    );

    resetUser(userId);
  } catch (error) {
    console.error("Video-Fehler:", error);
    resetUser(userId);
    await ctx.reply(
      "❌ Fehler beim Senden.\n\nPrüfe:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- Bot darf Medien senden\n- Stars/XTR ist korrekt eingerichtet"
    );
  }
});

// Falsche Eingabe nur dann abfangen, wenn der User gerade im Upload-Schritt ist
bot.on("message", async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return next();

  const state = getUser(userId);

  if (state.step === "wait_media") {
    return await ctx.reply(
      state.mediaType === "photo"
        ? "Bitte sende jetzt ein Bild oder nutze Zurück/Abbrechen."
        : "Bitte sende jetzt ein Video oder nutze Zurück/Abbrechen.",
      { reply_markup: waitUploadKeyboard().reply_markup }
    );
  }

  return next();
});

// ================= PAYMENT EVENTS =================

bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (error) {
    console.error("PreCheckout-Fehler:", error);
  }
});

bot.on("successful_payment", async (ctx) => {
  try {
    const payment = ctx.message.successful_payment;

    await ctx.reply(
      `✅ Zahlung erfolgreich.\n\nWährung: ${payment.currency}\nBetrag: ${payment.total_amount}\nCharge-ID: ${payment.telegram_payment_charge_id}`
    );
  } catch (error) {
    console.error("Successful-Payment-Fehler:", error);
  }
});

// ================= ERROR HANDLING =================

bot.catch((error) => {
  console.error("BOT CRASH / ERROR:", error);
});

// ================= START BOT =================

(async () => {
  try {
    await bot.launch();
    console.log("Bot läuft...");
  } catch (error) {
    console.error("Startfehler:", error);
  }
})();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
