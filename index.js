var Fragments = require('./src/fragments');
var Observer = require('./src/observer');

// Create an instance of fragments with the default observer
var fragments = new Fragments(Observer);
fragments.expression = Observer.expression;
fragments.sync = Observer.sync;
module.exports = fragments;
