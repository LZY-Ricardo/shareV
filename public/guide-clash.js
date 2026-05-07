(function () {
  const link = localStorage.getItem('sharev_clash_link') || '';
  const user = localStorage.getItem('sharev_guide_user') || '当前用户';
  const token = localStorage.getItem('sharev_guide_token') || '';

  const subtitle = document.getElementById('guideSubtitle');
  if (subtitle) {
    subtitle.textContent = `${user} 的 Clash 订阅导入教程：从安装客户端到导入成功，一步一步带你完成`;
  }

  const back = document.getElementById('backToDashboard');
  if (back && token) {
    back.href = `/#t=${encodeURIComponent(token)}`;
  }

  const linkText = link || '没有读取到当前订阅链接。请先从 shareV 用户页的 Clash 标签页点"查看导入教程"进入本页。';
  const box = document.getElementById('guideLinkBox');
  const panel = document.getElementById('guideLinkPanel');
  if (box) box.textContent = linkText;
  if (panel) panel.textContent = linkText;

  if (link) {
    try {
      const qrContainer = document.getElementById('guideQrContainer');
      if (qrContainer) {
        const canvas = document.createElement('canvas');
        new QRious({
          element: canvas,
          value: link,
          size: 512,
          level: 'M',
          background: '#ffffff',
          foreground: '#000000',
        });
        qrContainer.innerHTML = `<img src="${canvas.toDataURL()}" alt="当前订阅二维码" class="qr-img" />`;
      }
    } catch (_) {}
  }

  function toast(message, type = 'info', duration = 2200) {
    let el = document.querySelector('.toast');
    if (el) el.remove();
    el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => el.classList.add('show'));
    });
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 350);
    }, duration);
  }

  async function copyText(text) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (_) {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'absolute';
      textarea.style.left = '-9999px';
      document.body.appendChild(textarea);
      textarea.select();
      const ok = document.execCommand('copy');
      textarea.remove();
      return ok;
    }
  }

  window.copyGuideLink = async function () {
    if (!link) {
      toast('当前没有可复制的订阅链接，请回到用户页重新打开教程', 'error');
      return;
    }
    const ok = await copyText(link);
    toast(ok ? '订阅链接已复制' : '复制失败，请手动复制下方链接', ok ? 'success' : 'error');
  };
})();
