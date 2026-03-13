const TelegramBot = require("node-telegram-bot-api");

// ================= CONFIG =================

const TOKEN = "DEIN_NEUER_BOT_TOKEN_HIER";

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

// ================= BOT =================

const bot = new TelegramBot(TOKEN, { polling: true });

// user state storage
const userState = new Map();

// ================= HELPERS =================

function resetUser(userId) {
  userState.delete(userId);
}

function getUser(userId) {
  if (!userState.has(userId)) {
    userState.set(userId, {});
  }
  return userState.get(userId);
}

function channelKeyboard() {
  const rows = Object.keys(CHANNELS).map((name) => [
    { text: name, callback_data: `channel:${name}` },
  ]);

  rows.push([{ text: "Abbrechen", callback_data: "cancel" }]);

  return {
    inline_keyboard: rows,
  };
}

function tierKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "25€", callback_data: "tier:25" },
        { text: "50€", callback_data: "tier:50" },
      ],
      [
        { text: "100€", callback_data: "tier:100" },
        { text: "150€", callback_data: "tier:150" },
      ],
      [{ text: "Abbrechen", callback_data: "cancel" }],
    ],
  };
}

function mediaKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "Bild", callback_data: "media:photo" },
        { text: "Video", callback_data: "media:video" },
      ],
      [{ text: "Abbrechen", callback_data: "cancel" }],
    ],
  };
}

async function startFlow(chatId, userId) {
  resetUser(userId);

  const channelList = Object.keys(CHANNELS)
    .map((name) => `• ${name}`)
    .join("\n");

  await bot.sendMessage(
    chatId,
    `Ich bin aktuell in diesen 3 Gruppen/Kanälen:\n${channelList}\n\nWähle zuerst aus, wohin gepostet werden soll:`,
    {
      reply_markup: channelKeyboard(),
    }
  );

  const state = getUser(userId);
  state.step = "choose_channel";
}

async function cancelFlow(chatId, userId, messageId = null) {
  resetUser(userId);

  if (messageId) {
    try {
      await bot.editMessageText("Vorgang abgebrochen.", {
        chat_id: chatId,
        message_id: messageId,
      });
      return;
    } catch (e) {
      // fallback below
    }
  }

  await bot.sendMessage(chatId, "Vorgang abgebrochen.");
}

// ================= START / COMMANDS =================

bot.onText(/^\/start$/, async (msg) => {
  await startFlow(msg.chat.id, msg.from.id);
});

bot.onText(/^Start$/i, async (msg) => {
  await startFlow(msg.chat.id, msg.from.id);
});

bot.onText(/^\/cancel$/, async (msg) => {
  await cancelFlow(msg.chat.id, msg.from.id);
});

bot.onText(/^\/chatid$/, async (msg) => {
  await bot.sendMessage(
    msg.chat.id,
    `Chat-ID: ${msg.chat.id}\nTyp: ${msg.chat.type}\nTitel: ${msg.chat.title || "-"}`
  );
});

// ================= CALLBACKS =================

bot.on("callback_query", async (query) => {
  const userId = query.from.id;
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data || "";
  const state = getUser(userId);

  try {
    await bot.answerCallbackQuery(query.id);
  } catch (e) {
    console.error("answerCallbackQuery error:", e.message);
  }

  if (data === "cancel") {
    await cancelFlow(chatId, userId, messageId);
    return;
  }

  // STEP 1: CHANNEL
  if (data.startsWith("channel:")) {
    const channelName = data.split(":")[1]?.trim();

    if (!CHANNELS[channelName]) {
      await bot.editMessageText("Unbekannter Kanal.", {
        chat_id: chatId,
        message_id: messageId,
      });
      resetUser(userId);
      return;
    }

    state.channel_name = channelName;
    state.channel_id = CHANNELS[channelName];
    state.step = "choose_tier";

    await bot.editMessageText(
      `Kanal gewählt: ${channelName}\n\nWähle jetzt die Sterne / den Preis:`,
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: tierKeyboard(),
      }
    );
    return;
  }

  // STEP 2: TIER
  if (data.startsWith("tier:")) {
    const tierKey = data.split(":")[1]?.trim();

    if (!TIERS[tierKey]) {
      await bot.editMessageText("Unbekannter Preis.", {
        chat_id: chatId,
        message_id: messageId,
      });
      resetUser(userId);
      return;
    }

    state.tier_key = tierKey;
    state.step = "choose_media";

    const tier = TIERS[tierKey];

    await bot.editMessageText(
      `Preis gewählt: ${tier.euros}€ / ${tier.stars} Stars\n\nWillst du ein Bild oder ein Video senden?`,
      {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: mediaKeyboard(),
      }
    );
    return;
  }

  // STEP 3: MEDIA TYPE
  if (data.startsWith("media:")) {
    const mediaType = data.split(":")[1]?.trim();

    if (!["photo", "video"].includes(mediaType)) {
      await bot.editMessageText("Ungültiger Medientyp.", {
        chat_id: chatId,
        message_id: messageId,
      });
      resetUser(userId);
      return;
    }

    state.media_type = mediaType;
    state.step = "wait_media";

    const text =
      mediaType === "photo"
        ? "Sende mir jetzt das Bild mit optionaler Caption."
        : "Sende mir jetzt das Video mit optionaler Caption.";

    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
    });
    return;
  }

  await bot.sendMessage(chatId, "Ungültige Auswahl.");
});

// ================= MEDIA RECEIVE =================

bot.on("message", async (msg) => {
  if (!msg.from || !msg.chat) return;

  const userId = msg.from.id;
  const chatId = msg.chat.id;
  const state = userState.get(userId);

  if (!state || state.step !== "wait_media") return;

  try {
    const channelId = state.channel_id;
    const channelName = state.channel_name;
    const tierKey = state.tier_key;
    const mediaType = state.media_type;

    if (!channelId || !channelName || !tierKey || !mediaType) {
      await bot.sendMessage(chatId, "Fehlende Daten. Bitte /start neu senden.");
      resetUser(userId);
      return;
    }

    const caption = msg.caption || "";

    if (mediaType === "photo") {
      if (!msg.photo || msg.photo.length === 0) {
        await bot.sendMessage(chatId, "Bitte sende ein Bild.");
        return;
      }

      const largestPhoto = msg.photo[msg.photo.length - 1];
      const fileId = largestPhoto.file_id;

      await bot.sendPhoto(channelId, fileId, {
        caption,
      });

      await bot.sendMessage(chatId, `✅ Erfolgreich in ${channelName} gepostet.`);
      resetUser(userId);
      return;
    }

    if (mediaType === "video") {
      if (!msg.video) {
        await bot.sendMessage(chatId, "Bitte sende ein Video.");
        return;
      }

      const fileId = msg.video.file_id;

      await bot.sendVideo(channelId, fileId, {
        caption,
      });

      await bot.sendMessage(chatId, `✅ Erfolgreich in ${channelName} gepostet.`);
      resetUser(userId);
      return;
    }
  } catch (e) {
    console.error("Fehler beim Posten:", e);

    await bot.sendMessage(
      chatId,
      "❌ Fehler beim Posten.\n\nPrüfe bitte:\n- Bot ist Admin im Kanal/der Gruppe\n- Chat-ID stimmt\n- Bot darf Medien senden\n- Token ist korrekt"
    );

    resetUser(userId);
  }
});

// ================= ERROR LOGGING =================

bot.on("polling_error", (error) => {
  console.error("Polling-Fehler:", error);
});

console.log("Bot läuft...");
