'use strict';

const invalid = () => { throw new Error('invalid_response'); };
const score = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const minimum = (values) => values.length && values.every(score) ? Math.min(...values) : null;

/** Only bounded lines leave the library adapter; no page-wide score or raw dump. */
function collectOcrLines(data, dimensions = null) {
  if (!data || typeof data !== 'object') return invalid();
  if (data.blocks === null) return [];
  if (dimensions && (!Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > 20_000_000)) return invalid();
  const result = [];
  let nodes = 0, bytes = 0;
  const array = (value) => {
    if (!Array.isArray(value) || value.length > 8192 || (nodes += value.length) > 8192) return invalid();
    return value;
  };
  for (const block of array(data.blocks)) {
    for (const paragraph of array(block?.paragraphs)) {
      for (const line of array(paragraph?.lines)) {
        if (typeof line?.text !== 'string' || line.text.length > 1024 || [...line.text].length > 512 || result.length >= 256) return invalid();
        bytes += Buffer.byteLength(line.text, 'utf8');
        if (bytes > 65536) return invalid();
        const words = array(line.words);
        const parsed = { text: line.text.trim(), confidence: minimum(words.map((word) => word?.confidence)) };
        if (dimensions) {
          const bbox = line.bbox;
          if (!bbox || !['x0', 'y0', 'x1', 'y1'].every((key) => typeof bbox[key] === 'number' && Number.isFinite(bbox[key])) ||
            bbox.x0 < 0 || bbox.y0 < 0 || bbox.x1 <= bbox.x0 || bbox.y1 <= bbox.y0 || bbox.x1 > dimensions.width || bbox.y1 > dimensions.height) return invalid();
          parsed.bbox = { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 };
        }
        result.push(parsed);
      }
    }
  }
  return result;
}

function toOcrLines(data) { return collectOcrLines(data); }

function toOcrLayoutV1(data, dimensions) {
  if (!dimensions || !Number.isSafeInteger(dimensions.width) || !Number.isSafeInteger(dimensions.height) || dimensions.width < 1 || dimensions.height < 1 || dimensions.width * dimensions.height > 20_000_000) return invalid();
  return { schemaVersion: 1, width: dimensions?.width, height: dimensions?.height, lines: collectOcrLines(data, dimensions) };
}

