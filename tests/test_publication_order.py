import unittest

from mdtxtrt.domain import CanonicalDocument, CanonicalNode
from mdtxtrt.publishing import (
    _native_location_payload,
    _publication_runs,
    _rich_blocks_are_blank,
)


class PublicationOrderTests(unittest.TestCase):
    def test_empty_paragraph_is_blank_and_location_is_not_venue_without_address(self):
        empty = CanonicalNode.create("paragraph", children=[])
        pin = CanonicalNode.create(
            "location",
            attrs={"lat": -23.5, "long": -47.5, "name": "", "address": ""},
        )
        self.assertTrue(_rich_blocks_are_blank((empty,)))
        self.assertEqual(_native_location_payload(pin)["kind"], "location")

    def test_runs_keep_text_then_pin_then_text(self):
        empty = CanonicalNode.create("paragraph", children=[])
        text = CanonicalNode.create("paragraph", children=[CanonicalNode.create("text", text="oi")])
        pin = CanonicalNode.create("location", attrs={"lat": -23.5, "long": -47.5})
        venue = CanonicalNode.create(
            "venue",
            attrs={"lat": -23.5, "long": -47.5, "name": "Padaria", "address": "Rua 1"},
        )
        document = CanonicalDocument(
            id="d1",
            schema_version=1,
            blocks=(empty, pin, text, venue),
            metadata={},
        )
        kinds = [kind for kind, _ in _publication_runs(document)]
        self.assertEqual(kinds, ["rich", "location", "rich", "location"])
        self.assertEqual(_native_location_payload(venue)["kind"], "venue")


if __name__ == "__main__":
    unittest.main()
