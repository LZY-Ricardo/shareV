function sanitizeFilename(name) {
  const cleaned = String(name || '')
    .trim()
    .replace(/\.ya?ml$/i, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ');
  return cleaned || 'shareV ultra';
}

function getClashProfileFilename(user = {}) {
  return sanitizeFilename(user.clashName || 'shareV ultra');
}

module.exports = { getClashProfileFilename };
