exports.binder = require('./binder');
exports.formatter = require('./formatter');
exports.Binding = require('./binding');

// Set up binding with templates
var fragments = require('../fragments');
var template = fragments.template;
var view = fragments.view;

template.onCompile = require('./compile');
template.onView = initializeView;
view.onDispose = cleanupView;
view.methods.bind = bindView;
view.methods.unbind = unbindView;



// Clones the bindings from the template onto the view
function initializeView(view) {
  if (!view.template) {
    compileTemplate(view);
  } else {
    view.bindings = view.template.bindings.map(function(binding) {
      return binding.clone(view);
    });
  }
}


// Makes sure the view is unbound before being put back into the pool
function cleanupView(view) {
  view.unbind();
}


// Adds a method to views to bind their observers with an object
function bindView(context) {
  this.bindings.forEach(function(binding) {
    binding.bind(context);
  });
}


// Adds a method to view to unbind their observers
function unbindView() {
  this.bindings.forEach(function(binding) {
    binding.unbind();
  });
}
