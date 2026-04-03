/**
 * Google Meet → Open Brain ingestion.
 * Watches for Gmail threads with a configured label,
 * extracts Gemini meeting summaries from linked Google Docs,
 * scrubs PII/PHI, and captures to Open Brain (AWS Enterprise).
 */

var MAX_PROCESSED_IDS = 500;

/**
 * Main entry point — called by a time-driven trigger (every 5 min).
 * Finds labeled threads, processes each meeting doc, removes label.
 */
function processNewMeetings() {
  var props = PropertiesService.getScriptProperties();

  if (props.getProperty('ENABLED') !== 'true') return;

  var labelName = props.getProperty('GMAIL_LABEL') || 'open-brain/to-ingest';
  var label = GmailApp.getUserLabelByName(labelName);
  if (!label) {
    Logger.log('Label "' + labelName + '" not found. Create it in Gmail first.');
    return;
  }

  var threads = label.getThreads(0, 10); // Process up to 10 per run
  if (threads.length === 0) return;

  var skipLabels = getListProperty_(props, 'SKIP_LABELS');
  var piiBlocklist = getListProperty_(props, 'PII_BLOCKLIST');
  var processedIds = getProcessedIds_(props);

  for (var i = 0; i < threads.length; i++) {
    try {
      processThread_(threads[i], props, skipLabels, piiBlocklist, processedIds);
    } catch (e) {
      Logger.log('Error processing thread: ' + e.message);
    }
    // Remove label regardless of success/failure to prevent reprocessing
    threads[i].removeLabel(label);
  }

  // Save updated processed IDs
  saveProcessedIds_(props, processedIds);
}

/**
 * Process a single email thread: extract doc, scrub, capture.
 * @private
 */
function processThread_(thread, props, skipLabels, piiBlocklist, processedIds) {
  var messages = thread.getMessages();
  var body = messages[0].getBody();
  var subject = messages[0].getSubject();

  // Extract Google Doc link from email body
  var docId = extractDocId_(body);
  if (!docId) {
    Logger.log('No Google Doc link found in email: ' + subject);
    return;
  }

  // Dedup check
  if (processedIds.indexOf(docId) !== -1) {
    Logger.log('Already processed doc ' + docId + ', skipping.');
    return;
  }

  // Open the doc
  var content = readDocContent_(docId);
  if (!content) {
    Logger.log('Could not read doc ' + docId);
    return;
  }

  // Extract meeting title (doc title or email subject)
  var meetingTitle = content.title || subject;

  // Check skip labels
  if (shouldSkip(meetingTitle, skipLabels)) {
    Logger.log('Skipping meeting (label match): ' + meetingTitle);
    processedIds.push(docId);
    return;
  }

  // Extract summary section (before "Transcript" heading)
  var summary = extractSummary_(content.body);
  if (!summary || summary.trim().length === 0) {
    Logger.log('No summary content found in doc: ' + meetingTitle);
    return;
  }

  // PII/PHI scrubbing
  var scrubbed = scrubPii(summary);
  scrubbed = scrubBlocklist(scrubbed, piiBlocklist);

  // Build the thought text with meeting context
  var date = messages[0].getDate();
  var dateStr = Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var thoughtText = 'Meeting: ' + meetingTitle + ' (' + dateStr + ')\n\n' + scrubbed;

  // Capture to Open Brain
  captureThought_(props, thoughtText);

  // Record as processed
  processedIds.push(docId);
  Logger.log('Captured meeting: ' + meetingTitle);
}

/**
 * Extract a Google Doc ID from an email body (HTML).
 * Looks for docs.google.com/document/d/{ID} links.
 * @param {string} html - Email body HTML
 * @return {string|null} Doc ID or null
 * @private
 */
function extractDocId_(html) {
  var match = html.match(/docs\.google\.com\/document\/d\/([\w-]+)/);
  return match ? match[1] : null;
}

/**
 * Read a Google Doc's title and body text.
 * Uses DriveApp to open by ID for reliability.
 * @param {string} docId - Google Doc ID
 * @return {{title: string, body: string}|null}
 * @private
 */
function readDocContent_(docId) {
  try {
    var doc = DocumentApp.openById(docId);
    return {
      title: doc.getName(),
      body: doc.getBody().getText()
    };
  } catch (e) {
    // Fall back to Drive API for docs that DocumentApp can't open
    try {
      var file = DriveApp.getFileById(docId);
      var blob = file.getBlob();
      return {
        title: file.getName(),
        body: blob.getDataAsString()
      };
    } catch (e2) {
      Logger.log('Failed to read doc ' + docId + ': ' + e2.message);
      return null;
    }
  }
}

/**
 * Extract the summary section from doc text.
 * Returns text before a "Transcript" heading, or the full text if no heading found.
 * @param {string} text - Full doc body text
 * @return {string} Summary portion
 * @private
 */
function extractSummary_(text) {
  // Look for common transcript section markers
  var markers = [
    /\n\s*Transcript\s*\n/i,
    /\n\s*Full Transcript\s*\n/i,
    /\n\s*Meeting Transcript\s*\n/i,
    /\n\s*---+\s*\n.*transcript/i
  ];

  for (var i = 0; i < markers.length; i++) {
    var match = text.search(markers[i]);
    if (match !== -1) {
      return text.substring(0, match).trim();
    }
  }

  // No transcript marker found — return full text (might be summary-only doc)
  return text;
}

/**
 * POST a thought to the Open Brain MCP endpoint.
 * @param {Properties} props - Script Properties
 * @param {string} text - The thought text to capture
 * @private
 */
function captureThought_(props, text) {
  var mcpUrl = props.getProperty('MCP_URL');
  var token = getAccessToken();

  var mcpPayload = {
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: {
      name: 'capture_thought',
      arguments: {
        text: text,
        scope: 'shared'
      }
    }
  };

  var response = UrlFetchApp.fetch(mcpUrl, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Authorization': 'Bearer ' + token
    },
    payload: JSON.stringify(mcpPayload),
    muteHttpExceptions: true
  });

  var code = response.getResponseCode();
  if (code !== 200) {
    throw new Error('MCP capture failed (' + code + '): ' + response.getContentText());
  }
}

// --- Helpers ---

/**
 * Get a comma-separated Script Property as an array.
 * @private
 */
function getListProperty_(props, key) {
  var val = props.getProperty(key);
  if (!val || val.trim() === '') return [];
  return val.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
}

/**
 * Load processed doc IDs from Script Properties.
 * @private
 */
function getProcessedIds_(props) {
  var raw = props.getProperty('PROCESSED_DOC_IDS');
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

/**
 * Save processed doc IDs, capping at MAX_PROCESSED_IDS (FIFO).
 * @private
 */
function saveProcessedIds_(props, ids) {
  while (ids.length > MAX_PROCESSED_IDS) {
    ids.shift();
  }
  props.setProperty('PROCESSED_DOC_IDS', JSON.stringify(ids));
}
