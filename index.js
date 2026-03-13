import logging
from typing import Final

from telegram import (
    BotCommand,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    Update,
)
from telegram.error import TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    PreCheckoutQueryHandler,
    filters,
)

# ---------------- CONFIG ----------------

TOKEN: Final = "PASTE_YOUR_NEW_BOT_TOKEN_HERE"

# Trage hier deine echten Chat-IDs oder @usernames ein.
# Für private Channels/Gruppen nimm die numerische ID, z. B. -1001234567890
CHANNELS: Final = {
    "Fitness": -1001234567890,
    "Premium": -1009876543210,
    "Nutrition": -1001122334455,
}

TIERS: Final = {
    "tier25": {"stars": 1250, "euros": 25},
    "tier50": {"stars": 2500, "euros": 50},
    "tier100": {"stars": 5000, "euros": 100},
    "tier150": {"stars": 7500, "euros": 150},
}

# ---------------- LOGGING ----------------

logging.basicConfig(
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ---------------- STATES ----------------

CHOOSING_TIER, CHOOSING_CHANNEL, WAITING_MEDIA = range(3)

# ---------------- KEYBOARDS ----------------


def tier_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("€25", callback_data="tier:tier25"),
                InlineKeyboardButton("€50", callback_data="tier:tier50"),
            ],
            [
                InlineKeyboardButton("€100", callback_data="tier:tier100"),
                InlineKeyboardButton("€150", callback_data="tier:tier150"),
            ],
        ]
    )


def channel_keyboard() -> InlineKeyboardMarkup:
    rows = []
    for name in CHANNELS.keys():
        rows.append([InlineKeyboardButton(name, callback_data=f"channel:{name}")])
    rows.append([InlineKeyboardButton("Abbrechen", callback_data="cancel")])
    return InlineKeyboardMarkup(rows)


# ---------------- SETUP ----------------


async def post_init(application: Application) -> None:
    await application.bot.set_my_commands(
        [
            BotCommand("start", "Bot starten"),
            BotCommand("post", "Neuen Stars-Post erstellen"),
            BotCommand("chatid", "Aktuelle Chat-ID anzeigen"),
            BotCommand("cancel", "Aktuellen Vorgang abbrechen"),
        ]
    )


# ---------------- COMMANDS ----------------


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    text = (
        "Hi. Nutze /post, um einen neuen Stars-Post zu erstellen.\n\n"
        "Ablauf:\n"
        "1. Preis wählen\n"
        "2. Channel wählen\n"
        "3. Bild mit optionaler Caption senden\n\n"
        "Mit /chatid kannst du die Chat-ID des aktuellen Chats sehen."
    )
    await update.effective_message.reply_text(text)


