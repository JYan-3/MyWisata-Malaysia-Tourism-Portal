'use strict';
function fixtureSvg(side, name, number) {
  // Deliberately not a reproduction of a government document. No portrait,
  // address, date of birth, signature, logo or machine-readable identity zone.
  const rows = side === 'front'
    ? [['LOCAL OCR TEST ONLY', 100, 48], ['SYNTHETIC SAMPLE - NOT VALID ID', 200, 40], ['NAMA / NAME', 370, 38],
      [name, 475, 64], ['NO. DOKUMEN / DOCUMENT NUMBER', 640, 38], [number, 745, 70], ['UJI BACAAN TEKS SAHAJA', 975, 36]]
    : [['LOCAL OCR TEST ONLY', 100, 48], ['SYNTHETIC SAMPLE - NOT VALID ID', 200, 40], ['BACK / BELAKANG', 420, 48],
      ['NO. DOKUMEN / DOCUMENT NUMBER', 630, 38], [number, 745, 70], ['THIS SAMPLE DOES NOT PROVE IDENTITY', 975, 36]];
  const content = rows.map(([text, y, size]) => `<text x="110" y="${y}" font-size="${size}">${text}</text>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1800" height="1120"><rect width="1800" height="1120" fill="#f6f7f8"/><rect x="35" y="35" width="1730" height="1050" rx="22" fill="none" stroke="#555" stroke-width="3"/><g font-family="Arial, PingFang SC, sans-serif" fill="#111">${content}</g></svg>`);
}

module.exports = { fixtureSvg };
