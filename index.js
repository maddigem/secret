from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice
)

from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    PreCheckoutQueryHandler,
    filters
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

user_tier = {}
user_channel = {}

# ---------------- FUNCTIONS ----------------


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
    keyboard = [
        [InlineKeyboardButton(name, callback_data=f"channel_{name}")]
        for name in CHANNELS.keys()
    ]
    return InlineKeyboardMarkup(keyboard)


# ---------------- COMMAND ----------------


async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):

    await update.message.reply_text(
        "Select the price tier:",
        reply_markup=tier_keyboard()
    )


# ---------------- SELECT TIER ----------------


async def tier_selected(update: Update, context: ContextTypes.DEFAULT_TYPE):

    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id
    tier_key = query.data

    if tier_key not in TIERS:
        return

    user_tier[user_id] = tier_key

    await query.edit_message_text(
        "Select the channel:",
        reply_markup=channel_keyboard()
    )


# ---------------- SELECT CHANNEL ----------------


async def channel_selected(update: Update, context: ContextTypes.DEFAULT_TYPE):

    query = update.callback_query
    await query.answer()

    user_id = query.from_user.id

    if user_id not in user_tier:
        await query.edit_message_text("❌ Start with /post")
        return

    channel_name = query.data.replace("channel_", "")
    user_channel[user_id] = channel_name

    await query.edit_message_text(
        f"✅ Channel selected: {channel_name}\n\nSend the image you want to post."
    )


# ---------------- RECEIVE IMAGE ----------------


async def handle_photo(update: Update, context: ContextTypes.DEFAULT_TYPE):

    user_id = update.message.from_user.id

    if user_id not in user_tier or user_id not in user_channel:
        await update.message.reply_text("Use /post first.")
        return

    tier_key = user_tier[user_id]
    channel_name = user_channel[user_id]
    channel_id = CHANNELS[channel_name]

    tier = TIERS[tier_key]

    photo = update.message.photo[-1].file_id
    caption = update.message.caption if update.message.caption else ""

    title = f"{tier['stars']} ⭐ (€{tier['euros']})"

    await context.bot.send_photo(
        chat_id=channel_id,
        photo=photo,
        caption=caption
    )

    await context.bot.send_invoice(
        chat_id=channel_id,
        title=title,
        description=f"Unlock this content for {tier['stars']} Stars",
        payload=tier_key,
        provider_token="",
        currency="XTR",
        prices=[LabeledPrice(title, tier["stars"])]
    )

    await update.message.reply_text("✅ Post sent!")

    del user_tier[user_id]
    del user_channel[user_id]


# ---------------- PRECHECKOUT ----------------


async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.pre_checkout_query.answer(ok=True)


# ---------------- MAIN ----------------


def main():

    app = ApplicationBuilder().token(TOKEN).build()

    app.add_handler(CommandHandler("post", start_post))

    app.add_handler(CallbackQueryHandler(tier_selected, pattern="tier"))
    app.add_handler(CallbackQueryHandler(channel_selected, pattern="channel_"))

    app.add_handler(MessageHandler(filters.PHOTO, handle_photo))

    app.add_handler(PreCheckoutQueryHandler(precheckout))

    print("Bot running...")

    app.run_polling()


if __name__ == "__main__":
    main()

if name == "__main__":
    main()
