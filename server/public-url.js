function resolvePublicUrl(config, req) {
  const configured = String(config.publicUrl || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  return `${req.protocol}://${req.get('host')}`;
}

function normalizePublicUrl(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function resolveBackupPublicUrls(config) {
  const primary = normalizePublicUrl(config.publicUrl);
  const urls = Array.isArray(config.backupPublicUrls) ? config.backupPublicUrls : [];
  return [...new Set(urls.map(normalizePublicUrl).filter(Boolean))]
    .filter(url => url !== primary);
}

module.exports = { resolvePublicUrl, resolveBackupPublicUrls };
