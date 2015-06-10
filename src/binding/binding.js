module.exports = Binding;
var animation = require('./animation');
var codify = require('../util/codify');

// Properties on a Binding
// binder: The binder for this binding
// element: The element (or text node) this binding is bound to
// view: The view this binding belongs to
// elementPath: The path from the view to the element, used on cloning (it is an array of node indexes)
// name: The attribute or element name
// match: The matched part of the name for wildcard attributes (e.g. `on-*` matching against `on-click` would have a match of
//   `click`). Use `this.camelCase` to get the match camelCased.
// expression: The expression this binding will use for its updates
// context: The context the exression operates within
function Binding(options, isTemplate) {
  if (!options.element || !options.view) {
    throw new TypeError('A binding must receive an element and a view');
  }

  Object.keys(options).forEach(function(key) {
    this[key] = options[key];
  }, this);

  if (!this.elementPath) {
    this.elementPath = initNodePath(this.element, this.view);
  }

  this.context = null;

  if (isTemplate) {
    this.compiled();
  } else if (this.expression) {
    // An observer to observe value changes to the expression within a context
    if (!Binding.Observer) throw new Error('Must inject an Observer onto Binding');
    this.observer = new Binding.Observer(this.expression, this.updated, this);
  }
}

Binding.prototype = {
  constructor: Binding,

  get camelCase() {
    return (this.match || this.name || '').replace(/-+(\w)/g, function(_, char) {
      return char.toUpperCase();
    });
  },

  observe: function(expression, callback, callbackContext) {
    return new Binding.Observer(expression, callback, callbackContext);
  },

  bind: function(context) {
    this.context = context;
    if (this.observer) {
      if (this.updated !== Binding.prototype.updated) {
        this.observer.bind(context);
      } else {
        // set the context but don't actually bind it
        this.observer.context = context;
      }
    }
    this.attached();
  },

  unbind: function() {
    this.context = null;
    if (this.observer) this.observer.unbind();
    this.detached();
  },

  // The function to run when the element is compiled within a template
  compiled: function() {},

  // The function to run when the element is created
  created: function() {},

  // The function to run when the expression's value changes
  updated: function() {},

  // The function to run when the element is inserted into the DOM
  attached: function() {},

  // The function to run when the element is removed from the DOM
  detached: function() {},

  codify: codify,

  // Clones a binding scoped to a duplicate view.
  clone: function(view) {
    if (!view) throw new TypeError('A binding must clone against a new view');
    var node = view;
    this.elementPath.forEach(function(index) {
      node = node.childNodes[index];
    });
    var binding = new this.constructor(this);
    binding.element = node;
    binding.view = view;
    binding.created();
    return binding;
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
