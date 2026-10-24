'use strict';

const { handleConfigStatus, setSecurityHeaders } = require('../server.js');

module.exports = async (req, res) => {
  setSecurityHeaders(res);
  return handleConfigStatus(req, res);
};
