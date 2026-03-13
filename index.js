import logging
from typing import Final

from telegram import (
    Update,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    LabeledPrice,
    BotCommand,
)
from telegram.error import TelegramError
from telegram.ext import (
    Application,
    ApplicationBuilder,
    CommandHandler,
    CallbackQueryHandler,
    MessageHandler,
    ContextTypes,
    ConversationHandler,
    PreCheckoutQueryHandler,
    filters,
)

# ================= CONFIG =================

TOKEN: Final = "DEIN_NEUER_BOT_TOKEN_HIER"

CHANNELS: Final = {
    "Fitness": -1003710017996,
    "Premium": -1002309468751,
    "Nutrition": -1002273059833,
}

TIERS: Final = {
    "25": {"stars": 1250, "euros": 25},
    "50": {"stars": 2500, "euros": 50},
    "100": {"stars": 5000, "euros": 100},
    "150": {"stars": 7500, "euros": 150},
}

# ================= LOGGING =================

logging.basicConfig(
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ================= STATES =================

CHOOSE_CHANNEL, CHOOSE_TIER, CHOOSE_MEDIA_TYPE, WAIT_MEDIA = range(4)

# ================= KEYBOARDS =================

def channel_keyboard() -> InlineKeyboardMarkup:
    rows = [
        [InlineKeyboardButton(name, callback_data=f"channel:{name}")]
        for name in CHANNELS.keys()
    ]
    rows.append([InlineKeyboardButton("Abbrechen", callback_data="cancel")])
    return InlineKeyboardMarkup(rows)


def tier_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("25€", callback_data="tier:25"),
                InlineKeyboardButton("50€", callback_data="tier:50"),
            ],
            [
                InlineKeyboardButton("100€", callback_data="tier:100"),
                InlineKeyboardButton("150€", callback_data="tier:150"),
            ],
            [InlineKeyboardButton("Abbrechen", callback_data="cancel")],
        ]
    )


def media_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        [
            [
                InlineKeyboardButton("Bild", callback_data="media:photo"),
                InlineKeyboardButton("Video", callback_data="media:video"),
            ],
            [InlineKeyboardButton("Abbrechen", callback_data="cancel")],
        ]
    )

# ================= COMMAND SETUP =================

async def post_init(app: Application) -> None:
    await app.bot.set_my_commands(
        [
            BotCommand("start", "Post erstellen"),
            BotCommand("cancel", "Vorgang abbrechen"),
            BotCommand("chatid", "Chat-ID anzeigen"),
        ]
    )

# ================= COMMANDS =================

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()
    await update.effective_message.reply_text(
        "Wähle zuerst den Kanal, in den gepostet werden soll:",
        reply_markup=channel_keyboard(),
    )
    return CHOOSE_CHANNEL


async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    context.user_data.clear()

    if update.callback_query:
        await update.callback_query.answer()
        await update.callback_query.edit_message_text("Vorgang abgebrochen.")
    else:
        await update.effective_message.reply_text("Vorgang abgebrochen.")

    return ConversationHandler.END


