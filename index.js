require("dotenv").config();
const express = require("express");
const fs = require("fs");
const path = require("path");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
const RAILWAY_STATIC_URL = process.env.RAILWAY_STATIC_URL;
const PORT = Number(process.env.PORT || 3000);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN fehlt");
if (!RAILWAY_STATIC_URL) throw new Error("RAILWAY_STATIC_URL fehlt");

const bot = new Telegraf(BOT_TOKEN);
const app = express();

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

// ================= STATE =================

const DATA_DIR = path.join(process.cwd(), "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadState() {
  try {
    ensureDir();
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8") || "{}");
  } catch {
    return {};
  }
}

let state = loadState();

function saveState() {
  try {
    ensureDir();
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
  } catch (e) {
    console.error("State speichern fehlgeschlagen:", e);
  }
}

function emptyUser() {
  return {
    step: "idle",
    channelName: null,
    channelId: null,
    tierKey: null,
    mediaType: null,
  };
}

function getUser(id) {
  id = String(id);
  if (!state[id]) {
    state[id] = emptyUser();
    saveState();
  }
  return state[id];
}

function setUser(id, patch) {
  id = String(id);
  state[id] = { ...getUser(id), ...patch };
  saveState();
  return state[id];
}

function resetUser(id) {
  state[String(id)] = emptyUser();
  saveState();
}

// ================= UI =================

const kbChannels = () =>
  Markup.inlineKeyboard([
    ...Object.keys(CHANNELS).map((name) => [Markup.button.callback(name, `c:${name}`)]),
    [Markup.button.callback("Abbrechen", "cancel")],
  ]);

const kbTiers = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("25€ / 1250 ⭐", "t:25"),
      Markup.button.callback("50€ / 2500 ⭐", "t:50"),
    ],
    [
      Markup.button.callback("100€ / 5000 ⭐", "t:100"),
      Markup.button.callback("150€ / 7500 ⭐", "t:150"),
    ],
    [
      Markup.button.callback("← Zurück", "back:channels"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);

const kbMedia = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("Bild", "m:photo"),
      Markup.button.callback("Video", "m:video"),
    ],
    [Markup.button.callback("Kein Medium", "m:none")],
    [
      Markup.button.callback("← Zurück", "back:tiers"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);

const kbWait = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("← Zurück", "back:media"),
      Markup.button.callback("Abbrechen", "cancel"),
    ],
  ]);

async function answerCb(ctx) {
  try {
    if (ctx.callbackQuery) await ctx.answerCbQuery();
  } catch {}
}

async function editOrReply(ctx, text, keyboard) {
  const extra = keyboard ? { reply_markup: keyboard.reply_markup } : {};
  try {
    if (ctx.callbackQuery?.message) return await ctx.editMessageText(text, extra);
  } catch {}
  return ctx.reply(text, extra);
}

async function showChannels(ctx, userId) {
  setUser(userId, { step: "choose_channel" });
  const list = Object.keys(CHANNELS).map((x) => `• ${x}`).join("\n");
  await editOrReply(ctx, `Wähle die Gruppe / den Kanal aus:\n\n${list}`, kbChannels());
}

async function showTiers(ctx, userId) {
  const u = getUser(userId);
  if (!u.channelId) return showChannels(ctx, userId);
  setUser(userId, { step: "choose_tier" });
  await editOrReply(ctx, `Ziel: ${u.channelName}\n\nWähle jetzt die Sterne / den Preis:`, kbTiers());
}

async function showMedia(ctx, userId) {
  const u = getUser(userId);
  if (!u.channelId || !u.tierKey) return showTiers(ctx, userId);
  setUser(userId, { step: "choose_media" });
  const tier = TIERS[u.tierKey];
  await editOrReply(
    ctx,
    `Ziel: ${u.channelName}\nPreis: ${tier.euros}€ / ${tier.stars} ⭐\n\nWillst du ein Bild, ein Video oder kein Medium senden?`,
    kbMedia()
  );
}

