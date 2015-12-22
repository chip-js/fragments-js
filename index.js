var Fragments = require('./src/fragments');
var Observations = require('observations-js');

function create() {
  var observations = Observations.create();
  var fragments = new Fragments(observations);
  fragments.sync = observations.sync.bind(observations);
  fragments.syncNow = observations.syncNow.bind(observations);
  fragments.afterSync = observations.afterSync.bind(observations);
  fragments.onSync = observations.onSync.bind(observations);
  fragments.offSync = observations.offSync.bind(observations);
  return fragments;
}

// Create an instance of fragments with the default observer
module.exports = create();
module.exports.create = create;
