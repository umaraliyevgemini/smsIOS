import csv
import io
import json
import posixpath
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


PHONE_HEADERS = {
    "telefon",
    "tel",
    "raqam",
    "telefonraqam",
    "telefonraqami",
    "phone",
    "phonenumber",
    "mobile",
    "mobil",
    "number",
    "nomer",
}

FIRST_NAME_HEADERS = {
    "ism",
    "ismi",
    "name",
    "firstname",
    "first",
}

LAST_NAME_HEADERS = {
    "familiya",
    "familya",
    "surname",
    "lastname",
    "last",
}

FULL_NAME_HEADERS = {
    "fio",
    "fish",
    "fullname",
    "full",
    "ismfamiliya",
    "ismfamilya",
}


def parse_contacts(file_path):
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".csv":
        sheets_data = [("CSV", _read_csv(path))]
        source_type = "csv"
    elif suffix == ".xlsx":
        sheets_data = _read_xlsx(path)
        source_type = "xlsx"
    else:
        raise ValueError("Faqat .xlsx yoki .csv fayl tanlang.")

    parsed = _sheets_to_contacts(sheets_data)
    parsed["sourceType"] = source_type
    return json.dumps(parsed, ensure_ascii=False)


def _read_csv(path):
    raw = path.read_bytes()
    text = None
    for encoding in ("utf-8-sig", "utf-8", "cp1251"):
        try:
            text = raw.decode(encoding)
            break
        except UnicodeDecodeError:
            continue

    if text is None:
        text = raw.decode("latin-1")

    sample = text[:2048]
    try:
        dialect = csv.Sniffer().sniff(sample)
    except csv.Error:
        dialect = csv.excel

    return [list(row) for row in csv.reader(io.StringIO(text), dialect)]


def _read_xlsx(path):
    sheets_data = []
    with zipfile.ZipFile(path) as archive:
        shared_strings = _read_shared_strings(archive)
        sheet_paths = _all_sheet_paths(archive)

        for sheet_name, sheet_path in sheet_paths:
            try:
                with archive.open(sheet_path) as sheet_file:
                    root = ET.parse(sheet_file).getroot()

                rows = []
                for row_el in _iter_by_local_name(root, "row"):
                    row_values = []
                    for cell_el in _children_by_local_name(row_el, "c"):
                        cell_ref = cell_el.attrib.get("r", "")
                        col_index = _column_index(cell_ref)
                        while len(row_values) <= col_index:
                            row_values.append("")
                        row_values[col_index] = _cell_value(cell_el, shared_strings)
                    rows.append(row_values)
                if rows:
                    sheets_data.append((sheet_name, rows))
            except Exception:
                continue

    return sheets_data


def _read_shared_strings(archive):
    try:
        with archive.open("xl/sharedStrings.xml") as shared_file:
            root = ET.parse(shared_file).getroot()
    except KeyError:
        return []

    strings = []
    for si in _children_by_local_name(root, "si"):
        parts = []
        for text_node in _iter_by_local_name(si, "t"):
            parts.append(text_node.text or "")
        strings.append("".join(parts))
    return strings


def _all_sheet_paths(archive):
    sheet_list = []
    try:
        rels = {}
        if "xl/_rels/workbook.xml.rels" in archive.namelist():
            with archive.open("xl/_rels/workbook.xml.rels") as rels_file:
                rels_root = ET.parse(rels_file).getroot()
                for rel in _children_by_local_name(rels_root, "Relationship"):
                    rel_id = rel.attrib.get("Id")
                    target = rel.attrib.get("Target", "").lstrip("/")
                    if rel_id and target:
                        if not target.startswith("xl/"):
                            target = posixpath.normpath(posixpath.join("xl", target))
                        else:
                            target = posixpath.normpath(target)
                        rels[rel_id] = target

        with archive.open("xl/workbook.xml") as workbook_file:
            workbook_root = ET.parse(workbook_file).getroot()

        for sheet_el in _iter_by_local_name(workbook_root, "sheet"):
            name = sheet_el.attrib.get("name", "Sheet")
            rel_id = sheet_el.attrib.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            target_path = rels.get(rel_id)
            if target_path and target_path in archive.namelist():
                sheet_list.append((name, target_path))
    except Exception:
        pass

    if not sheet_list:
        for name in sorted(archive.namelist()):
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"):
                sheet_name = Path(name).stem
                sheet_list.append((sheet_name, name))

    return sheet_list