async function askUpload(ctx, userId, mediaType) {
  const u = setUser(userId, { step: "wait_media", mediaType });
  const tier = TIERS[u.tierKey];
  await editOrReply(
    ctx,
    mediaType === "photo"
      ? `Sende jetzt bitte ein Bild.\n\nZiel: ${u.channelName}\nPreis: ${tier.euros}€ / ${tier.stars} ⭐`
      : `Sende jetzt bitte ein Video.\n\nZiel: ${u.channelName}\nPreis: ${tier.euros}€ / ${tier.stars} ⭐`,
    kbWait()
  );
}

// ================= TELEGRAM HELPERS =================

async function sendInvoice(chatId, channelName, tierKey, mediaType = "none") {
  const tier = TIERS[tierKey];
  return bot.telegram.callApi("sendInvoice", {
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
    prices: [{ label: `${tier.stars} ⭐`, amount: tier.stars }],
  });
}

async function sendMedia(kind, chatId, fileId, caption = "") {
  return bot.telegram.callApi(kind === "photo" ? "sendPhoto" : "sendVideo", {
    chat_id: chatId,
    [kind]: fileId,
    caption,
  });
}

// ================= FLOW =================

async function startFlow(ctx) {
  resetUser(ctx.from.id);
  await showChannels(ctx, ctx.from.id);
}

bot.start(startFlow);
bot.hears(/^start$/i, startFlow);

bot.command("cancel", async (ctx) => {
  resetUser(ctx.from.id);
  await ctx.reply("Vorgang abgebrochen.");
});

bot.command("chatid", async (ctx) => {
  await ctx.reply(`Chat-ID: ${ctx.chat.id}\nTyp: ${ctx.chat.type}\nTitel: ${ctx.chat.title || "-"}`);
});

bot.action("cancel", async (ctx) => {
  await answerCb(ctx);
  resetUser(ctx.from.id);
  await editOrReply(ctx, "Vorgang abgebrochen.");
});

bot.action("back:channels", async (ctx) => {
  await answerCb(ctx);
  await showChannels(ctx, ctx.from.id);
});

bot.action("back:tiers", async (ctx) => {
  await answerCb(ctx);
  await showTiers(ctx, ctx.from.id);
});

bot.action("back:media", async (ctx) => {
  await answerCb(ctx);
  await showMedia(ctx, ctx.from.id);
});

bot.action(/^c:(.+)$/, async (ctx) => {
  await answerCb(ctx);
  const name = ctx.match[1];
  if (!(name in CHANNELS)) return editOrReply(ctx, "Unbekannte Gruppe / unbekannter Kanal.");
  setUser(ctx.from.id, {
    channelName: name,
    channelId: CHANNELS[name],
    tierKey: null,
    mediaType: null,
  });
  await showTiers(ctx, ctx.from.id);
});

bot.action(/^t:(25|50|100|150)$/, async (ctx) => {
  await answerCb(ctx);
  const u = getUser(ctx.from.id);
  if (!u.channelId) {
    resetUser(ctx.from.id);
    return editOrReply(ctx, "Bitte starte neu und wähle zuerst eine Gruppe.");
  }
  setUser(ctx.from.id, { tierKey: ctx.match[1], mediaType: null });
  await showMedia(ctx, ctx.from.id);
});

bot.action(/^m:(photo|video|none)$/, async (ctx) => {
  await answerCb(ctx);
  const u = getUser(ctx.from.id);
  if (!u.channelId || !u.tierKey) {
    resetUser(ctx.from.id);
    return editOrReply(ctx, "Bitte starte neu. Auswahl unvollständig.");
  }

  if (ctx.match[1] === "none") {
    try {
      const tier = TIERS[u.tierKey];
      await sendInvoice(u.channelId, u.channelName, u.tierKey, "none");
      resetUser(ctx.from.id);
      return editOrReply(
        ctx,
        `✅ Erfolgreich gesendet.\n\nZiel: ${u.channelName}\nPreis: ${tier.euros}€ / ${tier.stars} ⭐\nMedium: keines`
      );
    } catch (e) {
      console.error("Invoice-Fehler:", e);
      resetUser(ctx.from.id);
      return editOrReply(ctx, "❌ Fehler beim Senden der Stars-Invoice.");
    }
  }

  await askUpload(ctx, ctx.from.id, ctx.match[1]);
});

