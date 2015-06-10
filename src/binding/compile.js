var fragments = require('../fragments');
var Binder = require('./binder');
var Binding = require('./binding');
var codify = require('../util/codify');
var slice = Array.prototype.slice;

module.exports = compileTemplate;


// Walks the template DOM replacing any bindings and caching bindings onto the template object.
function compileTemplate(template) {
  var walker = document.createTreeWalker(template, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  var bindings = template.bindings = [], currentNode, parentNode, previousNode;

  // Reset first node to ensure it isn't a fragment
  walker.nextNode();
  walker.previousNode();

  // find bindings for each node
  do {
    currentNode = walker.currentNode;
    parentNode = currentNode.parentNode;
    bindings.push.apply(bindings, getBindingsForNode(currentNode, template));

    if (currentNode.parentNode !== parentNode) {
      // currentNode was removed and made a template
      walker.currentNode = previousNode || walker.root;
    } else {
      previousNode = currentNode;
    }
  } while (walker.nextNode());
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
      var expr = codify(node.nodeValue);
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
      var binder = Binder.find(attr.name, attr.value);
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
        expression: codify(value),
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


// Splits text nodes with expressions in them so they can be bound individually, has parentNode passed in since it may
// be a document fragment which appears as null on node.parentNode.
function splitTextNode(node) {
  if (!node.processed) {
    node.processed = true;
    var content = node.nodeValue;
    if (content.match(boundExpr)) {
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

// A regex for determining whether some text has an expression in it
var boundExpr = /{{(.*?)}}/g;

// Tests whether some text has an expression in it. Something like `/user/{{user.id}}`.
function isBound(text) {
  return !!text.match(boundExpr);
}

function sortAttributes(a, b) {
  return b.binder.priority - a.binder.priority;
}

function notEmpty(value) {
  return !!value;
}
