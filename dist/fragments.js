(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.fragments = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = require('./src/expressions');

},{"./src/expressions":2}],2:[function(require,module,exports){
var slice = Array.prototype.slice;
var strings = require('./strings');
var formatterParser = require('./formatters');
var propertyChains = require('./property-chains');
var valueProperty = '_value_';
var cache = {};

exports.globals = {};


exports.parse = function(expr, globals, formatters, extraArgs) {
  if (!Array.isArray(extraArgs)) extraArgs = [];
  var cacheKey = expr + '|' + extraArgs.join(',');
  // Returns the cached function for this expression if it exists.
  var func = cache[cacheKey];
  if (func) {
    return func;
  }

  var original = expr;
  var isSetter = (extraArgs[0] === valueProperty);
  // Allow '!prop' to become 'prop = !value'
  if (isSetter && expr.charAt(0) === '!') {
    expr = expr.slice(1);
    valueProperty = '!' + valueProperty;
  }

  expr = strings.pullOutStrings(expr);
  expr = formatterParser.parseFormatters(expr);
  expr = propertyChains.parseExpression(expr, getVariables(globals, extraArgs));
  if (!isSetter) {
    var lines = expr.split('\n');
    lines[lines.length - 1] = 'return ' + lines[lines.length - 1];
    expr = lines.join('\n');
  }
  expr = strings.putInStrings(expr);
  func = compileExpression(original, expr, globals, formatters, extraArgs);
  func.expr = expr;
  cache[cacheKey] = func;
  return func;
};


exports.parseSetter = function(expr, globals, formatters, extraArgs) {
  if (!Array.isArray(extraArgs)) extraArgs = [];

  // Add _value_ as the first extra argument
  extraArgs.unshift(valueProperty);
  expr = expr.replace(/(\s*\||$)/, ' = _value_$1');

  return exports.parse(expr, globals, formatters, extraArgs);
};


function getVariables(globals, extraArgs) {
  var variables = {};

  Object.keys(exports.globals).forEach(function(key) {
    variables[key] = exports.globals[key];
  });

  if (globals) {
    Object.keys(globals).forEach(function(key) {
      variables[key] = globals[key];
    });
  }

  extraArgs.forEach(function(key) {
    variables[key] = null;
  });

  return variables;
}



function compileExpression(original, expr, globals, formatters, extraArgs) {
  var func, args = ['_globals_', '_formatters_'].concat(extraArgs).concat(expr);

  try {
    func = Function.apply(null, args);
  } catch (e) {
    // Throws an error if the expression was not valid JavaScript
    throw new Error('Bad expression: ' + original + '\n' + 'Compiled expression:\n' + expr + '\n' + e.message);
  }

  return bindArguments(func, globals, formatters);
}


// a custom "bind" function to bind arguments to a function without binding the context
function bindArguments(func) {
  var args = slice.call(arguments, 1);
  return function() {
    return func.apply(this, args.concat(slice.call(arguments)));
  }
}

},{"./formatters":3,"./property-chains":4,"./strings":5}],3:[function(require,module,exports){

// finds pipes that are not ORs (i.e. ` | ` not ` || `) for formatters
var pipeRegex = /\|(\|)?/g;

// A string that would not appear in valid JavaScript
var placeholder = '@@@';
var placeholderRegex = new RegExp('\\s*' + placeholder + '\\s*');

// determines whether an expression is a setter or getter (`name` vs `name = 'bob'`)
var setterRegex = /\s=\s/;

// finds the parts of a formatter, name and args (e.g. `foo(bar)`)
var formatterRegex = /^([^\(]+)(?:\((.*)\))?$/;

// finds argument separators for formatters (`arg1, arg2`)
var argSeparator = /\s*,\s*/g;


/**
 * Finds the formatters within an expression and converts them to the correct JavaScript equivalent.
 */
exports.parseFormatters = function(expr) {
  // Converts `name | upper | foo(bar)` into `name @@@ upper @@@ foo(bar)`
  expr = expr.replace(pipeRegex, function(match, orIndicator) {
    if (orIndicator) return match;
    return placeholder;
  });

  // splits the string by "@@@", pulls of the first as the expr, the remaining are formatters
  formatters = expr.split(placeholderRegex);
  expr = formatters.shift();
  if (!formatters.length) return expr;

  // Processes the formatters
  // If the expression is a setter the value will be run through the formatters
  var setter = '';
  var value = expr;

  if (setterRegex.test(expr)) {
    var parts = expr.split(setterRegex);
    setter = parts[0] + ' = ';
    value = parts[1];
  }

  // Processes the formatters
  formatters.forEach(function(formatter) {
    var match = formatter.trim().match(formatterRegex);

    if (!match) {
      throw new Error('Formatter is invalid: ' + formatter);
    }

    var formatterName = match[1];
    var args = match[2] ? match[2].split(argSeparator) : [];

    // Add the previous value as the first argument
    args.unshift(value);

    // If this is a setter expr, be sure to add the `isSetter` flag at the end of the formatter's arguments
    if (setter) {
      args.push(true);
    }

    // Set the value to become the result of this formatter, so the next formatter can wrap it.
    // Call formatters in the current context.
    value = '_formatters_.' + formatterName + '.call(this, ' + args.join(', ') + ')';
  });

  return setter + value;
};

},{}],4:[function(require,module,exports){
var referenceCount = 0;
var currentReference = 0;
var currentIndex = 0;
var finishedChain = false;
var continuation = false;
var globals = null;
var defaultGlobals = {
  return: null,
  true: null,
  false: null,
  undefined: null,
  null: null,
  this: null,
  window: null,
  Math: null,
  parseInt: null,
  parseFloat: null,
  isNaN: null,
  Array: null,
  typeof: null,
  _globals_: null,
  _formatters_: null,
  _value_: null,
};


// matches property chains (e.g. `name`, `user.name`, and `user.fullName().capitalize()`)
var propertyRegex = /((\{|,|\.)?\s*)([a-z$_\$](?:[a-z_\$0-9\.-]|\[['"\d]+\])*)(\s*(:|\(|\[)?)|(\[)/gi;
/**
 * Broken down
 *
 * ((\{|,|\.)?\s*)
 * prefix: matches on object literals so we can skip (in `{ foo: bar }` "foo" is not a property). Also picks up on
 * unfinished chains that had function calls or brackets we couldn't finish such as the dot in `.test` after the chain
 * `foo.bar().test`.
 *
 * ([a-z$_\$](?:[a-z_\$0-9\.-]|\[['"\d]+\])*)
 * property chain: matches property chains such as the following (strings' contents are removed at this step)
 *   `foo, foo.bar, foo.bar[0], foo.bar[0].test, foo.bar[''].test`
 *   Does not match through functions calls or through brackets which contain variables.
 *   `foo.bar().test, foo.bar[prop].test`
 *   In these cases it would only match `foo.bar`, `.test`, and `prop`
 *
 * (\s*(:|\(|\[)?)
 * postfix: matches trailing characters to determine if this is an object property or a function call etc. Will match
 * the colon after "foo" in `{ foo: 'bar' }`, the first parenthesis in `obj.foo(bar)`, the the first bracket in
 * `foo[bar]`.
 */

// links in a property chain
var chainLinksRegex = /\.|\[/g;

// the property name part of links
var chainLinkRegex = /\.|\[|\(/;

var andRegex = / and /g;
var orRegex = / or /g;


exports.parseExpression = function(expr, _globals) {
  // Reset all values
  referenceCount = 0;
  currentReference = 0;
  currentIndex = 0;
  finishedChain = false;
  continuation = false;
  globals = _globals;

  expr = replaceAndsAndOrs(expr);
  if (expr.indexOf(' = ') !== -1) {
    var parts = expr.split(' = ');
    var setter = parts[0];
    var value = parts[1];
    setter = parsePropertyChains(setter).replace(/^\(|\)$/g, '');
    value = parsePropertyChains(value);
    expr = setter + ' = ' + value;
  } else {
    expr = parsePropertyChains(expr);
  }
  expr = addReferences(expr)

  // Reset after parse is done
  globals = null;

  return expr;
};


/**
 * Finds and parses the property chains in an expression.
 */
function parsePropertyChains(expr) {
  var parsedExpr = '', chain;

  // allow recursion (e.g. into function args) by resetting propertyRegex
  // This is more efficient than creating a new regex for each chain, I assume
  var prevCurrentIndex = currentIndex;
  var prevLastIndex = propertyRegex.lastIndex;

  currentIndex = 0;
  propertyRegex.lastIndex = 0;
  while ((chain = nextChain(expr)) !== false) {
    parsedExpr += chain;
  }

  // Reset indexes
  currentIndex = prevCurrentIndex;
  propertyRegex.lastIndex = prevLastIndex;
  return parsedExpr;
};


function nextChain(expr) {
  if (finishedChain) {
    return (finishedChain = false);
  }
  var match = propertyRegex.exec(expr);
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

  var skipped = expr.slice(currentIndex, propertyRegex.lastIndex - match.length);
  currentIndex = propertyRegex.lastIndex;

  // skips object keys e.g. test in `{test:true}`.
  if (objIndicator && colonOrParen === ':') {
    return skipped + match;
  }

  return skipped + parseChain(prefix, propChain, postfix, colonOrParen, expr);
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
    newChain = addThisOrGlobal(link);
  } else {
    if (!continuation) {
      newChain = '(';
    }

    links.forEach(function(link, index) {
      if (index !== links.length - 1) {
        newChain += parsePart(link, index);
      } else {
        if (!parens[paren]) {
          newChain += '_ref' + currentReference + link;
        } else {
          if (continuation && index === 0) {
            index++;
          }
          postfix = postfix.replace(paren, '');
          newChain += paren === '(' ? parseFunction(link, index, expr) : parseBrackets(link, index, expr);
        }
      }
    });

    if (expr.charAt(propertyRegex.lastIndex) !== '.') {
      newChain += ')';
    }
  }

  return prefix + newChain + postfix;
}


function splitLinks(chain) {
  var index = 0;
  var parts = [];
  var match;
  while (match = chainLinksRegex.exec(chain)) {
    if (chainLinksRegex.lastIndex === 1) continue;
    parts.push(chain.slice(index, chainLinksRegex.lastIndex - 1));
    index = chainLinksRegex.lastIndex - 1;
  }
  parts.push(chain.slice(index));
  return parts;
}


function addThisOrGlobal(chain) {
  var prop = chain.split(chainLinkRegex).shift();
  if (globals.hasOwnProperty(prop)) {
    return globals[prop] === null ? chain : '_globals_.' + chain;
  } else if (defaultGlobals.hasOwnProperty(prop)) {
    return chain;
  } else {
    return 'this.' + chain;
  }
}


var parens = {
  '(': ')',
  '[': ']'
};

// Handles a function to be called in its correct scope
// Finds the end of the function and processes the arguments
function parseFunction(link, index, expr) {
  var call = getFunctionCall(expr);

  // Always call functions in the scope of the object they're a member of
  if (index === 0) {
    link = addThisOrGlobal(link);
  } else {
    link = '_ref' + currentReference + link;
  }

  var calledLink = link + '(~~insideParens~~)';
  if (expr.charAt(propertyRegex.lastIndex) === '.') {
    calledLink = parsePart(calledLink, index)
  }

  link = 'typeof ' + link + ' !== \'function\' ? void 0 : ' + calledLink;
  var insideParens = call.slice(1, -1);

  var ref = currentReference;
  link = link.replace('~~insideParens~~', parsePropertyChains(insideParens));
  currentReference = ref;
  return link;
}

// Handles a bracketed expression to be parsed
function parseBrackets(link, index, expr) {
  var call = getFunctionCall(expr);
  var insideBrackets = call.slice(1, -1);
  var evaledLink = parsePart(link, index);
  index += 1;
  link = '[~~insideBrackets~~]';

  if (expr.charAt(propertyRegex.lastIndex) === '.') {
    link = parsePart(link, index);
  } else {
    link = '_ref' + currentReference + link;
  }

  link = evaledLink + link;

  var ref = currentReference;
  link = link.replace('~~insideBrackets~~', parsePropertyChains(insideBrackets));
  currentReference = ref;
  return link;
}


// returns the call part of a function (e.g. `test(123)` would return `(123)`)
function getFunctionCall(expr) {
  var startIndex = propertyRegex.lastIndex;
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
  currentIndex = propertyRegex.lastIndex = endIndex + 1;
  return open + expr.slice(startIndex, endIndex) + close;
}



function parsePart(part, index) {
  // if the first
  if (index === 0 && !continuation) {
    part = addThisOrGlobal(part);
  } else {
    part = '_ref' + currentReference + part;
  }

  currentReference = ++referenceCount;
  var ref = '_ref' + currentReference;
  return '(' + ref + ' = ' + part + ') == null ? void 0 : ';
}


function replaceAndsAndOrs(expr) {
  return expr.replace(andRegex, ' && ').replace(orRegex, ' || ');
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

},{}],5:[function(require,module,exports){
// finds all quoted strings
var quoteRegex = /(['"\/])(\\\1|[^\1])*?\1/g;

// finds all empty quoted strings
var emptyQuoteExpr = /(['"\/])\1/g;

var strings = null;


/**
 * Remove strings from an expression for easier parsing. Returns a list of the strings to add back in later.
 * This method actually leaves the string quote marks but empties them of their contents. Then when replacing them after
 * parsing the contents just get put back into their quotes marks.
 */
exports.pullOutStrings = function(expr) {
  if (strings) {
    throw new Error('putInStrings must be called after pullOutStrings.');
  }

  strings = [];

  return expr.replace(quoteRegex, function(str, quote) {
    strings.push(str);
    return quote + quote; // placeholder for the string
  });
};


/**
 * Replace the strings previously pulled out after parsing is finished.
 */
exports.putInStrings = function(expr) {
  if (!strings) {
    throw new Error('pullOutStrings must be called before putInStrings.');
  }

  expr = expr.replace(emptyQuoteExpr, function() {
    return strings.shift();
  });

  strings = null;

  return expr;
};

},{}],6:[function(require,module,exports){
var Fragments = require('./src/fragments');
var Observer = require('./src/observer');

function create() {
  var fragments = new Fragments(Observer);
  fragments.expressions = Observer.expressions;
  fragments.sync = Observer.sync;
  fragments.syncNow = Observer.syncNow;
  fragments.context = Observer.context;
  return fragments;
}

// Create an instance of fragments with the default observer
module.exports = create();
module.exports.create = create;

},{"./src/fragments":10,"./src/observer":13}],7:[function(require,module,exports){
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

      node.classList.add(willName);

      // trigger reflow
      node.offsetWidth = node.offsetWidth;

      node.classList.add(name);
      node.classList.remove(willName);

      var duration = getDuration.call(this, node, direction);
      var whenDone = function() {
        node.classList.remove(name);
        if (className) node.classList.remove(className);
        if (callback) callback.call(_this);
      };

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

},{"./binding":8,"./util/animation":19}],8:[function(require,module,exports){
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
    if (this.observer) this.observer.context = context;
    this.bound();

    if (this.observer) {
      if (this.updated !== Binding.prototype.updated) {
        this.observer.forceUpdateNextSync = true;
        this.observer.bind(context);
      }
    }
  },


  // Unbind this from its context
  unbind: function() {
    if (this.context === null) {
      return;
    }

    if (this.observer) this.observer.unbind();
    this.unbound();
    this.context = null;
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

},{"./util/extend":20}],9:[function(require,module,exports){
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
  var Binder, binding, expr, bound, match, attr, i, l;

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
    bound = [];
    var attributes = slice.call(node.attributes);
    for (i = 0, l = attributes.length; i < l; i++) {
      attr = attributes[i];
      Binder = fragments.findBinder('attribute', attr.name, attr.value);
      if (Binder) {
        bound.push([ Binder, attr ]);
      }
    }

    // Make sure to create and process them in the correct priority order so if a binding create a template from the
    // node it doesn't process the others.
    bound.sort(sortAttributes);

    for (i = 0; i < bound.length; i++) {
      Binder = bound[i][0];
      attr = bound[i][1];
      if (!node.hasAttribute(attr.name)) {
        // If this was removed already by another binding, don't process.
        continue;
      }
      var name = attr.name;
      var value = attr.value;
      if (Binder.expr) {
        match = name.match(Binder.expr);
        if (match) match = match[1];
      } else {
        match = null;
      }

      try {
        node.removeAttribute(attr.name);
      } catch(e) {
        // if the attribute was already removed don't worry
      }

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
      while ((match = regex.exec(content))) {
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

},{}],10:[function(require,module,exports){
module.exports = Fragments;
require('./util/polyfills');
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
  this.globals = ObserverClass.globals = {};
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
   * Observes an expression within a given context, calling the callback when it changes and returning the observer.
   */
  observe: function(context, expr, callback, callbackContext) {
    var observer = new this.Observer(expr, callback, callbackContext);
    observer.bind(context, true);
    return observer;
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
    var binders = this.binders[type];
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

    if (name === '__default__' && !definition.hasOwnProperty('priority')) {
      definition.priority = -100;
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

    if (binder && type === 'attribute' && binder.prototype.onlyWhenBound && !this.isBound(type, value)) {
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
  unregisterFormatter: function (name) {
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
      while ((match = expr.exec(text))) {
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
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

},{"./animatedBinding":7,"./binding":8,"./compile":9,"./registered/animations":15,"./registered/binders":16,"./registered/formatters":17,"./template":18,"./util/animation":19,"./util/extend":20,"./util/polyfills":21,"./util/toFragment":22,"./view":23}],11:[function(require,module,exports){
// inspired from zone.js, but without being as comprehensive or intrusive (i.e. avoiding global scope)

// Run a function in the context of fragments
exports.run = run;

// Return a new function which will run in the context of fragments
exports.wrap = wrap;

// Return a proxy for a function which will wrap any function arguments passed to it
exports.proxy = proxy;

// Skip Observer.sync on the next invocation the context. This is really just for observer to run and not get into
// a loop
exports.skipNextSync = function() {
  skipNext = true;
};


var Observer = require('./observer');
var patched = false;
var skipNext = false;
var wrappedKey = (typeof Symbol !== 'undefined') ? Symbol('wrapped') : '_zonejr$wrapped';


function run(func) {
  return wrap(func)();
}

function wrap(func) {
  if (typeof func !== 'function') {
    return func;
  } else if (!func[wrappedKey]) {
    func[wrappedKey] = function() {
      if (patched) {
        return func.apply(this, arguments);
      }

      patch();
      var result = func.apply(this, arguments);
      if (skipNext) {
        skipNext = false;
      } else {
        Observer.sync();
      }
      unpatch();
      return result;
    };
    func[wrappedKey][wrappedKey] = func[wrappedKey];
  }
  return func[wrappedKey];
}

function proxy(method) {
  return function() {
    for (var i = 0; i < arguments.length; i++) {
      if (typeof arguments[i] === 'function') {
        arguments[i] = wrap(arguments[i]);
      }
    }
    return method.apply(this, arguments);
  };
}

function proxyClass(OriginalClass, eventNames) {
  if (!eventNames) {
    eventNames = [];
    var instance = new OriginalClass();
    for (var i in instance) {
      if (i.slice(0, 2) === 'on' && instance[i] === null && i.toLowerCase() === i) {
        eventNames.push(i);
      }
    }
  }

  return function() {
    var obj, a = arguments;
    switch (arguments.length) {
      case 0: obj = new OriginalClass(); break;
      case 1: obj = new OriginalClass(a[0]); break;
      case 2: obj = new OriginalClass(a[0], a[1]); break;
      case 3: obj = new OriginalClass(a[0], a[1], a[2]); break;
      case 4: obj = new OriginalClass(a[0], a[1], a[2], a[3]); break;
      default: throw new Error('what are you even doing?');
    }

    eventNames.forEach(function(property) {
      var eventName = property.slice(2);
      var handler;

      Object.defineProperty(obj, property, {
        enumerable: true,
        configurable: true,
        set: function(value) {
          if (handler) {
            this.removeEventListener(eventName, wrap(handler));
          }
          handler = value;
          if (handler) {
            this.addEventListener(eventName, wrap(handler));
          }
        },
        get: function() {
          return handler;
        }
      });
    });

    return obj;
  };
}


function patch() {
  patched = true;
  window.setTimeout = patches.setTimeout;
  window.setInterval = patches.setInterval;
  window.requestAnimationFrame = patches.requestAnimationFrame;
  EventTarget.prototype.addEventListener = patches.addEventListener;
  EventTarget.prototype.removeEventListener = patches.removeEventListener;
  Promise.prototype.then = patches.then;
  Promise.prototype.catch = patches.catch;
  document.registerElement = patches.registerElement;
  window.WebSocket = patches.WebSocket;
}


function unpatch() {
  window.setTimeout = originals.setTimeout;
  window.setInterval = originals.setInterval;
  window.requestAnimationFrame = originals.requestAnimationFrame;
  EventTarget.prototype.addEventListener = originals.addEventListener;
  EventTarget.prototype.removeEventListener = originals.removeEventListener;
  Promise.prototype.then = originals.then;
  Promise.prototype.catch = originals.catch;
  document.registerElement = originals.registerElement;
  window.WebSocket = originals.WebSocket;
  patched = false;
}


var originals = {
  setTimeout: window.setTimeout,
  setInterval: window.setInterval,
  requestAnimationFrame: window.requestAnimationFrame,
  addEventListener: EventTarget.prototype.addEventListener,
  removeEventListener: EventTarget.prototype.removeEventListener,
  then: Promise.prototype.then,
  catch: Promise.prototype.catch,
  registerElement: document.registerElement,
  XMLHttpRequest: window.XMLHttpRequest,
  WebSocket: window.WebSocket
};


var patches = {
  setTimeout: proxy(originals.setTimeout),
  setInterval: proxy(originals.setInterval),
  requestAnimationFrame: proxy(originals.requestAnimationFrame),
  addEventListener: proxy(originals.addEventListener),
  removeEventListener: proxy(originals.removeEventListener),
  then: proxy(originals.then),
  catch: proxy(originals.catch),
  XMLHttpRequest: proxyClass(originals.XMLHttpRequest),
  WebSocket: proxyClass(originals.WebSocket, ['onmessage'])
};

},{"./observer":14}],12:[function(require,module,exports){
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
    // Shortcut out for values that are exactly equal
    if (value === oldValue) return false;

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





  var EDIT_LEAVE = 0;
  var EDIT_UPDATE = 1;
  var EDIT_ADD = 2;
  var EDIT_DELETE = 3;


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
      var min;

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

},{}],13:[function(require,module,exports){
module.exports = exports = require('./observer');
exports.context = require('./context');
exports.expressions = require('expressions-js');
exports.expressions.diff = require('./diff');

},{"./context":11,"./diff":12,"./observer":14,"expressions-js":1}],14:[function(require,module,exports){
module.exports = Observer;
var expressions = require('expressions-js');
var diff = require('./diff');
var fragmentsContext = require('./context');
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
    this.getter = expressions.parse(expr, Observer.globals, Observer.formatters);
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
    Observer.remove(this);
    this.context = null;
  },

  // Closes the observer, cleaning up any possible memory-leaks
  close: function() {
    this.unbind();
    this.callback = null;
    this.callbackContext = null;
  },

  // Returns the current value of this observer
  get: function() {
    if (this.context) {
      return this.getter.call(this.context);
    }
  },

  // Sets the value of this expression
  set: function(value) {
    if (!this.context) return;
    if (this.setter === false) return;
    if (!this.setter) {
      try {
        this.setter = typeof this.expr === 'string'
          ? expressions.parseSetter(this.expr, Observer.globals, Observer.formatters)
          : false;
      } catch (e) {
        this.setter = false;
      }
      if (!this.setter) return;
    }

    try {
      var result = this.setter.call(this.context, value);
    } catch(e) {
      return;
    }

    // We can't expect code in fragments outside Observer to be aware of "sync" since observer can be replaced by other
    // types (e.g. one without a `sync()` method, such as one that uses `Object.observe`) in other systems.
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
        this.callback.call(this.callbackContext, value, this.oldValue, changed);
      } else {
        this.callback.call(this.callbackContext, value, this.oldValue);
      }
    }

    if (this.getChangeRecords) {
      // Store an immutable version of the value, allowing for arrays and objects to change instance but not content and
      // still refrain from dispatching callbacks (e.g. when using an object in bind-class or when using array formatters
      // in bind-each)
      this.oldValue = diff.clone(value);
    } else {
      this.oldValue = value;
    }
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
  if (!skipUpdate) {
    observer.forceUpdateNextSync = true;
    observer.sync();
  }
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
Observer.callbacksRunning = false;
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

  fragmentsContext.skipNextSync();
  fragmentsContext.run(function() {
    var i, l;

    // Allow callbacks to run the sync cycle again immediately, but stop at `Observer.max` (default 10) cycles to we don't
    // run infinite loops
    while (Observer.rerun) {
      if (++Observer.cycles === Observer.max) {
        throw new Error('Infinite observer syncing, an observer is calling Observer.sync() too many times');
      }
      Observer.rerun = false;
      // the observer array may increase or decrease in size (remaining observers) during the sync
      for (i = 0; i < Observer.observers.length; i++) {
        Observer.observers[i].sync();
      }
    }

    Observer.callbacksRunning = true;

    var callbacks = Observer.callbacks;
    Observer.callbacks = [];
    while (callbacks.length) {
      callbacks.shift()();
    }

    for (i = 0, l = Observer.listeners.length; i < l; i++) {
      var listener = Observer.listeners[i];
      listener();
    }

    Observer.callbacksRunning = false;
  });

  Observer.syncing = false;
  Observer.cycles = 0;
  return true;
};

// After the next sync (or the current if in the middle of one), run the provided callback
Observer.afterSync = function(callback) {
  if (typeof callback !== 'function') {
    throw new TypeError('callback must be a function');
  }
  if (Observer.callbacksRunning) {
    Observer.sync();
  }
  Observer.callbacks.push(callback);
};

Observer.onSync = function(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('listener must be a function');
  }
  Observer.listeners.push(listener);
};

Observer.removeOnSync = function(listener) {
  if (typeof listener !== 'function') {
    throw new TypeError('listener must be a function');
  }
  var index = Observer.listeners.indexOf(listener);
  if (index !== -1) {
    Observer.listeners.splice(index, 1).pop();
  }
};

},{"./context":11,"./diff":12,"expressions-js":1}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
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
      /*eslint-disable no-console */
      console.info('Debug:', this.expression, '=', value);
      /*eslint-enable */
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
   * When working with a bound class attribute, make sure it doesn't stop on class-* attributes.
   */
  fragments.registerAttribute('class', {
    onlyWhenBound: true,
    updated: function(value) {
      var classList = this.element.classList;
      if (this.classes) {
        this.classes.forEach(function(className) {
          if (className) {
            classList.remove(className);
          }
        });
      }
      if (value) {
        this.classes = value.split(/\s+/);
        this.classes.forEach(function(className) {
          if (className) {
            classList.add(className);
          }
        });
      }
    }
  });


  /**
   * Automatically focuses the input when it is displayed on screen.
   */
  fragments.registerAttribute('autofocus', {
    bound: function() {
      var element = this.element;
      setTimeout(function() {
        element.focus();
      });
    }
  });


  /**
   * Automatically selects the contents of an input when it receives focus.
   */
  fragments.registerAttribute('autoselect', {
    created: function() {
      var focused, mouseEvent;

      this.element.addEventListener('mousedown', function() {
        // Use matches since document.activeElement doesn't work well with web components (future compat)
        focused = this.matches(':focus');
        mouseEvent = true;
      });

      this.element.addEventListener('focus', function() {
        if (!mouseEvent) {
          this.select();
        }
      });

      this.element.addEventListener('mouseup', function() {
        if (!focused) {
          this.select();
        }
        mouseEvent = false;
      });
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
      set: function() {}
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
          _this.setEvent(event, priorEvent, priorElement);

          // Let an on-[event] make the function call with its own arguments
          var listener = _this.observer.get();

          // Or just return a function which will be called with the event object
          if (typeof listener === 'function') listener.call(_this.context, event);

          // Reset the context to its prior state
          _this.clearEvent();
        }
      });
    },

    unbound: function() {
      this.clearEvent();
    },

    setEvent: function(event, priorEventDescriptor, priorElementDescriptor) {
      if (!this.context) {
        return;
      }
      this.event = event;
      this.priorEventDescriptor = priorEventDescriptor;
      this.priorElementDescriptor = priorElementDescriptor;
      this.lastContext = this.context;

      this.context.event = event;
      this.context.element = this.element;
    },

    clearEvent: function() {
      if (!this.event) {
        return;
      }
      var context = this.lastContext;

      if (this.priorEventDescriptor) {
        Object.defineProperty(context, 'event', this.priorEventDescriptor);
        this.priorEventDescriptor = null;
      } else {
        delete context.event;
      }

      if (this.priorElementDescriptor) {
        Object.defineProperty(context, 'element', this.priorElementDescriptor);
        this.priorElementDescriptor = null;
      } else {
        delete context.element;
      }

      this.event = null;
      this.lastContext = null;
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
    });
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
   * Shows/hides an element conditionally. `if` should be used in most cases as it removes the element completely and is
   * more effecient since bindings within the `if` are not active while it is hidden. Use `show` for when the element
   * must remain in-DOM or bindings within it must continue to be processed while it is hidden. You should default to
   * using `if`.
   */
  fragments.registerAttribute('show', {
    animated: true,
    updated: function(value) {
      // For performance provide an alternate code path for animation
      if (this.animate && this.context) {
        this.updatedAnimated(value);
      } else {
        this.updatedRegular(value);
      }
    },

    updatedRegular: function(value) {
      if (value) {
        this.element.style.display = '';
      } else {
        this.element.style.display = 'none';
      }
    },

    updatedAnimated: function(value) {
      this.lastValue = value;
      if (this.animating) {
        return;
      }

      this.animating = true;
      function onFinish() {
        this.animating = false;
        if (this.lastValue !== value) {
          this.updatedAnimated(this.lastValue);
        }
      }

      if (value) {
        this.element.style.display = '';
        this.animateIn(this.element, onFinish);
      } else {
        this.animateOut(this.element, function() {
          this.element.style.display = 'none';
          onFinish.call(this);
        });
      }
    },

    unbound: function() {
      this.element.style.display = '';
      this.lastValue = null;
      this.animating = false;
    }
  });


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
    priority: 150,
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
      if (this.animate && this.context && !this.firstUpdate) {
        this.updatedAnimated(index);
      } else {
        this.updatedRegular(index);
      }
      this.firstUpdate = false;
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

    bound: function() {
      this.firstUpdate = true;
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
    if (isUnless) {
      return '!(' + expr + ')';
    } else {
      return expr;
    }
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
          var view = this.createView(i, item);
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

},{"../observer/diff":12}],17:[function(require,module,exports){
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
    /*eslint-disable no-console */
    console.log(prefix, value);
    /*eslint-enable */
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
      sortFunc = function(a, b) {
        if (a[prop] > b[prop]) return dir;
        if (a[prop] < b[prop]) return -dir;
        return 0;
      };
    } else if (dir === -1) {
      var origFunc = sortFunc;
      sortFunc = function(a, b) { return -origFunc(a, b); };
    }

    return value.slice().sort(sortFunc.bind(this));
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


  var div = document.createElement('div');
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
  var wwwExp = /(^|[^\/])(www\.[\S]+\.\w{2,}(\b|$))/gim;
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
      var replacedText = match.replace(urlExp, '$1<a href="$2"' + target + '>$2</a>');
      return replacedText.replace(wwwExp, '$1<a href="http://$2"' + target + '>$2</a>');
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

},{}],18:[function(require,module,exports){
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

},{"./util/extend":20,"./view":23}],19:[function(require,module,exports){
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

  var element = this;
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
    return key + transitionOptions;
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

},{}],20:[function(require,module,exports){
var global = (function() { return this; })();
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

},{}],21:[function(require,module,exports){



// Polyfill matches
if (!Element.prototype.matches) {
  Element.prototype.matches =
    Element.prototype.matchesSelector ||
    Element.prototype.webkitMatchesSelector ||
    Element.prototype.mozMatchesSelector ||
    Element.prototype.msMatchesSelector ||
    Element.prototype.oMatchesSelector;
}

// Polyfill closest
if (!Element.prototype.closest) {
  Element.prototype.closest = function closest(selector) {
    var element = this;
    do {
      if (element.matches(selector)) {
        return element;
      }
    } while ((element = element.parentNode) && element.nodeType === Node.ELEMENT_NODE);
    return null;
  };
}

},{}],22:[function(require,module,exports){
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
var stringToFragment = function(string) {
  if (!string) {
    var fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode(''));
    return fragment;
  }
  var templateElement;
  templateElement = document.createElement('template');
  templateElement.innerHTML = string;
  return templateElement.content;
};

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
      var fragment;
      if (!string) {
        fragment = document.createDocumentFragment();
        fragment.appendChild(document.createTextNode(''));
        return fragment;
      }
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
      fragment = document.createDocumentFragment();
      while (div.firstChild) {
        fragment.appendChild(div.firstChild);
      }
      return fragment;
    };
  })();
}

},{}],23:[function(require,module,exports){
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

},{}]},{},[6])(6)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIuLi9leHByZXNzaW9ucy1qcy9pbmRleC5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9leHByZXNzaW9ucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9mb3JtYXR0ZXJzLmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL3Byb3BlcnR5LWNoYWlucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9zdHJpbmdzLmpzIiwiaW5kZXguanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvY29udGV4dC5qcyIsInNyYy9vYnNlcnZlci9kaWZmLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvcG9seWZpbGxzLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqT0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDektBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3bEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzFZQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0pBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaFFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3IrQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDclpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQSIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IHJlcXVpcmUoJy4vc3JjL2V4cHJlc3Npb25zJyk7XG4iLCJ2YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG52YXIgc3RyaW5ncyA9IHJlcXVpcmUoJy4vc3RyaW5ncycpO1xudmFyIGZvcm1hdHRlclBhcnNlciA9IHJlcXVpcmUoJy4vZm9ybWF0dGVycycpO1xudmFyIHByb3BlcnR5Q2hhaW5zID0gcmVxdWlyZSgnLi9wcm9wZXJ0eS1jaGFpbnMnKTtcbnZhciB2YWx1ZVByb3BlcnR5ID0gJ192YWx1ZV8nO1xudmFyIGNhY2hlID0ge307XG5cbmV4cG9ydHMuZ2xvYmFscyA9IHt9O1xuXG5cbmV4cG9ydHMucGFyc2UgPSBmdW5jdGlvbihleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGV4dHJhQXJncykpIGV4dHJhQXJncyA9IFtdO1xuICB2YXIgY2FjaGVLZXkgPSBleHByICsgJ3wnICsgZXh0cmFBcmdzLmpvaW4oJywnKTtcbiAgLy8gUmV0dXJucyB0aGUgY2FjaGVkIGZ1bmN0aW9uIGZvciB0aGlzIGV4cHJlc3Npb24gaWYgaXQgZXhpc3RzLlxuICB2YXIgZnVuYyA9IGNhY2hlW2NhY2hlS2V5XTtcbiAgaWYgKGZ1bmMpIHtcbiAgICByZXR1cm4gZnVuYztcbiAgfVxuXG4gIHZhciBvcmlnaW5hbCA9IGV4cHI7XG4gIHZhciBpc1NldHRlciA9IChleHRyYUFyZ3NbMF0gPT09IHZhbHVlUHJvcGVydHkpO1xuICAvLyBBbGxvdyAnIXByb3AnIHRvIGJlY29tZSAncHJvcCA9ICF2YWx1ZSdcbiAgaWYgKGlzU2V0dGVyICYmIGV4cHIuY2hhckF0KDApID09PSAnIScpIHtcbiAgICBleHByID0gZXhwci5zbGljZSgxKTtcbiAgICB2YWx1ZVByb3BlcnR5ID0gJyEnICsgdmFsdWVQcm9wZXJ0eTtcbiAgfVxuXG4gIGV4cHIgPSBzdHJpbmdzLnB1bGxPdXRTdHJpbmdzKGV4cHIpO1xuICBleHByID0gZm9ybWF0dGVyUGFyc2VyLnBhcnNlRm9ybWF0dGVycyhleHByKTtcbiAgZXhwciA9IHByb3BlcnR5Q2hhaW5zLnBhcnNlRXhwcmVzc2lvbihleHByLCBnZXRWYXJpYWJsZXMoZ2xvYmFscywgZXh0cmFBcmdzKSk7XG4gIGlmICghaXNTZXR0ZXIpIHtcbiAgICB2YXIgbGluZXMgPSBleHByLnNwbGl0KCdcXG4nKTtcbiAgICBsaW5lc1tsaW5lcy5sZW5ndGggLSAxXSA9ICdyZXR1cm4gJyArIGxpbmVzW2xpbmVzLmxlbmd0aCAtIDFdO1xuICAgIGV4cHIgPSBsaW5lcy5qb2luKCdcXG4nKTtcbiAgfVxuICBleHByID0gc3RyaW5ncy5wdXRJblN0cmluZ3MoZXhwcik7XG4gIGZ1bmMgPSBjb21waWxlRXhwcmVzc2lvbihvcmlnaW5hbCwgZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKTtcbiAgZnVuYy5leHByID0gZXhwcjtcbiAgY2FjaGVbY2FjaGVLZXldID0gZnVuYztcbiAgcmV0dXJuIGZ1bmM7XG59O1xuXG5cbmV4cG9ydHMucGFyc2VTZXR0ZXIgPSBmdW5jdGlvbihleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGV4dHJhQXJncykpIGV4dHJhQXJncyA9IFtdO1xuXG4gIC8vIEFkZCBfdmFsdWVfIGFzIHRoZSBmaXJzdCBleHRyYSBhcmd1bWVudFxuICBleHRyYUFyZ3MudW5zaGlmdCh2YWx1ZVByb3BlcnR5KTtcbiAgZXhwciA9IGV4cHIucmVwbGFjZSgvKFxccypcXHx8JCkvLCAnID0gX3ZhbHVlXyQxJyk7XG5cbiAgcmV0dXJuIGV4cG9ydHMucGFyc2UoZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKTtcbn07XG5cblxuZnVuY3Rpb24gZ2V0VmFyaWFibGVzKGdsb2JhbHMsIGV4dHJhQXJncykge1xuICB2YXIgdmFyaWFibGVzID0ge307XG5cbiAgT2JqZWN0LmtleXMoZXhwb3J0cy5nbG9iYWxzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIHZhcmlhYmxlc1trZXldID0gZXhwb3J0cy5nbG9iYWxzW2tleV07XG4gIH0pO1xuXG4gIGlmIChnbG9iYWxzKSB7XG4gICAgT2JqZWN0LmtleXMoZ2xvYmFscykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgIHZhcmlhYmxlc1trZXldID0gZ2xvYmFsc1trZXldO1xuICAgIH0pO1xuICB9XG5cbiAgZXh0cmFBcmdzLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgdmFyaWFibGVzW2tleV0gPSBudWxsO1xuICB9KTtcblxuICByZXR1cm4gdmFyaWFibGVzO1xufVxuXG5cblxuZnVuY3Rpb24gY29tcGlsZUV4cHJlc3Npb24ob3JpZ2luYWwsIGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICB2YXIgZnVuYywgYXJncyA9IFsnX2dsb2JhbHNfJywgJ19mb3JtYXR0ZXJzXyddLmNvbmNhdChleHRyYUFyZ3MpLmNvbmNhdChleHByKTtcblxuICB0cnkge1xuICAgIGZ1bmMgPSBGdW5jdGlvbi5hcHBseShudWxsLCBhcmdzKTtcbiAgfSBjYXRjaCAoZSkge1xuICAgIC8vIFRocm93cyBhbiBlcnJvciBpZiB0aGUgZXhwcmVzc2lvbiB3YXMgbm90IHZhbGlkIEphdmFTY3JpcHRcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0JhZCBleHByZXNzaW9uOiAnICsgb3JpZ2luYWwgKyAnXFxuJyArICdDb21waWxlZCBleHByZXNzaW9uOlxcbicgKyBleHByICsgJ1xcbicgKyBlLm1lc3NhZ2UpO1xuICB9XG5cbiAgcmV0dXJuIGJpbmRBcmd1bWVudHMoZnVuYywgZ2xvYmFscywgZm9ybWF0dGVycyk7XG59XG5cblxuLy8gYSBjdXN0b20gXCJiaW5kXCIgZnVuY3Rpb24gdG8gYmluZCBhcmd1bWVudHMgdG8gYSBmdW5jdGlvbiB3aXRob3V0IGJpbmRpbmcgdGhlIGNvbnRleHRcbmZ1bmN0aW9uIGJpbmRBcmd1bWVudHMoZnVuYykge1xuICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBmdW5jLmFwcGx5KHRoaXMsIGFyZ3MuY29uY2F0KHNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICB9XG59XG4iLCJcbi8vIGZpbmRzIHBpcGVzIHRoYXQgYXJlIG5vdCBPUnMgKGkuZS4gYCB8IGAgbm90IGAgfHwgYCkgZm9yIGZvcm1hdHRlcnNcbnZhciBwaXBlUmVnZXggPSAvXFx8KFxcfCk/L2c7XG5cbi8vIEEgc3RyaW5nIHRoYXQgd291bGQgbm90IGFwcGVhciBpbiB2YWxpZCBKYXZhU2NyaXB0XG52YXIgcGxhY2Vob2xkZXIgPSAnQEBAJztcbnZhciBwbGFjZWhvbGRlclJlZ2V4ID0gbmV3IFJlZ0V4cCgnXFxcXHMqJyArIHBsYWNlaG9sZGVyICsgJ1xcXFxzKicpO1xuXG4vLyBkZXRlcm1pbmVzIHdoZXRoZXIgYW4gZXhwcmVzc2lvbiBpcyBhIHNldHRlciBvciBnZXR0ZXIgKGBuYW1lYCB2cyBgbmFtZSA9ICdib2InYClcbnZhciBzZXR0ZXJSZWdleCA9IC9cXHM9XFxzLztcblxuLy8gZmluZHMgdGhlIHBhcnRzIG9mIGEgZm9ybWF0dGVyLCBuYW1lIGFuZCBhcmdzIChlLmcuIGBmb28oYmFyKWApXG52YXIgZm9ybWF0dGVyUmVnZXggPSAvXihbXlxcKF0rKSg/OlxcKCguKilcXCkpPyQvO1xuXG4vLyBmaW5kcyBhcmd1bWVudCBzZXBhcmF0b3JzIGZvciBmb3JtYXR0ZXJzIChgYXJnMSwgYXJnMmApXG52YXIgYXJnU2VwYXJhdG9yID0gL1xccyosXFxzKi9nO1xuXG5cbi8qKlxuICogRmluZHMgdGhlIGZvcm1hdHRlcnMgd2l0aGluIGFuIGV4cHJlc3Npb24gYW5kIGNvbnZlcnRzIHRoZW0gdG8gdGhlIGNvcnJlY3QgSmF2YVNjcmlwdCBlcXVpdmFsZW50LlxuICovXG5leHBvcnRzLnBhcnNlRm9ybWF0dGVycyA9IGZ1bmN0aW9uKGV4cHIpIHtcbiAgLy8gQ29udmVydHMgYG5hbWUgfCB1cHBlciB8IGZvbyhiYXIpYCBpbnRvIGBuYW1lIEBAQCB1cHBlciBAQEAgZm9vKGJhcilgXG4gIGV4cHIgPSBleHByLnJlcGxhY2UocGlwZVJlZ2V4LCBmdW5jdGlvbihtYXRjaCwgb3JJbmRpY2F0b3IpIHtcbiAgICBpZiAob3JJbmRpY2F0b3IpIHJldHVybiBtYXRjaDtcbiAgICByZXR1cm4gcGxhY2Vob2xkZXI7XG4gIH0pO1xuXG4gIC8vIHNwbGl0cyB0aGUgc3RyaW5nIGJ5IFwiQEBAXCIsIHB1bGxzIG9mIHRoZSBmaXJzdCBhcyB0aGUgZXhwciwgdGhlIHJlbWFpbmluZyBhcmUgZm9ybWF0dGVyc1xuICBmb3JtYXR0ZXJzID0gZXhwci5zcGxpdChwbGFjZWhvbGRlclJlZ2V4KTtcbiAgZXhwciA9IGZvcm1hdHRlcnMuc2hpZnQoKTtcbiAgaWYgKCFmb3JtYXR0ZXJzLmxlbmd0aCkgcmV0dXJuIGV4cHI7XG5cbiAgLy8gUHJvY2Vzc2VzIHRoZSBmb3JtYXR0ZXJzXG4gIC8vIElmIHRoZSBleHByZXNzaW9uIGlzIGEgc2V0dGVyIHRoZSB2YWx1ZSB3aWxsIGJlIHJ1biB0aHJvdWdoIHRoZSBmb3JtYXR0ZXJzXG4gIHZhciBzZXR0ZXIgPSAnJztcbiAgdmFyIHZhbHVlID0gZXhwcjtcblxuICBpZiAoc2V0dGVyUmVnZXgudGVzdChleHByKSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoc2V0dGVyUmVnZXgpO1xuICAgIHNldHRlciA9IHBhcnRzWzBdICsgJyA9ICc7XG4gICAgdmFsdWUgPSBwYXJ0c1sxXTtcbiAgfVxuXG4gIC8vIFByb2Nlc3NlcyB0aGUgZm9ybWF0dGVyc1xuICBmb3JtYXR0ZXJzLmZvckVhY2goZnVuY3Rpb24oZm9ybWF0dGVyKSB7XG4gICAgdmFyIG1hdGNoID0gZm9ybWF0dGVyLnRyaW0oKS5tYXRjaChmb3JtYXR0ZXJSZWdleCk7XG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Zvcm1hdHRlciBpcyBpbnZhbGlkOiAnICsgZm9ybWF0dGVyKTtcbiAgICB9XG5cbiAgICB2YXIgZm9ybWF0dGVyTmFtZSA9IG1hdGNoWzFdO1xuICAgIHZhciBhcmdzID0gbWF0Y2hbMl0gPyBtYXRjaFsyXS5zcGxpdChhcmdTZXBhcmF0b3IpIDogW107XG5cbiAgICAvLyBBZGQgdGhlIHByZXZpb3VzIHZhbHVlIGFzIHRoZSBmaXJzdCBhcmd1bWVudFxuICAgIGFyZ3MudW5zaGlmdCh2YWx1ZSk7XG5cbiAgICAvLyBJZiB0aGlzIGlzIGEgc2V0dGVyIGV4cHIsIGJlIHN1cmUgdG8gYWRkIHRoZSBgaXNTZXR0ZXJgIGZsYWcgYXQgdGhlIGVuZCBvZiB0aGUgZm9ybWF0dGVyJ3MgYXJndW1lbnRzXG4gICAgaWYgKHNldHRlcikge1xuICAgICAgYXJncy5wdXNoKHRydWUpO1xuICAgIH1cblxuICAgIC8vIFNldCB0aGUgdmFsdWUgdG8gYmVjb21lIHRoZSByZXN1bHQgb2YgdGhpcyBmb3JtYXR0ZXIsIHNvIHRoZSBuZXh0IGZvcm1hdHRlciBjYW4gd3JhcCBpdC5cbiAgICAvLyBDYWxsIGZvcm1hdHRlcnMgaW4gdGhlIGN1cnJlbnQgY29udGV4dC5cbiAgICB2YWx1ZSA9ICdfZm9ybWF0dGVyc18uJyArIGZvcm1hdHRlck5hbWUgKyAnLmNhbGwodGhpcywgJyArIGFyZ3Muam9pbignLCAnKSArICcpJztcbiAgfSk7XG5cbiAgcmV0dXJuIHNldHRlciArIHZhbHVlO1xufTtcbiIsInZhciByZWZlcmVuY2VDb3VudCA9IDA7XG52YXIgY3VycmVudFJlZmVyZW5jZSA9IDA7XG52YXIgY3VycmVudEluZGV4ID0gMDtcbnZhciBmaW5pc2hlZENoYWluID0gZmFsc2U7XG52YXIgY29udGludWF0aW9uID0gZmFsc2U7XG52YXIgZ2xvYmFscyA9IG51bGw7XG52YXIgZGVmYXVsdEdsb2JhbHMgPSB7XG4gIHJldHVybjogbnVsbCxcbiAgdHJ1ZTogbnVsbCxcbiAgZmFsc2U6IG51bGwsXG4gIHVuZGVmaW5lZDogbnVsbCxcbiAgbnVsbDogbnVsbCxcbiAgdGhpczogbnVsbCxcbiAgd2luZG93OiBudWxsLFxuICBNYXRoOiBudWxsLFxuICBwYXJzZUludDogbnVsbCxcbiAgcGFyc2VGbG9hdDogbnVsbCxcbiAgaXNOYU46IG51bGwsXG4gIEFycmF5OiBudWxsLFxuICB0eXBlb2Y6IG51bGwsXG4gIF9nbG9iYWxzXzogbnVsbCxcbiAgX2Zvcm1hdHRlcnNfOiBudWxsLFxuICBfdmFsdWVfOiBudWxsLFxufTtcblxuXG4vLyBtYXRjaGVzIHByb3BlcnR5IGNoYWlucyAoZS5nLiBgbmFtZWAsIGB1c2VyLm5hbWVgLCBhbmQgYHVzZXIuZnVsbE5hbWUoKS5jYXBpdGFsaXplKClgKVxudmFyIHByb3BlcnR5UmVnZXggPSAvKChcXHt8LHxcXC4pP1xccyopKFthLXokX1xcJF0oPzpbYS16X1xcJDAtOVxcLi1dfFxcW1snXCJcXGRdK1xcXSkqKShcXHMqKDp8XFwofFxcWyk/KXwoXFxbKS9naTtcbi8qKlxuICogQnJva2VuIGRvd25cbiAqXG4gKiAoKFxce3wsfFxcLik/XFxzKilcbiAqIHByZWZpeDogbWF0Y2hlcyBvbiBvYmplY3QgbGl0ZXJhbHMgc28gd2UgY2FuIHNraXAgKGluIGB7IGZvbzogYmFyIH1gIFwiZm9vXCIgaXMgbm90IGEgcHJvcGVydHkpLiBBbHNvIHBpY2tzIHVwIG9uXG4gKiB1bmZpbmlzaGVkIGNoYWlucyB0aGF0IGhhZCBmdW5jdGlvbiBjYWxscyBvciBicmFja2V0cyB3ZSBjb3VsZG4ndCBmaW5pc2ggc3VjaCBhcyB0aGUgZG90IGluIGAudGVzdGAgYWZ0ZXIgdGhlIGNoYWluXG4gKiBgZm9vLmJhcigpLnRlc3RgLlxuICpcbiAqIChbYS16JF9cXCRdKD86W2Etel9cXCQwLTlcXC4tXXxcXFtbJ1wiXFxkXStcXF0pKilcbiAqIHByb3BlcnR5IGNoYWluOiBtYXRjaGVzIHByb3BlcnR5IGNoYWlucyBzdWNoIGFzIHRoZSBmb2xsb3dpbmcgKHN0cmluZ3MnIGNvbnRlbnRzIGFyZSByZW1vdmVkIGF0IHRoaXMgc3RlcClcbiAqICAgYGZvbywgZm9vLmJhciwgZm9vLmJhclswXSwgZm9vLmJhclswXS50ZXN0LCBmb28uYmFyWycnXS50ZXN0YFxuICogICBEb2VzIG5vdCBtYXRjaCB0aHJvdWdoIGZ1bmN0aW9ucyBjYWxscyBvciB0aHJvdWdoIGJyYWNrZXRzIHdoaWNoIGNvbnRhaW4gdmFyaWFibGVzLlxuICogICBgZm9vLmJhcigpLnRlc3QsIGZvby5iYXJbcHJvcF0udGVzdGBcbiAqICAgSW4gdGhlc2UgY2FzZXMgaXQgd291bGQgb25seSBtYXRjaCBgZm9vLmJhcmAsIGAudGVzdGAsIGFuZCBgcHJvcGBcbiAqXG4gKiAoXFxzKig6fFxcKHxcXFspPylcbiAqIHBvc3RmaXg6IG1hdGNoZXMgdHJhaWxpbmcgY2hhcmFjdGVycyB0byBkZXRlcm1pbmUgaWYgdGhpcyBpcyBhbiBvYmplY3QgcHJvcGVydHkgb3IgYSBmdW5jdGlvbiBjYWxsIGV0Yy4gV2lsbCBtYXRjaFxuICogdGhlIGNvbG9uIGFmdGVyIFwiZm9vXCIgaW4gYHsgZm9vOiAnYmFyJyB9YCwgdGhlIGZpcnN0IHBhcmVudGhlc2lzIGluIGBvYmouZm9vKGJhcilgLCB0aGUgdGhlIGZpcnN0IGJyYWNrZXQgaW5cbiAqIGBmb29bYmFyXWAuXG4gKi9cblxuLy8gbGlua3MgaW4gYSBwcm9wZXJ0eSBjaGFpblxudmFyIGNoYWluTGlua3NSZWdleCA9IC9cXC58XFxbL2c7XG5cbi8vIHRoZSBwcm9wZXJ0eSBuYW1lIHBhcnQgb2YgbGlua3NcbnZhciBjaGFpbkxpbmtSZWdleCA9IC9cXC58XFxbfFxcKC87XG5cbnZhciBhbmRSZWdleCA9IC8gYW5kIC9nO1xudmFyIG9yUmVnZXggPSAvIG9yIC9nO1xuXG5cbmV4cG9ydHMucGFyc2VFeHByZXNzaW9uID0gZnVuY3Rpb24oZXhwciwgX2dsb2JhbHMpIHtcbiAgLy8gUmVzZXQgYWxsIHZhbHVlc1xuICByZWZlcmVuY2VDb3VudCA9IDA7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSAwO1xuICBjdXJyZW50SW5kZXggPSAwO1xuICBmaW5pc2hlZENoYWluID0gZmFsc2U7XG4gIGNvbnRpbnVhdGlvbiA9IGZhbHNlO1xuICBnbG9iYWxzID0gX2dsb2JhbHM7XG5cbiAgZXhwciA9IHJlcGxhY2VBbmRzQW5kT3JzKGV4cHIpO1xuICBpZiAoZXhwci5pbmRleE9mKCcgPSAnKSAhPT0gLTEpIHtcbiAgICB2YXIgcGFydHMgPSBleHByLnNwbGl0KCcgPSAnKTtcbiAgICB2YXIgc2V0dGVyID0gcGFydHNbMF07XG4gICAgdmFyIHZhbHVlID0gcGFydHNbMV07XG4gICAgc2V0dGVyID0gcGFyc2VQcm9wZXJ0eUNoYWlucyhzZXR0ZXIpLnJlcGxhY2UoL15cXCh8XFwpJC9nLCAnJyk7XG4gICAgdmFsdWUgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKHZhbHVlKTtcbiAgICBleHByID0gc2V0dGVyICsgJyA9ICcgKyB2YWx1ZTtcbiAgfSBlbHNlIHtcbiAgICBleHByID0gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKTtcbiAgfVxuICBleHByID0gYWRkUmVmZXJlbmNlcyhleHByKVxuXG4gIC8vIFJlc2V0IGFmdGVyIHBhcnNlIGlzIGRvbmVcbiAgZ2xvYmFscyA9IG51bGw7XG5cbiAgcmV0dXJuIGV4cHI7XG59O1xuXG5cbi8qKlxuICogRmluZHMgYW5kIHBhcnNlcyB0aGUgcHJvcGVydHkgY2hhaW5zIGluIGFuIGV4cHJlc3Npb24uXG4gKi9cbmZ1bmN0aW9uIHBhcnNlUHJvcGVydHlDaGFpbnMoZXhwcikge1xuICB2YXIgcGFyc2VkRXhwciA9ICcnLCBjaGFpbjtcblxuICAvLyBhbGxvdyByZWN1cnNpb24gKGUuZy4gaW50byBmdW5jdGlvbiBhcmdzKSBieSByZXNldHRpbmcgcHJvcGVydHlSZWdleFxuICAvLyBUaGlzIGlzIG1vcmUgZWZmaWNpZW50IHRoYW4gY3JlYXRpbmcgYSBuZXcgcmVnZXggZm9yIGVhY2ggY2hhaW4sIEkgYXNzdW1lXG4gIHZhciBwcmV2Q3VycmVudEluZGV4ID0gY3VycmVudEluZGV4O1xuICB2YXIgcHJldkxhc3RJbmRleCA9IHByb3BlcnR5UmVnZXgubGFzdEluZGV4O1xuXG4gIGN1cnJlbnRJbmRleCA9IDA7XG4gIHByb3BlcnR5UmVnZXgubGFzdEluZGV4ID0gMDtcbiAgd2hpbGUgKChjaGFpbiA9IG5leHRDaGFpbihleHByKSkgIT09IGZhbHNlKSB7XG4gICAgcGFyc2VkRXhwciArPSBjaGFpbjtcbiAgfVxuXG4gIC8vIFJlc2V0IGluZGV4ZXNcbiAgY3VycmVudEluZGV4ID0gcHJldkN1cnJlbnRJbmRleDtcbiAgcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSBwcmV2TGFzdEluZGV4O1xuICByZXR1cm4gcGFyc2VkRXhwcjtcbn07XG5cblxuZnVuY3Rpb24gbmV4dENoYWluKGV4cHIpIHtcbiAgaWYgKGZpbmlzaGVkQ2hhaW4pIHtcbiAgICByZXR1cm4gKGZpbmlzaGVkQ2hhaW4gPSBmYWxzZSk7XG4gIH1cbiAgdmFyIG1hdGNoID0gcHJvcGVydHlSZWdleC5leGVjKGV4cHIpO1xuICBpZiAoIW1hdGNoKSB7XG4gICAgZmluaXNoZWRDaGFpbiA9IHRydWUgLy8gbWFrZSBzdXJlIG5leHQgY2FsbCB3ZSByZXR1cm4gZmFsc2VcbiAgICByZXR1cm4gZXhwci5zbGljZShjdXJyZW50SW5kZXgpO1xuICB9XG5cbiAgLy8gYHByZWZpeGAgaXMgYG9iakluZGljYXRvcmAgd2l0aCB0aGUgd2hpdGVzcGFjZSB0aGF0IG1heSBjb21lIGFmdGVyIGl0LlxuICB2YXIgcHJlZml4ID0gbWF0Y2hbMV07XG5cbiAgLy8gYG9iakluZGljYXRvcmAgaXMgYHtgIG9yIGAsYCBhbmQgbGV0J3MgdXMga25vdyB0aGlzIGlzIGFuIG9iamVjdCBwcm9wZXJ0eVxuICAvLyBuYW1lIChlLmcuIHByb3AgaW4gYHtwcm9wOmZhbHNlfWApLlxuICB2YXIgb2JqSW5kaWNhdG9yID0gbWF0Y2hbMl07XG5cbiAgLy8gYHByb3BDaGFpbmAgaXMgdGhlIGNoYWluIG9mIHByb3BlcnRpZXMgbWF0Y2hlZCAoZS5nLiBgdGhpcy51c2VyLmVtYWlsYCkuXG4gIHZhciBwcm9wQ2hhaW4gPSBtYXRjaFszXTtcblxuICAvLyBgcG9zdGZpeGAgaXMgdGhlIGBjb2xvbk9yUGFyZW5gIHdpdGggd2hpdGVzcGFjZSBiZWZvcmUgaXQuXG4gIHZhciBwb3N0Zml4ID0gbWF0Y2hbNF07XG5cbiAgLy8gYGNvbG9uT3JQYXJlbmAgbWF0Y2hlcyB0aGUgY29sb24gKDopIGFmdGVyIHRoZSBwcm9wZXJ0eSAoaWYgaXQgaXMgYW4gb2JqZWN0KVxuICAvLyBvciBwYXJlbnRoZXNpcyBpZiBpdCBpcyBhIGZ1bmN0aW9uLiBXZSB1c2UgYGNvbG9uT3JQYXJlbmAgYW5kIGBvYmpJbmRpY2F0b3JgXG4gIC8vIHRvIGtub3cgaWYgaXQgaXMgYW4gb2JqZWN0LlxuICB2YXIgY29sb25PclBhcmVuID0gbWF0Y2hbNV07XG5cbiAgbWF0Y2ggPSBtYXRjaFswXTtcblxuICB2YXIgc2tpcHBlZCA9IGV4cHIuc2xpY2UoY3VycmVudEluZGV4LCBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCAtIG1hdGNoLmxlbmd0aCk7XG4gIGN1cnJlbnRJbmRleCA9IHByb3BlcnR5UmVnZXgubGFzdEluZGV4O1xuXG4gIC8vIHNraXBzIG9iamVjdCBrZXlzIGUuZy4gdGVzdCBpbiBge3Rlc3Q6dHJ1ZX1gLlxuICBpZiAob2JqSW5kaWNhdG9yICYmIGNvbG9uT3JQYXJlbiA9PT0gJzonKSB7XG4gICAgcmV0dXJuIHNraXBwZWQgKyBtYXRjaDtcbiAgfVxuXG4gIHJldHVybiBza2lwcGVkICsgcGFyc2VDaGFpbihwcmVmaXgsIHByb3BDaGFpbiwgcG9zdGZpeCwgY29sb25PclBhcmVuLCBleHByKTtcbn1cblxuXG5mdW5jdGlvbiBwYXJzZUNoYWluKHByZWZpeCwgcHJvcENoYWluLCBwb3N0Zml4LCBwYXJlbiwgZXhwcikge1xuICAvLyBjb250aW51YXRpb25zIGFmdGVyIGEgZnVuY3Rpb24gKGUuZy4gYGdldFVzZXIoMTIpLmZpcnN0TmFtZWApLlxuICBjb250aW51YXRpb24gPSBwcmVmaXggPT09ICcuJztcbiAgaWYgKGNvbnRpbnVhdGlvbikge1xuICAgIHByb3BDaGFpbiA9ICcuJyArIHByb3BDaGFpbjtcbiAgICBwcmVmaXggPSAnJztcbiAgfVxuXG4gIHZhciBsaW5rcyA9IHNwbGl0TGlua3MocHJvcENoYWluKTtcbiAgdmFyIG5ld0NoYWluID0gJyc7XG5cbiAgaWYgKGxpbmtzLmxlbmd0aCA9PT0gMSAmJiAhY29udGludWF0aW9uICYmICFwYXJlbikge1xuICAgIGxpbmsgPSBsaW5rc1swXTtcbiAgICBuZXdDaGFpbiA9IGFkZFRoaXNPckdsb2JhbChsaW5rKTtcbiAgfSBlbHNlIHtcbiAgICBpZiAoIWNvbnRpbnVhdGlvbikge1xuICAgICAgbmV3Q2hhaW4gPSAnKCc7XG4gICAgfVxuXG4gICAgbGlua3MuZm9yRWFjaChmdW5jdGlvbihsaW5rLCBpbmRleCkge1xuICAgICAgaWYgKGluZGV4ICE9PSBsaW5rcy5sZW5ndGggLSAxKSB7XG4gICAgICAgIG5ld0NoYWluICs9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAoIXBhcmVuc1twYXJlbl0pIHtcbiAgICAgICAgICBuZXdDaGFpbiArPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluaztcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpZiAoY29udGludWF0aW9uICYmIGluZGV4ID09PSAwKSB7XG4gICAgICAgICAgICBpbmRleCsrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBwb3N0Zml4ID0gcG9zdGZpeC5yZXBsYWNlKHBhcmVuLCAnJyk7XG4gICAgICAgICAgbmV3Q2hhaW4gKz0gcGFyZW4gPT09ICcoJyA/IHBhcnNlRnVuY3Rpb24obGluaywgaW5kZXgsIGV4cHIpIDogcGFyc2VCcmFja2V0cyhsaW5rLCBpbmRleCwgZXhwcik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIGlmIChleHByLmNoYXJBdChwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCkgIT09ICcuJykge1xuICAgICAgbmV3Q2hhaW4gKz0gJyknO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBwcmVmaXggKyBuZXdDaGFpbiArIHBvc3RmaXg7XG59XG5cblxuZnVuY3Rpb24gc3BsaXRMaW5rcyhjaGFpbikge1xuICB2YXIgaW5kZXggPSAwO1xuICB2YXIgcGFydHMgPSBbXTtcbiAgdmFyIG1hdGNoO1xuICB3aGlsZSAobWF0Y2ggPSBjaGFpbkxpbmtzUmVnZXguZXhlYyhjaGFpbikpIHtcbiAgICBpZiAoY2hhaW5MaW5rc1JlZ2V4Lmxhc3RJbmRleCA9PT0gMSkgY29udGludWU7XG4gICAgcGFydHMucHVzaChjaGFpbi5zbGljZShpbmRleCwgY2hhaW5MaW5rc1JlZ2V4Lmxhc3RJbmRleCAtIDEpKTtcbiAgICBpbmRleCA9IGNoYWluTGlua3NSZWdleC5sYXN0SW5kZXggLSAxO1xuICB9XG4gIHBhcnRzLnB1c2goY2hhaW4uc2xpY2UoaW5kZXgpKTtcbiAgcmV0dXJuIHBhcnRzO1xufVxuXG5cbmZ1bmN0aW9uIGFkZFRoaXNPckdsb2JhbChjaGFpbikge1xuICB2YXIgcHJvcCA9IGNoYWluLnNwbGl0KGNoYWluTGlua1JlZ2V4KS5zaGlmdCgpO1xuICBpZiAoZ2xvYmFscy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgIHJldHVybiBnbG9iYWxzW3Byb3BdID09PSBudWxsID8gY2hhaW4gOiAnX2dsb2JhbHNfLicgKyBjaGFpbjtcbiAgfSBlbHNlIGlmIChkZWZhdWx0R2xvYmFscy5oYXNPd25Qcm9wZXJ0eShwcm9wKSkge1xuICAgIHJldHVybiBjaGFpbjtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gJ3RoaXMuJyArIGNoYWluO1xuICB9XG59XG5cblxudmFyIHBhcmVucyA9IHtcbiAgJygnOiAnKScsXG4gICdbJzogJ10nXG59O1xuXG4vLyBIYW5kbGVzIGEgZnVuY3Rpb24gdG8gYmUgY2FsbGVkIGluIGl0cyBjb3JyZWN0IHNjb3BlXG4vLyBGaW5kcyB0aGUgZW5kIG9mIHRoZSBmdW5jdGlvbiBhbmQgcHJvY2Vzc2VzIHRoZSBhcmd1bWVudHNcbmZ1bmN0aW9uIHBhcnNlRnVuY3Rpb24obGluaywgaW5kZXgsIGV4cHIpIHtcbiAgdmFyIGNhbGwgPSBnZXRGdW5jdGlvbkNhbGwoZXhwcik7XG5cbiAgLy8gQWx3YXlzIGNhbGwgZnVuY3Rpb25zIGluIHRoZSBzY29wZSBvZiB0aGUgb2JqZWN0IHRoZXkncmUgYSBtZW1iZXIgb2ZcbiAgaWYgKGluZGV4ID09PSAwKSB7XG4gICAgbGluayA9IGFkZFRoaXNPckdsb2JhbChsaW5rKTtcbiAgfSBlbHNlIHtcbiAgICBsaW5rID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIGxpbms7XG4gIH1cblxuICB2YXIgY2FsbGVkTGluayA9IGxpbmsgKyAnKH5+aW5zaWRlUGFyZW5zfn4pJztcbiAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSA9PT0gJy4nKSB7XG4gICAgY2FsbGVkTGluayA9IHBhcnNlUGFydChjYWxsZWRMaW5rLCBpbmRleClcbiAgfVxuXG4gIGxpbmsgPSAndHlwZW9mICcgKyBsaW5rICsgJyAhPT0gXFwnZnVuY3Rpb25cXCcgPyB2b2lkIDAgOiAnICsgY2FsbGVkTGluaztcbiAgdmFyIGluc2lkZVBhcmVucyA9IGNhbGwuc2xpY2UoMSwgLTEpO1xuXG4gIHZhciByZWYgPSBjdXJyZW50UmVmZXJlbmNlO1xuICBsaW5rID0gbGluay5yZXBsYWNlKCd+fmluc2lkZVBhcmVuc35+JywgcGFyc2VQcm9wZXJ0eUNoYWlucyhpbnNpZGVQYXJlbnMpKTtcbiAgY3VycmVudFJlZmVyZW5jZSA9IHJlZjtcbiAgcmV0dXJuIGxpbms7XG59XG5cbi8vIEhhbmRsZXMgYSBicmFja2V0ZWQgZXhwcmVzc2lvbiB0byBiZSBwYXJzZWRcbmZ1bmN0aW9uIHBhcnNlQnJhY2tldHMobGluaywgaW5kZXgsIGV4cHIpIHtcbiAgdmFyIGNhbGwgPSBnZXRGdW5jdGlvbkNhbGwoZXhwcik7XG4gIHZhciBpbnNpZGVCcmFja2V0cyA9IGNhbGwuc2xpY2UoMSwgLTEpO1xuICB2YXIgZXZhbGVkTGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gIGluZGV4ICs9IDE7XG4gIGxpbmsgPSAnW35+aW5zaWRlQnJhY2tldHN+fl0nO1xuXG4gIGlmIChleHByLmNoYXJBdChwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCkgPT09ICcuJykge1xuICAgIGxpbmsgPSBwYXJzZVBhcnQobGluaywgaW5kZXgpO1xuICB9IGVsc2Uge1xuICAgIGxpbmsgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluaztcbiAgfVxuXG4gIGxpbmsgPSBldmFsZWRMaW5rICsgbGluaztcblxuICB2YXIgcmVmID0gY3VycmVudFJlZmVyZW5jZTtcbiAgbGluayA9IGxpbmsucmVwbGFjZSgnfn5pbnNpZGVCcmFja2V0c35+JywgcGFyc2VQcm9wZXJ0eUNoYWlucyhpbnNpZGVCcmFja2V0cykpO1xuICBjdXJyZW50UmVmZXJlbmNlID0gcmVmO1xuICByZXR1cm4gbGluaztcbn1cblxuXG4vLyByZXR1cm5zIHRoZSBjYWxsIHBhcnQgb2YgYSBmdW5jdGlvbiAoZS5nLiBgdGVzdCgxMjMpYCB3b3VsZCByZXR1cm4gYCgxMjMpYClcbmZ1bmN0aW9uIGdldEZ1bmN0aW9uQ2FsbChleHByKSB7XG4gIHZhciBzdGFydEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG4gIHZhciBvcGVuID0gZXhwci5jaGFyQXQoc3RhcnRJbmRleCAtIDEpO1xuICB2YXIgY2xvc2UgPSBwYXJlbnNbb3Blbl07XG4gIHZhciBlbmRJbmRleCA9IHN0YXJ0SW5kZXggLSAxO1xuICB2YXIgcGFyZW5Db3VudCA9IDE7XG4gIHdoaWxlIChlbmRJbmRleCsrIDwgZXhwci5sZW5ndGgpIHtcbiAgICB2YXIgY2ggPSBleHByLmNoYXJBdChlbmRJbmRleCk7XG4gICAgaWYgKGNoID09PSBvcGVuKSBwYXJlbkNvdW50Kys7XG4gICAgZWxzZSBpZiAoY2ggPT09IGNsb3NlKSBwYXJlbkNvdW50LS07XG4gICAgaWYgKHBhcmVuQ291bnQgPT09IDApIGJyZWFrO1xuICB9XG4gIGN1cnJlbnRJbmRleCA9IHByb3BlcnR5UmVnZXgubGFzdEluZGV4ID0gZW5kSW5kZXggKyAxO1xuICByZXR1cm4gb3BlbiArIGV4cHIuc2xpY2Uoc3RhcnRJbmRleCwgZW5kSW5kZXgpICsgY2xvc2U7XG59XG5cblxuXG5mdW5jdGlvbiBwYXJzZVBhcnQocGFydCwgaW5kZXgpIHtcbiAgLy8gaWYgdGhlIGZpcnN0XG4gIGlmIChpbmRleCA9PT0gMCAmJiAhY29udGludWF0aW9uKSB7XG4gICAgcGFydCA9IGFkZFRoaXNPckdsb2JhbChwYXJ0KTtcbiAgfSBlbHNlIHtcbiAgICBwYXJ0ID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIHBhcnQ7XG4gIH1cblxuICBjdXJyZW50UmVmZXJlbmNlID0gKytyZWZlcmVuY2VDb3VudDtcbiAgdmFyIHJlZiA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2U7XG4gIHJldHVybiAnKCcgKyByZWYgKyAnID0gJyArIHBhcnQgKyAnKSA9PSBudWxsID8gdm9pZCAwIDogJztcbn1cblxuXG5mdW5jdGlvbiByZXBsYWNlQW5kc0FuZE9ycyhleHByKSB7XG4gIHJldHVybiBleHByLnJlcGxhY2UoYW5kUmVnZXgsICcgJiYgJykucmVwbGFjZShvclJlZ2V4LCAnIHx8ICcpO1xufVxuXG5cbi8vIFByZXBlbmRzIHJlZmVyZW5jZSB2YXJpYWJsZSBkZWZpbml0aW9uc1xuZnVuY3Rpb24gYWRkUmVmZXJlbmNlcyhleHByKSB7XG4gIGlmIChyZWZlcmVuY2VDb3VudCkge1xuICAgIHZhciByZWZzID0gW107XG4gICAgZm9yICh2YXIgaSA9IDE7IGkgPD0gcmVmZXJlbmNlQ291bnQ7IGkrKykge1xuICAgICAgcmVmcy5wdXNoKCdfcmVmJyArIGkpO1xuICAgIH1cbiAgICBleHByID0gJ3ZhciAnICsgcmVmcy5qb2luKCcsICcpICsgJztcXG4nICsgZXhwcjtcbiAgfVxuICByZXR1cm4gZXhwcjtcbn1cbiIsIi8vIGZpbmRzIGFsbCBxdW90ZWQgc3RyaW5nc1xudmFyIHF1b3RlUmVnZXggPSAvKFsnXCJcXC9dKShcXFxcXFwxfFteXFwxXSkqP1xcMS9nO1xuXG4vLyBmaW5kcyBhbGwgZW1wdHkgcXVvdGVkIHN0cmluZ3NcbnZhciBlbXB0eVF1b3RlRXhwciA9IC8oWydcIlxcL10pXFwxL2c7XG5cbnZhciBzdHJpbmdzID0gbnVsbDtcblxuXG4vKipcbiAqIFJlbW92ZSBzdHJpbmdzIGZyb20gYW4gZXhwcmVzc2lvbiBmb3IgZWFzaWVyIHBhcnNpbmcuIFJldHVybnMgYSBsaXN0IG9mIHRoZSBzdHJpbmdzIHRvIGFkZCBiYWNrIGluIGxhdGVyLlxuICogVGhpcyBtZXRob2QgYWN0dWFsbHkgbGVhdmVzIHRoZSBzdHJpbmcgcXVvdGUgbWFya3MgYnV0IGVtcHRpZXMgdGhlbSBvZiB0aGVpciBjb250ZW50cy4gVGhlbiB3aGVuIHJlcGxhY2luZyB0aGVtIGFmdGVyXG4gKiBwYXJzaW5nIHRoZSBjb250ZW50cyBqdXN0IGdldCBwdXQgYmFjayBpbnRvIHRoZWlyIHF1b3RlcyBtYXJrcy5cbiAqL1xuZXhwb3J0cy5wdWxsT3V0U3RyaW5ncyA9IGZ1bmN0aW9uKGV4cHIpIHtcbiAgaWYgKHN0cmluZ3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B1dEluU3RyaW5ncyBtdXN0IGJlIGNhbGxlZCBhZnRlciBwdWxsT3V0U3RyaW5ncy4nKTtcbiAgfVxuXG4gIHN0cmluZ3MgPSBbXTtcblxuICByZXR1cm4gZXhwci5yZXBsYWNlKHF1b3RlUmVnZXgsIGZ1bmN0aW9uKHN0ciwgcXVvdGUpIHtcbiAgICBzdHJpbmdzLnB1c2goc3RyKTtcbiAgICByZXR1cm4gcXVvdGUgKyBxdW90ZTsgLy8gcGxhY2Vob2xkZXIgZm9yIHRoZSBzdHJpbmdcbiAgfSk7XG59O1xuXG5cbi8qKlxuICogUmVwbGFjZSB0aGUgc3RyaW5ncyBwcmV2aW91c2x5IHB1bGxlZCBvdXQgYWZ0ZXIgcGFyc2luZyBpcyBmaW5pc2hlZC5cbiAqL1xuZXhwb3J0cy5wdXRJblN0cmluZ3MgPSBmdW5jdGlvbihleHByKSB7XG4gIGlmICghc3RyaW5ncykge1xuICAgIHRocm93IG5ldyBFcnJvcigncHVsbE91dFN0cmluZ3MgbXVzdCBiZSBjYWxsZWQgYmVmb3JlIHB1dEluU3RyaW5ncy4nKTtcbiAgfVxuXG4gIGV4cHIgPSBleHByLnJlcGxhY2UoZW1wdHlRdW90ZUV4cHIsIGZ1bmN0aW9uKCkge1xuICAgIHJldHVybiBzdHJpbmdzLnNoaWZ0KCk7XG4gIH0pO1xuXG4gIHN0cmluZ3MgPSBudWxsO1xuXG4gIHJldHVybiBleHByO1xufTtcbiIsInZhciBGcmFnbWVudHMgPSByZXF1aXJlKCcuL3NyYy9mcmFnbWVudHMnKTtcbnZhciBPYnNlcnZlciA9IHJlcXVpcmUoJy4vc3JjL29ic2VydmVyJyk7XG5cbmZ1bmN0aW9uIGNyZWF0ZSgpIHtcbiAgdmFyIGZyYWdtZW50cyA9IG5ldyBGcmFnbWVudHMoT2JzZXJ2ZXIpO1xuICBmcmFnbWVudHMuZXhwcmVzc2lvbnMgPSBPYnNlcnZlci5leHByZXNzaW9ucztcbiAgZnJhZ21lbnRzLnN5bmMgPSBPYnNlcnZlci5zeW5jO1xuICBmcmFnbWVudHMuc3luY05vdyA9IE9ic2VydmVyLnN5bmNOb3c7XG4gIGZyYWdtZW50cy5jb250ZXh0ID0gT2JzZXJ2ZXIuY29udGV4dDtcbiAgcmV0dXJuIGZyYWdtZW50cztcbn1cblxuLy8gQ3JlYXRlIGFuIGluc3RhbmNlIG9mIGZyYWdtZW50cyB3aXRoIHRoZSBkZWZhdWx0IG9ic2VydmVyXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZSgpO1xubW9kdWxlLmV4cG9ydHMuY3JlYXRlID0gY3JlYXRlO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBBbmltYXRlZEJpbmRpbmc7XG52YXIgYW5pbWF0aW9uID0gcmVxdWlyZSgnLi91dGlsL2FuaW1hdGlvbicpO1xudmFyIEJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKTtcbnZhciBfc3VwZXIgPSBCaW5kaW5nLnByb3RvdHlwZTtcblxuLyoqXG4gKiBCaW5kaW5ncyB3aGljaCBleHRlbmQgQW5pbWF0ZWRCaW5kaW5nIGhhdmUgdGhlIGFiaWxpdHkgdG8gYW5pbWF0ZSBlbGVtZW50cyB0aGF0IGFyZSBhZGRlZCB0byB0aGUgRE9NIGFuZCByZW1vdmVkIGZyb21cbiAqIHRoZSBET00uIFRoaXMgYWxsb3dzIG1lbnVzIHRvIHNsaWRlIG9wZW4gYW5kIGNsb3NlZCwgZWxlbWVudHMgdG8gZmFkZSBpbiBvciBkcm9wIGRvd24sIGFuZCByZXBlYXRlZCBpdGVtcyB0byBhcHBlYXJcbiAqIHRvIG1vdmUgKGlmIHlvdSBnZXQgY3JlYXRpdmUgZW5vdWdoKS5cbiAqXG4gKiBUaGUgZm9sbG93aW5nIDUgbWV0aG9kcyBhcmUgaGVscGVyIERPTSBtZXRob2RzIHRoYXQgYWxsb3cgcmVnaXN0ZXJlZCBiaW5kaW5ncyB0byB3b3JrIHdpdGggQ1NTIHRyYW5zaXRpb25zIGZvclxuICogYW5pbWF0aW5nIGVsZW1lbnRzLiBJZiBhbiBlbGVtZW50IGhhcyB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBvciBhIG1hdGNoaW5nIEphdmFTY3JpcHQgbWV0aG9kLCB0aGVzZSBoZWxwZXIgbWV0aG9kc1xuICogd2lsbCBzZXQgYSBjbGFzcyBvbiB0aGUgbm9kZSB0byB0cmlnZ2VyIHRoZSBhbmltYXRpb24gYW5kL29yIGNhbGwgdGhlIEphdmFTY3JpcHQgbWV0aG9kcyB0byBoYW5kbGUgaXQuXG4gKlxuICogQW4gYW5pbWF0aW9uIG1heSBiZSBlaXRoZXIgYSBDU1MgdHJhbnNpdGlvbiwgYSBDU1MgYW5pbWF0aW9uLCBvciBhIHNldCBvZiBKYXZhU2NyaXB0IG1ldGhvZHMgdGhhdCB3aWxsIGJlIGNhbGxlZC5cbiAqXG4gKiBJZiB1c2luZyBDU1MsIGNsYXNzZXMgYXJlIGFkZGVkIGFuZCByZW1vdmVkIGZyb20gdGhlIGVsZW1lbnQuIFdoZW4gYW4gZWxlbWVudCBpcyBpbnNlcnRlZCBpdCB3aWxsIHJlY2VpdmUgdGhlIGB3aWxsLVxuICogYW5pbWF0ZS1pbmAgY2xhc3MgYmVmb3JlIGJlaW5nIGFkZGVkIHRvIHRoZSBET00sIHRoZW4gaXQgd2lsbCByZWNlaXZlIHRoZSBgYW5pbWF0ZS1pbmAgY2xhc3MgaW1tZWRpYXRlbHkgYWZ0ZXIgYmVpbmdcbiAqIGFkZGVkIHRvIHRoZSBET00sIHRoZW4gYm90aCBjbGFzZXMgd2lsbCBiZSByZW1vdmVkIGFmdGVyIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuIFdoZW4gYW4gZWxlbWVudCBpcyBiZWluZyByZW1vdmVkXG4gKiBmcm9tIHRoZSBET00gaXQgd2lsbCByZWNlaXZlIHRoZSBgd2lsbC1hbmltYXRlLW91dGAgYW5kIGBhbmltYXRlLW91dGAgY2xhc3NlcywgdGhlbiB0aGUgY2xhc3NlcyB3aWxsIGJlIHJlbW92ZWQgb25jZVxuICogdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS5cbiAqXG4gKiBJZiB1c2luZyBKYXZhU2NyaXB0LCBtZXRob2RzIG11c3QgYmUgZGVmaW5lZCAgdG8gYW5pbWF0ZSB0aGUgZWxlbWVudCB0aGVyZSBhcmUgMyBzdXBwb3J0ZWQgbWV0aG9kcyB3aGljaCBjYW4gYlxuICpcbiAqIFRPRE8gY2FjaGUgYnkgY2xhc3MtbmFtZSAoQW5ndWxhcik/IE9ubHkgc3VwcG9ydCBqYXZhc2NyaXB0LXN0eWxlIChFbWJlcik/IEFkZCBhIGB3aWxsLWFuaW1hdGUtaW5gIGFuZFxuICogYGRpZC1hbmltYXRlLWluYCBldGMuP1xuICogSUYgaGFzIGFueSBjbGFzc2VzLCBhZGQgdGhlIGB3aWxsLWFuaW1hdGUtaW58b3V0YCBhbmQgZ2V0IGNvbXB1dGVkIGR1cmF0aW9uLiBJZiBub25lLCByZXR1cm4uIENhY2hlLlxuICogUlVMRSBpcyB1c2UgdW5pcXVlIGNsYXNzIHRvIGRlZmluZSBhbiBhbmltYXRpb24uIE9yIGF0dHJpYnV0ZSBgYW5pbWF0ZT1cImZhZGVcImAgd2lsbCBhZGQgdGhlIGNsYXNzP1xuICogYC5mYWRlLndpbGwtYW5pbWF0ZS1pbmAsIGAuZmFkZS5hbmltYXRlLWluYCwgYC5mYWRlLndpbGwtYW5pbWF0ZS1vdXRgLCBgLmZhZGUuYW5pbWF0ZS1vdXRgXG4gKlxuICogRXZlbnRzIHdpbGwgYmUgdHJpZ2dlcmVkIG9uIHRoZSBlbGVtZW50cyBuYW1lZCB0aGUgc2FtZSBhcyB0aGUgY2xhc3MgbmFtZXMgKGUuZy4gYGFuaW1hdGUtaW5gKSB3aGljaCBtYXkgYmUgbGlzdGVuZWRcbiAqIHRvIGluIG9yZGVyIHRvIGNhbmNlbCBhbiBhbmltYXRpb24gb3IgcmVzcG9uZCB0byBpdC5cbiAqXG4gKiBJZiB0aGUgbm9kZSBoYXMgbWV0aG9kcyBgYW5pbWF0ZUluKGRvbmUpYCwgYGFuaW1hdGVPdXQoZG9uZSlgLCBgYW5pbWF0ZU1vdmVJbihkb25lKWAsIG9yIGBhbmltYXRlTW92ZU91dChkb25lKWBcbiAqIGRlZmluZWQgb24gdGhlbSB0aGVuIHRoZSBoZWxwZXJzIHdpbGwgYWxsb3cgYW4gYW5pbWF0aW9uIGluIEphdmFTY3JpcHQgdG8gYmUgcnVuIGFuZCB3YWl0IGZvciB0aGUgYGRvbmVgIGZ1bmN0aW9uIHRvXG4gKiBiZSBjYWxsZWQgdG8ga25vdyB3aGVuIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuXG4gKlxuICogQmUgc3VyZSB0byBhY3R1YWxseSBoYXZlIGFuIGFuaW1hdGlvbiBkZWZpbmVkIGZvciBlbGVtZW50cyB3aXRoIHRoZSBgYW5pbWF0ZWAgY2xhc3MvYXR0cmlidXRlIGJlY2F1c2UgdGhlIGhlbHBlcnMgdXNlXG4gKiB0aGUgYHRyYW5zaXRpb25lbmRgIGFuZCBgYW5pbWF0aW9uZW5kYCBldmVudHMgdG8ga25vdyB3aGVuIHRoZSBhbmltYXRpb24gaXMgZmluaXNoZWQsIGFuZCBpZiB0aGVyZSBpcyBubyBhbmltYXRpb25cbiAqIHRoZXNlIGV2ZW50cyB3aWxsIG5ldmVyIGJlIHRyaWdnZXJlZCBhbmQgdGhlIG9wZXJhdGlvbiB3aWxsIG5ldmVyIGNvbXBsZXRlLlxuICovXG5mdW5jdGlvbiBBbmltYXRlZEJpbmRpbmcocHJvcGVydGllcykge1xuICB2YXIgZWxlbWVudCA9IHByb3BlcnRpZXMubm9kZTtcbiAgdmFyIGFuaW1hdGUgPSBlbGVtZW50LmdldEF0dHJpYnV0ZShwcm9wZXJ0aWVzLmZyYWdtZW50cy5hbmltYXRlQXR0cmlidXRlKTtcbiAgdmFyIGZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuXG4gIGlmIChhbmltYXRlICE9PSBudWxsKSB7XG4gICAgaWYgKGVsZW1lbnQubm9kZU5hbWUgPT09ICdURU1QTEFURScgfHwgZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1NDUklQVCcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGFuaW1hdGUgbXVsdGlwbGUgbm9kZXMgaW4gYSB0ZW1wbGF0ZSBvciBzY3JpcHQuIFJlbW92ZSB0aGUgW2FuaW1hdGVdIGF0dHJpYnV0ZS4nKTtcbiAgICB9XG5cbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQWxsb3cgbXVsdGlwbGUgYmluZGluZ3MgdG8gYW5pbWF0ZSBieSBub3QgcmVtb3ZpbmcgdW50aWwgdGhleSBoYXZlIGFsbCBiZWVuIGNyZWF0ZWRcbiAgICAgIGVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHByb3BlcnRpZXMuZnJhZ21lbnRzLmFuaW1hdGVBdHRyaWJ1dGUpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5hbmltYXRlID0gdHJ1ZTtcblxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgnYXR0cmlidXRlJywgYW5pbWF0ZSkpIHtcbiAgICAgIC8vIGphdmFzY3JpcHQgYW5pbWF0aW9uXG4gICAgICB0aGlzLmFuaW1hdGVFeHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIGFuaW1hdGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoYW5pbWF0ZVswXSA9PT0gJy4nKSB7XG4gICAgICAgIC8vIGNsYXNzIGFuaW1hdGlvblxuICAgICAgICB0aGlzLmFuaW1hdGVDbGFzc05hbWUgPSBhbmltYXRlLnNsaWNlKDEpO1xuICAgICAgfSBlbHNlIGlmIChhbmltYXRlKSB7XG4gICAgICAgIC8vIHJlZ2lzdGVyZWQgYW5pbWF0aW9uXG4gICAgICAgIHZhciBhbmltYXRlT2JqZWN0ID0gZnJhZ21lbnRzLmdldEFuaW1hdGlvbihhbmltYXRlKTtcbiAgICAgICAgaWYgKHR5cGVvZiBhbmltYXRlT2JqZWN0ID09PSAnZnVuY3Rpb24nKSBhbmltYXRlT2JqZWN0ID0gbmV3IGFuaW1hdGVPYmplY3QodGhpcyk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU9iamVjdCA9IGFuaW1hdGVPYmplY3Q7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgQmluZGluZy5jYWxsKHRoaXMsIHByb3BlcnRpZXMpO1xufVxuXG5cbkJpbmRpbmcuZXh0ZW5kKEFuaW1hdGVkQmluZGluZywge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBfc3VwZXIuaW5pdC5jYWxsKHRoaXMpO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24pIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyID0gbmV3IHRoaXMuT2JzZXJ2ZXIodGhpcy5hbmltYXRlRXhwcmVzc2lvbiwgZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgdGhpcy5hbmltYXRlT2JqZWN0ID0gdmFsdWU7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9XG4gIH0sXG5cbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT0gY29udGV4dCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBfc3VwZXIuYmluZC5jYWxsKHRoaXMsIGNvbnRleHQpO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZU9ic2VydmVyKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlci5iaW5kKGNvbnRleHQpO1xuICAgIH1cbiAgfSxcblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX3N1cGVyLnVuYmluZC5jYWxsKHRoaXMpO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZU9ic2VydmVyKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlci51bmJpbmQoKTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gcmVtb3ZlIGEgbm9kZSBmcm9tIHRoZSBET00sIGFsbG93aW5nIGZvciBhbmltYXRpb25zIHRvIG9jY3VyLiBgY2FsbGJhY2tgIHdpbGwgYmUgY2FsbGVkIHdoZW5cbiAgICogZmluaXNoZWQuXG4gICAqL1xuICBhbmltYXRlT3V0OiBmdW5jdGlvbihub2RlLCBjYWxsYmFjaykge1xuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG5cbiAgICB0aGlzLmFuaW1hdGVOb2RlKCdvdXQnLCBub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbCh0aGlzKTtcbiAgICB9KTtcbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byBpbnNlcnQgYSBub2RlIGluIHRoZSBET00gYmVmb3JlIGFub3RoZXIgbm9kZSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbFxuICAgKiBiZSBjYWxsZWQgd2hlbiBmaW5pc2hlZC4gSWYgYGJlZm9yZWAgaXMgbm90IHByb3ZpZGVkIHRoZW4gdGhlIGFuaW1hdGlvbiB3aWxsIGJlIHJ1biB3aXRob3V0IGluc2VydGluZyB0aGUgbm9kZS5cbiAgICovXG4gIGFuaW1hdGVJbjogZnVuY3Rpb24obm9kZSwgY2FsbGJhY2spIHtcbiAgICBpZiAobm9kZS5maXJzdFZpZXdOb2RlKSBub2RlID0gbm9kZS5maXJzdFZpZXdOb2RlO1xuICAgIHRoaXMuYW5pbWF0ZU5vZGUoJ2luJywgbm9kZSwgY2FsbGJhY2ssIHRoaXMpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBBbGxvdyBhbiBlbGVtZW50IHRvIHVzZSBDU1MzIHRyYW5zaXRpb25zIG9yIGFuaW1hdGlvbnMgdG8gYW5pbWF0ZSBpbiBvciBvdXQgb2YgdGhlIHBhZ2UuXG4gICAqL1xuICBhbmltYXRlTm9kZTogZnVuY3Rpb24oZGlyZWN0aW9uLCBub2RlLCBjYWxsYmFjaykge1xuICAgIHZhciBhbmltYXRlT2JqZWN0LCBjbGFzc05hbWUsIG5hbWUsIHdpbGxOYW1lLCBkaWROYW1lLCBfdGhpcyA9IHRoaXM7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JqZWN0ICYmIHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdvYmplY3QnKSB7XG4gICAgICBhbmltYXRlT2JqZWN0ID0gdGhpcy5hbmltYXRlT2JqZWN0O1xuICAgIH0gZWxzZSBpZiAodGhpcy5hbmltYXRlQ2xhc3NOYW1lKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVDbGFzc05hbWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy5hbmltYXRlT2JqZWN0ID09PSAnc3RyaW5nJykge1xuICAgICAgY2xhc3NOYW1lID0gdGhpcy5hbmltYXRlT2JqZWN0O1xuICAgIH1cblxuICAgIGlmIChhbmltYXRlT2JqZWN0KSB7XG4gICAgICB2YXIgZGlyID0gZGlyZWN0aW9uID09PSAnaW4nID8gJ0luJyA6ICdPdXQnO1xuICAgICAgbmFtZSA9ICdhbmltYXRlJyArIGRpcjtcbiAgICAgIHdpbGxOYW1lID0gJ3dpbGxBbmltYXRlJyArIGRpcjtcbiAgICAgIGRpZE5hbWUgPSAnZGlkQW5pbWF0ZScgKyBkaXI7XG5cbiAgICAgIGFuaW1hdGlvbi5tYWtlRWxlbWVudEFuaW1hdGFibGUobm9kZSk7XG5cbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W3dpbGxOYW1lXSkge1xuICAgICAgICBhbmltYXRlT2JqZWN0W3dpbGxOYW1lXShub2RlKTtcbiAgICAgICAgLy8gdHJpZ2dlciByZWZsb3dcbiAgICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG4gICAgICB9XG5cbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W25hbWVdKSB7XG4gICAgICAgIGFuaW1hdGVPYmplY3RbbmFtZV0obm9kZSwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKGFuaW1hdGVPYmplY3RbZGlkTmFtZV0pIGFuaW1hdGVPYmplY3RbZGlkTmFtZV0obm9kZSk7XG4gICAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5hbWUgPSAnYW5pbWF0ZS0nICsgZGlyZWN0aW9uO1xuICAgICAgd2lsbE5hbWUgPSAnd2lsbC1hbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5hZGQoY2xhc3NOYW1lKTtcblxuICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKHdpbGxOYW1lKTtcblxuICAgICAgLy8gdHJpZ2dlciByZWZsb3dcbiAgICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuXG4gICAgICBub2RlLmNsYXNzTGlzdC5hZGQobmFtZSk7XG4gICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUod2lsbE5hbWUpO1xuXG4gICAgICB2YXIgZHVyYXRpb24gPSBnZXREdXJhdGlvbi5jYWxsKHRoaXMsIG5vZGUsIGRpcmVjdGlvbik7XG4gICAgICB2YXIgd2hlbkRvbmUgPSBmdW5jdGlvbigpIHtcbiAgICAgICAgbm9kZS5jbGFzc0xpc3QucmVtb3ZlKG5hbWUpO1xuICAgICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgIH07XG5cbiAgICAgIGlmIChkdXJhdGlvbikge1xuICAgICAgICBzZXRUaW1lb3V0KHdoZW5Eb25lLCBkdXJhdGlvbik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3aGVuRG9uZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufSk7XG5cblxudmFyIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAndHJhbnNpdGlvbkR1cmF0aW9uJztcbnZhciB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3RyYW5zaXRpb25EZWxheSc7XG52YXIgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ2FuaW1hdGlvbkR1cmF0aW9uJztcbnZhciBhbmltYXRpb25EZWxheU5hbWUgPSAnYW5pbWF0aW9uRGVsYXknO1xudmFyIHN0eWxlID0gZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LnN0eWxlO1xuaWYgKHN0eWxlLnRyYW5zaXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlLndlYmtpdFRyYW5zaXRpb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAnd2Via2l0VHJhbnNpdGlvbkR1cmF0aW9uJztcbiAgdHJhbnNpdGlvbkRlbGF5TmFtZSA9ICd3ZWJraXRUcmFuc2l0aW9uRGVsYXknO1xufVxuaWYgKHN0eWxlLmFuaW1hdGlvbkR1cmF0aW9uID09PSB1bmRlZmluZWQgJiYgc3R5bGUud2Via2l0QW5pbWF0aW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICBhbmltYXRpb25EdXJhdGlvbk5hbWUgPSAnd2Via2l0QW5pbWF0aW9uRHVyYXRpb24nO1xuICBhbmltYXRpb25EZWxheU5hbWUgPSAnd2Via2l0QW5pbWF0aW9uRGVsYXknO1xufVxuXG5cbmZ1bmN0aW9uIGdldER1cmF0aW9uKG5vZGUsIGRpcmVjdGlvbikge1xuICB2YXIgbWlsbGlzZWNvbmRzID0gdGhpcy5jbG9uZWRGcm9tWydfX2FuaW1hdGlvbkR1cmF0aW9uJyArIGRpcmVjdGlvbl07XG4gIGlmICghbWlsbGlzZWNvbmRzKSB7XG4gICAgLy8gUmVjYWxjIGlmIG5vZGUgd2FzIG91dCBvZiBET00gYmVmb3JlIGFuZCBoYWQgMCBkdXJhdGlvbiwgYXNzdW1lIHRoZXJlIGlzIGFsd2F5cyBTT01FIGR1cmF0aW9uLlxuICAgIHZhciBzdHlsZXMgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShub2RlKTtcbiAgICB2YXIgc2Vjb25kcyA9IE1hdGgubWF4KHBhcnNlRmxvYXQoc3R5bGVzW3RyYW5zaXRpb25EdXJhdGlvbk5hbWVdIHx8IDApICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW3RyYW5zaXRpb25EZWxheU5hbWVdIHx8IDApLFxuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbYW5pbWF0aW9uRHVyYXRpb25OYW1lXSB8fCAwKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1thbmltYXRpb25EZWxheU5hbWVdIHx8IDApKTtcbiAgICBtaWxsaXNlY29uZHMgPSBzZWNvbmRzICogMTAwMCB8fCAwO1xuICAgIHRoaXMuY2xvbmVkRnJvbS5fX2FuaW1hdGlvbkR1cmF0aW9uX18gPSBtaWxsaXNlY29uZHM7XG4gIH1cbiAgcmV0dXJuIG1pbGxpc2Vjb25kcztcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gQmluZGluZztcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cbi8qKlxuICogQSBiaW5kaW5nIGlzIGEgbGluayBiZXR3ZWVuIGFuIGVsZW1lbnQgYW5kIHNvbWUgZGF0YS4gU3ViY2xhc3NlcyBvZiBCaW5kaW5nIGNhbGxlZCBiaW5kZXJzIGRlZmluZSB3aGF0IGEgYmluZGluZyBkb2VzXG4gKiB3aXRoIHRoYXQgbGluay4gSW5zdGFuY2VzIG9mIHRoZXNlIGJpbmRlcnMgYXJlIGNyZWF0ZWQgYXMgYmluZGluZ3Mgb24gdGVtcGxhdGVzLiBXaGVuIGEgdmlldyBpcyBzdGFtcGVkIG91dCBmcm9tIHRoZVxuICogdGVtcGxhdGUgdGhlIGJpbmRpbmcgaXMgXCJjbG9uZWRcIiAoaXQgaXMgYWN0dWFsbHkgZXh0ZW5kZWQgZm9yIHBlcmZvcm1hbmNlKSBhbmQgdGhlIGBlbGVtZW50YC9gbm9kZWAgcHJvcGVydHkgaXNcbiAqIHVwZGF0ZWQgdG8gdGhlIG1hdGNoaW5nIGVsZW1lbnQgaW4gdGhlIHZpZXcuXG4gKlxuICogIyMjIFByb3BlcnRpZXNcbiAqICAqIGVsZW1lbnQ6IFRoZSBlbGVtZW50IChvciB0ZXh0IG5vZGUpIHRoaXMgYmluZGluZyBpcyBib3VuZCB0b1xuICogICogbm9kZTogQWxpYXMgb2YgZWxlbWVudCwgc2luY2UgYmluZGluZ3MgbWF5IGFwcGx5IHRvIHRleHQgbm9kZXMgdGhpcyBpcyBtb3JlIGFjY3VyYXRlXG4gKiAgKiBuYW1lOiBUaGUgYXR0cmlidXRlIG9yIGVsZW1lbnQgbmFtZSAoZG9lcyBub3QgYXBwbHkgdG8gbWF0Y2hlZCB0ZXh0IG5vZGVzKVxuICogICogbWF0Y2g6IFRoZSBtYXRjaGVkIHBhcnQgb2YgdGhlIG5hbWUgZm9yIHdpbGRjYXJkIGF0dHJpYnV0ZXMgKGUuZy4gYG9uLSpgIG1hdGNoaW5nIGFnYWluc3QgYG9uLWNsaWNrYCB3b3VsZCBoYXZlIGFcbiAqICAgIG1hdGNoIHByb3BlcnR5IGVxdWFsbGluZyBgY2xpY2tgKS4gVXNlIGB0aGlzLmNhbWVsQ2FzZWAgdG8gZ2V0IHRoZSBtYXRjaCBwcm9lcnR5IGNhbWVsQ2FzZWQuXG4gKiAgKiBleHByZXNzaW9uOiBUaGUgZXhwcmVzc2lvbiB0aGlzIGJpbmRpbmcgd2lsbCB1c2UgZm9yIGl0cyB1cGRhdGVzIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIGVsZW1lbnRzKVxuICogICogY29udGV4dDogVGhlIGNvbnRleHQgdGhlIGV4cmVzc2lvbiBvcGVyYXRlcyB3aXRoaW4gd2hlbiBib3VuZFxuICovXG5mdW5jdGlvbiBCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgaWYgKCFwcm9wZXJ0aWVzLm5vZGUgfHwgIXByb3BlcnRpZXMudmlldykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IHJlY2VpdmUgYSBub2RlIGFuZCBhIHZpZXcnKTtcbiAgfVxuXG4gIC8vIGVsZW1lbnQgYW5kIG5vZGUgYXJlIGFsaWFzZXNcbiAgdGhpcy5fZWxlbWVudFBhdGggPSBpbml0Tm9kZVBhdGgocHJvcGVydGllcy5ub2RlLCBwcm9wZXJ0aWVzLnZpZXcpO1xuICB0aGlzLm5vZGUgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHRoaXMuZWxlbWVudCA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5uYW1lID0gcHJvcGVydGllcy5uYW1lO1xuICB0aGlzLm1hdGNoID0gcHJvcGVydGllcy5tYXRjaDtcbiAgdGhpcy5leHByZXNzaW9uID0gcHJvcGVydGllcy5leHByZXNzaW9uO1xuICB0aGlzLmZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xufVxuXG5leHRlbmQoQmluZGluZywge1xuICAvKipcbiAgICogRGVmYXVsdCBwcmlvcml0eSBiaW5kZXJzIG1heSBvdmVycmlkZS5cbiAgICovXG4gIHByaW9yaXR5OiAwLFxuXG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgYSBjbG9uZWQgYmluZGluZy4gVGhpcyBoYXBwZW5zIGFmdGVyIGEgY29tcGlsZWQgYmluZGluZyBvbiBhIHRlbXBsYXRlIGlzIGNsb25lZCBmb3IgYSB2aWV3LlxuICAgKi9cbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuZXhwcmVzc2lvbikge1xuICAgICAgLy8gQW4gb2JzZXJ2ZXIgdG8gb2JzZXJ2ZSB2YWx1ZSBjaGFuZ2VzIHRvIHRoZSBleHByZXNzaW9uIHdpdGhpbiBhIGNvbnRleHRcbiAgICAgIHRoaXMub2JzZXJ2ZXIgPSBuZXcgdGhpcy5PYnNlcnZlcih0aGlzLmV4cHJlc3Npb24sIHRoaXMudXBkYXRlZCwgdGhpcyk7XG4gICAgfVxuICAgIHRoaXMuY3JlYXRlZCgpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBDbG9uZSB0aGlzIGJpbmRpbmcgZm9yIGEgdmlldy4gVGhlIGVsZW1lbnQvbm9kZSB3aWxsIGJlIHVwZGF0ZWQgYW5kIHRoZSBiaW5kaW5nIHdpbGwgYmUgaW5pdGVkLlxuICAgKi9cbiAgY2xvbmVGb3JWaWV3OiBmdW5jdGlvbih2aWV3KSB7XG4gICAgaWYgKCF2aWV3KSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBIGJpbmRpbmcgbXVzdCBjbG9uZSBhZ2FpbnN0IGEgdmlldycpO1xuICAgIH1cblxuICAgIHZhciBub2RlID0gdmlldztcbiAgICB0aGlzLl9lbGVtZW50UGF0aC5mb3JFYWNoKGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICBub2RlID0gbm9kZS5jaGlsZE5vZGVzW2luZGV4XTtcbiAgICB9KTtcblxuICAgIHZhciBiaW5kaW5nID0gT2JqZWN0LmNyZWF0ZSh0aGlzKTtcbiAgICBiaW5kaW5nLmNsb25lZEZyb20gPSB0aGlzO1xuICAgIGJpbmRpbmcuZWxlbWVudCA9IG5vZGU7XG4gICAgYmluZGluZy5ub2RlID0gbm9kZTtcbiAgICBiaW5kaW5nLmluaXQoKTtcbiAgICByZXR1cm4gYmluZGluZztcbiAgfSxcblxuXG4gIC8vIEJpbmQgdGhpcyB0byB0aGUgZ2l2ZW4gY29udGV4dCBvYmplY3RcbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT0gY29udGV4dCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgaWYgKHRoaXMub2JzZXJ2ZXIpIHRoaXMub2JzZXJ2ZXIuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgdGhpcy5ib3VuZCgpO1xuXG4gICAgaWYgKHRoaXMub2JzZXJ2ZXIpIHtcbiAgICAgIGlmICh0aGlzLnVwZGF0ZWQgIT09IEJpbmRpbmcucHJvdG90eXBlLnVwZGF0ZWQpIHtcbiAgICAgICAgdGhpcy5vYnNlcnZlci5mb3JjZVVwZGF0ZU5leHRTeW5jID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5vYnNlcnZlci5iaW5kKGNvbnRleHQpO1xuICAgICAgfVxuICAgIH1cbiAgfSxcblxuXG4gIC8vIFVuYmluZCB0aGlzIGZyb20gaXRzIGNvbnRleHRcbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHRoaXMub2JzZXJ2ZXIpIHRoaXMub2JzZXJ2ZXIudW5iaW5kKCk7XG4gICAgdGhpcy51bmJvdW5kKCk7XG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgfSxcblxuXG4gIC8vIENsZWFucyB1cCBiaW5kaW5nIGNvbXBsZXRlbHlcbiAgZGlzcG9zZTogZnVuY3Rpb24oKSB7XG4gICAgdGhpcy51bmJpbmQoKTtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikge1xuICAgICAgLy8gVGhpcyB3aWxsIGNsZWFyIGl0IG91dCwgbnVsbGlmeWluZyBhbnkgZGF0YSBzdG9yZWRcbiAgICAgIHRoaXMub2JzZXJ2ZXIuc3luYygpO1xuICAgIH1cbiAgICB0aGlzLmRpc3Bvc2VkKCk7XG4gIH0sXG5cblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcncyBlbGVtZW50IGlzIGNvbXBpbGVkIHdpdGhpbiBhIHRlbXBsYXRlXG4gIGNvbXBpbGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY3JlYXRlZFxuICBjcmVhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgZXhwcmVzc2lvbidzIHZhbHVlIGNoYW5nZXNcbiAgdXBkYXRlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgYm91bmRcbiAgYm91bmQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nIGlzIHVuYm91bmRcbiAgdW5ib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgZGlzcG9zZWRcbiAgZGlzcG9zZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gSGVscGVyIG1ldGhvZHNcblxuICBnZXQgY2FtZWxDYXNlKCkge1xuICAgIHJldHVybiAodGhpcy5tYXRjaCB8fCB0aGlzLm5hbWUgfHwgJycpLnJlcGxhY2UoLy0rKFxcdykvZywgZnVuY3Rpb24oXywgY2hhcikge1xuICAgICAgcmV0dXJuIGNoYXIudG9VcHBlckNhc2UoKTtcbiAgICB9KTtcbiAgfSxcblxuICBvYnNlcnZlOiBmdW5jdGlvbihleHByZXNzaW9uLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KSB7XG4gICAgcmV0dXJuIG5ldyB0aGlzLk9ic2VydmVyKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQgfHwgdGhpcyk7XG4gIH1cbn0pO1xuXG5cblxuXG52YXIgaW5kZXhPZiA9IEFycmF5LnByb3RvdHlwZS5pbmRleE9mO1xuXG4vLyBDcmVhdGVzIGFuIGFycmF5IG9mIGluZGV4ZXMgdG8gaGVscCBmaW5kIHRoZSBzYW1lIGVsZW1lbnQgd2l0aGluIGEgY2xvbmVkIHZpZXdcbmZ1bmN0aW9uIGluaXROb2RlUGF0aChub2RlLCB2aWV3KSB7XG4gIHZhciBwYXRoID0gW107XG4gIHdoaWxlIChub2RlICE9PSB2aWV3KSB7XG4gICAgdmFyIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcbiAgICBwYXRoLnVuc2hpZnQoaW5kZXhPZi5jYWxsKHBhcmVudC5jaGlsZE5vZGVzLCBub2RlKSk7XG4gICAgbm9kZSA9IHBhcmVudDtcbiAgfVxuICByZXR1cm4gcGF0aDtcbn1cbiIsInZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gY29tcGlsZTtcblxuXG4vLyBXYWxrcyB0aGUgdGVtcGxhdGUgRE9NIHJlcGxhY2luZyBhbnkgYmluZGluZ3MgYW5kIGNhY2hpbmcgYmluZGluZ3Mgb250byB0aGUgdGVtcGxhdGUgb2JqZWN0LlxuZnVuY3Rpb24gY29tcGlsZShmcmFnbWVudHMsIHRlbXBsYXRlKSB7XG4gIHZhciB3YWxrZXIgPSBkb2N1bWVudC5jcmVhdGVUcmVlV2Fsa2VyKHRlbXBsYXRlLCBOb2RlRmlsdGVyLlNIT1dfRUxFTUVOVCB8IE5vZGVGaWx0ZXIuU0hPV19URVhUKTtcbiAgdmFyIGJpbmRpbmdzID0gW10sIGN1cnJlbnROb2RlLCBwYXJlbnROb2RlLCBwcmV2aW91c05vZGU7XG5cbiAgLy8gUmVzZXQgZmlyc3Qgbm9kZSB0byBlbnN1cmUgaXQgaXNuJ3QgYSBmcmFnbWVudFxuICB3YWxrZXIubmV4dE5vZGUoKTtcbiAgd2Fsa2VyLnByZXZpb3VzTm9kZSgpO1xuXG4gIC8vIGZpbmQgYmluZGluZ3MgZm9yIGVhY2ggbm9kZVxuICBkbyB7XG4gICAgY3VycmVudE5vZGUgPSB3YWxrZXIuY3VycmVudE5vZGU7XG4gICAgcGFyZW50Tm9kZSA9IGN1cnJlbnROb2RlLnBhcmVudE5vZGU7XG4gICAgYmluZGluZ3MucHVzaC5hcHBseShiaW5kaW5ncywgZ2V0QmluZGluZ3NGb3JOb2RlKGZyYWdtZW50cywgY3VycmVudE5vZGUsIHRlbXBsYXRlKSk7XG5cbiAgICBpZiAoY3VycmVudE5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50Tm9kZSkge1xuICAgICAgLy8gY3VycmVudE5vZGUgd2FzIHJlbW92ZWQgYW5kIG1hZGUgYSB0ZW1wbGF0ZVxuICAgICAgd2Fsa2VyLmN1cnJlbnROb2RlID0gcHJldmlvdXNOb2RlIHx8IHdhbGtlci5yb290O1xuICAgIH0gZWxzZSB7XG4gICAgICBwcmV2aW91c05vZGUgPSBjdXJyZW50Tm9kZTtcbiAgICB9XG4gIH0gd2hpbGUgKHdhbGtlci5uZXh0Tm9kZSgpKTtcblxuICByZXR1cm4gYmluZGluZ3M7XG59XG5cblxuXG4vLyBGaW5kIGFsbCB0aGUgYmluZGluZ3Mgb24gYSBnaXZlbiBub2RlICh0ZXh0IG5vZGVzIHdpbGwgb25seSBldmVyIGhhdmUgb25lIGJpbmRpbmcpLlxuZnVuY3Rpb24gZ2V0QmluZGluZ3NGb3JOb2RlKGZyYWdtZW50cywgbm9kZSwgdmlldykge1xuICB2YXIgYmluZGluZ3MgPSBbXTtcbiAgdmFyIEJpbmRlciwgYmluZGluZywgZXhwciwgYm91bmQsIG1hdGNoLCBhdHRyLCBpLCBsO1xuXG4gIGlmIChub2RlLm5vZGVUeXBlID09PSBOb2RlLlRFWFRfTk9ERSkge1xuICAgIHNwbGl0VGV4dE5vZGUoZnJhZ21lbnRzLCBub2RlKTtcblxuICAgIC8vIEZpbmQgYW55IGJpbmRpbmcgZm9yIHRoZSB0ZXh0IG5vZGVcbiAgICBpZiAoZnJhZ21lbnRzLmlzQm91bmQoJ3RleHQnLCBub2RlLm5vZGVWYWx1ZSkpIHtcbiAgICAgIGV4cHIgPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbigndGV4dCcsIG5vZGUubm9kZVZhbHVlKTtcbiAgICAgIG5vZGUubm9kZVZhbHVlID0gJyc7XG4gICAgICBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcigndGV4dCcsIGV4cHIpO1xuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBleHByZXNzaW9uOiBleHByLCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KTtcbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9XG4gICAgfVxuICB9IGVsc2Uge1xuICAgIC8vIElmIHRoZSBlbGVtZW50IGlzIHJlbW92ZWQgZnJvbSB0aGUgRE9NLCBzdG9wLiBDaGVjayBieSBsb29raW5nIGF0IGl0cyBwYXJlbnROb2RlXG4gICAgdmFyIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcbiAgICB2YXIgRGVmYXVsdEJpbmRlciA9IGZyYWdtZW50cy5nZXRBdHRyaWJ1dGVCaW5kZXIoJ19fZGVmYXVsdF9fJyk7XG5cbiAgICAvLyBGaW5kIGFueSBiaW5kaW5nIGZvciB0aGUgZWxlbWVudFxuICAgIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCdlbGVtZW50Jywgbm9kZS50YWdOYW1lLnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmIChCaW5kZXIpIHtcbiAgICAgIGJpbmRpbmcgPSBuZXcgQmluZGVyKHsgbm9kZTogbm9kZSwgdmlldzogdmlldywgZnJhZ21lbnRzOiBmcmFnbWVudHMgfSk7XG4gICAgICBpZiAoYmluZGluZy5jb21waWxlZCgpICE9PSBmYWxzZSkge1xuICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIHJlbW92ZWQsIG1hZGUgYSB0ZW1wbGF0ZSwgZG9uJ3QgY29udGludWUgcHJvY2Vzc2luZ1xuICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHBhcmVudCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIEZpbmQgYW5kIGFkZCBhbnkgYXR0cmlidXRlIGJpbmRpbmdzIG9uIGFuIGVsZW1lbnQuIFRoZXNlIGNhbiBiZSBhdHRyaWJ1dGVzIHdob3NlIG5hbWUgbWF0Y2hlcyBhIGJpbmRpbmcsIG9yXG4gICAgLy8gdGhleSBjYW4gYmUgYXR0cmlidXRlcyB3aGljaCBoYXZlIGEgYmluZGluZyBpbiB0aGUgdmFsdWUgc3VjaCBhcyBgaHJlZj1cIi9wb3N0L3t7IHBvc3QuaWQgfX1cImAuXG4gICAgYm91bmQgPSBbXTtcbiAgICB2YXIgYXR0cmlidXRlcyA9IHNsaWNlLmNhbGwobm9kZS5hdHRyaWJ1dGVzKTtcbiAgICBmb3IgKGkgPSAwLCBsID0gYXR0cmlidXRlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGF0dHIgPSBhdHRyaWJ1dGVzW2ldO1xuICAgICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2F0dHJpYnV0ZScsIGF0dHIubmFtZSwgYXR0ci52YWx1ZSk7XG4gICAgICBpZiAoQmluZGVyKSB7XG4gICAgICAgIGJvdW5kLnB1c2goWyBCaW5kZXIsIGF0dHIgXSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gTWFrZSBzdXJlIHRvIGNyZWF0ZSBhbmQgcHJvY2VzcyB0aGVtIGluIHRoZSBjb3JyZWN0IHByaW9yaXR5IG9yZGVyIHNvIGlmIGEgYmluZGluZyBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tIHRoZVxuICAgIC8vIG5vZGUgaXQgZG9lc24ndCBwcm9jZXNzIHRoZSBvdGhlcnMuXG4gICAgYm91bmQuc29ydChzb3J0QXR0cmlidXRlcyk7XG5cbiAgICBmb3IgKGkgPSAwOyBpIDwgYm91bmQubGVuZ3RoOyBpKyspIHtcbiAgICAgIEJpbmRlciA9IGJvdW5kW2ldWzBdO1xuICAgICAgYXR0ciA9IGJvdW5kW2ldWzFdO1xuICAgICAgaWYgKCFub2RlLmhhc0F0dHJpYnV0ZShhdHRyLm5hbWUpKSB7XG4gICAgICAgIC8vIElmIHRoaXMgd2FzIHJlbW92ZWQgYWxyZWFkeSBieSBhbm90aGVyIGJpbmRpbmcsIGRvbid0IHByb2Nlc3MuXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdmFyIG5hbWUgPSBhdHRyLm5hbWU7XG4gICAgICB2YXIgdmFsdWUgPSBhdHRyLnZhbHVlO1xuICAgICAgaWYgKEJpbmRlci5leHByKSB7XG4gICAgICAgIG1hdGNoID0gbmFtZS5tYXRjaChCaW5kZXIuZXhwcik7XG4gICAgICAgIGlmIChtYXRjaCkgbWF0Y2ggPSBtYXRjaFsxXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1hdGNoID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0ci5uYW1lKTtcbiAgICAgIH0gY2F0Y2goZSkge1xuICAgICAgICAvLyBpZiB0aGUgYXR0cmlidXRlIHdhcyBhbHJlYWR5IHJlbW92ZWQgZG9uJ3Qgd29ycnlcbiAgICAgIH1cblxuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoe1xuICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICB2aWV3OiB2aWV3LFxuICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICBtYXRjaDogbWF0Y2gsXG4gICAgICAgIGV4cHJlc3Npb246IHZhbHVlID8gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIHZhbHVlKSA6IG51bGwsXG4gICAgICAgIGZyYWdtZW50czogZnJhZ21lbnRzXG4gICAgICB9KTtcblxuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH0gZWxzZSBpZiAoQmluZGVyICE9PSBEZWZhdWx0QmluZGVyICYmIGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCB2YWx1ZSkpIHtcbiAgICAgICAgLy8gUmV2ZXJ0IHRvIGRlZmF1bHQgaWYgdGhpcyBiaW5kaW5nIGRvZXNuJ3QgdGFrZVxuICAgICAgICBib3VuZC5wdXNoKFsgRGVmYXVsdEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG4vLyBTcGxpdHMgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW0gc28gdGhleSBjYW4gYmUgYm91bmQgaW5kaXZpZHVhbGx5LCBoYXMgcGFyZW50Tm9kZSBwYXNzZWQgaW4gc2luY2UgaXQgbWF5XG4vLyBiZSBhIGRvY3VtZW50IGZyYWdtZW50IHdoaWNoIGFwcGVhcnMgYXMgbnVsbCBvbiBub2RlLnBhcmVudE5vZGUuXG5mdW5jdGlvbiBzcGxpdFRleHROb2RlKGZyYWdtZW50cywgbm9kZSkge1xuICBpZiAoIW5vZGUucHJvY2Vzc2VkKSB7XG4gICAgbm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgIHZhciByZWdleCA9IGZyYWdtZW50cy5iaW5kZXJzLnRleHQuX2V4cHI7XG4gICAgdmFyIGNvbnRlbnQgPSBub2RlLm5vZGVWYWx1ZTtcbiAgICBpZiAoY29udGVudC5tYXRjaChyZWdleCkpIHtcbiAgICAgIHZhciBtYXRjaCwgbGFzdEluZGV4ID0gMCwgcGFydHMgPSBbXSwgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICB3aGlsZSAoKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkpIHtcbiAgICAgICAgcGFydHMucHVzaChjb250ZW50LnNsaWNlKGxhc3RJbmRleCwgcmVnZXgubGFzdEluZGV4IC0gbWF0Y2hbMF0ubGVuZ3RoKSk7XG4gICAgICAgIHBhcnRzLnB1c2gobWF0Y2hbMF0pO1xuICAgICAgICBsYXN0SW5kZXggPSByZWdleC5sYXN0SW5kZXg7XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4KSk7XG4gICAgICBwYXJ0cyA9IHBhcnRzLmZpbHRlcihub3RFbXB0eSk7XG5cbiAgICAgIG5vZGUubm9kZVZhbHVlID0gcGFydHNbMF07XG4gICAgICBmb3IgKHZhciBpID0gMTsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBuZXdUZXh0Tm9kZSA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHBhcnRzW2ldKTtcbiAgICAgICAgbmV3VGV4dE5vZGUucHJvY2Vzc2VkID0gdHJ1ZTtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobmV3VGV4dE5vZGUpO1xuICAgICAgfVxuICAgICAgbm9kZS5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbm9kZS5uZXh0U2libGluZyk7XG4gICAgfVxuICB9XG59XG5cblxuZnVuY3Rpb24gc29ydEF0dHJpYnV0ZXMoYSwgYikge1xuICByZXR1cm4gYlswXS5wcm90b3R5cGUucHJpb3JpdHkgLSBhWzBdLnByb3RvdHlwZS5wcmlvcml0eTtcbn1cblxuZnVuY3Rpb24gbm90RW1wdHkodmFsdWUpIHtcbiAgcmV0dXJuIEJvb2xlYW4odmFsdWUpO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBGcmFnbWVudHM7XG5yZXF1aXJlKCcuL3V0aWwvcG9seWZpbGxzJyk7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xudmFyIHRvRnJhZ21lbnQgPSByZXF1aXJlKCcuL3V0aWwvdG9GcmFnbWVudCcpO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBUZW1wbGF0ZSA9IHJlcXVpcmUoJy4vdGVtcGxhdGUnKTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIEFuaW1hdGVkQmluZGluZyA9IHJlcXVpcmUoJy4vYW5pbWF0ZWRCaW5kaW5nJyk7XG52YXIgY29tcGlsZSA9IHJlcXVpcmUoJy4vY29tcGlsZScpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEJpbmRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYmluZGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEZvcm1hdHRlcnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvZm9ybWF0dGVycycpO1xudmFyIHJlZ2lzdGVyRGVmYXVsdEFuaW1hdGlvbnMgPSByZXF1aXJlKCcuL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucycpO1xuXG4vKipcbiAqIEEgRnJhZ21lbnRzIG9iamVjdCBzZXJ2ZXMgYXMgYSByZWdpc3RyeSBmb3IgYmluZGVycyBhbmQgZm9ybWF0dGVyc1xuICogQHBhcmFtIHtbdHlwZV19IE9ic2VydmVyQ2xhc3MgW2Rlc2NyaXB0aW9uXVxuICovXG5mdW5jdGlvbiBGcmFnbWVudHMoT2JzZXJ2ZXJDbGFzcykge1xuICBpZiAoIU9ic2VydmVyQ2xhc3MpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNdXN0IHByb3ZpZGUgYW4gT2JzZXJ2ZXIgY2xhc3MgdG8gRnJhZ21lbnRzLicpO1xuICB9XG5cbiAgdGhpcy5PYnNlcnZlciA9IE9ic2VydmVyQ2xhc3M7XG4gIHRoaXMuZ2xvYmFscyA9IE9ic2VydmVyQ2xhc3MuZ2xvYmFscyA9IHt9O1xuICB0aGlzLmZvcm1hdHRlcnMgPSBPYnNlcnZlckNsYXNzLmZvcm1hdHRlcnMgPSB7fTtcbiAgdGhpcy5hbmltYXRpb25zID0ge307XG4gIHRoaXMuYW5pbWF0ZUF0dHJpYnV0ZSA9ICdhbmltYXRlJztcblxuICB0aGlzLmJpbmRlcnMgPSB7XG4gICAgZWxlbWVudDogeyBfd2lsZGNhcmRzOiBbXSB9LFxuICAgIGF0dHJpYnV0ZTogeyBfd2lsZGNhcmRzOiBbXSwgX2V4cHI6IC97e1xccyooLio/KVxccyp9fS9nIH0sXG4gICAgdGV4dDogeyBfd2lsZGNhcmRzOiBbXSwgX2V4cHI6IC97e1xccyooLio/KVxccyp9fS9nIH1cbiAgfTtcblxuICAvLyBUZXh0IGJpbmRlciBmb3IgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlclRleHQoJ19fZGVmYXVsdF9fJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSAodmFsdWUgIT0gbnVsbCkgPyB2YWx1ZSA6ICcnO1xuICB9KTtcblxuICAvLyBDYXRjaGFsbCBhdHRyaWJ1dGUgYmluZGVyIGZvciByZWd1bGFyIGF0dHJpYnV0ZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtXG4gIHRoaXMucmVnaXN0ZXJBdHRyaWJ1dGUoJ19fZGVmYXVsdF9fJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodmFsdWUgIT0gbnVsbCkge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZSh0aGlzLm5hbWUsIHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSh0aGlzLm5hbWUpO1xuICAgIH1cbiAgfSk7XG5cbiAgcmVnaXN0ZXJEZWZhdWx0QmluZGVycyh0aGlzKTtcbiAgcmVnaXN0ZXJEZWZhdWx0Rm9ybWF0dGVycyh0aGlzKTtcbiAgcmVnaXN0ZXJEZWZhdWx0QW5pbWF0aW9ucyh0aGlzKTtcbn1cblxuRnJhZ21lbnRzLnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogVGFrZXMgYW4gSFRNTCBzdHJpbmcsIGFuIGVsZW1lbnQsIGFuIGFycmF5IG9mIGVsZW1lbnRzLCBvciBhIGRvY3VtZW50IGZyYWdtZW50LCBhbmQgY29tcGlsZXMgaXQgaW50byBhIHRlbXBsYXRlLlxuICAgKiBJbnN0YW5jZXMgbWF5IHRoZW4gYmUgY3JlYXRlZCBhbmQgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICAgKiBAcGFyYW0ge1N0cmluZ3xOb2RlTGlzdHxIVE1MQ29sbGVjdGlvbnxIVE1MVGVtcGxhdGVFbGVtZW50fEhUTUxTY3JpcHRFbGVtZW50fE5vZGV9IGh0bWwgQSBUZW1wbGF0ZSBjYW4gYmUgY3JlYXRlZFxuICAgKiBmcm9tIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIG9iamVjdHMuIEFueSBvZiB0aGVzZSB3aWxsIGJlIGNvbnZlcnRlZCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQgZm9yIHRoZSB0ZW1wbGF0ZSB0b1xuICAgKiBjbG9uZS4gTm9kZXMgYW5kIGVsZW1lbnRzIHBhc3NlZCBpbiB3aWxsIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLlxuICAgKi9cbiAgY3JlYXRlVGVtcGxhdGU6IGZ1bmN0aW9uKGh0bWwpIHtcbiAgICB2YXIgZnJhZ21lbnQgPSB0b0ZyYWdtZW50KGh0bWwpO1xuICAgIGlmIChmcmFnbWVudC5jaGlsZE5vZGVzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgY3JlYXRlIGEgdGVtcGxhdGUgZnJvbSAnICsgaHRtbCk7XG4gICAgfVxuICAgIHZhciB0ZW1wbGF0ZSA9IGV4dGVuZC5tYWtlKFRlbXBsYXRlLCBmcmFnbWVudCk7XG4gICAgdGVtcGxhdGUuYmluZGluZ3MgPSBjb21waWxlKHRoaXMsIHRlbXBsYXRlKTtcbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYmluZGluZ3Mgb24gYW4gZWxlbWVudC5cbiAgICovXG4gIGNvbXBpbGVFbGVtZW50OiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgaWYgKCFlbGVtZW50LmJpbmRpbmdzKSB7XG4gICAgICBlbGVtZW50LmJpbmRpbmdzID0gY29tcGlsZSh0aGlzLCBlbGVtZW50KTtcbiAgICAgIGV4dGVuZC5tYWtlKFZpZXcsIGVsZW1lbnQsIGVsZW1lbnQpO1xuICAgIH1cblxuICAgIHJldHVybiBlbGVtZW50O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbXBpbGVzIGFuZCBiaW5kcyBhbiBlbGVtZW50IHdoaWNoIHdhcyBub3QgY3JlYXRlZCBmcm9tIGEgdGVtcGxhdGUuIE1vc3RseSBvbmx5IHVzZWQgZm9yIGJpbmRpbmcgdGhlIGRvY3VtZW50J3NcbiAgICogaHRtbCBlbGVtZW50LlxuICAgKi9cbiAgYmluZEVsZW1lbnQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGNvbnRleHQpIHtcbiAgICB0aGlzLmNvbXBpbGVFbGVtZW50KGVsZW1lbnQpO1xuXG4gICAgaWYgKGNvbnRleHQpIHtcbiAgICAgIGVsZW1lbnQuYmluZChjb250ZXh0KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZWxlbWVudDtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBPYnNlcnZlcyBhbiBleHByZXNzaW9uIHdpdGhpbiBhIGdpdmVuIGNvbnRleHQsIGNhbGxpbmcgdGhlIGNhbGxiYWNrIHdoZW4gaXQgY2hhbmdlcyBhbmQgcmV0dXJuaW5nIHRoZSBvYnNlcnZlci5cbiAgICovXG4gIG9ic2VydmU6IGZ1bmN0aW9uKGNvbnRleHQsIGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgICB2YXIgb2JzZXJ2ZXIgPSBuZXcgdGhpcy5PYnNlcnZlcihleHByLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KTtcbiAgICBvYnNlcnZlci5iaW5kKGNvbnRleHQsIHRydWUpO1xuICAgIHJldHVybiBvYnNlcnZlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBiaW5kZXIgZm9yIGEgZ2l2ZW4gdHlwZSBhbmQgbmFtZS4gQSBiaW5kZXIgaXMgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIGFuZCBpcyB1c2VkIHRvIGNyZWF0ZSBiaW5kaW5ncyBvblxuICAgKiBhbiBlbGVtZW50IG9yIHRleHQgbm9kZSB3aG9zZSB0YWcgbmFtZSwgYXR0cmlidXRlIG5hbWUsIG9yIGV4cHJlc3Npb24gY29udGVudHMgbWF0Y2ggdGhpcyBiaW5kZXIncyBuYW1lL2V4cHJlc3Npb24uXG4gICAqXG4gICAqICMjIyBQYXJhbWV0ZXJzXG4gICAqXG4gICAqICAqIGB0eXBlYDogdGhlcmUgYXJlIHRocmVlIHR5cGVzIG9mIGJpbmRlcnM6IGVsZW1lbnQsIGF0dHJpYnV0ZSwgb3IgdGV4dC4gVGhlc2UgY29ycmVzcG9uZCB0byBtYXRjaGluZyBhZ2FpbnN0IGFuXG4gICAqICAgIGVsZW1lbnQncyB0YWcgbmFtZSwgYW4gZWxlbWVudCB3aXRoIHRoZSBnaXZlbiBhdHRyaWJ1dGUgbmFtZSwgb3IgYSB0ZXh0IG5vZGUgdGhhdCBtYXRjaGVzIHRoZSBwcm92aWRlZFxuICAgKiAgICBleHByZXNzaW9uLlxuICAgKlxuICAgKiAgKiBgbmFtZWA6IHRvIG1hdGNoLCBhIGJpbmRlciBuZWVkcyB0aGUgbmFtZSBvZiBhbiBlbGVtZW50IG9yIGF0dHJpYnV0ZSwgb3IgYSByZWd1bGFyIGV4cHJlc3Npb24gdGhhdCBtYXRjaGVzIGFcbiAgICogICAgZ2l2ZW4gdGV4dCBub2RlLiBOYW1lcyBmb3IgZWxlbWVudHMgYW5kIGF0dHJpYnV0ZXMgY2FuIGJlIHJlZ3VsYXIgZXhwcmVzc2lvbnMgYXMgd2VsbCwgb3IgdGhleSBtYXkgYmUgd2lsZGNhcmRcbiAgICogICAgbmFtZXMgYnkgdXNpbmcgYW4gYXN0ZXJpc2suXG4gICAqXG4gICAqICAqIGBkZWZpbml0aW9uYDogYSBiaW5kZXIgaXMgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIHdoaWNoIG92ZXJyaWRlcyBrZXkgbWV0aG9kcywgYGNvbXBpbGVkYCwgYGNyZWF0ZWRgLCBgdXBkYXRlZGAsXG4gICAqICAgIGBib3VuZGAsIGFuZCBgdW5ib3VuZGAuIFRoZSBkZWZpbml0aW9uIG1heSBiZSBhbiBhY3R1YWwgc3ViY2xhc3Mgb2YgQmluZGluZyBvciBpdCBtYXkgYmUgYW4gb2JqZWN0IHdoaWNoIHdpbGwgYmVcbiAgICogICAgdXNlZCBmb3IgdGhlIHByb3RvdHlwZSBvZiB0aGUgbmV3bHkgY3JlYXRlZCBzdWJjbGFzcy4gRm9yIG1hbnkgYmluZGluZ3Mgb25seSB0aGUgYHVwZGF0ZWRgIG1ldGhvZCBpcyBvdmVycmlkZGVuLFxuICAgKiAgICBzbyBieSBqdXN0IHBhc3NpbmcgaW4gYSBmdW5jdGlvbiBmb3IgYGRlZmluaXRpb25gIHRoZSBiaW5kZXIgd2lsbCBiZSBjcmVhdGVkIHdpdGggdGhhdCBhcyBpdHMgYHVwZGF0ZWRgIG1ldGhvZC5cbiAgICpcbiAgICogIyMjIEV4cGxhaW5hdGlvbiBvZiBwcm9wZXJ0aWVzIGFuZCBtZXRob2RzXG4gICAqXG4gICAqICAgKiBgcHJpb3JpdHlgIG1heSBiZSBkZWZpbmVkIGFzIG51bWJlciB0byBpbnN0cnVjdCBzb21lIGJpbmRlcnMgdG8gYmUgcHJvY2Vzc2VkIGJlZm9yZSBvdGhlcnMuIEJpbmRlcnMgd2l0aFxuICAgKiAgIGhpZ2hlciBwcmlvcml0eSBhcmUgcHJvY2Vzc2VkIGZpcnN0LlxuICAgKlxuICAgKiAgICogYGFuaW1hdGVkYCBjYW4gYmUgc2V0IHRvIGB0cnVlYCB0byBleHRlbmQgdGhlIEFuaW1hdGVkQmluZGluZyBjbGFzcyB3aGljaCBwcm92aWRlcyBzdXBwb3J0IGZvciBhbmltYXRpb24gd2hlblxuICAgKiAgIGluc2VydGluZ2FuZCByZW1vdmluZyBub2RlcyBmcm9tIHRoZSBET00uIFRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IG9ubHkgKmFsbG93cyogYW5pbWF0aW9uIGJ1dCB0aGUgZWxlbWVudCBtdXN0XG4gICAqICAgaGF2ZSB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSB0byB1c2UgYW5pbWF0aW9uLiBBIGJpbmRpbmcgd2lsbCBoYXZlIHRoZSBgYW5pbWF0ZWAgcHJvcGVydHkgc2V0IHRvIHRydWUgd2hlbiBpdCBpc1xuICAgKiAgIHRvIGJlIGFuaW1hdGVkLiBCaW5kZXJzIHNob3VsZCBoYXZlIGZhc3QgcGF0aHMgZm9yIHdoZW4gYW5pbWF0aW9uIGlzIG5vdCB1c2VkIHJhdGhlciB0aGFuIGFzc3VtaW5nIGFuaW1hdGlvbiB3aWxsXG4gICAqICAgYmUgdXNlZC5cbiAgICpcbiAgICogQmluZGVyc1xuICAgKlxuICAgKiBBIGJpbmRlciBjYW4gaGF2ZSA1IG1ldGhvZHMgd2hpY2ggd2lsbCBiZSBjYWxsZWQgYXQgdmFyaW91cyBwb2ludHMgaW4gYSBiaW5kaW5nJ3MgbGlmZWN5Y2xlLiBNYW55IGJpbmRlcnMgd2lsbFxuICAgKiBvbmx5IHVzZSB0aGUgYHVwZGF0ZWQodmFsdWUpYCBtZXRob2QsIHNvIGNhbGxpbmcgcmVnaXN0ZXIgd2l0aCBhIGZ1bmN0aW9uIGluc3RlYWQgb2YgYW4gb2JqZWN0IGFzIGl0cyB0aGlyZFxuICAgKiBwYXJhbWV0ZXIgaXMgYSBzaG9ydGN1dCB0byBjcmVhdGluZyBhIGJpbmRlciB3aXRoIGp1c3QgYW4gYHVwZGF0ZWAgbWV0aG9kLlxuICAgKlxuICAgKiBMaXN0ZWQgaW4gb3JkZXIgb2Ygd2hlbiB0aGV5IG9jY3VyIGluIGEgYmluZGluZydzIGxpZmVjeWNsZTpcbiAgICpcbiAgICogICAqIGBjb21waWxlZChvcHRpb25zKWAgaXMgY2FsbGVkIHdoZW4gZmlyc3QgY3JlYXRpbmcgYSBiaW5kaW5nIGR1cmluZyB0aGUgdGVtcGxhdGUgY29tcGlsYXRpb24gcHJvY2VzcyBhbmQgcmVjZWl2ZXNcbiAgICogdGhlIGBvcHRpb25zYCBvYmplY3QgdGhhdCB3aWxsIGJlIHBhc3NlZCBpbnRvIGBuZXcgQmluZGluZyhvcHRpb25zKWAuIFRoaXMgY2FuIGJlIHVzZWQgZm9yIGNyZWF0aW5nIHRlbXBsYXRlcyxcbiAgICogbW9kaWZ5aW5nIHRoZSBET00gKG9ubHkgc3Vic2VxdWVudCBET00gdGhhdCBoYXNuJ3QgYWxyZWFkeSBiZWVuIHByb2Nlc3NlZCkgYW5kIG90aGVyIHRoaW5ncyB0aGF0IHNob3VsZCBiZVxuICAgKiBhcHBsaWVkIGF0IGNvbXBpbGUgdGltZSBhbmQgbm90IGR1cGxpY2F0ZWQgZm9yIGVhY2ggdmlldyBjcmVhdGVkLlxuICAgKlxuICAgKiAgICogYGNyZWF0ZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gYSBuZXcgdmlldyBpcyBjcmVhdGVkLiBUaGlzIGNhbiBiZSB1c2VkIHRvIGFkZCBldmVudCBsaXN0ZW5lcnMgb24gdGhlXG4gICAqIGVsZW1lbnQgb3IgZG8gb3RoZXIgdGhpbmdzIHRoYXQgd2lsbCBwZXJzaXN0ZSB3aXRoIHRoZSB2aWV3IHRocm91Z2ggaXRzIG1hbnkgdXNlcy4gVmlld3MgbWF5IGdldCByZXVzZWQgc28gZG9uJ3RcbiAgICogZG8gYW55dGhpbmcgaGVyZSB0byB0aWUgaXQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICAgKlxuICAgKiAgICogYGF0dGFjaGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIHRoZSB2aWV3IGlzIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dCBhbmQgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBUaGlzXG4gICAqIGNhbiBiZSB1c2VkIHRvIGhhbmRsZSBjb250ZXh0LXNwZWNpZmljIGFjdGlvbnMsIGFkZCBsaXN0ZW5lcnMgdG8gdGhlIHdpbmRvdyBvciBkb2N1bWVudCAodG8gYmUgcmVtb3ZlZCBpblxuICAgKiBgZGV0YWNoZWRgISksIGV0Yy5cbiAgICpcbiAgICogICAqIGB1cGRhdGVkKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlUmVjb3JkcylgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuZXZlciB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gd2l0aGluXG4gICAqIHRoZSBhdHRyaWJ1dGUgY2hhbmdlcy4gRm9yIGV4YW1wbGUsIGBiaW5kLXRleHQ9XCJ7e3VzZXJuYW1lfX1cImAgd2lsbCB0cmlnZ2VyIGB1cGRhdGVkYCB3aXRoIHRoZSB2YWx1ZSBvZiB1c2VybmFtZVxuICAgKiB3aGVuZXZlciBpdCBjaGFuZ2VzIG9uIHRoZSBnaXZlbiBjb250ZXh0LiBXaGVuIHRoZSB2aWV3IGlzIHJlbW92ZWQgYHVwZGF0ZWRgIHdpbGwgYmUgdHJpZ2dlcmVkIHdpdGggYSB2YWx1ZSBvZlxuICAgKiBgdW5kZWZpbmVkYCBpZiB0aGUgdmFsdWUgd2FzIG5vdCBhbHJlYWR5IGB1bmRlZmluZWRgLCBnaXZpbmcgYSBjaGFuY2UgdG8gXCJyZXNldFwiIHRvIGFuIGVtcHR5IHN0YXRlLlxuICAgKlxuICAgKiAgICogYGRldGFjaGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIHRoZSB2aWV3IGlzIHVuYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0IGFuZCByZW1vdmVkIGZyb20gdGhlIERPTS4gVGhpc1xuICAgKiBjYW4gYmUgdXNlZCB0byBjbGVhbiB1cCBhbnl0aGluZyBkb25lIGluIGBhdHRhY2hlZCgpYCBvciBpbiBgdXBkYXRlZCgpYCBiZWZvcmUgYmVpbmcgcmVtb3ZlZC5cbiAgICpcbiAgICogRWxlbWVudCBhbmQgYXR0cmlidXRlIGJpbmRlcnMgd2lsbCBhcHBseSB3aGVuZXZlciB0aGUgdGFnIG5hbWUgb3IgYXR0cmlidXRlIG5hbWUgaXMgbWF0Y2hlZC4gSW4gdGhlIGNhc2Ugb2ZcbiAgICogYXR0cmlidXRlIGJpbmRlcnMgaWYgeW91IG9ubHkgd2FudCBpdCB0byBtYXRjaCB3aGVuIGV4cHJlc3Npb25zIGFyZSB1c2VkIHdpdGhpbiB0aGUgYXR0cmlidXRlLCBhZGQgYG9ubHlXaGVuQm91bmRgXG4gICAqIHRvIHRoZSBkZWZpbml0aW9uLiBPdGhlcndpc2UgdGhlIGJpbmRlciB3aWxsIG1hdGNoIGFuZCB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gd2lsbCBzaW1wbHkgYmUgYSBzdHJpbmcgdGhhdFxuICAgKiBvbmx5IGNhbGxzIHVwZGF0ZWQgb25jZSBzaW5jZSBpdCB3aWxsIG5vdCBjaGFuZ2UuXG4gICAqXG4gICAqIE5vdGUsIGF0dHJpYnV0ZXMgd2hpY2ggbWF0Y2ggYSBiaW5kZXIgYXJlIHJlbW92ZWQgZHVyaW5nIGNvbXBpbGUuIFRoZXkgYXJlIGNvbnNpZGVyZWQgdG8gYmUgYmluZGluZyBkZWZpbml0aW9ucyBhbmRcbiAgICogbm90IHBhcnQgb2YgdGhlIGVsZW1lbnQuIEJpbmRpbmdzIG1heSBzZXQgdGhlIGF0dHJpYnV0ZSB3aGljaCBzZXJ2ZWQgYXMgdGhlaXIgZGVmaW5pdGlvbiBpZiBkZXNpcmVkLlxuICAgKlxuICAgKiAjIyMgRGVmYXVsdHNcbiAgICpcbiAgICogVGhlcmUgYXJlIGRlZmF1bHQgYmluZGVycyBmb3IgYXR0cmlidXRlIGFuZCB0ZXh0IG5vZGVzIHdoaWNoIGFwcGx5IHdoZW4gbm8gb3RoZXIgYmluZGVycyBtYXRjaC4gVGhleSBvbmx5IGFwcGx5IHRvXG4gICAqIGF0dHJpYnV0ZXMgYW5kIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtIChlLmcuIGB7e2Zvb319YCkuIFRoZSBkZWZhdWx0IGlzIHRvIHNldCB0aGUgYXR0cmlidXRlIG9yIHRleHRcbiAgICogbm9kZSdzIHZhbHVlIHRvIHRoZSByZXN1bHQgb2YgdGhlIGV4cHJlc3Npb24uIElmIHlvdSB3YW50ZWQgdG8gb3ZlcnJpZGUgdGhpcyBkZWZhdWx0IHlvdSBtYXkgcmVnaXN0ZXIgYSBiaW5kZXIgd2l0aFxuICAgKiB0aGUgbmFtZSBgXCJfX2RlZmF1bHRfX1wiYC5cbiAgICpcbiAgICogKipFeGFtcGxlOioqIFRoaXMgYmluZGluZyBoYW5kbGVyIGFkZHMgcGlyYXRlaXplZCB0ZXh0IHRvIGFuIGVsZW1lbnQuXG4gICAqIGBgYGphdmFzY3JpcHRcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJBdHRyaWJ1dGUoJ215LXBpcmF0ZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHtcbiAgICogICAgIHZhbHVlID0gJyc7XG4gICAqICAgfSBlbHNlIHtcbiAgICogICAgIHZhbHVlID0gdmFsdWVcbiAgICogICAgICAgLnJlcGxhY2UoL1xcQmluZ1xcYi9nLCBcImluJ1wiKVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxidG9cXGIvZywgXCJ0J1wiKVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxieW91XFxiLywgJ3llJylcbiAgICogICAgICAgKyAnIEFycnJyISc7XG4gICAqICAgfVxuICAgKiAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9IHZhbHVlO1xuICAgKiB9KTtcbiAgICogYGBgXG4gICAqXG4gICAqIGBgYGh0bWxcbiAgICogPHAgbXktcGlyYXRlPVwie3twb3N0LmJvZHl9fVwiPlRoaXMgdGV4dCB3aWxsIGJlIHJlcGxhY2VkLjwvcD5cbiAgICogYGBgXG4gICAqL1xuICByZWdpc3RlckVsZW1lbnQ6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlckF0dHJpYnV0ZTogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ3RleHQnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICB2YXIgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcbiAgICB2YXIgc3VwZXJDbGFzcyA9IGRlZmluaXRpb24uYW5pbWF0ZWQgPyBBbmltYXRlZEJpbmRpbmcgOiBCaW5kaW5nO1xuXG4gICAgaWYgKCFiaW5kZXJzKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdgdHlwZWAgbXVzdCBiZSBvbmUgb2YgJyArIE9iamVjdC5rZXlzKHRoaXMuYmluZGVycykuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWZpbml0aW9uID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBpZiAoZGVmaW5pdGlvbi5wcm90b3R5cGUgaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIHN1cGVyQ2xhc3MgPSBkZWZpbml0aW9uO1xuICAgICAgICBkZWZpbml0aW9uID0ge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWZpbml0aW9uID0geyB1cGRhdGVkOiBkZWZpbml0aW9uIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgPT09ICdfX2RlZmF1bHRfXycgJiYgIWRlZmluaXRpb24uaGFzT3duUHJvcGVydHkoJ3ByaW9yaXR5JykpIHtcbiAgICAgIGRlZmluaXRpb24ucHJpb3JpdHkgPSAtMTAwO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgKG9yIGFub3RoZXIgYmluZGVyKSB3aXRoIHRoZSBkZWZpbml0aW9uXG4gICAgZnVuY3Rpb24gQmluZGVyKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgICBkZWZpbml0aW9uLk9ic2VydmVyID0gdGhpcy5PYnNlcnZlcjtcbiAgICBzdXBlckNsYXNzLmV4dGVuZChCaW5kZXIsIGRlZmluaXRpb24pO1xuXG4gICAgdmFyIGV4cHI7XG4gICAgaWYgKG5hbWUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGV4cHIgPSBuYW1lO1xuICAgIH0gZWxzZSBpZiAobmFtZS5pbmRleE9mKCcqJykgPj0gMCkge1xuICAgICAgZXhwciA9IG5ldyBSZWdFeHAoJ14nICsgZXNjYXBlUmVnRXhwKG5hbWUpLnJlcGxhY2UoJ1xcXFwqJywgJyguKiknKSArICckJyk7XG4gICAgfVxuXG4gICAgaWYgKGV4cHIpIHtcbiAgICAgIEJpbmRlci5leHByID0gZXhwcjtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5wdXNoKEJpbmRlcik7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMuc29ydCh0aGlzLmJpbmRpbmdTb3J0KTtcbiAgICB9XG5cbiAgICBCaW5kZXIubmFtZSA9ICcnICsgbmFtZTtcbiAgICBiaW5kZXJzW25hbWVdID0gQmluZGVyO1xuICAgIHJldHVybiBCaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIGJpbmRlciB0aGF0IHdhcyBhZGRlZCB3aXRoIGByZWdpc3RlcigpYC4gSWYgYW4gUmVnRXhwIHdhcyB1c2VkIGluIHJlZ2lzdGVyIGZvciB0aGUgbmFtZSBpdCBtdXN0IGJlIHVzZWRcbiAgICogdG8gdW5yZWdpc3RlciwgYnV0IGl0IGRvZXMgbm90IG5lZWQgdG8gYmUgdGhlIHNhbWUgaW5zdGFuY2UuXG4gICAqL1xuICB1bnJlZ2lzdGVyRWxlbWVudDogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlckF0dHJpYnV0ZTogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyVGV4dDogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ3RleHQnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlckJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSkge1xuICAgIHZhciBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCBuYW1lKSwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcbiAgICBpZiAoIWJpbmRlcikgcmV0dXJuO1xuICAgIGlmIChiaW5kZXIuZXhwcikge1xuICAgICAgdmFyIGluZGV4ID0gYmluZGVycy5fd2lsZGNhcmRzLmluZGV4T2YoYmluZGVyKTtcbiAgICAgIGlmIChpbmRleCA+PSAwKSBiaW5kZXJzLl93aWxkY2FyZHMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gICAgZGVsZXRlIGJpbmRlcnNbbmFtZV07XG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgIGJ5IHR5cGUgYW5kIG5hbWUuXG4gICAqL1xuICBnZXRFbGVtZW50QmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdlbGVtZW50JywgbmFtZSk7XG4gIH0sXG4gIGdldEF0dHJpYnV0ZUJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIGdldFRleHRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ3RleHQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAobmFtZSAmJiBiaW5kZXJzLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICByZXR1cm4gYmluZGVyc1tuYW1lXTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogRmluZCBhIG1hdGNoaW5nIGJpbmRlciBmb3IgdGhlIGdpdmVuIHR5cGUuIEVsZW1lbnRzIHNob3VsZCBvbmx5IHByb3ZpZGUgbmFtZS4gQXR0cmlidXRlcyBzaG91bGQgcHJvdmlkZSB0aGUgbmFtZVxuICAgKiBhbmQgdmFsdWUgKHZhbHVlIHNvIHRoZSBkZWZhdWx0IGNhbiBiZSByZXR1cm5lZCBpZiBhbiBleHByZXNzaW9uIGV4aXN0cyBpbiB0aGUgdmFsdWUpLiBUZXh0IG5vZGVzIHNob3VsZCBvbmx5XG4gICAqIHByb3ZpZGUgdGhlIHZhbHVlIChpbiBwbGFjZSBvZiB0aGUgbmFtZSkgYW5kIHdpbGwgcmV0dXJuIHRoZSBkZWZhdWx0IGlmIG5vIGJpbmRlcnMgbWF0Y2guXG4gICAqL1xuICBmaW5kQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlID09PSAndGV4dCcgJiYgdmFsdWUgPT0gbnVsbCkge1xuICAgICAgdmFsdWUgPSBuYW1lO1xuICAgICAgbmFtZSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuXG4gICAgaWYgKCFiaW5kZXIpIHtcbiAgICAgIHZhciB0b01hdGNoID0gKHR5cGUgPT09ICd0ZXh0JykgPyB2YWx1ZSA6IG5hbWU7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMuc29tZShmdW5jdGlvbih3aWxkY2FyZEJpbmRlcikge1xuICAgICAgICBpZiAodG9NYXRjaC5tYXRjaCh3aWxkY2FyZEJpbmRlci5leHByKSkge1xuICAgICAgICAgIGJpbmRlciA9IHdpbGRjYXJkQmluZGVyO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmluZGVyICYmIHR5cGUgPT09ICdhdHRyaWJ1dGUnICYmIGJpbmRlci5wcm90b3R5cGUub25seVdoZW5Cb3VuZCAmJiAhdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkge1xuICAgICAgLy8gZG9uJ3QgdXNlIHRoZSBgdmFsdWVgIGJpbmRlciBpZiB0aGVyZSBpcyBubyBleHByZXNzaW9uIGluIHRoZSBhdHRyaWJ1dGUgdmFsdWUgKGUuZy4gYHZhbHVlPVwic29tZSB0ZXh0XCJgKVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChuYW1lID09PSB0aGlzLmFuaW1hdGVBdHRyaWJ1dGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIWJpbmRlciAmJiB2YWx1ZSAmJiAodHlwZSA9PT0gJ3RleHQnIHx8IHRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpKSB7XG4gICAgICAvLyBUZXN0IGlmIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgYm91bmQgKGUuZy4gYGhyZWY9XCIvcG9zdHMve3sgcG9zdC5pZCB9fVwiYClcbiAgICAgIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsICdfX2RlZmF1bHRfXycpO1xuICAgIH1cblxuICAgIHJldHVybiBiaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogQSBGb3JtYXR0ZXIgaXMgc3RvcmVkIHRvIHByb2Nlc3MgdGhlIHZhbHVlIG9mIGFuIGV4cHJlc3Npb24uIFRoaXMgYWx0ZXJzIHRoZSB2YWx1ZSBvZiB3aGF0IGNvbWVzIGluIHdpdGggYSBmdW5jdGlvblxuICAgKiB0aGF0IHJldHVybnMgYSBuZXcgdmFsdWUuIEZvcm1hdHRlcnMgYXJlIGFkZGVkIGJ5IHVzaW5nIGEgc2luZ2xlIHBpcGUgY2hhcmFjdGVyIChgfGApIGZvbGxvd2VkIGJ5IHRoZSBuYW1lIG9mIHRoZVxuICAgKiBmb3JtYXR0ZXIuIE11bHRpcGxlIGZvcm1hdHRlcnMgY2FuIGJlIHVzZWQgYnkgY2hhaW5pbmcgcGlwZXMgd2l0aCBmb3JtYXR0ZXIgbmFtZXMuIEZvcm1hdHRlcnMgbWF5IGFsc28gaGF2ZVxuICAgKiBhcmd1bWVudHMgcGFzc2VkIHRvIHRoZW0gYnkgdXNpbmcgdGhlIGNvbG9uIHRvIHNlcGFyYXRlIGFyZ3VtZW50cyBmcm9tIHRoZSBmb3JtYXR0ZXIgbmFtZS4gVGhlIHNpZ25hdHVyZSBvZiBhXG4gICAqIGZvcm1hdHRlciBzaG91bGQgYmUgYGZ1bmN0aW9uKHZhbHVlLCBhcmdzLi4uKWAgd2hlcmUgYXJncyBhcmUgZXh0cmEgcGFyYW1ldGVycyBwYXNzZWQgaW50byB0aGUgZm9ybWF0dGVyIGFmdGVyXG4gICAqIGNvbG9ucy5cbiAgICpcbiAgICogKkV4YW1wbGU6KlxuICAgKiBgYGBqc1xuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcigndXBwZXJjYXNlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUudG9VcHBlcmNhc2UoKVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcigncmVwbGFjZScsIGZ1bmN0aW9uKHZhbHVlLCByZXBsYWNlLCB3aXRoKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPSAnc3RyaW5nJykgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlLnJlcGxhY2UocmVwbGFjZSwgd2l0aClcbiAgICogfSlcbiAgICogYGBgaHRtbFxuICAgKiA8aDEgYmluZC10ZXh0PVwidGl0bGUgfCB1cHBlcmNhc2UgfCByZXBsYWNlOidMRVRURVInOidOVU1CRVInXCI+PC9oMT5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5HRVRUSU5HIFRPIEtOT1cgQUxMIEFCT1VUIFRIRSBOVU1CRVIgQTwvaDE+XG4gICAqIGBgYFxuICAgKiBUT0RPOiBvbGQgZG9jcywgcmV3cml0ZSwgdGhlcmUgaXMgYW4gZXh0cmEgYXJndW1lbnQgbmFtZWQgYHNldHRlcmAgd2hpY2ggd2lsbCBiZSB0cnVlIHdoZW4gdGhlIGV4cHJlc3Npb24gaXMgYmVpbmcgXCJzZXRcIiBpbnN0ZWFkIG9mIFwiZ2V0XCJcbiAgICogQSBgdmFsdWVGb3JtYXR0ZXJgIGlzIGxpa2UgYSBmb3JtYXR0ZXIgYnV0IHVzZWQgc3BlY2lmaWNhbGx5IHdpdGggdGhlIGB2YWx1ZWAgYmluZGluZyBzaW5jZSBpdCBpcyBhIHR3by13YXkgYmluZGluZy4gV2hlblxuICAgKiB0aGUgdmFsdWUgb2YgdGhlIGVsZW1lbnQgaXMgY2hhbmdlZCBhIGB2YWx1ZUZvcm1hdHRlcmAgY2FuIGFkanVzdCB0aGUgdmFsdWUgZnJvbSBhIHN0cmluZyB0byB0aGUgY29ycmVjdCB2YWx1ZSB0eXBlIGZvclxuICAgKiB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLiBUaGUgc2lnbmF0dXJlIGZvciBhIGB2YWx1ZUZvcm1hdHRlcmAgaW5jbHVkZXMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb25cbiAgICogYmVmb3JlIHRoZSBvcHRpb25hbCBhcmd1bWVudHMgKGlmIGFueSkuIFRoaXMgYWxsb3dzIGRhdGVzIHRvIGJlIGFkanVzdGVkIGFuZCBwb3NzaWJsZXkgb3RoZXIgdXNlcy5cbiAgICpcbiAgICogKkV4YW1wbGU6KlxuICAgKiBgYGBqc1xuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignbnVtZXJpYycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgLy8gdmFsdWUgY29taW5nIGZyb20gdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbiwgdG8gYmUgc2V0IG9uIHRoZSBlbGVtZW50XG4gICAqICAgaWYgKHZhbHVlID09IG51bGwgfHwgaXNOYU4odmFsdWUpKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWVcbiAgICogfSlcbiAgICpcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUtaG91cicsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgLy8gdmFsdWUgY29taW5nIGZyb20gdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbiwgdG8gYmUgc2V0IG9uIHRoZSBlbGVtZW50XG4gICAqICAgaWYgKCAhKGN1cnJlbnRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpICkgcmV0dXJuICcnXG4gICAqICAgdmFyIGhvdXJzID0gdmFsdWUuZ2V0SG91cnMoKVxuICAgKiAgIGlmIChob3VycyA+PSAxMikgaG91cnMgLT0gMTJcbiAgICogICBpZiAoaG91cnMgPT0gMCkgaG91cnMgPSAxMlxuICAgKiAgIHJldHVybiBob3Vyc1xuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5OdW1iZXIgQXR0ZW5kaW5nOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiNFwiIGJpbmQtdmFsdWU9XCJldmVudC5hdHRlbmRlZUNvdW50IHwgbnVtZXJpY1wiPlxuICAgKiA8bGFiZWw+VGltZTo8L2xhYmVsPlxuICAgKiA8aW5wdXQgc2l6ZT1cIjJcIiBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtaG91clwiPiA6XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1taW51dGVcIj5cbiAgICogPHNlbGVjdCBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtYW1wbVwiPlxuICAgKiAgIDxvcHRpb24+QU08L29wdGlvbj5cbiAgICogICA8b3B0aW9uPlBNPC9vcHRpb24+XG4gICAqIDwvc2VsZWN0PlxuICAgKiBgYGBcbiAgICovXG4gIHJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSwgZm9ybWF0dGVyKSB7XG4gICAgdGhpcy5mb3JtYXR0ZXJzW25hbWVdID0gZm9ybWF0dGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGEgZm9ybWF0dGVyLlxuICAgKi9cbiAgdW5yZWdpc3RlckZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5mb3JtYXR0ZXJzW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEdldHMgYSByZWdpc3RlcmVkIGZvcm1hdHRlci5cbiAgICovXG4gIGdldEZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5mb3JtYXR0ZXJzW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEFuIEFuaW1hdGlvbiBpcyBzdG9yZWQgdG8gaGFuZGxlIGFuaW1hdGlvbnMuIEEgcmVnaXN0ZXJlZCBhbmltYXRpb24gaXMgYW4gb2JqZWN0IChvciBjbGFzcyB3aGljaCBpbnN0YW50aWF0ZXMgaW50b1xuICAgKiBhbiBvYmplY3QpIHdpdGggdGhlIG1ldGhvZHM6XG4gICAqICAgKiBgd2lsbEFuaW1hdGVJbihlbGVtZW50KWBcbiAgICogICAqIGBhbmltYXRlSW4oZWxlbWVudCwgY2FsbGJhY2spYFxuICAgKiAgICogYGRpZEFuaW1hdGVJbihlbGVtZW50KWBcbiAgICogICAqIGB3aWxsQW5pbWF0ZU91dChlbGVtZW50KWBcbiAgICogICAqIGBhbmltYXRlT3V0KGVsZW1lbnQsIGNhbGxiYWNrKWBcbiAgICogICAqIGBkaWRBbmltYXRlT3V0KGVsZW1lbnQpYFxuICAgKlxuICAgKiBBbmltYXRpb24gaXMgaW5jbHVkZWQgd2l0aCBiaW5kZXJzIHdoaWNoIGFyZSByZWdpc3RlcmVkIHdpdGggdGhlIGBhbmltYXRlZGAgcHJvcGVydHkgc2V0IHRvIGB0cnVlYCAoc3VjaCBhcyBgaWZgXG4gICAqIGFuZCBgcmVwZWF0YCkuIEFuaW1hdGlvbnMgYWxsb3cgZWxlbWVudHMgdG8gZmFkZSBpbiwgZmFkZSBvdXQsIHNsaWRlIGRvd24sIGNvbGxhcHNlLCBtb3ZlIGZyb20gb25lIGxvY2F0aW9uIGluIGFcbiAgICogbGlzdCB0byBhbm90aGVyLCBhbmQgbW9yZS5cbiAgICpcbiAgICogVG8gdXNlIGFuaW1hdGlvbiBhZGQgYW4gYXR0cmlidXRlIG5hbWVkIGBhbmltYXRlYCBvbnRvIGFuIGVsZW1lbnQgd2l0aCBhIHN1cHBvcnRlZCBiaW5kZXIuXG4gICAqXG4gICAqICMjIyBDU1MgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBJZiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBkb2VzIG5vdCBoYXZlIGEgdmFsdWUgb3IgdGhlIHZhbHVlIGlzIGEgY2xhc3MgbmFtZSAoZS5nLiBgYW5pbWF0ZT1cIi5teS1mYWRlXCJgKSB0aGVuXG4gICAqIGZyYWdtZW50cyB3aWxsIHVzZSBhIENTUyB0cmFuc2l0aW9uL2FuaW1hdGlvbi4gQ2xhc3NlcyB3aWxsIGJlIGFkZGVkIGFuZCByZW1vdmVkIHRvIHRyaWdnZXIgdGhlIGFuaW1hdGlvbi5cbiAgICpcbiAgICogICAqIGAud2lsbC1hbmltYXRlLWluYCBpcyBhZGRlZCByaWdodCBhZnRlciBhbiBlbGVtZW50IGlzIGluc2VydGVkIGludG8gdGhlIERPTS4gVGhpcyBjYW4gYmUgdXNlZCB0byBzZXQgdGhlXG4gICAqICAgICBvcGFjaXR5IHRvIGAwLjBgIGZvciBleGFtcGxlLiBJdCBpcyB0aGVuIHJlbW92ZWQgb24gdGhlIG5leHQgYW5pbWF0aW9uIGZyYW1lLlxuICAgKiAgICogYC5hbmltYXRlLWluYCBpcyB3aGVuIGAud2lsbC1hbmltYXRlLWluYCBpcyByZW1vdmVkLiBJdCBjYW4gYmUgdXNlZCB0byBzZXQgb3BhY2l0eSB0byBgMS4wYCBmb3IgZXhhbXBsZS4gVGhlXG4gICAqICAgICBgYW5pbWF0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IG9uIHRoaXMgY2xhc3MgaWYgdXNpbmcgaXQuIFRoZSBgdHJhbnNpdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBoZXJlLiBOb3RlIHRoYXRcbiAgICogICAgIGFsdGhvdWdoIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHBsYWNlZCBvbiBhbiBlbGVtZW50IHdpdGggdGhlIGByZXBlYXRgIGJpbmRlciwgdGhlc2UgY2xhc3NlcyBhcmUgYWRkZWQgdG9cbiAgICogICAgIGl0cyBjaGlsZHJlbiBhcyB0aGV5IGdldCBhZGRlZCBhbmQgcmVtb3ZlZC5cbiAgICogICAqIGAud2lsbC1hbmltYXRlLW91dGAgaXMgYWRkZWQgYmVmb3JlIGFuIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00uIFRoaXMgY2FuIGJlIHVzZWQgdG8gc2V0IHRoZSBvcGFjaXR5IHRvXG4gICAqICAgICBgMWAgZm9yIGV4YW1wbGUuIEl0IGlzIHRoZW4gcmVtb3ZlZCBvbiB0aGUgbmV4dCBhbmltYXRpb24gZnJhbWUuXG4gICAqICAgKiBgLmFuaW1hdGUtb3V0YCBpcyBhZGRlZCB3aGVuIGAud2lsbC1hbmltYXRlLW91dGAgaXMgcmVtb3ZlZC4gSXQgY2FuIGJlIHVzZWQgdG8gc2V0IG9wYWNpdHkgdG8gYDAuMGAgZm9yXG4gICAqICAgICBleGFtcGxlLiBUaGUgYGFuaW1hdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBvbiB0aGlzIGNsYXNzIGlmIHVzaW5nIGl0LiBUaGUgYHRyYW5zaXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgaGVyZSBvclxuICAgKiAgICAgb24gYW5vdGhlciBzZWxlY3RvciB0aGF0IG1hdGNoZXMgdGhlIGVsZW1lbnQuIE5vdGUgdGhhdCBhbHRob3VnaCB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBwbGFjZWQgb24gYW5cbiAgICogICAgIGVsZW1lbnQgd2l0aCB0aGUgYHJlcGVhdGAgYmluZGVyLCB0aGVzZSBjbGFzc2VzIGFyZSBhZGRlZCB0byBpdHMgY2hpbGRyZW4gYXMgdGhleSBnZXQgYWRkZWQgYW5kIHJlbW92ZWQuXG4gICAqXG4gICAqIElmIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHNldCB0byBhIGNsYXNzIG5hbWUgKGUuZy4gYGFuaW1hdGU9XCIubXktZmFkZVwiYCkgdGhlbiB0aGF0IGNsYXNzIG5hbWUgd2lsbCBiZSBhZGRlZCBhc1xuICAgKiBhIGNsYXNzIHRvIHRoZSBlbGVtZW50IGR1cmluZyBhbmltYXRpb24uIFRoaXMgYWxsb3dzIHlvdSB0byB1c2UgYC5teS1mYWRlLndpbGwtYW5pbWF0ZS1pbmAsIGAubXktZmFkZS5hbmltYXRlLWluYCxcbiAgICogZXRjLiBpbiB5b3VyIHN0eWxlc2hlZXRzIHRvIHVzZSB0aGUgc2FtZSBhbmltYXRpb24gdGhyb3VnaG91dCB5b3VyIGFwcGxpY2F0aW9uLlxuICAgKlxuICAgKiAjIyMgSmF2YVNjcmlwdCBBbmltYXRpb25zXG4gICAqXG4gICAqIElmIHlvdSBuZWVkIGdyZWF0ZXIgY29udHJvbCBvdmVyIHlvdXIgYW5pbWF0aW9ucyBKYXZhU2NyaXB0IG1heSBiZSB1c2VkLiBJdCBpcyByZWNvbW1lbmRlZCB0aGF0IENTUyBzdHlsZXMgc3RpbGwgYmVcbiAgICogdXNlZCBieSBoYXZpbmcgeW91ciBjb2RlIHNldCB0aGVtIG1hbnVhbGx5LiBUaGlzIGFsbG93cyB0aGUgYW5pbWF0aW9uIHRvIHRha2UgYWR2YW50YWdlIG9mIHRoZSBicm93c2VyXG4gICAqIG9wdGltaXphdGlvbnMgc3VjaCBhcyBoYXJkd2FyZSBhY2NlbGVyYXRpb24uIFRoaXMgaXMgbm90IGEgcmVxdWlyZW1lbnQuXG4gICAqXG4gICAqIEluIG9yZGVyIHRvIHVzZSBKYXZhU2NyaXB0IGFuIG9iamVjdCBzaG91bGQgYmUgcGFzc2VkIGludG8gdGhlIGBhbmltYXRpb25gIGF0dHJpYnV0ZSB1c2luZyBhbiBleHByZXNzaW9uLiBUaGlzXG4gICAqIG9iamVjdCBzaG91bGQgaGF2ZSBtZXRob2RzIHRoYXQgYWxsb3cgSmF2YVNjcmlwdCBhbmltYXRpb24gaGFuZGxpbmcuIEZvciBleGFtcGxlLCBpZiB5b3UgYXJlIGJvdW5kIHRvIGEgY29udGV4dFxuICAgKiB3aXRoIGFuIG9iamVjdCBuYW1lZCBgY3VzdG9tRmFkZWAgd2l0aCBhbmltYXRpb24gbWV0aG9kcywgeW91ciBlbGVtZW50IHNob3VsZCBoYXZlIGBhdHRyaWJ1dGU9XCJ7e2N1c3RvbUZhZGV9fVwiYC5cbiAgICogVGhlIGZvbGxvd2luZyBpcyBhIGxpc3Qgb2YgdGhlIG1ldGhvZHMgeW91IG1heSBpbXBsZW1lbnQuXG4gICAqXG4gICAqICAgKiBgd2lsbEFuaW1hdGVJbihlbGVtZW50KWAgd2lsbCBiZSBjYWxsZWQgYWZ0ZXIgYW4gZWxlbWVudCBoYXMgYmVlbiBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFVzZSBpdCB0byBzZXQgaW5pdGlhbFxuICAgKiAgICAgQ1NTIHByb3BlcnRpZXMgYmVmb3JlIGBhbmltYXRlSW5gIGlzIGNhbGxlZCB0byBzZXQgdGhlIGZpbmFsIHByb3BlcnRpZXMuIFRoaXMgbWV0aG9kIGlzIG9wdGlvbmFsLlxuICAgKiAgICogYGFuaW1hdGVJbihlbGVtZW50LCBjYWxsYmFjaylgIHdpbGwgYmUgY2FsbGVkIHNob3J0bHkgYWZ0ZXIgYHdpbGxBbmltYXRlSW5gIGlmIGl0IHdhcyBkZWZpbmVkLiBVc2UgaXQgdG8gc2V0XG4gICAqICAgICBmaW5hbCBDU1MgcHJvcGVydGllcy5cbiAgICogICAqIGBhbmltYXRlT3V0KGVsZW1lbnQsIGRvbmUpYCB3aWxsIGJlIGNhbGxlZCBiZWZvcmUgYW4gZWxlbWVudCBpcyB0byBiZSByZW1vdmVkIGZyb20gdGhlIERPTS4gYGRvbmVgIG11c3QgYmVcbiAgICogICAgIGNhbGxlZCB3aGVuIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUgaW4gb3JkZXIgZm9yIHRoZSBiaW5kZXIgdG8gZmluaXNoIHJlbW92aW5nIHRoZSBlbGVtZW50LiAqKlJlbWVtYmVyKiogdG9cbiAgICogICAgIGNsZWFuIHVwIGJ5IHJlbW92aW5nIGFueSBzdHlsZXMgdGhhdCB3ZXJlIGFkZGVkIGJlZm9yZSBjYWxsaW5nIGBkb25lKClgIHNvIHRoZSBlbGVtZW50IGNhbiBiZSByZXVzZWQgd2l0aG91dFxuICAgKiAgICAgc2lkZS1lZmZlY3RzLlxuICAgKlxuICAgKiBUaGUgYGVsZW1lbnRgIHBhc3NlZCBpbiB3aWxsIGJlIHBvbHlmaWxsZWQgZm9yIHdpdGggdGhlIGBhbmltYXRlYCBtZXRob2QgdXNpbmdcbiAgICogaHR0cHM6Ly9naXRodWIuY29tL3dlYi1hbmltYXRpb25zL3dlYi1hbmltYXRpb25zLWpzLlxuICAgKlxuICAgKiAjIyMgUmVnaXN0ZXJlZCBBbmltYXRpb25zXG4gICAqXG4gICAqIEFuaW1hdGlvbnMgbWF5IGJlIHJlZ2lzdGVyZWQgYW5kIHVzZWQgdGhyb3VnaG91dCB5b3VyIGFwcGxpY2F0aW9uLiBUbyB1c2UgYSByZWdpc3RlcmVkIGFuaW1hdGlvbiB1c2UgaXRzIG5hbWUgaW5cbiAgICogdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgKGUuZy4gYGFuaW1hdGU9XCJmYWRlXCJgKS4gTm90ZSB0aGUgb25seSBkaWZmZXJlbmNlIGJldHdlZW4gYSByZWdpc3RlcmVkIGFuaW1hdGlvbiBhbmQgYVxuICAgKiBjbGFzcyByZWdpc3RyYXRpb24gaXMgY2xhc3MgcmVnaXN0cmF0aW9ucyBhcmUgcHJlZml4ZWQgd2l0aCBhIGRvdCAoYC5gKS4gUmVnaXN0ZXJlZCBhbmltYXRpb25zIGFyZSBhbHdheXNcbiAgICogSmF2YVNjcmlwdCBhbmltYXRpb25zLiBUbyByZWdpc3RlciBhbiBhbmltYXRpb24gdXNlIGBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSwgYW5pbWF0aW9uT2JqZWN0KWAuXG4gICAqXG4gICAqIFRoZSBBbmltYXRpb24gbW9kdWxlIGNvbWVzIHdpdGggc2V2ZXJhbCBjb21tb24gYW5pbWF0aW9ucyByZWdpc3RlcmVkIGJ5IGRlZmF1bHQuIFRoZSBkZWZhdWx0cyB1c2UgQ1NTIHN0eWxlcyB0b1xuICAgKiB3b3JrIGNvcnJlY3RseSwgdXNpbmcgYGVsZW1lbnQuYW5pbWF0ZWAuXG4gICAqXG4gICAqICAgKiBgZmFkZWAgd2lsbCBmYWRlIGFuIGVsZW1lbnQgaW4gYW5kIG91dCBvdmVyIDMwMCBtaWxsaXNlY29uZHMuXG4gICAqICAgKiBgc2xpZGVgIHdpbGwgc2xpZGUgYW4gZWxlbWVudCBkb3duIHdoZW4gaXQgaXMgYWRkZWQgYW5kIHNsaWRlIGl0IHVwIHdoZW4gaXQgaXMgcmVtb3ZlZC5cbiAgICogICAqIGBzbGlkZS1tb3ZlYCB3aWxsIG1vdmUgYW4gZWxlbWVudCBmcm9tIGl0cyBvbGQgbG9jYXRpb24gdG8gaXRzIG5ldyBsb2NhdGlvbiBpbiBhIHJlcGVhdGVkIGxpc3QuXG4gICAqXG4gICAqIERvIHlvdSBoYXZlIGFub3RoZXIgY29tbW9uIGFuaW1hdGlvbiB5b3UgdGhpbmsgc2hvdWxkIGJlIGluY2x1ZGVkIGJ5IGRlZmF1bHQ/IFN1Ym1pdCBhIHB1bGwgcmVxdWVzdCFcbiAgICovXG4gIHJlZ2lzdGVyQW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lLCBhbmltYXRpb25PYmplY3QpIHtcbiAgICB0aGlzLmFuaW1hdGlvbnNbbmFtZV0gPSBhbmltYXRpb25PYmplY3Q7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYW4gYW5pbWF0aW9uLlxuICAgKi9cbiAgdW5yZWdpc3RlckFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSkge1xuICAgIGRlbGV0ZSB0aGlzLmFuaW1hdGlvbnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogR2V0cyBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uLlxuICAgKi9cbiAgZ2V0QW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuYW5pbWF0aW9uc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBQcmVwYXJlIGFuIGVsZW1lbnQgdG8gYmUgZWFzaWVyIGFuaW1hdGFibGUgKGFkZGluZyBhIHNpbXBsZSBgYW5pbWF0ZWAgcG9seWZpbGwgaWYgbmVlZGVkKVxuICAgKi9cbiAgbWFrZUVsZW1lbnRBbmltYXRhYmxlOiBhbmltYXRpb24ubWFrZUVsZW1lbnRBbmltYXRhYmxlLFxuXG5cbiAgLyoqXG4gICAqIFNldHMgdGhlIGRlbGltaXRlcnMgdGhhdCBkZWZpbmUgYW4gZXhwcmVzc2lvbi4gRGVmYXVsdCBpcyBge3tgIGFuZCBgfX1gIGJ1dCB0aGlzIG1heSBiZSBvdmVycmlkZGVuLiBJZiBlbXB0eVxuICAgKiBzdHJpbmdzIGFyZSBwYXNzZWQgaW4gKGZvciB0eXBlIFwiYXR0cmlidXRlXCIgb25seSkgdGhlbiBubyBkZWxpbWl0ZXJzIGFyZSByZXF1aXJlZCBmb3IgbWF0Y2hpbmcgYXR0cmlidXRlcywgYnV0IHRoZVxuICAgKiBkZWZhdWx0IGF0dHJpYnV0ZSBtYXRjaGVyIHdpbGwgbm90IGFwcGx5IHRvIHRoZSByZXN0IG9mIHRoZSBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgc2V0RXhwcmVzc2lvbkRlbGltaXRlcnM6IGZ1bmN0aW9uKHR5cGUsIHByZSwgcG9zdCkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0V4cHJlc3Npb24gZGVsaW1pdGVycyBtdXN0IGJlIG9mIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cblxuICAgIHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwciA9IG5ldyBSZWdFeHAoZXNjYXBlUmVnRXhwKHByZSkgKyAnKC4qPyknICsgZXNjYXBlUmVnRXhwKHBvc3QpLCAnZycpO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFRlc3RzIHdoZXRoZXIgYSB2YWx1ZSBoYXMgYW4gZXhwcmVzc2lvbiBpbiBpdC4gU29tZXRoaW5nIGxpa2UgYC91c2VyL3t7dXNlci5pZH19YC5cbiAgICovXG4gIGlzQm91bmQ6IGZ1bmN0aW9uKHR5cGUsIHZhbHVlKSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignaXNCb3VuZCBtdXN0IHByb3ZpZGUgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuICAgIHZhciBleHByID0gdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByO1xuICAgIHJldHVybiBCb29sZWFuKGV4cHIgJiYgdmFsdWUgJiYgdmFsdWUubWF0Y2goZXhwcikpO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFRoZSBzb3J0IGZ1bmN0aW9uIHRvIHNvcnQgYmluZGVycyBjb3JyZWN0bHlcbiAgICovXG4gIGJpbmRpbmdTb3J0OiBmdW5jdGlvbihhLCBiKSB7XG4gICAgcmV0dXJuIGIucHJvdG90eXBlLnByaW9yaXR5IC0gYS5wcm90b3R5cGUucHJpb3JpdHk7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29udmVydHMgYW4gaW52ZXJ0ZWQgZXhwcmVzc2lvbiBmcm9tIGAvdXNlci97e3VzZXIuaWR9fWAgdG8gYFwiL3VzZXIvXCIgKyB1c2VyLmlkYFxuICAgKi9cbiAgY29kaWZ5RXhwcmVzc2lvbjogZnVuY3Rpb24odHlwZSwgdGV4dCkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NvZGlmeUV4cHJlc3Npb24gbXVzdCB1c2UgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuXG4gICAgdmFyIGV4cHIgPSB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHI7XG4gICAgdmFyIG1hdGNoID0gdGV4dC5tYXRjaChleHByKTtcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHJldHVybiAnXCInICsgdGV4dC5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJykgKyAnXCInO1xuICAgIH0gZWxzZSBpZiAobWF0Y2gubGVuZ3RoID09PSAxICYmIG1hdGNoWzBdID09PSB0ZXh0KSB7XG4gICAgICByZXR1cm4gdGV4dC5yZXBsYWNlKGV4cHIsICckMScpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbmV3VGV4dCA9ICdcIicsIGxhc3RJbmRleCA9IDA7XG4gICAgICB3aGlsZSAoKG1hdGNoID0gZXhwci5leGVjKHRleHQpKSkge1xuICAgICAgICB2YXIgc3RyID0gdGV4dC5zbGljZShsYXN0SW5kZXgsIGV4cHIubGFzdEluZGV4IC0gbWF0Y2hbMF0ubGVuZ3RoKTtcbiAgICAgICAgbmV3VGV4dCArPSBzdHIucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpO1xuICAgICAgICBuZXdUZXh0ICs9ICdcIiArICgnICsgbWF0Y2hbMV0gKyAnIHx8IFwiXCIpICsgXCInO1xuICAgICAgICBsYXN0SW5kZXggPSBleHByLmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIG5ld1RleHQgKz0gdGV4dC5zbGljZShsYXN0SW5kZXgpLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKSArICdcIic7XG4gICAgICByZXR1cm4gbmV3VGV4dC5yZXBsYWNlKC9eXCJcIiBcXCsgfCBcIlwiIFxcKyB8IFxcKyBcIlwiJC9nLCAnJyk7XG4gICAgfVxuICB9XG5cbn07XG5cbi8vIFRha2VzIGEgc3RyaW5nIGxpa2UgXCIoXFwqKVwiIG9yIFwib24tXFwqXCIgYW5kIGNvbnZlcnRzIGl0IGludG8gYSByZWd1bGFyIGV4cHJlc3Npb24uXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAodGV4dCkge1xuICByZXR1cm4gdGV4dC5yZXBsYWNlKC9bLVtcXF17fSgpKis/LixcXFxcXiR8I1xcc10vZywgJ1xcXFwkJicpO1xufVxuIiwiLy8gaW5zcGlyZWQgZnJvbSB6b25lLmpzLCBidXQgd2l0aG91dCBiZWluZyBhcyBjb21wcmVoZW5zaXZlIG9yIGludHJ1c2l2ZSAoaS5lLiBhdm9pZGluZyBnbG9iYWwgc2NvcGUpXG5cbi8vIFJ1biBhIGZ1bmN0aW9uIGluIHRoZSBjb250ZXh0IG9mIGZyYWdtZW50c1xuZXhwb3J0cy5ydW4gPSBydW47XG5cbi8vIFJldHVybiBhIG5ldyBmdW5jdGlvbiB3aGljaCB3aWxsIHJ1biBpbiB0aGUgY29udGV4dCBvZiBmcmFnbWVudHNcbmV4cG9ydHMud3JhcCA9IHdyYXA7XG5cbi8vIFJldHVybiBhIHByb3h5IGZvciBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgd3JhcCBhbnkgZnVuY3Rpb24gYXJndW1lbnRzIHBhc3NlZCB0byBpdFxuZXhwb3J0cy5wcm94eSA9IHByb3h5O1xuXG4vLyBTa2lwIE9ic2VydmVyLnN5bmMgb24gdGhlIG5leHQgaW52b2NhdGlvbiB0aGUgY29udGV4dC4gVGhpcyBpcyByZWFsbHkganVzdCBmb3Igb2JzZXJ2ZXIgdG8gcnVuIGFuZCBub3QgZ2V0IGludG9cbi8vIGEgbG9vcFxuZXhwb3J0cy5za2lwTmV4dFN5bmMgPSBmdW5jdGlvbigpIHtcbiAgc2tpcE5leHQgPSB0cnVlO1xufTtcblxuXG52YXIgT2JzZXJ2ZXIgPSByZXF1aXJlKCcuL29ic2VydmVyJyk7XG52YXIgcGF0Y2hlZCA9IGZhbHNlO1xudmFyIHNraXBOZXh0ID0gZmFsc2U7XG52YXIgd3JhcHBlZEtleSA9ICh0eXBlb2YgU3ltYm9sICE9PSAndW5kZWZpbmVkJykgPyBTeW1ib2woJ3dyYXBwZWQnKSA6ICdfem9uZWpyJHdyYXBwZWQnO1xuXG5cbmZ1bmN0aW9uIHJ1bihmdW5jKSB7XG4gIHJldHVybiB3cmFwKGZ1bmMpKCk7XG59XG5cbmZ1bmN0aW9uIHdyYXAoZnVuYykge1xuICBpZiAodHlwZW9mIGZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICByZXR1cm4gZnVuYztcbiAgfSBlbHNlIGlmICghZnVuY1t3cmFwcGVkS2V5XSkge1xuICAgIGZ1bmNbd3JhcHBlZEtleV0gPSBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChwYXRjaGVkKSB7XG4gICAgICAgIHJldHVybiBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICB9XG5cbiAgICAgIHBhdGNoKCk7XG4gICAgICB2YXIgcmVzdWx0ID0gZnVuYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgaWYgKHNraXBOZXh0KSB7XG4gICAgICAgIHNraXBOZXh0ID0gZmFsc2U7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBPYnNlcnZlci5zeW5jKCk7XG4gICAgICB9XG4gICAgICB1bnBhdGNoKCk7XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH07XG4gICAgZnVuY1t3cmFwcGVkS2V5XVt3cmFwcGVkS2V5XSA9IGZ1bmNbd3JhcHBlZEtleV07XG4gIH1cbiAgcmV0dXJuIGZ1bmNbd3JhcHBlZEtleV07XG59XG5cbmZ1bmN0aW9uIHByb3h5KG1ldGhvZCkge1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmICh0eXBlb2YgYXJndW1lbnRzW2ldID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGFyZ3VtZW50c1tpXSA9IHdyYXAoYXJndW1lbnRzW2ldKTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIG1ldGhvZC5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICB9O1xufVxuXG5mdW5jdGlvbiBwcm94eUNsYXNzKE9yaWdpbmFsQ2xhc3MsIGV2ZW50TmFtZXMpIHtcbiAgaWYgKCFldmVudE5hbWVzKSB7XG4gICAgZXZlbnROYW1lcyA9IFtdO1xuICAgIHZhciBpbnN0YW5jZSA9IG5ldyBPcmlnaW5hbENsYXNzKCk7XG4gICAgZm9yICh2YXIgaSBpbiBpbnN0YW5jZSkge1xuICAgICAgaWYgKGkuc2xpY2UoMCwgMikgPT09ICdvbicgJiYgaW5zdGFuY2VbaV0gPT09IG51bGwgJiYgaS50b0xvd2VyQ2FzZSgpID09PSBpKSB7XG4gICAgICAgIGV2ZW50TmFtZXMucHVzaChpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgdmFyIG9iaiwgYSA9IGFyZ3VtZW50cztcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIGNhc2UgMDogb2JqID0gbmV3IE9yaWdpbmFsQ2xhc3MoKTsgYnJlYWs7XG4gICAgICBjYXNlIDE6IG9iaiA9IG5ldyBPcmlnaW5hbENsYXNzKGFbMF0pOyBicmVhaztcbiAgICAgIGNhc2UgMjogb2JqID0gbmV3IE9yaWdpbmFsQ2xhc3MoYVswXSwgYVsxXSk7IGJyZWFrO1xuICAgICAgY2FzZSAzOiBvYmogPSBuZXcgT3JpZ2luYWxDbGFzcyhhWzBdLCBhWzFdLCBhWzJdKTsgYnJlYWs7XG4gICAgICBjYXNlIDQ6IG9iaiA9IG5ldyBPcmlnaW5hbENsYXNzKGFbMF0sIGFbMV0sIGFbMl0sIGFbM10pOyBicmVhaztcbiAgICAgIGRlZmF1bHQ6IHRocm93IG5ldyBFcnJvcignd2hhdCBhcmUgeW91IGV2ZW4gZG9pbmc/Jyk7XG4gICAgfVxuXG4gICAgZXZlbnROYW1lcy5mb3JFYWNoKGZ1bmN0aW9uKHByb3BlcnR5KSB7XG4gICAgICB2YXIgZXZlbnROYW1lID0gcHJvcGVydHkuc2xpY2UoMik7XG4gICAgICB2YXIgaGFuZGxlcjtcblxuICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KG9iaiwgcHJvcGVydHksIHtcbiAgICAgICAgZW51bWVyYWJsZTogdHJ1ZSxcbiAgICAgICAgY29uZmlndXJhYmxlOiB0cnVlLFxuICAgICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgaWYgKGhhbmRsZXIpIHtcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIHdyYXAoaGFuZGxlcikpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBoYW5kbGVyID0gdmFsdWU7XG4gICAgICAgICAgaWYgKGhhbmRsZXIpIHtcbiAgICAgICAgICAgIHRoaXMuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIHdyYXAoaGFuZGxlcikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSxcbiAgICAgICAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICAgICAgICByZXR1cm4gaGFuZGxlcjtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICByZXR1cm4gb2JqO1xuICB9O1xufVxuXG5cbmZ1bmN0aW9uIHBhdGNoKCkge1xuICBwYXRjaGVkID0gdHJ1ZTtcbiAgd2luZG93LnNldFRpbWVvdXQgPSBwYXRjaGVzLnNldFRpbWVvdXQ7XG4gIHdpbmRvdy5zZXRJbnRlcnZhbCA9IHBhdGNoZXMuc2V0SW50ZXJ2YWw7XG4gIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSBwYXRjaGVzLnJlcXVlc3RBbmltYXRpb25GcmFtZTtcbiAgRXZlbnRUYXJnZXQucHJvdG90eXBlLmFkZEV2ZW50TGlzdGVuZXIgPSBwYXRjaGVzLmFkZEV2ZW50TGlzdGVuZXI7XG4gIEV2ZW50VGFyZ2V0LnByb3RvdHlwZS5yZW1vdmVFdmVudExpc3RlbmVyID0gcGF0Y2hlcy5yZW1vdmVFdmVudExpc3RlbmVyO1xuICBQcm9taXNlLnByb3RvdHlwZS50aGVuID0gcGF0Y2hlcy50aGVuO1xuICBQcm9taXNlLnByb3RvdHlwZS5jYXRjaCA9IHBhdGNoZXMuY2F0Y2g7XG4gIGRvY3VtZW50LnJlZ2lzdGVyRWxlbWVudCA9IHBhdGNoZXMucmVnaXN0ZXJFbGVtZW50O1xuICB3aW5kb3cuV2ViU29ja2V0ID0gcGF0Y2hlcy5XZWJTb2NrZXQ7XG59XG5cblxuZnVuY3Rpb24gdW5wYXRjaCgpIHtcbiAgd2luZG93LnNldFRpbWVvdXQgPSBvcmlnaW5hbHMuc2V0VGltZW91dDtcbiAgd2luZG93LnNldEludGVydmFsID0gb3JpZ2luYWxzLnNldEludGVydmFsO1xuICB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gb3JpZ2luYWxzLnJlcXVlc3RBbmltYXRpb25GcmFtZTtcbiAgRXZlbnRUYXJnZXQucHJvdG90eXBlLmFkZEV2ZW50TGlzdGVuZXIgPSBvcmlnaW5hbHMuYWRkRXZlbnRMaXN0ZW5lcjtcbiAgRXZlbnRUYXJnZXQucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBvcmlnaW5hbHMucmVtb3ZlRXZlbnRMaXN0ZW5lcjtcbiAgUHJvbWlzZS5wcm90b3R5cGUudGhlbiA9IG9yaWdpbmFscy50aGVuO1xuICBQcm9taXNlLnByb3RvdHlwZS5jYXRjaCA9IG9yaWdpbmFscy5jYXRjaDtcbiAgZG9jdW1lbnQucmVnaXN0ZXJFbGVtZW50ID0gb3JpZ2luYWxzLnJlZ2lzdGVyRWxlbWVudDtcbiAgd2luZG93LldlYlNvY2tldCA9IG9yaWdpbmFscy5XZWJTb2NrZXQ7XG4gIHBhdGNoZWQgPSBmYWxzZTtcbn1cblxuXG52YXIgb3JpZ2luYWxzID0ge1xuICBzZXRUaW1lb3V0OiB3aW5kb3cuc2V0VGltZW91dCxcbiAgc2V0SW50ZXJ2YWw6IHdpbmRvdy5zZXRJbnRlcnZhbCxcbiAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lOiB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lLFxuICBhZGRFdmVudExpc3RlbmVyOiBFdmVudFRhcmdldC5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lcixcbiAgcmVtb3ZlRXZlbnRMaXN0ZW5lcjogRXZlbnRUYXJnZXQucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIsXG4gIHRoZW46IFByb21pc2UucHJvdG90eXBlLnRoZW4sXG4gIGNhdGNoOiBQcm9taXNlLnByb3RvdHlwZS5jYXRjaCxcbiAgcmVnaXN0ZXJFbGVtZW50OiBkb2N1bWVudC5yZWdpc3RlckVsZW1lbnQsXG4gIFhNTEh0dHBSZXF1ZXN0OiB3aW5kb3cuWE1MSHR0cFJlcXVlc3QsXG4gIFdlYlNvY2tldDogd2luZG93LldlYlNvY2tldFxufTtcblxuXG52YXIgcGF0Y2hlcyA9IHtcbiAgc2V0VGltZW91dDogcHJveHkob3JpZ2luYWxzLnNldFRpbWVvdXQpLFxuICBzZXRJbnRlcnZhbDogcHJveHkob3JpZ2luYWxzLnNldEludGVydmFsKSxcbiAgcmVxdWVzdEFuaW1hdGlvbkZyYW1lOiBwcm94eShvcmlnaW5hbHMucmVxdWVzdEFuaW1hdGlvbkZyYW1lKSxcbiAgYWRkRXZlbnRMaXN0ZW5lcjogcHJveHkob3JpZ2luYWxzLmFkZEV2ZW50TGlzdGVuZXIpLFxuICByZW1vdmVFdmVudExpc3RlbmVyOiBwcm94eShvcmlnaW5hbHMucmVtb3ZlRXZlbnRMaXN0ZW5lciksXG4gIHRoZW46IHByb3h5KG9yaWdpbmFscy50aGVuKSxcbiAgY2F0Y2g6IHByb3h5KG9yaWdpbmFscy5jYXRjaCksXG4gIFhNTEh0dHBSZXF1ZXN0OiBwcm94eUNsYXNzKG9yaWdpbmFscy5YTUxIdHRwUmVxdWVzdCksXG4gIFdlYlNvY2tldDogcHJveHlDbGFzcyhvcmlnaW5hbHMuV2ViU29ja2V0LCBbJ29ubWVzc2FnZSddKVxufTtcbiIsIi8qXG5Db3B5cmlnaHQgKGMpIDIwMTUgSmFjb2IgV3JpZ2h0IDxqYWN3cmlnaHRAZ21haWwuY29tPlxuXG5QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG5vZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG5pbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG50byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG5jb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbmZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG5cblRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG5hbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cblxuVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG5GSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbkFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbkxJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG5PVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG5USEUgU09GVFdBUkUuXG4qL1xuLy8gIyBEaWZmXG4vLyA+IEJhc2VkIG9uIHdvcmsgZnJvbSBHb29nbGUncyBvYnNlcnZlLWpzIHBvbHlmaWxsOiBodHRwczovL2dpdGh1Yi5jb20vUG9seW1lci9vYnNlcnZlLWpzXG5cbi8vIEEgbmFtZXNwYWNlIHRvIHN0b3JlIHRoZSBmdW5jdGlvbnMgb25cbnZhciBkaWZmID0gZXhwb3J0cztcblxuKGZ1bmN0aW9uKCkge1xuXG4gIGRpZmYuY2xvbmUgPSBjbG9uZTtcbiAgZGlmZi52YWx1ZXMgPSBkaWZmVmFsdWVzO1xuICBkaWZmLmJhc2ljID0gZGlmZkJhc2ljO1xuICBkaWZmLm9iamVjdHMgPSBkaWZmT2JqZWN0cztcbiAgZGlmZi5hcnJheXMgPSBkaWZmQXJyYXlzO1xuXG5cbiAgLy8gQSBjaGFuZ2UgcmVjb3JkIGZvciB0aGUgb2JqZWN0IGNoYW5nZXNcbiAgZnVuY3Rpb24gQ2hhbmdlUmVjb3JkKG9iamVjdCwgdHlwZSwgbmFtZSwgb2xkVmFsdWUpIHtcbiAgICB0aGlzLm9iamVjdCA9IG9iamVjdDtcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5vbGRWYWx1ZSA9IG9sZFZhbHVlO1xuICB9XG5cbiAgLy8gQSBzcGxpY2UgcmVjb3JkIGZvciB0aGUgYXJyYXkgY2hhbmdlc1xuICBmdW5jdGlvbiBTcGxpY2UoaW5kZXgsIHJlbW92ZWQsIGFkZGVkQ291bnQpIHtcbiAgICB0aGlzLmluZGV4ID0gaW5kZXg7XG4gICAgdGhpcy5yZW1vdmVkID0gcmVtb3ZlZDtcbiAgICB0aGlzLmFkZGVkQ291bnQgPSBhZGRlZENvdW50O1xuICB9XG5cblxuICAvLyBDcmVhdGVzIGEgY2xvbmUgb3IgY29weSBvZiBhbiBhcnJheSBvciBvYmplY3QgKG9yIHNpbXBseSByZXR1cm5zIGEgc3RyaW5nL251bWJlci9ib29sZWFuIHdoaWNoIGFyZSBpbW11dGFibGUpXG4gIC8vIERvZXMgbm90IHByb3ZpZGUgZGVlcCBjb3BpZXMuXG4gIGZ1bmN0aW9uIGNsb25lKHZhbHVlLCBkZWVwKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoZGVlcCkge1xuICAgICAgICByZXR1cm4gdmFsdWUubWFwKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIGNsb25lKHZhbHVlLCBkZWVwKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh2YWx1ZS52YWx1ZU9mKCkgIT09IHZhbHVlKSB7XG4gICAgICAgIHJldHVybiBuZXcgdmFsdWUuY29uc3RydWN0b3IodmFsdWUudmFsdWVPZigpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjb3B5ID0ge307XG4gICAgICAgIGZvciAodmFyIGtleSBpbiB2YWx1ZSkge1xuICAgICAgICAgIHZhciBvYmpWYWx1ZSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgICAgIG9ialZhbHVlID0gY2xvbmUob2JqVmFsdWUsIGRlZXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb3B5W2tleV0gPSBvYmpWYWx1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29weTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIHZhbHVlcywgcmV0dXJuaW5nIGEgdHJ1dGh5IHZhbHVlIGlmIHRoZXJlIGFyZSBjaGFuZ2VzIG9yIGBmYWxzZWAgaWYgdGhlcmUgYXJlIG5vIGNoYW5nZXMuIElmIHRoZSB0d29cbiAgLy8gdmFsdWVzIGFyZSBib3RoIGFycmF5cyBvciBib3RoIG9iamVjdHMsIGFuIGFycmF5IG9mIGNoYW5nZXMgKHNwbGljZXMgb3IgY2hhbmdlIHJlY29yZHMpIGJldHdlZW4gdGhlIHR3byB3aWxsIGJlXG4gIC8vIHJldHVybmVkLiBPdGhlcndpc2UgIGB0cnVlYCB3aWxsIGJlIHJldHVybmVkLlxuICBmdW5jdGlvbiBkaWZmVmFsdWVzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIC8vIFNob3J0Y3V0IG91dCBmb3IgdmFsdWVzIHRoYXQgYXJlIGV4YWN0bHkgZXF1YWxcbiAgICBpZiAodmFsdWUgPT09IG9sZFZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkpIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlc1xuICAgICAgdmFyIHNwbGljZXMgPSBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgICByZXR1cm4gc3BsaWNlcy5sZW5ndGggPyBzcGxpY2VzIDogZmFsc2U7XG4gICAgfSBlbHNlIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIElmIGFuIG9iamVjdCBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIGNobmFnZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gdmFsdWVWYWx1ZSAhPT0gb2xkVmFsdWVWYWx1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gZGlmZk9iamVjdHModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgICAgcmV0dXJuIGNoYW5nZVJlY29yZHMubGVuZ3RoID8gY2hhbmdlUmVjb3JkcyA6IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhIHZhbHVlIGhhcyBjaGFuZ2VkIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gYmFzaWMgdHlwZXMsIHJldHVybmluZyB0cnVlIGlmIGNoYW5nZWQgb3IgZmFsc2UgaWYgbm90XG4gIGZ1bmN0aW9uIGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICBpZiAodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlVmFsdWUsIG9sZFZhbHVlVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdudW1iZXInICYmIGlzTmFOKHZhbHVlKSAmJiBpc05hTihvbGRWYWx1ZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlICE9PSBvbGRWYWx1ZTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBvYmplY3RzIHJldHVybmluZyBhbiBhcnJheSBvZiBjaGFuZ2UgcmVjb3Jkcy4gVGhlIGNoYW5nZSByZWNvcmQgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgb2JqZWN0OiBvYmplY3QsXG4gIC8vICAgdHlwZTogJ2RlbGV0ZWR8dXBkYXRlZHxuZXcnLFxuICAvLyAgIG5hbWU6ICdwcm9wZXJ0eU5hbWUnLFxuICAvLyAgIG9sZFZhbHVlOiBvbGRWYWx1ZVxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmT2JqZWN0cyhvYmplY3QsIG9sZE9iamVjdCkge1xuICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gW107XG4gICAgdmFyIHByb3AsIG9sZFZhbHVlLCB2YWx1ZTtcblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCAoc2hvdWxkIGJlIGEgY2xvbmUpIGFuZCBsb29rIGZvciB0aGluZ3MgdGhhdCBhcmUgbm93IGdvbmUgb3IgY2hhbmdlZFxuICAgIGZvciAocHJvcCBpbiBvbGRPYmplY3QpIHtcbiAgICAgIG9sZFZhbHVlID0gb2xkT2JqZWN0W3Byb3BdO1xuICAgICAgdmFsdWUgPSBvYmplY3RbcHJvcF07XG5cbiAgICAgIC8vIEFsbG93IGZvciB0aGUgY2FzZSBvZiBvYmoucHJvcCA9IHVuZGVmaW5lZCAod2hpY2ggaXMgYSBuZXcgcHJvcGVydHksIGV2ZW4gaWYgaXQgaXMgdW5kZWZpbmVkKVxuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgIWRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgcHJvcGVydHkgaXMgZ29uZSBpdCB3YXMgcmVtb3ZlZFxuICAgICAgaWYgKCEgKHByb3AgaW4gb2JqZWN0KSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICdkZWxldGVkJywgcHJvcCwgb2xkVmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAoZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAndXBkYXRlZCcsIHByb3AsIG9sZFZhbHVlKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gR29lcyB0aHJvdWdoIHRoZSBvbGQgb2JqZWN0IGFuZCBsb29rcyBmb3IgdGhpbmdzIHRoYXQgYXJlIG5ld1xuICAgIGZvciAocHJvcCBpbiBvYmplY3QpIHtcbiAgICAgIHZhbHVlID0gb2JqZWN0W3Byb3BdO1xuICAgICAgaWYgKCEgKHByb3AgaW4gb2xkT2JqZWN0KSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICduZXcnLCBwcm9wKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkob2JqZWN0KSAmJiBvYmplY3QubGVuZ3RoICE9PSBvbGRPYmplY3QubGVuZ3RoKSB7XG4gICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICd1cGRhdGVkJywgJ2xlbmd0aCcsIG9sZE9iamVjdC5sZW5ndGgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlUmVjb3JkcztcbiAgfVxuXG5cblxuXG5cbiAgdmFyIEVESVRfTEVBVkUgPSAwO1xuICB2YXIgRURJVF9VUERBVEUgPSAxO1xuICB2YXIgRURJVF9BREQgPSAyO1xuICB2YXIgRURJVF9ERUxFVEUgPSAzO1xuXG5cbiAgLy8gRGlmZnMgdHdvIGFycmF5cyByZXR1cm5pbmcgYW4gYXJyYXkgb2Ygc3BsaWNlcy4gQSBzcGxpY2Ugb2JqZWN0IGxvb2tzIGxpa2U6XG4gIC8vIGBgYGphdmFzY3JpcHRcbiAgLy8ge1xuICAvLyAgIGluZGV4OiAzLFxuICAvLyAgIHJlbW92ZWQ6IFtpdGVtLCBpdGVtXSxcbiAgLy8gICBhZGRlZENvdW50OiAwXG4gIC8vIH1cbiAgLy8gYGBgXG4gIGZ1bmN0aW9uIGRpZmZBcnJheXModmFsdWUsIG9sZFZhbHVlKSB7XG4gICAgdmFyIGN1cnJlbnRTdGFydCA9IDA7XG4gICAgdmFyIGN1cnJlbnRFbmQgPSB2YWx1ZS5sZW5ndGg7XG4gICAgdmFyIG9sZFN0YXJ0ID0gMDtcbiAgICB2YXIgb2xkRW5kID0gb2xkVmFsdWUubGVuZ3RoO1xuXG4gICAgdmFyIG1pbkxlbmd0aCA9IE1hdGgubWluKGN1cnJlbnRFbmQsIG9sZEVuZCk7XG4gICAgdmFyIHByZWZpeENvdW50ID0gc2hhcmVkUHJlZml4KHZhbHVlLCBvbGRWYWx1ZSwgbWluTGVuZ3RoKTtcbiAgICB2YXIgc3VmZml4Q291bnQgPSBzaGFyZWRTdWZmaXgodmFsdWUsIG9sZFZhbHVlLCBtaW5MZW5ndGggLSBwcmVmaXhDb3VudCk7XG5cbiAgICBjdXJyZW50U3RhcnQgKz0gcHJlZml4Q291bnQ7XG4gICAgb2xkU3RhcnQgKz0gcHJlZml4Q291bnQ7XG4gICAgY3VycmVudEVuZCAtPSBzdWZmaXhDb3VudDtcbiAgICBvbGRFbmQgLT0gc3VmZml4Q291bnQ7XG5cbiAgICBpZiAoY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCA9PT0gMCAmJiBvbGRFbmQgLSBvbGRTdGFydCA9PT0gMCkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIGFkZGVkLCBvbmx5IHJlbW92ZWQgZnJvbSBvbmUgc3BvdFxuICAgIGlmIChjdXJyZW50U3RhcnQgPT09IGN1cnJlbnRFbmQpIHtcbiAgICAgIHJldHVybiBbIG5ldyBTcGxpY2UoY3VycmVudFN0YXJ0LCBvbGRWYWx1ZS5zbGljZShvbGRTdGFydCwgb2xkRW5kKSwgMCkgXTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3RoaW5nIHdhcyByZW1vdmVkLCBvbmx5IGFkZGVkIHRvIG9uZSBzcG90XG4gICAgaWYgKG9sZFN0YXJ0ID09PSBvbGRFbmQpIHtcbiAgICAgIHJldHVybiBbIG5ldyBTcGxpY2UoY3VycmVudFN0YXJ0LCBbXSwgY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCkgXTtcbiAgICB9XG5cbiAgICAvLyBhIG1peHR1cmUgb2YgYWRkcyBhbmQgcmVtb3Zlc1xuICAgIHZhciBkaXN0YW5jZXMgPSBjYWxjRWRpdERpc3RhbmNlcyh2YWx1ZSwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGRWYWx1ZSwgb2xkU3RhcnQsIG9sZEVuZCk7XG4gICAgdmFyIG9wcyA9IHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpO1xuXG4gICAgdmFyIHNwbGljZSA9IG51bGw7XG4gICAgdmFyIHNwbGljZXMgPSBbXTtcbiAgICB2YXIgaW5kZXggPSBjdXJyZW50U3RhcnQ7XG4gICAgdmFyIG9sZEluZGV4ID0gb2xkU3RhcnQ7XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IG9wcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBvcCA9IG9wc1tpXTtcbiAgICAgIGlmIChvcCA9PT0gRURJVF9MRUFWRSkge1xuICAgICAgICBpZiAoc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgICAgICAgc3BsaWNlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4Kys7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX1VQREFURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG5cbiAgICAgICAgc3BsaWNlLnJlbW92ZWQucHVzaChvbGRWYWx1ZVtvbGRJbmRleF0pO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9BREQpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UuYWRkZWRDb3VudCsrO1xuICAgICAgICBpbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9ERUxFVEUpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNwbGljZSkge1xuICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNwbGljZXM7XG4gIH1cblxuXG5cblxuICAvLyBmaW5kIHRoZSBudW1iZXIgb2YgaXRlbXMgYXQgdGhlIGJlZ2lubmluZyB0aGF0IGFyZSB0aGUgc2FtZVxuICBmdW5jdGlvbiBzaGFyZWRQcmVmaXgoY3VycmVudCwgb2xkLCBzZWFyY2hMZW5ndGgpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNlYXJjaExlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoZGlmZkJhc2ljKGN1cnJlbnRbaV0sIG9sZFtpXSkpIHtcbiAgICAgICAgcmV0dXJuIGk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWFyY2hMZW5ndGg7XG4gIH1cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgZW5kIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFN1ZmZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIHZhciBpbmRleDEgPSBjdXJyZW50Lmxlbmd0aDtcbiAgICB2YXIgaW5kZXgyID0gb2xkLmxlbmd0aDtcbiAgICB2YXIgY291bnQgPSAwO1xuICAgIHdoaWxlIChjb3VudCA8IHNlYXJjaExlbmd0aCAmJiAhZGlmZkJhc2ljKGN1cnJlbnRbLS1pbmRleDFdLCBvbGRbLS1pbmRleDJdKSkge1xuICAgICAgY291bnQrKztcbiAgICB9XG4gICAgcmV0dXJuIGNvdW50O1xuICB9XG5cblxuICBmdW5jdGlvbiBzcGxpY2VPcGVyYXRpb25zRnJvbUVkaXREaXN0YW5jZXMoZGlzdGFuY2VzKSB7XG4gICAgdmFyIGkgPSBkaXN0YW5jZXMubGVuZ3RoIC0gMTtcbiAgICB2YXIgaiA9IGRpc3RhbmNlc1swXS5sZW5ndGggLSAxO1xuICAgIHZhciBjdXJyZW50ID0gZGlzdGFuY2VzW2ldW2pdO1xuICAgIHZhciBlZGl0cyA9IFtdO1xuICAgIHdoaWxlIChpID4gMCB8fCBqID4gMCkge1xuICAgICAgaWYgKGkgPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0FERCk7XG4gICAgICAgIGotLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChqID09PSAwKSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9ERUxFVEUpO1xuICAgICAgICBpLS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB2YXIgbm9ydGhXZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICB2YXIgd2VzdCA9IGRpc3RhbmNlc1tpIC0gMV1bal07XG4gICAgICB2YXIgbm9ydGggPSBkaXN0YW5jZXNbaV1baiAtIDFdO1xuICAgICAgdmFyIG1pbjtcblxuICAgICAgaWYgKHdlc3QgPCBub3J0aCkge1xuICAgICAgICBtaW4gPSB3ZXN0IDwgbm9ydGhXZXN0ID8gd2VzdCA6IG5vcnRoV2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pbiA9IG5vcnRoIDwgbm9ydGhXZXN0ID8gbm9ydGggOiBub3J0aFdlc3Q7XG4gICAgICB9XG5cbiAgICAgIGlmIChtaW4gPT09IG5vcnRoV2VzdCkge1xuICAgICAgICBpZiAobm9ydGhXZXN0ID09PSBjdXJyZW50KSB7XG4gICAgICAgICAgZWRpdHMucHVzaChFRElUX0xFQVZFKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfVVBEQVRFKTtcbiAgICAgICAgICBjdXJyZW50ID0gbm9ydGhXZXN0O1xuICAgICAgICB9XG4gICAgICAgIGktLTtcbiAgICAgICAgai0tO1xuICAgICAgfSBlbHNlIGlmIChtaW4gPT09IHdlc3QpIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY3VycmVudCA9IHdlc3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjdXJyZW50ID0gbm9ydGg7XG4gICAgICB9XG4gICAgfVxuICAgIGVkaXRzLnJldmVyc2UoKTtcbiAgICByZXR1cm4gZWRpdHM7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIGNhbGNFZGl0RGlzdGFuY2VzKGN1cnJlbnQsIGN1cnJlbnRTdGFydCwgY3VycmVudEVuZCwgb2xkLCBvbGRTdGFydCwgb2xkRW5kKSB7XG4gICAgLy8gXCJEZWxldGlvblwiIGNvbHVtbnNcbiAgICB2YXIgcm93Q291bnQgPSBvbGRFbmQgLSBvbGRTdGFydCArIDE7XG4gICAgdmFyIGNvbHVtbkNvdW50ID0gY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCArIDE7XG4gICAgdmFyIGRpc3RhbmNlcyA9IG5ldyBBcnJheShyb3dDb3VudCk7XG4gICAgdmFyIGksIGo7XG5cbiAgICAvLyBcIkFkZGl0aW9uXCIgcm93cy4gSW5pdGlhbGl6ZSBudWxsIGNvbHVtbi5cbiAgICBmb3IgKGkgPSAwOyBpIDwgcm93Q291bnQ7IGkrKykge1xuICAgICAgZGlzdGFuY2VzW2ldID0gbmV3IEFycmF5KGNvbHVtbkNvdW50KTtcbiAgICAgIGRpc3RhbmNlc1tpXVswXSA9IGk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBudWxsIHJvd1xuICAgIGZvciAoaiA9IDA7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICBkaXN0YW5jZXNbMF1bal0gPSBqO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDE7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBmb3IgKGogPSAxOyBqIDwgY29sdW1uQ291bnQ7IGorKykge1xuICAgICAgICBpZiAoIWRpZmZCYXNpYyhjdXJyZW50W2N1cnJlbnRTdGFydCArIGogLSAxXSwgb2xkW29sZFN0YXJ0ICsgaSAtIDFdKSkge1xuICAgICAgICAgIGRpc3RhbmNlc1tpXVtqXSA9IGRpc3RhbmNlc1tpIC0gMV1baiAtIDFdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpIC0gMV1bal0gKyAxO1xuICAgICAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2ldW2ogLSAxXSArIDE7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gbm9ydGggPCB3ZXN0ID8gbm9ydGggOiB3ZXN0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc3RhbmNlcztcbiAgfVxufSkoKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IHJlcXVpcmUoJy4vb2JzZXJ2ZXInKTtcbmV4cG9ydHMuY29udGV4dCA9IHJlcXVpcmUoJy4vY29udGV4dCcpO1xuZXhwb3J0cy5leHByZXNzaW9ucyA9IHJlcXVpcmUoJ2V4cHJlc3Npb25zLWpzJyk7XG5leHBvcnRzLmV4cHJlc3Npb25zLmRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gT2JzZXJ2ZXI7XG52YXIgZXhwcmVzc2lvbnMgPSByZXF1aXJlKCdleHByZXNzaW9ucy1qcycpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciBmcmFnbWVudHNDb250ZXh0ID0gcmVxdWlyZSgnLi9jb250ZXh0Jyk7XG52YXIgcmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSB8fCBzZXRUaW1lb3V0O1xudmFyIGNhbmNlbEFuaW1hdGlvbkZyYW1lID0gd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lIHx8IGNsZWFyVGltZW91dDtcblxuLy8gIyBPYnNlcnZlclxuXG4vLyBEZWZpbmVzIGFuIG9ic2VydmVyIGNsYXNzIHdoaWNoIHJlcHJlc2VudHMgYW4gZXhwcmVzc2lvbi4gV2hlbmV2ZXIgdGhhdCBleHByZXNzaW9uIHJldHVybnMgYSBuZXcgdmFsdWUgdGhlIGBjYWxsYmFja2Bcbi8vIGlzIGNhbGxlZCB3aXRoIHRoZSB2YWx1ZS5cbi8vXG4vLyBJZiB0aGUgb2xkIGFuZCBuZXcgdmFsdWVzIHdlcmUgZWl0aGVyIGFuIGFycmF5IG9yIGFuIG9iamVjdCwgdGhlIGBjYWxsYmFja2AgYWxzb1xuLy8gcmVjZWl2ZXMgYW4gYXJyYXkgb2Ygc3BsaWNlcyAoZm9yIGFuIGFycmF5KSwgb3IgYW4gYXJyYXkgb2YgY2hhbmdlIG9iamVjdHMgKGZvciBhbiBvYmplY3QpIHdoaWNoIGFyZSB0aGUgc2FtZVxuLy8gZm9ybWF0IHRoYXQgYEFycmF5Lm9ic2VydmVgIGFuZCBgT2JqZWN0Lm9ic2VydmVgIHJldHVybiA8aHR0cDovL3dpa2kuZWNtYXNjcmlwdC5vcmcvZG9rdS5waHA/aWQ9aGFybW9ueTpvYnNlcnZlPi5cbmZ1bmN0aW9uIE9ic2VydmVyKGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgaWYgKHR5cGVvZiBleHByID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5nZXR0ZXIgPSBleHByO1xuICAgIHRoaXMuc2V0dGVyID0gZXhwcjtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmdldHRlciA9IGV4cHJlc3Npb25zLnBhcnNlKGV4cHIsIE9ic2VydmVyLmdsb2JhbHMsIE9ic2VydmVyLmZvcm1hdHRlcnMpO1xuICB9XG4gIHRoaXMuZXhwciA9IGV4cHI7XG4gIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgdGhpcy5jYWxsYmFja0NvbnRleHQgPSBjYWxsYmFja0NvbnRleHQ7XG4gIHRoaXMuc2tpcCA9IGZhbHNlO1xuICB0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSBmYWxzZTtcbiAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgdGhpcy5vbGRWYWx1ZSA9IHVuZGVmaW5lZDtcbn1cblxuT2JzZXJ2ZXIucHJvdG90eXBlID0ge1xuXG4gIC8vIEJpbmRzIHRoaXMgZXhwcmVzc2lvbiB0byBhIGdpdmVuIGNvbnRleHRcbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCwgc2tpcFVwZGF0ZSkge1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgaWYgKHRoaXMuY2FsbGJhY2spIHtcbiAgICAgIE9ic2VydmVyLmFkZCh0aGlzLCBza2lwVXBkYXRlKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gVW5iaW5kcyB0aGlzIGV4cHJlc3Npb25cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBPYnNlcnZlci5yZW1vdmUodGhpcyk7XG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgfSxcblxuICAvLyBDbG9zZXMgdGhlIG9ic2VydmVyLCBjbGVhbmluZyB1cCBhbnkgcG9zc2libGUgbWVtb3J5LWxlYWtzXG4gIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIHRoaXMuY2FsbGJhY2sgPSBudWxsO1xuICAgIHRoaXMuY2FsbGJhY2tDb250ZXh0ID0gbnVsbDtcbiAgfSxcblxuICAvLyBSZXR1cm5zIHRoZSBjdXJyZW50IHZhbHVlIG9mIHRoaXMgb2JzZXJ2ZXJcbiAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0KSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXR0ZXIuY2FsbCh0aGlzLmNvbnRleHQpO1xuICAgIH1cbiAgfSxcblxuICAvLyBTZXRzIHRoZSB2YWx1ZSBvZiB0aGlzIGV4cHJlc3Npb25cbiAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdGhpcy5jb250ZXh0KSByZXR1cm47XG4gICAgaWYgKHRoaXMuc2V0dGVyID09PSBmYWxzZSkgcmV0dXJuO1xuICAgIGlmICghdGhpcy5zZXR0ZXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuc2V0dGVyID0gdHlwZW9mIHRoaXMuZXhwciA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGV4cHJlc3Npb25zLnBhcnNlU2V0dGVyKHRoaXMuZXhwciwgT2JzZXJ2ZXIuZ2xvYmFscywgT2JzZXJ2ZXIuZm9ybWF0dGVycylcbiAgICAgICAgICA6IGZhbHNlO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aGlzLnNldHRlciA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKCF0aGlzLnNldHRlcikgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB2YXIgcmVzdWx0ID0gdGhpcy5zZXR0ZXIuY2FsbCh0aGlzLmNvbnRleHQsIHZhbHVlKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBXZSBjYW4ndCBleHBlY3QgY29kZSBpbiBmcmFnbWVudHMgb3V0c2lkZSBPYnNlcnZlciB0byBiZSBhd2FyZSBvZiBcInN5bmNcIiBzaW5jZSBvYnNlcnZlciBjYW4gYmUgcmVwbGFjZWQgYnkgb3RoZXJcbiAgICAvLyB0eXBlcyAoZS5nLiBvbmUgd2l0aG91dCBhIGBzeW5jKClgIG1ldGhvZCwgc3VjaCBhcyBvbmUgdGhhdCB1c2VzIGBPYmplY3Qub2JzZXJ2ZWApIGluIG90aGVyIHN5c3RlbXMuXG4gICAgdGhpcy5zeW5jKCk7XG4gICAgT2JzZXJ2ZXIuc3luYygpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cblxuICAvLyBJbnN0cnVjdHMgdGhpcyBvYnNlcnZlciB0byBub3QgY2FsbCBpdHMgYGNhbGxiYWNrYCBvbiB0aGUgbmV4dCBzeW5jLCB3aGV0aGVyIHRoZSB2YWx1ZSBoYXMgY2hhbmdlZCBvciBub3RcbiAgc2tpcE5leHRTeW5jOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNraXAgPSB0cnVlO1xuICB9LFxuXG5cbiAgLy8gU3luY3MgdGhpcyBvYnNlcnZlciBub3csIGNhbGxpbmcgdGhlIGNhbGxiYWNrIGltbWVkaWF0ZWx5IGlmIHRoZXJlIGhhdmUgYmVlbiBjaGFuZ2VzXG4gIHN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KCk7XG5cbiAgICAvLyBEb24ndCBjYWxsIHRoZSBjYWxsYmFjayBpZiBgc2tpcE5leHRTeW5jYCB3YXMgY2FsbGVkIG9uIHRoZSBvYnNlcnZlclxuICAgIGlmICh0aGlzLnNraXAgfHwgIXRoaXMuY2FsbGJhY2spIHtcbiAgICAgIHRoaXMuc2tpcCA9IGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhbiBhcnJheSBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIHNwbGljZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrLiBUaGlzXG4gICAgICB2YXIgY2hhbmdlZCA9IGRpZmYudmFsdWVzKHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIGlmICghY2hhbmdlZCAmJiAhdGhpcy5mb3JjZVVwZGF0ZU5leHRTeW5jKSByZXR1cm47XG4gICAgICB0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSBmYWxzZTtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGNoYW5nZWQpKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUsIGNoYW5nZWQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjay5jYWxsKHRoaXMuY2FsbGJhY2tDb250ZXh0LCB2YWx1ZSwgdGhpcy5vbGRWYWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuZ2V0Q2hhbmdlUmVjb3Jkcykge1xuICAgICAgLy8gU3RvcmUgYW4gaW1tdXRhYmxlIHZlcnNpb24gb2YgdGhlIHZhbHVlLCBhbGxvd2luZyBmb3IgYXJyYXlzIGFuZCBvYmplY3RzIHRvIGNoYW5nZSBpbnN0YW5jZSBidXQgbm90IGNvbnRlbnQgYW5kXG4gICAgICAvLyBzdGlsbCByZWZyYWluIGZyb20gZGlzcGF0Y2hpbmcgY2FsbGJhY2tzIChlLmcuIHdoZW4gdXNpbmcgYW4gb2JqZWN0IGluIGJpbmQtY2xhc3Mgb3Igd2hlbiB1c2luZyBhcnJheSBmb3JtYXR0ZXJzXG4gICAgICAvLyBpbiBiaW5kLWVhY2gpXG4gICAgICB0aGlzLm9sZFZhbHVlID0gZGlmZi5jbG9uZSh2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMub2xkVmFsdWUgPSB2YWx1ZTtcbiAgICB9XG4gIH1cbn07XG5cblxuLy8gQW4gYXJyYXkgb2YgYWxsIG9ic2VydmVycywgY29uc2lkZXJlZCAqcHJpdmF0ZSpcbk9ic2VydmVyLm9ic2VydmVycyA9IFtdO1xuXG4vLyBBbiBhcnJheSBvZiBjYWxsYmFja3MgdG8gcnVuIGFmdGVyIHRoZSBuZXh0IHN5bmMsIGNvbnNpZGVyZWQgKnByaXZhdGUqXG5PYnNlcnZlci5jYWxsYmFja3MgPSBbXTtcbk9ic2VydmVyLmxpc3RlbmVycyA9IFtdO1xuXG4vLyBBZGRzIGEgbmV3IG9ic2VydmVyIHRvIGJlIHN5bmNlZCB3aXRoIGNoYW5nZXMuIElmIGBza2lwVXBkYXRlYCBpcyB0cnVlIHRoZW4gdGhlIGNhbGxiYWNrIHdpbGwgb25seSBiZSBjYWxsZWQgd2hlbiBhXG4vLyBjaGFuZ2UgaXMgbWFkZSwgbm90IGluaXRpYWxseS5cbk9ic2VydmVyLmFkZCA9IGZ1bmN0aW9uKG9ic2VydmVyLCBza2lwVXBkYXRlKSB7XG4gIHRoaXMub2JzZXJ2ZXJzLnB1c2gob2JzZXJ2ZXIpO1xuICBpZiAoIXNraXBVcGRhdGUpIHtcbiAgICBvYnNlcnZlci5mb3JjZVVwZGF0ZU5leHRTeW5jID0gdHJ1ZTtcbiAgICBvYnNlcnZlci5zeW5jKCk7XG4gIH1cbn07XG5cbi8vIFJlbW92ZXMgYW4gb2JzZXJ2ZXIsIHN0b3BwaW5nIGl0IGZyb20gYmVpbmcgcnVuXG5PYnNlcnZlci5yZW1vdmUgPSBmdW5jdGlvbihvYnNlcnZlcikge1xuICB2YXIgaW5kZXggPSB0aGlzLm9ic2VydmVycy5pbmRleE9mKG9ic2VydmVyKTtcbiAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgIHRoaXMub2JzZXJ2ZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59O1xuXG4vLyAqcHJpdmF0ZSogcHJvcGVydGllcyB1c2VkIGluIHRoZSBzeW5jIGN5Y2xlXG5PYnNlcnZlci5zeW5jaW5nID0gZmFsc2U7XG5PYnNlcnZlci5jYWxsYmFja3NSdW5uaW5nID0gZmFsc2U7XG5PYnNlcnZlci5yZXJ1biA9IGZhbHNlO1xuT2JzZXJ2ZXIuY3ljbGVzID0gMDtcbk9ic2VydmVyLm1heCA9IDEwO1xuT2JzZXJ2ZXIudGltZW91dCA9IG51bGw7XG5PYnNlcnZlci5zeW5jUGVuZGluZyA9IG51bGw7XG5cbi8vIFNjaGVkdWxlcyBhbiBvYnNlcnZlciBzeW5jIGN5Y2xlIHdoaWNoIGNoZWNrcyBhbGwgdGhlIG9ic2VydmVycyB0byBzZWUgaWYgdGhleSd2ZSBjaGFuZ2VkLlxuT2JzZXJ2ZXIuc3luYyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmIChPYnNlcnZlci5zeW5jUGVuZGluZykgcmV0dXJuIGZhbHNlO1xuICBPYnNlcnZlci5zeW5jUGVuZGluZyA9IHJlcXVlc3RBbmltYXRpb25GcmFtZShmdW5jdGlvbigpIHtcbiAgICBPYnNlcnZlci5zeW5jTm93KGNhbGxiYWNrKTtcbiAgfSk7XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gUnVucyB0aGUgb2JzZXJ2ZXIgc3luYyBjeWNsZSB3aGljaCBjaGVja3MgYWxsIHRoZSBvYnNlcnZlcnMgdG8gc2VlIGlmIHRoZXkndmUgY2hhbmdlZC5cbk9ic2VydmVyLnN5bmNOb3cgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrID09PSAnZnVuY3Rpb24nKSB7XG4gICAgT2JzZXJ2ZXIuYWZ0ZXJTeW5jKGNhbGxiYWNrKTtcbiAgfVxuXG4gIGNhbmNlbEFuaW1hdGlvbkZyYW1lKE9ic2VydmVyLnN5bmNQZW5kaW5nKTtcbiAgT2JzZXJ2ZXIuc3luY1BlbmRpbmcgPSBudWxsO1xuXG4gIGlmIChPYnNlcnZlci5zeW5jaW5nKSB7XG4gICAgT2JzZXJ2ZXIucmVydW4gPSB0cnVlO1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIE9ic2VydmVyLnN5bmNpbmcgPSB0cnVlO1xuICBPYnNlcnZlci5yZXJ1biA9IHRydWU7XG4gIE9ic2VydmVyLmN5Y2xlcyA9IDA7XG5cbiAgZnJhZ21lbnRzQ29udGV4dC5za2lwTmV4dFN5bmMoKTtcbiAgZnJhZ21lbnRzQ29udGV4dC5ydW4oZnVuY3Rpb24oKSB7XG4gICAgdmFyIGksIGw7XG5cbiAgICAvLyBBbGxvdyBjYWxsYmFja3MgdG8gcnVuIHRoZSBzeW5jIGN5Y2xlIGFnYWluIGltbWVkaWF0ZWx5LCBidXQgc3RvcCBhdCBgT2JzZXJ2ZXIubWF4YCAoZGVmYXVsdCAxMCkgY3ljbGVzIHRvIHdlIGRvbid0XG4gICAgLy8gcnVuIGluZmluaXRlIGxvb3BzXG4gICAgd2hpbGUgKE9ic2VydmVyLnJlcnVuKSB7XG4gICAgICBpZiAoKytPYnNlcnZlci5jeWNsZXMgPT09IE9ic2VydmVyLm1heCkge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luZmluaXRlIG9ic2VydmVyIHN5bmNpbmcsIGFuIG9ic2VydmVyIGlzIGNhbGxpbmcgT2JzZXJ2ZXIuc3luYygpIHRvbyBtYW55IHRpbWVzJyk7XG4gICAgICB9XG4gICAgICBPYnNlcnZlci5yZXJ1biA9IGZhbHNlO1xuICAgICAgLy8gdGhlIG9ic2VydmVyIGFycmF5IG1heSBpbmNyZWFzZSBvciBkZWNyZWFzZSBpbiBzaXplIChyZW1haW5pbmcgb2JzZXJ2ZXJzKSBkdXJpbmcgdGhlIHN5bmNcbiAgICAgIGZvciAoaSA9IDA7IGkgPCBPYnNlcnZlci5vYnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgT2JzZXJ2ZXIub2JzZXJ2ZXJzW2ldLnN5bmMoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBPYnNlcnZlci5jYWxsYmFja3NSdW5uaW5nID0gdHJ1ZTtcblxuICAgIHZhciBjYWxsYmFja3MgPSBPYnNlcnZlci5jYWxsYmFja3M7XG4gICAgT2JzZXJ2ZXIuY2FsbGJhY2tzID0gW107XG4gICAgd2hpbGUgKGNhbGxiYWNrcy5sZW5ndGgpIHtcbiAgICAgIGNhbGxiYWNrcy5zaGlmdCgpKCk7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMCwgbCA9IE9ic2VydmVyLmxpc3RlbmVycy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBsaXN0ZW5lciA9IE9ic2VydmVyLmxpc3RlbmVyc1tpXTtcbiAgICAgIGxpc3RlbmVyKCk7XG4gICAgfVxuXG4gICAgT2JzZXJ2ZXIuY2FsbGJhY2tzUnVubmluZyA9IGZhbHNlO1xuICB9KTtcblxuICBPYnNlcnZlci5zeW5jaW5nID0gZmFsc2U7XG4gIE9ic2VydmVyLmN5Y2xlcyA9IDA7XG4gIHJldHVybiB0cnVlO1xufTtcblxuLy8gQWZ0ZXIgdGhlIG5leHQgc3luYyAob3IgdGhlIGN1cnJlbnQgaWYgaW4gdGhlIG1pZGRsZSBvZiBvbmUpLCBydW4gdGhlIHByb3ZpZGVkIGNhbGxiYWNrXG5PYnNlcnZlci5hZnRlclN5bmMgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAodHlwZW9mIGNhbGxiYWNrICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgaWYgKE9ic2VydmVyLmNhbGxiYWNrc1J1bm5pbmcpIHtcbiAgICBPYnNlcnZlci5zeW5jKCk7XG4gIH1cbiAgT2JzZXJ2ZXIuY2FsbGJhY2tzLnB1c2goY2FsbGJhY2spO1xufTtcblxuT2JzZXJ2ZXIub25TeW5jID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIE9ic2VydmVyLmxpc3RlbmVycy5wdXNoKGxpc3RlbmVyKTtcbn07XG5cbk9ic2VydmVyLnJlbW92ZU9uU3luYyA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICB2YXIgaW5kZXggPSBPYnNlcnZlci5saXN0ZW5lcnMuaW5kZXhPZihsaXN0ZW5lcik7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICBPYnNlcnZlci5saXN0ZW5lcnMuc3BsaWNlKGluZGV4LCAxKS5wb3AoKTtcbiAgfVxufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcblxuLyoqXG4gKiAjIERlZmF1bHQgQmluZGVyc1xuICogUmVnaXN0ZXJzIGRlZmF1bHQgYmluZGVycyB3aXRoIGEgZnJhZ21lbnRzIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJEZWZhdWx0cyhmcmFnbWVudHMpIHtcblxuICAvKipcbiAgICogRmFkZSBpbiBhbmQgb3V0XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24oJ2ZhZGUnLCB7XG4gICAgb3B0aW9uczoge1xuICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgIH0sXG4gICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IG9wYWNpdHk6ICcwJyB9LFxuICAgICAgICB7IG9wYWNpdHk6ICcxJyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZG9uZTtcbiAgICB9LFxuICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgb3BhY2l0eTogJzEnIH0sXG4gICAgICAgIHsgb3BhY2l0eTogJzAnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBkb25lO1xuICAgIH1cbiAgfSk7XG5cbiAgdmFyIHNsaWRlcyA9IHtcbiAgICBzbGlkZTogJ2hlaWdodCcsXG4gICAgc2xpZGV2OiAnaGVpZ2h0JyxcbiAgICBzbGlkZWg6ICd3aWR0aCdcbiAgfTtcblxuICB2YXIgYW5pbWF0aW5nID0gbmV3IE1hcCgpO1xuXG4gIGZ1bmN0aW9uIG9iaihrZXksIHZhbHVlKSB7XG4gICAgdmFyIG9iaiA9IHt9O1xuICAgIG9ialtrZXldID0gdmFsdWU7XG4gICAgcmV0dXJuIG9iajtcbiAgfVxuXG4gIC8qKlxuICAgKiBTbGlkZSBkb3duIGFuZCB1cCwgbGVmdCBhbmQgcmlnaHRcbiAgICovXG4gIE9iamVjdC5rZXlzKHNsaWRlcykuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIHByb3BlcnR5ID0gc2xpZGVzW25hbWVdO1xuXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUsIHtcbiAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgICB9LFxuICAgICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JyksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSlcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9LFxuICAgICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfVxuICAgIH0pO1xuXG5cbiAgICAvKipcbiAgICAgKiBNb3ZlIGl0ZW1zIHVwIGFuZCBkb3duIGluIGEgbGlzdCwgc2xpZGUgZG93biBhbmQgdXBcbiAgICAgKi9cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSArICctbW92ZScsIHtcbiAgICAgIG9wdGlvbnM6IHtcbiAgICAgICAgZHVyYXRpb246IDMwMCxcbiAgICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgICB9LFxuXG4gICAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpdGVtID0gZWxlbWVudC52aWV3ICYmIGVsZW1lbnQudmlldy5fcmVwZWF0SXRlbV87XG4gICAgICAgIGlmIChpdGVtKSB7XG4gICAgICAgICAgYW5pbWF0aW5nLnNldChpdGVtLCBlbGVtZW50KTtcbiAgICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgICAgYW5pbWF0aW5nLmRlbGV0ZShpdGVtKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERvIHRoZSBzbGlkZVxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JyksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSlcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9LFxuXG4gICAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaXRlbSA9IGVsZW1lbnQudmlldyAmJiBlbGVtZW50LnZpZXcuX3JlcGVhdEl0ZW1fO1xuICAgICAgICBpZiAoaXRlbSkge1xuICAgICAgICAgIHZhciBuZXdFbGVtZW50ID0gYW5pbWF0aW5nLmdldChpdGVtKTtcbiAgICAgICAgICBpZiAobmV3RWxlbWVudCAmJiBuZXdFbGVtZW50LnBhcmVudE5vZGUgPT09IGVsZW1lbnQucGFyZW50Tm9kZSkge1xuICAgICAgICAgICAgLy8gVGhpcyBpdGVtIGlzIGJlaW5nIHJlbW92ZWQgaW4gb25lIHBsYWNlIGFuZCBhZGRlZCBpbnRvIGFub3RoZXIuIE1ha2UgaXQgbG9vayBsaWtlIGl0cyBtb3ZpbmcgYnkgbWFraW5nIGJvdGhcbiAgICAgICAgICAgIC8vIGVsZW1lbnRzIG5vdCB2aXNpYmxlIGFuZCBoYXZpbmcgYSBjbG9uZSBtb3ZlIGFib3ZlIHRoZSBpdGVtcyB0byB0aGUgbmV3IGxvY2F0aW9uLlxuICAgICAgICAgICAgZWxlbWVudCA9IHRoaXMuYW5pbWF0ZU1vdmUoZWxlbWVudCwgbmV3RWxlbWVudCk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVNb3ZlOiBmdW5jdGlvbihvbGRFbGVtZW50LCBuZXdFbGVtZW50KSB7XG4gICAgICAgIHZhciBwbGFjZWhvbGRlckVsZW1lbnQ7XG4gICAgICAgIHZhciBwYXJlbnQgPSBuZXdFbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICAgIGlmICghcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCkge1xuICAgICAgICAgIHBhcmVudC5fX3NsaWRlTW92ZUhhbmRsZWQgPSB0cnVlO1xuICAgICAgICAgIGlmICh3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShwYXJlbnQpLnBvc2l0aW9uID09PSAnc3RhdGljJykge1xuICAgICAgICAgICAgcGFyZW50LnN0eWxlLnBvc2l0aW9uID0gJ3JlbGF0aXZlJztcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgb3JpZ1N0eWxlID0gb2xkRWxlbWVudC5nZXRBdHRyaWJ1dGUoJ3N0eWxlJyk7XG4gICAgICAgIHZhciBzdHlsZSA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKG9sZEVsZW1lbnQpO1xuICAgICAgICB2YXIgbWFyZ2luT2Zmc2V0TGVmdCA9IC1wYXJzZUludChzdHlsZS5tYXJnaW5MZWZ0KTtcbiAgICAgICAgdmFyIG1hcmdpbk9mZnNldFRvcCA9IC1wYXJzZUludChzdHlsZS5tYXJnaW5Ub3ApO1xuICAgICAgICB2YXIgb2xkTGVmdCA9IG9sZEVsZW1lbnQub2Zmc2V0TGVmdDtcbiAgICAgICAgdmFyIG9sZFRvcCA9IG9sZEVsZW1lbnQub2Zmc2V0VG9wO1xuXG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudCA9IGZyYWdtZW50cy5tYWtlRWxlbWVudEFuaW1hdGFibGUob2xkRWxlbWVudC5jbG9uZU5vZGUodHJ1ZSkpO1xuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQuc3R5bGUud2lkdGggPSBvbGRFbGVtZW50LnN0eWxlLndpZHRoID0gc3R5bGUud2lkdGg7XG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5zdHlsZS5oZWlnaHQgPSBvbGRFbGVtZW50LnN0eWxlLmhlaWdodCA9IHN0eWxlLmhlaWdodDtcbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnN0eWxlLm9wYWNpdHkgPSAnMCc7XG5cbiAgICAgICAgb2xkRWxlbWVudC5zdHlsZS5wb3NpdGlvbiA9ICdhYnNvbHV0ZSc7XG4gICAgICAgIG9sZEVsZW1lbnQuc3R5bGUuekluZGV4ID0gMTAwMDtcbiAgICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShwbGFjZWhvbGRlckVsZW1lbnQsIG9sZEVsZW1lbnQpO1xuICAgICAgICBuZXdFbGVtZW50LnN0eWxlLm9wYWNpdHkgPSAnMCc7XG5cbiAgICAgICAgb2xkRWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICB7IHRvcDogb2xkVG9wICsgbWFyZ2luT2Zmc2V0VG9wICsgJ3B4JywgbGVmdDogb2xkTGVmdCArIG1hcmdpbk9mZnNldExlZnQgKyAncHgnIH0sXG4gICAgICAgICAgeyB0b3A6IG5ld0VsZW1lbnQub2Zmc2V0VG9wICsgbWFyZ2luT2Zmc2V0VG9wICsgJ3B4JywgbGVmdDogbmV3RWxlbWVudC5vZmZzZXRMZWZ0ICsgbWFyZ2luT2Zmc2V0TGVmdCArICdweCcgfVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnJlbW92ZSgpO1xuICAgICAgICAgIG9yaWdTdHlsZSA/IG9sZEVsZW1lbnQuc2V0QXR0cmlidXRlKCdzdHlsZScsIG9yaWdTdHlsZSkgOiBvbGRFbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgICAgICBuZXdFbGVtZW50LnN0eWxlLm9wYWNpdHkgPSAnJztcbiAgICAgICAgfTtcblxuICAgICAgICByZXR1cm4gcGxhY2Vob2xkZXJFbGVtZW50O1xuICAgICAgfVxuICAgIH0pO1xuXG4gIH0pO1xuXG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdGVyRGVmYXVsdHM7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4uL29ic2VydmVyL2RpZmYnKTtcblxuLyoqXG4gKiAjIERlZmF1bHQgQmluZGVyc1xuICogUmVnaXN0ZXJzIGRlZmF1bHQgYmluZGVycyB3aXRoIGEgZnJhZ21lbnRzIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJEZWZhdWx0cyhmcmFnbWVudHMpIHtcblxuICAvKipcbiAgICogUHJpbnRzIG91dCB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gdG8gdGhlIGNvbnNvbGUuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2RlYnVnJywge1xuICAgIHByaW9yaXR5OiA2MCxcbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgLyplc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgICBjb25zb2xlLmluZm8oJ0RlYnVnOicsIHRoaXMuZXhwcmVzc2lvbiwgJz0nLCB2YWx1ZSk7XG4gICAgICAvKmVzbGludC1lbmFibGUgKi9cbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIHRleHRcbiAgICogQWRkcyBhIGJpbmRlciB0byBkaXNwbGF5IGVzY2FwZWQgdGV4dCBpbnNpZGUgYW4gZWxlbWVudC4gVGhpcyBjYW4gYmUgZG9uZSB3aXRoIGJpbmRpbmcgZGlyZWN0bHkgaW4gdGV4dCBub2RlcyBidXRcbiAgICogdXNpbmcgdGhlIGF0dHJpYnV0ZSBiaW5kZXIgcHJldmVudHMgYSBmbGFzaCBvZiB1bnN0eWxlZCBjb250ZW50IG9uIHRoZSBtYWluIHBhZ2UuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxoMSB0ZXh0PVwie3twb3N0LnRpdGxlfX1cIj5VbnRpdGxlZDwvaDE+XG4gICAqIDxkaXYgaHRtbD1cInt7cG9zdC5ib2R5IHwgbWFya2Rvd259fVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiA8ZGl2PlxuICAgKiAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICA8cD5cbiAgICogICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgPC9wPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3RleHQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGh0bWxcbiAgICogQWRkcyBhIGJpbmRlciB0byBkaXNwbGF5IHVuZXNjYXBlZCBIVE1MIGluc2lkZSBhbiBlbGVtZW50LiBCZSBzdXJlIGl0J3MgdHJ1c3RlZCEgVGhpcyBzaG91bGQgYmUgdXNlZCB3aXRoIGZpbHRlcnNcbiAgICogd2hpY2ggY3JlYXRlIEhUTUwgZnJvbSBzb21ldGhpbmcgc2FmZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPnt7cG9zdC50aXRsZX19PC9oMT5cbiAgICogPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqIDxkaXY+XG4gICAqICAgPHA+TGl0dGxlIFJlZCBSaWRpbmcgSG9vZCBpcyBhIHN0b3J5IGFib3V0IGEgbGl0dGxlIGdpcmwuPC9wPlxuICAgKiAgIDxwPlxuICAgKiAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGl0dGxlX1JlZF9SaWRpbmdfSG9vZFwiPldpa2lwZWRpYTwvYT5cbiAgICogICA8L3A+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnaHRtbCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdGhpcy5lbGVtZW50LmlubmVySFRNTCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gIH0pO1xuXG5cblxuICAvKipcbiAgICogIyMgY2xhc3MtW2NsYXNzTmFtZV1cbiAgICogQWRkcyBhIGJpbmRlciB0byBhZGQgY2xhc3NlcyB0byBhbiBlbGVtZW50IGRlcGVuZGVudCBvbiB3aGV0aGVyIHRoZSBleHByZXNzaW9uIGlzIHRydWUgb3IgZmFsc2UuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJ1c2VyLWl0ZW1cIiBjbGFzcy1zZWxlY3RlZC11c2VyPVwie3tzZWxlY3RlZCA9PT0gdXNlcn19XCI+XG4gICAqICAgPGJ1dHRvbiBjbGFzcz1cImJ0biBwcmltYXJ5XCIgY2xhc3MtaGlnaGxpZ2h0PVwie3tyZWFkeX19XCI+PC9idXR0b24+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiBgc2VsZWN0ZWRgIGVxdWFscyB0aGUgYHVzZXJgIGFuZCBgcmVhZHlgIGlzIGB0cnVlYDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cInVzZXItaXRlbSBzZWxlY3RlZC11c2VyXCI+XG4gICAqICAgPGJ1dHRvbiBjbGFzcz1cImJ0biBwcmltYXJ5IGhpZ2hsaWdodFwiPjwvYnV0dG9uPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NsYXNzLSonLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LmNsYXNzTGlzdC5hZGQodGhpcy5tYXRjaCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMubWF0Y2gpO1xuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIFdoZW4gd29ya2luZyB3aXRoIGEgYm91bmQgY2xhc3MgYXR0cmlidXRlLCBtYWtlIHN1cmUgaXQgZG9lc24ndCBzdG9wIG9uIGNsYXNzLSogYXR0cmlidXRlcy5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnY2xhc3MnLCB7XG4gICAgb25seVdoZW5Cb3VuZDogdHJ1ZSxcbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgdmFyIGNsYXNzTGlzdCA9IHRoaXMuZWxlbWVudC5jbGFzc0xpc3Q7XG4gICAgICBpZiAodGhpcy5jbGFzc2VzKSB7XG4gICAgICAgIHRoaXMuY2xhc3Nlcy5mb3JFYWNoKGZ1bmN0aW9uKGNsYXNzTmFtZSkge1xuICAgICAgICAgIGlmIChjbGFzc05hbWUpIHtcbiAgICAgICAgICAgIGNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuY2xhc3NlcyA9IHZhbHVlLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgIHRoaXMuY2xhc3Nlcy5mb3JFYWNoKGZ1bmN0aW9uKGNsYXNzTmFtZSkge1xuICAgICAgICAgIGlmIChjbGFzc05hbWUpIHtcbiAgICAgICAgICAgIGNsYXNzTGlzdC5hZGQoY2xhc3NOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQXV0b21hdGljYWxseSBmb2N1c2VzIHRoZSBpbnB1dCB3aGVuIGl0IGlzIGRpc3BsYXllZCBvbiBzY3JlZW4uXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2F1dG9mb2N1cycsIHtcbiAgICBib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIGVsZW1lbnQuZm9jdXMoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQXV0b21hdGljYWxseSBzZWxlY3RzIHRoZSBjb250ZW50cyBvZiBhbiBpbnB1dCB3aGVuIGl0IHJlY2VpdmVzIGZvY3VzLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdhdXRvc2VsZWN0Jywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGZvY3VzZWQsIG1vdXNlRXZlbnQ7XG5cbiAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoZXMgc2luY2UgZG9jdW1lbnQuYWN0aXZlRWxlbWVudCBkb2Vzbid0IHdvcmsgd2VsbCB3aXRoIHdlYiBjb21wb25lbnRzIChmdXR1cmUgY29tcGF0KVxuICAgICAgICBmb2N1c2VkID0gdGhpcy5tYXRjaGVzKCc6Zm9jdXMnKTtcbiAgICAgICAgbW91c2VFdmVudCA9IHRydWU7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2ZvY3VzJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghbW91c2VFdmVudCkge1xuICAgICAgICAgIHRoaXMuc2VsZWN0KCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoIWZvY3VzZWQpIHtcbiAgICAgICAgICB0aGlzLnNlbGVjdCgpO1xuICAgICAgICB9XG4gICAgICAgIG1vdXNlRXZlbnQgPSBmYWxzZTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyB2YWx1ZVxuICAgKiBBZGRzIGEgYmluZGVyIHdoaWNoIHNldHMgdGhlIHZhbHVlIG9mIGFuIEhUTUwgZm9ybSBlbGVtZW50LiBUaGlzIGJpbmRlciBhbHNvIHVwZGF0ZXMgdGhlIGRhdGEgYXMgaXQgaXMgY2hhbmdlZCBpblxuICAgKiB0aGUgZm9ybSBlbGVtZW50LCBwcm92aWRpbmcgdHdvIHdheSBiaW5kaW5nLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+Rmlyc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cInVzZXIuZmlyc3ROYW1lXCI+XG4gICAqXG4gICAqIDxsYWJlbD5MYXN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwibGFzdE5hbWVcIiB2YWx1ZT1cInVzZXIubGFzdE5hbWVcIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5GaXJzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICpcbiAgICogPGxhYmVsPkxhc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJsYXN0TmFtZVwiIHZhbHVlPVwiV3JpZ2h0XCI+XG4gICAqIGBgYFxuICAgKiBBbmQgd2hlbiB0aGUgdXNlciBjaGFuZ2VzIHRoZSB0ZXh0IGluIHRoZSBmaXJzdCBpbnB1dCB0byBcIkphY1wiLCBgdXNlci5maXJzdE5hbWVgIHdpbGwgYmUgdXBkYXRlZCBpbW1lZGlhdGVseSB3aXRoXG4gICAqIHRoZSB2YWx1ZSBvZiBgJ0phYydgLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd2YWx1ZScsIHtcbiAgICBvbmx5V2hlbkJvdW5kOiB0cnVlLFxuICAgIGV2ZW50c0F0dHJOYW1lOiAndmFsdWUtZXZlbnRzJyxcbiAgICBmaWVsZEF0dHJOYW1lOiAndmFsdWUtZmllbGQnLFxuICAgIGRlZmF1bHRFdmVudHM6IFsgJ2NoYW5nZScgXSxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBuYW1lID0gdGhpcy5lbGVtZW50LnRhZ05hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgIHZhciB0eXBlID0gdGhpcy5lbGVtZW50LnR5cGU7XG4gICAgICB0aGlzLm1ldGhvZHMgPSBpbnB1dE1ldGhvZHNbdHlwZV0gfHwgaW5wdXRNZXRob2RzW25hbWVdO1xuXG4gICAgICBpZiAoIXRoaXMubWV0aG9kcykge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmVsZW1lbnQuaGFzQXR0cmlidXRlKHRoaXMuZXZlbnRzQXR0ck5hbWUpKSB7XG4gICAgICAgIHRoaXMuZXZlbnRzID0gdGhpcy5lbGVtZW50LmdldEF0dHJpYnV0ZSh0aGlzLmV2ZW50c0F0dHJOYW1lKS5zcGxpdCgnICcpO1xuICAgICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMuZXZlbnRzQXR0ck5hbWUpO1xuICAgICAgfSBlbHNlIGlmIChuYW1lICE9PSAnb3B0aW9uJykge1xuICAgICAgICB0aGlzLmV2ZW50cyA9IHRoaXMuZGVmYXVsdEV2ZW50cztcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuZWxlbWVudC5oYXNBdHRyaWJ1dGUodGhpcy5maWVsZEF0dHJOYW1lKSkge1xuICAgICAgICB0aGlzLnZhbHVlRmllbGQgPSB0aGlzLmVsZW1lbnQuZ2V0QXR0cmlidXRlKHRoaXMuZmllbGRBdHRyTmFtZSk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5maWVsZEF0dHJOYW1lKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGUgPT09ICdvcHRpb24nKSB7XG4gICAgICAgIHRoaXMudmFsdWVGaWVsZCA9IHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLnZhbHVlRmllbGQ7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCF0aGlzLmV2ZW50cykgcmV0dXJuOyAvLyBub3RoaW5nIGZvciA8b3B0aW9uPiBoZXJlXG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHZhciBvYnNlcnZlciA9IHRoaXMub2JzZXJ2ZXI7XG4gICAgICB2YXIgaW5wdXQgPSB0aGlzLm1ldGhvZHM7XG4gICAgICB2YXIgdmFsdWVGaWVsZCA9IHRoaXMudmFsdWVGaWVsZDtcblxuICAgICAgLy8gVGhlIDItd2F5IGJpbmRpbmcgcGFydCBpcyBzZXR0aW5nIHZhbHVlcyBvbiBjZXJ0YWluIGV2ZW50c1xuICAgICAgZnVuY3Rpb24gb25DaGFuZ2UoKSB7XG4gICAgICAgIGlmIChpbnB1dC5nZXQuY2FsbChlbGVtZW50LCB2YWx1ZUZpZWxkKSAhPT0gb2JzZXJ2ZXIub2xkVmFsdWUgJiYgIWVsZW1lbnQucmVhZE9ubHkpIHtcbiAgICAgICAgICBvYnNlcnZlci5zZXQoaW5wdXQuZ2V0LmNhbGwoZWxlbWVudCwgdmFsdWVGaWVsZCkpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChlbGVtZW50LnR5cGUgPT09ICd0ZXh0Jykge1xuICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgIGlmIChldmVudC5rZXlDb2RlID09PSAxMykgb25DaGFuZ2UoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuZXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBvbkNoYW5nZSk7XG4gICAgICB9KTtcbiAgICB9LFxuXG4gICAgdXBkYXRlZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICh0aGlzLm1ldGhvZHMuZ2V0LmNhbGwodGhpcy5lbGVtZW50LCB0aGlzLnZhbHVlRmllbGQpICE9IHZhbHVlKSB7XG4gICAgICAgIHRoaXMubWV0aG9kcy5zZXQuY2FsbCh0aGlzLmVsZW1lbnQsIHZhbHVlLCB0aGlzLnZhbHVlRmllbGQpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB0aGUgZGlmZmVyZW50IGZvcm0gdHlwZXNcbiAgICovXG4gIHZhciBkZWZhdWx0SW5wdXRNZXRob2QgPSB7XG4gICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudmFsdWU7IH0sXG4gICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkgeyB0aGlzLnZhbHVlID0gKHZhbHVlID09IG51bGwpID8gJycgOiB2YWx1ZTsgfVxuICB9O1xuXG4gIHZhciBpbnB1dE1ldGhvZHMgPSB7XG4gICAgY2hlY2tib3g6IHtcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmNoZWNrZWQ7IH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7IHRoaXMuY2hlY2tlZCA9ICEhdmFsdWU7IH1cbiAgICB9LFxuXG4gICAgZmlsZToge1xuICAgICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuZmlsZXMgJiYgdGhpcy5maWxlc1swXTsgfSxcbiAgICAgIHNldDogZnVuY3Rpb24oKSB7fVxuICAgIH0sXG5cbiAgICBzZWxlY3Q6IHtcbiAgICAgIGdldDogZnVuY3Rpb24odmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWVGaWVsZCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9wdGlvbnNbdGhpcy5zZWxlY3RlZEluZGV4XS52YWx1ZU9iamVjdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUsIHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHZhbHVlRmllbGQpIHtcbiAgICAgICAgICB0aGlzLnZhbHVlT2JqZWN0ID0gdmFsdWU7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlW3ZhbHVlRmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIG9wdGlvbjoge1xuICAgICAgZ2V0OiBmdW5jdGlvbih2YWx1ZUZpZWxkKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZUZpZWxkID8gdGhpcy52YWx1ZU9iamVjdFt2YWx1ZUZpZWxkXSA6IHRoaXMudmFsdWU7XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSwgdmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWVGaWVsZCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPYmplY3QgPSB2YWx1ZTtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVbdmFsdWVGaWVsZF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgaW5wdXQ6IGRlZmF1bHRJbnB1dE1ldGhvZCxcblxuICAgIHRleHRhcmVhOiBkZWZhdWx0SW5wdXRNZXRob2RcbiAgfTtcblxuXG4gIC8qKlxuICAgKiAjIyBvbi1bZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgZm9yIGVhY2ggZXZlbnQgbmFtZSBpbiB0aGUgYXJyYXkuIFdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZCB0aGUgZXhwcmVzc2lvbiB3aWxsIGJlIHJ1bi5cbiAgICpcbiAgICogKipFeGFtcGxlIEV2ZW50czoqKlxuICAgKlxuICAgKiAqIG9uLWNsaWNrXG4gICAqICogb24tZGJsY2xpY2tcbiAgICogKiBvbi1zdWJtaXRcbiAgICogKiBvbi1jaGFuZ2VcbiAgICogKiBvbi1mb2N1c1xuICAgKiAqIG9uLWJsdXJcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0gb24tc3VibWl0PVwie3tzYXZlVXNlcigpfX1cIj5cbiAgICogICA8aW5wdXQgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICogICA8YnV0dG9uPlNhdmU8L2J1dHRvbj5cbiAgICogPC9mb3JtPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCAoZXZlbnRzIGRvbid0IGFmZmVjdCB0aGUgSFRNTCk6KlxuICAgKiBgYGBodG1sXG4gICAqIDxmb3JtPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0qJywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGV2ZW50TmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAoIXRoaXMuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpICYmIF90aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAvLyBTZXQgdGhlIGV2ZW50IG9uIHRoZSBjb250ZXh0IHNvIGl0IG1heSBiZSB1c2VkIGluIHRoZSBleHByZXNzaW9uIHdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZC5cbiAgICAgICAgICB2YXIgcHJpb3JFdmVudCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2V2ZW50Jyk7XG4gICAgICAgICAgdmFyIHByaW9yRWxlbWVudCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2VsZW1lbnQnKTtcbiAgICAgICAgICBfdGhpcy5zZXRFdmVudChldmVudCwgcHJpb3JFdmVudCwgcHJpb3JFbGVtZW50KTtcblxuICAgICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcblxuICAgICAgICAgIC8vIFJlc2V0IHRoZSBjb250ZXh0IHRvIGl0cyBwcmlvciBzdGF0ZVxuICAgICAgICAgIF90aGlzLmNsZWFyRXZlbnQoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5jbGVhckV2ZW50KCk7XG4gICAgfSxcblxuICAgIHNldEV2ZW50OiBmdW5jdGlvbihldmVudCwgcHJpb3JFdmVudERlc2NyaXB0b3IsIHByaW9yRWxlbWVudERlc2NyaXB0b3IpIHtcbiAgICAgIGlmICghdGhpcy5jb250ZXh0KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMuZXZlbnQgPSBldmVudDtcbiAgICAgIHRoaXMucHJpb3JFdmVudERlc2NyaXB0b3IgPSBwcmlvckV2ZW50RGVzY3JpcHRvcjtcbiAgICAgIHRoaXMucHJpb3JFbGVtZW50RGVzY3JpcHRvciA9IHByaW9yRWxlbWVudERlc2NyaXB0b3I7XG4gICAgICB0aGlzLmxhc3RDb250ZXh0ID0gdGhpcy5jb250ZXh0O1xuXG4gICAgICB0aGlzLmNvbnRleHQuZXZlbnQgPSBldmVudDtcbiAgICAgIHRoaXMuY29udGV4dC5lbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgIH0sXG5cbiAgICBjbGVhckV2ZW50OiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghdGhpcy5ldmVudCkge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgY29udGV4dCA9IHRoaXMubGFzdENvbnRleHQ7XG5cbiAgICAgIGlmICh0aGlzLnByaW9yRXZlbnREZXNjcmlwdG9yKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShjb250ZXh0LCAnZXZlbnQnLCB0aGlzLnByaW9yRXZlbnREZXNjcmlwdG9yKTtcbiAgICAgICAgdGhpcy5wcmlvckV2ZW50RGVzY3JpcHRvciA9IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWxldGUgY29udGV4dC5ldmVudDtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMucHJpb3JFbGVtZW50RGVzY3JpcHRvcikge1xuICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoY29udGV4dCwgJ2VsZW1lbnQnLCB0aGlzLnByaW9yRWxlbWVudERlc2NyaXB0b3IpO1xuICAgICAgICB0aGlzLnByaW9yRWxlbWVudERlc2NyaXB0b3IgPSBudWxsO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZGVsZXRlIGNvbnRleHQuZWxlbWVudDtcbiAgICAgIH1cblxuICAgICAgdGhpcy5ldmVudCA9IG51bGw7XG4gICAgICB0aGlzLmxhc3RDb250ZXh0ID0gbnVsbDtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtrZXkgZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgd2hpY2ggaXMgdHJpZ2dlcmVkIHdoZW4gdGhlIGtleWRvd24gZXZlbnQncyBga2V5Q29kZWAgcHJvcGVydHkgbWF0Y2hlcy4gSWYgdGhlIG5hbWUgaW5jbHVkZXMgY3RybFxuICAgKiB0aGVuIGl0IHdpbGwgb25seSBmaXJlIHdoZW4gdGhlIGtleSBwbHVzIHRoZSBjdHJsS2V5IG9yIG1ldGFLZXkgaXMgcHJlc3NlZC5cbiAgICpcbiAgICogKipLZXkgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tZW50ZXJcbiAgICogKiBvbi1jdHJsLWVudGVyXG4gICAqICogb24tZXNjXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dCBvbi1lbnRlcj1cInt7c2F2ZSgpfX1cIiBvbi1lc2M9XCJ7e2NhbmNlbCgpfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIga2V5Q29kZXMgPSB7IGVudGVyOiAxMywgZXNjOiAyNywgJ2N0cmwtZW50ZXInOiAxMyB9O1xuXG4gIE9iamVjdC5rZXlzKGtleUNvZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIga2V5Q29kZSA9IGtleUNvZGVzW25hbWVdO1xuXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0nICsgbmFtZSwge1xuICAgICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciB1c2VDdHJsS2V5ID0gbmFtZS5pbmRleE9mKCdjdHJsLScpID09PSAwO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKHVzZUN0cmxLZXkgJiYgIShldmVudC5jdHJsS2V5IHx8IGV2ZW50Lm1ldGFLZXkpIHx8ICFfdGhpcy5jb250ZXh0KSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgIT09IGtleUNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgaWYgKCF0aGlzLmhhc0F0dHJpYnV0ZSgnZGlzYWJsZWQnKSkge1xuICAgICAgICAgICAgLy8gU2V0IHRoZSBldmVudCBvbiB0aGUgY29udGV4dCBzbyBpdCBtYXkgYmUgdXNlZCBpbiB0aGUgZXhwcmVzc2lvbiB3aGVuIHRoZSBldmVudCBpcyB0cmlnZ2VyZWQuXG4gICAgICAgICAgICB2YXIgcHJpb3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKF90aGlzLmNvbnRleHQsICdldmVudCcpO1xuICAgICAgICAgICAgX3RoaXMuY29udGV4dC5ldmVudCA9IGV2ZW50O1xuXG4gICAgICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG5cbiAgICAgICAgICAgIC8vIFJlc2V0IHRoZSBjb250ZXh0IHRvIGl0cyBwcmlvciBzdGF0ZVxuICAgICAgICAgICAgaWYgKHByaW9yKSB7XG4gICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShfdGhpcy5jb250ZXh0LCBldmVudCwgcHJpb3IpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZGVsZXRlIF90aGlzLmNvbnRleHQuZXZlbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgW2F0dHJpYnV0ZV0kXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gc2V0IHRoZSBhdHRyaWJ1dGUgb2YgZWxlbWVudCB0byB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24uIFVzZSB0aGlzIHdoZW4geW91IGRvbid0IHdhbnQgYW5cbiAgICogYDxpbWc+YCB0byB0cnkgYW5kIGxvYWQgaXRzIGBzcmNgIGJlZm9yZSBiZWluZyBldmFsdWF0ZWQuIFRoaXMgaXMgb25seSBuZWVkZWQgb24gdGhlIGluZGV4Lmh0bWwgcGFnZSBhcyB0ZW1wbGF0ZVxuICAgKiB3aWxsIGJlIHByb2Nlc3NlZCBiZWZvcmUgYmVpbmcgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBHZW5lcmFsbHkgeW91IGNhbiBqdXN0IHVzZSBgYXR0cj1cInt7ZXhwcn19XCJgLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgQXR0cmlidXRlczoqKlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aW1nIHNyYyQ9XCJ7e3VzZXIuYXZhdGFyVXJsfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjPVwiaHR0cDovL2Nkbi5leGFtcGxlLmNvbS9hdmF0YXJzL2phY3dyaWdodC1zbWFsbC5wbmdcIj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJyokJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgYXR0ck5hbWUgPSB0aGlzLm1hdGNoO1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKGF0dHJOYW1lLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXT9cbiAgICogQWRkcyBhIGJpbmRlciB0byB0b2dnbGUgYW4gYXR0cmlidXRlIG9uIG9yIG9mZiBpZiB0aGUgZXhwcmVzc2lvbiBpcyB0cnV0aHkgb3IgZmFsc2V5LiBVc2UgZm9yIGF0dHJpYnV0ZXMgd2l0aG91dFxuICAgKiB2YWx1ZXMgc3VjaCBhcyBgc2VsZWN0ZWRgLCBgZGlzYWJsZWRgLCBvciBgcmVhZG9ubHlgLiBgY2hlY2tlZD9gIHdpbGwgdXNlIDItd2F5IGRhdGFiaW5kaW5nLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+SXMgQWRtaW5pc3RyYXRvcjwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIiBjaGVja2VkPz1cInt7dXNlci5pc0FkbWlufX1cIj5cbiAgICogPGJ1dHRvbiBkaXNhYmxlZD89XCJ7e2lzUHJvY2Vzc2luZ319XCI+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGBpc1Byb2Nlc3NpbmdgIGlzIGB0cnVlYCBhbmQgYHVzZXIuaXNBZG1pbmAgaXMgZmFsc2U6KlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPlN1Ym1pdDwvYnV0dG9uPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKj8nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsICcnKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIEFkZCBhIGNsb25lIG9mIHRoZSBgdmFsdWVgIGJpbmRlciBmb3IgYGNoZWNrZWQ/YCBzbyBjaGVja2JveGVzIGNhbiBoYXZlIHR3by13YXkgYmluZGluZyB1c2luZyBgY2hlY2tlZD9gLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjaGVja2VkPycsIGZyYWdtZW50cy5nZXRBdHRyaWJ1dGVCaW5kZXIoJ3ZhbHVlJykpO1xuXG5cbiAgLyoqXG4gICAqIFNob3dzL2hpZGVzIGFuIGVsZW1lbnQgY29uZGl0aW9uYWxseS4gYGlmYCBzaG91bGQgYmUgdXNlZCBpbiBtb3N0IGNhc2VzIGFzIGl0IHJlbW92ZXMgdGhlIGVsZW1lbnQgY29tcGxldGVseSBhbmQgaXNcbiAgICogbW9yZSBlZmZlY2llbnQgc2luY2UgYmluZGluZ3Mgd2l0aGluIHRoZSBgaWZgIGFyZSBub3QgYWN0aXZlIHdoaWxlIGl0IGlzIGhpZGRlbi4gVXNlIGBzaG93YCBmb3Igd2hlbiB0aGUgZWxlbWVudFxuICAgKiBtdXN0IHJlbWFpbiBpbi1ET00gb3IgYmluZGluZ3Mgd2l0aGluIGl0IG11c3QgY29udGludWUgdG8gYmUgcHJvY2Vzc2VkIHdoaWxlIGl0IGlzIGhpZGRlbi4gWW91IHNob3VsZCBkZWZhdWx0IHRvXG4gICAqIHVzaW5nIGBpZmAuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3Nob3cnLCB7XG4gICAgYW5pbWF0ZWQ6IHRydWUsXG4gICAgdXBkYXRlZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIC8vIEZvciBwZXJmb3JtYW5jZSBwcm92aWRlIGFuIGFsdGVybmF0ZSBjb2RlIHBhdGggZm9yIGFuaW1hdGlvblxuICAgICAgaWYgKHRoaXMuYW5pbWF0ZSAmJiB0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodmFsdWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy51cGRhdGVkUmVndWxhcih2YWx1ZSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZWRSZWd1bGFyOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlZEFuaW1hdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgdGhpcy5sYXN0VmFsdWUgPSB2YWx1ZTtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgIGZ1bmN0aW9uIG9uRmluaXNoKCkge1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgICBpZiAodGhpcy5sYXN0VmFsdWUgIT09IHZhbHVlKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuZGlzcGxheSA9ICcnO1xuICAgICAgICB0aGlzLmFuaW1hdGVJbih0aGlzLmVsZW1lbnQsIG9uRmluaXNoKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh0aGlzLmVsZW1lbnQsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICAgICAgICAgIG9uRmluaXNoLmNhbGwodGhpcyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1bmJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgaWYsIHVubGVzcywgZWxzZS1pZiwgZWxzZS11bmxlc3MsIGVsc2VcbiAgICogQWRkcyBhIGJpbmRlciB0byBzaG93IG9yIGhpZGUgdGhlIGVsZW1lbnQgaWYgdGhlIHZhbHVlIGlzIHRydXRoeSBvciBmYWxzZXkuIEFjdHVhbGx5IHJlbW92ZXMgdGhlIGVsZW1lbnQgZnJvbSB0aGVcbiAgICogRE9NIHdoZW4gaGlkZGVuLCByZXBsYWNpbmcgaXQgd2l0aCBhIG5vbi12aXNpYmxlIHBsYWNlaG9sZGVyIGFuZCBub3QgbmVlZGxlc3NseSBleGVjdXRpbmcgYmluZGluZ3MgaW5zaWRlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGkgaWY9XCJ1c2VyXCI+PGEgaHJlZj1cIi9hY2NvdW50XCI+TXkgQWNjb3VudDwvYT48L2xpPlxuICAgKiAgIDxsaSB1bmxlc3M9XCJ1c2VyXCI+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogICA8bGkgZWxzZT48YSBocmVmPVwiL2xvZ291dFwiPlNpZ24gT3V0PC9hPjwvbGk+XG4gICAqIDwvdWw+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGB1c2VyYCBpcyBudWxsOipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGk+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIgSWZCaW5kaW5nID0gZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdpZicsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogMTUwLFxuICAgIHVubGVzc0F0dHJOYW1lOiAndW5sZXNzJyxcbiAgICBlbHNlSWZBdHRyTmFtZTogJ2Vsc2UtaWYnLFxuICAgIGVsc2VVbmxlc3NBdHRyTmFtZTogJ2Vsc2UtdW5sZXNzJyxcbiAgICBlbHNlQXR0ck5hbWU6ICdlbHNlJyxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgdmFyIGV4cHJlc3Npb25zID0gWyB3cmFwSWZFeHAodGhpcy5leHByZXNzaW9uLCB0aGlzLm5hbWUgPT09IHRoaXMudW5sZXNzQXR0ck5hbWUpIF07XG4gICAgICB2YXIgcGxhY2Vob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICB2YXIgbm9kZSA9IGVsZW1lbnQubmV4dEVsZW1lbnRTaWJsaW5nO1xuICAgICAgdGhpcy5lbGVtZW50ID0gcGxhY2Vob2xkZXI7XG4gICAgICBlbGVtZW50LnBhcmVudE5vZGUucmVwbGFjZUNoaWxkKHBsYWNlaG9sZGVyLCBlbGVtZW50KTtcblxuICAgICAgLy8gU3RvcmVzIGEgdGVtcGxhdGUgZm9yIGFsbCB0aGUgZWxlbWVudHMgdGhhdCBjYW4gZ28gaW50byB0aGlzIHNwb3RcbiAgICAgIHRoaXMudGVtcGxhdGVzID0gWyBmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUoZWxlbWVudCkgXTtcblxuICAgICAgLy8gUHVsbCBvdXQgYW55IG90aGVyIGVsZW1lbnRzIHRoYXQgYXJlIGNoYWluZWQgd2l0aCB0aGlzIG9uZVxuICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgdmFyIG5leHQgPSBub2RlLm5leHRFbGVtZW50U2libGluZztcbiAgICAgICAgdmFyIGV4cHJlc3Npb247XG4gICAgICAgIGlmIChub2RlLmhhc0F0dHJpYnV0ZSh0aGlzLmVsc2VJZkF0dHJOYW1lKSkge1xuICAgICAgICAgIGV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgbm9kZS5nZXRBdHRyaWJ1dGUodGhpcy5lbHNlSWZBdHRyTmFtZSkpO1xuICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2god3JhcElmRXhwKGV4cHJlc3Npb24sIGZhbHNlKSk7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUodGhpcy5lbHNlSWZBdHRyTmFtZSk7XG4gICAgICAgIH0gZWxzZSBpZiAobm9kZS5oYXNBdHRyaWJ1dGUodGhpcy5lbHNlVW5sZXNzQXR0ck5hbWUpKSB7XG4gICAgICAgICAgZXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBub2RlLmdldEF0dHJpYnV0ZSh0aGlzLmVsc2VVbmxlc3NBdHRyTmFtZSkpO1xuICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2god3JhcElmRXhwKGV4cHJlc3Npb24sIHRydWUpKTtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmVsc2VVbmxlc3NBdHRyTmFtZSk7XG4gICAgICAgIH0gZWxzZSBpZiAobm9kZS5oYXNBdHRyaWJ1dGUodGhpcy5lbHNlQXR0ck5hbWUpKSB7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUodGhpcy5lbHNlQXR0ck5hbWUpO1xuICAgICAgICAgIG5leHQgPSBudWxsO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5yZW1vdmUoKTtcbiAgICAgICAgdGhpcy50ZW1wbGF0ZXMucHVzaChmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUobm9kZSkpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cblxuICAgICAgLy8gQW4gZXhwcmVzc2lvbiB0aGF0IHdpbGwgcmV0dXJuIGFuIGluZGV4LiBTb21ldGhpbmcgbGlrZSB0aGlzIGBleHByID8gMCA6IGV4cHIyID8gMSA6IGV4cHIzID8gMiA6IDNgLiBUaGlzIHdpbGxcbiAgICAgIC8vIGJlIHVzZWQgdG8ga25vdyB3aGljaCBzZWN0aW9uIHRvIHNob3cgaW4gdGhlIGlmL2Vsc2UtaWYvZWxzZSBncm91cGluZy5cbiAgICAgIHRoaXMuZXhwcmVzc2lvbiA9IGV4cHJlc3Npb25zLm1hcChmdW5jdGlvbihleHByLCBpbmRleCkge1xuICAgICAgICByZXR1cm4gZXhwciArICcgPyAnICsgaW5kZXggKyAnIDogJztcbiAgICAgIH0pLmpvaW4oJycpICsgZXhwcmVzc2lvbnMubGVuZ3RoO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgLy8gRm9yIHBlcmZvcm1hbmNlIHByb3ZpZGUgYW4gYWx0ZXJuYXRlIGNvZGUgcGF0aCBmb3IgYW5pbWF0aW9uXG4gICAgICBpZiAodGhpcy5hbmltYXRlICYmIHRoaXMuY29udGV4dCAmJiAhdGhpcy5maXJzdFVwZGF0ZSkge1xuICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZChpbmRleCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnVwZGF0ZWRSZWd1bGFyKGluZGV4KTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZmlyc3RVcGRhdGUgPSBmYWxzZTtcbiAgICB9LFxuXG4gICAgYWRkOiBmdW5jdGlvbih2aWV3KSB7XG4gICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUodmlldywgdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nKTtcbiAgICB9LFxuXG4gICAgLy8gRG9lc24ndCBkbyBtdWNoLCBidXQgYWxsb3dzIHN1Yi1jbGFzc2VzIHRvIGFsdGVyIHRoZSBmdW5jdGlvbmFsaXR5LlxuICAgIHJlbW92ZTogZnVuY3Rpb24odmlldykge1xuICAgICAgdmlldy5kaXNwb3NlKCk7XG4gICAgfSxcblxuICAgIHVwZGF0ZWRSZWd1bGFyOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnJlbW92ZSh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgfVxuICAgICAgdmFyIHRlbXBsYXRlID0gdGhpcy50ZW1wbGF0ZXNbaW5kZXhdO1xuICAgICAgaWYgKHRlbXBsYXRlKSB7XG4gICAgICAgIHRoaXMuc2hvd2luZyA9IHRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgICAgdGhpcy5zaG93aW5nLmJpbmQodGhpcy5jb250ZXh0KTtcbiAgICAgICAgdGhpcy5hZGQodGhpcy5zaG93aW5nKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlZEFuaW1hdGVkOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgdGhpcy5sYXN0VmFsdWUgPSBpbmRleDtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICAvLyBPYnNvbGV0ZWQsIHdpbGwgY2hhbmdlIGFmdGVyIGFuaW1hdGlvbiBpcyBmaW5pc2hlZC5cbiAgICAgICAgdGhpcy5zaG93aW5nLnVuYmluZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh0aGlzLnNob3dpbmcsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG5cbiAgICAgICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhpcyB3YXNuJ3QgdW5ib3VuZCB3aGlsZSB3ZSB3ZXJlIGFuaW1hdGluZyAoZS5nLiBieSBhIHBhcmVudCBgaWZgIHRoYXQgZG9lc24ndCBhbmltYXRlKVxuICAgICAgICAgICAgdGhpcy5yZW1vdmUodGhpcy5zaG93aW5nKTtcbiAgICAgICAgICAgIHRoaXMuc2hvd2luZyA9IG51bGw7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRoaXMuY29udGV4dCkge1xuICAgICAgICAgICAgLy8gZmluaXNoIGJ5IGFuaW1hdGluZyB0aGUgbmV3IGVsZW1lbnQgaW4gKGlmIGFueSksIHVubGVzcyBubyBsb25nZXIgYm91bmRcbiAgICAgICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKHRoaXMubGFzdFZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciB0ZW1wbGF0ZSA9IHRoaXMudGVtcGxhdGVzW2luZGV4XTtcbiAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnNob3dpbmcgPSB0ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICAgIHRoaXMuc2hvd2luZy5iaW5kKHRoaXMuY29udGV4dCk7XG4gICAgICAgIHRoaXMuYWRkKHRoaXMuc2hvd2luZyk7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odGhpcy5zaG93aW5nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgICAgIC8vIGlmIHRoZSB2YWx1ZSBjaGFuZ2VkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZyBydW4gaXQgYWdhaW5cbiAgICAgICAgICBpZiAodGhpcy5sYXN0VmFsdWUgIT09IGluZGV4KSB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5maXJzdFVwZGF0ZSA9IHRydWU7XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICB9XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd1bmxlc3MnLCBJZkJpbmRpbmcpO1xuXG4gIGZ1bmN0aW9uIHdyYXBJZkV4cChleHByLCBpc1VubGVzcykge1xuICAgIGlmIChpc1VubGVzcykge1xuICAgICAgcmV0dXJuICchKCcgKyBleHByICsgJyknO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gZXhwcjtcbiAgICB9XG4gIH1cblxuXG4gIC8qKlxuICAgKiAjIyByZXBlYXRcbiAgICogQWRkcyBhIGJpbmRlciB0byBkdXBsaWNhdGUgYW4gZWxlbWVudCBmb3IgZWFjaCBpdGVtIGluIGFuIGFycmF5LiBUaGUgZXhwcmVzc2lvbiBtYXkgYmUgb2YgdGhlIGZvcm1hdCBgZXB4cmAgb3JcbiAgICogYGl0ZW1OYW1lIGluIGV4cHJgIHdoZXJlIGBpdGVtTmFtZWAgaXMgdGhlIG5hbWUgZWFjaCBpdGVtIGluc2lkZSB0aGUgYXJyYXkgd2lsbCBiZSByZWZlcmVuY2VkIGJ5IHdpdGhpbiBiaW5kaW5nc1xuICAgKiBpbnNpZGUgdGhlIGVsZW1lbnQuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgZWFjaD1cInt7cG9zdCBpbiBwb3N0c319XCIgY2xhc3MtZmVhdHVyZWQ9XCJ7e3Bvc3QuaXNGZWF0dXJlZH19XCI+XG4gICAqICAgPGgxPnt7cG9zdC50aXRsZX19PC9oMT5cbiAgICogICA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIHRoZXJlIGFyZSAyIHBvc3RzIGFuZCB0aGUgZmlyc3Qgb25lIGlzIGZlYXR1cmVkOipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwiZmVhdHVyZWRcIj5cbiAgICogICA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICAgIDxwPlxuICAgKiAgICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiA8ZGl2PlxuICAgKiAgIDxoMT5CaWcgQmx1ZTwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPlNvbWUgdGhvdWdodHMgb24gdGhlIE5ldyBZb3JrIEdpYW50cy48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9OZXdfWW9ya19HaWFudHNcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgncmVwZWF0Jywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiAxMDAsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGFyZW50ID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICB2YXIgcGxhY2Vob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyLCB0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy50ZW1wbGF0ZSA9IGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZSh0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy5lbGVtZW50ID0gcGxhY2Vob2xkZXI7XG5cbiAgICAgIHZhciBwYXJ0cyA9IHRoaXMuZXhwcmVzc2lvbi5zcGxpdCgvXFxzK2luXFxzKy8pO1xuICAgICAgdGhpcy5leHByZXNzaW9uID0gcGFydHMucG9wKCk7XG4gICAgICB2YXIga2V5ID0gcGFydHMucG9wKCk7XG4gICAgICBpZiAoa2V5KSB7XG4gICAgICAgIHBhcnRzID0ga2V5LnNwbGl0KC9cXHMqLFxccyovKTtcbiAgICAgICAgdGhpcy52YWx1ZU5hbWUgPSBwYXJ0cy5wb3AoKTtcbiAgICAgICAgdGhpcy5rZXlOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy52aWV3cyA9IFtdO1xuICAgICAgdGhpcy5vYnNlcnZlci5nZXRDaGFuZ2VSZWNvcmRzID0gdHJ1ZTtcbiAgICB9LFxuXG4gICAgcmVtb3ZlVmlldzogZnVuY3Rpb24odmlldykge1xuICAgICAgdmlldy5kaXNwb3NlKCk7XG4gICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IG51bGw7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKCFjaGFuZ2VzIHx8ICF0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5wb3B1bGF0ZSh2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5hbmltYXRlKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzQW5pbWF0ZWQodmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlcyh2YWx1ZSwgY2hhbmdlcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gTWV0aG9kIGZvciBjcmVhdGluZyBhbmQgc2V0dGluZyB1cCBuZXcgdmlld3MgZm9yIG91ciBsaXN0XG4gICAgY3JlYXRlVmlldzogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgdmFyIHZpZXcgPSB0aGlzLnRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgIHZhciBjb250ZXh0ID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy52YWx1ZU5hbWUpIHtcbiAgICAgICAgY29udGV4dCA9IE9iamVjdC5jcmVhdGUodGhpcy5jb250ZXh0KTtcbiAgICAgICAgaWYgKHRoaXMua2V5TmFtZSkgY29udGV4dFt0aGlzLmtleU5hbWVdID0ga2V5O1xuICAgICAgICBjb250ZXh0W3RoaXMudmFsdWVOYW1lXSA9IHZhbHVlO1xuICAgICAgICBjb250ZXh0Ll9vcmlnQ29udGV4dF8gPSB0aGlzLmNvbnRleHQuaGFzT3duUHJvcGVydHkoJ19vcmlnQ29udGV4dF8nKVxuICAgICAgICAgID8gdGhpcy5jb250ZXh0Ll9vcmlnQ29udGV4dF9cbiAgICAgICAgICA6IHRoaXMuY29udGV4dDtcbiAgICAgIH1cbiAgICAgIHZpZXcuYmluZChjb250ZXh0KTtcbiAgICAgIHZpZXcuX3JlcGVhdEl0ZW1fID0gdmFsdWU7XG4gICAgICByZXR1cm4gdmlldztcbiAgICB9LFxuXG4gICAgcG9wdWxhdGU6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gdmFsdWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMudmlld3MubGVuZ3RoKSB7XG4gICAgICAgIHRoaXMudmlld3MuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuICAgICAgICB0aGlzLnZpZXdzLmxlbmd0aCA9IDA7XG4gICAgICB9XG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiB2YWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG5cbiAgICAgICAgdmFsdWUuZm9yRWFjaChmdW5jdGlvbihpdGVtLCBpbmRleCkge1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGluZGV4LCBpdGVtKTtcbiAgICAgICAgICB0aGlzLnZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfSwgdGhpcyk7XG5cbiAgICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWcsIHRoaXMuZWxlbWVudC5uZXh0U2libGluZyk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgdW4tYW5pbWF0ZWQgdmVyc2lvbiByZW1vdmVzIGFsbCByZW1vdmVkIHZpZXdzIGZpcnN0IHNvIHRoZXkgY2FuIGJlIHJldHVybmVkIHRvIHRoZSBwb29sIGFuZCB0aGVuIGFkZHMgbmV3XG4gICAgICogdmlld3MgYmFjayBpbi4gVGhpcyBpcyB0aGUgbW9zdCBvcHRpbWFsIG1ldGhvZCB3aGVuIG5vdCBhbmltYXRpbmcuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlczogZnVuY3Rpb24odmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIC8vIFJlbW92ZSBldmVyeXRoaW5nIGZpcnN0LCB0aGVuIGFkZCBhZ2FpbiwgYWxsb3dpbmcgZm9yIGVsZW1lbnQgcmV1c2UgZnJvbSB0aGUgcG9vbFxuICAgICAgdmFyIGFkZGVkQ291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIGFkZGVkQ291bnQgKz0gc3BsaWNlLmFkZGVkQ291bnQ7XG4gICAgICAgIGlmICghc3BsaWNlLnJlbW92ZWQubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciByZW1vdmVkID0gdGhpcy52aWV3cy5zcGxpY2Uoc3BsaWNlLmluZGV4IC0gYWRkZWRDb3VudCwgc3BsaWNlLnJlbW92ZWQubGVuZ3RoKTtcbiAgICAgICAgcmVtb3ZlZC5mb3JFYWNoKHRoaXMucmVtb3ZlVmlldyk7XG4gICAgICB9LCB0aGlzKTtcblxuICAgICAgLy8gQWRkIHRoZSBuZXcvbW92ZWQgdmlld3NcbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UuYWRkZWRDb3VudCkgcmV0dXJuO1xuICAgICAgICB2YXIgYWRkZWRWaWV3cyA9IFtdO1xuICAgICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICAgIHZhciBpbmRleCA9IHNwbGljZS5pbmRleDtcbiAgICAgICAgdmFyIGVuZEluZGV4ID0gaW5kZXggKyBzcGxpY2UuYWRkZWRDb3VudDtcblxuICAgICAgICBmb3IgKHZhciBpID0gaW5kZXg7IGkgPCBlbmRJbmRleDsgaSsrKSB7XG4gICAgICAgICAgdmFyIGl0ZW0gPSB2YWx1ZVtpXTtcbiAgICAgICAgICB2YXIgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpLCBpdGVtKTtcbiAgICAgICAgICBhZGRlZFZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cy5zcGxpY2UuYXBwbHkodGhpcy52aWV3cywgWyBpbmRleCwgMCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgYW5pbWF0ZWQgdmVyc2lvbiBtdXN0IGFuaW1hdGUgcmVtb3ZlZCBub2RlcyBvdXQgd2hpbGUgYWRkZWQgbm9kZXMgYXJlIGFuaW1hdGluZyBpbiBtYWtpbmcgaXQgbGVzcyBvcHRpbWFsXG4gICAgICogKGJ1dCBjb29sIGxvb2tpbmcpLiBJdCBhbHNvIGhhbmRsZXMgXCJtb3ZlXCIgYW5pbWF0aW9ucyBmb3Igbm9kZXMgd2hpY2ggYXJlIG1vdmluZyBwbGFjZSB3aXRoaW4gdGhlIGxpc3QuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlc0FuaW1hdGVkOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgYW5pbWF0aW5nVmFsdWUgPSB2YWx1ZS5zbGljZSgpO1xuICAgICAgdmFyIGFsbEFkZGVkID0gW107XG4gICAgICB2YXIgYWxsUmVtb3ZlZCA9IFtdO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuXG4gICAgICAvLyBSdW4gdXBkYXRlcyB3aGljaCBvY2N1cmVkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZy5cbiAgICAgIGZ1bmN0aW9uIHdoZW5Eb25lKCkge1xuICAgICAgICAvLyBUaGUgbGFzdCBhbmltYXRpb24gZmluaXNoZWQgd2lsbCBydW4gdGhpc1xuICAgICAgICBpZiAoLS13aGVuRG9uZS5jb3VudCAhPT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuXG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcpIHtcbiAgICAgICAgICB2YXIgY2hhbmdlcyA9IGRpZmYuYXJyYXlzKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgYW5pbWF0aW5nVmFsdWUpO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgY2hhbmdlcyk7XG4gICAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgd2hlbkRvbmUuY291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICB2YXIgcmVtb3ZlZENvdW50ID0gc3BsaWNlLnJlbW92ZWQubGVuZ3RoO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIGFkZGVkVmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZW1vdmVkVmlld3MgPSB0aGlzLnZpZXdzLnNwbGljZS5hcHBseSh0aGlzLnZpZXdzLCBbIGluZGV4LCByZW1vdmVkQ291bnQgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5leHRTaWJsaW5nKTtcblxuICAgICAgICBhbGxBZGRlZCA9IGFsbEFkZGVkLmNvbmNhdChhZGRlZFZpZXdzKTtcbiAgICAgICAgYWxsUmVtb3ZlZCA9IGFsbFJlbW92ZWQuY29uY2F0KHJlbW92ZWRWaWV3cyk7XG4gICAgICB9LCB0aGlzKTtcblxuXG4gICAgICBhbGxBZGRlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odmlldywgd2hlbkRvbmUpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgIHdoZW5Eb25lLmNvdW50Kys7XG4gICAgICAgIHZpZXcudW5iaW5kKCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh2aWV3LCB3aGVuRG9uZSk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLnZpZXdzLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICB2aWV3LnVuYmluZCgpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSBudWxsO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG5cbi8qKlxuICogIyBEZWZhdWx0IEZvcm1hdHRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGZvcm1hdHRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3Rva2VuTGlzdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiB2IFRPRE8gdlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzdHlsZXMnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZmlsdGVyXG4gICAqIEZpbHRlcnMgYW4gYXJyYXkgYnkgdGhlIGdpdmVuIGZpbHRlciBmdW5jdGlvbihzKSwgbWF5IHByb3ZpZGUgYSBmdW5jdGlvbiwgYW5cbiAgICogYXJyYXksIG9yIGFuIG9iamVjdCB3aXRoIGZpbHRlcmluZyBmdW5jdGlvbnNcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmlsdGVyJywgZnVuY3Rpb24odmFsdWUsIGZpbHRlckZ1bmMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmICghZmlsdGVyRnVuYykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZmlsdGVyRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGZpbHRlckZ1bmMpKSB7XG4gICAgICBmaWx0ZXJGdW5jLmZvckVhY2goZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdvYmplY3QnKSB7XG4gICAgICBPYmplY3Qua2V5cyhmaWx0ZXJGdW5jKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICB2YXIgZnVuYyA9IGZpbHRlckZ1bmNba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG1hcFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIG1hcCBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gbWFwcGluZyBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdtYXAnLCBmdW5jdGlvbih2YWx1ZSwgbWFwRnVuYykge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChtYXBGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hcEZ1bmMuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdyZWR1Y2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIHJlZHVjZUZ1bmMoaW5pdGlhbFZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzbGljZScsIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgZW5kSW5kZXgpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zbGljZShpbmRleCwgZW5kSW5kZXgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBkYXRlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gZm9ybWF0IGRhdGVzIGFuZCBzdHJpbmdzXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS50b0xvY2FsZVN0cmluZygpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsb2dcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsb2cgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLCB1c2VmdWwgZm9yIGRlYnVnZ2luZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsb2cnLCBmdW5jdGlvbih2YWx1ZSwgcHJlZml4KSB7XG4gICAgaWYgKHByZWZpeCA9PSBudWxsKSBwcmVmaXggPSAnTG9nOic7XG4gICAgLyplc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgY29uc29sZS5sb2cocHJlZml4LCB2YWx1ZSk7XG4gICAgLyplc2xpbnQtZW5hYmxlICovXG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsaW1pdFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxpbWl0IHRoZSBsZW5ndGggb2YgYW4gYXJyYXkgb3Igc3RyaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xpbWl0JywgZnVuY3Rpb24odmFsdWUsIGxpbWl0KSB7XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5zbGljZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGxpbWl0IDwgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UobGltaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUuc2xpY2UoMCwgbGltaXQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBzb3J0XG4gICAqIFNvcnRzIGFuIGFycmF5IGdpdmVuIGEgZmllbGQgbmFtZSBvciBzb3J0IGZ1bmN0aW9uLCBhbmQgYSBkaXJlY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc29ydCcsIGZ1bmN0aW9uKHZhbHVlLCBzb3J0RnVuYywgZGlyKSB7XG4gICAgaWYgKCFzb3J0RnVuYyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgZGlyID0gKGRpciA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICBpZiAodHlwZW9mIHNvcnRGdW5jID09PSAnc3RyaW5nJykge1xuICAgICAgdmFyIHBhcnRzID0gc29ydEZ1bmMuc3BsaXQoJzonKTtcbiAgICAgIHZhciBwcm9wID0gcGFydHNbMF07XG4gICAgICB2YXIgZGlyMiA9IHBhcnRzWzFdO1xuICAgICAgZGlyMiA9IChkaXIyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgICAgZGlyID0gZGlyIHx8IGRpcjI7XG4gICAgICBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgaWYgKGFbcHJvcF0gPiBiW3Byb3BdKSByZXR1cm4gZGlyO1xuICAgICAgICBpZiAoYVtwcm9wXSA8IGJbcHJvcF0pIHJldHVybiAtZGlyO1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmIChkaXIgPT09IC0xKSB7XG4gICAgICB2YXIgb3JpZ0Z1bmMgPSBzb3J0RnVuYztcbiAgICAgIHNvcnRGdW5jID0gZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gLW9yaWdGdW5jKGEsIGIpOyB9O1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS5zbGljZSgpLnNvcnQoc29ydEZ1bmMuYmluZCh0aGlzKSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGFkZFF1ZXJ5XG4gICAqIFRha2VzIHRoZSBpbnB1dCBVUkwgYW5kIGFkZHMgKG9yIHJlcGxhY2VzKSB0aGUgZmllbGQgaW4gdGhlIHF1ZXJ5XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2FkZFF1ZXJ5JywgZnVuY3Rpb24odmFsdWUsIHF1ZXJ5RmllbGQsIHF1ZXJ5VmFsdWUpIHtcbiAgICB2YXIgdXJsID0gdmFsdWUgfHwgbG9jYXRpb24uaHJlZjtcbiAgICB2YXIgcGFydHMgPSB1cmwuc3BsaXQoJz8nKTtcbiAgICB1cmwgPSBwYXJ0c1swXTtcbiAgICB2YXIgcXVlcnkgPSBwYXJ0c1sxXTtcbiAgICB2YXIgYWRkZWRRdWVyeSA9ICcnO1xuICAgIGlmIChxdWVyeVZhbHVlICE9IG51bGwpIHtcbiAgICAgIGFkZGVkUXVlcnkgPSBxdWVyeUZpZWxkICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5VmFsdWUpO1xuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgdmFyIGV4cHIgPSBuZXcgUmVnRXhwKCdcXFxcYicgKyBxdWVyeUZpZWxkICsgJz1bXiZdKicpO1xuICAgICAgaWYgKGV4cHIudGVzdChxdWVyeSkpIHtcbiAgICAgICAgcXVlcnkgPSBxdWVyeS5yZXBsYWNlKGV4cHIsIGFkZGVkUXVlcnkpO1xuICAgICAgfSBlbHNlIGlmIChhZGRlZFF1ZXJ5KSB7XG4gICAgICAgIHF1ZXJ5ICs9ICcmJyArIGFkZGVkUXVlcnk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5ID0gYWRkZWRRdWVyeTtcbiAgICB9XG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB1cmwgKz0gJz8nICsgcXVlcnk7XG4gICAgfVxuICAgIHJldHVybiB1cmw7XG4gIH0pO1xuXG5cbiAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBmdW5jdGlvbiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICBkaXYuaW5uZXJIVE1MID0gdmFsdWU7XG4gICAgICByZXR1cm4gZGl2LnRleHRDb250ZW50O1xuICAgIH0gZWxzZSB7XG4gICAgICBkaXYudGV4dENvbnRlbnQgPSB2YWx1ZSB8fCAnJztcbiAgICAgIHJldHVybiBkaXYuaW5uZXJIVE1MO1xuICAgIH1cbiAgfVxuXG5cbiAgLyoqXG4gICAqICMjIGVzY2FwZVxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudC4gRm9yIHVzZSB3aXRoIG90aGVyIEhUTUwtYWRkaW5nIGZvcm1hdHRlcnMgc3VjaCBhcyBhdXRvbGluay5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBlc2NhcGUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZXNjYXBlJywgZXNjYXBlSFRNTCk7XG5cblxuICAvKipcbiAgICogIyMgcFxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudCB3cmFwcGluZyBwYXJhZ3JhcGhzIGluIDxwPiB0YWdzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IHAgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+PHA+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvcD5cbiAgICogPHA+SXQncyBncmVhdDwvcD48L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3AnLCBmdW5jdGlvbih2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgcmV0dXJuIGVzY2FwZUhUTUwodmFsdWUsIHNldHRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBsaW5lcyA9ICh2YWx1ZSB8fCAnJykuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIHZhciBlc2NhcGVkID0gbGluZXMubWFwKGZ1bmN0aW9uKGxpbmUpIHsgcmV0dXJuIGVzY2FwZUhUTUwobGluZSkgfHwgJzxicj4nOyB9KTtcbiAgICAgIHJldHVybiAnPHA+JyArIGVzY2FwZWQuam9pbignPC9wPlxcbjxwPicpICsgJzwvcD4nO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYnJcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxicj4gdGFncyBpbiBwbGFjZSBvZiBuZXdsaW5lcyBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGJyIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8YnI+XG4gICAqIEl0J3MgZ3JlYXQ8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2JyJywgZnVuY3Rpb24odmFsdWUsIHNldHRlcikge1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIHJldHVybiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbGluZXMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICByZXR1cm4gbGluZXMubWFwKGVzY2FwZUhUTUwpLmpvaW4oJzxicj5cXG4nKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG5ld2xpbmVcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxwPiB0YWdzIGF0IGRvdWJsZSBuZXdsaW5lcyBhbmQgPGJyPiB0YWdzIGluIHBsYWNlIG9mIHNpbmdsZSBuZXdsaW5lIGNoYXJhY3RlcnMuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgbmV3bGluZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbmV3bGluZScsIGZ1bmN0aW9uKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICByZXR1cm4gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHBhcmFncmFwaHMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuXFxzKlxccj9cXG4vKTtcbiAgICAgIHZhciBlc2NhcGVkID0gcGFyYWdyYXBocy5tYXAoZnVuY3Rpb24ocGFyYWdyYXBoKSB7XG4gICAgICAgIHZhciBsaW5lcyA9IHBhcmFncmFwaC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgICByZXR1cm4gbGluZXMubWFwKGVzY2FwZUhUTUwpLmpvaW4oJzxicj5cXG4nKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuICc8cD4nICsgZXNjYXBlZC5qb2luKCc8L3A+XFxuXFxuPHA+JykgKyAnPC9wPic7XG4gICAgfVxuICB9KTtcblxuXG5cbiAgdmFyIHVybEV4cCA9IC8oXnxcXHN8XFwoKSgoPzpodHRwcz98ZnRwKTpcXC9cXC9bXFwtQS1aMC05K1xcdTAwMjZAI1xcLyU/PSgpfl98ITosLjtdKltcXC1BLVowLTkrXFx1MDAyNkAjXFwvJT1+KF98XSkvZ2k7XG4gIHZhciB3d3dFeHAgPSAvKF58W15cXC9dKSh3d3dcXC5bXFxTXStcXC5cXHd7Mix9KFxcYnwkKSkvZ2ltO1xuICAvKipcbiAgICogIyMgYXV0b2xpbmtcbiAgICogQWRkcyBhdXRvbWF0aWMgbGlua3MgdG8gZXNjYXBlZCBjb250ZW50IChiZSBzdXJlIHRvIGVzY2FwZSB1c2VyIGNvbnRlbnQpLiBDYW4gYmUgdXNlZCBvbiBleGlzdGluZyBIVE1MIGNvbnRlbnQgYXMgaXRcbiAgICogd2lsbCBza2lwIFVSTHMgd2l0aGluIEhUTUwgdGFncy4gUGFzc2luZyB0cnVlIGluIHRoZSBzZWNvbmQgcGFyYW1ldGVyIHdpbGwgc2V0IHRoZSB0YXJnZXQgdG8gYF9ibGFua2AuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2F1dG9saW5rJywgZnVuY3Rpb24odmFsdWUsIHRhcmdldCkge1xuICAgIHRhcmdldCA9ICh0YXJnZXQpID8gJyB0YXJnZXQ9XCJfYmxhbmtcIicgOiAnJztcblxuICAgIHJldHVybiAoJycgKyB2YWx1ZSkucmVwbGFjZSgvPFtePl0rPnxbXjxdKy9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgaWYgKG1hdGNoLmNoYXJBdCgwKSA9PT0gJzwnKSB7XG4gICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgIH1cbiAgICAgIHZhciByZXBsYWNlZFRleHQgPSBtYXRjaC5yZXBsYWNlKHVybEV4cCwgJyQxPGEgaHJlZj1cIiQyXCInICsgdGFyZ2V0ICsgJz4kMjwvYT4nKTtcbiAgICAgIHJldHVybiByZXBsYWNlZFRleHQucmVwbGFjZSh3d3dFeHAsICckMTxhIGhyZWY9XCJodHRwOi8vJDJcIicgKyB0YXJnZXQgKyAnPiQyPC9hPicpO1xuICAgIH0pO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdpbnQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhbHVlID0gcGFyc2VJbnQodmFsdWUpO1xuICAgIHJldHVybiBpc05hTih2YWx1ZSkgPyBudWxsIDogdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2Zsb2F0JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YWx1ZSA9IHBhcnNlRmxvYXQodmFsdWUpO1xuICAgIHJldHVybiBpc05hTih2YWx1ZSkgPyBudWxsIDogdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2Jvb2wnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSAmJiB2YWx1ZSAhPT0gJzAnICYmIHZhbHVlICE9PSAnZmFsc2UnO1xuICB9KTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVGVtcGxhdGU7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcblxuXG4vKipcbiAqICMjIFRlbXBsYXRlXG4gKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gKiBJbnN0YW5jZXMgbWF5IHRoZW4gYmUgY3JlYXRlZCBhbmQgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICogQHBhcmFtIHtTdHJpbmd8Tm9kZUxpc3R8SFRNTENvbGxlY3Rpb258SFRNTFRlbXBsYXRlRWxlbWVudHxIVE1MU2NyaXB0RWxlbWVudHxOb2RlfSBodG1sIEEgVGVtcGxhdGUgY2FuIGJlIGNyZWF0ZWRcbiAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gKiBjbG9uZS4gTm9kZXMgYW5kIGVsZW1lbnRzIHBhc3NlZCBpbiB3aWxsIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLlxuICovXG5mdW5jdGlvbiBUZW1wbGF0ZSgpIHtcbiAgdGhpcy5wb29sID0gW107XG59XG5cblxuVGVtcGxhdGUucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IHZpZXcgY2xvbmVkIGZyb20gdGhpcyB0ZW1wbGF0ZS5cbiAgICovXG4gIGNyZWF0ZVZpZXc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLnBvb2wubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gdGhpcy5wb29sLnBvcCgpO1xuICAgIH1cblxuICAgIHJldHVybiBleHRlbmQubWFrZShWaWV3LCBkb2N1bWVudC5pbXBvcnROb2RlKHRoaXMsIHRydWUpLCB0aGlzKTtcbiAgfSxcblxuICByZXR1cm5WaWV3OiBmdW5jdGlvbih2aWV3KSB7XG4gICAgaWYgKHRoaXMucG9vbC5pbmRleE9mKHZpZXcpID09PSAtMSkge1xuICAgICAgdGhpcy5wb29sLnB1c2godmlldyk7XG4gICAgfVxuICB9XG59O1xuIiwiLy8gSGVscGVyIG1ldGhvZHMgZm9yIGFuaW1hdGlvblxuZXhwb3J0cy5tYWtlRWxlbWVudEFuaW1hdGFibGUgPSBtYWtlRWxlbWVudEFuaW1hdGFibGU7XG5leHBvcnRzLmdldENvbXB1dGVkQ1NTID0gZ2V0Q29tcHV0ZWRDU1M7XG5leHBvcnRzLmFuaW1hdGVFbGVtZW50ID0gYW5pbWF0ZUVsZW1lbnQ7XG5cbmZ1bmN0aW9uIG1ha2VFbGVtZW50QW5pbWF0YWJsZShlbGVtZW50KSB7XG4gIC8vIEFkZCBwb2x5ZmlsbCBqdXN0IG9uIHRoaXMgZWxlbWVudFxuICBpZiAoIWVsZW1lbnQuYW5pbWF0ZSkge1xuICAgIGVsZW1lbnQuYW5pbWF0ZSA9IGFuaW1hdGVFbGVtZW50O1xuICB9XG5cbiAgLy8gTm90IGEgcG9seWZpbGwgYnV0IGEgaGVscGVyXG4gIGlmICghZWxlbWVudC5nZXRDb21wdXRlZENTUykge1xuICAgIGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MgPSBnZXRDb21wdXRlZENTUztcbiAgfVxuXG4gIHJldHVybiBlbGVtZW50O1xufVxuXG4vKipcbiAqIEdldCB0aGUgY29tcHV0ZWQgc3R5bGUgb24gYW4gZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0Q29tcHV0ZWRDU1Moc3R5bGVOYW1lKSB7XG4gIGlmICh0aGlzLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcub3BlbmVyKSB7XG4gICAgcmV0dXJuIHRoaXMub3duZXJEb2N1bWVudC5kZWZhdWx0Vmlldy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpW3N0eWxlTmFtZV07XG4gIH1cbiAgcmV0dXJuIHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpW3N0eWxlTmFtZV07XG59XG5cbi8qKlxuICogVmVyeSBiYXNpYyBwb2x5ZmlsbCBmb3IgRWxlbWVudC5hbmltYXRlIGlmIGl0IGRvZXNuJ3QgZXhpc3QuIElmIGl0IGRvZXMsIHVzZSB0aGUgbmF0aXZlLlxuICogVGhpcyBvbmx5IHN1cHBvcnRzIHR3byBjc3Mgc3RhdGVzLiBJdCB3aWxsIG92ZXJ3cml0ZSBleGlzdGluZyBzdHlsZXMuIEl0IGRvZXNuJ3QgcmV0dXJuIGFuIGFuaW1hdGlvbiBwbGF5IGNvbnRyb2wuIEl0XG4gKiBvbmx5IHN1cHBvcnRzIGR1cmF0aW9uLCBkZWxheSwgYW5kIGVhc2luZy4gUmV0dXJucyBhbiBvYmplY3Qgd2l0aCBhIHByb3BlcnR5IG9uZmluaXNoLlxuICovXG5mdW5jdGlvbiBhbmltYXRlRWxlbWVudChjc3MsIG9wdGlvbnMpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGNzcykgfHwgY3NzLmxlbmd0aCAhPT0gMikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2FuaW1hdGUgcG9seWZpbGwgcmVxdWlyZXMgYW4gYXJyYXkgZm9yIGNzcyB3aXRoIGFuIGluaXRpYWwgYW5kIGZpbmFsIHN0YXRlJyk7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMgfHwgIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ2R1cmF0aW9uJykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdhbmltYXRlIHBvbHlmaWxsIHJlcXVpcmVzIG9wdGlvbnMgd2l0aCBhIGR1cmF0aW9uJyk7XG4gIH1cblxuICB2YXIgZWxlbWVudCA9IHRoaXM7XG4gIHZhciBkdXJhdGlvbiA9IG9wdGlvbnMuZHVyYXRpb24gfHwgMDtcbiAgdmFyIGRlbGF5ID0gb3B0aW9ucy5kZWxheSB8fCAwO1xuICB2YXIgZWFzaW5nID0gb3B0aW9ucy5lYXNpbmc7XG4gIHZhciBpbml0aWFsQ3NzID0gY3NzWzBdO1xuICB2YXIgZmluYWxDc3MgPSBjc3NbMV07XG4gIHZhciBhbGxDc3MgPSB7fTtcbiAgdmFyIHBsYXliYWNrID0geyBvbmZpbmlzaDogbnVsbCB9O1xuXG4gIE9iamVjdC5rZXlzKGluaXRpYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGluaXRpYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgLy8gdHJpZ2dlciByZWZsb3dcbiAgZWxlbWVudC5vZmZzZXRXaWR0aDtcblxuICB2YXIgdHJhbnNpdGlvbk9wdGlvbnMgPSAnICcgKyBkdXJhdGlvbiArICdtcyc7XG4gIGlmIChlYXNpbmcpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBlYXNpbmc7XG4gIH1cbiAgaWYgKGRlbGF5KSB7XG4gICAgdHJhbnNpdGlvbk9wdGlvbnMgKz0gJyAnICsgZGVsYXkgKyAnbXMnO1xuICB9XG5cbiAgZWxlbWVudC5zdHlsZS50cmFuc2l0aW9uID0gT2JqZWN0LmtleXMoZmluYWxDc3MpLm1hcChmdW5jdGlvbihrZXkpIHtcbiAgICByZXR1cm4ga2V5ICsgdHJhbnNpdGlvbk9wdGlvbnM7XG4gIH0pLmpvaW4oJywgJyk7XG5cbiAgT2JqZWN0LmtleXMoZmluYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGZpbmFsQ3NzW2tleV07XG4gIH0pO1xuXG4gIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgT2JqZWN0LmtleXMoYWxsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgZWxlbWVudC5zdHlsZVtrZXldID0gJyc7XG4gICAgfSk7XG5cbiAgICBpZiAocGxheWJhY2sub25maW5pc2gpIHtcbiAgICAgIHBsYXliYWNrLm9uZmluaXNoKCk7XG4gICAgfVxuICB9LCBkdXJhdGlvbiArIGRlbGF5KTtcblxuICByZXR1cm4gcGxheWJhY2s7XG59XG4iLCJ2YXIgZ2xvYmFsID0gKGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSkoKTtcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kO1xuZXh0ZW5kLm1ha2UgPSBtYWtlO1xuXG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBwcm90b3R5cGUgZm9yIHRoZSBnaXZlbiBjb250cnVjdG9yIGFuZCBzZXRzIGFuIGBleHRlbmRgIG1ldGhvZCBvbiBpdC4gSWYgYGV4dGVuZGAgaXMgY2FsbGVkIGZyb20gYVxuICogaXQgd2lsbCBleHRlbmQgdGhhdCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZXh0ZW5kKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpIHtcbiAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzID09PSBnbG9iYWwgPyBPYmplY3QgOiB0aGlzO1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nICYmICFwcm90b3R5cGUpIHtcbiAgICBwcm90b3R5cGUgPSBjb25zdHJ1Y3RvcjtcbiAgICBjb25zdHJ1Y3RvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbiAgY29uc3RydWN0b3IuZXh0ZW5kID0gZXh0ZW5kO1xuICB2YXIgZGVzY3JpcHRvcnMgPSBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKTtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckNsYXNzLnByb3RvdHlwZSwgZGVzY3JpcHRvcnMpO1xuICByZXR1cm4gY29uc3RydWN0b3I7XG59XG5cblxuLyoqXG4gKiBNYWtlcyBhIG5hdGl2ZSBvYmplY3QgcHJldGVuZCB0byBiZSBhIGNsYXNzIChlLmcuIGFkZHMgbWV0aG9kcyB0byBhIERvY3VtZW50RnJhZ21lbnQgYW5kIGNhbGxzIHRoZSBjb25zdHJ1Y3RvcikuXG4gKi9cbmZ1bmN0aW9uIG1ha2UoY29uc3RydWN0b3IsIG9iamVjdCkge1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZSBtdXN0IGFjY2VwdCBhIGZ1bmN0aW9uIGNvbnN0cnVjdG9yIGFuZCBhbiBvYmplY3QnKTtcbiAgfVxuICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgdmFyIHByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICBmb3IgKHZhciBrZXkgaW4gcHJvdG8pIHtcbiAgICBvYmplY3Rba2V5XSA9IHByb3RvW2tleV07XG4gIH1cbiAgY29uc3RydWN0b3IuYXBwbHkob2JqZWN0LCBhcmdzKTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuXG5mdW5jdGlvbiBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBkZXNjcmlwdG9ycyA9IHtcbiAgICBjb25zdHJ1Y3RvcjogeyB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogY29uc3RydWN0b3IgfVxuICB9O1xuXG4gIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbmFtZSk7XG4gICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZmFsc2U7XG4gICAgZGVzY3JpcHRvcnNbbmFtZV0gPSBkZXNjcmlwdG9yO1xuICB9KTtcbiAgcmV0dXJuIGRlc2NyaXB0b3JzO1xufVxuIiwiXG5cblxuLy8gUG9seWZpbGwgbWF0Y2hlc1xuaWYgKCFFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzKSB7XG4gIEVsZW1lbnQucHJvdG90eXBlLm1hdGNoZXMgPVxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLndlYmtpdE1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1vek1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1zTWF0Y2hlc1NlbGVjdG9yIHx8XG4gICAgRWxlbWVudC5wcm90b3R5cGUub01hdGNoZXNTZWxlY3Rvcjtcbn1cblxuLy8gUG9seWZpbGwgY2xvc2VzdFxuaWYgKCFFbGVtZW50LnByb3RvdHlwZS5jbG9zZXN0KSB7XG4gIEVsZW1lbnQucHJvdG90eXBlLmNsb3Nlc3QgPSBmdW5jdGlvbiBjbG9zZXN0KHNlbGVjdG9yKSB7XG4gICAgdmFyIGVsZW1lbnQgPSB0aGlzO1xuICAgIGRvIHtcbiAgICAgIGlmIChlbGVtZW50Lm1hdGNoZXMoc2VsZWN0b3IpKSB7XG4gICAgICAgIHJldHVybiBlbGVtZW50O1xuICAgICAgfVxuICAgIH0gd2hpbGUgKChlbGVtZW50ID0gZWxlbWVudC5wYXJlbnROb2RlKSAmJiBlbGVtZW50Lm5vZGVUeXBlID09PSBOb2RlLkVMRU1FTlRfTk9ERSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHRvRnJhZ21lbnQ7XG5cbi8vIENvbnZlcnQgc3R1ZmYgaW50byBkb2N1bWVudCBmcmFnbWVudHMuIFN0dWZmIGNhbiBiZTpcbi8vICogQSBzdHJpbmcgb2YgSFRNTCB0ZXh0XG4vLyAqIEFuIGVsZW1lbnQgb3IgdGV4dCBub2RlXG4vLyAqIEEgTm9kZUxpc3Qgb3IgSFRNTENvbGxlY3Rpb24gKGUuZy4gYGVsZW1lbnQuY2hpbGROb2Rlc2Agb3IgYGVsZW1lbnQuY2hpbGRyZW5gKVxuLy8gKiBBIGpRdWVyeSBvYmplY3Rcbi8vICogQSBzY3JpcHQgZWxlbWVudCB3aXRoIGEgYHR5cGVgIGF0dHJpYnV0ZSBvZiBgXCJ0ZXh0LypcImAgKGUuZy4gYDxzY3JpcHQgdHlwZT1cInRleHQvaHRtbFwiPk15IHRlbXBsYXRlIGNvZGUhPC9zY3JpcHQ+YClcbi8vICogQSB0ZW1wbGF0ZSBlbGVtZW50IChlLmcuIGA8dGVtcGxhdGU+TXkgdGVtcGxhdGUgY29kZSE8L3RlbXBsYXRlPmApXG5mdW5jdGlvbiB0b0ZyYWdtZW50KGh0bWwpIHtcbiAgaWYgKGh0bWwgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIGh0bWw7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGh0bWwgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoaHRtbCBpbnN0YW5jZW9mIE5vZGUpIHtcbiAgICByZXR1cm4gbm9kZVRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoJ2xlbmd0aCcgaW4gaHRtbCkge1xuICAgIHJldHVybiBsaXN0VG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbnN1cHBvcnRlZCBUZW1wbGF0ZSBUeXBlOiBDYW5ub3QgY29udmVydCBgJyArIGh0bWwgKyAnYCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuJyk7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTCBub2RlIGludG8gYSBkb2N1bWVudCBmcmFnbWVudC4gSWYgaXQgaXMgYSA8dGVtcGxhdGU+IG5vZGUgaXRzIGNvbnRlbnRzIHdpbGwgYmUgdXNlZC4gSWYgaXQgaXMgYVxuLy8gPHNjcmlwdD4gbm9kZSBpdHMgc3RyaW5nLWJhc2VkIGNvbnRlbnRzIHdpbGwgYmUgY29udmVydGVkIHRvIEhUTUwgZmlyc3QsIHRoZW4gdXNlZC4gT3RoZXJ3aXNlIGEgY2xvbmUgb2YgdGhlIG5vZGVcbi8vIGl0c2VsZiB3aWxsIGJlIHVzZWQuXG5mdW5jdGlvbiBub2RlVG9GcmFnbWVudChub2RlKSB7XG4gIGlmIChub2RlLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIG5vZGUuY29udGVudDtcbiAgfSBlbHNlIGlmIChub2RlLnRhZ05hbWUgPT09ICdTQ1JJUFQnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQobm9kZS5pbm5lckhUTUwpO1xuICB9IGVsc2Uge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBpZiAobm9kZS50YWdOYW1lID09PSAnVEVNUExBVEUnKSB7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbCA9IG5vZGUuY2hpbGROb2Rlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZS5jaGlsZE5vZGVzW2ldKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgfVxuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxufVxuXG4vLyBDb252ZXJ0cyBhbiBIVE1MQ29sbGVjdGlvbiwgTm9kZUxpc3QsIGpRdWVyeSBvYmplY3QsIG9yIGFycmF5IGludG8gYSBkb2N1bWVudCBmcmFnbWVudC5cbmZ1bmN0aW9uIGxpc3RUb0ZyYWdtZW50KGxpc3QpIHtcbiAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICBmb3IgKHZhciBpID0gMCwgbCA9IGxpc3QubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgLy8gVXNlIHRvRnJhZ21lbnQgc2luY2UgdGhpcyBtYXkgYmUgYW4gYXJyYXkgb2YgdGV4dCwgYSBqUXVlcnkgb2JqZWN0IG9mIGA8dGVtcGxhdGU+YHMsIGV0Yy5cbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh0b0ZyYWdtZW50KGxpc3RbaV0pKTtcbiAgICBpZiAobCA9PT0gbGlzdC5sZW5ndGggKyAxKSB7XG4gICAgICAvLyBhZGp1c3QgZm9yIE5vZGVMaXN0cyB3aGljaCBhcmUgbGl2ZSwgdGhleSBzaHJpbmsgYXMgd2UgcHVsbCBub2RlcyBvdXQgb2YgdGhlIERPTVxuICAgICAgaS0tO1xuICAgICAgbC0tO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZnJhZ21lbnQ7XG59XG5cbi8vIENvbnZlcnRzIGEgc3RyaW5nIG9mIEhUTUwgdGV4dCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG52YXIgc3RyaW5nVG9GcmFnbWVudCA9IGZ1bmN0aW9uKHN0cmluZykge1xuICBpZiAoIXN0cmluZykge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJykpO1xuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxuICB2YXIgdGVtcGxhdGVFbGVtZW50O1xuICB0ZW1wbGF0ZUVsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpO1xuICB0ZW1wbGF0ZUVsZW1lbnQuaW5uZXJIVE1MID0gc3RyaW5nO1xuICByZXR1cm4gdGVtcGxhdGVFbGVtZW50LmNvbnRlbnQ7XG59O1xuXG4vLyBJZiBIVE1MIFRlbXBsYXRlcyBhcmUgbm90IGF2YWlsYWJsZSAoZS5nLiBpbiBJRSkgdGhlbiB1c2UgYW4gb2xkZXIgbWV0aG9kIHRvIHdvcmsgd2l0aCBjZXJ0YWluIGVsZW1lbnRzLlxuaWYgKCFkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gIHN0cmluZ1RvRnJhZ21lbnQgPSAoZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRhZ0V4cCA9IC88KFtcXHc6LV0rKS87XG5cbiAgICAvLyBDb3BpZWQgZnJvbSBqUXVlcnkgKGh0dHBzOi8vZ2l0aHViLmNvbS9qcXVlcnkvanF1ZXJ5L2Jsb2IvbWFzdGVyL0xJQ0VOU0UudHh0KVxuICAgIHZhciB3cmFwTWFwID0ge1xuICAgICAgb3B0aW9uOiBbIDEsICc8c2VsZWN0IG11bHRpcGxlPVwibXVsdGlwbGVcIj4nLCAnPC9zZWxlY3Q+JyBdLFxuICAgICAgbGVnZW5kOiBbIDEsICc8ZmllbGRzZXQ+JywgJzwvZmllbGRzZXQ+JyBdLFxuICAgICAgdGhlYWQ6IFsgMSwgJzx0YWJsZT4nLCAnPC90YWJsZT4nIF0sXG4gICAgICB0cjogWyAyLCAnPHRhYmxlPjx0Ym9keT4nLCAnPC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIHRkOiBbIDMsICc8dGFibGU+PHRib2R5Pjx0cj4nLCAnPC90cj48L3Rib2R5PjwvdGFibGU+JyBdLFxuICAgICAgY29sOiBbIDIsICc8dGFibGU+PHRib2R5PjwvdGJvZHk+PGNvbGdyb3VwPicsICc8L2NvbGdyb3VwPjwvdGFibGU+JyBdLFxuICAgICAgYXJlYTogWyAxLCAnPG1hcD4nLCAnPC9tYXA+JyBdLFxuICAgICAgX2RlZmF1bHQ6IFsgMCwgJycsICcnIF1cbiAgICB9O1xuICAgIHdyYXBNYXAub3B0Z3JvdXAgPSB3cmFwTWFwLm9wdGlvbjtcbiAgICB3cmFwTWFwLnRib2R5ID0gd3JhcE1hcC50Zm9vdCA9IHdyYXBNYXAuY29sZ3JvdXAgPSB3cmFwTWFwLmNhcHRpb24gPSB3cmFwTWFwLnRoZWFkO1xuICAgIHdyYXBNYXAudGggPSB3cmFwTWFwLnRkO1xuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHN0cmluZ1RvRnJhZ21lbnQoc3RyaW5nKSB7XG4gICAgICB2YXIgZnJhZ21lbnQ7XG4gICAgICBpZiAoIXN0cmluZykge1xuICAgICAgICBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpKTtcbiAgICAgICAgcmV0dXJuIGZyYWdtZW50O1xuICAgICAgfVxuICAgICAgdmFyIHRhZyA9IHN0cmluZy5tYXRjaCh0YWdFeHApO1xuICAgICAgdmFyIHBhcnRzID0gd3JhcE1hcFt0YWddIHx8IHdyYXBNYXAuX2RlZmF1bHQ7XG4gICAgICB2YXIgZGVwdGggPSBwYXJ0c1swXTtcbiAgICAgIHZhciBwcmVmaXggPSBwYXJ0c1sxXTtcbiAgICAgIHZhciBwb3N0Zml4ID0gcGFydHNbMl07XG4gICAgICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBkaXYuaW5uZXJIVE1MID0gcHJlZml4ICsgc3RyaW5nICsgcG9zdGZpeDtcbiAgICAgIHdoaWxlIChkZXB0aC0tKSB7XG4gICAgICAgIGRpdiA9IGRpdi5sYXN0Q2hpbGQ7XG4gICAgICB9XG4gICAgICBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChkaXYuZmlyc3RDaGlsZCkge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkaXYuZmlyc3RDaGlsZCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZnJhZ21lbnQ7XG4gICAgfTtcbiAgfSkoKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuXG4vKipcbiAqICMjIFZpZXdcbiAqIEEgRG9jdW1lbnRGcmFnbWVudCB3aXRoIGJpbmRpbmdzLlxuICovXG5mdW5jdGlvbiBWaWV3KHRlbXBsYXRlKSB7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy5iaW5kaW5ncyA9IHRoaXMudGVtcGxhdGUuYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gYmluZGluZy5jbG9uZUZvclZpZXcodGhpcyk7XG4gIH0sIHRoaXMpO1xuICB0aGlzLmZpcnN0Vmlld05vZGUgPSB0aGlzLmZpcnN0Q2hpbGQ7XG4gIHRoaXMubGFzdFZpZXdOb2RlID0gdGhpcy5sYXN0Q2hpbGQ7XG4gIGlmICh0aGlzLmZpcnN0Vmlld05vZGUpIHtcbiAgICB0aGlzLmZpcnN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gICAgdGhpcy5sYXN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gIH1cbn1cblxuXG5WaWV3LnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgZnJvbSB0aGUgRE9NLiBBIHZpZXcgaXMgYSBEb2N1bWVudEZyYWdtZW50LCBzbyBgcmVtb3ZlKClgIHJldHVybnMgYWxsIGl0cyBub2RlcyB0byBpdHNlbGYuXG4gICAqL1xuICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub2RlID0gdGhpcy5maXJzdFZpZXdOb2RlO1xuICAgIHZhciBuZXh0O1xuXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gdGhpcykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCB0aGUgbm9kZXMgYW5kIHB1dCB0aGVtIGJhY2sgaW50byB0aGlzIGZyYWdtZW50XG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBuZXh0ID0gKG5vZGUgPT09IHRoaXMubGFzdFZpZXdOb2RlKSA/IG51bGwgOiBub2RlLm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgdmlldyAoaWYgbm90IGFscmVhZHkgcmVtb3ZlZCkgYW5kIGFkZHMgdGhlIHZpZXcgdG8gaXRzIHRlbXBsYXRlJ3MgcG9vbC5cbiAgICovXG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgdmlldyBpcyByZW1vdmVkIGZyb20gdGhlIERPTVxuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmRpc3Bvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucmV0dXJuVmlldyh0aGlzKTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogQmluZHMgYSB2aWV3IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICovXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5iaW5kKGNvbnRleHQpO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVuYmluZHMgYSB2aWV3IGZyb20gYW55IGNvbnRleHQuXG4gICAqL1xuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLnVuYmluZCgpO1xuICAgIH0pO1xuICB9XG59O1xuIl19
