import re
import unittest

import runtime_v2


class ToolbarUiTests(unittest.TestCase):
    def test_single_toolbar_keeps_every_primary_control_visible_without_scroll(self):
        index = runtime_v2.render_index()
        self.assertIn('id="toolbar" class="toolbar"', index)
        self.assertIn('grid-template-columns:repeat(13,minmax(0,1fr))', index)
        self.assertIn('overflow:hidden', index)
        self.assertNotIn('overflow-x:auto', index)
        self.assertNotIn('legacy-toolbar', index)
        self.assertNotIn('quickToolbar', index)

        for marker in (
            'data-direct="Negrito"',
            'data-direct="Itálico"',
            'data-direct="Sublinhado"',
            'data-direct="Riscado"',
            'data-menu="text-extra"',
            'data-direct="Link"',
            'data-menu="heading"',
            'data-menu="quote"',
            'data-menu="code"',
            'data-menu="math"',
            'data-menu="list"',
            'data-menu="media"',
            'data-menu="structure"',
        ):
            self.assertIn(marker, index)

        toolbar = index.split('id="toolbar" class="toolbar"', 1)[1].split('</div>', 1)[0]
        self.assertEqual(len(re.findall(r'<button class="tool', toolbar)), 13)

    def test_direct_formatting_uses_existing_editor_operations_without_hidden_toolbar_bridge(self):
        index = runtime_v2.render_index()
        self.assertIn('const directActions={', index)
        self.assertIn("'Negrito':()=>replaceSelection('**','**',{keepSelected:true})", index)
        self.assertIn("'Itálico':()=>replaceSelection('*','*',{keepSelected:true})", index)
        self.assertIn("'Sublinhado':()=>replaceSelection('<u>','</u>',{keepSelected:true})", index)
        self.assertIn("'Riscado':()=>replaceSelection('~~','~~',{keepSelected:true})", index)
        self.assertIn("'Link':linkAction", index)
        self.assertIn("const fn=directActions[b.dataset.direct]", index)
        self.assertNotIn('legacyButton', index)
        self.assertNotIn("dispatchEvent(new Event('select'))", index)
        self.assertIn('event.preventDefault()', index)

    def test_pressed_state_is_visual_and_derived_from_current_selection(self):
        index = runtime_v2.render_index()
        self.assertIn('function updatePressed()', index)
        self.assertIn('formatActive(button.dataset.format)', index)
        self.assertIn("button.setAttribute('aria-pressed',active?'true':'false')", index)
        self.assertIn('.toolbar .tool[aria-pressed="true"]', index)
        self.assertIn("['select','keyup','mouseup','touchend','input','focus','click']", index)

    def test_family_menus_repeat_icon_title_and_icon_each_option(self):
        index = runtime_v2.render_index()
        self.assertIn('menu-title-icon', index)
        self.assertIn('menu-option-icon', index)
        self.assertIn("popoverTitle.innerHTML='<span class=\"menu-title-icon\">'", index)
        self.assertIn("b.className='menu-option'", index)
        self.assertIn('optionIcon(key,label)', index)
        self.assertIn('.grid button.menu-option{display:flex', index)
        self.assertIn("menus['text-extra']={title:'Texto'", index)

    def test_current_function_inventory_remains_reachable(self):
        index = runtime_v2.render_index()
        expected = (
            'Negrito', 'Itálico', 'Sublinhado', 'Riscado', 'Marcado', 'Spoiler',
            'Subscrito', 'Sobrescrito', 'Link', 'Normal', 'Expandível', 'Pull quote',
            'Inline', 'Bloco', 'Com linguagem', 'Bloco math', 'Marcadores', 'Numerada',
            'Tarefa', 'Tarefa concluída', 'URL', 'Upload', 'Collage', 'Slideshow',
            'Tabela', 'Referência', 'Âncora', 'Detalhes', 'Mapa', 'Botão URL',
            'Botão copiar', 'Mini App', 'Divisor', 'Rodapé',
        )
        for label in expected:
            self.assertIn(label, index)

        self.assertIn("items:[1,2,3,4,5,6].map(n=>['H'+n,()=>heading(n)])", index)
        self.assertIn("replaceSelection('**','**')", index)
        self.assertIn("prefixLines('- [ ] ')", index)
        self.assertIn("collectionForm('tg-collage')", index)
        self.assertIn("buttonForm('web_app')", index)


if __name__ == '__main__':
    unittest.main()
