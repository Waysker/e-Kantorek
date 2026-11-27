// e-Kantorek: webhook Apps Script dla KOPII arkusza obecności.
// Przyjmuje od supabase_to_sheet_export akcje ensure_attendance_sheet,
// ensure_attendance_column i set_attendance_cell i zapisuje wpisy z aplikacji
// (app_attendance_entries) do kopii. Oryginał arkusza nigdy tu nie trafia.
//
// Instalacja: docs/ops/attendance-copy-sheet.md
// Właściwość skryptu: WEBHOOK_TOKEN = ATTENDANCE_APPS_SCRIPT_WEBHOOK_TOKEN z orbit.

function columnRefToNumber(columnRef) {
  var normalized = String(columnRef || "").toUpperCase();
  var col = 0;
  for (var i = 0; i < normalized.length; i++) {
    col = col * 26 + (normalized.charCodeAt(i) - 64);
  }
  return col;
}

function numberToColumnRef(columnNumber) {
  var n = Number(columnNumber || 0);
  var label = "";
  while (n > 0) {
    var remainder = (n - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function normalizeIsoDate(raw) {
  var value = String(raw || "").trim();
  var exact = value.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (exact) return exact[1];
  var fromIso = value.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (fromIso) return fromIso[1];
  return "";
}

function monthKeyFromIsoDate(isoDate) {
  return String(isoDate || "").slice(0, 7);
}

function monthLabelFromIsoDate(isoDate) {
  var monthKey = monthKeyFromIsoDate(isoDate);
  if (!monthKey) return "";
  return "Obecnosc " + monthKey;
}

function normalizeSearchText(value) {
  var text = String(value || "");
  if (typeof text.normalize === "function") {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

var MONTH_KEYWORDS = [
  { month: 1, keywords: ["styczen", "stycznia", "jan", "january"] },
  { month: 2, keywords: ["luty", "lutego", "feb", "february"] },
  { month: 3, keywords: ["marzec", "marca", "mar", "march"] },
  { month: 4, keywords: ["kwiecien", "kwietnia", "apr", "april"] },
  { month: 5, keywords: ["maj", "maja", "may"] },
  { month: 6, keywords: ["czerwiec", "czerwca", "jun", "june"] },
  { month: 7, keywords: ["lipiec", "lipca", "jul", "july"] },
  { month: 8, keywords: ["sierpien", "sierpnia", "aug", "august"] },
  { month: 9, keywords: ["wrzesien", "wrzesnia", "sep", "september"] },
  { month: 10, keywords: ["pazdziernik", "pazdziernika", "oct", "october"] },
  { month: 11, keywords: ["listopad", "listopada", "nov", "november"] },
  { month: 12, keywords: ["grudzien", "grudnia", "dec", "december"] }
];

function parseYearToken(token) {
  var value = String(token || "").trim();
  if (!/^\d{2,4}$/.test(value)) return null;
  if (value.length === 4) return Number(value);
  var yy = Number(value);
  return yy >= 70 ? (1900 + yy) : (2000 + yy);
}

function parseMonthKey(monthKey) {
  var match = String(monthKey || "").match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year: year, month: month };
}

function resolveMonthFromName(normalizedName) {
  for (var i = 0; i < MONTH_KEYWORDS.length; i++) {
    var entry = MONTH_KEYWORDS[i];
    for (var j = 0; j < entry.keywords.length; j++) {
      if (normalizedName.indexOf(entry.keywords[j]) >= 0) {
        return entry.month;
      }
    }
  }
  return null;
}

function parseYearMonthFromSheetName(sheetName) {
  var raw = String(sheetName || "").trim();
  if (!raw) return null;

  var isoLike = raw.match(/\b(20\d{2})[.\-_/ ](0?[1-9]|1[0-2])\b/);
  if (isoLike) {
    return { year: Number(isoLike[1]), month: Number(isoLike[2]) };
  }

  var reversedIsoLike = raw.match(/\b(0?[1-9]|1[0-2])[.\-_/ ](20\d{2})\b/);
  if (reversedIsoLike) {
    return { year: Number(reversedIsoLike[2]), month: Number(reversedIsoLike[1]) };
  }

  var normalized = normalizeSearchText(raw);
  if (!normalized) return null;
  var month = resolveMonthFromName(normalized);
  if (!month) return null;

  var tokens = normalized.split(" ");
  var year = null;
  for (var idx = 0; idx < tokens.length; idx++) {
    var parsedYear = parseYearToken(tokens[idx]);
    if (parsedYear) {
      year = parsedYear;
      break;
    }
  }
  if (!year) return null;

  return { year: year, month: month };
}

function headerContainsMonth(sheet, targetYear, targetMonth) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 5) return false;

  var headerRow = sheet.getRange(1, 5, 1, lastColumn - 4).getDisplayValues()[0] || [];
  for (var i = 0; i < headerRow.length; i++) {
    var header = String(headerRow[i] || "").trim();
    if (!header) continue;

    var isoDate = normalizeIsoDate(header);
    var dateText = isoDate || header;
    var dateMatch = dateText.match(/\b(20\d{2})[.\-_/](0?[1-9]|1[0-2])[.\-_/](0?[1-9]|[12]\d|3[01])\b/);
    if (!dateMatch) continue;

    var year = Number(dateMatch[1]);
    var month = Number(dateMatch[2]);
    if (year === targetYear && month === targetMonth) {
      return true;
    }
  }

  return false;
}

function findMonthlyAttendanceSheet(ss, monthKey) {
  var parsedMonthKey = parseMonthKey(monthKey);
  if (!parsedMonthKey) return null;

  var directLabel = "Obecnosc " + monthKey;
  var direct = ss.getSheets().find(function (sheet) {
    return String(sheet.getName() || "").trim() === directLabel;
  });
  if (direct) return direct;

  var regex = new RegExp(monthKey.replace("-", "\\\\-"));
  var byMonthKeyInName = ss.getSheets().find(function (sheet) {
    return regex.test(String(sheet.getName() || "").trim());
  }) || null;
  if (byMonthKeyInName) return byMonthKeyInName;

  var byMonthNameAndYear = ss.getSheets().find(function (sheet) {
    var parsed = parseYearMonthFromSheetName(sheet.getName());
    return parsed &&
      parsed.year === parsedMonthKey.year &&
      parsed.month === parsedMonthKey.month;
  }) || null;
  if (byMonthNameAndYear) return byMonthNameAndYear;

  var byHeaderMonth = ss.getSheets().find(function (sheet) {
    return headerContainsMonth(sheet, parsedMonthKey.year, parsedMonthKey.month);
  }) || null;
  if (byHeaderMonth) return byHeaderMonth;

  return null;
}

function pickTemplateSheet(ss, suggestedGid, monthKey) {
  var allSheets = ss.getSheets();

  if (suggestedGid) {
    var fromGid = allSheets.find(function (sheet) {
      return String(sheet.getSheetId()) === String(suggestedGid);
    });
    if (fromGid) return fromGid;
  }

  var target = parseMonthKey(monthKey);
  if (!target) return allSheets[0] || null;

  var candidates = allSheets
    .map(function (sheet) {
      var parsed = parseYearMonthFromSheetName(sheet.getName());
      if (!parsed) return null;
      var distance = Math.abs((parsed.year - target.year) * 12 + (parsed.month - target.month));
      return { sheet: sheet, distance: distance };
    })
    .filter(function (item) { return item !== null; })
    .sort(function (a, b) { return a.distance - b.distance; });

  if (candidates.length > 0) {
    return candidates[0].sheet;
  }

  return allSheets[0] || null;
}

function findSheetByGidForMonth(ss, suggestedGid, monthKey) {
  if (!suggestedGid) return null;
  var sheet = ss.getSheets().find(function (s) {
    return String(s.getSheetId()) === String(suggestedGid);
  }) || null;
  if (!sheet) return null;
  // "Utwórz kopię" keeps tab gids, so the original's gid points at the same tab
  // here. Use it unless the tab name clearly belongs to another month.
  var parsedName = parseYearMonthFromSheetName(sheet.getName());
  var target = parseMonthKey(monthKey);
  if (parsedName && target && (parsedName.year !== target.year || parsedName.month !== target.month)) {
    return null;
  }
  return sheet;
}

function ensureAttendanceMonthSheet(ss, eventDate, suggestedGid) {
  var monthKey = monthKeyFromIsoDate(eventDate);
  if (!monthKey) {
    throw new Error("invalid_event_date");
  }

  var existing = findSheetByGidForMonth(ss, suggestedGid, monthKey) ||
    findMonthlyAttendanceSheet(ss, monthKey);
  if (existing) {
    return { sheet: existing, created: false };
  }

  var templateSheet = pickTemplateSheet(ss, suggestedGid, monthKey);
  if (!templateSheet) {
    throw new Error("template_sheet_not_found");
  }

  var created = templateSheet.copyTo(ss);
  // Keep sections and names (A–D) from the template, drop its event columns so
  // the new month does not inherit last month's attendance.
  if (created.getMaxColumns() > 5) {
    created.deleteColumns(6, created.getMaxColumns() - 5);
  }
  created.getRange(1, 5, created.getMaxRows(), 1).clearContent();
  var targetName = monthLabelFromIsoDate(eventDate);
  var finalName = targetName;
  var suffix = 2;
  while (ss.getSheets().some(function (sheet) { return sheet.getName() === finalName; })) {
    finalName = targetName + " (" + suffix + ")";
    suffix += 1;
  }
  created.setName(finalName);

  return { sheet: created, created: true };
}

function findColumnByDateToken(sheet, eventDate) {
  var headerRow = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0] || [];
  for (var i = 4; i < headerRow.length; i++) {
    var header = String(headerRow[i] || "").trim();
    if (!header) continue;
    if (header.indexOf(eventDate) >= 0) {
      return { columnNumber: i + 1, header: header, created: false };
    }
  }
  return null;
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildCanonicalHeader(eventDate, eventTitle, sourceHeader) {
  var normalizedEventDate = String(eventDate || "").trim();
  var preferred = String(sourceHeader || "").trim();
  var fallbackTitle = String(eventTitle || "").trim();
  var base = preferred || fallbackTitle;
  var dateRegex = normalizedEventDate
    ? new RegExp("\\b" + escapeRegex(normalizedEventDate) + "\\b", "g")
    : null;

  var titleWithoutDate = String(base || "")
    .replace(dateRegex || /$^/, " ")
    .replace(/\s+/g, " ")
    .trim();
  var fallbackTitleWithoutDate = String(fallbackTitle || "")
    .replace(dateRegex || /$^/, " ")
    .replace(/\s+/g, " ")
    .trim();
  var resolvedTitle = titleWithoutDate || fallbackTitleWithoutDate || "Proba";

  if (!normalizedEventDate) {
    return resolvedTitle;
  }

  return resolvedTitle + "\n" + normalizedEventDate;
}

function applyHeaderCellStyle(cell) {
  cell.setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  cell.setFontWeight("bold");
  cell.setHorizontalAlignment("center");
  cell.setVerticalAlignment("middle");
}

function ensureAttendanceColumn(sheet, eventDate, eventTitle, sourceHeader) {
  var existing = findColumnByDateToken(sheet, eventDate);
  var canonicalHeader = buildCanonicalHeader(eventDate, eventTitle, sourceHeader);

  if (existing) {
    var existingCell = sheet.getRange(1, existing.columnNumber);
    if (String(existing.header || "").trim() !== canonicalHeader) {
      existingCell.setValue(canonicalHeader);
    }
    applyHeaderCellStyle(existingCell);
    return { columnNumber: existing.columnNumber, header: canonicalHeader, created: false };
  }

  var lastColumn = Math.max(sheet.getLastColumn(), 4);
  var newColumn = lastColumn + 1;
  var headerCell = sheet.getRange(1, newColumn);
  headerCell.setValue(canonicalHeader);
  applyHeaderCellStyle(headerCell);
  return { columnNumber: newColumn, header: canonicalHeader, created: true };
}

function doPost(e) {
  try {
    var token = PropertiesService.getScriptProperties().getProperty("WEBHOOK_TOKEN");
    var auth = (e && e.parameter && e.parameter.token) || "";
    var body = JSON.parse(e.postData.contents || "{}");
    var providedToken = body.webhookToken || auth;
    if (!token || providedToken !== token) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "unauthorized" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var action = String(body.action || "").trim();
    var sheetId = String(body.sheetId || "");
    var gid = String(body.gid || "");
    var suggestedGid = String(body.suggestedGid || body.suggested_gid || gid || "");

    if (!action || !sheetId) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "invalid_payload" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.openById(sheetId);

    if (action === "ensure_attendance_sheet") {
      var ensuredEventDate = normalizeIsoDate(body.eventDate || body.event_date);
      if (!ensuredEventDate) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: "invalid_event_date" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var ensuredSheetResult = ensureAttendanceMonthSheet(ss, ensuredEventDate, suggestedGid);
      SpreadsheetApp.flush();
      return ContentService
        .createTextOutput(JSON.stringify({
          ok: true,
          action: action,
          gid: String(ensuredSheetResult.sheet.getSheetId()),
          title: ensuredSheetResult.sheet.getName(),
          created: ensuredSheetResult.created
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (!gid) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "missing_gid" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var targetSheet = ss.getSheets().find(function (s) {
      return String(s.getSheetId()) === gid;
    });
    if (!targetSheet) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "sheet_not_found" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action === "ensure_attendance_column") {
      var eventDate = normalizeIsoDate(body.eventDate || body.event_date);
      if (!eventDate) {
        return ContentService
          .createTextOutput(JSON.stringify({ ok: false, error: "invalid_event_date" }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      var eventTitle = String(body.eventTitle || body.event_title || "");
      var sourceHeader = String(body.sourceHeader || body.source_header || "");
      var ensured = ensureAttendanceColumn(targetSheet, eventDate, eventTitle, sourceHeader);
      SpreadsheetApp.flush();

      return ContentService
        .createTextOutput(JSON.stringify({
          ok: true,
          action: action,
          columnRef: numberToColumnRef(ensured.columnNumber),
          header: ensured.header,
          created: ensured.created
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    if (action !== "set_attendance_cell") {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "unsupported_action" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rowNumber = Number(body.rowNumber || 0);
    var attendanceRatio = Number(body.attendanceRatio);
    var eventDateHint = normalizeIsoDate(body.eventDate || body.event_date);
    var eventTitleHint = String(body.eventTitle || body.event_title || "");
    var sourceHeaderHint = String(body.sourceHeader || body.source_header || "");
    var columnRefRaw = String(body.columnRef || "").toUpperCase();

    if (!rowNumber || isNaN(attendanceRatio)) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "invalid_payload" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var columnNumber = columnRefRaw ? columnRefToNumber(columnRefRaw) : 0;
    if (!columnNumber && eventDateHint) {
      columnNumber = ensureAttendanceColumn(targetSheet, eventDateHint, eventTitleHint, sourceHeaderHint).columnNumber;
    }

    if (!columnNumber) {
      return ContentService
        .createTextOutput(JSON.stringify({ ok: false, error: "missing_column_ref" }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    targetSheet.getRange(rowNumber, columnNumber).setValue(attendanceRatio);
    SpreadsheetApp.flush();

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true, action: action, columnRef: numberToColumnRef(columnNumber) }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
