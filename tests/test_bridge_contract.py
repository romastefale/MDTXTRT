import re
import unittest

import app
from canonical import CanonicalDocument


class BridgeContractTests(unittest.TestCase):
    def test_telegram_rich_keeps_toolbar_canonical_syntax_lossless(self):
        source = """**bold** *italic* <u>under</u> ~~strike~~ ==mark== ||spoiler|| <sub>sub</sub> <sup>sup</sup> [link](https://example.com/?a=1&b=2)

# H1
###### H6

> normal

<blockquote expandable>
expandable
</blockquote>

<aside>pull<cite>credit</cite></aside>

`inline`
```python
print(\"x\")
```

$x^2$
$$
y^2
$$

- bullet
1. numbered
- [ ] todo
- [x] done

| A | B |
|---|---|
| 1 | 2 |

<a href=\"#note\">ref</a>
<tg-reference name=\"note\">body</tg-reference>
<a name=\"anchor\"></a>

<details><summary>Summary</summary>
### inside
- item
</details>

<tg-map lat=\"-23.5\" long=\"-46.6\" zoom=\"14\"/>

<tg-collage>
![](https://example.com/a.jpg)
![](https://example.com/b.mp4)
</tg-collage>

<tg-slideshow>
![](https://example.com/c.jpg)
![](https://example.com/d.mp4)
</tg-slideshow>

<tg-button-row align=\"center\">
<tg-button type=\"url\" url=\"https://example.com\">Open</tg-button>
</tg-button-row>

<tg-button-row align=\"center\">
<tg-button type=\"copy_text\" text=\"copy & keep\">Copy</tg-button>
</tg-button-row>

<tg-button-row align=\"center\">
<tg-button type=\"web_app\" url=\"https://example.com/app\">App</tg-button>
</tg-button-row>

---
<footer>footer</footer>
"""
        markdown, refs = CanonicalDocument.from_markdown(source).telegram_markdown()
        self.assertEqual(markdown, source)
        self.assertEqual(refs, ())

    def test_local_media_is_the_only_telegram_specific_rewrite(self):
        source = (
            '![](mdtxtrt://photo/p1 "foto")\n'
            '![](mdtxtrt://video/v1 "video")\n'
            '![](mdtxtrt://animation/a1 "gif")\n'
            '![](mdtxtrt://audio/u1 "audio")\n'
            '![](mdtxtrt://document/d1 "doc")'
        )
        markdown, refs = CanonicalDocument.from_markdown(source).telegram_markdown()
        self.assertIn('tg://photo?id=p1 "foto"', markdown)
        self.assertIn('tg://video?id=v1 "video"', markdown)
        self.assertIn('tg://video?id=a1 "gif"', markdown)
        self.assertIn('tg://audio?id=u1 "audio"', markdown)
        self.assertIn('tg://document?id=d1 "doc"', markdown)
        self.assertEqual([ref.kind for ref in refs], ["photo", "video", "animation", "audio", "document"])

    def test_markdown_export_preserves_the_canonical_document(self):
        source = "\\*literal\\*  \n\n\nline with two spaces  \n<tg-map lat=\"1\" long=\"2\" zoom=\"14\"/>\n"
        self.assertEqual(app.main.optimize_markdown(source), source)

    def test_telegraph_projection_has_no_telegram_markup_residue(self):
        source = """==mark== ||secret|| H<sub>2</sub>O <sup>2</sup> [A & B](https://example.com/?a=1&b=2)

<blockquote expandable>
expand **bold**
</blockquote>

<aside>pull<cite>credit</cite></aside>

<a href=\"#note\">reference</a>
<tg-reference name=\"note\">reference body</tg-reference>
<a name=\"anchor\"></a>

<details><summary>Summary **bold**</summary>
### Inside
- first
- second
</details>

<tg-map lat=\"1\" long=\"2\" zoom=\"14\"/>

<tg-button-row align=\"center\">
<tg-button type=\"copy_text\" text=\"copy & keep\">Copy</tg-button>
</tg-button-row>

<footer>footer</footer>
"""
        projection = CanonicalDocument.from_markdown(source).telegraph()
        rendered = projection.html

        self.assertIn('<a href="https://example.com/?a=1&amp;b=2">A &amp; B</a>', rendered)
        self.assertNotIn("&amp;amp;", rendered)
        self.assertIn("<blockquote>expand <strong>bold</strong></blockquote>", rendered)
        self.assertIn("<aside>pull <em>— credit</em></aside>", rendered)
        self.assertIn("reference", rendered)
        self.assertIn("reference body", rendered)
        self.assertEqual(rendered.count("Summary"), 1)
        self.assertIn("<h4>Inside</h4>", rendered)
        self.assertIn("Copy: <code>copy &amp; keep</code>", rendered)
        self.assertIn("Mapa: 1, 2", rendered)
        self.assertIn("<p><em>footer</em></p>", rendered)

        for residue in (
            "<tg-", "&lt;tg-", "&lt;blockquote", "&lt;aside",
            "&lt;details", "&lt;summary", "&lt;a href=\"#", "<cite>",
        ):
            self.assertNotIn(residue, rendered)

        allowed = {
            "a", "aside", "b", "blockquote", "br", "code", "em",
            "figcaption", "figure", "h3", "h4", "hr", "i", "iframe",
            "img", "li", "ol", "p", "pre", "s", "strong", "u", "ul", "video",
        }
        tags = set(re.findall(r"</?([a-zA-Z0-9]+)", rendered))
        self.assertTrue(tags <= allowed, tags - allowed)

        joined = "\n".join(projection.degradations)
        for expected in (
            "Spoiler", "marcado", "Subscrito/sobrescrito", "Citação expandível",
            "Âncoras", "Referências", "Estruturas exclusivas", "Rodapé",
        ):
            self.assertIn(expected, joined)


if __name__ == "__main__":
    unittest.main()
