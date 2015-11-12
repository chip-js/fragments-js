var Fragments = require('./src/fragments');
var Observer = require('./src/observer');

function create() {
  var fragments = new Fragments(Observer);
  fragments.expressions = Observer.expressions;
  fragments.sync = Observer.sync;
  fragments.syncNow = Observer.syncNow;
  return fragments;
}

// Create an instance of fragments with the default observer
module.exports = create();
module.exports.create = create;
