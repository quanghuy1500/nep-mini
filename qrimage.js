/*
 * qrimage.js — Đọc mã QR từ file ảnh (thư viện ảnh / ảnh chụp màn hình), chạy hoàn toàn trên máy.
 * Ảnh iPhone rất lớn (12MP) nên thử giải mã ở nhiều kích thước khác nhau để tăng tỉ lệ đọc được.
 */
(function () {
  'use strict';

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Không mở được ảnh'));
      img.src = src;
    });
  }

  /**
   * Giải mã QR trong một ảnh.
   * @param {Blob|File} file
   * @returns {Promise<string|null>} nội dung QR, hoặc null nếu không tìm thấy
   */
  async function decodeFile(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const w0 = img.naturalWidth, h0 = img.naturalHeight;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      // Thứ tự thử: cỡ vừa (nhanh, thường đọc được) -> nhỏ -> lớn
      const maxSides = [1200, 800, 1800, 500];
      for (const maxSide of maxSides) {
        const scale = Math.min(1, maxSide / Math.max(w0, h0));
        const w = Math.max(1, Math.round(w0 * scale));
        const h = Math.max(1, Math.round(h0 * scale));
        canvas.width = w; canvas.height = h;
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); // nền trắng cho ảnh PNG trong suốt
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h);
        const code = window.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) return code.data;
      }
      return null;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  window.QRImage = { decodeFile };
})();
