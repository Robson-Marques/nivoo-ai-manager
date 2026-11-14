"""TEST-ONLY: gera documentos de escritório mínimos (com os namespaces reais) e um PDF escaneado (imagem).
Uso: python3 documentos.py <pasta>"""
import sys, zipfile, os
d = sys.argv[1]
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"'
A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
S = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
O = ('xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
     'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"')
def z(nome, partes):
    with zipfile.ZipFile(os.path.join(d, nome), 'w') as f:
        for k, v in partes.items(): f.writestr(k, v)
z('contrato.docx', {'word/document.xml': f'<w:document {W}><w:body><w:p><w:r><w:t>Cláusula 1</w:t></w:r><w:r><w:tab/><w:t>Prazo DOCX-11</w:t></w:r></w:p><w:p><w:r><w:t>Segunda linha</w:t></w:r></w:p></w:body></w:document>'})
z('apresentacao.pptx', {
  'ppt/slides/slide1.xml': f'<p:sld {A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Visão PPTX-21</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  'ppt/slides/slide10.xml': f'<p:sld {A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Fim PPTX-29</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
  'ppt/slides/slide2.xml': f'<p:sld {A}><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Meio PPTX-22</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>',
})
z('precos.xlsx', {
  'xl/workbook.xml': f'<workbook {S} xmlns:r="r"><sheets><sheet name="Tabela" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/sharedStrings.xml': f'<sst {S}><si><t>Produto</t></si><si><t>Preço</t></si><si><t>Margherita XLSX-31</t></si></sst>',
  'xl/worksheets/sheet1.xml': f'<worksheet {S}><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>45.5</v></c></row></sheetData></worksheet>',
})
z('ata.odt', {'content.xml': f'<office:document-content {O}><office:body><office:text><text:p>Ata ODT-41 <text:span>reunião</text:span></text:p></office:text></office:body></office:document-content>'})
z('estoque.ods', {'content.xml': f'<office:document-content {O}><office:body><office:spreadsheet><table:table table:name="Estoque"><table:table-row><table:table-cell><text:p>Farinha ODS-51</text:p></table:table-cell><table:table-cell><text:p>12</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:body></office:document-content>'})
open(os.path.join(d, 'antigo.doc'), 'wb').write(b'\xd0\xcf\x11\xe0 documento antigo')
open(os.path.join(d, 'quebrado.docx'), 'wb').write(b'isto nao e um zip')
from PIL import Image, ImageDraw, ImageFont
img = Image.new('L', (1400, 400), 255)
dr = ImageDraw.Draw(img)
try: fonte = ImageFont.load_default(size=72)
except TypeError: fonte = ImageFont.load_default()
dr.text((60, 150), 'CONTRATO ESCANEADO 4321', fill=0, font=fonte)
img.save(os.path.join(d, 'escaneado.pdf'), 'PDF', resolution=150)
