var Template = require('./template');
var Binder = require('./binder');
var Binding = require('./binding');
var Expression = require('./expression');
var slice = Array.prototype.slice;


Template.addHook('compile', compileTemplate);
Template.addHook('view', initializeView);
Template.addHook('dispose', cleanupView);
Template.viewMethods.bind = bindView;
Template.viewMethods.unbind = unbindView;


// Walks the template DOM replacing any bindings and caching bindings onto the template object.
function compileTemplate(template) {
  var walker = document.createTreeWalker(template, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  var bindings = [], previous;
  template.bindings = bindings;

  // This ensures the first node will be a valid node from SHOW_NODES (the root isn't valid if it's a document fragment)
  walker.nextNode();
  walker.previousNode();

  // find bindings for each node
  do {
    var node = walker.currentNode;
    var parentNode = node.parentNode;
    bindings.push.apply(bindings, getBindingsForNode(node, template));

    if (node.parentNode !== parentNode && previous) {
      // currentNode was removed and made a template
      walker.currentNode = previous;
      walker.nextNode();
      if (walker.currentNode.nodeType !== Node.TEXT_NODE || walker.currentNode.nodeValue !== '') {
        // an empty text node wasn't used as a placeholder, go back
        walker.previousNode();
      }
    }

    previous = walker.currentNode;
  } while (walker.nextNode());
}


// Clones the bindings from the template onto the view
function initializeView(view) {
  if (!view.template) {
    compileTemplate(view);
  } else {
    view.bindings = view.template.bindings.map(function(binding) {
      return cloneBinding(binding, view);
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



// Find all the bindings on a given node (text nodes will only ever have one binding).
function getBindingsForNode(node, view) {
  var bindings = [];
  var match, attr, i;

  // Creates a binding
  function createBinding(binder, options) {
    options.element = node;
    options.view = view;
    return Binder.createBinding(binder, options);
  }

  if (node.nodeType === Node.TEXT_NODE) {
    splitTextNode(node);
    if (isBound(node.nodeValue)) {
      var binder = Binder.find('{{text}}');
      var expr = Expression.codify(node.nodeValue);
      var binding = createBinding(binder, { expression: expr });
      bindings.push(binding);
      node.nodeValue = '';
    }
  } else {
    // Find and add any attribute bindings on an element. These can be attributes whose name matches a binding, or
    // they can be attributes which have a binding in the value such as `href="/post/{{ post.id }}"`.
    var bound = [];
    var attributes = slice.call(node.attributes);
    for (i = 0, l = attributes.length; i < l; i++) {
      var attr = attributes[i];
      var binder = Binder.find(attr.name);
      if (binder) {
        bound.push({ binder: binder, attr: attr });
      }
    }

    // Make sure to create and process them in the correct priority order.
    bound.sort(sortAttributes);

    // If the element is removed from the DOM, stop. We will check by looking at its parentNode
    var parent = node.parentNode;

    for (i = 0; i < bound.length; i++) {
      var binder = bound[i].binder;
      var attr = bound[i].attr;
      var name = attr.name;
      var value = attr.value;
      node.removeAttributeNode(attr);

      var binding = createBinding(binder, {
        name: name,
        expression: Expression.codify(value),
        match: binder.expr ? name.match(binder.expr)[1] : undefined
      });
      bindings.push(binding);

      if (node.parentNode !== parent) {
        break;
      }
    }
  }

  return bindings;
}


// Splits text nodes with expressions in them so they can be bound individually
function splitTextNode(node) {
  if (!node.processed) {
    node.processed = true;
    var content = node.nodeValue;
    if (boundExpr.test(content)) {
      var expr, lastIndex = 0, parts = [], fragment = document.createDocumentFragment();
      while (expr = boundExpr.exec(content)) {
        parts.push(content.slice(lastIndex, boundExpr.lastIndex - expr[0].length));
        parts.push(expr[0]);
        lastIndex = boundExpr.lastIndex;
      }
      parts.push(content.slice(lastIndex));
      parts = parts.filter(notEmpty);

      node.nodeValue = parts[0];
      for (var i = 1; i < parts.length; i++) {
        var newTextNode = document.createTextNode(parts[i]);
        newTextNode.processed = true;
        fragment.appendChild(newTextNode);
      }
      node.parentNode.insertBefore(fragment, node.nextSibling);
    }
  }
}

// Clones a binding scoped to a duplicate view.
function cloneBinding(binding, view) {
  var node = view;
  binding.elementPath.forEach(function(index) {
    node = node.childNodes[index];
  });
  var binding = new Binding(binding);
  binding.element = node;
  binding.view = view;
  return binding;
}

// A regex for determining whether some text has an expression in it
var boundExpr = /{{(.*?)}}/g;

// Tests whether some text has an expression in it. Something like `/user/{{user.id}}`.
function isBound(text) {
  return boundExpr.test(text);
}

function sortAttributes(a, b) {
  return b.binder.priority - a.binder.priority;
}

function notEmpty(value) {
  return !!value;
}
