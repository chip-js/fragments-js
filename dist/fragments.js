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
        if (callback) callback.call(_this);
        node.classList.remove(name);
        if (className) node.classList.remove(className);
      };

      if (duration) {
        onAnimationEnd(node, duration, whenDone);
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
var transitionEventName = 'transitionend';
var animationEventName = 'animationend';
var style = document.documentElement.style;

['webkit', 'moz', 'ms', 'o'].forEach(function(prefix) {
  if (style.transitionDuration === undefined && style[prefix + 'TransitionDuration']) {
    transitionDurationName = prefix + 'TransitionDuration';
    transitionDelayName = prefix + 'TransitionDelay';
    transitionEventName = prefix + 'transitionend';
  }

  if (style.animationDuration === undefined && style[prefix + 'AnimationDuration']) {
    animationDurationName = prefix + 'AnimationDuration';
    animationDelayName = prefix + 'AnimationDelay';
    animationEventName = prefix + 'animationend';
  }
});


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


function onAnimationEnd(node, duration, callback) {
  var onEnd = function() {
    node.removeEventListener(transitionEventName, onEnd);
    node.removeEventListener(animationEventName, onEnd);
    clearTimeout(timeout);
    callback();
  };

  // contingency plan
  var timeout = setTimeout(onEnd, duration + 10);

  node.addEventListener(transitionEventName, onEnd);
  node.addEventListener(animationEventName, onEnd);
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
      if (this.animate && this.context && !this.firstUpdate) {
        this.updatedAnimated(value);
      } else {
        this.updatedRegular(value);
      }
      this.firstUpdate = false;
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

    bound: function() {
      this.firstUpdate = true;
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIuLi9leHByZXNzaW9ucy1qcy9pbmRleC5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9leHByZXNzaW9ucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9mb3JtYXR0ZXJzLmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL3Byb3BlcnR5LWNoYWlucy5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL3NyYy9zdHJpbmdzLmpzIiwiaW5kZXguanMiLCJzcmMvYW5pbWF0ZWRCaW5kaW5nLmpzIiwic3JjL2JpbmRpbmcuanMiLCJzcmMvY29tcGlsZS5qcyIsInNyYy9mcmFnbWVudHMuanMiLCJzcmMvb2JzZXJ2ZXIvY29udGV4dC5qcyIsInNyYy9vYnNlcnZlci9kaWZmLmpzIiwic3JjL29ic2VydmVyL2luZGV4LmpzIiwic3JjL29ic2VydmVyL29ic2VydmVyLmpzIiwic3JjL3JlZ2lzdGVyZWQvYW5pbWF0aW9ucy5qcyIsInNyYy9yZWdpc3RlcmVkL2JpbmRlcnMuanMiLCJzcmMvcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvZXh0ZW5kLmpzIiwic3JjL3V0aWwvcG9seWZpbGxzLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3RFQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2VUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDeFBBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2xLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDN2xCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxWUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNKQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2hRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoTUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMStCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyWkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0REE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9zcmMvZXhwcmVzc2lvbnMnKTtcbiIsInZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbnZhciBzdHJpbmdzID0gcmVxdWlyZSgnLi9zdHJpbmdzJyk7XG52YXIgZm9ybWF0dGVyUGFyc2VyID0gcmVxdWlyZSgnLi9mb3JtYXR0ZXJzJyk7XG52YXIgcHJvcGVydHlDaGFpbnMgPSByZXF1aXJlKCcuL3Byb3BlcnR5LWNoYWlucycpO1xudmFyIHZhbHVlUHJvcGVydHkgPSAnX3ZhbHVlXyc7XG52YXIgY2FjaGUgPSB7fTtcblxuZXhwb3J0cy5nbG9iYWxzID0ge307XG5cblxuZXhwb3J0cy5wYXJzZSA9IGZ1bmN0aW9uKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFBcmdzKSkgZXh0cmFBcmdzID0gW107XG4gIHZhciBjYWNoZUtleSA9IGV4cHIgKyAnfCcgKyBleHRyYUFyZ3Muam9pbignLCcpO1xuICAvLyBSZXR1cm5zIHRoZSBjYWNoZWQgZnVuY3Rpb24gZm9yIHRoaXMgZXhwcmVzc2lvbiBpZiBpdCBleGlzdHMuXG4gIHZhciBmdW5jID0gY2FjaGVbY2FjaGVLZXldO1xuICBpZiAoZnVuYykge1xuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgdmFyIG9yaWdpbmFsID0gZXhwcjtcbiAgdmFyIGlzU2V0dGVyID0gKGV4dHJhQXJnc1swXSA9PT0gdmFsdWVQcm9wZXJ0eSk7XG4gIC8vIEFsbG93ICchcHJvcCcgdG8gYmVjb21lICdwcm9wID0gIXZhbHVlJ1xuICBpZiAoaXNTZXR0ZXIgJiYgZXhwci5jaGFyQXQoMCkgPT09ICchJykge1xuICAgIGV4cHIgPSBleHByLnNsaWNlKDEpO1xuICAgIHZhbHVlUHJvcGVydHkgPSAnIScgKyB2YWx1ZVByb3BlcnR5O1xuICB9XG5cbiAgZXhwciA9IHN0cmluZ3MucHVsbE91dFN0cmluZ3MoZXhwcik7XG4gIGV4cHIgPSBmb3JtYXR0ZXJQYXJzZXIucGFyc2VGb3JtYXR0ZXJzKGV4cHIpO1xuICBleHByID0gcHJvcGVydHlDaGFpbnMucGFyc2VFeHByZXNzaW9uKGV4cHIsIGdldFZhcmlhYmxlcyhnbG9iYWxzLCBleHRyYUFyZ3MpKTtcbiAgaWYgKCFpc1NldHRlcikge1xuICAgIHZhciBsaW5lcyA9IGV4cHIuc3BsaXQoJ1xcbicpO1xuICAgIGxpbmVzW2xpbmVzLmxlbmd0aCAtIDFdID0gJ3JldHVybiAnICsgbGluZXNbbGluZXMubGVuZ3RoIC0gMV07XG4gICAgZXhwciA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuICB9XG4gIGV4cHIgPSBzdHJpbmdzLnB1dEluU3RyaW5ncyhleHByKTtcbiAgZnVuYyA9IGNvbXBpbGVFeHByZXNzaW9uKG9yaWdpbmFsLCBleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpO1xuICBmdW5jLmV4cHIgPSBleHByO1xuICBjYWNoZVtjYWNoZUtleV0gPSBmdW5jO1xuICByZXR1cm4gZnVuYztcbn07XG5cblxuZXhwb3J0cy5wYXJzZVNldHRlciA9IGZ1bmN0aW9uKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFBcmdzKSkgZXh0cmFBcmdzID0gW107XG5cbiAgLy8gQWRkIF92YWx1ZV8gYXMgdGhlIGZpcnN0IGV4dHJhIGFyZ3VtZW50XG4gIGV4dHJhQXJncy51bnNoaWZ0KHZhbHVlUHJvcGVydHkpO1xuICBleHByID0gZXhwci5yZXBsYWNlKC8oXFxzKlxcfHwkKS8sICcgPSBfdmFsdWVfJDEnKTtcblxuICByZXR1cm4gZXhwb3J0cy5wYXJzZShleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpO1xufTtcblxuXG5mdW5jdGlvbiBnZXRWYXJpYWJsZXMoZ2xvYmFscywgZXh0cmFBcmdzKSB7XG4gIHZhciB2YXJpYWJsZXMgPSB7fTtcblxuICBPYmplY3Qua2V5cyhleHBvcnRzLmdsb2JhbHMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgdmFyaWFibGVzW2tleV0gPSBleHBvcnRzLmdsb2JhbHNba2V5XTtcbiAgfSk7XG5cbiAgaWYgKGdsb2JhbHMpIHtcbiAgICBPYmplY3Qua2V5cyhnbG9iYWxzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyaWFibGVzW2tleV0gPSBnbG9iYWxzW2tleV07XG4gICAgfSk7XG4gIH1cblxuICBleHRyYUFyZ3MuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICB2YXJpYWJsZXNba2V5XSA9IG51bGw7XG4gIH0pO1xuXG4gIHJldHVybiB2YXJpYWJsZXM7XG59XG5cblxuXG5mdW5jdGlvbiBjb21waWxlRXhwcmVzc2lvbihvcmlnaW5hbCwgZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKSB7XG4gIHZhciBmdW5jLCBhcmdzID0gWydfZ2xvYmFsc18nLCAnX2Zvcm1hdHRlcnNfJ10uY29uY2F0KGV4dHJhQXJncykuY29uY2F0KGV4cHIpO1xuXG4gIHRyeSB7XG4gICAgZnVuYyA9IEZ1bmN0aW9uLmFwcGx5KG51bGwsIGFyZ3MpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gVGhyb3dzIGFuIGVycm9yIGlmIHRoZSBleHByZXNzaW9uIHdhcyBub3QgdmFsaWQgSmF2YVNjcmlwdFxuICAgIHRocm93IG5ldyBFcnJvcignQmFkIGV4cHJlc3Npb246ICcgKyBvcmlnaW5hbCArICdcXG4nICsgJ0NvbXBpbGVkIGV4cHJlc3Npb246XFxuJyArIGV4cHIgKyAnXFxuJyArIGUubWVzc2FnZSk7XG4gIH1cblxuICByZXR1cm4gYmluZEFyZ3VtZW50cyhmdW5jLCBnbG9iYWxzLCBmb3JtYXR0ZXJzKTtcbn1cblxuXG4vLyBhIGN1c3RvbSBcImJpbmRcIiBmdW5jdGlvbiB0byBiaW5kIGFyZ3VtZW50cyB0byBhIGZ1bmN0aW9uIHdpdGhvdXQgYmluZGluZyB0aGUgY29udGV4dFxuZnVuY3Rpb24gYmluZEFyZ3VtZW50cyhmdW5jKSB7XG4gIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZ1bmMuYXBwbHkodGhpcywgYXJncy5jb25jYXQoc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gIH1cbn1cbiIsIlxuLy8gZmluZHMgcGlwZXMgdGhhdCBhcmUgbm90IE9ScyAoaS5lLiBgIHwgYCBub3QgYCB8fCBgKSBmb3IgZm9ybWF0dGVyc1xudmFyIHBpcGVSZWdleCA9IC9cXHwoXFx8KT8vZztcblxuLy8gQSBzdHJpbmcgdGhhdCB3b3VsZCBub3QgYXBwZWFyIGluIHZhbGlkIEphdmFTY3JpcHRcbnZhciBwbGFjZWhvbGRlciA9ICdAQEAnO1xudmFyIHBsYWNlaG9sZGVyUmVnZXggPSBuZXcgUmVnRXhwKCdcXFxccyonICsgcGxhY2Vob2xkZXIgKyAnXFxcXHMqJyk7XG5cbi8vIGRldGVybWluZXMgd2hldGhlciBhbiBleHByZXNzaW9uIGlzIGEgc2V0dGVyIG9yIGdldHRlciAoYG5hbWVgIHZzIGBuYW1lID0gJ2JvYidgKVxudmFyIHNldHRlclJlZ2V4ID0gL1xccz1cXHMvO1xuXG4vLyBmaW5kcyB0aGUgcGFydHMgb2YgYSBmb3JtYXR0ZXIsIG5hbWUgYW5kIGFyZ3MgKGUuZy4gYGZvbyhiYXIpYClcbnZhciBmb3JtYXR0ZXJSZWdleCA9IC9eKFteXFwoXSspKD86XFwoKC4qKVxcKSk/JC87XG5cbi8vIGZpbmRzIGFyZ3VtZW50IHNlcGFyYXRvcnMgZm9yIGZvcm1hdHRlcnMgKGBhcmcxLCBhcmcyYClcbnZhciBhcmdTZXBhcmF0b3IgPSAvXFxzKixcXHMqL2c7XG5cblxuLyoqXG4gKiBGaW5kcyB0aGUgZm9ybWF0dGVycyB3aXRoaW4gYW4gZXhwcmVzc2lvbiBhbmQgY29udmVydHMgdGhlbSB0byB0aGUgY29ycmVjdCBKYXZhU2NyaXB0IGVxdWl2YWxlbnQuXG4gKi9cbmV4cG9ydHMucGFyc2VGb3JtYXR0ZXJzID0gZnVuY3Rpb24oZXhwcikge1xuICAvLyBDb252ZXJ0cyBgbmFtZSB8IHVwcGVyIHwgZm9vKGJhcilgIGludG8gYG5hbWUgQEBAIHVwcGVyIEBAQCBmb28oYmFyKWBcbiAgZXhwciA9IGV4cHIucmVwbGFjZShwaXBlUmVnZXgsIGZ1bmN0aW9uKG1hdGNoLCBvckluZGljYXRvcikge1xuICAgIGlmIChvckluZGljYXRvcikgcmV0dXJuIG1hdGNoO1xuICAgIHJldHVybiBwbGFjZWhvbGRlcjtcbiAgfSk7XG5cbiAgLy8gc3BsaXRzIHRoZSBzdHJpbmcgYnkgXCJAQEBcIiwgcHVsbHMgb2YgdGhlIGZpcnN0IGFzIHRoZSBleHByLCB0aGUgcmVtYWluaW5nIGFyZSBmb3JtYXR0ZXJzXG4gIGZvcm1hdHRlcnMgPSBleHByLnNwbGl0KHBsYWNlaG9sZGVyUmVnZXgpO1xuICBleHByID0gZm9ybWF0dGVycy5zaGlmdCgpO1xuICBpZiAoIWZvcm1hdHRlcnMubGVuZ3RoKSByZXR1cm4gZXhwcjtcblxuICAvLyBQcm9jZXNzZXMgdGhlIGZvcm1hdHRlcnNcbiAgLy8gSWYgdGhlIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgdGhlIHZhbHVlIHdpbGwgYmUgcnVuIHRocm91Z2ggdGhlIGZvcm1hdHRlcnNcbiAgdmFyIHNldHRlciA9ICcnO1xuICB2YXIgdmFsdWUgPSBleHByO1xuXG4gIGlmIChzZXR0ZXJSZWdleC50ZXN0KGV4cHIpKSB7XG4gICAgdmFyIHBhcnRzID0gZXhwci5zcGxpdChzZXR0ZXJSZWdleCk7XG4gICAgc2V0dGVyID0gcGFydHNbMF0gKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnRzWzFdO1xuICB9XG5cbiAgLy8gUHJvY2Vzc2VzIHRoZSBmb3JtYXR0ZXJzXG4gIGZvcm1hdHRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3JtYXR0ZXIpIHtcbiAgICB2YXIgbWF0Y2ggPSBmb3JtYXR0ZXIudHJpbSgpLm1hdGNoKGZvcm1hdHRlclJlZ2V4KTtcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRm9ybWF0dGVyIGlzIGludmFsaWQ6ICcgKyBmb3JtYXR0ZXIpO1xuICAgIH1cblxuICAgIHZhciBmb3JtYXR0ZXJOYW1lID0gbWF0Y2hbMV07XG4gICAgdmFyIGFyZ3MgPSBtYXRjaFsyXSA/IG1hdGNoWzJdLnNwbGl0KGFyZ1NlcGFyYXRvcikgOiBbXTtcblxuICAgIC8vIEFkZCB0aGUgcHJldmlvdXMgdmFsdWUgYXMgdGhlIGZpcnN0IGFyZ3VtZW50XG4gICAgYXJncy51bnNoaWZ0KHZhbHVlKTtcblxuICAgIC8vIElmIHRoaXMgaXMgYSBzZXR0ZXIgZXhwciwgYmUgc3VyZSB0byBhZGQgdGhlIGBpc1NldHRlcmAgZmxhZyBhdCB0aGUgZW5kIG9mIHRoZSBmb3JtYXR0ZXIncyBhcmd1bWVudHNcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICBhcmdzLnB1c2godHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gU2V0IHRoZSB2YWx1ZSB0byBiZWNvbWUgdGhlIHJlc3VsdCBvZiB0aGlzIGZvcm1hdHRlciwgc28gdGhlIG5leHQgZm9ybWF0dGVyIGNhbiB3cmFwIGl0LlxuICAgIC8vIENhbGwgZm9ybWF0dGVycyBpbiB0aGUgY3VycmVudCBjb250ZXh0LlxuICAgIHZhbHVlID0gJ19mb3JtYXR0ZXJzXy4nICsgZm9ybWF0dGVyTmFtZSArICcuY2FsbCh0aGlzLCAnICsgYXJncy5qb2luKCcsICcpICsgJyknO1xuICB9KTtcblxuICByZXR1cm4gc2V0dGVyICsgdmFsdWU7XG59O1xuIiwidmFyIHJlZmVyZW5jZUNvdW50ID0gMDtcbnZhciBjdXJyZW50UmVmZXJlbmNlID0gMDtcbnZhciBjdXJyZW50SW5kZXggPSAwO1xudmFyIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbnZhciBjb250aW51YXRpb24gPSBmYWxzZTtcbnZhciBnbG9iYWxzID0gbnVsbDtcbnZhciBkZWZhdWx0R2xvYmFscyA9IHtcbiAgcmV0dXJuOiBudWxsLFxuICB0cnVlOiBudWxsLFxuICBmYWxzZTogbnVsbCxcbiAgdW5kZWZpbmVkOiBudWxsLFxuICBudWxsOiBudWxsLFxuICB0aGlzOiBudWxsLFxuICB3aW5kb3c6IG51bGwsXG4gIE1hdGg6IG51bGwsXG4gIHBhcnNlSW50OiBudWxsLFxuICBwYXJzZUZsb2F0OiBudWxsLFxuICBpc05hTjogbnVsbCxcbiAgQXJyYXk6IG51bGwsXG4gIHR5cGVvZjogbnVsbCxcbiAgX2dsb2JhbHNfOiBudWxsLFxuICBfZm9ybWF0dGVyc186IG51bGwsXG4gIF92YWx1ZV86IG51bGwsXG59O1xuXG5cbi8vIG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIChlLmcuIGBuYW1lYCwgYHVzZXIubmFtZWAsIGFuZCBgdXNlci5mdWxsTmFtZSgpLmNhcGl0YWxpemUoKWApXG52YXIgcHJvcGVydHlSZWdleCA9IC8oKFxce3wsfFxcLik/XFxzKikoW2EteiRfXFwkXSg/OlthLXpfXFwkMC05XFwuLV18XFxbWydcIlxcZF0rXFxdKSopKFxccyooOnxcXCh8XFxbKT8pfChcXFspL2dpO1xuLyoqXG4gKiBCcm9rZW4gZG93blxuICpcbiAqICgoXFx7fCx8XFwuKT9cXHMqKVxuICogcHJlZml4OiBtYXRjaGVzIG9uIG9iamVjdCBsaXRlcmFscyBzbyB3ZSBjYW4gc2tpcCAoaW4gYHsgZm9vOiBiYXIgfWAgXCJmb29cIiBpcyBub3QgYSBwcm9wZXJ0eSkuIEFsc28gcGlja3MgdXAgb25cbiAqIHVuZmluaXNoZWQgY2hhaW5zIHRoYXQgaGFkIGZ1bmN0aW9uIGNhbGxzIG9yIGJyYWNrZXRzIHdlIGNvdWxkbid0IGZpbmlzaCBzdWNoIGFzIHRoZSBkb3QgaW4gYC50ZXN0YCBhZnRlciB0aGUgY2hhaW5cbiAqIGBmb28uYmFyKCkudGVzdGAuXG4gKlxuICogKFthLXokX1xcJF0oPzpbYS16X1xcJDAtOVxcLi1dfFxcW1snXCJcXGRdK1xcXSkqKVxuICogcHJvcGVydHkgY2hhaW46IG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIHN1Y2ggYXMgdGhlIGZvbGxvd2luZyAoc3RyaW5ncycgY29udGVudHMgYXJlIHJlbW92ZWQgYXQgdGhpcyBzdGVwKVxuICogICBgZm9vLCBmb28uYmFyLCBmb28uYmFyWzBdLCBmb28uYmFyWzBdLnRlc3QsIGZvby5iYXJbJyddLnRlc3RgXG4gKiAgIERvZXMgbm90IG1hdGNoIHRocm91Z2ggZnVuY3Rpb25zIGNhbGxzIG9yIHRocm91Z2ggYnJhY2tldHMgd2hpY2ggY29udGFpbiB2YXJpYWJsZXMuXG4gKiAgIGBmb28uYmFyKCkudGVzdCwgZm9vLmJhcltwcm9wXS50ZXN0YFxuICogICBJbiB0aGVzZSBjYXNlcyBpdCB3b3VsZCBvbmx5IG1hdGNoIGBmb28uYmFyYCwgYC50ZXN0YCwgYW5kIGBwcm9wYFxuICpcbiAqIChcXHMqKDp8XFwofFxcWyk/KVxuICogcG9zdGZpeDogbWF0Y2hlcyB0cmFpbGluZyBjaGFyYWN0ZXJzIHRvIGRldGVybWluZSBpZiB0aGlzIGlzIGFuIG9iamVjdCBwcm9wZXJ0eSBvciBhIGZ1bmN0aW9uIGNhbGwgZXRjLiBXaWxsIG1hdGNoXG4gKiB0aGUgY29sb24gYWZ0ZXIgXCJmb29cIiBpbiBgeyBmb286ICdiYXInIH1gLCB0aGUgZmlyc3QgcGFyZW50aGVzaXMgaW4gYG9iai5mb28oYmFyKWAsIHRoZSB0aGUgZmlyc3QgYnJhY2tldCBpblxuICogYGZvb1tiYXJdYC5cbiAqL1xuXG4vLyBsaW5rcyBpbiBhIHByb3BlcnR5IGNoYWluXG52YXIgY2hhaW5MaW5rc1JlZ2V4ID0gL1xcLnxcXFsvZztcblxuLy8gdGhlIHByb3BlcnR5IG5hbWUgcGFydCBvZiBsaW5rc1xudmFyIGNoYWluTGlua1JlZ2V4ID0gL1xcLnxcXFt8XFwoLztcblxudmFyIGFuZFJlZ2V4ID0gLyBhbmQgL2c7XG52YXIgb3JSZWdleCA9IC8gb3IgL2c7XG5cblxuZXhwb3J0cy5wYXJzZUV4cHJlc3Npb24gPSBmdW5jdGlvbihleHByLCBfZ2xvYmFscykge1xuICAvLyBSZXNldCBhbGwgdmFsdWVzXG4gIHJlZmVyZW5jZUNvdW50ID0gMDtcbiAgY3VycmVudFJlZmVyZW5jZSA9IDA7XG4gIGN1cnJlbnRJbmRleCA9IDA7XG4gIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbiAgY29udGludWF0aW9uID0gZmFsc2U7XG4gIGdsb2JhbHMgPSBfZ2xvYmFscztcblxuICBleHByID0gcmVwbGFjZUFuZHNBbmRPcnMoZXhwcik7XG4gIGlmIChleHByLmluZGV4T2YoJyA9ICcpICE9PSAtMSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoJyA9ICcpO1xuICAgIHZhciBzZXR0ZXIgPSBwYXJ0c1swXTtcbiAgICB2YXIgdmFsdWUgPSBwYXJ0c1sxXTtcbiAgICBzZXR0ZXIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKHNldHRlcikucmVwbGFjZSgvXlxcKHxcXCkkL2csICcnKTtcbiAgICB2YWx1ZSA9IHBhcnNlUHJvcGVydHlDaGFpbnModmFsdWUpO1xuICAgIGV4cHIgPSBzZXR0ZXIgKyAnID0gJyArIHZhbHVlO1xuICB9IGVsc2Uge1xuICAgIGV4cHIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKGV4cHIpO1xuICB9XG4gIGV4cHIgPSBhZGRSZWZlcmVuY2VzKGV4cHIpXG5cbiAgLy8gUmVzZXQgYWZ0ZXIgcGFyc2UgaXMgZG9uZVxuICBnbG9iYWxzID0gbnVsbDtcblxuICByZXR1cm4gZXhwcjtcbn07XG5cblxuLyoqXG4gKiBGaW5kcyBhbmQgcGFyc2VzIHRoZSBwcm9wZXJ0eSBjaGFpbnMgaW4gYW4gZXhwcmVzc2lvbi5cbiAqL1xuZnVuY3Rpb24gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKSB7XG4gIHZhciBwYXJzZWRFeHByID0gJycsIGNoYWluO1xuXG4gIC8vIGFsbG93IHJlY3Vyc2lvbiAoZS5nLiBpbnRvIGZ1bmN0aW9uIGFyZ3MpIGJ5IHJlc2V0dGluZyBwcm9wZXJ0eVJlZ2V4XG4gIC8vIFRoaXMgaXMgbW9yZSBlZmZpY2llbnQgdGhhbiBjcmVhdGluZyBhIG5ldyByZWdleCBmb3IgZWFjaCBjaGFpbiwgSSBhc3N1bWVcbiAgdmFyIHByZXZDdXJyZW50SW5kZXggPSBjdXJyZW50SW5kZXg7XG4gIHZhciBwcmV2TGFzdEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG5cbiAgY3VycmVudEluZGV4ID0gMDtcbiAgcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSAwO1xuICB3aGlsZSAoKGNoYWluID0gbmV4dENoYWluKGV4cHIpKSAhPT0gZmFsc2UpIHtcbiAgICBwYXJzZWRFeHByICs9IGNoYWluO1xuICB9XG5cbiAgLy8gUmVzZXQgaW5kZXhlc1xuICBjdXJyZW50SW5kZXggPSBwcmV2Q3VycmVudEluZGV4O1xuICBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCA9IHByZXZMYXN0SW5kZXg7XG4gIHJldHVybiBwYXJzZWRFeHByO1xufTtcblxuXG5mdW5jdGlvbiBuZXh0Q2hhaW4oZXhwcikge1xuICBpZiAoZmluaXNoZWRDaGFpbikge1xuICAgIHJldHVybiAoZmluaXNoZWRDaGFpbiA9IGZhbHNlKTtcbiAgfVxuICB2YXIgbWF0Y2ggPSBwcm9wZXJ0eVJlZ2V4LmV4ZWMoZXhwcik7XG4gIGlmICghbWF0Y2gpIHtcbiAgICBmaW5pc2hlZENoYWluID0gdHJ1ZSAvLyBtYWtlIHN1cmUgbmV4dCBjYWxsIHdlIHJldHVybiBmYWxzZVxuICAgIHJldHVybiBleHByLnNsaWNlKGN1cnJlbnRJbmRleCk7XG4gIH1cblxuICAvLyBgcHJlZml4YCBpcyBgb2JqSW5kaWNhdG9yYCB3aXRoIHRoZSB3aGl0ZXNwYWNlIHRoYXQgbWF5IGNvbWUgYWZ0ZXIgaXQuXG4gIHZhciBwcmVmaXggPSBtYXRjaFsxXTtcblxuICAvLyBgb2JqSW5kaWNhdG9yYCBpcyBge2Agb3IgYCxgIGFuZCBsZXQncyB1cyBrbm93IHRoaXMgaXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gIC8vIG5hbWUgKGUuZy4gcHJvcCBpbiBge3Byb3A6ZmFsc2V9YCkuXG4gIHZhciBvYmpJbmRpY2F0b3IgPSBtYXRjaFsyXTtcblxuICAvLyBgcHJvcENoYWluYCBpcyB0aGUgY2hhaW4gb2YgcHJvcGVydGllcyBtYXRjaGVkIChlLmcuIGB0aGlzLnVzZXIuZW1haWxgKS5cbiAgdmFyIHByb3BDaGFpbiA9IG1hdGNoWzNdO1xuXG4gIC8vIGBwb3N0Zml4YCBpcyB0aGUgYGNvbG9uT3JQYXJlbmAgd2l0aCB3aGl0ZXNwYWNlIGJlZm9yZSBpdC5cbiAgdmFyIHBvc3RmaXggPSBtYXRjaFs0XTtcblxuICAvLyBgY29sb25PclBhcmVuYCBtYXRjaGVzIHRoZSBjb2xvbiAoOikgYWZ0ZXIgdGhlIHByb3BlcnR5IChpZiBpdCBpcyBhbiBvYmplY3QpXG4gIC8vIG9yIHBhcmVudGhlc2lzIGlmIGl0IGlzIGEgZnVuY3Rpb24uIFdlIHVzZSBgY29sb25PclBhcmVuYCBhbmQgYG9iakluZGljYXRvcmBcbiAgLy8gdG8ga25vdyBpZiBpdCBpcyBhbiBvYmplY3QuXG4gIHZhciBjb2xvbk9yUGFyZW4gPSBtYXRjaFs1XTtcblxuICBtYXRjaCA9IG1hdGNoWzBdO1xuXG4gIHZhciBza2lwcGVkID0gZXhwci5zbGljZShjdXJyZW50SW5kZXgsIHByb3BlcnR5UmVnZXgubGFzdEluZGV4IC0gbWF0Y2gubGVuZ3RoKTtcbiAgY3VycmVudEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG5cbiAgLy8gc2tpcHMgb2JqZWN0IGtleXMgZS5nLiB0ZXN0IGluIGB7dGVzdDp0cnVlfWAuXG4gIGlmIChvYmpJbmRpY2F0b3IgJiYgY29sb25PclBhcmVuID09PSAnOicpIHtcbiAgICByZXR1cm4gc2tpcHBlZCArIG1hdGNoO1xuICB9XG5cbiAgcmV0dXJuIHNraXBwZWQgKyBwYXJzZUNoYWluKHByZWZpeCwgcHJvcENoYWluLCBwb3N0Zml4LCBjb2xvbk9yUGFyZW4sIGV4cHIpO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIHBhcmVuLCBleHByKSB7XG4gIC8vIGNvbnRpbnVhdGlvbnMgYWZ0ZXIgYSBmdW5jdGlvbiAoZS5nLiBgZ2V0VXNlcigxMikuZmlyc3ROYW1lYCkuXG4gIGNvbnRpbnVhdGlvbiA9IHByZWZpeCA9PT0gJy4nO1xuICBpZiAoY29udGludWF0aW9uKSB7XG4gICAgcHJvcENoYWluID0gJy4nICsgcHJvcENoYWluO1xuICAgIHByZWZpeCA9ICcnO1xuICB9XG5cbiAgdmFyIGxpbmtzID0gc3BsaXRMaW5rcyhwcm9wQ2hhaW4pO1xuICB2YXIgbmV3Q2hhaW4gPSAnJztcblxuICBpZiAobGlua3MubGVuZ3RoID09PSAxICYmICFjb250aW51YXRpb24gJiYgIXBhcmVuKSB7XG4gICAgbGluayA9IGxpbmtzWzBdO1xuICAgIG5ld0NoYWluID0gYWRkVGhpc09yR2xvYmFsKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGlmICghY29udGludWF0aW9uKSB7XG4gICAgICBuZXdDaGFpbiA9ICcoJztcbiAgICB9XG5cbiAgICBsaW5rcy5mb3JFYWNoKGZ1bmN0aW9uKGxpbmssIGluZGV4KSB7XG4gICAgICBpZiAoaW5kZXggIT09IGxpbmtzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgbmV3Q2hhaW4gKz0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghcGFyZW5zW3BhcmVuXSkge1xuICAgICAgICAgIG5ld0NoYWluICs9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChjb250aW51YXRpb24gJiYgaW5kZXggPT09IDApIHtcbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBvc3RmaXggPSBwb3N0Zml4LnJlcGxhY2UocGFyZW4sICcnKTtcbiAgICAgICAgICBuZXdDaGFpbiArPSBwYXJlbiA9PT0gJygnID8gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikgOiBwYXJzZUJyYWNrZXRzKGxpbmssIGluZGV4LCBleHByKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSAhPT0gJy4nKSB7XG4gICAgICBuZXdDaGFpbiArPSAnKSc7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHByZWZpeCArIG5ld0NoYWluICsgcG9zdGZpeDtcbn1cblxuXG5mdW5jdGlvbiBzcGxpdExpbmtzKGNoYWluKSB7XG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbWF0Y2g7XG4gIHdoaWxlIChtYXRjaCA9IGNoYWluTGlua3NSZWdleC5leGVjKGNoYWluKSkge1xuICAgIGlmIChjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4ID09PSAxKSBjb250aW51ZTtcbiAgICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4LCBjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4IC0gMSkpO1xuICAgIGluZGV4ID0gY2hhaW5MaW5rc1JlZ2V4Lmxhc3RJbmRleCAtIDE7XG4gIH1cbiAgcGFydHMucHVzaChjaGFpbi5zbGljZShpbmRleCkpO1xuICByZXR1cm4gcGFydHM7XG59XG5cblxuZnVuY3Rpb24gYWRkVGhpc09yR2xvYmFsKGNoYWluKSB7XG4gIHZhciBwcm9wID0gY2hhaW4uc3BsaXQoY2hhaW5MaW5rUmVnZXgpLnNoaWZ0KCk7XG4gIGlmIChnbG9iYWxzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgcmV0dXJuIGdsb2JhbHNbcHJvcF0gPT09IG51bGwgPyBjaGFpbiA6ICdfZ2xvYmFsc18uJyArIGNoYWluO1xuICB9IGVsc2UgaWYgKGRlZmF1bHRHbG9iYWxzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgcmV0dXJuIGNoYWluO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAndGhpcy4nICsgY2hhaW47XG4gIH1cbn1cblxuXG52YXIgcGFyZW5zID0ge1xuICAnKCc6ICcpJyxcbiAgJ1snOiAnXSdcbn07XG5cbi8vIEhhbmRsZXMgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgaW4gaXRzIGNvcnJlY3Qgc2NvcGVcbi8vIEZpbmRzIHRoZSBlbmQgb2YgdGhlIGZ1bmN0aW9uIGFuZCBwcm9jZXNzZXMgdGhlIGFyZ3VtZW50c1xuZnVuY3Rpb24gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcblxuICAvLyBBbHdheXMgY2FsbCBmdW5jdGlvbnMgaW4gdGhlIHNjb3BlIG9mIHRoZSBvYmplY3QgdGhleSdyZSBhIG1lbWJlciBvZlxuICBpZiAoaW5kZXggPT09IDApIHtcbiAgICBsaW5rID0gYWRkVGhpc09yR2xvYmFsKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGxpbmsgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluaztcbiAgfVxuXG4gIHZhciBjYWxsZWRMaW5rID0gbGluayArICcofn5pbnNpZGVQYXJlbnN+fiknO1xuICBpZiAoZXhwci5jaGFyQXQocHJvcGVydHlSZWdleC5sYXN0SW5kZXgpID09PSAnLicpIHtcbiAgICBjYWxsZWRMaW5rID0gcGFyc2VQYXJ0KGNhbGxlZExpbmssIGluZGV4KVxuICB9XG5cbiAgbGluayA9ICd0eXBlb2YgJyArIGxpbmsgKyAnICE9PSBcXCdmdW5jdGlvblxcJyA/IHZvaWQgMCA6ICcgKyBjYWxsZWRMaW5rO1xuICB2YXIgaW5zaWRlUGFyZW5zID0gY2FsbC5zbGljZSgxLCAtMSk7XG5cbiAgdmFyIHJlZiA9IGN1cnJlbnRSZWZlcmVuY2U7XG4gIGxpbmsgPSBsaW5rLnJlcGxhY2UoJ35+aW5zaWRlUGFyZW5zfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZVBhcmVucykpO1xuICBjdXJyZW50UmVmZXJlbmNlID0gcmVmO1xuICByZXR1cm4gbGluaztcbn1cblxuLy8gSGFuZGxlcyBhIGJyYWNrZXRlZCBleHByZXNzaW9uIHRvIGJlIHBhcnNlZFxuZnVuY3Rpb24gcGFyc2VCcmFja2V0cyhsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcbiAgdmFyIGluc2lkZUJyYWNrZXRzID0gY2FsbC5zbGljZSgxLCAtMSk7XG4gIHZhciBldmFsZWRMaW5rID0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgaW5kZXggKz0gMTtcbiAgbGluayA9ICdbfn5pbnNpZGVCcmFja2V0c35+XSc7XG5cbiAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSA9PT0gJy4nKSB7XG4gICAgbGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgbGluayA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICB9XG5cbiAgbGluayA9IGV2YWxlZExpbmsgKyBsaW5rO1xuXG4gIHZhciByZWYgPSBjdXJyZW50UmVmZXJlbmNlO1xuICBsaW5rID0gbGluay5yZXBsYWNlKCd+fmluc2lkZUJyYWNrZXRzfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZUJyYWNrZXRzKSk7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSByZWY7XG4gIHJldHVybiBsaW5rO1xufVxuXG5cbi8vIHJldHVybnMgdGhlIGNhbGwgcGFydCBvZiBhIGZ1bmN0aW9uIChlLmcuIGB0ZXN0KDEyMylgIHdvdWxkIHJldHVybiBgKDEyMylgKVxuZnVuY3Rpb24gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpIHtcbiAgdmFyIHN0YXJ0SW5kZXggPSBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleDtcbiAgdmFyIG9wZW4gPSBleHByLmNoYXJBdChzdGFydEluZGV4IC0gMSk7XG4gIHZhciBjbG9zZSA9IHBhcmVuc1tvcGVuXTtcbiAgdmFyIGVuZEluZGV4ID0gc3RhcnRJbmRleCAtIDE7XG4gIHZhciBwYXJlbkNvdW50ID0gMTtcbiAgd2hpbGUgKGVuZEluZGV4KysgPCBleHByLmxlbmd0aCkge1xuICAgIHZhciBjaCA9IGV4cHIuY2hhckF0KGVuZEluZGV4KTtcbiAgICBpZiAoY2ggPT09IG9wZW4pIHBhcmVuQ291bnQrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gY2xvc2UpIHBhcmVuQ291bnQtLTtcbiAgICBpZiAocGFyZW5Db3VudCA9PT0gMCkgYnJlYWs7XG4gIH1cbiAgY3VycmVudEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSBlbmRJbmRleCArIDE7XG4gIHJldHVybiBvcGVuICsgZXhwci5zbGljZShzdGFydEluZGV4LCBlbmRJbmRleCkgKyBjbG9zZTtcbn1cblxuXG5cbmZ1bmN0aW9uIHBhcnNlUGFydChwYXJ0LCBpbmRleCkge1xuICAvLyBpZiB0aGUgZmlyc3RcbiAgaWYgKGluZGV4ID09PSAwICYmICFjb250aW51YXRpb24pIHtcbiAgICBwYXJ0ID0gYWRkVGhpc09yR2xvYmFsKHBhcnQpO1xuICB9IGVsc2Uge1xuICAgIHBhcnQgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgcGFydDtcbiAgfVxuXG4gIGN1cnJlbnRSZWZlcmVuY2UgPSArK3JlZmVyZW5jZUNvdW50O1xuICB2YXIgcmVmID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZTtcbiAgcmV0dXJuICcoJyArIHJlZiArICcgPSAnICsgcGFydCArICcpID09IG51bGwgPyB2b2lkIDAgOiAnO1xufVxuXG5cbmZ1bmN0aW9uIHJlcGxhY2VBbmRzQW5kT3JzKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIucmVwbGFjZShhbmRSZWdleCwgJyAmJiAnKS5yZXBsYWNlKG9yUmVnZXgsICcgfHwgJyk7XG59XG5cblxuLy8gUHJlcGVuZHMgcmVmZXJlbmNlIHZhcmlhYmxlIGRlZmluaXRpb25zXG5mdW5jdGlvbiBhZGRSZWZlcmVuY2VzKGV4cHIpIHtcbiAgaWYgKHJlZmVyZW5jZUNvdW50KSB7XG4gICAgdmFyIHJlZnMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMTsgaSA8PSByZWZlcmVuY2VDb3VudDsgaSsrKSB7XG4gICAgICByZWZzLnB1c2goJ19yZWYnICsgaSk7XG4gICAgfVxuICAgIGV4cHIgPSAndmFyICcgKyByZWZzLmpvaW4oJywgJykgKyAnO1xcbicgKyBleHByO1xuICB9XG4gIHJldHVybiBleHByO1xufVxuIiwiLy8gZmluZHMgYWxsIHF1b3RlZCBzdHJpbmdzXG52YXIgcXVvdGVSZWdleCA9IC8oWydcIlxcL10pKFxcXFxcXDF8W15cXDFdKSo/XFwxL2c7XG5cbi8vIGZpbmRzIGFsbCBlbXB0eSBxdW90ZWQgc3RyaW5nc1xudmFyIGVtcHR5UXVvdGVFeHByID0gLyhbJ1wiXFwvXSlcXDEvZztcblxudmFyIHN0cmluZ3MgPSBudWxsO1xuXG5cbi8qKlxuICogUmVtb3ZlIHN0cmluZ3MgZnJvbSBhbiBleHByZXNzaW9uIGZvciBlYXNpZXIgcGFyc2luZy4gUmV0dXJucyBhIGxpc3Qgb2YgdGhlIHN0cmluZ3MgdG8gYWRkIGJhY2sgaW4gbGF0ZXIuXG4gKiBUaGlzIG1ldGhvZCBhY3R1YWxseSBsZWF2ZXMgdGhlIHN0cmluZyBxdW90ZSBtYXJrcyBidXQgZW1wdGllcyB0aGVtIG9mIHRoZWlyIGNvbnRlbnRzLiBUaGVuIHdoZW4gcmVwbGFjaW5nIHRoZW0gYWZ0ZXJcbiAqIHBhcnNpbmcgdGhlIGNvbnRlbnRzIGp1c3QgZ2V0IHB1dCBiYWNrIGludG8gdGhlaXIgcXVvdGVzIG1hcmtzLlxuICovXG5leHBvcnRzLnB1bGxPdXRTdHJpbmdzID0gZnVuY3Rpb24oZXhwcikge1xuICBpZiAoc3RyaW5ncykge1xuICAgIHRocm93IG5ldyBFcnJvcigncHV0SW5TdHJpbmdzIG11c3QgYmUgY2FsbGVkIGFmdGVyIHB1bGxPdXRTdHJpbmdzLicpO1xuICB9XG5cbiAgc3RyaW5ncyA9IFtdO1xuXG4gIHJldHVybiBleHByLnJlcGxhY2UocXVvdGVSZWdleCwgZnVuY3Rpb24oc3RyLCBxdW90ZSkge1xuICAgIHN0cmluZ3MucHVzaChzdHIpO1xuICAgIHJldHVybiBxdW90ZSArIHF1b3RlOyAvLyBwbGFjZWhvbGRlciBmb3IgdGhlIHN0cmluZ1xuICB9KTtcbn07XG5cblxuLyoqXG4gKiBSZXBsYWNlIHRoZSBzdHJpbmdzIHByZXZpb3VzbHkgcHVsbGVkIG91dCBhZnRlciBwYXJzaW5nIGlzIGZpbmlzaGVkLlxuICovXG5leHBvcnRzLnB1dEluU3RyaW5ncyA9IGZ1bmN0aW9uKGV4cHIpIHtcbiAgaWYgKCFzdHJpbmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdWxsT3V0U3RyaW5ncyBtdXN0IGJlIGNhbGxlZCBiZWZvcmUgcHV0SW5TdHJpbmdzLicpO1xuICB9XG5cbiAgZXhwciA9IGV4cHIucmVwbGFjZShlbXB0eVF1b3RlRXhwciwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHN0cmluZ3Muc2hpZnQoKTtcbiAgfSk7XG5cbiAgc3RyaW5ncyA9IG51bGw7XG5cbiAgcmV0dXJuIGV4cHI7XG59O1xuIiwidmFyIEZyYWdtZW50cyA9IHJlcXVpcmUoJy4vc3JjL2ZyYWdtZW50cycpO1xudmFyIE9ic2VydmVyID0gcmVxdWlyZSgnLi9zcmMvb2JzZXJ2ZXInKTtcblxuZnVuY3Rpb24gY3JlYXRlKCkge1xuICB2YXIgZnJhZ21lbnRzID0gbmV3IEZyYWdtZW50cyhPYnNlcnZlcik7XG4gIGZyYWdtZW50cy5leHByZXNzaW9ucyA9IE9ic2VydmVyLmV4cHJlc3Npb25zO1xuICBmcmFnbWVudHMuc3luYyA9IE9ic2VydmVyLnN5bmM7XG4gIGZyYWdtZW50cy5zeW5jTm93ID0gT2JzZXJ2ZXIuc3luY05vdztcbiAgZnJhZ21lbnRzLmNvbnRleHQgPSBPYnNlcnZlci5jb250ZXh0O1xuICByZXR1cm4gZnJhZ21lbnRzO1xufVxuXG4vLyBDcmVhdGUgYW4gaW5zdGFuY2Ugb2YgZnJhZ21lbnRzIHdpdGggdGhlIGRlZmF1bHQgb2JzZXJ2ZXJcbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlKCk7XG5tb2R1bGUuZXhwb3J0cy5jcmVhdGUgPSBjcmVhdGU7XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEFuaW1hdGVkQmluZGluZztcbnZhciBhbmltYXRpb24gPSByZXF1aXJlKCcuL3V0aWwvYW5pbWF0aW9uJyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIF9zdXBlciA9IEJpbmRpbmcucHJvdG90eXBlO1xuXG4vKipcbiAqIEJpbmRpbmdzIHdoaWNoIGV4dGVuZCBBbmltYXRlZEJpbmRpbmcgaGF2ZSB0aGUgYWJpbGl0eSB0byBhbmltYXRlIGVsZW1lbnRzIHRoYXQgYXJlIGFkZGVkIHRvIHRoZSBET00gYW5kIHJlbW92ZWQgZnJvbVxuICogdGhlIERPTS4gVGhpcyBhbGxvd3MgbWVudXMgdG8gc2xpZGUgb3BlbiBhbmQgY2xvc2VkLCBlbGVtZW50cyB0byBmYWRlIGluIG9yIGRyb3AgZG93biwgYW5kIHJlcGVhdGVkIGl0ZW1zIHRvIGFwcGVhclxuICogdG8gbW92ZSAoaWYgeW91IGdldCBjcmVhdGl2ZSBlbm91Z2gpLlxuICpcbiAqIFRoZSBmb2xsb3dpbmcgNSBtZXRob2RzIGFyZSBoZWxwZXIgRE9NIG1ldGhvZHMgdGhhdCBhbGxvdyByZWdpc3RlcmVkIGJpbmRpbmdzIHRvIHdvcmsgd2l0aCBDU1MgdHJhbnNpdGlvbnMgZm9yXG4gKiBhbmltYXRpbmcgZWxlbWVudHMuIElmIGFuIGVsZW1lbnQgaGFzIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIG9yIGEgbWF0Y2hpbmcgSmF2YVNjcmlwdCBtZXRob2QsIHRoZXNlIGhlbHBlciBtZXRob2RzXG4gKiB3aWxsIHNldCBhIGNsYXNzIG9uIHRoZSBub2RlIHRvIHRyaWdnZXIgdGhlIGFuaW1hdGlvbiBhbmQvb3IgY2FsbCB0aGUgSmF2YVNjcmlwdCBtZXRob2RzIHRvIGhhbmRsZSBpdC5cbiAqXG4gKiBBbiBhbmltYXRpb24gbWF5IGJlIGVpdGhlciBhIENTUyB0cmFuc2l0aW9uLCBhIENTUyBhbmltYXRpb24sIG9yIGEgc2V0IG9mIEphdmFTY3JpcHQgbWV0aG9kcyB0aGF0IHdpbGwgYmUgY2FsbGVkLlxuICpcbiAqIElmIHVzaW5nIENTUywgY2xhc3NlcyBhcmUgYWRkZWQgYW5kIHJlbW92ZWQgZnJvbSB0aGUgZWxlbWVudC4gV2hlbiBhbiBlbGVtZW50IGlzIGluc2VydGVkIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtXG4gKiBhbmltYXRlLWluYCBjbGFzcyBiZWZvcmUgYmVpbmcgYWRkZWQgdG8gdGhlIERPTSwgdGhlbiBpdCB3aWxsIHJlY2VpdmUgdGhlIGBhbmltYXRlLWluYCBjbGFzcyBpbW1lZGlhdGVseSBhZnRlciBiZWluZ1xuICogYWRkZWQgdG8gdGhlIERPTSwgdGhlbiBib3RoIGNsYXNlcyB3aWxsIGJlIHJlbW92ZWQgYWZ0ZXIgdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS4gV2hlbiBhbiBlbGVtZW50IGlzIGJlaW5nIHJlbW92ZWRcbiAqIGZyb20gdGhlIERPTSBpdCB3aWxsIHJlY2VpdmUgdGhlIGB3aWxsLWFuaW1hdGUtb3V0YCBhbmQgYGFuaW1hdGUtb3V0YCBjbGFzc2VzLCB0aGVuIHRoZSBjbGFzc2VzIHdpbGwgYmUgcmVtb3ZlZCBvbmNlXG4gKiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIElmIHVzaW5nIEphdmFTY3JpcHQsIG1ldGhvZHMgbXVzdCBiZSBkZWZpbmVkICB0byBhbmltYXRlIHRoZSBlbGVtZW50IHRoZXJlIGFyZSAzIHN1cHBvcnRlZCBtZXRob2RzIHdoaWNoIGNhbiBiXG4gKlxuICogVE9ETyBjYWNoZSBieSBjbGFzcy1uYW1lIChBbmd1bGFyKT8gT25seSBzdXBwb3J0IGphdmFzY3JpcHQtc3R5bGUgKEVtYmVyKT8gQWRkIGEgYHdpbGwtYW5pbWF0ZS1pbmAgYW5kXG4gKiBgZGlkLWFuaW1hdGUtaW5gIGV0Yy4/XG4gKiBJRiBoYXMgYW55IGNsYXNzZXMsIGFkZCB0aGUgYHdpbGwtYW5pbWF0ZS1pbnxvdXRgIGFuZCBnZXQgY29tcHV0ZWQgZHVyYXRpb24uIElmIG5vbmUsIHJldHVybi4gQ2FjaGUuXG4gKiBSVUxFIGlzIHVzZSB1bmlxdWUgY2xhc3MgdG8gZGVmaW5lIGFuIGFuaW1hdGlvbi4gT3IgYXR0cmlidXRlIGBhbmltYXRlPVwiZmFkZVwiYCB3aWxsIGFkZCB0aGUgY2xhc3M/XG4gKiBgLmZhZGUud2lsbC1hbmltYXRlLWluYCwgYC5mYWRlLmFuaW1hdGUtaW5gLCBgLmZhZGUud2lsbC1hbmltYXRlLW91dGAsIGAuZmFkZS5hbmltYXRlLW91dGBcbiAqXG4gKiBFdmVudHMgd2lsbCBiZSB0cmlnZ2VyZWQgb24gdGhlIGVsZW1lbnRzIG5hbWVkIHRoZSBzYW1lIGFzIHRoZSBjbGFzcyBuYW1lcyAoZS5nLiBgYW5pbWF0ZS1pbmApIHdoaWNoIG1heSBiZSBsaXN0ZW5lZFxuICogdG8gaW4gb3JkZXIgdG8gY2FuY2VsIGFuIGFuaW1hdGlvbiBvciByZXNwb25kIHRvIGl0LlxuICpcbiAqIElmIHRoZSBub2RlIGhhcyBtZXRob2RzIGBhbmltYXRlSW4oZG9uZSlgLCBgYW5pbWF0ZU91dChkb25lKWAsIGBhbmltYXRlTW92ZUluKGRvbmUpYCwgb3IgYGFuaW1hdGVNb3ZlT3V0KGRvbmUpYFxuICogZGVmaW5lZCBvbiB0aGVtIHRoZW4gdGhlIGhlbHBlcnMgd2lsbCBhbGxvdyBhbiBhbmltYXRpb24gaW4gSmF2YVNjcmlwdCB0byBiZSBydW4gYW5kIHdhaXQgZm9yIHRoZSBgZG9uZWAgZnVuY3Rpb24gdG9cbiAqIGJlIGNhbGxlZCB0byBrbm93IHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS5cbiAqXG4gKiBCZSBzdXJlIHRvIGFjdHVhbGx5IGhhdmUgYW4gYW5pbWF0aW9uIGRlZmluZWQgZm9yIGVsZW1lbnRzIHdpdGggdGhlIGBhbmltYXRlYCBjbGFzcy9hdHRyaWJ1dGUgYmVjYXVzZSB0aGUgaGVscGVycyB1c2VcbiAqIHRoZSBgdHJhbnNpdGlvbmVuZGAgYW5kIGBhbmltYXRpb25lbmRgIGV2ZW50cyB0byBrbm93IHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBmaW5pc2hlZCwgYW5kIGlmIHRoZXJlIGlzIG5vIGFuaW1hdGlvblxuICogdGhlc2UgZXZlbnRzIHdpbGwgbmV2ZXIgYmUgdHJpZ2dlcmVkIGFuZCB0aGUgb3BlcmF0aW9uIHdpbGwgbmV2ZXIgY29tcGxldGUuXG4gKi9cbmZ1bmN0aW9uIEFuaW1hdGVkQmluZGluZyhwcm9wZXJ0aWVzKSB7XG4gIHZhciBlbGVtZW50ID0gcHJvcGVydGllcy5ub2RlO1xuICB2YXIgYW5pbWF0ZSA9IGVsZW1lbnQuZ2V0QXR0cmlidXRlKHByb3BlcnRpZXMuZnJhZ21lbnRzLmFuaW1hdGVBdHRyaWJ1dGUpO1xuICB2YXIgZnJhZ21lbnRzID0gcHJvcGVydGllcy5mcmFnbWVudHM7XG5cbiAgaWYgKGFuaW1hdGUgIT09IG51bGwpIHtcbiAgICBpZiAoZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1RFTVBMQVRFJyB8fCBlbGVtZW50Lm5vZGVOYW1lID09PSAnU0NSSVBUJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgYW5pbWF0ZSBtdWx0aXBsZSBub2RlcyBpbiBhIHRlbXBsYXRlIG9yIHNjcmlwdC4gUmVtb3ZlIHRoZSBbYW5pbWF0ZV0gYXR0cmlidXRlLicpO1xuICAgIH1cblxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAvLyBBbGxvdyBtdWx0aXBsZSBiaW5kaW5ncyB0byBhbmltYXRlIGJ5IG5vdCByZW1vdmluZyB1bnRpbCB0aGV5IGhhdmUgYWxsIGJlZW4gY3JlYXRlZFxuICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUocHJvcGVydGllcy5mcmFnbWVudHMuYW5pbWF0ZUF0dHJpYnV0ZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFuaW1hdGUgPSB0cnVlO1xuXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCBhbmltYXRlKSkge1xuICAgICAgLy8gamF2YXNjcmlwdCBhbmltYXRpb25cbiAgICAgIHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgYW5pbWF0ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChhbmltYXRlWzBdID09PSAnLicpIHtcbiAgICAgICAgLy8gY2xhc3MgYW5pbWF0aW9uXG4gICAgICAgIHRoaXMuYW5pbWF0ZUNsYXNzTmFtZSA9IGFuaW1hdGUuc2xpY2UoMSk7XG4gICAgICB9IGVsc2UgaWYgKGFuaW1hdGUpIHtcbiAgICAgICAgLy8gcmVnaXN0ZXJlZCBhbmltYXRpb25cbiAgICAgICAgdmFyIGFuaW1hdGVPYmplY3QgPSBmcmFnbWVudHMuZ2V0QW5pbWF0aW9uKGFuaW1hdGUpO1xuICAgICAgICBpZiAodHlwZW9mIGFuaW1hdGVPYmplY3QgPT09ICdmdW5jdGlvbicpIGFuaW1hdGVPYmplY3QgPSBuZXcgYW5pbWF0ZU9iamVjdCh0aGlzKTtcbiAgICAgICAgdGhpcy5hbmltYXRlT2JqZWN0ID0gYW5pbWF0ZU9iamVjdDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBCaW5kaW5nLmNhbGwodGhpcywgcHJvcGVydGllcyk7XG59XG5cblxuQmluZGluZy5leHRlbmQoQW5pbWF0ZWRCaW5kaW5nLCB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIF9zdXBlci5pbml0LmNhbGwodGhpcyk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlRXhwcmVzc2lvbikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIgPSBuZXcgdGhpcy5PYnNlcnZlcih0aGlzLmFuaW1hdGVFeHByZXNzaW9uLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSB2YWx1ZTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH1cbiAgfSxcblxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci5iaW5kLmNhbGwodGhpcywgY29udGV4dCk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgfVxuICB9LFxuXG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBfc3VwZXIudW5iaW5kLmNhbGwodGhpcyk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyLnVuYmluZCgpO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byByZW1vdmUgYSBub2RlIGZyb20gdGhlIERPTSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbCBiZSBjYWxsZWQgd2hlblxuICAgKiBmaW5pc2hlZC5cbiAgICovXG4gIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKG5vZGUuZmlyc3RWaWV3Tm9kZSkgbm9kZSA9IG5vZGUuZmlyc3RWaWV3Tm9kZTtcblxuICAgIHRoaXMuYW5pbWF0ZU5vZGUoJ291dCcsIG5vZGUsIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKHRoaXMpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8qKlxuICAgKiBIZWxwZXIgbWV0aG9kIHRvIGluc2VydCBhIG5vZGUgaW4gdGhlIERPTSBiZWZvcmUgYW5vdGhlciBub2RlLCBhbGxvd2luZyBmb3IgYW5pbWF0aW9ucyB0byBvY2N1ci4gYGNhbGxiYWNrYCB3aWxsXG4gICAqIGJlIGNhbGxlZCB3aGVuIGZpbmlzaGVkLiBJZiBgYmVmb3JlYCBpcyBub3QgcHJvdmlkZWQgdGhlbiB0aGUgYW5pbWF0aW9uIHdpbGwgYmUgcnVuIHdpdGhvdXQgaW5zZXJ0aW5nIHRoZSBub2RlLlxuICAgKi9cbiAgYW5pbWF0ZUluOiBmdW5jdGlvbihub2RlLCBjYWxsYmFjaykge1xuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG4gICAgdGhpcy5hbmltYXRlTm9kZSgnaW4nLCBub2RlLCBjYWxsYmFjaywgdGhpcyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFsbG93IGFuIGVsZW1lbnQgdG8gdXNlIENTUzMgdHJhbnNpdGlvbnMgb3IgYW5pbWF0aW9ucyB0byBhbmltYXRlIGluIG9yIG91dCBvZiB0aGUgcGFnZS5cbiAgICovXG4gIGFuaW1hdGVOb2RlOiBmdW5jdGlvbihkaXJlY3Rpb24sIG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFuaW1hdGVPYmplY3QsIGNsYXNzTmFtZSwgbmFtZSwgd2lsbE5hbWUsIGRpZE5hbWUsIF90aGlzID0gdGhpcztcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYmplY3QgJiYgdHlwZW9mIHRoaXMuYW5pbWF0ZU9iamVjdCA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGFuaW1hdGVPYmplY3QgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFuaW1hdGVDbGFzc05hbWUpIHtcbiAgICAgIGNsYXNzTmFtZSA9IHRoaXMuYW5pbWF0ZUNsYXNzTmFtZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfVxuXG4gICAgaWYgKGFuaW1hdGVPYmplY3QpIHtcbiAgICAgIHZhciBkaXIgPSBkaXJlY3Rpb24gPT09ICdpbicgPyAnSW4nIDogJ091dCc7XG4gICAgICBuYW1lID0gJ2FuaW1hdGUnICsgZGlyO1xuICAgICAgd2lsbE5hbWUgPSAnd2lsbEFuaW1hdGUnICsgZGlyO1xuICAgICAgZGlkTmFtZSA9ICdkaWRBbmltYXRlJyArIGRpcjtcblxuICAgICAgYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZShub2RlKTtcblxuICAgICAgaWYgKGFuaW1hdGVPYmplY3Rbd2lsbE5hbWVdKSB7XG4gICAgICAgIGFuaW1hdGVPYmplY3Rbd2lsbE5hbWVdKG5vZGUpO1xuICAgICAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgICAgICBub2RlLm9mZnNldFdpZHRoID0gbm9kZS5vZmZzZXRXaWR0aDtcbiAgICAgIH1cblxuICAgICAgaWYgKGFuaW1hdGVPYmplY3RbbmFtZV0pIHtcbiAgICAgICAgYW5pbWF0ZU9iamVjdFtuYW1lXShub2RlLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICBpZiAoYW5pbWF0ZU9iamVjdFtkaWROYW1lXSkgYW5pbWF0ZU9iamVjdFtkaWROYW1lXShub2RlKTtcbiAgICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwoX3RoaXMpO1xuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgbmFtZSA9ICdhbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgICB3aWxsTmFtZSA9ICd3aWxsLWFuaW1hdGUtJyArIGRpcmVjdGlvbjtcbiAgICAgIGlmIChjbGFzc05hbWUpIG5vZGUuY2xhc3NMaXN0LmFkZChjbGFzc05hbWUpO1xuXG4gICAgICBub2RlLmNsYXNzTGlzdC5hZGQod2lsbE5hbWUpO1xuXG4gICAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgICAgbm9kZS5vZmZzZXRXaWR0aCA9IG5vZGUub2Zmc2V0V2lkdGg7XG5cbiAgICAgIG5vZGUuY2xhc3NMaXN0LmFkZChuYW1lKTtcbiAgICAgIG5vZGUuY2xhc3NMaXN0LnJlbW92ZSh3aWxsTmFtZSk7XG5cbiAgICAgIHZhciBkdXJhdGlvbiA9IGdldER1cmF0aW9uLmNhbGwodGhpcywgbm9kZSwgZGlyZWN0aW9uKTtcbiAgICAgIHZhciB3aGVuRG9uZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgICBpZiAoY2FsbGJhY2spIGNhbGxiYWNrLmNhbGwoX3RoaXMpO1xuICAgICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUobmFtZSk7XG4gICAgICAgIGlmIChjbGFzc05hbWUpIG5vZGUuY2xhc3NMaXN0LnJlbW92ZShjbGFzc05hbWUpO1xuICAgICAgfTtcblxuICAgICAgaWYgKGR1cmF0aW9uKSB7XG4gICAgICAgIG9uQW5pbWF0aW9uRW5kKG5vZGUsIGR1cmF0aW9uLCB3aGVuRG9uZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3aGVuRG9uZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufSk7XG5cblxudmFyIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAndHJhbnNpdGlvbkR1cmF0aW9uJztcbnZhciB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3RyYW5zaXRpb25EZWxheSc7XG52YXIgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ2FuaW1hdGlvbkR1cmF0aW9uJztcbnZhciBhbmltYXRpb25EZWxheU5hbWUgPSAnYW5pbWF0aW9uRGVsYXknO1xudmFyIHRyYW5zaXRpb25FdmVudE5hbWUgPSAndHJhbnNpdGlvbmVuZCc7XG52YXIgYW5pbWF0aW9uRXZlbnROYW1lID0gJ2FuaW1hdGlvbmVuZCc7XG52YXIgc3R5bGUgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGU7XG5cblsnd2Via2l0JywgJ21veicsICdtcycsICdvJ10uZm9yRWFjaChmdW5jdGlvbihwcmVmaXgpIHtcbiAgaWYgKHN0eWxlLnRyYW5zaXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlW3ByZWZpeCArICdUcmFuc2l0aW9uRHVyYXRpb24nXSkge1xuICAgIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSBwcmVmaXggKyAnVHJhbnNpdGlvbkR1cmF0aW9uJztcbiAgICB0cmFuc2l0aW9uRGVsYXlOYW1lID0gcHJlZml4ICsgJ1RyYW5zaXRpb25EZWxheSc7XG4gICAgdHJhbnNpdGlvbkV2ZW50TmFtZSA9IHByZWZpeCArICd0cmFuc2l0aW9uZW5kJztcbiAgfVxuXG4gIGlmIChzdHlsZS5hbmltYXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlW3ByZWZpeCArICdBbmltYXRpb25EdXJhdGlvbiddKSB7XG4gICAgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gcHJlZml4ICsgJ0FuaW1hdGlvbkR1cmF0aW9uJztcbiAgICBhbmltYXRpb25EZWxheU5hbWUgPSBwcmVmaXggKyAnQW5pbWF0aW9uRGVsYXknO1xuICAgIGFuaW1hdGlvbkV2ZW50TmFtZSA9IHByZWZpeCArICdhbmltYXRpb25lbmQnO1xuICB9XG59KTtcblxuXG5mdW5jdGlvbiBnZXREdXJhdGlvbihub2RlLCBkaXJlY3Rpb24pIHtcbiAgdmFyIG1pbGxpc2Vjb25kcyA9IHRoaXMuY2xvbmVkRnJvbVsnX19hbmltYXRpb25EdXJhdGlvbicgKyBkaXJlY3Rpb25dO1xuICBpZiAoIW1pbGxpc2Vjb25kcykge1xuICAgIC8vIFJlY2FsYyBpZiBub2RlIHdhcyBvdXQgb2YgRE9NIGJlZm9yZSBhbmQgaGFkIDAgZHVyYXRpb24sIGFzc3VtZSB0aGVyZSBpcyBhbHdheXMgU09NRSBkdXJhdGlvbi5cbiAgICB2YXIgc3R5bGVzID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgdmFyIHNlY29uZHMgPSBNYXRoLm1heChwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRHVyYXRpb25OYW1lXSB8fCAwKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRGVsYXlOYW1lXSB8fCAwKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW2FuaW1hdGlvbkR1cmF0aW9uTmFtZV0gfHwgMCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbYW5pbWF0aW9uRGVsYXlOYW1lXSB8fCAwKSk7XG4gICAgbWlsbGlzZWNvbmRzID0gc2Vjb25kcyAqIDEwMDAgfHwgMDtcbiAgICB0aGlzLmNsb25lZEZyb20uX19hbmltYXRpb25EdXJhdGlvbl9fID0gbWlsbGlzZWNvbmRzO1xuICB9XG4gIHJldHVybiBtaWxsaXNlY29uZHM7XG59XG5cblxuZnVuY3Rpb24gb25BbmltYXRpb25FbmQobm9kZSwgZHVyYXRpb24sIGNhbGxiYWNrKSB7XG4gIHZhciBvbkVuZCA9IGZ1bmN0aW9uKCkge1xuICAgIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcih0cmFuc2l0aW9uRXZlbnROYW1lLCBvbkVuZCk7XG4gICAgbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKGFuaW1hdGlvbkV2ZW50TmFtZSwgb25FbmQpO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICBjYWxsYmFjaygpO1xuICB9O1xuXG4gIC8vIGNvbnRpbmdlbmN5IHBsYW5cbiAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KG9uRW5kLCBkdXJhdGlvbiArIDEwKTtcblxuICBub2RlLmFkZEV2ZW50TGlzdGVuZXIodHJhbnNpdGlvbkV2ZW50TmFtZSwgb25FbmQpO1xuICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoYW5pbWF0aW9uRXZlbnROYW1lLCBvbkVuZCk7XG59IiwibW9kdWxlLmV4cG9ydHMgPSBCaW5kaW5nO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcblxuLyoqXG4gKiBBIGJpbmRpbmcgaXMgYSBsaW5rIGJldHdlZW4gYW4gZWxlbWVudCBhbmQgc29tZSBkYXRhLiBTdWJjbGFzc2VzIG9mIEJpbmRpbmcgY2FsbGVkIGJpbmRlcnMgZGVmaW5lIHdoYXQgYSBiaW5kaW5nIGRvZXNcbiAqIHdpdGggdGhhdCBsaW5rLiBJbnN0YW5jZXMgb2YgdGhlc2UgYmluZGVycyBhcmUgY3JlYXRlZCBhcyBiaW5kaW5ncyBvbiB0ZW1wbGF0ZXMuIFdoZW4gYSB2aWV3IGlzIHN0YW1wZWQgb3V0IGZyb20gdGhlXG4gKiB0ZW1wbGF0ZSB0aGUgYmluZGluZyBpcyBcImNsb25lZFwiIChpdCBpcyBhY3R1YWxseSBleHRlbmRlZCBmb3IgcGVyZm9ybWFuY2UpIGFuZCB0aGUgYGVsZW1lbnRgL2Bub2RlYCBwcm9wZXJ0eSBpc1xuICogdXBkYXRlZCB0byB0aGUgbWF0Y2hpbmcgZWxlbWVudCBpbiB0aGUgdmlldy5cbiAqXG4gKiAjIyMgUHJvcGVydGllc1xuICogICogZWxlbWVudDogVGhlIGVsZW1lbnQgKG9yIHRleHQgbm9kZSkgdGhpcyBiaW5kaW5nIGlzIGJvdW5kIHRvXG4gKiAgKiBub2RlOiBBbGlhcyBvZiBlbGVtZW50LCBzaW5jZSBiaW5kaW5ncyBtYXkgYXBwbHkgdG8gdGV4dCBub2RlcyB0aGlzIGlzIG1vcmUgYWNjdXJhdGVcbiAqICAqIG5hbWU6IFRoZSBhdHRyaWJ1dGUgb3IgZWxlbWVudCBuYW1lIChkb2VzIG5vdCBhcHBseSB0byBtYXRjaGVkIHRleHQgbm9kZXMpXG4gKiAgKiBtYXRjaDogVGhlIG1hdGNoZWQgcGFydCBvZiB0aGUgbmFtZSBmb3Igd2lsZGNhcmQgYXR0cmlidXRlcyAoZS5nLiBgb24tKmAgbWF0Y2hpbmcgYWdhaW5zdCBgb24tY2xpY2tgIHdvdWxkIGhhdmUgYVxuICogICAgbWF0Y2ggcHJvcGVydHkgZXF1YWxsaW5nIGBjbGlja2ApLiBVc2UgYHRoaXMuY2FtZWxDYXNlYCB0byBnZXQgdGhlIG1hdGNoIHByb2VydHkgY2FtZWxDYXNlZC5cbiAqICAqIGV4cHJlc3Npb246IFRoZSBleHByZXNzaW9uIHRoaXMgYmluZGluZyB3aWxsIHVzZSBmb3IgaXRzIHVwZGF0ZXMgKGRvZXMgbm90IGFwcGx5IHRvIG1hdGNoZWQgZWxlbWVudHMpXG4gKiAgKiBjb250ZXh0OiBUaGUgY29udGV4dCB0aGUgZXhyZXNzaW9uIG9wZXJhdGVzIHdpdGhpbiB3aGVuIGJvdW5kXG4gKi9cbmZ1bmN0aW9uIEJpbmRpbmcocHJvcGVydGllcykge1xuICBpZiAoIXByb3BlcnRpZXMubm9kZSB8fCAhcHJvcGVydGllcy52aWV3KSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQSBiaW5kaW5nIG11c3QgcmVjZWl2ZSBhIG5vZGUgYW5kIGEgdmlldycpO1xuICB9XG5cbiAgLy8gZWxlbWVudCBhbmQgbm9kZSBhcmUgYWxpYXNlc1xuICB0aGlzLl9lbGVtZW50UGF0aCA9IGluaXROb2RlUGF0aChwcm9wZXJ0aWVzLm5vZGUsIHByb3BlcnRpZXMudmlldyk7XG4gIHRoaXMubm9kZSA9IHByb3BlcnRpZXMubm9kZTtcbiAgdGhpcy5lbGVtZW50ID0gcHJvcGVydGllcy5ub2RlO1xuICB0aGlzLm5hbWUgPSBwcm9wZXJ0aWVzLm5hbWU7XG4gIHRoaXMubWF0Y2ggPSBwcm9wZXJ0aWVzLm1hdGNoO1xuICB0aGlzLmV4cHJlc3Npb24gPSBwcm9wZXJ0aWVzLmV4cHJlc3Npb247XG4gIHRoaXMuZnJhZ21lbnRzID0gcHJvcGVydGllcy5mcmFnbWVudHM7XG4gIHRoaXMuY29udGV4dCA9IG51bGw7XG59XG5cbmV4dGVuZChCaW5kaW5nLCB7XG4gIC8qKlxuICAgKiBEZWZhdWx0IHByaW9yaXR5IGJpbmRlcnMgbWF5IG92ZXJyaWRlLlxuICAgKi9cbiAgcHJpb3JpdHk6IDAsXG5cblxuICAvKipcbiAgICogSW5pdGlhbGl6ZSBhIGNsb25lZCBiaW5kaW5nLiBUaGlzIGhhcHBlbnMgYWZ0ZXIgYSBjb21waWxlZCBiaW5kaW5nIG9uIGEgdGVtcGxhdGUgaXMgY2xvbmVkIGZvciBhIHZpZXcuXG4gICAqL1xuICBpbml0OiBmdW5jdGlvbigpIHtcbiAgICBpZiAodGhpcy5leHByZXNzaW9uKSB7XG4gICAgICAvLyBBbiBvYnNlcnZlciB0byBvYnNlcnZlIHZhbHVlIGNoYW5nZXMgdG8gdGhlIGV4cHJlc3Npb24gd2l0aGluIGEgY29udGV4dFxuICAgICAgdGhpcy5vYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy51cGRhdGVkLCB0aGlzKTtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVkKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENsb25lIHRoaXMgYmluZGluZyBmb3IgYSB2aWV3LiBUaGUgZWxlbWVudC9ub2RlIHdpbGwgYmUgdXBkYXRlZCBhbmQgdGhlIGJpbmRpbmcgd2lsbCBiZSBpbml0ZWQuXG4gICAqL1xuICBjbG9uZUZvclZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IGNsb25lIGFnYWluc3QgYSB2aWV3Jyk7XG4gICAgfVxuXG4gICAgdmFyIG5vZGUgPSB2aWV3O1xuICAgIHRoaXMuX2VsZW1lbnRQYXRoLmZvckVhY2goZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkTm9kZXNbaW5kZXhdO1xuICAgIH0pO1xuXG4gICAgdmFyIGJpbmRpbmcgPSBPYmplY3QuY3JlYXRlKHRoaXMpO1xuICAgIGJpbmRpbmcuY2xvbmVkRnJvbSA9IHRoaXM7XG4gICAgYmluZGluZy5lbGVtZW50ID0gbm9kZTtcbiAgICBiaW5kaW5nLm5vZGUgPSBub2RlO1xuICAgIGJpbmRpbmcuaW5pdCgpO1xuICAgIHJldHVybiBiaW5kaW5nO1xuICB9LFxuXG5cbiAgLy8gQmluZCB0aGlzIHRvIHRoZSBnaXZlbiBjb250ZXh0IG9iamVjdFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci5jb250ZXh0ID0gY29udGV4dDtcbiAgICB0aGlzLmJvdW5kKCk7XG5cbiAgICBpZiAodGhpcy5vYnNlcnZlcikge1xuICAgICAgaWYgKHRoaXMudXBkYXRlZCAhPT0gQmluZGluZy5wcm90b3R5cGUudXBkYXRlZCkge1xuICAgICAgICB0aGlzLm9ic2VydmVyLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSB0cnVlO1xuICAgICAgICB0aGlzLm9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG5cbiAgLy8gVW5iaW5kIHRoaXMgZnJvbSBpdHMgY29udGV4dFxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci51bmJpbmQoKTtcbiAgICB0aGlzLnVuYm91bmQoKTtcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB9LFxuXG5cbiAgLy8gQ2xlYW5zIHVwIGJpbmRpbmcgY29tcGxldGVseVxuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB7XG4gICAgICAvLyBUaGlzIHdpbGwgY2xlYXIgaXQgb3V0LCBudWxsaWZ5aW5nIGFueSBkYXRhIHN0b3JlZFxuICAgICAgdGhpcy5vYnNlcnZlci5zeW5jKCk7XG4gICAgfVxuICAgIHRoaXMuZGlzcG9zZWQoKTtcbiAgfSxcblxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY29tcGlsZWQgd2l0aGluIGEgdGVtcGxhdGVcbiAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjcmVhdGVkXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBleHByZXNzaW9uJ3MgdmFsdWUgY2hhbmdlc1xuICB1cGRhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBib3VuZFxuICBib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgdW5ib3VuZFxuICB1bmJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBkaXNwb3NlZFxuICBkaXNwb3NlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBIZWxwZXIgbWV0aG9kc1xuXG4gIGdldCBjYW1lbENhc2UoKSB7XG4gICAgcmV0dXJuICh0aGlzLm1hdGNoIHx8IHRoaXMubmFtZSB8fCAnJykucmVwbGFjZSgvLSsoXFx3KS9nLCBmdW5jdGlvbihfLCBjaGFyKSB7XG4gICAgICByZXR1cm4gY2hhci50b1VwcGVyQ2FzZSgpO1xuICAgIH0pO1xuICB9LFxuXG4gIG9ic2VydmU6IGZ1bmN0aW9uKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgICByZXR1cm4gbmV3IHRoaXMuT2JzZXJ2ZXIoZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCB8fCB0aGlzKTtcbiAgfVxufSk7XG5cblxuXG5cbnZhciBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2Y7XG5cbi8vIENyZWF0ZXMgYW4gYXJyYXkgb2YgaW5kZXhlcyB0byBoZWxwIGZpbmQgdGhlIHNhbWUgZWxlbWVudCB3aXRoaW4gYSBjbG9uZWQgdmlld1xuZnVuY3Rpb24gaW5pdE5vZGVQYXRoKG5vZGUsIHZpZXcpIHtcbiAgdmFyIHBhdGggPSBbXTtcbiAgd2hpbGUgKG5vZGUgIT09IHZpZXcpIHtcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHBhdGgudW5zaGlmdChpbmRleE9mLmNhbGwocGFyZW50LmNoaWxkTm9kZXMsIG5vZGUpKTtcbiAgICBub2RlID0gcGFyZW50O1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuIiwidmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xubW9kdWxlLmV4cG9ydHMgPSBjb21waWxlO1xuXG5cbi8vIFdhbGtzIHRoZSB0ZW1wbGF0ZSBET00gcmVwbGFjaW5nIGFueSBiaW5kaW5ncyBhbmQgY2FjaGluZyBiaW5kaW5ncyBvbnRvIHRoZSB0ZW1wbGF0ZSBvYmplY3QuXG5mdW5jdGlvbiBjb21waWxlKGZyYWdtZW50cywgdGVtcGxhdGUpIHtcbiAgdmFyIHdhbGtlciA9IGRvY3VtZW50LmNyZWF0ZVRyZWVXYWxrZXIodGVtcGxhdGUsIE5vZGVGaWx0ZXIuU0hPV19FTEVNRU5UIHwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICB2YXIgYmluZGluZ3MgPSBbXSwgY3VycmVudE5vZGUsIHBhcmVudE5vZGUsIHByZXZpb3VzTm9kZTtcblxuICAvLyBSZXNldCBmaXJzdCBub2RlIHRvIGVuc3VyZSBpdCBpc24ndCBhIGZyYWdtZW50XG4gIHdhbGtlci5uZXh0Tm9kZSgpO1xuICB3YWxrZXIucHJldmlvdXNOb2RlKCk7XG5cbiAgLy8gZmluZCBiaW5kaW5ncyBmb3IgZWFjaCBub2RlXG4gIGRvIHtcbiAgICBjdXJyZW50Tm9kZSA9IHdhbGtlci5jdXJyZW50Tm9kZTtcbiAgICBwYXJlbnROb2RlID0gY3VycmVudE5vZGUucGFyZW50Tm9kZTtcbiAgICBiaW5kaW5ncy5wdXNoLmFwcGx5KGJpbmRpbmdzLCBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBjdXJyZW50Tm9kZSwgdGVtcGxhdGUpKTtcblxuICAgIGlmIChjdXJyZW50Tm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnROb2RlKSB7XG4gICAgICAvLyBjdXJyZW50Tm9kZSB3YXMgcmVtb3ZlZCBhbmQgbWFkZSBhIHRlbXBsYXRlXG4gICAgICB3YWxrZXIuY3VycmVudE5vZGUgPSBwcmV2aW91c05vZGUgfHwgd2Fsa2VyLnJvb3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZXZpb3VzTm9kZSA9IGN1cnJlbnROb2RlO1xuICAgIH1cbiAgfSB3aGlsZSAod2Fsa2VyLm5leHROb2RlKCkpO1xuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG5cbi8vIEZpbmQgYWxsIHRoZSBiaW5kaW5ncyBvbiBhIGdpdmVuIG5vZGUgKHRleHQgbm9kZXMgd2lsbCBvbmx5IGV2ZXIgaGF2ZSBvbmUgYmluZGluZykuXG5mdW5jdGlvbiBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBub2RlLCB2aWV3KSB7XG4gIHZhciBiaW5kaW5ncyA9IFtdO1xuICB2YXIgQmluZGVyLCBiaW5kaW5nLCBleHByLCBib3VuZCwgbWF0Y2gsIGF0dHIsIGksIGw7XG5cbiAgaWYgKG5vZGUubm9kZVR5cGUgPT09IE5vZGUuVEVYVF9OT0RFKSB7XG4gICAgc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIHRleHQgbm9kZVxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgndGV4dCcsIG5vZGUubm9kZVZhbHVlKSkge1xuICAgICAgZXhwciA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpO1xuICAgICAgbm9kZS5ub2RlVmFsdWUgPSAnJztcbiAgICAgIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCd0ZXh0JywgZXhwcik7XG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGV4cHJlc3Npb246IGV4cHIsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pO1xuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgdGhlIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00sIHN0b3AuIENoZWNrIGJ5IGxvb2tpbmcgYXQgaXRzIHBhcmVudE5vZGVcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHZhciBEZWZhdWx0QmluZGVyID0gZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcignX19kZWZhdWx0X18nKTtcblxuICAgIC8vIEZpbmQgYW55IGJpbmRpbmcgZm9yIHRoZSBlbGVtZW50XG4gICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2VsZW1lbnQnLCBub2RlLnRhZ05hbWUudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKEJpbmRlcikge1xuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KTtcbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgcmVtb3ZlZCwgbWFkZSBhIHRlbXBsYXRlLCBkb24ndCBjb250aW51ZSBwcm9jZXNzaW5nXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmluZCBhbmQgYWRkIGFueSBhdHRyaWJ1dGUgYmluZGluZ3Mgb24gYW4gZWxlbWVudC4gVGhlc2UgY2FuIGJlIGF0dHJpYnV0ZXMgd2hvc2UgbmFtZSBtYXRjaGVzIGEgYmluZGluZywgb3JcbiAgICAvLyB0aGV5IGNhbiBiZSBhdHRyaWJ1dGVzIHdoaWNoIGhhdmUgYSBiaW5kaW5nIGluIHRoZSB2YWx1ZSBzdWNoIGFzIGBocmVmPVwiL3Bvc3Qve3sgcG9zdC5pZCB9fVwiYC5cbiAgICBib3VuZCA9IFtdO1xuICAgIHZhciBhdHRyaWJ1dGVzID0gc2xpY2UuY2FsbChub2RlLmF0dHJpYnV0ZXMpO1xuICAgIGZvciAoaSA9IDAsIGwgPSBhdHRyaWJ1dGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgYXR0ciA9IGF0dHJpYnV0ZXNbaV07XG4gICAgICBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignYXR0cmlidXRlJywgYXR0ci5uYW1lLCBhdHRyLnZhbHVlKTtcbiAgICAgIGlmIChCaW5kZXIpIHtcbiAgICAgICAgYm91bmQucHVzaChbIEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYWtlIHN1cmUgdG8gY3JlYXRlIGFuZCBwcm9jZXNzIHRoZW0gaW4gdGhlIGNvcnJlY3QgcHJpb3JpdHkgb3JkZXIgc28gaWYgYSBiaW5kaW5nIGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gdGhlXG4gICAgLy8gbm9kZSBpdCBkb2Vzbid0IHByb2Nlc3MgdGhlIG90aGVycy5cbiAgICBib3VuZC5zb3J0KHNvcnRBdHRyaWJ1dGVzKTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBib3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgQmluZGVyID0gYm91bmRbaV1bMF07XG4gICAgICBhdHRyID0gYm91bmRbaV1bMV07XG4gICAgICBpZiAoIW5vZGUuaGFzQXR0cmlidXRlKGF0dHIubmFtZSkpIHtcbiAgICAgICAgLy8gSWYgdGhpcyB3YXMgcmVtb3ZlZCBhbHJlYWR5IGJ5IGFub3RoZXIgYmluZGluZywgZG9uJ3QgcHJvY2Vzcy5cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB2YXIgbmFtZSA9IGF0dHIubmFtZTtcbiAgICAgIHZhciB2YWx1ZSA9IGF0dHIudmFsdWU7XG4gICAgICBpZiAoQmluZGVyLmV4cHIpIHtcbiAgICAgICAgbWF0Y2ggPSBuYW1lLm1hdGNoKEJpbmRlci5leHByKTtcbiAgICAgICAgaWYgKG1hdGNoKSBtYXRjaCA9IG1hdGNoWzFdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWF0Y2ggPSBudWxsO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyLm5hbWUpO1xuICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIC8vIGlmIHRoZSBhdHRyaWJ1dGUgd2FzIGFscmVhZHkgcmVtb3ZlZCBkb24ndCB3b3JyeVxuICAgICAgfVxuXG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7XG4gICAgICAgIG5vZGU6IG5vZGUsXG4gICAgICAgIHZpZXc6IHZpZXcsXG4gICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgIG1hdGNoOiBtYXRjaCxcbiAgICAgICAgZXhwcmVzc2lvbjogdmFsdWUgPyBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgdmFsdWUpIDogbnVsbCxcbiAgICAgICAgZnJhZ21lbnRzOiBmcmFnbWVudHNcbiAgICAgIH0pO1xuXG4gICAgICBpZiAoYmluZGluZy5jb21waWxlZCgpICE9PSBmYWxzZSkge1xuICAgICAgICBiaW5kaW5ncy5wdXNoKGJpbmRpbmcpO1xuICAgICAgfSBlbHNlIGlmIChCaW5kZXIgIT09IERlZmF1bHRCaW5kZXIgJiYgZnJhZ21lbnRzLmlzQm91bmQoJ2F0dHJpYnV0ZScsIHZhbHVlKSkge1xuICAgICAgICAvLyBSZXZlcnQgdG8gZGVmYXVsdCBpZiB0aGlzIGJpbmRpbmcgZG9lc24ndCB0YWtlXG4gICAgICAgIGJvdW5kLnB1c2goWyBEZWZhdWx0QmluZGVyLCBhdHRyIF0pO1xuICAgICAgfVxuXG4gICAgICBpZiAobm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnQpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJpbmRpbmdzO1xufVxuXG5cbi8vIFNwbGl0cyB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSBzbyB0aGV5IGNhbiBiZSBib3VuZCBpbmRpdmlkdWFsbHksIGhhcyBwYXJlbnROb2RlIHBhc3NlZCBpbiBzaW5jZSBpdCBtYXlcbi8vIGJlIGEgZG9jdW1lbnQgZnJhZ21lbnQgd2hpY2ggYXBwZWFycyBhcyBudWxsIG9uIG5vZGUucGFyZW50Tm9kZS5cbmZ1bmN0aW9uIHNwbGl0VGV4dE5vZGUoZnJhZ21lbnRzLCBub2RlKSB7XG4gIGlmICghbm9kZS5wcm9jZXNzZWQpIHtcbiAgICBub2RlLnByb2Nlc3NlZCA9IHRydWU7XG4gICAgdmFyIHJlZ2V4ID0gZnJhZ21lbnRzLmJpbmRlcnMudGV4dC5fZXhwcjtcbiAgICB2YXIgY29udGVudCA9IG5vZGUubm9kZVZhbHVlO1xuICAgIGlmIChjb250ZW50Lm1hdGNoKHJlZ2V4KSkge1xuICAgICAgdmFyIG1hdGNoLCBsYXN0SW5kZXggPSAwLCBwYXJ0cyA9IFtdLCBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSkge1xuICAgICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4LCByZWdleC5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpKTtcbiAgICAgICAgcGFydHMucHVzaChtYXRjaFswXSk7XG4gICAgICAgIGxhc3RJbmRleCA9IHJlZ2V4Lmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goY29udGVudC5zbGljZShsYXN0SW5kZXgpKTtcbiAgICAgIHBhcnRzID0gcGFydHMuZmlsdGVyKG5vdEVtcHR5KTtcblxuICAgICAgbm9kZS5ub2RlVmFsdWUgPSBwYXJ0c1swXTtcbiAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5ld1RleHROb2RlID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUocGFydHNbaV0pO1xuICAgICAgICBuZXdUZXh0Tm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChuZXdUZXh0Tm9kZSk7XG4gICAgICB9XG4gICAgICBub2RlLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBub2RlLm5leHRTaWJsaW5nKTtcbiAgICB9XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBzb3J0QXR0cmlidXRlcyhhLCBiKSB7XG4gIHJldHVybiBiWzBdLnByb3RvdHlwZS5wcmlvcml0eSAtIGFbMF0ucHJvdG90eXBlLnByaW9yaXR5O1xufVxuXG5mdW5jdGlvbiBub3RFbXB0eSh2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEZyYWdtZW50cztcbnJlcXVpcmUoJy4vdXRpbC9wb2x5ZmlsbHMnKTtcbnZhciBleHRlbmQgPSByZXF1aXJlKCcuL3V0aWwvZXh0ZW5kJyk7XG52YXIgdG9GcmFnbWVudCA9IHJlcXVpcmUoJy4vdXRpbC90b0ZyYWdtZW50Jyk7XG52YXIgYW5pbWF0aW9uID0gcmVxdWlyZSgnLi91dGlsL2FuaW1hdGlvbicpO1xudmFyIFRlbXBsYXRlID0gcmVxdWlyZSgnLi90ZW1wbGF0ZScpO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBCaW5kaW5nID0gcmVxdWlyZSgnLi9iaW5kaW5nJyk7XG52YXIgQW5pbWF0ZWRCaW5kaW5nID0gcmVxdWlyZSgnLi9hbmltYXRlZEJpbmRpbmcnKTtcbnZhciBjb21waWxlID0gcmVxdWlyZSgnLi9jb21waWxlJyk7XG52YXIgcmVnaXN0ZXJEZWZhdWx0QmluZGVycyA9IHJlcXVpcmUoJy4vcmVnaXN0ZXJlZC9iaW5kZXJzJyk7XG52YXIgcmVnaXN0ZXJEZWZhdWx0Rm9ybWF0dGVycyA9IHJlcXVpcmUoJy4vcmVnaXN0ZXJlZC9mb3JtYXR0ZXJzJyk7XG52YXIgcmVnaXN0ZXJEZWZhdWx0QW5pbWF0aW9ucyA9IHJlcXVpcmUoJy4vcmVnaXN0ZXJlZC9hbmltYXRpb25zJyk7XG5cbi8qKlxuICogQSBGcmFnbWVudHMgb2JqZWN0IHNlcnZlcyBhcyBhIHJlZ2lzdHJ5IGZvciBiaW5kZXJzIGFuZCBmb3JtYXR0ZXJzXG4gKiBAcGFyYW0ge1t0eXBlXX0gT2JzZXJ2ZXJDbGFzcyBbZGVzY3JpcHRpb25dXG4gKi9cbmZ1bmN0aW9uIEZyYWdtZW50cyhPYnNlcnZlckNsYXNzKSB7XG4gIGlmICghT2JzZXJ2ZXJDbGFzcykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ011c3QgcHJvdmlkZSBhbiBPYnNlcnZlciBjbGFzcyB0byBGcmFnbWVudHMuJyk7XG4gIH1cblxuICB0aGlzLk9ic2VydmVyID0gT2JzZXJ2ZXJDbGFzcztcbiAgdGhpcy5nbG9iYWxzID0gT2JzZXJ2ZXJDbGFzcy5nbG9iYWxzID0ge307XG4gIHRoaXMuZm9ybWF0dGVycyA9IE9ic2VydmVyQ2xhc3MuZm9ybWF0dGVycyA9IHt9O1xuICB0aGlzLmFuaW1hdGlvbnMgPSB7fTtcbiAgdGhpcy5hbmltYXRlQXR0cmlidXRlID0gJ2FuaW1hdGUnO1xuXG4gIHRoaXMuYmluZGVycyA9IHtcbiAgICBlbGVtZW50OiB7IF93aWxkY2FyZHM6IFtdIH0sXG4gICAgYXR0cmlidXRlOiB7IF93aWxkY2FyZHM6IFtdLCBfZXhwcjogL3t7XFxzKiguKj8pXFxzKn19L2cgfSxcbiAgICB0ZXh0OiB7IF93aWxkY2FyZHM6IFtdLCBfZXhwcjogL3t7XFxzKiguKj8pXFxzKn19L2cgfVxuICB9O1xuXG4gIC8vIFRleHQgYmluZGVyIGZvciB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyVGV4dCgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9ICh2YWx1ZSAhPSBudWxsKSA/IHZhbHVlIDogJyc7XG4gIH0pO1xuXG4gIC8vIENhdGNoYWxsIGF0dHJpYnV0ZSBiaW5kZXIgZm9yIHJlZ3VsYXIgYXR0cmlidXRlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW1cbiAgdGhpcy5yZWdpc3RlckF0dHJpYnV0ZSgnX19kZWZhdWx0X18nLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICh2YWx1ZSAhPSBudWxsKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuc2V0QXR0cmlidXRlKHRoaXMubmFtZSwgdmFsdWUpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKHRoaXMubmFtZSk7XG4gICAgfVxuICB9KTtcblxuICByZWdpc3RlckRlZmF1bHRCaW5kZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRGb3JtYXR0ZXJzKHRoaXMpO1xuICByZWdpc3RlckRlZmF1bHRBbmltYXRpb25zKHRoaXMpO1xufVxuXG5GcmFnbWVudHMucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gICAqIEluc3RhbmNlcyBtYXkgdGhlbiBiZSBjcmVhdGVkIGFuZCBib3VuZCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqIEBwYXJhbSB7U3RyaW5nfE5vZGVMaXN0fEhUTUxDb2xsZWN0aW9ufEhUTUxUZW1wbGF0ZUVsZW1lbnR8SFRNTFNjcmlwdEVsZW1lbnR8Tm9kZX0gaHRtbCBBIFRlbXBsYXRlIGNhbiBiZSBjcmVhdGVkXG4gICAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gICAqIGNsb25lLiBOb2RlcyBhbmQgZWxlbWVudHMgcGFzc2VkIGluIHdpbGwgYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uXG4gICAqL1xuICBjcmVhdGVUZW1wbGF0ZTogZnVuY3Rpb24oaHRtbCkge1xuICAgIHZhciBmcmFnbWVudCA9IHRvRnJhZ21lbnQoaHRtbCk7XG4gICAgaWYgKGZyYWdtZW50LmNoaWxkTm9kZXMubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0Nhbm5vdCBjcmVhdGUgYSB0ZW1wbGF0ZSBmcm9tICcgKyBodG1sKTtcbiAgICB9XG4gICAgdmFyIHRlbXBsYXRlID0gZXh0ZW5kLm1ha2UoVGVtcGxhdGUsIGZyYWdtZW50KTtcbiAgICB0ZW1wbGF0ZS5iaW5kaW5ncyA9IGNvbXBpbGUodGhpcywgdGVtcGxhdGUpO1xuICAgIHJldHVybiB0ZW1wbGF0ZTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb21waWxlcyBiaW5kaW5ncyBvbiBhbiBlbGVtZW50LlxuICAgKi9cbiAgY29tcGlsZUVsZW1lbnQ6IGZ1bmN0aW9uKGVsZW1lbnQpIHtcbiAgICBpZiAoIWVsZW1lbnQuYmluZGluZ3MpIHtcbiAgICAgIGVsZW1lbnQuYmluZGluZ3MgPSBjb21waWxlKHRoaXMsIGVsZW1lbnQpO1xuICAgICAgZXh0ZW5kLm1ha2UoVmlldywgZWxlbWVudCwgZWxlbWVudCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYW5kIGJpbmRzIGFuIGVsZW1lbnQgd2hpY2ggd2FzIG5vdCBjcmVhdGVkIGZyb20gYSB0ZW1wbGF0ZS4gTW9zdGx5IG9ubHkgdXNlZCBmb3IgYmluZGluZyB0aGUgZG9jdW1lbnQnc1xuICAgKiBodG1sIGVsZW1lbnQuXG4gICAqL1xuICBiaW5kRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCwgY29udGV4dCkge1xuICAgIHRoaXMuY29tcGlsZUVsZW1lbnQoZWxlbWVudCk7XG5cbiAgICBpZiAoY29udGV4dCkge1xuICAgICAgZWxlbWVudC5iaW5kKGNvbnRleHQpO1xuICAgIH1cblxuICAgIHJldHVybiBlbGVtZW50O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIE9ic2VydmVzIGFuIGV4cHJlc3Npb24gd2l0aGluIGEgZ2l2ZW4gY29udGV4dCwgY2FsbGluZyB0aGUgY2FsbGJhY2sgd2hlbiBpdCBjaGFuZ2VzIGFuZCByZXR1cm5pbmcgdGhlIG9ic2VydmVyLlxuICAgKi9cbiAgb2JzZXJ2ZTogZnVuY3Rpb24oY29udGV4dCwgZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICAgIHZhciBvYnNlcnZlciA9IG5ldyB0aGlzLk9ic2VydmVyKGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpO1xuICAgIG9ic2VydmVyLmJpbmQoY29udGV4dCwgdHJ1ZSk7XG4gICAgcmV0dXJuIG9ic2VydmVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVycyBhIGJpbmRlciBmb3IgYSBnaXZlbiB0eXBlIGFuZCBuYW1lLiBBIGJpbmRlciBpcyBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgYW5kIGlzIHVzZWQgdG8gY3JlYXRlIGJpbmRpbmdzIG9uXG4gICAqIGFuIGVsZW1lbnQgb3IgdGV4dCBub2RlIHdob3NlIHRhZyBuYW1lLCBhdHRyaWJ1dGUgbmFtZSwgb3IgZXhwcmVzc2lvbiBjb250ZW50cyBtYXRjaCB0aGlzIGJpbmRlcidzIG5hbWUvZXhwcmVzc2lvbi5cbiAgICpcbiAgICogIyMjIFBhcmFtZXRlcnNcbiAgICpcbiAgICogICogYHR5cGVgOiB0aGVyZSBhcmUgdGhyZWUgdHlwZXMgb2YgYmluZGVyczogZWxlbWVudCwgYXR0cmlidXRlLCBvciB0ZXh0LiBUaGVzZSBjb3JyZXNwb25kIHRvIG1hdGNoaW5nIGFnYWluc3QgYW5cbiAgICogICAgZWxlbWVudCdzIHRhZyBuYW1lLCBhbiBlbGVtZW50IHdpdGggdGhlIGdpdmVuIGF0dHJpYnV0ZSBuYW1lLCBvciBhIHRleHQgbm9kZSB0aGF0IG1hdGNoZXMgdGhlIHByb3ZpZGVkXG4gICAqICAgIGV4cHJlc3Npb24uXG4gICAqXG4gICAqICAqIGBuYW1lYDogdG8gbWF0Y2gsIGEgYmluZGVyIG5lZWRzIHRoZSBuYW1lIG9mIGFuIGVsZW1lbnQgb3IgYXR0cmlidXRlLCBvciBhIHJlZ3VsYXIgZXhwcmVzc2lvbiB0aGF0IG1hdGNoZXMgYVxuICAgKiAgICBnaXZlbiB0ZXh0IG5vZGUuIE5hbWVzIGZvciBlbGVtZW50cyBhbmQgYXR0cmlidXRlcyBjYW4gYmUgcmVndWxhciBleHByZXNzaW9ucyBhcyB3ZWxsLCBvciB0aGV5IG1heSBiZSB3aWxkY2FyZFxuICAgKiAgICBuYW1lcyBieSB1c2luZyBhbiBhc3Rlcmlzay5cbiAgICpcbiAgICogICogYGRlZmluaXRpb25gOiBhIGJpbmRlciBpcyBhIHN1YmNsYXNzIG9mIEJpbmRpbmcgd2hpY2ggb3ZlcnJpZGVzIGtleSBtZXRob2RzLCBgY29tcGlsZWRgLCBgY3JlYXRlZGAsIGB1cGRhdGVkYCxcbiAgICogICAgYGJvdW5kYCwgYW5kIGB1bmJvdW5kYC4gVGhlIGRlZmluaXRpb24gbWF5IGJlIGFuIGFjdHVhbCBzdWJjbGFzcyBvZiBCaW5kaW5nIG9yIGl0IG1heSBiZSBhbiBvYmplY3Qgd2hpY2ggd2lsbCBiZVxuICAgKiAgICB1c2VkIGZvciB0aGUgcHJvdG90eXBlIG9mIHRoZSBuZXdseSBjcmVhdGVkIHN1YmNsYXNzLiBGb3IgbWFueSBiaW5kaW5ncyBvbmx5IHRoZSBgdXBkYXRlZGAgbWV0aG9kIGlzIG92ZXJyaWRkZW4sXG4gICAqICAgIHNvIGJ5IGp1c3QgcGFzc2luZyBpbiBhIGZ1bmN0aW9uIGZvciBgZGVmaW5pdGlvbmAgdGhlIGJpbmRlciB3aWxsIGJlIGNyZWF0ZWQgd2l0aCB0aGF0IGFzIGl0cyBgdXBkYXRlZGAgbWV0aG9kLlxuICAgKlxuICAgKiAjIyMgRXhwbGFpbmF0aW9uIG9mIHByb3BlcnRpZXMgYW5kIG1ldGhvZHNcbiAgICpcbiAgICogICAqIGBwcmlvcml0eWAgbWF5IGJlIGRlZmluZWQgYXMgbnVtYmVyIHRvIGluc3RydWN0IHNvbWUgYmluZGVycyB0byBiZSBwcm9jZXNzZWQgYmVmb3JlIG90aGVycy4gQmluZGVycyB3aXRoXG4gICAqICAgaGlnaGVyIHByaW9yaXR5IGFyZSBwcm9jZXNzZWQgZmlyc3QuXG4gICAqXG4gICAqICAgKiBgYW5pbWF0ZWRgIGNhbiBiZSBzZXQgdG8gYHRydWVgIHRvIGV4dGVuZCB0aGUgQW5pbWF0ZWRCaW5kaW5nIGNsYXNzIHdoaWNoIHByb3ZpZGVzIHN1cHBvcnQgZm9yIGFuaW1hdGlvbiB3aGVuXG4gICAqICAgaW5zZXJ0aW5nYW5kIHJlbW92aW5nIG5vZGVzIGZyb20gdGhlIERPTS4gVGhlIGBhbmltYXRlZGAgcHJvcGVydHkgb25seSAqYWxsb3dzKiBhbmltYXRpb24gYnV0IHRoZSBlbGVtZW50IG11c3RcbiAgICogICBoYXZlIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIHRvIHVzZSBhbmltYXRpb24uIEEgYmluZGluZyB3aWxsIGhhdmUgdGhlIGBhbmltYXRlYCBwcm9wZXJ0eSBzZXQgdG8gdHJ1ZSB3aGVuIGl0IGlzXG4gICAqICAgdG8gYmUgYW5pbWF0ZWQuIEJpbmRlcnMgc2hvdWxkIGhhdmUgZmFzdCBwYXRocyBmb3Igd2hlbiBhbmltYXRpb24gaXMgbm90IHVzZWQgcmF0aGVyIHRoYW4gYXNzdW1pbmcgYW5pbWF0aW9uIHdpbGxcbiAgICogICBiZSB1c2VkLlxuICAgKlxuICAgKiBCaW5kZXJzXG4gICAqXG4gICAqIEEgYmluZGVyIGNhbiBoYXZlIDUgbWV0aG9kcyB3aGljaCB3aWxsIGJlIGNhbGxlZCBhdCB2YXJpb3VzIHBvaW50cyBpbiBhIGJpbmRpbmcncyBsaWZlY3ljbGUuIE1hbnkgYmluZGVycyB3aWxsXG4gICAqIG9ubHkgdXNlIHRoZSBgdXBkYXRlZCh2YWx1ZSlgIG1ldGhvZCwgc28gY2FsbGluZyByZWdpc3RlciB3aXRoIGEgZnVuY3Rpb24gaW5zdGVhZCBvZiBhbiBvYmplY3QgYXMgaXRzIHRoaXJkXG4gICAqIHBhcmFtZXRlciBpcyBhIHNob3J0Y3V0IHRvIGNyZWF0aW5nIGEgYmluZGVyIHdpdGgganVzdCBhbiBgdXBkYXRlYCBtZXRob2QuXG4gICAqXG4gICAqIExpc3RlZCBpbiBvcmRlciBvZiB3aGVuIHRoZXkgb2NjdXIgaW4gYSBiaW5kaW5nJ3MgbGlmZWN5Y2xlOlxuICAgKlxuICAgKiAgICogYGNvbXBpbGVkKG9wdGlvbnMpYCBpcyBjYWxsZWQgd2hlbiBmaXJzdCBjcmVhdGluZyBhIGJpbmRpbmcgZHVyaW5nIHRoZSB0ZW1wbGF0ZSBjb21waWxhdGlvbiBwcm9jZXNzIGFuZCByZWNlaXZlc1xuICAgKiB0aGUgYG9wdGlvbnNgIG9iamVjdCB0aGF0IHdpbGwgYmUgcGFzc2VkIGludG8gYG5ldyBCaW5kaW5nKG9wdGlvbnMpYC4gVGhpcyBjYW4gYmUgdXNlZCBmb3IgY3JlYXRpbmcgdGVtcGxhdGVzLFxuICAgKiBtb2RpZnlpbmcgdGhlIERPTSAob25seSBzdWJzZXF1ZW50IERPTSB0aGF0IGhhc24ndCBhbHJlYWR5IGJlZW4gcHJvY2Vzc2VkKSBhbmQgb3RoZXIgdGhpbmdzIHRoYXQgc2hvdWxkIGJlXG4gICAqIGFwcGxpZWQgYXQgY29tcGlsZSB0aW1lIGFuZCBub3QgZHVwbGljYXRlZCBmb3IgZWFjaCB2aWV3IGNyZWF0ZWQuXG4gICAqXG4gICAqICAgKiBgY3JlYXRlZCgpYCBpcyBjYWxsZWQgb24gdGhlIGJpbmRpbmcgd2hlbiBhIG5ldyB2aWV3IGlzIGNyZWF0ZWQuIFRoaXMgY2FuIGJlIHVzZWQgdG8gYWRkIGV2ZW50IGxpc3RlbmVycyBvbiB0aGVcbiAgICogZWxlbWVudCBvciBkbyBvdGhlciB0aGluZ3MgdGhhdCB3aWxsIHBlcnNpc3RlIHdpdGggdGhlIHZpZXcgdGhyb3VnaCBpdHMgbWFueSB1c2VzLiBWaWV3cyBtYXkgZ2V0IHJldXNlZCBzbyBkb24ndFxuICAgKiBkbyBhbnl0aGluZyBoZXJlIHRvIHRpZSBpdCB0byBhIGdpdmVuIGNvbnRleHQuXG4gICAqXG4gICAqICAgKiBgYXR0YWNoZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gdGhlIHZpZXcgaXMgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0IGFuZCBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXNcbiAgICogY2FuIGJlIHVzZWQgdG8gaGFuZGxlIGNvbnRleHQtc3BlY2lmaWMgYWN0aW9ucywgYWRkIGxpc3RlbmVycyB0byB0aGUgd2luZG93IG9yIGRvY3VtZW50ICh0byBiZSByZW1vdmVkIGluXG4gICAqIGBkZXRhY2hlZGAhKSwgZXRjLlxuICAgKlxuICAgKiAgICogYHVwZGF0ZWQodmFsdWUsIG9sZFZhbHVlLCBjaGFuZ2VSZWNvcmRzKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW5ldmVyIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB3aXRoaW5cbiAgICogdGhlIGF0dHJpYnV0ZSBjaGFuZ2VzLiBGb3IgZXhhbXBsZSwgYGJpbmQtdGV4dD1cInt7dXNlcm5hbWV9fVwiYCB3aWxsIHRyaWdnZXIgYHVwZGF0ZWRgIHdpdGggdGhlIHZhbHVlIG9mIHVzZXJuYW1lXG4gICAqIHdoZW5ldmVyIGl0IGNoYW5nZXMgb24gdGhlIGdpdmVuIGNvbnRleHQuIFdoZW4gdGhlIHZpZXcgaXMgcmVtb3ZlZCBgdXBkYXRlZGAgd2lsbCBiZSB0cmlnZ2VyZWQgd2l0aCBhIHZhbHVlIG9mXG4gICAqIGB1bmRlZmluZWRgIGlmIHRoZSB2YWx1ZSB3YXMgbm90IGFscmVhZHkgYHVuZGVmaW5lZGAsIGdpdmluZyBhIGNoYW5jZSB0byBcInJlc2V0XCIgdG8gYW4gZW1wdHkgc3RhdGUuXG4gICAqXG4gICAqICAgKiBgZGV0YWNoZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gdGhlIHZpZXcgaXMgdW5ib3VuZCB0byBhIGdpdmVuIGNvbnRleHQgYW5kIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzXG4gICAqIGNhbiBiZSB1c2VkIHRvIGNsZWFuIHVwIGFueXRoaW5nIGRvbmUgaW4gYGF0dGFjaGVkKClgIG9yIGluIGB1cGRhdGVkKClgIGJlZm9yZSBiZWluZyByZW1vdmVkLlxuICAgKlxuICAgKiBFbGVtZW50IGFuZCBhdHRyaWJ1dGUgYmluZGVycyB3aWxsIGFwcGx5IHdoZW5ldmVyIHRoZSB0YWcgbmFtZSBvciBhdHRyaWJ1dGUgbmFtZSBpcyBtYXRjaGVkLiBJbiB0aGUgY2FzZSBvZlxuICAgKiBhdHRyaWJ1dGUgYmluZGVycyBpZiB5b3Ugb25seSB3YW50IGl0IHRvIG1hdGNoIHdoZW4gZXhwcmVzc2lvbnMgYXJlIHVzZWQgd2l0aGluIHRoZSBhdHRyaWJ1dGUsIGFkZCBgb25seVdoZW5Cb3VuZGBcbiAgICogdG8gdGhlIGRlZmluaXRpb24uIE90aGVyd2lzZSB0aGUgYmluZGVyIHdpbGwgbWF0Y2ggYW5kIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB3aWxsIHNpbXBseSBiZSBhIHN0cmluZyB0aGF0XG4gICAqIG9ubHkgY2FsbHMgdXBkYXRlZCBvbmNlIHNpbmNlIGl0IHdpbGwgbm90IGNoYW5nZS5cbiAgICpcbiAgICogTm90ZSwgYXR0cmlidXRlcyB3aGljaCBtYXRjaCBhIGJpbmRlciBhcmUgcmVtb3ZlZCBkdXJpbmcgY29tcGlsZS4gVGhleSBhcmUgY29uc2lkZXJlZCB0byBiZSBiaW5kaW5nIGRlZmluaXRpb25zIGFuZFxuICAgKiBub3QgcGFydCBvZiB0aGUgZWxlbWVudC4gQmluZGluZ3MgbWF5IHNldCB0aGUgYXR0cmlidXRlIHdoaWNoIHNlcnZlZCBhcyB0aGVpciBkZWZpbml0aW9uIGlmIGRlc2lyZWQuXG4gICAqXG4gICAqICMjIyBEZWZhdWx0c1xuICAgKlxuICAgKiBUaGVyZSBhcmUgZGVmYXVsdCBiaW5kZXJzIGZvciBhdHRyaWJ1dGUgYW5kIHRleHQgbm9kZXMgd2hpY2ggYXBwbHkgd2hlbiBubyBvdGhlciBiaW5kZXJzIG1hdGNoLiBUaGV5IG9ubHkgYXBwbHkgdG9cbiAgICogYXR0cmlidXRlcyBhbmQgdGV4dCBub2RlcyB3aXRoIGV4cHJlc3Npb25zIGluIHRoZW0gKGUuZy4gYHt7Zm9vfX1gKS4gVGhlIGRlZmF1bHQgaXMgdG8gc2V0IHRoZSBhdHRyaWJ1dGUgb3IgdGV4dFxuICAgKiBub2RlJ3MgdmFsdWUgdG8gdGhlIHJlc3VsdCBvZiB0aGUgZXhwcmVzc2lvbi4gSWYgeW91IHdhbnRlZCB0byBvdmVycmlkZSB0aGlzIGRlZmF1bHQgeW91IG1heSByZWdpc3RlciBhIGJpbmRlciB3aXRoXG4gICAqIHRoZSBuYW1lIGBcIl9fZGVmYXVsdF9fXCJgLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KiogVGhpcyBiaW5kaW5nIGhhbmRsZXIgYWRkcyBwaXJhdGVpemVkIHRleHQgdG8gYW4gZWxlbWVudC5cbiAgICogYGBgamF2YXNjcmlwdFxuICAgKiByZWdpc3RyeS5yZWdpc3RlckF0dHJpYnV0ZSgnbXktcGlyYXRlJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykge1xuICAgKiAgICAgdmFsdWUgPSAnJztcbiAgICogICB9IGVsc2Uge1xuICAgKiAgICAgdmFsdWUgPSB2YWx1ZVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxCaW5nXFxiL2csIFwiaW4nXCIpXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXGJ0b1xcYi9nLCBcInQnXCIpXG4gICAqICAgICAgIC5yZXBsYWNlKC9cXGJ5b3VcXGIvLCAneWUnKVxuICAgKiAgICAgICArICcgQXJycnIhJztcbiAgICogICB9XG4gICAqICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gdmFsdWU7XG4gICAqIH0pO1xuICAgKiBgYGBcbiAgICpcbiAgICogYGBgaHRtbFxuICAgKiA8cCBteS1waXJhdGU9XCJ7e3Bvc3QuYm9keX19XCI+VGhpcyB0ZXh0IHdpbGwgYmUgcmVwbGFjZWQuPC9wPlxuICAgKiBgYGBcbiAgICovXG4gIHJlZ2lzdGVyRWxlbWVudDogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCdlbGVtZW50JywgbmFtZSwgZGVmaW5pdGlvbik7XG4gIH0sXG4gIHJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlclRleHQ6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlckJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHZhciBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuICAgIHZhciBzdXBlckNsYXNzID0gZGVmaW5pdGlvbi5hbmltYXRlZCA/IEFuaW1hdGVkQmluZGluZyA6IEJpbmRpbmc7XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmluaXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkZWZpbml0aW9uLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgc3VwZXJDbGFzcyA9IGRlZmluaXRpb247XG4gICAgICAgIGRlZmluaXRpb24gPSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlZmluaXRpb24gPSB7IHVwZGF0ZWQ6IGRlZmluaXRpb24gfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobmFtZSA9PT0gJ19fZGVmYXVsdF9fJyAmJiAhZGVmaW5pdGlvbi5oYXNPd25Qcm9wZXJ0eSgncHJpb3JpdHknKSkge1xuICAgICAgZGVmaW5pdGlvbi5wcmlvcml0eSA9IC0xMDA7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgc3ViY2xhc3Mgb2YgQmluZGluZyAob3IgYW5vdGhlciBiaW5kZXIpIHdpdGggdGhlIGRlZmluaXRpb25cbiAgICBmdW5jdGlvbiBCaW5kZXIoKSB7XG4gICAgICBzdXBlckNsYXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICAgIGRlZmluaXRpb24uT2JzZXJ2ZXIgPSB0aGlzLk9ic2VydmVyO1xuICAgIHN1cGVyQ2xhc3MuZXh0ZW5kKEJpbmRlciwgZGVmaW5pdGlvbik7XG5cbiAgICB2YXIgZXhwcjtcbiAgICBpZiAobmFtZSBpbnN0YW5jZW9mIFJlZ0V4cCkge1xuICAgICAgZXhwciA9IG5hbWU7XG4gICAgfSBlbHNlIGlmIChuYW1lLmluZGV4T2YoJyonKSA+PSAwKSB7XG4gICAgICBleHByID0gbmV3IFJlZ0V4cCgnXicgKyBlc2NhcGVSZWdFeHAobmFtZSkucmVwbGFjZSgnXFxcXConLCAnKC4qKScpICsgJyQnKTtcbiAgICB9XG5cbiAgICBpZiAoZXhwcikge1xuICAgICAgQmluZGVyLmV4cHIgPSBleHByO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnB1c2goQmluZGVyKTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb3J0KHRoaXMuYmluZGluZ1NvcnQpO1xuICAgIH1cblxuICAgIEJpbmRlci5uYW1lID0gJycgKyBuYW1lO1xuICAgIGJpbmRlcnNbbmFtZV0gPSBCaW5kZXI7XG4gICAgcmV0dXJuIEJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgYmluZGVyIHRoYXQgd2FzIGFkZGVkIHdpdGggYHJlZ2lzdGVyKClgLiBJZiBhbiBSZWdFeHAgd2FzIHVzZWQgaW4gcmVnaXN0ZXIgZm9yIHRoZSBuYW1lIGl0IG11c3QgYmUgdXNlZFxuICAgKiB0byB1bnJlZ2lzdGVyLCBidXQgaXQgZG9lcyBub3QgbmVlZCB0byBiZSB0aGUgc2FtZSBpbnN0YW5jZS5cbiAgICovXG4gIHVucmVnaXN0ZXJFbGVtZW50OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQXR0cmlidXRlOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcignYXR0cmlidXRlJywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMudW5yZWdpc3RlckJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICB1bnJlZ2lzdGVyQmluZGVyOiBmdW5jdGlvbih0eXBlLCBuYW1lKSB7XG4gICAgdmFyIGJpbmRlciA9IHRoaXMuZ2V0QmluZGVyKHR5cGUsIG5hbWUpLCBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuICAgIGlmICghYmluZGVyKSByZXR1cm47XG4gICAgaWYgKGJpbmRlci5leHByKSB7XG4gICAgICB2YXIgaW5kZXggPSBiaW5kZXJzLl93aWxkY2FyZHMuaW5kZXhPZihiaW5kZXIpO1xuICAgICAgaWYgKGluZGV4ID49IDApIGJpbmRlcnMuX3dpbGRjYXJkcy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgIH1cbiAgICBkZWxldGUgYmluZGVyc1tuYW1lXTtcbiAgICByZXR1cm4gYmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJldHVybnMgYSBiaW5kZXIgdGhhdCB3YXMgYWRkZWQgd2l0aCBgcmVnaXN0ZXIoKWAgYnkgdHlwZSBhbmQgbmFtZS5cbiAgICovXG4gIGdldEVsZW1lbnRCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ2VsZW1lbnQnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0QXR0cmlidXRlQmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lKTtcbiAgfSxcbiAgZ2V0VGV4dEJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcigndGV4dCcsIG5hbWUpO1xuICB9LFxuICBnZXRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUpIHtcbiAgICB2YXIgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcblxuICAgIGlmICghYmluZGVycykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYHR5cGVgIG11c3QgYmUgb25lIG9mICcgKyBPYmplY3Qua2V5cyh0aGlzLmJpbmRlcnMpLmpvaW4oJywgJykpO1xuICAgIH1cblxuICAgIGlmIChuYW1lICYmIGJpbmRlcnMuaGFzT3duUHJvcGVydHkobmFtZSkpIHtcbiAgICAgIHJldHVybiBiaW5kZXJzW25hbWVdO1xuICAgIH1cbiAgfSxcblxuXG4gIC8qKlxuICAgKiBGaW5kIGEgbWF0Y2hpbmcgYmluZGVyIGZvciB0aGUgZ2l2ZW4gdHlwZS4gRWxlbWVudHMgc2hvdWxkIG9ubHkgcHJvdmlkZSBuYW1lLiBBdHRyaWJ1dGVzIHNob3VsZCBwcm92aWRlIHRoZSBuYW1lXG4gICAqIGFuZCB2YWx1ZSAodmFsdWUgc28gdGhlIGRlZmF1bHQgY2FuIGJlIHJldHVybmVkIGlmIGFuIGV4cHJlc3Npb24gZXhpc3RzIGluIHRoZSB2YWx1ZSkuIFRleHQgbm9kZXMgc2hvdWxkIG9ubHlcbiAgICogcHJvdmlkZSB0aGUgdmFsdWUgKGluIHBsYWNlIG9mIHRoZSBuYW1lKSBhbmQgd2lsbCByZXR1cm4gdGhlIGRlZmF1bHQgaWYgbm8gYmluZGVycyBtYXRjaC5cbiAgICovXG4gIGZpbmRCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKHR5cGUgPT09ICd0ZXh0JyAmJiB2YWx1ZSA9PSBudWxsKSB7XG4gICAgICB2YWx1ZSA9IG5hbWU7XG4gICAgICBuYW1lID0gdW5kZWZpbmVkO1xuICAgIH1cbiAgICB2YXIgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgbmFtZSksIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG5cbiAgICBpZiAoIWJpbmRlcikge1xuICAgICAgdmFyIHRvTWF0Y2ggPSAodHlwZSA9PT0gJ3RleHQnKSA/IHZhbHVlIDogbmFtZTtcbiAgICAgIGJpbmRlcnMuX3dpbGRjYXJkcy5zb21lKGZ1bmN0aW9uKHdpbGRjYXJkQmluZGVyKSB7XG4gICAgICAgIGlmICh0b01hdGNoLm1hdGNoKHdpbGRjYXJkQmluZGVyLmV4cHIpKSB7XG4gICAgICAgICAgYmluZGVyID0gd2lsZGNhcmRCaW5kZXI7XG4gICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmIChiaW5kZXIgJiYgdHlwZSA9PT0gJ2F0dHJpYnV0ZScgJiYgYmluZGVyLnByb3RvdHlwZS5vbmx5V2hlbkJvdW5kICYmICF0aGlzLmlzQm91bmQodHlwZSwgdmFsdWUpKSB7XG4gICAgICAvLyBkb24ndCB1c2UgdGhlIGB2YWx1ZWAgYmluZGVyIGlmIHRoZXJlIGlzIG5vIGV4cHJlc3Npb24gaW4gdGhlIGF0dHJpYnV0ZSB2YWx1ZSAoZS5nLiBgdmFsdWU9XCJzb21lIHRleHRcImApXG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgPT09IHRoaXMuYW5pbWF0ZUF0dHJpYnV0ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmICghYmluZGVyICYmIHZhbHVlICYmICh0eXBlID09PSAndGV4dCcgfHwgdGhpcy5pc0JvdW5kKHR5cGUsIHZhbHVlKSkpIHtcbiAgICAgIC8vIFRlc3QgaWYgdGhlIGF0dHJpYnV0ZSB2YWx1ZSBpcyBib3VuZCAoZS5nLiBgaHJlZj1cIi9wb3N0cy97eyBwb3N0LmlkIH19XCJgKVxuICAgICAgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgJ19fZGVmYXVsdF9fJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGJpbmRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBIEZvcm1hdHRlciBpcyBzdG9yZWQgdG8gcHJvY2VzcyB0aGUgdmFsdWUgb2YgYW4gZXhwcmVzc2lvbi4gVGhpcyBhbHRlcnMgdGhlIHZhbHVlIG9mIHdoYXQgY29tZXMgaW4gd2l0aCBhIGZ1bmN0aW9uXG4gICAqIHRoYXQgcmV0dXJucyBhIG5ldyB2YWx1ZS4gRm9ybWF0dGVycyBhcmUgYWRkZWQgYnkgdXNpbmcgYSBzaW5nbGUgcGlwZSBjaGFyYWN0ZXIgKGB8YCkgZm9sbG93ZWQgYnkgdGhlIG5hbWUgb2YgdGhlXG4gICAqIGZvcm1hdHRlci4gTXVsdGlwbGUgZm9ybWF0dGVycyBjYW4gYmUgdXNlZCBieSBjaGFpbmluZyBwaXBlcyB3aXRoIGZvcm1hdHRlciBuYW1lcy4gRm9ybWF0dGVycyBtYXkgYWxzbyBoYXZlXG4gICAqIGFyZ3VtZW50cyBwYXNzZWQgdG8gdGhlbSBieSB1c2luZyB0aGUgY29sb24gdG8gc2VwYXJhdGUgYXJndW1lbnRzIGZyb20gdGhlIGZvcm1hdHRlciBuYW1lLiBUaGUgc2lnbmF0dXJlIG9mIGFcbiAgICogZm9ybWF0dGVyIHNob3VsZCBiZSBgZnVuY3Rpb24odmFsdWUsIGFyZ3MuLi4pYCB3aGVyZSBhcmdzIGFyZSBleHRyYSBwYXJhbWV0ZXJzIHBhc3NlZCBpbnRvIHRoZSBmb3JtYXR0ZXIgYWZ0ZXJcbiAgICogY29sb25zLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCd1cHBlcmNhc2UnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZS50b1VwcGVyY2FzZSgpXG4gICAqIH0pXG4gICAqXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdyZXBsYWNlJywgZnVuY3Rpb24odmFsdWUsIHJlcGxhY2UsIHdpdGgpIHtcbiAgICogICBpZiAodHlwZW9mIHZhbHVlICE9ICdzdHJpbmcnKSByZXR1cm4gJydcbiAgICogICByZXR1cm4gdmFsdWUucmVwbGFjZShyZXBsYWNlLCB3aXRoKVxuICAgKiB9KVxuICAgKiBgYGBodG1sXG4gICAqIDxoMSBiaW5kLXRleHQ9XCJ0aXRsZSB8IHVwcGVyY2FzZSB8IHJlcGxhY2U6J0xFVFRFUic6J05VTUJFUidcIj48L2gxPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxPkdFVFRJTkcgVE8gS05PVyBBTEwgQUJPVVQgVEhFIE5VTUJFUiBBPC9oMT5cbiAgICogYGBgXG4gICAqIFRPRE86IG9sZCBkb2NzLCByZXdyaXRlLCB0aGVyZSBpcyBhbiBleHRyYSBhcmd1bWVudCBuYW1lZCBgc2V0dGVyYCB3aGljaCB3aWxsIGJlIHRydWUgd2hlbiB0aGUgZXhwcmVzc2lvbiBpcyBiZWluZyBcInNldFwiIGluc3RlYWQgb2YgXCJnZXRcIlxuICAgKiBBIGB2YWx1ZUZvcm1hdHRlcmAgaXMgbGlrZSBhIGZvcm1hdHRlciBidXQgdXNlZCBzcGVjaWZpY2FsbHkgd2l0aCB0aGUgYHZhbHVlYCBiaW5kaW5nIHNpbmNlIGl0IGlzIGEgdHdvLXdheSBiaW5kaW5nLiBXaGVuXG4gICAqIHRoZSB2YWx1ZSBvZiB0aGUgZWxlbWVudCBpcyBjaGFuZ2VkIGEgYHZhbHVlRm9ybWF0dGVyYCBjYW4gYWRqdXN0IHRoZSB2YWx1ZSBmcm9tIGEgc3RyaW5nIHRvIHRoZSBjb3JyZWN0IHZhbHVlIHR5cGUgZm9yXG4gICAqIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24uIFRoZSBzaWduYXR1cmUgZm9yIGEgYHZhbHVlRm9ybWF0dGVyYCBpbmNsdWRlcyB0aGUgY3VycmVudCB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvblxuICAgKiBiZWZvcmUgdGhlIG9wdGlvbmFsIGFyZ3VtZW50cyAoaWYgYW55KS4gVGhpcyBhbGxvd3MgZGF0ZXMgdG8gYmUgYWRqdXN0ZWQgYW5kIHBvc3NpYmxleSBvdGhlciB1c2VzLlxuICAgKlxuICAgKiAqRXhhbXBsZToqXG4gICAqIGBgYGpzXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdudW1lcmljJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAodmFsdWUgPT0gbnVsbCB8fCBpc05hTih2YWx1ZSkpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZVxuICAgKiB9KVxuICAgKlxuICAgKiByZWdpc3RyeS5yZWdpc3RlckZvcm1hdHRlcignZGF0ZS1ob3VyJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICogICAvLyB2YWx1ZSBjb21pbmcgZnJvbSB0aGUgY29udHJvbGxlciBleHByZXNzaW9uLCB0byBiZSBzZXQgb24gdGhlIGVsZW1lbnRcbiAgICogICBpZiAoICEoY3VycmVudFZhbHVlIGluc3RhbmNlb2YgRGF0ZSkgKSByZXR1cm4gJydcbiAgICogICB2YXIgaG91cnMgPSB2YWx1ZS5nZXRIb3VycygpXG4gICAqICAgaWYgKGhvdXJzID49IDEyKSBob3VycyAtPSAxMlxuICAgKiAgIGlmIChob3VycyA9PSAwKSBob3VycyA9IDEyXG4gICAqICAgcmV0dXJuIGhvdXJzXG4gICAqIH0pXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPk51bWJlciBBdHRlbmRpbmc6PC9sYWJlbD5cbiAgICogPGlucHV0IHNpemU9XCI0XCIgYmluZC12YWx1ZT1cImV2ZW50LmF0dGVuZGVlQ291bnQgfCBudW1lcmljXCI+XG4gICAqIDxsYWJlbD5UaW1lOjwvbGFiZWw+XG4gICAqIDxpbnB1dCBzaXplPVwiMlwiIGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1ob3VyXCI+IDpcbiAgICogPGlucHV0IHNpemU9XCIyXCIgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLW1pbnV0ZVwiPlxuICAgKiA8c2VsZWN0IGJpbmQtdmFsdWU9XCJldmVudC5kYXRlIHwgZGF0ZS1hbXBtXCI+XG4gICAqICAgPG9wdGlvbj5BTTwvb3B0aW9uPlxuICAgKiAgIDxvcHRpb24+UE08L29wdGlvbj5cbiAgICogPC9zZWxlY3Q+XG4gICAqIGBgYFxuICAgKi9cbiAgcmVnaXN0ZXJGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lLCBmb3JtYXR0ZXIpIHtcbiAgICB0aGlzLmZvcm1hdHRlcnNbbmFtZV0gPSBmb3JtYXR0ZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogVW5yZWdpc3RlcnMgYSBmb3JtYXR0ZXIuXG4gICAqL1xuICB1bnJlZ2lzdGVyRm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSkge1xuICAgIGRlbGV0ZSB0aGlzLmZvcm1hdHRlcnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogR2V0cyBhIHJlZ2lzdGVyZWQgZm9ybWF0dGVyLlxuICAgKi9cbiAgZ2V0Rm9ybWF0dGVyOiBmdW5jdGlvbiAobmFtZSkge1xuICAgIHJldHVybiB0aGlzLmZvcm1hdHRlcnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogQW4gQW5pbWF0aW9uIGlzIHN0b3JlZCB0byBoYW5kbGUgYW5pbWF0aW9ucy4gQSByZWdpc3RlcmVkIGFuaW1hdGlvbiBpcyBhbiBvYmplY3QgKG9yIGNsYXNzIHdoaWNoIGluc3RhbnRpYXRlcyBpbnRvXG4gICAqIGFuIG9iamVjdCkgd2l0aCB0aGUgbWV0aG9kczpcbiAgICogICAqIGB3aWxsQW5pbWF0ZUluKGVsZW1lbnQpYFxuICAgKiAgICogYGFuaW1hdGVJbihlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZUluKGVsZW1lbnQpYFxuICAgKiAgICogYHdpbGxBbmltYXRlT3V0KGVsZW1lbnQpYFxuICAgKiAgICogYGFuaW1hdGVPdXQoZWxlbWVudCwgY2FsbGJhY2spYFxuICAgKiAgICogYGRpZEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqXG4gICAqIEFuaW1hdGlvbiBpcyBpbmNsdWRlZCB3aXRoIGJpbmRlcnMgd2hpY2ggYXJlIHJlZ2lzdGVyZWQgd2l0aCB0aGUgYGFuaW1hdGVkYCBwcm9wZXJ0eSBzZXQgdG8gYHRydWVgIChzdWNoIGFzIGBpZmBcbiAgICogYW5kIGByZXBlYXRgKS4gQW5pbWF0aW9ucyBhbGxvdyBlbGVtZW50cyB0byBmYWRlIGluLCBmYWRlIG91dCwgc2xpZGUgZG93biwgY29sbGFwc2UsIG1vdmUgZnJvbSBvbmUgbG9jYXRpb24gaW4gYVxuICAgKiBsaXN0IHRvIGFub3RoZXIsIGFuZCBtb3JlLlxuICAgKlxuICAgKiBUbyB1c2UgYW5pbWF0aW9uIGFkZCBhbiBhdHRyaWJ1dGUgbmFtZWQgYGFuaW1hdGVgIG9udG8gYW4gZWxlbWVudCB3aXRoIGEgc3VwcG9ydGVkIGJpbmRlci5cbiAgICpcbiAgICogIyMjIENTUyBBbmltYXRpb25zXG4gICAqXG4gICAqIElmIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGRvZXMgbm90IGhhdmUgYSB2YWx1ZSBvciB0aGUgdmFsdWUgaXMgYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW5cbiAgICogZnJhZ21lbnRzIHdpbGwgdXNlIGEgQ1NTIHRyYW5zaXRpb24vYW5pbWF0aW9uLiBDbGFzc2VzIHdpbGwgYmUgYWRkZWQgYW5kIHJlbW92ZWQgdG8gdHJpZ2dlciB0aGUgYW5pbWF0aW9uLlxuICAgKlxuICAgKiAgICogYC53aWxsLWFuaW1hdGUtaW5gIGlzIGFkZGVkIHJpZ2h0IGFmdGVyIGFuIGVsZW1lbnQgaXMgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGVcbiAgICogICAgIG9wYWNpdHkgdG8gYDAuMGAgZm9yIGV4YW1wbGUuIEl0IGlzIHRoZW4gcmVtb3ZlZCBvbiB0aGUgbmV4dCBhbmltYXRpb24gZnJhbWUuXG4gICAqICAgKiBgLmFuaW1hdGUtaW5gIGlzIHdoZW4gYC53aWxsLWFuaW1hdGUtaW5gIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAxLjBgIGZvciBleGFtcGxlLiBUaGVcbiAgICogICAgIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUuIE5vdGUgdGhhdFxuICAgKiAgICAgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuIGVsZW1lbnQgd2l0aCB0aGUgYHJlcGVhdGAgYmluZGVyLCB0aGVzZSBjbGFzc2VzIGFyZSBhZGRlZCB0b1xuICAgKiAgICAgaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKiAgICogYC53aWxsLWFuaW1hdGUtb3V0YCBpcyBhZGRlZCBiZWZvcmUgYW4gZWxlbWVudCBpcyByZW1vdmVkIGZyb20gdGhlIERPTS4gVGhpcyBjYW4gYmUgdXNlZCB0byBzZXQgdGhlIG9wYWNpdHkgdG9cbiAgICogICAgIGAxYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIHdoZW4gYC53aWxsLWFuaW1hdGUtb3V0YCBpcyByZW1vdmVkLiBJdCBjYW4gYmUgdXNlZCB0byBzZXQgb3BhY2l0eSB0byBgMC4wYCBmb3JcbiAgICogICAgIGV4YW1wbGUuIFRoZSBgYW5pbWF0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IG9uIHRoaXMgY2xhc3MgaWYgdXNpbmcgaXQuIFRoZSBgdHJhbnNpdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBoZXJlIG9yXG4gICAqICAgICBvbiBhbm90aGVyIHNlbGVjdG9yIHRoYXQgbWF0Y2hlcyB0aGUgZWxlbWVudC4gTm90ZSB0aGF0IGFsdGhvdWdoIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIGlzIHBsYWNlZCBvbiBhblxuICAgKiAgICAgZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvIGl0cyBjaGlsZHJlbiBhcyB0aGV5IGdldCBhZGRlZCBhbmQgcmVtb3ZlZC5cbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgc2V0IHRvIGEgY2xhc3MgbmFtZSAoZS5nLiBgYW5pbWF0ZT1cIi5teS1mYWRlXCJgKSB0aGVuIHRoYXQgY2xhc3MgbmFtZSB3aWxsIGJlIGFkZGVkIGFzXG4gICAqIGEgY2xhc3MgdG8gdGhlIGVsZW1lbnQgZHVyaW5nIGFuaW1hdGlvbi4gVGhpcyBhbGxvd3MgeW91IHRvIHVzZSBgLm15LWZhZGUud2lsbC1hbmltYXRlLWluYCwgYC5teS1mYWRlLmFuaW1hdGUtaW5gLFxuICAgKiBldGMuIGluIHlvdXIgc3R5bGVzaGVldHMgdG8gdXNlIHRoZSBzYW1lIGFuaW1hdGlvbiB0aHJvdWdob3V0IHlvdXIgYXBwbGljYXRpb24uXG4gICAqXG4gICAqICMjIyBKYXZhU2NyaXB0IEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgeW91IG5lZWQgZ3JlYXRlciBjb250cm9sIG92ZXIgeW91ciBhbmltYXRpb25zIEphdmFTY3JpcHQgbWF5IGJlIHVzZWQuIEl0IGlzIHJlY29tbWVuZGVkIHRoYXQgQ1NTIHN0eWxlcyBzdGlsbCBiZVxuICAgKiB1c2VkIGJ5IGhhdmluZyB5b3VyIGNvZGUgc2V0IHRoZW0gbWFudWFsbHkuIFRoaXMgYWxsb3dzIHRoZSBhbmltYXRpb24gdG8gdGFrZSBhZHZhbnRhZ2Ugb2YgdGhlIGJyb3dzZXJcbiAgICogb3B0aW1pemF0aW9ucyBzdWNoIGFzIGhhcmR3YXJlIGFjY2VsZXJhdGlvbi4gVGhpcyBpcyBub3QgYSByZXF1aXJlbWVudC5cbiAgICpcbiAgICogSW4gb3JkZXIgdG8gdXNlIEphdmFTY3JpcHQgYW4gb2JqZWN0IHNob3VsZCBiZSBwYXNzZWQgaW50byB0aGUgYGFuaW1hdGlvbmAgYXR0cmlidXRlIHVzaW5nIGFuIGV4cHJlc3Npb24uIFRoaXNcbiAgICogb2JqZWN0IHNob3VsZCBoYXZlIG1ldGhvZHMgdGhhdCBhbGxvdyBKYXZhU2NyaXB0IGFuaW1hdGlvbiBoYW5kbGluZy4gRm9yIGV4YW1wbGUsIGlmIHlvdSBhcmUgYm91bmQgdG8gYSBjb250ZXh0XG4gICAqIHdpdGggYW4gb2JqZWN0IG5hbWVkIGBjdXN0b21GYWRlYCB3aXRoIGFuaW1hdGlvbiBtZXRob2RzLCB5b3VyIGVsZW1lbnQgc2hvdWxkIGhhdmUgYGF0dHJpYnV0ZT1cInt7Y3VzdG9tRmFkZX19XCJgLlxuICAgKiBUaGUgZm9sbG93aW5nIGlzIGEgbGlzdCBvZiB0aGUgbWV0aG9kcyB5b3UgbWF5IGltcGxlbWVudC5cbiAgICpcbiAgICogICAqIGB3aWxsQW5pbWF0ZUluKGVsZW1lbnQpYCB3aWxsIGJlIGNhbGxlZCBhZnRlciBhbiBlbGVtZW50IGhhcyBiZWVuIGluc2VydGVkIGludG8gdGhlIERPTS4gVXNlIGl0IHRvIHNldCBpbml0aWFsXG4gICAqICAgICBDU1MgcHJvcGVydGllcyBiZWZvcmUgYGFuaW1hdGVJbmAgaXMgY2FsbGVkIHRvIHNldCB0aGUgZmluYWwgcHJvcGVydGllcy4gVGhpcyBtZXRob2QgaXMgb3B0aW9uYWwuXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWAgd2lsbCBiZSBjYWxsZWQgc2hvcnRseSBhZnRlciBgd2lsbEFuaW1hdGVJbmAgaWYgaXQgd2FzIGRlZmluZWQuIFVzZSBpdCB0byBzZXRcbiAgICogICAgIGZpbmFsIENTUyBwcm9wZXJ0aWVzLlxuICAgKiAgICogYGFuaW1hdGVPdXQoZWxlbWVudCwgZG9uZSlgIHdpbGwgYmUgY2FsbGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHRvIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBgZG9uZWAgbXVzdCBiZVxuICAgKiAgICAgY2FsbGVkIHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZSBpbiBvcmRlciBmb3IgdGhlIGJpbmRlciB0byBmaW5pc2ggcmVtb3ZpbmcgdGhlIGVsZW1lbnQuICoqUmVtZW1iZXIqKiB0b1xuICAgKiAgICAgY2xlYW4gdXAgYnkgcmVtb3ZpbmcgYW55IHN0eWxlcyB0aGF0IHdlcmUgYWRkZWQgYmVmb3JlIGNhbGxpbmcgYGRvbmUoKWAgc28gdGhlIGVsZW1lbnQgY2FuIGJlIHJldXNlZCB3aXRob3V0XG4gICAqICAgICBzaWRlLWVmZmVjdHMuXG4gICAqXG4gICAqIFRoZSBgZWxlbWVudGAgcGFzc2VkIGluIHdpbGwgYmUgcG9seWZpbGxlZCBmb3Igd2l0aCB0aGUgYGFuaW1hdGVgIG1ldGhvZCB1c2luZ1xuICAgKiBodHRwczovL2dpdGh1Yi5jb20vd2ViLWFuaW1hdGlvbnMvd2ViLWFuaW1hdGlvbnMtanMuXG4gICAqXG4gICAqICMjIyBSZWdpc3RlcmVkIEFuaW1hdGlvbnNcbiAgICpcbiAgICogQW5pbWF0aW9ucyBtYXkgYmUgcmVnaXN0ZXJlZCBhbmQgdXNlZCB0aHJvdWdob3V0IHlvdXIgYXBwbGljYXRpb24uIFRvIHVzZSBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIHVzZSBpdHMgbmFtZSBpblxuICAgKiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSAoZS5nLiBgYW5pbWF0ZT1cImZhZGVcImApLiBOb3RlIHRoZSBvbmx5IGRpZmZlcmVuY2UgYmV0d2VlbiBhIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGFuZCBhXG4gICAqIGNsYXNzIHJlZ2lzdHJhdGlvbiBpcyBjbGFzcyByZWdpc3RyYXRpb25zIGFyZSBwcmVmaXhlZCB3aXRoIGEgZG90IChgLmApLiBSZWdpc3RlcmVkIGFuaW1hdGlvbnMgYXJlIGFsd2F5c1xuICAgKiBKYXZhU2NyaXB0IGFuaW1hdGlvbnMuIFRvIHJlZ2lzdGVyIGFuIGFuaW1hdGlvbiB1c2UgYGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lLCBhbmltYXRpb25PYmplY3QpYC5cbiAgICpcbiAgICogVGhlIEFuaW1hdGlvbiBtb2R1bGUgY29tZXMgd2l0aCBzZXZlcmFsIGNvbW1vbiBhbmltYXRpb25zIHJlZ2lzdGVyZWQgYnkgZGVmYXVsdC4gVGhlIGRlZmF1bHRzIHVzZSBDU1Mgc3R5bGVzIHRvXG4gICAqIHdvcmsgY29ycmVjdGx5LCB1c2luZyBgZWxlbWVudC5hbmltYXRlYC5cbiAgICpcbiAgICogICAqIGBmYWRlYCB3aWxsIGZhZGUgYW4gZWxlbWVudCBpbiBhbmQgb3V0IG92ZXIgMzAwIG1pbGxpc2Vjb25kcy5cbiAgICogICAqIGBzbGlkZWAgd2lsbCBzbGlkZSBhbiBlbGVtZW50IGRvd24gd2hlbiBpdCBpcyBhZGRlZCBhbmQgc2xpZGUgaXQgdXAgd2hlbiBpdCBpcyByZW1vdmVkLlxuICAgKiAgICogYHNsaWRlLW1vdmVgIHdpbGwgbW92ZSBhbiBlbGVtZW50IGZyb20gaXRzIG9sZCBsb2NhdGlvbiB0byBpdHMgbmV3IGxvY2F0aW9uIGluIGEgcmVwZWF0ZWQgbGlzdC5cbiAgICpcbiAgICogRG8geW91IGhhdmUgYW5vdGhlciBjb21tb24gYW5pbWF0aW9uIHlvdSB0aGluayBzaG91bGQgYmUgaW5jbHVkZWQgYnkgZGVmYXVsdD8gU3VibWl0IGEgcHVsbCByZXF1ZXN0IVxuICAgKi9cbiAgcmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdCkge1xuICAgIHRoaXMuYW5pbWF0aW9uc1tuYW1lXSA9IGFuaW1hdGlvbk9iamVjdDtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhbiBhbmltYXRpb24uXG4gICAqL1xuICB1bnJlZ2lzdGVyQW5pbWF0aW9uOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgZGVsZXRlIHRoaXMuYW5pbWF0aW9uc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24uXG4gICAqL1xuICBnZXRBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFByZXBhcmUgYW4gZWxlbWVudCB0byBiZSBlYXNpZXIgYW5pbWF0YWJsZSAoYWRkaW5nIGEgc2ltcGxlIGBhbmltYXRlYCBwb2x5ZmlsbCBpZiBuZWVkZWQpXG4gICAqL1xuICBtYWtlRWxlbWVudEFuaW1hdGFibGU6IGFuaW1hdGlvbi5tYWtlRWxlbWVudEFuaW1hdGFibGUsXG5cblxuICAvKipcbiAgICogU2V0cyB0aGUgZGVsaW1pdGVycyB0aGF0IGRlZmluZSBhbiBleHByZXNzaW9uLiBEZWZhdWx0IGlzIGB7e2AgYW5kIGB9fWAgYnV0IHRoaXMgbWF5IGJlIG92ZXJyaWRkZW4uIElmIGVtcHR5XG4gICAqIHN0cmluZ3MgYXJlIHBhc3NlZCBpbiAoZm9yIHR5cGUgXCJhdHRyaWJ1dGVcIiBvbmx5KSB0aGVuIG5vIGRlbGltaXRlcnMgYXJlIHJlcXVpcmVkIGZvciBtYXRjaGluZyBhdHRyaWJ1dGVzLCBidXQgdGhlXG4gICAqIGRlZmF1bHQgYXR0cmlidXRlIG1hdGNoZXIgd2lsbCBub3QgYXBwbHkgdG8gdGhlIHJlc3Qgb2YgdGhlIGF0dHJpYnV0ZXMuXG4gICAqL1xuICBzZXRFeHByZXNzaW9uRGVsaW1pdGVyczogZnVuY3Rpb24odHlwZSwgcHJlLCBwb3N0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRXhwcmVzc2lvbiBkZWxpbWl0ZXJzIG11c3QgYmUgb2YgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByID0gbmV3IFJlZ0V4cChlc2NhcGVSZWdFeHAocHJlKSArICcoLio/KScgKyBlc2NhcGVSZWdFeHAocG9zdCksICdnJyk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVGVzdHMgd2hldGhlciBhIHZhbHVlIGhhcyBhbiBleHByZXNzaW9uIGluIGl0LiBTb21ldGhpbmcgbGlrZSBgL3VzZXIve3t1c2VyLmlkfX1gLlxuICAgKi9cbiAgaXNCb3VuZDogZnVuY3Rpb24odHlwZSwgdmFsdWUpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdpc0JvdW5kIG11c3QgcHJvdmlkZSB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG4gICAgdmFyIGV4cHIgPSB0aGlzLmJpbmRlcnNbdHlwZV0uX2V4cHI7XG4gICAgcmV0dXJuIEJvb2xlYW4oZXhwciAmJiB2YWx1ZSAmJiB2YWx1ZS5tYXRjaChleHByKSk7XG4gIH0sXG5cblxuICAvKipcbiAgICogVGhlIHNvcnQgZnVuY3Rpb24gdG8gc29ydCBiaW5kZXJzIGNvcnJlY3RseVxuICAgKi9cbiAgYmluZGluZ1NvcnQ6IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICByZXR1cm4gYi5wcm90b3R5cGUucHJpb3JpdHkgLSBhLnByb3RvdHlwZS5wcmlvcml0eTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBDb252ZXJ0cyBhbiBpbnZlcnRlZCBleHByZXNzaW9uIGZyb20gYC91c2VyL3t7dXNlci5pZH19YCB0byBgXCIvdXNlci9cIiArIHVzZXIuaWRgXG4gICAqL1xuICBjb2RpZnlFeHByZXNzaW9uOiBmdW5jdGlvbih0eXBlLCB0ZXh0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY29kaWZ5RXhwcmVzc2lvbiBtdXN0IHVzZSB0eXBlIFwiYXR0cmlidXRlXCIgb3IgXCJ0ZXh0XCInKTtcbiAgICB9XG5cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICB2YXIgbWF0Y2ggPSB0ZXh0Lm1hdGNoKGV4cHIpO1xuXG4gICAgaWYgKCFtYXRjaCkge1xuICAgICAgcmV0dXJuICdcIicgKyB0ZXh0LnJlcGxhY2UoL1wiL2csICdcXFxcXCInKSArICdcIic7XG4gICAgfSBlbHNlIGlmIChtYXRjaC5sZW5ndGggPT09IDEgJiYgbWF0Y2hbMF0gPT09IHRleHQpIHtcbiAgICAgIHJldHVybiB0ZXh0LnJlcGxhY2UoZXhwciwgJyQxJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBuZXdUZXh0ID0gJ1wiJywgbGFzdEluZGV4ID0gMDtcbiAgICAgIHdoaWxlICgobWF0Y2ggPSBleHByLmV4ZWModGV4dCkpKSB7XG4gICAgICAgIHZhciBzdHIgPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCwgZXhwci5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpO1xuICAgICAgICBuZXdUZXh0ICs9IHN0ci5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJyk7XG4gICAgICAgIG5ld1RleHQgKz0gJ1wiICsgKCcgKyBtYXRjaFsxXSArICcgfHwgXCJcIikgKyBcIic7XG4gICAgICAgIGxhc3RJbmRleCA9IGV4cHIubGFzdEluZGV4O1xuICAgICAgfVxuICAgICAgbmV3VGV4dCArPSB0ZXh0LnNsaWNlKGxhc3RJbmRleCkucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICAgIHJldHVybiBuZXdUZXh0LnJlcGxhY2UoL15cIlwiIFxcKyB8IFwiXCIgXFwrIHwgXFwrIFwiXCIkL2csICcnKTtcbiAgICB9XG4gIH1cblxufTtcblxuLy8gVGFrZXMgYSBzdHJpbmcgbGlrZSBcIihcXCopXCIgb3IgXCJvbi1cXCpcIiBhbmQgY29udmVydHMgaXQgaW50byBhIHJlZ3VsYXIgZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cCh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL1stW1xcXXt9KCkqKz8uLFxcXFxeJHwjXFxzXS9nLCAnXFxcXCQmJyk7XG59XG4iLCIvLyBpbnNwaXJlZCBmcm9tIHpvbmUuanMsIGJ1dCB3aXRob3V0IGJlaW5nIGFzIGNvbXByZWhlbnNpdmUgb3IgaW50cnVzaXZlIChpLmUuIGF2b2lkaW5nIGdsb2JhbCBzY29wZSlcblxuLy8gUnVuIGEgZnVuY3Rpb24gaW4gdGhlIGNvbnRleHQgb2YgZnJhZ21lbnRzXG5leHBvcnRzLnJ1biA9IHJ1bjtcblxuLy8gUmV0dXJuIGEgbmV3IGZ1bmN0aW9uIHdoaWNoIHdpbGwgcnVuIGluIHRoZSBjb250ZXh0IG9mIGZyYWdtZW50c1xuZXhwb3J0cy53cmFwID0gd3JhcDtcblxuLy8gUmV0dXJuIGEgcHJveHkgZm9yIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCB3cmFwIGFueSBmdW5jdGlvbiBhcmd1bWVudHMgcGFzc2VkIHRvIGl0XG5leHBvcnRzLnByb3h5ID0gcHJveHk7XG5cbi8vIFNraXAgT2JzZXJ2ZXIuc3luYyBvbiB0aGUgbmV4dCBpbnZvY2F0aW9uIHRoZSBjb250ZXh0LiBUaGlzIGlzIHJlYWxseSBqdXN0IGZvciBvYnNlcnZlciB0byBydW4gYW5kIG5vdCBnZXQgaW50b1xuLy8gYSBsb29wXG5leHBvcnRzLnNraXBOZXh0U3luYyA9IGZ1bmN0aW9uKCkge1xuICBza2lwTmV4dCA9IHRydWU7XG59O1xuXG5cbnZhciBPYnNlcnZlciA9IHJlcXVpcmUoJy4vb2JzZXJ2ZXInKTtcbnZhciBwYXRjaGVkID0gZmFsc2U7XG52YXIgc2tpcE5leHQgPSBmYWxzZTtcbnZhciB3cmFwcGVkS2V5ID0gKHR5cGVvZiBTeW1ib2wgIT09ICd1bmRlZmluZWQnKSA/IFN5bWJvbCgnd3JhcHBlZCcpIDogJ196b25lanIkd3JhcHBlZCc7XG5cblxuZnVuY3Rpb24gcnVuKGZ1bmMpIHtcbiAgcmV0dXJuIHdyYXAoZnVuYykoKTtcbn1cblxuZnVuY3Rpb24gd3JhcChmdW5jKSB7XG4gIGlmICh0eXBlb2YgZnVuYyAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHJldHVybiBmdW5jO1xuICB9IGVsc2UgaWYgKCFmdW5jW3dyYXBwZWRLZXldKSB7XG4gICAgZnVuY1t3cmFwcGVkS2V5XSA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHBhdGNoZWQpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmMuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIH1cblxuICAgICAgcGF0Y2goKTtcbiAgICAgIHZhciByZXN1bHQgPSBmdW5jLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgICBpZiAoc2tpcE5leHQpIHtcbiAgICAgICAgc2tpcE5leHQgPSBmYWxzZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIE9ic2VydmVyLnN5bmMoKTtcbiAgICAgIH1cbiAgICAgIHVucGF0Y2goKTtcbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfTtcbiAgICBmdW5jW3dyYXBwZWRLZXldW3dyYXBwZWRLZXldID0gZnVuY1t3cmFwcGVkS2V5XTtcbiAgfVxuICByZXR1cm4gZnVuY1t3cmFwcGVkS2V5XTtcbn1cblxuZnVuY3Rpb24gcHJveHkobWV0aG9kKSB7XG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKHR5cGVvZiBhcmd1bWVudHNbaV0gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgYXJndW1lbnRzW2ldID0gd3JhcChhcmd1bWVudHNbaV0pO1xuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gbWV0aG9kLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH07XG59XG5cbmZ1bmN0aW9uIHByb3h5Q2xhc3MoT3JpZ2luYWxDbGFzcywgZXZlbnROYW1lcykge1xuICBpZiAoIWV2ZW50TmFtZXMpIHtcbiAgICBldmVudE5hbWVzID0gW107XG4gICAgdmFyIGluc3RhbmNlID0gbmV3IE9yaWdpbmFsQ2xhc3MoKTtcbiAgICBmb3IgKHZhciBpIGluIGluc3RhbmNlKSB7XG4gICAgICBpZiAoaS5zbGljZSgwLCAyKSA9PT0gJ29uJyAmJiBpbnN0YW5jZVtpXSA9PT0gbnVsbCAmJiBpLnRvTG93ZXJDYXNlKCkgPT09IGkpIHtcbiAgICAgICAgZXZlbnROYW1lcy5wdXNoKGkpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICB2YXIgb2JqLCBhID0gYXJndW1lbnRzO1xuICAgIHN3aXRjaCAoYXJndW1lbnRzLmxlbmd0aCkge1xuICAgICAgY2FzZSAwOiBvYmogPSBuZXcgT3JpZ2luYWxDbGFzcygpOyBicmVhaztcbiAgICAgIGNhc2UgMTogb2JqID0gbmV3IE9yaWdpbmFsQ2xhc3MoYVswXSk7IGJyZWFrO1xuICAgICAgY2FzZSAyOiBvYmogPSBuZXcgT3JpZ2luYWxDbGFzcyhhWzBdLCBhWzFdKTsgYnJlYWs7XG4gICAgICBjYXNlIDM6IG9iaiA9IG5ldyBPcmlnaW5hbENsYXNzKGFbMF0sIGFbMV0sIGFbMl0pOyBicmVhaztcbiAgICAgIGNhc2UgNDogb2JqID0gbmV3IE9yaWdpbmFsQ2xhc3MoYVswXSwgYVsxXSwgYVsyXSwgYVszXSk7IGJyZWFrO1xuICAgICAgZGVmYXVsdDogdGhyb3cgbmV3IEVycm9yKCd3aGF0IGFyZSB5b3UgZXZlbiBkb2luZz8nKTtcbiAgICB9XG5cbiAgICBldmVudE5hbWVzLmZvckVhY2goZnVuY3Rpb24ocHJvcGVydHkpIHtcbiAgICAgIHZhciBldmVudE5hbWUgPSBwcm9wZXJ0eS5zbGljZSgyKTtcbiAgICAgIHZhciBoYW5kbGVyO1xuXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkob2JqLCBwcm9wZXJ0eSwge1xuICAgICAgICBlbnVtZXJhYmxlOiB0cnVlLFxuICAgICAgICBjb25maWd1cmFibGU6IHRydWUsXG4gICAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICBpZiAoaGFuZGxlcikge1xuICAgICAgICAgICAgdGhpcy5yZW1vdmVFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgd3JhcChoYW5kbGVyKSk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGhhbmRsZXIgPSB2YWx1ZTtcbiAgICAgICAgICBpZiAoaGFuZGxlcikge1xuICAgICAgICAgICAgdGhpcy5hZGRFdmVudExpc3RlbmVyKGV2ZW50TmFtZSwgd3JhcChoYW5kbGVyKSk7XG4gICAgICAgICAgfVxuICAgICAgICB9LFxuICAgICAgICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHJldHVybiBoYW5kbGVyO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIHJldHVybiBvYmo7XG4gIH07XG59XG5cblxuZnVuY3Rpb24gcGF0Y2goKSB7XG4gIHBhdGNoZWQgPSB0cnVlO1xuICB3aW5kb3cuc2V0VGltZW91dCA9IHBhdGNoZXMuc2V0VGltZW91dDtcbiAgd2luZG93LnNldEludGVydmFsID0gcGF0Y2hlcy5zZXRJbnRlcnZhbDtcbiAgd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZSA9IHBhdGNoZXMucmVxdWVzdEFuaW1hdGlvbkZyYW1lO1xuICBFdmVudFRhcmdldC5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IHBhdGNoZXMuYWRkRXZlbnRMaXN0ZW5lcjtcbiAgRXZlbnRUYXJnZXQucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBwYXRjaGVzLnJlbW92ZUV2ZW50TGlzdGVuZXI7XG4gIFByb21pc2UucHJvdG90eXBlLnRoZW4gPSBwYXRjaGVzLnRoZW47XG4gIFByb21pc2UucHJvdG90eXBlLmNhdGNoID0gcGF0Y2hlcy5jYXRjaDtcbiAgZG9jdW1lbnQucmVnaXN0ZXJFbGVtZW50ID0gcGF0Y2hlcy5yZWdpc3RlckVsZW1lbnQ7XG4gIHdpbmRvdy5XZWJTb2NrZXQgPSBwYXRjaGVzLldlYlNvY2tldDtcbn1cblxuXG5mdW5jdGlvbiB1bnBhdGNoKCkge1xuICB3aW5kb3cuc2V0VGltZW91dCA9IG9yaWdpbmFscy5zZXRUaW1lb3V0O1xuICB3aW5kb3cuc2V0SW50ZXJ2YWwgPSBvcmlnaW5hbHMuc2V0SW50ZXJ2YWw7XG4gIHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSBvcmlnaW5hbHMucmVxdWVzdEFuaW1hdGlvbkZyYW1lO1xuICBFdmVudFRhcmdldC5wcm90b3R5cGUuYWRkRXZlbnRMaXN0ZW5lciA9IG9yaWdpbmFscy5hZGRFdmVudExpc3RlbmVyO1xuICBFdmVudFRhcmdldC5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lciA9IG9yaWdpbmFscy5yZW1vdmVFdmVudExpc3RlbmVyO1xuICBQcm9taXNlLnByb3RvdHlwZS50aGVuID0gb3JpZ2luYWxzLnRoZW47XG4gIFByb21pc2UucHJvdG90eXBlLmNhdGNoID0gb3JpZ2luYWxzLmNhdGNoO1xuICBkb2N1bWVudC5yZWdpc3RlckVsZW1lbnQgPSBvcmlnaW5hbHMucmVnaXN0ZXJFbGVtZW50O1xuICB3aW5kb3cuV2ViU29ja2V0ID0gb3JpZ2luYWxzLldlYlNvY2tldDtcbiAgcGF0Y2hlZCA9IGZhbHNlO1xufVxuXG5cbnZhciBvcmlnaW5hbHMgPSB7XG4gIHNldFRpbWVvdXQ6IHdpbmRvdy5zZXRUaW1lb3V0LFxuICBzZXRJbnRlcnZhbDogd2luZG93LnNldEludGVydmFsLFxuICByZXF1ZXN0QW5pbWF0aW9uRnJhbWU6IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUsXG4gIGFkZEV2ZW50TGlzdGVuZXI6IEV2ZW50VGFyZ2V0LnByb3RvdHlwZS5hZGRFdmVudExpc3RlbmVyLFxuICByZW1vdmVFdmVudExpc3RlbmVyOiBFdmVudFRhcmdldC5wcm90b3R5cGUucmVtb3ZlRXZlbnRMaXN0ZW5lcixcbiAgdGhlbjogUHJvbWlzZS5wcm90b3R5cGUudGhlbixcbiAgY2F0Y2g6IFByb21pc2UucHJvdG90eXBlLmNhdGNoLFxuICByZWdpc3RlckVsZW1lbnQ6IGRvY3VtZW50LnJlZ2lzdGVyRWxlbWVudCxcbiAgWE1MSHR0cFJlcXVlc3Q6IHdpbmRvdy5YTUxIdHRwUmVxdWVzdCxcbiAgV2ViU29ja2V0OiB3aW5kb3cuV2ViU29ja2V0XG59O1xuXG5cbnZhciBwYXRjaGVzID0ge1xuICBzZXRUaW1lb3V0OiBwcm94eShvcmlnaW5hbHMuc2V0VGltZW91dCksXG4gIHNldEludGVydmFsOiBwcm94eShvcmlnaW5hbHMuc2V0SW50ZXJ2YWwpLFxuICByZXF1ZXN0QW5pbWF0aW9uRnJhbWU6IHByb3h5KG9yaWdpbmFscy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUpLFxuICBhZGRFdmVudExpc3RlbmVyOiBwcm94eShvcmlnaW5hbHMuYWRkRXZlbnRMaXN0ZW5lciksXG4gIHJlbW92ZUV2ZW50TGlzdGVuZXI6IHByb3h5KG9yaWdpbmFscy5yZW1vdmVFdmVudExpc3RlbmVyKSxcbiAgdGhlbjogcHJveHkob3JpZ2luYWxzLnRoZW4pLFxuICBjYXRjaDogcHJveHkob3JpZ2luYWxzLmNhdGNoKSxcbiAgWE1MSHR0cFJlcXVlc3Q6IHByb3h5Q2xhc3Mob3JpZ2luYWxzLlhNTEh0dHBSZXF1ZXN0KSxcbiAgV2ViU29ja2V0OiBwcm94eUNsYXNzKG9yaWdpbmFscy5XZWJTb2NrZXQsIFsnb25tZXNzYWdlJ10pXG59O1xuIiwiLypcbkNvcHlyaWdodCAoYykgMjAxNSBKYWNvYiBXcmlnaHQgPGphY3dyaWdodEBnbWFpbC5jb20+XG5cblBlcm1pc3Npb24gaXMgaGVyZWJ5IGdyYW50ZWQsIGZyZWUgb2YgY2hhcmdlLCB0byBhbnkgcGVyc29uIG9idGFpbmluZyBhIGNvcHlcbm9mIHRoaXMgc29mdHdhcmUgYW5kIGFzc29jaWF0ZWQgZG9jdW1lbnRhdGlvbiBmaWxlcyAodGhlIFwiU29mdHdhcmVcIiksIHRvIGRlYWxcbmluIHRoZSBTb2Z0d2FyZSB3aXRob3V0IHJlc3RyaWN0aW9uLCBpbmNsdWRpbmcgd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHNcbnRvIHVzZSwgY29weSwgbW9kaWZ5LCBtZXJnZSwgcHVibGlzaCwgZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGxcbmNvcGllcyBvZiB0aGUgU29mdHdhcmUsIGFuZCB0byBwZXJtaXQgcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpc1xuZnVybmlzaGVkIHRvIGRvIHNvLCBzdWJqZWN0IHRvIHRoZSBmb2xsb3dpbmcgY29uZGl0aW9uczpcblxuVGhlIGFib3ZlIGNvcHlyaWdodCBub3RpY2UgYW5kIHRoaXMgcGVybWlzc2lvbiBub3RpY2Ugc2hhbGwgYmUgaW5jbHVkZWQgaW5cbmFsbCBjb3BpZXMgb3Igc3Vic3RhbnRpYWwgcG9ydGlvbnMgb2YgdGhlIFNvZnR3YXJlLlxuXG5USEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELCBFWFBSRVNTIE9SXG5JTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GIE1FUkNIQU5UQUJJTElUWSxcbkZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORCBOT05JTkZSSU5HRU1FTlQuIElOIE5PIEVWRU5UIFNIQUxMIFRIRVxuQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRSBMSUFCTEUgRk9SIEFOWSBDTEFJTSwgREFNQUdFUyBPUiBPVEhFUlxuTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTiBPRiBDT05UUkFDVCwgVE9SVCBPUiBPVEhFUldJU0UsIEFSSVNJTkcgRlJPTSxcbk9VVCBPRiBPUiBJTiBDT05ORUNUSU9OIFdJVEggVEhFIFNPRlRXQVJFIE9SIFRIRSBVU0UgT1IgT1RIRVIgREVBTElOR1MgSU5cblRIRSBTT0ZUV0FSRS5cbiovXG4vLyAjIERpZmZcbi8vID4gQmFzZWQgb24gd29yayBmcm9tIEdvb2dsZSdzIG9ic2VydmUtanMgcG9seWZpbGw6IGh0dHBzOi8vZ2l0aHViLmNvbS9Qb2x5bWVyL29ic2VydmUtanNcblxuLy8gQSBuYW1lc3BhY2UgdG8gc3RvcmUgdGhlIGZ1bmN0aW9ucyBvblxudmFyIGRpZmYgPSBleHBvcnRzO1xuXG4oZnVuY3Rpb24oKSB7XG5cbiAgZGlmZi5jbG9uZSA9IGNsb25lO1xuICBkaWZmLnZhbHVlcyA9IGRpZmZWYWx1ZXM7XG4gIGRpZmYuYmFzaWMgPSBkaWZmQmFzaWM7XG4gIGRpZmYub2JqZWN0cyA9IGRpZmZPYmplY3RzO1xuICBkaWZmLmFycmF5cyA9IGRpZmZBcnJheXM7XG5cblxuICAvLyBBIGNoYW5nZSByZWNvcmQgZm9yIHRoZSBvYmplY3QgY2hhbmdlc1xuICBmdW5jdGlvbiBDaGFuZ2VSZWNvcmQob2JqZWN0LCB0eXBlLCBuYW1lLCBvbGRWYWx1ZSkge1xuICAgIHRoaXMub2JqZWN0ID0gb2JqZWN0O1xuICAgIHRoaXMudHlwZSA9IHR5cGU7XG4gICAgdGhpcy5uYW1lID0gbmFtZTtcbiAgICB0aGlzLm9sZFZhbHVlID0gb2xkVmFsdWU7XG4gIH1cblxuICAvLyBBIHNwbGljZSByZWNvcmQgZm9yIHRoZSBhcnJheSBjaGFuZ2VzXG4gIGZ1bmN0aW9uIFNwbGljZShpbmRleCwgcmVtb3ZlZCwgYWRkZWRDb3VudCkge1xuICAgIHRoaXMuaW5kZXggPSBpbmRleDtcbiAgICB0aGlzLnJlbW92ZWQgPSByZW1vdmVkO1xuICAgIHRoaXMuYWRkZWRDb3VudCA9IGFkZGVkQ291bnQ7XG4gIH1cblxuXG4gIC8vIENyZWF0ZXMgYSBjbG9uZSBvciBjb3B5IG9mIGFuIGFycmF5IG9yIG9iamVjdCAob3Igc2ltcGx5IHJldHVybnMgYSBzdHJpbmcvbnVtYmVyL2Jvb2xlYW4gd2hpY2ggYXJlIGltbXV0YWJsZSlcbiAgLy8gRG9lcyBub3QgcHJvdmlkZSBkZWVwIGNvcGllcy5cbiAgZnVuY3Rpb24gY2xvbmUodmFsdWUsIGRlZXApIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGlmIChkZWVwKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5tYXAoZnVuY3Rpb24odmFsdWUpIHtcbiAgICAgICAgICByZXR1cm4gY2xvbmUodmFsdWUsIGRlZXApO1xuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiB2YWx1ZS5zbGljZSgpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAodmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgaWYgKHZhbHVlLnZhbHVlT2YoKSAhPT0gdmFsdWUpIHtcbiAgICAgICAgcmV0dXJuIG5ldyB2YWx1ZS5jb25zdHJ1Y3Rvcih2YWx1ZS52YWx1ZU9mKCkpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGNvcHkgPSB7fTtcbiAgICAgICAgZm9yICh2YXIga2V5IGluIHZhbHVlKSB7XG4gICAgICAgICAgdmFyIG9ialZhbHVlID0gdmFsdWVba2V5XTtcbiAgICAgICAgICBpZiAoZGVlcCkge1xuICAgICAgICAgICAgb2JqVmFsdWUgPSBjbG9uZShvYmpWYWx1ZSwgZGVlcCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvcHlba2V5XSA9IG9ialZhbHVlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBjb3B5O1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gdmFsdWVzLCByZXR1cm5pbmcgYSB0cnV0aHkgdmFsdWUgaWYgdGhlcmUgYXJlIGNoYW5nZXMgb3IgYGZhbHNlYCBpZiB0aGVyZSBhcmUgbm8gY2hhbmdlcy4gSWYgdGhlIHR3b1xuICAvLyB2YWx1ZXMgYXJlIGJvdGggYXJyYXlzIG9yIGJvdGggb2JqZWN0cywgYW4gYXJyYXkgb2YgY2hhbmdlcyAoc3BsaWNlcyBvciBjaGFuZ2UgcmVjb3JkcykgYmV0d2VlbiB0aGUgdHdvIHdpbGwgYmVcbiAgLy8gcmV0dXJuZWQuIE90aGVyd2lzZSAgYHRydWVgIHdpbGwgYmUgcmV0dXJuZWQuXG4gIGZ1bmN0aW9uIGRpZmZWYWx1ZXModmFsdWUsIG9sZFZhbHVlKSB7XG4gICAgLy8gU2hvcnRjdXQgb3V0IGZvciB2YWx1ZXMgdGhhdCBhcmUgZXhhY3RseSBlcXVhbFxuICAgIGlmICh2YWx1ZSA9PT0gb2xkVmFsdWUpIHJldHVybiBmYWxzZTtcblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiBBcnJheS5pc0FycmF5KG9sZFZhbHVlKSkge1xuICAgICAgLy8gSWYgYW4gYXJyYXkgaGFzIGNoYW5nZWQgY2FsY3VsYXRlIHRoZSBzcGxpY2VzXG4gICAgICB2YXIgc3BsaWNlcyA9IGRpZmZBcnJheXModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgIHJldHVybiBzcGxpY2VzLmxlbmd0aCA/IHNwbGljZXMgOiBmYWxzZTtcbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIG9sZFZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlID09PSAnb2JqZWN0Jykge1xuICAgICAgLy8gSWYgYW4gb2JqZWN0IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgY2huYWdlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIHZhciB2YWx1ZVZhbHVlID0gdmFsdWUudmFsdWVPZigpO1xuICAgICAgdmFyIG9sZFZhbHVlVmFsdWUgPSBvbGRWYWx1ZS52YWx1ZU9mKCk7XG5cbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIGlmICh0eXBlb2YgdmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlVmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiB2YWx1ZVZhbHVlICE9PSBvbGRWYWx1ZVZhbHVlO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFyIGNoYW5nZVJlY29yZHMgPSBkaWZmT2JqZWN0cyh2YWx1ZSwgb2xkVmFsdWUpO1xuICAgICAgICByZXR1cm4gY2hhbmdlUmVjb3Jkcy5sZW5ndGggPyBjaGFuZ2VSZWNvcmRzIDogZmFsc2U7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICAgIHJldHVybiBkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBiYXNpYyB0eXBlcywgcmV0dXJuaW5nIHRydWUgaWYgY2hhbmdlZCBvciBmYWxzZSBpZiBub3RcbiAgZnVuY3Rpb24gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIHZhciB2YWx1ZVZhbHVlID0gdmFsdWUudmFsdWVPZigpO1xuICAgICAgdmFyIG9sZFZhbHVlVmFsdWUgPSBvbGRWYWx1ZS52YWx1ZU9mKCk7XG5cbiAgICAgIC8vIEFsbG93IGRhdGVzIGFuZCBOdW1iZXIvU3RyaW5nIG9iamVjdHMgdG8gYmUgY29tcGFyZWRcbiAgICAgIGlmICh0eXBlb2YgdmFsdWVWYWx1ZSAhPT0gJ29iamVjdCcgJiYgdHlwZW9mIG9sZFZhbHVlVmFsdWUgIT09ICdvYmplY3QnKSB7XG4gICAgICAgIHJldHVybiBkaWZmQmFzaWModmFsdWVWYWx1ZSwgb2xkVmFsdWVWYWx1ZSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgYSB2YWx1ZSBoYXMgY2hhbmdlZCBjYWxsIHRoZSBjYWxsYmFja1xuICAgIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ251bWJlcicgJiYgaXNOYU4odmFsdWUpICYmIGlzTmFOKG9sZFZhbHVlKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWUgIT09IG9sZFZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIG9iamVjdHMgcmV0dXJuaW5nIGFuIGFycmF5IG9mIGNoYW5nZSByZWNvcmRzLiBUaGUgY2hhbmdlIHJlY29yZCBsb29rcyBsaWtlOlxuICAvLyBgYGBqYXZhc2NyaXB0XG4gIC8vIHtcbiAgLy8gICBvYmplY3Q6IG9iamVjdCxcbiAgLy8gICB0eXBlOiAnZGVsZXRlZHx1cGRhdGVkfG5ldycsXG4gIC8vICAgbmFtZTogJ3Byb3BlcnR5TmFtZScsXG4gIC8vICAgb2xkVmFsdWU6IG9sZFZhbHVlXG4gIC8vIH1cbiAgLy8gYGBgXG4gIGZ1bmN0aW9uIGRpZmZPYmplY3RzKG9iamVjdCwgb2xkT2JqZWN0KSB7XG4gICAgdmFyIGNoYW5nZVJlY29yZHMgPSBbXTtcbiAgICB2YXIgcHJvcCwgb2xkVmFsdWUsIHZhbHVlO1xuXG4gICAgLy8gR29lcyB0aHJvdWdoIHRoZSBvbGQgb2JqZWN0IChzaG91bGQgYmUgYSBjbG9uZSkgYW5kIGxvb2sgZm9yIHRoaW5ncyB0aGF0IGFyZSBub3cgZ29uZSBvciBjaGFuZ2VkXG4gICAgZm9yIChwcm9wIGluIG9sZE9iamVjdCkge1xuICAgICAgb2xkVmFsdWUgPSBvbGRPYmplY3RbcHJvcF07XG4gICAgICB2YWx1ZSA9IG9iamVjdFtwcm9wXTtcblxuICAgICAgLy8gQWxsb3cgZm9yIHRoZSBjYXNlIG9mIG9iai5wcm9wID0gdW5kZWZpbmVkICh3aGljaCBpcyBhIG5ldyBwcm9wZXJ0eSwgZXZlbiBpZiBpdCBpcyB1bmRlZmluZWQpXG4gICAgICBpZiAodmFsdWUgIT09IHVuZGVmaW5lZCAmJiAhZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBwcm9wZXJ0eSBpcyBnb25lIGl0IHdhcyByZW1vdmVkXG4gICAgICBpZiAoISAocHJvcCBpbiBvYmplY3QpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ2RlbGV0ZWQnLCBwcm9wLCBvbGRWYWx1ZSkpO1xuICAgICAgfSBlbHNlIGlmIChkaWZmQmFzaWModmFsdWUsIG9sZFZhbHVlKSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZChvYmplY3QsICd1cGRhdGVkJywgcHJvcCwgb2xkVmFsdWUpKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBHb2VzIHRocm91Z2ggdGhlIG9sZCBvYmplY3QgYW5kIGxvb2tzIGZvciB0aGluZ3MgdGhhdCBhcmUgbmV3XG4gICAgZm9yIChwcm9wIGluIG9iamVjdCkge1xuICAgICAgdmFsdWUgPSBvYmplY3RbcHJvcF07XG4gICAgICBpZiAoISAocHJvcCBpbiBvbGRPYmplY3QpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ25ldycsIHByb3ApKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheShvYmplY3QpICYmIG9iamVjdC5sZW5ndGggIT09IG9sZE9iamVjdC5sZW5ndGgpIHtcbiAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKG9iamVjdCwgJ3VwZGF0ZWQnLCAnbGVuZ3RoJywgb2xkT2JqZWN0Lmxlbmd0aCkpO1xuICAgIH1cblxuICAgIHJldHVybiBjaGFuZ2VSZWNvcmRzO1xuICB9XG5cblxuXG5cblxuICB2YXIgRURJVF9MRUFWRSA9IDA7XG4gIHZhciBFRElUX1VQREFURSA9IDE7XG4gIHZhciBFRElUX0FERCA9IDI7XG4gIHZhciBFRElUX0RFTEVURSA9IDM7XG5cblxuICAvLyBEaWZmcyB0d28gYXJyYXlzIHJldHVybmluZyBhbiBhcnJheSBvZiBzcGxpY2VzLiBBIHNwbGljZSBvYmplY3QgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgaW5kZXg6IDMsXG4gIC8vICAgcmVtb3ZlZDogW2l0ZW0sIGl0ZW1dLFxuICAvLyAgIGFkZGVkQ291bnQ6IDBcbiAgLy8gfVxuICAvLyBgYGBcbiAgZnVuY3Rpb24gZGlmZkFycmF5cyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICB2YXIgY3VycmVudFN0YXJ0ID0gMDtcbiAgICB2YXIgY3VycmVudEVuZCA9IHZhbHVlLmxlbmd0aDtcbiAgICB2YXIgb2xkU3RhcnQgPSAwO1xuICAgIHZhciBvbGRFbmQgPSBvbGRWYWx1ZS5sZW5ndGg7XG5cbiAgICB2YXIgbWluTGVuZ3RoID0gTWF0aC5taW4oY3VycmVudEVuZCwgb2xkRW5kKTtcbiAgICB2YXIgcHJlZml4Q291bnQgPSBzaGFyZWRQcmVmaXgodmFsdWUsIG9sZFZhbHVlLCBtaW5MZW5ndGgpO1xuICAgIHZhciBzdWZmaXhDb3VudCA9IHNoYXJlZFN1ZmZpeCh2YWx1ZSwgb2xkVmFsdWUsIG1pbkxlbmd0aCAtIHByZWZpeENvdW50KTtcblxuICAgIGN1cnJlbnRTdGFydCArPSBwcmVmaXhDb3VudDtcbiAgICBvbGRTdGFydCArPSBwcmVmaXhDb3VudDtcbiAgICBjdXJyZW50RW5kIC09IHN1ZmZpeENvdW50O1xuICAgIG9sZEVuZCAtPSBzdWZmaXhDb3VudDtcblxuICAgIGlmIChjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0ID09PSAwICYmIG9sZEVuZCAtIG9sZFN0YXJ0ID09PSAwKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfVxuXG4gICAgLy8gaWYgbm90aGluZyB3YXMgYWRkZWQsIG9ubHkgcmVtb3ZlZCBmcm9tIG9uZSBzcG90XG4gICAgaWYgKGN1cnJlbnRTdGFydCA9PT0gY3VycmVudEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZShjdXJyZW50U3RhcnQsIG9sZFZhbHVlLnNsaWNlKG9sZFN0YXJ0LCBvbGRFbmQpLCAwKSBdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIHJlbW92ZWQsIG9ubHkgYWRkZWQgdG8gb25lIHNwb3RcbiAgICBpZiAob2xkU3RhcnQgPT09IG9sZEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZShjdXJyZW50U3RhcnQsIFtdLCBjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0KSBdO1xuICAgIH1cblxuICAgIC8vIGEgbWl4dHVyZSBvZiBhZGRzIGFuZCByZW1vdmVzXG4gICAgdmFyIGRpc3RhbmNlcyA9IGNhbGNFZGl0RGlzdGFuY2VzKHZhbHVlLCBjdXJyZW50U3RhcnQsIGN1cnJlbnRFbmQsIG9sZFZhbHVlLCBvbGRTdGFydCwgb2xkRW5kKTtcbiAgICB2YXIgb3BzID0gc3BsaWNlT3BlcmF0aW9uc0Zyb21FZGl0RGlzdGFuY2VzKGRpc3RhbmNlcyk7XG5cbiAgICB2YXIgc3BsaWNlID0gbnVsbDtcbiAgICB2YXIgc3BsaWNlcyA9IFtdO1xuICAgIHZhciBpbmRleCA9IGN1cnJlbnRTdGFydDtcbiAgICB2YXIgb2xkSW5kZXggPSBvbGRTdGFydDtcblxuICAgIGZvciAodmFyIGkgPSAwLCBsID0gb3BzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIG9wID0gb3BzW2ldO1xuICAgICAgaWYgKG9wID09PSBFRElUX0xFQVZFKSB7XG4gICAgICAgIGlmIChzcGxpY2UpIHtcbiAgICAgICAgICBzcGxpY2VzLnB1c2goc3BsaWNlKTtcbiAgICAgICAgICBzcGxpY2UgPSBudWxsO1xuICAgICAgICB9XG5cbiAgICAgICAgaW5kZXgrKztcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfVVBEQVRFKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZShpbmRleCwgW10sIDApO1xuICAgICAgICB9XG5cbiAgICAgICAgc3BsaWNlLmFkZGVkQ291bnQrKztcbiAgICAgICAgaW5kZXgrKztcblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0FERCkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0RFTEVURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UoaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5yZW1vdmVkLnB1c2gob2xkVmFsdWVbb2xkSW5kZXhdKTtcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoc3BsaWNlKSB7XG4gICAgICBzcGxpY2VzLnB1c2goc3BsaWNlKTtcbiAgICB9XG5cbiAgICByZXR1cm4gc3BsaWNlcztcbiAgfVxuXG5cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgYmVnaW5uaW5nIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFByZWZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2VhcmNoTGVuZ3RoOyBpKyspIHtcbiAgICAgIGlmIChkaWZmQmFzaWMoY3VycmVudFtpXSwgb2xkW2ldKSkge1xuICAgICAgICByZXR1cm4gaTtcbiAgICAgIH1cbiAgICB9XG4gICAgcmV0dXJuIHNlYXJjaExlbmd0aDtcbiAgfVxuXG5cbiAgLy8gZmluZCB0aGUgbnVtYmVyIG9mIGl0ZW1zIGF0IHRoZSBlbmQgdGhhdCBhcmUgdGhlIHNhbWVcbiAgZnVuY3Rpb24gc2hhcmVkU3VmZml4KGN1cnJlbnQsIG9sZCwgc2VhcmNoTGVuZ3RoKSB7XG4gICAgdmFyIGluZGV4MSA9IGN1cnJlbnQubGVuZ3RoO1xuICAgIHZhciBpbmRleDIgPSBvbGQubGVuZ3RoO1xuICAgIHZhciBjb3VudCA9IDA7XG4gICAgd2hpbGUgKGNvdW50IDwgc2VhcmNoTGVuZ3RoICYmICFkaWZmQmFzaWMoY3VycmVudFstLWluZGV4MV0sIG9sZFstLWluZGV4Ml0pKSB7XG4gICAgICBjb3VudCsrO1xuICAgIH1cbiAgICByZXR1cm4gY291bnQ7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpIHtcbiAgICB2YXIgaSA9IGRpc3RhbmNlcy5sZW5ndGggLSAxO1xuICAgIHZhciBqID0gZGlzdGFuY2VzWzBdLmxlbmd0aCAtIDE7XG4gICAgdmFyIGN1cnJlbnQgPSBkaXN0YW5jZXNbaV1bal07XG4gICAgdmFyIGVkaXRzID0gW107XG4gICAgd2hpbGUgKGkgPiAwIHx8IGogPiAwKSB7XG4gICAgICBpZiAoaSA9PT0gMCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgaWYgKGogPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIHZhciBub3J0aFdlc3QgPSBkaXN0YW5jZXNbaSAtIDFdW2ogLSAxXTtcbiAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqXTtcbiAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpXVtqIC0gMV07XG4gICAgICB2YXIgbWluO1xuXG4gICAgICBpZiAod2VzdCA8IG5vcnRoKSB7XG4gICAgICAgIG1pbiA9IHdlc3QgPCBub3J0aFdlc3QgPyB3ZXN0IDogbm9ydGhXZXN0O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWluID0gbm9ydGggPCBub3J0aFdlc3QgPyBub3J0aCA6IG5vcnRoV2VzdDtcbiAgICAgIH1cblxuICAgICAgaWYgKG1pbiA9PT0gbm9ydGhXZXN0KSB7XG4gICAgICAgIGlmIChub3J0aFdlc3QgPT09IGN1cnJlbnQpIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfTEVBVkUpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGVkaXRzLnB1c2goRURJVF9VUERBVEUpO1xuICAgICAgICAgIGN1cnJlbnQgPSBub3J0aFdlc3Q7XG4gICAgICAgIH1cbiAgICAgICAgaS0tO1xuICAgICAgICBqLS07XG4gICAgICB9IGVsc2UgaWYgKG1pbiA9PT0gd2VzdCkge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfREVMRVRFKTtcbiAgICAgICAgaS0tO1xuICAgICAgICBjdXJyZW50ID0gd2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9BREQpO1xuICAgICAgICBqLS07XG4gICAgICAgIGN1cnJlbnQgPSBub3J0aDtcbiAgICAgIH1cbiAgICB9XG4gICAgZWRpdHMucmV2ZXJzZSgpO1xuICAgIHJldHVybiBlZGl0cztcbiAgfVxuXG5cbiAgZnVuY3Rpb24gY2FsY0VkaXREaXN0YW5jZXMoY3VycmVudCwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGQsIG9sZFN0YXJ0LCBvbGRFbmQpIHtcbiAgICAvLyBcIkRlbGV0aW9uXCIgY29sdW1uc1xuICAgIHZhciByb3dDb3VudCA9IG9sZEVuZCAtIG9sZFN0YXJ0ICsgMTtcbiAgICB2YXIgY29sdW1uQ291bnQgPSBjdXJyZW50RW5kIC0gY3VycmVudFN0YXJ0ICsgMTtcbiAgICB2YXIgZGlzdGFuY2VzID0gbmV3IEFycmF5KHJvd0NvdW50KTtcbiAgICB2YXIgaSwgajtcblxuICAgIC8vIFwiQWRkaXRpb25cIiByb3dzLiBJbml0aWFsaXplIG51bGwgY29sdW1uLlxuICAgIGZvciAoaSA9IDA7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBkaXN0YW5jZXNbaV0gPSBuZXcgQXJyYXkoY29sdW1uQ291bnQpO1xuICAgICAgZGlzdGFuY2VzW2ldWzBdID0gaTtcbiAgICB9XG5cbiAgICAvLyBJbml0aWFsaXplIG51bGwgcm93XG4gICAgZm9yIChqID0gMDsgaiA8IGNvbHVtbkNvdW50OyBqKyspIHtcbiAgICAgIGRpc3RhbmNlc1swXVtqXSA9IGo7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMTsgaSA8IHJvd0NvdW50OyBpKyspIHtcbiAgICAgIGZvciAoaiA9IDE7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICAgIGlmICghZGlmZkJhc2ljKGN1cnJlbnRbY3VycmVudFN0YXJ0ICsgaiAtIDFdLCBvbGRbb2xkU3RhcnQgKyBpIC0gMV0pKSB7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdmFyIG5vcnRoID0gZGlzdGFuY2VzW2kgLSAxXVtqXSArIDE7XG4gICAgICAgICAgdmFyIHdlc3QgPSBkaXN0YW5jZXNbaV1baiAtIDFdICsgMTtcbiAgICAgICAgICBkaXN0YW5jZXNbaV1bal0gPSBub3J0aCA8IHdlc3QgPyBub3J0aCA6IHdlc3Q7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gZGlzdGFuY2VzO1xuICB9XG59KSgpO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpO1xuZXhwb3J0cy5jb250ZXh0ID0gcmVxdWlyZSgnLi9jb250ZXh0Jyk7XG5leHBvcnRzLmV4cHJlc3Npb25zID0gcmVxdWlyZSgnZXhwcmVzc2lvbnMtanMnKTtcbmV4cG9ydHMuZXhwcmVzc2lvbnMuZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBPYnNlcnZlcjtcbnZhciBleHByZXNzaW9ucyA9IHJlcXVpcmUoJ2V4cHJlc3Npb25zLWpzJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJy4vZGlmZicpO1xudmFyIGZyYWdtZW50c0NvbnRleHQgPSByZXF1aXJlKCcuL2NvbnRleHQnKTtcbnZhciByZXF1ZXN0QW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lIHx8IHNldFRpbWVvdXQ7XG52YXIgY2FuY2VsQW5pbWF0aW9uRnJhbWUgPSB3aW5kb3cuY2FuY2VsQW5pbWF0aW9uRnJhbWUgfHwgY2xlYXJUaW1lb3V0O1xuXG4vLyAjIE9ic2VydmVyXG5cbi8vIERlZmluZXMgYW4gb2JzZXJ2ZXIgY2xhc3Mgd2hpY2ggcmVwcmVzZW50cyBhbiBleHByZXNzaW9uLiBXaGVuZXZlciB0aGF0IGV4cHJlc3Npb24gcmV0dXJucyBhIG5ldyB2YWx1ZSB0aGUgYGNhbGxiYWNrYFxuLy8gaXMgY2FsbGVkIHdpdGggdGhlIHZhbHVlLlxuLy9cbi8vIElmIHRoZSBvbGQgYW5kIG5ldyB2YWx1ZXMgd2VyZSBlaXRoZXIgYW4gYXJyYXkgb3IgYW4gb2JqZWN0LCB0aGUgYGNhbGxiYWNrYCBhbHNvXG4vLyByZWNlaXZlcyBhbiBhcnJheSBvZiBzcGxpY2VzIChmb3IgYW4gYXJyYXkpLCBvciBhbiBhcnJheSBvZiBjaGFuZ2Ugb2JqZWN0cyAoZm9yIGFuIG9iamVjdCkgd2hpY2ggYXJlIHRoZSBzYW1lXG4vLyBmb3JtYXQgdGhhdCBgQXJyYXkub2JzZXJ2ZWAgYW5kIGBPYmplY3Qub2JzZXJ2ZWAgcmV0dXJuIDxodHRwOi8vd2lraS5lY21hc2NyaXB0Lm9yZy9kb2t1LnBocD9pZD1oYXJtb255Om9ic2VydmU+LlxuZnVuY3Rpb24gT2JzZXJ2ZXIoZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICBpZiAodHlwZW9mIGV4cHIgPT09ICdmdW5jdGlvbicpIHtcbiAgICB0aGlzLmdldHRlciA9IGV4cHI7XG4gICAgdGhpcy5zZXR0ZXIgPSBleHByO1xuICB9IGVsc2Uge1xuICAgIHRoaXMuZ2V0dGVyID0gZXhwcmVzc2lvbnMucGFyc2UoZXhwciwgT2JzZXJ2ZXIuZ2xvYmFscywgT2JzZXJ2ZXIuZm9ybWF0dGVycyk7XG4gIH1cbiAgdGhpcy5leHByID0gZXhwcjtcbiAgdGhpcy5jYWxsYmFjayA9IGNhbGxiYWNrO1xuICB0aGlzLmNhbGxiYWNrQ29udGV4dCA9IGNhbGxiYWNrQ29udGV4dDtcbiAgdGhpcy5za2lwID0gZmFsc2U7XG4gIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB0aGlzLm9sZFZhbHVlID0gdW5kZWZpbmVkO1xufVxuXG5PYnNlcnZlci5wcm90b3R5cGUgPSB7XG5cbiAgLy8gQmluZHMgdGhpcyBleHByZXNzaW9uIHRvIGEgZ2l2ZW4gY29udGV4dFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0LCBza2lwVXBkYXRlKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5jYWxsYmFjaykge1xuICAgICAgT2JzZXJ2ZXIuYWRkKHRoaXMsIHNraXBVcGRhdGUpO1xuICAgIH1cbiAgfSxcblxuICAvLyBVbmJpbmRzIHRoaXMgZXhwcmVzc2lvblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIE9ic2VydmVyLnJlbW92ZSh0aGlzKTtcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB9LFxuXG4gIC8vIENsb3NlcyB0aGUgb2JzZXJ2ZXIsIGNsZWFuaW5nIHVwIGFueSBwb3NzaWJsZSBtZW1vcnktbGVha3NcbiAgY2xvc2U6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudW5iaW5kKCk7XG4gICAgdGhpcy5jYWxsYmFjayA9IG51bGw7XG4gICAgdGhpcy5jYWxsYmFja0NvbnRleHQgPSBudWxsO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhpcyBvYnNlcnZlclxuICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldHRlci5jYWxsKHRoaXMuY29udGV4dCk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFNldHMgdGhlIHZhbHVlIG9mIHRoaXMgZXhwcmVzc2lvblxuICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHJldHVybjtcbiAgICBpZiAodGhpcy5zZXR0ZXIgPT09IGZhbHNlKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLnNldHRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5zZXR0ZXIgPSB0eXBlb2YgdGhpcy5leHByID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZXhwcmVzc2lvbnMucGFyc2VTZXR0ZXIodGhpcy5leHByLCBPYnNlcnZlci5nbG9iYWxzLCBPYnNlcnZlci5mb3JtYXR0ZXJzKVxuICAgICAgICAgIDogZmFsc2U7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRoaXMuc2V0dGVyID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuc2V0dGVyKSByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHZhciByZXN1bHQgPSB0aGlzLnNldHRlci5jYWxsKHRoaXMuY29udGV4dCwgdmFsdWUpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGNhbid0IGV4cGVjdCBjb2RlIGluIGZyYWdtZW50cyBvdXRzaWRlIE9ic2VydmVyIHRvIGJlIGF3YXJlIG9mIFwic3luY1wiIHNpbmNlIG9ic2VydmVyIGNhbiBiZSByZXBsYWNlZCBieSBvdGhlclxuICAgIC8vIHR5cGVzIChlLmcuIG9uZSB3aXRob3V0IGEgYHN5bmMoKWAgbWV0aG9kLCBzdWNoIGFzIG9uZSB0aGF0IHVzZXMgYE9iamVjdC5vYnNlcnZlYCkgaW4gb3RoZXIgc3lzdGVtcy5cbiAgICB0aGlzLnN5bmMoKTtcbiAgICBPYnNlcnZlci5zeW5jKCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuXG4gIC8vIEluc3RydWN0cyB0aGlzIG9ic2VydmVyIHRvIG5vdCBjYWxsIGl0cyBgY2FsbGJhY2tgIG9uIHRoZSBuZXh0IHN5bmMsIHdoZXRoZXIgdGhlIHZhbHVlIGhhcyBjaGFuZ2VkIG9yIG5vdFxuICBza2lwTmV4dFN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2tpcCA9IHRydWU7XG4gIH0sXG5cblxuICAvLyBTeW5jcyB0aGlzIG9ic2VydmVyIG5vdywgY2FsbGluZyB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkgaWYgdGhlcmUgaGF2ZSBiZWVuIGNoYW5nZXNcbiAgc3luYzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gdGhpcy5nZXQoKTtcblxuICAgIC8vIERvbid0IGNhbGwgdGhlIGNhbGxiYWNrIGlmIGBza2lwTmV4dFN5bmNgIHdhcyBjYWxsZWQgb24gdGhlIG9ic2VydmVyXG4gICAgaWYgKHRoaXMuc2tpcCB8fCAhdGhpcy5jYWxsYmFjaykge1xuICAgICAgdGhpcy5za2lwID0gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2suIFRoaXNcbiAgICAgIHZhciBjaGFuZ2VkID0gZGlmZi52YWx1ZXModmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgaWYgKCFjaGFuZ2VkICYmICF0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMpIHJldHVybjtcbiAgICAgIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2hhbmdlZCkpIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjay5jYWxsKHRoaXMuY2FsbGJhY2tDb250ZXh0LCB2YWx1ZSwgdGhpcy5vbGRWYWx1ZSwgY2hhbmdlZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmNhbGxiYWNrLmNhbGwodGhpcy5jYWxsYmFja0NvbnRleHQsIHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRDaGFuZ2VSZWNvcmRzKSB7XG4gICAgICAvLyBTdG9yZSBhbiBpbW11dGFibGUgdmVyc2lvbiBvZiB0aGUgdmFsdWUsIGFsbG93aW5nIGZvciBhcnJheXMgYW5kIG9iamVjdHMgdG8gY2hhbmdlIGluc3RhbmNlIGJ1dCBub3QgY29udGVudCBhbmRcbiAgICAgIC8vIHN0aWxsIHJlZnJhaW4gZnJvbSBkaXNwYXRjaGluZyBjYWxsYmFja3MgKGUuZy4gd2hlbiB1c2luZyBhbiBvYmplY3QgaW4gYmluZC1jbGFzcyBvciB3aGVuIHVzaW5nIGFycmF5IGZvcm1hdHRlcnNcbiAgICAgIC8vIGluIGJpbmQtZWFjaClcbiAgICAgIHRoaXMub2xkVmFsdWUgPSBkaWZmLmNsb25lKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vbGRWYWx1ZSA9IHZhbHVlO1xuICAgIH1cbiAgfVxufTtcblxuXG4vLyBBbiBhcnJheSBvZiBhbGwgb2JzZXJ2ZXJzLCBjb25zaWRlcmVkICpwcml2YXRlKlxuT2JzZXJ2ZXIub2JzZXJ2ZXJzID0gW107XG5cbi8vIEFuIGFycmF5IG9mIGNhbGxiYWNrcyB0byBydW4gYWZ0ZXIgdGhlIG5leHQgc3luYywgY29uc2lkZXJlZCAqcHJpdmF0ZSpcbk9ic2VydmVyLmNhbGxiYWNrcyA9IFtdO1xuT2JzZXJ2ZXIubGlzdGVuZXJzID0gW107XG5cbi8vIEFkZHMgYSBuZXcgb2JzZXJ2ZXIgdG8gYmUgc3luY2VkIHdpdGggY2hhbmdlcy4gSWYgYHNraXBVcGRhdGVgIGlzIHRydWUgdGhlbiB0aGUgY2FsbGJhY2sgd2lsbCBvbmx5IGJlIGNhbGxlZCB3aGVuIGFcbi8vIGNoYW5nZSBpcyBtYWRlLCBub3QgaW5pdGlhbGx5LlxuT2JzZXJ2ZXIuYWRkID0gZnVuY3Rpb24ob2JzZXJ2ZXIsIHNraXBVcGRhdGUpIHtcbiAgdGhpcy5vYnNlcnZlcnMucHVzaChvYnNlcnZlcik7XG4gIGlmICghc2tpcFVwZGF0ZSkge1xuICAgIG9ic2VydmVyLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSB0cnVlO1xuICAgIG9ic2VydmVyLnN5bmMoKTtcbiAgfVxufTtcblxuLy8gUmVtb3ZlcyBhbiBvYnNlcnZlciwgc3RvcHBpbmcgaXQgZnJvbSBiZWluZyBydW5cbk9ic2VydmVyLnJlbW92ZSA9IGZ1bmN0aW9uKG9ic2VydmVyKSB7XG4gIHZhciBpbmRleCA9IHRoaXMub2JzZXJ2ZXJzLmluZGV4T2Yob2JzZXJ2ZXIpO1xuICBpZiAoaW5kZXggIT09IC0xKSB7XG4gICAgdGhpcy5vYnNlcnZlcnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn07XG5cbi8vICpwcml2YXRlKiBwcm9wZXJ0aWVzIHVzZWQgaW4gdGhlIHN5bmMgY3ljbGVcbk9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbk9ic2VydmVyLmNhbGxiYWNrc1J1bm5pbmcgPSBmYWxzZTtcbk9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG5PYnNlcnZlci5jeWNsZXMgPSAwO1xuT2JzZXJ2ZXIubWF4ID0gMTA7XG5PYnNlcnZlci50aW1lb3V0ID0gbnVsbDtcbk9ic2VydmVyLnN5bmNQZW5kaW5nID0gbnVsbDtcblxuLy8gU2NoZWR1bGVzIGFuIG9ic2VydmVyIHN5bmMgY3ljbGUgd2hpY2ggY2hlY2tzIGFsbCB0aGUgb2JzZXJ2ZXJzIHRvIHNlZSBpZiB0aGV5J3ZlIGNoYW5nZWQuXG5PYnNlcnZlci5zeW5jID0gZnVuY3Rpb24oY2FsbGJhY2spIHtcbiAgaWYgKE9ic2VydmVyLnN5bmNQZW5kaW5nKSByZXR1cm4gZmFsc2U7XG4gIE9ic2VydmVyLnN5bmNQZW5kaW5nID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKGZ1bmN0aW9uKCkge1xuICAgIE9ic2VydmVyLnN5bmNOb3coY2FsbGJhY2spO1xuICB9KTtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBSdW5zIHRoZSBvYnNlcnZlciBzeW5jIGN5Y2xlIHdoaWNoIGNoZWNrcyBhbGwgdGhlIG9ic2VydmVycyB0byBzZWUgaWYgdGhleSd2ZSBjaGFuZ2VkLlxuT2JzZXJ2ZXIuc3luY05vdyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICBPYnNlcnZlci5hZnRlclN5bmMoY2FsbGJhY2spO1xuICB9XG5cbiAgY2FuY2VsQW5pbWF0aW9uRnJhbWUoT2JzZXJ2ZXIuc3luY1BlbmRpbmcpO1xuICBPYnNlcnZlci5zeW5jUGVuZGluZyA9IG51bGw7XG5cbiAgaWYgKE9ic2VydmVyLnN5bmNpbmcpIHtcbiAgICBPYnNlcnZlci5yZXJ1biA9IHRydWU7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgT2JzZXJ2ZXIuc3luY2luZyA9IHRydWU7XG4gIE9ic2VydmVyLnJlcnVuID0gdHJ1ZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcblxuICBmcmFnbWVudHNDb250ZXh0LnNraXBOZXh0U3luYygpO1xuICBmcmFnbWVudHNDb250ZXh0LnJ1bihmdW5jdGlvbigpIHtcbiAgICB2YXIgaSwgbDtcblxuICAgIC8vIEFsbG93IGNhbGxiYWNrcyB0byBydW4gdGhlIHN5bmMgY3ljbGUgYWdhaW4gaW1tZWRpYXRlbHksIGJ1dCBzdG9wIGF0IGBPYnNlcnZlci5tYXhgIChkZWZhdWx0IDEwKSBjeWNsZXMgdG8gd2UgZG9uJ3RcbiAgICAvLyBydW4gaW5maW5pdGUgbG9vcHNcbiAgICB3aGlsZSAoT2JzZXJ2ZXIucmVydW4pIHtcbiAgICAgIGlmICgrK09ic2VydmVyLmN5Y2xlcyA9PT0gT2JzZXJ2ZXIubWF4KSB7XG4gICAgICAgIHRocm93IG5ldyBFcnJvcignSW5maW5pdGUgb2JzZXJ2ZXIgc3luY2luZywgYW4gb2JzZXJ2ZXIgaXMgY2FsbGluZyBPYnNlcnZlci5zeW5jKCkgdG9vIG1hbnkgdGltZXMnKTtcbiAgICAgIH1cbiAgICAgIE9ic2VydmVyLnJlcnVuID0gZmFsc2U7XG4gICAgICAvLyB0aGUgb2JzZXJ2ZXIgYXJyYXkgbWF5IGluY3JlYXNlIG9yIGRlY3JlYXNlIGluIHNpemUgKHJlbWFpbmluZyBvYnNlcnZlcnMpIGR1cmluZyB0aGUgc3luY1xuICAgICAgZm9yIChpID0gMDsgaSA8IE9ic2VydmVyLm9ic2VydmVycy5sZW5ndGg7IGkrKykge1xuICAgICAgICBPYnNlcnZlci5vYnNlcnZlcnNbaV0uc3luYygpO1xuICAgICAgfVxuICAgIH1cblxuICAgIE9ic2VydmVyLmNhbGxiYWNrc1J1bm5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGNhbGxiYWNrcyA9IE9ic2VydmVyLmNhbGxiYWNrcztcbiAgICBPYnNlcnZlci5jYWxsYmFja3MgPSBbXTtcbiAgICB3aGlsZSAoY2FsbGJhY2tzLmxlbmd0aCkge1xuICAgICAgY2FsbGJhY2tzLnNoaWZ0KCkoKTtcbiAgICB9XG5cbiAgICBmb3IgKGkgPSAwLCBsID0gT2JzZXJ2ZXIubGlzdGVuZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIGxpc3RlbmVyID0gT2JzZXJ2ZXIubGlzdGVuZXJzW2ldO1xuICAgICAgbGlzdGVuZXIoKTtcbiAgICB9XG5cbiAgICBPYnNlcnZlci5jYWxsYmFja3NSdW5uaW5nID0gZmFsc2U7XG4gIH0pO1xuXG4gIE9ic2VydmVyLnN5bmNpbmcgPSBmYWxzZTtcbiAgT2JzZXJ2ZXIuY3ljbGVzID0gMDtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG4vLyBBZnRlciB0aGUgbmV4dCBzeW5jIChvciB0aGUgY3VycmVudCBpZiBpbiB0aGUgbWlkZGxlIG9mIG9uZSksIHJ1biB0aGUgcHJvdmlkZWQgY2FsbGJhY2tcbk9ic2VydmVyLmFmdGVyU3luYyA9IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gIGlmICh0eXBlb2YgY2FsbGJhY2sgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjYWxsYmFjayBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcbiAgfVxuICBpZiAoT2JzZXJ2ZXIuY2FsbGJhY2tzUnVubmluZykge1xuICAgIE9ic2VydmVyLnN5bmMoKTtcbiAgfVxuICBPYnNlcnZlci5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG59O1xuXG5PYnNlcnZlci5vblN5bmMgPSBmdW5jdGlvbihsaXN0ZW5lcikge1xuICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gIH1cbiAgT2JzZXJ2ZXIubGlzdGVuZXJzLnB1c2gobGlzdGVuZXIpO1xufTtcblxuT2JzZXJ2ZXIucmVtb3ZlT25TeW5jID0gZnVuY3Rpb24obGlzdGVuZXIpIHtcbiAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICB9XG4gIHZhciBpbmRleCA9IE9ic2VydmVyLmxpc3RlbmVycy5pbmRleE9mKGxpc3RlbmVyKTtcbiAgaWYgKGluZGV4ICE9PSAtMSkge1xuICAgIE9ic2VydmVyLmxpc3RlbmVycy5zcGxpY2UoaW5kZXgsIDEpLnBvcCgpO1xuICB9XG59O1xuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBGYWRlIGluIGFuZCBvdXRcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbignZmFkZScsIHtcbiAgICBvcHRpb25zOiB7XG4gICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgZWFzaW5nOiAnZWFzZS1pbi1vdXQnXG4gICAgfSxcbiAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgIHsgb3BhY2l0eTogJzAnIH0sXG4gICAgICAgIHsgb3BhY2l0eTogJzEnIH1cbiAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBkb25lO1xuICAgIH0sXG4gICAgYW5pbWF0ZU91dDogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgeyBvcGFjaXR5OiAnMScgfSxcbiAgICAgICAgeyBvcGFjaXR5OiAnMCcgfVxuICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGRvbmU7XG4gICAgfVxuICB9KTtcblxuICB2YXIgc2xpZGVzID0ge1xuICAgIHNsaWRlOiAnaGVpZ2h0JyxcbiAgICBzbGlkZXY6ICdoZWlnaHQnLFxuICAgIHNsaWRlaDogJ3dpZHRoJ1xuICB9O1xuXG4gIHZhciBhbmltYXRpbmcgPSBuZXcgTWFwKCk7XG5cbiAgZnVuY3Rpb24gb2JqKGtleSwgdmFsdWUpIHtcbiAgICB2YXIgb2JqID0ge307XG4gICAgb2JqW2tleV0gPSB2YWx1ZTtcbiAgICByZXR1cm4gb2JqO1xuICB9XG5cbiAgLyoqXG4gICAqIFNsaWRlIGRvd24gYW5kIHVwLCBsZWZ0IGFuZCByaWdodFxuICAgKi9cbiAgT2JqZWN0LmtleXMoc2xpZGVzKS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICB2YXIgcHJvcGVydHkgPSBzbGlkZXNbbmFtZV07XG5cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBbmltYXRpb24obmFtZSwge1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICAgIH0sXG4gICAgICBhbmltYXRlSW46IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG4gICAgICBhbmltYXRlT3V0OiBmdW5jdGlvbihlbGVtZW50LCBkb25lKSB7XG4gICAgICAgIHZhciB2YWx1ZSA9IGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MocHJvcGVydHkpO1xuICAgICAgICBpZiAoIXZhbHVlIHx8IHZhbHVlID09PSAnMHB4Jykge1xuICAgICAgICAgIHJldHVybiBkb25lKCk7XG4gICAgICAgIH1cblxuICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJ2hpZGRlbic7XG4gICAgICAgIGVsZW1lbnQuYW5pbWF0ZShbXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCB2YWx1ZSksXG4gICAgICAgICAgb2JqKHByb3BlcnR5LCAnMHB4JylcbiAgICAgICAgXSwgdGhpcy5vcHRpb25zKS5vbmZpbmlzaCA9IGZ1bmN0aW9uKCkge1xuICAgICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnJztcbiAgICAgICAgICBkb25lKCk7XG4gICAgICAgIH07XG4gICAgICB9XG4gICAgfSk7XG5cblxuICAgIC8qKlxuICAgICAqIE1vdmUgaXRlbXMgdXAgYW5kIGRvd24gaW4gYSBsaXN0LCBzbGlkZSBkb3duIGFuZCB1cFxuICAgICAqL1xuICAgIGZyYWdtZW50cy5yZWdpc3RlckFuaW1hdGlvbihuYW1lICsgJy1tb3ZlJywge1xuICAgICAgb3B0aW9uczoge1xuICAgICAgICBkdXJhdGlvbjogMzAwLFxuICAgICAgICBlYXNpbmc6ICdlYXNlLWluLW91dCdcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVJbjogZnVuY3Rpb24oZWxlbWVudCwgZG9uZSkge1xuICAgICAgICB2YXIgdmFsdWUgPSBlbGVtZW50LmdldENvbXB1dGVkQ1NTKHByb3BlcnR5KTtcbiAgICAgICAgaWYgKCF2YWx1ZSB8fCB2YWx1ZSA9PT0gJzBweCcpIHtcbiAgICAgICAgICByZXR1cm4gZG9uZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGl0ZW0gPSBlbGVtZW50LnZpZXcgJiYgZWxlbWVudC52aWV3Ll9yZXBlYXRJdGVtXztcbiAgICAgICAgaWYgKGl0ZW0pIHtcbiAgICAgICAgICBhbmltYXRpbmcuc2V0KGl0ZW0sIGVsZW1lbnQpO1xuICAgICAgICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAgICAgICBhbmltYXRpbmcuZGVsZXRlKGl0ZW0pO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9XG5cbiAgICAgICAgLy8gRG8gdGhlIHNsaWRlXG4gICAgICAgIGVsZW1lbnQuc3R5bGUub3ZlcmZsb3cgPSAnaGlkZGVuJztcbiAgICAgICAgZWxlbWVudC5hbmltYXRlKFtcbiAgICAgICAgICBvYmoocHJvcGVydHksICcwcHgnKSxcbiAgICAgICAgICBvYmoocHJvcGVydHksIHZhbHVlKVxuICAgICAgICBdLCB0aGlzLm9wdGlvbnMpLm9uZmluaXNoID0gZnVuY3Rpb24oKSB7XG4gICAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICcnO1xuICAgICAgICAgIGRvbmUoKTtcbiAgICAgICAgfTtcbiAgICAgIH0sXG5cbiAgICAgIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKGVsZW1lbnQsIGRvbmUpIHtcbiAgICAgICAgdmFyIHZhbHVlID0gZWxlbWVudC5nZXRDb21wdXRlZENTUyhwcm9wZXJ0eSk7XG4gICAgICAgIGlmICghdmFsdWUgfHwgdmFsdWUgPT09ICcwcHgnKSB7XG4gICAgICAgICAgcmV0dXJuIGRvbmUoKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBpdGVtID0gZWxlbWVudC52aWV3ICYmIGVsZW1lbnQudmlldy5fcmVwZWF0SXRlbV87XG4gICAgICAgIGlmIChpdGVtKSB7XG4gICAgICAgICAgdmFyIG5ld0VsZW1lbnQgPSBhbmltYXRpbmcuZ2V0KGl0ZW0pO1xuICAgICAgICAgIGlmIChuZXdFbGVtZW50ICYmIG5ld0VsZW1lbnQucGFyZW50Tm9kZSA9PT0gZWxlbWVudC5wYXJlbnROb2RlKSB7XG4gICAgICAgICAgICAvLyBUaGlzIGl0ZW0gaXMgYmVpbmcgcmVtb3ZlZCBpbiBvbmUgcGxhY2UgYW5kIGFkZGVkIGludG8gYW5vdGhlci4gTWFrZSBpdCBsb29rIGxpa2UgaXRzIG1vdmluZyBieSBtYWtpbmcgYm90aFxuICAgICAgICAgICAgLy8gZWxlbWVudHMgbm90IHZpc2libGUgYW5kIGhhdmluZyBhIGNsb25lIG1vdmUgYWJvdmUgdGhlIGl0ZW1zIHRvIHRoZSBuZXcgbG9jYXRpb24uXG4gICAgICAgICAgICBlbGVtZW50ID0gdGhpcy5hbmltYXRlTW92ZShlbGVtZW50LCBuZXdFbGVtZW50KTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICAvLyBEbyB0aGUgc2xpZGVcbiAgICAgICAgZWxlbWVudC5zdHlsZS5vdmVyZmxvdyA9ICdoaWRkZW4nO1xuICAgICAgICBlbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgdmFsdWUpLFxuICAgICAgICAgIG9iaihwcm9wZXJ0eSwgJzBweCcpXG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBlbGVtZW50LnN0eWxlLm92ZXJmbG93ID0gJyc7XG4gICAgICAgICAgZG9uZSgpO1xuICAgICAgICB9O1xuICAgICAgfSxcblxuICAgICAgYW5pbWF0ZU1vdmU6IGZ1bmN0aW9uKG9sZEVsZW1lbnQsIG5ld0VsZW1lbnQpIHtcbiAgICAgICAgdmFyIHBsYWNlaG9sZGVyRWxlbWVudDtcbiAgICAgICAgdmFyIHBhcmVudCA9IG5ld0VsZW1lbnQucGFyZW50Tm9kZTtcbiAgICAgICAgaWYgKCFwYXJlbnQuX19zbGlkZU1vdmVIYW5kbGVkKSB7XG4gICAgICAgICAgcGFyZW50Ll9fc2xpZGVNb3ZlSGFuZGxlZCA9IHRydWU7XG4gICAgICAgICAgaWYgKHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHBhcmVudCkucG9zaXRpb24gPT09ICdzdGF0aWMnKSB7XG4gICAgICAgICAgICBwYXJlbnQuc3R5bGUucG9zaXRpb24gPSAncmVsYXRpdmUnO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBvcmlnU3R5bGUgPSBvbGRFbGVtZW50LmdldEF0dHJpYnV0ZSgnc3R5bGUnKTtcbiAgICAgICAgdmFyIHN0eWxlID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUob2xkRWxlbWVudCk7XG4gICAgICAgIHZhciBtYXJnaW5PZmZzZXRMZWZ0ID0gLXBhcnNlSW50KHN0eWxlLm1hcmdpbkxlZnQpO1xuICAgICAgICB2YXIgbWFyZ2luT2Zmc2V0VG9wID0gLXBhcnNlSW50KHN0eWxlLm1hcmdpblRvcCk7XG4gICAgICAgIHZhciBvbGRMZWZ0ID0gb2xkRWxlbWVudC5vZmZzZXRMZWZ0O1xuICAgICAgICB2YXIgb2xkVG9wID0gb2xkRWxlbWVudC5vZmZzZXRUb3A7XG5cbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50ID0gZnJhZ21lbnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZShvbGRFbGVtZW50LmNsb25lTm9kZSh0cnVlKSk7XG4gICAgICAgIHBsYWNlaG9sZGVyRWxlbWVudC5zdHlsZS53aWR0aCA9IG9sZEVsZW1lbnQuc3R5bGUud2lkdGggPSBzdHlsZS53aWR0aDtcbiAgICAgICAgcGxhY2Vob2xkZXJFbGVtZW50LnN0eWxlLmhlaWdodCA9IG9sZEVsZW1lbnQuc3R5bGUuaGVpZ2h0ID0gc3R5bGUuaGVpZ2h0O1xuICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcwJztcblxuICAgICAgICBvbGRFbGVtZW50LnN0eWxlLnBvc2l0aW9uID0gJ2Fic29sdXRlJztcbiAgICAgICAgb2xkRWxlbWVudC5zdHlsZS56SW5kZXggPSAxMDAwO1xuICAgICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyRWxlbWVudCwgb2xkRWxlbWVudCk7XG4gICAgICAgIG5ld0VsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcwJztcblxuICAgICAgICBvbGRFbGVtZW50LmFuaW1hdGUoW1xuICAgICAgICAgIHsgdG9wOiBvbGRUb3AgKyBtYXJnaW5PZmZzZXRUb3AgKyAncHgnLCBsZWZ0OiBvbGRMZWZ0ICsgbWFyZ2luT2Zmc2V0TGVmdCArICdweCcgfSxcbiAgICAgICAgICB7IHRvcDogbmV3RWxlbWVudC5vZmZzZXRUb3AgKyBtYXJnaW5PZmZzZXRUb3AgKyAncHgnLCBsZWZ0OiBuZXdFbGVtZW50Lm9mZnNldExlZnQgKyBtYXJnaW5PZmZzZXRMZWZ0ICsgJ3B4JyB9XG4gICAgICAgIF0sIHRoaXMub3B0aW9ucykub25maW5pc2ggPSBmdW5jdGlvbigpIHtcbiAgICAgICAgICBwbGFjZWhvbGRlckVsZW1lbnQucmVtb3ZlKCk7XG4gICAgICAgICAgb3JpZ1N0eWxlID8gb2xkRWxlbWVudC5zZXRBdHRyaWJ1dGUoJ3N0eWxlJywgb3JpZ1N0eWxlKSA6IG9sZEVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKCdzdHlsZScpO1xuICAgICAgICAgIG5ld0VsZW1lbnQuc3R5bGUub3BhY2l0eSA9ICcnO1xuICAgICAgICB9O1xuXG4gICAgICAgIHJldHVybiBwbGFjZWhvbGRlckVsZW1lbnQ7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgfSk7XG5cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gcmVnaXN0ZXJEZWZhdWx0cztcbnZhciBkaWZmID0gcmVxdWlyZSgnLi4vb2JzZXJ2ZXIvZGlmZicpO1xuXG4vKipcbiAqICMgRGVmYXVsdCBCaW5kZXJzXG4gKiBSZWdpc3RlcnMgZGVmYXVsdCBiaW5kZXJzIHdpdGggYSBmcmFnbWVudHMgb2JqZWN0LlxuICovXG5mdW5jdGlvbiByZWdpc3RlckRlZmF1bHRzKGZyYWdtZW50cykge1xuXG4gIC8qKlxuICAgKiBQcmludHMgb3V0IHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbiB0byB0aGUgY29uc29sZS5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnZGVidWcnLCB7XG4gICAgcHJpb3JpdHk6IDYwLFxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAvKmVzbGludC1kaXNhYmxlIG5vLWNvbnNvbGUgKi9cbiAgICAgIGNvbnNvbGUuaW5mbygnRGVidWc6JywgdGhpcy5leHByZXNzaW9uLCAnPScsIHZhbHVlKTtcbiAgICAgIC8qZXNsaW50LWVuYWJsZSAqL1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgdGV4dFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGRpc3BsYXkgZXNjYXBlZCB0ZXh0IGluc2lkZSBhbiBlbGVtZW50LiBUaGlzIGNhbiBiZSBkb25lIHdpdGggYmluZGluZyBkaXJlY3RseSBpbiB0ZXh0IG5vZGVzIGJ1dFxuICAgKiB1c2luZyB0aGUgYXR0cmlidXRlIGJpbmRlciBwcmV2ZW50cyBhIGZsYXNoIG9mIHVuc3R5bGVkIGNvbnRlbnQgb24gdGhlIG1haW4gcGFnZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGgxIHRleHQ9XCJ7e3Bvc3QudGl0bGV9fVwiPlVudGl0bGVkPC9oMT5cbiAgICogPGRpdiBodG1sPVwie3twb3N0LmJvZHkgfCBtYXJrZG93bn19XCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqIDxkaXY+XG4gICAqICAgPHA+TGl0dGxlIFJlZCBSaWRpbmcgSG9vZCBpcyBhIHN0b3J5IGFib3V0IGEgbGl0dGxlIGdpcmwuPC9wPlxuICAgKiAgIDxwPlxuICAgKiAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgPGEgaHJlZj1cImh0dHA6Ly9lbi53aWtpcGVkaWEub3JnL3dpa2kvTGl0dGxlX1JlZF9SaWRpbmdfSG9vZFwiPldpa2lwZWRpYTwvYT5cbiAgICogICA8L3A+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgndGV4dCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gKHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlKTtcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgaHRtbFxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGRpc3BsYXkgdW5lc2NhcGVkIEhUTUwgaW5zaWRlIGFuIGVsZW1lbnQuIEJlIHN1cmUgaXQncyB0cnVzdGVkISBUaGlzIHNob3VsZCBiZSB1c2VkIHdpdGggZmlsdGVyc1xuICAgKiB3aGljaCBjcmVhdGUgSFRNTCBmcm9tIHNvbWV0aGluZyBzYWZlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+e3twb3N0LnRpdGxlfX08L2gxPlxuICAgKiA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGBodG1sXG4gICAqIDxoMT5MaXR0bGUgUmVkPC9oMT5cbiAgICogPGRpdj5cbiAgICogICA8cD5MaXR0bGUgUmVkIFJpZGluZyBIb29kIGlzIGEgc3RvcnkgYWJvdXQgYSBsaXR0bGUgZ2lybC48L3A+XG4gICAqICAgPHA+XG4gICAqICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9MaXR0bGVfUmVkX1JpZGluZ19Ib29kXCI+V2lraXBlZGlhPC9hPlxuICAgKiAgIDwvcD5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdodG1sJywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB0aGlzLmVsZW1lbnQuaW5uZXJIVE1MID0gKHZhbHVlID09IG51bGwgPyAnJyA6IHZhbHVlKTtcbiAgfSk7XG5cblxuXG4gIC8qKlxuICAgKiAjIyBjbGFzcy1bY2xhc3NOYW1lXVxuICAgKiBBZGRzIGEgYmluZGVyIHRvIGFkZCBjbGFzc2VzIHRvIGFuIGVsZW1lbnQgZGVwZW5kZW50IG9uIHdoZXRoZXIgdGhlIGV4cHJlc3Npb24gaXMgdHJ1ZSBvciBmYWxzZS5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGRpdiBjbGFzcz1cInVzZXItaXRlbVwiIGNsYXNzLXNlbGVjdGVkLXVzZXI9XCJ7e3NlbGVjdGVkID09PSB1c2VyfX1cIj5cbiAgICogICA8YnV0dG9uIGNsYXNzPVwiYnRuIHByaW1hcnlcIiBjbGFzcy1oaWdobGlnaHQ9XCJ7e3JlYWR5fX1cIj48L2J1dHRvbj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGBzZWxlY3RlZGAgZXF1YWxzIHRoZSBgdXNlcmAgYW5kIGByZWFkeWAgaXMgYHRydWVgOipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwidXNlci1pdGVtIHNlbGVjdGVkLXVzZXJcIj5cbiAgICogICA8YnV0dG9uIGNsYXNzPVwiYnRuIHByaW1hcnkgaGlnaGxpZ2h0XCI+PC9idXR0b24+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnY2xhc3MtKicsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQuY2xhc3NMaXN0LmFkZCh0aGlzLm1hdGNoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LmNsYXNzTGlzdC5yZW1vdmUodGhpcy5tYXRjaCk7XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogV2hlbiB3b3JraW5nIHdpdGggYSBib3VuZCBjbGFzcyBhdHRyaWJ1dGUsIG1ha2Ugc3VyZSBpdCBkb2Vzbid0IHN0b3Agb24gY2xhc3MtKiBhdHRyaWJ1dGVzLlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdjbGFzcycsIHtcbiAgICBvbmx5V2hlbkJvdW5kOiB0cnVlLFxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICB2YXIgY2xhc3NMaXN0ID0gdGhpcy5lbGVtZW50LmNsYXNzTGlzdDtcbiAgICAgIGlmICh0aGlzLmNsYXNzZXMpIHtcbiAgICAgICAgdGhpcy5jbGFzc2VzLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgICAgaWYgKGNsYXNzTmFtZSkge1xuICAgICAgICAgICAgY2xhc3NMaXN0LnJlbW92ZShjbGFzc05hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgdGhpcy5jbGFzc2VzID0gdmFsdWUuc3BsaXQoL1xccysvKTtcbiAgICAgICAgdGhpcy5jbGFzc2VzLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgICAgaWYgKGNsYXNzTmFtZSkge1xuICAgICAgICAgICAgY2xhc3NMaXN0LmFkZChjbGFzc05hbWUpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiBBdXRvbWF0aWNhbGx5IGZvY3VzZXMgdGhlIGlucHV0IHdoZW4gaXQgaXMgZGlzcGxheWVkIG9uIHNjcmVlbi5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnYXV0b2ZvY3VzJywge1xuICAgIGJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgZWxlbWVudC5mb2N1cygpO1xuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiBBdXRvbWF0aWNhbGx5IHNlbGVjdHMgdGhlIGNvbnRlbnRzIG9mIGFuIGlucHV0IHdoZW4gaXQgcmVjZWl2ZXMgZm9jdXMuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2F1dG9zZWxlY3QnLCB7XG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZm9jdXNlZCwgbW91c2VFdmVudDtcblxuICAgICAgdGhpcy5lbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoJ21vdXNlZG93bicsIGZ1bmN0aW9uKCkge1xuICAgICAgICAvLyBVc2UgbWF0Y2hlcyBzaW5jZSBkb2N1bWVudC5hY3RpdmVFbGVtZW50IGRvZXNuJ3Qgd29yayB3ZWxsIHdpdGggd2ViIGNvbXBvbmVudHMgKGZ1dHVyZSBjb21wYXQpXG4gICAgICAgIGZvY3VzZWQgPSB0aGlzLm1hdGNoZXMoJzpmb2N1cycpO1xuICAgICAgICBtb3VzZUV2ZW50ID0gdHJ1ZTtcbiAgICAgIH0pO1xuXG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcignZm9jdXMnLCBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKCFtb3VzZUV2ZW50KSB7XG4gICAgICAgICAgdGhpcy5zZWxlY3QoKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG5cbiAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdtb3VzZXVwJywgZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmICghZm9jdXNlZCkge1xuICAgICAgICAgIHRoaXMuc2VsZWN0KCk7XG4gICAgICAgIH1cbiAgICAgICAgbW91c2VFdmVudCA9IGZhbHNlO1xuICAgICAgfSk7XG4gICAgfVxuICB9KTtcblxuXG5cbiAgLyoqXG4gICAqICMjIHZhbHVlXG4gICAqIEFkZHMgYSBiaW5kZXIgd2hpY2ggc2V0cyB0aGUgdmFsdWUgb2YgYW4gSFRNTCBmb3JtIGVsZW1lbnQuIFRoaXMgYmluZGVyIGFsc28gdXBkYXRlcyB0aGUgZGF0YSBhcyBpdCBpcyBjaGFuZ2VkIGluXG4gICAqIHRoZSBmb3JtIGVsZW1lbnQsIHByb3ZpZGluZyB0d28gd2F5IGJpbmRpbmcuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5GaXJzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImZpcnN0TmFtZVwiIHZhbHVlPVwidXNlci5maXJzdE5hbWVcIj5cbiAgICpcbiAgICogPGxhYmVsPkxhc3QgTmFtZTwvbGFiZWw+XG4gICAqIDxpbnB1dCB0eXBlPVwidGV4dFwiIG5hbWU9XCJsYXN0TmFtZVwiIHZhbHVlPVwidXNlci5sYXN0TmFtZVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPkZpcnN0IE5hbWU8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cInRleHRcIiBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKlxuICAgKiA8bGFiZWw+TGFzdCBOYW1lPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJ0ZXh0XCIgbmFtZT1cImxhc3ROYW1lXCIgdmFsdWU9XCJXcmlnaHRcIj5cbiAgICogYGBgXG4gICAqIEFuZCB3aGVuIHRoZSB1c2VyIGNoYW5nZXMgdGhlIHRleHQgaW4gdGhlIGZpcnN0IGlucHV0IHRvIFwiSmFjXCIsIGB1c2VyLmZpcnN0TmFtZWAgd2lsbCBiZSB1cGRhdGVkIGltbWVkaWF0ZWx5IHdpdGhcbiAgICogdGhlIHZhbHVlIG9mIGAnSmFjJ2AuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ3ZhbHVlJywge1xuICAgIG9ubHlXaGVuQm91bmQ6IHRydWUsXG4gICAgZXZlbnRzQXR0ck5hbWU6ICd2YWx1ZS1ldmVudHMnLFxuICAgIGZpZWxkQXR0ck5hbWU6ICd2YWx1ZS1maWVsZCcsXG4gICAgZGVmYXVsdEV2ZW50czogWyAnY2hhbmdlJyBdLFxuXG4gICAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIG5hbWUgPSB0aGlzLmVsZW1lbnQudGFnTmFtZS50b0xvd2VyQ2FzZSgpO1xuICAgICAgdmFyIHR5cGUgPSB0aGlzLmVsZW1lbnQudHlwZTtcbiAgICAgIHRoaXMubWV0aG9kcyA9IGlucHV0TWV0aG9kc1t0eXBlXSB8fCBpbnB1dE1ldGhvZHNbbmFtZV07XG5cbiAgICAgIGlmICghdGhpcy5tZXRob2RzKSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMuZWxlbWVudC5oYXNBdHRyaWJ1dGUodGhpcy5ldmVudHNBdHRyTmFtZSkpIHtcbiAgICAgICAgdGhpcy5ldmVudHMgPSB0aGlzLmVsZW1lbnQuZ2V0QXR0cmlidXRlKHRoaXMuZXZlbnRzQXR0ck5hbWUpLnNwbGl0KCcgJyk7XG4gICAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5ldmVudHNBdHRyTmFtZSk7XG4gICAgICB9IGVsc2UgaWYgKG5hbWUgIT09ICdvcHRpb24nKSB7XG4gICAgICAgIHRoaXMuZXZlbnRzID0gdGhpcy5kZWZhdWx0RXZlbnRzO1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5lbGVtZW50Lmhhc0F0dHJpYnV0ZSh0aGlzLmZpZWxkQXR0ck5hbWUpKSB7XG4gICAgICAgIHRoaXMudmFsdWVGaWVsZCA9IHRoaXMuZWxlbWVudC5nZXRBdHRyaWJ1dGUodGhpcy5maWVsZEF0dHJOYW1lKTtcbiAgICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmZpZWxkQXR0ck5hbWUpO1xuICAgICAgfVxuXG4gICAgICBpZiAodHlwZSA9PT0gJ29wdGlvbicpIHtcbiAgICAgICAgdGhpcy52YWx1ZUZpZWxkID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGUudmFsdWVGaWVsZDtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoIXRoaXMuZXZlbnRzKSByZXR1cm47IC8vIG5vdGhpbmcgZm9yIDxvcHRpb24+IGhlcmVcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgdmFyIG9ic2VydmVyID0gdGhpcy5vYnNlcnZlcjtcbiAgICAgIHZhciBpbnB1dCA9IHRoaXMubWV0aG9kcztcbiAgICAgIHZhciB2YWx1ZUZpZWxkID0gdGhpcy52YWx1ZUZpZWxkO1xuXG4gICAgICAvLyBUaGUgMi13YXkgYmluZGluZyBwYXJ0IGlzIHNldHRpbmcgdmFsdWVzIG9uIGNlcnRhaW4gZXZlbnRzXG4gICAgICBmdW5jdGlvbiBvbkNoYW5nZSgpIHtcbiAgICAgICAgaWYgKGlucHV0LmdldC5jYWxsKGVsZW1lbnQsIHZhbHVlRmllbGQpICE9PSBvYnNlcnZlci5vbGRWYWx1ZSAmJiAhZWxlbWVudC5yZWFkT25seSkge1xuICAgICAgICAgIG9ic2VydmVyLnNldChpbnB1dC5nZXQuY2FsbChlbGVtZW50LCB2YWx1ZUZpZWxkKSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKGVsZW1lbnQudHlwZSA9PT0gJ3RleHQnKSB7XG4gICAgICAgIGVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcigna2V5ZG93bicsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgICAgaWYgKGV2ZW50LmtleUNvZGUgPT09IDEzKSBvbkNoYW5nZSgpO1xuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5ldmVudHMuZm9yRWFjaChmdW5jdGlvbihldmVudCkge1xuICAgICAgICBlbGVtZW50LmFkZEV2ZW50TGlzdGVuZXIoZXZlbnQsIG9uQ2hhbmdlKTtcbiAgICAgIH0pO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgaWYgKHRoaXMubWV0aG9kcy5nZXQuY2FsbCh0aGlzLmVsZW1lbnQsIHRoaXMudmFsdWVGaWVsZCkgIT0gdmFsdWUpIHtcbiAgICAgICAgdGhpcy5tZXRob2RzLnNldC5jYWxsKHRoaXMuZWxlbWVudCwgdmFsdWUsIHRoaXMudmFsdWVGaWVsZCk7XG4gICAgICB9XG4gICAgfVxuICB9KTtcblxuICAvKipcbiAgICogSGFuZGxlIHRoZSBkaWZmZXJlbnQgZm9ybSB0eXBlc1xuICAgKi9cbiAgdmFyIGRlZmF1bHRJbnB1dE1ldGhvZCA9IHtcbiAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy52YWx1ZTsgfSxcbiAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7IHRoaXMudmFsdWUgPSAodmFsdWUgPT0gbnVsbCkgPyAnJyA6IHZhbHVlOyB9XG4gIH07XG5cbiAgdmFyIGlucHV0TWV0aG9kcyA9IHtcbiAgICBjaGVja2JveDoge1xuICAgICAgZ2V0OiBmdW5jdGlvbigpIHsgcmV0dXJuIHRoaXMuY2hlY2tlZDsgfSxcbiAgICAgIHNldDogZnVuY3Rpb24odmFsdWUpIHsgdGhpcy5jaGVja2VkID0gISF2YWx1ZTsgfVxuICAgIH0sXG5cbiAgICBmaWxlOiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpcy5maWxlcyAmJiB0aGlzLmZpbGVzWzBdOyB9LFxuICAgICAgc2V0OiBmdW5jdGlvbigpIHt9XG4gICAgfSxcblxuICAgIHNlbGVjdDoge1xuICAgICAgZ2V0OiBmdW5jdGlvbih2YWx1ZUZpZWxkKSB7XG4gICAgICAgIGlmICh2YWx1ZUZpZWxkKSB7XG4gICAgICAgICAgcmV0dXJuIHRoaXMub3B0aW9uc1t0aGlzLnNlbGVjdGVkSW5kZXhdLnZhbHVlT2JqZWN0O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJldHVybiB0aGlzLnZhbHVlO1xuICAgICAgICB9XG4gICAgICB9LFxuICAgICAgc2V0OiBmdW5jdGlvbih2YWx1ZSwgdmFsdWVGaWVsZCkge1xuICAgICAgICBpZiAodmFsdWUgJiYgdmFsdWVGaWVsZCkge1xuICAgICAgICAgIHRoaXMudmFsdWVPYmplY3QgPSB2YWx1ZTtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gdmFsdWVbdmFsdWVGaWVsZF07XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgdGhpcy52YWx1ZSA9ICh2YWx1ZSA9PSBudWxsKSA/ICcnIDogdmFsdWU7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgb3B0aW9uOiB7XG4gICAgICBnZXQ6IGZ1bmN0aW9uKHZhbHVlRmllbGQpIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlRmllbGQgPyB0aGlzLnZhbHVlT2JqZWN0W3ZhbHVlRmllbGRdIDogdGhpcy52YWx1ZTtcbiAgICAgIH0sXG4gICAgICBzZXQ6IGZ1bmN0aW9uKHZhbHVlLCB2YWx1ZUZpZWxkKSB7XG4gICAgICAgIGlmICh2YWx1ZSAmJiB2YWx1ZUZpZWxkKSB7XG4gICAgICAgICAgdGhpcy52YWx1ZU9iamVjdCA9IHZhbHVlO1xuICAgICAgICAgIHRoaXMudmFsdWUgPSB2YWx1ZVt2YWx1ZUZpZWxkXTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICB0aGlzLnZhbHVlID0gKHZhbHVlID09IG51bGwpID8gJycgOiB2YWx1ZTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0sXG5cbiAgICBpbnB1dDogZGVmYXVsdElucHV0TWV0aG9kLFxuXG4gICAgdGV4dGFyZWE6IGRlZmF1bHRJbnB1dE1ldGhvZFxuICB9O1xuXG5cbiAgLyoqXG4gICAqICMjIG9uLVtldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciBmb3IgZWFjaCBldmVudCBuYW1lIGluIHRoZSBhcnJheS4gV2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkIHRoZSBleHByZXNzaW9uIHdpbGwgYmUgcnVuLlxuICAgKlxuICAgKiAqKkV4YW1wbGUgRXZlbnRzOioqXG4gICAqXG4gICAqICogb24tY2xpY2tcbiAgICogKiBvbi1kYmxjbGlja1xuICAgKiAqIG9uLXN1Ym1pdFxuICAgKiAqIG9uLWNoYW5nZVxuICAgKiAqIG9uLWZvY3VzXG4gICAqICogb24tYmx1clxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8Zm9ybSBvbi1zdWJtaXQ9XCJ7e3NhdmVVc2VyKCl9fVwiPlxuICAgKiAgIDxpbnB1dCBuYW1lPVwiZmlyc3ROYW1lXCIgdmFsdWU9XCJKYWNvYlwiPlxuICAgKiAgIDxidXR0b24+U2F2ZTwvYnV0dG9uPlxuICAgKiA8L2Zvcm0+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IChldmVudHMgZG9uJ3QgYWZmZWN0IHRoZSBIVE1MKToqXG4gICAqIGBgYGh0bWxcbiAgICogPGZvcm0+XG4gICAqICAgPGlucHV0IG5hbWU9XCJmaXJzdE5hbWVcIiB2YWx1ZT1cIkphY29iXCI+XG4gICAqICAgPGJ1dHRvbj5TYXZlPC9idXR0b24+XG4gICAqIDwvZm9ybT5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ29uLSonLCB7XG4gICAgY3JlYXRlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgZXZlbnROYW1lID0gdGhpcy5tYXRjaDtcbiAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICB0aGlzLmVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudE5hbWUsIGZ1bmN0aW9uKGV2ZW50KSB7XG4gICAgICAgIGlmICghdGhpcy5oYXNBdHRyaWJ1dGUoJ2Rpc2FibGVkJykgJiYgX3RoaXMuY29udGV4dCkge1xuICAgICAgICAgIC8vIFNldCB0aGUgZXZlbnQgb24gdGhlIGNvbnRleHQgc28gaXQgbWF5IGJlIHVzZWQgaW4gdGhlIGV4cHJlc3Npb24gd2hlbiB0aGUgZXZlbnQgaXMgdHJpZ2dlcmVkLlxuICAgICAgICAgIHZhciBwcmlvckV2ZW50ID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihfdGhpcy5jb250ZXh0LCAnZXZlbnQnKTtcbiAgICAgICAgICB2YXIgcHJpb3JFbGVtZW50ID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihfdGhpcy5jb250ZXh0LCAnZWxlbWVudCcpO1xuICAgICAgICAgIF90aGlzLnNldEV2ZW50KGV2ZW50LCBwcmlvckV2ZW50LCBwcmlvckVsZW1lbnQpO1xuXG4gICAgICAgICAgLy8gTGV0IGFuIG9uLVtldmVudF0gbWFrZSB0aGUgZnVuY3Rpb24gY2FsbCB3aXRoIGl0cyBvd24gYXJndW1lbnRzXG4gICAgICAgICAgdmFyIGxpc3RlbmVyID0gX3RoaXMub2JzZXJ2ZXIuZ2V0KCk7XG5cbiAgICAgICAgICAvLyBPciBqdXN0IHJldHVybiBhIGZ1bmN0aW9uIHdoaWNoIHdpbGwgYmUgY2FsbGVkIHdpdGggdGhlIGV2ZW50IG9iamVjdFxuICAgICAgICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgPT09ICdmdW5jdGlvbicpIGxpc3RlbmVyLmNhbGwoX3RoaXMuY29udGV4dCwgZXZlbnQpO1xuXG4gICAgICAgICAgLy8gUmVzZXQgdGhlIGNvbnRleHQgdG8gaXRzIHByaW9yIHN0YXRlXG4gICAgICAgICAgX3RoaXMuY2xlYXJFdmVudCgpO1xuICAgICAgICB9XG4gICAgICB9KTtcbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLmNsZWFyRXZlbnQoKTtcbiAgICB9LFxuXG4gICAgc2V0RXZlbnQ6IGZ1bmN0aW9uKGV2ZW50LCBwcmlvckV2ZW50RGVzY3JpcHRvciwgcHJpb3JFbGVtZW50RGVzY3JpcHRvcikge1xuICAgICAgaWYgKCF0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhpcy5ldmVudCA9IGV2ZW50O1xuICAgICAgdGhpcy5wcmlvckV2ZW50RGVzY3JpcHRvciA9IHByaW9yRXZlbnREZXNjcmlwdG9yO1xuICAgICAgdGhpcy5wcmlvckVsZW1lbnREZXNjcmlwdG9yID0gcHJpb3JFbGVtZW50RGVzY3JpcHRvcjtcbiAgICAgIHRoaXMubGFzdENvbnRleHQgPSB0aGlzLmNvbnRleHQ7XG5cbiAgICAgIHRoaXMuY29udGV4dC5ldmVudCA9IGV2ZW50O1xuICAgICAgdGhpcy5jb250ZXh0LmVsZW1lbnQgPSB0aGlzLmVsZW1lbnQ7XG4gICAgfSxcblxuICAgIGNsZWFyRXZlbnQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKCF0aGlzLmV2ZW50KSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHZhciBjb250ZXh0ID0gdGhpcy5sYXN0Q29udGV4dDtcblxuICAgICAgaWYgKHRoaXMucHJpb3JFdmVudERlc2NyaXB0b3IpIHtcbiAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KGNvbnRleHQsICdldmVudCcsIHRoaXMucHJpb3JFdmVudERlc2NyaXB0b3IpO1xuICAgICAgICB0aGlzLnByaW9yRXZlbnREZXNjcmlwdG9yID0gbnVsbDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlbGV0ZSBjb250ZXh0LmV2ZW50O1xuICAgICAgfVxuXG4gICAgICBpZiAodGhpcy5wcmlvckVsZW1lbnREZXNjcmlwdG9yKSB7XG4gICAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShjb250ZXh0LCAnZWxlbWVudCcsIHRoaXMucHJpb3JFbGVtZW50RGVzY3JpcHRvcik7XG4gICAgICAgIHRoaXMucHJpb3JFbGVtZW50RGVzY3JpcHRvciA9IG51bGw7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBkZWxldGUgY29udGV4dC5lbGVtZW50O1xuICAgICAgfVxuXG4gICAgICB0aGlzLmV2ZW50ID0gbnVsbDtcbiAgICAgIHRoaXMubGFzdENvbnRleHQgPSBudWxsO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgb24tW2tleSBldmVudF1cbiAgICogQWRkcyBhIGJpbmRlciB3aGljaCBpcyB0cmlnZ2VyZWQgd2hlbiB0aGUga2V5ZG93biBldmVudCdzIGBrZXlDb2RlYCBwcm9wZXJ0eSBtYXRjaGVzLiBJZiB0aGUgbmFtZSBpbmNsdWRlcyBjdHJsXG4gICAqIHRoZW4gaXQgd2lsbCBvbmx5IGZpcmUgd2hlbiB0aGUga2V5IHBsdXMgdGhlIGN0cmxLZXkgb3IgbWV0YUtleSBpcyBwcmVzc2VkLlxuICAgKlxuICAgKiAqKktleSBFdmVudHM6KipcbiAgICpcbiAgICogKiBvbi1lbnRlclxuICAgKiAqIG9uLWN0cmwtZW50ZXJcbiAgICogKiBvbi1lc2NcbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYGh0bWxcbiAgICogPGlucHV0IG9uLWVudGVyPVwie3tzYXZlKCl9fVwiIG9uLWVzYz1cInt7Y2FuY2VsKCl9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGlucHV0PlxuICAgKiBgYGBcbiAgICovXG4gIHZhciBrZXlDb2RlcyA9IHsgZW50ZXI6IDEzLCBlc2M6IDI3LCAnY3RybC1lbnRlcic6IDEzIH07XG5cbiAgT2JqZWN0LmtleXMoa2V5Q29kZXMpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgIHZhciBrZXlDb2RlID0ga2V5Q29kZXNbbmFtZV07XG5cbiAgICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ29uLScgKyBuYW1lLCB7XG4gICAgICBjcmVhdGVkOiBmdW5jdGlvbigpIHtcbiAgICAgICAgdmFyIHVzZUN0cmxLZXkgPSBuYW1lLmluZGV4T2YoJ2N0cmwtJykgPT09IDA7XG4gICAgICAgIHZhciBfdGhpcyA9IHRoaXM7XG4gICAgICAgIHRoaXMuZWxlbWVudC5hZGRFdmVudExpc3RlbmVyKCdrZXlkb3duJywgZnVuY3Rpb24oZXZlbnQpIHtcbiAgICAgICAgICBpZiAodXNlQ3RybEtleSAmJiAhKGV2ZW50LmN0cmxLZXkgfHwgZXZlbnQubWV0YUtleSkgfHwgIV90aGlzLmNvbnRleHQpIHtcbiAgICAgICAgICAgIHJldHVybjtcbiAgICAgICAgICB9XG5cbiAgICAgICAgICBpZiAoZXZlbnQua2V5Q29kZSAhPT0ga2V5Q29kZSkge1xuICAgICAgICAgICAgcmV0dXJuO1xuICAgICAgICAgIH1cblxuICAgICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG5cbiAgICAgICAgICBpZiAoIXRoaXMuaGFzQXR0cmlidXRlKCdkaXNhYmxlZCcpKSB7XG4gICAgICAgICAgICAvLyBTZXQgdGhlIGV2ZW50IG9uIHRoZSBjb250ZXh0IHNvIGl0IG1heSBiZSB1c2VkIGluIHRoZSBleHByZXNzaW9uIHdoZW4gdGhlIGV2ZW50IGlzIHRyaWdnZXJlZC5cbiAgICAgICAgICAgIHZhciBwcmlvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoX3RoaXMuY29udGV4dCwgJ2V2ZW50Jyk7XG4gICAgICAgICAgICBfdGhpcy5jb250ZXh0LmV2ZW50ID0gZXZlbnQ7XG5cbiAgICAgICAgICAgIC8vIExldCBhbiBvbi1bZXZlbnRdIG1ha2UgdGhlIGZ1bmN0aW9uIGNhbGwgd2l0aCBpdHMgb3duIGFyZ3VtZW50c1xuICAgICAgICAgICAgdmFyIGxpc3RlbmVyID0gX3RoaXMub2JzZXJ2ZXIuZ2V0KCk7XG5cbiAgICAgICAgICAgIC8vIE9yIGp1c3QgcmV0dXJuIGEgZnVuY3Rpb24gd2hpY2ggd2lsbCBiZSBjYWxsZWQgd2l0aCB0aGUgZXZlbnQgb2JqZWN0XG4gICAgICAgICAgICBpZiAodHlwZW9mIGxpc3RlbmVyID09PSAnZnVuY3Rpb24nKSBsaXN0ZW5lci5jYWxsKF90aGlzLmNvbnRleHQsIGV2ZW50KTtcblxuICAgICAgICAgICAgLy8gUmVzZXQgdGhlIGNvbnRleHQgdG8gaXRzIHByaW9yIHN0YXRlXG4gICAgICAgICAgICBpZiAocHJpb3IpIHtcbiAgICAgICAgICAgICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KF90aGlzLmNvbnRleHQsIGV2ZW50LCBwcmlvcik7XG4gICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICBkZWxldGUgX3RoaXMuY29udGV4dC5ldmVudDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgIH0pO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBbYXR0cmlidXRlXSRcbiAgICogQWRkcyBhIGJpbmRlciB0byBzZXQgdGhlIGF0dHJpYnV0ZSBvZiBlbGVtZW50IHRvIHRoZSB2YWx1ZSBvZiB0aGUgZXhwcmVzc2lvbi4gVXNlIHRoaXMgd2hlbiB5b3UgZG9uJ3Qgd2FudCBhblxuICAgKiBgPGltZz5gIHRvIHRyeSBhbmQgbG9hZCBpdHMgYHNyY2AgYmVmb3JlIGJlaW5nIGV2YWx1YXRlZC4gVGhpcyBpcyBvbmx5IG5lZWRlZCBvbiB0aGUgaW5kZXguaHRtbCBwYWdlIGFzIHRlbXBsYXRlXG4gICAqIHdpbGwgYmUgcHJvY2Vzc2VkIGJlZm9yZSBiZWluZyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIEdlbmVyYWxseSB5b3UgY2FuIGp1c3QgdXNlIGBhdHRyPVwie3tleHByfX1cImAuXG4gICAqXG4gICAqICoqRXhhbXBsZSBBdHRyaWJ1dGVzOioqXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxpbWcgc3JjJD1cInt7dXNlci5hdmF0YXJVcmx9fVwiPlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYGh0bWxcbiAgICogPGltZyBzcmM9XCJodHRwOi8vY2RuLmV4YW1wbGUuY29tL2F2YXRhcnMvamFjd3JpZ2h0LXNtYWxsLnBuZ1wiPlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnKiQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhciBhdHRyTmFtZSA9IHRoaXMubWF0Y2g7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgdGhpcy5lbGVtZW50LnJlbW92ZUF0dHJpYnV0ZShhdHRyTmFtZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUoYXR0ck5hbWUsIHZhbHVlKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIFthdHRyaWJ1dGVdP1xuICAgKiBBZGRzIGEgYmluZGVyIHRvIHRvZ2dsZSBhbiBhdHRyaWJ1dGUgb24gb3Igb2ZmIGlmIHRoZSBleHByZXNzaW9uIGlzIHRydXRoeSBvciBmYWxzZXkuIFVzZSBmb3IgYXR0cmlidXRlcyB3aXRob3V0XG4gICAqIHZhbHVlcyBzdWNoIGFzIGBzZWxlY3RlZGAsIGBkaXNhYmxlZGAsIG9yIGByZWFkb25seWAuIGBjaGVja2VkP2Agd2lsbCB1c2UgMi13YXkgZGF0YWJpbmRpbmcuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxsYWJlbD5JcyBBZG1pbmlzdHJhdG9yPC9sYWJlbD5cbiAgICogPGlucHV0IHR5cGU9XCJjaGVja2JveFwiIGNoZWNrZWQ/PVwie3t1c2VyLmlzQWRtaW59fVwiPlxuICAgKiA8YnV0dG9uIGRpc2FibGVkPz1cInt7aXNQcm9jZXNzaW5nfX1cIj5TdWJtaXQ8L2J1dHRvbj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQgaWYgYGlzUHJvY2Vzc2luZ2AgaXMgYHRydWVgIGFuZCBgdXNlci5pc0FkbWluYCBpcyBmYWxzZToqXG4gICAqIGBgYGh0bWxcbiAgICogPGxhYmVsPklzIEFkbWluaXN0cmF0b3I8L2xhYmVsPlxuICAgKiA8aW5wdXQgdHlwZT1cImNoZWNrYm94XCI+XG4gICAqIDxidXR0b24gZGlzYWJsZWQ+U3VibWl0PC9idXR0b24+XG4gICAqIGBgYFxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCcqPycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdmFyIGF0dHJOYW1lID0gdGhpcy5tYXRjaDtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICB0aGlzLmVsZW1lbnQucmVtb3ZlQXR0cmlidXRlKGF0dHJOYW1lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5lbGVtZW50LnNldEF0dHJpYnV0ZShhdHRyTmFtZSwgJycpO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogQWRkIGEgY2xvbmUgb2YgdGhlIGB2YWx1ZWAgYmluZGVyIGZvciBgY2hlY2tlZD9gIHNvIGNoZWNrYm94ZXMgY2FuIGhhdmUgdHdvLXdheSBiaW5kaW5nIHVzaW5nIGBjaGVja2VkP2AuXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJBdHRyaWJ1dGUoJ2NoZWNrZWQ/JywgZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcigndmFsdWUnKSk7XG5cblxuICAvKipcbiAgICogU2hvd3MvaGlkZXMgYW4gZWxlbWVudCBjb25kaXRpb25hbGx5LiBgaWZgIHNob3VsZCBiZSB1c2VkIGluIG1vc3QgY2FzZXMgYXMgaXQgcmVtb3ZlcyB0aGUgZWxlbWVudCBjb21wbGV0ZWx5IGFuZCBpc1xuICAgKiBtb3JlIGVmZmVjaWVudCBzaW5jZSBiaW5kaW5ncyB3aXRoaW4gdGhlIGBpZmAgYXJlIG5vdCBhY3RpdmUgd2hpbGUgaXQgaXMgaGlkZGVuLiBVc2UgYHNob3dgIGZvciB3aGVuIHRoZSBlbGVtZW50XG4gICAqIG11c3QgcmVtYWluIGluLURPTSBvciBiaW5kaW5ncyB3aXRoaW4gaXQgbXVzdCBjb250aW51ZSB0byBiZSBwcm9jZXNzZWQgd2hpbGUgaXQgaXMgaGlkZGVuLiBZb3Ugc2hvdWxkIGRlZmF1bHQgdG9cbiAgICogdXNpbmcgYGlmYC5cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgnc2hvdycsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICB1cGRhdGVkOiBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgLy8gRm9yIHBlcmZvcm1hbmNlIHByb3ZpZGUgYW4gYWx0ZXJuYXRlIGNvZGUgcGF0aCBmb3IgYW5pbWF0aW9uXG4gICAgICBpZiAodGhpcy5hbmltYXRlICYmIHRoaXMuY29udGV4dCAmJiAhdGhpcy5maXJzdFVwZGF0ZSkge1xuICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnVwZGF0ZWRSZWd1bGFyKHZhbHVlKTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZmlyc3RVcGRhdGUgPSBmYWxzZTtcbiAgICB9LFxuXG4gICAgdXBkYXRlZFJlZ3VsYXI6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodmFsdWUpIHtcbiAgICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnJztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJ25vbmUnO1xuICAgICAgfVxuICAgIH0sXG5cbiAgICB1cGRhdGVkQW5pbWF0ZWQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IHZhbHVlO1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuICAgICAgZnVuY3Rpb24gb25GaW5pc2goKSB7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLmxhc3RWYWx1ZSAhPT0gdmFsdWUpIHtcbiAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgIH1cbiAgICAgIH1cblxuICAgICAgaWYgKHZhbHVlKSB7XG4gICAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gICAgICAgIHRoaXMuYW5pbWF0ZUluKHRoaXMuZWxlbWVudCwgb25GaW5pc2gpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5hbmltYXRlT3V0KHRoaXMuZWxlbWVudCwgZnVuY3Rpb24oKSB7XG4gICAgICAgICAgdGhpcy5lbGVtZW50LnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gICAgICAgICAgb25GaW5pc2guY2FsbCh0aGlzKTtcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuZmlyc3RVcGRhdGUgPSB0cnVlO1xuICAgIH0sXG5cbiAgICB1bmJvdW5kOiBmdW5jdGlvbigpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zdHlsZS5kaXNwbGF5ID0gJyc7XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgaWYsIHVubGVzcywgZWxzZS1pZiwgZWxzZS11bmxlc3MsIGVsc2VcbiAgICogQWRkcyBhIGJpbmRlciB0byBzaG93IG9yIGhpZGUgdGhlIGVsZW1lbnQgaWYgdGhlIHZhbHVlIGlzIHRydXRoeSBvciBmYWxzZXkuIEFjdHVhbGx5IHJlbW92ZXMgdGhlIGVsZW1lbnQgZnJvbSB0aGVcbiAgICogRE9NIHdoZW4gaGlkZGVuLCByZXBsYWNpbmcgaXQgd2l0aCBhIG5vbi12aXNpYmxlIHBsYWNlaG9sZGVyIGFuZCBub3QgbmVlZGxlc3NseSBleGVjdXRpbmcgYmluZGluZ3MgaW5zaWRlLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGkgaWY9XCJ1c2VyXCI+PGEgaHJlZj1cIi9hY2NvdW50XCI+TXkgQWNjb3VudDwvYT48L2xpPlxuICAgKiAgIDxsaSB1bmxlc3M9XCJ1c2VyXCI+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogICA8bGkgZWxzZT48YSBocmVmPVwiL2xvZ291dFwiPlNpZ24gT3V0PC9hPjwvbGk+XG4gICAqIDwvdWw+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIGB1c2VyYCBpcyBudWxsOipcbiAgICogYGBgaHRtbFxuICAgKiA8dWwgY2xhc3M9XCJoZWFkZXItbGlua3NcIj5cbiAgICogICA8bGk+PGEgaHJlZj1cIi9sb2dpblwiPlNpZ24gSW48L2E+PC9saT5cbiAgICogPC91bD5cbiAgICogYGBgXG4gICAqL1xuICB2YXIgSWZCaW5kaW5nID0gZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCdpZicsIHtcbiAgICBhbmltYXRlZDogdHJ1ZSxcbiAgICBwcmlvcml0eTogMTUwLFxuICAgIHVubGVzc0F0dHJOYW1lOiAndW5sZXNzJyxcbiAgICBlbHNlSWZBdHRyTmFtZTogJ2Vsc2UtaWYnLFxuICAgIGVsc2VVbmxlc3NBdHRyTmFtZTogJ2Vsc2UtdW5sZXNzJyxcbiAgICBlbHNlQXR0ck5hbWU6ICdlbHNlJyxcblxuICAgIGNvbXBpbGVkOiBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBlbGVtZW50ID0gdGhpcy5lbGVtZW50O1xuICAgICAgdmFyIGV4cHJlc3Npb25zID0gWyB3cmFwSWZFeHAodGhpcy5leHByZXNzaW9uLCB0aGlzLm5hbWUgPT09IHRoaXMudW5sZXNzQXR0ck5hbWUpIF07XG4gICAgICB2YXIgcGxhY2Vob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICB2YXIgbm9kZSA9IGVsZW1lbnQubmV4dEVsZW1lbnRTaWJsaW5nO1xuICAgICAgdGhpcy5lbGVtZW50ID0gcGxhY2Vob2xkZXI7XG4gICAgICBlbGVtZW50LnBhcmVudE5vZGUucmVwbGFjZUNoaWxkKHBsYWNlaG9sZGVyLCBlbGVtZW50KTtcblxuICAgICAgLy8gU3RvcmVzIGEgdGVtcGxhdGUgZm9yIGFsbCB0aGUgZWxlbWVudHMgdGhhdCBjYW4gZ28gaW50byB0aGlzIHNwb3RcbiAgICAgIHRoaXMudGVtcGxhdGVzID0gWyBmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUoZWxlbWVudCkgXTtcblxuICAgICAgLy8gUHVsbCBvdXQgYW55IG90aGVyIGVsZW1lbnRzIHRoYXQgYXJlIGNoYWluZWQgd2l0aCB0aGlzIG9uZVxuICAgICAgd2hpbGUgKG5vZGUpIHtcbiAgICAgICAgdmFyIG5leHQgPSBub2RlLm5leHRFbGVtZW50U2libGluZztcbiAgICAgICAgdmFyIGV4cHJlc3Npb247XG4gICAgICAgIGlmIChub2RlLmhhc0F0dHJpYnV0ZSh0aGlzLmVsc2VJZkF0dHJOYW1lKSkge1xuICAgICAgICAgIGV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgbm9kZS5nZXRBdHRyaWJ1dGUodGhpcy5lbHNlSWZBdHRyTmFtZSkpO1xuICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2god3JhcElmRXhwKGV4cHJlc3Npb24sIGZhbHNlKSk7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUodGhpcy5lbHNlSWZBdHRyTmFtZSk7XG4gICAgICAgIH0gZWxzZSBpZiAobm9kZS5oYXNBdHRyaWJ1dGUodGhpcy5lbHNlVW5sZXNzQXR0ck5hbWUpKSB7XG4gICAgICAgICAgZXhwcmVzc2lvbiA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCdhdHRyaWJ1dGUnLCBub2RlLmdldEF0dHJpYnV0ZSh0aGlzLmVsc2VVbmxlc3NBdHRyTmFtZSkpO1xuICAgICAgICAgIGV4cHJlc3Npb25zLnB1c2god3JhcElmRXhwKGV4cHJlc3Npb24sIHRydWUpKTtcbiAgICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZSh0aGlzLmVsc2VVbmxlc3NBdHRyTmFtZSk7XG4gICAgICAgIH0gZWxzZSBpZiAobm9kZS5oYXNBdHRyaWJ1dGUodGhpcy5lbHNlQXR0ck5hbWUpKSB7XG4gICAgICAgICAgbm9kZS5yZW1vdmVBdHRyaWJ1dGUodGhpcy5lbHNlQXR0ck5hbWUpO1xuICAgICAgICAgIG5leHQgPSBudWxsO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGJyZWFrO1xuICAgICAgICB9XG5cbiAgICAgICAgbm9kZS5yZW1vdmUoKTtcbiAgICAgICAgdGhpcy50ZW1wbGF0ZXMucHVzaChmcmFnbWVudHMuY3JlYXRlVGVtcGxhdGUobm9kZSkpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cblxuICAgICAgLy8gQW4gZXhwcmVzc2lvbiB0aGF0IHdpbGwgcmV0dXJuIGFuIGluZGV4LiBTb21ldGhpbmcgbGlrZSB0aGlzIGBleHByID8gMCA6IGV4cHIyID8gMSA6IGV4cHIzID8gMiA6IDNgLiBUaGlzIHdpbGxcbiAgICAgIC8vIGJlIHVzZWQgdG8ga25vdyB3aGljaCBzZWN0aW9uIHRvIHNob3cgaW4gdGhlIGlmL2Vsc2UtaWYvZWxzZSBncm91cGluZy5cbiAgICAgIHRoaXMuZXhwcmVzc2lvbiA9IGV4cHJlc3Npb25zLm1hcChmdW5jdGlvbihleHByLCBpbmRleCkge1xuICAgICAgICByZXR1cm4gZXhwciArICcgPyAnICsgaW5kZXggKyAnIDogJztcbiAgICAgIH0pLmpvaW4oJycpICsgZXhwcmVzc2lvbnMubGVuZ3RoO1xuICAgIH0sXG5cbiAgICB1cGRhdGVkOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgLy8gRm9yIHBlcmZvcm1hbmNlIHByb3ZpZGUgYW4gYWx0ZXJuYXRlIGNvZGUgcGF0aCBmb3IgYW5pbWF0aW9uXG4gICAgICBpZiAodGhpcy5hbmltYXRlICYmIHRoaXMuY29udGV4dCAmJiAhdGhpcy5maXJzdFVwZGF0ZSkge1xuICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZChpbmRleCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLnVwZGF0ZWRSZWd1bGFyKGluZGV4KTtcbiAgICAgIH1cbiAgICAgIHRoaXMuZmlyc3RVcGRhdGUgPSBmYWxzZTtcbiAgICB9LFxuXG4gICAgYWRkOiBmdW5jdGlvbih2aWV3KSB7XG4gICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUodmlldywgdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nKTtcbiAgICB9LFxuXG4gICAgLy8gRG9lc24ndCBkbyBtdWNoLCBidXQgYWxsb3dzIHN1Yi1jbGFzc2VzIHRvIGFsdGVyIHRoZSBmdW5jdGlvbmFsaXR5LlxuICAgIHJlbW92ZTogZnVuY3Rpb24odmlldykge1xuICAgICAgdmlldy5kaXNwb3NlKCk7XG4gICAgfSxcblxuICAgIHVwZGF0ZWRSZWd1bGFyOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnJlbW92ZSh0aGlzLnNob3dpbmcpO1xuICAgICAgICB0aGlzLnNob3dpbmcgPSBudWxsO1xuICAgICAgfVxuICAgICAgdmFyIHRlbXBsYXRlID0gdGhpcy50ZW1wbGF0ZXNbaW5kZXhdO1xuICAgICAgaWYgKHRlbXBsYXRlKSB7XG4gICAgICAgIHRoaXMuc2hvd2luZyA9IHRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgICAgdGhpcy5zaG93aW5nLmJpbmQodGhpcy5jb250ZXh0KTtcbiAgICAgICAgdGhpcy5hZGQodGhpcy5zaG93aW5nKTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgdXBkYXRlZEFuaW1hdGVkOiBmdW5jdGlvbihpbmRleCkge1xuICAgICAgdGhpcy5sYXN0VmFsdWUgPSBpbmRleDtcbiAgICAgIGlmICh0aGlzLmFuaW1hdGluZykge1xuICAgICAgICAvLyBPYnNvbGV0ZWQsIHdpbGwgY2hhbmdlIGFmdGVyIGFuaW1hdGlvbiBpcyBmaW5pc2hlZC5cbiAgICAgICAgdGhpcy5zaG93aW5nLnVuYmluZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICh0aGlzLnNob3dpbmcpIHtcbiAgICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh0aGlzLnNob3dpbmcsIGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG5cbiAgICAgICAgICBpZiAodGhpcy5zaG93aW5nKSB7XG4gICAgICAgICAgICAvLyBNYWtlIHN1cmUgdGhpcyB3YXNuJ3QgdW5ib3VuZCB3aGlsZSB3ZSB3ZXJlIGFuaW1hdGluZyAoZS5nLiBieSBhIHBhcmVudCBgaWZgIHRoYXQgZG9lc24ndCBhbmltYXRlKVxuICAgICAgICAgICAgdGhpcy5yZW1vdmUodGhpcy5zaG93aW5nKTtcbiAgICAgICAgICAgIHRoaXMuc2hvd2luZyA9IG51bGw7XG4gICAgICAgICAgfVxuXG4gICAgICAgICAgaWYgKHRoaXMuY29udGV4dCkge1xuICAgICAgICAgICAgLy8gZmluaXNoIGJ5IGFuaW1hdGluZyB0aGUgbmV3IGVsZW1lbnQgaW4gKGlmIGFueSksIHVubGVzcyBubyBsb25nZXIgYm91bmRcbiAgICAgICAgICAgIHRoaXMudXBkYXRlZEFuaW1hdGVkKHRoaXMubGFzdFZhbHVlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIHZhciB0ZW1wbGF0ZSA9IHRoaXMudGVtcGxhdGVzW2luZGV4XTtcbiAgICAgIGlmICh0ZW1wbGF0ZSkge1xuICAgICAgICB0aGlzLnNob3dpbmcgPSB0ZW1wbGF0ZS5jcmVhdGVWaWV3KCk7XG4gICAgICAgIHRoaXMuc2hvd2luZy5iaW5kKHRoaXMuY29udGV4dCk7XG4gICAgICAgIHRoaXMuYWRkKHRoaXMuc2hvd2luZyk7XG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gdHJ1ZTtcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odGhpcy5zaG93aW5nLCBmdW5jdGlvbigpIHtcbiAgICAgICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgICAgICAgIC8vIGlmIHRoZSB2YWx1ZSBjaGFuZ2VkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZyBydW4gaXQgYWdhaW5cbiAgICAgICAgICBpZiAodGhpcy5sYXN0VmFsdWUgIT09IGluZGV4KSB7XG4gICAgICAgICAgICB0aGlzLnVwZGF0ZWRBbmltYXRlZCh0aGlzLmxhc3RWYWx1ZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9LFxuXG4gICAgYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy5maXJzdFVwZGF0ZSA9IHRydWU7XG4gICAgfSxcblxuICAgIHVuYm91bmQ6IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKHRoaXMuc2hvd2luZykge1xuICAgICAgICB0aGlzLnNob3dpbmcudW5iaW5kKCk7XG4gICAgICB9XG4gICAgICB0aGlzLmxhc3RWYWx1ZSA9IG51bGw7XG4gICAgICB0aGlzLmFuaW1hdGluZyA9IGZhbHNlO1xuICAgIH1cbiAgfSk7XG5cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyQXR0cmlidXRlKCd1bmxlc3MnLCBJZkJpbmRpbmcpO1xuXG4gIGZ1bmN0aW9uIHdyYXBJZkV4cChleHByLCBpc1VubGVzcykge1xuICAgIGlmIChpc1VubGVzcykge1xuICAgICAgcmV0dXJuICchKCcgKyBleHByICsgJyknO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gZXhwcjtcbiAgICB9XG4gIH1cblxuXG4gIC8qKlxuICAgKiAjIyByZXBlYXRcbiAgICogQWRkcyBhIGJpbmRlciB0byBkdXBsaWNhdGUgYW4gZWxlbWVudCBmb3IgZWFjaCBpdGVtIGluIGFuIGFycmF5LiBUaGUgZXhwcmVzc2lvbiBtYXkgYmUgb2YgdGhlIGZvcm1hdCBgZXB4cmAgb3JcbiAgICogYGl0ZW1OYW1lIGluIGV4cHJgIHdoZXJlIGBpdGVtTmFtZWAgaXMgdGhlIG5hbWUgZWFjaCBpdGVtIGluc2lkZSB0aGUgYXJyYXkgd2lsbCBiZSByZWZlcmVuY2VkIGJ5IHdpdGhpbiBiaW5kaW5nc1xuICAgKiBpbnNpZGUgdGhlIGVsZW1lbnQuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGBodG1sXG4gICAqIDxkaXYgZWFjaD1cInt7cG9zdCBpbiBwb3N0c319XCIgY2xhc3MtZmVhdHVyZWQ9XCJ7e3Bvc3QuaXNGZWF0dXJlZH19XCI+XG4gICAqICAgPGgxPnt7cG9zdC50aXRsZX19PC9oMT5cbiAgICogICA8ZGl2IGh0bWw9XCJ7e3Bvc3QuYm9keSB8IG1hcmtkb3dufX1cIj48L2Rpdj5cbiAgICogPC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0IGlmIHRoZXJlIGFyZSAyIHBvc3RzIGFuZCB0aGUgZmlyc3Qgb25lIGlzIGZlYXR1cmVkOipcbiAgICogYGBgaHRtbFxuICAgKiA8ZGl2IGNsYXNzPVwiZmVhdHVyZWRcIj5cbiAgICogICA8aDE+TGl0dGxlIFJlZDwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPkxpdHRsZSBSZWQgUmlkaW5nIEhvb2QgaXMgYSBzdG9yeSBhYm91dCBhIGxpdHRsZSBnaXJsLjwvcD5cbiAgICogICAgIDxwPlxuICAgKiAgICAgICBNb3JlIGluZm8gY2FuIGJlIGZvdW5kIG9uXG4gICAqICAgICAgIDxhIGhyZWY9XCJodHRwOi8vZW4ud2lraXBlZGlhLm9yZy93aWtpL0xpdHRsZV9SZWRfUmlkaW5nX0hvb2RcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiA8ZGl2PlxuICAgKiAgIDxoMT5CaWcgQmx1ZTwvaDE+XG4gICAqICAgPGRpdj5cbiAgICogICAgIDxwPlNvbWUgdGhvdWdodHMgb24gdGhlIE5ldyBZb3JrIEdpYW50cy48L3A+XG4gICAqICAgICA8cD5cbiAgICogICAgICAgTW9yZSBpbmZvIGNhbiBiZSBmb3VuZCBvblxuICAgKiAgICAgICA8YSBocmVmPVwiaHR0cDovL2VuLndpa2lwZWRpYS5vcmcvd2lraS9OZXdfWW9ya19HaWFudHNcIj5XaWtpcGVkaWE8L2E+XG4gICAqICAgICA8L3A+XG4gICAqICAgPC9kaXY+XG4gICAqIDwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckF0dHJpYnV0ZSgncmVwZWF0Jywge1xuICAgIGFuaW1hdGVkOiB0cnVlLFxuICAgIHByaW9yaXR5OiAxMDAsXG5cbiAgICBjb21waWxlZDogZnVuY3Rpb24oKSB7XG4gICAgICB2YXIgcGFyZW50ID0gdGhpcy5lbGVtZW50LnBhcmVudE5vZGU7XG4gICAgICB2YXIgcGxhY2Vob2xkZXIgPSBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJyk7XG4gICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKHBsYWNlaG9sZGVyLCB0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy50ZW1wbGF0ZSA9IGZyYWdtZW50cy5jcmVhdGVUZW1wbGF0ZSh0aGlzLmVsZW1lbnQpO1xuICAgICAgdGhpcy5lbGVtZW50ID0gcGxhY2Vob2xkZXI7XG5cbiAgICAgIHZhciBwYXJ0cyA9IHRoaXMuZXhwcmVzc2lvbi5zcGxpdCgvXFxzK2luXFxzKy8pO1xuICAgICAgdGhpcy5leHByZXNzaW9uID0gcGFydHMucG9wKCk7XG4gICAgICB2YXIga2V5ID0gcGFydHMucG9wKCk7XG4gICAgICBpZiAoa2V5KSB7XG4gICAgICAgIHBhcnRzID0ga2V5LnNwbGl0KC9cXHMqLFxccyovKTtcbiAgICAgICAgdGhpcy52YWx1ZU5hbWUgPSBwYXJ0cy5wb3AoKTtcbiAgICAgICAgdGhpcy5rZXlOYW1lID0gcGFydHMucG9wKCk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge1xuICAgICAgdGhpcy52aWV3cyA9IFtdO1xuICAgICAgdGhpcy5vYnNlcnZlci5nZXRDaGFuZ2VSZWNvcmRzID0gdHJ1ZTtcbiAgICB9LFxuXG4gICAgcmVtb3ZlVmlldzogZnVuY3Rpb24odmlldykge1xuICAgICAgdmlldy5kaXNwb3NlKCk7XG4gICAgICB2aWV3Ll9yZXBlYXRJdGVtXyA9IG51bGw7XG4gICAgfSxcblxuICAgIHVwZGF0ZWQ6IGZ1bmN0aW9uKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKCFjaGFuZ2VzIHx8ICF0aGlzLmNvbnRleHQpIHtcbiAgICAgICAgdGhpcy5wb3B1bGF0ZSh2YWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBpZiAodGhpcy5hbmltYXRlKSB7XG4gICAgICAgICAgdGhpcy51cGRhdGVDaGFuZ2VzQW5pbWF0ZWQodmFsdWUsIGNoYW5nZXMpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlcyh2YWx1ZSwgY2hhbmdlcyk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9LFxuXG4gICAgLy8gTWV0aG9kIGZvciBjcmVhdGluZyBhbmQgc2V0dGluZyB1cCBuZXcgdmlld3MgZm9yIG91ciBsaXN0XG4gICAgY3JlYXRlVmlldzogZnVuY3Rpb24oa2V5LCB2YWx1ZSkge1xuICAgICAgdmFyIHZpZXcgPSB0aGlzLnRlbXBsYXRlLmNyZWF0ZVZpZXcoKTtcbiAgICAgIHZhciBjb250ZXh0ID0gdmFsdWU7XG4gICAgICBpZiAodGhpcy52YWx1ZU5hbWUpIHtcbiAgICAgICAgY29udGV4dCA9IE9iamVjdC5jcmVhdGUodGhpcy5jb250ZXh0KTtcbiAgICAgICAgaWYgKHRoaXMua2V5TmFtZSkgY29udGV4dFt0aGlzLmtleU5hbWVdID0ga2V5O1xuICAgICAgICBjb250ZXh0W3RoaXMudmFsdWVOYW1lXSA9IHZhbHVlO1xuICAgICAgICBjb250ZXh0Ll9vcmlnQ29udGV4dF8gPSB0aGlzLmNvbnRleHQuaGFzT3duUHJvcGVydHkoJ19vcmlnQ29udGV4dF8nKVxuICAgICAgICAgID8gdGhpcy5jb250ZXh0Ll9vcmlnQ29udGV4dF9cbiAgICAgICAgICA6IHRoaXMuY29udGV4dDtcbiAgICAgIH1cbiAgICAgIHZpZXcuYmluZChjb250ZXh0KTtcbiAgICAgIHZpZXcuX3JlcGVhdEl0ZW1fID0gdmFsdWU7XG4gICAgICByZXR1cm4gdmlldztcbiAgICB9LFxuXG4gICAgcG9wdWxhdGU6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICBpZiAodGhpcy5hbmltYXRpbmcpIHtcbiAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gdmFsdWU7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cblxuICAgICAgaWYgKHRoaXMudmlld3MubGVuZ3RoKSB7XG4gICAgICAgIHRoaXMudmlld3MuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuICAgICAgICB0aGlzLnZpZXdzLmxlbmd0aCA9IDA7XG4gICAgICB9XG5cbiAgICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiB2YWx1ZS5sZW5ndGgpIHtcbiAgICAgICAgdmFyIGZyYWcgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG5cbiAgICAgICAgdmFsdWUuZm9yRWFjaChmdW5jdGlvbihpdGVtLCBpbmRleCkge1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGluZGV4LCBpdGVtKTtcbiAgICAgICAgICB0aGlzLnZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZy5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfSwgdGhpcyk7XG5cbiAgICAgICAgdGhpcy5lbGVtZW50LnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWcsIHRoaXMuZWxlbWVudC5uZXh0U2libGluZyk7XG4gICAgICB9XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgdW4tYW5pbWF0ZWQgdmVyc2lvbiByZW1vdmVzIGFsbCByZW1vdmVkIHZpZXdzIGZpcnN0IHNvIHRoZXkgY2FuIGJlIHJldHVybmVkIHRvIHRoZSBwb29sIGFuZCB0aGVuIGFkZHMgbmV3XG4gICAgICogdmlld3MgYmFjayBpbi4gVGhpcyBpcyB0aGUgbW9zdCBvcHRpbWFsIG1ldGhvZCB3aGVuIG5vdCBhbmltYXRpbmcuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlczogZnVuY3Rpb24odmFsdWUsIGNoYW5nZXMpIHtcbiAgICAgIC8vIFJlbW92ZSBldmVyeXRoaW5nIGZpcnN0LCB0aGVuIGFkZCBhZ2FpbiwgYWxsb3dpbmcgZm9yIGVsZW1lbnQgcmV1c2UgZnJvbSB0aGUgcG9vbFxuICAgICAgdmFyIGFkZGVkQ291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIGFkZGVkQ291bnQgKz0gc3BsaWNlLmFkZGVkQ291bnQ7XG4gICAgICAgIGlmICghc3BsaWNlLnJlbW92ZWQubGVuZ3RoKSB7XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG4gICAgICAgIHZhciByZW1vdmVkID0gdGhpcy52aWV3cy5zcGxpY2Uoc3BsaWNlLmluZGV4IC0gYWRkZWRDb3VudCwgc3BsaWNlLnJlbW92ZWQubGVuZ3RoKTtcbiAgICAgICAgcmVtb3ZlZC5mb3JFYWNoKHRoaXMucmVtb3ZlVmlldyk7XG4gICAgICB9LCB0aGlzKTtcblxuICAgICAgLy8gQWRkIHRoZSBuZXcvbW92ZWQgdmlld3NcbiAgICAgIGNoYW5nZXMuZm9yRWFjaChmdW5jdGlvbihzcGxpY2UpIHtcbiAgICAgICAgaWYgKCFzcGxpY2UuYWRkZWRDb3VudCkgcmV0dXJuO1xuICAgICAgICB2YXIgYWRkZWRWaWV3cyA9IFtdO1xuICAgICAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICAgIHZhciBpbmRleCA9IHNwbGljZS5pbmRleDtcbiAgICAgICAgdmFyIGVuZEluZGV4ID0gaW5kZXggKyBzcGxpY2UuYWRkZWRDb3VudDtcblxuICAgICAgICBmb3IgKHZhciBpID0gaW5kZXg7IGkgPCBlbmRJbmRleDsgaSsrKSB7XG4gICAgICAgICAgdmFyIGl0ZW0gPSB2YWx1ZVtpXTtcbiAgICAgICAgICB2YXIgdmlldyA9IHRoaXMuY3JlYXRlVmlldyhpLCBpdGVtKTtcbiAgICAgICAgICBhZGRlZFZpZXdzLnB1c2godmlldyk7XG4gICAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodmlldyk7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy52aWV3cy5zcGxpY2UuYXBwbHkodGhpcy52aWV3cywgWyBpbmRleCwgMCBdLmNvbmNhdChhZGRlZFZpZXdzKSk7XG4gICAgICAgIHZhciBwcmV2aW91c1ZpZXcgPSB0aGlzLnZpZXdzW2luZGV4IC0gMV07XG4gICAgICAgIHZhciBuZXh0U2libGluZyA9IHByZXZpb3VzVmlldyA/IHByZXZpb3VzVmlldy5sYXN0Vmlld05vZGUubmV4dFNpYmxpbmcgOiB0aGlzLmVsZW1lbnQubmV4dFNpYmxpbmc7XG4gICAgICAgIHRoaXMuZWxlbWVudC5wYXJlbnROb2RlLmluc2VydEJlZm9yZShmcmFnbWVudCwgbmV4dFNpYmxpbmcpO1xuICAgICAgfSwgdGhpcyk7XG4gICAgfSxcblxuICAgIC8qKlxuICAgICAqIFRoaXMgYW5pbWF0ZWQgdmVyc2lvbiBtdXN0IGFuaW1hdGUgcmVtb3ZlZCBub2RlcyBvdXQgd2hpbGUgYWRkZWQgbm9kZXMgYXJlIGFuaW1hdGluZyBpbiBtYWtpbmcgaXQgbGVzcyBvcHRpbWFsXG4gICAgICogKGJ1dCBjb29sIGxvb2tpbmcpLiBJdCBhbHNvIGhhbmRsZXMgXCJtb3ZlXCIgYW5pbWF0aW9ucyBmb3Igbm9kZXMgd2hpY2ggYXJlIG1vdmluZyBwbGFjZSB3aXRoaW4gdGhlIGxpc3QuXG4gICAgICovXG4gICAgdXBkYXRlQ2hhbmdlc0FuaW1hdGVkOiBmdW5jdGlvbih2YWx1ZSwgY2hhbmdlcykge1xuICAgICAgaWYgKHRoaXMuYW5pbWF0aW5nKSB7XG4gICAgICAgIHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZyA9IHZhbHVlO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB2YXIgYW5pbWF0aW5nVmFsdWUgPSB2YWx1ZS5zbGljZSgpO1xuICAgICAgdmFyIGFsbEFkZGVkID0gW107XG4gICAgICB2YXIgYWxsUmVtb3ZlZCA9IFtdO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSB0cnVlO1xuXG4gICAgICAvLyBSdW4gdXBkYXRlcyB3aGljaCBvY2N1cmVkIHdoaWxlIHRoaXMgd2FzIGFuaW1hdGluZy5cbiAgICAgIGZ1bmN0aW9uIHdoZW5Eb25lKCkge1xuICAgICAgICAvLyBUaGUgbGFzdCBhbmltYXRpb24gZmluaXNoZWQgd2lsbCBydW4gdGhpc1xuICAgICAgICBpZiAoLS13aGVuRG9uZS5jb3VudCAhPT0gMCkgcmV0dXJuO1xuXG4gICAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaCh0aGlzLnJlbW92ZVZpZXcpO1xuXG4gICAgICAgIHRoaXMuYW5pbWF0aW5nID0gZmFsc2U7XG4gICAgICAgIGlmICh0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcpIHtcbiAgICAgICAgICB2YXIgY2hhbmdlcyA9IGRpZmYuYXJyYXlzKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgYW5pbWF0aW5nVmFsdWUpO1xuICAgICAgICAgIHRoaXMudXBkYXRlQ2hhbmdlc0FuaW1hdGVkKHRoaXMudmFsdWVXaGlsZUFuaW1hdGluZywgY2hhbmdlcyk7XG4gICAgICAgICAgdGhpcy52YWx1ZVdoaWxlQW5pbWF0aW5nID0gbnVsbDtcbiAgICAgICAgfVxuICAgICAgfVxuICAgICAgd2hlbkRvbmUuY291bnQgPSAwO1xuXG4gICAgICBjaGFuZ2VzLmZvckVhY2goZnVuY3Rpb24oc3BsaWNlKSB7XG4gICAgICAgIHZhciBhZGRlZFZpZXdzID0gW107XG4gICAgICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgdmFyIGluZGV4ID0gc3BsaWNlLmluZGV4O1xuICAgICAgICB2YXIgZW5kSW5kZXggPSBpbmRleCArIHNwbGljZS5hZGRlZENvdW50O1xuICAgICAgICB2YXIgcmVtb3ZlZENvdW50ID0gc3BsaWNlLnJlbW92ZWQubGVuZ3RoO1xuXG4gICAgICAgIGZvciAodmFyIGkgPSBpbmRleDsgaSA8IGVuZEluZGV4OyBpKyspIHtcbiAgICAgICAgICB2YXIgaXRlbSA9IHZhbHVlW2ldO1xuICAgICAgICAgIHZhciB2aWV3ID0gdGhpcy5jcmVhdGVWaWV3KGksIGl0ZW0pO1xuICAgICAgICAgIGFkZGVkVmlld3MucHVzaCh2aWV3KTtcbiAgICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh2aWV3KTtcbiAgICAgICAgfVxuXG4gICAgICAgIHZhciByZW1vdmVkVmlld3MgPSB0aGlzLnZpZXdzLnNwbGljZS5hcHBseSh0aGlzLnZpZXdzLCBbIGluZGV4LCByZW1vdmVkQ291bnQgXS5jb25jYXQoYWRkZWRWaWV3cykpO1xuICAgICAgICB2YXIgcHJldmlvdXNWaWV3ID0gdGhpcy52aWV3c1tpbmRleCAtIDFdO1xuICAgICAgICB2YXIgbmV4dFNpYmxpbmcgPSBwcmV2aW91c1ZpZXcgPyBwcmV2aW91c1ZpZXcubGFzdFZpZXdOb2RlLm5leHRTaWJsaW5nIDogdGhpcy5lbGVtZW50Lm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmVsZW1lbnQucGFyZW50Tm9kZS5pbnNlcnRCZWZvcmUoZnJhZ21lbnQsIG5leHRTaWJsaW5nKTtcblxuICAgICAgICBhbGxBZGRlZCA9IGFsbEFkZGVkLmNvbmNhdChhZGRlZFZpZXdzKTtcbiAgICAgICAgYWxsUmVtb3ZlZCA9IGFsbFJlbW92ZWQuY29uY2F0KHJlbW92ZWRWaWV3cyk7XG4gICAgICB9LCB0aGlzKTtcblxuXG4gICAgICBhbGxBZGRlZC5mb3JFYWNoKGZ1bmN0aW9uKHZpZXcpIHtcbiAgICAgICAgd2hlbkRvbmUuY291bnQrKztcbiAgICAgICAgdGhpcy5hbmltYXRlSW4odmlldywgd2hlbkRvbmUpO1xuICAgICAgfSwgdGhpcyk7XG5cbiAgICAgIGFsbFJlbW92ZWQuZm9yRWFjaChmdW5jdGlvbih2aWV3KSB7XG4gICAgICAgIHdoZW5Eb25lLmNvdW50Kys7XG4gICAgICAgIHZpZXcudW5iaW5kKCk7XG4gICAgICAgIHRoaXMuYW5pbWF0ZU91dCh2aWV3LCB3aGVuRG9uZSk7XG4gICAgICB9LCB0aGlzKTtcbiAgICB9LFxuXG4gICAgdW5ib3VuZDogZnVuY3Rpb24oKSB7XG4gICAgICB0aGlzLnZpZXdzLmZvckVhY2goZnVuY3Rpb24odmlldykge1xuICAgICAgICB2aWV3LnVuYmluZCgpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLnZhbHVlV2hpbGVBbmltYXRpbmcgPSBudWxsO1xuICAgICAgdGhpcy5hbmltYXRpbmcgPSBmYWxzZTtcbiAgICB9XG4gIH0pO1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZWdpc3RlckRlZmF1bHRzO1xuXG5cbi8qKlxuICogIyBEZWZhdWx0IEZvcm1hdHRlcnNcbiAqIFJlZ2lzdGVycyBkZWZhdWx0IGZvcm1hdHRlcnMgd2l0aCBhIGZyYWdtZW50cyBvYmplY3QuXG4gKi9cbmZ1bmN0aW9uIHJlZ2lzdGVyRGVmYXVsdHMoZnJhZ21lbnRzKSB7XG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3Rva2VuTGlzdCcsIGZ1bmN0aW9uKHZhbHVlKSB7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIHZhciBjbGFzc2VzID0gW107XG4gICAgICBPYmplY3Qua2V5cyh2YWx1ZSkuZm9yRWFjaChmdW5jdGlvbihjbGFzc05hbWUpIHtcbiAgICAgICAgaWYgKHZhbHVlW2NsYXNzTmFtZV0pIHtcbiAgICAgICAgICBjbGFzc2VzLnB1c2goY2xhc3NOYW1lKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgICByZXR1cm4gY2xhc3Nlcy5qb2luKCcgJyk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHZhbHVlIHx8ICcnO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiB2IFRPRE8gdlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzdHlsZXMnLCBmdW5jdGlvbih2YWx1ZSkge1xuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gdmFsdWUuam9pbignICcpO1xuICAgIH1cblxuICAgIGlmICh2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICB2YXIgY2xhc3NlcyA9IFtdO1xuICAgICAgT2JqZWN0LmtleXModmFsdWUpLmZvckVhY2goZnVuY3Rpb24oY2xhc3NOYW1lKSB7XG4gICAgICAgIGlmICh2YWx1ZVtjbGFzc05hbWVdKSB7XG4gICAgICAgICAgY2xhc3Nlcy5wdXNoKGNsYXNzTmFtZSk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgICAgcmV0dXJuIGNsYXNzZXMuam9pbignICcpO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZSB8fCAnJztcbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgZmlsdGVyXG4gICAqIEZpbHRlcnMgYW4gYXJyYXkgYnkgdGhlIGdpdmVuIGZpbHRlciBmdW5jdGlvbihzKSwgbWF5IHByb3ZpZGUgYSBmdW5jdGlvbiwgYW5cbiAgICogYXJyYXksIG9yIGFuIG9iamVjdCB3aXRoIGZpbHRlcmluZyBmdW5jdGlvbnNcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZmlsdGVyJywgZnVuY3Rpb24odmFsdWUsIGZpbHRlckZ1bmMpIHtcbiAgICBpZiAoIUFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICByZXR1cm4gW107XG4gICAgfSBlbHNlIGlmICghZmlsdGVyRnVuYykge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cblxuICAgIGlmICh0eXBlb2YgZmlsdGVyRnVuYyA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZmlsdGVyRnVuYywgdGhpcyk7XG4gICAgfSBlbHNlIGlmIChBcnJheS5pc0FycmF5KGZpbHRlckZ1bmMpKSB7XG4gICAgICBmaWx0ZXJGdW5jLmZvckVhY2goZnVuY3Rpb24oZnVuYykge1xuICAgICAgICB2YWx1ZSA9IHZhbHVlLmZpbHRlcihmdW5jLCB0aGlzKTtcbiAgICAgIH0pO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGZpbHRlckZ1bmMgPT09ICdvYmplY3QnKSB7XG4gICAgICBPYmplY3Qua2V5cyhmaWx0ZXJGdW5jKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgICB2YXIgZnVuYyA9IGZpbHRlckZ1bmNba2V5XTtcbiAgICAgICAgaWYgKHR5cGVvZiBmdW5jID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgICAgdmFsdWUgPSB2YWx1ZS5maWx0ZXIoZnVuYywgdGhpcyk7XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG1hcFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIG1hcCBhbiBhcnJheSBvciB2YWx1ZSBieSB0aGUgZ2l2ZW4gbWFwcGluZyBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdtYXAnLCBmdW5jdGlvbih2YWx1ZSwgbWFwRnVuYykge1xuICAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IHR5cGVvZiBtYXBGdW5jICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgcmV0dXJuIHZhbHVlLm1hcChtYXBGdW5jLCB0aGlzKTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG1hcEZ1bmMuY2FsbCh0aGlzLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdyZWR1Y2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVkdWNlRnVuYywgaW5pdGlhbFZhbHVlKSB7XG4gICAgaWYgKHZhbHVlID09IG51bGwgfHwgdHlwZW9mIG1hcEZ1bmMgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMsIGluaXRpYWxWYWx1ZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUucmVkdWNlKHJlZHVjZUZ1bmMpO1xuICAgICAgfVxuICAgIH0gZWxzZSBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMykge1xuICAgICAgcmV0dXJuIHJlZHVjZUZ1bmMoaW5pdGlhbFZhbHVlLCB2YWx1ZSk7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyByZWR1Y2VcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byByZWR1Y2UgYW4gYXJyYXkgb3IgdmFsdWUgYnkgdGhlIGdpdmVuIHJlZHVjZSBmdW5jdGlvblxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdzbGljZScsIGZ1bmN0aW9uKHZhbHVlLCBpbmRleCwgZW5kSW5kZXgpIHtcbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZS5zbGljZShpbmRleCwgZW5kSW5kZXgpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBkYXRlXG4gICAqIEFkZHMgYSBmb3JtYXR0ZXIgdG8gZm9ybWF0IGRhdGVzIGFuZCBzdHJpbmdzXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2RhdGUnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJldHVybiAnJztcbiAgICB9XG5cbiAgICBpZiAoISh2YWx1ZSBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgICB2YWx1ZSA9IG5ldyBEYXRlKHZhbHVlKTtcbiAgICB9XG5cbiAgICBpZiAoaXNOYU4odmFsdWUuZ2V0VGltZSgpKSkge1xuICAgICAgcmV0dXJuICcnO1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS50b0xvY2FsZVN0cmluZygpO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsb2dcbiAgICogQWRkcyBhIGZvcm1hdHRlciB0byBsb2cgdGhlIHZhbHVlIG9mIHRoZSBleHByZXNzaW9uLCB1c2VmdWwgZm9yIGRlYnVnZ2luZ1xuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdsb2cnLCBmdW5jdGlvbih2YWx1ZSwgcHJlZml4KSB7XG4gICAgaWYgKHByZWZpeCA9PSBudWxsKSBwcmVmaXggPSAnTG9nOic7XG4gICAgLyplc2xpbnQtZGlzYWJsZSBuby1jb25zb2xlICovXG4gICAgY29uc29sZS5sb2cocHJlZml4LCB2YWx1ZSk7XG4gICAgLyplc2xpbnQtZW5hYmxlICovXG4gICAgcmV0dXJuIHZhbHVlO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBsaW1pdFxuICAgKiBBZGRzIGEgZm9ybWF0dGVyIHRvIGxpbWl0IHRoZSBsZW5ndGggb2YgYW4gYXJyYXkgb3Igc3RyaW5nXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2xpbWl0JywgZnVuY3Rpb24odmFsdWUsIGxpbWl0KSB7XG4gICAgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZS5zbGljZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgaWYgKGxpbWl0IDwgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UobGltaXQpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdmFsdWUuc2xpY2UoMCwgbGltaXQpO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICByZXR1cm4gdmFsdWU7XG4gICAgfVxuICB9KTtcblxuXG4gIC8qKlxuICAgKiAjIyBzb3J0XG4gICAqIFNvcnRzIGFuIGFycmF5IGdpdmVuIGEgZmllbGQgbmFtZSBvciBzb3J0IGZ1bmN0aW9uLCBhbmQgYSBkaXJlY3Rpb25cbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignc29ydCcsIGZ1bmN0aW9uKHZhbHVlLCBzb3J0RnVuYywgZGlyKSB7XG4gICAgaWYgKCFzb3J0RnVuYyB8fCAhQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiB2YWx1ZTtcbiAgICB9XG4gICAgZGlyID0gKGRpciA9PT0gJ2Rlc2MnKSA/IC0xIDogMTtcbiAgICBpZiAodHlwZW9mIHNvcnRGdW5jID09PSAnc3RyaW5nJykge1xuICAgICAgdmFyIHBhcnRzID0gc29ydEZ1bmMuc3BsaXQoJzonKTtcbiAgICAgIHZhciBwcm9wID0gcGFydHNbMF07XG4gICAgICB2YXIgZGlyMiA9IHBhcnRzWzFdO1xuICAgICAgZGlyMiA9IChkaXIyID09PSAnZGVzYycpID8gLTEgOiAxO1xuICAgICAgZGlyID0gZGlyIHx8IGRpcjI7XG4gICAgICBzb3J0RnVuYyA9IGZ1bmN0aW9uKGEsIGIpIHtcbiAgICAgICAgaWYgKGFbcHJvcF0gPiBiW3Byb3BdKSByZXR1cm4gZGlyO1xuICAgICAgICBpZiAoYVtwcm9wXSA8IGJbcHJvcF0pIHJldHVybiAtZGlyO1xuICAgICAgICByZXR1cm4gMDtcbiAgICAgIH07XG4gICAgfSBlbHNlIGlmIChkaXIgPT09IC0xKSB7XG4gICAgICB2YXIgb3JpZ0Z1bmMgPSBzb3J0RnVuYztcbiAgICAgIHNvcnRGdW5jID0gZnVuY3Rpb24oYSwgYikgeyByZXR1cm4gLW9yaWdGdW5jKGEsIGIpOyB9O1xuICAgIH1cblxuICAgIHJldHVybiB2YWx1ZS5zbGljZSgpLnNvcnQoc29ydEZ1bmMuYmluZCh0aGlzKSk7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIGFkZFF1ZXJ5XG4gICAqIFRha2VzIHRoZSBpbnB1dCBVUkwgYW5kIGFkZHMgKG9yIHJlcGxhY2VzKSB0aGUgZmllbGQgaW4gdGhlIHF1ZXJ5XG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2FkZFF1ZXJ5JywgZnVuY3Rpb24odmFsdWUsIHF1ZXJ5RmllbGQsIHF1ZXJ5VmFsdWUpIHtcbiAgICB2YXIgdXJsID0gdmFsdWUgfHwgbG9jYXRpb24uaHJlZjtcbiAgICB2YXIgcGFydHMgPSB1cmwuc3BsaXQoJz8nKTtcbiAgICB1cmwgPSBwYXJ0c1swXTtcbiAgICB2YXIgcXVlcnkgPSBwYXJ0c1sxXTtcbiAgICB2YXIgYWRkZWRRdWVyeSA9ICcnO1xuICAgIGlmIChxdWVyeVZhbHVlICE9IG51bGwpIHtcbiAgICAgIGFkZGVkUXVlcnkgPSBxdWVyeUZpZWxkICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHF1ZXJ5VmFsdWUpO1xuICAgIH1cblxuICAgIGlmIChxdWVyeSkge1xuICAgICAgdmFyIGV4cHIgPSBuZXcgUmVnRXhwKCdcXFxcYicgKyBxdWVyeUZpZWxkICsgJz1bXiZdKicpO1xuICAgICAgaWYgKGV4cHIudGVzdChxdWVyeSkpIHtcbiAgICAgICAgcXVlcnkgPSBxdWVyeS5yZXBsYWNlKGV4cHIsIGFkZGVkUXVlcnkpO1xuICAgICAgfSBlbHNlIGlmIChhZGRlZFF1ZXJ5KSB7XG4gICAgICAgIHF1ZXJ5ICs9ICcmJyArIGFkZGVkUXVlcnk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHF1ZXJ5ID0gYWRkZWRRdWVyeTtcbiAgICB9XG4gICAgaWYgKHF1ZXJ5KSB7XG4gICAgICB1cmwgKz0gJz8nICsgcXVlcnk7XG4gICAgfVxuICAgIHJldHVybiB1cmw7XG4gIH0pO1xuXG5cbiAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICBmdW5jdGlvbiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICBkaXYuaW5uZXJIVE1MID0gdmFsdWU7XG4gICAgICByZXR1cm4gZGl2LnRleHRDb250ZW50O1xuICAgIH0gZWxzZSB7XG4gICAgICBkaXYudGV4dENvbnRlbnQgPSB2YWx1ZSB8fCAnJztcbiAgICAgIHJldHVybiBkaXYuaW5uZXJIVE1MO1xuICAgIH1cbiAgfVxuXG5cbiAgLyoqXG4gICAqICMjIGVzY2FwZVxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudC4gRm9yIHVzZSB3aXRoIG90aGVyIEhUTUwtYWRkaW5nIGZvcm1hdHRlcnMgc3VjaCBhcyBhdXRvbGluay5cbiAgICpcbiAgICogKipFeGFtcGxlOioqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2IGJpbmQtaHRtbD1cInR3ZWV0LmNvbnRlbnQgfCBlc2NhcGUgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignZXNjYXBlJywgZXNjYXBlSFRNTCk7XG5cblxuICAvKipcbiAgICogIyMgcFxuICAgKiBIVE1MIGVzY2FwZXMgY29udGVudCB3cmFwcGluZyBwYXJhZ3JhcGhzIGluIDxwPiB0YWdzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IHAgfCBhdXRvbGluazp0cnVlXCI+PC9kaXY+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgeG1sXG4gICAqIDxkaXY+PHA+Q2hlY2sgb3V0IDxhIGhyZWY9XCJodHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy9cIiB0YXJnZXQ9XCJfYmxhbmtcIj5odHRwczovL2dpdGh1Yi5jb20vY2hpcC1qcy88L2E+ITwvcD5cbiAgICogPHA+SXQncyBncmVhdDwvcD48L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ3AnLCBmdW5jdGlvbih2YWx1ZSwgc2V0dGVyKSB7XG4gICAgaWYgKHNldHRlcikge1xuICAgICAgcmV0dXJuIGVzY2FwZUhUTUwodmFsdWUsIHNldHRlcik7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBsaW5lcyA9ICh2YWx1ZSB8fCAnJykuc3BsaXQoL1xccj9cXG4vKTtcbiAgICAgIHZhciBlc2NhcGVkID0gbGluZXMubWFwKGZ1bmN0aW9uKGxpbmUpIHsgcmV0dXJuIGVzY2FwZUhUTUwobGluZSkgfHwgJzxicj4nOyB9KTtcbiAgICAgIHJldHVybiAnPHA+JyArIGVzY2FwZWQuam9pbignPC9wPlxcbjxwPicpICsgJzwvcD4nO1xuICAgIH1cbiAgfSk7XG5cblxuICAvKipcbiAgICogIyMgYnJcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxicj4gdGFncyBpbiBwbGFjZSBvZiBuZXdsaW5lcyBjaGFyYWN0ZXJzLlxuICAgKlxuICAgKiAqKkV4YW1wbGU6KipcbiAgICogYGBgeG1sXG4gICAqIDxkaXYgYmluZC1odG1sPVwidHdlZXQuY29udGVudCB8IGJyIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8YnI+XG4gICAqIEl0J3MgZ3JlYXQ8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2JyJywgZnVuY3Rpb24odmFsdWUsIHNldHRlcikge1xuICAgIGlmIChzZXR0ZXIpIHtcbiAgICAgIHJldHVybiBlc2NhcGVIVE1MKHZhbHVlLCBzZXR0ZXIpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbGluZXMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICByZXR1cm4gbGluZXMubWFwKGVzY2FwZUhUTUwpLmpvaW4oJzxicj5cXG4nKTtcbiAgICB9XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqICMjIG5ld2xpbmVcbiAgICogSFRNTCBlc2NhcGVzIGNvbnRlbnQgYWRkaW5nIDxwPiB0YWdzIGF0IGRvdWJsZSBuZXdsaW5lcyBhbmQgPGJyPiB0YWdzIGluIHBsYWNlIG9mIHNpbmdsZSBuZXdsaW5lIGNoYXJhY3RlcnMuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgbmV3bGluZSB8IGF1dG9saW5rOnRydWVcIj48L2Rpdj5cbiAgICogYGBgXG4gICAqICpSZXN1bHQ6KlxuICAgKiBgYGB4bWxcbiAgICogPGRpdj48cD5DaGVjayBvdXQgPGEgaHJlZj1cImh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzL1wiIHRhcmdldD1cIl9ibGFua1wiPmh0dHBzOi8vZ2l0aHViLmNvbS9jaGlwLWpzLzwvYT4hPGJyPlxuICAgKiBJdCdzIGdyZWF0PC9wPjwvZGl2PlxuICAgKiBgYGBcbiAgICovXG4gIGZyYWdtZW50cy5yZWdpc3RlckZvcm1hdHRlcignbmV3bGluZScsIGZ1bmN0aW9uKHZhbHVlLCBzZXR0ZXIpIHtcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICByZXR1cm4gZXNjYXBlSFRNTCh2YWx1ZSwgc2V0dGVyKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIHBhcmFncmFwaHMgPSAodmFsdWUgfHwgJycpLnNwbGl0KC9cXHI/XFxuXFxzKlxccj9cXG4vKTtcbiAgICAgIHZhciBlc2NhcGVkID0gcGFyYWdyYXBocy5tYXAoZnVuY3Rpb24ocGFyYWdyYXBoKSB7XG4gICAgICAgIHZhciBsaW5lcyA9IHBhcmFncmFwaC5zcGxpdCgvXFxyP1xcbi8pO1xuICAgICAgICByZXR1cm4gbGluZXMubWFwKGVzY2FwZUhUTUwpLmpvaW4oJzxicj5cXG4nKTtcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuICc8cD4nICsgZXNjYXBlZC5qb2luKCc8L3A+XFxuXFxuPHA+JykgKyAnPC9wPic7XG4gICAgfVxuICB9KTtcblxuXG5cbiAgdmFyIHVybEV4cCA9IC8oXnxcXHN8XFwoKSgoPzpodHRwcz98ZnRwKTpcXC9cXC9bXFwtQS1aMC05K1xcdTAwMjZAI1xcLyU/PSgpfl98ITosLjtdKltcXC1BLVowLTkrXFx1MDAyNkAjXFwvJT1+KF98XSkvZ2k7XG4gIHZhciB3d3dFeHAgPSAvKF58W15cXC9dKSh3d3dcXC5bXFxTXStcXC5cXHd7Mix9KFxcYnwkKSkvZ2ltO1xuICAvKipcbiAgICogIyMgYXV0b2xpbmtcbiAgICogQWRkcyBhdXRvbWF0aWMgbGlua3MgdG8gZXNjYXBlZCBjb250ZW50IChiZSBzdXJlIHRvIGVzY2FwZSB1c2VyIGNvbnRlbnQpLiBDYW4gYmUgdXNlZCBvbiBleGlzdGluZyBIVE1MIGNvbnRlbnQgYXMgaXRcbiAgICogd2lsbCBza2lwIFVSTHMgd2l0aGluIEhUTUwgdGFncy4gUGFzc2luZyB0cnVlIGluIHRoZSBzZWNvbmQgcGFyYW1ldGVyIHdpbGwgc2V0IHRoZSB0YXJnZXQgdG8gYF9ibGFua2AuXG4gICAqXG4gICAqICoqRXhhbXBsZToqKlxuICAgKiBgYGB4bWxcbiAgICogPGRpdiBiaW5kLWh0bWw9XCJ0d2VldC5jb250ZW50IHwgZXNjYXBlIHwgYXV0b2xpbms6dHJ1ZVwiPjwvZGl2PlxuICAgKiBgYGBcbiAgICogKlJlc3VsdDoqXG4gICAqIGBgYHhtbFxuICAgKiA8ZGl2PkNoZWNrIG91dCA8YSBocmVmPVwiaHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvXCIgdGFyZ2V0PVwiX2JsYW5rXCI+aHR0cHM6Ly9naXRodWIuY29tL2NoaXAtanMvPC9hPiE8L2Rpdj5cbiAgICogYGBgXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2F1dG9saW5rJywgZnVuY3Rpb24odmFsdWUsIHRhcmdldCkge1xuICAgIHRhcmdldCA9ICh0YXJnZXQpID8gJyB0YXJnZXQ9XCJfYmxhbmtcIicgOiAnJztcblxuICAgIHJldHVybiAoJycgKyB2YWx1ZSkucmVwbGFjZSgvPFtePl0rPnxbXjxdKy9nLCBmdW5jdGlvbihtYXRjaCkge1xuICAgICAgaWYgKG1hdGNoLmNoYXJBdCgwKSA9PT0gJzwnKSB7XG4gICAgICAgIHJldHVybiBtYXRjaDtcbiAgICAgIH1cbiAgICAgIHZhciByZXBsYWNlZFRleHQgPSBtYXRjaC5yZXBsYWNlKHVybEV4cCwgJyQxPGEgaHJlZj1cIiQyXCInICsgdGFyZ2V0ICsgJz4kMjwvYT4nKTtcbiAgICAgIHJldHVybiByZXBsYWNlZFRleHQucmVwbGFjZSh3d3dFeHAsICckMTxhIGhyZWY9XCJodHRwOi8vJDJcIicgKyB0YXJnZXQgKyAnPiQyPC9hPicpO1xuICAgIH0pO1xuICB9KTtcblxuXG4gIC8qKlxuICAgKlxuICAgKi9cbiAgZnJhZ21lbnRzLnJlZ2lzdGVyRm9ybWF0dGVyKCdpbnQnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHZhbHVlID0gcGFyc2VJbnQodmFsdWUpO1xuICAgIHJldHVybiBpc05hTih2YWx1ZSkgPyBudWxsIDogdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2Zsb2F0JywgZnVuY3Rpb24odmFsdWUpIHtcbiAgICB2YWx1ZSA9IHBhcnNlRmxvYXQodmFsdWUpO1xuICAgIHJldHVybiBpc05hTih2YWx1ZSkgPyBudWxsIDogdmFsdWU7XG4gIH0pO1xuXG5cbiAgLyoqXG4gICAqXG4gICAqL1xuICBmcmFnbWVudHMucmVnaXN0ZXJGb3JtYXR0ZXIoJ2Jvb2wnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgIHJldHVybiB2YWx1ZSAmJiB2YWx1ZSAhPT0gJzAnICYmIHZhbHVlICE9PSAnZmFsc2UnO1xuICB9KTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVGVtcGxhdGU7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIGV4dGVuZCA9IHJlcXVpcmUoJy4vdXRpbC9leHRlbmQnKTtcblxuXG4vKipcbiAqICMjIFRlbXBsYXRlXG4gKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gKiBJbnN0YW5jZXMgbWF5IHRoZW4gYmUgY3JlYXRlZCBhbmQgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICogQHBhcmFtIHtTdHJpbmd8Tm9kZUxpc3R8SFRNTENvbGxlY3Rpb258SFRNTFRlbXBsYXRlRWxlbWVudHxIVE1MU2NyaXB0RWxlbWVudHxOb2RlfSBodG1sIEEgVGVtcGxhdGUgY2FuIGJlIGNyZWF0ZWRcbiAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gKiBjbG9uZS4gTm9kZXMgYW5kIGVsZW1lbnRzIHBhc3NlZCBpbiB3aWxsIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLlxuICovXG5mdW5jdGlvbiBUZW1wbGF0ZSgpIHtcbiAgdGhpcy5wb29sID0gW107XG59XG5cblxuVGVtcGxhdGUucHJvdG90eXBlID0ge1xuXG4gIC8qKlxuICAgKiBDcmVhdGVzIGEgbmV3IHZpZXcgY2xvbmVkIGZyb20gdGhpcyB0ZW1wbGF0ZS5cbiAgICovXG4gIGNyZWF0ZVZpZXc6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLnBvb2wubGVuZ3RoKSB7XG4gICAgICByZXR1cm4gdGhpcy5wb29sLnBvcCgpO1xuICAgIH1cblxuICAgIHJldHVybiBleHRlbmQubWFrZShWaWV3LCBkb2N1bWVudC5pbXBvcnROb2RlKHRoaXMsIHRydWUpLCB0aGlzKTtcbiAgfSxcblxuICByZXR1cm5WaWV3OiBmdW5jdGlvbih2aWV3KSB7XG4gICAgaWYgKHRoaXMucG9vbC5pbmRleE9mKHZpZXcpID09PSAtMSkge1xuICAgICAgdGhpcy5wb29sLnB1c2godmlldyk7XG4gICAgfVxuICB9XG59O1xuIiwiLy8gSGVscGVyIG1ldGhvZHMgZm9yIGFuaW1hdGlvblxuZXhwb3J0cy5tYWtlRWxlbWVudEFuaW1hdGFibGUgPSBtYWtlRWxlbWVudEFuaW1hdGFibGU7XG5leHBvcnRzLmdldENvbXB1dGVkQ1NTID0gZ2V0Q29tcHV0ZWRDU1M7XG5leHBvcnRzLmFuaW1hdGVFbGVtZW50ID0gYW5pbWF0ZUVsZW1lbnQ7XG5cbmZ1bmN0aW9uIG1ha2VFbGVtZW50QW5pbWF0YWJsZShlbGVtZW50KSB7XG4gIC8vIEFkZCBwb2x5ZmlsbCBqdXN0IG9uIHRoaXMgZWxlbWVudFxuICBpZiAoIWVsZW1lbnQuYW5pbWF0ZSkge1xuICAgIGVsZW1lbnQuYW5pbWF0ZSA9IGFuaW1hdGVFbGVtZW50O1xuICB9XG5cbiAgLy8gTm90IGEgcG9seWZpbGwgYnV0IGEgaGVscGVyXG4gIGlmICghZWxlbWVudC5nZXRDb21wdXRlZENTUykge1xuICAgIGVsZW1lbnQuZ2V0Q29tcHV0ZWRDU1MgPSBnZXRDb21wdXRlZENTUztcbiAgfVxuXG4gIHJldHVybiBlbGVtZW50O1xufVxuXG4vKipcbiAqIEdldCB0aGUgY29tcHV0ZWQgc3R5bGUgb24gYW4gZWxlbWVudC5cbiAqL1xuZnVuY3Rpb24gZ2V0Q29tcHV0ZWRDU1Moc3R5bGVOYW1lKSB7XG4gIGlmICh0aGlzLm93bmVyRG9jdW1lbnQuZGVmYXVsdFZpZXcub3BlbmVyKSB7XG4gICAgcmV0dXJuIHRoaXMub3duZXJEb2N1bWVudC5kZWZhdWx0Vmlldy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpW3N0eWxlTmFtZV07XG4gIH1cbiAgcmV0dXJuIHdpbmRvdy5nZXRDb21wdXRlZFN0eWxlKHRoaXMpW3N0eWxlTmFtZV07XG59XG5cbi8qKlxuICogVmVyeSBiYXNpYyBwb2x5ZmlsbCBmb3IgRWxlbWVudC5hbmltYXRlIGlmIGl0IGRvZXNuJ3QgZXhpc3QuIElmIGl0IGRvZXMsIHVzZSB0aGUgbmF0aXZlLlxuICogVGhpcyBvbmx5IHN1cHBvcnRzIHR3byBjc3Mgc3RhdGVzLiBJdCB3aWxsIG92ZXJ3cml0ZSBleGlzdGluZyBzdHlsZXMuIEl0IGRvZXNuJ3QgcmV0dXJuIGFuIGFuaW1hdGlvbiBwbGF5IGNvbnRyb2wuIEl0XG4gKiBvbmx5IHN1cHBvcnRzIGR1cmF0aW9uLCBkZWxheSwgYW5kIGVhc2luZy4gUmV0dXJucyBhbiBvYmplY3Qgd2l0aCBhIHByb3BlcnR5IG9uZmluaXNoLlxuICovXG5mdW5jdGlvbiBhbmltYXRlRWxlbWVudChjc3MsIG9wdGlvbnMpIHtcbiAgaWYgKCFBcnJheS5pc0FycmF5KGNzcykgfHwgY3NzLmxlbmd0aCAhPT0gMikge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2FuaW1hdGUgcG9seWZpbGwgcmVxdWlyZXMgYW4gYXJyYXkgZm9yIGNzcyB3aXRoIGFuIGluaXRpYWwgYW5kIGZpbmFsIHN0YXRlJyk7XG4gIH1cblxuICBpZiAoIW9wdGlvbnMgfHwgIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ2R1cmF0aW9uJykpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdhbmltYXRlIHBvbHlmaWxsIHJlcXVpcmVzIG9wdGlvbnMgd2l0aCBhIGR1cmF0aW9uJyk7XG4gIH1cblxuICB2YXIgZWxlbWVudCA9IHRoaXM7XG4gIHZhciBkdXJhdGlvbiA9IG9wdGlvbnMuZHVyYXRpb24gfHwgMDtcbiAgdmFyIGRlbGF5ID0gb3B0aW9ucy5kZWxheSB8fCAwO1xuICB2YXIgZWFzaW5nID0gb3B0aW9ucy5lYXNpbmc7XG4gIHZhciBpbml0aWFsQ3NzID0gY3NzWzBdO1xuICB2YXIgZmluYWxDc3MgPSBjc3NbMV07XG4gIHZhciBhbGxDc3MgPSB7fTtcbiAgdmFyIHBsYXliYWNrID0geyBvbmZpbmlzaDogbnVsbCB9O1xuXG4gIE9iamVjdC5rZXlzKGluaXRpYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGluaXRpYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgLy8gdHJpZ2dlciByZWZsb3dcbiAgZWxlbWVudC5vZmZzZXRXaWR0aDtcblxuICB2YXIgdHJhbnNpdGlvbk9wdGlvbnMgPSAnICcgKyBkdXJhdGlvbiArICdtcyc7XG4gIGlmIChlYXNpbmcpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBlYXNpbmc7XG4gIH1cbiAgaWYgKGRlbGF5KSB7XG4gICAgdHJhbnNpdGlvbk9wdGlvbnMgKz0gJyAnICsgZGVsYXkgKyAnbXMnO1xuICB9XG5cbiAgZWxlbWVudC5zdHlsZS50cmFuc2l0aW9uID0gT2JqZWN0LmtleXMoZmluYWxDc3MpLm1hcChmdW5jdGlvbihrZXkpIHtcbiAgICByZXR1cm4ga2V5ICsgdHJhbnNpdGlvbk9wdGlvbnM7XG4gIH0pLmpvaW4oJywgJyk7XG5cbiAgT2JqZWN0LmtleXMoZmluYWxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgYWxsQ3NzW2tleV0gPSB0cnVlO1xuICAgIGVsZW1lbnQuc3R5bGVba2V5XSA9IGZpbmFsQ3NzW2tleV07XG4gIH0pO1xuXG4gIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgT2JqZWN0LmtleXMoYWxsQ3NzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgZWxlbWVudC5zdHlsZVtrZXldID0gJyc7XG4gICAgfSk7XG5cbiAgICBpZiAocGxheWJhY2sub25maW5pc2gpIHtcbiAgICAgIHBsYXliYWNrLm9uZmluaXNoKCk7XG4gICAgfVxuICB9LCBkdXJhdGlvbiArIGRlbGF5KTtcblxuICByZXR1cm4gcGxheWJhY2s7XG59XG4iLCJ2YXIgZ2xvYmFsID0gKGZ1bmN0aW9uKCkgeyByZXR1cm4gdGhpczsgfSkoKTtcbnZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbm1vZHVsZS5leHBvcnRzID0gZXh0ZW5kO1xuZXh0ZW5kLm1ha2UgPSBtYWtlO1xuXG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBwcm90b3R5cGUgZm9yIHRoZSBnaXZlbiBjb250cnVjdG9yIGFuZCBzZXRzIGFuIGBleHRlbmRgIG1ldGhvZCBvbiBpdC4gSWYgYGV4dGVuZGAgaXMgY2FsbGVkIGZyb20gYVxuICogaXQgd2lsbCBleHRlbmQgdGhhdCBjbGFzcy5cbiAqL1xuZnVuY3Rpb24gZXh0ZW5kKGNvbnN0cnVjdG9yLCBwcm90b3R5cGUpIHtcbiAgdmFyIHN1cGVyQ2xhc3MgPSB0aGlzID09PSBnbG9iYWwgPyBPYmplY3QgOiB0aGlzO1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nICYmICFwcm90b3R5cGUpIHtcbiAgICBwcm90b3R5cGUgPSBjb25zdHJ1Y3RvcjtcbiAgICBjb25zdHJ1Y3RvciA9IGZ1bmN0aW9uKCkge1xuICAgICAgc3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH1cbiAgY29uc3RydWN0b3IuZXh0ZW5kID0gZXh0ZW5kO1xuICB2YXIgZGVzY3JpcHRvcnMgPSBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKTtcbiAgY29uc3RydWN0b3IucHJvdG90eXBlID0gT2JqZWN0LmNyZWF0ZShzdXBlckNsYXNzLnByb3RvdHlwZSwgZGVzY3JpcHRvcnMpO1xuICByZXR1cm4gY29uc3RydWN0b3I7XG59XG5cblxuLyoqXG4gKiBNYWtlcyBhIG5hdGl2ZSBvYmplY3QgcHJldGVuZCB0byBiZSBhIGNsYXNzIChlLmcuIGFkZHMgbWV0aG9kcyB0byBhIERvY3VtZW50RnJhZ21lbnQgYW5kIGNhbGxzIHRoZSBjb25zdHJ1Y3RvcikuXG4gKi9cbmZ1bmN0aW9uIG1ha2UoY29uc3RydWN0b3IsIG9iamVjdCkge1xuICBpZiAodHlwZW9mIGNvbnN0cnVjdG9yICE9PSAnZnVuY3Rpb24nIHx8IHR5cGVvZiBvYmplY3QgIT09ICdvYmplY3QnKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbWFrZSBtdXN0IGFjY2VwdCBhIGZ1bmN0aW9uIGNvbnN0cnVjdG9yIGFuZCBhbiBvYmplY3QnKTtcbiAgfVxuICB2YXIgYXJncyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKTtcbiAgdmFyIHByb3RvID0gY29uc3RydWN0b3IucHJvdG90eXBlO1xuICBmb3IgKHZhciBrZXkgaW4gcHJvdG8pIHtcbiAgICBvYmplY3Rba2V5XSA9IHByb3RvW2tleV07XG4gIH1cbiAgY29uc3RydWN0b3IuYXBwbHkob2JqZWN0LCBhcmdzKTtcbiAgcmV0dXJuIG9iamVjdDtcbn1cblxuXG5mdW5jdGlvbiBnZXRQcm90b3R5cGVEZXNjcmlwdG9ycyhjb25zdHJ1Y3RvciwgcHJvdG90eXBlKSB7XG4gIHZhciBkZXNjcmlwdG9ycyA9IHtcbiAgICBjb25zdHJ1Y3RvcjogeyB3cml0YWJsZTogdHJ1ZSwgY29uZmlndXJhYmxlOiB0cnVlLCB2YWx1ZTogY29uc3RydWN0b3IgfVxuICB9O1xuXG4gIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHByb3RvdHlwZSkuZm9yRWFjaChmdW5jdGlvbihuYW1lKSB7XG4gICAgdmFyIGRlc2NyaXB0b3IgPSBPYmplY3QuZ2V0T3duUHJvcGVydHlEZXNjcmlwdG9yKHByb3RvdHlwZSwgbmFtZSk7XG4gICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZmFsc2U7XG4gICAgZGVzY3JpcHRvcnNbbmFtZV0gPSBkZXNjcmlwdG9yO1xuICB9KTtcbiAgcmV0dXJuIGRlc2NyaXB0b3JzO1xufVxuIiwiXG5cblxuLy8gUG9seWZpbGwgbWF0Y2hlc1xuaWYgKCFFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzKSB7XG4gIEVsZW1lbnQucHJvdG90eXBlLm1hdGNoZXMgPVxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLndlYmtpdE1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1vek1hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm1zTWF0Y2hlc1NlbGVjdG9yIHx8XG4gICAgRWxlbWVudC5wcm90b3R5cGUub01hdGNoZXNTZWxlY3Rvcjtcbn1cblxuLy8gUG9seWZpbGwgY2xvc2VzdFxuaWYgKCFFbGVtZW50LnByb3RvdHlwZS5jbG9zZXN0KSB7XG4gIEVsZW1lbnQucHJvdG90eXBlLmNsb3Nlc3QgPSBmdW5jdGlvbiBjbG9zZXN0KHNlbGVjdG9yKSB7XG4gICAgdmFyIGVsZW1lbnQgPSB0aGlzO1xuICAgIGRvIHtcbiAgICAgIGlmIChlbGVtZW50Lm1hdGNoZXMoc2VsZWN0b3IpKSB7XG4gICAgICAgIHJldHVybiBlbGVtZW50O1xuICAgICAgfVxuICAgIH0gd2hpbGUgKChlbGVtZW50ID0gZWxlbWVudC5wYXJlbnROb2RlKSAmJiBlbGVtZW50Lm5vZGVUeXBlID09PSBOb2RlLkVMRU1FTlRfTk9ERSk7XG4gICAgcmV0dXJuIG51bGw7XG4gIH07XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHRvRnJhZ21lbnQ7XG5cbi8vIENvbnZlcnQgc3R1ZmYgaW50byBkb2N1bWVudCBmcmFnbWVudHMuIFN0dWZmIGNhbiBiZTpcbi8vICogQSBzdHJpbmcgb2YgSFRNTCB0ZXh0XG4vLyAqIEFuIGVsZW1lbnQgb3IgdGV4dCBub2RlXG4vLyAqIEEgTm9kZUxpc3Qgb3IgSFRNTENvbGxlY3Rpb24gKGUuZy4gYGVsZW1lbnQuY2hpbGROb2Rlc2Agb3IgYGVsZW1lbnQuY2hpbGRyZW5gKVxuLy8gKiBBIGpRdWVyeSBvYmplY3Rcbi8vICogQSBzY3JpcHQgZWxlbWVudCB3aXRoIGEgYHR5cGVgIGF0dHJpYnV0ZSBvZiBgXCJ0ZXh0LypcImAgKGUuZy4gYDxzY3JpcHQgdHlwZT1cInRleHQvaHRtbFwiPk15IHRlbXBsYXRlIGNvZGUhPC9zY3JpcHQ+YClcbi8vICogQSB0ZW1wbGF0ZSBlbGVtZW50IChlLmcuIGA8dGVtcGxhdGU+TXkgdGVtcGxhdGUgY29kZSE8L3RlbXBsYXRlPmApXG5mdW5jdGlvbiB0b0ZyYWdtZW50KGh0bWwpIHtcbiAgaWYgKGh0bWwgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIGh0bWw7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGh0bWwgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoaHRtbCBpbnN0YW5jZW9mIE5vZGUpIHtcbiAgICByZXR1cm4gbm9kZVRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSBpZiAoJ2xlbmd0aCcgaW4gaHRtbCkge1xuICAgIHJldHVybiBsaXN0VG9GcmFnbWVudChodG1sKTtcbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbnN1cHBvcnRlZCBUZW1wbGF0ZSBUeXBlOiBDYW5ub3QgY29udmVydCBgJyArIGh0bWwgKyAnYCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuJyk7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTCBub2RlIGludG8gYSBkb2N1bWVudCBmcmFnbWVudC4gSWYgaXQgaXMgYSA8dGVtcGxhdGU+IG5vZGUgaXRzIGNvbnRlbnRzIHdpbGwgYmUgdXNlZC4gSWYgaXQgaXMgYVxuLy8gPHNjcmlwdD4gbm9kZSBpdHMgc3RyaW5nLWJhc2VkIGNvbnRlbnRzIHdpbGwgYmUgY29udmVydGVkIHRvIEhUTUwgZmlyc3QsIHRoZW4gdXNlZC4gT3RoZXJ3aXNlIGEgY2xvbmUgb2YgdGhlIG5vZGVcbi8vIGl0c2VsZiB3aWxsIGJlIHVzZWQuXG5mdW5jdGlvbiBub2RlVG9GcmFnbWVudChub2RlKSB7XG4gIGlmIChub2RlLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gICAgcmV0dXJuIG5vZGUuY29udGVudDtcbiAgfSBlbHNlIGlmIChub2RlLnRhZ05hbWUgPT09ICdTQ1JJUFQnKSB7XG4gICAgcmV0dXJuIHN0cmluZ1RvRnJhZ21lbnQobm9kZS5pbm5lckhUTUwpO1xuICB9IGVsc2Uge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBpZiAobm9kZS50YWdOYW1lID09PSAnVEVNUExBVEUnKSB7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbCA9IG5vZGUuY2hpbGROb2Rlcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZS5jaGlsZE5vZGVzW2ldKTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQobm9kZSk7XG4gICAgfVxuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxufVxuXG4vLyBDb252ZXJ0cyBhbiBIVE1MQ29sbGVjdGlvbiwgTm9kZUxpc3QsIGpRdWVyeSBvYmplY3QsIG9yIGFycmF5IGludG8gYSBkb2N1bWVudCBmcmFnbWVudC5cbmZ1bmN0aW9uIGxpc3RUb0ZyYWdtZW50KGxpc3QpIHtcbiAgdmFyIGZyYWdtZW50ID0gZG9jdW1lbnQuY3JlYXRlRG9jdW1lbnRGcmFnbWVudCgpO1xuICBmb3IgKHZhciBpID0gMCwgbCA9IGxpc3QubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgLy8gVXNlIHRvRnJhZ21lbnQgc2luY2UgdGhpcyBtYXkgYmUgYW4gYXJyYXkgb2YgdGV4dCwgYSBqUXVlcnkgb2JqZWN0IG9mIGA8dGVtcGxhdGU+YHMsIGV0Yy5cbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZCh0b0ZyYWdtZW50KGxpc3RbaV0pKTtcbiAgICBpZiAobCA9PT0gbGlzdC5sZW5ndGggKyAxKSB7XG4gICAgICAvLyBhZGp1c3QgZm9yIE5vZGVMaXN0cyB3aGljaCBhcmUgbGl2ZSwgdGhleSBzaHJpbmsgYXMgd2UgcHVsbCBub2RlcyBvdXQgb2YgdGhlIERPTVxuICAgICAgaS0tO1xuICAgICAgbC0tO1xuICAgIH1cbiAgfVxuICByZXR1cm4gZnJhZ21lbnQ7XG59XG5cbi8vIENvbnZlcnRzIGEgc3RyaW5nIG9mIEhUTUwgdGV4dCBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG52YXIgc3RyaW5nVG9GcmFnbWVudCA9IGZ1bmN0aW9uKHN0cmluZykge1xuICBpZiAoIXN0cmluZykge1xuICAgIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSgnJykpO1xuICAgIHJldHVybiBmcmFnbWVudDtcbiAgfVxuICB2YXIgdGVtcGxhdGVFbGVtZW50O1xuICB0ZW1wbGF0ZUVsZW1lbnQgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpO1xuICB0ZW1wbGF0ZUVsZW1lbnQuaW5uZXJIVE1MID0gc3RyaW5nO1xuICByZXR1cm4gdGVtcGxhdGVFbGVtZW50LmNvbnRlbnQ7XG59O1xuXG4vLyBJZiBIVE1MIFRlbXBsYXRlcyBhcmUgbm90IGF2YWlsYWJsZSAoZS5nLiBpbiBJRSkgdGhlbiB1c2UgYW4gb2xkZXIgbWV0aG9kIHRvIHdvcmsgd2l0aCBjZXJ0YWluIGVsZW1lbnRzLlxuaWYgKCFkb2N1bWVudC5jcmVhdGVFbGVtZW50KCd0ZW1wbGF0ZScpLmNvbnRlbnQgaW5zdGFuY2VvZiBEb2N1bWVudEZyYWdtZW50KSB7XG4gIHN0cmluZ1RvRnJhZ21lbnQgPSAoZnVuY3Rpb24oKSB7XG4gICAgdmFyIHRhZ0V4cCA9IC88KFtcXHc6LV0rKS87XG5cbiAgICAvLyBDb3BpZWQgZnJvbSBqUXVlcnkgKGh0dHBzOi8vZ2l0aHViLmNvbS9qcXVlcnkvanF1ZXJ5L2Jsb2IvbWFzdGVyL0xJQ0VOU0UudHh0KVxuICAgIHZhciB3cmFwTWFwID0ge1xuICAgICAgb3B0aW9uOiBbIDEsICc8c2VsZWN0IG11bHRpcGxlPVwibXVsdGlwbGVcIj4nLCAnPC9zZWxlY3Q+JyBdLFxuICAgICAgbGVnZW5kOiBbIDEsICc8ZmllbGRzZXQ+JywgJzwvZmllbGRzZXQ+JyBdLFxuICAgICAgdGhlYWQ6IFsgMSwgJzx0YWJsZT4nLCAnPC90YWJsZT4nIF0sXG4gICAgICB0cjogWyAyLCAnPHRhYmxlPjx0Ym9keT4nLCAnPC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIHRkOiBbIDMsICc8dGFibGU+PHRib2R5Pjx0cj4nLCAnPC90cj48L3Rib2R5PjwvdGFibGU+JyBdLFxuICAgICAgY29sOiBbIDIsICc8dGFibGU+PHRib2R5PjwvdGJvZHk+PGNvbGdyb3VwPicsICc8L2NvbGdyb3VwPjwvdGFibGU+JyBdLFxuICAgICAgYXJlYTogWyAxLCAnPG1hcD4nLCAnPC9tYXA+JyBdLFxuICAgICAgX2RlZmF1bHQ6IFsgMCwgJycsICcnIF1cbiAgICB9O1xuICAgIHdyYXBNYXAub3B0Z3JvdXAgPSB3cmFwTWFwLm9wdGlvbjtcbiAgICB3cmFwTWFwLnRib2R5ID0gd3JhcE1hcC50Zm9vdCA9IHdyYXBNYXAuY29sZ3JvdXAgPSB3cmFwTWFwLmNhcHRpb24gPSB3cmFwTWFwLnRoZWFkO1xuICAgIHdyYXBNYXAudGggPSB3cmFwTWFwLnRkO1xuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIHN0cmluZ1RvRnJhZ21lbnQoc3RyaW5nKSB7XG4gICAgICB2YXIgZnJhZ21lbnQ7XG4gICAgICBpZiAoIXN0cmluZykge1xuICAgICAgICBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpKTtcbiAgICAgICAgcmV0dXJuIGZyYWdtZW50O1xuICAgICAgfVxuICAgICAgdmFyIHRhZyA9IHN0cmluZy5tYXRjaCh0YWdFeHApO1xuICAgICAgdmFyIHBhcnRzID0gd3JhcE1hcFt0YWddIHx8IHdyYXBNYXAuX2RlZmF1bHQ7XG4gICAgICB2YXIgZGVwdGggPSBwYXJ0c1swXTtcbiAgICAgIHZhciBwcmVmaXggPSBwYXJ0c1sxXTtcbiAgICAgIHZhciBwb3N0Zml4ID0gcGFydHNbMl07XG4gICAgICB2YXIgZGl2ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnZGl2Jyk7XG4gICAgICBkaXYuaW5uZXJIVE1MID0gcHJlZml4ICsgc3RyaW5nICsgcG9zdGZpeDtcbiAgICAgIHdoaWxlIChkZXB0aC0tKSB7XG4gICAgICAgIGRpdiA9IGRpdi5sYXN0Q2hpbGQ7XG4gICAgICB9XG4gICAgICBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlIChkaXYuZmlyc3RDaGlsZCkge1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChkaXYuZmlyc3RDaGlsZCk7XG4gICAgICB9XG4gICAgICByZXR1cm4gZnJhZ21lbnQ7XG4gICAgfTtcbiAgfSkoKTtcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gVmlldztcblxuXG4vKipcbiAqICMjIFZpZXdcbiAqIEEgRG9jdW1lbnRGcmFnbWVudCB3aXRoIGJpbmRpbmdzLlxuICovXG5mdW5jdGlvbiBWaWV3KHRlbXBsYXRlKSB7XG4gIHRoaXMudGVtcGxhdGUgPSB0ZW1wbGF0ZTtcbiAgdGhpcy5iaW5kaW5ncyA9IHRoaXMudGVtcGxhdGUuYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICByZXR1cm4gYmluZGluZy5jbG9uZUZvclZpZXcodGhpcyk7XG4gIH0sIHRoaXMpO1xuICB0aGlzLmZpcnN0Vmlld05vZGUgPSB0aGlzLmZpcnN0Q2hpbGQ7XG4gIHRoaXMubGFzdFZpZXdOb2RlID0gdGhpcy5sYXN0Q2hpbGQ7XG4gIGlmICh0aGlzLmZpcnN0Vmlld05vZGUpIHtcbiAgICB0aGlzLmZpcnN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gICAgdGhpcy5sYXN0Vmlld05vZGUudmlldyA9IHRoaXM7XG4gIH1cbn1cblxuXG5WaWV3LnByb3RvdHlwZSA9IHtcblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgZnJvbSB0aGUgRE9NLiBBIHZpZXcgaXMgYSBEb2N1bWVudEZyYWdtZW50LCBzbyBgcmVtb3ZlKClgIHJldHVybnMgYWxsIGl0cyBub2RlcyB0byBpdHNlbGYuXG4gICAqL1xuICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub2RlID0gdGhpcy5maXJzdFZpZXdOb2RlO1xuICAgIHZhciBuZXh0O1xuXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gdGhpcykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCB0aGUgbm9kZXMgYW5kIHB1dCB0aGVtIGJhY2sgaW50byB0aGlzIGZyYWdtZW50XG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBuZXh0ID0gKG5vZGUgPT09IHRoaXMubGFzdFZpZXdOb2RlKSA/IG51bGwgOiBub2RlLm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgdmlldyAoaWYgbm90IGFscmVhZHkgcmVtb3ZlZCkgYW5kIGFkZHMgdGhlIHZpZXcgdG8gaXRzIHRlbXBsYXRlJ3MgcG9vbC5cbiAgICovXG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgdmlldyBpcyByZW1vdmVkIGZyb20gdGhlIERPTVxuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmRpc3Bvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucmV0dXJuVmlldyh0aGlzKTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogQmluZHMgYSB2aWV3IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICovXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5iaW5kKGNvbnRleHQpO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVuYmluZHMgYSB2aWV3IGZyb20gYW55IGNvbnRleHQuXG4gICAqL1xuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLnVuYmluZCgpO1xuICAgIH0pO1xuICB9XG59O1xuIl19
