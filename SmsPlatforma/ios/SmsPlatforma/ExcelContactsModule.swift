import Foundation
import UIKit
import UniformTypeIdentifiers

// MARK: - ExcelContacts Native Module

@objc(ExcelContacts)
class ExcelContactsModule: NSObject {
    private var pendingResolve: ((Any?) -> Void)?
    private var pendingReject: ((String?, String?, Error?) -> Void)?

    @objc static func requiresMainQueueSetup() -> Bool { true }

    @objc func pickAndParse(
        _ resolve: @escaping (Any?) -> Void,
        rejecter reject: @escaping (String?, String?, Error?) -> Void
    ) {
        guard pendingResolve == nil else {
            reject("PICKER_BUSY", "Oldingi fayl tanlash jarayoni hali tugamagan.", nil)
            return
        }
        pendingResolve = resolve
        pendingReject = reject

        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            var types: [UTType] = []
            if let xlsx = UTType(filenameExtension: "xlsx") { types.append(xlsx) }
            if let csv  = UTType(filenameExtension: "csv")  { types.append(csv) }
            if types.isEmpty { types = [.spreadsheet, .commaSeparatedText] }

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: types)
            picker.delegate = self
            picker.allowsMultipleSelection = false

            guard let topVC = Self.topVC() else {
                self.pendingReject?("NO_VIEW_CONTROLLER", "Ilova oynasi topilmadi.", nil)
                self.cleanup(); return
            }
            topVC.present(picker, animated: true)
        }
    }

    fileprivate func cleanup() { pendingResolve = nil; pendingReject = nil }

    fileprivate static func topVC() -> UIViewController? {
        guard let w = UIApplication.shared.delegate?.window, let root = w?.rootViewController else { return nil }
        var top = root
        while let p = top.presentedViewController { top = p }
        return top
    }
}

// MARK: - Document Picker Delegate

extension ExcelContactsModule: UIDocumentPickerDelegate {
    func documentPicker(_ c: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let url = urls.first else {
            pendingReject?("PICK_FAILED", "Fayl tanlanmadi.", nil); cleanup(); return
        }
        let resolve = pendingResolve; let reject = pendingReject; cleanup()

        DispatchQueue.global(qos: .userInitiated).async {
            do {
                let secured = url.startAccessingSecurityScopedResource()
                defer { if secured { url.stopAccessingSecurityScopedResource() } }
                let data = try Data(contentsOf: url)
                let name = url.lastPathComponent.lowercased()
                let json = try name.hasSuffix(".csv")
                    ? CSVContactsParser.parse(data: data)
                    : XLSXContactsParser.parse(data: data)
                resolve?(json)
            } catch {
                reject?("PARSE_FAILED", error.localizedDescription, error as NSError)
            }
        }
    }

    func documentPickerWasCancelled(_ c: UIDocumentPickerViewController) {
        pendingReject?("PICK_CANCELLED", "Fayl tanlanmadi.", nil); cleanup()
    }
}

// MARK: - CSV Parser

private enum CSVContactsParser {
    static func parse(data raw: Data) throws -> String {
        var d = raw
        if d.count >= 3 && d[d.startIndex] == 0xEF && d[d.startIndex+1] == 0xBB && d[d.startIndex+2] == 0xBF {
            d = d.subdata(in: d.startIndex+3..<d.endIndex)
        }
        guard let text = String(data: d, encoding: .utf8)
                ?? String(data: d, encoding: .windowsCP1251)
                ?? String(data: d, encoding: .isoLatin1) else {
            throw Err("Fayl kodlash formati aniqlanmadi.")
        }
        let lines = text.components(separatedBy: .newlines).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard !lines.isEmpty else { return J.build(contacts: [], warnings: ["Fayl bo'sh."], src: "CSV") }

        let sep = detectSep(lines[0])
        let headers = csvLine(lines[0], sep).map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }
        let pi = Col.phone(headers), fi = Col.firstName(headers), li = Col.lastName(headers)
        guard let phoneIdx = pi else {
            return J.build(contacts: [], warnings: ["Telefon raqam ustuni topilmadi."], src: "CSV")
        }

