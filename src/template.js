var toFragment = require('./toFragment');

// ## Template
// Takes an HTML string, an element, an array of elements, or a document fragment, and compiles it into a template.
// Instances may then be created and bound to a given context.
// @param {String|NodeList|HTMLCollection|HTMLTemplateElement|HTMLScriptElement|Node} html A Template can be created
// from many different types of objects. Any of these will be converted into a document fragment for the template to
// clone. Nodes and elements passed in will be removed from the DOM.
exports.createTemplate = createTemplate;

// ## View
// Takes an HTML Element or DocumentFragment
exports.createView = createView;

// Registers a hook to be run when a template is compiled or a view is created. `type` can be `'compile'` or `'view'`.
exports.addHook = addHook;

// Removes a hook previously registered. Returns true if the hook was removed, false if it was not registered.
exports.removeHook = removeHook;

// Hooks allow other code to alter and work with templates and views when they are created and managed.
var hooks = {
  // A hook for compiling templates after they are first created. The hook receives a template object which is an HTML
  // Element or a DocumentFragment with additional methods for templating.
  compile: [],

  // A hook for when a view is created after it is first created. The hook receives a view object which is an HTML
  // Element or a DocumentFragment clone of the template with additinoal methods for the handling the view instance.
  // Views can be pooled by the template by calling `dispose()` on the view. This hook only gets called once for a view
  // when it is created and not every time it is returned from the template pool. Views can also be created without a
  // template.
  view: [],

  // A hook for when a view is returned to the template's view pool. The hook receives the view object.
  dispose: []
};

// Methods which get added to each template created. This is exposed for extension.
exports.templateMethods = {

  // Creates a new view (instance of the template) from this template.
  // A view is an HTMLElement (or DocumentFragment) with additional methods. Because we can't extend Node we copy the
  // methods onto them and return them. Views should be removed from the DOM using `view.remove()`.
  createView: templateCreateView
};

// Methods which get added to each view created. This is exposed for extension.
exports.viewMethods = {

  // Removes a view from the DOM. The view may be a DocumentFragment, so `remove()` returns all its nodes to itself. If
  // it isn't then `remove()` is a nice shortcut and provides a consistent interface to the view.
  remove: removeView,

  // Removes a view (if not already removed) and adds the view to its template's pool.
  dispose: disposeView
};



function addHook(type, hook) {
  if (typeof hook !== 'function') throw new TypeError('A hook must be a function');
  if (!hooks[type]) throw new TypeError('Invalid type for hook');
  hooks[type].push(hook);
}


function removeHook(type, hook) {
  if (typeof hook !== 'function') throw new TypeError('A hook must be a function');
  if (!hooks[type]) throw new TypeError('Invalid type for hook');
  var index = hooks[type].indexOf(item);
  if (index >= 0) hooks[type].splice(index, 1);
  return index >= 0;
}


function createTemplate(html) {
  var fragment = toFragment(html);
  if (fragment.childNodes.length === 0) {
    throw new Error('Cannot create a template from ' + html);
  }

  Object.keys(exports.templateMethods).forEach(function(key) {
    fragment[key] = exports.templateMethods[key];
  });

  fragment.pool = [];
  runHooks('compile', fragment);

  return fragment;
}


function templateCreateView() {
  return this.pool.pop() || createView(document.importNode(this, true), this);
}


function createView(fragment, template) {
  if (!(fragment instanceof Node)) {
    throw new TypeError('A view must be created from an HTML Node');
  }

  if (fragment.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
    var node = fragment;
    fragment = document.createDocumentFragment();
    fragment.firstViewNode = fragment.lastViewNode = node;
  } else {
    fragment.firstViewNode = fragment.firstChild;
    fragment.lastViewNode = fragment.lastChild;
  }

  Object.keys(exports.viewMethods).forEach(function(key) {
    fragment[key] = exports.viewMethods[key];
  });

  fragment.template = template;

  runHooks('view', fragment);

  return fragment;
}


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


function disposeView() {
  // Make sure the view is removed from the DOM
  this.remove();
  runHooks('dispose', this);
  if (this.template) {
    this.template.pool.push(this);
  }
}


function runHooks(type, value) {
  hooks[type].forEach(function(hook) {
    hook(value);
  });
}