async def chat_id(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    await update.effective_message.reply_text(
        f"Chat-ID: `{chat.id}`\nTyp: {chat.type}\nTitel: {chat.title or '—'}",
        parse_mode="Markdown",
    )


async def post_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.effective_message.reply_text(
        "Wähle zuerst den Preis:",
        reply_markup=tier_keyboard(),
    )
    return CHOOSING_TIER


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text("Vorgang abgebrochen.")
    else:
        await update.effective_message.reply_text("Vorgang abgebrochen.")
    return ConversationHandler.END


# ---------------- CALLBACKS ----------------


async def choose_tier(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    data = query.data
    if data == "cancel":
        return await cancel(update, context)

    if not data.startswith("tier:"):
        await query.edit_message_text("Ungültige Auswahl. Starte mit /post neu.")
        return ConversationHandler.END

    tier_key = data.split(":", 1)[1]
    if tier_key not in TIERS:
        await query.edit_message_text("Unbekannter Preis. Starte mit /post neu.")
        return ConversationHandler.END

    context.user_data["tier_key"] = tier_key

    await query.edit_message_text(
        "Wähle jetzt den Channel oder die Gruppe:",
        reply_markup=channel_keyboard(),
    )
    return CHOOSING_CHANNEL


async def choose_channel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    data = query.data
    if data == "cancel":
        return await cancel(update, context)

    if not data.startswith("channel:"):
        await query.edit_message_text("Ungültige Auswahl. Starte mit /post neu.")
        return ConversationHandler.END

    channel_name = data.split(":", 1)[1]
    if channel_name not in CHANNELS:
        await query.edit_message_text("Unbekannter Channel. Starte mit /post neu.")
        return ConversationHandler.END

    context.user_data["channel_name"] = channel_name
    context.user_data["channel_id"] = CHANNELS[channel_name]

    await query.edit_message_text(
        f"✅ Ziel gewählt: {channel_name}\n\n"
        "Sende mir jetzt **ein Bild** mit optionaler Caption.",
        parse_mode="Markdown",
    )
    return WAITING_MEDIA


# ---------------- MEDIA HANDLER ----------------


async def receive_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    message = update.effective_message

    tier_key = context.user_data.get("tier_key")
    channel_name = context.user_data.get("channel_name")
    channel_id = context.user_data.get("channel_id")

    if not tier_key or not channel_name or not channel_id:
        await message.reply_text("Es fehlt Kontext. Bitte starte neu mit /post.")
        return ConversationHandler.END

    tier = TIERS[tier_key]
    photo = message.photo[-1].file_id
    caption = message.caption or ""

    title = f"{tier['stars']} ⭐ (€{tier['euros']})"
    description = f"Unlock this content for {tier['stars']} Stars"

    try:
        # 1) Bild posten
        await context.bot.send_photo(
            chat_id=channel_id,
            photo=photo,
            caption=caption,
        )

        # 2) Stars-Invoice posten
        # Für XTR/Telegram Stars provider_token weglassen.
        await context.bot.send_invoice(
            chat_id=channel_id,
            title=title,
            description=description,
            payload=f"{tier_key}|{channel_name}",
            currency="XTR",
            prices=[LabeledPrice(label=title, amount=tier["stars"])],
        )

        await message.reply_text(f"✅ Erfolgreich in {channel_name} gepostet.")
        context.user_data.clear()
        return ConversationHandler.END

    except TelegramError as e:
        logger.exception("Telegram-Fehler beim Posten")
        await message.reply_text(
            "❌ Telegram hat den Post abgelehnt.\n\n"
            f"Fehler: `{str(e)}`\n\n"
            "Prüfe:\n"
            "- Bot ist Admin im Ziel-Chat\n"
            "- Chat-ID stimmt\n"
            "- Bot darf Nachrichten/Medien senden\n"
            "- Du nutzt einen gültigen neuen Token",
            parse_mode="Markdown",
        )
        return ConversationHandler.END

    except Exception as e:
        logger.exception("Unerwarteter Fehler")
        await message.reply_text(
            f"❌ Unerwarteter Fehler: `{str(e)}`",
            parse_mode="Markdown",
        )
        return ConversationHandler.END


async def wrong_media(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    await update.effective_message.reply_text(
        "Bitte sende ein **Bild**. Keine Textnachricht, kein Sticker.",
        parse_mode="Markdown",
    )
    return WAITING_MEDIA


# ---------------- PAYMENTS ----------------


async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.pre_checkout_query.answer(ok=True)


# ---------------- ERROR HANDLER ----------------


async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.exception("Unhandled exception", exc_info=context.error)


# ---------------- MAIN ----------------


def main() -> None:
    app = (
        ApplicationBuilder()
        .token(TOKEN)
        .post_init(post_init)
        .build()
    )

    conv = ConversationHandler(
        entry_points=[CommandHandler("post", post_command)],
        states={
            CHOOSING_TIER: [
                CallbackQueryHandler(choose_tier, pattern=r"^(tier:|cancel$)")
            ],
            CHOOSING_CHANNEL: [
                CallbackQueryHandler(choose_channel, pattern=r"^(channel:|cancel$)")
            ],
            WAITING_MEDIA: [
                MessageHandler(filters.PHOTO, receive_photo),
                MessageHandler(~filters.PHOTO, wrong_media),
            ],
        },
        fallbacks=[
            CommandHandler("cancel", cancel),
            CallbackQueryHandler(cancel, pattern=r"^cancel$"),
        ],
        per_chat=True,
        per_user=True,
        per_message=False,
    )

    app.add_handler(CommandHandler("start", start))
    app.add_handler(CommandHandler("chatid", chat_id))
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(conv)
    app.add_handler(PreCheckoutQueryHandler(precheckout))
    app.add_error_handler(error_handler)

    logger.info("Bot started")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
