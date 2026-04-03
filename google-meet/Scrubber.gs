/**
 * PII/PHI scrubbing for meeting note ingestion.
 * Runs entirely within Google Workspace before data leaves.
 */

var REDACTED = '[REDACTED]';

// Default blocklist terms — sentences containing these are redacted
var DEFAULT_BLOCKLIST = [
  'diagnosis', 'prescription', 'ssn', 'social security',
  'date of birth', 'medical record', 'patient', 'hipaa'
];

/**
 * Scrub PII patterns from text using regex.
 * @param {string} text - Input text
 * @return {string} Text with PII replaced by [REDACTED]
 */
function scrubPii(text) {
  var patterns = [
    // SSN: 123-45-6789 or 123 45 6789
    /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,

    // Phone numbers: (123) 456-7890, 123-456-7890, +1 123 456 7890, etc.
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,

    // Email addresses
    /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,

    // Credit card numbers: 1234 5678 9012 3456 or 1234-5678-9012-3456
    /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b/g,

    // Date of birth patterns: DOB: 01/15/1990, born 1990-01-15, etc.
    /\b(?:DOB|dob|date of birth|born)[:\s]*\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b/gi,
    /\b(?:DOB|dob|date of birth|born)[:\s]*\d{4}[\/\-]\d{1,2}[\/\-]\d{1,2}\b/gi,

    // Medical record numbers: MRN: 12345678, MRN#12345678
    /\b(?:MRN|mrn)[#:\s]*\d{4,}\b/gi
  ];

  var result = text;
  for (var i = 0; i < patterns.length; i++) {
    result = result.replace(patterns[i], REDACTED);
  }
  return result;
}

/**
 * Redact sentences containing blocklisted terms.
 * @param {string} text - Input text
 * @param {string[]} extraTerms - Additional blocklist terms from config
 * @return {string} Text with matching sentences replaced
 */
function scrubBlocklist(text, extraTerms) {
  var terms = DEFAULT_BLOCKLIST.slice();
  if (extraTerms && extraTerms.length > 0) {
    terms = terms.concat(extraTerms);
  }

  if (terms.length === 0) return text;

  // Build case-insensitive pattern matching any term
  var escaped = terms.map(function(t) {
    return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  });
  var pattern = new RegExp('\\b(' + escaped.join('|') + ')\\b', 'i');

  // Split into sentences, redact any that match
  var sentences = text.split(/(?<=[.!?\n])\s+/);
  var result = sentences.map(function(sentence) {
    return pattern.test(sentence) ? REDACTED : sentence;
  });

  return result.join(' ');
}

/**
 * Check if a meeting should be skipped entirely based on title labels.
 * @param {string} meetingTitle - The meeting title or doc title
 * @param {string[]} skipLabels - Labels that trigger a full skip
 * @return {boolean} True if the meeting should be skipped
 */
function shouldSkip(meetingTitle, skipLabels) {
  if (!meetingTitle || !skipLabels || skipLabels.length === 0) return false;

  var titleUpper = meetingTitle.toUpperCase();
  for (var i = 0; i < skipLabels.length; i++) {
    var label = skipLabels[i].trim().toUpperCase();
    if (label && titleUpper.indexOf('[' + label + ']') !== -1) {
      return true;
    }
  }
  return false;
}
