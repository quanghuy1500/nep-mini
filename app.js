/*
 * app.js — Nếp Mini. Toàn bộ dữ liệu lưu trên máy (localStorage), không server.
 */
(function () {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const STORAGE_KEY = 'nep_mini_transactions_v2';

  // ---- Danh mục (emoji + tên) ----
  const CATEGORIES = [
    { key: 'food', label: 'Ăn uống', emo: '🍜' },
    { key: 'move', label: 'Đi lại', emo: '🚕' },
    { key: 'shop', label: 'Mua sắm', emo: '🛍️' },
    { key: 'bill', label: 'Hóa đơn', emo: '🧾' },
    { key: 'fun', label: 'Giải trí', emo: '🎬' },
    { key: 'transfer', label: 'Chuyển tiền', emo: '💸' },
    { key: 'other', label: 'Khác', emo: '📦' },
  ];
  const catOf = (k) => CATEGORIES.find((c) => c.key === k) || CATEGORIES[CATEGORIES.length - 1];

  // ---- Deep link ngân hàng (bạn tự chỉnh cho ngân hàng của mình) ----
  const BANK_DEEPLINK = {
    'MB Bank': 'mbmobile://', 'BIDV': 'bidvsmartbanking://', 'VietinBank': 'ipaymb://',
    'TPBank': 'tpb://', 'Techcombank': 'tcbmb://', 'Vietcombank': 'vietcombank://', 'MSB': 'msbmobile://',
  };

  // ================= STATE =================
  let historyFilter = 'all';
  let reportMode = 'month';   // 'week' | 'month'
  let reportOffset = 0;       // 0 = kỳ hiện tại, -1 = kỳ trước...
  let stream = null, scanning = false;
  let sheetCtx = null;        // ngữ cảnh sheet hiện tại

  // ================= LƯU TRỮ =================
  const loadTx = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; } };
  const saveTx = (list) => localStorage.setItem(STORAGE_KEY, JSON.stringify(list));

  // ================= TIỆN ÍCH =================
  const fmt = (n) => new Intl.NumberFormat('vi-VN').format(Math.round(Number(n) || 0));
  const fmtVND = (n) => fmt(n) + 'đ';
  const signed = (t) => (t.type === 'income' ? '+' : '−') + fmtVND(t.amount);
  function stripDiacritics(s) {
    return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
  }
  function toast(msg) {
    const el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 1800);
  }
  const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  function relativeDayLabel(dateStr) {
    const d = startOfDay(dateStr), today = startOfDay(new Date());
    const diff = Math.round((today - d) / 86400000);
    if (diff === 0) return 'Hôm nay';
    if (diff === 1) return 'Hôm qua';
    if (diff < 7) return diff + ' ngày trước';
    return d.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
  }
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ================= ĐIỀU HƯỚNG =================
  function switchView(name) {
    $$('.view').forEach((v) => v.classList.remove('active'));
    $('#view-' + name).classList.add('active');
    $$('.tabbar .tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    if (name === 'home') renderHome();
    if (name === 'history') renderHistory();
    if (name === 'report') renderReport();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  $$('.tabbar .tab').forEach((t) => t.addEventListener('click', () => switchView(t.dataset.view)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => switchView(b.dataset.goto)));

  // ================= TRANG CHỦ =================
  function renderHome() {
    const now = new Date();
    $('#home-date').textContent = now.toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })
      .replace(/^./, (c) => c.toUpperCase());
    $('#home-month-label').textContent = `Đã chi tháng ${now.getMonth() + 1} · theo sổ Nếp`;

    const tx = loadTx();
    const today0 = startOfDay(now).getTime();
    let todaySpend = 0, monthSpend = 0;
    for (const t of tx) {
      if (t.type !== 'expense') continue;
      const d = new Date(t.ts);
      if (d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()) monthSpend += Number(t.amount);
      if (startOfDay(d).getTime() === today0) todaySpend += Number(t.amount);
    }
    $('#home-month-total').innerHTML = fmt(monthSpend) + '<span class="cur">đ</span>';
    $('#home-today').textContent = fmtVND(todaySpend);
    $('#home-month').textContent = fmtVND(monthSpend);

    const recent = tx.slice(0, 4);
    $('#home-recent').innerHTML = recent.length
      ? recent.map(txRowHtml).join('')
      : '<div class="empty">Chưa có giao dịch nào. Bấm "Quét QR" để bắt đầu.</div>';
    bindTxRows('#home-recent');
  }

  function txRowHtml(t) {
    const c = catOf(t.category);
    const d = new Date(t.ts);
    const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    const sub = [c.label, t.bankName].filter(Boolean).join(' · ');
    return `<div class="tx" data-id="${t.id}">
      <div class="ic">${c.emo}</div>
      <div class="mid"><div class="name">${escapeHtml(t.name || 'Giao dịch')}</div><div class="sub">${escapeHtml(sub)}</div></div>
      <div class="right"><div class="amt ${t.type}">${signed(t)}</div><div class="time">${time}</div></div>
    </div>`;
  }
  function bindTxRows(scope) {
    $$(scope + ' .tx').forEach((row) => row.addEventListener('click', () => openEditSheet(Number(row.dataset.id))));
  }

  $('#home-scan').addEventListener('click', startScanner);
  $('#tab-scan').addEventListener('click', startScanner);
  $('#home-manual').addEventListener('click', openManualSheet);

  // ================= LỊCH SỬ =================
  $('#search').addEventListener('input', renderHistory);
  $$('#history-chips .chip').forEach((c) => c.addEventListener('click', () => {
    historyFilter = c.dataset.filter;
    $$('#history-chips .chip').forEach((x) => x.classList.toggle('active', x === c));
    renderHistory();
  }));

  function renderHistory() {
    const q = stripDiacritics($('#search').value);
    let list = loadTx();
    if (historyFilter !== 'all') list = list.filter((t) => t.type === historyFilter);
    if (q) list = list.filter((t) => {
      const hay = stripDiacritics([t.name, catOf(t.category).label, t.note, t.bankName, fmt(t.amount)].join(' '));
      return hay.includes(q);
    });

    const wrap = $('#history-list');
    if (!list.length) { wrap.innerHTML = '<div class="empty">Không có giao dịch nào.</div>'; return; }

    // nhóm theo ngày
    const groups = {};
    for (const t of list) {
      const key = startOfDay(t.ts).getTime();
      (groups[key] = groups[key] || []).push(t);
    }
    const html = Object.keys(groups).sort((a, b) => b - a).map((key) => {
      const label = relativeDayLabel(Number(key));
      return `<div class="day-group-label">${label}</div>` + groups[key].map(txRowHtml).join('');
    }).join('');
    wrap.innerHTML = html;
    bindTxRows('#history-list');
  }

  // ================= BÁO CÁO =================
  $$('#report-seg button').forEach((b) => b.addEventListener('click', () => {
    reportMode = b.dataset.mode; reportOffset = 0;
    $$('#report-seg button').forEach((x) => x.classList.toggle('active', x === b));
    renderReport();
  }));
  $('#rep-prev').addEventListener('click', () => { reportOffset--; renderReport(); });
  $('#rep-next').addEventListener('click', () => { if (reportOffset < 0) { reportOffset++; renderReport(); } });

  // Trả về khoảng [start, end) của kỳ đang xem
  function periodRange() {
    const now = new Date();
    if (reportMode === 'month') {
      const start = new Date(now.getFullYear(), now.getMonth() + reportOffset, 1);
      const end = new Date(now.getFullYear(), now.getMonth() + reportOffset + 1, 1);
      return { start, end };
    }
    // tuần: bắt đầu từ Thứ Hai
    const base = startOfDay(now);
    const day = (base.getDay() + 6) % 7; // 0 = Thứ Hai
    const start = new Date(base); start.setDate(base.getDate() - day + reportOffset * 7);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    return { start, end };
  }

  function renderReport() {
    $('#rep-next').disabled = reportOffset >= 0;
    const { start, end } = periodRange();
    const tx = loadTx().filter((t) => t.type === 'expense');
    const inPeriod = tx.filter((t) => { const d = new Date(t.ts); return d >= start && d < end; });
    const total = inPeriod.reduce((s, t) => s + Number(t.amount), 0);

    // nhãn kỳ
    let label;
    if (reportMode === 'month') {
      label = reportOffset === 0 ? 'Tháng này' : `Tháng ${start.getMonth() + 1}/${start.getFullYear()}`;
      $('#rep-total-label').textContent = 'Tổng chi · ' + (reportOffset === 0 ? 'tháng này' : `tháng ${start.getMonth() + 1}`);
    } else {
      const endLabel = new Date(end); endLabel.setDate(end.getDate() - 1);
      label = reportOffset === 0 ? 'Tuần này' : `${start.getDate()}/${start.getMonth() + 1} - ${endLabel.getDate()}/${endLabel.getMonth() + 1}`;
      $('#rep-total-label').textContent = 'Tổng chi · ' + (reportOffset === 0 ? 'tuần này' : 'tuần đã chọn');
    }
    $('#rep-period-label').textContent = label;
    $('#rep-total').innerHTML = fmt(total) + '<span class="cur">đ</span>';

    renderBars(inPeriod, start, end);

    // danh sách khoản chi trong kỳ
    $('#rep-list').innerHTML = inPeriod.length
      ? inPeriod.slice(0, 20).map(txRowHtml).join('')
      : '<div class="empty">Chưa có khoản chi trong kỳ.</div>';
    bindTxRows('#rep-list');

    // chi nhiều nhất theo danh mục
    const byCat = {};
    for (const t of inPeriod) byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount);
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    $('#rep-top').innerHTML = top.length ? top.map(([k, sum]) => {
      const c = catOf(k), pct = total ? Math.round((sum / total) * 100) : 0;
      return `<div class="tx"><div class="ic">${c.emo}</div>
        <div class="mid"><div class="name">${c.label}</div><div class="sub">${pct}%</div></div>
        <div class="right"><div class="amt expense">${fmtVND(sum)}</div></div></div>`;
    }).join('') : '<div class="empty">—</div>';
  }

  function renderBars(inPeriod, start, end) {
    // tháng -> chia 4 cột theo tuần; tuần -> 7 cột theo ngày
    let buckets, labels;
    if (reportMode === 'month') {
      buckets = [0, 0, 0, 0];
      labels = ['Tuần 1', 'Tuần 2', 'Tuần 3', 'Tuần 4'];
      for (const t of inPeriod) {
        const day = new Date(t.ts).getDate();
        const idx = Math.min(3, Math.floor((day - 1) / 7));
        buckets[idx] += Number(t.amount);
      }
    } else {
      buckets = [0, 0, 0, 0, 0, 0, 0];
      labels = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];
      for (const t of inPeriod) {
        const idx = (new Date(t.ts).getDay() + 6) % 7;
        buckets[idx] += Number(t.amount);
      }
    }
    const max = Math.max(...buckets, 1);
    const maxIdx = buckets.indexOf(Math.max(...buckets));
    $('#rep-bars').innerHTML = buckets.map((v, i) => {
      const h = v > 0 ? Math.max(6, Math.round((v / max) * 130)) : 4;
      const active = v === max && v > 0;
      const valTxt = v > 0 ? (v >= 1000 ? Math.round(v / 1000) + 'K' : v) : '';
      return `<div class="bar-col ${active ? 'active' : ''}">
        <div class="bar-val">${valTxt}</div>
        <div class="bar ${v > 0 ? '' : 'dim'}" style="height:${h}px"></div>
        <div class="bar-label">${labels[i]}</div></div>`;
    }).join('');
  }

  // ================= CÀI ĐẶT =================
  function renderSettings() {
    const tx = loadTx();
    const banks = new Set(tx.map((t) => t.bankName).filter(Boolean));
    $('#set-bank-count').textContent = banks.size + ' nguồn';
    $('#set-cat-count').textContent = CATEGORIES.length + ' danh mục';
    $('#set-tx-count').textContent = tx.length + ' giao dịch';
  }
  $('#set-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(loadTx(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'nep-mini-backup-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click(); URL.revokeObjectURL(url);
    toast('Đã xuất sao lưu');
  });
  $('#set-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error('Sai định dạng');
        const merged = [...data, ...loadTx()];
        const seen = new Set();
        const dedup = merged.filter((t) => (seen.has(t.id) ? false : seen.add(t.id)));
        dedup.sort((a, b) => new Date(b.ts) - new Date(a.ts));
        saveTx(dedup); renderSettings();
        toast('Đã nhập ' + data.length + ' giao dịch');
      } catch (err) { toast('File không hợp lệ'); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
  $('#set-clear').addEventListener('click', () => {
    if (confirm('Xoá toàn bộ dữ liệu giao dịch? Không thể hoàn tác.')) {
      saveTx([]); renderSettings(); toast('Đã xoá toàn bộ');
    }
  });

  // ================= SCANNER =================
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function startScanner() {
    $('#scanner').classList.add('active');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      const video = $('#video'); video.srcObject = stream; await video.play();
      scanning = true; requestAnimationFrame(scanLoop);
    } catch (e) {
      toast('Không mở được camera. Dùng "Dán mã QR".');
    }
  }
  function stopScanner() {
    scanning = false;
    if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
    $('#scanner').classList.remove('active');
  }
  function scanLoop() {
    if (!scanning) return;
    const video = $('#video');
    if (video.readyState === video.HAVE_ENOUGH_DATA) {
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) { onScanned(code.data); return; }
    }
    requestAnimationFrame(scanLoop);
  }
  $('#scan-close').addEventListener('click', stopScanner);
  $('#scan-paste').addEventListener('click', () => {
    const raw = prompt('Dán chuỗi VietQR (bắt đầu bằng 000201...):');
    if (raw) onScanned(raw.trim());
  });

  function onScanned(raw) {
    const info = window.VietQR.parseVietQR(raw);
    stopScanner();
    if (!info.valid) { toast('Không đọc được VietQR'); return; }
    openConfirm(info);
  }

  // ---- Chọn ảnh QR từ thư viện ----
  $('#scan-pick-image').addEventListener('click', () => $('#qr-image-input').click());
  $('#qr-image-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = ''; // cho phép chọn lại cùng một ảnh
    if (!file) return;
    toast('Đang đọc ảnh...');
    try {
      const raw = await window.QRImage.decodeFile(file);
      if (!raw) { toast('Không tìm thấy mã QR trong ảnh'); return; }
      onScanned(raw);
    } catch (err) {
      toast('Không mở được ảnh');
    }
  });

  // ================= SHEET (nhập/sửa/thủ công) =================
  function buildCatGrid(selectedKey) {
    $('#cat-grid').innerHTML = CATEGORIES.map((c) =>
      `<button class="cat-btn ${c.key === selectedKey ? 'active' : ''}" data-cat="${c.key}">
        <span class="emo">${c.emo}</span>${c.label}</button>`).join('');
    $$('#cat-grid .cat-btn').forEach((b) => b.addEventListener('click', () => {
      $$('#cat-grid .cat-btn').forEach((x) => x.classList.toggle('active', x === b));
      sheetCtx.category = b.dataset.cat;
    }));
  }
  function setType(type) {
    sheetCtx.type = type;
    $$('#type-toggle button').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  }
  $$('#type-toggle button').forEach((b) => b.addEventListener('click', () => setType(b.dataset.type)));

  function openSheet() { $('#sheet-backdrop').classList.add('active'); }
  function closeSheet() { $('#sheet-backdrop').classList.remove('active'); $('#qr-result-wrap').hidden = true; $('#qrcode').innerHTML = ''; }
  $('#sheet-backdrop').addEventListener('click', (e) => { if (e.target.id === 'sheet-backdrop') closeSheet(); });

  // (Luồng sau khi quét QR giờ đi qua màn "Kiểm tra khoản chi" — xem openConfirm bên dưới)

  // 2) Ghi thủ công
  function openManualSheet() {
    sheetCtx = { mode: 'manual', id: null, type: 'expense', category: 'food', bankName: '', accountNumber: '', bankBin: null, purpose: '' };
    $('#sheet-title').textContent = 'Ghi thủ công';
    $('#sheet-recv').textContent = 'Khoản chi tiền mặt / không qua QR';
    $('#f-amount').value = ''; $('#f-name').value = ''; $('#f-note').value = '';
    $('#f-manual-fields').hidden = false;
    $('#sheet-scan-actions').hidden = true;
    $('#f-delete').hidden = true;
    setType('expense'); buildCatGrid('food');
    openSheet(); setTimeout(() => $('#f-amount').focus(), 300);
  }

  // 3) Sửa giao dịch đã có
  function openEditSheet(id) {
    const t = loadTx().find((x) => x.id === id); if (!t) return;
    sheetCtx = { mode: 'edit', id: t.id, type: t.type, category: t.category, bankName: t.bankName, accountNumber: t.accountNumber, bankBin: t.bankBin, purpose: t.note };
    $('#sheet-title').textContent = 'Sửa giao dịch';
    $('#sheet-recv').textContent = t.bankName || 'Giao dịch';
    $('#f-amount').value = t.amount; $('#f-name').value = t.name || ''; $('#f-note').value = t.note || '';
    $('#f-manual-fields').hidden = false;
    $('#sheet-scan-actions').hidden = true;
    $('#f-delete').hidden = false;
    setType(t.type); buildCatGrid(t.category);
    openSheet();
  }

  function currentAmount() { const v = Number($('#f-amount').value); return Number.isFinite(v) && v > 0 ? Math.round(v) : null; }

  // Tạo QR có số tiền
  $('#f-make-qr').addEventListener('click', () => {
    const amount = currentAmount(); if (!amount) { toast('Nhập số tiền trước'); return; }
    const qrStr = window.VietQR.buildVietQR({
      bankBin: sheetCtx.bankBin, accountNumber: sheetCtx.accountNumber,
      amount, purpose: ($('#f-note').value || sheetCtx.purpose || '').substring(0, 25),
    });
    $('#qrcode').innerHTML = '';
    new window.QRCode($('#qrcode'), { text: qrStr, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
    $('#qr-result-wrap').hidden = false;
    $('#qr-result-wrap').scrollIntoView({ behavior: 'smooth' });
  });

  // Mở app ngân hàng
  $('#f-open-bank').addEventListener('click', () => {
    const scheme = BANK_DEEPLINK[sheetCtx.bankName];
    if (!scheme) { toast('Chưa có deep link cho ' + sheetCtx.bankName + '. Dùng "Tạo QR có số tiền".'); return; }
    window.location.href = scheme;
  });

  // Lưu
  $('#f-save').addEventListener('click', () => {
    const amount = currentAmount(); if (!amount) { toast('Nhập số tiền trước'); return; }
    const list = loadTx();
    const name = ($('#f-name').value || '').trim() || (sheetCtx.bankName || catOf(sheetCtx.category).label);
    if (sheetCtx.mode === 'edit') {
      const t = list.find((x) => x.id === sheetCtx.id);
      if (t) { t.amount = amount; t.type = sheetCtx.type; t.category = sheetCtx.category; t.name = name; t.note = $('#f-note').value || ''; }
    } else {
      list.unshift({
        id: Date.now(), ts: new Date().toISOString(), type: sheetCtx.type,
        amount, category: sheetCtx.category, name,
        bankName: sheetCtx.bankName || '', accountNumber: sheetCtx.accountNumber || '', bankBin: sheetCtx.bankBin || null,
        note: $('#f-note').value || sheetCtx.purpose || '',
      });
    }
    list.sort((a, b) => new Date(b.ts) - new Date(a.ts));
    saveTx(list); closeSheet(); toast('Đã lưu');
    const active = $('.view.active').id.replace('view-', '');
    switchView(active);
  });

  // Xoá (trong chế độ sửa)
  $('#f-delete').addEventListener('click', () => {
    if (!sheetCtx || sheetCtx.mode !== 'edit') return;
    if (!confirm('Xoá giao dịch này?')) return;
    saveTx(loadTx().filter((t) => t.id !== sheetCtx.id));
    closeSheet(); toast('Đã xoá');
    const active = $('.view.active').id.replace('view-', '');
    switchView(active);
  });

  // ================= KIỂM TRA KHOẢN CHI =================
  // Ngân hàng bạn dùng để TRẢ tiền. appId lấy từ danh sách deeplink công khai của VietQR.io
  // (https://api.vietqr.io/v2/ios-app-deeplinks). Link chỉ chứa mã app, KHÔNG gửi số tài khoản/số tiền đi.
  const PAY_BANKS = [
    { id: 'mb', short: 'MB', name: 'MB Bank' },
    { id: 'vcb', short: 'VCB', name: 'Vietcombank' },
    { id: 'tcb', short: 'TCB', name: 'Techcombank' },
    { id: 'bidv', short: 'BIDV', name: 'BIDV' },
    { id: 'icb', short: 'VTB', name: 'VietinBank' },
    { id: 'acb', short: 'ACB', name: 'ACB' },
    { id: 'vpb', short: 'VPB', name: 'VPBank' },
    { id: 'tpb', short: 'TPB', name: 'TPBank' },
    { id: 'vba', short: 'AGR', name: 'Agribank' },
    { id: 'timo', short: 'TIMO', name: 'Timo' },
    { id: 'cake', short: 'CAKE', name: 'Cake' },
  ];
  const PAY_BANK_KEY = 'nep_mini_pay_bank';
  const LAST_CAT_KEY = 'nep_mini_last_cat';
  const MAX_DIGITS = 12;

  let cf = null; // { info, digits, category, payBank }

  const getPayBank = () => PAY_BANKS.find((b) => b.id === localStorage.getItem(PAY_BANK_KEY)) || PAY_BANKS[0];

  function openConfirm(info) {
    cf = {
      info,
      digits: info.amount ? String(Math.round(Number(info.amount))) : '',
      category: localStorage.getItem(LAST_CAT_KEY) || 'shop',
      payBank: getPayBank(),
    };
    $('#cf-name').value = info.merchantName || '';
    $('#cf-account').textContent = [info.bankName, info.accountNumber].filter(Boolean).join(' · ');
    $('#cf-note').value = info.purpose || '';
    renderCfCategory(); renderCfBank(); renderCfAmount();
    $('#confirm').classList.add('active');
  }
  function closeConfirm() { $('#confirm').classList.remove('active'); cf = null; }

  function renderCfAmount() {
    const n = cf.digits ? Number(cf.digits) : 0;
    $('#cf-amount-num').textContent = fmt(n);
    $('#cf-amount').classList.toggle('zero', n === 0);
    $('#cf-pay').disabled = n === 0;
  }
  function renderCfCategory() {
    const c = catOf(cf.category);
    $('#cf-cat-emo').textContent = c.emo;
    $('#cf-cat-label').textContent = c.label;
  }
  function renderCfBank() { $('#cf-bank-badge').textContent = cf.payBank.short; }

  // Bàn phím số
  $$('#keypad button').forEach((b) => b.addEventListener('click', () => {
    if (!cf) return;
    const k = b.dataset.k;
    if (k === 'del') cf.digits = cf.digits.slice(0, -1);
    else if (cf.digits === '' && (k === '0' || k === '000')) return; // không cho số 0 đứng đầu
    else cf.digits = (cf.digits + k).slice(0, MAX_DIGITS);
    renderCfAmount();
  }));

  $('#cf-back').addEventListener('click', () => { closeConfirm(); startScanner(); });

  // Picker dùng chung
  function openPicker(title, items, onPick) {
    $('#picker-title').textContent = title;
    $('#picker-list').innerHTML = items.map((it, i) =>
      `<button class="picker-item ${it.active ? 'active' : ''}" data-i="${i}">
        <span class="p-ic">${it.icon}</span>
        <span><div>${escapeHtml(it.label)}</div>${it.sub ? `<div class="p-sub">${escapeHtml(it.sub)}</div>` : ''}</span>
        ${it.active ? '<span class="p-check">✓</span>' : ''}
      </button>`).join('');
    $$('#picker-list .picker-item').forEach((el) => el.addEventListener('click', () => {
      onPick(items[Number(el.dataset.i)]); closePicker();
    }));
    $('#picker-backdrop').classList.add('active');
  }
  function closePicker() { $('#picker-backdrop').classList.remove('active'); }
  $('#picker-backdrop').addEventListener('click', (e) => { if (e.target.id === 'picker-backdrop') closePicker(); });

  $('#cf-cat-row').addEventListener('click', () => {
    openPicker('Danh mục', CATEGORIES.map((c) => ({ key: c.key, icon: c.emo, label: c.label, active: c.key === cf.category })),
      (it) => { cf.category = it.key; localStorage.setItem(LAST_CAT_KEY, it.key); renderCfCategory(); });
  });
  $('#cf-bank').addEventListener('click', () => {
    openPicker('Chuyển bằng ngân hàng', PAY_BANKS.map((b) => ({ id: b.id, icon: b.short.slice(0, 3), label: b.name, active: b.id === cf.payBank.id })),
      (it) => { cf.payBank = PAY_BANKS.find((b) => b.id === it.id); localStorage.setItem(PAY_BANK_KEY, it.id); renderCfBank(); });
  });

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
  }

  // Chuyển khoản: lưu vào sổ -> copy số TK -> mở app ngân hàng
  $('#cf-pay').addEventListener('click', async () => {
    if (!cf) return;
    const amount = Number(cf.digits);
    if (!amount) return;
    const info = cf.info;
    const name = $('#cf-name').value.trim() || 'Người nhận';
    const note = $('#cf-note').value.trim();

    const list = loadTx();
    list.unshift({
      id: Date.now(), ts: new Date().toISOString(), type: 'expense',
      amount, category: cf.category, name,
      bankName: info.bankName || '', accountNumber: info.accountNumber || '', bankBin: info.bankBin || null,
      payBank: cf.payBank.name, note,
    });
    saveTx(list);

    const copied = info.accountNumber ? await copyText(info.accountNumber) : false;
    const payBank = cf.payBank;
    closeConfirm();
    switchView('home');
    toast(copied ? 'Đã lưu · đã copy số TK' : 'Đã lưu vào sổ');
    // Mở app ngân hàng qua universal link của VietQR (chỉ chứa mã app)
    setTimeout(() => { window.location.href = 'https://dl.vietqr.io/pay?app=' + encodeURIComponent(payBank.id); }, 600);
  });

  // ================= KHỞI ĐỘNG =================
  renderHome();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
