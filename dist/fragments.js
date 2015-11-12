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
  return fragments;
}

// Create an instance of fragments with the default observer
module.exports = create();
module.exports.create = create;

},{"./src/fragments":10,"./src/observer":12}],7:[function(require,module,exports){
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

},{"./binding":8,"./util/animation":18}],8:[function(require,module,exports){
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

},{"./util/extend":19}],9:[function(require,module,exports){
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

},{"./animatedBinding":7,"./binding":8,"./compile":9,"./registered/animations":14,"./registered/binders":15,"./registered/formatters":16,"./template":17,"./util/animation":18,"./util/extend":19,"./util/polyfills":20,"./util/toFragment":21,"./view":22}],11:[function(require,module,exports){
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

},{}],12:[function(require,module,exports){
module.exports = exports = require('./observer');
exports.expressions = require('expressions-js');
exports.expressions.diff = require('./diff');

},{"./diff":11,"./observer":13,"expressions-js":1}],13:[function(require,module,exports){
module.exports = Observer;
var expressions = require('expressions-js');
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
    this.context = null;
    Observer.remove(this);
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

},{"./diff":11,"expressions-js":1}],14:[function(require,module,exports){
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

},{}],15:[function(require,module,exports){
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

},{"../observer/diff":11}],16:[function(require,module,exports){
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

},{}],17:[function(require,module,exports){
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

},{"./util/extend":19,"./view":22}],18:[function(require,module,exports){
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

},{}],19:[function(require,module,exports){
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

},{}],20:[function(require,module,exports){



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

},{}],21:[function(require,module,exports){
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

},{}],22:[function(require,module,exports){
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIuLi9leHByZXNzaW9ucy1qcy9pbmRleC5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9leHByZXNzaW9ucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9mb3JtYXR0ZXJzLmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL3Byb3BlcnR5LWNoYWlucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9zdHJpbmdzLmpzIiwiaW5kZXguanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvZGlmZi5qcyIsInNyYy9vYnNlcnZlci9pbmRleC5qcyIsInNyYy9vYnNlcnZlci9vYnNlcnZlci5qcyIsInNyYy9yZWdpc3RlcmVkL2FuaW1hdGlvbnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9iaW5kZXJzLmpzIiwic3JjL3JlZ2lzdGVyZWQvZm9ybWF0dGVycy5qcyIsInNyYy90ZW1wbGF0ZS5qcyIsInNyYy91dGlsL2FuaW1hdGlvbi5qcyIsInNyYy91dGlsL2V4dGVuZC5qcyIsInNyYy91dGlsL3BvbHlmaWxscy5qcyIsInNyYy91dGlsL3RvRnJhZ21lbnQuanMiLCJzcmMvdmlldy5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBO0FBQ0E7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdlVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNubEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pZQTtBQUNBO0FBQ0E7QUFDQTs7QUNIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hNQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoOEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDblpBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3REQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9zcmMvZXhwcmVzc2lvbnMnKTtcbiIsInZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbnZhciBzdHJpbmdzID0gcmVxdWlyZSgnLi9zdHJpbmdzJyk7XG52YXIgZm9ybWF0dGVyUGFyc2VyID0gcmVxdWlyZSgnLi9mb3JtYXR0ZXJzJyk7XG52YXIgcHJvcGVydHlDaGFpbnMgPSByZXF1aXJlKCcuL3Byb3BlcnR5LWNoYWlucycpO1xudmFyIHZhbHVlUHJvcGVydHkgPSAnX3ZhbHVlXyc7XG52YXIgY2FjaGUgPSB7fTtcblxuZXhwb3J0cy5nbG9iYWxzID0ge307XG5cblxuZXhwb3J0cy5wYXJzZSA9IGZ1bmN0aW9uKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFBcmdzKSkgZXh0cmFBcmdzID0gW107XG4gIHZhciBjYWNoZUtleSA9IGV4cHIgKyAnfCcgKyBleHRyYUFyZ3Muam9pbignLCcpO1xuICAvLyBSZXR1cm5zIHRoZSBjYWNoZWQgZnVuY3Rpb24gZm9yIHRoaXMgZXhwcmVzc2lvbiBpZiBpdCBleGlzdHMuXG4gIHZhciBmdW5jID0gY2FjaGVbY2FjaGVLZXldO1xuICBpZiAoZnVuYykge1xuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgdmFyIG9yaWdpbmFsID0gZXhwcjtcbiAgdmFyIGlzU2V0dGVyID0gKGV4dHJhQXJnc1swXSA9PT0gdmFsdWVQcm9wZXJ0eSk7XG4gIC8vIEFsbG93ICchcHJvcCcgdG8gYmVjb21lICdwcm9wID0gIXZhbHVlJ1xuICBpZiAoaXNTZXR0ZXIgJiYgZXhwci5jaGFyQXQoMCkgPT09ICchJykge1xuICAgIGV4cHIgPSBleHByLnNsaWNlKDEpO1xuICAgIHZhbHVlUHJvcGVydHkgPSAnIScgKyB2YWx1ZVByb3BlcnR5O1xuICB9XG5cbiAgZXhwciA9IHN0cmluZ3MucHVsbE91dFN0cmluZ3MoZXhwcik7XG4gIGV4cHIgPSBmb3JtYXR0ZXJQYXJzZXIucGFyc2VGb3JtYXR0ZXJzKGV4cHIpO1xuICBleHByID0gcHJvcGVydHlDaGFpbnMucGFyc2VFeHByZXNzaW9uKGV4cHIsIGdldFZhcmlhYmxlcyhnbG9iYWxzLCBleHRyYUFyZ3MpKTtcbiAgaWYgKCFpc1NldHRlcikge1xuICAgIHZhciBsaW5lcyA9IGV4cHIuc3BsaXQoJ1xcbicpO1xuICAgIGxpbmVzW2xpbmVzLmxlbmd0aCAtIDFdID0gJ3JldHVybiAnICsgbGluZXNbbGluZXMubGVuZ3RoIC0gMV07XG4gICAgZXhwciA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuICB9XG4gIGV4cHIgPSBzdHJpbmdzLnB1dEluU3RyaW5ncyhleHByKTtcbiAgZnVuYyA9IGNvbXBpbGVFeHByZXNzaW9uKG9yaWdpbmFsLCBleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpO1xuICBmdW5jLmV4cHIgPSBleHByO1xuICBjYWNoZVtjYWNoZUtleV0gPSBmdW5jO1xuICByZXR1cm4gZnVuYztcbn07XG5cblxuZXhwb3J0cy5wYXJzZVNldHRlciA9IGZ1bmN0aW9uKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFBcmdzKSkgZXh0cmFBcmdzID0gW107XG5cbiAgLy8gQWRkIF92YWx1ZV8gYXMgdGhlIGZpcnN0IGV4dHJhIGFyZ3VtZW50XG4gIGV4dHJhQXJncy51bnNoaWZ0KHZhbHVlUHJvcGVydHkpO1xuICBleHByID0gZXhwci5yZXBsYWNlKC8oXFxzKlxcfHwkKS8sICcgPSBfdmFsdWVfJDEnKTtcblxuICByZXR1cm4gZXhwb3J0cy5wYXJzZShleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpO1xufTtcblxuXG5mdW5jdGlvbiBnZXRWYXJpYWJsZXMoZ2xvYmFscywgZXh0cmFBcmdzKSB7XG4gIHZhciB2YXJpYWJsZXMgPSB7fTtcblxuICBPYmplY3Qua2V5cyhleHBvcnRzLmdsb2JhbHMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgdmFyaWFibGVzW2tleV0gPSBleHBvcnRzLmdsb2JhbHNba2V5XTtcbiAgfSk7XG5cbiAgaWYgKGdsb2JhbHMpIHtcbiAgICBPYmplY3Qua2V5cyhnbG9iYWxzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyaWFibGVzW2tleV0gPSBnbG9iYWxzW2tleV07XG4gICAgfSk7XG4gIH1cblxuICBleHRyYUFyZ3MuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICB2YXJpYWJsZXNba2V5XSA9IG51bGw7XG4gIH0pO1xuXG4gIHJldHVybiB2YXJpYWJsZXM7XG59XG5cblxuXG5mdW5jdGlvbiBjb21waWxlRXhwcmVzc2lvbihvcmlnaW5hbCwgZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKSB7XG4gIHZhciBmdW5jLCBhcmdzID0gWydfZ2xvYmFsc18nLCAnX2Zvcm1hdHRlcnNfJ10uY29uY2F0KGV4dHJhQXJncykuY29uY2F0KGV4cHIpO1xuXG4gIHRyeSB7XG4gICAgZnVuYyA9IEZ1bmN0aW9uLmFwcGx5KG51bGwsIGFyZ3MpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gVGhyb3dzIGFuIGVycm9yIGlmIHRoZSBleHByZXNzaW9uIHdhcyBub3QgdmFsaWQgSmF2YVNjcmlwdFxuICAgIHRocm93IG5ldyBFcnJvcignQmFkIGV4cHJlc3Npb246ICcgKyBvcmlnaW5hbCArICdcXG4nICsgJ0NvbXBpbGVkIGV4cHJlc3Npb246XFxuJyArIGV4cHIgKyAnXFxuJyArIGUubWVzc2FnZSk7XG4gIH1cblxuICByZXR1cm4gYmluZEFyZ3VtZW50cyhmdW5jLCBnbG9iYWxzLCBmb3JtYXR0ZXJzKTtcbn1cblxuXG4vLyBhIGN1c3RvbSBcImJpbmRcIiBmdW5jdGlvbiB0byBiaW5kIGFyZ3VtZW50cyB0byBhIGZ1bmN0aW9uIHdpdGhvdXQgYmluZGluZyB0aGUgY29udGV4dFxuZnVuY3Rpb24gYmluZEFyZ3VtZW50cyhmdW5jKSB7XG4gIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZ1bmMuYXBwbHkodGhpcywgYXJncy5jb25jYXQoc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gIH1cbn1cbiIsIlxuLy8gZmluZHMgcGlwZXMgdGhhdCBhcmUgbm90IE9ScyAoaS5lLiBgIHwgYCBub3QgYCB8fCBgKSBmb3IgZm9ybWF0dGVyc1xudmFyIHBpcGVSZWdleCA9IC9cXHwoXFx8KT8vZztcblxuLy8gQSBzdHJpbmcgdGhhdCB3b3VsZCBub3QgYXBwZWFyIGluIHZhbGlkIEphdmFTY3JpcHRcbnZhciBwbGFjZWhvbGRlciA9ICdAQEAnO1xudmFyIHBsYWNlaG9sZGVyUmVnZXggPSBuZXcgUmVnRXhwKCdcXFxccyonICsgcGxhY2Vob2xkZXIgKyAnXFxcXHMqJyk7XG5cbi8vIGRldGVybWluZXMgd2hldGhlciBhbiBleHByZXNzaW9uIGlzIGEgc2V0dGVyIG9yIGdldHRlciAoYG5hbWVgIHZzIGBuYW1lID0gJ2JvYidgKVxudmFyIHNldHRlclJlZ2V4ID0gL1xccz1cXHMvO1xuXG4vLyBmaW5kcyB0aGUgcGFydHMgb2YgYSBmb3JtYXR0ZXIsIG5hbWUgYW5kIGFyZ3MgKGUuZy4gYGZvbyhiYXIpYClcbnZhciBmb3JtYXR0ZXJSZWdleCA9IC9eKFteXFwoXSspKD86XFwoKC4qKVxcKSk/JC87XG5cbi8vIGZpbmRzIGFyZ3VtZW50IHNlcGFyYXRvcnMgZm9yIGZvcm1hdHRlcnMgKGBhcmcxLCBhcmcyYClcbnZhciBhcmdTZXBhcmF0b3IgPSAvXFxzKixcXHMqL2c7XG5cblxuLyoqXG4gKiBGaW5kcyB0aGUgZm9ybWF0dGVycyB3aXRoaW4gYW4gZXhwcmVzc2lvbiBhbmQgY29udmVydHMgdGhlbSB0byB0aGUgY29ycmVjdCBKYXZhU2NyaXB0IGVxdWl2YWxlbnQuXG4gKi9cbmV4cG9ydHMucGFyc2VGb3JtYXR0ZXJzID0gZnVuY3Rpb24oZXhwcikge1xuICAvLyBDb252ZXJ0cyBgbmFtZSB8IHVwcGVyIHwgZm9vKGJhcilgIGludG8gYG5hbWUgQEBAIHVwcGVyIEBAQCBmb28oYmFyKWBcbiAgZXhwciA9IGV4cHIucmVwbGFjZShwaXBlUmVnZXgsIGZ1bmN0aW9uKG1hdGNoLCBvckluZGljYXRvcikge1xuICAgIGlmIChvckluZGljYXRvcikgcmV0dXJuIG1hdGNoO1xuICAgIHJldHVybiBwbGFjZWhvbGRlcjtcbiAgfSk7XG5cbiAgLy8gc3BsaXRzIHRoZSBzdHJpbmcgYnkgXCJAQEBcIiwgcHVsbHMgb2YgdGhlIGZpcnN0IGFzIHRoZSBleHByLCB0aGUgcmVtYWluaW5nIGFyZSBmb3JtYXR0ZXJzXG4gIGZvcm1hdHRlcnMgPSBleHByLnNwbGl0KHBsYWNlaG9sZGVyUmVnZXgpO1xuICBleHByID0gZm9ybWF0dGVycy5zaGlmdCgpO1xuICBpZiAoIWZvcm1hdHRlcnMubGVuZ3RoKSByZXR1cm4gZXhwcjtcblxuICAvLyBQcm9jZXNzZXMgdGhlIGZvcm1hdHRlcnNcbiAgLy8gSWYgdGhlIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgdGhlIHZhbHVlIHdpbGwgYmUgcnVuIHRocm91Z2ggdGhlIGZvcm1hdHRlcnNcbiAgdmFyIHNldHRlciA9ICcnO1xuICB2YXIgdmFsdWUgPSBleHByO1xuXG4gIGlmIChzZXR0ZXJSZWdleC50ZXN0KGV4cHIpKSB7XG4gICAgdmFyIHBhcnRzID0gZXhwci5zcGxpdChzZXR0ZXJSZWdleCk7XG4gICAgc2V0dGVyID0gcGFydHNbMF0gKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnRzWzFdO1xuICB9XG5cbiAgLy8gUHJvY2Vzc2VzIHRoZSBmb3JtYXR0ZXJzXG4gIGZvcm1hdHRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3JtYXR0ZXIpIHtcbiAgICB2YXIgbWF0Y2ggPSBmb3JtYXR0ZXIudHJpbSgpLm1hdGNoKGZvcm1hdHRlclJlZ2V4KTtcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRm9ybWF0dGVyIGlzIGludmFsaWQ6ICcgKyBmb3JtYXR0ZXIpO1xuICAgIH1cblxuICAgIHZhciBmb3JtYXR0ZXJOYW1lID0gbWF0Y2hbMV07XG4gICAgdmFyIGFyZ3MgPSBtYXRjaFsyXSA/IG1hdGNoWzJdLnNwbGl0KGFyZ1NlcGFyYXRvcikgOiBbXTtcblxuICAgIC8vIEFkZCB0aGUgcHJldmlvdXMgdmFsdWUgYXMgdGhlIGZpcnN0IGFyZ3VtZW50XG4gICAgYXJncy51bnNoaWZ0KHZhbHVlKTtcblxuICAgIC8vIElmIHRoaXMgaXMgYSBzZXR0ZXIgZXhwciwgYmUgc3VyZSB0byBhZGQgdGhlIGBpc1NldHRlcmAgZmxhZyBhdCB0aGUgZW5kIG9mIHRoZSBmb3JtYXR0ZXIncyBhcmd1bWVudHNcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICBhcmdzLnB1c2godHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gU2V0IHRoZSB2YWx1ZSB0byBiZWNvbWUgdGhlIHJlc3VsdCBvZiB0aGlzIGZvcm1hdHRlciwgc28gdGhlIG5leHQgZm9ybWF0dGVyIGNhbiB3cmFwIGl0LlxuICAgIC8vIENhbGwgZm9ybWF0dGVycyBpbiB0aGUgY3VycmVudCBjb250ZXh0LlxuICAgIHZhbHVlID0gJ19mb3JtYXR0ZXJzXy4nICsgZm9ybWF0dGVyTmFtZSArICcuY2FsbCh0aGlzLCAnICsgYXJncy5qb2luKCcsICcpICsgJyknO1xuICB9KTtcblxuICByZXR1cm4gc2V0dGVyICsgdmFsdWU7XG59O1xuIiwidmFyIHJlZmVyZW5jZUNvdW50ID0gMDtcbnZhciBjdXJyZW50UmVmZXJlbmNlID0gMDtcbnZhciBjdXJyZW50SW5kZXggPSAwO1xudmFyIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbnZhciBjb250aW51YXRpb24gPSBmYWxzZTtcbnZhciBnbG9iYWxzID0gbnVsbDtcbnZhciBkZWZhdWx0R2xvYmFscyA9IHtcbiAgcmV0dXJuOiBudWxsLFxuICB0cnVlOiBudWxsLFxuICBmYWxzZTogbnVsbCxcbiAgdW5kZWZpbmVkOiBudWxsLFxuICBudWxsOiBudWxsLFxuICB0aGlzOiBudWxsLFxuICB3aW5kb3c6IG51bGwsXG4gIE1hdGg6IG51bGwsXG4gIHBhcnNlSW50OiBudWxsLFxuICBwYXJzZUZsb2F0OiBudWxsLFxuICBpc05hTjogbnVsbCxcbiAgQXJyYXk6IG51bGwsXG4gIHR5cGVvZjogbnVsbCxcbiAgX2dsb2JhbHNfOiBudWxsLFxuICBfZm9ybWF0dGVyc186IG51bGwsXG4gIF92YWx1ZV86IG51bGwsXG59O1xuXG5cbi8vIG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIChlLmcuIGBuYW1lYCwgYHVzZXIubmFtZWAsIGFuZCBgdXNlci5mdWxsTmFtZSgpLmNhcGl0YWxpemUoKWApXG52YXIgcHJvcGVydHlSZWdleCA9IC8oKFxce3wsfFxcLik/XFxzKikoW2EteiRfXFwkXSg/OlthLXpfXFwkMC05XFwuLV18XFxbWydcIlxcZF0rXFxdKSopKFxccyooOnxcXCh8XFxbKT8pfChcXFspL2dpO1xuLyoqXG4gKiBCcm9rZW4gZG93blxuICpcbiAqICgoXFx7fCx8XFwuKT9cXHMqKVxuICogcHJlZml4OiBtYXRjaGVzIG9uIG9iamVjdCBsaXRlcmFscyBzbyB3ZSBjYW4gc2tpcCAoaW4gYHsgZm9vOiBiYXIgfWAgXCJmb29cIiBpcyBub3QgYSBwcm9wZXJ0eSkuIEFsc28gcGlja3MgdXAgb25cbiAqIHVuZmluaXNoZWQgY2hhaW5zIHRoYXQgaGFkIGZ1bmN0aW9uIGNhbGxzIG9yIGJyYWNrZXRzIHdlIGNvdWxkbid0IGZpbmlzaCBzdWNoIGFzIHRoZSBkb3QgaW4gYC50ZXN0YCBhZnRlciB0aGUgY2hhaW5cbiAqIGBmb28uYmFyKCkudGVzdGAuXG4gKlxuICogKFthLXokX1xcJF0oPzpbYS16X1xcJDAtOVxcLi1dfFxcW1snXCJcXGRdK1xcXSkqKVxuICogcHJvcGVydHkgY2hhaW46IG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIHN1Y2ggYXMgdGhlIGZvbGxvd2luZyAoc3RyaW5ncycgY29udGVudHMgYXJlIHJlbW92ZWQgYXQgdGhpcyBzdGVwKVxuICogICBgZm9vLCBmb28uYmFyLCBmb28uYmFyWzBdLCBmb28uYmFyWzBdLnRlc3QsIGZvby5iYXJbJyddLnRlc3RgXG4gKiAgIERvZXMgbm90IG1hdGNoIHRocm91Z2ggZnVuY3Rpb25zIGNhbGxzIG9yIHRocm91Z2ggYnJhY2tldHMgd2hpY2ggY29udGFpbiB2YXJpYWJsZXMuXG4gKiAgIGBmb28uYmFyKCkudGVzdCwgZm9vLmJhcltwcm9wXS50ZXN0YFxuICogICBJbiB0aGVzZSBjYXNlcyBpdCB3b3VsZCBvbmx5IG1hdGNoIGBmb28uYmFyYCwgYC50ZXN0YCwgYW5kIGBwcm9wYFxuICpcbiAqIChcXHMqKDp8XFwofFxcWyk/KVxuICogcG9zdGZpeDogbWF0Y2hlcyB0cmFpbGluZyBjaGFyYWN0ZXJzIHRvIGRldGVybWluZSBpZiB0aGlzIGlzIGFuIG9iamVjdCBwcm9wZXJ0eSBvciBhIGZ1bmN0aW9uIGNhbGwgZXRjLiBXaWxsIG1hdGNoXG4gKiB0aGUgY29sb24gYWZ0ZXIgXCJmb29cIiBpbiBgeyBmb286ICdiYXInIH1gLCB0aGUgZmlyc3QgcGFyZW50aGVzaXMgaW4gYG9iai5mb28oYmFyKWAsIHRoZSB0aGUgZmlyc3QgYnJhY2tldCBpblxuICogYGZvb1tiYXJdYC5cbiAqL1xuXG4vLyBsaW5rcyBpbiBhIHByb3BlcnR5IGNoYWluXG52YXIgY2hhaW5MaW5rc1JlZ2V4ID0gL1xcLnxcXFsvZztcblxuLy8gdGhlIHByb3BlcnR5IG5hbWUgcGFydCBvZiBsaW5rc1xudmFyIGNoYWluTGlua1JlZ2V4ID0gL1xcLnxcXFt8XFwoLztcblxudmFyIGFuZFJlZ2V4ID0gLyBhbmQgL2c7XG52YXIgb3JSZWdleCA9IC8gb3IgL2c7XG5cblxuZXhwb3J0cy5wYXJzZUV4cHJlc3Npb24gPSBmdW5jdGlvbihleHByLCBfZ2xvYmFscykge1xuICAvLyBSZXNldCBhbGwgdmFsdWVzXG4gIHJlZmVyZW5jZUNvdW50ID0gMDtcbiAgY3VycmVudFJlZmVyZW5jZSA9IDA7XG4gIGN1cnJlbnRJbmRleCA9IDA7XG4gIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbiAgY29udGludWF0aW9uID0gZmFsc2U7XG4gIGdsb2JhbHMgPSBfZ2xvYmFscztcblxuICBleHByID0gcmVwbGFjZUFuZHNBbmRPcnMoZXhwcik7XG4gIGlmIChleHByLmluZGV4T2YoJyA9ICcpICE9PSAtMSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoJyA9ICcpO1xuICAgIHZhciBzZXR0ZXIgPSBwYXJ0c1swXTtcbiAgICB2YXIgdmFsdWUgPSBwYXJ0c1sxXTtcbiAgICBzZXR0ZXIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKHNldHRlcikucmVwbGFjZSgvXlxcKHxcXCkkL2csICcnKTtcbiAgICB2YWx1ZSA9IHBhcnNlUHJvcGVydHlDaGFpbnModmFsdWUpO1xuICAgIGV4cHIgPSBzZXR0ZXIgKyAnID0gJyArIHZhbHVlO1xuICB9IGVsc2Uge1xuICAgIGV4cHIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKGV4cHIpO1xuICB9XG4gIGV4cHIgPSBhZGRSZWZlcmVuY2VzKGV4cHIpXG5cbiAgLy8gUmVzZXQgYWZ0ZXIgcGFyc2UgaXMgZG9uZVxuICBnbG9iYWxzID0gbnVsbDtcblxuICByZXR1cm4gZXhwcjtcbn07XG5cblxuLyoqXG4gKiBGaW5kcyBhbmQgcGFyc2VzIHRoZSBwcm9wZXJ0eSBjaGFpbnMgaW4gYW4gZXhwcmVzc2lvbi5cbiAqL1xuZnVuY3Rpb24gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKSB7XG4gIHZhciBwYXJzZWRFeHByID0gJycsIGNoYWluO1xuXG4gIC8vIGFsbG93IHJlY3Vyc2lvbiAoZS5nLiBpbnRvIGZ1bmN0aW9uIGFyZ3MpIGJ5IHJlc2V0dGluZyBwcm9wZXJ0eVJlZ2V4XG4gIC8vIFRoaXMgaXMgbW9yZSBlZmZpY2llbnQgdGhhbiBjcmVhdGluZyBhIG5ldyByZWdleCBmb3IgZWFjaCBjaGFpbiwgSSBhc3N1bWVcbiAgdmFyIHByZXZDdXJyZW50SW5kZXggPSBjdXJyZW50SW5kZXg7XG4gIHZhciBwcmV2TGFzdEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG5cbiAgY3VycmVudEluZGV4ID0gMDtcbiAgcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSAwO1xuICB3aGlsZSAoKGNoYWluID0gbmV4dENoYWluKGV4cHIpKSAhPT0gZmFsc2UpIHtcbiAgICBwYXJzZWRFeHByICs9IGNoYWluO1xuICB9XG5cbiAgLy8gUmVzZXQgaW5kZXhlc1xuICBjdXJyZW50SW5kZXggPSBwcmV2Q3VycmVudEluZGV4O1xuICBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCA9IHByZXZMYXN0SW5kZXg7XG4gIHJldHVybiBwYXJzZWRFeHByO1xufTtcblxuXG5mdW5jdGlvbiBuZXh0Q2hhaW4oZXhwcikge1xuICBpZiAoZmluaXNoZWRDaGFpbikge1xuICAgIHJldHVybiAoZmluaXNoZWRDaGFpbiA9IGZhbHNlKTtcbiAgfVxuICB2YXIgbWF0Y2ggPSBwcm9wZXJ0eVJlZ2V4LmV4ZWMoZXhwcik7XG4gIGlmICghbWF0Y2gpIHtcbiAgICBmaW5pc2hlZENoYWluID0gdHJ1ZSAvLyBtYWtlIHN1cmUgbmV4dCBjYWxsIHdlIHJldHVybiBmYWxzZVxuICAgIHJldHVybiBleHByLnNsaWNlKGN1cnJlbnRJbmRleCk7XG4gIH1cblxuICAvLyBgcHJlZml4YCBpcyBgb2JqSW5kaWNhdG9yYCB3aXRoIHRoZSB3aGl0ZXNwYWNlIHRoYXQgbWF5IGNvbWUgYWZ0ZXIgaXQuXG4gIHZhciBwcmVmaXggPSBtYXRjaFsxXTtcblxuICAvLyBgb2JqSW5kaWNhdG9yYCBpcyBge2Agb3IgYCxgIGFuZCBsZXQncyB1cyBrbm93IHRoaXMgaXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gIC8vIG5hbWUgKGUuZy4gcHJvcCBpbiBge3Byb3A6ZmFsc2V9YCkuXG4gIHZhciBvYmpJbmRpY2F0b3IgPSBtYXRjaFsyXTtcblxuICAvLyBgcHJvcENoYWluYCBpcyB0aGUgY2hhaW4gb2YgcHJvcGVydGllcyBtYXRjaGVkIChlLmcuIGB0aGlzLnVzZXIuZW1haWxgKS5cbiAgdmFyIHByb3BDaGFpbiA9IG1hdGNoWzNdO1xuXG4gIC8vIGBwb3N0Zml4YCBpcyB0aGUgYGNvbG9uT3JQYXJlbmAgd2l0aCB3aGl0ZXNwYWNlIGJlZm9yZSBpdC5cbiAgdmFyIHBvc3RmaXggPSBtYXRjaFs0XTtcblxuICAvLyBgY29sb25PclBhcmVuYCBtYXRjaGVzIHRoZSBjb2xvbiAoOikgYWZ0ZXIgdGhlIHByb3BlcnR5IChpZiBpdCBpcyBhbiBvYmplY3QpXG4gIC8vIG9yIHBhcmVudGhlc2lzIGlmIGl0IGlzIGEgZnVuY3Rpb24uIFdlIHVzZSBgY29sb25PclBhcmVuYCBhbmQgYG9iakluZGljYXRvcmBcbiAgLy8gdG8ga25vdyBpZiBpdCBpcyBhbiBvYmplY3QuXG4gIHZhciBjb2xvbk9yUGFyZW4gPSBtYXRjaFs1XTtcblxuICBtYXRjaCA9IG1hdGNoWzBdO1xuXG4gIHZhciBza2lwcGVkID0gZXhwci5zbGljZShjdXJyZW50SW5kZXgsIHByb3BlcnR5UmVnZXgubGFzdEluZGV4IC0gbWF0Y2gubGVuZ3RoKTtcbiAgY3VycmVudEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG5cbiAgLy8gc2tpcHMgb2JqZWN0IGtleXMgZS5nLiB0ZXN0IGluIGB7dGVzdDp0cnVlfWAuXG4gIGlmIChvYmpJbmRpY2F0b3IgJiYgY29sb25PclBhcmVuID09PSAnOicpIHtcbiAgICByZXR1cm4gc2tpcHBlZCArIG1hdGNoO1xuICB9XG5cbiAgcmV0dXJuIHNraXBwZWQgKyBwYXJzZUNoYWluKHByZWZpeCwgcHJvcENoYWluLCBwb3N0Zml4LCBjb2xvbk9yUGFyZW4sIGV4cHIpO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIHBhcmVuLCBleHByKSB7XG4gIC8vIGNvbnRpbnVhdGlvbnMgYWZ0ZXIgYSBmdW5jdGlvbiAoZS5nLiBgZ2V0VXNlcigxMikuZmlyc3ROYW1lYCkuXG4gIGNvbnRpbnVhdGlvbiA9IHByZWZpeCA9PT0gJy4nO1xuICBpZiAoY29udGludWF0aW9uKSB7XG4gICAgcHJvcENoYWluID0gJy4nICsgcHJvcENoYWluO1xuICAgIHByZWZpeCA9ICcnO1xuICB9XG5cbiAgdmFyIGxpbmtzID0gc3BsaXRMaW5rcyhwcm9wQ2hhaW4pO1xuICB2YXIgbmV3Q2hhaW4gPSAnJztcblxuICBpZiAobGlua3MubGVuZ3RoID09PSAxICYmICFjb250aW51YXRpb24gJiYgIXBhcmVuKSB7XG4gICAgbGluayA9IGxpbmtzWzBdO1xuICAgIG5ld0NoYWluID0gYWRkVGhpc09yR2xvYmFsKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGlmICghY29udGludWF0aW9uKSB7XG4gICAgICBuZXdDaGFpbiA9ICcoJztcbiAgICB9XG5cbiAgICBsaW5rcy5mb3JFYWNoKGZ1bmN0aW9uKGxpbmssIGluZGV4KSB7XG4gICAgICBpZiAoaW5kZXggIT09IGxpbmtzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgbmV3Q2hhaW4gKz0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghcGFyZW5zW3BhcmVuXSkge1xuICAgICAgICAgIG5ld0NoYWluICs9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChjb250aW51YXRpb24gJiYgaW5kZXggPT09IDApIHtcbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBvc3RmaXggPSBwb3N0Zml4LnJlcGxhY2UocGFyZW4sICcnKTtcbiAgICAgICAgICBuZXdDaGFpbiArPSBwYXJlbiA9PT0gJygnID8gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikgOiBwYXJzZUJyYWNrZXRzKGxpbmssIGluZGV4LCBleHByKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSAhPT0gJy4nKSB7XG4gICAgICBuZXdDaGFpbiArPSAnKSc7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHByZWZpeCArIG5ld0NoYWluICsgcG9zdGZpeDtcbn1cblxuXG5mdW5jdGlvbiBzcGxpdExpbmtzKGNoYWluKSB7XG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbWF0Y2g7XG4gIHdoaWxlIChtYXRjaCA9IGNoYWluTGlua3NSZWdleC5leGVjKGNoYWluKSkge1xuICAgIGlmIChjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4ID09PSAxKSBjb250aW51ZTtcbiAgICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4LCBjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4IC0gMSkpO1xuICAgIGluZGV4ID0gY2hhaW5MaW5rc1JlZ2V4Lmxhc3RJbmRleCAtIDE7XG4gIH1cbiAgcGFydHMucHVzaChjaGFpbi5zbGljZShpbmRleCkpO1xuICByZXR1cm4gcGFydHM7XG59XG5cblxuZnVuY3Rpb24gYWRkVGhpc09yR2xvYmFsKGNoYWluKSB7XG4gIHZhciBwcm9wID0gY2hhaW4uc3BsaXQoY2hhaW5MaW5rUmVnZXgpLnNoaWZ0KCk7XG4gIGlmIChnbG9iYWxzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgcmV0dXJuIGdsb2JhbHNbcHJvcF0gPT09IG51bGwgPyBjaGFpbiA6ICdfZ2xvYmFsc18uJyArIGNoYWluO1xuICB9IGVsc2UgaWYgKGRlZmF1bHRHbG9iYWxzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgcmV0dXJuIGNoYWluO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAndGhpcy4nICsgY2hhaW47XG4gIH1cbn1cblxuXG52YXIgcGFyZW5zID0ge1xuICAnKCc6ICcpJyxcbiAgJ1snOiAnXSdcbn07XG5cbi8vIEhhbmRsZXMgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgaW4gaXRzIGNvcnJlY3Qgc2NvcGVcbi8vIEZpbmRzIHRoZSBlbmQgb2YgdGhlIGZ1bmN0aW9uIGFuZCBwcm9jZXNzZXMgdGhlIGFyZ3VtZW50c1xuZnVuY3Rpb24gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcblxuICAvLyBBbHdheXMgY2FsbCBmdW5jdGlvbnMgaW4gdGhlIHNjb3BlIG9mIHRoZSBvYmplY3QgdGhleSdyZSBhIG1lbWJlciBvZlxuICBpZiAoaW5kZXggPT09IDApIHtcbiAgICBsaW5rID0gYWRkVGhpc09yR2xvYmFsKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGxpbmsgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluaztcbiAgfVxuXG4gIHZhciBjYWxsZWRMaW5rID0gbGluayArICcofn5pbnNpZGVQYXJlbnN+fiknO1xuICBpZiAoZXhwci5jaGFyQXQocHJvcGVydHlSZWdleC5sYXN0SW5kZXgpID09PSAnLicpIHtcbiAgICBjYWxsZWRMaW5rID0gcGFyc2VQYXJ0KGNhbGxlZExpbmssIGluZGV4KVxuICB9XG5cbiAgbGluayA9ICd0eXBlb2YgJyArIGxpbmsgKyAnICE9PSBcXCdmdW5jdGlvblxcJyA/IHZvaWQgMCA6ICcgKyBjYWxsZWRMaW5rO1xuICB2YXIgaW5zaWRlUGFyZW5zID0gY2FsbC5zbGljZSgxLCAtMSk7XG5cbiAgdmFyIHJlZiA9IGN1cnJlbnRSZWZlcmVuY2U7XG4gIGxpbmsgPSBsaW5rLnJlcGxhY2UoJ35+aW5zaWRlUGFyZW5zfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZVBhcmVucykpO1xuICBjdXJyZW50UmVmZXJlbmNlID0gcmVmO1xuICByZXR1cm4gbGluaztcbn1cblxuLy8gSGFuZGxlcyBhIGJyYWNrZXRlZCBleHByZXNzaW9uIHRvIGJlIHBhcnNlZFxuZnVuY3Rpb24gcGFyc2VCcmFja2V0cyhsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcbiAgdmFyIGluc2lkZUJyYWNrZXRzID0gY2FsbC5zbGljZSgxLCAtMSk7XG4gIHZhciBldmFsZWRMaW5rID0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgaW5kZXggKz0gMTtcbiAgbGluayA9ICdbfn5pbnNpZGVCcmFja2V0c35+XSc7XG5cbiAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSA9PT0gJy4nKSB7XG4gICAgbGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgbGluayA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICB9XG5cbiAgbGluayA9IGV2YWxlZExpbmsgKyBsaW5rO1xuXG4gIHZhciByZWYgPSBjdXJyZW50UmVmZXJlbmNlO1xuICBsaW5rID0gbGluay5yZXBsYWNlKCd+fmluc2lkZUJyYWNrZXRzfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZUJyYWNrZXRzKSk7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSByZWY7XG4gIHJldHVybiBsaW5rO1xufVxuXG5cbi8vIHJldHVybnMgdGhlIGNhbGwgcGFydCBvZiBhIGZ1bmN0aW9uIChlLmcuIGB0ZXN0KDEyMylgIHdvdWxkIHJldHVybiBgKDEyMylgKVxuZnVuY3Rpb24gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpIHtcbiAgdmFyIHN0YXJ0SW5kZXggPSBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleDtcbiAgdmFyIG9wZW4gPSBleHByLmNoYXJBdChzdGFydEluZGV4IC0gMSk7XG4gIHZhciBjbG9zZSA9IHBhcmVuc1tvcGVuXTtcbiAgdmFyIGVuZEluZGV4ID0gc3RhcnRJbmRleCAtIDE7XG4gIHZhciBwYXJlbkNvdW50ID0gMTtcbiAgd2hpbGUgKGVuZEluZGV4KysgPCBleHByLmxlbmd0aCkge1xuICAgIHZhciBjaCA9IGV4cHIuY2hhckF0KGVuZEluZGV4KTtcbiAgICBpZiAoY2ggPT09IG9wZW4pIHBhcmVuQ291bnQrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gY2xvc2UpIHBhcmVuQ291bnQtLTtcbiAgICBpZiAocGFyZW5Db3VudCA9PT0gMCkgYnJlYWs7XG4gIH1cbiAgY3VycmVudEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSBlbmRJbmRleCArIDE7XG4gIHJldHVybiBvcGVuICsgZXhwci5zbGljZShzdGFydEluZGV4LCBlbmRJbmRleCkgKyBjbG9zZTtcbn1cblxuXG5cbmZ1bmN0aW9uIHBhcnNlUGFydChwYXJ0LCBpbmRleCkge1xuICAvLyBpZiB0aGUgZmlyc3RcbiAgaWYgKGluZGV4ID09PSAwICYmICFjb250aW51YXRpb24pIHtcbiAgICBwYXJ0ID0gYWRkVGhpc09yR2xvYmFsKHBhcnQpO1xuICB9IGVsc2Uge1xuICAgIHBhcnQgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgcGFydDtcbiAgfVxuXG4gIGN1cnJlbnRSZWZlcmVuY2UgPSArK3JlZmVyZW5jZUNvdW50O1xuICB2YXIgcmVmID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZTtcbiAgcmV0dXJuICcoJyArIHJlZiArICcgPSAnICsgcGFydCArICcpID09IG51bGwgPyB2b2lkIDAgOiAnO1xufVxuXG5cbmZ1bmN0aW9uIHJlcGxhY2VBbmRzQW5kT3JzKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIucmVwbGFjZShhbmRSZWdleCwgJyAmJiAnKS5yZXBsYWNlKG9yUmVnZXgsICcgfHwgJyk7XG59XG5cblxuLy8gUHJlcGVuZHMgcmVmZXJlbmNlIHZhcmlhYmxlIGRlZmluaXRpb25zXG5mdW5jdGlvbiBhZGRSZWZlcmVuY2VzKGV4cHIpIHtcbiAgaWYgKHJlZmVyZW5jZUNvdW50KSB7XG4gICAgdmFyIHJlZnMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMTsgaSA8PSByZWZlcmVuY2VDb3VudDsgaSsrKSB7XG4gICAgICByZWZzLnB1c2goJ19yZWYnICsgaSk7XG4gICAgfVxuICAgIGV4cHIgPSAndmFyICcgKyByZWZzLmpvaW4oJywgJykgKyAnO1xcbicgKyBleHByO1xuICB9XG4gIHJldHVybiBleHByO1xufVxuIiwiLy8gZmluZHMgYWxsIHF1b3RlZCBzdHJpbmdzXG52YXIgcXVvdGVSZWdleCA9IC8oWydcIlxcL10pKFxcXFxcXDF8W15cXDFdKSo/XFwxL2c7XG5cbi8vIGZpbmRzIGFsbCBlbXB0eSBxdW90ZWQgc3RyaW5nc1xudmFyIGVtcHR5UXVvdGVFeHByID0gLyhbJ1wiXFwvXSlcXDEvZztcblxudmFyIHN0cmluZ3MgPSBudWxsO1xuXG5cbi8qKlxuICogUmVtb3ZlIHN0cmluZ3MgZnJvbSBhbiBleHByZXNzaW9uIGZvciBlYXNpZXIgcGFyc2luZy4gUmV0dXJucyBhIGxpc3Qgb2YgdGhlIHN0cmluZ3MgdG8gYWRkIGJhY2sgaW4gbGF0ZXIuXG4gKiBUaGlzIG1ldGhvZCBhY3R1YWxseSBsZWF2ZXMgdGhlIHN0cmluZyBxdW90ZSBtYXJrcyBidXQgZW1wdGllcyB0aGVtIG9mIHRoZWlyIGNvbnRlbnRzLiBUaGVuIHdoZW4gcmVwbGFjaW5nIHRoZW0gYWZ0ZXJcbiAqIHBhcnNpbmcgdGhlIGNvbnRlbnRzIGp1c3QgZ2V0IHB1dCBiYWNrIGludG8gdGhlaXIgcXVvdGVzIG1hcmtzLlxuICovXG5leHBvcnRzLnB1bGxPdXRTdHJpbmdzID0gZnVuY3Rpb24oZXhwcikge1xuICBpZiAoc3RyaW5ncykge1xuICAgIHRocm93IG5ldyBFcnJvcigncHV0SW5TdHJpbmdzIG11c3QgYmUgY2FsbGVkIGFmdGVyIHB1bGxPdXRTdHJpbmdzLicpO1xuICB9XG5cbiAgc3RyaW5ncyA9IFtdO1xuXG4gIHJldHVybiBleHByLnJlcGxhY2UocXVvdGVSZWdleCwgZnVuY3Rpb24oc3RyLCBxdW90ZSkge1xuICAgIHN0cmluZ3MucHVzaChzdHIpO1xuICAgIHJldHVybiBxdW90ZSArIHF1b3RlOyAvLyBwbGFjZWhvbGRlciBmb3IgdGhlIHN0cmluZ1xuICB9KTtcbn07XG5cblxuLyoqXG4gKiBSZXBsYWNlIHRoZSBzdHJpbmdzIHByZXZpb3VzbHkgcHVsbGVkIG91dCBhZnRlciBwYXJzaW5nIGlzIGZpbmlzaGVkLlxuICovXG5leHBvcnRzLnB1dEluU3RyaW5ncyA9IGZ1bmN0aW9uKGV4cHIpIHtcbiAgaWYgKCFzdHJpbmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdWxsT3V0U3RyaW5ncyBtdXN0IGJlIGNhbGxlZCBiZWZvcmUgcHV0SW5TdHJpbmdzLicpO1xuICB9XG5cbiAgZXhwciA9IGV4cHIucmVwbGFjZShlbXB0eVF1b3RlRXhwciwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHN0cmluZ3Muc2hpZnQoKTtcbiAgfSk7XG5cbiAgc3RyaW5ncyA9IG51bGw7XG5cbiAgcmV0dXJuIGV4cHI7XG59O1xuIiwidmFyIEZyYWdtZW50cyA9IHJlcXVpcmUoJy4vc3JjL2ZyYWdtZW50cycpO1xudmFyIE9ic2VydmVyID0gcmVxdWlyZSgnLi9zcmMvb2JzZXJ2ZXInKTtcblxuZnVuY3Rpb24gY3JlYXRlKCkge1xuICB2YXIgZnJhZ21lbnRzID0gbmV3IEZyYWdtZW50cyhPYnNlcnZlcik7XG4gIGZyYWdtZW50cy5leHByZXNzaW9ucyA9IE9ic2VydmVyLmV4cHJlc3Npb25zO1xuICBmcmFnbWVudHMuc3luYyA9IE9ic2VydmVyLnN5bmM7XG4gIGZyYWdtZW50cy5zeW5jTm93ID0gT2JzZXJ2ZXIuc3luY05vdztcbiAgcmV0dXJuIGZyYWdtZW50cztcbn1cblxuLy8gQ3JlYXRlIGFuIGluc3RhbmNlIG9mIGZyYWdtZW50cyB3aXRoIHRoZSBkZWZhdWx0IG9ic2VydmVyXG5tb2R1bGUuZXhwb3J0cyA9IGNyZWF0ZSgpO1xubW9kdWxlLmV4cG9ydHMuY3JlYXRlID0gY3JlYXRlO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBBbmltYXRlZEJpbmRpbmc7XG52YXIgYW5pbWF0aW9uID0gcmVxdWlyZSgnLi91dGlsL2FuaW1hdGlvbicpO1xudmFyIEJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKTtcbnZhciBfc3VwZXIgPSBCaW5kaW5nLnByb3RvdHlwZTtcblxuLyoqXG4gKiBCaW5kaW5ncyB3aGljaCBleHRlbmQgQW5pbWF0ZWRCaW5kaW5nIGhhdmUgdGhlIGFiaWxpdHkgdG8gYW5pbWF0ZSBlbGVtZW50cyB0aGF0IGFyZSBhZGRlZCB0byB0aGUgRE9NIGFuZCByZW1vdmVkIGZyb21cbiAqIHRoZSBET00uIFRoaXMgYWxsb3dzIG1lbnVzIHRvIHNsaWRlIG9wZW4gYW5kIGNsb3NlZCwgZWxlbWVudHMgdG8gZmFkZSBpbiBvciBkcm9wIGRvd24sIGFuZCByZXBlYXRlZCBpdGVtcyB0byBhcHBlYXJcbiAqIHRvIG1vdmUgKGlmIHlvdSBnZXQgY3JlYXRpdmUgZW5vdWdoKS5cbiAqXG4gKiBUaGUgZm9sbG93aW5nIDUgbWV0aG9kcyBhcmUgaGVscGVyIERPTSBtZXRob2RzIHRoYXQgYWxsb3cgcmVnaXN0ZXJlZCBiaW5kaW5ncyB0byB3b3JrIHdpdGggQ1NTIHRyYW5zaXRpb25zIGZvclxuICogYW5pbWF0aW5nIGVsZW1lbnRzLiBJZiBhbiBlbGVtZW50IGhhcyB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBvciBhIG1hdGNoaW5nIEphdmFTY3JpcHQgbWV0aG9kLCB0aGVzZSBoZWxwZXIgbWV0aG9kc1xuICogd2lsbCBzZXQgYSBjbGFzcyBvbiB0aGUgbm9kZSB0byB0cmlnZ2VyIHRoZSBhbmltYXRpb24gYW5kL29yIGNhbGwgdGhlIEphdmFTY3JpcHQgbWV0aG9kcyB0byBoYW5kbGUgaXQuXG4gKlxuICogQW4gYW5pbWF0aW9uIG1heSBiZSBlaXRoZXIgYSBDU1MgdHJhbnNpdGlvbiwgYSBDU1MgYW5pbWF0aW9uLCBvciBhIHNldCBvZiBKYXZhU2NyaXB0IG1ldGhvZHMgdGhhdCB3aWxsIGJlIGNhbGxlZC5cbiAqXG4gKiBJZiB1c2luZyBDU1MsIGNsYXNzZXMgYXJlIGFkZGVkIGFuZCByZW1vdmVkIGZyb20gdGhlIGVsZW1lbnQuIFdoZW4gYW4gZWxlbWVudCBpcyBpbnNlcnRlZCBpdCB3aWxsIHJlY2VpdmUgdGhlIGB3aWxsLVxuICogYW5pbWF0ZS1pbmAgY2xhc3MgYmVmb3JlIGJlaW5nIGFkZGVkIHRvIHRoZSBET00sIHRoZW4gaXQgd2lsbCByZWNlaXZlIHRoZSBgYW5pbWF0ZS1pbmAgY2xhc3MgaW1tZWRpYXRlbHkgYWZ0ZXIgYmVpbmdcbiAqIGFkZGVkIHRvIHRoZSBET00sIHRoZW4gYm90aCBjbGFzZXMgd2lsbCBiZSByZW1vdmVkIGFmdGVyIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuIFdoZW4gYW4gZWxlbWVudCBpcyBiZWluZyByZW1vdmVkXG4gKiBmcm9tIHRoZSBET00gaXQgd2lsbCByZWNlaXZlIHRoZSBgd2lsbC1hbmltYXRlLW91dGAgYW5kIGBhbmltYXRlLW91dGAgY2xhc3NlcywgdGhlbiB0aGUgY2xhc3NlcyB3aWxsIGJlIHJlbW92ZWQgb25jZVxuICogdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS5cbiAqXG4gKiBJZiB1c2luZyBKYXZhU2NyaXB0LCBtZXRob2RzIG11c3QgYmUgZGVmaW5lZCAgdG8gYW5pbWF0ZSB0aGUgZWxlbWVudCB0aGVyZSBhcmUgMyBzdXBwb3J0ZWQgbWV0aG9kcyB3aGljaCBjYW4gYlxuICpcbiAqIFRPRE8gY2FjaGUgYnkgY2xhc3MtbmFtZSAoQW5ndWxhcik/IE9ubHkgc3VwcG9ydCBqYXZhc2NyaXB0LXN0eWxlIChFbWJlcik/IEFkZCBhIGB3aWxsLWFuaW1hdGUtaW5gIGFuZFxuICogYGRpZC1hbmltYXRlLWluYCBldGMuP1xuICogSUYgaGFzIGFueSBjbGFzc2VzLCBhZGQgdGhlIGB3aWxsLWFuaW1hdGUtaW58b3V0YCBhbmQgZ2V0IGNvbXB1dGVkIGR1cmF0aW9uLiBJZiBub25lLCByZXR1cm4uIENhY2hlLlxuICogUlVMRSBpcyB1c2UgdW5pcXVlIGNsYXNzIHRvIGRlZmluZSBhbiBhbmltYXRpb24uIE9yIGF0dHJpYnV0ZSBgYW5pbWF0ZT1cImZhZGVcImAgd2lsbCBhZGQgdGhlIGNsYXNzP1xuICogYC5mYWRlLndpbGwtYW5pbWF0ZS1pbmAsIGAuZmFkZS5hbmltYXRlLWluYCwgYC5mYWRlLndpbGwtYW5pbWF0ZS1vdXRgLCBgLmZhZGUuYW5pbWF0ZS1vdXRgXG4gKlxuICogRXZlbnRzIHdpbGwgYmUgdHJpZ2dlcmVkIG9uIHRoZSBlbGVtZW50cyBuYW1lZCB0aGUgc2FtZSBhcyB0aGUgY2xhc3MgbmFtZXMgKGUuZy4gYGFuaW1hdGUtaW5gKSB3aGljaCBtYXkgYmUgbGlzdGVuZWRcbiAqIHRvIGluIG9yZGVyIHRvIGNhbmNlbCBhbiBhbmltYXRpb24gb3IgcmVzcG9uZCB0byBpdC5cbiAqXG4gKiBJZiB0aGUgbm9kZSBoYXMgbWV0aG9kcyBgYW5pbWF0ZUluKGRvbmUpYCwgYGFuaW1hdGVPdXQoZG9uZSlgLCBgYW5pbWF0ZU1vdmVJbihkb25lKWAsIG9yIGBhbmltYXRlTW92ZU91dChkb25lKWBcbiAqIGRlZmluZWQgb24gdGhlbSB0aGVuIHRoZSBoZWxwZXJzIHdpbGwgYWxsb3cgYW4gYW5pbWF0aW9uIGluIEphdmFTY3JpcHQgdG8gYmUgcnVuIGFuZCB3YWl0IGZvciB0aGUgYGRvbmVgIGZ1bmN0aW9uIHRvXG4gKiBiZSBjYWxsZWQgdG8ga25vdyB3aGVuIHRoZSBhbmltYXRpb24gaXMgY29tcGxldGUuXG4gKlxuICogQmUgc3VyZSB0byBhY3R1YWxseSBoYXZlIGFuIGFuaW1hdGlvbiBkZWZpbmVkIGZvciBlbGVtZW50cyB3aXRoIHRoZSBgYW5pbWF0ZWAgY2xhc3MvYXR0cmlidXRlIGJlY2F1c2UgdGhlIGhlbHBlcnMgdXNlXG4gKiB0aGUgYHRyYW5zaXRpb25lbmRgIGFuZCBgYW5pbWF0aW9uZW5kYCBldmVudHMgdG8ga25vdyB3aGVuIHRoZSBhbmltYXRpb24gaXMgZmluaXNoZWQsIGFuZCBpZiB0aGVyZSBpcyBubyBhbmltYXRpb25cbiAqIHRoZXNlIGV2ZW50cyB3aWxsIG5ldmVyIGJlIHRyaWdnZXJlZCBhbmQgdGhlIG9wZXJhdGlvbiB3aWxsIG5ldmVyIGNvbXBsZXRlLlxuICovXG5mdW5jdGlvbiBBbmltYXRlZEJpbmRpbmcocHJvcGVydGllcykge1xuICB2YXIgZWxlbWVudCA9IHByb3BlcnRpZXMubm9kZTtcbiAgdmFyIGFuaW1hdGUgPSBlbGVtZW50LmdldEF0dHJpYnV0ZShwcm9wZXJ0aWVzLmZyYWdtZW50cy5hbmltYXRlQXR0cmlidXRlKTtcbiAgdmFyIGZyYWdtZW50cyA9IHByb3BlcnRpZXMuZnJhZ21lbnRzO1xuXG4gIGlmIChhbmltYXRlICE9PSBudWxsKSB7XG4gICAgaWYgKGVsZW1lbnQubm9kZU5hbWUgPT09ICdURU1QTEFURScgfHwgZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1NDUklQVCcpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGFuaW1hdGUgbXVsdGlwbGUgbm9kZXMgaW4gYSB0ZW1wbGF0ZSBvciBzY3JpcHQuIFJlbW92ZSB0aGUgW2FuaW1hdGVdIGF0dHJpYnV0ZS4nKTtcbiAgICB9XG5cbiAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgLy8gQWxsb3cgbXVsdGlwbGUgYmluZGluZ3MgdG8gYW5pbWF0ZSBieSBub3QgcmVtb3ZpbmcgdW50aWwgdGhleSBoYXZlIGFsbCBiZWVuIGNyZWF0ZWRcbiAgICAgIGVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHByb3BlcnRpZXMuZnJhZ21lbnRzLmFuaW1hdGVBdHRyaWJ1dGUpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5hbmltYXRlID0gdHJ1ZTtcblxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgnYXR0cmlidXRlJywgYW5pbWF0ZSkpIHtcbiAgICAgIC8vIGphdmFzY3JpcHQgYW5pbWF0aW9uXG4gICAgICB0aGlzLmFuaW1hdGVFeHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIGFuaW1hdGUpO1xuICAgIH0gZWxzZSB7XG4gICAgICBpZiAoYW5pbWF0ZVswXSA9PT0gJy4nKSB7XG4gICAgICAgIC8vIGNsYXNzIGFuaW1hdGlvblxuICAgICAgICB0aGlzLmFuaW1hdGVDbGFzc05hbWUgPSBhbmltYXRlLnNsaWNlKDEpO1xuICAgICAgfSBlbHNlIGlmIChhbmltYXRlKSB7XG4gICAgICAgIC8vIHJlZ2lzdGVyZWQgYW5pbWF0aW9uXG4gICAgICAgIHZhciBhbmltYXRlT2JqZWN0ID0gZnJhZ21lbnRzLmdldEFuaW1hdGlvbihhbmltYXRlKTtcbiAgICAgICAgaWYgKHR5cGVvZiBhbmltYXRlT2JqZWN0ID09PSAnZnVuY3Rpb24nKSBhbmltYXRlT2JqZWN0ID0gbmV3IGFuaW1hdGVPYmplY3QodGhpcyk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU9iamVjdCA9IGFuaW1hdGVPYmplY3Q7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgQmluZGluZy5jYWxsKHRoaXMsIHByb3BlcnRpZXMpO1xufVxuXG5cbkJpbmRpbmcuZXh0ZW5kKEFuaW1hdGVkQmluZGluZywge1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBfc3VwZXIuaW5pdC5jYWxsKHRoaXMpO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24pIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyID0gbmV3IHRoaXMuT2JzZXJ2ZXIodGhpcy5hbmltYXRlRXhwcmVzc2lvbiwgZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgdGhpcy5hbmltYXRlT2JqZWN0ID0gdmFsdWU7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9XG4gIH0sXG5cbiAgYmluZDogZnVuY3Rpb24oY29udGV4dCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT0gY29udGV4dCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBfc3VwZXIuYmluZC5jYWxsKHRoaXMsIGNvbnRleHQpO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZU9ic2VydmVyKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlci5iaW5kKGNvbnRleHQpO1xuICAgIH1cbiAgfSxcblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgX3N1cGVyLnVuYmluZC5jYWxsKHRoaXMpO1xuXG4gICAgaWYgKHRoaXMuYW5pbWF0ZU9ic2VydmVyKSB7XG4gICAgICB0aGlzLmFuaW1hdGVPYnNlcnZlci51bmJpbmQoKTtcbiAgICB9XG4gIH0sXG5cbiAgLyoqXG4gICAqIEhlbHBlciBtZXRob2QgdG8gcmVtb3ZlIGEgbm9kZSBmcm9tIHRoZSBET00sIGFsbG93aW5nIGZvciBhbmltYXRpb25zIHRvIG9jY3VyLiBgY2FsbGJhY2tgIHdpbGwgYmUgY2FsbGVkIHdoZW5cbiAgICogZmluaXNoZWQuXG4gICAqL1xuICBhbmltYXRlT3V0OiBmdW5jdGlvbihub2RlLCBjYWxsYmFjaykge1xuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG5cbiAgICB0aGlzLmFuaW1hdGVOb2RlKCdvdXQnLCBub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbCh0aGlzKTtcbiAgICB9KTtcbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byBpbnNlcnQgYSBub2RlIGluIHRoZSBET00gYmVmb3JlIGFub3RoZXIgbm9kZSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbFxuICAgKiBiZSBjYWxsZWQgd2hlbiBmaW5pc2hlZC4gSWYgYGJlZm9yZWAgaXMgbm90IHByb3ZpZGVkIHRoZW4gdGhlIGFuaW1hdGlvbiB3aWxsIGJlIHJ1biB3aXRob3V0IGluc2VydGluZyB0aGUgbm9kZS5cbiAgICovXG4gIGFuaW1hdGVJbjogZnVuY3Rpb24obm9kZSwgY2FsbGJhY2spIHtcbiAgICBpZiAobm9kZS5maXJzdFZpZXdOb2RlKSBub2RlID0gbm9kZS5maXJzdFZpZXdOb2RlO1xuICAgIHRoaXMuYW5pbWF0ZU5vZGUoJ2luJywgbm9kZSwgY2FsbGJhY2ssIHRoaXMpO1xuICB9LFxuXG4gIC8qKlxuICAgKiBBbGxvdyBhbiBlbGVtZW50IHRvIHVzZSBDU1MzIHRyYW5zaXRpb25zIG9yIGFuaW1hdGlvbnMgdG8gYW5pbWF0ZSBpbiBvciBvdXQgb2YgdGhlIHBhZ2UuXG4gICAqL1xuICBhbmltYXRlTm9kZTogZnVuY3Rpb24oZGlyZWN0aW9uLCBub2RlLCBjYWxsYmFjaykge1xuICAgIHZhciBhbmltYXRlT2JqZWN0LCBjbGFzc05hbWUsIG5hbWUsIHdpbGxOYW1lLCBkaWROYW1lLCBfdGhpcyA9IHRoaXM7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JqZWN0ICYmIHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdvYmplY3QnKSB7XG4gICAgICBhbmltYXRlT2JqZWN0ID0gdGhpcy5hbmltYXRlT2JqZWN0O1xuICAgIH0gZWxzZSBpZiAodGhpcy5hbmltYXRlQ2xhc3NOYW1lKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVDbGFzc05hbWU7XG4gICAgfSBlbHNlIGlmICh0eXBlb2YgdGhpcy5hbmltYXRlT2JqZWN0ID09PSAnc3RyaW5nJykge1xuICAgICAgY2xhc3NOYW1lID0gdGhpcy5hbmltYXRlT2JqZWN0O1xuICAgIH1cblxuICAgIGlmIChhbmltYXRlT2JqZWN0KSB7XG4gICAgICB2YXIgZGlyID0gZGlyZWN0aW9uID09PSAnaW4nID8gJ0luJyA6ICdPdXQnO1xuICAgICAgbmFtZSA9ICdhbmltYXRlJyArIGRpcjtcbiAgICAgIHdpbGxOYW1lID0gJ3dpbGxBbmltYXRlJyArIGRpcjtcbiAgICAgIGRpZE5hbWUgPSAnZGlkQW5pbWF0ZScgKyBkaXI7XG5cbiAgICAgIGFuaW1hdGlvbi5tYWtlRWxlbWVudEFuaW1hdGFibGUobm9kZSk7XG5cbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W3dpbGxOYW1lXSkge1xuICAgICAgICBhbmltYXRlT2JqZWN0W3dpbGxOYW1lXShub2RlKTtcbiAgICAgICAgLy8gdHJpZ2dlciByZWZsb3dcbiAgICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG4gICAgICB9XG5cbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W25hbWVdKSB7XG4gICAgICAgIGFuaW1hdGVPYmplY3RbbmFtZV0obm9kZSwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgaWYgKGFuaW1hdGVPYmplY3RbZGlkTmFtZV0pIGFuaW1hdGVPYmplY3RbZGlkTmFtZV0obm9kZSk7XG4gICAgICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKF90aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIG5hbWUgPSAnYW5pbWF0ZS0nICsgZGlyZWN0aW9uO1xuICAgICAgd2lsbE5hbWUgPSAnd2lsbC1hbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5hZGQoY2xhc3NOYW1lKTtcblxuICAgICAgaWYgKGRpcmVjdGlvbiA9PT0gJ2luJykge1xuICAgICAgICB2YXIgbmV4dCA9IG5vZGUubmV4dFNpYmxpbmcsIHBhcmVudCA9IG5vZGUucGFyZW50Tm9kZTtcbiAgICAgICAgcGFyZW50LnJlbW92ZUNoaWxkKG5vZGUpO1xuICAgICAgICBub2RlLmNsYXNzTGlzdC5hZGQod2lsbE5hbWUpO1xuICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKG5vZGUsIG5leHQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgLy8gdHJpZ2dlciByZWZsb3dcbiAgICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG4gICAgICB9XG5cbiAgICAgIG5vZGUuY2xhc3NMaXN0LnJlbW92ZSh3aWxsTmFtZSk7XG4gICAgICBub2RlLmNsYXNzTGlzdC5hZGQobmFtZSk7XG5cbiAgICAgIHZhciBkdXJhdGlvbiA9IGdldER1cmF0aW9uLmNhbGwodGhpcywgbm9kZSwgZGlyZWN0aW9uKTtcbiAgICAgIGZ1bmN0aW9uIHdoZW5Eb25lKCkge1xuICAgICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUobmFtZSk7XG4gICAgICAgIGlmIChjbGFzc05hbWUpIG5vZGUuY2xhc3NMaXN0LnJlbW92ZShjbGFzc05hbWUpO1xuICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwoX3RoaXMpO1xuICAgICAgfVxuXG4gICAgICBpZiAoZHVyYXRpb24pIHtcbiAgICAgICAgc2V0VGltZW91dCh3aGVuRG9uZSwgZHVyYXRpb24pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd2hlbkRvbmUoKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn0pO1xuXG5cbnZhciB0cmFuc2l0aW9uRHVyYXRpb25OYW1lID0gJ3RyYW5zaXRpb25EdXJhdGlvbic7XG52YXIgdHJhbnNpdGlvbkRlbGF5TmFtZSA9ICd0cmFuc2l0aW9uRGVsYXknO1xudmFyIGFuaW1hdGlvbkR1cmF0aW9uTmFtZSA9ICdhbmltYXRpb25EdXJhdGlvbic7XG52YXIgYW5pbWF0aW9uRGVsYXlOYW1lID0gJ2FuaW1hdGlvbkRlbGF5JztcbnZhciBzdHlsZSA9IGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5zdHlsZTtcbmlmIChzdHlsZS50cmFuc2l0aW9uRHVyYXRpb24gPT09IHVuZGVmaW5lZCAmJiBzdHlsZS53ZWJraXRUcmFuc2l0aW9uRHVyYXRpb24gIT09IHVuZGVmaW5lZCkge1xuICB0cmFuc2l0aW9uRHVyYXRpb25OYW1lID0gJ3dlYmtpdFRyYW5zaXRpb25EdXJhdGlvbic7XG4gIHRyYW5zaXRpb25EZWxheU5hbWUgPSAnd2Via2l0VHJhbnNpdGlvbkRlbGF5Jztcbn1cbmlmIChzdHlsZS5hbmltYXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlLndlYmtpdEFuaW1hdGlvbkR1cmF0aW9uICE9PSB1bmRlZmluZWQpIHtcbiAgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ3dlYmtpdEFuaW1hdGlvbkR1cmF0aW9uJztcbiAgYW5pbWF0aW9uRGVsYXlOYW1lID0gJ3dlYmtpdEFuaW1hdGlvbkRlbGF5Jztcbn1cblxuXG5mdW5jdGlvbiBnZXREdXJhdGlvbihub2RlLCBkaXJlY3Rpb24pIHtcbiAgdmFyIG1pbGxpc2Vjb25kcyA9IHRoaXMuY2xvbmVkRnJvbVsnX19hbmltYXRpb25EdXJhdGlvbicgKyBkaXJlY3Rpb25dO1xuICBpZiAoIW1pbGxpc2Vjb25kcykge1xuICAgIC8vIFJlY2FsYyBpZiBub2RlIHdhcyBvdXQgb2YgRE9NIGJlZm9yZSBhbmQgaGFkIDAgZHVyYXRpb24sIGFzc3VtZSB0aGVyZSBpcyBhbHdheXMgU09NRSBkdXJhdGlvbi5cbiAgICB2YXIgc3R5bGVzID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgdmFyIHNlY29uZHMgPSBNYXRoLm1heChwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRHVyYXRpb25OYW1lXSB8fCAwKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRGVsYXlOYW1lXSB8fCAwKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW2FuaW1hdGlvbkR1cmF0aW9uTmFtZV0gfHwgMCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbYW5pbWF0aW9uRGVsYXlOYW1lXSB8fCAwKSk7XG4gICAgbWlsbGlzZWNvbmRzID0gc2Vjb25kcyAqIDEwMDAgfHwgMDtcbiAgICB0aGlzLmNsb25lZEZyb20uX19hbmltYXRpb25EdXJhdGlvbl9fID0gbWlsbGlzZWNvbmRzO1xuICB9XG4gIHJldHVybiBtaWxsaXNlY29uZHM7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEJpbmRpbmc7XG52YXIgZXh0ZW5kID0gcmVxdWlyZSgnLi91dGlsL2V4dGVuZCcpO1xuXG4vKipcbiAqIEEgYmluZGluZyBpcyBhIGxpbmsgYmV0d2VlbiBhbiBlbGVtZW50IGFuZCBzb21lIGRhdGEuIFN1YmNsYXNzZXMgb2YgQmluZGluZyBjYWxsZWQgYmluZGVycyBkZWZpbmUgd2hhdCBhIGJpbmRpbmcgZG9lc1xuICogd2l0aCB0aGF0IGxpbmsuIEluc3RhbmNlcyBvZiB0aGVzZSBiaW5kZXJzIGFyZSBjcmVhdGVkIGFzIGJpbmRpbmdzIG9uIHRlbXBsYXRlcy4gV2hlbiBhIHZpZXcgaXMgc3RhbXBlZCBvdXQgZnJvbSB0aGVcbiAqIHRlbXBsYXRlIHRoZSBiaW5kaW5nIGlzIFwiY2xvbmVkXCIgKGl0IGlzIGFjdHVhbGx5IGV4dGVuZGVkIGZvciBwZXJmb3JtYW5jZSkgYW5kIHRoZSBgZWxlbWVudGAvYG5vZGVgIHByb3BlcnR5IGlzXG4gKiB1cGRhdGVkIHRvIHRoZSBtYXRjaGluZyBlbGVtZW50IGluIHRoZSB2aWV3LlxuICpcbiAqICMjIyBQcm9wZXJ0aWVzXG4gKiAgKiBlbGVtZW50OiBUaGUgZWxlbWVudCAob3IgdGV4dCBub2RlKSB0aGlzIGJpbmRpbmcgaXMgYm91bmQgdG9cbiAqICAqIG5vZGU6IEFsaWFzIG9mIGVsZW1lbnQsIHNpbmNlIGJpbmRpbmdzIG1heSBhcHBseSB0byB0ZXh0IG5vZGVzIHRoaXMgaXMgbW9yZSBhY2N1cmF0ZVxuICogICogbmFtZTogVGhlIGF0dHJpYnV0ZSBvciBlbGVtZW50IG5hbWUgKGRvZXMgbm90IGFwcGx5IHRvIG1hdGNoZWQgdGV4dCBub2RlcylcbiAqICAqIG1hdGNoOiBUaGUgbWF0Y2hlZCBwYXJ0IG9mIHRoZSBuYW1lIGZvciB3aWxkY2FyZCBhdHRyaWJ1dGVzIChlLmcuIGBvbi0qYCBtYXRjaGluZyBhZ2FpbnN0IGBvbi1jbGlja2Agd291bGQgaGF2ZSBhXG4gKiAgICBtYXRjaCBwcm9wZXJ0eSBlcXVhbGxpbmcgYGNsaWNrYCkuIFVzZSBgdGhpcy5jYW1lbENhc2VgIHRvIGdldCB0aGUgbWF0Y2ggcHJvZXJ0eSBjYW1lbENhc2VkLlxuICogICogZXhwcmVzc2lvbjogVGhlIGV4cHJlc3Npb24gdGhpcyBiaW5kaW5nIHdpbGwgdXNlIGZvciBpdHMgdXBkYXRlcyAoZG9lcyBub3QgYXBwbHkgdG8gbWF0Y2hlZCBlbGVtZW50cylcbiAqICAqIGNvbnRleHQ6IFRoZSBjb250ZXh0IHRoZSBleHJlc3Npb24gb3BlcmF0ZXMgd2l0aGluIHdoZW4gYm91bmRcbiAqL1xuZnVuY3Rpb24gQmluZGluZyhwcm9wZXJ0aWVzKSB7XG4gIGlmICghcHJvcGVydGllcy5ub2RlIHx8ICFwcm9wZXJ0aWVzLnZpZXcpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBIGJpbmRpbmcgbXVzdCByZWNlaXZlIGEgbm9kZSBhbmQgYSB2aWV3Jyk7XG4gIH1cblxuICAvLyBlbGVtZW50IGFuZCBub2RlIGFyZSBhbGlhc2VzXG4gIHRoaXMuX2VsZW1lbnRQYXRoID0gaW5pdE5vZGVQYXRoKHByb3BlcnRpZXMubm9kZSwgcHJvcGVydGllcy52aWV3KTtcbiAgdGhpcy5ub2RlID0gcHJvcGVydGllcy5ub2RlO1xuICB0aGlzLmVsZW1lbnQgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHRoaXMubmFtZSA9IHByb3BlcnRpZXMubmFtZTtcbiAgdGhpcy5tYXRjaCA9IHByb3BlcnRpZXMubWF0Y2g7XG4gIHRoaXMuZXhwcmVzc2lvbiA9IHByb3BlcnRpZXMuZXhwcmVzc2lvbjtcbiAgdGhpcy5mcmFnbWVudHMgPSBwcm9wZXJ0aWVzLmZyYWdtZW50cztcbiAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbn1cblxuZXh0ZW5kKEJpbmRpbmcsIHtcbiAgLyoqXG4gICAqIERlZmF1bHQgcHJpb3JpdHkgYmluZGVycyBtYXkgb3ZlcnJpZGUuXG4gICAqL1xuICBwcmlvcml0eTogMCxcblxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGEgY2xvbmVkIGJpbmRpbmcuIFRoaXMgaGFwcGVucyBhZnRlciBhIGNvbXBpbGVkIGJpbmRpbmcgb24gYSB0ZW1wbGF0ZSBpcyBjbG9uZWQgZm9yIGEgdmlldy5cbiAgICovXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmV4cHJlc3Npb24pIHtcbiAgICAgIC8vIEFuIG9ic2VydmVyIHRvIG9ic2VydmUgdmFsdWUgY2hhbmdlcyB0byB0aGUgZXhwcmVzc2lvbiB3aXRoaW4gYSBjb250ZXh0XG4gICAgICB0aGlzLm9ic2VydmVyID0gbmV3IHRoaXMuT2JzZXJ2ZXIodGhpcy5leHByZXNzaW9uLCB0aGlzLnVwZGF0ZWQsIHRoaXMpO1xuICAgIH1cbiAgICB0aGlzLmNyZWF0ZWQoKTtcbiAgfSxcblxuICAvKipcbiAgICogQ2xvbmUgdGhpcyBiaW5kaW5nIGZvciBhIHZpZXcuIFRoZSBlbGVtZW50L25vZGUgd2lsbCBiZSB1cGRhdGVkIGFuZCB0aGUgYmluZGluZyB3aWxsIGJlIGluaXRlZC5cbiAgICovXG4gIGNsb25lRm9yVmlldzogZnVuY3Rpb24odmlldykge1xuICAgIGlmICghdmlldykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQSBiaW5kaW5nIG11c3QgY2xvbmUgYWdhaW5zdCBhIHZpZXcnKTtcbiAgICB9XG5cbiAgICB2YXIgbm9kZSA9IHZpZXc7XG4gICAgdGhpcy5fZWxlbWVudFBhdGguZm9yRWFjaChmdW5jdGlvbihpbmRleCkge1xuICAgICAgbm9kZSA9IG5vZGUuY2hpbGROb2Rlc1tpbmRleF07XG4gICAgfSk7XG5cbiAgICB2YXIgYmluZGluZyA9IE9iamVjdC5jcmVhdGUodGhpcyk7XG4gICAgYmluZGluZy5jbG9uZWRGcm9tID0gdGhpcztcbiAgICBiaW5kaW5nLmVsZW1lbnQgPSBub2RlO1xuICAgIGJpbmRpbmcubm9kZSA9IG5vZGU7XG4gICAgYmluZGluZy5pbml0KCk7XG4gICAgcmV0dXJuIGJpbmRpbmc7XG4gIH0sXG5cblxuICAvLyBCaW5kIHRoaXMgdG8gdGhlIGdpdmVuIGNvbnRleHQgb2JqZWN0XG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICBpZiAodGhpcy5jb250ZXh0ID09IGNvbnRleHQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmNvbnRleHQgPSBjb250ZXh0O1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB0aGlzLm9ic2VydmVyLmNvbnRleHQgPSBjb250ZXh0O1xuICAgIHRoaXMuYm91bmQoKTtcblxuICAgIGlmICh0aGlzLm9ic2VydmVyKSB7XG4gICAgICBpZiAodGhpcy51cGRhdGVkICE9PSBCaW5kaW5nLnByb3RvdHlwZS51cGRhdGVkKSB7XG4gICAgICAgIHRoaXMub2JzZXJ2ZXIuZm9yY2VVcGRhdGVOZXh0U3luYyA9IHRydWU7XG4gICAgICAgIHRoaXMub2JzZXJ2ZXIuYmluZChjb250ZXh0KTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cblxuICAvLyBVbmJpbmQgdGhpcyBmcm9tIGl0cyBjb250ZXh0XG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICh0aGlzLm9ic2VydmVyKSB0aGlzLm9ic2VydmVyLnVuYmluZCgpO1xuICAgIHRoaXMudW5ib3VuZCgpO1xuICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gIH0sXG5cblxuICAvLyBDbGVhbnMgdXAgYmluZGluZyBjb21wbGV0ZWx5XG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudW5iaW5kKCk7XG4gICAgaWYgKHRoaXMub2JzZXJ2ZXIpIHtcbiAgICAgIC8vIFRoaXMgd2lsbCBjbGVhciBpdCBvdXQsIG51bGxpZnlpbmcgYW55IGRhdGEgc3RvcmVkXG4gICAgICB0aGlzLm9ic2VydmVyLnN5bmMoKTtcbiAgICB9XG4gICAgdGhpcy5kaXNwb3NlZCgpO1xuICB9LFxuXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjb21waWxlZCB3aXRoaW4gYSB0ZW1wbGF0ZVxuICBjb21waWxlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcncyBlbGVtZW50IGlzIGNyZWF0ZWRcbiAgY3JlYXRlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGV4cHJlc3Npb24ncyB2YWx1ZSBjaGFuZ2VzXG4gIHVwZGF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nIGlzIGJvdW5kXG4gIGJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyB1bmJvdW5kXG4gIHVuYm91bmQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nIGlzIGRpc3Bvc2VkXG4gIGRpc3Bvc2VkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIEhlbHBlciBtZXRob2RzXG5cbiAgZ2V0IGNhbWVsQ2FzZSgpIHtcbiAgICByZXR1cm4gKHRoaXMubWF0Y2ggfHwgdGhpcy5uYW1lIHx8ICcnKS5yZXBsYWNlKC8tKyhcXHcpL2csIGZ1bmN0aW9uKF8sIGNoYXIpIHtcbiAgICAgIHJldHVybiBjaGFyLnRvVXBwZXJDYXNlKCk7XG4gICAgfSk7XG4gIH0sXG5cbiAgb2JzZXJ2ZTogZnVuY3Rpb24oZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICAgIHJldHVybiBuZXcgdGhpcy5PYnNlcnZlcihleHByZXNzaW9uLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0IHx8IHRoaXMpO1xuICB9XG59KTtcblxuXG5cblxudmFyIGluZGV4T2YgPSBBcnJheS5wcm90b3R5cGUuaW5kZXhPZjtcblxuLy8gQ3JlYXRlcyBhbiBhcnJheSBvZiBpbmRleGVzIHRvIGhlbHAgZmluZCB0aGUgc2FtZSBlbGVtZW50IHdpdGhpbiBhIGNsb25lZCB2aWV3XG5mdW5jdGlvbiBpbml0Tm9kZVBhdGgobm9kZSwgdmlldykge1xuICB2YXIgcGF0aCA9IFtdO1xuICB3aGlsZSAobm9kZSAhPT0gdmlldykge1xuICAgIHZhciBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgcGF0aC51bnNoaWZ0KGluZGV4T2YuY2FsbChwYXJlbnQuY2hpbGROb2Rlcywgbm9kZSkpO1xuICAgIG5vZGUgPSBwYXJlbnQ7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59XG4iLCJ2YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5tb2R1bGUuZXhwb3J0cyA9IGNvbXBpbGU7XG5cblxuLy8gV2Fsa3MgdGhlIHRlbXBsYXRlIERPTSByZXBsYWNpbmcgYW55IGJpbmRpbmdzIGFuZCBjYWNoaW5nIGJpbmRpbmdzIG9udG8gdGhlIHRlbXBsYXRlIG9iamVjdC5cbmZ1bmN0aW9uIGNvbXBpbGUoZnJhZ21lbnRzLCB0ZW1wbGF0ZSkge1xuICB2YXIgd2Fsa2VyID0gZG9jdW1lbnQuY3JlYXRlVHJlZVdhbGtlcih0ZW1wbGF0ZSwgTm9kZUZpbHRlci5TSE9XX0VMRU1FTlQgfCBOb2RlRmlsdGVyLlNIT1dfVEVYVCk7XG4gIHZhciBiaW5kaW5ncyA9IFtdLCBjdXJyZW50Tm9kZSwgcGFyZW50Tm9kZSwgcHJldmlvdXNOb2RlO1xuXG4gIC8vIFJlc2V0IGZpcnN0IG5vZGUgdG8gZW5zdXJlIGl0IGlzbid0IGEgZnJhZ21lbnRcbiAgd2Fsa2VyLm5leHROb2RlKCk7XG4gIHdhbGtlci5wcmV2aW91c05vZGUoKTtcblxuICAvLyBmaW5kIGJpbmRpbmdzIGZvciBlYWNoIG5vZGVcbiAgZG8ge1xuICAgIGN1cnJlbnROb2RlID0gd2Fsa2VyLmN1cnJlbnROb2RlO1xuICAgIHBhcmVudE5vZGUgPSBjdXJyZW50Tm9kZS5wYXJlbnROb2RlO1xuICAgIGJpbmRpbmdzLnB1c2guYXBwbHkoYmluZGluZ3MsIGdldEJpbmRpbmdzRm9yTm9kZShmcmFnbWVudHMsIGN1cnJlbnROb2RlLCB0ZW1wbGF0ZSkpO1xuXG4gICAgaWYgKGN1cnJlbnROb2RlLnBhcmVudE5vZGUgIT09IHBhcmVudE5vZGUpIHtcbiAgICAgIC8vIGN1cnJlbnROb2RlIHdhcyByZW1vdmVkIGFuZCBtYWRlIGEgdGVtcGxhdGVcbiAgICAgIHdhbGtlci5jdXJyZW50Tm9kZSA9IHByZXZpb3VzTm9kZSB8fCB3YWxrZXIucm9vdDtcbiAgICB9IGVsc2Uge1xuICAgICAgcHJldmlvdXNOb2RlID0gY3VycmVudE5vZGU7XG4gICAgfVxuICB9IHdoaWxlICh3YWxrZXIubmV4dE5vZGUoKSk7XG5cbiAgcmV0dXJuIGJpbmRpbmdzO1xufVxuXG5cblxuLy8gRmluZCBhbGwgdGhlIGJpbmRpbmdzIG9uIGEgZ2l2ZW4gbm9kZSAodGV4dCBub2RlcyB3aWxsIG9ubHkgZXZlciBoYXZlIG9uZSBiaW5kaW5nKS5cbmZ1bmN0aW9uIGdldEJpbmRpbmdzRm9yTm9kZShmcmFnbWVudHMsIG5vZGUsIHZpZXcpIHtcbiAgdmFyIGJpbmRpbmdzID0gW107XG4gIHZhciBCaW5kZXIsIGJpbmRpbmcsIGV4cHIsIGJvdW5kLCBtYXRjaCwgYXR0ciwgaTtcblxuICBpZiAobm9kZS5ub2RlVHlwZSA9PT0gTm9kZS5URVhUX05PREUpIHtcbiAgICBzcGxpdFRleHROb2RlKGZyYWdtZW50cywgbm9kZSk7XG5cbiAgICAvLyBGaW5kIGFueSBiaW5kaW5nIGZvciB0aGUgdGV4dCBub2RlXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpKSB7XG4gICAgICBleHByID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ3RleHQnLCBub2RlLm5vZGVWYWx1ZSk7XG4gICAgICBub2RlLm5vZGVWYWx1ZSA9ICcnO1xuICAgICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ3RleHQnLCBleHByKTtcbiAgICAgIGJpbmRpbmcgPSBuZXcgQmluZGVyKHsgbm9kZTogbm9kZSwgdmlldzogdmlldywgZXhwcmVzc2lvbjogZXhwciwgZnJhZ21lbnRzOiBmcmFnbWVudHMgfSk7XG4gICAgICBpZiAoYmluZGluZy5jb21waWxlZCgpICE9PSBmYWxzZSkge1xuICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgfVxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBJZiB0aGUgZWxlbWVudCBpcyByZW1vdmVkIGZyb20gdGhlIERPTSwgc3RvcC4gQ2hlY2sgYnkgbG9va2luZyBhdCBpdHMgcGFyZW50Tm9kZVxuICAgIHZhciBwYXJlbnQgPSBub2RlLnBhcmVudE5vZGU7XG4gICAgdmFyIERlZmF1bHRCaW5kZXIgPSBmcmFnbWVudHMuZ2V0QXR0cmlidXRlQmluZGVyKCdfX2RlZmF1bHRfXycpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIGVsZW1lbnRcbiAgICBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignZWxlbWVudCcsIG5vZGUudGFnTmFtZS50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAoQmluZGVyKSB7XG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pO1xuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBJZiByZW1vdmVkLCBtYWRlIGEgdGVtcGxhdGUsIGRvbid0IGNvbnRpbnVlIHByb2Nlc3NpbmdcbiAgICBpZiAobm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnQpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBGaW5kIGFuZCBhZGQgYW55IGF0dHJpYnV0ZSBiaW5kaW5ncyBvbiBhbiBlbGVtZW50LiBUaGVzZSBjYW4gYmUgYXR0cmlidXRlcyB3aG9zZSBuYW1lIG1hdGNoZXMgYSBiaW5kaW5nLCBvclxuICAgIC8vIHRoZXkgY2FuIGJlIGF0dHJpYnV0ZXMgd2hpY2ggaGF2ZSBhIGJpbmRpbmcgaW4gdGhlIHZhbHVlIHN1Y2ggYXMgYGhyZWY9XCIvcG9zdC97eyBwb3N0LmlkIH19XCJgLlxuICAgIHZhciBib3VuZCA9IFtdO1xuICAgIHZhciBhdHRyaWJ1dGVzID0gc2xpY2UuY2FsbChub2RlLmF0dHJpYnV0ZXMpO1xuICAgIGZvciAoaSA9IDAsIGwgPSBhdHRyaWJ1dGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIGF0dHIgPSBhdHRyaWJ1dGVzW2ldO1xuICAgICAgdmFyIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCdhdHRyaWJ1dGUnLCBhdHRyLm5hbWUsIGF0dHIudmFsdWUpO1xuICAgICAgaWYgKEJpbmRlcikge1xuICAgICAgICBib3VuZC5wdXNoKFsgQmluZGVyLCBhdHRyIF0pO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIE1ha2Ugc3VyZSB0byBjcmVhdGUgYW5kIHByb2Nlc3MgdGhlbSBpbiB0aGUgY29ycmVjdCBwcmlvcml0eSBvcmRlciBzbyBpZiBhIGJpbmRpbmcgY3JlYXRlIGEgdGVtcGxhdGUgZnJvbSB0aGVcbiAgICAvLyBub2RlIGl0IGRvZXNuJ3QgcHJvY2VzcyB0aGUgb3RoZXJzLlxuICAgIGJvdW5kLnNvcnQoc29ydEF0dHJpYnV0ZXMpO1xuXG4gICAgZm9yIChpID0gMDsgaSA8IGJvdW5kLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgQmluZGVyID0gYm91bmRbaV1bMF07XG4gICAgICB2YXIgYXR0ciA9IGJvdW5kW2ldWzFdO1xuICAgICAgaWYgKCFub2RlLmhhc0F0dHJpYnV0ZShhdHRyLm5hbWUpKSB7XG4gICAgICAgIC8vIElmIHRoaXMgd2FzIHJlbW92ZWQgYWxyZWFkeSBieSBhbm90aGVyIGJpbmRpbmcsIGRvbid0IHByb2Nlc3MuXG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgdmFyIG5hbWUgPSBhdHRyLm5hbWU7XG4gICAgICB2YXIgdmFsdWUgPSBhdHRyLnZhbHVlO1xuICAgICAgaWYgKEJpbmRlci5leHByKSB7XG4gICAgICAgIG1hdGNoID0gbmFtZS5tYXRjaChCaW5kZXIuZXhwcik7XG4gICAgICAgIGlmIChtYXRjaCkgbWF0Y2ggPSBtYXRjaFsxXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1hdGNoID0gbnVsbDtcbiAgICAgIH1cblxuICAgICAgdHJ5IHtcbiAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUoYXR0ci5uYW1lKTtcbiAgICAgIH0gY2F0Y2goZSkge31cblxuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoe1xuICAgICAgICBub2RlOiBub2RlLFxuICAgICAgICB2aWV3OiB2aWV3LFxuICAgICAgICBuYW1lOiBuYW1lLFxuICAgICAgICBtYXRjaDogbWF0Y2gsXG4gICAgICAgIGV4cHJlc3Npb246IHZhbHVlID8gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIHZhbHVlKSA6IG51bGwsXG4gICAgICAgIGZyYWdtZW50czogZnJhZ21lbnRzXG4gICAgICB9KTtcblxuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH0gZWxzZSBpZiAoQmluZGVyICE9PSBEZWZhdWx0QmluZGVyICYmIGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCB2YWx1ZSkpIHtcbiAgICAgICAgLy8gUmV2ZXJ0IHRvIGRlZmF1bHQgaWYgdGhpcyBiaW5kaW5nIGRvZXNuJ3QgdGFrZVxuICAgICAgICBib3VuZC5wdXNoKFsgRGVmYXVsdEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cblxuICAgICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG4vLyBTcGxpdHMgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW0gc28gdGhleSBjYW4gYmUgYm91bmQgaW5kaXZpZHVhbGx5LCBoYXMgcGFyZW50Tm9kZSBwYXNzZWQgaW4gc2luY2UgaXQgbWF5XG4vLyBiZSBhIGRvY3VtZW50IGZyYWdtZW50IHdoaWNoIGFwcGVhcnMgYXMgbnVsbCBvbiBub2RlLnBhcmVudE5vZGUuXG5mdW5jdGlvbiBzcGxpdFRleHROb2RlKGZyYWdtZW50cywgbm9kZSkge1xuICBpZiAoIW5vZGUucHJvY2Vzc2VkKSB7XG4gICAgbm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgIHZhciByZWdleCA9IGZyYWdtZW50cy5iaW5kZXJzLnRleHQuX2V4cHI7XG4gICAgdmFyIGNvbnRlbnQgPSBub2RlLm5vZGVWYWx1ZTtcbiAgICBpZiAoY29udGVudC5tYXRjaChyZWdleCkpIHtcbiAgICAgIHZhciBtYXRjaCwgbGFzdEluZGV4ID0gMCwgcGFydHMgPSBbXSwgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICB3aGlsZSAobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSB7XG4gICAgICAgIHBhcnRzLnB1c2goY29udGVudC5zbGljZShsYXN0SW5kZXgsIHJlZ2V4Lmxhc3RJbmRleCAtIG1hdGNoWzBdLmxlbmd0aCkpO1xuICAgICAgICBwYXJ0cy5wdXNoKG1hdGNoWzBdKTtcbiAgICAgICAgbGFzdEluZGV4ID0gcmVnZXgubGFzdEluZGV4O1xuICAgICAgfVxuICAgICAgcGFydHMucHVzaChjb250ZW50LnNsaWNlKGxhc3RJbmRleCkpO1xuICAgICAgcGFydHMgPSBwYXJ0cy5maWx0ZXIobm90RW1wdHkpO1xuXG4gICAgICBub2RlLm5vZGVWYWx1ZSA9IHBhcnRzWzBdO1xuICAgICAgZm9yICh2YXIgaSA9IDE7IGkgPCBwYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgbmV3VGV4dE5vZGUgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShwYXJ0c1tpXSk7XG4gICAgICAgIG5ld1RleHROb2RlLnByb2Nlc3NlZCA9IHRydWU7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5ld1RleHROb2RlKTtcbiAgICAgIH1cbiAgICAgIG5vZGUucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5vZGUubmV4dFNpYmxpbmcpO1xuICAgIH1cbiAgfVxufVxuXG5cbmZ1bmN0aW9uIHNvcnRBdHRyaWJ1dGVzKGEsIGIpIHtcbiAgcmV0dXJuIGJbMF0ucHJvdG90eXBlLnByaW9yaXR5IC0gYVswXS5wcm90b3R5cGUucHJpb3JpdHk7XG59XG5cbmZ1bmN0aW9uIG5vdEVtcHR5KHZhbHVlKSB7XG4gIHJldHVybiBCb29sZWFuKHZhbHVlKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gRnJhZ21lbnRzO1xucmVxdWlyZSgnLi91dGlsL3BvbHlmaWxscycpO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcbnZhciB0b0ZyYWdtZW50ID0gcmVxdWlyZSgnLi91dGlsL3RvRnJhZ21lbnQnKTtcbnZhciBhbmltYXRpb24gPSByZXF1aXJlKCcuL3V0aWwvYW5pbWF0aW9uJyk7XG52YXIgVGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIEJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKTtcbnZhciBBbmltYXRlZEJpbmRpbmcgPSByZXF1aXJlKCcuL2FuaW1hdGVkQmluZGluZycpO1xudmFyIGNvbXBpbGUgPSByZXF1aXJlKCcuL2NvbXBpbGUnKTtcbnZhciByZWdpc3RlckRlZmF1bHRCaW5kZXJzID0gcmVxdWlyZSgnLi9yZWdpc3RlcmVkL2JpbmRlcnMnKTtcbnZhciByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzID0gcmVxdWlyZSgnLi9yZWdpc3RlcmVkL2Zvcm1hdHRlcnMnKTtcbnZhciByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zID0gcmVxdWlyZSgnLi9yZWdpc3RlcmVkL2FuaW1hdGlvbnMnKTtcblxuLyoqXG4gKiBBIEZyYWdtZW50cyBvYmplY3Qgc2VydmVzIGFzIGEgcmVnaXN0cnkgZm9yIGJpbmRlcnMgYW5kIGZvcm1hdHRlcnNcbiAqIEBwYXJhbSB7W3R5cGVdfSBPYnNlcnZlckNsYXNzIFtkZXNjcmlwdGlvbl1cbiAqL1xuZnVuY3Rpb24gRnJhZ21lbnRzKE9ic2VydmVyQ2xhc3MpIHtcbiAgaWYgKCFPYnNlcnZlckNsYXNzKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignTXVzdCBwcm92aWRlIGFuIE9ic2VydmVyIGNsYXNzIHRvIEZyYWdtZW50cy4nKTtcbiAgfVxuXG4gIHRoaXMuT2JzZXJ2ZXIgPSBPYnNlcnZlckNsYXNzO1xuICB0aGlzLmdsb2JhbHMgPSBPYnNlcnZlckNsYXNzLmdsb2JhbHMgPSB7fTtcbiAgdGhpcy5mb3JtYXR0ZXJzID0gT2JzZXJ2ZXJDbGFzcy5mb3JtYXR0ZXJzID0ge307XG4gIHRoaXMuYW5pbWF0aW9ucyA9IHt9O1xuICB0aGlzLmFuaW1hdGVBdHRyaWJ1dGUgPSAnYW5pbWF0ZSc7XG5cbiAgdGhpcy5iaW5kZXJzID0ge1xuICAgIGVsZW1lbnQ6IHsgX3dpbGRjYXJkczogW10gfSxcbiAgICBhdHRyaWJ1dGU6IHsgX3dpbGRjYXJkczogW10sIF9leHByOiAve3tcXHMqKC4qPylcXHMqfX0vZyB9LFxuICAgIHRleHQ6IHsgX3dpbGRjYXJkczogW10sIF9leHByOiAve3tcXHMqKC4qPylcXHMqfX0vZyB9XG4gIH07XG5cbiAgLy8gVGV4dCBiaW5kZXIgZm9yIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtXG4gIHRoaXMucmVnaXN0ZXJUZXh0KCdfX2RlZmF1bHRfXycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gKHZhbHVlICE9IG51bGwpID8gdmFsdWUgOiAnJztcbiAgfSk7XG5cbiAgLy8gQ2F0Y2hhbGwgYXR0cmlidXRlIGJpbmRlciBmb3IgcmVndWxhciBhdHRyaWJ1dGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyQXR0cmlidXRlKCdfX2RlZmF1bHRfXycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUodGhpcy5uYW1lLCB2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5uYW1lKTtcbiAgICB9XG4gIH0pO1xuXG4gIHJlZ2lzdGVyRGVmYXVsdEJpbmRlcnModGhpcyk7XG4gIHJlZ2lzdGVyRGVmYXVsdEZvcm1hdHRlcnModGhpcyk7XG4gIHJlZ2lzdGVyRGVmYXVsdEFuaW1hdGlvbnModGhpcyk7XG59XG5cbkZyYWdtZW50cy5wcm90b3R5cGUgPSB7XG5cbiAgLyoqXG4gICAqIFRha2VzIGFuIEhUTUwgc3RyaW5nLCBhbiBlbGVtZW50LCBhbiBhcnJheSBvZiBlbGVtZW50cywgb3IgYSBkb2N1bWVudCBmcmFnbWVudCwgYW5kIGNvbXBpbGVzIGl0IGludG8gYSB0ZW1wbGF0ZS5cbiAgICogSW5zdGFuY2VzIG1heSB0aGVuIGJlIGNyZWF0ZWQgYW5kIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICogQHBhcmFtIHtTdHJpbmd8Tm9kZUxpc3R8SFRNTENvbGxlY3Rpb258SFRNTFRlbXBsYXRlRWxlbWVudHxIVE1MU2NyaXB0RWxlbWVudHxOb2RlfSBodG1sIEEgVGVtcGxhdGUgY2FuIGJlIGNyZWF0ZWRcbiAgICogZnJvbSBtYW55IGRpZmZlcmVudCB0eXBlcyBvZiBvYmplY3RzLiBBbnkgb2YgdGhlc2Ugd2lsbCBiZSBjb252ZXJ0ZWQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50IGZvciB0aGUgdGVtcGxhdGUgdG9cbiAgICogY2xvbmUuIE5vZGVzIGFuZCBlbGVtZW50cyBwYXNzZWQgaW4gd2lsbCBiZSByZW1vdmVkIGZyb20gdGhlIERPTS5cbiAgICovXG4gIGNyZWF0ZVRlbXBsYXRlOiBmdW5jdGlvbihodG1sKSB7XG4gICAgdmFyIGZyYWdtZW50ID0gdG9GcmFnbWVudChodG1sKTtcbiAgICBpZiAoZnJhZ21lbnQuY2hpbGROb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gJyArIGh0bWwpO1xuICAgIH1cbiAgICB2YXIgdGVtcGxhdGUgPSBleHRlbmQubWFrZShUZW1wbGF0ZSwgZnJhZ21lbnQpO1xuICAgIHRlbXBsYXRlLmJpbmRpbmdzID0gY29tcGlsZSh0aGlzLCB0ZW1wbGF0ZSk7XG4gICAgcmV0dXJuIHRlbXBsYXRlO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbXBpbGVzIGJpbmRpbmdzIG9uIGFuIGVsZW1lbnQuXG4gICAqL1xuICBjb21waWxlRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCkge1xuICAgIGlmICghZWxlbWVudC5iaW5kaW5ncykge1xuICAgICAgZWxlbWVudC5iaW5kaW5ncyA9IGNvbXBpbGUodGhpcywgZWxlbWVudCk7XG4gICAgICBleHRlbmQubWFrZShWaWV3LCBlbGVtZW50LCBlbGVtZW50KTtcbiAgICB9XG5cbiAgICByZXR1cm4gZWxlbWVudDtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb21waWxlcyBhbmQgYmluZHMgYW4gZWxlbWVudCB3aGljaCB3YXMgbm90IGNyZWF0ZWQgZnJvbSBhIHRlbXBsYXRlLiBNb3N0bHkgb25seSB1c2VkIGZvciBiaW5kaW5nIHRoZSBkb2N1bWVudCdzXG4gICAqIGh0bWwgZWxlbWVudC5cbiAgICovXG4gIGJpbmRFbGVtZW50OiBmdW5jdGlvbihlbGVtZW50LCBjb250ZXh0KSB7XG4gICAgdGhpcy5jb21waWxlRWxlbWVudChlbGVtZW50KTtcblxuICAgIGlmIChjb250ZXh0KSB7XG4gICAgICBlbGVtZW50LmJpbmQoY29udGV4dCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgYmluZGVyIGZvciBhIGdpdmVuIHR5cGUgYW5kIG5hbWUuIEEgYmluZGVyIGlzIGEgc3ViY2xhc3Mgb2YgQmluZGluZyBhbmQgaXMgdXNlZCB0byBjcmVhdGUgYmluZGluZ3Mgb25cbiAgICogYW4gZWxlbWVudCBvciB0ZXh0IG5vZGUgd2hvc2UgdGFnIG5hbWUsIGF0dHJpYnV0ZSBuYW1lLCBvciBleHByZXNzaW9uIGNvbnRlbnRzIG1hdGNoIHRoaXMgYmluZGVyJ3MgbmFtZS9leHByZXNzaW9uLlxuICAgKlxuICAgKiAjIyMgUGFyYW1ldGVyc1xuICAgKlxuICAgKiAgKiBgdHlwZWA6IHRoZXJlIGFyZSB0aHJlZSB0eXBlcyBvZiBiaW5kZXJzOiBlbGVtZW50LCBhdHRyaWJ1dGUsIG9yIHRleHQuIFRoZXNlIGNvcnJlc3BvbmQgdG8gbWF0Y2hpbmcgYWdhaW5zdCBhblxuICAgKiAgICBlbGVtZW50J3MgdGFnIG5hbWUsIGFuIGVsZW1lbnQgd2l0aCB0aGUgZ2l2ZW4gYXR0cmlidXRlIG5hbWUsIG9yIGEgdGV4dCBub2RlIHRoYXQgbWF0Y2hlcyB0aGUgcHJvdmlkZWRcbiAgICogICAgZXhwcmVzc2lvbi5cbiAgICpcbiAgICogICogYG5hbWVgOiB0byBtYXRjaCwgYSBiaW5kZXIgbmVlZHMgdGhlIG5hbWUgb2YgYW4gZWxlbWVudCBvciBhdHRyaWJ1dGUsIG9yIGEgcmVndWxhciBleHByZXNzaW9uIHRoYXQgbWF0Y2hlcyBhXG4gICAqICAgIGdpdmVuIHRleHQgbm9kZS4gTmFtZXMgZm9yIGVsZW1lbnRzIGFuZCBhdHRyaWJ1dGVzIGNhbiBiZSByZWd1bGFyIGV4cHJlc3Npb25zIGFzIHdlbGwsIG9yIHRoZXkgbWF5IGJlIHdpbGRjYXJkXG4gICAqICAgIG5hbWVzIGJ5IHVzaW5nIGFuIGFzdGVyaXNrLlxuICAgKlxuICAgKiAgKiBgZGVmaW5pdGlvbmA6IGEgYmluZGVyIGlzIGEgc3ViY2xhc3Mgb2YgQmluZGluZyB3aGljaCBvdmVycmlkZXMga2V5IG1ldGhvZHMsIGBjb21waWxlZGAsIGBjcmVhdGVkYCwgYHVwZGF0ZWRgLFxuICAgKiAgICBgYm91bmRgLCBhbmQgYHVuYm91bmRgLiBUaGUgZGVmaW5pdGlvbiBtYXkgYmUgYW4gYWN0dWFsIHN1YmNsYXNzIG9mIEJpbmRpbmcgb3IgaXQgbWF5IGJlIGFuIG9iamVjdCB3aGljaCB3aWxsIGJlXG4gICAqICAgIHVzZWQgZm9yIHRoZSBwcm90b3R5cGUgb2YgdGhlIG5ld2x5IGNyZWF0ZWQgc3ViY2xhc3MuIEZvciBtYW55IGJpbmRpbmdzIG9ubHkgdGhlIGB1cGRhdGVkYCBtZXRob2QgaXMgb3ZlcnJpZGRlbixcbiAgICogICAgc28gYnkganVzdCBwYXNzaW5nIGluIGEgZnVuY3Rpb24gZm9yIGBkZWZpbml0aW9uYCB0aGUgYmluZGVyIHdpbGwgYmUgY3JlYXRlZCB3aXRoIHRoYXQgYXMgaXRzIGB1cGRhdGVkYCBtZXRob2QuXG4gICAqXG4gICAqICMjIyBFeHBsYWluYXRpb24gb2YgcHJvcGVydGllcyBhbmQgbWV0aG9kc1xuICAgKlxuICAgKiAgICogYHByaW9yaXR5YCBtYXkgYmUgZGVmaW5lZCBhcyBudW1iZXIgdG8gaW5zdHJ1Y3Qgc29tZSBiaW5kZXJzIHRvIGJlIHByb2Nlc3NlZCBiZWZvcmUgb3RoZXJzLiBCaW5kZXJzIHdpdGhcbiAgICogICBoaWdoZXIgcHJpb3JpdHkgYXJlIHByb2Nlc3NlZCBmaXJzdC5cbiAgICpcbiAgICogICAqIGBhbmltYXRlZGAgY2FuIGJlIHNldCB0byBgdHJ1ZWAgdG8gZXh0ZW5kIHRoZSBBbmltYXRlZEJpbmRpbmcgY2xhc3Mgd2hpY2ggcHJvdmlkZXMgc3VwcG9ydCBmb3IgYW5pbWF0aW9uIHdoZW5cbiAgICogICBpbnNlcnRpbmdhbmQgcmVtb3Zpbmcgbm9kZXMgZnJvbSB0aGUgRE9NLiBUaGUgYGFuaW1hdGVkYCBwcm9wZXJ0eSBvbmx5ICphbGxvd3MqIGFuaW1hdGlvbiBidXQgdGhlIGVsZW1lbnQgbXVzdFxuICAgKiAgIGhhdmUgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgdG8gdXNlIGFuaW1hdGlvbi4gQSBiaW5kaW5nIHdpbGwgaGF2ZSB0aGUgYGFuaW1hdGVgIHByb3BlcnR5IHNldCB0byB0cnVlIHdoZW4gaXQgaXNcbiAgICogICB0byBiZSBhbmltYXRlZC4gQmluZGVycyBzaG91bGQgaGF2ZSBmYXN0IHBhdGhzIGZvciB3aGVuIGFuaW1hdGlvbiBpcyBub3QgdXNlZCByYXRoZXIgdGhhbiBhc3N1bWluZyBhbmltYXRpb24gd2lsbFxuICAgKiAgIGJlIHVzZWQuXG4gICAqXG4gICAqIEJpbmRlcnNcbiAgICpcbiAgICogQSBiaW5kZXIgY2FuIGhhdmUgNSBtZXRob2RzIHdoaWNoIHdpbGwgYmUgY2FsbGVkIGF0IHZhcmlvdXMgcG9pbnRzIGluIGEgYmluZGluZydzIGxpZmVjeWNsZS4gTWFueSBiaW5kZXJzIHdpbGxcbiAgICogb25seSB1c2UgdGhlIGB1cGRhdGVkKHZhbHVlKWAgbWV0aG9kLCBzbyBjYWxsaW5nIHJlZ2lzdGVyIHdpdGggYSBmdW5jdGlvbiBpbnN0ZWFkIG9mIGFuIG9iamVjdCBhcyBpdHMgdGhpcmRcbiAgICogcGFyYW1ldGVyIGlzIGEgc2hvcnRjdXQgdG8gY3JlYXRpbmcgYSBiaW5kZXIgd2l0aCBqdXN0IGFuIGB1cGRhdGVgIG1ldGhvZC5cbiAgICpcbiAgICogTGlzdGVkIGluIG9yZGVyIG9mIHdoZW4gdGhleSBvY2N1ciBpbiBhIGJpbmRpbmcncyBsaWZlY3ljbGU6XG4gICAqXG4gICAqICAgKiBgY29tcGlsZWQob3B0aW9ucylgIGlzIGNhbGxlZCB3aGVuIGZpcnN0IGNyZWF0aW5nIGEgYmluZGluZyBkdXJpbmcgdGhlIHRlbXBsYXRlIGNvbXBpbGF0aW9uIHByb2Nlc3MgYW5kIHJlY2VpdmVzXG4gICAqIHRoZSBgb3B0aW9uc2Agb2JqZWN0IHRoYXQgd2lsbCBiZSBwYXNzZWQgaW50byBgbmV3IEJpbmRpbmcob3B0aW9ucylgLiBUaGlzIGNhbiBiZSB1c2VkIGZvciBjcmVhdGluZyB0ZW1wbGF0ZXMsXG4gICAqIG1vZGlmeWluZyB0aGUgRE9NIChvbmx5IHN1YnNlcXVlbnQgRE9NIHRoYXQgaGFzbid0IGFscmVhZHkgYmVlbiBwcm9jZXNzZWQpIGFuZCBvdGhlciB0aGluZ3MgdGhhdCBzaG91bGQgYmVcbiAgICogYXBwbGllZCBhdCBjb21waWxlIHRpbWUgYW5kIG5vdCBkdXBsaWNhdGVkIGZvciBlYWNoIHZpZXcgY3JlYXRlZC5cbiAgICpcbiAgICogICAqIGBjcmVhdGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIGEgbmV3IHZpZXcgaXMgY3JlYXRlZC4gVGhpcyBjYW4gYmUgdXNlZCB0byBhZGQgZXZlbnQgbGlzdGVuZXJzIG9uIHRoZVxuICAgKiBlbGVtZW50IG9yIGRvIG90aGVyIHRoaW5ncyB0aGF0IHdpbGwgcGVyc2lzdGUgd2l0aCB0aGUgdmlldyB0aHJvdWdoIGl0cyBtYW55IHVzZXMuIFZpZXdzIG1heSBnZXQgcmV1c2VkIHNvIGRvbid0XG4gICAqIGRvIGFueXRoaW5nIGhlcmUgdG8gdGllIGl0IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICpcbiAgICogICAqIGBhdHRhY2hlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiB0aGUgdmlldyBpcyBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQgYW5kIGluc2VydGVkIGludG8gdGhlIERPTS4gVGhpc1xuICAgKiBjYW4gYmUgdXNlZCB0byBoYW5kbGUgY29udGV4dC1zcGVjaWZpYyBhY3Rpb25zLCBhZGQgbGlzdGVuZXJzIHRvIHRoZSB3aW5kb3cgb3IgZG9jdW1lbnQgKHRvIGJlIHJlbW92ZWQgaW5cbiAgICogYGRldGFjaGVkYCEpLCBldGMuXG4gICAqXG4gICAqICAgKiBgdXBkYXRlZCh2YWx1ZSwgb2xkVmFsdWUsIGNoYW5nZVJlY29yZHMpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbmV2ZXIgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHdpdGhpblxuICAgKiB0aGUgYXR0cmlidXRlIGNoYW5nZXMuIEZvciBleGFtcGxlLCBgYmluZC10ZXh0PVwie3t1c2VybmFtZX19XCJgIHdpbGwgdHJpZ2dlciBgdXBkYXRlZGAgd2l0aCB0aGUgdmFsdWUgb2YgdXNlcm5hbWVcbiAgICogd2hlbmV2ZXIgaXQgY2hhbmdlcyBvbiB0aGUgZ2l2ZW4gY29udGV4dC4gV2hlbiB0aGUgdmlldyBpcyByZW1vdmVkIGB1cGRhdGVkYCB3aWxsIGJlIHRyaWdnZXJlZCB3aXRoIGEgdmFsdWUgb2ZcbiAgICogYHVuZGVmaW5lZGAgaWYgdGhlIHZhbHVlIHdhcyBub3QgYWxyZWFkeSBgdW5kZWZpbmVkYCwgZ2l2aW5nIGEgY2hhbmNlIHRvIFwicmVzZXRcIiB0byBhbiBlbXB0eSBzdGF0ZS5cbiAgICpcbiAgICogICAqIGBkZXRhY2hlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiB0aGUgdmlldyBpcyB1bmJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dCBhbmQgcmVtb3ZlZCBmcm9tIHRoZSBET00uIFRoaXNcbiAgICogY2FuIGJlIHVzZWQgdG8gY2xlYW4gdXAgYW55dGhpbmcgZG9uZSBpbiBgYXR0YWNoZWQoKWAgb3IgaW4gYHVwZGF0ZWQoKWAgYmVmb3JlIGJlaW5nIHJlbW92ZWQuXG4gICAqXG4gICAqIEVsZW1lbnQgYW5kIGF0dHJpYnV0ZSBiaW5kZXJzIHdpbGwgYXBwbHkgd2hlbmV2ZXIgdGhlIHRhZyBuYW1lIG9yIGF0dHJpYnV0ZSBuYW1lIGlzIG1hdGNoZWQuIEluIHRoZSBjYXNlIG9mXG4gICAqIGF0dHJpYnV0ZSBiaW5kZXJzIGlmIHlvdSBvbmx5IHdhbnQgaXQgdG8gbWF0Y2ggd2hlbiBleHByZXNzaW9ucyBhcmUgdXNlZCB3aXRoaW4gdGhlIGF0dHJpYnV0ZSwgYWRkIGBvbmx5V2hlbkJvdW5kYFxuICAgKiB0byB0aGUgZGVmaW5pdGlvbi4gT3RoZXJ3aXNlIHRoZSBiaW5kZXIgd2lsbCBtYXRjaCBhbmQgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uIHdpbGwgc2ltcGx5IGJlIGEgc3RyaW5nIHRoYXRcbiAgICogb25seSBjYWxscyB1cGRhdGVkIG9uY2Ugc2luY2UgaXQgd2lsbCBub3QgY2hhbmdlLlxuICAgKlxuICAgKiBOb3RlLCBhdHRyaWJ1dGVzIHdoaWNoIG1hdGNoIGEgYmluZGVyIGFyZSByZW1vdmVkIGR1cmluZyBjb21waWxlLiBUaGV5IGFyZSBjb25zaWRlcmVkIHRvIGJlIGJpbmRpbmcgZGVmaW5pdGlvbnMgYW5kXG4gICAqIG5vdCBwYXJ0IG9mIHRoZSBlbGVtZW50LiBCaW5kaW5ncyBtYXkgc2V0IHRoZSBhdHRyaWJ1dGUgd2hpY2ggc2VydmVkIGFzIHRoZWlyIGRlZmluaXRpb24gaWYgZGVzaXJlZC5cbiAgICpcbiAgICogIyMjIERlZmF1bHRzXG4gICAqXG4gICAqIFRoZXJlIGFyZSBkZWZhdWx0IGJpbmRlcnMgZm9yIGF0dHJpYnV0ZSBhbmQgdGV4dCBub2RlcyB3aGljaCBhcHBseSB3aGVuIG5vIG90aGVyIGJpbmRlcnMgbWF0Y2guIFRoZXkgb25seSBhcHBseSB0b1xuICAgKiBhdHRyaWJ1dGVzIGFuZCB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSAoZS5nLiBge3tmb299fWApLiBUaGUgZGVmYXVsdCBpcyB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvciB0ZXh0XG4gICAqIG5vZGUncyB2YWx1ZSB0byB0aGUgcmVzdWx0IG9mIHRoZSBleHByZXNzaW9uLiBJZiB5b3Ugd2FudGVkIHRvIG92ZXJyaWRlIHRoaXMgZGVmYXVsdCB5b3UgbWF5IHJlZ2lzdGVyIGEgYmluZGVyIHdpdGhcbiAgICogdGhlIG5hbWUgYFwiX19kZWZhdWx0X19cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKiBUaGlzIGJpbmRpbmcgaGFuZGxlciBhZGRzIHBpcmF0ZWl6ZWQgdGV4dCB0byBhbiBlbGVtZW50LlxuICAgKiBgYGBqYXZhc2NyaXB0XG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyQXR0cmlidXRlKCdteS1waXJhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSB7XG4gICAqICAgICB2YWx1ZSA9ICcnO1xuICAgKiAgIH0gZWxzZSB7XG4gICAqICAgICB2YWx1ZSA9IHZhbHVlXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXEJpbmdcXGIvZywgXCJpbidcIilcbiAgICogICAgICAgLnJlcGxhY2UoL1xcYnRvXFxiL2csIFwidCdcIilcbiAgICogICAgICAgLnJlcGxhY2UoL1xcYnlvdVxcYi8sICd5ZScpXG4gICAqICAgICAgICsgJyBBcnJyciEnO1xuICAgKiAgIH1cbiAgICogICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSB2YWx1ZTtcbiAgICogfSk7XG4gICAqIGBgYFxuICAgKlxuICAgKiBgYGBodG1sXG4gICAqIDxwIG15LXBpcmF0ZT1cInt7cG9zdC5ib2R5fX1cIj5UaGlzIHRleHQgd2lsbCBiZSByZXBsYWNlZC48L3A+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyVGV4dDogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCd0ZXh0JywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgdmFyIGJpbmRlciwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXVxuICAgIHZhciBzdXBlckNsYXNzID0gZGVmaW5pdGlvbi5hbmltYXRlZCA/IEFuaW1hdGVkQmluZGluZyA6IEJpbmRpbmc7XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmluaXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkZWZpbml0aW9uLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgc3VwZXJDbGFzcyA9IGRlZmluaXRpb247XG4gICAgICAgIGRlZmluaXRpb24gPSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlZmluaXRpb24gPSB7IHVwZGF0ZWQ6IGRlZmluaXRpb24gfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobmFtZSA9PT0gJ19fZGVmYXVsdF9fJyAmJiAhZGVmaW5pdGlvbi5oYXNPd25Qcm9wZXJ0eSgncHJpb3JpdHknKSkge1xuICAgICAgZGVmaW5pdGlvbi5wcmlvcml0eSA9IC0xMDA7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgc3ViY2xhc3Mgb2YgQmluZGluZyAob3IgYW5vdGhlciBiaW5kZXIpIHdpdGggdGhlIGRlZmluaXRpb25cbiAgICBmdW5jdGlvbiBCaW5kZXIoKSB7XG4gICAgICBzdXBlckNsYXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICAgIGRlZmluaXRpb24uT2JzZXJ2ZXIgPSB0aGlzLk9ic2VydmVyO1xuICAgIHN1cGVyQ2xhc3MuZXh0ZW5kKEJpbmRlciwgZGVmaW5pdGlvbik7XG5cbiAgICB2YXIgZXhwcjtcbiAgICBpZiAobmFtZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgZXhwciA9IG5hbWU7XG4gICAgfSBlbHNlIGlmIChuYW1lLmluZGV4T2YoJyonKSA+PSAwKSB7XG4gICAgICBleHByID0gbmV3IFJlZ0V4cCgnXicgKyBlc2NhcGVSZWdFeHAobmFtZSkucmVwbGFjZSgnXFxcXConLCAnKC4qKScpICsgJyQnKTtcbiAgICB9XG5cbiAgICBpZiAoZXhwcikge1xuICAgICAgQmluZGVyLmV4cHIgPSBleHByO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnB1c2goQmluZGVyKTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb3J0KHRoaXMuYmluZGluZ1NvcnQpO1xuICAgIH1cblxuICAgIEJpbmRlci5uYW1lID0gJycgKyBuYW1lO1xuICAgIGJpbmRlcnNbbmFtZV0gPSBCaW5kZXI7XG4gICAgcmV0dXJuIEJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgLiBJZiBhbiBSZWdFeHAgd2FzIHVzZWQgaW4gcmVnaXN0ZXIgZm9yIHRoZSBuYW1lIGl0IG11c3QgYmUgdXNlZFxuICAgKiB0byB1bnJlZ2lzdGVyLCBidXQgaXQgZG9lcyBub3QgbmVlZCB0byBiZSB0aGUgc2FtZSBpbnN0YW5jZS5cbiAgICovXG4gIHVucmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuICAgIGlmICghYmluZGVyKSByZXR1cm47XG4gICAgaWYgKGJpbmRlci5leHByKSB7XG4gICAgICB2YXIgaW5kZXggPSBiaW5kZXJzLl93aWxkY2FyZHMuaW5kZXhPZihiaW5kZXIpO1xuICAgICAgaWYgKGluZGV4ID49IDApIGJpbmRlcnMuX3dpbGRjYXJkcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgICBkZWxldGUgYmluZGVyc1tuYW1lXTtcbiAgICByZXR1cm4gYmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBiaW5kZXIgdGhhdCB3YXMgYWRkZWQgd2l0aCBgcmVnaXN0ZXIoKWAgYnkgdHlwZSBhbmQgbmFtZS5cbiAgICovXG4gIGdldEVsZW1lbnRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QXR0cmlidXRlQmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0VGV4dEJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICBnZXRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUpIHtcbiAgICB2YXIgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcblxuICAgIGlmICghYmluZGVycykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYHR5cGVgIG11c3QgYmUgb25lIG9mICcgKyBPYmplY3Qua2V5cyh0aGlzLmJpbmRlcnMpLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmIChuYW1lICYmIGJpbmRlcnMuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgIHJldHVybiBiaW5kZXJzW25hbWVdO1xuICAgIH1cbiAgfSxcblxuXG4gIC8qKlxuICAgKiBGaW5kIGEgbWF0Y2hpbmcgYmluZGVyIGZvciB0aGUgZ2l2ZW4gdHlwZS4gRWxlbWVudHMgc2hvdWxkIG9ubHkgcHJvdmlkZSBuYW1lLiBBdHRyaWJ1dGVzIHNob3VsZCBwcm92aWRlIHRoZSBuYW1lXG4gICAqIGFuZCB2YWx1ZSAodmFsdWUgc28gdGhlIGRlZmF1bHQgY2FuIGJlIHJldHVybmVkIGlmIGFuIGV4cHJlc3Npb24gZXhpc3RzIGluIHRoZSB2YWx1ZSkuIFRleHQgbm9kZXMgc2hvdWxkIG9ubHlcbiAgICogcHJvdmlkZSB0aGUgdmFsdWUgKGluIHBsYWNlIG9mIHRoZSBuYW1lKSBhbmQgd2lsbCByZXR1cm4gdGhlIGRlZmF1bHQgaWYgbm8gYmluZGVycyBtYXRjaC5cbiAgICovXG4gIGZpbmRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKHR5cGUgPT09ICd0ZXh0JyAmJiB2YWx1ZSA9PSBudWxsKSB7XG4gICAgICB2YWx1ZSA9IG5hbWU7XG4gICAgICBuYW1lID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB2YXIgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgbmFtZSksIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcikge1xuICAgICAgdmFyIHRvTWF0Y2ggPSAodHlwZSA9PT0gJ3RleHQnKSA/IHZhbHVlIDogbmFtZTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb21lKGZ1bmN0aW9uKHdpbGRjYXJkQmluZGVyKSB7XG4gICAgICAgIGlmICh0b01hdGNoLm1hdGNoKHdpbGRjYXJkQmluZGVyLmV4cHIpKSB7XG4gICAgICAgICAgYmluZGVyID0gd2lsZGNhcmRCaW5kZXI7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChiaW5kZXIgJiYgdHlwZSA9PT0gJ2F0dHJpYnV0ZScgJiYgYmluZGVyLnByb3RvdHlwZS5vbmx5V2hlbkJvdW5kICYmICF0aGlzLmlzQm91bmQodHlwZSwgdmFsdWUpKSB7XG4gICAgICAvLyBkb24ndCB1c2UgdGhlIGB2YWx1ZWAgYmluZGVyIGlmIHRoZXJlIGlzIG5vIGV4cHJlc3Npb24gaW4gdGhlIGF0dHJpYnV0ZSB2YWx1ZSAoZS5nLiBgdmFsdWU9XCJzb21lIHRleHRcImApXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgPT09IHRoaXMuYW5pbWF0ZUF0dHJpYnV0ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghYmluZGVyICYmIHZhbHVlICYmICh0eXBlID09PSAndGV4dCcgfHwgdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkpIHtcbiAgICAgIC8vIFRlc3QgaWYgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyBib3VuZCAoZS5nLiBgaHJlZj1cIi9wb3N0cy97eyBwb3N0LmlkIH19XCJgKVxuICAgICAgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgJ19fZGVmYXVsdF9fJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBIEZvcm1hdHRlciBpcyBzdG9yZWQgdG8gcHJvY2VzcyB0aGUgdmFsdWUgb2YgYW4gZXhwcmVzc2lvbi4gVGhpcyBhbHRlcnMgdGhlIHZhbHVlIG9mIHdoYXQgY29tZXMgaW4gd2l0aCBhIGZ1bmN0aW9uXG4gICAqIHRoYXQgcmV0dXJucyBhIG5ldyB2YWx1ZS4gRm9ybWF0dGVycyBhcmUgYWRkZWQgYnkgdXNpbmcgYSBzaW5nbGUgcGlwZSBjaGFyYWN0ZXIgKGB8YCkgZm9sbG93ZWQgYnkgdGhlIG5hbWUgb2YgdGhlXG4gICAqIGZvcm1hdHRlci4gTXVsdGlwbGUgZm9ybWF0dGVycyBjYW4gYmUgdXNlZCBieSBjaGFpbmluZyBwaXBlcyB3aXRoIGZvcm1hdHRlciBuYW1lcy4gRm9ybWF0dGVycyBtYXkgYWxzbyBoYXZlXG4gICAqIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlbSBieSB1c2luZyB0aGUgY29sb24gdG8gc2VwYXJhdGUgYXJndW1lbnRzIGZyb20gdGhlIGZvcm1hdHRlciBuYW1lLiBUaGUgc2lnbmF0dXJlIG9mIGFcbiAgICogZm9ybWF0dGVyIHNob3VsZCBiZSBgZnVuY3Rpb24odmFsdWUsIGFyZ3MuLi4pYCB3aGVyZSBhcmdzIGFyZSBleHRyYSBwYXJhbWV0ZXJzIHBhc3NlZCBpbnRvIHRoZSBmb3JtYXR0ZXIgYWZ0ZXJcbiAgICogY29sb25zLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCd1cHBlcmNhc2UnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZS50b1VwcGVyY2FzZSgpXG4gICAqIH0pXG4gICAqXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdyZXBsYWNlJywgZnVuY3Rpb24odmFsdWUsIHJlcGxhY2UsIHdpdGgpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUucmVwbGFjZShyZXBsYWNlLCB3aXRoKVxuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxoMSBiaW5kLXRleHQ9XCJ0aXRsZSB8IHVwcGVyY2FzZSB8IHJlcGxhY2U6J0xFVFRFUic6J05VTUJFUidcIj48L2gxPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkdFVFRJTkcgVE8gS05PVyBBTEwgQUJPVVQgVEhFIE5VTUJFUiBBPC9oMT5cbiAgICogYGBgXG4gICAqIFRPRE86IG9sZCBkb2NzLCByZXdyaXRlLCB0aGVyZSBpcyBhbiBleHRyYSBhcmd1bWVudCBuYW1lZCBgc2V0dGVyYCB3aGljaCB3aWxsIGJlIHRydWUgd2hlbiB0aGUgZXhwcmVzc2lvbiBpcyBiZWluZyBcInNldFwiIGluc3RlYWQgb2YgXCJnZXRcIlxuICAgKiBBIGB2YWx1ZUZvcm1hdHRlcmAgaXMgbGlrZSBhIGZvcm1hdHRlciBidXQgdXNlZCBzcGVjaWZpY2FsbHkgd2l0aCB0aGUgYHZhbHVlYCBiaW5kaW5nIHNpbmNlIGl0IGlzIGEgdHdvLXdheSBiaW5kaW5nLiBXaGVuXG4gICAqIHRoZSB2YWx1ZSBvZiB0aGUgZWxlbWVudCBpcyBjaGFuZ2VkIGEgYHZhbHVlRm9ybWF0dGVyYCBjYW4gYWRqdXN0IHRoZSB2YWx1ZSBmcm9tIGEgc3RyaW5nIHRvIHRoZSBjb3JyZWN0IHZhbHVlIHR5cGUgZm9yXG4gICAqIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24uIFRoZSBzaWduYXR1cmUgZm9yIGEgYHZhbHVlRm9ybWF0dGVyYCBpbmNsdWRlcyB0aGUgY3VycmVudCB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvblxuICAgKiBiZWZvcmUgdGhlIG9wdGlvbmFsIGFyZ3VtZW50cyAoaWYgYW55KS4gVGhpcyBhbGxvd3MgZGF0ZXMgdG8gYmUgYWRqdXN0ZWQgYW5kIHBvc3NpYmxleSBvdGhlciB1c2VzLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdudW1lcmljJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAodmFsdWUgPT0gbnVsbCB8fCBpc05hTih2YWx1ZSkpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignZGF0ZS1ob3VyJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAoICEoY3VycmVudFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgKSByZXR1cm4gJydcbiAgICogICB2YXIgaG91cnMgPSB2YWx1ZS5nZXRIb3VycygpXG4gICAqICAgaWYgKGhvdXJzID49IDEyKSBob3VycyAtPSAxMlxuICAgKiAgIGlmIChob3VycyA9PSAwKSBob3VycyA9IDEyXG4gICAqICAgcmV0dXJuIGhvdXJzXG4gICAqIH0pXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPk51bWJlciBBdHRlbmRpbmc6PC9sYWJlbD5cbiAgICogPGlucHV0IHNpemU9XCI0XCIgYmluZC12YWx1ZT1cImV2ZW50LmF0dGVuZGVlQ291bnQgfCBudW1lcmljXCI+XG4gICAqIDxsYWJlbD5UaW1lOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1ob3VyXCI+IDpcbiAgICogPGlucHV0IHNpemU9XCIyXCIgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLW1pbnV0ZVwiPlxuICAgKiA8c2VsZWN0IGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1hbXBtXCI+XG4gICAqICAgPG9wdGlvbj5BTTwvb3B0aW9uPlxuICAgKiAgIDxvcHRpb24+UE08L29wdGlvbj5cbiAgICogPC9zZWxlY3Q+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lLCBmb3JtYXR0ZXIpIHtcbiAgICB0aGlzLmZvcm1hdHRlcnNbbmFtZV0gPSBmb3JtYXR0ZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBmb3JtYXR0ZXIuXG4gICAqL1xuICB1bnJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSwgZm9ybWF0dGVyKSB7XG4gICAgZGVsZXRlIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBmb3JtYXR0ZXIuXG4gICAqL1xuICBnZXRGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBbiBBbmltYXRpb24gaXMgc3RvcmVkIHRvIGhhbmRsZSBhbmltYXRpb25zLiBBIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGlzIGFuIG9iamVjdCAob3IgY2xhc3Mgd2hpY2ggaW5zdGFudGlhdGVzIGludG9cbiAgICogYW4gb2JqZWN0KSB3aXRoIHRoZSBtZXRob2RzOlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWBcbiAgICogICAqIGBkaWRBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgd2lsbEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZU91dChlbGVtZW50KWBcbiAgICpcbiAgICogQW5pbWF0aW9uIGlzIGluY2x1ZGVkIHdpdGggYmluZGVycyB3aGljaCBhcmUgcmVnaXN0ZXJlZCB3aXRoIHRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IHNldCB0byBgdHJ1ZWAgKHN1Y2ggYXMgYGlmYFxuICAgKiBhbmQgYHJlcGVhdGApLiBBbmltYXRpb25zIGFsbG93IGVsZW1lbnRzIHRvIGZhZGUgaW4sIGZhZGUgb3V0LCBzbGlkZSBkb3duLCBjb2xsYXBzZSwgbW92ZSBmcm9tIG9uZSBsb2NhdGlvbiBpbiBhXG4gICAqIGxpc3QgdG8gYW5vdGhlciwgYW5kIG1vcmUuXG4gICAqXG4gICAqIFRvIHVzZSBhbmltYXRpb24gYWRkIGFuIGF0dHJpYnV0ZSBuYW1lZCBgYW5pbWF0ZWAgb250byBhbiBlbGVtZW50IHdpdGggYSBzdXBwb3J0ZWQgYmluZGVyLlxuICAgKlxuICAgKiAjIyMgQ1NTIEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgZG9lcyBub3QgaGF2ZSBhIHZhbHVlIG9yIHRoZSB2YWx1ZSBpcyBhIGNsYXNzIG5hbWUgKGUuZy4gYGFuaW1hdGU9XCIubXktZmFkZVwiYCkgdGhlblxuICAgKiBmcmFnbWVudHMgd2lsbCB1c2UgYSBDU1MgdHJhbnNpdGlvbi9hbmltYXRpb24uIENsYXNzZXMgd2lsbCBiZSBhZGRlZCBhbmQgcmVtb3ZlZCB0byB0cmlnZ2VyIHRoZSBhbmltYXRpb24uXG4gICAqXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgYWRkZWQgcmlnaHQgYWZ0ZXIgYW4gZWxlbWVudCBpcyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXMgY2FuIGJlIHVzZWQgdG8gc2V0IHRoZVxuICAgKiAgICAgb3BhY2l0eSB0byBgMC4wYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1pbmAgaXMgd2hlbiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgcmVtb3ZlZC4gSXQgY2FuIGJlIHVzZWQgdG8gc2V0IG9wYWNpdHkgdG8gYDEuMGAgZm9yIGV4YW1wbGUuIFRoZVxuICAgKiAgICAgYGFuaW1hdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBvbiB0aGlzIGNsYXNzIGlmIHVzaW5nIGl0LiBUaGUgYHRyYW5zaXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgaGVyZS4gTm90ZSB0aGF0XG4gICAqICAgICBhbHRob3VnaCB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBwbGFjZWQgb24gYW4gZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvXG4gICAqICAgICBpdHMgY2hpbGRyZW4gYXMgdGhleSBnZXQgYWRkZWQgYW5kIHJlbW92ZWQuXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGUgb3BhY2l0eSB0b1xuICAgKiAgICAgYDFgIGZvciBleGFtcGxlLiBJdCBpcyB0aGVuIHJlbW92ZWQgb24gdGhlIG5leHQgYW5pbWF0aW9uIGZyYW1lLlxuICAgKiAgICogYC5hbmltYXRlLW91dGAgaXMgYWRkZWQgd2hlbiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAwLjBgIGZvclxuICAgKiAgICAgZXhhbXBsZS4gVGhlIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUgb3JcbiAgICogICAgIG9uIGFub3RoZXIgc2VsZWN0b3IgdGhhdCBtYXRjaGVzIHRoZSBlbGVtZW50LiBOb3RlIHRoYXQgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuXG4gICAqICAgICBlbGVtZW50IHdpdGggdGhlIGByZXBlYXRgIGJpbmRlciwgdGhlc2UgY2xhc3NlcyBhcmUgYWRkZWQgdG8gaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKlxuICAgKiBJZiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBzZXQgdG8gYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW4gdGhhdCBjbGFzcyBuYW1lIHdpbGwgYmUgYWRkZWQgYXNcbiAgICogYSBjbGFzcyB0byB0aGUgZWxlbWVudCBkdXJpbmcgYW5pbWF0aW9uLiBUaGlzIGFsbG93cyB5b3UgdG8gdXNlIGAubXktZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLm15LWZhZGUuYW5pbWF0ZS1pbmAsXG4gICAqIGV0Yy4gaW4geW91ciBzdHlsZXNoZWV0cyB0byB1c2UgdGhlIHNhbWUgYW5pbWF0aW9uIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi5cbiAgICpcbiAgICogIyMjIEphdmFTY3JpcHQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBJZiB5b3UgbmVlZCBncmVhdGVyIGNvbnRyb2wgb3ZlciB5b3VyIGFuaW1hdGlvbnMgSmF2YVNjcmlwdCBtYXkgYmUgdXNlZC4gSXQgaXMgcmVjb21tZW5kZWQgdGhhdCBDU1Mgc3R5bGVzIHN0aWxsIGJlXG4gICAqIHVzZWQgYnkgaGF2aW5nIHlvdXIgY29kZSBzZXQgdGhlbSBtYW51YWxseS4gVGhpcyBhbGxvd3MgdGhlIGFuaW1hdGlvbiB0byB0YWtlIGFkdmFudGFnZSBvZiB0aGUgYnJvd3NlclxuICAgKiBvcHRpbWl6YXRpb25zIHN1Y2ggYXMgaGFyZHdhcmUgYWNjZWxlcmF0aW9uLiBUaGlzIGlzIG5vdCBhIHJlcXVpcmVtZW50LlxuICAgKlxuICAgKiBJbiBvcmRlciB0byB1c2UgSmF2YVNjcmlwdCBhbiBvYmplY3Qgc2hvdWxkIGJlIHBhc3NlZCBpbnRvIHRoZSBgYW5pbWF0aW9uYCBhdHRyaWJ1dGUgdXNpbmcgYW4gZXhwcmVzc2lvbi4gVGhpc1xuICAgKiBvYmplY3Qgc2hvdWxkIGhhdmUgbWV0aG9kcyB0aGF0IGFsbG93IEphdmFTY3JpcHQgYW5pbWF0aW9uIGhhbmRsaW5nLiBGb3IgZXhhbXBsZSwgaWYgeW91IGFyZSBib3VuZCB0byBhIGNvbnRleHRcbiAgICogd2l0aCBhbiBvYmplY3QgbmFtZWQgYGN1c3RvbUZhZGVgIHdpdGggYW5pbWF0aW9uIG1ldGhvZHMsIHlvdXIgZWxlbWVudCBzaG91bGQgaGF2ZSBgYXR0cmlidXRlPVwie3tjdXN0b21GYWRlfX1cImAuXG4gICAqIFRoZSBmb2xsb3dpbmcgaXMgYSBsaXN0IG9mIHRoZSBtZXRob2RzIHlvdSBtYXkgaW1wbGVtZW50LlxuICAgKlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGFuIGVsZW1lbnQgaGFzIGJlZW4gaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBVc2UgaXQgdG8gc2V0IGluaXRpYWxcbiAgICogICAgIENTUyBwcm9wZXJ0aWVzIGJlZm9yZSBgYW5pbWF0ZUluYCBpcyBjYWxsZWQgdG8gc2V0IHRoZSBmaW5hbCBwcm9wZXJ0aWVzLiBUaGlzIG1ldGhvZCBpcyBvcHRpb25hbC5cbiAgICogICAqIGBhbmltYXRlSW4oZWxlbWVudCwgY2FsbGJhY2spYCB3aWxsIGJlIGNhbGxlZCBzaG9ydGx5IGFmdGVyIGB3aWxsQW5pbWF0ZUluYCBpZiBpdCB3YXMgZGVmaW5lZC4gVXNlIGl0IHRvIHNldFxuICAgKiAgICAgZmluYWwgQ1NTIHByb3BlcnRpZXMuXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBkb25lKWAgd2lsbCBiZSBjYWxsZWQgYmVmb3JlIGFuIGVsZW1lbnQgaXMgdG8gYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uIGBkb25lYCBtdXN0IGJlXG4gICAqICAgICBjYWxsZWQgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlIGluIG9yZGVyIGZvciB0aGUgYmluZGVyIHRvIGZpbmlzaCByZW1vdmluZyB0aGUgZWxlbWVudC4gKipSZW1lbWJlcioqIHRvXG4gICAqICAgICBjbGVhbiB1cCBieSByZW1vdmluZyBhbnkgc3R5bGVzIHRoYXQgd2VyZSBhZGRlZCBiZWZvcmUgY2FsbGluZyBgZG9uZSgpYCBzbyB0aGUgZWxlbWVudCBjYW4gYmUgcmV1c2VkIHdpdGhvdXRcbiAgICogICAgIHNpZGUtZWZmZWN0cy5cbiAgICpcbiAgICogVGhlIGBlbGVtZW50YCBwYXNzZWQgaW4gd2lsbCBiZSBwb2x5ZmlsbGVkIGZvciB3aXRoIHRoZSBgYW5pbWF0ZWAgbWV0aG9kIHVzaW5nXG4gICAqIGh0dHBzOi8vZ2l0aHViLmNvbS93ZWItYW5pbWF0aW9ucy93ZWItYW5pbWF0aW9ucy1qcy5cbiAgICpcbiAgICogIyMjIFJlZ2lzdGVyZWQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBBbmltYXRpb25zIG1heSBiZSByZWdpc3RlcmVkIGFuZCB1c2VkIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi4gVG8gdXNlIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gdXNlIGl0cyBuYW1lIGluXG4gICAqIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIChlLmcuIGBhbmltYXRlPVwiZmFkZVwiYCkuIE5vdGUgdGhlIG9ubHkgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gYW5kIGFcbiAgICogY2xhc3MgcmVnaXN0cmF0aW9uIGlzIGNsYXNzIHJlZ2lzdHJhdGlvbnMgYXJlIHByZWZpeGVkIHdpdGggYSBkb3QgKGAuYCkuIFJlZ2lzdGVyZWQgYW5pbWF0aW9ucyBhcmUgYWx3YXlzXG4gICAqIEphdmFTY3JpcHQgYW5pbWF0aW9ucy4gVG8gcmVnaXN0ZXIgYW4gYW5pbWF0aW9uIHVzZSBgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdClgLlxuICAgKlxuICAgKiBUaGUgQW5pbWF0aW9uIG1vZHVsZSBjb21lcyB3aXRoIHNldmVyYWwgY29tbW9uIGFuaW1hdGlvbnMgcmVnaXN0ZXJlZCBieSBkZWZhdWx0LiBUaGUgZGVmYXVsdHMgdXNlIENTUyBzdHlsZXMgdG9cbiAgICogd29yayBjb3JyZWN0bHksIHVzaW5nIGBlbGVtZW50LmFuaW1hdGVgLlxuICAgKlxuICAgKiAgICogYGZhZGVgIHdpbGwgZmFkZSBhbiBlbGVtZW50IGluIGFuZCBvdXQgb3ZlciAzMDAgbWlsbGlzZWNvbmRzLlxuICAgKiAgICogYHNsaWRlYCB3aWxsIHNsaWRlIGFuIGVsZW1lbnQgZG93biB3aGVuIGl0IGlzIGFkZGVkIGFuZCBzbGlkZSBpdCB1cCB3aGVuIGl0IGlzIHJlbW92ZWQuXG4gICAqICAgKiBgc2xpZGUtbW92ZWAgd2lsbCBtb3ZlIGFuIGVsZW1lbnQgZnJvbSBpdHMgb2xkIGxvY2F0aW9uIHRvIGl0cyBuZXcgbG9jYXRpb24gaW4gYSByZXBlYXRlZCBsaXN0LlxuICAgKlxuICAgKiBEbyB5b3UgaGF2ZSBhbm90aGVyIGNvbW1vbiBhbmltYXRpb24geW91IHRoaW5rIHNob3VsZCBiZSBpbmNsdWRlZCBieSBkZWZhdWx0PyBTdWJtaXQgYSBwdWxsIHJlcXVlc3QhXG4gICAqL1xuICByZWdpc3RlckFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSwgYW5pbWF0aW9uT2JqZWN0KSB7XG4gICAgdGhpcy5hbmltYXRpb25zW25hbWVdID0gYW5pbWF0aW9uT2JqZWN0O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFuIGFuaW1hdGlvbi5cbiAgICovXG4gIHVucmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEdldHMgYSByZWdpc3RlcmVkIGFuaW1hdGlvbi5cbiAgICovXG4gIGdldEFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFuaW1hdGlvbnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogUHJlcGFyZSBhbiBlbGVtZW50IHRvIGJlIGVhc2llciBhbmltYXRhYmxlIChhZGRpbmcgYSBzaW1wbGUgYGFuaW1hdGVgIHBvbHlmaWxsIGlmIG5lZWRlZClcbiAgICovXG4gIG1ha2VFbGVtZW50QW5pbWF0YWJsZTogYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZSxcblxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkZWxpbWl0ZXJzIHRoYXQgZGVmaW5lIGFuIGV4cHJlc3Npb24uIERlZmF1bHQgaXMgYHt7YCBhbmQgYH19YCBidXQgdGhpcyBtYXkgYmUgb3ZlcnJpZGRlbi4gSWYgZW1wdHlcbiAgICogc3RyaW5ncyBhcmUgcGFzc2VkIGluIChmb3IgdHlwZSBcImF0dHJpYnV0ZVwiIG9ubHkpIHRoZW4gbm8gZGVsaW1pdGVycyBhcmUgcmVxdWlyZWQgZm9yIG1hdGNoaW5nIGF0dHJpYnV0ZXMsIGJ1dCB0aGVcbiAgICogZGVmYXVsdCBhdHRyaWJ1dGUgbWF0Y2hlciB3aWxsIG5vdCBhcHBseSB0byB0aGUgcmVzdCBvZiB0aGUgYXR0cmlidXRlcy5cbiAgICovXG4gIHNldEV4cHJlc3Npb25EZWxpbWl0ZXJzOiBmdW5jdGlvbih0eXBlLCBwcmUsIHBvc3QpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdFeHByZXNzaW9uIGRlbGltaXRlcnMgbXVzdCBiZSBvZiB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG5cbiAgICB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHIgPSBuZXcgUmVnRXhwKGVzY2FwZVJlZ0V4cChwcmUpICsgJyguKj8pJyArIGVzY2FwZVJlZ0V4cChwb3N0KSwgJ2cnKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUZXN0cyB3aGV0aGVyIGEgdmFsdWUgaGFzIGFuIGV4cHJlc3Npb24gaW4gaXQuIFNvbWV0aGluZyBsaWtlIGAvdXNlci97e3VzZXIuaWR9fWAuXG4gICAqL1xuICBpc0JvdW5kOiBmdW5jdGlvbih0eXBlLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lzQm91bmQgbXVzdCBwcm92aWRlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICByZXR1cm4gQm9vbGVhbihleHByICYmIHZhbHVlICYmIHZhbHVlLm1hdGNoKGV4cHIpKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUaGUgc29ydCBmdW5jdGlvbiB0byBzb3J0IGJpbmRlcnMgY29ycmVjdGx5XG4gICAqL1xuICBiaW5kaW5nU29ydDogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBiLnByb3RvdHlwZS5wcmlvcml0eSAtIGEucHJvdG90eXBlLnByaW9yaXR5O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGFuIGludmVydGVkIGV4cHJlc3Npb24gZnJvbSBgL3VzZXIve3t1c2VyLmlkfX1gIHRvIGBcIi91c2VyL1wiICsgdXNlci5pZGBcbiAgICovXG4gIGNvZGlmeUV4cHJlc3Npb246IGZ1bmN0aW9uKHR5cGUsIHRleHQpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb2RpZnlFeHByZXNzaW9uIG11c3QgdXNlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cblxuICAgIHZhciBleHByID0gdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByO1xuICAgIHZhciBtYXRjaCA9IHRleHQubWF0Y2goZXhwcik7XG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICByZXR1cm4gJ1wiJyArIHRleHQucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICB9IGVsc2UgaWYgKG1hdGNoLmxlbmd0aCA9PT0gMSAmJiBtYXRjaFswXSA9PT0gdGV4dCkge1xuICAgICAgcmV0dXJuIHRleHQucmVwbGFjZShleHByLCAnJDEnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIG5ld1RleHQgPSAnXCInLCBsYXN0SW5kZXggPSAwO1xuICAgICAgd2hpbGUgKG1hdGNoID0gZXhwci5leGVjKHRleHQpKSB7XG4gICAgICAgIHZhciBzdHIgPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCwgZXhwci5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpO1xuICAgICAgICBuZXdUZXh0ICs9IHN0ci5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyk7XG4gICAgICAgIG5ld1RleHQgKz0gJ1wiICsgKCcgKyBtYXRjaFsxXSArICcgfHwgXCJcIikgKyBcIic7XG4gICAgICAgIGxhc3RJbmRleCA9IGV4cHIubGFzdEluZGV4O1xuICAgICAgfVxuICAgICAgbmV3VGV4dCArPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCkucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICAgIHJldHVybiBuZXdUZXh0LnJlcGxhY2UoL15cIlwiIFxcKyB8IFwiXCIgXFwrIHwgXFwrIFwiXCIkL2csICcnKTtcbiAgICB9XG4gIH1cblxufTtcblxuLy8gVGFrZXMgYSBzdHJpbmcgbGlrZSBcIihcXCopXCIgb3IgXCJvbi1cXCpcIiBhbmQgY29udmVydHMgaXQgaW50byBhIHJlZ3VsYXIgZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cCh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL1stW1xcXXt9KCkqKz8uLFxcXFxeJHwjXFxzXS9nLCBcIlxcXFwkJlwiKTtcbn1cbiIsIi8qXG5Db3B5cmlnaHQgKGMpIDIwMTUgSmFjb2IgV3JpZ2h0IDxqYWN3cmlnaHRAZ21haWwuY29tPlxuXG5QZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmcgYSBjb3B5XG5vZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZSBcIlNvZnR3YXJlXCIpLCB0byBkZWFsXG5pbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nIHdpdGhvdXQgbGltaXRhdGlvbiB0aGUgcmlnaHRzXG50byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsIGRpc3RyaWJ1dGUsIHN1YmxpY2Vuc2UsIGFuZC9vciBzZWxsXG5jb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG8gcGVybWl0IHBlcnNvbnMgdG8gd2hvbSB0aGUgU29mdHdhcmUgaXNcbmZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0byB0aGUgZm9sbG93aW5nIGNvbmRpdGlvbnM6XG5cblRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlIGluY2x1ZGVkIGluXG5hbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cblxuVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTUyBPUlxuSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRiBNRVJDSEFOVEFCSUxJVFksXG5GSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEVcbkFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVJcbkxJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sXG5PVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOXG5USEUgU09GVFdBUkUuXG4qL1xuLy8gIyBEaWZmXG4vLyA+IEJhc2VkIG9uIHdvcmsgZnJvbSBHb29nbGUncyBvYnNlcnZlLWpzIHBvbHlmaWxsOiBodHRwczovL2dpdGh1Yi5jb20vUG9seW1lci9vYnNlcnZlLWpzXG5cbi8vIEEgbmFtZXNwYWNlIHRvIHN0b3JlIHRoZSBmdW5jdGlvbnMgb25cbnZhciBkaWZmID0gZXhwb3J0cztcblxuKGZ1bmN0aW9uKCkge1xuXG4gIGRpZmYuY2xvbmUgPSBjbG9uZTtcbiAgZGlmZi52YWx1ZXMgPSBkaWZmVmFsdWVzO1xuICBkaWZmLmJhc2ljID0gZGlmZkJhc2ljO1xuICBkaWZmLm9iamVjdHMgPSBkaWZmT2JqZWN0cztcbiAgZGlmZi5hcnJheXMgPSBkaWZmQXJyYXlzO1xuXG5cbiAgLy8gQSBjaGFuZ2UgcmVjb3JkIGZvciB0aGUgb2JqZWN0IGNoYW5nZXNcbiAgZnVuY3Rpb24gQ2hhbmdlUmVjb3JkKG9iamVjdCwgdHlwZSwgbmFtZSwgb2xkVmFsdWUpIHtcbiAgICB0aGlzLm9iamVjdCA9IG9iamVjdDtcbiAgICB0aGlzLnR5cGUgPSB0eXBlO1xuICAgIHRoaXMubmFtZSA9IG5hbWU7XG4gICAgdGhpcy5vbGRWYWx1ZSA9IG9sZFZhbHVlO1xuICB9XG5cbiAgLy8gQSBzcGxpY2UgcmVjb3JkIGZvciB0aGUgYXJyYXkgY2hhbmdlc1xuICBmdW5jdGlvbiBTcGxpY2UoaW5kZXgsIHJlbW92ZWQsIGFkZGVkQ291bnQpIHtcbiAgICB0aGlzLmluZGV4ID0gaW5kZXg7XG4gICAgdGhpcy5yZW1vdmVkID0gcmVtb3ZlZDtcbiAgICB0aGlzLmFkZGVkQ291bnQgPSBhZGRlZENvdW50O1xuICB9XG5cblxuICAvLyBDcmVhdGVzIGEgY2xvbmUgb3IgY29weSBvZiBhbiBhcnJheSBvciBvYmplY3QgKG9yIHNpbXBseSByZXR1cm5zIGEgc3RyaW5nL251bWJlci9ib29sZWFuIHdoaWNoIGFyZSBpbW11dGFibGUpXG4gIC8vIERvZXMgbm90IHByb3ZpZGUgZGVlcCBjb3BpZXMuXG4gIGZ1bmN0aW9uIGNsb25lKHZhbHVlLCBkZWVwKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoZGVlcCkge1xuICAgICAgICByZXR1cm4gdmFsdWUubWFwKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIGNsb25lKHZhbHVlLCBkZWVwKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh2YWx1ZS52YWx1ZU9mKCkgIT09IHZhbHVlKSB7XG4gICAgICAgIHJldHVybiBuZXcgdmFsdWUuY29uc3RydWN0b3IodmFsdWUudmFsdWVPZigpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjb3B5ID0ge307XG4gICAgICAgIGZvciAodmFyIGtleSBpbiB2YWx1ZSkge1xuICAgICAgICAgIHZhciBvYmpWYWx1ZSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgICAgIG9ialZhbHVlID0gY2xvbmUob2JqVmFsdWUsIGRlZXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb3B5W2tleV0gPSBvYmpWYWx1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29weTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIHZhbHVlcywgcmV0dXJuaW5nIGEgdHJ1dGh5IHZhbHVlIGlmIHRoZXJlIGFyZSBjaGFuZ2VzIG9yIGBmYWxzZWAgaWYgdGhlcmUgYXJlIG5vIGNoYW5nZXMuIElmIHRoZSB0d29cbiAgLy8gdmFsdWVzIGFyZSBib3RoIGFycmF5cyBvciBib3RoIG9iamVjdHMsIGFuIGFycmF5IG9mIGNoYW5nZXMgKHNwbGljZXMgb3IgY2hhbmdlIHJlY29yZHMpIGJldHdlZW4gdGhlIHR3byB3aWxsIGJlXG4gIC8vIHJldHVybmVkLiBPdGhlcndpc2UgIGB0cnVlYCB3aWxsIGJlIHJldHVybmVkLlxuICBmdW5jdGlvbiBkaWZmVmFsdWVzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIC8vIFNob3J0Y3V0IG91dCBmb3IgdmFsdWVzIHRoYXQgYXJlIGV4YWN0bHkgZXF1YWxcbiAgICBpZiAodmFsdWUgPT09IG9sZFZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkpIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlc1xuICAgICAgdmFyIHNwbGljZXMgPSBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgICByZXR1cm4gc3BsaWNlcy5sZW5ndGggPyBzcGxpY2VzIDogZmFsc2U7XG4gICAgfSBlbHNlIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIElmIGFuIG9iamVjdCBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIGNobmFnZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gdmFsdWVWYWx1ZSAhPT0gb2xkVmFsdWVWYWx1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gZGlmZk9iamVjdHModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgICAgcmV0dXJuIGNoYW5nZVJlY29yZHMubGVuZ3RoID8gY2hhbmdlUmVjb3JkcyA6IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhIHZhbHVlIGhhcyBjaGFuZ2VkIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gYmFzaWMgdHlwZXMsIHJldHVybmluZyB0cnVlIGlmIGNoYW5nZWQgb3IgZmFsc2UgaWYgbm90XG4gIGZ1bmN0aW9uIGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIHZhciB2YWx1ZVZhbHVlID0gdmFsdWUudmFsdWVPZigpO1xuICAgICAgdmFyIG9sZFZhbHVlVmFsdWUgPSBvbGRWYWx1ZS52YWx1ZU9mKCk7XG5cbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIGlmICh0eXBlb2YgdmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlVmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiBkaWZmQmFzaWModmFsdWVWYWx1ZSwgb2xkVmFsdWVWYWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgYSB2YWx1ZSBoYXMgY2hhbmdlZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ251bWJlcicgJiYgaXNOYU4odmFsdWUpICYmIGlzTmFOKG9sZFZhbHVlKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWUgIT09IG9sZFZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIG9iamVjdHMgcmV0dXJuaW5nIGFuIGFycmF5IG9mIGNoYW5nZSByZWNvcmRzLiBUaGUgY2hhbmdlIHJlY29yZCBsb29rcyBsaWtlOlxuICAvLyBgYGBqYXZhc2NyaXB0XG4gIC8vIHtcbiAgLy8gICBvYmplY3Q6IG9iamVjdCxcbiAgLy8gICB0eXBlOiAnZGVsZXRlZHx1cGRhdGVkfG5ldycsXG4gIC8vICAgbmFtZTogJ3Byb3BlcnR5TmFtZScsXG4gIC8vICAgb2xkVmFsdWU6IG9sZFZhbHVlXG4gIC8vIH1cbiAgLy8gYGBgXG4gIGZ1bmN0aW9uIGRpZmZPYmplY3RzKG9iamVjdCwgb2xkT2JqZWN0KSB7XG4gICAgdmFyIGNoYW5nZVJlY29yZHMgPSBbXTtcbiAgICB2YXIgcHJvcCwgb2xkVmFsdWUsIHZhbHVlO1xuXG4gICAgLy8gR29lcyB0aHJvdWdoIHRoZSBvbGQgb2JqZWN0IChzaG91bGQgYmUgYSBjbG9uZSkgYW5kIGxvb2sgZm9yIHRoaW5ncyB0aGF0IGFyZSBub3cgZ29uZSBvciBjaGFuZ2VkXG4gICAgZm9yIChwcm9wIGluIG9sZE9iamVjdCkge1xuICAgICAgb2xkVmFsdWUgPSBvbGRPYmplY3RbcHJvcF07XG4gICAgICB2YWx1ZSA9IG9iamVjdFtwcm9wXTtcblxuICAgICAgLy8gQWxsb3cgZm9yIHRoZSBjYXNlIG9mIG9iai5wcm9wID0gdW5kZWZpbmVkICh3aGljaCBpcyBhIG5ldyBwcm9wZXJ0eSwgZXZlbiBpZiBpdCBpcyB1bmRlZmluZWQpXG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCAmJiAhZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBwcm9wZXJ0eSBpcyBnb25lIGl0IHdhcyByZW1vdmVkXG4gICAgICBpZiAoISAocHJvcCBpbiBvYmplY3QpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ2RlbGV0ZWQnLCBwcm9wLCBvbGRWYWx1ZSkpO1xuICAgICAgfSBlbHNlIGlmIChkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICd1cGRhdGVkJywgcHJvcCwgb2xkVmFsdWUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBHb2VzIHRocm91Z2ggdGhlIG9sZCBvYmplY3QgYW5kIGxvb2tzIGZvciB0aGluZ3MgdGhhdCBhcmUgbmV3XG4gICAgZm9yIChwcm9wIGluIG9iamVjdCkge1xuICAgICAgdmFsdWUgPSBvYmplY3RbcHJvcF07XG4gICAgICBpZiAoISAocHJvcCBpbiBvbGRPYmplY3QpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ25ldycsIHByb3ApKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShvYmplY3QpICYmIG9iamVjdC5sZW5ndGggIT09IG9sZE9iamVjdC5sZW5ndGgpIHtcbiAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ3VwZGF0ZWQnLCAnbGVuZ3RoJywgb2xkT2JqZWN0Lmxlbmd0aCkpO1xuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VSZWNvcmRzO1xuICB9XG5cblxuXG5cblxuICBFRElUX0xFQVZFID0gMFxuICBFRElUX1VQREFURSA9IDFcbiAgRURJVF9BREQgPSAyXG4gIEVESVRfREVMRVRFID0gM1xuXG5cbiAgLy8gRGlmZnMgdHdvIGFycmF5cyByZXR1cm5pbmcgYW4gYXJyYXkgb2Ygc3BsaWNlcy4gQSBzcGxpY2Ugb2JqZWN0IGxvb2tzIGxpa2U6XG4gIC8vIGBgYGphdmFzY3JpcHRcbiAgLy8ge1xuICAvLyAgIGluZGV4OiAzLFxuICAvLyAgIHJlbW92ZWQ6IFtpdGVtLCBpdGVtXSxcbiAgLy8gICBhZGRlZENvdW50OiAwXG4gIC8vIH1cbiAgLy8gYGBgXG4gIGZ1bmN0aW9uIGRpZmZBcnJheXModmFsdWUsIG9sZFZhbHVlKSB7XG4gICAgdmFyIGN1cnJlbnRTdGFydCA9IDA7XG4gICAgdmFyIGN1cnJlbnRFbmQgPSB2YWx1ZS5sZW5ndGg7XG4gICAgdmFyIG9sZFN0YXJ0ID0gMDtcbiAgICB2YXIgb2xkRW5kID0gb2xkVmFsdWUubGVuZ3RoO1xuXG4gICAgdmFyIG1pbkxlbmd0aCA9IE1hdGgubWluKGN1cnJlbnRFbmQsIG9sZEVuZCk7XG4gICAgdmFyIHByZWZpeENvdW50ID0gc2hhcmVkUHJlZml4KHZhbHVlLCBvbGRWYWx1ZSwgbWluTGVuZ3RoKTtcbiAgICB2YXIgc3VmZml4Q291bnQgPSBzaGFyZWRTdWZmaXgodmFsdWUsIG9sZFZhbHVlLCBtaW5MZW5ndGggLSBwcmVmaXhDb3VudCk7XG5cbiAgICBjdXJyZW50U3RhcnQgKz0gcHJlZml4Q291bnQ7XG4gICAgb2xkU3RhcnQgKz0gcHJlZml4Q291bnQ7XG4gICAgY3VycmVudEVuZCAtPSBzdWZmaXhDb3VudDtcbiAgICBvbGRFbmQgLT0gc3VmZml4Q291bnQ7XG5cbiAgICBpZiAoY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCA9PT0gMCAmJiBvbGRFbmQgLSBvbGRTdGFydCA9PT0gMCkge1xuICAgICAgcmV0dXJuIFtdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIGFkZGVkLCBvbmx5IHJlbW92ZWQgZnJvbSBvbmUgc3BvdFxuICAgIGlmIChjdXJyZW50U3RhcnQgPT09IGN1cnJlbnRFbmQpIHtcbiAgICAgIHJldHVybiBbIG5ldyBTcGxpY2UoY3VycmVudFN0YXJ0LCBvbGRWYWx1ZS5zbGljZShvbGRTdGFydCwgb2xkRW5kKSwgMCkgXTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3RoaW5nIHdhcyByZW1vdmVkLCBvbmx5IGFkZGVkIHRvIG9uZSBzcG90XG4gICAgaWYgKG9sZFN0YXJ0ID09PSBvbGRFbmQpIHtcbiAgICAgIHJldHVybiBbIG5ldyBTcGxpY2UoY3VycmVudFN0YXJ0LCBbXSwgY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCkgXTtcbiAgICB9XG5cbiAgICAvLyBhIG1peHR1cmUgb2YgYWRkcyBhbmQgcmVtb3Zlc1xuICAgIHZhciBkaXN0YW5jZXMgPSBjYWxjRWRpdERpc3RhbmNlcyh2YWx1ZSwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGRWYWx1ZSwgb2xkU3RhcnQsIG9sZEVuZCk7XG4gICAgdmFyIG9wcyA9IHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpO1xuXG4gICAgdmFyIHNwbGljZSA9IG51bGw7XG4gICAgdmFyIHNwbGljZXMgPSBbXTtcbiAgICB2YXIgaW5kZXggPSBjdXJyZW50U3RhcnQ7XG4gICAgdmFyIG9sZEluZGV4ID0gb2xkU3RhcnQ7XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IG9wcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBvcCA9IG9wc1tpXTtcbiAgICAgIGlmIChvcCA9PT0gRURJVF9MRUFWRSkge1xuICAgICAgICBpZiAoc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgICAgICAgc3BsaWNlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4Kys7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX1VQREFURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG5cbiAgICAgICAgc3BsaWNlLnJlbW92ZWQucHVzaChvbGRWYWx1ZVtvbGRJbmRleF0pO1xuICAgICAgICBvbGRJbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9BREQpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UuYWRkZWRDb3VudCsrO1xuICAgICAgICBpbmRleCsrO1xuICAgICAgfSBlbHNlIGlmIChvcCA9PT0gRURJVF9ERUxFVEUpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2UgPSBuZXcgU3BsaWNlKGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNwbGljZSkge1xuICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNwbGljZXM7XG4gIH1cblxuXG5cblxuICAvLyBmaW5kIHRoZSBudW1iZXIgb2YgaXRlbXMgYXQgdGhlIGJlZ2lubmluZyB0aGF0IGFyZSB0aGUgc2FtZVxuICBmdW5jdGlvbiBzaGFyZWRQcmVmaXgoY3VycmVudCwgb2xkLCBzZWFyY2hMZW5ndGgpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNlYXJjaExlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoZGlmZkJhc2ljKGN1cnJlbnRbaV0sIG9sZFtpXSkpIHtcbiAgICAgICAgcmV0dXJuIGk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWFyY2hMZW5ndGg7XG4gIH1cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgZW5kIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFN1ZmZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIHZhciBpbmRleDEgPSBjdXJyZW50Lmxlbmd0aDtcbiAgICB2YXIgaW5kZXgyID0gb2xkLmxlbmd0aDtcbiAgICB2YXIgY291bnQgPSAwO1xuICAgIHdoaWxlIChjb3VudCA8IHNlYXJjaExlbmd0aCAmJiAhZGlmZkJhc2ljKGN1cnJlbnRbLS1pbmRleDFdLCBvbGRbLS1pbmRleDJdKSkge1xuICAgICAgY291bnQrKztcbiAgICB9XG4gICAgcmV0dXJuIGNvdW50O1xuICB9XG5cblxuICBmdW5jdGlvbiBzcGxpY2VPcGVyYXRpb25zRnJvbUVkaXREaXN0YW5jZXMoZGlzdGFuY2VzKSB7XG4gICAgdmFyIGkgPSBkaXN0YW5jZXMubGVuZ3RoIC0gMTtcbiAgICB2YXIgaiA9IGRpc3RhbmNlc1swXS5sZW5ndGggLSAxO1xuICAgIHZhciBjdXJyZW50ID0gZGlzdGFuY2VzW2ldW2pdO1xuICAgIHZhciBlZGl0cyA9IFtdO1xuICAgIHdoaWxlIChpID4gMCB8fCBqID4gMCkge1xuICAgICAgaWYgKGkgPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0FERCk7XG4gICAgICAgIGotLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChqID09PSAwKSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9ERUxFVEUpO1xuICAgICAgICBpLS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB2YXIgbm9ydGhXZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICB2YXIgd2VzdCA9IGRpc3RhbmNlc1tpIC0gMV1bal07XG4gICAgICB2YXIgbm9ydGggPSBkaXN0YW5jZXNbaV1baiAtIDFdO1xuXG4gICAgICBpZiAod2VzdCA8IG5vcnRoKSB7XG4gICAgICAgIG1pbiA9IHdlc3QgPCBub3J0aFdlc3QgPyB3ZXN0IDogbm9ydGhXZXN0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWluID0gbm9ydGggPCBub3J0aFdlc3QgPyBub3J0aCA6IG5vcnRoV2VzdDtcbiAgICAgIH1cblxuICAgICAgaWYgKG1pbiA9PT0gbm9ydGhXZXN0KSB7XG4gICAgICAgIGlmIChub3J0aFdlc3QgPT09IGN1cnJlbnQpIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfTEVBVkUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVkaXRzLnB1c2goRURJVF9VUERBVEUpO1xuICAgICAgICAgIGN1cnJlbnQgPSBub3J0aFdlc3Q7XG4gICAgICAgIH1cbiAgICAgICAgaS0tO1xuICAgICAgICBqLS07XG4gICAgICB9IGVsc2UgaWYgKG1pbiA9PT0gd2VzdCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfREVMRVRFKTtcbiAgICAgICAgaS0tO1xuICAgICAgICBjdXJyZW50ID0gd2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9BREQpO1xuICAgICAgICBqLS07XG4gICAgICAgIGN1cnJlbnQgPSBub3J0aDtcbiAgICAgIH1cbiAgICB9XG4gICAgZWRpdHMucmV2ZXJzZSgpO1xuICAgIHJldHVybiBlZGl0cztcbiAgfVxuXG5cbiAgZnVuY3Rpb24gY2FsY0VkaXREaXN0YW5jZXMoY3VycmVudCwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGQsIG9sZFN0YXJ0LCBvbGRFbmQpIHtcbiAgICAvLyBcIkRlbGV0aW9uXCIgY29sdW1uc1xuICAgIHZhciByb3dDb3VudCA9IG9sZEVuZCAtIG9sZFN0YXJ0ICsgMTtcbiAgICB2YXIgY29sdW1uQ291bnQgPSBjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0ICsgMTtcbiAgICB2YXIgZGlzdGFuY2VzID0gbmV3IEFycmF5KHJvd0NvdW50KTtcbiAgICB2YXIgaSwgajtcblxuICAgIC8vIFwiQWRkaXRpb25cIiByb3dzLiBJbml0aWFsaXplIG51bGwgY29sdW1uLlxuICAgIGZvciAoaSA9IDA7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSBuZXcgQXJyYXkoY29sdW1uQ291bnQpO1xuICAgICAgZGlzdGFuY2VzW2ldWzBdID0gaTtcbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIG51bGwgcm93XG4gICAgZm9yIChqID0gMDsgaiA8IGNvbHVtbkNvdW50OyBqKyspIHtcbiAgICAgIGRpc3RhbmNlc1swXVtqXSA9IGo7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMTsgaSA8IHJvd0NvdW50OyBpKyspIHtcbiAgICAgIGZvciAoaiA9IDE7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICAgIGlmICghZGlmZkJhc2ljKGN1cnJlbnRbY3VycmVudFN0YXJ0ICsgaiAtIDFdLCBvbGRbb2xkU3RhcnQgKyBpIC0gMV0pKSB7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIG5vcnRoID0gZGlzdGFuY2VzW2kgLSAxXVtqXSArIDE7XG4gICAgICAgICAgdmFyIHdlc3QgPSBkaXN0YW5jZXNbaV1baiAtIDFdICsgMTtcbiAgICAgICAgICBkaXN0YW5jZXNbaV1bal0gPSBub3J0aCA8IHdlc3QgPyBub3J0aCA6IHdlc3Q7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGlzdGFuY2VzO1xuICB9XG59KSgpO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpO1xuZXhwb3J0cy5leHByZXNzaW9ucyA9IHJlcXVpcmUoJ2V4cHJlc3Npb25zLWpzJyk7XG5leHBvcnRzLmV4cHJlc3Npb25zLmRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gT2JzZXJ2ZXI7XG52YXIgZXhwcmVzc2lvbnMgPSByZXF1aXJlKCdleHByZXNzaW9ucy1qcycpO1xudmFyIGRpZmYgPSByZXF1aXJlKCcuL2RpZmYnKTtcbnZhciByZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8IHNldFRpbWVvdXQ7XG52YXIgY2FuY2VsQW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUgfHwgY2xlYXJUaW1lb3V0O1xuXG4vLyAjIE9ic2VydmVyXG5cbi8vIERlZmluZXMgYW4gb2JzZXJ2ZXIgY2xhc3Mgd2hpY2ggcmVwcmVzZW50cyBhbiBleHByZXNzaW9uLiBXaGVuZXZlciB0aGF0IGV4cHJlc3Npb24gcmV0dXJucyBhIG5ldyB2YWx1ZSB0aGUgYGNhbGxiYWNrYFxuLy8gaXMgY2FsbGVkIHdpdGggdGhlIHZhbHVlLlxuLy9cbi8vIElmIHRoZSBvbGQgYW5kIG5ldyB2YWx1ZXMgd2VyZSBlaXRoZXIgYW4gYXJyYXkgb3IgYW4gb2JqZWN0LCB0aGUgYGNhbGxiYWNrYCBhbHNvXG4vLyByZWNlaXZlcyBhbiBhcnJheSBvZiBzcGxpY2VzIChmb3IgYW4gYXJyYXkpLCBvciBhbiBhcnJheSBvZiBjaGFuZ2Ugb2JqZWN0cyAoZm9yIGFuIG9iamVjdCkgd2hpY2ggYXJlIHRoZSBzYW1lXG4vLyBmb3JtYXQgdGhhdCBgQXJyYXkub2JzZXJ2ZWAgYW5kIGBPYmplY3Qub2JzZXJ2ZWAgcmV0dXJuIDxodHRwOi8vd2lraS5lY21hc2NyaXB0Lm9yZy9kb2t1LnBocD9pZD1oYXJtb255Om9ic2VydmU+LlxuZnVuY3Rpb24gT2JzZXJ2ZXIoZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICBpZiAodHlwZW9mIGV4cHIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aGlzLmdldHRlciA9IGV4cHI7XG4gICAgdGhpcy5zZXR0ZXIgPSBleHByO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuZ2V0dGVyID0gZXhwcmVzc2lvbnMucGFyc2UoZXhwciwgT2JzZXJ2ZXIuZ2xvYmFscywgT2JzZXJ2ZXIuZm9ybWF0dGVycyk7XG4gIH1cbiAgdGhpcy5leHByID0gZXhwcjtcbiAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrO1xuICB0aGlzLmNhbGxiYWNrQ29udGV4dCA9IGNhbGxiYWNrQ29udGV4dDtcbiAgdGhpcy5za2lwID0gZmFsc2U7XG4gIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB0aGlzLm9sZFZhbHVlID0gdW5kZWZpbmVkO1xufVxuXG5PYnNlcnZlci5wcm90b3R5cGUgPSB7XG5cbiAgLy8gQmluZHMgdGhpcyBleHByZXNzaW9uIHRvIGEgZ2l2ZW4gY29udGV4dFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0LCBza2lwVXBkYXRlKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5jYWxsYmFjaykge1xuICAgICAgT2JzZXJ2ZXIuYWRkKHRoaXMsIHNraXBVcGRhdGUpO1xuICAgIH1cbiAgfSxcblxuICAvLyBVbmJpbmRzIHRoaXMgZXhwcmVzc2lvblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuY29udGV4dCA9IG51bGw7XG4gICAgT2JzZXJ2ZXIucmVtb3ZlKHRoaXMpO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhpcyBvYnNlcnZlclxuICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldHRlci5jYWxsKHRoaXMuY29udGV4dCk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFNldHMgdGhlIHZhbHVlIG9mIHRoaXMgZXhwcmVzc2lvblxuICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHJldHVybjtcbiAgICBpZiAodGhpcy5zZXR0ZXIgPT09IGZhbHNlKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLnNldHRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5zZXR0ZXIgPSB0eXBlb2YgdGhpcy5leHByID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZXhwcmVzc2lvbnMucGFyc2VTZXR0ZXIodGhpcy5leHByLCBPYnNlcnZlci5nbG9iYWxzLCBPYnNlcnZlci5mb3JtYXR0ZXJzKVxuICAgICAgICAgIDogZmFsc2U7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRoaXMuc2V0dGVyID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuc2V0dGVyKSByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHZhciByZXN1bHQgPSB0aGlzLnNldHRlci5jYWxsKHRoaXMuY29udGV4dCwgdmFsdWUpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGNhbid0IGV4cGVjdCBjb2RlIGluIGZyYWdtZW50cyBvdXRzaWRlIE9ic2VydmVyIHRvIGJlIGF3YXJlIG9mIFwic3luY1wiIHNpbmNlIG9ic2VydmVyIGNhbiBiZSByZXBsYWNlZCBieSBvdGhlclxuICAgIC8vIHR5cGVzIChlLmcuIG9uZSB3aXRob3V0IGEgYHN5bmMoKWAgbWV0aG9kLCBzdWNoIGFzIG9uZSB0aGF0IHVzZXMgYE9iamVjdC5vYnNlcnZlYCkgaW4gb3RoZXIgc3lzdGVtcy5cbiAgICB0aGlzLnN5bmMoKTtcbiAgICBPYnNlcnZlci5zeW5jKCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuXG4gIC8vIEluc3RydWN0cyB0aGlzIG9ic2VydmVyIHRvIG5vdCBjYWxsIGl0cyBgY2FsbGJhY2tgIG9uIHRoZSBuZXh0IHN5bmMsIHdoZXRoZXIgdGhlIHZhbHVlIGhhcyBjaGFuZ2VkIG9yIG5vdFxuICBza2lwTmV4dFN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2tpcCA9IHRydWU7XG4gIH0sXG5cblxuICAvLyBTeW5jcyB0aGlzIG9ic2VydmVyIG5vdywgY2FsbGluZyB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkgaWYgdGhlcmUgaGF2ZSBiZWVuIGNoYW5nZXNcbiAgc3luYzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gdGhpcy5nZXQoKTtcblxuICAgIC8vIERvbid0IGNhbGwgdGhlIGNhbGxiYWNrIGlmIGBza2lwTmV4dFN5bmNgIHdhcyBjYWxsZWQgb24gdGhlIG9ic2VydmVyXG4gICAgaWYgKHRoaXMuc2tpcCB8fCAhdGhpcy5jYWxsYmFjaykge1xuICAgICAgdGhpcy5za2lwID0gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2suIFRoaXNcbiAgICAgIHZhciBjaGFuZ2VkID0gZGlmZi52YWx1ZXModmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgaWYgKCFjaGFuZ2VkICYmICF0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMpIHJldHVybjtcbiAgICAgIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2hhbmdlZCkpIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjay5jYWxsKHRoaXMuY2FsbGJhY2tDb250ZXh0LCB2YWx1ZSwgdGhpcy5vbGRWYWx1ZSwgY2hhbmdlZClcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuY2FsbGJhY2suY2FsbCh0aGlzLmNhbGxiYWNrQ29udGV4dCwgdmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmICh0aGlzLmdldENoYW5nZVJlY29yZHMpIHtcbiAgICAgIC8vIFN0b3JlIGFuIGltbXV0YWJsZSB2ZXJzaW9uIG9mIHRoZSB2YWx1ZSwgYWxsb3dpbmcgZm9yIGFycmF5cyBhbmQgb2JqZWN0cyB0byBjaGFuZ2UgaW5zdGFuY2UgYnV0IG5vdCBjb250ZW50IGFuZFxuICAgICAgLy8gc3RpbGwgcmVmcmFpbiBmcm9tIGRpc3BhdGNoaW5nIGNhbGxiYWNrcyAoZS5nLiB3aGVuIHVzaW5nIGFuIG9iamVjdCBpbiBiaW5kLWNsYXNzIG9yIHdoZW4gdXNpbmcgYXJyYXkgZm9ybWF0dGVyc1xuICAgICAgLy8gaW4gYmluZC1lYWNoKVxuICAgICAgdGhpcy5vbGRWYWx1ZSA9IGRpZmYuY2xvbmUodmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLm9sZFZhbHVlID0gdmFsdWU7XG4gICAgfVxuICB9XG59O1xuXG5cbi8vIEFuIGFycmF5IG9mIGFsbCBvYnNlcnZlcnMsIGNvbnNpZGVyZWQgKnByaXZhdGUqXG5PYnNlcnZlci5vYnNlcnZlcnMgPSBbXTtcblxuLy8gQW4gYXJyYXkgb2YgY2FsbGJhY2tzIHRvIHJ1biBhZnRlciB0aGUgbmV4dCBzeW5jLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIuY2FsbGJhY2tzID0gW107XG5PYnNlcnZlci5saXN0ZW5lcnMgPSBbXTtcblxuLy8gQWRkcyBhIG5ldyBvYnNlcnZlciB0byBiZSBzeW5jZWQgd2l0aCBjaGFuZ2VzLiBJZiBgc2tpcFVwZGF0ZWAgaXMgdHJ1ZSB0aGVuIHRoZSBjYWxsYmFjayB3aWxsIG9ubHkgYmUgY2FsbGVkIHdoZW4gYVxuLy8gY2hhbmdlIGlzIG1hZGUsIG5vdCBpbml0aWFsbHkuXG5PYnNlcnZlci5hZGQgPSBmdW5jdGlvbihvYnNlcnZlciwgc2tpcFVwZGF0ZSkge1xuICB0aGlzLm9ic2VydmVycy5wdXNoKG9ic2VydmVyKTtcbiAgaWYgKCFza2lwVXBkYXRlKSBvYnNlcnZlci5zeW5jKCk7XG59O1xuXG4vLyBSZW1vdmVzIGFuIG9ic2VydmVyLCBzdG9wcGluZyBpdCBmcm9tIGJlaW5nIHJ1blxuT2JzZXJ2ZXIucmVtb3ZlID0gZnVuY3Rpb24ob2JzZXJ2ZXIpIHtcbiAgdmFyIGluZGV4ID0gdGhpcy5vYnNlcnZlcnMuaW5kZXhPZihvYnNlcnZlcik7XG4gIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICB0aGlzLm9ic2VydmVycy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufTtcblxuLy8gKnByaXZhdGUqIHByb3BlcnRpZXMgdXNlZCBpbiB0aGUgc3luYyBjeWNsZVxuT2JzZXJ2ZXIuc3luY2luZyA9IGZhbHNlO1xuT2JzZXJ2ZXIucmVydW4gPSBmYWxzZTtcbk9ic2VydmVyLmN5Y2xlcyA9IDA7XG5PYnNlcnZlci5tYXggPSAxMDtcbk9ic2VydmVyLnRpbWVvdXQgPSBudWxsO1xuT2JzZXJ2ZXIuc3luY1BlbmRpbmcgPSBudWxsO1xuXG4vLyBTY2hlZHVsZXMgYW4gb2JzZXJ2ZXIgc3luYyBjeWNsZSB3aGljaCBjaGVja3MgYWxsIHRoZSBvYnNlcnZlcnMgdG8gc2VlIGlmIHRoZXkndmUgY2hhbmdlZC5cbk9ic2VydmVyLnN5bmMgPSBmdW5jdGlvbihjYWxsYmFjaykge1xuICBpZiAoT2JzZXJ2ZXIuc3luY1BlbmRpbmcpIHJldHVybiBmYWxzZTtcbiAgT2JzZXJ2ZXIuc3luY1BlbmRpbmcgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoZnVuY3Rpb24oKSB7XG4gICAgT2JzZXJ2ZXIuc3luY05vdyhjYWxsYmFjayk7XG4gIH0pO1xuICByZXR1cm4gdHJ1ZTtcbn07XG5cbi8vIFJ1bnMgdGhlIG9ic2VydmVyIHN5bmMgY3ljbGUgd2hpY2ggY2hlY2tzIGFsbCB0aGUgb2JzZXJ2ZXJzIHRvIHNlZSBpZiB0aGV5J3ZlIGNoYW5nZWQuXG5PYnNlcnZlci5zeW5jTm93ID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgIE9ic2VydmVyLmFmdGVyU3luYyhjYWxsYmFjayk7XG4gIH1cblxuICBjYW5jZWxBbmltYXRpb25GcmFtZShPYnNlcnZlci5zeW5jUGVuZGluZyk7XG4gIE9ic2VydmVyLnN5bmNQZW5kaW5nID0gbnVsbDtcblxuICBpZiAoT2JzZXJ2ZXIuc3luY2luZykge1xuICAgIE9ic2VydmVyLnJlcnVuID0gdHJ1ZTtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICBPYnNlcnZlci5zeW5jaW5nID0gdHJ1ZTtcbiAgT2JzZXJ2ZXIucmVydW4gPSB0cnVlO1xuICBPYnNlcnZlci5jeWNsZXMgPSAwO1xuXG4gIC8vIEFsbG93IGNhbGxiYWNrcyB0byBydW4gdGhlIHN5bmMgY3ljbGUgYWdhaW4gaW1tZWRpYXRlbHksIGJ1dCBzdG9wIGF0IGBPYnNlcnZlci5tYXhgIChkZWZhdWx0IDEwKSBjeWNsZXMgdG8gd2UgZG9uJ3RcbiAgLy8gcnVuIGluZmluaXRlIGxvb3BzXG4gIHdoaWxlIChPYnNlcnZlci5yZXJ1bikge1xuICAgIGlmICgrK09ic2VydmVyLmN5Y2xlcyA9PT0gT2JzZXJ2ZXIubWF4KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luZmluaXRlIG9ic2VydmVyIHN5bmNpbmcsIGFuIG9ic2VydmVyIGlzIGNhbGxpbmcgT2JzZXJ2ZXIuc3luYygpIHRvbyBtYW55IHRpbWVzJyk7XG4gICAgfVxuICAgIE9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG4gICAgLy8gdGhlIG9ic2VydmVyIGFycmF5IG1heSBpbmNyZWFzZSBvciBkZWNyZWFzZSBpbiBzaXplIChyZW1haW5pbmcgb2JzZXJ2ZXJzKSBkdXJpbmcgdGhlIHN5bmNcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IE9ic2VydmVyLm9ic2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgT2JzZXJ2ZXIub2JzZXJ2ZXJzW2ldLnN5bmMoKTtcbiAgICB9XG4gIH1cblxuICB3aGlsZSAoT2JzZXJ2ZXIuY2FsbGJhY2tzLmxlbmd0aCkge1xuICAgIE9ic2VydmVyLmNhbGxiYWNrcy5zaGlmdCgpKCk7XG4gIH1cblxuICBmb3IgKHZhciBpID0gMCwgbCA9IE9ic2VydmVyLmxpc3RlbmVycy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICB2YXIgbGlzdGVuZXIgPSBPYnNlcnZlci5saXN0ZW5lcnNbaV07XG4gICAgbGlzdGVuZXIoKTtcbiAgfVxuXG4gIE9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBBZnRlciB0aGUgbmV4dCBzeW5jIChvciB0aGUgY3VycmVudCBpZiBpbiB0aGUgbWlkZGxlIG9mIG9uZSksIHJ1biB0aGUgcHJvdmlkZWQgY2FsbGJhY2tcbk9ic2VydmVyLmFmdGVyU3luYyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICBPYnNlcnZlci5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG59O1xuXG5PYnNlcnZlci5vblN5bmMgPSBmdW5jdGlvbihsaXN0ZW5lcikge1xuICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgT2JzZXJ2ZXIubGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xufTtcblxuT2JzZXJ2ZXIucmVtb3ZlT25TeW5jID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIHZhciBpbmRleCA9IE9ic2VydmVyLmxpc3RlbmVycy5pbmRleE9mKGxpc3RlbmVyKTtcbiAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgIE9ic2VydmVyLmxpc3RlbmVycy5zcGxpY2UoaW5kZXgsIDEpLnBvcCgpO1xuICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBGYWRlIGluIGFuZCBvdXRcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbignZmFkZScsIHtcbiAgICBvcHRpb25zOiB7XG4gICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgfSxcbiAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgb3BhY2l0eTogJzAnIH0sXG4gICAgICAgIHsgb3BhY2l0eTogJzEnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBkb25lO1xuICAgIH0sXG4gICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBvcGFjaXR5OiAnMScgfSxcbiAgICAgICAgeyBvcGFjaXR5OiAnMCcgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGRvbmU7XG4gICAgfVxuICB9KTtcblxuICB2YXIgc2xpZGVzID0ge1xuICAgIHNsaWRlOiAnaGVpZ2h0JyxcbiAgICBzbGlkZXY6ICdoZWlnaHQnLFxuICAgIHNsaWRlaDogJ3dpZHRoJ1xuICB9O1xuXG4gIHZhciBhbmltYXRpbmcgPSBuZXcgTWFwKCk7XG5cbiAgZnVuY3Rpb24gb2JqKGtleSwgdmFsdWUpIHtcbiAgICB2YXIgb2JqID0ge307XG4gICAgb2JqW2tleV0gPSB2YWx1ZTtcbiAgICByZXR1cm4gb2JqO1xuICB9XG5cbiAgLyoqXG4gICAqIFNsaWRlIGRvd24gYW5kIHVwLCBsZWZ0IGFuZCByaWdodFxuICAgKi9cbiAgT2JqZWN0LmtleXMoc2xpZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgcHJvcGVydHkgPSBzbGlkZXNbbmFtZV07XG5cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSwge1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICAgIH0sXG4gICAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG4gICAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JylcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSk7XG5cblxuICAgIC8qKlxuICAgICAqIE1vdmUgaXRlbXMgdXAgYW5kIGRvd24gaW4gYSBsaXN0LCBzbGlkZSBkb3duIGFuZCB1cFxuICAgICAqL1xuICAgIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lICsgJy1tb3ZlJywge1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW0gPSBlbGVtZW50LnZpZXcgJiYgZWxlbWVudC52aWV3Ll9yZXBlYXRJdGVtXztcbiAgICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgICBhbmltYXRpbmcuc2V0KGl0ZW0sIGVsZW1lbnQpO1xuICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBhbmltYXRpbmcuZGVsZXRlKGl0ZW0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpdGVtID0gZWxlbWVudC52aWV3ICYmIGVsZW1lbnQudmlldy5fcmVwZWF0SXRlbV87XG4gICAgICAgIGlmIChpdGVtKSB7XG4gICAgICAgICAgdmFyIG5ld0VsZW1lbnQgPSBhbmltYXRpbmcuZ2V0KGl0ZW0pO1xuICAgICAgICAgIGlmIChuZXdFbGVtZW50ICYmIG5ld0VsZW1lbnQucGFyZW50Tm9kZSA9PT0gZWxlbWVudC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGl0ZW0gaXMgYmVpbmcgcmVtb3ZlZCBpbiBvbmUgcGxhY2UgYW5kIGFkZGVkIGludG8gYW5vdGhlci4gTWFrZSBpdCBsb29rIGxpa2UgaXRzIG1vdmluZyBieSBtYWtpbmcgYm90aFxuICAgICAgICAgICAgLy8gZWxlbWVudHMgbm90IHZpc2libGUgYW5kIGhhdmluZyBhIGNsb25lIG1vdmUgYWJvdmUgdGhlIGl0ZW1zIHRvIHRoZSBuZXcgbG9jYXRpb24uXG4gICAgICAgICAgICBlbGVtZW50ID0gdGhpcy5hbmltYXRlTW92ZShlbGVtZW50LCBuZXdFbGVtZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEbyB0aGUgc2xpZGVcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfSxcblxuICAgICAgYW5pbWF0ZU1vdmU6IGZ1bmN0aW9uKG9sZEVsZW1lbnQsIG5ld0VsZW1lbnQpIHtcbiAgICAgICAgdmFyIHBsYWNlaG9sZGVyRWxlbWVudDtcbiAgICAgICAgdmFyIHBhcmVudCA9IG5ld0VsZW1lbnQucGFyZW50Tm9kZTtcbiAgICAgICAgaWYgKCFwYXJlbnQuX19zbGlkZU1vdmVIYW5kbGVkKSB7XG4gICAgICAgICAgcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCA9IHRydWU7XG4gICAgICAgICAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHBhcmVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgICAgICBwYXJlbnQuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcmlnU3R5bGUgPSBvbGRFbGVtZW50LmdldEF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgICAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUob2xkRWxlbWVudCk7XG4gICAgICAgIHZhciBtYXJnaW5PZmZzZXRMZWZ0ID0gLXBhcnNlSW50KHN0eWxlLm1hcmdpbkxlZnQpO1xuICAgICAgICB2YXIgbWFyZ2luT2Zmc2V0VG9wID0gLXBhcnNlSW50KHN0eWxlLm1hcmdpblRvcCk7XG4gICAgICAgIHZhciBvbGRMZWZ0ID0gb2xkRWxlbWVudC5vZmZzZXRMZWZ0O1xuICAgICAgICB2YXIgb2xkVG9wID0gb2xkRWxlbWVudC5vZmZzZXRUb3A7XG5cbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50ID0gZnJhZ21lbnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZShvbGRFbGVtZW50LmNsb25lTm9kZSh0cnVlKSk7XG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5zdHlsZS53aWR0aCA9IG9sZEVsZW1lbnQuc3R5bGUud2lkdGggPSBzdHlsZS53aWR0aDtcbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnN0eWxlLmhlaWdodCA9IG9sZEVsZW1lbnQuc3R5bGUuaGVpZ2h0ID0gc3R5bGUuaGVpZ2h0O1xuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcwJztcblxuICAgICAgICBvbGRFbGVtZW50LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcbiAgICAgICAgb2xkRWxlbWVudC5zdHlsZS56SW5kZXggPSAxMDAwO1xuICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyRWxlbWVudCwgb2xkRWxlbWVudCk7XG4gICAgICAgIG5ld0VsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcwJztcblxuICAgICAgICBvbGRFbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIHsgdG9wOiBvbGRUb3AgKyBtYXJnaW5PZmZzZXRUb3AgKyAncHgnLCBsZWZ0OiBvbGRMZWZ0ICsgbWFyZ2luT2Zmc2V0TGVmdCArICdweCcgfSxcbiAgICAgICAgICB7IHRvcDogbmV3RWxlbWVudC5vZmZzZXRUb3AgKyBtYXJnaW5PZmZzZXRUb3AgKyAncHgnLCBsZWZ0OiBuZXdFbGVtZW50Lm9mZnNldExlZnQgKyBtYXJnaW5PZmZzZXRMZWZ0ICsgJ3B4JyB9XG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgICAgb3JpZ1N0eWxlID8gb2xkRWxlbWVudC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgb3JpZ1N0eWxlKSA6IG9sZEVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdzdHlsZScpO1xuICAgICAgICAgIG5ld0VsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcnO1xuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBwbGFjZWhvbGRlckVsZW1lbnQ7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgfSk7XG5cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcbnZhciBkaWZmID0gcmVxdWlyZSgnLi4vb2JzZXJ2ZXIvZGlmZicpO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBQcmludHMgb3V0IHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB0byB0aGUgY29uc29sZS5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnZGVidWcnLCB7XG4gICAgcHJpb3JpdHk6IDYwLFxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBjb25zb2xlLmluZm8oJ0RlYnVnOicsIHRoaXMuZXhwcmVzc2lvbiwgJz0nLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyB0ZXh0XG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZGlzcGxheSBlc2NhcGVkIHRleHQgaW5zaWRlIGFuIGVsZW1lbnQuIFRoaXMgY2FuIGJlIGRvbmUgd2l0aCBiaW5kaW5nIGRpcmVjdGx5IGluIHRleHQgbm9kZXMgYnV0XG4gICAqIHVzaW5nIHRoZSBhdHRyaWJ1dGUgYmluZGVyIHByZXZlbnRzIGEgZmxhc2ggb2YgdW5zdHlsZWQgY29udGVudCBvbiB0aGUgbWFpbiBwYWdlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aDEgdGV4dD1cInt7cG9zdC50aXRsZX19XCI+VW50aXRsZWQ8L2gxPlxuICAgKiA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5MaXR0bGUgUmVkPC9oMT5cbiAgICogPGRpdj5cbiAgICogICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgPHA+XG4gICAqICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgIDwvcD5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd0ZXh0JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB0aGlzLmVsZW1lbnQudGV4dENvbnRlbnQgPSAodmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWUpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBodG1sXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZGlzcGxheSB1bmVzY2FwZWQgSFRNTCBpbnNpZGUgYW4gZWxlbWVudC4gQmUgc3VyZSBpdCdzIHRydXN0ZWQhIFRoaXMgc2hvdWxkIGJlIHVzZWQgd2l0aCBmaWx0ZXJzXG4gICAqIHdoaWNoIGNyZWF0ZSBIVE1MIGZyb20gc29tZXRoaW5nIHNhZmUuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT57e3Bvc3QudGl0bGV9fTwvaDE+XG4gICAqIDxkaXYgaHRtbD1cInt7cG9zdC5ib2R5IHwgbWFya2Rvd259fVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiA8ZGl2PlxuICAgKiAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICA8cD5cbiAgICogICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgPC9wPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2h0bWwnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC5pbm5lckhUTUwgPSAodmFsdWUgPT0gbnVsbCA/ICcnIDogdmFsdWUpO1xuICB9KTtcblxuXG5cbiAgLyoqXG4gICAqICMjIGNsYXNzLVtjbGFzc05hbWVdXG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gYWRkIGNsYXNzZXMgdG8gYW4gZWxlbWVudCBkZXBlbmRlbnQgb24gd2hldGhlciB0aGUgZXhwcmVzc2lvbiBpcyB0cnVlIG9yIGZhbHNlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwidXNlci1pdGVtXCIgY2xhc3Mtc2VsZWN0ZWQtdXNlcj1cInt7c2VsZWN0ZWQgPT09IHVzZXJ9fVwiPlxuICAgKiAgIDxidXR0b24gY2xhc3M9XCJidG4gcHJpbWFyeVwiIGNsYXNzLWhpZ2hsaWdodD1cInt7cmVhZHl9fVwiPjwvYnV0dG9uPlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYHNlbGVjdGVkYCBlcXVhbHMgdGhlIGB1c2VyYCBhbmQgYHJlYWR5YCBpcyBgdHJ1ZWA6KlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgY2xhc3M9XCJ1c2VyLWl0ZW0gc2VsZWN0ZWQtdXNlclwiPlxuICAgKiAgIDxidXR0b24gY2xhc3M9XCJidG4gcHJpbWFyeSBoaWdobGlnaHRcIj48L2J1dHRvbj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjbGFzcy0qJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICBpZiAodmFsdWUpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5jbGFzc0xpc3QuYWRkKHRoaXMubWF0Y2gpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQuY2xhc3NMaXN0LnJlbW92ZSh0aGlzLm1hdGNoKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBXaGVuIHdvcmtpbmcgd2l0aCBhIGJvdW5kIGNsYXNzIGF0dHJpYnV0ZSwgbWFrZSBzdXJlIGl0IGRvZXNuJ3Qgc3RvcCBvbiBjbGFzcy0qIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NsYXNzJywge1xuICAgIG9ubHlXaGVuQm91bmQ6IHRydWUsXG4gICAgdXBkYXRlZDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgIHZhciBjbGFzc0xpc3QgPSB0aGlzLmVsZW1lbnQuY2xhc3NMaXN0O1xuICAgICAgaWYgKHRoaXMuY2xhc3Nlcykge1xuICAgICAgICB0aGlzLmNsYXNzZXMuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgICBpZiAoY2xhc3NOYW1lKSB7XG4gICAgICAgICAgICBjbGFzc0xpc3QucmVtb3ZlKGNsYXNzTmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIGlmICh2YWx1ZSkge1xuICAgICAgICB0aGlzLmNsYXNzZXMgPSB2YWx1ZS5zcGxpdCgvXFxzKy8pO1xuICAgICAgICB0aGlzLmNsYXNzZXMuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgICBpZiAoY2xhc3NOYW1lKSB7XG4gICAgICAgICAgICBjbGFzc0xpc3QuYWRkKGNsYXNzTmFtZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIEF1dG9tYXRpY2FsbHkgZm9jdXNlcyB0aGUgaW5wdXQgd2hlbiBpdCBpcyBkaXNwbGF5ZWQgb24gc2NyZWVuLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdhdXRvZm9jdXMnLCB7XG4gICAgYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICBlbGVtZW50LmZvY3VzKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqIEF1dG9tYXRpY2FsbHkgc2VsZWN0cyB0aGUgY29udGVudHMgb2YgYW4gaW5wdXQgd2hlbiBpdCByZWNlaXZlcyBmb2N1cy5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnYXV0b3NlbGVjdCcsIHtcbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBmb2N1c2VkLCBtb3VzZUV2ZW50O1xuXG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignbW91c2Vkb3duJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIC8vIFVzZSBtYXRjaGVzIHNpbmNlIGRvY3VtZW50LmFjdGl2ZUVsZW1lbnQgZG9lc24ndCB3b3JrIHdlbGwgd2l0aCB3ZWIgY29tcG9uZW50cyAoZnV0dXJlIGNvbXBhdClcbiAgICAgICAgZm9jdXNlZCA9IHRoaXMubWF0Y2hlcygnOmZvY3VzJyk7XG4gICAgICAgIG1vdXNlRXZlbnQgPSB0cnVlO1xuICAgICAgfSk7XG5cbiAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdmb2N1cycsIGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoIW1vdXNlRXZlbnQpIHtcbiAgICAgICAgICB0aGlzLnNlbGVjdCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcblxuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNldXAnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCFmb2N1c2VkKSB7XG4gICAgICAgICAgdGhpcy5zZWxlY3QoKTtcbiAgICAgICAgfVxuICAgICAgICBtb3VzZUV2ZW50ID0gZmFsc2U7XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG5cblxuICAvKipcbiAgICogIyMgdmFsdWVcbiAgICogQWRkcyBhIGJpbmRlciB3aGljaCBzZXRzIHRoZSB2YWx1ZSBvZiBhbiBIVE1MIGZvcm0gZWxlbWVudC4gVGhpcyBiaW5kZXIgYWxzbyB1cGRhdGVzIHRoZSBkYXRhIGFzIGl0IGlzIGNoYW5nZWQgaW5cbiAgICogdGhlIGZvcm0gZWxlbWVudCwgcHJvdmlkaW5nIHR3byB3YXkgYmluZGluZy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPkZpcnN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJ1c2VyLmZpcnN0TmFtZVwiPlxuICAgKlxuICAgKiA8bGFiZWw+TGFzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImxhc3ROYW1lXCIgdmFsdWU9XCJ1c2VyLmxhc3ROYW1lXCI+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+Rmlyc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqXG4gICAqIDxsYWJlbD5MYXN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwibGFzdE5hbWVcIiB2YWx1ZT1cIldyaWdodFwiPlxuICAgKiBgYGBcbiAgICogQW5kIHdoZW4gdGhlIHVzZXIgY2hhbmdlcyB0aGUgdGV4dCBpbiB0aGUgZmlyc3QgaW5wdXQgdG8gXCJKYWNcIiwgYHVzZXIuZmlyc3ROYW1lYCB3aWxsIGJlIHVwZGF0ZWQgaW1tZWRpYXRlbHkgd2l0aFxuICAgKiB0aGUgdmFsdWUgb2YgYCdKYWMnYC5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndmFsdWUnLCB7XG4gICAgb25seVdoZW5Cb3VuZDogdHJ1ZSxcbiAgICBldmVudHNBdHRyTmFtZTogJ3ZhbHVlLWV2ZW50cycsXG4gICAgZmllbGRBdHRyTmFtZTogJ3ZhbHVlLWZpZWxkJyxcbiAgICBkZWZhdWx0RXZlbnRzOiBbICdjaGFuZ2UnIF0sXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgbmFtZSA9IHRoaXMuZWxlbWVudC50YWdOYW1lLnRvTG93ZXJDYXNlKCk7XG4gICAgICB2YXIgdHlwZSA9IHRoaXMuZWxlbWVudC50eXBlO1xuICAgICAgdGhpcy5tZXRob2RzID0gaW5wdXRNZXRob2RzW3R5cGVdIHx8IGlucHV0TWV0aG9kc1tuYW1lXTtcblxuICAgICAgaWYgKCF0aGlzLm1ldGhvZHMpIHtcbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5lbGVtZW50Lmhhc0F0dHJpYnV0ZSh0aGlzLmV2ZW50c0F0dHJOYW1lKSkge1xuICAgICAgICB0aGlzLmV2ZW50cyA9IHRoaXMuZWxlbWVudC5nZXRBdHRyaWJ1dGUodGhpcy5ldmVudHNBdHRyTmFtZSkuc3BsaXQoJyAnKTtcbiAgICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmV2ZW50c0F0dHJOYW1lKTtcbiAgICAgIH0gZWxzZSBpZiAobmFtZSAhPT0gJ29wdGlvbicpIHtcbiAgICAgICAgdGhpcy5ldmVudHMgPSB0aGlzLmRlZmF1bHRFdmVudHM7XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLmVsZW1lbnQuaGFzQXR0cmlidXRlKHRoaXMuZmllbGRBdHRyTmFtZSkpIHtcbiAgICAgICAgdGhpcy52YWx1ZUZpZWxkID0gdGhpcy5lbGVtZW50LmdldEF0dHJpYnV0ZSh0aGlzLmZpZWxkQXR0ck5hbWUpO1xuICAgICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMuZmllbGRBdHRyTmFtZSk7XG4gICAgICB9XG5cbiAgICAgIGlmICh0eXBlID09PSAnb3B0aW9uJykge1xuICAgICAgICB0aGlzLnZhbHVlRmllbGQgPSB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS52YWx1ZUZpZWxkO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICghdGhpcy5ldmVudHMpIHJldHVybjsgLy8gbm90aGluZyBmb3IgPG9wdGlvbj4gaGVyZVxuICAgICAgdmFyIGVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgICB2YXIgb2JzZXJ2ZXIgPSB0aGlzLm9ic2VydmVyO1xuICAgICAgdmFyIGlucHV0ID0gdGhpcy5tZXRob2RzO1xuICAgICAgdmFyIHZhbHVlRmllbGQgPSB0aGlzLnZhbHVlRmllbGQ7XG5cbiAgICAgIC8vIFRoZSAyLXdheSBiaW5kaW5nIHBhcnQgaXMgc2V0dGluZyB2YWx1ZXMgb24gY2VydGFpbiBldmVudHNcbiAgICAgIGZ1bmN0aW9uIG9uQ2hhbmdlKCkge1xuICAgICAgICBpZiAoaW5wdXQuZ2V0LmNhbGwoZWxlbWVudCwgdmFsdWVGaWVsZCkgIT09IG9ic2VydmVyLm9sZFZhbHVlICYmICFlbGVtZW50LnJlYWRPbmx5KSB7XG4gICAgICAgICAgb2JzZXJ2ZXIuc2V0KGlucHV0LmdldC5jYWxsKGVsZW1lbnQsIHZhbHVlRmllbGQpKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBpZiAoZWxlbWVudC50eXBlID09PSAndGV4dCcpIHtcbiAgICAgICAgZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAoZXZlbnQua2V5Q29kZSA9PT0gMTMpIG9uQ2hhbmdlKCk7XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmV2ZW50cy5mb3JFYWNoKGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudCwgb25DaGFuZ2UpO1xuICAgICAgfSk7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5tZXRob2RzLmdldC5jYWxsKHRoaXMuZWxlbWVudCwgdGhpcy52YWx1ZUZpZWxkKSAhPSB2YWx1ZSkge1xuICAgICAgICB0aGlzLm1ldGhvZHMuc2V0LmNhbGwodGhpcy5lbGVtZW50LCB2YWx1ZSwgdGhpcy52YWx1ZUZpZWxkKTtcbiAgICAgIH1cbiAgICB9XG4gIH0pO1xuXG4gIC8qKlxuICAgKiBIYW5kbGUgdGhlIGRpZmZlcmVudCBmb3JtIHR5cGVzXG4gICAqL1xuICB2YXIgZGVmYXVsdElucHV0TWV0aG9kID0ge1xuICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLnZhbHVlOyB9LFxuICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHsgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7IH1cbiAgfTtcblxuICB2YXIgaW5wdXRNZXRob2RzID0ge1xuICAgIGNoZWNrYm94OiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5jaGVja2VkOyB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSkgeyB0aGlzLmNoZWNrZWQgPSAhIXZhbHVlOyB9XG4gICAgfSxcblxuICAgIGZpbGU6IHtcbiAgICAgIGdldDogZnVuY3Rpb24oKSB7IHJldHVybiB0aGlzLmZpbGVzICYmIHRoaXMuZmlsZXNbMF07IH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7fVxuICAgIH0sXG5cbiAgICBzZWxlY3Q6IHtcbiAgICAgIGdldDogZnVuY3Rpb24odmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWVGaWVsZCkge1xuICAgICAgICAgIHJldHVybiB0aGlzLm9wdGlvbnNbdGhpcy5zZWxlY3RlZEluZGV4XS52YWx1ZU9iamVjdDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICByZXR1cm4gdGhpcy52YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUsIHZhbHVlRmllbGQpIHtcbiAgICAgICAgaWYgKHZhbHVlICYmIHZhbHVlRmllbGQpIHtcbiAgICAgICAgICB0aGlzLnZhbHVlT2JqZWN0ID0gdmFsdWU7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9IHZhbHVlW3ZhbHVlRmllbGRdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIG9wdGlvbjoge1xuICAgICAgZ2V0OiBmdW5jdGlvbih2YWx1ZUZpZWxkKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZUZpZWxkID8gdGhpcy52YWx1ZU9iamVjdFt2YWx1ZUZpZWxkXSA6IHRoaXMudmFsdWU7XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSwgdmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWVGaWVsZCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPYmplY3QgPSB2YWx1ZTtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVbdmFsdWVGaWVsZF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgaW5wdXQ6IGRlZmF1bHRJbnB1dE1ldGhvZCxcblxuICAgIHRleHRhcmVhOiBkZWZhdWx0SW5wdXRNZXRob2RcbiAgfTtcblxuXG4gIC8qKlxuICAgKiAjIyBvbi1bZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgZm9yIGVhY2ggZXZlbnQgbmFtZSBpbiB0aGUgYXJyYXkuIFdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZCB0aGUgZXhwcmVzc2lvbiB3aWxsIGJlIHJ1bi5cbiAgICpcbiAgICogKipFeGFtcGxlIEV2ZW50czoqKlxuICAgKlxuICAgKiAqIG9uLWNsaWNrXG4gICAqICogb24tZGJsY2xpY2tcbiAgICogKiBvbi1zdWJtaXRcbiAgICogKiBvbi1jaGFuZ2VcbiAgICogKiBvbi1mb2N1c1xuICAgKiAqIG9uLWJsdXJcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0gb24tc3VibWl0PVwie3tzYXZlVXNlcigpfX1cIj5cbiAgICogICA8aW5wdXQgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwiSmFjb2JcIj5cbiAgICogICA8YnV0dG9uPlNhdmU8L2J1dHRvbj5cbiAgICogPC9mb3JtPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCAoZXZlbnRzIGRvbid0IGFmZmVjdCB0aGUgSFRNTCk6KlxuICAgKiBgYGBodG1sXG4gICAqIDxmb3JtPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0qJywge1xuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGV2ZW50TmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnROYW1lLCBmdW5jdGlvbihldmVudCkge1xuICAgICAgICBpZiAoIXRoaXMuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpICYmIF90aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAvLyBTZXQgdGhlIGV2ZW50IG9uIHRoZSBjb250ZXh0IHNvIGl0IG1heSBiZSB1c2VkIGluIHRoZSBleHByZXNzaW9uIHdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZC5cbiAgICAgICAgICB2YXIgcHJpb3JFdmVudCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2V2ZW50Jyk7XG4gICAgICAgICAgdmFyIHByaW9yRWxlbWVudCA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2VsZW1lbnQnKTtcbiAgICAgICAgICBfdGhpcy5jb250ZXh0LmV2ZW50ID0gZXZlbnQ7XG4gICAgICAgICAgX3RoaXMuY29udGV4dC5lbGVtZW50ID0gX3RoaXMuZWxlbWVudDtcblxuICAgICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgLy8gT3IganVzdCByZXR1cm4gYSBmdW5jdGlvbiB3aGljaCB3aWxsIGJlIGNhbGxlZCB3aXRoIHRoZSBldmVudCBvYmplY3RcbiAgICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcblxuICAgICAgICAgIC8vIFJlc2V0IHRoZSBjb250ZXh0IHRvIGl0cyBwcmlvciBzdGF0ZVxuICAgICAgICAgIGlmIChwcmlvckV2ZW50KSB7XG4gICAgICAgICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoX3RoaXMuY29udGV4dCwgJ2V2ZW50JywgcHJpb3JFdmVudCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSBfdGhpcy5jb250ZXh0LmV2ZW50O1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGlmIChwcmlvckVsZW1lbnQpIHtcbiAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShfdGhpcy5jb250ZXh0LCAnZWxlbWVudCcsIHByaW9yRWxlbWVudCk7XG4gICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIGRlbGV0ZSBfdGhpcy5jb250ZXh0LmVsZW1lbnQ7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtrZXkgZXZlbnRdXG4gICAqIEFkZHMgYSBiaW5kZXIgd2hpY2ggaXMgdHJpZ2dlcmVkIHdoZW4gdGhlIGtleWRvd24gZXZlbnQncyBga2V5Q29kZWAgcHJvcGVydHkgbWF0Y2hlcy4gSWYgdGhlIG5hbWUgaW5jbHVkZXMgY3RybFxuICAgKiB0aGVuIGl0IHdpbGwgb25seSBmaXJlIHdoZW4gdGhlIGtleSBwbHVzIHRoZSBjdHJsS2V5IG9yIG1ldGFLZXkgaXMgcHJlc3NlZC5cbiAgICpcbiAgICogKipLZXkgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tZW50ZXJcbiAgICogKiBvbi1jdHJsLWVudGVyXG4gICAqICogb24tZXNjXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dCBvbi1lbnRlcj1cInt7c2F2ZSgpfX1cIiBvbi1lc2M9XCJ7e2NhbmNlbCgpfX1cIj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxpbnB1dD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIga2V5Q29kZXMgPSB7IGVudGVyOiAxMywgZXNjOiAyNywgJ2N0cmwtZW50ZXInOiAxMyB9O1xuXG4gIE9iamVjdC5rZXlzKGtleUNvZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIga2V5Q29kZSA9IGtleUNvZGVzW25hbWVdO1xuXG4gICAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdvbi0nICsgbmFtZSwge1xuICAgICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICAgIHZhciB1c2VDdHJsS2V5ID0gbmFtZS5pbmRleE9mKCdjdHJsLScpID09PSAwO1xuICAgICAgICB2YXIgX3RoaXMgPSB0aGlzO1xuICAgICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKHVzZUN0cmxLZXkgJiYgIShldmVudC5jdHJsS2V5IHx8IGV2ZW50Lm1ldGFLZXkpIHx8ICFfdGhpcy5jb250ZXh0KSB7XG4gICAgICAgICAgICByZXR1cm47XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgIT09IGtleUNvZGUpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuXG4gICAgICAgICAgaWYgKCF0aGlzLmhhc0F0dHJpYnV0ZSgnZGlzYWJsZWQnKSkge1xuICAgICAgICAgICAgLy8gU2V0IHRoZSBldmVudCBvbiB0aGUgY29udGV4dCBzbyBpdCBtYXkgYmUgdXNlZCBpbiB0aGUgZXhwcmVzc2lvbiB3aGVuIHRoZSBldmVudCBpcyB0cmlnZ2VyZWQuXG4gICAgICAgICAgICB2YXIgcHJpb3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKF90aGlzLmNvbnRleHQsICdldmVudCcpO1xuICAgICAgICAgICAgX3RoaXMuY29udGV4dC5ldmVudCA9IGV2ZW50O1xuXG4gICAgICAgICAgICAvLyBMZXQgYW4gb24tW2V2ZW50XSBtYWtlIHRoZSBmdW5jdGlvbiBjYWxsIHdpdGggaXRzIG93biBhcmd1bWVudHNcbiAgICAgICAgICAgIHZhciBsaXN0ZW5lciA9IF90aGlzLm9ic2VydmVyLmdldCgpO1xuXG4gICAgICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICAgICAgaWYgKHR5cGVvZiBsaXN0ZW5lciA9PT0gJ2Z1bmN0aW9uJykgbGlzdGVuZXIuY2FsbChfdGhpcy5jb250ZXh0LCBldmVudCk7XG5cbiAgICAgICAgICAgIC8vIFJlc2V0IHRoZSBjb250ZXh0IHRvIGl0cyBwcmlvciBzdGF0ZVxuICAgICAgICAgICAgaWYgKHByaW9yKSB7XG4gICAgICAgICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShfdGhpcy5jb250ZXh0LCBldmVudCwgcHJpb3IpO1xuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgZGVsZXRlIF90aGlzLmNvbnRleHQuZXZlbnQ7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9KVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXSRcbiAgICogQWRkcyBhIGJpbmRlciB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvZiBlbGVtZW50IHRvIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbi4gVXNlIHRoaXMgd2hlbiB5b3UgZG9uJ3Qgd2FudCBhblxuICAgKiBgPGltZz5gIHRvIHRyeSBhbmQgbG9hZCBpdHMgYHNyY2AgYmVmb3JlIGJlaW5nIGV2YWx1YXRlZC4gVGhpcyBpcyBvbmx5IG5lZWRlZCBvbiB0aGUgaW5kZXguaHRtbCBwYWdlIGFzIHRlbXBsYXRlXG4gICAqIHdpbGwgYmUgcHJvY2Vzc2VkIGJlZm9yZSBiZWluZyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIEdlbmVyYWxseSB5b3UgY2FuIGp1c3QgdXNlIGBhdHRyPVwie3tleHByfX1cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZSBBdHRyaWJ1dGVzOioqXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjJD1cInt7dXNlci5hdmF0YXJVcmx9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGltZyBzcmM9XCJodHRwOi8vY2RuLmV4YW1wbGUuY29tL2F2YXRhcnMvamFjd3JpZ2h0LXNtYWxsLnBuZ1wiPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKiQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIFthdHRyaWJ1dGVdP1xuICAgKiBBZGRzIGEgYmluZGVyIHRvIHRvZ2dsZSBhbiBhdHRyaWJ1dGUgb24gb3Igb2ZmIGlmIHRoZSBleHByZXNzaW9uIGlzIHRydXRoeSBvciBmYWxzZXkuIFVzZSBmb3IgYXR0cmlidXRlcyB3aXRob3V0XG4gICAqIHZhbHVlcyBzdWNoIGFzIGBzZWxlY3RlZGAsIGBkaXNhYmxlZGAsIG9yIGByZWFkb25seWAuIGBjaGVja2VkP2Agd2lsbCB1c2UgMi13YXkgZGF0YWJpbmRpbmcuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNoZWNrZWQ/PVwie3t1c2VyLmlzQWRtaW59fVwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPz1cInt7aXNQcm9jZXNzaW5nfX1cIj5TdWJtaXQ8L2J1dHRvbj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYGlzUHJvY2Vzc2luZ2AgaXMgYHRydWVgIGFuZCBgdXNlci5pc0FkbWluYCBpcyBmYWxzZToqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPklzIEFkbWluaXN0cmF0b3I8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCI+XG4gICAqIDxidXR0b24gZGlzYWJsZWQ+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCcqPycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGF0dHJOYW1lID0gdGhpcy5tYXRjaDtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZShhdHRyTmFtZSwgJycpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQWRkIGEgY2xvbmUgb2YgdGhlIGB2YWx1ZWAgYmluZGVyIGZvciBgY2hlY2tlZD9gIHNvIGNoZWNrYm94ZXMgY2FuIGhhdmUgdHdvLXdheSBiaW5kaW5nIHVzaW5nIGBjaGVja2VkP2AuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NoZWNrZWQ/JywgZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcigndmFsdWUnKSk7XG5cblxuICAvKipcbiAgICogU2hvd3MvaGlkZXMgYW4gZWxlbWVudCBjb25kaXRpb25hbGx5LiBgaWZgIHNob3VsZCBiZSB1c2VkIGluIG1vc3QgY2FzZXMgYXMgaXQgcmVtb3ZlcyB0aGUgZWxlbWVudCBjb21wbGV0ZWx5IGFuZCBpc1xuICAgKiBtb3JlIGVmZmVjaWVudCBzaW5jZSBiaW5kaW5ncyB3aXRoaW4gdGhlIGBpZmAgYXJlIG5vdCBhY3RpdmUgd2hpbGUgaXQgaXMgaGlkZGVuLiBVc2UgYHNob3dgIGZvciB3aGVuIHRoZSBlbGVtZW50XG4gICAqIG11c3QgcmVtYWluIGluLURPTSBvciBiaW5kaW5ncyB3aXRoaW4gaXQgbXVzdCBjb250aW51ZSB0byBiZSBwcm9jZXNzZWQgd2hpbGUgaXQgaXMgaGlkZGVuLiBZb3Ugc2hvdWxkIGRlZmF1bHQgdG9cbiAgICogdXNpbmcgYGlmYC5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnc2hvdycsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgLy8gRm9yIHBlcmZvcm1hbmNlIHByb3ZpZGUgYW4gYWx0ZXJuYXRlIGNvZGUgcGF0aCBmb3IgYW5pbWF0aW9uXG4gICAgICBpZiAodGhpcy5hbmltYXRlICYmIHRoaXMuY29udGV4dCkge1xuICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnVwZGF0ZWRSZWd1bGFyKHZhbHVlKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlZFJlZ3VsYXI6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVkQW5pbWF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuICAgICAgZnVuY3Rpb24gb25GaW5pc2goKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLmxhc3RWYWx1ZSAhPT0gdmFsdWUpIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gICAgICAgIHRoaXMuYW5pbWF0ZUluKHRoaXMuZWxlbWVudCwgb25GaW5pc2gpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5hbmltYXRlT3V0KHRoaXMuZWxlbWVudCwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gICAgICAgICAgb25GaW5pc2guY2FsbCh0aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgICAgIHRoaXMubGFzdFZhbHVlID0gbnVsbDtcbiAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBpZiwgdW5sZXNzLCBlbHNlLWlmLCBlbHNlLXVubGVzcywgZWxzZVxuICAgKiBBZGRzIGEgYmluZGVyIHRvIHNob3cgb3IgaGlkZSB0aGUgZWxlbWVudCBpZiB0aGUgdmFsdWUgaXMgdHJ1dGh5IG9yIGZhbHNleS4gQWN0dWFsbHkgcmVtb3ZlcyB0aGUgZWxlbWVudCBmcm9tIHRoZVxuICAgKiBET00gd2hlbiBoaWRkZW4sIHJlcGxhY2luZyBpdCB3aXRoIGEgbm9uLXZpc2libGUgcGxhY2Vob2xkZXIgYW5kIG5vdCBuZWVkbGVzc2x5IGV4ZWN1dGluZyBiaW5kaW5ncyBpbnNpZGUuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDx1bCBjbGFzcz1cImhlYWRlci1saW5rc1wiPlxuICAgKiAgIDxsaSBpZj1cInVzZXJcIj48YSBocmVmPVwiL2FjY291bnRcIj5NeSBBY2NvdW50PC9hPjwvbGk+XG4gICAqICAgPGxpIHVubGVzcz1cInVzZXJcIj48YSBocmVmPVwiL2xvZ2luXCI+U2lnbiBJbjwvYT48L2xpPlxuICAgKiAgIDxsaSBlbHNlPjxhIGhyZWY9XCIvbG9nb3V0XCI+U2lnbiBPdXQ8L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYHVzZXJgIGlzIG51bGw6KlxuICAgKiBgYGBodG1sXG4gICAqIDx1bCBjbGFzcz1cImhlYWRlci1saW5rc1wiPlxuICAgKiAgIDxsaT48YSBocmVmPVwiL2xvZ2luXCI+U2lnbiBJbjwvYT48L2xpPlxuICAgKiA8L3VsPlxuICAgKiBgYGBcbiAgICovXG4gIHZhciBJZkJpbmRpbmcgPSBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2lmJywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiAxNTAsXG4gICAgdW5sZXNzQXR0ck5hbWU6ICd1bmxlc3MnLFxuICAgIGVsc2VJZkF0dHJOYW1lOiAnZWxzZS1pZicsXG4gICAgZWxzZVVubGVzc0F0dHJOYW1lOiAnZWxzZS11bmxlc3MnLFxuICAgIGVsc2VBdHRyTmFtZTogJ2Vsc2UnLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgICB2YXIgZXhwcmVzc2lvbnMgPSBbIHdyYXBJZkV4cCh0aGlzLmV4cHJlc3Npb24sIHRoaXMubmFtZSA9PT0gdGhpcy51bmxlc3NBdHRyTmFtZSkgXTtcbiAgICAgIHZhciBwbGFjZWhvbGRlciA9IGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKTtcbiAgICAgIHZhciBub2RlID0gZWxlbWVudC5uZXh0RWxlbWVudFNpYmxpbmc7XG4gICAgICB0aGlzLmVsZW1lbnQgPSBwbGFjZWhvbGRlcjtcbiAgICAgIGVsZW1lbnQucGFyZW50Tm9kZS5yZXBsYWNlQ2hpbGQocGxhY2Vob2xkZXIsIGVsZW1lbnQpO1xuXG4gICAgICAvLyBTdG9yZXMgYSB0ZW1wbGF0ZSBmb3IgYWxsIHRoZSBlbGVtZW50cyB0aGF0IGNhbiBnbyBpbnRvIHRoaXMgc3BvdFxuICAgICAgdGhpcy50ZW1wbGF0ZXMgPSBbIGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZShlbGVtZW50KSBdO1xuXG4gICAgICAvLyBQdWxsIG91dCBhbnkgb3RoZXIgZWxlbWVudHMgdGhhdCBhcmUgY2hhaW5lZCB3aXRoIHRoaXMgb25lXG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICB2YXIgbmV4dCA9IG5vZGUubmV4dEVsZW1lbnRTaWJsaW5nO1xuICAgICAgICB2YXIgZXhwcmVzc2lvbjtcbiAgICAgICAgaWYgKG5vZGUuaGFzQXR0cmlidXRlKHRoaXMuZWxzZUlmQXR0ck5hbWUpKSB7XG4gICAgICAgICAgZXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBub2RlLmdldEF0dHJpYnV0ZSh0aGlzLmVsc2VJZkF0dHJOYW1lKSk7XG4gICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh3cmFwSWZFeHAoZXhwcmVzc2lvbiwgZmFsc2UpKTtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmVsc2VJZkF0dHJOYW1lKTtcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmhhc0F0dHJpYnV0ZSh0aGlzLmVsc2VVbmxlc3NBdHRyTmFtZSkpIHtcbiAgICAgICAgICBleHByZXNzaW9uID0gZnJhZ21lbnRzLmNvZGlmeUV4cHJlc3Npb24oJ2F0dHJpYnV0ZScsIG5vZGUuZ2V0QXR0cmlidXRlKHRoaXMuZWxzZVVubGVzc0F0dHJOYW1lKSk7XG4gICAgICAgICAgZXhwcmVzc2lvbnMucHVzaCh3cmFwSWZFeHAoZXhwcmVzc2lvbiwgdHJ1ZSkpO1xuICAgICAgICAgIG5vZGUucmVtb3ZlQXR0cmlidXRlKHRoaXMuZWxzZVVubGVzc0F0dHJOYW1lKTtcbiAgICAgICAgfSBlbHNlIGlmIChub2RlLmhhc0F0dHJpYnV0ZSh0aGlzLmVsc2VBdHRyTmFtZSkpIHtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmVsc2VBdHRyTmFtZSk7XG4gICAgICAgICAgbmV4dCA9IG51bGw7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgYnJlYWs7XG4gICAgICAgIH1cblxuICAgICAgICBub2RlLnJlbW92ZSgpO1xuICAgICAgICB0aGlzLnRlbXBsYXRlcy5wdXNoKGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZShub2RlKSk7XG4gICAgICAgIG5vZGUgPSBuZXh0O1xuICAgICAgfVxuXG4gICAgICAvLyBBbiBleHByZXNzaW9uIHRoYXQgd2lsbCByZXR1cm4gYW4gaW5kZXguIFNvbWV0aGluZyBsaWtlIHRoaXMgYGV4cHIgPyAwIDogZXhwcjIgPyAxIDogZXhwcjMgPyAyIDogM2AuIFRoaXMgd2lsbFxuICAgICAgLy8gYmUgdXNlZCB0byBrbm93IHdoaWNoIHNlY3Rpb24gdG8gc2hvdyBpbiB0aGUgaWYvZWxzZS1pZi9lbHNlIGdyb3VwaW5nLlxuICAgICAgdGhpcy5leHByZXNzaW9uID0gZXhwcmVzc2lvbnMubWFwKGZ1bmN0aW9uKGV4cHIsIGluZGV4KSB7XG4gICAgICAgIHJldHVybiBleHByICsgJyA/ICcgKyBpbmRleCArICcgOiAnO1xuICAgICAgfSkuam9pbignJykgKyBleHByZXNzaW9ucy5sZW5ndGg7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICAvLyBGb3IgcGVyZm9ybWFuY2UgcHJvdmlkZSBhbiBhbHRlcm5hdGUgY29kZSBwYXRoIGZvciBhbmltYXRpb25cbiAgICAgIGlmICh0aGlzLmFuaW1hdGUgJiYgdGhpcy5jb250ZXh0KSB7XG4gICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMudXBkYXRlZFJlZ3VsYXIoaW5kZXgpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBhZGQ6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZSh2aWV3LCB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmcpO1xuICAgIH0sXG5cbiAgICAvLyBEb2Vzbid0IGRvIG11Y2gsIGJ1dCBhbGxvd3Mgc3ViLWNsYXNzZXMgdG8gYWx0ZXIgdGhlIGZ1bmN0aW9uYWxpdHkuXG4gICAgcmVtb3ZlOiBmdW5jdGlvbih2aWV3KSB7XG4gICAgICB2aWV3LmRpc3Bvc2UoKTtcbiAgICB9LFxuXG4gICAgdXBkYXRlZFJlZ3VsYXI6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgIHRoaXMucmVtb3ZlKHRoaXMuc2hvd2luZyk7XG4gICAgICAgIHRoaXMuc2hvd2luZyA9IG51bGw7XG4gICAgICB9XG4gICAgICB2YXIgdGVtcGxhdGUgPSB0aGlzLnRlbXBsYXRlc1tpbmRleF07XG4gICAgICBpZiAodGVtcGxhdGUpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nID0gdGVtcGxhdGUuY3JlYXRlVmlldygpO1xuICAgICAgICB0aGlzLnNob3dpbmcuYmluZCh0aGlzLmNvbnRleHQpO1xuICAgICAgICB0aGlzLmFkZCh0aGlzLnNob3dpbmcpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVkQW5pbWF0ZWQ6IGZ1bmN0aW9uKGluZGV4KSB7XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IGluZGV4O1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIC8vIE9ic29sZXRlZCwgd2lsbCBjaGFuZ2UgYWZ0ZXIgYW5pbWF0aW9uIGlzIGZpbmlzaGVkLlxuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLmFuaW1hdGluZyA9IHRydWU7XG4gICAgICAgIHRoaXMuc2hvd2luZy51bmJpbmQoKTtcbiAgICAgICAgdGhpcy5hbmltYXRlT3V0KHRoaXMuc2hvd2luZywgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcblxuICAgICAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgICAgIC8vIE1ha2Ugc3VyZSB0aGlzIHdhc24ndCB1bmJvdW5kIHdoaWxlIHdlIHdlcmUgYW5pbWF0aW5nIChlLmcuIGJ5IGEgcGFyZW50IGBpZmAgdGhhdCBkb2Vzbid0IGFuaW1hdGUpXG4gICAgICAgICAgICB0aGlzLnJlbW92ZSh0aGlzLnNob3dpbmcpO1xuICAgICAgICAgICAgdGhpcy5zaG93aW5nID0gbnVsbDtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAodGhpcy5jb250ZXh0KSB7XG4gICAgICAgICAgICAvLyBmaW5pc2ggYnkgYW5pbWF0aW5nIHRoZSBuZXcgZWxlbWVudCBpbiAoaWYgYW55KSwgdW5sZXNzIG5vIGxvbmdlciBib3VuZFxuICAgICAgICAgICAgdGhpcy51cGRhdGVkQW5pbWF0ZWQodGhpcy5sYXN0VmFsdWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdmFyIHRlbXBsYXRlID0gdGhpcy50ZW1wbGF0ZXNbaW5kZXhdO1xuICAgICAgaWYgKHRlbXBsYXRlKSB7XG4gICAgICAgIHRoaXMuc2hvd2luZyA9IHRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgICAgdGhpcy5zaG93aW5nLmJpbmQodGhpcy5jb250ZXh0KTtcbiAgICAgICAgdGhpcy5hZGQodGhpcy5zaG93aW5nKTtcbiAgICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLmFuaW1hdGVJbih0aGlzLnNob3dpbmcsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgICAgLy8gaWYgdGhlIHZhbHVlIGNoYW5nZWQgd2hpbGUgdGhpcyB3YXMgYW5pbWF0aW5nIHJ1biBpdCBhZ2FpblxuICAgICAgICAgIGlmICh0aGlzLmxhc3RWYWx1ZSAhPT0gaW5kZXgpIHtcbiAgICAgICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKHRoaXMubGFzdFZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1bmJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5zaG93aW5nLnVuYmluZCgpO1xuICAgICAgfVxuICAgICAgdGhpcy5sYXN0VmFsdWUgPSBudWxsO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xuXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndW5sZXNzJywgSWZCaW5kaW5nKTtcblxuICBmdW5jdGlvbiB3cmFwSWZFeHAoZXhwciwgaXNVbmxlc3MpIHtcbiAgICBpZiAoaXNVbmxlc3MpIHtcbiAgICAgIHJldHVybiAnISgnICsgZXhwciArICcpJztcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGV4cHI7XG4gICAgfVxuICB9XG5cblxuICAvKipcbiAgICogIyMgcmVwZWF0XG4gICAqIEFkZHMgYSBiaW5kZXIgdG8gZHVwbGljYXRlIGFuIGVsZW1lbnQgZm9yIGVhY2ggaXRlbSBpbiBhbiBhcnJheS4gVGhlIGV4cHJlc3Npb24gbWF5IGJlIG9mIHRoZSBmb3JtYXQgYGVweHJgIG9yXG4gICAqIGBpdGVtTmFtZSBpbiBleHByYCB3aGVyZSBgaXRlbU5hbWVgIGlzIHRoZSBuYW1lIGVhY2ggaXRlbSBpbnNpZGUgdGhlIGFycmF5IHdpbGwgYmUgcmVmZXJlbmNlZCBieSB3aXRoaW4gYmluZGluZ3NcbiAgICogaW5zaWRlIHRoZSBlbGVtZW50LlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGVhY2g9XCJ7e3Bvc3QgaW4gcG9zdHN9fVwiIGNsYXNzLWZlYXR1cmVkPVwie3twb3N0LmlzRmVhdHVyZWR9fVwiPlxuICAgKiAgIDxoMT57e3Bvc3QudGl0bGV9fTwvaDE+XG4gICAqICAgPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdCBpZiB0aGVyZSBhcmUgMiBwb3N0cyBhbmQgdGhlIGZpcnN0IG9uZSBpcyBmZWF0dXJlZDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cImZlYXR1cmVkXCI+XG4gICAqICAgPGgxPkxpdHRsZSBSZWQ8L2gxPlxuICAgKiAgIDxkaXY+XG4gICAqICAgICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgICAgPC9wPlxuICAgKiAgIDwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogPGRpdj5cbiAgICogICA8aDE+QmlnIEJsdWU8L2gxPlxuICAgKiAgIDxkaXY+XG4gICAqICAgICA8cD5Tb21lIHRob3VnaHRzIG9uIHRoZSBOZXcgWW9yayBHaWFudHMuPC9wPlxuICAgKiAgICAgPHA+XG4gICAqICAgICAgIE1vcmUgaW5mbyBjYW4gYmUgZm91bmQgb25cbiAgICogICAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTmV3X1lvcmtfR2lhbnRzXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgICAgPC9wPlxuICAgKiAgIDwvZGl2PlxuICAgKiA8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3JlcGVhdCcsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogMTAwLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIHBhcmVudCA9IHRoaXMuZWxlbWVudC5wYXJlbnROb2RlO1xuICAgICAgdmFyIHBsYWNlaG9sZGVyID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpO1xuICAgICAgcGFyZW50Lmluc2VydEJlZm9yZShwbGFjZWhvbGRlciwgdGhpcy5lbGVtZW50KTtcbiAgICAgIHRoaXMudGVtcGxhdGUgPSBmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUodGhpcy5lbGVtZW50KTtcbiAgICAgIHRoaXMuZWxlbWVudCA9IHBsYWNlaG9sZGVyO1xuXG4gICAgICB2YXIgcGFydHMgPSB0aGlzLmV4cHJlc3Npb24uc3BsaXQoL1xccytpblxccysvKTtcbiAgICAgIHRoaXMuZXhwcmVzc2lvbiA9IHBhcnRzLnBvcCgpO1xuICAgICAgdmFyIGtleSA9IHBhcnRzLnBvcCgpO1xuICAgICAgaWYgKGtleSkge1xuICAgICAgICBwYXJ0cyA9IGtleS5zcGxpdCgvXFxzKixcXHMqLyk7XG4gICAgICAgIHRoaXMudmFsdWVOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICAgIHRoaXMua2V5TmFtZSA9IHBhcnRzLnBvcCgpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMudmlld3MgPSBbXTtcbiAgICAgIHRoaXMub2JzZXJ2ZXIuZ2V0Q2hhbmdlUmVjb3JkcyA9IHRydWU7XG4gICAgfSxcblxuICAgIHJlbW92ZVZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgIHZpZXcuZGlzcG9zZSgpO1xuICAgICAgdmlldy5fcmVwZWF0SXRlbV8gPSBudWxsO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSwgb2xkVmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIGlmICghY2hhbmdlcyB8fCAhdGhpcy5jb250ZXh0KSB7XG4gICAgICAgIHRoaXMucG9wdWxhdGUodmFsdWUpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgaWYgKHRoaXMuYW5pbWF0ZSkge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHZhbHVlLCBjaGFuZ2VzKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZUNoYW5nZXModmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8vIE1ldGhvZCBmb3IgY3JlYXRpbmcgYW5kIHNldHRpbmcgdXAgbmV3IHZpZXdzIGZvciBvdXIgbGlzdFxuICAgIGNyZWF0ZVZpZXc6IGZ1bmN0aW9uKGtleSwgdmFsdWUpIHtcbiAgICAgIHZhciB2aWV3ID0gdGhpcy50ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICB2YXIgY29udGV4dCA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMudmFsdWVOYW1lKSB7XG4gICAgICAgIGNvbnRleHQgPSBPYmplY3QuY3JlYXRlKHRoaXMuY29udGV4dCk7XG4gICAgICAgIGlmICh0aGlzLmtleU5hbWUpIGNvbnRleHRbdGhpcy5rZXlOYW1lXSA9IGtleTtcbiAgICAgICAgY29udGV4dFt0aGlzLnZhbHVlTmFtZV0gPSB2YWx1ZTtcbiAgICAgICAgY29udGV4dC5fb3JpZ0NvbnRleHRfID0gdGhpcy5jb250ZXh0Lmhhc093blByb3BlcnR5KCdfb3JpZ0NvbnRleHRfJylcbiAgICAgICAgICA/IHRoaXMuY29udGV4dC5fb3JpZ0NvbnRleHRfXG4gICAgICAgICAgOiB0aGlzLmNvbnRleHQ7XG4gICAgICB9XG4gICAgICB2aWV3LmJpbmQoY29udGV4dCk7XG4gICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IHZhbHVlO1xuICAgICAgcmV0dXJuIHZpZXc7XG4gICAgfSxcblxuICAgIHBvcHVsYXRlOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnZpZXdzLmxlbmd0aCkge1xuICAgICAgICB0aGlzLnZpZXdzLmZvckVhY2godGhpcy5yZW1vdmVWaWV3KTtcbiAgICAgICAgdGhpcy52aWV3cy5sZW5ndGggPSAwO1xuICAgICAgfVxuXG4gICAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgdmFsdWUubGVuZ3RoKSB7XG4gICAgICAgIHZhciBmcmFnID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuXG4gICAgICAgIHZhbHVlLmZvckVhY2goZnVuY3Rpb24oaXRlbSwgaW5kZXgpIHtcbiAgICAgICAgICB2YXIgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpbmRleCwgaXRlbSk7XG4gICAgICAgICAgdGhpcy52aWV3cy5wdXNoKHZpZXcpO1xuICAgICAgICAgIGZyYWcuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH0sIHRoaXMpO1xuXG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnLCB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmcpO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICAvKipcbiAgICAgKiBUaGlzIHVuLWFuaW1hdGVkIHZlcnNpb24gcmVtb3ZlcyBhbGwgcmVtb3ZlZCB2aWV3cyBmaXJzdCBzbyB0aGV5IGNhbiBiZSByZXR1cm5lZCB0byB0aGUgcG9vbCBhbmQgdGhlbiBhZGRzIG5ld1xuICAgICAqIHZpZXdzIGJhY2sgaW4uIFRoaXMgaXMgdGhlIG1vc3Qgb3B0aW1hbCBtZXRob2Qgd2hlbiBub3QgYW5pbWF0aW5nLlxuICAgICAqL1xuICAgIHVwZGF0ZUNoYW5nZXM6IGZ1bmN0aW9uKHZhbHVlLCBjaGFuZ2VzKSB7XG4gICAgICAvLyBSZW1vdmUgZXZlcnl0aGluZyBmaXJzdCwgdGhlbiBhZGQgYWdhaW4sIGFsbG93aW5nIGZvciBlbGVtZW50IHJldXNlIGZyb20gdGhlIHBvb2xcbiAgICAgIHZhciBhZGRlZENvdW50ID0gMDtcblxuICAgICAgY2hhbmdlcy5mb3JFYWNoKGZ1bmN0aW9uKHNwbGljZSkge1xuICAgICAgICBhZGRlZENvdW50ICs9IHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICBpZiAoIXNwbGljZS5yZW1vdmVkLmxlbmd0aCkge1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcmVtb3ZlZCA9IHRoaXMudmlld3Muc3BsaWNlKHNwbGljZS5pbmRleCAtIGFkZGVkQ291bnQsIHNwbGljZS5yZW1vdmVkLmxlbmd0aCk7XG4gICAgICAgIHJlbW92ZWQuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIC8vIEFkZCB0aGUgbmV3L21vdmVkIHZpZXdzXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIGlmICghc3BsaWNlLmFkZGVkQ291bnQpIHJldHVybjtcbiAgICAgICAgdmFyIGFkZGVkVmlld3MgPSBbXTtcbiAgICAgICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgICB2YXIgaW5kZXggPSBzcGxpY2UuaW5kZXg7XG4gICAgICAgIHZhciBlbmRJbmRleCA9IGluZGV4ICsgc3BsaWNlLmFkZGVkQ291bnQ7XG5cbiAgICAgICAgZm9yICh2YXIgaSA9IGluZGV4OyBpIDwgZW5kSW5kZXg7IGkrKykge1xuICAgICAgICAgIHZhciBpdGVtID0gdmFsdWVbaV07XG4gICAgICAgICAgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpLCBpdGVtKTtcbiAgICAgICAgICBhZGRlZFZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cy5zcGxpY2UuYXBwbHkodGhpcy52aWV3cywgWyBpbmRleCwgMCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgYW5pbWF0ZWQgdmVyc2lvbiBtdXN0IGFuaW1hdGUgcmVtb3ZlZCBub2RlcyBvdXQgd2hpbGUgYWRkZWQgbm9kZXMgYXJlIGFuaW1hdGluZyBpbiBtYWtpbmcgaXQgbGVzcyBvcHRpbWFsXG4gICAgICogKGJ1dCBjb29sIGxvb2tpbmcpLiBJdCBhbHNvIGhhbmRsZXMgXCJtb3ZlXCIgYW5pbWF0aW9ucyBmb3Igbm9kZXMgd2hpY2ggYXJlIG1vdmluZyBwbGFjZSB3aXRoaW4gdGhlIGxpc3QuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlc0FuaW1hdGVkOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgYW5pbWF0aW5nVmFsdWUgPSB2YWx1ZS5zbGljZSgpO1xuICAgICAgdmFyIGFsbEFkZGVkID0gW107XG4gICAgICB2YXIgYWxsUmVtb3ZlZCA9IFtdO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuXG4gICAgICAvLyBSdW4gdXBkYXRlcyB3aGljaCBvY2N1cmVkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZy5cbiAgICAgIGZ1bmN0aW9uIHdoZW5Eb25lKCkge1xuICAgICAgICAvLyBUaGUgbGFzdCBhbmltYXRpb24gZmluaXNoZWQgd2lsbCBydW4gdGhpc1xuICAgICAgICBpZiAoLS13aGVuRG9uZS5jb3VudCAhPT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuXG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcpIHtcbiAgICAgICAgICB2YXIgY2hhbmdlcyA9IGRpZmYuYXJyYXlzKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgYW5pbWF0aW5nVmFsdWUpO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgY2hhbmdlcyk7XG4gICAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgd2hlbkRvbmUuY291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICB2YXIgcmVtb3ZlZENvdW50ID0gc3BsaWNlLnJlbW92ZWQubGVuZ3RoO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIGFkZGVkVmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZW1vdmVkVmlld3MgPSB0aGlzLnZpZXdzLnNwbGljZS5hcHBseSh0aGlzLnZpZXdzLCBbIGluZGV4LCByZW1vdmVkQ291bnQgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5leHRTaWJsaW5nKTtcblxuICAgICAgICBhbGxBZGRlZCA9IGFsbEFkZGVkLmNvbmNhdChhZGRlZFZpZXdzKTtcbiAgICAgICAgYWxsUmVtb3ZlZCA9IGFsbFJlbW92ZWQuY29uY2F0KHJlbW92ZWRWaWV3cyk7XG4gICAgICB9LCB0aGlzKTtcblxuXG4gICAgICBhbGxBZGRlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odmlldywgd2hlbkRvbmUpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgIHdoZW5Eb25lLmNvdW50Kys7XG4gICAgICAgIHZpZXcudW5iaW5kKCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh2aWV3LCB3aGVuRG9uZSk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLnZpZXdzLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICB2aWV3LnVuYmluZCgpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSBudWxsO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG5cbi8qKlxuICogIyBEZWZhdWx0IEZvcm1hdHRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGZvcm1hdHRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3Rva2VuTGlzdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiB2IFRPRE8gdlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzdHlsZXMnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZmlsdGVyXG4gICAqIEZpbHRlcnMgYW4gYXJyYXkgYnkgdGhlIGdpdmVuIGZpbHRlciBmdW5jdGlvbihzKSwgbWF5IHByb3ZpZGUgYSBmdW5jdGlvbiwgYW5cbiAgICogYXJyYXksIG9yIGFuIG9iamVjdCB3aXRoIGZpbHRlcmluZyBmdW5jdGlvbnNcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmlsdGVyJywgZnVuY3Rpb24odmFsdWUsIGZpbHRlckZ1bmMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmICghZmlsdGVyRnVuYykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZmlsdGVyRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGZpbHRlckZ1bmMpKSB7XG4gICAgICBmaWx0ZXJGdW5jLmZvckVhY2goZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdvYmplY3QnKSB7XG4gICAgICBPYmplY3Qua2V5cyhmaWx0ZXJGdW5jKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICB2YXIgZnVuYyA9IGZpbHRlckZ1bmNba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG1hcFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIG1hcCBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gbWFwcGluZyBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdtYXAnLCBmdW5jdGlvbih2YWx1ZSwgbWFwRnVuYykge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChtYXBGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hcEZ1bmMuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdyZWR1Y2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIHJlZHVjZUZ1bmMoaW5pdGlhbFZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzbGljZScsIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgZW5kSW5kZXgpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zbGljZShpbmRleCwgZW5kSW5kZXgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBkYXRlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gZm9ybWF0IGRhdGVzIGFuZCBzdHJpbmdzXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS50b0xvY2FsZVN0cmluZygpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsb2dcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsb2cgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLCB1c2VmdWwgZm9yIGRlYnVnZ2luZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsb2cnLCBmdW5jdGlvbih2YWx1ZSwgcHJlZml4KSB7XG4gICAgaWYgKHByZWZpeCA9PSBudWxsKSBwcmVmaXggPSAnTG9nOic7XG4gICAgY29uc29sZS5sb2cocHJlZml4LCB2YWx1ZSk7XG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsaW1pdFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxpbWl0IHRoZSBsZW5ndGggb2YgYW4gYXJyYXkgb3Igc3RyaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xpbWl0JywgZnVuY3Rpb24odmFsdWUsIGxpbWl0KSB7XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5zbGljZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGxpbWl0IDwgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UobGltaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUuc2xpY2UoMCwgbGltaXQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBzb3J0XG4gICAqIFNvcnRzIGFuIGFycmF5IGdpdmVuIGEgZmllbGQgbmFtZSBvciBzb3J0IGZ1bmN0aW9uLCBhbmQgYSBkaXJlY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc29ydCcsIGZ1bmN0aW9uKHZhbHVlLCBzb3J0RnVuYywgZGlyKSB7XG4gICAgaWYgKCFzb3J0RnVuYyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgZGlyID0gKGRpciA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICBpZiAodHlwZW9mIHNvcnRGdW5jID09PSAnc3RyaW5nJykge1xuICAgICAgdmFyIHBhcnRzID0gc29ydEZ1bmMuc3BsaXQoJzonKTtcbiAgICAgIHZhciBwcm9wID0gcGFydHNbMF07XG4gICAgICB2YXIgZGlyMiA9IHBhcnRzWzFdO1xuICAgICAgZGlyMiA9IChkaXIyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgICAgZGlyID0gZGlyIHx8IGRpcjI7XG4gICAgICB2YXIgc29ydEZ1bmMgPSBmdW5jdGlvbihhLCBiKSB7XG4gICAgICAgIGlmIChhW3Byb3BdID4gYltwcm9wXSkgcmV0dXJuIGRpcjtcbiAgICAgICAgaWYgKGFbcHJvcF0gPCBiW3Byb3BdKSByZXR1cm4gLWRpcjtcbiAgICAgICAgcmV0dXJuIDA7XG4gICAgICB9O1xuICAgIH0gZWxzZSBpZiAoZGlyID09PSAtMSkge1xuICAgICAgdmFyIG9yaWdGdW5jID0gc29ydEZ1bmM7XG4gICAgICBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHsgcmV0dXJuIC1vcmlnRnVuYyhhLCBiKTsgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gdmFsdWUuc2xpY2UoKS5zb3J0KHNvcnRGdW5jKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYWRkUXVlcnlcbiAgICogVGFrZXMgdGhlIGlucHV0IFVSTCBhbmQgYWRkcyAob3IgcmVwbGFjZXMpIHRoZSBmaWVsZCBpbiB0aGUgcXVlcnlcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignYWRkUXVlcnknLCBmdW5jdGlvbih2YWx1ZSwgcXVlcnlGaWVsZCwgcXVlcnlWYWx1ZSkge1xuICAgIHZhciB1cmwgPSB2YWx1ZSB8fCBsb2NhdGlvbi5ocmVmO1xuICAgIHZhciBwYXJ0cyA9IHVybC5zcGxpdCgnPycpO1xuICAgIHVybCA9IHBhcnRzWzBdO1xuICAgIHZhciBxdWVyeSA9IHBhcnRzWzFdO1xuICAgIHZhciBhZGRlZFF1ZXJ5ID0gJyc7XG4gICAgaWYgKHF1ZXJ5VmFsdWUgIT0gbnVsbCkge1xuICAgICAgYWRkZWRRdWVyeSA9IHF1ZXJ5RmllbGQgKyAnPScgKyBlbmNvZGVVUklDb21wb25lbnQocXVlcnlWYWx1ZSk7XG4gICAgfVxuXG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB2YXIgZXhwciA9IG5ldyBSZWdFeHAoJ1xcXFxiJyArIHF1ZXJ5RmllbGQgKyAnPVteJl0qJyk7XG4gICAgICBpZiAoZXhwci50ZXN0KHF1ZXJ5KSkge1xuICAgICAgICBxdWVyeSA9IHF1ZXJ5LnJlcGxhY2UoZXhwciwgYWRkZWRRdWVyeSk7XG4gICAgICB9IGVsc2UgaWYgKGFkZGVkUXVlcnkpIHtcbiAgICAgICAgcXVlcnkgKz0gJyYnICsgYWRkZWRRdWVyeTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcXVlcnkgPSBhZGRlZFF1ZXJ5O1xuICAgIH1cbiAgICBpZiAocXVlcnkpIHtcbiAgICAgIHVybCArPSAnPycgKyBxdWVyeTtcbiAgICB9XG4gICAgcmV0dXJuIHVybDtcbiAgfSk7XG5cblxuICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2JylcbiAgZnVuY3Rpb24gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgZGl2LmlubmVySFRNTCA9IHZhbHVlO1xuICAgICAgcmV0dXJuIGRpdi50ZXh0Q29udGVudDtcbiAgICB9IGVsc2Uge1xuICAgICAgZGl2LnRleHRDb250ZW50ID0gdmFsdWUgfHwgJyc7XG4gICAgICByZXR1cm4gZGl2LmlubmVySFRNTDtcbiAgICB9XG4gIH1cblxuXG4gIC8qKlxuICAgKiAjIyBlc2NhcGVcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQuIEZvciB1c2Ugd2l0aCBvdGhlciBIVE1MLWFkZGluZyBmb3JtYXR0ZXJzIHN1Y2ggYXMgYXV0b2xpbmsuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2VzY2FwZScsIGVzY2FwZUhUTUwpO1xuXG5cbiAgLyoqXG4gICAqICMjIHBcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgd3JhcHBpbmcgcGFyYWdyYXBocyBpbiA8cD4gdGFncy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBwIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PjxwPkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L3A+XG4gICAqIDxwPkl0J3MgZ3JlYXQ8L3A+PC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdwJywgZnVuY3Rpb24odmFsdWUsIHNldHRlcikge1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIHJldHVybiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbGluZXMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICB2YXIgZXNjYXBlZCA9IGxpbmVzLm1hcChmdW5jdGlvbihsaW5lKSB7IHJldHVybiBlc2NhcGVIVE1MKGxpbmUpIHx8ICc8YnI+JzsgfSk7XG4gICAgICByZXR1cm4gJzxwPicgKyBlc2NhcGVkLmpvaW4oJzwvcD5cXG48cD4nKSArICc8L3A+JztcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGJyXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IGFkZGluZyA8YnI+IHRhZ3MgaW4gcGxhY2Ugb2YgbmV3bGluZXMgY2hhcmFjdGVycy5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBiciB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdicicsIGZ1bmN0aW9uKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICByZXR1cm4gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGxpbmVzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+XFxuJyk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBuZXdsaW5lXG4gICAqIEhUTUwgZXNjYXBlcyBjb250ZW50IGFkZGluZyA8cD4gdGFncyBhdCBkb3VibGUgbmV3bGluZXMgYW5kIDxicj4gdGFncyBpbiBwbGFjZSBvZiBzaW5nbGUgbmV3bGluZSBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IG5ld2xpbmUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+PHA+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITxicj5cbiAgICogSXQncyBncmVhdDwvcD48L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ25ld2xpbmUnLCBmdW5jdGlvbih2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgcmV0dXJuIGVzY2FwZUhUTUwodmFsdWUsIHNldHRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBwYXJhZ3JhcGhzID0gKHZhbHVlIHx8ICcnKS5zcGxpdCgvXFxyP1xcblxccypcXHI/XFxuLyk7XG4gICAgICB2YXIgZXNjYXBlZCA9IHBhcmFncmFwaHMubWFwKGZ1bmN0aW9uKHBhcmFncmFwaCkge1xuICAgICAgICB2YXIgbGluZXMgPSBwYXJhZ3JhcGguc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgICAgcmV0dXJuIGxpbmVzLm1hcChlc2NhcGVIVE1MKS5qb2luKCc8YnI+XFxuJyk7XG4gICAgICB9KTtcbiAgICAgIHJldHVybiAnPHA+JyArIGVzY2FwZWQuam9pbignPC9wPlxcblxcbjxwPicpICsgJzwvcD4nO1xuICAgIH1cbiAgfSk7XG5cblxuXG4gIHZhciB1cmxFeHAgPSAvKF58XFxzfFxcKCkoKD86aHR0cHM/fGZ0cCk6XFwvXFwvW1xcLUEtWjAtOStcXHUwMDI2QCNcXC8lPz0oKX5ffCE6LC47XSpbXFwtQS1aMC05K1xcdTAwMjZAI1xcLyU9fihffF0pL2dpO1xuICB2YXIgd3d3RXhwID0gLyhefFteXFwvXSkod3d3XFwuW1xcU10rXFwuXFx3ezIsfShcXGJ8JCkpL2dpbTtcbiAgLyoqXG4gICAqICMjIGF1dG9saW5rXG4gICAqIEFkZHMgYXV0b21hdGljIGxpbmtzIHRvIGVzY2FwZWQgY29udGVudCAoYmUgc3VyZSB0byBlc2NhcGUgdXNlciBjb250ZW50KS4gQ2FuIGJlIHVzZWQgb24gZXhpc3RpbmcgSFRNTCBjb250ZW50IGFzIGl0XG4gICAqIHdpbGwgc2tpcCBVUkxzIHdpdGhpbiBIVE1MIHRhZ3MuIFBhc3NpbmcgdHJ1ZSBpbiB0aGUgc2Vjb25kIHBhcmFtZXRlciB3aWxsIHNldCB0aGUgdGFyZ2V0IHRvIGBfYmxhbmtgLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGVzY2FwZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdhdXRvbGluaycsIGZ1bmN0aW9uKHZhbHVlLCB0YXJnZXQpIHtcbiAgICB0YXJnZXQgPSAodGFyZ2V0KSA/ICcgdGFyZ2V0PVwiX2JsYW5rXCInIDogJyc7XG5cbiAgICByZXR1cm4gKCcnICsgdmFsdWUpLnJlcGxhY2UoLzxbXj5dKz58W148XSsvZywgZnVuY3Rpb24obWF0Y2gpIHtcbiAgICAgIGlmIChtYXRjaC5jaGFyQXQoMCkgPT09ICc8Jykge1xuICAgICAgICByZXR1cm4gbWF0Y2g7XG4gICAgICB9XG4gICAgICB2YXIgcmVwbGFjZWRUZXh0ID0gbWF0Y2gucmVwbGFjZSh1cmxFeHAsICckMTxhIGhyZWY9XCIkMlwiJyArIHRhcmdldCArICc+JDI8L2E+Jyk7XG4gICAgICByZXR1cm4gcmVwbGFjZWRUZXh0LnJlcGxhY2Uod3d3RXhwLCAnJDE8YSBocmVmPVwiaHR0cDovLyQyXCInICsgdGFyZ2V0ICsgJz4kMjwvYT4nKTtcbiAgICB9KTtcbiAgfSk7XG5cblxuICAvKipcbiAgICpcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignaW50JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YWx1ZSA9IHBhcnNlSW50KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdmbG9hdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFsdWUgPSBwYXJzZUZsb2F0KHZhbHVlKTtcbiAgICByZXR1cm4gaXNOYU4odmFsdWUpID8gbnVsbCA6IHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdib29sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICByZXR1cm4gdmFsdWUgJiYgdmFsdWUgIT09ICcwJyAmJiB2YWx1ZSAhPT0gJ2ZhbHNlJztcbiAgfSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFRlbXBsYXRlO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG5cblxuLyoqXG4gKiAjIyBUZW1wbGF0ZVxuICogVGFrZXMgYW4gSFRNTCBzdHJpbmcsIGFuIGVsZW1lbnQsIGFuIGFycmF5IG9mIGVsZW1lbnRzLCBvciBhIGRvY3VtZW50IGZyYWdtZW50LCBhbmQgY29tcGlsZXMgaXQgaW50byBhIHRlbXBsYXRlLlxuICogSW5zdGFuY2VzIG1heSB0aGVuIGJlIGNyZWF0ZWQgYW5kIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gKiBmcm9tIG1hbnkgZGlmZmVyZW50IHR5cGVzIG9mIG9iamVjdHMuIEFueSBvZiB0aGVzZSB3aWxsIGJlIGNvbnZlcnRlZCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQgZm9yIHRoZSB0ZW1wbGF0ZSB0b1xuICogY2xvbmUuIE5vZGVzIGFuZCBlbGVtZW50cyBwYXNzZWQgaW4gd2lsbCBiZSByZW1vdmVkIGZyb20gdGhlIERPTS5cbiAqL1xuZnVuY3Rpb24gVGVtcGxhdGUoKSB7XG4gIHRoaXMucG9vbCA9IFtdO1xufVxuXG5cblRlbXBsYXRlLnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogQ3JlYXRlcyBhIG5ldyB2aWV3IGNsb25lZCBmcm9tIHRoaXMgdGVtcGxhdGUuXG4gICAqL1xuICBjcmVhdGVWaWV3OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5wb29sLmxlbmd0aCkge1xuICAgICAgcmV0dXJuIHRoaXMucG9vbC5wb3AoKTtcbiAgICB9XG5cbiAgICByZXR1cm4gZXh0ZW5kLm1ha2UoVmlldywgZG9jdW1lbnQuaW1wb3J0Tm9kZSh0aGlzLCB0cnVlKSwgdGhpcyk7XG4gIH0sXG5cbiAgcmV0dXJuVmlldzogZnVuY3Rpb24odmlldykge1xuICAgIGlmICh0aGlzLnBvb2wuaW5kZXhPZih2aWV3KSA9PT0gLTEpIHtcbiAgICAgIHRoaXMucG9vbC5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxufTtcbiIsIi8vIEhlbHBlciBtZXRob2RzIGZvciBhbmltYXRpb25cbmV4cG9ydHMubWFrZUVsZW1lbnRBbmltYXRhYmxlID0gbWFrZUVsZW1lbnRBbmltYXRhYmxlO1xuZXhwb3J0cy5nZXRDb21wdXRlZENTUyA9IGdldENvbXB1dGVkQ1NTO1xuZXhwb3J0cy5hbmltYXRlRWxlbWVudCA9IGFuaW1hdGVFbGVtZW50O1xuXG5mdW5jdGlvbiBtYWtlRWxlbWVudEFuaW1hdGFibGUoZWxlbWVudCkge1xuICAvLyBBZGQgcG9seWZpbGwganVzdCBvbiB0aGlzIGVsZW1lbnRcbiAgaWYgKCFlbGVtZW50LmFuaW1hdGUpIHtcbiAgICBlbGVtZW50LmFuaW1hdGUgPSBhbmltYXRlRWxlbWVudDtcbiAgfVxuXG4gIC8vIE5vdCBhIHBvbHlmaWxsIGJ1dCBhIGhlbHBlclxuICBpZiAoIWVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MpIHtcbiAgICBlbGVtZW50LmdldENvbXB1dGVkQ1NTID0gZ2V0Q29tcHV0ZWRDU1M7XG4gIH1cblxuICByZXR1cm4gZWxlbWVudDtcbn1cblxuLyoqXG4gKiBHZXQgdGhlIGNvbXB1dGVkIHN0eWxlIG9uIGFuIGVsZW1lbnQuXG4gKi9cbmZ1bmN0aW9uIGdldENvbXB1dGVkQ1NTKHN0eWxlTmFtZSkge1xuICBpZiAodGhpcy5vd25lckRvY3VtZW50LmRlZmF1bHRWaWV3Lm9wZW5lcikge1xuICAgIHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcuZ2V0Q29tcHV0ZWRTdHlsZSh0aGlzKVtzdHlsZU5hbWVdO1xuICB9XG4gIHJldHVybiB3aW5kb3cuZ2V0Q29tcHV0ZWRTdHlsZSh0aGlzKVtzdHlsZU5hbWVdO1xufVxuXG4vKipcbiAqIFZlcnkgYmFzaWMgcG9seWZpbGwgZm9yIEVsZW1lbnQuYW5pbWF0ZSBpZiBpdCBkb2Vzbid0IGV4aXN0LiBJZiBpdCBkb2VzLCB1c2UgdGhlIG5hdGl2ZS5cbiAqIFRoaXMgb25seSBzdXBwb3J0cyB0d28gY3NzIHN0YXRlcy4gSXQgd2lsbCBvdmVyd3JpdGUgZXhpc3Rpbmcgc3R5bGVzLiBJdCBkb2Vzbid0IHJldHVybiBhbiBhbmltYXRpb24gcGxheSBjb250cm9sLiBJdFxuICogb25seSBzdXBwb3J0cyBkdXJhdGlvbiwgZGVsYXksIGFuZCBlYXNpbmcuIFJldHVybnMgYW4gb2JqZWN0IHdpdGggYSBwcm9wZXJ0eSBvbmZpbmlzaC5cbiAqL1xuZnVuY3Rpb24gYW5pbWF0ZUVsZW1lbnQoY3NzLCBvcHRpb25zKSB7XG4gIGlmICghQXJyYXkuaXNBcnJheShjc3MpIHx8IGNzcy5sZW5ndGggIT09IDIpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdhbmltYXRlIHBvbHlmaWxsIHJlcXVpcmVzIGFuIGFycmF5IGZvciBjc3Mgd2l0aCBhbiBpbml0aWFsIGFuZCBmaW5hbCBzdGF0ZScpO1xuICB9XG5cbiAgaWYgKCFvcHRpb25zIHx8ICFvcHRpb25zLmhhc093blByb3BlcnR5KCdkdXJhdGlvbicpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYW5pbWF0ZSBwb2x5ZmlsbCByZXF1aXJlcyBvcHRpb25zIHdpdGggYSBkdXJhdGlvbicpO1xuICB9XG5cbiAgdmFyIGR1cmF0aW9uID0gb3B0aW9ucy5kdXJhdGlvbiB8fCAwO1xuICB2YXIgZGVsYXkgPSBvcHRpb25zLmRlbGF5IHx8IDA7XG4gIHZhciBlYXNpbmcgPSBvcHRpb25zLmVhc2luZztcbiAgdmFyIGluaXRpYWxDc3MgPSBjc3NbMF07XG4gIHZhciBmaW5hbENzcyA9IGNzc1sxXTtcbiAgdmFyIGFsbENzcyA9IHt9O1xuICB2YXIgcGxheWJhY2sgPSB7IG9uZmluaXNoOiBudWxsIH07XG5cbiAgT2JqZWN0LmtleXMoaW5pdGlhbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gaW5pdGlhbENzc1trZXldO1xuICB9KTtcblxuICAvLyB0cmlnZ2VyIHJlZmxvd1xuICBlbGVtZW50Lm9mZnNldFdpZHRoO1xuXG4gIHZhciB0cmFuc2l0aW9uT3B0aW9ucyA9ICcgJyArIGR1cmF0aW9uICsgJ21zJztcbiAgaWYgKGVhc2luZykge1xuICAgIHRyYW5zaXRpb25PcHRpb25zICs9ICcgJyArIGVhc2luZztcbiAgfVxuICBpZiAoZGVsYXkpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBkZWxheSArICdtcyc7XG4gIH1cblxuICBlbGVtZW50LnN0eWxlLnRyYW5zaXRpb24gPSBPYmplY3Qua2V5cyhmaW5hbENzcykubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiBrZXkgKyB0cmFuc2l0aW9uT3B0aW9uc1xuICB9KS5qb2luKCcsICcpO1xuXG4gIE9iamVjdC5rZXlzKGZpbmFsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIGFsbENzc1trZXldID0gdHJ1ZTtcbiAgICBlbGVtZW50LnN0eWxlW2tleV0gPSBmaW5hbENzc1trZXldO1xuICB9KTtcblxuICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgIE9iamVjdC5rZXlzKGFsbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9ICcnO1xuICAgIH0pO1xuXG4gICAgaWYgKHBsYXliYWNrLm9uZmluaXNoKSB7XG4gICAgICBwbGF5YmFjay5vbmZpbmlzaCgpO1xuICAgIH1cbiAgfSwgZHVyYXRpb24gKyBkZWxheSk7XG5cbiAgcmV0dXJuIHBsYXliYWNrO1xufVxuIiwidmFyIGdsb2JhbCA9IChmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMgfSkoKTtcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kO1xuZXh0ZW5kLm1ha2UgPSBtYWtlO1xuXG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBwcm90b3R5cGUgZm9yIHRoZSBnaXZlbiBjb250cnVjdG9yIGFuZCBzZXRzIGFuIGBleHRlbmRgIG1ldGhvZCBvbiBpdC4gSWYgYGV4dGVuZGAgaXMgY2FsbGVkIGZyb20gYVxuICogaXQgd2lsbCBleHRlbmQgdGhhdCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZXh0ZW5kKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpIHtcbiAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzID09PSBnbG9iYWwgPyBPYmplY3QgOiB0aGlzO1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nICYmICFwcm90b3R5cGUpIHtcbiAgICBwcm90b3R5cGUgPSBjb25zdHJ1Y3RvcjtcbiAgICBjb25zdHJ1Y3RvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbiAgY29uc3RydWN0b3IuZXh0ZW5kID0gZXh0ZW5kO1xuICB2YXIgZGVzY3JpcHRvcnMgPSBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKTtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckNsYXNzLnByb3RvdHlwZSwgZGVzY3JpcHRvcnMpO1xuICByZXR1cm4gY29uc3RydWN0b3I7XG59XG5cblxuLyoqXG4gKiBNYWtlcyBhIG5hdGl2ZSBvYmplY3QgcHJldGVuZCB0byBiZSBhIGNsYXNzIChlLmcuIGFkZHMgbWV0aG9kcyB0byBhIERvY3VtZW50RnJhZ21lbnQgYW5kIGNhbGxzIHRoZSBjb25zdHJ1Y3RvcikuXG4gKi9cbmZ1bmN0aW9uIG1ha2UoY29uc3RydWN0b3IsIG9iamVjdCkge1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZSBtdXN0IGFjY2VwdCBhIGZ1bmN0aW9uIGNvbnN0cnVjdG9yIGFuZCBhbiBvYmplY3QnKTtcbiAgfVxuICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgdmFyIHByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICBmb3IgKHZhciBrZXkgaW4gcHJvdG8pIHtcbiAgICBvYmplY3Rba2V5XSA9IHByb3RvW2tleV07XG4gIH1cbiAgY29uc3RydWN0b3IuYXBwbHkob2JqZWN0LCBhcmdzKTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuXG5mdW5jdGlvbiBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBkZXNjcmlwdG9ycyA9IHtcbiAgICBjb25zdHJ1Y3RvcjogeyB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogY29uc3RydWN0b3IgfVxuICB9O1xuXG4gIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbmFtZSk7XG4gICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZmFsc2U7XG4gICAgZGVzY3JpcHRvcnNbbmFtZV0gPSBkZXNjcmlwdG9yO1xuICB9KTtcbiAgcmV0dXJuIGRlc2NyaXB0b3JzO1xufVxuIiwiXG5cblxuLy8gUG9seWZpbGwgbWF0Y2hlc1xuaWYgKCFFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzKSB7XG4gIEVsZW1lbnQucHJvdG90eXBlLm1hdGNoZXMgPVxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLndlYmtpdE1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1vek1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1zTWF0Y2hlc1NlbGVjdG9yIHx8XG4gICAgRWxlbWVudC5wcm90b3R5cGUub01hdGNoZXNTZWxlY3Rvcjtcbn1cblxuLy8gUG9seWZpbGwgY2xvc2VzdFxuaWYgKCFFbGVtZW50LnByb3RvdHlwZS5jbG9zZXN0KSB7XG4gIEVsZW1lbnQucHJvdG90eXBlLmNsb3Nlc3QgPSBmdW5jdGlvbiBjbG9zZXN0KHNlbGVjdG9yKSB7XG4gICAgdmFyIGVsZW1lbnQgPSB0aGlzO1xuICAgIGRvIHtcbiAgICAgIGlmIChlbGVtZW50Lm1hdGNoZXMoc2VsZWN0b3IpKSB7XG4gICAgICAgIHJldHVybiBlbGVtZW50O1xuICAgICAgfVxuICAgIH0gd2hpbGUgKChlbGVtZW50ID0gZWxlbWVudC5wYXJlbnROb2RlKSAmJiBlbGVtZW50Lm5vZGVUeXBlID09PSBOb2RlLkVMRU1FTlRfTk9ERSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gdG9GcmFnbWVudDtcblxuLy8gQ29udmVydCBzdHVmZiBpbnRvIGRvY3VtZW50IGZyYWdtZW50cy4gU3R1ZmYgY2FuIGJlOlxuLy8gKiBBIHN0cmluZyBvZiBIVE1MIHRleHRcbi8vICogQW4gZWxlbWVudCBvciB0ZXh0IG5vZGVcbi8vICogQSBOb2RlTGlzdCBvciBIVE1MQ29sbGVjdGlvbiAoZS5nLiBgZWxlbWVudC5jaGlsZE5vZGVzYCBvciBgZWxlbWVudC5jaGlsZHJlbmApXG4vLyAqIEEgalF1ZXJ5IG9iamVjdFxuLy8gKiBBIHNjcmlwdCBlbGVtZW50IHdpdGggYSBgdHlwZWAgYXR0cmlidXRlIG9mIGBcInRleHQvKlwiYCAoZS5nLiBgPHNjcmlwdCB0eXBlPVwidGV4dC9odG1sXCI+TXkgdGVtcGxhdGUgY29kZSE8L3NjcmlwdD5gKVxuLy8gKiBBIHRlbXBsYXRlIGVsZW1lbnQgKGUuZy4gYDx0ZW1wbGF0ZT5NeSB0ZW1wbGF0ZSBjb2RlITwvdGVtcGxhdGU+YClcbmZ1bmN0aW9uIHRvRnJhZ21lbnQoaHRtbCkge1xuICBpZiAoaHRtbCBpbnN0YW5jZW9mIERvY3VtZW50RnJhZ21lbnQpIHtcbiAgICByZXR1cm4gaHRtbDtcbiAgfSBlbHNlIGlmICh0eXBlb2YgaHRtbCA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gc3RyaW5nVG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIGlmIChodG1sIGluc3RhbmNlb2YgTm9kZSkge1xuICAgIHJldHVybiBub2RlVG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIGlmICgnbGVuZ3RoJyBpbiBodG1sKSB7XG4gICAgcmV0dXJuIGxpc3RUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vuc3VwcG9ydGVkIFRlbXBsYXRlIFR5cGU6IENhbm5vdCBjb252ZXJ0IGAnICsgaHRtbCArICdgIGludG8gYSBkb2N1bWVudCBmcmFnbWVudC4nKTtcbiAgfVxufVxuXG4vLyBDb252ZXJ0cyBhbiBIVE1MIG5vZGUgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LiBJZiBpdCBpcyBhIDx0ZW1wbGF0ZT4gbm9kZSBpdHMgY29udGVudHMgd2lsbCBiZSB1c2VkLiBJZiBpdCBpcyBhXG4vLyA8c2NyaXB0PiBub2RlIGl0cyBzdHJpbmctYmFzZWQgY29udGVudHMgd2lsbCBiZSBjb252ZXJ0ZWQgdG8gSFRNTCBmaXJzdCwgdGhlbiB1c2VkLiBPdGhlcndpc2UgYSBjbG9uZSBvZiB0aGUgbm9kZVxuLy8gaXRzZWxmIHdpbGwgYmUgdXNlZC5cbmZ1bmN0aW9uIG5vZGVUb0ZyYWdtZW50KG5vZGUpIHtcbiAgaWYgKG5vZGUuY29udGVudCBpbnN0YW5jZW9mIERvY3VtZW50RnJhZ21lbnQpIHtcbiAgICByZXR1cm4gbm9kZS5jb250ZW50O1xuICB9IGVsc2UgaWYgKG5vZGUudGFnTmFtZSA9PT0gJ1NDUklQVCcpIHtcbiAgICByZXR1cm4gc3RyaW5nVG9GcmFnbWVudChub2RlLmlubmVySFRNTCk7XG4gIH0gZWxzZSB7XG4gICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgIGlmIChub2RlLnRhZ05hbWUgPT09ICdURU1QTEFURScpIHtcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsID0gbm9kZS5jaGlsZE5vZGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChub2RlLmNoaWxkTm9kZXNbaV0pO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChub2RlKTtcbiAgICB9XG4gICAgcmV0dXJuIGZyYWdtZW50O1xuICB9XG59XG5cbi8vIENvbnZlcnRzIGFuIEhUTUxDb2xsZWN0aW9uLCBOb2RlTGlzdCwgalF1ZXJ5IG9iamVjdCwgb3IgYXJyYXkgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LlxuZnVuY3Rpb24gbGlzdFRvRnJhZ21lbnQobGlzdCkge1xuICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gIGZvciAodmFyIGkgPSAwLCBsID0gbGlzdC5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAvLyBVc2UgdG9GcmFnbWVudCBzaW5jZSB0aGlzIG1heSBiZSBhbiBhcnJheSBvZiB0ZXh0LCBhIGpRdWVyeSBvYmplY3Qgb2YgYDx0ZW1wbGF0ZT5gcywgZXRjLlxuICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKHRvRnJhZ21lbnQobGlzdFtpXSkpO1xuICAgIGlmIChsID09PSBsaXN0Lmxlbmd0aCArIDEpIHtcbiAgICAgIC8vIGFkanVzdCBmb3IgTm9kZUxpc3RzIHdoaWNoIGFyZSBsaXZlLCB0aGV5IHNocmluayBhcyB3ZSBwdWxsIG5vZGVzIG91dCBvZiB0aGUgRE9NXG4gICAgICBpLS07XG4gICAgICBsLS07XG4gICAgfVxuICB9XG4gIHJldHVybiBmcmFnbWVudDtcbn1cblxuLy8gQ29udmVydHMgYSBzdHJpbmcgb2YgSFRNTCB0ZXh0IGludG8gYSBkb2N1bWVudCBmcmFnbWVudC5cbmZ1bmN0aW9uIHN0cmluZ1RvRnJhZ21lbnQoc3RyaW5nKSB7XG4gIGlmICghc3RyaW5nKSB7XG4gICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKSk7XG4gICAgcmV0dXJuIGZyYWdtZW50O1xuICB9XG4gIHZhciB0ZW1wbGF0ZUVsZW1lbnQ7XG4gIHRlbXBsYXRlRWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ3RlbXBsYXRlJyk7XG4gIHRlbXBsYXRlRWxlbWVudC5pbm5lckhUTUwgPSBzdHJpbmc7XG4gIHJldHVybiB0ZW1wbGF0ZUVsZW1lbnQuY29udGVudDtcbn1cblxuLy8gSWYgSFRNTCBUZW1wbGF0ZXMgYXJlIG5vdCBhdmFpbGFibGUgKGUuZy4gaW4gSUUpIHRoZW4gdXNlIGFuIG9sZGVyIG1ldGhvZCB0byB3b3JrIHdpdGggY2VydGFpbiBlbGVtZW50cy5cbmlmICghZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKS5jb250ZW50IGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICBzdHJpbmdUb0ZyYWdtZW50ID0gKGZ1bmN0aW9uKCkge1xuICAgIHZhciB0YWdFeHAgPSAvPChbXFx3Oi1dKykvO1xuXG4gICAgLy8gQ29waWVkIGZyb20galF1ZXJ5IChodHRwczovL2dpdGh1Yi5jb20vanF1ZXJ5L2pxdWVyeS9ibG9iL21hc3Rlci9MSUNFTlNFLnR4dClcbiAgICB2YXIgd3JhcE1hcCA9IHtcbiAgICAgIG9wdGlvbjogWyAxLCAnPHNlbGVjdCBtdWx0aXBsZT1cIm11bHRpcGxlXCI+JywgJzwvc2VsZWN0PicgXSxcbiAgICAgIGxlZ2VuZDogWyAxLCAnPGZpZWxkc2V0PicsICc8L2ZpZWxkc2V0PicgXSxcbiAgICAgIHRoZWFkOiBbIDEsICc8dGFibGU+JywgJzwvdGFibGU+JyBdLFxuICAgICAgdHI6IFsgMiwgJzx0YWJsZT48dGJvZHk+JywgJzwvdGJvZHk+PC90YWJsZT4nIF0sXG4gICAgICB0ZDogWyAzLCAnPHRhYmxlPjx0Ym9keT48dHI+JywgJzwvdHI+PC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIGNvbDogWyAyLCAnPHRhYmxlPjx0Ym9keT48L3Rib2R5Pjxjb2xncm91cD4nLCAnPC9jb2xncm91cD48L3RhYmxlPicgXSxcbiAgICAgIGFyZWE6IFsgMSwgJzxtYXA+JywgJzwvbWFwPicgXSxcbiAgICAgIF9kZWZhdWx0OiBbIDAsICcnLCAnJyBdXG4gICAgfTtcbiAgICB3cmFwTWFwLm9wdGdyb3VwID0gd3JhcE1hcC5vcHRpb247XG4gICAgd3JhcE1hcC50Ym9keSA9IHdyYXBNYXAudGZvb3QgPSB3cmFwTWFwLmNvbGdyb3VwID0gd3JhcE1hcC5jYXB0aW9uID0gd3JhcE1hcC50aGVhZDtcbiAgICB3cmFwTWFwLnRoID0gd3JhcE1hcC50ZDtcblxuICAgIHJldHVybiBmdW5jdGlvbiBzdHJpbmdUb0ZyYWdtZW50KHN0cmluZykge1xuICAgICAgaWYgKCFzdHJpbmcpIHtcbiAgICAgICAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJykpO1xuICAgICAgICByZXR1cm4gZnJhZ21lbnQ7XG4gICAgICB9XG4gICAgICB2YXIgdGFnID0gc3RyaW5nLm1hdGNoKHRhZ0V4cCk7XG4gICAgICB2YXIgcGFydHMgPSB3cmFwTWFwW3RhZ10gfHwgd3JhcE1hcC5fZGVmYXVsdDtcbiAgICAgIHZhciBkZXB0aCA9IHBhcnRzWzBdO1xuICAgICAgdmFyIHByZWZpeCA9IHBhcnRzWzFdO1xuICAgICAgdmFyIHBvc3RmaXggPSBwYXJ0c1syXTtcbiAgICAgIHZhciBkaXYgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdkaXYnKTtcbiAgICAgIGRpdi5pbm5lckhUTUwgPSBwcmVmaXggKyBzdHJpbmcgKyBwb3N0Zml4O1xuICAgICAgd2hpbGUgKGRlcHRoLS0pIHtcbiAgICAgICAgZGl2ID0gZGl2Lmxhc3RDaGlsZDtcbiAgICAgIH1cbiAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChkaXYuZmlyc3RDaGlsZCkge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkaXYuZmlyc3RDaGlsZCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZnJhZ21lbnQ7XG4gICAgfTtcbiAgfSkoKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuXG4vKipcbiAqICMjIFZpZXdcbiAqIEEgRG9jdW1lbnRGcmFnbWVudCB3aXRoIGJpbmRpbmdzLlxuICovXG5mdW5jdGlvbiBWaWV3KHRlbXBsYXRlKSB7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy5iaW5kaW5ncyA9IHRoaXMudGVtcGxhdGUuYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gYmluZGluZy5jbG9uZUZvclZpZXcodGhpcyk7XG4gIH0sIHRoaXMpO1xuICB0aGlzLmZpcnN0Vmlld05vZGUgPSB0aGlzLmZpcnN0Q2hpbGQ7XG4gIHRoaXMubGFzdFZpZXdOb2RlID0gdGhpcy5sYXN0Q2hpbGQ7XG4gIGlmICh0aGlzLmZpcnN0Vmlld05vZGUpIHtcbiAgICB0aGlzLmZpcnN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gICAgdGhpcy5sYXN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gIH1cbn1cblxuXG5WaWV3LnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgZnJvbSB0aGUgRE9NLiBBIHZpZXcgaXMgYSBEb2N1bWVudEZyYWdtZW50LCBzbyBgcmVtb3ZlKClgIHJldHVybnMgYWxsIGl0cyBub2RlcyB0byBpdHNlbGYuXG4gICAqL1xuICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub2RlID0gdGhpcy5maXJzdFZpZXdOb2RlO1xuICAgIHZhciBuZXh0O1xuXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gdGhpcykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCB0aGUgbm9kZXMgYW5kIHB1dCB0aGVtIGJhY2sgaW50byB0aGlzIGZyYWdtZW50XG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBuZXh0ID0gKG5vZGUgPT09IHRoaXMubGFzdFZpZXdOb2RlKSA/IG51bGwgOiBub2RlLm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgdmlldyAoaWYgbm90IGFscmVhZHkgcmVtb3ZlZCkgYW5kIGFkZHMgdGhlIHZpZXcgdG8gaXRzIHRlbXBsYXRlJ3MgcG9vbC5cbiAgICovXG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgdmlldyBpcyByZW1vdmVkIGZyb20gdGhlIERPTVxuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmRpc3Bvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucmV0dXJuVmlldyh0aGlzKTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogQmluZHMgYSB2aWV3IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICovXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5iaW5kKGNvbnRleHQpO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVuYmluZHMgYSB2aWV3IGZyb20gYW55IGNvbnRleHQuXG4gICAqL1xuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLnVuYmluZCgpO1xuICAgIH0pO1xuICB9XG59O1xuIl19
