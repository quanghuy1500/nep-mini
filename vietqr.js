/*
 * vietqr.js — Bộ parse & build mã VietQR theo chuẩn EMVCo Merchant-Presented QR (NAPAS).
 *
 * Cấu trúc dữ liệu là TLV (Tag-Length-Value):
 *   - Tag:    2 ký tự số   (ID của trường)
 *   - Length: 2 ký tự số   (độ dài phần Value, tính theo số ký tự)
 *   - Value:  <Length> ký tự
 * Một số trường (26-51, 62...) lại chứa các sub-TLV bên trong.
 *
 * Tham chiếu: chuẩn VietQR do NAPAS công bố (dựa trên EMVCo QR).
 * Toàn bộ xử lý chạy client-side, không gửi dữ liệu đi đâu.
 */

// ---- Bảng tra BIN (Napas Acquirer ID) -> tên ngân hàng (rút gọn, có thể bổ sung) ----
const BANK_BIN_MAP = {
  '970405': 'Agribank',
  '970415': 'VietinBank',
  '970418': 'BIDV',
  '970436': 'Vietcombank',
  '970422': 'MB Bank',
  '970407': 'Techcombank',
  '970416': 'ACB',
  '970432': 'VPBank',
  '970423': 'TPBank',
  '970403': 'Sacombank',
  '970443': 'SHB',
  '970431': 'Eximbank',
  '970426': 'MSB',
  '970441': 'VIB',
  '970448': 'OCB',
  '970414': 'Ocean Bank',
  '970419': 'NCB',
  '970424': 'Shinhan Bank',
  '970425': 'ABBANK',
  '970428': 'Nam A Bank',
  '970429': 'SCB',
  '970430': 'PGBank',
  '970433': 'VietBank',
  '970437': 'HDBank',
  '970438': 'BaoViet Bank',
  '970440': 'SeABank',
  '970446': 'COOPBANK',
  '970449': 'LienVietPostBank',
  '970452': 'KienLongBank',
  '546034': 'CAKE by VPBank',
  '963388': 'Timo',
};

/**
 * Bóc một chuỗi TLV thành danh sách { tag, value }.
 * @param {string} data chuỗi EMVCo (đã bỏ khoảng trắng)
 * @returns {Array<{tag:string, value:string}>}
 */
function parseTLV(data) {
  const result = [];
  let i = 0;
  while (i + 4 <= data.length) {
    const tag = data.substring(i, i + 2);
    const len = parseInt(data.substring(i + 2, i + 4), 10);
    if (Number.isNaN(len)) break;
    const value = data.substring(i + 4, i + 4 + len);
    result.push({ tag, value });
    i += 4 + len;
  }
  return result;
}

/**
 * Parse một chuỗi VietQR đầy đủ ra thông tin dễ dùng.
 * @param {string} raw nội dung QR đọc được
 * @returns {object} { valid, bankBin, bankName, accountNumber, amount, purpose, currency, raw, merchantName, error }
 */
function parseVietQR(raw) {
  const out = {
    valid: false,
    bankBin: null,
    bankName: null,
    accountNumber: null,
    amount: null,
    purpose: null,
    currency: null,
    merchantName: null,
    raw,
    error: null,
  };

  if (!raw || typeof raw !== 'string') {
    out.error = 'Nội dung QR rỗng.';
    return out;
  }

  const data = raw.trim();
  const top = parseTLV(data);
  if (top.length === 0) {
    out.error = 'Không phải mã TLV hợp lệ (không đọc được VietQR).';
    return out;
  }

  for (const { tag, value } of top) {
    switch (tag) {
      case '53': // Transaction Currency (704 = VND)
        out.currency = value;
        break;
      case '54': // Transaction Amount
        out.amount = value;
        break;
      case '59': // Merchant Name
        out.merchantName = value;
        break;
      case '38': { // Merchant Account Information (VietQR/NAPAS)
        const sub = parseTLV(value);
        for (const s of sub) {
          // 00 = GUID (A000000727 cho NAPAS)
          // 01 = Beneficiary Organization: bên trong có 00 = Acquirer/BIN, 01 = số tài khoản
          if (s.tag === '01') {
            const inner = parseTLV(s.value);
            for (const b of inner) {
              if (b.tag === '00') out.bankBin = b.value;      // BIN ngân hàng
              if (b.tag === '01') out.accountNumber = b.value; // số tài khoản
            }
          }
        }
        break;
      }
      case '62': { // Additional Data Field Template
        const sub = parseTLV(value);
        for (const s of sub) {
          if (s.tag === '08') out.purpose = s.value; // Purpose of Transaction
          if (s.tag === '01' && !out.purpose) out.purpose = s.value; // Bill Number fallback
        }
        break;
      }
      default:
        break;
    }
  }

  if (out.bankBin) {
    out.bankName = BANK_BIN_MAP[out.bankBin] || `BIN ${out.bankBin}`;
    out.valid = true;
  } else {
    out.error = 'Đọc được QR nhưng không tìm thấy thông tin tài khoản ngân hàng (không phải VietQR chuyển khoản?).';
  }

  return out;
}

// ---- Build lại mã VietQR (để tạo QR có sẵn số tiền + nội dung) ----

/** Tạo một khối TLV: tag + length (2 số) + value */
function tlv(tag, value) {
  const len = String(value.length).padStart(2, '0');
  return `${tag}${len}${value}`;
}

/** Tính CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) — chuẩn cho tag 63 của VietQR */
function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Dựng chuỗi VietQR động (có số tiền) từ thông tin tài khoản.
 * @param {object} p { bankBin, accountNumber, amount, purpose }
 * @returns {string} chuỗi VietQR hoàn chỉnh (đã có CRC)
 */
function buildVietQR({ bankBin, accountNumber, amount, purpose }) {
  // Merchant Account Info (tag 38)
  const guid = tlv('00', 'A000000727');
  const benInfo = tlv('00', bankBin) + tlv('01', accountNumber);
  const beneficiary = tlv('01', benInfo);
  const service = tlv('02', 'QRIBFTTA'); // chuyển tới tài khoản
  const merchantAccount = tlv('38', guid + beneficiary + service);

  let payload =
    tlv('00', '01') +                 // Payload Format Indicator
    tlv('01', amount ? '12' : '11') + // 11 tĩnh / 12 động (có amount)
    merchantAccount +
    tlv('53', '704') +                // VND
    (amount ? tlv('54', String(amount)) : '') +
    tlv('58', 'VN');

  if (purpose) {
    payload += tlv('62', tlv('08', purpose));
  }

  // CRC được tính trên toàn payload + '6304'
  payload += '6304';
  return payload + crc16(payload);
}

// Xuất ra global để app.js dùng (không dùng module để chạy được khi mở file trực tiếp)
window.VietQR = { parseVietQR, buildVietQR, BANK_BIN_MAP };
