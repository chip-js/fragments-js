var toFragment = require('./util/toFragment');
exports.template = template;
exports.view = view;

// Triggers when a template is compiled, a view is created, or a view is disposed.
template.onCompile = function(){};
template.onView = function(){};
view.onDispose = function(){};

// Methods which get added to each template created. This is exposed for extension.
template.methods = {
  view: templateCreateView
};

// Methods which get added to each view created. This is exposed for extension.
view.methods = {
  remove: removeView,
  dispose: disposeView
};


// ## Template
// Takes an HTML string, an element, an array of elements, or a document fragment, and compiles it into a template.
// Instances may then be created and bound to a given context.
// @param {String|NodeList|HTMLCollection|HTMLTemplateElement|HTMLScriptElement|Node} html A Template can be created
// from many different types of objects. Any of these will be converted into a document fragment for the template to
// clone. Nodes and elements passed in will be removed from the DOM.
function template(html) {
  var fragment = toFragment(html);
  if (fragment.childNodes.length === 0) {
    throw new Error('Cannot create a template from ' + html);
  }

  Object.keys(template.methods).forEach(function(key) {
    fragment[key] = template.methods[key];
  });

  fragment.pool = [];
  template.onCompile(fragment);

  return fragment;
}


// Creates a new view (instance of the template) from this template.
// A view is an HTMLElement (or DocumentFragment) with additional methods. Because we can't extend Node we copy the
// methods onto them and return them. Views should be removed from the DOM using `view.remove()`.
function templateCreateView() {
  return this.pool.pop() || view(document.importNode(this, true), this);
}


// ## View
// Takes an HTML Element or DocumentFragment
function view(fragment, fromTemplate) {
  if (!(fragment instanceof Node)) {
    throw new TypeError('A view must be created from an HTML Node');
  }

  if (fragment.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    var node = fragment;
    fragment = document.createDocumentFragment();
    fragment.firstViewNode = fragment.lastViewNode = node;
  } else {
    if (!fromTemplate) {
      // needs to run through the compile if it didn't come from a template
      template.onCompile(fragment);
    }
    fragment.firstViewNode = fragment.firstChild;
    fragment.lastViewNode = fragment.lastChild;
  }

  Object.keys(view.methods).forEach(function(key) {
    fragment[key] = view.methods[key];
  });

  fragment.template = fromTemplate;

  template.onView(fragment);

  return fragment;
}


// Removes a view from the DOM. The view is a DocumentFragment, so `remove()` returns all its nodes to itself.
function removeView() {
  var node = this.firstViewNode;
  var next;

  if (node.parentNode !== this) {
    // Remove all the nodes and put them back into this fragment
    while (node) {
      next = (node === this.lastViewNode) ? null : node.nextSibling;
      this.appendChild(node);
      node = next;
    }
  }

  return this;
}


// Removes a view (if not already removed) and adds the view to its template's pool.
function disposeView() {
  // Make sure the view is removed from the DOM
  this.remove();
  view.onDispose(this);
  if (this.template) {
    this.template.pool.push(this);
  }
}