// ================= MEDIA =================

async function handleMedia(ctx, kind) {
  const u = getUser(ctx.from.id);
  if (u.step !== "wait_media") return;
  if (u.mediaType !== kind) {
    return ctx.reply(
      kind === "photo"
        ? "Du hast Video gewählt. Bitte sende ein Video."
        : "Du hast Bild gewählt. Bitte sende ein Bild.",
      { reply_markup: kbWait().reply_markup }
    );
  }

  try {
    const tier = TIERS[u.tierKey];
    const fileId =
      kind === "photo"
        ? ctx.message.photo?.[ctx.message.photo.length - 1]?.file_id
        : ctx.message.video?.file_id;

    if (!fileId) return ctx.reply(kind === "photo" ? "Kein Bild gefunden." : "Kein Video gefunden.");

    await sendMedia(kind, u.channelId, fileId, ctx.message.caption || "");
    await sendInvoice(u.channelId, u.channelName, u.tierKey, kind);
    resetUser(ctx.from.id);

    await ctx.reply(
      `✅ Erfolgreich gesendet.\n\nZiel: ${u.channelName}\nPreis: ${tier.euros}€ / ${tier.stars} ⭐\nMedium: ${
        kind === "photo" ? "Bild" : "Video"
      }`
    );
  } catch (e) {
    console.error(`${kind}-Fehler:`, e);
    resetUser(ctx.from.id);
    await ctx.reply("❌ Fehler beim Senden.");
  }
}

bot.on("photo", (ctx) => handleMedia(ctx, "photo"));
bot.on("video", (ctx) => handleMedia(ctx, "video"));

bot.on("message", async (ctx, next) => {
  const u = getUser(ctx.from?.id);
  if (u.step === "wait_media") {
    return ctx.reply(
      u.mediaType === "photo"
        ? "Bitte sende jetzt ein Bild oder nutze Zurück/Abbrechen."
        : "Bitte sende jetzt ein Video oder nutze Zurück/Abbrechen.",
      { reply_markup: kbWait().reply_markup }
    );
  }
  return next();
});

// ================= PAYMENTS =================

bot.on("pre_checkout_query", async (ctx) => {
  try {
    await ctx.answerPreCheckoutQuery(true);
  } catch (e) {
    console.error("PreCheckout-Fehler:", e);
  }
});

bot.on("successful_payment", async (ctx) => {
  try {
    const p = ctx.message.successful_payment;
    await ctx.reply(
      `✅ Zahlung erfolgreich.\n\nWährung: ${p.currency}\nBetrag: ${p.total_amount}\nCharge-ID: ${p.telegram_payment_charge_id}`
    );
  } catch (e) {
    console.error("Successful-Payment-Fehler:", e);
  }
});

bot.catch((e) => console.error("BOT ERROR:", e));

// ================= RAILWAY =================

app.get("/", (_req, res) => res.status(200).send("Bot läuft"));
app.get("/health", (_req, res) =>
  res.status(200).json({ ok: true, usersInState: Object.keys(state).length, uptime: process.uptime() })
);

const cleanHost = RAILWAY_STATIC_URL.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const webhookPath = `/telegram/${BOT_TOKEN}`;
const webhookUrl = `https://${cleanHost}${webhookPath}`;

app.use(webhookPath, bot.webhookCallback(webhookPath));

app.listen(PORT, "0.0.0.0", async () => {
  console.log(`Server läuft auf Port ${PORT}`);
  console.log(`Webhook URL: ${webhookUrl}`);
  try {
    await bot.telegram.setWebhook(webhookUrl);
    console.log("Webhook gesetzt");
  } catch (e) {
    console.error("Webhook-Fehler:", e);
  }
});

async function shutdown() {
  try {
    saveState();
    await bot.telegram.deleteWebhook();
  } catch {}
  process.exit(0);
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
