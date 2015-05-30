module.exports = Binding;
var Observer = require('./observer');


function Binding(options, isTemplate) {
  if (!options.element || !options.view) {
    throw new TypeError('A binding must receive an element and a view');
  }

  // The element (or text node) this binding is bound to
  this.element = options.element;

  // The view this binding belongs to
  this.view = options.view;

  // The path from the view to the element, used on cloning (it is an array of node indexes)
  this.elementPath = options.elementPath || initNodePath(this.element, this.view);

  // The attribute or element name
  this.name = options.name;

  // The matched part of the name for wildcard attributes (e.g. `on-*` matching against `on-click` would have a match of
  // `click`). Use `this.camelCase` to get the match camelCased.
  this.match = options.match;

  // The expression this binding will use for its updates
  this.expression = options.expression;

  // The function to run when the element is created
  this.created = options.created;

  // The function to run when the expression's value changes
  this.updated = options.updated;

  // The function to run when the element is inserted into the DOM
  this.attached = options.attached;

  // The function to run when the element is removed from the DOM
  this.detached = options.detached;

  // The context the exression operates within
  this.context = null;

  // A template which this binding may use to stamp out views
  this.template = options.template;

  if (this.expression) {
    // An observer to observe value changes to the expression within a context
    this.observer = new Observer(this.expression, this.updated ? this.updated.bind(this) : null);
  }

  if (this.created && !isTemplate) this.created();
}

Binding.prototype = {
  get camelCase() {
    return (this.match || this.name || '').replace(/-+(\w)/g, function(_, char) {
      return char.toUpperCase();
    });
  },

  bind: function(context) {
    this.context = context;
    if (this.observer) this.observer.bind(context);
    if (this.attached) this.attached();
  },

  unbind: function() {
    this.context = null;
    if (this.observer) this.observer.ubind();
    if (this.detached) this.detached();
  }
};

var indexOf = Array.prototype.indexOf;

// Creates an array of indexes to help find the same element within a cloned view
function initNodePath(node, view) {
  var path = [];
  while (node !== view) {
    var parent = node.parentNode;
    path.unshift(indexOf.call(parent.childNodes, node));
    node = parent;
  }
  return path;
}
