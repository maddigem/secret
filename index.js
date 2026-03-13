from telegram import LabeledPrice, InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    ContextTypes,
    PreCheckoutQueryHandler,
    CallbackQueryHandler
)

# ---------------- CONFIGURATION ----------------

TOKEN = "8203738499:AAEgwKPcC3LHo2xjHpNbf4w6xTaz8fSTNXg"  # Replace with your BotFather token

# ---------------- CHANNELS ----------------
# Replace the values below with your private channel chat IDs (negative numbers)
CHANNELS = {
    "Fitness": -1001234567890,
    "Premium": -1009876543210,
    "Nutrition": -1001122334455
}

# ---------------- STARS TIERS ----------------
# Stars → Euros mapping
TIERS = {
    "tier25": {"stars": 1250, "euros": 25},
    "tier50": {"stars": 2500, "euros": 50},
    "tier100": {"stars": 5000, "euros": 100},
    "tier150": {"stars": 7500, "euros": 150},
}

# Optional media (image or thumbnail)
MEDIA_URL = "https://yourcdn.com/thumb.jpg"

# Store which tier user selected
user_tier = {}

# ---------------- FUNCTIONS ----------------

def get_channel_keyboard():
    """Generate inline keyboard with available channels"""
    keyboard = [
        [InlineKeyboardButton(name, callback_data=key)]
        for key in CHANNELS.keys()
    ]
    return InlineKeyboardMarkup(keyboard)


async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE, tier_key):
    """Start tier post: ask user which channel to post in"""
    user_id = update.message.from_user.id
    user_tier[user_id] = tier_key

    await update.message.reply_text(
        "Select a channel to post this Stars invoice in:",
        reply_markup=get_channel_keyboard()
    )


async def channel_selected(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle channel button tap"""
    query = update.callback_query
    await query.answer()  # acknowledge button tap

    user_id = query.from_user.id
    tier_key = user_tier.get(user_id)

    if not tier_key:
        await query.edit_message_text("❌ Error: No tier selected. Start again.")
        return

    t = TIERS[tier_key]

    # Get selected channel chat ID
    channel_key = query.data
    channel_chat_id = CHANNELS[channel_key]

    title = f"{t['stars']} ⭐ (€{t['euros']})"

    # Optional: send image or video first
    if MEDIA_URL:
        await context.bot.send_photo(
            chat_id=channel_chat_id,
            photo=MEDIA_URL,
            caption="Unlock this premium content!"
        )

    # Send the Stars invoice
    await context.bot.send_invoice(
        chat_id=channel_chat_id,
        title=title,
        description=f"Support the channel with {t['stars']} Stars (€{t['euros']})",
        payload=tier_key,
        provider_token="",  # Telegram Stars
        currency="XTR",
        prices=[LabeledPrice(title, t['stars'])]
    )

    await query.edit_message_text(f"✅ Posted {title} in {channel_key}")


async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle precheckout queries (required)"""
    await update.pre_checkout_query.answer(ok=True)


def create_tier_handler(tier_key, command_name):
    """Helper to dynamically create tier commands"""
    async def handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
        await start_post(update, context, tier_key)
    return CommandHandler(command_name, handler)


# ---------------- MAIN ----------------

def main():
    app = ApplicationBuilder().token(TOKEN).build()

    # Register tier commands
    app.add_handler(create_tier_handler("tier25", "post25"))
    app.add_handler(create_tier_handler("tier50", "post50"))
    app.add_handler(create_tier_handler("tier100", "post100"))
    app.add_handler(create_tier_handler("tier150", "post150"))

    # Handle channel selection buttons
    app.add_handler(CallbackQueryHandler(channel_selected))

    # Precheckout handler for Stars
    app.add_handler(PreCheckoutQueryHandler(precheckout))

    print("Bot running...")
    app.run_polling()


if name == "__main__":
    main()