function extractKycFields(sides, documentType) {
  const unknown = { holderName: null, documentNumber: null, expiryDate: null, confidence: null, unreadable: true };
  // Other layouts require independent quality evidence before adding rules.
  if (documentType !== 'national_id') return unknown;
  const numbers = new Map(), names = new Map();
  for (const lines of [sides.front, sides.back]) {
    if (!Array.isArray(lines) || lines.length > 256) return invalid();
    for (let index = 0; index < lines.length; index += 1) {
      const { text, confidence } = lines[index];
      if (typeof text !== 'string' || text.length > 1024) return invalid();
      for (const match of text.matchAll(/(?<!\d)\d{6}[- ]?\d{2}[- ]?\d{4}(?!\d)/g)) {
        const key = match[0].replace(/[- ]/g, '');
        numbers.set(key, [...(numbers.get(key) ?? []), confidence]);
      }
      const label = /^(?:NAME|NAMA|FULL NAME|NAMA PENUH|NAMA\s*\/\s*NAME)\s*(?::\s*(.*))?$/i.exec(text.trim());
      if (label) {
        const value = (label[1] || lines[index + 1]?.text || '').trim();
        if (value.length >= 2 && value.length <= 160 && /^[\p{L}\p{M} .,'’/@()-]+$/u.test(value) && !/^(?:NAME|NAMA)$/i.test(value)) {
          const key = value.normalize('NFKC').replace(/\s+/g, ' ').toUpperCase();
          names.set(key, [...(names.get(key) ?? []), confidence, ...(label[1] ? [] : [lines[index + 1]?.confidence])]);
        }
      }
    }
  }
  const documentNumber = numbers.size === 1 ? numbers.keys().next().value : null;
  const holderName = names.size === 1 ? names.keys().next().value : null;
  const confidence = documentNumber && holderName ? minimum([...numbers.get(documentNumber), ...names.get(holderName)]) : null;
  return { holderName, documentNumber, expiryDate: null, confidence: confidence === null ? null : confidence / 100, unreadable: documentNumber === null };
}

/** Research-only locator for a manually aligned reference card face. */
function extractMykadLayoutFieldsV1(layout, options) {
  const unknown = { holderName: null, documentNumber: null, layoutStatus: 'unknown', unreadable: true };
  if (!layout || layout.schemaVersion !== 1 || !Number.isSafeInteger(layout.width) || !Number.isSafeInteger(layout.height) ||
    layout.width < 1 || layout.height < 1 || layout.width * layout.height > 20_000_000 || !Array.isArray(layout.lines) || layout.lines.length > 256 ||
    !options || Object.keys(options).length !== 2 || options.layout !== 'mykad-front-reference-v1' || options.alignment !== 'manual-card-aligned') return unknown;
  const nameBox = { x0: layout.width * 0.03, y0: layout.height * 0.58, x1: layout.width * 0.55, y1: layout.height * 0.82 };
  const numberBox = { x0: layout.width * 0.03, y0: layout.height * 0.19, x1: layout.width * 0.66, y1: layout.height * 0.37 };
  const inBox = (bbox, box) => bbox.x0 >= box.x0 && bbox.y0 >= box.y0 && bbox.x1 <= box.x1 && bbox.y1 <= box.y1;
  const nameLines = [], numbers = new Set();
  let textBytes = 0;
  for (const line of layout.lines) {
    if (typeof line?.text === 'string') textBytes += Buffer.byteLength(line.text, 'utf8');
    if (!line || typeof line.text !== 'string' || line.text.length > 1024 || [...line.text].length > 512 ||
      (!Number.isFinite(line.confidence) && line.confidence !== null) || textBytes > 65536 || !line.bbox ||
      !['x0', 'y0', 'x1', 'y1'].every(key => Number.isFinite(line.bbox[key])) || line.bbox.x0 < 0 || line.bbox.y0 < 0 ||
      line.bbox.x1 <= line.bbox.x0 || line.bbox.y1 <= line.bbox.y0 || line.bbox.x1 > layout.width || line.bbox.y1 > layout.height ||
      (line.confidence !== null && (line.confidence < 0 || line.confidence > 100))) return unknown;
    const value = line.text.trim();
    if (inBox(line.bbox, numberBox)) {
      for (const match of value.matchAll(/(?<!\d)(\d{6})[- ]?(\d{2})[- ]?(\d{4})(?!\d)/g)) numbers.add(`${match[1]}${match[2]}${match[3]}`);
    }
    if (inBox(line.bbox, nameBox) && value.length <= 160 && /^[\p{L}\p{M} .,'’/@()\-]+$/u.test(value) &&
      [...value].filter(character => /[\p{L}\p{M}]/u.test(character)).length >= 2 && !/^(?:NAME|NAMA|FULL NAME|NAMA PENUH)$/i.test(value)) {
      nameLines.push({ text: value, bbox: line.bbox });
    }
  }
  nameLines.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const groups = [];
  for (const line of nameLines) {
    const previous = groups.at(-1);
    if (previous && line.bbox.y0 - previous.y1 <= layout.height * 0.035 && Math.abs(line.bbox.x0 - previous.x0) <= layout.width * 0.04) {
      previous.lines.push(line.text); previous.y1 = line.bbox.y1;
    } else groups.push({ x0: line.bbox.x0, y1: line.bbox.y1, lines: [line.text] });
  }
  const names = groups.map(group => group.lines.join(' ').normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase());
  const holderName = names.length === 1 ? names[0] : null;
  const documentNumber = numbers.size === 1 ? numbers.values().next().value : null;
  return { holderName, documentNumber, layoutStatus: holderName && documentNumber ? 'located' : 'partial', unreadable: documentNumber === null };
}

module.exports = { toOcrLines, extractKycFields, toOcrLayoutV1, extractMykadLayoutFieldsV1 };