        var contacts: [[String: Any]] = []
        for i in 1..<lines.count {
            let f = csvLine(lines[i], sep)
            guard phoneIdx < f.count else { continue }
            let phone = f[phoneIdx].trimmingCharacters(in: .whitespacesAndNewlines)
            if phone.isEmpty { continue }
            var c: [String: Any] = ["phone": phone, "row": i + 1]
            if let x = fi, x < f.count { c["firstName"] = f[x].trimmingCharacters(in: .whitespacesAndNewlines) }
            if let x = li, x < f.count { c["lastName"] = f[x].trimmingCharacters(in: .whitespacesAndNewlines) }
            contacts.append(c)
        }
        return J.build(contacts: contacts, warnings: [], src: "CSV", headerRow: 1, totalRows: lines.count)
    }

    private static func detectSep(_ line: String) -> Character {
        let c = line.filter { $0 == "," }.count
        let s = line.filter { $0 == ";" }.count
        let t = line.filter { $0 == "\t" }.count
        if t >= c && t >= s && t > 0 { return "\t" }
        return s > c ? ";" : ","
    }

    private static func csvLine(_ line: String, _ sep: Character) -> [String] {
        var fields: [String] = []; var cur = ""; var inQ = false
        let chars = Array(line); var i = 0
        while i < chars.count {
            let ch = chars[i]
            if inQ {
                if ch == "\"" {
                    if i+1 < chars.count && chars[i+1] == "\"" { cur.append("\""); i += 2; continue }
                    else { inQ = false; i += 1; continue }
                } else { cur.append(ch) }
            } else {
                if ch == "\"" { inQ = true }
                else if ch == sep { fields.append(cur); cur = "" }
                else { cur.append(ch) }
            }
            i += 1
        }
        fields.append(cur); return fields
    }
}

// MARK: - XLSX Parser

private enum XLSXContactsParser {
    static func parse(data: Data) throws -> String {
        let zip = try ZipRead(data: data)
        let ss: [String] = (try? zip.extract("xl/sharedStrings.xml")).map { SSXml.parse($0) } ?? []
        let sheetNames: [String] = (try? zip.extract("xl/workbook.xml")).map { WBXml.parse($0) } ?? []
        let wsPaths = zip.names().filter { $0.hasPrefix("xl/worksheets/sheet") && $0.hasSuffix(".xml") }.sorted()

        var allC: [[String: Any]] = [], allW: [String] = [], total = 0, hdr = 0
        for (idx, path) in wsPaths.enumerated() {
            guard let wsData = try? zip.extract(path) else { continue }
            let label = idx < sheetNames.count ? sheetNames[idx] : "Sheet\(idx+1)"
            let rows = WSXml.parse(wsData, ss: ss)
            guard !rows.isEmpty else { continue }
            let headers = rows[0].map { $0.lowercased().trimmingCharacters(in: .whitespacesAndNewlines) }
            let pi = Col.phone(headers), fi = Col.firstName(headers), li = Col.lastName(headers)
            guard let phoneIdx = pi else { allW.append("\(label): telefon ustuni topilmadi"); continue }
            if hdr == 0 { hdr = 1 }
            for r in 1..<rows.count {
                let row = rows[r]
                guard phoneIdx < row.count else { continue }
                let phone = row[phoneIdx].trimmingCharacters(in: .whitespacesAndNewlines)
                if phone.isEmpty { continue }
                var c: [String: Any] = ["phone": phone, "row": r+1, "sheet": label]
                if let x = fi, x < row.count { c["firstName"] = row[x].trimmingCharacters(in: .whitespacesAndNewlines) }
                if let x = li, x < row.count { c["lastName"] = row[x].trimmingCharacters(in: .whitespacesAndNewlines) }
                allC.append(c)
            }
            total += rows.count
        }
        return J.build(contacts: allC, warnings: allW, src: "XLSX", headerRow: hdr, totalRows: total, sheets: wsPaths.count)
    }
}

// MARK: - Minimal ZIP Reader (zlib raw deflate)

