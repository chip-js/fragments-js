var Fragments = require('./src/fragments');
var Observations = require('observations-js');

function create(options) {
  options = options || {};
  var observations = Observations.create();
  options.observations = observations;
  var fragments = new Fragments(options);
  fragments.sync = observations.sync;
  fragments.syncNow = observations.syncNow;
  fragments.afterSync = observations.afterSync;
  fragments.onSync = observations.onSync;
  fragments.offSync = observations.offSync;
  return fragments;
}

// Create an instance of fragments with the default observer
exports.create = create;
