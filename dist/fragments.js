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

      var duration = getDuration.call(this, node);
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


function getDuration(node) {
  var milliseconds = this.clonedFrom.__animationDuration__;
  if (milliseconds == null) {
    var styles = window.getComputedStyle(node);
    var seconds = Math.max(parseFloat(styles[transitionDurationName]) + parseFloat(styles[transitionDelayName]),
                           parseFloat(styles[animationDurationName]) + parseFloat(styles[animationDelayName]));
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
  return b[0].priority - a[0].priority;
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
    if (definition.priority == null) {
      definition.priority = 0;
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvZGlmZi5qcyIsInNyYy9vYnNlcnZlci9leHByZXNzaW9uLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIiwiaW5kZXguanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7QUNBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9JQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxa0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFlBO0FBQ0E7QUFDQTtBQUNBOztBQ0hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcE1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOUlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2h6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFlBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDL0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gQW5pbWF0ZWRCaW5kaW5nO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyk7XG52YXIgX3N1cGVyID0gQmluZGluZy5wcm90b3R5cGU7XG5cbi8qKlxuICogQmluZGluZ3Mgd2hpY2ggZXh0ZW5kIEFuaW1hdGVkQmluZGluZyBoYXZlIHRoZSBhYmlsaXR5IHRvIGFuaW1hdGUgZWxlbWVudHMgdGhhdCBhcmUgYWRkZWQgdG8gdGhlIERPTSBhbmQgcmVtb3ZlZCBmcm9tXG4gKiB0aGUgRE9NLiBUaGlzIGFsbG93cyBtZW51cyB0byBzbGlkZSBvcGVuIGFuZCBjbG9zZWQsIGVsZW1lbnRzIHRvIGZhZGUgaW4gb3IgZHJvcCBkb3duLCBhbmQgcmVwZWF0ZWQgaXRlbXMgdG8gYXBwZWFyXG4gKiB0byBtb3ZlIChpZiB5b3UgZ2V0IGNyZWF0aXZlIGVub3VnaCkuXG4gKlxuICogVGhlIGZvbGxvd2luZyA1IG1ldGhvZHMgYXJlIGhlbHBlciBET00gbWV0aG9kcyB0aGF0IGFsbG93IHJlZ2lzdGVyZWQgYmluZGluZ3MgdG8gd29yayB3aXRoIENTUyB0cmFuc2l0aW9ucyBmb3JcbiAqIGFuaW1hdGluZyBlbGVtZW50cy4gSWYgYW4gZWxlbWVudCBoYXMgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgb3IgYSBtYXRjaGluZyBKYXZhU2NyaXB0IG1ldGhvZCwgdGhlc2UgaGVscGVyIG1ldGhvZHNcbiAqIHdpbGwgc2V0IGEgY2xhc3Mgb24gdGhlIG5vZGUgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uIGFuZC9vciBjYWxsIHRoZSBKYXZhU2NyaXB0IG1ldGhvZHMgdG8gaGFuZGxlIGl0LlxuICpcbiAqIEFuIGFuaW1hdGlvbiBtYXkgYmUgZWl0aGVyIGEgQ1NTIHRyYW5zaXRpb24sIGEgQ1NTIGFuaW1hdGlvbiwgb3IgYSBzZXQgb2YgSmF2YVNjcmlwdCBtZXRob2RzIHRoYXQgd2lsbCBiZSBjYWxsZWQuXG4gKlxuICogSWYgdXNpbmcgQ1NTLCBjbGFzc2VzIGFyZSBhZGRlZCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBlbGVtZW50LiBXaGVuIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaXQgd2lsbCByZWNlaXZlIHRoZSBgd2lsbC1cbiAqIGFuaW1hdGUtaW5gIGNsYXNzIGJlZm9yZSBiZWluZyBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYGFuaW1hdGUtaW5gIGNsYXNzIGltbWVkaWF0ZWx5IGFmdGVyIGJlaW5nXG4gKiBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGJvdGggY2xhc2VzIHdpbGwgYmUgcmVtb3ZlZCBhZnRlciB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLiBXaGVuIGFuIGVsZW1lbnQgaXMgYmVpbmcgcmVtb3ZlZFxuICogZnJvbSB0aGUgRE9NIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtYW5pbWF0ZS1vdXRgIGFuZCBgYW5pbWF0ZS1vdXRgIGNsYXNzZXMsIHRoZW4gdGhlIGNsYXNzZXMgd2lsbCBiZSByZW1vdmVkIG9uY2VcbiAqIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuXG4gKlxuICogSWYgdXNpbmcgSmF2YVNjcmlwdCwgbWV0aG9kcyBtdXN0IGJlIGRlZmluZWQgIHRvIGFuaW1hdGUgdGhlIGVsZW1lbnQgdGhlcmUgYXJlIDMgc3VwcG9ydGVkIG1ldGhvZHMgd2hpY2ggY2FuIGJcbiAqXG4gKiBUT0RPIGNhY2hlIGJ5IGNsYXNzLW5hbWUgKEFuZ3VsYXIpPyBPbmx5IHN1cHBvcnQgamF2YXNjcmlwdC1zdHlsZSAoRW1iZXIpPyBBZGQgYSBgd2lsbC1hbmltYXRlLWluYCBhbmRcbiAqIGBkaWQtYW5pbWF0ZS1pbmAgZXRjLj9cbiAqIElGIGhhcyBhbnkgY2xhc3NlcywgYWRkIHRoZSBgd2lsbC1hbmltYXRlLWlufG91dGAgYW5kIGdldCBjb21wdXRlZCBkdXJhdGlvbi4gSWYgbm9uZSwgcmV0dXJuLiBDYWNoZS5cbiAqIFJVTEUgaXMgdXNlIHVuaXF1ZSBjbGFzcyB0byBkZWZpbmUgYW4gYW5pbWF0aW9uLiBPciBhdHRyaWJ1dGUgYGFuaW1hdGU9XCJmYWRlXCJgIHdpbGwgYWRkIHRoZSBjbGFzcz9cbiAqIGAuZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLmZhZGUuYW5pbWF0ZS1pbmAsIGAuZmFkZS53aWxsLWFuaW1hdGUtb3V0YCwgYC5mYWRlLmFuaW1hdGUtb3V0YFxuICpcbiAqIEV2ZW50cyB3aWxsIGJlIHRyaWdnZXJlZCBvbiB0aGUgZWxlbWVudHMgbmFtZWQgdGhlIHNhbWUgYXMgdGhlIGNsYXNzIG5hbWVzIChlLmcuIGBhbmltYXRlLWluYCkgd2hpY2ggbWF5IGJlIGxpc3RlbmVkXG4gKiB0byBpbiBvcmRlciB0byBjYW5jZWwgYW4gYW5pbWF0aW9uIG9yIHJlc3BvbmQgdG8gaXQuXG4gKlxuICogSWYgdGhlIG5vZGUgaGFzIG1ldGhvZHMgYGFuaW1hdGVJbihkb25lKWAsIGBhbmltYXRlT3V0KGRvbmUpYCwgYGFuaW1hdGVNb3ZlSW4oZG9uZSlgLCBvciBgYW5pbWF0ZU1vdmVPdXQoZG9uZSlgXG4gKiBkZWZpbmVkIG9uIHRoZW0gdGhlbiB0aGUgaGVscGVycyB3aWxsIGFsbG93IGFuIGFuaW1hdGlvbiBpbiBKYXZhU2NyaXB0IHRvIGJlIHJ1biBhbmQgd2FpdCBmb3IgdGhlIGBkb25lYCBmdW5jdGlvbiB0b1xuICogYmUgY2FsbGVkIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIEJlIHN1cmUgdG8gYWN0dWFsbHkgaGF2ZSBhbiBhbmltYXRpb24gZGVmaW5lZCBmb3IgZWxlbWVudHMgd2l0aCB0aGUgYGFuaW1hdGVgIGNsYXNzL2F0dHJpYnV0ZSBiZWNhdXNlIHRoZSBoZWxwZXJzIHVzZVxuICogdGhlIGB0cmFuc2l0aW9uZW5kYCBhbmQgYGFuaW1hdGlvbmVuZGAgZXZlbnRzIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGZpbmlzaGVkLCBhbmQgaWYgdGhlcmUgaXMgbm8gYW5pbWF0aW9uXG4gKiB0aGVzZSBldmVudHMgd2lsbCBuZXZlciBiZSB0cmlnZ2VyZWQgYW5kIHRoZSBvcGVyYXRpb24gd2lsbCBuZXZlciBjb21wbGV0ZS5cbiAqL1xuZnVuY3Rpb24gQW5pbWF0ZWRCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgdmFyIGVsZW1lbnQgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHZhciBhbmltYXRlID0gZWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2FuaW1hdGUnKTtcbiAgdmFyIGZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuXG4gIGlmIChhbmltYXRlICE9PSBudWxsKSB7XG4gICAgaWYgKGVsZW1lbnQubm9kZU5hbWUgPT09ICdURU1QTEFURScgfHwgZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1NDUklQVCcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGFuaW1hdGUgbXVsdGlwbGUgbm9kZXMgaW4gYSB0ZW1wbGF0ZSBvciBzY3JpcHQuIFJlbW92ZSB0aGUgW2FuaW1hdGVdIGF0dHJpYnV0ZS4nKTtcbiAgICB9XG5cbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQWxsb3cgbXVsdGlwbGUgYmluZGluZ3MgdG8gYW5pbWF0ZSBieSBub3QgcmVtb3ZpbmcgdW50aWwgdGhleSBoYXZlIGFsbCBiZWVuIGNyZWF0ZWRcbiAgICAgIGVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdhbmltYXRlJyk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFuaW1hdGUgPSB0cnVlO1xuXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCBhbmltYXRlKSkge1xuICAgICAgLy8gamF2YXNjcmlwdCBhbmltYXRpb25cbiAgICAgIHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbihhbmltYXRlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGFuaW1hdGVbMF0gPT09ICcuJykge1xuICAgICAgICAvLyBjbGFzcyBhbmltYXRpb25cbiAgICAgICAgdGhpcy5hbmltYXRlQ2xhc3NOYW1lID0gYW5pbWF0ZS5zbGljZSgxKTtcbiAgICAgIH0gZWxzZSBpZiAoYW5pbWF0ZSkge1xuICAgICAgICAvLyByZWdpc3RlcmVkIGFuaW1hdGlvblxuICAgICAgICB2YXIgYW5pbWF0ZU9iamVjdCA9IGZyYWdtZW50cy5nZXRBbmltYXRpb24oYW5pbWF0ZSk7XG4gICAgICAgIGlmICh0eXBlb2YgYW5pbWF0ZU9iamVjdCA9PT0gJ2Z1bmN0aW9uJykgYW5pbWF0ZU9iamVjdCA9IG5ldyBhbmltYXRlT2JqZWN0KHRoaXMpO1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSBhbmltYXRlT2JqZWN0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIEJpbmRpbmcuY2FsbCh0aGlzLCBwcm9wZXJ0aWVzKTtcbn1cblxuXG5CaW5kaW5nLmV4dGVuZChBbmltYXRlZEJpbmRpbmcsIHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgX3N1cGVyLmluaXQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVFeHByZXNzaW9uKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24sIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfVxuICB9LFxuXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09IGNvbnRleHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX3N1cGVyLmJpbmQuY2FsbCh0aGlzLCBjb250ZXh0KTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIuYmluZChjb250ZXh0KTtcbiAgICB9XG4gIH0sXG5cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci51bmJpbmQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIudW5iaW5kKCk7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBIZWxwZXIgbWV0aG9kIHRvIHJlbW92ZSBhIG5vZGUgZnJvbSB0aGUgRE9NLCBhbGxvd2luZyBmb3IgYW5pbWF0aW9ucyB0byBvY2N1ci4gYGNhbGxiYWNrYCB3aWxsIGJlIGNhbGxlZCB3aGVuXG4gICAqIGZpbmlzaGVkLlxuICAgKi9cbiAgYW5pbWF0ZU91dDogZnVuY3Rpb24obm9kZSwgZG9udERpc3Bvc2UsIGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBkb250RGlzcG9zZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgY2FsbGJhY2sgPSBkb250RGlzcG9zZTtcbiAgICAgIGRvbnREaXNwb3NlID0gZmFsc2U7XG4gICAgfVxuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG5cbiAgICB0aGlzLmFuaW1hdGVOb2RlKCdvdXQnLCBub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghZG9udERpc3Bvc2UpIHtcbiAgICAgICAgbm9kZS52aWV3LmRpc3Bvc2UoKTtcbiAgICAgIH1cbiAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbCh0aGlzKTtcbiAgICB9KTtcbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byBpbnNlcnQgYSBub2RlIGluIHRoZSBET00gYmVmb3JlIGFub3RoZXIgbm9kZSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbFxuICAgKiBiZSBjYWxsZWQgd2hlbiBmaW5pc2hlZC4gSWYgYGJlZm9yZWAgaXMgbm90IHByb3ZpZGVkIHRoZW4gdGhlIGFuaW1hdGlvbiB3aWxsIGJlIHJ1biB3aXRob3V0IGluc2VydGluZyB0aGUgbm9kZS5cbiAgICovXG4gIGFuaW1hdGVJbjogZnVuY3Rpb24obm9kZSwgYmVmb3JlLCBjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2YgYmVmb3JlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBjYWxsYmFjayA9IGJlZm9yZTtcbiAgICAgIGJlZm9yZSA9IG51bGw7XG4gICAgfVxuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG4gICAgaWYgKGJlZm9yZSAmJiBiZWZvcmUuZmlyc3RWaWV3Tm9kZSkgYmVmb3JlID0gYmVmb3JlLmZpcnN0Vmlld05vZGU7XG5cbiAgICBpZiAoYmVmb3JlKSB7XG4gICAgICBiZWZvcmUucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUobm9kZSwgYmVmb3JlKTtcbiAgICB9XG4gICAgdGhpcy5hbmltYXRlTm9kZSgnaW4nLCBub2RlLCBjYWxsYmFjaywgdGhpcyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFsbG93IGFuIGVsZW1lbnQgdG8gdXNlIENTUzMgdHJhbnNpdGlvbnMgb3IgYW5pbWF0aW9ucyB0byBhbmltYXRlIGluIG9yIG91dCBvZiB0aGUgcGFnZS5cbiAgICovXG4gIGFuaW1hdGVOb2RlOiBmdW5jdGlvbihkaXJlY3Rpb24sIG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFuaW1hdGVPYmplY3QsIGNsYXNzTmFtZSwgbmFtZSwgd2lsbE5hbWUsIGRpZE5hbWUsIF90aGlzID0gdGhpcztcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYmplY3QgJiYgdHlwZW9mIHRoaXMuYW5pbWF0ZU9iamVjdCA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGFuaW1hdGVPYmplY3QgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFuaW1hdGVDbGFzc05hbWUpIHtcbiAgICAgIGNsYXNzTmFtZSA9IHRoaXMuYW5pbWF0ZUNsYXNzTmFtZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfVxuXG4gICAgaWYgKGFuaW1hdGVPYmplY3QpIHtcbiAgICAgIHZhciBkaXIgPSBkaXJlY3Rpb24gPT09ICdpbicgPyAnSW4nIDogJ091dCc7XG4gICAgICBuYW1lID0gJ2FuaW1hdGUnICsgZGlyO1xuICAgICAgd2lsbE5hbWUgPSAnd2lsbEFuaW1hdGUnICsgZGlyO1xuICAgICAgZGlkTmFtZSA9ICdkaWRBbmltYXRlJyArIGRpcjtcblxuICAgICAgYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZShub2RlKTtcblxuICAgICAgaWYgKGFuaW1hdGVPYmplY3Rbd2lsbE5hbWVdKSB7XG4gICAgICAgIGFuaW1hdGVPYmplY3Rbd2lsbE5hbWVdKG5vZGUpO1xuICAgICAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgICAgICBub2RlLm9mZnNldFdpZHRoID0gbm9kZS5vZmZzZXRXaWR0aDtcbiAgICAgIH1cblxuICAgICAgaWYgKGFuaW1hdGVPYmplY3RbbmFtZV0pIHtcbiAgICAgICAgYW5pbWF0ZU9iamVjdFtuYW1lXShub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAoYW5pbWF0ZU9iamVjdFtkaWROYW1lXSkgYW5pbWF0ZU9iamVjdFtkaWROYW1lXShub2RlKTtcbiAgICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwoX3RoaXMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbmFtZSA9ICdhbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgICB3aWxsTmFtZSA9ICd3aWxsLWFuaW1hdGUtJyArIGRpcmVjdGlvbjtcbiAgICAgIGlmIChjbGFzc05hbWUpIG5vZGUuY2xhc3NMaXN0LmFkZChjbGFzc05hbWUpO1xuXG4gICAgICBub2RlLmNsYXNzTGlzdC5hZGQod2lsbE5hbWUpO1xuXG4gICAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG4gICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUod2lsbE5hbWUpO1xuICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKG5hbWUpO1xuXG4gICAgICB2YXIgZHVyYXRpb24gPSBnZXREdXJhdGlvbi5jYWxsKHRoaXMsIG5vZGUpO1xuICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgbm9kZS5jbGFzc0xpc3QucmVtb3ZlKG5hbWUpO1xuICAgICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgIH0sIGR1cmF0aW9uKTtcbiAgICB9XG4gIH1cbn0pO1xuXG5cbnZhciB0cmFuc2l0aW9uRHVyYXRpb25OYW1lID0gJ3RyYW5zaXRpb25EdXJhdGlvbic7XG52YXIgdHJhbnNpdGlvbkRlbGF5TmFtZSA9ICd0cmFuc2l0aW9uRGVsYXknO1xudmFyIGFuaW1hdGlvbkR1cmF0aW9uTmFtZSA9ICdhbmltYXRpb25EdXJhdGlvbic7XG52YXIgYW5pbWF0aW9uRGVsYXlOYW1lID0gJ2FuaW1hdGlvbkRlbGF5JztcbnZhciBzdHlsZSA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZTtcbmlmIChzdHlsZS50cmFuc2l0aW9uRHVyYXRpb24gPT09IHVuZGVmaW5lZCAmJiBzdHlsZS53ZWJraXRUcmFuc2l0aW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICB0cmFuc2l0aW9uRHVyYXRpb25OYW1lID0gJ3dlYmtpdFRyYW5zaXRpb25EdXJhdGlvbic7XG4gIHRyYW5zaXRpb25EZWxheU5hbWUgPSAnd2Via2l0VHJhbnNpdGlvbkRlbGF5Jztcbn1cbmlmIChzdHlsZS5hbmltYXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlLndlYmtpdEFuaW1hdGlvbkR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ3dlYmtpdEFuaW1hdGlvbkR1cmF0aW9uJztcbiAgYW5pbWF0aW9uRGVsYXlOYW1lID0gJ3dlYmtpdEFuaW1hdGlvbkRlbGF5Jztcbn1cblxuXG5mdW5jdGlvbiBnZXREdXJhdGlvbihub2RlKSB7XG4gIHZhciBtaWxsaXNlY29uZHMgPSB0aGlzLmNsb25lZEZyb20uX19hbmltYXRpb25EdXJhdGlvbl9fO1xuICBpZiAobWlsbGlzZWNvbmRzID09IG51bGwpIHtcbiAgICB2YXIgc3R5bGVzID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgdmFyIHNlY29uZHMgPSBNYXRoLm1heChwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRHVyYXRpb25OYW1lXSkgKyBwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRGVsYXlOYW1lXSksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1thbmltYXRpb25EdXJhdGlvbk5hbWVdKSArIHBhcnNlRmxvYXQoc3R5bGVzW2FuaW1hdGlvbkRlbGF5TmFtZV0pKTtcbiAgICBtaWxsaXNlY29uZHMgPSBzZWNvbmRzICogMTAwMCB8fCAwO1xuICAgIHRoaXMuY2xvbmVkRnJvbS5fX2FuaW1hdGlvbkR1cmF0aW9uX18gPSBtaWxsaXNlY29uZHM7XG4gIH1cbiAgcmV0dXJuIG1pbGxpc2Vjb25kcztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gQmluZGluZztcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cbi8qKlxuICogQSBiaW5kaW5nIGlzIGEgbGluayBiZXR3ZWVuIGFuIGVsZW1lbnQgYW5kIHNvbWUgZGF0YS4gU3ViY2xhc3NlcyBvZiBCaW5kaW5nIGNhbGxlZCBiaW5kZXJzIGRlZmluZSB3aGF0IGEgYmluZGluZyBkb2VzXG4gKiB3aXRoIHRoYXQgbGluay4gSW5zdGFuY2VzIG9mIHRoZXNlIGJpbmRlcnMgYXJlIGNyZWF0ZWQgYXMgYmluZGluZ3Mgb24gdGVtcGxhdGVzLiBXaGVuIGEgdmlldyBpcyBzdGFtcGVkIG91dCBmcm9tIHRoZVxuICogdGVtcGxhdGUgdGhlIGJpbmRpbmcgaXMgXCJjbG9uZWRcIiAoaXQgaXMgYWN0dWFsbHkgZXh0ZW5kZWQgZm9yIHBlcmZvcm1hbmNlKSBhbmQgdGhlIGBlbGVtZW50YC9gbm9kZWAgcHJvcGVydHkgaXNcbiAqIHVwZGF0ZWQgdG8gdGhlIG1hdGNoaW5nIGVsZW1lbnQgaW4gdGhlIHZpZXcuXG4gKlxuICogIyMjIFByb3BlcnRpZXNcbiAqICAqIGVsZW1lbnQ6IFRoZSBlbGVtZW50IChvciB0ZXh0IG5vZGUpIHRoaXMgYmluZGluZyBpcyBib3VuZCB0b1xuICogICogbm9kZTogQWxpYXMgb2YgZWxlbWVudCwgc2luY2UgYmluZGluZ3MgbWF5IGFwcGx5IHRvIHRleHQgbm9kZXMgdGhpcyBpcyBtb3JlIGFjY3VyYXRlXG4gKiAgKiBuYW1lOiBUaGUgYXR0cmlidXRlIG9yIGVsZW1lbnQgbmFtZSAoZG9lcyBub3QgYXBwbHkgdG8gbWF0Y2hlZCB0ZXh0IG5vZGVzKVxuICogICogbWF0Y2g6IFRoZSBtYXRjaGVkIHBhcnQgb2YgdGhlIG5hbWUgZm9yIHdpbGRjYXJkIGF0dHJpYnV0ZXMgKGUuZy4gYG9uLSpgIG1hdGNoaW5nIGFnYWluc3QgYG9uLWNsaWNrYCB3b3VsZCBoYXZlIGFcbiAqICAgIG1hdGNoIHByb3BlcnR5IGVxdWFsbGluZyBgY2xpY2tgKS4gVXNlIGB0aGlzLmNhbWVsQ2FzZWAgdG8gZ2V0IHRoZSBtYXRjaCBwcm9lcnR5IGNhbWVsQ2FzZWQuXG4gKiAgKiBleHByZXNzaW9uOiBUaGUgZXhwcmVzc2lvbiB0aGlzIGJpbmRpbmcgd2lsbCB1c2UgZm9yIGl0cyB1cGRhdGVzIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIGVsZW1lbnRzKVxuICogICogY29udGV4dDogVGhlIGNvbnRleHQgdGhlIGV4cmVzc2lvbiBvcGVyYXRlcyB3aXRoaW4gd2hlbiBib3VuZFxuICovXG5mdW5jdGlvbiBCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgaWYgKCFwcm9wZXJ0aWVzLm5vZGUgfHwgIXByb3BlcnRpZXMudmlldykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IHJlY2VpdmUgYSBub2RlIGFuZCBhIHZpZXcnKTtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgYW5kIG5vZGUgYXJlIGFsaWFzZXNcbiAgdGhpcy5fZWxlbWVudFBhdGggPSBpbml0Tm9kZVBhdGgocHJvcGVydGllcy5ub2RlLCBwcm9wZXJ0aWVzLnZpZXcpO1xuICB0aGlzLm5vZGUgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHRoaXMuZWxlbWVudCA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5uYW1lID0gcHJvcGVydGllcy5uYW1lO1xuICB0aGlzLm1hdGNoID0gcHJvcGVydGllcy5tYXRjaDtcbiAgdGhpcy5leHByZXNzaW9uID0gcHJvcGVydGllcy5leHByZXNzaW9uO1xuICB0aGlzLmZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB0aGlzLmNvbXBpbGVkKCk7XG59XG5cbmV4dGVuZChCaW5kaW5nLCB7XG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGEgY2xvbmVkIGJpbmRpbmcuIFRoaXMgaGFwcGVucyBhZnRlciBhIGNvbXBpbGVkIGJpbmRpbmcgb24gYSB0ZW1wbGF0ZSBpcyBjbG9uZWQgZm9yIGEgdmlldy5cbiAgICovXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmV4cHJlc3Npb24pIHtcbiAgICAgIC8vIEFuIG9ic2VydmVyIHRvIG9ic2VydmUgdmFsdWUgY2hhbmdlcyB0byB0aGUgZXhwcmVzc2lvbiB3aXRoaW4gYSBjb250ZXh0XG4gICAgICB0aGlzLm9ic2VydmVyID0gbmV3IHRoaXMuT2JzZXJ2ZXIodGhpcy5leHByZXNzaW9uLCB0aGlzLnVwZGF0ZWQsIHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLmNyZWF0ZWQoKTtcbiAgfSxcblxuICAvKipcbiAgICogQ2xvbmUgdGhpcyBiaW5kaW5nIGZvciBhIHZpZXcuIFRoZSBlbGVtZW50L25vZGUgd2lsbCBiZSB1cGRhdGVkIGFuZCB0aGUgYmluZGluZyB3aWxsIGJlIGluaXRlZC5cbiAgICovXG4gIGNsb25lRm9yVmlldzogZnVuY3Rpb24odmlldykge1xuICAgIGlmICghdmlldykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQSBiaW5kaW5nIG11c3QgY2xvbmUgYWdhaW5zdCBhIHZpZXcnKTtcbiAgICB9XG5cbiAgICB2YXIgbm9kZSA9IHZpZXc7XG4gICAgdGhpcy5fZWxlbWVudFBhdGguZm9yRWFjaChmdW5jdGlvbihpbmRleCkge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGROb2Rlc1tpbmRleF07XG4gICAgfSk7XG5cbiAgICB2YXIgYmluZGluZyA9IE9iamVjdC5jcmVhdGUodGhpcyk7XG4gICAgYmluZGluZy5jbG9uZWRGcm9tID0gdGhpcztcbiAgICBiaW5kaW5nLmVsZW1lbnQgPSBub2RlO1xuICAgIGJpbmRpbmcubm9kZSA9IG5vZGU7XG4gICAgYmluZGluZy5pbml0KCk7XG4gICAgcmV0dXJuIGJpbmRpbmc7XG4gIH0sXG5cblxuICAvLyBCaW5kIHRoaXMgdG8gdGhlIGdpdmVuIGNvbnRleHQgb2JqZWN0XG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09IGNvbnRleHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB7XG4gICAgICBpZiAodGhpcy51cGRhdGVkICE9PSBCaW5kaW5nLnByb3RvdHlwZS51cGRhdGVkKSB7XG4gICAgICAgIHRoaXMub2JzZXJ2ZXIuYmluZChjb250ZXh0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIHNldCB0aGUgY29udGV4dCBidXQgZG9uJ3QgYWN0dWFsbHkgYmluZCBpdCBzaW5jZSBgdXBkYXRlZGAgaXMgYSBuby1vcFxuICAgICAgICB0aGlzLm9ic2VydmVyLmNvbnRleHQgPSBjb250ZXh0O1xuICAgICAgfVxuICAgIH1cbiAgICB0aGlzLmJvdW5kKCk7XG4gIH0sXG5cblxuICAvLyBVbmJpbmQgdGhpcyBmcm9tIGl0cyBjb250ZXh0XG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gICAgaWYgKHRoaXMub2JzZXJ2ZXIpIHRoaXMub2JzZXJ2ZXIudW5iaW5kKCk7XG4gICAgdGhpcy51bmJvdW5kKCk7XG4gIH0sXG5cblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcncyBlbGVtZW50IGlzIGNvbXBpbGVkIHdpdGhpbiBhIHRlbXBsYXRlXG4gIGNvbXBpbGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY3JlYXRlZFxuICBjcmVhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgZXhwcmVzc2lvbidzIHZhbHVlIGNoYW5nZXNcbiAgdXBkYXRlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgYm91bmRcbiAgYm91bmQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nIGlzIHVuYm91bmRcbiAgdW5ib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBIZWxwZXIgbWV0aG9kc1xuXG4gIGdldCBjYW1lbENhc2UoKSB7XG4gICAgcmV0dXJuICh0aGlzLm1hdGNoIHx8IHRoaXMubmFtZSB8fCAnJykucmVwbGFjZSgvLSsoXFx3KS9nLCBmdW5jdGlvbihfLCBjaGFyKSB7XG4gICAgICByZXR1cm4gY2hhci50b1VwcGVyQ2FzZSgpO1xuICAgIH0pO1xuICB9LFxuXG4gIG9ic2VydmU6IGZ1bmN0aW9uKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuT2JzZXJ2ZXIoZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCB8fCB0aGlzKTtcbiAgfVxufSk7XG5cblxuXG5cbnZhciBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2Y7XG5cbi8vIENyZWF0ZXMgYW4gYXJyYXkgb2YgaW5kZXhlcyB0byBoZWxwIGZpbmQgdGhlIHNhbWUgZWxlbWVudCB3aXRoaW4gYSBjbG9uZWQgdmlld1xuZnVuY3Rpb24gaW5pdE5vZGVQYXRoKG5vZGUsIHZpZXcpIHtcbiAgdmFyIHBhdGggPSBbXTtcbiAgd2hpbGUgKG5vZGUgIT09IHZpZXcpIHtcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHBhdGgudW5zaGlmdChpbmRleE9mLmNhbGwocGFyZW50LmNoaWxkTm9kZXMsIG5vZGUpKTtcbiAgICBub2RlID0gcGFyZW50O1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuIiwidmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xubW9kdWxlLmV4cG9ydHMgPSBjb21waWxlO1xuXG5cbi8vIFdhbGtzIHRoZSB0ZW1wbGF0ZSBET00gcmVwbGFjaW5nIGFueSBiaW5kaW5ncyBhbmQgY2FjaGluZyBiaW5kaW5ncyBvbnRvIHRoZSB0ZW1wbGF0ZSBvYmplY3QuXG5mdW5jdGlvbiBjb21waWxlKGZyYWdtZW50cywgdGVtcGxhdGUpIHtcbiAgdmFyIHdhbGtlciA9IGRvY3VtZW50LmNyZWF0ZVRyZWVXYWxrZXIodGVtcGxhdGUsIE5vZGVGaWx0ZXIuU0hPV19FTEVNRU5UIHwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICB2YXIgYmluZGluZ3MgPSB0ZW1wbGF0ZS5iaW5kaW5ncyA9IFtdLCBjdXJyZW50Tm9kZSwgcGFyZW50Tm9kZSwgcHJldmlvdXNOb2RlO1xuXG4gIC8vIFJlc2V0IGZpcnN0IG5vZGUgdG8gZW5zdXJlIGl0IGlzbid0IGEgZnJhZ21lbnRcbiAgd2Fsa2VyLm5leHROb2RlKCk7XG4gIHdhbGtlci5wcmV2aW91c05vZGUoKTtcblxuICAvLyBmaW5kIGJpbmRpbmdzIGZvciBlYWNoIG5vZGVcbiAgZG8ge1xuICAgIGN1cnJlbnROb2RlID0gd2Fsa2VyLmN1cnJlbnROb2RlO1xuICAgIHBhcmVudE5vZGUgPSBjdXJyZW50Tm9kZS5wYXJlbnROb2RlO1xuICAgIGJpbmRpbmdzLnB1c2guYXBwbHkoYmluZGluZ3MsIGdldEJpbmRpbmdzRm9yTm9kZShmcmFnbWVudHMsIGN1cnJlbnROb2RlLCB0ZW1wbGF0ZSkpO1xuXG4gICAgaWYgKGN1cnJlbnROb2RlLnBhcmVudE5vZGUgIT09IHBhcmVudE5vZGUpIHtcbiAgICAgIC8vIGN1cnJlbnROb2RlIHdhcyByZW1vdmVkIGFuZCBtYWRlIGEgdGVtcGxhdGVcbiAgICAgIHdhbGtlci5jdXJyZW50Tm9kZSA9IHByZXZpb3VzTm9kZSB8fCB3YWxrZXIucm9vdDtcbiAgICB9IGVsc2Uge1xuICAgICAgcHJldmlvdXNOb2RlID0gY3VycmVudE5vZGU7XG4gICAgfVxuICB9IHdoaWxlICh3YWxrZXIubmV4dE5vZGUoKSk7XG5cbiAgcmV0dXJuIHRlbXBsYXRlO1xufVxuXG5cblxuLy8gRmluZCBhbGwgdGhlIGJpbmRpbmdzIG9uIGEgZ2l2ZW4gbm9kZSAodGV4dCBub2RlcyB3aWxsIG9ubHkgZXZlciBoYXZlIG9uZSBiaW5kaW5nKS5cbmZ1bmN0aW9uIGdldEJpbmRpbmdzRm9yTm9kZShmcmFnbWVudHMsIG5vZGUsIHZpZXcpIHtcbiAgdmFyIGJpbmRpbmdzID0gW107XG4gIHZhciBCaW5kZXIsIGV4cHIsIGJvdW5kLCBtYXRjaCwgYXR0ciwgaTtcblxuICBpZiAobm9kZS5ub2RlVHlwZSA9PT0gTm9kZS5URVhUX05PREUpIHtcbiAgICBzcGxpdFRleHROb2RlKGZyYWdtZW50cywgbm9kZSk7XG5cbiAgICAvLyBGaW5kIGFueSBiaW5kaW5nIGZvciB0aGUgdGV4dCBub2RlXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpKSB7XG4gICAgICBleHByID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ3RleHQnLCBub2RlLm5vZGVWYWx1ZSk7XG4gICAgICBub2RlLm5vZGVWYWx1ZSA9ICcnO1xuICAgICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ3RleHQnLCBleHByKTtcbiAgICAgIGJpbmRpbmdzLnB1c2gobmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGV4cHJlc3Npb246IGV4cHIsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pKTtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgdGhlIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00sIHN0b3AuIENoZWNrIGJ5IGxvb2tpbmcgYXQgaXRzIHBhcmVudE5vZGVcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIGVsZW1lbnRcbiAgICBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignZWxlbWVudCcsIG5vZGUudGFnTmFtZS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoQmluZGVyKSB7XG4gICAgICBiaW5kaW5ncy5wdXNoKG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KSk7XG4gICAgfVxuXG4gICAgLy8gSWYgcmVtb3ZlZCwgbWFkZSBhIHRlbXBsYXRlLCBkb24ndCBjb250aW51ZSBwcm9jZXNzaW5nXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmluZCBhbmQgYWRkIGFueSBhdHRyaWJ1dGUgYmluZGluZ3Mgb24gYW4gZWxlbWVudC4gVGhlc2UgY2FuIGJlIGF0dHJpYnV0ZXMgd2hvc2UgbmFtZSBtYXRjaGVzIGEgYmluZGluZywgb3JcbiAgICAvLyB0aGV5IGNhbiBiZSBhdHRyaWJ1dGVzIHdoaWNoIGhhdmUgYSBiaW5kaW5nIGluIHRoZSB2YWx1ZSBzdWNoIGFzIGBocmVmPVwiL3Bvc3Qve3sgcG9zdC5pZCB9fVwiYC5cbiAgICB2YXIgYm91bmQgPSBbXTtcbiAgICB2YXIgYXR0cmlidXRlcyA9IHNsaWNlLmNhbGwobm9kZS5hdHRyaWJ1dGVzKTtcbiAgICBmb3IgKGkgPSAwLCBsID0gYXR0cmlidXRlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBhdHRyID0gYXR0cmlidXRlc1tpXTtcbiAgICAgIHZhciBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignYXR0cmlidXRlJywgYXR0ci5uYW1lLCBhdHRyLnZhbHVlKTtcbiAgICAgIGlmIChCaW5kZXIpIHtcbiAgICAgICAgYm91bmQucHVzaChbIEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYWtlIHN1cmUgdG8gY3JlYXRlIGFuZCBwcm9jZXNzIHRoZW0gaW4gdGhlIGNvcnJlY3QgcHJpb3JpdHkgb3JkZXIgc28gaWYgYSBiaW5kaW5nIGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gdGhlXG4gICAgLy8gbm9kZSBpdCBkb2Vzbid0IHByb2Nlc3MgdGhlIG90aGVycy5cbiAgICBib3VuZC5zb3J0KHNvcnRBdHRyaWJ1dGVzKTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBib3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIEJpbmRlciA9IGJvdW5kW2ldWzBdO1xuICAgICAgdmFyIGF0dHIgPSBib3VuZFtpXVsxXTtcbiAgICAgIHZhciBuYW1lID0gYXR0ci5uYW1lO1xuICAgICAgdmFyIHZhbHVlID0gYXR0ci52YWx1ZTtcbiAgICAgIGlmIChCaW5kZXIuZXhwcikge1xuICAgICAgICB2YXIgbWF0Y2ggPSBuYW1lLm1hdGNoKEJpbmRlci5leHByKTtcbiAgICAgICAgaWYgKG1hdGNoKSBtYXRjaCA9IG1hdGNoWzFdO1xuICAgICAgfVxuICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGVOb2RlKGF0dHIpO1xuXG4gICAgICBiaW5kaW5ncy5wdXNoKG5ldyBCaW5kZXIoe1xuICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICB2aWV3OiB2aWV3LFxuICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICBtYXRjaDogbWF0Y2gsXG4gICAgICAgIGV4cHJlc3Npb246IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCB2YWx1ZSksXG4gICAgICAgIGZyYWdtZW50czogZnJhZ21lbnRzXG4gICAgICB9KSk7XG5cbiAgICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHBhcmVudCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmluZGluZ3M7XG59XG5cblxuLy8gU3BsaXRzIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtIHNvIHRoZXkgY2FuIGJlIGJvdW5kIGluZGl2aWR1YWxseSwgaGFzIHBhcmVudE5vZGUgcGFzc2VkIGluIHNpbmNlIGl0IG1heVxuLy8gYmUgYSBkb2N1bWVudCBmcmFnbWVudCB3aGljaCBhcHBlYXJzIGFzIG51bGwgb24gbm9kZS5wYXJlbnROb2RlLlxuZnVuY3Rpb24gc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpIHtcbiAgaWYgKCFub2RlLnByb2Nlc3NlZCkge1xuICAgIG5vZGUucHJvY2Vzc2VkID0gdHJ1ZTtcbiAgICB2YXIgcmVnZXggPSBmcmFnbWVudHMuYmluZGVycy50ZXh0Ll9leHByO1xuICAgIHZhciBjb250ZW50ID0gbm9kZS5ub2RlVmFsdWU7XG4gICAgaWYgKGNvbnRlbnQubWF0Y2gocmVnZXgpKSB7XG4gICAgICB2YXIgbWF0Y2gsIGxhc3RJbmRleCA9IDAsIHBhcnRzID0gW10sIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgd2hpbGUgKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkge1xuICAgICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4LCByZWdleC5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpKTtcbiAgICAgICAgcGFydHMucHVzaChtYXRjaFswXSk7XG4gICAgICAgIGxhc3RJbmRleCA9IHJlZ2V4Lmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goY29udGVudC5zbGljZShsYXN0SW5kZXgpKTtcbiAgICAgIHBhcnRzID0gcGFydHMuZmlsdGVyKG5vdEVtcHR5KTtcblxuICAgICAgbm9kZS5ub2RlVmFsdWUgPSBwYXJ0c1swXTtcbiAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5ld1RleHROb2RlID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUocGFydHNbaV0pO1xuICAgICAgICBuZXdUZXh0Tm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChuZXdUZXh0Tm9kZSk7XG4gICAgICB9XG4gICAgICBub2RlLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBub2RlLm5leHRTaWJsaW5nKTtcbiAgICB9XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBzb3J0QXR0cmlidXRlcyhhLCBiKSB7XG4gIHJldHVybiBiWzBdLnByaW9yaXR5IC0gYVswXS5wcmlvcml0eTtcbn1cblxuZnVuY3Rpb24gbm90RW1wdHkodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBGcmFnbWVudHM7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xudmFyIHRvRnJhZ21lbnQgPSByZXF1aXJlKCcuL3V0aWwvdG9GcmFnbWVudCcpO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIEFuaW1hdGVkQmluZGluZyA9IHJlcXVpcmUoJy4vYW5pbWF0ZWRCaW5kaW5nJyk7XG52YXIgY29tcGlsZSA9IHJlcXVpcmUoJy4vY29tcGlsZScpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEJpbmRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYmluZGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEZvcm1hdHRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvZm9ybWF0dGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEFuaW1hdGlvbnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucycpO1xuXG4vKipcbiAqIEEgRnJhZ21lbnRzIG9iamVjdCBzZXJ2ZXMgYXMgYSByZWdpc3RyeSBmb3IgYmluZGVycyBhbmQgZm9ybWF0dGVyc1xuICogQHBhcmFtIHtbdHlwZV19IE9ic2VydmVyQ2xhc3MgW2Rlc2NyaXB0aW9uXVxuICovXG5mdW5jdGlvbiBGcmFnbWVudHMoT2JzZXJ2ZXJDbGFzcykge1xuICBpZiAoIU9ic2VydmVyQ2xhc3MpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNdXN0IHByb3ZpZGUgYW4gT2JzZXJ2ZXIgY2xhc3MgdG8gRnJhZ21lbnRzLicpO1xuICB9XG5cbiAgdGhpcy5PYnNlcnZlciA9IE9ic2VydmVyQ2xhc3M7XG4gIHRoaXMuZm9ybWF0dGVycyA9IE9ic2VydmVyQ2xhc3MuZm9ybWF0dGVycyA9IHt9O1xuICB0aGlzLmFuaW1hdGlvbnMgPSB7fTtcblxuICB0aGlzLmJpbmRlcnMgPSB7XG4gICAgZWxlbWVudDogeyBfd2lsZGNhcmRzOiBbXSB9LFxuICAgIGF0dHJpYnV0ZTogeyBfd2lsZGNhcmRzOiBbXSwgX2V4cHI6IC97eyguKj8pfX0vZyB9LFxuICAgIHRleHQ6IHsgX3dpbGRjYXJkczogW10sIF9leHByOiAve3soLio/KX19L2cgfVxuICB9O1xuXG4gIC8vIFRleHQgYmluZGVyIGZvciB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyVGV4dCgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSAhPSBudWxsKSA/IHZhbHVlIDogJyc7XG4gIH0pO1xuXG4gIC8vIENhdGNoYWxsIGF0dHJpYnV0ZSBiaW5kZXIgZm9yIHJlZ3VsYXIgYXR0cmlidXRlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlckF0dHJpYnV0ZSgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKHRoaXMubmFtZSwgdmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMubmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZWdpc3RlckRlZmF1bHRCaW5kZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zKHRoaXMpO1xufVxuXG5GcmFnbWVudHMucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gICAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gICAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gICAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gICAqL1xuICBjcmVhdGVUZW1wbGF0ZTogZnVuY3Rpb24oaHRtbCkge1xuICAgIHZhciBmcmFnbWVudCA9IHRvRnJhZ21lbnQoaHRtbCk7XG4gICAgaWYgKGZyYWdtZW50LmNoaWxkTm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tICcgKyBodG1sKTtcbiAgICB9XG4gICAgdmFyIHRlbXBsYXRlID0gZXh0ZW5kLm1ha2UoVGVtcGxhdGUsIGZyYWdtZW50KTtcbiAgICBjb21waWxlKHRoaXMsIHRlbXBsYXRlKTtcbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYmluZGluZ3Mgb24gYW4gZWxlbWVudC5cbiAgICovXG4gIGNvbXBpbGVFbGVtZW50OiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgcmV0dXJuIGNvbXBpbGUodGhpcywgZWxlbWVudCk7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYW5kIGJpbmRzIGFuIGVsZW1lbnQgd2hpY2ggd2FzIG5vdCBjcmVhdGVkIGZyb20gYSB0ZW1wbGF0ZS4gTW9zdGx5IG9ubHkgdXNlZCBmb3IgYmluZGluZyB0aGUgZG9jdW1lbnQnc1xuICAgKiBodG1sIGVsZW1lbnQuXG4gICAqL1xuICBiaW5kRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCwgY29udGV4dCkge1xuICAgIHRoaXMuY29tcGlsZUVsZW1lbnQoZWxlbWVudCk7XG5cbiAgICAvLyBpbml0aWFsaXplIGFsbCB0aGUgYmluZGluZ3MgZmlyc3QgYmVmb3JlIGJpbmRpbmcgdGhlbSB0byB0aGUgY29udGV4dFxuICAgIGVsZW1lbnQuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmluaXQoKTtcbiAgICB9KTtcblxuICAgIGVsZW1lbnQuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmJpbmQoY29udGV4dCk7XG4gICAgfSk7XG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYmluZGVyIGZvciBhIGdpdmVuIHR5cGUgYW5kIG5hbWUuIEEgYmluZGVyIGlzIGEgc3ViY2xhc3Mgb2YgQmluZGluZyBhbmQgaXMgdXNlZCB0byBjcmVhdGUgYmluZGluZ3Mgb25cbiAgICogYW4gZWxlbWVudCBvciB0ZXh0IG5vZGUgd2hvc2UgdGFnIG5hbWUsIGF0dHJpYnV0ZSBuYW1lLCBvciBleHByZXNzaW9uIGNvbnRlbnRzIG1hdGNoIHRoaXMgYmluZGVyJ3MgbmFtZS9leHByZXNzaW9uLlxuICAgKlxuICAgKiAjIyMgUGFyYW1ldGVyc1xuICAgKlxuICAgKiAgKiBgdHlwZWA6IHRoZXJlIGFyZSB0aHJlZSB0eXBlcyBvZiBiaW5kZXJzOiBlbGVtZW50LCBhdHRyaWJ1dGUsIG9yIHRleHQuIFRoZXNlIGNvcnJlc3BvbmQgdG8gbWF0Y2hpbmcgYWdhaW5zdCBhblxuICAgKiAgICBlbGVtZW50J3MgdGFnIG5hbWUsIGFuIGVsZW1lbnQgd2l0aCB0aGUgZ2l2ZW4gYXR0cmlidXRlIG5hbWUsIG9yIGEgdGV4dCBub2RlIHRoYXQgbWF0Y2hlcyB0aGUgcHJvdmlkZWRcbiAgICogICAgZXhwcmVzc2lvbi5cbiAgICpcbiAgICogICogYG5hbWVgOiB0byBtYXRjaCwgYSBiaW5kZXIgbmVlZHMgdGhlIG5hbWUgb2YgYW4gZWxlbWVudCBvciBhdHRyaWJ1dGUsIG9yIGEgcmVndWxhciBleHByZXNzaW9uIHRoYXQgbWF0Y2hlcyBhXG4gICAqICAgIGdpdmVuIHRleHQgbm9kZS4gTmFtZXMgZm9yIGVsZW1lbnRzIGFuZCBhdHRyaWJ1dGVzIGNhbiBiZSByZWd1bGFyIGV4cHJlc3Npb25zIGFzIHdlbGwsIG9yIHRoZXkgbWF5IGJlIHdpbGRjYXJkXG4gICAqICAgIG5hbWVzIGJ5IHVzaW5nIGFuIGFzdGVyaXNrLlxuICAgKlxuICAgKiAgKiBgZGVmaW5pdGlvbmA6IGEgYmluZGVyIGlzIGEgc3ViY2xhc3Mgb2YgQmluZGluZyB3aGljaCBvdmVycmlkZXMga2V5IG1ldGhvZHMsIGBjb21waWxlZGAsIGBjcmVhdGVkYCwgYHVwZGF0ZWRgLFxuICAgKiAgICBgYm91bmRgLCBhbmQgYHVuYm91bmRgLiBUaGUgZGVmaW5pdGlvbiBtYXkgYmUgYW4gYWN0dWFsIHN1YmNsYXNzIG9mIEJpbmRpbmcgb3IgaXQgbWF5IGJlIGFuIG9iamVjdCB3aGljaCB3aWxsIGJlXG4gICAqICAgIHVzZWQgZm9yIHRoZSBwcm90b3R5cGUgb2YgdGhlIG5ld2x5IGNyZWF0ZWQgc3ViY2xhc3MuIEZvciBtYW55IGJpbmRpbmdzIG9ubHkgdGhlIGB1cGRhdGVkYCBtZXRob2QgaXMgb3ZlcnJpZGRlbixcbiAgICogICAgc28gYnkganVzdCBwYXNzaW5nIGluIGEgZnVuY3Rpb24gZm9yIGBkZWZpbml0aW9uYCB0aGUgYmluZGVyIHdpbGwgYmUgY3JlYXRlZCB3aXRoIHRoYXQgYXMgaXRzIGB1cGRhdGVkYCBtZXRob2QuXG4gICAqXG4gICAqICMjIyBFeHBsYWluYXRpb24gb2YgcHJvcGVydGllcyBhbmQgbWV0aG9kc1xuICAgKlxuICAgKiAgICogYHByaW9yaXR5YCBtYXkgYmUgZGVmaW5lZCBhcyBudW1iZXIgdG8gaW5zdHJ1Y3Qgc29tZSBiaW5kZXJzIHRvIGJlIHByb2Nlc3NlZCBiZWZvcmUgb3RoZXJzLiBCaW5kZXJzIHdpdGhcbiAgICogICBoaWdoZXIgcHJpb3JpdHkgYXJlIHByb2Nlc3NlZCBmaXJzdC5cbiAgICpcbiAgICogICAqIGBhbmltYXRlZGAgY2FuIGJlIHNldCB0byBgdHJ1ZWAgdG8gZXh0ZW5kIHRoZSBBbmltYXRlZEJpbmRpbmcgY2xhc3Mgd2hpY2ggcHJvdmlkZXMgc3VwcG9ydCBmb3IgYW5pbWF0aW9uIHdoZW5cbiAgICogICBpbnNlcnRpbmdhbmQgcmVtb3Zpbmcgbm9kZXMgZnJvbSB0aGUgRE9NLiBUaGUgYGFuaW1hdGVkYCBwcm9wZXJ0eSBvbmx5ICphbGxvd3MqIGFuaW1hdGlvbiBidXQgdGhlIGVsZW1lbnQgbXVzdFxuICAgKiAgIGhhdmUgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgdG8gdXNlIGFuaW1hdGlvbi4gQSBiaW5kaW5nIHdpbGwgaGF2ZSB0aGUgYGFuaW1hdGVgIHByb3BlcnR5IHNldCB0byB0cnVlIHdoZW4gaXQgaXNcbiAgICogICB0byBiZSBhbmltYXRlZC4gQmluZGVycyBzaG91bGQgaGF2ZSBmYXN0IHBhdGhzIGZvciB3aGVuIGFuaW1hdGlvbiBpcyBub3QgdXNlZCByYXRoZXIgdGhhbiBhc3N1bWluZyBhbmltYXRpb24gd2lsbFxuICAgKiAgIGJlIHVzZWQuXG4gICAqXG4gICAqIEJpbmRlcnNcbiAgICpcbiAgICogQSBiaW5kZXIgY2FuIGhhdmUgNSBtZXRob2RzIHdoaWNoIHdpbGwgYmUgY2FsbGVkIGF0IHZhcmlvdXMgcG9pbnRzIGluIGEgYmluZGluZydzIGxpZmVjeWNsZS4gTWFueSBiaW5kZXJzIHdpbGxcbiAgICogb25seSB1c2UgdGhlIGB1cGRhdGVkKHZhbHVlKWAgbWV0aG9kLCBzbyBjYWxsaW5nIHJlZ2lzdGVyIHdpdGggYSBmdW5jdGlvbiBpbnN0ZWFkIG9mIGFuIG9iamVjdCBhcyBpdHMgdGhpcmRcbiAgICogcGFyYW1ldGVyIGlzIGEgc2hvcnRjdXQgdG8gY3JlYXRpbmcgYSBiaW5kZXIgd2l0aCBqdXN0IGFuIGB1cGRhdGVgIG1ldGhvZC5cbiAgICpcbiAgICogTGlzdGVkIGluIG9yZGVyIG9mIHdoZW4gdGhleSBvY2N1ciBpbiBhIGJpbmRpbmcncyBsaWZlY3ljbGU6XG4gICAqXG4gICAqICAgKiBgY29tcGlsZWQob3B0aW9ucylgIGlzIGNhbGxlZCB3aGVuIGZpcnN0IGNyZWF0aW5nIGEgYmluZGluZyBkdXJpbmcgdGhlIHRlbXBsYXRlIGNvbXBpbGF0aW9uIHByb2Nlc3MgYW5kIHJlY2VpdmVzXG4gICAqIHRoZSBgb3B0aW9uc2Agb2JqZWN0IHRoYXQgd2lsbCBiZSBwYXNzZWQgaW50byBgbmV3IEJpbmRpbmcob3B0aW9ucylgLiBUaGlzIGNhbiBiZSB1c2VkIGZvciBjcmVhdGluZyB0ZW1wbGF0ZXMsXG4gICAqIG1vZGlmeWluZyB0aGUgRE9NIChvbmx5IHN1YnNlcXVlbnQgRE9NIHRoYXQgaGFzbid0IGFscmVhZHkgYmVlbiBwcm9jZXNzZWQpIGFuZCBvdGhlciB0aGluZ3MgdGhhdCBzaG91bGQgYmVcbiAgICogYXBwbGllZCBhdCBjb21waWxlIHRpbWUgYW5kIG5vdCBkdXBsaWNhdGVkIGZvciBlYWNoIHZpZXcgY3JlYXRlZC5cbiAgICpcbiAgICogICAqIGBjcmVhdGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIGEgbmV3IHZpZXcgaXMgY3JlYXRlZC4gVGhpcyBjYW4gYmUgdXNlZCB0byBhZGQgZXZlbnQgbGlzdGVuZXJzIG9uIHRoZVxuICAgKiBlbGVtZW50IG9yIGRvIG90aGVyIHRoaW5ncyB0aGF0IHdpbGwgcGVyc2lzdGUgd2l0aCB0aGUgdmlldyB0aHJvdWdoIGl0cyBtYW55IHVzZXMuIFZpZXdzIG1heSBnZXQgcmV1c2VkIHNvIGRvbid0XG4gICAqIGRvIGFueXRoaW5nIGhlcmUgdG8gdGllIGl0IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICpcbiAgICogICAqIGBhdHRhY2hlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiB0aGUgdmlldyBpcyBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQgYW5kIGluc2VydGVkIGludG8gdGhlIERPTS4gVGhpc1xuICAgKiBjYW4gYmUgdXNlZCB0byBoYW5kbGUgY29udGV4dC1zcGVjaWZpYyBhY3Rpb25zLCBhZGQgbGlzdGVuZXJzIHRvIHRoZSB3aW5kb3cgb3IgZG9jdW1lbnQgKHRvIGJlIHJlbW92ZWQgaW5cbiAgICogYGRldGFjaGVkYCEpLCBldGMuXG4gICAqXG4gICAqICAgKiBgdXBkYXRlZCh2YWx1ZSwgb2xkVmFsdWUsIGNoYW5nZVJlY29yZHMpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbmV2ZXIgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHdpdGhpblxuICAgKiB0aGUgYXR0cmlidXRlIGNoYW5nZXMuIEZvciBleGFtcGxlLCBgYmluZC10ZXh0PVwie3t1c2VybmFtZX19XCJgIHdpbGwgdHJpZ2dlciBgdXBkYXRlZGAgd2l0aCB0aGUgdmFsdWUgb2YgdXNlcm5hbWVcbiAgICogd2hlbmV2ZXIgaXQgY2hhbmdlcyBvbiB0aGUgZ2l2ZW4gY29udGV4dC4gV2hlbiB0aGUgdmlldyBpcyByZW1vdmVkIGB1cGRhdGVkYCB3aWxsIGJlIHRyaWdnZXJlZCB3aXRoIGEgdmFsdWUgb2ZcbiAgICogYHVuZGVmaW5lZGAgaWYgdGhlIHZhbHVlIHdhcyBub3QgYWxyZWFkeSBgdW5kZWZpbmVkYCwgZ2l2aW5nIGEgY2hhbmNlIHRvIFwicmVzZXRcIiB0byBhbiBlbXB0eSBzdGF0ZS5cbiAgICpcbiAgICogICAqIGBkZXRhY2hlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiB0aGUgdmlldyBpcyB1bmJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBET00uIFRoaXNcbiAgICogY2FuIGJlIHVzZWQgdG8gY2xlYW4gdXAgYW55dGhpbmcgZG9uZSBpbiBgYXR0YWNoZWQoKWAgb3IgaW4gYHVwZGF0ZWQoKWAgYmVmb3JlIGJlaW5nIHJlbW92ZWQuXG4gICAqXG4gICAqIEVsZW1lbnQgYW5kIGF0dHJpYnV0ZSBiaW5kZXJzIHdpbGwgYXBwbHkgd2hlbmV2ZXIgdGhlIHRhZyBuYW1lIG9yIGF0dHJpYnV0ZSBuYW1lIGlzIG1hdGNoZWQuIEluIHRoZSBjYXNlIG9mXG4gICAqIGF0dHJpYnV0ZSBiaW5kZXJzIGlmIHlvdSBvbmx5IHdhbnQgaXQgdG8gbWF0Y2ggd2hlbiBleHByZXNzaW9ucyBhcmUgdXNlZCB3aXRoaW4gdGhlIGF0dHJpYnV0ZSwgYWRkIGBvbmx5V2hlbkJvdW5kYFxuICAgKiB0byB0aGUgZGVmaW5pdGlvbi4gT3RoZXJ3aXNlIHRoZSBiaW5kZXIgd2lsbCBtYXRjaCBhbmQgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHdpbGwgc2ltcGx5IGJlIGEgc3RyaW5nIHRoYXRcbiAgICogb25seSBjYWxscyB1cGRhdGVkIG9uY2Ugc2luY2UgaXQgd2lsbCBub3QgY2hhbmdlLlxuICAgKlxuICAgKiBOb3RlLCBhdHRyaWJ1dGVzIHdoaWNoIG1hdGNoIGEgYmluZGVyIGFyZSByZW1vdmVkIGR1cmluZyBjb21waWxlLiBUaGV5IGFyZSBjb25zaWRlcmVkIHRvIGJlIGJpbmRpbmcgZGVmaW5pdGlvbnMgYW5kXG4gICAqIG5vdCBwYXJ0IG9mIHRoZSBlbGVtZW50LiBCaW5kaW5ncyBtYXkgc2V0IHRoZSBhdHRyaWJ1dGUgd2hpY2ggc2VydmVkIGFzIHRoZWlyIGRlZmluaXRpb24gaWYgZGVzaXJlZC5cbiAgICpcbiAgICogIyMjIERlZmF1bHRzXG4gICAqXG4gICAqIFRoZXJlIGFyZSBkZWZhdWx0IGJpbmRlcnMgZm9yIGF0dHJpYnV0ZSBhbmQgdGV4dCBub2RlcyB3aGljaCBhcHBseSB3aGVuIG5vIG90aGVyIGJpbmRlcnMgbWF0Y2guIFRoZXkgb25seSBhcHBseSB0b1xuICAgKiBhdHRyaWJ1dGVzIGFuZCB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSAoZS5nLiBge3tmb299fWApLiBUaGUgZGVmYXVsdCBpcyB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvciB0ZXh0XG4gICAqIG5vZGUncyB2YWx1ZSB0byB0aGUgcmVzdWx0IG9mIHRoZSBleHByZXNzaW9uLiBJZiB5b3Ugd2FudGVkIHRvIG92ZXJyaWRlIHRoaXMgZGVmYXVsdCB5b3UgbWF5IHJlZ2lzdGVyIGEgYmluZGVyIHdpdGhcbiAgICogdGhlIG5hbWUgYFwiX19kZWZhdWx0X19cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKiBUaGlzIGJpbmRpbmcgaGFuZGxlciBhZGRzIHBpcmF0ZWl6ZWQgdGV4dCB0byBhbiBlbGVtZW50LlxuICAgKiBgYGBqYXZhc2NyaXB0XG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyQXR0cmlidXRlKCdteS1waXJhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB7XG4gICAqICAgICB2YWx1ZSA9ICcnO1xuICAgKiAgIH0gZWxzZSB7XG4gICAqICAgICB2YWx1ZSA9IHZhbHVlXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXEJpbmdcXGIvZywgXCJpbidcIilcbiAgICogICAgICAgLnJlcGxhY2UoL1xcYnRvXFxiL2csIFwidCdcIilcbiAgICogICAgICAgLnJlcGxhY2UoL1xcYnlvdVxcYi8sICd5ZScpXG4gICAqICAgICAgICsgJyBBcnJyciEnO1xuICAgKiAgIH1cbiAgICogICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgICogfSk7XG4gICAqIGBgYFxuICAgKlxuICAgKiBgYGBodG1sXG4gICAqIDxwIG15LXBpcmF0ZT1cInt7cG9zdC5ib2R5fX1cIj5UaGlzIHRleHQgd2lsbCBiZSByZXBsYWNlZC48L3A+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyVGV4dDogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCd0ZXh0JywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgdmFyIGJpbmRlciwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXVxuICAgIHZhciBzdXBlckNsYXNzID0gZGVmaW5pdGlvbi5hbmltYXRlZCA/IEFuaW1hdGVkQmluZGluZyA6IEJpbmRpbmc7XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmluaXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkZWZpbml0aW9uLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgc3VwZXJDbGFzcyA9IGRlZmluaXRpb247XG4gICAgICAgIGRlZmluaXRpb24gPSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlZmluaXRpb24gPSB7IHVwZGF0ZWQ6IGRlZmluaXRpb24gfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBDcmVhdGUgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIChvciBhbm90aGVyIGJpbmRlcikgd2l0aCB0aGUgZGVmaW5pdGlvblxuICAgIGZ1bmN0aW9uIEJpbmRlcigpIHtcbiAgICAgIHN1cGVyQ2xhc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9XG4gICAgaWYgKGRlZmluaXRpb24ucHJpb3JpdHkgPT0gbnVsbCkge1xuICAgICAgZGVmaW5pdGlvbi5wcmlvcml0eSA9IDA7XG4gICAgfVxuICAgIGRlZmluaXRpb24uT2JzZXJ2ZXIgPSB0aGlzLk9ic2VydmVyO1xuICAgIHN1cGVyQ2xhc3MuZXh0ZW5kKEJpbmRlciwgZGVmaW5pdGlvbik7XG5cbiAgICB2YXIgZXhwcjtcbiAgICBpZiAobmFtZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgZXhwciA9IG5hbWU7XG4gICAgfSBlbHNlIGlmIChuYW1lLmluZGV4T2YoJyonKSA+PSAwKSB7XG4gICAgICBleHByID0gbmV3IFJlZ0V4cCgnXicgKyBlc2NhcGVSZWdFeHAobmFtZSkucmVwbGFjZSgnXFxcXConLCAnKC4qKScpICsgJyQnKTtcbiAgICB9XG5cbiAgICBpZiAoZXhwcikge1xuICAgICAgQmluZGVyLmV4cHIgPSBleHByO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnB1c2goQmluZGVyKTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb3J0KHRoaXMuYmluZGluZ1NvcnQpO1xuICAgIH1cblxuICAgIEJpbmRlci5uYW1lID0gJycgKyBuYW1lO1xuICAgIGJpbmRlcnNbbmFtZV0gPSBCaW5kZXI7XG4gICAgcmV0dXJuIEJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgLiBJZiBhbiBSZWdFeHAgd2FzIHVzZWQgaW4gcmVnaXN0ZXIgZm9yIHRoZSBuYW1lIGl0IG11c3QgYmUgdXNlZFxuICAgKiB0byB1bnJlZ2lzdGVyLCBidXQgaXQgZG9lcyBub3QgbmVlZCB0byBiZSB0aGUgc2FtZSBpbnN0YW5jZS5cbiAgICovXG4gIHVucmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuICAgIGlmICghYmluZGVyKSByZXR1cm47XG4gICAgaWYgKGJpbmRlci5leHByKSB7XG4gICAgICB2YXIgaW5kZXggPSBiaW5kZXJzLl93aWxkY2FyZHMuaW5kZXhPZihiaW5kZXIpO1xuICAgICAgaWYgKGluZGV4ID49IDApIGJpbmRlcnMuX3dpbGRjYXJkcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgICBkZWxldGUgYmluZGVyc1tuYW1lXTtcbiAgICByZXR1cm4gYmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBiaW5kZXIgdGhhdCB3YXMgYWRkZWQgd2l0aCBgcmVnaXN0ZXIoKWAgYnkgdHlwZSBhbmQgbmFtZS5cbiAgICovXG4gIGdldEVsZW1lbnRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QXR0cmlidXRlQmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0VGV4dEJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICBnZXRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUpIHtcbiAgICB2YXIgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcblxuICAgIGlmICghYmluZGVycykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYHR5cGVgIG11c3QgYmUgb25lIG9mICcgKyBPYmplY3Qua2V5cyh0aGlzLmJpbmRlcnMpLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmIChuYW1lICYmIGJpbmRlcnMuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgIHJldHVybiBiaW5kZXJzW25hbWVdO1xuICAgIH1cbiAgfSxcblxuXG4gIC8qKlxuICAgKiBGaW5kIGEgbWF0Y2hpbmcgYmluZGVyIGZvciB0aGUgZ2l2ZW4gdHlwZS4gRWxlbWVudHMgc2hvdWxkIG9ubHkgcHJvdmlkZSBuYW1lLiBBdHRyaWJ1dGVzIHNob3VsZCBwcm92aWRlIHRoZSBuYW1lXG4gICAqIGFuZCB2YWx1ZSAodmFsdWUgc28gdGhlIGRlZmF1bHQgY2FuIGJlIHJldHVybmVkIGlmIGFuIGV4cHJlc3Npb24gZXhpc3RzIGluIHRoZSB2YWx1ZSkuIFRleHQgbm9kZXMgc2hvdWxkIG9ubHlcbiAgICogcHJvdmlkZSB0aGUgdmFsdWUgKGluIHBsYWNlIG9mIHRoZSBuYW1lKSBhbmQgd2lsbCByZXR1cm4gdGhlIGRlZmF1bHQgaWYgbm8gYmluZGVycyBtYXRjaC5cbiAgICovXG4gIGZpbmRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKHR5cGUgPT09ICd0ZXh0JyAmJiB2YWx1ZSA9PSBudWxsKSB7XG4gICAgICB2YWx1ZSA9IG5hbWU7XG4gICAgICBuYW1lID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB2YXIgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgbmFtZSksIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcikge1xuICAgICAgdmFyIHRvTWF0Y2ggPSAodHlwZSA9PT0gJ3RleHQnKSA/IHZhbHVlIDogbmFtZTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb21lKGZ1bmN0aW9uKHdpbGRjYXJkQmluZGVyKSB7XG4gICAgICAgIGlmICh0b01hdGNoLm1hdGNoKHdpbGRjYXJkQmluZGVyLmV4cHIpKSB7XG4gICAgICAgICAgYmluZGVyID0gd2lsZGNhcmRCaW5kZXI7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChiaW5kZXIgJiYgdHlwZSA9PT0gJ2F0dHJpYnV0ZScgJiYgYmluZGVyLm9ubHlXaGVuQm91bmQgJiYgIXRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpIHtcbiAgICAgIC8vIGRvbid0IHVzZSB0aGUgYHZhbHVlYCBiaW5kZXIgaWYgdGhlcmUgaXMgbm8gZXhwcmVzc2lvbiBpbiB0aGUgYXR0cmlidXRlIHZhbHVlIChlLmcuIGB2YWx1ZT1cInNvbWUgdGV4dFwiYClcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIWJpbmRlciAmJiB2YWx1ZSAmJiAodHlwZSA9PT0gJ3RleHQnIHx8IHRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpKSB7XG4gICAgICAvLyBUZXN0IGlmIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgYm91bmQgKGUuZy4gYGhyZWY9XCIvcG9zdHMve3sgcG9zdC5pZCB9fVwiYClcbiAgICAgIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsICdfX2RlZmF1bHRfXycpO1xuICAgIH1cblxuICAgIHJldHVybiBiaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogQSBGb3JtYXR0ZXIgaXMgc3RvcmVkIHRvIHByb2Nlc3MgdGhlIHZhbHVlIG9mIGFuIGV4cHJlc3Npb24uIFRoaXMgYWx0ZXJzIHRoZSB2YWx1ZSBvZiB3aGF0IGNvbWVzIGluIHdpdGggYSBmdW5jdGlvblxuICAgKiB0aGF0IHJldHVybnMgYSBuZXcgdmFsdWUuIEZvcm1hdHRlcnMgYXJlIGFkZGVkIGJ5IHVzaW5nIGEgc2luZ2xlIHBpcGUgY2hhcmFjdGVyIChgfGApIGZvbGxvd2VkIGJ5IHRoZSBuYW1lIG9mIHRoZVxuICAgKiBmb3JtYXR0ZXIuIE11bHRpcGxlIGZvcm1hdHRlcnMgY2FuIGJlIHVzZWQgYnkgY2hhaW5pbmcgcGlwZXMgd2l0aCBmb3JtYXR0ZXIgbmFtZXMuIEZvcm1hdHRlcnMgbWF5IGFsc28gaGF2ZVxuICAgKiBhcmd1bWVudHMgcGFzc2VkIHRvIHRoZW0gYnkgdXNpbmcgdGhlIGNvbG9uIHRvIHNlcGFyYXRlIGFyZ3VtZW50cyBmcm9tIHRoZSBmb3JtYXR0ZXIgbmFtZS4gVGhlIHNpZ25hdHVyZSBvZiBhXG4gICAqIGZvcm1hdHRlciBzaG91bGQgYmUgYGZ1bmN0aW9uKHZhbHVlLCBhcmdzLi4uKWAgd2hlcmUgYXJncyBhcmUgZXh0cmEgcGFyYW1ldGVycyBwYXNzZWQgaW50byB0aGUgZm9ybWF0dGVyIGFmdGVyXG4gICAqIGNvbG9ucy5cbiAgICpcbiAgICogKkV4YW1wbGU6KlxuICAgKiBgYGBqc1xuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcigndXBwZXJjYXNlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUudG9VcHBlcmNhc2UoKVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcigncmVwbGFjZScsIGZ1bmN0aW9uKHZhbHVlLCByZXBsYWNlLCB3aXRoKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPSAnc3RyaW5nJykgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlLnJlcGxhY2UocmVwbGFjZSwgd2l0aClcbiAgICogfSlcbiAgICogYGBgaHRtbFxuICAgKiA8aDEgYmluZC10ZXh0PVwidGl0bGUgfCB1cHBlcmNhc2UgfCByZXBsYWNlOidMRVRURVInOidOVU1CRVInXCI+PC9oMT5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5HRVRUSU5HIFRPIEtOT1cgQUxMIEFCT1VUIFRIRSBOVU1CRVIgQTwvaDE+XG4gICAqIGBgYFxuICAgKlxuICAgKiBBIGB2YWx1ZUZvcm1hdHRlcmAgaXMgbGlrZSBhIGZvcm1hdHRlciBidXQgdXNlZCBzcGVjaWZpY2FsbHkgd2l0aCB0aGUgYHZhbHVlYCBiaW5kaW5nIHNpbmNlIGl0IGlzIGEgdHdvLXdheSBiaW5kaW5nLiBXaGVuXG4gICAqIHRoZSB2YWx1ZSBvZiB0aGUgZWxlbWVudCBpcyBjaGFuZ2VkIGEgYHZhbHVlRm9ybWF0dGVyYCBjYW4gYWRqdXN0IHRoZSB2YWx1ZSBmcm9tIGEgc3RyaW5nIHRvIHRoZSBjb3JyZWN0IHZhbHVlIHR5cGUgZm9yXG4gICAqIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24uIFRoZSBzaWduYXR1cmUgZm9yIGEgYHZhbHVlRm9ybWF0dGVyYCBpbmNsdWRlcyB0aGUgY3VycmVudCB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvblxuICAgKiBiZWZvcmUgdGhlIG9wdGlvbmFsIGFyZ3VtZW50cyAoaWYgYW55KS4gVGhpcyBhbGxvd3MgZGF0ZXMgdG8gYmUgYWRqdXN0ZWQgYW5kIHBvc3NpYmxleSBvdGhlciB1c2VzLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdudW1lcmljJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAodmFsdWUgPT0gbnVsbCB8fCBpc05hTih2YWx1ZSkpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignZGF0ZS1ob3VyJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAoICEoY3VycmVudFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgKSByZXR1cm4gJydcbiAgICogICB2YXIgaG91cnMgPSB2YWx1ZS5nZXRIb3VycygpXG4gICAqICAgaWYgKGhvdXJzID49IDEyKSBob3VycyAtPSAxMlxuICAgKiAgIGlmIChob3VycyA9PSAwKSBob3VycyA9IDEyXG4gICAqICAgcmV0dXJuIGhvdXJzXG4gICAqIH0pXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPk51bWJlciBBdHRlbmRpbmc6PC9sYWJlbD5cbiAgICogPGlucHV0IHNpemU9XCI0XCIgYmluZC12YWx1ZT1cImV2ZW50LmF0dGVuZGVlQ291bnQgfCBudW1lcmljXCI+XG4gICAqIDxsYWJlbD5UaW1lOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1ob3VyXCI+IDpcbiAgICogPGlucHV0IHNpemU9XCIyXCIgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLW1pbnV0ZVwiPlxuICAgKiA8c2VsZWN0IGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1hbXBtXCI+XG4gICAqICAgPG9wdGlvbj5BTTwvb3B0aW9uPlxuICAgKiAgIDxvcHRpb24+UE08L29wdGlvbj5cbiAgICogPC9zZWxlY3Q+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lLCBmb3JtYXR0ZXIpIHtcbiAgICB0aGlzLmZvcm1hdHRlcnNbbmFtZV0gPSBmb3JtYXR0ZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBmb3JtYXR0ZXIuXG4gICAqL1xuICB1bnJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSwgZm9ybWF0dGVyKSB7XG4gICAgZGVsZXRlIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBmb3JtYXR0ZXIuXG4gICAqL1xuICBnZXRGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBbiBBbmltYXRpb24gaXMgc3RvcmVkIHRvIGhhbmRsZSBhbmltYXRpb25zLiBBIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGlzIGFuIG9iamVjdCAob3IgY2xhc3Mgd2hpY2ggaW5zdGFudGlhdGVzIGludG9cbiAgICogYW4gb2JqZWN0KSB3aXRoIHRoZSBtZXRob2RzOlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWBcbiAgICogICAqIGBkaWRBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgd2lsbEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZU91dChlbGVtZW50KWBcbiAgICpcbiAgICogQW5pbWF0aW9uIGlzIGluY2x1ZGVkIHdpdGggYmluZGVycyB3aGljaCBhcmUgcmVnaXN0ZXJlZCB3aXRoIHRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IHNldCB0byBgdHJ1ZWAgKHN1Y2ggYXMgYGlmYFxuICAgKiBhbmQgYHJlcGVhdGApLiBBbmltYXRpb25zIGFsbG93IGVsZW1lbnRzIHRvIGZhZGUgaW4sIGZhZGUgb3V0LCBzbGlkZSBkb3duLCBjb2xsYXBzZSwgbW92ZSBmcm9tIG9uZSBsb2NhdGlvbiBpbiBhXG4gICAqIGxpc3QgdG8gYW5vdGhlciwgYW5kIG1vcmUuXG4gICAqXG4gICAqIFRvIHVzZSBhbmltYXRpb24gYWRkIGFuIGF0dHJpYnV0ZSBuYW1lZCBgYW5pbWF0ZWAgb250byBhbiBlbGVtZW50IHdpdGggYSBzdXBwb3J0ZWQgYmluZGVyLlxuICAgKlxuICAgKiAjIyMgQ1NTIEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgZG9lcyBub3QgaGF2ZSBhIHZhbHVlIG9yIHRoZSB2YWx1ZSBpcyBhIGNsYXNzIG5hbWUgKGUuZy4gYGFuaW1hdGU9XCIubXktZmFkZVwiYCkgdGhlblxuICAgKiBmcmFnbWVudHMgd2lsbCB1c2UgYSBDU1MgdHJhbnNpdGlvbi9hbmltYXRpb24uIENsYXNzZXMgd2lsbCBiZSBhZGRlZCBhbmQgcmVtb3ZlZCB0byB0cmlnZ2VyIHRoZSBhbmltYXRpb24uXG4gICAqXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgYWRkZWQgcmlnaHQgYWZ0ZXIgYW4gZWxlbWVudCBpcyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXMgY2FuIGJlIHVzZWQgdG8gc2V0IHRoZVxuICAgKiAgICAgb3BhY2l0eSB0byBgMC4wYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1pbmAgaXMgd2hlbiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgcmVtb3ZlZC4gSXQgY2FuIGJlIHVzZWQgdG8gc2V0IG9wYWNpdHkgdG8gYDEuMGAgZm9yIGV4YW1wbGUuIFRoZVxuICAgKiAgICAgYGFuaW1hdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBvbiB0aGlzIGNsYXNzIGlmIHVzaW5nIGl0LiBUaGUgYHRyYW5zaXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgaGVyZS4gTm90ZSB0aGF0XG4gICAqICAgICBhbHRob3VnaCB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBwbGFjZWQgb24gYW4gZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvXG4gICAqICAgICBpdHMgY2hpbGRyZW4gYXMgdGhleSBnZXQgYWRkZWQgYW5kIHJlbW92ZWQuXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGUgb3BhY2l0eSB0b1xuICAgKiAgICAgYDFgIGZvciBleGFtcGxlLiBJdCBpcyB0aGVuIHJlbW92ZWQgb24gdGhlIG5leHQgYW5pbWF0aW9uIGZyYW1lLlxuICAgKiAgICogYC5hbmltYXRlLW91dGAgaXMgYWRkZWQgd2hlbiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAwLjBgIGZvclxuICAgKiAgICAgZXhhbXBsZS4gVGhlIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUgb3JcbiAgICogICAgIG9uIGFub3RoZXIgc2VsZWN0b3IgdGhhdCBtYXRjaGVzIHRoZSBlbGVtZW50LiBOb3RlIHRoYXQgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuXG4gICAqICAgICBlbGVtZW50IHdpdGggdGhlIGByZXBlYXRgIGJpbmRlciwgdGhlc2UgY2xhc3NlcyBhcmUgYWRkZWQgdG8gaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKlxuICAgKiBJZiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBzZXQgdG8gYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW4gdGhhdCBjbGFzcyBuYW1lIHdpbGwgYmUgYWRkZWQgYXNcbiAgICogYSBjbGFzcyB0byB0aGUgZWxlbWVudCBkdXJpbmcgYW5pbWF0aW9uLiBUaGlzIGFsbG93cyB5b3UgdG8gdXNlIGAubXktZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLm15LWZhZGUuYW5pbWF0ZS1pbmAsXG4gICAqIGV0Yy4gaW4geW91ciBzdHlsZXNoZWV0cyB0byB1c2UgdGhlIHNhbWUgYW5pbWF0aW9uIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi5cbiAgICpcbiAgICogIyMjIEphdmFTY3JpcHQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBJZiB5b3UgbmVlZCBncmVhdGVyIGNvbnRyb2wgb3ZlciB5b3VyIGFuaW1hdGlvbnMgSmF2YVNjcmlwdCBtYXkgYmUgdXNlZC4gSXQgaXMgcmVjb21tZW5kZWQgdGhhdCBDU1Mgc3R5bGVzIHN0aWxsIGJlXG4gICAqIHVzZWQgYnkgaGF2aW5nIHlvdXIgY29kZSBzZXQgdGhlbSBtYW51YWxseS4gVGhpcyBhbGxvd3MgdGhlIGFuaW1hdGlvbiB0byB0YWtlIGFkdmFudGFnZSBvZiB0aGUgYnJvd3NlclxuICAgKiBvcHRpbWl6YXRpb25zIHN1Y2ggYXMgaGFyZHdhcmUgYWNjZWxlcmF0aW9uLiBUaGlzIGlzIG5vdCBhIHJlcXVpcmVtZW50LlxuICAgKlxuICAgKiBJbiBvcmRlciB0byB1c2UgSmF2YVNjcmlwdCBhbiBvYmplY3Qgc2hvdWxkIGJlIHBhc3NlZCBpbnRvIHRoZSBgYW5pbWF0aW9uYCBhdHRyaWJ1dGUgdXNpbmcgYW4gZXhwcmVzc2lvbi4gVGhpc1xuICAgKiBvYmplY3Qgc2hvdWxkIGhhdmUgbWV0aG9kcyB0aGF0IGFsbG93IEphdmFTY3JpcHQgYW5pbWF0aW9uIGhhbmRsaW5nLiBGb3IgZXhhbXBsZSwgaWYgeW91IGFyZSBib3VuZCB0byBhIGNvbnRleHRcbiAgICogd2l0aCBhbiBvYmplY3QgbmFtZWQgYGN1c3RvbUZhZGVgIHdpdGggYW5pbWF0aW9uIG1ldGhvZHMsIHlvdXIgZWxlbWVudCBzaG91bGQgaGF2ZSBgYXR0cmlidXRlPVwie3tjdXN0b21GYWRlfX1cImAuXG4gICAqIFRoZSBmb2xsb3dpbmcgaXMgYSBsaXN0IG9mIHRoZSBtZXRob2RzIHlvdSBtYXkgaW1wbGVtZW50LlxuICAgKlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGFuIGVsZW1lbnQgaGFzIGJlZW4gaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBVc2UgaXQgdG8gc2V0IGluaXRpYWxcbiAgICogICAgIENTUyBwcm9wZXJ0aWVzIGJlZm9yZSBgYW5pbWF0ZUluYCBpcyBjYWxsZWQgdG8gc2V0IHRoZSBmaW5hbCBwcm9wZXJ0aWVzLiBUaGlzIG1ldGhvZCBpcyBvcHRpb25hbC5cbiAgICogICAqIGBhbmltYXRlSW4oZWxlbWVudCwgY2FsbGJhY2spYCB3aWxsIGJlIGNhbGxlZCBzaG9ydGx5IGFmdGVyIGB3aWxsQW5pbWF0ZUluYCBpZiBpdCB3YXMgZGVmaW5lZC4gVXNlIGl0IHRvIHNldFxuICAgKiAgICAgZmluYWwgQ1NTIHByb3BlcnRpZXMuXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBkb25lKWAgd2lsbCBiZSBjYWxsZWQgYmVmb3JlIGFuIGVsZW1lbnQgaXMgdG8gYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uIGBkb25lYCBtdXN0IGJlXG4gICAqICAgICBjYWxsZWQgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlIGluIG9yZGVyIGZvciB0aGUgYmluZGVyIHRvIGZpbmlzaCByZW1vdmluZyB0aGUgZWxlbWVudC4gKipSZW1lbWJlcioqIHRvXG4gICAqICAgICBjbGVhbiB1cCBieSByZW1vdmluZyBhbnkgc3R5bGVzIHRoYXQgd2VyZSBhZGRlZCBiZWZvcmUgY2FsbGluZyBgZG9uZSgpYCBzbyB0aGUgZWxlbWVudCBjYW4gYmUgcmV1c2VkIHdpdGhvdXRcbiAgICogICAgIHNpZGUtZWZmZWN0cy5cbiAgICpcbiAgICogVGhlIGBlbGVtZW50YCBwYXNzZWQgaW4gd2lsbCBiZSBwb2x5ZmlsbGVkIGZvciB3aXRoIHRoZSBgYW5pbWF0ZWAgbWV0aG9kIHVzaW5nXG4gICAqIGh0dHBzOi8vZ2l0aHViLmNvbS93ZWItYW5pbWF0aW9ucy93ZWItYW5pbWF0aW9ucy1qcy5cbiAgICpcbiAgICogIyMjIFJlZ2lzdGVyZWQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBBbmltYXRpb25zIG1heSBiZSByZWdpc3RlcmVkIGFuZCB1c2VkIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi4gVG8gdXNlIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gdXNlIGl0cyBuYW1lIGluXG4gICAqIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIChlLmcuIGBhbmltYXRlPVwiZmFkZVwiYCkuIE5vdGUgdGhlIG9ubHkgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gYW5kIGFcbiAgICogY2xhc3MgcmVnaXN0cmF0aW9uIGlzIGNsYXNzIHJlZ2lzdHJhdGlvbnMgYXJlIHByZWZpeGVkIHdpdGggYSBkb3QgKGAuYCkuIFJlZ2lzdGVyZWQgYW5pbWF0aW9ucyBhcmUgYWx3YXlzXG4gICAqIEphdmFTY3JpcHQgYW5pbWF0aW9ucy4gVG8gcmVnaXN0ZXIgYW4gYW5pbWF0aW9uIHVzZSBgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdClgLlxuICAgKlxuICAgKiBUaGUgQW5pbWF0aW9uIG1vZHVsZSBjb21lcyB3aXRoIHNldmVyYWwgY29tbW9uIGFuaW1hdGlvbnMgcmVnaXN0ZXJlZCBieSBkZWZhdWx0LiBUaGUgZGVmYXVsdHMgdXNlIENTUyBzdHlsZXMgdG9cbiAgICogd29yayBjb3JyZWN0bHksIHVzaW5nIGBlbGVtZW50LmFuaW1hdGVgLlxuICAgKlxuICAgKiAgICogYGZhZGVgIHdpbGwgZmFkZSBhbiBlbGVtZW50IGluIGFuZCBvdXQgb3ZlciAzMDAgbWlsbGlzZWNvbmRzLlxuICAgKiAgICogYHNsaWRlYCB3aWxsIHNsaWRlIGFuIGVsZW1lbnQgZG93biB3aGVuIGl0IGlzIGFkZGVkIGFuZCBzbGlkZSBpdCB1cCB3aGVuIGl0IGlzIHJlbW92ZWQuXG4gICAqICAgKiBgc2xpZGUtbW92ZWAgd2lsbCBtb3ZlIGFuIGVsZW1lbnQgZnJvbSBpdHMgb2xkIGxvY2F0aW9uIHRvIGl0cyBuZXcgbG9jYXRpb24gaW4gYSByZXBlYXRlZCBsaXN0LlxuICAgKlxuICAgKiBEbyB5b3UgaGF2ZSBhbm90aGVyIGNvbW1vbiBhbmltYXRpb24geW91IHRoaW5rIHNob3VsZCBiZSBpbmNsdWRlZCBieSBkZWZhdWx0PyBTdWJtaXQgYSBwdWxsIHJlcXVlc3QhXG4gICAqL1xuICByZWdpc3RlckFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSwgYW5pbWF0aW9uT2JqZWN0KSB7XG4gICAgdGhpcy5hbmltYXRpb25zW25hbWVdID0gYW5pbWF0aW9uT2JqZWN0O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFuIGFuaW1hdGlvbi5cbiAgICovXG4gIHVucmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEdldHMgYSByZWdpc3RlcmVkIGFuaW1hdGlvbi5cbiAgICovXG4gIGdldEFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFuaW1hdGlvbnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogUHJlcGFyZSBhbiBlbGVtZW50IHRvIGJlIGVhc2llciBhbmltYXRhYmxlIChhZGRpbmcgYSBzaW1wbGUgYGFuaW1hdGVgIHBvbHlmaWxsIGlmIG5lZWRlZClcbiAgICovXG4gIG1ha2VFbGVtZW50QW5pbWF0YWJsZTogYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZSxcblxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkZWxpbWl0ZXJzIHRoYXQgZGVmaW5lIGFuIGV4cHJlc3Npb24uIERlZmF1bHQgaXMgYHt7YCBhbmQgYH19YCBidXQgdGhpcyBtYXkgYmUgb3ZlcnJpZGRlbi4gSWYgZW1wdHlcbiAgICogc3RyaW5ncyBhcmUgcGFzc2VkIGluIChmb3IgdHlwZSBcImF0dHJpYnV0ZVwiIG9ubHkpIHRoZW4gbm8gZGVsaW1pdGVycyBhcmUgcmVxdWlyZWQgZm9yIG1hdGNoaW5nIGF0dHJpYnV0ZXMsIGJ1dCB0aGVcbiAgICogZGVmYXVsdCBhdHRyaWJ1dGUgbWF0Y2hlciB3aWxsIG5vdCBhcHBseSB0byB0aGUgcmVzdCBvZiB0aGUgYXR0cmlidXRlcy5cbiAgICovXG4gIHNldEV4cHJlc3Npb25EZWxpbWl0ZXJzOiBmdW5jdGlvbih0eXBlLCBwcmUsIHBvc3QpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdFeHByZXNzaW9uIGRlbGltaXRlcnMgbXVzdCBiZSBvZiB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG5cbiAgICB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHIgPSBuZXcgUmVnRXhwKGVzY2FwZVJlZ0V4cChwcmUpICsgJyguKj8pJyArIGVzY2FwZVJlZ0V4cChwb3N0KSwgJ2cnKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUZXN0cyB3aGV0aGVyIGEgdmFsdWUgaGFzIGFuIGV4cHJlc3Npb24gaW4gaXQuIFNvbWV0aGluZyBsaWtlIGAvdXNlci97e3VzZXIuaWR9fWAuXG4gICAqL1xuICBpc0JvdW5kOiBmdW5jdGlvbih0eXBlLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lzQm91bmQgbXVzdCBwcm92aWRlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICByZXR1cm4gQm9vbGVhbihleHByICYmIHZhbHVlICYmIHZhbHVlLm1hdGNoKGV4cHIpKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUaGUgc29ydCBmdW5jdGlvbiB0byBzb3J0IGJpbmRlcnMgY29ycmVjdGx5XG4gICAqL1xuICBiaW5kaW5nU29ydDogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBiLnByb3RvdHlwZS5wcmlvcml0eSAtIGEucHJvdG90eXBlLnByaW9yaXR5O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGFuIGludmVydGVkIGV4cHJlc3Npb24gZnJvbSBgL3VzZXIve3t1c2VyLmlkfX1gIHRvIGBcIi91c2VyL1wiICsgdXNlci5pZGBcbiAgICovXG4gIGNvZGlmeUV4cHJlc3Npb246IGZ1bmN0aW9uKHR5cGUsIHRleHQpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb2RpZnlFeHByZXNzaW9uIG11c3QgdXNlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cblxuICAgIHZhciBleHByID0gdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByO1xuICAgIHZhciBtYXRjaCA9IHRleHQubWF0Y2goZXhwcik7XG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICByZXR1cm4gJ1wiJyArIHRleHQucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICB9IGVsc2UgaWYgKG1hdGNoLmxlbmd0aCA9PT0gMSAmJiBtYXRjaFswXSA9PT0gdGV4dCkge1xuICAgICAgcmV0dXJuIHRleHQucmVwbGFjZShleHByLCAnJDEnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIG5ld1RleHQgPSAnXCInLCBsYXN0SW5kZXggPSAwO1xuICAgICAgd2hpbGUgKG1hdGNoID0gZXhwci5leGVjKHRleHQpKSB7XG4gICAgICAgIHZhciBzdHIgPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCwgZXhwci5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpO1xuICAgICAgICBuZXdUZXh0ICs9IHN0ci5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyk7XG4gICAgICAgIG5ld1RleHQgKz0gJ1wiICsgKCcgKyBtYXRjaFsxXSArICcgfHwgXCJcIikgKyBcIic7XG4gICAgICAgIGxhc3RJbmRleCA9IGV4cHIubGFzdEluZGV4O1xuICAgICAgfVxuICAgICAgbmV3VGV4dCArPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCkucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICAgIHJldHVybiBuZXdUZXh0LnJlcGxhY2UoL15cIlwiIFxcKyB8IFwiXCIgXFwrIHwgXFwrIFwiXCIkL2csICcnKTtcbiAgICB9XG4gIH1cblxufTtcblxuLy8gVGFrZXMgYSBzdHJpbmcgbGlrZSBcIihcXCopXCIgb3IgXCJvbi1cXCpcIiBhbmQgY29udmVydHMgaXQgaW50byBhIHJlZ3VsYXIgZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cCh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL1stW1xcXXt9KCkqKz8uLFxcXFxeJHwjXFxzXS9nLCBcIlxcXFwkJlwiKTtcbn1cbiIsIi8qXG5Db3B5cmlnaHQgKGMpIDIwMTUgSmFjb2IgV3JpZ2h0IDxqYWN3cmlnaHRAZ21haWwuY29tPlxuXG5QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG5vZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG5pbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG50byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG5jb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbmZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG5cblRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG5hbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cblxuVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG5GSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbkFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbkxJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG5PVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG5USEUgU09GVFdBUkUuXG4qL1xuLy8gIyBEaWZmXG4vLyA+IEJhc2VkIG9uIHdvcmsgZnJvbSBHb29nbGUncyBvYnNlcnZlLWpzIHBvbHlmaWxsOiBodHRwczovL2dpdGh1Yi5jb20vUG9seW1lci9vYnNlcnZlLWpzXG5cbi8vIEEgbmFtZXNwYWNlIHRvIHN0b3JlIHRoZSBmdW5jdGlvbnMgb25cbnZhciBkaWZmID0gZXhwb3J0cztcblxuKGZ1bmN0aW9uKCkge1xuXG4gIGRpZmYuY2xvbmUgPSBjbG9uZTtcbiAgZGlmZi52YWx1ZXMgPSBkaWZmVmFsdWVzO1xuICBkaWZmLmJhc2ljID0gZGlmZkJhc2ljO1xuICBkaWZmLm9iamVjdHMgPSBkaWZmT2JqZWN0cztcbiAgZGlmZi5hcnJheXMgPSBkaWZmQXJyYXlzO1xuXG5cbiAgLy8gQSBjaGFuZ2UgcmVjb3JkIGZvciB0aGUgb2JqZWN0IGNoYW5nZXNcbiAgZnVuY3Rpb24gQ2hhbmdlUmVjb3JkKG9iamVjdCwgdHlwZSwgbmFtZSwgb2xkVmFsdWUpIHtcbiAgICB0aGlzLm9iamVjdCA9IG9iamVjdDtcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5vbGRWYWx1ZSA9IG9sZFZhbHVlO1xuICB9XG5cbiAgLy8gQSBzcGxpY2UgcmVjb3JkIGZvciB0aGUgYXJyYXkgY2hhbmdlc1xuICBmdW5jdGlvbiBTcGxpY2UoaW5kZXgsIHJlbW92ZWQsIGFkZGVkQ291bnQpIHtcbiAgICB0aGlzLmluZGV4ID0gaW5kZXg7XG4gICAgdGhpcy5yZW1vdmVkID0gcmVtb3ZlZDtcbiAgICB0aGlzLmFkZGVkQ291bnQgPSBhZGRlZENvdW50O1xuICB9XG5cblxuICAvLyBDcmVhdGVzIGEgY2xvbmUgb3IgY29weSBvZiBhbiBhcnJheSBvciBvYmplY3QgKG9yIHNpbXBseSByZXR1cm5zIGEgc3RyaW5nL251bWJlci9ib29sZWFuIHdoaWNoIGFyZSBpbW11dGFibGUpXG4gIC8vIERvZXMgbm90IHByb3ZpZGUgZGVlcCBjb3BpZXMuXG4gIGZ1bmN0aW9uIGNsb25lKHZhbHVlLCBkZWVwKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoZGVlcCkge1xuICAgICAgICByZXR1cm4gdmFsdWUubWFwKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIGNsb25lKHZhbHVlLCBkZWVwKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh2YWx1ZS52YWx1ZU9mKCkgIT09IHZhbHVlKSB7XG4gICAgICAgIHJldHVybiBuZXcgdmFsdWUuY29uc3RydWN0b3IodmFsdWUudmFsdWVPZigpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjb3B5ID0ge307XG4gICAgICAgIGZvciAodmFyIGtleSBpbiB2YWx1ZSkge1xuICAgICAgICAgIHZhciBvYmpWYWx1ZSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgICAgIG9ialZhbHVlID0gY2xvbmUob2JqVmFsdWUsIGRlZXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb3B5W2tleV0gPSBvYmpWYWx1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29weTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIHZhbHVlcywgcmV0dXJuaW5nIGEgdHJ1dGh5IHZhbHVlIGlmIHRoZXJlIGFyZSBjaGFuZ2VzIG9yIGBmYWxzZWAgaWYgdGhlcmUgYXJlIG5vIGNoYW5nZXMuIElmIHRoZSB0d29cbiAgLy8gdmFsdWVzIGFyZSBib3RoIGFycmF5cyBvciBib3RoIG9iamVjdHMsIGFuIGFycmF5IG9mIGNoYW5nZXMgKHNwbGljZXMgb3IgY2hhbmdlIHJlY29yZHMpIGJldHdlZW4gdGhlIHR3byB3aWxsIGJlXG4gIC8vIHJldHVybmVkLiBPdGhlcndpc2UgIGB0cnVlYCB3aWxsIGJlIHJldHVybmVkLlxuICBmdW5jdGlvbiBkaWZmVmFsdWVzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiBBcnJheS5pc0FycmF5KG9sZFZhbHVlKSkge1xuICAgICAgLy8gSWYgYW4gYXJyYXkgaGFzIGNoYW5nZWQgY2FsY3VsYXRlIHRoZSBzcGxpY2VzXG4gICAgICB2YXIgc3BsaWNlcyA9IGRpZmZBcnJheXModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgIHJldHVybiBzcGxpY2VzLmxlbmd0aCA/IHNwbGljZXMgOiBmYWxzZTtcbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIG9sZFZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gSWYgYW4gb2JqZWN0IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgY2huYWdlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIHZhciB2YWx1ZVZhbHVlID0gdmFsdWUudmFsdWVPZigpO1xuICAgICAgdmFyIG9sZFZhbHVlVmFsdWUgPSBvbGRWYWx1ZS52YWx1ZU9mKCk7XG5cbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIGlmICh0eXBlb2YgdmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlVmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZVZhbHVlICE9PSBvbGRWYWx1ZVZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGNoYW5nZVJlY29yZHMgPSBkaWZmT2JqZWN0cyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgICAgICByZXR1cm4gY2hhbmdlUmVjb3Jkcy5sZW5ndGggPyBjaGFuZ2VSZWNvcmRzIDogZmFsc2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgIHJldHVybiBkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBiYXNpYyB0eXBlcywgcmV0dXJuaW5nIHRydWUgaWYgY2hhbmdlZCBvciBmYWxzZSBpZiBub3RcbiAgZnVuY3Rpb24gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgaWYgKHZhbHVlICYmIG9sZFZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgdmFyIHZhbHVlVmFsdWUgPSB2YWx1ZS52YWx1ZU9mKCk7XG4gICAgICB2YXIgb2xkVmFsdWVWYWx1ZSA9IG9sZFZhbHVlLnZhbHVlT2YoKTtcblxuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZVZhbHVlICE9PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcmV0dXJuIGRpZmZCYXNpYyh2YWx1ZVZhbHVlLCBvbGRWYWx1ZVZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiBhIHZhbHVlIGhhcyBjaGFuZ2VkIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnbnVtYmVyJyAmJiBpc05hTih2YWx1ZSkgJiYgaXNOYU4ob2xkVmFsdWUpKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB2YWx1ZSAhPT0gb2xkVmFsdWU7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gb2JqZWN0cyByZXR1cm5pbmcgYW4gYXJyYXkgb2YgY2hhbmdlIHJlY29yZHMuIFRoZSBjaGFuZ2UgcmVjb3JkIGxvb2tzIGxpa2U6XG4gIC8vIGBgYGphdmFzY3JpcHRcbiAgLy8ge1xuICAvLyAgIG9iamVjdDogb2JqZWN0LFxuICAvLyAgIHR5cGU6ICdkZWxldGVkfHVwZGF0ZWR8bmV3JyxcbiAgLy8gICBuYW1lOiAncHJvcGVydHlOYW1lJyxcbiAgLy8gICBvbGRWYWx1ZTogb2xkVmFsdWVcbiAgLy8gfVxuICAvLyBgYGBcbiAgZnVuY3Rpb24gZGlmZk9iamVjdHMob2JqZWN0LCBvbGRPYmplY3QpIHtcbiAgICB2YXIgY2hhbmdlUmVjb3JkcyA9IFtdO1xuICAgIHZhciBwcm9wLCBvbGRWYWx1ZSwgdmFsdWU7XG5cbiAgICAvLyBHb2VzIHRocm91Z2ggdGhlIG9sZCBvYmplY3QgKHNob3VsZCBiZSBhIGNsb25lKSBhbmQgbG9vayBmb3IgdGhpbmdzIHRoYXQgYXJlIG5vdyBnb25lIG9yIGNoYW5nZWRcbiAgICBmb3IgKHByb3AgaW4gb2xkT2JqZWN0KSB7XG4gICAgICBvbGRWYWx1ZSA9IG9sZE9iamVjdFtwcm9wXTtcbiAgICAgIHZhbHVlID0gb2JqZWN0W3Byb3BdO1xuXG4gICAgICAvLyBBbGxvdyBmb3IgdGhlIGNhc2Ugb2Ygb2JqLnByb3AgPSB1bmRlZmluZWQgKHdoaWNoIGlzIGEgbmV3IHByb3BlcnR5LCBldmVuIGlmIGl0IGlzIHVuZGVmaW5lZClcbiAgICAgIGlmICh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmICFkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSkge1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgLy8gSWYgdGhlIHByb3BlcnR5IGlzIGdvbmUgaXQgd2FzIHJlbW92ZWRcbiAgICAgIGlmICghIChwcm9wIGluIG9iamVjdCkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAnZGVsZXRlZCcsIHByb3AsIG9sZFZhbHVlKSk7XG4gICAgICB9IGVsc2UgaWYgKGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ3VwZGF0ZWQnLCBwcm9wLCBvbGRWYWx1ZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCBhbmQgbG9va3MgZm9yIHRoaW5ncyB0aGF0IGFyZSBuZXdcbiAgICBmb3IgKHByb3AgaW4gb2JqZWN0KSB7XG4gICAgICB2YWx1ZSA9IG9iamVjdFtwcm9wXTtcbiAgICAgIGlmICghIChwcm9wIGluIG9sZE9iamVjdCkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAnbmV3JywgcHJvcCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KG9iamVjdCkgJiYgb2JqZWN0Lmxlbmd0aCAhPT0gb2xkT2JqZWN0Lmxlbmd0aCkge1xuICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAndXBkYXRlZCcsICdsZW5ndGgnLCBvbGRPYmplY3QubGVuZ3RoKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZVJlY29yZHM7XG4gIH1cblxuXG5cblxuXG4gIEVESVRfTEVBVkUgPSAwXG4gIEVESVRfVVBEQVRFID0gMVxuICBFRElUX0FERCA9IDJcbiAgRURJVF9ERUxFVEUgPSAzXG5cblxuICAvLyBEaWZmcyB0d28gYXJyYXlzIHJldHVybmluZyBhbiBhcnJheSBvZiBzcGxpY2VzLiBBIHNwbGljZSBvYmplY3QgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgaW5kZXg6IDMsXG4gIC8vICAgcmVtb3ZlZDogW2l0ZW0sIGl0ZW1dLFxuICAvLyAgIGFkZGVkQ291bnQ6IDBcbiAgLy8gfVxuICAvLyBgYGBcbiAgZnVuY3Rpb24gZGlmZkFycmF5cyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICB2YXIgY3VycmVudFN0YXJ0ID0gMDtcbiAgICB2YXIgY3VycmVudEVuZCA9IHZhbHVlLmxlbmd0aDtcbiAgICB2YXIgb2xkU3RhcnQgPSAwO1xuICAgIHZhciBvbGRFbmQgPSBvbGRWYWx1ZS5sZW5ndGg7XG5cbiAgICB2YXIgbWluTGVuZ3RoID0gTWF0aC5taW4oY3VycmVudEVuZCwgb2xkRW5kKTtcbiAgICB2YXIgcHJlZml4Q291bnQgPSBzaGFyZWRQcmVmaXgodmFsdWUsIG9sZFZhbHVlLCBtaW5MZW5ndGgpO1xuICAgIHZhciBzdWZmaXhDb3VudCA9IHNoYXJlZFN1ZmZpeCh2YWx1ZSwgb2xkVmFsdWUsIG1pbkxlbmd0aCAtIHByZWZpeENvdW50KTtcblxuICAgIGN1cnJlbnRTdGFydCArPSBwcmVmaXhDb3VudDtcbiAgICBvbGRTdGFydCArPSBwcmVmaXhDb3VudDtcbiAgICBjdXJyZW50RW5kIC09IHN1ZmZpeENvdW50O1xuICAgIG9sZEVuZCAtPSBzdWZmaXhDb3VudDtcblxuICAgIGlmIChjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0ID09PSAwICYmIG9sZEVuZCAtIG9sZFN0YXJ0ID09PSAwKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLy8gaWYgbm90aGluZyB3YXMgYWRkZWQsIG9ubHkgcmVtb3ZlZCBmcm9tIG9uZSBzcG90XG4gICAgaWYgKGN1cnJlbnRTdGFydCA9PT0gY3VycmVudEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZShjdXJyZW50U3RhcnQsIG9sZFZhbHVlLnNsaWNlKG9sZFN0YXJ0LCBvbGRFbmQpLCAwKSBdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIHJlbW92ZWQsIG9ubHkgYWRkZWQgdG8gb25lIHNwb3RcbiAgICBpZiAob2xkU3RhcnQgPT09IG9sZEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZShjdXJyZW50U3RhcnQsIFtdLCBjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0KSBdO1xuICAgIH1cblxuICAgIC8vIGEgbWl4dHVyZSBvZiBhZGRzIGFuZCByZW1vdmVzXG4gICAgdmFyIGRpc3RhbmNlcyA9IGNhbGNFZGl0RGlzdGFuY2VzKHZhbHVlLCBjdXJyZW50U3RhcnQsIGN1cnJlbnRFbmQsIG9sZFZhbHVlLCBvbGRTdGFydCwgb2xkRW5kKTtcbiAgICB2YXIgb3BzID0gc3BsaWNlT3BlcmF0aW9uc0Zyb21FZGl0RGlzdGFuY2VzKGRpc3RhbmNlcyk7XG5cbiAgICB2YXIgc3BsaWNlID0gbnVsbDtcbiAgICB2YXIgc3BsaWNlcyA9IFtdO1xuICAgIHZhciBpbmRleCA9IGN1cnJlbnRTdGFydDtcbiAgICB2YXIgb2xkSW5kZXggPSBvbGRTdGFydDtcblxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gb3BzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIG9wID0gb3BzW2ldO1xuICAgICAgaWYgKG9wID09PSBFRElUX0xFQVZFKSB7XG4gICAgICAgIGlmIChzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2VzLnB1c2goc3BsaWNlKTtcbiAgICAgICAgICBzcGxpY2UgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXgrKztcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfVVBEQVRFKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLmFkZGVkQ291bnQrKztcbiAgICAgICAgaW5kZXgrKztcblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0FERCkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0RFTEVURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5yZW1vdmVkLnB1c2gob2xkVmFsdWVbb2xkSW5kZXhdKTtcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3BsaWNlKSB7XG4gICAgICBzcGxpY2VzLnB1c2goc3BsaWNlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc3BsaWNlcztcbiAgfVxuXG5cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgYmVnaW5uaW5nIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFByZWZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VhcmNoTGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChkaWZmQmFzaWMoY3VycmVudFtpXSwgb2xkW2ldKSkge1xuICAgICAgICByZXR1cm4gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHNlYXJjaExlbmd0aDtcbiAgfVxuXG5cbiAgLy8gZmluZCB0aGUgbnVtYmVyIG9mIGl0ZW1zIGF0IHRoZSBlbmQgdGhhdCBhcmUgdGhlIHNhbWVcbiAgZnVuY3Rpb24gc2hhcmVkU3VmZml4KGN1cnJlbnQsIG9sZCwgc2VhcmNoTGVuZ3RoKSB7XG4gICAgdmFyIGluZGV4MSA9IGN1cnJlbnQubGVuZ3RoO1xuICAgIHZhciBpbmRleDIgPSBvbGQubGVuZ3RoO1xuICAgIHZhciBjb3VudCA9IDA7XG4gICAgd2hpbGUgKGNvdW50IDwgc2VhcmNoTGVuZ3RoICYmICFkaWZmQmFzaWMoY3VycmVudFstLWluZGV4MV0sIG9sZFstLWluZGV4Ml0pKSB7XG4gICAgICBjb3VudCsrO1xuICAgIH1cbiAgICByZXR1cm4gY291bnQ7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpIHtcbiAgICB2YXIgaSA9IGRpc3RhbmNlcy5sZW5ndGggLSAxO1xuICAgIHZhciBqID0gZGlzdGFuY2VzWzBdLmxlbmd0aCAtIDE7XG4gICAgdmFyIGN1cnJlbnQgPSBkaXN0YW5jZXNbaV1bal07XG4gICAgdmFyIGVkaXRzID0gW107XG4gICAgd2hpbGUgKGkgPiAwIHx8IGogPiAwKSB7XG4gICAgICBpZiAoaSA9PT0gMCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGogPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHZhciBub3J0aFdlc3QgPSBkaXN0YW5jZXNbaSAtIDFdW2ogLSAxXTtcbiAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqXTtcbiAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpXVtqIC0gMV07XG5cbiAgICAgIGlmICh3ZXN0IDwgbm9ydGgpIHtcbiAgICAgICAgbWluID0gd2VzdCA8IG5vcnRoV2VzdCA/IHdlc3QgOiBub3J0aFdlc3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtaW4gPSBub3J0aCA8IG5vcnRoV2VzdCA/IG5vcnRoIDogbm9ydGhXZXN0O1xuICAgICAgfVxuXG4gICAgICBpZiAobWluID09PSBub3J0aFdlc3QpIHtcbiAgICAgICAgaWYgKG5vcnRoV2VzdCA9PT0gY3VycmVudCkge1xuICAgICAgICAgIGVkaXRzLnB1c2goRURJVF9MRUFWRSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZWRpdHMucHVzaChFRElUX1VQREFURSk7XG4gICAgICAgICAgY3VycmVudCA9IG5vcnRoV2VzdDtcbiAgICAgICAgfVxuICAgICAgICBpLS07XG4gICAgICAgIGotLTtcbiAgICAgIH0gZWxzZSBpZiAobWluID09PSB3ZXN0KSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9ERUxFVEUpO1xuICAgICAgICBpLS07XG4gICAgICAgIGN1cnJlbnQgPSB3ZXN0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0FERCk7XG4gICAgICAgIGotLTtcbiAgICAgICAgY3VycmVudCA9IG5vcnRoO1xuICAgICAgfVxuICAgIH1cbiAgICBlZGl0cy5yZXZlcnNlKCk7XG4gICAgcmV0dXJuIGVkaXRzO1xuICB9XG5cblxuICBmdW5jdGlvbiBjYWxjRWRpdERpc3RhbmNlcyhjdXJyZW50LCBjdXJyZW50U3RhcnQsIGN1cnJlbnRFbmQsIG9sZCwgb2xkU3RhcnQsIG9sZEVuZCkge1xuICAgIC8vIFwiRGVsZXRpb25cIiBjb2x1bW5zXG4gICAgdmFyIHJvd0NvdW50ID0gb2xkRW5kIC0gb2xkU3RhcnQgKyAxO1xuICAgIHZhciBjb2x1bW5Db3VudCA9IGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQgKyAxO1xuICAgIHZhciBkaXN0YW5jZXMgPSBuZXcgQXJyYXkocm93Q291bnQpO1xuICAgIHZhciBpLCBqO1xuXG4gICAgLy8gXCJBZGRpdGlvblwiIHJvd3MuIEluaXRpYWxpemUgbnVsbCBjb2x1bW4uXG4gICAgZm9yIChpID0gMDsgaSA8IHJvd0NvdW50OyBpKyspIHtcbiAgICAgIGRpc3RhbmNlc1tpXSA9IG5ldyBBcnJheShjb2x1bW5Db3VudCk7XG4gICAgICBkaXN0YW5jZXNbaV1bMF0gPSBpO1xuICAgIH1cblxuICAgIC8vIEluaXRpYWxpemUgbnVsbCByb3dcbiAgICBmb3IgKGogPSAwOyBqIDwgY29sdW1uQ291bnQ7IGorKykge1xuICAgICAgZGlzdGFuY2VzWzBdW2pdID0gajtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAxOyBpIDwgcm93Q291bnQ7IGkrKykge1xuICAgICAgZm9yIChqID0gMTsgaiA8IGNvbHVtbkNvdW50OyBqKyspIHtcbiAgICAgICAgaWYgKCFkaWZmQmFzaWMoY3VycmVudFtjdXJyZW50U3RhcnQgKyBqIC0gMV0sIG9sZFtvbGRTdGFydCArIGkgLSAxXSkpIHtcbiAgICAgICAgICBkaXN0YW5jZXNbaV1bal0gPSBkaXN0YW5jZXNbaSAtIDFdW2ogLSAxXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB2YXIgbm9ydGggPSBkaXN0YW5jZXNbaSAtIDFdW2pdICsgMTtcbiAgICAgICAgICB2YXIgd2VzdCA9IGRpc3RhbmNlc1tpXVtqIC0gMV0gKyAxO1xuICAgICAgICAgIGRpc3RhbmNlc1tpXVtqXSA9IG5vcnRoIDwgd2VzdCA/IG5vcnRoIDogd2VzdDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkaXN0YW5jZXM7XG4gIH1cbn0pKCk7XG4iLCIvLyAjIENoaXAgRXhwcmVzc2lvblxuXG4vLyBQYXJzZXMgYSBzdHJpbmcgb2YgSmF2YVNjcmlwdCBpbnRvIGEgZnVuY3Rpb24gd2hpY2ggY2FuIGJlIGJvdW5kIHRvIGEgc2NvcGUuXG4vL1xuLy8gQWxsb3dzIHVuZGVmaW5lZCBvciBudWxsIHZhbHVlcyB0byByZXR1cm4gdW5kZWZpbmVkIHJhdGhlciB0aGFuIHRocm93aW5nXG4vLyBlcnJvcnMsIGFsbG93cyBmb3IgZm9ybWF0dGVycyBvbiBkYXRhLCBhbmQgcHJvdmlkZXMgZGV0YWlsZWQgZXJyb3IgcmVwb3J0aW5nLlxuXG4vLyBUaGUgZXhwcmVzc2lvbiBvYmplY3Qgd2l0aCBpdHMgZXhwcmVzc2lvbiBjYWNoZS5cbnZhciBleHByZXNzaW9uID0gZXhwb3J0cztcbmV4cHJlc3Npb24uY2FjaGUgPSB7fTtcbmV4cHJlc3Npb24uZ2xvYmFscyA9IFsndHJ1ZScsICdmYWxzZScsICdudWxsJywgJ3VuZGVmaW5lZCcsICd3aW5kb3cnLCAndGhpcyddO1xuZXhwcmVzc2lvbi5nZXQgPSBnZXRFeHByZXNzaW9uO1xuZXhwcmVzc2lvbi5nZXRTZXR0ZXIgPSBnZXRTZXR0ZXI7XG5leHByZXNzaW9uLmJpbmQgPSBiaW5kRXhwcmVzc2lvbjtcblxuXG4vLyBDcmVhdGVzIGEgZnVuY3Rpb24gZnJvbSB0aGUgZ2l2ZW4gZXhwcmVzc2lvbi4gQW4gYG9wdGlvbnNgIG9iamVjdCBtYXkgYmVcbi8vIHByb3ZpZGVkIHdpdGggdGhlIGZvbGxvd2luZyBvcHRpb25zOlxuLy8gKiBgYXJnc2AgaXMgYW4gYXJyYXkgb2Ygc3RyaW5ncyB3aGljaCB3aWxsIGJlIHRoZSBmdW5jdGlvbidzIGFyZ3VtZW50IG5hbWVzXG4vLyAqIGBnbG9iYWxzYCBpcyBhbiBhcnJheSBvZiBzdHJpbmdzIHdoaWNoIGRlZmluZSBnbG9iYWxzIGF2YWlsYWJsZSB0byB0aGVcbi8vIGZ1bmN0aW9uICh0aGVzZSB3aWxsIG5vdCBiZSBwcmVmaXhlZCB3aXRoIGB0aGlzLmApLiBgJ3RydWUnYCwgYCdmYWxzZSdgLFxuLy8gYCdudWxsJ2AsIGFuZCBgJ3dpbmRvdydgIGFyZSBpbmNsdWRlZCBieSBkZWZhdWx0LlxuLy9cbi8vIFRoaXMgZnVuY3Rpb24gd2lsbCBiZSBjYWNoZWQgc28gc3Vic2VxdWVudCBjYWxscyB3aXRoIHRoZSBzYW1lIGV4cHJlc3Npb24gd2lsbFxuLy8gcmV0dXJuIHRoZSBzYW1lIGZ1bmN0aW9uLiBFLmcuIHRoZSBleHByZXNzaW9uIFwibmFtZVwiIHdpbGwgYWx3YXlzIHJldHVybiBhXG4vLyBzaW5nbGUgZnVuY3Rpb24gd2l0aCB0aGUgYm9keSBgcmV0dXJuIHRoaXMubmFtZWAuXG5mdW5jdGlvbiBnZXRFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpIHtcbiAgaWYgKCFvcHRpb25zKSBvcHRpb25zID0ge307XG4gIGlmICghb3B0aW9ucy5hcmdzKSBvcHRpb25zLmFyZ3MgPSBbXTtcbiAgdmFyIGNhY2hlS2V5ID0gZXhwciArICd8JyArIG9wdGlvbnMuYXJncy5qb2luKCcsJyk7XG4gIC8vIFJldHVybnMgdGhlIGNhY2hlZCBmdW5jdGlvbiBmb3IgdGhpcyBleHByZXNzaW9uIGlmIGl0IGV4aXN0cy5cbiAgdmFyIGZ1bmMgPSBleHByZXNzaW9uLmNhY2hlW2NhY2hlS2V5XTtcbiAgaWYgKGZ1bmMpIHtcbiAgICByZXR1cm4gZnVuYztcbiAgfVxuXG4gIG9wdGlvbnMuYXJncy51bnNoaWZ0KCdfZm9ybWF0dGVyc18nKTtcblxuICAvLyBQcmVmaXggYWxsIHByb3BlcnR5IGxvb2t1cHMgd2l0aCB0aGUgYHRoaXNgIGtleXdvcmQuIElnbm9yZXMga2V5d29yZHNcbiAgLy8gKHdpbmRvdywgdHJ1ZSwgZmFsc2UpIGFuZCBleHRyYSBhcmdzXG4gIHZhciBib2R5ID0gcGFyc2VFeHByZXNzaW9uKGV4cHIsIG9wdGlvbnMpO1xuXG4gIHRyeSB7XG4gICAgZnVuYyA9IGV4cHJlc3Npb24uY2FjaGVbY2FjaGVLZXldID0gRnVuY3Rpb24uYXBwbHkobnVsbCwgb3B0aW9ucy5hcmdzLmNvbmNhdChib2R5KSk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICBpZiAob3B0aW9ucy5pZ25vcmVFcnJvcnMpIHJldHVybjtcbiAgICAvLyBUaHJvd3MgYW4gZXJyb3IgaWYgdGhlIGV4cHJlc3Npb24gd2FzIG5vdCB2YWxpZCBKYXZhU2NyaXB0XG4gICAgY29uc29sZS5lcnJvcignQmFkIGV4cHJlc3Npb246XFxuYCcgKyBleHByICsgJ2BcXG4nICsgJ0NvbXBpbGVkIGV4cHJlc3Npb246XFxuJyArIGJvZHkpO1xuICAgIHRocm93IG5ldyBFcnJvcihlLm1lc3NhZ2UpO1xuICB9XG4gIHJldHVybiBmdW5jO1xufVxuXG5cbi8vIENyZWF0ZXMgYSBzZXR0ZXIgZnVuY3Rpb24gZnJvbSB0aGUgZ2l2ZW4gZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGdldFNldHRlcihleHByLCBvcHRpb25zKSB7XG4gIGlmICghb3B0aW9ucykgb3B0aW9ucyA9IHt9O1xuICBvcHRpb25zLmFyZ3MgPSBbJ3ZhbHVlJ107XG4gIGV4cHIgPSBleHByLnJlcGxhY2UoLyhcXHMqXFx8fCQpLywgJyA9IHZhbHVlJDEnKTtcbiAgcmV0dXJuIGdldEV4cHJlc3Npb24oZXhwciwgb3B0aW9ucyk7XG59XG5cblxuXG4vLyBDb21waWxlcyBhbiBleHByZXNzaW9uIGFuZCBiaW5kcyBpdCBpbiB0aGUgZ2l2ZW4gc2NvcGUuIFRoaXMgYWxsb3dzIGl0IHRvIGJlXG4vLyBjYWxsZWQgZnJvbSBhbnl3aGVyZSAoZS5nLiBldmVudCBsaXN0ZW5lcnMpIHdoaWxlIHJldGFpbmluZyB0aGUgc2NvcGUuXG5mdW5jdGlvbiBiaW5kRXhwcmVzc2lvbihleHByLCBzY29wZSwgb3B0aW9ucykge1xuICByZXR1cm4gZ2V0RXhwcmVzc2lvbihleHByLCBvcHRpb25zKS5iaW5kKHNjb3BlKTtcbn1cblxuLy8gZmluZHMgYWxsIHF1b3RlZCBzdHJpbmdzXG52YXIgcXVvdGVFeHByID0gLyhbJ1wiXFwvXSkoXFxcXFxcMXxbXlxcMV0pKj9cXDEvZztcblxuLy8gZmluZHMgYWxsIGVtcHR5IHF1b3RlZCBzdHJpbmdzXG52YXIgZW1wdHlRdW90ZUV4cHIgPSAvKFsnXCJcXC9dKVxcMS9nO1xuXG4vLyBmaW5kcyBwaXBlcyB0aGF0IGFyZW4ndCBPUnMgKGAgfCBgIG5vdCBgIHx8IGApIGZvciBmb3JtYXR0ZXJzXG52YXIgcGlwZUV4cHIgPSAvXFx8KFxcfCk/L2c7XG5cbi8vIGZpbmRzIHRoZSBwYXJ0cyBvZiBhIGZvcm1hdHRlciAobmFtZSBhbmQgYXJncylcbnZhciBmb3JtYXR0ZXJFeHByID0gL14oW15cXChdKykoPzpcXCgoLiopXFwpKT8kLztcblxuLy8gZmluZHMgYXJndW1lbnQgc2VwYXJhdG9ycyBmb3IgZm9ybWF0dGVycyAoYGFyZzE6YXJnMmApXG52YXIgYXJnU2VwYXJhdG9yID0gL1xccyosXFxzKi9nO1xuXG4vLyBtYXRjaGVzIHByb3BlcnR5IGNoYWlucyAoZS5nLiBgbmFtZWAsIGB1c2VyLm5hbWVgLCBhbmQgYHVzZXIuZnVsbE5hbWUoKS5jYXBpdGFsaXplKClgKVxudmFyIHByb3BFeHByID0gLygoXFx7fCx8XFwuKT9cXHMqKShbYS16JF9cXCRdKD86W2Etel9cXCQwLTlcXC4tXXxcXFtbJ1wiXFxkXStcXF0pKikoXFxzKig6fFxcKHxcXFspPykvZ2k7XG5cbi8vIGxpbmtzIGluIGEgcHJvcGVydHkgY2hhaW5cbnZhciBjaGFpbkxpbmtzID0gL1xcLnxcXFsvZztcblxuLy8gdGhlIHByb3BlcnR5IG5hbWUgcGFydCBvZiBsaW5rc1xudmFyIGNoYWluTGluayA9IC9cXC58XFxbfFxcKC87XG5cbi8vIGRldGVybWluZXMgd2hldGhlciBhbiBleHByZXNzaW9uIGlzIGEgc2V0dGVyIG9yIGdldHRlciAoYG5hbWVgIHZzXG4vLyBgbmFtZSA9ICdib2InYClcbnZhciBzZXR0ZXJFeHByID0gL1xccz1cXHMvO1xuXG52YXIgaWdub3JlID0gbnVsbDtcbnZhciBzdHJpbmdzID0gW107XG52YXIgcmVmZXJlbmNlQ291bnQgPSAwO1xudmFyIGN1cnJlbnRSZWZlcmVuY2UgPSAwO1xudmFyIGN1cnJlbnRJbmRleCA9IDA7XG52YXIgZmluaXNoZWRDaGFpbiA9IGZhbHNlO1xudmFyIGNvbnRpbnVhdGlvbiA9IGZhbHNlO1xuXG4vLyBBZGRzIGB0aGlzLmAgdG8gdGhlIGJlZ2lubmluZyBvZiBlYWNoIHZhbGlkIHByb3BlcnR5IGluIGFuIGV4cHJlc3Npb24sXG4vLyBwcm9jZXNzZXMgZm9ybWF0dGVycywgYW5kIHByb3ZpZGVzIG51bGwtdGVybWluYXRpb24gaW4gcHJvcGVydHkgY2hhaW5zXG5mdW5jdGlvbiBwYXJzZUV4cHJlc3Npb24oZXhwciwgb3B0aW9ucykge1xuICBpbml0UGFyc2UoZXhwciwgb3B0aW9ucyk7XG4gIGV4cHIgPSBwdWxsT3V0U3RyaW5ncyhleHByKTtcbiAgZXhwciA9IHBhcnNlRm9ybWF0dGVycyhleHByKTtcbiAgZXhwciA9IHBhcnNlRXhwcihleHByKTtcbiAgZXhwciA9ICdyZXR1cm4gJyArIGV4cHI7XG4gIGV4cHIgPSBwdXRJblN0cmluZ3MoZXhwcik7XG4gIGV4cHIgPSBhZGRSZWZlcmVuY2VzKGV4cHIpO1xuICByZXR1cm4gZXhwcjtcbn1cblxuXG5mdW5jdGlvbiBpbml0UGFyc2UoZXhwciwgb3B0aW9ucykge1xuICByZWZlcmVuY2VDb3VudCA9IGN1cnJlbnRSZWZlcmVuY2UgPSAwO1xuICAvLyBJZ25vcmVzIGtleXdvcmRzIGFuZCBwcm92aWRlZCBhcmd1bWVudCBuYW1lc1xuICBpZ25vcmUgPSBleHByZXNzaW9uLmdsb2JhbHMuY29uY2F0KG9wdGlvbnMuZ2xvYmFscyB8fCBbXSwgb3B0aW9ucy5hcmdzIHx8IFtdKTtcbiAgc3RyaW5ncy5sZW5ndGggPSAwO1xufVxuXG5cbi8vIEFkZHMgcGxhY2Vob2xkZXJzIGZvciBzdHJpbmdzIHNvIHdlIGNhbiBwcm9jZXNzIHRoZSByZXN0IHdpdGhvdXQgdGhlaXIgY29udGVudFxuLy8gbWVzc2luZyB1cyB1cC5cbmZ1bmN0aW9uIHB1bGxPdXRTdHJpbmdzKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIucmVwbGFjZShxdW90ZUV4cHIsIGZ1bmN0aW9uKHN0ciwgcXVvdGUpIHtcbiAgICBzdHJpbmdzLnB1c2goc3RyKTtcbiAgICByZXR1cm4gcXVvdGUgKyBxdW90ZTsgLy8gcGxhY2Vob2xkZXIgZm9yIHRoZSBzdHJpbmdcbiAgfSk7XG59XG5cblxuLy8gUmVwbGFjZXMgc3RyaW5nIHBsYWNlaG9sZGVycy5cbmZ1bmN0aW9uIHB1dEluU3RyaW5ncyhleHByKSB7XG4gIHJldHVybiBleHByLnJlcGxhY2UoZW1wdHlRdW90ZUV4cHIsIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBzdHJpbmdzLnNoaWZ0KCk7XG4gIH0pO1xufVxuXG5cbi8vIFByZXBlbmRzIHJlZmVyZW5jZSB2YXJpYWJsZSBkZWZpbml0aW9uc1xuZnVuY3Rpb24gYWRkUmVmZXJlbmNlcyhleHByKSB7XG4gIGlmIChyZWZlcmVuY2VDb3VudCkge1xuICAgIHZhciByZWZzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDE7IGkgPD0gcmVmZXJlbmNlQ291bnQ7IGkrKykge1xuICAgICAgcmVmcy5wdXNoKCdfcmVmJyArIGkpO1xuICAgIH1cbiAgICBleHByID0gJ3ZhciAnICsgcmVmcy5qb2luKCcsICcpICsgJztcXG4nICsgZXhwcjtcbiAgfVxuICByZXR1cm4gZXhwcjtcbn1cblxuXG5mdW5jdGlvbiBwYXJzZUZvcm1hdHRlcnMoZXhwcikge1xuICAvLyBSZW1vdmVzIGZvcm1hdHRlcnMgZnJvbSBleHByZXNzaW9uIHN0cmluZ1xuICBleHByID0gZXhwci5yZXBsYWNlKHBpcGVFeHByLCBmdW5jdGlvbihtYXRjaCwgb3JJbmRpY2F0b3IpIHtcbiAgICBpZiAob3JJbmRpY2F0b3IpIHJldHVybiBtYXRjaDtcbiAgICByZXR1cm4gJ0BAQCc7XG4gIH0pO1xuXG4gIGZvcm1hdHRlcnMgPSBleHByLnNwbGl0KC9cXHMqQEBAXFxzKi8pO1xuICBleHByID0gZm9ybWF0dGVycy5zaGlmdCgpO1xuICBpZiAoIWZvcm1hdHRlcnMubGVuZ3RoKSByZXR1cm4gZXhwcjtcblxuICAvLyBQcm9jZXNzZXMgdGhlIGZvcm1hdHRlcnNcbiAgLy8gSWYgdGhlIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgdGhlIHZhbHVlIHdpbGwgYmUgcnVuIHRocm91Z2ggdGhlIGZvcm1hdHRlcnNcbiAgdmFyIHNldHRlciA9ICcnO1xuICB2YWx1ZSA9IGV4cHI7XG5cbiAgaWYgKHNldHRlckV4cHIudGVzdChleHByKSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoc2V0dGVyRXhwcik7XG4gICAgc2V0dGVyID0gcGFydHNbMF0gKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnRzWzFdO1xuICB9XG5cbiAgZm9ybWF0dGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcm1hdHRlcikge1xuICAgIHZhciBtYXRjaCA9IGZvcm1hdHRlci50cmltKCkubWF0Y2goZm9ybWF0dGVyRXhwcik7XG4gICAgaWYgKCFtYXRjaCkgdGhyb3cgbmV3IEVycm9yKCdGb3JtYXR0ZXIgaXMgaW52YWxpZDogJyArIGZvcm1hdHRlcik7XG4gICAgdmFyIGZvcm1hdHRlck5hbWUgPSBtYXRjaFsxXTtcbiAgICB2YXIgYXJncyA9IG1hdGNoWzJdLnNwbGl0KGFyZ1NlcGFyYXRvcik7XG4gICAgYXJncy51bnNoaWZ0KHZhbHVlKTtcbiAgICBpZiAoc2V0dGVyKSBhcmdzLnB1c2godHJ1ZSk7XG4gICAgdmFsdWUgPSAnX2Zvcm1hdHRlcnNfLicgKyBmb3JtYXR0ZXJOYW1lICsgJy5jYWxsKHRoaXMsICcgKyBhcmdzLmpvaW4oJywgJykgKyAnKSc7XG4gIH0pO1xuXG4gIHJldHVybiBzZXR0ZXIgKyB2YWx1ZTtcbn1cblxuXG5mdW5jdGlvbiBwYXJzZUV4cHIoZXhwcikge1xuICBpZiAoc2V0dGVyRXhwci50ZXN0KGV4cHIpKSB7XG4gICAgdmFyIHBhcnRzID0gZXhwci5zcGxpdCgnID0gJyk7XG4gICAgdmFyIHNldHRlciA9IHBhcnRzWzBdO1xuICAgIHZhciB2YWx1ZSA9IHBhcnRzWzFdO1xuICAgIHZhciBuZWdhdGUgPSAnJztcbiAgICBpZiAoc2V0dGVyLmNoYXJBdCgwKSA9PT0gJyEnKSB7XG4gICAgICBuZWdhdGUgPSAnISc7XG4gICAgICBzZXR0ZXIgPSBzZXR0ZXIuc2xpY2UoMSk7XG4gICAgfVxuICAgIHNldHRlciA9IHBhcnNlUHJvcGVydHlDaGFpbnMoc2V0dGVyKS5yZXBsYWNlKC9eXFwofFxcKSQvZywgJycpICsgJyA9ICc7XG4gICAgdmFsdWUgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKHZhbHVlKTtcbiAgICByZXR1cm4gc2V0dGVyICsgbmVnYXRlICsgdmFsdWU7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIHBhcnNlUHJvcGVydHlDaGFpbnMoZXhwcik7XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBwYXJzZVByb3BlcnR5Q2hhaW5zKGV4cHIpIHtcbiAgdmFyIGphdmFzY3JpcHQgPSAnJywganM7XG4gIC8vIGFsbG93IHJlY3Vyc2lvbiBpbnRvIGZ1bmN0aW9uIGFyZ3MgYnkgcmVzZXR0aW5nIHByb3BFeHByXG4gIHZhciBwcmV2aW91c0luZGV4ZXMgPSBbY3VycmVudEluZGV4LCBwcm9wRXhwci5sYXN0SW5kZXhdO1xuICBjdXJyZW50SW5kZXggPSAwO1xuICBwcm9wRXhwci5sYXN0SW5kZXggPSAwO1xuICB3aGlsZSAoKGpzID0gbmV4dENoYWluKGV4cHIpKSAhPT0gZmFsc2UpIHtcbiAgICBqYXZhc2NyaXB0ICs9IGpzO1xuICB9XG4gIGN1cnJlbnRJbmRleCA9IHByZXZpb3VzSW5kZXhlc1swXTtcbiAgcHJvcEV4cHIubGFzdEluZGV4ID0gcHJldmlvdXNJbmRleGVzWzFdO1xuICByZXR1cm4gamF2YXNjcmlwdDtcbn1cblxuXG5mdW5jdGlvbiBuZXh0Q2hhaW4oZXhwcikge1xuICBpZiAoZmluaXNoZWRDaGFpbikge1xuICAgIHJldHVybiAoZmluaXNoZWRDaGFpbiA9IGZhbHNlKTtcbiAgfVxuICB2YXIgbWF0Y2ggPSBwcm9wRXhwci5leGVjKGV4cHIpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgZmluaXNoZWRDaGFpbiA9IHRydWUgLy8gbWFrZSBzdXJlIG5leHQgY2FsbCB3ZSByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gZXhwci5zbGljZShjdXJyZW50SW5kZXgpO1xuICB9XG5cbiAgLy8gYHByZWZpeGAgaXMgYG9iakluZGljYXRvcmAgd2l0aCB0aGUgd2hpdGVzcGFjZSB0aGF0IG1heSBjb21lIGFmdGVyIGl0LlxuICB2YXIgcHJlZml4ID0gbWF0Y2hbMV07XG5cbiAgLy8gYG9iakluZGljYXRvcmAgaXMgYHtgIG9yIGAsYCBhbmQgbGV0J3MgdXMga25vdyB0aGlzIGlzIGFuIG9iamVjdCBwcm9wZXJ0eVxuICAvLyBuYW1lIChlLmcuIHByb3AgaW4gYHtwcm9wOmZhbHNlfWApLlxuICB2YXIgb2JqSW5kaWNhdG9yID0gbWF0Y2hbMl07XG5cbiAgLy8gYHByb3BDaGFpbmAgaXMgdGhlIGNoYWluIG9mIHByb3BlcnRpZXMgbWF0Y2hlZCAoZS5nLiBgdGhpcy51c2VyLmVtYWlsYCkuXG4gIHZhciBwcm9wQ2hhaW4gPSBtYXRjaFszXTtcblxuICAvLyBgcG9zdGZpeGAgaXMgdGhlIGBjb2xvbk9yUGFyZW5gIHdpdGggd2hpdGVzcGFjZSBiZWZvcmUgaXQuXG4gIHZhciBwb3N0Zml4ID0gbWF0Y2hbNF07XG5cbiAgLy8gYGNvbG9uT3JQYXJlbmAgbWF0Y2hlcyB0aGUgY29sb24gKDopIGFmdGVyIHRoZSBwcm9wZXJ0eSAoaWYgaXQgaXMgYW4gb2JqZWN0KVxuICAvLyBvciBwYXJlbnRoZXNpcyBpZiBpdCBpcyBhIGZ1bmN0aW9uLiBXZSB1c2UgYGNvbG9uT3JQYXJlbmAgYW5kIGBvYmpJbmRpY2F0b3JgXG4gIC8vIHRvIGtub3cgaWYgaXQgaXMgYW4gb2JqZWN0LlxuICB2YXIgY29sb25PclBhcmVuID0gbWF0Y2hbNV07XG5cbiAgbWF0Y2ggPSBtYXRjaFswXTtcblxuICB2YXIgc2tpcHBlZCA9IGV4cHIuc2xpY2UoY3VycmVudEluZGV4LCBwcm9wRXhwci5sYXN0SW5kZXggLSBtYXRjaC5sZW5ndGgpO1xuICBjdXJyZW50SW5kZXggPSBwcm9wRXhwci5sYXN0SW5kZXg7XG5cbiAgLy8gc2tpcHMgb2JqZWN0IGtleXMgZS5nLiB0ZXN0IGluIGB7dGVzdDp0cnVlfWAuXG4gIGlmIChvYmpJbmRpY2F0b3IgJiYgY29sb25PclBhcmVuID09PSAnOicpIHtcbiAgICByZXR1cm4gc2tpcHBlZCArIG1hdGNoO1xuICB9XG5cbiAgcmV0dXJuIHNraXBwZWQgKyBwYXJzZUNoYWluKHByZWZpeCwgcHJvcENoYWluLCBwb3N0Zml4LCBjb2xvbk9yUGFyZW4sIGV4cHIpO1xufVxuXG5cbmZ1bmN0aW9uIHNwbGl0TGlua3MoY2hhaW4pIHtcbiAgdmFyIGluZGV4ID0gMDtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBtYXRjaDtcbiAgd2hpbGUgKG1hdGNoID0gY2hhaW5MaW5rcy5leGVjKGNoYWluKSkge1xuICAgIGlmIChjaGFpbkxpbmtzLmxhc3RJbmRleCA9PT0gMSkgY29udGludWU7XG4gICAgcGFydHMucHVzaChjaGFpbi5zbGljZShpbmRleCwgY2hhaW5MaW5rcy5sYXN0SW5kZXggLSAxKSk7XG4gICAgaW5kZXggPSBjaGFpbkxpbmtzLmxhc3RJbmRleCAtIDE7XG4gIH1cbiAgcGFydHMucHVzaChjaGFpbi5zbGljZShpbmRleCkpO1xuICByZXR1cm4gcGFydHM7XG59XG5cblxuZnVuY3Rpb24gYWRkVGhpcyhjaGFpbikge1xuICBpZiAoaWdub3JlLmluZGV4T2YoY2hhaW4uc3BsaXQoY2hhaW5MaW5rKS5zaGlmdCgpKSA9PT0gLTEpIHtcbiAgICByZXR1cm4gJ3RoaXMuJyArIGNoYWluO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBjaGFpbjtcbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIHBhcmVuLCBleHByKSB7XG4gIC8vIGNvbnRpbnVhdGlvbnMgYWZ0ZXIgYSBmdW5jdGlvbiAoZS5nLiBgZ2V0VXNlcigxMikuZmlyc3ROYW1lYCkuXG4gIGNvbnRpbnVhdGlvbiA9IHByZWZpeCA9PT0gJy4nO1xuICBpZiAoY29udGludWF0aW9uKSB7XG4gICAgcHJvcENoYWluID0gJy4nICsgcHJvcENoYWluO1xuICAgIHByZWZpeCA9ICcnO1xuICB9XG5cbiAgdmFyIGxpbmtzID0gc3BsaXRMaW5rcyhwcm9wQ2hhaW4pO1xuICB2YXIgbmV3Q2hhaW4gPSAnJztcblxuICBpZiAobGlua3MubGVuZ3RoID09PSAxICYmICFjb250aW51YXRpb24gJiYgIXBhcmVuKSB7XG4gICAgbGluayA9IGxpbmtzWzBdO1xuICAgIG5ld0NoYWluID0gYWRkVGhpcyhsaW5rKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIWNvbnRpbnVhdGlvbikge1xuICAgICAgbmV3Q2hhaW4gPSAnKCc7XG4gICAgfVxuXG4gICAgbGlua3MuZm9yRWFjaChmdW5jdGlvbihsaW5rLCBpbmRleCkge1xuICAgICAgaWYgKGluZGV4ICE9PSBsaW5rcy5sZW5ndGggLSAxKSB7XG4gICAgICAgIG5ld0NoYWluICs9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIXBhcmVuc1twYXJlbl0pIHtcbiAgICAgICAgICBuZXdDaGFpbiArPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluayArICcpJztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBwb3N0Zml4ID0gcG9zdGZpeC5yZXBsYWNlKHBhcmVuLCAnJyk7XG4gICAgICAgICAgbmV3Q2hhaW4gKz0gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHJldHVybiBwcmVmaXggKyBuZXdDaGFpbiArIHBvc3RmaXg7XG59XG5cblxudmFyIHBhcmVucyA9IHtcbiAgJygnOiAnKScsXG4gICdbJzogJ10nXG59O1xuXG4vLyBIYW5kbGVzIGEgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIGluIGl0cyBjb3JyZWN0IHNjb3BlXG4vLyBGaW5kcyB0aGUgZW5kIG9mIHRoZSBmdW5jdGlvbiBhbmQgcHJvY2Vzc2VzIHRoZSBhcmd1bWVudHNcbmZ1bmN0aW9uIHBhcnNlRnVuY3Rpb24obGluaywgaW5kZXgsIGV4cHIpIHtcbiAgdmFyIGNhbGwgPSBnZXRGdW5jdGlvbkNhbGwoZXhwcik7XG4gIGxpbmsgKz0gY2FsbC5zbGljZSgwLCAxKSArICd+fmluc2lkZVBhcmVuc35+JyArIGNhbGwuc2xpY2UoLTEpO1xuICB2YXIgaW5zaWRlUGFyZW5zID0gY2FsbC5zbGljZSgxLCAtMSk7XG5cbiAgaWYgKGV4cHIuY2hhckF0KHByb3BFeHByLmxhc3RJbmRleCkgPT09ICcuJykge1xuICAgIGxpbmsgPSBwYXJzZVBhcnQobGluaywgaW5kZXgpXG4gIH0gZWxzZSBpZiAoaW5kZXggPT09IDApIHtcbiAgICBsaW5rID0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgICBsaW5rICs9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyAnKSc7XG4gIH0gZWxzZSB7XG4gICAgbGluayA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rICsgJyknO1xuICB9XG5cbiAgdmFyIHJlZiA9IGN1cnJlbnRSZWZlcmVuY2U7XG4gIGxpbmsgPSBsaW5rLnJlcGxhY2UoJ35+aW5zaWRlUGFyZW5zfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZVBhcmVucykpO1xuICBjdXJyZW50UmVmZXJlbmNlID0gcmVmO1xuICByZXR1cm4gbGluaztcbn1cblxuXG4vLyByZXR1cm5zIHRoZSBjYWxsIHBhcnQgb2YgYSBmdW5jdGlvbiAoZS5nLiBgdGVzdCgxMjMpYCB3b3VsZCByZXR1cm4gYCgxMjMpYClcbmZ1bmN0aW9uIGdldEZ1bmN0aW9uQ2FsbChleHByKSB7XG4gIHZhciBzdGFydEluZGV4ID0gcHJvcEV4cHIubGFzdEluZGV4O1xuICB2YXIgb3BlbiA9IGV4cHIuY2hhckF0KHN0YXJ0SW5kZXggLSAxKTtcbiAgdmFyIGNsb3NlID0gcGFyZW5zW29wZW5dO1xuICB2YXIgZW5kSW5kZXggPSBzdGFydEluZGV4IC0gMTtcbiAgdmFyIHBhcmVuQ291bnQgPSAxO1xuICB3aGlsZSAoZW5kSW5kZXgrKyA8IGV4cHIubGVuZ3RoKSB7XG4gICAgdmFyIGNoID0gZXhwci5jaGFyQXQoZW5kSW5kZXgpO1xuICAgIGlmIChjaCA9PT0gb3BlbikgcGFyZW5Db3VudCsrO1xuICAgIGVsc2UgaWYgKGNoID09PSBjbG9zZSkgcGFyZW5Db3VudC0tO1xuICAgIGlmIChwYXJlbkNvdW50ID09PSAwKSBicmVhaztcbiAgfVxuICBjdXJyZW50SW5kZXggPSBwcm9wRXhwci5sYXN0SW5kZXggPSBlbmRJbmRleCArIDE7XG4gIHJldHVybiBvcGVuICsgZXhwci5zbGljZShzdGFydEluZGV4LCBlbmRJbmRleCkgKyBjbG9zZTtcbn1cblxuXG5cbmZ1bmN0aW9uIHBhcnNlUGFydChwYXJ0LCBpbmRleCkge1xuICAvLyBpZiB0aGUgZmlyc3RcbiAgaWYgKGluZGV4ID09PSAwICYmICFjb250aW51YXRpb24pIHtcbiAgICBpZiAoaWdub3JlLmluZGV4T2YocGFydC5zcGxpdCgvXFwufFxcKHxcXFsvKS5zaGlmdCgpKSA9PT0gLTEpIHtcbiAgICAgIHBhcnQgPSAndGhpcy4nICsgcGFydDtcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgcGFydCA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBwYXJ0O1xuICB9XG5cbiAgY3VycmVudFJlZmVyZW5jZSA9ICsrcmVmZXJlbmNlQ291bnQ7XG4gIHZhciByZWYgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlO1xuICByZXR1cm4gJygnICsgcmVmICsgJyA9ICcgKyBwYXJ0ICsgJykgPT0gbnVsbCA/IHVuZGVmaW5lZCA6ICc7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSByZXF1aXJlKCcuL29ic2VydmVyJyk7XG5leHBvcnRzLmV4cHJlc3Npb24gPSByZXF1aXJlKCcuL2V4cHJlc3Npb24nKTtcbmV4cG9ydHMuZXhwcmVzc2lvbi5kaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IE9ic2VydmVyO1xudmFyIGV4cHJlc3Npb24gPSByZXF1aXJlKCcuL2V4cHJlc3Npb24nKTtcbnZhciBkaWZmID0gcmVxdWlyZSgnLi9kaWZmJyk7XG5cbi8vICMgT2JzZXJ2ZXJcblxuLy8gRGVmaW5lcyBhbiBvYnNlcnZlciBjbGFzcyB3aGljaCByZXByZXNlbnRzIGFuIGV4cHJlc3Npb24uIFdoZW5ldmVyIHRoYXQgZXhwcmVzc2lvbiByZXR1cm5zIGEgbmV3IHZhbHVlIHRoZSBgY2FsbGJhY2tgXG4vLyBpcyBjYWxsZWQgd2l0aCB0aGUgdmFsdWUuXG4vL1xuLy8gSWYgdGhlIG9sZCBhbmQgbmV3IHZhbHVlcyB3ZXJlIGVpdGhlciBhbiBhcnJheSBvciBhbiBvYmplY3QsIHRoZSBgY2FsbGJhY2tgIGFsc29cbi8vIHJlY2VpdmVzIGFuIGFycmF5IG9mIHNwbGljZXMgKGZvciBhbiBhcnJheSksIG9yIGFuIGFycmF5IG9mIGNoYW5nZSBvYmplY3RzIChmb3IgYW4gb2JqZWN0KSB3aGljaCBhcmUgdGhlIHNhbWVcbi8vIGZvcm1hdCB0aGF0IGBBcnJheS5vYnNlcnZlYCBhbmQgYE9iamVjdC5vYnNlcnZlYCByZXR1cm4gPGh0dHA6Ly93aWtpLmVjbWFzY3JpcHQub3JnL2Rva3UucGhwP2lkPWhhcm1vbnk6b2JzZXJ2ZT4uXG5mdW5jdGlvbiBPYnNlcnZlcihleHByLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KSB7XG4gIHRoaXMuZ2V0dGVyID0gZXhwcmVzc2lvbi5nZXQoZXhwcik7XG4gIHRoaXMuc2V0dGVyID0gZXhwcmVzc2lvbi5nZXRTZXR0ZXIoZXhwciwgeyBpZ25vcmVFcnJvcnM6IHRydWUgfSk7XG4gIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgdGhpcy5jYWxsYmFja0NvbnRleHQgPSBjYWxsYmFja0NvbnRleHQ7XG4gIHRoaXMuc2tpcCA9IGZhbHNlO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB0aGlzLm9sZFZhbHVlID0gdW5kZWZpbmVkO1xufVxuXG5PYnNlcnZlci5wcm90b3R5cGUgPSB7XG5cbiAgLy8gQmluZHMgdGhpcyBleHByZXNzaW9uIHRvIGEgZ2l2ZW4gY29udGV4dFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0LCBza2lwVXBkYXRlKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5jYWxsYmFjaykge1xuICAgICAgT2JzZXJ2ZXIuYWRkKHRoaXMsIHNraXBVcGRhdGUpO1xuICAgIH1cbiAgfSxcblxuICAvLyBVbmJpbmRzIHRoaXMgZXhwcmVzc2lvblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gICAgT2JzZXJ2ZXIucmVtb3ZlKHRoaXMpO1xuICAgIHRoaXMuc3luYygpO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhpcyBvYnNlcnZlclxuICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldHRlci5jYWxsKHRoaXMuY29udGV4dCwgT2JzZXJ2ZXIuZm9ybWF0dGVycyk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFNldHMgdGhlIHZhbHVlIG9mIHRoaXMgZXhwcmVzc2lvblxuICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCAmJiB0aGlzLnNldHRlcikge1xuICAgICAgcmV0dXJuIHRoaXMuc2V0dGVyLmNhbGwodGhpcy5jb250ZXh0Ll9vcmlnQ29udGV4dF8gfHwgdGhpcy5jb250ZXh0LCBPYnNlcnZlci5mb3JtYXR0ZXJzLCB2YWx1ZSk7XG4gICAgfVxuICB9LFxuXG5cbiAgLy8gSW5zdHJ1Y3RzIHRoaXMgb2JzZXJ2ZXIgdG8gbm90IGNhbGwgaXRzIGBjYWxsYmFja2Agb24gdGhlIG5leHQgc3luYywgd2hldGhlciB0aGUgdmFsdWUgaGFzIGNoYW5nZWQgb3Igbm90XG4gIHNraXBOZXh0U3luYzogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5za2lwID0gdHJ1ZTtcbiAgfSxcblxuXG4gIC8vIFN5bmNzIHRoaXMgb2JzZXJ2ZXIgbm93LCBjYWxsaW5nIHRoZSBjYWxsYmFjayBpbW1lZGlhdGVseSBpZiB0aGVyZSBoYXZlIGJlZW4gY2hhbmdlc1xuICBzeW5jOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgdmFsdWUgPSB0aGlzLmdldCgpO1xuXG4gICAgLy8gRG9uJ3QgY2FsbCB0aGUgY2FsbGJhY2sgaWYgYHNraXBOZXh0U3luY2Agd2FzIGNhbGxlZCBvbiB0aGUgb2JzZXJ2ZXJcbiAgICBpZiAodGhpcy5za2lwIHx8ICF0aGlzLmNhbGxiYWNrKSB7XG4gICAgICB0aGlzLnNraXAgPSBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgYW4gYXJyYXkgaGFzIGNoYW5nZWQgY2FsY3VsYXRlIHRoZSBzcGxpY2VzIGFuZCBjYWxsIHRoZSBjYWxsYmFjay4gVGhpc1xuICAgICAgdmFyIGNoYW5nZWQgPSBkaWZmLnZhbHVlcyh2YWx1ZSwgdGhpcy5vbGRWYWx1ZSk7XG4gICAgICBpZiAoIWNoYW5nZWQpIHJldHVybjtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGNoYW5nZWQpKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUsIGNoYW5nZWQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmNhbGxiYWNrLmNhbGwodGhpcy5jYWxsYmFja0NvbnRleHQsIHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBTdG9yZSBhbiBpbW11dGFibGUgdmVyc2lvbiBvZiB0aGUgdmFsdWUsIGFsbG93aW5nIGZvciBhcnJheXMgYW5kIG9iamVjdHMgdG8gY2hhbmdlIGluc3RhbmNlIGJ1dCBub3QgY29udGVudCBhbmRcbiAgICAvLyBzdGlsbCByZWZyYWluIGZyb20gZGlzcGF0Y2hpbmcgY2FsbGJhY2tzIChlLmcuIHdoZW4gdXNpbmcgYW4gb2JqZWN0IGluIGJpbmQtY2xhc3Mgb3Igd2hlbiB1c2luZyBhcnJheSBmb3JtYXR0ZXJzXG4gICAgLy8gaW4gYmluZC1lYWNoKVxuICAgIHRoaXMub2xkVmFsdWUgPSBkaWZmLmNsb25lKHZhbHVlKTtcbiAgfVxufTtcblxuXG4vLyBBbiBhcnJheSBvZiBhbGwgb2JzZXJ2ZXJzLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIub2JzZXJ2ZXJzID0gW107XG5cbi8vIEFuIGFycmF5IG9mIGNhbGxiYWNrcyB0byBydW4gYWZ0ZXIgdGhlIG5leHQgc3luYywgY29uc2lkZXJlZCAqcHJpdmF0ZSpcbk9ic2VydmVyLmNhbGxiYWNrcyA9IFtdO1xuT2JzZXJ2ZXIubGlzdGVuZXJzID0gW107XG5cbi8vIEFkZHMgYSBuZXcgb2JzZXJ2ZXIgdG8gYmUgc3luY2VkIHdpdGggY2hhbmdlcy4gSWYgYHNraXBVcGRhdGVgIGlzIHRydWUgdGhlbiB0aGUgY2FsbGJhY2sgd2lsbCBvbmx5IGJlIGNhbGxlZCB3aGVuIGFcbi8vIGNoYW5nZSBpcyBtYWRlLCBub3QgaW5pdGlhbGx5LlxuT2JzZXJ2ZXIuYWRkID0gZnVuY3Rpb24ob2JzZXJ2ZXIsIHNraXBVcGRhdGUpIHtcbiAgdGhpcy5vYnNlcnZlcnMucHVzaChvYnNlcnZlcik7XG4gIGlmICghc2tpcFVwZGF0ZSkgb2JzZXJ2ZXIuc3luYygpO1xufTtcblxuLy8gUmVtb3ZlcyBhbiBvYnNlcnZlciwgc3RvcHBpbmcgaXQgZnJvbSBiZWluZyBydW5cbk9ic2VydmVyLnJlbW92ZSA9IGZ1bmN0aW9uKG9ic2VydmVyKSB7XG4gIHZhciBpbmRleCA9IHRoaXMub2JzZXJ2ZXJzLmluZGV4T2Yob2JzZXJ2ZXIpO1xuICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgdGhpcy5vYnNlcnZlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbi8vICpwcml2YXRlKiBwcm9wZXJ0aWVzIHVzZWQgaW4gdGhlIHN5bmMgY3ljbGVcbk9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbk9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG5PYnNlcnZlci5jeWNsZXMgPSAwO1xuT2JzZXJ2ZXIubWF4ID0gMTA7XG5PYnNlcnZlci50aW1lb3V0ID0gbnVsbDtcblxuLy8gUnVucyB0aGUgb2JzZXJ2ZXIgc3luYyBjeWNsZSB3aGljaCBjaGVja3MgYWxsIHRoZSBvYnNlcnZlcnMgdG8gc2VlIGlmIHRoZXkndmUgY2hhbmdlZC5cbk9ic2VydmVyLnN5bmMgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgT2JzZXJ2ZXIuYWZ0ZXJTeW5jKGNhbGxiYWNrKTtcbiAgfVxuXG4gIGlmIChPYnNlcnZlci5zeW5jaW5nKSB7XG4gICAgT2JzZXJ2ZXIucmVydW4gPSB0cnVlO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIE9ic2VydmVyLnN5bmNpbmcgPSB0cnVlO1xuICBPYnNlcnZlci5yZXJ1biA9IHRydWU7XG4gIE9ic2VydmVyLmN5Y2xlcyA9IDA7XG5cbiAgLy8gQWxsb3cgY2FsbGJhY2tzIHRvIHJ1biB0aGUgc3luYyBjeWNsZSBhZ2FpbiBpbW1lZGlhdGVseSwgYnV0IHN0b3AgYXQgYE9ic2VydmVyLm1heGAgKGRlZmF1bHQgMTApIGN5Y2xlcyB0byB3ZSBkb24ndFxuICAvLyBydW4gaW5maW5pdGUgbG9vcHNcbiAgd2hpbGUgKE9ic2VydmVyLnJlcnVuKSB7XG4gICAgaWYgKCsrT2JzZXJ2ZXIuY3ljbGVzID09PSBPYnNlcnZlci5tYXgpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignSW5maW5pdGUgb2JzZXJ2ZXIgc3luY2luZywgYW4gb2JzZXJ2ZXIgaXMgY2FsbGluZyBPYnNlcnZlci5zeW5jKCkgdG9vIG1hbnkgdGltZXMnKTtcbiAgICB9XG4gICAgT2JzZXJ2ZXIucmVydW4gPSBmYWxzZTtcbiAgICAvLyB0aGUgb2JzZXJ2ZXIgYXJyYXkgbWF5IGluY3JlYXNlIG9yIGRlY3JlYXNlIGluIHNpemUgKHJlbWFpbmluZyBvYnNlcnZlcnMpIGR1cmluZyB0aGUgc3luY1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgT2JzZXJ2ZXIub2JzZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBPYnNlcnZlci5vYnNlcnZlcnNbaV0uc3luYygpO1xuICAgIH1cbiAgfVxuXG4gIHdoaWxlIChPYnNlcnZlci5jYWxsYmFja3MubGVuZ3RoKSB7XG4gICAgT2JzZXJ2ZXIuY2FsbGJhY2tzLnNoaWZ0KCkoKTtcbiAgfVxuXG4gIGZvciAodmFyIGkgPSAwLCBsID0gT2JzZXJ2ZXIubGlzdGVuZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIHZhciBsaXN0ZW5lciA9IE9ic2VydmVyLmxpc3RlbmVyc1tpXTtcbiAgICBsaXN0ZW5lcigpO1xuICB9XG5cbiAgT2JzZXJ2ZXIuc3luY2luZyA9IGZhbHNlO1xuICBPYnNlcnZlci5jeWNsZXMgPSAwO1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbk9ic2VydmVyLnN5bmNMYXRlciA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICghT2JzZXJ2ZXIudGltZW91dCkge1xuICAgIE9ic2VydmVyLnRpbWVvdXQgPSBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgT2JzZXJ2ZXIudGltZW91dCA9IG51bGw7XG4gICAgICBPYnNlcnZlci5zeW5jKGNhbGxiYWNrKTtcbiAgICB9KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbi8vIEFmdGVyIHRoZSBuZXh0IHN5bmMgKG9yIHRoZSBjdXJyZW50IGlmIGluIHRoZSBtaWRkbGUgb2Ygb25lKSwgcnVuIHRoZSBwcm92aWRlZCBjYWxsYmFja1xuT2JzZXJ2ZXIuYWZ0ZXJTeW5jID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIE9ic2VydmVyLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbn07XG5cbk9ic2VydmVyLm9uU3luYyA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICBPYnNlcnZlci5saXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG59O1xuXG5PYnNlcnZlci5yZW1vdmVPblN5bmMgPSBmdW5jdGlvbihsaXN0ZW5lcikge1xuICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgdmFyIGluZGV4ID0gT2JzZXJ2ZXIubGlzdGVuZXJzLmluZGV4T2YobGlzdGVuZXIpO1xuICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgT2JzZXJ2ZXIubGlzdGVuZXJzLnNwbGljZShpbmRleCwgMSkucG9wKCk7XG4gIH1cbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdGVyRGVmYXVsdHM7XG5cbi8qKlxuICogIyBEZWZhdWx0IEJpbmRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGJpbmRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqIEZhZGUgaW4gYW5kIG91dFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKCdmYWRlJywge1xuICAgIG9wdGlvbnM6IHtcbiAgICAgIGR1cmF0aW9uOiAzMDAsXG4gICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICB9LFxuICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBvcGFjaXR5OiAnMCcgfSxcbiAgICAgICAgeyBvcGFjaXR5OiAnMScgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGRvbmU7XG4gICAgfSxcbiAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IG9wYWNpdHk6ICcxJyB9LFxuICAgICAgICB7IG9wYWNpdHk6ICcwJyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZG9uZTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIFNsaWRlIGRvd24gYW5kIHVwXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24oJ3NsaWRlJywge1xuICAgIG9wdGlvbnM6IHtcbiAgICAgIGR1cmF0aW9uOiAzMDAsXG4gICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICB9LFxuICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBoZWlnaHQ6ICcwcHgnIH0sXG4gICAgICAgIHsgaGVpZ2h0OiBlbGVtZW50LmdldENvbXB1dGVkQ1NTKCdoZWlnaHQnKSB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgZG9uZSgpO1xuICAgICAgfTtcbiAgICB9LFxuICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgaGVpZ2h0OiBlbGVtZW50LmdldENvbXB1dGVkQ1NTKCdoZWlnaHQnKSB9LFxuICAgICAgICB7IGhlaWdodDogJzBweCcgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgIGRvbmUoKTtcbiAgICAgIH07XG4gICAgfVxuICB9KTtcblxuXG4gIHZhciBhbmltYXRpbmdPdXQgPSBuZXcgTWFwKCk7XG5cbiAgLyoqXG4gICAqIE1vdmUgaXRlbXMgdXAgYW5kIGRvd24gaW4gYSBsaXN0LCBzbGlkZSBkb3duIGFuZCB1cFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKCdzbGlkZS1tb3ZlJywge1xuICAgIG9wdGlvbnM6IHtcbiAgICAgIGR1cmF0aW9uOiAzMDAsXG4gICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICB9LFxuXG4gICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICB2YXIgb2xkRWxlbWVudCwgbW92ZUVsZW1lbnQ7XG4gICAgICB2YXIgaXRlbSA9IGVsZW1lbnQudmlldyAmJiBlbGVtZW50LnZpZXcuX3JlcGVhdEl0ZW1fO1xuICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgb3V0RWxlbWVudCA9IGFuaW1hdGluZ091dC5nZXQoaXRlbSk7XG4gICAgICAgIGlmIChvbGRFbGVtZW50KSB7XG4gICAgICAgICAgLy8gVGhpcyBpdGVtIGlzIGJlaW5nIHJlbW92ZWQgaW4gb25lIHBsYWNlIGFuZCBhZGRlZCBpbnRvIGFub3RoZXIuIE1ha2UgaXQgbG9vayBsaWtlIGl0cyBtb3ZpbmcgYnkgbWFraW5nIGJvdGhcbiAgICAgICAgICAvLyBlbGVtZW50cyBub3QgdmlzaWJsZSBhbmQgaGF2aW5nIGEgY2xvbmUgbW92ZSBhYm92ZSB0aGUgaXRlbXMgdG8gdGhlIG5ldyBsb2NhdGlvbi5cbiAgICAgICAgICB0aGlzLmFuaW1hdGVNb3ZlKG9sZEVsZW1lbnQsIGVsZW1lbnQpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIERvIHRoZSBzbGlkZVxuICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBoZWlnaHQ6ICcwcHgnIH0sXG4gICAgICAgIHsgaGVpZ2h0OiBlbGVtZW50LmdldENvbXB1dGVkQ1NTKCdoZWlnaHQnKSB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgZG9uZSgpO1xuICAgICAgfTtcbiAgICB9LFxuXG4gICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgdmFyIGl0ZW0gPSBlbGVtZW50LnZpZXcgJiYgZWxlbWVudC52aWV3Ll9yZXBlYXRJdGVtXztcbiAgICAgIGlmIChpdGVtKSB7XG4gICAgICAgIGFuaW1hdGluZ091dC5zZXQoaXRlbSwgZWxlbWVudCk7XG4gICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgYW5pbWF0aW5nT3V0LmRlbGV0ZShpdGVtKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIERvIHRoZSBzbGlkZVxuICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBoZWlnaHQ6IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MoJ2hlaWdodCcpIH0sXG4gICAgICAgIHsgaGVpZ2h0OiAnMHB4JyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgZG9uZSgpO1xuICAgICAgfTtcbiAgICB9LFxuXG4gICAgYW5pbWF0ZU1vdmU6IGZ1bmN0aW9uKG9sZEVsZW1lbnQsIG5ld0VsZW1lbnQpIHtcbiAgICAgIHZhciBtb3ZlRWxlbWVudDtcbiAgICAgIHZhciBwYXJlbnQgPSBlbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICBpZiAoIXBhcmVudC5fX3NsaWRlTW92ZUhhbmRsZWQpIHtcbiAgICAgICAgcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCA9IHRydWU7XG4gICAgICAgIGlmICh3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShwYXJlbnQpLnBvc2l0aW9uID09PSAnc3RhdGljJykge1xuICAgICAgICAgIHBhcmVudC5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgb2xkRWxlbWVudC5zdHlsZS52aXNpYmlsaXR5ID0gJ2hpZGRlbic7XG4gICAgICBlbGVtZW50LnN0eWxlLnZpc2liaWxpdHkgPSAnaGlkZGVuJztcbiAgICAgIG1vdmVFbGVtZW50ID0gZnJhZ21lbnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZShvbGRFbGVtZW50LmNsb25lTm9kZSh0cnVlKSk7XG4gICAgICBtb3ZlRWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICBwYXJlbnQuYXBwZW5kQ2hpbGQobW92ZUVsZW1lbnQpO1xuXG4gICAgICBtb3ZlRWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyB0b3A6IG9sZEVsZW1lbnQub2Zmc2V0VG9wICsgJ3B4JyB9LFxuICAgICAgICB7IHRvcDogZWxlbWVudC5vZmZzZXRUb3AgKyAncHgnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgbmV3RWxlbWVudC5zdHlsZS52aXNpYmlsaXR5ID0gJyc7XG4gICAgICB9O1xuICAgIH1cbiAgfSk7XG5cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcbnZhciBkaWZmID0gcmVxdWlyZSgnLi4vb2JzZXJ2ZXIvZGlmZicpO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBQcmludHMgb3V0IHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB0byB0aGUgY29uc29sZS5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnZGVidWcnLCB7XG4gICAgcHJpb3JpdHk6IDIwMCxcbiAgICB1ZHBhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgY29uc29sZS5pbmZvKCdEZWJ1ZzonLCB0aGlzLmV4cHJlc3Npb24sICc9JywgdmFsdWUpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgaHRtbFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGRpc3BsYXkgdW5lc2NhcGVkIEhUTUwgaW5zaWRlIGFuIGVsZW1lbnQuIEJlIHN1cmUgaXQncyB0cnVzdGVkISBUaGlzIHNob3VsZCBiZSB1c2VkIHdpdGggZmlsdGVyc1xuICAgKiB3aGljaCBjcmVhdGUgSFRNTCBmcm9tIHNvbWV0aGluZyBzYWZlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+e3twb3N0LnRpdGxlfX08L2gxPlxuICAgKiA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5MaXR0bGUgUmVkPC9oMT5cbiAgICogPGRpdj5cbiAgICogICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgPHA+XG4gICAqICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgIDwvcD5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdodG1sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBlbGVtZW50LmlubmVySFRNTCA9IHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlO1xuICB9KTtcblxuXG5cbiAgLyoqXG4gICAqICMjIGNsYXNzLVtjbGFzc05hbWVdXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gYWRkIGNsYXNzZXMgdG8gYW4gZWxlbWVudCBkZXBlbmRlbnQgb24gd2hldGhlciB0aGUgZXhwcmVzc2lvbiBpcyB0cnVlIG9yIGZhbHNlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwidXNlci1pdGVtXCIgY2xhc3Mtc2VsZWN0ZWQtdXNlcj1cInt7c2VsZWN0ZWQgPT09IHVzZXJ9fVwiPlxuICAgKiAgIDxidXR0b24gY2xhc3M9XCJidG4gcHJpbWFyeVwiIGNsYXNzLWhpZ2hsaWdodD1cInt7cmVhZHl9fVwiPjwvYnV0dG9uPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYHNlbGVjdGVkYCBlcXVhbHMgdGhlIGB1c2VyYCBhbmQgYHJlYWR5YCBpcyBgdHJ1ZWA6KlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJ1c2VyLWl0ZW0gc2VsZWN0ZWQtdXNlclwiPlxuICAgKiAgIDxidXR0b24gY2xhc3M9XCJidG4gcHJpbWFyeSBoaWdobGlnaHRcIj48L2J1dHRvbj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjbGFzcy0qJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5jbGFzc0xpc3QuYWRkKHRoaXMubWF0Y2gpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm1hdGNoKTtcbiAgICB9XG4gIH0pO1xuXG5cblxuICAvKipcbiAgICogIyMgdmFsdWVcbiAgICogQWRkcyBhIGJpbmRlciB3aGljaCBzZXRzIHRoZSB2YWx1ZSBvZiBhbiBIVE1MIGZvcm0gZWxlbWVudC4gVGhpcyBiaW5kZXIgYWxzbyB1cGRhdGVzIHRoZSBkYXRhIGFzIGl0IGlzIGNoYW5nZWQgaW5cbiAgICogdGhlIGZvcm0gZWxlbWVudCwgcHJvdmlkaW5nIHR3byB3YXkgYmluZGluZy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPkZpcnN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJ1c2VyLmZpcnN0TmFtZVwiPlxuICAgKlxuICAgKiA8bGFiZWw+TGFzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImxhc3ROYW1lXCIgdmFsdWU9XCJ1c2VyLmxhc3ROYW1lXCI+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+Rmlyc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqXG4gICAqIDxsYWJlbD5MYXN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwibGFzdE5hbWVcIiB2YWx1ZT1cIldyaWdodFwiPlxuICAgKiBgYGBcbiAgICogQW5kIHdoZW4gdGhlIHVzZXIgY2hhbmdlcyB0aGUgdGV4dCBpbiB0aGUgZmlyc3QgaW5wdXQgdG8gXCJKYWNcIiwgYHVzZXIuZmlyc3ROYW1lYCB3aWxsIGJlIHVwZGF0ZWQgaW1tZWRpYXRlbHkgd2l0aFxuICAgKiB0aGUgdmFsdWUgb2YgYCdKYWMnYC5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndmFsdWUnLCB7XG4gICAgb25seVdoZW5Cb3VuZDogdHJ1ZSxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBuYW1lID0gdGhpcy5lbGVtZW50LnRhZ05hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgIHZhciB0eXBlID0gdGhpcy5lbGVtZW50LnR5cGU7XG4gICAgICB0aGlzLm1ldGhvZHMgPSBpbnB1dE1ldGhvZHNbdHlwZV0gfHwgaW5wdXRNZXRob2RzW25hbWVdIHx8IGlucHV0TWV0aG9kcy5yYWRpb2dyb3VwO1xuXG4gICAgICBpZiAodGhpcy5lbGVtZW50Lmhhc0F0dHJpYnV0ZSgndmFsdWUtZXZlbnRzJykpIHtcbiAgICAgICAgdGhpcy5ldmVudHMgPSB0aGlzLmVsZW1lbnQuZ2V0QXR0cmlidXRlKCd2YWx1ZS1ldmVudHMnKS5zcGxpdCgnICcpO1xuICAgICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCd2YWx1ZS1ldmVudHMnKTtcbiAgICAgIH0gZWxzZSBpZiAobmFtZSAhPT0gJ29wdGlvbicpIHtcbiAgICAgICAgdGhpcy5ldmVudHMgPSBbJ2NoYW5nZSddO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5lbGVtZW50Lmhhc0F0dHJpYnV0ZSgndmFsdWUtZmllbGQnKSkge1xuICAgICAgICB0aGlzLnZhbHVlRmllbGQgPSB0aGlzLmVsZW1lbnQuZ2V0QXR0cmlidXRlKCd2YWx1ZS1maWVsZCcpO1xuICAgICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCd2YWx1ZS1maWVsZCcpO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZSA9PT0gJ29wdGlvbicpIHtcbiAgICAgICAgdGhpcy52YWx1ZUZpZWxkID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGUudmFsdWVGaWVsZDtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzKSByZXR1cm47IC8vIG5vdGhpbmcgZm9yIDxvcHRpb24+IGhlcmVcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgdmFyIG9ic2VydmVyID0gdGhpcy5vYnNlcnZlcjtcbiAgICAgIHZhciBpbnB1dCA9IHRoaXMubWV0aG9kcztcbiAgICAgIHZhciB2YWx1ZUZpZWxkID0gdGhpcy52YWx1ZUZpZWxkO1xuXG4gICAgICAvLyBUaGUgMi13YXkgYmluZGluZyBwYXJ0IGlzIHNldHRpbmcgdmFsdWVzIG9uIGNlcnRhaW4gZXZlbnRzXG4gICAgICBmdW5jdGlvbiBvbkNoYW5nZSgpIHtcbiAgICAgICAgaWYgKGlucHV0LmdldC5jYWxsKGVsZW1lbnQsIHZhbHVlRmllbGQpICE9PSBvYnNlcnZlci5vbGRWYWx1ZSAmJiAhZWxlbWVudC5yZWFkT25seSkge1xuICAgICAgICAgIG9ic2VydmVyLnNldChpbnB1dC5nZXQuY2FsbChlbGVtZW50LCB2YWx1ZUZpZWxkKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnKSB7XG4gICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgPT09IDEzKSBvbkNoYW5nZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5ldmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudCkge1xuICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIG9uQ2hhbmdlKTtcbiAgICAgIH0pO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHRoaXMubWV0aG9kcy5nZXQuY2FsbCh0aGlzLmVsZW1lbnQsIHRoaXMudmFsdWVGaWVsZCkgIT0gdmFsdWUpIHtcbiAgICAgICAgdGhpcy5tZXRob2RzLnNldC5jYWxsKHRoaXMuZWxlbWVudCwgdmFsdWUsIHRoaXMudmFsdWVGaWVsZCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogSGFuZGxlIHRoZSBkaWZmZXJlbnQgZm9ybSB0eXBlc1xuICAgKi9cbiAgdmFyIGRlZmF1bHRJbnB1dE1ldGhvZCA9IHtcbiAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy52YWx1ZTsgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7IHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlOyB9XG4gIH07XG5cbiAgdmFyIGlucHV0TWV0aG9kcyA9IHtcbiAgICBjaGVja2JveDoge1xuICAgICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuY2hlY2tlZDsgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHsgdGhpcy5jaGVja2VkID0gISF2YWx1ZTsgfVxuICAgIH0sXG5cbiAgICBmaWxlOiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5maWxlcyAmJiB0aGlzLmZpbGVzWzBdOyB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge31cbiAgICB9LFxuXG4gICAgc2VsZWN0OiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlRmllbGQpIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy5vcHRpb25zW3RoaXMuc2VsZWN0ZWRJbmRleF0udmFsdWVPYmplY3Q7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMudmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlLCB2YWx1ZUZpZWxkKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZUZpZWxkKSB7XG4gICAgICAgICAgdGhpcy52YWx1ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZVt2YWx1ZUZpZWxkXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gKHZhbHVlID09IG51bGwpID8gJycgOiB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBvcHRpb246IHtcbiAgICAgIGdldDogZnVuY3Rpb24odmFsdWVGaWVsZCkge1xuICAgICAgICByZXR1cm4gdmFsdWVGaWVsZCA/IHRoaXMudmFsdWVPYmplY3RbdmFsdWVGaWVsZF0gOiB0aGlzLnZhbHVlO1xuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUsIHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHZhbHVlRmllbGQpIHtcbiAgICAgICAgICB0aGlzLnZhbHVlT2JqZWN0ID0gdmFsdWU7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlW3ZhbHVlRmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIGlucHV0OiBkZWZhdWx0SW5wdXRNZXRob2QsXG5cbiAgICB0ZXh0YXJlYTogZGVmYXVsdElucHV0TWV0aG9kLFxuXG4gICAgcmFkaW9ncm91cDogeyAvLyBIYW5kbGVzIGEgZ3JvdXAgb2YgcmFkaW8gaW5wdXRzLCBhc3NpZ25lZCB0byBhbnl0aGluZyB0aGF0IGlzbid0IGEgYSBmb3JtIGlucHV0XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5maW5kKCdpbnB1dFt0eXBlPVwicmFkaW9cIl1bY2hlY2tlZF0nKS52YWx1ZSB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAvLyBpbiBjYXNlIHRoZSB2YWx1ZSBpc24ndCBmb3VuZCBpbiByYWRpb3NcbiAgICAgICAgdmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB0aGlzLnF1ZXJ5U2VsZWN0b3IoJ2lucHV0W3R5cGU9XCJyYWRpb1wiXVtjaGVja2VkXScpLmNoZWNrZWQgPSBmYWxzZTtcbiAgICAgICAgdmFyIHJhZGlvID0gdGhpcy5xdWVyeVNlbGVjdG9yKCdpbnB1dFt0eXBlPVwicmFkaW9cIl1bdmFsdWU9XCInICsgdmFsdWUucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiXScpO1xuICAgICAgICBpZiAocmFkaW8pIHJhZGlvLmNoZWNrZWQgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cbiAgfTtcblxuXG4gIC8qKlxuICAgKiAjIyBvbi1bZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgZm9yIGVhY2ggZXZlbnQgbmFtZSBpbiB0aGUgYXJyYXkuIFdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZCB0aGUgZXhwcmVzc2lvbiB3aWxsIGJlIHJ1bi5cbiAgICpcbiAgICogKipFeGFtcGxlIEV2ZW50czoqKlxuICAgKlxuICAgKiAqIG9uLWNsaWNrXG4gICAqICogb24tZGJsY2xpY2tcbiAgICogKiBvbi1zdWJtaXRcbiAgICogKiBvbi1jaGFuZ2VcbiAgICogKiBvbi1mb2N1c1xuICAgKiAqIG9uLWJsdXJcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0gb24tc3VibWl0PVwie3tzYXZlVXNlcigpfX1cIj5cbiAgICogICA8aW5wdXQgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICogICA8YnV0dG9uPlNhdmU8L2J1dHRvbj5cbiAgICogPC9mb3JtPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCAoZXZlbnRzIGRvbid0IGFmZmVjdCB0aGUgSFRNTCk6KlxuICAgKiBgYGBodG1sXG4gICAqIDxmb3JtPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0qJywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGV2ZW50TmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAvLyBwcmV2ZW50IG5hdGl2ZSBldmVudHMsIGxldCBjdXN0b20gZXZlbnRzIHVzZSB0aGUgXCJkZWZhdWx0Q2FuY2VsZWRcIiBtZWNoYW5pc21cbiAgICAgICAgaWYgKCEoZXZlbnQgaW5zdGFuY2VvZiBDdXN0b21FdmVudCkpIHtcbiAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgICB9XG4gICAgICAgIGlmICghdGhpcy5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJykpIHtcbiAgICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBfdGhpcy5vYnNlcnZlci5nZXQoKTtcblxuICAgICAgICAgIC8vIE9yIGp1c3QgcmV0dXJuIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCBiZSBjYWxsZWQgd2l0aCB0aGUgZXZlbnQgb2JqZWN0XG4gICAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuICAgLyoqXG4gICAqICMjIG5hdGl2ZS1bZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgZm9yIGVhY2ggZXZlbnQgbmFtZSBpbiB0aGUgYXJyYXkuIFdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZCB0aGUgZXhwcmVzc2lvbiB3aWxsIGJlIHJ1bi5cbiAgICogSXQgd2lsbCBub3QgY2FsbCBldmVudC5wcmV2ZW50RGVmYXVsdCgpIGxpa2Ugb24tKiBvciB3aXRoaG9sZCB3aGVuIGRpc2FibGVkLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgRXZlbnRzOioqXG4gICAqXG4gICAqICogbmF0aXZlLWNsaWNrXG4gICAqICogbmF0aXZlLWRibGNsaWNrXG4gICAqICogbmF0aXZlLXN1Ym1pdFxuICAgKiAqIG5hdGl2ZS1jaGFuZ2VcbiAgICogKiBuYXRpdmUtZm9jdXNcbiAgICogKiBuYXRpdmUtYmx1clxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8Zm9ybSBuYXRpdmUtc3VibWl0PVwie3tzYXZlVXNlcihldmVudCl9fVwiPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IChldmVudHMgZG9uJ3QgYWZmZWN0IHRoZSBIVE1MKToqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0+XG4gICAqICAgPGlucHV0IG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqICAgPGJ1dHRvbj5TYXZlPC9idXR0b24+XG4gICAqIDwvZm9ybT5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ25hdGl2ZS0qJywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGV2ZW50TmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgdmFyIGxpc3RlbmVyID0gX3RoaXMub2JzZXJ2ZXIuZ2V0KCk7XG5cbiAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtrZXkgZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgd2hpY2ggaXMgdHJpZ2dlcmVkIHdoZW4gdGhlIGtleWRvd24gZXZlbnQncyBga2V5Q29kZWAgcHJvcGVydHkgbWF0Y2hlcy4gSWYgdGhlIG5hbWUgaW5jbHVkZXMgY3RybFxuICAgKiB0aGVuIGl0IHdpbGwgb25seSBmaXJlIHdoZW4gdGhlIGtleSBwbHVzIHRoZSBjdHJsS2V5IG9yIG1ldGFLZXkgaXMgcHJlc3NlZC5cbiAgICpcbiAgICogKipLZXkgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tZW50ZXJcbiAgICogKiBvbi1jdHJsLWVudGVyXG4gICAqICogb24tZXNjXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dCBvbi1lbnRlcj1cInt7c2F2ZSgpfX1cIiBvbi1lc2M9XCJ7e2NhbmNlbCgpfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIga2V5Q29kZXMgPSB7IGVudGVyOiAxMywgZXNjOiAyNywgJ2N0cmwtZW50ZXInOiAxMyB9O1xuXG4gIE9iamVjdC5rZXlzKGtleUNvZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIga2V5Q29kZSA9IGtleUNvZGVzW25hbWVdO1xuXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0nICsgbmFtZSwge1xuICAgICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciB1c2VDdHJsS2V5ID0gbmFtZS5pbmRleE9mKCdjdHJsLScpID09PSAwO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKHVzZUN0cmxLZXkgJiYgIShldmVudC5jdHJsS2V5IHx8IGV2ZW50Lm1ldGFLZXkpKSByZXR1cm47XG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgIT09IGtleUNvZGUpIHJldHVybjtcbiAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgaWYgKCF0aGlzLmhhc0F0dHJpYnV0ZSgnZGlzYWJsZWQnKSkge1xuICAgICAgICAgICAgLy8gTGV0IGFuIG9uLVtldmVudF0gbWFrZSB0aGUgZnVuY3Rpb24gY2FsbCB3aXRoIGl0cyBvd24gYXJndW1lbnRzXG4gICAgICAgICAgICB2YXIgbGlzdGVuZXIgPSBfdGhpcy5vYnNlcnZlci5nZXQoKTtcblxuICAgICAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIGxpc3RlbmVyLmNhbGwoX3RoaXMuY29udGV4dCwgZXZlbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSlcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgW2F0dHJpYnV0ZV0kXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gc2V0IHRoZSBhdHRyaWJ1dGUgb2YgZWxlbWVudCB0byB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24uIFVzZSB0aGlzIHdoZW4geW91IGRvbid0IHdhbnQgYW5cbiAgICogYDxpbWc+YCB0byB0cnkgYW5kIGxvYWQgaXRzIGBzcmNgIGJlZm9yZSBiZWluZyBldmFsdWF0ZWQuIFRoaXMgaXMgb25seSBuZWVkZWQgb24gdGhlIGluZGV4Lmh0bWwgcGFnZSBhcyB0ZW1wbGF0ZVxuICAgKiB3aWxsIGJlIHByb2Nlc3NlZCBiZWZvcmUgYmVpbmcgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBHZW5lcmFsbHkgeW91IGNhbiBqdXN0IHVzZSBgYXR0cj1cInt7ZXhwcn19XCJgLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgQXR0cmlidXRlczoqKlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aW1nIHNyYyQ9XCJ7e3VzZXIuYXZhdGFyVXJsfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjPVwiaHR0cDovL2Nkbi5leGFtcGxlLmNvbS9hdmF0YXJzL2phY3dyaWdodC1zbWFsbC5wbmdcIj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJyokJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgYXR0ck5hbWUgPSB0aGlzLm1hdGNoO1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKGF0dHJOYW1lLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXT9cbiAgICogQWRkcyBhIGJpbmRlciB0byB0b2dnbGUgYW4gYXR0cmlidXRlIG9uIG9yIG9mZiBpZiB0aGUgZXhwcmVzc2lvbiBpcyB0cnV0aHkgb3IgZmFsc2V5LiBVc2UgZm9yIGF0dHJpYnV0ZXMgd2l0aG91dFxuICAgKiB2YWx1ZXMgc3VjaCBhcyBgc2VsZWN0ZWRgLCBgZGlzYWJsZWRgLCBvciBgcmVhZG9ubHlgLiBgY2hlY2tlZD9gIHdpbGwgdXNlIDItd2F5IGRhdGFiaW5kaW5nLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+SXMgQWRtaW5pc3RyYXRvcjwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjaGVja2VkPz1cInt7dXNlci5pc0FkbWlufX1cIj5cbiAgICogPGJ1dHRvbiBkaXNhYmxlZD89XCJ7e2lzUHJvY2Vzc2luZ319XCI+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGBpc1Byb2Nlc3NpbmdgIGlzIGB0cnVlYCBhbmQgYHVzZXIuaXNBZG1pbmAgaXMgZmFsc2U6KlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPlN1Ym1pdDwvYnV0dG9uPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKj8nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsICcnKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIEFkZCBhIGNsb25lIG9mIHRoZSBgdmFsdWVgIGJpbmRlciBmb3IgYGNoZWNrZWQ/YCBzbyBjaGVja2JveGVzIGNhbiBoYXZlIHR3by13YXkgYmluZGluZyB1c2luZyBgY2hlY2tlZD9gLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjaGVja2VkPycsIGZyYWdtZW50cy5nZXRBdHRyaWJ1dGVCaW5kZXIoJ3ZhbHVlJykpO1xuXG5cblxuICAvKipcbiAgICogIyMgaWYsIHVubGVzcywgZWxzZS1pZiwgZWxzZS11bmxlc3MsIGVsc2VcbiAgICogQWRkcyBhIGJpbmRlciB0byBzaG93IG9yIGhpZGUgdGhlIGVsZW1lbnQgaWYgdGhlIHZhbHVlIGlzIHRydXRoeSBvciBmYWxzZXkuIEFjdHVhbGx5IHJlbW92ZXMgdGhlIGVsZW1lbnQgZnJvbSB0aGVcbiAgICogRE9NIHdoZW4gaGlkZGVuLCByZXBsYWNpbmcgaXQgd2l0aCBhIG5vbi12aXNpYmxlIHBsYWNlaG9sZGVyIGFuZCBub3QgbmVlZGxlc3NseSBleGVjdXRpbmcgYmluZGluZ3MgaW5zaWRlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGkgaWY9XCJ1c2VyXCI+PGEgaHJlZj1cIi9hY2NvdW50XCI+TXkgQWNjb3VudDwvYT48L2xpPlxuICAgKiAgIDxsaSB1bmxlc3M9XCJ1c2VyXCI+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogICA8bGkgZWxzZT48YSBocmVmPVwiL2xvZ291dFwiPlNpZ24gT3V0PC9hPjwvbGk+XG4gICAqIDwvdWw+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGB1c2VyYCBpcyBudWxsOipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGk+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIgSWZCaW5kaW5nID0gZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdpZicsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogNTAsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHZhciBleHByZXNzaW9ucyA9IFsgd3JhcElmRXhwKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy5uYW1lID09PSAndW5sZXNzJykgXTtcbiAgICAgIHZhciBwbGFjZWhvbGRlciA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgIHZhciBub2RlID0gZWxlbWVudC5uZXh0RWxlbWVudFNpYmxpbmc7XG4gICAgICB0aGlzLmVsZW1lbnQgPSBwbGFjZWhvbGRlcjtcbiAgICAgIGVsZW1lbnQucGFyZW50Tm9kZS5yZXBsYWNlQ2hpbGQocGxhY2Vob2xkZXIsIGVsZW1lbnQpO1xuXG4gICAgICAvLyBTdG9yZXMgYSB0ZW1wbGF0ZSBmb3IgYWxsIHRoZSBlbGVtZW50cyB0aGF0IGNhbiBnbyBpbnRvIHRoaXMgc3BvdFxuICAgICAgdGhpcy50ZW1wbGF0ZXMgPSBbIGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZShlbGVtZW50KSBdO1xuXG4gICAgICAvLyBQdWxsIG91dCBhbnkgb3RoZXIgZWxlbWVudHMgdGhhdCBhcmUgY2hhaW5lZCB3aXRoIHRoaXMgb25lXG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICB2YXIgbmV4dCA9IG5vZGUubmV4dEVsZW1lbnRTaWJsaW5nO1xuICAgICAgICB2YXIgZXhwcmVzc2lvbjtcbiAgICAgICAgaWYgKG5vZGUuaGFzQXR0cmlidXRlKCdlbHNlLWlmJykpIHtcbiAgICAgICAgICBleHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIG5vZGUuZ2V0QXR0cmlidXRlKCdlbHNlLWlmJykpO1xuICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2god3JhcElmRXhwKGV4cHJlc3Npb24sIGZhbHNlKSk7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoJ2Vsc2UtaWYnKTtcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmhhc0F0dHJpYnV0ZSgnZWxzZS11bmxlc3MnKSkge1xuICAgICAgICAgIGV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgbm9kZS5nZXRBdHRyaWJ1dGUoJ2Vsc2UtdW5sZXNzJykpO1xuICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2god3JhcElmRXhwKGV4cHJlc3Npb24sIHRydWUpKTtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSgnZWxzZS11bmxlc3MnKTtcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmhhc0F0dHJpYnV0ZSgnZWxzZScpKSB7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoJ2Vsc2UnKTtcbiAgICAgICAgICBuZXh0ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUucmVtb3ZlKCk7XG4gICAgICAgIHRoaXMudGVtcGxhdGVzLnB1c2goZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKG5vZGUpKTtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEFuIGV4cHJlc3Npb24gdGhhdCB3aWxsIHJldHVybiBhbiBpbmRleC4gU29tZXRoaW5nIGxpa2UgdGhpcyBgZXhwciA/IDAgOiBleHByMiA/IDEgOiBleHByMyA/IDIgOiAzYC4gVGhpcyB3aWxsXG4gICAgICAvLyBiZSB1c2VkIHRvIGtub3cgd2hpY2ggc2VjdGlvbiB0byBzaG93IGluIHRoZSBpZi9lbHNlLWlmL2Vsc2UgZ3JvdXBpbmcuXG4gICAgICB0aGlzLmV4cHJlc3Npb24gPSBleHByZXNzaW9ucy5tYXAoZnVuY3Rpb24oZXhwciwgaW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIGV4cHIgKyAnID8gJyArIGluZGV4ICsgJyA6ICc7XG4gICAgICB9KS5qb2luKCcnKSArIGV4cHJlc3Npb25zLmxlbmd0aDtcbiAgICB9LFxuXG4gICAgdXBkYXRlZDogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIC8vIEZvciBwZXJmb3JtYW5jZSBwcm92aWRlIGFuIGFsdGVybmF0ZSBjb2RlIHBhdGggZm9yIGFuaW1hdGlvblxuICAgICAgaWYgKHRoaXMuYW5pbWF0ZSkge1xuICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZChpbmRleCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnVwZGF0ZWRSZWd1bGFyKGluZGV4KTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYWRkOiBmdW5jdGlvbih2aWV3KSB7XG4gICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUodmlldywgdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nKTtcbiAgICB9LFxuXG4gICAgcmVtb3ZlOiBmdW5jdGlvbih2aWV3KSB7XG4gICAgICB2aWV3LmRpc3Bvc2UoKTtcbiAgICB9LFxuXG4gICAgdXBkYXRlZFJlZ3VsYXI6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlKHRoaXMuc2hvd2luZyk7XG4gICAgICAgIHRoaXMuc2hvd2luZyA9IG51bGw7XG4gICAgICB9XG4gICAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLnRlbXBsYXRlc1tpbmRleF07XG4gICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gdGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgICB0aGlzLnNob3dpbmcuYmluZCh0aGlzLmNvbnRleHQpO1xuICAgICAgICB0aGlzLmFkZCh0aGlzLnNob3dpbmcpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVkQW5pbWF0ZWQ6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IGluZGV4O1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh0aGlzLnNob3dpbmcsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgICAgdGhpcy5yZW1vdmUodGhpcy5zaG93aW5nKTtcbiAgICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgICAgIC8vIGZpbmlzaCBieSBhbmltYXRpbmcgdGhlIG5ldyBlbGVtZW50IGluIChpZiBhbnkpXG4gICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLnRlbXBsYXRlc1tpbmRleF07XG4gICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gdGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgICB0aGlzLnNob3dpbmcuYmluZCh0aGlzLmNvbnRleHQpO1xuICAgICAgICB0aGlzLmFkZCh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuYW5pbWF0ZUluKHRoaXMuc2hvd2luZywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgY2hhbmdlZCB3aGlsZSB0aGlzIHdhcyBhbmltYXRpbmcgcnVuIGl0IGFnYWluXG4gICAgICAgICAgaWYgKHRoaXMubGFzdFZhbHVlICE9PSBpbmRleCkge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQ2xlYW4gdXBcbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nLmRpc3Bvc2UoKTtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gbnVsbDtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndW5sZXNzJywgSWZCaW5kaW5nKTtcblxuICBmdW5jdGlvbiB3cmFwSWZFeHAoZXhwciwgaXNVbmxlc3MpIHtcbiAgICByZXR1cm4gKGlzVW5sZXNzID8gJyEnIDogJycpICsgZXhwcjtcbiAgfVxuXG5cbiAgLyoqXG4gICAqICMjIGZvcmVhY2hcbiAgICogQWRkcyBhIGJpbmRlciB0byBkdXBsaWNhdGUgYW4gZWxlbWVudCBmb3IgZWFjaCBpdGVtIGluIGFuIGFycmF5LiBUaGUgZXhwcmVzc2lvbiBtYXkgYmUgb2YgdGhlIGZvcm1hdCBgZXB4cmAgb3JcbiAgICogYGl0ZW1OYW1lIGluIGV4cHJgIHdoZXJlIGBpdGVtTmFtZWAgaXMgdGhlIG5hbWUgZWFjaCBpdGVtIGluc2lkZSB0aGUgYXJyYXkgd2lsbCBiZSByZWZlcmVuY2VkIGJ5IHdpdGhpbiBiaW5kaW5nc1xuICAgKiBpbnNpZGUgdGhlIGVsZW1lbnQuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgZWFjaD1cInt7cG9zdCBpbiBwb3N0c319XCIgY2xhc3MtZmVhdHVyZWQ9XCJ7e3Bvc3QuaXNGZWF0dXJlZH19XCI+XG4gICAqICAgPGgxPnt7cG9zdC50aXRsZX19PC9oMT5cbiAgICogICA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIHRoZXJlIGFyZSAyIHBvc3RzIGFuZCB0aGUgZmlyc3Qgb25lIGlzIGZlYXR1cmVkOipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwiZmVhdHVyZWRcIj5cbiAgICogICA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICAgIDxwPlxuICAgKiAgICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiA8ZGl2PlxuICAgKiAgIDxoMT5CaWcgQmx1ZTwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPlNvbWUgdGhvdWdodHMgb24gdGhlIE5ldyBZb3JrIEdpYW50cy48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9OZXdfWW9ya19HaWFudHNcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgncmVwZWF0Jywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiAxMDAsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGFyZW50ID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICB2YXIgcGxhY2Vob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyLCB0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy50ZW1wbGF0ZSA9IGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZSh0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy5lbGVtZW50ID0gcGxhY2Vob2xkZXI7XG5cbiAgICAgIHZhciBwYXJ0cyA9IHRoaXMuZXhwcmVzc2lvbi5zcGxpdCgvXFxzK2luXFxzKy8pO1xuICAgICAgdGhpcy5leHByZXNzaW9uID0gcGFydHMucG9wKCk7XG4gICAgICB2YXIga2V5ID0gcGFydHMucG9wKCk7XG4gICAgICBpZiAoa2V5KSB7XG4gICAgICAgIHBhcnRzID0ga2V5LnNwbGl0KC9cXHMqLFxccyovKTtcbiAgICAgICAgdGhpcy52YWx1ZU5hbWUgPSBwYXJ0cy5wb3AoKTtcbiAgICAgICAgdGhpcy5rZXlOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy52aWV3cyA9IFtdO1xuICAgICAgdGhpcy5vYnNlcnZlci5nZXRDaGFuZ2VSZWNvcmRzID0gdHJ1ZTtcbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAodGhpcy52aWV3cy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy52aWV3cy5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgICB2aWV3LmRpc3Bvc2UoKTtcbiAgICAgICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IG51bGw7XG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnZpZXdzLmxlbmd0aCA9IDA7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKCFjaGFuZ2VzKSB7XG4gICAgICAgIHRoaXMucG9wdWxhdGUodmFsdWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMuYW5pbWF0ZSkge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHZhbHVlLCBjaGFuZ2VzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNoYW5nZXModmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8vIE1ldGhvZCBmb3IgY3JlYXRpbmcgYW5kIHNldHRpbmcgdXAgbmV3IHZpZXdzIGZvciBvdXIgbGlzdFxuICAgIGNyZWF0ZVZpZXc6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgIHZhciB2aWV3ID0gdGhpcy50ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICB2YXIgY29udGV4dCA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMudmFsdWVOYW1lKSB7XG4gICAgICAgIGNvbnRleHQgPSBPYmplY3QuY3JlYXRlKHRoaXMuY29udGV4dCk7XG4gICAgICAgIGlmICh0aGlzLmtleU5hbWUpIGNvbnRleHRbdGhpcy5rZXlOYW1lXSA9IGtleTtcbiAgICAgICAgY29udGV4dFt0aGlzLnZhbHVlTmFtZV0gPSB2YWx1ZTtcbiAgICAgICAgY29udGV4dC5fb3JpZ0NvbnRleHRfID0gdGhpcy5jb250ZXh0O1xuICAgICAgfVxuICAgICAgdmlldy5iaW5kKGNvbnRleHQpO1xuICAgICAgdmlldy5fcmVwZWF0SXRlbV8gPSB2YWx1ZTtcbiAgICAgIHJldHVybiB2aWV3O1xuICAgIH0sXG5cbiAgICBwb3B1bGF0ZTogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSB2YWx1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy52aWV3cy5sZW5ndGgpIHtcbiAgICAgICAgdGhpcy52aWV3cy5mb3JFYWNoKGZ1bmN0aW9uKG5vZGUpIHtcbiAgICAgICAgICBub2RlLmRpc3Bvc2UoKTtcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMudmlld3MubGVuZ3RoID0gMDtcbiAgICAgIH1cblxuICAgICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpICYmIHZhbHVlLmxlbmd0aCkge1xuICAgICAgICB2YXIgZnJhZyA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcblxuICAgICAgICB2YWx1ZS5mb3JFYWNoKGZ1bmN0aW9uKGl0ZW0sIGluZGV4KSB7XG4gICAgICAgICAgdmFyIHZpZXcgPSB0aGlzLmNyZWF0ZVZpZXcoaW5kZXgsIGl0ZW0pO1xuICAgICAgICAgIHRoaXMudmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnLmFwcGVuZENoaWxkKHZpZXcpO1xuICAgICAgICB9LCB0aGlzKTtcblxuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZywgdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogVGhpcyB1bi1hbmltYXRlZCB2ZXJzaW9uIHJlbW92ZXMgYWxsIHJlbW92ZWQgdmlld3MgZmlyc3Qgc28gdGhleSBjYW4gYmUgcmV0dXJuZWQgdG8gdGhlIHBvb2wgYW5kIHRoZW4gYWRkcyBuZXdcbiAgICAgKiB2aWV3cyBiYWNrIGluLiBUaGlzIGlzIHRoZSBtb3N0IG9wdGltYWwgbWV0aG9kIHdoZW4gbm90IGFuaW1hdGluZy5cbiAgICAgKi9cbiAgICB1cGRhdGVDaGFuZ2VzOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgLy8gUmVtb3ZlIGV2ZXJ5dGhpbmcgZmlyc3QsIHRoZW4gYWRkIGFnYWluLCBhbGxvd2luZyBmb3IgZWxlbWVudCByZXVzZSBmcm9tIHRoZSBwb29sXG4gICAgICB2YXIgcmVtb3ZlZENvdW50ID0gMDtcbiAgICAgIHZhciByZW1vdmVkTWFwID0gbmV3IE1hcCgpO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIGlmICghc3BsaWNlLnJlbW92ZWQubGVuZ3RoKSByZXR1cm47XG4gICAgICAgIHZhciByZW1vdmVkID0gdGhpcy52aWV3cy5zcGxpY2Uoc3BsaWNlLmluZGV4IC0gcmVtb3ZlZENvdW50LCBzcGxpY2UucmVtb3ZlZC5sZW5ndGgpO1xuICAgICAgICAvLyBTYXZlIGZvciByZXVzZSBpZiBpdGVtcyBtb3ZlZCAoZS5nLiBvbiBhIHNvcnQgdXBkYXRlKSBpbnN0ZWFkIG9mIGp1c3QgZ2V0dGluZyByZW1vdmVkXG4gICAgICAgIHJlbW92ZWQuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgICAgcmVtb3ZlZE1hcC5zZXQodmlldy5fcmVwZWF0SXRlbV8sIHZpZXcpO1xuICAgICAgICAgIHZpZXcucmVtb3ZlKCk7XG4gICAgICAgIH0pO1xuICAgICAgICByZW1vdmVkQ291bnQgKz0gcmVtb3ZlZC5sZW5ndGg7XG4gICAgICB9LCB0aGlzKTtcblxuICAgICAgLy8gQWRkIHRoZSBuZXcvbW92ZWQgdmlld3NcbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UuYWRkZWRDb3VudCkgcmV0dXJuO1xuICAgICAgICB2YXIgYWRkZWRWaWV3cyA9IFtdO1xuICAgICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICAgIHZhciBpbmRleCA9IHNwbGljZS5pbmRleDtcbiAgICAgICAgdmFyIGVuZEluZGV4ID0gaW5kZXggKyBzcGxpY2UuYWRkZWRDb3VudDtcblxuICAgICAgICBmb3IgKHZhciBpID0gaW5kZXg7IGkgPCBlbmRJbmRleDsgaSsrKSB7XG4gICAgICAgICAgdmFyIGl0ZW0gPSB2YWx1ZVtpXTtcblxuICAgICAgICAgIHZhciB2aWV3ID0gcmVtb3ZlZE1hcC5nZXQoaXRlbSk7XG4gICAgICAgICAgaWYgKHZpZXcpIHtcbiAgICAgICAgICAgIC8vIElmIHRoZSBub2RlIHdhcyBqdXN0IHJlbW92ZWQsIHJldXNlIGl0XG4gICAgICAgICAgICByZW1vdmVkTWFwLmRlbGV0ZShpdGVtKTtcbiAgICAgICAgICAgIGlmICh0aGlzLmtleU5hbWUpIHtcbiAgICAgICAgICAgICAgdmlldy5jb250ZXh0W3RoaXMua2V5TmFtZV0gPSBpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBPdGhlcndpc2UgY3JlYXRlIGEgbmV3IG9uZVxuICAgICAgICAgICAgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpLCBpdGVtKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgYWRkZWRWaWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHZpZXcpO1xuICAgICAgICB9XG4gICAgICAgIHRoaXMudmlld3Muc3BsaWNlLmFwcGx5KHRoaXMudmlld3MsIFsgaW5kZXgsIDAgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICBuZXh0U2libGluZy5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIC8vIENsZWFudXAgYW55IHZpZXdzIHRoYXQgd2VyZSByZW1vdmVkIGFuZCBub3QgcmUtYWRkZWQgKG1vdmVkKVxuICAgICAgcmVtb3ZlZE1hcC5mb3JFYWNoKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHZhbHVlLl9yZXBlYXRJdGVtXyA9IG51bGw7XG4gICAgICAgIHZhbHVlLmRpc3Bvc2UoKTtcbiAgICAgIH0pO1xuICAgICAgcmVtb3ZlZE1hcC5jbGVhcigpO1xuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBUaGlzIGFuaW1hdGVkIHZlcnNpb24gbXVzdCBhbmltYXRlIHJlbW92ZWQgbm9kZXMgb3V0IHdoaWxlIGFkZGVkIG5vZGVzIGFyZSBhbmltYXRpbmcgaW4gbWFraW5nIGl0IGxlc3Mgb3B0aW1hbFxuICAgICAqIChidXQgY29vbCBsb29raW5nKS4gSXQgYWxzbyBoYW5kbGVzIFwibW92ZVwiIGFuaW1hdGlvbnMgZm9yIG5vZGVzIHdoaWNoIGFyZSBtb3ZpbmcgcGxhY2Ugd2l0aGluIHRoZSBsaXN0LlxuICAgICAqL1xuICAgIHVwZGF0ZUNoYW5nZXNBbmltYXRlZDogZnVuY3Rpb24odmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSB2YWx1ZTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdmFyIGFuaW1hdGluZ1ZhbHVlID0gdmFsdWUuc2xpY2UoKTtcbiAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcblxuICAgICAgLy8gUnVuIHVwZGF0ZXMgd2hpY2ggb2NjdXJlZCB3aGlsZSB0aGlzIHdhcyBhbmltYXRpbmcuXG4gICAgICBmdW5jdGlvbiB3aGVuRG9uZSgpIHtcbiAgICAgICAgLy8gVGhlIGxhc3QgYW5pbWF0aW9uIGZpbmlzaGVkIHdpbGwgcnVuIHRoaXNcbiAgICAgICAgaWYgKC0td2hlbkRvbmUuY291bnQgPT09IDApIHJldHVybjtcblxuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nKSB7XG4gICAgICAgICAgdmFyIGNoYW5nZXMgPSBkaWZmLmFycmF5KHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgYW5pbWF0aW5nVmFsdWUpO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgY2hhbmdlcyk7XG4gICAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgd2hlbkRvbmUuY291bnQgPSAwO1xuXG5cbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgdmFyIGFkZGVkVmlld3MgPSBbXTtcbiAgICAgICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgICB2YXIgaW5kZXggPSBzcGxpY2UuaW5kZXg7XG4gICAgICAgIHZhciBlbmRJbmRleCA9IGluZGV4ICsgc3BsaWNlLmFkZGVkQ291bnQ7XG4gICAgICAgIHZhciByZW1vdmVkQ291bnQgPSBzcGxpY2UucmVtb3ZlZC5sZW5ndGg7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IGluZGV4OyBpIDwgZW5kSW5kZXg7IGkrKykge1xuICAgICAgICAgIHZhciBpdGVtID0gdmFsdWVbaV07XG4gICAgICAgICAgdmFyIHZpZXcgPSB0aGlzLmNyZWF0ZVZpZXcoaSwgaXRlbSk7XG4gICAgICAgICAgYWRkZWRWaWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJlbW92ZWRWaWV3cyA9IHRoaXMudmlld3Muc3BsaWNlLmFwcGx5KHRoaXMudmlld3MsIFsgaW5kZXgsIHJlbW92ZWRDb3VudCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuXG4gICAgICAgIHJlbW92ZWRWaWV3cy5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgICB3aGVuRG9uZS5jb3VudCsrO1xuICAgICAgICAgIHRoaXMuYW5pbWF0ZU91dCh2aWV3LCB3aGVuRG9uZSk7XG4gICAgICAgIH0sIHRoaXMpO1xuXG4gICAgICAgIGFkZGVkVmlld3MuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgICB0aGlzLmFuaW1hdGVJbih2aWV3LCB3aGVuRG9uZSk7XG4gICAgICAgIH0sIHRoaXMpO1xuICAgICAgfSk7XG4gICAgfVxuICB9KTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcblxuXG4vKipcbiAqICMgRGVmYXVsdCBGb3JtYXR0ZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBmb3JtYXR0ZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCd0b2tlbkxpc3QnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogdiBUT0RPIHZcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc3R5bGVzJywgZnVuY3Rpb24odmFsdWUpIHtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLmpvaW4oJyAnKTtcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgdmFyIGNsYXNzZXMgPSBbXTtcbiAgICAgIE9iamVjdC5rZXlzKHZhbHVlKS5mb3JFYWNoKGZ1bmN0aW9uKGNsYXNzTmFtZSkge1xuICAgICAgICBpZiAodmFsdWVbY2xhc3NOYW1lXSkge1xuICAgICAgICAgIGNsYXNzZXMucHVzaChjbGFzc05hbWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBjbGFzc2VzLmpvaW4oJyAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUgfHwgJyc7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGZpbHRlclxuICAgKiBGaWx0ZXJzIGFuIGFycmF5IGJ5IHRoZSBnaXZlbiBmaWx0ZXIgZnVuY3Rpb24ocyksIG1heSBwcm92aWRlIGEgZnVuY3Rpb24sIGFuXG4gICAqIGFycmF5LCBvciBhbiBvYmplY3Qgd2l0aCBmaWx0ZXJpbmcgZnVuY3Rpb25zXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2ZpbHRlcicsIGZ1bmN0aW9uKHZhbHVlLCBmaWx0ZXJGdW5jKSB7XG4gICAgaWYgKCFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH0gZWxzZSBpZiAoIWZpbHRlckZ1bmMpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHZhbHVlID0gdmFsdWUuZmlsdGVyKGZpbHRlckZ1bmMsIHRoaXMpO1xuICAgIH0gZWxzZSBpZiAoQXJyYXkuaXNBcnJheShmaWx0ZXJGdW5jKSkge1xuICAgICAgZmlsdGVyRnVuYy5mb3JFYWNoKGZ1bmN0aW9uKGZ1bmMpIHtcbiAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICB9KTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiBmaWx0ZXJGdW5jID09PSAnb2JqZWN0Jykge1xuICAgICAgT2JqZWN0LmtleXMoZmlsdGVyRnVuYykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgICAgdmFyIGZ1bmMgPSBmaWx0ZXJGdW5jW2tleV07XG4gICAgICAgIGlmICh0eXBlb2YgZnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgIHZhbHVlID0gdmFsdWUuZmlsdGVyKGZ1bmMsIHRoaXMpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBtYXBcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBtYXAgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIG1hcHBpbmcgZnVuY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbWFwJywgZnVuY3Rpb24odmFsdWUsIG1hcEZ1bmMpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCB8fCB0eXBlb2YgbWFwRnVuYyAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5tYXAobWFwRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBtYXBGdW5jLmNhbGwodGhpcywgdmFsdWUpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgcmVkdWNlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gcmVkdWNlIGFuIGFycmF5IG9yIHZhbHVlIGJ5IHRoZSBnaXZlbiByZWR1Y2UgZnVuY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcigncmVkdWNlJywgZnVuY3Rpb24odmFsdWUsIHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSkge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDMpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnJlZHVjZShyZWR1Y2VGdW5jLCBpbml0aWFsVmFsdWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnJlZHVjZShyZWR1Y2VGdW5jKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDMpIHtcbiAgICAgIHJldHVybiByZWR1Y2VGdW5jKGluaXRpYWxWYWx1ZSwgdmFsdWUpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgcmVkdWNlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gcmVkdWNlIGFuIGFycmF5IG9yIHZhbHVlIGJ5IHRoZSBnaXZlbiByZWR1Y2UgZnVuY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc2xpY2UnLCBmdW5jdGlvbih2YWx1ZSwgaW5kZXgsIGVuZEluZGV4KSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuc2xpY2UoaW5kZXgsIGVuZEluZGV4KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZGF0ZVxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGZvcm1hdCBkYXRlcyBhbmQgc3RyaW5nc1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdkYXRlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgaWYgKCEodmFsdWUgaW5zdGFuY2VvZiBEYXRlKSkge1xuICAgICAgdmFsdWUgPSBuZXcgRGF0ZSh2YWx1ZSk7XG4gICAgfVxuXG4gICAgaWYgKGlzTmFOKHZhbHVlLmdldFRpbWUoKSkpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUudG9Mb2NhbGVTdHJpbmcoKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgbG9nXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gbG9nIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiwgdXNlZnVsIGZvciBkZWJ1Z2dpbmdcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbG9nJywgZnVuY3Rpb24odmFsdWUsIHByZWZpeCkge1xuICAgIGlmIChwcmVmaXggPT0gbnVsbCkgcHJlZml4ID0gJ0xvZzonO1xuICAgIGNvbnNvbGUubG9nKHByZWZpeCwgdmFsdWUpO1xuICAgIHJldHVybiB2YWx1ZTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgbGltaXRcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsaW1pdCB0aGUgbGVuZ3RoIG9mIGFuIGFycmF5IG9yIHN0cmluZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsaW1pdCcsIGZ1bmN0aW9uKHZhbHVlLCBsaW1pdCkge1xuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUuc2xpY2UgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChsaW1pdCA8IDApIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnNsaWNlKGxpbWl0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhbHVlLnNsaWNlKDAsIGxpbWl0KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgc29ydFxuICAgKiBTb3J0cyBhbiBhcnJheSBnaXZlbiBhIGZpZWxkIG5hbWUgb3Igc29ydCBmdW5jdGlvbiwgYW5kIGEgZGlyZWN0aW9uXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3NvcnQnLCBmdW5jdGlvbih2YWx1ZSwgc29ydEZ1bmMsIGRpcikge1xuICAgIGlmICghc29ydEZ1bmMgfHwgIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGRpciA9IChkaXIgPT09ICdkZXNjJykgPyAtMSA6IDE7XG4gICAgaWYgKHR5cGVvZiBzb3J0RnVuYyA9PT0gJ3N0cmluZycpIHtcbiAgICAgIHZhciBwYXJ0cyA9IHNvcnRGdW5jLnNwbGl0KCc6Jyk7XG4gICAgICB2YXIgcHJvcCA9IHBhcnRzWzBdO1xuICAgICAgdmFyIGRpcjIgPSBwYXJ0c1sxXTtcbiAgICAgIGRpcjIgPSAoZGlyMiA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICAgIGRpciA9IGRpciB8fCBkaXIyO1xuICAgICAgdmFyIHNvcnRGdW5jID0gZnVuY3Rpb24oYSwgYikge1xuICAgICAgICBpZiAoYVtwcm9wXSA+IGJbcHJvcF0pIHJldHVybiBkaXI7XG4gICAgICAgIGlmIChhW3Byb3BdIDwgYltwcm9wXSkgcmV0dXJuIC1kaXI7XG4gICAgICAgIHJldHVybiAwO1xuICAgICAgfTtcbiAgICB9IGVsc2UgaWYgKGRpciA9PT0gLTEpIHtcbiAgICAgIHZhciBvcmlnRnVuYyA9IHNvcnRGdW5jO1xuICAgICAgc29ydEZ1bmMgPSBmdW5jdGlvbihhLCBiKSB7IHJldHVybiAtb3JpZ0Z1bmMoYSwgYik7IH07XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlLnNsaWNlKCkuc29ydChzb3J0RnVuYyk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGFkZFF1ZXJ5XG4gICAqIFRha2VzIHRoZSBpbnB1dCBVUkwgYW5kIGFkZHMgKG9yIHJlcGxhY2VzKSB0aGUgZmllbGQgaW4gdGhlIHF1ZXJ5XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2FkZFF1ZXJ5JywgZnVuY3Rpb24odmFsdWUsIHF1ZXJ5RmllbGQsIHF1ZXJ5VmFsdWUpIHtcbiAgICB2YXIgdXJsID0gdmFsdWUgfHwgbG9jYXRpb24uaHJlZjtcbiAgICB2YXIgcGFydHMgPSB1cmwuc3BsaXQoJz8nKTtcbiAgICB1cmwgPSBwYXJ0c1swXTtcbiAgICB2YXIgcXVlcnkgPSBwYXJ0c1sxXTtcbiAgICB2YXIgYWRkZWRRdWVyeSA9ICcnO1xuICAgIGlmIChxdWVyeVZhbHVlICE9IG51bGwpIHtcbiAgICAgIGFkZGVkUXVlcnkgPSBxdWVyeUZpZWxkICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5VmFsdWUpO1xuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgdmFyIGV4cHIgPSBuZXcgUmVnRXhwKCdcXFxcYicgKyBxdWVyeUZpZWxkICsgJz1bXiZdKicpO1xuICAgICAgaWYgKGV4cHIudGVzdChxdWVyeSkpIHtcbiAgICAgICAgcXVlcnkgPSBxdWVyeS5yZXBsYWNlKGV4cHIsIGFkZGVkUXVlcnkpO1xuICAgICAgfSBlbHNlIGlmIChhZGRlZFF1ZXJ5KSB7XG4gICAgICAgIHF1ZXJ5ICs9ICcmJyArIGFkZGVkUXVlcnk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5ID0gYWRkZWRRdWVyeTtcbiAgICB9XG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB1cmwgKz0gJz8nICsgcXVlcnk7XG4gICAgfVxuICAgIHJldHVybiB1cmw7XG4gIH0pO1xuXG5cbiAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIGZ1bmN0aW9uIGVzY2FwZUhUTUwodmFsdWUpIHtcbiAgICBkaXYudGV4dENvbnRlbnQgPSB2YWx1ZSB8fCAnJztcbiAgICByZXR1cm4gZGl2LmlubmVySFRNTDtcbiAgfVxuXG5cbiAgLyoqXG4gICAqICMjIGVzY2FwZVxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudC4gRm9yIHVzZSB3aXRoIG90aGVyIEhUTUwtYWRkaW5nIGZvcm1hdHRlcnMgc3VjaCBhcyBhdXRvbGluay5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBlc2NhcGUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZXNjYXBlJywgZXNjYXBlSFRNTCk7XG5cblxuICAvKipcbiAgICogIyMgcFxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudCB3cmFwcGluZyBwYXJhZ3JhcGhzIGluIDxwPiB0YWdzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IHAgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+PHA+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvcD5cbiAgICogPHA+SXQncyBncmVhdDwvcD48L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3AnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBsaW5lcyA9ICh2YWx1ZSB8fCAnJykuc3BsaXQoL1xccj9cXG4vKTtcbiAgICB2YXIgZXNjYXBlZCA9IGxpbmVzLm1hcChmdW5jdGlvbihsaW5lKSB7IHJldHVybiBlc2NhcGVIVE1MKGxpbmUpIHx8ICc8YnI+JzsgfSk7XG4gICAgcmV0dXJuICc8cD4nICsgZXNjYXBlZC5qb2luKCc8L3A+PHA+JykgKyAnPC9wPic7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGJyXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IGFkZGluZyA8YnI+IHRhZ3MgaW4gcGxhY2Ugb2YgbmV3bGluZXMgY2hhcmFjdGVycy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBiciB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdicicsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGxpbmVzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgIHJldHVybiBsaW5lcy5tYXAoZXNjYXBlSFRNTCkuam9pbignPGJyPicpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBuZXdsaW5lXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IGFkZGluZyA8cD4gdGFncyBhdCBkb3VibGUgbmV3bGluZXMgYW5kIDxicj4gdGFncyBpbiBwbGFjZSBvZiBzaW5nbGUgbmV3bGluZSBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IG5ld2xpbmUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+PHA+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITxicj5cbiAgICogSXQncyBncmVhdDwvcD48L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ25ld2xpbmUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBwYXJhZ3JhcGhzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcblxccypcXHI/XFxuLyk7XG4gICAgdmFyIGVzY2FwZWQgPSBwYXJhZ3JhcGhzLm1hcChmdW5jdGlvbihwYXJhZ3JhcGgpIHtcbiAgICAgIHZhciBsaW5lcyA9IHBhcmFncmFwaC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+Jyk7XG4gICAgfSk7XG4gICAgcmV0dXJuICc8cD4nICsgZXNjYXBlZC5qb2luKCc8L3A+PHA+JykgKyAnPC9wPic7XG4gIH0pO1xuXG5cblxuICB2YXIgdXJsRXhwID0gLyhefFxcc3xcXCgpKCg/Omh0dHBzP3xmdHApOlxcL1xcL1tcXC1BLVowLTkrXFx1MDAyNkAjXFwvJT89KCl+X3whOiwuO10qW1xcLUEtWjAtOStcXHUwMDI2QCNcXC8lPX4oX3xdKS9naTtcbiAgLyoqXG4gICAqICMjIGF1dG9saW5rXG4gICAqIEFkZHMgYXV0b21hdGljIGxpbmtzIHRvIGVzY2FwZWQgY29udGVudCAoYmUgc3VyZSB0byBlc2NhcGUgdXNlciBjb250ZW50KS4gQ2FuIGJlIHVzZWQgb24gZXhpc3RpbmcgSFRNTCBjb250ZW50IGFzIGl0XG4gICAqIHdpbGwgc2tpcCBVUkxzIHdpdGhpbiBIVE1MIHRhZ3MuIFBhc3NpbmcgdHJ1ZSBpbiB0aGUgc2Vjb25kIHBhcmFtZXRlciB3aWxsIHNldCB0aGUgdGFyZ2V0IHRvIGBfYmxhbmtgLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGVzY2FwZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdhdXRvbGluaycsIGZ1bmN0aW9uKHZhbHVlLCB0YXJnZXQpIHtcbiAgICB0YXJnZXQgPSAodGFyZ2V0KSA/ICcgdGFyZ2V0PVwiX2JsYW5rXCInIDogJyc7XG5cbiAgICByZXR1cm4gKCcnICsgdmFsdWUpLnJlcGxhY2UoLzxbXj5dKz58W148XSsvZywgZnVuY3Rpb24obWF0Y2gpIHtcbiAgICAgIGlmIChtYXRjaC5jaGFyQXQoMCkgPT09ICc8Jykge1xuICAgICAgICByZXR1cm4gbWF0Y2g7XG4gICAgICB9XG4gICAgICByZXR1cm4gbWF0Y2gucmVwbGFjZSh1cmxFeHAsICckMTxhIGhyZWY9XCIkMlwiJyArIHRhcmdldCArICc+JDI8L2E+Jyk7XG4gICAgfSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2ludCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFsdWUgPSBwYXJzZUludCh2YWx1ZSk7XG4gICAgcmV0dXJuIGlzTmFOKHZhbHVlKSA/IG51bGwgOiB2YWx1ZTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmxvYXQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhbHVlID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgcmV0dXJuIGlzTmFOKHZhbHVlKSA/IG51bGwgOiB2YWx1ZTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYm9vbCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlICYmIHZhbHVlICE9PSAnMCcgJiYgdmFsdWUgIT09ICdmYWxzZSc7XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBUZW1wbGF0ZTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xuXG5cbi8qKlxuICogIyMgVGVtcGxhdGVcbiAqIFRha2VzIGFuIEhUTUwgc3RyaW5nLCBhbiBlbGVtZW50LCBhbiBhcnJheSBvZiBlbGVtZW50cywgb3IgYSBkb2N1bWVudCBmcmFnbWVudCwgYW5kIGNvbXBpbGVzIGl0IGludG8gYSB0ZW1wbGF0ZS5cbiAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gKiBAcGFyYW0ge1N0cmluZ3xOb2RlTGlzdHxIVE1MQ29sbGVjdGlvbnxIVE1MVGVtcGxhdGVFbGVtZW50fEhUTUxTY3JpcHRFbGVtZW50fE5vZGV9IGh0bWwgQSBUZW1wbGF0ZSBjYW4gYmUgY3JlYXRlZFxuICogZnJvbSBtYW55IGRpZmZlcmVudCB0eXBlcyBvZiBvYmplY3RzLiBBbnkgb2YgdGhlc2Ugd2lsbCBiZSBjb252ZXJ0ZWQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50IGZvciB0aGUgdGVtcGxhdGUgdG9cbiAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gKi9cbmZ1bmN0aW9uIFRlbXBsYXRlKCkge1xuICB0aGlzLnBvb2wgPSBbXTtcbn1cblxuXG5UZW1wbGF0ZS5wcm90b3R5cGUgPSB7XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgdmlldyBjbG9uZWQgZnJvbSB0aGlzIHRlbXBsYXRlLlxuICAgKi9cbiAgY3JlYXRlVmlldzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMucG9vbC5sZW5ndGgpIHtcbiAgICAgIHJldHVybiB0aGlzLnBvb2wucG9wKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV4dGVuZC5tYWtlKFZpZXcsIGRvY3VtZW50LmltcG9ydE5vZGUodGhpcywgdHJ1ZSksIHRoaXMpO1xuICB9XG59O1xuIiwiLy8gSGVscGVyIG1ldGhvZHMgZm9yIGFuaW1hdGlvblxuZXhwb3J0cy5tYWtlRWxlbWVudEFuaW1hdGFibGUgPSBtYWtlRWxlbWVudEFuaW1hdGFibGU7XG5leHBvcnRzLmdldENvbXB1dGVkQ1NTID0gZ2V0Q29tcHV0ZWRDU1M7XG5leHBvcnRzLmFuaW1hdGVFbGVtZW50ID0gYW5pbWF0ZUVsZW1lbnQ7XG5cbmZ1bmN0aW9uIG1ha2VFbGVtZW50QW5pbWF0YWJsZShlbGVtZW50KSB7XG4gIC8vIEFkZCBwb2x5ZmlsbCBqdXN0IG9uIHRoaXMgZWxlbWVudFxuICBpZiAoIWVsZW1lbnQuYW5pbWF0ZSkge1xuICAgIGVsZW1lbnQuYW5pbWF0ZSA9IGFuaW1hdGVFbGVtZW50O1xuICB9XG5cbiAgLy8gTm90IGEgcG9seWZpbGwgYnV0IGEgaGVscGVyXG4gIGlmICghZWxlbWVudC5nZXRDb21wdXRlZENTUykge1xuICAgIGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MgPSBnZXRDb21wdXRlZENTUztcbiAgfVxufVxuXG4vKipcbiAqIEdldCB0aGUgY29tcHV0ZWQgc3R5bGUgb24gYW4gZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0Q29tcHV0ZWRDU1Moc3R5bGVOYW1lKSB7XG4gIGlmICh0aGlzLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcub3BlbmVyKSB7XG4gICAgcmV0dXJuIHRoaXMub3duZXJEb2N1bWVudC5kZWZhdWx0Vmlldy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpW3N0eWxlTmFtZV07XG4gIH1cbiAgcmV0dXJuIHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpW3N0eWxlTmFtZV07XG59XG5cbi8qKlxuICogVmVyeSBiYXNpYyBwb2x5ZmlsbCBmb3IgRWxlbWVudC5hbmltYXRlIGlmIGl0IGRvZXNuJ3QgZXhpc3QuIElmIGl0IGRvZXMsIHVzZSB0aGUgbmF0aXZlLlxuICogVGhpcyBvbmx5IHN1cHBvcnRzIHR3byBjc3Mgc3RhdGVzLiBJdCB3aWxsIG92ZXJ3cml0ZSBleGlzdGluZyBzdHlsZXMuIEl0IGRvZXNuJ3QgcmV0dXJuIGFuIGFuaW1hdGlvbiBwbGF5IGNvbnRyb2wuIEl0XG4gKiBvbmx5IHN1cHBvcnRzIGR1cmF0aW9uLCBkZWxheSwgYW5kIGVhc2luZy4gUmV0dXJucyBhbiBvYmplY3Qgd2l0aCBhIHByb3BlcnR5IG9uZmluaXNoLlxuICovXG5mdW5jdGlvbiBhbmltYXRlRWxlbWVudChjc3MsIG9wdGlvbnMpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGNzcykgfHwgY3NzLmxlbmd0aCAhPT0gMikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2FuaW1hdGUgcG9seWZpbGwgcmVxdWlyZXMgYW4gYXJyYXkgZm9yIGNzcyB3aXRoIGFuIGluaXRpYWwgYW5kIGZpbmFsIHN0YXRlJyk7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMgfHwgIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ2R1cmF0aW9uJykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdhbmltYXRlIHBvbHlmaWxsIHJlcXVpcmVzIG9wdGlvbnMgd2l0aCBhIGR1cmF0aW9uJyk7XG4gIH1cblxuICB2YXIgZHVyYXRpb24gPSBvcHRpb25zLmR1cmF0aW9uIHx8IDA7XG4gIHZhciBkZWxheSA9IG9wdGlvbnMuZGVsYXkgfHwgMDtcbiAgdmFyIGVhc2luZyA9IG9wdGlvbnMuZWFzaW5nO1xuICB2YXIgaW5pdGlhbENzcyA9IGNzc1swXTtcbiAgdmFyIGZpbmFsQ3NzID0gY3NzWzFdO1xuICB2YXIgYWxsQ3NzID0ge307XG4gIHZhciBwbGF5YmFjayA9IHsgb25maW5pc2g6IG51bGwgfTtcblxuICBPYmplY3Qua2V5cyhpbml0aWFsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIGFsbENzc1trZXldID0gdHJ1ZTtcbiAgICBlbGVtZW50LnN0eWxlW2tleV0gPSBpbml0aWFsQ3NzW2tleV07XG4gIH0pO1xuXG4gIC8vIHRyaWdnZXIgcmVmbG93XG4gIGVsZW1lbnQub2Zmc2V0V2lkdGg7XG5cbiAgdmFyIHRyYW5zaXRpb25PcHRpb25zID0gJyAnICsgZHVyYXRpb24gKyAnbXMnO1xuICBpZiAoZWFzaW5nKSB7XG4gICAgdHJhbnNpdGlvbk9wdGlvbnMgKz0gJyAnICsgZWFzaW5nO1xuICB9XG4gIGlmIChkZWxheSkge1xuICAgIHRyYW5zaXRpb25PcHRpb25zICs9ICcgJyArIGRlbGF5ICsgJ21zJztcbiAgfVxuXG4gIGVsZW1lbnQuc3R5bGUudHJhbnNpdGlvbiA9IE9iamVjdC5rZXlzKGZpbmFsQ3NzKS5tYXAoZnVuY3Rpb24oa2V5KSB7XG4gICAgcmV0dXJuIGtleSArIHRyYW5zaXRpb25PcHRpb25zXG4gIH0pLmpvaW4oJywgJyk7XG5cbiAgT2JqZWN0LmtleXMoZmluYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGZpbmFsQ3NzW2tleV07XG4gIH0pO1xuXG4gIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgT2JqZWN0LmtleXMoYWxsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgZWxlbWVudC5zdHlsZVtrZXldID0gJyc7XG4gICAgfSk7XG5cbiAgICBpZiAocGxheWJhY2sub25maW5pc2gpIHtcbiAgICAgIHBsYXliYWNrLm9uZmluaXNoKCk7XG4gICAgfVxuICB9LCBkdXJhdGlvbiArIGRlbGF5KTtcblxuICByZXR1cm4gcGxheWJhY2s7XG59XG4iLCJ2YXIgZ2xvYmFsID0gKGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcyB9KSgpO1xudmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xubW9kdWxlLmV4cG9ydHMgPSBleHRlbmQ7XG5leHRlbmQubWFrZSA9IG1ha2U7XG5cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IHByb3RvdHlwZSBmb3IgdGhlIGdpdmVuIGNvbnRydWN0b3IgYW5kIHNldHMgYW4gYGV4dGVuZGAgbWV0aG9kIG9uIGl0LiBJZiBgZXh0ZW5kYCBpcyBjYWxsZWQgZnJvbSBhXG4gKiBpdCB3aWxsIGV4dGVuZCB0aGF0IGNsYXNzLlxuICovXG5mdW5jdGlvbiBleHRlbmQoY29uc3RydWN0b3IsIHByb3RvdHlwZSkge1xuICB2YXIgc3VwZXJDbGFzcyA9IHRoaXMgPT09IGdsb2JhbCA/IE9iamVjdCA6IHRoaXM7XG4gIGlmICh0eXBlb2YgY29uc3RydWN0b3IgIT09ICdmdW5jdGlvbicgJiYgIXByb3RvdHlwZSkge1xuICAgIHByb3RvdHlwZSA9IGNvbnN0cnVjdG9yO1xuICAgIGNvbnN0cnVjdG9yID0gZnVuY3Rpb24oKSB7XG4gICAgICBzdXBlckNsYXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfTtcbiAgfVxuICBjb25zdHJ1Y3Rvci5leHRlbmQgPSBleHRlbmQ7XG4gIHZhciBkZXNjcmlwdG9ycyA9IGdldFByb3RvdHlwZURlc2NyaXB0b3JzKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpO1xuICBjb25zdHJ1Y3Rvci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHN1cGVyQ2xhc3MucHJvdG90eXBlLCBkZXNjcmlwdG9ycyk7XG4gIHJldHVybiBjb25zdHJ1Y3Rvcjtcbn1cblxuXG4vKipcbiAqIE1ha2VzIGEgbmF0aXZlIG9iamVjdCBwcmV0ZW5kIHRvIGJlIGEgY2xhc3MgKGUuZy4gYWRkcyBtZXRob2RzIHRvIGEgRG9jdW1lbnRGcmFnbWVudCBhbmQgY2FsbHMgdGhlIGNvbnN0cnVjdG9yKS5cbiAqL1xuZnVuY3Rpb24gbWFrZShjb25zdHJ1Y3Rvciwgb2JqZWN0KSB7XG4gIGlmICh0eXBlb2YgY29uc3RydWN0b3IgIT09ICdmdW5jdGlvbicgfHwgdHlwZW9mIG9iamVjdCAhPT0gJ29iamVjdCcpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdtYWtlIG11c3QgYWNjZXB0IGEgZnVuY3Rpb24gY29uc3RydWN0b3IgYW5kIGFuIG9iamVjdCcpO1xuICB9XG4gIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDIpO1xuICB2YXIgcHJvdG8gPSBjb25zdHJ1Y3Rvci5wcm90b3R5cGU7XG4gIGZvciAodmFyIGtleSBpbiBwcm90bykge1xuICAgIG9iamVjdFtrZXldID0gcHJvdG9ba2V5XTtcbiAgfVxuICBjb25zdHJ1Y3Rvci5hcHBseShvYmplY3QsIGFyZ3MpO1xuICByZXR1cm4gb2JqZWN0O1xufVxuXG5cbmZ1bmN0aW9uIGdldFByb3RvdHlwZURlc2NyaXB0b3JzKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpIHtcbiAgdmFyIGRlc2NyaXB0b3JzID0ge1xuICAgIGNvbnN0cnVjdG9yOiB7IHdyaXRhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUsIHZhbHVlOiBjb25zdHJ1Y3RvciB9XG4gIH07XG5cbiAgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMocHJvdG90eXBlKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgZGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IocHJvdG90eXBlLCBuYW1lKTtcbiAgICBkZXNjcmlwdG9yLmVudW1lcmFibGUgPSBmYWxzZTtcbiAgICBkZXNjcmlwdG9yc1tuYW1lXSA9IGRlc2NyaXB0b3I7XG4gIH0pO1xuICByZXR1cm4gZGVzY3JpcHRvcnM7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHRvRnJhZ21lbnQ7XG5cbi8vIENvbnZlcnQgc3R1ZmYgaW50byBkb2N1bWVudCBmcmFnbWVudHMuIFN0dWZmIGNhbiBiZTpcbi8vICogQSBzdHJpbmcgb2YgSFRNTCB0ZXh0XG4vLyAqIEFuIGVsZW1lbnQgb3IgdGV4dCBub2RlXG4vLyAqIEEgTm9kZUxpc3Qgb3IgSFRNTENvbGxlY3Rpb24gKGUuZy4gYGVsZW1lbnQuY2hpbGROb2Rlc2Agb3IgYGVsZW1lbnQuY2hpbGRyZW5gKVxuLy8gKiBBIGpRdWVyeSBvYmplY3Rcbi8vICogQSBzY3JpcHQgZWxlbWVudCB3aXRoIGEgYHR5cGVgIGF0dHJpYnV0ZSBvZiBgXCJ0ZXh0LypcImAgKGUuZy4gYDxzY3JpcHQgdHlwZT1cInRleHQvaHRtbFwiPk15IHRlbXBsYXRlIGNvZGUhPC9zY3JpcHQ+YClcbi8vICogQSB0ZW1wbGF0ZSBlbGVtZW50IChlLmcuIGA8dGVtcGxhdGU+TXkgdGVtcGxhdGUgY29kZSE8L3RlbXBsYXRlPmApXG5mdW5jdGlvbiB0b0ZyYWdtZW50KGh0bWwpIHtcbiAgaWYgKGh0bWwgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIGh0bWw7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGh0bWwgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoaHRtbCBpbnN0YW5jZW9mIE5vZGUpIHtcbiAgICByZXR1cm4gbm9kZVRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoaHRtbC5oYXNPd25Qcm9wZXJ0eSgnbGVuZ3RoJykpIHtcbiAgICByZXR1cm4gbGlzdFRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5zdXBwb3J0ZWQgVGVtcGxhdGUgVHlwZTogQ2Fubm90IGNvbnZlcnQgYCcgKyBodG1sICsgJ2AgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LicpO1xuICB9XG59XG5cbi8vIENvbnZlcnRzIGFuIEhUTUwgbm9kZSBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuIElmIGl0IGlzIGEgPHRlbXBsYXRlPiBub2RlIGl0cyBjb250ZW50cyB3aWxsIGJlIHVzZWQuIElmIGl0IGlzIGFcbi8vIDxzY3JpcHQ+IG5vZGUgaXRzIHN0cmluZy1iYXNlZCBjb250ZW50cyB3aWxsIGJlIGNvbnZlcnRlZCB0byBIVE1MIGZpcnN0LCB0aGVuIHVzZWQuIE90aGVyd2lzZSBhIGNsb25lIG9mIHRoZSBub2RlXG4vLyBpdHNlbGYgd2lsbCBiZSB1c2VkLlxuZnVuY3Rpb24gbm9kZVRvRnJhZ21lbnQobm9kZSkge1xuICBpZiAobm9kZS5jb250ZW50IGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICAgIHJldHVybiBub2RlLmNvbnRlbnQ7XG4gIH0gZWxzZSBpZiAobm9kZS50YWdOYW1lID09PSAnU0NSSVBUJykge1xuICAgIHJldHVybiBzdHJpbmdUb0ZyYWdtZW50KG5vZGUuaW5uZXJIVE1MKTtcbiAgfSBlbHNlIHtcbiAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgaWYgKG5vZGUudGFnTmFtZSA9PT0gJ1RFTVBMQVRFJykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBub2RlLmNoaWxkTm9kZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5vZGUuY2hpbGROb2Rlc1tpXSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gZnJhZ21lbnQ7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTENvbGxlY3Rpb24sIE5vZGVMaXN0LCBqUXVlcnkgb2JqZWN0LCBvciBhcnJheSBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG5mdW5jdGlvbiBsaXN0VG9GcmFnbWVudChsaXN0KSB7XG4gIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgZm9yICh2YXIgaSA9IDAsIGwgPSBsaXN0Lmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIC8vIFVzZSB0b0ZyYWdtZW50IHNpbmNlIHRoaXMgbWF5IGJlIGFuIGFycmF5IG9mIHRleHQsIGEgalF1ZXJ5IG9iamVjdCBvZiBgPHRlbXBsYXRlPmBzLCBldGMuXG4gICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodG9GcmFnbWVudChsaXN0W2ldKSk7XG4gIH1cbiAgcmV0dXJuIGZyYWdtZW50O1xufVxuXG4vLyBDb252ZXJ0cyBhIHN0cmluZyBvZiBIVE1MIHRleHQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LlxuZnVuY3Rpb24gc3RyaW5nVG9GcmFnbWVudChzdHJpbmcpIHtcbiAgdmFyIHRlbXBsYXRlRWxlbWVudDtcbiAgdGVtcGxhdGVFbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKTtcbiAgdGVtcGxhdGVFbGVtZW50LmlubmVySFRNTCA9IHN0cmluZztcbiAgcmV0dXJuIHRlbXBsYXRlRWxlbWVudC5jb250ZW50O1xufVxuXG4vLyBJZiBIVE1MIFRlbXBsYXRlcyBhcmUgbm90IGF2YWlsYWJsZSAoZS5nLiBpbiBJRSkgdGhlbiB1c2UgYW4gb2xkZXIgbWV0aG9kIHRvIHdvcmsgd2l0aCBjZXJ0YWluIGVsZW1lbnRzLlxuaWYgKCFkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gIHN0cmluZ1RvRnJhZ21lbnQgPSAoZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRhZ0V4cCA9IC88KFtcXHc6LV0rKS87XG5cbiAgICAvLyBDb3BpZWQgZnJvbSBqUXVlcnkgKGh0dHBzOi8vZ2l0aHViLmNvbS9qcXVlcnkvanF1ZXJ5L2Jsb2IvbWFzdGVyL0xJQ0VOU0UudHh0KVxuICAgIHZhciB3cmFwTWFwID0ge1xuICAgICAgb3B0aW9uOiBbIDEsICc8c2VsZWN0IG11bHRpcGxlPVwibXVsdGlwbGVcIj4nLCAnPC9zZWxlY3Q+JyBdLFxuICAgICAgbGVnZW5kOiBbIDEsICc8ZmllbGRzZXQ+JywgJzwvZmllbGRzZXQ+JyBdLFxuICAgICAgdGhlYWQ6IFsgMSwgJzx0YWJsZT4nLCAnPC90YWJsZT4nIF0sXG4gICAgICB0cjogWyAyLCAnPHRhYmxlPjx0Ym9keT4nLCAnPC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIHRkOiBbIDMsICc8dGFibGU+PHRib2R5Pjx0cj4nLCAnPC90cj48L3Rib2R5PjwvdGFibGU+JyBdLFxuICAgICAgY29sOiBbIDIsICc8dGFibGU+PHRib2R5PjwvdGJvZHk+PGNvbGdyb3VwPicsICc8L2NvbGdyb3VwPjwvdGFibGU+JyBdLFxuICAgICAgYXJlYTogWyAxLCAnPG1hcD4nLCAnPC9tYXA+JyBdLFxuICAgICAgX2RlZmF1bHQ6IFsgMCwgJycsICcnIF1cbiAgICB9O1xuICAgIHdyYXBNYXAub3B0Z3JvdXAgPSB3cmFwTWFwLm9wdGlvbjtcbiAgICB3cmFwTWFwLnRib2R5ID0gd3JhcE1hcC50Zm9vdCA9IHdyYXBNYXAuY29sZ3JvdXAgPSB3cmFwTWFwLmNhcHRpb24gPSB3cmFwTWFwLnRoZWFkO1xuICAgIHdyYXBNYXAudGggPSB3cmFwTWFwLnRkO1xuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHN0cmluZ1RvRnJhZ21lbnQoc3RyaW5nKSB7XG4gICAgICB2YXIgdGFnID0gc3RyaW5nLm1hdGNoKHRhZ0V4cCk7XG4gICAgICB2YXIgcGFydHMgPSB3cmFwTWFwW3RhZ10gfHwgd3JhcE1hcC5fZGVmYXVsdDtcbiAgICAgIHZhciBkZXB0aCA9IHBhcnRzWzBdO1xuICAgICAgdmFyIHByZWZpeCA9IHBhcnRzWzFdO1xuICAgICAgdmFyIHBvc3RmaXggPSBwYXJ0c1syXTtcbiAgICAgIHZhciBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgIGRpdi5pbm5lckhUTUwgPSBwcmVmaXggKyBzdHJpbmcgKyBwb3N0Zml4O1xuICAgICAgd2hpbGUgKGRlcHRoLS0pIHtcbiAgICAgICAgZGl2ID0gZGl2Lmxhc3RDaGlsZDtcbiAgICAgIH1cbiAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChkaXYuZmlyc3RDaGlsZCkge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkaXYuZmlyc3RDaGlsZCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZnJhZ21lbnQ7XG4gICAgfTtcbiAgfSkoKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuXG4vKipcbiAqICMjIFZpZXdcbiAqIEEgRG9jdW1lbnRGcmFnbWVudCB3aXRoIGJpbmRpbmdzLlxuICovXG5mdW5jdGlvbiBWaWV3KHRlbXBsYXRlKSB7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy5maXJzdFZpZXdOb2RlID0gdGhpcy5maXJzdENoaWxkO1xuICB0aGlzLmxhc3RWaWV3Tm9kZSA9IHRoaXMubGFzdENoaWxkO1xuICB0aGlzLmZpcnN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gIHRoaXMubGFzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICB0aGlzLmJpbmRpbmdzID0gdGhpcy50ZW1wbGF0ZS5iaW5kaW5ncy5tYXAoZnVuY3Rpb24oYmluZGluZykge1xuICAgIHJldHVybiBiaW5kaW5nLmNsb25lRm9yVmlldyh0aGlzKTtcbiAgfSwgdGhpcyk7XG59XG5cblxuVmlldy5wcm90b3R5cGUgPSB7XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSB2aWV3IGZyb20gdGhlIERPTS4gQSB2aWV3IGlzIGEgRG9jdW1lbnRGcmFnbWVudCwgc28gYHJlbW92ZSgpYCByZXR1cm5zIGFsbCBpdHMgbm9kZXMgdG8gaXRzZWxmLlxuICAgKi9cbiAgcmVtb3ZlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9kZSA9IHRoaXMuZmlyc3RWaWV3Tm9kZTtcbiAgICB2YXIgbmV4dDtcblxuICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHRoaXMpIHtcbiAgICAgIC8vIFJlbW92ZSBhbGwgdGhlIG5vZGVzIGFuZCBwdXQgdGhlbSBiYWNrIGludG8gdGhpcyBmcmFnbWVudFxuICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgbmV4dCA9IChub2RlID09PSB0aGlzLmxhc3RWaWV3Tm9kZSkgPyBudWxsIDogbm9kZS5uZXh0U2libGluZztcbiAgICAgICAgdGhpcy5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgKGlmIG5vdCBhbHJlYWR5IHJlbW92ZWQpIGFuZCBhZGRzIHRoZSB2aWV3IHRvIGl0cyB0ZW1wbGF0ZSdzIHBvb2wuXG4gICAqL1xuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICAvLyBNYWtlIHN1cmUgdGhlIHZpZXcgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET01cbiAgICB0aGlzLnJlbW92ZSgpO1xuICAgIHRoaXMudW5iaW5kKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucG9vbC5wdXNoKHRoaXMpO1xuICAgIH1cbiAgfSxcblxuXG4gIC8qKlxuICAgKiBCaW5kcyBhIHZpZXcgdG8gYSBnaXZlbiBjb250ZXh0LlxuICAgKi9cbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmJpbmQoY29udGV4dCk7XG4gICAgfSk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5iaW5kcyBhIHZpZXcgZnJvbSBhbnkgY29udGV4dC5cbiAgICovXG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy5iaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICAgIGJpbmRpbmcudW5iaW5kKCk7XG4gICAgfSk7XG4gIH1cbn07XG4iLCJ2YXIgRnJhZ21lbnRzID0gcmVxdWlyZSgnLi9zcmMvZnJhZ21lbnRzJyk7XG52YXIgT2JzZXJ2ZXIgPSByZXF1aXJlKCcuL3NyYy9vYnNlcnZlcicpO1xuXG4vLyBDcmVhdGUgYW4gaW5zdGFuY2Ugb2YgZnJhZ21lbnRzIHdpdGggdGhlIGRlZmF1bHQgb2JzZXJ2ZXJcbnZhciBmcmFnbWVudHMgPSBuZXcgRnJhZ21lbnRzKE9ic2VydmVyKTtcbmZyYWdtZW50cy5leHByZXNzaW9uID0gT2JzZXJ2ZXIuZXhwcmVzc2lvbjtcbmZyYWdtZW50cy5zeW5jID0gT2JzZXJ2ZXIuc3luYztcbm1vZHVsZS5leHBvcnRzID0gZnJhZ21lbnRzO1xuIl19