private class ZipRead {
    private let data: Data
    private var entries: [E] = []
    struct E { let name: String; let method: UInt16; let cSize: Int; let uSize: Int; let locOff: Int }

    init(data: Data) throws { self.data = data; try readCD() }
    func names() -> [String] { entries.map(\.name) }

    func extract(_ name: String) throws -> Data {
        guard let e = entries.first(where: { $0.name == name }) else { throw ZErr.notFound(name) }
        let loc = e.locOff
        guard loc+30 <= data.count, r32(loc) == 0x04034b50 else { throw ZErr.bad }
        let nLen = Int(r16(loc+26)), xLen = Int(r16(loc+28))
        let start = loc + 30 + nLen + xLen
        guard start + e.cSize <= data.count else { throw ZErr.bad }
        let compressed = data[start..<start+e.cSize]
        switch e.method {
        case 0: return Data(compressed)
        case 8: return try inflate(Data(compressed), size: e.uSize)
        default: throw ZErr.bad
        }
    }

    private func readCD() throws {
        var eocd = -1
        for i in stride(from: data.count-22, through: max(0, data.count-65557), by: -1) {
            if r32(i) == 0x06054b50 { eocd = i; break }
        }
        guard eocd >= 0 else { throw ZErr.bad }
        let count = Int(r16(eocd+10)); var off = Int(r32(eocd+16))
        for _ in 0..<count {
            guard off+46 <= data.count, r32(off) == 0x02014b50 else { break }
            let m = r16(off+10), cs = Int(r32(off+20)), us = Int(r32(off+24))
            let nl = Int(r16(off+28)), xl = Int(r16(off+30)), cl = Int(r16(off+32)), lo = Int(r32(off+42))
            let nm = String(data: data[off+46..<off+46+nl], encoding: .utf8) ?? ""
            entries.append(E(name: nm, method: m, cSize: cs, uSize: us, locOff: lo))
            off += 46 + nl + xl + cl
        }
    }

    private func inflate(_ input: Data, size: Int) throws -> Data {
        guard size > 0 else { return Data() }
        let cap = size + 512
        let dest = UnsafeMutablePointer<UInt8>.allocate(capacity: cap)
        defer { dest.deallocate() }
        let out: Int = try input.withUnsafeBytes { src in
            guard let base = src.baseAddress else { throw ZErr.bad }
            var s = z_stream()
            s.next_in = UnsafeMutablePointer<Bytef>(mutating: base.assumingMemoryBound(to: Bytef.self))
            s.avail_in = uInt(input.count); s.next_out = dest; s.avail_out = uInt(cap)
            guard sms_inflateInit2(&s, -15) == Z_OK else { throw ZErr.bad }
            defer { sms_zlib_inflateEnd(&s) }
            guard sms_zlib_inflate(&s, Z_FINISH) == Z_STREAM_END else { throw ZErr.bad }
            return Int(s.total_out)
        }
        return Data(bytes: dest, count: out)
    }

    private func r16(_ o: Int) -> UInt16 {
        guard o+2 <= data.count else { return 0 }
        return UInt16(data[o]) | UInt16(data[o+1]) << 8
    }
    private func r32(_ o: Int) -> UInt32 {
        guard o+4 <= data.count else { return 0 }
        return UInt32(data[o]) | UInt32(data[o+1])<<8 | UInt32(data[o+2])<<16 | UInt32(data[o+3])<<24
    }
    enum ZErr: LocalizedError {
        case bad, notFound(String)
        var errorDescription: String? {
            switch self { case .bad: return "XLSX fayl o'qilmadi"; case .notFound(let n): return "'\(n)' topilmadi" }
        }
    }
}

// MARK: - XML Parsers

