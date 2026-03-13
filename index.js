import { Telegraf, Markup } from "telegraf";

if (!process.env.BOT_TOKEN) throw new Error("BOT_TOKEN fehlt");

const bot = new Telegraf(process.env.BOT_TOKEN);

/* =========================
   BUTTONS
========================= */
const MAIN_MENU_BUTTON = Markup.button.callback("🏠 Hauptmenü", "MAIN_MENU");

/* =========================
   RANDOM CODE GENERATOR
========================= */
function generateCode(length = 8) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return "SK-" + result;
}

/* =========================
   START / MAIN MENU
========================= */
const showMainMenu = async (ctx, textPrefix = "👋 Willkommen") => {
  const username = ctx.from.first_name || "User";

  await ctx.reply(
    `${textPrefix}, ${username}!\n\nWähle deinen Plan:`,
    Markup.inlineKeyboard([
      [Markup.button.callback("⭐ 1500 Stars – 25 €", "STAR_1500")],
      [Markup.button.callback("⭐ 2500 Stars – 50 €", "STAR_2500")],
      [Markup.button.callback("⭐ 5000 Stars – 100 €", "STAR_5000")],
      [Markup.button.callback("⭐ 7500 Stars – 150 €", "STAR_7500")]
    ])
  );
};

bot.start((ctx) => showMainMenu(ctx));

bot.action("MAIN_MENU", async (ctx) => {
  await ctx.answerCbQuery();
  await showMainMenu(ctx, "🏠 Hauptmenü");
});

/* =========================
   STAR PAYMENTS
========================= */
const STAR_PLANS = {
  STAR_1500: {
    stars: 1500,
    title: "⭐ 1500 Stars",
    amount: 1500,
    label: "1500 Stars"
  },
  STAR_2500: {
    stars: 2500,
    title: "⭐ 2500 Stars",
    amount: 2500,
    label: "2500 Stars"
  },
  STAR_5000: {
    stars: 5000,
    title: "⭐ 5000 Stars",
    amount: 5000,
    label: "5000 Stars"
  },
  STAR_7500: {
    stars: 7500,
    title: "⭐ 7500 Stars",
    amount: 7500,
    label: "7500 Stars"
  }
};

bot.action(/STAR_.+/, async (ctx) => {
  await ctx.answerCbQuery("💳 Zahlung wird vorbereitet...");
  const key = ctx.match[0];
  const plan = STAR_PLANS[key];

  if (!plan) return ctx.reply("❌ Ungültiger Plan");

  await ctx.replyWithInvoice({
    title: plan.title,
    description: `Bezahlung mit ${plan.stars} Telegram-Stars`,
    payload: `STARS_${key}_${ctx.from.id}`,
    provider_token: "DEIN_PROVIDER_TOKEN_HIER",
    currency: "XTR",
    prices: [{ label: plan.label, amount: plan.amount }]
  });
});

/* =========================
   PRE CHECKOUT
========================= */
bot.on("pre_checkout_query", (ctx) => ctx.answerPreCheckoutQuery(true));

/* =========================
   SUCCESSFUL PAYMENT
========================= */
bot.on("successful_payment", async (ctx) => {
  const voucherCode = generateCode();

  await ctx.reply(
    `✅ Zahlung erfolgreich!\n\n` +
    `🎟 Dein Code: ${voucherCode}\n\n` +
    `📩 Bitte sende jetzt deinen Snapchat-Benutzernamen zusammen mit diesem Code an @SkandalGermany6.`
  );
});

/* =========================
   START BOT
========================= */
bot.launch({ dropPendingUpdates: true });
console.log("🤖 BOT GESTARTET");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

/* =========================
   ERROR HANDLER
========================= */
bot.catch((err, ctx) => {
  console.error(`Fehler bei UpdateType ${ctx.updateType}:`, err);
});
