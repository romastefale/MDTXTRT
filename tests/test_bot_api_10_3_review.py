import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock

from aiogram.types import InputMediaPhoto, InputRichMessageMedia

from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.publishing import TelegramPublicationService
from mdtxtrt.telegram_representations import RepresentationPlan
from mdtxtrt.telegram_validation import TelegramDestinationContext, validate_telegram_document


def document(*blocks: CanonicalNode) -> CanonicalDocument:
    return CanonicalDocument("doc", CanonicalDocument.CURRENT_SCHEMA_VERSION, blocks)


class BotApiReviewTests(unittest.IsolatedAsyncioTestCase):
    def test_web_app_is_validated_against_destination(self):
        button = CanonicalNode.create(
            "button", attrs={"type": "web_app", "url": "https://example.test"}, text="Abrir"
        )
        row = CanonicalNode.create("button_row", children=(button,))
        self.assertEqual(
            validate_telegram_document(document(row), TelegramDestinationContext(1, "private")), []
        )
        errors = validate_telegram_document(
            document(row), TelegramDestinationContext(-100, "supergroup")
        )
        self.assertTrue(any("conversa privada" in error for error in errors))

    def test_structural_limits_are_rejected_before_send(self):
        invalid_map = CanonicalNode.create("map", attrs={"lat": 91, "long": 0, "zoom": 13})
        uneven_table = CanonicalNode.create(
            "table",
            children=(
                CanonicalNode.create("table_row", children=(CanonicalNode.create("table_cell"),)),
                CanonicalNode.create("table_row", children=()),
            ),
        )
        errors = validate_telegram_document(document(invalid_map, uneven_table))
        self.assertTrue(any("coordenadas" in error for error in errors))
        self.assertTrue(any("mesma quantidade" in error for error in errors))

    def test_blocks_message_keeps_uploaded_media(self):
        plan = RepresentationPlan(
            key="blocks", label="Blocks", available=True, exact=True,
            preview="", blocks=[{"type": "paragraph", "text": "Olá"}],
        )
        attachment = InputRichMessageMedia(id="p_1", media=InputMediaPhoto(media="file-id"))
        message = TelegramPublicationService._message(plan, [attachment])
        self.assertEqual(message.blocks[0].type, "paragraph")
        self.assertEqual(message.media, [attachment])

    async def test_startup_returns_while_telegram_connects_in_background(self):
        from mdtxtrt.bot import TelegramRuntime

        runtime = object.__new__(TelegramRuntime)
        runtime._polling_task = None
        runtime._connect_and_poll = AsyncMock()
        await TelegramRuntime.on_startup(runtime)
        self.assertIsNotNone(runtime._polling_task)
        await runtime._polling_task


if __name__ == "__main__":
    unittest.main()
