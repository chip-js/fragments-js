(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.fragments = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
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

},{"./binding":3}],2:[function(require,module,exports){
var Binder = require('./binder');
var Template = require('./template');

// # Default Bindings


Binder.register('debug', {
  priority: 200,
  udpated: function(value) {
    console.info('Debug:', this.expression, '=', value);
  }
});


// ## html
// Adds a binder to display unescaped HTML inside an element. Be sure it's trusted! This should be used with filters
// which create HTML from something safe.
//
// **Example:**
// ```html
// <h1>{{post.title}}</h1>
// <div html="{{post.body | markdown}}"></div>
// ```
// *Result:*
// ```html
// <h1>Little Red</h1>
// <div>
//   <p>Little Red Riding Hood is a story about a little girl.</p>
//   <p>
//     More info can be found on
//     <a href="http://en.wikipedia.org/wiki/Little_Red_Riding_Hood">Wikipedia</a>
//   </p>
// </div>
// ```
Binder.register('html', function(value) {
  element.innerHTML = value == null ? '' : value;
});



// ## class-[className]
// Adds a binder to add classes to an element dependent on whether the expression is true or false.
//
// **Example:**
// ```html
// <div class="user-item" class-selected-user="{{selected === user}}">
//   <button class="btn primary" class-highlight="{{ready}}"></button>
// </div>
// ```
// *Result if `selected` equals the `user` and `ready` is `true`:*
// ```html
// <div class="user-item selected-user">
//   <button class="btn primary highlight"></button>
// </div>
// ```
Binder.register('class-*', function(value) {
  if (value) {
    this.element.classList.add(this.match);
  } else {
    this.element.classList.remove(this.match);
  }
});



// ## value
// Adds a binder which sets the value of an HTML form element. This binder also updates the data as it is changed in
// the form element, providing two way binding.
//
// **Example:**
// ```html
// <label>First Name</label>
// <input type="text" name="firstName" value="user.firstName">
//
// <label>Last Name</label>
// <input type="text" name="lastName" value="user.lastName">
// ```
// *Result:*
// ```html
// <label>First Name</label>
// <input type="text" name="firstName" value="Jacob">
//
// <label>Last Name</label>
// <input type="text" name="lastName" value="Wright">
// ```
// And when the user changes the text in the first input to "Jac", `user.firstName` will be updated immediately with the
// value of `'Jac'`.
Binder.register('value', {
  onlyWhenBound: true,

  compiled: function() {
    var name = this.element.tagName.toLowerCase();
    var type = this.element.type;
    this.input = inputMethods[type] || inputMethods[name] || inputMethods.radiogroup;

    if (this.element.hasAttribute('value-events')) {
      this.events = this.element.getAttribute('value-events').split(' ');
      this.element.removeAttribute('value-events');
    } else if (name !== 'option') {
      this.events = ['change'];
    }

    if (this.element.hasAttribute('value-field')) {
      this.valueField = this.element.getAttribute('value-field');
      this.element.removeAttribute('value-field');
    }

    if (type === 'option') {
      this.valueField = this.element.parentNode.valueField;
    }
  },

  created: function() {
    if (!this.events) return; // nothing for <option> here
    var element = this.element;
    var observer = this.observer;
    var input = this.input;
    var valueField = this.valueField;

    // The 2-way binding part is setting values on certain events
    function onChange() {
      if (input.get(valueField) !== observer.oldValue && !element.readOnly) {
        observer.set(input.get(valueField));
      }
    }

    if (element.type === 'text') {
      element.addEventListener('keydown', function(event) {
        if (event.keyCode === 13) onChange();
      });
    }

    this.events.forEach(function(event) {
      element.addEventListener(event, onChange);
    });
  },

  updated: function(value) {
    if (this.input.get(this.valueField) != value) {
      this.input.set(value, this.valueField);
    }
  }
});

// Handle the different form types
var defaultInputMethod = {
  get: function() { return this.value; },
  set: function(value) { this.value = value; }
};

var inputMethods = {
  checkbox: {
    get: function() { return this.checked; },
    set: function(value) { this.checked = !!value; }
  },
  file: {
    get: function() { return this.files && this.files[0]; },
    set: function(value) {}
  },
  select: {
    get: function(valueField) {
      if (valueField) {
        return this.options[this.selectedIndex].valueObject;
      } else {
        return this.value;
      }
    },
    set: function(value, valueField) {
      if (valueField) {
        this.valueObject = value;
        this.value = value[valueField];
      } else {
        this.value = value;
      }
    }
  },
  option: {
    get: function(valueField) {
      return valueField ? this.valueObject[valueField] : this.value;
    },
    set: function(value, valueField) {
      if (valueField) {
        this.valueObject = value;
        this.value = value[valueField];
      } else {
        this.value = value;
      }
    }
  },
  input: defaultInputMethod,
  textarea: defaultInputMethod,
  radiogroup: { // Handles a group of radio inputs, assigned to anything that isn't a a form input
    get: function() { return this.find('input[type="radio"][checked]').value },
    set: function(value) {
      // in case the value isn't found in radios
      this.querySelector('input[type="radio"][checked]').checked = false;
      var radio = this.querySelector('input[type="radio"][value="' + value.replace(/"/g, '\\"') + '"]');
      if (radio) radio.checked = true;
    }
  }
};


// ## on-[event]
// Adds a binder for each event name in the array. When the event is triggered the expression will be run.
//
// **Example Events:**
//
// * on-click
// * on-dblclick
// * on-submit
// * on-change
// * on-focus
// * on-blur
//
// **Example:**
// ```html
// <form on-submit="{{saveUser()}}">
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
// *Result (events don't affect the HTML):*
// ```html
// <form>
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
Binder.register('on-*', {
  created: function() {
    var eventName = this.match;
    var _this = this;
    this.element.addEventListener(eventName, function(event) {
      // prevent native events, let custom events use the "defaultCanceled" mechanism
      if (!(event instanceof CustomEvent)) {
        event.preventDefault();
      }
      if (!this.hasAttribute('disabled')) {
        // Let an on-[event] make the function call with its own arguments
        var listener = _this.observer.get();

        // Or just return a function which will be called with the event object
        if (listener) listener.call(this, event);
      }
    });
  }
});


// ## native-[event]
// Adds a binder for each event name in the array. When the event is triggered the expression will be run.
// It will not call event.preventDefault() like on-* or withhold when disabled.
//
// **Example Events:**
//
// * native-click
// * native-dblclick
// * native-submit
// * native-change
// * native-focus
// * native-blur
//
// **Example:**
// ```html
// <form native-submit="{{saveUser(event)}}">
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
// *Result (events don't affect the HTML):*
// ```html
// <form>
//   <input name="firstName" value="Jacob">
//   <button>Save</button>
// </form>
// ```
Binder.register('native-*', {
  created: function() {
    var eventName = this.match;
    var _this = this;
    this.element.addEventListener(eventName, function(event) {
      // Let an on-[event] make the function call with its own arguments
      var listener = _this.observer.get();

      // Or just return a function which will be called with the event object
      if (listener) listener.call(this, event);
    });
  }
});


// ## on-[key event]
// Adds a binder which is triggered when the keydown event's `keyCode` property matches. If the name includes ctrl then
// it will only fire when the key plus the ctrlKey or metaKey is pressed.
//
// **Key Events:**
//
// * on-enter
// * on-ctrl-enter
// * on-esc
//
// **Example:**
// ```html
// <input on-enter="{{save()}}" on-esc="{{cancel()}}">
// ```
// *Result:*
// ```html
// <input>
// ```
var keyCodes = { enter: 13, esc: 27, 'ctrl-enter': 13 };

Object.keys(keyCodes).forEach(function(name) {
  var keyCode = keyCodes[name];

  Binder.register('on-' + name, {
    created: function() {
      var useCtrlKey = this.match.indexOf('ctrl-') === 0;
      var _this = this;
      this.element.addEventListener('keydown', function(event) {
        if (useCtrlKey && !(event.ctrlKey || event.metaKey)) return;
        if (event.keyCode !== keyCode) return;
        event.preventDefault();

        if (!this.hasAttribute('disabled')) {
          // Let an on-[event] make the function call with its own arguments
          var listener = _this.observer.get();

          // Or just return a function which will be called with the event object
          if (listener) listener.call(this, event);
        }
      });
    }
  })
});


// ## [attribute]$
// Adds a binder to set the attribute of element to the value of the expression. Use this when you don't want an
// `<img>` to try and load its `src` before being evaluated. This is only needed on the index.html page as template will
// be processed before being inserted into the DOM. Generally you can just use `attr="{{expr}}"`.
//
// **Example Attributes:**
//
// **Example:**
// ```html
// <img src$="{{user.avatarUrl}}">
// ```
// *Result:*
// ```html
// <img src="http://cdn.example.com/avatars/jacwright-small.png">
// ```
Binder.register('*$', function(value) {
  var attrName = this.match;
  if (!value) {
    this.element.removeAttribute(attrName);
  } else {
    this.element.setAttribute(attrName, value);
  }
});


// ## [attribute]?
// Adds a binder to toggle an attribute on or off if the expression is truthy or falsey. Use for attributes without
// values such as `selected`, `disabled`, or `readonly`. `checked?` will use 2-way databinding.
//
// **Example:**
// ```html
// <label>Is Administrator</label>
// <input type="checkbox" checked?="{{user.isAdmin}}">
// <button disabled?="{{isProcessing}}">Submit</button>
// ```
// *Result if `isProcessing` is `true` and `user.isAdmin` is false:*
// ```html
// <label>Is Administrator</label>
// <input type="checkbox">
// <button disabled>Submit</button>
// ```
Binder.register('*?', function(value) {
  var attrName = this.match;
  if (!value) {
    this.element.removeAttribute(attrName);
  } else {
    this.element.setAttribute(attrName, value);
  }
});

// Add a clone of the `value` binder for `checked?` so checkboxes can have two-way binding using `checked?`.
Binder.register('checked?', Binder.get('value'));



// ## if, unless, else-if, else-unless, else
// Adds a binder to show or hide the element if the value is truthy or falsey. Actually removes the element from the DOM
// when hidden, replacing it with a non-visible placeholder and not needlessly executing bindings inside.
//
// **Example:**
// ```html
// <ul class="header-links">
//   <li if="user"><a href="/account">My Account</a></li>
//   <li unless="user"><a href="/login">Sign In</a></li>
//   <li else><a href="/logout">Sign Out</a></li>
// </ul>
// ```
// *Result if `user` is null:*
// ```html
// <ul class="header-links">
//   <li><a href="/login">Sign In</a></li>
// </ul>
// ```
Binder.register('if', {
  priority: 50,

  compiled: function() {
    var element = this.element;
    var expressions = [ wrapIfExp(this.expression, this.name === 'unless') ];
    var placeholder = document.createTextNode('');
    var node = element.nextElementSibling;
    this.element = placeholder;
    element.parentNode.replaceChild(placeholder, element);

    // Stores a template for all the elements that can go into this spot
    this.templates = [ Template.createTemplate(element) ];

    // Pull out any other elements that are chained with this one
    while (node) {
      var next = node.nextElementSibling;
      var expression;
      if (node.hasAttribute('else-if')) {
        expression = this.codify(node.getAttribute('else-if'));
        expressions.push(wrapIfExp(expression, false));
        node.removeAttribute('else-if');
      } else if (node.hasAttribute('else-unless')) {
        expression = this.codify(node.getAttribute('else-unless'));
        expressions.push(wrapIfExp(expression, true));
        node.removeAttribute('else-unless');
      } else if (node.hasAttribute('else')) {
        node.removeAttribute('else');
        next = null;
      } else {
        break;
      }

      node.remove();
      this.templates.push(Template.createTemplate(node));
      node = next;
    }

    // An expression that will return an index. Something like this `expr ? 0 : expr2 ? 1 : expr3 ? 2 : 3`. This will be
    // used to know which section to show in the if/else-if/else grouping.
    this.expression = expressions.map(function(expr, index) {
      return expr + ' ? ' + index + ' : ';
    }).join('') + expressions.length;
  },

  updated: function(index) {
    if (this.showing) {
      this.showing.dispose();
      this.showing = null;
    }
    var template = this.templates[index];
    if (template) {
      this.showing = template.createView();
      this.showing.bind(this.context);
      this.element.parentNode.insertBefore(this.showing, this.element.nextSibling);
    }
  }
});

Binder.register('unless', Binder.get('if'));

function wrapIfExp(expr, isUnless) {
  return (isUnless ? '!' : '') + expr;
}


// ## each
// Adds a binder to duplicate an element for each item in an array. The expression may be of the format `epxr` or
// `itemName in expr` where `itemName` is the name each item inside the array will be referenced by within bindings
// inside the element.
//
// **Example:**
// ```html
// <div each="{{post in posts}}" class-featured="{{post.isFeatured}}">
//   <h1>{{post.title}}</h1>
//   <div html="{{post.body | markdown}}"></div>
// </div>
// ```
// *Result if there are 2 posts and the first one is featured:*
// ```html
// <div class="featured">
//   <h1>Little Red</h1>
//   <div>
//     <p>Little Red Riding Hood is a story about a little girl.</p>
//     <p>
//       More info can be found on
//       <a href="http://en.wikipedia.org/wiki/Little_Red_Riding_Hood">Wikipedia</a>
//     </p>
//   </div>
// </div>
// <div>
//   <h1>Big Blue</h1>
//   <div>
//     <p>Some thoughts on the New York Giants.</p>
//     <p>
//       More info can be found on
//       <a href="http://en.wikipedia.org/wiki/New_York_Giants">Wikipedia</a>
//     </p>
//   </div>
// </div>
// ```
Binder.register('each', {
  priority: 100,
  compiled: function() {
    var parent = this.element.parentNode;
    var placeholder = document.createTextNode('');
    parent.insertBefore(placeholder, this.element);
    this.template = Template.createTemplate(this.element);
    this.element = placeholder;

    var parts = this.expression.split(/\s+in\s+/);
    this.expression = parts.pop();
    var key = parts.pop();
    if (key) {
      parts = key.split(/\s*,\s*/);
      this.valueName = parts.pop();
      this.keyName = parts.pop();
    }
  },

  created: function() {
    this.views = [];
  },

  updated: function(value, oldValue, changes) {
    if (!changes) {
      this.populate(value);
    } else {
      this.updateChanges(value, changes);
    }
  },

  // Method for creating and setting up new views for our list
  createView: function(key, value) {
    var view = this.template.createView();
    var context = value;
    if (this.valueName) {
      context = Object.create(this.context);
      if (this.keyName) context[this.keyName] = key;
      context[this.valueName] = value;
    }
    view.bind(context);
    view._eachItem_ = value;
    return view;
  },

  populate: function(value) {
    if (this.views.length) {
      this.views.forEach(function(node) {
        node.dispose();
      });
      this.views.length = 0;
    }

    if (Array.isArray(value) && value.length) {
      value.forEach(function(item, index) {
        this.views.push(this.createView(index, item));
      }, this);
    }

    if (this.views.length) {
      var frag = document.createDocumentFragment();
      this.views.forEach(function(elem) {
        frag.appendChild(elem);
      });
      this.element.parentNode.insertBefore(frag, this.element.nextSibling);
    }
  },

  updateChanges: function(value, changes) {
    // Remove everything first, then add again, allowing for element reuse from the pool
    var removedCount = 0;
    var removedMap = new Map();

    changes.forEach(function(splice) {
      if (!splice.removed.length) return;
      var removed = this.views.splice(splice.index - removedCount, splice.removed.length);
      // Save for reuse if items moved (e.g. on a sort update) instead of just getting removed
      removed.forEach(function(view) {
        removedMap.set(view._eachItem_, view);
        view.remove();
      });
      removedCount += removed.length;
    }, this);

    // Add the new/moved views
    changes.forEach(function(splice) {
      if (!splice.addedCount) return;
      var newViews = []
      var frag = document.createDocumentFragment();
      var index = splice.index;
      var count = splice.addedCount;

      for (var i = index; i < addedCount; i++) {
        var item = value[i];

        var view = removedMap.get(item);
        if (view) {
          // If the node was just removed, reuse it
          removedMap.delete(item);
          if (this.keyName) {
            view.context[this.keyName] = i;
          }
        } else {
          // Otherwise create a new one
          view = this.createView(i, item);
        }
        newViews.push(view);
        frag.appendChild(view);
      }
      this.views.splice.apply(this.views, [ index, 0 ].concat(newViews));
      var previousView = this.views[index - 1];
      var nextSibling = previousView ? previousView.lastViewNode.nextSibling : this.element.nextSibling;
      nextSibling.parentNode.insertBefore(frag, nextSibling);
    }, this);

    // Cleanup any views that were removed (not moved)
    removedMap.forEach(function(value) {
      value._eachItem_ = null;
      value.dispose();
    });
    removedMap.clear();
  }
});

},{"./binder":1,"./template":10}],3:[function(require,module,exports){
module.exports = Binding;
Binding.Observer = require('./observer');
Expression = require('./expression');

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
    this.observer = new Binding.Observer(this.expression, this.updated, this);
  }
}

Binding.prototype = {
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
      if (this.hasOwnProperty('updated')) {
        this.observer.bind(context);
      } else {
        // set the contect but don't actually bind it
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

  codify: function(text) {
    return Expression.codify(text);
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

},{"./expression":5,"./observer":9}],4:[function(require,module,exports){
/*
Copyright (c) 2015 Jacob Wright <jacwright@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/
// # Diff
// > Based on work from Google's observe-js polyfill: https://github.com/Polymer/observe-js

// A namespace to store the functions on
var diff = exports;

(function() {

  diff.clone = clone;
  diff.values = diffValues;
  diff.basic = diffBasic;
  diff.objects = diffObjects;
  diff.arrays = diffArrays;


  // A change record for the object changes
  function ChangeRecord(object, type, name, oldValue) {
    this.object = object;
    this.type = type;
    this.name = name;
    this.oldValue = oldValue;
  }

  // A splice record for the array changes
  function Splice(index, removed, addedCount) {
    this.index = index;
    this.removed = removed;
    this.addedCount = addedCount;
  }


  // Creates a clone or copy of an array or object (or simply returns a string/number/boolean which are immutable)
  // Does not provide deep copies.
  function clone(value, deep) {
    if (Array.isArray(value)) {
      if (deep) {
        return value.map(function(value) {
          return clone(value, deep);
        });
      } else {
        return value.slice();
      }
    } else if (value && typeof value === 'object') {
      if (value.valueOf() !== value) {
        return new value.constructor(value.valueOf());
      } else {
        var copy = {};
        for (var key in value) {
          var objValue = value[key];
          if (deep) {
            objValue = clone(objValue, deep);
          }
          copy[key] = objValue;
        }
        return copy;
      }
    } else {
      return value;
    }
  }


  // Diffs two values, returning a truthy value if there are changes or `false` if there are no changes. If the two
  // values are both arrays or both objects, an array of changes (splices or change records) between the two will be
  // returned. Otherwise  `true` will be returned.
  function diffValues(value, oldValue) {
    if (Array.isArray(value) && Array.isArray(oldValue)) {
      // If an array has changed calculate the splices
      var splices = diffArrays(value, oldValue);
      return splices.length ? splices : false;
    } else if (value && oldValue && typeof value === 'object' && typeof oldValue === 'object') {
      // If an object has changed calculate the chnages and call the callback
      // Allow dates and Number/String objects to be compared
      var valueValue = value.valueOf();
      var oldValueValue = oldValue.valueOf();

      // Allow dates and Number/String objects to be compared
      if (typeof valueValue !== 'object' && typeof oldValueValue !== 'object') {
        return valueValue !== oldValueValue;
      } else {
        var changeRecords = diffObjects(value, oldValue);
        return changeRecords.length ? changeRecords : false;
      }
    } else {
      // If a value has changed call the callback
      return diffBasic(value, oldValue);
    }
  }


  // Diffs two basic types, returning true if changed or false if not
  function diffBasic(value, oldValue) {
   if (value && oldValue && typeof value === 'object' && typeof oldValue === 'object') {
      // Allow dates and Number/String objects to be compared
      var valueValue = value.valueOf();
      var oldValueValue = oldValue.valueOf();

      // Allow dates and Number/String objects to be compared
      if (typeof valueValue !== 'object' && typeof oldValueValue !== 'object') {
        return diffBasic(valueValue, oldValueValue);
      }
    }

    // If a value has changed call the callback
    if (typeof value === 'number' && typeof oldValue === 'number' && isNaN(value) && isNaN(oldValue)) {
      return false;
    } else {
      return value !== oldValue;
    }
  }


  // Diffs two objects returning an array of change records. The change record looks like:
  // ```javascript
  // {
  //   object: object,
  //   type: 'deleted|updated|new',
  //   name: 'propertyName',
  //   oldValue: oldValue
  // }
  // ```
  function diffObjects(object, oldObject) {
    var changeRecords = [];
    var prop, oldValue, value;

    // Goes through the old object (should be a clone) and look for things that are now gone or changed
    for (prop in oldObject) {
      oldValue = oldObject[prop];
      value = object[prop];

      // Allow for the case of obj.prop = undefined (which is a new property, even if it is undefined)
      if (value !== undefined && !diffBasic(value, oldValue)) {
        continue;
      }

      // If the property is gone it was removed
      if (! (prop in object)) {
        changeRecords.push(new ChangeRecord(object, 'deleted', prop, oldValue));
      } else if (diffBasic(value, oldValue)) {
        changeRecords.push(new ChangeRecord(object, 'updated', prop, oldValue));
      }
    }

    // Goes through the old object and looks for things that are new
    for (prop in object) {
      value = object[prop];
      if (! (prop in oldObject)) {
        changeRecords.push(new ChangeRecord(object, 'new', prop));
      }
    }

    if (Array.isArray(object) && object.length !== oldObject.length) {
      changeRecords.push(new ChangeRecord(object, 'updated', 'length', oldObject.length));
    }

    return changeRecords;
  }





  EDIT_LEAVE = 0
  EDIT_UPDATE = 1
  EDIT_ADD = 2
  EDIT_DELETE = 3


  // Diffs two arrays returning an array of splices. A splice object looks like:
  // ```javascript
  // {
  //   index: 3,
  //   removed: [item, item],
  //   addedCount: 0
  // }
  // ```
  function diffArrays(value, oldValue) {
    var currentStart = 0;
    var currentEnd = value.length;
    var oldStart = 0;
    var oldEnd = oldValue.length;

    var minLength = Math.min(currentEnd, oldEnd);
    var prefixCount = sharedPrefix(value, oldValue, minLength);
    var suffixCount = sharedSuffix(value, oldValue, minLength - prefixCount);

    currentStart += prefixCount;
    oldStart += prefixCount;
    currentEnd -= suffixCount;
    oldEnd -= suffixCount;

    if (currentEnd - currentStart === 0 && oldEnd - oldStart === 0) {
      return [];
    }

    // if nothing was added, only removed from one spot
    if (currentStart === currentEnd) {
      return [ new Splice(currentStart, oldValue.slice(oldStart, oldEnd), 0) ];
    }

    // if nothing was removed, only added to one spot
    if (oldStart === oldEnd) {
      return [ new Splice(currentStart, [], currentEnd - currentStart) ];
    }

    // a mixture of adds and removes
    var distances = calcEditDistances(value, currentStart, currentEnd, oldValue, oldStart, oldEnd);
    var ops = spliceOperationsFromEditDistances(distances);

    var splice = null;
    var splices = [];
    var index = currentStart;
    var oldIndex = oldStart;

    for (var i = 0, l = ops.length; i < l; i++) {
      var op = ops[i];
      if (op === EDIT_LEAVE) {
        if (splice) {
          splices.push(splice);
          splice = null;
        }

        index++;
        oldIndex++;
      } else if (op === EDIT_UPDATE) {
        if (!splice) {
          splice = new Splice(index, [], 0);
        }

        splice.addedCount++;
        index++;

        splice.removed.push(oldValue[oldIndex]);
        oldIndex++;
      } else if (op === EDIT_ADD) {
        if (!splice) {
          splice = new Splice(index, [], 0);
        }

        splice.addedCount++;
        index++;
      } else if (op === EDIT_DELETE) {
        if (!splice) {
          splice = new Splice(index, [], 0);
        }

        splice.removed.push(oldValue[oldIndex]);
        oldIndex++;
      }
    }

    if (splice) {
      splices.push(splice);
    }

    return splices;
  }




  // find the number of items at the beginning that are the same
  function sharedPrefix(current, old, searchLength) {
    for (var i = 0; i < searchLength; i++) {
      if (diffBasic(current[i], old[i])) {
        return i;
      }
    }
    return searchLength;
  }


  // find the number of items at the end that are the same
  function sharedSuffix(current, old, searchLength) {
    var index1 = current.length;
    var index2 = old.length;
    var count = 0;
    while (count < searchLength && !diffBasic(current[--index1], old[--index2])) {
      count++;
    }
    return count;
  }


  function spliceOperationsFromEditDistances(distances) {
    var i = distances.length - 1;
    var j = distances[0].length - 1;
    var current = distances[i][j];
    var edits = [];
    while (i > 0 || j > 0) {
      if (i === 0) {
        edits.push(EDIT_ADD);
        j--;
        continue;
      }

      if (j === 0) {
        edits.push(EDIT_DELETE);
        i--;
        continue;
      }

      var northWest = distances[i - 1][j - 1];
      var west = distances[i - 1][j];
      var north = distances[i][j - 1];

      if (west < north) {
        min = west < northWest ? west : northWest;
      } else {
        min = north < northWest ? north : northWest;
      }

      if (min === northWest) {
        if (northWest === current) {
          edits.push(EDIT_LEAVE);
        } else {
          edits.push(EDIT_UPDATE);
          current = northWest;
        }
        i--;
        j--;
      } else if (min === west) {
        edits.push(EDIT_DELETE);
        i--;
        current = west;
      } else {
        edits.push(EDIT_ADD);
        j--;
        current = north;
      }
    }
    edits.reverse();
    return edits;
  }


  function calcEditDistances(current, currentStart, currentEnd, old, oldStart, oldEnd) {
    // "Deletion" columns
    var rowCount = oldEnd - oldStart + 1;
    var columnCount = currentEnd - currentStart + 1;
    var distances = new Array(rowCount);
    var i, j;

    // "Addition" rows. Initialize null column.
    for (i = 0; i < rowCount; i++) {
      distances[i] = new Array(columnCount);
      distances[i][0] = i;
    }

    // Initialize null row
    for (j = 0; j < columnCount; j++) {
      distances[0][j] = j;
    }

    for (i = 1; i < rowCount; i++) {
      for (j = 1; j < columnCount; j++) {
        if (!diffBasic(current[currentStart + j - 1], old[oldStart + i - 1])) {
          distances[i][j] = distances[i - 1][j - 1];
        } else {
          var north = distances[i - 1][j] + 1;
          var west = distances[i][j - 1] + 1;
          distances[i][j] = north < west ? north : west;
        }
      }
    }

    return distances;
  }
})();

},{}],5:[function(require,module,exports){
// # Chip Expression

// Parses a string of JavaScript into a function which can be bound to a scope.
//
// Allows undefined or null values to return undefined rather than throwing
// errors, allows for formatters on data, and provides detailed error reporting.

// The expression object with its expression cache.
var expression = exports;
expression.cache = {};
expression.globals = ['true', 'false', 'null', 'undefined', 'window', 'this'];
expression.codify = codifyExpression;
expression.get = getExpression;
expression.getSetter = getSetter;
expression.bind = bindExpression;

var oneBoundExpr = /^{{(.*?)}}$/;
var boundExpr = /{{(.*?)}}/g;

// Converts an inverted expression from `/user/{{user.id}}` to `"/user/" + user.id`
function codifyExpression(text) {
  if (oneBoundExpr.test(text)) {
    return text.replace(oneBoundExpr, '$1');
  } else {
    text = '"' + text.replace(boundExpr, function(match, text) {
      return '" + (' + text + ' || "") + "';
    }) + '"';
    return text.replace(/^"" \+ | "" \+ | \+ ""$/g, '');
  }
}


// Creates a function from the given expression. An `options` object may be
// provided with the following options:
// * `args` is an array of strings which will be the function's argument names
// * `globals` is an array of strings which define globals available to the
// function (these will not be prefixed with `this.`). `'true'`, `'false'`,
// `'null'`, and `'window'` are included by default.
//
// This function will be cached so subsequent calls with the same expression will
// return the same function. E.g. the expression "name" will always return a
// single function with the body `return this.name`.
function getExpression(expr, options) {
  if (!options) options = {};
  if (!options.args) options.args = [];
  var cacheKey = expr + '|' + options.args.join(',');
  // Returns the cached function for this expression if it exists.
  var func = expression.cache[cacheKey];
  if (func) {
    return func;
  }

  options.args.unshift('_formatters_');

  // Prefix all property lookups with the `this` keyword. Ignores keywords
  // (window, true, false) and extra args
  var body = parseExpression(expr, options);

  try {
    func = expression.cache[cacheKey] = Function.apply(null, options.args.concat(body));
  } catch (e) {
    if (options.ignoreErrors) return;
    // Throws an error if the expression was not valid JavaScript
    console.error('Bad expression:\n`' + expr + '`\n' + 'Compiled expression:\n' + body);
    throw new Error(e.message);
  }
  return func;
}


// Creates a setter function from the given expression.
function getSetter(expr, options) {
  if (!options) options = {};
  options.args = ['value'];
  expr = expr.replace(/(\s*\||$)/, ' = value$1');
  return getExpression(expr, options);
}



// Compiles an expression and binds it in the given scope. This allows it to be
// called from anywhere (e.g. event listeners) while retaining the scope.
function bindExpression(expr, scope, options) {
  return getExpression(expr, options).bind(scope);
}

// finds all quoted strings
var quoteExpr = /(['"\/])(\\\1|[^\1])*?\1/g;

// finds all empty quoted strings
var emptyQuoteExpr = /(['"\/])\1/g;

// finds pipes that aren't ORs (` | ` not ` || `) for formatters
var pipeExpr = /\|(\|)?/g;

// finds the parts of a formatter (name and args)
var formatterExpr = /^([^\(]+)(?:\((.*)\))?$/;

// finds argument separators for formatters (`arg1:arg2`)
var argSeparator = /\s*,\s*/g;

// matches property chains (e.g. `name`, `user.name`, and `user.fullName().capitalize()`)
var propExpr = /((\{|,|\.)?\s*)([a-z$_\$](?:[a-z_\$0-9\.-]|\[['"\d]+\])*)(\s*(:|\(|\[)?)/gi;

// links in a property chain
var chainLinks = /\.|\[/g;

// the property name part of links
var chainLink = /\.|\[|\(/;

// determines whether an expression is a setter or getter (`name` vs
// `name = 'bob'`)
var setterExpr = /\s=\s/;

var ignore = null;
var strings = [];
var referenceCount = 0;
var currentReference = 0;
var currentIndex = 0;
var finishedChain = false;
var continuation = false;

// Adds `this.` to the beginning of each valid property in an expression,
// processes formatters, and provides null-termination in property chains
function parseExpression(expr, options) {
  initParse(expr, options);
  expr = pullOutStrings(expr);
  expr = parseFormatters(expr);
  expr = parseExpr(expr);
  expr = 'return ' + expr;
  expr = putInStrings(expr);
  expr = addReferences(expr);
  return expr;
}


function initParse(expr, options) {
  referenceCount = currentReference = 0;
  // Ignores keywords and provided argument names
  ignore = expression.globals.concat(options.globals || [], options.args || []);
  strings.length = 0;
}


// Adds placeholders for strings so we can process the rest without their content
// messing us up.
function pullOutStrings(expr) {
  return expr.replace(quoteExpr, function(str, quote) {
    strings.push(str);
    return quote + quote; // placeholder for the string
  });
}


// Replaces string placeholders.
function putInStrings(expr) {
  return expr.replace(emptyQuoteExpr, function() {
    return strings.shift();
  });
}


// Prepends reference variable definitions
function addReferences(expr) {
  if (referenceCount) {
    var refs = [];
    for (var i = 1; i <= referenceCount; i++) {
      refs.push('_ref' + i);
    }
    expr = 'var ' + refs.join(', ') + ';\n' + expr;
  }
  return expr;
}


function parseFormatters(expr) {
  // Removes formatters from expression string
  expr = expr.replace(pipeExpr, function(match, orIndicator) {
    if (orIndicator) return match;
    return '@@@';
  });

  formatters = expr.split(/\s*@@@\s*/);
  expr = formatters.shift();
  if (!formatters.length) return expr;

  // Processes the formatters
  // If the expression is a setter the value will be run through the formatters
  var setter = '';
  value = expr;

  if (setterExpr.test(expr)) {
    var parts = expr.split(setterExpr);
    setter = parts[0] + ' = ';
    value = parts[1];
  }

  formatters.forEach(function(formatter) {
    var match = formatter.trim().match(formatterExpr);
    if (!match) throw new Error('Formatter is invalid: ' + formatter);
    var formatterName = match[1];
    var args = match[2].split(argSeparator);
    args.unshift(value);
    if (setter) args.push(true);
    value = '_formatters_.' + formatterName + '.call(this, ' + args.join(', ') + ')';
  });

  return setter + value;
}


function parseExpr(expr) {
  if (setterExpr.test(expr)) {
    var parts = expr.split(' = ');
    var setter = parts[0];
    var value = parts[1];
    var negate = '';
    if (setter.charAt(0) === '!') {
      negate = '!';
      setter = setter.slice(1);
    }
    setter = parsePropertyChains(setter).replace(/^\(|\)$/g, '') + ' = ';
    value = parsePropertyChains(value);
    return setter + negate + value;
  } else {
    return parsePropertyChains(expr);
  }
}


function parsePropertyChains(expr) {
  var javascript = '', js;
  // allow recursion into function args by resetting propExpr
  var previousIndexes = [currentIndex, propExpr.lastIndex];
  currentIndex = 0;
  propExpr.lastIndex = 0;
  while ((js = nextChain(expr)) !== false) {
    javascript += js;
  }
  currentIndex = previousIndexes[0];
  propExpr.lastIndex = previousIndexes[1];
  return javascript;
}


function nextChain(expr) {
  if (finishedChain) {
    return (finishedChain = false);
  }
  var match = propExpr.exec(expr);
  if (!match) {
    finishedChain = true // make sure next call we return false
    return expr.slice(currentIndex);
  }

  // `prefix` is `objIndicator` with the whitespace that may come after it.
  var prefix = match[1];

  // `objIndicator` is `{` or `,` and let's us know this is an object property
  // name (e.g. prop in `{prop:false}`).
  var objIndicator = match[2];

  // `propChain` is the chain of properties matched (e.g. `this.user.email`).
  var propChain = match[3];

  // `postfix` is the `colonOrParen` with whitespace before it.
  var postfix = match[4];

  // `colonOrParen` matches the colon (:) after the property (if it is an object)
  // or parenthesis if it is a function. We use `colonOrParen` and `objIndicator`
  // to know if it is an object.
  var colonOrParen = match[5];

  match = match[0];

  var skipped = expr.slice(currentIndex, propExpr.lastIndex - match.length);
  currentIndex = propExpr.lastIndex;

  // skips object keys e.g. test in `{test:true}`.
  if (objIndicator && colonOrParen === ':') {
    return skipped + match;
  }

  return skipped + parseChain(prefix, propChain, postfix, colonOrParen, expr);
}


function splitLinks(chain) {
  var index = 0;
  var parts = [];
  var match;
  while (match = chainLinks.exec(chain)) {
    if (chainLinks.lastIndex === 1) continue;
    parts.push(chain.slice(index, chainLinks.lastIndex - 1));
    index = chainLinks.lastIndex - 1;
  }
  parts.push(chain.slice(index));
  return parts;
}


function addThis(chain) {
  if (ignore.indexOf(chain.split(chainLink).shift()) === -1) {
    return 'this.' + chain;
  } else {
    return chain;
  }
}


function parseChain(prefix, propChain, postfix, paren, expr) {
  // continuations after a function (e.g. `getUser(12).firstName`).
  continuation = prefix === '.';
  if (continuation) {
    propChain = '.' + propChain;
    prefix = '';
  }

  var links = splitLinks(propChain);
  var newChain = '';

  if (links.length === 1 && !continuation && !paren) {
    link = links[0];
    newChain = addThis(link);
  } else {
    if (!continuation) {
      newChain = '(';
    }

    links.forEach(function(link, index) {
      if (index !== links.length - 1) {
        newChain += parsePart(link, index);
      } else {
        if (!parens[paren]) {
          newChain += '_ref' + currentReference + link + ')';
        } else {
          postfix = postfix.replace(paren, '');
          newChain += parseFunction(link, index, expr);
        }
      }
    });
  }

  return prefix + newChain + postfix;
}


var parens = {
  '(': ')',
  '[': ']'
};

// Handles a function to be called in its correct scope
// Finds the end of the function and processes the arguments
function parseFunction(link, index, expr) {
  var call = getFunctionCall(expr);
  link += call.slice(0, 1) + '~~insideParens~~' + call.slice(-1);
  var insideParens = call.slice(1, -1);

  if (expr.charAt(propExpr.lastIndex) === '.') {
    link = parsePart(link, index)
  } else if (index === 0) {
    link = parsePart(link, index);
    link += '_ref' + currentReference + ')';
  } else {
    link = '_ref' + currentReference + link + ')';
  }

  var ref = currentReference;
  link = link.replace('~~insideParens~~', parsePropertyChains(insideParens));
  currentReference = ref;
  return link;
}


// returns the call part of a function (e.g. `test(123)` would return `(123)`)
function getFunctionCall(expr) {
  var startIndex = propExpr.lastIndex;
  var open = expr.charAt(startIndex - 1);
  var close = parens[open];
  var endIndex = startIndex - 1;
  var parenCount = 1;
  while (endIndex++ < expr.length) {
    var ch = expr.charAt(endIndex);
    if (ch === open) parenCount++;
    else if (ch === close) parenCount--;
    if (parenCount === 0) break;
  }
  currentIndex = propExpr.lastIndex = endIndex + 1;
  return open + expr.slice(startIndex, endIndex) + close;
}



function parsePart(part, index) {
  // if the first
  if (index === 0 && !continuation) {
    if (ignore.indexOf(part.split(/\.|\(|\[/).shift()) === -1) {
      part = 'this.' + part;
    }
  } else {
    part = '_ref' + currentReference + part;
  }

  currentReference = ++referenceCount;
  var ref = '_ref' + currentReference;
  return '(' + ref + ' = ' + part + ') == null ? undefined : ';
}

},{}],6:[function(require,module,exports){
// # Formatter

exports.register = registerFormatter;
exports.unregister = unregisterFormatter;
exports.get = getFormatter;

// A Formatter is stored to process the value of an expression. This alters the value of what comes in with a function
// that returns a new value. Formatters are added by using a single pipe character (`|`) followed by the name of the
// formatter. Multiple formatters can be used by chaining pipes with formatter names. Formatters may also have arguments passed to
// them by using the colon to separate arguments from the formatter name. The signature of a formatter should be `function
// (controller, value, args...)` where args are extra parameters passed into the formatter after colons.
//
// *Example:*
// ```js
// Formatter.register('uppercase', function(controller, value) {
//   if (typeof value != 'string') return ''
//   return value.toUppercase()
// })
//
// Formatter.register('replace', function(controller, value, replace, with) {
//   if (typeof value != 'string') return ''
//   return value.replace(replace, with)
// })
// ```xml
// <h1 bind-text="title | uppercase | replace:'LETTER':'NUMBER'"></h1>
// ```
// *Result:*
// ```xml
// <h1>GETTING TO KNOW ALL ABOUT THE NUMBER A</h1>
// ```
//
// A `valueFormatter` is like a formatter but used specifically with the `value` binding since it is a two-way binding. When
// the value of the element is changed a `valueFormatter` can adjust the value from a string to the correct value type for
// the controller expression. The signature for a `valueFormatter` includes the current value of the expression
// before the optional arguments (if any). This allows dates to be adjusted and possibley other uses.
//
// *Example:*
// ```js
// Formatter.register('numeric', function(controller, value) {
//   // value coming from the controller expression, to be set on the element
//   if (value == null || isNaN(value)) return ''
//   return value
// })
//
// Formatter.register('date-hour', function(controller, value) {
//   // value coming from the controller expression, to be set on the element
//   if ( !(currentValue instanceof Date) ) return ''
//   var hours = value.getHours()
//   if (hours >= 12) hours -= 12
//   if (hours == 0) hours = 12
//   return hours
// })
// ```xml
// <label>Number Attending:</label>
// <input size="4" bind-value="event.attendeeCount | numeric">
// <label>Time:</label>
// <input size="2" bind-value="event.date | date-hour"> :
// <input size="2" bind-value="event.date | date-minute">
// <select bind-value="event.date | date-ampm">
//   <option>AM</option>
//   <option>PM</option>
// </select>
// ```
var formatters = exports.formatters = {};

function registerFormatter(name, formatter) {
  formatters[name] = formatter;
}

function unregisterFormatter(name, formatter) {
  delete formatters[name];
}

function getFormatter(name) {
  return formatters[name];
}

},{}],7:[function(require,module,exports){
Formatter = require('./formatter');

// # Default Formatters

Formatter.register('tokenList', function(value) {

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  if (value && typeof value === 'object') {
    var classes = [];
    Object.keys(value).forEach(function(className) {
      if (value[className]) {
        classes.push(className);
      }
    });
    return classes.join(' ');
  }

  return value || '';
});

// v TODO v
Formatter.register('styles', function(value) {

  if (Array.isArray(value)) {
    return value.join(' ');
  }

  if (value && typeof value === 'object') {
    var classes = [];
    Object.keys(value).forEach(function(className) {
      if (value[className]) {
        classes.push(className);
      }
    });
    return classes.join(' ');
  }

  return value || '';
});


// ## filter
// Filters an array by the given filter function(s), may provide a function, an
// array, or an object with filtering functions
Formatter.register('filter', function(value, filterFunc) {
  if (!Array.isArray(value)) {
    return [];
  } else if (!filterFunc) {
    return value;
  }

  if (typeof filterFunc === 'function') {
    value = value.filter(filterFunc, this);
  } else if (Array.isArray(filterFunc)) {
    filterFunc.forEach(function(func) {
      value = value.filter(func, this);
    });
  } else if (typeof filterFunc === 'object') {
    Object.keys(filterFunc).forEach(function(key) {
      var func = filterFunc[key];
      if (typeof func === 'function') {
        value = value.filter(func, this);
      }
    });
  }
  return value;
});

// ## map
// Adds a formatter to map an array or value by the given mapping function
Formatter.register('map', function(value, mapFunc) {
  if (value == null || typeof mapFunc !== 'function') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(mapFunc, this);
  } else {
    return mapFunc.call(this, value);
  }
});

// ## reduce
// Adds a formatter to reduce an array or value by the given reduce function
Formatter.register('reduce', function(value, reduceFunc, initialValue) {
  if (value == null || typeof mapFunc !== 'function') {
    return value;
  }
  if (Array.isArray(value)) {
    if (arguments.length === 3) {
      return value.reduce(reduceFunc, initialValue);
    } else {
      return value.reduce(reduceFunc);
    }
  } else if (arguments.length === 3) {
    return reduceFunc(initialValue, value);
  }
});

// ## reduce
// Adds a formatter to reduce an array or value by the given reduce function
Formatter.register('slice', function(value, index, endIndex) {
  if (Array.isArray(value)) {
    return value.slice(index, endIndex);
  } else {
    return value;
  }
});


// ## date
// Adds a formatter to format dates and strings
Formatter.register('date', function(value) {
  if (!value) {
    return '';
  }

  if (!(value instanceof Date)) {
    value = new Date(value);
  }

  if (isNaN(value.getTime())) {
    return '';
  }

  return value.toLocaleString();
});


// ## log
// Adds a formatter to log the value of the expression, useful for debugging
Formatter.register('log', function(value, prefix) {
  if (prefix == null) prefix = 'Log:';
  console.log(prefix, value);
  return value;
});


// ## limit
// Adds a formatter to limit the length of an array or string
Formatter.register('limit', function(value, limit) {
  if (value && typeof value.slice === 'function') {
    if (limit < 0) {
      return value.slice(limit);
    } else {
      value.slice(0, limit);
    }
  } else {
    return value;
  }
});


// ## sort
// Sorts an array given a field name or sort function, and a direction
Formatter.register('sort', function(value, sortFunc, dir) {
  if (!sortFunc || !Array.isArray(value)) {
    return value;
  }
  dir = (dir === 'desc') ? -1 : 1;
  if (typeof sortFunc === 'string') {
    var parts = sortFunc.split(':');
    var prop = parts[0];
    var dir2 = parts[1];
    dir2 = (dir2 === 'desc') ? -1 : 1;
    dir = dir || dir2;
    var sortFunc = function(a, b) {
      if (a[prop] > b[prop]) return dir;
      if (a[prop] < b[prop]) return -dir;
      return 0;
    };
  } else if (dir === -1) {
    var origFunc = sortFunc;
    sortFunc = function(a, b) { return -origFunc(a, b); };
  }

  return value.slice().sort(sortFunc);
});


// ## addQuery
// Takes the input URL and adds (or replaces) the field in the query
Formatter.register('addQuery', function(value, queryField, queryValue) {
  var url = value || location.href;
  var parts = url.split('?');
  url = parts[0];
  var query = parts[1];
  var addedQuery = '';
  if (queryValue != null) {
    addedQuery = queryField + '=' + encodeURIComponent(queryValue);
  }

  if (query) {
    var expr = new RegExp('\\b' + queryField + '=[^&]*');
    if (expr.test(query)) {
      query = query.replace(expr, addedQuery);
    } else if (addedQuery) {
      query += '&' + addedQuery;
    }
  } else {
    query = addedQuery;
  }
  if (query) {
    url += '?' + query;
  }
  return url;
});


var div = document.createElement('div')
function escapeHTML(value) {
  div.textContent = value || '';
  return div.innerHTML;
}

// ## escape
// HTML escapes content. For use with other HTML-adding formatters such as autolink.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | escape | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</div>
// ```
Formatter.register('escape', escapeHTML);


// ## p
// HTML escapes content wrapping paragraphs in <p> tags.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | p | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div><p>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</p>
// <p>It's great</p></div>
// ```
Formatter.register('p', function(value) {
  var lines = (value || '').split(/\r?\n/);
  var escaped = lines.map(function(line) { return escapeHTML(line) || '<br>'; });
  return '<p>' + escaped.join('</p><p>') + '</p>';
});


// ## br
// HTML escapes content adding <br> tags in place of newlines characters.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | br | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!<br>
// It's great</div>
// ```
Formatter.register('br', function(value) {
  var lines = (value || '').split(/\r?\n/);
  return lines.map(escapeHTML).join('<br>');
});


// ## newline
// HTML escapes content adding <p> tags at double newlines and <br> tags in place of single newline characters.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | newline | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div><p>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!<br>
// It's great</p></div>
// ```
Formatter.register('newline', function(value) {
  var paragraphs = (value || '').split(/\r?\n\s*\r?\n/);
  var escaped = paragraphs.map(function(paragraph) {
    var lines = paragraph.split(/\r?\n/);
    return lines.map(escapeHTML).join('<br>');
  });
  return '<p>' + escaped.join('</p><p>') + '</p>';
});


// ## autolink
// Adds automatic links to escaped content (be sure to escape user content). Can be used on existing HTML content as it
// will skip URLs within HTML tags. Passing true in the second parameter will set the target to `_blank`.
//
// **Example:**
// ```xml
// <div bind-html="tweet.content | escape | autolink:true"></div>
// ```
// *Result:*
// ```xml
// <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</div>
// ```
var urlExp = /(^|\s|\()((?:https?|ftp):\/\/[\-A-Z0-9+\u0026@#\/%?=()~_|!:,.;]*[\-A-Z0-9+\u0026@#\/%=~(_|])/gi;

Formatter.register('autolink', function(value, target) {
  target = (target) ? ' target="_blank"' : '';

  return ('' + value).replace(/<[^>]+>|[^<]+/g, function(match) {
    if (match.charAt(0) === '<') {
      return match;
    }
    return match.replace(urlExp, '$1<a href="$2"' + target + '>$2</a>');
  });
});


Formatter.register('int', function(value) {
  value = parseInt(value);
  return isNaN(value) ? null : value;
});


Formatter.register('float', function(value) {
  value = parseFloat(value);
  return isNaN(value) ? null : value;
});


Formatter.register('bool', function(value) {
  return value && value !== '0' && value !== 'false';
});

},{"./formatter":6}],8:[function(require,module,exports){
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

// Clones a binding scoped to a duplicate view.
function cloneBinding(binding, view) {
  var node = view;
  binding.elementPath.forEach(function(index) {
    node = node.childNodes[index];
  });
  var binding = new Binding(binding);
  binding.element = node;
  binding.view = view;
  binding.created();
  return binding;
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

},{"./binder":1,"./binding":3,"./expression":5,"./template":10}],9:[function(require,module,exports){
module.exports = Observer;
var expression = require('./expression');
var formatters = require('./formatter').formatters;
var diff = require('./diff');

// # Observer

// Defines an observer class which represents an expression. Whenever that expression returns a new value the `callback`
// is called with the value.
//
// If the old and new values were either an array or an object, the `callback` also
// receives an array of splices (for an array), or an array of change objects (for an object) which are the same
// format that `Array.observe` and `Object.observe` return <http://wiki.ecmascript.org/doku.php?id=harmony:observe>.
function Observer(expr, callback, callbackContext) {
  this.getter = expression.get(expr);
  this.setter = expression.getSetter(expr, { ignoreErrors: true });
  this.callback = callback;
  this.callbackContext = callbackContext;
  this.skip = false;
  this.context = null;
  this.oldValue = undefined;
}

Observer.prototype = {

  // Binds this expression to a given context
  bind: function(context, skipUpdate) {
    this.context = context;
    if (this.callback) {
      Observer.add(this, skipUpdate);
    }
  },

  // Unbinds this expression
  unbind: function() {
    this.context = null;
    Observer.remove(this);
    this.sync();
  },

  // Returns the current value of this observer
  get: function() {
    if (this.context) {
      return this.getter.call(this.context, formatters);
    }
  },

  // Sets the value of this expression
  set: function(value) {
    if (this.context && this.setter) {
      return this.setter.call(this.context, formatters, value);
    }
  },


  // Instructs this observer to not call its `callback` on the next sync, whether the value has changed or not
  skipNextSync: function() {
    this.skip = true;
  },


  // Syncs this observer now, calling the callback immediately if there have been changes
  sync: function() {
    var value = this.get();

    // Don't call the callback if `skipNextSync` was called on the observer
    if (this.skip || !this.callback) {
      this.skip = false;
    } else {
      // If an array has changed calculate the splices and call the callback. This
      var changed = diff.values(value, this.oldValue);
      if (!changed) return;
      if (Array.isArray(changed)) {
        this.callback.call(this.callbackContext, value, this.oldValue, changed)
      } else {
        this.callback.call(this.callbackContext, value, this.oldValue);
      }
    }

    // Store an immutable version of the value, allowing for arrays and objects to change instance but not content and
    // still refrain from dispatching callbacks (e.g. when using an object in bind-class or when using array formatters
    // in bind-each)
    this.oldValue = diff.clone(value);
  }
};


// An array of all observers, considered *private*
Observer.observers = [];

// An array of callbacks to run after the next sync, considered *private*
Observer.callbacks = [];
Observer.listeners = [];

// Adds a new observer to be synced with changes. If `skipUpdate` is true then the callback will only be called when a
// change is made, not initially.
Observer.add = function(observer, skipUpdate) {
  this.observers.push(observer);
  if (!skipUpdate) observer.sync();
};

// Removes an observer, stopping it from being run
Observer.remove = function(observer) {
  var index = this.observers.indexOf(observer);
  if (index !== -1) {
    this.observers.splice(index, 1);
    return true;
  } else {
    return false;
  }
};

// *private* properties used in the sync cycle
Observer.syncing = false;
Observer.rerun = false;
Observer.cycles = 0;
Observer.max = 10;
Observer.timeout = null;

// Runs the observer sync cycle which checks all the observers to see if they've changed.
Observer.sync = function(callback) {
  if (typeof callback === 'function') {
    this.afterSync(callback);
  }

  if (this.syncing) {
    this.rerun = true;
    return false;
  }

  this.syncing = true;
  this.rerun = true;
  this.cycles = 0;

  // Allow callbacks to run the sync cycle again immediately, but stop at `this.max` (default 10) cycles to we don't
  // run infinite loops
  while (this.rerun) {
    if (++this.cycles === this.max) {
      throw new Error('Infinite observer syncing, an observer is calling Observer.sync() too many times');
    }
    this.rerun = false;
    // the observer array may increase or decrease in size (remaining observers) during the sync
    for (var i = 0; i < this.observers.length; i++) {
      this.observers[i].sync();
    }
  }

  while (this.callbacks.length) {
    this.callbacks.shift()();
  }

  for (var i = 0, l = this.listeners.length; i < l; i++) {
    var listener = this.listeners[i];
    listener();
  }

  this.syncing = false;
  this.cycles = 0;
  return true;
};

Observer.syncLater = function(callback) {
  if (!this.timeout) {
    var _this = this;
    this.timeout = setTimeout(function() {
      _this.timeout = null;
      _this.sync(callback);
    });
    return true;
  } else {
    return false;
  }
};

// After the next sync (or the current if in the middle of one), run the provided callback
Observer.afterSync = function(callback) {
  if (typeof callback === 'function') {
    throw new TypeError('callback must be a function');
  }
  this.callbacks.push(callback);
};

Observer.onSync = function(listener) {
  if (typeof listener === 'function') {
    throw new TypeError('listener must be a function');
  }
  this.listeners.push(listener);
};

Observer.removeOnSync = function(listener) {
  if (typeof listener === 'function') {
    throw new TypeError('listener must be a function');
  }
  var index = this.listeners.indexOf(listener);
  if (index !== -1) {
    this.listeners.splice(index, 1).pop();
  }
};

},{"./diff":4,"./expression":5,"./formatter":6}],10:[function(require,module,exports){
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

},{"./toFragment":11}],11:[function(require,module,exports){
module.exports = toFragment;

// Convert stuff into document fragments. Stuff can be:
// * A string of HTML text
// * An element or text node
// * A NodeList or HTMLCollection (e.g. `element.childNodes` or `element.children`)
// * A jQuery object
// * A script element with a `type` attribute of `"text/*"` (e.g. `<script type="text/html">My template code!</script>`)
// * A template element (e.g. `<template>My template code!</template>`)
function toFragment(html) {
  if (html instanceof DocumentFragment) {
    return html;
  } else if (typeof html === 'string') {
    return stringToFragment(html);
  } else if (html instanceof Node) {
    return nodeToFragment(html);
  } else if (html.hasOwnProperty('length')) {
    return listToFragment(html);
  } else {
    throw new TypeError('Unsupported Template Type: Cannot convert `' + html + '` into a document fragment.');
  }
}

// Converts an HTML node into a document fragment. If it is a <template> node its contents will be used. If it is a
// <script> node its string-based contents will be converted to HTML first, then used. Otherwise a clone of the node
// itself will be used.
function nodeToFragment(node) {
  if (node.content instanceof DocumentFragment) {
    return node.content;
  } else if (node.tagName === 'SCRIPT') {
    return stringToFragment(node.innerHTML);
  } else {
    var fragment = document.createDocumentFragment();
    if (node.tagName === 'TEMPLATE') {
      for (var i = 0, l = node.childNodes.length; i < l; i++) {
        fragment.appendChild(node.childNodes[i]);
      }
    } else {
      fragment.appendChild(node);
    }
    return fragment;
  }
}

// Converts an HTMLCollection, NodeList, jQuery object, or array into a document fragment.
function listToFragment(list) {
  var fragment = document.createDocumentFragment();
  for (var i = 0, l = list.length; i < l; i++) {
    // Use toFragment since this may be an array of text, a jQuery object of `<template>`s, etc.
    fragment.appendChild(toFragment(list[i]));
  }
  return fragment;
}

// Converts a string of HTML text into a document fragment.
function stringToFragment(string) {
  var templateElement;
  templateElement = document.createElement('template');
  templateElement.innerHTML = string;
  return templateElement.content;
}

// If HTML Templates are not available (e.g. in IE) then use an older method to work with certain elements.
if (!document.createElement('template').content instanceof DocumentFragment) {
  stringToFragment = (function() {
    var tagExp = /<([\w:-]+)/;

    // Copied from jQuery (https://github.com/jquery/jquery/blob/master/LICENSE.txt)
    var wrapMap = {
      option: [ 1, '<select multiple="multiple">', '</select>' ],
      legend: [ 1, '<fieldset>', '</fieldset>' ],
      thead: [ 1, '<table>', '</table>' ],
      tr: [ 2, '<table><tbody>', '</tbody></table>' ],
      td: [ 3, '<table><tbody><tr>', '</tr></tbody></table>' ],
      col: [ 2, '<table><tbody></tbody><colgroup>', '</colgroup></table>' ],
      area: [ 1, '<map>', '</map>' ],
      _default: [ 0, '', '' ]
    };
    wrapMap.optgroup = wrapMap.option;
    wrapMap.tbody = wrapMap.tfoot = wrapMap.colgroup = wrapMap.caption = wrapMap.thead;
    wrapMap.th = wrapMap.td;

    return function stringToFragment(string) {
      var tag = string.match(tagExp);
      var parts = wrapMap[tag] || wrapMap._default;
      var depth = parts[0];
      var prefix = parts[1];
      var postfix = parts[2];
      var div = document.createElement('div');
      div.innerHTML = prefix + string + postfix;
      while (depth--) {
        div = div.lastChild;
      }
      var fragment = document.createDocumentFragment();
      while (div.firstChild) {
        fragment.appendChild(div.firstChild);
      }
      return fragment;
    };
  })();
}

},{}],12:[function(require,module,exports){
exports.Observer = require('./src/observer');
exports.diff = require('./src/diff');
exports.Template = require('./src/template');
exports.Expression = require('./src/expression');
exports.Binding = require('./src/binding');
exports.Binder = require('./src/binder');
exports.Formatter = require('./src/formatter');
require('./src/binders');
require('./src/formatters');
require('./src/initBinding');

},{"./src/binder":1,"./src/binders":2,"./src/binding":3,"./src/diff":4,"./src/expression":5,"./src/formatter":6,"./src/formatters":7,"./src/initBinding":8,"./src/observer":9,"./src/template":10}]},{},[12])(12)
});