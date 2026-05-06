function resolvePublicUrl(config, req) {
  const configured = String(config.publicUrl || '').trim();
  if (configured) return configured.replace(/\/+$/, '');

  return `${req.protocol}://${req.get('host')}`;
}

module.exports = { resolvePublicUrl };