private class SSXml: NSObject, XMLParserDelegate {
    private var strings: [String] = []; private var buf = ""; private var inSI = false; private var inT = false
    static func parse(_ data: Data) -> [String] {
        let p = SSXml(); let x = XMLParser(data: data); x.delegate = p; x.parse(); return p.strings
    }
    func parser(_ p: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes: [String:String]=[:]){
        if e == "si" { inSI = true; buf = "" } else if e == "t" && inSI { inT = true }
    }
    func parser(_ p: XMLParser, foundCharacters s: String) { if inT { buf += s } }
    func parser(_ p: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
        if e == "t" { inT = false } else if e == "si" { strings.append(buf); inSI = false }
    }
}

private class WBXml: NSObject, XMLParserDelegate {
    private var names: [String] = []
    static func parse(_ data: Data) -> [String] {
        let p = WBXml(); let x = XMLParser(data: data); x.delegate = p; x.parse(); return p.names
    }
    func parser(_ p: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes: [String:String]=[:]){
        if e == "sheet", let n = attributes["name"] { names.append(n) }
    }
}

private class WSXml: NSObject, XMLParserDelegate {
    private let ss: [String]; private var rows: [[String]] = []; private var row: [String] = []
    private var val = ""; private var typ: String?; private var inR = false; private var inC = false; private var inV = false; private var col = 0

    init(ss: [String]) { self.ss = ss }
    static func parse(_ data: Data, ss: [String]) -> [[String]] {
        let p = WSXml(ss: ss); let x = XMLParser(data: data); x.delegate = p; x.parse(); return p.rows
    }

    func parser(_ p: XMLParser, didStartElement e: String, namespaceURI: String?, qualifiedName: String?, attributes: [String:String]=[:]){
        switch e {
        case "row": inR = true; row = []; col = 0
        case "c" where inR: inC = true; typ = attributes["t"]; val = ""
            if let r = attributes["r"] { col = Self.colIdx(r) }
        case "v" where inC, "t" where inC: inV = true; val = ""
        default: break
        }
    }
    func parser(_ p: XMLParser, foundCharacters s: String) { if inV { val += s } }
    func parser(_ p: XMLParser, didEndElement e: String, namespaceURI: String?, qualifiedName: String?) {
        switch e {
        case "v" where inC, "t" where inC: inV = false
        case "c":
            let v: String
            if typ == "s", let i = Int(val), i < ss.count { v = ss[i] }
            else if let n = Double(val), typ == nil || typ == "n" {
                v = n == n.rounded(.towardZero) && abs(n) < 1e15 ? String(format: "%.0f", n) : val
            } else { v = val }
            while row.count <= col { row.append("") }; row[col] = v; inC = false; col += 1
        case "row": rows.append(row); inR = false
        default: break
        }
    }

    static func colIdx(_ ref: String) -> Int {
        var i = 0
        for ch in ref where ch.isLetter { i = i * 26 + Int(ch.uppercased().first!.asciiValue! - 65) + 1 }
        return max(i - 1, 0)
    }
}

// MARK: - Column Detection

private enum Col {
    static let pk = ["telefon","phone","tel","raqam","number","nomer","mob","mobile"]
    static let fk = ["ism","name","firstname","first_name","nom"]
    static let lk = ["familiya","familya","lastname","last_name","surname"]
    static func phone(_ h: [String]) -> Int? { find(h, pk) }
    static func firstName(_ h: [String]) -> Int? { find(h, fk) }
    static func lastName(_ h: [String]) -> Int? { find(h, lk) }
    private static func find(_ h: [String], _ keys: [String]) -> Int? {
        for (i, v) in h.enumerated() { if keys.contains(where: { v.contains($0) }) { return i } }; return nil
    }
}

// MARK: - JSON Builder

private enum J {
    static func build(contacts: [[String:Any]], warnings: [String], src: String,
                      headerRow: Int = 1, totalRows: Int = 0, sheets: Int = 1) -> String {
        let obj: [String:Any] = ["contacts": contacts, "warnings": warnings, "sourceType": src,
                                  "headerRow": headerRow, "totalRows": totalRows, "sheetCount": sheets]
        guard let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else {
            return "{\"contacts\":[],\"warnings\":[\"JSON xato\"]}"
        }
        return s
    }
}

private struct Err: LocalizedError { let errorDescription: String?; init(_ m: String) { errorDescription = m } }