async def chatid(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    chat = update.effective_chat
    await update.effective_message.reply_text(
        f"Chat-ID: {chat.id}\nTyp: {chat.type}\nTitel: {chat.title or '-'}"
    )

# ================= STEP 1: CHANNEL =================

async def choose_channel(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "cancel":
        return await cancel(update, context)

    if not query.data.startswith("channel:"):
        await query.edit_message_text("Ungültige Auswahl.")
        return ConversationHandler.END

    channel_name = query.data.split(":", 1)[1]

    if channel_name not in CHANNELS:
        await query.edit_message_text("Unbekannter Kanal.")
        return ConversationHandler.END

    context.user_data["channel_name"] = channel_name
    context.user_data["channel_id"] = CHANNELS[channel_name]

    await query.edit_message_text(
        f"Kanal gewählt: {channel_name}\n\nWähle jetzt die Sterne/den Preis:",
        reply_markup=tier_keyboard(),
    )
    return CHOOSE_TIER

# ================= STEP 2: TIER =================

async def choose_tier(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "cancel":
        return await cancel(update, context)

    if not query.data.startswith("tier:"):
        await query.edit_message_text("Ungültige Auswahl.")
        return ConversationHandler.END

    tier_key = query.data.split(":", 1)[1]

    if tier_key not in TIERS:
        await query.edit_message_text("Unbekannter Preis.")
        return ConversationHandler.END

    context.user_data["tier_key"] = tier_key

    tier = TIERS[tier_key]
    await query.edit_message_text(
        f"Preis gewählt: {tier['euros']}€ / {tier['stars']} Stars\n\n"
        "Willst du ein Bild oder ein Video senden?",
        reply_markup=media_keyboard(),
    )
    return CHOOSE_MEDIA_TYPE

# ================= STEP 3: MEDIA TYPE =================

async def choose_media_type(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    query = update.callback_query
    await query.answer()

    if query.data == "cancel":
        return await cancel(update, context)

    if not query.data.startswith("media:"):
        await query.edit_message_text("Ungültige Auswahl.")
        return ConversationHandler.END

    media_type = query.data.split(":", 1)[1]

    if media_type not in ("photo", "video"):
        await query.edit_message_text("Ungültiger Medientyp.")
        return ConversationHandler.END

    context.user_data["media_type"] = media_type

    text = (
        "Sende mir jetzt das Bild mit optionaler Caption."
        if media_type == "photo"
        else "Sende mir jetzt das Video mit optionaler Caption."
    )

    await query.edit_message_text(text)
    return WAIT_MEDIA

# ================= STEP 4: RECEIVE MEDIA =================

async def receive_photo(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if context.user_data.get("media_type") != "photo":
        await update.effective_message.reply_text("Du hast vorher Video gewählt. Bitte sende ein Video.")
        return WAIT_MEDIA

    return await _post_media(update, context, kind="photo")


async def receive_video(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    if context.user_data.get("media_type") != "video":
        await update.effective_message.reply_text("Du hast vorher Bild gewählt. Bitte sende ein Bild.")
        return WAIT_MEDIA

    return await _post_media(update, context, kind="video")


async def _post_media(update: Update, context: ContextTypes.DEFAULT_TYPE, kind: str) -> int:
    msg = update.effective_message

    channel_id = context.user_data.get("channel_id")
    channel_name = context.user_data.get("channel_name")
    tier_key = context.user_data.get("tier_key")

    if not channel_id or not channel_name or not tier_key:
        await msg.reply_text("Fehlende Daten. Bitte /start neu senden.")
        context.user_data.clear()
        return ConversationHandler.END

    tier = TIERS[tier_key]
    caption = msg.caption or ""
    title = f"{tier['stars']} ⭐ (€{tier['euros']})"

    try:
        if kind == "photo":
            file_id = msg.photo[-1].file_id
            await context.bot.send_photo(
                chat_id=channel_id,
                photo=file_id,
                caption=caption,
            )
        else:
            file_id = msg.video.file_id
            await context.bot.send_video(
                chat_id=channel_id,
                video=file_id,
                caption=caption,
            )

        await context.bot.send_invoice(
            chat_id=channel_id,
            title=title,
            description=f"Unlock this content for {tier['stars']} Stars",
            payload=f"{channel_name}|{tier_key}|{kind}",
            currency="XTR",
            prices=[LabeledPrice(title, tier["stars"])],
        )

        await msg.reply_text(f"✅ Erfolgreich in {channel_name} gepostet.")
        context.user_data.clear()
        return ConversationHandler.END

    except TelegramError as e:
        logger.exception("Telegram-Fehler")
        await msg.reply_text(
            "❌ Fehler beim Posten.\n"
            f"{e}\n\n"
            "Prüfe:\n"
            "- Bot ist Admin im Kanal\n"
            "- Kanal-ID stimmt\n"
            "- Bot darf Medien senden\n"
            "- Token ist korrekt"
        )
        context.user_data.clear()
        return ConversationHandler.END

    except Exception as e:
        logger.exception("Unerwarteter Fehler")
        await msg.reply_text(f"❌ Unerwarteter Fehler: {e}")
        context.user_data.clear()
        return ConversationHandler.END

# ================= OTHER HANDLERS =================

async def wrong_input(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    media_type = context.user_data.get("media_type")

    if media_type == "photo":
        await update.effective_message.reply_text("Bitte sende ein Bild.")
    elif media_type == "video":
        await update.effective_message.reply_text("Bitte sende ein Video.")
    else:
        await update.effective_message.reply_text("Bitte /start neu senden.")

    return WAIT_MEDIA


async def precheckout(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.pre_checkout_query.answer(ok=True)


async def successful_payment(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    await update.effective_message.reply_text("✅ Zahlung erfolgreich.")

async def error_handler(update: object, context: ContextTypes.DEFAULT_TYPE) -> None:
    logger.exception("Unhandled exception", exc_info=context.error)

# ================= MAIN =================

def main() -> None:
    app = ApplicationBuilder().token(TOKEN).post_init(post_init).build()

    conv = ConversationHandler(
        entry_points=[CommandHandler("start", start)],
        states={
            CHOOSE_CHANNEL: [
                CallbackQueryHandler(choose_channel, pattern=r"^(channel:|cancel$)")
            ],
            CHOOSE_TIER: [
                CallbackQueryHandler(choose_tier, pattern=r"^(tier:|cancel$)")
            ],
            CHOOSE_MEDIA_TYPE: [
                CallbackQueryHandler(choose_media_type, pattern=r"^(media:|cancel$)")
            ],
            WAIT_MEDIA: [
                MessageHandler(filters.PHOTO, receive_photo),
                MessageHandler(filters.VIDEO, receive_video),
                MessageHandler(~(filters.PHOTO | filters.VIDEO), wrong_input),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel)],
        allow_reentry=True,
    )

    app.add_handler(conv)
    app.add_handler(CommandHandler("cancel", cancel))
    app.add_handler(CommandHandler("chatid", chatid))
    app.add_handler(PreCheckoutQueryHandler(precheckout))
    app.add_handler(
        MessageHandler(filters.SUCCESSFUL_PAYMENT, successful_payment)
    )
    app.add_error_handler(error_handler)

    print("Bot läuft...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)

if __name__ == "__main__":
    main()
