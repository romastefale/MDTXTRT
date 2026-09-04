import re
import unittest

import runtime_v2


class ToolbarUiTests(unittest.TestCase):
    def test_quick_toolbar_keeps_every_primary_family_visible_without_scroll(self):
        index = runtime_v2.render_index()
        self.assertIn('id="quickToolbar" class="toolbar"', index)
        self.assertIn('grid-template-columns:repeat(13,minmax(0,1fr))', index)
        self.assertIn('overflow:hidden', index)
        self.assertNotIn('overflow-x:auto', index)
        self.assertIn('.legacy-toolbar{display:none!important}', index)

        for marker in (
            'data-direct="Negrito"',
            'data-direct="Itálico"',
            'data-direct="Sublinhado"',
            'data-direct="Riscado"',
            'data-family="text-extra"',
            'data-direct="Link"',
            'data-family="heading"',
            'data-family="quote"',
            'data-family="code"',
            'data-family="math"',
            'data-family="list"',
            'data-family="media"',
            'data-family="structure"',
        ):
            self.assertIn(marker, index)

        quick = index.split('id="quickToolbar"', 1)[1].split('</div>', 1)[0]
        self.assertEqual(len(re.findall(r'class="tool quick-tool', quick)), 13)

    def test_direct_formatting_preserves_existing_operations_and_real_pressed_state(self):
        index = runtime_v2.render_index()
        self.assertIn("function runDirect(label)", index)
        self.assertIn("const trigger=legacyButton('text')", index)
        self.assertIn("if(target)target.click()", index)
        self.assertIn("event.preventDefault()", index)
        self.assertIn("function updatePressed()", index)
        self.assertIn("formatActive(button.dataset.format)", index)
        self.assertIn("button.setAttribute('aria-pressed',active?'true':'false')", index)
        self.assertIn('.toolbar .tool[aria-pressed="true"]', index)

    def test_family_menus_repeat_icon_title_and_icon_each_option(self):
        index = runtime_v2.render_index()
        self.assertIn('menu-title-icon', index)
        self.assertIn('menu-option-icon', index)
        self.assertIn("popoverTitle.innerHTML='<span class=\"menu-title-icon\">'", index)
        self.assertIn("button.classList.add('menu-option')", index)
        self.assertIn("optionIcon(key,label)", index)
        self.assertIn('.grid button.menu-option{display:flex', index)

    def test_current_function_inventory_remains_reachable(self):
        index = runtime_v2.render_index()
        expected = (
            'Negrito', 'Itálico', 'Sublinhado', 'Riscado', 'Marcado', 'Spoiler',
            'Subscrito', 'Sobrescrito', 'Link', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
            'Normal', 'Expandível', 'Pull quote', 'Inline', 'Bloco', 'Com linguagem',
            'Bloco math', 'Marcadores', 'Numerada', 'Tarefa', 'Tarefa concluída',
            'URL', 'Upload', 'Collage', 'Slideshow', 'Tabela', 'Referência', 'Âncora',
            'Detalhes', 'Mapa', 'Botão URL', 'Botão copiar', 'Mini App', 'Divisor', 'Rodapé',
        )
        for label in expected:
            self.assertIn(label, index)

        self.assertIn("replaceSelection('**','**')", index)
        self.assertIn("prefixLines('- [ ] ')", index)
        self.assertIn("collectionForm('tg-collage')", index)
        self.assertIn("buttonForm('web_app')", index)


if __name__ == '__main__':
    unittest.main()
