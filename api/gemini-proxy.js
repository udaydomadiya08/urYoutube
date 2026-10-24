'use strict';

const { handleGeminiProxy, setSecurityHeaders, getClientIp } = require('../server.js');

module.exports = async (req, res) => {
  setSecurityHeaders(res);
  const clientIp = getClientIp(req);
  return handleGeminiProxy(req, res, clientIp);
};
