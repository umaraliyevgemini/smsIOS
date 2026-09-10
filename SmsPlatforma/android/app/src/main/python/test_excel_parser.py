import json
import tempfile
import unittest
import zipfile
from pathlib import Path
import sys

# Ensure module path is accessible
sys.path.insert(0, str(Path(__file__).parent))

import excel_parser


class TestExcelParser(unittest.TestCase):

    def test_normalize_phone_with_various_formats(self):
        # Missing +998 (9 digits) -> should add +998
        self.assertEqual(excel_parser._normalize_phone("901234567"), "+998901234567")
        self.assertEqual(excel_parser._normalize_phone("90 123 45 67"), "+998901234567")
        self.assertEqual(excel_parser._normalize_phone("(90) 123-45-67"), "+998901234567")

        # Legacy local 10 digits starting with 8 or 0 -> should format to +998
        self.assertEqual(excel_parser._normalize_phone("8901234567"), "+998901234567")
        self.assertEqual(excel_parser._normalize_phone("0901234567"), "+998901234567")

        # 12 digits starting with 998 without + -> should add +
        self.assertEqual(excel_parser._normalize_phone("998901234567"), "+998901234567")

        # Already has +998 -> should keep as is, no duplication
        self.assertEqual(excel_parser._normalize_phone("+998901234567"), "+998901234567")
        self.assertEqual(excel_parser._normalize_phone("+998 (90) 123-45-67"), "+998901234567")

        # Excel float formatting artifacts
        self.assertEqual(excel_parser._normalize_phone("901234567.0"), "+998901234567")
        self.assertEqual(excel_parser._normalize_phone("998901234567.0"), "+998901234567")

    def test_parse_csv(self):
        csv_content = (
            "Ism,Familiya,Telefon\n"
            "Ali,Valiyev,901234567\n"
            "Sardor,Kadirov,+998912345678\n"
        )
        with tempfile.NamedTemporaryFile("w", suffix=".csv", delete=False, encoding="utf-8") as f:
            f.write(csv_content)
            temp_path = f.name

        try:
            raw_result = excel_parser.parse_contacts(temp_path)
            data = json.loads(raw_result)
            self.assertEqual(len(data["contacts"]), 2)
            self.assertEqual(data["contacts"][0]["phone"], "+998901234567")
            self.assertEqual(data["contacts"][1]["phone"], "+998912345678")
        finally:
            Path(temp_path).unlink(missing_ok=True)

    def test_multi_sheet_xlsx(self):
        # Create a mock xlsx file with 2 sheets
        sheet1_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="s"><v>3</v></c>
    </row>
  </sheetData>
</worksheet>"""

        sheet2_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>4</v></c>
      <c r="B2" t="s"><v>5</v></c>
    </row>
  </sheetData>
</worksheet>"""

        workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Toshkent" sheetId="1" r:id="rId1"/>
    <sheet name="Samarqand" sheetId="2" r:id="rId2"/>
  </sheets>
</workbook>"""

        rels_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
</Relationships>"""

        shared_strings_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>Ismi</t></si>
  <si><t>Telefon</t></si>
  <si><t>Javohir</t></si>
  <si><t>901112233</t></si>
  <si><t>Bobur</t></si>
  <si><t>998904445566</t></si>
</sst>"""

        with tempfile.NamedTemporaryFile("wb", suffix=".xlsx", delete=False) as f:
            temp_path = f.name

        with zipfile.ZipFile(temp_path, "w") as z:
            z.writestr("xl/workbook.xml", workbook_xml)
            z.writestr("xl/_rels/workbook.xml.rels", rels_xml)
            z.writestr("xl/worksheets/sheet1.xml", sheet1_xml)
            z.writestr("xl/worksheets/sheet2.xml", sheet2_xml)
            z.writestr("xl/sharedStrings.xml", shared_strings_xml)

        try:
            raw_result = excel_parser.parse_contacts(temp_path)
            data = json.loads(raw_result)
            self.assertEqual(len(data["contacts"]), 2)
            self.assertEqual(data["sheetCount"], 2)
            self.assertEqual(data["contacts"][0]["phone"], "+998901112233")
            self.assertEqual(data["contacts"][0]["sheet"], "Toshkent")
            self.assertEqual(data["contacts"][1]["phone"], "+998904445566")
            self.assertEqual(data["contacts"][1]["sheet"], "Samarqand")
        finally:
            Path(temp_path).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()
