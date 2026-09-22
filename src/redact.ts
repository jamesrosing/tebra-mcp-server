/**
 * Log/error redaction for SOAP and FHIR payloads.
 *
 * Anything that reaches stderr may be persisted to disk by the MCP host
 * (Claude Desktop writes server stderr to a log file), so request and
 * response bodies must be scrubbed of credentials AND patient identifiers
 * before they are logged. Redaction is deliberately broad: a tag whose
 * local name merely looks like it could hold an identifier is blanked.
 * Over-redacting a debug log costs nothing; under-redacting leaks PHI.
 */

const SECRET_TAGS = ['User', 'Password', 'CustomerKey'];

/**
 * Local-name fragments that mark a leaf element as PHI. Matched
 * case-insensitively against the element's local name (prefix stripped).
 * Covers the HIPAA identifier set as it appears in Tebra's WSDL:
 * names, dates of birth, SSN, phone/fax, email, street/zip, MRN, policy
 * and group numbers, external IDs, and free-text notes.
 */
const PHI_TAG_PATTERN =
  /name|dob|birth|ssn|social|phone|fax|email|address|street|zip|postal|mrn|medicalrecord|note|comment|number|externalid|guarantor|employer|filecontent/i;

// Leaf element: <prefix:Local attrs?>text</prefix:Local>
const LEAF_ELEMENT = /<((?:[\w-]+:)?([\w.-]+))(\s[^>]*)?>([^<]+)<\/\1>/g;

/** Blank the SOAP RequestHeader credentials. */
export function redactSecrets(xml: string): string {
  return SECRET_TAGS.reduce(
    (out, tag) =>
      out.replace(new RegExp(`<((?:[\\w-]+:)?${tag})>[^<]*</\\1>`, 'g'), `<$1>***</$1>`),
    xml
  );
}

/** Blank the text of every leaf element whose local name looks like a patient identifier. */
export function redactPhi(xml: string): string {
  return xml.replace(LEAF_ELEMENT, (match, qualified: string, local: string, attrs: string | undefined) =>
    PHI_TAG_PATTERN.test(local) ? `<${qualified}${attrs ?? ''}>***</${qualified}>` : match
  );
}

/** Full scrub for anything written to stderr: credentials first, then PHI. */
export function redactForLog(xml: string): string {
  return redactPhi(redactSecrets(xml));
}

/**
 * Collect the values of every PHI-tagged leaf element in a request body,
 * so a server error that echoes them ("Patient Jane Doe already exists")
 * can be scrubbed before the message is surfaced. Returns longest-first
 * so a full name is replaced before its parts. XML entities are decoded
 * because Tebra echoes the decoded value.
 */
export function phiValues(xml: string): string[] {
  const values = new Set<string>();
  for (const m of xml.matchAll(LEAF_ELEMENT)) {
    const [, , local, , text] = m;
    const value = decodeEntities(text.trim());
    if (PHI_TAG_PATTERN.test(local) && value.length >= 2) values.add(value);
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Replace every known PHI value (and each whitespace-separated word of it) with `***`. */
export function scrubValues(text: string, values: string[]): string {
  const tokens = new Set<string>();
  for (const v of values) {
    tokens.add(v);
    for (const word of v.split(/\s+/)) if (word.length >= 3) tokens.add(word);
  }
  return [...tokens]
    .sort((a, b) => b.length - a.length)
    .reduce((out, token) => out.split(token).join('***'), text);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
