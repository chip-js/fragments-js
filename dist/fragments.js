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
  var animate = element.getAttribute('animate');
  var fragments = properties.fragments;

  if (animate !== null) {
    if (element.nodeName === 'TEMPLATE' || element.nodeName === 'SCRIPT') {
      throw new Error('Cannot animate multiple nodes in a template or script. Remove the [animate] attribute.');
    }

    setTimeout(function() {
      // Allow multiple bindings to animate by not removing until they have all been created
      element.removeAttribute('animate');
    });

    this.animate = true;

    if (fragments.isBound('attribute', animate)) {
      // javascript animation
      this.animateExpression = fragments.codifyExpression(animate);
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
      setTimeout(function() {
        node.classList.remove(name);
        if (className) node.classList.remove(className);
        if (callback) callback.call(_this);
      }, duration);
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
  this.compiled();
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
  var bindings = template.bindings = [], currentNode, parentNode, previousNode;

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

  return template;
}



// Find all the bindings on a given node (text nodes will only ever have one binding).
function getBindingsForNode(fragments, node, view) {
  var bindings = [];
  var Binder, expr, bound, match, attr, i;

  if (node.nodeType === Node.TEXT_NODE) {
    splitTextNode(fragments, node);

    // Find any binding for the text node
    if (fragments.isBound('text', node.nodeValue)) {
      expr = fragments.codifyExpression('text', node.nodeValue);
      node.nodeValue = '';
      Binder = fragments.findBinder('text', expr);
      bindings.push(new Binder({ node: node, view: view, expression: expr, fragments: fragments }));
    }
  } else {
    // If the element is removed from the DOM, stop. Check by looking at its parentNode
    var parent = node.parentNode;

    // Find any binding for the element
    Binder = fragments.findBinder('element', node.tagName.toLowerCase());
    if (Binder) {
      bindings.push(new Binder({ node: node, view: view, fragments: fragments }));
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
        var match = name.match(Binder.expr);
        if (match) match = match[1];
      }
      node.removeAttributeNode(attr);

      bindings.push(new Binder({
        node: node,
        view: view,
        name: name,
        match: match,
        expression: fragments.codifyExpression('attribute', value),
        fragments: fragments
      }));

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

  this.binders = {
    element: { _wildcards: [] },
    attribute: { _wildcards: [], _expr: /{{(.*?)}}/g },
    text: { _wildcards: [], _expr: /{{(.*?)}}/g }
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
    compile(this, template);
    return template;
  },


  /**
   * Compiles bindings on an element.
   */
  compileElement: function(element) {
    return compile(this, element);
  },


  /**
   * Compiles and binds an element which was not created from a template. Mostly only used for binding the document's
   * html element.
   */
  bindElement: function(element, context) {
    this.compileElement(element);

    // initialize all the bindings first before binding them to the context
    element.bindings.forEach(function(binding) {
      binding.init();
    });

    element.bindings.forEach(function(binding) {
      binding.bind(context);
    });
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

},{}],7:[function(require,module,exports){
module.exports = exports = require('./observer');
exports.expression = require('./expression');
exports.expression.diff = require('./diff');

},{"./diff":5,"./expression":6,"./observer":8}],8:[function(require,module,exports){
module.exports = Observer;
var expression = require('./expression');
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
      return this.getter.call(this.context, Observer.formatters);
    }
  },

  // Sets the value of this expression
  set: function(value) {
    if (this.context && this.setter) {
      return this.setter.call(this.context._origContext_ || this.context, Observer.formatters, value);
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
    Observer.afterSync(callback);
  }

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

Observer.syncLater = function(callback) {
  if (!Observer.timeout) {
    Observer.timeout = setTimeout(function() {
      Observer.timeout = null;
      Observer.sync(callback);
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


  /**
   * Slide down and up
   */
  fragments.registerAnimation('slide', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },
    animateIn: function(element, done) {
      element.style.overflow = 'hidden';
      element.animate([
        { height: '0px' },
        { height: element.getComputedCSS('height') }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    },
    animateOut: function(element, done) {
      element.style.overflow = 'hidden';
      element.animate([
        { height: element.getComputedCSS('height') },
        { height: '0px' }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    }
  });


  var animatingOut = new Map();

  /**
   * Move items up and down in a list, slide down and up
   */
  fragments.registerAnimation('slide-move', {
    options: {
      duration: 300,
      easing: 'ease-in-out'
    },

    animateIn: function(element, done) {
      var oldElement, moveElement;
      var item = element.view && element.view._repeatItem_;
      if (item) {
        outElement = animatingOut.get(item);
        if (oldElement) {
          // This item is being removed in one place and added into another. Make it look like its moving by making both
          // elements not visible and having a clone move above the items to the new location.
          this.animateMove(oldElement, element);
        }
      }

      // Do the slide
      element.style.overflow = 'hidden';
      element.animate([
        { height: '0px' },
        { height: element.getComputedCSS('height') }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    },

    animateOut: function(element, done) {
      var item = element.view && element.view._repeatItem_;
      if (item) {
        animatingOut.set(item, element);
        setTimeout(function() {
          animatingOut.delete(item);
        });
      }

      // Do the slide
      element.style.overflow = 'hidden';
      element.animate([
        { height: element.getComputedCSS('height') },
        { height: '0px' }
      ], this.options).onfinish = function() {
        element.style.overflow = '';
        done();
      };
    },

    animateMove: function(oldElement, newElement) {
      var moveElement;
      var parent = element.parentNode;
      if (!parent.__slideMoveHandled) {
        parent.__slideMoveHandled = true;
        if (window.getComputedStyle(parent).position === 'static') {
          parent.style.position = 'relative';
        }
      }

      oldElement.style.visibility = 'hidden';
      element.style.visibility = 'hidden';
      moveElement = fragments.makeElementAnimatable(oldElement.cloneNode(true));
      moveElement.style.position = 'absolute';
      parent.appendChild(moveElement);

      moveElement.animate([
        { top: oldElement.offsetTop + 'px' },
        { top: element.offsetTop + 'px' }
      ], this.options).onfinish = function() {
        newElement.style.visibility = '';
      };
    }
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
    priority: 200,
    udpated: function(value) {
      console.info('Debug:', this.expression, '=', value);
    }
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
    element.innerHTML = value == null ? '' : value;
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

    compiled: function() {
      var name = this.element.tagName.toLowerCase();
      var type = this.element.type;
      this.methods = inputMethods[type] || inputMethods[name] || inputMethods.radiogroup;

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

    textarea: defaultInputMethod,

    radiogroup: { // Handles a group of radio inputs, assigned to anything that isn't a a form input
      get: function() { return this.find('input[type="radio"][checked]').value },
      set: function(value) {
        // in case the value isn't found in radios
        value = (value == null) ? '' : value;
        this.querySelector('input[type="radio"][checked]').checked = false;
        var radio = this.querySelector('input[type="radio"][value="' + value.replace(/"/g, '\\"') + '"]');
        if (radio) radio.checked = true;
      }
    }
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
        // prevent native events, let custom events use the "defaultCanceled" mechanism
        if (!(event instanceof CustomEvent)) {
          event.preventDefault();
        }
        if (!this.hasAttribute('disabled')) {
          // Let an on-[event] make the function call with its own arguments
          var listener = _this.observer.get();

          // Or just return a function which will be called with the event object
          if (typeof listener === 'function') listener.call(_this.context, event);
        }
      });
    }
  });


   /**
   * ## native-[event]
   * Adds a binder for each event name in the array. When the event is triggered the expression will be run.
   * It will not call event.preventDefault() like on-* or withhold when disabled.
   *
   * **Example Events:**
   *
   * * native-click
   * * native-dblclick
   * * native-submit
   * * native-change
   * * native-focus
   * * native-blur
   *
   * **Example:**
   * ```html
   * <form native-submit="{{saveUser(event)}}">
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
  fragments.registerAttribute('native-*', {
    created: function() {
      var eventName = this.match;
      var _this = this;
      this.element.addEventListener(eventName, function(event) {
        // Let an on-[event] make the function call with its own arguments
        var listener = _this.observer.get();

        // Or just return a function which will be called with the event object
        if (typeof listener === 'function') listener.call(_this.context, event);
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
          if (useCtrlKey && !(event.ctrlKey || event.metaKey)) return;
          if (event.keyCode !== keyCode) return;
          event.preventDefault();

          if (!this.hasAttribute('disabled')) {
            // Let an on-[event] make the function call with its own arguments
            var listener = _this.observer.get();

            // Or just return a function which will be called with the event object
            if (typeof listener === 'function') listener.call(_this.context, event);
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

    compiled: function() {
      var element = this.element;
      var expressions = [ wrapIfExp(this.expression, this.name === 'unless') ];
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
        if (node.hasAttribute('else-if')) {
          expression = fragments.codifyExpression('attribute', node.getAttribute('else-if'));
          expressions.push(wrapIfExp(expression, false));
          node.removeAttribute('else-if');
        } else if (node.hasAttribute('else-unless')) {
          expression = fragments.codifyExpression('attribute', node.getAttribute('else-unless'));
          expressions.push(wrapIfExp(expression, true));
          node.removeAttribute('else-unless');
        } else if (node.hasAttribute('else')) {
          node.removeAttribute('else');
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
        this.animateOut(this.showing, function() {
          this.animating = false;
          this.remove(this.showing);
          this.showing = null;
          // finish by animating the new element in (if any)
          this.updatedAnimated(this.lastValue);
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
      }
    }
  });

  fragments.registerAttribute('unless', IfBinding);

  function wrapIfExp(expr, isUnless) {
    return (isUnless ? '!' : '') + expr;
  }


  /**
   * ## foreach
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
        this.views.forEach(function(view) {
          view.dispose();
          view._repeatItem_ = null;
        });
        this.views.length = 0;
      }
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
        context._origContext_ = this.context;
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
        this.views.forEach(function(node) {
          node.dispose();
        });
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
      var removedCount = 0;
      var removedMap = new Map();

      changes.forEach(function(splice) {
        if (!splice.removed.length) return;
        var removed = this.views.splice(splice.index - removedCount, splice.removed.length);
        // Save for reuse if items moved (e.g. on a sort update) instead of just getting removed
        removed.forEach(function(view) {
          removedMap.set(view._repeatItem_, view);
          view.remove();
        });
        removedCount += removed.length;
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
          addedViews.push(view);
          fragment.appendChild(view);
        }
        this.views.splice.apply(this.views, [ index, 0 ].concat(addedViews));
        var previousView = this.views[index - 1];
        var nextSibling = previousView ? previousView.lastViewNode.nextSibling : this.element.nextSibling;
        nextSibling.parentNode.insertBefore(fragment, nextSibling);
      }, this);

      // Cleanup any views that were removed and not re-added (moved)
      removedMap.forEach(function(value) {
        value._repeatItem_ = null;
        value.dispose();
      });
      removedMap.clear();
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
        if (--whenDone.count === 0) return;

        this.animating = false;
        if (this.valueWhileAnimating) {
          var changes = diff.array(this.valueWhileAnimating, animatingValue);
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

        removedViews.forEach(function(view) {
          whenDone.count++;
          this.animateOut(view, whenDone);
        }, this);

        addedViews.forEach(function(view) {
          whenDone.count++;
          this.animateIn(view, whenDone);
        }, this);
      });
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
  this.firstViewNode = this.firstChild;
  this.lastViewNode = this.lastChild;
  this.firstViewNode.view = this;
  this.lastViewNode.view = this;
  this.bindings = this.template.bindings.map(function(binding) {
    return binding.cloneForView(this);
  }, this);
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
    this.remove();
    this.unbind();
    if (this.template) {
      this.template.pool.push(this);
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

// Create an instance of fragments with the default observer
var fragments = new Fragments(Observer);
fragments.expression = Observer.expression;
fragments.sync = Observer.sync;
module.exports = fragments;

},{"./src/fragments":4,"./src/observer":7}]},{},[17])(17)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvZGlmZi5qcyIsInNyYy9vYnNlcnZlci9leHByZXNzaW9uLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIiwiaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2a0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFlBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2h6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gQW5pbWF0ZWRCaW5kaW5nO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyk7XG52YXIgX3N1cGVyID0gQmluZGluZy5wcm90b3R5cGU7XG5cbi8qKlxuICogQmluZGluZ3Mgd2hpY2ggZXh0ZW5kIEFuaW1hdGVkQmluZGluZyBoYXZlIHRoZSBhYmlsaXR5IHRvIGFuaW1hdGUgZWxlbWVudHMgdGhhdCBhcmUgYWRkZWQgdG8gdGhlIERPTSBhbmQgcmVtb3ZlZCBmcm9tXG4gKiB0aGUgRE9NLiBUaGlzIGFsbG93cyBtZW51cyB0byBzbGlkZSBvcGVuIGFuZCBjbG9zZWQsIGVsZW1lbnRzIHRvIGZhZGUgaW4gb3IgZHJvcCBkb3duLCBhbmQgcmVwZWF0ZWQgaXRlbXMgdG8gYXBwZWFyXG4gKiB0byBtb3ZlIChpZiB5b3UgZ2V0IGNyZWF0aXZlIGVub3VnaCkuXG4gKlxuICogVGhlIGZvbGxvd2luZyA1IG1ldGhvZHMgYXJlIGhlbHBlciBET00gbWV0aG9kcyB0aGF0IGFsbG93IHJlZ2lzdGVyZWQgYmluZGluZ3MgdG8gd29yayB3aXRoIENTUyB0cmFuc2l0aW9ucyBmb3JcbiAqIGFuaW1hdGluZyBlbGVtZW50cy4gSWYgYW4gZWxlbWVudCBoYXMgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgb3IgYSBtYXRjaGluZyBKYXZhU2NyaXB0IG1ldGhvZCwgdGhlc2UgaGVscGVyIG1ldGhvZHNcbiAqIHdpbGwgc2V0IGEgY2xhc3Mgb24gdGhlIG5vZGUgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uIGFuZC9vciBjYWxsIHRoZSBKYXZhU2NyaXB0IG1ldGhvZHMgdG8gaGFuZGxlIGl0LlxuICpcbiAqIEFuIGFuaW1hdGlvbiBtYXkgYmUgZWl0aGVyIGEgQ1NTIHRyYW5zaXRpb24sIGEgQ1NTIGFuaW1hdGlvbiwgb3IgYSBzZXQgb2YgSmF2YVNjcmlwdCBtZXRob2RzIHRoYXQgd2lsbCBiZSBjYWxsZWQuXG4gKlxuICogSWYgdXNpbmcgQ1NTLCBjbGFzc2VzIGFyZSBhZGRlZCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBlbGVtZW50LiBXaGVuIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaXQgd2lsbCByZWNlaXZlIHRoZSBgd2lsbC1cbiAqIGFuaW1hdGUtaW5gIGNsYXNzIGJlZm9yZSBiZWluZyBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYGFuaW1hdGUtaW5gIGNsYXNzIGltbWVkaWF0ZWx5IGFmdGVyIGJlaW5nXG4gKiBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGJvdGggY2xhc2VzIHdpbGwgYmUgcmVtb3ZlZCBhZnRlciB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLiBXaGVuIGFuIGVsZW1lbnQgaXMgYmVpbmcgcmVtb3ZlZFxuICogZnJvbSB0aGUgRE9NIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtYW5pbWF0ZS1vdXRgIGFuZCBgYW5pbWF0ZS1vdXRgIGNsYXNzZXMsIHRoZW4gdGhlIGNsYXNzZXMgd2lsbCBiZSByZW1vdmVkIG9uY2VcbiAqIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuXG4gKlxuICogSWYgdXNpbmcgSmF2YVNjcmlwdCwgbWV0aG9kcyBtdXN0IGJlIGRlZmluZWQgIHRvIGFuaW1hdGUgdGhlIGVsZW1lbnQgdGhlcmUgYXJlIDMgc3VwcG9ydGVkIG1ldGhvZHMgd2hpY2ggY2FuIGJcbiAqXG4gKiBUT0RPIGNhY2hlIGJ5IGNsYXNzLW5hbWUgKEFuZ3VsYXIpPyBPbmx5IHN1cHBvcnQgamF2YXNjcmlwdC1zdHlsZSAoRW1iZXIpPyBBZGQgYSBgd2lsbC1hbmltYXRlLWluYCBhbmRcbiAqIGBkaWQtYW5pbWF0ZS1pbmAgZXRjLj9cbiAqIElGIGhhcyBhbnkgY2xhc3NlcywgYWRkIHRoZSBgd2lsbC1hbmltYXRlLWlufG91dGAgYW5kIGdldCBjb21wdXRlZCBkdXJhdGlvbi4gSWYgbm9uZSwgcmV0dXJuLiBDYWNoZS5cbiAqIFJVTEUgaXMgdXNlIHVuaXF1ZSBjbGFzcyB0byBkZWZpbmUgYW4gYW5pbWF0aW9uLiBPciBhdHRyaWJ1dGUgYGFuaW1hdGU9XCJmYWRlXCJgIHdpbGwgYWRkIHRoZSBjbGFzcz9cbiAqIGAuZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLmZhZGUuYW5pbWF0ZS1pbmAsIGAuZmFkZS53aWxsLWFuaW1hdGUtb3V0YCwgYC5mYWRlLmFuaW1hdGUtb3V0YFxuICpcbiAqIEV2ZW50cyB3aWxsIGJlIHRyaWdnZXJlZCBvbiB0aGUgZWxlbWVudHMgbmFtZWQgdGhlIHNhbWUgYXMgdGhlIGNsYXNzIG5hbWVzIChlLmcuIGBhbmltYXRlLWluYCkgd2hpY2ggbWF5IGJlIGxpc3RlbmVkXG4gKiB0byBpbiBvcmRlciB0byBjYW5jZWwgYW4gYW5pbWF0aW9uIG9yIHJlc3BvbmQgdG8gaXQuXG4gKlxuICogSWYgdGhlIG5vZGUgaGFzIG1ldGhvZHMgYGFuaW1hdGVJbihkb25lKWAsIGBhbmltYXRlT3V0KGRvbmUpYCwgYGFuaW1hdGVNb3ZlSW4oZG9uZSlgLCBvciBgYW5pbWF0ZU1vdmVPdXQoZG9uZSlgXG4gKiBkZWZpbmVkIG9uIHRoZW0gdGhlbiB0aGUgaGVscGVycyB3aWxsIGFsbG93IGFuIGFuaW1hdGlvbiBpbiBKYXZhU2NyaXB0IHRvIGJlIHJ1biBhbmQgd2FpdCBmb3IgdGhlIGBkb25lYCBmdW5jdGlvbiB0b1xuICogYmUgY2FsbGVkIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIEJlIHN1cmUgdG8gYWN0dWFsbHkgaGF2ZSBhbiBhbmltYXRpb24gZGVmaW5lZCBmb3IgZWxlbWVudHMgd2l0aCB0aGUgYGFuaW1hdGVgIGNsYXNzL2F0dHJpYnV0ZSBiZWNhdXNlIHRoZSBoZWxwZXJzIHVzZVxuICogdGhlIGB0cmFuc2l0aW9uZW5kYCBhbmQgYGFuaW1hdGlvbmVuZGAgZXZlbnRzIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGZpbmlzaGVkLCBhbmQgaWYgdGhlcmUgaXMgbm8gYW5pbWF0aW9uXG4gKiB0aGVzZSBldmVudHMgd2lsbCBuZXZlciBiZSB0cmlnZ2VyZWQgYW5kIHRoZSBvcGVyYXRpb24gd2lsbCBuZXZlciBjb21wbGV0ZS5cbiAqL1xuZnVuY3Rpb24gQW5pbWF0ZWRCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgdmFyIGVsZW1lbnQgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHZhciBhbmltYXRlID0gZWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2FuaW1hdGUnKTtcbiAgdmFyIGZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuXG4gIGlmIChhbmltYXRlICE9PSBudWxsKSB7XG4gICAgaWYgKGVsZW1lbnQubm9kZU5hbWUgPT09ICdURU1QTEFURScgfHwgZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1NDUklQVCcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGFuaW1hdGUgbXVsdGlwbGUgbm9kZXMgaW4gYSB0ZW1wbGF0ZSBvciBzY3JpcHQuIFJlbW92ZSB0aGUgW2FuaW1hdGVdIGF0dHJpYnV0ZS4nKTtcbiAgICB9XG5cbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQWxsb3cgbXVsdGlwbGUgYmluZGluZ3MgdG8gYW5pbWF0ZSBieSBub3QgcmVtb3ZpbmcgdW50aWwgdGhleSBoYXZlIGFsbCBiZWVuIGNyZWF0ZWRcbiAgICAgIGVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdhbmltYXRlJyk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFuaW1hdGUgPSB0cnVlO1xuXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCBhbmltYXRlKSkge1xuICAgICAgLy8gamF2YXNjcmlwdCBhbmltYXRpb25cbiAgICAgIHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbihhbmltYXRlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGFuaW1hdGVbMF0gPT09ICcuJykge1xuICAgICAgICAvLyBjbGFzcyBhbmltYXRpb25cbiAgICAgICAgdGhpcy5hbmltYXRlQ2xhc3NOYW1lID0gYW5pbWF0ZS5zbGljZSgxKTtcbiAgICAgIH0gZWxzZSBpZiAoYW5pbWF0ZSkge1xuICAgICAgICAvLyByZWdpc3RlcmVkIGFuaW1hdGlvblxuICAgICAgICB2YXIgYW5pbWF0ZU9iamVjdCA9IGZyYWdtZW50cy5nZXRBbmltYXRpb24oYW5pbWF0ZSk7XG4gICAgICAgIGlmICh0eXBlb2YgYW5pbWF0ZU9iamVjdCA9PT0gJ2Z1bmN0aW9uJykgYW5pbWF0ZU9iamVjdCA9IG5ldyBhbmltYXRlT2JqZWN0KHRoaXMpO1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSBhbmltYXRlT2JqZWN0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIEJpbmRpbmcuY2FsbCh0aGlzLCBwcm9wZXJ0aWVzKTtcbn1cblxuXG5CaW5kaW5nLmV4dGVuZChBbmltYXRlZEJpbmRpbmcsIHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgX3N1cGVyLmluaXQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVFeHByZXNzaW9uKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24sIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfVxuICB9LFxuXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09IGNvbnRleHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX3N1cGVyLmJpbmQuY2FsbCh0aGlzLCBjb250ZXh0KTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIuYmluZChjb250ZXh0KTtcbiAgICB9XG4gIH0sXG5cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci51bmJpbmQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIudW5iaW5kKCk7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBIZWxwZXIgbWV0aG9kIHRvIHJlbW92ZSBhIG5vZGUgZnJvbSB0aGUgRE9NLCBhbGxvd2luZyBmb3IgYW5pbWF0aW9ucyB0byBvY2N1ci4gYGNhbGxiYWNrYCB3aWxsIGJlIGNhbGxlZCB3aGVuXG4gICAqIGZpbmlzaGVkLlxuICAgKi9cbiAgYW5pbWF0ZU91dDogZnVuY3Rpb24obm9kZSwgZG9udERpc3Bvc2UsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBkb250RGlzcG9zZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBkb250RGlzcG9zZTtcbiAgICAgIGRvbnREaXNwb3NlID0gZmFsc2U7XG4gICAgfVxuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG5cbiAgICB0aGlzLmFuaW1hdGVOb2RlKCdvdXQnLCBub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghZG9udERpc3Bvc2UpIHtcbiAgICAgICAgbm9kZS52aWV3LmRpc3Bvc2UoKTtcbiAgICAgIH1cbiAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbCh0aGlzKTtcbiAgICB9KTtcbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byBpbnNlcnQgYSBub2RlIGluIHRoZSBET00gYmVmb3JlIGFub3RoZXIgbm9kZSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbFxuICAgKiBiZSBjYWxsZWQgd2hlbiBmaW5pc2hlZC4gSWYgYGJlZm9yZWAgaXMgbm90IHByb3ZpZGVkIHRoZW4gdGhlIGFuaW1hdGlvbiB3aWxsIGJlIHJ1biB3aXRob3V0IGluc2VydGluZyB0aGUgbm9kZS5cbiAgICovXG4gIGFuaW1hdGVJbjogZnVuY3Rpb24obm9kZSwgYmVmb3JlLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2YgYmVmb3JlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IGJlZm9yZTtcbiAgICAgIGJlZm9yZSA9IG51bGw7XG4gICAgfVxuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG4gICAgaWYgKGJlZm9yZSAmJiBiZWZvcmUuZmlyc3RWaWV3Tm9kZSkgYmVmb3JlID0gYmVmb3JlLmZpcnN0Vmlld05vZGU7XG5cbiAgICBpZiAoYmVmb3JlKSB7XG4gICAgICBiZWZvcmUucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUobm9kZSwgYmVmb3JlKTtcbiAgICB9XG4gICAgdGhpcy5hbmltYXRlTm9kZSgnaW4nLCBub2RlLCBjYWxsYmFjaywgdGhpcyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFsbG93IGFuIGVsZW1lbnQgdG8gdXNlIENTUzMgdHJhbnNpdGlvbnMgb3IgYW5pbWF0aW9ucyB0byBhbmltYXRlIGluIG9yIG91dCBvZiB0aGUgcGFnZS5cbiAgICovXG4gIGFuaW1hdGVOb2RlOiBmdW5jdGlvbihkaXJlY3Rpb24sIG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFuaW1hdGVPYmplY3QsIGNsYXNzTmFtZSwgbmFtZSwgd2lsbE5hbWUsIGRpZE5hbWUsIF90aGlzID0gdGhpcztcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYmplY3QgJiYgdHlwZW9mIHRoaXMuYW5pbWF0ZU9iamVjdCA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGFuaW1hdGVPYmplY3QgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFuaW1hdGVDbGFzc05hbWUpIHtcbiAgICAgIGNsYXNzTmFtZSA9IHRoaXMuYW5pbWF0ZUNsYXNzTmFtZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfVxuXG4gICAgaWYgKGFuaW1hdGVPYmplY3QpIHtcbiAgICAgIHZhciBkaXIgPSBkaXJlY3Rpb24gPT09ICdpbicgPyAnSW4nIDogJ091dCc7XG4gICAgICBuYW1lID0gJ2FuaW1hdGUnICsgZGlyO1xuICAgICAgd2lsbE5hbWUgPSAnd2lsbEFuaW1hdGUnICsgZGlyO1xuICAgICAgZGlkTmFtZSA9ICdkaWRBbmltYXRlJyArIGRpcjtcblxuICAgICAgYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZShub2RlKTtcblxuICAgICAgaWYgKGFuaW1hdGVPYmplY3Rbd2lsbE5hbWVdKSB7XG4gICAgICAgIGFuaW1hdGVPYmplY3Rbd2lsbE5hbWVdKG5vZGUpO1xuICAgICAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgICAgICBub2RlLm9mZnNldFdpZHRoID0gbm9kZS5vZmZzZXRXaWR0aDtcbiAgICAgIH1cblxuICAgICAgaWYgKGFuaW1hdGVPYmplY3RbbmFtZV0pIHtcbiAgICAgICAgYW5pbWF0ZU9iamVjdFtuYW1lXShub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAoYW5pbWF0ZU9iamVjdFtkaWROYW1lXSkgYW5pbWF0ZU9iamVjdFtkaWROYW1lXShub2RlKTtcbiAgICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwoX3RoaXMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbmFtZSA9ICdhbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgICB3aWxsTmFtZSA9ICd3aWxsLWFuaW1hdGUtJyArIGRpcmVjdGlvbjtcbiAgICAgIGlmIChjbGFzc05hbWUpIG5vZGUuY2xhc3NMaXN0LmFkZChjbGFzc05hbWUpO1xuXG4gICAgICBub2RlLmNsYXNzTGlzdC5hZGQod2lsbE5hbWUpO1xuXG4gICAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG4gICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUod2lsbE5hbWUpO1xuICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKG5hbWUpO1xuXG4gICAgICB2YXIgZHVyYXRpb24gPSBnZXREdXJhdGlvbi5jYWxsKHRoaXMsIG5vZGUsIGRpcmVjdGlvbik7XG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUobmFtZSk7XG4gICAgICAgIGlmIChjbGFzc05hbWUpIG5vZGUuY2xhc3NMaXN0LnJlbW92ZShjbGFzc05hbWUpO1xuICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwoX3RoaXMpO1xuICAgICAgfSwgZHVyYXRpb24pO1xuICAgIH1cbiAgfVxufSk7XG5cblxudmFyIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAndHJhbnNpdGlvbkR1cmF0aW9uJztcbnZhciB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3RyYW5zaXRpb25EZWxheSc7XG52YXIgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ2FuaW1hdGlvbkR1cmF0aW9uJztcbnZhciBhbmltYXRpb25EZWxheU5hbWUgPSAnYW5pbWF0aW9uRGVsYXknO1xudmFyIHN0eWxlID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlO1xuaWYgKHN0eWxlLnRyYW5zaXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlLndlYmtpdFRyYW5zaXRpb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAnd2Via2l0VHJhbnNpdGlvbkR1cmF0aW9uJztcbiAgdHJhbnNpdGlvbkRlbGF5TmFtZSA9ICd3ZWJraXRUcmFuc2l0aW9uRGVsYXknO1xufVxuaWYgKHN0eWxlLmFuaW1hdGlvbkR1cmF0aW9uID09PSB1bmRlZmluZWQgJiYgc3R5bGUud2Via2l0QW5pbWF0aW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICBhbmltYXRpb25EdXJhdGlvbk5hbWUgPSAnd2Via2l0QW5pbWF0aW9uRHVyYXRpb24nO1xuICBhbmltYXRpb25EZWxheU5hbWUgPSAnd2Via2l0QW5pbWF0aW9uRGVsYXknO1xufVxuXG5cbmZ1bmN0aW9uIGdldER1cmF0aW9uKG5vZGUsIGRpcmVjdGlvbikge1xuICB2YXIgbWlsbGlzZWNvbmRzID0gdGhpcy5jbG9uZWRGcm9tWydfX2FuaW1hdGlvbkR1cmF0aW9uJyArIGRpcmVjdGlvbl07XG4gIGlmICghbWlsbGlzZWNvbmRzKSB7XG4gICAgLy8gUmVjYWxjIGlmIG5vZGUgd2FzIG91dCBvZiBET00gYmVmb3JlIGFuZCBoYWQgMCBkdXJhdGlvbiwgYXNzdW1lIHRoZXJlIGlzIGFsd2F5cyBTT01FIGR1cmF0aW9uLlxuICAgIHZhciBzdHlsZXMgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcbiAgICB2YXIgc2Vjb25kcyA9IE1hdGgubWF4KHBhcnNlRmxvYXQoc3R5bGVzW3RyYW5zaXRpb25EdXJhdGlvbk5hbWVdIHx8IDApICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW3RyYW5zaXRpb25EZWxheU5hbWVdIHx8IDApLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbYW5pbWF0aW9uRHVyYXRpb25OYW1lXSB8fCAwKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1thbmltYXRpb25EZWxheU5hbWVdIHx8IDApKTtcbiAgICBtaWxsaXNlY29uZHMgPSBzZWNvbmRzICogMTAwMCB8fCAwO1xuICAgIHRoaXMuY2xvbmVkRnJvbS5fX2FuaW1hdGlvbkR1cmF0aW9uX18gPSBtaWxsaXNlY29uZHM7XG4gIH1cbiAgcmV0dXJuIG1pbGxpc2Vjb25kcztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gQmluZGluZztcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cbi8qKlxuICogQSBiaW5kaW5nIGlzIGEgbGluayBiZXR3ZWVuIGFuIGVsZW1lbnQgYW5kIHNvbWUgZGF0YS4gU3ViY2xhc3NlcyBvZiBCaW5kaW5nIGNhbGxlZCBiaW5kZXJzIGRlZmluZSB3aGF0IGEgYmluZGluZyBkb2VzXG4gKiB3aXRoIHRoYXQgbGluay4gSW5zdGFuY2VzIG9mIHRoZXNlIGJpbmRlcnMgYXJlIGNyZWF0ZWQgYXMgYmluZGluZ3Mgb24gdGVtcGxhdGVzLiBXaGVuIGEgdmlldyBpcyBzdGFtcGVkIG91dCBmcm9tIHRoZVxuICogdGVtcGxhdGUgdGhlIGJpbmRpbmcgaXMgXCJjbG9uZWRcIiAoaXQgaXMgYWN0dWFsbHkgZXh0ZW5kZWQgZm9yIHBlcmZvcm1hbmNlKSBhbmQgdGhlIGBlbGVtZW50YC9gbm9kZWAgcHJvcGVydHkgaXNcbiAqIHVwZGF0ZWQgdG8gdGhlIG1hdGNoaW5nIGVsZW1lbnQgaW4gdGhlIHZpZXcuXG4gKlxuICogIyMjIFByb3BlcnRpZXNcbiAqICAqIGVsZW1lbnQ6IFRoZSBlbGVtZW50IChvciB0ZXh0IG5vZGUpIHRoaXMgYmluZGluZyBpcyBib3VuZCB0b1xuICogICogbm9kZTogQWxpYXMgb2YgZWxlbWVudCwgc2luY2UgYmluZGluZ3MgbWF5IGFwcGx5IHRvIHRleHQgbm9kZXMgdGhpcyBpcyBtb3JlIGFjY3VyYXRlXG4gKiAgKiBuYW1lOiBUaGUgYXR0cmlidXRlIG9yIGVsZW1lbnQgbmFtZSAoZG9lcyBub3QgYXBwbHkgdG8gbWF0Y2hlZCB0ZXh0IG5vZGVzKVxuICogICogbWF0Y2g6IFRoZSBtYXRjaGVkIHBhcnQgb2YgdGhlIG5hbWUgZm9yIHdpbGRjYXJkIGF0dHJpYnV0ZXMgKGUuZy4gYG9uLSpgIG1hdGNoaW5nIGFnYWluc3QgYG9uLWNsaWNrYCB3b3VsZCBoYXZlIGFcbiAqICAgIG1hdGNoIHByb3BlcnR5IGVxdWFsbGluZyBgY2xpY2tgKS4gVXNlIGB0aGlzLmNhbWVsQ2FzZWAgdG8gZ2V0IHRoZSBtYXRjaCBwcm9lcnR5IGNhbWVsQ2FzZWQuXG4gKiAgKiBleHByZXNzaW9uOiBUaGUgZXhwcmVzc2lvbiB0aGlzIGJpbmRpbmcgd2lsbCB1c2UgZm9yIGl0cyB1cGRhdGVzIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIGVsZW1lbnRzKVxuICogICogY29udGV4dDogVGhlIGNvbnRleHQgdGhlIGV4cmVzc2lvbiBvcGVyYXRlcyB3aXRoaW4gd2hlbiBib3VuZFxuICovXG5mdW5jdGlvbiBCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgaWYgKCFwcm9wZXJ0aWVzLm5vZGUgfHwgIXByb3BlcnRpZXMudmlldykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IHJlY2VpdmUgYSBub2RlIGFuZCBhIHZpZXcnKTtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgYW5kIG5vZGUgYXJlIGFsaWFzZXNcbiAgdGhpcy5fZWxlbWVudFBhdGggPSBpbml0Tm9kZVBhdGgocHJvcGVydGllcy5ub2RlLCBwcm9wZXJ0aWVzLnZpZXcpO1xuICB0aGlzLm5vZGUgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHRoaXMuZWxlbWVudCA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5uYW1lID0gcHJvcGVydGllcy5uYW1lO1xuICB0aGlzLm1hdGNoID0gcHJvcGVydGllcy5tYXRjaDtcbiAgdGhpcy5leHByZXNzaW9uID0gcHJvcGVydGllcy5leHByZXNzaW9uO1xuICB0aGlzLmZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB0aGlzLmNvbXBpbGVkKCk7XG59XG5cbmV4dGVuZChCaW5kaW5nLCB7XG4gIC8qKlxuICAgKiBEZWZhdWx0IHByaW9yaXR5IGJpbmRlcnMgbWF5IG92ZXJyaWRlLlxuICAgKi9cbiAgcHJpb3JpdHk6IDAsXG5cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBhIGNsb25lZCBiaW5kaW5nLiBUaGlzIGhhcHBlbnMgYWZ0ZXIgYSBjb21waWxlZCBiaW5kaW5nIG9uIGEgdGVtcGxhdGUgaXMgY2xvbmVkIGZvciBhIHZpZXcuXG4gICAqL1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5leHByZXNzaW9uKSB7XG4gICAgICAvLyBBbiBvYnNlcnZlciB0byBvYnNlcnZlIHZhbHVlIGNoYW5nZXMgdG8gdGhlIGV4cHJlc3Npb24gd2l0aGluIGEgY29udGV4dFxuICAgICAgdGhpcy5vYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy51cGRhdGVkLCB0aGlzKTtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVkKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENsb25lIHRoaXMgYmluZGluZyBmb3IgYSB2aWV3LiBUaGUgZWxlbWVudC9ub2RlIHdpbGwgYmUgdXBkYXRlZCBhbmQgdGhlIGJpbmRpbmcgd2lsbCBiZSBpbml0ZWQuXG4gICAqL1xuICBjbG9uZUZvclZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IGNsb25lIGFnYWluc3QgYSB2aWV3Jyk7XG4gICAgfVxuXG4gICAgdmFyIG5vZGUgPSB2aWV3O1xuICAgIHRoaXMuX2VsZW1lbnRQYXRoLmZvckVhY2goZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkTm9kZXNbaW5kZXhdO1xuICAgIH0pO1xuXG4gICAgdmFyIGJpbmRpbmcgPSBPYmplY3QuY3JlYXRlKHRoaXMpO1xuICAgIGJpbmRpbmcuY2xvbmVkRnJvbSA9IHRoaXM7XG4gICAgYmluZGluZy5lbGVtZW50ID0gbm9kZTtcbiAgICBiaW5kaW5nLm5vZGUgPSBub2RlO1xuICAgIGJpbmRpbmcuaW5pdCgpO1xuICAgIHJldHVybiBiaW5kaW5nO1xuICB9LFxuXG5cbiAgLy8gQmluZCB0aGlzIHRvIHRoZSBnaXZlbiBjb250ZXh0IG9iamVjdFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikge1xuICAgICAgaWYgKHRoaXMudXBkYXRlZCAhPT0gQmluZGluZy5wcm90b3R5cGUudXBkYXRlZCkge1xuICAgICAgICB0aGlzLm9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICAvLyBzZXQgdGhlIGNvbnRleHQgYnV0IGRvbid0IGFjdHVhbGx5IGJpbmQgaXQgc2luY2UgYHVwZGF0ZWRgIGlzIGEgbm8tb3BcbiAgICAgICAgdGhpcy5vYnNlcnZlci5jb250ZXh0ID0gY29udGV4dDtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5ib3VuZCgpO1xuICB9LFxuXG5cbiAgLy8gVW5iaW5kIHRoaXMgZnJvbSBpdHMgY29udGV4dFxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB0aGlzLm9ic2VydmVyLnVuYmluZCgpO1xuICAgIHRoaXMudW5ib3VuZCgpO1xuICB9LFxuXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjb21waWxlZCB3aXRoaW4gYSB0ZW1wbGF0ZVxuICBjb21waWxlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcncyBlbGVtZW50IGlzIGNyZWF0ZWRcbiAgY3JlYXRlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGV4cHJlc3Npb24ncyB2YWx1ZSBjaGFuZ2VzXG4gIHVwZGF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nIGlzIGJvdW5kXG4gIGJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyB1bmJvdW5kXG4gIHVuYm91bmQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gSGVscGVyIG1ldGhvZHNcblxuICBnZXQgY2FtZWxDYXNlKCkge1xuICAgIHJldHVybiAodGhpcy5tYXRjaCB8fCB0aGlzLm5hbWUgfHwgJycpLnJlcGxhY2UoLy0rKFxcdykvZywgZnVuY3Rpb24oXywgY2hhcikge1xuICAgICAgcmV0dXJuIGNoYXIudG9VcHBlckNhc2UoKTtcbiAgICB9KTtcbiAgfSxcblxuICBvYnNlcnZlOiBmdW5jdGlvbihleHByZXNzaW9uLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLk9ic2VydmVyKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQgfHwgdGhpcyk7XG4gIH1cbn0pO1xuXG5cblxuXG52YXIgaW5kZXhPZiA9IEFycmF5LnByb3RvdHlwZS5pbmRleE9mO1xuXG4vLyBDcmVhdGVzIGFuIGFycmF5IG9mIGluZGV4ZXMgdG8gaGVscCBmaW5kIHRoZSBzYW1lIGVsZW1lbnQgd2l0aGluIGEgY2xvbmVkIHZpZXdcbmZ1bmN0aW9uIGluaXROb2RlUGF0aChub2RlLCB2aWV3KSB7XG4gIHZhciBwYXRoID0gW107XG4gIHdoaWxlIChub2RlICE9PSB2aWV3KSB7XG4gICAgdmFyIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcbiAgICBwYXRoLnVuc2hpZnQoaW5kZXhPZi5jYWxsKHBhcmVudC5jaGlsZE5vZGVzLCBub2RlKSk7XG4gICAgbm9kZSA9IHBhcmVudDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cbiIsInZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gY29tcGlsZTtcblxuXG4vLyBXYWxrcyB0aGUgdGVtcGxhdGUgRE9NIHJlcGxhY2luZyBhbnkgYmluZGluZ3MgYW5kIGNhY2hpbmcgYmluZGluZ3Mgb250byB0aGUgdGVtcGxhdGUgb2JqZWN0LlxuZnVuY3Rpb24gY29tcGlsZShmcmFnbWVudHMsIHRlbXBsYXRlKSB7XG4gIHZhciB3YWxrZXIgPSBkb2N1bWVudC5jcmVhdGVUcmVlV2Fsa2VyKHRlbXBsYXRlLCBOb2RlRmlsdGVyLlNIT1dfRUxFTUVOVCB8IE5vZGVGaWx0ZXIuU0hPV19URVhUKTtcbiAgdmFyIGJpbmRpbmdzID0gdGVtcGxhdGUuYmluZGluZ3MgPSBbXSwgY3VycmVudE5vZGUsIHBhcmVudE5vZGUsIHByZXZpb3VzTm9kZTtcblxuICAvLyBSZXNldCBmaXJzdCBub2RlIHRvIGVuc3VyZSBpdCBpc24ndCBhIGZyYWdtZW50XG4gIHdhbGtlci5uZXh0Tm9kZSgpO1xuICB3YWxrZXIucHJldmlvdXNOb2RlKCk7XG5cbiAgLy8gZmluZCBiaW5kaW5ncyBmb3IgZWFjaCBub2RlXG4gIGRvIHtcbiAgICBjdXJyZW50Tm9kZSA9IHdhbGtlci5jdXJyZW50Tm9kZTtcbiAgICBwYXJlbnROb2RlID0gY3VycmVudE5vZGUucGFyZW50Tm9kZTtcbiAgICBiaW5kaW5ncy5wdXNoLmFwcGx5KGJpbmRpbmdzLCBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBjdXJyZW50Tm9kZSwgdGVtcGxhdGUpKTtcblxuICAgIGlmIChjdXJyZW50Tm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnROb2RlKSB7XG4gICAgICAvLyBjdXJyZW50Tm9kZSB3YXMgcmVtb3ZlZCBhbmQgbWFkZSBhIHRlbXBsYXRlXG4gICAgICB3YWxrZXIuY3VycmVudE5vZGUgPSBwcmV2aW91c05vZGUgfHwgd2Fsa2VyLnJvb3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZXZpb3VzTm9kZSA9IGN1cnJlbnROb2RlO1xuICAgIH1cbiAgfSB3aGlsZSAod2Fsa2VyLm5leHROb2RlKCkpO1xuXG4gIHJldHVybiB0ZW1wbGF0ZTtcbn1cblxuXG5cbi8vIEZpbmQgYWxsIHRoZSBiaW5kaW5ncyBvbiBhIGdpdmVuIG5vZGUgKHRleHQgbm9kZXMgd2lsbCBvbmx5IGV2ZXIgaGF2ZSBvbmUgYmluZGluZykuXG5mdW5jdGlvbiBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBub2RlLCB2aWV3KSB7XG4gIHZhciBiaW5kaW5ncyA9IFtdO1xuICB2YXIgQmluZGVyLCBleHByLCBib3VuZCwgbWF0Y2gsIGF0dHIsIGk7XG5cbiAgaWYgKG5vZGUubm9kZVR5cGUgPT09IE5vZGUuVEVYVF9OT0RFKSB7XG4gICAgc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIHRleHQgbm9kZVxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgndGV4dCcsIG5vZGUubm9kZVZhbHVlKSkge1xuICAgICAgZXhwciA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpO1xuICAgICAgbm9kZS5ub2RlVmFsdWUgPSAnJztcbiAgICAgIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCd0ZXh0JywgZXhwcik7XG4gICAgICBiaW5kaW5ncy5wdXNoKG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBleHByZXNzaW9uOiBleHByLCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KSk7XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIHRoZSBlbGVtZW50IGlzIHJlbW92ZWQgZnJvbSB0aGUgRE9NLCBzdG9wLiBDaGVjayBieSBsb29raW5nIGF0IGl0cyBwYXJlbnROb2RlXG4gICAgdmFyIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcblxuICAgIC8vIEZpbmQgYW55IGJpbmRpbmcgZm9yIHRoZSBlbGVtZW50XG4gICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2VsZW1lbnQnLCBub2RlLnRhZ05hbWUudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKEJpbmRlcikge1xuICAgICAgYmluZGluZ3MucHVzaChuZXcgQmluZGVyKHsgbm9kZTogbm9kZSwgdmlldzogdmlldywgZnJhZ21lbnRzOiBmcmFnbWVudHMgfSkpO1xuICAgIH1cblxuICAgIC8vIElmIHJlbW92ZWQsIG1hZGUgYSB0ZW1wbGF0ZSwgZG9uJ3QgY29udGludWUgcHJvY2Vzc2luZ1xuICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHBhcmVudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEZpbmQgYW5kIGFkZCBhbnkgYXR0cmlidXRlIGJpbmRpbmdzIG9uIGFuIGVsZW1lbnQuIFRoZXNlIGNhbiBiZSBhdHRyaWJ1dGVzIHdob3NlIG5hbWUgbWF0Y2hlcyBhIGJpbmRpbmcsIG9yXG4gICAgLy8gdGhleSBjYW4gYmUgYXR0cmlidXRlcyB3aGljaCBoYXZlIGEgYmluZGluZyBpbiB0aGUgdmFsdWUgc3VjaCBhcyBgaHJlZj1cIi9wb3N0L3t7IHBvc3QuaWQgfX1cImAuXG4gICAgdmFyIGJvdW5kID0gW107XG4gICAgdmFyIGF0dHJpYnV0ZXMgPSBzbGljZS5jYWxsKG5vZGUuYXR0cmlidXRlcyk7XG4gICAgZm9yIChpID0gMCwgbCA9IGF0dHJpYnV0ZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICB2YXIgYXR0ciA9IGF0dHJpYnV0ZXNbaV07XG4gICAgICB2YXIgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2F0dHJpYnV0ZScsIGF0dHIubmFtZSwgYXR0ci52YWx1ZSk7XG4gICAgICBpZiAoQmluZGVyKSB7XG4gICAgICAgIGJvdW5kLnB1c2goWyBCaW5kZXIsIGF0dHIgXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTWFrZSBzdXJlIHRvIGNyZWF0ZSBhbmQgcHJvY2VzcyB0aGVtIGluIHRoZSBjb3JyZWN0IHByaW9yaXR5IG9yZGVyIHNvIGlmIGEgYmluZGluZyBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tIHRoZVxuICAgIC8vIG5vZGUgaXQgZG9lc24ndCBwcm9jZXNzIHRoZSBvdGhlcnMuXG4gICAgYm91bmQuc29ydChzb3J0QXR0cmlidXRlcyk7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgYm91bmQubGVuZ3RoOyBpKyspIHtcbiAgICAgIHZhciBCaW5kZXIgPSBib3VuZFtpXVswXTtcbiAgICAgIHZhciBhdHRyID0gYm91bmRbaV1bMV07XG4gICAgICB2YXIgbmFtZSA9IGF0dHIubmFtZTtcbiAgICAgIHZhciB2YWx1ZSA9IGF0dHIudmFsdWU7XG4gICAgICBpZiAoQmluZGVyLmV4cHIpIHtcbiAgICAgICAgdmFyIG1hdGNoID0gbmFtZS5tYXRjaChCaW5kZXIuZXhwcik7XG4gICAgICAgIGlmIChtYXRjaCkgbWF0Y2ggPSBtYXRjaFsxXTtcbiAgICAgIH1cbiAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlTm9kZShhdHRyKTtcblxuICAgICAgYmluZGluZ3MucHVzaChuZXcgQmluZGVyKHtcbiAgICAgICAgbm9kZTogbm9kZSxcbiAgICAgICAgdmlldzogdmlldyxcbiAgICAgICAgbmFtZTogbmFtZSxcbiAgICAgICAgbWF0Y2g6IG1hdGNoLFxuICAgICAgICBleHByZXNzaW9uOiBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgdmFsdWUpLFxuICAgICAgICBmcmFnbWVudHM6IGZyYWdtZW50c1xuICAgICAgfSkpO1xuXG4gICAgICBpZiAobm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJpbmRpbmdzO1xufVxuXG5cbi8vIFNwbGl0cyB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSBzbyB0aGV5IGNhbiBiZSBib3VuZCBpbmRpdmlkdWFsbHksIGhhcyBwYXJlbnROb2RlIHBhc3NlZCBpbiBzaW5jZSBpdCBtYXlcbi8vIGJlIGEgZG9jdW1lbnQgZnJhZ21lbnQgd2hpY2ggYXBwZWFycyBhcyBudWxsIG9uIG5vZGUucGFyZW50Tm9kZS5cbmZ1bmN0aW9uIHNwbGl0VGV4dE5vZGUoZnJhZ21lbnRzLCBub2RlKSB7XG4gIGlmICghbm9kZS5wcm9jZXNzZWQpIHtcbiAgICBub2RlLnByb2Nlc3NlZCA9IHRydWU7XG4gICAgdmFyIHJlZ2V4ID0gZnJhZ21lbnRzLmJpbmRlcnMudGV4dC5fZXhwcjtcbiAgICB2YXIgY29udGVudCA9IG5vZGUubm9kZVZhbHVlO1xuICAgIGlmIChjb250ZW50Lm1hdGNoKHJlZ2V4KSkge1xuICAgICAgdmFyIG1hdGNoLCBsYXN0SW5kZXggPSAwLCBwYXJ0cyA9IFtdLCBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChtYXRjaCA9IHJlZ2V4LmV4ZWMoY29udGVudCkpIHtcbiAgICAgICAgcGFydHMucHVzaChjb250ZW50LnNsaWNlKGxhc3RJbmRleCwgcmVnZXgubGFzdEluZGV4IC0gbWF0Y2hbMF0ubGVuZ3RoKSk7XG4gICAgICAgIHBhcnRzLnB1c2gobWF0Y2hbMF0pO1xuICAgICAgICBsYXN0SW5kZXggPSByZWdleC5sYXN0SW5kZXg7XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4KSk7XG4gICAgICBwYXJ0cyA9IHBhcnRzLmZpbHRlcihub3RFbXB0eSk7XG5cbiAgICAgIG5vZGUubm9kZVZhbHVlID0gcGFydHNbMF07XG4gICAgICBmb3IgKHZhciBpID0gMTsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBuZXdUZXh0Tm9kZSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHBhcnRzW2ldKTtcbiAgICAgICAgbmV3VGV4dE5vZGUucHJvY2Vzc2VkID0gdHJ1ZTtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobmV3VGV4dE5vZGUpO1xuICAgICAgfVxuICAgICAgbm9kZS5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbm9kZS5uZXh0U2libGluZyk7XG4gICAgfVxuICB9XG59XG5cblxuZnVuY3Rpb24gc29ydEF0dHJpYnV0ZXMoYSwgYikge1xuICByZXR1cm4gYlswXS5wcm90b3R5cGUucHJpb3JpdHkgLSBhWzBdLnByb3RvdHlwZS5wcmlvcml0eTtcbn1cblxuZnVuY3Rpb24gbm90RW1wdHkodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBGcmFnbWVudHM7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xudmFyIHRvRnJhZ21lbnQgPSByZXF1aXJlKCcuL3V0aWwvdG9GcmFnbWVudCcpO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIEFuaW1hdGVkQmluZGluZyA9IHJlcXVpcmUoJy4vYW5pbWF0ZWRCaW5kaW5nJyk7XG52YXIgY29tcGlsZSA9IHJlcXVpcmUoJy4vY29tcGlsZScpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEJpbmRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYmluZGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEZvcm1hdHRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvZm9ybWF0dGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEFuaW1hdGlvbnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucycpO1xuXG4vKipcbiAqIEEgRnJhZ21lbnRzIG9iamVjdCBzZXJ2ZXMgYXMgYSByZWdpc3RyeSBmb3IgYmluZGVycyBhbmQgZm9ybWF0dGVyc1xuICogQHBhcmFtIHtbdHlwZV19IE9ic2VydmVyQ2xhc3MgW2Rlc2NyaXB0aW9uXVxuICovXG5mdW5jdGlvbiBGcmFnbWVudHMoT2JzZXJ2ZXJDbGFzcykge1xuICBpZiAoIU9ic2VydmVyQ2xhc3MpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNdXN0IHByb3ZpZGUgYW4gT2JzZXJ2ZXIgY2xhc3MgdG8gRnJhZ21lbnRzLicpO1xuICB9XG5cbiAgdGhpcy5PYnNlcnZlciA9IE9ic2VydmVyQ2xhc3M7XG4gIHRoaXMuZm9ybWF0dGVycyA9IE9ic2VydmVyQ2xhc3MuZm9ybWF0dGVycyA9IHt9O1xuICB0aGlzLmFuaW1hdGlvbnMgPSB7fTtcblxuICB0aGlzLmJpbmRlcnMgPSB7XG4gICAgZWxlbWVudDogeyBfd2lsZGNhcmRzOiBbXSB9LFxuICAgIGF0dHJpYnV0ZTogeyBfd2lsZGNhcmRzOiBbXSwgX2V4cHI6IC97eyguKj8pfX0vZyB9LFxuICAgIHRleHQ6IHsgX3dpbGRjYXJkczogW10sIF9leHByOiAve3soLio/KX19L2cgfVxuICB9O1xuXG4gIC8vIFRleHQgYmluZGVyIGZvciB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyVGV4dCgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSAhPSBudWxsKSA/IHZhbHVlIDogJyc7XG4gIH0pO1xuXG4gIC8vIENhdGNoYWxsIGF0dHJpYnV0ZSBiaW5kZXIgZm9yIHJlZ3VsYXIgYXR0cmlidXRlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlckF0dHJpYnV0ZSgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKHRoaXMubmFtZSwgdmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMubmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZWdpc3RlckRlZmF1bHRCaW5kZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zKHRoaXMpO1xufVxuXG5GcmFnbWVudHMucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gICAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gICAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gICAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gICAqL1xuICBjcmVhdGVUZW1wbGF0ZTogZnVuY3Rpb24oaHRtbCkge1xuICAgIHZhciBmcmFnbWVudCA9IHRvRnJhZ21lbnQoaHRtbCk7XG4gICAgaWYgKGZyYWdtZW50LmNoaWxkTm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tICcgKyBodG1sKTtcbiAgICB9XG4gICAgdmFyIHRlbXBsYXRlID0gZXh0ZW5kLm1ha2UoVGVtcGxhdGUsIGZyYWdtZW50KTtcbiAgICBjb21waWxlKHRoaXMsIHRlbXBsYXRlKTtcbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYmluZGluZ3Mgb24gYW4gZWxlbWVudC5cbiAgICovXG4gIGNvbXBpbGVFbGVtZW50OiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgcmV0dXJuIGNvbXBpbGUodGhpcywgZWxlbWVudCk7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYW5kIGJpbmRzIGFuIGVsZW1lbnQgd2hpY2ggd2FzIG5vdCBjcmVhdGVkIGZyb20gYSB0ZW1wbGF0ZS4gTW9zdGx5IG9ubHkgdXNlZCBmb3IgYmluZGluZyB0aGUgZG9jdW1lbnQnc1xuICAgKiBodG1sIGVsZW1lbnQuXG4gICAqL1xuICBiaW5kRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCwgY29udGV4dCkge1xuICAgIHRoaXMuY29tcGlsZUVsZW1lbnQoZWxlbWVudCk7XG5cbiAgICAvLyBpbml0aWFsaXplIGFsbCB0aGUgYmluZGluZ3MgZmlyc3QgYmVmb3JlIGJpbmRpbmcgdGhlbSB0byB0aGUgY29udGV4dFxuICAgIGVsZW1lbnQuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmluaXQoKTtcbiAgICB9KTtcblxuICAgIGVsZW1lbnQuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmJpbmQoY29udGV4dCk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYmluZGVyIGZvciBhIGdpdmVuIHR5cGUgYW5kIG5hbWUuIEEgYmluZGVyIGlzIGEgc3ViY2xhc3Mgb2YgQmluZGluZyBhbmQgaXMgdXNlZCB0byBjcmVhdGUgYmluZGluZ3Mgb25cbiAgICogYW4gZWxlbWVudCBvciB0ZXh0IG5vZGUgd2hvc2UgdGFnIG5hbWUsIGF0dHJpYnV0ZSBuYW1lLCBvciBleHByZXNzaW9uIGNvbnRlbnRzIG1hdGNoIHRoaXMgYmluZGVyJ3MgbmFtZS9leHByZXNzaW9uLlxuICAgKlxuICAgKiAjIyMgUGFyYW1ldGVyc1xuICAgKlxuICAgKiAgKiBgdHlwZWA6IHRoZXJlIGFyZSB0aHJlZSB0eXBlcyBvZiBiaW5kZXJzOiBlbGVtZW50LCBhdHRyaWJ1dGUsIG9yIHRleHQuIFRoZXNlIGNvcnJlc3BvbmQgdG8gbWF0Y2hpbmcgYWdhaW5zdCBhblxuICAgKiAgICBlbGVtZW50J3MgdGFnIG5hbWUsIGFuIGVsZW1lbnQgd2l0aCB0aGUgZ2l2ZW4gYXR0cmlidXRlIG5hbWUsIG9yIGEgdGV4dCBub2RlIHRoYXQgbWF0Y2hlcyB0aGUgcHJvdmlkZWRcbiAgICogICAgZXhwcmVzc2lvbi5cbiAgICpcbiAgICogICogYG5hbWVgOiB0byBtYXRjaCwgYSBiaW5kZXIgbmVlZHMgdGhlIG5hbWUgb2YgYW4gZWxlbWVudCBvciBhdHRyaWJ1dGUsIG9yIGEgcmVndWxhciBleHByZXNzaW9uIHRoYXQgbWF0Y2hlcyBhXG4gICAqICAgIGdpdmVuIHRleHQgbm9kZS4gTmFtZXMgZm9yIGVsZW1lbnRzIGFuZCBhdHRyaWJ1dGVzIGNhbiBiZSByZWd1bGFyIGV4cHJlc3Npb25zIGFzIHdlbGwsIG9yIHRoZXkgbWF5IGJlIHdpbGRjYXJkXG4gICAqICAgIG5hbWVzIGJ5IHVzaW5nIGFuIGFzdGVyaXNrLlxuICAgKlxuICAgKiAgKiBgZGVmaW5pdGlvbmA6IGEgYmluZGVyIGlzIGEgc3ViY2xhc3Mgb2YgQmluZGluZyB3aGljaCBvdmVycmlkZXMga2V5IG1ldGhvZHMsIGBjb21waWxlZGAsIGBjcmVhdGVkYCwgYHVwZGF0ZWRgLFxuICAgKiAgICBgYm91bmRgLCBhbmQgYHVuYm91bmRgLiBUaGUgZGVmaW5pdGlvbiBtYXkgYmUgYW4gYWN0dWFsIHN1YmNsYXNzIG9mIEJpbmRpbmcgb3IgaXQgbWF5IGJlIGFuIG9iamVjdCB3aGljaCB3aWxsIGJlXG4gICAqICAgIHVzZWQgZm9yIHRoZSBwcm90b3R5cGUgb2YgdGhlIG5ld2x5IGNyZWF0ZWQgc3ViY2xhc3MuIEZvciBtYW55IGJpbmRpbmdzIG9ubHkgdGhlIGB1cGRhdGVkYCBtZXRob2QgaXMgb3ZlcnJpZGRlbixcbiAgICogICAgc28gYnkganVzdCBwYXNzaW5nIGluIGEgZnVuY3Rpb24gZm9yIGBkZWZpbml0aW9uYCB0aGUgYmluZGVyIHdpbGwgYmUgY3JlYXRlZCB3aXRoIHRoYXQgYXMgaXRzIGB1cGRhdGVkYCBtZXRob2QuXG4gICAqXG4gICAqICMjIyBFeHBsYWluYXRpb24gb2YgcHJvcGVydGllcyBhbmQgbWV0aG9kc1xuICAgKlxuICAgKiAgICogYHByaW9yaXR5YCBtYXkgYmUgZGVmaW5lZCBhcyBudW1iZXIgdG8gaW5zdHJ1Y3Qgc29tZSBiaW5kZXJzIHRvIGJlIHByb2Nlc3NlZCBiZWZvcmUgb3RoZXJzLiBCaW5kZXJzIHdpdGhcbiAgICogICBoaWdoZXIgcHJpb3JpdHkgYXJlIHByb2Nlc3NlZCBmaXJzdC5cbiAgICpcbiAgICogICAqIGBhbmltYXRlZGAgY2FuIGJlIHNldCB0byBgdHJ1ZWAgdG8gZXh0ZW5kIHRoZSBBbmltYXRlZEJpbmRpbmcgY2xhc3Mgd2hpY2ggcHJvdmlkZXMgc3VwcG9ydCBmb3IgYW5pbWF0aW9uIHdoZW5cbiAgICogICBpbnNlcnRpbmdhbmQgcmVtb3Zpbmcgbm9kZXMgZnJvbSB0aGUgRE9NLiBUaGUgYGFuaW1hdGVkYCBwcm9wZXJ0eSBvbmx5ICphbGxvd3MqIGFuaW1hdGlvbiBidXQgdGhlIGVsZW1lbnQgbXVzdFxuICAgKiAgIGhhdmUgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgdG8gdXNlIGFuaW1hdGlvbi4gQSBiaW5kaW5nIHdpbGwgaGF2ZSB0aGUgYGFuaW1hdGVgIHByb3BlcnR5IHNldCB0byB0cnVlIHdoZW4gaXQgaXNcbiAgICogICB0byBiZSBhbmltYXRlZC4gQmluZGVycyBzaG91bGQgaGF2ZSBmYXN0IHBhdGhzIGZvciB3aGVuIGFuaW1hdGlvbiBpcyBub3QgdXNlZCByYXRoZXIgdGhhbiBhc3N1bWluZyBhbmltYXRpb24gd2lsbFxuICAgKiAgIGJlIHVzZWQuXG4gICAqXG4gICAqIEJpbmRlcnNcbiAgICpcbiAgICogQSBiaW5kZXIgY2FuIGhhdmUgNSBtZXRob2RzIHdoaWNoIHdpbGwgYmUgY2FsbGVkIGF0IHZhcmlvdXMgcG9pbnRzIGluIGEgYmluZGluZydzIGxpZmVjeWNsZS4gTWFueSBiaW5kZXJzIHdpbGxcbiAgICogb25seSB1c2UgdGhlIGB1cGRhdGVkKHZhbHVlKWAgbWV0aG9kLCBzbyBjYWxsaW5nIHJlZ2lzdGVyIHdpdGggYSBmdW5jdGlvbiBpbnN0ZWFkIG9mIGFuIG9iamVjdCBhcyBpdHMgdGhpcmRcbiAgICogcGFyYW1ldGVyIGlzIGEgc2hvcnRjdXQgdG8gY3JlYXRpbmcgYSBiaW5kZXIgd2l0aCBqdXN0IGFuIGB1cGRhdGVgIG1ldGhvZC5cbiAgICpcbiAgICogTGlzdGVkIGluIG9yZGVyIG9mIHdoZW4gdGhleSBvY2N1ciBpbiBhIGJpbmRpbmcncyBsaWZlY3ljbGU6XG4gICAqXG4gICAqICAgKiBgY29tcGlsZWQob3B0aW9ucylgIGlzIGNhbGxlZCB3aGVuIGZpcnN0IGNyZWF0aW5nIGEgYmluZGluZyBkdXJpbmcgdGhlIHRlbXBsYXRlIGNvbXBpbGF0aW9uIHByb2Nlc3MgYW5kIHJlY2VpdmVzXG4gICAqIHRoZSBgb3B0aW9uc2Agb2JqZWN0IHRoYXQgd2lsbCBiZSBwYXNzZWQgaW50byBgbmV3IEJpbmRpbmcob3B0aW9ucylgLiBUaGlzIGNhbiBiZSB1c2VkIGZvciBjcmVhdGluZyB0ZW1wbGF0ZXMsXG4gICAqIG1vZGlmeWluZyB0aGUgRE9NIChvbmx5IHN1YnNlcXVlbnQgRE9NIHRoYXQgaGFzbid0IGFscmVhZHkgYmVlbiBwcm9jZXNzZWQpIGFuZCBvdGhlciB0aGluZ3MgdGhhdCBzaG91bGQgYmVcbiAgICogYXBwbGllZCBhdCBjb21waWxlIHRpbWUgYW5kIG5vdCBkdXBsaWNhdGVkIGZvciBlYWNoIHZpZXcgY3JlYXRlZC5cbiAgICpcbiAgICogICAqIGBjcmVhdGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIGEgbmV3IHZpZXcgaXMgY3JlYXRlZC4gVGhpcyBjYW4gYmUgdXNlZCB0byBhZGQgZXZlbnQgbGlzdGVuZXJzIG9uIHRoZVxuICAgKiBlbGVtZW50IG9yIGRvIG90aGVyIHRoaW5ncyB0aGF0IHdpbGwgcGVyc2lzdGUgd2l0aCB0aGUgdmlldyB0aHJvdWdoIGl0cyBtYW55IHVzZXMuIFZpZXdzIG1heSBnZXQgcmV1c2VkIHNvIGRvbid0XG4gICAqIGRvIGFueXRoaW5nIGhlcmUgdG8gdGllIGl0IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICpcbiAgICogICAqIGBhdHRhY2hlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiB0aGUgdmlldyBpcyBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQgYW5kIGluc2VydGVkIGludG8gdGhlIERPTS4gVGhpc1xuICAgKiBjYW4gYmUgdXNlZCB0byBoYW5kbGUgY29udGV4dC1zcGVjaWZpYyBhY3Rpb25zLCBhZGQgbGlzdGVuZXJzIHRvIHRoZSB3aW5kb3cgb3IgZG9jdW1lbnQgKHRvIGJlIHJlbW92ZWQgaW5cbiAgICogYGRldGFjaGVkYCEpLCBldGMuXG4gICAqXG4gICAqICAgKiBgdXBkYXRlZCh2YWx1ZSwgb2xkVmFsdWUsIGNoYW5nZVJlY29yZHMpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbmV2ZXIgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHdpdGhpblxuICAgKiB0aGUgYXR0cmlidXRlIGNoYW5nZXMuIEZvciBleGFtcGxlLCBgYmluZC10ZXh0PVwie3t1c2VybmFtZX19XCJgIHdpbGwgdHJpZ2dlciBgdXBkYXRlZGAgd2l0aCB0aGUgdmFsdWUgb2YgdXNlcm5hbWVcbiAgICogd2hlbmV2ZXIgaXQgY2hhbmdlcyBvbiB0aGUgZ2l2ZW4gY29udGV4dC4gV2hlbiB0aGUgdmlldyBpcyByZW1vdmVkIGB1cGRhdGVkYCB3aWxsIGJlIHRyaWdnZXJlZCB3aXRoIGEgdmFsdWUgb2ZcbiAgICogYHVuZGVmaW5lZGAgaWYgdGhlIHZhbHVlIHdhcyBub3QgYWxyZWFkeSBgdW5kZWZpbmVkYCwgZ2l2aW5nIGEgY2hhbmNlIHRvIFwicmVzZXRcIiB0byBhbiBlbXB0eSBzdGF0ZS5cbiAgICpcbiAgICogICAqIGBkZXRhY2hlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiB0aGUgdmlldyBpcyB1bmJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBET00uIFRoaXNcbiAgICogY2FuIGJlIHVzZWQgdG8gY2xlYW4gdXAgYW55dGhpbmcgZG9uZSBpbiBgYXR0YWNoZWQoKWAgb3IgaW4gYHVwZGF0ZWQoKWAgYmVmb3JlIGJlaW5nIHJlbW92ZWQuXG4gICAqXG4gICAqIEVsZW1lbnQgYW5kIGF0dHJpYnV0ZSBiaW5kZXJzIHdpbGwgYXBwbHkgd2hlbmV2ZXIgdGhlIHRhZyBuYW1lIG9yIGF0dHJpYnV0ZSBuYW1lIGlzIG1hdGNoZWQuIEluIHRoZSBjYXNlIG9mXG4gICAqIGF0dHJpYnV0ZSBiaW5kZXJzIGlmIHlvdSBvbmx5IHdhbnQgaXQgdG8gbWF0Y2ggd2hlbiBleHByZXNzaW9ucyBhcmUgdXNlZCB3aXRoaW4gdGhlIGF0dHJpYnV0ZSwgYWRkIGBvbmx5V2hlbkJvdW5kYFxuICAgKiB0byB0aGUgZGVmaW5pdGlvbi4gT3RoZXJ3aXNlIHRoZSBiaW5kZXIgd2lsbCBtYXRjaCBhbmQgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHdpbGwgc2ltcGx5IGJlIGEgc3RyaW5nIHRoYXRcbiAgICogb25seSBjYWxscyB1cGRhdGVkIG9uY2Ugc2luY2UgaXQgd2lsbCBub3QgY2hhbmdlLlxuICAgKlxuICAgKiBOb3RlLCBhdHRyaWJ1dGVzIHdoaWNoIG1hdGNoIGEgYmluZGVyIGFyZSByZW1vdmVkIGR1cmluZyBjb21waWxlLiBUaGV5IGFyZSBjb25zaWRlcmVkIHRvIGJlIGJpbmRpbmcgZGVmaW5pdGlvbnMgYW5kXG4gICAqIG5vdCBwYXJ0IG9mIHRoZSBlbGVtZW50LiBCaW5kaW5ncyBtYXkgc2V0IHRoZSBhdHRyaWJ1dGUgd2hpY2ggc2VydmVkIGFzIHRoZWlyIGRlZmluaXRpb24gaWYgZGVzaXJlZC5cbiAgICpcbiAgICogIyMjIERlZmF1bHRzXG4gICAqXG4gICAqIFRoZXJlIGFyZSBkZWZhdWx0IGJpbmRlcnMgZm9yIGF0dHJpYnV0ZSBhbmQgdGV4dCBub2RlcyB3aGljaCBhcHBseSB3aGVuIG5vIG90aGVyIGJpbmRlcnMgbWF0Y2guIFRoZXkgb25seSBhcHBseSB0b1xuICAgKiBhdHRyaWJ1dGVzIGFuZCB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSAoZS5nLiBge3tmb299fWApLiBUaGUgZGVmYXVsdCBpcyB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvciB0ZXh0XG4gICAqIG5vZGUncyB2YWx1ZSB0byB0aGUgcmVzdWx0IG9mIHRoZSBleHByZXNzaW9uLiBJZiB5b3Ugd2FudGVkIHRvIG92ZXJyaWRlIHRoaXMgZGVmYXVsdCB5b3UgbWF5IHJlZ2lzdGVyIGEgYmluZGVyIHdpdGhcbiAgICogdGhlIG5hbWUgYFwiX19kZWZhdWx0X19cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKiBUaGlzIGJpbmRpbmcgaGFuZGxlciBhZGRzIHBpcmF0ZWl6ZWQgdGV4dCB0byBhbiBlbGVtZW50LlxuICAgKiBgYGBqYXZhc2NyaXB0XG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyQXR0cmlidXRlKCdteS1waXJhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB7XG4gICAqICAgICB2YWx1ZSA9ICcnO1xuICAgKiAgIH0gZWxzZSB7XG4gICAqICAgICB2YWx1ZSA9IHZhbHVlXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXEJpbmdcXGIvZywgXCJpbidcIilcbiAgICogICAgICAgLnJlcGxhY2UoL1xcYnRvXFxiL2csIFwidCdcIilcbiAgICogICAgICAgLnJlcGxhY2UoL1xcYnlvdVxcYi8sICd5ZScpXG4gICAqICAgICAgICsgJyBBcnJyciEnO1xuICAgKiAgIH1cbiAgICogICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgICogfSk7XG4gICAqIGBgYFxuICAgKlxuICAgKiBgYGBodG1sXG4gICAqIDxwIG15LXBpcmF0ZT1cInt7cG9zdC5ib2R5fX1cIj5UaGlzIHRleHQgd2lsbCBiZSByZXBsYWNlZC48L3A+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyVGV4dDogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCd0ZXh0JywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgdmFyIGJpbmRlciwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXVxuICAgIHZhciBzdXBlckNsYXNzID0gZGVmaW5pdGlvbi5hbmltYXRlZCA/IEFuaW1hdGVkQmluZGluZyA6IEJpbmRpbmc7XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmluaXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkZWZpbml0aW9uLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgc3VwZXJDbGFzcyA9IGRlZmluaXRpb247XG4gICAgICAgIGRlZmluaXRpb24gPSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlZmluaXRpb24gPSB7IHVwZGF0ZWQ6IGRlZmluaXRpb24gfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIChvciBhbm90aGVyIGJpbmRlcikgd2l0aCB0aGUgZGVmaW5pdGlvblxuICAgIGZ1bmN0aW9uIEJpbmRlcigpIHtcbiAgICAgIHN1cGVyQ2xhc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gICAgZGVmaW5pdGlvbi5PYnNlcnZlciA9IHRoaXMuT2JzZXJ2ZXI7XG4gICAgc3VwZXJDbGFzcy5leHRlbmQoQmluZGVyLCBkZWZpbml0aW9uKTtcblxuICAgIHZhciBleHByO1xuICAgIGlmIChuYW1lIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICBleHByID0gbmFtZTtcbiAgICB9IGVsc2UgaWYgKG5hbWUuaW5kZXhPZignKicpID49IDApIHtcbiAgICAgIGV4cHIgPSBuZXcgUmVnRXhwKCdeJyArIGVzY2FwZVJlZ0V4cChuYW1lKS5yZXBsYWNlKCdcXFxcKicsICcoLiopJykgKyAnJCcpO1xuICAgIH1cblxuICAgIGlmIChleHByKSB7XG4gICAgICBCaW5kZXIuZXhwciA9IGV4cHI7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMucHVzaChCaW5kZXIpO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnNvcnQodGhpcy5iaW5kaW5nU29ydCk7XG4gICAgfVxuXG4gICAgQmluZGVyLm5hbWUgPSAnJyArIG5hbWU7XG4gICAgYmluZGVyc1tuYW1lXSA9IEJpbmRlcjtcbiAgICByZXR1cm4gQmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBiaW5kZXIgdGhhdCB3YXMgYWRkZWQgd2l0aCBgcmVnaXN0ZXIoKWAuIElmIGFuIFJlZ0V4cCB3YXMgdXNlZCBpbiByZWdpc3RlciBmb3IgdGhlIG5hbWUgaXQgbXVzdCBiZSB1c2VkXG4gICAqIHRvIHVucmVnaXN0ZXIsIGJ1dCBpdCBkb2VzIG5vdCBuZWVkIHRvIGJlIHRoZSBzYW1lIGluc3RhbmNlLlxuICAgKi9cbiAgdW5yZWdpc3RlckVsZW1lbnQ6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy51bnJlZ2lzdGVyQmluZGVyKCdlbGVtZW50JywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy51bnJlZ2lzdGVyQmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlclRleHQ6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy51bnJlZ2lzdGVyQmluZGVyKCd0ZXh0JywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUpIHtcbiAgICB2YXIgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgbmFtZSksIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG4gICAgaWYgKCFiaW5kZXIpIHJldHVybjtcbiAgICBpZiAoYmluZGVyLmV4cHIpIHtcbiAgICAgIHZhciBpbmRleCA9IGJpbmRlcnMuX3dpbGRjYXJkcy5pbmRleE9mKGJpbmRlcik7XG4gICAgICBpZiAoaW5kZXggPj0gMCkgYmluZGVycy5fd2lsZGNhcmRzLnNwbGljZShpbmRleCwgMSk7XG4gICAgfVxuICAgIGRlbGV0ZSBiaW5kZXJzW25hbWVdO1xuICAgIHJldHVybiBiaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmV0dXJucyBhIGJpbmRlciB0aGF0IHdhcyBhZGRlZCB3aXRoIGByZWdpc3RlcigpYCBieSB0eXBlIGFuZCBuYW1lLlxuICAgKi9cbiAgZ2V0RWxlbWVudEJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcignZWxlbWVudCcsIG5hbWUpO1xuICB9LFxuICBnZXRBdHRyaWJ1dGVCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUpO1xuICB9LFxuICBnZXRUZXh0QmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCd0ZXh0JywgbmFtZSk7XG4gIH0sXG4gIGdldEJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSkge1xuICAgIHZhciBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuXG4gICAgaWYgKCFiaW5kZXJzKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdgdHlwZWAgbXVzdCBiZSBvbmUgb2YgJyArIE9iamVjdC5rZXlzKHRoaXMuYmluZGVycykuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgJiYgYmluZGVycy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgICAgcmV0dXJuIGJpbmRlcnNbbmFtZV07XG4gICAgfVxuICB9LFxuXG5cbiAgLyoqXG4gICAqIEZpbmQgYSBtYXRjaGluZyBiaW5kZXIgZm9yIHRoZSBnaXZlbiB0eXBlLiBFbGVtZW50cyBzaG91bGQgb25seSBwcm92aWRlIG5hbWUuIEF0dHJpYnV0ZXMgc2hvdWxkIHByb3ZpZGUgdGhlIG5hbWVcbiAgICogYW5kIHZhbHVlICh2YWx1ZSBzbyB0aGUgZGVmYXVsdCBjYW4gYmUgcmV0dXJuZWQgaWYgYW4gZXhwcmVzc2lvbiBleGlzdHMgaW4gdGhlIHZhbHVlKS4gVGV4dCBub2RlcyBzaG91bGQgb25seVxuICAgKiBwcm92aWRlIHRoZSB2YWx1ZSAoaW4gcGxhY2Ugb2YgdGhlIG5hbWUpIGFuZCB3aWxsIHJldHVybiB0aGUgZGVmYXVsdCBpZiBubyBiaW5kZXJzIG1hdGNoLlxuICAgKi9cbiAgZmluZEJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSwgdmFsdWUpIHtcbiAgICBpZiAodHlwZSA9PT0gJ3RleHQnICYmIHZhbHVlID09IG51bGwpIHtcbiAgICAgIHZhbHVlID0gbmFtZTtcbiAgICAgIG5hbWUgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHZhciBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCBuYW1lKSwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcblxuICAgIGlmICghYmluZGVyKSB7XG4gICAgICB2YXIgdG9NYXRjaCA9ICh0eXBlID09PSAndGV4dCcpID8gdmFsdWUgOiBuYW1lO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnNvbWUoZnVuY3Rpb24od2lsZGNhcmRCaW5kZXIpIHtcbiAgICAgICAgaWYgKHRvTWF0Y2gubWF0Y2god2lsZGNhcmRCaW5kZXIuZXhwcikpIHtcbiAgICAgICAgICBiaW5kZXIgPSB3aWxkY2FyZEJpbmRlcjtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKGJpbmRlciAmJiB0eXBlID09PSAnYXR0cmlidXRlJyAmJiBiaW5kZXIub25seVdoZW5Cb3VuZCAmJiAhdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkge1xuICAgICAgLy8gZG9uJ3QgdXNlIHRoZSBgdmFsdWVgIGJpbmRlciBpZiB0aGVyZSBpcyBubyBleHByZXNzaW9uIGluIHRoZSBhdHRyaWJ1dGUgdmFsdWUgKGUuZy4gYHZhbHVlPVwic29tZSB0ZXh0XCJgKVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghYmluZGVyICYmIHZhbHVlICYmICh0eXBlID09PSAndGV4dCcgfHwgdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkpIHtcbiAgICAgIC8vIFRlc3QgaWYgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyBib3VuZCAoZS5nLiBgaHJlZj1cIi9wb3N0cy97eyBwb3N0LmlkIH19XCJgKVxuICAgICAgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgJ19fZGVmYXVsdF9fJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBIEZvcm1hdHRlciBpcyBzdG9yZWQgdG8gcHJvY2VzcyB0aGUgdmFsdWUgb2YgYW4gZXhwcmVzc2lvbi4gVGhpcyBhbHRlcnMgdGhlIHZhbHVlIG9mIHdoYXQgY29tZXMgaW4gd2l0aCBhIGZ1bmN0aW9uXG4gICAqIHRoYXQgcmV0dXJucyBhIG5ldyB2YWx1ZS4gRm9ybWF0dGVycyBhcmUgYWRkZWQgYnkgdXNpbmcgYSBzaW5nbGUgcGlwZSBjaGFyYWN0ZXIgKGB8YCkgZm9sbG93ZWQgYnkgdGhlIG5hbWUgb2YgdGhlXG4gICAqIGZvcm1hdHRlci4gTXVsdGlwbGUgZm9ybWF0dGVycyBjYW4gYmUgdXNlZCBieSBjaGFpbmluZyBwaXBlcyB3aXRoIGZvcm1hdHRlciBuYW1lcy4gRm9ybWF0dGVycyBtYXkgYWxzbyBoYXZlXG4gICAqIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlbSBieSB1c2luZyB0aGUgY29sb24gdG8gc2VwYXJhdGUgYXJndW1lbnRzIGZyb20gdGhlIGZvcm1hdHRlciBuYW1lLiBUaGUgc2lnbmF0dXJlIG9mIGFcbiAgICogZm9ybWF0dGVyIHNob3VsZCBiZSBgZnVuY3Rpb24odmFsdWUsIGFyZ3MuLi4pYCB3aGVyZSBhcmdzIGFyZSBleHRyYSBwYXJhbWV0ZXJzIHBhc3NlZCBpbnRvIHRoZSBmb3JtYXR0ZXIgYWZ0ZXJcbiAgICogY29sb25zLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCd1cHBlcmNhc2UnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZS50b1VwcGVyY2FzZSgpXG4gICAqIH0pXG4gICAqXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdyZXBsYWNlJywgZnVuY3Rpb24odmFsdWUsIHJlcGxhY2UsIHdpdGgpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUucmVwbGFjZShyZXBsYWNlLCB3aXRoKVxuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxoMSBiaW5kLXRleHQ9XCJ0aXRsZSB8IHVwcGVyY2FzZSB8IHJlcGxhY2U6J0xFVFRFUic6J05VTUJFUidcIj48L2gxPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkdFVFRJTkcgVE8gS05PVyBBTEwgQUJPVVQgVEhFIE5VTUJFUiBBPC9oMT5cbiAgICogYGBgXG4gICAqXG4gICAqIEEgYHZhbHVlRm9ybWF0dGVyYCBpcyBsaWtlIGEgZm9ybWF0dGVyIGJ1dCB1c2VkIHNwZWNpZmljYWxseSB3aXRoIHRoZSBgdmFsdWVgIGJpbmRpbmcgc2luY2UgaXQgaXMgYSB0d28td2F5IGJpbmRpbmcuIFdoZW5cbiAgICogdGhlIHZhbHVlIG9mIHRoZSBlbGVtZW50IGlzIGNoYW5nZWQgYSBgdmFsdWVGb3JtYXR0ZXJgIGNhbiBhZGp1c3QgdGhlIHZhbHVlIGZyb20gYSBzdHJpbmcgdG8gdGhlIGNvcnJlY3QgdmFsdWUgdHlwZSBmb3JcbiAgICogdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbi4gVGhlIHNpZ25hdHVyZSBmb3IgYSBgdmFsdWVGb3JtYXR0ZXJgIGluY2x1ZGVzIHRoZSBjdXJyZW50IHZhbHVlIG9mIHRoZSBleHByZXNzaW9uXG4gICAqIGJlZm9yZSB0aGUgb3B0aW9uYWwgYXJndW1lbnRzIChpZiBhbnkpLiBUaGlzIGFsbG93cyBkYXRlcyB0byBiZSBhZGp1c3RlZCBhbmQgcG9zc2libGV5IG90aGVyIHVzZXMuXG4gICAqXG4gICAqICpFeGFtcGxlOipcbiAgICogYGBganNcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ251bWVyaWMnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIC8vIHZhbHVlIGNvbWluZyBmcm9tIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24sIHRvIGJlIHNldCBvbiB0aGUgZWxlbWVudFxuICAgKiAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IGlzTmFOKHZhbHVlKSkgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlXG4gICAqIH0pXG4gICAqXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdkYXRlLWhvdXInLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIC8vIHZhbHVlIGNvbWluZyBmcm9tIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24sIHRvIGJlIHNldCBvbiB0aGUgZWxlbWVudFxuICAgKiAgIGlmICggIShjdXJyZW50VmFsdWUgaW5zdGFuY2VvZiBEYXRlKSApIHJldHVybiAnJ1xuICAgKiAgIHZhciBob3VycyA9IHZhbHVlLmdldEhvdXJzKClcbiAgICogICBpZiAoaG91cnMgPj0gMTIpIGhvdXJzIC09IDEyXG4gICAqICAgaWYgKGhvdXJzID09IDApIGhvdXJzID0gMTJcbiAgICogICByZXR1cm4gaG91cnNcbiAgICogfSlcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+TnVtYmVyIEF0dGVuZGluZzo8L2xhYmVsPlxuICAgKiA8aW5wdXQgc2l6ZT1cIjRcIiBiaW5kLXZhbHVlPVwiZXZlbnQuYXR0ZW5kZWVDb3VudCB8IG51bWVyaWNcIj5cbiAgICogPGxhYmVsPlRpbWU6PC9sYWJlbD5cbiAgICogPGlucHV0IHNpemU9XCIyXCIgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLWhvdXJcIj4gOlxuICAgKiA8aW5wdXQgc2l6ZT1cIjJcIiBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtbWludXRlXCI+XG4gICAqIDxzZWxlY3QgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLWFtcG1cIj5cbiAgICogICA8b3B0aW9uPkFNPC9vcHRpb24+XG4gICAqICAgPG9wdGlvbj5QTTwvb3B0aW9uPlxuICAgKiA8L3NlbGVjdD5cbiAgICogYGBgXG4gICAqL1xuICByZWdpc3RlckZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUsIGZvcm1hdHRlcikge1xuICAgIHRoaXMuZm9ybWF0dGVyc1tuYW1lXSA9IGZvcm1hdHRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhIGZvcm1hdHRlci5cbiAgICovXG4gIHVucmVnaXN0ZXJGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lLCBmb3JtYXR0ZXIpIHtcbiAgICBkZWxldGUgdGhpcy5mb3JtYXR0ZXJzW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEdldHMgYSByZWdpc3RlcmVkIGZvcm1hdHRlci5cbiAgICovXG4gIGdldEZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5mb3JtYXR0ZXJzW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEFuIEFuaW1hdGlvbiBpcyBzdG9yZWQgdG8gaGFuZGxlIGFuaW1hdGlvbnMuIEEgcmVnaXN0ZXJlZCBhbmltYXRpb24gaXMgYW4gb2JqZWN0IChvciBjbGFzcyB3aGljaCBpbnN0YW50aWF0ZXMgaW50b1xuICAgKiBhbiBvYmplY3QpIHdpdGggdGhlIG1ldGhvZHM6XG4gICAqICAgKiBgd2lsbEFuaW1hdGVJbihlbGVtZW50KWBcbiAgICogICAqIGBhbmltYXRlSW4oZWxlbWVudCwgY2FsbGJhY2spYFxuICAgKiAgICogYGRpZEFuaW1hdGVJbihlbGVtZW50KWBcbiAgICogICAqIGB3aWxsQW5pbWF0ZU91dChlbGVtZW50KWBcbiAgICogICAqIGBhbmltYXRlT3V0KGVsZW1lbnQsIGNhbGxiYWNrKWBcbiAgICogICAqIGBkaWRBbmltYXRlT3V0KGVsZW1lbnQpYFxuICAgKlxuICAgKiBBbmltYXRpb24gaXMgaW5jbHVkZWQgd2l0aCBiaW5kZXJzIHdoaWNoIGFyZSByZWdpc3RlcmVkIHdpdGggdGhlIGBhbmltYXRlZGAgcHJvcGVydHkgc2V0IHRvIGB0cnVlYCAoc3VjaCBhcyBgaWZgXG4gICAqIGFuZCBgcmVwZWF0YCkuIEFuaW1hdGlvbnMgYWxsb3cgZWxlbWVudHMgdG8gZmFkZSBpbiwgZmFkZSBvdXQsIHNsaWRlIGRvd24sIGNvbGxhcHNlLCBtb3ZlIGZyb20gb25lIGxvY2F0aW9uIGluIGFcbiAgICogbGlzdCB0byBhbm90aGVyLCBhbmQgbW9yZS5cbiAgICpcbiAgICogVG8gdXNlIGFuaW1hdGlvbiBhZGQgYW4gYXR0cmlidXRlIG5hbWVkIGBhbmltYXRlYCBvbnRvIGFuIGVsZW1lbnQgd2l0aCBhIHN1cHBvcnRlZCBiaW5kZXIuXG4gICAqXG4gICAqICMjIyBDU1MgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBJZiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBkb2VzIG5vdCBoYXZlIGEgdmFsdWUgb3IgdGhlIHZhbHVlIGlzIGEgY2xhc3MgbmFtZSAoZS5nLiBgYW5pbWF0ZT1cIi5teS1mYWRlXCJgKSB0aGVuXG4gICAqIGZyYWdtZW50cyB3aWxsIHVzZSBhIENTUyB0cmFuc2l0aW9uL2FuaW1hdGlvbi4gQ2xhc3NlcyB3aWxsIGJlIGFkZGVkIGFuZCByZW1vdmVkIHRvIHRyaWdnZXIgdGhlIGFuaW1hdGlvbi5cbiAgICpcbiAgICogICAqIGAud2lsbC1hbmltYXRlLWluYCBpcyBhZGRlZCByaWdodCBhZnRlciBhbiBlbGVtZW50IGlzIGluc2VydGVkIGludG8gdGhlIERPTS4gVGhpcyBjYW4gYmUgdXNlZCB0byBzZXQgdGhlXG4gICAqICAgICBvcGFjaXR5IHRvIGAwLjBgIGZvciBleGFtcGxlLiBJdCBpcyB0aGVuIHJlbW92ZWQgb24gdGhlIG5leHQgYW5pbWF0aW9uIGZyYW1lLlxuICAgKiAgICogYC5hbmltYXRlLWluYCBpcyB3aGVuIGAud2lsbC1hbmltYXRlLWluYCBpcyByZW1vdmVkLiBJdCBjYW4gYmUgdXNlZCB0byBzZXQgb3BhY2l0eSB0byBgMS4wYCBmb3IgZXhhbXBsZS4gVGhlXG4gICAqICAgICBgYW5pbWF0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IG9uIHRoaXMgY2xhc3MgaWYgdXNpbmcgaXQuIFRoZSBgdHJhbnNpdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBoZXJlLiBOb3RlIHRoYXRcbiAgICogICAgIGFsdGhvdWdoIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHBsYWNlZCBvbiBhbiBlbGVtZW50IHdpdGggdGhlIGByZXBlYXRgIGJpbmRlciwgdGhlc2UgY2xhc3NlcyBhcmUgYWRkZWQgdG9cbiAgICogICAgIGl0cyBjaGlsZHJlbiBhcyB0aGV5IGdldCBhZGRlZCBhbmQgcmVtb3ZlZC5cbiAgICogICAqIGAud2lsbC1hbmltYXRlLW91dGAgaXMgYWRkZWQgYmVmb3JlIGFuIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00uIFRoaXMgY2FuIGJlIHVzZWQgdG8gc2V0IHRoZSBvcGFjaXR5IHRvXG4gICAqICAgICBgMWAgZm9yIGV4YW1wbGUuIEl0IGlzIHRoZW4gcmVtb3ZlZCBvbiB0aGUgbmV4dCBhbmltYXRpb24gZnJhbWUuXG4gICAqICAgKiBgLmFuaW1hdGUtb3V0YCBpcyBhZGRlZCB3aGVuIGAud2lsbC1hbmltYXRlLW91dGAgaXMgcmVtb3ZlZC4gSXQgY2FuIGJlIHVzZWQgdG8gc2V0IG9wYWNpdHkgdG8gYDAuMGAgZm9yXG4gICAqICAgICBleGFtcGxlLiBUaGUgYGFuaW1hdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBvbiB0aGlzIGNsYXNzIGlmIHVzaW5nIGl0LiBUaGUgYHRyYW5zaXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgaGVyZSBvclxuICAgKiAgICAgb24gYW5vdGhlciBzZWxlY3RvciB0aGF0IG1hdGNoZXMgdGhlIGVsZW1lbnQuIE5vdGUgdGhhdCBhbHRob3VnaCB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBwbGFjZWQgb24gYW5cbiAgICogICAgIGVsZW1lbnQgd2l0aCB0aGUgYHJlcGVhdGAgYmluZGVyLCB0aGVzZSBjbGFzc2VzIGFyZSBhZGRlZCB0byBpdHMgY2hpbGRyZW4gYXMgdGhleSBnZXQgYWRkZWQgYW5kIHJlbW92ZWQuXG4gICAqXG4gICAqIElmIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHNldCB0byBhIGNsYXNzIG5hbWUgKGUuZy4gYGFuaW1hdGU9XCIubXktZmFkZVwiYCkgdGhlbiB0aGF0IGNsYXNzIG5hbWUgd2lsbCBiZSBhZGRlZCBhc1xuICAgKiBhIGNsYXNzIHRvIHRoZSBlbGVtZW50IGR1cmluZyBhbmltYXRpb24uIFRoaXMgYWxsb3dzIHlvdSB0byB1c2UgYC5teS1mYWRlLndpbGwtYW5pbWF0ZS1pbmAsIGAubXktZmFkZS5hbmltYXRlLWluYCxcbiAgICogZXRjLiBpbiB5b3VyIHN0eWxlc2hlZXRzIHRvIHVzZSB0aGUgc2FtZSBhbmltYXRpb24gdGhyb3VnaG91dCB5b3VyIGFwcGxpY2F0aW9uLlxuICAgKlxuICAgKiAjIyMgSmF2YVNjcmlwdCBBbmltYXRpb25zXG4gICAqXG4gICAqIElmIHlvdSBuZWVkIGdyZWF0ZXIgY29udHJvbCBvdmVyIHlvdXIgYW5pbWF0aW9ucyBKYXZhU2NyaXB0IG1heSBiZSB1c2VkLiBJdCBpcyByZWNvbW1lbmRlZCB0aGF0IENTUyBzdHlsZXMgc3RpbGwgYmVcbiAgICogdXNlZCBieSBoYXZpbmcgeW91ciBjb2RlIHNldCB0aGVtIG1hbnVhbGx5LiBUaGlzIGFsbG93cyB0aGUgYW5pbWF0aW9uIHRvIHRha2UgYWR2YW50YWdlIG9mIHRoZSBicm93c2VyXG4gICAqIG9wdGltaXphdGlvbnMgc3VjaCBhcyBoYXJkd2FyZSBhY2NlbGVyYXRpb24uIFRoaXMgaXMgbm90IGEgcmVxdWlyZW1lbnQuXG4gICAqXG4gICAqIEluIG9yZGVyIHRvIHVzZSBKYXZhU2NyaXB0IGFuIG9iamVjdCBzaG91bGQgYmUgcGFzc2VkIGludG8gdGhlIGBhbmltYXRpb25gIGF0dHJpYnV0ZSB1c2luZyBhbiBleHByZXNzaW9uLiBUaGlzXG4gICAqIG9iamVjdCBzaG91bGQgaGF2ZSBtZXRob2RzIHRoYXQgYWxsb3cgSmF2YVNjcmlwdCBhbmltYXRpb24gaGFuZGxpbmcuIEZvciBleGFtcGxlLCBpZiB5b3UgYXJlIGJvdW5kIHRvIGEgY29udGV4dFxuICAgKiB3aXRoIGFuIG9iamVjdCBuYW1lZCBgY3VzdG9tRmFkZWAgd2l0aCBhbmltYXRpb24gbWV0aG9kcywgeW91ciBlbGVtZW50IHNob3VsZCBoYXZlIGBhdHRyaWJ1dGU9XCJ7e2N1c3RvbUZhZGV9fVwiYC5cbiAgICogVGhlIGZvbGxvd2luZyBpcyBhIGxpc3Qgb2YgdGhlIG1ldGhvZHMgeW91IG1heSBpbXBsZW1lbnQuXG4gICAqXG4gICAqICAgKiBgd2lsbEFuaW1hdGVJbihlbGVtZW50KWAgd2lsbCBiZSBjYWxsZWQgYWZ0ZXIgYW4gZWxlbWVudCBoYXMgYmVlbiBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFVzZSBpdCB0byBzZXQgaW5pdGlhbFxuICAgKiAgICAgQ1NTIHByb3BlcnRpZXMgYmVmb3JlIGBhbmltYXRlSW5gIGlzIGNhbGxlZCB0byBzZXQgdGhlIGZpbmFsIHByb3BlcnRpZXMuIFRoaXMgbWV0aG9kIGlzIG9wdGlvbmFsLlxuICAgKiAgICogYGFuaW1hdGVJbihlbGVtZW50LCBjYWxsYmFjaylgIHdpbGwgYmUgY2FsbGVkIHNob3J0bHkgYWZ0ZXIgYHdpbGxBbmltYXRlSW5gIGlmIGl0IHdhcyBkZWZpbmVkLiBVc2UgaXQgdG8gc2V0XG4gICAqICAgICBmaW5hbCBDU1MgcHJvcGVydGllcy5cbiAgICogICAqIGBhbmltYXRlT3V0KGVsZW1lbnQsIGRvbmUpYCB3aWxsIGJlIGNhbGxlZCBiZWZvcmUgYW4gZWxlbWVudCBpcyB0byBiZSByZW1vdmVkIGZyb20gdGhlIERPTS4gYGRvbmVgIG11c3QgYmVcbiAgICogICAgIGNhbGxlZCB3aGVuIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUgaW4gb3JkZXIgZm9yIHRoZSBiaW5kZXIgdG8gZmluaXNoIHJlbW92aW5nIHRoZSBlbGVtZW50LiAqKlJlbWVtYmVyKiogdG9cbiAgICogICAgIGNsZWFuIHVwIGJ5IHJlbW92aW5nIGFueSBzdHlsZXMgdGhhdCB3ZXJlIGFkZGVkIGJlZm9yZSBjYWxsaW5nIGBkb25lKClgIHNvIHRoZSBlbGVtZW50IGNhbiBiZSByZXVzZWQgd2l0aG91dFxuICAgKiAgICAgc2lkZS1lZmZlY3RzLlxuICAgKlxuICAgKiBUaGUgYGVsZW1lbnRgIHBhc3NlZCBpbiB3aWxsIGJlIHBvbHlmaWxsZWQgZm9yIHdpdGggdGhlIGBhbmltYXRlYCBtZXRob2QgdXNpbmdcbiAgICogaHR0cHM6Ly9naXRodWIuY29tL3dlYi1hbmltYXRpb25zL3dlYi1hbmltYXRpb25zLWpzLlxuICAgKlxuICAgKiAjIyMgUmVnaXN0ZXJlZCBBbmltYXRpb25zXG4gICAqXG4gICAqIEFuaW1hdGlvbnMgbWF5IGJlIHJlZ2lzdGVyZWQgYW5kIHVzZWQgdGhyb3VnaG91dCB5b3VyIGFwcGxpY2F0aW9uLiBUbyB1c2UgYSByZWdpc3RlcmVkIGFuaW1hdGlvbiB1c2UgaXRzIG5hbWUgaW5cbiAgICogdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgKGUuZy4gYGFuaW1hdGU9XCJmYWRlXCJgKS4gTm90ZSB0aGUgb25seSBkaWZmZXJlbmNlIGJldHdlZW4gYSByZWdpc3RlcmVkIGFuaW1hdGlvbiBhbmQgYVxuICAgKiBjbGFzcyByZWdpc3RyYXRpb24gaXMgY2xhc3MgcmVnaXN0cmF0aW9ucyBhcmUgcHJlZml4ZWQgd2l0aCBhIGRvdCAoYC5gKS4gUmVnaXN0ZXJlZCBhbmltYXRpb25zIGFyZSBhbHdheXNcbiAgICogSmF2YVNjcmlwdCBhbmltYXRpb25zLiBUbyByZWdpc3RlciBhbiBhbmltYXRpb24gdXNlIGBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSwgYW5pbWF0aW9uT2JqZWN0KWAuXG4gICAqXG4gICAqIFRoZSBBbmltYXRpb24gbW9kdWxlIGNvbWVzIHdpdGggc2V2ZXJhbCBjb21tb24gYW5pbWF0aW9ucyByZWdpc3RlcmVkIGJ5IGRlZmF1bHQuIFRoZSBkZWZhdWx0cyB1c2UgQ1NTIHN0eWxlcyB0b1xuICAgKiB3b3JrIGNvcnJlY3RseSwgdXNpbmcgYGVsZW1lbnQuYW5pbWF0ZWAuXG4gICAqXG4gICAqICAgKiBgZmFkZWAgd2lsbCBmYWRlIGFuIGVsZW1lbnQgaW4gYW5kIG91dCBvdmVyIDMwMCBtaWxsaXNlY29uZHMuXG4gICAqICAgKiBgc2xpZGVgIHdpbGwgc2xpZGUgYW4gZWxlbWVudCBkb3duIHdoZW4gaXQgaXMgYWRkZWQgYW5kIHNsaWRlIGl0IHVwIHdoZW4gaXQgaXMgcmVtb3ZlZC5cbiAgICogICAqIGBzbGlkZS1tb3ZlYCB3aWxsIG1vdmUgYW4gZWxlbWVudCBmcm9tIGl0cyBvbGQgbG9jYXRpb24gdG8gaXRzIG5ldyBsb2NhdGlvbiBpbiBhIHJlcGVhdGVkIGxpc3QuXG4gICAqXG4gICAqIERvIHlvdSBoYXZlIGFub3RoZXIgY29tbW9uIGFuaW1hdGlvbiB5b3UgdGhpbmsgc2hvdWxkIGJlIGluY2x1ZGVkIGJ5IGRlZmF1bHQ/IFN1Ym1pdCBhIHB1bGwgcmVxdWVzdCFcbiAgICovXG4gIHJlZ2lzdGVyQW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lLCBhbmltYXRpb25PYmplY3QpIHtcbiAgICB0aGlzLmFuaW1hdGlvbnNbbmFtZV0gPSBhbmltYXRpb25PYmplY3Q7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYW4gYW5pbWF0aW9uLlxuICAgKi9cbiAgdW5yZWdpc3RlckFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSkge1xuICAgIGRlbGV0ZSB0aGlzLmFuaW1hdGlvbnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogR2V0cyBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uLlxuICAgKi9cbiAgZ2V0QW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYW5pbWF0aW9uc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBQcmVwYXJlIGFuIGVsZW1lbnQgdG8gYmUgZWFzaWVyIGFuaW1hdGFibGUgKGFkZGluZyBhIHNpbXBsZSBgYW5pbWF0ZWAgcG9seWZpbGwgaWYgbmVlZGVkKVxuICAgKi9cbiAgbWFrZUVsZW1lbnRBbmltYXRhYmxlOiBhbmltYXRpb24ubWFrZUVsZW1lbnRBbmltYXRhYmxlLFxuXG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRlbGltaXRlcnMgdGhhdCBkZWZpbmUgYW4gZXhwcmVzc2lvbi4gRGVmYXVsdCBpcyBge3tgIGFuZCBgfX1gIGJ1dCB0aGlzIG1heSBiZSBvdmVycmlkZGVuLiBJZiBlbXB0eVxuICAgKiBzdHJpbmdzIGFyZSBwYXNzZWQgaW4gKGZvciB0eXBlIFwiYXR0cmlidXRlXCIgb25seSkgdGhlbiBubyBkZWxpbWl0ZXJzIGFyZSByZXF1aXJlZCBmb3IgbWF0Y2hpbmcgYXR0cmlidXRlcywgYnV0IHRoZVxuICAgKiBkZWZhdWx0IGF0dHJpYnV0ZSBtYXRjaGVyIHdpbGwgbm90IGFwcGx5IHRvIHRoZSByZXN0IG9mIHRoZSBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc2V0RXhwcmVzc2lvbkRlbGltaXRlcnM6IGZ1bmN0aW9uKHR5cGUsIHByZSwgcG9zdCkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0V4cHJlc3Npb24gZGVsaW1pdGVycyBtdXN0IGJlIG9mIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cblxuICAgIHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwciA9IG5ldyBSZWdFeHAoZXNjYXBlUmVnRXhwKHByZSkgKyAnKC4qPyknICsgZXNjYXBlUmVnRXhwKHBvc3QpLCAnZycpO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFRlc3RzIHdoZXRoZXIgYSB2YWx1ZSBoYXMgYW4gZXhwcmVzc2lvbiBpbiBpdC4gU29tZXRoaW5nIGxpa2UgYC91c2VyL3t7dXNlci5pZH19YC5cbiAgICovXG4gIGlzQm91bmQ6IGZ1bmN0aW9uKHR5cGUsIHZhbHVlKSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaXNCb3VuZCBtdXN0IHByb3ZpZGUgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuICAgIHZhciBleHByID0gdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByO1xuICAgIHJldHVybiBCb29sZWFuKGV4cHIgJiYgdmFsdWUgJiYgdmFsdWUubWF0Y2goZXhwcikpO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFRoZSBzb3J0IGZ1bmN0aW9uIHRvIHNvcnQgYmluZGVycyBjb3JyZWN0bHlcbiAgICovXG4gIGJpbmRpbmdTb3J0OiBmdW5jdGlvbihhLCBiKSB7XG4gICAgcmV0dXJuIGIucHJvdG90eXBlLnByaW9yaXR5IC0gYS5wcm90b3R5cGUucHJpb3JpdHk7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29udmVydHMgYW4gaW52ZXJ0ZWQgZXhwcmVzc2lvbiBmcm9tIGAvdXNlci97e3VzZXIuaWR9fWAgdG8gYFwiL3VzZXIvXCIgKyB1c2VyLmlkYFxuICAgKi9cbiAgY29kaWZ5RXhwcmVzc2lvbjogZnVuY3Rpb24odHlwZSwgdGV4dCkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvZGlmeUV4cHJlc3Npb24gbXVzdCB1c2UgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuXG4gICAgdmFyIGV4cHIgPSB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHI7XG4gICAgdmFyIG1hdGNoID0gdGV4dC5tYXRjaChleHByKTtcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHJldHVybiAnXCInICsgdGV4dC5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJykgKyAnXCInO1xuICAgIH0gZWxzZSBpZiAobWF0Y2gubGVuZ3RoID09PSAxICYmIG1hdGNoWzBdID09PSB0ZXh0KSB7XG4gICAgICByZXR1cm4gdGV4dC5yZXBsYWNlKGV4cHIsICckMScpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbmV3VGV4dCA9ICdcIicsIGxhc3RJbmRleCA9IDA7XG4gICAgICB3aGlsZSAobWF0Y2ggPSBleHByLmV4ZWModGV4dCkpIHtcbiAgICAgICAgdmFyIHN0ciA9IHRleHQuc2xpY2UobGFzdEluZGV4LCBleHByLmxhc3RJbmRleCAtIG1hdGNoWzBdLmxlbmd0aCk7XG4gICAgICAgIG5ld1RleHQgKz0gc3RyLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKTtcbiAgICAgICAgbmV3VGV4dCArPSAnXCIgKyAoJyArIG1hdGNoWzFdICsgJyB8fCBcIlwiKSArIFwiJztcbiAgICAgICAgbGFzdEluZGV4ID0gZXhwci5sYXN0SW5kZXg7XG4gICAgICB9XG4gICAgICBuZXdUZXh0ICs9IHRleHQuc2xpY2UobGFzdEluZGV4KS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJykgKyAnXCInO1xuICAgICAgcmV0dXJuIG5ld1RleHQucmVwbGFjZSgvXlwiXCIgXFwrIHwgXCJcIiBcXCsgfCBcXCsgXCJcIiQvZywgJycpO1xuICAgIH1cbiAgfVxuXG59O1xuXG4vLyBUYWtlcyBhIHN0cmluZyBsaWtlIFwiKFxcKilcIiBvciBcIm9uLVxcKlwiIGFuZCBjb252ZXJ0cyBpdCBpbnRvIGEgcmVndWxhciBleHByZXNzaW9uLlxuZnVuY3Rpb24gZXNjYXBlUmVnRXhwKHRleHQpIHtcbiAgcmV0dXJuIHRleHQucmVwbGFjZSgvWy1bXFxde30oKSorPy4sXFxcXF4kfCNcXHNdL2csIFwiXFxcXCQmXCIpO1xufVxuIiwiLypcbkNvcHlyaWdodCAoYykgMjAxNSBKYWNvYiBXcmlnaHQgPGphY3dyaWdodEBnbWFpbC5jb20+XG5cblBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbm9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbmluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbnRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbmNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcblxuVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbmFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG5JTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbkZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbk9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cblRIRSBTT0ZUV0FSRS5cbiovXG4vLyAjIERpZmZcbi8vID4gQmFzZWQgb24gd29yayBmcm9tIEdvb2dsZSdzIG9ic2VydmUtanMgcG9seWZpbGw6IGh0dHBzOi8vZ2l0aHViLmNvbS9Qb2x5bWVyL29ic2VydmUtanNcblxuLy8gQSBuYW1lc3BhY2UgdG8gc3RvcmUgdGhlIGZ1bmN0aW9ucyBvblxudmFyIGRpZmYgPSBleHBvcnRzO1xuXG4oZnVuY3Rpb24oKSB7XG5cbiAgZGlmZi5jbG9uZSA9IGNsb25lO1xuICBkaWZmLnZhbHVlcyA9IGRpZmZWYWx1ZXM7XG4gIGRpZmYuYmFzaWMgPSBkaWZmQmFzaWM7XG4gIGRpZmYub2JqZWN0cyA9IGRpZmZPYmplY3RzO1xuICBkaWZmLmFycmF5cyA9IGRpZmZBcnJheXM7XG5cblxuICAvLyBBIGNoYW5nZSByZWNvcmQgZm9yIHRoZSBvYmplY3QgY2hhbmdlc1xuICBmdW5jdGlvbiBDaGFuZ2VSZWNvcmQob2JqZWN0LCB0eXBlLCBuYW1lLCBvbGRWYWx1ZSkge1xuICAgIHRoaXMub2JqZWN0ID0gb2JqZWN0O1xuICAgIHRoaXMudHlwZSA9IHR5cGU7XG4gICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB0aGlzLm9sZFZhbHVlID0gb2xkVmFsdWU7XG4gIH1cblxuICAvLyBBIHNwbGljZSByZWNvcmQgZm9yIHRoZSBhcnJheSBjaGFuZ2VzXG4gIGZ1bmN0aW9uIFNwbGljZShpbmRleCwgcmVtb3ZlZCwgYWRkZWRDb3VudCkge1xuICAgIHRoaXMuaW5kZXggPSBpbmRleDtcbiAgICB0aGlzLnJlbW92ZWQgPSByZW1vdmVkO1xuICAgIHRoaXMuYWRkZWRDb3VudCA9IGFkZGVkQ291bnQ7XG4gIH1cblxuXG4gIC8vIENyZWF0ZXMgYSBjbG9uZSBvciBjb3B5IG9mIGFuIGFycmF5IG9yIG9iamVjdCAob3Igc2ltcGx5IHJldHVybnMgYSBzdHJpbmcvbnVtYmVyL2Jvb2xlYW4gd2hpY2ggYXJlIGltbXV0YWJsZSlcbiAgLy8gRG9lcyBub3QgcHJvdmlkZSBkZWVwIGNvcGllcy5cbiAgZnVuY3Rpb24gY2xvbmUodmFsdWUsIGRlZXApIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGlmIChkZWVwKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5tYXAoZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gY2xvbmUodmFsdWUsIGRlZXApO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5zbGljZSgpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgaWYgKHZhbHVlLnZhbHVlT2YoKSAhPT0gdmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIG5ldyB2YWx1ZS5jb25zdHJ1Y3Rvcih2YWx1ZS52YWx1ZU9mKCkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGNvcHkgPSB7fTtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIHZhbHVlKSB7XG4gICAgICAgICAgdmFyIG9ialZhbHVlID0gdmFsdWVba2V5XTtcbiAgICAgICAgICBpZiAoZGVlcCkge1xuICAgICAgICAgICAgb2JqVmFsdWUgPSBjbG9uZShvYmpWYWx1ZSwgZGVlcCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvcHlba2V5XSA9IG9ialZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb3B5O1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gdmFsdWVzLCByZXR1cm5pbmcgYSB0cnV0aHkgdmFsdWUgaWYgdGhlcmUgYXJlIGNoYW5nZXMgb3IgYGZhbHNlYCBpZiB0aGVyZSBhcmUgbm8gY2hhbmdlcy4gSWYgdGhlIHR3b1xuICAvLyB2YWx1ZXMgYXJlIGJvdGggYXJyYXlzIG9yIGJvdGggb2JqZWN0cywgYW4gYXJyYXkgb2YgY2hhbmdlcyAoc3BsaWNlcyBvciBjaGFuZ2UgcmVjb3JkcykgYmV0d2VlbiB0aGUgdHdvIHdpbGwgYmVcbiAgLy8gcmV0dXJuZWQuIE90aGVyd2lzZSAgYHRydWVgIHdpbGwgYmUgcmV0dXJuZWQuXG4gIGZ1bmN0aW9uIGRpZmZWYWx1ZXModmFsdWUsIG9sZFZhbHVlKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpICYmIEFycmF5LmlzQXJyYXkob2xkVmFsdWUpKSB7XG4gICAgICAvLyBJZiBhbiBhcnJheSBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIHNwbGljZXNcbiAgICAgIHZhciBzcGxpY2VzID0gZGlmZkFycmF5cyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgICAgcmV0dXJuIHNwbGljZXMubGVuZ3RoID8gc3BsaWNlcyA6IGZhbHNlO1xuICAgIH0gZWxzZSBpZiAodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBJZiBhbiBvYmplY3QgaGFzIGNoYW5nZWQgY2FsY3VsYXRlIHRoZSBjaG5hZ2VzIGFuZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgdmFyIHZhbHVlVmFsdWUgPSB2YWx1ZS52YWx1ZU9mKCk7XG4gICAgICB2YXIgb2xkVmFsdWVWYWx1ZSA9IG9sZFZhbHVlLnZhbHVlT2YoKTtcblxuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZVZhbHVlICE9PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlVmFsdWUgIT09IG9sZFZhbHVlVmFsdWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgY2hhbmdlUmVjb3JkcyA9IGRpZmZPYmplY3RzKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgICAgIHJldHVybiBjaGFuZ2VSZWNvcmRzLmxlbmd0aCA/IGNoYW5nZVJlY29yZHMgOiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgYSB2YWx1ZSBoYXMgY2hhbmdlZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgICAgcmV0dXJuIGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIGJhc2ljIHR5cGVzLCByZXR1cm5pbmcgdHJ1ZSBpZiBjaGFuZ2VkIG9yIGZhbHNlIGlmIG5vdFxuICBmdW5jdGlvbiBkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSB7XG4gICBpZiAodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlVmFsdWUsIG9sZFZhbHVlVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdudW1iZXInICYmIGlzTmFOKHZhbHVlKSAmJiBpc05hTihvbGRWYWx1ZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlICE9PSBvbGRWYWx1ZTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBvYmplY3RzIHJldHVybmluZyBhbiBhcnJheSBvZiBjaGFuZ2UgcmVjb3Jkcy4gVGhlIGNoYW5nZSByZWNvcmQgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgb2JqZWN0OiBvYmplY3QsXG4gIC8vICAgdHlwZTogJ2RlbGV0ZWR8dXBkYXRlZHxuZXcnLFxuICAvLyAgIG5hbWU6ICdwcm9wZXJ0eU5hbWUnLFxuICAvLyAgIG9sZFZhbHVlOiBvbGRWYWx1ZVxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmT2JqZWN0cyhvYmplY3QsIG9sZE9iamVjdCkge1xuICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gW107XG4gICAgdmFyIHByb3AsIG9sZFZhbHVlLCB2YWx1ZTtcblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCAoc2hvdWxkIGJlIGEgY2xvbmUpIGFuZCBsb29rIGZvciB0aGluZ3MgdGhhdCBhcmUgbm93IGdvbmUgb3IgY2hhbmdlZFxuICAgIGZvciAocHJvcCBpbiBvbGRPYmplY3QpIHtcbiAgICAgIG9sZFZhbHVlID0gb2xkT2JqZWN0W3Byb3BdO1xuICAgICAgdmFsdWUgPSBvYmplY3RbcHJvcF07XG5cbiAgICAgIC8vIEFsbG93IGZvciB0aGUgY2FzZSBvZiBvYmoucHJvcCA9IHVuZGVmaW5lZCAod2hpY2ggaXMgYSBuZXcgcHJvcGVydHksIGV2ZW4gaWYgaXQgaXMgdW5kZWZpbmVkKVxuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgIWRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgcHJvcGVydHkgaXMgZ29uZSBpdCB3YXMgcmVtb3ZlZFxuICAgICAgaWYgKCEgKHByb3AgaW4gb2JqZWN0KSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICdkZWxldGVkJywgcHJvcCwgb2xkVmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAoZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAndXBkYXRlZCcsIHByb3AsIG9sZFZhbHVlKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gR29lcyB0aHJvdWdoIHRoZSBvbGQgb2JqZWN0IGFuZCBsb29rcyBmb3IgdGhpbmdzIHRoYXQgYXJlIG5ld1xuICAgIGZvciAocHJvcCBpbiBvYmplY3QpIHtcbiAgICAgIHZhbHVlID0gb2JqZWN0W3Byb3BdO1xuICAgICAgaWYgKCEgKHByb3AgaW4gb2xkT2JqZWN0KSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICduZXcnLCBwcm9wKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkob2JqZWN0KSAmJiBvYmplY3QubGVuZ3RoICE9PSBvbGRPYmplY3QubGVuZ3RoKSB7XG4gICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICd1cGRhdGVkJywgJ2xlbmd0aCcsIG9sZE9iamVjdC5sZW5ndGgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlUmVjb3JkcztcbiAgfVxuXG5cblxuXG5cbiAgRURJVF9MRUFWRSA9IDBcbiAgRURJVF9VUERBVEUgPSAxXG4gIEVESVRfQUREID0gMlxuICBFRElUX0RFTEVURSA9IDNcblxuXG4gIC8vIERpZmZzIHR3byBhcnJheXMgcmV0dXJuaW5nIGFuIGFycmF5IG9mIHNwbGljZXMuIEEgc3BsaWNlIG9iamVjdCBsb29rcyBsaWtlOlxuICAvLyBgYGBqYXZhc2NyaXB0XG4gIC8vIHtcbiAgLy8gICBpbmRleDogMyxcbiAgLy8gICByZW1vdmVkOiBbaXRlbSwgaXRlbV0sXG4gIC8vICAgYWRkZWRDb3VudDogMFxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIHZhciBjdXJyZW50U3RhcnQgPSAwO1xuICAgIHZhciBjdXJyZW50RW5kID0gdmFsdWUubGVuZ3RoO1xuICAgIHZhciBvbGRTdGFydCA9IDA7XG4gICAgdmFyIG9sZEVuZCA9IG9sZFZhbHVlLmxlbmd0aDtcblxuICAgIHZhciBtaW5MZW5ndGggPSBNYXRoLm1pbihjdXJyZW50RW5kLCBvbGRFbmQpO1xuICAgIHZhciBwcmVmaXhDb3VudCA9IHNoYXJlZFByZWZpeCh2YWx1ZSwgb2xkVmFsdWUsIG1pbkxlbmd0aCk7XG4gICAgdmFyIHN1ZmZpeENvdW50ID0gc2hhcmVkU3VmZml4KHZhbHVlLCBvbGRWYWx1ZSwgbWluTGVuZ3RoIC0gcHJlZml4Q291bnQpO1xuXG4gICAgY3VycmVudFN0YXJ0ICs9IHByZWZpeENvdW50O1xuICAgIG9sZFN0YXJ0ICs9IHByZWZpeENvdW50O1xuICAgIGN1cnJlbnRFbmQgLT0gc3VmZml4Q291bnQ7XG4gICAgb2xkRW5kIC09IHN1ZmZpeENvdW50O1xuXG4gICAgaWYgKGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQgPT09IDAgJiYgb2xkRW5kIC0gb2xkU3RhcnQgPT09IDApIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3RoaW5nIHdhcyBhZGRlZCwgb25seSByZW1vdmVkIGZyb20gb25lIHNwb3RcbiAgICBpZiAoY3VycmVudFN0YXJ0ID09PSBjdXJyZW50RW5kKSB7XG4gICAgICByZXR1cm4gWyBuZXcgU3BsaWNlKGN1cnJlbnRTdGFydCwgb2xkVmFsdWUuc2xpY2Uob2xkU3RhcnQsIG9sZEVuZCksIDApIF07XG4gICAgfVxuXG4gICAgLy8gaWYgbm90aGluZyB3YXMgcmVtb3ZlZCwgb25seSBhZGRlZCB0byBvbmUgc3BvdFxuICAgIGlmIChvbGRTdGFydCA9PT0gb2xkRW5kKSB7XG4gICAgICByZXR1cm4gWyBuZXcgU3BsaWNlKGN1cnJlbnRTdGFydCwgW10sIGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQpIF07XG4gICAgfVxuXG4gICAgLy8gYSBtaXh0dXJlIG9mIGFkZHMgYW5kIHJlbW92ZXNcbiAgICB2YXIgZGlzdGFuY2VzID0gY2FsY0VkaXREaXN0YW5jZXModmFsdWUsIGN1cnJlbnRTdGFydCwgY3VycmVudEVuZCwgb2xkVmFsdWUsIG9sZFN0YXJ0LCBvbGRFbmQpO1xuICAgIHZhciBvcHMgPSBzcGxpY2VPcGVyYXRpb25zRnJvbUVkaXREaXN0YW5jZXMoZGlzdGFuY2VzKTtcblxuICAgIHZhciBzcGxpY2UgPSBudWxsO1xuICAgIHZhciBzcGxpY2VzID0gW107XG4gICAgdmFyIGluZGV4ID0gY3VycmVudFN0YXJ0O1xuICAgIHZhciBvbGRJbmRleCA9IG9sZFN0YXJ0O1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBvcHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICB2YXIgb3AgPSBvcHNbaV07XG4gICAgICBpZiAob3AgPT09IEVESVRfTEVBVkUpIHtcbiAgICAgICAgaWYgKHNwbGljZSkge1xuICAgICAgICAgIHNwbGljZXMucHVzaChzcGxpY2UpO1xuICAgICAgICAgIHNwbGljZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBpbmRleCsrO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9VUERBVEUpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UuYWRkZWRDb3VudCsrO1xuICAgICAgICBpbmRleCsrO1xuXG4gICAgICAgIHNwbGljZS5yZW1vdmVkLnB1c2gob2xkVmFsdWVbb2xkSW5kZXhdKTtcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfQUREKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLmFkZGVkQ291bnQrKztcbiAgICAgICAgaW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfREVMRVRFKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLnJlbW92ZWQucHVzaChvbGRWYWx1ZVtvbGRJbmRleF0pO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzcGxpY2UpIHtcbiAgICAgIHNwbGljZXMucHVzaChzcGxpY2UpO1xuICAgIH1cblxuICAgIHJldHVybiBzcGxpY2VzO1xuICB9XG5cblxuXG5cbiAgLy8gZmluZCB0aGUgbnVtYmVyIG9mIGl0ZW1zIGF0IHRoZSBiZWdpbm5pbmcgdGhhdCBhcmUgdGhlIHNhbWVcbiAgZnVuY3Rpb24gc2hhcmVkUHJlZml4KGN1cnJlbnQsIG9sZCwgc2VhcmNoTGVuZ3RoKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzZWFyY2hMZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGRpZmZCYXNpYyhjdXJyZW50W2ldLCBvbGRbaV0pKSB7XG4gICAgICAgIHJldHVybiBpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc2VhcmNoTGVuZ3RoO1xuICB9XG5cblxuICAvLyBmaW5kIHRoZSBudW1iZXIgb2YgaXRlbXMgYXQgdGhlIGVuZCB0aGF0IGFyZSB0aGUgc2FtZVxuICBmdW5jdGlvbiBzaGFyZWRTdWZmaXgoY3VycmVudCwgb2xkLCBzZWFyY2hMZW5ndGgpIHtcbiAgICB2YXIgaW5kZXgxID0gY3VycmVudC5sZW5ndGg7XG4gICAgdmFyIGluZGV4MiA9IG9sZC5sZW5ndGg7XG4gICAgdmFyIGNvdW50ID0gMDtcbiAgICB3aGlsZSAoY291bnQgPCBzZWFyY2hMZW5ndGggJiYgIWRpZmZCYXNpYyhjdXJyZW50Wy0taW5kZXgxXSwgb2xkWy0taW5kZXgyXSkpIHtcbiAgICAgIGNvdW50Kys7XG4gICAgfVxuICAgIHJldHVybiBjb3VudDtcbiAgfVxuXG5cbiAgZnVuY3Rpb24gc3BsaWNlT3BlcmF0aW9uc0Zyb21FZGl0RGlzdGFuY2VzKGRpc3RhbmNlcykge1xuICAgIHZhciBpID0gZGlzdGFuY2VzLmxlbmd0aCAtIDE7XG4gICAgdmFyIGogPSBkaXN0YW5jZXNbMF0ubGVuZ3RoIC0gMTtcbiAgICB2YXIgY3VycmVudCA9IGRpc3RhbmNlc1tpXVtqXTtcbiAgICB2YXIgZWRpdHMgPSBbXTtcbiAgICB3aGlsZSAoaSA+IDAgfHwgaiA+IDApIHtcbiAgICAgIGlmIChpID09PSAwKSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9BREQpO1xuICAgICAgICBqLS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoaiA9PT0gMCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfREVMRVRFKTtcbiAgICAgICAgaS0tO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgdmFyIG5vcnRoV2VzdCA9IGRpc3RhbmNlc1tpIC0gMV1baiAtIDFdO1xuICAgICAgdmFyIHdlc3QgPSBkaXN0YW5jZXNbaSAtIDFdW2pdO1xuICAgICAgdmFyIG5vcnRoID0gZGlzdGFuY2VzW2ldW2ogLSAxXTtcblxuICAgICAgaWYgKHdlc3QgPCBub3J0aCkge1xuICAgICAgICBtaW4gPSB3ZXN0IDwgbm9ydGhXZXN0ID8gd2VzdCA6IG5vcnRoV2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pbiA9IG5vcnRoIDwgbm9ydGhXZXN0ID8gbm9ydGggOiBub3J0aFdlc3Q7XG4gICAgICB9XG5cbiAgICAgIGlmIChtaW4gPT09IG5vcnRoV2VzdCkge1xuICAgICAgICBpZiAobm9ydGhXZXN0ID09PSBjdXJyZW50KSB7XG4gICAgICAgICAgZWRpdHMucHVzaChFRElUX0xFQVZFKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfVVBEQVRFKTtcbiAgICAgICAgICBjdXJyZW50ID0gbm9ydGhXZXN0O1xuICAgICAgICB9XG4gICAgICAgIGktLTtcbiAgICAgICAgai0tO1xuICAgICAgfSBlbHNlIGlmIChtaW4gPT09IHdlc3QpIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY3VycmVudCA9IHdlc3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjdXJyZW50ID0gbm9ydGg7XG4gICAgICB9XG4gICAgfVxuICAgIGVkaXRzLnJldmVyc2UoKTtcbiAgICByZXR1cm4gZWRpdHM7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIGNhbGNFZGl0RGlzdGFuY2VzKGN1cnJlbnQsIGN1cnJlbnRTdGFydCwgY3VycmVudEVuZCwgb2xkLCBvbGRTdGFydCwgb2xkRW5kKSB7XG4gICAgLy8gXCJEZWxldGlvblwiIGNvbHVtbnNcbiAgICB2YXIgcm93Q291bnQgPSBvbGRFbmQgLSBvbGRTdGFydCArIDE7XG4gICAgdmFyIGNvbHVtbkNvdW50ID0gY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCArIDE7XG4gICAgdmFyIGRpc3RhbmNlcyA9IG5ldyBBcnJheShyb3dDb3VudCk7XG4gICAgdmFyIGksIGo7XG5cbiAgICAvLyBcIkFkZGl0aW9uXCIgcm93cy4gSW5pdGlhbGl6ZSBudWxsIGNvbHVtbi5cbiAgICBmb3IgKGkgPSAwOyBpIDwgcm93Q291bnQ7IGkrKykge1xuICAgICAgZGlzdGFuY2VzW2ldID0gbmV3IEFycmF5KGNvbHVtbkNvdW50KTtcbiAgICAgIGRpc3RhbmNlc1tpXVswXSA9IGk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBudWxsIHJvd1xuICAgIGZvciAoaiA9IDA7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICBkaXN0YW5jZXNbMF1bal0gPSBqO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDE7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBmb3IgKGogPSAxOyBqIDwgY29sdW1uQ291bnQ7IGorKykge1xuICAgICAgICBpZiAoIWRpZmZCYXNpYyhjdXJyZW50W2N1cnJlbnRTdGFydCArIGogLSAxXSwgb2xkW29sZFN0YXJ0ICsgaSAtIDFdKSkge1xuICAgICAgICAgIGRpc3RhbmNlc1tpXVtqXSA9IGRpc3RhbmNlc1tpIC0gMV1baiAtIDFdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpIC0gMV1bal0gKyAxO1xuICAgICAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2ldW2ogLSAxXSArIDE7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gbm9ydGggPCB3ZXN0ID8gbm9ydGggOiB3ZXN0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc3RhbmNlcztcbiAgfVxufSkoKTtcbiIsIi8vICMgQ2hpcCBFeHByZXNzaW9uXG5cbi8vIFBhcnNlcyBhIHN0cmluZyBvZiBKYXZhU2NyaXB0IGludG8gYSBmdW5jdGlvbiB3aGljaCBjYW4gYmUgYm91bmQgdG8gYSBzY29wZS5cbi8vXG4vLyBBbGxvd3MgdW5kZWZpbmVkIG9yIG51bGwgdmFsdWVzIHRvIHJldHVybiB1bmRlZmluZWQgcmF0aGVyIHRoYW4gdGhyb3dpbmdcbi8vIGVycm9ycywgYWxsb3dzIGZvciBmb3JtYXR0ZXJzIG9uIGRhdGEsIGFuZCBwcm92aWRlcyBkZXRhaWxlZCBlcnJvciByZXBvcnRpbmcuXG5cbi8vIFRoZSBleHByZXNzaW9uIG9iamVjdCB3aXRoIGl0cyBleHByZXNzaW9uIGNhY2hlLlxudmFyIGV4cHJlc3Npb24gPSBleHBvcnRzO1xuZXhwcmVzc2lvbi5jYWNoZSA9IHt9O1xuZXhwcmVzc2lvbi5nbG9iYWxzID0gWyd0cnVlJywgJ2ZhbHNlJywgJ251bGwnLCAndW5kZWZpbmVkJywgJ3dpbmRvdycsICd0aGlzJ107XG5leHByZXNzaW9uLmdldCA9IGdldEV4cHJlc3Npb247XG5leHByZXNzaW9uLmdldFNldHRlciA9IGdldFNldHRlcjtcbmV4cHJlc3Npb24uYmluZCA9IGJpbmRFeHByZXNzaW9uO1xuXG5cbi8vIENyZWF0ZXMgYSBmdW5jdGlvbiBmcm9tIHRoZSBnaXZlbiBleHByZXNzaW9uLiBBbiBgb3B0aW9uc2Agb2JqZWN0IG1heSBiZVxuLy8gcHJvdmlkZWQgd2l0aCB0aGUgZm9sbG93aW5nIG9wdGlvbnM6XG4vLyAqIGBhcmdzYCBpcyBhbiBhcnJheSBvZiBzdHJpbmdzIHdoaWNoIHdpbGwgYmUgdGhlIGZ1bmN0aW9uJ3MgYXJndW1lbnQgbmFtZXNcbi8vICogYGdsb2JhbHNgIGlzIGFuIGFycmF5IG9mIHN0cmluZ3Mgd2hpY2ggZGVmaW5lIGdsb2JhbHMgYXZhaWxhYmxlIHRvIHRoZVxuLy8gZnVuY3Rpb24gKHRoZXNlIHdpbGwgbm90IGJlIHByZWZpeGVkIHdpdGggYHRoaXMuYCkuIGAndHJ1ZSdgLCBgJ2ZhbHNlJ2AsXG4vLyBgJ251bGwnYCwgYW5kIGAnd2luZG93J2AgYXJlIGluY2x1ZGVkIGJ5IGRlZmF1bHQuXG4vL1xuLy8gVGhpcyBmdW5jdGlvbiB3aWxsIGJlIGNhY2hlZCBzbyBzdWJzZXF1ZW50IGNhbGxzIHdpdGggdGhlIHNhbWUgZXhwcmVzc2lvbiB3aWxsXG4vLyByZXR1cm4gdGhlIHNhbWUgZnVuY3Rpb24uIEUuZy4gdGhlIGV4cHJlc3Npb24gXCJuYW1lXCIgd2lsbCBhbHdheXMgcmV0dXJuIGFcbi8vIHNpbmdsZSBmdW5jdGlvbiB3aXRoIHRoZSBib2R5IGByZXR1cm4gdGhpcy5uYW1lYC5cbmZ1bmN0aW9uIGdldEV4cHJlc3Npb24oZXhwciwgb3B0aW9ucykge1xuICBpZiAoIW9wdGlvbnMpIG9wdGlvbnMgPSB7fTtcbiAgaWYgKCFvcHRpb25zLmFyZ3MpIG9wdGlvbnMuYXJncyA9IFtdO1xuICB2YXIgY2FjaGVLZXkgPSBleHByICsgJ3wnICsgb3B0aW9ucy5hcmdzLmpvaW4oJywnKTtcbiAgLy8gUmV0dXJucyB0aGUgY2FjaGVkIGZ1bmN0aW9uIGZvciB0aGlzIGV4cHJlc3Npb24gaWYgaXQgZXhpc3RzLlxuICB2YXIgZnVuYyA9IGV4cHJlc3Npb24uY2FjaGVbY2FjaGVLZXldO1xuICBpZiAoZnVuYykge1xuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgb3B0aW9ucy5hcmdzLnVuc2hpZnQoJ19mb3JtYXR0ZXJzXycpO1xuXG4gIC8vIFByZWZpeCBhbGwgcHJvcGVydHkgbG9va3VwcyB3aXRoIHRoZSBgdGhpc2Aga2V5d29yZC4gSWdub3JlcyBrZXl3b3Jkc1xuICAvLyAod2luZG93LCB0cnVlLCBmYWxzZSkgYW5kIGV4dHJhIGFyZ3NcbiAgdmFyIGJvZHkgPSBwYXJzZUV4cHJlc3Npb24oZXhwciwgb3B0aW9ucyk7XG5cbiAgdHJ5IHtcbiAgICBmdW5jID0gZXhwcmVzc2lvbi5jYWNoZVtjYWNoZUtleV0gPSBGdW5jdGlvbi5hcHBseShudWxsLCBvcHRpb25zLmFyZ3MuY29uY2F0KGJvZHkpKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIGlmIChvcHRpb25zLmlnbm9yZUVycm9ycykgcmV0dXJuO1xuICAgIC8vIFRocm93cyBhbiBlcnJvciBpZiB0aGUgZXhwcmVzc2lvbiB3YXMgbm90IHZhbGlkIEphdmFTY3JpcHRcbiAgICBjb25zb2xlLmVycm9yKCdCYWQgZXhwcmVzc2lvbjpcXG5gJyArIGV4cHIgKyAnYFxcbicgKyAnQ29tcGlsZWQgZXhwcmVzc2lvbjpcXG4nICsgYm9keSk7XG4gICAgdGhyb3cgbmV3IEVycm9yKGUubWVzc2FnZSk7XG4gIH1cbiAgcmV0dXJuIGZ1bmM7XG59XG5cblxuLy8gQ3JlYXRlcyBhIHNldHRlciBmdW5jdGlvbiBmcm9tIHRoZSBnaXZlbiBleHByZXNzaW9uLlxuZnVuY3Rpb24gZ2V0U2V0dGVyKGV4cHIsIG9wdGlvbnMpIHtcbiAgaWYgKCFvcHRpb25zKSBvcHRpb25zID0ge307XG4gIG9wdGlvbnMuYXJncyA9IFsndmFsdWUnXTtcbiAgZXhwciA9IGV4cHIucmVwbGFjZSgvKFxccypcXHx8JCkvLCAnID0gdmFsdWUkMScpO1xuICByZXR1cm4gZ2V0RXhwcmVzc2lvbihleHByLCBvcHRpb25zKTtcbn1cblxuXG5cbi8vIENvbXBpbGVzIGFuIGV4cHJlc3Npb24gYW5kIGJpbmRzIGl0IGluIHRoZSBnaXZlbiBzY29wZS4gVGhpcyBhbGxvd3MgaXQgdG8gYmVcbi8vIGNhbGxlZCBmcm9tIGFueXdoZXJlIChlLmcuIGV2ZW50IGxpc3RlbmVycykgd2hpbGUgcmV0YWluaW5nIHRoZSBzY29wZS5cbmZ1bmN0aW9uIGJpbmRFeHByZXNzaW9uKGV4cHIsIHNjb3BlLCBvcHRpb25zKSB7XG4gIHJldHVybiBnZXRFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpLmJpbmQoc2NvcGUpO1xufVxuXG4vLyBmaW5kcyBhbGwgcXVvdGVkIHN0cmluZ3NcbnZhciBxdW90ZUV4cHIgPSAvKFsnXCJcXC9dKShcXFxcXFwxfFteXFwxXSkqP1xcMS9nO1xuXG4vLyBmaW5kcyBhbGwgZW1wdHkgcXVvdGVkIHN0cmluZ3NcbnZhciBlbXB0eVF1b3RlRXhwciA9IC8oWydcIlxcL10pXFwxL2c7XG5cbi8vIGZpbmRzIHBpcGVzIHRoYXQgYXJlbid0IE9ScyAoYCB8IGAgbm90IGAgfHwgYCkgZm9yIGZvcm1hdHRlcnNcbnZhciBwaXBlRXhwciA9IC9cXHwoXFx8KT8vZztcblxuLy8gZmluZHMgdGhlIHBhcnRzIG9mIGEgZm9ybWF0dGVyIChuYW1lIGFuZCBhcmdzKVxudmFyIGZvcm1hdHRlckV4cHIgPSAvXihbXlxcKF0rKSg/OlxcKCguKilcXCkpPyQvO1xuXG4vLyBmaW5kcyBhcmd1bWVudCBzZXBhcmF0b3JzIGZvciBmb3JtYXR0ZXJzIChgYXJnMTphcmcyYClcbnZhciBhcmdTZXBhcmF0b3IgPSAvXFxzKixcXHMqL2c7XG5cbi8vIG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIChlLmcuIGBuYW1lYCwgYHVzZXIubmFtZWAsIGFuZCBgdXNlci5mdWxsTmFtZSgpLmNhcGl0YWxpemUoKWApXG52YXIgcHJvcEV4cHIgPSAvKChcXHt8LHxcXC4pP1xccyopKFthLXokX1xcJF0oPzpbYS16X1xcJDAtOVxcLi1dfFxcW1snXCJcXGRdK1xcXSkqKShcXHMqKDp8XFwofFxcWyk/KS9naTtcblxuLy8gbGlua3MgaW4gYSBwcm9wZXJ0eSBjaGFpblxudmFyIGNoYWluTGlua3MgPSAvXFwufFxcWy9nO1xuXG4vLyB0aGUgcHJvcGVydHkgbmFtZSBwYXJ0IG9mIGxpbmtzXG52YXIgY2hhaW5MaW5rID0gL1xcLnxcXFt8XFwoLztcblxuLy8gZGV0ZXJtaW5lcyB3aGV0aGVyIGFuIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgb3IgZ2V0dGVyIChgbmFtZWAgdnNcbi8vIGBuYW1lID0gJ2JvYidgKVxudmFyIHNldHRlckV4cHIgPSAvXFxzPVxccy87XG5cbnZhciBpZ25vcmUgPSBudWxsO1xudmFyIHN0cmluZ3MgPSBbXTtcbnZhciByZWZlcmVuY2VDb3VudCA9IDA7XG52YXIgY3VycmVudFJlZmVyZW5jZSA9IDA7XG52YXIgY3VycmVudEluZGV4ID0gMDtcbnZhciBmaW5pc2hlZENoYWluID0gZmFsc2U7XG52YXIgY29udGludWF0aW9uID0gZmFsc2U7XG5cbi8vIEFkZHMgYHRoaXMuYCB0byB0aGUgYmVnaW5uaW5nIG9mIGVhY2ggdmFsaWQgcHJvcGVydHkgaW4gYW4gZXhwcmVzc2lvbixcbi8vIHByb2Nlc3NlcyBmb3JtYXR0ZXJzLCBhbmQgcHJvdmlkZXMgbnVsbC10ZXJtaW5hdGlvbiBpbiBwcm9wZXJ0eSBjaGFpbnNcbmZ1bmN0aW9uIHBhcnNlRXhwcmVzc2lvbihleHByLCBvcHRpb25zKSB7XG4gIGluaXRQYXJzZShleHByLCBvcHRpb25zKTtcbiAgZXhwciA9IHB1bGxPdXRTdHJpbmdzKGV4cHIpO1xuICBleHByID0gcGFyc2VGb3JtYXR0ZXJzKGV4cHIpO1xuICBleHByID0gcGFyc2VFeHByKGV4cHIpO1xuICBleHByID0gJ3JldHVybiAnICsgZXhwcjtcbiAgZXhwciA9IHB1dEluU3RyaW5ncyhleHByKTtcbiAgZXhwciA9IGFkZFJlZmVyZW5jZXMoZXhwcik7XG4gIHJldHVybiBleHByO1xufVxuXG5cbmZ1bmN0aW9uIGluaXRQYXJzZShleHByLCBvcHRpb25zKSB7XG4gIHJlZmVyZW5jZUNvdW50ID0gY3VycmVudFJlZmVyZW5jZSA9IDA7XG4gIC8vIElnbm9yZXMga2V5d29yZHMgYW5kIHByb3ZpZGVkIGFyZ3VtZW50IG5hbWVzXG4gIGlnbm9yZSA9IGV4cHJlc3Npb24uZ2xvYmFscy5jb25jYXQob3B0aW9ucy5nbG9iYWxzIHx8IFtdLCBvcHRpb25zLmFyZ3MgfHwgW10pO1xuICBzdHJpbmdzLmxlbmd0aCA9IDA7XG59XG5cblxuLy8gQWRkcyBwbGFjZWhvbGRlcnMgZm9yIHN0cmluZ3Mgc28gd2UgY2FuIHByb2Nlc3MgdGhlIHJlc3Qgd2l0aG91dCB0aGVpciBjb250ZW50XG4vLyBtZXNzaW5nIHVzIHVwLlxuZnVuY3Rpb24gcHVsbE91dFN0cmluZ3MoZXhwcikge1xuICByZXR1cm4gZXhwci5yZXBsYWNlKHF1b3RlRXhwciwgZnVuY3Rpb24oc3RyLCBxdW90ZSkge1xuICAgIHN0cmluZ3MucHVzaChzdHIpO1xuICAgIHJldHVybiBxdW90ZSArIHF1b3RlOyAvLyBwbGFjZWhvbGRlciBmb3IgdGhlIHN0cmluZ1xuICB9KTtcbn1cblxuXG4vLyBSZXBsYWNlcyBzdHJpbmcgcGxhY2Vob2xkZXJzLlxuZnVuY3Rpb24gcHV0SW5TdHJpbmdzKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIucmVwbGFjZShlbXB0eVF1b3RlRXhwciwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHN0cmluZ3Muc2hpZnQoKTtcbiAgfSk7XG59XG5cblxuLy8gUHJlcGVuZHMgcmVmZXJlbmNlIHZhcmlhYmxlIGRlZmluaXRpb25zXG5mdW5jdGlvbiBhZGRSZWZlcmVuY2VzKGV4cHIpIHtcbiAgaWYgKHJlZmVyZW5jZUNvdW50KSB7XG4gICAgdmFyIHJlZnMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMTsgaSA8PSByZWZlcmVuY2VDb3VudDsgaSsrKSB7XG4gICAgICByZWZzLnB1c2goJ19yZWYnICsgaSk7XG4gICAgfVxuICAgIGV4cHIgPSAndmFyICcgKyByZWZzLmpvaW4oJywgJykgKyAnO1xcbicgKyBleHByO1xuICB9XG4gIHJldHVybiBleHByO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlRm9ybWF0dGVycyhleHByKSB7XG4gIC8vIFJlbW92ZXMgZm9ybWF0dGVycyBmcm9tIGV4cHJlc3Npb24gc3RyaW5nXG4gIGV4cHIgPSBleHByLnJlcGxhY2UocGlwZUV4cHIsIGZ1bmN0aW9uKG1hdGNoLCBvckluZGljYXRvcikge1xuICAgIGlmIChvckluZGljYXRvcikgcmV0dXJuIG1hdGNoO1xuICAgIHJldHVybiAnQEBAJztcbiAgfSk7XG5cbiAgZm9ybWF0dGVycyA9IGV4cHIuc3BsaXQoL1xccypAQEBcXHMqLyk7XG4gIGV4cHIgPSBmb3JtYXR0ZXJzLnNoaWZ0KCk7XG4gIGlmICghZm9ybWF0dGVycy5sZW5ndGgpIHJldHVybiBleHByO1xuXG4gIC8vIFByb2Nlc3NlcyB0aGUgZm9ybWF0dGVyc1xuICAvLyBJZiB0aGUgZXhwcmVzc2lvbiBpcyBhIHNldHRlciB0aGUgdmFsdWUgd2lsbCBiZSBydW4gdGhyb3VnaCB0aGUgZm9ybWF0dGVyc1xuICB2YXIgc2V0dGVyID0gJyc7XG4gIHZhbHVlID0gZXhwcjtcblxuICBpZiAoc2V0dGVyRXhwci50ZXN0KGV4cHIpKSB7XG4gICAgdmFyIHBhcnRzID0gZXhwci5zcGxpdChzZXR0ZXJFeHByKTtcbiAgICBzZXR0ZXIgPSBwYXJ0c1swXSArICcgPSAnO1xuICAgIHZhbHVlID0gcGFydHNbMV07XG4gIH1cblxuICBmb3JtYXR0ZXJzLmZvckVhY2goZnVuY3Rpb24oZm9ybWF0dGVyKSB7XG4gICAgdmFyIG1hdGNoID0gZm9ybWF0dGVyLnRyaW0oKS5tYXRjaChmb3JtYXR0ZXJFeHByKTtcbiAgICBpZiAoIW1hdGNoKSB0aHJvdyBuZXcgRXJyb3IoJ0Zvcm1hdHRlciBpcyBpbnZhbGlkOiAnICsgZm9ybWF0dGVyKTtcbiAgICB2YXIgZm9ybWF0dGVyTmFtZSA9IG1hdGNoWzFdO1xuICAgIHZhciBhcmdzID0gbWF0Y2hbMl0uc3BsaXQoYXJnU2VwYXJhdG9yKTtcbiAgICBhcmdzLnVuc2hpZnQodmFsdWUpO1xuICAgIGlmIChzZXR0ZXIpIGFyZ3MucHVzaCh0cnVlKTtcbiAgICB2YWx1ZSA9ICdfZm9ybWF0dGVyc18uJyArIGZvcm1hdHRlck5hbWUgKyAnLmNhbGwodGhpcywgJyArIGFyZ3Muam9pbignLCAnKSArICcpJztcbiAgfSk7XG5cbiAgcmV0dXJuIHNldHRlciArIHZhbHVlO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlRXhwcihleHByKSB7XG4gIGlmIChzZXR0ZXJFeHByLnRlc3QoZXhwcikpIHtcbiAgICB2YXIgcGFydHMgPSBleHByLnNwbGl0KCcgPSAnKTtcbiAgICB2YXIgc2V0dGVyID0gcGFydHNbMF07XG4gICAgdmFyIHZhbHVlID0gcGFydHNbMV07XG4gICAgdmFyIG5lZ2F0ZSA9ICcnO1xuICAgIGlmIChzZXR0ZXIuY2hhckF0KDApID09PSAnIScpIHtcbiAgICAgIG5lZ2F0ZSA9ICchJztcbiAgICAgIHNldHRlciA9IHNldHRlci5zbGljZSgxKTtcbiAgICB9XG4gICAgc2V0dGVyID0gcGFyc2VQcm9wZXJ0eUNoYWlucyhzZXR0ZXIpLnJlcGxhY2UoL15cXCh8XFwpJC9nLCAnJykgKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnNlUHJvcGVydHlDaGFpbnModmFsdWUpO1xuICAgIHJldHVybiBzZXR0ZXIgKyBuZWdhdGUgKyB2YWx1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKTtcbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHBhcnNlUHJvcGVydHlDaGFpbnMoZXhwcikge1xuICB2YXIgamF2YXNjcmlwdCA9ICcnLCBqcztcbiAgLy8gYWxsb3cgcmVjdXJzaW9uIGludG8gZnVuY3Rpb24gYXJncyBieSByZXNldHRpbmcgcHJvcEV4cHJcbiAgdmFyIHByZXZpb3VzSW5kZXhlcyA9IFtjdXJyZW50SW5kZXgsIHByb3BFeHByLmxhc3RJbmRleF07XG4gIGN1cnJlbnRJbmRleCA9IDA7XG4gIHByb3BFeHByLmxhc3RJbmRleCA9IDA7XG4gIHdoaWxlICgoanMgPSBuZXh0Q2hhaW4oZXhwcikpICE9PSBmYWxzZSkge1xuICAgIGphdmFzY3JpcHQgKz0ganM7XG4gIH1cbiAgY3VycmVudEluZGV4ID0gcHJldmlvdXNJbmRleGVzWzBdO1xuICBwcm9wRXhwci5sYXN0SW5kZXggPSBwcmV2aW91c0luZGV4ZXNbMV07XG4gIHJldHVybiBqYXZhc2NyaXB0O1xufVxuXG5cbmZ1bmN0aW9uIG5leHRDaGFpbihleHByKSB7XG4gIGlmIChmaW5pc2hlZENoYWluKSB7XG4gICAgcmV0dXJuIChmaW5pc2hlZENoYWluID0gZmFsc2UpO1xuICB9XG4gIHZhciBtYXRjaCA9IHByb3BFeHByLmV4ZWMoZXhwcik7XG4gIGlmICghbWF0Y2gpIHtcbiAgICBmaW5pc2hlZENoYWluID0gdHJ1ZSAvLyBtYWtlIHN1cmUgbmV4dCBjYWxsIHdlIHJldHVybiBmYWxzZVxuICAgIHJldHVybiBleHByLnNsaWNlKGN1cnJlbnRJbmRleCk7XG4gIH1cblxuICAvLyBgcHJlZml4YCBpcyBgb2JqSW5kaWNhdG9yYCB3aXRoIHRoZSB3aGl0ZXNwYWNlIHRoYXQgbWF5IGNvbWUgYWZ0ZXIgaXQuXG4gIHZhciBwcmVmaXggPSBtYXRjaFsxXTtcblxuICAvLyBgb2JqSW5kaWNhdG9yYCBpcyBge2Agb3IgYCxgIGFuZCBsZXQncyB1cyBrbm93IHRoaXMgaXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gIC8vIG5hbWUgKGUuZy4gcHJvcCBpbiBge3Byb3A6ZmFsc2V9YCkuXG4gIHZhciBvYmpJbmRpY2F0b3IgPSBtYXRjaFsyXTtcblxuICAvLyBgcHJvcENoYWluYCBpcyB0aGUgY2hhaW4gb2YgcHJvcGVydGllcyBtYXRjaGVkIChlLmcuIGB0aGlzLnVzZXIuZW1haWxgKS5cbiAgdmFyIHByb3BDaGFpbiA9IG1hdGNoWzNdO1xuXG4gIC8vIGBwb3N0Zml4YCBpcyB0aGUgYGNvbG9uT3JQYXJlbmAgd2l0aCB3aGl0ZXNwYWNlIGJlZm9yZSBpdC5cbiAgdmFyIHBvc3RmaXggPSBtYXRjaFs0XTtcblxuICAvLyBgY29sb25PclBhcmVuYCBtYXRjaGVzIHRoZSBjb2xvbiAoOikgYWZ0ZXIgdGhlIHByb3BlcnR5IChpZiBpdCBpcyBhbiBvYmplY3QpXG4gIC8vIG9yIHBhcmVudGhlc2lzIGlmIGl0IGlzIGEgZnVuY3Rpb24uIFdlIHVzZSBgY29sb25PclBhcmVuYCBhbmQgYG9iakluZGljYXRvcmBcbiAgLy8gdG8ga25vdyBpZiBpdCBpcyBhbiBvYmplY3QuXG4gIHZhciBjb2xvbk9yUGFyZW4gPSBtYXRjaFs1XTtcblxuICBtYXRjaCA9IG1hdGNoWzBdO1xuXG4gIHZhciBza2lwcGVkID0gZXhwci5zbGljZShjdXJyZW50SW5kZXgsIHByb3BFeHByLmxhc3RJbmRleCAtIG1hdGNoLmxlbmd0aCk7XG4gIGN1cnJlbnRJbmRleCA9IHByb3BFeHByLmxhc3RJbmRleDtcblxuICAvLyBza2lwcyBvYmplY3Qga2V5cyBlLmcuIHRlc3QgaW4gYHt0ZXN0OnRydWV9YC5cbiAgaWYgKG9iakluZGljYXRvciAmJiBjb2xvbk9yUGFyZW4gPT09ICc6Jykge1xuICAgIHJldHVybiBza2lwcGVkICsgbWF0Y2g7XG4gIH1cblxuICByZXR1cm4gc2tpcHBlZCArIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIGNvbG9uT3JQYXJlbiwgZXhwcik7XG59XG5cblxuZnVuY3Rpb24gc3BsaXRMaW5rcyhjaGFpbikge1xuICB2YXIgaW5kZXggPSAwO1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG1hdGNoO1xuICB3aGlsZSAobWF0Y2ggPSBjaGFpbkxpbmtzLmV4ZWMoY2hhaW4pKSB7XG4gICAgaWYgKGNoYWluTGlua3MubGFzdEluZGV4ID09PSAxKSBjb250aW51ZTtcbiAgICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4LCBjaGFpbkxpbmtzLmxhc3RJbmRleCAtIDEpKTtcbiAgICBpbmRleCA9IGNoYWluTGlua3MubGFzdEluZGV4IC0gMTtcbiAgfVxuICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4KSk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuXG5mdW5jdGlvbiBhZGRUaGlzKGNoYWluKSB7XG4gIGlmIChpZ25vcmUuaW5kZXhPZihjaGFpbi5zcGxpdChjaGFpbkxpbmspLnNoaWZ0KCkpID09PSAtMSkge1xuICAgIHJldHVybiAndGhpcy4nICsgY2hhaW47XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGNoYWluO1xuICB9XG59XG5cblxuZnVuY3Rpb24gcGFyc2VDaGFpbihwcmVmaXgsIHByb3BDaGFpbiwgcG9zdGZpeCwgcGFyZW4sIGV4cHIpIHtcbiAgLy8gY29udGludWF0aW9ucyBhZnRlciBhIGZ1bmN0aW9uIChlLmcuIGBnZXRVc2VyKDEyKS5maXJzdE5hbWVgKS5cbiAgY29udGludWF0aW9uID0gcHJlZml4ID09PSAnLic7XG4gIGlmIChjb250aW51YXRpb24pIHtcbiAgICBwcm9wQ2hhaW4gPSAnLicgKyBwcm9wQ2hhaW47XG4gICAgcHJlZml4ID0gJyc7XG4gIH1cblxuICB2YXIgbGlua3MgPSBzcGxpdExpbmtzKHByb3BDaGFpbik7XG4gIHZhciBuZXdDaGFpbiA9ICcnO1xuXG4gIGlmIChsaW5rcy5sZW5ndGggPT09IDEgJiYgIWNvbnRpbnVhdGlvbiAmJiAhcGFyZW4pIHtcbiAgICBsaW5rID0gbGlua3NbMF07XG4gICAgbmV3Q2hhaW4gPSBhZGRUaGlzKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGlmICghY29udGludWF0aW9uKSB7XG4gICAgICBuZXdDaGFpbiA9ICcoJztcbiAgICB9XG5cbiAgICBsaW5rcy5mb3JFYWNoKGZ1bmN0aW9uKGxpbmssIGluZGV4KSB7XG4gICAgICBpZiAoaW5kZXggIT09IGxpbmtzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgbmV3Q2hhaW4gKz0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghcGFyZW5zW3BhcmVuXSkge1xuICAgICAgICAgIG5ld0NoYWluICs9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rICsgJyknO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHBvc3RmaXggPSBwb3N0Zml4LnJlcGxhY2UocGFyZW4sICcnKTtcbiAgICAgICAgICBuZXdDaGFpbiArPSBwYXJzZUZ1bmN0aW9uKGxpbmssIGluZGV4LCBleHByKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcmV0dXJuIHByZWZpeCArIG5ld0NoYWluICsgcG9zdGZpeDtcbn1cblxuXG52YXIgcGFyZW5zID0ge1xuICAnKCc6ICcpJyxcbiAgJ1snOiAnXSdcbn07XG5cbi8vIEhhbmRsZXMgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgaW4gaXRzIGNvcnJlY3Qgc2NvcGVcbi8vIEZpbmRzIHRoZSBlbmQgb2YgdGhlIGZ1bmN0aW9uIGFuZCBwcm9jZXNzZXMgdGhlIGFyZ3VtZW50c1xuZnVuY3Rpb24gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcbiAgbGluayArPSBjYWxsLnNsaWNlKDAsIDEpICsgJ35+aW5zaWRlUGFyZW5zfn4nICsgY2FsbC5zbGljZSgtMSk7XG4gIHZhciBpbnNpZGVQYXJlbnMgPSBjYWxsLnNsaWNlKDEsIC0xKTtcblxuICBpZiAoZXhwci5jaGFyQXQocHJvcEV4cHIubGFzdEluZGV4KSA9PT0gJy4nKSB7XG4gICAgbGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleClcbiAgfSBlbHNlIGlmIChpbmRleCA9PT0gMCkge1xuICAgIGxpbmsgPSBwYXJzZVBhcnQobGluaywgaW5kZXgpO1xuICAgIGxpbmsgKz0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArICcpJztcbiAgfSBlbHNlIHtcbiAgICBsaW5rID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIGxpbmsgKyAnKSc7XG4gIH1cblxuICB2YXIgcmVmID0gY3VycmVudFJlZmVyZW5jZTtcbiAgbGluayA9IGxpbmsucmVwbGFjZSgnfn5pbnNpZGVQYXJlbnN+ficsIHBhcnNlUHJvcGVydHlDaGFpbnMoaW5zaWRlUGFyZW5zKSk7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSByZWY7XG4gIHJldHVybiBsaW5rO1xufVxuXG5cbi8vIHJldHVybnMgdGhlIGNhbGwgcGFydCBvZiBhIGZ1bmN0aW9uIChlLmcuIGB0ZXN0KDEyMylgIHdvdWxkIHJldHVybiBgKDEyMylgKVxuZnVuY3Rpb24gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpIHtcbiAgdmFyIHN0YXJ0SW5kZXggPSBwcm9wRXhwci5sYXN0SW5kZXg7XG4gIHZhciBvcGVuID0gZXhwci5jaGFyQXQoc3RhcnRJbmRleCAtIDEpO1xuICB2YXIgY2xvc2UgPSBwYXJlbnNbb3Blbl07XG4gIHZhciBlbmRJbmRleCA9IHN0YXJ0SW5kZXggLSAxO1xuICB2YXIgcGFyZW5Db3VudCA9IDE7XG4gIHdoaWxlIChlbmRJbmRleCsrIDwgZXhwci5sZW5ndGgpIHtcbiAgICB2YXIgY2ggPSBleHByLmNoYXJBdChlbmRJbmRleCk7XG4gICAgaWYgKGNoID09PSBvcGVuKSBwYXJlbkNvdW50Kys7XG4gICAgZWxzZSBpZiAoY2ggPT09IGNsb3NlKSBwYXJlbkNvdW50LS07XG4gICAgaWYgKHBhcmVuQ291bnQgPT09IDApIGJyZWFrO1xuICB9XG4gIGN1cnJlbnRJbmRleCA9IHByb3BFeHByLmxhc3RJbmRleCA9IGVuZEluZGV4ICsgMTtcbiAgcmV0dXJuIG9wZW4gKyBleHByLnNsaWNlKHN0YXJ0SW5kZXgsIGVuZEluZGV4KSArIGNsb3NlO1xufVxuXG5cblxuZnVuY3Rpb24gcGFyc2VQYXJ0KHBhcnQsIGluZGV4KSB7XG4gIC8vIGlmIHRoZSBmaXJzdFxuICBpZiAoaW5kZXggPT09IDAgJiYgIWNvbnRpbnVhdGlvbikge1xuICAgIGlmIChpZ25vcmUuaW5kZXhPZihwYXJ0LnNwbGl0KC9cXC58XFwofFxcWy8pLnNoaWZ0KCkpID09PSAtMSkge1xuICAgICAgcGFydCA9ICd0aGlzLicgKyBwYXJ0O1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICBwYXJ0ID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIHBhcnQ7XG4gIH1cblxuICBjdXJyZW50UmVmZXJlbmNlID0gKytyZWZlcmVuY2VDb3VudDtcbiAgdmFyIHJlZiA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2U7XG4gIHJldHVybiAnKCcgKyByZWYgKyAnID0gJyArIHBhcnQgKyAnKSA9PSBudWxsID8gdW5kZWZpbmVkIDogJztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IHJlcXVpcmUoJy4vb2JzZXJ2ZXInKTtcbmV4cG9ydHMuZXhwcmVzc2lvbiA9IHJlcXVpcmUoJy4vZXhwcmVzc2lvbicpO1xuZXhwb3J0cy5leHByZXNzaW9uLmRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gT2JzZXJ2ZXI7XG52YXIgZXhwcmVzc2lvbiA9IHJlcXVpcmUoJy4vZXhwcmVzc2lvbicpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcblxuLy8gIyBPYnNlcnZlclxuXG4vLyBEZWZpbmVzIGFuIG9ic2VydmVyIGNsYXNzIHdoaWNoIHJlcHJlc2VudHMgYW4gZXhwcmVzc2lvbi4gV2hlbmV2ZXIgdGhhdCBleHByZXNzaW9uIHJldHVybnMgYSBuZXcgdmFsdWUgdGhlIGBjYWxsYmFja2Bcbi8vIGlzIGNhbGxlZCB3aXRoIHRoZSB2YWx1ZS5cbi8vXG4vLyBJZiB0aGUgb2xkIGFuZCBuZXcgdmFsdWVzIHdlcmUgZWl0aGVyIGFuIGFycmF5IG9yIGFuIG9iamVjdCwgdGhlIGBjYWxsYmFja2AgYWxzb1xuLy8gcmVjZWl2ZXMgYW4gYXJyYXkgb2Ygc3BsaWNlcyAoZm9yIGFuIGFycmF5KSwgb3IgYW4gYXJyYXkgb2YgY2hhbmdlIG9iamVjdHMgKGZvciBhbiBvYmplY3QpIHdoaWNoIGFyZSB0aGUgc2FtZVxuLy8gZm9ybWF0IHRoYXQgYEFycmF5Lm9ic2VydmVgIGFuZCBgT2JqZWN0Lm9ic2VydmVgIHJldHVybiA8aHR0cDovL3dpa2kuZWNtYXNjcmlwdC5vcmcvZG9rdS5waHA/aWQ9aGFybW9ueTpvYnNlcnZlPi5cbmZ1bmN0aW9uIE9ic2VydmVyKGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgdGhpcy5nZXR0ZXIgPSBleHByZXNzaW9uLmdldChleHByKTtcbiAgdGhpcy5zZXR0ZXIgPSBleHByZXNzaW9uLmdldFNldHRlcihleHByLCB7IGlnbm9yZUVycm9yczogdHJ1ZSB9KTtcbiAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrO1xuICB0aGlzLmNhbGxiYWNrQ29udGV4dCA9IGNhbGxiYWNrQ29udGV4dDtcbiAgdGhpcy5za2lwID0gZmFsc2U7XG4gIHRoaXMuY29udGV4dCA9IG51bGw7XG4gIHRoaXMub2xkVmFsdWUgPSB1bmRlZmluZWQ7XG59XG5cbk9ic2VydmVyLnByb3RvdHlwZSA9IHtcblxuICAvLyBCaW5kcyB0aGlzIGV4cHJlc3Npb24gdG8gYSBnaXZlbiBjb250ZXh0XG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQsIHNraXBVcGRhdGUpIHtcbiAgICB0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuICAgIGlmICh0aGlzLmNhbGxiYWNrKSB7XG4gICAgICBPYnNlcnZlci5hZGQodGhpcywgc2tpcFVwZGF0ZSk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFVuYmluZHMgdGhpcyBleHByZXNzaW9uXG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgICBPYnNlcnZlci5yZW1vdmUodGhpcyk7XG4gICAgdGhpcy5zeW5jKCk7XG4gIH0sXG5cbiAgLy8gUmV0dXJucyB0aGUgY3VycmVudCB2YWx1ZSBvZiB0aGlzIG9ic2VydmVyXG4gIGdldDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCkge1xuICAgICAgcmV0dXJuIHRoaXMuZ2V0dGVyLmNhbGwodGhpcy5jb250ZXh0LCBPYnNlcnZlci5mb3JtYXR0ZXJzKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gU2V0cyB0aGUgdmFsdWUgb2YgdGhpcyBleHByZXNzaW9uXG4gIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ICYmIHRoaXMuc2V0dGVyKSB7XG4gICAgICByZXR1cm4gdGhpcy5zZXR0ZXIuY2FsbCh0aGlzLmNvbnRleHQuX29yaWdDb250ZXh0XyB8fCB0aGlzLmNvbnRleHQsIE9ic2VydmVyLmZvcm1hdHRlcnMsIHZhbHVlKTtcbiAgICB9XG4gIH0sXG5cblxuICAvLyBJbnN0cnVjdHMgdGhpcyBvYnNlcnZlciB0byBub3QgY2FsbCBpdHMgYGNhbGxiYWNrYCBvbiB0aGUgbmV4dCBzeW5jLCB3aGV0aGVyIHRoZSB2YWx1ZSBoYXMgY2hhbmdlZCBvciBub3RcbiAgc2tpcE5leHRTeW5jOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNraXAgPSB0cnVlO1xuICB9LFxuXG5cbiAgLy8gU3luY3MgdGhpcyBvYnNlcnZlciBub3csIGNhbGxpbmcgdGhlIGNhbGxiYWNrIGltbWVkaWF0ZWx5IGlmIHRoZXJlIGhhdmUgYmVlbiBjaGFuZ2VzXG4gIHN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KCk7XG5cbiAgICAvLyBEb24ndCBjYWxsIHRoZSBjYWxsYmFjayBpZiBgc2tpcE5leHRTeW5jYCB3YXMgY2FsbGVkIG9uIHRoZSBvYnNlcnZlclxuICAgIGlmICh0aGlzLnNraXAgfHwgIXRoaXMuY2FsbGJhY2spIHtcbiAgICAgIHRoaXMuc2tpcCA9IGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhbiBhcnJheSBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIHNwbGljZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrLiBUaGlzXG4gICAgICB2YXIgY2hhbmdlZCA9IGRpZmYudmFsdWVzKHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIGlmICghY2hhbmdlZCkgcmV0dXJuO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2hhbmdlZCkpIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjay5jYWxsKHRoaXMuY2FsbGJhY2tDb250ZXh0LCB2YWx1ZSwgdGhpcy5vbGRWYWx1ZSwgY2hhbmdlZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIFN0b3JlIGFuIGltbXV0YWJsZSB2ZXJzaW9uIG9mIHRoZSB2YWx1ZSwgYWxsb3dpbmcgZm9yIGFycmF5cyBhbmQgb2JqZWN0cyB0byBjaGFuZ2UgaW5zdGFuY2UgYnV0IG5vdCBjb250ZW50IGFuZFxuICAgIC8vIHN0aWxsIHJlZnJhaW4gZnJvbSBkaXNwYXRjaGluZyBjYWxsYmFja3MgKGUuZy4gd2hlbiB1c2luZyBhbiBvYmplY3QgaW4gYmluZC1jbGFzcyBvciB3aGVuIHVzaW5nIGFycmF5IGZvcm1hdHRlcnNcbiAgICAvLyBpbiBiaW5kLWVhY2gpXG4gICAgdGhpcy5vbGRWYWx1ZSA9IGRpZmYuY2xvbmUodmFsdWUpO1xuICB9XG59O1xuXG5cbi8vIEFuIGFycmF5IG9mIGFsbCBvYnNlcnZlcnMsIGNvbnNpZGVyZWQgKnByaXZhdGUqXG5PYnNlcnZlci5vYnNlcnZlcnMgPSBbXTtcblxuLy8gQW4gYXJyYXkgb2YgY2FsbGJhY2tzIHRvIHJ1biBhZnRlciB0aGUgbmV4dCBzeW5jLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIuY2FsbGJhY2tzID0gW107XG5PYnNlcnZlci5saXN0ZW5lcnMgPSBbXTtcblxuLy8gQWRkcyBhIG5ldyBvYnNlcnZlciB0byBiZSBzeW5jZWQgd2l0aCBjaGFuZ2VzLiBJZiBgc2tpcFVwZGF0ZWAgaXMgdHJ1ZSB0aGVuIHRoZSBjYWxsYmFjayB3aWxsIG9ubHkgYmUgY2FsbGVkIHdoZW4gYVxuLy8gY2hhbmdlIGlzIG1hZGUsIG5vdCBpbml0aWFsbHkuXG5PYnNlcnZlci5hZGQgPSBmdW5jdGlvbihvYnNlcnZlciwgc2tpcFVwZGF0ZSkge1xuICB0aGlzLm9ic2VydmVycy5wdXNoKG9ic2VydmVyKTtcbiAgaWYgKCFza2lwVXBkYXRlKSBvYnNlcnZlci5zeW5jKCk7XG59O1xuXG4vLyBSZW1vdmVzIGFuIG9ic2VydmVyLCBzdG9wcGluZyBpdCBmcm9tIGJlaW5nIHJ1blxuT2JzZXJ2ZXIucmVtb3ZlID0gZnVuY3Rpb24ob2JzZXJ2ZXIpIHtcbiAgdmFyIGluZGV4ID0gdGhpcy5vYnNlcnZlcnMuaW5kZXhPZihvYnNlcnZlcik7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICB0aGlzLm9ic2VydmVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuLy8gKnByaXZhdGUqIHByb3BlcnRpZXMgdXNlZCBpbiB0aGUgc3luYyBjeWNsZVxuT2JzZXJ2ZXIuc3luY2luZyA9IGZhbHNlO1xuT2JzZXJ2ZXIucmVydW4gPSBmYWxzZTtcbk9ic2VydmVyLmN5Y2xlcyA9IDA7XG5PYnNlcnZlci5tYXggPSAxMDtcbk9ic2VydmVyLnRpbWVvdXQgPSBudWxsO1xuXG4vLyBSdW5zIHRoZSBvYnNlcnZlciBzeW5jIGN5Y2xlIHdoaWNoIGNoZWNrcyBhbGwgdGhlIG9ic2VydmVycyB0byBzZWUgaWYgdGhleSd2ZSBjaGFuZ2VkLlxuT2JzZXJ2ZXIuc3luYyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICBPYnNlcnZlci5hZnRlclN5bmMoY2FsbGJhY2spO1xuICB9XG5cbiAgaWYgKE9ic2VydmVyLnN5bmNpbmcpIHtcbiAgICBPYnNlcnZlci5yZXJ1biA9IHRydWU7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgT2JzZXJ2ZXIuc3luY2luZyA9IHRydWU7XG4gIE9ic2VydmVyLnJlcnVuID0gdHJ1ZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcblxuICAvLyBBbGxvdyBjYWxsYmFja3MgdG8gcnVuIHRoZSBzeW5jIGN5Y2xlIGFnYWluIGltbWVkaWF0ZWx5LCBidXQgc3RvcCBhdCBgT2JzZXJ2ZXIubWF4YCAoZGVmYXVsdCAxMCkgY3ljbGVzIHRvIHdlIGRvbid0XG4gIC8vIHJ1biBpbmZpbml0ZSBsb29wc1xuICB3aGlsZSAoT2JzZXJ2ZXIucmVydW4pIHtcbiAgICBpZiAoKytPYnNlcnZlci5jeWNsZXMgPT09IE9ic2VydmVyLm1heCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbmZpbml0ZSBvYnNlcnZlciBzeW5jaW5nLCBhbiBvYnNlcnZlciBpcyBjYWxsaW5nIE9ic2VydmVyLnN5bmMoKSB0b28gbWFueSB0aW1lcycpO1xuICAgIH1cbiAgICBPYnNlcnZlci5yZXJ1biA9IGZhbHNlO1xuICAgIC8vIHRoZSBvYnNlcnZlciBhcnJheSBtYXkgaW5jcmVhc2Ugb3IgZGVjcmVhc2UgaW4gc2l6ZSAocmVtYWluaW5nIG9ic2VydmVycykgZHVyaW5nIHRoZSBzeW5jXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBPYnNlcnZlci5vYnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgIE9ic2VydmVyLm9ic2VydmVyc1tpXS5zeW5jKCk7XG4gICAgfVxuICB9XG5cbiAgd2hpbGUgKE9ic2VydmVyLmNhbGxiYWNrcy5sZW5ndGgpIHtcbiAgICBPYnNlcnZlci5jYWxsYmFja3Muc2hpZnQoKSgpO1xuICB9XG5cbiAgZm9yICh2YXIgaSA9IDAsIGwgPSBPYnNlcnZlci5saXN0ZW5lcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgdmFyIGxpc3RlbmVyID0gT2JzZXJ2ZXIubGlzdGVuZXJzW2ldO1xuICAgIGxpc3RlbmVyKCk7XG4gIH1cblxuICBPYnNlcnZlci5zeW5jaW5nID0gZmFsc2U7XG4gIE9ic2VydmVyLmN5Y2xlcyA9IDA7XG4gIHJldHVybiB0cnVlO1xufTtcblxuT2JzZXJ2ZXIuc3luY0xhdGVyID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKCFPYnNlcnZlci50aW1lb3V0KSB7XG4gICAgT2JzZXJ2ZXIudGltZW91dCA9IHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICBPYnNlcnZlci50aW1lb3V0ID0gbnVsbDtcbiAgICAgIE9ic2VydmVyLnN5bmMoY2FsbGJhY2spO1xuICAgIH0pO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuLy8gQWZ0ZXIgdGhlIG5leHQgc3luYyAob3IgdGhlIGN1cnJlbnQgaWYgaW4gdGhlIG1pZGRsZSBvZiBvbmUpLCBydW4gdGhlIHByb3ZpZGVkIGNhbGxiYWNrXG5PYnNlcnZlci5hZnRlclN5bmMgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgT2JzZXJ2ZXIuY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xufTtcblxuT2JzZXJ2ZXIub25TeW5jID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIE9ic2VydmVyLmxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbn07XG5cbk9ic2VydmVyLnJlbW92ZU9uU3luYyA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICB2YXIgaW5kZXggPSBPYnNlcnZlci5saXN0ZW5lcnMuaW5kZXhPZihsaXN0ZW5lcik7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICBPYnNlcnZlci5saXN0ZW5lcnMuc3BsaWNlKGluZGV4LCAxKS5wb3AoKTtcbiAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcblxuLyoqXG4gKiAjIERlZmF1bHQgQmluZGVyc1xuICogUmVnaXN0ZXJzIGRlZmF1bHQgYmluZGVycyB3aXRoIGEgZnJhZ21lbnRzIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJEZWZhdWx0cyhmcmFnbWVudHMpIHtcblxuICAvKipcbiAgICogRmFkZSBpbiBhbmQgb3V0XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24oJ2ZhZGUnLCB7XG4gICAgb3B0aW9uczoge1xuICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgIH0sXG4gICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IG9wYWNpdHk6ICcwJyB9LFxuICAgICAgICB7IG9wYWNpdHk6ICcxJyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZG9uZTtcbiAgICB9LFxuICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgb3BhY2l0eTogJzEnIH0sXG4gICAgICAgIHsgb3BhY2l0eTogJzAnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBkb25lO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogU2xpZGUgZG93biBhbmQgdXBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbignc2xpZGUnLCB7XG4gICAgb3B0aW9uczoge1xuICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgIH0sXG4gICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IGhlaWdodDogJzBweCcgfSxcbiAgICAgICAgeyBoZWlnaHQ6IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MoJ2hlaWdodCcpIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICBkb25lKCk7XG4gICAgICB9O1xuICAgIH0sXG4gICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBoZWlnaHQ6IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MoJ2hlaWdodCcpIH0sXG4gICAgICAgIHsgaGVpZ2h0OiAnMHB4JyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgZG9uZSgpO1xuICAgICAgfTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgdmFyIGFuaW1hdGluZ091dCA9IG5ldyBNYXAoKTtcblxuICAvKipcbiAgICogTW92ZSBpdGVtcyB1cCBhbmQgZG93biBpbiBhIGxpc3QsIHNsaWRlIGRvd24gYW5kIHVwXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24oJ3NsaWRlLW1vdmUnLCB7XG4gICAgb3B0aW9uczoge1xuICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgIH0sXG5cbiAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIHZhciBvbGRFbGVtZW50LCBtb3ZlRWxlbWVudDtcbiAgICAgIHZhciBpdGVtID0gZWxlbWVudC52aWV3ICYmIGVsZW1lbnQudmlldy5fcmVwZWF0SXRlbV87XG4gICAgICBpZiAoaXRlbSkge1xuICAgICAgICBvdXRFbGVtZW50ID0gYW5pbWF0aW5nT3V0LmdldChpdGVtKTtcbiAgICAgICAgaWYgKG9sZEVsZW1lbnQpIHtcbiAgICAgICAgICAvLyBUaGlzIGl0ZW0gaXMgYmVpbmcgcmVtb3ZlZCBpbiBvbmUgcGxhY2UgYW5kIGFkZGVkIGludG8gYW5vdGhlci4gTWFrZSBpdCBsb29rIGxpa2UgaXRzIG1vdmluZyBieSBtYWtpbmcgYm90aFxuICAgICAgICAgIC8vIGVsZW1lbnRzIG5vdCB2aXNpYmxlIGFuZCBoYXZpbmcgYSBjbG9uZSBtb3ZlIGFib3ZlIHRoZSBpdGVtcyB0byB0aGUgbmV3IGxvY2F0aW9uLlxuICAgICAgICAgIHRoaXMuYW5pbWF0ZU1vdmUob2xkRWxlbWVudCwgZWxlbWVudCk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IGhlaWdodDogJzBweCcgfSxcbiAgICAgICAgeyBoZWlnaHQ6IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MoJ2hlaWdodCcpIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICBkb25lKCk7XG4gICAgICB9O1xuICAgIH0sXG5cbiAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICB2YXIgaXRlbSA9IGVsZW1lbnQudmlldyAmJiBlbGVtZW50LnZpZXcuX3JlcGVhdEl0ZW1fO1xuICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgYW5pbWF0aW5nT3V0LnNldChpdGVtLCBlbGVtZW50KTtcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICBhbmltYXRpbmdPdXQuZGVsZXRlKGl0ZW0pO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IGhlaWdodDogZWxlbWVudC5nZXRDb21wdXRlZENTUygnaGVpZ2h0JykgfSxcbiAgICAgICAgeyBoZWlnaHQ6ICcwcHgnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICBkb25lKCk7XG4gICAgICB9O1xuICAgIH0sXG5cbiAgICBhbmltYXRlTW92ZTogZnVuY3Rpb24ob2xkRWxlbWVudCwgbmV3RWxlbWVudCkge1xuICAgICAgdmFyIG1vdmVFbGVtZW50O1xuICAgICAgdmFyIHBhcmVudCA9IGVsZW1lbnQucGFyZW50Tm9kZTtcbiAgICAgIGlmICghcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCkge1xuICAgICAgICBwYXJlbnQuX19zbGlkZU1vdmVIYW5kbGVkID0gdHJ1ZTtcbiAgICAgICAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHBhcmVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgICAgcGFyZW50LnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBvbGRFbGVtZW50LnN0eWxlLnZpc2liaWxpdHkgPSAnaGlkZGVuJztcbiAgICAgIGVsZW1lbnQuc3R5bGUudmlzaWJpbGl0eSA9ICdoaWRkZW4nO1xuICAgICAgbW92ZUVsZW1lbnQgPSBmcmFnbWVudHMubWFrZUVsZW1lbnRBbmltYXRhYmxlKG9sZEVsZW1lbnQuY2xvbmVOb2RlKHRydWUpKTtcbiAgICAgIG1vdmVFbGVtZW50LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcbiAgICAgIHBhcmVudC5hcHBlbmRDaGlsZChtb3ZlRWxlbWVudCk7XG5cbiAgICAgIG1vdmVFbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IHRvcDogb2xkRWxlbWVudC5vZmZzZXRUb3AgKyAncHgnIH0sXG4gICAgICAgIHsgdG9wOiBlbGVtZW50Lm9mZnNldFRvcCArICdweCcgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBuZXdFbGVtZW50LnN0eWxlLnZpc2liaWxpdHkgPSAnJztcbiAgICAgIH07XG4gICAgfVxuICB9KTtcblxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuLi9vYnNlcnZlci9kaWZmJyk7XG5cbi8qKlxuICogIyBEZWZhdWx0IEJpbmRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGJpbmRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqIFByaW50cyBvdXQgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHRvIHRoZSBjb25zb2xlLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdkZWJ1ZycsIHtcbiAgICBwcmlvcml0eTogMjAwLFxuICAgIHVkcGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBjb25zb2xlLmluZm8oJ0RlYnVnOicsIHRoaXMuZXhwcmVzc2lvbiwgJz0nLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBodG1sXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZGlzcGxheSB1bmVzY2FwZWQgSFRNTCBpbnNpZGUgYW4gZWxlbWVudC4gQmUgc3VyZSBpdCdzIHRydXN0ZWQhIFRoaXMgc2hvdWxkIGJlIHVzZWQgd2l0aCBmaWx0ZXJzXG4gICAqIHdoaWNoIGNyZWF0ZSBIVE1MIGZyb20gc29tZXRoaW5nIHNhZmUuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT57e3Bvc3QudGl0bGV9fTwvaDE+XG4gICAqIDxkaXYgaHRtbD1cInt7cG9zdC5ib2R5IHwgbWFya2Rvd259fVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiA8ZGl2PlxuICAgKiAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICA8cD5cbiAgICogICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgPC9wPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2h0bWwnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGVsZW1lbnQuaW5uZXJIVE1MID0gdmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWU7XG4gIH0pO1xuXG5cblxuICAvKipcbiAgICogIyMgY2xhc3MtW2NsYXNzTmFtZV1cbiAgICogQWRkcyBhIGJpbmRlciB0byBhZGQgY2xhc3NlcyB0byBhbiBlbGVtZW50IGRlcGVuZGVudCBvbiB3aGV0aGVyIHRoZSBleHByZXNzaW9uIGlzIHRydWUgb3IgZmFsc2UuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJ1c2VyLWl0ZW1cIiBjbGFzcy1zZWxlY3RlZC11c2VyPVwie3tzZWxlY3RlZCA9PT0gdXNlcn19XCI+XG4gICAqICAgPGJ1dHRvbiBjbGFzcz1cImJ0biBwcmltYXJ5XCIgY2xhc3MtaGlnaGxpZ2h0PVwie3tyZWFkeX19XCI+PC9idXR0b24+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiBgc2VsZWN0ZWRgIGVxdWFscyB0aGUgYHVzZXJgIGFuZCBgcmVhZHlgIGlzIGB0cnVlYDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cInVzZXItaXRlbSBzZWxlY3RlZC11c2VyXCI+XG4gICAqICAgPGJ1dHRvbiBjbGFzcz1cImJ0biBwcmltYXJ5IGhpZ2hsaWdodFwiPjwvYnV0dG9uPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NsYXNzLSonLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LmNsYXNzTGlzdC5hZGQodGhpcy5tYXRjaCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMubWF0Y2gpO1xuICAgIH1cbiAgfSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyB2YWx1ZVxuICAgKiBBZGRzIGEgYmluZGVyIHdoaWNoIHNldHMgdGhlIHZhbHVlIG9mIGFuIEhUTUwgZm9ybSBlbGVtZW50LiBUaGlzIGJpbmRlciBhbHNvIHVwZGF0ZXMgdGhlIGRhdGEgYXMgaXQgaXMgY2hhbmdlZCBpblxuICAgKiB0aGUgZm9ybSBlbGVtZW50LCBwcm92aWRpbmcgdHdvIHdheSBiaW5kaW5nLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+Rmlyc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cInVzZXIuZmlyc3ROYW1lXCI+XG4gICAqXG4gICAqIDxsYWJlbD5MYXN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwibGFzdE5hbWVcIiB2YWx1ZT1cInVzZXIubGFzdE5hbWVcIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5GaXJzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICpcbiAgICogPGxhYmVsPkxhc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJsYXN0TmFtZVwiIHZhbHVlPVwiV3JpZ2h0XCI+XG4gICAqIGBgYFxuICAgKiBBbmQgd2hlbiB0aGUgdXNlciBjaGFuZ2VzIHRoZSB0ZXh0IGluIHRoZSBmaXJzdCBpbnB1dCB0byBcIkphY1wiLCBgdXNlci5maXJzdE5hbWVgIHdpbGwgYmUgdXBkYXRlZCBpbW1lZGlhdGVseSB3aXRoXG4gICAqIHRoZSB2YWx1ZSBvZiBgJ0phYydgLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd2YWx1ZScsIHtcbiAgICBvbmx5V2hlbkJvdW5kOiB0cnVlLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG5hbWUgPSB0aGlzLmVsZW1lbnQudGFnTmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgdmFyIHR5cGUgPSB0aGlzLmVsZW1lbnQudHlwZTtcbiAgICAgIHRoaXMubWV0aG9kcyA9IGlucHV0TWV0aG9kc1t0eXBlXSB8fCBpbnB1dE1ldGhvZHNbbmFtZV0gfHwgaW5wdXRNZXRob2RzLnJhZGlvZ3JvdXA7XG5cbiAgICAgIGlmICh0aGlzLmVsZW1lbnQuaGFzQXR0cmlidXRlKCd2YWx1ZS1ldmVudHMnKSkge1xuICAgICAgICB0aGlzLmV2ZW50cyA9IHRoaXMuZWxlbWVudC5nZXRBdHRyaWJ1dGUoJ3ZhbHVlLWV2ZW50cycpLnNwbGl0KCcgJyk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ3ZhbHVlLWV2ZW50cycpO1xuICAgICAgfSBlbHNlIGlmIChuYW1lICE9PSAnb3B0aW9uJykge1xuICAgICAgICB0aGlzLmV2ZW50cyA9IFsnY2hhbmdlJ107XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmVsZW1lbnQuaGFzQXR0cmlidXRlKCd2YWx1ZS1maWVsZCcpKSB7XG4gICAgICAgIHRoaXMudmFsdWVGaWVsZCA9IHRoaXMuZWxlbWVudC5nZXRBdHRyaWJ1dGUoJ3ZhbHVlLWZpZWxkJyk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ3ZhbHVlLWZpZWxkJyk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlID09PSAnb3B0aW9uJykge1xuICAgICAgICB0aGlzLnZhbHVlRmllbGQgPSB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS52YWx1ZUZpZWxkO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghdGhpcy5ldmVudHMpIHJldHVybjsgLy8gbm90aGluZyBmb3IgPG9wdGlvbj4gaGVyZVxuICAgICAgdmFyIGVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgICB2YXIgb2JzZXJ2ZXIgPSB0aGlzLm9ic2VydmVyO1xuICAgICAgdmFyIGlucHV0ID0gdGhpcy5tZXRob2RzO1xuICAgICAgdmFyIHZhbHVlRmllbGQgPSB0aGlzLnZhbHVlRmllbGQ7XG5cbiAgICAgIC8vIFRoZSAyLXdheSBiaW5kaW5nIHBhcnQgaXMgc2V0dGluZyB2YWx1ZXMgb24gY2VydGFpbiBldmVudHNcbiAgICAgIGZ1bmN0aW9uIG9uQ2hhbmdlKCkge1xuICAgICAgICBpZiAoaW5wdXQuZ2V0LmNhbGwoZWxlbWVudCwgdmFsdWVGaWVsZCkgIT09IG9ic2VydmVyLm9sZFZhbHVlICYmICFlbGVtZW50LnJlYWRPbmx5KSB7XG4gICAgICAgICAgb2JzZXJ2ZXIuc2V0KGlucHV0LmdldC5jYWxsKGVsZW1lbnQsIHZhbHVlRmllbGQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZWxlbWVudC50eXBlID09PSAndGV4dCcpIHtcbiAgICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAoZXZlbnQua2V5Q29kZSA9PT0gMTMpIG9uQ2hhbmdlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgb25DaGFuZ2UpO1xuICAgICAgfSk7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5tZXRob2RzLmdldC5jYWxsKHRoaXMuZWxlbWVudCwgdGhpcy52YWx1ZUZpZWxkKSAhPSB2YWx1ZSkge1xuICAgICAgICB0aGlzLm1ldGhvZHMuc2V0LmNhbGwodGhpcy5lbGVtZW50LCB2YWx1ZSwgdGhpcy52YWx1ZUZpZWxkKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBIYW5kbGUgdGhlIGRpZmZlcmVudCBmb3JtIHR5cGVzXG4gICAqL1xuICB2YXIgZGVmYXVsdElucHV0TWV0aG9kID0ge1xuICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnZhbHVlOyB9LFxuICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHsgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7IH1cbiAgfTtcblxuICB2YXIgaW5wdXRNZXRob2RzID0ge1xuICAgIGNoZWNrYm94OiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5jaGVja2VkOyB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkgeyB0aGlzLmNoZWNrZWQgPSAhIXZhbHVlOyB9XG4gICAgfSxcblxuICAgIGZpbGU6IHtcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmZpbGVzICYmIHRoaXMuZmlsZXNbMF07IH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7fVxuICAgIH0sXG5cbiAgICBzZWxlY3Q6IHtcbiAgICAgIGdldDogZnVuY3Rpb24odmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWVGaWVsZCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9wdGlvbnNbdGhpcy5zZWxlY3RlZEluZGV4XS52YWx1ZU9iamVjdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUsIHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHZhbHVlRmllbGQpIHtcbiAgICAgICAgICB0aGlzLnZhbHVlT2JqZWN0ID0gdmFsdWU7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlW3ZhbHVlRmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIG9wdGlvbjoge1xuICAgICAgZ2V0OiBmdW5jdGlvbih2YWx1ZUZpZWxkKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZUZpZWxkID8gdGhpcy52YWx1ZU9iamVjdFt2YWx1ZUZpZWxkXSA6IHRoaXMudmFsdWU7XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSwgdmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWVGaWVsZCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPYmplY3QgPSB2YWx1ZTtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVbdmFsdWVGaWVsZF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgaW5wdXQ6IGRlZmF1bHRJbnB1dE1ldGhvZCxcblxuICAgIHRleHRhcmVhOiBkZWZhdWx0SW5wdXRNZXRob2QsXG5cbiAgICByYWRpb2dyb3VwOiB7IC8vIEhhbmRsZXMgYSBncm91cCBvZiByYWRpbyBpbnB1dHMsIGFzc2lnbmVkIHRvIGFueXRoaW5nIHRoYXQgaXNuJ3QgYSBhIGZvcm0gaW5wdXRcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmZpbmQoJ2lucHV0W3R5cGU9XCJyYWRpb1wiXVtjaGVja2VkXScpLnZhbHVlIH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIC8vIGluIGNhc2UgdGhlIHZhbHVlIGlzbid0IGZvdW5kIGluIHJhZGlvc1xuICAgICAgICB2YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIHRoaXMucXVlcnlTZWxlY3RvcignaW5wdXRbdHlwZT1cInJhZGlvXCJdW2NoZWNrZWRdJykuY2hlY2tlZCA9IGZhbHNlO1xuICAgICAgICB2YXIgcmFkaW8gPSB0aGlzLnF1ZXJ5U2VsZWN0b3IoJ2lucHV0W3R5cGU9XCJyYWRpb1wiXVt2YWx1ZT1cIicgKyB2YWx1ZS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJykgKyAnXCJdJyk7XG4gICAgICAgIGlmIChyYWRpbykgcmFkaW8uY2hlY2tlZCA9IHRydWU7XG4gICAgICB9XG4gICAgfVxuICB9O1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciBmb3IgZWFjaCBldmVudCBuYW1lIGluIHRoZSBhcnJheS4gV2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkIHRoZSBleHByZXNzaW9uIHdpbGwgYmUgcnVuLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tY2xpY2tcbiAgICogKiBvbi1kYmxjbGlja1xuICAgKiAqIG9uLXN1Ym1pdFxuICAgKiAqIG9uLWNoYW5nZVxuICAgKiAqIG9uLWZvY3VzXG4gICAqICogb24tYmx1clxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8Zm9ybSBvbi1zdWJtaXQ9XCJ7e3NhdmVVc2VyKCl9fVwiPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IChldmVudHMgZG9uJ3QgYWZmZWN0IHRoZSBIVE1MKToqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0+XG4gICAqICAgPGlucHV0IG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqICAgPGJ1dHRvbj5TYXZlPC9idXR0b24+XG4gICAqIDwvZm9ybT5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ29uLSonLCB7XG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZXZlbnROYW1lID0gdGhpcy5tYXRjaDtcbiAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIC8vIHByZXZlbnQgbmF0aXZlIGV2ZW50cywgbGV0IGN1c3RvbSBldmVudHMgdXNlIHRoZSBcImRlZmF1bHRDYW5jZWxlZFwiIG1lY2hhbmlzbVxuICAgICAgICBpZiAoIShldmVudCBpbnN0YW5jZW9mIEN1c3RvbUV2ZW50KSkge1xuICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKCF0aGlzLmhhc0F0dHJpYnV0ZSgnZGlzYWJsZWQnKSkge1xuICAgICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuXG4gICAvKipcbiAgICogIyMgbmF0aXZlLVtldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciBmb3IgZWFjaCBldmVudCBuYW1lIGluIHRoZSBhcnJheS4gV2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkIHRoZSBleHByZXNzaW9uIHdpbGwgYmUgcnVuLlxuICAgKiBJdCB3aWxsIG5vdCBjYWxsIGV2ZW50LnByZXZlbnREZWZhdWx0KCkgbGlrZSBvbi0qIG9yIHdpdGhob2xkIHdoZW4gZGlzYWJsZWQuXG4gICAqXG4gICAqICoqRXhhbXBsZSBFdmVudHM6KipcbiAgICpcbiAgICogKiBuYXRpdmUtY2xpY2tcbiAgICogKiBuYXRpdmUtZGJsY2xpY2tcbiAgICogKiBuYXRpdmUtc3VibWl0XG4gICAqICogbmF0aXZlLWNoYW5nZVxuICAgKiAqIG5hdGl2ZS1mb2N1c1xuICAgKiAqIG5hdGl2ZS1ibHVyXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxmb3JtIG5hdGl2ZS1zdWJtaXQ9XCJ7e3NhdmVVc2VyKGV2ZW50KX19XCI+XG4gICAqICAgPGlucHV0IG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqICAgPGJ1dHRvbj5TYXZlPC9idXR0b24+XG4gICAqIDwvZm9ybT5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgKGV2ZW50cyBkb24ndCBhZmZlY3QgdGhlIEhUTUwpOipcbiAgICogYGBgaHRtbFxuICAgKiA8Zm9ybT5cbiAgICogICA8aW5wdXQgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICogICA8YnV0dG9uPlNhdmU8L2J1dHRvbj5cbiAgICogPC9mb3JtPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnbmF0aXZlLSonLCB7XG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZXZlbnROYW1lID0gdGhpcy5tYXRjaDtcbiAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICB2YXIgbGlzdGVuZXIgPSBfdGhpcy5vYnNlcnZlci5nZXQoKTtcblxuICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgb24tW2tleSBldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciB3aGljaCBpcyB0cmlnZ2VyZWQgd2hlbiB0aGUga2V5ZG93biBldmVudCdzIGBrZXlDb2RlYCBwcm9wZXJ0eSBtYXRjaGVzLiBJZiB0aGUgbmFtZSBpbmNsdWRlcyBjdHJsXG4gICAqIHRoZW4gaXQgd2lsbCBvbmx5IGZpcmUgd2hlbiB0aGUga2V5IHBsdXMgdGhlIGN0cmxLZXkgb3IgbWV0YUtleSBpcyBwcmVzc2VkLlxuICAgKlxuICAgKiAqKktleSBFdmVudHM6KipcbiAgICpcbiAgICogKiBvbi1lbnRlclxuICAgKiAqIG9uLWN0cmwtZW50ZXJcbiAgICogKiBvbi1lc2NcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGlucHV0IG9uLWVudGVyPVwie3tzYXZlKCl9fVwiIG9uLWVzYz1cInt7Y2FuY2VsKCl9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGlucHV0PlxuICAgKiBgYGBcbiAgICovXG4gIHZhciBrZXlDb2RlcyA9IHsgZW50ZXI6IDEzLCBlc2M6IDI3LCAnY3RybC1lbnRlcic6IDEzIH07XG5cbiAgT2JqZWN0LmtleXMoa2V5Q29kZXMpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBrZXlDb2RlID0ga2V5Q29kZXNbbmFtZV07XG5cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ29uLScgKyBuYW1lLCB7XG4gICAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHVzZUN0cmxLZXkgPSBuYW1lLmluZGV4T2YoJ2N0cmwtJykgPT09IDA7XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAodXNlQ3RybEtleSAmJiAhKGV2ZW50LmN0cmxLZXkgfHwgZXZlbnQubWV0YUtleSkpIHJldHVybjtcbiAgICAgICAgICBpZiAoZXZlbnQua2V5Q29kZSAhPT0ga2V5Q29kZSkgcmV0dXJuO1xuICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cbiAgICAgICAgICBpZiAoIXRoaXMuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpKSB7XG4gICAgICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXSRcbiAgICogQWRkcyBhIGJpbmRlciB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvZiBlbGVtZW50IHRvIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbi4gVXNlIHRoaXMgd2hlbiB5b3UgZG9uJ3Qgd2FudCBhblxuICAgKiBgPGltZz5gIHRvIHRyeSBhbmQgbG9hZCBpdHMgYHNyY2AgYmVmb3JlIGJlaW5nIGV2YWx1YXRlZC4gVGhpcyBpcyBvbmx5IG5lZWRlZCBvbiB0aGUgaW5kZXguaHRtbCBwYWdlIGFzIHRlbXBsYXRlXG4gICAqIHdpbGwgYmUgcHJvY2Vzc2VkIGJlZm9yZSBiZWluZyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIEdlbmVyYWxseSB5b3UgY2FuIGp1c3QgdXNlIGBhdHRyPVwie3tleHByfX1cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZSBBdHRyaWJ1dGVzOioqXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjJD1cInt7dXNlci5hdmF0YXJVcmx9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGltZyBzcmM9XCJodHRwOi8vY2RuLmV4YW1wbGUuY29tL2F2YXRhcnMvamFjd3JpZ2h0LXNtYWxsLnBuZ1wiPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKiQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIFthdHRyaWJ1dGVdP1xuICAgKiBBZGRzIGEgYmluZGVyIHRvIHRvZ2dsZSBhbiBhdHRyaWJ1dGUgb24gb3Igb2ZmIGlmIHRoZSBleHByZXNzaW9uIGlzIHRydXRoeSBvciBmYWxzZXkuIFVzZSBmb3IgYXR0cmlidXRlcyB3aXRob3V0XG4gICAqIHZhbHVlcyBzdWNoIGFzIGBzZWxlY3RlZGAsIGBkaXNhYmxlZGAsIG9yIGByZWFkb25seWAuIGBjaGVja2VkP2Agd2lsbCB1c2UgMi13YXkgZGF0YWJpbmRpbmcuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNoZWNrZWQ/PVwie3t1c2VyLmlzQWRtaW59fVwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPz1cInt7aXNQcm9jZXNzaW5nfX1cIj5TdWJtaXQ8L2J1dHRvbj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYGlzUHJvY2Vzc2luZ2AgaXMgYHRydWVgIGFuZCBgdXNlci5pc0FkbWluYCBpcyBmYWxzZToqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPklzIEFkbWluaXN0cmF0b3I8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCI+XG4gICAqIDxidXR0b24gZGlzYWJsZWQ+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCcqPycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGF0dHJOYW1lID0gdGhpcy5tYXRjaDtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZShhdHRyTmFtZSwgJycpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQWRkIGEgY2xvbmUgb2YgdGhlIGB2YWx1ZWAgYmluZGVyIGZvciBgY2hlY2tlZD9gIHNvIGNoZWNrYm94ZXMgY2FuIGhhdmUgdHdvLXdheSBiaW5kaW5nIHVzaW5nIGBjaGVja2VkP2AuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NoZWNrZWQ/JywgZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcigndmFsdWUnKSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyBpZiwgdW5sZXNzLCBlbHNlLWlmLCBlbHNlLXVubGVzcywgZWxzZVxuICAgKiBBZGRzIGEgYmluZGVyIHRvIHNob3cgb3IgaGlkZSB0aGUgZWxlbWVudCBpZiB0aGUgdmFsdWUgaXMgdHJ1dGh5IG9yIGZhbHNleS4gQWN0dWFsbHkgcmVtb3ZlcyB0aGUgZWxlbWVudCBmcm9tIHRoZVxuICAgKiBET00gd2hlbiBoaWRkZW4sIHJlcGxhY2luZyBpdCB3aXRoIGEgbm9uLXZpc2libGUgcGxhY2Vob2xkZXIgYW5kIG5vdCBuZWVkbGVzc2x5IGV4ZWN1dGluZyBiaW5kaW5ncyBpbnNpZGUuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDx1bCBjbGFzcz1cImhlYWRlci1saW5rc1wiPlxuICAgKiAgIDxsaSBpZj1cInVzZXJcIj48YSBocmVmPVwiL2FjY291bnRcIj5NeSBBY2NvdW50PC9hPjwvbGk+XG4gICAqICAgPGxpIHVubGVzcz1cInVzZXJcIj48YSBocmVmPVwiL2xvZ2luXCI+U2lnbiBJbjwvYT48L2xpPlxuICAgKiAgIDxsaSBlbHNlPjxhIGhyZWY9XCIvbG9nb3V0XCI+U2lnbiBPdXQ8L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYHVzZXJgIGlzIG51bGw6KlxuICAgKiBgYGBodG1sXG4gICAqIDx1bCBjbGFzcz1cImhlYWRlci1saW5rc1wiPlxuICAgKiAgIDxsaT48YSBocmVmPVwiL2xvZ2luXCI+U2lnbiBJbjwvYT48L2xpPlxuICAgKiA8L3VsPlxuICAgKiBgYGBcbiAgICovXG4gIHZhciBJZkJpbmRpbmcgPSBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2lmJywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiA1MCxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgdmFyIGV4cHJlc3Npb25zID0gWyB3cmFwSWZFeHAodGhpcy5leHByZXNzaW9uLCB0aGlzLm5hbWUgPT09ICd1bmxlc3MnKSBdO1xuICAgICAgdmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgdmFyIG5vZGUgPSBlbGVtZW50Lm5leHRFbGVtZW50U2libGluZztcbiAgICAgIHRoaXMuZWxlbWVudCA9IHBsYWNlaG9sZGVyO1xuICAgICAgZWxlbWVudC5wYXJlbnROb2RlLnJlcGxhY2VDaGlsZChwbGFjZWhvbGRlciwgZWxlbWVudCk7XG5cbiAgICAgIC8vIFN0b3JlcyBhIHRlbXBsYXRlIGZvciBhbGwgdGhlIGVsZW1lbnRzIHRoYXQgY2FuIGdvIGludG8gdGhpcyBzcG90XG4gICAgICB0aGlzLnRlbXBsYXRlcyA9IFsgZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKGVsZW1lbnQpIF07XG5cbiAgICAgIC8vIFB1bGwgb3V0IGFueSBvdGhlciBlbGVtZW50cyB0aGF0IGFyZSBjaGFpbmVkIHdpdGggdGhpcyBvbmVcbiAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgIHZhciBuZXh0ID0gbm9kZS5uZXh0RWxlbWVudFNpYmxpbmc7XG4gICAgICAgIHZhciBleHByZXNzaW9uO1xuICAgICAgICBpZiAobm9kZS5oYXNBdHRyaWJ1dGUoJ2Vsc2UtaWYnKSkge1xuICAgICAgICAgIGV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgbm9kZS5nZXRBdHRyaWJ1dGUoJ2Vsc2UtaWYnKSk7XG4gICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh3cmFwSWZFeHAoZXhwcmVzc2lvbiwgZmFsc2UpKTtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSgnZWxzZS1pZicpO1xuICAgICAgICB9IGVsc2UgaWYgKG5vZGUuaGFzQXR0cmlidXRlKCdlbHNlLXVubGVzcycpKSB7XG4gICAgICAgICAgZXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBub2RlLmdldEF0dHJpYnV0ZSgnZWxzZS11bmxlc3MnKSk7XG4gICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh3cmFwSWZFeHAoZXhwcmVzc2lvbiwgdHJ1ZSkpO1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKCdlbHNlLXVubGVzcycpO1xuICAgICAgICB9IGVsc2UgaWYgKG5vZGUuaGFzQXR0cmlidXRlKCdlbHNlJykpIHtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSgnZWxzZScpO1xuICAgICAgICAgIG5leHQgPSBudWxsO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5yZW1vdmUoKTtcbiAgICAgICAgdGhpcy50ZW1wbGF0ZXMucHVzaChmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUobm9kZSkpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cblxuICAgICAgLy8gQW4gZXhwcmVzc2lvbiB0aGF0IHdpbGwgcmV0dXJuIGFuIGluZGV4LiBTb21ldGhpbmcgbGlrZSB0aGlzIGBleHByID8gMCA6IGV4cHIyID8gMSA6IGV4cHIzID8gMiA6IDNgLiBUaGlzIHdpbGxcbiAgICAgIC8vIGJlIHVzZWQgdG8ga25vdyB3aGljaCBzZWN0aW9uIHRvIHNob3cgaW4gdGhlIGlmL2Vsc2UtaWYvZWxzZSBncm91cGluZy5cbiAgICAgIHRoaXMuZXhwcmVzc2lvbiA9IGV4cHJlc3Npb25zLm1hcChmdW5jdGlvbihleHByLCBpbmRleCkge1xuICAgICAgICByZXR1cm4gZXhwciArICcgPyAnICsgaW5kZXggKyAnIDogJztcbiAgICAgIH0pLmpvaW4oJycpICsgZXhwcmVzc2lvbnMubGVuZ3RoO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgLy8gRm9yIHBlcmZvcm1hbmNlIHByb3ZpZGUgYW4gYWx0ZXJuYXRlIGNvZGUgcGF0aCBmb3IgYW5pbWF0aW9uXG4gICAgICBpZiAodGhpcy5hbmltYXRlKSB7XG4gICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudXBkYXRlZFJlZ3VsYXIoaW5kZXgpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhZGQ6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZSh2aWV3LCB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmcpO1xuICAgIH0sXG5cbiAgICByZW1vdmU6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkUmVndWxhcjogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5yZW1vdmUodGhpcy5zaG93aW5nKTtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIHZhciB0ZW1wbGF0ZSA9IHRoaXMudGVtcGxhdGVzW2luZGV4XTtcbiAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnNob3dpbmcgPSB0ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICAgIHRoaXMuc2hvd2luZy5iaW5kKHRoaXMuY29udGV4dCk7XG4gICAgICAgIHRoaXMuYWRkKHRoaXMuc2hvd2luZyk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZWRBbmltYXRlZDogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIHRoaXMubGFzdFZhbHVlID0gaW5kZXg7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5hbmltYXRlT3V0KHRoaXMuc2hvd2luZywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgICB0aGlzLnJlbW92ZSh0aGlzLnNob3dpbmcpO1xuICAgICAgICAgIHRoaXMuc2hvd2luZyA9IG51bGw7XG4gICAgICAgICAgLy8gZmluaXNoIGJ5IGFuaW1hdGluZyB0aGUgbmV3IGVsZW1lbnQgaW4gKGlmIGFueSlcbiAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciB0ZW1wbGF0ZSA9IHRoaXMudGVtcGxhdGVzW2luZGV4XTtcbiAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnNob3dpbmcgPSB0ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICAgIHRoaXMuc2hvd2luZy5iaW5kKHRoaXMuY29udGV4dCk7XG4gICAgICAgIHRoaXMuYWRkKHRoaXMuc2hvd2luZyk7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odGhpcy5zaG93aW5nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgICAgIC8vIGlmIHRoZSB2YWx1ZSBjaGFuZ2VkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZyBydW4gaXQgYWdhaW5cbiAgICAgICAgICBpZiAodGhpcy5sYXN0VmFsdWUgIT09IGluZGV4KSB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICAvLyBDbGVhbiB1cFxuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnNob3dpbmcuZGlzcG9zZSgpO1xuICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd1bmxlc3MnLCBJZkJpbmRpbmcpO1xuXG4gIGZ1bmN0aW9uIHdyYXBJZkV4cChleHByLCBpc1VubGVzcykge1xuICAgIHJldHVybiAoaXNVbmxlc3MgPyAnIScgOiAnJykgKyBleHByO1xuICB9XG5cblxuICAvKipcbiAgICogIyMgZm9yZWFjaFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGR1cGxpY2F0ZSBhbiBlbGVtZW50IGZvciBlYWNoIGl0ZW0gaW4gYW4gYXJyYXkuIFRoZSBleHByZXNzaW9uIG1heSBiZSBvZiB0aGUgZm9ybWF0IGBlcHhyYCBvclxuICAgKiBgaXRlbU5hbWUgaW4gZXhwcmAgd2hlcmUgYGl0ZW1OYW1lYCBpcyB0aGUgbmFtZSBlYWNoIGl0ZW0gaW5zaWRlIHRoZSBhcnJheSB3aWxsIGJlIHJlZmVyZW5jZWQgYnkgd2l0aGluIGJpbmRpbmdzXG4gICAqIGluc2lkZSB0aGUgZWxlbWVudC5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBlYWNoPVwie3twb3N0IGluIHBvc3RzfX1cIiBjbGFzcy1mZWF0dXJlZD1cInt7cG9zdC5pc0ZlYXR1cmVkfX1cIj5cbiAgICogICA8aDE+e3twb3N0LnRpdGxlfX08L2gxPlxuICAgKiAgIDxkaXYgaHRtbD1cInt7cG9zdC5ib2R5IHwgbWFya2Rvd259fVwiPjwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgdGhlcmUgYXJlIDIgcG9zdHMgYW5kIHRoZSBmaXJzdCBvbmUgaXMgZmVhdHVyZWQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJmZWF0dXJlZFwiPlxuICAgKiAgIDxoMT5MaXR0bGUgUmVkPC9oMT5cbiAgICogICA8ZGl2PlxuICAgKiAgICAgPHA+TGl0dGxlIFJlZCBSaWRpbmcgSG9vZCBpcyBhIHN0b3J5IGFib3V0IGEgbGl0dGxlIGdpcmwuPC9wPlxuICAgKiAgICAgPHA+XG4gICAqICAgICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGl0dGxlX1JlZF9SaWRpbmdfSG9vZFwiPldpa2lwZWRpYTwvYT5cbiAgICogICAgIDwvcD5cbiAgICogICA8L2Rpdj5cbiAgICogPC9kaXY+XG4gICAqIDxkaXY+XG4gICAqICAgPGgxPkJpZyBCbHVlPC9oMT5cbiAgICogICA8ZGl2PlxuICAgKiAgICAgPHA+U29tZSB0aG91Z2h0cyBvbiB0aGUgTmV3IFlvcmsgR2lhbnRzLjwvcD5cbiAgICogICAgIDxwPlxuICAgKiAgICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL05ld19Zb3JrX0dpYW50c1wiPldpa2lwZWRpYTwvYT5cbiAgICogICAgIDwvcD5cbiAgICogICA8L2Rpdj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdyZXBlYXQnLCB7XG4gICAgYW5pbWF0ZWQ6IHRydWUsXG4gICAgcHJpb3JpdHk6IDEwMCxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBwYXJlbnQgPSB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZTtcbiAgICAgIHZhciBwbGFjZWhvbGRlciA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgIHBhcmVudC5pbnNlcnRCZWZvcmUocGxhY2Vob2xkZXIsIHRoaXMuZWxlbWVudCk7XG4gICAgICB0aGlzLnRlbXBsYXRlID0gZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKHRoaXMuZWxlbWVudCk7XG4gICAgICB0aGlzLmVsZW1lbnQgPSBwbGFjZWhvbGRlcjtcblxuICAgICAgdmFyIHBhcnRzID0gdGhpcy5leHByZXNzaW9uLnNwbGl0KC9cXHMraW5cXHMrLyk7XG4gICAgICB0aGlzLmV4cHJlc3Npb24gPSBwYXJ0cy5wb3AoKTtcbiAgICAgIHZhciBrZXkgPSBwYXJ0cy5wb3AoKTtcbiAgICAgIGlmIChrZXkpIHtcbiAgICAgICAgcGFydHMgPSBrZXkuc3BsaXQoL1xccyosXFxzKi8pO1xuICAgICAgICB0aGlzLnZhbHVlTmFtZSA9IHBhcnRzLnBvcCgpO1xuICAgICAgICB0aGlzLmtleU5hbWUgPSBwYXJ0cy5wb3AoKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLnZpZXdzID0gW107XG4gICAgICB0aGlzLm9ic2VydmVyLmdldENoYW5nZVJlY29yZHMgPSB0cnVlO1xuICAgIH0sXG5cbiAgICB1bmJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICh0aGlzLnZpZXdzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLnZpZXdzLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgICAgICAgIHZpZXcuX3JlcGVhdEl0ZW1fID0gbnVsbDtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMudmlld3MubGVuZ3RoID0gMDtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlZDogZnVuY3Rpb24odmFsdWUsIG9sZFZhbHVlLCBjaGFuZ2VzKSB7XG4gICAgICBpZiAoIWNoYW5nZXMpIHtcbiAgICAgICAgdGhpcy5wb3B1bGF0ZSh2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5hbmltYXRlKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzQW5pbWF0ZWQodmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlcyh2YWx1ZSwgY2hhbmdlcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gTWV0aG9kIGZvciBjcmVhdGluZyBhbmQgc2V0dGluZyB1cCBuZXcgdmlld3MgZm9yIG91ciBsaXN0XG4gICAgY3JlYXRlVmlldzogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgdmFyIHZpZXcgPSB0aGlzLnRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgIHZhciBjb250ZXh0ID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy52YWx1ZU5hbWUpIHtcbiAgICAgICAgY29udGV4dCA9IE9iamVjdC5jcmVhdGUodGhpcy5jb250ZXh0KTtcbiAgICAgICAgaWYgKHRoaXMua2V5TmFtZSkgY29udGV4dFt0aGlzLmtleU5hbWVdID0ga2V5O1xuICAgICAgICBjb250ZXh0W3RoaXMudmFsdWVOYW1lXSA9IHZhbHVlO1xuICAgICAgICBjb250ZXh0Ll9vcmlnQ29udGV4dF8gPSB0aGlzLmNvbnRleHQ7XG4gICAgICB9XG4gICAgICB2aWV3LmJpbmQoY29udGV4dCk7XG4gICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IHZhbHVlO1xuICAgICAgcmV0dXJuIHZpZXc7XG4gICAgfSxcblxuICAgIHBvcHVsYXRlOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnZpZXdzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLnZpZXdzLmZvckVhY2goZnVuY3Rpb24obm9kZSkge1xuICAgICAgICAgIG5vZGUuZGlzcG9zZSgpO1xuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy52aWV3cy5sZW5ndGggPSAwO1xuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoKSB7XG4gICAgICAgIHZhciBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuXG4gICAgICAgIHZhbHVlLmZvckVhY2goZnVuY3Rpb24oaXRlbSwgaW5kZXgpIHtcbiAgICAgICAgICB2YXIgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpbmRleCwgaXRlbSk7XG4gICAgICAgICAgdGhpcy52aWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH0sIHRoaXMpO1xuXG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnLCB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmcpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBUaGlzIHVuLWFuaW1hdGVkIHZlcnNpb24gcmVtb3ZlcyBhbGwgcmVtb3ZlZCB2aWV3cyBmaXJzdCBzbyB0aGV5IGNhbiBiZSByZXR1cm5lZCB0byB0aGUgcG9vbCBhbmQgdGhlbiBhZGRzIG5ld1xuICAgICAqIHZpZXdzIGJhY2sgaW4uIFRoaXMgaXMgdGhlIG1vc3Qgb3B0aW1hbCBtZXRob2Qgd2hlbiBub3QgYW5pbWF0aW5nLlxuICAgICAqL1xuICAgIHVwZGF0ZUNoYW5nZXM6IGZ1bmN0aW9uKHZhbHVlLCBjaGFuZ2VzKSB7XG4gICAgICAvLyBSZW1vdmUgZXZlcnl0aGluZyBmaXJzdCwgdGhlbiBhZGQgYWdhaW4sIGFsbG93aW5nIGZvciBlbGVtZW50IHJldXNlIGZyb20gdGhlIHBvb2xcbiAgICAgIHZhciByZW1vdmVkQ291bnQgPSAwO1xuICAgICAgdmFyIHJlbW92ZWRNYXAgPSBuZXcgTWFwKCk7XG5cbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UucmVtb3ZlZC5sZW5ndGgpIHJldHVybjtcbiAgICAgICAgdmFyIHJlbW92ZWQgPSB0aGlzLnZpZXdzLnNwbGljZShzcGxpY2UuaW5kZXggLSByZW1vdmVkQ291bnQsIHNwbGljZS5yZW1vdmVkLmxlbmd0aCk7XG4gICAgICAgIC8vIFNhdmUgZm9yIHJldXNlIGlmIGl0ZW1zIG1vdmVkIChlLmcuIG9uIGEgc29ydCB1cGRhdGUpIGluc3RlYWQgb2YganVzdCBnZXR0aW5nIHJlbW92ZWRcbiAgICAgICAgcmVtb3ZlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgICByZW1vdmVkTWFwLnNldCh2aWV3Ll9yZXBlYXRJdGVtXywgdmlldyk7XG4gICAgICAgICAgdmlldy5yZW1vdmUoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHJlbW92ZWRDb3VudCArPSByZW1vdmVkLmxlbmd0aDtcbiAgICAgIH0sIHRoaXMpO1xuXG4gICAgICAvLyBBZGQgdGhlIG5ldy9tb3ZlZCB2aWV3c1xuICAgICAgY2hhbmdlcy5mb3JFYWNoKGZ1bmN0aW9uKHNwbGljZSkge1xuICAgICAgICBpZiAoIXNwbGljZS5hZGRlZENvdW50KSByZXR1cm47XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuXG4gICAgICAgICAgdmFyIHZpZXcgPSByZW1vdmVkTWFwLmdldChpdGVtKTtcbiAgICAgICAgICBpZiAodmlldykge1xuICAgICAgICAgICAgLy8gSWYgdGhlIG5vZGUgd2FzIGp1c3QgcmVtb3ZlZCwgcmV1c2UgaXRcbiAgICAgICAgICAgIHJlbW92ZWRNYXAuZGVsZXRlKGl0ZW0pO1xuICAgICAgICAgICAgaWYgKHRoaXMua2V5TmFtZSkge1xuICAgICAgICAgICAgICB2aWV3LmNvbnRleHRbdGhpcy5rZXlOYW1lXSA9IGk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIC8vIE90aGVyd2lzZSBjcmVhdGUgYSBuZXcgb25lXG4gICAgICAgICAgICB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhZGRlZFZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cy5zcGxpY2UuYXBwbHkodGhpcy52aWV3cywgWyBpbmRleCwgMCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIG5leHRTaWJsaW5nLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBuZXh0U2libGluZyk7XG4gICAgICB9LCB0aGlzKTtcblxuICAgICAgLy8gQ2xlYW51cCBhbnkgdmlld3MgdGhhdCB3ZXJlIHJlbW92ZWQgYW5kIG5vdCByZS1hZGRlZCAobW92ZWQpXG4gICAgICByZW1vdmVkTWFwLmZvckVhY2goZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgdmFsdWUuX3JlcGVhdEl0ZW1fID0gbnVsbDtcbiAgICAgICAgdmFsdWUuZGlzcG9zZSgpO1xuICAgICAgfSk7XG4gICAgICByZW1vdmVkTWFwLmNsZWFyKCk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgYW5pbWF0ZWQgdmVyc2lvbiBtdXN0IGFuaW1hdGUgcmVtb3ZlZCBub2RlcyBvdXQgd2hpbGUgYWRkZWQgbm9kZXMgYXJlIGFuaW1hdGluZyBpbiBtYWtpbmcgaXQgbGVzcyBvcHRpbWFsXG4gICAgICogKGJ1dCBjb29sIGxvb2tpbmcpLiBJdCBhbHNvIGhhbmRsZXMgXCJtb3ZlXCIgYW5pbWF0aW9ucyBmb3Igbm9kZXMgd2hpY2ggYXJlIG1vdmluZyBwbGFjZSB3aXRoaW4gdGhlIGxpc3QuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlc0FuaW1hdGVkOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgYW5pbWF0aW5nVmFsdWUgPSB2YWx1ZS5zbGljZSgpO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuXG4gICAgICAvLyBSdW4gdXBkYXRlcyB3aGljaCBvY2N1cmVkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZy5cbiAgICAgIGZ1bmN0aW9uIHdoZW5Eb25lKCkge1xuICAgICAgICAvLyBUaGUgbGFzdCBhbmltYXRpb24gZmluaXNoZWQgd2lsbCBydW4gdGhpc1xuICAgICAgICBpZiAoLS13aGVuRG9uZS5jb3VudCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcpIHtcbiAgICAgICAgICB2YXIgY2hhbmdlcyA9IGRpZmYuYXJyYXkodGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nLCBhbmltYXRpbmdWYWx1ZSk7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzQW5pbWF0ZWQodGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nLCBjaGFuZ2VzKTtcbiAgICAgICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB3aGVuRG9uZS5jb3VudCA9IDA7XG5cblxuICAgICAgY2hhbmdlcy5mb3JFYWNoKGZ1bmN0aW9uKHNwbGljZSkge1xuICAgICAgICB2YXIgYWRkZWRWaWV3cyA9IFtdO1xuICAgICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICAgIHZhciBpbmRleCA9IHNwbGljZS5pbmRleDtcbiAgICAgICAgdmFyIGVuZEluZGV4ID0gaW5kZXggKyBzcGxpY2UuYWRkZWRDb3VudDtcbiAgICAgICAgdmFyIHJlbW92ZWRDb3VudCA9IHNwbGljZS5yZW1vdmVkLmxlbmd0aDtcblxuICAgICAgICBmb3IgKHZhciBpID0gaW5kZXg7IGkgPCBlbmRJbmRleDsgaSsrKSB7XG4gICAgICAgICAgdmFyIGl0ZW0gPSB2YWx1ZVtpXTtcbiAgICAgICAgICB2YXIgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpLCBpdGVtKTtcbiAgICAgICAgICBhZGRlZFZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgcmVtb3ZlZFZpZXdzID0gdGhpcy52aWV3cy5zcGxpY2UuYXBwbHkodGhpcy52aWV3cywgWyBpbmRleCwgcmVtb3ZlZENvdW50IF0uY29uY2F0KGFkZGVkVmlld3MpKTtcbiAgICAgICAgdmFyIHByZXZpb3VzVmlldyA9IHRoaXMudmlld3NbaW5kZXggLSAxXTtcbiAgICAgICAgdmFyIG5leHRTaWJsaW5nID0gcHJldmlvdXNWaWV3ID8gcHJldmlvdXNWaWV3Lmxhc3RWaWV3Tm9kZS5uZXh0U2libGluZyA6IHRoaXMuZWxlbWVudC5uZXh0U2libGluZztcbiAgICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBuZXh0U2libGluZyk7XG5cbiAgICAgICAgcmVtb3ZlZFZpZXdzLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICAgIHdoZW5Eb25lLmNvdW50Kys7XG4gICAgICAgICAgdGhpcy5hbmltYXRlT3V0KHZpZXcsIHdoZW5Eb25lKTtcbiAgICAgICAgfSwgdGhpcyk7XG5cbiAgICAgICAgYWRkZWRWaWV3cy5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgICB3aGVuRG9uZS5jb3VudCsrO1xuICAgICAgICAgIHRoaXMuYW5pbWF0ZUluKHZpZXcsIHdoZW5Eb25lKTtcbiAgICAgICAgfSwgdGhpcyk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG5cbi8qKlxuICogIyBEZWZhdWx0IEZvcm1hdHRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGZvcm1hdHRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3Rva2VuTGlzdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiB2IFRPRE8gdlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzdHlsZXMnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZmlsdGVyXG4gICAqIEZpbHRlcnMgYW4gYXJyYXkgYnkgdGhlIGdpdmVuIGZpbHRlciBmdW5jdGlvbihzKSwgbWF5IHByb3ZpZGUgYSBmdW5jdGlvbiwgYW5cbiAgICogYXJyYXksIG9yIGFuIG9iamVjdCB3aXRoIGZpbHRlcmluZyBmdW5jdGlvbnNcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmlsdGVyJywgZnVuY3Rpb24odmFsdWUsIGZpbHRlckZ1bmMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmICghZmlsdGVyRnVuYykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZmlsdGVyRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGZpbHRlckZ1bmMpKSB7XG4gICAgICBmaWx0ZXJGdW5jLmZvckVhY2goZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdvYmplY3QnKSB7XG4gICAgICBPYmplY3Qua2V5cyhmaWx0ZXJGdW5jKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICB2YXIgZnVuYyA9IGZpbHRlckZ1bmNba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG1hcFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIG1hcCBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gbWFwcGluZyBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdtYXAnLCBmdW5jdGlvbih2YWx1ZSwgbWFwRnVuYykge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChtYXBGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hcEZ1bmMuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdyZWR1Y2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIHJlZHVjZUZ1bmMoaW5pdGlhbFZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzbGljZScsIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgZW5kSW5kZXgpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zbGljZShpbmRleCwgZW5kSW5kZXgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBkYXRlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gZm9ybWF0IGRhdGVzIGFuZCBzdHJpbmdzXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS50b0xvY2FsZVN0cmluZygpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsb2dcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsb2cgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLCB1c2VmdWwgZm9yIGRlYnVnZ2luZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsb2cnLCBmdW5jdGlvbih2YWx1ZSwgcHJlZml4KSB7XG4gICAgaWYgKHByZWZpeCA9PSBudWxsKSBwcmVmaXggPSAnTG9nOic7XG4gICAgY29uc29sZS5sb2cocHJlZml4LCB2YWx1ZSk7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsaW1pdFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxpbWl0IHRoZSBsZW5ndGggb2YgYW4gYXJyYXkgb3Igc3RyaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xpbWl0JywgZnVuY3Rpb24odmFsdWUsIGxpbWl0KSB7XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5zbGljZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGxpbWl0IDwgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UobGltaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUuc2xpY2UoMCwgbGltaXQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBzb3J0XG4gICAqIFNvcnRzIGFuIGFycmF5IGdpdmVuIGEgZmllbGQgbmFtZSBvciBzb3J0IGZ1bmN0aW9uLCBhbmQgYSBkaXJlY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc29ydCcsIGZ1bmN0aW9uKHZhbHVlLCBzb3J0RnVuYywgZGlyKSB7XG4gICAgaWYgKCFzb3J0RnVuYyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgZGlyID0gKGRpciA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICBpZiAodHlwZW9mIHNvcnRGdW5jID09PSAnc3RyaW5nJykge1xuICAgICAgdmFyIHBhcnRzID0gc29ydEZ1bmMuc3BsaXQoJzonKTtcbiAgICAgIHZhciBwcm9wID0gcGFydHNbMF07XG4gICAgICB2YXIgZGlyMiA9IHBhcnRzWzFdO1xuICAgICAgZGlyMiA9IChkaXIyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgICAgZGlyID0gZGlyIHx8IGRpcjI7XG4gICAgICB2YXIgc29ydEZ1bmMgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhW3Byb3BdID4gYltwcm9wXSkgcmV0dXJuIGRpcjtcbiAgICAgICAgaWYgKGFbcHJvcF0gPCBiW3Byb3BdKSByZXR1cm4gLWRpcjtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoZGlyID09PSAtMSkge1xuICAgICAgdmFyIG9yaWdGdW5jID0gc29ydEZ1bmM7XG4gICAgICBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIC1vcmlnRnVuYyhhLCBiKTsgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUuc2xpY2UoKS5zb3J0KHNvcnRGdW5jKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYWRkUXVlcnlcbiAgICogVGFrZXMgdGhlIGlucHV0IFVSTCBhbmQgYWRkcyAob3IgcmVwbGFjZXMpIHRoZSBmaWVsZCBpbiB0aGUgcXVlcnlcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYWRkUXVlcnknLCBmdW5jdGlvbih2YWx1ZSwgcXVlcnlGaWVsZCwgcXVlcnlWYWx1ZSkge1xuICAgIHZhciB1cmwgPSB2YWx1ZSB8fCBsb2NhdGlvbi5ocmVmO1xuICAgIHZhciBwYXJ0cyA9IHVybC5zcGxpdCgnPycpO1xuICAgIHVybCA9IHBhcnRzWzBdO1xuICAgIHZhciBxdWVyeSA9IHBhcnRzWzFdO1xuICAgIHZhciBhZGRlZFF1ZXJ5ID0gJyc7XG4gICAgaWYgKHF1ZXJ5VmFsdWUgIT0gbnVsbCkge1xuICAgICAgYWRkZWRRdWVyeSA9IHF1ZXJ5RmllbGQgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQocXVlcnlWYWx1ZSk7XG4gICAgfVxuXG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB2YXIgZXhwciA9IG5ldyBSZWdFeHAoJ1xcXFxiJyArIHF1ZXJ5RmllbGQgKyAnPVteJl0qJyk7XG4gICAgICBpZiAoZXhwci50ZXN0KHF1ZXJ5KSkge1xuICAgICAgICBxdWVyeSA9IHF1ZXJ5LnJlcGxhY2UoZXhwciwgYWRkZWRRdWVyeSk7XG4gICAgICB9IGVsc2UgaWYgKGFkZGVkUXVlcnkpIHtcbiAgICAgICAgcXVlcnkgKz0gJyYnICsgYWRkZWRRdWVyeTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnkgPSBhZGRlZFF1ZXJ5O1xuICAgIH1cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHVybCArPSAnPycgKyBxdWVyeTtcbiAgICB9XG4gICAgcmV0dXJuIHVybDtcbiAgfSk7XG5cblxuICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcbiAgZnVuY3Rpb24gZXNjYXBlSFRNTCh2YWx1ZSkge1xuICAgIGRpdi50ZXh0Q29udGVudCA9IHZhbHVlIHx8ICcnO1xuICAgIHJldHVybiBkaXYuaW5uZXJIVE1MO1xuICB9XG5cblxuICAvKipcbiAgICogIyMgZXNjYXBlXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50LiBGb3IgdXNlIHdpdGggb3RoZXIgSFRNTC1hZGRpbmcgZm9ybWF0dGVycyBzdWNoIGFzIGF1dG9saW5rLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGVzY2FwZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdlc2NhcGUnLCBlc2NhcGVIVE1MKTtcblxuXG4gIC8qKlxuICAgKiAjIyBwXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IHdyYXBwaW5nIHBhcmFncmFwaHMgaW4gPHA+IHRhZ3MuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgcCB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9wPlxuICAgKiA8cD5JdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcigncCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGxpbmVzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIHZhciBlc2NhcGVkID0gbGluZXMubWFwKGZ1bmN0aW9uKGxpbmUpIHsgcmV0dXJuIGVzY2FwZUhUTUwobGluZSkgfHwgJzxicj4nOyB9KTtcbiAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD48cD4nKSArICc8L3A+JztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYnJcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxicj4gdGFncyBpbiBwbGFjZSBvZiBuZXdsaW5lcyBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGJyIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8YnI+XG4gICAqIEl0J3MgZ3JlYXQ8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2JyJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgbGluZXMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+Jyk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG5ld2xpbmVcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxwPiB0YWdzIGF0IGRvdWJsZSBuZXdsaW5lcyBhbmQgPGJyPiB0YWdzIGluIHBsYWNlIG9mIHNpbmdsZSBuZXdsaW5lIGNoYXJhY3RlcnMuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgbmV3bGluZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbmV3bGluZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIHBhcmFncmFwaHMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuXFxzKlxccj9cXG4vKTtcbiAgICB2YXIgZXNjYXBlZCA9IHBhcmFncmFwaHMubWFwKGZ1bmN0aW9uKHBhcmFncmFwaCkge1xuICAgICAgdmFyIGxpbmVzID0gcGFyYWdyYXBoLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICByZXR1cm4gbGluZXMubWFwKGVzY2FwZUhUTUwpLmpvaW4oJzxicj4nKTtcbiAgICB9KTtcbiAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD48cD4nKSArICc8L3A+JztcbiAgfSk7XG5cblxuXG4gIHZhciB1cmxFeHAgPSAvKF58XFxzfFxcKCkoKD86aHR0cHM/fGZ0cCk6XFwvXFwvW1xcLUEtWjAtOStcXHUwMDI2QCNcXC8lPz0oKX5ffCE6LC47XSpbXFwtQS1aMC05K1xcdTAwMjZAI1xcLyU9fihffF0pL2dpO1xuICAvKipcbiAgICogIyMgYXV0b2xpbmtcbiAgICogQWRkcyBhdXRvbWF0aWMgbGlua3MgdG8gZXNjYXBlZCBjb250ZW50IChiZSBzdXJlIHRvIGVzY2FwZSB1c2VyIGNvbnRlbnQpLiBDYW4gYmUgdXNlZCBvbiBleGlzdGluZyBIVE1MIGNvbnRlbnQgYXMgaXRcbiAgICogd2lsbCBza2lwIFVSTHMgd2l0aGluIEhUTUwgdGFncy4gUGFzc2luZyB0cnVlIGluIHRoZSBzZWNvbmQgcGFyYW1ldGVyIHdpbGwgc2V0IHRoZSB0YXJnZXQgdG8gYF9ibGFua2AuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2F1dG9saW5rJywgZnVuY3Rpb24odmFsdWUsIHRhcmdldCkge1xuICAgIHRhcmdldCA9ICh0YXJnZXQpID8gJyB0YXJnZXQ9XCJfYmxhbmtcIicgOiAnJztcblxuICAgIHJldHVybiAoJycgKyB2YWx1ZSkucmVwbGFjZSgvPFtePl0rPnxbXjxdKy9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgaWYgKG1hdGNoLmNoYXJBdCgwKSA9PT0gJzwnKSB7XG4gICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgIH1cbiAgICAgIHJldHVybiBtYXRjaC5yZXBsYWNlKHVybEV4cCwgJyQxPGEgaHJlZj1cIiQyXCInICsgdGFyZ2V0ICsgJz4kMjwvYT4nKTtcbiAgICB9KTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignaW50JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YWx1ZSA9IHBhcnNlSW50KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdmbG9hdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFsdWUgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdib29sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdmFsdWUgIT09ICcwJyAmJiB2YWx1ZSAhPT0gJ2ZhbHNlJztcbiAgfSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFRlbXBsYXRlO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cblxuLyoqXG4gKiAjIyBUZW1wbGF0ZVxuICogVGFrZXMgYW4gSFRNTCBzdHJpbmcsIGFuIGVsZW1lbnQsIGFuIGFycmF5IG9mIGVsZW1lbnRzLCBvciBhIGRvY3VtZW50IGZyYWdtZW50LCBhbmQgY29tcGlsZXMgaXQgaW50byBhIHRlbXBsYXRlLlxuICogSW5zdGFuY2VzIG1heSB0aGVuIGJlIGNyZWF0ZWQgYW5kIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gKiBmcm9tIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIG9iamVjdHMuIEFueSBvZiB0aGVzZSB3aWxsIGJlIGNvbnZlcnRlZCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQgZm9yIHRoZSB0ZW1wbGF0ZSB0b1xuICogY2xvbmUuIE5vZGVzIGFuZCBlbGVtZW50cyBwYXNzZWQgaW4gd2lsbCBiZSByZW1vdmVkIGZyb20gdGhlIERPTS5cbiAqL1xuZnVuY3Rpb24gVGVtcGxhdGUoKSB7XG4gIHRoaXMucG9vbCA9IFtdO1xufVxuXG5cblRlbXBsYXRlLnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyB2aWV3IGNsb25lZCBmcm9tIHRoaXMgdGVtcGxhdGUuXG4gICAqL1xuICBjcmVhdGVWaWV3OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5wb29sLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIHRoaXMucG9vbC5wb3AoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXh0ZW5kLm1ha2UoVmlldywgZG9jdW1lbnQuaW1wb3J0Tm9kZSh0aGlzLCB0cnVlKSwgdGhpcyk7XG4gIH1cbn07XG4iLCIvLyBIZWxwZXIgbWV0aG9kcyBmb3IgYW5pbWF0aW9uXG5leHBvcnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZSA9IG1ha2VFbGVtZW50QW5pbWF0YWJsZTtcbmV4cG9ydHMuZ2V0Q29tcHV0ZWRDU1MgPSBnZXRDb21wdXRlZENTUztcbmV4cG9ydHMuYW5pbWF0ZUVsZW1lbnQgPSBhbmltYXRlRWxlbWVudDtcblxuZnVuY3Rpb24gbWFrZUVsZW1lbnRBbmltYXRhYmxlKGVsZW1lbnQpIHtcbiAgLy8gQWRkIHBvbHlmaWxsIGp1c3Qgb24gdGhpcyBlbGVtZW50XG4gIGlmICghZWxlbWVudC5hbmltYXRlKSB7XG4gICAgZWxlbWVudC5hbmltYXRlID0gYW5pbWF0ZUVsZW1lbnQ7XG4gIH1cblxuICAvLyBOb3QgYSBwb2x5ZmlsbCBidXQgYSBoZWxwZXJcbiAgaWYgKCFlbGVtZW50LmdldENvbXB1dGVkQ1NTKSB7XG4gICAgZWxlbWVudC5nZXRDb21wdXRlZENTUyA9IGdldENvbXB1dGVkQ1NTO1xuICB9XG59XG5cbi8qKlxuICogR2V0IHRoZSBjb21wdXRlZCBzdHlsZSBvbiBhbiBlbGVtZW50LlxuICovXG5mdW5jdGlvbiBnZXRDb21wdXRlZENTUyhzdHlsZU5hbWUpIHtcbiAgaWYgKHRoaXMub3duZXJEb2N1bWVudC5kZWZhdWx0Vmlldy5vcGVuZXIpIHtcbiAgICByZXR1cm4gdGhpcy5vd25lckRvY3VtZW50LmRlZmF1bHRWaWV3LmdldENvbXB1dGVkU3R5bGUodGhpcylbc3R5bGVOYW1lXTtcbiAgfVxuICByZXR1cm4gd2luZG93LmdldENvbXB1dGVkU3R5bGUodGhpcylbc3R5bGVOYW1lXTtcbn1cblxuLyoqXG4gKiBWZXJ5IGJhc2ljIHBvbHlmaWxsIGZvciBFbGVtZW50LmFuaW1hdGUgaWYgaXQgZG9lc24ndCBleGlzdC4gSWYgaXQgZG9lcywgdXNlIHRoZSBuYXRpdmUuXG4gKiBUaGlzIG9ubHkgc3VwcG9ydHMgdHdvIGNzcyBzdGF0ZXMuIEl0IHdpbGwgb3ZlcndyaXRlIGV4aXN0aW5nIHN0eWxlcy4gSXQgZG9lc24ndCByZXR1cm4gYW4gYW5pbWF0aW9uIHBsYXkgY29udHJvbC4gSXRcbiAqIG9ubHkgc3VwcG9ydHMgZHVyYXRpb24sIGRlbGF5LCBhbmQgZWFzaW5nLiBSZXR1cm5zIGFuIG9iamVjdCB3aXRoIGEgcHJvcGVydHkgb25maW5pc2guXG4gKi9cbmZ1bmN0aW9uIGFuaW1hdGVFbGVtZW50KGNzcywgb3B0aW9ucykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY3NzKSB8fCBjc3MubGVuZ3RoICE9PSAyKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYW5pbWF0ZSBwb2x5ZmlsbCByZXF1aXJlcyBhbiBhcnJheSBmb3IgY3NzIHdpdGggYW4gaW5pdGlhbCBhbmQgZmluYWwgc3RhdGUnKTtcbiAgfVxuXG4gIGlmICghb3B0aW9ucyB8fCAhb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnZHVyYXRpb24nKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2FuaW1hdGUgcG9seWZpbGwgcmVxdWlyZXMgb3B0aW9ucyB3aXRoIGEgZHVyYXRpb24nKTtcbiAgfVxuXG4gIHZhciBkdXJhdGlvbiA9IG9wdGlvbnMuZHVyYXRpb24gfHwgMDtcbiAgdmFyIGRlbGF5ID0gb3B0aW9ucy5kZWxheSB8fCAwO1xuICB2YXIgZWFzaW5nID0gb3B0aW9ucy5lYXNpbmc7XG4gIHZhciBpbml0aWFsQ3NzID0gY3NzWzBdO1xuICB2YXIgZmluYWxDc3MgPSBjc3NbMV07XG4gIHZhciBhbGxDc3MgPSB7fTtcbiAgdmFyIHBsYXliYWNrID0geyBvbmZpbmlzaDogbnVsbCB9O1xuXG4gIE9iamVjdC5rZXlzKGluaXRpYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGluaXRpYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgLy8gdHJpZ2dlciByZWZsb3dcbiAgZWxlbWVudC5vZmZzZXRXaWR0aDtcblxuICB2YXIgdHJhbnNpdGlvbk9wdGlvbnMgPSAnICcgKyBkdXJhdGlvbiArICdtcyc7XG4gIGlmIChlYXNpbmcpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBlYXNpbmc7XG4gIH1cbiAgaWYgKGRlbGF5KSB7XG4gICAgdHJhbnNpdGlvbk9wdGlvbnMgKz0gJyAnICsgZGVsYXkgKyAnbXMnO1xuICB9XG5cbiAgZWxlbWVudC5zdHlsZS50cmFuc2l0aW9uID0gT2JqZWN0LmtleXMoZmluYWxDc3MpLm1hcChmdW5jdGlvbihrZXkpIHtcbiAgICByZXR1cm4ga2V5ICsgdHJhbnNpdGlvbk9wdGlvbnNcbiAgfSkuam9pbignLCAnKTtcblxuICBPYmplY3Qua2V5cyhmaW5hbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gZmluYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBPYmplY3Qua2V5cyhhbGxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSAnJztcbiAgICB9KTtcblxuICAgIGlmIChwbGF5YmFjay5vbmZpbmlzaCkge1xuICAgICAgcGxheWJhY2sub25maW5pc2goKTtcbiAgICB9XG4gIH0sIGR1cmF0aW9uICsgZGVsYXkpO1xuXG4gIHJldHVybiBwbGF5YmFjaztcbn1cbiIsInZhciBnbG9iYWwgPSAoZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzIH0pKCk7XG52YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZDtcbmV4dGVuZC5tYWtlID0gbWFrZTtcblxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgcHJvdG90eXBlIGZvciB0aGUgZ2l2ZW4gY29udHJ1Y3RvciBhbmQgc2V0cyBhbiBgZXh0ZW5kYCBtZXRob2Qgb24gaXQuIElmIGBleHRlbmRgIGlzIGNhbGxlZCBmcm9tIGFcbiAqIGl0IHdpbGwgZXh0ZW5kIHRoYXQgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGV4dGVuZChjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBzdXBlckNsYXNzID0gdGhpcyA9PT0gZ2xvYmFsID8gT2JqZWN0IDogdGhpcztcbiAgaWYgKHR5cGVvZiBjb25zdHJ1Y3RvciAhPT0gJ2Z1bmN0aW9uJyAmJiAhcHJvdG90eXBlKSB7XG4gICAgcHJvdG90eXBlID0gY29uc3RydWN0b3I7XG4gICAgY29uc3RydWN0b3IgPSBmdW5jdGlvbigpIHtcbiAgICAgIHN1cGVyQ2xhc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9XG4gIGNvbnN0cnVjdG9yLmV4dGVuZCA9IGV4dGVuZDtcbiAgdmFyIGRlc2NyaXB0b3JzID0gZ2V0UHJvdG90eXBlRGVzY3JpcHRvcnMoY29uc3RydWN0b3IsIHByb3RvdHlwZSk7XG4gIGNvbnN0cnVjdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoc3VwZXJDbGFzcy5wcm90b3R5cGUsIGRlc2NyaXB0b3JzKTtcbiAgcmV0dXJuIGNvbnN0cnVjdG9yO1xufVxuXG5cbi8qKlxuICogTWFrZXMgYSBuYXRpdmUgb2JqZWN0IHByZXRlbmQgdG8gYmUgYSBjbGFzcyAoZS5nLiBhZGRzIG1ldGhvZHMgdG8gYSBEb2N1bWVudEZyYWdtZW50IGFuZCBjYWxscyB0aGUgY29uc3RydWN0b3IpLlxuICovXG5mdW5jdGlvbiBtYWtlKGNvbnN0cnVjdG9yLCBvYmplY3QpIHtcbiAgaWYgKHR5cGVvZiBjb25zdHJ1Y3RvciAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2UgbXVzdCBhY2NlcHQgYSBmdW5jdGlvbiBjb25zdHJ1Y3RvciBhbmQgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gIHZhciBwcm90byA9IGNvbnN0cnVjdG9yLnByb3RvdHlwZTtcbiAgZm9yICh2YXIga2V5IGluIHByb3RvKSB7XG4gICAgb2JqZWN0W2tleV0gPSBwcm90b1trZXldO1xuICB9XG4gIGNvbnN0cnVjdG9yLmFwcGx5KG9iamVjdCwgYXJncyk7XG4gIHJldHVybiBvYmplY3Q7XG59XG5cblxuZnVuY3Rpb24gZ2V0UHJvdG90eXBlRGVzY3JpcHRvcnMoY29uc3RydWN0b3IsIHByb3RvdHlwZSkge1xuICB2YXIgZGVzY3JpcHRvcnMgPSB7XG4gICAgY29uc3RydWN0b3I6IHsgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IGNvbnN0cnVjdG9yIH1cbiAgfTtcblxuICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhwcm90b3R5cGUpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90b3R5cGUsIG5hbWUpO1xuICAgIGRlc2NyaXB0b3IuZW51bWVyYWJsZSA9IGZhbHNlO1xuICAgIGRlc2NyaXB0b3JzW25hbWVdID0gZGVzY3JpcHRvcjtcbiAgfSk7XG4gIHJldHVybiBkZXNjcmlwdG9ycztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gdG9GcmFnbWVudDtcblxuLy8gQ29udmVydCBzdHVmZiBpbnRvIGRvY3VtZW50IGZyYWdtZW50cy4gU3R1ZmYgY2FuIGJlOlxuLy8gKiBBIHN0cmluZyBvZiBIVE1MIHRleHRcbi8vICogQW4gZWxlbWVudCBvciB0ZXh0IG5vZGVcbi8vICogQSBOb2RlTGlzdCBvciBIVE1MQ29sbGVjdGlvbiAoZS5nLiBgZWxlbWVudC5jaGlsZE5vZGVzYCBvciBgZWxlbWVudC5jaGlsZHJlbmApXG4vLyAqIEEgalF1ZXJ5IG9iamVjdFxuLy8gKiBBIHNjcmlwdCBlbGVtZW50IHdpdGggYSBgdHlwZWAgYXR0cmlidXRlIG9mIGBcInRleHQvKlwiYCAoZS5nLiBgPHNjcmlwdCB0eXBlPVwidGV4dC9odG1sXCI+TXkgdGVtcGxhdGUgY29kZSE8L3NjcmlwdD5gKVxuLy8gKiBBIHRlbXBsYXRlIGVsZW1lbnQgKGUuZy4gYDx0ZW1wbGF0ZT5NeSB0ZW1wbGF0ZSBjb2RlITwvdGVtcGxhdGU+YClcbmZ1bmN0aW9uIHRvRnJhZ21lbnQoaHRtbCkge1xuICBpZiAoaHRtbCBpbnN0YW5jZW9mIERvY3VtZW50RnJhZ21lbnQpIHtcbiAgICByZXR1cm4gaHRtbDtcbiAgfSBlbHNlIGlmICh0eXBlb2YgaHRtbCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gc3RyaW5nVG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIGlmIChodG1sIGluc3RhbmNlb2YgTm9kZSkge1xuICAgIHJldHVybiBub2RlVG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIGlmIChodG1sLmhhc093blByb3BlcnR5KCdsZW5ndGgnKSkge1xuICAgIHJldHVybiBsaXN0VG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbnN1cHBvcnRlZCBUZW1wbGF0ZSBUeXBlOiBDYW5ub3QgY29udmVydCBgJyArIGh0bWwgKyAnYCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuJyk7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTCBub2RlIGludG8gYSBkb2N1bWVudCBmcmFnbWVudC4gSWYgaXQgaXMgYSA8dGVtcGxhdGU+IG5vZGUgaXRzIGNvbnRlbnRzIHdpbGwgYmUgdXNlZC4gSWYgaXQgaXMgYVxuLy8gPHNjcmlwdD4gbm9kZSBpdHMgc3RyaW5nLWJhc2VkIGNvbnRlbnRzIHdpbGwgYmUgY29udmVydGVkIHRvIEhUTUwgZmlyc3QsIHRoZW4gdXNlZC4gT3RoZXJ3aXNlIGEgY2xvbmUgb2YgdGhlIG5vZGVcbi8vIGl0c2VsZiB3aWxsIGJlIHVzZWQuXG5mdW5jdGlvbiBub2RlVG9GcmFnbWVudChub2RlKSB7XG4gIGlmIChub2RlLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIG5vZGUuY29udGVudDtcbiAgfSBlbHNlIGlmIChub2RlLnRhZ05hbWUgPT09ICdTQ1JJUFQnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQobm9kZS5pbm5lckhUTUwpO1xuICB9IGVsc2Uge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBpZiAobm9kZS50YWdOYW1lID09PSAnVEVNUExBVEUnKSB7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbCA9IG5vZGUuY2hpbGROb2Rlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZS5jaGlsZE5vZGVzW2ldKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgfVxuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxufVxuXG4vLyBDb252ZXJ0cyBhbiBIVE1MQ29sbGVjdGlvbiwgTm9kZUxpc3QsIGpRdWVyeSBvYmplY3QsIG9yIGFycmF5IGludG8gYSBkb2N1bWVudCBmcmFnbWVudC5cbmZ1bmN0aW9uIGxpc3RUb0ZyYWdtZW50KGxpc3QpIHtcbiAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICBmb3IgKHZhciBpID0gMCwgbCA9IGxpc3QubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgLy8gVXNlIHRvRnJhZ21lbnQgc2luY2UgdGhpcyBtYXkgYmUgYW4gYXJyYXkgb2YgdGV4dCwgYSBqUXVlcnkgb2JqZWN0IG9mIGA8dGVtcGxhdGU+YHMsIGV0Yy5cbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh0b0ZyYWdtZW50KGxpc3RbaV0pKTtcbiAgfVxuICByZXR1cm4gZnJhZ21lbnQ7XG59XG5cbi8vIENvbnZlcnRzIGEgc3RyaW5nIG9mIEhUTUwgdGV4dCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG5mdW5jdGlvbiBzdHJpbmdUb0ZyYWdtZW50KHN0cmluZykge1xuICB2YXIgdGVtcGxhdGVFbGVtZW50O1xuICB0ZW1wbGF0ZUVsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpO1xuICB0ZW1wbGF0ZUVsZW1lbnQuaW5uZXJIVE1MID0gc3RyaW5nO1xuICByZXR1cm4gdGVtcGxhdGVFbGVtZW50LmNvbnRlbnQ7XG59XG5cbi8vIElmIEhUTUwgVGVtcGxhdGVzIGFyZSBub3QgYXZhaWxhYmxlIChlLmcuIGluIElFKSB0aGVuIHVzZSBhbiBvbGRlciBtZXRob2QgdG8gd29yayB3aXRoIGNlcnRhaW4gZWxlbWVudHMuXG5pZiAoIWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RlbXBsYXRlJykuY29udGVudCBpbnN0YW5jZW9mIERvY3VtZW50RnJhZ21lbnQpIHtcbiAgc3RyaW5nVG9GcmFnbWVudCA9IChmdW5jdGlvbigpIHtcbiAgICB2YXIgdGFnRXhwID0gLzwoW1xcdzotXSspLztcblxuICAgIC8vIENvcGllZCBmcm9tIGpRdWVyeSAoaHR0cHM6Ly9naXRodWIuY29tL2pxdWVyeS9qcXVlcnkvYmxvYi9tYXN0ZXIvTElDRU5TRS50eHQpXG4gICAgdmFyIHdyYXBNYXAgPSB7XG4gICAgICBvcHRpb246IFsgMSwgJzxzZWxlY3QgbXVsdGlwbGU9XCJtdWx0aXBsZVwiPicsICc8L3NlbGVjdD4nIF0sXG4gICAgICBsZWdlbmQ6IFsgMSwgJzxmaWVsZHNldD4nLCAnPC9maWVsZHNldD4nIF0sXG4gICAgICB0aGVhZDogWyAxLCAnPHRhYmxlPicsICc8L3RhYmxlPicgXSxcbiAgICAgIHRyOiBbIDIsICc8dGFibGU+PHRib2R5PicsICc8L3Rib2R5PjwvdGFibGU+JyBdLFxuICAgICAgdGQ6IFsgMywgJzx0YWJsZT48dGJvZHk+PHRyPicsICc8L3RyPjwvdGJvZHk+PC90YWJsZT4nIF0sXG4gICAgICBjb2w6IFsgMiwgJzx0YWJsZT48dGJvZHk+PC90Ym9keT48Y29sZ3JvdXA+JywgJzwvY29sZ3JvdXA+PC90YWJsZT4nIF0sXG4gICAgICBhcmVhOiBbIDEsICc8bWFwPicsICc8L21hcD4nIF0sXG4gICAgICBfZGVmYXVsdDogWyAwLCAnJywgJycgXVxuICAgIH07XG4gICAgd3JhcE1hcC5vcHRncm91cCA9IHdyYXBNYXAub3B0aW9uO1xuICAgIHdyYXBNYXAudGJvZHkgPSB3cmFwTWFwLnRmb290ID0gd3JhcE1hcC5jb2xncm91cCA9IHdyYXBNYXAuY2FwdGlvbiA9IHdyYXBNYXAudGhlYWQ7XG4gICAgd3JhcE1hcC50aCA9IHdyYXBNYXAudGQ7XG5cbiAgICByZXR1cm4gZnVuY3Rpb24gc3RyaW5nVG9GcmFnbWVudChzdHJpbmcpIHtcbiAgICAgIHZhciB0YWcgPSBzdHJpbmcubWF0Y2godGFnRXhwKTtcbiAgICAgIHZhciBwYXJ0cyA9IHdyYXBNYXBbdGFnXSB8fCB3cmFwTWFwLl9kZWZhdWx0O1xuICAgICAgdmFyIGRlcHRoID0gcGFydHNbMF07XG4gICAgICB2YXIgcHJlZml4ID0gcGFydHNbMV07XG4gICAgICB2YXIgcG9zdGZpeCA9IHBhcnRzWzJdO1xuICAgICAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgZGl2LmlubmVySFRNTCA9IHByZWZpeCArIHN0cmluZyArIHBvc3RmaXg7XG4gICAgICB3aGlsZSAoZGVwdGgtLSkge1xuICAgICAgICBkaXYgPSBkaXYubGFzdENoaWxkO1xuICAgICAgfVxuICAgICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgd2hpbGUgKGRpdi5maXJzdENoaWxkKSB7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKGRpdi5maXJzdENoaWxkKTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBmcmFnbWVudDtcbiAgICB9O1xuICB9KSgpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBWaWV3O1xuXG5cbi8qKlxuICogIyMgVmlld1xuICogQSBEb2N1bWVudEZyYWdtZW50IHdpdGggYmluZGluZ3MuXG4gKi9cbmZ1bmN0aW9uIFZpZXcodGVtcGxhdGUpIHtcbiAgdGhpcy50ZW1wbGF0ZSA9IHRlbXBsYXRlO1xuICB0aGlzLmZpcnN0Vmlld05vZGUgPSB0aGlzLmZpcnN0Q2hpbGQ7XG4gIHRoaXMubGFzdFZpZXdOb2RlID0gdGhpcy5sYXN0Q2hpbGQ7XG4gIHRoaXMuZmlyc3RWaWV3Tm9kZS52aWV3ID0gdGhpcztcbiAgdGhpcy5sYXN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gIHRoaXMuYmluZGluZ3MgPSB0aGlzLnRlbXBsYXRlLmJpbmRpbmdzLm1hcChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgcmV0dXJuIGJpbmRpbmcuY2xvbmVGb3JWaWV3KHRoaXMpO1xuICB9LCB0aGlzKTtcbn1cblxuXG5WaWV3LnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgZnJvbSB0aGUgRE9NLiBBIHZpZXcgaXMgYSBEb2N1bWVudEZyYWdtZW50LCBzbyBgcmVtb3ZlKClgIHJldHVybnMgYWxsIGl0cyBub2RlcyB0byBpdHNlbGYuXG4gICAqL1xuICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub2RlID0gdGhpcy5maXJzdFZpZXdOb2RlO1xuICAgIHZhciBuZXh0O1xuXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gdGhpcykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCB0aGUgbm9kZXMgYW5kIHB1dCB0aGVtIGJhY2sgaW50byB0aGlzIGZyYWdtZW50XG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBuZXh0ID0gKG5vZGUgPT09IHRoaXMubGFzdFZpZXdOb2RlKSA/IG51bGwgOiBub2RlLm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgdmlldyAoaWYgbm90IGFscmVhZHkgcmVtb3ZlZCkgYW5kIGFkZHMgdGhlIHZpZXcgdG8gaXRzIHRlbXBsYXRlJ3MgcG9vbC5cbiAgICovXG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgdmlldyBpcyByZW1vdmVkIGZyb20gdGhlIERPTVxuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgdGhpcy51bmJpbmQoKTtcbiAgICBpZiAodGhpcy50ZW1wbGF0ZSkge1xuICAgICAgdGhpcy50ZW1wbGF0ZS5wb29sLnB1c2godGhpcyk7XG4gICAgfVxuICB9LFxuXG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgdmlldyB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqL1xuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgdGhpcy5iaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICAgIGJpbmRpbmcuYmluZChjb250ZXh0KTtcbiAgICB9KTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbmJpbmRzIGEgdmlldyBmcm9tIGFueSBjb250ZXh0LlxuICAgKi9cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy51bmJpbmQoKTtcbiAgICB9KTtcbiAgfVxufTtcbiIsInZhciBGcmFnbWVudHMgPSByZXF1aXJlKCcuL3NyYy9mcmFnbWVudHMnKTtcbnZhciBPYnNlcnZlciA9IHJlcXVpcmUoJy4vc3JjL29ic2VydmVyJyk7XG5cbi8vIENyZWF0ZSBhbiBpbnN0YW5jZSBvZiBmcmFnbWVudHMgd2l0aCB0aGUgZGVmYXVsdCBvYnNlcnZlclxudmFyIGZyYWdtZW50cyA9IG5ldyBGcmFnbWVudHMoT2JzZXJ2ZXIpO1xuZnJhZ21lbnRzLmV4cHJlc3Npb24gPSBPYnNlcnZlci5leHByZXNzaW9uO1xuZnJhZ21lbnRzLnN5bmMgPSBPYnNlcnZlci5zeW5jO1xubW9kdWxlLmV4cG9ydHMgPSBmcmFnbWVudHM7XG4iXX0=
