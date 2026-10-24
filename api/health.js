'use strict';

const { handleHealth, setSecurityHeaders } = require('../server.js');

module.exports = async (req, res) => {
  setSecurityHeaders(res);
  return handleHealth(req, res);
};