def _cell_value(cell_el, shared_strings):
    cell_type = cell_el.attrib.get("t")

    if cell_type == "inlineStr":
        return "".join(node.text or "" for node in _iter_by_local_name(cell_el, "t")).strip()

    value_el = _first_child_by_local_name(cell_el, "v")
    raw_value = (value_el.text or "") if value_el is not None else ""

    if cell_type == "s":
        try:
            return shared_strings[int(raw_value)].strip()
        except (ValueError, IndexError):
            return ""

    return raw_value.strip()


def _sheets_to_contacts(sheets_data):
    all_contacts = []
    all_warnings = []
    total_rows = 0
    seen_phones = set()

    if not sheets_data:
        return {"contacts": [], "warnings": ["Fayl bo'sh."], "totalRows": 0}

    multi_sheet = len(sheets_data) > 1

    for sheet_name, rows in sheets_data:
        if not rows:
            continue

        parsed_sheet = _rows_to_contacts(
            rows,
            seen_phones=seen_phones,
            sheet_name=sheet_name if multi_sheet else None,
        )
        all_contacts.extend(parsed_sheet["contacts"])
        all_warnings.extend(parsed_sheet["warnings"])
        total_rows += parsed_sheet["totalRows"]

    return {
        "contacts": all_contacts,
        "warnings": all_warnings,
        "totalRows": total_rows,
        "sheetCount": len(sheets_data),
    }


def _rows_to_contacts(rows, seen_phones=None, sheet_name=None):
    warnings = []
    if seen_phones is None:
        seen_phones = set()

    if not rows:
        return {"contacts": [], "warnings": ["Fayl bo'sh."], "totalRows": 0}

    header_index, columns = _detect_columns(rows)
    contacts = []
    prefix = f"[{sheet_name}] " if sheet_name else ""

    data_rows = rows[header_index + 1 :]
    for offset, row in enumerate(data_rows, start=header_index + 2):
        row = _pad_row(row, columns["max_index"] + 1)
        raw_phone = _get(row, columns.get("phone"))
        phone = _normalize_phone(raw_phone)

        if not phone:
            if any(str(cell).strip() for cell in row):
                warnings.append(f"{prefix}{offset}-qatorda telefon raqam topilmadi.")
            continue

        if phone in seen_phones:
            warnings.append(
                f"{prefix}{offset}-qatorda takroriy telefon raqam o'tkazib yuborildi: {phone}"
            )
            continue

        first_name = _get(row, columns.get("first_name")).strip()
        last_name = _get(row, columns.get("last_name")).strip()
        full_name = _get(row, columns.get("full_name")).strip()

        if full_name and not (first_name or last_name):
            first_name, last_name = _split_full_name(full_name)

        contacts.append(
            {
                "firstName": first_name,
                "lastName": last_name,
                "phone": phone,
                "row": offset,
                "sheet": sheet_name,
            }
        )
        seen_phones.add(phone)

    return {
        "contacts": contacts,
        "warnings": warnings,
        "totalRows": max(len(rows) - header_index - 1, 0),
        "headerRow": header_index + 1,
    }


def _detect_columns(rows):
    best = None
    best_score = -1

    for index, row in enumerate(rows[:10]):
        columns = _columns_from_header(row)
        score = 0
        if columns.get("phone") is not None:
            score += 5
        if columns.get("first_name") is not None:
            score += 2
        if columns.get("last_name") is not None:
            score += 2
        if columns.get("full_name") is not None:
            score += 2

        if score > best_score:
            best = (index, columns)
            best_score = score

    if best and best_score >= 5:
        header_index, columns = best
        columns["max_index"] = max(value for value in columns.values() if value is not None)
        return header_index, columns

    return -1, _fallback_columns(rows)


