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
  animateOut: function(node, dontDispose, callback) {
    if (typeof dontDispose === 'function') {
      callback = dontDispose;
      dontDispose = false;
    }
    if (node.firstViewNode) node = node.firstViewNode;

    this.animateNode('out', node, function() {
      if (!dontDispose) {
        node.view.dispose();
      }
      if (callback) callback.call(this);
    });
  },

  /**
   * Helper method to insert a node in the DOM before another node, allowing for animations to occur. `callback` will
   * be called when finished. If `before` is not provided then the animation will be run without inserting the node.
   */
  animateIn: function(node, before, callback) {
    if (typeof before === 'function') {
      callback = before;
      before = null;
    }
    if (node.firstViewNode) node = node.firstViewNode;
    if (before && before.firstViewNode) before = before.firstViewNode;

    if (before) {
      before.parentNode.insertBefore(node, before);
    }
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

      node.classList.add(willName);

      // trigger reflow
      node.offsetWidth = node.offsetWidth;
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
   *
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
    this.sync();
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
      var result = this.setter.call(this.context._origContext_ || this.context, Observer.formatters, value);
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
      if (this.animate) {
        this.updatedAnimated(index);
      } else {
        this.updatedRegular(index);
      }
    },

    add: function(view) {
      this.element.parentNode.insertBefore(view, this.element.nextSibling);
    },

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
        return;
      }

      if (this.showing) {
        this.animating = true;
        this.animateOut(this.showing, true, function() {
          this.animating = false;

          if (this.showing) {
            // Make sure this wasn't unbound while we were animating
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
      // Clean up
      if (this.showing) {
        this.showing.dispose();
        this.showing = null;
        this.lastValue = null;
        this.animating = false;
      }
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

    unbound: function() {
      if (this.views.length) {
        this.views.forEach(this.removeView);
        this.views.length = 0;
        this.animating = false;
        this.valueWhileAnimating = null;
      }
    },

    removeView: function(view) {
      view.dispose();
      view._repeatItem_ = null;
    },

    updated: function(value, oldValue, changes) {
      if (!changes) {
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
      this.animating = true;

      // Run updates which occured while this was animating.
      function whenDone() {
        // The last animation finished will run this
        if (--whenDone.count !== 0) return;

        this.animating = false;
        if (this.valueWhileAnimating) {
          var changes = diff.arrays(this.valueWhileAnimating, animatingValue);
          this.updateChangesAnimated(this.valueWhileAnimating, changes);
          this.valueWhileAnimating = null;
        }
      }
      whenDone.count = 0;

      var allAdded = [];
      var allRemoved = [];

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
        this.animateOut(view, whenDone);
      }, this);
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
  function escapeHTML(value) {
    div.textContent = value || '';
    return div.innerHTML;
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
  fragments.registerFormatter('p', function(value) {
    var lines = (value || '').split(/\r?\n/);
    var escaped = lines.map(function(line) { return escapeHTML(line) || '<br>'; });
    return '<p>' + escaped.join('</p><p>') + '</p>';
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
  fragments.registerFormatter('br', function(value) {
    var lines = (value || '').split(/\r?\n/);
    return lines.map(escapeHTML).join('<br>');
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
  fragments.registerFormatter('newline', function(value) {
    var paragraphs = (value || '').split(/\r?\n\s*\r?\n/);
    var escaped = paragraphs.map(function(paragraph) {
      var lines = paragraph.split(/\r?\n/);
      return lines.map(escapeHTML).join('<br>');
    });
    return '<p>' + escaped.join('</p><p>') + '</p>';
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
    this.unbind();
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvZGlmZi5qcyIsInNyYy9vYnNlcnZlci9leHByZXNzaW9uLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIiwiaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ25LQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdrQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4WUE7QUFDQTtBQUNBO0FBQ0E7O0FDSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdOQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3ekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3hGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IEFuaW1hdGVkQmluZGluZztcbnZhciBhbmltYXRpb24gPSByZXF1aXJlKCcuL3V0aWwvYW5pbWF0aW9uJyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIF9zdXBlciA9IEJpbmRpbmcucHJvdG90eXBlO1xuXG4vKipcbiAqIEJpbmRpbmdzIHdoaWNoIGV4dGVuZCBBbmltYXRlZEJpbmRpbmcgaGF2ZSB0aGUgYWJpbGl0eSB0byBhbmltYXRlIGVsZW1lbnRzIHRoYXQgYXJlIGFkZGVkIHRvIHRoZSBET00gYW5kIHJlbW92ZWQgZnJvbVxuICogdGhlIERPTS4gVGhpcyBhbGxvd3MgbWVudXMgdG8gc2xpZGUgb3BlbiBhbmQgY2xvc2VkLCBlbGVtZW50cyB0byBmYWRlIGluIG9yIGRyb3AgZG93biwgYW5kIHJlcGVhdGVkIGl0ZW1zIHRvIGFwcGVhclxuICogdG8gbW92ZSAoaWYgeW91IGdldCBjcmVhdGl2ZSBlbm91Z2gpLlxuICpcbiAqIFRoZSBmb2xsb3dpbmcgNSBtZXRob2RzIGFyZSBoZWxwZXIgRE9NIG1ldGhvZHMgdGhhdCBhbGxvdyByZWdpc3RlcmVkIGJpbmRpbmdzIHRvIHdvcmsgd2l0aCBDU1MgdHJhbnNpdGlvbnMgZm9yXG4gKiBhbmltYXRpbmcgZWxlbWVudHMuIElmIGFuIGVsZW1lbnQgaGFzIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIG9yIGEgbWF0Y2hpbmcgSmF2YVNjcmlwdCBtZXRob2QsIHRoZXNlIGhlbHBlciBtZXRob2RzXG4gKiB3aWxsIHNldCBhIGNsYXNzIG9uIHRoZSBub2RlIHRvIHRyaWdnZXIgdGhlIGFuaW1hdGlvbiBhbmQvb3IgY2FsbCB0aGUgSmF2YVNjcmlwdCBtZXRob2RzIHRvIGhhbmRsZSBpdC5cbiAqXG4gKiBBbiBhbmltYXRpb24gbWF5IGJlIGVpdGhlciBhIENTUyB0cmFuc2l0aW9uLCBhIENTUyBhbmltYXRpb24sIG9yIGEgc2V0IG9mIEphdmFTY3JpcHQgbWV0aG9kcyB0aGF0IHdpbGwgYmUgY2FsbGVkLlxuICpcbiAqIElmIHVzaW5nIENTUywgY2xhc3NlcyBhcmUgYWRkZWQgYW5kIHJlbW92ZWQgZnJvbSB0aGUgZWxlbWVudC4gV2hlbiBhbiBlbGVtZW50IGlzIGluc2VydGVkIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtXG4gKiBhbmltYXRlLWluYCBjbGFzcyBiZWZvcmUgYmVpbmcgYWRkZWQgdG8gdGhlIERPTSwgdGhlbiBpdCB3aWxsIHJlY2VpdmUgdGhlIGBhbmltYXRlLWluYCBjbGFzcyBpbW1lZGlhdGVseSBhZnRlciBiZWluZ1xuICogYWRkZWQgdG8gdGhlIERPTSwgdGhlbiBib3RoIGNsYXNlcyB3aWxsIGJlIHJlbW92ZWQgYWZ0ZXIgdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS4gV2hlbiBhbiBlbGVtZW50IGlzIGJlaW5nIHJlbW92ZWRcbiAqIGZyb20gdGhlIERPTSBpdCB3aWxsIHJlY2VpdmUgdGhlIGB3aWxsLWFuaW1hdGUtb3V0YCBhbmQgYGFuaW1hdGUtb3V0YCBjbGFzc2VzLCB0aGVuIHRoZSBjbGFzc2VzIHdpbGwgYmUgcmVtb3ZlZCBvbmNlXG4gKiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIElmIHVzaW5nIEphdmFTY3JpcHQsIG1ldGhvZHMgbXVzdCBiZSBkZWZpbmVkICB0byBhbmltYXRlIHRoZSBlbGVtZW50IHRoZXJlIGFyZSAzIHN1cHBvcnRlZCBtZXRob2RzIHdoaWNoIGNhbiBiXG4gKlxuICogVE9ETyBjYWNoZSBieSBjbGFzcy1uYW1lIChBbmd1bGFyKT8gT25seSBzdXBwb3J0IGphdmFzY3JpcHQtc3R5bGUgKEVtYmVyKT8gQWRkIGEgYHdpbGwtYW5pbWF0ZS1pbmAgYW5kXG4gKiBgZGlkLWFuaW1hdGUtaW5gIGV0Yy4/XG4gKiBJRiBoYXMgYW55IGNsYXNzZXMsIGFkZCB0aGUgYHdpbGwtYW5pbWF0ZS1pbnxvdXRgIGFuZCBnZXQgY29tcHV0ZWQgZHVyYXRpb24uIElmIG5vbmUsIHJldHVybi4gQ2FjaGUuXG4gKiBSVUxFIGlzIHVzZSB1bmlxdWUgY2xhc3MgdG8gZGVmaW5lIGFuIGFuaW1hdGlvbi4gT3IgYXR0cmlidXRlIGBhbmltYXRlPVwiZmFkZVwiYCB3aWxsIGFkZCB0aGUgY2xhc3M/XG4gKiBgLmZhZGUud2lsbC1hbmltYXRlLWluYCwgYC5mYWRlLmFuaW1hdGUtaW5gLCBgLmZhZGUud2lsbC1hbmltYXRlLW91dGAsIGAuZmFkZS5hbmltYXRlLW91dGBcbiAqXG4gKiBFdmVudHMgd2lsbCBiZSB0cmlnZ2VyZWQgb24gdGhlIGVsZW1lbnRzIG5hbWVkIHRoZSBzYW1lIGFzIHRoZSBjbGFzcyBuYW1lcyAoZS5nLiBgYW5pbWF0ZS1pbmApIHdoaWNoIG1heSBiZSBsaXN0ZW5lZFxuICogdG8gaW4gb3JkZXIgdG8gY2FuY2VsIGFuIGFuaW1hdGlvbiBvciByZXNwb25kIHRvIGl0LlxuICpcbiAqIElmIHRoZSBub2RlIGhhcyBtZXRob2RzIGBhbmltYXRlSW4oZG9uZSlgLCBgYW5pbWF0ZU91dChkb25lKWAsIGBhbmltYXRlTW92ZUluKGRvbmUpYCwgb3IgYGFuaW1hdGVNb3ZlT3V0KGRvbmUpYFxuICogZGVmaW5lZCBvbiB0aGVtIHRoZW4gdGhlIGhlbHBlcnMgd2lsbCBhbGxvdyBhbiBhbmltYXRpb24gaW4gSmF2YVNjcmlwdCB0byBiZSBydW4gYW5kIHdhaXQgZm9yIHRoZSBgZG9uZWAgZnVuY3Rpb24gdG9cbiAqIGJlIGNhbGxlZCB0byBrbm93IHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS5cbiAqXG4gKiBCZSBzdXJlIHRvIGFjdHVhbGx5IGhhdmUgYW4gYW5pbWF0aW9uIGRlZmluZWQgZm9yIGVsZW1lbnRzIHdpdGggdGhlIGBhbmltYXRlYCBjbGFzcy9hdHRyaWJ1dGUgYmVjYXVzZSB0aGUgaGVscGVycyB1c2VcbiAqIHRoZSBgdHJhbnNpdGlvbmVuZGAgYW5kIGBhbmltYXRpb25lbmRgIGV2ZW50cyB0byBrbm93IHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBmaW5pc2hlZCwgYW5kIGlmIHRoZXJlIGlzIG5vIGFuaW1hdGlvblxuICogdGhlc2UgZXZlbnRzIHdpbGwgbmV2ZXIgYmUgdHJpZ2dlcmVkIGFuZCB0aGUgb3BlcmF0aW9uIHdpbGwgbmV2ZXIgY29tcGxldGUuXG4gKi9cbmZ1bmN0aW9uIEFuaW1hdGVkQmluZGluZyhwcm9wZXJ0aWVzKSB7XG4gIHZhciBlbGVtZW50ID0gcHJvcGVydGllcy5ub2RlO1xuICB2YXIgYW5pbWF0ZSA9IGVsZW1lbnQuZ2V0QXR0cmlidXRlKHByb3BlcnRpZXMuZnJhZ21lbnRzLmFuaW1hdGVBdHRyaWJ1dGUpO1xuICB2YXIgZnJhZ21lbnRzID0gcHJvcGVydGllcy5mcmFnbWVudHM7XG5cbiAgaWYgKGFuaW1hdGUgIT09IG51bGwpIHtcbiAgICBpZiAoZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1RFTVBMQVRFJyB8fCBlbGVtZW50Lm5vZGVOYW1lID09PSAnU0NSSVBUJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgYW5pbWF0ZSBtdWx0aXBsZSBub2RlcyBpbiBhIHRlbXBsYXRlIG9yIHNjcmlwdC4gUmVtb3ZlIHRoZSBbYW5pbWF0ZV0gYXR0cmlidXRlLicpO1xuICAgIH1cblxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAvLyBBbGxvdyBtdWx0aXBsZSBiaW5kaW5ncyB0byBhbmltYXRlIGJ5IG5vdCByZW1vdmluZyB1bnRpbCB0aGV5IGhhdmUgYWxsIGJlZW4gY3JlYXRlZFxuICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUocHJvcGVydGllcy5mcmFnbWVudHMuYW5pbWF0ZUF0dHJpYnV0ZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFuaW1hdGUgPSB0cnVlO1xuXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCBhbmltYXRlKSkge1xuICAgICAgLy8gamF2YXNjcmlwdCBhbmltYXRpb25cbiAgICAgIHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgYW5pbWF0ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChhbmltYXRlWzBdID09PSAnLicpIHtcbiAgICAgICAgLy8gY2xhc3MgYW5pbWF0aW9uXG4gICAgICAgIHRoaXMuYW5pbWF0ZUNsYXNzTmFtZSA9IGFuaW1hdGUuc2xpY2UoMSk7XG4gICAgICB9IGVsc2UgaWYgKGFuaW1hdGUpIHtcbiAgICAgICAgLy8gcmVnaXN0ZXJlZCBhbmltYXRpb25cbiAgICAgICAgdmFyIGFuaW1hdGVPYmplY3QgPSBmcmFnbWVudHMuZ2V0QW5pbWF0aW9uKGFuaW1hdGUpO1xuICAgICAgICBpZiAodHlwZW9mIGFuaW1hdGVPYmplY3QgPT09ICdmdW5jdGlvbicpIGFuaW1hdGVPYmplY3QgPSBuZXcgYW5pbWF0ZU9iamVjdCh0aGlzKTtcbiAgICAgICAgdGhpcy5hbmltYXRlT2JqZWN0ID0gYW5pbWF0ZU9iamVjdDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBCaW5kaW5nLmNhbGwodGhpcywgcHJvcGVydGllcyk7XG59XG5cblxuQmluZGluZy5leHRlbmQoQW5pbWF0ZWRCaW5kaW5nLCB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIF9zdXBlci5pbml0LmNhbGwodGhpcyk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlRXhwcmVzc2lvbikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIgPSBuZXcgdGhpcy5PYnNlcnZlcih0aGlzLmFuaW1hdGVFeHByZXNzaW9uLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSB2YWx1ZTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH1cbiAgfSxcblxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci5iaW5kLmNhbGwodGhpcywgY29udGV4dCk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgfVxuICB9LFxuXG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBfc3VwZXIudW5iaW5kLmNhbGwodGhpcyk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyLnVuYmluZCgpO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byByZW1vdmUgYSBub2RlIGZyb20gdGhlIERPTSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbCBiZSBjYWxsZWQgd2hlblxuICAgKiBmaW5pc2hlZC5cbiAgICovXG4gIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKG5vZGUsIGRvbnREaXNwb3NlLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2YgZG9udERpc3Bvc2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGNhbGxiYWNrID0gZG9udERpc3Bvc2U7XG4gICAgICBkb250RGlzcG9zZSA9IGZhbHNlO1xuICAgIH1cbiAgICBpZiAobm9kZS5maXJzdFZpZXdOb2RlKSBub2RlID0gbm9kZS5maXJzdFZpZXdOb2RlO1xuXG4gICAgdGhpcy5hbmltYXRlTm9kZSgnb3V0Jywgbm9kZSwgZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIWRvbnREaXNwb3NlKSB7XG4gICAgICAgIG5vZGUudmlldy5kaXNwb3NlKCk7XG4gICAgICB9XG4gICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwodGhpcyk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gaW5zZXJ0IGEgbm9kZSBpbiB0aGUgRE9NIGJlZm9yZSBhbm90aGVyIG5vZGUsIGFsbG93aW5nIGZvciBhbmltYXRpb25zIHRvIG9jY3VyLiBgY2FsbGJhY2tgIHdpbGxcbiAgICogYmUgY2FsbGVkIHdoZW4gZmluaXNoZWQuIElmIGBiZWZvcmVgIGlzIG5vdCBwcm92aWRlZCB0aGVuIHRoZSBhbmltYXRpb24gd2lsbCBiZSBydW4gd2l0aG91dCBpbnNlcnRpbmcgdGhlIG5vZGUuXG4gICAqL1xuICBhbmltYXRlSW46IGZ1bmN0aW9uKG5vZGUsIGJlZm9yZSwgY2FsbGJhY2spIHtcbiAgICBpZiAodHlwZW9mIGJlZm9yZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBiZWZvcmU7XG4gICAgICBiZWZvcmUgPSBudWxsO1xuICAgIH1cbiAgICBpZiAobm9kZS5maXJzdFZpZXdOb2RlKSBub2RlID0gbm9kZS5maXJzdFZpZXdOb2RlO1xuICAgIGlmIChiZWZvcmUgJiYgYmVmb3JlLmZpcnN0Vmlld05vZGUpIGJlZm9yZSA9IGJlZm9yZS5maXJzdFZpZXdOb2RlO1xuXG4gICAgaWYgKGJlZm9yZSkge1xuICAgICAgYmVmb3JlLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKG5vZGUsIGJlZm9yZSk7XG4gICAgfVxuICAgIHRoaXMuYW5pbWF0ZU5vZGUoJ2luJywgbm9kZSwgY2FsbGJhY2ssIHRoaXMpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBBbGxvdyBhbiBlbGVtZW50IHRvIHVzZSBDU1MzIHRyYW5zaXRpb25zIG9yIGFuaW1hdGlvbnMgdG8gYW5pbWF0ZSBpbiBvciBvdXQgb2YgdGhlIHBhZ2UuXG4gICAqL1xuICBhbmltYXRlTm9kZTogZnVuY3Rpb24oZGlyZWN0aW9uLCBub2RlLCBjYWxsYmFjaykge1xuICAgIHZhciBhbmltYXRlT2JqZWN0LCBjbGFzc05hbWUsIG5hbWUsIHdpbGxOYW1lLCBkaWROYW1lLCBfdGhpcyA9IHRoaXM7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JqZWN0ICYmIHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdvYmplY3QnKSB7XG4gICAgICBhbmltYXRlT2JqZWN0ID0gdGhpcy5hbmltYXRlT2JqZWN0O1xuICAgIH0gZWxzZSBpZiAodGhpcy5hbmltYXRlQ2xhc3NOYW1lKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVDbGFzc05hbWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy5hbmltYXRlT2JqZWN0ID09PSAnc3RyaW5nJykge1xuICAgICAgY2xhc3NOYW1lID0gdGhpcy5hbmltYXRlT2JqZWN0O1xuICAgIH1cblxuICAgIGlmIChhbmltYXRlT2JqZWN0KSB7XG4gICAgICB2YXIgZGlyID0gZGlyZWN0aW9uID09PSAnaW4nID8gJ0luJyA6ICdPdXQnO1xuICAgICAgbmFtZSA9ICdhbmltYXRlJyArIGRpcjtcbiAgICAgIHdpbGxOYW1lID0gJ3dpbGxBbmltYXRlJyArIGRpcjtcbiAgICAgIGRpZE5hbWUgPSAnZGlkQW5pbWF0ZScgKyBkaXI7XG5cbiAgICAgIGFuaW1hdGlvbi5tYWtlRWxlbWVudEFuaW1hdGFibGUobm9kZSk7XG5cbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W3dpbGxOYW1lXSkge1xuICAgICAgICBhbmltYXRlT2JqZWN0W3dpbGxOYW1lXShub2RlKTtcbiAgICAgICAgLy8gdHJpZ2dlciByZWZsb3dcbiAgICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG4gICAgICB9XG5cbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W25hbWVdKSB7XG4gICAgICAgIGFuaW1hdGVPYmplY3RbbmFtZV0obm9kZSwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKGFuaW1hdGVPYmplY3RbZGlkTmFtZV0pIGFuaW1hdGVPYmplY3RbZGlkTmFtZV0obm9kZSk7XG4gICAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5hbWUgPSAnYW5pbWF0ZS0nICsgZGlyZWN0aW9uO1xuICAgICAgd2lsbE5hbWUgPSAnd2lsbC1hbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5hZGQoY2xhc3NOYW1lKTtcblxuICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKHdpbGxOYW1lKTtcblxuICAgICAgLy8gdHJpZ2dlciByZWZsb3dcbiAgICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgbm9kZS5jbGFzc0xpc3QucmVtb3ZlKHdpbGxOYW1lKTtcbiAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChuYW1lKTtcblxuICAgICAgdmFyIGR1cmF0aW9uID0gZ2V0RHVyYXRpb24uY2FsbCh0aGlzLCBub2RlLCBkaXJlY3Rpb24pO1xuICAgICAgZnVuY3Rpb24gd2hlbkRvbmUoKSB7XG4gICAgICAgIG5vZGUuY2xhc3NMaXN0LnJlbW92ZShuYW1lKTtcbiAgICAgICAgaWYgKGNsYXNzTmFtZSkgbm9kZS5jbGFzc0xpc3QucmVtb3ZlKGNsYXNzTmFtZSk7XG4gICAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbChfdGhpcyk7XG4gICAgICB9XG5cbiAgICAgIGlmIChkdXJhdGlvbikge1xuICAgICAgICBzZXRUaW1lb3V0KHdoZW5Eb25lLCBkdXJhdGlvbik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3aGVuRG9uZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufSk7XG5cblxudmFyIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAndHJhbnNpdGlvbkR1cmF0aW9uJztcbnZhciB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3RyYW5zaXRpb25EZWxheSc7XG52YXIgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ2FuaW1hdGlvbkR1cmF0aW9uJztcbnZhciBhbmltYXRpb25EZWxheU5hbWUgPSAnYW5pbWF0aW9uRGVsYXknO1xudmFyIHN0eWxlID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlO1xuaWYgKHN0eWxlLnRyYW5zaXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlLndlYmtpdFRyYW5zaXRpb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAnd2Via2l0VHJhbnNpdGlvbkR1cmF0aW9uJztcbiAgdHJhbnNpdGlvbkRlbGF5TmFtZSA9ICd3ZWJraXRUcmFuc2l0aW9uRGVsYXknO1xufVxuaWYgKHN0eWxlLmFuaW1hdGlvbkR1cmF0aW9uID09PSB1bmRlZmluZWQgJiYgc3R5bGUud2Via2l0QW5pbWF0aW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICBhbmltYXRpb25EdXJhdGlvbk5hbWUgPSAnd2Via2l0QW5pbWF0aW9uRHVyYXRpb24nO1xuICBhbmltYXRpb25EZWxheU5hbWUgPSAnd2Via2l0QW5pbWF0aW9uRGVsYXknO1xufVxuXG5cbmZ1bmN0aW9uIGdldER1cmF0aW9uKG5vZGUsIGRpcmVjdGlvbikge1xuICB2YXIgbWlsbGlzZWNvbmRzID0gdGhpcy5jbG9uZWRGcm9tWydfX2FuaW1hdGlvbkR1cmF0aW9uJyArIGRpcmVjdGlvbl07XG4gIGlmICghbWlsbGlzZWNvbmRzKSB7XG4gICAgLy8gUmVjYWxjIGlmIG5vZGUgd2FzIG91dCBvZiBET00gYmVmb3JlIGFuZCBoYWQgMCBkdXJhdGlvbiwgYXNzdW1lIHRoZXJlIGlzIGFsd2F5cyBTT01FIGR1cmF0aW9uLlxuICAgIHZhciBzdHlsZXMgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcbiAgICB2YXIgc2Vjb25kcyA9IE1hdGgubWF4KHBhcnNlRmxvYXQoc3R5bGVzW3RyYW5zaXRpb25EdXJhdGlvbk5hbWVdIHx8IDApICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW3RyYW5zaXRpb25EZWxheU5hbWVdIHx8IDApLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbYW5pbWF0aW9uRHVyYXRpb25OYW1lXSB8fCAwKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1thbmltYXRpb25EZWxheU5hbWVdIHx8IDApKTtcbiAgICBtaWxsaXNlY29uZHMgPSBzZWNvbmRzICogMTAwMCB8fCAwO1xuICAgIHRoaXMuY2xvbmVkRnJvbS5fX2FuaW1hdGlvbkR1cmF0aW9uX18gPSBtaWxsaXNlY29uZHM7XG4gIH1cbiAgcmV0dXJuIG1pbGxpc2Vjb25kcztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gQmluZGluZztcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cbi8qKlxuICogQSBiaW5kaW5nIGlzIGEgbGluayBiZXR3ZWVuIGFuIGVsZW1lbnQgYW5kIHNvbWUgZGF0YS4gU3ViY2xhc3NlcyBvZiBCaW5kaW5nIGNhbGxlZCBiaW5kZXJzIGRlZmluZSB3aGF0IGEgYmluZGluZyBkb2VzXG4gKiB3aXRoIHRoYXQgbGluay4gSW5zdGFuY2VzIG9mIHRoZXNlIGJpbmRlcnMgYXJlIGNyZWF0ZWQgYXMgYmluZGluZ3Mgb24gdGVtcGxhdGVzLiBXaGVuIGEgdmlldyBpcyBzdGFtcGVkIG91dCBmcm9tIHRoZVxuICogdGVtcGxhdGUgdGhlIGJpbmRpbmcgaXMgXCJjbG9uZWRcIiAoaXQgaXMgYWN0dWFsbHkgZXh0ZW5kZWQgZm9yIHBlcmZvcm1hbmNlKSBhbmQgdGhlIGBlbGVtZW50YC9gbm9kZWAgcHJvcGVydHkgaXNcbiAqIHVwZGF0ZWQgdG8gdGhlIG1hdGNoaW5nIGVsZW1lbnQgaW4gdGhlIHZpZXcuXG4gKlxuICogIyMjIFByb3BlcnRpZXNcbiAqICAqIGVsZW1lbnQ6IFRoZSBlbGVtZW50IChvciB0ZXh0IG5vZGUpIHRoaXMgYmluZGluZyBpcyBib3VuZCB0b1xuICogICogbm9kZTogQWxpYXMgb2YgZWxlbWVudCwgc2luY2UgYmluZGluZ3MgbWF5IGFwcGx5IHRvIHRleHQgbm9kZXMgdGhpcyBpcyBtb3JlIGFjY3VyYXRlXG4gKiAgKiBuYW1lOiBUaGUgYXR0cmlidXRlIG9yIGVsZW1lbnQgbmFtZSAoZG9lcyBub3QgYXBwbHkgdG8gbWF0Y2hlZCB0ZXh0IG5vZGVzKVxuICogICogbWF0Y2g6IFRoZSBtYXRjaGVkIHBhcnQgb2YgdGhlIG5hbWUgZm9yIHdpbGRjYXJkIGF0dHJpYnV0ZXMgKGUuZy4gYG9uLSpgIG1hdGNoaW5nIGFnYWluc3QgYG9uLWNsaWNrYCB3b3VsZCBoYXZlIGFcbiAqICAgIG1hdGNoIHByb3BlcnR5IGVxdWFsbGluZyBgY2xpY2tgKS4gVXNlIGB0aGlzLmNhbWVsQ2FzZWAgdG8gZ2V0IHRoZSBtYXRjaCBwcm9lcnR5IGNhbWVsQ2FzZWQuXG4gKiAgKiBleHByZXNzaW9uOiBUaGUgZXhwcmVzc2lvbiB0aGlzIGJpbmRpbmcgd2lsbCB1c2UgZm9yIGl0cyB1cGRhdGVzIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIGVsZW1lbnRzKVxuICogICogY29udGV4dDogVGhlIGNvbnRleHQgdGhlIGV4cmVzc2lvbiBvcGVyYXRlcyB3aXRoaW4gd2hlbiBib3VuZFxuICovXG5mdW5jdGlvbiBCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgaWYgKCFwcm9wZXJ0aWVzLm5vZGUgfHwgIXByb3BlcnRpZXMudmlldykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IHJlY2VpdmUgYSBub2RlIGFuZCBhIHZpZXcnKTtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgYW5kIG5vZGUgYXJlIGFsaWFzZXNcbiAgdGhpcy5fZWxlbWVudFBhdGggPSBpbml0Tm9kZVBhdGgocHJvcGVydGllcy5ub2RlLCBwcm9wZXJ0aWVzLnZpZXcpO1xuICB0aGlzLm5vZGUgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHRoaXMuZWxlbWVudCA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5uYW1lID0gcHJvcGVydGllcy5uYW1lO1xuICB0aGlzLm1hdGNoID0gcHJvcGVydGllcy5tYXRjaDtcbiAgdGhpcy5leHByZXNzaW9uID0gcHJvcGVydGllcy5leHByZXNzaW9uO1xuICB0aGlzLmZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xufVxuXG5leHRlbmQoQmluZGluZywge1xuICAvKipcbiAgICogRGVmYXVsdCBwcmlvcml0eSBiaW5kZXJzIG1heSBvdmVycmlkZS5cbiAgICovXG4gIHByaW9yaXR5OiAwLFxuXG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgYSBjbG9uZWQgYmluZGluZy4gVGhpcyBoYXBwZW5zIGFmdGVyIGEgY29tcGlsZWQgYmluZGluZyBvbiBhIHRlbXBsYXRlIGlzIGNsb25lZCBmb3IgYSB2aWV3LlxuICAgKi9cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuZXhwcmVzc2lvbikge1xuICAgICAgLy8gQW4gb2JzZXJ2ZXIgdG8gb2JzZXJ2ZSB2YWx1ZSBjaGFuZ2VzIHRvIHRoZSBleHByZXNzaW9uIHdpdGhpbiBhIGNvbnRleHRcbiAgICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgdGhpcy5PYnNlcnZlcih0aGlzLmV4cHJlc3Npb24sIHRoaXMudXBkYXRlZCwgdGhpcyk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlZCgpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDbG9uZSB0aGlzIGJpbmRpbmcgZm9yIGEgdmlldy4gVGhlIGVsZW1lbnQvbm9kZSB3aWxsIGJlIHVwZGF0ZWQgYW5kIHRoZSBiaW5kaW5nIHdpbGwgYmUgaW5pdGVkLlxuICAgKi9cbiAgY2xvbmVGb3JWaWV3OiBmdW5jdGlvbih2aWV3KSB7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBIGJpbmRpbmcgbXVzdCBjbG9uZSBhZ2FpbnN0IGEgdmlldycpO1xuICAgIH1cblxuICAgIHZhciBub2RlID0gdmlldztcbiAgICB0aGlzLl9lbGVtZW50UGF0aC5mb3JFYWNoKGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZE5vZGVzW2luZGV4XTtcbiAgICB9KTtcblxuICAgIHZhciBiaW5kaW5nID0gT2JqZWN0LmNyZWF0ZSh0aGlzKTtcbiAgICBiaW5kaW5nLmNsb25lZEZyb20gPSB0aGlzO1xuICAgIGJpbmRpbmcuZWxlbWVudCA9IG5vZGU7XG4gICAgYmluZGluZy5ub2RlID0gbm9kZTtcbiAgICBiaW5kaW5nLmluaXQoKTtcbiAgICByZXR1cm4gYmluZGluZztcbiAgfSxcblxuXG4gIC8vIEJpbmQgdGhpcyB0byB0aGUgZ2l2ZW4gY29udGV4dCBvYmplY3RcbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT0gY29udGV4dCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgaWYgKHRoaXMub2JzZXJ2ZXIpIHtcbiAgICAgIGlmICh0aGlzLnVwZGF0ZWQgIT09IEJpbmRpbmcucHJvdG90eXBlLnVwZGF0ZWQpIHtcbiAgICAgICAgdGhpcy5vYnNlcnZlci5mb3JjZVVwZGF0ZU5leHRTeW5jID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5vYnNlcnZlci5iaW5kKGNvbnRleHQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gc2V0IHRoZSBjb250ZXh0IGJ1dCBkb24ndCBhY3R1YWxseSBiaW5kIGl0IHNpbmNlIGB1cGRhdGVkYCBpcyBhIG5vLW9wXG4gICAgICAgIHRoaXMub2JzZXJ2ZXIuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgICB9XG4gICAgfVxuICAgIHRoaXMuYm91bmQoKTtcbiAgfSxcblxuXG4gIC8vIFVuYmluZCB0aGlzIGZyb20gaXRzIGNvbnRleHRcbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci51bmJpbmQoKTtcbiAgICB0aGlzLnVuYm91bmQoKTtcbiAgfSxcblxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY29tcGlsZWQgd2l0aGluIGEgdGVtcGxhdGVcbiAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjcmVhdGVkXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBleHByZXNzaW9uJ3MgdmFsdWUgY2hhbmdlc1xuICB1cGRhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBib3VuZFxuICBib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgdW5ib3VuZFxuICB1bmJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIEhlbHBlciBtZXRob2RzXG5cbiAgZ2V0IGNhbWVsQ2FzZSgpIHtcbiAgICByZXR1cm4gKHRoaXMubWF0Y2ggfHwgdGhpcy5uYW1lIHx8ICcnKS5yZXBsYWNlKC8tKyhcXHcpL2csIGZ1bmN0aW9uKF8sIGNoYXIpIHtcbiAgICAgIHJldHVybiBjaGFyLnRvVXBwZXJDYXNlKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgb2JzZXJ2ZTogZnVuY3Rpb24oZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICAgIHJldHVybiBuZXcgdGhpcy5PYnNlcnZlcihleHByZXNzaW9uLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0IHx8IHRoaXMpO1xuICB9XG59KTtcblxuXG5cblxudmFyIGluZGV4T2YgPSBBcnJheS5wcm90b3R5cGUuaW5kZXhPZjtcblxuLy8gQ3JlYXRlcyBhbiBhcnJheSBvZiBpbmRleGVzIHRvIGhlbHAgZmluZCB0aGUgc2FtZSBlbGVtZW50IHdpdGhpbiBhIGNsb25lZCB2aWV3XG5mdW5jdGlvbiBpbml0Tm9kZVBhdGgobm9kZSwgdmlldykge1xuICB2YXIgcGF0aCA9IFtdO1xuICB3aGlsZSAobm9kZSAhPT0gdmlldykge1xuICAgIHZhciBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgcGF0aC51bnNoaWZ0KGluZGV4T2YuY2FsbChwYXJlbnQuY2hpbGROb2Rlcywgbm9kZSkpO1xuICAgIG5vZGUgPSBwYXJlbnQ7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG4iLCJ2YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBpbGU7XG5cblxuLy8gV2Fsa3MgdGhlIHRlbXBsYXRlIERPTSByZXBsYWNpbmcgYW55IGJpbmRpbmdzIGFuZCBjYWNoaW5nIGJpbmRpbmdzIG9udG8gdGhlIHRlbXBsYXRlIG9iamVjdC5cbmZ1bmN0aW9uIGNvbXBpbGUoZnJhZ21lbnRzLCB0ZW1wbGF0ZSkge1xuICB2YXIgd2Fsa2VyID0gZG9jdW1lbnQuY3JlYXRlVHJlZVdhbGtlcih0ZW1wbGF0ZSwgTm9kZUZpbHRlci5TSE9XX0VMRU1FTlQgfCBOb2RlRmlsdGVyLlNIT1dfVEVYVCk7XG4gIHZhciBiaW5kaW5ncyA9IFtdLCBjdXJyZW50Tm9kZSwgcGFyZW50Tm9kZSwgcHJldmlvdXNOb2RlO1xuXG4gIC8vIFJlc2V0IGZpcnN0IG5vZGUgdG8gZW5zdXJlIGl0IGlzbid0IGEgZnJhZ21lbnRcbiAgd2Fsa2VyLm5leHROb2RlKCk7XG4gIHdhbGtlci5wcmV2aW91c05vZGUoKTtcblxuICAvLyBmaW5kIGJpbmRpbmdzIGZvciBlYWNoIG5vZGVcbiAgZG8ge1xuICAgIGN1cnJlbnROb2RlID0gd2Fsa2VyLmN1cnJlbnROb2RlO1xuICAgIHBhcmVudE5vZGUgPSBjdXJyZW50Tm9kZS5wYXJlbnROb2RlO1xuICAgIGJpbmRpbmdzLnB1c2guYXBwbHkoYmluZGluZ3MsIGdldEJpbmRpbmdzRm9yTm9kZShmcmFnbWVudHMsIGN1cnJlbnROb2RlLCB0ZW1wbGF0ZSkpO1xuXG4gICAgaWYgKGN1cnJlbnROb2RlLnBhcmVudE5vZGUgIT09IHBhcmVudE5vZGUpIHtcbiAgICAgIC8vIGN1cnJlbnROb2RlIHdhcyByZW1vdmVkIGFuZCBtYWRlIGEgdGVtcGxhdGVcbiAgICAgIHdhbGtlci5jdXJyZW50Tm9kZSA9IHByZXZpb3VzTm9kZSB8fCB3YWxrZXIucm9vdDtcbiAgICB9IGVsc2Uge1xuICAgICAgcHJldmlvdXNOb2RlID0gY3VycmVudE5vZGU7XG4gICAgfVxuICB9IHdoaWxlICh3YWxrZXIubmV4dE5vZGUoKSk7XG5cbiAgcmV0dXJuIGJpbmRpbmdzO1xufVxuXG5cblxuLy8gRmluZCBhbGwgdGhlIGJpbmRpbmdzIG9uIGEgZ2l2ZW4gbm9kZSAodGV4dCBub2RlcyB3aWxsIG9ubHkgZXZlciBoYXZlIG9uZSBiaW5kaW5nKS5cbmZ1bmN0aW9uIGdldEJpbmRpbmdzRm9yTm9kZShmcmFnbWVudHMsIG5vZGUsIHZpZXcpIHtcbiAgdmFyIGJpbmRpbmdzID0gW107XG4gIHZhciBCaW5kZXIsIGJpbmRpbmcsIGV4cHIsIGJvdW5kLCBtYXRjaCwgYXR0ciwgaTtcblxuICBpZiAobm9kZS5ub2RlVHlwZSA9PT0gTm9kZS5URVhUX05PREUpIHtcbiAgICBzcGxpdFRleHROb2RlKGZyYWdtZW50cywgbm9kZSk7XG5cbiAgICAvLyBGaW5kIGFueSBiaW5kaW5nIGZvciB0aGUgdGV4dCBub2RlXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpKSB7XG4gICAgICBleHByID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ3RleHQnLCBub2RlLm5vZGVWYWx1ZSk7XG4gICAgICBub2RlLm5vZGVWYWx1ZSA9ICcnO1xuICAgICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ3RleHQnLCBleHByKTtcbiAgICAgIGJpbmRpbmcgPSBuZXcgQmluZGVyKHsgbm9kZTogbm9kZSwgdmlldzogdmlldywgZXhwcmVzc2lvbjogZXhwciwgZnJhZ21lbnRzOiBmcmFnbWVudHMgfSk7XG4gICAgICBpZiAoYmluZGluZy5jb21waWxlZCgpICE9PSBmYWxzZSkge1xuICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiB0aGUgZWxlbWVudCBpcyByZW1vdmVkIGZyb20gdGhlIERPTSwgc3RvcC4gQ2hlY2sgYnkgbG9va2luZyBhdCBpdHMgcGFyZW50Tm9kZVxuICAgIHZhciBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgdmFyIERlZmF1bHRCaW5kZXIgPSBmcmFnbWVudHMuZ2V0QXR0cmlidXRlQmluZGVyKCdfX2RlZmF1bHRfXycpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIGVsZW1lbnRcbiAgICBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignZWxlbWVudCcsIG5vZGUudGFnTmFtZS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoQmluZGVyKSB7XG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pO1xuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiByZW1vdmVkLCBtYWRlIGEgdGVtcGxhdGUsIGRvbid0IGNvbnRpbnVlIHByb2Nlc3NpbmdcbiAgICBpZiAobm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBGaW5kIGFuZCBhZGQgYW55IGF0dHJpYnV0ZSBiaW5kaW5ncyBvbiBhbiBlbGVtZW50LiBUaGVzZSBjYW4gYmUgYXR0cmlidXRlcyB3aG9zZSBuYW1lIG1hdGNoZXMgYSBiaW5kaW5nLCBvclxuICAgIC8vIHRoZXkgY2FuIGJlIGF0dHJpYnV0ZXMgd2hpY2ggaGF2ZSBhIGJpbmRpbmcgaW4gdGhlIHZhbHVlIHN1Y2ggYXMgYGhyZWY9XCIvcG9zdC97eyBwb3N0LmlkIH19XCJgLlxuICAgIHZhciBib3VuZCA9IFtdO1xuICAgIHZhciBhdHRyaWJ1dGVzID0gc2xpY2UuY2FsbChub2RlLmF0dHJpYnV0ZXMpO1xuICAgIGZvciAoaSA9IDAsIGwgPSBhdHRyaWJ1dGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIGF0dHIgPSBhdHRyaWJ1dGVzW2ldO1xuICAgICAgdmFyIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCdhdHRyaWJ1dGUnLCBhdHRyLm5hbWUsIGF0dHIudmFsdWUpO1xuICAgICAgaWYgKEJpbmRlcikge1xuICAgICAgICBib3VuZC5wdXNoKFsgQmluZGVyLCBhdHRyIF0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1ha2Ugc3VyZSB0byBjcmVhdGUgYW5kIHByb2Nlc3MgdGhlbSBpbiB0aGUgY29ycmVjdCBwcmlvcml0eSBvcmRlciBzbyBpZiBhIGJpbmRpbmcgY3JlYXRlIGEgdGVtcGxhdGUgZnJvbSB0aGVcbiAgICAvLyBub2RlIGl0IGRvZXNuJ3QgcHJvY2VzcyB0aGUgb3RoZXJzLlxuICAgIGJvdW5kLnNvcnQoc29ydEF0dHJpYnV0ZXMpO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IGJvdW5kLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgQmluZGVyID0gYm91bmRbaV1bMF07XG4gICAgICB2YXIgYXR0ciA9IGJvdW5kW2ldWzFdO1xuICAgICAgdmFyIG5hbWUgPSBhdHRyLm5hbWU7XG4gICAgICB2YXIgdmFsdWUgPSBhdHRyLnZhbHVlO1xuICAgICAgaWYgKEJpbmRlci5leHByKSB7XG4gICAgICAgIG1hdGNoID0gbmFtZS5tYXRjaChCaW5kZXIuZXhwcik7XG4gICAgICAgIGlmIChtYXRjaCkgbWF0Y2ggPSBtYXRjaFsxXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1hdGNoID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGVOb2RlKGF0dHIpO1xuICAgICAgfSBjYXRjaChlKSB7fVxuXG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7XG4gICAgICAgIG5vZGU6IG5vZGUsXG4gICAgICAgIHZpZXc6IHZpZXcsXG4gICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgIG1hdGNoOiBtYXRjaCxcbiAgICAgICAgZXhwcmVzc2lvbjogdmFsdWUgPyBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgdmFsdWUpIDogbnVsbCxcbiAgICAgICAgZnJhZ21lbnRzOiBmcmFnbWVudHNcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoYmluZGluZy5jb21waWxlZCgpICE9PSBmYWxzZSkge1xuICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgfSBlbHNlIGlmIChCaW5kZXIgIT09IERlZmF1bHRCaW5kZXIgJiYgZnJhZ21lbnRzLmlzQm91bmQoJ2F0dHJpYnV0ZScsIHZhbHVlKSkge1xuICAgICAgICAvLyBSZXZlcnQgdG8gZGVmYXVsdCBpZiB0aGlzIGJpbmRpbmcgZG9lc24ndCB0YWtlXG4gICAgICAgIGJvdW5kLnB1c2goWyBEZWZhdWx0QmluZGVyLCBhdHRyIF0pO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJpbmRpbmdzO1xufVxuXG5cbi8vIFNwbGl0cyB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSBzbyB0aGV5IGNhbiBiZSBib3VuZCBpbmRpdmlkdWFsbHksIGhhcyBwYXJlbnROb2RlIHBhc3NlZCBpbiBzaW5jZSBpdCBtYXlcbi8vIGJlIGEgZG9jdW1lbnQgZnJhZ21lbnQgd2hpY2ggYXBwZWFycyBhcyBudWxsIG9uIG5vZGUucGFyZW50Tm9kZS5cbmZ1bmN0aW9uIHNwbGl0VGV4dE5vZGUoZnJhZ21lbnRzLCBub2RlKSB7XG4gIGlmICghbm9kZS5wcm9jZXNzZWQpIHtcbiAgICBub2RlLnByb2Nlc3NlZCA9IHRydWU7XG4gICAgdmFyIHJlZ2V4ID0gZnJhZ21lbnRzLmJpbmRlcnMudGV4dC5fZXhwcjtcbiAgICB2YXIgY29udGVudCA9IG5vZGUubm9kZVZhbHVlO1xuICAgIGlmIChjb250ZW50Lm1hdGNoKHJlZ2V4KSkge1xuICAgICAgdmFyIG1hdGNoLCBsYXN0SW5kZXggPSAwLCBwYXJ0cyA9IFtdLCBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChtYXRjaCA9IHJlZ2V4LmV4ZWMoY29udGVudCkpIHtcbiAgICAgICAgcGFydHMucHVzaChjb250ZW50LnNsaWNlKGxhc3RJbmRleCwgcmVnZXgubGFzdEluZGV4IC0gbWF0Y2hbMF0ubGVuZ3RoKSk7XG4gICAgICAgIHBhcnRzLnB1c2gobWF0Y2hbMF0pO1xuICAgICAgICBsYXN0SW5kZXggPSByZWdleC5sYXN0SW5kZXg7XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4KSk7XG4gICAgICBwYXJ0cyA9IHBhcnRzLmZpbHRlcihub3RFbXB0eSk7XG5cbiAgICAgIG5vZGUubm9kZVZhbHVlID0gcGFydHNbMF07XG4gICAgICBmb3IgKHZhciBpID0gMTsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBuZXdUZXh0Tm9kZSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHBhcnRzW2ldKTtcbiAgICAgICAgbmV3VGV4dE5vZGUucHJvY2Vzc2VkID0gdHJ1ZTtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobmV3VGV4dE5vZGUpO1xuICAgICAgfVxuICAgICAgbm9kZS5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbm9kZS5uZXh0U2libGluZyk7XG4gICAgfVxuICB9XG59XG5cblxuZnVuY3Rpb24gc29ydEF0dHJpYnV0ZXMoYSwgYikge1xuICByZXR1cm4gYlswXS5wcm90b3R5cGUucHJpb3JpdHkgLSBhWzBdLnByb3RvdHlwZS5wcmlvcml0eTtcbn1cblxuZnVuY3Rpb24gbm90RW1wdHkodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBGcmFnbWVudHM7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xudmFyIHRvRnJhZ21lbnQgPSByZXF1aXJlKCcuL3V0aWwvdG9GcmFnbWVudCcpO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIEFuaW1hdGVkQmluZGluZyA9IHJlcXVpcmUoJy4vYW5pbWF0ZWRCaW5kaW5nJyk7XG52YXIgY29tcGlsZSA9IHJlcXVpcmUoJy4vY29tcGlsZScpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEJpbmRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYmluZGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEZvcm1hdHRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvZm9ybWF0dGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEFuaW1hdGlvbnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucycpO1xuXG4vKipcbiAqIEEgRnJhZ21lbnRzIG9iamVjdCBzZXJ2ZXMgYXMgYSByZWdpc3RyeSBmb3IgYmluZGVycyBhbmQgZm9ybWF0dGVyc1xuICogQHBhcmFtIHtbdHlwZV19IE9ic2VydmVyQ2xhc3MgW2Rlc2NyaXB0aW9uXVxuICovXG5mdW5jdGlvbiBGcmFnbWVudHMoT2JzZXJ2ZXJDbGFzcykge1xuICBpZiAoIU9ic2VydmVyQ2xhc3MpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNdXN0IHByb3ZpZGUgYW4gT2JzZXJ2ZXIgY2xhc3MgdG8gRnJhZ21lbnRzLicpO1xuICB9XG5cbiAgdGhpcy5PYnNlcnZlciA9IE9ic2VydmVyQ2xhc3M7XG4gIHRoaXMuZm9ybWF0dGVycyA9IE9ic2VydmVyQ2xhc3MuZm9ybWF0dGVycyA9IHt9O1xuICB0aGlzLmFuaW1hdGlvbnMgPSB7fTtcbiAgdGhpcy5hbmltYXRlQXR0cmlidXRlID0gJ2FuaW1hdGUnO1xuXG4gIHRoaXMuYmluZGVycyA9IHtcbiAgICBlbGVtZW50OiB7IF93aWxkY2FyZHM6IFtdIH0sXG4gICAgYXR0cmlidXRlOiB7IF93aWxkY2FyZHM6IFtdLCBfZXhwcjogL3t7XFxzKiguKj8pXFxzKn19L2cgfSxcbiAgICB0ZXh0OiB7IF93aWxkY2FyZHM6IFtdLCBfZXhwcjogL3t7XFxzKiguKj8pXFxzKn19L2cgfVxuICB9O1xuXG4gIC8vIFRleHQgYmluZGVyIGZvciB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyVGV4dCgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSAhPSBudWxsKSA/IHZhbHVlIDogJyc7XG4gIH0pO1xuXG4gIC8vIENhdGNoYWxsIGF0dHJpYnV0ZSBiaW5kZXIgZm9yIHJlZ3VsYXIgYXR0cmlidXRlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlckF0dHJpYnV0ZSgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKHRoaXMubmFtZSwgdmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMubmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZWdpc3RlckRlZmF1bHRCaW5kZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zKHRoaXMpO1xufVxuXG5GcmFnbWVudHMucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gICAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gICAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gICAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gICAqL1xuICBjcmVhdGVUZW1wbGF0ZTogZnVuY3Rpb24oaHRtbCkge1xuICAgIHZhciBmcmFnbWVudCA9IHRvRnJhZ21lbnQoaHRtbCk7XG4gICAgaWYgKGZyYWdtZW50LmNoaWxkTm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tICcgKyBodG1sKTtcbiAgICB9XG4gICAgdmFyIHRlbXBsYXRlID0gZXh0ZW5kLm1ha2UoVGVtcGxhdGUsIGZyYWdtZW50KTtcbiAgICB0ZW1wbGF0ZS5iaW5kaW5ncyA9IGNvbXBpbGUodGhpcywgdGVtcGxhdGUpO1xuICAgIHJldHVybiB0ZW1wbGF0ZTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb21waWxlcyBiaW5kaW5ncyBvbiBhbiBlbGVtZW50LlxuICAgKi9cbiAgY29tcGlsZUVsZW1lbnQ6IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICBpZiAoIWVsZW1lbnQuYmluZGluZ3MpIHtcbiAgICAgIGVsZW1lbnQuYmluZGluZ3MgPSBjb21waWxlKHRoaXMsIGVsZW1lbnQpO1xuICAgICAgZXh0ZW5kLm1ha2UoVmlldywgZWxlbWVudCwgZWxlbWVudCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYW5kIGJpbmRzIGFuIGVsZW1lbnQgd2hpY2ggd2FzIG5vdCBjcmVhdGVkIGZyb20gYSB0ZW1wbGF0ZS4gTW9zdGx5IG9ubHkgdXNlZCBmb3IgYmluZGluZyB0aGUgZG9jdW1lbnQnc1xuICAgKiBodG1sIGVsZW1lbnQuXG4gICAqL1xuICBiaW5kRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCwgY29udGV4dCkge1xuICAgIHRoaXMuY29tcGlsZUVsZW1lbnQoZWxlbWVudCk7XG5cbiAgICBpZiAoY29udGV4dCkge1xuICAgICAgZWxlbWVudC5iaW5kKGNvbnRleHQpO1xuICAgIH1cblxuICAgIHJldHVybiBlbGVtZW50O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGJpbmRlciBmb3IgYSBnaXZlbiB0eXBlIGFuZCBuYW1lLiBBIGJpbmRlciBpcyBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgYW5kIGlzIHVzZWQgdG8gY3JlYXRlIGJpbmRpbmdzIG9uXG4gICAqIGFuIGVsZW1lbnQgb3IgdGV4dCBub2RlIHdob3NlIHRhZyBuYW1lLCBhdHRyaWJ1dGUgbmFtZSwgb3IgZXhwcmVzc2lvbiBjb250ZW50cyBtYXRjaCB0aGlzIGJpbmRlcidzIG5hbWUvZXhwcmVzc2lvbi5cbiAgICpcbiAgICogIyMjIFBhcmFtZXRlcnNcbiAgICpcbiAgICogICogYHR5cGVgOiB0aGVyZSBhcmUgdGhyZWUgdHlwZXMgb2YgYmluZGVyczogZWxlbWVudCwgYXR0cmlidXRlLCBvciB0ZXh0LiBUaGVzZSBjb3JyZXNwb25kIHRvIG1hdGNoaW5nIGFnYWluc3QgYW5cbiAgICogICAgZWxlbWVudCdzIHRhZyBuYW1lLCBhbiBlbGVtZW50IHdpdGggdGhlIGdpdmVuIGF0dHJpYnV0ZSBuYW1lLCBvciBhIHRleHQgbm9kZSB0aGF0IG1hdGNoZXMgdGhlIHByb3ZpZGVkXG4gICAqICAgIGV4cHJlc3Npb24uXG4gICAqXG4gICAqICAqIGBuYW1lYDogdG8gbWF0Y2gsIGEgYmluZGVyIG5lZWRzIHRoZSBuYW1lIG9mIGFuIGVsZW1lbnQgb3IgYXR0cmlidXRlLCBvciBhIHJlZ3VsYXIgZXhwcmVzc2lvbiB0aGF0IG1hdGNoZXMgYVxuICAgKiAgICBnaXZlbiB0ZXh0IG5vZGUuIE5hbWVzIGZvciBlbGVtZW50cyBhbmQgYXR0cmlidXRlcyBjYW4gYmUgcmVndWxhciBleHByZXNzaW9ucyBhcyB3ZWxsLCBvciB0aGV5IG1heSBiZSB3aWxkY2FyZFxuICAgKiAgICBuYW1lcyBieSB1c2luZyBhbiBhc3Rlcmlzay5cbiAgICpcbiAgICogICogYGRlZmluaXRpb25gOiBhIGJpbmRlciBpcyBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgd2hpY2ggb3ZlcnJpZGVzIGtleSBtZXRob2RzLCBgY29tcGlsZWRgLCBgY3JlYXRlZGAsIGB1cGRhdGVkYCxcbiAgICogICAgYGJvdW5kYCwgYW5kIGB1bmJvdW5kYC4gVGhlIGRlZmluaXRpb24gbWF5IGJlIGFuIGFjdHVhbCBzdWJjbGFzcyBvZiBCaW5kaW5nIG9yIGl0IG1heSBiZSBhbiBvYmplY3Qgd2hpY2ggd2lsbCBiZVxuICAgKiAgICB1c2VkIGZvciB0aGUgcHJvdG90eXBlIG9mIHRoZSBuZXdseSBjcmVhdGVkIHN1YmNsYXNzLiBGb3IgbWFueSBiaW5kaW5ncyBvbmx5IHRoZSBgdXBkYXRlZGAgbWV0aG9kIGlzIG92ZXJyaWRkZW4sXG4gICAqICAgIHNvIGJ5IGp1c3QgcGFzc2luZyBpbiBhIGZ1bmN0aW9uIGZvciBgZGVmaW5pdGlvbmAgdGhlIGJpbmRlciB3aWxsIGJlIGNyZWF0ZWQgd2l0aCB0aGF0IGFzIGl0cyBgdXBkYXRlZGAgbWV0aG9kLlxuICAgKlxuICAgKiAjIyMgRXhwbGFpbmF0aW9uIG9mIHByb3BlcnRpZXMgYW5kIG1ldGhvZHNcbiAgICpcbiAgICogICAqIGBwcmlvcml0eWAgbWF5IGJlIGRlZmluZWQgYXMgbnVtYmVyIHRvIGluc3RydWN0IHNvbWUgYmluZGVycyB0byBiZSBwcm9jZXNzZWQgYmVmb3JlIG90aGVycy4gQmluZGVycyB3aXRoXG4gICAqICAgaGlnaGVyIHByaW9yaXR5IGFyZSBwcm9jZXNzZWQgZmlyc3QuXG4gICAqXG4gICAqICAgKiBgYW5pbWF0ZWRgIGNhbiBiZSBzZXQgdG8gYHRydWVgIHRvIGV4dGVuZCB0aGUgQW5pbWF0ZWRCaW5kaW5nIGNsYXNzIHdoaWNoIHByb3ZpZGVzIHN1cHBvcnQgZm9yIGFuaW1hdGlvbiB3aGVuXG4gICAqICAgaW5zZXJ0aW5nYW5kIHJlbW92aW5nIG5vZGVzIGZyb20gdGhlIERPTS4gVGhlIGBhbmltYXRlZGAgcHJvcGVydHkgb25seSAqYWxsb3dzKiBhbmltYXRpb24gYnV0IHRoZSBlbGVtZW50IG11c3RcbiAgICogICBoYXZlIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIHRvIHVzZSBhbmltYXRpb24uIEEgYmluZGluZyB3aWxsIGhhdmUgdGhlIGBhbmltYXRlYCBwcm9wZXJ0eSBzZXQgdG8gdHJ1ZSB3aGVuIGl0IGlzXG4gICAqICAgdG8gYmUgYW5pbWF0ZWQuIEJpbmRlcnMgc2hvdWxkIGhhdmUgZmFzdCBwYXRocyBmb3Igd2hlbiBhbmltYXRpb24gaXMgbm90IHVzZWQgcmF0aGVyIHRoYW4gYXNzdW1pbmcgYW5pbWF0aW9uIHdpbGxcbiAgICogICBiZSB1c2VkLlxuICAgKlxuICAgKiBCaW5kZXJzXG4gICAqXG4gICAqIEEgYmluZGVyIGNhbiBoYXZlIDUgbWV0aG9kcyB3aGljaCB3aWxsIGJlIGNhbGxlZCBhdCB2YXJpb3VzIHBvaW50cyBpbiBhIGJpbmRpbmcncyBsaWZlY3ljbGUuIE1hbnkgYmluZGVycyB3aWxsXG4gICAqIG9ubHkgdXNlIHRoZSBgdXBkYXRlZCh2YWx1ZSlgIG1ldGhvZCwgc28gY2FsbGluZyByZWdpc3RlciB3aXRoIGEgZnVuY3Rpb24gaW5zdGVhZCBvZiBhbiBvYmplY3QgYXMgaXRzIHRoaXJkXG4gICAqIHBhcmFtZXRlciBpcyBhIHNob3J0Y3V0IHRvIGNyZWF0aW5nIGEgYmluZGVyIHdpdGgganVzdCBhbiBgdXBkYXRlYCBtZXRob2QuXG4gICAqXG4gICAqIExpc3RlZCBpbiBvcmRlciBvZiB3aGVuIHRoZXkgb2NjdXIgaW4gYSBiaW5kaW5nJ3MgbGlmZWN5Y2xlOlxuICAgKlxuICAgKiAgICogYGNvbXBpbGVkKG9wdGlvbnMpYCBpcyBjYWxsZWQgd2hlbiBmaXJzdCBjcmVhdGluZyBhIGJpbmRpbmcgZHVyaW5nIHRoZSB0ZW1wbGF0ZSBjb21waWxhdGlvbiBwcm9jZXNzIGFuZCByZWNlaXZlc1xuICAgKiB0aGUgYG9wdGlvbnNgIG9iamVjdCB0aGF0IHdpbGwgYmUgcGFzc2VkIGludG8gYG5ldyBCaW5kaW5nKG9wdGlvbnMpYC4gVGhpcyBjYW4gYmUgdXNlZCBmb3IgY3JlYXRpbmcgdGVtcGxhdGVzLFxuICAgKiBtb2RpZnlpbmcgdGhlIERPTSAob25seSBzdWJzZXF1ZW50IERPTSB0aGF0IGhhc24ndCBhbHJlYWR5IGJlZW4gcHJvY2Vzc2VkKSBhbmQgb3RoZXIgdGhpbmdzIHRoYXQgc2hvdWxkIGJlXG4gICAqIGFwcGxpZWQgYXQgY29tcGlsZSB0aW1lIGFuZCBub3QgZHVwbGljYXRlZCBmb3IgZWFjaCB2aWV3IGNyZWF0ZWQuXG4gICAqXG4gICAqICAgKiBgY3JlYXRlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiBhIG5ldyB2aWV3IGlzIGNyZWF0ZWQuIFRoaXMgY2FuIGJlIHVzZWQgdG8gYWRkIGV2ZW50IGxpc3RlbmVycyBvbiB0aGVcbiAgICogZWxlbWVudCBvciBkbyBvdGhlciB0aGluZ3MgdGhhdCB3aWxsIHBlcnNpc3RlIHdpdGggdGhlIHZpZXcgdGhyb3VnaCBpdHMgbWFueSB1c2VzLiBWaWV3cyBtYXkgZ2V0IHJldXNlZCBzbyBkb24ndFxuICAgKiBkbyBhbnl0aGluZyBoZXJlIHRvIHRpZSBpdCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqXG4gICAqICAgKiBgYXR0YWNoZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gdGhlIHZpZXcgaXMgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0IGFuZCBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXNcbiAgICogY2FuIGJlIHVzZWQgdG8gaGFuZGxlIGNvbnRleHQtc3BlY2lmaWMgYWN0aW9ucywgYWRkIGxpc3RlbmVycyB0byB0aGUgd2luZG93IG9yIGRvY3VtZW50ICh0byBiZSByZW1vdmVkIGluXG4gICAqIGBkZXRhY2hlZGAhKSwgZXRjLlxuICAgKlxuICAgKiAgICogYHVwZGF0ZWQodmFsdWUsIG9sZFZhbHVlLCBjaGFuZ2VSZWNvcmRzKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW5ldmVyIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB3aXRoaW5cbiAgICogdGhlIGF0dHJpYnV0ZSBjaGFuZ2VzLiBGb3IgZXhhbXBsZSwgYGJpbmQtdGV4dD1cInt7dXNlcm5hbWV9fVwiYCB3aWxsIHRyaWdnZXIgYHVwZGF0ZWRgIHdpdGggdGhlIHZhbHVlIG9mIHVzZXJuYW1lXG4gICAqIHdoZW5ldmVyIGl0IGNoYW5nZXMgb24gdGhlIGdpdmVuIGNvbnRleHQuIFdoZW4gdGhlIHZpZXcgaXMgcmVtb3ZlZCBgdXBkYXRlZGAgd2lsbCBiZSB0cmlnZ2VyZWQgd2l0aCBhIHZhbHVlIG9mXG4gICAqIGB1bmRlZmluZWRgIGlmIHRoZSB2YWx1ZSB3YXMgbm90IGFscmVhZHkgYHVuZGVmaW5lZGAsIGdpdmluZyBhIGNoYW5jZSB0byBcInJlc2V0XCIgdG8gYW4gZW1wdHkgc3RhdGUuXG4gICAqXG4gICAqICAgKiBgZGV0YWNoZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gdGhlIHZpZXcgaXMgdW5ib3VuZCB0byBhIGdpdmVuIGNvbnRleHQgYW5kIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzXG4gICAqIGNhbiBiZSB1c2VkIHRvIGNsZWFuIHVwIGFueXRoaW5nIGRvbmUgaW4gYGF0dGFjaGVkKClgIG9yIGluIGB1cGRhdGVkKClgIGJlZm9yZSBiZWluZyByZW1vdmVkLlxuICAgKlxuICAgKiBFbGVtZW50IGFuZCBhdHRyaWJ1dGUgYmluZGVycyB3aWxsIGFwcGx5IHdoZW5ldmVyIHRoZSB0YWcgbmFtZSBvciBhdHRyaWJ1dGUgbmFtZSBpcyBtYXRjaGVkLiBJbiB0aGUgY2FzZSBvZlxuICAgKiBhdHRyaWJ1dGUgYmluZGVycyBpZiB5b3Ugb25seSB3YW50IGl0IHRvIG1hdGNoIHdoZW4gZXhwcmVzc2lvbnMgYXJlIHVzZWQgd2l0aGluIHRoZSBhdHRyaWJ1dGUsIGFkZCBgb25seVdoZW5Cb3VuZGBcbiAgICogdG8gdGhlIGRlZmluaXRpb24uIE90aGVyd2lzZSB0aGUgYmluZGVyIHdpbGwgbWF0Y2ggYW5kIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB3aWxsIHNpbXBseSBiZSBhIHN0cmluZyB0aGF0XG4gICAqIG9ubHkgY2FsbHMgdXBkYXRlZCBvbmNlIHNpbmNlIGl0IHdpbGwgbm90IGNoYW5nZS5cbiAgICpcbiAgICogTm90ZSwgYXR0cmlidXRlcyB3aGljaCBtYXRjaCBhIGJpbmRlciBhcmUgcmVtb3ZlZCBkdXJpbmcgY29tcGlsZS4gVGhleSBhcmUgY29uc2lkZXJlZCB0byBiZSBiaW5kaW5nIGRlZmluaXRpb25zIGFuZFxuICAgKiBub3QgcGFydCBvZiB0aGUgZWxlbWVudC4gQmluZGluZ3MgbWF5IHNldCB0aGUgYXR0cmlidXRlIHdoaWNoIHNlcnZlZCBhcyB0aGVpciBkZWZpbml0aW9uIGlmIGRlc2lyZWQuXG4gICAqXG4gICAqICMjIyBEZWZhdWx0c1xuICAgKlxuICAgKiBUaGVyZSBhcmUgZGVmYXVsdCBiaW5kZXJzIGZvciBhdHRyaWJ1dGUgYW5kIHRleHQgbm9kZXMgd2hpY2ggYXBwbHkgd2hlbiBubyBvdGhlciBiaW5kZXJzIG1hdGNoLiBUaGV5IG9ubHkgYXBwbHkgdG9cbiAgICogYXR0cmlidXRlcyBhbmQgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW0gKGUuZy4gYHt7Zm9vfX1gKS4gVGhlIGRlZmF1bHQgaXMgdG8gc2V0IHRoZSBhdHRyaWJ1dGUgb3IgdGV4dFxuICAgKiBub2RlJ3MgdmFsdWUgdG8gdGhlIHJlc3VsdCBvZiB0aGUgZXhwcmVzc2lvbi4gSWYgeW91IHdhbnRlZCB0byBvdmVycmlkZSB0aGlzIGRlZmF1bHQgeW91IG1heSByZWdpc3RlciBhIGJpbmRlciB3aXRoXG4gICAqIHRoZSBuYW1lIGBcIl9fZGVmYXVsdF9fXCJgLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KiogVGhpcyBiaW5kaW5nIGhhbmRsZXIgYWRkcyBwaXJhdGVpemVkIHRleHQgdG8gYW4gZWxlbWVudC5cbiAgICogYGBgamF2YXNjcmlwdFxuICAgKiByZWdpc3RyeS5yZWdpc3RlckF0dHJpYnV0ZSgnbXktcGlyYXRlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykge1xuICAgKiAgICAgdmFsdWUgPSAnJztcbiAgICogICB9IGVsc2Uge1xuICAgKiAgICAgdmFsdWUgPSB2YWx1ZVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxCaW5nXFxiL2csIFwiaW4nXCIpXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXGJ0b1xcYi9nLCBcInQnXCIpXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXGJ5b3VcXGIvLCAneWUnKVxuICAgKiAgICAgICArICcgQXJycnIhJztcbiAgICogICB9XG4gICAqICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gdmFsdWU7XG4gICAqIH0pO1xuICAgKiBgYGBcbiAgICpcbiAgICogYGBgaHRtbFxuICAgKiA8cCBteS1waXJhdGU9XCJ7e3Bvc3QuYm9keX19XCI+VGhpcyB0ZXh0IHdpbGwgYmUgcmVwbGFjZWQuPC9wPlxuICAgKiBgYGBcbiAgICovXG4gIHJlZ2lzdGVyRWxlbWVudDogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCdlbGVtZW50JywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlclRleHQ6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlckJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHZhciBiaW5kZXIsIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV1cbiAgICB2YXIgc3VwZXJDbGFzcyA9IGRlZmluaXRpb24uYW5pbWF0ZWQgPyBBbmltYXRlZEJpbmRpbmcgOiBCaW5kaW5nO1xuXG4gICAgaWYgKCFiaW5kZXJzKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdgdHlwZWAgbXVzdCBiZSBvbmUgb2YgJyArIE9iamVjdC5rZXlzKHRoaXMuYmluZGVycykuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWZpbml0aW9uID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBpZiAoZGVmaW5pdGlvbi5wcm90b3R5cGUgaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIHN1cGVyQ2xhc3MgPSBkZWZpbml0aW9uO1xuICAgICAgICBkZWZpbml0aW9uID0ge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWZpbml0aW9uID0geyB1cGRhdGVkOiBkZWZpbml0aW9uIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgc3ViY2xhc3Mgb2YgQmluZGluZyAob3IgYW5vdGhlciBiaW5kZXIpIHdpdGggdGhlIGRlZmluaXRpb25cbiAgICBmdW5jdGlvbiBCaW5kZXIoKSB7XG4gICAgICBzdXBlckNsYXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICAgIGRlZmluaXRpb24uT2JzZXJ2ZXIgPSB0aGlzLk9ic2VydmVyO1xuICAgIHN1cGVyQ2xhc3MuZXh0ZW5kKEJpbmRlciwgZGVmaW5pdGlvbik7XG5cbiAgICB2YXIgZXhwcjtcbiAgICBpZiAobmFtZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgZXhwciA9IG5hbWU7XG4gICAgfSBlbHNlIGlmIChuYW1lLmluZGV4T2YoJyonKSA+PSAwKSB7XG4gICAgICBleHByID0gbmV3IFJlZ0V4cCgnXicgKyBlc2NhcGVSZWdFeHAobmFtZSkucmVwbGFjZSgnXFxcXConLCAnKC4qKScpICsgJyQnKTtcbiAgICB9XG5cbiAgICBpZiAoZXhwcikge1xuICAgICAgQmluZGVyLmV4cHIgPSBleHByO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnB1c2goQmluZGVyKTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb3J0KHRoaXMuYmluZGluZ1NvcnQpO1xuICAgIH1cblxuICAgIEJpbmRlci5uYW1lID0gJycgKyBuYW1lO1xuICAgIGJpbmRlcnNbbmFtZV0gPSBCaW5kZXI7XG4gICAgcmV0dXJuIEJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgLiBJZiBhbiBSZWdFeHAgd2FzIHVzZWQgaW4gcmVnaXN0ZXIgZm9yIHRoZSBuYW1lIGl0IG11c3QgYmUgdXNlZFxuICAgKiB0byB1bnJlZ2lzdGVyLCBidXQgaXQgZG9lcyBub3QgbmVlZCB0byBiZSB0aGUgc2FtZSBpbnN0YW5jZS5cbiAgICovXG4gIHVucmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuICAgIGlmICghYmluZGVyKSByZXR1cm47XG4gICAgaWYgKGJpbmRlci5leHByKSB7XG4gICAgICB2YXIgaW5kZXggPSBiaW5kZXJzLl93aWxkY2FyZHMuaW5kZXhPZihiaW5kZXIpO1xuICAgICAgaWYgKGluZGV4ID49IDApIGJpbmRlcnMuX3dpbGRjYXJkcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgICBkZWxldGUgYmluZGVyc1tuYW1lXTtcbiAgICByZXR1cm4gYmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBiaW5kZXIgdGhhdCB3YXMgYWRkZWQgd2l0aCBgcmVnaXN0ZXIoKWAgYnkgdHlwZSBhbmQgbmFtZS5cbiAgICovXG4gIGdldEVsZW1lbnRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QXR0cmlidXRlQmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0VGV4dEJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICBnZXRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUpIHtcbiAgICB2YXIgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcblxuICAgIGlmICghYmluZGVycykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYHR5cGVgIG11c3QgYmUgb25lIG9mICcgKyBPYmplY3Qua2V5cyh0aGlzLmJpbmRlcnMpLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmIChuYW1lICYmIGJpbmRlcnMuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgIHJldHVybiBiaW5kZXJzW25hbWVdO1xuICAgIH1cbiAgfSxcblxuXG4gIC8qKlxuICAgKiBGaW5kIGEgbWF0Y2hpbmcgYmluZGVyIGZvciB0aGUgZ2l2ZW4gdHlwZS4gRWxlbWVudHMgc2hvdWxkIG9ubHkgcHJvdmlkZSBuYW1lLiBBdHRyaWJ1dGVzIHNob3VsZCBwcm92aWRlIHRoZSBuYW1lXG4gICAqIGFuZCB2YWx1ZSAodmFsdWUgc28gdGhlIGRlZmF1bHQgY2FuIGJlIHJldHVybmVkIGlmIGFuIGV4cHJlc3Npb24gZXhpc3RzIGluIHRoZSB2YWx1ZSkuIFRleHQgbm9kZXMgc2hvdWxkIG9ubHlcbiAgICogcHJvdmlkZSB0aGUgdmFsdWUgKGluIHBsYWNlIG9mIHRoZSBuYW1lKSBhbmQgd2lsbCByZXR1cm4gdGhlIGRlZmF1bHQgaWYgbm8gYmluZGVycyBtYXRjaC5cbiAgICovXG4gIGZpbmRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKHR5cGUgPT09ICd0ZXh0JyAmJiB2YWx1ZSA9PSBudWxsKSB7XG4gICAgICB2YWx1ZSA9IG5hbWU7XG4gICAgICBuYW1lID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB2YXIgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgbmFtZSksIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcikge1xuICAgICAgdmFyIHRvTWF0Y2ggPSAodHlwZSA9PT0gJ3RleHQnKSA/IHZhbHVlIDogbmFtZTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb21lKGZ1bmN0aW9uKHdpbGRjYXJkQmluZGVyKSB7XG4gICAgICAgIGlmICh0b01hdGNoLm1hdGNoKHdpbGRjYXJkQmluZGVyLmV4cHIpKSB7XG4gICAgICAgICAgYmluZGVyID0gd2lsZGNhcmRCaW5kZXI7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChiaW5kZXIgJiYgdHlwZSA9PT0gJ2F0dHJpYnV0ZScgJiYgYmluZGVyLm9ubHlXaGVuQm91bmQgJiYgIXRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpIHtcbiAgICAgIC8vIGRvbid0IHVzZSB0aGUgYHZhbHVlYCBiaW5kZXIgaWYgdGhlcmUgaXMgbm8gZXhwcmVzc2lvbiBpbiB0aGUgYXR0cmlidXRlIHZhbHVlIChlLmcuIGB2YWx1ZT1cInNvbWUgdGV4dFwiYClcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobmFtZSA9PT0gdGhpcy5hbmltYXRlQXR0cmlidXRlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKCFiaW5kZXIgJiYgdmFsdWUgJiYgKHR5cGUgPT09ICd0ZXh0JyB8fCB0aGlzLmlzQm91bmQodHlwZSwgdmFsdWUpKSkge1xuICAgICAgLy8gVGVzdCBpZiB0aGUgYXR0cmlidXRlIHZhbHVlIGlzIGJvdW5kIChlLmcuIGBocmVmPVwiL3Bvc3RzL3t7IHBvc3QuaWQgfX1cImApXG4gICAgICBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCAnX19kZWZhdWx0X18nKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEEgRm9ybWF0dGVyIGlzIHN0b3JlZCB0byBwcm9jZXNzIHRoZSB2YWx1ZSBvZiBhbiBleHByZXNzaW9uLiBUaGlzIGFsdGVycyB0aGUgdmFsdWUgb2Ygd2hhdCBjb21lcyBpbiB3aXRoIGEgZnVuY3Rpb25cbiAgICogdGhhdCByZXR1cm5zIGEgbmV3IHZhbHVlLiBGb3JtYXR0ZXJzIGFyZSBhZGRlZCBieSB1c2luZyBhIHNpbmdsZSBwaXBlIGNoYXJhY3RlciAoYHxgKSBmb2xsb3dlZCBieSB0aGUgbmFtZSBvZiB0aGVcbiAgICogZm9ybWF0dGVyLiBNdWx0aXBsZSBmb3JtYXR0ZXJzIGNhbiBiZSB1c2VkIGJ5IGNoYWluaW5nIHBpcGVzIHdpdGggZm9ybWF0dGVyIG5hbWVzLiBGb3JtYXR0ZXJzIG1heSBhbHNvIGhhdmVcbiAgICogYXJndW1lbnRzIHBhc3NlZCB0byB0aGVtIGJ5IHVzaW5nIHRoZSBjb2xvbiB0byBzZXBhcmF0ZSBhcmd1bWVudHMgZnJvbSB0aGUgZm9ybWF0dGVyIG5hbWUuIFRoZSBzaWduYXR1cmUgb2YgYVxuICAgKiBmb3JtYXR0ZXIgc2hvdWxkIGJlIGBmdW5jdGlvbih2YWx1ZSwgYXJncy4uLilgIHdoZXJlIGFyZ3MgYXJlIGV4dHJhIHBhcmFtZXRlcnMgcGFzc2VkIGludG8gdGhlIGZvcm1hdHRlciBhZnRlclxuICAgKiBjb2xvbnMuXG4gICAqXG4gICAqICpFeGFtcGxlOipcbiAgICogYGBganNcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ3VwcGVyY2FzZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPSAnc3RyaW5nJykgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlLnRvVXBwZXJjYXNlKClcbiAgICogfSlcbiAgICpcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ3JlcGxhY2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVwbGFjZSwgd2l0aCkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKHJlcGxhY2UsIHdpdGgpXG4gICAqIH0pXG4gICAqIGBgYGh0bWxcbiAgICogPGgxIGJpbmQtdGV4dD1cInRpdGxlIHwgdXBwZXJjYXNlIHwgcmVwbGFjZTonTEVUVEVSJzonTlVNQkVSJ1wiPjwvaDE+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+R0VUVElORyBUTyBLTk9XIEFMTCBBQk9VVCBUSEUgTlVNQkVSIEE8L2gxPlxuICAgKiBgYGBcbiAgICpcbiAgICogQSBgdmFsdWVGb3JtYXR0ZXJgIGlzIGxpa2UgYSBmb3JtYXR0ZXIgYnV0IHVzZWQgc3BlY2lmaWNhbGx5IHdpdGggdGhlIGB2YWx1ZWAgYmluZGluZyBzaW5jZSBpdCBpcyBhIHR3by13YXkgYmluZGluZy4gV2hlblxuICAgKiB0aGUgdmFsdWUgb2YgdGhlIGVsZW1lbnQgaXMgY2hhbmdlZCBhIGB2YWx1ZUZvcm1hdHRlcmAgY2FuIGFkanVzdCB0aGUgdmFsdWUgZnJvbSBhIHN0cmluZyB0byB0aGUgY29ycmVjdCB2YWx1ZSB0eXBlIGZvclxuICAgKiB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLiBUaGUgc2lnbmF0dXJlIGZvciBhIGB2YWx1ZUZvcm1hdHRlcmAgaW5jbHVkZXMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb25cbiAgICogYmVmb3JlIHRoZSBvcHRpb25hbCBhcmd1bWVudHMgKGlmIGFueSkuIFRoaXMgYWxsb3dzIGRhdGVzIHRvIGJlIGFkanVzdGVkIGFuZCBwb3NzaWJsZXkgb3RoZXIgdXNlcy5cbiAgICpcbiAgICogKkV4YW1wbGU6KlxuICAgKiBgYGBqc1xuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignbnVtZXJpYycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgLy8gdmFsdWUgY29taW5nIGZyb20gdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbiwgdG8gYmUgc2V0IG9uIHRoZSBlbGVtZW50XG4gICAqICAgaWYgKHZhbHVlID09IG51bGwgfHwgaXNOYU4odmFsdWUpKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWVcbiAgICogfSlcbiAgICpcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUtaG91cicsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgLy8gdmFsdWUgY29taW5nIGZyb20gdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbiwgdG8gYmUgc2V0IG9uIHRoZSBlbGVtZW50XG4gICAqICAgaWYgKCAhKGN1cnJlbnRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpICkgcmV0dXJuICcnXG4gICAqICAgdmFyIGhvdXJzID0gdmFsdWUuZ2V0SG91cnMoKVxuICAgKiAgIGlmIChob3VycyA+PSAxMikgaG91cnMgLT0gMTJcbiAgICogICBpZiAoaG91cnMgPT0gMCkgaG91cnMgPSAxMlxuICAgKiAgIHJldHVybiBob3Vyc1xuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5OdW1iZXIgQXR0ZW5kaW5nOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiNFwiIGJpbmQtdmFsdWU9XCJldmVudC5hdHRlbmRlZUNvdW50IHwgbnVtZXJpY1wiPlxuICAgKiA8bGFiZWw+VGltZTo8L2xhYmVsPlxuICAgKiA8aW5wdXQgc2l6ZT1cIjJcIiBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtaG91clwiPiA6XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1taW51dGVcIj5cbiAgICogPHNlbGVjdCBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtYW1wbVwiPlxuICAgKiAgIDxvcHRpb24+QU08L29wdGlvbj5cbiAgICogICA8b3B0aW9uPlBNPC9vcHRpb24+XG4gICAqIDwvc2VsZWN0PlxuICAgKiBgYGBcbiAgICovXG4gIHJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSwgZm9ybWF0dGVyKSB7XG4gICAgdGhpcy5mb3JtYXR0ZXJzW25hbWVdID0gZm9ybWF0dGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGEgZm9ybWF0dGVyLlxuICAgKi9cbiAgdW5yZWdpc3RlckZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUsIGZvcm1hdHRlcikge1xuICAgIGRlbGV0ZSB0aGlzLmZvcm1hdHRlcnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogR2V0cyBhIHJlZ2lzdGVyZWQgZm9ybWF0dGVyLlxuICAgKi9cbiAgZ2V0Rm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSkge1xuICAgIHJldHVybiB0aGlzLmZvcm1hdHRlcnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogQW4gQW5pbWF0aW9uIGlzIHN0b3JlZCB0byBoYW5kbGUgYW5pbWF0aW9ucy4gQSByZWdpc3RlcmVkIGFuaW1hdGlvbiBpcyBhbiBvYmplY3QgKG9yIGNsYXNzIHdoaWNoIGluc3RhbnRpYXRlcyBpbnRvXG4gICAqIGFuIG9iamVjdCkgd2l0aCB0aGUgbWV0aG9kczpcbiAgICogICAqIGB3aWxsQW5pbWF0ZUluKGVsZW1lbnQpYFxuICAgKiAgICogYGFuaW1hdGVJbihlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZUluKGVsZW1lbnQpYFxuICAgKiAgICogYHdpbGxBbmltYXRlT3V0KGVsZW1lbnQpYFxuICAgKiAgICogYGFuaW1hdGVPdXQoZWxlbWVudCwgY2FsbGJhY2spYFxuICAgKiAgICogYGRpZEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqXG4gICAqIEFuaW1hdGlvbiBpcyBpbmNsdWRlZCB3aXRoIGJpbmRlcnMgd2hpY2ggYXJlIHJlZ2lzdGVyZWQgd2l0aCB0aGUgYGFuaW1hdGVkYCBwcm9wZXJ0eSBzZXQgdG8gYHRydWVgIChzdWNoIGFzIGBpZmBcbiAgICogYW5kIGByZXBlYXRgKS4gQW5pbWF0aW9ucyBhbGxvdyBlbGVtZW50cyB0byBmYWRlIGluLCBmYWRlIG91dCwgc2xpZGUgZG93biwgY29sbGFwc2UsIG1vdmUgZnJvbSBvbmUgbG9jYXRpb24gaW4gYVxuICAgKiBsaXN0IHRvIGFub3RoZXIsIGFuZCBtb3JlLlxuICAgKlxuICAgKiBUbyB1c2UgYW5pbWF0aW9uIGFkZCBhbiBhdHRyaWJ1dGUgbmFtZWQgYGFuaW1hdGVgIG9udG8gYW4gZWxlbWVudCB3aXRoIGEgc3VwcG9ydGVkIGJpbmRlci5cbiAgICpcbiAgICogIyMjIENTUyBBbmltYXRpb25zXG4gICAqXG4gICAqIElmIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGRvZXMgbm90IGhhdmUgYSB2YWx1ZSBvciB0aGUgdmFsdWUgaXMgYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW5cbiAgICogZnJhZ21lbnRzIHdpbGwgdXNlIGEgQ1NTIHRyYW5zaXRpb24vYW5pbWF0aW9uLiBDbGFzc2VzIHdpbGwgYmUgYWRkZWQgYW5kIHJlbW92ZWQgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uLlxuICAgKlxuICAgKiAgICogYC53aWxsLWFuaW1hdGUtaW5gIGlzIGFkZGVkIHJpZ2h0IGFmdGVyIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGVcbiAgICogICAgIG9wYWNpdHkgdG8gYDAuMGAgZm9yIGV4YW1wbGUuIEl0IGlzIHRoZW4gcmVtb3ZlZCBvbiB0aGUgbmV4dCBhbmltYXRpb24gZnJhbWUuXG4gICAqICAgKiBgLmFuaW1hdGUtaW5gIGlzIHdoZW4gYC53aWxsLWFuaW1hdGUtaW5gIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAxLjBgIGZvciBleGFtcGxlLiBUaGVcbiAgICogICAgIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUuIE5vdGUgdGhhdFxuICAgKiAgICAgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuIGVsZW1lbnQgd2l0aCB0aGUgYHJlcGVhdGAgYmluZGVyLCB0aGVzZSBjbGFzc2VzIGFyZSBhZGRlZCB0b1xuICAgKiAgICAgaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKiAgICogYC53aWxsLWFuaW1hdGUtb3V0YCBpcyBhZGRlZCBiZWZvcmUgYW4gZWxlbWVudCBpcyByZW1vdmVkIGZyb20gdGhlIERPTS4gVGhpcyBjYW4gYmUgdXNlZCB0byBzZXQgdGhlIG9wYWNpdHkgdG9cbiAgICogICAgIGAxYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIHdoZW4gYC53aWxsLWFuaW1hdGUtb3V0YCBpcyByZW1vdmVkLiBJdCBjYW4gYmUgdXNlZCB0byBzZXQgb3BhY2l0eSB0byBgMC4wYCBmb3JcbiAgICogICAgIGV4YW1wbGUuIFRoZSBgYW5pbWF0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IG9uIHRoaXMgY2xhc3MgaWYgdXNpbmcgaXQuIFRoZSBgdHJhbnNpdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBoZXJlIG9yXG4gICAqICAgICBvbiBhbm90aGVyIHNlbGVjdG9yIHRoYXQgbWF0Y2hlcyB0aGUgZWxlbWVudC4gTm90ZSB0aGF0IGFsdGhvdWdoIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHBsYWNlZCBvbiBhblxuICAgKiAgICAgZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvIGl0cyBjaGlsZHJlbiBhcyB0aGV5IGdldCBhZGRlZCBhbmQgcmVtb3ZlZC5cbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgc2V0IHRvIGEgY2xhc3MgbmFtZSAoZS5nLiBgYW5pbWF0ZT1cIi5teS1mYWRlXCJgKSB0aGVuIHRoYXQgY2xhc3MgbmFtZSB3aWxsIGJlIGFkZGVkIGFzXG4gICAqIGEgY2xhc3MgdG8gdGhlIGVsZW1lbnQgZHVyaW5nIGFuaW1hdGlvbi4gVGhpcyBhbGxvd3MgeW91IHRvIHVzZSBgLm15LWZhZGUud2lsbC1hbmltYXRlLWluYCwgYC5teS1mYWRlLmFuaW1hdGUtaW5gLFxuICAgKiBldGMuIGluIHlvdXIgc3R5bGVzaGVldHMgdG8gdXNlIHRoZSBzYW1lIGFuaW1hdGlvbiB0aHJvdWdob3V0IHlvdXIgYXBwbGljYXRpb24uXG4gICAqXG4gICAqICMjIyBKYXZhU2NyaXB0IEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgeW91IG5lZWQgZ3JlYXRlciBjb250cm9sIG92ZXIgeW91ciBhbmltYXRpb25zIEphdmFTY3JpcHQgbWF5IGJlIHVzZWQuIEl0IGlzIHJlY29tbWVuZGVkIHRoYXQgQ1NTIHN0eWxlcyBzdGlsbCBiZVxuICAgKiB1c2VkIGJ5IGhhdmluZyB5b3VyIGNvZGUgc2V0IHRoZW0gbWFudWFsbHkuIFRoaXMgYWxsb3dzIHRoZSBhbmltYXRpb24gdG8gdGFrZSBhZHZhbnRhZ2Ugb2YgdGhlIGJyb3dzZXJcbiAgICogb3B0aW1pemF0aW9ucyBzdWNoIGFzIGhhcmR3YXJlIGFjY2VsZXJhdGlvbi4gVGhpcyBpcyBub3QgYSByZXF1aXJlbWVudC5cbiAgICpcbiAgICogSW4gb3JkZXIgdG8gdXNlIEphdmFTY3JpcHQgYW4gb2JqZWN0IHNob3VsZCBiZSBwYXNzZWQgaW50byB0aGUgYGFuaW1hdGlvbmAgYXR0cmlidXRlIHVzaW5nIGFuIGV4cHJlc3Npb24uIFRoaXNcbiAgICogb2JqZWN0IHNob3VsZCBoYXZlIG1ldGhvZHMgdGhhdCBhbGxvdyBKYXZhU2NyaXB0IGFuaW1hdGlvbiBoYW5kbGluZy4gRm9yIGV4YW1wbGUsIGlmIHlvdSBhcmUgYm91bmQgdG8gYSBjb250ZXh0XG4gICAqIHdpdGggYW4gb2JqZWN0IG5hbWVkIGBjdXN0b21GYWRlYCB3aXRoIGFuaW1hdGlvbiBtZXRob2RzLCB5b3VyIGVsZW1lbnQgc2hvdWxkIGhhdmUgYGF0dHJpYnV0ZT1cInt7Y3VzdG9tRmFkZX19XCJgLlxuICAgKiBUaGUgZm9sbG93aW5nIGlzIGEgbGlzdCBvZiB0aGUgbWV0aG9kcyB5b3UgbWF5IGltcGxlbWVudC5cbiAgICpcbiAgICogICAqIGB3aWxsQW5pbWF0ZUluKGVsZW1lbnQpYCB3aWxsIGJlIGNhbGxlZCBhZnRlciBhbiBlbGVtZW50IGhhcyBiZWVuIGluc2VydGVkIGludG8gdGhlIERPTS4gVXNlIGl0IHRvIHNldCBpbml0aWFsXG4gICAqICAgICBDU1MgcHJvcGVydGllcyBiZWZvcmUgYGFuaW1hdGVJbmAgaXMgY2FsbGVkIHRvIHNldCB0aGUgZmluYWwgcHJvcGVydGllcy4gVGhpcyBtZXRob2QgaXMgb3B0aW9uYWwuXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWAgd2lsbCBiZSBjYWxsZWQgc2hvcnRseSBhZnRlciBgd2lsbEFuaW1hdGVJbmAgaWYgaXQgd2FzIGRlZmluZWQuIFVzZSBpdCB0byBzZXRcbiAgICogICAgIGZpbmFsIENTUyBwcm9wZXJ0aWVzLlxuICAgKiAgICogYGFuaW1hdGVPdXQoZWxlbWVudCwgZG9uZSlgIHdpbGwgYmUgY2FsbGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHRvIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBgZG9uZWAgbXVzdCBiZVxuICAgKiAgICAgY2FsbGVkIHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZSBpbiBvcmRlciBmb3IgdGhlIGJpbmRlciB0byBmaW5pc2ggcmVtb3ZpbmcgdGhlIGVsZW1lbnQuICoqUmVtZW1iZXIqKiB0b1xuICAgKiAgICAgY2xlYW4gdXAgYnkgcmVtb3ZpbmcgYW55IHN0eWxlcyB0aGF0IHdlcmUgYWRkZWQgYmVmb3JlIGNhbGxpbmcgYGRvbmUoKWAgc28gdGhlIGVsZW1lbnQgY2FuIGJlIHJldXNlZCB3aXRob3V0XG4gICAqICAgICBzaWRlLWVmZmVjdHMuXG4gICAqXG4gICAqIFRoZSBgZWxlbWVudGAgcGFzc2VkIGluIHdpbGwgYmUgcG9seWZpbGxlZCBmb3Igd2l0aCB0aGUgYGFuaW1hdGVgIG1ldGhvZCB1c2luZ1xuICAgKiBodHRwczovL2dpdGh1Yi5jb20vd2ViLWFuaW1hdGlvbnMvd2ViLWFuaW1hdGlvbnMtanMuXG4gICAqXG4gICAqICMjIyBSZWdpc3RlcmVkIEFuaW1hdGlvbnNcbiAgICpcbiAgICogQW5pbWF0aW9ucyBtYXkgYmUgcmVnaXN0ZXJlZCBhbmQgdXNlZCB0aHJvdWdob3V0IHlvdXIgYXBwbGljYXRpb24uIFRvIHVzZSBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIHVzZSBpdHMgbmFtZSBpblxuICAgKiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSAoZS5nLiBgYW5pbWF0ZT1cImZhZGVcImApLiBOb3RlIHRoZSBvbmx5IGRpZmZlcmVuY2UgYmV0d2VlbiBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGFuZCBhXG4gICAqIGNsYXNzIHJlZ2lzdHJhdGlvbiBpcyBjbGFzcyByZWdpc3RyYXRpb25zIGFyZSBwcmVmaXhlZCB3aXRoIGEgZG90IChgLmApLiBSZWdpc3RlcmVkIGFuaW1hdGlvbnMgYXJlIGFsd2F5c1xuICAgKiBKYXZhU2NyaXB0IGFuaW1hdGlvbnMuIFRvIHJlZ2lzdGVyIGFuIGFuaW1hdGlvbiB1c2UgYGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lLCBhbmltYXRpb25PYmplY3QpYC5cbiAgICpcbiAgICogVGhlIEFuaW1hdGlvbiBtb2R1bGUgY29tZXMgd2l0aCBzZXZlcmFsIGNvbW1vbiBhbmltYXRpb25zIHJlZ2lzdGVyZWQgYnkgZGVmYXVsdC4gVGhlIGRlZmF1bHRzIHVzZSBDU1Mgc3R5bGVzIHRvXG4gICAqIHdvcmsgY29ycmVjdGx5LCB1c2luZyBgZWxlbWVudC5hbmltYXRlYC5cbiAgICpcbiAgICogICAqIGBmYWRlYCB3aWxsIGZhZGUgYW4gZWxlbWVudCBpbiBhbmQgb3V0IG92ZXIgMzAwIG1pbGxpc2Vjb25kcy5cbiAgICogICAqIGBzbGlkZWAgd2lsbCBzbGlkZSBhbiBlbGVtZW50IGRvd24gd2hlbiBpdCBpcyBhZGRlZCBhbmQgc2xpZGUgaXQgdXAgd2hlbiBpdCBpcyByZW1vdmVkLlxuICAgKiAgICogYHNsaWRlLW1vdmVgIHdpbGwgbW92ZSBhbiBlbGVtZW50IGZyb20gaXRzIG9sZCBsb2NhdGlvbiB0byBpdHMgbmV3IGxvY2F0aW9uIGluIGEgcmVwZWF0ZWQgbGlzdC5cbiAgICpcbiAgICogRG8geW91IGhhdmUgYW5vdGhlciBjb21tb24gYW5pbWF0aW9uIHlvdSB0aGluayBzaG91bGQgYmUgaW5jbHVkZWQgYnkgZGVmYXVsdD8gU3VibWl0IGEgcHVsbCByZXF1ZXN0IVxuICAgKi9cbiAgcmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdCkge1xuICAgIHRoaXMuYW5pbWF0aW9uc1tuYW1lXSA9IGFuaW1hdGlvbk9iamVjdDtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbiBhbmltYXRpb24uXG4gICAqL1xuICB1bnJlZ2lzdGVyQW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgZGVsZXRlIHRoaXMuYW5pbWF0aW9uc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24uXG4gICAqL1xuICBnZXRBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFByZXBhcmUgYW4gZWxlbWVudCB0byBiZSBlYXNpZXIgYW5pbWF0YWJsZSAoYWRkaW5nIGEgc2ltcGxlIGBhbmltYXRlYCBwb2x5ZmlsbCBpZiBuZWVkZWQpXG4gICAqL1xuICBtYWtlRWxlbWVudEFuaW1hdGFibGU6IGFuaW1hdGlvbi5tYWtlRWxlbWVudEFuaW1hdGFibGUsXG5cblxuICAvKipcbiAgICogU2V0cyB0aGUgZGVsaW1pdGVycyB0aGF0IGRlZmluZSBhbiBleHByZXNzaW9uLiBEZWZhdWx0IGlzIGB7e2AgYW5kIGB9fWAgYnV0IHRoaXMgbWF5IGJlIG92ZXJyaWRkZW4uIElmIGVtcHR5XG4gICAqIHN0cmluZ3MgYXJlIHBhc3NlZCBpbiAoZm9yIHR5cGUgXCJhdHRyaWJ1dGVcIiBvbmx5KSB0aGVuIG5vIGRlbGltaXRlcnMgYXJlIHJlcXVpcmVkIGZvciBtYXRjaGluZyBhdHRyaWJ1dGVzLCBidXQgdGhlXG4gICAqIGRlZmF1bHQgYXR0cmlidXRlIG1hdGNoZXIgd2lsbCBub3QgYXBwbHkgdG8gdGhlIHJlc3Qgb2YgdGhlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZXRFeHByZXNzaW9uRGVsaW1pdGVyczogZnVuY3Rpb24odHlwZSwgcHJlLCBwb3N0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRXhwcmVzc2lvbiBkZWxpbWl0ZXJzIG11c3QgYmUgb2YgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByID0gbmV3IFJlZ0V4cChlc2NhcGVSZWdFeHAocHJlKSArICcoLio/KScgKyBlc2NhcGVSZWdFeHAocG9zdCksICdnJyk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVGVzdHMgd2hldGhlciBhIHZhbHVlIGhhcyBhbiBleHByZXNzaW9uIGluIGl0LiBTb21ldGhpbmcgbGlrZSBgL3VzZXIve3t1c2VyLmlkfX1gLlxuICAgKi9cbiAgaXNCb3VuZDogZnVuY3Rpb24odHlwZSwgdmFsdWUpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpc0JvdW5kIG11c3QgcHJvdmlkZSB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG4gICAgdmFyIGV4cHIgPSB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHI7XG4gICAgcmV0dXJuIEJvb2xlYW4oZXhwciAmJiB2YWx1ZSAmJiB2YWx1ZS5tYXRjaChleHByKSk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVGhlIHNvcnQgZnVuY3Rpb24gdG8gc29ydCBiaW5kZXJzIGNvcnJlY3RseVxuICAgKi9cbiAgYmluZGluZ1NvcnQ6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gYi5wcm90b3R5cGUucHJpb3JpdHkgLSBhLnByb3RvdHlwZS5wcmlvcml0eTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhbiBpbnZlcnRlZCBleHByZXNzaW9uIGZyb20gYC91c2VyL3t7dXNlci5pZH19YCB0byBgXCIvdXNlci9cIiArIHVzZXIuaWRgXG4gICAqL1xuICBjb2RpZnlFeHByZXNzaW9uOiBmdW5jdGlvbih0eXBlLCB0ZXh0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29kaWZ5RXhwcmVzc2lvbiBtdXN0IHVzZSB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG5cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICB2YXIgbWF0Y2ggPSB0ZXh0Lm1hdGNoKGV4cHIpO1xuXG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgcmV0dXJuICdcIicgKyB0ZXh0LnJlcGxhY2UoL1wiL2csICdcXFxcXCInKSArICdcIic7XG4gICAgfSBlbHNlIGlmIChtYXRjaC5sZW5ndGggPT09IDEgJiYgbWF0Y2hbMF0gPT09IHRleHQpIHtcbiAgICAgIHJldHVybiB0ZXh0LnJlcGxhY2UoZXhwciwgJyQxJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBuZXdUZXh0ID0gJ1wiJywgbGFzdEluZGV4ID0gMDtcbiAgICAgIHdoaWxlIChtYXRjaCA9IGV4cHIuZXhlYyh0ZXh0KSkge1xuICAgICAgICB2YXIgc3RyID0gdGV4dC5zbGljZShsYXN0SW5kZXgsIGV4cHIubGFzdEluZGV4IC0gbWF0Y2hbMF0ubGVuZ3RoKTtcbiAgICAgICAgbmV3VGV4dCArPSBzdHIucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpO1xuICAgICAgICBuZXdUZXh0ICs9ICdcIiArICgnICsgbWF0Y2hbMV0gKyAnIHx8IFwiXCIpICsgXCInO1xuICAgICAgICBsYXN0SW5kZXggPSBleHByLmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIG5ld1RleHQgKz0gdGV4dC5zbGljZShsYXN0SW5kZXgpLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKSArICdcIic7XG4gICAgICByZXR1cm4gbmV3VGV4dC5yZXBsYWNlKC9eXCJcIiBcXCsgfCBcIlwiIFxcKyB8IFxcKyBcIlwiJC9nLCAnJyk7XG4gICAgfVxuICB9XG5cbn07XG5cbi8vIFRha2VzIGEgc3RyaW5nIGxpa2UgXCIoXFwqKVwiIG9yIFwib24tXFwqXCIgYW5kIGNvbnZlcnRzIGl0IGludG8gYSByZWd1bGFyIGV4cHJlc3Npb24uXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAodGV4dCkge1xuICByZXR1cm4gdGV4dC5yZXBsYWNlKC9bLVtcXF17fSgpKis/LixcXFxcXiR8I1xcc10vZywgXCJcXFxcJCZcIik7XG59XG4iLCIvKlxuQ29weXJpZ2h0IChjKSAyMDE1IEphY29iIFdyaWdodCA8amFjd3JpZ2h0QGdtYWlsLmNvbT5cblxuUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxub2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xudG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG5mdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuXG5UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG5cblRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbklNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG5BVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG5MSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuVEhFIFNPRlRXQVJFLlxuKi9cbi8vICMgRGlmZlxuLy8gPiBCYXNlZCBvbiB3b3JrIGZyb20gR29vZ2xlJ3Mgb2JzZXJ2ZS1qcyBwb2x5ZmlsbDogaHR0cHM6Ly9naXRodWIuY29tL1BvbHltZXIvb2JzZXJ2ZS1qc1xuXG4vLyBBIG5hbWVzcGFjZSB0byBzdG9yZSB0aGUgZnVuY3Rpb25zIG9uXG52YXIgZGlmZiA9IGV4cG9ydHM7XG5cbihmdW5jdGlvbigpIHtcblxuICBkaWZmLmNsb25lID0gY2xvbmU7XG4gIGRpZmYudmFsdWVzID0gZGlmZlZhbHVlcztcbiAgZGlmZi5iYXNpYyA9IGRpZmZCYXNpYztcbiAgZGlmZi5vYmplY3RzID0gZGlmZk9iamVjdHM7XG4gIGRpZmYuYXJyYXlzID0gZGlmZkFycmF5cztcblxuXG4gIC8vIEEgY2hhbmdlIHJlY29yZCBmb3IgdGhlIG9iamVjdCBjaGFuZ2VzXG4gIGZ1bmN0aW9uIENoYW5nZVJlY29yZChvYmplY3QsIHR5cGUsIG5hbWUsIG9sZFZhbHVlKSB7XG4gICAgdGhpcy5vYmplY3QgPSBvYmplY3Q7XG4gICAgdGhpcy50eXBlID0gdHlwZTtcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMub2xkVmFsdWUgPSBvbGRWYWx1ZTtcbiAgfVxuXG4gIC8vIEEgc3BsaWNlIHJlY29yZCBmb3IgdGhlIGFycmF5IGNoYW5nZXNcbiAgZnVuY3Rpb24gU3BsaWNlKGluZGV4LCByZW1vdmVkLCBhZGRlZENvdW50KSB7XG4gICAgdGhpcy5pbmRleCA9IGluZGV4O1xuICAgIHRoaXMucmVtb3ZlZCA9IHJlbW92ZWQ7XG4gICAgdGhpcy5hZGRlZENvdW50ID0gYWRkZWRDb3VudDtcbiAgfVxuXG5cbiAgLy8gQ3JlYXRlcyBhIGNsb25lIG9yIGNvcHkgb2YgYW4gYXJyYXkgb3Igb2JqZWN0IChvciBzaW1wbHkgcmV0dXJucyBhIHN0cmluZy9udW1iZXIvYm9vbGVhbiB3aGljaCBhcmUgaW1tdXRhYmxlKVxuICAvLyBEb2VzIG5vdCBwcm92aWRlIGRlZXAgY29waWVzLlxuICBmdW5jdGlvbiBjbG9uZSh2YWx1ZSwgZGVlcCkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLm1hcChmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIHJldHVybiBjbG9uZSh2YWx1ZSwgZGVlcCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnNsaWNlKCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAodmFsdWUudmFsdWVPZigpICE9PSB2YWx1ZSkge1xuICAgICAgICByZXR1cm4gbmV3IHZhbHVlLmNvbnN0cnVjdG9yKHZhbHVlLnZhbHVlT2YoKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgY29weSA9IHt9O1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gdmFsdWUpIHtcbiAgICAgICAgICB2YXIgb2JqVmFsdWUgPSB2YWx1ZVtrZXldO1xuICAgICAgICAgIGlmIChkZWVwKSB7XG4gICAgICAgICAgICBvYmpWYWx1ZSA9IGNsb25lKG9ialZhbHVlLCBkZWVwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29weVtrZXldID0gb2JqVmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvcHk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byB2YWx1ZXMsIHJldHVybmluZyBhIHRydXRoeSB2YWx1ZSBpZiB0aGVyZSBhcmUgY2hhbmdlcyBvciBgZmFsc2VgIGlmIHRoZXJlIGFyZSBubyBjaGFuZ2VzLiBJZiB0aGUgdHdvXG4gIC8vIHZhbHVlcyBhcmUgYm90aCBhcnJheXMgb3IgYm90aCBvYmplY3RzLCBhbiBhcnJheSBvZiBjaGFuZ2VzIChzcGxpY2VzIG9yIGNoYW5nZSByZWNvcmRzKSBiZXR3ZWVuIHRoZSB0d28gd2lsbCBiZVxuICAvLyByZXR1cm5lZC4gT3RoZXJ3aXNlICBgdHJ1ZWAgd2lsbCBiZSByZXR1cm5lZC5cbiAgZnVuY3Rpb24gZGlmZlZhbHVlcyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkpIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlc1xuICAgICAgdmFyIHNwbGljZXMgPSBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgICByZXR1cm4gc3BsaWNlcy5sZW5ndGggPyBzcGxpY2VzIDogZmFsc2U7XG4gICAgfSBlbHNlIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIElmIGFuIG9iamVjdCBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIGNobmFnZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gdmFsdWVWYWx1ZSAhPT0gb2xkVmFsdWVWYWx1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gZGlmZk9iamVjdHModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgICAgcmV0dXJuIGNoYW5nZVJlY29yZHMubGVuZ3RoID8gY2hhbmdlUmVjb3JkcyA6IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhIHZhbHVlIGhhcyBjaGFuZ2VkIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gYmFzaWMgdHlwZXMsIHJldHVybmluZyB0cnVlIGlmIGNoYW5nZWQgb3IgZmFsc2UgaWYgbm90XG4gIGZ1bmN0aW9uIGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIHZhciB2YWx1ZVZhbHVlID0gdmFsdWUudmFsdWVPZigpO1xuICAgICAgdmFyIG9sZFZhbHVlVmFsdWUgPSBvbGRWYWx1ZS52YWx1ZU9mKCk7XG5cbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIGlmICh0eXBlb2YgdmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlVmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiBkaWZmQmFzaWModmFsdWVWYWx1ZSwgb2xkVmFsdWVWYWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgYSB2YWx1ZSBoYXMgY2hhbmdlZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ251bWJlcicgJiYgaXNOYU4odmFsdWUpICYmIGlzTmFOKG9sZFZhbHVlKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWUgIT09IG9sZFZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIG9iamVjdHMgcmV0dXJuaW5nIGFuIGFycmF5IG9mIGNoYW5nZSByZWNvcmRzLiBUaGUgY2hhbmdlIHJlY29yZCBsb29rcyBsaWtlOlxuICAvLyBgYGBqYXZhc2NyaXB0XG4gIC8vIHtcbiAgLy8gICBvYmplY3Q6IG9iamVjdCxcbiAgLy8gICB0eXBlOiAnZGVsZXRlZHx1cGRhdGVkfG5ldycsXG4gIC8vICAgbmFtZTogJ3Byb3BlcnR5TmFtZScsXG4gIC8vICAgb2xkVmFsdWU6IG9sZFZhbHVlXG4gIC8vIH1cbiAgLy8gYGBgXG4gIGZ1bmN0aW9uIGRpZmZPYmplY3RzKG9iamVjdCwgb2xkT2JqZWN0KSB7XG4gICAgdmFyIGNoYW5nZVJlY29yZHMgPSBbXTtcbiAgICB2YXIgcHJvcCwgb2xkVmFsdWUsIHZhbHVlO1xuXG4gICAgLy8gR29lcyB0aHJvdWdoIHRoZSBvbGQgb2JqZWN0IChzaG91bGQgYmUgYSBjbG9uZSkgYW5kIGxvb2sgZm9yIHRoaW5ncyB0aGF0IGFyZSBub3cgZ29uZSBvciBjaGFuZ2VkXG4gICAgZm9yIChwcm9wIGluIG9sZE9iamVjdCkge1xuICAgICAgb2xkVmFsdWUgPSBvbGRPYmplY3RbcHJvcF07XG4gICAgICB2YWx1ZSA9IG9iamVjdFtwcm9wXTtcblxuICAgICAgLy8gQWxsb3cgZm9yIHRoZSBjYXNlIG9mIG9iai5wcm9wID0gdW5kZWZpbmVkICh3aGljaCBpcyBhIG5ldyBwcm9wZXJ0eSwgZXZlbiBpZiBpdCBpcyB1bmRlZmluZWQpXG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCAmJiAhZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBwcm9wZXJ0eSBpcyBnb25lIGl0IHdhcyByZW1vdmVkXG4gICAgICBpZiAoISAocHJvcCBpbiBvYmplY3QpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ2RlbGV0ZWQnLCBwcm9wLCBvbGRWYWx1ZSkpO1xuICAgICAgfSBlbHNlIGlmIChkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICd1cGRhdGVkJywgcHJvcCwgb2xkVmFsdWUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBHb2VzIHRocm91Z2ggdGhlIG9sZCBvYmplY3QgYW5kIGxvb2tzIGZvciB0aGluZ3MgdGhhdCBhcmUgbmV3XG4gICAgZm9yIChwcm9wIGluIG9iamVjdCkge1xuICAgICAgdmFsdWUgPSBvYmplY3RbcHJvcF07XG4gICAgICBpZiAoISAocHJvcCBpbiBvbGRPYmplY3QpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ25ldycsIHByb3ApKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShvYmplY3QpICYmIG9iamVjdC5sZW5ndGggIT09IG9sZE9iamVjdC5sZW5ndGgpIHtcbiAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ3VwZGF0ZWQnLCAnbGVuZ3RoJywgb2xkT2JqZWN0Lmxlbmd0aCkpO1xuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VSZWNvcmRzO1xuICB9XG5cblxuXG5cblxuICBFRElUX0xFQVZFID0gMFxuICBFRElUX1VQREFURSA9IDFcbiAgRURJVF9BREQgPSAyXG4gIEVESVRfREVMRVRFID0gM1xuXG5cbiAgLy8gRGlmZnMgdHdvIGFycmF5cyByZXR1cm5pbmcgYW4gYXJyYXkgb2Ygc3BsaWNlcy4gQSBzcGxpY2Ugb2JqZWN0IGxvb2tzIGxpa2U6XG4gIC8vIGBgYGphdmFzY3JpcHRcbiAgLy8ge1xuICAvLyAgIGluZGV4OiAzLFxuICAvLyAgIHJlbW92ZWQ6IFtpdGVtLCBpdGVtXSxcbiAgLy8gICBhZGRlZENvdW50OiAwXG4gIC8vIH1cbiAgLy8gYGBgXG4gIGZ1bmN0aW9uIGRpZmZBcnJheXModmFsdWUsIG9sZFZhbHVlKSB7XG4gICAgdmFyIGN1cnJlbnRTdGFydCA9IDA7XG4gICAgdmFyIGN1cnJlbnRFbmQgPSB2YWx1ZS5sZW5ndGg7XG4gICAgdmFyIG9sZFN0YXJ0ID0gMDtcbiAgICB2YXIgb2xkRW5kID0gb2xkVmFsdWUubGVuZ3RoO1xuXG4gICAgdmFyIG1pbkxlbmd0aCA9IE1hdGgubWluKGN1cnJlbnRFbmQsIG9sZEVuZCk7XG4gICAgdmFyIHByZWZpeENvdW50ID0gc2hhcmVkUHJlZml4KHZhbHVlLCBvbGRWYWx1ZSwgbWluTGVuZ3RoKTtcbiAgICB2YXIgc3VmZml4Q291bnQgPSBzaGFyZWRTdWZmaXgodmFsdWUsIG9sZFZhbHVlLCBtaW5MZW5ndGggLSBwcmVmaXhDb3VudCk7XG5cbiAgICBjdXJyZW50U3RhcnQgKz0gcHJlZml4Q291bnQ7XG4gICAgb2xkU3RhcnQgKz0gcHJlZml4Q291bnQ7XG4gICAgY3VycmVudEVuZCAtPSBzdWZmaXhDb3VudDtcbiAgICBvbGRFbmQgLT0gc3VmZml4Q291bnQ7XG5cbiAgICBpZiAoY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCA9PT0gMCAmJiBvbGRFbmQgLSBvbGRTdGFydCA9PT0gMCkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIGFkZGVkLCBvbmx5IHJlbW92ZWQgZnJvbSBvbmUgc3BvdFxuICAgIGlmIChjdXJyZW50U3RhcnQgPT09IGN1cnJlbnRFbmQpIHtcbiAgICAgIHJldHVybiBbIG5ldyBTcGxpY2UoY3VycmVudFN0YXJ0LCBvbGRWYWx1ZS5zbGljZShvbGRTdGFydCwgb2xkRW5kKSwgMCkgXTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3RoaW5nIHdhcyByZW1vdmVkLCBvbmx5IGFkZGVkIHRvIG9uZSBzcG90XG4gICAgaWYgKG9sZFN0YXJ0ID09PSBvbGRFbmQpIHtcbiAgICAgIHJldHVybiBbIG5ldyBTcGxpY2UoY3VycmVudFN0YXJ0LCBbXSwgY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCkgXTtcbiAgICB9XG5cbiAgICAvLyBhIG1peHR1cmUgb2YgYWRkcyBhbmQgcmVtb3Zlc1xuICAgIHZhciBkaXN0YW5jZXMgPSBjYWxjRWRpdERpc3RhbmNlcyh2YWx1ZSwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGRWYWx1ZSwgb2xkU3RhcnQsIG9sZEVuZCk7XG4gICAgdmFyIG9wcyA9IHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpO1xuXG4gICAgdmFyIHNwbGljZSA9IG51bGw7XG4gICAgdmFyIHNwbGljZXMgPSBbXTtcbiAgICB2YXIgaW5kZXggPSBjdXJyZW50U3RhcnQ7XG4gICAgdmFyIG9sZEluZGV4ID0gb2xkU3RhcnQ7XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IG9wcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBvcCA9IG9wc1tpXTtcbiAgICAgIGlmIChvcCA9PT0gRURJVF9MRUFWRSkge1xuICAgICAgICBpZiAoc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgICAgICAgc3BsaWNlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4Kys7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX1VQREFURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG5cbiAgICAgICAgc3BsaWNlLnJlbW92ZWQucHVzaChvbGRWYWx1ZVtvbGRJbmRleF0pO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9BREQpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UuYWRkZWRDb3VudCsrO1xuICAgICAgICBpbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9ERUxFVEUpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNwbGljZSkge1xuICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNwbGljZXM7XG4gIH1cblxuXG5cblxuICAvLyBmaW5kIHRoZSBudW1iZXIgb2YgaXRlbXMgYXQgdGhlIGJlZ2lubmluZyB0aGF0IGFyZSB0aGUgc2FtZVxuICBmdW5jdGlvbiBzaGFyZWRQcmVmaXgoY3VycmVudCwgb2xkLCBzZWFyY2hMZW5ndGgpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNlYXJjaExlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoZGlmZkJhc2ljKGN1cnJlbnRbaV0sIG9sZFtpXSkpIHtcbiAgICAgICAgcmV0dXJuIGk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWFyY2hMZW5ndGg7XG4gIH1cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgZW5kIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFN1ZmZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIHZhciBpbmRleDEgPSBjdXJyZW50Lmxlbmd0aDtcbiAgICB2YXIgaW5kZXgyID0gb2xkLmxlbmd0aDtcbiAgICB2YXIgY291bnQgPSAwO1xuICAgIHdoaWxlIChjb3VudCA8IHNlYXJjaExlbmd0aCAmJiAhZGlmZkJhc2ljKGN1cnJlbnRbLS1pbmRleDFdLCBvbGRbLS1pbmRleDJdKSkge1xuICAgICAgY291bnQrKztcbiAgICB9XG4gICAgcmV0dXJuIGNvdW50O1xuICB9XG5cblxuICBmdW5jdGlvbiBzcGxpY2VPcGVyYXRpb25zRnJvbUVkaXREaXN0YW5jZXMoZGlzdGFuY2VzKSB7XG4gICAgdmFyIGkgPSBkaXN0YW5jZXMubGVuZ3RoIC0gMTtcbiAgICB2YXIgaiA9IGRpc3RhbmNlc1swXS5sZW5ndGggLSAxO1xuICAgIHZhciBjdXJyZW50ID0gZGlzdGFuY2VzW2ldW2pdO1xuICAgIHZhciBlZGl0cyA9IFtdO1xuICAgIHdoaWxlIChpID4gMCB8fCBqID4gMCkge1xuICAgICAgaWYgKGkgPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0FERCk7XG4gICAgICAgIGotLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChqID09PSAwKSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9ERUxFVEUpO1xuICAgICAgICBpLS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB2YXIgbm9ydGhXZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICB2YXIgd2VzdCA9IGRpc3RhbmNlc1tpIC0gMV1bal07XG4gICAgICB2YXIgbm9ydGggPSBkaXN0YW5jZXNbaV1baiAtIDFdO1xuXG4gICAgICBpZiAod2VzdCA8IG5vcnRoKSB7XG4gICAgICAgIG1pbiA9IHdlc3QgPCBub3J0aFdlc3QgPyB3ZXN0IDogbm9ydGhXZXN0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWluID0gbm9ydGggPCBub3J0aFdlc3QgPyBub3J0aCA6IG5vcnRoV2VzdDtcbiAgICAgIH1cblxuICAgICAgaWYgKG1pbiA9PT0gbm9ydGhXZXN0KSB7XG4gICAgICAgIGlmIChub3J0aFdlc3QgPT09IGN1cnJlbnQpIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfTEVBVkUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVkaXRzLnB1c2goRURJVF9VUERBVEUpO1xuICAgICAgICAgIGN1cnJlbnQgPSBub3J0aFdlc3Q7XG4gICAgICAgIH1cbiAgICAgICAgaS0tO1xuICAgICAgICBqLS07XG4gICAgICB9IGVsc2UgaWYgKG1pbiA9PT0gd2VzdCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfREVMRVRFKTtcbiAgICAgICAgaS0tO1xuICAgICAgICBjdXJyZW50ID0gd2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9BREQpO1xuICAgICAgICBqLS07XG4gICAgICAgIGN1cnJlbnQgPSBub3J0aDtcbiAgICAgIH1cbiAgICB9XG4gICAgZWRpdHMucmV2ZXJzZSgpO1xuICAgIHJldHVybiBlZGl0cztcbiAgfVxuXG5cbiAgZnVuY3Rpb24gY2FsY0VkaXREaXN0YW5jZXMoY3VycmVudCwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGQsIG9sZFN0YXJ0LCBvbGRFbmQpIHtcbiAgICAvLyBcIkRlbGV0aW9uXCIgY29sdW1uc1xuICAgIHZhciByb3dDb3VudCA9IG9sZEVuZCAtIG9sZFN0YXJ0ICsgMTtcbiAgICB2YXIgY29sdW1uQ291bnQgPSBjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0ICsgMTtcbiAgICB2YXIgZGlzdGFuY2VzID0gbmV3IEFycmF5KHJvd0NvdW50KTtcbiAgICB2YXIgaSwgajtcblxuICAgIC8vIFwiQWRkaXRpb25cIiByb3dzLiBJbml0aWFsaXplIG51bGwgY29sdW1uLlxuICAgIGZvciAoaSA9IDA7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSBuZXcgQXJyYXkoY29sdW1uQ291bnQpO1xuICAgICAgZGlzdGFuY2VzW2ldWzBdID0gaTtcbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIG51bGwgcm93XG4gICAgZm9yIChqID0gMDsgaiA8IGNvbHVtbkNvdW50OyBqKyspIHtcbiAgICAgIGRpc3RhbmNlc1swXVtqXSA9IGo7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMTsgaSA8IHJvd0NvdW50OyBpKyspIHtcbiAgICAgIGZvciAoaiA9IDE7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICAgIGlmICghZGlmZkJhc2ljKGN1cnJlbnRbY3VycmVudFN0YXJ0ICsgaiAtIDFdLCBvbGRbb2xkU3RhcnQgKyBpIC0gMV0pKSB7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIG5vcnRoID0gZGlzdGFuY2VzW2kgLSAxXVtqXSArIDE7XG4gICAgICAgICAgdmFyIHdlc3QgPSBkaXN0YW5jZXNbaV1baiAtIDFdICsgMTtcbiAgICAgICAgICBkaXN0YW5jZXNbaV1bal0gPSBub3J0aCA8IHdlc3QgPyBub3J0aCA6IHdlc3Q7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGlzdGFuY2VzO1xuICB9XG59KSgpO1xuIiwiLy8gIyBDaGlwIEV4cHJlc3Npb25cblxuLy8gUGFyc2VzIGEgc3RyaW5nIG9mIEphdmFTY3JpcHQgaW50byBhIGZ1bmN0aW9uIHdoaWNoIGNhbiBiZSBib3VuZCB0byBhIHNjb3BlLlxuLy9cbi8vIEFsbG93cyB1bmRlZmluZWQgb3IgbnVsbCB2YWx1ZXMgdG8gcmV0dXJuIHVuZGVmaW5lZCByYXRoZXIgdGhhbiB0aHJvd2luZ1xuLy8gZXJyb3JzLCBhbGxvd3MgZm9yIGZvcm1hdHRlcnMgb24gZGF0YSwgYW5kIHByb3ZpZGVzIGRldGFpbGVkIGVycm9yIHJlcG9ydGluZy5cblxuLy8gVGhlIGV4cHJlc3Npb24gb2JqZWN0IHdpdGggaXRzIGV4cHJlc3Npb24gY2FjaGUuXG52YXIgZXhwcmVzc2lvbiA9IGV4cG9ydHM7XG5leHByZXNzaW9uLmNhY2hlID0ge307XG5leHByZXNzaW9uLmdsb2JhbHMgPSBbJ3RydWUnLCAnZmFsc2UnLCAnbnVsbCcsICd1bmRlZmluZWQnLCAnd2luZG93JywgJ3RoaXMnXTtcbmV4cHJlc3Npb24uZ2V0ID0gZ2V0RXhwcmVzc2lvbjtcbmV4cHJlc3Npb24uZ2V0U2V0dGVyID0gZ2V0U2V0dGVyO1xuZXhwcmVzc2lvbi5iaW5kID0gYmluZEV4cHJlc3Npb247XG5cblxuLy8gQ3JlYXRlcyBhIGZ1bmN0aW9uIGZyb20gdGhlIGdpdmVuIGV4cHJlc3Npb24uIEFuIGBvcHRpb25zYCBvYmplY3QgbWF5IGJlXG4vLyBwcm92aWRlZCB3aXRoIHRoZSBmb2xsb3dpbmcgb3B0aW9uczpcbi8vICogYGFyZ3NgIGlzIGFuIGFycmF5IG9mIHN0cmluZ3Mgd2hpY2ggd2lsbCBiZSB0aGUgZnVuY3Rpb24ncyBhcmd1bWVudCBuYW1lc1xuLy8gKiBgZ2xvYmFsc2AgaXMgYW4gYXJyYXkgb2Ygc3RyaW5ncyB3aGljaCBkZWZpbmUgZ2xvYmFscyBhdmFpbGFibGUgdG8gdGhlXG4vLyBmdW5jdGlvbiAodGhlc2Ugd2lsbCBub3QgYmUgcHJlZml4ZWQgd2l0aCBgdGhpcy5gKS4gYCd0cnVlJ2AsIGAnZmFsc2UnYCxcbi8vIGAnbnVsbCdgLCBhbmQgYCd3aW5kb3cnYCBhcmUgaW5jbHVkZWQgYnkgZGVmYXVsdC5cbi8vXG4vLyBUaGlzIGZ1bmN0aW9uIHdpbGwgYmUgY2FjaGVkIHNvIHN1YnNlcXVlbnQgY2FsbHMgd2l0aCB0aGUgc2FtZSBleHByZXNzaW9uIHdpbGxcbi8vIHJldHVybiB0aGUgc2FtZSBmdW5jdGlvbi4gRS5nLiB0aGUgZXhwcmVzc2lvbiBcIm5hbWVcIiB3aWxsIGFsd2F5cyByZXR1cm4gYVxuLy8gc2luZ2xlIGZ1bmN0aW9uIHdpdGggdGhlIGJvZHkgYHJldHVybiB0aGlzLm5hbWVgLlxuZnVuY3Rpb24gZ2V0RXhwcmVzc2lvbihleHByLCBvcHRpb25zKSB7XG4gIGlmICghb3B0aW9ucykgb3B0aW9ucyA9IHt9O1xuICBpZiAoIW9wdGlvbnMuYXJncykgb3B0aW9ucy5hcmdzID0gW107XG4gIHZhciBjYWNoZUtleSA9IGV4cHIgKyAnfCcgKyBvcHRpb25zLmFyZ3Muam9pbignLCcpO1xuICAvLyBSZXR1cm5zIHRoZSBjYWNoZWQgZnVuY3Rpb24gZm9yIHRoaXMgZXhwcmVzc2lvbiBpZiBpdCBleGlzdHMuXG4gIHZhciBmdW5jID0gZXhwcmVzc2lvbi5jYWNoZVtjYWNoZUtleV07XG4gIGlmIChmdW5jKSB7XG4gICAgcmV0dXJuIGZ1bmM7XG4gIH1cblxuICBvcHRpb25zLmFyZ3MudW5zaGlmdCgnX2Zvcm1hdHRlcnNfJyk7XG5cbiAgLy8gUHJlZml4IGFsbCBwcm9wZXJ0eSBsb29rdXBzIHdpdGggdGhlIGB0aGlzYCBrZXl3b3JkLiBJZ25vcmVzIGtleXdvcmRzXG4gIC8vICh3aW5kb3csIHRydWUsIGZhbHNlKSBhbmQgZXh0cmEgYXJnc1xuICB2YXIgYm9keSA9IHBhcnNlRXhwcmVzc2lvbihleHByLCBvcHRpb25zKTtcblxuICB0cnkge1xuICAgIGZ1bmMgPSBleHByZXNzaW9uLmNhY2hlW2NhY2hlS2V5XSA9IEZ1bmN0aW9uLmFwcGx5KG51bGwsIG9wdGlvbnMuYXJncy5jb25jYXQoYm9keSkpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgaWYgKG9wdGlvbnMuaWdub3JlRXJyb3JzKSByZXR1cm47XG4gICAgLy8gVGhyb3dzIGFuIGVycm9yIGlmIHRoZSBleHByZXNzaW9uIHdhcyBub3QgdmFsaWQgSmF2YVNjcmlwdFxuICAgIGNvbnNvbGUuZXJyb3IoJ0JhZCBleHByZXNzaW9uOlxcbmAnICsgZXhwciArICdgXFxuJyArICdDb21waWxlZCBleHByZXNzaW9uOlxcbicgKyBib2R5KTtcbiAgICB0aHJvdyBuZXcgRXJyb3IoZS5tZXNzYWdlKTtcbiAgfVxuICByZXR1cm4gZnVuYztcbn1cblxuXG4vLyBDcmVhdGVzIGEgc2V0dGVyIGZ1bmN0aW9uIGZyb20gdGhlIGdpdmVuIGV4cHJlc3Npb24uXG5mdW5jdGlvbiBnZXRTZXR0ZXIoZXhwciwgb3B0aW9ucykge1xuICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcbiAgb3B0aW9ucy5hcmdzID0gWyd2YWx1ZSddO1xuICBleHByID0gZXhwci5yZXBsYWNlKC8oXFxzKlxcfHwkKS8sICcgPSB2YWx1ZSQxJyk7XG4gIHJldHVybiBnZXRFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpO1xufVxuXG5cblxuLy8gQ29tcGlsZXMgYW4gZXhwcmVzc2lvbiBhbmQgYmluZHMgaXQgaW4gdGhlIGdpdmVuIHNjb3BlLiBUaGlzIGFsbG93cyBpdCB0byBiZVxuLy8gY2FsbGVkIGZyb20gYW55d2hlcmUgKGUuZy4gZXZlbnQgbGlzdGVuZXJzKSB3aGlsZSByZXRhaW5pbmcgdGhlIHNjb3BlLlxuZnVuY3Rpb24gYmluZEV4cHJlc3Npb24oZXhwciwgc2NvcGUsIG9wdGlvbnMpIHtcbiAgcmV0dXJuIGdldEV4cHJlc3Npb24oZXhwciwgb3B0aW9ucykuYmluZChzY29wZSk7XG59XG5cbi8vIGZpbmRzIGFsbCBxdW90ZWQgc3RyaW5nc1xudmFyIHF1b3RlRXhwciA9IC8oWydcIlxcL10pKFxcXFxcXDF8W15cXDFdKSo/XFwxL2c7XG5cbi8vIGZpbmRzIGFsbCBlbXB0eSBxdW90ZWQgc3RyaW5nc1xudmFyIGVtcHR5UXVvdGVFeHByID0gLyhbJ1wiXFwvXSlcXDEvZztcblxuLy8gZmluZHMgcGlwZXMgdGhhdCBhcmVuJ3QgT1JzIChgIHwgYCBub3QgYCB8fCBgKSBmb3IgZm9ybWF0dGVyc1xudmFyIHBpcGVFeHByID0gL1xcfChcXHwpPy9nO1xuXG4vLyBmaW5kcyB0aGUgcGFydHMgb2YgYSBmb3JtYXR0ZXIgKG5hbWUgYW5kIGFyZ3MpXG52YXIgZm9ybWF0dGVyRXhwciA9IC9eKFteXFwoXSspKD86XFwoKC4qKVxcKSk/JC87XG5cbi8vIGZpbmRzIGFyZ3VtZW50IHNlcGFyYXRvcnMgZm9yIGZvcm1hdHRlcnMgKGBhcmcxOmFyZzJgKVxudmFyIGFyZ1NlcGFyYXRvciA9IC9cXHMqLFxccyovZztcblxuLy8gbWF0Y2hlcyBwcm9wZXJ0eSBjaGFpbnMgKGUuZy4gYG5hbWVgLCBgdXNlci5uYW1lYCwgYW5kIGB1c2VyLmZ1bGxOYW1lKCkuY2FwaXRhbGl6ZSgpYClcbnZhciBwcm9wRXhwciA9IC8oKFxce3wsfFxcLik/XFxzKikoW2EteiRfXFwkXSg/OlthLXpfXFwkMC05XFwuLV18XFxbWydcIlxcZF0rXFxdKSopKFxccyooOnxcXCh8XFxbKT8pL2dpO1xuXG4vLyBsaW5rcyBpbiBhIHByb3BlcnR5IGNoYWluXG52YXIgY2hhaW5MaW5rcyA9IC9cXC58XFxbL2c7XG5cbi8vIHRoZSBwcm9wZXJ0eSBuYW1lIHBhcnQgb2YgbGlua3NcbnZhciBjaGFpbkxpbmsgPSAvXFwufFxcW3xcXCgvO1xuXG4vLyBkZXRlcm1pbmVzIHdoZXRoZXIgYW4gZXhwcmVzc2lvbiBpcyBhIHNldHRlciBvciBnZXR0ZXIgKGBuYW1lYCB2c1xuLy8gYG5hbWUgPSAnYm9iJ2ApXG52YXIgc2V0dGVyRXhwciA9IC9cXHM9XFxzLztcblxudmFyIGlnbm9yZSA9IG51bGw7XG52YXIgc3RyaW5ncyA9IFtdO1xudmFyIHJlZmVyZW5jZUNvdW50ID0gMDtcbnZhciBjdXJyZW50UmVmZXJlbmNlID0gMDtcbnZhciBjdXJyZW50SW5kZXggPSAwO1xudmFyIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbnZhciBjb250aW51YXRpb24gPSBmYWxzZTtcblxuLy8gQWRkcyBgdGhpcy5gIHRvIHRoZSBiZWdpbm5pbmcgb2YgZWFjaCB2YWxpZCBwcm9wZXJ0eSBpbiBhbiBleHByZXNzaW9uLFxuLy8gcHJvY2Vzc2VzIGZvcm1hdHRlcnMsIGFuZCBwcm92aWRlcyBudWxsLXRlcm1pbmF0aW9uIGluIHByb3BlcnR5IGNoYWluc1xuZnVuY3Rpb24gcGFyc2VFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpIHtcbiAgaW5pdFBhcnNlKGV4cHIsIG9wdGlvbnMpO1xuICBleHByID0gcHVsbE91dFN0cmluZ3MoZXhwcik7XG4gIGV4cHIgPSBwYXJzZUZvcm1hdHRlcnMoZXhwcik7XG4gIGV4cHIgPSBwYXJzZUV4cHIoZXhwcik7XG4gIGV4cHIgPSAncmV0dXJuICcgKyBleHByO1xuICBleHByID0gcHV0SW5TdHJpbmdzKGV4cHIpO1xuICBleHByID0gYWRkUmVmZXJlbmNlcyhleHByKTtcbiAgcmV0dXJuIGV4cHI7XG59XG5cblxuZnVuY3Rpb24gaW5pdFBhcnNlKGV4cHIsIG9wdGlvbnMpIHtcbiAgcmVmZXJlbmNlQ291bnQgPSBjdXJyZW50UmVmZXJlbmNlID0gMDtcbiAgLy8gSWdub3JlcyBrZXl3b3JkcyBhbmQgcHJvdmlkZWQgYXJndW1lbnQgbmFtZXNcbiAgaWdub3JlID0gZXhwcmVzc2lvbi5nbG9iYWxzLmNvbmNhdChvcHRpb25zLmdsb2JhbHMgfHwgW10sIG9wdGlvbnMuYXJncyB8fCBbXSk7XG4gIHN0cmluZ3MubGVuZ3RoID0gMDtcbn1cblxuXG4vLyBBZGRzIHBsYWNlaG9sZGVycyBmb3Igc3RyaW5ncyBzbyB3ZSBjYW4gcHJvY2VzcyB0aGUgcmVzdCB3aXRob3V0IHRoZWlyIGNvbnRlbnRcbi8vIG1lc3NpbmcgdXMgdXAuXG5mdW5jdGlvbiBwdWxsT3V0U3RyaW5ncyhleHByKSB7XG4gIHJldHVybiBleHByLnJlcGxhY2UocXVvdGVFeHByLCBmdW5jdGlvbihzdHIsIHF1b3RlKSB7XG4gICAgc3RyaW5ncy5wdXNoKHN0cik7XG4gICAgcmV0dXJuIHF1b3RlICsgcXVvdGU7IC8vIHBsYWNlaG9sZGVyIGZvciB0aGUgc3RyaW5nXG4gIH0pO1xufVxuXG5cbi8vIFJlcGxhY2VzIHN0cmluZyBwbGFjZWhvbGRlcnMuXG5mdW5jdGlvbiBwdXRJblN0cmluZ3MoZXhwcikge1xuICByZXR1cm4gZXhwci5yZXBsYWNlKGVtcHR5UXVvdGVFeHByLCBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gc3RyaW5ncy5zaGlmdCgpO1xuICB9KTtcbn1cblxuXG4vLyBQcmVwZW5kcyByZWZlcmVuY2UgdmFyaWFibGUgZGVmaW5pdGlvbnNcbmZ1bmN0aW9uIGFkZFJlZmVyZW5jZXMoZXhwcikge1xuICBpZiAocmVmZXJlbmNlQ291bnQpIHtcbiAgICB2YXIgcmVmcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAxOyBpIDw9IHJlZmVyZW5jZUNvdW50OyBpKyspIHtcbiAgICAgIHJlZnMucHVzaCgnX3JlZicgKyBpKTtcbiAgICB9XG4gICAgZXhwciA9ICd2YXIgJyArIHJlZnMuam9pbignLCAnKSArICc7XFxuJyArIGV4cHI7XG4gIH1cbiAgcmV0dXJuIGV4cHI7XG59XG5cblxuZnVuY3Rpb24gcGFyc2VGb3JtYXR0ZXJzKGV4cHIpIHtcbiAgLy8gUmVtb3ZlcyBmb3JtYXR0ZXJzIGZyb20gZXhwcmVzc2lvbiBzdHJpbmdcbiAgZXhwciA9IGV4cHIucmVwbGFjZShwaXBlRXhwciwgZnVuY3Rpb24obWF0Y2gsIG9ySW5kaWNhdG9yKSB7XG4gICAgaWYgKG9ySW5kaWNhdG9yKSByZXR1cm4gbWF0Y2g7XG4gICAgcmV0dXJuICdAQEAnO1xuICB9KTtcblxuICBmb3JtYXR0ZXJzID0gZXhwci5zcGxpdCgvXFxzKkBAQFxccyovKTtcbiAgZXhwciA9IGZvcm1hdHRlcnMuc2hpZnQoKTtcbiAgaWYgKCFmb3JtYXR0ZXJzLmxlbmd0aCkgcmV0dXJuIGV4cHI7XG5cbiAgLy8gUHJvY2Vzc2VzIHRoZSBmb3JtYXR0ZXJzXG4gIC8vIElmIHRoZSBleHByZXNzaW9uIGlzIGEgc2V0dGVyIHRoZSB2YWx1ZSB3aWxsIGJlIHJ1biB0aHJvdWdoIHRoZSBmb3JtYXR0ZXJzXG4gIHZhciBzZXR0ZXIgPSAnJztcbiAgdmFsdWUgPSBleHByO1xuXG4gIGlmIChzZXR0ZXJFeHByLnRlc3QoZXhwcikpIHtcbiAgICB2YXIgcGFydHMgPSBleHByLnNwbGl0KHNldHRlckV4cHIpO1xuICAgIHNldHRlciA9IHBhcnRzWzBdICsgJyA9ICc7XG4gICAgdmFsdWUgPSBwYXJ0c1sxXTtcbiAgfVxuXG4gIGZvcm1hdHRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3JtYXR0ZXIpIHtcbiAgICB2YXIgbWF0Y2ggPSBmb3JtYXR0ZXIudHJpbSgpLm1hdGNoKGZvcm1hdHRlckV4cHIpO1xuICAgIGlmICghbWF0Y2gpIHRocm93IG5ldyBFcnJvcignRm9ybWF0dGVyIGlzIGludmFsaWQ6ICcgKyBmb3JtYXR0ZXIpO1xuICAgIHZhciBmb3JtYXR0ZXJOYW1lID0gbWF0Y2hbMV07XG4gICAgdmFyIGFyZ3MgPSBtYXRjaFsyXSA/IG1hdGNoWzJdLnNwbGl0KGFyZ1NlcGFyYXRvcikgOiBbXTtcbiAgICBhcmdzLnVuc2hpZnQodmFsdWUpO1xuICAgIGlmIChzZXR0ZXIpIGFyZ3MucHVzaCh0cnVlKTtcbiAgICB2YWx1ZSA9ICdfZm9ybWF0dGVyc18uJyArIGZvcm1hdHRlck5hbWUgKyAnLmNhbGwodGhpcywgJyArIGFyZ3Muam9pbignLCAnKSArICcpJztcbiAgfSk7XG5cbiAgcmV0dXJuIHNldHRlciArIHZhbHVlO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlRXhwcihleHByKSB7XG4gIGlmIChzZXR0ZXJFeHByLnRlc3QoZXhwcikpIHtcbiAgICB2YXIgcGFydHMgPSBleHByLnNwbGl0KCcgPSAnKTtcbiAgICB2YXIgc2V0dGVyID0gcGFydHNbMF07XG4gICAgdmFyIHZhbHVlID0gcGFydHNbMV07XG4gICAgdmFyIG5lZ2F0ZSA9ICcnO1xuICAgIGlmIChzZXR0ZXIuY2hhckF0KDApID09PSAnIScpIHtcbiAgICAgIG5lZ2F0ZSA9ICchJztcbiAgICAgIHNldHRlciA9IHNldHRlci5zbGljZSgxKTtcbiAgICB9XG4gICAgc2V0dGVyID0gcGFyc2VQcm9wZXJ0eUNoYWlucyhzZXR0ZXIpLnJlcGxhY2UoL15cXCh8XFwpJC9nLCAnJykgKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnNlUHJvcGVydHlDaGFpbnModmFsdWUpO1xuICAgIHJldHVybiBzZXR0ZXIgKyBuZWdhdGUgKyB2YWx1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKTtcbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHBhcnNlUHJvcGVydHlDaGFpbnMoZXhwcikge1xuICB2YXIgamF2YXNjcmlwdCA9ICcnLCBqcztcbiAgLy8gYWxsb3cgcmVjdXJzaW9uIGludG8gZnVuY3Rpb24gYXJncyBieSByZXNldHRpbmcgcHJvcEV4cHJcbiAgdmFyIHByZXZpb3VzSW5kZXhlcyA9IFtjdXJyZW50SW5kZXgsIHByb3BFeHByLmxhc3RJbmRleF07XG4gIGN1cnJlbnRJbmRleCA9IDA7XG4gIHByb3BFeHByLmxhc3RJbmRleCA9IDA7XG4gIHdoaWxlICgoanMgPSBuZXh0Q2hhaW4oZXhwcikpICE9PSBmYWxzZSkge1xuICAgIGphdmFzY3JpcHQgKz0ganM7XG4gIH1cbiAgY3VycmVudEluZGV4ID0gcHJldmlvdXNJbmRleGVzWzBdO1xuICBwcm9wRXhwci5sYXN0SW5kZXggPSBwcmV2aW91c0luZGV4ZXNbMV07XG4gIHJldHVybiBqYXZhc2NyaXB0O1xufVxuXG5cbmZ1bmN0aW9uIG5leHRDaGFpbihleHByKSB7XG4gIGlmIChmaW5pc2hlZENoYWluKSB7XG4gICAgcmV0dXJuIChmaW5pc2hlZENoYWluID0gZmFsc2UpO1xuICB9XG4gIHZhciBtYXRjaCA9IHByb3BFeHByLmV4ZWMoZXhwcik7XG4gIGlmICghbWF0Y2gpIHtcbiAgICBmaW5pc2hlZENoYWluID0gdHJ1ZSAvLyBtYWtlIHN1cmUgbmV4dCBjYWxsIHdlIHJldHVybiBmYWxzZVxuICAgIHJldHVybiBleHByLnNsaWNlKGN1cnJlbnRJbmRleCk7XG4gIH1cblxuICAvLyBgcHJlZml4YCBpcyBgb2JqSW5kaWNhdG9yYCB3aXRoIHRoZSB3aGl0ZXNwYWNlIHRoYXQgbWF5IGNvbWUgYWZ0ZXIgaXQuXG4gIHZhciBwcmVmaXggPSBtYXRjaFsxXTtcblxuICAvLyBgb2JqSW5kaWNhdG9yYCBpcyBge2Agb3IgYCxgIGFuZCBsZXQncyB1cyBrbm93IHRoaXMgaXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gIC8vIG5hbWUgKGUuZy4gcHJvcCBpbiBge3Byb3A6ZmFsc2V9YCkuXG4gIHZhciBvYmpJbmRpY2F0b3IgPSBtYXRjaFsyXTtcblxuICAvLyBgcHJvcENoYWluYCBpcyB0aGUgY2hhaW4gb2YgcHJvcGVydGllcyBtYXRjaGVkIChlLmcuIGB0aGlzLnVzZXIuZW1haWxgKS5cbiAgdmFyIHByb3BDaGFpbiA9IG1hdGNoWzNdO1xuXG4gIC8vIGBwb3N0Zml4YCBpcyB0aGUgYGNvbG9uT3JQYXJlbmAgd2l0aCB3aGl0ZXNwYWNlIGJlZm9yZSBpdC5cbiAgdmFyIHBvc3RmaXggPSBtYXRjaFs0XTtcblxuICAvLyBgY29sb25PclBhcmVuYCBtYXRjaGVzIHRoZSBjb2xvbiAoOikgYWZ0ZXIgdGhlIHByb3BlcnR5IChpZiBpdCBpcyBhbiBvYmplY3QpXG4gIC8vIG9yIHBhcmVudGhlc2lzIGlmIGl0IGlzIGEgZnVuY3Rpb24uIFdlIHVzZSBgY29sb25PclBhcmVuYCBhbmQgYG9iakluZGljYXRvcmBcbiAgLy8gdG8ga25vdyBpZiBpdCBpcyBhbiBvYmplY3QuXG4gIHZhciBjb2xvbk9yUGFyZW4gPSBtYXRjaFs1XTtcblxuICBtYXRjaCA9IG1hdGNoWzBdO1xuXG4gIHZhciBza2lwcGVkID0gZXhwci5zbGljZShjdXJyZW50SW5kZXgsIHByb3BFeHByLmxhc3RJbmRleCAtIG1hdGNoLmxlbmd0aCk7XG4gIGN1cnJlbnRJbmRleCA9IHByb3BFeHByLmxhc3RJbmRleDtcblxuICAvLyBza2lwcyBvYmplY3Qga2V5cyBlLmcuIHRlc3QgaW4gYHt0ZXN0OnRydWV9YC5cbiAgaWYgKG9iakluZGljYXRvciAmJiBjb2xvbk9yUGFyZW4gPT09ICc6Jykge1xuICAgIHJldHVybiBza2lwcGVkICsgbWF0Y2g7XG4gIH1cblxuICByZXR1cm4gc2tpcHBlZCArIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIGNvbG9uT3JQYXJlbiwgZXhwcik7XG59XG5cblxuZnVuY3Rpb24gc3BsaXRMaW5rcyhjaGFpbikge1xuICB2YXIgaW5kZXggPSAwO1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG1hdGNoO1xuICB3aGlsZSAobWF0Y2ggPSBjaGFpbkxpbmtzLmV4ZWMoY2hhaW4pKSB7XG4gICAgaWYgKGNoYWluTGlua3MubGFzdEluZGV4ID09PSAxKSBjb250aW51ZTtcbiAgICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4LCBjaGFpbkxpbmtzLmxhc3RJbmRleCAtIDEpKTtcbiAgICBpbmRleCA9IGNoYWluTGlua3MubGFzdEluZGV4IC0gMTtcbiAgfVxuICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4KSk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuXG5mdW5jdGlvbiBhZGRUaGlzKGNoYWluKSB7XG4gIGlmIChpZ25vcmUuaW5kZXhPZihjaGFpbi5zcGxpdChjaGFpbkxpbmspLnNoaWZ0KCkpID09PSAtMSkge1xuICAgIHJldHVybiAndGhpcy4nICsgY2hhaW47XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGNoYWluO1xuICB9XG59XG5cblxuZnVuY3Rpb24gcGFyc2VDaGFpbihwcmVmaXgsIHByb3BDaGFpbiwgcG9zdGZpeCwgcGFyZW4sIGV4cHIpIHtcbiAgLy8gY29udGludWF0aW9ucyBhZnRlciBhIGZ1bmN0aW9uIChlLmcuIGBnZXRVc2VyKDEyKS5maXJzdE5hbWVgKS5cbiAgY29udGludWF0aW9uID0gcHJlZml4ID09PSAnLic7XG4gIGlmIChjb250aW51YXRpb24pIHtcbiAgICBwcm9wQ2hhaW4gPSAnLicgKyBwcm9wQ2hhaW47XG4gICAgcHJlZml4ID0gJyc7XG4gIH1cblxuICB2YXIgbGlua3MgPSBzcGxpdExpbmtzKHByb3BDaGFpbik7XG4gIHZhciBuZXdDaGFpbiA9ICcnO1xuXG4gIGlmIChsaW5rcy5sZW5ndGggPT09IDEgJiYgIWNvbnRpbnVhdGlvbiAmJiAhcGFyZW4pIHtcbiAgICBsaW5rID0gbGlua3NbMF07XG4gICAgbmV3Q2hhaW4gPSBhZGRUaGlzKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGlmICghY29udGludWF0aW9uKSB7XG4gICAgICBuZXdDaGFpbiA9ICcoJztcbiAgICB9XG5cbiAgICBsaW5rcy5mb3JFYWNoKGZ1bmN0aW9uKGxpbmssIGluZGV4KSB7XG4gICAgICBpZiAoaW5kZXggIT09IGxpbmtzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgbmV3Q2hhaW4gKz0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghcGFyZW5zW3BhcmVuXSkge1xuICAgICAgICAgIG5ld0NoYWluICs9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rICsgJyknO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHBvc3RmaXggPSBwb3N0Zml4LnJlcGxhY2UocGFyZW4sICcnKTtcbiAgICAgICAgICBuZXdDaGFpbiArPSBwYXJzZUZ1bmN0aW9uKGxpbmssIGluZGV4LCBleHByKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHByZWZpeCArIG5ld0NoYWluICsgcG9zdGZpeDtcbn1cblxuXG52YXIgcGFyZW5zID0ge1xuICAnKCc6ICcpJyxcbiAgJ1snOiAnXSdcbn07XG5cbi8vIEhhbmRsZXMgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgaW4gaXRzIGNvcnJlY3Qgc2NvcGVcbi8vIEZpbmRzIHRoZSBlbmQgb2YgdGhlIGZ1bmN0aW9uIGFuZCBwcm9jZXNzZXMgdGhlIGFyZ3VtZW50c1xuZnVuY3Rpb24gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcbiAgbGluayArPSBjYWxsLnNsaWNlKDAsIDEpICsgJ35+aW5zaWRlUGFyZW5zfn4nICsgY2FsbC5zbGljZSgtMSk7XG4gIHZhciBpbnNpZGVQYXJlbnMgPSBjYWxsLnNsaWNlKDEsIC0xKTtcblxuICBpZiAoZXhwci5jaGFyQXQocHJvcEV4cHIubGFzdEluZGV4KSA9PT0gJy4nKSB7XG4gICAgbGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleClcbiAgfSBlbHNlIGlmIChpbmRleCA9PT0gMCkge1xuICAgIGxpbmsgPSBwYXJzZVBhcnQobGluaywgaW5kZXgpO1xuICAgIGxpbmsgKz0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArICcpJztcbiAgfSBlbHNlIHtcbiAgICBsaW5rID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIGxpbmsgKyAnKSc7XG4gIH1cblxuICB2YXIgcmVmID0gY3VycmVudFJlZmVyZW5jZTtcbiAgbGluayA9IGxpbmsucmVwbGFjZSgnfn5pbnNpZGVQYXJlbnN+ficsIHBhcnNlUHJvcGVydHlDaGFpbnMoaW5zaWRlUGFyZW5zKSk7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSByZWY7XG4gIHJldHVybiBsaW5rO1xufVxuXG5cbi8vIHJldHVybnMgdGhlIGNhbGwgcGFydCBvZiBhIGZ1bmN0aW9uIChlLmcuIGB0ZXN0KDEyMylgIHdvdWxkIHJldHVybiBgKDEyMylgKVxuZnVuY3Rpb24gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpIHtcbiAgdmFyIHN0YXJ0SW5kZXggPSBwcm9wRXhwci5sYXN0SW5kZXg7XG4gIHZhciBvcGVuID0gZXhwci5jaGFyQXQoc3RhcnRJbmRleCAtIDEpO1xuICB2YXIgY2xvc2UgPSBwYXJlbnNbb3Blbl07XG4gIHZhciBlbmRJbmRleCA9IHN0YXJ0SW5kZXggLSAxO1xuICB2YXIgcGFyZW5Db3VudCA9IDE7XG4gIHdoaWxlIChlbmRJbmRleCsrIDwgZXhwci5sZW5ndGgpIHtcbiAgICB2YXIgY2ggPSBleHByLmNoYXJBdChlbmRJbmRleCk7XG4gICAgaWYgKGNoID09PSBvcGVuKSBwYXJlbkNvdW50Kys7XG4gICAgZWxzZSBpZiAoY2ggPT09IGNsb3NlKSBwYXJlbkNvdW50LS07XG4gICAgaWYgKHBhcmVuQ291bnQgPT09IDApIGJyZWFrO1xuICB9XG4gIGN1cnJlbnRJbmRleCA9IHByb3BFeHByLmxhc3RJbmRleCA9IGVuZEluZGV4ICsgMTtcbiAgcmV0dXJuIG9wZW4gKyBleHByLnNsaWNlKHN0YXJ0SW5kZXgsIGVuZEluZGV4KSArIGNsb3NlO1xufVxuXG5cblxuZnVuY3Rpb24gcGFyc2VQYXJ0KHBhcnQsIGluZGV4KSB7XG4gIC8vIGlmIHRoZSBmaXJzdFxuICBpZiAoaW5kZXggPT09IDAgJiYgIWNvbnRpbnVhdGlvbikge1xuICAgIGlmIChpZ25vcmUuaW5kZXhPZihwYXJ0LnNwbGl0KC9cXC58XFwofFxcWy8pLnNoaWZ0KCkpID09PSAtMSkge1xuICAgICAgcGFydCA9ICd0aGlzLicgKyBwYXJ0O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBwYXJ0ID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIHBhcnQ7XG4gIH1cblxuICBjdXJyZW50UmVmZXJlbmNlID0gKytyZWZlcmVuY2VDb3VudDtcbiAgdmFyIHJlZiA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2U7XG4gIHJldHVybiAnKCcgKyByZWYgKyAnID0gJyArIHBhcnQgKyAnKSA9PSBudWxsID8gdW5kZWZpbmVkIDogJztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IHJlcXVpcmUoJy4vb2JzZXJ2ZXInKTtcbmV4cG9ydHMuZXhwcmVzc2lvbiA9IHJlcXVpcmUoJy4vZXhwcmVzc2lvbicpO1xuZXhwb3J0cy5leHByZXNzaW9uLmRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gT2JzZXJ2ZXI7XG52YXIgZXhwcmVzc2lvbiA9IHJlcXVpcmUoJy4vZXhwcmVzc2lvbicpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciByZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8IHNldFRpbWVvdXQ7XG52YXIgY2FuY2VsQW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUgfHwgY2xlYXJUaW1lb3V0O1xuXG4vLyAjIE9ic2VydmVyXG5cbi8vIERlZmluZXMgYW4gb2JzZXJ2ZXIgY2xhc3Mgd2hpY2ggcmVwcmVzZW50cyBhbiBleHByZXNzaW9uLiBXaGVuZXZlciB0aGF0IGV4cHJlc3Npb24gcmV0dXJucyBhIG5ldyB2YWx1ZSB0aGUgYGNhbGxiYWNrYFxuLy8gaXMgY2FsbGVkIHdpdGggdGhlIHZhbHVlLlxuLy9cbi8vIElmIHRoZSBvbGQgYW5kIG5ldyB2YWx1ZXMgd2VyZSBlaXRoZXIgYW4gYXJyYXkgb3IgYW4gb2JqZWN0LCB0aGUgYGNhbGxiYWNrYCBhbHNvXG4vLyByZWNlaXZlcyBhbiBhcnJheSBvZiBzcGxpY2VzIChmb3IgYW4gYXJyYXkpLCBvciBhbiBhcnJheSBvZiBjaGFuZ2Ugb2JqZWN0cyAoZm9yIGFuIG9iamVjdCkgd2hpY2ggYXJlIHRoZSBzYW1lXG4vLyBmb3JtYXQgdGhhdCBgQXJyYXkub2JzZXJ2ZWAgYW5kIGBPYmplY3Qub2JzZXJ2ZWAgcmV0dXJuIDxodHRwOi8vd2lraS5lY21hc2NyaXB0Lm9yZy9kb2t1LnBocD9pZD1oYXJtb255Om9ic2VydmU+LlxuZnVuY3Rpb24gT2JzZXJ2ZXIoZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICBpZiAodHlwZW9mIGV4cHIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aGlzLmdldHRlciA9IGV4cHI7XG4gICAgdGhpcy5zZXR0ZXIgPSBleHByO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuZ2V0dGVyID0gZXhwcmVzc2lvbi5nZXQoZXhwcik7XG4gIH1cbiAgdGhpcy5leHByID0gZXhwcjtcbiAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrO1xuICB0aGlzLmNhbGxiYWNrQ29udGV4dCA9IGNhbGxiYWNrQ29udGV4dDtcbiAgdGhpcy5za2lwID0gZmFsc2U7XG4gIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB0aGlzLm9sZFZhbHVlID0gdW5kZWZpbmVkO1xufVxuXG5PYnNlcnZlci5wcm90b3R5cGUgPSB7XG5cbiAgLy8gQmluZHMgdGhpcyBleHByZXNzaW9uIHRvIGEgZ2l2ZW4gY29udGV4dFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0LCBza2lwVXBkYXRlKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5jYWxsYmFjaykge1xuICAgICAgT2JzZXJ2ZXIuYWRkKHRoaXMsIHNraXBVcGRhdGUpO1xuICAgIH1cbiAgfSxcblxuICAvLyBVbmJpbmRzIHRoaXMgZXhwcmVzc2lvblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gICAgT2JzZXJ2ZXIucmVtb3ZlKHRoaXMpO1xuICAgIHRoaXMuc3luYygpO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhpcyBvYnNlcnZlclxuICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldHRlci5jYWxsKHRoaXMuY29udGV4dCwgT2JzZXJ2ZXIuZm9ybWF0dGVycyk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFNldHMgdGhlIHZhbHVlIG9mIHRoaXMgZXhwcmVzc2lvblxuICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHJldHVybjtcbiAgICBpZiAodGhpcy5zZXR0ZXIgPT09IGZhbHNlKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLnNldHRlcikge1xuICAgICAgdGhpcy5zZXR0ZXIgPSB0eXBlb2YgdGhpcy5leHByID09PSAnc3RyaW5nJ1xuICAgICAgICA/IGV4cHJlc3Npb24uZ2V0U2V0dGVyKHRoaXMuZXhwciwgeyBpZ25vcmVFcnJvcnM6IHRydWUgfSkgfHwgZmFsc2VcbiAgICAgICAgOiBmYWxzZTtcbiAgICAgIGlmICghdGhpcy5zZXR0ZXIpIHJldHVybjtcbiAgICB9XG5cbiAgICB0cnkge1xuICAgICAgdmFyIHJlc3VsdCA9IHRoaXMuc2V0dGVyLmNhbGwodGhpcy5jb250ZXh0Ll9vcmlnQ29udGV4dF8gfHwgdGhpcy5jb250ZXh0LCBPYnNlcnZlci5mb3JtYXR0ZXJzLCB2YWx1ZSk7XG4gICAgfSBjYXRjaChlKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5zeW5jKCk7XG4gICAgT2JzZXJ2ZXIuc3luYygpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cblxuICAvLyBJbnN0cnVjdHMgdGhpcyBvYnNlcnZlciB0byBub3QgY2FsbCBpdHMgYGNhbGxiYWNrYCBvbiB0aGUgbmV4dCBzeW5jLCB3aGV0aGVyIHRoZSB2YWx1ZSBoYXMgY2hhbmdlZCBvciBub3RcbiAgc2tpcE5leHRTeW5jOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNraXAgPSB0cnVlO1xuICB9LFxuXG5cbiAgLy8gU3luY3MgdGhpcyBvYnNlcnZlciBub3csIGNhbGxpbmcgdGhlIGNhbGxiYWNrIGltbWVkaWF0ZWx5IGlmIHRoZXJlIGhhdmUgYmVlbiBjaGFuZ2VzXG4gIHN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KCk7XG5cbiAgICAvLyBEb24ndCBjYWxsIHRoZSBjYWxsYmFjayBpZiBgc2tpcE5leHRTeW5jYCB3YXMgY2FsbGVkIG9uIHRoZSBvYnNlcnZlclxuICAgIGlmICh0aGlzLnNraXAgfHwgIXRoaXMuY2FsbGJhY2spIHtcbiAgICAgIHRoaXMuc2tpcCA9IGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhbiBhcnJheSBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIHNwbGljZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrLiBUaGlzXG4gICAgICB2YXIgY2hhbmdlZCA9IGRpZmYudmFsdWVzKHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIGlmICghY2hhbmdlZCAmJiAhdGhpcy5mb3JjZVVwZGF0ZU5leHRTeW5jKSByZXR1cm47XG4gICAgICB0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSBmYWxzZTtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGNoYW5nZWQpKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUsIGNoYW5nZWQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmNhbGxiYWNrLmNhbGwodGhpcy5jYWxsYmFja0NvbnRleHQsIHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdG9yZSBhbiBpbW11dGFibGUgdmVyc2lvbiBvZiB0aGUgdmFsdWUsIGFsbG93aW5nIGZvciBhcnJheXMgYW5kIG9iamVjdHMgdG8gY2hhbmdlIGluc3RhbmNlIGJ1dCBub3QgY29udGVudCBhbmRcbiAgICAvLyBzdGlsbCByZWZyYWluIGZyb20gZGlzcGF0Y2hpbmcgY2FsbGJhY2tzIChlLmcuIHdoZW4gdXNpbmcgYW4gb2JqZWN0IGluIGJpbmQtY2xhc3Mgb3Igd2hlbiB1c2luZyBhcnJheSBmb3JtYXR0ZXJzXG4gICAgLy8gaW4gYmluZC1lYWNoKVxuICAgIHRoaXMub2xkVmFsdWUgPSBkaWZmLmNsb25lKHZhbHVlKTtcbiAgfVxufTtcblxuXG4vLyBBbiBhcnJheSBvZiBhbGwgb2JzZXJ2ZXJzLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIub2JzZXJ2ZXJzID0gW107XG5cbi8vIEFuIGFycmF5IG9mIGNhbGxiYWNrcyB0byBydW4gYWZ0ZXIgdGhlIG5leHQgc3luYywgY29uc2lkZXJlZCAqcHJpdmF0ZSpcbk9ic2VydmVyLmNhbGxiYWNrcyA9IFtdO1xuT2JzZXJ2ZXIubGlzdGVuZXJzID0gW107XG5cbi8vIEFkZHMgYSBuZXcgb2JzZXJ2ZXIgdG8gYmUgc3luY2VkIHdpdGggY2hhbmdlcy4gSWYgYHNraXBVcGRhdGVgIGlzIHRydWUgdGhlbiB0aGUgY2FsbGJhY2sgd2lsbCBvbmx5IGJlIGNhbGxlZCB3aGVuIGFcbi8vIGNoYW5nZSBpcyBtYWRlLCBub3QgaW5pdGlhbGx5LlxuT2JzZXJ2ZXIuYWRkID0gZnVuY3Rpb24ob2JzZXJ2ZXIsIHNraXBVcGRhdGUpIHtcbiAgdGhpcy5vYnNlcnZlcnMucHVzaChvYnNlcnZlcik7XG4gIGlmICghc2tpcFVwZGF0ZSkgb2JzZXJ2ZXIuc3luYygpO1xufTtcblxuLy8gUmVtb3ZlcyBhbiBvYnNlcnZlciwgc3RvcHBpbmcgaXQgZnJvbSBiZWluZyBydW5cbk9ic2VydmVyLnJlbW92ZSA9IGZ1bmN0aW9uKG9ic2VydmVyKSB7XG4gIHZhciBpbmRleCA9IHRoaXMub2JzZXJ2ZXJzLmluZGV4T2Yob2JzZXJ2ZXIpO1xuICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgdGhpcy5vYnNlcnZlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbi8vICpwcml2YXRlKiBwcm9wZXJ0aWVzIHVzZWQgaW4gdGhlIHN5bmMgY3ljbGVcbk9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbk9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG5PYnNlcnZlci5jeWNsZXMgPSAwO1xuT2JzZXJ2ZXIubWF4ID0gMTA7XG5PYnNlcnZlci50aW1lb3V0ID0gbnVsbDtcbk9ic2VydmVyLnN5bmNQZW5kaW5nID0gbnVsbDtcblxuLy8gU2NoZWR1bGVzIGFuIG9ic2VydmVyIHN5bmMgY3ljbGUgd2hpY2ggY2hlY2tzIGFsbCB0aGUgb2JzZXJ2ZXJzIHRvIHNlZSBpZiB0aGV5J3ZlIGNoYW5nZWQuXG5PYnNlcnZlci5zeW5jID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKE9ic2VydmVyLnN5bmNQZW5kaW5nKSByZXR1cm4gZmFsc2U7XG4gIE9ic2VydmVyLnN5bmNQZW5kaW5nID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZ1bmN0aW9uKCkge1xuICAgIE9ic2VydmVyLnN5bmNOb3coY2FsbGJhY2spO1xuICB9KTtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBSdW5zIHRoZSBvYnNlcnZlciBzeW5jIGN5Y2xlIHdoaWNoIGNoZWNrcyBhbGwgdGhlIG9ic2VydmVycyB0byBzZWUgaWYgdGhleSd2ZSBjaGFuZ2VkLlxuT2JzZXJ2ZXIuc3luY05vdyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICBPYnNlcnZlci5hZnRlclN5bmMoY2FsbGJhY2spO1xuICB9XG5cbiAgY2FuY2VsQW5pbWF0aW9uRnJhbWUoT2JzZXJ2ZXIuc3luY1BlbmRpbmcpO1xuICBPYnNlcnZlci5zeW5jUGVuZGluZyA9IG51bGw7XG5cbiAgaWYgKE9ic2VydmVyLnN5bmNpbmcpIHtcbiAgICBPYnNlcnZlci5yZXJ1biA9IHRydWU7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgT2JzZXJ2ZXIuc3luY2luZyA9IHRydWU7XG4gIE9ic2VydmVyLnJlcnVuID0gdHJ1ZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcblxuICAvLyBBbGxvdyBjYWxsYmFja3MgdG8gcnVuIHRoZSBzeW5jIGN5Y2xlIGFnYWluIGltbWVkaWF0ZWx5LCBidXQgc3RvcCBhdCBgT2JzZXJ2ZXIubWF4YCAoZGVmYXVsdCAxMCkgY3ljbGVzIHRvIHdlIGRvbid0XG4gIC8vIHJ1biBpbmZpbml0ZSBsb29wc1xuICB3aGlsZSAoT2JzZXJ2ZXIucmVydW4pIHtcbiAgICBpZiAoKytPYnNlcnZlci5jeWNsZXMgPT09IE9ic2VydmVyLm1heCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbmZpbml0ZSBvYnNlcnZlciBzeW5jaW5nLCBhbiBvYnNlcnZlciBpcyBjYWxsaW5nIE9ic2VydmVyLnN5bmMoKSB0b28gbWFueSB0aW1lcycpO1xuICAgIH1cbiAgICBPYnNlcnZlci5yZXJ1biA9IGZhbHNlO1xuICAgIC8vIHRoZSBvYnNlcnZlciBhcnJheSBtYXkgaW5jcmVhc2Ugb3IgZGVjcmVhc2UgaW4gc2l6ZSAocmVtYWluaW5nIG9ic2VydmVycykgZHVyaW5nIHRoZSBzeW5jXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBPYnNlcnZlci5vYnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIE9ic2VydmVyLm9ic2VydmVyc1tpXS5zeW5jKCk7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKE9ic2VydmVyLmNhbGxiYWNrcy5sZW5ndGgpIHtcbiAgICBPYnNlcnZlci5jYWxsYmFja3Muc2hpZnQoKSgpO1xuICB9XG5cbiAgZm9yICh2YXIgaSA9IDAsIGwgPSBPYnNlcnZlci5saXN0ZW5lcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgdmFyIGxpc3RlbmVyID0gT2JzZXJ2ZXIubGlzdGVuZXJzW2ldO1xuICAgIGxpc3RlbmVyKCk7XG4gIH1cblxuICBPYnNlcnZlci5zeW5jaW5nID0gZmFsc2U7XG4gIE9ic2VydmVyLmN5Y2xlcyA9IDA7XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWZ0ZXIgdGhlIG5leHQgc3luYyAob3IgdGhlIGN1cnJlbnQgaWYgaW4gdGhlIG1pZGRsZSBvZiBvbmUpLCBydW4gdGhlIHByb3ZpZGVkIGNhbGxiYWNrXG5PYnNlcnZlci5hZnRlclN5bmMgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgT2JzZXJ2ZXIuY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xufTtcblxuT2JzZXJ2ZXIub25TeW5jID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIE9ic2VydmVyLmxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbn07XG5cbk9ic2VydmVyLnJlbW92ZU9uU3luYyA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICB2YXIgaW5kZXggPSBPYnNlcnZlci5saXN0ZW5lcnMuaW5kZXhPZihsaXN0ZW5lcik7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICBPYnNlcnZlci5saXN0ZW5lcnMuc3BsaWNlKGluZGV4LCAxKS5wb3AoKTtcbiAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcblxuLyoqXG4gKiAjIERlZmF1bHQgQmluZGVyc1xuICogUmVnaXN0ZXJzIGRlZmF1bHQgYmluZGVycyB3aXRoIGEgZnJhZ21lbnRzIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJEZWZhdWx0cyhmcmFnbWVudHMpIHtcblxuICAvKipcbiAgICogRmFkZSBpbiBhbmQgb3V0XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24oJ2ZhZGUnLCB7XG4gICAgb3B0aW9uczoge1xuICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgIH0sXG4gICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IG9wYWNpdHk6ICcwJyB9LFxuICAgICAgICB7IG9wYWNpdHk6ICcxJyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZG9uZTtcbiAgICB9LFxuICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgb3BhY2l0eTogJzEnIH0sXG4gICAgICAgIHsgb3BhY2l0eTogJzAnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBkb25lO1xuICAgIH1cbiAgfSk7XG5cbiAgdmFyIHNsaWRlcyA9IHtcbiAgICBzbGlkZTogJ2hlaWdodCcsXG4gICAgc2xpZGV2OiAnaGVpZ2h0JyxcbiAgICBzbGlkZWg6ICd3aWR0aCdcbiAgfTtcblxuICB2YXIgYW5pbWF0aW5nID0gbmV3IE1hcCgpO1xuXG4gIGZ1bmN0aW9uIG9iaihrZXksIHZhbHVlKSB7XG4gICAgdmFyIG9iaiA9IHt9O1xuICAgIG9ialtrZXldID0gdmFsdWU7XG4gICAgcmV0dXJuIG9iajtcbiAgfVxuXG4gIC8qKlxuICAgKiBTbGlkZSBkb3duIGFuZCB1cCwgbGVmdCBhbmQgcmlnaHRcbiAgICovXG4gIE9iamVjdC5rZXlzKHNsaWRlcykuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIHByb3BlcnR5ID0gc2xpZGVzW25hbWVdO1xuXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUsIHtcbiAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgICB9LFxuICAgICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JyksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSlcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9LFxuICAgICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH0pO1xuXG5cbiAgICAvKipcbiAgICAgKiBNb3ZlIGl0ZW1zIHVwIGFuZCBkb3duIGluIGEgbGlzdCwgc2xpZGUgZG93biBhbmQgdXBcbiAgICAgKi9cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSArICctbW92ZScsIHtcbiAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgICB9LFxuXG4gICAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpdGVtID0gZWxlbWVudC52aWV3ICYmIGVsZW1lbnQudmlldy5fcmVwZWF0SXRlbV87XG4gICAgICAgIGlmIChpdGVtKSB7XG4gICAgICAgICAgYW5pbWF0aW5nLnNldChpdGVtLCBlbGVtZW50KTtcbiAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgYW5pbWF0aW5nLmRlbGV0ZShpdGVtKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERvIHRoZSBzbGlkZVxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JyksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSlcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9LFxuXG4gICAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaXRlbSA9IGVsZW1lbnQudmlldyAmJiBlbGVtZW50LnZpZXcuX3JlcGVhdEl0ZW1fO1xuICAgICAgICBpZiAoaXRlbSkge1xuICAgICAgICAgIHZhciBuZXdFbGVtZW50ID0gYW5pbWF0aW5nLmdldChpdGVtKTtcbiAgICAgICAgICBpZiAobmV3RWxlbWVudCAmJiBuZXdFbGVtZW50LnBhcmVudE5vZGUgPT09IGVsZW1lbnQucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgLy8gVGhpcyBpdGVtIGlzIGJlaW5nIHJlbW92ZWQgaW4gb25lIHBsYWNlIGFuZCBhZGRlZCBpbnRvIGFub3RoZXIuIE1ha2UgaXQgbG9vayBsaWtlIGl0cyBtb3ZpbmcgYnkgbWFraW5nIGJvdGhcbiAgICAgICAgICAgIC8vIGVsZW1lbnRzIG5vdCB2aXNpYmxlIGFuZCBoYXZpbmcgYSBjbG9uZSBtb3ZlIGFib3ZlIHRoZSBpdGVtcyB0byB0aGUgbmV3IGxvY2F0aW9uLlxuICAgICAgICAgICAgZWxlbWVudCA9IHRoaXMuYW5pbWF0ZU1vdmUoZWxlbWVudCwgbmV3RWxlbWVudCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVNb3ZlOiBmdW5jdGlvbihvbGRFbGVtZW50LCBuZXdFbGVtZW50KSB7XG4gICAgICAgIHZhciBwbGFjZWhvbGRlckVsZW1lbnQ7XG4gICAgICAgIHZhciBwYXJlbnQgPSBuZXdFbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICAgIGlmICghcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCkge1xuICAgICAgICAgIHBhcmVudC5fX3NsaWRlTW92ZUhhbmRsZWQgPSB0cnVlO1xuICAgICAgICAgIGlmICh3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShwYXJlbnQpLnBvc2l0aW9uID09PSAnc3RhdGljJykge1xuICAgICAgICAgICAgcGFyZW50LnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3JpZ1N0eWxlID0gb2xkRWxlbWVudC5nZXRBdHRyaWJ1dGUoJ3N0eWxlJyk7XG4gICAgICAgIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKG9sZEVsZW1lbnQpO1xuICAgICAgICB2YXIgbWFyZ2luT2Zmc2V0TGVmdCA9IC1wYXJzZUludChzdHlsZS5tYXJnaW5MZWZ0KTtcbiAgICAgICAgdmFyIG1hcmdpbk9mZnNldFRvcCA9IC1wYXJzZUludChzdHlsZS5tYXJnaW5Ub3ApO1xuICAgICAgICB2YXIgb2xkTGVmdCA9IG9sZEVsZW1lbnQub2Zmc2V0TGVmdDtcbiAgICAgICAgdmFyIG9sZFRvcCA9IG9sZEVsZW1lbnQub2Zmc2V0VG9wO1xuXG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudCA9IGZyYWdtZW50cy5tYWtlRWxlbWVudEFuaW1hdGFibGUob2xkRWxlbWVudC5jbG9uZU5vZGUodHJ1ZSkpO1xuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQuc3R5bGUud2lkdGggPSBvbGRFbGVtZW50LnN0eWxlLndpZHRoID0gc3R5bGUud2lkdGg7XG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5zdHlsZS5oZWlnaHQgPSBvbGRFbGVtZW50LnN0eWxlLmhlaWdodCA9IHN0eWxlLmhlaWdodDtcbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnN0eWxlLm9wYWNpdHkgPSAnMCc7XG5cbiAgICAgICAgb2xkRWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG9sZEVsZW1lbnQuc3R5bGUuekluZGV4ID0gMTAwMDtcbiAgICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShwbGFjZWhvbGRlckVsZW1lbnQsIG9sZEVsZW1lbnQpO1xuICAgICAgICBuZXdFbGVtZW50LnN0eWxlLm9wYWNpdHkgPSAnMCc7XG5cbiAgICAgICAgb2xkRWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICB7IHRvcDogb2xkVG9wICsgbWFyZ2luT2Zmc2V0VG9wICsgJ3B4JywgbGVmdDogb2xkTGVmdCArIG1hcmdpbk9mZnNldExlZnQgKyAncHgnIH0sXG4gICAgICAgICAgeyB0b3A6IG5ld0VsZW1lbnQub2Zmc2V0VG9wICsgbWFyZ2luT2Zmc2V0VG9wICsgJ3B4JywgbGVmdDogbmV3RWxlbWVudC5vZmZzZXRMZWZ0ICsgbWFyZ2luT2Zmc2V0TGVmdCArICdweCcgfVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICAgIG9yaWdTdHlsZSA/IG9sZEVsZW1lbnQuc2V0QXR0cmlidXRlKCdzdHlsZScsIG9yaWdTdHlsZSkgOiBvbGRFbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgICAgICBuZXdFbGVtZW50LnN0eWxlLm9wYWNpdHkgPSAnJztcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gcGxhY2Vob2xkZXJFbGVtZW50O1xuICAgICAgfVxuICAgIH0pO1xuXG4gIH0pO1xuXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdGVyRGVmYXVsdHM7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4uL29ic2VydmVyL2RpZmYnKTtcblxuLyoqXG4gKiAjIERlZmF1bHQgQmluZGVyc1xuICogUmVnaXN0ZXJzIGRlZmF1bHQgYmluZGVycyB3aXRoIGEgZnJhZ21lbnRzIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJEZWZhdWx0cyhmcmFnbWVudHMpIHtcblxuICAvKipcbiAgICogUHJpbnRzIG91dCB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gdG8gdGhlIGNvbnNvbGUuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2RlYnVnJywge1xuICAgIHByaW9yaXR5OiA2MCxcbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgY29uc29sZS5pbmZvKCdEZWJ1ZzonLCB0aGlzLmV4cHJlc3Npb24sICc9JywgdmFsdWUpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgdGV4dFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGRpc3BsYXkgZXNjYXBlZCB0ZXh0IGluc2lkZSBhbiBlbGVtZW50LiBUaGlzIGNhbiBiZSBkb25lIHdpdGggYmluZGluZyBkaXJlY3RseSBpbiB0ZXh0IG5vZGVzIGJ1dFxuICAgKiB1c2luZyB0aGUgYXR0cmlidXRlIGJpbmRlciBwcmV2ZW50cyBhIGZsYXNoIG9mIHVuc3R5bGVkIGNvbnRlbnQgb24gdGhlIG1haW4gcGFnZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxIHRleHQ9XCJ7e3Bvc3QudGl0bGV9fVwiPlVudGl0bGVkPC9oMT5cbiAgICogPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqIDxkaXY+XG4gICAqICAgPHA+TGl0dGxlIFJlZCBSaWRpbmcgSG9vZCBpcyBhIHN0b3J5IGFib3V0IGEgbGl0dGxlIGdpcmwuPC9wPlxuICAgKiAgIDxwPlxuICAgKiAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGl0dGxlX1JlZF9SaWRpbmdfSG9vZFwiPldpa2lwZWRpYTwvYT5cbiAgICogICA8L3A+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndGV4dCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gKHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgaHRtbFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGRpc3BsYXkgdW5lc2NhcGVkIEhUTUwgaW5zaWRlIGFuIGVsZW1lbnQuIEJlIHN1cmUgaXQncyB0cnVzdGVkISBUaGlzIHNob3VsZCBiZSB1c2VkIHdpdGggZmlsdGVyc1xuICAgKiB3aGljaCBjcmVhdGUgSFRNTCBmcm9tIHNvbWV0aGluZyBzYWZlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+e3twb3N0LnRpdGxlfX08L2gxPlxuICAgKiA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5MaXR0bGUgUmVkPC9oMT5cbiAgICogPGRpdj5cbiAgICogICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgPHA+XG4gICAqICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgIDwvcD5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdodG1sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB0aGlzLmVsZW1lbnQuaW5uZXJIVE1MID0gKHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlKTtcbiAgfSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyBjbGFzcy1bY2xhc3NOYW1lXVxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGFkZCBjbGFzc2VzIHRvIGFuIGVsZW1lbnQgZGVwZW5kZW50IG9uIHdoZXRoZXIgdGhlIGV4cHJlc3Npb24gaXMgdHJ1ZSBvciBmYWxzZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cInVzZXItaXRlbVwiIGNsYXNzLXNlbGVjdGVkLXVzZXI9XCJ7e3NlbGVjdGVkID09PSB1c2VyfX1cIj5cbiAgICogICA8YnV0dG9uIGNsYXNzPVwiYnRuIHByaW1hcnlcIiBjbGFzcy1oaWdobGlnaHQ9XCJ7e3JlYWR5fX1cIj48L2J1dHRvbj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGBzZWxlY3RlZGAgZXF1YWxzIHRoZSBgdXNlcmAgYW5kIGByZWFkeWAgaXMgYHRydWVgOipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwidXNlci1pdGVtIHNlbGVjdGVkLXVzZXJcIj5cbiAgICogICA8YnV0dG9uIGNsYXNzPVwiYnRuIHByaW1hcnkgaGlnaGxpZ2h0XCI+PC9idXR0b24+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnY2xhc3MtKicsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuY2xhc3NMaXN0LmFkZCh0aGlzLm1hdGNoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LmNsYXNzTGlzdC5yZW1vdmUodGhpcy5tYXRjaCk7XG4gICAgfVxuICB9KTtcblxuXG5cbiAgLyoqXG4gICAqICMjIHZhbHVlXG4gICAqIEFkZHMgYSBiaW5kZXIgd2hpY2ggc2V0cyB0aGUgdmFsdWUgb2YgYW4gSFRNTCBmb3JtIGVsZW1lbnQuIFRoaXMgYmluZGVyIGFsc28gdXBkYXRlcyB0aGUgZGF0YSBhcyBpdCBpcyBjaGFuZ2VkIGluXG4gICAqIHRoZSBmb3JtIGVsZW1lbnQsIHByb3ZpZGluZyB0d28gd2F5IGJpbmRpbmcuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5GaXJzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwidXNlci5maXJzdE5hbWVcIj5cbiAgICpcbiAgICogPGxhYmVsPkxhc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJsYXN0TmFtZVwiIHZhbHVlPVwidXNlci5sYXN0TmFtZVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPkZpcnN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKlxuICAgKiA8bGFiZWw+TGFzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImxhc3ROYW1lXCIgdmFsdWU9XCJXcmlnaHRcIj5cbiAgICogYGBgXG4gICAqIEFuZCB3aGVuIHRoZSB1c2VyIGNoYW5nZXMgdGhlIHRleHQgaW4gdGhlIGZpcnN0IGlucHV0IHRvIFwiSmFjXCIsIGB1c2VyLmZpcnN0TmFtZWAgd2lsbCBiZSB1cGRhdGVkIGltbWVkaWF0ZWx5IHdpdGhcbiAgICogdGhlIHZhbHVlIG9mIGAnSmFjJ2AuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3ZhbHVlJywge1xuICAgIG9ubHlXaGVuQm91bmQ6IHRydWUsXG4gICAgZXZlbnRzQXR0ck5hbWU6ICd2YWx1ZS1ldmVudHMnLFxuICAgIGZpZWxkQXR0ck5hbWU6ICd2YWx1ZS1maWVsZCcsXG4gICAgZGVmYXVsdEV2ZW50czogWyAnY2hhbmdlJyBdLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG5hbWUgPSB0aGlzLmVsZW1lbnQudGFnTmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgdmFyIHR5cGUgPSB0aGlzLmVsZW1lbnQudHlwZTtcbiAgICAgIHRoaXMubWV0aG9kcyA9IGlucHV0TWV0aG9kc1t0eXBlXSB8fCBpbnB1dE1ldGhvZHNbbmFtZV07XG5cbiAgICAgIGlmICghdGhpcy5tZXRob2RzKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuZWxlbWVudC5oYXNBdHRyaWJ1dGUodGhpcy5ldmVudHNBdHRyTmFtZSkpIHtcbiAgICAgICAgdGhpcy5ldmVudHMgPSB0aGlzLmVsZW1lbnQuZ2V0QXR0cmlidXRlKHRoaXMuZXZlbnRzQXR0ck5hbWUpLnNwbGl0KCcgJyk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5ldmVudHNBdHRyTmFtZSk7XG4gICAgICB9IGVsc2UgaWYgKG5hbWUgIT09ICdvcHRpb24nKSB7XG4gICAgICAgIHRoaXMuZXZlbnRzID0gdGhpcy5kZWZhdWx0RXZlbnRzO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5lbGVtZW50Lmhhc0F0dHJpYnV0ZSh0aGlzLmZpZWxkQXR0ck5hbWUpKSB7XG4gICAgICAgIHRoaXMudmFsdWVGaWVsZCA9IHRoaXMuZWxlbWVudC5nZXRBdHRyaWJ1dGUodGhpcy5maWVsZEF0dHJOYW1lKTtcbiAgICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmZpZWxkQXR0ck5hbWUpO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZSA9PT0gJ29wdGlvbicpIHtcbiAgICAgICAgdGhpcy52YWx1ZUZpZWxkID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGUudmFsdWVGaWVsZDtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzKSByZXR1cm47IC8vIG5vdGhpbmcgZm9yIDxvcHRpb24+IGhlcmVcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgdmFyIG9ic2VydmVyID0gdGhpcy5vYnNlcnZlcjtcbiAgICAgIHZhciBpbnB1dCA9IHRoaXMubWV0aG9kcztcbiAgICAgIHZhciB2YWx1ZUZpZWxkID0gdGhpcy52YWx1ZUZpZWxkO1xuXG4gICAgICAvLyBUaGUgMi13YXkgYmluZGluZyBwYXJ0IGlzIHNldHRpbmcgdmFsdWVzIG9uIGNlcnRhaW4gZXZlbnRzXG4gICAgICBmdW5jdGlvbiBvbkNoYW5nZSgpIHtcbiAgICAgICAgaWYgKGlucHV0LmdldC5jYWxsKGVsZW1lbnQsIHZhbHVlRmllbGQpICE9PSBvYnNlcnZlci5vbGRWYWx1ZSAmJiAhZWxlbWVudC5yZWFkT25seSkge1xuICAgICAgICAgIG9ic2VydmVyLnNldChpbnB1dC5nZXQuY2FsbChlbGVtZW50LCB2YWx1ZUZpZWxkKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnKSB7XG4gICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgPT09IDEzKSBvbkNoYW5nZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5ldmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudCkge1xuICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIG9uQ2hhbmdlKTtcbiAgICAgIH0pO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHRoaXMubWV0aG9kcy5nZXQuY2FsbCh0aGlzLmVsZW1lbnQsIHRoaXMudmFsdWVGaWVsZCkgIT0gdmFsdWUpIHtcbiAgICAgICAgdGhpcy5tZXRob2RzLnNldC5jYWxsKHRoaXMuZWxlbWVudCwgdmFsdWUsIHRoaXMudmFsdWVGaWVsZCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogSGFuZGxlIHRoZSBkaWZmZXJlbnQgZm9ybSB0eXBlc1xuICAgKi9cbiAgdmFyIGRlZmF1bHRJbnB1dE1ldGhvZCA9IHtcbiAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy52YWx1ZTsgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7IHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlOyB9XG4gIH07XG5cbiAgdmFyIGlucHV0TWV0aG9kcyA9IHtcbiAgICBjaGVja2JveDoge1xuICAgICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuY2hlY2tlZDsgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHsgdGhpcy5jaGVja2VkID0gISF2YWx1ZTsgfVxuICAgIH0sXG5cbiAgICBmaWxlOiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5maWxlcyAmJiB0aGlzLmZpbGVzWzBdOyB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge31cbiAgICB9LFxuXG4gICAgc2VsZWN0OiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlRmllbGQpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vcHRpb25zW3RoaXMuc2VsZWN0ZWRJbmRleF0udmFsdWVPYmplY3Q7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMudmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlLCB2YWx1ZUZpZWxkKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZUZpZWxkKSB7XG4gICAgICAgICAgdGhpcy52YWx1ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZVt2YWx1ZUZpZWxkXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gKHZhbHVlID09IG51bGwpID8gJycgOiB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBvcHRpb246IHtcbiAgICAgIGdldDogZnVuY3Rpb24odmFsdWVGaWVsZCkge1xuICAgICAgICByZXR1cm4gdmFsdWVGaWVsZCA/IHRoaXMudmFsdWVPYmplY3RbdmFsdWVGaWVsZF0gOiB0aGlzLnZhbHVlO1xuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUsIHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHZhbHVlRmllbGQpIHtcbiAgICAgICAgICB0aGlzLnZhbHVlT2JqZWN0ID0gdmFsdWU7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlW3ZhbHVlRmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIGlucHV0OiBkZWZhdWx0SW5wdXRNZXRob2QsXG5cbiAgICB0ZXh0YXJlYTogZGVmYXVsdElucHV0TWV0aG9kXG4gIH07XG5cblxuICAvKipcbiAgICogIyMgb24tW2V2ZW50XVxuICAgKiBBZGRzIGEgYmluZGVyIGZvciBlYWNoIGV2ZW50IG5hbWUgaW4gdGhlIGFycmF5LiBXaGVuIHRoZSBldmVudCBpcyB0cmlnZ2VyZWQgdGhlIGV4cHJlc3Npb24gd2lsbCBiZSBydW4uXG4gICAqXG4gICAqICoqRXhhbXBsZSBFdmVudHM6KipcbiAgICpcbiAgICogKiBvbi1jbGlja1xuICAgKiAqIG9uLWRibGNsaWNrXG4gICAqICogb24tc3VibWl0XG4gICAqICogb24tY2hhbmdlXG4gICAqICogb24tZm9jdXNcbiAgICogKiBvbi1ibHVyXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxmb3JtIG9uLXN1Ym1pdD1cInt7c2F2ZVVzZXIoKX19XCI+XG4gICAqICAgPGlucHV0IG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqICAgPGJ1dHRvbj5TYXZlPC9idXR0b24+XG4gICAqIDwvZm9ybT5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgKGV2ZW50cyBkb24ndCBhZmZlY3QgdGhlIEhUTUwpOipcbiAgICogYGBgaHRtbFxuICAgKiA8Zm9ybT5cbiAgICogICA8aW5wdXQgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICogICA8YnV0dG9uPlNhdmU8L2J1dHRvbj5cbiAgICogPC9mb3JtPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnb24tKicsIHtcbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBldmVudE5hbWUgPSB0aGlzLm1hdGNoO1xuICAgICAgdmFyIF90aGlzID0gdGhpcztcbiAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgaWYgKCF0aGlzLmhhc0F0dHJpYnV0ZSgnZGlzYWJsZWQnKSAmJiBfdGhpcy5jb250ZXh0KSB7XG4gICAgICAgICAgLy8gU2V0IHRoZSBldmVudCBvbiB0aGUgY29udGV4dCBzbyBpdCBtYXkgYmUgdXNlZCBpbiB0aGUgZXhwcmVzc2lvbiB3aGVuIHRoZSBldmVudCBpcyB0cmlnZ2VyZWQuXG4gICAgICAgICAgdmFyIHByaW9yRXZlbnQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKF90aGlzLmNvbnRleHQsICdldmVudCcpO1xuICAgICAgICAgIHZhciBwcmlvckVsZW1lbnQgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKF90aGlzLmNvbnRleHQsICdlbGVtZW50Jyk7XG4gICAgICAgICAgX3RoaXMuY29udGV4dC5ldmVudCA9IGV2ZW50O1xuICAgICAgICAgIF90aGlzLmNvbnRleHQuZWxlbWVudCA9IF90aGlzLmVsZW1lbnQ7XG5cbiAgICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBfdGhpcy5vYnNlcnZlci5nZXQoKTtcblxuICAgICAgICAgIC8vIE9yIGp1c3QgcmV0dXJuIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCBiZSBjYWxsZWQgd2l0aCB0aGUgZXZlbnQgb2JqZWN0XG4gICAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG5cbiAgICAgICAgICAvLyBSZXNldCB0aGUgY29udGV4dCB0byBpdHMgcHJpb3Igc3RhdGVcbiAgICAgICAgICBpZiAocHJpb3JFdmVudCkge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KF90aGlzLmNvbnRleHQsICdldmVudCcsIHByaW9yRXZlbnQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZWxldGUgX3RoaXMuY29udGV4dC5ldmVudDtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAocHJpb3JFbGVtZW50KSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoX3RoaXMuY29udGV4dCwgJ2VsZW1lbnQnLCBwcmlvckVsZW1lbnQpO1xuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICBkZWxldGUgX3RoaXMuY29udGV4dC5lbGVtZW50O1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBvbi1ba2V5IGV2ZW50XVxuICAgKiBBZGRzIGEgYmluZGVyIHdoaWNoIGlzIHRyaWdnZXJlZCB3aGVuIHRoZSBrZXlkb3duIGV2ZW50J3MgYGtleUNvZGVgIHByb3BlcnR5IG1hdGNoZXMuIElmIHRoZSBuYW1lIGluY2x1ZGVzIGN0cmxcbiAgICogdGhlbiBpdCB3aWxsIG9ubHkgZmlyZSB3aGVuIHRoZSBrZXkgcGx1cyB0aGUgY3RybEtleSBvciBtZXRhS2V5IGlzIHByZXNzZWQuXG4gICAqXG4gICAqICoqS2V5IEV2ZW50czoqKlxuICAgKlxuICAgKiAqIG9uLWVudGVyXG4gICAqICogb24tY3RybC1lbnRlclxuICAgKiAqIG9uLWVzY1xuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aW5wdXQgb24tZW50ZXI9XCJ7e3NhdmUoKX19XCIgb24tZXNjPVwie3tjYW5jZWwoKX19XCI+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aW5wdXQ+XG4gICAqIGBgYFxuICAgKi9cbiAgdmFyIGtleUNvZGVzID0geyBlbnRlcjogMTMsIGVzYzogMjcsICdjdHJsLWVudGVyJzogMTMgfTtcblxuICBPYmplY3Qua2V5cyhrZXlDb2RlcykuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGtleUNvZGUgPSBrZXlDb2Rlc1tuYW1lXTtcblxuICAgIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnb24tJyArIG5hbWUsIHtcbiAgICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICB2YXIgdXNlQ3RybEtleSA9IG5hbWUuaW5kZXhPZignY3RybC0nKSA9PT0gMDtcbiAgICAgICAgdmFyIF90aGlzID0gdGhpcztcbiAgICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgIGlmICh1c2VDdHJsS2V5ICYmICEoZXZlbnQuY3RybEtleSB8fCBldmVudC5tZXRhS2V5KSB8fCAhX3RoaXMuY29udGV4dCkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChldmVudC5rZXlDb2RlICE9PSBrZXlDb2RlKSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcblxuICAgICAgICAgIGlmICghdGhpcy5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJykpIHtcbiAgICAgICAgICAgIC8vIFNldCB0aGUgZXZlbnQgb24gdGhlIGNvbnRleHQgc28gaXQgbWF5IGJlIHVzZWQgaW4gdGhlIGV4cHJlc3Npb24gd2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkLlxuICAgICAgICAgICAgdmFyIHByaW9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihfdGhpcy5jb250ZXh0LCAnZXZlbnQnKTtcbiAgICAgICAgICAgIF90aGlzLmNvbnRleHQuZXZlbnQgPSBldmVudDtcblxuICAgICAgICAgICAgLy8gTGV0IGFuIG9uLVtldmVudF0gbWFrZSB0aGUgZnVuY3Rpb24gY2FsbCB3aXRoIGl0cyBvd24gYXJndW1lbnRzXG4gICAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBfdGhpcy5vYnNlcnZlci5nZXQoKTtcblxuICAgICAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIGxpc3RlbmVyLmNhbGwoX3RoaXMuY29udGV4dCwgZXZlbnQpO1xuXG4gICAgICAgICAgICAvLyBSZXNldCB0aGUgY29udGV4dCB0byBpdHMgcHJpb3Igc3RhdGVcbiAgICAgICAgICAgIGlmIChwcmlvcikge1xuICAgICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoX3RoaXMuY29udGV4dCwgZXZlbnQsIHByaW9yKTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgIGRlbGV0ZSBfdGhpcy5jb250ZXh0LmV2ZW50O1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSlcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgW2F0dHJpYnV0ZV0kXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gc2V0IHRoZSBhdHRyaWJ1dGUgb2YgZWxlbWVudCB0byB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24uIFVzZSB0aGlzIHdoZW4geW91IGRvbid0IHdhbnQgYW5cbiAgICogYDxpbWc+YCB0byB0cnkgYW5kIGxvYWQgaXRzIGBzcmNgIGJlZm9yZSBiZWluZyBldmFsdWF0ZWQuIFRoaXMgaXMgb25seSBuZWVkZWQgb24gdGhlIGluZGV4Lmh0bWwgcGFnZSBhcyB0ZW1wbGF0ZVxuICAgKiB3aWxsIGJlIHByb2Nlc3NlZCBiZWZvcmUgYmVpbmcgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBHZW5lcmFsbHkgeW91IGNhbiBqdXN0IHVzZSBgYXR0cj1cInt7ZXhwcn19XCJgLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgQXR0cmlidXRlczoqKlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aW1nIHNyYyQ9XCJ7e3VzZXIuYXZhdGFyVXJsfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjPVwiaHR0cDovL2Nkbi5leGFtcGxlLmNvbS9hdmF0YXJzL2phY3dyaWdodC1zbWFsbC5wbmdcIj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJyokJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgYXR0ck5hbWUgPSB0aGlzLm1hdGNoO1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKGF0dHJOYW1lLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXT9cbiAgICogQWRkcyBhIGJpbmRlciB0byB0b2dnbGUgYW4gYXR0cmlidXRlIG9uIG9yIG9mZiBpZiB0aGUgZXhwcmVzc2lvbiBpcyB0cnV0aHkgb3IgZmFsc2V5LiBVc2UgZm9yIGF0dHJpYnV0ZXMgd2l0aG91dFxuICAgKiB2YWx1ZXMgc3VjaCBhcyBgc2VsZWN0ZWRgLCBgZGlzYWJsZWRgLCBvciBgcmVhZG9ubHlgLiBgY2hlY2tlZD9gIHdpbGwgdXNlIDItd2F5IGRhdGFiaW5kaW5nLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+SXMgQWRtaW5pc3RyYXRvcjwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjaGVja2VkPz1cInt7dXNlci5pc0FkbWlufX1cIj5cbiAgICogPGJ1dHRvbiBkaXNhYmxlZD89XCJ7e2lzUHJvY2Vzc2luZ319XCI+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGBpc1Byb2Nlc3NpbmdgIGlzIGB0cnVlYCBhbmQgYHVzZXIuaXNBZG1pbmAgaXMgZmFsc2U6KlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPlN1Ym1pdDwvYnV0dG9uPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKj8nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsICcnKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIEFkZCBhIGNsb25lIG9mIHRoZSBgdmFsdWVgIGJpbmRlciBmb3IgYGNoZWNrZWQ/YCBzbyBjaGVja2JveGVzIGNhbiBoYXZlIHR3by13YXkgYmluZGluZyB1c2luZyBgY2hlY2tlZD9gLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjaGVja2VkPycsIGZyYWdtZW50cy5nZXRBdHRyaWJ1dGVCaW5kZXIoJ3ZhbHVlJykpO1xuXG5cblxuICAvKipcbiAgICogIyMgaWYsIHVubGVzcywgZWxzZS1pZiwgZWxzZS11bmxlc3MsIGVsc2VcbiAgICogQWRkcyBhIGJpbmRlciB0byBzaG93IG9yIGhpZGUgdGhlIGVsZW1lbnQgaWYgdGhlIHZhbHVlIGlzIHRydXRoeSBvciBmYWxzZXkuIEFjdHVhbGx5IHJlbW92ZXMgdGhlIGVsZW1lbnQgZnJvbSB0aGVcbiAgICogRE9NIHdoZW4gaGlkZGVuLCByZXBsYWNpbmcgaXQgd2l0aCBhIG5vbi12aXNpYmxlIHBsYWNlaG9sZGVyIGFuZCBub3QgbmVlZGxlc3NseSBleGVjdXRpbmcgYmluZGluZ3MgaW5zaWRlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGkgaWY9XCJ1c2VyXCI+PGEgaHJlZj1cIi9hY2NvdW50XCI+TXkgQWNjb3VudDwvYT48L2xpPlxuICAgKiAgIDxsaSB1bmxlc3M9XCJ1c2VyXCI+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogICA8bGkgZWxzZT48YSBocmVmPVwiL2xvZ291dFwiPlNpZ24gT3V0PC9hPjwvbGk+XG4gICAqIDwvdWw+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGB1c2VyYCBpcyBudWxsOipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGk+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIgSWZCaW5kaW5nID0gZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdpZicsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogNTAsXG4gICAgdW5sZXNzQXR0ck5hbWU6ICd1bmxlc3MnLFxuICAgIGVsc2VJZkF0dHJOYW1lOiAnZWxzZS1pZicsXG4gICAgZWxzZVVubGVzc0F0dHJOYW1lOiAnZWxzZS11bmxlc3MnLFxuICAgIGVsc2VBdHRyTmFtZTogJ2Vsc2UnLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgICB2YXIgZXhwcmVzc2lvbnMgPSBbIHdyYXBJZkV4cCh0aGlzLmV4cHJlc3Npb24sIHRoaXMubmFtZSA9PT0gdGhpcy51bmxlc3NBdHRyTmFtZSkgXTtcbiAgICAgIHZhciBwbGFjZWhvbGRlciA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgIHZhciBub2RlID0gZWxlbWVudC5uZXh0RWxlbWVudFNpYmxpbmc7XG4gICAgICB0aGlzLmVsZW1lbnQgPSBwbGFjZWhvbGRlcjtcbiAgICAgIGVsZW1lbnQucGFyZW50Tm9kZS5yZXBsYWNlQ2hpbGQocGxhY2Vob2xkZXIsIGVsZW1lbnQpO1xuXG4gICAgICAvLyBTdG9yZXMgYSB0ZW1wbGF0ZSBmb3IgYWxsIHRoZSBlbGVtZW50cyB0aGF0IGNhbiBnbyBpbnRvIHRoaXMgc3BvdFxuICAgICAgdGhpcy50ZW1wbGF0ZXMgPSBbIGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZShlbGVtZW50KSBdO1xuXG4gICAgICAvLyBQdWxsIG91dCBhbnkgb3RoZXIgZWxlbWVudHMgdGhhdCBhcmUgY2hhaW5lZCB3aXRoIHRoaXMgb25lXG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICB2YXIgbmV4dCA9IG5vZGUubmV4dEVsZW1lbnRTaWJsaW5nO1xuICAgICAgICB2YXIgZXhwcmVzc2lvbjtcbiAgICAgICAgaWYgKG5vZGUuaGFzQXR0cmlidXRlKHRoaXMuZWxzZUlmQXR0ck5hbWUpKSB7XG4gICAgICAgICAgZXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBub2RlLmdldEF0dHJpYnV0ZSh0aGlzLmVsc2VJZkF0dHJOYW1lKSk7XG4gICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh3cmFwSWZFeHAoZXhwcmVzc2lvbiwgZmFsc2UpKTtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmVsc2VJZkF0dHJOYW1lKTtcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmhhc0F0dHJpYnV0ZSh0aGlzLmVsc2VVbmxlc3NBdHRyTmFtZSkpIHtcbiAgICAgICAgICBleHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIG5vZGUuZ2V0QXR0cmlidXRlKHRoaXMuZWxzZVVubGVzc0F0dHJOYW1lKSk7XG4gICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh3cmFwSWZFeHAoZXhwcmVzc2lvbiwgdHJ1ZSkpO1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKHRoaXMuZWxzZVVubGVzc0F0dHJOYW1lKTtcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmhhc0F0dHJpYnV0ZSh0aGlzLmVsc2VBdHRyTmFtZSkpIHtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmVsc2VBdHRyTmFtZSk7XG4gICAgICAgICAgbmV4dCA9IG51bGw7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLnJlbW92ZSgpO1xuICAgICAgICB0aGlzLnRlbXBsYXRlcy5wdXNoKGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZShub2RlKSk7XG4gICAgICAgIG5vZGUgPSBuZXh0O1xuICAgICAgfVxuXG4gICAgICAvLyBBbiBleHByZXNzaW9uIHRoYXQgd2lsbCByZXR1cm4gYW4gaW5kZXguIFNvbWV0aGluZyBsaWtlIHRoaXMgYGV4cHIgPyAwIDogZXhwcjIgPyAxIDogZXhwcjMgPyAyIDogM2AuIFRoaXMgd2lsbFxuICAgICAgLy8gYmUgdXNlZCB0byBrbm93IHdoaWNoIHNlY3Rpb24gdG8gc2hvdyBpbiB0aGUgaWYvZWxzZS1pZi9lbHNlIGdyb3VwaW5nLlxuICAgICAgdGhpcy5leHByZXNzaW9uID0gZXhwcmVzc2lvbnMubWFwKGZ1bmN0aW9uKGV4cHIsIGluZGV4KSB7XG4gICAgICAgIHJldHVybiBleHByICsgJyA/ICcgKyBpbmRleCArICcgOiAnO1xuICAgICAgfSkuam9pbignJykgKyBleHByZXNzaW9ucy5sZW5ndGg7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICAvLyBGb3IgcGVyZm9ybWFuY2UgcHJvdmlkZSBhbiBhbHRlcm5hdGUgY29kZSBwYXRoIGZvciBhbmltYXRpb25cbiAgICAgIGlmICh0aGlzLmFuaW1hdGUpIHtcbiAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQoaW5kZXgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy51cGRhdGVkUmVndWxhcihpbmRleCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFkZDogZnVuY3Rpb24odmlldykge1xuICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHZpZXcsIHRoaXMuZWxlbWVudC5uZXh0U2libGluZyk7XG4gICAgfSxcblxuICAgIHJlbW92ZTogZnVuY3Rpb24odmlldykge1xuICAgICAgdmlldy5kaXNwb3NlKCk7XG4gICAgfSxcblxuICAgIHVwZGF0ZWRSZWd1bGFyOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnJlbW92ZSh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgfVxuICAgICAgdmFyIHRlbXBsYXRlID0gdGhpcy50ZW1wbGF0ZXNbaW5kZXhdO1xuICAgICAgaWYgKHRlbXBsYXRlKSB7XG4gICAgICAgIHRoaXMuc2hvd2luZyA9IHRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgICAgdGhpcy5zaG93aW5nLmJpbmQodGhpcy5jb250ZXh0KTtcbiAgICAgICAgdGhpcy5hZGQodGhpcy5zaG93aW5nKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlZEFuaW1hdGVkOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgdGhpcy5sYXN0VmFsdWUgPSBpbmRleDtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLmFuaW1hdGVPdXQodGhpcy5zaG93aW5nLCB0cnVlLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuXG4gICAgICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICAgICAgLy8gTWFrZSBzdXJlIHRoaXMgd2Fzbid0IHVuYm91bmQgd2hpbGUgd2Ugd2VyZSBhbmltYXRpbmdcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlKHRoaXMuc2hvd2luZyk7XG4gICAgICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAgIC8vIGZpbmlzaCBieSBhbmltYXRpbmcgdGhlIG5ldyBlbGVtZW50IGluIChpZiBhbnkpLCB1bmxlc3Mgbm8gbG9uZ2VyIGJvdW5kXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLnRlbXBsYXRlc1tpbmRleF07XG4gICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gdGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgICB0aGlzLnNob3dpbmcuYmluZCh0aGlzLmNvbnRleHQpO1xuICAgICAgICB0aGlzLmFkZCh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuYW5pbWF0ZUluKHRoaXMuc2hvd2luZywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgY2hhbmdlZCB3aGlsZSB0aGlzIHdhcyBhbmltYXRpbmcgcnVuIGl0IGFnYWluXG4gICAgICAgICAgaWYgKHRoaXMubGFzdFZhbHVlICE9PSBpbmRleCkge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQ2xlYW4gdXBcbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nLmRpc3Bvc2UoKTtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gbnVsbDtcbiAgICAgICAgdGhpcy5sYXN0VmFsdWUgPSBudWxsO1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd1bmxlc3MnLCBJZkJpbmRpbmcpO1xuXG4gIGZ1bmN0aW9uIHdyYXBJZkV4cChleHByLCBpc1VubGVzcykge1xuICAgIHJldHVybiAoaXNVbmxlc3MgPyAnIScgOiAnJykgKyBleHByO1xuICB9XG5cblxuICAvKipcbiAgICogIyMgcmVwZWF0XG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZHVwbGljYXRlIGFuIGVsZW1lbnQgZm9yIGVhY2ggaXRlbSBpbiBhbiBhcnJheS4gVGhlIGV4cHJlc3Npb24gbWF5IGJlIG9mIHRoZSBmb3JtYXQgYGVweHJgIG9yXG4gICAqIGBpdGVtTmFtZSBpbiBleHByYCB3aGVyZSBgaXRlbU5hbWVgIGlzIHRoZSBuYW1lIGVhY2ggaXRlbSBpbnNpZGUgdGhlIGFycmF5IHdpbGwgYmUgcmVmZXJlbmNlZCBieSB3aXRoaW4gYmluZGluZ3NcbiAgICogaW5zaWRlIHRoZSBlbGVtZW50LlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGVhY2g9XCJ7e3Bvc3QgaW4gcG9zdHN9fVwiIGNsYXNzLWZlYXR1cmVkPVwie3twb3N0LmlzRmVhdHVyZWR9fVwiPlxuICAgKiAgIDxoMT57e3Bvc3QudGl0bGV9fTwvaDE+XG4gICAqICAgPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiB0aGVyZSBhcmUgMiBwb3N0cyBhbmQgdGhlIGZpcnN0IG9uZSBpcyBmZWF0dXJlZDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cImZlYXR1cmVkXCI+XG4gICAqICAgPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiAgIDxkaXY+XG4gICAqICAgICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgICAgPC9wPlxuICAgKiAgIDwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogPGRpdj5cbiAgICogICA8aDE+QmlnIEJsdWU8L2gxPlxuICAgKiAgIDxkaXY+XG4gICAqICAgICA8cD5Tb21lIHRob3VnaHRzIG9uIHRoZSBOZXcgWW9yayBHaWFudHMuPC9wPlxuICAgKiAgICAgPHA+XG4gICAqICAgICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTmV3X1lvcmtfR2lhbnRzXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgICAgPC9wPlxuICAgKiAgIDwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3JlcGVhdCcsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogMTAwLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBhcmVudCA9IHRoaXMuZWxlbWVudC5wYXJlbnROb2RlO1xuICAgICAgdmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShwbGFjZWhvbGRlciwgdGhpcy5lbGVtZW50KTtcbiAgICAgIHRoaXMudGVtcGxhdGUgPSBmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUodGhpcy5lbGVtZW50KTtcbiAgICAgIHRoaXMuZWxlbWVudCA9IHBsYWNlaG9sZGVyO1xuXG4gICAgICB2YXIgcGFydHMgPSB0aGlzLmV4cHJlc3Npb24uc3BsaXQoL1xccytpblxccysvKTtcbiAgICAgIHRoaXMuZXhwcmVzc2lvbiA9IHBhcnRzLnBvcCgpO1xuICAgICAgdmFyIGtleSA9IHBhcnRzLnBvcCgpO1xuICAgICAgaWYgKGtleSkge1xuICAgICAgICBwYXJ0cyA9IGtleS5zcGxpdCgvXFxzKixcXHMqLyk7XG4gICAgICAgIHRoaXMudmFsdWVOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICAgIHRoaXMua2V5TmFtZSA9IHBhcnRzLnBvcCgpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMudmlld3MgPSBbXTtcbiAgICAgIHRoaXMub2JzZXJ2ZXIuZ2V0Q2hhbmdlUmVjb3JkcyA9IHRydWU7XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMudmlld3MubGVuZ3RoKSB7XG4gICAgICAgIHRoaXMudmlld3MuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuICAgICAgICB0aGlzLnZpZXdzLmxlbmd0aCA9IDA7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IG51bGw7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHJlbW92ZVZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgICAgdmlldy5fcmVwZWF0SXRlbV8gPSBudWxsO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSwgb2xkVmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIGlmICghY2hhbmdlcykge1xuICAgICAgICB0aGlzLnBvcHVsYXRlKHZhbHVlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICh0aGlzLmFuaW1hdGUpIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNoYW5nZXNBbmltYXRlZCh2YWx1ZSwgY2hhbmdlcyk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzKHZhbHVlLCBjaGFuZ2VzKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICAvLyBNZXRob2QgZm9yIGNyZWF0aW5nIGFuZCBzZXR0aW5nIHVwIG5ldyB2aWV3cyBmb3Igb3VyIGxpc3RcbiAgICBjcmVhdGVWaWV3OiBmdW5jdGlvbihrZXksIHZhbHVlKSB7XG4gICAgICB2YXIgdmlldyA9IHRoaXMudGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgdmFyIGNvbnRleHQgPSB2YWx1ZTtcbiAgICAgIGlmICh0aGlzLnZhbHVlTmFtZSkge1xuICAgICAgICBjb250ZXh0ID0gT2JqZWN0LmNyZWF0ZSh0aGlzLmNvbnRleHQpO1xuICAgICAgICBpZiAodGhpcy5rZXlOYW1lKSBjb250ZXh0W3RoaXMua2V5TmFtZV0gPSBrZXk7XG4gICAgICAgIGNvbnRleHRbdGhpcy52YWx1ZU5hbWVdID0gdmFsdWU7XG4gICAgICAgIGNvbnRleHQuX29yaWdDb250ZXh0XyA9IHRoaXMuY29udGV4dC5oYXNPd25Qcm9wZXJ0eSgnX29yaWdDb250ZXh0XycpXG4gICAgICAgICAgPyB0aGlzLmNvbnRleHQuX29yaWdDb250ZXh0X1xuICAgICAgICAgIDogdGhpcy5jb250ZXh0O1xuICAgICAgfVxuICAgICAgdmlldy5iaW5kKGNvbnRleHQpO1xuICAgICAgdmlldy5fcmVwZWF0SXRlbV8gPSB2YWx1ZTtcbiAgICAgIHJldHVybiB2aWV3O1xuICAgIH0sXG5cbiAgICBwb3B1bGF0ZTogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSB2YWx1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy52aWV3cy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy52aWV3cy5mb3JFYWNoKHRoaXMucmVtb3ZlVmlldyk7XG4gICAgICAgIHRoaXMudmlld3MubGVuZ3RoID0gMDtcbiAgICAgIH1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpICYmIHZhbHVlLmxlbmd0aCkge1xuICAgICAgICB2YXIgZnJhZyA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcblxuICAgICAgICB2YWx1ZS5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0sIGluZGV4KSB7XG4gICAgICAgICAgdmFyIHZpZXcgPSB0aGlzLmNyZWF0ZVZpZXcoaW5kZXgsIGl0ZW0pO1xuICAgICAgICAgIHRoaXMudmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnLmFwcGVuZENoaWxkKHZpZXcpO1xuICAgICAgICB9LCB0aGlzKTtcblxuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZywgdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogVGhpcyB1bi1hbmltYXRlZCB2ZXJzaW9uIHJlbW92ZXMgYWxsIHJlbW92ZWQgdmlld3MgZmlyc3Qgc28gdGhleSBjYW4gYmUgcmV0dXJuZWQgdG8gdGhlIHBvb2wgYW5kIHRoZW4gYWRkcyBuZXdcbiAgICAgKiB2aWV3cyBiYWNrIGluLiBUaGlzIGlzIHRoZSBtb3N0IG9wdGltYWwgbWV0aG9kIHdoZW4gbm90IGFuaW1hdGluZy5cbiAgICAgKi9cbiAgICB1cGRhdGVDaGFuZ2VzOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgLy8gUmVtb3ZlIGV2ZXJ5dGhpbmcgZmlyc3QsIHRoZW4gYWRkIGFnYWluLCBhbGxvd2luZyBmb3IgZWxlbWVudCByZXVzZSBmcm9tIHRoZSBwb29sXG4gICAgICB2YXIgYWRkZWRDb3VudCA9IDA7XG5cbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgYWRkZWRDb3VudCArPSBzcGxpY2UuYWRkZWRDb3VudDtcbiAgICAgICAgaWYgKCFzcGxpY2UucmVtb3ZlZC5sZW5ndGgpIHtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHJlbW92ZWQgPSB0aGlzLnZpZXdzLnNwbGljZShzcGxpY2UuaW5kZXggLSBhZGRlZENvdW50LCBzcGxpY2UucmVtb3ZlZC5sZW5ndGgpO1xuICAgICAgICByZW1vdmVkLmZvckVhY2godGhpcy5yZW1vdmVWaWV3KTtcbiAgICAgIH0sIHRoaXMpO1xuXG4gICAgICAvLyBBZGQgdGhlIG5ldy9tb3ZlZCB2aWV3c1xuICAgICAgY2hhbmdlcy5mb3JFYWNoKGZ1bmN0aW9uKHNwbGljZSkge1xuICAgICAgICBpZiAoIXNwbGljZS5hZGRlZENvdW50KSByZXR1cm47XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuICAgICAgICAgIHZpZXcgPSB0aGlzLmNyZWF0ZVZpZXcoaSwgaXRlbSk7XG4gICAgICAgICAgYWRkZWRWaWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHZpZXcpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudmlld3Muc3BsaWNlLmFwcGx5KHRoaXMudmlld3MsIFsgaW5kZXgsIDAgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5leHRTaWJsaW5nKTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBUaGlzIGFuaW1hdGVkIHZlcnNpb24gbXVzdCBhbmltYXRlIHJlbW92ZWQgbm9kZXMgb3V0IHdoaWxlIGFkZGVkIG5vZGVzIGFyZSBhbmltYXRpbmcgaW4gbWFraW5nIGl0IGxlc3Mgb3B0aW1hbFxuICAgICAqIChidXQgY29vbCBsb29raW5nKS4gSXQgYWxzbyBoYW5kbGVzIFwibW92ZVwiIGFuaW1hdGlvbnMgZm9yIG5vZGVzIHdoaWNoIGFyZSBtb3ZpbmcgcGxhY2Ugd2l0aGluIHRoZSBsaXN0LlxuICAgICAqL1xuICAgIHVwZGF0ZUNoYW5nZXNBbmltYXRlZDogZnVuY3Rpb24odmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSB2YWx1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIGFuaW1hdGluZ1ZhbHVlID0gdmFsdWUuc2xpY2UoKTtcbiAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcblxuICAgICAgLy8gUnVuIHVwZGF0ZXMgd2hpY2ggb2NjdXJlZCB3aGlsZSB0aGlzIHdhcyBhbmltYXRpbmcuXG4gICAgICBmdW5jdGlvbiB3aGVuRG9uZSgpIHtcbiAgICAgICAgLy8gVGhlIGxhc3QgYW5pbWF0aW9uIGZpbmlzaGVkIHdpbGwgcnVuIHRoaXNcbiAgICAgICAgaWYgKC0td2hlbkRvbmUuY291bnQgIT09IDApIHJldHVybjtcblxuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nKSB7XG4gICAgICAgICAgdmFyIGNoYW5nZXMgPSBkaWZmLmFycmF5cyh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcsIGFuaW1hdGluZ1ZhbHVlKTtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNoYW5nZXNBbmltYXRlZCh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcsIGNoYW5nZXMpO1xuICAgICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IG51bGw7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICAgIHdoZW5Eb25lLmNvdW50ID0gMDtcblxuICAgICAgdmFyIGFsbEFkZGVkID0gW107XG4gICAgICB2YXIgYWxsUmVtb3ZlZCA9IFtdO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICB2YXIgcmVtb3ZlZENvdW50ID0gc3BsaWNlLnJlbW92ZWQubGVuZ3RoO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIGFkZGVkVmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZW1vdmVkVmlld3MgPSB0aGlzLnZpZXdzLnNwbGljZS5hcHBseSh0aGlzLnZpZXdzLCBbIGluZGV4LCByZW1vdmVkQ291bnQgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5leHRTaWJsaW5nKTtcblxuICAgICAgICBhbGxBZGRlZCA9IGFsbEFkZGVkLmNvbmNhdChhZGRlZFZpZXdzKTtcbiAgICAgICAgYWxsUmVtb3ZlZCA9IGFsbFJlbW92ZWQuY29uY2F0KHJlbW92ZWRWaWV3cyk7XG4gICAgICB9LCB0aGlzKTtcblxuXG4gICAgICBhbGxBZGRlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odmlldywgd2hlbkRvbmUpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgIHdoZW5Eb25lLmNvdW50Kys7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh2aWV3LCB3aGVuRG9uZSk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG5cbi8qKlxuICogIyBEZWZhdWx0IEZvcm1hdHRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGZvcm1hdHRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3Rva2VuTGlzdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiB2IFRPRE8gdlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzdHlsZXMnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZmlsdGVyXG4gICAqIEZpbHRlcnMgYW4gYXJyYXkgYnkgdGhlIGdpdmVuIGZpbHRlciBmdW5jdGlvbihzKSwgbWF5IHByb3ZpZGUgYSBmdW5jdGlvbiwgYW5cbiAgICogYXJyYXksIG9yIGFuIG9iamVjdCB3aXRoIGZpbHRlcmluZyBmdW5jdGlvbnNcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmlsdGVyJywgZnVuY3Rpb24odmFsdWUsIGZpbHRlckZ1bmMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmICghZmlsdGVyRnVuYykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZmlsdGVyRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGZpbHRlckZ1bmMpKSB7XG4gICAgICBmaWx0ZXJGdW5jLmZvckVhY2goZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdvYmplY3QnKSB7XG4gICAgICBPYmplY3Qua2V5cyhmaWx0ZXJGdW5jKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICB2YXIgZnVuYyA9IGZpbHRlckZ1bmNba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG1hcFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIG1hcCBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gbWFwcGluZyBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdtYXAnLCBmdW5jdGlvbih2YWx1ZSwgbWFwRnVuYykge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChtYXBGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hcEZ1bmMuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdyZWR1Y2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIHJlZHVjZUZ1bmMoaW5pdGlhbFZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzbGljZScsIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgZW5kSW5kZXgpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zbGljZShpbmRleCwgZW5kSW5kZXgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBkYXRlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gZm9ybWF0IGRhdGVzIGFuZCBzdHJpbmdzXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS50b0xvY2FsZVN0cmluZygpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsb2dcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsb2cgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLCB1c2VmdWwgZm9yIGRlYnVnZ2luZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsb2cnLCBmdW5jdGlvbih2YWx1ZSwgcHJlZml4KSB7XG4gICAgaWYgKHByZWZpeCA9PSBudWxsKSBwcmVmaXggPSAnTG9nOic7XG4gICAgY29uc29sZS5sb2cocHJlZml4LCB2YWx1ZSk7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsaW1pdFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxpbWl0IHRoZSBsZW5ndGggb2YgYW4gYXJyYXkgb3Igc3RyaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xpbWl0JywgZnVuY3Rpb24odmFsdWUsIGxpbWl0KSB7XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5zbGljZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGxpbWl0IDwgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UobGltaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUuc2xpY2UoMCwgbGltaXQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBzb3J0XG4gICAqIFNvcnRzIGFuIGFycmF5IGdpdmVuIGEgZmllbGQgbmFtZSBvciBzb3J0IGZ1bmN0aW9uLCBhbmQgYSBkaXJlY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc29ydCcsIGZ1bmN0aW9uKHZhbHVlLCBzb3J0RnVuYywgZGlyKSB7XG4gICAgaWYgKCFzb3J0RnVuYyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgZGlyID0gKGRpciA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICBpZiAodHlwZW9mIHNvcnRGdW5jID09PSAnc3RyaW5nJykge1xuICAgICAgdmFyIHBhcnRzID0gc29ydEZ1bmMuc3BsaXQoJzonKTtcbiAgICAgIHZhciBwcm9wID0gcGFydHNbMF07XG4gICAgICB2YXIgZGlyMiA9IHBhcnRzWzFdO1xuICAgICAgZGlyMiA9IChkaXIyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgICAgZGlyID0gZGlyIHx8IGRpcjI7XG4gICAgICB2YXIgc29ydEZ1bmMgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhW3Byb3BdID4gYltwcm9wXSkgcmV0dXJuIGRpcjtcbiAgICAgICAgaWYgKGFbcHJvcF0gPCBiW3Byb3BdKSByZXR1cm4gLWRpcjtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoZGlyID09PSAtMSkge1xuICAgICAgdmFyIG9yaWdGdW5jID0gc29ydEZ1bmM7XG4gICAgICBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIC1vcmlnRnVuYyhhLCBiKTsgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUuc2xpY2UoKS5zb3J0KHNvcnRGdW5jKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYWRkUXVlcnlcbiAgICogVGFrZXMgdGhlIGlucHV0IFVSTCBhbmQgYWRkcyAob3IgcmVwbGFjZXMpIHRoZSBmaWVsZCBpbiB0aGUgcXVlcnlcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYWRkUXVlcnknLCBmdW5jdGlvbih2YWx1ZSwgcXVlcnlGaWVsZCwgcXVlcnlWYWx1ZSkge1xuICAgIHZhciB1cmwgPSB2YWx1ZSB8fCBsb2NhdGlvbi5ocmVmO1xuICAgIHZhciBwYXJ0cyA9IHVybC5zcGxpdCgnPycpO1xuICAgIHVybCA9IHBhcnRzWzBdO1xuICAgIHZhciBxdWVyeSA9IHBhcnRzWzFdO1xuICAgIHZhciBhZGRlZFF1ZXJ5ID0gJyc7XG4gICAgaWYgKHF1ZXJ5VmFsdWUgIT0gbnVsbCkge1xuICAgICAgYWRkZWRRdWVyeSA9IHF1ZXJ5RmllbGQgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQocXVlcnlWYWx1ZSk7XG4gICAgfVxuXG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB2YXIgZXhwciA9IG5ldyBSZWdFeHAoJ1xcXFxiJyArIHF1ZXJ5RmllbGQgKyAnPVteJl0qJyk7XG4gICAgICBpZiAoZXhwci50ZXN0KHF1ZXJ5KSkge1xuICAgICAgICBxdWVyeSA9IHF1ZXJ5LnJlcGxhY2UoZXhwciwgYWRkZWRRdWVyeSk7XG4gICAgICB9IGVsc2UgaWYgKGFkZGVkUXVlcnkpIHtcbiAgICAgICAgcXVlcnkgKz0gJyYnICsgYWRkZWRRdWVyeTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnkgPSBhZGRlZFF1ZXJ5O1xuICAgIH1cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHVybCArPSAnPycgKyBxdWVyeTtcbiAgICB9XG4gICAgcmV0dXJuIHVybDtcbiAgfSk7XG5cblxuICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcbiAgZnVuY3Rpb24gZXNjYXBlSFRNTCh2YWx1ZSkge1xuICAgIGRpdi50ZXh0Q29udGVudCA9IHZhbHVlIHx8ICcnO1xuICAgIHJldHVybiBkaXYuaW5uZXJIVE1MO1xuICB9XG5cblxuICAvKipcbiAgICogIyMgZXNjYXBlXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50LiBGb3IgdXNlIHdpdGggb3RoZXIgSFRNTC1hZGRpbmcgZm9ybWF0dGVycyBzdWNoIGFzIGF1dG9saW5rLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGVzY2FwZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdlc2NhcGUnLCBlc2NhcGVIVE1MKTtcblxuXG4gIC8qKlxuICAgKiAjIyBwXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IHdyYXBwaW5nIHBhcmFncmFwaHMgaW4gPHA+IHRhZ3MuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgcCB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9wPlxuICAgKiA8cD5JdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcigncCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGxpbmVzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIHZhciBlc2NhcGVkID0gbGluZXMubWFwKGZ1bmN0aW9uKGxpbmUpIHsgcmV0dXJuIGVzY2FwZUhUTUwobGluZSkgfHwgJzxicj4nOyB9KTtcbiAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD48cD4nKSArICc8L3A+JztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYnJcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxicj4gdGFncyBpbiBwbGFjZSBvZiBuZXdsaW5lcyBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGJyIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8YnI+XG4gICAqIEl0J3MgZ3JlYXQ8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2JyJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgbGluZXMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+Jyk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG5ld2xpbmVcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxwPiB0YWdzIGF0IGRvdWJsZSBuZXdsaW5lcyBhbmQgPGJyPiB0YWdzIGluIHBsYWNlIG9mIHNpbmdsZSBuZXdsaW5lIGNoYXJhY3RlcnMuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgbmV3bGluZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbmV3bGluZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIHBhcmFncmFwaHMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuXFxzKlxccj9cXG4vKTtcbiAgICB2YXIgZXNjYXBlZCA9IHBhcmFncmFwaHMubWFwKGZ1bmN0aW9uKHBhcmFncmFwaCkge1xuICAgICAgdmFyIGxpbmVzID0gcGFyYWdyYXBoLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICByZXR1cm4gbGluZXMubWFwKGVzY2FwZUhUTUwpLmpvaW4oJzxicj4nKTtcbiAgICB9KTtcbiAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD48cD4nKSArICc8L3A+JztcbiAgfSk7XG5cblxuXG4gIHZhciB1cmxFeHAgPSAvKF58XFxzfFxcKCkoKD86aHR0cHM/fGZ0cCk6XFwvXFwvW1xcLUEtWjAtOStcXHUwMDI2QCNcXC8lPz0oKX5ffCE6LC47XSpbXFwtQS1aMC05K1xcdTAwMjZAI1xcLyU9fihffF0pL2dpO1xuICAvKipcbiAgICogIyMgYXV0b2xpbmtcbiAgICogQWRkcyBhdXRvbWF0aWMgbGlua3MgdG8gZXNjYXBlZCBjb250ZW50IChiZSBzdXJlIHRvIGVzY2FwZSB1c2VyIGNvbnRlbnQpLiBDYW4gYmUgdXNlZCBvbiBleGlzdGluZyBIVE1MIGNvbnRlbnQgYXMgaXRcbiAgICogd2lsbCBza2lwIFVSTHMgd2l0aGluIEhUTUwgdGFncy4gUGFzc2luZyB0cnVlIGluIHRoZSBzZWNvbmQgcGFyYW1ldGVyIHdpbGwgc2V0IHRoZSB0YXJnZXQgdG8gYF9ibGFua2AuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2F1dG9saW5rJywgZnVuY3Rpb24odmFsdWUsIHRhcmdldCkge1xuICAgIHRhcmdldCA9ICh0YXJnZXQpID8gJyB0YXJnZXQ9XCJfYmxhbmtcIicgOiAnJztcblxuICAgIHJldHVybiAoJycgKyB2YWx1ZSkucmVwbGFjZSgvPFtePl0rPnxbXjxdKy9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgaWYgKG1hdGNoLmNoYXJBdCgwKSA9PT0gJzwnKSB7XG4gICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaC5yZXBsYWNlKHVybEV4cCwgJyQxPGEgaHJlZj1cIiQyXCInICsgdGFyZ2V0ICsgJz4kMjwvYT4nKTtcbiAgICB9KTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignaW50JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YWx1ZSA9IHBhcnNlSW50KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdmbG9hdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFsdWUgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdib29sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdmFsdWUgIT09ICcwJyAmJiB2YWx1ZSAhPT0gJ2ZhbHNlJztcbiAgfSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFRlbXBsYXRlO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cblxuLyoqXG4gKiAjIyBUZW1wbGF0ZVxuICogVGFrZXMgYW4gSFRNTCBzdHJpbmcsIGFuIGVsZW1lbnQsIGFuIGFycmF5IG9mIGVsZW1lbnRzLCBvciBhIGRvY3VtZW50IGZyYWdtZW50LCBhbmQgY29tcGlsZXMgaXQgaW50byBhIHRlbXBsYXRlLlxuICogSW5zdGFuY2VzIG1heSB0aGVuIGJlIGNyZWF0ZWQgYW5kIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gKiBmcm9tIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIG9iamVjdHMuIEFueSBvZiB0aGVzZSB3aWxsIGJlIGNvbnZlcnRlZCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQgZm9yIHRoZSB0ZW1wbGF0ZSB0b1xuICogY2xvbmUuIE5vZGVzIGFuZCBlbGVtZW50cyBwYXNzZWQgaW4gd2lsbCBiZSByZW1vdmVkIGZyb20gdGhlIERPTS5cbiAqL1xuZnVuY3Rpb24gVGVtcGxhdGUoKSB7XG4gIHRoaXMucG9vbCA9IFtdO1xufVxuXG5cblRlbXBsYXRlLnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyB2aWV3IGNsb25lZCBmcm9tIHRoaXMgdGVtcGxhdGUuXG4gICAqL1xuICBjcmVhdGVWaWV3OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5wb29sLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIHRoaXMucG9vbC5wb3AoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXh0ZW5kLm1ha2UoVmlldywgZG9jdW1lbnQuaW1wb3J0Tm9kZSh0aGlzLCB0cnVlKSwgdGhpcyk7XG4gIH0sXG5cbiAgcmV0dXJuVmlldzogZnVuY3Rpb24odmlldykge1xuICAgIGlmICh0aGlzLnBvb2wuaW5kZXhPZih2aWV3KSA9PT0gLTEpIHtcbiAgICAgIHRoaXMucG9vbC5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxufTtcbiIsIi8vIEhlbHBlciBtZXRob2RzIGZvciBhbmltYXRpb25cbmV4cG9ydHMubWFrZUVsZW1lbnRBbmltYXRhYmxlID0gbWFrZUVsZW1lbnRBbmltYXRhYmxlO1xuZXhwb3J0cy5nZXRDb21wdXRlZENTUyA9IGdldENvbXB1dGVkQ1NTO1xuZXhwb3J0cy5hbmltYXRlRWxlbWVudCA9IGFuaW1hdGVFbGVtZW50O1xuXG5mdW5jdGlvbiBtYWtlRWxlbWVudEFuaW1hdGFibGUoZWxlbWVudCkge1xuICAvLyBBZGQgcG9seWZpbGwganVzdCBvbiB0aGlzIGVsZW1lbnRcbiAgaWYgKCFlbGVtZW50LmFuaW1hdGUpIHtcbiAgICBlbGVtZW50LmFuaW1hdGUgPSBhbmltYXRlRWxlbWVudDtcbiAgfVxuXG4gIC8vIE5vdCBhIHBvbHlmaWxsIGJ1dCBhIGhlbHBlclxuICBpZiAoIWVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MpIHtcbiAgICBlbGVtZW50LmdldENvbXB1dGVkQ1NTID0gZ2V0Q29tcHV0ZWRDU1M7XG4gIH1cblxuICByZXR1cm4gZWxlbWVudDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIGNvbXB1dGVkIHN0eWxlIG9uIGFuIGVsZW1lbnQuXG4gKi9cbmZ1bmN0aW9uIGdldENvbXB1dGVkQ1NTKHN0eWxlTmFtZSkge1xuICBpZiAodGhpcy5vd25lckRvY3VtZW50LmRlZmF1bHRWaWV3Lm9wZW5lcikge1xuICAgIHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcuZ2V0Q29tcHV0ZWRTdHlsZSh0aGlzKVtzdHlsZU5hbWVdO1xuICB9XG4gIHJldHVybiB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSh0aGlzKVtzdHlsZU5hbWVdO1xufVxuXG4vKipcbiAqIFZlcnkgYmFzaWMgcG9seWZpbGwgZm9yIEVsZW1lbnQuYW5pbWF0ZSBpZiBpdCBkb2Vzbid0IGV4aXN0LiBJZiBpdCBkb2VzLCB1c2UgdGhlIG5hdGl2ZS5cbiAqIFRoaXMgb25seSBzdXBwb3J0cyB0d28gY3NzIHN0YXRlcy4gSXQgd2lsbCBvdmVyd3JpdGUgZXhpc3Rpbmcgc3R5bGVzLiBJdCBkb2Vzbid0IHJldHVybiBhbiBhbmltYXRpb24gcGxheSBjb250cm9sLiBJdFxuICogb25seSBzdXBwb3J0cyBkdXJhdGlvbiwgZGVsYXksIGFuZCBlYXNpbmcuIFJldHVybnMgYW4gb2JqZWN0IHdpdGggYSBwcm9wZXJ0eSBvbmZpbmlzaC5cbiAqL1xuZnVuY3Rpb24gYW5pbWF0ZUVsZW1lbnQoY3NzLCBvcHRpb25zKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShjc3MpIHx8IGNzcy5sZW5ndGggIT09IDIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdhbmltYXRlIHBvbHlmaWxsIHJlcXVpcmVzIGFuIGFycmF5IGZvciBjc3Mgd2l0aCBhbiBpbml0aWFsIGFuZCBmaW5hbCBzdGF0ZScpO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zIHx8ICFvcHRpb25zLmhhc093blByb3BlcnR5KCdkdXJhdGlvbicpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYW5pbWF0ZSBwb2x5ZmlsbCByZXF1aXJlcyBvcHRpb25zIHdpdGggYSBkdXJhdGlvbicpO1xuICB9XG5cbiAgdmFyIGR1cmF0aW9uID0gb3B0aW9ucy5kdXJhdGlvbiB8fCAwO1xuICB2YXIgZGVsYXkgPSBvcHRpb25zLmRlbGF5IHx8IDA7XG4gIHZhciBlYXNpbmcgPSBvcHRpb25zLmVhc2luZztcbiAgdmFyIGluaXRpYWxDc3MgPSBjc3NbMF07XG4gIHZhciBmaW5hbENzcyA9IGNzc1sxXTtcbiAgdmFyIGFsbENzcyA9IHt9O1xuICB2YXIgcGxheWJhY2sgPSB7IG9uZmluaXNoOiBudWxsIH07XG5cbiAgT2JqZWN0LmtleXMoaW5pdGlhbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gaW5pdGlhbENzc1trZXldO1xuICB9KTtcblxuICAvLyB0cmlnZ2VyIHJlZmxvd1xuICBlbGVtZW50Lm9mZnNldFdpZHRoO1xuXG4gIHZhciB0cmFuc2l0aW9uT3B0aW9ucyA9ICcgJyArIGR1cmF0aW9uICsgJ21zJztcbiAgaWYgKGVhc2luZykge1xuICAgIHRyYW5zaXRpb25PcHRpb25zICs9ICcgJyArIGVhc2luZztcbiAgfVxuICBpZiAoZGVsYXkpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBkZWxheSArICdtcyc7XG4gIH1cblxuICBlbGVtZW50LnN0eWxlLnRyYW5zaXRpb24gPSBPYmplY3Qua2V5cyhmaW5hbENzcykubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiBrZXkgKyB0cmFuc2l0aW9uT3B0aW9uc1xuICB9KS5qb2luKCcsICcpO1xuXG4gIE9iamVjdC5rZXlzKGZpbmFsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIGFsbENzc1trZXldID0gdHJ1ZTtcbiAgICBlbGVtZW50LnN0eWxlW2tleV0gPSBmaW5hbENzc1trZXldO1xuICB9KTtcblxuICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIE9iamVjdC5rZXlzKGFsbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9ICcnO1xuICAgIH0pO1xuXG4gICAgaWYgKHBsYXliYWNrLm9uZmluaXNoKSB7XG4gICAgICBwbGF5YmFjay5vbmZpbmlzaCgpO1xuICAgIH1cbiAgfSwgZHVyYXRpb24gKyBkZWxheSk7XG5cbiAgcmV0dXJuIHBsYXliYWNrO1xufVxuIiwidmFyIGdsb2JhbCA9IChmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMgfSkoKTtcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kO1xuZXh0ZW5kLm1ha2UgPSBtYWtlO1xuXG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBwcm90b3R5cGUgZm9yIHRoZSBnaXZlbiBjb250cnVjdG9yIGFuZCBzZXRzIGFuIGBleHRlbmRgIG1ldGhvZCBvbiBpdC4gSWYgYGV4dGVuZGAgaXMgY2FsbGVkIGZyb20gYVxuICogaXQgd2lsbCBleHRlbmQgdGhhdCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZXh0ZW5kKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpIHtcbiAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzID09PSBnbG9iYWwgPyBPYmplY3QgOiB0aGlzO1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nICYmICFwcm90b3R5cGUpIHtcbiAgICBwcm90b3R5cGUgPSBjb25zdHJ1Y3RvcjtcbiAgICBjb25zdHJ1Y3RvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbiAgY29uc3RydWN0b3IuZXh0ZW5kID0gZXh0ZW5kO1xuICB2YXIgZGVzY3JpcHRvcnMgPSBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKTtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckNsYXNzLnByb3RvdHlwZSwgZGVzY3JpcHRvcnMpO1xuICByZXR1cm4gY29uc3RydWN0b3I7XG59XG5cblxuLyoqXG4gKiBNYWtlcyBhIG5hdGl2ZSBvYmplY3QgcHJldGVuZCB0byBiZSBhIGNsYXNzIChlLmcuIGFkZHMgbWV0aG9kcyB0byBhIERvY3VtZW50RnJhZ21lbnQgYW5kIGNhbGxzIHRoZSBjb25zdHJ1Y3RvcikuXG4gKi9cbmZ1bmN0aW9uIG1ha2UoY29uc3RydWN0b3IsIG9iamVjdCkge1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZSBtdXN0IGFjY2VwdCBhIGZ1bmN0aW9uIGNvbnN0cnVjdG9yIGFuZCBhbiBvYmplY3QnKTtcbiAgfVxuICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgdmFyIHByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICBmb3IgKHZhciBrZXkgaW4gcHJvdG8pIHtcbiAgICBvYmplY3Rba2V5XSA9IHByb3RvW2tleV07XG4gIH1cbiAgY29uc3RydWN0b3IuYXBwbHkob2JqZWN0LCBhcmdzKTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuXG5mdW5jdGlvbiBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBkZXNjcmlwdG9ycyA9IHtcbiAgICBjb25zdHJ1Y3RvcjogeyB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogY29uc3RydWN0b3IgfVxuICB9O1xuXG4gIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbmFtZSk7XG4gICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZmFsc2U7XG4gICAgZGVzY3JpcHRvcnNbbmFtZV0gPSBkZXNjcmlwdG9yO1xuICB9KTtcbiAgcmV0dXJuIGRlc2NyaXB0b3JzO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB0b0ZyYWdtZW50O1xuXG4vLyBDb252ZXJ0IHN0dWZmIGludG8gZG9jdW1lbnQgZnJhZ21lbnRzLiBTdHVmZiBjYW4gYmU6XG4vLyAqIEEgc3RyaW5nIG9mIEhUTUwgdGV4dFxuLy8gKiBBbiBlbGVtZW50IG9yIHRleHQgbm9kZVxuLy8gKiBBIE5vZGVMaXN0IG9yIEhUTUxDb2xsZWN0aW9uIChlLmcuIGBlbGVtZW50LmNoaWxkTm9kZXNgIG9yIGBlbGVtZW50LmNoaWxkcmVuYClcbi8vICogQSBqUXVlcnkgb2JqZWN0XG4vLyAqIEEgc2NyaXB0IGVsZW1lbnQgd2l0aCBhIGB0eXBlYCBhdHRyaWJ1dGUgb2YgYFwidGV4dC8qXCJgIChlLmcuIGA8c2NyaXB0IHR5cGU9XCJ0ZXh0L2h0bWxcIj5NeSB0ZW1wbGF0ZSBjb2RlITwvc2NyaXB0PmApXG4vLyAqIEEgdGVtcGxhdGUgZWxlbWVudCAoZS5nLiBgPHRlbXBsYXRlPk15IHRlbXBsYXRlIGNvZGUhPC90ZW1wbGF0ZT5gKVxuZnVuY3Rpb24gdG9GcmFnbWVudChodG1sKSB7XG4gIGlmIChodG1sIGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICAgIHJldHVybiBodG1sO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBodG1sID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBzdHJpbmdUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2UgaWYgKGh0bWwgaW5zdGFuY2VvZiBOb2RlKSB7XG4gICAgcmV0dXJuIG5vZGVUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2UgaWYgKGh0bWwuaGFzT3duUHJvcGVydHkoJ2xlbmd0aCcpKSB7XG4gICAgcmV0dXJuIGxpc3RUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vuc3VwcG9ydGVkIFRlbXBsYXRlIFR5cGU6IENhbm5vdCBjb252ZXJ0IGAnICsgaHRtbCArICdgIGludG8gYSBkb2N1bWVudCBmcmFnbWVudC4nKTtcbiAgfVxufVxuXG4vLyBDb252ZXJ0cyBhbiBIVE1MIG5vZGUgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LiBJZiBpdCBpcyBhIDx0ZW1wbGF0ZT4gbm9kZSBpdHMgY29udGVudHMgd2lsbCBiZSB1c2VkLiBJZiBpdCBpcyBhXG4vLyA8c2NyaXB0PiBub2RlIGl0cyBzdHJpbmctYmFzZWQgY29udGVudHMgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gSFRNTCBmaXJzdCwgdGhlbiB1c2VkLiBPdGhlcndpc2UgYSBjbG9uZSBvZiB0aGUgbm9kZVxuLy8gaXRzZWxmIHdpbGwgYmUgdXNlZC5cbmZ1bmN0aW9uIG5vZGVUb0ZyYWdtZW50KG5vZGUpIHtcbiAgaWYgKG5vZGUuY29udGVudCBpbnN0YW5jZW9mIERvY3VtZW50RnJhZ21lbnQpIHtcbiAgICByZXR1cm4gbm9kZS5jb250ZW50O1xuICB9IGVsc2UgaWYgKG5vZGUudGFnTmFtZSA9PT0gJ1NDUklQVCcpIHtcbiAgICByZXR1cm4gc3RyaW5nVG9GcmFnbWVudChub2RlLmlubmVySFRNTCk7XG4gIH0gZWxzZSB7XG4gICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgIGlmIChub2RlLnRhZ05hbWUgPT09ICdURU1QTEFURScpIHtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gbm9kZS5jaGlsZE5vZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChub2RlLmNoaWxkTm9kZXNbaV0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChub2RlKTtcbiAgICB9XG4gICAgcmV0dXJuIGZyYWdtZW50O1xuICB9XG59XG5cbi8vIENvbnZlcnRzIGFuIEhUTUxDb2xsZWN0aW9uLCBOb2RlTGlzdCwgalF1ZXJ5IG9iamVjdCwgb3IgYXJyYXkgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LlxuZnVuY3Rpb24gbGlzdFRvRnJhZ21lbnQobGlzdCkge1xuICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gIGZvciAodmFyIGkgPSAwLCBsID0gbGlzdC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAvLyBVc2UgdG9GcmFnbWVudCBzaW5jZSB0aGlzIG1heSBiZSBhbiBhcnJheSBvZiB0ZXh0LCBhIGpRdWVyeSBvYmplY3Qgb2YgYDx0ZW1wbGF0ZT5gcywgZXRjLlxuICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHRvRnJhZ21lbnQobGlzdFtpXSkpO1xuICB9XG4gIHJldHVybiBmcmFnbWVudDtcbn1cblxuLy8gQ29udmVydHMgYSBzdHJpbmcgb2YgSFRNTCB0ZXh0IGludG8gYSBkb2N1bWVudCBmcmFnbWVudC5cbmZ1bmN0aW9uIHN0cmluZ1RvRnJhZ21lbnQoc3RyaW5nKSB7XG4gIHZhciB0ZW1wbGF0ZUVsZW1lbnQ7XG4gIHRlbXBsYXRlRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RlbXBsYXRlJyk7XG4gIHRlbXBsYXRlRWxlbWVudC5pbm5lckhUTUwgPSBzdHJpbmc7XG4gIHJldHVybiB0ZW1wbGF0ZUVsZW1lbnQuY29udGVudDtcbn1cblxuLy8gSWYgSFRNTCBUZW1wbGF0ZXMgYXJlIG5vdCBhdmFpbGFibGUgKGUuZy4gaW4gSUUpIHRoZW4gdXNlIGFuIG9sZGVyIG1ldGhvZCB0byB3b3JrIHdpdGggY2VydGFpbiBlbGVtZW50cy5cbmlmICghZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKS5jb250ZW50IGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICBzdHJpbmdUb0ZyYWdtZW50ID0gKGZ1bmN0aW9uKCkge1xuICAgIHZhciB0YWdFeHAgPSAvPChbXFx3Oi1dKykvO1xuXG4gICAgLy8gQ29waWVkIGZyb20galF1ZXJ5IChodHRwczovL2dpdGh1Yi5jb20vanF1ZXJ5L2pxdWVyeS9ibG9iL21hc3Rlci9MSUNFTlNFLnR4dClcbiAgICB2YXIgd3JhcE1hcCA9IHtcbiAgICAgIG9wdGlvbjogWyAxLCAnPHNlbGVjdCBtdWx0aXBsZT1cIm11bHRpcGxlXCI+JywgJzwvc2VsZWN0PicgXSxcbiAgICAgIGxlZ2VuZDogWyAxLCAnPGZpZWxkc2V0PicsICc8L2ZpZWxkc2V0PicgXSxcbiAgICAgIHRoZWFkOiBbIDEsICc8dGFibGU+JywgJzwvdGFibGU+JyBdLFxuICAgICAgdHI6IFsgMiwgJzx0YWJsZT48dGJvZHk+JywgJzwvdGJvZHk+PC90YWJsZT4nIF0sXG4gICAgICB0ZDogWyAzLCAnPHRhYmxlPjx0Ym9keT48dHI+JywgJzwvdHI+PC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIGNvbDogWyAyLCAnPHRhYmxlPjx0Ym9keT48L3Rib2R5Pjxjb2xncm91cD4nLCAnPC9jb2xncm91cD48L3RhYmxlPicgXSxcbiAgICAgIGFyZWE6IFsgMSwgJzxtYXA+JywgJzwvbWFwPicgXSxcbiAgICAgIF9kZWZhdWx0OiBbIDAsICcnLCAnJyBdXG4gICAgfTtcbiAgICB3cmFwTWFwLm9wdGdyb3VwID0gd3JhcE1hcC5vcHRpb247XG4gICAgd3JhcE1hcC50Ym9keSA9IHdyYXBNYXAudGZvb3QgPSB3cmFwTWFwLmNvbGdyb3VwID0gd3JhcE1hcC5jYXB0aW9uID0gd3JhcE1hcC50aGVhZDtcbiAgICB3cmFwTWFwLnRoID0gd3JhcE1hcC50ZDtcblxuICAgIHJldHVybiBmdW5jdGlvbiBzdHJpbmdUb0ZyYWdtZW50KHN0cmluZykge1xuICAgICAgdmFyIHRhZyA9IHN0cmluZy5tYXRjaCh0YWdFeHApO1xuICAgICAgdmFyIHBhcnRzID0gd3JhcE1hcFt0YWddIHx8IHdyYXBNYXAuX2RlZmF1bHQ7XG4gICAgICB2YXIgZGVwdGggPSBwYXJ0c1swXTtcbiAgICAgIHZhciBwcmVmaXggPSBwYXJ0c1sxXTtcbiAgICAgIHZhciBwb3N0Zml4ID0gcGFydHNbMl07XG4gICAgICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBkaXYuaW5uZXJIVE1MID0gcHJlZml4ICsgc3RyaW5nICsgcG9zdGZpeDtcbiAgICAgIHdoaWxlIChkZXB0aC0tKSB7XG4gICAgICAgIGRpdiA9IGRpdi5sYXN0Q2hpbGQ7XG4gICAgICB9XG4gICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICB3aGlsZSAoZGl2LmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZGl2LmZpcnN0Q2hpbGQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZyYWdtZW50O1xuICAgIH07XG4gIH0pKCk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cblxuLyoqXG4gKiAjIyBWaWV3XG4gKiBBIERvY3VtZW50RnJhZ21lbnQgd2l0aCBiaW5kaW5ncy5cbiAqL1xuZnVuY3Rpb24gVmlldyh0ZW1wbGF0ZSkge1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG4gIHRoaXMuYmluZGluZ3MgPSB0aGlzLnRlbXBsYXRlLmJpbmRpbmdzLm1hcChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgcmV0dXJuIGJpbmRpbmcuY2xvbmVGb3JWaWV3KHRoaXMpO1xuICB9LCB0aGlzKTtcbiAgdGhpcy5maXJzdFZpZXdOb2RlID0gdGhpcy5maXJzdENoaWxkO1xuICB0aGlzLmxhc3RWaWV3Tm9kZSA9IHRoaXMubGFzdENoaWxkO1xuICBpZiAodGhpcy5maXJzdFZpZXdOb2RlKSB7XG4gICAgdGhpcy5maXJzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICAgIHRoaXMubGFzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICB9XG59XG5cblxuVmlldy5wcm90b3R5cGUgPSB7XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSB2aWV3IGZyb20gdGhlIERPTS4gQSB2aWV3IGlzIGEgRG9jdW1lbnRGcmFnbWVudCwgc28gYHJlbW92ZSgpYCByZXR1cm5zIGFsbCBpdHMgbm9kZXMgdG8gaXRzZWxmLlxuICAgKi9cbiAgcmVtb3ZlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9kZSA9IHRoaXMuZmlyc3RWaWV3Tm9kZTtcbiAgICB2YXIgbmV4dDtcblxuICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHRoaXMpIHtcbiAgICAgIC8vIFJlbW92ZSBhbGwgdGhlIG5vZGVzIGFuZCBwdXQgdGhlbSBiYWNrIGludG8gdGhpcyBmcmFnbWVudFxuICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgbmV4dCA9IChub2RlID09PSB0aGlzLmxhc3RWaWV3Tm9kZSkgPyBudWxsIDogbm9kZS5uZXh0U2libGluZztcbiAgICAgICAgdGhpcy5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgKGlmIG5vdCBhbHJlYWR5IHJlbW92ZWQpIGFuZCBhZGRzIHRoZSB2aWV3IHRvIGl0cyB0ZW1wbGF0ZSdzIHBvb2wuXG4gICAqL1xuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICAvLyBNYWtlIHN1cmUgdGhlIHZpZXcgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET01cbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucmV0dXJuVmlldyh0aGlzKTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogQmluZHMgYSB2aWV3IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICovXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5iaW5kKGNvbnRleHQpO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVuYmluZHMgYSB2aWV3IGZyb20gYW55IGNvbnRleHQuXG4gICAqL1xuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLnVuYmluZCgpO1xuICAgIH0pO1xuICB9XG59O1xuIiwidmFyIEZyYWdtZW50cyA9IHJlcXVpcmUoJy4vc3JjL2ZyYWdtZW50cycpO1xudmFyIE9ic2VydmVyID0gcmVxdWlyZSgnLi9zcmMvb2JzZXJ2ZXInKTtcblxuZnVuY3Rpb24gY3JlYXRlKCkge1xuICB2YXIgZnJhZ21lbnRzID0gbmV3IEZyYWdtZW50cyhPYnNlcnZlcik7XG4gIGZyYWdtZW50cy5leHByZXNzaW9uID0gT2JzZXJ2ZXIuZXhwcmVzc2lvbjtcbiAgZnJhZ21lbnRzLnN5bmMgPSBPYnNlcnZlci5zeW5jO1xuICByZXR1cm4gZnJhZ21lbnRzO1xufVxuXG4vLyBDcmVhdGUgYW4gaW5zdGFuY2Ugb2YgZnJhZ21lbnRzIHdpdGggdGhlIGRlZmF1bHQgb2JzZXJ2ZXJcbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlKCk7XG5tb2R1bGUuZXhwb3J0cy5jcmVhdGUgPSBjcmVhdGU7XG4iXX0=
