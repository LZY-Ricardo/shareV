const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { shouldRejectUnauthorized } = require('../xui-api');

describe('xui api TLS verification', () => {
  it('allows internal Docker host alias for local 3x-ui access', () => {
    assert.equal(shouldRejectUnauthorized('host.docker.internal'), false);
  });

  it('keeps certificate verification for public hosts', () => {
    assert.equal(shouldRejectUnauthorized('example.com'), true);
  });
});
