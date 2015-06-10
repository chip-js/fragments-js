var fragments = require('./src/fragments');
var binding = require('./src/binding');
var expression = require('./src/expression');

// Dependency injection
binding.Binding.Observer = expression.Observer;
expression.Observer.formatters = binding.formatter.formatters;

exports.template = fragments.template;
exports.view = fragments.view;
exports.binder = binding.binder;
exports.formatter = binding.formatter;
exports.Binding = binding.Binding;
exports.expression = expression;
exports.sync = expression.Observer.sync;

require('./src/registered/binders');
require('./src/registered/formatters');
