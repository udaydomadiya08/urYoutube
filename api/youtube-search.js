'use strict';

const { handleYoutubeSearch, setSecurityHeaders, getClientIp } = require('../server.js');
const { URL } = require('url');

module.exports = async (req, res) => {
  setSecurityHeaders(res);
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost';
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const parsedUrl = new URL(req.url || '/', `${proto}://${host}`);
  const clientIp = getClientIp(req);
  return handleYoutubeSearch(req, res, parsedUrl, clientIp);
};
