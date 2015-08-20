(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.fragments = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = AnimatedBinding;
var animation = require('./util/animation');
var Binding = require('./binding');
var _super = Binding.prototype;

/**
 * Bindings which extend AnimatedBinding have the ability to animate elements that are added to the DOM and removed from
 * the DOM. This allows menus to slide open and closed, elements to fade in or drop down, and repeated items to appear
 * to move (if you get creative enough).
 *
 * The following 5 methods are helper DOM methods that allow registered bindings to work with CSS transitions for
 * animating elements. If an element has the `animate` attribute or a matching JavaScript method, these helper methods
 * will set a class on the node to trigger the animation and/or call the JavaScript methods to handle it.
 *
 * An animation may be either a CSS transition, a CSS animation, or a set of JavaScript methods that will be called.
 *
 * If using CSS, classes are added and removed from the element. When an element is inserted it will receive the `will-
 * animate-in` class before being added to the DOM, then it will receive the `animate-in` class immediately after being
 * added to the DOM, then both clases will be removed after the animation is complete. When an element is being removed
 * from the DOM it will receive the `will-animate-out` and `animate-out` classes, then the classes will be removed once
 * the animation is complete.
 *
 * If using JavaScript, methods must be defined  to animate the element there are 3 supported methods which can b
 *
 * TODO cache by class-name (Angular)? Only support javascript-style (Ember)? Add a `will-animate-in` and
 * `did-animate-in` etc.?
 * IF has any classes, add the `will-animate-in|out` and get computed duration. If none, return. Cache.
 * RULE is use unique class to define an animation. Or attribute `animate="fade"` will add the class?
 * `.fade.will-animate-in`, `.fade.animate-in`, `.fade.will-animate-out`, `.fade.animate-out`
 *
 * Events will be triggered on the elements named the same as the class names (e.g. `animate-in`) which may be listened
 * to in order to cancel an animation or respond to it.
 *
 * If the node has methods `animateIn(done)`, `animateOut(done)`, `animateMoveIn(done)`, or `animateMoveOut(done)`
 * defined on them then the helpers will allow an animation in JavaScript to be run and wait for the `done` function to
 * be called to know when the animation is complete.
 *
 * Be sure to actually have an animation defined for elements with the `animate` class/attribute because the helpers use
 * the `transitionend` and `animationend` events to know when the animation is finished, and if there is no animation
 * these events will never be triggered and the operation will never complete.
 */
function AnimatedBinding(properties) {
  var element = properties.node;
  var animate = element.getAttribute(properties.fragments.animateAttribute);
  var fragments = properties.fragments;

  if (animate !== null) {
    if (element.nodeName === 'TEMPLATE' || element.nodeName === 'SCRIPT') {
      throw new Error('Cannot animate multiple nodes in a template or script. Remove the [animate] attribute.');
    }

    setTimeout(function() {
      // Allow multiple bindings to animate by not removing until they have all been created
      element.removeAttribute(properties.fragments.animateAttribute);
    });

    this.animate = true;

    if (fragments.isBound('attribute', animate)) {
      // javascript animation
      this.animateExpression = fragments.codifyExpression('attribute', animate);
    } else {
      if (animate[0] === '.') {
        // class animation
        this.animateClassName = animate.slice(1);
      } else if (animate) {
        // registered animation
        var animateObject = fragments.getAnimation(animate);
        if (typeof animateObject === 'function') animateObject = new animateObject(this);
        this.animateObject = animateObject;
      }
    }
  }

  Binding.call(this, properties);
}


Binding.extend(AnimatedBinding, {
  init: function() {
    _super.init.call(this);

    if (this.animateExpression) {
      this.animateObserver = new this.Observer(this.animateExpression, function(value) {
        this.animateObject = value;
      }, this);
    }
  },

  bind: function(context) {
    if (this.context == context) {
      return;
    }
    _super.bind.call(this, context);

    if (this.animateObserver) {
      this.animateObserver.bind(context);
    }
  },

  unbind: function() {
    if (this.context === null) {
      return;
    }
    _super.unbind.call(this);

    if (this.animateObserver) {
      this.animateObserver.unbind();
    }
  },

  /**
   * Helper method to remove a node from the DOM, allowing for animations to occur. `callback` will be called when
   * finished.
   */
  animateOut: function(node, callback) {
    if (node.firstViewNode) node = node.firstViewNode;

    this.animateNode('out', node, function() {
      if (callback) callback.call(this);
    });
  },

  /**
   * Helper method to insert a node in the DOM before another node, allowing for animations to occur. `callback` will
   * be called when finished. If `before` is not provided then the animation will be run without inserting the node.
   */
  animateIn: function(node, callback) {
    if (node.firstViewNode) node = node.firstViewNode;
    this.animateNode('in', node, callback, this);
  },

  /**
   * Allow an element to use CSS3 transitions or animations to animate in or out of the page.
   */
  animateNode: function(direction, node, callback) {
    var animateObject, className, name, willName, didName, _this = this;

    if (this.animateObject && typeof this.animateObject === 'object') {
      animateObject = this.animateObject;
    } else if (this.animateClassName) {
      className = this.animateClassName;
    } else if (typeof this.animateObject === 'string') {
      className = this.animateObject;
    }

    if (animateObject) {
      var dir = direction === 'in' ? 'In' : 'Out';
      name = 'animate' + dir;
      willName = 'willAnimate' + dir;
      didName = 'didAnimate' + dir;

      animation.makeElementAnimatable(node);

      if (animateObject[willName]) {
        animateObject[willName](node);
        // trigger reflow
        node.offsetWidth = node.offsetWidth;
      }

      if (animateObject[name]) {
        animateObject[name](node, function() {
          if (animateObject[didName]) animateObject[didName](node);
          if (callback) callback.call(_this);
        });
      }
    } else {
      name = 'animate-' + direction;
      willName = 'will-animate-' + direction;
      if (className) node.classList.add(className);

      if (direction === 'in') {
        var next = node.nextSibling, parent = node.parentNode;
        parent.removeChild(node);
        node.classList.add(willName);
        parent.insertBefore(node, next);
      } else {
        // trigger reflow
        node.offsetWidth = node.offsetWidth;
      }

      node.classList.remove(willName);
      node.classList.add(name);

      var duration = getDuration.call(this, node, direction);
      function whenDone() {
        node.classList.remove(name);
        if (className) node.classList.remove(className);
        if (callback) callback.call(_this);
      }

      if (duration) {
        setTimeout(whenDone, duration);
      } else {
        whenDone();
      }
    }
  }
});


var transitionDurationName = 'transitionDuration';
var transitionDelayName = 'transitionDelay';
var animationDurationName = 'animationDuration';
var animationDelayName = 'animationDelay';
var style = document.documentElement.style;
if (style.transitionDuration === undefined && style.webkitTransitionDuration !== undefined) {
  transitionDurationName = 'webkitTransitionDuration';
  transitionDelayName = 'webkitTransitionDelay';
}
if (style.animationDuration === undefined && style.webkitAnimationDuration !== undefined) {
  animationDurationName = 'webkitAnimationDuration';
  animationDelayName = 'webkitAnimationDelay';
}


function getDuration(node, direction) {
  var milliseconds = this.clonedFrom['__animationDuration' + direction];
  if (!milliseconds) {
    // Recalc if node was out of DOM before and had 0 duration, assume there is always SOME duration.
    var styles = window.getComputedStyle(node);
    var seconds = Math.max(parseFloat(styles[transitionDurationName] || 0) +
                           parseFloat(styles[transitionDelayName] || 0),
                           parseFloat(styles[animationDurationName] || 0) +
                           parseFloat(styles[animationDelayName] || 0));
    milliseconds = seconds * 1000 || 0;
    this.clonedFrom.__animationDuration__ = milliseconds;
  }
  return milliseconds;
}

},{"./binding":2,"./util/animation":13}],2:[function(require,module,exports){
module.exports = Binding;
var extend = require('./util/extend');

/**
 * A binding is a link between an element and some data. Subclasses of Binding called binders define what a binding does
 * with that link. Instances of these binders are created as bindings on templates. When a view is stamped out from the
 * template the binding is "cloned" (it is actually extended for performance) and the `element`/`node` property is
 * updated to the matching element in the view.
 *
 * ### Properties
 *  * element: The element (or text node) this binding is bound to
 *  * node: Alias of element, since bindings may apply to text nodes this is more accurate
 *  * name: The attribute or element name (does not apply to matched text nodes)
 *  * match: The matched part of the name for wildcard attributes (e.g. `on-*` matching against `on-click` would have a
 *    match property equalling `click`). Use `this.camelCase` to get the match proerty camelCased.
 *  * expression: The expression this binding will use for its updates (does not apply to matched elements)
 *  * context: The context the exression operates within when bound
 */
function Binding(properties) {
  if (!properties.node || !properties.view) {
    throw new TypeError('A binding must receive a node and a view');
  }

  // element and node are aliases
  this._elementPath = initNodePath(properties.node, properties.view);
  this.node = properties.node;
  this.element = properties.node;
  this.name = properties.name;
  this.match = properties.match;
  this.expression = properties.expression;
  this.fragments = properties.fragments;
  this.context = null;
}

extend(Binding, {
  /**
   * Default priority binders may override.
   */
  priority: 0,


  /**
   * Initialize a cloned binding. This happens after a compiled binding on a template is cloned for a view.
   */
  init: function() {
    if (this.expression) {
      // An observer to observe value changes to the expression within a context
      this.observer = new this.Observer(this.expression, this.updated, this);
    }
    this.created();
  },

  /**
   * Clone this binding for a view. The element/node will be updated and the binding will be inited.
   */
  cloneForView: function(view) {
    if (!view) {
      throw new TypeError('A binding must clone against a view');
    }

    var node = view;
    this._elementPath.forEach(function(index) {
      node = node.childNodes[index];
    });

    var binding = Object.create(this);
    binding.clonedFrom = this;
    binding.element = node;
    binding.node = node;
    binding.init();
    return binding;
  },


  // Bind this to the given context object
  bind: function(context) {
    if (this.context == context) {
      return;
    }

    this.context = context;
    if (this.observer) {
      if (this.updated !== Binding.prototype.updated) {
        this.observer.forceUpdateNextSync = true;
        this.observer.bind(context);
      } else {
        // set the context but don't actually bind it since `updated` is a no-op
        this.observer.context = context;
      }
    }
    this.bound();
  },


  // Unbind this from its context
  unbind: function() {
    if (this.context === null) {
      return;
    }

    this.context = null;
    if (this.observer) this.observer.unbind();
    this.unbound();
  },


  // Cleans up binding completely
  dispose: function() {
    this.unbind();
    if (this.observer) {
      // This will clear it out, nullifying any data stored
      this.observer.sync();
    }
    this.disposed();
  },


  // The function to run when the binding's element is compiled within a template
  compiled: function() {},

  // The function to run when the binding's element is created
  created: function() {},

  // The function to run when the expression's value changes
  updated: function() {},

  // The function to run when the binding is bound
  bound: function() {},

  // The function to run when the binding is unbound
  unbound: function() {},

  // The function to run when the binding is disposed
  disposed: function() {},

  // Helper methods

  get camelCase() {
    return (this.match || this.name || '').replace(/-+(\w)/g, function(_, char) {
      return char.toUpperCase();
    });
  },

  observe: function(expression, callback, callbackContext) {
    return new this.Observer(expression, callback, callbackContext || this);
  }
});




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

},{"./util/extend":14}],3:[function(require,module,exports){
var slice = Array.prototype.slice;
module.exports = compile;


// Walks the template DOM replacing any bindings and caching bindings onto the template object.
function compile(fragments, template) {
  var walker = document.createTreeWalker(template, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  var bindings = [], currentNode, parentNode, previousNode;

  // Reset first node to ensure it isn't a fragment
  walker.nextNode();
  walker.previousNode();

  // find bindings for each node
  do {
    currentNode = walker.currentNode;
    parentNode = currentNode.parentNode;
    bindings.push.apply(bindings, getBindingsForNode(fragments, currentNode, template));

    if (currentNode.parentNode !== parentNode) {
      // currentNode was removed and made a template
      walker.currentNode = previousNode || walker.root;
    } else {
      previousNode = currentNode;
    }
  } while (walker.nextNode());

  return bindings;
}



// Find all the bindings on a given node (text nodes will only ever have one binding).
function getBindingsForNode(fragments, node, view) {
  var bindings = [];
  var Binder, binding, expr, bound, match, attr, i;

  if (node.nodeType === Node.TEXT_NODE) {
    splitTextNode(fragments, node);

    // Find any binding for the text node
    if (fragments.isBound('text', node.nodeValue)) {
      expr = fragments.codifyExpression('text', node.nodeValue);
      node.nodeValue = '';
      Binder = fragments.findBinder('text', expr);
      binding = new Binder({ node: node, view: view, expression: expr, fragments: fragments });
      if (binding.compiled() !== false) {
        bindings.push(binding);
      }
    }
  } else {
    // If the element is removed from the DOM, stop. Check by looking at its parentNode
    var parent = node.parentNode;
    var DefaultBinder = fragments.getAttributeBinder('__default__');

    // Find any binding for the element
    Binder = fragments.findBinder('element', node.tagName.toLowerCase());
    if (Binder) {
      binding = new Binder({ node: node, view: view, fragments: fragments });
      if (binding.compiled() !== false) {
        bindings.push(binding);
      }
    }

    // If removed, made a template, don't continue processing
    if (node.parentNode !== parent) {
      return;
    }

    // Find and add any attribute bindings on an element. These can be attributes whose name matches a binding, or
    // they can be attributes which have a binding in the value such as `href="/post/{{ post.id }}"`.
    var bound = [];
    var attributes = slice.call(node.attributes);
    for (i = 0, l = attributes.length; i < l; i++) {
      var attr = attributes[i];
      var Binder = fragments.findBinder('attribute', attr.name, attr.value);
      if (Binder) {
        bound.push([ Binder, attr ]);
      }
    }

    // Make sure to create and process them in the correct priority order so if a binding create a template from the
    // node it doesn't process the others.
    bound.sort(sortAttributes);

    for (i = 0; i < bound.length; i++) {
      var Binder = bound[i][0];
      var attr = bound[i][1];
      var name = attr.name;
      var value = attr.value;
      if (Binder.expr) {
        match = name.match(Binder.expr);
        if (match) match = match[1];
      } else {
        match = null;
      }

      try {
        node.removeAttributeNode(attr);
      } catch(e) {}

      binding = new Binder({
        node: node,
        view: view,
        name: name,
        match: match,
        expression: value ? fragments.codifyExpression('attribute', value) : null,
        fragments: fragments
      });

      if (binding.compiled() !== false) {
        bindings.push(binding);
      } else if (Binder !== DefaultBinder && fragments.isBound('attribute', value)) {
        // Revert to default if this binding doesn't take
        bound.push([ DefaultBinder, attr ]);
      }

      if (node.parentNode !== parent) {
        break;
      }
    }
  }

  return bindings;
}


// Splits text nodes with expressions in them so they can be bound individually, has parentNode passed in since it may
// be a document fragment which appears as null on node.parentNode.
function splitTextNode(fragments, node) {
  if (!node.processed) {
    node.processed = true;
    var regex = fragments.binders.text._expr;
    var content = node.nodeValue;
    if (content.match(regex)) {
      var match, lastIndex = 0, parts = [], fragment = document.createDocumentFragment();
      while (match = regex.exec(content)) {
        parts.push(content.slice(lastIndex, regex.lastIndex - match[0].length));
        parts.push(match[0]);
        lastIndex = regex.lastIndex;
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


function sortAttributes(a, b) {
  return b[0].prototype.priority - a[0].prototype.priority;
}

function notEmpty(value) {
  return Boolean(value);
}

},{}],4:[function(require,module,exports){
module.exports = Fragments;
var extend = require('./util/extend');
var toFragment = require('./util/toFragment');
var animation = require('./util/animation');
var Template = require('./template');
var View = require('./view');
var Binding = require('./binding');
var AnimatedBinding = require('./animatedBinding');
var compile = require('./compile');
var registerDefaultBinders = require('./registered/binders');
var registerDefaultFormatters = require('./registered/formatters');
var registerDefaultAnimations = require('./registered/animations');

/**
 * A Fragments object serves as a registry for binders and formatters
 * @param {[type]} ObserverClass [description]
 */
function Fragments(ObserverClass) {
  if (!ObserverClass) {
    throw new TypeError('Must provide an Observer class to Fragments.');
  }

  this.Observer = ObserverClass;
  this.formatters = ObserverClass.formatters = {};
  this.animations = {};
  this.animateAttribute = 'animate';

  this.binders = {
    element: { _wildcards: [] },
    attribute: { _wildcards: [], _expr: /{{\s*(.*?)\s*}}/g },
    text: { _wildcards: [], _expr: /{{\s*(.*?)\s*}}/g }
  };

  // Text binder for text nodes with expressions in them
  this.registerText('__default__', function(value) {
    this.element.textContent = (value != null) ? value : '';
  });

  // Catchall attribute binder for regular attributes with expressions in them
  this.registerAttribute('__default__', function(value) {
    if (value != null) {
      this.element.setAttribute(this.name, value);
    } else {
      this.element.removeAttribute(this.name);
    }
  });

  registerDefaultBinders(this);
  registerDefaultFormatters(this);
  registerDefaultAnimations(this);
}

Fragments.prototype = {

  /**
   * Takes an HTML string, an element, an array of elements, or a document fragment, and compiles it into a template.
   * Instances may then be created and bound to a given context.
   * @param {String|NodeList|HTMLCollection|HTMLTemplateElement|HTMLScriptElement|Node} html A Template can be created
   * from many different types of objects. Any of these will be converted into a document fragment for the template to
   * clone. Nodes and elements passed in will be removed from the DOM.
   */
  createTemplate: function(html) {
    var fragment = toFragment(html);
    if (fragment.childNodes.length === 0) {
      throw new Error('Cannot create a template from ' + html);
    }
    var template = extend.make(Template, fragment);
    template.bindings = compile(this, template);
    return template;
  },


  /**
   * Compiles bindings on an element.
   */
  compileElement: function(element) {
    if (!element.bindings) {
      element.bindings = compile(this, element);
      extend.make(View, element, element);
    }

    return element;
  },


  /**
   * Compiles and binds an element which was not created from a template. Mostly only used for binding the document's
   * html element.
   */
  bindElement: function(element, context) {
    this.compileElement(element);

    if (context) {
      element.bind(context);
    }

    return element;
  },


  /**
   * Registers a binder for a given type and name. A binder is a subclass of Binding and is used to create bindings on
   * an element or text node whose tag name, attribute name, or expression contents match this binder's name/expression.
   *
   * ### Parameters
   *
   *  * `type`: there are three types of binders: element, attribute, or text. These correspond to matching against an
   *    element's tag name, an element with the given attribute name, or a text node that matches the provided
   *    expression.
   *
   *  * `name`: to match, a binder needs the name of an element or attribute, or a regular expression that matches a
   *    given text node. Names for elements and attributes can be regular expressions as well, or they may be wildcard
   *    names by using an asterisk.
   *
   *  * `definition`: a binder is a subclass of Binding which overrides key methods, `compiled`, `created`, `updated`,
   *    `bound`, and `unbound`. The definition may be an actual subclass of Binding or it may be an object which will be
   *    used for the prototype of the newly created subclass. For many bindings only the `updated` method is overridden,
   *    so by just passing in a function for `definition` the binder will be created with that as its `updated` method.
   *
   * ### Explaination of properties and methods
   *
   *   * `priority` may be defined as number to instruct some binders to be processed before others. Binders with
   *   higher priority are processed first.
   *
   *   * `animated` can be set to `true` to extend the AnimatedBinding class which provides support for animation when
   *   insertingand removing nodes from the DOM. The `animated` property only *allows* animation but the element must
   *   have the `animate` attribute to use animation. A binding will have the `animate` property set to true when it is
   *   to be animated. Binders should have fast paths for when animation is not used rather than assuming animation will
   *   be used.
   *
   * Binders
   *
   * A binder can have 5 methods which will be called at various points in a binding's lifecycle. Many binders will
   * only use the `updated(value)` method, so calling register with a function instead of an object as its third
   * parameter is a shortcut to creating a binder with just an `update` method.
   *
   * Listed in order of when they occur in a binding's lifecycle:
   *
   *   * `compiled(options)` is called when first creating a binding during the template compilation process and receives
   * the `options` object that will be passed into `new Binding(options)`. This can be used for creating templates,
   * modifying the DOM (only subsequent DOM that hasn't already been processed) and other things that should be
   * applied at compile time and not duplicated for each view created.
   *
   *   * `created()` is called on the binding when a new view is created. This can be used to add event listeners on the
   * element or do other things that will persiste with the view through its many uses. Views may get reused so don't
   * do anything here to tie it to a given context.
   *
   *   * `attached()` is called on the binding when the view is bound to a given context and inserted into the DOM. This
   * can be used to handle context-specific actions, add listeners to the window or document (to be removed in
   * `detached`!), etc.
   *
   *   * `updated(value, oldValue, changeRecords)` is called on the binding whenever the value of the expression within
   * the attribute changes. For example, `bind-text="{{username}}"` will trigger `updated` with the value of username
   * whenever it changes on the given context. When the view is removed `updated` will be triggered with a value of
   * `undefined` if the value was not already `undefined`, giving a chance to "reset" to an empty state.
   *
   *   * `detached()` is called on the binding when the view is unbound to a given context and removed from the DOM. This
   * can be used to clean up anything done in `attached()` or in `updated()` before being removed.
   *
   * Element and attribute binders will apply whenever the tag name or attribute name is matched. In the case of
   * attribute binders if you only want it to match when expressions are used within the attribute, add `onlyWhenBound`
   * to the definition. Otherwise the binder will match and the value of the expression will simply be a string that
   * only calls updated once since it will not change.
   *
   * Note, attributes which match a binder are removed during compile. They are considered to be binding definitions and
   * not part of the element. Bindings may set the attribute which served as their definition if desired.
   *
   * ### Defaults
   *
   * There are default binders for attribute and text nodes which apply when no other binders match. They only apply to
   * attributes and text nodes with expressions in them (e.g. `{{foo}}`). The default is to set the attribute or text
   * node's value to the result of the expression. If you wanted to override this default you may register a binder with
   * the name `"__default__"`.
   *
   * **Example:** This binding handler adds pirateized text to an element.
   * ```javascript
   * registry.registerAttribute('my-pirate', function(value) {
   *   if (typeof value !== 'string') {
   *     value = '';
   *   } else {
   *     value = value
   *       .replace(/\Bing\b/g, "in'")
   *       .replace(/\bto\b/g, "t'")
   *       .replace(/\byou\b/, 'ye')
   *       + ' Arrrr!';
   *   }
   *   this.element.textContent = value;
   * });
   * ```
   *
   * ```html
   * <p my-pirate="{{post.body}}">This text will be replaced.</p>
   * ```
   */
  registerElement: function(name, definition) {
    return this.registerBinder('element', name, definition);
  },
  registerAttribute: function(name, definition) {
    return this.registerBinder('attribute', name, definition);
  },
  registerText: function(name, definition) {
    return this.registerBinder('text', name, definition);
  },
  registerBinder: function(type, name, definition) {
    var binder, binders = this.binders[type]
    var superClass = definition.animated ? AnimatedBinding : Binding;

    if (!binders) {
      throw new TypeError('`type` must be one of ' + Object.keys(this.binders).join(', '));
    }

    if (typeof definition === 'function') {
      if (definition.prototype instanceof Binding) {
        superClass = definition;
        definition = {};
      } else {
        definition = { updated: definition };
      }
    }

    // Create a subclass of Binding (or another binder) with the definition
    function Binder() {
      superClass.apply(this, arguments);
    }
    definition.Observer = this.Observer;
    superClass.extend(Binder, definition);

    var expr;
    if (name instanceof RegExp) {
      expr = name;
    } else if (name.indexOf('*') >= 0) {
      expr = new RegExp('^' + escapeRegExp(name).replace('\\*', '(.*)') + '$');
    }

    if (expr) {
      Binder.expr = expr;
      binders._wildcards.push(Binder);
      binders._wildcards.sort(this.bindingSort);
    }

    Binder.name = '' + name;
    binders[name] = Binder;
    return Binder;
  },


  /**
   * Removes a binder that was added with `register()`. If an RegExp was used in register for the name it must be used
   * to unregister, but it does not need to be the same instance.
   */
  unregisterElement: function(name) {
    return this.unregisterBinder('element', name);
  },
  unregisterAttribute: function(name) {
    return this.unregisterBinder('attribute', name);
  },
  unregisterText: function(name) {
    return this.unregisterBinder('text', name);
  },
  unregisterBinder: function(type, name) {
    var binder = this.getBinder(type, name), binders = this.binders[type];
    if (!binder) return;
    if (binder.expr) {
      var index = binders._wildcards.indexOf(binder);
      if (index >= 0) binders._wildcards.splice(index, 1);
    }
    delete binders[name];
    return binder;
  },


  /**
   * Returns a binder that was added with `register()` by type and name.
   */
  getElementBinder: function(name) {
    return this.getBinder('element', name);
  },
  getAttributeBinder: function(name) {
    return this.getBinder('attribute', name);
  },
  getTextBinder: function(name) {
    return this.getBinder('text', name);
  },
  getBinder: function(type, name) {
    var binders = this.binders[type];

    if (!binders) {
      throw new TypeError('`type` must be one of ' + Object.keys(this.binders).join(', '));
    }

    if (name && binders.hasOwnProperty(name)) {
      return binders[name];
    }
  },


  /**
   * Find a matching binder for the given type. Elements should only provide name. Attributes should provide the name
   * and value (value so the default can be returned if an expression exists in the value). Text nodes should only
   * provide the value (in place of the name) and will return the default if no binders match.
   */
  findBinder: function(type, name, value) {
    if (type === 'text' && value == null) {
      value = name;
      name = undefined;
    }
    var binder = this.getBinder(type, name), binders = this.binders[type];

    if (!binder) {
      var toMatch = (type === 'text') ? value : name;
      binders._wildcards.some(function(wildcardBinder) {
        if (toMatch.match(wildcardBinder.expr)) {
          binder = wildcardBinder;
          return true;
        }
      });
    }

    if (binder && type === 'attribute' && binder.onlyWhenBound && !this.isBound(type, value)) {
      // don't use the `value` binder if there is no expression in the attribute value (e.g. `value="some text"`)
      return;
    }

    if (name === this.animateAttribute) {
      return;
    }

    if (!binder && value && (type === 'text' || this.isBound(type, value))) {
      // Test if the attribute value is bound (e.g. `href="/posts/{{ post.id }}"`)
      binder = this.getBinder(type, '__default__');
    }

    return binder;
  },


  /**
   * A Formatter is stored to process the value of an expression. This alters the value of what comes in with a function
   * that returns a new value. Formatters are added by using a single pipe character (`|`) followed by the name of the
   * formatter. Multiple formatters can be used by chaining pipes with formatter names. Formatters may also have
   * arguments passed to them by using the colon to separate arguments from the formatter name. The signature of a
   * formatter should be `function(value, args...)` where args are extra parameters passed into the formatter after
   * colons.
   *
   * *Example:*
   * ```js
   * registry.registerFormatter('uppercase', function(value) {
   *   if (typeof value != 'string') return ''
   *   return value.toUppercase()
   * })
   *
   * registry.registerFormatter('replace', function(value, replace, with) {
   *   if (typeof value != 'string') return ''
   *   return value.replace(replace, with)
   * })
   * ```html
   * <h1 bind-text="title | uppercase | replace:'LETTER':'NUMBER'"></h1>
   * ```
   * *Result:*
   * ```html
   * <h1>GETTING TO KNOW ALL ABOUT THE NUMBER A</h1>
   * ```
   * TODO: old docs, rewrite, there is an extra argument named `setter` which will be true when the expression is being "set" instead of "get"
   * A `valueFormatter` is like a formatter but used specifically with the `value` binding since it is a two-way binding. When
   * the value of the element is changed a `valueFormatter` can adjust the value from a string to the correct value type for
   * the controller expression. The signature for a `valueFormatter` includes the current value of the expression
   * before the optional arguments (if any). This allows dates to be adjusted and possibley other uses.
   *
   * *Example:*
   * ```js
   * registry.registerFormatter('numeric', function(value) {
   *   // value coming from the controller expression, to be set on the element
   *   if (value == null || isNaN(value)) return ''
   *   return value
   * })
   *
   * registry.registerFormatter('date-hour', function(value) {
   *   // value coming from the controller expression, to be set on the element
   *   if ( !(currentValue instanceof Date) ) return ''
   *   var hours = value.getHours()
   *   if (hours >= 12) hours -= 12
   *   if (hours == 0) hours = 12
   *   return hours
   * })
   * ```html
   * <label>Number Attending:</label>
   * <input size="4" bind-value="event.attendeeCount | numeric">
   * <label>Time:</label>
   * <input size="2" bind-value="event.date | date-hour"> :
   * <input size="2" bind-value="event.date | date-minute">
   * <select bind-value="event.date | date-ampm">
   *   <option>AM</option>
   *   <option>PM</option>
   * </select>
   * ```
   */
  registerFormatter: function (name, formatter) {
    this.formatters[name] = formatter;
  },


  /**
   * Unregisters a formatter.
   */
  unregisterFormatter: function (name, formatter) {
    delete this.formatters[name];
  },


  /**
   * Gets a registered formatter.
   */
  getFormatter: function (name) {
    return this.formatters[name];
  },


  /**
   * An Animation is stored to handle animations. A registered animation is an object (or class which instantiates into
   * an object) with the methods:
   *   * `willAnimateIn(element)`
   *   * `animateIn(element, callback)`
   *   * `didAnimateIn(element)`
   *   * `willAnimateOut(element)`
   *   * `animateOut(element, callback)`
   *   * `didAnimateOut(element)`
   *
   * Animation is included with binders which are registered with the `animated` property set to `true` (such as `if`
   * and `repeat`). Animations allow elements to fade in, fade out, slide down, collapse, move from one location in a
   * list to another, and more.
   *
   * To use animation add an attribute named `animate` onto an element with a supported binder.
   *
   * ### CSS Animations
   *
   * If the `animate` attribute does not have a value or the value is a class name (e.g. `animate=".my-fade"`) then
   * fragments will use a CSS transition/animation. Classes will be added and removed to trigger the animation.
   *
   *   * `.will-animate-in` is added right after an element is inserted into the DOM. This can be used to set the
   *     opacity to `0.0` for example. It is then removed on the next animation frame.
   *   * `.animate-in` is when `.will-animate-in` is removed. It can be used to set opacity to `1.0` for example. The
   *     `animation` style can be set on this class if using it. The `transition` style can be set here. Note that
   *     although the `animate` attribute is placed on an element with the `repeat` binder, these classes are added to
   *     its children as they get added and removed.
   *   * `.will-animate-out` is added before an element is removed from the DOM. This can be used to set the opacity to
   *     `1` for example. It is then removed on the next animation frame.
   *   * `.animate-out` is added when `.will-animate-out` is removed. It can be used to set opacity to `0.0` for
   *     example. The `animation` style can be set on this class if using it. The `transition` style can be set here or
   *     on another selector that matches the element. Note that although the `animate` attribute is placed on an
   *     element with the `repeat` binder, these classes are added to its children as they get added and removed.
   *
   * If the `animate` attribute is set to a class name (e.g. `animate=".my-fade"`) then that class name will be added as
   * a class to the element during animation. This allows you to use `.my-fade.will-animate-in`, `.my-fade.animate-in`,
   * etc. in your stylesheets to use the same animation throughout your application.
   *
   * ### JavaScript Animations
   *
   * If you need greater control over your animations JavaScript may be used. It is recommended that CSS styles still be
   * used by having your code set them manually. This allows the animation to take advantage of the browser
   * optimizations such as hardware acceleration. This is not a requirement.
   *
   * In order to use JavaScript an object should be passed into the `animation` attribute using an expression. This
   * object should have methods that allow JavaScript animation handling. For example, if you are bound to a context
   * with an object named `customFade` with animation methods, your element should have `attribute="{{customFade}}"`.
   * The following is a list of the methods you may implement.
   *
   *   * `willAnimateIn(element)` will be called after an element has been inserted into the DOM. Use it to set initial
   *     CSS properties before `animateIn` is called to set the final properties. This method is optional.
   *   * `animateIn(element, callback)` will be called shortly after `willAnimateIn` if it was defined. Use it to set
   *     final CSS properties.
   *   * `animateOut(element, done)` will be called before an element is to be removed from the DOM. `done` must be
   *     called when the animation is complete in order for the binder to finish removing the element. **Remember** to
   *     clean up by removing any styles that were added before calling `done()` so the element can be reused without
   *     side-effects.
   *
   * The `element` passed in will be polyfilled for with the `animate` method using
   * https://github.com/web-animations/web-animations-js.
   *
   * ### Registered Animations
   *
   * Animations may be registered and used throughout your application. To use a registered animation use its name in
   * the `animate` attribute (e.g. `animate="fade"`). Note the only difference between a registered animation and a
   * class registration is class registrations are prefixed with a dot (`.`). Registered animations are always
   * JavaScript animations. To register an animation use `fragments.registerAnimation(name, animationObject)`.
   *
   * The Animation module comes with several common animations registered by default. The defaults use CSS styles to
   * work correctly, using `element.animate`.
   *
   *   * `fade` will fade an element in and out over 300 milliseconds.
   *   * `slide` will slide an element down when it is added and slide it up when it is removed.
   *   * `slide-move` will move an element from its old location to its new location in a repeated list.
   *
   * Do you have another common animation you think should be included by default? Submit a pull request!
   */
  registerAnimation: function(name, animationObject) {
    this.animations[name] = animationObject;
  },


  /**
   * Unregisters an animation.
   */
  unregisterAnimation: function(name) {
    delete this.animations[name];
  },


  /**
   * Gets a registered animation.
   */
  getAnimation: function(name) {
    return this.animations[name];
  },


  /**
   * Prepare an element to be easier animatable (adding a simple `animate` polyfill if needed)
   */
  makeElementAnimatable: animation.makeElementAnimatable,


  /**
   * Sets the delimiters that define an expression. Default is `{{` and `}}` but this may be overridden. If empty
   * strings are passed in (for type "attribute" only) then no delimiters are required for matching attributes, but the
   * default attribute matcher will not apply to the rest of the attributes.
   */
  setExpressionDelimiters: function(type, pre, post) {
    if (type !== 'attribute' && type !== 'text') {
      throw new TypeError('Expression delimiters must be of type "attribute" or "text"');
    }

    this.binders[type]._expr = new RegExp(escapeRegExp(pre) + '(.*?)' + escapeRegExp(post), 'g');
  },


  /**
   * Tests whether a value has an expression in it. Something like `/user/{{user.id}}`.
   */
  isBound: function(type, value) {
    if (type !== 'attribute' && type !== 'text') {
      throw new TypeError('isBound must provide type "attribute" or "text"');
    }
    var expr = this.binders[type]._expr;
    return Boolean(expr && value && value.match(expr));
  },


  /**
   * The sort function to sort binders correctly
   */
  bindingSort: function(a, b) {
    return b.prototype.priority - a.prototype.priority;
  },


  /**
   * Converts an inverted expression from `/user/{{user.id}}` to `"/user/" + user.id`
   */
  codifyExpression: function(type, text) {
    if (type !== 'attribute' && type !== 'text') {
      throw new TypeError('codifyExpression must use type "attribute" or "text"');
    }

    var expr = this.binders[type]._expr;
    var match = text.match(expr);

    if (!match) {
      return '"' + text.replace(/"/g, '\\"') + '"';
    } else if (match.length === 1 && match[0] === text) {
      return text.replace(expr, '$1');
    } else {
      var newText = '"', lastIndex = 0;
      while (match = expr.exec(text)) {
        var str = text.slice(lastIndex, expr.lastIndex - match[0].length);
        newText += str.replace(/"/g, '\\"');
        newText += '" + (' + match[1] + ' || "") + "';
        lastIndex = expr.lastIndex;
      }
      newText += text.slice(lastIndex).replace(/"/g, '\\"') + '"';
      return newText.replace(/^"" \+ | "" \+ | \+ ""$/g, '');
    }
  }

};

// Takes a string like "(\*)" or "on-\*" and converts it into a regular expression.
function escapeRegExp(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

},{"./animatedBinding":1,"./binding":2,"./compile":3,"./registered/animations":9,"./registered/binders":10,"./registered/formatters":11,"./template":12,"./util/animation":13,"./util/extend":14,"./util/toFragment":15,"./view":16}],5:[function(require,module,exports){
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

},{}],6:[function(require,module,exports){
// # Chip Expression

// Parses a string of JavaScript into a function which can be bound to a scope.
//
// Allows undefined or null values to return undefined rather than throwing
// errors, allows for formatters on data, and provides detailed error reporting.

// The expression object with its expression cache.
var expression = exports;
expression.cache = {};
expression.globals = ['true', 'false', 'null', 'undefined', 'window', 'this'];
expression.get = getExpression;
expression.getSetter = getSetter;
expression.bind = bindExpression;


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
    var args = match[2] ? match[2].split(argSeparator) : [];
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

},{}],7:[function(require,module,exports){
module.exports = exports = require('./observer');
exports.expression = require('./expression');
exports.expression.diff = require('./diff');

},{"./diff":5,"./expression":6,"./observer":8}],8:[function(require,module,exports){
module.exports = Observer;
var expression = require('./expression');
var diff = require('./diff');
var requestAnimationFrame = window.requestAnimationFrame || setTimeout;
var cancelAnimationFrame = window.cancelAnimationFrame || clearTimeout;

// # Observer

// Defines an observer class which represents an expression. Whenever that expression returns a new value the `callback`
// is called with the value.
//
// If the old and new values were either an array or an object, the `callback` also
// receives an array of splices (for an array), or an array of change objects (for an object) which are the same
// format that `Array.observe` and `Object.observe` return <http://wiki.ecmascript.org/doku.php?id=harmony:observe>.
function Observer(expr, callback, callbackContext) {
  if (typeof expr === 'function') {
    this.getter = expr;
    this.setter = expr;
  } else {
    this.getter = expression.get(expr);
  }
  this.expr = expr;
  this.callback = callback;
  this.callbackContext = callbackContext;
  this.skip = false;
  this.forceUpdateNextSync = false;
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
  },

  // Returns the current value of this observer
  get: function() {
    if (this.context) {
      return this.getter.call(this.context, Observer.formatters);
    }
  },

  // Sets the value of this expression
  set: function(value) {
    if (!this.context) return;
    if (this.setter === false) return;
    if (!this.setter) {
      this.setter = typeof this.expr === 'string'
        ? expression.getSetter(this.expr, { ignoreErrors: true }) || false
        : false;
      if (!this.setter) return;
    }

    try {
      var result = this.setter.call(this.context, Observer.formatters, value);
    } catch(e) {
      return;
    }

    this.sync();
    Observer.sync();
    return result;
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
      if (!changed && !this.forceUpdateNextSync) return;
      this.forceUpdateNextSync = false;
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
Observer.syncPending = null;

// Schedules an observer sync cycle which checks all the observers to see if they've changed.
Observer.sync = function(callback) {
  if (Observer.syncPending) return false;
  Observer.syncPending = requestAnimationFrame(function() {
    Observer.syncNow(callback);
  });
  return true;
};

// Runs the observer sync cycle which checks all the observers to see if they've changed.
Observer.syncNow = function(callback) {
  if (typeof callback === 'function') {
    Observer.afterSync(callback);
  }

  cancelAnimationFrame(Observer.syncPending);
  Observer.syncPending = null;

  if (Observer.syncing) {
    Observer.rerun = true;
    return false;
  }

  Observer.syncing = true;
  Observer.rerun = true;
  Observer.cycles = 0;

  // Allow callbacks to run the sync cycle again immediately, but stop at `Observer.max` (default 10) cycles to we don't
  // run infinite loops
  while (Observer.rerun) {
    if (++Observer.cycles === Observer.max) {
      throw new Error('Infinite observer syncing, an observer is calling Observer.sync() too many times');
    }
    Observer.rerun = false;
    // the observer array may increase or decrease in size (remaining observers) during the sync
    for (var i = 0; i < Observer.observers.length; i++) {
      Observer.observers[i].sync();
    }
  }

  while (Observer.callbacks.length) {
    Observer.callbacks.shift()();
  }

  for (var i = 0, l = Observer.listeners.length; i < l; i++) {
    var listener = Observer.listeners[i];
    listener();
  }

  Observer.syncing = false;
  Observer.cycles = 0;
  return true;
};

// After the next sync (or the current if in the middle of one), run the provided callback
Observer.afterSync = function(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }
  Observer.callbacks.push(callback);
};

Observer.onSync = function(listener) {
  if (typeof listener === 'function') {
    throw new TypeError('listener must be a function');
  }
  Observer.listeners.push(listener);
};

Observer.removeOnSync = function(listener) {
  if (typeof listener === 'function') {
    throw new TypeError('listener must be a function');
  }
  var index = Observer.listeners.indexOf(listener);
  if (index !== -1) {
    Observer.listeners.splice(index, 1).pop();
  }
};

},{"./diff":5,"./expression":6}],9:[function(require,module,exports){
module.exports = registerDefaults;

/**
 * # Default Binders
 * Registers default binders with a fragments object.
 */
function registerDefaults(fragments) {

  /**
   * Fade in and out
   */
  fragments.registerAnimation('fade', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },
    animateIn: function(element, done) {
      element.animate([
        { opacity: '0' },
        { opacity: '1' }
      ], this.options).onfinish = done;
    },
    animateOut: function(element, done) {
      element.animate([
        { opacity: '1' },
        { opacity: '0' }
      ], this.options).onfinish = done;
    }
  });

  var slides = {
    slide: 'height',
    slidev: 'height',
    slideh: 'width'
  };

  var animating = new Map();

  function obj(key, value) {
    var obj = {};
    obj[key] = value;
    return obj;
  }

  /**
   * Slide down and up, left and right
   */
  Object.keys(slides).forEach(function(name) {
    var property = slides[name];

    fragments.registerAnimation(name, {
      options: {
        duration: 300,
        easing: 'ease-in-out'
      },
      animateIn: function(element, done) {
        var value = element.getComputedCSS(property);
        if (!value || value === '0px') {
          return done();
        }

        element.style.overflow = 'hidden';
        element.animate([
          obj(property, '0px'),
          obj(property, value)
        ], this.options).onfinish = function() {
          element.style.overflow = '';
          done();
        };
      },
      animateOut: function(element, done) {
        var value = element.getComputedCSS(property);
        if (!value || value === '0px') {
          return done();
        }

        element.style.overflow = 'hidden';
        element.animate([
          obj(property, value),
          obj(property, '0px')
        ], this.options).onfinish = function() {
          element.style.overflow = '';
          done();
        };
      }
    });


    /**
     * Move items up and down in a list, slide down and up
     */
    fragments.registerAnimation(name + '-move', {
      options: {
        duration: 300,
        easing: 'ease-in-out'
      },

      animateIn: function(element, done) {
        var value = element.getComputedCSS(property);
        if (!value || value === '0px') {
          return done();
        }

        var item = element.view && element.view._repeatItem_;
        if (item) {
          animating.set(item, element);
          setTimeout(function() {
            animating.delete(item);
          });
        }

        // Do the slide
        element.style.overflow = 'hidden';
        element.animate([
          obj(property, '0px'),
          obj(property, value)
        ], this.options).onfinish = function() {
          element.style.overflow = '';
          done();
        };
      },

      animateOut: function(element, done) {
        var value = element.getComputedCSS(property);
        if (!value || value === '0px') {
          return done();
        }

        var item = element.view && element.view._repeatItem_;
        if (item) {
          var newElement = animating.get(item);
          if (newElement && newElement.parentNode === element.parentNode) {
            // This item is being removed in one place and added into another. Make it look like its moving by making both
            // elements not visible and having a clone move above the items to the new location.
            element = this.animateMove(element, newElement);
          }
        }

        // Do the slide
        element.style.overflow = 'hidden';
        element.animate([
          obj(property, value),
          obj(property, '0px')
        ], this.options).onfinish = function() {
          element.style.overflow = '';
          done();
        };
      },

      animateMove: function(oldElement, newElement) {
        var placeholderElement;
        var parent = newElement.parentNode;
        if (!parent.__slideMoveHandled) {
          parent.__slideMoveHandled = true;
          if (window.getComputedStyle(parent).position === 'static') {
            parent.style.position = 'relative';
          }
        }

        var origStyle = oldElement.getAttribute('style');
        var style = window.getComputedStyle(oldElement);
        var marginOffsetLeft = -parseInt(style.marginLeft);
        var marginOffsetTop = -parseInt(style.marginTop);
        var oldLeft = oldElement.offsetLeft;
        var oldTop = oldElement.offsetTop;

        placeholderElement = fragments.makeElementAnimatable(oldElement.cloneNode(true));
        placeholderElement.style.width = oldElement.style.width = style.width;
        placeholderElement.style.height = oldElement.style.height = style.height;
        placeholderElement.style.opacity = '0';

        oldElement.style.position = 'absolute';
        oldElement.style.zIndex = 1000;
        parent.insertBefore(placeholderElement, oldElement);
        newElement.style.opacity = '0';

        oldElement.animate([
          { top: oldTop + marginOffsetTop + 'px', left: oldLeft + marginOffsetLeft + 'px' },
          { top: newElement.offsetTop + marginOffsetTop + 'px', left: newElement.offsetLeft + marginOffsetLeft + 'px' }
        ], this.options).onfinish = function() {
          placeholderElement.remove();
          origStyle ? oldElement.setAttribute('style', origStyle) : oldElement.removeAttribute('style');
          newElement.style.opacity = '';
        };

        return placeholderElement;
      }
    });

  });

}

},{}],10:[function(require,module,exports){
module.exports = registerDefaults;
var diff = require('../observer/diff');

/**
 * # Default Binders
 * Registers default binders with a fragments object.
 */
function registerDefaults(fragments) {

  /**
   * Prints out the value of the expression to the console.
   */
  fragments.registerAttribute('debug', {
    priority: 60,
    updated: function(value) {
      console.info('Debug:', this.expression, '=', value);
    }
  });


  /**
   * ## text
   * Adds a binder to display escaped text inside an element. This can be done with binding directly in text nodes but
   * using the attribute binder prevents a flash of unstyled content on the main page.
   *
   * **Example:**
   * ```html
   * <h1 text="{{post.title}}">Untitled</h1>
   * <div html="{{post.body | markdown}}"></div>
   * ```
   * *Result:*
   * ```html
   * <h1>Little Red</h1>
   * <div>
   *   <p>Little Red Riding Hood is a story about a little girl.</p>
   *   <p>
   *     More info can be found on
   *     <a href="http://en.wikipedia.org/wiki/Little_Red_Riding_Hood">Wikipedia</a>
   *   </p>
   * </div>
   * ```
   */
  fragments.registerAttribute('text', function(value) {
    this.element.textContent = (value == null ? '' : value);
  });


  /**
   * ## html
   * Adds a binder to display unescaped HTML inside an element. Be sure it's trusted! This should be used with filters
   * which create HTML from something safe.
   *
   * **Example:**
   * ```html
   * <h1>{{post.title}}</h1>
   * <div html="{{post.body | markdown}}"></div>
   * ```
   * *Result:*
   * ```html
   * <h1>Little Red</h1>
   * <div>
   *   <p>Little Red Riding Hood is a story about a little girl.</p>
   *   <p>
   *     More info can be found on
   *     <a href="http://en.wikipedia.org/wiki/Little_Red_Riding_Hood">Wikipedia</a>
   *   </p>
   * </div>
   * ```
   */
  fragments.registerAttribute('html', function(value) {
    this.element.innerHTML = (value == null ? '' : value);
  });



  /**
   * ## class-[className]
   * Adds a binder to add classes to an element dependent on whether the expression is true or false.
   *
   * **Example:**
   * ```html
   * <div class="user-item" class-selected-user="{{selected === user}}">
   *   <button class="btn primary" class-highlight="{{ready}}"></button>
   * </div>
   * ```
   * *Result if `selected` equals the `user` and `ready` is `true`:*
   * ```html
   * <div class="user-item selected-user">
   *   <button class="btn primary highlight"></button>
   * </div>
   * ```
   */
  fragments.registerAttribute('class-*', function(value) {
    if (value) {
      this.element.classList.add(this.match);
    } else {
      this.element.classList.remove(this.match);
    }
  });



  /**
   * ## value
   * Adds a binder which sets the value of an HTML form element. This binder also updates the data as it is changed in
   * the form element, providing two way binding.
   *
   * **Example:**
   * ```html
   * <label>First Name</label>
   * <input type="text" name="firstName" value="user.firstName">
   *
   * <label>Last Name</label>
   * <input type="text" name="lastName" value="user.lastName">
   * ```
   * *Result:*
   * ```html
   * <label>First Name</label>
   * <input type="text" name="firstName" value="Jacob">
   *
   * <label>Last Name</label>
   * <input type="text" name="lastName" value="Wright">
   * ```
   * And when the user changes the text in the first input to "Jac", `user.firstName` will be updated immediately with
   * the value of `'Jac'`.
   */
  fragments.registerAttribute('value', {
    onlyWhenBound: true,
    eventsAttrName: 'value-events',
    fieldAttrName: 'value-field',
    defaultEvents: [ 'change' ],

    compiled: function() {
      var name = this.element.tagName.toLowerCase();
      var type = this.element.type;
      this.methods = inputMethods[type] || inputMethods[name];

      if (!this.methods) {
        return false;
      }

      if (this.element.hasAttribute(this.eventsAttrName)) {
        this.events = this.element.getAttribute(this.eventsAttrName).split(' ');
        this.element.removeAttribute(this.eventsAttrName);
      } else if (name !== 'option') {
        this.events = this.defaultEvents;
      }

      if (this.element.hasAttribute(this.fieldAttrName)) {
        this.valueField = this.element.getAttribute(this.fieldAttrName);
        this.element.removeAttribute(this.fieldAttrName);
      }

      if (type === 'option') {
        this.valueField = this.element.parentNode.valueField;
      }
    },

    created: function() {
      if (!this.events) return; // nothing for <option> here
      var element = this.element;
      var observer = this.observer;
      var input = this.methods;
      var valueField = this.valueField;

      // The 2-way binding part is setting values on certain events
      function onChange() {
        if (input.get.call(element, valueField) !== observer.oldValue && !element.readOnly) {
          observer.set(input.get.call(element, valueField));
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
      if (this.methods.get.call(this.element, this.valueField) != value) {
        this.methods.set.call(this.element, value, this.valueField);
      }
    }
  });

  /**
   * Handle the different form types
   */
  var defaultInputMethod = {
    get: function() { return this.value; },
    set: function(value) { this.value = (value == null) ? '' : value; }
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
        if (value && valueField) {
          this.valueObject = value;
          this.value = value[valueField];
        } else {
          this.value = (value == null) ? '' : value;
        }
      }
    },

    option: {
      get: function(valueField) {
        return valueField ? this.valueObject[valueField] : this.value;
      },
      set: function(value, valueField) {
        if (value && valueField) {
          this.valueObject = value;
          this.value = value[valueField];
        } else {
          this.value = (value == null) ? '' : value;
        }
      }
    },

    input: defaultInputMethod,

    textarea: defaultInputMethod
  };


  /**
   * ## on-[event]
   * Adds a binder for each event name in the array. When the event is triggered the expression will be run.
   *
   * **Example Events:**
   *
   * * on-click
   * * on-dblclick
   * * on-submit
   * * on-change
   * * on-focus
   * * on-blur
   *
   * **Example:**
   * ```html
   * <form on-submit="{{saveUser()}}">
   *   <input name="firstName" value="Jacob">
   *   <button>Save</button>
   * </form>
   * ```
   * *Result (events don't affect the HTML):*
   * ```html
   * <form>
   *   <input name="firstName" value="Jacob">
   *   <button>Save</button>
   * </form>
   * ```
   */
  fragments.registerAttribute('on-*', {
    created: function() {
      var eventName = this.match;
      var _this = this;
      this.element.addEventListener(eventName, function(event) {
        if (!this.hasAttribute('disabled') && _this.context) {
          // Set the event on the context so it may be used in the expression when the event is triggered.
          var priorEvent = Object.getOwnPropertyDescriptor(_this.context, 'event');
          var priorElement = Object.getOwnPropertyDescriptor(_this.context, 'element');
          _this.context.event = event;
          _this.context.element = _this.element;

          // Let an on-[event] make the function call with its own arguments
          var listener = _this.observer.get();

          // Or just return a function which will be called with the event object
          if (typeof listener === 'function') listener.call(_this.context, event);

          // Reset the context to its prior state
          if (priorEvent) {
            Object.defineProperty(_this.context, 'event', priorEvent);
          } else {
            delete _this.context.event;
          }

          if (priorElement) {
            Object.defineProperty(_this.context, 'element', priorElement);
          } else {
            delete _this.context.element;
          }
        }
      });
    }
  });


  /**
   * ## on-[key event]
   * Adds a binder which is triggered when the keydown event's `keyCode` property matches. If the name includes ctrl
   * then it will only fire when the key plus the ctrlKey or metaKey is pressed.
   *
   * **Key Events:**
   *
   * * on-enter
   * * on-ctrl-enter
   * * on-esc
   *
   * **Example:**
   * ```html
   * <input on-enter="{{save()}}" on-esc="{{cancel()}}">
   * ```
   * *Result:*
   * ```html
   * <input>
   * ```
   */
  var keyCodes = { enter: 13, esc: 27, 'ctrl-enter': 13 };

  Object.keys(keyCodes).forEach(function(name) {
    var keyCode = keyCodes[name];

    fragments.registerAttribute('on-' + name, {
      created: function() {
        var useCtrlKey = name.indexOf('ctrl-') === 0;
        var _this = this;
        this.element.addEventListener('keydown', function(event) {
          if (useCtrlKey && !(event.ctrlKey || event.metaKey) || !_this.context) {
            return;
          }

          if (event.keyCode !== keyCode) {
            return;
          }

          event.preventDefault();

          if (!this.hasAttribute('disabled')) {
            // Set the event on the context so it may be used in the expression when the event is triggered.
            var prior = Object.getOwnPropertyDescriptor(_this.context, 'event');
            _this.context.event = event;

            // Let an on-[event] make the function call with its own arguments
            var listener = _this.observer.get();

            // Or just return a function which will be called with the event object
            if (typeof listener === 'function') listener.call(_this.context, event);

            // Reset the context to its prior state
            if (prior) {
              Object.defineProperty(_this.context, event, prior);
            } else {
              delete _this.context.event;
            }
          }
        });
      }
    })
  });


  /**
   * ## [attribute]$
   * Adds a binder to set the attribute of element to the value of the expression. Use this when you don't want an
   * `<img>` to try and load its `src` before being evaluated. This is only needed on the index.html page as template
   * will be processed before being inserted into the DOM. Generally you can just use `attr="{{expr}}"`.
   *
   * **Example Attributes:**
   *
   * **Example:**
   * ```html
   * <img src$="{{user.avatarUrl}}">
   * ```
   * *Result:*
   * ```html
   * <img src="http://cdn.example.com/avatars/jacwright-small.png">
   * ```
   */
  fragments.registerAttribute('*$', function(value) {
    var attrName = this.match;
    if (!value) {
      this.element.removeAttribute(attrName);
    } else {
      this.element.setAttribute(attrName, value);
    }
  });


  /**
   * ## [attribute]?
   * Adds a binder to toggle an attribute on or off if the expression is truthy or falsey. Use for attributes without
   * values such as `selected`, `disabled`, or `readonly`. `checked?` will use 2-way databinding.
   *
   * **Example:**
   * ```html
   * <label>Is Administrator</label>
   * <input type="checkbox" checked?="{{user.isAdmin}}">
   * <button disabled?="{{isProcessing}}">Submit</button>
   * ```
   * *Result if `isProcessing` is `true` and `user.isAdmin` is false:*
   * ```html
   * <label>Is Administrator</label>
   * <input type="checkbox">
   * <button disabled>Submit</button>
   * ```
   */
  fragments.registerAttribute('*?', function(value) {
    var attrName = this.match;
    if (!value) {
      this.element.removeAttribute(attrName);
    } else {
      this.element.setAttribute(attrName, '');
    }
  });


  /**
   * Add a clone of the `value` binder for `checked?` so checkboxes can have two-way binding using `checked?`.
   */
  fragments.registerAttribute('checked?', fragments.getAttributeBinder('value'));



  /**
   * ## if, unless, else-if, else-unless, else
   * Adds a binder to show or hide the element if the value is truthy or falsey. Actually removes the element from the
   * DOM when hidden, replacing it with a non-visible placeholder and not needlessly executing bindings inside.
   *
   * **Example:**
   * ```html
   * <ul class="header-links">
   *   <li if="user"><a href="/account">My Account</a></li>
   *   <li unless="user"><a href="/login">Sign In</a></li>
   *   <li else><a href="/logout">Sign Out</a></li>
   * </ul>
   * ```
   * *Result if `user` is null:*
   * ```html
   * <ul class="header-links">
   *   <li><a href="/login">Sign In</a></li>
   * </ul>
   * ```
   */
  var IfBinding = fragments.registerAttribute('if', {
    animated: true,
    priority: 50,
    unlessAttrName: 'unless',
    elseIfAttrName: 'else-if',
    elseUnlessAttrName: 'else-unless',
    elseAttrName: 'else',

    compiled: function() {
      var element = this.element;
      var expressions = [ wrapIfExp(this.expression, this.name === this.unlessAttrName) ];
      var placeholder = document.createTextNode('');
      var node = element.nextElementSibling;
      this.element = placeholder;
      element.parentNode.replaceChild(placeholder, element);

      // Stores a template for all the elements that can go into this spot
      this.templates = [ fragments.createTemplate(element) ];

      // Pull out any other elements that are chained with this one
      while (node) {
        var next = node.nextElementSibling;
        var expression;
        if (node.hasAttribute(this.elseIfAttrName)) {
          expression = fragments.codifyExpression('attribute', node.getAttribute(this.elseIfAttrName));
          expressions.push(wrapIfExp(expression, false));
          node.removeAttribute(this.elseIfAttrName);
        } else if (node.hasAttribute(this.elseUnlessAttrName)) {
          expression = fragments.codifyExpression('attribute', node.getAttribute(this.elseUnlessAttrName));
          expressions.push(wrapIfExp(expression, true));
          node.removeAttribute(this.elseUnlessAttrName);
        } else if (node.hasAttribute(this.elseAttrName)) {
          node.removeAttribute(this.elseAttrName);
          next = null;
        } else {
          break;
        }

        node.remove();
        this.templates.push(fragments.createTemplate(node));
        node = next;
      }

      // An expression that will return an index. Something like this `expr ? 0 : expr2 ? 1 : expr3 ? 2 : 3`. This will
      // be used to know which section to show in the if/else-if/else grouping.
      this.expression = expressions.map(function(expr, index) {
        return expr + ' ? ' + index + ' : ';
      }).join('') + expressions.length;
    },

    updated: function(index) {
      // For performance provide an alternate code path for animation
      if (this.animate && this.context) {
        this.updatedAnimated(index);
      } else {
        this.updatedRegular(index);
      }
    },

    add: function(view) {
      this.element.parentNode.insertBefore(view, this.element.nextSibling);
    },

    // Doesn't do much, but allows sub-classes to alter the functionality.
    remove: function(view) {
      view.dispose();
    },

    updatedRegular: function(index) {
      if (this.showing) {
        this.remove(this.showing);
        this.showing = null;
      }
      var template = this.templates[index];
      if (template) {
        this.showing = template.createView();
        this.showing.bind(this.context);
        this.add(this.showing);
      }
    },

    updatedAnimated: function(index) {
      this.lastValue = index;
      if (this.animating) {
        // Obsoleted, will change after animation is finished.
        this.showing.unbind();
        return;
      }

      if (this.showing) {
        this.animating = true;
        this.showing.unbind();
        this.animateOut(this.showing, function() {
          this.animating = false;

          if (this.showing) {
            // Make sure this wasn't unbound while we were animating (e.g. by a parent `if` that doesn't animate)
            this.remove(this.showing);
            this.showing = null;
          }

          if (this.context) {
            // finish by animating the new element in (if any), unless no longer bound
            this.updatedAnimated(this.lastValue);
          }
        });
        return;
      }

      var template = this.templates[index];
      if (template) {
        this.showing = template.createView();
        this.showing.bind(this.context);
        this.add(this.showing);
        this.animating = true;
        this.animateIn(this.showing, function() {
          this.animating = false;
          // if the value changed while this was animating run it again
          if (this.lastValue !== index) {
            this.updatedAnimated(this.lastValue);
          }
        });
      }
    },

    unbound: function() {
      if (this.showing) {
        this.showing.unbind();
      }
      this.lastValue = null;
      this.animating = false;
    }
  });

  fragments.registerAttribute('unless', IfBinding);

  function wrapIfExp(expr, isUnless) {
    return (isUnless ? '!' : '') + expr;
  }


  /**
   * ## repeat
   * Adds a binder to duplicate an element for each item in an array. The expression may be of the format `epxr` or
   * `itemName in expr` where `itemName` is the name each item inside the array will be referenced by within bindings
   * inside the element.
   *
   * **Example:**
   * ```html
   * <div each="{{post in posts}}" class-featured="{{post.isFeatured}}">
   *   <h1>{{post.title}}</h1>
   *   <div html="{{post.body | markdown}}"></div>
   * </div>
   * ```
   * *Result if there are 2 posts and the first one is featured:*
   * ```html
   * <div class="featured">
   *   <h1>Little Red</h1>
   *   <div>
   *     <p>Little Red Riding Hood is a story about a little girl.</p>
   *     <p>
   *       More info can be found on
   *       <a href="http://en.wikipedia.org/wiki/Little_Red_Riding_Hood">Wikipedia</a>
   *     </p>
   *   </div>
   * </div>
   * <div>
   *   <h1>Big Blue</h1>
   *   <div>
   *     <p>Some thoughts on the New York Giants.</p>
   *     <p>
   *       More info can be found on
   *       <a href="http://en.wikipedia.org/wiki/New_York_Giants">Wikipedia</a>
   *     </p>
   *   </div>
   * </div>
   * ```
   */
  fragments.registerAttribute('repeat', {
    animated: true,
    priority: 100,

    compiled: function() {
      var parent = this.element.parentNode;
      var placeholder = document.createTextNode('');
      parent.insertBefore(placeholder, this.element);
      this.template = fragments.createTemplate(this.element);
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
      this.observer.getChangeRecords = true;
    },

    removeView: function(view) {
      view.dispose();
      view._repeatItem_ = null;
    },

    updated: function(value, oldValue, changes) {
      if (!changes || !this.context) {
        this.populate(value);
      } else {
        if (this.animate) {
          this.updateChangesAnimated(value, changes);
        } else {
          this.updateChanges(value, changes);
        }
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
        context._origContext_ = this.context.hasOwnProperty('_origContext_')
          ? this.context._origContext_
          : this.context;
      }
      view.bind(context);
      view._repeatItem_ = value;
      return view;
    },

    populate: function(value) {
      if (this.animating) {
        this.valueWhileAnimating = value;
        return;
      }

      if (this.views.length) {
        this.views.forEach(this.removeView);
        this.views.length = 0;
      }

      if (Array.isArray(value) && value.length) {
        var frag = document.createDocumentFragment();

        value.forEach(function(item, index) {
          var view = this.createView(index, item);
          this.views.push(view);
          frag.appendChild(view);
        }, this);

        this.element.parentNode.insertBefore(frag, this.element.nextSibling);
      }
    },

    /**
     * This un-animated version removes all removed views first so they can be returned to the pool and then adds new
     * views back in. This is the most optimal method when not animating.
     */
    updateChanges: function(value, changes) {
      // Remove everything first, then add again, allowing for element reuse from the pool
      var addedCount = 0;

      changes.forEach(function(splice) {
        addedCount += splice.addedCount;
        if (!splice.removed.length) {
          return;
        }
        var removed = this.views.splice(splice.index - addedCount, splice.removed.length);
        removed.forEach(this.removeView);
      }, this);

      // Add the new/moved views
      changes.forEach(function(splice) {
        if (!splice.addedCount) return;
        var addedViews = [];
        var fragment = document.createDocumentFragment();
        var index = splice.index;
        var endIndex = index + splice.addedCount;

        for (var i = index; i < endIndex; i++) {
          var item = value[i];
          view = this.createView(i, item);
          addedViews.push(view);
          fragment.appendChild(view);
        }
        this.views.splice.apply(this.views, [ index, 0 ].concat(addedViews));
        var previousView = this.views[index - 1];
        var nextSibling = previousView ? previousView.lastViewNode.nextSibling : this.element.nextSibling;
        this.element.parentNode.insertBefore(fragment, nextSibling);
      }, this);
    },

    /**
     * This animated version must animate removed nodes out while added nodes are animating in making it less optimal
     * (but cool looking). It also handles "move" animations for nodes which are moving place within the list.
     */
    updateChangesAnimated: function(value, changes) {
      if (this.animating) {
        this.valueWhileAnimating = value;
        return;
      }
      var animatingValue = value.slice();
      var allAdded = [];
      var allRemoved = [];
      this.animating = true;

      // Run updates which occured while this was animating.
      function whenDone() {
        // The last animation finished will run this
        if (--whenDone.count !== 0) return;

        allRemoved.forEach(this.removeView);

        this.animating = false;
        if (this.valueWhileAnimating) {
          var changes = diff.arrays(this.valueWhileAnimating, animatingValue);
          this.updateChangesAnimated(this.valueWhileAnimating, changes);
          this.valueWhileAnimating = null;
        }
      }
      whenDone.count = 0;

      changes.forEach(function(splice) {
        var addedViews = [];
        var fragment = document.createDocumentFragment();
        var index = splice.index;
        var endIndex = index + splice.addedCount;
        var removedCount = splice.removed.length;

        for (var i = index; i < endIndex; i++) {
          var item = value[i];
          var view = this.createView(i, item);
          addedViews.push(view);
          fragment.appendChild(view);
        }

        var removedViews = this.views.splice.apply(this.views, [ index, removedCount ].concat(addedViews));
        var previousView = this.views[index - 1];
        var nextSibling = previousView ? previousView.lastViewNode.nextSibling : this.element.nextSibling;
        this.element.parentNode.insertBefore(fragment, nextSibling);

        allAdded = allAdded.concat(addedViews);
        allRemoved = allRemoved.concat(removedViews);
      }, this);


      allAdded.forEach(function(view) {
        whenDone.count++;
        this.animateIn(view, whenDone);
      }, this);

      allRemoved.forEach(function(view) {
        whenDone.count++;
        view.unbind();
        this.animateOut(view, whenDone);
      }, this);
    },

    unbound: function() {
      this.views.forEach(function(view) {
        view.unbind();
      });
      this.valueWhileAnimating = null;
      this.animating = false;
    }
  });
}

},{"../observer/diff":5}],11:[function(require,module,exports){
module.exports = registerDefaults;


/**
 * # Default Formatters
 * Registers default formatters with a fragments object.
 */
function registerDefaults(fragments) {

  /**
   *
   */
  fragments.registerFormatter('tokenList', function(value) {

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


  /**
   * v TODO v
   */
  fragments.registerFormatter('styles', function(value) {

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


  /**
   * ## filter
   * Filters an array by the given filter function(s), may provide a function, an
   * array, or an object with filtering functions
   */
  fragments.registerFormatter('filter', function(value, filterFunc) {
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


  /**
   * ## map
   * Adds a formatter to map an array or value by the given mapping function
   */
  fragments.registerFormatter('map', function(value, mapFunc) {
    if (value == null || typeof mapFunc !== 'function') {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map(mapFunc, this);
    } else {
      return mapFunc.call(this, value);
    }
  });


  /**
   * ## reduce
   * Adds a formatter to reduce an array or value by the given reduce function
   */
  fragments.registerFormatter('reduce', function(value, reduceFunc, initialValue) {
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


  /**
   * ## reduce
   * Adds a formatter to reduce an array or value by the given reduce function
   */
  fragments.registerFormatter('slice', function(value, index, endIndex) {
    if (Array.isArray(value)) {
      return value.slice(index, endIndex);
    } else {
      return value;
    }
  });


  /**
   * ## date
   * Adds a formatter to format dates and strings
   */
  fragments.registerFormatter('date', function(value) {
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


  /**
   * ## log
   * Adds a formatter to log the value of the expression, useful for debugging
   */
  fragments.registerFormatter('log', function(value, prefix) {
    if (prefix == null) prefix = 'Log:';
    console.log(prefix, value);
    return value;
  });


  /**
   * ## limit
   * Adds a formatter to limit the length of an array or string
   */
  fragments.registerFormatter('limit', function(value, limit) {
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


  /**
   * ## sort
   * Sorts an array given a field name or sort function, and a direction
   */
  fragments.registerFormatter('sort', function(value, sortFunc, dir) {
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


  /**
   * ## addQuery
   * Takes the input URL and adds (or replaces) the field in the query
   */
  fragments.registerFormatter('addQuery', function(value, queryField, queryValue) {
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
  function escapeHTML(value, setter) {
    if (setter) {
      div.innerHTML = value;
      return div.textContent;
    } else {
      div.textContent = value || '';
      return div.innerHTML;
    }
  }


  /**
   * ## escape
   * HTML escapes content. For use with other HTML-adding formatters such as autolink.
   *
   * **Example:**
   * ```xml
   * <div bind-html="tweet.content | escape | autolink:true"></div>
   * ```
   * *Result:*
   * ```xml
   * <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</div>
   * ```
   */
  fragments.registerFormatter('escape', escapeHTML);


  /**
   * ## p
   * HTML escapes content wrapping paragraphs in <p> tags.
   *
   * **Example:**
   * ```xml
   * <div bind-html="tweet.content | p | autolink:true"></div>
   * ```
   * *Result:*
   * ```xml
   * <div><p>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</p>
   * <p>It's great</p></div>
   * ```
   */
  fragments.registerFormatter('p', function(value, setter) {
    if (setter) {
      return escapeHTML(value, setter);
    } else {
      var lines = (value || '').split(/\r?\n/);
      var escaped = lines.map(function(line) { return escapeHTML(line) || '<br>'; });
      return '<p>' + escaped.join('</p>\n<p>') + '</p>';
    }
  });


  /**
   * ## br
   * HTML escapes content adding <br> tags in place of newlines characters.
   *
   * **Example:**
   * ```xml
   * <div bind-html="tweet.content | br | autolink:true"></div>
   * ```
   * *Result:*
   * ```xml
   * <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!<br>
   * It's great</div>
   * ```
   */
  fragments.registerFormatter('br', function(value, setter) {
    if (setter) {
      return escapeHTML(value, setter);
    } else {
      var lines = (value || '').split(/\r?\n/);
      return lines.map(escapeHTML).join('<br>\n');
    }
  });


  /**
   * ## newline
   * HTML escapes content adding <p> tags at double newlines and <br> tags in place of single newline characters.
   *
   * **Example:**
   * ```xml
   * <div bind-html="tweet.content | newline | autolink:true"></div>
   * ```
   * *Result:*
   * ```xml
   * <div><p>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!<br>
   * It's great</p></div>
   * ```
   */
  fragments.registerFormatter('newline', function(value, setter) {
    if (setter) {
      return escapeHTML(value, setter);
    } else {
      var paragraphs = (value || '').split(/\r?\n\s*\r?\n/);
      var escaped = paragraphs.map(function(paragraph) {
        var lines = paragraph.split(/\r?\n/);
        return lines.map(escapeHTML).join('<br>\n');
      });
      return '<p>' + escaped.join('</p>\n\n<p>') + '</p>';
    }
  });



  var urlExp = /(^|\s|\()((?:https?|ftp):\/\/[\-A-Z0-9+\u0026@#\/%?=()~_|!:,.;]*[\-A-Z0-9+\u0026@#\/%=~(_|])/gi;
  /**
   * ## autolink
   * Adds automatic links to escaped content (be sure to escape user content). Can be used on existing HTML content as it
   * will skip URLs within HTML tags. Passing true in the second parameter will set the target to `_blank`.
   *
   * **Example:**
   * ```xml
   * <div bind-html="tweet.content | escape | autolink:true"></div>
   * ```
   * *Result:*
   * ```xml
   * <div>Check out <a href="https://github.com/chip-js/" target="_blank">https://github.com/chip-js/</a>!</div>
   * ```
   */
  fragments.registerFormatter('autolink', function(value, target) {
    target = (target) ? ' target="_blank"' : '';

    return ('' + value).replace(/<[^>]+>|[^<]+/g, function(match) {
      if (match.charAt(0) === '<') {
        return match;
      }
      return match.replace(urlExp, '$1<a href="$2"' + target + '>$2</a>');
    });
  });


  /**
   *
   */
  fragments.registerFormatter('int', function(value) {
    value = parseInt(value);
    return isNaN(value) ? null : value;
  });


  /**
   *
   */
  fragments.registerFormatter('float', function(value) {
    value = parseFloat(value);
    return isNaN(value) ? null : value;
  });


  /**
   *
   */
  fragments.registerFormatter('bool', function(value) {
    return value && value !== '0' && value !== 'false';
  });
}

},{}],12:[function(require,module,exports){
module.exports = Template;
var View = require('./view');
var extend = require('./util/extend');


/**
 * ## Template
 * Takes an HTML string, an element, an array of elements, or a document fragment, and compiles it into a template.
 * Instances may then be created and bound to a given context.
 * @param {String|NodeList|HTMLCollection|HTMLTemplateElement|HTMLScriptElement|Node} html A Template can be created
 * from many different types of objects. Any of these will be converted into a document fragment for the template to
 * clone. Nodes and elements passed in will be removed from the DOM.
 */
function Template() {
  this.pool = [];
}


Template.prototype = {

  /**
   * Creates a new view cloned from this template.
   */
  createView: function() {
    if (this.pool.length) {
      return this.pool.pop();
    }

    return extend.make(View, document.importNode(this, true), this);
  },

  returnView: function(view) {
    if (this.pool.indexOf(view) === -1) {
      this.pool.push(view);
    }
  }
};

},{"./util/extend":14,"./view":16}],13:[function(require,module,exports){
// Helper methods for animation
exports.makeElementAnimatable = makeElementAnimatable;
exports.getComputedCSS = getComputedCSS;
exports.animateElement = animateElement;

function makeElementAnimatable(element) {
  // Add polyfill just on this element
  if (!element.animate) {
    element.animate = animateElement;
  }

  // Not a polyfill but a helper
  if (!element.getComputedCSS) {
    element.getComputedCSS = getComputedCSS;
  }

  return element;
}

/**
 * Get the computed style on an element.
 */
function getComputedCSS(styleName) {
  if (this.ownerDocument.defaultView.opener) {
    return this.ownerDocument.defaultView.getComputedStyle(this)[styleName];
  }
  return window.getComputedStyle(this)[styleName];
}

/**
 * Very basic polyfill for Element.animate if it doesn't exist. If it does, use the native.
 * This only supports two css states. It will overwrite existing styles. It doesn't return an animation play control. It
 * only supports duration, delay, and easing. Returns an object with a property onfinish.
 */
function animateElement(css, options) {
  if (!Array.isArray(css) || css.length !== 2) {
    throw new TypeError('animate polyfill requires an array for css with an initial and final state');
  }

  if (!options || !options.hasOwnProperty('duration')) {
    throw new TypeError('animate polyfill requires options with a duration');
  }

  var duration = options.duration || 0;
  var delay = options.delay || 0;
  var easing = options.easing;
  var initialCss = css[0];
  var finalCss = css[1];
  var allCss = {};
  var playback = { onfinish: null };

  Object.keys(initialCss).forEach(function(key) {
    allCss[key] = true;
    element.style[key] = initialCss[key];
  });

  // trigger reflow
  element.offsetWidth;

  var transitionOptions = ' ' + duration + 'ms';
  if (easing) {
    transitionOptions += ' ' + easing;
  }
  if (delay) {
    transitionOptions += ' ' + delay + 'ms';
  }

  element.style.transition = Object.keys(finalCss).map(function(key) {
    return key + transitionOptions
  }).join(', ');

  Object.keys(finalCss).forEach(function(key) {
    allCss[key] = true;
    element.style[key] = finalCss[key];
  });

  setTimeout(function() {
    Object.keys(allCss).forEach(function(key) {
      element.style[key] = '';
    });

    if (playback.onfinish) {
      playback.onfinish();
    }
  }, duration + delay);

  return playback;
}

},{}],14:[function(require,module,exports){
var global = (function() { return this })();
var slice = Array.prototype.slice;
module.exports = extend;
extend.make = make;


/**
 * Creates a new prototype for the given contructor and sets an `extend` method on it. If `extend` is called from a
 * it will extend that class.
 */
function extend(constructor, prototype) {
  var superClass = this === global ? Object : this;
  if (typeof constructor !== 'function' && !prototype) {
    prototype = constructor;
    constructor = function() {
      superClass.apply(this, arguments);
    };
  }
  constructor.extend = extend;
  var descriptors = getPrototypeDescriptors(constructor, prototype);
  constructor.prototype = Object.create(superClass.prototype, descriptors);
  return constructor;
}


/**
 * Makes a native object pretend to be a class (e.g. adds methods to a DocumentFragment and calls the constructor).
 */
function make(constructor, object) {
  if (typeof constructor !== 'function' || typeof object !== 'object') {
    throw new TypeError('make must accept a function constructor and an object');
  }
  var args = slice.call(arguments, 2);
  var proto = constructor.prototype;
  for (var key in proto) {
    object[key] = proto[key];
  }
  constructor.apply(object, args);
  return object;
}


function getPrototypeDescriptors(constructor, prototype) {
  var descriptors = {
    constructor: { writable: true, configurable: true, value: constructor }
  };

  Object.getOwnPropertyNames(prototype).forEach(function(name) {
    var descriptor = Object.getOwnPropertyDescriptor(prototype, name);
    descriptor.enumerable = false;
    descriptors[name] = descriptor;
  });
  return descriptors;
}

},{}],15:[function(require,module,exports){
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
  } else if ('length' in html) {
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
    if (l === list.length + 1) {
      // adjust for NodeLists which are live, they shrink as we pull nodes out of the DOM
      i--;
      l--;
    }
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

},{}],16:[function(require,module,exports){
module.exports = View;


/**
 * ## View
 * A DocumentFragment with bindings.
 */
function View(template) {
  this.template = template;
  this.bindings = this.template.bindings.map(function(binding) {
    return binding.cloneForView(this);
  }, this);
  this.firstViewNode = this.firstChild;
  this.lastViewNode = this.lastChild;
  if (this.firstViewNode) {
    this.firstViewNode.view = this;
    this.lastViewNode.view = this;
  }
}


View.prototype = {

  /**
   * Removes a view from the DOM. A view is a DocumentFragment, so `remove()` returns all its nodes to itself.
   */
  remove: function() {
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
  },


  /**
   * Removes a view (if not already removed) and adds the view to its template's pool.
   */
  dispose: function() {
    // Make sure the view is removed from the DOM
    this.bindings.forEach(function(binding) {
      binding.dispose();
    });

    this.remove();
    if (this.template) {
      this.template.returnView(this);
    }
  },


  /**
   * Binds a view to a given context.
   */
  bind: function(context) {
    this.bindings.forEach(function(binding) {
      binding.bind(context);
    });
  },


  /**
   * Unbinds a view from any context.
   */
  unbind: function() {
    this.bindings.forEach(function(binding) {
      binding.unbind();
    });
  }
};

},{}],17:[function(require,module,exports){
var Fragments = require('./src/fragments');
var Observer = require('./src/observer');

function create() {
  var fragments = new Fragments(Observer);
  fragments.expression = Observer.expression;
  fragments.sync = Observer.sync;
  return fragments;
}

// Create an instance of fragments with the default observer
module.exports = create();
module.exports.create = create;

},{"./src/fragments":4,"./src/observer":7}]},{},[17])(17)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvZGlmZi5qcyIsInNyYy9vYnNlcnZlci9leHByZXNzaW9uLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIiwiaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN2tCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0WUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hZQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoMEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMUdBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gQW5pbWF0ZWRCaW5kaW5nO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyk7XG52YXIgX3N1cGVyID0gQmluZGluZy5wcm90b3R5cGU7XG5cbi8qKlxuICogQmluZGluZ3Mgd2hpY2ggZXh0ZW5kIEFuaW1hdGVkQmluZGluZyBoYXZlIHRoZSBhYmlsaXR5IHRvIGFuaW1hdGUgZWxlbWVudHMgdGhhdCBhcmUgYWRkZWQgdG8gdGhlIERPTSBhbmQgcmVtb3ZlZCBmcm9tXG4gKiB0aGUgRE9NLiBUaGlzIGFsbG93cyBtZW51cyB0byBzbGlkZSBvcGVuIGFuZCBjbG9zZWQsIGVsZW1lbnRzIHRvIGZhZGUgaW4gb3IgZHJvcCBkb3duLCBhbmQgcmVwZWF0ZWQgaXRlbXMgdG8gYXBwZWFyXG4gKiB0byBtb3ZlIChpZiB5b3UgZ2V0IGNyZWF0aXZlIGVub3VnaCkuXG4gKlxuICogVGhlIGZvbGxvd2luZyA1IG1ldGhvZHMgYXJlIGhlbHBlciBET00gbWV0aG9kcyB0aGF0IGFsbG93IHJlZ2lzdGVyZWQgYmluZGluZ3MgdG8gd29yayB3aXRoIENTUyB0cmFuc2l0aW9ucyBmb3JcbiAqIGFuaW1hdGluZyBlbGVtZW50cy4gSWYgYW4gZWxlbWVudCBoYXMgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgb3IgYSBtYXRjaGluZyBKYXZhU2NyaXB0IG1ldGhvZCwgdGhlc2UgaGVscGVyIG1ldGhvZHNcbiAqIHdpbGwgc2V0IGEgY2xhc3Mgb24gdGhlIG5vZGUgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uIGFuZC9vciBjYWxsIHRoZSBKYXZhU2NyaXB0IG1ldGhvZHMgdG8gaGFuZGxlIGl0LlxuICpcbiAqIEFuIGFuaW1hdGlvbiBtYXkgYmUgZWl0aGVyIGEgQ1NTIHRyYW5zaXRpb24sIGEgQ1NTIGFuaW1hdGlvbiwgb3IgYSBzZXQgb2YgSmF2YVNjcmlwdCBtZXRob2RzIHRoYXQgd2lsbCBiZSBjYWxsZWQuXG4gKlxuICogSWYgdXNpbmcgQ1NTLCBjbGFzc2VzIGFyZSBhZGRlZCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBlbGVtZW50LiBXaGVuIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaXQgd2lsbCByZWNlaXZlIHRoZSBgd2lsbC1cbiAqIGFuaW1hdGUtaW5gIGNsYXNzIGJlZm9yZSBiZWluZyBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYGFuaW1hdGUtaW5gIGNsYXNzIGltbWVkaWF0ZWx5IGFmdGVyIGJlaW5nXG4gKiBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGJvdGggY2xhc2VzIHdpbGwgYmUgcmVtb3ZlZCBhZnRlciB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLiBXaGVuIGFuIGVsZW1lbnQgaXMgYmVpbmcgcmVtb3ZlZFxuICogZnJvbSB0aGUgRE9NIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtYW5pbWF0ZS1vdXRgIGFuZCBgYW5pbWF0ZS1vdXRgIGNsYXNzZXMsIHRoZW4gdGhlIGNsYXNzZXMgd2lsbCBiZSByZW1vdmVkIG9uY2VcbiAqIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuXG4gKlxuICogSWYgdXNpbmcgSmF2YVNjcmlwdCwgbWV0aG9kcyBtdXN0IGJlIGRlZmluZWQgIHRvIGFuaW1hdGUgdGhlIGVsZW1lbnQgdGhlcmUgYXJlIDMgc3VwcG9ydGVkIG1ldGhvZHMgd2hpY2ggY2FuIGJcbiAqXG4gKiBUT0RPIGNhY2hlIGJ5IGNsYXNzLW5hbWUgKEFuZ3VsYXIpPyBPbmx5IHN1cHBvcnQgamF2YXNjcmlwdC1zdHlsZSAoRW1iZXIpPyBBZGQgYSBgd2lsbC1hbmltYXRlLWluYCBhbmRcbiAqIGBkaWQtYW5pbWF0ZS1pbmAgZXRjLj9cbiAqIElGIGhhcyBhbnkgY2xhc3NlcywgYWRkIHRoZSBgd2lsbC1hbmltYXRlLWlufG91dGAgYW5kIGdldCBjb21wdXRlZCBkdXJhdGlvbi4gSWYgbm9uZSwgcmV0dXJuLiBDYWNoZS5cbiAqIFJVTEUgaXMgdXNlIHVuaXF1ZSBjbGFzcyB0byBkZWZpbmUgYW4gYW5pbWF0aW9uLiBPciBhdHRyaWJ1dGUgYGFuaW1hdGU9XCJmYWRlXCJgIHdpbGwgYWRkIHRoZSBjbGFzcz9cbiAqIGAuZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLmZhZGUuYW5pbWF0ZS1pbmAsIGAuZmFkZS53aWxsLWFuaW1hdGUtb3V0YCwgYC5mYWRlLmFuaW1hdGUtb3V0YFxuICpcbiAqIEV2ZW50cyB3aWxsIGJlIHRyaWdnZXJlZCBvbiB0aGUgZWxlbWVudHMgbmFtZWQgdGhlIHNhbWUgYXMgdGhlIGNsYXNzIG5hbWVzIChlLmcuIGBhbmltYXRlLWluYCkgd2hpY2ggbWF5IGJlIGxpc3RlbmVkXG4gKiB0byBpbiBvcmRlciB0byBjYW5jZWwgYW4gYW5pbWF0aW9uIG9yIHJlc3BvbmQgdG8gaXQuXG4gKlxuICogSWYgdGhlIG5vZGUgaGFzIG1ldGhvZHMgYGFuaW1hdGVJbihkb25lKWAsIGBhbmltYXRlT3V0KGRvbmUpYCwgYGFuaW1hdGVNb3ZlSW4oZG9uZSlgLCBvciBgYW5pbWF0ZU1vdmVPdXQoZG9uZSlgXG4gKiBkZWZpbmVkIG9uIHRoZW0gdGhlbiB0aGUgaGVscGVycyB3aWxsIGFsbG93IGFuIGFuaW1hdGlvbiBpbiBKYXZhU2NyaXB0IHRvIGJlIHJ1biBhbmQgd2FpdCBmb3IgdGhlIGBkb25lYCBmdW5jdGlvbiB0b1xuICogYmUgY2FsbGVkIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIEJlIHN1cmUgdG8gYWN0dWFsbHkgaGF2ZSBhbiBhbmltYXRpb24gZGVmaW5lZCBmb3IgZWxlbWVudHMgd2l0aCB0aGUgYGFuaW1hdGVgIGNsYXNzL2F0dHJpYnV0ZSBiZWNhdXNlIHRoZSBoZWxwZXJzIHVzZVxuICogdGhlIGB0cmFuc2l0aW9uZW5kYCBhbmQgYGFuaW1hdGlvbmVuZGAgZXZlbnRzIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGZpbmlzaGVkLCBhbmQgaWYgdGhlcmUgaXMgbm8gYW5pbWF0aW9uXG4gKiB0aGVzZSBldmVudHMgd2lsbCBuZXZlciBiZSB0cmlnZ2VyZWQgYW5kIHRoZSBvcGVyYXRpb24gd2lsbCBuZXZlciBjb21wbGV0ZS5cbiAqL1xuZnVuY3Rpb24gQW5pbWF0ZWRCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgdmFyIGVsZW1lbnQgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHZhciBhbmltYXRlID0gZWxlbWVudC5nZXRBdHRyaWJ1dGUocHJvcGVydGllcy5mcmFnbWVudHMuYW5pbWF0ZUF0dHJpYnV0ZSk7XG4gIHZhciBmcmFnbWVudHMgPSBwcm9wZXJ0aWVzLmZyYWdtZW50cztcblxuICBpZiAoYW5pbWF0ZSAhPT0gbnVsbCkge1xuICAgIGlmIChlbGVtZW50Lm5vZGVOYW1lID09PSAnVEVNUExBVEUnIHx8IGVsZW1lbnQubm9kZU5hbWUgPT09ICdTQ1JJUFQnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBhbmltYXRlIG11bHRpcGxlIG5vZGVzIGluIGEgdGVtcGxhdGUgb3Igc2NyaXB0LiBSZW1vdmUgdGhlIFthbmltYXRlXSBhdHRyaWJ1dGUuJyk7XG4gICAgfVxuXG4gICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIC8vIEFsbG93IG11bHRpcGxlIGJpbmRpbmdzIHRvIGFuaW1hdGUgYnkgbm90IHJlbW92aW5nIHVudGlsIHRoZXkgaGF2ZSBhbGwgYmVlbiBjcmVhdGVkXG4gICAgICBlbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShwcm9wZXJ0aWVzLmZyYWdtZW50cy5hbmltYXRlQXR0cmlidXRlKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYW5pbWF0ZSA9IHRydWU7XG5cbiAgICBpZiAoZnJhZ21lbnRzLmlzQm91bmQoJ2F0dHJpYnV0ZScsIGFuaW1hdGUpKSB7XG4gICAgICAvLyBqYXZhc2NyaXB0IGFuaW1hdGlvblxuICAgICAgdGhpcy5hbmltYXRlRXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBhbmltYXRlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGFuaW1hdGVbMF0gPT09ICcuJykge1xuICAgICAgICAvLyBjbGFzcyBhbmltYXRpb25cbiAgICAgICAgdGhpcy5hbmltYXRlQ2xhc3NOYW1lID0gYW5pbWF0ZS5zbGljZSgxKTtcbiAgICAgIH0gZWxzZSBpZiAoYW5pbWF0ZSkge1xuICAgICAgICAvLyByZWdpc3RlcmVkIGFuaW1hdGlvblxuICAgICAgICB2YXIgYW5pbWF0ZU9iamVjdCA9IGZyYWdtZW50cy5nZXRBbmltYXRpb24oYW5pbWF0ZSk7XG4gICAgICAgIGlmICh0eXBlb2YgYW5pbWF0ZU9iamVjdCA9PT0gJ2Z1bmN0aW9uJykgYW5pbWF0ZU9iamVjdCA9IG5ldyBhbmltYXRlT2JqZWN0KHRoaXMpO1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSBhbmltYXRlT2JqZWN0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIEJpbmRpbmcuY2FsbCh0aGlzLCBwcm9wZXJ0aWVzKTtcbn1cblxuXG5CaW5kaW5nLmV4dGVuZChBbmltYXRlZEJpbmRpbmcsIHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgX3N1cGVyLmluaXQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVFeHByZXNzaW9uKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24sIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfVxuICB9LFxuXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09IGNvbnRleHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX3N1cGVyLmJpbmQuY2FsbCh0aGlzLCBjb250ZXh0KTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIuYmluZChjb250ZXh0KTtcbiAgICB9XG4gIH0sXG5cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci51bmJpbmQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIudW5iaW5kKCk7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBIZWxwZXIgbWV0aG9kIHRvIHJlbW92ZSBhIG5vZGUgZnJvbSB0aGUgRE9NLCBhbGxvd2luZyBmb3IgYW5pbWF0aW9ucyB0byBvY2N1ci4gYGNhbGxiYWNrYCB3aWxsIGJlIGNhbGxlZCB3aGVuXG4gICAqIGZpbmlzaGVkLlxuICAgKi9cbiAgYW5pbWF0ZU91dDogZnVuY3Rpb24obm9kZSwgY2FsbGJhY2spIHtcbiAgICBpZiAobm9kZS5maXJzdFZpZXdOb2RlKSBub2RlID0gbm9kZS5maXJzdFZpZXdOb2RlO1xuXG4gICAgdGhpcy5hbmltYXRlTm9kZSgnb3V0Jywgbm9kZSwgZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwodGhpcyk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gaW5zZXJ0IGEgbm9kZSBpbiB0aGUgRE9NIGJlZm9yZSBhbm90aGVyIG5vZGUsIGFsbG93aW5nIGZvciBhbmltYXRpb25zIHRvIG9jY3VyLiBgY2FsbGJhY2tgIHdpbGxcbiAgICogYmUgY2FsbGVkIHdoZW4gZmluaXNoZWQuIElmIGBiZWZvcmVgIGlzIG5vdCBwcm92aWRlZCB0aGVuIHRoZSBhbmltYXRpb24gd2lsbCBiZSBydW4gd2l0aG91dCBpbnNlcnRpbmcgdGhlIG5vZGUuXG4gICAqL1xuICBhbmltYXRlSW46IGZ1bmN0aW9uKG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKG5vZGUuZmlyc3RWaWV3Tm9kZSkgbm9kZSA9IG5vZGUuZmlyc3RWaWV3Tm9kZTtcbiAgICB0aGlzLmFuaW1hdGVOb2RlKCdpbicsIG5vZGUsIGNhbGxiYWNrLCB0aGlzKTtcbiAgfSxcblxuICAvKipcbiAgICogQWxsb3cgYW4gZWxlbWVudCB0byB1c2UgQ1NTMyB0cmFuc2l0aW9ucyBvciBhbmltYXRpb25zIHRvIGFuaW1hdGUgaW4gb3Igb3V0IG9mIHRoZSBwYWdlLlxuICAgKi9cbiAgYW5pbWF0ZU5vZGU6IGZ1bmN0aW9uKGRpcmVjdGlvbiwgbm9kZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgYW5pbWF0ZU9iamVjdCwgY2xhc3NOYW1lLCBuYW1lLCB3aWxsTmFtZSwgZGlkTmFtZSwgX3RoaXMgPSB0aGlzO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZU9iamVjdCAmJiB0eXBlb2YgdGhpcy5hbmltYXRlT2JqZWN0ID09PSAnb2JqZWN0Jykge1xuICAgICAgYW5pbWF0ZU9iamVjdCA9IHRoaXMuYW5pbWF0ZU9iamVjdDtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYW5pbWF0ZUNsYXNzTmFtZSkge1xuICAgICAgY2xhc3NOYW1lID0gdGhpcy5hbmltYXRlQ2xhc3NOYW1lO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHRoaXMuYW5pbWF0ZU9iamVjdCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNsYXNzTmFtZSA9IHRoaXMuYW5pbWF0ZU9iamVjdDtcbiAgICB9XG5cbiAgICBpZiAoYW5pbWF0ZU9iamVjdCkge1xuICAgICAgdmFyIGRpciA9IGRpcmVjdGlvbiA9PT0gJ2luJyA/ICdJbicgOiAnT3V0JztcbiAgICAgIG5hbWUgPSAnYW5pbWF0ZScgKyBkaXI7XG4gICAgICB3aWxsTmFtZSA9ICd3aWxsQW5pbWF0ZScgKyBkaXI7XG4gICAgICBkaWROYW1lID0gJ2RpZEFuaW1hdGUnICsgZGlyO1xuXG4gICAgICBhbmltYXRpb24ubWFrZUVsZW1lbnRBbmltYXRhYmxlKG5vZGUpO1xuXG4gICAgICBpZiAoYW5pbWF0ZU9iamVjdFt3aWxsTmFtZV0pIHtcbiAgICAgICAgYW5pbWF0ZU9iamVjdFt3aWxsTmFtZV0obm9kZSk7XG4gICAgICAgIC8vIHRyaWdnZXIgcmVmbG93XG4gICAgICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgfVxuXG4gICAgICBpZiAoYW5pbWF0ZU9iamVjdFtuYW1lXSkge1xuICAgICAgICBhbmltYXRlT2JqZWN0W25hbWVdKG5vZGUsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmIChhbmltYXRlT2JqZWN0W2RpZE5hbWVdKSBhbmltYXRlT2JqZWN0W2RpZE5hbWVdKG5vZGUpO1xuICAgICAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbChfdGhpcyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gJ2FuaW1hdGUtJyArIGRpcmVjdGlvbjtcbiAgICAgIHdpbGxOYW1lID0gJ3dpbGwtYW5pbWF0ZS0nICsgZGlyZWN0aW9uO1xuICAgICAgaWYgKGNsYXNzTmFtZSkgbm9kZS5jbGFzc0xpc3QuYWRkKGNsYXNzTmFtZSk7XG5cbiAgICAgIGlmIChkaXJlY3Rpb24gPT09ICdpbicpIHtcbiAgICAgICAgdmFyIG5leHQgPSBub2RlLm5leHRTaWJsaW5nLCBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKHdpbGxOYW1lKTtcbiAgICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShub2RlLCBuZXh0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIHRyaWdnZXIgcmVmbG93XG4gICAgICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgfVxuXG4gICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUod2lsbE5hbWUpO1xuICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKG5hbWUpO1xuXG4gICAgICB2YXIgZHVyYXRpb24gPSBnZXREdXJhdGlvbi5jYWxsKHRoaXMsIG5vZGUsIGRpcmVjdGlvbik7XG4gICAgICBmdW5jdGlvbiB3aGVuRG9uZSgpIHtcbiAgICAgICAgbm9kZS5jbGFzc0xpc3QucmVtb3ZlKG5hbWUpO1xuICAgICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGR1cmF0aW9uKSB7XG4gICAgICAgIHNldFRpbWVvdXQod2hlbkRvbmUsIGR1cmF0aW9uKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdoZW5Eb25lKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG59KTtcblxuXG52YXIgdHJhbnNpdGlvbkR1cmF0aW9uTmFtZSA9ICd0cmFuc2l0aW9uRHVyYXRpb24nO1xudmFyIHRyYW5zaXRpb25EZWxheU5hbWUgPSAndHJhbnNpdGlvbkRlbGF5JztcbnZhciBhbmltYXRpb25EdXJhdGlvbk5hbWUgPSAnYW5pbWF0aW9uRHVyYXRpb24nO1xudmFyIGFuaW1hdGlvbkRlbGF5TmFtZSA9ICdhbmltYXRpb25EZWxheSc7XG52YXIgc3R5bGUgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGU7XG5pZiAoc3R5bGUudHJhbnNpdGlvbkR1cmF0aW9uID09PSB1bmRlZmluZWQgJiYgc3R5bGUud2Via2l0VHJhbnNpdGlvbkR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgdHJhbnNpdGlvbkR1cmF0aW9uTmFtZSA9ICd3ZWJraXRUcmFuc2l0aW9uRHVyYXRpb24nO1xuICB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3dlYmtpdFRyYW5zaXRpb25EZWxheSc7XG59XG5pZiAoc3R5bGUuYW5pbWF0aW9uRHVyYXRpb24gPT09IHVuZGVmaW5lZCAmJiBzdHlsZS53ZWJraXRBbmltYXRpb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gIGFuaW1hdGlvbkR1cmF0aW9uTmFtZSA9ICd3ZWJraXRBbmltYXRpb25EdXJhdGlvbic7XG4gIGFuaW1hdGlvbkRlbGF5TmFtZSA9ICd3ZWJraXRBbmltYXRpb25EZWxheSc7XG59XG5cblxuZnVuY3Rpb24gZ2V0RHVyYXRpb24obm9kZSwgZGlyZWN0aW9uKSB7XG4gIHZhciBtaWxsaXNlY29uZHMgPSB0aGlzLmNsb25lZEZyb21bJ19fYW5pbWF0aW9uRHVyYXRpb24nICsgZGlyZWN0aW9uXTtcbiAgaWYgKCFtaWxsaXNlY29uZHMpIHtcbiAgICAvLyBSZWNhbGMgaWYgbm9kZSB3YXMgb3V0IG9mIERPTSBiZWZvcmUgYW5kIGhhZCAwIGR1cmF0aW9uLCBhc3N1bWUgdGhlcmUgaXMgYWx3YXlzIFNPTUUgZHVyYXRpb24uXG4gICAgdmFyIHN0eWxlcyA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIHZhciBzZWNvbmRzID0gTWF0aC5tYXgocGFyc2VGbG9hdChzdHlsZXNbdHJhbnNpdGlvbkR1cmF0aW9uTmFtZV0gfHwgMCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbdHJhbnNpdGlvbkRlbGF5TmFtZV0gfHwgMCksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1thbmltYXRpb25EdXJhdGlvbk5hbWVdIHx8IDApICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW2FuaW1hdGlvbkRlbGF5TmFtZV0gfHwgMCkpO1xuICAgIG1pbGxpc2Vjb25kcyA9IHNlY29uZHMgKiAxMDAwIHx8IDA7XG4gICAgdGhpcy5jbG9uZWRGcm9tLl9fYW5pbWF0aW9uRHVyYXRpb25fXyA9IG1pbGxpc2Vjb25kcztcbiAgfVxuICByZXR1cm4gbWlsbGlzZWNvbmRzO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBCaW5kaW5nO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcblxuLyoqXG4gKiBBIGJpbmRpbmcgaXMgYSBsaW5rIGJldHdlZW4gYW4gZWxlbWVudCBhbmQgc29tZSBkYXRhLiBTdWJjbGFzc2VzIG9mIEJpbmRpbmcgY2FsbGVkIGJpbmRlcnMgZGVmaW5lIHdoYXQgYSBiaW5kaW5nIGRvZXNcbiAqIHdpdGggdGhhdCBsaW5rLiBJbnN0YW5jZXMgb2YgdGhlc2UgYmluZGVycyBhcmUgY3JlYXRlZCBhcyBiaW5kaW5ncyBvbiB0ZW1wbGF0ZXMuIFdoZW4gYSB2aWV3IGlzIHN0YW1wZWQgb3V0IGZyb20gdGhlXG4gKiB0ZW1wbGF0ZSB0aGUgYmluZGluZyBpcyBcImNsb25lZFwiIChpdCBpcyBhY3R1YWxseSBleHRlbmRlZCBmb3IgcGVyZm9ybWFuY2UpIGFuZCB0aGUgYGVsZW1lbnRgL2Bub2RlYCBwcm9wZXJ0eSBpc1xuICogdXBkYXRlZCB0byB0aGUgbWF0Y2hpbmcgZWxlbWVudCBpbiB0aGUgdmlldy5cbiAqXG4gKiAjIyMgUHJvcGVydGllc1xuICogICogZWxlbWVudDogVGhlIGVsZW1lbnQgKG9yIHRleHQgbm9kZSkgdGhpcyBiaW5kaW5nIGlzIGJvdW5kIHRvXG4gKiAgKiBub2RlOiBBbGlhcyBvZiBlbGVtZW50LCBzaW5jZSBiaW5kaW5ncyBtYXkgYXBwbHkgdG8gdGV4dCBub2RlcyB0aGlzIGlzIG1vcmUgYWNjdXJhdGVcbiAqICAqIG5hbWU6IFRoZSBhdHRyaWJ1dGUgb3IgZWxlbWVudCBuYW1lIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIHRleHQgbm9kZXMpXG4gKiAgKiBtYXRjaDogVGhlIG1hdGNoZWQgcGFydCBvZiB0aGUgbmFtZSBmb3Igd2lsZGNhcmQgYXR0cmlidXRlcyAoZS5nLiBgb24tKmAgbWF0Y2hpbmcgYWdhaW5zdCBgb24tY2xpY2tgIHdvdWxkIGhhdmUgYVxuICogICAgbWF0Y2ggcHJvcGVydHkgZXF1YWxsaW5nIGBjbGlja2ApLiBVc2UgYHRoaXMuY2FtZWxDYXNlYCB0byBnZXQgdGhlIG1hdGNoIHByb2VydHkgY2FtZWxDYXNlZC5cbiAqICAqIGV4cHJlc3Npb246IFRoZSBleHByZXNzaW9uIHRoaXMgYmluZGluZyB3aWxsIHVzZSBmb3IgaXRzIHVwZGF0ZXMgKGRvZXMgbm90IGFwcGx5IHRvIG1hdGNoZWQgZWxlbWVudHMpXG4gKiAgKiBjb250ZXh0OiBUaGUgY29udGV4dCB0aGUgZXhyZXNzaW9uIG9wZXJhdGVzIHdpdGhpbiB3aGVuIGJvdW5kXG4gKi9cbmZ1bmN0aW9uIEJpbmRpbmcocHJvcGVydGllcykge1xuICBpZiAoIXByb3BlcnRpZXMubm9kZSB8fCAhcHJvcGVydGllcy52aWV3KSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQSBiaW5kaW5nIG11c3QgcmVjZWl2ZSBhIG5vZGUgYW5kIGEgdmlldycpO1xuICB9XG5cbiAgLy8gZWxlbWVudCBhbmQgbm9kZSBhcmUgYWxpYXNlc1xuICB0aGlzLl9lbGVtZW50UGF0aCA9IGluaXROb2RlUGF0aChwcm9wZXJ0aWVzLm5vZGUsIHByb3BlcnRpZXMudmlldyk7XG4gIHRoaXMubm9kZSA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5lbGVtZW50ID0gcHJvcGVydGllcy5ub2RlO1xuICB0aGlzLm5hbWUgPSBwcm9wZXJ0aWVzLm5hbWU7XG4gIHRoaXMubWF0Y2ggPSBwcm9wZXJ0aWVzLm1hdGNoO1xuICB0aGlzLmV4cHJlc3Npb24gPSBwcm9wZXJ0aWVzLmV4cHJlc3Npb247XG4gIHRoaXMuZnJhZ21lbnRzID0gcHJvcGVydGllcy5mcmFnbWVudHM7XG4gIHRoaXMuY29udGV4dCA9IG51bGw7XG59XG5cbmV4dGVuZChCaW5kaW5nLCB7XG4gIC8qKlxuICAgKiBEZWZhdWx0IHByaW9yaXR5IGJpbmRlcnMgbWF5IG92ZXJyaWRlLlxuICAgKi9cbiAgcHJpb3JpdHk6IDAsXG5cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBhIGNsb25lZCBiaW5kaW5nLiBUaGlzIGhhcHBlbnMgYWZ0ZXIgYSBjb21waWxlZCBiaW5kaW5nIG9uIGEgdGVtcGxhdGUgaXMgY2xvbmVkIGZvciBhIHZpZXcuXG4gICAqL1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5leHByZXNzaW9uKSB7XG4gICAgICAvLyBBbiBvYnNlcnZlciB0byBvYnNlcnZlIHZhbHVlIGNoYW5nZXMgdG8gdGhlIGV4cHJlc3Npb24gd2l0aGluIGEgY29udGV4dFxuICAgICAgdGhpcy5vYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy51cGRhdGVkLCB0aGlzKTtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVkKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENsb25lIHRoaXMgYmluZGluZyBmb3IgYSB2aWV3LiBUaGUgZWxlbWVudC9ub2RlIHdpbGwgYmUgdXBkYXRlZCBhbmQgdGhlIGJpbmRpbmcgd2lsbCBiZSBpbml0ZWQuXG4gICAqL1xuICBjbG9uZUZvclZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IGNsb25lIGFnYWluc3QgYSB2aWV3Jyk7XG4gICAgfVxuXG4gICAgdmFyIG5vZGUgPSB2aWV3O1xuICAgIHRoaXMuX2VsZW1lbnRQYXRoLmZvckVhY2goZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkTm9kZXNbaW5kZXhdO1xuICAgIH0pO1xuXG4gICAgdmFyIGJpbmRpbmcgPSBPYmplY3QuY3JlYXRlKHRoaXMpO1xuICAgIGJpbmRpbmcuY2xvbmVkRnJvbSA9IHRoaXM7XG4gICAgYmluZGluZy5lbGVtZW50ID0gbm9kZTtcbiAgICBiaW5kaW5nLm5vZGUgPSBub2RlO1xuICAgIGJpbmRpbmcuaW5pdCgpO1xuICAgIHJldHVybiBiaW5kaW5nO1xuICB9LFxuXG5cbiAgLy8gQmluZCB0aGlzIHRvIHRoZSBnaXZlbiBjb250ZXh0IG9iamVjdFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikge1xuICAgICAgaWYgKHRoaXMudXBkYXRlZCAhPT0gQmluZGluZy5wcm90b3R5cGUudXBkYXRlZCkge1xuICAgICAgICB0aGlzLm9ic2VydmVyLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSB0cnVlO1xuICAgICAgICB0aGlzLm9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBzZXQgdGhlIGNvbnRleHQgYnV0IGRvbid0IGFjdHVhbGx5IGJpbmQgaXQgc2luY2UgYHVwZGF0ZWRgIGlzIGEgbm8tb3BcbiAgICAgICAgdGhpcy5vYnNlcnZlci5jb250ZXh0ID0gY29udGV4dDtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5ib3VuZCgpO1xuICB9LFxuXG5cbiAgLy8gVW5iaW5kIHRoaXMgZnJvbSBpdHMgY29udGV4dFxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB0aGlzLm9ic2VydmVyLnVuYmluZCgpO1xuICAgIHRoaXMudW5ib3VuZCgpO1xuICB9LFxuXG5cbiAgLy8gQ2xlYW5zIHVwIGJpbmRpbmcgY29tcGxldGVseVxuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB7XG4gICAgICAvLyBUaGlzIHdpbGwgY2xlYXIgaXQgb3V0LCBudWxsaWZ5aW5nIGFueSBkYXRhIHN0b3JlZFxuICAgICAgdGhpcy5vYnNlcnZlci5zeW5jKCk7XG4gICAgfVxuICAgIHRoaXMuZGlzcG9zZWQoKTtcbiAgfSxcblxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY29tcGlsZWQgd2l0aGluIGEgdGVtcGxhdGVcbiAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjcmVhdGVkXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBleHByZXNzaW9uJ3MgdmFsdWUgY2hhbmdlc1xuICB1cGRhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBib3VuZFxuICBib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgdW5ib3VuZFxuICB1bmJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBkaXNwb3NlZFxuICBkaXNwb3NlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBIZWxwZXIgbWV0aG9kc1xuXG4gIGdldCBjYW1lbENhc2UoKSB7XG4gICAgcmV0dXJuICh0aGlzLm1hdGNoIHx8IHRoaXMubmFtZSB8fCAnJykucmVwbGFjZSgvLSsoXFx3KS9nLCBmdW5jdGlvbihfLCBjaGFyKSB7XG4gICAgICByZXR1cm4gY2hhci50b1VwcGVyQ2FzZSgpO1xuICAgIH0pO1xuICB9LFxuXG4gIG9ic2VydmU6IGZ1bmN0aW9uKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuT2JzZXJ2ZXIoZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCB8fCB0aGlzKTtcbiAgfVxufSk7XG5cblxuXG5cbnZhciBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2Y7XG5cbi8vIENyZWF0ZXMgYW4gYXJyYXkgb2YgaW5kZXhlcyB0byBoZWxwIGZpbmQgdGhlIHNhbWUgZWxlbWVudCB3aXRoaW4gYSBjbG9uZWQgdmlld1xuZnVuY3Rpb24gaW5pdE5vZGVQYXRoKG5vZGUsIHZpZXcpIHtcbiAgdmFyIHBhdGggPSBbXTtcbiAgd2hpbGUgKG5vZGUgIT09IHZpZXcpIHtcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHBhdGgudW5zaGlmdChpbmRleE9mLmNhbGwocGFyZW50LmNoaWxkTm9kZXMsIG5vZGUpKTtcbiAgICBub2RlID0gcGFyZW50O1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuIiwidmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xubW9kdWxlLmV4cG9ydHMgPSBjb21waWxlO1xuXG5cbi8vIFdhbGtzIHRoZSB0ZW1wbGF0ZSBET00gcmVwbGFjaW5nIGFueSBiaW5kaW5ncyBhbmQgY2FjaGluZyBiaW5kaW5ncyBvbnRvIHRoZSB0ZW1wbGF0ZSBvYmplY3QuXG5mdW5jdGlvbiBjb21waWxlKGZyYWdtZW50cywgdGVtcGxhdGUpIHtcbiAgdmFyIHdhbGtlciA9IGRvY3VtZW50LmNyZWF0ZVRyZWVXYWxrZXIodGVtcGxhdGUsIE5vZGVGaWx0ZXIuU0hPV19FTEVNRU5UIHwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICB2YXIgYmluZGluZ3MgPSBbXSwgY3VycmVudE5vZGUsIHBhcmVudE5vZGUsIHByZXZpb3VzTm9kZTtcblxuICAvLyBSZXNldCBmaXJzdCBub2RlIHRvIGVuc3VyZSBpdCBpc24ndCBhIGZyYWdtZW50XG4gIHdhbGtlci5uZXh0Tm9kZSgpO1xuICB3YWxrZXIucHJldmlvdXNOb2RlKCk7XG5cbiAgLy8gZmluZCBiaW5kaW5ncyBmb3IgZWFjaCBub2RlXG4gIGRvIHtcbiAgICBjdXJyZW50Tm9kZSA9IHdhbGtlci5jdXJyZW50Tm9kZTtcbiAgICBwYXJlbnROb2RlID0gY3VycmVudE5vZGUucGFyZW50Tm9kZTtcbiAgICBiaW5kaW5ncy5wdXNoLmFwcGx5KGJpbmRpbmdzLCBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBjdXJyZW50Tm9kZSwgdGVtcGxhdGUpKTtcblxuICAgIGlmIChjdXJyZW50Tm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnROb2RlKSB7XG4gICAgICAvLyBjdXJyZW50Tm9kZSB3YXMgcmVtb3ZlZCBhbmQgbWFkZSBhIHRlbXBsYXRlXG4gICAgICB3YWxrZXIuY3VycmVudE5vZGUgPSBwcmV2aW91c05vZGUgfHwgd2Fsa2VyLnJvb3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZXZpb3VzTm9kZSA9IGN1cnJlbnROb2RlO1xuICAgIH1cbiAgfSB3aGlsZSAod2Fsa2VyLm5leHROb2RlKCkpO1xuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG5cbi8vIEZpbmQgYWxsIHRoZSBiaW5kaW5ncyBvbiBhIGdpdmVuIG5vZGUgKHRleHQgbm9kZXMgd2lsbCBvbmx5IGV2ZXIgaGF2ZSBvbmUgYmluZGluZykuXG5mdW5jdGlvbiBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBub2RlLCB2aWV3KSB7XG4gIHZhciBiaW5kaW5ncyA9IFtdO1xuICB2YXIgQmluZGVyLCBiaW5kaW5nLCBleHByLCBib3VuZCwgbWF0Y2gsIGF0dHIsIGk7XG5cbiAgaWYgKG5vZGUubm9kZVR5cGUgPT09IE5vZGUuVEVYVF9OT0RFKSB7XG4gICAgc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIHRleHQgbm9kZVxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgndGV4dCcsIG5vZGUubm9kZVZhbHVlKSkge1xuICAgICAgZXhwciA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpO1xuICAgICAgbm9kZS5ub2RlVmFsdWUgPSAnJztcbiAgICAgIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCd0ZXh0JywgZXhwcik7XG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGV4cHJlc3Npb246IGV4cHIsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pO1xuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgdGhlIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00sIHN0b3AuIENoZWNrIGJ5IGxvb2tpbmcgYXQgaXRzIHBhcmVudE5vZGVcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHZhciBEZWZhdWx0QmluZGVyID0gZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcignX19kZWZhdWx0X18nKTtcblxuICAgIC8vIEZpbmQgYW55IGJpbmRpbmcgZm9yIHRoZSBlbGVtZW50XG4gICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2VsZW1lbnQnLCBub2RlLnRhZ05hbWUudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKEJpbmRlcikge1xuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KTtcbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgcmVtb3ZlZCwgbWFkZSBhIHRlbXBsYXRlLCBkb24ndCBjb250aW51ZSBwcm9jZXNzaW5nXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmluZCBhbmQgYWRkIGFueSBhdHRyaWJ1dGUgYmluZGluZ3Mgb24gYW4gZWxlbWVudC4gVGhlc2UgY2FuIGJlIGF0dHJpYnV0ZXMgd2hvc2UgbmFtZSBtYXRjaGVzIGEgYmluZGluZywgb3JcbiAgICAvLyB0aGV5IGNhbiBiZSBhdHRyaWJ1dGVzIHdoaWNoIGhhdmUgYSBiaW5kaW5nIGluIHRoZSB2YWx1ZSBzdWNoIGFzIGBocmVmPVwiL3Bvc3Qve3sgcG9zdC5pZCB9fVwiYC5cbiAgICB2YXIgYm91bmQgPSBbXTtcbiAgICB2YXIgYXR0cmlidXRlcyA9IHNsaWNlLmNhbGwobm9kZS5hdHRyaWJ1dGVzKTtcbiAgICBmb3IgKGkgPSAwLCBsID0gYXR0cmlidXRlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBhdHRyID0gYXR0cmlidXRlc1tpXTtcbiAgICAgIHZhciBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignYXR0cmlidXRlJywgYXR0ci5uYW1lLCBhdHRyLnZhbHVlKTtcbiAgICAgIGlmIChCaW5kZXIpIHtcbiAgICAgICAgYm91bmQucHVzaChbIEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYWtlIHN1cmUgdG8gY3JlYXRlIGFuZCBwcm9jZXNzIHRoZW0gaW4gdGhlIGNvcnJlY3QgcHJpb3JpdHkgb3JkZXIgc28gaWYgYSBiaW5kaW5nIGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gdGhlXG4gICAgLy8gbm9kZSBpdCBkb2Vzbid0IHByb2Nlc3MgdGhlIG90aGVycy5cbiAgICBib3VuZC5zb3J0KHNvcnRBdHRyaWJ1dGVzKTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBib3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIEJpbmRlciA9IGJvdW5kW2ldWzBdO1xuICAgICAgdmFyIGF0dHIgPSBib3VuZFtpXVsxXTtcbiAgICAgIHZhciBuYW1lID0gYXR0ci5uYW1lO1xuICAgICAgdmFyIHZhbHVlID0gYXR0ci52YWx1ZTtcbiAgICAgIGlmIChCaW5kZXIuZXhwcikge1xuICAgICAgICBtYXRjaCA9IG5hbWUubWF0Y2goQmluZGVyLmV4cHIpO1xuICAgICAgICBpZiAobWF0Y2gpIG1hdGNoID0gbWF0Y2hbMV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtYXRjaCA9IG51bGw7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlTm9kZShhdHRyKTtcbiAgICAgIH0gY2F0Y2goZSkge31cblxuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoe1xuICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICB2aWV3OiB2aWV3LFxuICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICBtYXRjaDogbWF0Y2gsXG4gICAgICAgIGV4cHJlc3Npb246IHZhbHVlID8gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIHZhbHVlKSA6IG51bGwsXG4gICAgICAgIGZyYWdtZW50czogZnJhZ21lbnRzXG4gICAgICB9KTtcblxuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH0gZWxzZSBpZiAoQmluZGVyICE9PSBEZWZhdWx0QmluZGVyICYmIGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCB2YWx1ZSkpIHtcbiAgICAgICAgLy8gUmV2ZXJ0IHRvIGRlZmF1bHQgaWYgdGhpcyBiaW5kaW5nIGRvZXNuJ3QgdGFrZVxuICAgICAgICBib3VuZC5wdXNoKFsgRGVmYXVsdEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG4vLyBTcGxpdHMgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW0gc28gdGhleSBjYW4gYmUgYm91bmQgaW5kaXZpZHVhbGx5LCBoYXMgcGFyZW50Tm9kZSBwYXNzZWQgaW4gc2luY2UgaXQgbWF5XG4vLyBiZSBhIGRvY3VtZW50IGZyYWdtZW50IHdoaWNoIGFwcGVhcnMgYXMgbnVsbCBvbiBub2RlLnBhcmVudE5vZGUuXG5mdW5jdGlvbiBzcGxpdFRleHROb2RlKGZyYWdtZW50cywgbm9kZSkge1xuICBpZiAoIW5vZGUucHJvY2Vzc2VkKSB7XG4gICAgbm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgIHZhciByZWdleCA9IGZyYWdtZW50cy5iaW5kZXJzLnRleHQuX2V4cHI7XG4gICAgdmFyIGNvbnRlbnQgPSBub2RlLm5vZGVWYWx1ZTtcbiAgICBpZiAoY29udGVudC5tYXRjaChyZWdleCkpIHtcbiAgICAgIHZhciBtYXRjaCwgbGFzdEluZGV4ID0gMCwgcGFydHMgPSBbXSwgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICB3aGlsZSAobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSB7XG4gICAgICAgIHBhcnRzLnB1c2goY29udGVudC5zbGljZShsYXN0SW5kZXgsIHJlZ2V4Lmxhc3RJbmRleCAtIG1hdGNoWzBdLmxlbmd0aCkpO1xuICAgICAgICBwYXJ0cy5wdXNoKG1hdGNoWzBdKTtcbiAgICAgICAgbGFzdEluZGV4ID0gcmVnZXgubGFzdEluZGV4O1xuICAgICAgfVxuICAgICAgcGFydHMucHVzaChjb250ZW50LnNsaWNlKGxhc3RJbmRleCkpO1xuICAgICAgcGFydHMgPSBwYXJ0cy5maWx0ZXIobm90RW1wdHkpO1xuXG4gICAgICBub2RlLm5vZGVWYWx1ZSA9IHBhcnRzWzBdO1xuICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgbmV3VGV4dE5vZGUgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShwYXJ0c1tpXSk7XG4gICAgICAgIG5ld1RleHROb2RlLnByb2Nlc3NlZCA9IHRydWU7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5ld1RleHROb2RlKTtcbiAgICAgIH1cbiAgICAgIG5vZGUucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5vZGUubmV4dFNpYmxpbmcpO1xuICAgIH1cbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHNvcnRBdHRyaWJ1dGVzKGEsIGIpIHtcbiAgcmV0dXJuIGJbMF0ucHJvdG90eXBlLnByaW9yaXR5IC0gYVswXS5wcm90b3R5cGUucHJpb3JpdHk7XG59XG5cbmZ1bmN0aW9uIG5vdEVtcHR5KHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gRnJhZ21lbnRzO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcbnZhciB0b0ZyYWdtZW50ID0gcmVxdWlyZSgnLi91dGlsL3RvRnJhZ21lbnQnKTtcbnZhciBhbmltYXRpb24gPSByZXF1aXJlKCcuL3V0aWwvYW5pbWF0aW9uJyk7XG52YXIgVGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIEJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKTtcbnZhciBBbmltYXRlZEJpbmRpbmcgPSByZXF1aXJlKCcuL2FuaW1hdGVkQmluZGluZycpO1xudmFyIGNvbXBpbGUgPSByZXF1aXJlKCcuL2NvbXBpbGUnKTtcbnZhciByZWdpc3RlckRlZmF1bHRCaW5kZXJzID0gcmVxdWlyZSgnLi9yZWdpc3RlcmVkL2JpbmRlcnMnKTtcbnZhciByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzID0gcmVxdWlyZSgnLi9yZWdpc3RlcmVkL2Zvcm1hdHRlcnMnKTtcbnZhciByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zID0gcmVxdWlyZSgnLi9yZWdpc3RlcmVkL2FuaW1hdGlvbnMnKTtcblxuLyoqXG4gKiBBIEZyYWdtZW50cyBvYmplY3Qgc2VydmVzIGFzIGEgcmVnaXN0cnkgZm9yIGJpbmRlcnMgYW5kIGZvcm1hdHRlcnNcbiAqIEBwYXJhbSB7W3R5cGVdfSBPYnNlcnZlckNsYXNzIFtkZXNjcmlwdGlvbl1cbiAqL1xuZnVuY3Rpb24gRnJhZ21lbnRzKE9ic2VydmVyQ2xhc3MpIHtcbiAgaWYgKCFPYnNlcnZlckNsYXNzKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTXVzdCBwcm92aWRlIGFuIE9ic2VydmVyIGNsYXNzIHRvIEZyYWdtZW50cy4nKTtcbiAgfVxuXG4gIHRoaXMuT2JzZXJ2ZXIgPSBPYnNlcnZlckNsYXNzO1xuICB0aGlzLmZvcm1hdHRlcnMgPSBPYnNlcnZlckNsYXNzLmZvcm1hdHRlcnMgPSB7fTtcbiAgdGhpcy5hbmltYXRpb25zID0ge307XG4gIHRoaXMuYW5pbWF0ZUF0dHJpYnV0ZSA9ICdhbmltYXRlJztcblxuICB0aGlzLmJpbmRlcnMgPSB7XG4gICAgZWxlbWVudDogeyBfd2lsZGNhcmRzOiBbXSB9LFxuICAgIGF0dHJpYnV0ZTogeyBfd2lsZGNhcmRzOiBbXSwgX2V4cHI6IC97e1xccyooLio/KVxccyp9fS9nIH0sXG4gICAgdGV4dDogeyBfd2lsZGNhcmRzOiBbXSwgX2V4cHI6IC97e1xccyooLio/KVxccyp9fS9nIH1cbiAgfTtcblxuICAvLyBUZXh0IGJpbmRlciBmb3IgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlclRleHQoJ19fZGVmYXVsdF9fJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSAodmFsdWUgIT0gbnVsbCkgPyB2YWx1ZSA6ICcnO1xuICB9KTtcblxuICAvLyBDYXRjaGFsbCBhdHRyaWJ1dGUgYmluZGVyIGZvciByZWd1bGFyIGF0dHJpYnV0ZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtXG4gIHRoaXMucmVnaXN0ZXJBdHRyaWJ1dGUoJ19fZGVmYXVsdF9fJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZSh0aGlzLm5hbWUsIHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSh0aGlzLm5hbWUpO1xuICAgIH1cbiAgfSk7XG5cbiAgcmVnaXN0ZXJEZWZhdWx0QmluZGVycyh0aGlzKTtcbiAgcmVnaXN0ZXJEZWZhdWx0Rm9ybWF0dGVycyh0aGlzKTtcbiAgcmVnaXN0ZXJEZWZhdWx0QW5pbWF0aW9ucyh0aGlzKTtcbn1cblxuRnJhZ21lbnRzLnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogVGFrZXMgYW4gSFRNTCBzdHJpbmcsIGFuIGVsZW1lbnQsIGFuIGFycmF5IG9mIGVsZW1lbnRzLCBvciBhIGRvY3VtZW50IGZyYWdtZW50LCBhbmQgY29tcGlsZXMgaXQgaW50byBhIHRlbXBsYXRlLlxuICAgKiBJbnN0YW5jZXMgbWF5IHRoZW4gYmUgY3JlYXRlZCBhbmQgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1N0cmluZ3xOb2RlTGlzdHxIVE1MQ29sbGVjdGlvbnxIVE1MVGVtcGxhdGVFbGVtZW50fEhUTUxTY3JpcHRFbGVtZW50fE5vZGV9IGh0bWwgQSBUZW1wbGF0ZSBjYW4gYmUgY3JlYXRlZFxuICAgKiBmcm9tIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIG9iamVjdHMuIEFueSBvZiB0aGVzZSB3aWxsIGJlIGNvbnZlcnRlZCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQgZm9yIHRoZSB0ZW1wbGF0ZSB0b1xuICAgKiBjbG9uZS4gTm9kZXMgYW5kIGVsZW1lbnRzIHBhc3NlZCBpbiB3aWxsIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLlxuICAgKi9cbiAgY3JlYXRlVGVtcGxhdGU6IGZ1bmN0aW9uKGh0bWwpIHtcbiAgICB2YXIgZnJhZ21lbnQgPSB0b0ZyYWdtZW50KGh0bWwpO1xuICAgIGlmIChmcmFnbWVudC5jaGlsZE5vZGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgY3JlYXRlIGEgdGVtcGxhdGUgZnJvbSAnICsgaHRtbCk7XG4gICAgfVxuICAgIHZhciB0ZW1wbGF0ZSA9IGV4dGVuZC5tYWtlKFRlbXBsYXRlLCBmcmFnbWVudCk7XG4gICAgdGVtcGxhdGUuYmluZGluZ3MgPSBjb21waWxlKHRoaXMsIHRlbXBsYXRlKTtcbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYmluZGluZ3Mgb24gYW4gZWxlbWVudC5cbiAgICovXG4gIGNvbXBpbGVFbGVtZW50OiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgaWYgKCFlbGVtZW50LmJpbmRpbmdzKSB7XG4gICAgICBlbGVtZW50LmJpbmRpbmdzID0gY29tcGlsZSh0aGlzLCBlbGVtZW50KTtcbiAgICAgIGV4dGVuZC5tYWtlKFZpZXcsIGVsZW1lbnQsIGVsZW1lbnQpO1xuICAgIH1cblxuICAgIHJldHVybiBlbGVtZW50O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbXBpbGVzIGFuZCBiaW5kcyBhbiBlbGVtZW50IHdoaWNoIHdhcyBub3QgY3JlYXRlZCBmcm9tIGEgdGVtcGxhdGUuIE1vc3RseSBvbmx5IHVzZWQgZm9yIGJpbmRpbmcgdGhlIGRvY3VtZW50J3NcbiAgICogaHRtbCBlbGVtZW50LlxuICAgKi9cbiAgYmluZEVsZW1lbnQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGNvbnRleHQpIHtcbiAgICB0aGlzLmNvbXBpbGVFbGVtZW50KGVsZW1lbnQpO1xuXG4gICAgaWYgKGNvbnRleHQpIHtcbiAgICAgIGVsZW1lbnQuYmluZChjb250ZXh0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZWxlbWVudDtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBiaW5kZXIgZm9yIGEgZ2l2ZW4gdHlwZSBhbmQgbmFtZS4gQSBiaW5kZXIgaXMgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIGFuZCBpcyB1c2VkIHRvIGNyZWF0ZSBiaW5kaW5ncyBvblxuICAgKiBhbiBlbGVtZW50IG9yIHRleHQgbm9kZSB3aG9zZSB0YWcgbmFtZSwgYXR0cmlidXRlIG5hbWUsIG9yIGV4cHJlc3Npb24gY29udGVudHMgbWF0Y2ggdGhpcyBiaW5kZXIncyBuYW1lL2V4cHJlc3Npb24uXG4gICAqXG4gICAqICMjIyBQYXJhbWV0ZXJzXG4gICAqXG4gICAqICAqIGB0eXBlYDogdGhlcmUgYXJlIHRocmVlIHR5cGVzIG9mIGJpbmRlcnM6IGVsZW1lbnQsIGF0dHJpYnV0ZSwgb3IgdGV4dC4gVGhlc2UgY29ycmVzcG9uZCB0byBtYXRjaGluZyBhZ2FpbnN0IGFuXG4gICAqICAgIGVsZW1lbnQncyB0YWcgbmFtZSwgYW4gZWxlbWVudCB3aXRoIHRoZSBnaXZlbiBhdHRyaWJ1dGUgbmFtZSwgb3IgYSB0ZXh0IG5vZGUgdGhhdCBtYXRjaGVzIHRoZSBwcm92aWRlZFxuICAgKiAgICBleHByZXNzaW9uLlxuICAgKlxuICAgKiAgKiBgbmFtZWA6IHRvIG1hdGNoLCBhIGJpbmRlciBuZWVkcyB0aGUgbmFtZSBvZiBhbiBlbGVtZW50IG9yIGF0dHJpYnV0ZSwgb3IgYSByZWd1bGFyIGV4cHJlc3Npb24gdGhhdCBtYXRjaGVzIGFcbiAgICogICAgZ2l2ZW4gdGV4dCBub2RlLiBOYW1lcyBmb3IgZWxlbWVudHMgYW5kIGF0dHJpYnV0ZXMgY2FuIGJlIHJlZ3VsYXIgZXhwcmVzc2lvbnMgYXMgd2VsbCwgb3IgdGhleSBtYXkgYmUgd2lsZGNhcmRcbiAgICogICAgbmFtZXMgYnkgdXNpbmcgYW4gYXN0ZXJpc2suXG4gICAqXG4gICAqICAqIGBkZWZpbml0aW9uYDogYSBiaW5kZXIgaXMgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIHdoaWNoIG92ZXJyaWRlcyBrZXkgbWV0aG9kcywgYGNvbXBpbGVkYCwgYGNyZWF0ZWRgLCBgdXBkYXRlZGAsXG4gICAqICAgIGBib3VuZGAsIGFuZCBgdW5ib3VuZGAuIFRoZSBkZWZpbml0aW9uIG1heSBiZSBhbiBhY3R1YWwgc3ViY2xhc3Mgb2YgQmluZGluZyBvciBpdCBtYXkgYmUgYW4gb2JqZWN0IHdoaWNoIHdpbGwgYmVcbiAgICogICAgdXNlZCBmb3IgdGhlIHByb3RvdHlwZSBvZiB0aGUgbmV3bHkgY3JlYXRlZCBzdWJjbGFzcy4gRm9yIG1hbnkgYmluZGluZ3Mgb25seSB0aGUgYHVwZGF0ZWRgIG1ldGhvZCBpcyBvdmVycmlkZGVuLFxuICAgKiAgICBzbyBieSBqdXN0IHBhc3NpbmcgaW4gYSBmdW5jdGlvbiBmb3IgYGRlZmluaXRpb25gIHRoZSBiaW5kZXIgd2lsbCBiZSBjcmVhdGVkIHdpdGggdGhhdCBhcyBpdHMgYHVwZGF0ZWRgIG1ldGhvZC5cbiAgICpcbiAgICogIyMjIEV4cGxhaW5hdGlvbiBvZiBwcm9wZXJ0aWVzIGFuZCBtZXRob2RzXG4gICAqXG4gICAqICAgKiBgcHJpb3JpdHlgIG1heSBiZSBkZWZpbmVkIGFzIG51bWJlciB0byBpbnN0cnVjdCBzb21lIGJpbmRlcnMgdG8gYmUgcHJvY2Vzc2VkIGJlZm9yZSBvdGhlcnMuIEJpbmRlcnMgd2l0aFxuICAgKiAgIGhpZ2hlciBwcmlvcml0eSBhcmUgcHJvY2Vzc2VkIGZpcnN0LlxuICAgKlxuICAgKiAgICogYGFuaW1hdGVkYCBjYW4gYmUgc2V0IHRvIGB0cnVlYCB0byBleHRlbmQgdGhlIEFuaW1hdGVkQmluZGluZyBjbGFzcyB3aGljaCBwcm92aWRlcyBzdXBwb3J0IGZvciBhbmltYXRpb24gd2hlblxuICAgKiAgIGluc2VydGluZ2FuZCByZW1vdmluZyBub2RlcyBmcm9tIHRoZSBET00uIFRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IG9ubHkgKmFsbG93cyogYW5pbWF0aW9uIGJ1dCB0aGUgZWxlbWVudCBtdXN0XG4gICAqICAgaGF2ZSB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSB0byB1c2UgYW5pbWF0aW9uLiBBIGJpbmRpbmcgd2lsbCBoYXZlIHRoZSBgYW5pbWF0ZWAgcHJvcGVydHkgc2V0IHRvIHRydWUgd2hlbiBpdCBpc1xuICAgKiAgIHRvIGJlIGFuaW1hdGVkLiBCaW5kZXJzIHNob3VsZCBoYXZlIGZhc3QgcGF0aHMgZm9yIHdoZW4gYW5pbWF0aW9uIGlzIG5vdCB1c2VkIHJhdGhlciB0aGFuIGFzc3VtaW5nIGFuaW1hdGlvbiB3aWxsXG4gICAqICAgYmUgdXNlZC5cbiAgICpcbiAgICogQmluZGVyc1xuICAgKlxuICAgKiBBIGJpbmRlciBjYW4gaGF2ZSA1IG1ldGhvZHMgd2hpY2ggd2lsbCBiZSBjYWxsZWQgYXQgdmFyaW91cyBwb2ludHMgaW4gYSBiaW5kaW5nJ3MgbGlmZWN5Y2xlLiBNYW55IGJpbmRlcnMgd2lsbFxuICAgKiBvbmx5IHVzZSB0aGUgYHVwZGF0ZWQodmFsdWUpYCBtZXRob2QsIHNvIGNhbGxpbmcgcmVnaXN0ZXIgd2l0aCBhIGZ1bmN0aW9uIGluc3RlYWQgb2YgYW4gb2JqZWN0IGFzIGl0cyB0aGlyZFxuICAgKiBwYXJhbWV0ZXIgaXMgYSBzaG9ydGN1dCB0byBjcmVhdGluZyBhIGJpbmRlciB3aXRoIGp1c3QgYW4gYHVwZGF0ZWAgbWV0aG9kLlxuICAgKlxuICAgKiBMaXN0ZWQgaW4gb3JkZXIgb2Ygd2hlbiB0aGV5IG9jY3VyIGluIGEgYmluZGluZydzIGxpZmVjeWNsZTpcbiAgICpcbiAgICogICAqIGBjb21waWxlZChvcHRpb25zKWAgaXMgY2FsbGVkIHdoZW4gZmlyc3QgY3JlYXRpbmcgYSBiaW5kaW5nIGR1cmluZyB0aGUgdGVtcGxhdGUgY29tcGlsYXRpb24gcHJvY2VzcyBhbmQgcmVjZWl2ZXNcbiAgICogdGhlIGBvcHRpb25zYCBvYmplY3QgdGhhdCB3aWxsIGJlIHBhc3NlZCBpbnRvIGBuZXcgQmluZGluZyhvcHRpb25zKWAuIFRoaXMgY2FuIGJlIHVzZWQgZm9yIGNyZWF0aW5nIHRlbXBsYXRlcyxcbiAgICogbW9kaWZ5aW5nIHRoZSBET00gKG9ubHkgc3Vic2VxdWVudCBET00gdGhhdCBoYXNuJ3QgYWxyZWFkeSBiZWVuIHByb2Nlc3NlZCkgYW5kIG90aGVyIHRoaW5ncyB0aGF0IHNob3VsZCBiZVxuICAgKiBhcHBsaWVkIGF0IGNvbXBpbGUgdGltZSBhbmQgbm90IGR1cGxpY2F0ZWQgZm9yIGVhY2ggdmlldyBjcmVhdGVkLlxuICAgKlxuICAgKiAgICogYGNyZWF0ZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gYSBuZXcgdmlldyBpcyBjcmVhdGVkLiBUaGlzIGNhbiBiZSB1c2VkIHRvIGFkZCBldmVudCBsaXN0ZW5lcnMgb24gdGhlXG4gICAqIGVsZW1lbnQgb3IgZG8gb3RoZXIgdGhpbmdzIHRoYXQgd2lsbCBwZXJzaXN0ZSB3aXRoIHRoZSB2aWV3IHRocm91Z2ggaXRzIG1hbnkgdXNlcy4gVmlld3MgbWF5IGdldCByZXVzZWQgc28gZG9uJ3RcbiAgICogZG8gYW55dGhpbmcgaGVyZSB0byB0aWUgaXQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICAgKlxuICAgKiAgICogYGF0dGFjaGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIHRoZSB2aWV3IGlzIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dCBhbmQgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBUaGlzXG4gICAqIGNhbiBiZSB1c2VkIHRvIGhhbmRsZSBjb250ZXh0LXNwZWNpZmljIGFjdGlvbnMsIGFkZCBsaXN0ZW5lcnMgdG8gdGhlIHdpbmRvdyBvciBkb2N1bWVudCAodG8gYmUgcmVtb3ZlZCBpblxuICAgKiBgZGV0YWNoZWRgISksIGV0Yy5cbiAgICpcbiAgICogICAqIGB1cGRhdGVkKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlUmVjb3JkcylgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuZXZlciB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gd2l0aGluXG4gICAqIHRoZSBhdHRyaWJ1dGUgY2hhbmdlcy4gRm9yIGV4YW1wbGUsIGBiaW5kLXRleHQ9XCJ7e3VzZXJuYW1lfX1cImAgd2lsbCB0cmlnZ2VyIGB1cGRhdGVkYCB3aXRoIHRoZSB2YWx1ZSBvZiB1c2VybmFtZVxuICAgKiB3aGVuZXZlciBpdCBjaGFuZ2VzIG9uIHRoZSBnaXZlbiBjb250ZXh0LiBXaGVuIHRoZSB2aWV3IGlzIHJlbW92ZWQgYHVwZGF0ZWRgIHdpbGwgYmUgdHJpZ2dlcmVkIHdpdGggYSB2YWx1ZSBvZlxuICAgKiBgdW5kZWZpbmVkYCBpZiB0aGUgdmFsdWUgd2FzIG5vdCBhbHJlYWR5IGB1bmRlZmluZWRgLCBnaXZpbmcgYSBjaGFuY2UgdG8gXCJyZXNldFwiIHRvIGFuIGVtcHR5IHN0YXRlLlxuICAgKlxuICAgKiAgICogYGRldGFjaGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIHRoZSB2aWV3IGlzIHVuYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0IGFuZCByZW1vdmVkIGZyb20gdGhlIERPTS4gVGhpc1xuICAgKiBjYW4gYmUgdXNlZCB0byBjbGVhbiB1cCBhbnl0aGluZyBkb25lIGluIGBhdHRhY2hlZCgpYCBvciBpbiBgdXBkYXRlZCgpYCBiZWZvcmUgYmVpbmcgcmVtb3ZlZC5cbiAgICpcbiAgICogRWxlbWVudCBhbmQgYXR0cmlidXRlIGJpbmRlcnMgd2lsbCBhcHBseSB3aGVuZXZlciB0aGUgdGFnIG5hbWUgb3IgYXR0cmlidXRlIG5hbWUgaXMgbWF0Y2hlZC4gSW4gdGhlIGNhc2Ugb2ZcbiAgICogYXR0cmlidXRlIGJpbmRlcnMgaWYgeW91IG9ubHkgd2FudCBpdCB0byBtYXRjaCB3aGVuIGV4cHJlc3Npb25zIGFyZSB1c2VkIHdpdGhpbiB0aGUgYXR0cmlidXRlLCBhZGQgYG9ubHlXaGVuQm91bmRgXG4gICAqIHRvIHRoZSBkZWZpbml0aW9uLiBPdGhlcndpc2UgdGhlIGJpbmRlciB3aWxsIG1hdGNoIGFuZCB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gd2lsbCBzaW1wbHkgYmUgYSBzdHJpbmcgdGhhdFxuICAgKiBvbmx5IGNhbGxzIHVwZGF0ZWQgb25jZSBzaW5jZSBpdCB3aWxsIG5vdCBjaGFuZ2UuXG4gICAqXG4gICAqIE5vdGUsIGF0dHJpYnV0ZXMgd2hpY2ggbWF0Y2ggYSBiaW5kZXIgYXJlIHJlbW92ZWQgZHVyaW5nIGNvbXBpbGUuIFRoZXkgYXJlIGNvbnNpZGVyZWQgdG8gYmUgYmluZGluZyBkZWZpbml0aW9ucyBhbmRcbiAgICogbm90IHBhcnQgb2YgdGhlIGVsZW1lbnQuIEJpbmRpbmdzIG1heSBzZXQgdGhlIGF0dHJpYnV0ZSB3aGljaCBzZXJ2ZWQgYXMgdGhlaXIgZGVmaW5pdGlvbiBpZiBkZXNpcmVkLlxuICAgKlxuICAgKiAjIyMgRGVmYXVsdHNcbiAgICpcbiAgICogVGhlcmUgYXJlIGRlZmF1bHQgYmluZGVycyBmb3IgYXR0cmlidXRlIGFuZCB0ZXh0IG5vZGVzIHdoaWNoIGFwcGx5IHdoZW4gbm8gb3RoZXIgYmluZGVycyBtYXRjaC4gVGhleSBvbmx5IGFwcGx5IHRvXG4gICAqIGF0dHJpYnV0ZXMgYW5kIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtIChlLmcuIGB7e2Zvb319YCkuIFRoZSBkZWZhdWx0IGlzIHRvIHNldCB0aGUgYXR0cmlidXRlIG9yIHRleHRcbiAgICogbm9kZSdzIHZhbHVlIHRvIHRoZSByZXN1bHQgb2YgdGhlIGV4cHJlc3Npb24uIElmIHlvdSB3YW50ZWQgdG8gb3ZlcnJpZGUgdGhpcyBkZWZhdWx0IHlvdSBtYXkgcmVnaXN0ZXIgYSBiaW5kZXIgd2l0aFxuICAgKiB0aGUgbmFtZSBgXCJfX2RlZmF1bHRfX1wiYC5cbiAgICpcbiAgICogKipFeGFtcGxlOioqIFRoaXMgYmluZGluZyBoYW5kbGVyIGFkZHMgcGlyYXRlaXplZCB0ZXh0IHRvIGFuIGVsZW1lbnQuXG4gICAqIGBgYGphdmFzY3JpcHRcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJBdHRyaWJ1dGUoJ215LXBpcmF0ZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHtcbiAgICogICAgIHZhbHVlID0gJyc7XG4gICAqICAgfSBlbHNlIHtcbiAgICogICAgIHZhbHVlID0gdmFsdWVcbiAgICogICAgICAgLnJlcGxhY2UoL1xcQmluZ1xcYi9nLCBcImluJ1wiKVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxidG9cXGIvZywgXCJ0J1wiKVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxieW91XFxiLywgJ3llJylcbiAgICogICAgICAgKyAnIEFycnJyISc7XG4gICAqICAgfVxuICAgKiAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9IHZhbHVlO1xuICAgKiB9KTtcbiAgICogYGBgXG4gICAqXG4gICAqIGBgYGh0bWxcbiAgICogPHAgbXktcGlyYXRlPVwie3twb3N0LmJvZHl9fVwiPlRoaXMgdGV4dCB3aWxsIGJlIHJlcGxhY2VkLjwvcD5cbiAgICogYGBgXG4gICAqL1xuICByZWdpc3RlckVsZW1lbnQ6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlckF0dHJpYnV0ZTogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ3RleHQnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICB2YXIgYmluZGVyLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdXG4gICAgdmFyIHN1cGVyQ2xhc3MgPSBkZWZpbml0aW9uLmFuaW1hdGVkID8gQW5pbWF0ZWRCaW5kaW5nIDogQmluZGluZztcblxuICAgIGlmICghYmluZGVycykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYHR5cGVgIG11c3QgYmUgb25lIG9mICcgKyBPYmplY3Qua2V5cyh0aGlzLmJpbmRlcnMpLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZGVmaW5pdGlvbiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGRlZmluaXRpb24ucHJvdG90eXBlIGluc3RhbmNlb2YgQmluZGluZykge1xuICAgICAgICBzdXBlckNsYXNzID0gZGVmaW5pdGlvbjtcbiAgICAgICAgZGVmaW5pdGlvbiA9IHt9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVmaW5pdGlvbiA9IHsgdXBkYXRlZDogZGVmaW5pdGlvbiB9O1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIENyZWF0ZSBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgKG9yIGFub3RoZXIgYmluZGVyKSB3aXRoIHRoZSBkZWZpbml0aW9uXG4gICAgZnVuY3Rpb24gQmluZGVyKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgICBkZWZpbml0aW9uLk9ic2VydmVyID0gdGhpcy5PYnNlcnZlcjtcbiAgICBzdXBlckNsYXNzLmV4dGVuZChCaW5kZXIsIGRlZmluaXRpb24pO1xuXG4gICAgdmFyIGV4cHI7XG4gICAgaWYgKG5hbWUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGV4cHIgPSBuYW1lO1xuICAgIH0gZWxzZSBpZiAobmFtZS5pbmRleE9mKCcqJykgPj0gMCkge1xuICAgICAgZXhwciA9IG5ldyBSZWdFeHAoJ14nICsgZXNjYXBlUmVnRXhwKG5hbWUpLnJlcGxhY2UoJ1xcXFwqJywgJyguKiknKSArICckJyk7XG4gICAgfVxuXG4gICAgaWYgKGV4cHIpIHtcbiAgICAgIEJpbmRlci5leHByID0gZXhwcjtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5wdXNoKEJpbmRlcik7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMuc29ydCh0aGlzLmJpbmRpbmdTb3J0KTtcbiAgICB9XG5cbiAgICBCaW5kZXIubmFtZSA9ICcnICsgbmFtZTtcbiAgICBiaW5kZXJzW25hbWVdID0gQmluZGVyO1xuICAgIHJldHVybiBCaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIGJpbmRlciB0aGF0IHdhcyBhZGRlZCB3aXRoIGByZWdpc3RlcigpYC4gSWYgYW4gUmVnRXhwIHdhcyB1c2VkIGluIHJlZ2lzdGVyIGZvciB0aGUgbmFtZSBpdCBtdXN0IGJlIHVzZWRcbiAgICogdG8gdW5yZWdpc3RlciwgYnV0IGl0IGRvZXMgbm90IG5lZWQgdG8gYmUgdGhlIHNhbWUgaW5zdGFuY2UuXG4gICAqL1xuICB1bnJlZ2lzdGVyRWxlbWVudDogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlckF0dHJpYnV0ZTogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyVGV4dDogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ3RleHQnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlckJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSkge1xuICAgIHZhciBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCBuYW1lKSwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcbiAgICBpZiAoIWJpbmRlcikgcmV0dXJuO1xuICAgIGlmIChiaW5kZXIuZXhwcikge1xuICAgICAgdmFyIGluZGV4ID0gYmluZGVycy5fd2lsZGNhcmRzLmluZGV4T2YoYmluZGVyKTtcbiAgICAgIGlmIChpbmRleCA+PSAwKSBiaW5kZXJzLl93aWxkY2FyZHMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gICAgZGVsZXRlIGJpbmRlcnNbbmFtZV07XG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgIGJ5IHR5cGUgYW5kIG5hbWUuXG4gICAqL1xuICBnZXRFbGVtZW50QmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdlbGVtZW50JywgbmFtZSk7XG4gIH0sXG4gIGdldEF0dHJpYnV0ZUJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIGdldFRleHRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ3RleHQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAobmFtZSAmJiBiaW5kZXJzLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICByZXR1cm4gYmluZGVyc1tuYW1lXTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogRmluZCBhIG1hdGNoaW5nIGJpbmRlciBmb3IgdGhlIGdpdmVuIHR5cGUuIEVsZW1lbnRzIHNob3VsZCBvbmx5IHByb3ZpZGUgbmFtZS4gQXR0cmlidXRlcyBzaG91bGQgcHJvdmlkZSB0aGUgbmFtZVxuICAgKiBhbmQgdmFsdWUgKHZhbHVlIHNvIHRoZSBkZWZhdWx0IGNhbiBiZSByZXR1cm5lZCBpZiBhbiBleHByZXNzaW9uIGV4aXN0cyBpbiB0aGUgdmFsdWUpLiBUZXh0IG5vZGVzIHNob3VsZCBvbmx5XG4gICAqIHByb3ZpZGUgdGhlIHZhbHVlIChpbiBwbGFjZSBvZiB0aGUgbmFtZSkgYW5kIHdpbGwgcmV0dXJuIHRoZSBkZWZhdWx0IGlmIG5vIGJpbmRlcnMgbWF0Y2guXG4gICAqL1xuICBmaW5kQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlID09PSAndGV4dCcgJiYgdmFsdWUgPT0gbnVsbCkge1xuICAgICAgdmFsdWUgPSBuYW1lO1xuICAgICAgbmFtZSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuXG4gICAgaWYgKCFiaW5kZXIpIHtcbiAgICAgIHZhciB0b01hdGNoID0gKHR5cGUgPT09ICd0ZXh0JykgPyB2YWx1ZSA6IG5hbWU7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMuc29tZShmdW5jdGlvbih3aWxkY2FyZEJpbmRlcikge1xuICAgICAgICBpZiAodG9NYXRjaC5tYXRjaCh3aWxkY2FyZEJpbmRlci5leHByKSkge1xuICAgICAgICAgIGJpbmRlciA9IHdpbGRjYXJkQmluZGVyO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmluZGVyICYmIHR5cGUgPT09ICdhdHRyaWJ1dGUnICYmIGJpbmRlci5vbmx5V2hlbkJvdW5kICYmICF0aGlzLmlzQm91bmQodHlwZSwgdmFsdWUpKSB7XG4gICAgICAvLyBkb24ndCB1c2UgdGhlIGB2YWx1ZWAgYmluZGVyIGlmIHRoZXJlIGlzIG5vIGV4cHJlc3Npb24gaW4gdGhlIGF0dHJpYnV0ZSB2YWx1ZSAoZS5nLiBgdmFsdWU9XCJzb21lIHRleHRcImApXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgPT09IHRoaXMuYW5pbWF0ZUF0dHJpYnV0ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghYmluZGVyICYmIHZhbHVlICYmICh0eXBlID09PSAndGV4dCcgfHwgdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkpIHtcbiAgICAgIC8vIFRlc3QgaWYgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyBib3VuZCAoZS5nLiBgaHJlZj1cIi9wb3N0cy97eyBwb3N0LmlkIH19XCJgKVxuICAgICAgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgJ19fZGVmYXVsdF9fJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBIEZvcm1hdHRlciBpcyBzdG9yZWQgdG8gcHJvY2VzcyB0aGUgdmFsdWUgb2YgYW4gZXhwcmVzc2lvbi4gVGhpcyBhbHRlcnMgdGhlIHZhbHVlIG9mIHdoYXQgY29tZXMgaW4gd2l0aCBhIGZ1bmN0aW9uXG4gICAqIHRoYXQgcmV0dXJucyBhIG5ldyB2YWx1ZS4gRm9ybWF0dGVycyBhcmUgYWRkZWQgYnkgdXNpbmcgYSBzaW5nbGUgcGlwZSBjaGFyYWN0ZXIgKGB8YCkgZm9sbG93ZWQgYnkgdGhlIG5hbWUgb2YgdGhlXG4gICAqIGZvcm1hdHRlci4gTXVsdGlwbGUgZm9ybWF0dGVycyBjYW4gYmUgdXNlZCBieSBjaGFpbmluZyBwaXBlcyB3aXRoIGZvcm1hdHRlciBuYW1lcy4gRm9ybWF0dGVycyBtYXkgYWxzbyBoYXZlXG4gICAqIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlbSBieSB1c2luZyB0aGUgY29sb24gdG8gc2VwYXJhdGUgYXJndW1lbnRzIGZyb20gdGhlIGZvcm1hdHRlciBuYW1lLiBUaGUgc2lnbmF0dXJlIG9mIGFcbiAgICogZm9ybWF0dGVyIHNob3VsZCBiZSBgZnVuY3Rpb24odmFsdWUsIGFyZ3MuLi4pYCB3aGVyZSBhcmdzIGFyZSBleHRyYSBwYXJhbWV0ZXJzIHBhc3NlZCBpbnRvIHRoZSBmb3JtYXR0ZXIgYWZ0ZXJcbiAgICogY29sb25zLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCd1cHBlcmNhc2UnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZS50b1VwcGVyY2FzZSgpXG4gICAqIH0pXG4gICAqXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdyZXBsYWNlJywgZnVuY3Rpb24odmFsdWUsIHJlcGxhY2UsIHdpdGgpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUucmVwbGFjZShyZXBsYWNlLCB3aXRoKVxuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxoMSBiaW5kLXRleHQ9XCJ0aXRsZSB8IHVwcGVyY2FzZSB8IHJlcGxhY2U6J0xFVFRFUic6J05VTUJFUidcIj48L2gxPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkdFVFRJTkcgVE8gS05PVyBBTEwgQUJPVVQgVEhFIE5VTUJFUiBBPC9oMT5cbiAgICogYGBgXG4gICAqIFRPRE86IG9sZCBkb2NzLCByZXdyaXRlLCB0aGVyZSBpcyBhbiBleHRyYSBhcmd1bWVudCBuYW1lZCBgc2V0dGVyYCB3aGljaCB3aWxsIGJlIHRydWUgd2hlbiB0aGUgZXhwcmVzc2lvbiBpcyBiZWluZyBcInNldFwiIGluc3RlYWQgb2YgXCJnZXRcIlxuICAgKiBBIGB2YWx1ZUZvcm1hdHRlcmAgaXMgbGlrZSBhIGZvcm1hdHRlciBidXQgdXNlZCBzcGVjaWZpY2FsbHkgd2l0aCB0aGUgYHZhbHVlYCBiaW5kaW5nIHNpbmNlIGl0IGlzIGEgdHdvLXdheSBiaW5kaW5nLiBXaGVuXG4gICAqIHRoZSB2YWx1ZSBvZiB0aGUgZWxlbWVudCBpcyBjaGFuZ2VkIGEgYHZhbHVlRm9ybWF0dGVyYCBjYW4gYWRqdXN0IHRoZSB2YWx1ZSBmcm9tIGEgc3RyaW5nIHRvIHRoZSBjb3JyZWN0IHZhbHVlIHR5cGUgZm9yXG4gICAqIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24uIFRoZSBzaWduYXR1cmUgZm9yIGEgYHZhbHVlRm9ybWF0dGVyYCBpbmNsdWRlcyB0aGUgY3VycmVudCB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvblxuICAgKiBiZWZvcmUgdGhlIG9wdGlvbmFsIGFyZ3VtZW50cyAoaWYgYW55KS4gVGhpcyBhbGxvd3MgZGF0ZXMgdG8gYmUgYWRqdXN0ZWQgYW5kIHBvc3NpYmxleSBvdGhlciB1c2VzLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdudW1lcmljJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAodmFsdWUgPT0gbnVsbCB8fCBpc05hTih2YWx1ZSkpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignZGF0ZS1ob3VyJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAoICEoY3VycmVudFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgKSByZXR1cm4gJydcbiAgICogICB2YXIgaG91cnMgPSB2YWx1ZS5nZXRIb3VycygpXG4gICAqICAgaWYgKGhvdXJzID49IDEyKSBob3VycyAtPSAxMlxuICAgKiAgIGlmIChob3VycyA9PSAwKSBob3VycyA9IDEyXG4gICAqICAgcmV0dXJuIGhvdXJzXG4gICAqIH0pXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPk51bWJlciBBdHRlbmRpbmc6PC9sYWJlbD5cbiAgICogPGlucHV0IHNpemU9XCI0XCIgYmluZC12YWx1ZT1cImV2ZW50LmF0dGVuZGVlQ291bnQgfCBudW1lcmljXCI+XG4gICAqIDxsYWJlbD5UaW1lOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1ob3VyXCI+IDpcbiAgICogPGlucHV0IHNpemU9XCIyXCIgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLW1pbnV0ZVwiPlxuICAgKiA8c2VsZWN0IGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1hbXBtXCI+XG4gICAqICAgPG9wdGlvbj5BTTwvb3B0aW9uPlxuICAgKiAgIDxvcHRpb24+UE08L29wdGlvbj5cbiAgICogPC9zZWxlY3Q+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lLCBmb3JtYXR0ZXIpIHtcbiAgICB0aGlzLmZvcm1hdHRlcnNbbmFtZV0gPSBmb3JtYXR0ZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBmb3JtYXR0ZXIuXG4gICAqL1xuICB1bnJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSwgZm9ybWF0dGVyKSB7XG4gICAgZGVsZXRlIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBmb3JtYXR0ZXIuXG4gICAqL1xuICBnZXRGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBbiBBbmltYXRpb24gaXMgc3RvcmVkIHRvIGhhbmRsZSBhbmltYXRpb25zLiBBIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGlzIGFuIG9iamVjdCAob3IgY2xhc3Mgd2hpY2ggaW5zdGFudGlhdGVzIGludG9cbiAgICogYW4gb2JqZWN0KSB3aXRoIHRoZSBtZXRob2RzOlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWBcbiAgICogICAqIGBkaWRBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgd2lsbEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZU91dChlbGVtZW50KWBcbiAgICpcbiAgICogQW5pbWF0aW9uIGlzIGluY2x1ZGVkIHdpdGggYmluZGVycyB3aGljaCBhcmUgcmVnaXN0ZXJlZCB3aXRoIHRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IHNldCB0byBgdHJ1ZWAgKHN1Y2ggYXMgYGlmYFxuICAgKiBhbmQgYHJlcGVhdGApLiBBbmltYXRpb25zIGFsbG93IGVsZW1lbnRzIHRvIGZhZGUgaW4sIGZhZGUgb3V0LCBzbGlkZSBkb3duLCBjb2xsYXBzZSwgbW92ZSBmcm9tIG9uZSBsb2NhdGlvbiBpbiBhXG4gICAqIGxpc3QgdG8gYW5vdGhlciwgYW5kIG1vcmUuXG4gICAqXG4gICAqIFRvIHVzZSBhbmltYXRpb24gYWRkIGFuIGF0dHJpYnV0ZSBuYW1lZCBgYW5pbWF0ZWAgb250byBhbiBlbGVtZW50IHdpdGggYSBzdXBwb3J0ZWQgYmluZGVyLlxuICAgKlxuICAgKiAjIyMgQ1NTIEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgZG9lcyBub3QgaGF2ZSBhIHZhbHVlIG9yIHRoZSB2YWx1ZSBpcyBhIGNsYXNzIG5hbWUgKGUuZy4gYGFuaW1hdGU9XCIubXktZmFkZVwiYCkgdGhlblxuICAgKiBmcmFnbWVudHMgd2lsbCB1c2UgYSBDU1MgdHJhbnNpdGlvbi9hbmltYXRpb24uIENsYXNzZXMgd2lsbCBiZSBhZGRlZCBhbmQgcmVtb3ZlZCB0byB0cmlnZ2VyIHRoZSBhbmltYXRpb24uXG4gICAqXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgYWRkZWQgcmlnaHQgYWZ0ZXIgYW4gZWxlbWVudCBpcyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXMgY2FuIGJlIHVzZWQgdG8gc2V0IHRoZVxuICAgKiAgICAgb3BhY2l0eSB0byBgMC4wYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1pbmAgaXMgd2hlbiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgcmVtb3ZlZC4gSXQgY2FuIGJlIHVzZWQgdG8gc2V0IG9wYWNpdHkgdG8gYDEuMGAgZm9yIGV4YW1wbGUuIFRoZVxuICAgKiAgICAgYGFuaW1hdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBvbiB0aGlzIGNsYXNzIGlmIHVzaW5nIGl0LiBUaGUgYHRyYW5zaXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgaGVyZS4gTm90ZSB0aGF0XG4gICAqICAgICBhbHRob3VnaCB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBwbGFjZWQgb24gYW4gZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvXG4gICAqICAgICBpdHMgY2hpbGRyZW4gYXMgdGhleSBnZXQgYWRkZWQgYW5kIHJlbW92ZWQuXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGUgb3BhY2l0eSB0b1xuICAgKiAgICAgYDFgIGZvciBleGFtcGxlLiBJdCBpcyB0aGVuIHJlbW92ZWQgb24gdGhlIG5leHQgYW5pbWF0aW9uIGZyYW1lLlxuICAgKiAgICogYC5hbmltYXRlLW91dGAgaXMgYWRkZWQgd2hlbiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAwLjBgIGZvclxuICAgKiAgICAgZXhhbXBsZS4gVGhlIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUgb3JcbiAgICogICAgIG9uIGFub3RoZXIgc2VsZWN0b3IgdGhhdCBtYXRjaGVzIHRoZSBlbGVtZW50LiBOb3RlIHRoYXQgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuXG4gICAqICAgICBlbGVtZW50IHdpdGggdGhlIGByZXBlYXRgIGJpbmRlciwgdGhlc2UgY2xhc3NlcyBhcmUgYWRkZWQgdG8gaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKlxuICAgKiBJZiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBzZXQgdG8gYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW4gdGhhdCBjbGFzcyBuYW1lIHdpbGwgYmUgYWRkZWQgYXNcbiAgICogYSBjbGFzcyB0byB0aGUgZWxlbWVudCBkdXJpbmcgYW5pbWF0aW9uLiBUaGlzIGFsbG93cyB5b3UgdG8gdXNlIGAubXktZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLm15LWZhZGUuYW5pbWF0ZS1pbmAsXG4gICAqIGV0Yy4gaW4geW91ciBzdHlsZXNoZWV0cyB0byB1c2UgdGhlIHNhbWUgYW5pbWF0aW9uIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi5cbiAgICpcbiAgICogIyMjIEphdmFTY3JpcHQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBJZiB5b3UgbmVlZCBncmVhdGVyIGNvbnRyb2wgb3ZlciB5b3VyIGFuaW1hdGlvbnMgSmF2YVNjcmlwdCBtYXkgYmUgdXNlZC4gSXQgaXMgcmVjb21tZW5kZWQgdGhhdCBDU1Mgc3R5bGVzIHN0aWxsIGJlXG4gICAqIHVzZWQgYnkgaGF2aW5nIHlvdXIgY29kZSBzZXQgdGhlbSBtYW51YWxseS4gVGhpcyBhbGxvd3MgdGhlIGFuaW1hdGlvbiB0byB0YWtlIGFkdmFudGFnZSBvZiB0aGUgYnJvd3NlclxuICAgKiBvcHRpbWl6YXRpb25zIHN1Y2ggYXMgaGFyZHdhcmUgYWNjZWxlcmF0aW9uLiBUaGlzIGlzIG5vdCBhIHJlcXVpcmVtZW50LlxuICAgKlxuICAgKiBJbiBvcmRlciB0byB1c2UgSmF2YVNjcmlwdCBhbiBvYmplY3Qgc2hvdWxkIGJlIHBhc3NlZCBpbnRvIHRoZSBgYW5pbWF0aW9uYCBhdHRyaWJ1dGUgdXNpbmcgYW4gZXhwcmVzc2lvbi4gVGhpc1xuICAgKiBvYmplY3Qgc2hvdWxkIGhhdmUgbWV0aG9kcyB0aGF0IGFsbG93IEphdmFTY3JpcHQgYW5pbWF0aW9uIGhhbmRsaW5nLiBGb3IgZXhhbXBsZSwgaWYgeW91IGFyZSBib3VuZCB0byBhIGNvbnRleHRcbiAgICogd2l0aCBhbiBvYmplY3QgbmFtZWQgYGN1c3RvbUZhZGVgIHdpdGggYW5pbWF0aW9uIG1ldGhvZHMsIHlvdXIgZWxlbWVudCBzaG91bGQgaGF2ZSBgYXR0cmlidXRlPVwie3tjdXN0b21GYWRlfX1cImAuXG4gICAqIFRoZSBmb2xsb3dpbmcgaXMgYSBsaXN0IG9mIHRoZSBtZXRob2RzIHlvdSBtYXkgaW1wbGVtZW50LlxuICAgKlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGFuIGVsZW1lbnQgaGFzIGJlZW4gaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBVc2UgaXQgdG8gc2V0IGluaXRpYWxcbiAgICogICAgIENTUyBwcm9wZXJ0aWVzIGJlZm9yZSBgYW5pbWF0ZUluYCBpcyBjYWxsZWQgdG8gc2V0IHRoZSBmaW5hbCBwcm9wZXJ0aWVzLiBUaGlzIG1ldGhvZCBpcyBvcHRpb25hbC5cbiAgICogICAqIGBhbmltYXRlSW4oZWxlbWVudCwgY2FsbGJhY2spYCB3aWxsIGJlIGNhbGxlZCBzaG9ydGx5IGFmdGVyIGB3aWxsQW5pbWF0ZUluYCBpZiBpdCB3YXMgZGVmaW5lZC4gVXNlIGl0IHRvIHNldFxuICAgKiAgICAgZmluYWwgQ1NTIHByb3BlcnRpZXMuXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBkb25lKWAgd2lsbCBiZSBjYWxsZWQgYmVmb3JlIGFuIGVsZW1lbnQgaXMgdG8gYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uIGBkb25lYCBtdXN0IGJlXG4gICAqICAgICBjYWxsZWQgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlIGluIG9yZGVyIGZvciB0aGUgYmluZGVyIHRvIGZpbmlzaCByZW1vdmluZyB0aGUgZWxlbWVudC4gKipSZW1lbWJlcioqIHRvXG4gICAqICAgICBjbGVhbiB1cCBieSByZW1vdmluZyBhbnkgc3R5bGVzIHRoYXQgd2VyZSBhZGRlZCBiZWZvcmUgY2FsbGluZyBgZG9uZSgpYCBzbyB0aGUgZWxlbWVudCBjYW4gYmUgcmV1c2VkIHdpdGhvdXRcbiAgICogICAgIHNpZGUtZWZmZWN0cy5cbiAgICpcbiAgICogVGhlIGBlbGVtZW50YCBwYXNzZWQgaW4gd2lsbCBiZSBwb2x5ZmlsbGVkIGZvciB3aXRoIHRoZSBgYW5pbWF0ZWAgbWV0aG9kIHVzaW5nXG4gICAqIGh0dHBzOi8vZ2l0aHViLmNvbS93ZWItYW5pbWF0aW9ucy93ZWItYW5pbWF0aW9ucy1qcy5cbiAgICpcbiAgICogIyMjIFJlZ2lzdGVyZWQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBBbmltYXRpb25zIG1heSBiZSByZWdpc3RlcmVkIGFuZCB1c2VkIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi4gVG8gdXNlIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gdXNlIGl0cyBuYW1lIGluXG4gICAqIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIChlLmcuIGBhbmltYXRlPVwiZmFkZVwiYCkuIE5vdGUgdGhlIG9ubHkgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gYW5kIGFcbiAgICogY2xhc3MgcmVnaXN0cmF0aW9uIGlzIGNsYXNzIHJlZ2lzdHJhdGlvbnMgYXJlIHByZWZpeGVkIHdpdGggYSBkb3QgKGAuYCkuIFJlZ2lzdGVyZWQgYW5pbWF0aW9ucyBhcmUgYWx3YXlzXG4gICAqIEphdmFTY3JpcHQgYW5pbWF0aW9ucy4gVG8gcmVnaXN0ZXIgYW4gYW5pbWF0aW9uIHVzZSBgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdClgLlxuICAgKlxuICAgKiBUaGUgQW5pbWF0aW9uIG1vZHVsZSBjb21lcyB3aXRoIHNldmVyYWwgY29tbW9uIGFuaW1hdGlvbnMgcmVnaXN0ZXJlZCBieSBkZWZhdWx0LiBUaGUgZGVmYXVsdHMgdXNlIENTUyBzdHlsZXMgdG9cbiAgICogd29yayBjb3JyZWN0bHksIHVzaW5nIGBlbGVtZW50LmFuaW1hdGVgLlxuICAgKlxuICAgKiAgICogYGZhZGVgIHdpbGwgZmFkZSBhbiBlbGVtZW50IGluIGFuZCBvdXQgb3ZlciAzMDAgbWlsbGlzZWNvbmRzLlxuICAgKiAgICogYHNsaWRlYCB3aWxsIHNsaWRlIGFuIGVsZW1lbnQgZG93biB3aGVuIGl0IGlzIGFkZGVkIGFuZCBzbGlkZSBpdCB1cCB3aGVuIGl0IGlzIHJlbW92ZWQuXG4gICAqICAgKiBgc2xpZGUtbW92ZWAgd2lsbCBtb3ZlIGFuIGVsZW1lbnQgZnJvbSBpdHMgb2xkIGxvY2F0aW9uIHRvIGl0cyBuZXcgbG9jYXRpb24gaW4gYSByZXBlYXRlZCBsaXN0LlxuICAgKlxuICAgKiBEbyB5b3UgaGF2ZSBhbm90aGVyIGNvbW1vbiBhbmltYXRpb24geW91IHRoaW5rIHNob3VsZCBiZSBpbmNsdWRlZCBieSBkZWZhdWx0PyBTdWJtaXQgYSBwdWxsIHJlcXVlc3QhXG4gICAqL1xuICByZWdpc3RlckFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSwgYW5pbWF0aW9uT2JqZWN0KSB7XG4gICAgdGhpcy5hbmltYXRpb25zW25hbWVdID0gYW5pbWF0aW9uT2JqZWN0O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFuIGFuaW1hdGlvbi5cbiAgICovXG4gIHVucmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEdldHMgYSByZWdpc3RlcmVkIGFuaW1hdGlvbi5cbiAgICovXG4gIGdldEFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFuaW1hdGlvbnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogUHJlcGFyZSBhbiBlbGVtZW50IHRvIGJlIGVhc2llciBhbmltYXRhYmxlIChhZGRpbmcgYSBzaW1wbGUgYGFuaW1hdGVgIHBvbHlmaWxsIGlmIG5lZWRlZClcbiAgICovXG4gIG1ha2VFbGVtZW50QW5pbWF0YWJsZTogYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZSxcblxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkZWxpbWl0ZXJzIHRoYXQgZGVmaW5lIGFuIGV4cHJlc3Npb24uIERlZmF1bHQgaXMgYHt7YCBhbmQgYH19YCBidXQgdGhpcyBtYXkgYmUgb3ZlcnJpZGRlbi4gSWYgZW1wdHlcbiAgICogc3RyaW5ncyBhcmUgcGFzc2VkIGluIChmb3IgdHlwZSBcImF0dHJpYnV0ZVwiIG9ubHkpIHRoZW4gbm8gZGVsaW1pdGVycyBhcmUgcmVxdWlyZWQgZm9yIG1hdGNoaW5nIGF0dHJpYnV0ZXMsIGJ1dCB0aGVcbiAgICogZGVmYXVsdCBhdHRyaWJ1dGUgbWF0Y2hlciB3aWxsIG5vdCBhcHBseSB0byB0aGUgcmVzdCBvZiB0aGUgYXR0cmlidXRlcy5cbiAgICovXG4gIHNldEV4cHJlc3Npb25EZWxpbWl0ZXJzOiBmdW5jdGlvbih0eXBlLCBwcmUsIHBvc3QpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdFeHByZXNzaW9uIGRlbGltaXRlcnMgbXVzdCBiZSBvZiB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG5cbiAgICB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHIgPSBuZXcgUmVnRXhwKGVzY2FwZVJlZ0V4cChwcmUpICsgJyguKj8pJyArIGVzY2FwZVJlZ0V4cChwb3N0KSwgJ2cnKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUZXN0cyB3aGV0aGVyIGEgdmFsdWUgaGFzIGFuIGV4cHJlc3Npb24gaW4gaXQuIFNvbWV0aGluZyBsaWtlIGAvdXNlci97e3VzZXIuaWR9fWAuXG4gICAqL1xuICBpc0JvdW5kOiBmdW5jdGlvbih0eXBlLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lzQm91bmQgbXVzdCBwcm92aWRlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICByZXR1cm4gQm9vbGVhbihleHByICYmIHZhbHVlICYmIHZhbHVlLm1hdGNoKGV4cHIpKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUaGUgc29ydCBmdW5jdGlvbiB0byBzb3J0IGJpbmRlcnMgY29ycmVjdGx5XG4gICAqL1xuICBiaW5kaW5nU29ydDogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBiLnByb3RvdHlwZS5wcmlvcml0eSAtIGEucHJvdG90eXBlLnByaW9yaXR5O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGFuIGludmVydGVkIGV4cHJlc3Npb24gZnJvbSBgL3VzZXIve3t1c2VyLmlkfX1gIHRvIGBcIi91c2VyL1wiICsgdXNlci5pZGBcbiAgICovXG4gIGNvZGlmeUV4cHJlc3Npb246IGZ1bmN0aW9uKHR5cGUsIHRleHQpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb2RpZnlFeHByZXNzaW9uIG11c3QgdXNlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cblxuICAgIHZhciBleHByID0gdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByO1xuICAgIHZhciBtYXRjaCA9IHRleHQubWF0Y2goZXhwcik7XG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICByZXR1cm4gJ1wiJyArIHRleHQucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICB9IGVsc2UgaWYgKG1hdGNoLmxlbmd0aCA9PT0gMSAmJiBtYXRjaFswXSA9PT0gdGV4dCkge1xuICAgICAgcmV0dXJuIHRleHQucmVwbGFjZShleHByLCAnJDEnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIG5ld1RleHQgPSAnXCInLCBsYXN0SW5kZXggPSAwO1xuICAgICAgd2hpbGUgKG1hdGNoID0gZXhwci5leGVjKHRleHQpKSB7XG4gICAgICAgIHZhciBzdHIgPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCwgZXhwci5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpO1xuICAgICAgICBuZXdUZXh0ICs9IHN0ci5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyk7XG4gICAgICAgIG5ld1RleHQgKz0gJ1wiICsgKCcgKyBtYXRjaFsxXSArICcgfHwgXCJcIikgKyBcIic7XG4gICAgICAgIGxhc3RJbmRleCA9IGV4cHIubGFzdEluZGV4O1xuICAgICAgfVxuICAgICAgbmV3VGV4dCArPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCkucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICAgIHJldHVybiBuZXdUZXh0LnJlcGxhY2UoL15cIlwiIFxcKyB8IFwiXCIgXFwrIHwgXFwrIFwiXCIkL2csICcnKTtcbiAgICB9XG4gIH1cblxufTtcblxuLy8gVGFrZXMgYSBzdHJpbmcgbGlrZSBcIihcXCopXCIgb3IgXCJvbi1cXCpcIiBhbmQgY29udmVydHMgaXQgaW50byBhIHJlZ3VsYXIgZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cCh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL1stW1xcXXt9KCkqKz8uLFxcXFxeJHwjXFxzXS9nLCBcIlxcXFwkJlwiKTtcbn1cbiIsIi8qXG5Db3B5cmlnaHQgKGMpIDIwMTUgSmFjb2IgV3JpZ2h0IDxqYWN3cmlnaHRAZ21haWwuY29tPlxuXG5QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG5vZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG5pbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG50byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG5jb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbmZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG5cblRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG5hbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cblxuVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG5GSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbkFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbkxJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG5PVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG5USEUgU09GVFdBUkUuXG4qL1xuLy8gIyBEaWZmXG4vLyA+IEJhc2VkIG9uIHdvcmsgZnJvbSBHb29nbGUncyBvYnNlcnZlLWpzIHBvbHlmaWxsOiBodHRwczovL2dpdGh1Yi5jb20vUG9seW1lci9vYnNlcnZlLWpzXG5cbi8vIEEgbmFtZXNwYWNlIHRvIHN0b3JlIHRoZSBmdW5jdGlvbnMgb25cbnZhciBkaWZmID0gZXhwb3J0cztcblxuKGZ1bmN0aW9uKCkge1xuXG4gIGRpZmYuY2xvbmUgPSBjbG9uZTtcbiAgZGlmZi52YWx1ZXMgPSBkaWZmVmFsdWVzO1xuICBkaWZmLmJhc2ljID0gZGlmZkJhc2ljO1xuICBkaWZmLm9iamVjdHMgPSBkaWZmT2JqZWN0cztcbiAgZGlmZi5hcnJheXMgPSBkaWZmQXJyYXlzO1xuXG5cbiAgLy8gQSBjaGFuZ2UgcmVjb3JkIGZvciB0aGUgb2JqZWN0IGNoYW5nZXNcbiAgZnVuY3Rpb24gQ2hhbmdlUmVjb3JkKG9iamVjdCwgdHlwZSwgbmFtZSwgb2xkVmFsdWUpIHtcbiAgICB0aGlzLm9iamVjdCA9IG9iamVjdDtcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5vbGRWYWx1ZSA9IG9sZFZhbHVlO1xuICB9XG5cbiAgLy8gQSBzcGxpY2UgcmVjb3JkIGZvciB0aGUgYXJyYXkgY2hhbmdlc1xuICBmdW5jdGlvbiBTcGxpY2UoaW5kZXgsIHJlbW92ZWQsIGFkZGVkQ291bnQpIHtcbiAgICB0aGlzLmluZGV4ID0gaW5kZXg7XG4gICAgdGhpcy5yZW1vdmVkID0gcmVtb3ZlZDtcbiAgICB0aGlzLmFkZGVkQ291bnQgPSBhZGRlZENvdW50O1xuICB9XG5cblxuICAvLyBDcmVhdGVzIGEgY2xvbmUgb3IgY29weSBvZiBhbiBhcnJheSBvciBvYmplY3QgKG9yIHNpbXBseSByZXR1cm5zIGEgc3RyaW5nL251bWJlci9ib29sZWFuIHdoaWNoIGFyZSBpbW11dGFibGUpXG4gIC8vIERvZXMgbm90IHByb3ZpZGUgZGVlcCBjb3BpZXMuXG4gIGZ1bmN0aW9uIGNsb25lKHZhbHVlLCBkZWVwKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoZGVlcCkge1xuICAgICAgICByZXR1cm4gdmFsdWUubWFwKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIGNsb25lKHZhbHVlLCBkZWVwKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh2YWx1ZS52YWx1ZU9mKCkgIT09IHZhbHVlKSB7XG4gICAgICAgIHJldHVybiBuZXcgdmFsdWUuY29uc3RydWN0b3IodmFsdWUudmFsdWVPZigpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjb3B5ID0ge307XG4gICAgICAgIGZvciAodmFyIGtleSBpbiB2YWx1ZSkge1xuICAgICAgICAgIHZhciBvYmpWYWx1ZSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgICAgIG9ialZhbHVlID0gY2xvbmUob2JqVmFsdWUsIGRlZXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb3B5W2tleV0gPSBvYmpWYWx1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29weTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIHZhbHVlcywgcmV0dXJuaW5nIGEgdHJ1dGh5IHZhbHVlIGlmIHRoZXJlIGFyZSBjaGFuZ2VzIG9yIGBmYWxzZWAgaWYgdGhlcmUgYXJlIG5vIGNoYW5nZXMuIElmIHRoZSB0d29cbiAgLy8gdmFsdWVzIGFyZSBib3RoIGFycmF5cyBvciBib3RoIG9iamVjdHMsIGFuIGFycmF5IG9mIGNoYW5nZXMgKHNwbGljZXMgb3IgY2hhbmdlIHJlY29yZHMpIGJldHdlZW4gdGhlIHR3byB3aWxsIGJlXG4gIC8vIHJldHVybmVkLiBPdGhlcndpc2UgIGB0cnVlYCB3aWxsIGJlIHJldHVybmVkLlxuICBmdW5jdGlvbiBkaWZmVmFsdWVzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiBBcnJheS5pc0FycmF5KG9sZFZhbHVlKSkge1xuICAgICAgLy8gSWYgYW4gYXJyYXkgaGFzIGNoYW5nZWQgY2FsY3VsYXRlIHRoZSBzcGxpY2VzXG4gICAgICB2YXIgc3BsaWNlcyA9IGRpZmZBcnJheXModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgIHJldHVybiBzcGxpY2VzLmxlbmd0aCA/IHNwbGljZXMgOiBmYWxzZTtcbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIG9sZFZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gSWYgYW4gb2JqZWN0IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgY2huYWdlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIHZhciB2YWx1ZVZhbHVlID0gdmFsdWUudmFsdWVPZigpO1xuICAgICAgdmFyIG9sZFZhbHVlVmFsdWUgPSBvbGRWYWx1ZS52YWx1ZU9mKCk7XG5cbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIGlmICh0eXBlb2YgdmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlVmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZVZhbHVlICE9PSBvbGRWYWx1ZVZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGNoYW5nZVJlY29yZHMgPSBkaWZmT2JqZWN0cyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgICAgICByZXR1cm4gY2hhbmdlUmVjb3Jkcy5sZW5ndGggPyBjaGFuZ2VSZWNvcmRzIDogZmFsc2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgIHJldHVybiBkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBiYXNpYyB0eXBlcywgcmV0dXJuaW5nIHRydWUgaWYgY2hhbmdlZCBvciBmYWxzZSBpZiBub3RcbiAgZnVuY3Rpb24gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgaWYgKHZhbHVlICYmIG9sZFZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgdmFyIHZhbHVlVmFsdWUgPSB2YWx1ZS52YWx1ZU9mKCk7XG4gICAgICB2YXIgb2xkVmFsdWVWYWx1ZSA9IG9sZFZhbHVlLnZhbHVlT2YoKTtcblxuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZVZhbHVlICE9PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcmV0dXJuIGRpZmZCYXNpYyh2YWx1ZVZhbHVlLCBvbGRWYWx1ZVZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiBhIHZhbHVlIGhhcyBjaGFuZ2VkIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnbnVtYmVyJyAmJiBpc05hTih2YWx1ZSkgJiYgaXNOYU4ob2xkVmFsdWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB2YWx1ZSAhPT0gb2xkVmFsdWU7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gb2JqZWN0cyByZXR1cm5pbmcgYW4gYXJyYXkgb2YgY2hhbmdlIHJlY29yZHMuIFRoZSBjaGFuZ2UgcmVjb3JkIGxvb2tzIGxpa2U6XG4gIC8vIGBgYGphdmFzY3JpcHRcbiAgLy8ge1xuICAvLyAgIG9iamVjdDogb2JqZWN0LFxuICAvLyAgIHR5cGU6ICdkZWxldGVkfHVwZGF0ZWR8bmV3JyxcbiAgLy8gICBuYW1lOiAncHJvcGVydHlOYW1lJyxcbiAgLy8gICBvbGRWYWx1ZTogb2xkVmFsdWVcbiAgLy8gfVxuICAvLyBgYGBcbiAgZnVuY3Rpb24gZGlmZk9iamVjdHMob2JqZWN0LCBvbGRPYmplY3QpIHtcbiAgICB2YXIgY2hhbmdlUmVjb3JkcyA9IFtdO1xuICAgIHZhciBwcm9wLCBvbGRWYWx1ZSwgdmFsdWU7XG5cbiAgICAvLyBHb2VzIHRocm91Z2ggdGhlIG9sZCBvYmplY3QgKHNob3VsZCBiZSBhIGNsb25lKSBhbmQgbG9vayBmb3IgdGhpbmdzIHRoYXQgYXJlIG5vdyBnb25lIG9yIGNoYW5nZWRcbiAgICBmb3IgKHByb3AgaW4gb2xkT2JqZWN0KSB7XG4gICAgICBvbGRWYWx1ZSA9IG9sZE9iamVjdFtwcm9wXTtcbiAgICAgIHZhbHVlID0gb2JqZWN0W3Byb3BdO1xuXG4gICAgICAvLyBBbGxvdyBmb3IgdGhlIGNhc2Ugb2Ygb2JqLnByb3AgPSB1bmRlZmluZWQgKHdoaWNoIGlzIGEgbmV3IHByb3BlcnR5LCBldmVuIGlmIGl0IGlzIHVuZGVmaW5lZClcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmICFkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgdGhlIHByb3BlcnR5IGlzIGdvbmUgaXQgd2FzIHJlbW92ZWRcbiAgICAgIGlmICghIChwcm9wIGluIG9iamVjdCkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAnZGVsZXRlZCcsIHByb3AsIG9sZFZhbHVlKSk7XG4gICAgICB9IGVsc2UgaWYgKGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ3VwZGF0ZWQnLCBwcm9wLCBvbGRWYWx1ZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCBhbmQgbG9va3MgZm9yIHRoaW5ncyB0aGF0IGFyZSBuZXdcbiAgICBmb3IgKHByb3AgaW4gb2JqZWN0KSB7XG4gICAgICB2YWx1ZSA9IG9iamVjdFtwcm9wXTtcbiAgICAgIGlmICghIChwcm9wIGluIG9sZE9iamVjdCkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAnbmV3JywgcHJvcCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KG9iamVjdCkgJiYgb2JqZWN0Lmxlbmd0aCAhPT0gb2xkT2JqZWN0Lmxlbmd0aCkge1xuICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAndXBkYXRlZCcsICdsZW5ndGgnLCBvbGRPYmplY3QubGVuZ3RoKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZVJlY29yZHM7XG4gIH1cblxuXG5cblxuXG4gIEVESVRfTEVBVkUgPSAwXG4gIEVESVRfVVBEQVRFID0gMVxuICBFRElUX0FERCA9IDJcbiAgRURJVF9ERUxFVEUgPSAzXG5cblxuICAvLyBEaWZmcyB0d28gYXJyYXlzIHJldHVybmluZyBhbiBhcnJheSBvZiBzcGxpY2VzLiBBIHNwbGljZSBvYmplY3QgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgaW5kZXg6IDMsXG4gIC8vICAgcmVtb3ZlZDogW2l0ZW0sIGl0ZW1dLFxuICAvLyAgIGFkZGVkQ291bnQ6IDBcbiAgLy8gfVxuICAvLyBgYGBcbiAgZnVuY3Rpb24gZGlmZkFycmF5cyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICB2YXIgY3VycmVudFN0YXJ0ID0gMDtcbiAgICB2YXIgY3VycmVudEVuZCA9IHZhbHVlLmxlbmd0aDtcbiAgICB2YXIgb2xkU3RhcnQgPSAwO1xuICAgIHZhciBvbGRFbmQgPSBvbGRWYWx1ZS5sZW5ndGg7XG5cbiAgICB2YXIgbWluTGVuZ3RoID0gTWF0aC5taW4oY3VycmVudEVuZCwgb2xkRW5kKTtcbiAgICB2YXIgcHJlZml4Q291bnQgPSBzaGFyZWRQcmVmaXgodmFsdWUsIG9sZFZhbHVlLCBtaW5MZW5ndGgpO1xuICAgIHZhciBzdWZmaXhDb3VudCA9IHNoYXJlZFN1ZmZpeCh2YWx1ZSwgb2xkVmFsdWUsIG1pbkxlbmd0aCAtIHByZWZpeENvdW50KTtcblxuICAgIGN1cnJlbnRTdGFydCArPSBwcmVmaXhDb3VudDtcbiAgICBvbGRTdGFydCArPSBwcmVmaXhDb3VudDtcbiAgICBjdXJyZW50RW5kIC09IHN1ZmZpeENvdW50O1xuICAgIG9sZEVuZCAtPSBzdWZmaXhDb3VudDtcblxuICAgIGlmIChjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0ID09PSAwICYmIG9sZEVuZCAtIG9sZFN0YXJ0ID09PSAwKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLy8gaWYgbm90aGluZyB3YXMgYWRkZWQsIG9ubHkgcmVtb3ZlZCBmcm9tIG9uZSBzcG90XG4gICAgaWYgKGN1cnJlbnRTdGFydCA9PT0gY3VycmVudEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZShjdXJyZW50U3RhcnQsIG9sZFZhbHVlLnNsaWNlKG9sZFN0YXJ0LCBvbGRFbmQpLCAwKSBdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIHJlbW92ZWQsIG9ubHkgYWRkZWQgdG8gb25lIHNwb3RcbiAgICBpZiAob2xkU3RhcnQgPT09IG9sZEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZShjdXJyZW50U3RhcnQsIFtdLCBjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0KSBdO1xuICAgIH1cblxuICAgIC8vIGEgbWl4dHVyZSBvZiBhZGRzIGFuZCByZW1vdmVzXG4gICAgdmFyIGRpc3RhbmNlcyA9IGNhbGNFZGl0RGlzdGFuY2VzKHZhbHVlLCBjdXJyZW50U3RhcnQsIGN1cnJlbnRFbmQsIG9sZFZhbHVlLCBvbGRTdGFydCwgb2xkRW5kKTtcbiAgICB2YXIgb3BzID0gc3BsaWNlT3BlcmF0aW9uc0Zyb21FZGl0RGlzdGFuY2VzKGRpc3RhbmNlcyk7XG5cbiAgICB2YXIgc3BsaWNlID0gbnVsbDtcbiAgICB2YXIgc3BsaWNlcyA9IFtdO1xuICAgIHZhciBpbmRleCA9IGN1cnJlbnRTdGFydDtcbiAgICB2YXIgb2xkSW5kZXggPSBvbGRTdGFydDtcblxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gb3BzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIG9wID0gb3BzW2ldO1xuICAgICAgaWYgKG9wID09PSBFRElUX0xFQVZFKSB7XG4gICAgICAgIGlmIChzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2VzLnB1c2goc3BsaWNlKTtcbiAgICAgICAgICBzcGxpY2UgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXgrKztcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfVVBEQVRFKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLmFkZGVkQ291bnQrKztcbiAgICAgICAgaW5kZXgrKztcblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0FERCkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0RFTEVURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5yZW1vdmVkLnB1c2gob2xkVmFsdWVbb2xkSW5kZXhdKTtcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3BsaWNlKSB7XG4gICAgICBzcGxpY2VzLnB1c2goc3BsaWNlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc3BsaWNlcztcbiAgfVxuXG5cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgYmVnaW5uaW5nIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFByZWZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VhcmNoTGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChkaWZmQmFzaWMoY3VycmVudFtpXSwgb2xkW2ldKSkge1xuICAgICAgICByZXR1cm4gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHNlYXJjaExlbmd0aDtcbiAgfVxuXG5cbiAgLy8gZmluZCB0aGUgbnVtYmVyIG9mIGl0ZW1zIGF0IHRoZSBlbmQgdGhhdCBhcmUgdGhlIHNhbWVcbiAgZnVuY3Rpb24gc2hhcmVkU3VmZml4KGN1cnJlbnQsIG9sZCwgc2VhcmNoTGVuZ3RoKSB7XG4gICAgdmFyIGluZGV4MSA9IGN1cnJlbnQubGVuZ3RoO1xuICAgIHZhciBpbmRleDIgPSBvbGQubGVuZ3RoO1xuICAgIHZhciBjb3VudCA9IDA7XG4gICAgd2hpbGUgKGNvdW50IDwgc2VhcmNoTGVuZ3RoICYmICFkaWZmQmFzaWMoY3VycmVudFstLWluZGV4MV0sIG9sZFstLWluZGV4Ml0pKSB7XG4gICAgICBjb3VudCsrO1xuICAgIH1cbiAgICByZXR1cm4gY291bnQ7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpIHtcbiAgICB2YXIgaSA9IGRpc3RhbmNlcy5sZW5ndGggLSAxO1xuICAgIHZhciBqID0gZGlzdGFuY2VzWzBdLmxlbmd0aCAtIDE7XG4gICAgdmFyIGN1cnJlbnQgPSBkaXN0YW5jZXNbaV1bal07XG4gICAgdmFyIGVkaXRzID0gW107XG4gICAgd2hpbGUgKGkgPiAwIHx8IGogPiAwKSB7XG4gICAgICBpZiAoaSA9PT0gMCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGogPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHZhciBub3J0aFdlc3QgPSBkaXN0YW5jZXNbaSAtIDFdW2ogLSAxXTtcbiAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqXTtcbiAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpXVtqIC0gMV07XG5cbiAgICAgIGlmICh3ZXN0IDwgbm9ydGgpIHtcbiAgICAgICAgbWluID0gd2VzdCA8IG5vcnRoV2VzdCA/IHdlc3QgOiBub3J0aFdlc3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtaW4gPSBub3J0aCA8IG5vcnRoV2VzdCA/IG5vcnRoIDogbm9ydGhXZXN0O1xuICAgICAgfVxuXG4gICAgICBpZiAobWluID09PSBub3J0aFdlc3QpIHtcbiAgICAgICAgaWYgKG5vcnRoV2VzdCA9PT0gY3VycmVudCkge1xuICAgICAgICAgIGVkaXRzLnB1c2goRURJVF9MRUFWRSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZWRpdHMucHVzaChFRElUX1VQREFURSk7XG4gICAgICAgICAgY3VycmVudCA9IG5vcnRoV2VzdDtcbiAgICAgICAgfVxuICAgICAgICBpLS07XG4gICAgICAgIGotLTtcbiAgICAgIH0gZWxzZSBpZiAobWluID09PSB3ZXN0KSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9ERUxFVEUpO1xuICAgICAgICBpLS07XG4gICAgICAgIGN1cnJlbnQgPSB3ZXN0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0FERCk7XG4gICAgICAgIGotLTtcbiAgICAgICAgY3VycmVudCA9IG5vcnRoO1xuICAgICAgfVxuICAgIH1cbiAgICBlZGl0cy5yZXZlcnNlKCk7XG4gICAgcmV0dXJuIGVkaXRzO1xuICB9XG5cblxuICBmdW5jdGlvbiBjYWxjRWRpdERpc3RhbmNlcyhjdXJyZW50LCBjdXJyZW50U3RhcnQsIGN1cnJlbnRFbmQsIG9sZCwgb2xkU3RhcnQsIG9sZEVuZCkge1xuICAgIC8vIFwiRGVsZXRpb25cIiBjb2x1bW5zXG4gICAgdmFyIHJvd0NvdW50ID0gb2xkRW5kIC0gb2xkU3RhcnQgKyAxO1xuICAgIHZhciBjb2x1bW5Db3VudCA9IGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQgKyAxO1xuICAgIHZhciBkaXN0YW5jZXMgPSBuZXcgQXJyYXkocm93Q291bnQpO1xuICAgIHZhciBpLCBqO1xuXG4gICAgLy8gXCJBZGRpdGlvblwiIHJvd3MuIEluaXRpYWxpemUgbnVsbCBjb2x1bW4uXG4gICAgZm9yIChpID0gMDsgaSA8IHJvd0NvdW50OyBpKyspIHtcbiAgICAgIGRpc3RhbmNlc1tpXSA9IG5ldyBBcnJheShjb2x1bW5Db3VudCk7XG4gICAgICBkaXN0YW5jZXNbaV1bMF0gPSBpO1xuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgbnVsbCByb3dcbiAgICBmb3IgKGogPSAwOyBqIDwgY29sdW1uQ291bnQ7IGorKykge1xuICAgICAgZGlzdGFuY2VzWzBdW2pdID0gajtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAxOyBpIDwgcm93Q291bnQ7IGkrKykge1xuICAgICAgZm9yIChqID0gMTsgaiA8IGNvbHVtbkNvdW50OyBqKyspIHtcbiAgICAgICAgaWYgKCFkaWZmQmFzaWMoY3VycmVudFtjdXJyZW50U3RhcnQgKyBqIC0gMV0sIG9sZFtvbGRTdGFydCArIGkgLSAxXSkpIHtcbiAgICAgICAgICBkaXN0YW5jZXNbaV1bal0gPSBkaXN0YW5jZXNbaSAtIDFdW2ogLSAxXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgbm9ydGggPSBkaXN0YW5jZXNbaSAtIDFdW2pdICsgMTtcbiAgICAgICAgICB2YXIgd2VzdCA9IGRpc3RhbmNlc1tpXVtqIC0gMV0gKyAxO1xuICAgICAgICAgIGRpc3RhbmNlc1tpXVtqXSA9IG5vcnRoIDwgd2VzdCA/IG5vcnRoIDogd2VzdDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkaXN0YW5jZXM7XG4gIH1cbn0pKCk7XG4iLCIvLyAjIENoaXAgRXhwcmVzc2lvblxuXG4vLyBQYXJzZXMgYSBzdHJpbmcgb2YgSmF2YVNjcmlwdCBpbnRvIGEgZnVuY3Rpb24gd2hpY2ggY2FuIGJlIGJvdW5kIHRvIGEgc2NvcGUuXG4vL1xuLy8gQWxsb3dzIHVuZGVmaW5lZCBvciBudWxsIHZhbHVlcyB0byByZXR1cm4gdW5kZWZpbmVkIHJhdGhlciB0aGFuIHRocm93aW5nXG4vLyBlcnJvcnMsIGFsbG93cyBmb3IgZm9ybWF0dGVycyBvbiBkYXRhLCBhbmQgcHJvdmlkZXMgZGV0YWlsZWQgZXJyb3IgcmVwb3J0aW5nLlxuXG4vLyBUaGUgZXhwcmVzc2lvbiBvYmplY3Qgd2l0aCBpdHMgZXhwcmVzc2lvbiBjYWNoZS5cbnZhciBleHByZXNzaW9uID0gZXhwb3J0cztcbmV4cHJlc3Npb24uY2FjaGUgPSB7fTtcbmV4cHJlc3Npb24uZ2xvYmFscyA9IFsndHJ1ZScsICdmYWxzZScsICdudWxsJywgJ3VuZGVmaW5lZCcsICd3aW5kb3cnLCAndGhpcyddO1xuZXhwcmVzc2lvbi5nZXQgPSBnZXRFeHByZXNzaW9uO1xuZXhwcmVzc2lvbi5nZXRTZXR0ZXIgPSBnZXRTZXR0ZXI7XG5leHByZXNzaW9uLmJpbmQgPSBiaW5kRXhwcmVzc2lvbjtcblxuXG4vLyBDcmVhdGVzIGEgZnVuY3Rpb24gZnJvbSB0aGUgZ2l2ZW4gZXhwcmVzc2lvbi4gQW4gYG9wdGlvbnNgIG9iamVjdCBtYXkgYmVcbi8vIHByb3ZpZGVkIHdpdGggdGhlIGZvbGxvd2luZyBvcHRpb25zOlxuLy8gKiBgYXJnc2AgaXMgYW4gYXJyYXkgb2Ygc3RyaW5ncyB3aGljaCB3aWxsIGJlIHRoZSBmdW5jdGlvbidzIGFyZ3VtZW50IG5hbWVzXG4vLyAqIGBnbG9iYWxzYCBpcyBhbiBhcnJheSBvZiBzdHJpbmdzIHdoaWNoIGRlZmluZSBnbG9iYWxzIGF2YWlsYWJsZSB0byB0aGVcbi8vIGZ1bmN0aW9uICh0aGVzZSB3aWxsIG5vdCBiZSBwcmVmaXhlZCB3aXRoIGB0aGlzLmApLiBgJ3RydWUnYCwgYCdmYWxzZSdgLFxuLy8gYCdudWxsJ2AsIGFuZCBgJ3dpbmRvdydgIGFyZSBpbmNsdWRlZCBieSBkZWZhdWx0LlxuLy9cbi8vIFRoaXMgZnVuY3Rpb24gd2lsbCBiZSBjYWNoZWQgc28gc3Vic2VxdWVudCBjYWxscyB3aXRoIHRoZSBzYW1lIGV4cHJlc3Npb24gd2lsbFxuLy8gcmV0dXJuIHRoZSBzYW1lIGZ1bmN0aW9uLiBFLmcuIHRoZSBleHByZXNzaW9uIFwibmFtZVwiIHdpbGwgYWx3YXlzIHJldHVybiBhXG4vLyBzaW5nbGUgZnVuY3Rpb24gd2l0aCB0aGUgYm9keSBgcmV0dXJuIHRoaXMubmFtZWAuXG5mdW5jdGlvbiBnZXRFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpIHtcbiAgaWYgKCFvcHRpb25zKSBvcHRpb25zID0ge307XG4gIGlmICghb3B0aW9ucy5hcmdzKSBvcHRpb25zLmFyZ3MgPSBbXTtcbiAgdmFyIGNhY2hlS2V5ID0gZXhwciArICd8JyArIG9wdGlvbnMuYXJncy5qb2luKCcsJyk7XG4gIC8vIFJldHVybnMgdGhlIGNhY2hlZCBmdW5jdGlvbiBmb3IgdGhpcyBleHByZXNzaW9uIGlmIGl0IGV4aXN0cy5cbiAgdmFyIGZ1bmMgPSBleHByZXNzaW9uLmNhY2hlW2NhY2hlS2V5XTtcbiAgaWYgKGZ1bmMpIHtcbiAgICByZXR1cm4gZnVuYztcbiAgfVxuXG4gIG9wdGlvbnMuYXJncy51bnNoaWZ0KCdfZm9ybWF0dGVyc18nKTtcblxuICAvLyBQcmVmaXggYWxsIHByb3BlcnR5IGxvb2t1cHMgd2l0aCB0aGUgYHRoaXNgIGtleXdvcmQuIElnbm9yZXMga2V5d29yZHNcbiAgLy8gKHdpbmRvdywgdHJ1ZSwgZmFsc2UpIGFuZCBleHRyYSBhcmdzXG4gIHZhciBib2R5ID0gcGFyc2VFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpO1xuXG4gIHRyeSB7XG4gICAgZnVuYyA9IGV4cHJlc3Npb24uY2FjaGVbY2FjaGVLZXldID0gRnVuY3Rpb24uYXBwbHkobnVsbCwgb3B0aW9ucy5hcmdzLmNvbmNhdChib2R5KSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAob3B0aW9ucy5pZ25vcmVFcnJvcnMpIHJldHVybjtcbiAgICAvLyBUaHJvd3MgYW4gZXJyb3IgaWYgdGhlIGV4cHJlc3Npb24gd2FzIG5vdCB2YWxpZCBKYXZhU2NyaXB0XG4gICAgY29uc29sZS5lcnJvcignQmFkIGV4cHJlc3Npb246XFxuYCcgKyBleHByICsgJ2BcXG4nICsgJ0NvbXBpbGVkIGV4cHJlc3Npb246XFxuJyArIGJvZHkpO1xuICAgIHRocm93IG5ldyBFcnJvcihlLm1lc3NhZ2UpO1xuICB9XG4gIHJldHVybiBmdW5jO1xufVxuXG5cbi8vIENyZWF0ZXMgYSBzZXR0ZXIgZnVuY3Rpb24gZnJvbSB0aGUgZ2l2ZW4gZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGdldFNldHRlcihleHByLCBvcHRpb25zKSB7XG4gIGlmICghb3B0aW9ucykgb3B0aW9ucyA9IHt9O1xuICBvcHRpb25zLmFyZ3MgPSBbJ3ZhbHVlJ107XG4gIGV4cHIgPSBleHByLnJlcGxhY2UoLyhcXHMqXFx8fCQpLywgJyA9IHZhbHVlJDEnKTtcbiAgcmV0dXJuIGdldEV4cHJlc3Npb24oZXhwciwgb3B0aW9ucyk7XG59XG5cblxuXG4vLyBDb21waWxlcyBhbiBleHByZXNzaW9uIGFuZCBiaW5kcyBpdCBpbiB0aGUgZ2l2ZW4gc2NvcGUuIFRoaXMgYWxsb3dzIGl0IHRvIGJlXG4vLyBjYWxsZWQgZnJvbSBhbnl3aGVyZSAoZS5nLiBldmVudCBsaXN0ZW5lcnMpIHdoaWxlIHJldGFpbmluZyB0aGUgc2NvcGUuXG5mdW5jdGlvbiBiaW5kRXhwcmVzc2lvbihleHByLCBzY29wZSwgb3B0aW9ucykge1xuICByZXR1cm4gZ2V0RXhwcmVzc2lvbihleHByLCBvcHRpb25zKS5iaW5kKHNjb3BlKTtcbn1cblxuLy8gZmluZHMgYWxsIHF1b3RlZCBzdHJpbmdzXG52YXIgcXVvdGVFeHByID0gLyhbJ1wiXFwvXSkoXFxcXFxcMXxbXlxcMV0pKj9cXDEvZztcblxuLy8gZmluZHMgYWxsIGVtcHR5IHF1b3RlZCBzdHJpbmdzXG52YXIgZW1wdHlRdW90ZUV4cHIgPSAvKFsnXCJcXC9dKVxcMS9nO1xuXG4vLyBmaW5kcyBwaXBlcyB0aGF0IGFyZW4ndCBPUnMgKGAgfCBgIG5vdCBgIHx8IGApIGZvciBmb3JtYXR0ZXJzXG52YXIgcGlwZUV4cHIgPSAvXFx8KFxcfCk/L2c7XG5cbi8vIGZpbmRzIHRoZSBwYXJ0cyBvZiBhIGZvcm1hdHRlciAobmFtZSBhbmQgYXJncylcbnZhciBmb3JtYXR0ZXJFeHByID0gL14oW15cXChdKykoPzpcXCgoLiopXFwpKT8kLztcblxuLy8gZmluZHMgYXJndW1lbnQgc2VwYXJhdG9ycyBmb3IgZm9ybWF0dGVycyAoYGFyZzE6YXJnMmApXG52YXIgYXJnU2VwYXJhdG9yID0gL1xccyosXFxzKi9nO1xuXG4vLyBtYXRjaGVzIHByb3BlcnR5IGNoYWlucyAoZS5nLiBgbmFtZWAsIGB1c2VyLm5hbWVgLCBhbmQgYHVzZXIuZnVsbE5hbWUoKS5jYXBpdGFsaXplKClgKVxudmFyIHByb3BFeHByID0gLygoXFx7fCx8XFwuKT9cXHMqKShbYS16JF9cXCRdKD86W2Etel9cXCQwLTlcXC4tXXxcXFtbJ1wiXFxkXStcXF0pKikoXFxzKig6fFxcKHxcXFspPykvZ2k7XG5cbi8vIGxpbmtzIGluIGEgcHJvcGVydHkgY2hhaW5cbnZhciBjaGFpbkxpbmtzID0gL1xcLnxcXFsvZztcblxuLy8gdGhlIHByb3BlcnR5IG5hbWUgcGFydCBvZiBsaW5rc1xudmFyIGNoYWluTGluayA9IC9cXC58XFxbfFxcKC87XG5cbi8vIGRldGVybWluZXMgd2hldGhlciBhbiBleHByZXNzaW9uIGlzIGEgc2V0dGVyIG9yIGdldHRlciAoYG5hbWVgIHZzXG4vLyBgbmFtZSA9ICdib2InYClcbnZhciBzZXR0ZXJFeHByID0gL1xccz1cXHMvO1xuXG52YXIgaWdub3JlID0gbnVsbDtcbnZhciBzdHJpbmdzID0gW107XG52YXIgcmVmZXJlbmNlQ291bnQgPSAwO1xudmFyIGN1cnJlbnRSZWZlcmVuY2UgPSAwO1xudmFyIGN1cnJlbnRJbmRleCA9IDA7XG52YXIgZmluaXNoZWRDaGFpbiA9IGZhbHNlO1xudmFyIGNvbnRpbnVhdGlvbiA9IGZhbHNlO1xuXG4vLyBBZGRzIGB0aGlzLmAgdG8gdGhlIGJlZ2lubmluZyBvZiBlYWNoIHZhbGlkIHByb3BlcnR5IGluIGFuIGV4cHJlc3Npb24sXG4vLyBwcm9jZXNzZXMgZm9ybWF0dGVycywgYW5kIHByb3ZpZGVzIG51bGwtdGVybWluYXRpb24gaW4gcHJvcGVydHkgY2hhaW5zXG5mdW5jdGlvbiBwYXJzZUV4cHJlc3Npb24oZXhwciwgb3B0aW9ucykge1xuICBpbml0UGFyc2UoZXhwciwgb3B0aW9ucyk7XG4gIGV4cHIgPSBwdWxsT3V0U3RyaW5ncyhleHByKTtcbiAgZXhwciA9IHBhcnNlRm9ybWF0dGVycyhleHByKTtcbiAgZXhwciA9IHBhcnNlRXhwcihleHByKTtcbiAgZXhwciA9ICdyZXR1cm4gJyArIGV4cHI7XG4gIGV4cHIgPSBwdXRJblN0cmluZ3MoZXhwcik7XG4gIGV4cHIgPSBhZGRSZWZlcmVuY2VzKGV4cHIpO1xuICByZXR1cm4gZXhwcjtcbn1cblxuXG5mdW5jdGlvbiBpbml0UGFyc2UoZXhwciwgb3B0aW9ucykge1xuICByZWZlcmVuY2VDb3VudCA9IGN1cnJlbnRSZWZlcmVuY2UgPSAwO1xuICAvLyBJZ25vcmVzIGtleXdvcmRzIGFuZCBwcm92aWRlZCBhcmd1bWVudCBuYW1lc1xuICBpZ25vcmUgPSBleHByZXNzaW9uLmdsb2JhbHMuY29uY2F0KG9wdGlvbnMuZ2xvYmFscyB8fCBbXSwgb3B0aW9ucy5hcmdzIHx8IFtdKTtcbiAgc3RyaW5ncy5sZW5ndGggPSAwO1xufVxuXG5cbi8vIEFkZHMgcGxhY2Vob2xkZXJzIGZvciBzdHJpbmdzIHNvIHdlIGNhbiBwcm9jZXNzIHRoZSByZXN0IHdpdGhvdXQgdGhlaXIgY29udGVudFxuLy8gbWVzc2luZyB1cyB1cC5cbmZ1bmN0aW9uIHB1bGxPdXRTdHJpbmdzKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIucmVwbGFjZShxdW90ZUV4cHIsIGZ1bmN0aW9uKHN0ciwgcXVvdGUpIHtcbiAgICBzdHJpbmdzLnB1c2goc3RyKTtcbiAgICByZXR1cm4gcXVvdGUgKyBxdW90ZTsgLy8gcGxhY2Vob2xkZXIgZm9yIHRoZSBzdHJpbmdcbiAgfSk7XG59XG5cblxuLy8gUmVwbGFjZXMgc3RyaW5nIHBsYWNlaG9sZGVycy5cbmZ1bmN0aW9uIHB1dEluU3RyaW5ncyhleHByKSB7XG4gIHJldHVybiBleHByLnJlcGxhY2UoZW1wdHlRdW90ZUV4cHIsIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBzdHJpbmdzLnNoaWZ0KCk7XG4gIH0pO1xufVxuXG5cbi8vIFByZXBlbmRzIHJlZmVyZW5jZSB2YXJpYWJsZSBkZWZpbml0aW9uc1xuZnVuY3Rpb24gYWRkUmVmZXJlbmNlcyhleHByKSB7XG4gIGlmIChyZWZlcmVuY2VDb3VudCkge1xuICAgIHZhciByZWZzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDE7IGkgPD0gcmVmZXJlbmNlQ291bnQ7IGkrKykge1xuICAgICAgcmVmcy5wdXNoKCdfcmVmJyArIGkpO1xuICAgIH1cbiAgICBleHByID0gJ3ZhciAnICsgcmVmcy5qb2luKCcsICcpICsgJztcXG4nICsgZXhwcjtcbiAgfVxuICByZXR1cm4gZXhwcjtcbn1cblxuXG5mdW5jdGlvbiBwYXJzZUZvcm1hdHRlcnMoZXhwcikge1xuICAvLyBSZW1vdmVzIGZvcm1hdHRlcnMgZnJvbSBleHByZXNzaW9uIHN0cmluZ1xuICBleHByID0gZXhwci5yZXBsYWNlKHBpcGVFeHByLCBmdW5jdGlvbihtYXRjaCwgb3JJbmRpY2F0b3IpIHtcbiAgICBpZiAob3JJbmRpY2F0b3IpIHJldHVybiBtYXRjaDtcbiAgICByZXR1cm4gJ0BAQCc7XG4gIH0pO1xuXG4gIGZvcm1hdHRlcnMgPSBleHByLnNwbGl0KC9cXHMqQEBAXFxzKi8pO1xuICBleHByID0gZm9ybWF0dGVycy5zaGlmdCgpO1xuICBpZiAoIWZvcm1hdHRlcnMubGVuZ3RoKSByZXR1cm4gZXhwcjtcblxuICAvLyBQcm9jZXNzZXMgdGhlIGZvcm1hdHRlcnNcbiAgLy8gSWYgdGhlIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgdGhlIHZhbHVlIHdpbGwgYmUgcnVuIHRocm91Z2ggdGhlIGZvcm1hdHRlcnNcbiAgdmFyIHNldHRlciA9ICcnO1xuICB2YWx1ZSA9IGV4cHI7XG5cbiAgaWYgKHNldHRlckV4cHIudGVzdChleHByKSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoc2V0dGVyRXhwcik7XG4gICAgc2V0dGVyID0gcGFydHNbMF0gKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnRzWzFdO1xuICB9XG5cbiAgZm9ybWF0dGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcm1hdHRlcikge1xuICAgIHZhciBtYXRjaCA9IGZvcm1hdHRlci50cmltKCkubWF0Y2goZm9ybWF0dGVyRXhwcik7XG4gICAgaWYgKCFtYXRjaCkgdGhyb3cgbmV3IEVycm9yKCdGb3JtYXR0ZXIgaXMgaW52YWxpZDogJyArIGZvcm1hdHRlcik7XG4gICAgdmFyIGZvcm1hdHRlck5hbWUgPSBtYXRjaFsxXTtcbiAgICB2YXIgYXJncyA9IG1hdGNoWzJdID8gbWF0Y2hbMl0uc3BsaXQoYXJnU2VwYXJhdG9yKSA6IFtdO1xuICAgIGFyZ3MudW5zaGlmdCh2YWx1ZSk7XG4gICAgaWYgKHNldHRlcikgYXJncy5wdXNoKHRydWUpO1xuICAgIHZhbHVlID0gJ19mb3JtYXR0ZXJzXy4nICsgZm9ybWF0dGVyTmFtZSArICcuY2FsbCh0aGlzLCAnICsgYXJncy5qb2luKCcsICcpICsgJyknO1xuICB9KTtcblxuICByZXR1cm4gc2V0dGVyICsgdmFsdWU7XG59XG5cblxuZnVuY3Rpb24gcGFyc2VFeHByKGV4cHIpIHtcbiAgaWYgKHNldHRlckV4cHIudGVzdChleHByKSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoJyA9ICcpO1xuICAgIHZhciBzZXR0ZXIgPSBwYXJ0c1swXTtcbiAgICB2YXIgdmFsdWUgPSBwYXJ0c1sxXTtcbiAgICB2YXIgbmVnYXRlID0gJyc7XG4gICAgaWYgKHNldHRlci5jaGFyQXQoMCkgPT09ICchJykge1xuICAgICAgbmVnYXRlID0gJyEnO1xuICAgICAgc2V0dGVyID0gc2V0dGVyLnNsaWNlKDEpO1xuICAgIH1cbiAgICBzZXR0ZXIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKHNldHRlcikucmVwbGFjZSgvXlxcKHxcXCkkL2csICcnKSArICcgPSAnO1xuICAgIHZhbHVlID0gcGFyc2VQcm9wZXJ0eUNoYWlucyh2YWx1ZSk7XG4gICAgcmV0dXJuIHNldHRlciArIG5lZ2F0ZSArIHZhbHVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBwYXJzZVByb3BlcnR5Q2hhaW5zKGV4cHIpO1xuICB9XG59XG5cblxuZnVuY3Rpb24gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKSB7XG4gIHZhciBqYXZhc2NyaXB0ID0gJycsIGpzO1xuICAvLyBhbGxvdyByZWN1cnNpb24gaW50byBmdW5jdGlvbiBhcmdzIGJ5IHJlc2V0dGluZyBwcm9wRXhwclxuICB2YXIgcHJldmlvdXNJbmRleGVzID0gW2N1cnJlbnRJbmRleCwgcHJvcEV4cHIubGFzdEluZGV4XTtcbiAgY3VycmVudEluZGV4ID0gMDtcbiAgcHJvcEV4cHIubGFzdEluZGV4ID0gMDtcbiAgd2hpbGUgKChqcyA9IG5leHRDaGFpbihleHByKSkgIT09IGZhbHNlKSB7XG4gICAgamF2YXNjcmlwdCArPSBqcztcbiAgfVxuICBjdXJyZW50SW5kZXggPSBwcmV2aW91c0luZGV4ZXNbMF07XG4gIHByb3BFeHByLmxhc3RJbmRleCA9IHByZXZpb3VzSW5kZXhlc1sxXTtcbiAgcmV0dXJuIGphdmFzY3JpcHQ7XG59XG5cblxuZnVuY3Rpb24gbmV4dENoYWluKGV4cHIpIHtcbiAgaWYgKGZpbmlzaGVkQ2hhaW4pIHtcbiAgICByZXR1cm4gKGZpbmlzaGVkQ2hhaW4gPSBmYWxzZSk7XG4gIH1cbiAgdmFyIG1hdGNoID0gcHJvcEV4cHIuZXhlYyhleHByKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIGZpbmlzaGVkQ2hhaW4gPSB0cnVlIC8vIG1ha2Ugc3VyZSBuZXh0IGNhbGwgd2UgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIGV4cHIuc2xpY2UoY3VycmVudEluZGV4KTtcbiAgfVxuXG4gIC8vIGBwcmVmaXhgIGlzIGBvYmpJbmRpY2F0b3JgIHdpdGggdGhlIHdoaXRlc3BhY2UgdGhhdCBtYXkgY29tZSBhZnRlciBpdC5cbiAgdmFyIHByZWZpeCA9IG1hdGNoWzFdO1xuXG4gIC8vIGBvYmpJbmRpY2F0b3JgIGlzIGB7YCBvciBgLGAgYW5kIGxldCdzIHVzIGtub3cgdGhpcyBpcyBhbiBvYmplY3QgcHJvcGVydHlcbiAgLy8gbmFtZSAoZS5nLiBwcm9wIGluIGB7cHJvcDpmYWxzZX1gKS5cbiAgdmFyIG9iakluZGljYXRvciA9IG1hdGNoWzJdO1xuXG4gIC8vIGBwcm9wQ2hhaW5gIGlzIHRoZSBjaGFpbiBvZiBwcm9wZXJ0aWVzIG1hdGNoZWQgKGUuZy4gYHRoaXMudXNlci5lbWFpbGApLlxuICB2YXIgcHJvcENoYWluID0gbWF0Y2hbM107XG5cbiAgLy8gYHBvc3RmaXhgIGlzIHRoZSBgY29sb25PclBhcmVuYCB3aXRoIHdoaXRlc3BhY2UgYmVmb3JlIGl0LlxuICB2YXIgcG9zdGZpeCA9IG1hdGNoWzRdO1xuXG4gIC8vIGBjb2xvbk9yUGFyZW5gIG1hdGNoZXMgdGhlIGNvbG9uICg6KSBhZnRlciB0aGUgcHJvcGVydHkgKGlmIGl0IGlzIGFuIG9iamVjdClcbiAgLy8gb3IgcGFyZW50aGVzaXMgaWYgaXQgaXMgYSBmdW5jdGlvbi4gV2UgdXNlIGBjb2xvbk9yUGFyZW5gIGFuZCBgb2JqSW5kaWNhdG9yYFxuICAvLyB0byBrbm93IGlmIGl0IGlzIGFuIG9iamVjdC5cbiAgdmFyIGNvbG9uT3JQYXJlbiA9IG1hdGNoWzVdO1xuXG4gIG1hdGNoID0gbWF0Y2hbMF07XG5cbiAgdmFyIHNraXBwZWQgPSBleHByLnNsaWNlKGN1cnJlbnRJbmRleCwgcHJvcEV4cHIubGFzdEluZGV4IC0gbWF0Y2gubGVuZ3RoKTtcbiAgY3VycmVudEluZGV4ID0gcHJvcEV4cHIubGFzdEluZGV4O1xuXG4gIC8vIHNraXBzIG9iamVjdCBrZXlzIGUuZy4gdGVzdCBpbiBge3Rlc3Q6dHJ1ZX1gLlxuICBpZiAob2JqSW5kaWNhdG9yICYmIGNvbG9uT3JQYXJlbiA9PT0gJzonKSB7XG4gICAgcmV0dXJuIHNraXBwZWQgKyBtYXRjaDtcbiAgfVxuXG4gIHJldHVybiBza2lwcGVkICsgcGFyc2VDaGFpbihwcmVmaXgsIHByb3BDaGFpbiwgcG9zdGZpeCwgY29sb25PclBhcmVuLCBleHByKTtcbn1cblxuXG5mdW5jdGlvbiBzcGxpdExpbmtzKGNoYWluKSB7XG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbWF0Y2g7XG4gIHdoaWxlIChtYXRjaCA9IGNoYWluTGlua3MuZXhlYyhjaGFpbikpIHtcbiAgICBpZiAoY2hhaW5MaW5rcy5sYXN0SW5kZXggPT09IDEpIGNvbnRpbnVlO1xuICAgIHBhcnRzLnB1c2goY2hhaW4uc2xpY2UoaW5kZXgsIGNoYWluTGlua3MubGFzdEluZGV4IC0gMSkpO1xuICAgIGluZGV4ID0gY2hhaW5MaW5rcy5sYXN0SW5kZXggLSAxO1xuICB9XG4gIHBhcnRzLnB1c2goY2hhaW4uc2xpY2UoaW5kZXgpKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG5cbmZ1bmN0aW9uIGFkZFRoaXMoY2hhaW4pIHtcbiAgaWYgKGlnbm9yZS5pbmRleE9mKGNoYWluLnNwbGl0KGNoYWluTGluaykuc2hpZnQoKSkgPT09IC0xKSB7XG4gICAgcmV0dXJuICd0aGlzLicgKyBjaGFpbjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gY2hhaW47XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBwYXJzZUNoYWluKHByZWZpeCwgcHJvcENoYWluLCBwb3N0Zml4LCBwYXJlbiwgZXhwcikge1xuICAvLyBjb250aW51YXRpb25zIGFmdGVyIGEgZnVuY3Rpb24gKGUuZy4gYGdldFVzZXIoMTIpLmZpcnN0TmFtZWApLlxuICBjb250aW51YXRpb24gPSBwcmVmaXggPT09ICcuJztcbiAgaWYgKGNvbnRpbnVhdGlvbikge1xuICAgIHByb3BDaGFpbiA9ICcuJyArIHByb3BDaGFpbjtcbiAgICBwcmVmaXggPSAnJztcbiAgfVxuXG4gIHZhciBsaW5rcyA9IHNwbGl0TGlua3MocHJvcENoYWluKTtcbiAgdmFyIG5ld0NoYWluID0gJyc7XG5cbiAgaWYgKGxpbmtzLmxlbmd0aCA9PT0gMSAmJiAhY29udGludWF0aW9uICYmICFwYXJlbikge1xuICAgIGxpbmsgPSBsaW5rc1swXTtcbiAgICBuZXdDaGFpbiA9IGFkZFRoaXMobGluayk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFjb250aW51YXRpb24pIHtcbiAgICAgIG5ld0NoYWluID0gJygnO1xuICAgIH1cblxuICAgIGxpbmtzLmZvckVhY2goZnVuY3Rpb24obGluaywgaW5kZXgpIHtcbiAgICAgIGlmIChpbmRleCAhPT0gbGlua3MubGVuZ3RoIC0gMSkge1xuICAgICAgICBuZXdDaGFpbiArPSBwYXJzZVBhcnQobGluaywgaW5kZXgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCFwYXJlbnNbcGFyZW5dKSB7XG4gICAgICAgICAgbmV3Q2hhaW4gKz0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIGxpbmsgKyAnKSc7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcG9zdGZpeCA9IHBvc3RmaXgucmVwbGFjZShwYXJlbiwgJycpO1xuICAgICAgICAgIG5ld0NoYWluICs9IHBhcnNlRnVuY3Rpb24obGluaywgaW5kZXgsIGV4cHIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICByZXR1cm4gcHJlZml4ICsgbmV3Q2hhaW4gKyBwb3N0Zml4O1xufVxuXG5cbnZhciBwYXJlbnMgPSB7XG4gICcoJzogJyknLFxuICAnWyc6ICddJ1xufTtcblxuLy8gSGFuZGxlcyBhIGZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBpbiBpdHMgY29ycmVjdCBzY29wZVxuLy8gRmluZHMgdGhlIGVuZCBvZiB0aGUgZnVuY3Rpb24gYW5kIHByb2Nlc3NlcyB0aGUgYXJndW1lbnRzXG5mdW5jdGlvbiBwYXJzZUZ1bmN0aW9uKGxpbmssIGluZGV4LCBleHByKSB7XG4gIHZhciBjYWxsID0gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpO1xuICBsaW5rICs9IGNhbGwuc2xpY2UoMCwgMSkgKyAnfn5pbnNpZGVQYXJlbnN+ficgKyBjYWxsLnNsaWNlKC0xKTtcbiAgdmFyIGluc2lkZVBhcmVucyA9IGNhbGwuc2xpY2UoMSwgLTEpO1xuXG4gIGlmIChleHByLmNoYXJBdChwcm9wRXhwci5sYXN0SW5kZXgpID09PSAnLicpIHtcbiAgICBsaW5rID0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KVxuICB9IGVsc2UgaWYgKGluZGV4ID09PSAwKSB7XG4gICAgbGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gICAgbGluayArPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgJyknO1xuICB9IGVsc2Uge1xuICAgIGxpbmsgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluayArICcpJztcbiAgfVxuXG4gIHZhciByZWYgPSBjdXJyZW50UmVmZXJlbmNlO1xuICBsaW5rID0gbGluay5yZXBsYWNlKCd+fmluc2lkZVBhcmVuc35+JywgcGFyc2VQcm9wZXJ0eUNoYWlucyhpbnNpZGVQYXJlbnMpKTtcbiAgY3VycmVudFJlZmVyZW5jZSA9IHJlZjtcbiAgcmV0dXJuIGxpbms7XG59XG5cblxuLy8gcmV0dXJucyB0aGUgY2FsbCBwYXJ0IG9mIGEgZnVuY3Rpb24gKGUuZy4gYHRlc3QoMTIzKWAgd291bGQgcmV0dXJuIGAoMTIzKWApXG5mdW5jdGlvbiBnZXRGdW5jdGlvbkNhbGwoZXhwcikge1xuICB2YXIgc3RhcnRJbmRleCA9IHByb3BFeHByLmxhc3RJbmRleDtcbiAgdmFyIG9wZW4gPSBleHByLmNoYXJBdChzdGFydEluZGV4IC0gMSk7XG4gIHZhciBjbG9zZSA9IHBhcmVuc1tvcGVuXTtcbiAgdmFyIGVuZEluZGV4ID0gc3RhcnRJbmRleCAtIDE7XG4gIHZhciBwYXJlbkNvdW50ID0gMTtcbiAgd2hpbGUgKGVuZEluZGV4KysgPCBleHByLmxlbmd0aCkge1xuICAgIHZhciBjaCA9IGV4cHIuY2hhckF0KGVuZEluZGV4KTtcbiAgICBpZiAoY2ggPT09IG9wZW4pIHBhcmVuQ291bnQrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gY2xvc2UpIHBhcmVuQ291bnQtLTtcbiAgICBpZiAocGFyZW5Db3VudCA9PT0gMCkgYnJlYWs7XG4gIH1cbiAgY3VycmVudEluZGV4ID0gcHJvcEV4cHIubGFzdEluZGV4ID0gZW5kSW5kZXggKyAxO1xuICByZXR1cm4gb3BlbiArIGV4cHIuc2xpY2Uoc3RhcnRJbmRleCwgZW5kSW5kZXgpICsgY2xvc2U7XG59XG5cblxuXG5mdW5jdGlvbiBwYXJzZVBhcnQocGFydCwgaW5kZXgpIHtcbiAgLy8gaWYgdGhlIGZpcnN0XG4gIGlmIChpbmRleCA9PT0gMCAmJiAhY29udGludWF0aW9uKSB7XG4gICAgaWYgKGlnbm9yZS5pbmRleE9mKHBhcnQuc3BsaXQoL1xcLnxcXCh8XFxbLykuc2hpZnQoKSkgPT09IC0xKSB7XG4gICAgICBwYXJ0ID0gJ3RoaXMuJyArIHBhcnQ7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHBhcnQgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgcGFydDtcbiAgfVxuXG4gIGN1cnJlbnRSZWZlcmVuY2UgPSArK3JlZmVyZW5jZUNvdW50O1xuICB2YXIgcmVmID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZTtcbiAgcmV0dXJuICcoJyArIHJlZiArICcgPSAnICsgcGFydCArICcpID09IG51bGwgPyB1bmRlZmluZWQgOiAnO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpO1xuZXhwb3J0cy5leHByZXNzaW9uID0gcmVxdWlyZSgnLi9leHByZXNzaW9uJyk7XG5leHBvcnRzLmV4cHJlc3Npb24uZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBPYnNlcnZlcjtcbnZhciBleHByZXNzaW9uID0gcmVxdWlyZSgnLi9leHByZXNzaW9uJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIHJlcXVlc3RBbmltYXRpb25GcmFtZSA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgfHwgc2V0VGltZW91dDtcbnZhciBjYW5jZWxBbmltYXRpb25GcmFtZSA9IHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZSB8fCBjbGVhclRpbWVvdXQ7XG5cbi8vICMgT2JzZXJ2ZXJcblxuLy8gRGVmaW5lcyBhbiBvYnNlcnZlciBjbGFzcyB3aGljaCByZXByZXNlbnRzIGFuIGV4cHJlc3Npb24uIFdoZW5ldmVyIHRoYXQgZXhwcmVzc2lvbiByZXR1cm5zIGEgbmV3IHZhbHVlIHRoZSBgY2FsbGJhY2tgXG4vLyBpcyBjYWxsZWQgd2l0aCB0aGUgdmFsdWUuXG4vL1xuLy8gSWYgdGhlIG9sZCBhbmQgbmV3IHZhbHVlcyB3ZXJlIGVpdGhlciBhbiBhcnJheSBvciBhbiBvYmplY3QsIHRoZSBgY2FsbGJhY2tgIGFsc29cbi8vIHJlY2VpdmVzIGFuIGFycmF5IG9mIHNwbGljZXMgKGZvciBhbiBhcnJheSksIG9yIGFuIGFycmF5IG9mIGNoYW5nZSBvYmplY3RzIChmb3IgYW4gb2JqZWN0KSB3aGljaCBhcmUgdGhlIHNhbWVcbi8vIGZvcm1hdCB0aGF0IGBBcnJheS5vYnNlcnZlYCBhbmQgYE9iamVjdC5vYnNlcnZlYCByZXR1cm4gPGh0dHA6Ly93aWtpLmVjbWFzY3JpcHQub3JnL2Rva3UucGhwP2lkPWhhcm1vbnk6b2JzZXJ2ZT4uXG5mdW5jdGlvbiBPYnNlcnZlcihleHByLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KSB7XG4gIGlmICh0eXBlb2YgZXhwciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRoaXMuZ2V0dGVyID0gZXhwcjtcbiAgICB0aGlzLnNldHRlciA9IGV4cHI7XG4gIH0gZWxzZSB7XG4gICAgdGhpcy5nZXR0ZXIgPSBleHByZXNzaW9uLmdldChleHByKTtcbiAgfVxuICB0aGlzLmV4cHIgPSBleHByO1xuICB0aGlzLmNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIHRoaXMuY2FsbGJhY2tDb250ZXh0ID0gY2FsbGJhY2tDb250ZXh0O1xuICB0aGlzLnNraXAgPSBmYWxzZTtcbiAgdGhpcy5mb3JjZVVwZGF0ZU5leHRTeW5jID0gZmFsc2U7XG4gIHRoaXMuY29udGV4dCA9IG51bGw7XG4gIHRoaXMub2xkVmFsdWUgPSB1bmRlZmluZWQ7XG59XG5cbk9ic2VydmVyLnByb3RvdHlwZSA9IHtcblxuICAvLyBCaW5kcyB0aGlzIGV4cHJlc3Npb24gdG8gYSBnaXZlbiBjb250ZXh0XG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQsIHNraXBVcGRhdGUpIHtcbiAgICB0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuICAgIGlmICh0aGlzLmNhbGxiYWNrKSB7XG4gICAgICBPYnNlcnZlci5hZGQodGhpcywgc2tpcFVwZGF0ZSk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFVuYmluZHMgdGhpcyBleHByZXNzaW9uXG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgICBPYnNlcnZlci5yZW1vdmUodGhpcyk7XG4gIH0sXG5cbiAgLy8gUmV0dXJucyB0aGUgY3VycmVudCB2YWx1ZSBvZiB0aGlzIG9ic2VydmVyXG4gIGdldDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0dGVyLmNhbGwodGhpcy5jb250ZXh0LCBPYnNlcnZlci5mb3JtYXR0ZXJzKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gU2V0cyB0aGUgdmFsdWUgb2YgdGhpcyBleHByZXNzaW9uXG4gIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAoIXRoaXMuY29udGV4dCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnNldHRlciA9PT0gZmFsc2UpIHJldHVybjtcbiAgICBpZiAoIXRoaXMuc2V0dGVyKSB7XG4gICAgICB0aGlzLnNldHRlciA9IHR5cGVvZiB0aGlzLmV4cHIgPT09ICdzdHJpbmcnXG4gICAgICAgID8gZXhwcmVzc2lvbi5nZXRTZXR0ZXIodGhpcy5leHByLCB7IGlnbm9yZUVycm9yczogdHJ1ZSB9KSB8fCBmYWxzZVxuICAgICAgICA6IGZhbHNlO1xuICAgICAgaWYgKCF0aGlzLnNldHRlcikgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB2YXIgcmVzdWx0ID0gdGhpcy5zZXR0ZXIuY2FsbCh0aGlzLmNvbnRleHQsIE9ic2VydmVyLmZvcm1hdHRlcnMsIHZhbHVlKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLnN5bmMoKTtcbiAgICBPYnNlcnZlci5zeW5jKCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuXG4gIC8vIEluc3RydWN0cyB0aGlzIG9ic2VydmVyIHRvIG5vdCBjYWxsIGl0cyBgY2FsbGJhY2tgIG9uIHRoZSBuZXh0IHN5bmMsIHdoZXRoZXIgdGhlIHZhbHVlIGhhcyBjaGFuZ2VkIG9yIG5vdFxuICBza2lwTmV4dFN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2tpcCA9IHRydWU7XG4gIH0sXG5cblxuICAvLyBTeW5jcyB0aGlzIG9ic2VydmVyIG5vdywgY2FsbGluZyB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkgaWYgdGhlcmUgaGF2ZSBiZWVuIGNoYW5nZXNcbiAgc3luYzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gdGhpcy5nZXQoKTtcblxuICAgIC8vIERvbid0IGNhbGwgdGhlIGNhbGxiYWNrIGlmIGBza2lwTmV4dFN5bmNgIHdhcyBjYWxsZWQgb24gdGhlIG9ic2VydmVyXG4gICAgaWYgKHRoaXMuc2tpcCB8fCAhdGhpcy5jYWxsYmFjaykge1xuICAgICAgdGhpcy5za2lwID0gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2suIFRoaXNcbiAgICAgIHZhciBjaGFuZ2VkID0gZGlmZi52YWx1ZXModmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgaWYgKCFjaGFuZ2VkICYmICF0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMpIHJldHVybjtcbiAgICAgIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2hhbmdlZCkpIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjay5jYWxsKHRoaXMuY2FsbGJhY2tDb250ZXh0LCB2YWx1ZSwgdGhpcy5vbGRWYWx1ZSwgY2hhbmdlZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0b3JlIGFuIGltbXV0YWJsZSB2ZXJzaW9uIG9mIHRoZSB2YWx1ZSwgYWxsb3dpbmcgZm9yIGFycmF5cyBhbmQgb2JqZWN0cyB0byBjaGFuZ2UgaW5zdGFuY2UgYnV0IG5vdCBjb250ZW50IGFuZFxuICAgIC8vIHN0aWxsIHJlZnJhaW4gZnJvbSBkaXNwYXRjaGluZyBjYWxsYmFja3MgKGUuZy4gd2hlbiB1c2luZyBhbiBvYmplY3QgaW4gYmluZC1jbGFzcyBvciB3aGVuIHVzaW5nIGFycmF5IGZvcm1hdHRlcnNcbiAgICAvLyBpbiBiaW5kLWVhY2gpXG4gICAgdGhpcy5vbGRWYWx1ZSA9IGRpZmYuY2xvbmUodmFsdWUpO1xuICB9XG59O1xuXG5cbi8vIEFuIGFycmF5IG9mIGFsbCBvYnNlcnZlcnMsIGNvbnNpZGVyZWQgKnByaXZhdGUqXG5PYnNlcnZlci5vYnNlcnZlcnMgPSBbXTtcblxuLy8gQW4gYXJyYXkgb2YgY2FsbGJhY2tzIHRvIHJ1biBhZnRlciB0aGUgbmV4dCBzeW5jLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIuY2FsbGJhY2tzID0gW107XG5PYnNlcnZlci5saXN0ZW5lcnMgPSBbXTtcblxuLy8gQWRkcyBhIG5ldyBvYnNlcnZlciB0byBiZSBzeW5jZWQgd2l0aCBjaGFuZ2VzLiBJZiBgc2tpcFVwZGF0ZWAgaXMgdHJ1ZSB0aGVuIHRoZSBjYWxsYmFjayB3aWxsIG9ubHkgYmUgY2FsbGVkIHdoZW4gYVxuLy8gY2hhbmdlIGlzIG1hZGUsIG5vdCBpbml0aWFsbHkuXG5PYnNlcnZlci5hZGQgPSBmdW5jdGlvbihvYnNlcnZlciwgc2tpcFVwZGF0ZSkge1xuICB0aGlzLm9ic2VydmVycy5wdXNoKG9ic2VydmVyKTtcbiAgaWYgKCFza2lwVXBkYXRlKSBvYnNlcnZlci5zeW5jKCk7XG59O1xuXG4vLyBSZW1vdmVzIGFuIG9ic2VydmVyLCBzdG9wcGluZyBpdCBmcm9tIGJlaW5nIHJ1blxuT2JzZXJ2ZXIucmVtb3ZlID0gZnVuY3Rpb24ob2JzZXJ2ZXIpIHtcbiAgdmFyIGluZGV4ID0gdGhpcy5vYnNlcnZlcnMuaW5kZXhPZihvYnNlcnZlcik7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICB0aGlzLm9ic2VydmVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuLy8gKnByaXZhdGUqIHByb3BlcnRpZXMgdXNlZCBpbiB0aGUgc3luYyBjeWNsZVxuT2JzZXJ2ZXIuc3luY2luZyA9IGZhbHNlO1xuT2JzZXJ2ZXIucmVydW4gPSBmYWxzZTtcbk9ic2VydmVyLmN5Y2xlcyA9IDA7XG5PYnNlcnZlci5tYXggPSAxMDtcbk9ic2VydmVyLnRpbWVvdXQgPSBudWxsO1xuT2JzZXJ2ZXIuc3luY1BlbmRpbmcgPSBudWxsO1xuXG4vLyBTY2hlZHVsZXMgYW4gb2JzZXJ2ZXIgc3luYyBjeWNsZSB3aGljaCBjaGVja3MgYWxsIHRoZSBvYnNlcnZlcnMgdG8gc2VlIGlmIHRoZXkndmUgY2hhbmdlZC5cbk9ic2VydmVyLnN5bmMgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAoT2JzZXJ2ZXIuc3luY1BlbmRpbmcpIHJldHVybiBmYWxzZTtcbiAgT2JzZXJ2ZXIuc3luY1BlbmRpbmcgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnVuY3Rpb24oKSB7XG4gICAgT2JzZXJ2ZXIuc3luY05vdyhjYWxsYmFjayk7XG4gIH0pO1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIFJ1bnMgdGhlIG9ic2VydmVyIHN5bmMgY3ljbGUgd2hpY2ggY2hlY2tzIGFsbCB0aGUgb2JzZXJ2ZXJzIHRvIHNlZSBpZiB0aGV5J3ZlIGNoYW5nZWQuXG5PYnNlcnZlci5zeW5jTm93ID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIE9ic2VydmVyLmFmdGVyU3luYyhjYWxsYmFjayk7XG4gIH1cblxuICBjYW5jZWxBbmltYXRpb25GcmFtZShPYnNlcnZlci5zeW5jUGVuZGluZyk7XG4gIE9ic2VydmVyLnN5bmNQZW5kaW5nID0gbnVsbDtcblxuICBpZiAoT2JzZXJ2ZXIuc3luY2luZykge1xuICAgIE9ic2VydmVyLnJlcnVuID0gdHJ1ZTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBPYnNlcnZlci5zeW5jaW5nID0gdHJ1ZTtcbiAgT2JzZXJ2ZXIucmVydW4gPSB0cnVlO1xuICBPYnNlcnZlci5jeWNsZXMgPSAwO1xuXG4gIC8vIEFsbG93IGNhbGxiYWNrcyB0byBydW4gdGhlIHN5bmMgY3ljbGUgYWdhaW4gaW1tZWRpYXRlbHksIGJ1dCBzdG9wIGF0IGBPYnNlcnZlci5tYXhgIChkZWZhdWx0IDEwKSBjeWNsZXMgdG8gd2UgZG9uJ3RcbiAgLy8gcnVuIGluZmluaXRlIGxvb3BzXG4gIHdoaWxlIChPYnNlcnZlci5yZXJ1bikge1xuICAgIGlmICgrK09ic2VydmVyLmN5Y2xlcyA9PT0gT2JzZXJ2ZXIubWF4KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luZmluaXRlIG9ic2VydmVyIHN5bmNpbmcsIGFuIG9ic2VydmVyIGlzIGNhbGxpbmcgT2JzZXJ2ZXIuc3luYygpIHRvbyBtYW55IHRpbWVzJyk7XG4gICAgfVxuICAgIE9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG4gICAgLy8gdGhlIG9ic2VydmVyIGFycmF5IG1heSBpbmNyZWFzZSBvciBkZWNyZWFzZSBpbiBzaXplIChyZW1haW5pbmcgb2JzZXJ2ZXJzKSBkdXJpbmcgdGhlIHN5bmNcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IE9ic2VydmVyLm9ic2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgT2JzZXJ2ZXIub2JzZXJ2ZXJzW2ldLnN5bmMoKTtcbiAgICB9XG4gIH1cblxuICB3aGlsZSAoT2JzZXJ2ZXIuY2FsbGJhY2tzLmxlbmd0aCkge1xuICAgIE9ic2VydmVyLmNhbGxiYWNrcy5zaGlmdCgpKCk7XG4gIH1cblxuICBmb3IgKHZhciBpID0gMCwgbCA9IE9ic2VydmVyLmxpc3RlbmVycy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICB2YXIgbGlzdGVuZXIgPSBPYnNlcnZlci5saXN0ZW5lcnNbaV07XG4gICAgbGlzdGVuZXIoKTtcbiAgfVxuXG4gIE9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBBZnRlciB0aGUgbmV4dCBzeW5jIChvciB0aGUgY3VycmVudCBpZiBpbiB0aGUgbWlkZGxlIG9mIG9uZSksIHJ1biB0aGUgcHJvdmlkZWQgY2FsbGJhY2tcbk9ic2VydmVyLmFmdGVyU3luYyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICBPYnNlcnZlci5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG59O1xuXG5PYnNlcnZlci5vblN5bmMgPSBmdW5jdGlvbihsaXN0ZW5lcikge1xuICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgT2JzZXJ2ZXIubGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xufTtcblxuT2JzZXJ2ZXIucmVtb3ZlT25TeW5jID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIHZhciBpbmRleCA9IE9ic2VydmVyLmxpc3RlbmVycy5pbmRleE9mKGxpc3RlbmVyKTtcbiAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgIE9ic2VydmVyLmxpc3RlbmVycy5zcGxpY2UoaW5kZXgsIDEpLnBvcCgpO1xuICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBGYWRlIGluIGFuZCBvdXRcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbignZmFkZScsIHtcbiAgICBvcHRpb25zOiB7XG4gICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgfSxcbiAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgb3BhY2l0eTogJzAnIH0sXG4gICAgICAgIHsgb3BhY2l0eTogJzEnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBkb25lO1xuICAgIH0sXG4gICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBvcGFjaXR5OiAnMScgfSxcbiAgICAgICAgeyBvcGFjaXR5OiAnMCcgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGRvbmU7XG4gICAgfVxuICB9KTtcblxuICB2YXIgc2xpZGVzID0ge1xuICAgIHNsaWRlOiAnaGVpZ2h0JyxcbiAgICBzbGlkZXY6ICdoZWlnaHQnLFxuICAgIHNsaWRlaDogJ3dpZHRoJ1xuICB9O1xuXG4gIHZhciBhbmltYXRpbmcgPSBuZXcgTWFwKCk7XG5cbiAgZnVuY3Rpb24gb2JqKGtleSwgdmFsdWUpIHtcbiAgICB2YXIgb2JqID0ge307XG4gICAgb2JqW2tleV0gPSB2YWx1ZTtcbiAgICByZXR1cm4gb2JqO1xuICB9XG5cbiAgLyoqXG4gICAqIFNsaWRlIGRvd24gYW5kIHVwLCBsZWZ0IGFuZCByaWdodFxuICAgKi9cbiAgT2JqZWN0LmtleXMoc2xpZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgcHJvcGVydHkgPSBzbGlkZXNbbmFtZV07XG5cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSwge1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICAgIH0sXG4gICAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG4gICAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JylcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSk7XG5cblxuICAgIC8qKlxuICAgICAqIE1vdmUgaXRlbXMgdXAgYW5kIGRvd24gaW4gYSBsaXN0LCBzbGlkZSBkb3duIGFuZCB1cFxuICAgICAqL1xuICAgIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lICsgJy1tb3ZlJywge1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW0gPSBlbGVtZW50LnZpZXcgJiYgZWxlbWVudC52aWV3Ll9yZXBlYXRJdGVtXztcbiAgICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgICBhbmltYXRpbmcuc2V0KGl0ZW0sIGVsZW1lbnQpO1xuICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBhbmltYXRpbmcuZGVsZXRlKGl0ZW0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpdGVtID0gZWxlbWVudC52aWV3ICYmIGVsZW1lbnQudmlldy5fcmVwZWF0SXRlbV87XG4gICAgICAgIGlmIChpdGVtKSB7XG4gICAgICAgICAgdmFyIG5ld0VsZW1lbnQgPSBhbmltYXRpbmcuZ2V0KGl0ZW0pO1xuICAgICAgICAgIGlmIChuZXdFbGVtZW50ICYmIG5ld0VsZW1lbnQucGFyZW50Tm9kZSA9PT0gZWxlbWVudC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGl0ZW0gaXMgYmVpbmcgcmVtb3ZlZCBpbiBvbmUgcGxhY2UgYW5kIGFkZGVkIGludG8gYW5vdGhlci4gTWFrZSBpdCBsb29rIGxpa2UgaXRzIG1vdmluZyBieSBtYWtpbmcgYm90aFxuICAgICAgICAgICAgLy8gZWxlbWVudHMgbm90IHZpc2libGUgYW5kIGhhdmluZyBhIGNsb25lIG1vdmUgYWJvdmUgdGhlIGl0ZW1zIHRvIHRoZSBuZXcgbG9jYXRpb24uXG4gICAgICAgICAgICBlbGVtZW50ID0gdGhpcy5hbmltYXRlTW92ZShlbGVtZW50LCBuZXdFbGVtZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEbyB0aGUgc2xpZGVcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfSxcblxuICAgICAgYW5pbWF0ZU1vdmU6IGZ1bmN0aW9uKG9sZEVsZW1lbnQsIG5ld0VsZW1lbnQpIHtcbiAgICAgICAgdmFyIHBsYWNlaG9sZGVyRWxlbWVudDtcbiAgICAgICAgdmFyIHBhcmVudCA9IG5ld0VsZW1lbnQucGFyZW50Tm9kZTtcbiAgICAgICAgaWYgKCFwYXJlbnQuX19zbGlkZU1vdmVIYW5kbGVkKSB7XG4gICAgICAgICAgcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCA9IHRydWU7XG4gICAgICAgICAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHBhcmVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgICAgICBwYXJlbnQuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcmlnU3R5bGUgPSBvbGRFbGVtZW50LmdldEF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgICAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUob2xkRWxlbWVudCk7XG4gICAgICAgIHZhciBtYXJnaW5PZmZzZXRMZWZ0ID0gLXBhcnNlSW50KHN0eWxlLm1hcmdpbkxlZnQpO1xuICAgICAgICB2YXIgbWFyZ2luT2Zmc2V0VG9wID0gLXBhcnNlSW50KHN0eWxlLm1hcmdpblRvcCk7XG4gICAgICAgIHZhciBvbGRMZWZ0ID0gb2xkRWxlbWVudC5vZmZzZXRMZWZ0O1xuICAgICAgICB2YXIgb2xkVG9wID0gb2xkRWxlbWVudC5vZmZzZXRUb3A7XG5cbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50ID0gZnJhZ21lbnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZShvbGRFbGVtZW50LmNsb25lTm9kZSh0cnVlKSk7XG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5zdHlsZS53aWR0aCA9IG9sZEVsZW1lbnQuc3R5bGUud2lkdGggPSBzdHlsZS53aWR0aDtcbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnN0eWxlLmhlaWdodCA9IG9sZEVsZW1lbnQuc3R5bGUuaGVpZ2h0ID0gc3R5bGUuaGVpZ2h0O1xuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcwJztcblxuICAgICAgICBvbGRFbGVtZW50LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcbiAgICAgICAgb2xkRWxlbWVudC5zdHlsZS56SW5kZXggPSAxMDAwO1xuICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyRWxlbWVudCwgb2xkRWxlbWVudCk7XG4gICAgICAgIG5ld0VsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcwJztcblxuICAgICAgICBvbGRFbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIHsgdG9wOiBvbGRUb3AgKyBtYXJnaW5PZmZzZXRUb3AgKyAncHgnLCBsZWZ0OiBvbGRMZWZ0ICsgbWFyZ2luT2Zmc2V0TGVmdCArICdweCcgfSxcbiAgICAgICAgICB7IHRvcDogbmV3RWxlbWVudC5vZmZzZXRUb3AgKyBtYXJnaW5PZmZzZXRUb3AgKyAncHgnLCBsZWZ0OiBuZXdFbGVtZW50Lm9mZnNldExlZnQgKyBtYXJnaW5PZmZzZXRMZWZ0ICsgJ3B4JyB9XG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgICAgb3JpZ1N0eWxlID8gb2xkRWxlbWVudC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgb3JpZ1N0eWxlKSA6IG9sZEVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdzdHlsZScpO1xuICAgICAgICAgIG5ld0VsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcnO1xuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBwbGFjZWhvbGRlckVsZW1lbnQ7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgfSk7XG5cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcbnZhciBkaWZmID0gcmVxdWlyZSgnLi4vb2JzZXJ2ZXIvZGlmZicpO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBQcmludHMgb3V0IHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB0byB0aGUgY29uc29sZS5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnZGVidWcnLCB7XG4gICAgcHJpb3JpdHk6IDYwLFxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBjb25zb2xlLmluZm8oJ0RlYnVnOicsIHRoaXMuZXhwcmVzc2lvbiwgJz0nLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyB0ZXh0XG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZGlzcGxheSBlc2NhcGVkIHRleHQgaW5zaWRlIGFuIGVsZW1lbnQuIFRoaXMgY2FuIGJlIGRvbmUgd2l0aCBiaW5kaW5nIGRpcmVjdGx5IGluIHRleHQgbm9kZXMgYnV0XG4gICAqIHVzaW5nIHRoZSBhdHRyaWJ1dGUgYmluZGVyIHByZXZlbnRzIGEgZmxhc2ggb2YgdW5zdHlsZWQgY29udGVudCBvbiB0aGUgbWFpbiBwYWdlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aDEgdGV4dD1cInt7cG9zdC50aXRsZX19XCI+VW50aXRsZWQ8L2gxPlxuICAgKiA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5MaXR0bGUgUmVkPC9oMT5cbiAgICogPGRpdj5cbiAgICogICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgPHA+XG4gICAqICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgIDwvcD5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd0ZXh0JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSAodmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWUpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBodG1sXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZGlzcGxheSB1bmVzY2FwZWQgSFRNTCBpbnNpZGUgYW4gZWxlbWVudC4gQmUgc3VyZSBpdCdzIHRydXN0ZWQhIFRoaXMgc2hvdWxkIGJlIHVzZWQgd2l0aCBmaWx0ZXJzXG4gICAqIHdoaWNoIGNyZWF0ZSBIVE1MIGZyb20gc29tZXRoaW5nIHNhZmUuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT57e3Bvc3QudGl0bGV9fTwvaDE+XG4gICAqIDxkaXYgaHRtbD1cInt7cG9zdC5ib2R5IHwgbWFya2Rvd259fVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiA8ZGl2PlxuICAgKiAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICA8cD5cbiAgICogICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgPC9wPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2h0bWwnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC5pbm5lckhUTUwgPSAodmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWUpO1xuICB9KTtcblxuXG5cbiAgLyoqXG4gICAqICMjIGNsYXNzLVtjbGFzc05hbWVdXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gYWRkIGNsYXNzZXMgdG8gYW4gZWxlbWVudCBkZXBlbmRlbnQgb24gd2hldGhlciB0aGUgZXhwcmVzc2lvbiBpcyB0cnVlIG9yIGZhbHNlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwidXNlci1pdGVtXCIgY2xhc3Mtc2VsZWN0ZWQtdXNlcj1cInt7c2VsZWN0ZWQgPT09IHVzZXJ9fVwiPlxuICAgKiAgIDxidXR0b24gY2xhc3M9XCJidG4gcHJpbWFyeVwiIGNsYXNzLWhpZ2hsaWdodD1cInt7cmVhZHl9fVwiPjwvYnV0dG9uPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYHNlbGVjdGVkYCBlcXVhbHMgdGhlIGB1c2VyYCBhbmQgYHJlYWR5YCBpcyBgdHJ1ZWA6KlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJ1c2VyLWl0ZW0gc2VsZWN0ZWQtdXNlclwiPlxuICAgKiAgIDxidXR0b24gY2xhc3M9XCJidG4gcHJpbWFyeSBoaWdobGlnaHRcIj48L2J1dHRvbj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjbGFzcy0qJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5jbGFzc0xpc3QuYWRkKHRoaXMubWF0Y2gpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm1hdGNoKTtcbiAgICB9XG4gIH0pO1xuXG5cblxuICAvKipcbiAgICogIyMgdmFsdWVcbiAgICogQWRkcyBhIGJpbmRlciB3aGljaCBzZXRzIHRoZSB2YWx1ZSBvZiBhbiBIVE1MIGZvcm0gZWxlbWVudC4gVGhpcyBiaW5kZXIgYWxzbyB1cGRhdGVzIHRoZSBkYXRhIGFzIGl0IGlzIGNoYW5nZWQgaW5cbiAgICogdGhlIGZvcm0gZWxlbWVudCwgcHJvdmlkaW5nIHR3byB3YXkgYmluZGluZy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPkZpcnN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJ1c2VyLmZpcnN0TmFtZVwiPlxuICAgKlxuICAgKiA8bGFiZWw+TGFzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImxhc3ROYW1lXCIgdmFsdWU9XCJ1c2VyLmxhc3ROYW1lXCI+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+Rmlyc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqXG4gICAqIDxsYWJlbD5MYXN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwibGFzdE5hbWVcIiB2YWx1ZT1cIldyaWdodFwiPlxuICAgKiBgYGBcbiAgICogQW5kIHdoZW4gdGhlIHVzZXIgY2hhbmdlcyB0aGUgdGV4dCBpbiB0aGUgZmlyc3QgaW5wdXQgdG8gXCJKYWNcIiwgYHVzZXIuZmlyc3ROYW1lYCB3aWxsIGJlIHVwZGF0ZWQgaW1tZWRpYXRlbHkgd2l0aFxuICAgKiB0aGUgdmFsdWUgb2YgYCdKYWMnYC5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndmFsdWUnLCB7XG4gICAgb25seVdoZW5Cb3VuZDogdHJ1ZSxcbiAgICBldmVudHNBdHRyTmFtZTogJ3ZhbHVlLWV2ZW50cycsXG4gICAgZmllbGRBdHRyTmFtZTogJ3ZhbHVlLWZpZWxkJyxcbiAgICBkZWZhdWx0RXZlbnRzOiBbICdjaGFuZ2UnIF0sXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgbmFtZSA9IHRoaXMuZWxlbWVudC50YWdOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICB2YXIgdHlwZSA9IHRoaXMuZWxlbWVudC50eXBlO1xuICAgICAgdGhpcy5tZXRob2RzID0gaW5wdXRNZXRob2RzW3R5cGVdIHx8IGlucHV0TWV0aG9kc1tuYW1lXTtcblxuICAgICAgaWYgKCF0aGlzLm1ldGhvZHMpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5lbGVtZW50Lmhhc0F0dHJpYnV0ZSh0aGlzLmV2ZW50c0F0dHJOYW1lKSkge1xuICAgICAgICB0aGlzLmV2ZW50cyA9IHRoaXMuZWxlbWVudC5nZXRBdHRyaWJ1dGUodGhpcy5ldmVudHNBdHRyTmFtZSkuc3BsaXQoJyAnKTtcbiAgICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmV2ZW50c0F0dHJOYW1lKTtcbiAgICAgIH0gZWxzZSBpZiAobmFtZSAhPT0gJ29wdGlvbicpIHtcbiAgICAgICAgdGhpcy5ldmVudHMgPSB0aGlzLmRlZmF1bHRFdmVudHM7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmVsZW1lbnQuaGFzQXR0cmlidXRlKHRoaXMuZmllbGRBdHRyTmFtZSkpIHtcbiAgICAgICAgdGhpcy52YWx1ZUZpZWxkID0gdGhpcy5lbGVtZW50LmdldEF0dHJpYnV0ZSh0aGlzLmZpZWxkQXR0ck5hbWUpO1xuICAgICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMuZmllbGRBdHRyTmFtZSk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlID09PSAnb3B0aW9uJykge1xuICAgICAgICB0aGlzLnZhbHVlRmllbGQgPSB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS52YWx1ZUZpZWxkO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghdGhpcy5ldmVudHMpIHJldHVybjsgLy8gbm90aGluZyBmb3IgPG9wdGlvbj4gaGVyZVxuICAgICAgdmFyIGVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgICB2YXIgb2JzZXJ2ZXIgPSB0aGlzLm9ic2VydmVyO1xuICAgICAgdmFyIGlucHV0ID0gdGhpcy5tZXRob2RzO1xuICAgICAgdmFyIHZhbHVlRmllbGQgPSB0aGlzLnZhbHVlRmllbGQ7XG5cbiAgICAgIC8vIFRoZSAyLXdheSBiaW5kaW5nIHBhcnQgaXMgc2V0dGluZyB2YWx1ZXMgb24gY2VydGFpbiBldmVudHNcbiAgICAgIGZ1bmN0aW9uIG9uQ2hhbmdlKCkge1xuICAgICAgICBpZiAoaW5wdXQuZ2V0LmNhbGwoZWxlbWVudCwgdmFsdWVGaWVsZCkgIT09IG9ic2VydmVyLm9sZFZhbHVlICYmICFlbGVtZW50LnJlYWRPbmx5KSB7XG4gICAgICAgICAgb2JzZXJ2ZXIuc2V0KGlucHV0LmdldC5jYWxsKGVsZW1lbnQsIHZhbHVlRmllbGQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZWxlbWVudC50eXBlID09PSAndGV4dCcpIHtcbiAgICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAoZXZlbnQua2V5Q29kZSA9PT0gMTMpIG9uQ2hhbmdlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgb25DaGFuZ2UpO1xuICAgICAgfSk7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5tZXRob2RzLmdldC5jYWxsKHRoaXMuZWxlbWVudCwgdGhpcy52YWx1ZUZpZWxkKSAhPSB2YWx1ZSkge1xuICAgICAgICB0aGlzLm1ldGhvZHMuc2V0LmNhbGwodGhpcy5lbGVtZW50LCB2YWx1ZSwgdGhpcy52YWx1ZUZpZWxkKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBIYW5kbGUgdGhlIGRpZmZlcmVudCBmb3JtIHR5cGVzXG4gICAqL1xuICB2YXIgZGVmYXVsdElucHV0TWV0aG9kID0ge1xuICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnZhbHVlOyB9LFxuICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHsgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7IH1cbiAgfTtcblxuICB2YXIgaW5wdXRNZXRob2RzID0ge1xuICAgIGNoZWNrYm94OiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5jaGVja2VkOyB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkgeyB0aGlzLmNoZWNrZWQgPSAhIXZhbHVlOyB9XG4gICAgfSxcblxuICAgIGZpbGU6IHtcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmZpbGVzICYmIHRoaXMuZmlsZXNbMF07IH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7fVxuICAgIH0sXG5cbiAgICBzZWxlY3Q6IHtcbiAgICAgIGdldDogZnVuY3Rpb24odmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWVGaWVsZCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9wdGlvbnNbdGhpcy5zZWxlY3RlZEluZGV4XS52YWx1ZU9iamVjdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUsIHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHZhbHVlRmllbGQpIHtcbiAgICAgICAgICB0aGlzLnZhbHVlT2JqZWN0ID0gdmFsdWU7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlW3ZhbHVlRmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIG9wdGlvbjoge1xuICAgICAgZ2V0OiBmdW5jdGlvbih2YWx1ZUZpZWxkKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZUZpZWxkID8gdGhpcy52YWx1ZU9iamVjdFt2YWx1ZUZpZWxkXSA6IHRoaXMudmFsdWU7XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSwgdmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWVGaWVsZCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPYmplY3QgPSB2YWx1ZTtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVbdmFsdWVGaWVsZF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgaW5wdXQ6IGRlZmF1bHRJbnB1dE1ldGhvZCxcblxuICAgIHRleHRhcmVhOiBkZWZhdWx0SW5wdXRNZXRob2RcbiAgfTtcblxuXG4gIC8qKlxuICAgKiAjIyBvbi1bZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgZm9yIGVhY2ggZXZlbnQgbmFtZSBpbiB0aGUgYXJyYXkuIFdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZCB0aGUgZXhwcmVzc2lvbiB3aWxsIGJlIHJ1bi5cbiAgICpcbiAgICogKipFeGFtcGxlIEV2ZW50czoqKlxuICAgKlxuICAgKiAqIG9uLWNsaWNrXG4gICAqICogb24tZGJsY2xpY2tcbiAgICogKiBvbi1zdWJtaXRcbiAgICogKiBvbi1jaGFuZ2VcbiAgICogKiBvbi1mb2N1c1xuICAgKiAqIG9uLWJsdXJcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0gb24tc3VibWl0PVwie3tzYXZlVXNlcigpfX1cIj5cbiAgICogICA8aW5wdXQgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICogICA8YnV0dG9uPlNhdmU8L2J1dHRvbj5cbiAgICogPC9mb3JtPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCAoZXZlbnRzIGRvbid0IGFmZmVjdCB0aGUgSFRNTCk6KlxuICAgKiBgYGBodG1sXG4gICAqIDxmb3JtPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0qJywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGV2ZW50TmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAoIXRoaXMuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpICYmIF90aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAvLyBTZXQgdGhlIGV2ZW50IG9uIHRoZSBjb250ZXh0IHNvIGl0IG1heSBiZSB1c2VkIGluIHRoZSBleHByZXNzaW9uIHdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZC5cbiAgICAgICAgICB2YXIgcHJpb3JFdmVudCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2V2ZW50Jyk7XG4gICAgICAgICAgdmFyIHByaW9yRWxlbWVudCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2VsZW1lbnQnKTtcbiAgICAgICAgICBfdGhpcy5jb250ZXh0LmV2ZW50ID0gZXZlbnQ7XG4gICAgICAgICAgX3RoaXMuY29udGV4dC5lbGVtZW50ID0gX3RoaXMuZWxlbWVudDtcblxuICAgICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcblxuICAgICAgICAgIC8vIFJlc2V0IHRoZSBjb250ZXh0IHRvIGl0cyBwcmlvciBzdGF0ZVxuICAgICAgICAgIGlmIChwcmlvckV2ZW50KSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoX3RoaXMuY29udGV4dCwgJ2V2ZW50JywgcHJpb3JFdmVudCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSBfdGhpcy5jb250ZXh0LmV2ZW50O1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChwcmlvckVsZW1lbnQpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShfdGhpcy5jb250ZXh0LCAnZWxlbWVudCcsIHByaW9yRWxlbWVudCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSBfdGhpcy5jb250ZXh0LmVsZW1lbnQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtrZXkgZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgd2hpY2ggaXMgdHJpZ2dlcmVkIHdoZW4gdGhlIGtleWRvd24gZXZlbnQncyBga2V5Q29kZWAgcHJvcGVydHkgbWF0Y2hlcy4gSWYgdGhlIG5hbWUgaW5jbHVkZXMgY3RybFxuICAgKiB0aGVuIGl0IHdpbGwgb25seSBmaXJlIHdoZW4gdGhlIGtleSBwbHVzIHRoZSBjdHJsS2V5IG9yIG1ldGFLZXkgaXMgcHJlc3NlZC5cbiAgICpcbiAgICogKipLZXkgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tZW50ZXJcbiAgICogKiBvbi1jdHJsLWVudGVyXG4gICAqICogb24tZXNjXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dCBvbi1lbnRlcj1cInt7c2F2ZSgpfX1cIiBvbi1lc2M9XCJ7e2NhbmNlbCgpfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIga2V5Q29kZXMgPSB7IGVudGVyOiAxMywgZXNjOiAyNywgJ2N0cmwtZW50ZXInOiAxMyB9O1xuXG4gIE9iamVjdC5rZXlzKGtleUNvZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIga2V5Q29kZSA9IGtleUNvZGVzW25hbWVdO1xuXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0nICsgbmFtZSwge1xuICAgICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciB1c2VDdHJsS2V5ID0gbmFtZS5pbmRleE9mKCdjdHJsLScpID09PSAwO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKHVzZUN0cmxLZXkgJiYgIShldmVudC5jdHJsS2V5IHx8IGV2ZW50Lm1ldGFLZXkpIHx8ICFfdGhpcy5jb250ZXh0KSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgIT09IGtleUNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgaWYgKCF0aGlzLmhhc0F0dHJpYnV0ZSgnZGlzYWJsZWQnKSkge1xuICAgICAgICAgICAgLy8gU2V0IHRoZSBldmVudCBvbiB0aGUgY29udGV4dCBzbyBpdCBtYXkgYmUgdXNlZCBpbiB0aGUgZXhwcmVzc2lvbiB3aGVuIHRoZSBldmVudCBpcyB0cmlnZ2VyZWQuXG4gICAgICAgICAgICB2YXIgcHJpb3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKF90aGlzLmNvbnRleHQsICdldmVudCcpO1xuICAgICAgICAgICAgX3RoaXMuY29udGV4dC5ldmVudCA9IGV2ZW50O1xuXG4gICAgICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG5cbiAgICAgICAgICAgIC8vIFJlc2V0IHRoZSBjb250ZXh0IHRvIGl0cyBwcmlvciBzdGF0ZVxuICAgICAgICAgICAgaWYgKHByaW9yKSB7XG4gICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShfdGhpcy5jb250ZXh0LCBldmVudCwgcHJpb3IpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZGVsZXRlIF90aGlzLmNvbnRleHQuZXZlbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXSRcbiAgICogQWRkcyBhIGJpbmRlciB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvZiBlbGVtZW50IHRvIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbi4gVXNlIHRoaXMgd2hlbiB5b3UgZG9uJ3Qgd2FudCBhblxuICAgKiBgPGltZz5gIHRvIHRyeSBhbmQgbG9hZCBpdHMgYHNyY2AgYmVmb3JlIGJlaW5nIGV2YWx1YXRlZC4gVGhpcyBpcyBvbmx5IG5lZWRlZCBvbiB0aGUgaW5kZXguaHRtbCBwYWdlIGFzIHRlbXBsYXRlXG4gICAqIHdpbGwgYmUgcHJvY2Vzc2VkIGJlZm9yZSBiZWluZyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIEdlbmVyYWxseSB5b3UgY2FuIGp1c3QgdXNlIGBhdHRyPVwie3tleHByfX1cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZSBBdHRyaWJ1dGVzOioqXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjJD1cInt7dXNlci5hdmF0YXJVcmx9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGltZyBzcmM9XCJodHRwOi8vY2RuLmV4YW1wbGUuY29tL2F2YXRhcnMvamFjd3JpZ2h0LXNtYWxsLnBuZ1wiPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKiQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIFthdHRyaWJ1dGVdP1xuICAgKiBBZGRzIGEgYmluZGVyIHRvIHRvZ2dsZSBhbiBhdHRyaWJ1dGUgb24gb3Igb2ZmIGlmIHRoZSBleHByZXNzaW9uIGlzIHRydXRoeSBvciBmYWxzZXkuIFVzZSBmb3IgYXR0cmlidXRlcyB3aXRob3V0XG4gICAqIHZhbHVlcyBzdWNoIGFzIGBzZWxlY3RlZGAsIGBkaXNhYmxlZGAsIG9yIGByZWFkb25seWAuIGBjaGVja2VkP2Agd2lsbCB1c2UgMi13YXkgZGF0YWJpbmRpbmcuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNoZWNrZWQ/PVwie3t1c2VyLmlzQWRtaW59fVwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPz1cInt7aXNQcm9jZXNzaW5nfX1cIj5TdWJtaXQ8L2J1dHRvbj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYGlzUHJvY2Vzc2luZ2AgaXMgYHRydWVgIGFuZCBgdXNlci5pc0FkbWluYCBpcyBmYWxzZToqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPklzIEFkbWluaXN0cmF0b3I8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCI+XG4gICAqIDxidXR0b24gZGlzYWJsZWQ+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCcqPycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGF0dHJOYW1lID0gdGhpcy5tYXRjaDtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZShhdHRyTmFtZSwgJycpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQWRkIGEgY2xvbmUgb2YgdGhlIGB2YWx1ZWAgYmluZGVyIGZvciBgY2hlY2tlZD9gIHNvIGNoZWNrYm94ZXMgY2FuIGhhdmUgdHdvLXdheSBiaW5kaW5nIHVzaW5nIGBjaGVja2VkP2AuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NoZWNrZWQ/JywgZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcigndmFsdWUnKSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyBpZiwgdW5sZXNzLCBlbHNlLWlmLCBlbHNlLXVubGVzcywgZWxzZVxuICAgKiBBZGRzIGEgYmluZGVyIHRvIHNob3cgb3IgaGlkZSB0aGUgZWxlbWVudCBpZiB0aGUgdmFsdWUgaXMgdHJ1dGh5IG9yIGZhbHNleS4gQWN0dWFsbHkgcmVtb3ZlcyB0aGUgZWxlbWVudCBmcm9tIHRoZVxuICAgKiBET00gd2hlbiBoaWRkZW4sIHJlcGxhY2luZyBpdCB3aXRoIGEgbm9uLXZpc2libGUgcGxhY2Vob2xkZXIgYW5kIG5vdCBuZWVkbGVzc2x5IGV4ZWN1dGluZyBiaW5kaW5ncyBpbnNpZGUuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDx1bCBjbGFzcz1cImhlYWRlci1saW5rc1wiPlxuICAgKiAgIDxsaSBpZj1cInVzZXJcIj48YSBocmVmPVwiL2FjY291bnRcIj5NeSBBY2NvdW50PC9hPjwvbGk+XG4gICAqICAgPGxpIHVubGVzcz1cInVzZXJcIj48YSBocmVmPVwiL2xvZ2luXCI+U2lnbiBJbjwvYT48L2xpPlxuICAgKiAgIDxsaSBlbHNlPjxhIGhyZWY9XCIvbG9nb3V0XCI+U2lnbiBPdXQ8L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYHVzZXJgIGlzIG51bGw6KlxuICAgKiBgYGBodG1sXG4gICAqIDx1bCBjbGFzcz1cImhlYWRlci1saW5rc1wiPlxuICAgKiAgIDxsaT48YSBocmVmPVwiL2xvZ2luXCI+U2lnbiBJbjwvYT48L2xpPlxuICAgKiA8L3VsPlxuICAgKiBgYGBcbiAgICovXG4gIHZhciBJZkJpbmRpbmcgPSBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2lmJywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiA1MCxcbiAgICB1bmxlc3NBdHRyTmFtZTogJ3VubGVzcycsXG4gICAgZWxzZUlmQXR0ck5hbWU6ICdlbHNlLWlmJyxcbiAgICBlbHNlVW5sZXNzQXR0ck5hbWU6ICdlbHNlLXVubGVzcycsXG4gICAgZWxzZUF0dHJOYW1lOiAnZWxzZScsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHZhciBleHByZXNzaW9ucyA9IFsgd3JhcElmRXhwKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy5uYW1lID09PSB0aGlzLnVubGVzc0F0dHJOYW1lKSBdO1xuICAgICAgdmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgdmFyIG5vZGUgPSBlbGVtZW50Lm5leHRFbGVtZW50U2libGluZztcbiAgICAgIHRoaXMuZWxlbWVudCA9IHBsYWNlaG9sZGVyO1xuICAgICAgZWxlbWVudC5wYXJlbnROb2RlLnJlcGxhY2VDaGlsZChwbGFjZWhvbGRlciwgZWxlbWVudCk7XG5cbiAgICAgIC8vIFN0b3JlcyBhIHRlbXBsYXRlIGZvciBhbGwgdGhlIGVsZW1lbnRzIHRoYXQgY2FuIGdvIGludG8gdGhpcyBzcG90XG4gICAgICB0aGlzLnRlbXBsYXRlcyA9IFsgZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKGVsZW1lbnQpIF07XG5cbiAgICAgIC8vIFB1bGwgb3V0IGFueSBvdGhlciBlbGVtZW50cyB0aGF0IGFyZSBjaGFpbmVkIHdpdGggdGhpcyBvbmVcbiAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgIHZhciBuZXh0ID0gbm9kZS5uZXh0RWxlbWVudFNpYmxpbmc7XG4gICAgICAgIHZhciBleHByZXNzaW9uO1xuICAgICAgICBpZiAobm9kZS5oYXNBdHRyaWJ1dGUodGhpcy5lbHNlSWZBdHRyTmFtZSkpIHtcbiAgICAgICAgICBleHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIG5vZGUuZ2V0QXR0cmlidXRlKHRoaXMuZWxzZUlmQXR0ck5hbWUpKTtcbiAgICAgICAgICBleHByZXNzaW9ucy5wdXNoKHdyYXBJZkV4cChleHByZXNzaW9uLCBmYWxzZSkpO1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKHRoaXMuZWxzZUlmQXR0ck5hbWUpO1xuICAgICAgICB9IGVsc2UgaWYgKG5vZGUuaGFzQXR0cmlidXRlKHRoaXMuZWxzZVVubGVzc0F0dHJOYW1lKSkge1xuICAgICAgICAgIGV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgbm9kZS5nZXRBdHRyaWJ1dGUodGhpcy5lbHNlVW5sZXNzQXR0ck5hbWUpKTtcbiAgICAgICAgICBleHByZXNzaW9ucy5wdXNoKHdyYXBJZkV4cChleHByZXNzaW9uLCB0cnVlKSk7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUodGhpcy5lbHNlVW5sZXNzQXR0ck5hbWUpO1xuICAgICAgICB9IGVsc2UgaWYgKG5vZGUuaGFzQXR0cmlidXRlKHRoaXMuZWxzZUF0dHJOYW1lKSkge1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKHRoaXMuZWxzZUF0dHJOYW1lKTtcbiAgICAgICAgICBuZXh0ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUucmVtb3ZlKCk7XG4gICAgICAgIHRoaXMudGVtcGxhdGVzLnB1c2goZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKG5vZGUpKTtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEFuIGV4cHJlc3Npb24gdGhhdCB3aWxsIHJldHVybiBhbiBpbmRleC4gU29tZXRoaW5nIGxpa2UgdGhpcyBgZXhwciA/IDAgOiBleHByMiA/IDEgOiBleHByMyA/IDIgOiAzYC4gVGhpcyB3aWxsXG4gICAgICAvLyBiZSB1c2VkIHRvIGtub3cgd2hpY2ggc2VjdGlvbiB0byBzaG93IGluIHRoZSBpZi9lbHNlLWlmL2Vsc2UgZ3JvdXBpbmcuXG4gICAgICB0aGlzLmV4cHJlc3Npb24gPSBleHByZXNzaW9ucy5tYXAoZnVuY3Rpb24oZXhwciwgaW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIGV4cHIgKyAnID8gJyArIGluZGV4ICsgJyA6ICc7XG4gICAgICB9KS5qb2luKCcnKSArIGV4cHJlc3Npb25zLmxlbmd0aDtcbiAgICB9LFxuXG4gICAgdXBkYXRlZDogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIC8vIEZvciBwZXJmb3JtYW5jZSBwcm92aWRlIGFuIGFsdGVybmF0ZSBjb2RlIHBhdGggZm9yIGFuaW1hdGlvblxuICAgICAgaWYgKHRoaXMuYW5pbWF0ZSAmJiB0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQoaW5kZXgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy51cGRhdGVkUmVndWxhcihpbmRleCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFkZDogZnVuY3Rpb24odmlldykge1xuICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHZpZXcsIHRoaXMuZWxlbWVudC5uZXh0U2libGluZyk7XG4gICAgfSxcblxuICAgIC8vIERvZXNuJ3QgZG8gbXVjaCwgYnV0IGFsbG93cyBzdWItY2xhc3NlcyB0byBhbHRlciB0aGUgZnVuY3Rpb25hbGl0eS5cbiAgICByZW1vdmU6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkUmVndWxhcjogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5yZW1vdmUodGhpcy5zaG93aW5nKTtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIHZhciB0ZW1wbGF0ZSA9IHRoaXMudGVtcGxhdGVzW2luZGV4XTtcbiAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnNob3dpbmcgPSB0ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICAgIHRoaXMuc2hvd2luZy5iaW5kKHRoaXMuY29udGV4dCk7XG4gICAgICAgIHRoaXMuYWRkKHRoaXMuc2hvd2luZyk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZWRBbmltYXRlZDogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIHRoaXMubGFzdFZhbHVlID0gaW5kZXg7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgLy8gT2Jzb2xldGVkLCB3aWxsIGNoYW5nZSBhZnRlciBhbmltYXRpb24gaXMgZmluaXNoZWQuXG4gICAgICAgIHRoaXMuc2hvd2luZy51bmJpbmQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zaG93aW5nLnVuYmluZCgpO1xuICAgICAgICB0aGlzLmFuaW1hdGVPdXQodGhpcy5zaG93aW5nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuXG4gICAgICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICAgICAgLy8gTWFrZSBzdXJlIHRoaXMgd2Fzbid0IHVuYm91bmQgd2hpbGUgd2Ugd2VyZSBhbmltYXRpbmcgKGUuZy4gYnkgYSBwYXJlbnQgYGlmYCB0aGF0IGRvZXNuJ3QgYW5pbWF0ZSlcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlKHRoaXMuc2hvd2luZyk7XG4gICAgICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAgIC8vIGZpbmlzaCBieSBhbmltYXRpbmcgdGhlIG5ldyBlbGVtZW50IGluIChpZiBhbnkpLCB1bmxlc3Mgbm8gbG9uZ2VyIGJvdW5kXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLnRlbXBsYXRlc1tpbmRleF07XG4gICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gdGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgICB0aGlzLnNob3dpbmcuYmluZCh0aGlzLmNvbnRleHQpO1xuICAgICAgICB0aGlzLmFkZCh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuYW5pbWF0ZUluKHRoaXMuc2hvd2luZywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgY2hhbmdlZCB3aGlsZSB0aGlzIHdhcyBhbmltYXRpbmcgcnVuIGl0IGFnYWluXG4gICAgICAgICAgaWYgKHRoaXMubGFzdFZhbHVlICE9PSBpbmRleCkge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICB9XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd1bmxlc3MnLCBJZkJpbmRpbmcpO1xuXG4gIGZ1bmN0aW9uIHdyYXBJZkV4cChleHByLCBpc1VubGVzcykge1xuICAgIHJldHVybiAoaXNVbmxlc3MgPyAnIScgOiAnJykgKyBleHByO1xuICB9XG5cblxuICAvKipcbiAgICogIyMgcmVwZWF0XG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZHVwbGljYXRlIGFuIGVsZW1lbnQgZm9yIGVhY2ggaXRlbSBpbiBhbiBhcnJheS4gVGhlIGV4cHJlc3Npb24gbWF5IGJlIG9mIHRoZSBmb3JtYXQgYGVweHJgIG9yXG4gICAqIGBpdGVtTmFtZSBpbiBleHByYCB3aGVyZSBgaXRlbU5hbWVgIGlzIHRoZSBuYW1lIGVhY2ggaXRlbSBpbnNpZGUgdGhlIGFycmF5IHdpbGwgYmUgcmVmZXJlbmNlZCBieSB3aXRoaW4gYmluZGluZ3NcbiAgICogaW5zaWRlIHRoZSBlbGVtZW50LlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGVhY2g9XCJ7e3Bvc3QgaW4gcG9zdHN9fVwiIGNsYXNzLWZlYXR1cmVkPVwie3twb3N0LmlzRmVhdHVyZWR9fVwiPlxuICAgKiAgIDxoMT57e3Bvc3QudGl0bGV9fTwvaDE+XG4gICAqICAgPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiB0aGVyZSBhcmUgMiBwb3N0cyBhbmQgdGhlIGZpcnN0IG9uZSBpcyBmZWF0dXJlZDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cImZlYXR1cmVkXCI+XG4gICAqICAgPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiAgIDxkaXY+XG4gICAqICAgICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgICAgPC9wPlxuICAgKiAgIDwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogPGRpdj5cbiAgICogICA8aDE+QmlnIEJsdWU8L2gxPlxuICAgKiAgIDxkaXY+XG4gICAqICAgICA8cD5Tb21lIHRob3VnaHRzIG9uIHRoZSBOZXcgWW9yayBHaWFudHMuPC9wPlxuICAgKiAgICAgPHA+XG4gICAqICAgICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTmV3X1lvcmtfR2lhbnRzXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgICAgPC9wPlxuICAgKiAgIDwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3JlcGVhdCcsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogMTAwLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBhcmVudCA9IHRoaXMuZWxlbWVudC5wYXJlbnROb2RlO1xuICAgICAgdmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShwbGFjZWhvbGRlciwgdGhpcy5lbGVtZW50KTtcbiAgICAgIHRoaXMudGVtcGxhdGUgPSBmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUodGhpcy5lbGVtZW50KTtcbiAgICAgIHRoaXMuZWxlbWVudCA9IHBsYWNlaG9sZGVyO1xuXG4gICAgICB2YXIgcGFydHMgPSB0aGlzLmV4cHJlc3Npb24uc3BsaXQoL1xccytpblxccysvKTtcbiAgICAgIHRoaXMuZXhwcmVzc2lvbiA9IHBhcnRzLnBvcCgpO1xuICAgICAgdmFyIGtleSA9IHBhcnRzLnBvcCgpO1xuICAgICAgaWYgKGtleSkge1xuICAgICAgICBwYXJ0cyA9IGtleS5zcGxpdCgvXFxzKixcXHMqLyk7XG4gICAgICAgIHRoaXMudmFsdWVOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICAgIHRoaXMua2V5TmFtZSA9IHBhcnRzLnBvcCgpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMudmlld3MgPSBbXTtcbiAgICAgIHRoaXMub2JzZXJ2ZXIuZ2V0Q2hhbmdlUmVjb3JkcyA9IHRydWU7XG4gICAgfSxcblxuICAgIHJlbW92ZVZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgICAgdmlldy5fcmVwZWF0SXRlbV8gPSBudWxsO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSwgb2xkVmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIGlmICghY2hhbmdlcyB8fCAhdGhpcy5jb250ZXh0KSB7XG4gICAgICAgIHRoaXMucG9wdWxhdGUodmFsdWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMuYW5pbWF0ZSkge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHZhbHVlLCBjaGFuZ2VzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNoYW5nZXModmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8vIE1ldGhvZCBmb3IgY3JlYXRpbmcgYW5kIHNldHRpbmcgdXAgbmV3IHZpZXdzIGZvciBvdXIgbGlzdFxuICAgIGNyZWF0ZVZpZXc6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgIHZhciB2aWV3ID0gdGhpcy50ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICB2YXIgY29udGV4dCA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMudmFsdWVOYW1lKSB7XG4gICAgICAgIGNvbnRleHQgPSBPYmplY3QuY3JlYXRlKHRoaXMuY29udGV4dCk7XG4gICAgICAgIGlmICh0aGlzLmtleU5hbWUpIGNvbnRleHRbdGhpcy5rZXlOYW1lXSA9IGtleTtcbiAgICAgICAgY29udGV4dFt0aGlzLnZhbHVlTmFtZV0gPSB2YWx1ZTtcbiAgICAgICAgY29udGV4dC5fb3JpZ0NvbnRleHRfID0gdGhpcy5jb250ZXh0Lmhhc093blByb3BlcnR5KCdfb3JpZ0NvbnRleHRfJylcbiAgICAgICAgICA/IHRoaXMuY29udGV4dC5fb3JpZ0NvbnRleHRfXG4gICAgICAgICAgOiB0aGlzLmNvbnRleHQ7XG4gICAgICB9XG4gICAgICB2aWV3LmJpbmQoY29udGV4dCk7XG4gICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IHZhbHVlO1xuICAgICAgcmV0dXJuIHZpZXc7XG4gICAgfSxcblxuICAgIHBvcHVsYXRlOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnZpZXdzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLnZpZXdzLmZvckVhY2godGhpcy5yZW1vdmVWaWV3KTtcbiAgICAgICAgdGhpcy52aWV3cy5sZW5ndGggPSAwO1xuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoKSB7XG4gICAgICAgIHZhciBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuXG4gICAgICAgIHZhbHVlLmZvckVhY2goZnVuY3Rpb24oaXRlbSwgaW5kZXgpIHtcbiAgICAgICAgICB2YXIgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpbmRleCwgaXRlbSk7XG4gICAgICAgICAgdGhpcy52aWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH0sIHRoaXMpO1xuXG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnLCB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmcpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBUaGlzIHVuLWFuaW1hdGVkIHZlcnNpb24gcmVtb3ZlcyBhbGwgcmVtb3ZlZCB2aWV3cyBmaXJzdCBzbyB0aGV5IGNhbiBiZSByZXR1cm5lZCB0byB0aGUgcG9vbCBhbmQgdGhlbiBhZGRzIG5ld1xuICAgICAqIHZpZXdzIGJhY2sgaW4uIFRoaXMgaXMgdGhlIG1vc3Qgb3B0aW1hbCBtZXRob2Qgd2hlbiBub3QgYW5pbWF0aW5nLlxuICAgICAqL1xuICAgIHVwZGF0ZUNoYW5nZXM6IGZ1bmN0aW9uKHZhbHVlLCBjaGFuZ2VzKSB7XG4gICAgICAvLyBSZW1vdmUgZXZlcnl0aGluZyBmaXJzdCwgdGhlbiBhZGQgYWdhaW4sIGFsbG93aW5nIGZvciBlbGVtZW50IHJldXNlIGZyb20gdGhlIHBvb2xcbiAgICAgIHZhciBhZGRlZENvdW50ID0gMDtcblxuICAgICAgY2hhbmdlcy5mb3JFYWNoKGZ1bmN0aW9uKHNwbGljZSkge1xuICAgICAgICBhZGRlZENvdW50ICs9IHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICBpZiAoIXNwbGljZS5yZW1vdmVkLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcmVtb3ZlZCA9IHRoaXMudmlld3Muc3BsaWNlKHNwbGljZS5pbmRleCAtIGFkZGVkQ291bnQsIHNwbGljZS5yZW1vdmVkLmxlbmd0aCk7XG4gICAgICAgIHJlbW92ZWQuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIC8vIEFkZCB0aGUgbmV3L21vdmVkIHZpZXdzXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIGlmICghc3BsaWNlLmFkZGVkQ291bnQpIHJldHVybjtcbiAgICAgICAgdmFyIGFkZGVkVmlld3MgPSBbXTtcbiAgICAgICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgICB2YXIgaW5kZXggPSBzcGxpY2UuaW5kZXg7XG4gICAgICAgIHZhciBlbmRJbmRleCA9IGluZGV4ICsgc3BsaWNlLmFkZGVkQ291bnQ7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IGluZGV4OyBpIDwgZW5kSW5kZXg7IGkrKykge1xuICAgICAgICAgIHZhciBpdGVtID0gdmFsdWVbaV07XG4gICAgICAgICAgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpLCBpdGVtKTtcbiAgICAgICAgICBhZGRlZFZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cy5zcGxpY2UuYXBwbHkodGhpcy52aWV3cywgWyBpbmRleCwgMCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgYW5pbWF0ZWQgdmVyc2lvbiBtdXN0IGFuaW1hdGUgcmVtb3ZlZCBub2RlcyBvdXQgd2hpbGUgYWRkZWQgbm9kZXMgYXJlIGFuaW1hdGluZyBpbiBtYWtpbmcgaXQgbGVzcyBvcHRpbWFsXG4gICAgICogKGJ1dCBjb29sIGxvb2tpbmcpLiBJdCBhbHNvIGhhbmRsZXMgXCJtb3ZlXCIgYW5pbWF0aW9ucyBmb3Igbm9kZXMgd2hpY2ggYXJlIG1vdmluZyBwbGFjZSB3aXRoaW4gdGhlIGxpc3QuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlc0FuaW1hdGVkOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgYW5pbWF0aW5nVmFsdWUgPSB2YWx1ZS5zbGljZSgpO1xuICAgICAgdmFyIGFsbEFkZGVkID0gW107XG4gICAgICB2YXIgYWxsUmVtb3ZlZCA9IFtdO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuXG4gICAgICAvLyBSdW4gdXBkYXRlcyB3aGljaCBvY2N1cmVkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZy5cbiAgICAgIGZ1bmN0aW9uIHdoZW5Eb25lKCkge1xuICAgICAgICAvLyBUaGUgbGFzdCBhbmltYXRpb24gZmluaXNoZWQgd2lsbCBydW4gdGhpc1xuICAgICAgICBpZiAoLS13aGVuRG9uZS5jb3VudCAhPT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuXG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcpIHtcbiAgICAgICAgICB2YXIgY2hhbmdlcyA9IGRpZmYuYXJyYXlzKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgYW5pbWF0aW5nVmFsdWUpO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgY2hhbmdlcyk7XG4gICAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgd2hlbkRvbmUuY291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICB2YXIgcmVtb3ZlZENvdW50ID0gc3BsaWNlLnJlbW92ZWQubGVuZ3RoO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIGFkZGVkVmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZW1vdmVkVmlld3MgPSB0aGlzLnZpZXdzLnNwbGljZS5hcHBseSh0aGlzLnZpZXdzLCBbIGluZGV4LCByZW1vdmVkQ291bnQgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5leHRTaWJsaW5nKTtcblxuICAgICAgICBhbGxBZGRlZCA9IGFsbEFkZGVkLmNvbmNhdChhZGRlZFZpZXdzKTtcbiAgICAgICAgYWxsUmVtb3ZlZCA9IGFsbFJlbW92ZWQuY29uY2F0KHJlbW92ZWRWaWV3cyk7XG4gICAgICB9LCB0aGlzKTtcblxuXG4gICAgICBhbGxBZGRlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odmlldywgd2hlbkRvbmUpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgIHdoZW5Eb25lLmNvdW50Kys7XG4gICAgICAgIHZpZXcudW5iaW5kKCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh2aWV3LCB3aGVuRG9uZSk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLnZpZXdzLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICB2aWV3LnVuYmluZCgpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSBudWxsO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG5cbi8qKlxuICogIyBEZWZhdWx0IEZvcm1hdHRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGZvcm1hdHRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3Rva2VuTGlzdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiB2IFRPRE8gdlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzdHlsZXMnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZmlsdGVyXG4gICAqIEZpbHRlcnMgYW4gYXJyYXkgYnkgdGhlIGdpdmVuIGZpbHRlciBmdW5jdGlvbihzKSwgbWF5IHByb3ZpZGUgYSBmdW5jdGlvbiwgYW5cbiAgICogYXJyYXksIG9yIGFuIG9iamVjdCB3aXRoIGZpbHRlcmluZyBmdW5jdGlvbnNcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmlsdGVyJywgZnVuY3Rpb24odmFsdWUsIGZpbHRlckZ1bmMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmICghZmlsdGVyRnVuYykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZmlsdGVyRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGZpbHRlckZ1bmMpKSB7XG4gICAgICBmaWx0ZXJGdW5jLmZvckVhY2goZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdvYmplY3QnKSB7XG4gICAgICBPYmplY3Qua2V5cyhmaWx0ZXJGdW5jKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICB2YXIgZnVuYyA9IGZpbHRlckZ1bmNba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG1hcFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIG1hcCBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gbWFwcGluZyBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdtYXAnLCBmdW5jdGlvbih2YWx1ZSwgbWFwRnVuYykge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChtYXBGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hcEZ1bmMuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdyZWR1Y2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIHJlZHVjZUZ1bmMoaW5pdGlhbFZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzbGljZScsIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgZW5kSW5kZXgpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zbGljZShpbmRleCwgZW5kSW5kZXgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBkYXRlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gZm9ybWF0IGRhdGVzIGFuZCBzdHJpbmdzXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS50b0xvY2FsZVN0cmluZygpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsb2dcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsb2cgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLCB1c2VmdWwgZm9yIGRlYnVnZ2luZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsb2cnLCBmdW5jdGlvbih2YWx1ZSwgcHJlZml4KSB7XG4gICAgaWYgKHByZWZpeCA9PSBudWxsKSBwcmVmaXggPSAnTG9nOic7XG4gICAgY29uc29sZS5sb2cocHJlZml4LCB2YWx1ZSk7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsaW1pdFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxpbWl0IHRoZSBsZW5ndGggb2YgYW4gYXJyYXkgb3Igc3RyaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xpbWl0JywgZnVuY3Rpb24odmFsdWUsIGxpbWl0KSB7XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5zbGljZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGxpbWl0IDwgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UobGltaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUuc2xpY2UoMCwgbGltaXQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBzb3J0XG4gICAqIFNvcnRzIGFuIGFycmF5IGdpdmVuIGEgZmllbGQgbmFtZSBvciBzb3J0IGZ1bmN0aW9uLCBhbmQgYSBkaXJlY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc29ydCcsIGZ1bmN0aW9uKHZhbHVlLCBzb3J0RnVuYywgZGlyKSB7XG4gICAgaWYgKCFzb3J0RnVuYyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgZGlyID0gKGRpciA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICBpZiAodHlwZW9mIHNvcnRGdW5jID09PSAnc3RyaW5nJykge1xuICAgICAgdmFyIHBhcnRzID0gc29ydEZ1bmMuc3BsaXQoJzonKTtcbiAgICAgIHZhciBwcm9wID0gcGFydHNbMF07XG4gICAgICB2YXIgZGlyMiA9IHBhcnRzWzFdO1xuICAgICAgZGlyMiA9IChkaXIyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgICAgZGlyID0gZGlyIHx8IGRpcjI7XG4gICAgICB2YXIgc29ydEZ1bmMgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhW3Byb3BdID4gYltwcm9wXSkgcmV0dXJuIGRpcjtcbiAgICAgICAgaWYgKGFbcHJvcF0gPCBiW3Byb3BdKSByZXR1cm4gLWRpcjtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoZGlyID09PSAtMSkge1xuICAgICAgdmFyIG9yaWdGdW5jID0gc29ydEZ1bmM7XG4gICAgICBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIC1vcmlnRnVuYyhhLCBiKTsgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUuc2xpY2UoKS5zb3J0KHNvcnRGdW5jKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYWRkUXVlcnlcbiAgICogVGFrZXMgdGhlIGlucHV0IFVSTCBhbmQgYWRkcyAob3IgcmVwbGFjZXMpIHRoZSBmaWVsZCBpbiB0aGUgcXVlcnlcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYWRkUXVlcnknLCBmdW5jdGlvbih2YWx1ZSwgcXVlcnlGaWVsZCwgcXVlcnlWYWx1ZSkge1xuICAgIHZhciB1cmwgPSB2YWx1ZSB8fCBsb2NhdGlvbi5ocmVmO1xuICAgIHZhciBwYXJ0cyA9IHVybC5zcGxpdCgnPycpO1xuICAgIHVybCA9IHBhcnRzWzBdO1xuICAgIHZhciBxdWVyeSA9IHBhcnRzWzFdO1xuICAgIHZhciBhZGRlZFF1ZXJ5ID0gJyc7XG4gICAgaWYgKHF1ZXJ5VmFsdWUgIT0gbnVsbCkge1xuICAgICAgYWRkZWRRdWVyeSA9IHF1ZXJ5RmllbGQgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQocXVlcnlWYWx1ZSk7XG4gICAgfVxuXG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB2YXIgZXhwciA9IG5ldyBSZWdFeHAoJ1xcXFxiJyArIHF1ZXJ5RmllbGQgKyAnPVteJl0qJyk7XG4gICAgICBpZiAoZXhwci50ZXN0KHF1ZXJ5KSkge1xuICAgICAgICBxdWVyeSA9IHF1ZXJ5LnJlcGxhY2UoZXhwciwgYWRkZWRRdWVyeSk7XG4gICAgICB9IGVsc2UgaWYgKGFkZGVkUXVlcnkpIHtcbiAgICAgICAgcXVlcnkgKz0gJyYnICsgYWRkZWRRdWVyeTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnkgPSBhZGRlZFF1ZXJ5O1xuICAgIH1cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHVybCArPSAnPycgKyBxdWVyeTtcbiAgICB9XG4gICAgcmV0dXJuIHVybDtcbiAgfSk7XG5cblxuICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcbiAgZnVuY3Rpb24gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgZGl2LmlubmVySFRNTCA9IHZhbHVlO1xuICAgICAgcmV0dXJuIGRpdi50ZXh0Q29udGVudDtcbiAgICB9IGVsc2Uge1xuICAgICAgZGl2LnRleHRDb250ZW50ID0gdmFsdWUgfHwgJyc7XG4gICAgICByZXR1cm4gZGl2LmlubmVySFRNTDtcbiAgICB9XG4gIH1cblxuXG4gIC8qKlxuICAgKiAjIyBlc2NhcGVcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQuIEZvciB1c2Ugd2l0aCBvdGhlciBIVE1MLWFkZGluZyBmb3JtYXR0ZXJzIHN1Y2ggYXMgYXV0b2xpbmsuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2VzY2FwZScsIGVzY2FwZUhUTUwpO1xuXG5cbiAgLyoqXG4gICAqICMjIHBcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgd3JhcHBpbmcgcGFyYWdyYXBocyBpbiA8cD4gdGFncy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBwIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PjxwPkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L3A+XG4gICAqIDxwPkl0J3MgZ3JlYXQ8L3A+PC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdwJywgZnVuY3Rpb24odmFsdWUsIHNldHRlcikge1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIHJldHVybiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbGluZXMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICB2YXIgZXNjYXBlZCA9IGxpbmVzLm1hcChmdW5jdGlvbihsaW5lKSB7IHJldHVybiBlc2NhcGVIVE1MKGxpbmUpIHx8ICc8YnI+JzsgfSk7XG4gICAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD5cXG48cD4nKSArICc8L3A+JztcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGJyXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IGFkZGluZyA8YnI+IHRhZ3MgaW4gcGxhY2Ugb2YgbmV3bGluZXMgY2hhcmFjdGVycy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBiciB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdicicsIGZ1bmN0aW9uKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICByZXR1cm4gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGxpbmVzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+XFxuJyk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBuZXdsaW5lXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IGFkZGluZyA8cD4gdGFncyBhdCBkb3VibGUgbmV3bGluZXMgYW5kIDxicj4gdGFncyBpbiBwbGFjZSBvZiBzaW5nbGUgbmV3bGluZSBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IG5ld2xpbmUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+PHA+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITxicj5cbiAgICogSXQncyBncmVhdDwvcD48L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ25ld2xpbmUnLCBmdW5jdGlvbih2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgcmV0dXJuIGVzY2FwZUhUTUwodmFsdWUsIHNldHRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBwYXJhZ3JhcGhzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcblxccypcXHI/XFxuLyk7XG4gICAgICB2YXIgZXNjYXBlZCA9IHBhcmFncmFwaHMubWFwKGZ1bmN0aW9uKHBhcmFncmFwaCkge1xuICAgICAgICB2YXIgbGluZXMgPSBwYXJhZ3JhcGguc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+XFxuJyk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiAnPHA+JyArIGVzY2FwZWQuam9pbignPC9wPlxcblxcbjxwPicpICsgJzwvcD4nO1xuICAgIH1cbiAgfSk7XG5cblxuXG4gIHZhciB1cmxFeHAgPSAvKF58XFxzfFxcKCkoKD86aHR0cHM/fGZ0cCk6XFwvXFwvW1xcLUEtWjAtOStcXHUwMDI2QCNcXC8lPz0oKX5ffCE6LC47XSpbXFwtQS1aMC05K1xcdTAwMjZAI1xcLyU9fihffF0pL2dpO1xuICAvKipcbiAgICogIyMgYXV0b2xpbmtcbiAgICogQWRkcyBhdXRvbWF0aWMgbGlua3MgdG8gZXNjYXBlZCBjb250ZW50IChiZSBzdXJlIHRvIGVzY2FwZSB1c2VyIGNvbnRlbnQpLiBDYW4gYmUgdXNlZCBvbiBleGlzdGluZyBIVE1MIGNvbnRlbnQgYXMgaXRcbiAgICogd2lsbCBza2lwIFVSTHMgd2l0aGluIEhUTUwgdGFncy4gUGFzc2luZyB0cnVlIGluIHRoZSBzZWNvbmQgcGFyYW1ldGVyIHdpbGwgc2V0IHRoZSB0YXJnZXQgdG8gYF9ibGFua2AuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2F1dG9saW5rJywgZnVuY3Rpb24odmFsdWUsIHRhcmdldCkge1xuICAgIHRhcmdldCA9ICh0YXJnZXQpID8gJyB0YXJnZXQ9XCJfYmxhbmtcIicgOiAnJztcblxuICAgIHJldHVybiAoJycgKyB2YWx1ZSkucmVwbGFjZSgvPFtePl0rPnxbXjxdKy9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgaWYgKG1hdGNoLmNoYXJBdCgwKSA9PT0gJzwnKSB7XG4gICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaC5yZXBsYWNlKHVybEV4cCwgJyQxPGEgaHJlZj1cIiQyXCInICsgdGFyZ2V0ICsgJz4kMjwvYT4nKTtcbiAgICB9KTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignaW50JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YWx1ZSA9IHBhcnNlSW50KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdmbG9hdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFsdWUgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdib29sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdmFsdWUgIT09ICcwJyAmJiB2YWx1ZSAhPT0gJ2ZhbHNlJztcbiAgfSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFRlbXBsYXRlO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cblxuLyoqXG4gKiAjIyBUZW1wbGF0ZVxuICogVGFrZXMgYW4gSFRNTCBzdHJpbmcsIGFuIGVsZW1lbnQsIGFuIGFycmF5IG9mIGVsZW1lbnRzLCBvciBhIGRvY3VtZW50IGZyYWdtZW50LCBhbmQgY29tcGlsZXMgaXQgaW50byBhIHRlbXBsYXRlLlxuICogSW5zdGFuY2VzIG1heSB0aGVuIGJlIGNyZWF0ZWQgYW5kIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gKiBmcm9tIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIG9iamVjdHMuIEFueSBvZiB0aGVzZSB3aWxsIGJlIGNvbnZlcnRlZCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQgZm9yIHRoZSB0ZW1wbGF0ZSB0b1xuICogY2xvbmUuIE5vZGVzIGFuZCBlbGVtZW50cyBwYXNzZWQgaW4gd2lsbCBiZSByZW1vdmVkIGZyb20gdGhlIERPTS5cbiAqL1xuZnVuY3Rpb24gVGVtcGxhdGUoKSB7XG4gIHRoaXMucG9vbCA9IFtdO1xufVxuXG5cblRlbXBsYXRlLnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyB2aWV3IGNsb25lZCBmcm9tIHRoaXMgdGVtcGxhdGUuXG4gICAqL1xuICBjcmVhdGVWaWV3OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5wb29sLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIHRoaXMucG9vbC5wb3AoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXh0ZW5kLm1ha2UoVmlldywgZG9jdW1lbnQuaW1wb3J0Tm9kZSh0aGlzLCB0cnVlKSwgdGhpcyk7XG4gIH0sXG5cbiAgcmV0dXJuVmlldzogZnVuY3Rpb24odmlldykge1xuICAgIGlmICh0aGlzLnBvb2wuaW5kZXhPZih2aWV3KSA9PT0gLTEpIHtcbiAgICAgIHRoaXMucG9vbC5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxufTtcbiIsIi8vIEhlbHBlciBtZXRob2RzIGZvciBhbmltYXRpb25cbmV4cG9ydHMubWFrZUVsZW1lbnRBbmltYXRhYmxlID0gbWFrZUVsZW1lbnRBbmltYXRhYmxlO1xuZXhwb3J0cy5nZXRDb21wdXRlZENTUyA9IGdldENvbXB1dGVkQ1NTO1xuZXhwb3J0cy5hbmltYXRlRWxlbWVudCA9IGFuaW1hdGVFbGVtZW50O1xuXG5mdW5jdGlvbiBtYWtlRWxlbWVudEFuaW1hdGFibGUoZWxlbWVudCkge1xuICAvLyBBZGQgcG9seWZpbGwganVzdCBvbiB0aGlzIGVsZW1lbnRcbiAgaWYgKCFlbGVtZW50LmFuaW1hdGUpIHtcbiAgICBlbGVtZW50LmFuaW1hdGUgPSBhbmltYXRlRWxlbWVudDtcbiAgfVxuXG4gIC8vIE5vdCBhIHBvbHlmaWxsIGJ1dCBhIGhlbHBlclxuICBpZiAoIWVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MpIHtcbiAgICBlbGVtZW50LmdldENvbXB1dGVkQ1NTID0gZ2V0Q29tcHV0ZWRDU1M7XG4gIH1cblxuICByZXR1cm4gZWxlbWVudDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIGNvbXB1dGVkIHN0eWxlIG9uIGFuIGVsZW1lbnQuXG4gKi9cbmZ1bmN0aW9uIGdldENvbXB1dGVkQ1NTKHN0eWxlTmFtZSkge1xuICBpZiAodGhpcy5vd25lckRvY3VtZW50LmRlZmF1bHRWaWV3Lm9wZW5lcikge1xuICAgIHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcuZ2V0Q29tcHV0ZWRTdHlsZSh0aGlzKVtzdHlsZU5hbWVdO1xuICB9XG4gIHJldHVybiB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSh0aGlzKVtzdHlsZU5hbWVdO1xufVxuXG4vKipcbiAqIFZlcnkgYmFzaWMgcG9seWZpbGwgZm9yIEVsZW1lbnQuYW5pbWF0ZSBpZiBpdCBkb2Vzbid0IGV4aXN0LiBJZiBpdCBkb2VzLCB1c2UgdGhlIG5hdGl2ZS5cbiAqIFRoaXMgb25seSBzdXBwb3J0cyB0d28gY3NzIHN0YXRlcy4gSXQgd2lsbCBvdmVyd3JpdGUgZXhpc3Rpbmcgc3R5bGVzLiBJdCBkb2Vzbid0IHJldHVybiBhbiBhbmltYXRpb24gcGxheSBjb250cm9sLiBJdFxuICogb25seSBzdXBwb3J0cyBkdXJhdGlvbiwgZGVsYXksIGFuZCBlYXNpbmcuIFJldHVybnMgYW4gb2JqZWN0IHdpdGggYSBwcm9wZXJ0eSBvbmZpbmlzaC5cbiAqL1xuZnVuY3Rpb24gYW5pbWF0ZUVsZW1lbnQoY3NzLCBvcHRpb25zKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShjc3MpIHx8IGNzcy5sZW5ndGggIT09IDIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdhbmltYXRlIHBvbHlmaWxsIHJlcXVpcmVzIGFuIGFycmF5IGZvciBjc3Mgd2l0aCBhbiBpbml0aWFsIGFuZCBmaW5hbCBzdGF0ZScpO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zIHx8ICFvcHRpb25zLmhhc093blByb3BlcnR5KCdkdXJhdGlvbicpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYW5pbWF0ZSBwb2x5ZmlsbCByZXF1aXJlcyBvcHRpb25zIHdpdGggYSBkdXJhdGlvbicpO1xuICB9XG5cbiAgdmFyIGR1cmF0aW9uID0gb3B0aW9ucy5kdXJhdGlvbiB8fCAwO1xuICB2YXIgZGVsYXkgPSBvcHRpb25zLmRlbGF5IHx8IDA7XG4gIHZhciBlYXNpbmcgPSBvcHRpb25zLmVhc2luZztcbiAgdmFyIGluaXRpYWxDc3MgPSBjc3NbMF07XG4gIHZhciBmaW5hbENzcyA9IGNzc1sxXTtcbiAgdmFyIGFsbENzcyA9IHt9O1xuICB2YXIgcGxheWJhY2sgPSB7IG9uZmluaXNoOiBudWxsIH07XG5cbiAgT2JqZWN0LmtleXMoaW5pdGlhbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gaW5pdGlhbENzc1trZXldO1xuICB9KTtcblxuICAvLyB0cmlnZ2VyIHJlZmxvd1xuICBlbGVtZW50Lm9mZnNldFdpZHRoO1xuXG4gIHZhciB0cmFuc2l0aW9uT3B0aW9ucyA9ICcgJyArIGR1cmF0aW9uICsgJ21zJztcbiAgaWYgKGVhc2luZykge1xuICAgIHRyYW5zaXRpb25PcHRpb25zICs9ICcgJyArIGVhc2luZztcbiAgfVxuICBpZiAoZGVsYXkpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBkZWxheSArICdtcyc7XG4gIH1cblxuICBlbGVtZW50LnN0eWxlLnRyYW5zaXRpb24gPSBPYmplY3Qua2V5cyhmaW5hbENzcykubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiBrZXkgKyB0cmFuc2l0aW9uT3B0aW9uc1xuICB9KS5qb2luKCcsICcpO1xuXG4gIE9iamVjdC5rZXlzKGZpbmFsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIGFsbENzc1trZXldID0gdHJ1ZTtcbiAgICBlbGVtZW50LnN0eWxlW2tleV0gPSBmaW5hbENzc1trZXldO1xuICB9KTtcblxuICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIE9iamVjdC5rZXlzKGFsbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9ICcnO1xuICAgIH0pO1xuXG4gICAgaWYgKHBsYXliYWNrLm9uZmluaXNoKSB7XG4gICAgICBwbGF5YmFjay5vbmZpbmlzaCgpO1xuICAgIH1cbiAgfSwgZHVyYXRpb24gKyBkZWxheSk7XG5cbiAgcmV0dXJuIHBsYXliYWNrO1xufVxuIiwidmFyIGdsb2JhbCA9IChmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMgfSkoKTtcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kO1xuZXh0ZW5kLm1ha2UgPSBtYWtlO1xuXG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBwcm90b3R5cGUgZm9yIHRoZSBnaXZlbiBjb250cnVjdG9yIGFuZCBzZXRzIGFuIGBleHRlbmRgIG1ldGhvZCBvbiBpdC4gSWYgYGV4dGVuZGAgaXMgY2FsbGVkIGZyb20gYVxuICogaXQgd2lsbCBleHRlbmQgdGhhdCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZXh0ZW5kKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpIHtcbiAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzID09PSBnbG9iYWwgPyBPYmplY3QgOiB0aGlzO1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nICYmICFwcm90b3R5cGUpIHtcbiAgICBwcm90b3R5cGUgPSBjb25zdHJ1Y3RvcjtcbiAgICBjb25zdHJ1Y3RvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbiAgY29uc3RydWN0b3IuZXh0ZW5kID0gZXh0ZW5kO1xuICB2YXIgZGVzY3JpcHRvcnMgPSBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKTtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckNsYXNzLnByb3RvdHlwZSwgZGVzY3JpcHRvcnMpO1xuICByZXR1cm4gY29uc3RydWN0b3I7XG59XG5cblxuLyoqXG4gKiBNYWtlcyBhIG5hdGl2ZSBvYmplY3QgcHJldGVuZCB0byBiZSBhIGNsYXNzIChlLmcuIGFkZHMgbWV0aG9kcyB0byBhIERvY3VtZW50RnJhZ21lbnQgYW5kIGNhbGxzIHRoZSBjb25zdHJ1Y3RvcikuXG4gKi9cbmZ1bmN0aW9uIG1ha2UoY29uc3RydWN0b3IsIG9iamVjdCkge1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZSBtdXN0IGFjY2VwdCBhIGZ1bmN0aW9uIGNvbnN0cnVjdG9yIGFuZCBhbiBvYmplY3QnKTtcbiAgfVxuICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgdmFyIHByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICBmb3IgKHZhciBrZXkgaW4gcHJvdG8pIHtcbiAgICBvYmplY3Rba2V5XSA9IHByb3RvW2tleV07XG4gIH1cbiAgY29uc3RydWN0b3IuYXBwbHkob2JqZWN0LCBhcmdzKTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuXG5mdW5jdGlvbiBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBkZXNjcmlwdG9ycyA9IHtcbiAgICBjb25zdHJ1Y3RvcjogeyB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogY29uc3RydWN0b3IgfVxuICB9O1xuXG4gIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbmFtZSk7XG4gICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZmFsc2U7XG4gICAgZGVzY3JpcHRvcnNbbmFtZV0gPSBkZXNjcmlwdG9yO1xuICB9KTtcbiAgcmV0dXJuIGRlc2NyaXB0b3JzO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB0b0ZyYWdtZW50O1xuXG4vLyBDb252ZXJ0IHN0dWZmIGludG8gZG9jdW1lbnQgZnJhZ21lbnRzLiBTdHVmZiBjYW4gYmU6XG4vLyAqIEEgc3RyaW5nIG9mIEhUTUwgdGV4dFxuLy8gKiBBbiBlbGVtZW50IG9yIHRleHQgbm9kZVxuLy8gKiBBIE5vZGVMaXN0IG9yIEhUTUxDb2xsZWN0aW9uIChlLmcuIGBlbGVtZW50LmNoaWxkTm9kZXNgIG9yIGBlbGVtZW50LmNoaWxkcmVuYClcbi8vICogQSBqUXVlcnkgb2JqZWN0XG4vLyAqIEEgc2NyaXB0IGVsZW1lbnQgd2l0aCBhIGB0eXBlYCBhdHRyaWJ1dGUgb2YgYFwidGV4dC8qXCJgIChlLmcuIGA8c2NyaXB0IHR5cGU9XCJ0ZXh0L2h0bWxcIj5NeSB0ZW1wbGF0ZSBjb2RlITwvc2NyaXB0PmApXG4vLyAqIEEgdGVtcGxhdGUgZWxlbWVudCAoZS5nLiBgPHRlbXBsYXRlPk15IHRlbXBsYXRlIGNvZGUhPC90ZW1wbGF0ZT5gKVxuZnVuY3Rpb24gdG9GcmFnbWVudChodG1sKSB7XG4gIGlmIChodG1sIGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICAgIHJldHVybiBodG1sO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBodG1sID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBzdHJpbmdUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2UgaWYgKGh0bWwgaW5zdGFuY2VvZiBOb2RlKSB7XG4gICAgcmV0dXJuIG5vZGVUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2UgaWYgKCdsZW5ndGgnIGluIGh0bWwpIHtcbiAgICByZXR1cm4gbGlzdFRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5zdXBwb3J0ZWQgVGVtcGxhdGUgVHlwZTogQ2Fubm90IGNvbnZlcnQgYCcgKyBodG1sICsgJ2AgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LicpO1xuICB9XG59XG5cbi8vIENvbnZlcnRzIGFuIEhUTUwgbm9kZSBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuIElmIGl0IGlzIGEgPHRlbXBsYXRlPiBub2RlIGl0cyBjb250ZW50cyB3aWxsIGJlIHVzZWQuIElmIGl0IGlzIGFcbi8vIDxzY3JpcHQ+IG5vZGUgaXRzIHN0cmluZy1iYXNlZCBjb250ZW50cyB3aWxsIGJlIGNvbnZlcnRlZCB0byBIVE1MIGZpcnN0LCB0aGVuIHVzZWQuIE90aGVyd2lzZSBhIGNsb25lIG9mIHRoZSBub2RlXG4vLyBpdHNlbGYgd2lsbCBiZSB1c2VkLlxuZnVuY3Rpb24gbm9kZVRvRnJhZ21lbnQobm9kZSkge1xuICBpZiAobm9kZS5jb250ZW50IGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICAgIHJldHVybiBub2RlLmNvbnRlbnQ7XG4gIH0gZWxzZSBpZiAobm9kZS50YWdOYW1lID09PSAnU0NSSVBUJykge1xuICAgIHJldHVybiBzdHJpbmdUb0ZyYWdtZW50KG5vZGUuaW5uZXJIVE1MKTtcbiAgfSBlbHNlIHtcbiAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgaWYgKG5vZGUudGFnTmFtZSA9PT0gJ1RFTVBMQVRFJykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBub2RlLmNoaWxkTm9kZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5vZGUuY2hpbGROb2Rlc1tpXSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gZnJhZ21lbnQ7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTENvbGxlY3Rpb24sIE5vZGVMaXN0LCBqUXVlcnkgb2JqZWN0LCBvciBhcnJheSBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG5mdW5jdGlvbiBsaXN0VG9GcmFnbWVudChsaXN0KSB7XG4gIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgZm9yICh2YXIgaSA9IDAsIGwgPSBsaXN0Lmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIC8vIFVzZSB0b0ZyYWdtZW50IHNpbmNlIHRoaXMgbWF5IGJlIGFuIGFycmF5IG9mIHRleHQsIGEgalF1ZXJ5IG9iamVjdCBvZiBgPHRlbXBsYXRlPmBzLCBldGMuXG4gICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodG9GcmFnbWVudChsaXN0W2ldKSk7XG4gICAgaWYgKGwgPT09IGxpc3QubGVuZ3RoICsgMSkge1xuICAgICAgLy8gYWRqdXN0IGZvciBOb2RlTGlzdHMgd2hpY2ggYXJlIGxpdmUsIHRoZXkgc2hyaW5rIGFzIHdlIHB1bGwgbm9kZXMgb3V0IG9mIHRoZSBET01cbiAgICAgIGktLTtcbiAgICAgIGwtLTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZyYWdtZW50O1xufVxuXG4vLyBDb252ZXJ0cyBhIHN0cmluZyBvZiBIVE1MIHRleHQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LlxuZnVuY3Rpb24gc3RyaW5nVG9GcmFnbWVudChzdHJpbmcpIHtcbiAgdmFyIHRlbXBsYXRlRWxlbWVudDtcbiAgdGVtcGxhdGVFbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKTtcbiAgdGVtcGxhdGVFbGVtZW50LmlubmVySFRNTCA9IHN0cmluZztcbiAgcmV0dXJuIHRlbXBsYXRlRWxlbWVudC5jb250ZW50O1xufVxuXG4vLyBJZiBIVE1MIFRlbXBsYXRlcyBhcmUgbm90IGF2YWlsYWJsZSAoZS5nLiBpbiBJRSkgdGhlbiB1c2UgYW4gb2xkZXIgbWV0aG9kIHRvIHdvcmsgd2l0aCBjZXJ0YWluIGVsZW1lbnRzLlxuaWYgKCFkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gIHN0cmluZ1RvRnJhZ21lbnQgPSAoZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRhZ0V4cCA9IC88KFtcXHc6LV0rKS87XG5cbiAgICAvLyBDb3BpZWQgZnJvbSBqUXVlcnkgKGh0dHBzOi8vZ2l0aHViLmNvbS9qcXVlcnkvanF1ZXJ5L2Jsb2IvbWFzdGVyL0xJQ0VOU0UudHh0KVxuICAgIHZhciB3cmFwTWFwID0ge1xuICAgICAgb3B0aW9uOiBbIDEsICc8c2VsZWN0IG11bHRpcGxlPVwibXVsdGlwbGVcIj4nLCAnPC9zZWxlY3Q+JyBdLFxuICAgICAgbGVnZW5kOiBbIDEsICc8ZmllbGRzZXQ+JywgJzwvZmllbGRzZXQ+JyBdLFxuICAgICAgdGhlYWQ6IFsgMSwgJzx0YWJsZT4nLCAnPC90YWJsZT4nIF0sXG4gICAgICB0cjogWyAyLCAnPHRhYmxlPjx0Ym9keT4nLCAnPC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIHRkOiBbIDMsICc8dGFibGU+PHRib2R5Pjx0cj4nLCAnPC90cj48L3Rib2R5PjwvdGFibGU+JyBdLFxuICAgICAgY29sOiBbIDIsICc8dGFibGU+PHRib2R5PjwvdGJvZHk+PGNvbGdyb3VwPicsICc8L2NvbGdyb3VwPjwvdGFibGU+JyBdLFxuICAgICAgYXJlYTogWyAxLCAnPG1hcD4nLCAnPC9tYXA+JyBdLFxuICAgICAgX2RlZmF1bHQ6IFsgMCwgJycsICcnIF1cbiAgICB9O1xuICAgIHdyYXBNYXAub3B0Z3JvdXAgPSB3cmFwTWFwLm9wdGlvbjtcbiAgICB3cmFwTWFwLnRib2R5ID0gd3JhcE1hcC50Zm9vdCA9IHdyYXBNYXAuY29sZ3JvdXAgPSB3cmFwTWFwLmNhcHRpb24gPSB3cmFwTWFwLnRoZWFkO1xuICAgIHdyYXBNYXAudGggPSB3cmFwTWFwLnRkO1xuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHN0cmluZ1RvRnJhZ21lbnQoc3RyaW5nKSB7XG4gICAgICB2YXIgdGFnID0gc3RyaW5nLm1hdGNoKHRhZ0V4cCk7XG4gICAgICB2YXIgcGFydHMgPSB3cmFwTWFwW3RhZ10gfHwgd3JhcE1hcC5fZGVmYXVsdDtcbiAgICAgIHZhciBkZXB0aCA9IHBhcnRzWzBdO1xuICAgICAgdmFyIHByZWZpeCA9IHBhcnRzWzFdO1xuICAgICAgdmFyIHBvc3RmaXggPSBwYXJ0c1syXTtcbiAgICAgIHZhciBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgIGRpdi5pbm5lckhUTUwgPSBwcmVmaXggKyBzdHJpbmcgKyBwb3N0Zml4O1xuICAgICAgd2hpbGUgKGRlcHRoLS0pIHtcbiAgICAgICAgZGl2ID0gZGl2Lmxhc3RDaGlsZDtcbiAgICAgIH1cbiAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChkaXYuZmlyc3RDaGlsZCkge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkaXYuZmlyc3RDaGlsZCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZnJhZ21lbnQ7XG4gICAgfTtcbiAgfSkoKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuXG4vKipcbiAqICMjIFZpZXdcbiAqIEEgRG9jdW1lbnRGcmFnbWVudCB3aXRoIGJpbmRpbmdzLlxuICovXG5mdW5jdGlvbiBWaWV3KHRlbXBsYXRlKSB7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy5iaW5kaW5ncyA9IHRoaXMudGVtcGxhdGUuYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gYmluZGluZy5jbG9uZUZvclZpZXcodGhpcyk7XG4gIH0sIHRoaXMpO1xuICB0aGlzLmZpcnN0Vmlld05vZGUgPSB0aGlzLmZpcnN0Q2hpbGQ7XG4gIHRoaXMubGFzdFZpZXdOb2RlID0gdGhpcy5sYXN0Q2hpbGQ7XG4gIGlmICh0aGlzLmZpcnN0Vmlld05vZGUpIHtcbiAgICB0aGlzLmZpcnN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gICAgdGhpcy5sYXN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gIH1cbn1cblxuXG5WaWV3LnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgZnJvbSB0aGUgRE9NLiBBIHZpZXcgaXMgYSBEb2N1bWVudEZyYWdtZW50LCBzbyBgcmVtb3ZlKClgIHJldHVybnMgYWxsIGl0cyBub2RlcyB0byBpdHNlbGYuXG4gICAqL1xuICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub2RlID0gdGhpcy5maXJzdFZpZXdOb2RlO1xuICAgIHZhciBuZXh0O1xuXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gdGhpcykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCB0aGUgbm9kZXMgYW5kIHB1dCB0aGVtIGJhY2sgaW50byB0aGlzIGZyYWdtZW50XG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBuZXh0ID0gKG5vZGUgPT09IHRoaXMubGFzdFZpZXdOb2RlKSA/IG51bGwgOiBub2RlLm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgdmlldyAoaWYgbm90IGFscmVhZHkgcmVtb3ZlZCkgYW5kIGFkZHMgdGhlIHZpZXcgdG8gaXRzIHRlbXBsYXRlJ3MgcG9vbC5cbiAgICovXG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgdmlldyBpcyByZW1vdmVkIGZyb20gdGhlIERPTVxuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmRpc3Bvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucmV0dXJuVmlldyh0aGlzKTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogQmluZHMgYSB2aWV3IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICovXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5iaW5kKGNvbnRleHQpO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVuYmluZHMgYSB2aWV3IGZyb20gYW55IGNvbnRleHQuXG4gICAqL1xuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLnVuYmluZCgpO1xuICAgIH0pO1xuICB9XG59O1xuIiwidmFyIEZyYWdtZW50cyA9IHJlcXVpcmUoJy4vc3JjL2ZyYWdtZW50cycpO1xudmFyIE9ic2VydmVyID0gcmVxdWlyZSgnLi9zcmMvb2JzZXJ2ZXInKTtcblxuZnVuY3Rpb24gY3JlYXRlKCkge1xuICB2YXIgZnJhZ21lbnRzID0gbmV3IEZyYWdtZW50cyhPYnNlcnZlcik7XG4gIGZyYWdtZW50cy5leHByZXNzaW9uID0gT2JzZXJ2ZXIuZXhwcmVzc2lvbjtcbiAgZnJhZ21lbnRzLnN5bmMgPSBPYnNlcnZlci5zeW5jO1xuICByZXR1cm4gZnJhZ21lbnRzO1xufVxuXG4vLyBDcmVhdGUgYW4gaW5zdGFuY2Ugb2YgZnJhZ21lbnRzIHdpdGggdGhlIGRlZmF1bHQgb2JzZXJ2ZXJcbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlKCk7XG5tb2R1bGUuZXhwb3J0cy5jcmVhdGUgPSBjcmVhdGU7XG4iXX0=