def _columns_from_header(row):
    columns = {"first_name": None, "last_name": None, "phone": None, "full_name": None}
    for index, value in enumerate(row):
        normalized = _normalize_header(value)
        if not normalized:
            continue
        if columns["phone"] is None and normalized in PHONE_HEADERS:
            columns["phone"] = index
        elif columns["first_name"] is None and normalized in FIRST_NAME_HEADERS:
            columns["first_name"] = index
        elif columns["last_name"] is None and normalized in LAST_NAME_HEADERS:
            columns["last_name"] = index
        elif columns["full_name"] is None and normalized in FULL_NAME_HEADERS:
            columns["full_name"] = index
    return columns


def _fallback_columns(rows):
    sample_rows = rows[:20]
    max_cols = max(1, max((len(row) for row in sample_rows), default=3))
    phone_scores = []

    for col_index in range(max_cols):
        score = 0
        for row in sample_rows:
            if _normalize_phone(_get(row, col_index)):
                score += 1
        phone_scores.append(score)

    phone_index = 2 if max_cols >= 3 else max_cols - 1
    if phone_scores and max(phone_scores) > 0:
        phone_index = phone_scores.index(max(phone_scores))

    if phone_index == 0:
        columns = {"first_name": 1, "last_name": 2 if max_cols > 2 else None, "phone": 0}
    elif phone_index == 1:
        columns = {"first_name": None, "last_name": None, "full_name": 0, "phone": 1}
    else:
        columns = {"first_name": 0, "last_name": 1 if max_cols > 1 else None, "phone": phone_index}

    columns.setdefault("full_name", None)
    columns["max_index"] = max(value for value in columns.values() if value is not None)
    return columns


def _normalize_header(value):
    return re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())


def _normalize_phone(value):
    text = str(value).strip()
    if not text:
        return ""

    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    elif "e+" in text.lower() or "e-" in text.lower():
        try:
            val = float(text)
            text = f"{int(val)}"
        except (ValueError, OverflowError):
            pass

    text = text.replace("\u00a0", " ")
    has_plus = text.startswith("+")
    digits = re.sub(r"\D", "", text)

    if not digits:
        return ""

    if digits.startswith("00998"):
        digits = digits[2:]
        has_plus = True

    if digits.startswith("998") and len(digits) == 12:
        return "+" + digits

    if len(digits) == 9:
        return "+998" + digits

    if len(digits) == 10 and digits[0] in ("8", "0"):
        return "+998" + digits[1:]

    if has_plus:
        return "+" + digits

    if digits.startswith("998"):
        return "+" + digits

    if len(digits) >= 7:
        return "+998" + digits

    return ""


def _split_full_name(full_name):
    parts = full_name.split()
    if not parts:
        return "", ""
    if len(parts) == 1:
        return parts[0], ""
    return parts[0], " ".join(parts[1:])


def _column_index(cell_ref):
    letters = "".join(ch for ch in cell_ref if ch.isalpha()).upper()
    if not letters:
        return 0
    index = 0
    for letter in letters:
        index = index * 26 + (ord(letter) - ord("A") + 1)
    return index - 1


def _iter_by_local_name(root, local_name):
    for element in root.iter():
        if _local_name(element.tag) == local_name:
            yield element


def _children_by_local_name(root, local_name):
    for element in list(root):
        if _local_name(element.tag) == local_name:
            yield element


def _first_child_by_local_name(root, local_name):
    return next(_children_by_local_name(root, local_name), None)


def _local_name(tag):
    return tag.rsplit("}", 1)[-1]


def _pad_row(row, length):
    if len(row) >= length:
        return row
    return row + [""] * (length - len(row))


def _get(row, index):
    if index is None or index >= len(row):
        return ""
    return str(row[index])
