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
var elementCallbacks = [
  'createdCallback',
  'attachedCallback',
  'detachedCallback',
  'attributeChangedCallback'
];


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
        this.callback.call(this.callbackContext, value, this.oldValue, changed)
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

    Observer.callbacksRunning = true;

    var callbacks = Observer.callbacks;
    Observer.callbacks = [];
    while (callbacks.length) {
      callbacks.shift()();
    }

    for (var i = 0, l = Observer.listeners.length; i < l; i++) {
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

},{}],20:[function(require,module,exports){
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
  }
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
function stringToFragment(string) {
  if (!string) {
    var fragment = document.createDocumentFragment();
    fragment.appendChild(document.createTextNode(''));
    return fragment;
  }
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
      if (!string) {
        var fragment = document.createDocumentFragment();
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
      var fragment = document.createDocumentFragment();
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIuLi9leHByZXNzaW9ucy1qcy9pbmRleC5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9leHByZXNzaW9ucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9mb3JtYXR0ZXJzLmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL3Byb3BlcnR5LWNoYWlucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9zdHJpbmdzLmpzIiwiaW5kZXguanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvY29udGV4dC5qcyIsInNyYy9vYnNlcnZlci9kaWZmLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvcG9seWZpbGxzLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdktBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3bEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6WUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMvUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaE1BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2g4QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDekJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL3NyYy9leHByZXNzaW9ucycpO1xuIiwidmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xudmFyIHN0cmluZ3MgPSByZXF1aXJlKCcuL3N0cmluZ3MnKTtcbnZhciBmb3JtYXR0ZXJQYXJzZXIgPSByZXF1aXJlKCcuL2Zvcm1hdHRlcnMnKTtcbnZhciBwcm9wZXJ0eUNoYWlucyA9IHJlcXVpcmUoJy4vcHJvcGVydHktY2hhaW5zJyk7XG52YXIgdmFsdWVQcm9wZXJ0eSA9ICdfdmFsdWVfJztcbnZhciBjYWNoZSA9IHt9O1xuXG5leHBvcnRzLmdsb2JhbHMgPSB7fTtcblxuXG5leHBvcnRzLnBhcnNlID0gZnVuY3Rpb24oZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShleHRyYUFyZ3MpKSBleHRyYUFyZ3MgPSBbXTtcbiAgdmFyIGNhY2hlS2V5ID0gZXhwciArICd8JyArIGV4dHJhQXJncy5qb2luKCcsJyk7XG4gIC8vIFJldHVybnMgdGhlIGNhY2hlZCBmdW5jdGlvbiBmb3IgdGhpcyBleHByZXNzaW9uIGlmIGl0IGV4aXN0cy5cbiAgdmFyIGZ1bmMgPSBjYWNoZVtjYWNoZUtleV07XG4gIGlmIChmdW5jKSB7XG4gICAgcmV0dXJuIGZ1bmM7XG4gIH1cblxuICB2YXIgb3JpZ2luYWwgPSBleHByO1xuICB2YXIgaXNTZXR0ZXIgPSAoZXh0cmFBcmdzWzBdID09PSB2YWx1ZVByb3BlcnR5KTtcbiAgLy8gQWxsb3cgJyFwcm9wJyB0byBiZWNvbWUgJ3Byb3AgPSAhdmFsdWUnXG4gIGlmIChpc1NldHRlciAmJiBleHByLmNoYXJBdCgwKSA9PT0gJyEnKSB7XG4gICAgZXhwciA9IGV4cHIuc2xpY2UoMSk7XG4gICAgdmFsdWVQcm9wZXJ0eSA9ICchJyArIHZhbHVlUHJvcGVydHk7XG4gIH1cblxuICBleHByID0gc3RyaW5ncy5wdWxsT3V0U3RyaW5ncyhleHByKTtcbiAgZXhwciA9IGZvcm1hdHRlclBhcnNlci5wYXJzZUZvcm1hdHRlcnMoZXhwcik7XG4gIGV4cHIgPSBwcm9wZXJ0eUNoYWlucy5wYXJzZUV4cHJlc3Npb24oZXhwciwgZ2V0VmFyaWFibGVzKGdsb2JhbHMsIGV4dHJhQXJncykpO1xuICBpZiAoIWlzU2V0dGVyKSB7XG4gICAgdmFyIGxpbmVzID0gZXhwci5zcGxpdCgnXFxuJyk7XG4gICAgbGluZXNbbGluZXMubGVuZ3RoIC0gMV0gPSAncmV0dXJuICcgKyBsaW5lc1tsaW5lcy5sZW5ndGggLSAxXTtcbiAgICBleHByID0gbGluZXMuam9pbignXFxuJyk7XG4gIH1cbiAgZXhwciA9IHN0cmluZ3MucHV0SW5TdHJpbmdzKGV4cHIpO1xuICBmdW5jID0gY29tcGlsZUV4cHJlc3Npb24ob3JpZ2luYWwsIGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncyk7XG4gIGZ1bmMuZXhwciA9IGV4cHI7XG4gIGNhY2hlW2NhY2hlS2V5XSA9IGZ1bmM7XG4gIHJldHVybiBmdW5jO1xufTtcblxuXG5leHBvcnRzLnBhcnNlU2V0dGVyID0gZnVuY3Rpb24oZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShleHRyYUFyZ3MpKSBleHRyYUFyZ3MgPSBbXTtcblxuICAvLyBBZGQgX3ZhbHVlXyBhcyB0aGUgZmlyc3QgZXh0cmEgYXJndW1lbnRcbiAgZXh0cmFBcmdzLnVuc2hpZnQodmFsdWVQcm9wZXJ0eSk7XG4gIGV4cHIgPSBleHByLnJlcGxhY2UoLyhcXHMqXFx8fCQpLywgJyA9IF92YWx1ZV8kMScpO1xuXG4gIHJldHVybiBleHBvcnRzLnBhcnNlKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncyk7XG59O1xuXG5cbmZ1bmN0aW9uIGdldFZhcmlhYmxlcyhnbG9iYWxzLCBleHRyYUFyZ3MpIHtcbiAgdmFyIHZhcmlhYmxlcyA9IHt9O1xuXG4gIE9iamVjdC5rZXlzKGV4cG9ydHMuZ2xvYmFscykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICB2YXJpYWJsZXNba2V5XSA9IGV4cG9ydHMuZ2xvYmFsc1trZXldO1xuICB9KTtcblxuICBpZiAoZ2xvYmFscykge1xuICAgIE9iamVjdC5rZXlzKGdsb2JhbHMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICB2YXJpYWJsZXNba2V5XSA9IGdsb2JhbHNba2V5XTtcbiAgICB9KTtcbiAgfVxuXG4gIGV4dHJhQXJncy5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIHZhcmlhYmxlc1trZXldID0gbnVsbDtcbiAgfSk7XG5cbiAgcmV0dXJuIHZhcmlhYmxlcztcbn1cblxuXG5cbmZ1bmN0aW9uIGNvbXBpbGVFeHByZXNzaW9uKG9yaWdpbmFsLCBleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpIHtcbiAgdmFyIGZ1bmMsIGFyZ3MgPSBbJ19nbG9iYWxzXycsICdfZm9ybWF0dGVyc18nXS5jb25jYXQoZXh0cmFBcmdzKS5jb25jYXQoZXhwcik7XG5cbiAgdHJ5IHtcbiAgICBmdW5jID0gRnVuY3Rpb24uYXBwbHkobnVsbCwgYXJncyk7XG4gIH0gY2F0Y2ggKGUpIHtcbiAgICAvLyBUaHJvd3MgYW4gZXJyb3IgaWYgdGhlIGV4cHJlc3Npb24gd2FzIG5vdCB2YWxpZCBKYXZhU2NyaXB0XG4gICAgdGhyb3cgbmV3IEVycm9yKCdCYWQgZXhwcmVzc2lvbjogJyArIG9yaWdpbmFsICsgJ1xcbicgKyAnQ29tcGlsZWQgZXhwcmVzc2lvbjpcXG4nICsgZXhwciArICdcXG4nICsgZS5tZXNzYWdlKTtcbiAgfVxuXG4gIHJldHVybiBiaW5kQXJndW1lbnRzKGZ1bmMsIGdsb2JhbHMsIGZvcm1hdHRlcnMpO1xufVxuXG5cbi8vIGEgY3VzdG9tIFwiYmluZFwiIGZ1bmN0aW9uIHRvIGJpbmQgYXJndW1lbnRzIHRvIGEgZnVuY3Rpb24gd2l0aG91dCBiaW5kaW5nIHRoZSBjb250ZXh0XG5mdW5jdGlvbiBiaW5kQXJndW1lbnRzKGZ1bmMpIHtcbiAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gZnVuYy5hcHBseSh0aGlzLCBhcmdzLmNvbmNhdChzbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgfVxufVxuIiwiXG4vLyBmaW5kcyBwaXBlcyB0aGF0IGFyZSBub3QgT1JzIChpLmUuIGAgfCBgIG5vdCBgIHx8IGApIGZvciBmb3JtYXR0ZXJzXG52YXIgcGlwZVJlZ2V4ID0gL1xcfChcXHwpPy9nO1xuXG4vLyBBIHN0cmluZyB0aGF0IHdvdWxkIG5vdCBhcHBlYXIgaW4gdmFsaWQgSmF2YVNjcmlwdFxudmFyIHBsYWNlaG9sZGVyID0gJ0BAQCc7XG52YXIgcGxhY2Vob2xkZXJSZWdleCA9IG5ldyBSZWdFeHAoJ1xcXFxzKicgKyBwbGFjZWhvbGRlciArICdcXFxccyonKTtcblxuLy8gZGV0ZXJtaW5lcyB3aGV0aGVyIGFuIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgb3IgZ2V0dGVyIChgbmFtZWAgdnMgYG5hbWUgPSAnYm9iJ2ApXG52YXIgc2V0dGVyUmVnZXggPSAvXFxzPVxccy87XG5cbi8vIGZpbmRzIHRoZSBwYXJ0cyBvZiBhIGZvcm1hdHRlciwgbmFtZSBhbmQgYXJncyAoZS5nLiBgZm9vKGJhcilgKVxudmFyIGZvcm1hdHRlclJlZ2V4ID0gL14oW15cXChdKykoPzpcXCgoLiopXFwpKT8kLztcblxuLy8gZmluZHMgYXJndW1lbnQgc2VwYXJhdG9ycyBmb3IgZm9ybWF0dGVycyAoYGFyZzEsIGFyZzJgKVxudmFyIGFyZ1NlcGFyYXRvciA9IC9cXHMqLFxccyovZztcblxuXG4vKipcbiAqIEZpbmRzIHRoZSBmb3JtYXR0ZXJzIHdpdGhpbiBhbiBleHByZXNzaW9uIGFuZCBjb252ZXJ0cyB0aGVtIHRvIHRoZSBjb3JyZWN0IEphdmFTY3JpcHQgZXF1aXZhbGVudC5cbiAqL1xuZXhwb3J0cy5wYXJzZUZvcm1hdHRlcnMgPSBmdW5jdGlvbihleHByKSB7XG4gIC8vIENvbnZlcnRzIGBuYW1lIHwgdXBwZXIgfCBmb28oYmFyKWAgaW50byBgbmFtZSBAQEAgdXBwZXIgQEBAIGZvbyhiYXIpYFxuICBleHByID0gZXhwci5yZXBsYWNlKHBpcGVSZWdleCwgZnVuY3Rpb24obWF0Y2gsIG9ySW5kaWNhdG9yKSB7XG4gICAgaWYgKG9ySW5kaWNhdG9yKSByZXR1cm4gbWF0Y2g7XG4gICAgcmV0dXJuIHBsYWNlaG9sZGVyO1xuICB9KTtcblxuICAvLyBzcGxpdHMgdGhlIHN0cmluZyBieSBcIkBAQFwiLCBwdWxscyBvZiB0aGUgZmlyc3QgYXMgdGhlIGV4cHIsIHRoZSByZW1haW5pbmcgYXJlIGZvcm1hdHRlcnNcbiAgZm9ybWF0dGVycyA9IGV4cHIuc3BsaXQocGxhY2Vob2xkZXJSZWdleCk7XG4gIGV4cHIgPSBmb3JtYXR0ZXJzLnNoaWZ0KCk7XG4gIGlmICghZm9ybWF0dGVycy5sZW5ndGgpIHJldHVybiBleHByO1xuXG4gIC8vIFByb2Nlc3NlcyB0aGUgZm9ybWF0dGVyc1xuICAvLyBJZiB0aGUgZXhwcmVzc2lvbiBpcyBhIHNldHRlciB0aGUgdmFsdWUgd2lsbCBiZSBydW4gdGhyb3VnaCB0aGUgZm9ybWF0dGVyc1xuICB2YXIgc2V0dGVyID0gJyc7XG4gIHZhciB2YWx1ZSA9IGV4cHI7XG5cbiAgaWYgKHNldHRlclJlZ2V4LnRlc3QoZXhwcikpIHtcbiAgICB2YXIgcGFydHMgPSBleHByLnNwbGl0KHNldHRlclJlZ2V4KTtcbiAgICBzZXR0ZXIgPSBwYXJ0c1swXSArICcgPSAnO1xuICAgIHZhbHVlID0gcGFydHNbMV07XG4gIH1cblxuICAvLyBQcm9jZXNzZXMgdGhlIGZvcm1hdHRlcnNcbiAgZm9ybWF0dGVycy5mb3JFYWNoKGZ1bmN0aW9uKGZvcm1hdHRlcikge1xuICAgIHZhciBtYXRjaCA9IGZvcm1hdHRlci50cmltKCkubWF0Y2goZm9ybWF0dGVyUmVnZXgpO1xuXG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdGb3JtYXR0ZXIgaXMgaW52YWxpZDogJyArIGZvcm1hdHRlcik7XG4gICAgfVxuXG4gICAgdmFyIGZvcm1hdHRlck5hbWUgPSBtYXRjaFsxXTtcbiAgICB2YXIgYXJncyA9IG1hdGNoWzJdID8gbWF0Y2hbMl0uc3BsaXQoYXJnU2VwYXJhdG9yKSA6IFtdO1xuXG4gICAgLy8gQWRkIHRoZSBwcmV2aW91cyB2YWx1ZSBhcyB0aGUgZmlyc3QgYXJndW1lbnRcbiAgICBhcmdzLnVuc2hpZnQodmFsdWUpO1xuXG4gICAgLy8gSWYgdGhpcyBpcyBhIHNldHRlciBleHByLCBiZSBzdXJlIHRvIGFkZCB0aGUgYGlzU2V0dGVyYCBmbGFnIGF0IHRoZSBlbmQgb2YgdGhlIGZvcm1hdHRlcidzIGFyZ3VtZW50c1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIGFyZ3MucHVzaCh0cnVlKTtcbiAgICB9XG5cbiAgICAvLyBTZXQgdGhlIHZhbHVlIHRvIGJlY29tZSB0aGUgcmVzdWx0IG9mIHRoaXMgZm9ybWF0dGVyLCBzbyB0aGUgbmV4dCBmb3JtYXR0ZXIgY2FuIHdyYXAgaXQuXG4gICAgLy8gQ2FsbCBmb3JtYXR0ZXJzIGluIHRoZSBjdXJyZW50IGNvbnRleHQuXG4gICAgdmFsdWUgPSAnX2Zvcm1hdHRlcnNfLicgKyBmb3JtYXR0ZXJOYW1lICsgJy5jYWxsKHRoaXMsICcgKyBhcmdzLmpvaW4oJywgJykgKyAnKSc7XG4gIH0pO1xuXG4gIHJldHVybiBzZXR0ZXIgKyB2YWx1ZTtcbn07XG4iLCJ2YXIgcmVmZXJlbmNlQ291bnQgPSAwO1xudmFyIGN1cnJlbnRSZWZlcmVuY2UgPSAwO1xudmFyIGN1cnJlbnRJbmRleCA9IDA7XG52YXIgZmluaXNoZWRDaGFpbiA9IGZhbHNlO1xudmFyIGNvbnRpbnVhdGlvbiA9IGZhbHNlO1xudmFyIGdsb2JhbHMgPSBudWxsO1xudmFyIGRlZmF1bHRHbG9iYWxzID0ge1xuICByZXR1cm46IG51bGwsXG4gIHRydWU6IG51bGwsXG4gIGZhbHNlOiBudWxsLFxuICB1bmRlZmluZWQ6IG51bGwsXG4gIG51bGw6IG51bGwsXG4gIHRoaXM6IG51bGwsXG4gIHdpbmRvdzogbnVsbCxcbiAgTWF0aDogbnVsbCxcbiAgcGFyc2VJbnQ6IG51bGwsXG4gIHBhcnNlRmxvYXQ6IG51bGwsXG4gIGlzTmFOOiBudWxsLFxuICBBcnJheTogbnVsbCxcbiAgdHlwZW9mOiBudWxsLFxuICBfZ2xvYmFsc186IG51bGwsXG4gIF9mb3JtYXR0ZXJzXzogbnVsbCxcbiAgX3ZhbHVlXzogbnVsbCxcbn07XG5cblxuLy8gbWF0Y2hlcyBwcm9wZXJ0eSBjaGFpbnMgKGUuZy4gYG5hbWVgLCBgdXNlci5uYW1lYCwgYW5kIGB1c2VyLmZ1bGxOYW1lKCkuY2FwaXRhbGl6ZSgpYClcbnZhciBwcm9wZXJ0eVJlZ2V4ID0gLygoXFx7fCx8XFwuKT9cXHMqKShbYS16JF9cXCRdKD86W2Etel9cXCQwLTlcXC4tXXxcXFtbJ1wiXFxkXStcXF0pKikoXFxzKig6fFxcKHxcXFspPyl8KFxcWykvZ2k7XG4vKipcbiAqIEJyb2tlbiBkb3duXG4gKlxuICogKChcXHt8LHxcXC4pP1xccyopXG4gKiBwcmVmaXg6IG1hdGNoZXMgb24gb2JqZWN0IGxpdGVyYWxzIHNvIHdlIGNhbiBza2lwIChpbiBgeyBmb286IGJhciB9YCBcImZvb1wiIGlzIG5vdCBhIHByb3BlcnR5KS4gQWxzbyBwaWNrcyB1cCBvblxuICogdW5maW5pc2hlZCBjaGFpbnMgdGhhdCBoYWQgZnVuY3Rpb24gY2FsbHMgb3IgYnJhY2tldHMgd2UgY291bGRuJ3QgZmluaXNoIHN1Y2ggYXMgdGhlIGRvdCBpbiBgLnRlc3RgIGFmdGVyIHRoZSBjaGFpblxuICogYGZvby5iYXIoKS50ZXN0YC5cbiAqXG4gKiAoW2EteiRfXFwkXSg/OlthLXpfXFwkMC05XFwuLV18XFxbWydcIlxcZF0rXFxdKSopXG4gKiBwcm9wZXJ0eSBjaGFpbjogbWF0Y2hlcyBwcm9wZXJ0eSBjaGFpbnMgc3VjaCBhcyB0aGUgZm9sbG93aW5nIChzdHJpbmdzJyBjb250ZW50cyBhcmUgcmVtb3ZlZCBhdCB0aGlzIHN0ZXApXG4gKiAgIGBmb28sIGZvby5iYXIsIGZvby5iYXJbMF0sIGZvby5iYXJbMF0udGVzdCwgZm9vLmJhclsnJ10udGVzdGBcbiAqICAgRG9lcyBub3QgbWF0Y2ggdGhyb3VnaCBmdW5jdGlvbnMgY2FsbHMgb3IgdGhyb3VnaCBicmFja2V0cyB3aGljaCBjb250YWluIHZhcmlhYmxlcy5cbiAqICAgYGZvby5iYXIoKS50ZXN0LCBmb28uYmFyW3Byb3BdLnRlc3RgXG4gKiAgIEluIHRoZXNlIGNhc2VzIGl0IHdvdWxkIG9ubHkgbWF0Y2ggYGZvby5iYXJgLCBgLnRlc3RgLCBhbmQgYHByb3BgXG4gKlxuICogKFxccyooOnxcXCh8XFxbKT8pXG4gKiBwb3N0Zml4OiBtYXRjaGVzIHRyYWlsaW5nIGNoYXJhY3RlcnMgdG8gZGV0ZXJtaW5lIGlmIHRoaXMgaXMgYW4gb2JqZWN0IHByb3BlcnR5IG9yIGEgZnVuY3Rpb24gY2FsbCBldGMuIFdpbGwgbWF0Y2hcbiAqIHRoZSBjb2xvbiBhZnRlciBcImZvb1wiIGluIGB7IGZvbzogJ2JhcicgfWAsIHRoZSBmaXJzdCBwYXJlbnRoZXNpcyBpbiBgb2JqLmZvbyhiYXIpYCwgdGhlIHRoZSBmaXJzdCBicmFja2V0IGluXG4gKiBgZm9vW2Jhcl1gLlxuICovXG5cbi8vIGxpbmtzIGluIGEgcHJvcGVydHkgY2hhaW5cbnZhciBjaGFpbkxpbmtzUmVnZXggPSAvXFwufFxcWy9nO1xuXG4vLyB0aGUgcHJvcGVydHkgbmFtZSBwYXJ0IG9mIGxpbmtzXG52YXIgY2hhaW5MaW5rUmVnZXggPSAvXFwufFxcW3xcXCgvO1xuXG52YXIgYW5kUmVnZXggPSAvIGFuZCAvZztcbnZhciBvclJlZ2V4ID0gLyBvciAvZztcblxuXG5leHBvcnRzLnBhcnNlRXhwcmVzc2lvbiA9IGZ1bmN0aW9uKGV4cHIsIF9nbG9iYWxzKSB7XG4gIC8vIFJlc2V0IGFsbCB2YWx1ZXNcbiAgcmVmZXJlbmNlQ291bnQgPSAwO1xuICBjdXJyZW50UmVmZXJlbmNlID0gMDtcbiAgY3VycmVudEluZGV4ID0gMDtcbiAgZmluaXNoZWRDaGFpbiA9IGZhbHNlO1xuICBjb250aW51YXRpb24gPSBmYWxzZTtcbiAgZ2xvYmFscyA9IF9nbG9iYWxzO1xuXG4gIGV4cHIgPSByZXBsYWNlQW5kc0FuZE9ycyhleHByKTtcbiAgaWYgKGV4cHIuaW5kZXhPZignID0gJykgIT09IC0xKSB7XG4gICAgdmFyIHBhcnRzID0gZXhwci5zcGxpdCgnID0gJyk7XG4gICAgdmFyIHNldHRlciA9IHBhcnRzWzBdO1xuICAgIHZhciB2YWx1ZSA9IHBhcnRzWzFdO1xuICAgIHNldHRlciA9IHBhcnNlUHJvcGVydHlDaGFpbnMoc2V0dGVyKS5yZXBsYWNlKC9eXFwofFxcKSQvZywgJycpO1xuICAgIHZhbHVlID0gcGFyc2VQcm9wZXJ0eUNoYWlucyh2YWx1ZSk7XG4gICAgZXhwciA9IHNldHRlciArICcgPSAnICsgdmFsdWU7XG4gIH0gZWxzZSB7XG4gICAgZXhwciA9IHBhcnNlUHJvcGVydHlDaGFpbnMoZXhwcik7XG4gIH1cbiAgZXhwciA9IGFkZFJlZmVyZW5jZXMoZXhwcilcblxuICAvLyBSZXNldCBhZnRlciBwYXJzZSBpcyBkb25lXG4gIGdsb2JhbHMgPSBudWxsO1xuXG4gIHJldHVybiBleHByO1xufTtcblxuXG4vKipcbiAqIEZpbmRzIGFuZCBwYXJzZXMgdGhlIHByb3BlcnR5IGNoYWlucyBpbiBhbiBleHByZXNzaW9uLlxuICovXG5mdW5jdGlvbiBwYXJzZVByb3BlcnR5Q2hhaW5zKGV4cHIpIHtcbiAgdmFyIHBhcnNlZEV4cHIgPSAnJywgY2hhaW47XG5cbiAgLy8gYWxsb3cgcmVjdXJzaW9uIChlLmcuIGludG8gZnVuY3Rpb24gYXJncykgYnkgcmVzZXR0aW5nIHByb3BlcnR5UmVnZXhcbiAgLy8gVGhpcyBpcyBtb3JlIGVmZmljaWVudCB0aGFuIGNyZWF0aW5nIGEgbmV3IHJlZ2V4IGZvciBlYWNoIGNoYWluLCBJIGFzc3VtZVxuICB2YXIgcHJldkN1cnJlbnRJbmRleCA9IGN1cnJlbnRJbmRleDtcbiAgdmFyIHByZXZMYXN0SW5kZXggPSBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleDtcblxuICBjdXJyZW50SW5kZXggPSAwO1xuICBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCA9IDA7XG4gIHdoaWxlICgoY2hhaW4gPSBuZXh0Q2hhaW4oZXhwcikpICE9PSBmYWxzZSkge1xuICAgIHBhcnNlZEV4cHIgKz0gY2hhaW47XG4gIH1cblxuICAvLyBSZXNldCBpbmRleGVzXG4gIGN1cnJlbnRJbmRleCA9IHByZXZDdXJyZW50SW5kZXg7XG4gIHByb3BlcnR5UmVnZXgubGFzdEluZGV4ID0gcHJldkxhc3RJbmRleDtcbiAgcmV0dXJuIHBhcnNlZEV4cHI7XG59O1xuXG5cbmZ1bmN0aW9uIG5leHRDaGFpbihleHByKSB7XG4gIGlmIChmaW5pc2hlZENoYWluKSB7XG4gICAgcmV0dXJuIChmaW5pc2hlZENoYWluID0gZmFsc2UpO1xuICB9XG4gIHZhciBtYXRjaCA9IHByb3BlcnR5UmVnZXguZXhlYyhleHByKTtcbiAgaWYgKCFtYXRjaCkge1xuICAgIGZpbmlzaGVkQ2hhaW4gPSB0cnVlIC8vIG1ha2Ugc3VyZSBuZXh0IGNhbGwgd2UgcmV0dXJuIGZhbHNlXG4gICAgcmV0dXJuIGV4cHIuc2xpY2UoY3VycmVudEluZGV4KTtcbiAgfVxuXG4gIC8vIGBwcmVmaXhgIGlzIGBvYmpJbmRpY2F0b3JgIHdpdGggdGhlIHdoaXRlc3BhY2UgdGhhdCBtYXkgY29tZSBhZnRlciBpdC5cbiAgdmFyIHByZWZpeCA9IG1hdGNoWzFdO1xuXG4gIC8vIGBvYmpJbmRpY2F0b3JgIGlzIGB7YCBvciBgLGAgYW5kIGxldCdzIHVzIGtub3cgdGhpcyBpcyBhbiBvYmplY3QgcHJvcGVydHlcbiAgLy8gbmFtZSAoZS5nLiBwcm9wIGluIGB7cHJvcDpmYWxzZX1gKS5cbiAgdmFyIG9iakluZGljYXRvciA9IG1hdGNoWzJdO1xuXG4gIC8vIGBwcm9wQ2hhaW5gIGlzIHRoZSBjaGFpbiBvZiBwcm9wZXJ0aWVzIG1hdGNoZWQgKGUuZy4gYHRoaXMudXNlci5lbWFpbGApLlxuICB2YXIgcHJvcENoYWluID0gbWF0Y2hbM107XG5cbiAgLy8gYHBvc3RmaXhgIGlzIHRoZSBgY29sb25PclBhcmVuYCB3aXRoIHdoaXRlc3BhY2UgYmVmb3JlIGl0LlxuICB2YXIgcG9zdGZpeCA9IG1hdGNoWzRdO1xuXG4gIC8vIGBjb2xvbk9yUGFyZW5gIG1hdGNoZXMgdGhlIGNvbG9uICg6KSBhZnRlciB0aGUgcHJvcGVydHkgKGlmIGl0IGlzIGFuIG9iamVjdClcbiAgLy8gb3IgcGFyZW50aGVzaXMgaWYgaXQgaXMgYSBmdW5jdGlvbi4gV2UgdXNlIGBjb2xvbk9yUGFyZW5gIGFuZCBgb2JqSW5kaWNhdG9yYFxuICAvLyB0byBrbm93IGlmIGl0IGlzIGFuIG9iamVjdC5cbiAgdmFyIGNvbG9uT3JQYXJlbiA9IG1hdGNoWzVdO1xuXG4gIG1hdGNoID0gbWF0Y2hbMF07XG5cbiAgdmFyIHNraXBwZWQgPSBleHByLnNsaWNlKGN1cnJlbnRJbmRleCwgcHJvcGVydHlSZWdleC5sYXN0SW5kZXggLSBtYXRjaC5sZW5ndGgpO1xuICBjdXJyZW50SW5kZXggPSBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleDtcblxuICAvLyBza2lwcyBvYmplY3Qga2V5cyBlLmcuIHRlc3QgaW4gYHt0ZXN0OnRydWV9YC5cbiAgaWYgKG9iakluZGljYXRvciAmJiBjb2xvbk9yUGFyZW4gPT09ICc6Jykge1xuICAgIHJldHVybiBza2lwcGVkICsgbWF0Y2g7XG4gIH1cblxuICByZXR1cm4gc2tpcHBlZCArIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIGNvbG9uT3JQYXJlbiwgZXhwcik7XG59XG5cblxuZnVuY3Rpb24gcGFyc2VDaGFpbihwcmVmaXgsIHByb3BDaGFpbiwgcG9zdGZpeCwgcGFyZW4sIGV4cHIpIHtcbiAgLy8gY29udGludWF0aW9ucyBhZnRlciBhIGZ1bmN0aW9uIChlLmcuIGBnZXRVc2VyKDEyKS5maXJzdE5hbWVgKS5cbiAgY29udGludWF0aW9uID0gcHJlZml4ID09PSAnLic7XG4gIGlmIChjb250aW51YXRpb24pIHtcbiAgICBwcm9wQ2hhaW4gPSAnLicgKyBwcm9wQ2hhaW47XG4gICAgcHJlZml4ID0gJyc7XG4gIH1cblxuICB2YXIgbGlua3MgPSBzcGxpdExpbmtzKHByb3BDaGFpbik7XG4gIHZhciBuZXdDaGFpbiA9ICcnO1xuXG4gIGlmIChsaW5rcy5sZW5ndGggPT09IDEgJiYgIWNvbnRpbnVhdGlvbiAmJiAhcGFyZW4pIHtcbiAgICBsaW5rID0gbGlua3NbMF07XG4gICAgbmV3Q2hhaW4gPSBhZGRUaGlzT3JHbG9iYWwobGluayk7XG4gIH0gZWxzZSB7XG4gICAgaWYgKCFjb250aW51YXRpb24pIHtcbiAgICAgIG5ld0NoYWluID0gJygnO1xuICAgIH1cblxuICAgIGxpbmtzLmZvckVhY2goZnVuY3Rpb24obGluaywgaW5kZXgpIHtcbiAgICAgIGlmIChpbmRleCAhPT0gbGlua3MubGVuZ3RoIC0gMSkge1xuICAgICAgICBuZXdDaGFpbiArPSBwYXJzZVBhcnQobGluaywgaW5kZXgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKCFwYXJlbnNbcGFyZW5dKSB7XG4gICAgICAgICAgbmV3Q2hhaW4gKz0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIGxpbms7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKGNvbnRpbnVhdGlvbiAmJiBpbmRleCA9PT0gMCkge1xuICAgICAgICAgICAgaW5kZXgrKztcbiAgICAgICAgICB9XG4gICAgICAgICAgcG9zdGZpeCA9IHBvc3RmaXgucmVwbGFjZShwYXJlbiwgJycpO1xuICAgICAgICAgIG5ld0NoYWluICs9IHBhcmVuID09PSAnKCcgPyBwYXJzZUZ1bmN0aW9uKGxpbmssIGluZGV4LCBleHByKSA6IHBhcnNlQnJhY2tldHMobGluaywgaW5kZXgsIGV4cHIpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBpZiAoZXhwci5jaGFyQXQocHJvcGVydHlSZWdleC5sYXN0SW5kZXgpICE9PSAnLicpIHtcbiAgICAgIG5ld0NoYWluICs9ICcpJztcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcHJlZml4ICsgbmV3Q2hhaW4gKyBwb3N0Zml4O1xufVxuXG5cbmZ1bmN0aW9uIHNwbGl0TGlua3MoY2hhaW4pIHtcbiAgdmFyIGluZGV4ID0gMDtcbiAgdmFyIHBhcnRzID0gW107XG4gIHZhciBtYXRjaDtcbiAgd2hpbGUgKG1hdGNoID0gY2hhaW5MaW5rc1JlZ2V4LmV4ZWMoY2hhaW4pKSB7XG4gICAgaWYgKGNoYWluTGlua3NSZWdleC5sYXN0SW5kZXggPT09IDEpIGNvbnRpbnVlO1xuICAgIHBhcnRzLnB1c2goY2hhaW4uc2xpY2UoaW5kZXgsIGNoYWluTGlua3NSZWdleC5sYXN0SW5kZXggLSAxKSk7XG4gICAgaW5kZXggPSBjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4IC0gMTtcbiAgfVxuICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4KSk7XG4gIHJldHVybiBwYXJ0cztcbn1cblxuXG5mdW5jdGlvbiBhZGRUaGlzT3JHbG9iYWwoY2hhaW4pIHtcbiAgdmFyIHByb3AgPSBjaGFpbi5zcGxpdChjaGFpbkxpbmtSZWdleCkuc2hpZnQoKTtcbiAgaWYgKGdsb2JhbHMuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICByZXR1cm4gZ2xvYmFsc1twcm9wXSA9PT0gbnVsbCA/IGNoYWluIDogJ19nbG9iYWxzXy4nICsgY2hhaW47XG4gIH0gZWxzZSBpZiAoZGVmYXVsdEdsb2JhbHMuaGFzT3duUHJvcGVydHkocHJvcCkpIHtcbiAgICByZXR1cm4gY2hhaW47XG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuICd0aGlzLicgKyBjaGFpbjtcbiAgfVxufVxuXG5cbnZhciBwYXJlbnMgPSB7XG4gICcoJzogJyknLFxuICAnWyc6ICddJ1xufTtcblxuLy8gSGFuZGxlcyBhIGZ1bmN0aW9uIHRvIGJlIGNhbGxlZCBpbiBpdHMgY29ycmVjdCBzY29wZVxuLy8gRmluZHMgdGhlIGVuZCBvZiB0aGUgZnVuY3Rpb24gYW5kIHByb2Nlc3NlcyB0aGUgYXJndW1lbnRzXG5mdW5jdGlvbiBwYXJzZUZ1bmN0aW9uKGxpbmssIGluZGV4LCBleHByKSB7XG4gIHZhciBjYWxsID0gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpO1xuXG4gIC8vIEFsd2F5cyBjYWxsIGZ1bmN0aW9ucyBpbiB0aGUgc2NvcGUgb2YgdGhlIG9iamVjdCB0aGV5J3JlIGEgbWVtYmVyIG9mXG4gIGlmIChpbmRleCA9PT0gMCkge1xuICAgIGxpbmsgPSBhZGRUaGlzT3JHbG9iYWwobGluayk7XG4gIH0gZWxzZSB7XG4gICAgbGluayA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICB9XG5cbiAgdmFyIGNhbGxlZExpbmsgPSBsaW5rICsgJyh+fmluc2lkZVBhcmVuc35+KSc7XG4gIGlmIChleHByLmNoYXJBdChwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCkgPT09ICcuJykge1xuICAgIGNhbGxlZExpbmsgPSBwYXJzZVBhcnQoY2FsbGVkTGluaywgaW5kZXgpXG4gIH1cblxuICBsaW5rID0gJ3R5cGVvZiAnICsgbGluayArICcgIT09IFxcJ2Z1bmN0aW9uXFwnID8gdm9pZCAwIDogJyArIGNhbGxlZExpbms7XG4gIHZhciBpbnNpZGVQYXJlbnMgPSBjYWxsLnNsaWNlKDEsIC0xKTtcblxuICB2YXIgcmVmID0gY3VycmVudFJlZmVyZW5jZTtcbiAgbGluayA9IGxpbmsucmVwbGFjZSgnfn5pbnNpZGVQYXJlbnN+ficsIHBhcnNlUHJvcGVydHlDaGFpbnMoaW5zaWRlUGFyZW5zKSk7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSByZWY7XG4gIHJldHVybiBsaW5rO1xufVxuXG4vLyBIYW5kbGVzIGEgYnJhY2tldGVkIGV4cHJlc3Npb24gdG8gYmUgcGFyc2VkXG5mdW5jdGlvbiBwYXJzZUJyYWNrZXRzKGxpbmssIGluZGV4LCBleHByKSB7XG4gIHZhciBjYWxsID0gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpO1xuICB2YXIgaW5zaWRlQnJhY2tldHMgPSBjYWxsLnNsaWNlKDEsIC0xKTtcbiAgdmFyIGV2YWxlZExpbmsgPSBwYXJzZVBhcnQobGluaywgaW5kZXgpO1xuICBpbmRleCArPSAxO1xuICBsaW5rID0gJ1t+fmluc2lkZUJyYWNrZXRzfn5dJztcblxuICBpZiAoZXhwci5jaGFyQXQocHJvcGVydHlSZWdleC5sYXN0SW5kZXgpID09PSAnLicpIHtcbiAgICBsaW5rID0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgfSBlbHNlIHtcbiAgICBsaW5rID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZSArIGxpbms7XG4gIH1cblxuICBsaW5rID0gZXZhbGVkTGluayArIGxpbms7XG5cbiAgdmFyIHJlZiA9IGN1cnJlbnRSZWZlcmVuY2U7XG4gIGxpbmsgPSBsaW5rLnJlcGxhY2UoJ35+aW5zaWRlQnJhY2tldHN+ficsIHBhcnNlUHJvcGVydHlDaGFpbnMoaW5zaWRlQnJhY2tldHMpKTtcbiAgY3VycmVudFJlZmVyZW5jZSA9IHJlZjtcbiAgcmV0dXJuIGxpbms7XG59XG5cblxuLy8gcmV0dXJucyB0aGUgY2FsbCBwYXJ0IG9mIGEgZnVuY3Rpb24gKGUuZy4gYHRlc3QoMTIzKWAgd291bGQgcmV0dXJuIGAoMTIzKWApXG5mdW5jdGlvbiBnZXRGdW5jdGlvbkNhbGwoZXhwcikge1xuICB2YXIgc3RhcnRJbmRleCA9IHByb3BlcnR5UmVnZXgubGFzdEluZGV4O1xuICB2YXIgb3BlbiA9IGV4cHIuY2hhckF0KHN0YXJ0SW5kZXggLSAxKTtcbiAgdmFyIGNsb3NlID0gcGFyZW5zW29wZW5dO1xuICB2YXIgZW5kSW5kZXggPSBzdGFydEluZGV4IC0gMTtcbiAgdmFyIHBhcmVuQ291bnQgPSAxO1xuICB3aGlsZSAoZW5kSW5kZXgrKyA8IGV4cHIubGVuZ3RoKSB7XG4gICAgdmFyIGNoID0gZXhwci5jaGFyQXQoZW5kSW5kZXgpO1xuICAgIGlmIChjaCA9PT0gb3BlbikgcGFyZW5Db3VudCsrO1xuICAgIGVsc2UgaWYgKGNoID09PSBjbG9zZSkgcGFyZW5Db3VudC0tO1xuICAgIGlmIChwYXJlbkNvdW50ID09PSAwKSBicmVhaztcbiAgfVxuICBjdXJyZW50SW5kZXggPSBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCA9IGVuZEluZGV4ICsgMTtcbiAgcmV0dXJuIG9wZW4gKyBleHByLnNsaWNlKHN0YXJ0SW5kZXgsIGVuZEluZGV4KSArIGNsb3NlO1xufVxuXG5cblxuZnVuY3Rpb24gcGFyc2VQYXJ0KHBhcnQsIGluZGV4KSB7XG4gIC8vIGlmIHRoZSBmaXJzdFxuICBpZiAoaW5kZXggPT09IDAgJiYgIWNvbnRpbnVhdGlvbikge1xuICAgIHBhcnQgPSBhZGRUaGlzT3JHbG9iYWwocGFydCk7XG4gIH0gZWxzZSB7XG4gICAgcGFydCA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBwYXJ0O1xuICB9XG5cbiAgY3VycmVudFJlZmVyZW5jZSA9ICsrcmVmZXJlbmNlQ291bnQ7XG4gIHZhciByZWYgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlO1xuICByZXR1cm4gJygnICsgcmVmICsgJyA9ICcgKyBwYXJ0ICsgJykgPT0gbnVsbCA/IHZvaWQgMCA6ICc7XG59XG5cblxuZnVuY3Rpb24gcmVwbGFjZUFuZHNBbmRPcnMoZXhwcikge1xuICByZXR1cm4gZXhwci5yZXBsYWNlKGFuZFJlZ2V4LCAnICYmICcpLnJlcGxhY2Uob3JSZWdleCwgJyB8fCAnKTtcbn1cblxuXG4vLyBQcmVwZW5kcyByZWZlcmVuY2UgdmFyaWFibGUgZGVmaW5pdGlvbnNcbmZ1bmN0aW9uIGFkZFJlZmVyZW5jZXMoZXhwcikge1xuICBpZiAocmVmZXJlbmNlQ291bnQpIHtcbiAgICB2YXIgcmVmcyA9IFtdO1xuICAgIGZvciAodmFyIGkgPSAxOyBpIDw9IHJlZmVyZW5jZUNvdW50OyBpKyspIHtcbiAgICAgIHJlZnMucHVzaCgnX3JlZicgKyBpKTtcbiAgICB9XG4gICAgZXhwciA9ICd2YXIgJyArIHJlZnMuam9pbignLCAnKSArICc7XFxuJyArIGV4cHI7XG4gIH1cbiAgcmV0dXJuIGV4cHI7XG59XG4iLCIvLyBmaW5kcyBhbGwgcXVvdGVkIHN0cmluZ3NcbnZhciBxdW90ZVJlZ2V4ID0gLyhbJ1wiXFwvXSkoXFxcXFxcMXxbXlxcMV0pKj9cXDEvZztcblxuLy8gZmluZHMgYWxsIGVtcHR5IHF1b3RlZCBzdHJpbmdzXG52YXIgZW1wdHlRdW90ZUV4cHIgPSAvKFsnXCJcXC9dKVxcMS9nO1xuXG52YXIgc3RyaW5ncyA9IG51bGw7XG5cblxuLyoqXG4gKiBSZW1vdmUgc3RyaW5ncyBmcm9tIGFuIGV4cHJlc3Npb24gZm9yIGVhc2llciBwYXJzaW5nLiBSZXR1cm5zIGEgbGlzdCBvZiB0aGUgc3RyaW5ncyB0byBhZGQgYmFjayBpbiBsYXRlci5cbiAqIFRoaXMgbWV0aG9kIGFjdHVhbGx5IGxlYXZlcyB0aGUgc3RyaW5nIHF1b3RlIG1hcmtzIGJ1dCBlbXB0aWVzIHRoZW0gb2YgdGhlaXIgY29udGVudHMuIFRoZW4gd2hlbiByZXBsYWNpbmcgdGhlbSBhZnRlclxuICogcGFyc2luZyB0aGUgY29udGVudHMganVzdCBnZXQgcHV0IGJhY2sgaW50byB0aGVpciBxdW90ZXMgbWFya3MuXG4gKi9cbmV4cG9ydHMucHVsbE91dFN0cmluZ3MgPSBmdW5jdGlvbihleHByKSB7XG4gIGlmIChzdHJpbmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdXRJblN0cmluZ3MgbXVzdCBiZSBjYWxsZWQgYWZ0ZXIgcHVsbE91dFN0cmluZ3MuJyk7XG4gIH1cblxuICBzdHJpbmdzID0gW107XG5cbiAgcmV0dXJuIGV4cHIucmVwbGFjZShxdW90ZVJlZ2V4LCBmdW5jdGlvbihzdHIsIHF1b3RlKSB7XG4gICAgc3RyaW5ncy5wdXNoKHN0cik7XG4gICAgcmV0dXJuIHF1b3RlICsgcXVvdGU7IC8vIHBsYWNlaG9sZGVyIGZvciB0aGUgc3RyaW5nXG4gIH0pO1xufTtcblxuXG4vKipcbiAqIFJlcGxhY2UgdGhlIHN0cmluZ3MgcHJldmlvdXNseSBwdWxsZWQgb3V0IGFmdGVyIHBhcnNpbmcgaXMgZmluaXNoZWQuXG4gKi9cbmV4cG9ydHMucHV0SW5TdHJpbmdzID0gZnVuY3Rpb24oZXhwcikge1xuICBpZiAoIXN0cmluZ3MpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3B1bGxPdXRTdHJpbmdzIG11c3QgYmUgY2FsbGVkIGJlZm9yZSBwdXRJblN0cmluZ3MuJyk7XG4gIH1cblxuICBleHByID0gZXhwci5yZXBsYWNlKGVtcHR5UXVvdGVFeHByLCBmdW5jdGlvbigpIHtcbiAgICByZXR1cm4gc3RyaW5ncy5zaGlmdCgpO1xuICB9KTtcblxuICBzdHJpbmdzID0gbnVsbDtcblxuICByZXR1cm4gZXhwcjtcbn07XG4iLCJ2YXIgRnJhZ21lbnRzID0gcmVxdWlyZSgnLi9zcmMvZnJhZ21lbnRzJyk7XG52YXIgT2JzZXJ2ZXIgPSByZXF1aXJlKCcuL3NyYy9vYnNlcnZlcicpO1xuXG5mdW5jdGlvbiBjcmVhdGUoKSB7XG4gIHZhciBmcmFnbWVudHMgPSBuZXcgRnJhZ21lbnRzKE9ic2VydmVyKTtcbiAgZnJhZ21lbnRzLmV4cHJlc3Npb25zID0gT2JzZXJ2ZXIuZXhwcmVzc2lvbnM7XG4gIGZyYWdtZW50cy5zeW5jID0gT2JzZXJ2ZXIuc3luYztcbiAgZnJhZ21lbnRzLnN5bmNOb3cgPSBPYnNlcnZlci5zeW5jTm93O1xuICBmcmFnbWVudHMuY29udGV4dCA9IE9ic2VydmVyLmNvbnRleHQ7XG4gIHJldHVybiBmcmFnbWVudHM7XG59XG5cbi8vIENyZWF0ZSBhbiBpbnN0YW5jZSBvZiBmcmFnbWVudHMgd2l0aCB0aGUgZGVmYXVsdCBvYnNlcnZlclxubW9kdWxlLmV4cG9ydHMgPSBjcmVhdGUoKTtcbm1vZHVsZS5leHBvcnRzLmNyZWF0ZSA9IGNyZWF0ZTtcbiIsIm1vZHVsZS5leHBvcnRzID0gQW5pbWF0ZWRCaW5kaW5nO1xudmFyIGFuaW1hdGlvbiA9IHJlcXVpcmUoJy4vdXRpbC9hbmltYXRpb24nKTtcbnZhciBCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyk7XG52YXIgX3N1cGVyID0gQmluZGluZy5wcm90b3R5cGU7XG5cbi8qKlxuICogQmluZGluZ3Mgd2hpY2ggZXh0ZW5kIEFuaW1hdGVkQmluZGluZyBoYXZlIHRoZSBhYmlsaXR5IHRvIGFuaW1hdGUgZWxlbWVudHMgdGhhdCBhcmUgYWRkZWQgdG8gdGhlIERPTSBhbmQgcmVtb3ZlZCBmcm9tXG4gKiB0aGUgRE9NLiBUaGlzIGFsbG93cyBtZW51cyB0byBzbGlkZSBvcGVuIGFuZCBjbG9zZWQsIGVsZW1lbnRzIHRvIGZhZGUgaW4gb3IgZHJvcCBkb3duLCBhbmQgcmVwZWF0ZWQgaXRlbXMgdG8gYXBwZWFyXG4gKiB0byBtb3ZlIChpZiB5b3UgZ2V0IGNyZWF0aXZlIGVub3VnaCkuXG4gKlxuICogVGhlIGZvbGxvd2luZyA1IG1ldGhvZHMgYXJlIGhlbHBlciBET00gbWV0aG9kcyB0aGF0IGFsbG93IHJlZ2lzdGVyZWQgYmluZGluZ3MgdG8gd29yayB3aXRoIENTUyB0cmFuc2l0aW9ucyBmb3JcbiAqIGFuaW1hdGluZyBlbGVtZW50cy4gSWYgYW4gZWxlbWVudCBoYXMgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgb3IgYSBtYXRjaGluZyBKYXZhU2NyaXB0IG1ldGhvZCwgdGhlc2UgaGVscGVyIG1ldGhvZHNcbiAqIHdpbGwgc2V0IGEgY2xhc3Mgb24gdGhlIG5vZGUgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uIGFuZC9vciBjYWxsIHRoZSBKYXZhU2NyaXB0IG1ldGhvZHMgdG8gaGFuZGxlIGl0LlxuICpcbiAqIEFuIGFuaW1hdGlvbiBtYXkgYmUgZWl0aGVyIGEgQ1NTIHRyYW5zaXRpb24sIGEgQ1NTIGFuaW1hdGlvbiwgb3IgYSBzZXQgb2YgSmF2YVNjcmlwdCBtZXRob2RzIHRoYXQgd2lsbCBiZSBjYWxsZWQuXG4gKlxuICogSWYgdXNpbmcgQ1NTLCBjbGFzc2VzIGFyZSBhZGRlZCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBlbGVtZW50LiBXaGVuIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaXQgd2lsbCByZWNlaXZlIHRoZSBgd2lsbC1cbiAqIGFuaW1hdGUtaW5gIGNsYXNzIGJlZm9yZSBiZWluZyBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYGFuaW1hdGUtaW5gIGNsYXNzIGltbWVkaWF0ZWx5IGFmdGVyIGJlaW5nXG4gKiBhZGRlZCB0byB0aGUgRE9NLCB0aGVuIGJvdGggY2xhc2VzIHdpbGwgYmUgcmVtb3ZlZCBhZnRlciB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLiBXaGVuIGFuIGVsZW1lbnQgaXMgYmVpbmcgcmVtb3ZlZFxuICogZnJvbSB0aGUgRE9NIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtYW5pbWF0ZS1vdXRgIGFuZCBgYW5pbWF0ZS1vdXRgIGNsYXNzZXMsIHRoZW4gdGhlIGNsYXNzZXMgd2lsbCBiZSByZW1vdmVkIG9uY2VcbiAqIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuXG4gKlxuICogSWYgdXNpbmcgSmF2YVNjcmlwdCwgbWV0aG9kcyBtdXN0IGJlIGRlZmluZWQgIHRvIGFuaW1hdGUgdGhlIGVsZW1lbnQgdGhlcmUgYXJlIDMgc3VwcG9ydGVkIG1ldGhvZHMgd2hpY2ggY2FuIGJcbiAqXG4gKiBUT0RPIGNhY2hlIGJ5IGNsYXNzLW5hbWUgKEFuZ3VsYXIpPyBPbmx5IHN1cHBvcnQgamF2YXNjcmlwdC1zdHlsZSAoRW1iZXIpPyBBZGQgYSBgd2lsbC1hbmltYXRlLWluYCBhbmRcbiAqIGBkaWQtYW5pbWF0ZS1pbmAgZXRjLj9cbiAqIElGIGhhcyBhbnkgY2xhc3NlcywgYWRkIHRoZSBgd2lsbC1hbmltYXRlLWlufG91dGAgYW5kIGdldCBjb21wdXRlZCBkdXJhdGlvbi4gSWYgbm9uZSwgcmV0dXJuLiBDYWNoZS5cbiAqIFJVTEUgaXMgdXNlIHVuaXF1ZSBjbGFzcyB0byBkZWZpbmUgYW4gYW5pbWF0aW9uLiBPciBhdHRyaWJ1dGUgYGFuaW1hdGU9XCJmYWRlXCJgIHdpbGwgYWRkIHRoZSBjbGFzcz9cbiAqIGAuZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLmZhZGUuYW5pbWF0ZS1pbmAsIGAuZmFkZS53aWxsLWFuaW1hdGUtb3V0YCwgYC5mYWRlLmFuaW1hdGUtb3V0YFxuICpcbiAqIEV2ZW50cyB3aWxsIGJlIHRyaWdnZXJlZCBvbiB0aGUgZWxlbWVudHMgbmFtZWQgdGhlIHNhbWUgYXMgdGhlIGNsYXNzIG5hbWVzIChlLmcuIGBhbmltYXRlLWluYCkgd2hpY2ggbWF5IGJlIGxpc3RlbmVkXG4gKiB0byBpbiBvcmRlciB0byBjYW5jZWwgYW4gYW5pbWF0aW9uIG9yIHJlc3BvbmQgdG8gaXQuXG4gKlxuICogSWYgdGhlIG5vZGUgaGFzIG1ldGhvZHMgYGFuaW1hdGVJbihkb25lKWAsIGBhbmltYXRlT3V0KGRvbmUpYCwgYGFuaW1hdGVNb3ZlSW4oZG9uZSlgLCBvciBgYW5pbWF0ZU1vdmVPdXQoZG9uZSlgXG4gKiBkZWZpbmVkIG9uIHRoZW0gdGhlbiB0aGUgaGVscGVycyB3aWxsIGFsbG93IGFuIGFuaW1hdGlvbiBpbiBKYXZhU2NyaXB0IHRvIGJlIHJ1biBhbmQgd2FpdCBmb3IgdGhlIGBkb25lYCBmdW5jdGlvbiB0b1xuICogYmUgY2FsbGVkIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIEJlIHN1cmUgdG8gYWN0dWFsbHkgaGF2ZSBhbiBhbmltYXRpb24gZGVmaW5lZCBmb3IgZWxlbWVudHMgd2l0aCB0aGUgYGFuaW1hdGVgIGNsYXNzL2F0dHJpYnV0ZSBiZWNhdXNlIHRoZSBoZWxwZXJzIHVzZVxuICogdGhlIGB0cmFuc2l0aW9uZW5kYCBhbmQgYGFuaW1hdGlvbmVuZGAgZXZlbnRzIHRvIGtub3cgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGZpbmlzaGVkLCBhbmQgaWYgdGhlcmUgaXMgbm8gYW5pbWF0aW9uXG4gKiB0aGVzZSBldmVudHMgd2lsbCBuZXZlciBiZSB0cmlnZ2VyZWQgYW5kIHRoZSBvcGVyYXRpb24gd2lsbCBuZXZlciBjb21wbGV0ZS5cbiAqL1xuZnVuY3Rpb24gQW5pbWF0ZWRCaW5kaW5nKHByb3BlcnRpZXMpIHtcbiAgdmFyIGVsZW1lbnQgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHZhciBhbmltYXRlID0gZWxlbWVudC5nZXRBdHRyaWJ1dGUocHJvcGVydGllcy5mcmFnbWVudHMuYW5pbWF0ZUF0dHJpYnV0ZSk7XG4gIHZhciBmcmFnbWVudHMgPSBwcm9wZXJ0aWVzLmZyYWdtZW50cztcblxuICBpZiAoYW5pbWF0ZSAhPT0gbnVsbCkge1xuICAgIGlmIChlbGVtZW50Lm5vZGVOYW1lID09PSAnVEVNUExBVEUnIHx8IGVsZW1lbnQubm9kZU5hbWUgPT09ICdTQ1JJUFQnKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBhbmltYXRlIG11bHRpcGxlIG5vZGVzIGluIGEgdGVtcGxhdGUgb3Igc2NyaXB0LiBSZW1vdmUgdGhlIFthbmltYXRlXSBhdHRyaWJ1dGUuJyk7XG4gICAgfVxuXG4gICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgIC8vIEFsbG93IG11bHRpcGxlIGJpbmRpbmdzIHRvIGFuaW1hdGUgYnkgbm90IHJlbW92aW5nIHVudGlsIHRoZXkgaGF2ZSBhbGwgYmVlbiBjcmVhdGVkXG4gICAgICBlbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShwcm9wZXJ0aWVzLmZyYWdtZW50cy5hbmltYXRlQXR0cmlidXRlKTtcbiAgICB9KTtcblxuICAgIHRoaXMuYW5pbWF0ZSA9IHRydWU7XG5cbiAgICBpZiAoZnJhZ21lbnRzLmlzQm91bmQoJ2F0dHJpYnV0ZScsIGFuaW1hdGUpKSB7XG4gICAgICAvLyBqYXZhc2NyaXB0IGFuaW1hdGlvblxuICAgICAgdGhpcy5hbmltYXRlRXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBhbmltYXRlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKGFuaW1hdGVbMF0gPT09ICcuJykge1xuICAgICAgICAvLyBjbGFzcyBhbmltYXRpb25cbiAgICAgICAgdGhpcy5hbmltYXRlQ2xhc3NOYW1lID0gYW5pbWF0ZS5zbGljZSgxKTtcbiAgICAgIH0gZWxzZSBpZiAoYW5pbWF0ZSkge1xuICAgICAgICAvLyByZWdpc3RlcmVkIGFuaW1hdGlvblxuICAgICAgICB2YXIgYW5pbWF0ZU9iamVjdCA9IGZyYWdtZW50cy5nZXRBbmltYXRpb24oYW5pbWF0ZSk7XG4gICAgICAgIGlmICh0eXBlb2YgYW5pbWF0ZU9iamVjdCA9PT0gJ2Z1bmN0aW9uJykgYW5pbWF0ZU9iamVjdCA9IG5ldyBhbmltYXRlT2JqZWN0KHRoaXMpO1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSBhbmltYXRlT2JqZWN0O1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIEJpbmRpbmcuY2FsbCh0aGlzLCBwcm9wZXJ0aWVzKTtcbn1cblxuXG5CaW5kaW5nLmV4dGVuZChBbmltYXRlZEJpbmRpbmcsIHtcbiAgaW5pdDogZnVuY3Rpb24oKSB7XG4gICAgX3N1cGVyLmluaXQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVFeHByZXNzaW9uKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24sIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfVxuICB9LFxuXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09IGNvbnRleHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX3N1cGVyLmJpbmQuY2FsbCh0aGlzLCBjb250ZXh0KTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIuYmluZChjb250ZXh0KTtcbiAgICB9XG4gIH0sXG5cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09PSBudWxsKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci51bmJpbmQuY2FsbCh0aGlzKTtcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYnNlcnZlcikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIudW5iaW5kKCk7XG4gICAgfVxuICB9LFxuXG4gIC8qKlxuICAgKiBIZWxwZXIgbWV0aG9kIHRvIHJlbW92ZSBhIG5vZGUgZnJvbSB0aGUgRE9NLCBhbGxvd2luZyBmb3IgYW5pbWF0aW9ucyB0byBvY2N1ci4gYGNhbGxiYWNrYCB3aWxsIGJlIGNhbGxlZCB3aGVuXG4gICAqIGZpbmlzaGVkLlxuICAgKi9cbiAgYW5pbWF0ZU91dDogZnVuY3Rpb24obm9kZSwgY2FsbGJhY2spIHtcbiAgICBpZiAobm9kZS5maXJzdFZpZXdOb2RlKSBub2RlID0gbm9kZS5maXJzdFZpZXdOb2RlO1xuXG4gICAgdGhpcy5hbmltYXRlTm9kZSgnb3V0Jywgbm9kZSwgZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwodGhpcyk7XG4gICAgfSk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gaW5zZXJ0IGEgbm9kZSBpbiB0aGUgRE9NIGJlZm9yZSBhbm90aGVyIG5vZGUsIGFsbG93aW5nIGZvciBhbmltYXRpb25zIHRvIG9jY3VyLiBgY2FsbGJhY2tgIHdpbGxcbiAgICogYmUgY2FsbGVkIHdoZW4gZmluaXNoZWQuIElmIGBiZWZvcmVgIGlzIG5vdCBwcm92aWRlZCB0aGVuIHRoZSBhbmltYXRpb24gd2lsbCBiZSBydW4gd2l0aG91dCBpbnNlcnRpbmcgdGhlIG5vZGUuXG4gICAqL1xuICBhbmltYXRlSW46IGZ1bmN0aW9uKG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKG5vZGUuZmlyc3RWaWV3Tm9kZSkgbm9kZSA9IG5vZGUuZmlyc3RWaWV3Tm9kZTtcbiAgICB0aGlzLmFuaW1hdGVOb2RlKCdpbicsIG5vZGUsIGNhbGxiYWNrLCB0aGlzKTtcbiAgfSxcblxuICAvKipcbiAgICogQWxsb3cgYW4gZWxlbWVudCB0byB1c2UgQ1NTMyB0cmFuc2l0aW9ucyBvciBhbmltYXRpb25zIHRvIGFuaW1hdGUgaW4gb3Igb3V0IG9mIHRoZSBwYWdlLlxuICAgKi9cbiAgYW5pbWF0ZU5vZGU6IGZ1bmN0aW9uKGRpcmVjdGlvbiwgbm9kZSwgY2FsbGJhY2spIHtcbiAgICB2YXIgYW5pbWF0ZU9iamVjdCwgY2xhc3NOYW1lLCBuYW1lLCB3aWxsTmFtZSwgZGlkTmFtZSwgX3RoaXMgPSB0aGlzO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZU9iamVjdCAmJiB0eXBlb2YgdGhpcy5hbmltYXRlT2JqZWN0ID09PSAnb2JqZWN0Jykge1xuICAgICAgYW5pbWF0ZU9iamVjdCA9IHRoaXMuYW5pbWF0ZU9iamVjdDtcbiAgICB9IGVsc2UgaWYgKHRoaXMuYW5pbWF0ZUNsYXNzTmFtZSkge1xuICAgICAgY2xhc3NOYW1lID0gdGhpcy5hbmltYXRlQ2xhc3NOYW1lO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIHRoaXMuYW5pbWF0ZU9iamVjdCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNsYXNzTmFtZSA9IHRoaXMuYW5pbWF0ZU9iamVjdDtcbiAgICB9XG5cbiAgICBpZiAoYW5pbWF0ZU9iamVjdCkge1xuICAgICAgdmFyIGRpciA9IGRpcmVjdGlvbiA9PT0gJ2luJyA/ICdJbicgOiAnT3V0JztcbiAgICAgIG5hbWUgPSAnYW5pbWF0ZScgKyBkaXI7XG4gICAgICB3aWxsTmFtZSA9ICd3aWxsQW5pbWF0ZScgKyBkaXI7XG4gICAgICBkaWROYW1lID0gJ2RpZEFuaW1hdGUnICsgZGlyO1xuXG4gICAgICBhbmltYXRpb24ubWFrZUVsZW1lbnRBbmltYXRhYmxlKG5vZGUpO1xuXG4gICAgICBpZiAoYW5pbWF0ZU9iamVjdFt3aWxsTmFtZV0pIHtcbiAgICAgICAgYW5pbWF0ZU9iamVjdFt3aWxsTmFtZV0obm9kZSk7XG4gICAgICAgIC8vIHRyaWdnZXIgcmVmbG93XG4gICAgICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgfVxuXG4gICAgICBpZiAoYW5pbWF0ZU9iamVjdFtuYW1lXSkge1xuICAgICAgICBhbmltYXRlT2JqZWN0W25hbWVdKG5vZGUsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGlmIChhbmltYXRlT2JqZWN0W2RpZE5hbWVdKSBhbmltYXRlT2JqZWN0W2RpZE5hbWVdKG5vZGUpO1xuICAgICAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbChfdGhpcyk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBuYW1lID0gJ2FuaW1hdGUtJyArIGRpcmVjdGlvbjtcbiAgICAgIHdpbGxOYW1lID0gJ3dpbGwtYW5pbWF0ZS0nICsgZGlyZWN0aW9uO1xuICAgICAgaWYgKGNsYXNzTmFtZSkgbm9kZS5jbGFzc0xpc3QuYWRkKGNsYXNzTmFtZSk7XG5cbiAgICAgIGlmIChkaXJlY3Rpb24gPT09ICdpbicpIHtcbiAgICAgICAgdmFyIG5leHQgPSBub2RlLm5leHRTaWJsaW5nLCBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgICAgIHBhcmVudC5yZW1vdmVDaGlsZChub2RlKTtcbiAgICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKHdpbGxOYW1lKTtcbiAgICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShub2RlLCBuZXh0KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIC8vIHRyaWdnZXIgcmVmbG93XG4gICAgICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuICAgICAgfVxuXG4gICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUod2lsbE5hbWUpO1xuICAgICAgbm9kZS5jbGFzc0xpc3QuYWRkKG5hbWUpO1xuXG4gICAgICB2YXIgZHVyYXRpb24gPSBnZXREdXJhdGlvbi5jYWxsKHRoaXMsIG5vZGUsIGRpcmVjdGlvbik7XG4gICAgICBmdW5jdGlvbiB3aGVuRG9uZSgpIHtcbiAgICAgICAgbm9kZS5jbGFzc0xpc3QucmVtb3ZlKG5hbWUpO1xuICAgICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgIH1cblxuICAgICAgaWYgKGR1cmF0aW9uKSB7XG4gICAgICAgIHNldFRpbWVvdXQod2hlbkRvbmUsIGR1cmF0aW9uKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdoZW5Eb25lKCk7XG4gICAgICB9XG4gICAgfVxuICB9XG59KTtcblxuXG52YXIgdHJhbnNpdGlvbkR1cmF0aW9uTmFtZSA9ICd0cmFuc2l0aW9uRHVyYXRpb24nO1xudmFyIHRyYW5zaXRpb25EZWxheU5hbWUgPSAndHJhbnNpdGlvbkRlbGF5JztcbnZhciBhbmltYXRpb25EdXJhdGlvbk5hbWUgPSAnYW5pbWF0aW9uRHVyYXRpb24nO1xudmFyIGFuaW1hdGlvbkRlbGF5TmFtZSA9ICdhbmltYXRpb25EZWxheSc7XG52YXIgc3R5bGUgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGU7XG5pZiAoc3R5bGUudHJhbnNpdGlvbkR1cmF0aW9uID09PSB1bmRlZmluZWQgJiYgc3R5bGUud2Via2l0VHJhbnNpdGlvbkR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgdHJhbnNpdGlvbkR1cmF0aW9uTmFtZSA9ICd3ZWJraXRUcmFuc2l0aW9uRHVyYXRpb24nO1xuICB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3dlYmtpdFRyYW5zaXRpb25EZWxheSc7XG59XG5pZiAoc3R5bGUuYW5pbWF0aW9uRHVyYXRpb24gPT09IHVuZGVmaW5lZCAmJiBzdHlsZS53ZWJraXRBbmltYXRpb25EdXJhdGlvbiAhPT0gdW5kZWZpbmVkKSB7XG4gIGFuaW1hdGlvbkR1cmF0aW9uTmFtZSA9ICd3ZWJraXRBbmltYXRpb25EdXJhdGlvbic7XG4gIGFuaW1hdGlvbkRlbGF5TmFtZSA9ICd3ZWJraXRBbmltYXRpb25EZWxheSc7XG59XG5cblxuZnVuY3Rpb24gZ2V0RHVyYXRpb24obm9kZSwgZGlyZWN0aW9uKSB7XG4gIHZhciBtaWxsaXNlY29uZHMgPSB0aGlzLmNsb25lZEZyb21bJ19fYW5pbWF0aW9uRHVyYXRpb24nICsgZGlyZWN0aW9uXTtcbiAgaWYgKCFtaWxsaXNlY29uZHMpIHtcbiAgICAvLyBSZWNhbGMgaWYgbm9kZSB3YXMgb3V0IG9mIERPTSBiZWZvcmUgYW5kIGhhZCAwIGR1cmF0aW9uLCBhc3N1bWUgdGhlcmUgaXMgYWx3YXlzIFNPTUUgZHVyYXRpb24uXG4gICAgdmFyIHN0eWxlcyA9IHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKG5vZGUpO1xuICAgIHZhciBzZWNvbmRzID0gTWF0aC5tYXgocGFyc2VGbG9hdChzdHlsZXNbdHJhbnNpdGlvbkR1cmF0aW9uTmFtZV0gfHwgMCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbdHJhbnNpdGlvbkRlbGF5TmFtZV0gfHwgMCksXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1thbmltYXRpb25EdXJhdGlvbk5hbWVdIHx8IDApICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW2FuaW1hdGlvbkRlbGF5TmFtZV0gfHwgMCkpO1xuICAgIG1pbGxpc2Vjb25kcyA9IHNlY29uZHMgKiAxMDAwIHx8IDA7XG4gICAgdGhpcy5jbG9uZWRGcm9tLl9fYW5pbWF0aW9uRHVyYXRpb25fXyA9IG1pbGxpc2Vjb25kcztcbiAgfVxuICByZXR1cm4gbWlsbGlzZWNvbmRzO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBCaW5kaW5nO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcblxuLyoqXG4gKiBBIGJpbmRpbmcgaXMgYSBsaW5rIGJldHdlZW4gYW4gZWxlbWVudCBhbmQgc29tZSBkYXRhLiBTdWJjbGFzc2VzIG9mIEJpbmRpbmcgY2FsbGVkIGJpbmRlcnMgZGVmaW5lIHdoYXQgYSBiaW5kaW5nIGRvZXNcbiAqIHdpdGggdGhhdCBsaW5rLiBJbnN0YW5jZXMgb2YgdGhlc2UgYmluZGVycyBhcmUgY3JlYXRlZCBhcyBiaW5kaW5ncyBvbiB0ZW1wbGF0ZXMuIFdoZW4gYSB2aWV3IGlzIHN0YW1wZWQgb3V0IGZyb20gdGhlXG4gKiB0ZW1wbGF0ZSB0aGUgYmluZGluZyBpcyBcImNsb25lZFwiIChpdCBpcyBhY3R1YWxseSBleHRlbmRlZCBmb3IgcGVyZm9ybWFuY2UpIGFuZCB0aGUgYGVsZW1lbnRgL2Bub2RlYCBwcm9wZXJ0eSBpc1xuICogdXBkYXRlZCB0byB0aGUgbWF0Y2hpbmcgZWxlbWVudCBpbiB0aGUgdmlldy5cbiAqXG4gKiAjIyMgUHJvcGVydGllc1xuICogICogZWxlbWVudDogVGhlIGVsZW1lbnQgKG9yIHRleHQgbm9kZSkgdGhpcyBiaW5kaW5nIGlzIGJvdW5kIHRvXG4gKiAgKiBub2RlOiBBbGlhcyBvZiBlbGVtZW50LCBzaW5jZSBiaW5kaW5ncyBtYXkgYXBwbHkgdG8gdGV4dCBub2RlcyB0aGlzIGlzIG1vcmUgYWNjdXJhdGVcbiAqICAqIG5hbWU6IFRoZSBhdHRyaWJ1dGUgb3IgZWxlbWVudCBuYW1lIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIHRleHQgbm9kZXMpXG4gKiAgKiBtYXRjaDogVGhlIG1hdGNoZWQgcGFydCBvZiB0aGUgbmFtZSBmb3Igd2lsZGNhcmQgYXR0cmlidXRlcyAoZS5nLiBgb24tKmAgbWF0Y2hpbmcgYWdhaW5zdCBgb24tY2xpY2tgIHdvdWxkIGhhdmUgYVxuICogICAgbWF0Y2ggcHJvcGVydHkgZXF1YWxsaW5nIGBjbGlja2ApLiBVc2UgYHRoaXMuY2FtZWxDYXNlYCB0byBnZXQgdGhlIG1hdGNoIHByb2VydHkgY2FtZWxDYXNlZC5cbiAqICAqIGV4cHJlc3Npb246IFRoZSBleHByZXNzaW9uIHRoaXMgYmluZGluZyB3aWxsIHVzZSBmb3IgaXRzIHVwZGF0ZXMgKGRvZXMgbm90IGFwcGx5IHRvIG1hdGNoZWQgZWxlbWVudHMpXG4gKiAgKiBjb250ZXh0OiBUaGUgY29udGV4dCB0aGUgZXhyZXNzaW9uIG9wZXJhdGVzIHdpdGhpbiB3aGVuIGJvdW5kXG4gKi9cbmZ1bmN0aW9uIEJpbmRpbmcocHJvcGVydGllcykge1xuICBpZiAoIXByb3BlcnRpZXMubm9kZSB8fCAhcHJvcGVydGllcy52aWV3KSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQSBiaW5kaW5nIG11c3QgcmVjZWl2ZSBhIG5vZGUgYW5kIGEgdmlldycpO1xuICB9XG5cbiAgLy8gZWxlbWVudCBhbmQgbm9kZSBhcmUgYWxpYXNlc1xuICB0aGlzLl9lbGVtZW50UGF0aCA9IGluaXROb2RlUGF0aChwcm9wZXJ0aWVzLm5vZGUsIHByb3BlcnRpZXMudmlldyk7XG4gIHRoaXMubm9kZSA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5lbGVtZW50ID0gcHJvcGVydGllcy5ub2RlO1xuICB0aGlzLm5hbWUgPSBwcm9wZXJ0aWVzLm5hbWU7XG4gIHRoaXMubWF0Y2ggPSBwcm9wZXJ0aWVzLm1hdGNoO1xuICB0aGlzLmV4cHJlc3Npb24gPSBwcm9wZXJ0aWVzLmV4cHJlc3Npb247XG4gIHRoaXMuZnJhZ21lbnRzID0gcHJvcGVydGllcy5mcmFnbWVudHM7XG4gIHRoaXMuY29udGV4dCA9IG51bGw7XG59XG5cbmV4dGVuZChCaW5kaW5nLCB7XG4gIC8qKlxuICAgKiBEZWZhdWx0IHByaW9yaXR5IGJpbmRlcnMgbWF5IG92ZXJyaWRlLlxuICAgKi9cbiAgcHJpb3JpdHk6IDAsXG5cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBhIGNsb25lZCBiaW5kaW5nLiBUaGlzIGhhcHBlbnMgYWZ0ZXIgYSBjb21waWxlZCBiaW5kaW5nIG9uIGEgdGVtcGxhdGUgaXMgY2xvbmVkIGZvciBhIHZpZXcuXG4gICAqL1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5leHByZXNzaW9uKSB7XG4gICAgICAvLyBBbiBvYnNlcnZlciB0byBvYnNlcnZlIHZhbHVlIGNoYW5nZXMgdG8gdGhlIGV4cHJlc3Npb24gd2l0aGluIGEgY29udGV4dFxuICAgICAgdGhpcy5vYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy51cGRhdGVkLCB0aGlzKTtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVkKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENsb25lIHRoaXMgYmluZGluZyBmb3IgYSB2aWV3LiBUaGUgZWxlbWVudC9ub2RlIHdpbGwgYmUgdXBkYXRlZCBhbmQgdGhlIGJpbmRpbmcgd2lsbCBiZSBpbml0ZWQuXG4gICAqL1xuICBjbG9uZUZvclZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IGNsb25lIGFnYWluc3QgYSB2aWV3Jyk7XG4gICAgfVxuXG4gICAgdmFyIG5vZGUgPSB2aWV3O1xuICAgIHRoaXMuX2VsZW1lbnRQYXRoLmZvckVhY2goZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkTm9kZXNbaW5kZXhdO1xuICAgIH0pO1xuXG4gICAgdmFyIGJpbmRpbmcgPSBPYmplY3QuY3JlYXRlKHRoaXMpO1xuICAgIGJpbmRpbmcuY2xvbmVkRnJvbSA9IHRoaXM7XG4gICAgYmluZGluZy5lbGVtZW50ID0gbm9kZTtcbiAgICBiaW5kaW5nLm5vZGUgPSBub2RlO1xuICAgIGJpbmRpbmcuaW5pdCgpO1xuICAgIHJldHVybiBiaW5kaW5nO1xuICB9LFxuXG5cbiAgLy8gQmluZCB0aGlzIHRvIHRoZSBnaXZlbiBjb250ZXh0IG9iamVjdFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci5jb250ZXh0ID0gY29udGV4dDtcbiAgICB0aGlzLmJvdW5kKCk7XG5cbiAgICBpZiAodGhpcy5vYnNlcnZlcikge1xuICAgICAgaWYgKHRoaXMudXBkYXRlZCAhPT0gQmluZGluZy5wcm90b3R5cGUudXBkYXRlZCkge1xuICAgICAgICB0aGlzLm9ic2VydmVyLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSB0cnVlO1xuICAgICAgICB0aGlzLm9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG5cbiAgLy8gVW5iaW5kIHRoaXMgZnJvbSBpdHMgY29udGV4dFxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci51bmJpbmQoKTtcbiAgICB0aGlzLnVuYm91bmQoKTtcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB9LFxuXG5cbiAgLy8gQ2xlYW5zIHVwIGJpbmRpbmcgY29tcGxldGVseVxuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB7XG4gICAgICAvLyBUaGlzIHdpbGwgY2xlYXIgaXQgb3V0LCBudWxsaWZ5aW5nIGFueSBkYXRhIHN0b3JlZFxuICAgICAgdGhpcy5vYnNlcnZlci5zeW5jKCk7XG4gICAgfVxuICAgIHRoaXMuZGlzcG9zZWQoKTtcbiAgfSxcblxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY29tcGlsZWQgd2l0aGluIGEgdGVtcGxhdGVcbiAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjcmVhdGVkXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBleHByZXNzaW9uJ3MgdmFsdWUgY2hhbmdlc1xuICB1cGRhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBib3VuZFxuICBib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgdW5ib3VuZFxuICB1bmJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBkaXNwb3NlZFxuICBkaXNwb3NlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBIZWxwZXIgbWV0aG9kc1xuXG4gIGdldCBjYW1lbENhc2UoKSB7XG4gICAgcmV0dXJuICh0aGlzLm1hdGNoIHx8IHRoaXMubmFtZSB8fCAnJykucmVwbGFjZSgvLSsoXFx3KS9nLCBmdW5jdGlvbihfLCBjaGFyKSB7XG4gICAgICByZXR1cm4gY2hhci50b1VwcGVyQ2FzZSgpO1xuICAgIH0pO1xuICB9LFxuXG4gIG9ic2VydmU6IGZ1bmN0aW9uKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuT2JzZXJ2ZXIoZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCB8fCB0aGlzKTtcbiAgfVxufSk7XG5cblxuXG5cbnZhciBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2Y7XG5cbi8vIENyZWF0ZXMgYW4gYXJyYXkgb2YgaW5kZXhlcyB0byBoZWxwIGZpbmQgdGhlIHNhbWUgZWxlbWVudCB3aXRoaW4gYSBjbG9uZWQgdmlld1xuZnVuY3Rpb24gaW5pdE5vZGVQYXRoKG5vZGUsIHZpZXcpIHtcbiAgdmFyIHBhdGggPSBbXTtcbiAgd2hpbGUgKG5vZGUgIT09IHZpZXcpIHtcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHBhdGgudW5zaGlmdChpbmRleE9mLmNhbGwocGFyZW50LmNoaWxkTm9kZXMsIG5vZGUpKTtcbiAgICBub2RlID0gcGFyZW50O1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuIiwidmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xubW9kdWxlLmV4cG9ydHMgPSBjb21waWxlO1xuXG5cbi8vIFdhbGtzIHRoZSB0ZW1wbGF0ZSBET00gcmVwbGFjaW5nIGFueSBiaW5kaW5ncyBhbmQgY2FjaGluZyBiaW5kaW5ncyBvbnRvIHRoZSB0ZW1wbGF0ZSBvYmplY3QuXG5mdW5jdGlvbiBjb21waWxlKGZyYWdtZW50cywgdGVtcGxhdGUpIHtcbiAgdmFyIHdhbGtlciA9IGRvY3VtZW50LmNyZWF0ZVRyZWVXYWxrZXIodGVtcGxhdGUsIE5vZGVGaWx0ZXIuU0hPV19FTEVNRU5UIHwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICB2YXIgYmluZGluZ3MgPSBbXSwgY3VycmVudE5vZGUsIHBhcmVudE5vZGUsIHByZXZpb3VzTm9kZTtcblxuICAvLyBSZXNldCBmaXJzdCBub2RlIHRvIGVuc3VyZSBpdCBpc24ndCBhIGZyYWdtZW50XG4gIHdhbGtlci5uZXh0Tm9kZSgpO1xuICB3YWxrZXIucHJldmlvdXNOb2RlKCk7XG5cbiAgLy8gZmluZCBiaW5kaW5ncyBmb3IgZWFjaCBub2RlXG4gIGRvIHtcbiAgICBjdXJyZW50Tm9kZSA9IHdhbGtlci5jdXJyZW50Tm9kZTtcbiAgICBwYXJlbnROb2RlID0gY3VycmVudE5vZGUucGFyZW50Tm9kZTtcbiAgICBiaW5kaW5ncy5wdXNoLmFwcGx5KGJpbmRpbmdzLCBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBjdXJyZW50Tm9kZSwgdGVtcGxhdGUpKTtcblxuICAgIGlmIChjdXJyZW50Tm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnROb2RlKSB7XG4gICAgICAvLyBjdXJyZW50Tm9kZSB3YXMgcmVtb3ZlZCBhbmQgbWFkZSBhIHRlbXBsYXRlXG4gICAgICB3YWxrZXIuY3VycmVudE5vZGUgPSBwcmV2aW91c05vZGUgfHwgd2Fsa2VyLnJvb3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZXZpb3VzTm9kZSA9IGN1cnJlbnROb2RlO1xuICAgIH1cbiAgfSB3aGlsZSAod2Fsa2VyLm5leHROb2RlKCkpO1xuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG5cbi8vIEZpbmQgYWxsIHRoZSBiaW5kaW5ncyBvbiBhIGdpdmVuIG5vZGUgKHRleHQgbm9kZXMgd2lsbCBvbmx5IGV2ZXIgaGF2ZSBvbmUgYmluZGluZykuXG5mdW5jdGlvbiBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBub2RlLCB2aWV3KSB7XG4gIHZhciBiaW5kaW5ncyA9IFtdO1xuICB2YXIgQmluZGVyLCBiaW5kaW5nLCBleHByLCBib3VuZCwgbWF0Y2gsIGF0dHIsIGk7XG5cbiAgaWYgKG5vZGUubm9kZVR5cGUgPT09IE5vZGUuVEVYVF9OT0RFKSB7XG4gICAgc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIHRleHQgbm9kZVxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgndGV4dCcsIG5vZGUubm9kZVZhbHVlKSkge1xuICAgICAgZXhwciA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpO1xuICAgICAgbm9kZS5ub2RlVmFsdWUgPSAnJztcbiAgICAgIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCd0ZXh0JywgZXhwcik7XG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGV4cHJlc3Npb246IGV4cHIsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pO1xuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgdGhlIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00sIHN0b3AuIENoZWNrIGJ5IGxvb2tpbmcgYXQgaXRzIHBhcmVudE5vZGVcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHZhciBEZWZhdWx0QmluZGVyID0gZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcignX19kZWZhdWx0X18nKTtcblxuICAgIC8vIEZpbmQgYW55IGJpbmRpbmcgZm9yIHRoZSBlbGVtZW50XG4gICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2VsZW1lbnQnLCBub2RlLnRhZ05hbWUudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKEJpbmRlcikge1xuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KTtcbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgcmVtb3ZlZCwgbWFkZSBhIHRlbXBsYXRlLCBkb24ndCBjb250aW51ZSBwcm9jZXNzaW5nXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmluZCBhbmQgYWRkIGFueSBhdHRyaWJ1dGUgYmluZGluZ3Mgb24gYW4gZWxlbWVudC4gVGhlc2UgY2FuIGJlIGF0dHJpYnV0ZXMgd2hvc2UgbmFtZSBtYXRjaGVzIGEgYmluZGluZywgb3JcbiAgICAvLyB0aGV5IGNhbiBiZSBhdHRyaWJ1dGVzIHdoaWNoIGhhdmUgYSBiaW5kaW5nIGluIHRoZSB2YWx1ZSBzdWNoIGFzIGBocmVmPVwiL3Bvc3Qve3sgcG9zdC5pZCB9fVwiYC5cbiAgICB2YXIgYm91bmQgPSBbXTtcbiAgICB2YXIgYXR0cmlidXRlcyA9IHNsaWNlLmNhbGwobm9kZS5hdHRyaWJ1dGVzKTtcbiAgICBmb3IgKGkgPSAwLCBsID0gYXR0cmlidXRlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBhdHRyID0gYXR0cmlidXRlc1tpXTtcbiAgICAgIHZhciBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignYXR0cmlidXRlJywgYXR0ci5uYW1lLCBhdHRyLnZhbHVlKTtcbiAgICAgIGlmIChCaW5kZXIpIHtcbiAgICAgICAgYm91bmQucHVzaChbIEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYWtlIHN1cmUgdG8gY3JlYXRlIGFuZCBwcm9jZXNzIHRoZW0gaW4gdGhlIGNvcnJlY3QgcHJpb3JpdHkgb3JkZXIgc28gaWYgYSBiaW5kaW5nIGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gdGhlXG4gICAgLy8gbm9kZSBpdCBkb2Vzbid0IHByb2Nlc3MgdGhlIG90aGVycy5cbiAgICBib3VuZC5zb3J0KHNvcnRBdHRyaWJ1dGVzKTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBib3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIEJpbmRlciA9IGJvdW5kW2ldWzBdO1xuICAgICAgdmFyIGF0dHIgPSBib3VuZFtpXVsxXTtcbiAgICAgIGlmICghbm9kZS5oYXNBdHRyaWJ1dGUoYXR0ci5uYW1lKSkge1xuICAgICAgICAvLyBJZiB0aGlzIHdhcyByZW1vdmVkIGFscmVhZHkgYnkgYW5vdGhlciBiaW5kaW5nLCBkb24ndCBwcm9jZXNzLlxuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHZhciBuYW1lID0gYXR0ci5uYW1lO1xuICAgICAgdmFyIHZhbHVlID0gYXR0ci52YWx1ZTtcbiAgICAgIGlmIChCaW5kZXIuZXhwcikge1xuICAgICAgICBtYXRjaCA9IG5hbWUubWF0Y2goQmluZGVyLmV4cHIpO1xuICAgICAgICBpZiAobWF0Y2gpIG1hdGNoID0gbWF0Y2hbMV07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBtYXRjaCA9IG51bGw7XG4gICAgICB9XG5cbiAgICAgIHRyeSB7XG4gICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKGF0dHIubmFtZSk7XG4gICAgICB9IGNhdGNoKGUpIHt9XG5cbiAgICAgIGJpbmRpbmcgPSBuZXcgQmluZGVyKHtcbiAgICAgICAgbm9kZTogbm9kZSxcbiAgICAgICAgdmlldzogdmlldyxcbiAgICAgICAgbmFtZTogbmFtZSxcbiAgICAgICAgbWF0Y2g6IG1hdGNoLFxuICAgICAgICBleHByZXNzaW9uOiB2YWx1ZSA/IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCB2YWx1ZSkgOiBudWxsLFxuICAgICAgICBmcmFnbWVudHM6IGZyYWdtZW50c1xuICAgICAgfSk7XG5cbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9IGVsc2UgaWYgKEJpbmRlciAhPT0gRGVmYXVsdEJpbmRlciAmJiBmcmFnbWVudHMuaXNCb3VuZCgnYXR0cmlidXRlJywgdmFsdWUpKSB7XG4gICAgICAgIC8vIFJldmVydCB0byBkZWZhdWx0IGlmIHRoaXMgYmluZGluZyBkb2Vzbid0IHRha2VcbiAgICAgICAgYm91bmQucHVzaChbIERlZmF1bHRCaW5kZXIsIGF0dHIgXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHBhcmVudCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmluZGluZ3M7XG59XG5cblxuLy8gU3BsaXRzIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtIHNvIHRoZXkgY2FuIGJlIGJvdW5kIGluZGl2aWR1YWxseSwgaGFzIHBhcmVudE5vZGUgcGFzc2VkIGluIHNpbmNlIGl0IG1heVxuLy8gYmUgYSBkb2N1bWVudCBmcmFnbWVudCB3aGljaCBhcHBlYXJzIGFzIG51bGwgb24gbm9kZS5wYXJlbnROb2RlLlxuZnVuY3Rpb24gc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpIHtcbiAgaWYgKCFub2RlLnByb2Nlc3NlZCkge1xuICAgIG5vZGUucHJvY2Vzc2VkID0gdHJ1ZTtcbiAgICB2YXIgcmVnZXggPSBmcmFnbWVudHMuYmluZGVycy50ZXh0Ll9leHByO1xuICAgIHZhciBjb250ZW50ID0gbm9kZS5ub2RlVmFsdWU7XG4gICAgaWYgKGNvbnRlbnQubWF0Y2gocmVnZXgpKSB7XG4gICAgICB2YXIgbWF0Y2gsIGxhc3RJbmRleCA9IDAsIHBhcnRzID0gW10sIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgd2hpbGUgKG1hdGNoID0gcmVnZXguZXhlYyhjb250ZW50KSkge1xuICAgICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4LCByZWdleC5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpKTtcbiAgICAgICAgcGFydHMucHVzaChtYXRjaFswXSk7XG4gICAgICAgIGxhc3RJbmRleCA9IHJlZ2V4Lmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goY29udGVudC5zbGljZShsYXN0SW5kZXgpKTtcbiAgICAgIHBhcnRzID0gcGFydHMuZmlsdGVyKG5vdEVtcHR5KTtcblxuICAgICAgbm9kZS5ub2RlVmFsdWUgPSBwYXJ0c1swXTtcbiAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5ld1RleHROb2RlID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUocGFydHNbaV0pO1xuICAgICAgICBuZXdUZXh0Tm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChuZXdUZXh0Tm9kZSk7XG4gICAgICB9XG4gICAgICBub2RlLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBub2RlLm5leHRTaWJsaW5nKTtcbiAgICB9XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBzb3J0QXR0cmlidXRlcyhhLCBiKSB7XG4gIHJldHVybiBiWzBdLnByb3RvdHlwZS5wcmlvcml0eSAtIGFbMF0ucHJvdG90eXBlLnByaW9yaXR5O1xufVxuXG5mdW5jdGlvbiBub3RFbXB0eSh2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEZyYWdtZW50cztcbnJlcXVpcmUoJy4vdXRpbC9wb2x5ZmlsbHMnKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG52YXIgdG9GcmFnbWVudCA9IHJlcXVpcmUoJy4vdXRpbC90b0ZyYWdtZW50Jyk7XG52YXIgYW5pbWF0aW9uID0gcmVxdWlyZSgnLi91dGlsL2FuaW1hdGlvbicpO1xudmFyIFRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyk7XG52YXIgQW5pbWF0ZWRCaW5kaW5nID0gcmVxdWlyZSgnLi9hbmltYXRlZEJpbmRpbmcnKTtcbnZhciBjb21waWxlID0gcmVxdWlyZSgnLi9jb21waWxlJyk7XG52YXIgcmVnaXN0ZXJEZWZhdWx0QmluZGVycyA9IHJlcXVpcmUoJy4vcmVnaXN0ZXJlZC9iaW5kZXJzJyk7XG52YXIgcmVnaXN0ZXJEZWZhdWx0Rm9ybWF0dGVycyA9IHJlcXVpcmUoJy4vcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzJyk7XG52YXIgcmVnaXN0ZXJEZWZhdWx0QW5pbWF0aW9ucyA9IHJlcXVpcmUoJy4vcmVnaXN0ZXJlZC9hbmltYXRpb25zJyk7XG5cbi8qKlxuICogQSBGcmFnbWVudHMgb2JqZWN0IHNlcnZlcyBhcyBhIHJlZ2lzdHJ5IGZvciBiaW5kZXJzIGFuZCBmb3JtYXR0ZXJzXG4gKiBAcGFyYW0ge1t0eXBlXX0gT2JzZXJ2ZXJDbGFzcyBbZGVzY3JpcHRpb25dXG4gKi9cbmZ1bmN0aW9uIEZyYWdtZW50cyhPYnNlcnZlckNsYXNzKSB7XG4gIGlmICghT2JzZXJ2ZXJDbGFzcykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ011c3QgcHJvdmlkZSBhbiBPYnNlcnZlciBjbGFzcyB0byBGcmFnbWVudHMuJyk7XG4gIH1cblxuICB0aGlzLk9ic2VydmVyID0gT2JzZXJ2ZXJDbGFzcztcbiAgdGhpcy5nbG9iYWxzID0gT2JzZXJ2ZXJDbGFzcy5nbG9iYWxzID0ge307XG4gIHRoaXMuZm9ybWF0dGVycyA9IE9ic2VydmVyQ2xhc3MuZm9ybWF0dGVycyA9IHt9O1xuICB0aGlzLmFuaW1hdGlvbnMgPSB7fTtcbiAgdGhpcy5hbmltYXRlQXR0cmlidXRlID0gJ2FuaW1hdGUnO1xuXG4gIHRoaXMuYmluZGVycyA9IHtcbiAgICBlbGVtZW50OiB7IF93aWxkY2FyZHM6IFtdIH0sXG4gICAgYXR0cmlidXRlOiB7IF93aWxkY2FyZHM6IFtdLCBfZXhwcjogL3t7XFxzKiguKj8pXFxzKn19L2cgfSxcbiAgICB0ZXh0OiB7IF93aWxkY2FyZHM6IFtdLCBfZXhwcjogL3t7XFxzKiguKj8pXFxzKn19L2cgfVxuICB9O1xuXG4gIC8vIFRleHQgYmluZGVyIGZvciB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyVGV4dCgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSAhPSBudWxsKSA/IHZhbHVlIDogJyc7XG4gIH0pO1xuXG4gIC8vIENhdGNoYWxsIGF0dHJpYnV0ZSBiaW5kZXIgZm9yIHJlZ3VsYXIgYXR0cmlidXRlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlckF0dHJpYnV0ZSgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKHRoaXMubmFtZSwgdmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMubmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZWdpc3RlckRlZmF1bHRCaW5kZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zKHRoaXMpO1xufVxuXG5GcmFnbWVudHMucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gICAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gICAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gICAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gICAqL1xuICBjcmVhdGVUZW1wbGF0ZTogZnVuY3Rpb24oaHRtbCkge1xuICAgIHZhciBmcmFnbWVudCA9IHRvRnJhZ21lbnQoaHRtbCk7XG4gICAgaWYgKGZyYWdtZW50LmNoaWxkTm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tICcgKyBodG1sKTtcbiAgICB9XG4gICAgdmFyIHRlbXBsYXRlID0gZXh0ZW5kLm1ha2UoVGVtcGxhdGUsIGZyYWdtZW50KTtcbiAgICB0ZW1wbGF0ZS5iaW5kaW5ncyA9IGNvbXBpbGUodGhpcywgdGVtcGxhdGUpO1xuICAgIHJldHVybiB0ZW1wbGF0ZTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb21waWxlcyBiaW5kaW5ncyBvbiBhbiBlbGVtZW50LlxuICAgKi9cbiAgY29tcGlsZUVsZW1lbnQ6IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICBpZiAoIWVsZW1lbnQuYmluZGluZ3MpIHtcbiAgICAgIGVsZW1lbnQuYmluZGluZ3MgPSBjb21waWxlKHRoaXMsIGVsZW1lbnQpO1xuICAgICAgZXh0ZW5kLm1ha2UoVmlldywgZWxlbWVudCwgZWxlbWVudCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYW5kIGJpbmRzIGFuIGVsZW1lbnQgd2hpY2ggd2FzIG5vdCBjcmVhdGVkIGZyb20gYSB0ZW1wbGF0ZS4gTW9zdGx5IG9ubHkgdXNlZCBmb3IgYmluZGluZyB0aGUgZG9jdW1lbnQnc1xuICAgKiBodG1sIGVsZW1lbnQuXG4gICAqL1xuICBiaW5kRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCwgY29udGV4dCkge1xuICAgIHRoaXMuY29tcGlsZUVsZW1lbnQoZWxlbWVudCk7XG5cbiAgICBpZiAoY29udGV4dCkge1xuICAgICAgZWxlbWVudC5iaW5kKGNvbnRleHQpO1xuICAgIH1cblxuICAgIHJldHVybiBlbGVtZW50O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIE9ic2VydmVzIGFuIGV4cHJlc3Npb24gd2l0aGluIGEgZ2l2ZW4gY29udGV4dCwgY2FsbGluZyB0aGUgY2FsbGJhY2sgd2hlbiBpdCBjaGFuZ2VzIGFuZCByZXR1cm5pbmcgdGhlIG9ic2VydmVyLlxuICAgKi9cbiAgb2JzZXJ2ZTogZnVuY3Rpb24oY29udGV4dCwgZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICAgIHZhciBvYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpO1xuICAgIG9ic2VydmVyLmJpbmQoY29udGV4dCwgdHJ1ZSk7XG4gICAgcmV0dXJuIG9ic2VydmVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGJpbmRlciBmb3IgYSBnaXZlbiB0eXBlIGFuZCBuYW1lLiBBIGJpbmRlciBpcyBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgYW5kIGlzIHVzZWQgdG8gY3JlYXRlIGJpbmRpbmdzIG9uXG4gICAqIGFuIGVsZW1lbnQgb3IgdGV4dCBub2RlIHdob3NlIHRhZyBuYW1lLCBhdHRyaWJ1dGUgbmFtZSwgb3IgZXhwcmVzc2lvbiBjb250ZW50cyBtYXRjaCB0aGlzIGJpbmRlcidzIG5hbWUvZXhwcmVzc2lvbi5cbiAgICpcbiAgICogIyMjIFBhcmFtZXRlcnNcbiAgICpcbiAgICogICogYHR5cGVgOiB0aGVyZSBhcmUgdGhyZWUgdHlwZXMgb2YgYmluZGVyczogZWxlbWVudCwgYXR0cmlidXRlLCBvciB0ZXh0LiBUaGVzZSBjb3JyZXNwb25kIHRvIG1hdGNoaW5nIGFnYWluc3QgYW5cbiAgICogICAgZWxlbWVudCdzIHRhZyBuYW1lLCBhbiBlbGVtZW50IHdpdGggdGhlIGdpdmVuIGF0dHJpYnV0ZSBuYW1lLCBvciBhIHRleHQgbm9kZSB0aGF0IG1hdGNoZXMgdGhlIHByb3ZpZGVkXG4gICAqICAgIGV4cHJlc3Npb24uXG4gICAqXG4gICAqICAqIGBuYW1lYDogdG8gbWF0Y2gsIGEgYmluZGVyIG5lZWRzIHRoZSBuYW1lIG9mIGFuIGVsZW1lbnQgb3IgYXR0cmlidXRlLCBvciBhIHJlZ3VsYXIgZXhwcmVzc2lvbiB0aGF0IG1hdGNoZXMgYVxuICAgKiAgICBnaXZlbiB0ZXh0IG5vZGUuIE5hbWVzIGZvciBlbGVtZW50cyBhbmQgYXR0cmlidXRlcyBjYW4gYmUgcmVndWxhciBleHByZXNzaW9ucyBhcyB3ZWxsLCBvciB0aGV5IG1heSBiZSB3aWxkY2FyZFxuICAgKiAgICBuYW1lcyBieSB1c2luZyBhbiBhc3Rlcmlzay5cbiAgICpcbiAgICogICogYGRlZmluaXRpb25gOiBhIGJpbmRlciBpcyBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgd2hpY2ggb3ZlcnJpZGVzIGtleSBtZXRob2RzLCBgY29tcGlsZWRgLCBgY3JlYXRlZGAsIGB1cGRhdGVkYCxcbiAgICogICAgYGJvdW5kYCwgYW5kIGB1bmJvdW5kYC4gVGhlIGRlZmluaXRpb24gbWF5IGJlIGFuIGFjdHVhbCBzdWJjbGFzcyBvZiBCaW5kaW5nIG9yIGl0IG1heSBiZSBhbiBvYmplY3Qgd2hpY2ggd2lsbCBiZVxuICAgKiAgICB1c2VkIGZvciB0aGUgcHJvdG90eXBlIG9mIHRoZSBuZXdseSBjcmVhdGVkIHN1YmNsYXNzLiBGb3IgbWFueSBiaW5kaW5ncyBvbmx5IHRoZSBgdXBkYXRlZGAgbWV0aG9kIGlzIG92ZXJyaWRkZW4sXG4gICAqICAgIHNvIGJ5IGp1c3QgcGFzc2luZyBpbiBhIGZ1bmN0aW9uIGZvciBgZGVmaW5pdGlvbmAgdGhlIGJpbmRlciB3aWxsIGJlIGNyZWF0ZWQgd2l0aCB0aGF0IGFzIGl0cyBgdXBkYXRlZGAgbWV0aG9kLlxuICAgKlxuICAgKiAjIyMgRXhwbGFpbmF0aW9uIG9mIHByb3BlcnRpZXMgYW5kIG1ldGhvZHNcbiAgICpcbiAgICogICAqIGBwcmlvcml0eWAgbWF5IGJlIGRlZmluZWQgYXMgbnVtYmVyIHRvIGluc3RydWN0IHNvbWUgYmluZGVycyB0byBiZSBwcm9jZXNzZWQgYmVmb3JlIG90aGVycy4gQmluZGVycyB3aXRoXG4gICAqICAgaGlnaGVyIHByaW9yaXR5IGFyZSBwcm9jZXNzZWQgZmlyc3QuXG4gICAqXG4gICAqICAgKiBgYW5pbWF0ZWRgIGNhbiBiZSBzZXQgdG8gYHRydWVgIHRvIGV4dGVuZCB0aGUgQW5pbWF0ZWRCaW5kaW5nIGNsYXNzIHdoaWNoIHByb3ZpZGVzIHN1cHBvcnQgZm9yIGFuaW1hdGlvbiB3aGVuXG4gICAqICAgaW5zZXJ0aW5nYW5kIHJlbW92aW5nIG5vZGVzIGZyb20gdGhlIERPTS4gVGhlIGBhbmltYXRlZGAgcHJvcGVydHkgb25seSAqYWxsb3dzKiBhbmltYXRpb24gYnV0IHRoZSBlbGVtZW50IG11c3RcbiAgICogICBoYXZlIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIHRvIHVzZSBhbmltYXRpb24uIEEgYmluZGluZyB3aWxsIGhhdmUgdGhlIGBhbmltYXRlYCBwcm9wZXJ0eSBzZXQgdG8gdHJ1ZSB3aGVuIGl0IGlzXG4gICAqICAgdG8gYmUgYW5pbWF0ZWQuIEJpbmRlcnMgc2hvdWxkIGhhdmUgZmFzdCBwYXRocyBmb3Igd2hlbiBhbmltYXRpb24gaXMgbm90IHVzZWQgcmF0aGVyIHRoYW4gYXNzdW1pbmcgYW5pbWF0aW9uIHdpbGxcbiAgICogICBiZSB1c2VkLlxuICAgKlxuICAgKiBCaW5kZXJzXG4gICAqXG4gICAqIEEgYmluZGVyIGNhbiBoYXZlIDUgbWV0aG9kcyB3aGljaCB3aWxsIGJlIGNhbGxlZCBhdCB2YXJpb3VzIHBvaW50cyBpbiBhIGJpbmRpbmcncyBsaWZlY3ljbGUuIE1hbnkgYmluZGVycyB3aWxsXG4gICAqIG9ubHkgdXNlIHRoZSBgdXBkYXRlZCh2YWx1ZSlgIG1ldGhvZCwgc28gY2FsbGluZyByZWdpc3RlciB3aXRoIGEgZnVuY3Rpb24gaW5zdGVhZCBvZiBhbiBvYmplY3QgYXMgaXRzIHRoaXJkXG4gICAqIHBhcmFtZXRlciBpcyBhIHNob3J0Y3V0IHRvIGNyZWF0aW5nIGEgYmluZGVyIHdpdGgganVzdCBhbiBgdXBkYXRlYCBtZXRob2QuXG4gICAqXG4gICAqIExpc3RlZCBpbiBvcmRlciBvZiB3aGVuIHRoZXkgb2NjdXIgaW4gYSBiaW5kaW5nJ3MgbGlmZWN5Y2xlOlxuICAgKlxuICAgKiAgICogYGNvbXBpbGVkKG9wdGlvbnMpYCBpcyBjYWxsZWQgd2hlbiBmaXJzdCBjcmVhdGluZyBhIGJpbmRpbmcgZHVyaW5nIHRoZSB0ZW1wbGF0ZSBjb21waWxhdGlvbiBwcm9jZXNzIGFuZCByZWNlaXZlc1xuICAgKiB0aGUgYG9wdGlvbnNgIG9iamVjdCB0aGF0IHdpbGwgYmUgcGFzc2VkIGludG8gYG5ldyBCaW5kaW5nKG9wdGlvbnMpYC4gVGhpcyBjYW4gYmUgdXNlZCBmb3IgY3JlYXRpbmcgdGVtcGxhdGVzLFxuICAgKiBtb2RpZnlpbmcgdGhlIERPTSAob25seSBzdWJzZXF1ZW50IERPTSB0aGF0IGhhc24ndCBhbHJlYWR5IGJlZW4gcHJvY2Vzc2VkKSBhbmQgb3RoZXIgdGhpbmdzIHRoYXQgc2hvdWxkIGJlXG4gICAqIGFwcGxpZWQgYXQgY29tcGlsZSB0aW1lIGFuZCBub3QgZHVwbGljYXRlZCBmb3IgZWFjaCB2aWV3IGNyZWF0ZWQuXG4gICAqXG4gICAqICAgKiBgY3JlYXRlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiBhIG5ldyB2aWV3IGlzIGNyZWF0ZWQuIFRoaXMgY2FuIGJlIHVzZWQgdG8gYWRkIGV2ZW50IGxpc3RlbmVycyBvbiB0aGVcbiAgICogZWxlbWVudCBvciBkbyBvdGhlciB0aGluZ3MgdGhhdCB3aWxsIHBlcnNpc3RlIHdpdGggdGhlIHZpZXcgdGhyb3VnaCBpdHMgbWFueSB1c2VzLiBWaWV3cyBtYXkgZ2V0IHJldXNlZCBzbyBkb24ndFxuICAgKiBkbyBhbnl0aGluZyBoZXJlIHRvIHRpZSBpdCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqXG4gICAqICAgKiBgYXR0YWNoZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gdGhlIHZpZXcgaXMgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0IGFuZCBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXNcbiAgICogY2FuIGJlIHVzZWQgdG8gaGFuZGxlIGNvbnRleHQtc3BlY2lmaWMgYWN0aW9ucywgYWRkIGxpc3RlbmVycyB0byB0aGUgd2luZG93IG9yIGRvY3VtZW50ICh0byBiZSByZW1vdmVkIGluXG4gICAqIGBkZXRhY2hlZGAhKSwgZXRjLlxuICAgKlxuICAgKiAgICogYHVwZGF0ZWQodmFsdWUsIG9sZFZhbHVlLCBjaGFuZ2VSZWNvcmRzKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW5ldmVyIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB3aXRoaW5cbiAgICogdGhlIGF0dHJpYnV0ZSBjaGFuZ2VzLiBGb3IgZXhhbXBsZSwgYGJpbmQtdGV4dD1cInt7dXNlcm5hbWV9fVwiYCB3aWxsIHRyaWdnZXIgYHVwZGF0ZWRgIHdpdGggdGhlIHZhbHVlIG9mIHVzZXJuYW1lXG4gICAqIHdoZW5ldmVyIGl0IGNoYW5nZXMgb24gdGhlIGdpdmVuIGNvbnRleHQuIFdoZW4gdGhlIHZpZXcgaXMgcmVtb3ZlZCBgdXBkYXRlZGAgd2lsbCBiZSB0cmlnZ2VyZWQgd2l0aCBhIHZhbHVlIG9mXG4gICAqIGB1bmRlZmluZWRgIGlmIHRoZSB2YWx1ZSB3YXMgbm90IGFscmVhZHkgYHVuZGVmaW5lZGAsIGdpdmluZyBhIGNoYW5jZSB0byBcInJlc2V0XCIgdG8gYW4gZW1wdHkgc3RhdGUuXG4gICAqXG4gICAqICAgKiBgZGV0YWNoZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gdGhlIHZpZXcgaXMgdW5ib3VuZCB0byBhIGdpdmVuIGNvbnRleHQgYW5kIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzXG4gICAqIGNhbiBiZSB1c2VkIHRvIGNsZWFuIHVwIGFueXRoaW5nIGRvbmUgaW4gYGF0dGFjaGVkKClgIG9yIGluIGB1cGRhdGVkKClgIGJlZm9yZSBiZWluZyByZW1vdmVkLlxuICAgKlxuICAgKiBFbGVtZW50IGFuZCBhdHRyaWJ1dGUgYmluZGVycyB3aWxsIGFwcGx5IHdoZW5ldmVyIHRoZSB0YWcgbmFtZSBvciBhdHRyaWJ1dGUgbmFtZSBpcyBtYXRjaGVkLiBJbiB0aGUgY2FzZSBvZlxuICAgKiBhdHRyaWJ1dGUgYmluZGVycyBpZiB5b3Ugb25seSB3YW50IGl0IHRvIG1hdGNoIHdoZW4gZXhwcmVzc2lvbnMgYXJlIHVzZWQgd2l0aGluIHRoZSBhdHRyaWJ1dGUsIGFkZCBgb25seVdoZW5Cb3VuZGBcbiAgICogdG8gdGhlIGRlZmluaXRpb24uIE90aGVyd2lzZSB0aGUgYmluZGVyIHdpbGwgbWF0Y2ggYW5kIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB3aWxsIHNpbXBseSBiZSBhIHN0cmluZyB0aGF0XG4gICAqIG9ubHkgY2FsbHMgdXBkYXRlZCBvbmNlIHNpbmNlIGl0IHdpbGwgbm90IGNoYW5nZS5cbiAgICpcbiAgICogTm90ZSwgYXR0cmlidXRlcyB3aGljaCBtYXRjaCBhIGJpbmRlciBhcmUgcmVtb3ZlZCBkdXJpbmcgY29tcGlsZS4gVGhleSBhcmUgY29uc2lkZXJlZCB0byBiZSBiaW5kaW5nIGRlZmluaXRpb25zIGFuZFxuICAgKiBub3QgcGFydCBvZiB0aGUgZWxlbWVudC4gQmluZGluZ3MgbWF5IHNldCB0aGUgYXR0cmlidXRlIHdoaWNoIHNlcnZlZCBhcyB0aGVpciBkZWZpbml0aW9uIGlmIGRlc2lyZWQuXG4gICAqXG4gICAqICMjIyBEZWZhdWx0c1xuICAgKlxuICAgKiBUaGVyZSBhcmUgZGVmYXVsdCBiaW5kZXJzIGZvciBhdHRyaWJ1dGUgYW5kIHRleHQgbm9kZXMgd2hpY2ggYXBwbHkgd2hlbiBubyBvdGhlciBiaW5kZXJzIG1hdGNoLiBUaGV5IG9ubHkgYXBwbHkgdG9cbiAgICogYXR0cmlidXRlcyBhbmQgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW0gKGUuZy4gYHt7Zm9vfX1gKS4gVGhlIGRlZmF1bHQgaXMgdG8gc2V0IHRoZSBhdHRyaWJ1dGUgb3IgdGV4dFxuICAgKiBub2RlJ3MgdmFsdWUgdG8gdGhlIHJlc3VsdCBvZiB0aGUgZXhwcmVzc2lvbi4gSWYgeW91IHdhbnRlZCB0byBvdmVycmlkZSB0aGlzIGRlZmF1bHQgeW91IG1heSByZWdpc3RlciBhIGJpbmRlciB3aXRoXG4gICAqIHRoZSBuYW1lIGBcIl9fZGVmYXVsdF9fXCJgLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KiogVGhpcyBiaW5kaW5nIGhhbmRsZXIgYWRkcyBwaXJhdGVpemVkIHRleHQgdG8gYW4gZWxlbWVudC5cbiAgICogYGBgamF2YXNjcmlwdFxuICAgKiByZWdpc3RyeS5yZWdpc3RlckF0dHJpYnV0ZSgnbXktcGlyYXRlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykge1xuICAgKiAgICAgdmFsdWUgPSAnJztcbiAgICogICB9IGVsc2Uge1xuICAgKiAgICAgdmFsdWUgPSB2YWx1ZVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxCaW5nXFxiL2csIFwiaW4nXCIpXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXGJ0b1xcYi9nLCBcInQnXCIpXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXGJ5b3VcXGIvLCAneWUnKVxuICAgKiAgICAgICArICcgQXJycnIhJztcbiAgICogICB9XG4gICAqICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gdmFsdWU7XG4gICAqIH0pO1xuICAgKiBgYGBcbiAgICpcbiAgICogYGBgaHRtbFxuICAgKiA8cCBteS1waXJhdGU9XCJ7e3Bvc3QuYm9keX19XCI+VGhpcyB0ZXh0IHdpbGwgYmUgcmVwbGFjZWQuPC9wPlxuICAgKiBgYGBcbiAgICovXG4gIHJlZ2lzdGVyRWxlbWVudDogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCdlbGVtZW50JywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlclRleHQ6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlckJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHZhciBiaW5kZXIsIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV1cbiAgICB2YXIgc3VwZXJDbGFzcyA9IGRlZmluaXRpb24uYW5pbWF0ZWQgPyBBbmltYXRlZEJpbmRpbmcgOiBCaW5kaW5nO1xuXG4gICAgaWYgKCFiaW5kZXJzKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdgdHlwZWAgbXVzdCBiZSBvbmUgb2YgJyArIE9iamVjdC5rZXlzKHRoaXMuYmluZGVycykuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBkZWZpbml0aW9uID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBpZiAoZGVmaW5pdGlvbi5wcm90b3R5cGUgaW5zdGFuY2VvZiBCaW5kaW5nKSB7XG4gICAgICAgIHN1cGVyQ2xhc3MgPSBkZWZpbml0aW9uO1xuICAgICAgICBkZWZpbml0aW9uID0ge307XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWZpbml0aW9uID0geyB1cGRhdGVkOiBkZWZpbml0aW9uIH07XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgPT09ICdfX2RlZmF1bHRfXycgJiYgIWRlZmluaXRpb24uaGFzT3duUHJvcGVydHkoJ3ByaW9yaXR5JykpIHtcbiAgICAgIGRlZmluaXRpb24ucHJpb3JpdHkgPSAtMTAwO1xuICAgIH1cblxuICAgIC8vIENyZWF0ZSBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgKG9yIGFub3RoZXIgYmluZGVyKSB3aXRoIHRoZSBkZWZpbml0aW9uXG4gICAgZnVuY3Rpb24gQmluZGVyKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgICBkZWZpbml0aW9uLk9ic2VydmVyID0gdGhpcy5PYnNlcnZlcjtcbiAgICBzdXBlckNsYXNzLmV4dGVuZChCaW5kZXIsIGRlZmluaXRpb24pO1xuXG4gICAgdmFyIGV4cHI7XG4gICAgaWYgKG5hbWUgaW5zdGFuY2VvZiBSZWdFeHApIHtcbiAgICAgIGV4cHIgPSBuYW1lO1xuICAgIH0gZWxzZSBpZiAobmFtZS5pbmRleE9mKCcqJykgPj0gMCkge1xuICAgICAgZXhwciA9IG5ldyBSZWdFeHAoJ14nICsgZXNjYXBlUmVnRXhwKG5hbWUpLnJlcGxhY2UoJ1xcXFwqJywgJyguKiknKSArICckJyk7XG4gICAgfVxuXG4gICAgaWYgKGV4cHIpIHtcbiAgICAgIEJpbmRlci5leHByID0gZXhwcjtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5wdXNoKEJpbmRlcik7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMuc29ydCh0aGlzLmJpbmRpbmdTb3J0KTtcbiAgICB9XG5cbiAgICBCaW5kZXIubmFtZSA9ICcnICsgbmFtZTtcbiAgICBiaW5kZXJzW25hbWVdID0gQmluZGVyO1xuICAgIHJldHVybiBCaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIGJpbmRlciB0aGF0IHdhcyBhZGRlZCB3aXRoIGByZWdpc3RlcigpYC4gSWYgYW4gUmVnRXhwIHdhcyB1c2VkIGluIHJlZ2lzdGVyIGZvciB0aGUgbmFtZSBpdCBtdXN0IGJlIHVzZWRcbiAgICogdG8gdW5yZWdpc3RlciwgYnV0IGl0IGRvZXMgbm90IG5lZWQgdG8gYmUgdGhlIHNhbWUgaW5zdGFuY2UuXG4gICAqL1xuICB1bnJlZ2lzdGVyRWxlbWVudDogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlckF0dHJpYnV0ZTogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyVGV4dDogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLnVucmVnaXN0ZXJCaW5kZXIoJ3RleHQnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlckJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSkge1xuICAgIHZhciBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCBuYW1lKSwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcbiAgICBpZiAoIWJpbmRlcikgcmV0dXJuO1xuICAgIGlmIChiaW5kZXIuZXhwcikge1xuICAgICAgdmFyIGluZGV4ID0gYmluZGVycy5fd2lsZGNhcmRzLmluZGV4T2YoYmluZGVyKTtcbiAgICAgIGlmIChpbmRleCA+PSAwKSBiaW5kZXJzLl93aWxkY2FyZHMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICB9XG4gICAgZGVsZXRlIGJpbmRlcnNbbmFtZV07XG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZXR1cm5zIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgIGJ5IHR5cGUgYW5kIG5hbWUuXG4gICAqL1xuICBnZXRFbGVtZW50QmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdlbGVtZW50JywgbmFtZSk7XG4gIH0sXG4gIGdldEF0dHJpYnV0ZUJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIGdldFRleHRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ3RleHQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAobmFtZSAmJiBiaW5kZXJzLmhhc093blByb3BlcnR5KG5hbWUpKSB7XG4gICAgICByZXR1cm4gYmluZGVyc1tuYW1lXTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogRmluZCBhIG1hdGNoaW5nIGJpbmRlciBmb3IgdGhlIGdpdmVuIHR5cGUuIEVsZW1lbnRzIHNob3VsZCBvbmx5IHByb3ZpZGUgbmFtZS4gQXR0cmlidXRlcyBzaG91bGQgcHJvdmlkZSB0aGUgbmFtZVxuICAgKiBhbmQgdmFsdWUgKHZhbHVlIHNvIHRoZSBkZWZhdWx0IGNhbiBiZSByZXR1cm5lZCBpZiBhbiBleHByZXNzaW9uIGV4aXN0cyBpbiB0aGUgdmFsdWUpLiBUZXh0IG5vZGVzIHNob3VsZCBvbmx5XG4gICAqIHByb3ZpZGUgdGhlIHZhbHVlIChpbiBwbGFjZSBvZiB0aGUgbmFtZSkgYW5kIHdpbGwgcmV0dXJuIHRoZSBkZWZhdWx0IGlmIG5vIGJpbmRlcnMgbWF0Y2guXG4gICAqL1xuICBmaW5kQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlID09PSAndGV4dCcgJiYgdmFsdWUgPT0gbnVsbCkge1xuICAgICAgdmFsdWUgPSBuYW1lO1xuICAgICAgbmFtZSA9IHVuZGVmaW5lZDtcbiAgICB9XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuXG4gICAgaWYgKCFiaW5kZXIpIHtcbiAgICAgIHZhciB0b01hdGNoID0gKHR5cGUgPT09ICd0ZXh0JykgPyB2YWx1ZSA6IG5hbWU7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMuc29tZShmdW5jdGlvbih3aWxkY2FyZEJpbmRlcikge1xuICAgICAgICBpZiAodG9NYXRjaC5tYXRjaCh3aWxkY2FyZEJpbmRlci5leHByKSkge1xuICAgICAgICAgIGJpbmRlciA9IHdpbGRjYXJkQmluZGVyO1xuICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBpZiAoYmluZGVyICYmIHR5cGUgPT09ICdhdHRyaWJ1dGUnICYmIGJpbmRlci5wcm90b3R5cGUub25seVdoZW5Cb3VuZCAmJiAhdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkge1xuICAgICAgLy8gZG9uJ3QgdXNlIHRoZSBgdmFsdWVgIGJpbmRlciBpZiB0aGVyZSBpcyBubyBleHByZXNzaW9uIGluIHRoZSBhdHRyaWJ1dGUgdmFsdWUgKGUuZy4gYHZhbHVlPVwic29tZSB0ZXh0XCJgKVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChuYW1lID09PSB0aGlzLmFuaW1hdGVBdHRyaWJ1dGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAoIWJpbmRlciAmJiB2YWx1ZSAmJiAodHlwZSA9PT0gJ3RleHQnIHx8IHRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpKSB7XG4gICAgICAvLyBUZXN0IGlmIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgYm91bmQgKGUuZy4gYGhyZWY9XCIvcG9zdHMve3sgcG9zdC5pZCB9fVwiYClcbiAgICAgIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsICdfX2RlZmF1bHRfXycpO1xuICAgIH1cblxuICAgIHJldHVybiBiaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogQSBGb3JtYXR0ZXIgaXMgc3RvcmVkIHRvIHByb2Nlc3MgdGhlIHZhbHVlIG9mIGFuIGV4cHJlc3Npb24uIFRoaXMgYWx0ZXJzIHRoZSB2YWx1ZSBvZiB3aGF0IGNvbWVzIGluIHdpdGggYSBmdW5jdGlvblxuICAgKiB0aGF0IHJldHVybnMgYSBuZXcgdmFsdWUuIEZvcm1hdHRlcnMgYXJlIGFkZGVkIGJ5IHVzaW5nIGEgc2luZ2xlIHBpcGUgY2hhcmFjdGVyIChgfGApIGZvbGxvd2VkIGJ5IHRoZSBuYW1lIG9mIHRoZVxuICAgKiBmb3JtYXR0ZXIuIE11bHRpcGxlIGZvcm1hdHRlcnMgY2FuIGJlIHVzZWQgYnkgY2hhaW5pbmcgcGlwZXMgd2l0aCBmb3JtYXR0ZXIgbmFtZXMuIEZvcm1hdHRlcnMgbWF5IGFsc28gaGF2ZVxuICAgKiBhcmd1bWVudHMgcGFzc2VkIHRvIHRoZW0gYnkgdXNpbmcgdGhlIGNvbG9uIHRvIHNlcGFyYXRlIGFyZ3VtZW50cyBmcm9tIHRoZSBmb3JtYXR0ZXIgbmFtZS4gVGhlIHNpZ25hdHVyZSBvZiBhXG4gICAqIGZvcm1hdHRlciBzaG91bGQgYmUgYGZ1bmN0aW9uKHZhbHVlLCBhcmdzLi4uKWAgd2hlcmUgYXJncyBhcmUgZXh0cmEgcGFyYW1ldGVycyBwYXNzZWQgaW50byB0aGUgZm9ybWF0dGVyIGFmdGVyXG4gICAqIGNvbG9ucy5cbiAgICpcbiAgICogKkV4YW1wbGU6KlxuICAgKiBgYGBqc1xuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcigndXBwZXJjYXNlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUudG9VcHBlcmNhc2UoKVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcigncmVwbGFjZScsIGZ1bmN0aW9uKHZhbHVlLCByZXBsYWNlLCB3aXRoKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPSAnc3RyaW5nJykgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlLnJlcGxhY2UocmVwbGFjZSwgd2l0aClcbiAgICogfSlcbiAgICogYGBgaHRtbFxuICAgKiA8aDEgYmluZC10ZXh0PVwidGl0bGUgfCB1cHBlcmNhc2UgfCByZXBsYWNlOidMRVRURVInOidOVU1CRVInXCI+PC9oMT5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5HRVRUSU5HIFRPIEtOT1cgQUxMIEFCT1VUIFRIRSBOVU1CRVIgQTwvaDE+XG4gICAqIGBgYFxuICAgKiBUT0RPOiBvbGQgZG9jcywgcmV3cml0ZSwgdGhlcmUgaXMgYW4gZXh0cmEgYXJndW1lbnQgbmFtZWQgYHNldHRlcmAgd2hpY2ggd2lsbCBiZSB0cnVlIHdoZW4gdGhlIGV4cHJlc3Npb24gaXMgYmVpbmcgXCJzZXRcIiBpbnN0ZWFkIG9mIFwiZ2V0XCJcbiAgICogQSBgdmFsdWVGb3JtYXR0ZXJgIGlzIGxpa2UgYSBmb3JtYXR0ZXIgYnV0IHVzZWQgc3BlY2lmaWNhbGx5IHdpdGggdGhlIGB2YWx1ZWAgYmluZGluZyBzaW5jZSBpdCBpcyBhIHR3by13YXkgYmluZGluZy4gV2hlblxuICAgKiB0aGUgdmFsdWUgb2YgdGhlIGVsZW1lbnQgaXMgY2hhbmdlZCBhIGB2YWx1ZUZvcm1hdHRlcmAgY2FuIGFkanVzdCB0aGUgdmFsdWUgZnJvbSBhIHN0cmluZyB0byB0aGUgY29ycmVjdCB2YWx1ZSB0eXBlIGZvclxuICAgKiB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLiBUaGUgc2lnbmF0dXJlIGZvciBhIGB2YWx1ZUZvcm1hdHRlcmAgaW5jbHVkZXMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb25cbiAgICogYmVmb3JlIHRoZSBvcHRpb25hbCBhcmd1bWVudHMgKGlmIGFueSkuIFRoaXMgYWxsb3dzIGRhdGVzIHRvIGJlIGFkanVzdGVkIGFuZCBwb3NzaWJsZXkgb3RoZXIgdXNlcy5cbiAgICpcbiAgICogKkV4YW1wbGU6KlxuICAgKiBgYGBqc1xuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignbnVtZXJpYycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgLy8gdmFsdWUgY29taW5nIGZyb20gdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbiwgdG8gYmUgc2V0IG9uIHRoZSBlbGVtZW50XG4gICAqICAgaWYgKHZhbHVlID09IG51bGwgfHwgaXNOYU4odmFsdWUpKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWVcbiAgICogfSlcbiAgICpcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUtaG91cicsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgLy8gdmFsdWUgY29taW5nIGZyb20gdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbiwgdG8gYmUgc2V0IG9uIHRoZSBlbGVtZW50XG4gICAqICAgaWYgKCAhKGN1cnJlbnRWYWx1ZSBpbnN0YW5jZW9mIERhdGUpICkgcmV0dXJuICcnXG4gICAqICAgdmFyIGhvdXJzID0gdmFsdWUuZ2V0SG91cnMoKVxuICAgKiAgIGlmIChob3VycyA+PSAxMikgaG91cnMgLT0gMTJcbiAgICogICBpZiAoaG91cnMgPT0gMCkgaG91cnMgPSAxMlxuICAgKiAgIHJldHVybiBob3Vyc1xuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5OdW1iZXIgQXR0ZW5kaW5nOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiNFwiIGJpbmQtdmFsdWU9XCJldmVudC5hdHRlbmRlZUNvdW50IHwgbnVtZXJpY1wiPlxuICAgKiA8bGFiZWw+VGltZTo8L2xhYmVsPlxuICAgKiA8aW5wdXQgc2l6ZT1cIjJcIiBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtaG91clwiPiA6XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1taW51dGVcIj5cbiAgICogPHNlbGVjdCBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtYW1wbVwiPlxuICAgKiAgIDxvcHRpb24+QU08L29wdGlvbj5cbiAgICogICA8b3B0aW9uPlBNPC9vcHRpb24+XG4gICAqIDwvc2VsZWN0PlxuICAgKiBgYGBcbiAgICovXG4gIHJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSwgZm9ybWF0dGVyKSB7XG4gICAgdGhpcy5mb3JtYXR0ZXJzW25hbWVdID0gZm9ybWF0dGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGEgZm9ybWF0dGVyLlxuICAgKi9cbiAgdW5yZWdpc3RlckZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUsIGZvcm1hdHRlcikge1xuICAgIGRlbGV0ZSB0aGlzLmZvcm1hdHRlcnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogR2V0cyBhIHJlZ2lzdGVyZWQgZm9ybWF0dGVyLlxuICAgKi9cbiAgZ2V0Rm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSkge1xuICAgIHJldHVybiB0aGlzLmZvcm1hdHRlcnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogQW4gQW5pbWF0aW9uIGlzIHN0b3JlZCB0byBoYW5kbGUgYW5pbWF0aW9ucy4gQSByZWdpc3RlcmVkIGFuaW1hdGlvbiBpcyBhbiBvYmplY3QgKG9yIGNsYXNzIHdoaWNoIGluc3RhbnRpYXRlcyBpbnRvXG4gICAqIGFuIG9iamVjdCkgd2l0aCB0aGUgbWV0aG9kczpcbiAgICogICAqIGB3aWxsQW5pbWF0ZUluKGVsZW1lbnQpYFxuICAgKiAgICogYGFuaW1hdGVJbihlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZUluKGVsZW1lbnQpYFxuICAgKiAgICogYHdpbGxBbmltYXRlT3V0KGVsZW1lbnQpYFxuICAgKiAgICogYGFuaW1hdGVPdXQoZWxlbWVudCwgY2FsbGJhY2spYFxuICAgKiAgICogYGRpZEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqXG4gICAqIEFuaW1hdGlvbiBpcyBpbmNsdWRlZCB3aXRoIGJpbmRlcnMgd2hpY2ggYXJlIHJlZ2lzdGVyZWQgd2l0aCB0aGUgYGFuaW1hdGVkYCBwcm9wZXJ0eSBzZXQgdG8gYHRydWVgIChzdWNoIGFzIGBpZmBcbiAgICogYW5kIGByZXBlYXRgKS4gQW5pbWF0aW9ucyBhbGxvdyBlbGVtZW50cyB0byBmYWRlIGluLCBmYWRlIG91dCwgc2xpZGUgZG93biwgY29sbGFwc2UsIG1vdmUgZnJvbSBvbmUgbG9jYXRpb24gaW4gYVxuICAgKiBsaXN0IHRvIGFub3RoZXIsIGFuZCBtb3JlLlxuICAgKlxuICAgKiBUbyB1c2UgYW5pbWF0aW9uIGFkZCBhbiBhdHRyaWJ1dGUgbmFtZWQgYGFuaW1hdGVgIG9udG8gYW4gZWxlbWVudCB3aXRoIGEgc3VwcG9ydGVkIGJpbmRlci5cbiAgICpcbiAgICogIyMjIENTUyBBbmltYXRpb25zXG4gICAqXG4gICAqIElmIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGRvZXMgbm90IGhhdmUgYSB2YWx1ZSBvciB0aGUgdmFsdWUgaXMgYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW5cbiAgICogZnJhZ21lbnRzIHdpbGwgdXNlIGEgQ1NTIHRyYW5zaXRpb24vYW5pbWF0aW9uLiBDbGFzc2VzIHdpbGwgYmUgYWRkZWQgYW5kIHJlbW92ZWQgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uLlxuICAgKlxuICAgKiAgICogYC53aWxsLWFuaW1hdGUtaW5gIGlzIGFkZGVkIHJpZ2h0IGFmdGVyIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGVcbiAgICogICAgIG9wYWNpdHkgdG8gYDAuMGAgZm9yIGV4YW1wbGUuIEl0IGlzIHRoZW4gcmVtb3ZlZCBvbiB0aGUgbmV4dCBhbmltYXRpb24gZnJhbWUuXG4gICAqICAgKiBgLmFuaW1hdGUtaW5gIGlzIHdoZW4gYC53aWxsLWFuaW1hdGUtaW5gIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAxLjBgIGZvciBleGFtcGxlLiBUaGVcbiAgICogICAgIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUuIE5vdGUgdGhhdFxuICAgKiAgICAgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuIGVsZW1lbnQgd2l0aCB0aGUgYHJlcGVhdGAgYmluZGVyLCB0aGVzZSBjbGFzc2VzIGFyZSBhZGRlZCB0b1xuICAgKiAgICAgaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKiAgICogYC53aWxsLWFuaW1hdGUtb3V0YCBpcyBhZGRlZCBiZWZvcmUgYW4gZWxlbWVudCBpcyByZW1vdmVkIGZyb20gdGhlIERPTS4gVGhpcyBjYW4gYmUgdXNlZCB0byBzZXQgdGhlIG9wYWNpdHkgdG9cbiAgICogICAgIGAxYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIHdoZW4gYC53aWxsLWFuaW1hdGUtb3V0YCBpcyByZW1vdmVkLiBJdCBjYW4gYmUgdXNlZCB0byBzZXQgb3BhY2l0eSB0byBgMC4wYCBmb3JcbiAgICogICAgIGV4YW1wbGUuIFRoZSBgYW5pbWF0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IG9uIHRoaXMgY2xhc3MgaWYgdXNpbmcgaXQuIFRoZSBgdHJhbnNpdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBoZXJlIG9yXG4gICAqICAgICBvbiBhbm90aGVyIHNlbGVjdG9yIHRoYXQgbWF0Y2hlcyB0aGUgZWxlbWVudC4gTm90ZSB0aGF0IGFsdGhvdWdoIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHBsYWNlZCBvbiBhblxuICAgKiAgICAgZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvIGl0cyBjaGlsZHJlbiBhcyB0aGV5IGdldCBhZGRlZCBhbmQgcmVtb3ZlZC5cbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgc2V0IHRvIGEgY2xhc3MgbmFtZSAoZS5nLiBgYW5pbWF0ZT1cIi5teS1mYWRlXCJgKSB0aGVuIHRoYXQgY2xhc3MgbmFtZSB3aWxsIGJlIGFkZGVkIGFzXG4gICAqIGEgY2xhc3MgdG8gdGhlIGVsZW1lbnQgZHVyaW5nIGFuaW1hdGlvbi4gVGhpcyBhbGxvd3MgeW91IHRvIHVzZSBgLm15LWZhZGUud2lsbC1hbmltYXRlLWluYCwgYC5teS1mYWRlLmFuaW1hdGUtaW5gLFxuICAgKiBldGMuIGluIHlvdXIgc3R5bGVzaGVldHMgdG8gdXNlIHRoZSBzYW1lIGFuaW1hdGlvbiB0aHJvdWdob3V0IHlvdXIgYXBwbGljYXRpb24uXG4gICAqXG4gICAqICMjIyBKYXZhU2NyaXB0IEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgeW91IG5lZWQgZ3JlYXRlciBjb250cm9sIG92ZXIgeW91ciBhbmltYXRpb25zIEphdmFTY3JpcHQgbWF5IGJlIHVzZWQuIEl0IGlzIHJlY29tbWVuZGVkIHRoYXQgQ1NTIHN0eWxlcyBzdGlsbCBiZVxuICAgKiB1c2VkIGJ5IGhhdmluZyB5b3VyIGNvZGUgc2V0IHRoZW0gbWFudWFsbHkuIFRoaXMgYWxsb3dzIHRoZSBhbmltYXRpb24gdG8gdGFrZSBhZHZhbnRhZ2Ugb2YgdGhlIGJyb3dzZXJcbiAgICogb3B0aW1pemF0aW9ucyBzdWNoIGFzIGhhcmR3YXJlIGFjY2VsZXJhdGlvbi4gVGhpcyBpcyBub3QgYSByZXF1aXJlbWVudC5cbiAgICpcbiAgICogSW4gb3JkZXIgdG8gdXNlIEphdmFTY3JpcHQgYW4gb2JqZWN0IHNob3VsZCBiZSBwYXNzZWQgaW50byB0aGUgYGFuaW1hdGlvbmAgYXR0cmlidXRlIHVzaW5nIGFuIGV4cHJlc3Npb24uIFRoaXNcbiAgICogb2JqZWN0IHNob3VsZCBoYXZlIG1ldGhvZHMgdGhhdCBhbGxvdyBKYXZhU2NyaXB0IGFuaW1hdGlvbiBoYW5kbGluZy4gRm9yIGV4YW1wbGUsIGlmIHlvdSBhcmUgYm91bmQgdG8gYSBjb250ZXh0XG4gICAqIHdpdGggYW4gb2JqZWN0IG5hbWVkIGBjdXN0b21GYWRlYCB3aXRoIGFuaW1hdGlvbiBtZXRob2RzLCB5b3VyIGVsZW1lbnQgc2hvdWxkIGhhdmUgYGF0dHJpYnV0ZT1cInt7Y3VzdG9tRmFkZX19XCJgLlxuICAgKiBUaGUgZm9sbG93aW5nIGlzIGEgbGlzdCBvZiB0aGUgbWV0aG9kcyB5b3UgbWF5IGltcGxlbWVudC5cbiAgICpcbiAgICogICAqIGB3aWxsQW5pbWF0ZUluKGVsZW1lbnQpYCB3aWxsIGJlIGNhbGxlZCBhZnRlciBhbiBlbGVtZW50IGhhcyBiZWVuIGluc2VydGVkIGludG8gdGhlIERPTS4gVXNlIGl0IHRvIHNldCBpbml0aWFsXG4gICAqICAgICBDU1MgcHJvcGVydGllcyBiZWZvcmUgYGFuaW1hdGVJbmAgaXMgY2FsbGVkIHRvIHNldCB0aGUgZmluYWwgcHJvcGVydGllcy4gVGhpcyBtZXRob2QgaXMgb3B0aW9uYWwuXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWAgd2lsbCBiZSBjYWxsZWQgc2hvcnRseSBhZnRlciBgd2lsbEFuaW1hdGVJbmAgaWYgaXQgd2FzIGRlZmluZWQuIFVzZSBpdCB0byBzZXRcbiAgICogICAgIGZpbmFsIENTUyBwcm9wZXJ0aWVzLlxuICAgKiAgICogYGFuaW1hdGVPdXQoZWxlbWVudCwgZG9uZSlgIHdpbGwgYmUgY2FsbGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHRvIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBgZG9uZWAgbXVzdCBiZVxuICAgKiAgICAgY2FsbGVkIHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZSBpbiBvcmRlciBmb3IgdGhlIGJpbmRlciB0byBmaW5pc2ggcmVtb3ZpbmcgdGhlIGVsZW1lbnQuICoqUmVtZW1iZXIqKiB0b1xuICAgKiAgICAgY2xlYW4gdXAgYnkgcmVtb3ZpbmcgYW55IHN0eWxlcyB0aGF0IHdlcmUgYWRkZWQgYmVmb3JlIGNhbGxpbmcgYGRvbmUoKWAgc28gdGhlIGVsZW1lbnQgY2FuIGJlIHJldXNlZCB3aXRob3V0XG4gICAqICAgICBzaWRlLWVmZmVjdHMuXG4gICAqXG4gICAqIFRoZSBgZWxlbWVudGAgcGFzc2VkIGluIHdpbGwgYmUgcG9seWZpbGxlZCBmb3Igd2l0aCB0aGUgYGFuaW1hdGVgIG1ldGhvZCB1c2luZ1xuICAgKiBodHRwczovL2dpdGh1Yi5jb20vd2ViLWFuaW1hdGlvbnMvd2ViLWFuaW1hdGlvbnMtanMuXG4gICAqXG4gICAqICMjIyBSZWdpc3RlcmVkIEFuaW1hdGlvbnNcbiAgICpcbiAgICogQW5pbWF0aW9ucyBtYXkgYmUgcmVnaXN0ZXJlZCBhbmQgdXNlZCB0aHJvdWdob3V0IHlvdXIgYXBwbGljYXRpb24uIFRvIHVzZSBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIHVzZSBpdHMgbmFtZSBpblxuICAgKiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSAoZS5nLiBgYW5pbWF0ZT1cImZhZGVcImApLiBOb3RlIHRoZSBvbmx5IGRpZmZlcmVuY2UgYmV0d2VlbiBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGFuZCBhXG4gICAqIGNsYXNzIHJlZ2lzdHJhdGlvbiBpcyBjbGFzcyByZWdpc3RyYXRpb25zIGFyZSBwcmVmaXhlZCB3aXRoIGEgZG90IChgLmApLiBSZWdpc3RlcmVkIGFuaW1hdGlvbnMgYXJlIGFsd2F5c1xuICAgKiBKYXZhU2NyaXB0IGFuaW1hdGlvbnMuIFRvIHJlZ2lzdGVyIGFuIGFuaW1hdGlvbiB1c2UgYGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lLCBhbmltYXRpb25PYmplY3QpYC5cbiAgICpcbiAgICogVGhlIEFuaW1hdGlvbiBtb2R1bGUgY29tZXMgd2l0aCBzZXZlcmFsIGNvbW1vbiBhbmltYXRpb25zIHJlZ2lzdGVyZWQgYnkgZGVmYXVsdC4gVGhlIGRlZmF1bHRzIHVzZSBDU1Mgc3R5bGVzIHRvXG4gICAqIHdvcmsgY29ycmVjdGx5LCB1c2luZyBgZWxlbWVudC5hbmltYXRlYC5cbiAgICpcbiAgICogICAqIGBmYWRlYCB3aWxsIGZhZGUgYW4gZWxlbWVudCBpbiBhbmQgb3V0IG92ZXIgMzAwIG1pbGxpc2Vjb25kcy5cbiAgICogICAqIGBzbGlkZWAgd2lsbCBzbGlkZSBhbiBlbGVtZW50IGRvd24gd2hlbiBpdCBpcyBhZGRlZCBhbmQgc2xpZGUgaXQgdXAgd2hlbiBpdCBpcyByZW1vdmVkLlxuICAgKiAgICogYHNsaWRlLW1vdmVgIHdpbGwgbW92ZSBhbiBlbGVtZW50IGZyb20gaXRzIG9sZCBsb2NhdGlvbiB0byBpdHMgbmV3IGxvY2F0aW9uIGluIGEgcmVwZWF0ZWQgbGlzdC5cbiAgICpcbiAgICogRG8geW91IGhhdmUgYW5vdGhlciBjb21tb24gYW5pbWF0aW9uIHlvdSB0aGluayBzaG91bGQgYmUgaW5jbHVkZWQgYnkgZGVmYXVsdD8gU3VibWl0IGEgcHVsbCByZXF1ZXN0IVxuICAgKi9cbiAgcmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdCkge1xuICAgIHRoaXMuYW5pbWF0aW9uc1tuYW1lXSA9IGFuaW1hdGlvbk9iamVjdDtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbiBhbmltYXRpb24uXG4gICAqL1xuICB1bnJlZ2lzdGVyQW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgZGVsZXRlIHRoaXMuYW5pbWF0aW9uc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24uXG4gICAqL1xuICBnZXRBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFByZXBhcmUgYW4gZWxlbWVudCB0byBiZSBlYXNpZXIgYW5pbWF0YWJsZSAoYWRkaW5nIGEgc2ltcGxlIGBhbmltYXRlYCBwb2x5ZmlsbCBpZiBuZWVkZWQpXG4gICAqL1xuICBtYWtlRWxlbWVudEFuaW1hdGFibGU6IGFuaW1hdGlvbi5tYWtlRWxlbWVudEFuaW1hdGFibGUsXG5cblxuICAvKipcbiAgICogU2V0cyB0aGUgZGVsaW1pdGVycyB0aGF0IGRlZmluZSBhbiBleHByZXNzaW9uLiBEZWZhdWx0IGlzIGB7e2AgYW5kIGB9fWAgYnV0IHRoaXMgbWF5IGJlIG92ZXJyaWRkZW4uIElmIGVtcHR5XG4gICAqIHN0cmluZ3MgYXJlIHBhc3NlZCBpbiAoZm9yIHR5cGUgXCJhdHRyaWJ1dGVcIiBvbmx5KSB0aGVuIG5vIGRlbGltaXRlcnMgYXJlIHJlcXVpcmVkIGZvciBtYXRjaGluZyBhdHRyaWJ1dGVzLCBidXQgdGhlXG4gICAqIGRlZmF1bHQgYXR0cmlidXRlIG1hdGNoZXIgd2lsbCBub3QgYXBwbHkgdG8gdGhlIHJlc3Qgb2YgdGhlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZXRFeHByZXNzaW9uRGVsaW1pdGVyczogZnVuY3Rpb24odHlwZSwgcHJlLCBwb3N0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRXhwcmVzc2lvbiBkZWxpbWl0ZXJzIG11c3QgYmUgb2YgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByID0gbmV3IFJlZ0V4cChlc2NhcGVSZWdFeHAocHJlKSArICcoLio/KScgKyBlc2NhcGVSZWdFeHAocG9zdCksICdnJyk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVGVzdHMgd2hldGhlciBhIHZhbHVlIGhhcyBhbiBleHByZXNzaW9uIGluIGl0LiBTb21ldGhpbmcgbGlrZSBgL3VzZXIve3t1c2VyLmlkfX1gLlxuICAgKi9cbiAgaXNCb3VuZDogZnVuY3Rpb24odHlwZSwgdmFsdWUpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpc0JvdW5kIG11c3QgcHJvdmlkZSB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG4gICAgdmFyIGV4cHIgPSB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHI7XG4gICAgcmV0dXJuIEJvb2xlYW4oZXhwciAmJiB2YWx1ZSAmJiB2YWx1ZS5tYXRjaChleHByKSk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVGhlIHNvcnQgZnVuY3Rpb24gdG8gc29ydCBiaW5kZXJzIGNvcnJlY3RseVxuICAgKi9cbiAgYmluZGluZ1NvcnQ6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gYi5wcm90b3R5cGUucHJpb3JpdHkgLSBhLnByb3RvdHlwZS5wcmlvcml0eTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhbiBpbnZlcnRlZCBleHByZXNzaW9uIGZyb20gYC91c2VyL3t7dXNlci5pZH19YCB0byBgXCIvdXNlci9cIiArIHVzZXIuaWRgXG4gICAqL1xuICBjb2RpZnlFeHByZXNzaW9uOiBmdW5jdGlvbih0eXBlLCB0ZXh0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29kaWZ5RXhwcmVzc2lvbiBtdXN0IHVzZSB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG5cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICB2YXIgbWF0Y2ggPSB0ZXh0Lm1hdGNoKGV4cHIpO1xuXG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgcmV0dXJuICdcIicgKyB0ZXh0LnJlcGxhY2UoL1wiL2csICdcXFxcXCInKSArICdcIic7XG4gICAgfSBlbHNlIGlmIChtYXRjaC5sZW5ndGggPT09IDEgJiYgbWF0Y2hbMF0gPT09IHRleHQpIHtcbiAgICAgIHJldHVybiB0ZXh0LnJlcGxhY2UoZXhwciwgJyQxJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBuZXdUZXh0ID0gJ1wiJywgbGFzdEluZGV4ID0gMDtcbiAgICAgIHdoaWxlIChtYXRjaCA9IGV4cHIuZXhlYyh0ZXh0KSkge1xuICAgICAgICB2YXIgc3RyID0gdGV4dC5zbGljZShsYXN0SW5kZXgsIGV4cHIubGFzdEluZGV4IC0gbWF0Y2hbMF0ubGVuZ3RoKTtcbiAgICAgICAgbmV3VGV4dCArPSBzdHIucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpO1xuICAgICAgICBuZXdUZXh0ICs9ICdcIiArICgnICsgbWF0Y2hbMV0gKyAnIHx8IFwiXCIpICsgXCInO1xuICAgICAgICBsYXN0SW5kZXggPSBleHByLmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIG5ld1RleHQgKz0gdGV4dC5zbGljZShsYXN0SW5kZXgpLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKSArICdcIic7XG4gICAgICByZXR1cm4gbmV3VGV4dC5yZXBsYWNlKC9eXCJcIiBcXCsgfCBcIlwiIFxcKyB8IFxcKyBcIlwiJC9nLCAnJyk7XG4gICAgfVxuICB9XG5cbn07XG5cbi8vIFRha2VzIGEgc3RyaW5nIGxpa2UgXCIoXFwqKVwiIG9yIFwib24tXFwqXCIgYW5kIGNvbnZlcnRzIGl0IGludG8gYSByZWd1bGFyIGV4cHJlc3Npb24uXG5mdW5jdGlvbiBlc2NhcGVSZWdFeHAodGV4dCkge1xuICByZXR1cm4gdGV4dC5yZXBsYWNlKC9bLVtcXF17fSgpKis/LixcXFxcXiR8I1xcc10vZywgXCJcXFxcJCZcIik7XG59XG4iLCIvLyBpbnNwaXJlZCBmcm9tIHpvbmUuanMsIGJ1dCB3aXRob3V0IGJlaW5nIGFzIGNvbXByZWhlbnNpdmUgb3IgaW50cnVzaXZlIChpLmUuIGF2b2lkaW5nIGdsb2JhbCBzY29wZSlcblxuLy8gUnVuIGEgZnVuY3Rpb24gaW4gdGhlIGNvbnRleHQgb2YgZnJhZ21lbnRzXG5leHBvcnRzLnJ1biA9IHJ1bjtcblxuLy8gUmV0dXJuIGEgbmV3IGZ1bmN0aW9uIHdoaWNoIHdpbGwgcnVuIGluIHRoZSBjb250ZXh0IG9mIGZyYWdtZW50c1xuZXhwb3J0cy53cmFwID0gd3JhcDtcblxuLy8gUmV0dXJuIGEgcHJveHkgZm9yIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCB3cmFwIGFueSBmdW5jdGlvbiBhcmd1bWVudHMgcGFzc2VkIHRvIGl0XG5leHBvcnRzLnByb3h5ID0gcHJveHk7XG5cbi8vIFNraXAgT2JzZXJ2ZXIuc3luYyBvbiB0aGUgbmV4dCBpbnZvY2F0aW9uIHRoZSBjb250ZXh0LiBUaGlzIGlzIHJlYWxseSBqdXN0IGZvciBvYnNlcnZlciB0byBydW4gYW5kIG5vdCBnZXQgaW50b1xuLy8gYSBsb29wXG5leHBvcnRzLnNraXBOZXh0U3luYyA9IGZ1bmN0aW9uKCkge1xuICBza2lwTmV4dCA9IHRydWU7XG59O1xuXG5cbnZhciBPYnNlcnZlciA9IHJlcXVpcmUoJy4vb2JzZXJ2ZXInKTtcbnZhciBwYXRjaGVkID0gZmFsc2U7XG52YXIgc2tpcE5leHQgPSBmYWxzZTtcbnZhciB3cmFwcGVkS2V5ID0gKHR5cGVvZiBTeW1ib2wgIT09ICd1bmRlZmluZWQnKSA/IFN5bWJvbCgnd3JhcHBlZCcpIDogJ196b25lanIkd3JhcHBlZCc7XG52YXIgZWxlbWVudENhbGxiYWNrcyA9IFtcbiAgJ2NyZWF0ZWRDYWxsYmFjaycsXG4gICdhdHRhY2hlZENhbGxiYWNrJyxcbiAgJ2RldGFjaGVkQ2FsbGJhY2snLFxuICAnYXR0cmlidXRlQ2hhbmdlZENhbGxiYWNrJ1xuXTtcblxuXG5mdW5jdGlvbiBydW4oZnVuYykge1xuICByZXR1cm4gd3JhcChmdW5jKSgpO1xufVxuXG5mdW5jdGlvbiB3cmFwKGZ1bmMpIHtcbiAgaWYgKHR5cGVvZiBmdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcmV0dXJuIGZ1bmM7XG4gIH0gZWxzZSBpZiAoIWZ1bmNbd3JhcHBlZEtleV0pIHtcbiAgICBmdW5jW3dyYXBwZWRLZXldID0gZnVuY3Rpb24oKSB7XG4gICAgICBpZiAocGF0Y2hlZCkge1xuICAgICAgICByZXR1cm4gZnVuYy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgfVxuXG4gICAgICBwYXRjaCgpO1xuICAgICAgdmFyIHJlc3VsdCA9IGZ1bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIGlmIChza2lwTmV4dCkge1xuICAgICAgICBza2lwTmV4dCA9IGZhbHNlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgT2JzZXJ2ZXIuc3luYygpO1xuICAgICAgfVxuICAgICAgdW5wYXRjaCgpO1xuICAgICAgcmV0dXJuIHJlc3VsdDtcbiAgICB9O1xuICAgIGZ1bmNbd3JhcHBlZEtleV1bd3JhcHBlZEtleV0gPSBmdW5jW3dyYXBwZWRLZXldO1xuICB9XG4gIHJldHVybiBmdW5jW3dyYXBwZWRLZXldO1xufVxuXG5mdW5jdGlvbiBwcm94eShtZXRob2QpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAodHlwZW9mIGFyZ3VtZW50c1tpXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBhcmd1bWVudHNbaV0gPSB3cmFwKGFyZ3VtZW50c1tpXSk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBtZXRob2QuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfTtcbn1cblxuZnVuY3Rpb24gcHJveHlDbGFzcyhPcmlnaW5hbENsYXNzLCBldmVudE5hbWVzKSB7XG4gIGlmICghZXZlbnROYW1lcykge1xuICAgIGV2ZW50TmFtZXMgPSBbXTtcbiAgICB2YXIgaW5zdGFuY2UgPSBuZXcgT3JpZ2luYWxDbGFzcygpO1xuICAgIGZvciAodmFyIGkgaW4gaW5zdGFuY2UpIHtcbiAgICAgIGlmIChpLnNsaWNlKDAsIDIpID09PSAnb24nICYmIGluc3RhbmNlW2ldID09PSBudWxsICYmIGkudG9Mb3dlckNhc2UoKSA9PT0gaSkge1xuICAgICAgICBldmVudE5hbWVzLnB1c2goaSk7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZ1bmN0aW9uKCkge1xuICAgIHZhciBvYmosIGEgPSBhcmd1bWVudHM7XG4gICAgc3dpdGNoIChhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgICBjYXNlIDA6IG9iaiA9IG5ldyBPcmlnaW5hbENsYXNzKCk7IGJyZWFrO1xuICAgICAgY2FzZSAxOiBvYmogPSBuZXcgT3JpZ2luYWxDbGFzcyhhWzBdKTsgYnJlYWs7XG4gICAgICBjYXNlIDI6IG9iaiA9IG5ldyBPcmlnaW5hbENsYXNzKGFbMF0sIGFbMV0pOyBicmVhaztcbiAgICAgIGNhc2UgMzogb2JqID0gbmV3IE9yaWdpbmFsQ2xhc3MoYVswXSwgYVsxXSwgYVsyXSk7IGJyZWFrO1xuICAgICAgY2FzZSA0OiBvYmogPSBuZXcgT3JpZ2luYWxDbGFzcyhhWzBdLCBhWzFdLCBhWzJdLCBhWzNdKTsgYnJlYWs7XG4gICAgICBkZWZhdWx0OiB0aHJvdyBuZXcgRXJyb3IoJ3doYXQgYXJlIHlvdSBldmVuIGRvaW5nPycpO1xuICAgIH1cblxuICAgIGV2ZW50TmFtZXMuZm9yRWFjaChmdW5jdGlvbihwcm9wZXJ0eSkge1xuICAgICAgdmFyIGV2ZW50TmFtZSA9IHByb3BlcnR5LnNsaWNlKDIpO1xuICAgICAgdmFyIGhhbmRsZXI7XG5cbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShvYmosIHByb3BlcnR5LCB7XG4gICAgICAgIGVudW1lcmFibGU6IHRydWUsXG4gICAgICAgIGNvbmZpZ3VyYWJsZTogdHJ1ZSxcbiAgICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIGlmIChoYW5kbGVyKSB7XG4gICAgICAgICAgICB0aGlzLnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCB3cmFwKGhhbmRsZXIpKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgaGFuZGxlciA9IHZhbHVlO1xuICAgICAgICAgIGlmIChoYW5kbGVyKSB7XG4gICAgICAgICAgICB0aGlzLmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCB3cmFwKGhhbmRsZXIpKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0sXG4gICAgICAgIGdldDogZnVuY3Rpb24oKSB7XG4gICAgICAgICAgcmV0dXJuIGhhbmRsZXI7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgcmV0dXJuIG9iajtcbiAgfTtcbn1cblxuXG5mdW5jdGlvbiBwYXRjaCgpIHtcbiAgcGF0Y2hlZCA9IHRydWU7XG4gIHdpbmRvdy5zZXRUaW1lb3V0ID0gcGF0Y2hlcy5zZXRUaW1lb3V0O1xuICB3aW5kb3cuc2V0SW50ZXJ2YWwgPSBwYXRjaGVzLnNldEludGVydmFsO1xuICB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gcGF0Y2hlcy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWU7XG4gIEV2ZW50VGFyZ2V0LnByb3RvdHlwZS5hZGRFdmVudExpc3RlbmVyID0gcGF0Y2hlcy5hZGRFdmVudExpc3RlbmVyO1xuICBFdmVudFRhcmdldC5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IHBhdGNoZXMucmVtb3ZlRXZlbnRMaXN0ZW5lcjtcbiAgUHJvbWlzZS5wcm90b3R5cGUudGhlbiA9IHBhdGNoZXMudGhlbjtcbiAgUHJvbWlzZS5wcm90b3R5cGUuY2F0Y2ggPSBwYXRjaGVzLmNhdGNoO1xuICBkb2N1bWVudC5yZWdpc3RlckVsZW1lbnQgPSBwYXRjaGVzLnJlZ2lzdGVyRWxlbWVudDtcbiAgd2luZG93LldlYlNvY2tldCA9IHBhdGNoZXMuV2ViU29ja2V0O1xufVxuXG5cbmZ1bmN0aW9uIHVucGF0Y2goKSB7XG4gIHdpbmRvdy5zZXRUaW1lb3V0ID0gb3JpZ2luYWxzLnNldFRpbWVvdXQ7XG4gIHdpbmRvdy5zZXRJbnRlcnZhbCA9IG9yaWdpbmFscy5zZXRJbnRlcnZhbDtcbiAgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA9IG9yaWdpbmFscy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWU7XG4gIEV2ZW50VGFyZ2V0LnByb3RvdHlwZS5hZGRFdmVudExpc3RlbmVyID0gb3JpZ2luYWxzLmFkZEV2ZW50TGlzdGVuZXI7XG4gIEV2ZW50VGFyZ2V0LnByb3RvdHlwZS5yZW1vdmVFdmVudExpc3RlbmVyID0gb3JpZ2luYWxzLnJlbW92ZUV2ZW50TGlzdGVuZXI7XG4gIFByb21pc2UucHJvdG90eXBlLnRoZW4gPSBvcmlnaW5hbHMudGhlbjtcbiAgUHJvbWlzZS5wcm90b3R5cGUuY2F0Y2ggPSBvcmlnaW5hbHMuY2F0Y2g7XG4gIGRvY3VtZW50LnJlZ2lzdGVyRWxlbWVudCA9IG9yaWdpbmFscy5yZWdpc3RlckVsZW1lbnQ7XG4gIHdpbmRvdy5XZWJTb2NrZXQgPSBvcmlnaW5hbHMuV2ViU29ja2V0O1xuICBwYXRjaGVkID0gZmFsc2U7XG59XG5cblxudmFyIG9yaWdpbmFscyA9IHtcbiAgc2V0VGltZW91dDogd2luZG93LnNldFRpbWVvdXQsXG4gIHNldEludGVydmFsOiB3aW5kb3cuc2V0SW50ZXJ2YWwsXG4gIHJlcXVlc3RBbmltYXRpb25GcmFtZTogd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSxcbiAgYWRkRXZlbnRMaXN0ZW5lcjogRXZlbnRUYXJnZXQucHJvdG90eXBlLmFkZEV2ZW50TGlzdGVuZXIsXG4gIHJlbW92ZUV2ZW50TGlzdGVuZXI6IEV2ZW50VGFyZ2V0LnByb3RvdHlwZS5yZW1vdmVFdmVudExpc3RlbmVyLFxuICB0aGVuOiBQcm9taXNlLnByb3RvdHlwZS50aGVuLFxuICBjYXRjaDogUHJvbWlzZS5wcm90b3R5cGUuY2F0Y2gsXG4gIHJlZ2lzdGVyRWxlbWVudDogZG9jdW1lbnQucmVnaXN0ZXJFbGVtZW50LFxuICBYTUxIdHRwUmVxdWVzdDogd2luZG93LlhNTEh0dHBSZXF1ZXN0LFxuICBXZWJTb2NrZXQ6IHdpbmRvdy5XZWJTb2NrZXRcbn07XG5cblxudmFyIHBhdGNoZXMgPSB7XG4gIHNldFRpbWVvdXQ6IHByb3h5KG9yaWdpbmFscy5zZXRUaW1lb3V0KSxcbiAgc2V0SW50ZXJ2YWw6IHByb3h5KG9yaWdpbmFscy5zZXRJbnRlcnZhbCksXG4gIHJlcXVlc3RBbmltYXRpb25GcmFtZTogcHJveHkob3JpZ2luYWxzLnJlcXVlc3RBbmltYXRpb25GcmFtZSksXG4gIGFkZEV2ZW50TGlzdGVuZXI6IHByb3h5KG9yaWdpbmFscy5hZGRFdmVudExpc3RlbmVyKSxcbiAgcmVtb3ZlRXZlbnRMaXN0ZW5lcjogcHJveHkob3JpZ2luYWxzLnJlbW92ZUV2ZW50TGlzdGVuZXIpLFxuICB0aGVuOiBwcm94eShvcmlnaW5hbHMudGhlbiksXG4gIGNhdGNoOiBwcm94eShvcmlnaW5hbHMuY2F0Y2gpLFxuICBYTUxIdHRwUmVxdWVzdDogcHJveHlDbGFzcyhvcmlnaW5hbHMuWE1MSHR0cFJlcXVlc3QpLFxuICBXZWJTb2NrZXQ6IHByb3h5Q2xhc3Mob3JpZ2luYWxzLldlYlNvY2tldCwgWydvbm1lc3NhZ2UnXSlcbn07XG4iLCIvKlxuQ29weXJpZ2h0IChjKSAyMDE1IEphY29iIFdyaWdodCA8amFjd3JpZ2h0QGdtYWlsLmNvbT5cblxuUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxub2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xudG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG5mdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuXG5UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG5cblRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbklNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG5BVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG5MSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuVEhFIFNPRlRXQVJFLlxuKi9cbi8vICMgRGlmZlxuLy8gPiBCYXNlZCBvbiB3b3JrIGZyb20gR29vZ2xlJ3Mgb2JzZXJ2ZS1qcyBwb2x5ZmlsbDogaHR0cHM6Ly9naXRodWIuY29tL1BvbHltZXIvb2JzZXJ2ZS1qc1xuXG4vLyBBIG5hbWVzcGFjZSB0byBzdG9yZSB0aGUgZnVuY3Rpb25zIG9uXG52YXIgZGlmZiA9IGV4cG9ydHM7XG5cbihmdW5jdGlvbigpIHtcblxuICBkaWZmLmNsb25lID0gY2xvbmU7XG4gIGRpZmYudmFsdWVzID0gZGlmZlZhbHVlcztcbiAgZGlmZi5iYXNpYyA9IGRpZmZCYXNpYztcbiAgZGlmZi5vYmplY3RzID0gZGlmZk9iamVjdHM7XG4gIGRpZmYuYXJyYXlzID0gZGlmZkFycmF5cztcblxuXG4gIC8vIEEgY2hhbmdlIHJlY29yZCBmb3IgdGhlIG9iamVjdCBjaGFuZ2VzXG4gIGZ1bmN0aW9uIENoYW5nZVJlY29yZChvYmplY3QsIHR5cGUsIG5hbWUsIG9sZFZhbHVlKSB7XG4gICAgdGhpcy5vYmplY3QgPSBvYmplY3Q7XG4gICAgdGhpcy50eXBlID0gdHlwZTtcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMub2xkVmFsdWUgPSBvbGRWYWx1ZTtcbiAgfVxuXG4gIC8vIEEgc3BsaWNlIHJlY29yZCBmb3IgdGhlIGFycmF5IGNoYW5nZXNcbiAgZnVuY3Rpb24gU3BsaWNlKGluZGV4LCByZW1vdmVkLCBhZGRlZENvdW50KSB7XG4gICAgdGhpcy5pbmRleCA9IGluZGV4O1xuICAgIHRoaXMucmVtb3ZlZCA9IHJlbW92ZWQ7XG4gICAgdGhpcy5hZGRlZENvdW50ID0gYWRkZWRDb3VudDtcbiAgfVxuXG5cbiAgLy8gQ3JlYXRlcyBhIGNsb25lIG9yIGNvcHkgb2YgYW4gYXJyYXkgb3Igb2JqZWN0IChvciBzaW1wbHkgcmV0dXJucyBhIHN0cmluZy9udW1iZXIvYm9vbGVhbiB3aGljaCBhcmUgaW1tdXRhYmxlKVxuICAvLyBEb2VzIG5vdCBwcm92aWRlIGRlZXAgY29waWVzLlxuICBmdW5jdGlvbiBjbG9uZSh2YWx1ZSwgZGVlcCkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLm1hcChmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICAgIHJldHVybiBjbG9uZSh2YWx1ZSwgZGVlcCk7XG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlLnNsaWNlKCk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICBpZiAodmFsdWUudmFsdWVPZigpICE9PSB2YWx1ZSkge1xuICAgICAgICByZXR1cm4gbmV3IHZhbHVlLmNvbnN0cnVjdG9yKHZhbHVlLnZhbHVlT2YoKSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgY29weSA9IHt9O1xuICAgICAgICBmb3IgKHZhciBrZXkgaW4gdmFsdWUpIHtcbiAgICAgICAgICB2YXIgb2JqVmFsdWUgPSB2YWx1ZVtrZXldO1xuICAgICAgICAgIGlmIChkZWVwKSB7XG4gICAgICAgICAgICBvYmpWYWx1ZSA9IGNsb25lKG9ialZhbHVlLCBkZWVwKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgY29weVtrZXldID0gb2JqVmFsdWU7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGNvcHk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byB2YWx1ZXMsIHJldHVybmluZyBhIHRydXRoeSB2YWx1ZSBpZiB0aGVyZSBhcmUgY2hhbmdlcyBvciBgZmFsc2VgIGlmIHRoZXJlIGFyZSBubyBjaGFuZ2VzLiBJZiB0aGUgdHdvXG4gIC8vIHZhbHVlcyBhcmUgYm90aCBhcnJheXMgb3IgYm90aCBvYmplY3RzLCBhbiBhcnJheSBvZiBjaGFuZ2VzIChzcGxpY2VzIG9yIGNoYW5nZSByZWNvcmRzKSBiZXR3ZWVuIHRoZSB0d28gd2lsbCBiZVxuICAvLyByZXR1cm5lZC4gT3RoZXJ3aXNlICBgdHJ1ZWAgd2lsbCBiZSByZXR1cm5lZC5cbiAgZnVuY3Rpb24gZGlmZlZhbHVlcyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICAvLyBTaG9ydGN1dCBvdXQgZm9yIHZhbHVlcyB0aGF0IGFyZSBleGFjdGx5IGVxdWFsXG4gICAgaWYgKHZhbHVlID09PSBvbGRWYWx1ZSkgcmV0dXJuIGZhbHNlO1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpICYmIEFycmF5LmlzQXJyYXkob2xkVmFsdWUpKSB7XG4gICAgICAvLyBJZiBhbiBhcnJheSBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIHNwbGljZXNcbiAgICAgIHZhciBzcGxpY2VzID0gZGlmZkFycmF5cyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgICAgcmV0dXJuIHNwbGljZXMubGVuZ3RoID8gc3BsaWNlcyA6IGZhbHNlO1xuICAgIH0gZWxzZSBpZiAodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBJZiBhbiBvYmplY3QgaGFzIGNoYW5nZWQgY2FsY3VsYXRlIHRoZSBjaG5hZ2VzIGFuZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgdmFyIHZhbHVlVmFsdWUgPSB2YWx1ZS52YWx1ZU9mKCk7XG4gICAgICB2YXIgb2xkVmFsdWVWYWx1ZSA9IG9sZFZhbHVlLnZhbHVlT2YoKTtcblxuICAgICAgLy8gQWxsb3cgZGF0ZXMgYW5kIE51bWJlci9TdHJpbmcgb2JqZWN0cyB0byBiZSBjb21wYXJlZFxuICAgICAgaWYgKHR5cGVvZiB2YWx1ZVZhbHVlICE9PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlVmFsdWUgIT09IG9sZFZhbHVlVmFsdWU7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YXIgY2hhbmdlUmVjb3JkcyA9IGRpZmZPYmplY3RzKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgICAgIHJldHVybiBjaGFuZ2VSZWNvcmRzLmxlbmd0aCA/IGNoYW5nZVJlY29yZHMgOiBmYWxzZTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgLy8gSWYgYSB2YWx1ZSBoYXMgY2hhbmdlZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgICAgcmV0dXJuIGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIGJhc2ljIHR5cGVzLCByZXR1cm5pbmcgdHJ1ZSBpZiBjaGFuZ2VkIG9yIGZhbHNlIGlmIG5vdFxuICBmdW5jdGlvbiBkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSB7XG4gICBpZiAodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlVmFsdWUsIG9sZFZhbHVlVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdudW1iZXInICYmIGlzTmFOKHZhbHVlKSAmJiBpc05hTihvbGRWYWx1ZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlICE9PSBvbGRWYWx1ZTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBvYmplY3RzIHJldHVybmluZyBhbiBhcnJheSBvZiBjaGFuZ2UgcmVjb3Jkcy4gVGhlIGNoYW5nZSByZWNvcmQgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgb2JqZWN0OiBvYmplY3QsXG4gIC8vICAgdHlwZTogJ2RlbGV0ZWR8dXBkYXRlZHxuZXcnLFxuICAvLyAgIG5hbWU6ICdwcm9wZXJ0eU5hbWUnLFxuICAvLyAgIG9sZFZhbHVlOiBvbGRWYWx1ZVxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmT2JqZWN0cyhvYmplY3QsIG9sZE9iamVjdCkge1xuICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gW107XG4gICAgdmFyIHByb3AsIG9sZFZhbHVlLCB2YWx1ZTtcblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCAoc2hvdWxkIGJlIGEgY2xvbmUpIGFuZCBsb29rIGZvciB0aGluZ3MgdGhhdCBhcmUgbm93IGdvbmUgb3IgY2hhbmdlZFxuICAgIGZvciAocHJvcCBpbiBvbGRPYmplY3QpIHtcbiAgICAgIG9sZFZhbHVlID0gb2xkT2JqZWN0W3Byb3BdO1xuICAgICAgdmFsdWUgPSBvYmplY3RbcHJvcF07XG5cbiAgICAgIC8vIEFsbG93IGZvciB0aGUgY2FzZSBvZiBvYmoucHJvcCA9IHVuZGVmaW5lZCAod2hpY2ggaXMgYSBuZXcgcHJvcGVydHksIGV2ZW4gaWYgaXQgaXMgdW5kZWZpbmVkKVxuICAgICAgaWYgKHZhbHVlICE9PSB1bmRlZmluZWQgJiYgIWRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICAvLyBJZiB0aGUgcHJvcGVydHkgaXMgZ29uZSBpdCB3YXMgcmVtb3ZlZFxuICAgICAgaWYgKCEgKHByb3AgaW4gb2JqZWN0KSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICdkZWxldGVkJywgcHJvcCwgb2xkVmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAoZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQob2JqZWN0LCAndXBkYXRlZCcsIHByb3AsIG9sZFZhbHVlKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gR29lcyB0aHJvdWdoIHRoZSBvbGQgb2JqZWN0IGFuZCBsb29rcyBmb3IgdGhpbmdzIHRoYXQgYXJlIG5ld1xuICAgIGZvciAocHJvcCBpbiBvYmplY3QpIHtcbiAgICAgIHZhbHVlID0gb2JqZWN0W3Byb3BdO1xuICAgICAgaWYgKCEgKHByb3AgaW4gb2xkT2JqZWN0KSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICduZXcnLCBwcm9wKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkob2JqZWN0KSAmJiBvYmplY3QubGVuZ3RoICE9PSBvbGRPYmplY3QubGVuZ3RoKSB7XG4gICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICd1cGRhdGVkJywgJ2xlbmd0aCcsIG9sZE9iamVjdC5sZW5ndGgpKTtcbiAgICB9XG5cbiAgICByZXR1cm4gY2hhbmdlUmVjb3JkcztcbiAgfVxuXG5cblxuXG5cbiAgRURJVF9MRUFWRSA9IDBcbiAgRURJVF9VUERBVEUgPSAxXG4gIEVESVRfQUREID0gMlxuICBFRElUX0RFTEVURSA9IDNcblxuXG4gIC8vIERpZmZzIHR3byBhcnJheXMgcmV0dXJuaW5nIGFuIGFycmF5IG9mIHNwbGljZXMuIEEgc3BsaWNlIG9iamVjdCBsb29rcyBsaWtlOlxuICAvLyBgYGBqYXZhc2NyaXB0XG4gIC8vIHtcbiAgLy8gICBpbmRleDogMyxcbiAgLy8gICByZW1vdmVkOiBbaXRlbSwgaXRlbV0sXG4gIC8vICAgYWRkZWRDb3VudDogMFxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIHZhciBjdXJyZW50U3RhcnQgPSAwO1xuICAgIHZhciBjdXJyZW50RW5kID0gdmFsdWUubGVuZ3RoO1xuICAgIHZhciBvbGRTdGFydCA9IDA7XG4gICAgdmFyIG9sZEVuZCA9IG9sZFZhbHVlLmxlbmd0aDtcblxuICAgIHZhciBtaW5MZW5ndGggPSBNYXRoLm1pbihjdXJyZW50RW5kLCBvbGRFbmQpO1xuICAgIHZhciBwcmVmaXhDb3VudCA9IHNoYXJlZFByZWZpeCh2YWx1ZSwgb2xkVmFsdWUsIG1pbkxlbmd0aCk7XG4gICAgdmFyIHN1ZmZpeENvdW50ID0gc2hhcmVkU3VmZml4KHZhbHVlLCBvbGRWYWx1ZSwgbWluTGVuZ3RoIC0gcHJlZml4Q291bnQpO1xuXG4gICAgY3VycmVudFN0YXJ0ICs9IHByZWZpeENvdW50O1xuICAgIG9sZFN0YXJ0ICs9IHByZWZpeENvdW50O1xuICAgIGN1cnJlbnRFbmQgLT0gc3VmZml4Q291bnQ7XG4gICAgb2xkRW5kIC09IHN1ZmZpeENvdW50O1xuXG4gICAgaWYgKGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQgPT09IDAgJiYgb2xkRW5kIC0gb2xkU3RhcnQgPT09IDApIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3RoaW5nIHdhcyBhZGRlZCwgb25seSByZW1vdmVkIGZyb20gb25lIHNwb3RcbiAgICBpZiAoY3VycmVudFN0YXJ0ID09PSBjdXJyZW50RW5kKSB7XG4gICAgICByZXR1cm4gWyBuZXcgU3BsaWNlKGN1cnJlbnRTdGFydCwgb2xkVmFsdWUuc2xpY2Uob2xkU3RhcnQsIG9sZEVuZCksIDApIF07XG4gICAgfVxuXG4gICAgLy8gaWYgbm90aGluZyB3YXMgcmVtb3ZlZCwgb25seSBhZGRlZCB0byBvbmUgc3BvdFxuICAgIGlmIChvbGRTdGFydCA9PT0gb2xkRW5kKSB7XG4gICAgICByZXR1cm4gWyBuZXcgU3BsaWNlKGN1cnJlbnRTdGFydCwgW10sIGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQpIF07XG4gICAgfVxuXG4gICAgLy8gYSBtaXh0dXJlIG9mIGFkZHMgYW5kIHJlbW92ZXNcbiAgICB2YXIgZGlzdGFuY2VzID0gY2FsY0VkaXREaXN0YW5jZXModmFsdWUsIGN1cnJlbnRTdGFydCwgY3VycmVudEVuZCwgb2xkVmFsdWUsIG9sZFN0YXJ0LCBvbGRFbmQpO1xuICAgIHZhciBvcHMgPSBzcGxpY2VPcGVyYXRpb25zRnJvbUVkaXREaXN0YW5jZXMoZGlzdGFuY2VzKTtcblxuICAgIHZhciBzcGxpY2UgPSBudWxsO1xuICAgIHZhciBzcGxpY2VzID0gW107XG4gICAgdmFyIGluZGV4ID0gY3VycmVudFN0YXJ0O1xuICAgIHZhciBvbGRJbmRleCA9IG9sZFN0YXJ0O1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBvcHMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICB2YXIgb3AgPSBvcHNbaV07XG4gICAgICBpZiAob3AgPT09IEVESVRfTEVBVkUpIHtcbiAgICAgICAgaWYgKHNwbGljZSkge1xuICAgICAgICAgIHNwbGljZXMucHVzaChzcGxpY2UpO1xuICAgICAgICAgIHNwbGljZSA9IG51bGw7XG4gICAgICAgIH1cblxuICAgICAgICBpbmRleCsrO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9VUERBVEUpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UuYWRkZWRDb3VudCsrO1xuICAgICAgICBpbmRleCsrO1xuXG4gICAgICAgIHNwbGljZS5yZW1vdmVkLnB1c2gob2xkVmFsdWVbb2xkSW5kZXhdKTtcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfQUREKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLmFkZGVkQ291bnQrKztcbiAgICAgICAgaW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfREVMRVRFKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLnJlbW92ZWQucHVzaChvbGRWYWx1ZVtvbGRJbmRleF0pO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChzcGxpY2UpIHtcbiAgICAgIHNwbGljZXMucHVzaChzcGxpY2UpO1xuICAgIH1cblxuICAgIHJldHVybiBzcGxpY2VzO1xuICB9XG5cblxuXG5cbiAgLy8gZmluZCB0aGUgbnVtYmVyIG9mIGl0ZW1zIGF0IHRoZSBiZWdpbm5pbmcgdGhhdCBhcmUgdGhlIHNhbWVcbiAgZnVuY3Rpb24gc2hhcmVkUHJlZml4KGN1cnJlbnQsIG9sZCwgc2VhcmNoTGVuZ3RoKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzZWFyY2hMZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGRpZmZCYXNpYyhjdXJyZW50W2ldLCBvbGRbaV0pKSB7XG4gICAgICAgIHJldHVybiBpO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gc2VhcmNoTGVuZ3RoO1xuICB9XG5cblxuICAvLyBmaW5kIHRoZSBudW1iZXIgb2YgaXRlbXMgYXQgdGhlIGVuZCB0aGF0IGFyZSB0aGUgc2FtZVxuICBmdW5jdGlvbiBzaGFyZWRTdWZmaXgoY3VycmVudCwgb2xkLCBzZWFyY2hMZW5ndGgpIHtcbiAgICB2YXIgaW5kZXgxID0gY3VycmVudC5sZW5ndGg7XG4gICAgdmFyIGluZGV4MiA9IG9sZC5sZW5ndGg7XG4gICAgdmFyIGNvdW50ID0gMDtcbiAgICB3aGlsZSAoY291bnQgPCBzZWFyY2hMZW5ndGggJiYgIWRpZmZCYXNpYyhjdXJyZW50Wy0taW5kZXgxXSwgb2xkWy0taW5kZXgyXSkpIHtcbiAgICAgIGNvdW50Kys7XG4gICAgfVxuICAgIHJldHVybiBjb3VudDtcbiAgfVxuXG5cbiAgZnVuY3Rpb24gc3BsaWNlT3BlcmF0aW9uc0Zyb21FZGl0RGlzdGFuY2VzKGRpc3RhbmNlcykge1xuICAgIHZhciBpID0gZGlzdGFuY2VzLmxlbmd0aCAtIDE7XG4gICAgdmFyIGogPSBkaXN0YW5jZXNbMF0ubGVuZ3RoIC0gMTtcbiAgICB2YXIgY3VycmVudCA9IGRpc3RhbmNlc1tpXVtqXTtcbiAgICB2YXIgZWRpdHMgPSBbXTtcbiAgICB3aGlsZSAoaSA+IDAgfHwgaiA+IDApIHtcbiAgICAgIGlmIChpID09PSAwKSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9BREQpO1xuICAgICAgICBqLS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICBpZiAoaiA9PT0gMCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfREVMRVRFKTtcbiAgICAgICAgaS0tO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgdmFyIG5vcnRoV2VzdCA9IGRpc3RhbmNlc1tpIC0gMV1baiAtIDFdO1xuICAgICAgdmFyIHdlc3QgPSBkaXN0YW5jZXNbaSAtIDFdW2pdO1xuICAgICAgdmFyIG5vcnRoID0gZGlzdGFuY2VzW2ldW2ogLSAxXTtcblxuICAgICAgaWYgKHdlc3QgPCBub3J0aCkge1xuICAgICAgICBtaW4gPSB3ZXN0IDwgbm9ydGhXZXN0ID8gd2VzdCA6IG5vcnRoV2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pbiA9IG5vcnRoIDwgbm9ydGhXZXN0ID8gbm9ydGggOiBub3J0aFdlc3Q7XG4gICAgICB9XG5cbiAgICAgIGlmIChtaW4gPT09IG5vcnRoV2VzdCkge1xuICAgICAgICBpZiAobm9ydGhXZXN0ID09PSBjdXJyZW50KSB7XG4gICAgICAgICAgZWRpdHMucHVzaChFRElUX0xFQVZFKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfVVBEQVRFKTtcbiAgICAgICAgICBjdXJyZW50ID0gbm9ydGhXZXN0O1xuICAgICAgICB9XG4gICAgICAgIGktLTtcbiAgICAgICAgai0tO1xuICAgICAgfSBlbHNlIGlmIChtaW4gPT09IHdlc3QpIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY3VycmVudCA9IHdlc3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjdXJyZW50ID0gbm9ydGg7XG4gICAgICB9XG4gICAgfVxuICAgIGVkaXRzLnJldmVyc2UoKTtcbiAgICByZXR1cm4gZWRpdHM7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIGNhbGNFZGl0RGlzdGFuY2VzKGN1cnJlbnQsIGN1cnJlbnRTdGFydCwgY3VycmVudEVuZCwgb2xkLCBvbGRTdGFydCwgb2xkRW5kKSB7XG4gICAgLy8gXCJEZWxldGlvblwiIGNvbHVtbnNcbiAgICB2YXIgcm93Q291bnQgPSBvbGRFbmQgLSBvbGRTdGFydCArIDE7XG4gICAgdmFyIGNvbHVtbkNvdW50ID0gY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCArIDE7XG4gICAgdmFyIGRpc3RhbmNlcyA9IG5ldyBBcnJheShyb3dDb3VudCk7XG4gICAgdmFyIGksIGo7XG5cbiAgICAvLyBcIkFkZGl0aW9uXCIgcm93cy4gSW5pdGlhbGl6ZSBudWxsIGNvbHVtbi5cbiAgICBmb3IgKGkgPSAwOyBpIDwgcm93Q291bnQ7IGkrKykge1xuICAgICAgZGlzdGFuY2VzW2ldID0gbmV3IEFycmF5KGNvbHVtbkNvdW50KTtcbiAgICAgIGRpc3RhbmNlc1tpXVswXSA9IGk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBudWxsIHJvd1xuICAgIGZvciAoaiA9IDA7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICBkaXN0YW5jZXNbMF1bal0gPSBqO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDE7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBmb3IgKGogPSAxOyBqIDwgY29sdW1uQ291bnQ7IGorKykge1xuICAgICAgICBpZiAoIWRpZmZCYXNpYyhjdXJyZW50W2N1cnJlbnRTdGFydCArIGogLSAxXSwgb2xkW29sZFN0YXJ0ICsgaSAtIDFdKSkge1xuICAgICAgICAgIGRpc3RhbmNlc1tpXVtqXSA9IGRpc3RhbmNlc1tpIC0gMV1baiAtIDFdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpIC0gMV1bal0gKyAxO1xuICAgICAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2ldW2ogLSAxXSArIDE7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gbm9ydGggPCB3ZXN0ID8gbm9ydGggOiB3ZXN0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc3RhbmNlcztcbiAgfVxufSkoKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IHJlcXVpcmUoJy4vb2JzZXJ2ZXInKTtcbmV4cG9ydHMuY29udGV4dCA9IHJlcXVpcmUoJy4vY29udGV4dCcpO1xuZXhwb3J0cy5leHByZXNzaW9ucyA9IHJlcXVpcmUoJ2V4cHJlc3Npb25zLWpzJyk7XG5leHBvcnRzLmV4cHJlc3Npb25zLmRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gT2JzZXJ2ZXI7XG52YXIgZXhwcmVzc2lvbnMgPSByZXF1aXJlKCdleHByZXNzaW9ucy1qcycpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciBmcmFnbWVudHNDb250ZXh0ID0gcmVxdWlyZSgnLi9jb250ZXh0Jyk7XG52YXIgcmVxdWVzdEFuaW1hdGlvbkZyYW1lID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSB8fCBzZXRUaW1lb3V0O1xudmFyIGNhbmNlbEFuaW1hdGlvbkZyYW1lID0gd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lIHx8IGNsZWFyVGltZW91dDtcblxuLy8gIyBPYnNlcnZlclxuXG4vLyBEZWZpbmVzIGFuIG9ic2VydmVyIGNsYXNzIHdoaWNoIHJlcHJlc2VudHMgYW4gZXhwcmVzc2lvbi4gV2hlbmV2ZXIgdGhhdCBleHByZXNzaW9uIHJldHVybnMgYSBuZXcgdmFsdWUgdGhlIGBjYWxsYmFja2Bcbi8vIGlzIGNhbGxlZCB3aXRoIHRoZSB2YWx1ZS5cbi8vXG4vLyBJZiB0aGUgb2xkIGFuZCBuZXcgdmFsdWVzIHdlcmUgZWl0aGVyIGFuIGFycmF5IG9yIGFuIG9iamVjdCwgdGhlIGBjYWxsYmFja2AgYWxzb1xuLy8gcmVjZWl2ZXMgYW4gYXJyYXkgb2Ygc3BsaWNlcyAoZm9yIGFuIGFycmF5KSwgb3IgYW4gYXJyYXkgb2YgY2hhbmdlIG9iamVjdHMgKGZvciBhbiBvYmplY3QpIHdoaWNoIGFyZSB0aGUgc2FtZVxuLy8gZm9ybWF0IHRoYXQgYEFycmF5Lm9ic2VydmVgIGFuZCBgT2JqZWN0Lm9ic2VydmVgIHJldHVybiA8aHR0cDovL3dpa2kuZWNtYXNjcmlwdC5vcmcvZG9rdS5waHA/aWQ9aGFybW9ueTpvYnNlcnZlPi5cbmZ1bmN0aW9uIE9ic2VydmVyKGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgaWYgKHR5cGVvZiBleHByID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5nZXR0ZXIgPSBleHByO1xuICAgIHRoaXMuc2V0dGVyID0gZXhwcjtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmdldHRlciA9IGV4cHJlc3Npb25zLnBhcnNlKGV4cHIsIE9ic2VydmVyLmdsb2JhbHMsIE9ic2VydmVyLmZvcm1hdHRlcnMpO1xuICB9XG4gIHRoaXMuZXhwciA9IGV4cHI7XG4gIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgdGhpcy5jYWxsYmFja0NvbnRleHQgPSBjYWxsYmFja0NvbnRleHQ7XG4gIHRoaXMuc2tpcCA9IGZhbHNlO1xuICB0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSBmYWxzZTtcbiAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgdGhpcy5vbGRWYWx1ZSA9IHVuZGVmaW5lZDtcbn1cblxuT2JzZXJ2ZXIucHJvdG90eXBlID0ge1xuXG4gIC8vIEJpbmRzIHRoaXMgZXhwcmVzc2lvbiB0byBhIGdpdmVuIGNvbnRleHRcbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCwgc2tpcFVwZGF0ZSkge1xuICAgIHRoaXMuY29udGV4dCA9IGNvbnRleHQ7XG4gICAgaWYgKHRoaXMuY2FsbGJhY2spIHtcbiAgICAgIE9ic2VydmVyLmFkZCh0aGlzLCBza2lwVXBkYXRlKTtcbiAgICB9XG4gIH0sXG5cbiAgLy8gVW5iaW5kcyB0aGlzIGV4cHJlc3Npb25cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICBPYnNlcnZlci5yZW1vdmUodGhpcyk7XG4gICAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgfSxcblxuICAvLyBDbG9zZXMgdGhlIG9ic2VydmVyLCBjbGVhbmluZyB1cCBhbnkgcG9zc2libGUgbWVtb3J5LWxlYWtzXG4gIGNsb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIHRoaXMuY2FsbGJhY2sgPSBudWxsO1xuICAgIHRoaXMuY2FsbGJhY2tDb250ZXh0ID0gbnVsbDtcbiAgfSxcblxuICAvLyBSZXR1cm5zIHRoZSBjdXJyZW50IHZhbHVlIG9mIHRoaXMgb2JzZXJ2ZXJcbiAgZ2V0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0KSB7XG4gICAgICByZXR1cm4gdGhpcy5nZXR0ZXIuY2FsbCh0aGlzLmNvbnRleHQpO1xuICAgIH1cbiAgfSxcblxuICAvLyBTZXRzIHRoZSB2YWx1ZSBvZiB0aGlzIGV4cHJlc3Npb25cbiAgc2V0OiBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdGhpcy5jb250ZXh0KSByZXR1cm47XG4gICAgaWYgKHRoaXMuc2V0dGVyID09PSBmYWxzZSkgcmV0dXJuO1xuICAgIGlmICghdGhpcy5zZXR0ZXIpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIHRoaXMuc2V0dGVyID0gdHlwZW9mIHRoaXMuZXhwciA9PT0gJ3N0cmluZydcbiAgICAgICAgICA/IGV4cHJlc3Npb25zLnBhcnNlU2V0dGVyKHRoaXMuZXhwciwgT2JzZXJ2ZXIuZ2xvYmFscywgT2JzZXJ2ZXIuZm9ybWF0dGVycylcbiAgICAgICAgICA6IGZhbHNlO1xuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICB0aGlzLnNldHRlciA9IGZhbHNlO1xuICAgICAgfVxuICAgICAgaWYgKCF0aGlzLnNldHRlcikgcmV0dXJuO1xuICAgIH1cblxuICAgIHRyeSB7XG4gICAgICB2YXIgcmVzdWx0ID0gdGhpcy5zZXR0ZXIuY2FsbCh0aGlzLmNvbnRleHQsIHZhbHVlKTtcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBXZSBjYW4ndCBleHBlY3QgY29kZSBpbiBmcmFnbWVudHMgb3V0c2lkZSBPYnNlcnZlciB0byBiZSBhd2FyZSBvZiBcInN5bmNcIiBzaW5jZSBvYnNlcnZlciBjYW4gYmUgcmVwbGFjZWQgYnkgb3RoZXJcbiAgICAvLyB0eXBlcyAoZS5nLiBvbmUgd2l0aG91dCBhIGBzeW5jKClgIG1ldGhvZCwgc3VjaCBhcyBvbmUgdGhhdCB1c2VzIGBPYmplY3Qub2JzZXJ2ZWApIGluIG90aGVyIHN5c3RlbXMuXG4gICAgdGhpcy5zeW5jKCk7XG4gICAgT2JzZXJ2ZXIuc3luYygpO1xuICAgIHJldHVybiByZXN1bHQ7XG4gIH0sXG5cblxuICAvLyBJbnN0cnVjdHMgdGhpcyBvYnNlcnZlciB0byBub3QgY2FsbCBpdHMgYGNhbGxiYWNrYCBvbiB0aGUgbmV4dCBzeW5jLCB3aGV0aGVyIHRoZSB2YWx1ZSBoYXMgY2hhbmdlZCBvciBub3RcbiAgc2tpcE5leHRTeW5jOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnNraXAgPSB0cnVlO1xuICB9LFxuXG5cbiAgLy8gU3luY3MgdGhpcyBvYnNlcnZlciBub3csIGNhbGxpbmcgdGhlIGNhbGxiYWNrIGltbWVkaWF0ZWx5IGlmIHRoZXJlIGhhdmUgYmVlbiBjaGFuZ2VzXG4gIHN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHZhciB2YWx1ZSA9IHRoaXMuZ2V0KCk7XG5cbiAgICAvLyBEb24ndCBjYWxsIHRoZSBjYWxsYmFjayBpZiBgc2tpcE5leHRTeW5jYCB3YXMgY2FsbGVkIG9uIHRoZSBvYnNlcnZlclxuICAgIGlmICh0aGlzLnNraXAgfHwgIXRoaXMuY2FsbGJhY2spIHtcbiAgICAgIHRoaXMuc2tpcCA9IGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhbiBhcnJheSBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIHNwbGljZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrLiBUaGlzXG4gICAgICB2YXIgY2hhbmdlZCA9IGRpZmYudmFsdWVzKHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIGlmICghY2hhbmdlZCAmJiAhdGhpcy5mb3JjZVVwZGF0ZU5leHRTeW5jKSByZXR1cm47XG4gICAgICB0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSBmYWxzZTtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGNoYW5nZWQpKSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUsIGNoYW5nZWQpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmNhbGxiYWNrLmNhbGwodGhpcy5jYWxsYmFja0NvbnRleHQsIHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRDaGFuZ2VSZWNvcmRzKSB7XG4gICAgICAvLyBTdG9yZSBhbiBpbW11dGFibGUgdmVyc2lvbiBvZiB0aGUgdmFsdWUsIGFsbG93aW5nIGZvciBhcnJheXMgYW5kIG9iamVjdHMgdG8gY2hhbmdlIGluc3RhbmNlIGJ1dCBub3QgY29udGVudCBhbmRcbiAgICAgIC8vIHN0aWxsIHJlZnJhaW4gZnJvbSBkaXNwYXRjaGluZyBjYWxsYmFja3MgKGUuZy4gd2hlbiB1c2luZyBhbiBvYmplY3QgaW4gYmluZC1jbGFzcyBvciB3aGVuIHVzaW5nIGFycmF5IGZvcm1hdHRlcnNcbiAgICAgIC8vIGluIGJpbmQtZWFjaClcbiAgICAgIHRoaXMub2xkVmFsdWUgPSBkaWZmLmNsb25lKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vbGRWYWx1ZSA9IHZhbHVlO1xuICAgIH1cbiAgfVxufTtcblxuXG4vLyBBbiBhcnJheSBvZiBhbGwgb2JzZXJ2ZXJzLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIub2JzZXJ2ZXJzID0gW107XG5cbi8vIEFuIGFycmF5IG9mIGNhbGxiYWNrcyB0byBydW4gYWZ0ZXIgdGhlIG5leHQgc3luYywgY29uc2lkZXJlZCAqcHJpdmF0ZSpcbk9ic2VydmVyLmNhbGxiYWNrcyA9IFtdO1xuT2JzZXJ2ZXIubGlzdGVuZXJzID0gW107XG5cbi8vIEFkZHMgYSBuZXcgb2JzZXJ2ZXIgdG8gYmUgc3luY2VkIHdpdGggY2hhbmdlcy4gSWYgYHNraXBVcGRhdGVgIGlzIHRydWUgdGhlbiB0aGUgY2FsbGJhY2sgd2lsbCBvbmx5IGJlIGNhbGxlZCB3aGVuIGFcbi8vIGNoYW5nZSBpcyBtYWRlLCBub3QgaW5pdGlhbGx5LlxuT2JzZXJ2ZXIuYWRkID0gZnVuY3Rpb24ob2JzZXJ2ZXIsIHNraXBVcGRhdGUpIHtcbiAgdGhpcy5vYnNlcnZlcnMucHVzaChvYnNlcnZlcik7XG4gIGlmICghc2tpcFVwZGF0ZSkge1xuICAgIG9ic2VydmVyLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSB0cnVlO1xuICAgIG9ic2VydmVyLnN5bmMoKTtcbiAgfVxufTtcblxuLy8gUmVtb3ZlcyBhbiBvYnNlcnZlciwgc3RvcHBpbmcgaXQgZnJvbSBiZWluZyBydW5cbk9ic2VydmVyLnJlbW92ZSA9IGZ1bmN0aW9uKG9ic2VydmVyKSB7XG4gIHZhciBpbmRleCA9IHRoaXMub2JzZXJ2ZXJzLmluZGV4T2Yob2JzZXJ2ZXIpO1xuICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgdGhpcy5vYnNlcnZlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbi8vICpwcml2YXRlKiBwcm9wZXJ0aWVzIHVzZWQgaW4gdGhlIHN5bmMgY3ljbGVcbk9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbk9ic2VydmVyLmNhbGxiYWNrc1J1bm5pbmcgPSBmYWxzZTtcbk9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG5PYnNlcnZlci5jeWNsZXMgPSAwO1xuT2JzZXJ2ZXIubWF4ID0gMTA7XG5PYnNlcnZlci50aW1lb3V0ID0gbnVsbDtcbk9ic2VydmVyLnN5bmNQZW5kaW5nID0gbnVsbDtcblxuLy8gU2NoZWR1bGVzIGFuIG9ic2VydmVyIHN5bmMgY3ljbGUgd2hpY2ggY2hlY2tzIGFsbCB0aGUgb2JzZXJ2ZXJzIHRvIHNlZSBpZiB0aGV5J3ZlIGNoYW5nZWQuXG5PYnNlcnZlci5zeW5jID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKE9ic2VydmVyLnN5bmNQZW5kaW5nKSByZXR1cm4gZmFsc2U7XG4gIE9ic2VydmVyLnN5bmNQZW5kaW5nID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZ1bmN0aW9uKCkge1xuICAgIE9ic2VydmVyLnN5bmNOb3coY2FsbGJhY2spO1xuICB9KTtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBSdW5zIHRoZSBvYnNlcnZlciBzeW5jIGN5Y2xlIHdoaWNoIGNoZWNrcyBhbGwgdGhlIG9ic2VydmVycyB0byBzZWUgaWYgdGhleSd2ZSBjaGFuZ2VkLlxuT2JzZXJ2ZXIuc3luY05vdyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICBPYnNlcnZlci5hZnRlclN5bmMoY2FsbGJhY2spO1xuICB9XG5cbiAgY2FuY2VsQW5pbWF0aW9uRnJhbWUoT2JzZXJ2ZXIuc3luY1BlbmRpbmcpO1xuICBPYnNlcnZlci5zeW5jUGVuZGluZyA9IG51bGw7XG5cbiAgaWYgKE9ic2VydmVyLnN5bmNpbmcpIHtcbiAgICBPYnNlcnZlci5yZXJ1biA9IHRydWU7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgT2JzZXJ2ZXIuc3luY2luZyA9IHRydWU7XG4gIE9ic2VydmVyLnJlcnVuID0gdHJ1ZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcblxuICBmcmFnbWVudHNDb250ZXh0LnNraXBOZXh0U3luYygpO1xuICBmcmFnbWVudHNDb250ZXh0LnJ1bihmdW5jdGlvbigpIHtcblxuICAgIC8vIEFsbG93IGNhbGxiYWNrcyB0byBydW4gdGhlIHN5bmMgY3ljbGUgYWdhaW4gaW1tZWRpYXRlbHksIGJ1dCBzdG9wIGF0IGBPYnNlcnZlci5tYXhgIChkZWZhdWx0IDEwKSBjeWNsZXMgdG8gd2UgZG9uJ3RcbiAgICAvLyBydW4gaW5maW5pdGUgbG9vcHNcbiAgICB3aGlsZSAoT2JzZXJ2ZXIucmVydW4pIHtcbiAgICAgIGlmICgrK09ic2VydmVyLmN5Y2xlcyA9PT0gT2JzZXJ2ZXIubWF4KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW5maW5pdGUgb2JzZXJ2ZXIgc3luY2luZywgYW4gb2JzZXJ2ZXIgaXMgY2FsbGluZyBPYnNlcnZlci5zeW5jKCkgdG9vIG1hbnkgdGltZXMnKTtcbiAgICAgIH1cbiAgICAgIE9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG4gICAgICAvLyB0aGUgb2JzZXJ2ZXIgYXJyYXkgbWF5IGluY3JlYXNlIG9yIGRlY3JlYXNlIGluIHNpemUgKHJlbWFpbmluZyBvYnNlcnZlcnMpIGR1cmluZyB0aGUgc3luY1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBPYnNlcnZlci5vYnNlcnZlcnMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgT2JzZXJ2ZXIub2JzZXJ2ZXJzW2ldLnN5bmMoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBPYnNlcnZlci5jYWxsYmFja3NSdW5uaW5nID0gdHJ1ZTtcblxuICAgIHZhciBjYWxsYmFja3MgPSBPYnNlcnZlci5jYWxsYmFja3M7XG4gICAgT2JzZXJ2ZXIuY2FsbGJhY2tzID0gW107XG4gICAgd2hpbGUgKGNhbGxiYWNrcy5sZW5ndGgpIHtcbiAgICAgIGNhbGxiYWNrcy5zaGlmdCgpKCk7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSA9IDAsIGwgPSBPYnNlcnZlci5saXN0ZW5lcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICB2YXIgbGlzdGVuZXIgPSBPYnNlcnZlci5saXN0ZW5lcnNbaV07XG4gICAgICBsaXN0ZW5lcigpO1xuICAgIH1cblxuICAgIE9ic2VydmVyLmNhbGxiYWNrc1J1bm5pbmcgPSBmYWxzZTtcbiAgfSk7XG5cbiAgT2JzZXJ2ZXIuc3luY2luZyA9IGZhbHNlO1xuICBPYnNlcnZlci5jeWNsZXMgPSAwO1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIEFmdGVyIHRoZSBuZXh0IHN5bmMgKG9yIHRoZSBjdXJyZW50IGlmIGluIHRoZSBtaWRkbGUgb2Ygb25lKSwgcnVuIHRoZSBwcm92aWRlZCBjYWxsYmFja1xuT2JzZXJ2ZXIuYWZ0ZXJTeW5jID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2NhbGxiYWNrIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIGlmIChPYnNlcnZlci5jYWxsYmFja3NSdW5uaW5nKSB7XG4gICAgT2JzZXJ2ZXIuc3luYygpO1xuICB9XG4gIE9ic2VydmVyLmNhbGxiYWNrcy5wdXNoKGNhbGxiYWNrKTtcbn07XG5cbk9ic2VydmVyLm9uU3luYyA9IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICBPYnNlcnZlci5saXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG59O1xuXG5PYnNlcnZlci5yZW1vdmVPblN5bmMgPSBmdW5jdGlvbihsaXN0ZW5lcikge1xuICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgdmFyIGluZGV4ID0gT2JzZXJ2ZXIubGlzdGVuZXJzLmluZGV4T2YobGlzdGVuZXIpO1xuICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgT2JzZXJ2ZXIubGlzdGVuZXJzLnNwbGljZShpbmRleCwgMSkucG9wKCk7XG4gIH1cbn07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdGVyRGVmYXVsdHM7XG5cbi8qKlxuICogIyBEZWZhdWx0IEJpbmRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGJpbmRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqIEZhZGUgaW4gYW5kIG91dFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKCdmYWRlJywge1xuICAgIG9wdGlvbnM6IHtcbiAgICAgIGR1cmF0aW9uOiAzMDAsXG4gICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICB9LFxuICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBvcGFjaXR5OiAnMCcgfSxcbiAgICAgICAgeyBvcGFjaXR5OiAnMScgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGRvbmU7XG4gICAgfSxcbiAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICB7IG9wYWNpdHk6ICcxJyB9LFxuICAgICAgICB7IG9wYWNpdHk6ICcwJyB9XG4gICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZG9uZTtcbiAgICB9XG4gIH0pO1xuXG4gIHZhciBzbGlkZXMgPSB7XG4gICAgc2xpZGU6ICdoZWlnaHQnLFxuICAgIHNsaWRldjogJ2hlaWdodCcsXG4gICAgc2xpZGVoOiAnd2lkdGgnXG4gIH07XG5cbiAgdmFyIGFuaW1hdGluZyA9IG5ldyBNYXAoKTtcblxuICBmdW5jdGlvbiBvYmooa2V5LCB2YWx1ZSkge1xuICAgIHZhciBvYmogPSB7fTtcbiAgICBvYmpba2V5XSA9IHZhbHVlO1xuICAgIHJldHVybiBvYmo7XG4gIH1cblxuICAvKipcbiAgICogU2xpZGUgZG93biBhbmQgdXAsIGxlZnQgYW5kIHJpZ2h0XG4gICAqL1xuICBPYmplY3Qua2V5cyhzbGlkZXMpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBwcm9wZXJ0eSA9IHNsaWRlc1tuYW1lXTtcblxuICAgIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lLCB7XG4gICAgICBvcHRpb25zOiB7XG4gICAgICAgIGR1cmF0aW9uOiAzMDAsXG4gICAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgICAgfSxcbiAgICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfSxcbiAgICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH1cbiAgICB9KTtcblxuXG4gICAgLyoqXG4gICAgICogTW92ZSBpdGVtcyB1cCBhbmQgZG93biBpbiBhIGxpc3QsIHNsaWRlIGRvd24gYW5kIHVwXG4gICAgICovXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUgKyAnLW1vdmUnLCB7XG4gICAgICBvcHRpb25zOiB7XG4gICAgICAgIGR1cmF0aW9uOiAzMDAsXG4gICAgICAgIGVhc2luZzogJ2Vhc2UtaW4tb3V0J1xuICAgICAgfSxcblxuICAgICAgYW5pbWF0ZUluOiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICB2YXIgaXRlbSA9IGVsZW1lbnQudmlldyAmJiBlbGVtZW50LnZpZXcuX3JlcGVhdEl0ZW1fO1xuICAgICAgICBpZiAoaXRlbSkge1xuICAgICAgICAgIGFuaW1hdGluZy5zZXQoaXRlbSwgZWxlbWVudCk7XG4gICAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICAgIGFuaW1hdGluZy5kZWxldGUoaXRlbSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEbyB0aGUgc2xpZGVcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfSxcblxuICAgICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW0gPSBlbGVtZW50LnZpZXcgJiYgZWxlbWVudC52aWV3Ll9yZXBlYXRJdGVtXztcbiAgICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgICB2YXIgbmV3RWxlbWVudCA9IGFuaW1hdGluZy5nZXQoaXRlbSk7XG4gICAgICAgICAgaWYgKG5ld0VsZW1lbnQgJiYgbmV3RWxlbWVudC5wYXJlbnROb2RlID09PSBlbGVtZW50LnBhcmVudE5vZGUpIHtcbiAgICAgICAgICAgIC8vIFRoaXMgaXRlbSBpcyBiZWluZyByZW1vdmVkIGluIG9uZSBwbGFjZSBhbmQgYWRkZWQgaW50byBhbm90aGVyLiBNYWtlIGl0IGxvb2sgbGlrZSBpdHMgbW92aW5nIGJ5IG1ha2luZyBib3RoXG4gICAgICAgICAgICAvLyBlbGVtZW50cyBub3QgdmlzaWJsZSBhbmQgaGF2aW5nIGEgY2xvbmUgbW92ZSBhYm92ZSB0aGUgaXRlbXMgdG8gdGhlIG5ldyBsb2NhdGlvbi5cbiAgICAgICAgICAgIGVsZW1lbnQgPSB0aGlzLmFuaW1hdGVNb3ZlKGVsZW1lbnQsIG5ld0VsZW1lbnQpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIC8vIERvIHRoZSBzbGlkZVxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JylcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9LFxuXG4gICAgICBhbmltYXRlTW92ZTogZnVuY3Rpb24ob2xkRWxlbWVudCwgbmV3RWxlbWVudCkge1xuICAgICAgICB2YXIgcGxhY2Vob2xkZXJFbGVtZW50O1xuICAgICAgICB2YXIgcGFyZW50ID0gbmV3RWxlbWVudC5wYXJlbnROb2RlO1xuICAgICAgICBpZiAoIXBhcmVudC5fX3NsaWRlTW92ZUhhbmRsZWQpIHtcbiAgICAgICAgICBwYXJlbnQuX19zbGlkZU1vdmVIYW5kbGVkID0gdHJ1ZTtcbiAgICAgICAgICBpZiAod2luZG93LmdldENvbXB1dGVkU3R5bGUocGFyZW50KS5wb3NpdGlvbiA9PT0gJ3N0YXRpYycpIHtcbiAgICAgICAgICAgIHBhcmVudC5zdHlsZS5wb3NpdGlvbiA9ICdyZWxhdGl2ZSc7XG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgdmFyIG9yaWdTdHlsZSA9IG9sZEVsZW1lbnQuZ2V0QXR0cmlidXRlKCdzdHlsZScpO1xuICAgICAgICB2YXIgc3R5bGUgPSB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZShvbGRFbGVtZW50KTtcbiAgICAgICAgdmFyIG1hcmdpbk9mZnNldExlZnQgPSAtcGFyc2VJbnQoc3R5bGUubWFyZ2luTGVmdCk7XG4gICAgICAgIHZhciBtYXJnaW5PZmZzZXRUb3AgPSAtcGFyc2VJbnQoc3R5bGUubWFyZ2luVG9wKTtcbiAgICAgICAgdmFyIG9sZExlZnQgPSBvbGRFbGVtZW50Lm9mZnNldExlZnQ7XG4gICAgICAgIHZhciBvbGRUb3AgPSBvbGRFbGVtZW50Lm9mZnNldFRvcDtcblxuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQgPSBmcmFnbWVudHMubWFrZUVsZW1lbnRBbmltYXRhYmxlKG9sZEVsZW1lbnQuY2xvbmVOb2RlKHRydWUpKTtcbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnN0eWxlLndpZHRoID0gb2xkRWxlbWVudC5zdHlsZS53aWR0aCA9IHN0eWxlLndpZHRoO1xuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQuc3R5bGUuaGVpZ2h0ID0gb2xkRWxlbWVudC5zdHlsZS5oZWlnaHQgPSBzdHlsZS5oZWlnaHQ7XG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5zdHlsZS5vcGFjaXR5ID0gJzAnO1xuXG4gICAgICAgIG9sZEVsZW1lbnQuc3R5bGUucG9zaXRpb24gPSAnYWJzb2x1dGUnO1xuICAgICAgICBvbGRFbGVtZW50LnN0eWxlLnpJbmRleCA9IDEwMDA7XG4gICAgICAgIHBhcmVudC5pbnNlcnRCZWZvcmUocGxhY2Vob2xkZXJFbGVtZW50LCBvbGRFbGVtZW50KTtcbiAgICAgICAgbmV3RWxlbWVudC5zdHlsZS5vcGFjaXR5ID0gJzAnO1xuXG4gICAgICAgIG9sZEVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgeyB0b3A6IG9sZFRvcCArIG1hcmdpbk9mZnNldFRvcCArICdweCcsIGxlZnQ6IG9sZExlZnQgKyBtYXJnaW5PZmZzZXRMZWZ0ICsgJ3B4JyB9LFxuICAgICAgICAgIHsgdG9wOiBuZXdFbGVtZW50Lm9mZnNldFRvcCArIG1hcmdpbk9mZnNldFRvcCArICdweCcsIGxlZnQ6IG5ld0VsZW1lbnQub2Zmc2V0TGVmdCArIG1hcmdpbk9mZnNldExlZnQgKyAncHgnIH1cbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5yZW1vdmUoKTtcbiAgICAgICAgICBvcmlnU3R5bGUgPyBvbGRFbGVtZW50LnNldEF0dHJpYnV0ZSgnc3R5bGUnLCBvcmlnU3R5bGUpIDogb2xkRWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoJ3N0eWxlJyk7XG4gICAgICAgICAgbmV3RWxlbWVudC5zdHlsZS5vcGFjaXR5ID0gJyc7XG4gICAgICAgIH07XG5cbiAgICAgICAgcmV0dXJuIHBsYWNlaG9sZGVyRWxlbWVudDtcbiAgICAgIH1cbiAgICB9KTtcblxuICB9KTtcblxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuLi9vYnNlcnZlci9kaWZmJyk7XG5cbi8qKlxuICogIyBEZWZhdWx0IEJpbmRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGJpbmRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqIFByaW50cyBvdXQgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHRvIHRoZSBjb25zb2xlLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdkZWJ1ZycsIHtcbiAgICBwcmlvcml0eTogNjAsXG4gICAgdXBkYXRlZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGNvbnNvbGUuaW5mbygnRGVidWc6JywgdGhpcy5leHByZXNzaW9uLCAnPScsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIHRleHRcbiAgICogQWRkcyBhIGJpbmRlciB0byBkaXNwbGF5IGVzY2FwZWQgdGV4dCBpbnNpZGUgYW4gZWxlbWVudC4gVGhpcyBjYW4gYmUgZG9uZSB3aXRoIGJpbmRpbmcgZGlyZWN0bHkgaW4gdGV4dCBub2RlcyBidXRcbiAgICogdXNpbmcgdGhlIGF0dHJpYnV0ZSBiaW5kZXIgcHJldmVudHMgYSBmbGFzaCBvZiB1bnN0eWxlZCBjb250ZW50IG9uIHRoZSBtYWluIHBhZ2UuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxoMSB0ZXh0PVwie3twb3N0LnRpdGxlfX1cIj5VbnRpdGxlZDwvaDE+XG4gICAqIDxkaXYgaHRtbD1cInt7cG9zdC5ib2R5IHwgbWFya2Rvd259fVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiA8ZGl2PlxuICAgKiAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICA8cD5cbiAgICogICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgPC9wPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3RleHQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGh0bWxcbiAgICogQWRkcyBhIGJpbmRlciB0byBkaXNwbGF5IHVuZXNjYXBlZCBIVE1MIGluc2lkZSBhbiBlbGVtZW50LiBCZSBzdXJlIGl0J3MgdHJ1c3RlZCEgVGhpcyBzaG91bGQgYmUgdXNlZCB3aXRoIGZpbHRlcnNcbiAgICogd2hpY2ggY3JlYXRlIEhUTUwgZnJvbSBzb21ldGhpbmcgc2FmZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPnt7cG9zdC50aXRsZX19PC9oMT5cbiAgICogPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqIDxkaXY+XG4gICAqICAgPHA+TGl0dGxlIFJlZCBSaWRpbmcgSG9vZCBpcyBhIHN0b3J5IGFib3V0IGEgbGl0dGxlIGdpcmwuPC9wPlxuICAgKiAgIDxwPlxuICAgKiAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGl0dGxlX1JlZF9SaWRpbmdfSG9vZFwiPldpa2lwZWRpYTwvYT5cbiAgICogICA8L3A+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnaHRtbCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdGhpcy5lbGVtZW50LmlubmVySFRNTCA9ICh2YWx1ZSA9PSBudWxsID8gJycgOiB2YWx1ZSk7XG4gIH0pO1xuXG5cblxuICAvKipcbiAgICogIyMgY2xhc3MtW2NsYXNzTmFtZV1cbiAgICogQWRkcyBhIGJpbmRlciB0byBhZGQgY2xhc3NlcyB0byBhbiBlbGVtZW50IGRlcGVuZGVudCBvbiB3aGV0aGVyIHRoZSBleHByZXNzaW9uIGlzIHRydWUgb3IgZmFsc2UuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJ1c2VyLWl0ZW1cIiBjbGFzcy1zZWxlY3RlZC11c2VyPVwie3tzZWxlY3RlZCA9PT0gdXNlcn19XCI+XG4gICAqICAgPGJ1dHRvbiBjbGFzcz1cImJ0biBwcmltYXJ5XCIgY2xhc3MtaGlnaGxpZ2h0PVwie3tyZWFkeX19XCI+PC9idXR0b24+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiBgc2VsZWN0ZWRgIGVxdWFscyB0aGUgYHVzZXJgIGFuZCBgcmVhZHlgIGlzIGB0cnVlYDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cInVzZXItaXRlbSBzZWxlY3RlZC11c2VyXCI+XG4gICAqICAgPGJ1dHRvbiBjbGFzcz1cImJ0biBwcmltYXJ5IGhpZ2hsaWdodFwiPjwvYnV0dG9uPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NsYXNzLSonLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LmNsYXNzTGlzdC5hZGQodGhpcy5tYXRjaCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5jbGFzc0xpc3QucmVtb3ZlKHRoaXMubWF0Y2gpO1xuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIFdoZW4gd29ya2luZyB3aXRoIGEgYm91bmQgY2xhc3MgYXR0cmlidXRlLCBtYWtlIHN1cmUgaXQgZG9lc24ndCBzdG9wIG9uIGNsYXNzLSogYXR0cmlidXRlcy5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnY2xhc3MnLCB7XG4gICAgb25seVdoZW5Cb3VuZDogdHJ1ZSxcbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgdmFyIGNsYXNzTGlzdCA9IHRoaXMuZWxlbWVudC5jbGFzc0xpc3Q7XG4gICAgICBpZiAodGhpcy5jbGFzc2VzKSB7XG4gICAgICAgIHRoaXMuY2xhc3Nlcy5mb3JFYWNoKGZ1bmN0aW9uKGNsYXNzTmFtZSkge1xuICAgICAgICAgIGlmIChjbGFzc05hbWUpIHtcbiAgICAgICAgICAgIGNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuY2xhc3NlcyA9IHZhbHVlLnNwbGl0KC9cXHMrLyk7XG4gICAgICAgIHRoaXMuY2xhc3Nlcy5mb3JFYWNoKGZ1bmN0aW9uKGNsYXNzTmFtZSkge1xuICAgICAgICAgIGlmIChjbGFzc05hbWUpIHtcbiAgICAgICAgICAgIGNsYXNzTGlzdC5hZGQoY2xhc3NOYW1lKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQXV0b21hdGljYWxseSBmb2N1c2VzIHRoZSBpbnB1dCB3aGVuIGl0IGlzIGRpc3BsYXllZCBvbiBzY3JlZW4uXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2F1dG9mb2N1cycsIHtcbiAgICBib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgIGVsZW1lbnQuZm9jdXMoKTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQXV0b21hdGljYWxseSBzZWxlY3RzIHRoZSBjb250ZW50cyBvZiBhbiBpbnB1dCB3aGVuIGl0IHJlY2VpdmVzIGZvY3VzLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdhdXRvc2VsZWN0Jywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGZvY3VzZWQsIG1vdXNlRXZlbnQ7XG5cbiAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdtb3VzZWRvd24nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgLy8gVXNlIG1hdGNoZXMgc2luY2UgZG9jdW1lbnQuYWN0aXZlRWxlbWVudCBkb2Vzbid0IHdvcmsgd2VsbCB3aXRoIHdlYiBjb21wb25lbnRzIChmdXR1cmUgY29tcGF0KVxuICAgICAgICBmb2N1c2VkID0gdGhpcy5tYXRjaGVzKCc6Zm9jdXMnKTtcbiAgICAgICAgbW91c2VFdmVudCA9IHRydWU7XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2ZvY3VzJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghbW91c2VFdmVudCkge1xuICAgICAgICAgIHRoaXMuc2VsZWN0KCk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignbW91c2V1cCcsIGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoIWZvY3VzZWQpIHtcbiAgICAgICAgICB0aGlzLnNlbGVjdCgpO1xuICAgICAgICB9XG4gICAgICAgIG1vdXNlRXZlbnQgPSBmYWxzZTtcbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyB2YWx1ZVxuICAgKiBBZGRzIGEgYmluZGVyIHdoaWNoIHNldHMgdGhlIHZhbHVlIG9mIGFuIEhUTUwgZm9ybSBlbGVtZW50LiBUaGlzIGJpbmRlciBhbHNvIHVwZGF0ZXMgdGhlIGRhdGEgYXMgaXQgaXMgY2hhbmdlZCBpblxuICAgKiB0aGUgZm9ybSBlbGVtZW50LCBwcm92aWRpbmcgdHdvIHdheSBiaW5kaW5nLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+Rmlyc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cInVzZXIuZmlyc3ROYW1lXCI+XG4gICAqXG4gICAqIDxsYWJlbD5MYXN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwibGFzdE5hbWVcIiB2YWx1ZT1cInVzZXIubGFzdE5hbWVcIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5GaXJzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICpcbiAgICogPGxhYmVsPkxhc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJsYXN0TmFtZVwiIHZhbHVlPVwiV3JpZ2h0XCI+XG4gICAqIGBgYFxuICAgKiBBbmQgd2hlbiB0aGUgdXNlciBjaGFuZ2VzIHRoZSB0ZXh0IGluIHRoZSBmaXJzdCBpbnB1dCB0byBcIkphY1wiLCBgdXNlci5maXJzdE5hbWVgIHdpbGwgYmUgdXBkYXRlZCBpbW1lZGlhdGVseSB3aXRoXG4gICAqIHRoZSB2YWx1ZSBvZiBgJ0phYydgLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd2YWx1ZScsIHtcbiAgICBvbmx5V2hlbkJvdW5kOiB0cnVlLFxuICAgIGV2ZW50c0F0dHJOYW1lOiAndmFsdWUtZXZlbnRzJyxcbiAgICBmaWVsZEF0dHJOYW1lOiAndmFsdWUtZmllbGQnLFxuICAgIGRlZmF1bHRFdmVudHM6IFsgJ2NoYW5nZScgXSxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBuYW1lID0gdGhpcy5lbGVtZW50LnRhZ05hbWUudG9Mb3dlckNhc2UoKTtcbiAgICAgIHZhciB0eXBlID0gdGhpcy5lbGVtZW50LnR5cGU7XG4gICAgICB0aGlzLm1ldGhvZHMgPSBpbnB1dE1ldGhvZHNbdHlwZV0gfHwgaW5wdXRNZXRob2RzW25hbWVdO1xuXG4gICAgICBpZiAoIXRoaXMubWV0aG9kcykge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmVsZW1lbnQuaGFzQXR0cmlidXRlKHRoaXMuZXZlbnRzQXR0ck5hbWUpKSB7XG4gICAgICAgIHRoaXMuZXZlbnRzID0gdGhpcy5lbGVtZW50LmdldEF0dHJpYnV0ZSh0aGlzLmV2ZW50c0F0dHJOYW1lKS5zcGxpdCgnICcpO1xuICAgICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMuZXZlbnRzQXR0ck5hbWUpO1xuICAgICAgfSBlbHNlIGlmIChuYW1lICE9PSAnb3B0aW9uJykge1xuICAgICAgICB0aGlzLmV2ZW50cyA9IHRoaXMuZGVmYXVsdEV2ZW50cztcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuZWxlbWVudC5oYXNBdHRyaWJ1dGUodGhpcy5maWVsZEF0dHJOYW1lKSkge1xuICAgICAgICB0aGlzLnZhbHVlRmllbGQgPSB0aGlzLmVsZW1lbnQuZ2V0QXR0cmlidXRlKHRoaXMuZmllbGRBdHRyTmFtZSk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5maWVsZEF0dHJOYW1lKTtcbiAgICAgIH1cblxuICAgICAgaWYgKHR5cGUgPT09ICdvcHRpb24nKSB7XG4gICAgICAgIHRoaXMudmFsdWVGaWVsZCA9IHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLnZhbHVlRmllbGQ7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCF0aGlzLmV2ZW50cykgcmV0dXJuOyAvLyBub3RoaW5nIGZvciA8b3B0aW9uPiBoZXJlXG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHZhciBvYnNlcnZlciA9IHRoaXMub2JzZXJ2ZXI7XG4gICAgICB2YXIgaW5wdXQgPSB0aGlzLm1ldGhvZHM7XG4gICAgICB2YXIgdmFsdWVGaWVsZCA9IHRoaXMudmFsdWVGaWVsZDtcblxuICAgICAgLy8gVGhlIDItd2F5IGJpbmRpbmcgcGFydCBpcyBzZXR0aW5nIHZhbHVlcyBvbiBjZXJ0YWluIGV2ZW50c1xuICAgICAgZnVuY3Rpb24gb25DaGFuZ2UoKSB7XG4gICAgICAgIGlmIChpbnB1dC5nZXQuY2FsbChlbGVtZW50LCB2YWx1ZUZpZWxkKSAhPT0gb2JzZXJ2ZXIub2xkVmFsdWUgJiYgIWVsZW1lbnQucmVhZE9ubHkpIHtcbiAgICAgICAgICBvYnNlcnZlci5zZXQoaW5wdXQuZ2V0LmNhbGwoZWxlbWVudCwgdmFsdWVGaWVsZCkpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIGlmIChlbGVtZW50LnR5cGUgPT09ICd0ZXh0Jykge1xuICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ2tleWRvd24nLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICAgIGlmIChldmVudC5rZXlDb2RlID09PSAxMykgb25DaGFuZ2UoKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHRoaXMuZXZlbnRzLmZvckVhY2goZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50LCBvbkNoYW5nZSk7XG4gICAgICB9KTtcbiAgICB9LFxuXG4gICAgdXBkYXRlZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICh0aGlzLm1ldGhvZHMuZ2V0LmNhbGwodGhpcy5lbGVtZW50LCB0aGlzLnZhbHVlRmllbGQpICE9IHZhbHVlKSB7XG4gICAgICAgIHRoaXMubWV0aG9kcy5zZXQuY2FsbCh0aGlzLmVsZW1lbnQsIHZhbHVlLCB0aGlzLnZhbHVlRmllbGQpO1xuICAgICAgfVxuICAgIH1cbiAgfSk7XG5cbiAgLyoqXG4gICAqIEhhbmRsZSB0aGUgZGlmZmVyZW50IGZvcm0gdHlwZXNcbiAgICovXG4gIHZhciBkZWZhdWx0SW5wdXRNZXRob2QgPSB7XG4gICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMudmFsdWU7IH0sXG4gICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkgeyB0aGlzLnZhbHVlID0gKHZhbHVlID09IG51bGwpID8gJycgOiB2YWx1ZTsgfVxuICB9O1xuXG4gIHZhciBpbnB1dE1ldGhvZHMgPSB7XG4gICAgY2hlY2tib3g6IHtcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmNoZWNrZWQ7IH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7IHRoaXMuY2hlY2tlZCA9ICEhdmFsdWU7IH1cbiAgICB9LFxuXG4gICAgZmlsZToge1xuICAgICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuZmlsZXMgJiYgdGhpcy5maWxlc1swXTsgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHt9XG4gICAgfSxcblxuICAgIHNlbGVjdDoge1xuICAgICAgZ2V0OiBmdW5jdGlvbih2YWx1ZUZpZWxkKSB7XG4gICAgICAgIGlmICh2YWx1ZUZpZWxkKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3B0aW9uc1t0aGlzLnNlbGVjdGVkSW5kZXhdLnZhbHVlT2JqZWN0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB0aGlzLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSwgdmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWVGaWVsZCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPYmplY3QgPSB2YWx1ZTtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVbdmFsdWVGaWVsZF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgb3B0aW9uOiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKHZhbHVlRmllbGQpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlRmllbGQgPyB0aGlzLnZhbHVlT2JqZWN0W3ZhbHVlRmllbGRdIDogdGhpcy52YWx1ZTtcbiAgICAgIH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlLCB2YWx1ZUZpZWxkKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZUZpZWxkKSB7XG4gICAgICAgICAgdGhpcy52YWx1ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZVt2YWx1ZUZpZWxkXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gKHZhbHVlID09IG51bGwpID8gJycgOiB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBpbnB1dDogZGVmYXVsdElucHV0TWV0aG9kLFxuXG4gICAgdGV4dGFyZWE6IGRlZmF1bHRJbnB1dE1ldGhvZFxuICB9O1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciBmb3IgZWFjaCBldmVudCBuYW1lIGluIHRoZSBhcnJheS4gV2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkIHRoZSBleHByZXNzaW9uIHdpbGwgYmUgcnVuLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tY2xpY2tcbiAgICogKiBvbi1kYmxjbGlja1xuICAgKiAqIG9uLXN1Ym1pdFxuICAgKiAqIG9uLWNoYW5nZVxuICAgKiAqIG9uLWZvY3VzXG4gICAqICogb24tYmx1clxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8Zm9ybSBvbi1zdWJtaXQ9XCJ7e3NhdmVVc2VyKCl9fVwiPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IChldmVudHMgZG9uJ3QgYWZmZWN0IHRoZSBIVE1MKToqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0+XG4gICAqICAgPGlucHV0IG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqICAgPGJ1dHRvbj5TYXZlPC9idXR0b24+XG4gICAqIDwvZm9ybT5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ29uLSonLCB7XG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZXZlbnROYW1lID0gdGhpcy5tYXRjaDtcbiAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGlmICghdGhpcy5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJykgJiYgX3RoaXMuY29udGV4dCkge1xuICAgICAgICAgIC8vIFNldCB0aGUgZXZlbnQgb24gdGhlIGNvbnRleHQgc28gaXQgbWF5IGJlIHVzZWQgaW4gdGhlIGV4cHJlc3Npb24gd2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkLlxuICAgICAgICAgIHZhciBwcmlvckV2ZW50ID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihfdGhpcy5jb250ZXh0LCAnZXZlbnQnKTtcbiAgICAgICAgICB2YXIgcHJpb3JFbGVtZW50ID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihfdGhpcy5jb250ZXh0LCAnZWxlbWVudCcpO1xuICAgICAgICAgIF90aGlzLmNvbnRleHQuZXZlbnQgPSBldmVudDtcbiAgICAgICAgICBfdGhpcy5jb250ZXh0LmVsZW1lbnQgPSBfdGhpcy5lbGVtZW50O1xuXG4gICAgICAgICAgLy8gTGV0IGFuIG9uLVtldmVudF0gbWFrZSB0aGUgZnVuY3Rpb24gY2FsbCB3aXRoIGl0cyBvd24gYXJndW1lbnRzXG4gICAgICAgICAgdmFyIGxpc3RlbmVyID0gX3RoaXMub2JzZXJ2ZXIuZ2V0KCk7XG5cbiAgICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIGxpc3RlbmVyLmNhbGwoX3RoaXMuY29udGV4dCwgZXZlbnQpO1xuXG4gICAgICAgICAgLy8gUmVzZXQgdGhlIGNvbnRleHQgdG8gaXRzIHByaW9yIHN0YXRlXG4gICAgICAgICAgaWYgKHByaW9yRXZlbnQpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShfdGhpcy5jb250ZXh0LCAnZXZlbnQnLCBwcmlvckV2ZW50KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVsZXRlIF90aGlzLmNvbnRleHQuZXZlbnQ7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHByaW9yRWxlbWVudCkge1xuICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KF90aGlzLmNvbnRleHQsICdlbGVtZW50JywgcHJpb3JFbGVtZW50KTtcbiAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgZGVsZXRlIF90aGlzLmNvbnRleHQuZWxlbWVudDtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgb24tW2tleSBldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciB3aGljaCBpcyB0cmlnZ2VyZWQgd2hlbiB0aGUga2V5ZG93biBldmVudCdzIGBrZXlDb2RlYCBwcm9wZXJ0eSBtYXRjaGVzLiBJZiB0aGUgbmFtZSBpbmNsdWRlcyBjdHJsXG4gICAqIHRoZW4gaXQgd2lsbCBvbmx5IGZpcmUgd2hlbiB0aGUga2V5IHBsdXMgdGhlIGN0cmxLZXkgb3IgbWV0YUtleSBpcyBwcmVzc2VkLlxuICAgKlxuICAgKiAqKktleSBFdmVudHM6KipcbiAgICpcbiAgICogKiBvbi1lbnRlclxuICAgKiAqIG9uLWN0cmwtZW50ZXJcbiAgICogKiBvbi1lc2NcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGlucHV0IG9uLWVudGVyPVwie3tzYXZlKCl9fVwiIG9uLWVzYz1cInt7Y2FuY2VsKCl9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGlucHV0PlxuICAgKiBgYGBcbiAgICovXG4gIHZhciBrZXlDb2RlcyA9IHsgZW50ZXI6IDEzLCBlc2M6IDI3LCAnY3RybC1lbnRlcic6IDEzIH07XG5cbiAgT2JqZWN0LmtleXMoa2V5Q29kZXMpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBrZXlDb2RlID0ga2V5Q29kZXNbbmFtZV07XG5cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ29uLScgKyBuYW1lLCB7XG4gICAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHVzZUN0cmxLZXkgPSBuYW1lLmluZGV4T2YoJ2N0cmwtJykgPT09IDA7XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAodXNlQ3RybEtleSAmJiAhKGV2ZW50LmN0cmxLZXkgfHwgZXZlbnQubWV0YUtleSkgfHwgIV90aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoZXZlbnQua2V5Q29kZSAhPT0ga2V5Q29kZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cbiAgICAgICAgICBpZiAoIXRoaXMuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpKSB7XG4gICAgICAgICAgICAvLyBTZXQgdGhlIGV2ZW50IG9uIHRoZSBjb250ZXh0IHNvIGl0IG1heSBiZSB1c2VkIGluIHRoZSBleHByZXNzaW9uIHdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZC5cbiAgICAgICAgICAgIHZhciBwcmlvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2V2ZW50Jyk7XG4gICAgICAgICAgICBfdGhpcy5jb250ZXh0LmV2ZW50ID0gZXZlbnQ7XG5cbiAgICAgICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICAgICAgdmFyIGxpc3RlbmVyID0gX3RoaXMub2JzZXJ2ZXIuZ2V0KCk7XG5cbiAgICAgICAgICAgIC8vIE9yIGp1c3QgcmV0dXJuIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCBiZSBjYWxsZWQgd2l0aCB0aGUgZXZlbnQgb2JqZWN0XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcblxuICAgICAgICAgICAgLy8gUmVzZXQgdGhlIGNvbnRleHQgdG8gaXRzIHByaW9yIHN0YXRlXG4gICAgICAgICAgICBpZiAocHJpb3IpIHtcbiAgICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KF90aGlzLmNvbnRleHQsIGV2ZW50LCBwcmlvcik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBkZWxldGUgX3RoaXMuY29udGV4dC5ldmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pXG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIFthdHRyaWJ1dGVdJFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIHNldCB0aGUgYXR0cmlidXRlIG9mIGVsZW1lbnQgdG8gdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLiBVc2UgdGhpcyB3aGVuIHlvdSBkb24ndCB3YW50IGFuXG4gICAqIGA8aW1nPmAgdG8gdHJ5IGFuZCBsb2FkIGl0cyBgc3JjYCBiZWZvcmUgYmVpbmcgZXZhbHVhdGVkLiBUaGlzIGlzIG9ubHkgbmVlZGVkIG9uIHRoZSBpbmRleC5odG1sIHBhZ2UgYXMgdGVtcGxhdGVcbiAgICogd2lsbCBiZSBwcm9jZXNzZWQgYmVmb3JlIGJlaW5nIGluc2VydGVkIGludG8gdGhlIERPTS4gR2VuZXJhbGx5IHlvdSBjYW4ganVzdCB1c2UgYGF0dHI9XCJ7e2V4cHJ9fVwiYC5cbiAgICpcbiAgICogKipFeGFtcGxlIEF0dHJpYnV0ZXM6KipcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGltZyBzcmMkPVwie3t1c2VyLmF2YXRhclVybH19XCI+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aW1nIHNyYz1cImh0dHA6Ly9jZG4uZXhhbXBsZS5jb20vYXZhdGFycy9qYWN3cmlnaHQtc21hbGwucG5nXCI+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCcqJCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGF0dHJOYW1lID0gdGhpcy5tYXRjaDtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZShhdHRyTmFtZSwgdmFsdWUpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgW2F0dHJpYnV0ZV0/XG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gdG9nZ2xlIGFuIGF0dHJpYnV0ZSBvbiBvciBvZmYgaWYgdGhlIGV4cHJlc3Npb24gaXMgdHJ1dGh5IG9yIGZhbHNleS4gVXNlIGZvciBhdHRyaWJ1dGVzIHdpdGhvdXRcbiAgICogdmFsdWVzIHN1Y2ggYXMgYHNlbGVjdGVkYCwgYGRpc2FibGVkYCwgb3IgYHJlYWRvbmx5YC4gYGNoZWNrZWQ/YCB3aWxsIHVzZSAyLXdheSBkYXRhYmluZGluZy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPklzIEFkbWluaXN0cmF0b3I8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCIgY2hlY2tlZD89XCJ7e3VzZXIuaXNBZG1pbn19XCI+XG4gICAqIDxidXR0b24gZGlzYWJsZWQ/PVwie3tpc1Byb2Nlc3Npbmd9fVwiPlN1Ym1pdDwvYnV0dG9uPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiBgaXNQcm9jZXNzaW5nYCBpcyBgdHJ1ZWAgYW5kIGB1c2VyLmlzQWRtaW5gIGlzIGZhbHNlOipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+SXMgQWRtaW5pc3RyYXRvcjwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwiY2hlY2tib3hcIj5cbiAgICogPGJ1dHRvbiBkaXNhYmxlZD5TdWJtaXQ8L2J1dHRvbj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJyo/JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YXIgYXR0ck5hbWUgPSB0aGlzLm1hdGNoO1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUoYXR0ck5hbWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKGF0dHJOYW1lLCAnJyk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiBBZGQgYSBjbG9uZSBvZiB0aGUgYHZhbHVlYCBiaW5kZXIgZm9yIGBjaGVja2VkP2Agc28gY2hlY2tib3hlcyBjYW4gaGF2ZSB0d28td2F5IGJpbmRpbmcgdXNpbmcgYGNoZWNrZWQ/YC5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnY2hlY2tlZD8nLCBmcmFnbWVudHMuZ2V0QXR0cmlidXRlQmluZGVyKCd2YWx1ZScpKTtcblxuXG4gIC8qKlxuICAgKiBTaG93cy9oaWRlcyBhbiBlbGVtZW50IGNvbmRpdGlvbmFsbHkuIGBpZmAgc2hvdWxkIGJlIHVzZWQgaW4gbW9zdCBjYXNlcyBhcyBpdCByZW1vdmVzIHRoZSBlbGVtZW50IGNvbXBsZXRlbHkgYW5kIGlzXG4gICAqIG1vcmUgZWZmZWNpZW50IHNpbmNlIGJpbmRpbmdzIHdpdGhpbiB0aGUgYGlmYCBhcmUgbm90IGFjdGl2ZSB3aGlsZSBpdCBpcyBoaWRkZW4uIFVzZSBgc2hvd2AgZm9yIHdoZW4gdGhlIGVsZW1lbnRcbiAgICogbXVzdCByZW1haW4gaW4tRE9NIG9yIGJpbmRpbmdzIHdpdGhpbiBpdCBtdXN0IGNvbnRpbnVlIHRvIGJlIHByb2Nlc3NlZCB3aGlsZSBpdCBpcyBoaWRkZW4uIFlvdSBzaG91bGQgZGVmYXVsdCB0b1xuICAgKiB1c2luZyBgaWZgLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdzaG93Jywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAvLyBGb3IgcGVyZm9ybWFuY2UgcHJvdmlkZSBhbiBhbHRlcm5hdGUgY29kZSBwYXRoIGZvciBhbmltYXRpb25cbiAgICAgIGlmICh0aGlzLmFuaW1hdGUgJiYgdGhpcy5jb250ZXh0KSB7XG4gICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKHZhbHVlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudXBkYXRlZFJlZ3VsYXIodmFsdWUpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVkUmVndWxhcjogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuZGlzcGxheSA9ICcnO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZWRBbmltYXRlZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIHRoaXMubGFzdFZhbHVlID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICBmdW5jdGlvbiBvbkZpbmlzaCgpIHtcbiAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgaWYgKHRoaXMubGFzdFZhbHVlICE9PSB2YWx1ZSkge1xuICAgICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKHRoaXMubGFzdFZhbHVlKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odGhpcy5lbGVtZW50LCBvbkZpbmlzaCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmFuaW1hdGVPdXQodGhpcy5lbGVtZW50LCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgICAgICAgICBvbkZpbmlzaC5jYWxsKHRoaXMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc3R5bGUuZGlzcGxheSA9ICcnO1xuICAgICAgdGhpcy5sYXN0VmFsdWUgPSBudWxsO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGlmLCB1bmxlc3MsIGVsc2UtaWYsIGVsc2UtdW5sZXNzLCBlbHNlXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gc2hvdyBvciBoaWRlIHRoZSBlbGVtZW50IGlmIHRoZSB2YWx1ZSBpcyB0cnV0aHkgb3IgZmFsc2V5LiBBY3R1YWxseSByZW1vdmVzIHRoZSBlbGVtZW50IGZyb20gdGhlXG4gICAqIERPTSB3aGVuIGhpZGRlbiwgcmVwbGFjaW5nIGl0IHdpdGggYSBub24tdmlzaWJsZSBwbGFjZWhvbGRlciBhbmQgbm90IG5lZWRsZXNzbHkgZXhlY3V0aW5nIGJpbmRpbmdzIGluc2lkZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPHVsIGNsYXNzPVwiaGVhZGVyLWxpbmtzXCI+XG4gICAqICAgPGxpIGlmPVwidXNlclwiPjxhIGhyZWY9XCIvYWNjb3VudFwiPk15IEFjY291bnQ8L2E+PC9saT5cbiAgICogICA8bGkgdW5sZXNzPVwidXNlclwiPjxhIGhyZWY9XCIvbG9naW5cIj5TaWduIEluPC9hPjwvbGk+XG4gICAqICAgPGxpIGVsc2U+PGEgaHJlZj1cIi9sb2dvdXRcIj5TaWduIE91dDwvYT48L2xpPlxuICAgKiA8L3VsPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiBgdXNlcmAgaXMgbnVsbDoqXG4gICAqIGBgYGh0bWxcbiAgICogPHVsIGNsYXNzPVwiaGVhZGVyLWxpbmtzXCI+XG4gICAqICAgPGxpPjxhIGhyZWY9XCIvbG9naW5cIj5TaWduIEluPC9hPjwvbGk+XG4gICAqIDwvdWw+XG4gICAqIGBgYFxuICAgKi9cbiAgdmFyIElmQmluZGluZyA9IGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnaWYnLCB7XG4gICAgYW5pbWF0ZWQ6IHRydWUsXG4gICAgcHJpb3JpdHk6IDE1MCxcbiAgICB1bmxlc3NBdHRyTmFtZTogJ3VubGVzcycsXG4gICAgZWxzZUlmQXR0ck5hbWU6ICdlbHNlLWlmJyxcbiAgICBlbHNlVW5sZXNzQXR0ck5hbWU6ICdlbHNlLXVubGVzcycsXG4gICAgZWxzZUF0dHJOYW1lOiAnZWxzZScsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZWxlbWVudCA9IHRoaXMuZWxlbWVudDtcbiAgICAgIHZhciBleHByZXNzaW9ucyA9IFsgd3JhcElmRXhwKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy5uYW1lID09PSB0aGlzLnVubGVzc0F0dHJOYW1lKSBdO1xuICAgICAgdmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgdmFyIG5vZGUgPSBlbGVtZW50Lm5leHRFbGVtZW50U2libGluZztcbiAgICAgIHRoaXMuZWxlbWVudCA9IHBsYWNlaG9sZGVyO1xuICAgICAgZWxlbWVudC5wYXJlbnROb2RlLnJlcGxhY2VDaGlsZChwbGFjZWhvbGRlciwgZWxlbWVudCk7XG5cbiAgICAgIC8vIFN0b3JlcyBhIHRlbXBsYXRlIGZvciBhbGwgdGhlIGVsZW1lbnRzIHRoYXQgY2FuIGdvIGludG8gdGhpcyBzcG90XG4gICAgICB0aGlzLnRlbXBsYXRlcyA9IFsgZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKGVsZW1lbnQpIF07XG5cbiAgICAgIC8vIFB1bGwgb3V0IGFueSBvdGhlciBlbGVtZW50cyB0aGF0IGFyZSBjaGFpbmVkIHdpdGggdGhpcyBvbmVcbiAgICAgIHdoaWxlIChub2RlKSB7XG4gICAgICAgIHZhciBuZXh0ID0gbm9kZS5uZXh0RWxlbWVudFNpYmxpbmc7XG4gICAgICAgIHZhciBleHByZXNzaW9uO1xuICAgICAgICBpZiAobm9kZS5oYXNBdHRyaWJ1dGUodGhpcy5lbHNlSWZBdHRyTmFtZSkpIHtcbiAgICAgICAgICBleHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIG5vZGUuZ2V0QXR0cmlidXRlKHRoaXMuZWxzZUlmQXR0ck5hbWUpKTtcbiAgICAgICAgICBleHByZXNzaW9ucy5wdXNoKHdyYXBJZkV4cChleHByZXNzaW9uLCBmYWxzZSkpO1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKHRoaXMuZWxzZUlmQXR0ck5hbWUpO1xuICAgICAgICB9IGVsc2UgaWYgKG5vZGUuaGFzQXR0cmlidXRlKHRoaXMuZWxzZVVubGVzc0F0dHJOYW1lKSkge1xuICAgICAgICAgIGV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgbm9kZS5nZXRBdHRyaWJ1dGUodGhpcy5lbHNlVW5sZXNzQXR0ck5hbWUpKTtcbiAgICAgICAgICBleHByZXNzaW9ucy5wdXNoKHdyYXBJZkV4cChleHByZXNzaW9uLCB0cnVlKSk7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUodGhpcy5lbHNlVW5sZXNzQXR0ck5hbWUpO1xuICAgICAgICB9IGVsc2UgaWYgKG5vZGUuaGFzQXR0cmlidXRlKHRoaXMuZWxzZUF0dHJOYW1lKSkge1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKHRoaXMuZWxzZUF0dHJOYW1lKTtcbiAgICAgICAgICBuZXh0ID0gbnVsbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBicmVhaztcbiAgICAgICAgfVxuXG4gICAgICAgIG5vZGUucmVtb3ZlKCk7XG4gICAgICAgIHRoaXMudGVtcGxhdGVzLnB1c2goZnJhZ21lbnRzLmNyZWF0ZVRlbXBsYXRlKG5vZGUpKTtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICB9XG5cbiAgICAgIC8vIEFuIGV4cHJlc3Npb24gdGhhdCB3aWxsIHJldHVybiBhbiBpbmRleC4gU29tZXRoaW5nIGxpa2UgdGhpcyBgZXhwciA/IDAgOiBleHByMiA/IDEgOiBleHByMyA/IDIgOiAzYC4gVGhpcyB3aWxsXG4gICAgICAvLyBiZSB1c2VkIHRvIGtub3cgd2hpY2ggc2VjdGlvbiB0byBzaG93IGluIHRoZSBpZi9lbHNlLWlmL2Vsc2UgZ3JvdXBpbmcuXG4gICAgICB0aGlzLmV4cHJlc3Npb24gPSBleHByZXNzaW9ucy5tYXAoZnVuY3Rpb24oZXhwciwgaW5kZXgpIHtcbiAgICAgICAgcmV0dXJuIGV4cHIgKyAnID8gJyArIGluZGV4ICsgJyA6ICc7XG4gICAgICB9KS5qb2luKCcnKSArIGV4cHJlc3Npb25zLmxlbmd0aDtcbiAgICB9LFxuXG4gICAgdXBkYXRlZDogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIC8vIEZvciBwZXJmb3JtYW5jZSBwcm92aWRlIGFuIGFsdGVybmF0ZSBjb2RlIHBhdGggZm9yIGFuaW1hdGlvblxuICAgICAgaWYgKHRoaXMuYW5pbWF0ZSAmJiB0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQoaW5kZXgpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy51cGRhdGVkUmVndWxhcihpbmRleCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGFkZDogZnVuY3Rpb24odmlldykge1xuICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKHZpZXcsIHRoaXMuZWxlbWVudC5uZXh0U2libGluZyk7XG4gICAgfSxcblxuICAgIC8vIERvZXNuJ3QgZG8gbXVjaCwgYnV0IGFsbG93cyBzdWItY2xhc3NlcyB0byBhbHRlciB0aGUgZnVuY3Rpb25hbGl0eS5cbiAgICByZW1vdmU6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkUmVndWxhcjogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5yZW1vdmUodGhpcy5zaG93aW5nKTtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gbnVsbDtcbiAgICAgIH1cbiAgICAgIHZhciB0ZW1wbGF0ZSA9IHRoaXMudGVtcGxhdGVzW2luZGV4XTtcbiAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnNob3dpbmcgPSB0ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICAgIHRoaXMuc2hvd2luZy5iaW5kKHRoaXMuY29udGV4dCk7XG4gICAgICAgIHRoaXMuYWRkKHRoaXMuc2hvd2luZyk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVwZGF0ZWRBbmltYXRlZDogZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIHRoaXMubGFzdFZhbHVlID0gaW5kZXg7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgLy8gT2Jzb2xldGVkLCB3aWxsIGNoYW5nZSBhZnRlciBhbmltYXRpb24gaXMgZmluaXNoZWQuXG4gICAgICAgIHRoaXMuc2hvd2luZy51bmJpbmQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5zaG93aW5nLnVuYmluZCgpO1xuICAgICAgICB0aGlzLmFuaW1hdGVPdXQodGhpcy5zaG93aW5nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuXG4gICAgICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICAgICAgLy8gTWFrZSBzdXJlIHRoaXMgd2Fzbid0IHVuYm91bmQgd2hpbGUgd2Ugd2VyZSBhbmltYXRpbmcgKGUuZy4gYnkgYSBwYXJlbnQgYGlmYCB0aGF0IGRvZXNuJ3QgYW5pbWF0ZSlcbiAgICAgICAgICAgIHRoaXMucmVtb3ZlKHRoaXMuc2hvd2luZyk7XG4gICAgICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAgIC8vIGZpbmlzaCBieSBhbmltYXRpbmcgdGhlIG5ldyBlbGVtZW50IGluIChpZiBhbnkpLCB1bmxlc3Mgbm8gbG9uZ2VyIGJvdW5kXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLnRlbXBsYXRlc1tpbmRleF07XG4gICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gdGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgICB0aGlzLnNob3dpbmcuYmluZCh0aGlzLmNvbnRleHQpO1xuICAgICAgICB0aGlzLmFkZCh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuYW5pbWF0ZUluKHRoaXMuc2hvd2luZywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgICAvLyBpZiB0aGUgdmFsdWUgY2hhbmdlZCB3aGlsZSB0aGlzIHdhcyBhbmltYXRpbmcgcnVuIGl0IGFnYWluXG4gICAgICAgICAgaWYgKHRoaXMubGFzdFZhbHVlICE9PSBpbmRleCkge1xuICAgICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICB9XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd1bmxlc3MnLCBJZkJpbmRpbmcpO1xuXG4gIGZ1bmN0aW9uIHdyYXBJZkV4cChleHByLCBpc1VubGVzcykge1xuICAgIGlmIChpc1VubGVzcykge1xuICAgICAgcmV0dXJuICchKCcgKyBleHByICsgJyknO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gZXhwcjtcbiAgICB9XG4gIH1cblxuXG4gIC8qKlxuICAgKiAjIyByZXBlYXRcbiAgICogQWRkcyBhIGJpbmRlciB0byBkdXBsaWNhdGUgYW4gZWxlbWVudCBmb3IgZWFjaCBpdGVtIGluIGFuIGFycmF5LiBUaGUgZXhwcmVzc2lvbiBtYXkgYmUgb2YgdGhlIGZvcm1hdCBgZXB4cmAgb3JcbiAgICogYGl0ZW1OYW1lIGluIGV4cHJgIHdoZXJlIGBpdGVtTmFtZWAgaXMgdGhlIG5hbWUgZWFjaCBpdGVtIGluc2lkZSB0aGUgYXJyYXkgd2lsbCBiZSByZWZlcmVuY2VkIGJ5IHdpdGhpbiBiaW5kaW5nc1xuICAgKiBpbnNpZGUgdGhlIGVsZW1lbnQuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgZWFjaD1cInt7cG9zdCBpbiBwb3N0c319XCIgY2xhc3MtZmVhdHVyZWQ9XCJ7e3Bvc3QuaXNGZWF0dXJlZH19XCI+XG4gICAqICAgPGgxPnt7cG9zdC50aXRsZX19PC9oMT5cbiAgICogICA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIHRoZXJlIGFyZSAyIHBvc3RzIGFuZCB0aGUgZmlyc3Qgb25lIGlzIGZlYXR1cmVkOipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwiZmVhdHVyZWRcIj5cbiAgICogICA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICAgIDxwPlxuICAgKiAgICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiA8ZGl2PlxuICAgKiAgIDxoMT5CaWcgQmx1ZTwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPlNvbWUgdGhvdWdodHMgb24gdGhlIE5ldyBZb3JrIEdpYW50cy48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9OZXdfWW9ya19HaWFudHNcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgncmVwZWF0Jywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiAxMDAsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGFyZW50ID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICB2YXIgcGxhY2Vob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyLCB0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy50ZW1wbGF0ZSA9IGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZSh0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy5lbGVtZW50ID0gcGxhY2Vob2xkZXI7XG5cbiAgICAgIHZhciBwYXJ0cyA9IHRoaXMuZXhwcmVzc2lvbi5zcGxpdCgvXFxzK2luXFxzKy8pO1xuICAgICAgdGhpcy5leHByZXNzaW9uID0gcGFydHMucG9wKCk7XG4gICAgICB2YXIga2V5ID0gcGFydHMucG9wKCk7XG4gICAgICBpZiAoa2V5KSB7XG4gICAgICAgIHBhcnRzID0ga2V5LnNwbGl0KC9cXHMqLFxccyovKTtcbiAgICAgICAgdGhpcy52YWx1ZU5hbWUgPSBwYXJ0cy5wb3AoKTtcbiAgICAgICAgdGhpcy5rZXlOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy52aWV3cyA9IFtdO1xuICAgICAgdGhpcy5vYnNlcnZlci5nZXRDaGFuZ2VSZWNvcmRzID0gdHJ1ZTtcbiAgICB9LFxuXG4gICAgcmVtb3ZlVmlldzogZnVuY3Rpb24odmlldykge1xuICAgICAgdmlldy5kaXNwb3NlKCk7XG4gICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IG51bGw7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKCFjaGFuZ2VzIHx8ICF0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5wb3B1bGF0ZSh2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5hbmltYXRlKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzQW5pbWF0ZWQodmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlcyh2YWx1ZSwgY2hhbmdlcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gTWV0aG9kIGZvciBjcmVhdGluZyBhbmQgc2V0dGluZyB1cCBuZXcgdmlld3MgZm9yIG91ciBsaXN0XG4gICAgY3JlYXRlVmlldzogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgdmFyIHZpZXcgPSB0aGlzLnRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgIHZhciBjb250ZXh0ID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy52YWx1ZU5hbWUpIHtcbiAgICAgICAgY29udGV4dCA9IE9iamVjdC5jcmVhdGUodGhpcy5jb250ZXh0KTtcbiAgICAgICAgaWYgKHRoaXMua2V5TmFtZSkgY29udGV4dFt0aGlzLmtleU5hbWVdID0ga2V5O1xuICAgICAgICBjb250ZXh0W3RoaXMudmFsdWVOYW1lXSA9IHZhbHVlO1xuICAgICAgICBjb250ZXh0Ll9vcmlnQ29udGV4dF8gPSB0aGlzLmNvbnRleHQuaGFzT3duUHJvcGVydHkoJ19vcmlnQ29udGV4dF8nKVxuICAgICAgICAgID8gdGhpcy5jb250ZXh0Ll9vcmlnQ29udGV4dF9cbiAgICAgICAgICA6IHRoaXMuY29udGV4dDtcbiAgICAgIH1cbiAgICAgIHZpZXcuYmluZChjb250ZXh0KTtcbiAgICAgIHZpZXcuX3JlcGVhdEl0ZW1fID0gdmFsdWU7XG4gICAgICByZXR1cm4gdmlldztcbiAgICB9LFxuXG4gICAgcG9wdWxhdGU6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gdmFsdWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMudmlld3MubGVuZ3RoKSB7XG4gICAgICAgIHRoaXMudmlld3MuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuICAgICAgICB0aGlzLnZpZXdzLmxlbmd0aCA9IDA7XG4gICAgICB9XG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiB2YWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG5cbiAgICAgICAgdmFsdWUuZm9yRWFjaChmdW5jdGlvbihpdGVtLCBpbmRleCkge1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGluZGV4LCBpdGVtKTtcbiAgICAgICAgICB0aGlzLnZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfSwgdGhpcyk7XG5cbiAgICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWcsIHRoaXMuZWxlbWVudC5uZXh0U2libGluZyk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgdW4tYW5pbWF0ZWQgdmVyc2lvbiByZW1vdmVzIGFsbCByZW1vdmVkIHZpZXdzIGZpcnN0IHNvIHRoZXkgY2FuIGJlIHJldHVybmVkIHRvIHRoZSBwb29sIGFuZCB0aGVuIGFkZHMgbmV3XG4gICAgICogdmlld3MgYmFjayBpbi4gVGhpcyBpcyB0aGUgbW9zdCBvcHRpbWFsIG1ldGhvZCB3aGVuIG5vdCBhbmltYXRpbmcuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlczogZnVuY3Rpb24odmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIC8vIFJlbW92ZSBldmVyeXRoaW5nIGZpcnN0LCB0aGVuIGFkZCBhZ2FpbiwgYWxsb3dpbmcgZm9yIGVsZW1lbnQgcmV1c2UgZnJvbSB0aGUgcG9vbFxuICAgICAgdmFyIGFkZGVkQ291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIGFkZGVkQ291bnQgKz0gc3BsaWNlLmFkZGVkQ291bnQ7XG4gICAgICAgIGlmICghc3BsaWNlLnJlbW92ZWQubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciByZW1vdmVkID0gdGhpcy52aWV3cy5zcGxpY2Uoc3BsaWNlLmluZGV4IC0gYWRkZWRDb3VudCwgc3BsaWNlLnJlbW92ZWQubGVuZ3RoKTtcbiAgICAgICAgcmVtb3ZlZC5mb3JFYWNoKHRoaXMucmVtb3ZlVmlldyk7XG4gICAgICB9LCB0aGlzKTtcblxuICAgICAgLy8gQWRkIHRoZSBuZXcvbW92ZWQgdmlld3NcbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UuYWRkZWRDb3VudCkgcmV0dXJuO1xuICAgICAgICB2YXIgYWRkZWRWaWV3cyA9IFtdO1xuICAgICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICAgIHZhciBpbmRleCA9IHNwbGljZS5pbmRleDtcbiAgICAgICAgdmFyIGVuZEluZGV4ID0gaW5kZXggKyBzcGxpY2UuYWRkZWRDb3VudDtcblxuICAgICAgICBmb3IgKHZhciBpID0gaW5kZXg7IGkgPCBlbmRJbmRleDsgaSsrKSB7XG4gICAgICAgICAgdmFyIGl0ZW0gPSB2YWx1ZVtpXTtcbiAgICAgICAgICB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIGFkZGVkVmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLnZpZXdzLnNwbGljZS5hcHBseSh0aGlzLnZpZXdzLCBbIGluZGV4LCAwIF0uY29uY2F0KGFkZGVkVmlld3MpKTtcbiAgICAgICAgdmFyIHByZXZpb3VzVmlldyA9IHRoaXMudmlld3NbaW5kZXggLSAxXTtcbiAgICAgICAgdmFyIG5leHRTaWJsaW5nID0gcHJldmlvdXNWaWV3ID8gcHJldmlvdXNWaWV3Lmxhc3RWaWV3Tm9kZS5uZXh0U2libGluZyA6IHRoaXMuZWxlbWVudC5uZXh0U2libGluZztcbiAgICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBuZXh0U2libGluZyk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9LFxuXG4gICAgLyoqXG4gICAgICogVGhpcyBhbmltYXRlZCB2ZXJzaW9uIG11c3QgYW5pbWF0ZSByZW1vdmVkIG5vZGVzIG91dCB3aGlsZSBhZGRlZCBub2RlcyBhcmUgYW5pbWF0aW5nIGluIG1ha2luZyBpdCBsZXNzIG9wdGltYWxcbiAgICAgKiAoYnV0IGNvb2wgbG9va2luZykuIEl0IGFsc28gaGFuZGxlcyBcIm1vdmVcIiBhbmltYXRpb25zIGZvciBub2RlcyB3aGljaCBhcmUgbW92aW5nIHBsYWNlIHdpdGhpbiB0aGUgbGlzdC5cbiAgICAgKi9cbiAgICB1cGRhdGVDaGFuZ2VzQW5pbWF0ZWQ6IGZ1bmN0aW9uKHZhbHVlLCBjaGFuZ2VzKSB7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gdmFsdWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciBhbmltYXRpbmdWYWx1ZSA9IHZhbHVlLnNsaWNlKCk7XG4gICAgICB2YXIgYWxsQWRkZWQgPSBbXTtcbiAgICAgIHZhciBhbGxSZW1vdmVkID0gW107XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG5cbiAgICAgIC8vIFJ1biB1cGRhdGVzIHdoaWNoIG9jY3VyZWQgd2hpbGUgdGhpcyB3YXMgYW5pbWF0aW5nLlxuICAgICAgZnVuY3Rpb24gd2hlbkRvbmUoKSB7XG4gICAgICAgIC8vIFRoZSBsYXN0IGFuaW1hdGlvbiBmaW5pc2hlZCB3aWxsIHJ1biB0aGlzXG4gICAgICAgIGlmICgtLXdoZW5Eb25lLmNvdW50ICE9PSAwKSByZXR1cm47XG5cbiAgICAgICAgYWxsUmVtb3ZlZC5mb3JFYWNoKHRoaXMucmVtb3ZlVmlldyk7XG5cbiAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICAgICAgaWYgKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZykge1xuICAgICAgICAgIHZhciBjaGFuZ2VzID0gZGlmZi5hcnJheXModGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nLCBhbmltYXRpbmdWYWx1ZSk7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzQW5pbWF0ZWQodGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nLCBjaGFuZ2VzKTtcbiAgICAgICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSBudWxsO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICB3aGVuRG9uZS5jb3VudCA9IDA7XG5cbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgdmFyIGFkZGVkVmlld3MgPSBbXTtcbiAgICAgICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgICB2YXIgaW5kZXggPSBzcGxpY2UuaW5kZXg7XG4gICAgICAgIHZhciBlbmRJbmRleCA9IGluZGV4ICsgc3BsaWNlLmFkZGVkQ291bnQ7XG4gICAgICAgIHZhciByZW1vdmVkQ291bnQgPSBzcGxpY2UucmVtb3ZlZC5sZW5ndGg7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IGluZGV4OyBpIDwgZW5kSW5kZXg7IGkrKykge1xuICAgICAgICAgIHZhciBpdGVtID0gdmFsdWVbaV07XG4gICAgICAgICAgdmFyIHZpZXcgPSB0aGlzLmNyZWF0ZVZpZXcoaSwgaXRlbSk7XG4gICAgICAgICAgYWRkZWRWaWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHZpZXcpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHJlbW92ZWRWaWV3cyA9IHRoaXMudmlld3Muc3BsaWNlLmFwcGx5KHRoaXMudmlld3MsIFsgaW5kZXgsIHJlbW92ZWRDb3VudCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuXG4gICAgICAgIGFsbEFkZGVkID0gYWxsQWRkZWQuY29uY2F0KGFkZGVkVmlld3MpO1xuICAgICAgICBhbGxSZW1vdmVkID0gYWxsUmVtb3ZlZC5jb25jYXQocmVtb3ZlZFZpZXdzKTtcbiAgICAgIH0sIHRoaXMpO1xuXG5cbiAgICAgIGFsbEFkZGVkLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICB3aGVuRG9uZS5jb3VudCsrO1xuICAgICAgICB0aGlzLmFuaW1hdGVJbih2aWV3LCB3aGVuRG9uZSk7XG4gICAgICB9LCB0aGlzKTtcblxuICAgICAgYWxsUmVtb3ZlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgdmlldy51bmJpbmQoKTtcbiAgICAgICAgdGhpcy5hbmltYXRlT3V0KHZpZXcsIHdoZW5Eb25lKTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH0sXG5cbiAgICB1bmJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMudmlld3MuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgIHZpZXcudW5iaW5kKCk7XG4gICAgICB9KTtcbiAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHJlZ2lzdGVyRGVmYXVsdHM7XG5cblxuLyoqXG4gKiAjIERlZmF1bHQgRm9ybWF0dGVyc1xuICogUmVnaXN0ZXJzIGRlZmF1bHQgZm9ybWF0dGVycyB3aXRoIGEgZnJhZ21lbnRzIG9iamVjdC5cbiAqL1xuZnVuY3Rpb24gcmVnaXN0ZXJEZWZhdWx0cyhmcmFnbWVudHMpIHtcblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcigndG9rZW5MaXN0JywgZnVuY3Rpb24odmFsdWUpIHtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLmpvaW4oJyAnKTtcbiAgICB9XG5cbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgdmFyIGNsYXNzZXMgPSBbXTtcbiAgICAgIE9iamVjdC5rZXlzKHZhbHVlKS5mb3JFYWNoKGZ1bmN0aW9uKGNsYXNzTmFtZSkge1xuICAgICAgICBpZiAodmFsdWVbY2xhc3NOYW1lXSkge1xuICAgICAgICAgIGNsYXNzZXMucHVzaChjbGFzc05hbWUpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICAgIHJldHVybiBjbGFzc2VzLmpvaW4oJyAnKTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUgfHwgJyc7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIHYgVE9ETyB2XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3N0eWxlcycsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBmaWx0ZXJcbiAgICogRmlsdGVycyBhbiBhcnJheSBieSB0aGUgZ2l2ZW4gZmlsdGVyIGZ1bmN0aW9uKHMpLCBtYXkgcHJvdmlkZSBhIGZ1bmN0aW9uLCBhblxuICAgKiBhcnJheSwgb3IgYW4gb2JqZWN0IHdpdGggZmlsdGVyaW5nIGZ1bmN0aW9uc1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdmaWx0ZXInLCBmdW5jdGlvbih2YWx1ZSwgZmlsdGVyRnVuYykge1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9IGVsc2UgaWYgKCFmaWx0ZXJGdW5jKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuXG4gICAgaWYgKHR5cGVvZiBmaWx0ZXJGdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmaWx0ZXJGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2UgaWYgKEFycmF5LmlzQXJyYXkoZmlsdGVyRnVuYykpIHtcbiAgICAgIGZpbHRlckZ1bmMuZm9yRWFjaChmdW5jdGlvbihmdW5jKSB7XG4gICAgICAgIHZhbHVlID0gdmFsdWUuZmlsdGVyKGZ1bmMsIHRoaXMpO1xuICAgICAgfSk7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ29iamVjdCcpIHtcbiAgICAgIE9iamVjdC5rZXlzKGZpbHRlckZ1bmMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICAgIHZhciBmdW5jID0gZmlsdGVyRnVuY1trZXldO1xuICAgICAgICBpZiAodHlwZW9mIGZ1bmMgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiB2YWx1ZTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgbWFwXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gbWFwIGFuIGFycmF5IG9yIHZhbHVlIGJ5IHRoZSBnaXZlbiBtYXBwaW5nIGZ1bmN0aW9uXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ21hcCcsIGZ1bmN0aW9uKHZhbHVlLCBtYXBGdW5jKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUubWFwKG1hcEZ1bmMsIHRoaXMpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gbWFwRnVuYy5jYWxsKHRoaXMsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIHJlZHVjZVxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIHJlZHVjZSBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gcmVkdWNlIGZ1bmN0aW9uXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3JlZHVjZScsIGZ1bmN0aW9uKHZhbHVlLCByZWR1Y2VGdW5jLCBpbml0aWFsVmFsdWUpIHtcbiAgICBpZiAodmFsdWUgPT0gbnVsbCB8fCB0eXBlb2YgbWFwRnVuYyAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAzKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5yZWR1Y2UocmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5yZWR1Y2UocmVkdWNlRnVuYyk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAzKSB7XG4gICAgICByZXR1cm4gcmVkdWNlRnVuYyhpbml0aWFsVmFsdWUsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIHJlZHVjZVxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIHJlZHVjZSBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gcmVkdWNlIGZ1bmN0aW9uXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3NsaWNlJywgZnVuY3Rpb24odmFsdWUsIGluZGV4LCBlbmRJbmRleCkge1xuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLnNsaWNlKGluZGV4LCBlbmRJbmRleCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGRhdGVcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBmb3JtYXQgZGF0ZXMgYW5kIHN0cmluZ3NcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZGF0ZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIGlmICghKHZhbHVlIGluc3RhbmNlb2YgRGF0ZSkpIHtcbiAgICAgIHZhbHVlID0gbmV3IERhdGUodmFsdWUpO1xuICAgIH1cblxuICAgIGlmIChpc05hTih2YWx1ZS5nZXRUaW1lKCkpKSB7XG4gICAgICByZXR1cm4gJyc7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlLnRvTG9jYWxlU3RyaW5nKCk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGxvZ1xuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxvZyB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24sIHVzZWZ1bCBmb3IgZGVidWdnaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xvZycsIGZ1bmN0aW9uKHZhbHVlLCBwcmVmaXgpIHtcbiAgICBpZiAocHJlZml4ID09IG51bGwpIHByZWZpeCA9ICdMb2c6JztcbiAgICBjb25zb2xlLmxvZyhwcmVmaXgsIHZhbHVlKTtcbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGxpbWl0XG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gbGltaXQgdGhlIGxlbmd0aCBvZiBhbiBhcnJheSBvciBzdHJpbmdcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbGltaXQnLCBmdW5jdGlvbih2YWx1ZSwgbGltaXQpIHtcbiAgICBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlLnNsaWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBpZiAobGltaXQgPCAwKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5zbGljZShsaW1pdCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB2YWx1ZS5zbGljZSgwLCBsaW1pdCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIHNvcnRcbiAgICogU29ydHMgYW4gYXJyYXkgZ2l2ZW4gYSBmaWVsZCBuYW1lIG9yIHNvcnQgZnVuY3Rpb24sIGFuZCBhIGRpcmVjdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzb3J0JywgZnVuY3Rpb24odmFsdWUsIHNvcnRGdW5jLCBkaXIpIHtcbiAgICBpZiAoIXNvcnRGdW5jIHx8ICFBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgICBkaXIgPSAoZGlyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgIGlmICh0eXBlb2Ygc29ydEZ1bmMgPT09ICdzdHJpbmcnKSB7XG4gICAgICB2YXIgcGFydHMgPSBzb3J0RnVuYy5zcGxpdCgnOicpO1xuICAgICAgdmFyIHByb3AgPSBwYXJ0c1swXTtcbiAgICAgIHZhciBkaXIyID0gcGFydHNbMV07XG4gICAgICBkaXIyID0gKGRpcjIgPT09ICdkZXNjJykgPyAtMSA6IDE7XG4gICAgICBkaXIgPSBkaXIgfHwgZGlyMjtcbiAgICAgIHZhciBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgaWYgKGFbcHJvcF0gPiBiW3Byb3BdKSByZXR1cm4gZGlyO1xuICAgICAgICBpZiAoYVtwcm9wXSA8IGJbcHJvcF0pIHJldHVybiAtZGlyO1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmIChkaXIgPT09IC0xKSB7XG4gICAgICB2YXIgb3JpZ0Z1bmMgPSBzb3J0RnVuYztcbiAgICAgIHNvcnRGdW5jID0gZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gLW9yaWdGdW5jKGEsIGIpOyB9O1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS5zbGljZSgpLnNvcnQoc29ydEZ1bmMuYmluZCh0aGlzKSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGFkZFF1ZXJ5XG4gICAqIFRha2VzIHRoZSBpbnB1dCBVUkwgYW5kIGFkZHMgKG9yIHJlcGxhY2VzKSB0aGUgZmllbGQgaW4gdGhlIHF1ZXJ5XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2FkZFF1ZXJ5JywgZnVuY3Rpb24odmFsdWUsIHF1ZXJ5RmllbGQsIHF1ZXJ5VmFsdWUpIHtcbiAgICB2YXIgdXJsID0gdmFsdWUgfHwgbG9jYXRpb24uaHJlZjtcbiAgICB2YXIgcGFydHMgPSB1cmwuc3BsaXQoJz8nKTtcbiAgICB1cmwgPSBwYXJ0c1swXTtcbiAgICB2YXIgcXVlcnkgPSBwYXJ0c1sxXTtcbiAgICB2YXIgYWRkZWRRdWVyeSA9ICcnO1xuICAgIGlmIChxdWVyeVZhbHVlICE9IG51bGwpIHtcbiAgICAgIGFkZGVkUXVlcnkgPSBxdWVyeUZpZWxkICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5VmFsdWUpO1xuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgdmFyIGV4cHIgPSBuZXcgUmVnRXhwKCdcXFxcYicgKyBxdWVyeUZpZWxkICsgJz1bXiZdKicpO1xuICAgICAgaWYgKGV4cHIudGVzdChxdWVyeSkpIHtcbiAgICAgICAgcXVlcnkgPSBxdWVyeS5yZXBsYWNlKGV4cHIsIGFkZGVkUXVlcnkpO1xuICAgICAgfSBlbHNlIGlmIChhZGRlZFF1ZXJ5KSB7XG4gICAgICAgIHF1ZXJ5ICs9ICcmJyArIGFkZGVkUXVlcnk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5ID0gYWRkZWRRdWVyeTtcbiAgICB9XG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB1cmwgKz0gJz8nICsgcXVlcnk7XG4gICAgfVxuICAgIHJldHVybiB1cmw7XG4gIH0pO1xuXG5cbiAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpXG4gIGZ1bmN0aW9uIGVzY2FwZUhUTUwodmFsdWUsIHNldHRlcikge1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIGRpdi5pbm5lckhUTUwgPSB2YWx1ZTtcbiAgICAgIHJldHVybiBkaXYudGV4dENvbnRlbnQ7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRpdi50ZXh0Q29udGVudCA9IHZhbHVlIHx8ICcnO1xuICAgICAgcmV0dXJuIGRpdi5pbm5lckhUTUw7XG4gICAgfVxuICB9XG5cblxuICAvKipcbiAgICogIyMgZXNjYXBlXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50LiBGb3IgdXNlIHdpdGggb3RoZXIgSFRNTC1hZGRpbmcgZm9ybWF0dGVycyBzdWNoIGFzIGF1dG9saW5rLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGVzY2FwZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdlc2NhcGUnLCBlc2NhcGVIVE1MKTtcblxuXG4gIC8qKlxuICAgKiAjIyBwXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IHdyYXBwaW5nIHBhcmFncmFwaHMgaW4gPHA+IHRhZ3MuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgcCB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9wPlxuICAgKiA8cD5JdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcigncCcsIGZ1bmN0aW9uKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICByZXR1cm4gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGxpbmVzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgdmFyIGVzY2FwZWQgPSBsaW5lcy5tYXAoZnVuY3Rpb24obGluZSkgeyByZXR1cm4gZXNjYXBlSFRNTChsaW5lKSB8fCAnPGJyPic7IH0pO1xuICAgICAgcmV0dXJuICc8cD4nICsgZXNjYXBlZC5qb2luKCc8L3A+XFxuPHA+JykgKyAnPC9wPic7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBiclxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudCBhZGRpbmcgPGJyPiB0YWdzIGluIHBsYWNlIG9mIG5ld2xpbmVzIGNoYXJhY3RlcnMuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgYnIgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITxicj5cbiAgICogSXQncyBncmVhdDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYnInLCBmdW5jdGlvbih2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgcmV0dXJuIGVzY2FwZUhUTUwodmFsdWUsIHNldHRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBsaW5lcyA9ICh2YWx1ZSB8fCAnJykuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIHJldHVybiBsaW5lcy5tYXAoZXNjYXBlSFRNTCkuam9pbignPGJyPlxcbicpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgbmV3bGluZVxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudCBhZGRpbmcgPHA+IHRhZ3MgYXQgZG91YmxlIG5ld2xpbmVzIGFuZCA8YnI+IHRhZ3MgaW4gcGxhY2Ugb2Ygc2luZ2xlIG5ld2xpbmUgY2hhcmFjdGVycy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBuZXdsaW5lIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PjxwPkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8YnI+XG4gICAqIEl0J3MgZ3JlYXQ8L3A+PC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCduZXdsaW5lJywgZnVuY3Rpb24odmFsdWUsIHNldHRlcikge1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIHJldHVybiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgcGFyYWdyYXBocyA9ICh2YWx1ZSB8fCAnJykuc3BsaXQoL1xccj9cXG5cXHMqXFxyP1xcbi8pO1xuICAgICAgdmFyIGVzY2FwZWQgPSBwYXJhZ3JhcGhzLm1hcChmdW5jdGlvbihwYXJhZ3JhcGgpIHtcbiAgICAgICAgdmFyIGxpbmVzID0gcGFyYWdyYXBoLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICAgIHJldHVybiBsaW5lcy5tYXAoZXNjYXBlSFRNTCkuam9pbignPGJyPlxcbicpO1xuICAgICAgfSk7XG4gICAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD5cXG5cXG48cD4nKSArICc8L3A+JztcbiAgICB9XG4gIH0pO1xuXG5cblxuICB2YXIgdXJsRXhwID0gLyhefFxcc3xcXCgpKCg/Omh0dHBzP3xmdHApOlxcL1xcL1tcXC1BLVowLTkrXFx1MDAyNkAjXFwvJT89KCl+X3whOiwuO10qW1xcLUEtWjAtOStcXHUwMDI2QCNcXC8lPX4oX3xdKS9naTtcbiAgdmFyIHd3d0V4cCA9IC8oXnxbXlxcL10pKHd3d1xcLltcXFNdK1xcLlxcd3syLH0oXFxifCQpKS9naW07XG4gIC8qKlxuICAgKiAjIyBhdXRvbGlua1xuICAgKiBBZGRzIGF1dG9tYXRpYyBsaW5rcyB0byBlc2NhcGVkIGNvbnRlbnQgKGJlIHN1cmUgdG8gZXNjYXBlIHVzZXIgY29udGVudCkuIENhbiBiZSB1c2VkIG9uIGV4aXN0aW5nIEhUTUwgY29udGVudCBhcyBpdFxuICAgKiB3aWxsIHNraXAgVVJMcyB3aXRoaW4gSFRNTCB0YWdzLiBQYXNzaW5nIHRydWUgaW4gdGhlIHNlY29uZCBwYXJhbWV0ZXIgd2lsbCBzZXQgdGhlIHRhcmdldCB0byBgX2JsYW5rYC5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBlc2NhcGUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYXV0b2xpbmsnLCBmdW5jdGlvbih2YWx1ZSwgdGFyZ2V0KSB7XG4gICAgdGFyZ2V0ID0gKHRhcmdldCkgPyAnIHRhcmdldD1cIl9ibGFua1wiJyA6ICcnO1xuXG4gICAgcmV0dXJuICgnJyArIHZhbHVlKS5yZXBsYWNlKC88W14+XSs+fFtePF0rL2csIGZ1bmN0aW9uKG1hdGNoKSB7XG4gICAgICBpZiAobWF0Y2guY2hhckF0KDApID09PSAnPCcpIHtcbiAgICAgICAgcmV0dXJuIG1hdGNoO1xuICAgICAgfVxuICAgICAgdmFyIHJlcGxhY2VkVGV4dCA9IG1hdGNoLnJlcGxhY2UodXJsRXhwLCAnJDE8YSBocmVmPVwiJDJcIicgKyB0YXJnZXQgKyAnPiQyPC9hPicpO1xuICAgICAgcmV0dXJuIHJlcGxhY2VkVGV4dC5yZXBsYWNlKHd3d0V4cCwgJyQxPGEgaHJlZj1cImh0dHA6Ly8kMlwiJyArIHRhcmdldCArICc+JDI8L2E+Jyk7XG4gICAgfSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2ludCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFsdWUgPSBwYXJzZUludCh2YWx1ZSk7XG4gICAgcmV0dXJuIGlzTmFOKHZhbHVlKSA/IG51bGwgOiB2YWx1ZTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmxvYXQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhbHVlID0gcGFyc2VGbG9hdCh2YWx1ZSk7XG4gICAgcmV0dXJuIGlzTmFOKHZhbHVlKSA/IG51bGwgOiB2YWx1ZTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYm9vbCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgcmV0dXJuIHZhbHVlICYmIHZhbHVlICE9PSAnMCcgJiYgdmFsdWUgIT09ICdmYWxzZSc7XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBUZW1wbGF0ZTtcbnZhciBWaWV3ID0gcmVxdWlyZSgnLi92aWV3Jyk7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xuXG5cbi8qKlxuICogIyMgVGVtcGxhdGVcbiAqIFRha2VzIGFuIEhUTUwgc3RyaW5nLCBhbiBlbGVtZW50LCBhbiBhcnJheSBvZiBlbGVtZW50cywgb3IgYSBkb2N1bWVudCBmcmFnbWVudCwgYW5kIGNvbXBpbGVzIGl0IGludG8gYSB0ZW1wbGF0ZS5cbiAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gKiBAcGFyYW0ge1N0cmluZ3xOb2RlTGlzdHxIVE1MQ29sbGVjdGlvbnxIVE1MVGVtcGxhdGVFbGVtZW50fEhUTUxTY3JpcHRFbGVtZW50fE5vZGV9IGh0bWwgQSBUZW1wbGF0ZSBjYW4gYmUgY3JlYXRlZFxuICogZnJvbSBtYW55IGRpZmZlcmVudCB0eXBlcyBvZiBvYmplY3RzLiBBbnkgb2YgdGhlc2Ugd2lsbCBiZSBjb252ZXJ0ZWQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50IGZvciB0aGUgdGVtcGxhdGUgdG9cbiAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gKi9cbmZ1bmN0aW9uIFRlbXBsYXRlKCkge1xuICB0aGlzLnBvb2wgPSBbXTtcbn1cblxuXG5UZW1wbGF0ZS5wcm90b3R5cGUgPSB7XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgdmlldyBjbG9uZWQgZnJvbSB0aGlzIHRlbXBsYXRlLlxuICAgKi9cbiAgY3JlYXRlVmlldzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMucG9vbC5sZW5ndGgpIHtcbiAgICAgIHJldHVybiB0aGlzLnBvb2wucG9wKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGV4dGVuZC5tYWtlKFZpZXcsIGRvY3VtZW50LmltcG9ydE5vZGUodGhpcywgdHJ1ZSksIHRoaXMpO1xuICB9LFxuXG4gIHJldHVyblZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICBpZiAodGhpcy5wb29sLmluZGV4T2YodmlldykgPT09IC0xKSB7XG4gICAgICB0aGlzLnBvb2wucHVzaCh2aWV3KTtcbiAgICB9XG4gIH1cbn07XG4iLCIvLyBIZWxwZXIgbWV0aG9kcyBmb3IgYW5pbWF0aW9uXG5leHBvcnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZSA9IG1ha2VFbGVtZW50QW5pbWF0YWJsZTtcbmV4cG9ydHMuZ2V0Q29tcHV0ZWRDU1MgPSBnZXRDb21wdXRlZENTUztcbmV4cG9ydHMuYW5pbWF0ZUVsZW1lbnQgPSBhbmltYXRlRWxlbWVudDtcblxuZnVuY3Rpb24gbWFrZUVsZW1lbnRBbmltYXRhYmxlKGVsZW1lbnQpIHtcbiAgLy8gQWRkIHBvbHlmaWxsIGp1c3Qgb24gdGhpcyBlbGVtZW50XG4gIGlmICghZWxlbWVudC5hbmltYXRlKSB7XG4gICAgZWxlbWVudC5hbmltYXRlID0gYW5pbWF0ZUVsZW1lbnQ7XG4gIH1cblxuICAvLyBOb3QgYSBwb2x5ZmlsbCBidXQgYSBoZWxwZXJcbiAgaWYgKCFlbGVtZW50LmdldENvbXB1dGVkQ1NTKSB7XG4gICAgZWxlbWVudC5nZXRDb21wdXRlZENTUyA9IGdldENvbXB1dGVkQ1NTO1xuICB9XG5cbiAgcmV0dXJuIGVsZW1lbnQ7XG59XG5cbi8qKlxuICogR2V0IHRoZSBjb21wdXRlZCBzdHlsZSBvbiBhbiBlbGVtZW50LlxuICovXG5mdW5jdGlvbiBnZXRDb21wdXRlZENTUyhzdHlsZU5hbWUpIHtcbiAgaWYgKHRoaXMub3duZXJEb2N1bWVudC5kZWZhdWx0Vmlldy5vcGVuZXIpIHtcbiAgICByZXR1cm4gdGhpcy5vd25lckRvY3VtZW50LmRlZmF1bHRWaWV3LmdldENvbXB1dGVkU3R5bGUodGhpcylbc3R5bGVOYW1lXTtcbiAgfVxuICByZXR1cm4gd2luZG93LmdldENvbXB1dGVkU3R5bGUodGhpcylbc3R5bGVOYW1lXTtcbn1cblxuLyoqXG4gKiBWZXJ5IGJhc2ljIHBvbHlmaWxsIGZvciBFbGVtZW50LmFuaW1hdGUgaWYgaXQgZG9lc24ndCBleGlzdC4gSWYgaXQgZG9lcywgdXNlIHRoZSBuYXRpdmUuXG4gKiBUaGlzIG9ubHkgc3VwcG9ydHMgdHdvIGNzcyBzdGF0ZXMuIEl0IHdpbGwgb3ZlcndyaXRlIGV4aXN0aW5nIHN0eWxlcy4gSXQgZG9lc24ndCByZXR1cm4gYW4gYW5pbWF0aW9uIHBsYXkgY29udHJvbC4gSXRcbiAqIG9ubHkgc3VwcG9ydHMgZHVyYXRpb24sIGRlbGF5LCBhbmQgZWFzaW5nLiBSZXR1cm5zIGFuIG9iamVjdCB3aXRoIGEgcHJvcGVydHkgb25maW5pc2guXG4gKi9cbmZ1bmN0aW9uIGFuaW1hdGVFbGVtZW50KGNzcywgb3B0aW9ucykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY3NzKSB8fCBjc3MubGVuZ3RoICE9PSAyKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYW5pbWF0ZSBwb2x5ZmlsbCByZXF1aXJlcyBhbiBhcnJheSBmb3IgY3NzIHdpdGggYW4gaW5pdGlhbCBhbmQgZmluYWwgc3RhdGUnKTtcbiAgfVxuXG4gIGlmICghb3B0aW9ucyB8fCAhb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnZHVyYXRpb24nKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2FuaW1hdGUgcG9seWZpbGwgcmVxdWlyZXMgb3B0aW9ucyB3aXRoIGEgZHVyYXRpb24nKTtcbiAgfVxuXG4gIHZhciBkdXJhdGlvbiA9IG9wdGlvbnMuZHVyYXRpb24gfHwgMDtcbiAgdmFyIGRlbGF5ID0gb3B0aW9ucy5kZWxheSB8fCAwO1xuICB2YXIgZWFzaW5nID0gb3B0aW9ucy5lYXNpbmc7XG4gIHZhciBpbml0aWFsQ3NzID0gY3NzWzBdO1xuICB2YXIgZmluYWxDc3MgPSBjc3NbMV07XG4gIHZhciBhbGxDc3MgPSB7fTtcbiAgdmFyIHBsYXliYWNrID0geyBvbmZpbmlzaDogbnVsbCB9O1xuXG4gIE9iamVjdC5rZXlzKGluaXRpYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGluaXRpYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgLy8gdHJpZ2dlciByZWZsb3dcbiAgZWxlbWVudC5vZmZzZXRXaWR0aDtcblxuICB2YXIgdHJhbnNpdGlvbk9wdGlvbnMgPSAnICcgKyBkdXJhdGlvbiArICdtcyc7XG4gIGlmIChlYXNpbmcpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBlYXNpbmc7XG4gIH1cbiAgaWYgKGRlbGF5KSB7XG4gICAgdHJhbnNpdGlvbk9wdGlvbnMgKz0gJyAnICsgZGVsYXkgKyAnbXMnO1xuICB9XG5cbiAgZWxlbWVudC5zdHlsZS50cmFuc2l0aW9uID0gT2JqZWN0LmtleXMoZmluYWxDc3MpLm1hcChmdW5jdGlvbihrZXkpIHtcbiAgICByZXR1cm4ga2V5ICsgdHJhbnNpdGlvbk9wdGlvbnNcbiAgfSkuam9pbignLCAnKTtcblxuICBPYmplY3Qua2V5cyhmaW5hbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gZmluYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBPYmplY3Qua2V5cyhhbGxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSAnJztcbiAgICB9KTtcblxuICAgIGlmIChwbGF5YmFjay5vbmZpbmlzaCkge1xuICAgICAgcGxheWJhY2sub25maW5pc2goKTtcbiAgICB9XG4gIH0sIGR1cmF0aW9uICsgZGVsYXkpO1xuXG4gIHJldHVybiBwbGF5YmFjaztcbn1cbiIsInZhciBnbG9iYWwgPSAoZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzIH0pKCk7XG52YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5tb2R1bGUuZXhwb3J0cyA9IGV4dGVuZDtcbmV4dGVuZC5tYWtlID0gbWFrZTtcblxuXG4vKipcbiAqIENyZWF0ZXMgYSBuZXcgcHJvdG90eXBlIGZvciB0aGUgZ2l2ZW4gY29udHJ1Y3RvciBhbmQgc2V0cyBhbiBgZXh0ZW5kYCBtZXRob2Qgb24gaXQuIElmIGBleHRlbmRgIGlzIGNhbGxlZCBmcm9tIGFcbiAqIGl0IHdpbGwgZXh0ZW5kIHRoYXQgY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIGV4dGVuZChjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBzdXBlckNsYXNzID0gdGhpcyA9PT0gZ2xvYmFsID8gT2JqZWN0IDogdGhpcztcbiAgaWYgKHR5cGVvZiBjb25zdHJ1Y3RvciAhPT0gJ2Z1bmN0aW9uJyAmJiAhcHJvdG90eXBlKSB7XG4gICAgcHJvdG90eXBlID0gY29uc3RydWN0b3I7XG4gICAgY29uc3RydWN0b3IgPSBmdW5jdGlvbigpIHtcbiAgICAgIHN1cGVyQ2xhc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9XG4gIGNvbnN0cnVjdG9yLmV4dGVuZCA9IGV4dGVuZDtcbiAgdmFyIGRlc2NyaXB0b3JzID0gZ2V0UHJvdG90eXBlRGVzY3JpcHRvcnMoY29uc3RydWN0b3IsIHByb3RvdHlwZSk7XG4gIGNvbnN0cnVjdG9yLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoc3VwZXJDbGFzcy5wcm90b3R5cGUsIGRlc2NyaXB0b3JzKTtcbiAgcmV0dXJuIGNvbnN0cnVjdG9yO1xufVxuXG5cbi8qKlxuICogTWFrZXMgYSBuYXRpdmUgb2JqZWN0IHByZXRlbmQgdG8gYmUgYSBjbGFzcyAoZS5nLiBhZGRzIG1ldGhvZHMgdG8gYSBEb2N1bWVudEZyYWdtZW50IGFuZCBjYWxscyB0aGUgY29uc3RydWN0b3IpLlxuICovXG5mdW5jdGlvbiBtYWtlKGNvbnN0cnVjdG9yLCBvYmplY3QpIHtcbiAgaWYgKHR5cGVvZiBjb25zdHJ1Y3RvciAhPT0gJ2Z1bmN0aW9uJyB8fCB0eXBlb2Ygb2JqZWN0ICE9PSAnb2JqZWN0Jykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ21ha2UgbXVzdCBhY2NlcHQgYSBmdW5jdGlvbiBjb25zdHJ1Y3RvciBhbmQgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMik7XG4gIHZhciBwcm90byA9IGNvbnN0cnVjdG9yLnByb3RvdHlwZTtcbiAgZm9yICh2YXIga2V5IGluIHByb3RvKSB7XG4gICAgb2JqZWN0W2tleV0gPSBwcm90b1trZXldO1xuICB9XG4gIGNvbnN0cnVjdG9yLmFwcGx5KG9iamVjdCwgYXJncyk7XG4gIHJldHVybiBvYmplY3Q7XG59XG5cblxuZnVuY3Rpb24gZ2V0UHJvdG90eXBlRGVzY3JpcHRvcnMoY29uc3RydWN0b3IsIHByb3RvdHlwZSkge1xuICB2YXIgZGVzY3JpcHRvcnMgPSB7XG4gICAgY29uc3RydWN0b3I6IHsgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IGNvbnN0cnVjdG9yIH1cbiAgfTtcblxuICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhwcm90b3R5cGUpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihwcm90b3R5cGUsIG5hbWUpO1xuICAgIGRlc2NyaXB0b3IuZW51bWVyYWJsZSA9IGZhbHNlO1xuICAgIGRlc2NyaXB0b3JzW25hbWVdID0gZGVzY3JpcHRvcjtcbiAgfSk7XG4gIHJldHVybiBkZXNjcmlwdG9ycztcbn1cbiIsIlxuXG5cbi8vIFBvbHlmaWxsIG1hdGNoZXNcbmlmICghRWxlbWVudC5wcm90b3R5cGUubWF0Y2hlcykge1xuICBFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzID1cbiAgICBFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzU2VsZWN0b3IgfHxcbiAgICBFbGVtZW50LnByb3RvdHlwZS53ZWJraXRNYXRjaGVzU2VsZWN0b3IgfHxcbiAgICBFbGVtZW50LnByb3RvdHlwZS5tb3pNYXRjaGVzU2VsZWN0b3IgfHxcbiAgICBFbGVtZW50LnByb3RvdHlwZS5tc01hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm9NYXRjaGVzU2VsZWN0b3I7XG59XG5cbi8vIFBvbHlmaWxsIGNsb3Nlc3RcbmlmICghRWxlbWVudC5wcm90b3R5cGUuY2xvc2VzdCkge1xuICBFbGVtZW50LnByb3RvdHlwZS5jbG9zZXN0ID0gZnVuY3Rpb24gY2xvc2VzdChzZWxlY3Rvcikge1xuICAgIHZhciBlbGVtZW50ID0gdGhpcztcbiAgICBkbyB7XG4gICAgICBpZiAoZWxlbWVudC5tYXRjaGVzKHNlbGVjdG9yKSkge1xuICAgICAgICByZXR1cm4gZWxlbWVudDtcbiAgICAgIH1cbiAgICB9IHdoaWxlICgoZWxlbWVudCA9IGVsZW1lbnQucGFyZW50Tm9kZSkgJiYgZWxlbWVudC5ub2RlVHlwZSA9PT0gTm9kZS5FTEVNRU5UX05PREUpO1xuICAgIHJldHVybiBudWxsO1xuICB9XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHRvRnJhZ21lbnQ7XG5cbi8vIENvbnZlcnQgc3R1ZmYgaW50byBkb2N1bWVudCBmcmFnbWVudHMuIFN0dWZmIGNhbiBiZTpcbi8vICogQSBzdHJpbmcgb2YgSFRNTCB0ZXh0XG4vLyAqIEFuIGVsZW1lbnQgb3IgdGV4dCBub2RlXG4vLyAqIEEgTm9kZUxpc3Qgb3IgSFRNTENvbGxlY3Rpb24gKGUuZy4gYGVsZW1lbnQuY2hpbGROb2Rlc2Agb3IgYGVsZW1lbnQuY2hpbGRyZW5gKVxuLy8gKiBBIGpRdWVyeSBvYmplY3Rcbi8vICogQSBzY3JpcHQgZWxlbWVudCB3aXRoIGEgYHR5cGVgIGF0dHJpYnV0ZSBvZiBgXCJ0ZXh0LypcImAgKGUuZy4gYDxzY3JpcHQgdHlwZT1cInRleHQvaHRtbFwiPk15IHRlbXBsYXRlIGNvZGUhPC9zY3JpcHQ+YClcbi8vICogQSB0ZW1wbGF0ZSBlbGVtZW50IChlLmcuIGA8dGVtcGxhdGU+TXkgdGVtcGxhdGUgY29kZSE8L3RlbXBsYXRlPmApXG5mdW5jdGlvbiB0b0ZyYWdtZW50KGh0bWwpIHtcbiAgaWYgKGh0bWwgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIGh0bWw7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGh0bWwgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoaHRtbCBpbnN0YW5jZW9mIE5vZGUpIHtcbiAgICByZXR1cm4gbm9kZVRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoJ2xlbmd0aCcgaW4gaHRtbCkge1xuICAgIHJldHVybiBsaXN0VG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbnN1cHBvcnRlZCBUZW1wbGF0ZSBUeXBlOiBDYW5ub3QgY29udmVydCBgJyArIGh0bWwgKyAnYCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuJyk7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTCBub2RlIGludG8gYSBkb2N1bWVudCBmcmFnbWVudC4gSWYgaXQgaXMgYSA8dGVtcGxhdGU+IG5vZGUgaXRzIGNvbnRlbnRzIHdpbGwgYmUgdXNlZC4gSWYgaXQgaXMgYVxuLy8gPHNjcmlwdD4gbm9kZSBpdHMgc3RyaW5nLWJhc2VkIGNvbnRlbnRzIHdpbGwgYmUgY29udmVydGVkIHRvIEhUTUwgZmlyc3QsIHRoZW4gdXNlZC4gT3RoZXJ3aXNlIGEgY2xvbmUgb2YgdGhlIG5vZGVcbi8vIGl0c2VsZiB3aWxsIGJlIHVzZWQuXG5mdW5jdGlvbiBub2RlVG9GcmFnbWVudChub2RlKSB7XG4gIGlmIChub2RlLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIG5vZGUuY29udGVudDtcbiAgfSBlbHNlIGlmIChub2RlLnRhZ05hbWUgPT09ICdTQ1JJUFQnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQobm9kZS5pbm5lckhUTUwpO1xuICB9IGVsc2Uge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBpZiAobm9kZS50YWdOYW1lID09PSAnVEVNUExBVEUnKSB7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbCA9IG5vZGUuY2hpbGROb2Rlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZS5jaGlsZE5vZGVzW2ldKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgfVxuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxufVxuXG4vLyBDb252ZXJ0cyBhbiBIVE1MQ29sbGVjdGlvbiwgTm9kZUxpc3QsIGpRdWVyeSBvYmplY3QsIG9yIGFycmF5IGludG8gYSBkb2N1bWVudCBmcmFnbWVudC5cbmZ1bmN0aW9uIGxpc3RUb0ZyYWdtZW50KGxpc3QpIHtcbiAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICBmb3IgKHZhciBpID0gMCwgbCA9IGxpc3QubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgLy8gVXNlIHRvRnJhZ21lbnQgc2luY2UgdGhpcyBtYXkgYmUgYW4gYXJyYXkgb2YgdGV4dCwgYSBqUXVlcnkgb2JqZWN0IG9mIGA8dGVtcGxhdGU+YHMsIGV0Yy5cbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh0b0ZyYWdtZW50KGxpc3RbaV0pKTtcbiAgICBpZiAobCA9PT0gbGlzdC5sZW5ndGggKyAxKSB7XG4gICAgICAvLyBhZGp1c3QgZm9yIE5vZGVMaXN0cyB3aGljaCBhcmUgbGl2ZSwgdGhleSBzaHJpbmsgYXMgd2UgcHVsbCBub2RlcyBvdXQgb2YgdGhlIERPTVxuICAgICAgaS0tO1xuICAgICAgbC0tO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZnJhZ21lbnQ7XG59XG5cbi8vIENvbnZlcnRzIGEgc3RyaW5nIG9mIEhUTUwgdGV4dCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG5mdW5jdGlvbiBzdHJpbmdUb0ZyYWdtZW50KHN0cmluZykge1xuICBpZiAoIXN0cmluZykge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJykpO1xuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxuICB2YXIgdGVtcGxhdGVFbGVtZW50O1xuICB0ZW1wbGF0ZUVsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpO1xuICB0ZW1wbGF0ZUVsZW1lbnQuaW5uZXJIVE1MID0gc3RyaW5nO1xuICByZXR1cm4gdGVtcGxhdGVFbGVtZW50LmNvbnRlbnQ7XG59XG5cbi8vIElmIEhUTUwgVGVtcGxhdGVzIGFyZSBub3QgYXZhaWxhYmxlIChlLmcuIGluIElFKSB0aGVuIHVzZSBhbiBvbGRlciBtZXRob2QgdG8gd29yayB3aXRoIGNlcnRhaW4gZWxlbWVudHMuXG5pZiAoIWRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RlbXBsYXRlJykuY29udGVudCBpbnN0YW5jZW9mIERvY3VtZW50RnJhZ21lbnQpIHtcbiAgc3RyaW5nVG9GcmFnbWVudCA9IChmdW5jdGlvbigpIHtcbiAgICB2YXIgdGFnRXhwID0gLzwoW1xcdzotXSspLztcblxuICAgIC8vIENvcGllZCBmcm9tIGpRdWVyeSAoaHR0cHM6Ly9naXRodWIuY29tL2pxdWVyeS9qcXVlcnkvYmxvYi9tYXN0ZXIvTElDRU5TRS50eHQpXG4gICAgdmFyIHdyYXBNYXAgPSB7XG4gICAgICBvcHRpb246IFsgMSwgJzxzZWxlY3QgbXVsdGlwbGU9XCJtdWx0aXBsZVwiPicsICc8L3NlbGVjdD4nIF0sXG4gICAgICBsZWdlbmQ6IFsgMSwgJzxmaWVsZHNldD4nLCAnPC9maWVsZHNldD4nIF0sXG4gICAgICB0aGVhZDogWyAxLCAnPHRhYmxlPicsICc8L3RhYmxlPicgXSxcbiAgICAgIHRyOiBbIDIsICc8dGFibGU+PHRib2R5PicsICc8L3Rib2R5PjwvdGFibGU+JyBdLFxuICAgICAgdGQ6IFsgMywgJzx0YWJsZT48dGJvZHk+PHRyPicsICc8L3RyPjwvdGJvZHk+PC90YWJsZT4nIF0sXG4gICAgICBjb2w6IFsgMiwgJzx0YWJsZT48dGJvZHk+PC90Ym9keT48Y29sZ3JvdXA+JywgJzwvY29sZ3JvdXA+PC90YWJsZT4nIF0sXG4gICAgICBhcmVhOiBbIDEsICc8bWFwPicsICc8L21hcD4nIF0sXG4gICAgICBfZGVmYXVsdDogWyAwLCAnJywgJycgXVxuICAgIH07XG4gICAgd3JhcE1hcC5vcHRncm91cCA9IHdyYXBNYXAub3B0aW9uO1xuICAgIHdyYXBNYXAudGJvZHkgPSB3cmFwTWFwLnRmb290ID0gd3JhcE1hcC5jb2xncm91cCA9IHdyYXBNYXAuY2FwdGlvbiA9IHdyYXBNYXAudGhlYWQ7XG4gICAgd3JhcE1hcC50aCA9IHdyYXBNYXAudGQ7XG5cbiAgICByZXR1cm4gZnVuY3Rpb24gc3RyaW5nVG9GcmFnbWVudChzdHJpbmcpIHtcbiAgICAgIGlmICghc3RyaW5nKSB7XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpKTtcbiAgICAgICAgcmV0dXJuIGZyYWdtZW50O1xuICAgICAgfVxuICAgICAgdmFyIHRhZyA9IHN0cmluZy5tYXRjaCh0YWdFeHApO1xuICAgICAgdmFyIHBhcnRzID0gd3JhcE1hcFt0YWddIHx8IHdyYXBNYXAuX2RlZmF1bHQ7XG4gICAgICB2YXIgZGVwdGggPSBwYXJ0c1swXTtcbiAgICAgIHZhciBwcmVmaXggPSBwYXJ0c1sxXTtcbiAgICAgIHZhciBwb3N0Zml4ID0gcGFydHNbMl07XG4gICAgICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBkaXYuaW5uZXJIVE1MID0gcHJlZml4ICsgc3RyaW5nICsgcG9zdGZpeDtcbiAgICAgIHdoaWxlIChkZXB0aC0tKSB7XG4gICAgICAgIGRpdiA9IGRpdi5sYXN0Q2hpbGQ7XG4gICAgICB9XG4gICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICB3aGlsZSAoZGl2LmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZGl2LmZpcnN0Q2hpbGQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZyYWdtZW50O1xuICAgIH07XG4gIH0pKCk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG5cblxuLyoqXG4gKiAjIyBWaWV3XG4gKiBBIERvY3VtZW50RnJhZ21lbnQgd2l0aCBiaW5kaW5ncy5cbiAqL1xuZnVuY3Rpb24gVmlldyh0ZW1wbGF0ZSkge1xuICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG4gIHRoaXMuYmluZGluZ3MgPSB0aGlzLnRlbXBsYXRlLmJpbmRpbmdzLm1hcChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgcmV0dXJuIGJpbmRpbmcuY2xvbmVGb3JWaWV3KHRoaXMpO1xuICB9LCB0aGlzKTtcbiAgdGhpcy5maXJzdFZpZXdOb2RlID0gdGhpcy5maXJzdENoaWxkO1xuICB0aGlzLmxhc3RWaWV3Tm9kZSA9IHRoaXMubGFzdENoaWxkO1xuICBpZiAodGhpcy5maXJzdFZpZXdOb2RlKSB7XG4gICAgdGhpcy5maXJzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICAgIHRoaXMubGFzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICB9XG59XG5cblxuVmlldy5wcm90b3R5cGUgPSB7XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSB2aWV3IGZyb20gdGhlIERPTS4gQSB2aWV3IGlzIGEgRG9jdW1lbnRGcmFnbWVudCwgc28gYHJlbW92ZSgpYCByZXR1cm5zIGFsbCBpdHMgbm9kZXMgdG8gaXRzZWxmLlxuICAgKi9cbiAgcmVtb3ZlOiBmdW5jdGlvbigpIHtcbiAgICB2YXIgbm9kZSA9IHRoaXMuZmlyc3RWaWV3Tm9kZTtcbiAgICB2YXIgbmV4dDtcblxuICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHRoaXMpIHtcbiAgICAgIC8vIFJlbW92ZSBhbGwgdGhlIG5vZGVzIGFuZCBwdXQgdGhlbSBiYWNrIGludG8gdGhpcyBmcmFnbWVudFxuICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgbmV4dCA9IChub2RlID09PSB0aGlzLmxhc3RWaWV3Tm9kZSkgPyBudWxsIDogbm9kZS5uZXh0U2libGluZztcbiAgICAgICAgdGhpcy5hcHBlbmRDaGlsZChub2RlKTtcbiAgICAgICAgbm9kZSA9IG5leHQ7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRoaXM7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgKGlmIG5vdCBhbHJlYWR5IHJlbW92ZWQpIGFuZCBhZGRzIHRoZSB2aWV3IHRvIGl0cyB0ZW1wbGF0ZSdzIHBvb2wuXG4gICAqL1xuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICAvLyBNYWtlIHN1cmUgdGhlIHZpZXcgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET01cbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5kaXNwb3NlKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnJlbW92ZSgpO1xuICAgIGlmICh0aGlzLnRlbXBsYXRlKSB7XG4gICAgICB0aGlzLnRlbXBsYXRlLnJldHVyblZpZXcodGhpcyk7XG4gICAgfVxuICB9LFxuXG5cbiAgLyoqXG4gICAqIEJpbmRzIGEgdmlldyB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqL1xuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgdGhpcy5iaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICAgIGJpbmRpbmcuYmluZChjb250ZXh0KTtcbiAgICB9KTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbmJpbmRzIGEgdmlldyBmcm9tIGFueSBjb250ZXh0LlxuICAgKi9cbiAgdW5iaW5kOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy51bmJpbmQoKTtcbiAgICB9KTtcbiAgfVxufTtcbiJdfQ==
