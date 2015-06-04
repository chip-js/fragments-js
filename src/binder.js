var Binding = require('./binding');
var binderMethods = [ 'created', 'updated', 'attached', 'detached' ];

// All registered bindings are added to this array and assigned to it by name as well for lookup.
var registeredBinders = {};

// Wildcard bindings (i.e. bindings with a `*` in them) are also added here for quick iteration.
var wildcards = [];

// Text binder for text nodes with expressions in them
registerBinder('{{text}}', function(value) {
  this.element.textContent = (value != null) ? value : '';
});

// Catchall attribute binder for regular attributes with expressions in them
registerBinder('{{attribute}}', function(value) {
  if (value != null) {
    this.element.setAttribute(this.name, value);
  } else {
    this.element.removeAttribute(this.name);
  }
});


// Public API for this module, functions found below.
exports.register = registerBinder;
exports.unregister = unregisterBinder;
exports.get = getBinder;
exports.find = findBinder;
exports.createBinding = createBinding;

// Registers a binder that will be used to create a binding with an element whose attribute name matches this binder's.
// The binder can have 5 methods which will be called at various points in an element's lifecycle. Many binders will
// only use the `updated(value)` method, so calling register with a function instead of an object as its second
// parameter is a shortcut to creating a binder with just an `update` method. The binder may also include a `priority`
// to instruct some binders to be processed before others. Binders with higher priority are procssed first.
//
// Listed in order of when they occur in a view's lifecycle:
//
// `compiled(options)` is called when first creating a binding during the template compilation process and receives the
// `options` object that will be passed into `new Binding(options)`. This can be used for creating templates, modifying
// the DOM (only subsequent DOM that hasn't already been processed) and other things that should be applied at compile
// time and not duplicated for each view created.
//
// `created()` is called on the binding when a new view is created. This can be used to add event listeners on the
// element or do other things that will persiste with the view through its many uses. Views may get reused so don't
// do anything here to tie it to a given context.
//
// `attached()` is called on the binding when the view is bound to a given context and inserted into the DOM. This can
// be used to handle context-specific actions, add listeners to the window or document (to be removed in `detached`!),
// etc.
//
// `updated(value, oldValue, changeRecords)` is called on the binding whenever the value of the expression within the
// attribute changes. For example, `bind-text="{{username}}"` will trigger `updated` with the value of username whenever
// it changes on the given context. When the view is removed `updated` will be triggered with a value of `undefined` if
// the value was not already `undefined`, giving a chance to "reset" to an empty state.
//
// `detached()` is called on the binding when the view is unbound to a given context and removed from the DOM. This can
// be used to clean up anything done in `attached()` or in `updated()` before being removed.
//
// Add `onlyWhenBound` when a binder only applies to attributes when an expression is used in them. Otherwise the binder
// will apply and the value of the attribute will simply be a string.
//
// **Example:** This binding handler adds pirateized text to an element.
// ```javascript
// registerBinder('my-pirate', function(value) {
//   if (value == null) {
//     value = '';
//   } else {
//     value = value
//       .replace(/\Bing\b/g, "in'")
//       .replace(/\bto\b/g, "t'")
//       .replace(/\byou\b/, 'ye')
//       + ' arrrr!';
//   }
//   this.element.textContent = value;
// });
// ```
//
// ```html
// <p my-pirate="post.body">This text will be replaced.</p>
// ```
function registerBinder(name, binder) {
  if (typeof binder === 'function') {
    binder = { updated: binder };
  }

  if (name.indexOf('*') >= 0) {
    binder.expr = new RegExp('^' + escapeRegExp(name).replace('\\*', '(.*)') + '$');
    wildcards.push(binder);
    wildcards.sort(binderSort);
  }
  registeredBinders[name] = binder;
  return binder;
};


// Removes a binding handler that was added with `registerBinding()`.
//
// **Example:**
// ```javascript
// binding.removeBinding('pirate')
// ```
//
// ```xml
// <p my-pirate="post.body">This text will not be replaced.</p>
// ```
function unregisterBinder(name) {
  var binder = getBinder(name);
  if (!binder) return;
  if (name.indexOf('*') >= 0) {
    wildcards.splice(wildcards.indexOf(binder), 1);
  }
  delete registeredBinders[name];
  return binder;
}


// Returns a binding object that was added with `registerBinding()`.
function getBinder(name) {
  if (registeredBinders.hasOwnProperty(name)) {
    return registeredBinders[name];
  }
}


// Returns a binding object that matches the given attribute name.
function findBinder(name, value) {
  var binder = getBinder(name);

  if (!binder) {
    wildcards.some(function(wildcardBinder) {
      if (wildcardBinder.expr.test(name)) {
        binder = wildcardBinder;
        return true;
      }
    });
  }

  var bound = isBound(value);

  // E.g. don't use the `value` binder if there is no expression as in `value="some text"`
  if (binder && binder.onlyWhenBound && !bound) {
    return;
  }

  if (!binder && bound) {
    // Test if the attribute value is bound (e.g. `href="/posts/{{ post.id }}"`)
    binder = getBinder('{{attribute}}');
  }

  return binder;
}

// Creates a binding
function createBinding(binder, options) {
  Object.keys(binder).forEach(function(key) {
    options[key] = binder[key];
  });
  return new Binding(options, true);
}


// Takes a string like "(\*)" or "on-\*" and converts it into a regular expression.
function escapeRegExp(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// A regex for determining whether some text has an expression in it
var boundExpr = /{{(.*?)}}/g;

// Tests whether some text has an expression in it. Something like `/user/{{user.id}}`.
function isBound(text) {
  if (!text) return false;
  return !!text.match(boundExpr);
}

function binderSort(a, b) {
  return b.priority - a.priority;
}
