from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, LabeledPrice
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    PreCheckoutQueryHandler,
    filters,
)

# ---------------- CONFIG ----------------

TOKEN = "YOUR_BOT_TOKEN"

CHANNELS = {
    "Fitness": -1001234567890,
    "Premium": -1009876543210,
    "Nutrition": -1001122334455
}

TIERS = {
    "tier25": {"stars": 1250, "euros": 25},
    "tier50": {"stars": 2500, "euros": 50},
    "tier100": {"stars": 5000, "euros": 100},
    "tier150": {"stars": 7500, "euros": 150},
}

# ---------------- STORAGE ----------------

user_state = {}

# ---------------- KEYBOARDS ----------------

def tier_keyboard():

    keyboard = [
        [
            InlineKeyboardButton("€25", callback_data="tier25"),
            InlineKeyboardButton("€50", callback_data="tier50"),
        ],
        [
            InlineKeyboardButton("€100", callback_data="tier100"),
            InlineKeyboardButton("€150", callback_data="tier150"),
        ]
    ]

    return InlineKeyboardMarkup(keyboard)


def channel_keyboard():

    keyboard = []

    for name in CHANNELS:
        keyboard.append(
            [InlineKeyboardButton(name, callback_data=f"channel|{name}")]
        )

    return InlineKeyboardMarkup(keyboard)


# ---------------- START POST ----------------

async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):

    await update.message.reply_text(
        "Select price:",
        reply_markup=tier_keyboard()
    )


# ---------------- TIER SELECT ----------------

async def tier_selected(update: Update, context: ContextTypes.DEFAULT_TYPE):

    query = update.callback_query
    await query.answer()

    tier = query.data
    user_id = query.from_user.id

    if tier not in TIERS:
        return

    user_state[user_id] = {"tier": tier}

    await query.edit_message_text(
        "Select channel:",
        reply_markup=channel_keyboard()
    )


# ---------------- CHANNEL SELECT ----------------

async def channel_selected(update: Update, context: ContextTypes.DEFAULT_TYPE):

    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id

    if user_id not in user_state:
        await query.edit_message_text("❌ Start with /post")
        return

    channel_name = query.data.split("|")[1]

    user_state[user_id]["channel"] = channel_name

    await query.edit_message_text(
        f"✅ Channel: {channel_name}\n\nSend the image now."
    )


# ---------------- RECEIVE IMAGE ----------------

async def receive_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):

    user_id = update.message.from_user.id

    if user_id not in user_state:
        await update.message.reply_text("Use /post first.")
        return

    data = user_state[user_id]

    if "tier" not in data or "channel" not in data:
        await update.message.reply_text("Use /post first.")
        return

    tier_key = data["tier"]
    channel_name = data["channel"]

    channel_id = CHANNELS[channel_name]
    tier = TIERS[tier_key]

    photo = update.message.photo[-1].file_id
    caption = update.message.caption or ""

    title = f"{tier['stars']} ⭐ (€{tier['euros']})"

    # Send photo
    await context.bot.send_photo(
        chat_id=channel_id,
        photo=photo,
        caption=caption
    )

    # Send Stars invoice
    await context.bot.send_invoice(
        chat_id=channel_id,
        title=title,
        description=f"Unlock this content for {tier['stars']} Stars",
        payload=tier_key,
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(title, tier["stars"])]
    )

    await update.message.reply_text("✅ Posted!")

    del user_state[user_id]


# ---------------- PRECHECKOUT ----------------

async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE):

    await update.pre_checkout_query.answer(ok=True)


# ---------------- MAIN ----------------

def main():

    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("post", start_post))

    app.add_handler(CallbackQueryHandler(tier_selected, pattern="^tier"))
    app.add_handler(CallbackQueryHandler(channel_selected, pattern="^channel"))

    app.add_handler(MessageHandler(filters.PHOTO, receive_photo))

    app.add_handler(PreCheckoutQueryHandler(precheckout))

    print("Bot started...")

    app.run_polling()


if __name__ == "__main__":
    main()
