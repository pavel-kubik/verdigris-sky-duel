/*
 * Verdigris campaign - module registry shared by the browser and Node.
 *
 * Core modules are plain scripts with no DOM and no THREE. Each one registers itself
 * with define(name, api) and reads its dependencies with need(name):
 *   - browser: <script> tags load in dependency order; the registry lives on window.VCamp;
 *   - Node: need(name) requires ./<name>.js on first use, so tests can load any module directly.
 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;
  const mods = {};

  function define(name, api) {
    mods[name] = api;
    return api;
  }

  function need(name) {
    if (mods[name]) return mods[name];
    if (isNode) {
      require('./' + name + '.js');
      if (mods[name]) return mods[name];
    }
    throw new Error('VCamp: module "' + name + '" is not loaded');
  }

  const M = { define, need, mods };
  if (isNode) module.exports = M;
  else root.VCamp = M;
})(typeof self !== 'undefined' ? self : this);
