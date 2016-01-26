(function(f){if(typeof exports==="object"&&typeof module!=="undefined"){module.exports=f()}else if(typeof define==="function"&&define.amd){define([],f)}else{var g;if(typeof window!=="undefined"){g=window}else if(typeof global!=="undefined"){g=global}else if(typeof self!=="undefined"){g=self}else{g=this}g.fragments = f()}})(function(){var define,module,exports;return (function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
var slice = Array.prototype.slice;

/**
 * Simplifies extending classes and provides static inheritance. Classes that need to be extendable should
 * extend Class which will give them the `extend` static function for their subclasses to use. In addition to
 * a prototype, mixins may be added as well. Example:
 *
 * function MyClass(arg1, arg2) {
 *   SuperClass.call(this, arg1);
 *   this.arg2 = arg2;
 * }
 * SuperClass.extend(MyClass, mixin1, AnotherClass, {
 *   foo: function() {
 *     this._bar++;
 *   },
 *   get bar() {
 *     return this._bar;
 *   }
 * });
 *
 * In addition to extending the superclass, static methods and properties will be copied onto the subclass for
 * static inheritance. This allows the extend function to be copied to the subclass so that it may be
 * subclassed as well. Additionally, static properties may be added by defining them on a special prototype
 * property `static` making the code more readable.
 *
 * @param {function} The subclass constructor.
 * @param {object} [optional] Zero or more mixins. They can be objects or classes (functions).
 * @param {object} The prototype of the subclass.
 */
function Class() {}
Class.extend = extend;
Class.makeInstanceOf = makeInstanceOf;
module.exports = Class;

function extend(Subclass /* [, prototype [,prototype]] */) {
  var prototypes, SuperClass = this;

  // Support no constructor
  if (typeof Subclass !== 'function') {
    prototypes = slice.call(arguments);
    Subclass = function() {
      SuperClass.apply(this, arguments);
    };
  } else {
    prototypes = slice.call(arguments, 1);
  }

  extendStatics(this, Subclass);

  prototypes.forEach(function(proto) {
    if (typeof proto === 'function') {
      extendStatics(proto, Subclass);
    } else if (proto.hasOwnProperty('static')) {
      extendStatics(proto.static, Subclass);
    }
  });

  var descriptors = getDescriptors(prototypes);
  descriptors.constructor = { writable: true, configurable: true, value: Subclass };
  Subclass.prototype = Object.create(this.prototype, descriptors);
  if (typeof SuperClass.onExtend === 'function') {
    // Allow for customizing the definitions of your child classes
    SuperClass.onExtend(Subclass, prototypes);
  }
  return Subclass;
}

// Get descriptors (allows for getters and setters) and sets functions to be non-enumerable
function getDescriptors(objects) {
  var descriptors = {};

  objects.forEach(function(object) {
    if (typeof object === 'function') object = object.prototype;

    Object.getOwnPropertyNames(object).forEach(function(name) {
      if (name === 'static') return;

      var descriptor = Object.getOwnPropertyDescriptor(object, name);

      if (typeof descriptor.value === 'function') {
        descriptor.enumerable = false;
      }

      descriptors[name] = descriptor;
    });
  });
  return descriptors;
}

// Copies static methods over for static inheritance
function extendStatics(Class, Subclass) {

  // static method inheritance (including `extend`)
  Object.keys(Class).forEach(function(key) {
    var descriptor = Object.getOwnPropertyDescriptor(Class, key);
    if (!descriptor.configurable) return;

    Object.defineProperty(Subclass, key, descriptor);
  });
}


/**
 * Makes a native object pretend to be an instance of class (e.g. adds methods to a DocumentFragment then calls the
 * constructor).
 */
function makeInstanceOf(object) {
  var args = slice.call(arguments, 1);
  Object.defineProperties(object, getDescriptors([this.prototype]));
  this.apply(object, args);
  return object;
}

},{}],2:[function(require,module,exports){
module.exports = require('./src/diff');

},{"./src/diff":3}],3:[function(require,module,exports){
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
  function Splice(object, index, removed, addedCount) {
    ChangeRecord.call(this, object, 'splice', String(index));
    this.index = index;
    this.removed = removed;
    this.addedCount = addedCount;
  }

  Splice.prototype = Object.create(ChangeRecord.prototype);


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
  function diffObjects(value, oldValue) {
    if ( !(value && oldValue && typeof value === 'object' && typeof oldValue === 'object')) {
      throw new TypeError('Both values for diff.object must be objects');
    }
    var changeRecords = [];
    var prop, propOldValue, propValue;

    // Goes through the old object (should be a clone) and look for things that are now gone or changed
    for (prop in oldValue) {
      propOldValue = oldValue[prop];
      propValue = value[prop];

      // Allow for the case of obj.prop = undefined (which is a new property, even if it is undefined)
      if (propValue !== undefined && !diffBasic(propValue, propOldValue)) {
        continue;
      }

      // If the property is gone it was removed
      if (! (prop in value)) {
        changeRecords.push(new ChangeRecord(value, 'delete', prop, propOldValue));
      } else if (diffBasic(propValue, propOldValue)) {
        changeRecords.push(new ChangeRecord(value, 'update', prop, propOldValue));
      }
    }

    // Goes through the old object and looks for things that are new
    for (prop in value) {
      propValue = value[prop];
      if (! (prop in oldValue)) {
        changeRecords.push(new ChangeRecord(value, 'add', prop));
      }
    }

    if (Array.isArray(value) && value.length !== oldValue.length) {
      changeRecords.push(new ChangeRecord(value, 'update', 'length', oldValue.length));
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
    if (!Array.isArray(value) || !Array.isArray(oldValue)) {
      throw new TypeError('Both values for diff.array must be arrays');
    }

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
      return [ new Splice(value, currentStart, oldValue.slice(oldStart, oldEnd), 0) ];
    }

    // if nothing was removed, only added to one spot
    if (oldStart === oldEnd) {
      return [ new Splice(value, currentStart, [], currentEnd - currentStart) ];
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
          splice = new Splice(value, index, [], 0);
        }

        splice.addedCount++;
        index++;

        splice.removed.push(oldValue[oldIndex]);
        oldIndex++;
      } else if (op === EDIT_ADD) {
        if (!splice) {
          splice = new Splice(value, index, [], 0);
        }

        splice.addedCount++;
        index++;
      } else if (op === EDIT_DELETE) {
        if (!splice) {
          splice = new Splice(value, index, [], 0);
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

},{}],4:[function(require,module,exports){
module.exports = require('./src/expressions');

},{"./src/expressions":5}],5:[function(require,module,exports){
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

},{"./formatters":6,"./property-chains":7,"./strings":8}],6:[function(require,module,exports){

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

},{}],7:[function(require,module,exports){
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
var propertyRegex = /((\{|,|\.)?\s*)([a-z$_\$](?:[a-z_\$0-9\.-]|\[['"\d]+\])*)(\s*(:|\(|\[)?)/gi;
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

},{}],8:[function(require,module,exports){
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

},{}],9:[function(require,module,exports){
var Fragments = require('./src/fragments');
var Observations = require('observations-js');

function create() {
  var observations = Observations.create();
  var fragments = new Fragments(observations);
  fragments.sync = observations.sync.bind(observations);
  fragments.syncNow = observations.syncNow.bind(observations);
  fragments.afterSync = observations.afterSync.bind(observations);
  fragments.onSync = observations.onSync.bind(observations);
  fragments.offSync = observations.offSync.bind(observations);
  return fragments;
}

// Create an instance of fragments with the default observer
module.exports = create();
module.exports.create = create;

},{"./src/fragments":14,"observations-js":20}],10:[function(require,module,exports){
var slice = Array.prototype.slice;

/**
 * Simplifies extending classes and provides static inheritance. Classes that need to be extendable should
 * extend Class which will give them the `extend` static function for their subclasses to use. In addition to
 * a prototype, mixins may be added as well. Example:
 *
 * function MyClass(arg1, arg2) {
 *   SuperClass.call(this, arg1);
 *   this.arg2 = arg2;
 * }
 * SuperClass.extend(MyClass, mixin1, AnotherClass, {
 *   foo: function() {
 *     this._bar++;
 *   },
 *   get bar() {
 *     return this._bar;
 *   }
 * });
 *
 * In addition to extending the superclass, static methods and properties will be copied onto the subclass for
 * static inheritance. This allows the extend function to be copied to the subclass so that it may be
 * subclassed as well. Additionally, static properties may be added by defining them on a special prototype
 * property `static` making the code more readable.
 *
 * @param {function} The subclass constructor.
 * @param {object} [optional] Zero or more mixins. They can be objects or classes (functions).
 * @param {object} The prototype of the subclass.
 */
function Class() {}
Class.extend = extend;
Class.makeInstanceOf = makeInstanceOf;
module.exports = Class;

function extend(Subclass /* [, prototype [,prototype]] */) {
  var prototypes;

  // Support no constructor
  if (typeof Subclass !== 'function') {
    prototypes = slice.call(arguments);
    var SuperClass = this;
    Subclass = function() {
      SuperClass.apply(this, arguments);
    };
  } else {
    prototypes = slice.call(arguments, 1);
  }

  extendStatics(this, Subclass);

  prototypes.forEach(function(proto) {
    if (typeof proto === 'function') {
      extendStatics(proto, Subclass);
    } else if (proto.hasOwnProperty('static')) {
      extendStatics(proto.static, Subclass);
    }
  });

  var descriptors = getDescriptors(prototypes);
  descriptors.constructor = { writable: true, configurable: true, value: Subclass };
  Subclass.prototype = Object.create(this.prototype, descriptors);
  return Subclass;
}

// Get descriptors (allows for getters and setters) and sets functions to be non-enumerable
function getDescriptors(objects) {
  var descriptors = {};

  objects.forEach(function(object) {
    if (typeof object === 'function') object = object.prototype;

    Object.getOwnPropertyNames(object).forEach(function(name) {
      if (name === 'static') return;

      var descriptor = Object.getOwnPropertyDescriptor(object, name);

      if (typeof descriptor.value === 'function') {
        descriptor.enumerable = false;
      }

      descriptors[name] = descriptor;
    });
  });
  return descriptors;
}

// Copies static methods over for static inheritance
function extendStatics(Class, Subclass) {

  // static method inheritance (including `extend`)
  Object.keys(Class).forEach(function(key) {
    var descriptor = Object.getOwnPropertyDescriptor(Class, key);
    if (!descriptor.configurable) return;

    Object.defineProperty(Subclass, key, descriptor);
  });
}


/**
 * Makes a native object pretend to be an instance of class (e.g. adds methods to a DocumentFragment then calls the
 * constructor).
 */
function makeInstanceOf(object) {
  var args = slice.call(arguments, 1);
  Object.defineProperties(object, getDescriptors([this.prototype]));
  this.apply(object, args);
  return object;
}

},{}],11:[function(require,module,exports){
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
    var animateObject, className, classAnimateName, classWillName,
        methodAnimateName, methodWillName, methodDidName, dir, _this = this;

    if (this.animateObject && typeof this.animateObject === 'object') {
      animateObject = this.animateObject;
    } else if (this.animateClassName) {
      className = this.animateClassName;
    } else if (typeof this.animateObject === 'string') {
      className = this.animateObject;
    }

    classAnimateName = 'animate-' + direction;
    classWillName = 'will-animate-' + direction;
    dir = direction === 'in' ? 'In' : 'Out';
    methodAnimateName = 'animate' + dir;
    methodWillName = 'willAnimate' + dir;
    methodDidName = 'didAnimate' + dir;

    if (className) node.classList.add(className);
    node.classList.add(classWillName);

    if (animateObject) {
      animation.makeElementAnimatable(node);
      if (animateObject[methodWillName]) {
        animateObject[methodWillName](node);
      }
    }

    // trigger reflow
    node.offsetWidth = node.offsetWidth;

    node.classList.add(classAnimateName);
    node.classList.remove(classWillName);

    var whenDone = function() {
      if (animateObject && animateObject[methodDidName]) animateObject[methodDidName](node);
      if (callback) callback.call(_this);
      node.classList.remove(classAnimateName);
      if (className) node.classList.remove(className);
    };

    if (animateObject && animateObject[methodAnimateName]) {
      animateObject[methodAnimateName](node, whenDone);
    } else {
      var duration = getDuration.call(this, node, direction);
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
},{"./binding":12,"./util/animation":16}],12:[function(require,module,exports){
module.exports = Binding;
var Class = require('chip-utils/class');

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

Class.extend(Binding, {
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
      this.observer = this.observe(this.expression, this.updated);
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
    return this.observations.createObserver(expression, callback, callbackContext || this);
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

},{"chip-utils/class":10}],13:[function(require,module,exports){
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
        expression: value ? fragments.codifyExpression('attribute', value, Binder !== DefaultBinder) : null,
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

  return bindings.sort(sortBindings);
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


function sortBindings(a, b) {
  return b.priority - a.priority;
}

function sortAttributes(a, b) {
  return sortBindings(b[0].prototype, a[0].prototype);
}

function notEmpty(value) {
  return Boolean(value);
}

},{}],14:[function(require,module,exports){
module.exports = Fragments;
require('./util/polyfills');
var Class = require('chip-utils/class');
var toFragment = require('./util/toFragment');
var animation = require('./util/animation');
var Template = require('./template');
var View = require('./view');
var Binding = require('./binding');
var AnimatedBinding = require('./animatedBinding');
var compile = require('./compile');
var hasWildcardExpr = /(^|[^\\])\*/;
var escapedWildcardExpr = /(^|[^\\])\\\*/;

/**
 * A Fragments object serves as a registry for binders and formatters
 * @param {Observations} observations An instance of Observations for tracking changes to the data
 */
function Fragments(observations) {
  if (!observations) {
    throw new TypeError('Must provide an observations instance to Fragments.');
  }

  this.observations = observations;
  this.globals = observations.globals;
  this.formatters = observations.formatters;
  this.animations = {};
  this.animateAttribute = 'animate';

  this.binders = {
    element: { _wildcards: [] },
    attribute: { _wildcards: [], _expr: /{{\s*(.*?)\s*}}/g, _delimitersOnlyInDefault: false },
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
}

Class.extend(Fragments, {

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
    var template = Template.makeInstanceOf(fragment);
    template.bindings = compile(this, template);
    return template;
  },


  /**
   * Compiles bindings on an element.
   */
  compileElement: function(element) {
    if (!element.bindings) {
      element.bindings = compile(this, element);
      View.makeInstanceOf(element);
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
    if (typeof context === 'string') {
      callbackContext = callback;
      callback = expr;
      expr = context;
      context = null;
    }
    var observer = this.observations.createObserver(expr, callback, callbackContext);
    if (context) {
      observer.bind(context, true);
    }
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
    if (!definition) throw new TypeError('Must provide a definition when registering a binder');
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
    definition.observations = this.observations;
    superClass.extend(Binder, definition);

    var expr;
    if (name instanceof RegExp) {
      expr = name;
    } else if (hasWildcardExpr.test(name)) {
      expr = new RegExp('^' + escapeRegExp(name).replace(escapedWildcardExpr, '$1(.*)') + '$');
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

    if (name === this.animateAttribute) {
      return;
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

    // don't use e.g. the `value` binder if there is no expression in the attribute value (e.g. `value="some text"`)
    if (binder &&
        type === 'attribute' &&
        binder.prototype.onlyWhenBound &&
        !this.binders[type]._delimitersOnlyInDefault &&
        !this.isBound(type, value)) {
      return;
    }

    // Test if the attribute value is bound (e.g. `href="/posts/{{ post.id }}"`)
    if (!binder && value && (type === 'text' || this.isBound(type, value))) {
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
   * default attribute matcher will not apply to the rest of the attributes. TODO support different delimiters for the
   * default attributes vs registered ones (i.e. allow regular attributes to use {{}} when bound ones do not need them)
   */
  setExpressionDelimiters: function(type, pre, post, onlyInDefault) {
    if (type !== 'attribute' && type !== 'text') {
      throw new TypeError('Expression delimiters must be of type "attribute" or "text"');
    }

    this.binders[type]._expr = new RegExp(escapeRegExp(pre) + '(.*?)' + escapeRegExp(post), 'g');
    if (type === 'attribute') {
      this.binders[type]._delimitersOnlyInDefault = !!onlyInDefault;
    }
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
  codifyExpression: function(type, text, notDefault) {
    if (type !== 'attribute' && type !== 'text') {
      throw new TypeError('codifyExpression must use type "attribute" or "text"');
    }

    if (notDefault && this.binders[type]._delimitersOnlyInDefault) {
      return text;
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

});

// Takes a string like "(\*)" or "on-\*" and converts it into a regular expression.
function escapeRegExp(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
}

},{"./animatedBinding":11,"./binding":12,"./compile":13,"./template":15,"./util/animation":16,"./util/polyfills":17,"./util/toFragment":18,"./view":19,"chip-utils/class":10}],15:[function(require,module,exports){
module.exports = Template;
var View = require('./view');
var Class = require('chip-utils/class');


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


Class.extend(Template, {

  /**
   * Creates a new view cloned from this template.
   */
  createView: function() {
    if (this.pool.length) {
      return this.pool.pop();
    }

    return View.makeInstanceOf(document.importNode(this, true), this);
  },

  returnView: function(view) {
    if (this.pool.indexOf(view) === -1) {
      this.pool.push(view);
    }
  }
});

},{"./view":19,"chip-utils/class":10}],16:[function(require,module,exports){
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

},{}],17:[function(require,module,exports){



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

},{}],18:[function(require,module,exports){
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

},{}],19:[function(require,module,exports){
module.exports = View;
var Class = require('chip-utils/class');


/**
 * ## View
 * A DocumentFragment with bindings.
 */
function View(template) {
  if (template) {
    this.template = template;
    this.bindings = this.template.bindings.map(function(binding) {
      return binding.cloneForView(this);
    }, this);
  } else if (this.bindings) {
    this.bindings.forEach(function(binding) {
      binding.init();
    });
  }

  this.firstViewNode = this.firstChild;
  this.lastViewNode = this.lastChild;
  if (this.firstViewNode) {
    this.firstViewNode.view = this;
    this.lastViewNode.view = this;
  }
}


Class.extend(View, {

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
});

},{"chip-utils/class":10}],20:[function(require,module,exports){

exports.Observations = require('./src/observations');
exports.Observer = require('./src/observer');
exports.create = function() {
  return new exports.Observations();
};

},{"./src/observations":21,"./src/observer":22}],21:[function(require,module,exports){
(function (global){
module.exports = Observations;
var Class = require('chip-utils/class');
var Observer = require('./observer');
var requestAnimationFrame = global.requestAnimationFrame || setTimeout;
var cancelAnimationFrame = global.cancelAnimationFrame || clearTimeout;


function Observations() {
  this.globals = {};
  this.formatters = {};
  this.observers = [];
  this.callbacks = [];
  this.listeners = [];
  this.syncing = false;
  this.callbacksRunning = false;
  this.rerun = false;
  this.cycles = 0;
  this.maxCycles = 10;
  this.timeout = null;
  this.pendingSync = null;
  this.syncNow = this.syncNow.bind(this);
}


Class.extend(Observations, {

  // Creates a new observer attached to this observations object. When the observer is bound to a context it will be added
  // to this `observations` and synced when this `observations.sync` is called.
  createObserver: function(expr, callback, callbackContext) {
    return new Observer(this, expr, callback, callbackContext);
  },


  // Schedules an observer sync cycle which checks all the observers to see if they've changed.
  sync: function(callback) {
    if (typeof callback === 'function') {
      this.afterSync(callback);
    }

    if (this.pendingSync) {
      return false;
    }

    this.pendingSync = requestAnimationFrame(this.syncNow);
    return true;
  },


  // Runs the observer sync cycle which checks all the observers to see if they've changed.
  syncNow: function(callback) {
    if (typeof callback === 'function') {
      this.afterSync(callback);
    }

    cancelAnimationFrame(this.pendingSync);
    this.pendingSync = null;

    if (this.syncing) {
      this.rerun = true;
      return false;
    }

    this.runSync();
    return true;
  },


  runSync: function() {
    this.syncing = true;
    this.rerun = true;
    this.cycles = 0;

    var i, l;

    // Allow callbacks to run the sync cycle again immediately, but stop at `maxCyles` (default 10) cycles so we don't
    // run infinite loops
    while (this.rerun) {
      if (++this.cycles === this.maxCycles) {
        throw new Error('Infinite observer syncing, an observer is calling Observer.sync() too many times');
      }
      this.rerun = false;
      // the observer array may increase or decrease in size (remaining observers) during the sync
      for (i = 0; i < this.observers.length; i++) {
        this.observers[i].sync();
      }
    }

    this.callbacksRunning = true;

    var callbacks = this.callbacks;
    this.callbacks = [];
    while (callbacks.length) {
      callbacks.shift()();
    }

    for (i = 0, l = this.listeners.length; i < l; i++) {
      var listener = this.listeners[i];
      listener();
    }

    this.callbacksRunning = false;
    this.syncing = false;
    this.cycles = 0;
  },


  // After the next sync (or the current if in the middle of one), run the provided callback
  afterSync: function(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('callback must be a function');
    }

    if (this.callbacksRunning) {
      this.sync();
    }

    this.callbacks.push(callback);
  },


  onSync: function(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    this.listeners.push(listener);
  },


  offSync: function(listener) {
    if (typeof listener !== 'function') {
      throw new TypeError('listener must be a function');
    }

    var index = this.listeners.indexOf(listener);
    if (index !== -1) {
      this.listeners.splice(index, 1).pop();
    }
  },


  // Adds a new observer to be synced with changes. If `skipUpdate` is true then the callback will only be called when a
  // change is made, not initially.
  add: function(observer, skipUpdate) {
    this.observers.push(observer);
    if (!skipUpdate) {
      observer.forceUpdateNextSync = true;
      observer.sync();
    }
  },


  // Removes an observer, stopping it from being run
  remove: function(observer) {
    var index = this.observers.indexOf(observer);
    if (index !== -1) {
      this.observers.splice(index, 1);
      return true;
    } else {
      return false;
    }
  },
});

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"./observer":22,"chip-utils/class":1}],22:[function(require,module,exports){
module.exports = Observer;
var Class = require('chip-utils/class');
var expressions = require('expressions-js');
var diff = require('differences-js');

// # Observer

// Defines an observer class which represents an expression. Whenever that expression returns a new value the `callback`
// is called with the value.
//
// If the old and new values were either an array or an object, the `callback` also
// receives an array of splices (for an array), or an array of change objects (for an object) which are the same
// format that `Array.observe` and `Object.observe` return
// <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/observe>.
function Observer(observations, expr, callback, callbackContext) {
  if (typeof expr === 'function') {
    this.getter = expr;
    this.setter = expr;
  } else {
    this.getter = expressions.parse(expr, observations.globals, observations.formatters);
  }
  this.observations = observations;
  this.expr = expr;
  this.callback = callback;
  this.callbackContext = callbackContext;
  this.skip = false;
  this.forceUpdateNextSync = false;
  this.context = null;
  this.oldValue = undefined;
}

Class.extend(Observer, {

  // Binds this expression to a given context
  bind: function(context, skipUpdate) {
    this.context = context;
    if (this.callback) {
      this.observations.add(this, skipUpdate);
    }
  },

  // Unbinds this expression
  unbind: function() {
    this.observations.remove(this);
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
          ? expressions.parseSetter(this.expr, this.observations.globals, this.observations.formatters)
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
    this.observations.sync();
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
});

},{"chip-utils/class":1,"differences-js":2,"expressions-js":4}]},{},[9])(9)
});
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIuLi9jaGlwLXV0aWxzL2NsYXNzLmpzIiwiLi4vZGlmZmVyZW5jZXMtanMvaW5kZXguanMiLCIuLi9kaWZmZXJlbmNlcy1qcy9zcmMvZGlmZi5qcyIsIi4uL2V4cHJlc3Npb25zLWpzL2luZGV4LmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL2V4cHJlc3Npb25zLmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL2Zvcm1hdHRlcnMuanMiLCIuLi9leHByZXNzaW9ucy1qcy9zcmMvcHJvcGVydHktY2hhaW5zLmpzIiwiLi4vZXhwcmVzc2lvbnMtanMvc3JjL3N0cmluZ3MuanMiLCJpbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9jaGlwLXV0aWxzL2NsYXNzLmpzIiwic3JjL2FuaW1hdGVkQmluZGluZy5qcyIsInNyYy9iaW5kaW5nLmpzIiwic3JjL2NvbXBpbGUuanMiLCJzcmMvZnJhZ21lbnRzLmpzIiwic3JjL3RlbXBsYXRlLmpzIiwic3JjL3V0aWwvYW5pbWF0aW9uLmpzIiwic3JjL3V0aWwvcG9seWZpbGxzLmpzIiwic3JjL3V0aWwvdG9GcmFnbWVudC5qcyIsInNyYy92aWV3LmpzIiwiLi4vb2JzZXJ2YXRpb25zLWpzL2luZGV4LmpzIiwiLi4vb2JzZXJ2YXRpb25zLWpzL3NyYy9vYnNlcnZhdGlvbnMuanMiLCIuLi9vYnNlcnZhdGlvbnMtanMvc3JjL29ic2VydmVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoSEE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcFpBO0FBQ0E7O0FDREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqR0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdlVBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM1Q0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzdHQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuUEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbEtBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3S0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM5bUJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ05BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNuS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsInZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcblxuLyoqXG4gKiBTaW1wbGlmaWVzIGV4dGVuZGluZyBjbGFzc2VzIGFuZCBwcm92aWRlcyBzdGF0aWMgaW5oZXJpdGFuY2UuIENsYXNzZXMgdGhhdCBuZWVkIHRvIGJlIGV4dGVuZGFibGUgc2hvdWxkXG4gKiBleHRlbmQgQ2xhc3Mgd2hpY2ggd2lsbCBnaXZlIHRoZW0gdGhlIGBleHRlbmRgIHN0YXRpYyBmdW5jdGlvbiBmb3IgdGhlaXIgc3ViY2xhc3NlcyB0byB1c2UuIEluIGFkZGl0aW9uIHRvXG4gKiBhIHByb3RvdHlwZSwgbWl4aW5zIG1heSBiZSBhZGRlZCBhcyB3ZWxsLiBFeGFtcGxlOlxuICpcbiAqIGZ1bmN0aW9uIE15Q2xhc3MoYXJnMSwgYXJnMikge1xuICogICBTdXBlckNsYXNzLmNhbGwodGhpcywgYXJnMSk7XG4gKiAgIHRoaXMuYXJnMiA9IGFyZzI7XG4gKiB9XG4gKiBTdXBlckNsYXNzLmV4dGVuZChNeUNsYXNzLCBtaXhpbjEsIEFub3RoZXJDbGFzcywge1xuICogICBmb286IGZ1bmN0aW9uKCkge1xuICogICAgIHRoaXMuX2JhcisrO1xuICogICB9LFxuICogICBnZXQgYmFyKCkge1xuICogICAgIHJldHVybiB0aGlzLl9iYXI7XG4gKiAgIH1cbiAqIH0pO1xuICpcbiAqIEluIGFkZGl0aW9uIHRvIGV4dGVuZGluZyB0aGUgc3VwZXJjbGFzcywgc3RhdGljIG1ldGhvZHMgYW5kIHByb3BlcnRpZXMgd2lsbCBiZSBjb3BpZWQgb250byB0aGUgc3ViY2xhc3MgZm9yXG4gKiBzdGF0aWMgaW5oZXJpdGFuY2UuIFRoaXMgYWxsb3dzIHRoZSBleHRlbmQgZnVuY3Rpb24gdG8gYmUgY29waWVkIHRvIHRoZSBzdWJjbGFzcyBzbyB0aGF0IGl0IG1heSBiZVxuICogc3ViY2xhc3NlZCBhcyB3ZWxsLiBBZGRpdGlvbmFsbHksIHN0YXRpYyBwcm9wZXJ0aWVzIG1heSBiZSBhZGRlZCBieSBkZWZpbmluZyB0aGVtIG9uIGEgc3BlY2lhbCBwcm90b3R5cGVcbiAqIHByb3BlcnR5IGBzdGF0aWNgIG1ha2luZyB0aGUgY29kZSBtb3JlIHJlYWRhYmxlLlxuICpcbiAqIEBwYXJhbSB7ZnVuY3Rpb259IFRoZSBzdWJjbGFzcyBjb25zdHJ1Y3Rvci5cbiAqIEBwYXJhbSB7b2JqZWN0fSBbb3B0aW9uYWxdIFplcm8gb3IgbW9yZSBtaXhpbnMuIFRoZXkgY2FuIGJlIG9iamVjdHMgb3IgY2xhc3NlcyAoZnVuY3Rpb25zKS5cbiAqIEBwYXJhbSB7b2JqZWN0fSBUaGUgcHJvdG90eXBlIG9mIHRoZSBzdWJjbGFzcy5cbiAqL1xuZnVuY3Rpb24gQ2xhc3MoKSB7fVxuQ2xhc3MuZXh0ZW5kID0gZXh0ZW5kO1xuQ2xhc3MubWFrZUluc3RhbmNlT2YgPSBtYWtlSW5zdGFuY2VPZjtcbm1vZHVsZS5leHBvcnRzID0gQ2xhc3M7XG5cbmZ1bmN0aW9uIGV4dGVuZChTdWJjbGFzcyAvKiBbLCBwcm90b3R5cGUgWyxwcm90b3R5cGVdXSAqLykge1xuICB2YXIgcHJvdG90eXBlcywgU3VwZXJDbGFzcyA9IHRoaXM7XG5cbiAgLy8gU3VwcG9ydCBubyBjb25zdHJ1Y3RvclxuICBpZiAodHlwZW9mIFN1YmNsYXNzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcHJvdG90eXBlcyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICBTdWJjbGFzcyA9IGZ1bmN0aW9uKCkge1xuICAgICAgU3VwZXJDbGFzcy5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH07XG4gIH0gZWxzZSB7XG4gICAgcHJvdG90eXBlcyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzLCAxKTtcbiAgfVxuXG4gIGV4dGVuZFN0YXRpY3ModGhpcywgU3ViY2xhc3MpO1xuXG4gIHByb3RvdHlwZXMuZm9yRWFjaChmdW5jdGlvbihwcm90bykge1xuICAgIGlmICh0eXBlb2YgcHJvdG8gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGV4dGVuZFN0YXRpY3MocHJvdG8sIFN1YmNsYXNzKTtcbiAgICB9IGVsc2UgaWYgKHByb3RvLmhhc093blByb3BlcnR5KCdzdGF0aWMnKSkge1xuICAgICAgZXh0ZW5kU3RhdGljcyhwcm90by5zdGF0aWMsIFN1YmNsYXNzKTtcbiAgICB9XG4gIH0pO1xuXG4gIHZhciBkZXNjcmlwdG9ycyA9IGdldERlc2NyaXB0b3JzKHByb3RvdHlwZXMpO1xuICBkZXNjcmlwdG9ycy5jb25zdHJ1Y3RvciA9IHsgd3JpdGFibGU6IHRydWUsIGNvbmZpZ3VyYWJsZTogdHJ1ZSwgdmFsdWU6IFN1YmNsYXNzIH07XG4gIFN1YmNsYXNzLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUodGhpcy5wcm90b3R5cGUsIGRlc2NyaXB0b3JzKTtcbiAgaWYgKHR5cGVvZiBTdXBlckNsYXNzLm9uRXh0ZW5kID09PSAnZnVuY3Rpb24nKSB7XG4gICAgLy8gQWxsb3cgZm9yIGN1c3RvbWl6aW5nIHRoZSBkZWZpbml0aW9ucyBvZiB5b3VyIGNoaWxkIGNsYXNzZXNcbiAgICBTdXBlckNsYXNzLm9uRXh0ZW5kKFN1YmNsYXNzLCBwcm90b3R5cGVzKTtcbiAgfVxuICByZXR1cm4gU3ViY2xhc3M7XG59XG5cbi8vIEdldCBkZXNjcmlwdG9ycyAoYWxsb3dzIGZvciBnZXR0ZXJzIGFuZCBzZXR0ZXJzKSBhbmQgc2V0cyBmdW5jdGlvbnMgdG8gYmUgbm9uLWVudW1lcmFibGVcbmZ1bmN0aW9uIGdldERlc2NyaXB0b3JzKG9iamVjdHMpIHtcbiAgdmFyIGRlc2NyaXB0b3JzID0ge307XG5cbiAgb2JqZWN0cy5mb3JFYWNoKGZ1bmN0aW9uKG9iamVjdCkge1xuICAgIGlmICh0eXBlb2Ygb2JqZWN0ID09PSAnZnVuY3Rpb24nKSBvYmplY3QgPSBvYmplY3QucHJvdG90eXBlO1xuXG4gICAgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMob2JqZWN0KS5mb3JFYWNoKGZ1bmN0aW9uKG5hbWUpIHtcbiAgICAgIGlmIChuYW1lID09PSAnc3RhdGljJykgcmV0dXJuO1xuXG4gICAgICB2YXIgZGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3Iob2JqZWN0LCBuYW1lKTtcblxuICAgICAgaWYgKHR5cGVvZiBkZXNjcmlwdG9yLnZhbHVlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIGRlc2NyaXB0b3IuZW51bWVyYWJsZSA9IGZhbHNlO1xuICAgICAgfVxuXG4gICAgICBkZXNjcmlwdG9yc1tuYW1lXSA9IGRlc2NyaXB0b3I7XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gZGVzY3JpcHRvcnM7XG59XG5cbi8vIENvcGllcyBzdGF0aWMgbWV0aG9kcyBvdmVyIGZvciBzdGF0aWMgaW5oZXJpdGFuY2VcbmZ1bmN0aW9uIGV4dGVuZFN0YXRpY3MoQ2xhc3MsIFN1YmNsYXNzKSB7XG5cbiAgLy8gc3RhdGljIG1ldGhvZCBpbmhlcml0YW5jZSAoaW5jbHVkaW5nIGBleHRlbmRgKVxuICBPYmplY3Qua2V5cyhDbGFzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICB2YXIgZGVzY3JpcHRvciA9IE9iamVjdC5nZXRPd25Qcm9wZXJ0eURlc2NyaXB0b3IoQ2xhc3MsIGtleSk7XG4gICAgaWYgKCFkZXNjcmlwdG9yLmNvbmZpZ3VyYWJsZSkgcmV0dXJuO1xuXG4gICAgT2JqZWN0LmRlZmluZVByb3BlcnR5KFN1YmNsYXNzLCBrZXksIGRlc2NyaXB0b3IpO1xuICB9KTtcbn1cblxuXG4vKipcbiAqIE1ha2VzIGEgbmF0aXZlIG9iamVjdCBwcmV0ZW5kIHRvIGJlIGFuIGluc3RhbmNlIG9mIGNsYXNzIChlLmcuIGFkZHMgbWV0aG9kcyB0byBhIERvY3VtZW50RnJhZ21lbnQgdGhlbiBjYWxscyB0aGVcbiAqIGNvbnN0cnVjdG9yKS5cbiAqL1xuZnVuY3Rpb24gbWFrZUluc3RhbmNlT2Yob2JqZWN0KSB7XG4gIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICBPYmplY3QuZGVmaW5lUHJvcGVydGllcyhvYmplY3QsIGdldERlc2NyaXB0b3JzKFt0aGlzLnByb3RvdHlwZV0pKTtcbiAgdGhpcy5hcHBseShvYmplY3QsIGFyZ3MpO1xuICByZXR1cm4gb2JqZWN0O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL3NyYy9kaWZmJyk7XG4iLCIvKlxuQ29weXJpZ2h0IChjKSAyMDE1IEphY29iIFdyaWdodCA8amFjd3JpZ2h0QGdtYWlsLmNvbT5cblxuUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGEgY29weVxub2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGUgXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbFxuaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZyB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0c1xudG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLCBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbFxuY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzXG5mdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuXG5UaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZCBpblxuYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG5cblRIRSBTT0ZUV0FSRSBJUyBQUk9WSURFRCBcIkFTIElTXCIsIFdJVEhPVVQgV0FSUkFOVFkgT0YgQU5ZIEtJTkQsIEVYUFJFU1MgT1JcbklNUExJRUQsIElOQ0xVRElORyBCVVQgTk9UIExJTUlURUQgVE8gVEhFIFdBUlJBTlRJRVMgT0YgTUVSQ0hBTlRBQklMSVRZLFxuRklUTkVTUyBGT1IgQSBQQVJUSUNVTEFSIFBVUlBPU0UgQU5EIE5PTklORlJJTkdFTUVOVC4gSU4gTk8gRVZFTlQgU0hBTEwgVEhFXG5BVVRIT1JTIE9SIENPUFlSSUdIVCBIT0xERVJTIEJFIExJQUJMRSBGT1IgQU5ZIENMQUlNLCBEQU1BR0VTIE9SIE9USEVSXG5MSUFCSUxJVFksIFdIRVRIRVIgSU4gQU4gQUNUSU9OIE9GIENPTlRSQUNULCBUT1JUIE9SIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLFxuT1VUIE9GIE9SIElOIENPTk5FQ1RJT04gV0lUSCBUSEUgU09GVFdBUkUgT1IgVEhFIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTlxuVEhFIFNPRlRXQVJFLlxuKi9cbi8vICMgRGlmZlxuLy8gPiBCYXNlZCBvbiB3b3JrIGZyb20gR29vZ2xlJ3Mgb2JzZXJ2ZS1qcyBwb2x5ZmlsbDogaHR0cHM6Ly9naXRodWIuY29tL1BvbHltZXIvb2JzZXJ2ZS1qc1xuXG4vLyBBIG5hbWVzcGFjZSB0byBzdG9yZSB0aGUgZnVuY3Rpb25zIG9uXG52YXIgZGlmZiA9IGV4cG9ydHM7XG5cbihmdW5jdGlvbigpIHtcblxuICBkaWZmLmNsb25lID0gY2xvbmU7XG4gIGRpZmYudmFsdWVzID0gZGlmZlZhbHVlcztcbiAgZGlmZi5iYXNpYyA9IGRpZmZCYXNpYztcbiAgZGlmZi5vYmplY3RzID0gZGlmZk9iamVjdHM7XG4gIGRpZmYuYXJyYXlzID0gZGlmZkFycmF5cztcblxuXG4gIC8vIEEgY2hhbmdlIHJlY29yZCBmb3IgdGhlIG9iamVjdCBjaGFuZ2VzXG4gIGZ1bmN0aW9uIENoYW5nZVJlY29yZChvYmplY3QsIHR5cGUsIG5hbWUsIG9sZFZhbHVlKSB7XG4gICAgdGhpcy5vYmplY3QgPSBvYmplY3Q7XG4gICAgdGhpcy50eXBlID0gdHlwZTtcbiAgICB0aGlzLm5hbWUgPSBuYW1lO1xuICAgIHRoaXMub2xkVmFsdWUgPSBvbGRWYWx1ZTtcbiAgfVxuXG4gIC8vIEEgc3BsaWNlIHJlY29yZCBmb3IgdGhlIGFycmF5IGNoYW5nZXNcbiAgZnVuY3Rpb24gU3BsaWNlKG9iamVjdCwgaW5kZXgsIHJlbW92ZWQsIGFkZGVkQ291bnQpIHtcbiAgICBDaGFuZ2VSZWNvcmQuY2FsbCh0aGlzLCBvYmplY3QsICdzcGxpY2UnLCBTdHJpbmcoaW5kZXgpKTtcbiAgICB0aGlzLmluZGV4ID0gaW5kZXg7XG4gICAgdGhpcy5yZW1vdmVkID0gcmVtb3ZlZDtcbiAgICB0aGlzLmFkZGVkQ291bnQgPSBhZGRlZENvdW50O1xuICB9XG5cbiAgU3BsaWNlLnByb3RvdHlwZSA9IE9iamVjdC5jcmVhdGUoQ2hhbmdlUmVjb3JkLnByb3RvdHlwZSk7XG5cblxuICAvLyBDcmVhdGVzIGEgY2xvbmUgb3IgY29weSBvZiBhbiBhcnJheSBvciBvYmplY3QgKG9yIHNpbXBseSByZXR1cm5zIGEgc3RyaW5nL251bWJlci9ib29sZWFuIHdoaWNoIGFyZSBpbW11dGFibGUpXG4gIC8vIERvZXMgbm90IHByb3ZpZGUgZGVlcCBjb3BpZXMuXG4gIGZ1bmN0aW9uIGNsb25lKHZhbHVlLCBkZWVwKSB7XG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBpZiAoZGVlcCkge1xuICAgICAgICByZXR1cm4gdmFsdWUubWFwKGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgICAgICAgcmV0dXJuIGNsb25lKHZhbHVlLCBkZWVwKTtcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gdmFsdWUuc2xpY2UoKTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKHZhbHVlICYmIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGlmICh2YWx1ZS52YWx1ZU9mKCkgIT09IHZhbHVlKSB7XG4gICAgICAgIHJldHVybiBuZXcgdmFsdWUuY29uc3RydWN0b3IodmFsdWUudmFsdWVPZigpKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjb3B5ID0ge307XG4gICAgICAgIGZvciAodmFyIGtleSBpbiB2YWx1ZSkge1xuICAgICAgICAgIHZhciBvYmpWYWx1ZSA9IHZhbHVlW2tleV07XG4gICAgICAgICAgaWYgKGRlZXApIHtcbiAgICAgICAgICAgIG9ialZhbHVlID0gY2xvbmUob2JqVmFsdWUsIGRlZXApO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb3B5W2tleV0gPSBvYmpWYWx1ZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gY29weTtcbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlO1xuICAgIH1cbiAgfVxuXG5cbiAgLy8gRGlmZnMgdHdvIHZhbHVlcywgcmV0dXJuaW5nIGEgdHJ1dGh5IHZhbHVlIGlmIHRoZXJlIGFyZSBjaGFuZ2VzIG9yIGBmYWxzZWAgaWYgdGhlcmUgYXJlIG5vIGNoYW5nZXMuIElmIHRoZSB0d29cbiAgLy8gdmFsdWVzIGFyZSBib3RoIGFycmF5cyBvciBib3RoIG9iamVjdHMsIGFuIGFycmF5IG9mIGNoYW5nZXMgKHNwbGljZXMgb3IgY2hhbmdlIHJlY29yZHMpIGJldHdlZW4gdGhlIHR3byB3aWxsIGJlXG4gIC8vIHJldHVybmVkLiBPdGhlcndpc2UgIGB0cnVlYCB3aWxsIGJlIHJldHVybmVkLlxuICBmdW5jdGlvbiBkaWZmVmFsdWVzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIC8vIFNob3J0Y3V0IG91dCBmb3IgdmFsdWVzIHRoYXQgYXJlIGV4YWN0bHkgZXF1YWxcbiAgICBpZiAodmFsdWUgPT09IG9sZFZhbHVlKSByZXR1cm4gZmFsc2U7XG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkgJiYgQXJyYXkuaXNBcnJheShvbGRWYWx1ZSkpIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlc1xuICAgICAgdmFyIHNwbGljZXMgPSBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgICByZXR1cm4gc3BsaWNlcy5sZW5ndGggPyBzcGxpY2VzIDogZmFsc2U7XG4gICAgfSBlbHNlIGlmICh2YWx1ZSAmJiBvbGRWYWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZSA9PT0gJ29iamVjdCcpIHtcbiAgICAgIC8vIElmIGFuIG9iamVjdCBoYXMgY2hhbmdlZCBjYWxjdWxhdGUgdGhlIGNobmFnZXMgYW5kIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gdmFsdWVWYWx1ZSAhPT0gb2xkVmFsdWVWYWx1ZTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHZhciBjaGFuZ2VSZWNvcmRzID0gZGlmZk9iamVjdHModmFsdWUsIG9sZFZhbHVlKTtcbiAgICAgICAgcmV0dXJuIGNoYW5nZVJlY29yZHMubGVuZ3RoID8gY2hhbmdlUmVjb3JkcyA6IGZhbHNlO1xuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICAvLyBJZiBhIHZhbHVlIGhhcyBjaGFuZ2VkIGNhbGwgdGhlIGNhbGxiYWNrXG4gICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlLCBvbGRWYWx1ZSk7XG4gICAgfVxuICB9XG5cblxuICAvLyBEaWZmcyB0d28gYmFzaWMgdHlwZXMsIHJldHVybmluZyB0cnVlIGlmIGNoYW5nZWQgb3IgZmFsc2UgaWYgbm90XG4gIGZ1bmN0aW9uIGRpZmZCYXNpYyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICBpZiAodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSB7XG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICB2YXIgdmFsdWVWYWx1ZSA9IHZhbHVlLnZhbHVlT2YoKTtcbiAgICAgIHZhciBvbGRWYWx1ZVZhbHVlID0gb2xkVmFsdWUudmFsdWVPZigpO1xuXG4gICAgICAvLyBBbGxvdyBkYXRlcyBhbmQgTnVtYmVyL1N0cmluZyBvYmplY3RzIHRvIGJlIGNvbXBhcmVkXG4gICAgICBpZiAodHlwZW9mIHZhbHVlVmFsdWUgIT09ICdvYmplY3QnICYmIHR5cGVvZiBvbGRWYWx1ZVZhbHVlICE9PSAnb2JqZWN0Jykge1xuICAgICAgICByZXR1cm4gZGlmZkJhc2ljKHZhbHVlVmFsdWUsIG9sZFZhbHVlVmFsdWUpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIElmIGEgdmFsdWUgaGFzIGNoYW5nZWQgY2FsbCB0aGUgY2FsbGJhY2tcbiAgICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdudW1iZXInICYmIGlzTmFOKHZhbHVlKSAmJiBpc05hTihvbGRWYWx1ZSkpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIHZhbHVlICE9PSBvbGRWYWx1ZTtcbiAgICB9XG4gIH1cblxuXG4gIC8vIERpZmZzIHR3byBvYmplY3RzIHJldHVybmluZyBhbiBhcnJheSBvZiBjaGFuZ2UgcmVjb3Jkcy4gVGhlIGNoYW5nZSByZWNvcmQgbG9va3MgbGlrZTpcbiAgLy8gYGBgamF2YXNjcmlwdFxuICAvLyB7XG4gIC8vICAgb2JqZWN0OiBvYmplY3QsXG4gIC8vICAgdHlwZTogJ2RlbGV0ZWR8dXBkYXRlZHxuZXcnLFxuICAvLyAgIG5hbWU6ICdwcm9wZXJ0eU5hbWUnLFxuICAvLyAgIG9sZFZhbHVlOiBvbGRWYWx1ZVxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmT2JqZWN0cyh2YWx1ZSwgb2xkVmFsdWUpIHtcbiAgICBpZiAoICEodmFsdWUgJiYgb2xkVmFsdWUgJiYgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2xkVmFsdWUgPT09ICdvYmplY3QnKSkge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQm90aCB2YWx1ZXMgZm9yIGRpZmYub2JqZWN0IG11c3QgYmUgb2JqZWN0cycpO1xuICAgIH1cbiAgICB2YXIgY2hhbmdlUmVjb3JkcyA9IFtdO1xuICAgIHZhciBwcm9wLCBwcm9wT2xkVmFsdWUsIHByb3BWYWx1ZTtcblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCAoc2hvdWxkIGJlIGEgY2xvbmUpIGFuZCBsb29rIGZvciB0aGluZ3MgdGhhdCBhcmUgbm93IGdvbmUgb3IgY2hhbmdlZFxuICAgIGZvciAocHJvcCBpbiBvbGRWYWx1ZSkge1xuICAgICAgcHJvcE9sZFZhbHVlID0gb2xkVmFsdWVbcHJvcF07XG4gICAgICBwcm9wVmFsdWUgPSB2YWx1ZVtwcm9wXTtcblxuICAgICAgLy8gQWxsb3cgZm9yIHRoZSBjYXNlIG9mIG9iai5wcm9wID0gdW5kZWZpbmVkICh3aGljaCBpcyBhIG5ldyBwcm9wZXJ0eSwgZXZlbiBpZiBpdCBpcyB1bmRlZmluZWQpXG4gICAgICBpZiAocHJvcFZhbHVlICE9PSB1bmRlZmluZWQgJiYgIWRpZmZCYXNpYyhwcm9wVmFsdWUsIHByb3BPbGRWYWx1ZSkpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIC8vIElmIHRoZSBwcm9wZXJ0eSBpcyBnb25lIGl0IHdhcyByZW1vdmVkXG4gICAgICBpZiAoISAocHJvcCBpbiB2YWx1ZSkpIHtcbiAgICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQodmFsdWUsICdkZWxldGUnLCBwcm9wLCBwcm9wT2xkVmFsdWUpKTtcbiAgICAgIH0gZWxzZSBpZiAoZGlmZkJhc2ljKHByb3BWYWx1ZSwgcHJvcE9sZFZhbHVlKSkge1xuICAgICAgICBjaGFuZ2VSZWNvcmRzLnB1c2gobmV3IENoYW5nZVJlY29yZCh2YWx1ZSwgJ3VwZGF0ZScsIHByb3AsIHByb3BPbGRWYWx1ZSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vIEdvZXMgdGhyb3VnaCB0aGUgb2xkIG9iamVjdCBhbmQgbG9va3MgZm9yIHRoaW5ncyB0aGF0IGFyZSBuZXdcbiAgICBmb3IgKHByb3AgaW4gdmFsdWUpIHtcbiAgICAgIHByb3BWYWx1ZSA9IHZhbHVlW3Byb3BdO1xuICAgICAgaWYgKCEgKHByb3AgaW4gb2xkVmFsdWUpKSB7XG4gICAgICAgIGNoYW5nZVJlY29yZHMucHVzaChuZXcgQ2hhbmdlUmVjb3JkKHZhbHVlLCAnYWRkJywgcHJvcCkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChBcnJheS5pc0FycmF5KHZhbHVlKSAmJiB2YWx1ZS5sZW5ndGggIT09IG9sZFZhbHVlLmxlbmd0aCkge1xuICAgICAgY2hhbmdlUmVjb3Jkcy5wdXNoKG5ldyBDaGFuZ2VSZWNvcmQodmFsdWUsICd1cGRhdGUnLCAnbGVuZ3RoJywgb2xkVmFsdWUubGVuZ3RoKSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGNoYW5nZVJlY29yZHM7XG4gIH1cblxuXG5cblxuXG4gIHZhciBFRElUX0xFQVZFID0gMDtcbiAgdmFyIEVESVRfVVBEQVRFID0gMTtcbiAgdmFyIEVESVRfQUREID0gMjtcbiAgdmFyIEVESVRfREVMRVRFID0gMztcblxuXG4gIC8vIERpZmZzIHR3byBhcnJheXMgcmV0dXJuaW5nIGFuIGFycmF5IG9mIHNwbGljZXMuIEEgc3BsaWNlIG9iamVjdCBsb29rcyBsaWtlOlxuICAvLyBgYGBqYXZhc2NyaXB0XG4gIC8vIHtcbiAgLy8gICBpbmRleDogMyxcbiAgLy8gICByZW1vdmVkOiBbaXRlbSwgaXRlbV0sXG4gIC8vICAgYWRkZWRDb3VudDogMFxuICAvLyB9XG4gIC8vIGBgYFxuICBmdW5jdGlvbiBkaWZmQXJyYXlzKHZhbHVlLCBvbGRWYWx1ZSkge1xuICAgIGlmICghQXJyYXkuaXNBcnJheSh2YWx1ZSkgfHwgIUFycmF5LmlzQXJyYXkob2xkVmFsdWUpKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdCb3RoIHZhbHVlcyBmb3IgZGlmZi5hcnJheSBtdXN0IGJlIGFycmF5cycpO1xuICAgIH1cblxuICAgIHZhciBjdXJyZW50U3RhcnQgPSAwO1xuICAgIHZhciBjdXJyZW50RW5kID0gdmFsdWUubGVuZ3RoO1xuICAgIHZhciBvbGRTdGFydCA9IDA7XG4gICAgdmFyIG9sZEVuZCA9IG9sZFZhbHVlLmxlbmd0aDtcblxuICAgIHZhciBtaW5MZW5ndGggPSBNYXRoLm1pbihjdXJyZW50RW5kLCBvbGRFbmQpO1xuICAgIHZhciBwcmVmaXhDb3VudCA9IHNoYXJlZFByZWZpeCh2YWx1ZSwgb2xkVmFsdWUsIG1pbkxlbmd0aCk7XG4gICAgdmFyIHN1ZmZpeENvdW50ID0gc2hhcmVkU3VmZml4KHZhbHVlLCBvbGRWYWx1ZSwgbWluTGVuZ3RoIC0gcHJlZml4Q291bnQpO1xuXG4gICAgY3VycmVudFN0YXJ0ICs9IHByZWZpeENvdW50O1xuICAgIG9sZFN0YXJ0ICs9IHByZWZpeENvdW50O1xuICAgIGN1cnJlbnRFbmQgLT0gc3VmZml4Q291bnQ7XG4gICAgb2xkRW5kIC09IHN1ZmZpeENvdW50O1xuXG4gICAgaWYgKGN1cnJlbnRFbmQgLSBjdXJyZW50U3RhcnQgPT09IDAgJiYgb2xkRW5kIC0gb2xkU3RhcnQgPT09IDApIHtcbiAgICAgIHJldHVybiBbXTtcbiAgICB9XG5cbiAgICAvLyBpZiBub3RoaW5nIHdhcyBhZGRlZCwgb25seSByZW1vdmVkIGZyb20gb25lIHNwb3RcbiAgICBpZiAoY3VycmVudFN0YXJ0ID09PSBjdXJyZW50RW5kKSB7XG4gICAgICByZXR1cm4gWyBuZXcgU3BsaWNlKHZhbHVlLCBjdXJyZW50U3RhcnQsIG9sZFZhbHVlLnNsaWNlKG9sZFN0YXJ0LCBvbGRFbmQpLCAwKSBdO1xuICAgIH1cblxuICAgIC8vIGlmIG5vdGhpbmcgd2FzIHJlbW92ZWQsIG9ubHkgYWRkZWQgdG8gb25lIHNwb3RcbiAgICBpZiAob2xkU3RhcnQgPT09IG9sZEVuZCkge1xuICAgICAgcmV0dXJuIFsgbmV3IFNwbGljZSh2YWx1ZSwgY3VycmVudFN0YXJ0LCBbXSwgY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCkgXTtcbiAgICB9XG5cbiAgICAvLyBhIG1peHR1cmUgb2YgYWRkcyBhbmQgcmVtb3Zlc1xuICAgIHZhciBkaXN0YW5jZXMgPSBjYWxjRWRpdERpc3RhbmNlcyh2YWx1ZSwgY3VycmVudFN0YXJ0LCBjdXJyZW50RW5kLCBvbGRWYWx1ZSwgb2xkU3RhcnQsIG9sZEVuZCk7XG4gICAgdmFyIG9wcyA9IHNwbGljZU9wZXJhdGlvbnNGcm9tRWRpdERpc3RhbmNlcyhkaXN0YW5jZXMpO1xuXG4gICAgdmFyIHNwbGljZSA9IG51bGw7XG4gICAgdmFyIHNwbGljZXMgPSBbXTtcbiAgICB2YXIgaW5kZXggPSBjdXJyZW50U3RhcnQ7XG4gICAgdmFyIG9sZEluZGV4ID0gb2xkU3RhcnQ7XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IG9wcy5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIHZhciBvcCA9IG9wc1tpXTtcbiAgICAgIGlmIChvcCA9PT0gRURJVF9MRUFWRSkge1xuICAgICAgICBpZiAoc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgICAgICAgc3BsaWNlID0gbnVsbDtcbiAgICAgICAgfVxuXG4gICAgICAgIGluZGV4Kys7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX1VQREFURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UodmFsdWUsIGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UuYWRkZWRDb3VudCsrO1xuICAgICAgICBpbmRleCsrO1xuXG4gICAgICAgIHNwbGljZS5yZW1vdmVkLnB1c2gob2xkVmFsdWVbb2xkSW5kZXhdKTtcbiAgICAgICAgb2xkSW5kZXgrKztcbiAgICAgIH0gZWxzZSBpZiAob3AgPT09IEVESVRfQUREKSB7XG4gICAgICAgIGlmICghc3BsaWNlKSB7XG4gICAgICAgICAgc3BsaWNlID0gbmV3IFNwbGljZSh2YWx1ZSwgaW5kZXgsIFtdLCAwKTtcbiAgICAgICAgfVxuXG4gICAgICAgIHNwbGljZS5hZGRlZENvdW50Kys7XG4gICAgICAgIGluZGV4Kys7XG4gICAgICB9IGVsc2UgaWYgKG9wID09PSBFRElUX0RFTEVURSkge1xuICAgICAgICBpZiAoIXNwbGljZSkge1xuICAgICAgICAgIHNwbGljZSA9IG5ldyBTcGxpY2UodmFsdWUsIGluZGV4LCBbXSwgMCk7XG4gICAgICAgIH1cblxuICAgICAgICBzcGxpY2UucmVtb3ZlZC5wdXNoKG9sZFZhbHVlW29sZEluZGV4XSk7XG4gICAgICAgIG9sZEluZGV4Kys7XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKHNwbGljZSkge1xuICAgICAgc3BsaWNlcy5wdXNoKHNwbGljZSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIHNwbGljZXM7XG4gIH1cblxuXG5cblxuICAvLyBmaW5kIHRoZSBudW1iZXIgb2YgaXRlbXMgYXQgdGhlIGJlZ2lubmluZyB0aGF0IGFyZSB0aGUgc2FtZVxuICBmdW5jdGlvbiBzaGFyZWRQcmVmaXgoY3VycmVudCwgb2xkLCBzZWFyY2hMZW5ndGgpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNlYXJjaExlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoZGlmZkJhc2ljKGN1cnJlbnRbaV0sIG9sZFtpXSkpIHtcbiAgICAgICAgcmV0dXJuIGk7XG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiBzZWFyY2hMZW5ndGg7XG4gIH1cblxuXG4gIC8vIGZpbmQgdGhlIG51bWJlciBvZiBpdGVtcyBhdCB0aGUgZW5kIHRoYXQgYXJlIHRoZSBzYW1lXG4gIGZ1bmN0aW9uIHNoYXJlZFN1ZmZpeChjdXJyZW50LCBvbGQsIHNlYXJjaExlbmd0aCkge1xuICAgIHZhciBpbmRleDEgPSBjdXJyZW50Lmxlbmd0aDtcbiAgICB2YXIgaW5kZXgyID0gb2xkLmxlbmd0aDtcbiAgICB2YXIgY291bnQgPSAwO1xuICAgIHdoaWxlIChjb3VudCA8IHNlYXJjaExlbmd0aCAmJiAhZGlmZkJhc2ljKGN1cnJlbnRbLS1pbmRleDFdLCBvbGRbLS1pbmRleDJdKSkge1xuICAgICAgY291bnQrKztcbiAgICB9XG4gICAgcmV0dXJuIGNvdW50O1xuICB9XG5cblxuICBmdW5jdGlvbiBzcGxpY2VPcGVyYXRpb25zRnJvbUVkaXREaXN0YW5jZXMoZGlzdGFuY2VzKSB7XG4gICAgdmFyIGkgPSBkaXN0YW5jZXMubGVuZ3RoIC0gMTtcbiAgICB2YXIgaiA9IGRpc3RhbmNlc1swXS5sZW5ndGggLSAxO1xuICAgIHZhciBjdXJyZW50ID0gZGlzdGFuY2VzW2ldW2pdO1xuICAgIHZhciBlZGl0cyA9IFtdO1xuICAgIHdoaWxlIChpID4gMCB8fCBqID4gMCkge1xuICAgICAgaWYgKGkgPT09IDApIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0FERCk7XG4gICAgICAgIGotLTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG5cbiAgICAgIGlmIChqID09PSAwKSB7XG4gICAgICAgIGVkaXRzLnB1c2goRURJVF9ERUxFVEUpO1xuICAgICAgICBpLS07XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB2YXIgbm9ydGhXZXN0ID0gZGlzdGFuY2VzW2kgLSAxXVtqIC0gMV07XG4gICAgICB2YXIgd2VzdCA9IGRpc3RhbmNlc1tpIC0gMV1bal07XG4gICAgICB2YXIgbm9ydGggPSBkaXN0YW5jZXNbaV1baiAtIDFdO1xuICAgICAgdmFyIG1pbjtcblxuICAgICAgaWYgKHdlc3QgPCBub3J0aCkge1xuICAgICAgICBtaW4gPSB3ZXN0IDwgbm9ydGhXZXN0ID8gd2VzdCA6IG5vcnRoV2VzdDtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG1pbiA9IG5vcnRoIDwgbm9ydGhXZXN0ID8gbm9ydGggOiBub3J0aFdlc3Q7XG4gICAgICB9XG5cbiAgICAgIGlmIChtaW4gPT09IG5vcnRoV2VzdCkge1xuICAgICAgICBpZiAobm9ydGhXZXN0ID09PSBjdXJyZW50KSB7XG4gICAgICAgICAgZWRpdHMucHVzaChFRElUX0xFQVZFKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlZGl0cy5wdXNoKEVESVRfVVBEQVRFKTtcbiAgICAgICAgICBjdXJyZW50ID0gbm9ydGhXZXN0O1xuICAgICAgICB9XG4gICAgICAgIGktLTtcbiAgICAgICAgai0tO1xuICAgICAgfSBlbHNlIGlmIChtaW4gPT09IHdlc3QpIHtcbiAgICAgICAgZWRpdHMucHVzaChFRElUX0RFTEVURSk7XG4gICAgICAgIGktLTtcbiAgICAgICAgY3VycmVudCA9IHdlc3Q7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBlZGl0cy5wdXNoKEVESVRfQUREKTtcbiAgICAgICAgai0tO1xuICAgICAgICBjdXJyZW50ID0gbm9ydGg7XG4gICAgICB9XG4gICAgfVxuICAgIGVkaXRzLnJldmVyc2UoKTtcbiAgICByZXR1cm4gZWRpdHM7XG4gIH1cblxuXG4gIGZ1bmN0aW9uIGNhbGNFZGl0RGlzdGFuY2VzKGN1cnJlbnQsIGN1cnJlbnRTdGFydCwgY3VycmVudEVuZCwgb2xkLCBvbGRTdGFydCwgb2xkRW5kKSB7XG4gICAgLy8gXCJEZWxldGlvblwiIGNvbHVtbnNcbiAgICB2YXIgcm93Q291bnQgPSBvbGRFbmQgLSBvbGRTdGFydCArIDE7XG4gICAgdmFyIGNvbHVtbkNvdW50ID0gY3VycmVudEVuZCAtIGN1cnJlbnRTdGFydCArIDE7XG4gICAgdmFyIGRpc3RhbmNlcyA9IG5ldyBBcnJheShyb3dDb3VudCk7XG4gICAgdmFyIGksIGo7XG5cbiAgICAvLyBcIkFkZGl0aW9uXCIgcm93cy4gSW5pdGlhbGl6ZSBudWxsIGNvbHVtbi5cbiAgICBmb3IgKGkgPSAwOyBpIDwgcm93Q291bnQ7IGkrKykge1xuICAgICAgZGlzdGFuY2VzW2ldID0gbmV3IEFycmF5KGNvbHVtbkNvdW50KTtcbiAgICAgIGRpc3RhbmNlc1tpXVswXSA9IGk7XG4gICAgfVxuXG4gICAgLy8gSW5pdGlhbGl6ZSBudWxsIHJvd1xuICAgIGZvciAoaiA9IDA7IGogPCBjb2x1bW5Db3VudDsgaisrKSB7XG4gICAgICBkaXN0YW5jZXNbMF1bal0gPSBqO1xuICAgIH1cblxuICAgIGZvciAoaSA9IDE7IGkgPCByb3dDb3VudDsgaSsrKSB7XG4gICAgICBmb3IgKGogPSAxOyBqIDwgY29sdW1uQ291bnQ7IGorKykge1xuICAgICAgICBpZiAoIWRpZmZCYXNpYyhjdXJyZW50W2N1cnJlbnRTdGFydCArIGogLSAxXSwgb2xkW29sZFN0YXJ0ICsgaSAtIDFdKSkge1xuICAgICAgICAgIGRpc3RhbmNlc1tpXVtqXSA9IGRpc3RhbmNlc1tpIC0gMV1baiAtIDFdO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHZhciBub3J0aCA9IGRpc3RhbmNlc1tpIC0gMV1bal0gKyAxO1xuICAgICAgICAgIHZhciB3ZXN0ID0gZGlzdGFuY2VzW2ldW2ogLSAxXSArIDE7XG4gICAgICAgICAgZGlzdGFuY2VzW2ldW2pdID0gbm9ydGggPCB3ZXN0ID8gbm9ydGggOiB3ZXN0O1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRpc3RhbmNlcztcbiAgfVxufSkoKTtcbiIsIm1vZHVsZS5leHBvcnRzID0gcmVxdWlyZSgnLi9zcmMvZXhwcmVzc2lvbnMnKTtcbiIsInZhciBzbGljZSA9IEFycmF5LnByb3RvdHlwZS5zbGljZTtcbnZhciBzdHJpbmdzID0gcmVxdWlyZSgnLi9zdHJpbmdzJyk7XG52YXIgZm9ybWF0dGVyUGFyc2VyID0gcmVxdWlyZSgnLi9mb3JtYXR0ZXJzJyk7XG52YXIgcHJvcGVydHlDaGFpbnMgPSByZXF1aXJlKCcuL3Byb3BlcnR5LWNoYWlucycpO1xudmFyIHZhbHVlUHJvcGVydHkgPSAnX3ZhbHVlXyc7XG52YXIgY2FjaGUgPSB7fTtcblxuZXhwb3J0cy5nbG9iYWxzID0ge307XG5cblxuZXhwb3J0cy5wYXJzZSA9IGZ1bmN0aW9uKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFBcmdzKSkgZXh0cmFBcmdzID0gW107XG4gIHZhciBjYWNoZUtleSA9IGV4cHIgKyAnfCcgKyBleHRyYUFyZ3Muam9pbignLCcpO1xuICAvLyBSZXR1cm5zIHRoZSBjYWNoZWQgZnVuY3Rpb24gZm9yIHRoaXMgZXhwcmVzc2lvbiBpZiBpdCBleGlzdHMuXG4gIHZhciBmdW5jID0gY2FjaGVbY2FjaGVLZXldO1xuICBpZiAoZnVuYykge1xuICAgIHJldHVybiBmdW5jO1xuICB9XG5cbiAgdmFyIG9yaWdpbmFsID0gZXhwcjtcbiAgdmFyIGlzU2V0dGVyID0gKGV4dHJhQXJnc1swXSA9PT0gdmFsdWVQcm9wZXJ0eSk7XG4gIC8vIEFsbG93ICchcHJvcCcgdG8gYmVjb21lICdwcm9wID0gIXZhbHVlJ1xuICBpZiAoaXNTZXR0ZXIgJiYgZXhwci5jaGFyQXQoMCkgPT09ICchJykge1xuICAgIGV4cHIgPSBleHByLnNsaWNlKDEpO1xuICAgIHZhbHVlUHJvcGVydHkgPSAnIScgKyB2YWx1ZVByb3BlcnR5O1xuICB9XG5cbiAgZXhwciA9IHN0cmluZ3MucHVsbE91dFN0cmluZ3MoZXhwcik7XG4gIGV4cHIgPSBmb3JtYXR0ZXJQYXJzZXIucGFyc2VGb3JtYXR0ZXJzKGV4cHIpO1xuICBleHByID0gcHJvcGVydHlDaGFpbnMucGFyc2VFeHByZXNzaW9uKGV4cHIsIGdldFZhcmlhYmxlcyhnbG9iYWxzLCBleHRyYUFyZ3MpKTtcbiAgaWYgKCFpc1NldHRlcikge1xuICAgIHZhciBsaW5lcyA9IGV4cHIuc3BsaXQoJ1xcbicpO1xuICAgIGxpbmVzW2xpbmVzLmxlbmd0aCAtIDFdID0gJ3JldHVybiAnICsgbGluZXNbbGluZXMubGVuZ3RoIC0gMV07XG4gICAgZXhwciA9IGxpbmVzLmpvaW4oJ1xcbicpO1xuICB9XG4gIGV4cHIgPSBzdHJpbmdzLnB1dEluU3RyaW5ncyhleHByKTtcbiAgZnVuYyA9IGNvbXBpbGVFeHByZXNzaW9uKG9yaWdpbmFsLCBleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpO1xuICBmdW5jLmV4cHIgPSBleHByO1xuICBjYWNoZVtjYWNoZUtleV0gPSBmdW5jO1xuICByZXR1cm4gZnVuYztcbn07XG5cblxuZXhwb3J0cy5wYXJzZVNldHRlciA9IGZ1bmN0aW9uKGV4cHIsIGdsb2JhbHMsIGZvcm1hdHRlcnMsIGV4dHJhQXJncykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoZXh0cmFBcmdzKSkgZXh0cmFBcmdzID0gW107XG5cbiAgLy8gQWRkIF92YWx1ZV8gYXMgdGhlIGZpcnN0IGV4dHJhIGFyZ3VtZW50XG4gIGV4dHJhQXJncy51bnNoaWZ0KHZhbHVlUHJvcGVydHkpO1xuICBleHByID0gZXhwci5yZXBsYWNlKC8oXFxzKlxcfHwkKS8sICcgPSBfdmFsdWVfJDEnKTtcblxuICByZXR1cm4gZXhwb3J0cy5wYXJzZShleHByLCBnbG9iYWxzLCBmb3JtYXR0ZXJzLCBleHRyYUFyZ3MpO1xufTtcblxuXG5mdW5jdGlvbiBnZXRWYXJpYWJsZXMoZ2xvYmFscywgZXh0cmFBcmdzKSB7XG4gIHZhciB2YXJpYWJsZXMgPSB7fTtcblxuICBPYmplY3Qua2V5cyhleHBvcnRzLmdsb2JhbHMpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgdmFyaWFibGVzW2tleV0gPSBleHBvcnRzLmdsb2JhbHNba2V5XTtcbiAgfSk7XG5cbiAgaWYgKGdsb2JhbHMpIHtcbiAgICBPYmplY3Qua2V5cyhnbG9iYWxzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgdmFyaWFibGVzW2tleV0gPSBnbG9iYWxzW2tleV07XG4gICAgfSk7XG4gIH1cblxuICBleHRyYUFyZ3MuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICB2YXJpYWJsZXNba2V5XSA9IG51bGw7XG4gIH0pO1xuXG4gIHJldHVybiB2YXJpYWJsZXM7XG59XG5cblxuXG5mdW5jdGlvbiBjb21waWxlRXhwcmVzc2lvbihvcmlnaW5hbCwgZXhwciwgZ2xvYmFscywgZm9ybWF0dGVycywgZXh0cmFBcmdzKSB7XG4gIHZhciBmdW5jLCBhcmdzID0gWydfZ2xvYmFsc18nLCAnX2Zvcm1hdHRlcnNfJ10uY29uY2F0KGV4dHJhQXJncykuY29uY2F0KGV4cHIpO1xuXG4gIHRyeSB7XG4gICAgZnVuYyA9IEZ1bmN0aW9uLmFwcGx5KG51bGwsIGFyZ3MpO1xuICB9IGNhdGNoIChlKSB7XG4gICAgLy8gVGhyb3dzIGFuIGVycm9yIGlmIHRoZSBleHByZXNzaW9uIHdhcyBub3QgdmFsaWQgSmF2YVNjcmlwdFxuICAgIHRocm93IG5ldyBFcnJvcignQmFkIGV4cHJlc3Npb246ICcgKyBvcmlnaW5hbCArICdcXG4nICsgJ0NvbXBpbGVkIGV4cHJlc3Npb246XFxuJyArIGV4cHIgKyAnXFxuJyArIGUubWVzc2FnZSk7XG4gIH1cblxuICByZXR1cm4gYmluZEFyZ3VtZW50cyhmdW5jLCBnbG9iYWxzLCBmb3JtYXR0ZXJzKTtcbn1cblxuXG4vLyBhIGN1c3RvbSBcImJpbmRcIiBmdW5jdGlvbiB0byBiaW5kIGFyZ3VtZW50cyB0byBhIGZ1bmN0aW9uIHdpdGhvdXQgYmluZGluZyB0aGUgY29udGV4dFxuZnVuY3Rpb24gYmluZEFyZ3VtZW50cyhmdW5jKSB7XG4gIHZhciBhcmdzID0gc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpO1xuICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIGZ1bmMuYXBwbHkodGhpcywgYXJncy5jb25jYXQoc2xpY2UuY2FsbChhcmd1bWVudHMpKSk7XG4gIH1cbn1cbiIsIlxuLy8gZmluZHMgcGlwZXMgdGhhdCBhcmUgbm90IE9ScyAoaS5lLiBgIHwgYCBub3QgYCB8fCBgKSBmb3IgZm9ybWF0dGVyc1xudmFyIHBpcGVSZWdleCA9IC9cXHwoXFx8KT8vZztcblxuLy8gQSBzdHJpbmcgdGhhdCB3b3VsZCBub3QgYXBwZWFyIGluIHZhbGlkIEphdmFTY3JpcHRcbnZhciBwbGFjZWhvbGRlciA9ICdAQEAnO1xudmFyIHBsYWNlaG9sZGVyUmVnZXggPSBuZXcgUmVnRXhwKCdcXFxccyonICsgcGxhY2Vob2xkZXIgKyAnXFxcXHMqJyk7XG5cbi8vIGRldGVybWluZXMgd2hldGhlciBhbiBleHByZXNzaW9uIGlzIGEgc2V0dGVyIG9yIGdldHRlciAoYG5hbWVgIHZzIGBuYW1lID0gJ2JvYidgKVxudmFyIHNldHRlclJlZ2V4ID0gL1xccz1cXHMvO1xuXG4vLyBmaW5kcyB0aGUgcGFydHMgb2YgYSBmb3JtYXR0ZXIsIG5hbWUgYW5kIGFyZ3MgKGUuZy4gYGZvbyhiYXIpYClcbnZhciBmb3JtYXR0ZXJSZWdleCA9IC9eKFteXFwoXSspKD86XFwoKC4qKVxcKSk/JC87XG5cbi8vIGZpbmRzIGFyZ3VtZW50IHNlcGFyYXRvcnMgZm9yIGZvcm1hdHRlcnMgKGBhcmcxLCBhcmcyYClcbnZhciBhcmdTZXBhcmF0b3IgPSAvXFxzKixcXHMqL2c7XG5cblxuLyoqXG4gKiBGaW5kcyB0aGUgZm9ybWF0dGVycyB3aXRoaW4gYW4gZXhwcmVzc2lvbiBhbmQgY29udmVydHMgdGhlbSB0byB0aGUgY29ycmVjdCBKYXZhU2NyaXB0IGVxdWl2YWxlbnQuXG4gKi9cbmV4cG9ydHMucGFyc2VGb3JtYXR0ZXJzID0gZnVuY3Rpb24oZXhwcikge1xuICAvLyBDb252ZXJ0cyBgbmFtZSB8IHVwcGVyIHwgZm9vKGJhcilgIGludG8gYG5hbWUgQEBAIHVwcGVyIEBAQCBmb28oYmFyKWBcbiAgZXhwciA9IGV4cHIucmVwbGFjZShwaXBlUmVnZXgsIGZ1bmN0aW9uKG1hdGNoLCBvckluZGljYXRvcikge1xuICAgIGlmIChvckluZGljYXRvcikgcmV0dXJuIG1hdGNoO1xuICAgIHJldHVybiBwbGFjZWhvbGRlcjtcbiAgfSk7XG5cbiAgLy8gc3BsaXRzIHRoZSBzdHJpbmcgYnkgXCJAQEBcIiwgcHVsbHMgb2YgdGhlIGZpcnN0IGFzIHRoZSBleHByLCB0aGUgcmVtYWluaW5nIGFyZSBmb3JtYXR0ZXJzXG4gIGZvcm1hdHRlcnMgPSBleHByLnNwbGl0KHBsYWNlaG9sZGVyUmVnZXgpO1xuICBleHByID0gZm9ybWF0dGVycy5zaGlmdCgpO1xuICBpZiAoIWZvcm1hdHRlcnMubGVuZ3RoKSByZXR1cm4gZXhwcjtcblxuICAvLyBQcm9jZXNzZXMgdGhlIGZvcm1hdHRlcnNcbiAgLy8gSWYgdGhlIGV4cHJlc3Npb24gaXMgYSBzZXR0ZXIgdGhlIHZhbHVlIHdpbGwgYmUgcnVuIHRocm91Z2ggdGhlIGZvcm1hdHRlcnNcbiAgdmFyIHNldHRlciA9ICcnO1xuICB2YXIgdmFsdWUgPSBleHByO1xuXG4gIGlmIChzZXR0ZXJSZWdleC50ZXN0KGV4cHIpKSB7XG4gICAgdmFyIHBhcnRzID0gZXhwci5zcGxpdChzZXR0ZXJSZWdleCk7XG4gICAgc2V0dGVyID0gcGFydHNbMF0gKyAnID0gJztcbiAgICB2YWx1ZSA9IHBhcnRzWzFdO1xuICB9XG5cbiAgLy8gUHJvY2Vzc2VzIHRoZSBmb3JtYXR0ZXJzXG4gIGZvcm1hdHRlcnMuZm9yRWFjaChmdW5jdGlvbihmb3JtYXR0ZXIpIHtcbiAgICB2YXIgbWF0Y2ggPSBmb3JtYXR0ZXIudHJpbSgpLm1hdGNoKGZvcm1hdHRlclJlZ2V4KTtcblxuICAgIGlmICghbWF0Y2gpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignRm9ybWF0dGVyIGlzIGludmFsaWQ6ICcgKyBmb3JtYXR0ZXIpO1xuICAgIH1cblxuICAgIHZhciBmb3JtYXR0ZXJOYW1lID0gbWF0Y2hbMV07XG4gICAgdmFyIGFyZ3MgPSBtYXRjaFsyXSA/IG1hdGNoWzJdLnNwbGl0KGFyZ1NlcGFyYXRvcikgOiBbXTtcblxuICAgIC8vIEFkZCB0aGUgcHJldmlvdXMgdmFsdWUgYXMgdGhlIGZpcnN0IGFyZ3VtZW50XG4gICAgYXJncy51bnNoaWZ0KHZhbHVlKTtcblxuICAgIC8vIElmIHRoaXMgaXMgYSBzZXR0ZXIgZXhwciwgYmUgc3VyZSB0byBhZGQgdGhlIGBpc1NldHRlcmAgZmxhZyBhdCB0aGUgZW5kIG9mIHRoZSBmb3JtYXR0ZXIncyBhcmd1bWVudHNcbiAgICBpZiAoc2V0dGVyKSB7XG4gICAgICBhcmdzLnB1c2godHJ1ZSk7XG4gICAgfVxuXG4gICAgLy8gU2V0IHRoZSB2YWx1ZSB0byBiZWNvbWUgdGhlIHJlc3VsdCBvZiB0aGlzIGZvcm1hdHRlciwgc28gdGhlIG5leHQgZm9ybWF0dGVyIGNhbiB3cmFwIGl0LlxuICAgIC8vIENhbGwgZm9ybWF0dGVycyBpbiB0aGUgY3VycmVudCBjb250ZXh0LlxuICAgIHZhbHVlID0gJ19mb3JtYXR0ZXJzXy4nICsgZm9ybWF0dGVyTmFtZSArICcuY2FsbCh0aGlzLCAnICsgYXJncy5qb2luKCcsICcpICsgJyknO1xuICB9KTtcblxuICByZXR1cm4gc2V0dGVyICsgdmFsdWU7XG59O1xuIiwidmFyIHJlZmVyZW5jZUNvdW50ID0gMDtcbnZhciBjdXJyZW50UmVmZXJlbmNlID0gMDtcbnZhciBjdXJyZW50SW5kZXggPSAwO1xudmFyIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbnZhciBjb250aW51YXRpb24gPSBmYWxzZTtcbnZhciBnbG9iYWxzID0gbnVsbDtcbnZhciBkZWZhdWx0R2xvYmFscyA9IHtcbiAgcmV0dXJuOiBudWxsLFxuICB0cnVlOiBudWxsLFxuICBmYWxzZTogbnVsbCxcbiAgdW5kZWZpbmVkOiBudWxsLFxuICBudWxsOiBudWxsLFxuICB0aGlzOiBudWxsLFxuICB3aW5kb3c6IG51bGwsXG4gIE1hdGg6IG51bGwsXG4gIHBhcnNlSW50OiBudWxsLFxuICBwYXJzZUZsb2F0OiBudWxsLFxuICBpc05hTjogbnVsbCxcbiAgQXJyYXk6IG51bGwsXG4gIHR5cGVvZjogbnVsbCxcbiAgX2dsb2JhbHNfOiBudWxsLFxuICBfZm9ybWF0dGVyc186IG51bGwsXG4gIF92YWx1ZV86IG51bGwsXG59O1xuXG5cbi8vIG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIChlLmcuIGBuYW1lYCwgYHVzZXIubmFtZWAsIGFuZCBgdXNlci5mdWxsTmFtZSgpLmNhcGl0YWxpemUoKWApXG52YXIgcHJvcGVydHlSZWdleCA9IC8oKFxce3wsfFxcLik/XFxzKikoW2EteiRfXFwkXSg/OlthLXpfXFwkMC05XFwuLV18XFxbWydcIlxcZF0rXFxdKSopKFxccyooOnxcXCh8XFxbKT8pL2dpO1xuLyoqXG4gKiBCcm9rZW4gZG93blxuICpcbiAqICgoXFx7fCx8XFwuKT9cXHMqKVxuICogcHJlZml4OiBtYXRjaGVzIG9uIG9iamVjdCBsaXRlcmFscyBzbyB3ZSBjYW4gc2tpcCAoaW4gYHsgZm9vOiBiYXIgfWAgXCJmb29cIiBpcyBub3QgYSBwcm9wZXJ0eSkuIEFsc28gcGlja3MgdXAgb25cbiAqIHVuZmluaXNoZWQgY2hhaW5zIHRoYXQgaGFkIGZ1bmN0aW9uIGNhbGxzIG9yIGJyYWNrZXRzIHdlIGNvdWxkbid0IGZpbmlzaCBzdWNoIGFzIHRoZSBkb3QgaW4gYC50ZXN0YCBhZnRlciB0aGUgY2hhaW5cbiAqIGBmb28uYmFyKCkudGVzdGAuXG4gKlxuICogKFthLXokX1xcJF0oPzpbYS16X1xcJDAtOVxcLi1dfFxcW1snXCJcXGRdK1xcXSkqKVxuICogcHJvcGVydHkgY2hhaW46IG1hdGNoZXMgcHJvcGVydHkgY2hhaW5zIHN1Y2ggYXMgdGhlIGZvbGxvd2luZyAoc3RyaW5ncycgY29udGVudHMgYXJlIHJlbW92ZWQgYXQgdGhpcyBzdGVwKVxuICogICBgZm9vLCBmb28uYmFyLCBmb28uYmFyWzBdLCBmb28uYmFyWzBdLnRlc3QsIGZvby5iYXJbJyddLnRlc3RgXG4gKiAgIERvZXMgbm90IG1hdGNoIHRocm91Z2ggZnVuY3Rpb25zIGNhbGxzIG9yIHRocm91Z2ggYnJhY2tldHMgd2hpY2ggY29udGFpbiB2YXJpYWJsZXMuXG4gKiAgIGBmb28uYmFyKCkudGVzdCwgZm9vLmJhcltwcm9wXS50ZXN0YFxuICogICBJbiB0aGVzZSBjYXNlcyBpdCB3b3VsZCBvbmx5IG1hdGNoIGBmb28uYmFyYCwgYC50ZXN0YCwgYW5kIGBwcm9wYFxuICpcbiAqIChcXHMqKDp8XFwofFxcWyk/KVxuICogcG9zdGZpeDogbWF0Y2hlcyB0cmFpbGluZyBjaGFyYWN0ZXJzIHRvIGRldGVybWluZSBpZiB0aGlzIGlzIGFuIG9iamVjdCBwcm9wZXJ0eSBvciBhIGZ1bmN0aW9uIGNhbGwgZXRjLiBXaWxsIG1hdGNoXG4gKiB0aGUgY29sb24gYWZ0ZXIgXCJmb29cIiBpbiBgeyBmb286ICdiYXInIH1gLCB0aGUgZmlyc3QgcGFyZW50aGVzaXMgaW4gYG9iai5mb28oYmFyKWAsIHRoZSB0aGUgZmlyc3QgYnJhY2tldCBpblxuICogYGZvb1tiYXJdYC5cbiAqL1xuXG4vLyBsaW5rcyBpbiBhIHByb3BlcnR5IGNoYWluXG52YXIgY2hhaW5MaW5rc1JlZ2V4ID0gL1xcLnxcXFsvZztcblxuLy8gdGhlIHByb3BlcnR5IG5hbWUgcGFydCBvZiBsaW5rc1xudmFyIGNoYWluTGlua1JlZ2V4ID0gL1xcLnxcXFt8XFwoLztcblxudmFyIGFuZFJlZ2V4ID0gLyBhbmQgL2c7XG52YXIgb3JSZWdleCA9IC8gb3IgL2c7XG5cblxuZXhwb3J0cy5wYXJzZUV4cHJlc3Npb24gPSBmdW5jdGlvbihleHByLCBfZ2xvYmFscykge1xuICAvLyBSZXNldCBhbGwgdmFsdWVzXG4gIHJlZmVyZW5jZUNvdW50ID0gMDtcbiAgY3VycmVudFJlZmVyZW5jZSA9IDA7XG4gIGN1cnJlbnRJbmRleCA9IDA7XG4gIGZpbmlzaGVkQ2hhaW4gPSBmYWxzZTtcbiAgY29udGludWF0aW9uID0gZmFsc2U7XG4gIGdsb2JhbHMgPSBfZ2xvYmFscztcblxuICBleHByID0gcmVwbGFjZUFuZHNBbmRPcnMoZXhwcik7XG4gIGlmIChleHByLmluZGV4T2YoJyA9ICcpICE9PSAtMSkge1xuICAgIHZhciBwYXJ0cyA9IGV4cHIuc3BsaXQoJyA9ICcpO1xuICAgIHZhciBzZXR0ZXIgPSBwYXJ0c1swXTtcbiAgICB2YXIgdmFsdWUgPSBwYXJ0c1sxXTtcbiAgICBzZXR0ZXIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKHNldHRlcikucmVwbGFjZSgvXlxcKHxcXCkkL2csICcnKTtcbiAgICB2YWx1ZSA9IHBhcnNlUHJvcGVydHlDaGFpbnModmFsdWUpO1xuICAgIGV4cHIgPSBzZXR0ZXIgKyAnID0gJyArIHZhbHVlO1xuICB9IGVsc2Uge1xuICAgIGV4cHIgPSBwYXJzZVByb3BlcnR5Q2hhaW5zKGV4cHIpO1xuICB9XG4gIGV4cHIgPSBhZGRSZWZlcmVuY2VzKGV4cHIpXG5cbiAgLy8gUmVzZXQgYWZ0ZXIgcGFyc2UgaXMgZG9uZVxuICBnbG9iYWxzID0gbnVsbDtcblxuICByZXR1cm4gZXhwcjtcbn07XG5cblxuLyoqXG4gKiBGaW5kcyBhbmQgcGFyc2VzIHRoZSBwcm9wZXJ0eSBjaGFpbnMgaW4gYW4gZXhwcmVzc2lvbi5cbiAqL1xuZnVuY3Rpb24gcGFyc2VQcm9wZXJ0eUNoYWlucyhleHByKSB7XG4gIHZhciBwYXJzZWRFeHByID0gJycsIGNoYWluO1xuXG4gIC8vIGFsbG93IHJlY3Vyc2lvbiAoZS5nLiBpbnRvIGZ1bmN0aW9uIGFyZ3MpIGJ5IHJlc2V0dGluZyBwcm9wZXJ0eVJlZ2V4XG4gIC8vIFRoaXMgaXMgbW9yZSBlZmZpY2llbnQgdGhhbiBjcmVhdGluZyBhIG5ldyByZWdleCBmb3IgZWFjaCBjaGFpbiwgSSBhc3N1bWVcbiAgdmFyIHByZXZDdXJyZW50SW5kZXggPSBjdXJyZW50SW5kZXg7XG4gIHZhciBwcmV2TGFzdEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG5cbiAgY3VycmVudEluZGV4ID0gMDtcbiAgcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSAwO1xuICB3aGlsZSAoKGNoYWluID0gbmV4dENoYWluKGV4cHIpKSAhPT0gZmFsc2UpIHtcbiAgICBwYXJzZWRFeHByICs9IGNoYWluO1xuICB9XG5cbiAgLy8gUmVzZXQgaW5kZXhlc1xuICBjdXJyZW50SW5kZXggPSBwcmV2Q3VycmVudEluZGV4O1xuICBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleCA9IHByZXZMYXN0SW5kZXg7XG4gIHJldHVybiBwYXJzZWRFeHByO1xufTtcblxuXG5mdW5jdGlvbiBuZXh0Q2hhaW4oZXhwcikge1xuICBpZiAoZmluaXNoZWRDaGFpbikge1xuICAgIHJldHVybiAoZmluaXNoZWRDaGFpbiA9IGZhbHNlKTtcbiAgfVxuICB2YXIgbWF0Y2ggPSBwcm9wZXJ0eVJlZ2V4LmV4ZWMoZXhwcik7XG4gIGlmICghbWF0Y2gpIHtcbiAgICBmaW5pc2hlZENoYWluID0gdHJ1ZSAvLyBtYWtlIHN1cmUgbmV4dCBjYWxsIHdlIHJldHVybiBmYWxzZVxuICAgIHJldHVybiBleHByLnNsaWNlKGN1cnJlbnRJbmRleCk7XG4gIH1cblxuICAvLyBgcHJlZml4YCBpcyBgb2JqSW5kaWNhdG9yYCB3aXRoIHRoZSB3aGl0ZXNwYWNlIHRoYXQgbWF5IGNvbWUgYWZ0ZXIgaXQuXG4gIHZhciBwcmVmaXggPSBtYXRjaFsxXTtcblxuICAvLyBgb2JqSW5kaWNhdG9yYCBpcyBge2Agb3IgYCxgIGFuZCBsZXQncyB1cyBrbm93IHRoaXMgaXMgYW4gb2JqZWN0IHByb3BlcnR5XG4gIC8vIG5hbWUgKGUuZy4gcHJvcCBpbiBge3Byb3A6ZmFsc2V9YCkuXG4gIHZhciBvYmpJbmRpY2F0b3IgPSBtYXRjaFsyXTtcblxuICAvLyBgcHJvcENoYWluYCBpcyB0aGUgY2hhaW4gb2YgcHJvcGVydGllcyBtYXRjaGVkIChlLmcuIGB0aGlzLnVzZXIuZW1haWxgKS5cbiAgdmFyIHByb3BDaGFpbiA9IG1hdGNoWzNdO1xuXG4gIC8vIGBwb3N0Zml4YCBpcyB0aGUgYGNvbG9uT3JQYXJlbmAgd2l0aCB3aGl0ZXNwYWNlIGJlZm9yZSBpdC5cbiAgdmFyIHBvc3RmaXggPSBtYXRjaFs0XTtcblxuICAvLyBgY29sb25PclBhcmVuYCBtYXRjaGVzIHRoZSBjb2xvbiAoOikgYWZ0ZXIgdGhlIHByb3BlcnR5IChpZiBpdCBpcyBhbiBvYmplY3QpXG4gIC8vIG9yIHBhcmVudGhlc2lzIGlmIGl0IGlzIGEgZnVuY3Rpb24uIFdlIHVzZSBgY29sb25PclBhcmVuYCBhbmQgYG9iakluZGljYXRvcmBcbiAgLy8gdG8ga25vdyBpZiBpdCBpcyBhbiBvYmplY3QuXG4gIHZhciBjb2xvbk9yUGFyZW4gPSBtYXRjaFs1XTtcblxuICBtYXRjaCA9IG1hdGNoWzBdO1xuXG4gIHZhciBza2lwcGVkID0gZXhwci5zbGljZShjdXJyZW50SW5kZXgsIHByb3BlcnR5UmVnZXgubGFzdEluZGV4IC0gbWF0Y2gubGVuZ3RoKTtcbiAgY3VycmVudEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXg7XG5cbiAgLy8gc2tpcHMgb2JqZWN0IGtleXMgZS5nLiB0ZXN0IGluIGB7dGVzdDp0cnVlfWAuXG4gIGlmIChvYmpJbmRpY2F0b3IgJiYgY29sb25PclBhcmVuID09PSAnOicpIHtcbiAgICByZXR1cm4gc2tpcHBlZCArIG1hdGNoO1xuICB9XG5cbiAgcmV0dXJuIHNraXBwZWQgKyBwYXJzZUNoYWluKHByZWZpeCwgcHJvcENoYWluLCBwb3N0Zml4LCBjb2xvbk9yUGFyZW4sIGV4cHIpO1xufVxuXG5cbmZ1bmN0aW9uIHBhcnNlQ2hhaW4ocHJlZml4LCBwcm9wQ2hhaW4sIHBvc3RmaXgsIHBhcmVuLCBleHByKSB7XG4gIC8vIGNvbnRpbnVhdGlvbnMgYWZ0ZXIgYSBmdW5jdGlvbiAoZS5nLiBgZ2V0VXNlcigxMikuZmlyc3ROYW1lYCkuXG4gIGNvbnRpbnVhdGlvbiA9IHByZWZpeCA9PT0gJy4nO1xuICBpZiAoY29udGludWF0aW9uKSB7XG4gICAgcHJvcENoYWluID0gJy4nICsgcHJvcENoYWluO1xuICAgIHByZWZpeCA9ICcnO1xuICB9XG5cbiAgdmFyIGxpbmtzID0gc3BsaXRMaW5rcyhwcm9wQ2hhaW4pO1xuICB2YXIgbmV3Q2hhaW4gPSAnJztcblxuICBpZiAobGlua3MubGVuZ3RoID09PSAxICYmICFjb250aW51YXRpb24gJiYgIXBhcmVuKSB7XG4gICAgbGluayA9IGxpbmtzWzBdO1xuICAgIG5ld0NoYWluID0gYWRkVGhpc09yR2xvYmFsKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGlmICghY29udGludWF0aW9uKSB7XG4gICAgICBuZXdDaGFpbiA9ICcoJztcbiAgICB9XG5cbiAgICBsaW5rcy5mb3JFYWNoKGZ1bmN0aW9uKGxpbmssIGluZGV4KSB7XG4gICAgICBpZiAoaW5kZXggIT09IGxpbmtzLmxlbmd0aCAtIDEpIHtcbiAgICAgICAgbmV3Q2hhaW4gKz0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGlmICghcGFyZW5zW3BhcmVuXSkge1xuICAgICAgICAgIG5ld0NoYWluICs9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmIChjb250aW51YXRpb24gJiYgaW5kZXggPT09IDApIHtcbiAgICAgICAgICAgIGluZGV4Kys7XG4gICAgICAgICAgfVxuICAgICAgICAgIHBvc3RmaXggPSBwb3N0Zml4LnJlcGxhY2UocGFyZW4sICcnKTtcbiAgICAgICAgICBuZXdDaGFpbiArPSBwYXJlbiA9PT0gJygnID8gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikgOiBwYXJzZUJyYWNrZXRzKGxpbmssIGluZGV4LCBleHByKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSAhPT0gJy4nKSB7XG4gICAgICBuZXdDaGFpbiArPSAnKSc7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHByZWZpeCArIG5ld0NoYWluICsgcG9zdGZpeDtcbn1cblxuXG5mdW5jdGlvbiBzcGxpdExpbmtzKGNoYWluKSB7XG4gIHZhciBpbmRleCA9IDA7XG4gIHZhciBwYXJ0cyA9IFtdO1xuICB2YXIgbWF0Y2g7XG4gIHdoaWxlIChtYXRjaCA9IGNoYWluTGlua3NSZWdleC5leGVjKGNoYWluKSkge1xuICAgIGlmIChjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4ID09PSAxKSBjb250aW51ZTtcbiAgICBwYXJ0cy5wdXNoKGNoYWluLnNsaWNlKGluZGV4LCBjaGFpbkxpbmtzUmVnZXgubGFzdEluZGV4IC0gMSkpO1xuICAgIGluZGV4ID0gY2hhaW5MaW5rc1JlZ2V4Lmxhc3RJbmRleCAtIDE7XG4gIH1cbiAgcGFydHMucHVzaChjaGFpbi5zbGljZShpbmRleCkpO1xuICByZXR1cm4gcGFydHM7XG59XG5cblxuZnVuY3Rpb24gYWRkVGhpc09yR2xvYmFsKGNoYWluKSB7XG4gIHZhciBwcm9wID0gY2hhaW4uc3BsaXQoY2hhaW5MaW5rUmVnZXgpLnNoaWZ0KCk7XG4gIGlmIChnbG9iYWxzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgcmV0dXJuIGdsb2JhbHNbcHJvcF0gPT09IG51bGwgPyBjaGFpbiA6ICdfZ2xvYmFsc18uJyArIGNoYWluO1xuICB9IGVsc2UgaWYgKGRlZmF1bHRHbG9iYWxzLmhhc093blByb3BlcnR5KHByb3ApKSB7XG4gICAgcmV0dXJuIGNoYWluO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAndGhpcy4nICsgY2hhaW47XG4gIH1cbn1cblxuXG52YXIgcGFyZW5zID0ge1xuICAnKCc6ICcpJyxcbiAgJ1snOiAnXSdcbn07XG5cbi8vIEhhbmRsZXMgYSBmdW5jdGlvbiB0byBiZSBjYWxsZWQgaW4gaXRzIGNvcnJlY3Qgc2NvcGVcbi8vIEZpbmRzIHRoZSBlbmQgb2YgdGhlIGZ1bmN0aW9uIGFuZCBwcm9jZXNzZXMgdGhlIGFyZ3VtZW50c1xuZnVuY3Rpb24gcGFyc2VGdW5jdGlvbihsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcblxuICAvLyBBbHdheXMgY2FsbCBmdW5jdGlvbnMgaW4gdGhlIHNjb3BlIG9mIHRoZSBvYmplY3QgdGhleSdyZSBhIG1lbWJlciBvZlxuICBpZiAoaW5kZXggPT09IDApIHtcbiAgICBsaW5rID0gYWRkVGhpc09yR2xvYmFsKGxpbmspO1xuICB9IGVsc2Uge1xuICAgIGxpbmsgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgbGluaztcbiAgfVxuXG4gIHZhciBjYWxsZWRMaW5rID0gbGluayArICcofn5pbnNpZGVQYXJlbnN+fiknO1xuICBpZiAoZXhwci5jaGFyQXQocHJvcGVydHlSZWdleC5sYXN0SW5kZXgpID09PSAnLicpIHtcbiAgICBjYWxsZWRMaW5rID0gcGFyc2VQYXJ0KGNhbGxlZExpbmssIGluZGV4KVxuICB9XG5cbiAgbGluayA9ICd0eXBlb2YgJyArIGxpbmsgKyAnICE9PSBcXCdmdW5jdGlvblxcJyA/IHZvaWQgMCA6ICcgKyBjYWxsZWRMaW5rO1xuICB2YXIgaW5zaWRlUGFyZW5zID0gY2FsbC5zbGljZSgxLCAtMSk7XG5cbiAgdmFyIHJlZiA9IGN1cnJlbnRSZWZlcmVuY2U7XG4gIGxpbmsgPSBsaW5rLnJlcGxhY2UoJ35+aW5zaWRlUGFyZW5zfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZVBhcmVucykpO1xuICBjdXJyZW50UmVmZXJlbmNlID0gcmVmO1xuICByZXR1cm4gbGluaztcbn1cblxuLy8gSGFuZGxlcyBhIGJyYWNrZXRlZCBleHByZXNzaW9uIHRvIGJlIHBhcnNlZFxuZnVuY3Rpb24gcGFyc2VCcmFja2V0cyhsaW5rLCBpbmRleCwgZXhwcikge1xuICB2YXIgY2FsbCA9IGdldEZ1bmN0aW9uQ2FsbChleHByKTtcbiAgdmFyIGluc2lkZUJyYWNrZXRzID0gY2FsbC5zbGljZSgxLCAtMSk7XG4gIHZhciBldmFsZWRMaW5rID0gcGFyc2VQYXJ0KGxpbmssIGluZGV4KTtcbiAgaW5kZXggKz0gMTtcbiAgbGluayA9ICdbfn5pbnNpZGVCcmFja2V0c35+XSc7XG5cbiAgaWYgKGV4cHIuY2hhckF0KHByb3BlcnR5UmVnZXgubGFzdEluZGV4KSA9PT0gJy4nKSB7XG4gICAgbGluayA9IHBhcnNlUGFydChsaW5rLCBpbmRleCk7XG4gIH0gZWxzZSB7XG4gICAgbGluayA9ICdfcmVmJyArIGN1cnJlbnRSZWZlcmVuY2UgKyBsaW5rO1xuICB9XG5cbiAgbGluayA9IGV2YWxlZExpbmsgKyBsaW5rO1xuXG4gIHZhciByZWYgPSBjdXJyZW50UmVmZXJlbmNlO1xuICBsaW5rID0gbGluay5yZXBsYWNlKCd+fmluc2lkZUJyYWNrZXRzfn4nLCBwYXJzZVByb3BlcnR5Q2hhaW5zKGluc2lkZUJyYWNrZXRzKSk7XG4gIGN1cnJlbnRSZWZlcmVuY2UgPSByZWY7XG4gIHJldHVybiBsaW5rO1xufVxuXG5cbi8vIHJldHVybnMgdGhlIGNhbGwgcGFydCBvZiBhIGZ1bmN0aW9uIChlLmcuIGB0ZXN0KDEyMylgIHdvdWxkIHJldHVybiBgKDEyMylgKVxuZnVuY3Rpb24gZ2V0RnVuY3Rpb25DYWxsKGV4cHIpIHtcbiAgdmFyIHN0YXJ0SW5kZXggPSBwcm9wZXJ0eVJlZ2V4Lmxhc3RJbmRleDtcbiAgdmFyIG9wZW4gPSBleHByLmNoYXJBdChzdGFydEluZGV4IC0gMSk7XG4gIHZhciBjbG9zZSA9IHBhcmVuc1tvcGVuXTtcbiAgdmFyIGVuZEluZGV4ID0gc3RhcnRJbmRleCAtIDE7XG4gIHZhciBwYXJlbkNvdW50ID0gMTtcbiAgd2hpbGUgKGVuZEluZGV4KysgPCBleHByLmxlbmd0aCkge1xuICAgIHZhciBjaCA9IGV4cHIuY2hhckF0KGVuZEluZGV4KTtcbiAgICBpZiAoY2ggPT09IG9wZW4pIHBhcmVuQ291bnQrKztcbiAgICBlbHNlIGlmIChjaCA9PT0gY2xvc2UpIHBhcmVuQ291bnQtLTtcbiAgICBpZiAocGFyZW5Db3VudCA9PT0gMCkgYnJlYWs7XG4gIH1cbiAgY3VycmVudEluZGV4ID0gcHJvcGVydHlSZWdleC5sYXN0SW5kZXggPSBlbmRJbmRleCArIDE7XG4gIHJldHVybiBvcGVuICsgZXhwci5zbGljZShzdGFydEluZGV4LCBlbmRJbmRleCkgKyBjbG9zZTtcbn1cblxuXG5cbmZ1bmN0aW9uIHBhcnNlUGFydChwYXJ0LCBpbmRleCkge1xuICAvLyBpZiB0aGUgZmlyc3RcbiAgaWYgKGluZGV4ID09PSAwICYmICFjb250aW51YXRpb24pIHtcbiAgICBwYXJ0ID0gYWRkVGhpc09yR2xvYmFsKHBhcnQpO1xuICB9IGVsc2Uge1xuICAgIHBhcnQgPSAnX3JlZicgKyBjdXJyZW50UmVmZXJlbmNlICsgcGFydDtcbiAgfVxuXG4gIGN1cnJlbnRSZWZlcmVuY2UgPSArK3JlZmVyZW5jZUNvdW50O1xuICB2YXIgcmVmID0gJ19yZWYnICsgY3VycmVudFJlZmVyZW5jZTtcbiAgcmV0dXJuICcoJyArIHJlZiArICcgPSAnICsgcGFydCArICcpID09IG51bGwgPyB2b2lkIDAgOiAnO1xufVxuXG5cbmZ1bmN0aW9uIHJlcGxhY2VBbmRzQW5kT3JzKGV4cHIpIHtcbiAgcmV0dXJuIGV4cHIucmVwbGFjZShhbmRSZWdleCwgJyAmJiAnKS5yZXBsYWNlKG9yUmVnZXgsICcgfHwgJyk7XG59XG5cblxuLy8gUHJlcGVuZHMgcmVmZXJlbmNlIHZhcmlhYmxlIGRlZmluaXRpb25zXG5mdW5jdGlvbiBhZGRSZWZlcmVuY2VzKGV4cHIpIHtcbiAgaWYgKHJlZmVyZW5jZUNvdW50KSB7XG4gICAgdmFyIHJlZnMgPSBbXTtcbiAgICBmb3IgKHZhciBpID0gMTsgaSA8PSByZWZlcmVuY2VDb3VudDsgaSsrKSB7XG4gICAgICByZWZzLnB1c2goJ19yZWYnICsgaSk7XG4gICAgfVxuICAgIGV4cHIgPSAndmFyICcgKyByZWZzLmpvaW4oJywgJykgKyAnO1xcbicgKyBleHByO1xuICB9XG4gIHJldHVybiBleHByO1xufVxuIiwiLy8gZmluZHMgYWxsIHF1b3RlZCBzdHJpbmdzXG52YXIgcXVvdGVSZWdleCA9IC8oWydcIlxcL10pKFxcXFxcXDF8W15cXDFdKSo/XFwxL2c7XG5cbi8vIGZpbmRzIGFsbCBlbXB0eSBxdW90ZWQgc3RyaW5nc1xudmFyIGVtcHR5UXVvdGVFeHByID0gLyhbJ1wiXFwvXSlcXDEvZztcblxudmFyIHN0cmluZ3MgPSBudWxsO1xuXG5cbi8qKlxuICogUmVtb3ZlIHN0cmluZ3MgZnJvbSBhbiBleHByZXNzaW9uIGZvciBlYXNpZXIgcGFyc2luZy4gUmV0dXJucyBhIGxpc3Qgb2YgdGhlIHN0cmluZ3MgdG8gYWRkIGJhY2sgaW4gbGF0ZXIuXG4gKiBUaGlzIG1ldGhvZCBhY3R1YWxseSBsZWF2ZXMgdGhlIHN0cmluZyBxdW90ZSBtYXJrcyBidXQgZW1wdGllcyB0aGVtIG9mIHRoZWlyIGNvbnRlbnRzLiBUaGVuIHdoZW4gcmVwbGFjaW5nIHRoZW0gYWZ0ZXJcbiAqIHBhcnNpbmcgdGhlIGNvbnRlbnRzIGp1c3QgZ2V0IHB1dCBiYWNrIGludG8gdGhlaXIgcXVvdGVzIG1hcmtzLlxuICovXG5leHBvcnRzLnB1bGxPdXRTdHJpbmdzID0gZnVuY3Rpb24oZXhwcikge1xuICBpZiAoc3RyaW5ncykge1xuICAgIHRocm93IG5ldyBFcnJvcigncHV0SW5TdHJpbmdzIG11c3QgYmUgY2FsbGVkIGFmdGVyIHB1bGxPdXRTdHJpbmdzLicpO1xuICB9XG5cbiAgc3RyaW5ncyA9IFtdO1xuXG4gIHJldHVybiBleHByLnJlcGxhY2UocXVvdGVSZWdleCwgZnVuY3Rpb24oc3RyLCBxdW90ZSkge1xuICAgIHN0cmluZ3MucHVzaChzdHIpO1xuICAgIHJldHVybiBxdW90ZSArIHF1b3RlOyAvLyBwbGFjZWhvbGRlciBmb3IgdGhlIHN0cmluZ1xuICB9KTtcbn07XG5cblxuLyoqXG4gKiBSZXBsYWNlIHRoZSBzdHJpbmdzIHByZXZpb3VzbHkgcHVsbGVkIG91dCBhZnRlciBwYXJzaW5nIGlzIGZpbmlzaGVkLlxuICovXG5leHBvcnRzLnB1dEluU3RyaW5ncyA9IGZ1bmN0aW9uKGV4cHIpIHtcbiAgaWYgKCFzdHJpbmdzKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwdWxsT3V0U3RyaW5ncyBtdXN0IGJlIGNhbGxlZCBiZWZvcmUgcHV0SW5TdHJpbmdzLicpO1xuICB9XG5cbiAgZXhwciA9IGV4cHIucmVwbGFjZShlbXB0eVF1b3RlRXhwciwgZnVuY3Rpb24oKSB7XG4gICAgcmV0dXJuIHN0cmluZ3Muc2hpZnQoKTtcbiAgfSk7XG5cbiAgc3RyaW5ncyA9IG51bGw7XG5cbiAgcmV0dXJuIGV4cHI7XG59O1xuIiwidmFyIEZyYWdtZW50cyA9IHJlcXVpcmUoJy4vc3JjL2ZyYWdtZW50cycpO1xudmFyIE9ic2VydmF0aW9ucyA9IHJlcXVpcmUoJ29ic2VydmF0aW9ucy1qcycpO1xuXG5mdW5jdGlvbiBjcmVhdGUoKSB7XG4gIHZhciBvYnNlcnZhdGlvbnMgPSBPYnNlcnZhdGlvbnMuY3JlYXRlKCk7XG4gIHZhciBmcmFnbWVudHMgPSBuZXcgRnJhZ21lbnRzKG9ic2VydmF0aW9ucyk7XG4gIGZyYWdtZW50cy5zeW5jID0gb2JzZXJ2YXRpb25zLnN5bmMuYmluZChvYnNlcnZhdGlvbnMpO1xuICBmcmFnbWVudHMuc3luY05vdyA9IG9ic2VydmF0aW9ucy5zeW5jTm93LmJpbmQob2JzZXJ2YXRpb25zKTtcbiAgZnJhZ21lbnRzLmFmdGVyU3luYyA9IG9ic2VydmF0aW9ucy5hZnRlclN5bmMuYmluZChvYnNlcnZhdGlvbnMpO1xuICBmcmFnbWVudHMub25TeW5jID0gb2JzZXJ2YXRpb25zLm9uU3luYy5iaW5kKG9ic2VydmF0aW9ucyk7XG4gIGZyYWdtZW50cy5vZmZTeW5jID0gb2JzZXJ2YXRpb25zLm9mZlN5bmMuYmluZChvYnNlcnZhdGlvbnMpO1xuICByZXR1cm4gZnJhZ21lbnRzO1xufVxuXG4vLyBDcmVhdGUgYW4gaW5zdGFuY2Ugb2YgZnJhZ21lbnRzIHdpdGggdGhlIGRlZmF1bHQgb2JzZXJ2ZXJcbm1vZHVsZS5leHBvcnRzID0gY3JlYXRlKCk7XG5tb2R1bGUuZXhwb3J0cy5jcmVhdGUgPSBjcmVhdGU7XG4iLCJ2YXIgc2xpY2UgPSBBcnJheS5wcm90b3R5cGUuc2xpY2U7XG5cbi8qKlxuICogU2ltcGxpZmllcyBleHRlbmRpbmcgY2xhc3NlcyBhbmQgcHJvdmlkZXMgc3RhdGljIGluaGVyaXRhbmNlLiBDbGFzc2VzIHRoYXQgbmVlZCB0byBiZSBleHRlbmRhYmxlIHNob3VsZFxuICogZXh0ZW5kIENsYXNzIHdoaWNoIHdpbGwgZ2l2ZSB0aGVtIHRoZSBgZXh0ZW5kYCBzdGF0aWMgZnVuY3Rpb24gZm9yIHRoZWlyIHN1YmNsYXNzZXMgdG8gdXNlLiBJbiBhZGRpdGlvbiB0b1xuICogYSBwcm90b3R5cGUsIG1peGlucyBtYXkgYmUgYWRkZWQgYXMgd2VsbC4gRXhhbXBsZTpcbiAqXG4gKiBmdW5jdGlvbiBNeUNsYXNzKGFyZzEsIGFyZzIpIHtcbiAqICAgU3VwZXJDbGFzcy5jYWxsKHRoaXMsIGFyZzEpO1xuICogICB0aGlzLmFyZzIgPSBhcmcyO1xuICogfVxuICogU3VwZXJDbGFzcy5leHRlbmQoTXlDbGFzcywgbWl4aW4xLCBBbm90aGVyQ2xhc3MsIHtcbiAqICAgZm9vOiBmdW5jdGlvbigpIHtcbiAqICAgICB0aGlzLl9iYXIrKztcbiAqICAgfSxcbiAqICAgZ2V0IGJhcigpIHtcbiAqICAgICByZXR1cm4gdGhpcy5fYmFyO1xuICogICB9XG4gKiB9KTtcbiAqXG4gKiBJbiBhZGRpdGlvbiB0byBleHRlbmRpbmcgdGhlIHN1cGVyY2xhc3MsIHN0YXRpYyBtZXRob2RzIGFuZCBwcm9wZXJ0aWVzIHdpbGwgYmUgY29waWVkIG9udG8gdGhlIHN1YmNsYXNzIGZvclxuICogc3RhdGljIGluaGVyaXRhbmNlLiBUaGlzIGFsbG93cyB0aGUgZXh0ZW5kIGZ1bmN0aW9uIHRvIGJlIGNvcGllZCB0byB0aGUgc3ViY2xhc3Mgc28gdGhhdCBpdCBtYXkgYmVcbiAqIHN1YmNsYXNzZWQgYXMgd2VsbC4gQWRkaXRpb25hbGx5LCBzdGF0aWMgcHJvcGVydGllcyBtYXkgYmUgYWRkZWQgYnkgZGVmaW5pbmcgdGhlbSBvbiBhIHNwZWNpYWwgcHJvdG90eXBlXG4gKiBwcm9wZXJ0eSBgc3RhdGljYCBtYWtpbmcgdGhlIGNvZGUgbW9yZSByZWFkYWJsZS5cbiAqXG4gKiBAcGFyYW0ge2Z1bmN0aW9ufSBUaGUgc3ViY2xhc3MgY29uc3RydWN0b3IuXG4gKiBAcGFyYW0ge29iamVjdH0gW29wdGlvbmFsXSBaZXJvIG9yIG1vcmUgbWl4aW5zLiBUaGV5IGNhbiBiZSBvYmplY3RzIG9yIGNsYXNzZXMgKGZ1bmN0aW9ucykuXG4gKiBAcGFyYW0ge29iamVjdH0gVGhlIHByb3RvdHlwZSBvZiB0aGUgc3ViY2xhc3MuXG4gKi9cbmZ1bmN0aW9uIENsYXNzKCkge31cbkNsYXNzLmV4dGVuZCA9IGV4dGVuZDtcbkNsYXNzLm1ha2VJbnN0YW5jZU9mID0gbWFrZUluc3RhbmNlT2Y7XG5tb2R1bGUuZXhwb3J0cyA9IENsYXNzO1xuXG5mdW5jdGlvbiBleHRlbmQoU3ViY2xhc3MgLyogWywgcHJvdG90eXBlIFsscHJvdG90eXBlXV0gKi8pIHtcbiAgdmFyIHByb3RvdHlwZXM7XG5cbiAgLy8gU3VwcG9ydCBubyBjb25zdHJ1Y3RvclxuICBpZiAodHlwZW9mIFN1YmNsYXNzICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgcHJvdG90eXBlcyA9IHNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICB2YXIgU3VwZXJDbGFzcyA9IHRoaXM7XG4gICAgU3ViY2xhc3MgPSBmdW5jdGlvbigpIHtcbiAgICAgIFN1cGVyQ2xhc3MuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICB9O1xuICB9IGVsc2Uge1xuICAgIHByb3RvdHlwZXMgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gIH1cblxuICBleHRlbmRTdGF0aWNzKHRoaXMsIFN1YmNsYXNzKTtcblxuICBwcm90b3R5cGVzLmZvckVhY2goZnVuY3Rpb24ocHJvdG8pIHtcbiAgICBpZiAodHlwZW9mIHByb3RvID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBleHRlbmRTdGF0aWNzKHByb3RvLCBTdWJjbGFzcyk7XG4gICAgfSBlbHNlIGlmIChwcm90by5oYXNPd25Qcm9wZXJ0eSgnc3RhdGljJykpIHtcbiAgICAgIGV4dGVuZFN0YXRpY3MocHJvdG8uc3RhdGljLCBTdWJjbGFzcyk7XG4gICAgfVxuICB9KTtcblxuICB2YXIgZGVzY3JpcHRvcnMgPSBnZXREZXNjcmlwdG9ycyhwcm90b3R5cGVzKTtcbiAgZGVzY3JpcHRvcnMuY29uc3RydWN0b3IgPSB7IHdyaXRhYmxlOiB0cnVlLCBjb25maWd1cmFibGU6IHRydWUsIHZhbHVlOiBTdWJjbGFzcyB9O1xuICBTdWJjbGFzcy5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKHRoaXMucHJvdG90eXBlLCBkZXNjcmlwdG9ycyk7XG4gIHJldHVybiBTdWJjbGFzcztcbn1cblxuLy8gR2V0IGRlc2NyaXB0b3JzIChhbGxvd3MgZm9yIGdldHRlcnMgYW5kIHNldHRlcnMpIGFuZCBzZXRzIGZ1bmN0aW9ucyB0byBiZSBub24tZW51bWVyYWJsZVxuZnVuY3Rpb24gZ2V0RGVzY3JpcHRvcnMob2JqZWN0cykge1xuICB2YXIgZGVzY3JpcHRvcnMgPSB7fTtcblxuICBvYmplY3RzLmZvckVhY2goZnVuY3Rpb24ob2JqZWN0KSB7XG4gICAgaWYgKHR5cGVvZiBvYmplY3QgPT09ICdmdW5jdGlvbicpIG9iamVjdCA9IG9iamVjdC5wcm90b3R5cGU7XG5cbiAgICBPYmplY3QuZ2V0T3duUHJvcGVydHlOYW1lcyhvYmplY3QpLmZvckVhY2goZnVuY3Rpb24obmFtZSkge1xuICAgICAgaWYgKG5hbWUgPT09ICdzdGF0aWMnKSByZXR1cm47XG5cbiAgICAgIHZhciBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihvYmplY3QsIG5hbWUpO1xuXG4gICAgICBpZiAodHlwZW9mIGRlc2NyaXB0b3IudmFsdWUgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgICAgZGVzY3JpcHRvci5lbnVtZXJhYmxlID0gZmFsc2U7XG4gICAgICB9XG5cbiAgICAgIGRlc2NyaXB0b3JzW25hbWVdID0gZGVzY3JpcHRvcjtcbiAgICB9KTtcbiAgfSk7XG4gIHJldHVybiBkZXNjcmlwdG9ycztcbn1cblxuLy8gQ29waWVzIHN0YXRpYyBtZXRob2RzIG92ZXIgZm9yIHN0YXRpYyBpbmhlcml0YW5jZVxuZnVuY3Rpb24gZXh0ZW5kU3RhdGljcyhDbGFzcywgU3ViY2xhc3MpIHtcblxuICAvLyBzdGF0aWMgbWV0aG9kIGluaGVyaXRhbmNlIChpbmNsdWRpbmcgYGV4dGVuZGApXG4gIE9iamVjdC5rZXlzKENsYXNzKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgIHZhciBkZXNjcmlwdG9yID0gT2JqZWN0LmdldE93blByb3BlcnR5RGVzY3JpcHRvcihDbGFzcywga2V5KTtcbiAgICBpZiAoIWRlc2NyaXB0b3IuY29uZmlndXJhYmxlKSByZXR1cm47XG5cbiAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkoU3ViY2xhc3MsIGtleSwgZGVzY3JpcHRvcik7XG4gIH0pO1xufVxuXG5cbi8qKlxuICogTWFrZXMgYSBuYXRpdmUgb2JqZWN0IHByZXRlbmQgdG8gYmUgYW4gaW5zdGFuY2Ugb2YgY2xhc3MgKGUuZy4gYWRkcyBtZXRob2RzIHRvIGEgRG9jdW1lbnRGcmFnbWVudCB0aGVuIGNhbGxzIHRoZVxuICogY29uc3RydWN0b3IpLlxuICovXG5mdW5jdGlvbiBtYWtlSW5zdGFuY2VPZihvYmplY3QpIHtcbiAgdmFyIGFyZ3MgPSBzbGljZS5jYWxsKGFyZ3VtZW50cywgMSk7XG4gIE9iamVjdC5kZWZpbmVQcm9wZXJ0aWVzKG9iamVjdCwgZ2V0RGVzY3JpcHRvcnMoW3RoaXMucHJvdG90eXBlXSkpO1xuICB0aGlzLmFwcGx5KG9iamVjdCwgYXJncyk7XG4gIHJldHVybiBvYmplY3Q7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEFuaW1hdGVkQmluZGluZztcbnZhciBhbmltYXRpb24gPSByZXF1aXJlKCcuL3V0aWwvYW5pbWF0aW9uJyk7XG52YXIgQmluZGluZyA9IHJlcXVpcmUoJy4vYmluZGluZycpO1xudmFyIF9zdXBlciA9IEJpbmRpbmcucHJvdG90eXBlO1xuXG4vKipcbiAqIEJpbmRpbmdzIHdoaWNoIGV4dGVuZCBBbmltYXRlZEJpbmRpbmcgaGF2ZSB0aGUgYWJpbGl0eSB0byBhbmltYXRlIGVsZW1lbnRzIHRoYXQgYXJlIGFkZGVkIHRvIHRoZSBET00gYW5kIHJlbW92ZWQgZnJvbVxuICogdGhlIERPTS4gVGhpcyBhbGxvd3MgbWVudXMgdG8gc2xpZGUgb3BlbiBhbmQgY2xvc2VkLCBlbGVtZW50cyB0byBmYWRlIGluIG9yIGRyb3AgZG93biwgYW5kIHJlcGVhdGVkIGl0ZW1zIHRvIGFwcGVhclxuICogdG8gbW92ZSAoaWYgeW91IGdldCBjcmVhdGl2ZSBlbm91Z2gpLlxuICpcbiAqIFRoZSBmb2xsb3dpbmcgNSBtZXRob2RzIGFyZSBoZWxwZXIgRE9NIG1ldGhvZHMgdGhhdCBhbGxvdyByZWdpc3RlcmVkIGJpbmRpbmdzIHRvIHdvcmsgd2l0aCBDU1MgdHJhbnNpdGlvbnMgZm9yXG4gKiBhbmltYXRpbmcgZWxlbWVudHMuIElmIGFuIGVsZW1lbnQgaGFzIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIG9yIGEgbWF0Y2hpbmcgSmF2YVNjcmlwdCBtZXRob2QsIHRoZXNlIGhlbHBlciBtZXRob2RzXG4gKiB3aWxsIHNldCBhIGNsYXNzIG9uIHRoZSBub2RlIHRvIHRyaWdnZXIgdGhlIGFuaW1hdGlvbiBhbmQvb3IgY2FsbCB0aGUgSmF2YVNjcmlwdCBtZXRob2RzIHRvIGhhbmRsZSBpdC5cbiAqXG4gKiBBbiBhbmltYXRpb24gbWF5IGJlIGVpdGhlciBhIENTUyB0cmFuc2l0aW9uLCBhIENTUyBhbmltYXRpb24sIG9yIGEgc2V0IG9mIEphdmFTY3JpcHQgbWV0aG9kcyB0aGF0IHdpbGwgYmUgY2FsbGVkLlxuICpcbiAqIElmIHVzaW5nIENTUywgY2xhc3NlcyBhcmUgYWRkZWQgYW5kIHJlbW92ZWQgZnJvbSB0aGUgZWxlbWVudC4gV2hlbiBhbiBlbGVtZW50IGlzIGluc2VydGVkIGl0IHdpbGwgcmVjZWl2ZSB0aGUgYHdpbGwtXG4gKiBhbmltYXRlLWluYCBjbGFzcyBiZWZvcmUgYmVpbmcgYWRkZWQgdG8gdGhlIERPTSwgdGhlbiBpdCB3aWxsIHJlY2VpdmUgdGhlIGBhbmltYXRlLWluYCBjbGFzcyBpbW1lZGlhdGVseSBhZnRlciBiZWluZ1xuICogYWRkZWQgdG8gdGhlIERPTSwgdGhlbiBib3RoIGNsYXNlcyB3aWxsIGJlIHJlbW92ZWQgYWZ0ZXIgdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS4gV2hlbiBhbiBlbGVtZW50IGlzIGJlaW5nIHJlbW92ZWRcbiAqIGZyb20gdGhlIERPTSBpdCB3aWxsIHJlY2VpdmUgdGhlIGB3aWxsLWFuaW1hdGUtb3V0YCBhbmQgYGFuaW1hdGUtb3V0YCBjbGFzc2VzLCB0aGVuIHRoZSBjbGFzc2VzIHdpbGwgYmUgcmVtb3ZlZCBvbmNlXG4gKiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlLlxuICpcbiAqIElmIHVzaW5nIEphdmFTY3JpcHQsIG1ldGhvZHMgbXVzdCBiZSBkZWZpbmVkICB0byBhbmltYXRlIHRoZSBlbGVtZW50IHRoZXJlIGFyZSAzIHN1cHBvcnRlZCBtZXRob2RzIHdoaWNoIGNhbiBiXG4gKlxuICogVE9ETyBjYWNoZSBieSBjbGFzcy1uYW1lIChBbmd1bGFyKT8gT25seSBzdXBwb3J0IGphdmFzY3JpcHQtc3R5bGUgKEVtYmVyKT8gQWRkIGEgYHdpbGwtYW5pbWF0ZS1pbmAgYW5kXG4gKiBgZGlkLWFuaW1hdGUtaW5gIGV0Yy4/XG4gKiBJRiBoYXMgYW55IGNsYXNzZXMsIGFkZCB0aGUgYHdpbGwtYW5pbWF0ZS1pbnxvdXRgIGFuZCBnZXQgY29tcHV0ZWQgZHVyYXRpb24uIElmIG5vbmUsIHJldHVybi4gQ2FjaGUuXG4gKiBSVUxFIGlzIHVzZSB1bmlxdWUgY2xhc3MgdG8gZGVmaW5lIGFuIGFuaW1hdGlvbi4gT3IgYXR0cmlidXRlIGBhbmltYXRlPVwiZmFkZVwiYCB3aWxsIGFkZCB0aGUgY2xhc3M/XG4gKiBgLmZhZGUud2lsbC1hbmltYXRlLWluYCwgYC5mYWRlLmFuaW1hdGUtaW5gLCBgLmZhZGUud2lsbC1hbmltYXRlLW91dGAsIGAuZmFkZS5hbmltYXRlLW91dGBcbiAqXG4gKiBFdmVudHMgd2lsbCBiZSB0cmlnZ2VyZWQgb24gdGhlIGVsZW1lbnRzIG5hbWVkIHRoZSBzYW1lIGFzIHRoZSBjbGFzcyBuYW1lcyAoZS5nLiBgYW5pbWF0ZS1pbmApIHdoaWNoIG1heSBiZSBsaXN0ZW5lZFxuICogdG8gaW4gb3JkZXIgdG8gY2FuY2VsIGFuIGFuaW1hdGlvbiBvciByZXNwb25kIHRvIGl0LlxuICpcbiAqIElmIHRoZSBub2RlIGhhcyBtZXRob2RzIGBhbmltYXRlSW4oZG9uZSlgLCBgYW5pbWF0ZU91dChkb25lKWAsIGBhbmltYXRlTW92ZUluKGRvbmUpYCwgb3IgYGFuaW1hdGVNb3ZlT3V0KGRvbmUpYFxuICogZGVmaW5lZCBvbiB0aGVtIHRoZW4gdGhlIGhlbHBlcnMgd2lsbCBhbGxvdyBhbiBhbmltYXRpb24gaW4gSmF2YVNjcmlwdCB0byBiZSBydW4gYW5kIHdhaXQgZm9yIHRoZSBgZG9uZWAgZnVuY3Rpb24gdG9cbiAqIGJlIGNhbGxlZCB0byBrbm93IHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBjb21wbGV0ZS5cbiAqXG4gKiBCZSBzdXJlIHRvIGFjdHVhbGx5IGhhdmUgYW4gYW5pbWF0aW9uIGRlZmluZWQgZm9yIGVsZW1lbnRzIHdpdGggdGhlIGBhbmltYXRlYCBjbGFzcy9hdHRyaWJ1dGUgYmVjYXVzZSB0aGUgaGVscGVycyB1c2VcbiAqIHRoZSBgdHJhbnNpdGlvbmVuZGAgYW5kIGBhbmltYXRpb25lbmRgIGV2ZW50cyB0byBrbm93IHdoZW4gdGhlIGFuaW1hdGlvbiBpcyBmaW5pc2hlZCwgYW5kIGlmIHRoZXJlIGlzIG5vIGFuaW1hdGlvblxuICogdGhlc2UgZXZlbnRzIHdpbGwgbmV2ZXIgYmUgdHJpZ2dlcmVkIGFuZCB0aGUgb3BlcmF0aW9uIHdpbGwgbmV2ZXIgY29tcGxldGUuXG4gKi9cbmZ1bmN0aW9uIEFuaW1hdGVkQmluZGluZyhwcm9wZXJ0aWVzKSB7XG4gIHZhciBlbGVtZW50ID0gcHJvcGVydGllcy5ub2RlO1xuICB2YXIgYW5pbWF0ZSA9IGVsZW1lbnQuZ2V0QXR0cmlidXRlKHByb3BlcnRpZXMuZnJhZ21lbnRzLmFuaW1hdGVBdHRyaWJ1dGUpO1xuICB2YXIgZnJhZ21lbnRzID0gcHJvcGVydGllcy5mcmFnbWVudHM7XG5cbiAgaWYgKGFuaW1hdGUgIT09IG51bGwpIHtcbiAgICBpZiAoZWxlbWVudC5ub2RlTmFtZSA9PT0gJ1RFTVBMQVRFJyB8fCBlbGVtZW50Lm5vZGVOYW1lID09PSAnU0NSSVBUJykge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdDYW5ub3QgYW5pbWF0ZSBtdWx0aXBsZSBub2RlcyBpbiBhIHRlbXBsYXRlIG9yIHNjcmlwdC4gUmVtb3ZlIHRoZSBbYW5pbWF0ZV0gYXR0cmlidXRlLicpO1xuICAgIH1cblxuICAgIHNldFRpbWVvdXQoZnVuY3Rpb24oKSB7XG4gICAgICAvLyBBbGxvdyBtdWx0aXBsZSBiaW5kaW5ncyB0byBhbmltYXRlIGJ5IG5vdCByZW1vdmluZyB1bnRpbCB0aGV5IGhhdmUgYWxsIGJlZW4gY3JlYXRlZFxuICAgICAgZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUocHJvcGVydGllcy5mcmFnbWVudHMuYW5pbWF0ZUF0dHJpYnV0ZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmFuaW1hdGUgPSB0cnVlO1xuXG4gICAgaWYgKGZyYWdtZW50cy5pc0JvdW5kKCdhdHRyaWJ1dGUnLCBhbmltYXRlKSkge1xuICAgICAgLy8gamF2YXNjcmlwdCBhbmltYXRpb25cbiAgICAgIHRoaXMuYW5pbWF0ZUV4cHJlc3Npb24gPSBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgYW5pbWF0ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGlmIChhbmltYXRlWzBdID09PSAnLicpIHtcbiAgICAgICAgLy8gY2xhc3MgYW5pbWF0aW9uXG4gICAgICAgIHRoaXMuYW5pbWF0ZUNsYXNzTmFtZSA9IGFuaW1hdGUuc2xpY2UoMSk7XG4gICAgICB9IGVsc2UgaWYgKGFuaW1hdGUpIHtcbiAgICAgICAgLy8gcmVnaXN0ZXJlZCBhbmltYXRpb25cbiAgICAgICAgdmFyIGFuaW1hdGVPYmplY3QgPSBmcmFnbWVudHMuZ2V0QW5pbWF0aW9uKGFuaW1hdGUpO1xuICAgICAgICBpZiAodHlwZW9mIGFuaW1hdGVPYmplY3QgPT09ICdmdW5jdGlvbicpIGFuaW1hdGVPYmplY3QgPSBuZXcgYW5pbWF0ZU9iamVjdCh0aGlzKTtcbiAgICAgICAgdGhpcy5hbmltYXRlT2JqZWN0ID0gYW5pbWF0ZU9iamVjdDtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICBCaW5kaW5nLmNhbGwodGhpcywgcHJvcGVydGllcyk7XG59XG5cblxuQmluZGluZy5leHRlbmQoQW5pbWF0ZWRCaW5kaW5nLCB7XG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIF9zdXBlci5pbml0LmNhbGwodGhpcyk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlRXhwcmVzc2lvbikge1xuICAgICAgdGhpcy5hbmltYXRlT2JzZXJ2ZXIgPSBuZXcgdGhpcy5PYnNlcnZlcih0aGlzLmFuaW1hdGVFeHByZXNzaW9uLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgICAgICB0aGlzLmFuaW1hdGVPYmplY3QgPSB2YWx1ZTtcbiAgICAgIH0sIHRoaXMpO1xuICAgIH1cbiAgfSxcblxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIF9zdXBlci5iaW5kLmNhbGwodGhpcywgY29udGV4dCk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgfVxuICB9LFxuXG4gIHVuYmluZDogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PT0gbnVsbCkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBfc3VwZXIudW5iaW5kLmNhbGwodGhpcyk7XG5cbiAgICBpZiAodGhpcy5hbmltYXRlT2JzZXJ2ZXIpIHtcbiAgICAgIHRoaXMuYW5pbWF0ZU9ic2VydmVyLnVuYmluZCgpO1xuICAgIH1cbiAgfSxcblxuICAvKipcbiAgICogSGVscGVyIG1ldGhvZCB0byByZW1vdmUgYSBub2RlIGZyb20gdGhlIERPTSwgYWxsb3dpbmcgZm9yIGFuaW1hdGlvbnMgdG8gb2NjdXIuIGBjYWxsYmFja2Agd2lsbCBiZSBjYWxsZWQgd2hlblxuICAgKiBmaW5pc2hlZC5cbiAgICovXG4gIGFuaW1hdGVPdXQ6IGZ1bmN0aW9uKG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgaWYgKG5vZGUuZmlyc3RWaWV3Tm9kZSkgbm9kZSA9IG5vZGUuZmlyc3RWaWV3Tm9kZTtcblxuICAgIHRoaXMuYW5pbWF0ZU5vZGUoJ291dCcsIG5vZGUsIGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKGNhbGxiYWNrKSBjYWxsYmFjay5jYWxsKHRoaXMpO1xuICAgIH0pO1xuICB9LFxuXG4gIC8qKlxuICAgKiBIZWxwZXIgbWV0aG9kIHRvIGluc2VydCBhIG5vZGUgaW4gdGhlIERPTSBiZWZvcmUgYW5vdGhlciBub2RlLCBhbGxvd2luZyBmb3IgYW5pbWF0aW9ucyB0byBvY2N1ci4gYGNhbGxiYWNrYCB3aWxsXG4gICAqIGJlIGNhbGxlZCB3aGVuIGZpbmlzaGVkLiBJZiBgYmVmb3JlYCBpcyBub3QgcHJvdmlkZWQgdGhlbiB0aGUgYW5pbWF0aW9uIHdpbGwgYmUgcnVuIHdpdGhvdXQgaW5zZXJ0aW5nIHRoZSBub2RlLlxuICAgKi9cbiAgYW5pbWF0ZUluOiBmdW5jdGlvbihub2RlLCBjYWxsYmFjaykge1xuICAgIGlmIChub2RlLmZpcnN0Vmlld05vZGUpIG5vZGUgPSBub2RlLmZpcnN0Vmlld05vZGU7XG4gICAgdGhpcy5hbmltYXRlTm9kZSgnaW4nLCBub2RlLCBjYWxsYmFjaywgdGhpcyk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIEFsbG93IGFuIGVsZW1lbnQgdG8gdXNlIENTUzMgdHJhbnNpdGlvbnMgb3IgYW5pbWF0aW9ucyB0byBhbmltYXRlIGluIG9yIG91dCBvZiB0aGUgcGFnZS5cbiAgICovXG4gIGFuaW1hdGVOb2RlOiBmdW5jdGlvbihkaXJlY3Rpb24sIG5vZGUsIGNhbGxiYWNrKSB7XG4gICAgdmFyIGFuaW1hdGVPYmplY3QsIGNsYXNzTmFtZSwgY2xhc3NBbmltYXRlTmFtZSwgY2xhc3NXaWxsTmFtZSxcbiAgICAgICAgbWV0aG9kQW5pbWF0ZU5hbWUsIG1ldGhvZFdpbGxOYW1lLCBtZXRob2REaWROYW1lLCBkaXIsIF90aGlzID0gdGhpcztcblxuICAgIGlmICh0aGlzLmFuaW1hdGVPYmplY3QgJiYgdHlwZW9mIHRoaXMuYW5pbWF0ZU9iamVjdCA9PT0gJ29iamVjdCcpIHtcbiAgICAgIGFuaW1hdGVPYmplY3QgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfSBlbHNlIGlmICh0aGlzLmFuaW1hdGVDbGFzc05hbWUpIHtcbiAgICAgIGNsYXNzTmFtZSA9IHRoaXMuYW5pbWF0ZUNsYXNzTmFtZTtcbiAgICB9IGVsc2UgaWYgKHR5cGVvZiB0aGlzLmFuaW1hdGVPYmplY3QgPT09ICdzdHJpbmcnKSB7XG4gICAgICBjbGFzc05hbWUgPSB0aGlzLmFuaW1hdGVPYmplY3Q7XG4gICAgfVxuXG4gICAgY2xhc3NBbmltYXRlTmFtZSA9ICdhbmltYXRlLScgKyBkaXJlY3Rpb247XG4gICAgY2xhc3NXaWxsTmFtZSA9ICd3aWxsLWFuaW1hdGUtJyArIGRpcmVjdGlvbjtcbiAgICBkaXIgPSBkaXJlY3Rpb24gPT09ICdpbicgPyAnSW4nIDogJ091dCc7XG4gICAgbWV0aG9kQW5pbWF0ZU5hbWUgPSAnYW5pbWF0ZScgKyBkaXI7XG4gICAgbWV0aG9kV2lsbE5hbWUgPSAnd2lsbEFuaW1hdGUnICsgZGlyO1xuICAgIG1ldGhvZERpZE5hbWUgPSAnZGlkQW5pbWF0ZScgKyBkaXI7XG5cbiAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5hZGQoY2xhc3NOYW1lKTtcbiAgICBub2RlLmNsYXNzTGlzdC5hZGQoY2xhc3NXaWxsTmFtZSk7XG5cbiAgICBpZiAoYW5pbWF0ZU9iamVjdCkge1xuICAgICAgYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZShub2RlKTtcbiAgICAgIGlmIChhbmltYXRlT2JqZWN0W21ldGhvZFdpbGxOYW1lXSkge1xuICAgICAgICBhbmltYXRlT2JqZWN0W21ldGhvZFdpbGxOYW1lXShub2RlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyB0cmlnZ2VyIHJlZmxvd1xuICAgIG5vZGUub2Zmc2V0V2lkdGggPSBub2RlLm9mZnNldFdpZHRoO1xuXG4gICAgbm9kZS5jbGFzc0xpc3QuYWRkKGNsYXNzQW5pbWF0ZU5hbWUpO1xuICAgIG5vZGUuY2xhc3NMaXN0LnJlbW92ZShjbGFzc1dpbGxOYW1lKTtcblxuICAgIHZhciB3aGVuRG9uZSA9IGZ1bmN0aW9uKCkge1xuICAgICAgaWYgKGFuaW1hdGVPYmplY3QgJiYgYW5pbWF0ZU9iamVjdFttZXRob2REaWROYW1lXSkgYW5pbWF0ZU9iamVjdFttZXRob2REaWROYW1lXShub2RlKTtcbiAgICAgIGlmIChjYWxsYmFjaykgY2FsbGJhY2suY2FsbChfdGhpcyk7XG4gICAgICBub2RlLmNsYXNzTGlzdC5yZW1vdmUoY2xhc3NBbmltYXRlTmFtZSk7XG4gICAgICBpZiAoY2xhc3NOYW1lKSBub2RlLmNsYXNzTGlzdC5yZW1vdmUoY2xhc3NOYW1lKTtcbiAgICB9O1xuXG4gICAgaWYgKGFuaW1hdGVPYmplY3QgJiYgYW5pbWF0ZU9iamVjdFttZXRob2RBbmltYXRlTmFtZV0pIHtcbiAgICAgIGFuaW1hdGVPYmplY3RbbWV0aG9kQW5pbWF0ZU5hbWVdKG5vZGUsIHdoZW5Eb25lKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIGR1cmF0aW9uID0gZ2V0RHVyYXRpb24uY2FsbCh0aGlzLCBub2RlLCBkaXJlY3Rpb24pO1xuICAgICAgaWYgKGR1cmF0aW9uKSB7XG4gICAgICAgIG9uQW5pbWF0aW9uRW5kKG5vZGUsIGR1cmF0aW9uLCB3aGVuRG9uZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB3aGVuRG9uZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxufSk7XG5cblxudmFyIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSAndHJhbnNpdGlvbkR1cmF0aW9uJztcbnZhciB0cmFuc2l0aW9uRGVsYXlOYW1lID0gJ3RyYW5zaXRpb25EZWxheSc7XG52YXIgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gJ2FuaW1hdGlvbkR1cmF0aW9uJztcbnZhciBhbmltYXRpb25EZWxheU5hbWUgPSAnYW5pbWF0aW9uRGVsYXknO1xudmFyIHRyYW5zaXRpb25FdmVudE5hbWUgPSAndHJhbnNpdGlvbmVuZCc7XG52YXIgYW5pbWF0aW9uRXZlbnROYW1lID0gJ2FuaW1hdGlvbmVuZCc7XG52YXIgc3R5bGUgPSBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc3R5bGU7XG5cblsnd2Via2l0JywgJ21veicsICdtcycsICdvJ10uZm9yRWFjaChmdW5jdGlvbihwcmVmaXgpIHtcbiAgaWYgKHN0eWxlLnRyYW5zaXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlW3ByZWZpeCArICdUcmFuc2l0aW9uRHVyYXRpb24nXSkge1xuICAgIHRyYW5zaXRpb25EdXJhdGlvbk5hbWUgPSBwcmVmaXggKyAnVHJhbnNpdGlvbkR1cmF0aW9uJztcbiAgICB0cmFuc2l0aW9uRGVsYXlOYW1lID0gcHJlZml4ICsgJ1RyYW5zaXRpb25EZWxheSc7XG4gICAgdHJhbnNpdGlvbkV2ZW50TmFtZSA9IHByZWZpeCArICd0cmFuc2l0aW9uZW5kJztcbiAgfVxuXG4gIGlmIChzdHlsZS5hbmltYXRpb25EdXJhdGlvbiA9PT0gdW5kZWZpbmVkICYmIHN0eWxlW3ByZWZpeCArICdBbmltYXRpb25EdXJhdGlvbiddKSB7XG4gICAgYW5pbWF0aW9uRHVyYXRpb25OYW1lID0gcHJlZml4ICsgJ0FuaW1hdGlvbkR1cmF0aW9uJztcbiAgICBhbmltYXRpb25EZWxheU5hbWUgPSBwcmVmaXggKyAnQW5pbWF0aW9uRGVsYXknO1xuICAgIGFuaW1hdGlvbkV2ZW50TmFtZSA9IHByZWZpeCArICdhbmltYXRpb25lbmQnO1xuICB9XG59KTtcblxuXG5mdW5jdGlvbiBnZXREdXJhdGlvbihub2RlLCBkaXJlY3Rpb24pIHtcbiAgdmFyIG1pbGxpc2Vjb25kcyA9IHRoaXMuY2xvbmVkRnJvbVsnX19hbmltYXRpb25EdXJhdGlvbicgKyBkaXJlY3Rpb25dO1xuICBpZiAoIW1pbGxpc2Vjb25kcykge1xuICAgIC8vIFJlY2FsYyBpZiBub2RlIHdhcyBvdXQgb2YgRE9NIGJlZm9yZSBhbmQgaGFkIDAgZHVyYXRpb24sIGFzc3VtZSB0aGVyZSBpcyBhbHdheXMgU09NRSBkdXJhdGlvbi5cbiAgICB2YXIgc3R5bGVzID0gd2luZG93LmdldENvbXB1dGVkU3R5bGUobm9kZSk7XG4gICAgdmFyIHNlY29uZHMgPSBNYXRoLm1heChwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRHVyYXRpb25OYW1lXSB8fCAwKSArXG4gICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJzZUZsb2F0KHN0eWxlc1t0cmFuc2l0aW9uRGVsYXlOYW1lXSB8fCAwKSxcbiAgICAgICAgICAgICAgICAgICAgICAgICAgIHBhcnNlRmxvYXQoc3R5bGVzW2FuaW1hdGlvbkR1cmF0aW9uTmFtZV0gfHwgMCkgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyc2VGbG9hdChzdHlsZXNbYW5pbWF0aW9uRGVsYXlOYW1lXSB8fCAwKSk7XG4gICAgbWlsbGlzZWNvbmRzID0gc2Vjb25kcyAqIDEwMDAgfHwgMDtcbiAgICB0aGlzLmNsb25lZEZyb20uX19hbmltYXRpb25EdXJhdGlvbl9fID0gbWlsbGlzZWNvbmRzO1xuICB9XG4gIHJldHVybiBtaWxsaXNlY29uZHM7XG59XG5cblxuZnVuY3Rpb24gb25BbmltYXRpb25FbmQobm9kZSwgZHVyYXRpb24sIGNhbGxiYWNrKSB7XG4gIHZhciBvbkVuZCA9IGZ1bmN0aW9uKCkge1xuICAgIG5vZGUucmVtb3ZlRXZlbnRMaXN0ZW5lcih0cmFuc2l0aW9uRXZlbnROYW1lLCBvbkVuZCk7XG4gICAgbm9kZS5yZW1vdmVFdmVudExpc3RlbmVyKGFuaW1hdGlvbkV2ZW50TmFtZSwgb25FbmQpO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICBjYWxsYmFjaygpO1xuICB9O1xuXG4gIC8vIGNvbnRpbmdlbmN5IHBsYW5cbiAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KG9uRW5kLCBkdXJhdGlvbiArIDEwKTtcblxuICBub2RlLmFkZEV2ZW50TGlzdGVuZXIodHJhbnNpdGlvbkV2ZW50TmFtZSwgb25FbmQpO1xuICBub2RlLmFkZEV2ZW50TGlzdGVuZXIoYW5pbWF0aW9uRXZlbnROYW1lLCBvbkVuZCk7XG59IiwibW9kdWxlLmV4cG9ydHMgPSBCaW5kaW5nO1xudmFyIENsYXNzID0gcmVxdWlyZSgnY2hpcC11dGlscy9jbGFzcycpO1xuXG4vKipcbiAqIEEgYmluZGluZyBpcyBhIGxpbmsgYmV0d2VlbiBhbiBlbGVtZW50IGFuZCBzb21lIGRhdGEuIFN1YmNsYXNzZXMgb2YgQmluZGluZyBjYWxsZWQgYmluZGVycyBkZWZpbmUgd2hhdCBhIGJpbmRpbmcgZG9lc1xuICogd2l0aCB0aGF0IGxpbmsuIEluc3RhbmNlcyBvZiB0aGVzZSBiaW5kZXJzIGFyZSBjcmVhdGVkIGFzIGJpbmRpbmdzIG9uIHRlbXBsYXRlcy4gV2hlbiBhIHZpZXcgaXMgc3RhbXBlZCBvdXQgZnJvbSB0aGVcbiAqIHRlbXBsYXRlIHRoZSBiaW5kaW5nIGlzIFwiY2xvbmVkXCIgKGl0IGlzIGFjdHVhbGx5IGV4dGVuZGVkIGZvciBwZXJmb3JtYW5jZSkgYW5kIHRoZSBgZWxlbWVudGAvYG5vZGVgIHByb3BlcnR5IGlzXG4gKiB1cGRhdGVkIHRvIHRoZSBtYXRjaGluZyBlbGVtZW50IGluIHRoZSB2aWV3LlxuICpcbiAqICMjIyBQcm9wZXJ0aWVzXG4gKiAgKiBlbGVtZW50OiBUaGUgZWxlbWVudCAob3IgdGV4dCBub2RlKSB0aGlzIGJpbmRpbmcgaXMgYm91bmQgdG9cbiAqICAqIG5vZGU6IEFsaWFzIG9mIGVsZW1lbnQsIHNpbmNlIGJpbmRpbmdzIG1heSBhcHBseSB0byB0ZXh0IG5vZGVzIHRoaXMgaXMgbW9yZSBhY2N1cmF0ZVxuICogICogbmFtZTogVGhlIGF0dHJpYnV0ZSBvciBlbGVtZW50IG5hbWUgKGRvZXMgbm90IGFwcGx5IHRvIG1hdGNoZWQgdGV4dCBub2RlcylcbiAqICAqIG1hdGNoOiBUaGUgbWF0Y2hlZCBwYXJ0IG9mIHRoZSBuYW1lIGZvciB3aWxkY2FyZCBhdHRyaWJ1dGVzIChlLmcuIGBvbi0qYCBtYXRjaGluZyBhZ2FpbnN0IGBvbi1jbGlja2Agd291bGQgaGF2ZSBhXG4gKiAgICBtYXRjaCBwcm9wZXJ0eSBlcXVhbGxpbmcgYGNsaWNrYCkuIFVzZSBgdGhpcy5jYW1lbENhc2VgIHRvIGdldCB0aGUgbWF0Y2ggcHJvZXJ0eSBjYW1lbENhc2VkLlxuICogICogZXhwcmVzc2lvbjogVGhlIGV4cHJlc3Npb24gdGhpcyBiaW5kaW5nIHdpbGwgdXNlIGZvciBpdHMgdXBkYXRlcyAoZG9lcyBub3QgYXBwbHkgdG8gbWF0Y2hlZCBlbGVtZW50cylcbiAqICAqIGNvbnRleHQ6IFRoZSBjb250ZXh0IHRoZSBleHJlc3Npb24gb3BlcmF0ZXMgd2l0aGluIHdoZW4gYm91bmRcbiAqL1xuZnVuY3Rpb24gQmluZGluZyhwcm9wZXJ0aWVzKSB7XG4gIGlmICghcHJvcGVydGllcy5ub2RlIHx8ICFwcm9wZXJ0aWVzLnZpZXcpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBIGJpbmRpbmcgbXVzdCByZWNlaXZlIGEgbm9kZSBhbmQgYSB2aWV3Jyk7XG4gIH1cblxuICAvLyBlbGVtZW50IGFuZCBub2RlIGFyZSBhbGlhc2VzXG4gIHRoaXMuX2VsZW1lbnRQYXRoID0gaW5pdE5vZGVQYXRoKHByb3BlcnRpZXMubm9kZSwgcHJvcGVydGllcy52aWV3KTtcbiAgdGhpcy5ub2RlID0gcHJvcGVydGllcy5ub2RlO1xuICB0aGlzLmVsZW1lbnQgPSBwcm9wZXJ0aWVzLm5vZGU7XG4gIHRoaXMubmFtZSA9IHByb3BlcnRpZXMubmFtZTtcbiAgdGhpcy5tYXRjaCA9IHByb3BlcnRpZXMubWF0Y2g7XG4gIHRoaXMuZXhwcmVzc2lvbiA9IHByb3BlcnRpZXMuZXhwcmVzc2lvbjtcbiAgdGhpcy5mcmFnbWVudHMgPSBwcm9wZXJ0aWVzLmZyYWdtZW50cztcbiAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbn1cblxuQ2xhc3MuZXh0ZW5kKEJpbmRpbmcsIHtcbiAgLyoqXG4gICAqIERlZmF1bHQgcHJpb3JpdHkgYmluZGVycyBtYXkgb3ZlcnJpZGUuXG4gICAqL1xuICBwcmlvcml0eTogMCxcblxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIGEgY2xvbmVkIGJpbmRpbmcuIFRoaXMgaGFwcGVucyBhZnRlciBhIGNvbXBpbGVkIGJpbmRpbmcgb24gYSB0ZW1wbGF0ZSBpcyBjbG9uZWQgZm9yIGEgdmlldy5cbiAgICovXG4gIGluaXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmV4cHJlc3Npb24pIHtcbiAgICAgIC8vIEFuIG9ic2VydmVyIHRvIG9ic2VydmUgdmFsdWUgY2hhbmdlcyB0byB0aGUgZXhwcmVzc2lvbiB3aXRoaW4gYSBjb250ZXh0XG4gICAgICB0aGlzLm9ic2VydmVyID0gdGhpcy5vYnNlcnZlKHRoaXMuZXhwcmVzc2lvbiwgdGhpcy51cGRhdGVkKTtcbiAgICB9XG4gICAgdGhpcy5jcmVhdGVkKCk7XG4gIH0sXG5cbiAgLyoqXG4gICAqIENsb25lIHRoaXMgYmluZGluZyBmb3IgYSB2aWV3LiBUaGUgZWxlbWVudC9ub2RlIHdpbGwgYmUgdXBkYXRlZCBhbmQgdGhlIGJpbmRpbmcgd2lsbCBiZSBpbml0ZWQuXG4gICAqL1xuICBjbG9uZUZvclZpZXc6IGZ1bmN0aW9uKHZpZXcpIHtcbiAgICBpZiAoIXZpZXcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0EgYmluZGluZyBtdXN0IGNsb25lIGFnYWluc3QgYSB2aWV3Jyk7XG4gICAgfVxuXG4gICAgdmFyIG5vZGUgPSB2aWV3O1xuICAgIHRoaXMuX2VsZW1lbnRQYXRoLmZvckVhY2goZnVuY3Rpb24oaW5kZXgpIHtcbiAgICAgIG5vZGUgPSBub2RlLmNoaWxkTm9kZXNbaW5kZXhdO1xuICAgIH0pO1xuXG4gICAgdmFyIGJpbmRpbmcgPSBPYmplY3QuY3JlYXRlKHRoaXMpO1xuICAgIGJpbmRpbmcuY2xvbmVkRnJvbSA9IHRoaXM7XG4gICAgYmluZGluZy5lbGVtZW50ID0gbm9kZTtcbiAgICBiaW5kaW5nLm5vZGUgPSBub2RlO1xuICAgIGJpbmRpbmcuaW5pdCgpO1xuICAgIHJldHVybiBiaW5kaW5nO1xuICB9LFxuXG5cbiAgLy8gQmluZCB0aGlzIHRvIHRoZSBnaXZlbiBjb250ZXh0IG9iamVjdFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0KSB7XG4gICAgaWYgKHRoaXMuY29udGV4dCA9PSBjb250ZXh0KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci5jb250ZXh0ID0gY29udGV4dDtcbiAgICB0aGlzLmJvdW5kKCk7XG5cbiAgICBpZiAodGhpcy5vYnNlcnZlcikge1xuICAgICAgaWYgKHRoaXMudXBkYXRlZCAhPT0gQmluZGluZy5wcm90b3R5cGUudXBkYXRlZCkge1xuICAgICAgICB0aGlzLm9ic2VydmVyLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSB0cnVlO1xuICAgICAgICB0aGlzLm9ic2VydmVyLmJpbmQoY29udGV4dCk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG5cbiAgLy8gVW5iaW5kIHRoaXMgZnJvbSBpdHMgY29udGV4dFxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQgPT09IG51bGwpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5vYnNlcnZlcikgdGhpcy5vYnNlcnZlci51bmJpbmQoKTtcbiAgICB0aGlzLnVuYm91bmQoKTtcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB9LFxuXG5cbiAgLy8gQ2xlYW5zIHVwIGJpbmRpbmcgY29tcGxldGVseVxuICBkaXNwb3NlOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnVuYmluZCgpO1xuICAgIGlmICh0aGlzLm9ic2VydmVyKSB7XG4gICAgICAvLyBUaGlzIHdpbGwgY2xlYXIgaXQgb3V0LCBudWxsaWZ5aW5nIGFueSBkYXRhIHN0b3JlZFxuICAgICAgdGhpcy5vYnNlcnZlci5zeW5jKCk7XG4gICAgfVxuICAgIHRoaXMuZGlzcG9zZWQoKTtcbiAgfSxcblxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZydzIGVsZW1lbnQgaXMgY29tcGlsZWQgd2l0aGluIGEgdGVtcGxhdGVcbiAgY29tcGlsZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBiaW5kaW5nJ3MgZWxlbWVudCBpcyBjcmVhdGVkXG4gIGNyZWF0ZWQ6IGZ1bmN0aW9uKCkge30sXG5cbiAgLy8gVGhlIGZ1bmN0aW9uIHRvIHJ1biB3aGVuIHRoZSBleHByZXNzaW9uJ3MgdmFsdWUgY2hhbmdlc1xuICB1cGRhdGVkOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBib3VuZFxuICBib3VuZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBUaGUgZnVuY3Rpb24gdG8gcnVuIHdoZW4gdGhlIGJpbmRpbmcgaXMgdW5ib3VuZFxuICB1bmJvdW5kOiBmdW5jdGlvbigpIHt9LFxuXG4gIC8vIFRoZSBmdW5jdGlvbiB0byBydW4gd2hlbiB0aGUgYmluZGluZyBpcyBkaXNwb3NlZFxuICBkaXNwb3NlZDogZnVuY3Rpb24oKSB7fSxcblxuICAvLyBIZWxwZXIgbWV0aG9kc1xuXG4gIGdldCBjYW1lbENhc2UoKSB7XG4gICAgcmV0dXJuICh0aGlzLm1hdGNoIHx8IHRoaXMubmFtZSB8fCAnJykucmVwbGFjZSgvLSsoXFx3KS9nLCBmdW5jdGlvbihfLCBjaGFyKSB7XG4gICAgICByZXR1cm4gY2hhci50b1VwcGVyQ2FzZSgpO1xuICAgIH0pO1xuICB9LFxuXG4gIG9ic2VydmU6IGZ1bmN0aW9uKGV4cHJlc3Npb24sIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgICByZXR1cm4gdGhpcy5vYnNlcnZhdGlvbnMuY3JlYXRlT2JzZXJ2ZXIoZXhwcmVzc2lvbiwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCB8fCB0aGlzKTtcbiAgfVxufSk7XG5cblxuXG5cbnZhciBpbmRleE9mID0gQXJyYXkucHJvdG90eXBlLmluZGV4T2Y7XG5cbi8vIENyZWF0ZXMgYW4gYXJyYXkgb2YgaW5kZXhlcyB0byBoZWxwIGZpbmQgdGhlIHNhbWUgZWxlbWVudCB3aXRoaW4gYSBjbG9uZWQgdmlld1xuZnVuY3Rpb24gaW5pdE5vZGVQYXRoKG5vZGUsIHZpZXcpIHtcbiAgdmFyIHBhdGggPSBbXTtcbiAgd2hpbGUgKG5vZGUgIT09IHZpZXcpIHtcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHBhdGgudW5zaGlmdChpbmRleE9mLmNhbGwocGFyZW50LmNoaWxkTm9kZXMsIG5vZGUpKTtcbiAgICBub2RlID0gcGFyZW50O1xuICB9XG4gIHJldHVybiBwYXRoO1xufVxuIiwidmFyIHNsaWNlID0gQXJyYXkucHJvdG90eXBlLnNsaWNlO1xubW9kdWxlLmV4cG9ydHMgPSBjb21waWxlO1xuXG5cbi8vIFdhbGtzIHRoZSB0ZW1wbGF0ZSBET00gcmVwbGFjaW5nIGFueSBiaW5kaW5ncyBhbmQgY2FjaGluZyBiaW5kaW5ncyBvbnRvIHRoZSB0ZW1wbGF0ZSBvYmplY3QuXG5mdW5jdGlvbiBjb21waWxlKGZyYWdtZW50cywgdGVtcGxhdGUpIHtcbiAgdmFyIHdhbGtlciA9IGRvY3VtZW50LmNyZWF0ZVRyZWVXYWxrZXIodGVtcGxhdGUsIE5vZGVGaWx0ZXIuU0hPV19FTEVNRU5UIHwgTm9kZUZpbHRlci5TSE9XX1RFWFQpO1xuICB2YXIgYmluZGluZ3MgPSBbXSwgY3VycmVudE5vZGUsIHBhcmVudE5vZGUsIHByZXZpb3VzTm9kZTtcblxuICAvLyBSZXNldCBmaXJzdCBub2RlIHRvIGVuc3VyZSBpdCBpc24ndCBhIGZyYWdtZW50XG4gIHdhbGtlci5uZXh0Tm9kZSgpO1xuICB3YWxrZXIucHJldmlvdXNOb2RlKCk7XG5cbiAgLy8gZmluZCBiaW5kaW5ncyBmb3IgZWFjaCBub2RlXG4gIGRvIHtcbiAgICBjdXJyZW50Tm9kZSA9IHdhbGtlci5jdXJyZW50Tm9kZTtcbiAgICBwYXJlbnROb2RlID0gY3VycmVudE5vZGUucGFyZW50Tm9kZTtcbiAgICBiaW5kaW5ncy5wdXNoLmFwcGx5KGJpbmRpbmdzLCBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBjdXJyZW50Tm9kZSwgdGVtcGxhdGUpKTtcblxuICAgIGlmIChjdXJyZW50Tm9kZS5wYXJlbnROb2RlICE9PSBwYXJlbnROb2RlKSB7XG4gICAgICAvLyBjdXJyZW50Tm9kZSB3YXMgcmVtb3ZlZCBhbmQgbWFkZSBhIHRlbXBsYXRlXG4gICAgICB3YWxrZXIuY3VycmVudE5vZGUgPSBwcmV2aW91c05vZGUgfHwgd2Fsa2VyLnJvb3Q7XG4gICAgfSBlbHNlIHtcbiAgICAgIHByZXZpb3VzTm9kZSA9IGN1cnJlbnROb2RlO1xuICAgIH1cbiAgfSB3aGlsZSAod2Fsa2VyLm5leHROb2RlKCkpO1xuXG4gIHJldHVybiBiaW5kaW5ncztcbn1cblxuXG5cbi8vIEZpbmQgYWxsIHRoZSBiaW5kaW5ncyBvbiBhIGdpdmVuIG5vZGUgKHRleHQgbm9kZXMgd2lsbCBvbmx5IGV2ZXIgaGF2ZSBvbmUgYmluZGluZykuXG5mdW5jdGlvbiBnZXRCaW5kaW5nc0Zvck5vZGUoZnJhZ21lbnRzLCBub2RlLCB2aWV3KSB7XG4gIHZhciBiaW5kaW5ncyA9IFtdO1xuICB2YXIgQmluZGVyLCBiaW5kaW5nLCBleHByLCBib3VuZCwgbWF0Y2gsIGF0dHIsIGksIGw7XG5cbiAgaWYgKG5vZGUubm9kZVR5cGUgPT09IE5vZGUuVEVYVF9OT0RFKSB7XG4gICAgc3BsaXRUZXh0Tm9kZShmcmFnbWVudHMsIG5vZGUpO1xuXG4gICAgLy8gRmluZCBhbnkgYmluZGluZyBmb3IgdGhlIHRleHQgbm9kZVxuICAgIGlmIChmcmFnbWVudHMuaXNCb3VuZCgndGV4dCcsIG5vZGUubm9kZVZhbHVlKSkge1xuICAgICAgZXhwciA9IGZyYWdtZW50cy5jb2RpZnlFeHByZXNzaW9uKCd0ZXh0Jywgbm9kZS5ub2RlVmFsdWUpO1xuICAgICAgbm9kZS5ub2RlVmFsdWUgPSAnJztcbiAgICAgIEJpbmRlciA9IGZyYWdtZW50cy5maW5kQmluZGVyKCd0ZXh0JywgZXhwcik7XG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7IG5vZGU6IG5vZGUsIHZpZXc6IHZpZXcsIGV4cHJlc3Npb246IGV4cHIsIGZyYWdtZW50czogZnJhZ21lbnRzIH0pO1xuICAgICAgaWYgKGJpbmRpbmcuY29tcGlsZWQoKSAhPT0gZmFsc2UpIHtcbiAgICAgICAgYmluZGluZ3MucHVzaChiaW5kaW5nKTtcbiAgICAgIH1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gSWYgdGhlIGVsZW1lbnQgaXMgcmVtb3ZlZCBmcm9tIHRoZSBET00sIHN0b3AuIENoZWNrIGJ5IGxvb2tpbmcgYXQgaXRzIHBhcmVudE5vZGVcbiAgICB2YXIgcGFyZW50ID0gbm9kZS5wYXJlbnROb2RlO1xuICAgIHZhciBEZWZhdWx0QmluZGVyID0gZnJhZ21lbnRzLmdldEF0dHJpYnV0ZUJpbmRlcignX19kZWZhdWx0X18nKTtcblxuICAgIC8vIEZpbmQgYW55IGJpbmRpbmcgZm9yIHRoZSBlbGVtZW50XG4gICAgQmluZGVyID0gZnJhZ21lbnRzLmZpbmRCaW5kZXIoJ2VsZW1lbnQnLCBub2RlLnRhZ05hbWUudG9Mb3dlckNhc2UoKSk7XG4gICAgaWYgKEJpbmRlcikge1xuICAgICAgYmluZGluZyA9IG5ldyBCaW5kZXIoeyBub2RlOiBub2RlLCB2aWV3OiB2aWV3LCBmcmFnbWVudHM6IGZyYWdtZW50cyB9KTtcbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gSWYgcmVtb3ZlZCwgbWFkZSBhIHRlbXBsYXRlLCBkb24ndCBjb250aW51ZSBwcm9jZXNzaW5nXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gcGFyZW50KSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gRmluZCBhbmQgYWRkIGFueSBhdHRyaWJ1dGUgYmluZGluZ3Mgb24gYW4gZWxlbWVudC4gVGhlc2UgY2FuIGJlIGF0dHJpYnV0ZXMgd2hvc2UgbmFtZSBtYXRjaGVzIGEgYmluZGluZywgb3JcbiAgICAvLyB0aGV5IGNhbiBiZSBhdHRyaWJ1dGVzIHdoaWNoIGhhdmUgYSBiaW5kaW5nIGluIHRoZSB2YWx1ZSBzdWNoIGFzIGBocmVmPVwiL3Bvc3Qve3sgcG9zdC5pZCB9fVwiYC5cbiAgICBib3VuZCA9IFtdO1xuICAgIHZhciBhdHRyaWJ1dGVzID0gc2xpY2UuY2FsbChub2RlLmF0dHJpYnV0ZXMpO1xuICAgIGZvciAoaSA9IDAsIGwgPSBhdHRyaWJ1dGVzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgYXR0ciA9IGF0dHJpYnV0ZXNbaV07XG4gICAgICBCaW5kZXIgPSBmcmFnbWVudHMuZmluZEJpbmRlcignYXR0cmlidXRlJywgYXR0ci5uYW1lLCBhdHRyLnZhbHVlKTtcbiAgICAgIGlmIChCaW5kZXIpIHtcbiAgICAgICAgYm91bmQucHVzaChbIEJpbmRlciwgYXR0ciBdKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBNYWtlIHN1cmUgdG8gY3JlYXRlIGFuZCBwcm9jZXNzIHRoZW0gaW4gdGhlIGNvcnJlY3QgcHJpb3JpdHkgb3JkZXIgc28gaWYgYSBiaW5kaW5nIGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gdGhlXG4gICAgLy8gbm9kZSBpdCBkb2Vzbid0IHByb2Nlc3MgdGhlIG90aGVycy5cbiAgICBib3VuZC5zb3J0KHNvcnRBdHRyaWJ1dGVzKTtcblxuICAgIGZvciAoaSA9IDA7IGkgPCBib3VuZC5sZW5ndGg7IGkrKykge1xuICAgICAgQmluZGVyID0gYm91bmRbaV1bMF07XG4gICAgICBhdHRyID0gYm91bmRbaV1bMV07XG4gICAgICBpZiAoIW5vZGUuaGFzQXR0cmlidXRlKGF0dHIubmFtZSkpIHtcbiAgICAgICAgLy8gSWYgdGhpcyB3YXMgcmVtb3ZlZCBhbHJlYWR5IGJ5IGFub3RoZXIgYmluZGluZywgZG9uJ3QgcHJvY2Vzcy5cbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICB2YXIgbmFtZSA9IGF0dHIubmFtZTtcbiAgICAgIHZhciB2YWx1ZSA9IGF0dHIudmFsdWU7XG4gICAgICBpZiAoQmluZGVyLmV4cHIpIHtcbiAgICAgICAgbWF0Y2ggPSBuYW1lLm1hdGNoKEJpbmRlci5leHByKTtcbiAgICAgICAgaWYgKG1hdGNoKSBtYXRjaCA9IG1hdGNoWzFdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbWF0Y2ggPSBudWxsO1xuICAgICAgfVxuXG4gICAgICB0cnkge1xuICAgICAgICBub2RlLnJlbW92ZUF0dHJpYnV0ZShhdHRyLm5hbWUpO1xuICAgICAgfSBjYXRjaChlKSB7XG4gICAgICAgIC8vIGlmIHRoZSBhdHRyaWJ1dGUgd2FzIGFscmVhZHkgcmVtb3ZlZCBkb24ndCB3b3JyeVxuICAgICAgfVxuXG4gICAgICBiaW5kaW5nID0gbmV3IEJpbmRlcih7XG4gICAgICAgIG5vZGU6IG5vZGUsXG4gICAgICAgIHZpZXc6IHZpZXcsXG4gICAgICAgIG5hbWU6IG5hbWUsXG4gICAgICAgIG1hdGNoOiBtYXRjaCxcbiAgICAgICAgZXhwcmVzc2lvbjogdmFsdWUgPyBmcmFnbWVudHMuY29kaWZ5RXhwcmVzc2lvbignYXR0cmlidXRlJywgdmFsdWUsIEJpbmRlciAhPT0gRGVmYXVsdEJpbmRlcikgOiBudWxsLFxuICAgICAgICBmcmFnbWVudHM6IGZyYWdtZW50c1xuICAgICAgfSk7XG5cbiAgICAgIGlmIChiaW5kaW5nLmNvbXBpbGVkKCkgIT09IGZhbHNlKSB7XG4gICAgICAgIGJpbmRpbmdzLnB1c2goYmluZGluZyk7XG4gICAgICB9IGVsc2UgaWYgKEJpbmRlciAhPT0gRGVmYXVsdEJpbmRlciAmJiBmcmFnbWVudHMuaXNCb3VuZCgnYXR0cmlidXRlJywgdmFsdWUpKSB7XG4gICAgICAgIC8vIFJldmVydCB0byBkZWZhdWx0IGlmIHRoaXMgYmluZGluZyBkb2Vzbid0IHRha2VcbiAgICAgICAgYm91bmQucHVzaChbIERlZmF1bHRCaW5kZXIsIGF0dHIgXSk7XG4gICAgICB9XG5cbiAgICAgIGlmIChub2RlLnBhcmVudE5vZGUgIT09IHBhcmVudCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICByZXR1cm4gYmluZGluZ3Muc29ydChzb3J0QmluZGluZ3MpO1xufVxuXG5cbi8vIFNwbGl0cyB0ZXh0IG5vZGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbSBzbyB0aGV5IGNhbiBiZSBib3VuZCBpbmRpdmlkdWFsbHksIGhhcyBwYXJlbnROb2RlIHBhc3NlZCBpbiBzaW5jZSBpdCBtYXlcbi8vIGJlIGEgZG9jdW1lbnQgZnJhZ21lbnQgd2hpY2ggYXBwZWFycyBhcyBudWxsIG9uIG5vZGUucGFyZW50Tm9kZS5cbmZ1bmN0aW9uIHNwbGl0VGV4dE5vZGUoZnJhZ21lbnRzLCBub2RlKSB7XG4gIGlmICghbm9kZS5wcm9jZXNzZWQpIHtcbiAgICBub2RlLnByb2Nlc3NlZCA9IHRydWU7XG4gICAgdmFyIHJlZ2V4ID0gZnJhZ21lbnRzLmJpbmRlcnMudGV4dC5fZXhwcjtcbiAgICB2YXIgY29udGVudCA9IG5vZGUubm9kZVZhbHVlO1xuICAgIGlmIChjb250ZW50Lm1hdGNoKHJlZ2V4KSkge1xuICAgICAgdmFyIG1hdGNoLCBsYXN0SW5kZXggPSAwLCBwYXJ0cyA9IFtdLCBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgICAgIHdoaWxlICgobWF0Y2ggPSByZWdleC5leGVjKGNvbnRlbnQpKSkge1xuICAgICAgICBwYXJ0cy5wdXNoKGNvbnRlbnQuc2xpY2UobGFzdEluZGV4LCByZWdleC5sYXN0SW5kZXggLSBtYXRjaFswXS5sZW5ndGgpKTtcbiAgICAgICAgcGFydHMucHVzaChtYXRjaFswXSk7XG4gICAgICAgIGxhc3RJbmRleCA9IHJlZ2V4Lmxhc3RJbmRleDtcbiAgICAgIH1cbiAgICAgIHBhcnRzLnB1c2goY29udGVudC5zbGljZShsYXN0SW5kZXgpKTtcbiAgICAgIHBhcnRzID0gcGFydHMuZmlsdGVyKG5vdEVtcHR5KTtcblxuICAgICAgbm9kZS5ub2RlVmFsdWUgPSBwYXJ0c1swXTtcbiAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgcGFydHMubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgdmFyIG5ld1RleHROb2RlID0gZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUocGFydHNbaV0pO1xuICAgICAgICBuZXdUZXh0Tm9kZS5wcm9jZXNzZWQgPSB0cnVlO1xuICAgICAgICBmcmFnbWVudC5hcHBlbmRDaGlsZChuZXdUZXh0Tm9kZSk7XG4gICAgICB9XG4gICAgICBub2RlLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGZyYWdtZW50LCBub2RlLm5leHRTaWJsaW5nKTtcbiAgICB9XG4gIH1cbn1cblxuXG5mdW5jdGlvbiBzb3J0QmluZGluZ3MoYSwgYikge1xuICByZXR1cm4gYi5wcmlvcml0eSAtIGEucHJpb3JpdHk7XG59XG5cbmZ1bmN0aW9uIHNvcnRBdHRyaWJ1dGVzKGEsIGIpIHtcbiAgcmV0dXJuIHNvcnRCaW5kaW5ncyhiWzBdLnByb3RvdHlwZSwgYVswXS5wcm90b3R5cGUpO1xufVxuXG5mdW5jdGlvbiBub3RFbXB0eSh2YWx1ZSkge1xuICByZXR1cm4gQm9vbGVhbih2YWx1ZSk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IEZyYWdtZW50cztcbnJlcXVpcmUoJy4vdXRpbC9wb2x5ZmlsbHMnKTtcbnZhciBDbGFzcyA9IHJlcXVpcmUoJ2NoaXAtdXRpbHMvY2xhc3MnKTtcbnZhciB0b0ZyYWdtZW50ID0gcmVxdWlyZSgnLi91dGlsL3RvRnJhZ21lbnQnKTtcbnZhciBhbmltYXRpb24gPSByZXF1aXJlKCcuL3V0aWwvYW5pbWF0aW9uJyk7XG52YXIgVGVtcGxhdGUgPSByZXF1aXJlKCcuL3RlbXBsYXRlJyk7XG52YXIgVmlldyA9IHJlcXVpcmUoJy4vdmlldycpO1xudmFyIEJpbmRpbmcgPSByZXF1aXJlKCcuL2JpbmRpbmcnKTtcbnZhciBBbmltYXRlZEJpbmRpbmcgPSByZXF1aXJlKCcuL2FuaW1hdGVkQmluZGluZycpO1xudmFyIGNvbXBpbGUgPSByZXF1aXJlKCcuL2NvbXBpbGUnKTtcbnZhciBoYXNXaWxkY2FyZEV4cHIgPSAvKF58W15cXFxcXSlcXCovO1xudmFyIGVzY2FwZWRXaWxkY2FyZEV4cHIgPSAvKF58W15cXFxcXSlcXFxcXFwqLztcblxuLyoqXG4gKiBBIEZyYWdtZW50cyBvYmplY3Qgc2VydmVzIGFzIGEgcmVnaXN0cnkgZm9yIGJpbmRlcnMgYW5kIGZvcm1hdHRlcnNcbiAqIEBwYXJhbSB7T2JzZXJ2YXRpb25zfSBvYnNlcnZhdGlvbnMgQW4gaW5zdGFuY2Ugb2YgT2JzZXJ2YXRpb25zIGZvciB0cmFja2luZyBjaGFuZ2VzIHRvIHRoZSBkYXRhXG4gKi9cbmZ1bmN0aW9uIEZyYWdtZW50cyhvYnNlcnZhdGlvbnMpIHtcbiAgaWYgKCFvYnNlcnZhdGlvbnMpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdNdXN0IHByb3ZpZGUgYW4gb2JzZXJ2YXRpb25zIGluc3RhbmNlIHRvIEZyYWdtZW50cy4nKTtcbiAgfVxuXG4gIHRoaXMub2JzZXJ2YXRpb25zID0gb2JzZXJ2YXRpb25zO1xuICB0aGlzLmdsb2JhbHMgPSBvYnNlcnZhdGlvbnMuZ2xvYmFscztcbiAgdGhpcy5mb3JtYXR0ZXJzID0gb2JzZXJ2YXRpb25zLmZvcm1hdHRlcnM7XG4gIHRoaXMuYW5pbWF0aW9ucyA9IHt9O1xuICB0aGlzLmFuaW1hdGVBdHRyaWJ1dGUgPSAnYW5pbWF0ZSc7XG5cbiAgdGhpcy5iaW5kZXJzID0ge1xuICAgIGVsZW1lbnQ6IHsgX3dpbGRjYXJkczogW10gfSxcbiAgICBhdHRyaWJ1dGU6IHsgX3dpbGRjYXJkczogW10sIF9leHByOiAve3tcXHMqKC4qPylcXHMqfX0vZywgX2RlbGltaXRlcnNPbmx5SW5EZWZhdWx0OiBmYWxzZSB9LFxuICAgIHRleHQ6IHsgX3dpbGRjYXJkczogW10sIF9leHByOiAve3tcXHMqKC4qPylcXHMqfX0vZyB9XG4gIH07XG5cbiAgLy8gVGV4dCBiaW5kZXIgZm9yIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtXG4gIHRoaXMucmVnaXN0ZXJUZXh0KCdfX2RlZmF1bHRfXycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgdGhpcy5lbGVtZW50LnRleHRDb250ZW50ID0gKHZhbHVlICE9IG51bGwpID8gdmFsdWUgOiAnJztcbiAgfSk7XG5cbiAgLy8gQ2F0Y2hhbGwgYXR0cmlidXRlIGJpbmRlciBmb3IgcmVndWxhciBhdHRyaWJ1dGVzIHdpdGggZXhwcmVzc2lvbnMgaW4gdGhlbVxuICB0aGlzLnJlZ2lzdGVyQXR0cmlidXRlKCdfX2RlZmF1bHRfXycsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKHZhbHVlICE9IG51bGwpIHtcbiAgICAgIHRoaXMuZWxlbWVudC5zZXRBdHRyaWJ1dGUodGhpcy5uYW1lLCB2YWx1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuZWxlbWVudC5yZW1vdmVBdHRyaWJ1dGUodGhpcy5uYW1lKTtcbiAgICB9XG4gIH0pO1xufVxuXG5DbGFzcy5leHRlbmQoRnJhZ21lbnRzLCB7XG5cbiAgLyoqXG4gICAqIFRha2VzIGFuIEhUTUwgc3RyaW5nLCBhbiBlbGVtZW50LCBhbiBhcnJheSBvZiBlbGVtZW50cywgb3IgYSBkb2N1bWVudCBmcmFnbWVudCwgYW5kIGNvbXBpbGVzIGl0IGludG8gYSB0ZW1wbGF0ZS5cbiAgICogSW5zdGFuY2VzIG1heSB0aGVuIGJlIGNyZWF0ZWQgYW5kIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICogQHBhcmFtIHtTdHJpbmd8Tm9kZUxpc3R8SFRNTENvbGxlY3Rpb258SFRNTFRlbXBsYXRlRWxlbWVudHxIVE1MU2NyaXB0RWxlbWVudHxOb2RlfSBodG1sIEEgVGVtcGxhdGUgY2FuIGJlIGNyZWF0ZWRcbiAgICogZnJvbSBtYW55IGRpZmZlcmVudCB0eXBlcyBvZiBvYmplY3RzLiBBbnkgb2YgdGhlc2Ugd2lsbCBiZSBjb252ZXJ0ZWQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50IGZvciB0aGUgdGVtcGxhdGUgdG9cbiAgICogY2xvbmUuIE5vZGVzIGFuZCBlbGVtZW50cyBwYXNzZWQgaW4gd2lsbCBiZSByZW1vdmVkIGZyb20gdGhlIERPTS5cbiAgICovXG4gIGNyZWF0ZVRlbXBsYXRlOiBmdW5jdGlvbihodG1sKSB7XG4gICAgdmFyIGZyYWdtZW50ID0gdG9GcmFnbWVudChodG1sKTtcbiAgICBpZiAoZnJhZ21lbnQuY2hpbGROb2Rlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignQ2Fubm90IGNyZWF0ZSBhIHRlbXBsYXRlIGZyb20gJyArIGh0bWwpO1xuICAgIH1cbiAgICB2YXIgdGVtcGxhdGUgPSBUZW1wbGF0ZS5tYWtlSW5zdGFuY2VPZihmcmFnbWVudCk7XG4gICAgdGVtcGxhdGUuYmluZGluZ3MgPSBjb21waWxlKHRoaXMsIHRlbXBsYXRlKTtcbiAgICByZXR1cm4gdGVtcGxhdGU7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYmluZGluZ3Mgb24gYW4gZWxlbWVudC5cbiAgICovXG4gIGNvbXBpbGVFbGVtZW50OiBmdW5jdGlvbihlbGVtZW50KSB7XG4gICAgaWYgKCFlbGVtZW50LmJpbmRpbmdzKSB7XG4gICAgICBlbGVtZW50LmJpbmRpbmdzID0gY29tcGlsZSh0aGlzLCBlbGVtZW50KTtcbiAgICAgIFZpZXcubWFrZUluc3RhbmNlT2YoZWxlbWVudCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGVsZW1lbnQ7XG4gIH0sXG5cblxuICAvKipcbiAgICogQ29tcGlsZXMgYW5kIGJpbmRzIGFuIGVsZW1lbnQgd2hpY2ggd2FzIG5vdCBjcmVhdGVkIGZyb20gYSB0ZW1wbGF0ZS4gTW9zdGx5IG9ubHkgdXNlZCBmb3IgYmluZGluZyB0aGUgZG9jdW1lbnQnc1xuICAgKiBodG1sIGVsZW1lbnQuXG4gICAqL1xuICBiaW5kRWxlbWVudDogZnVuY3Rpb24oZWxlbWVudCwgY29udGV4dCkge1xuICAgIHRoaXMuY29tcGlsZUVsZW1lbnQoZWxlbWVudCk7XG5cbiAgICBpZiAoY29udGV4dCkge1xuICAgICAgZWxlbWVudC5iaW5kKGNvbnRleHQpO1xuICAgIH1cblxuICAgIHJldHVybiBlbGVtZW50O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIE9ic2VydmVzIGFuIGV4cHJlc3Npb24gd2l0aGluIGEgZ2l2ZW4gY29udGV4dCwgY2FsbGluZyB0aGUgY2FsbGJhY2sgd2hlbiBpdCBjaGFuZ2VzIGFuZCByZXR1cm5pbmcgdGhlIG9ic2VydmVyLlxuICAgKi9cbiAgb2JzZXJ2ZTogZnVuY3Rpb24oY29udGV4dCwgZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCkge1xuICAgIGlmICh0eXBlb2YgY29udGV4dCA9PT0gJ3N0cmluZycpIHtcbiAgICAgIGNhbGxiYWNrQ29udGV4dCA9IGNhbGxiYWNrO1xuICAgICAgY2FsbGJhY2sgPSBleHByO1xuICAgICAgZXhwciA9IGNvbnRleHQ7XG4gICAgICBjb250ZXh0ID0gbnVsbDtcbiAgICB9XG4gICAgdmFyIG9ic2VydmVyID0gdGhpcy5vYnNlcnZhdGlvbnMuY3JlYXRlT2JzZXJ2ZXIoZXhwciwgY2FsbGJhY2ssIGNhbGxiYWNrQ29udGV4dCk7XG4gICAgaWYgKGNvbnRleHQpIHtcbiAgICAgIG9ic2VydmVyLmJpbmQoY29udGV4dCwgdHJ1ZSk7XG4gICAgfVxuICAgIHJldHVybiBvYnNlcnZlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBiaW5kZXIgZm9yIGEgZ2l2ZW4gdHlwZSBhbmQgbmFtZS4gQSBiaW5kZXIgaXMgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIGFuZCBpcyB1c2VkIHRvIGNyZWF0ZSBiaW5kaW5ncyBvblxuICAgKiBhbiBlbGVtZW50IG9yIHRleHQgbm9kZSB3aG9zZSB0YWcgbmFtZSwgYXR0cmlidXRlIG5hbWUsIG9yIGV4cHJlc3Npb24gY29udGVudHMgbWF0Y2ggdGhpcyBiaW5kZXIncyBuYW1lL2V4cHJlc3Npb24uXG4gICAqXG4gICAqICMjIyBQYXJhbWV0ZXJzXG4gICAqXG4gICAqICAqIGB0eXBlYDogdGhlcmUgYXJlIHRocmVlIHR5cGVzIG9mIGJpbmRlcnM6IGVsZW1lbnQsIGF0dHJpYnV0ZSwgb3IgdGV4dC4gVGhlc2UgY29ycmVzcG9uZCB0byBtYXRjaGluZyBhZ2FpbnN0IGFuXG4gICAqICAgIGVsZW1lbnQncyB0YWcgbmFtZSwgYW4gZWxlbWVudCB3aXRoIHRoZSBnaXZlbiBhdHRyaWJ1dGUgbmFtZSwgb3IgYSB0ZXh0IG5vZGUgdGhhdCBtYXRjaGVzIHRoZSBwcm92aWRlZFxuICAgKiAgICBleHByZXNzaW9uLlxuICAgKlxuICAgKiAgKiBgbmFtZWA6IHRvIG1hdGNoLCBhIGJpbmRlciBuZWVkcyB0aGUgbmFtZSBvZiBhbiBlbGVtZW50IG9yIGF0dHJpYnV0ZSwgb3IgYSByZWd1bGFyIGV4cHJlc3Npb24gdGhhdCBtYXRjaGVzIGFcbiAgICogICAgZ2l2ZW4gdGV4dCBub2RlLiBOYW1lcyBmb3IgZWxlbWVudHMgYW5kIGF0dHJpYnV0ZXMgY2FuIGJlIHJlZ3VsYXIgZXhwcmVzc2lvbnMgYXMgd2VsbCwgb3IgdGhleSBtYXkgYmUgd2lsZGNhcmRcbiAgICogICAgbmFtZXMgYnkgdXNpbmcgYW4gYXN0ZXJpc2suXG4gICAqXG4gICAqICAqIGBkZWZpbml0aW9uYDogYSBiaW5kZXIgaXMgYSBzdWJjbGFzcyBvZiBCaW5kaW5nIHdoaWNoIG92ZXJyaWRlcyBrZXkgbWV0aG9kcywgYGNvbXBpbGVkYCwgYGNyZWF0ZWRgLCBgdXBkYXRlZGAsXG4gICAqICAgIGBib3VuZGAsIGFuZCBgdW5ib3VuZGAuIFRoZSBkZWZpbml0aW9uIG1heSBiZSBhbiBhY3R1YWwgc3ViY2xhc3Mgb2YgQmluZGluZyBvciBpdCBtYXkgYmUgYW4gb2JqZWN0IHdoaWNoIHdpbGwgYmVcbiAgICogICAgdXNlZCBmb3IgdGhlIHByb3RvdHlwZSBvZiB0aGUgbmV3bHkgY3JlYXRlZCBzdWJjbGFzcy4gRm9yIG1hbnkgYmluZGluZ3Mgb25seSB0aGUgYHVwZGF0ZWRgIG1ldGhvZCBpcyBvdmVycmlkZGVuLFxuICAgKiAgICBzbyBieSBqdXN0IHBhc3NpbmcgaW4gYSBmdW5jdGlvbiBmb3IgYGRlZmluaXRpb25gIHRoZSBiaW5kZXIgd2lsbCBiZSBjcmVhdGVkIHdpdGggdGhhdCBhcyBpdHMgYHVwZGF0ZWRgIG1ldGhvZC5cbiAgICpcbiAgICogIyMjIEV4cGxhaW5hdGlvbiBvZiBwcm9wZXJ0aWVzIGFuZCBtZXRob2RzXG4gICAqXG4gICAqICAgKiBgcHJpb3JpdHlgIG1heSBiZSBkZWZpbmVkIGFzIG51bWJlciB0byBpbnN0cnVjdCBzb21lIGJpbmRlcnMgdG8gYmUgcHJvY2Vzc2VkIGJlZm9yZSBvdGhlcnMuIEJpbmRlcnMgd2l0aFxuICAgKiAgIGhpZ2hlciBwcmlvcml0eSBhcmUgcHJvY2Vzc2VkIGZpcnN0LlxuICAgKlxuICAgKiAgICogYGFuaW1hdGVkYCBjYW4gYmUgc2V0IHRvIGB0cnVlYCB0byBleHRlbmQgdGhlIEFuaW1hdGVkQmluZGluZyBjbGFzcyB3aGljaCBwcm92aWRlcyBzdXBwb3J0IGZvciBhbmltYXRpb24gd2hlblxuICAgKiAgIGluc2VydGluZ2FuZCByZW1vdmluZyBub2RlcyBmcm9tIHRoZSBET00uIFRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IG9ubHkgKmFsbG93cyogYW5pbWF0aW9uIGJ1dCB0aGUgZWxlbWVudCBtdXN0XG4gICAqICAgaGF2ZSB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSB0byB1c2UgYW5pbWF0aW9uLiBBIGJpbmRpbmcgd2lsbCBoYXZlIHRoZSBgYW5pbWF0ZWAgcHJvcGVydHkgc2V0IHRvIHRydWUgd2hlbiBpdCBpc1xuICAgKiAgIHRvIGJlIGFuaW1hdGVkLiBCaW5kZXJzIHNob3VsZCBoYXZlIGZhc3QgcGF0aHMgZm9yIHdoZW4gYW5pbWF0aW9uIGlzIG5vdCB1c2VkIHJhdGhlciB0aGFuIGFzc3VtaW5nIGFuaW1hdGlvbiB3aWxsXG4gICAqICAgYmUgdXNlZC5cbiAgICpcbiAgICogQmluZGVyc1xuICAgKlxuICAgKiBBIGJpbmRlciBjYW4gaGF2ZSA1IG1ldGhvZHMgd2hpY2ggd2lsbCBiZSBjYWxsZWQgYXQgdmFyaW91cyBwb2ludHMgaW4gYSBiaW5kaW5nJ3MgbGlmZWN5Y2xlLiBNYW55IGJpbmRlcnMgd2lsbFxuICAgKiBvbmx5IHVzZSB0aGUgYHVwZGF0ZWQodmFsdWUpYCBtZXRob2QsIHNvIGNhbGxpbmcgcmVnaXN0ZXIgd2l0aCBhIGZ1bmN0aW9uIGluc3RlYWQgb2YgYW4gb2JqZWN0IGFzIGl0cyB0aGlyZFxuICAgKiBwYXJhbWV0ZXIgaXMgYSBzaG9ydGN1dCB0byBjcmVhdGluZyBhIGJpbmRlciB3aXRoIGp1c3QgYW4gYHVwZGF0ZWAgbWV0aG9kLlxuICAgKlxuICAgKiBMaXN0ZWQgaW4gb3JkZXIgb2Ygd2hlbiB0aGV5IG9jY3VyIGluIGEgYmluZGluZydzIGxpZmVjeWNsZTpcbiAgICpcbiAgICogICAqIGBjb21waWxlZChvcHRpb25zKWAgaXMgY2FsbGVkIHdoZW4gZmlyc3QgY3JlYXRpbmcgYSBiaW5kaW5nIGR1cmluZyB0aGUgdGVtcGxhdGUgY29tcGlsYXRpb24gcHJvY2VzcyBhbmQgcmVjZWl2ZXNcbiAgICogdGhlIGBvcHRpb25zYCBvYmplY3QgdGhhdCB3aWxsIGJlIHBhc3NlZCBpbnRvIGBuZXcgQmluZGluZyhvcHRpb25zKWAuIFRoaXMgY2FuIGJlIHVzZWQgZm9yIGNyZWF0aW5nIHRlbXBsYXRlcyxcbiAgICogbW9kaWZ5aW5nIHRoZSBET00gKG9ubHkgc3Vic2VxdWVudCBET00gdGhhdCBoYXNuJ3QgYWxyZWFkeSBiZWVuIHByb2Nlc3NlZCkgYW5kIG90aGVyIHRoaW5ncyB0aGF0IHNob3VsZCBiZVxuICAgKiBhcHBsaWVkIGF0IGNvbXBpbGUgdGltZSBhbmQgbm90IGR1cGxpY2F0ZWQgZm9yIGVhY2ggdmlldyBjcmVhdGVkLlxuICAgKlxuICAgKiAgICogYGNyZWF0ZWQoKWAgaXMgY2FsbGVkIG9uIHRoZSBiaW5kaW5nIHdoZW4gYSBuZXcgdmlldyBpcyBjcmVhdGVkLiBUaGlzIGNhbiBiZSB1c2VkIHRvIGFkZCBldmVudCBsaXN0ZW5lcnMgb24gdGhlXG4gICAqIGVsZW1lbnQgb3IgZG8gb3RoZXIgdGhpbmdzIHRoYXQgd2lsbCBwZXJzaXN0ZSB3aXRoIHRoZSB2aWV3IHRocm91Z2ggaXRzIG1hbnkgdXNlcy4gVmlld3MgbWF5IGdldCByZXVzZWQgc28gZG9uJ3RcbiAgICogZG8gYW55dGhpbmcgaGVyZSB0byB0aWUgaXQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICAgKlxuICAgKiAgICogYGF0dGFjaGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIHRoZSB2aWV3IGlzIGJvdW5kIHRvIGEgZ2l2ZW4gY29udGV4dCBhbmQgaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBUaGlzXG4gICAqIGNhbiBiZSB1c2VkIHRvIGhhbmRsZSBjb250ZXh0LXNwZWNpZmljIGFjdGlvbnMsIGFkZCBsaXN0ZW5lcnMgdG8gdGhlIHdpbmRvdyBvciBkb2N1bWVudCAodG8gYmUgcmVtb3ZlZCBpblxuICAgKiBgZGV0YWNoZWRgISksIGV0Yy5cbiAgICpcbiAgICogICAqIGB1cGRhdGVkKHZhbHVlLCBvbGRWYWx1ZSwgY2hhbmdlUmVjb3JkcylgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuZXZlciB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gd2l0aGluXG4gICAqIHRoZSBhdHRyaWJ1dGUgY2hhbmdlcy4gRm9yIGV4YW1wbGUsIGBiaW5kLXRleHQ9XCJ7e3VzZXJuYW1lfX1cImAgd2lsbCB0cmlnZ2VyIGB1cGRhdGVkYCB3aXRoIHRoZSB2YWx1ZSBvZiB1c2VybmFtZVxuICAgKiB3aGVuZXZlciBpdCBjaGFuZ2VzIG9uIHRoZSBnaXZlbiBjb250ZXh0LiBXaGVuIHRoZSB2aWV3IGlzIHJlbW92ZWQgYHVwZGF0ZWRgIHdpbGwgYmUgdHJpZ2dlcmVkIHdpdGggYSB2YWx1ZSBvZlxuICAgKiBgdW5kZWZpbmVkYCBpZiB0aGUgdmFsdWUgd2FzIG5vdCBhbHJlYWR5IGB1bmRlZmluZWRgLCBnaXZpbmcgYSBjaGFuY2UgdG8gXCJyZXNldFwiIHRvIGFuIGVtcHR5IHN0YXRlLlxuICAgKlxuICAgKiAgICogYGRldGFjaGVkKClgIGlzIGNhbGxlZCBvbiB0aGUgYmluZGluZyB3aGVuIHRoZSB2aWV3IGlzIHVuYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0IGFuZCByZW1vdmVkIGZyb20gdGhlIERPTS4gVGhpc1xuICAgKiBjYW4gYmUgdXNlZCB0byBjbGVhbiB1cCBhbnl0aGluZyBkb25lIGluIGBhdHRhY2hlZCgpYCBvciBpbiBgdXBkYXRlZCgpYCBiZWZvcmUgYmVpbmcgcmVtb3ZlZC5cbiAgICpcbiAgICogRWxlbWVudCBhbmQgYXR0cmlidXRlIGJpbmRlcnMgd2lsbCBhcHBseSB3aGVuZXZlciB0aGUgdGFnIG5hbWUgb3IgYXR0cmlidXRlIG5hbWUgaXMgbWF0Y2hlZC4gSW4gdGhlIGNhc2Ugb2ZcbiAgICogYXR0cmlidXRlIGJpbmRlcnMgaWYgeW91IG9ubHkgd2FudCBpdCB0byBtYXRjaCB3aGVuIGV4cHJlc3Npb25zIGFyZSB1c2VkIHdpdGhpbiB0aGUgYXR0cmlidXRlLCBhZGQgYG9ubHlXaGVuQm91bmRgXG4gICAqIHRvIHRoZSBkZWZpbml0aW9uLiBPdGhlcndpc2UgdGhlIGJpbmRlciB3aWxsIG1hdGNoIGFuZCB0aGUgdmFsdWUgb2YgdGhlIGV4cHJlc3Npb24gd2lsbCBzaW1wbHkgYmUgYSBzdHJpbmcgdGhhdFxuICAgKiBvbmx5IGNhbGxzIHVwZGF0ZWQgb25jZSBzaW5jZSBpdCB3aWxsIG5vdCBjaGFuZ2UuXG4gICAqXG4gICAqIE5vdGUsIGF0dHJpYnV0ZXMgd2hpY2ggbWF0Y2ggYSBiaW5kZXIgYXJlIHJlbW92ZWQgZHVyaW5nIGNvbXBpbGUuIFRoZXkgYXJlIGNvbnNpZGVyZWQgdG8gYmUgYmluZGluZyBkZWZpbml0aW9ucyBhbmRcbiAgICogbm90IHBhcnQgb2YgdGhlIGVsZW1lbnQuIEJpbmRpbmdzIG1heSBzZXQgdGhlIGF0dHJpYnV0ZSB3aGljaCBzZXJ2ZWQgYXMgdGhlaXIgZGVmaW5pdGlvbiBpZiBkZXNpcmVkLlxuICAgKlxuICAgKiAjIyMgRGVmYXVsdHNcbiAgICpcbiAgICogVGhlcmUgYXJlIGRlZmF1bHQgYmluZGVycyBmb3IgYXR0cmlidXRlIGFuZCB0ZXh0IG5vZGVzIHdoaWNoIGFwcGx5IHdoZW4gbm8gb3RoZXIgYmluZGVycyBtYXRjaC4gVGhleSBvbmx5IGFwcGx5IHRvXG4gICAqIGF0dHJpYnV0ZXMgYW5kIHRleHQgbm9kZXMgd2l0aCBleHByZXNzaW9ucyBpbiB0aGVtIChlLmcuIGB7e2Zvb319YCkuIFRoZSBkZWZhdWx0IGlzIHRvIHNldCB0aGUgYXR0cmlidXRlIG9yIHRleHRcbiAgICogbm9kZSdzIHZhbHVlIHRvIHRoZSByZXN1bHQgb2YgdGhlIGV4cHJlc3Npb24uIElmIHlvdSB3YW50ZWQgdG8gb3ZlcnJpZGUgdGhpcyBkZWZhdWx0IHlvdSBtYXkgcmVnaXN0ZXIgYSBiaW5kZXIgd2l0aFxuICAgKiB0aGUgbmFtZSBgXCJfX2RlZmF1bHRfX1wiYC5cbiAgICpcbiAgICogKipFeGFtcGxlOioqIFRoaXMgYmluZGluZyBoYW5kbGVyIGFkZHMgcGlyYXRlaXplZCB0ZXh0IHRvIGFuIGVsZW1lbnQuXG4gICAqIGBgYGphdmFzY3JpcHRcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJBdHRyaWJ1dGUoJ215LXBpcmF0ZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHtcbiAgICogICAgIHZhbHVlID0gJyc7XG4gICAqICAgfSBlbHNlIHtcbiAgICogICAgIHZhbHVlID0gdmFsdWVcbiAgICogICAgICAgLnJlcGxhY2UoL1xcQmluZ1xcYi9nLCBcImluJ1wiKVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxidG9cXGIvZywgXCJ0J1wiKVxuICAgKiAgICAgICAucmVwbGFjZSgvXFxieW91XFxiLywgJ3llJylcbiAgICogICAgICAgKyAnIEFycnJyISc7XG4gICAqICAgfVxuICAgKiAgIHRoaXMuZWxlbWVudC50ZXh0Q29udGVudCA9IHZhbHVlO1xuICAgKiB9KTtcbiAgICogYGBgXG4gICAqXG4gICAqIGBgYGh0bWxcbiAgICogPHAgbXktcGlyYXRlPVwie3twb3N0LmJvZHl9fVwiPlRoaXMgdGV4dCB3aWxsIGJlIHJlcGxhY2VkLjwvcD5cbiAgICogYGBgXG4gICAqL1xuICByZWdpc3RlckVsZW1lbnQ6IGZ1bmN0aW9uKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICByZXR1cm4gdGhpcy5yZWdpc3RlckJpbmRlcignZWxlbWVudCcsIG5hbWUsIGRlZmluaXRpb24pO1xuICB9LFxuICByZWdpc3RlckF0dHJpYnV0ZTogZnVuY3Rpb24obmFtZSwgZGVmaW5pdGlvbikge1xuICAgIHJldHVybiB0aGlzLnJlZ2lzdGVyQmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJUZXh0OiBmdW5jdGlvbihuYW1lLCBkZWZpbml0aW9uKSB7XG4gICAgcmV0dXJuIHRoaXMucmVnaXN0ZXJCaW5kZXIoJ3RleHQnLCBuYW1lLCBkZWZpbml0aW9uKTtcbiAgfSxcbiAgcmVnaXN0ZXJCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICBpZiAoIWRlZmluaXRpb24pIHRocm93IG5ldyBUeXBlRXJyb3IoJ011c3QgcHJvdmlkZSBhIGRlZmluaXRpb24gd2hlbiByZWdpc3RlcmluZyBhIGJpbmRlcicpO1xuICAgIHZhciBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuICAgIHZhciBzdXBlckNsYXNzID0gZGVmaW5pdGlvbi5hbmltYXRlZCA/IEFuaW1hdGVkQmluZGluZyA6IEJpbmRpbmc7XG5cbiAgICBpZiAoIWJpbmRlcnMpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2B0eXBlYCBtdXN0IGJlIG9uZSBvZiAnICsgT2JqZWN0LmtleXModGhpcy5iaW5kZXJzKS5qb2luKCcsICcpKTtcbiAgICB9XG5cbiAgICBpZiAodHlwZW9mIGRlZmluaXRpb24gPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIGlmIChkZWZpbml0aW9uLnByb3RvdHlwZSBpbnN0YW5jZW9mIEJpbmRpbmcpIHtcbiAgICAgICAgc3VwZXJDbGFzcyA9IGRlZmluaXRpb247XG4gICAgICAgIGRlZmluaXRpb24gPSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGRlZmluaXRpb24gPSB7IHVwZGF0ZWQ6IGRlZmluaXRpb24gfTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAobmFtZSA9PT0gJ19fZGVmYXVsdF9fJyAmJiAhZGVmaW5pdGlvbi5oYXNPd25Qcm9wZXJ0eSgncHJpb3JpdHknKSkge1xuICAgICAgZGVmaW5pdGlvbi5wcmlvcml0eSA9IC0xMDA7XG4gICAgfVxuXG4gICAgLy8gQ3JlYXRlIGEgc3ViY2xhc3Mgb2YgQmluZGluZyAob3IgYW5vdGhlciBiaW5kZXIpIHdpdGggdGhlIGRlZmluaXRpb25cbiAgICBmdW5jdGlvbiBCaW5kZXIoKSB7XG4gICAgICBzdXBlckNsYXNzLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gICAgfVxuICAgIGRlZmluaXRpb24ub2JzZXJ2YXRpb25zID0gdGhpcy5vYnNlcnZhdGlvbnM7XG4gICAgc3VwZXJDbGFzcy5leHRlbmQoQmluZGVyLCBkZWZpbml0aW9uKTtcblxuICAgIHZhciBleHByO1xuICAgIGlmIChuYW1lIGluc3RhbmNlb2YgUmVnRXhwKSB7XG4gICAgICBleHByID0gbmFtZTtcbiAgICB9IGVsc2UgaWYgKGhhc1dpbGRjYXJkRXhwci50ZXN0KG5hbWUpKSB7XG4gICAgICBleHByID0gbmV3IFJlZ0V4cCgnXicgKyBlc2NhcGVSZWdFeHAobmFtZSkucmVwbGFjZShlc2NhcGVkV2lsZGNhcmRFeHByLCAnJDEoLiopJykgKyAnJCcpO1xuICAgIH1cblxuICAgIGlmIChleHByKSB7XG4gICAgICBCaW5kZXIuZXhwciA9IGV4cHI7XG4gICAgICBiaW5kZXJzLl93aWxkY2FyZHMucHVzaChCaW5kZXIpO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnNvcnQodGhpcy5iaW5kaW5nU29ydCk7XG4gICAgfVxuXG4gICAgQmluZGVyLm5hbWUgPSAnJyArIG5hbWU7XG4gICAgYmluZGVyc1tuYW1lXSA9IEJpbmRlcjtcbiAgICByZXR1cm4gQmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBiaW5kZXIgdGhhdCB3YXMgYWRkZWQgd2l0aCBgcmVnaXN0ZXIoKWAuIElmIGFuIFJlZ0V4cCB3YXMgdXNlZCBpbiByZWdpc3RlciBmb3IgdGhlIG5hbWUgaXQgbXVzdCBiZSB1c2VkXG4gICAqIHRvIHVucmVnaXN0ZXIsIGJ1dCBpdCBkb2VzIG5vdCBuZWVkIHRvIGJlIHRoZSBzYW1lIGluc3RhbmNlLlxuICAgKi9cbiAgdW5yZWdpc3RlckVsZW1lbnQ6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy51bnJlZ2lzdGVyQmluZGVyKCdlbGVtZW50JywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJBdHRyaWJ1dGU6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy51bnJlZ2lzdGVyQmluZGVyKCdhdHRyaWJ1dGUnLCBuYW1lKTtcbiAgfSxcbiAgdW5yZWdpc3RlclRleHQ6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy51bnJlZ2lzdGVyQmluZGVyKCd0ZXh0JywgbmFtZSk7XG4gIH0sXG4gIHVucmVnaXN0ZXJCaW5kZXI6IGZ1bmN0aW9uKHR5cGUsIG5hbWUpIHtcbiAgICB2YXIgYmluZGVyID0gdGhpcy5nZXRCaW5kZXIodHlwZSwgbmFtZSksIGJpbmRlcnMgPSB0aGlzLmJpbmRlcnNbdHlwZV07XG4gICAgaWYgKCFiaW5kZXIpIHJldHVybjtcbiAgICBpZiAoYmluZGVyLmV4cHIpIHtcbiAgICAgIHZhciBpbmRleCA9IGJpbmRlcnMuX3dpbGRjYXJkcy5pbmRleE9mKGJpbmRlcik7XG4gICAgICBpZiAoaW5kZXggPj0gMCkgYmluZGVycy5fd2lsZGNhcmRzLnNwbGljZShpbmRleCwgMSk7XG4gICAgfVxuICAgIGRlbGV0ZSBiaW5kZXJzW25hbWVdO1xuICAgIHJldHVybiBiaW5kZXI7XG4gIH0sXG5cblxuICAvKipcbiAgICogUmV0dXJucyBhIGJpbmRlciB0aGF0IHdhcyBhZGRlZCB3aXRoIGByZWdpc3RlcigpYCBieSB0eXBlIGFuZCBuYW1lLlxuICAgKi9cbiAgZ2V0RWxlbWVudEJpbmRlcjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmdldEJpbmRlcignZWxlbWVudCcsIG5hbWUpO1xuICB9LFxuICBnZXRBdHRyaWJ1dGVCaW5kZXI6IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICByZXR1cm4gdGhpcy5nZXRCaW5kZXIoJ2F0dHJpYnV0ZScsIG5hbWUpO1xuICB9LFxuICBnZXRUZXh0QmluZGVyOiBmdW5jdGlvbihuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZ2V0QmluZGVyKCd0ZXh0JywgbmFtZSk7XG4gIH0sXG4gIGdldEJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSkge1xuICAgIHZhciBiaW5kZXJzID0gdGhpcy5iaW5kZXJzW3R5cGVdO1xuXG4gICAgaWYgKCFiaW5kZXJzKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdgdHlwZWAgbXVzdCBiZSBvbmUgb2YgJyArIE9iamVjdC5rZXlzKHRoaXMuYmluZGVycykuam9pbignLCAnKSk7XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgJiYgYmluZGVycy5oYXNPd25Qcm9wZXJ0eShuYW1lKSkge1xuICAgICAgcmV0dXJuIGJpbmRlcnNbbmFtZV07XG4gICAgfVxuICB9LFxuXG5cbiAgLyoqXG4gICAqIEZpbmQgYSBtYXRjaGluZyBiaW5kZXIgZm9yIHRoZSBnaXZlbiB0eXBlLiBFbGVtZW50cyBzaG91bGQgb25seSBwcm92aWRlIG5hbWUuIEF0dHJpYnV0ZXMgc2hvdWxkIHByb3ZpZGUgdGhlIG5hbWVcbiAgICogYW5kIHZhbHVlICh2YWx1ZSBzbyB0aGUgZGVmYXVsdCBjYW4gYmUgcmV0dXJuZWQgaWYgYW4gZXhwcmVzc2lvbiBleGlzdHMgaW4gdGhlIHZhbHVlKS4gVGV4dCBub2RlcyBzaG91bGQgb25seVxuICAgKiBwcm92aWRlIHRoZSB2YWx1ZSAoaW4gcGxhY2Ugb2YgdGhlIG5hbWUpIGFuZCB3aWxsIHJldHVybiB0aGUgZGVmYXVsdCBpZiBubyBiaW5kZXJzIG1hdGNoLlxuICAgKi9cbiAgZmluZEJpbmRlcjogZnVuY3Rpb24odHlwZSwgbmFtZSwgdmFsdWUpIHtcbiAgICBpZiAodHlwZSA9PT0gJ3RleHQnICYmIHZhbHVlID09IG51bGwpIHtcbiAgICAgIHZhbHVlID0gbmFtZTtcbiAgICAgIG5hbWUgPSB1bmRlZmluZWQ7XG4gICAgfVxuXG4gICAgaWYgKG5hbWUgPT09IHRoaXMuYW5pbWF0ZUF0dHJpYnV0ZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCBuYW1lKSwgYmluZGVycyA9IHRoaXMuYmluZGVyc1t0eXBlXTtcblxuICAgIGlmICghYmluZGVyKSB7XG4gICAgICB2YXIgdG9NYXRjaCA9ICh0eXBlID09PSAndGV4dCcpID8gdmFsdWUgOiBuYW1lO1xuICAgICAgYmluZGVycy5fd2lsZGNhcmRzLnNvbWUoZnVuY3Rpb24od2lsZGNhcmRCaW5kZXIpIHtcbiAgICAgICAgaWYgKHRvTWF0Y2gubWF0Y2god2lsZGNhcmRCaW5kZXIuZXhwcikpIHtcbiAgICAgICAgICBiaW5kZXIgPSB3aWxkY2FyZEJpbmRlcjtcbiAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gZG9uJ3QgdXNlIGUuZy4gdGhlIGB2YWx1ZWAgYmluZGVyIGlmIHRoZXJlIGlzIG5vIGV4cHJlc3Npb24gaW4gdGhlIGF0dHJpYnV0ZSB2YWx1ZSAoZS5nLiBgdmFsdWU9XCJzb21lIHRleHRcImApXG4gICAgaWYgKGJpbmRlciAmJlxuICAgICAgICB0eXBlID09PSAnYXR0cmlidXRlJyAmJlxuICAgICAgICBiaW5kZXIucHJvdG90eXBlLm9ubHlXaGVuQm91bmQgJiZcbiAgICAgICAgIXRoaXMuYmluZGVyc1t0eXBlXS5fZGVsaW1pdGVyc09ubHlJbkRlZmF1bHQgJiZcbiAgICAgICAgIXRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUZXN0IGlmIHRoZSBhdHRyaWJ1dGUgdmFsdWUgaXMgYm91bmQgKGUuZy4gYGhyZWY9XCIvcG9zdHMve3sgcG9zdC5pZCB9fVwiYClcbiAgICBpZiAoIWJpbmRlciAmJiB2YWx1ZSAmJiAodHlwZSA9PT0gJ3RleHQnIHx8IHRoaXMuaXNCb3VuZCh0eXBlLCB2YWx1ZSkpKSB7XG4gICAgICBiaW5kZXIgPSB0aGlzLmdldEJpbmRlcih0eXBlLCAnX19kZWZhdWx0X18nKTtcbiAgICB9XG5cbiAgICByZXR1cm4gYmluZGVyO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEEgRm9ybWF0dGVyIGlzIHN0b3JlZCB0byBwcm9jZXNzIHRoZSB2YWx1ZSBvZiBhbiBleHByZXNzaW9uLiBUaGlzIGFsdGVycyB0aGUgdmFsdWUgb2Ygd2hhdCBjb21lcyBpbiB3aXRoIGEgZnVuY3Rpb25cbiAgICogdGhhdCByZXR1cm5zIGEgbmV3IHZhbHVlLiBGb3JtYXR0ZXJzIGFyZSBhZGRlZCBieSB1c2luZyBhIHNpbmdsZSBwaXBlIGNoYXJhY3RlciAoYHxgKSBmb2xsb3dlZCBieSB0aGUgbmFtZSBvZiB0aGVcbiAgICogZm9ybWF0dGVyLiBNdWx0aXBsZSBmb3JtYXR0ZXJzIGNhbiBiZSB1c2VkIGJ5IGNoYWluaW5nIHBpcGVzIHdpdGggZm9ybWF0dGVyIG5hbWVzLiBGb3JtYXR0ZXJzIG1heSBhbHNvIGhhdmVcbiAgICogYXJndW1lbnRzIHBhc3NlZCB0byB0aGVtIGJ5IHVzaW5nIHRoZSBjb2xvbiB0byBzZXBhcmF0ZSBhcmd1bWVudHMgZnJvbSB0aGUgZm9ybWF0dGVyIG5hbWUuIFRoZSBzaWduYXR1cmUgb2YgYVxuICAgKiBmb3JtYXR0ZXIgc2hvdWxkIGJlIGBmdW5jdGlvbih2YWx1ZSwgYXJncy4uLilgIHdoZXJlIGFyZ3MgYXJlIGV4dHJhIHBhcmFtZXRlcnMgcGFzc2VkIGludG8gdGhlIGZvcm1hdHRlciBhZnRlclxuICAgKiBjb2xvbnMuXG4gICAqXG4gICAqICpFeGFtcGxlOipcbiAgICogYGBganNcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ3VwcGVyY2FzZScsIGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAqICAgaWYgKHR5cGVvZiB2YWx1ZSAhPSAnc3RyaW5nJykgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlLnRvVXBwZXJjYXNlKClcbiAgICogfSlcbiAgICpcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ3JlcGxhY2UnLCBmdW5jdGlvbih2YWx1ZSwgcmVwbGFjZSwgd2l0aCkge1xuICAgKiAgIGlmICh0eXBlb2YgdmFsdWUgIT0gJ3N0cmluZycpIHJldHVybiAnJ1xuICAgKiAgIHJldHVybiB2YWx1ZS5yZXBsYWNlKHJlcGxhY2UsIHdpdGgpXG4gICAqIH0pXG4gICAqIGBgYGh0bWxcbiAgICogPGgxIGJpbmQtdGV4dD1cInRpdGxlIHwgdXBwZXJjYXNlIHwgcmVwbGFjZTonTEVUVEVSJzonTlVNQkVSJ1wiPjwvaDE+XG4gICAqIGBgYFxuICAgKiAqUmVzdWx0OipcbiAgICogYGBgaHRtbFxuICAgKiA8aDE+R0VUVElORyBUTyBLTk9XIEFMTCBBQk9VVCBUSEUgTlVNQkVSIEE8L2gxPlxuICAgKiBgYGBcbiAgICogVE9ETzogb2xkIGRvY3MsIHJld3JpdGUsIHRoZXJlIGlzIGFuIGV4dHJhIGFyZ3VtZW50IG5hbWVkIGBzZXR0ZXJgIHdoaWNoIHdpbGwgYmUgdHJ1ZSB3aGVuIHRoZSBleHByZXNzaW9uIGlzIGJlaW5nIFwic2V0XCIgaW5zdGVhZCBvZiBcImdldFwiXG4gICAqIEEgYHZhbHVlRm9ybWF0dGVyYCBpcyBsaWtlIGEgZm9ybWF0dGVyIGJ1dCB1c2VkIHNwZWNpZmljYWxseSB3aXRoIHRoZSBgdmFsdWVgIGJpbmRpbmcgc2luY2UgaXQgaXMgYSB0d28td2F5IGJpbmRpbmcuIFdoZW5cbiAgICogdGhlIHZhbHVlIG9mIHRoZSBlbGVtZW50IGlzIGNoYW5nZWQgYSBgdmFsdWVGb3JtYXR0ZXJgIGNhbiBhZGp1c3QgdGhlIHZhbHVlIGZyb20gYSBzdHJpbmcgdG8gdGhlIGNvcnJlY3QgdmFsdWUgdHlwZSBmb3JcbiAgICogdGhlIGNvbnRyb2xsZXIgZXhwcmVzc2lvbi4gVGhlIHNpZ25hdHVyZSBmb3IgYSBgdmFsdWVGb3JtYXR0ZXJgIGluY2x1ZGVzIHRoZSBjdXJyZW50IHZhbHVlIG9mIHRoZSBleHByZXNzaW9uXG4gICAqIGJlZm9yZSB0aGUgb3B0aW9uYWwgYXJndW1lbnRzIChpZiBhbnkpLiBUaGlzIGFsbG93cyBkYXRlcyB0byBiZSBhZGp1c3RlZCBhbmQgcG9zc2libGV5IG90aGVyIHVzZXMuXG4gICAqXG4gICAqICpFeGFtcGxlOipcbiAgICogYGBganNcbiAgICogcmVnaXN0cnkucmVnaXN0ZXJGb3JtYXR0ZXIoJ251bWVyaWMnLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIC8vIHZhbHVlIGNvbWluZyBmcm9tIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24sIHRvIGJlIHNldCBvbiB0aGUgZWxlbWVudFxuICAgKiAgIGlmICh2YWx1ZSA9PSBudWxsIHx8IGlzTmFOKHZhbHVlKSkgcmV0dXJuICcnXG4gICAqICAgcmV0dXJuIHZhbHVlXG4gICAqIH0pXG4gICAqXG4gICAqIHJlZ2lzdHJ5LnJlZ2lzdGVyRm9ybWF0dGVyKCdkYXRlLWhvdXInLCBmdW5jdGlvbih2YWx1ZSkge1xuICAgKiAgIC8vIHZhbHVlIGNvbWluZyBmcm9tIHRoZSBjb250cm9sbGVyIGV4cHJlc3Npb24sIHRvIGJlIHNldCBvbiB0aGUgZWxlbWVudFxuICAgKiAgIGlmICggIShjdXJyZW50VmFsdWUgaW5zdGFuY2VvZiBEYXRlKSApIHJldHVybiAnJ1xuICAgKiAgIHZhciBob3VycyA9IHZhbHVlLmdldEhvdXJzKClcbiAgICogICBpZiAoaG91cnMgPj0gMTIpIGhvdXJzIC09IDEyXG4gICAqICAgaWYgKGhvdXJzID09IDApIGhvdXJzID0gMTJcbiAgICogICByZXR1cm4gaG91cnNcbiAgICogfSlcbiAgICogYGBgaHRtbFxuICAgKiA8bGFiZWw+TnVtYmVyIEF0dGVuZGluZzo8L2xhYmVsPlxuICAgKiA8aW5wdXQgc2l6ZT1cIjRcIiBiaW5kLXZhbHVlPVwiZXZlbnQuYXR0ZW5kZWVDb3VudCB8IG51bWVyaWNcIj5cbiAgICogPGxhYmVsPlRpbWU6PC9sYWJlbD5cbiAgICogPGlucHV0IHNpemU9XCIyXCIgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLWhvdXJcIj4gOlxuICAgKiA8aW5wdXQgc2l6ZT1cIjJcIiBiaW5kLXZhbHVlPVwiZXZlbnQuZGF0ZSB8IGRhdGUtbWludXRlXCI+XG4gICAqIDxzZWxlY3QgYmluZC12YWx1ZT1cImV2ZW50LmRhdGUgfCBkYXRlLWFtcG1cIj5cbiAgICogICA8b3B0aW9uPkFNPC9vcHRpb24+XG4gICAqICAgPG9wdGlvbj5QTTwvb3B0aW9uPlxuICAgKiA8L3NlbGVjdD5cbiAgICogYGBgXG4gICAqL1xuICByZWdpc3RlckZvcm1hdHRlcjogZnVuY3Rpb24gKG5hbWUsIGZvcm1hdHRlcikge1xuICAgIHRoaXMuZm9ybWF0dGVyc1tuYW1lXSA9IGZvcm1hdHRlcjtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBVbnJlZ2lzdGVycyBhIGZvcm1hdHRlci5cbiAgICovXG4gIHVucmVnaXN0ZXJGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgZGVsZXRlIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBHZXRzIGEgcmVnaXN0ZXJlZCBmb3JtYXR0ZXIuXG4gICAqL1xuICBnZXRGb3JtYXR0ZXI6IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgcmV0dXJuIHRoaXMuZm9ybWF0dGVyc1tuYW1lXTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBBbiBBbmltYXRpb24gaXMgc3RvcmVkIHRvIGhhbmRsZSBhbmltYXRpb25zLiBBIHJlZ2lzdGVyZWQgYW5pbWF0aW9uIGlzIGFuIG9iamVjdCAob3IgY2xhc3Mgd2hpY2ggaW5zdGFudGlhdGVzIGludG9cbiAgICogYW4gb2JqZWN0KSB3aXRoIHRoZSBtZXRob2RzOlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZUluKGVsZW1lbnQsIGNhbGxiYWNrKWBcbiAgICogICAqIGBkaWRBbmltYXRlSW4oZWxlbWVudClgXG4gICAqICAgKiBgd2lsbEFuaW1hdGVPdXQoZWxlbWVudClgXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBjYWxsYmFjaylgXG4gICAqICAgKiBgZGlkQW5pbWF0ZU91dChlbGVtZW50KWBcbiAgICpcbiAgICogQW5pbWF0aW9uIGlzIGluY2x1ZGVkIHdpdGggYmluZGVycyB3aGljaCBhcmUgcmVnaXN0ZXJlZCB3aXRoIHRoZSBgYW5pbWF0ZWRgIHByb3BlcnR5IHNldCB0byBgdHJ1ZWAgKHN1Y2ggYXMgYGlmYFxuICAgKiBhbmQgYHJlcGVhdGApLiBBbmltYXRpb25zIGFsbG93IGVsZW1lbnRzIHRvIGZhZGUgaW4sIGZhZGUgb3V0LCBzbGlkZSBkb3duLCBjb2xsYXBzZSwgbW92ZSBmcm9tIG9uZSBsb2NhdGlvbiBpbiBhXG4gICAqIGxpc3QgdG8gYW5vdGhlciwgYW5kIG1vcmUuXG4gICAqXG4gICAqIFRvIHVzZSBhbmltYXRpb24gYWRkIGFuIGF0dHJpYnV0ZSBuYW1lZCBgYW5pbWF0ZWAgb250byBhbiBlbGVtZW50IHdpdGggYSBzdXBwb3J0ZWQgYmluZGVyLlxuICAgKlxuICAgKiAjIyMgQ1NTIEFuaW1hdGlvbnNcbiAgICpcbiAgICogSWYgdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgZG9lcyBub3QgaGF2ZSBhIHZhbHVlIG9yIHRoZSB2YWx1ZSBpcyBhIGNsYXNzIG5hbWUgKGUuZy4gYGFuaW1hdGU9XCIubXktZmFkZVwiYCkgdGhlblxuICAgKiBmcmFnbWVudHMgd2lsbCB1c2UgYSBDU1MgdHJhbnNpdGlvbi9hbmltYXRpb24uIENsYXNzZXMgd2lsbCBiZSBhZGRlZCBhbmQgcmVtb3ZlZCB0byB0cmlnZ2VyIHRoZSBhbmltYXRpb24uXG4gICAqXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgYWRkZWQgcmlnaHQgYWZ0ZXIgYW4gZWxlbWVudCBpcyBpbnNlcnRlZCBpbnRvIHRoZSBET00uIFRoaXMgY2FuIGJlIHVzZWQgdG8gc2V0IHRoZVxuICAgKiAgICAgb3BhY2l0eSB0byBgMC4wYCBmb3IgZXhhbXBsZS4gSXQgaXMgdGhlbiByZW1vdmVkIG9uIHRoZSBuZXh0IGFuaW1hdGlvbiBmcmFtZS5cbiAgICogICAqIGAuYW5pbWF0ZS1pbmAgaXMgd2hlbiBgLndpbGwtYW5pbWF0ZS1pbmAgaXMgcmVtb3ZlZC4gSXQgY2FuIGJlIHVzZWQgdG8gc2V0IG9wYWNpdHkgdG8gYDEuMGAgZm9yIGV4YW1wbGUuIFRoZVxuICAgKiAgICAgYGFuaW1hdGlvbmAgc3R5bGUgY2FuIGJlIHNldCBvbiB0aGlzIGNsYXNzIGlmIHVzaW5nIGl0LiBUaGUgYHRyYW5zaXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgaGVyZS4gTm90ZSB0aGF0XG4gICAqICAgICBhbHRob3VnaCB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBwbGFjZWQgb24gYW4gZWxlbWVudCB3aXRoIHRoZSBgcmVwZWF0YCBiaW5kZXIsIHRoZXNlIGNsYXNzZXMgYXJlIGFkZGVkIHRvXG4gICAqICAgICBpdHMgY2hpbGRyZW4gYXMgdGhleSBnZXQgYWRkZWQgYW5kIHJlbW92ZWQuXG4gICAqICAgKiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIGFkZGVkIGJlZm9yZSBhbiBlbGVtZW50IGlzIHJlbW92ZWQgZnJvbSB0aGUgRE9NLiBUaGlzIGNhbiBiZSB1c2VkIHRvIHNldCB0aGUgb3BhY2l0eSB0b1xuICAgKiAgICAgYDFgIGZvciBleGFtcGxlLiBJdCBpcyB0aGVuIHJlbW92ZWQgb24gdGhlIG5leHQgYW5pbWF0aW9uIGZyYW1lLlxuICAgKiAgICogYC5hbmltYXRlLW91dGAgaXMgYWRkZWQgd2hlbiBgLndpbGwtYW5pbWF0ZS1vdXRgIGlzIHJlbW92ZWQuIEl0IGNhbiBiZSB1c2VkIHRvIHNldCBvcGFjaXR5IHRvIGAwLjBgIGZvclxuICAgKiAgICAgZXhhbXBsZS4gVGhlIGBhbmltYXRpb25gIHN0eWxlIGNhbiBiZSBzZXQgb24gdGhpcyBjbGFzcyBpZiB1c2luZyBpdC4gVGhlIGB0cmFuc2l0aW9uYCBzdHlsZSBjYW4gYmUgc2V0IGhlcmUgb3JcbiAgICogICAgIG9uIGFub3RoZXIgc2VsZWN0b3IgdGhhdCBtYXRjaGVzIHRoZSBlbGVtZW50LiBOb3RlIHRoYXQgYWx0aG91Z2ggdGhlIGBhbmltYXRlYCBhdHRyaWJ1dGUgaXMgcGxhY2VkIG9uIGFuXG4gICAqICAgICBlbGVtZW50IHdpdGggdGhlIGByZXBlYXRgIGJpbmRlciwgdGhlc2UgY2xhc3NlcyBhcmUgYWRkZWQgdG8gaXRzIGNoaWxkcmVuIGFzIHRoZXkgZ2V0IGFkZGVkIGFuZCByZW1vdmVkLlxuICAgKlxuICAgKiBJZiB0aGUgYGFuaW1hdGVgIGF0dHJpYnV0ZSBpcyBzZXQgdG8gYSBjbGFzcyBuYW1lIChlLmcuIGBhbmltYXRlPVwiLm15LWZhZGVcImApIHRoZW4gdGhhdCBjbGFzcyBuYW1lIHdpbGwgYmUgYWRkZWQgYXNcbiAgICogYSBjbGFzcyB0byB0aGUgZWxlbWVudCBkdXJpbmcgYW5pbWF0aW9uLiBUaGlzIGFsbG93cyB5b3UgdG8gdXNlIGAubXktZmFkZS53aWxsLWFuaW1hdGUtaW5gLCBgLm15LWZhZGUuYW5pbWF0ZS1pbmAsXG4gICAqIGV0Yy4gaW4geW91ciBzdHlsZXNoZWV0cyB0byB1c2UgdGhlIHNhbWUgYW5pbWF0aW9uIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi5cbiAgICpcbiAgICogIyMjIEphdmFTY3JpcHQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBJZiB5b3UgbmVlZCBncmVhdGVyIGNvbnRyb2wgb3ZlciB5b3VyIGFuaW1hdGlvbnMgSmF2YVNjcmlwdCBtYXkgYmUgdXNlZC4gSXQgaXMgcmVjb21tZW5kZWQgdGhhdCBDU1Mgc3R5bGVzIHN0aWxsIGJlXG4gICAqIHVzZWQgYnkgaGF2aW5nIHlvdXIgY29kZSBzZXQgdGhlbSBtYW51YWxseS4gVGhpcyBhbGxvd3MgdGhlIGFuaW1hdGlvbiB0byB0YWtlIGFkdmFudGFnZSBvZiB0aGUgYnJvd3NlclxuICAgKiBvcHRpbWl6YXRpb25zIHN1Y2ggYXMgaGFyZHdhcmUgYWNjZWxlcmF0aW9uLiBUaGlzIGlzIG5vdCBhIHJlcXVpcmVtZW50LlxuICAgKlxuICAgKiBJbiBvcmRlciB0byB1c2UgSmF2YVNjcmlwdCBhbiBvYmplY3Qgc2hvdWxkIGJlIHBhc3NlZCBpbnRvIHRoZSBgYW5pbWF0aW9uYCBhdHRyaWJ1dGUgdXNpbmcgYW4gZXhwcmVzc2lvbi4gVGhpc1xuICAgKiBvYmplY3Qgc2hvdWxkIGhhdmUgbWV0aG9kcyB0aGF0IGFsbG93IEphdmFTY3JpcHQgYW5pbWF0aW9uIGhhbmRsaW5nLiBGb3IgZXhhbXBsZSwgaWYgeW91IGFyZSBib3VuZCB0byBhIGNvbnRleHRcbiAgICogd2l0aCBhbiBvYmplY3QgbmFtZWQgYGN1c3RvbUZhZGVgIHdpdGggYW5pbWF0aW9uIG1ldGhvZHMsIHlvdXIgZWxlbWVudCBzaG91bGQgaGF2ZSBgYXR0cmlidXRlPVwie3tjdXN0b21GYWRlfX1cImAuXG4gICAqIFRoZSBmb2xsb3dpbmcgaXMgYSBsaXN0IG9mIHRoZSBtZXRob2RzIHlvdSBtYXkgaW1wbGVtZW50LlxuICAgKlxuICAgKiAgICogYHdpbGxBbmltYXRlSW4oZWxlbWVudClgIHdpbGwgYmUgY2FsbGVkIGFmdGVyIGFuIGVsZW1lbnQgaGFzIGJlZW4gaW5zZXJ0ZWQgaW50byB0aGUgRE9NLiBVc2UgaXQgdG8gc2V0IGluaXRpYWxcbiAgICogICAgIENTUyBwcm9wZXJ0aWVzIGJlZm9yZSBgYW5pbWF0ZUluYCBpcyBjYWxsZWQgdG8gc2V0IHRoZSBmaW5hbCBwcm9wZXJ0aWVzLiBUaGlzIG1ldGhvZCBpcyBvcHRpb25hbC5cbiAgICogICAqIGBhbmltYXRlSW4oZWxlbWVudCwgY2FsbGJhY2spYCB3aWxsIGJlIGNhbGxlZCBzaG9ydGx5IGFmdGVyIGB3aWxsQW5pbWF0ZUluYCBpZiBpdCB3YXMgZGVmaW5lZC4gVXNlIGl0IHRvIHNldFxuICAgKiAgICAgZmluYWwgQ1NTIHByb3BlcnRpZXMuXG4gICAqICAgKiBgYW5pbWF0ZU91dChlbGVtZW50LCBkb25lKWAgd2lsbCBiZSBjYWxsZWQgYmVmb3JlIGFuIGVsZW1lbnQgaXMgdG8gYmUgcmVtb3ZlZCBmcm9tIHRoZSBET00uIGBkb25lYCBtdXN0IGJlXG4gICAqICAgICBjYWxsZWQgd2hlbiB0aGUgYW5pbWF0aW9uIGlzIGNvbXBsZXRlIGluIG9yZGVyIGZvciB0aGUgYmluZGVyIHRvIGZpbmlzaCByZW1vdmluZyB0aGUgZWxlbWVudC4gKipSZW1lbWJlcioqIHRvXG4gICAqICAgICBjbGVhbiB1cCBieSByZW1vdmluZyBhbnkgc3R5bGVzIHRoYXQgd2VyZSBhZGRlZCBiZWZvcmUgY2FsbGluZyBgZG9uZSgpYCBzbyB0aGUgZWxlbWVudCBjYW4gYmUgcmV1c2VkIHdpdGhvdXRcbiAgICogICAgIHNpZGUtZWZmZWN0cy5cbiAgICpcbiAgICogVGhlIGBlbGVtZW50YCBwYXNzZWQgaW4gd2lsbCBiZSBwb2x5ZmlsbGVkIGZvciB3aXRoIHRoZSBgYW5pbWF0ZWAgbWV0aG9kIHVzaW5nXG4gICAqIGh0dHBzOi8vZ2l0aHViLmNvbS93ZWItYW5pbWF0aW9ucy93ZWItYW5pbWF0aW9ucy1qcy5cbiAgICpcbiAgICogIyMjIFJlZ2lzdGVyZWQgQW5pbWF0aW9uc1xuICAgKlxuICAgKiBBbmltYXRpb25zIG1heSBiZSByZWdpc3RlcmVkIGFuZCB1c2VkIHRocm91Z2hvdXQgeW91ciBhcHBsaWNhdGlvbi4gVG8gdXNlIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gdXNlIGl0cyBuYW1lIGluXG4gICAqIHRoZSBgYW5pbWF0ZWAgYXR0cmlidXRlIChlLmcuIGBhbmltYXRlPVwiZmFkZVwiYCkuIE5vdGUgdGhlIG9ubHkgZGlmZmVyZW5jZSBiZXR3ZWVuIGEgcmVnaXN0ZXJlZCBhbmltYXRpb24gYW5kIGFcbiAgICogY2xhc3MgcmVnaXN0cmF0aW9uIGlzIGNsYXNzIHJlZ2lzdHJhdGlvbnMgYXJlIHByZWZpeGVkIHdpdGggYSBkb3QgKGAuYCkuIFJlZ2lzdGVyZWQgYW5pbWF0aW9ucyBhcmUgYWx3YXlzXG4gICAqIEphdmFTY3JpcHQgYW5pbWF0aW9ucy4gVG8gcmVnaXN0ZXIgYW4gYW5pbWF0aW9uIHVzZSBgZnJhZ21lbnRzLnJlZ2lzdGVyQW5pbWF0aW9uKG5hbWUsIGFuaW1hdGlvbk9iamVjdClgLlxuICAgKlxuICAgKiBUaGUgQW5pbWF0aW9uIG1vZHVsZSBjb21lcyB3aXRoIHNldmVyYWwgY29tbW9uIGFuaW1hdGlvbnMgcmVnaXN0ZXJlZCBieSBkZWZhdWx0LiBUaGUgZGVmYXVsdHMgdXNlIENTUyBzdHlsZXMgdG9cbiAgICogd29yayBjb3JyZWN0bHksIHVzaW5nIGBlbGVtZW50LmFuaW1hdGVgLlxuICAgKlxuICAgKiAgICogYGZhZGVgIHdpbGwgZmFkZSBhbiBlbGVtZW50IGluIGFuZCBvdXQgb3ZlciAzMDAgbWlsbGlzZWNvbmRzLlxuICAgKiAgICogYHNsaWRlYCB3aWxsIHNsaWRlIGFuIGVsZW1lbnQgZG93biB3aGVuIGl0IGlzIGFkZGVkIGFuZCBzbGlkZSBpdCB1cCB3aGVuIGl0IGlzIHJlbW92ZWQuXG4gICAqICAgKiBgc2xpZGUtbW92ZWAgd2lsbCBtb3ZlIGFuIGVsZW1lbnQgZnJvbSBpdHMgb2xkIGxvY2F0aW9uIHRvIGl0cyBuZXcgbG9jYXRpb24gaW4gYSByZXBlYXRlZCBsaXN0LlxuICAgKlxuICAgKiBEbyB5b3UgaGF2ZSBhbm90aGVyIGNvbW1vbiBhbmltYXRpb24geW91IHRoaW5rIHNob3VsZCBiZSBpbmNsdWRlZCBieSBkZWZhdWx0PyBTdWJtaXQgYSBwdWxsIHJlcXVlc3QhXG4gICAqL1xuICByZWdpc3RlckFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSwgYW5pbWF0aW9uT2JqZWN0KSB7XG4gICAgdGhpcy5hbmltYXRpb25zW25hbWVdID0gYW5pbWF0aW9uT2JqZWN0O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVucmVnaXN0ZXJzIGFuIGFuaW1hdGlvbi5cbiAgICovXG4gIHVucmVnaXN0ZXJBbmltYXRpb246IGZ1bmN0aW9uKG5hbWUpIHtcbiAgICBkZWxldGUgdGhpcy5hbmltYXRpb25zW25hbWVdO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIEdldHMgYSByZWdpc3RlcmVkIGFuaW1hdGlvbi5cbiAgICovXG4gIGdldEFuaW1hdGlvbjogZnVuY3Rpb24obmFtZSkge1xuICAgIHJldHVybiB0aGlzLmFuaW1hdGlvbnNbbmFtZV07XG4gIH0sXG5cblxuICAvKipcbiAgICogUHJlcGFyZSBhbiBlbGVtZW50IHRvIGJlIGVhc2llciBhbmltYXRhYmxlIChhZGRpbmcgYSBzaW1wbGUgYGFuaW1hdGVgIHBvbHlmaWxsIGlmIG5lZWRlZClcbiAgICovXG4gIG1ha2VFbGVtZW50QW5pbWF0YWJsZTogYW5pbWF0aW9uLm1ha2VFbGVtZW50QW5pbWF0YWJsZSxcblxuXG4gIC8qKlxuICAgKiBTZXRzIHRoZSBkZWxpbWl0ZXJzIHRoYXQgZGVmaW5lIGFuIGV4cHJlc3Npb24uIERlZmF1bHQgaXMgYHt7YCBhbmQgYH19YCBidXQgdGhpcyBtYXkgYmUgb3ZlcnJpZGRlbi4gSWYgZW1wdHlcbiAgICogc3RyaW5ncyBhcmUgcGFzc2VkIGluIChmb3IgdHlwZSBcImF0dHJpYnV0ZVwiIG9ubHkpIHRoZW4gbm8gZGVsaW1pdGVycyBhcmUgcmVxdWlyZWQgZm9yIG1hdGNoaW5nIGF0dHJpYnV0ZXMsIGJ1dCB0aGVcbiAgICogZGVmYXVsdCBhdHRyaWJ1dGUgbWF0Y2hlciB3aWxsIG5vdCBhcHBseSB0byB0aGUgcmVzdCBvZiB0aGUgYXR0cmlidXRlcy4gVE9ETyBzdXBwb3J0IGRpZmZlcmVudCBkZWxpbWl0ZXJzIGZvciB0aGVcbiAgICogZGVmYXVsdCBhdHRyaWJ1dGVzIHZzIHJlZ2lzdGVyZWQgb25lcyAoaS5lLiBhbGxvdyByZWd1bGFyIGF0dHJpYnV0ZXMgdG8gdXNlIHt7fX0gd2hlbiBib3VuZCBvbmVzIGRvIG5vdCBuZWVkIHRoZW0pXG4gICAqL1xuICBzZXRFeHByZXNzaW9uRGVsaW1pdGVyczogZnVuY3Rpb24odHlwZSwgcHJlLCBwb3N0LCBvbmx5SW5EZWZhdWx0KSB7XG4gICAgaWYgKHR5cGUgIT09ICdhdHRyaWJ1dGUnICYmIHR5cGUgIT09ICd0ZXh0Jykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignRXhwcmVzc2lvbiBkZWxpbWl0ZXJzIG11c3QgYmUgb2YgdHlwZSBcImF0dHJpYnV0ZVwiIG9yIFwidGV4dFwiJyk7XG4gICAgfVxuXG4gICAgdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByID0gbmV3IFJlZ0V4cChlc2NhcGVSZWdFeHAocHJlKSArICcoLio/KScgKyBlc2NhcGVSZWdFeHAocG9zdCksICdnJyk7XG4gICAgaWYgKHR5cGUgPT09ICdhdHRyaWJ1dGUnKSB7XG4gICAgICB0aGlzLmJpbmRlcnNbdHlwZV0uX2RlbGltaXRlcnNPbmx5SW5EZWZhdWx0ID0gISFvbmx5SW5EZWZhdWx0O1xuICAgIH1cbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUZXN0cyB3aGV0aGVyIGEgdmFsdWUgaGFzIGFuIGV4cHJlc3Npb24gaW4gaXQuIFNvbWV0aGluZyBsaWtlIGAvdXNlci97e3VzZXIuaWR9fWAuXG4gICAqL1xuICBpc0JvdW5kOiBmdW5jdGlvbih0eXBlLCB2YWx1ZSkge1xuICAgIGlmICh0eXBlICE9PSAnYXR0cmlidXRlJyAmJiB0eXBlICE9PSAndGV4dCcpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2lzQm91bmQgbXVzdCBwcm92aWRlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cbiAgICB2YXIgZXhwciA9IHRoaXMuYmluZGVyc1t0eXBlXS5fZXhwcjtcbiAgICByZXR1cm4gQm9vbGVhbihleHByICYmIHZhbHVlICYmIHZhbHVlLm1hdGNoKGV4cHIpKTtcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBUaGUgc29ydCBmdW5jdGlvbiB0byBzb3J0IGJpbmRlcnMgY29ycmVjdGx5XG4gICAqL1xuICBiaW5kaW5nU29ydDogZnVuY3Rpb24oYSwgYikge1xuICAgIHJldHVybiBiLnByb3RvdHlwZS5wcmlvcml0eSAtIGEucHJvdG90eXBlLnByaW9yaXR5O1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIENvbnZlcnRzIGFuIGludmVydGVkIGV4cHJlc3Npb24gZnJvbSBgL3VzZXIve3t1c2VyLmlkfX1gIHRvIGBcIi91c2VyL1wiICsgdXNlci5pZGBcbiAgICovXG4gIGNvZGlmeUV4cHJlc3Npb246IGZ1bmN0aW9uKHR5cGUsIHRleHQsIG5vdERlZmF1bHQpIHtcbiAgICBpZiAodHlwZSAhPT0gJ2F0dHJpYnV0ZScgJiYgdHlwZSAhPT0gJ3RleHQnKSB7XG4gICAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdjb2RpZnlFeHByZXNzaW9uIG11c3QgdXNlIHR5cGUgXCJhdHRyaWJ1dGVcIiBvciBcInRleHRcIicpO1xuICAgIH1cblxuICAgIGlmIChub3REZWZhdWx0ICYmIHRoaXMuYmluZGVyc1t0eXBlXS5fZGVsaW1pdGVyc09ubHlJbkRlZmF1bHQpIHtcbiAgICAgIHJldHVybiB0ZXh0O1xuICAgIH1cblxuICAgIHZhciBleHByID0gdGhpcy5iaW5kZXJzW3R5cGVdLl9leHByO1xuICAgIHZhciBtYXRjaCA9IHRleHQubWF0Y2goZXhwcik7XG5cbiAgICBpZiAoIW1hdGNoKSB7XG4gICAgICByZXR1cm4gJ1wiJyArIHRleHQucmVwbGFjZSgvXCIvZywgJ1xcXFxcIicpICsgJ1wiJztcbiAgICB9IGVsc2UgaWYgKG1hdGNoLmxlbmd0aCA9PT0gMSAmJiBtYXRjaFswXSA9PT0gdGV4dCkge1xuICAgICAgcmV0dXJuIHRleHQucmVwbGFjZShleHByLCAnJDEnKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIG5ld1RleHQgPSAnXCInLCBsYXN0SW5kZXggPSAwO1xuICAgICAgd2hpbGUgKChtYXRjaCA9IGV4cHIuZXhlYyh0ZXh0KSkpIHtcbiAgICAgICAgdmFyIHN0ciA9IHRleHQuc2xpY2UobGFzdEluZGV4LCBleHByLmxhc3RJbmRleCAtIG1hdGNoWzBdLmxlbmd0aCk7XG4gICAgICAgIG5ld1RleHQgKz0gc3RyLnJlcGxhY2UoL1wiL2csICdcXFxcXCInKTtcbiAgICAgICAgbmV3VGV4dCArPSAnXCIgKyAoJyArIG1hdGNoWzFdICsgJyB8fCBcIlwiKSArIFwiJztcbiAgICAgICAgbGFzdEluZGV4ID0gZXhwci5sYXN0SW5kZXg7XG4gICAgICB9XG4gICAgICBuZXdUZXh0ICs9IHRleHQuc2xpY2UobGFzdEluZGV4KS5yZXBsYWNlKC9cIi9nLCAnXFxcXFwiJykgKyAnXCInO1xuICAgICAgcmV0dXJuIG5ld1RleHQucmVwbGFjZSgvXlwiXCIgXFwrIHwgXCJcIiBcXCsgfCBcXCsgXCJcIiQvZywgJycpO1xuICAgIH1cbiAgfVxuXG59KTtcblxuLy8gVGFrZXMgYSBzdHJpbmcgbGlrZSBcIihcXCopXCIgb3IgXCJvbi1cXCpcIiBhbmQgY29udmVydHMgaXQgaW50byBhIHJlZ3VsYXIgZXhwcmVzc2lvbi5cbmZ1bmN0aW9uIGVzY2FwZVJlZ0V4cCh0ZXh0KSB7XG4gIHJldHVybiB0ZXh0LnJlcGxhY2UoL1stW1xcXXt9KCkqKz8uLFxcXFxeJHwjXFxzXS9nLCAnXFxcXCQmJyk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFRlbXBsYXRlO1xudmFyIFZpZXcgPSByZXF1aXJlKCcuL3ZpZXcnKTtcbnZhciBDbGFzcyA9IHJlcXVpcmUoJ2NoaXAtdXRpbHMvY2xhc3MnKTtcblxuXG4vKipcbiAqICMjIFRlbXBsYXRlXG4gKiBUYWtlcyBhbiBIVE1MIHN0cmluZywgYW4gZWxlbWVudCwgYW4gYXJyYXkgb2YgZWxlbWVudHMsIG9yIGEgZG9jdW1lbnQgZnJhZ21lbnQsIGFuZCBjb21waWxlcyBpdCBpbnRvIGEgdGVtcGxhdGUuXG4gKiBJbnN0YW5jZXMgbWF5IHRoZW4gYmUgY3JlYXRlZCBhbmQgYm91bmQgdG8gYSBnaXZlbiBjb250ZXh0LlxuICogQHBhcmFtIHtTdHJpbmd8Tm9kZUxpc3R8SFRNTENvbGxlY3Rpb258SFRNTFRlbXBsYXRlRWxlbWVudHxIVE1MU2NyaXB0RWxlbWVudHxOb2RlfSBodG1sIEEgVGVtcGxhdGUgY2FuIGJlIGNyZWF0ZWRcbiAqIGZyb20gbWFueSBkaWZmZXJlbnQgdHlwZXMgb2Ygb2JqZWN0cy4gQW55IG9mIHRoZXNlIHdpbGwgYmUgY29udmVydGVkIGludG8gYSBkb2N1bWVudCBmcmFnbWVudCBmb3IgdGhlIHRlbXBsYXRlIHRvXG4gKiBjbG9uZS4gTm9kZXMgYW5kIGVsZW1lbnRzIHBhc3NlZCBpbiB3aWxsIGJlIHJlbW92ZWQgZnJvbSB0aGUgRE9NLlxuICovXG5mdW5jdGlvbiBUZW1wbGF0ZSgpIHtcbiAgdGhpcy5wb29sID0gW107XG59XG5cblxuQ2xhc3MuZXh0ZW5kKFRlbXBsYXRlLCB7XG5cbiAgLyoqXG4gICAqIENyZWF0ZXMgYSBuZXcgdmlldyBjbG9uZWQgZnJvbSB0aGlzIHRlbXBsYXRlLlxuICAgKi9cbiAgY3JlYXRlVmlldzogZnVuY3Rpb24oKSB7XG4gICAgaWYgKHRoaXMucG9vbC5sZW5ndGgpIHtcbiAgICAgIHJldHVybiB0aGlzLnBvb2wucG9wKCk7XG4gICAgfVxuXG4gICAgcmV0dXJuIFZpZXcubWFrZUluc3RhbmNlT2YoZG9jdW1lbnQuaW1wb3J0Tm9kZSh0aGlzLCB0cnVlKSwgdGhpcyk7XG4gIH0sXG5cbiAgcmV0dXJuVmlldzogZnVuY3Rpb24odmlldykge1xuICAgIGlmICh0aGlzLnBvb2wuaW5kZXhPZih2aWV3KSA9PT0gLTEpIHtcbiAgICAgIHRoaXMucG9vbC5wdXNoKHZpZXcpO1xuICAgIH1cbiAgfVxufSk7XG4iLCIvLyBIZWxwZXIgbWV0aG9kcyBmb3IgYW5pbWF0aW9uXG5leHBvcnRzLm1ha2VFbGVtZW50QW5pbWF0YWJsZSA9IG1ha2VFbGVtZW50QW5pbWF0YWJsZTtcbmV4cG9ydHMuZ2V0Q29tcHV0ZWRDU1MgPSBnZXRDb21wdXRlZENTUztcbmV4cG9ydHMuYW5pbWF0ZUVsZW1lbnQgPSBhbmltYXRlRWxlbWVudDtcblxuZnVuY3Rpb24gbWFrZUVsZW1lbnRBbmltYXRhYmxlKGVsZW1lbnQpIHtcbiAgLy8gQWRkIHBvbHlmaWxsIGp1c3Qgb24gdGhpcyBlbGVtZW50XG4gIGlmICghZWxlbWVudC5hbmltYXRlKSB7XG4gICAgZWxlbWVudC5hbmltYXRlID0gYW5pbWF0ZUVsZW1lbnQ7XG4gIH1cblxuICAvLyBOb3QgYSBwb2x5ZmlsbCBidXQgYSBoZWxwZXJcbiAgaWYgKCFlbGVtZW50LmdldENvbXB1dGVkQ1NTKSB7XG4gICAgZWxlbWVudC5nZXRDb21wdXRlZENTUyA9IGdldENvbXB1dGVkQ1NTO1xuICB9XG5cbiAgcmV0dXJuIGVsZW1lbnQ7XG59XG5cbi8qKlxuICogR2V0IHRoZSBjb21wdXRlZCBzdHlsZSBvbiBhbiBlbGVtZW50LlxuICovXG5mdW5jdGlvbiBnZXRDb21wdXRlZENTUyhzdHlsZU5hbWUpIHtcbiAgaWYgKHRoaXMub3duZXJEb2N1bWVudC5kZWZhdWx0Vmlldy5vcGVuZXIpIHtcbiAgICByZXR1cm4gdGhpcy5vd25lckRvY3VtZW50LmRlZmF1bHRWaWV3LmdldENvbXB1dGVkU3R5bGUodGhpcylbc3R5bGVOYW1lXTtcbiAgfVxuICByZXR1cm4gd2luZG93LmdldENvbXB1dGVkU3R5bGUodGhpcylbc3R5bGVOYW1lXTtcbn1cblxuLyoqXG4gKiBWZXJ5IGJhc2ljIHBvbHlmaWxsIGZvciBFbGVtZW50LmFuaW1hdGUgaWYgaXQgZG9lc24ndCBleGlzdC4gSWYgaXQgZG9lcywgdXNlIHRoZSBuYXRpdmUuXG4gKiBUaGlzIG9ubHkgc3VwcG9ydHMgdHdvIGNzcyBzdGF0ZXMuIEl0IHdpbGwgb3ZlcndyaXRlIGV4aXN0aW5nIHN0eWxlcy4gSXQgZG9lc24ndCByZXR1cm4gYW4gYW5pbWF0aW9uIHBsYXkgY29udHJvbC4gSXRcbiAqIG9ubHkgc3VwcG9ydHMgZHVyYXRpb24sIGRlbGF5LCBhbmQgZWFzaW5nLiBSZXR1cm5zIGFuIG9iamVjdCB3aXRoIGEgcHJvcGVydHkgb25maW5pc2guXG4gKi9cbmZ1bmN0aW9uIGFuaW1hdGVFbGVtZW50KGNzcywgb3B0aW9ucykge1xuICBpZiAoIUFycmF5LmlzQXJyYXkoY3NzKSB8fCBjc3MubGVuZ3RoICE9PSAyKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignYW5pbWF0ZSBwb2x5ZmlsbCByZXF1aXJlcyBhbiBhcnJheSBmb3IgY3NzIHdpdGggYW4gaW5pdGlhbCBhbmQgZmluYWwgc3RhdGUnKTtcbiAgfVxuXG4gIGlmICghb3B0aW9ucyB8fCAhb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eSgnZHVyYXRpb24nKSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2FuaW1hdGUgcG9seWZpbGwgcmVxdWlyZXMgb3B0aW9ucyB3aXRoIGEgZHVyYXRpb24nKTtcbiAgfVxuXG4gIHZhciBlbGVtZW50ID0gdGhpcztcbiAgdmFyIGR1cmF0aW9uID0gb3B0aW9ucy5kdXJhdGlvbiB8fCAwO1xuICB2YXIgZGVsYXkgPSBvcHRpb25zLmRlbGF5IHx8IDA7XG4gIHZhciBlYXNpbmcgPSBvcHRpb25zLmVhc2luZztcbiAgdmFyIGluaXRpYWxDc3MgPSBjc3NbMF07XG4gIHZhciBmaW5hbENzcyA9IGNzc1sxXTtcbiAgdmFyIGFsbENzcyA9IHt9O1xuICB2YXIgcGxheWJhY2sgPSB7IG9uZmluaXNoOiBudWxsIH07XG5cbiAgT2JqZWN0LmtleXMoaW5pdGlhbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gaW5pdGlhbENzc1trZXldO1xuICB9KTtcblxuICAvLyB0cmlnZ2VyIHJlZmxvd1xuICBlbGVtZW50Lm9mZnNldFdpZHRoO1xuXG4gIHZhciB0cmFuc2l0aW9uT3B0aW9ucyA9ICcgJyArIGR1cmF0aW9uICsgJ21zJztcbiAgaWYgKGVhc2luZykge1xuICAgIHRyYW5zaXRpb25PcHRpb25zICs9ICcgJyArIGVhc2luZztcbiAgfVxuICBpZiAoZGVsYXkpIHtcbiAgICB0cmFuc2l0aW9uT3B0aW9ucyArPSAnICcgKyBkZWxheSArICdtcyc7XG4gIH1cblxuICBlbGVtZW50LnN0eWxlLnRyYW5zaXRpb24gPSBPYmplY3Qua2V5cyhmaW5hbENzcykubWFwKGZ1bmN0aW9uKGtleSkge1xuICAgIHJldHVybiBrZXkgKyB0cmFuc2l0aW9uT3B0aW9ucztcbiAgfSkuam9pbignLCAnKTtcblxuICBPYmplY3Qua2V5cyhmaW5hbENzcykuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICBhbGxDc3Nba2V5XSA9IHRydWU7XG4gICAgZWxlbWVudC5zdHlsZVtrZXldID0gZmluYWxDc3Nba2V5XTtcbiAgfSk7XG5cbiAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICBPYmplY3Qua2V5cyhhbGxDc3MpLmZvckVhY2goZnVuY3Rpb24oa2V5KSB7XG4gICAgICBlbGVtZW50LnN0eWxlW2tleV0gPSAnJztcbiAgICB9KTtcblxuICAgIGlmIChwbGF5YmFjay5vbmZpbmlzaCkge1xuICAgICAgcGxheWJhY2sub25maW5pc2goKTtcbiAgICB9XG4gIH0sIGR1cmF0aW9uICsgZGVsYXkpO1xuXG4gIHJldHVybiBwbGF5YmFjaztcbn1cbiIsIlxuXG5cbi8vIFBvbHlmaWxsIG1hdGNoZXNcbmlmICghRWxlbWVudC5wcm90b3R5cGUubWF0Y2hlcykge1xuICBFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzID1cbiAgICBFbGVtZW50LnByb3RvdHlwZS5tYXRjaGVzU2VsZWN0b3IgfHxcbiAgICBFbGVtZW50LnByb3RvdHlwZS53ZWJraXRNYXRjaGVzU2VsZWN0b3IgfHxcbiAgICBFbGVtZW50LnByb3RvdHlwZS5tb3pNYXRjaGVzU2VsZWN0b3IgfHxcbiAgICBFbGVtZW50LnByb3RvdHlwZS5tc01hdGNoZXNTZWxlY3RvciB8fFxuICAgIEVsZW1lbnQucHJvdG90eXBlLm9NYXRjaGVzU2VsZWN0b3I7XG59XG5cbi8vIFBvbHlmaWxsIGNsb3Nlc3RcbmlmICghRWxlbWVudC5wcm90b3R5cGUuY2xvc2VzdCkge1xuICBFbGVtZW50LnByb3RvdHlwZS5jbG9zZXN0ID0gZnVuY3Rpb24gY2xvc2VzdChzZWxlY3Rvcikge1xuICAgIHZhciBlbGVtZW50ID0gdGhpcztcbiAgICBkbyB7XG4gICAgICBpZiAoZWxlbWVudC5tYXRjaGVzKHNlbGVjdG9yKSkge1xuICAgICAgICByZXR1cm4gZWxlbWVudDtcbiAgICAgIH1cbiAgICB9IHdoaWxlICgoZWxlbWVudCA9IGVsZW1lbnQucGFyZW50Tm9kZSkgJiYgZWxlbWVudC5ub2RlVHlwZSA9PT0gTm9kZS5FTEVNRU5UX05PREUpO1xuICAgIHJldHVybiBudWxsO1xuICB9O1xufVxuIiwibW9kdWxlLmV4cG9ydHMgPSB0b0ZyYWdtZW50O1xuXG4vLyBDb252ZXJ0IHN0dWZmIGludG8gZG9jdW1lbnQgZnJhZ21lbnRzLiBTdHVmZiBjYW4gYmU6XG4vLyAqIEEgc3RyaW5nIG9mIEhUTUwgdGV4dFxuLy8gKiBBbiBlbGVtZW50IG9yIHRleHQgbm9kZVxuLy8gKiBBIE5vZGVMaXN0IG9yIEhUTUxDb2xsZWN0aW9uIChlLmcuIGBlbGVtZW50LmNoaWxkTm9kZXNgIG9yIGBlbGVtZW50LmNoaWxkcmVuYClcbi8vICogQSBqUXVlcnkgb2JqZWN0XG4vLyAqIEEgc2NyaXB0IGVsZW1lbnQgd2l0aCBhIGB0eXBlYCBhdHRyaWJ1dGUgb2YgYFwidGV4dC8qXCJgIChlLmcuIGA8c2NyaXB0IHR5cGU9XCJ0ZXh0L2h0bWxcIj5NeSB0ZW1wbGF0ZSBjb2RlITwvc2NyaXB0PmApXG4vLyAqIEEgdGVtcGxhdGUgZWxlbWVudCAoZS5nLiBgPHRlbXBsYXRlPk15IHRlbXBsYXRlIGNvZGUhPC90ZW1wbGF0ZT5gKVxuZnVuY3Rpb24gdG9GcmFnbWVudChodG1sKSB7XG4gIGlmIChodG1sIGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICAgIHJldHVybiBodG1sO1xuICB9IGVsc2UgaWYgKHR5cGVvZiBodG1sID09PSAnc3RyaW5nJykge1xuICAgIHJldHVybiBzdHJpbmdUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2UgaWYgKGh0bWwgaW5zdGFuY2VvZiBOb2RlKSB7XG4gICAgcmV0dXJuIG5vZGVUb0ZyYWdtZW50KGh0bWwpO1xuICB9IGVsc2UgaWYgKCdsZW5ndGgnIGluIGh0bWwpIHtcbiAgICByZXR1cm4gbGlzdFRvRnJhZ21lbnQoaHRtbCk7XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5zdXBwb3J0ZWQgVGVtcGxhdGUgVHlwZTogQ2Fubm90IGNvbnZlcnQgYCcgKyBodG1sICsgJ2AgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LicpO1xuICB9XG59XG5cbi8vIENvbnZlcnRzIGFuIEhUTUwgbm9kZSBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuIElmIGl0IGlzIGEgPHRlbXBsYXRlPiBub2RlIGl0cyBjb250ZW50cyB3aWxsIGJlIHVzZWQuIElmIGl0IGlzIGFcbi8vIDxzY3JpcHQ+IG5vZGUgaXRzIHN0cmluZy1iYXNlZCBjb250ZW50cyB3aWxsIGJlIGNvbnZlcnRlZCB0byBIVE1MIGZpcnN0LCB0aGVuIHVzZWQuIE90aGVyd2lzZSBhIGNsb25lIG9mIHRoZSBub2RlXG4vLyBpdHNlbGYgd2lsbCBiZSB1c2VkLlxuZnVuY3Rpb24gbm9kZVRvRnJhZ21lbnQobm9kZSkge1xuICBpZiAobm9kZS5jb250ZW50IGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICAgIHJldHVybiBub2RlLmNvbnRlbnQ7XG4gIH0gZWxzZSBpZiAobm9kZS50YWdOYW1lID09PSAnU0NSSVBUJykge1xuICAgIHJldHVybiBzdHJpbmdUb0ZyYWdtZW50KG5vZGUuaW5uZXJIVE1MKTtcbiAgfSBlbHNlIHtcbiAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgaWYgKG5vZGUudGFnTmFtZSA9PT0gJ1RFTVBMQVRFJykge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBub2RlLmNoaWxkTm9kZXMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5vZGUuY2hpbGROb2Rlc1tpXSk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKG5vZGUpO1xuICAgIH1cbiAgICByZXR1cm4gZnJhZ21lbnQ7XG4gIH1cbn1cblxuLy8gQ29udmVydHMgYW4gSFRNTENvbGxlY3Rpb24sIE5vZGVMaXN0LCBqUXVlcnkgb2JqZWN0LCBvciBhcnJheSBpbnRvIGEgZG9jdW1lbnQgZnJhZ21lbnQuXG5mdW5jdGlvbiBsaXN0VG9GcmFnbWVudChsaXN0KSB7XG4gIHZhciBmcmFnbWVudCA9IGRvY3VtZW50LmNyZWF0ZURvY3VtZW50RnJhZ21lbnQoKTtcbiAgZm9yICh2YXIgaSA9IDAsIGwgPSBsaXN0Lmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgIC8vIFVzZSB0b0ZyYWdtZW50IHNpbmNlIHRoaXMgbWF5IGJlIGFuIGFycmF5IG9mIHRleHQsIGEgalF1ZXJ5IG9iamVjdCBvZiBgPHRlbXBsYXRlPmBzLCBldGMuXG4gICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQodG9GcmFnbWVudChsaXN0W2ldKSk7XG4gICAgaWYgKGwgPT09IGxpc3QubGVuZ3RoICsgMSkge1xuICAgICAgLy8gYWRqdXN0IGZvciBOb2RlTGlzdHMgd2hpY2ggYXJlIGxpdmUsIHRoZXkgc2hyaW5rIGFzIHdlIHB1bGwgbm9kZXMgb3V0IG9mIHRoZSBET01cbiAgICAgIGktLTtcbiAgICAgIGwtLTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZyYWdtZW50O1xufVxuXG4vLyBDb252ZXJ0cyBhIHN0cmluZyBvZiBIVE1MIHRleHQgaW50byBhIGRvY3VtZW50IGZyYWdtZW50LlxudmFyIHN0cmluZ1RvRnJhZ21lbnQgPSBmdW5jdGlvbihzdHJpbmcpIHtcbiAgaWYgKCFzdHJpbmcpIHtcbiAgICB2YXIgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZG9jdW1lbnQuY3JlYXRlVGV4dE5vZGUoJycpKTtcbiAgICByZXR1cm4gZnJhZ21lbnQ7XG4gIH1cbiAgdmFyIHRlbXBsYXRlRWxlbWVudDtcbiAgdGVtcGxhdGVFbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKTtcbiAgdGVtcGxhdGVFbGVtZW50LmlubmVySFRNTCA9IHN0cmluZztcbiAgcmV0dXJuIHRlbXBsYXRlRWxlbWVudC5jb250ZW50O1xufTtcblxuLy8gSWYgSFRNTCBUZW1wbGF0ZXMgYXJlIG5vdCBhdmFpbGFibGUgKGUuZy4gaW4gSUUpIHRoZW4gdXNlIGFuIG9sZGVyIG1ldGhvZCB0byB3b3JrIHdpdGggY2VydGFpbiBlbGVtZW50cy5cbmlmICghZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgndGVtcGxhdGUnKS5jb250ZW50IGluc3RhbmNlb2YgRG9jdW1lbnRGcmFnbWVudCkge1xuICBzdHJpbmdUb0ZyYWdtZW50ID0gKGZ1bmN0aW9uKCkge1xuICAgIHZhciB0YWdFeHAgPSAvPChbXFx3Oi1dKykvO1xuXG4gICAgLy8gQ29waWVkIGZyb20galF1ZXJ5IChodHRwczovL2dpdGh1Yi5jb20vanF1ZXJ5L2pxdWVyeS9ibG9iL21hc3Rlci9MSUNFTlNFLnR4dClcbiAgICB2YXIgd3JhcE1hcCA9IHtcbiAgICAgIG9wdGlvbjogWyAxLCAnPHNlbGVjdCBtdWx0aXBsZT1cIm11bHRpcGxlXCI+JywgJzwvc2VsZWN0PicgXSxcbiAgICAgIGxlZ2VuZDogWyAxLCAnPGZpZWxkc2V0PicsICc8L2ZpZWxkc2V0PicgXSxcbiAgICAgIHRoZWFkOiBbIDEsICc8dGFibGU+JywgJzwvdGFibGU+JyBdLFxuICAgICAgdHI6IFsgMiwgJzx0YWJsZT48dGJvZHk+JywgJzwvdGJvZHk+PC90YWJsZT4nIF0sXG4gICAgICB0ZDogWyAzLCAnPHRhYmxlPjx0Ym9keT48dHI+JywgJzwvdHI+PC90Ym9keT48L3RhYmxlPicgXSxcbiAgICAgIGNvbDogWyAyLCAnPHRhYmxlPjx0Ym9keT48L3Rib2R5Pjxjb2xncm91cD4nLCAnPC9jb2xncm91cD48L3RhYmxlPicgXSxcbiAgICAgIGFyZWE6IFsgMSwgJzxtYXA+JywgJzwvbWFwPicgXSxcbiAgICAgIF9kZWZhdWx0OiBbIDAsICcnLCAnJyBdXG4gICAgfTtcbiAgICB3cmFwTWFwLm9wdGdyb3VwID0gd3JhcE1hcC5vcHRpb247XG4gICAgd3JhcE1hcC50Ym9keSA9IHdyYXBNYXAudGZvb3QgPSB3cmFwTWFwLmNvbGdyb3VwID0gd3JhcE1hcC5jYXB0aW9uID0gd3JhcE1hcC50aGVhZDtcbiAgICB3cmFwTWFwLnRoID0gd3JhcE1hcC50ZDtcblxuICAgIHJldHVybiBmdW5jdGlvbiBzdHJpbmdUb0ZyYWdtZW50KHN0cmluZykge1xuICAgICAgdmFyIGZyYWdtZW50O1xuICAgICAgaWYgKCFzdHJpbmcpIHtcbiAgICAgICAgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICAgIGZyYWdtZW50LmFwcGVuZENoaWxkKGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKCcnKSk7XG4gICAgICAgIHJldHVybiBmcmFnbWVudDtcbiAgICAgIH1cbiAgICAgIHZhciB0YWcgPSBzdHJpbmcubWF0Y2godGFnRXhwKTtcbiAgICAgIHZhciBwYXJ0cyA9IHdyYXBNYXBbdGFnXSB8fCB3cmFwTWFwLl9kZWZhdWx0O1xuICAgICAgdmFyIGRlcHRoID0gcGFydHNbMF07XG4gICAgICB2YXIgcHJlZml4ID0gcGFydHNbMV07XG4gICAgICB2YXIgcG9zdGZpeCA9IHBhcnRzWzJdO1xuICAgICAgdmFyIGRpdiA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2RpdicpO1xuICAgICAgZGl2LmlubmVySFRNTCA9IHByZWZpeCArIHN0cmluZyArIHBvc3RmaXg7XG4gICAgICB3aGlsZSAoZGVwdGgtLSkge1xuICAgICAgICBkaXYgPSBkaXYubGFzdENoaWxkO1xuICAgICAgfVxuICAgICAgZnJhZ21lbnQgPSBkb2N1bWVudC5jcmVhdGVEb2N1bWVudEZyYWdtZW50KCk7XG4gICAgICB3aGlsZSAoZGl2LmZpcnN0Q2hpbGQpIHtcbiAgICAgICAgZnJhZ21lbnQuYXBwZW5kQ2hpbGQoZGl2LmZpcnN0Q2hpbGQpO1xuICAgICAgfVxuICAgICAgcmV0dXJuIGZyYWdtZW50O1xuICAgIH07XG4gIH0pKCk7XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFZpZXc7XG52YXIgQ2xhc3MgPSByZXF1aXJlKCdjaGlwLXV0aWxzL2NsYXNzJyk7XG5cblxuLyoqXG4gKiAjIyBWaWV3XG4gKiBBIERvY3VtZW50RnJhZ21lbnQgd2l0aCBiaW5kaW5ncy5cbiAqL1xuZnVuY3Rpb24gVmlldyh0ZW1wbGF0ZSkge1xuICBpZiAodGVtcGxhdGUpIHtcbiAgICB0aGlzLnRlbXBsYXRlID0gdGVtcGxhdGU7XG4gICAgdGhpcy5iaW5kaW5ncyA9IHRoaXMudGVtcGxhdGUuYmluZGluZ3MubWFwKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICAgIHJldHVybiBiaW5kaW5nLmNsb25lRm9yVmlldyh0aGlzKTtcbiAgICB9LCB0aGlzKTtcbiAgfSBlbHNlIGlmICh0aGlzLmJpbmRpbmdzKSB7XG4gICAgdGhpcy5iaW5kaW5ncy5mb3JFYWNoKGZ1bmN0aW9uKGJpbmRpbmcpIHtcbiAgICAgIGJpbmRpbmcuaW5pdCgpO1xuICAgIH0pO1xuICB9XG5cbiAgdGhpcy5maXJzdFZpZXdOb2RlID0gdGhpcy5maXJzdENoaWxkO1xuICB0aGlzLmxhc3RWaWV3Tm9kZSA9IHRoaXMubGFzdENoaWxkO1xuICBpZiAodGhpcy5maXJzdFZpZXdOb2RlKSB7XG4gICAgdGhpcy5maXJzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICAgIHRoaXMubGFzdFZpZXdOb2RlLnZpZXcgPSB0aGlzO1xuICB9XG59XG5cblxuQ2xhc3MuZXh0ZW5kKFZpZXcsIHtcblxuICAvKipcbiAgICogUmVtb3ZlcyBhIHZpZXcgZnJvbSB0aGUgRE9NLiBBIHZpZXcgaXMgYSBEb2N1bWVudEZyYWdtZW50LCBzbyBgcmVtb3ZlKClgIHJldHVybnMgYWxsIGl0cyBub2RlcyB0byBpdHNlbGYuXG4gICAqL1xuICByZW1vdmU6IGZ1bmN0aW9uKCkge1xuICAgIHZhciBub2RlID0gdGhpcy5maXJzdFZpZXdOb2RlO1xuICAgIHZhciBuZXh0O1xuXG4gICAgaWYgKG5vZGUucGFyZW50Tm9kZSAhPT0gdGhpcykge1xuICAgICAgLy8gUmVtb3ZlIGFsbCB0aGUgbm9kZXMgYW5kIHB1dCB0aGVtIGJhY2sgaW50byB0aGlzIGZyYWdtZW50XG4gICAgICB3aGlsZSAobm9kZSkge1xuICAgICAgICBuZXh0ID0gKG5vZGUgPT09IHRoaXMubGFzdFZpZXdOb2RlKSA/IG51bGwgOiBub2RlLm5leHRTaWJsaW5nO1xuICAgICAgICB0aGlzLmFwcGVuZENoaWxkKG5vZGUpO1xuICAgICAgICBub2RlID0gbmV4dDtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgdmlldyAoaWYgbm90IGFscmVhZHkgcmVtb3ZlZCkgYW5kIGFkZHMgdGhlIHZpZXcgdG8gaXRzIHRlbXBsYXRlJ3MgcG9vbC5cbiAgICovXG4gIGRpc3Bvc2U6IGZ1bmN0aW9uKCkge1xuICAgIC8vIE1ha2Ugc3VyZSB0aGUgdmlldyBpcyByZW1vdmVkIGZyb20gdGhlIERPTVxuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLmRpc3Bvc2UoKTtcbiAgICB9KTtcblxuICAgIHRoaXMucmVtb3ZlKCk7XG4gICAgaWYgKHRoaXMudGVtcGxhdGUpIHtcbiAgICAgIHRoaXMudGVtcGxhdGUucmV0dXJuVmlldyh0aGlzKTtcbiAgICB9XG4gIH0sXG5cblxuICAvKipcbiAgICogQmluZHMgYSB2aWV3IHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAgICovXG4gIGJpbmQ6IGZ1bmN0aW9uKGNvbnRleHQpIHtcbiAgICB0aGlzLmJpbmRpbmdzLmZvckVhY2goZnVuY3Rpb24oYmluZGluZykge1xuICAgICAgYmluZGluZy5iaW5kKGNvbnRleHQpO1xuICAgIH0pO1xuICB9LFxuXG5cbiAgLyoqXG4gICAqIFVuYmluZHMgYSB2aWV3IGZyb20gYW55IGNvbnRleHQuXG4gICAqL1xuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuYmluZGluZ3MuZm9yRWFjaChmdW5jdGlvbihiaW5kaW5nKSB7XG4gICAgICBiaW5kaW5nLnVuYmluZCgpO1xuICAgIH0pO1xuICB9XG59KTtcbiIsIlxuZXhwb3J0cy5PYnNlcnZhdGlvbnMgPSByZXF1aXJlKCcuL3NyYy9vYnNlcnZhdGlvbnMnKTtcbmV4cG9ydHMuT2JzZXJ2ZXIgPSByZXF1aXJlKCcuL3NyYy9vYnNlcnZlcicpO1xuZXhwb3J0cy5jcmVhdGUgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBleHBvcnRzLk9ic2VydmF0aW9ucygpO1xufTtcbiIsIm1vZHVsZS5leHBvcnRzID0gT2JzZXJ2YXRpb25zO1xudmFyIENsYXNzID0gcmVxdWlyZSgnY2hpcC11dGlscy9jbGFzcycpO1xudmFyIE9ic2VydmVyID0gcmVxdWlyZSgnLi9vYnNlcnZlcicpO1xudmFyIHJlcXVlc3RBbmltYXRpb25GcmFtZSA9IGdsb2JhbC5yZXF1ZXN0QW5pbWF0aW9uRnJhbWUgfHwgc2V0VGltZW91dDtcbnZhciBjYW5jZWxBbmltYXRpb25GcmFtZSA9IGdsb2JhbC5jYW5jZWxBbmltYXRpb25GcmFtZSB8fCBjbGVhclRpbWVvdXQ7XG5cblxuZnVuY3Rpb24gT2JzZXJ2YXRpb25zKCkge1xuICB0aGlzLmdsb2JhbHMgPSB7fTtcbiAgdGhpcy5mb3JtYXR0ZXJzID0ge307XG4gIHRoaXMub2JzZXJ2ZXJzID0gW107XG4gIHRoaXMuY2FsbGJhY2tzID0gW107XG4gIHRoaXMubGlzdGVuZXJzID0gW107XG4gIHRoaXMuc3luY2luZyA9IGZhbHNlO1xuICB0aGlzLmNhbGxiYWNrc1J1bm5pbmcgPSBmYWxzZTtcbiAgdGhpcy5yZXJ1biA9IGZhbHNlO1xuICB0aGlzLmN5Y2xlcyA9IDA7XG4gIHRoaXMubWF4Q3ljbGVzID0gMTA7XG4gIHRoaXMudGltZW91dCA9IG51bGw7XG4gIHRoaXMucGVuZGluZ1N5bmMgPSBudWxsO1xuICB0aGlzLnN5bmNOb3cgPSB0aGlzLnN5bmNOb3cuYmluZCh0aGlzKTtcbn1cblxuXG5DbGFzcy5leHRlbmQoT2JzZXJ2YXRpb25zLCB7XG5cbiAgLy8gQ3JlYXRlcyBhIG5ldyBvYnNlcnZlciBhdHRhY2hlZCB0byB0aGlzIG9ic2VydmF0aW9ucyBvYmplY3QuIFdoZW4gdGhlIG9ic2VydmVyIGlzIGJvdW5kIHRvIGEgY29udGV4dCBpdCB3aWxsIGJlIGFkZGVkXG4gIC8vIHRvIHRoaXMgYG9ic2VydmF0aW9uc2AgYW5kIHN5bmNlZCB3aGVuIHRoaXMgYG9ic2VydmF0aW9ucy5zeW5jYCBpcyBjYWxsZWQuXG4gIGNyZWF0ZU9ic2VydmVyOiBmdW5jdGlvbihleHByLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KSB7XG4gICAgcmV0dXJuIG5ldyBPYnNlcnZlcih0aGlzLCBleHByLCBjYWxsYmFjaywgY2FsbGJhY2tDb250ZXh0KTtcbiAgfSxcblxuXG4gIC8vIFNjaGVkdWxlcyBhbiBvYnNlcnZlciBzeW5jIGN5Y2xlIHdoaWNoIGNoZWNrcyBhbGwgdGhlIG9ic2VydmVycyB0byBzZWUgaWYgdGhleSd2ZSBjaGFuZ2VkLlxuICBzeW5jOiBmdW5jdGlvbihjYWxsYmFjaykge1xuICAgIGlmICh0eXBlb2YgY2FsbGJhY2sgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRoaXMuYWZ0ZXJTeW5jKGNhbGxiYWNrKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5wZW5kaW5nU3luYykge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIHRoaXMucGVuZGluZ1N5bmMgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUodGhpcy5zeW5jTm93KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSxcblxuXG4gIC8vIFJ1bnMgdGhlIG9ic2VydmVyIHN5bmMgY3ljbGUgd2hpY2ggY2hlY2tzIGFsbCB0aGUgb2JzZXJ2ZXJzIHRvIHNlZSBpZiB0aGV5J3ZlIGNoYW5nZWQuXG4gIHN5bmNOb3c6IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhpcy5hZnRlclN5bmMoY2FsbGJhY2spO1xuICAgIH1cblxuICAgIGNhbmNlbEFuaW1hdGlvbkZyYW1lKHRoaXMucGVuZGluZ1N5bmMpO1xuICAgIHRoaXMucGVuZGluZ1N5bmMgPSBudWxsO1xuXG4gICAgaWYgKHRoaXMuc3luY2luZykge1xuICAgICAgdGhpcy5yZXJ1biA9IHRydWU7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgdGhpcy5ydW5TeW5jKCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0sXG5cblxuICBydW5TeW5jOiBmdW5jdGlvbigpIHtcbiAgICB0aGlzLnN5bmNpbmcgPSB0cnVlO1xuICAgIHRoaXMucmVydW4gPSB0cnVlO1xuICAgIHRoaXMuY3ljbGVzID0gMDtcblxuICAgIHZhciBpLCBsO1xuXG4gICAgLy8gQWxsb3cgY2FsbGJhY2tzIHRvIHJ1biB0aGUgc3luYyBjeWNsZSBhZ2FpbiBpbW1lZGlhdGVseSwgYnV0IHN0b3AgYXQgYG1heEN5bGVzYCAoZGVmYXVsdCAxMCkgY3ljbGVzIHNvIHdlIGRvbid0XG4gICAgLy8gcnVuIGluZmluaXRlIGxvb3BzXG4gICAgd2hpbGUgKHRoaXMucmVydW4pIHtcbiAgICAgIGlmICgrK3RoaXMuY3ljbGVzID09PSB0aGlzLm1heEN5Y2xlcykge1xuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoJ0luZmluaXRlIG9ic2VydmVyIHN5bmNpbmcsIGFuIG9ic2VydmVyIGlzIGNhbGxpbmcgT2JzZXJ2ZXIuc3luYygpIHRvbyBtYW55IHRpbWVzJyk7XG4gICAgICB9XG4gICAgICB0aGlzLnJlcnVuID0gZmFsc2U7XG4gICAgICAvLyB0aGUgb2JzZXJ2ZXIgYXJyYXkgbWF5IGluY3JlYXNlIG9yIGRlY3JlYXNlIGluIHNpemUgKHJlbWFpbmluZyBvYnNlcnZlcnMpIGR1cmluZyB0aGUgc3luY1xuICAgICAgZm9yIChpID0gMDsgaSA8IHRoaXMub2JzZXJ2ZXJzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHRoaXMub2JzZXJ2ZXJzW2ldLnN5bmMoKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICB0aGlzLmNhbGxiYWNrc1J1bm5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGNhbGxiYWNrcyA9IHRoaXMuY2FsbGJhY2tzO1xuICAgIHRoaXMuY2FsbGJhY2tzID0gW107XG4gICAgd2hpbGUgKGNhbGxiYWNrcy5sZW5ndGgpIHtcbiAgICAgIGNhbGxiYWNrcy5zaGlmdCgpKCk7XG4gICAgfVxuXG4gICAgZm9yIChpID0gMCwgbCA9IHRoaXMubGlzdGVuZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgdmFyIGxpc3RlbmVyID0gdGhpcy5saXN0ZW5lcnNbaV07XG4gICAgICBsaXN0ZW5lcigpO1xuICAgIH1cblxuICAgIHRoaXMuY2FsbGJhY2tzUnVubmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc3luY2luZyA9IGZhbHNlO1xuICAgIHRoaXMuY3ljbGVzID0gMDtcbiAgfSxcblxuXG4gIC8vIEFmdGVyIHRoZSBuZXh0IHN5bmMgKG9yIHRoZSBjdXJyZW50IGlmIGluIHRoZSBtaWRkbGUgb2Ygb25lKSwgcnVuIHRoZSBwcm92aWRlZCBjYWxsYmFja1xuICBhZnRlclN5bmM6IGZ1bmN0aW9uKGNhbGxiYWNrKSB7XG4gICAgaWYgKHR5cGVvZiBjYWxsYmFjayAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignY2FsbGJhY2sgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY2FsbGJhY2tzUnVubmluZykge1xuICAgICAgdGhpcy5zeW5jKCk7XG4gICAgfVxuXG4gICAgdGhpcy5jYWxsYmFja3MucHVzaChjYWxsYmFjayk7XG4gIH0sXG5cblxuICBvblN5bmM6IGZ1bmN0aW9uKGxpc3RlbmVyKSB7XG4gICAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJykge1xuICAgICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdGVuZXIgbXVzdCBiZSBhIGZ1bmN0aW9uJyk7XG4gICAgfVxuXG4gICAgdGhpcy5saXN0ZW5lcnMucHVzaChsaXN0ZW5lcik7XG4gIH0sXG5cblxuICBvZmZTeW5jOiBmdW5jdGlvbihsaXN0ZW5lcikge1xuICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuICAgIH1cblxuICAgIHZhciBpbmRleCA9IHRoaXMubGlzdGVuZXJzLmluZGV4T2YobGlzdGVuZXIpO1xuICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgIHRoaXMubGlzdGVuZXJzLnNwbGljZShpbmRleCwgMSkucG9wKCk7XG4gICAgfVxuICB9LFxuXG5cbiAgLy8gQWRkcyBhIG5ldyBvYnNlcnZlciB0byBiZSBzeW5jZWQgd2l0aCBjaGFuZ2VzLiBJZiBgc2tpcFVwZGF0ZWAgaXMgdHJ1ZSB0aGVuIHRoZSBjYWxsYmFjayB3aWxsIG9ubHkgYmUgY2FsbGVkIHdoZW4gYVxuICAvLyBjaGFuZ2UgaXMgbWFkZSwgbm90IGluaXRpYWxseS5cbiAgYWRkOiBmdW5jdGlvbihvYnNlcnZlciwgc2tpcFVwZGF0ZSkge1xuICAgIHRoaXMub2JzZXJ2ZXJzLnB1c2gob2JzZXJ2ZXIpO1xuICAgIGlmICghc2tpcFVwZGF0ZSkge1xuICAgICAgb2JzZXJ2ZXIuZm9yY2VVcGRhdGVOZXh0U3luYyA9IHRydWU7XG4gICAgICBvYnNlcnZlci5zeW5jKCk7XG4gICAgfVxuICB9LFxuXG5cbiAgLy8gUmVtb3ZlcyBhbiBvYnNlcnZlciwgc3RvcHBpbmcgaXQgZnJvbSBiZWluZyBydW5cbiAgcmVtb3ZlOiBmdW5jdGlvbihvYnNlcnZlcikge1xuICAgIHZhciBpbmRleCA9IHRoaXMub2JzZXJ2ZXJzLmluZGV4T2Yob2JzZXJ2ZXIpO1xuICAgIGlmIChpbmRleCAhPT0gLTEpIHtcbiAgICAgIHRoaXMub2JzZXJ2ZXJzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfSxcbn0pO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBPYnNlcnZlcjtcbnZhciBDbGFzcyA9IHJlcXVpcmUoJ2NoaXAtdXRpbHMvY2xhc3MnKTtcbnZhciBleHByZXNzaW9ucyA9IHJlcXVpcmUoJ2V4cHJlc3Npb25zLWpzJyk7XG52YXIgZGlmZiA9IHJlcXVpcmUoJ2RpZmZlcmVuY2VzLWpzJyk7XG5cbi8vICMgT2JzZXJ2ZXJcblxuLy8gRGVmaW5lcyBhbiBvYnNlcnZlciBjbGFzcyB3aGljaCByZXByZXNlbnRzIGFuIGV4cHJlc3Npb24uIFdoZW5ldmVyIHRoYXQgZXhwcmVzc2lvbiByZXR1cm5zIGEgbmV3IHZhbHVlIHRoZSBgY2FsbGJhY2tgXG4vLyBpcyBjYWxsZWQgd2l0aCB0aGUgdmFsdWUuXG4vL1xuLy8gSWYgdGhlIG9sZCBhbmQgbmV3IHZhbHVlcyB3ZXJlIGVpdGhlciBhbiBhcnJheSBvciBhbiBvYmplY3QsIHRoZSBgY2FsbGJhY2tgIGFsc29cbi8vIHJlY2VpdmVzIGFuIGFycmF5IG9mIHNwbGljZXMgKGZvciBhbiBhcnJheSksIG9yIGFuIGFycmF5IG9mIGNoYW5nZSBvYmplY3RzIChmb3IgYW4gb2JqZWN0KSB3aGljaCBhcmUgdGhlIHNhbWVcbi8vIGZvcm1hdCB0aGF0IGBBcnJheS5vYnNlcnZlYCBhbmQgYE9iamVjdC5vYnNlcnZlYCByZXR1cm5cbi8vIDxodHRwczovL2RldmVsb3Blci5tb3ppbGxhLm9yZy9lbi1VUy9kb2NzL1dlYi9KYXZhU2NyaXB0L1JlZmVyZW5jZS9HbG9iYWxfT2JqZWN0cy9PYmplY3Qvb2JzZXJ2ZT4uXG5mdW5jdGlvbiBPYnNlcnZlcihvYnNlcnZhdGlvbnMsIGV4cHIsIGNhbGxiYWNrLCBjYWxsYmFja0NvbnRleHQpIHtcbiAgaWYgKHR5cGVvZiBleHByID09PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhpcy5nZXR0ZXIgPSBleHByO1xuICAgIHRoaXMuc2V0dGVyID0gZXhwcjtcbiAgfSBlbHNlIHtcbiAgICB0aGlzLmdldHRlciA9IGV4cHJlc3Npb25zLnBhcnNlKGV4cHIsIG9ic2VydmF0aW9ucy5nbG9iYWxzLCBvYnNlcnZhdGlvbnMuZm9ybWF0dGVycyk7XG4gIH1cbiAgdGhpcy5vYnNlcnZhdGlvbnMgPSBvYnNlcnZhdGlvbnM7XG4gIHRoaXMuZXhwciA9IGV4cHI7XG4gIHRoaXMuY2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgdGhpcy5jYWxsYmFja0NvbnRleHQgPSBjYWxsYmFja0NvbnRleHQ7XG4gIHRoaXMuc2tpcCA9IGZhbHNlO1xuICB0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMgPSBmYWxzZTtcbiAgdGhpcy5jb250ZXh0ID0gbnVsbDtcbiAgdGhpcy5vbGRWYWx1ZSA9IHVuZGVmaW5lZDtcbn1cblxuQ2xhc3MuZXh0ZW5kKE9ic2VydmVyLCB7XG5cbiAgLy8gQmluZHMgdGhpcyBleHByZXNzaW9uIHRvIGEgZ2l2ZW4gY29udGV4dFxuICBiaW5kOiBmdW5jdGlvbihjb250ZXh0LCBza2lwVXBkYXRlKSB7XG4gICAgdGhpcy5jb250ZXh0ID0gY29udGV4dDtcbiAgICBpZiAodGhpcy5jYWxsYmFjaykge1xuICAgICAgdGhpcy5vYnNlcnZhdGlvbnMuYWRkKHRoaXMsIHNraXBVcGRhdGUpO1xuICAgIH1cbiAgfSxcblxuICAvLyBVbmJpbmRzIHRoaXMgZXhwcmVzc2lvblxuICB1bmJpbmQ6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMub2JzZXJ2YXRpb25zLnJlbW92ZSh0aGlzKTtcbiAgICB0aGlzLmNvbnRleHQgPSBudWxsO1xuICB9LFxuXG4gIC8vIENsb3NlcyB0aGUgb2JzZXJ2ZXIsIGNsZWFuaW5nIHVwIGFueSBwb3NzaWJsZSBtZW1vcnktbGVha3NcbiAgY2xvc2U6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMudW5iaW5kKCk7XG4gICAgdGhpcy5jYWxsYmFjayA9IG51bGw7XG4gICAgdGhpcy5jYWxsYmFja0NvbnRleHQgPSBudWxsO1xuICB9LFxuXG4gIC8vIFJldHVybnMgdGhlIGN1cnJlbnQgdmFsdWUgb2YgdGhpcyBvYnNlcnZlclxuICBnZXQ6IGZ1bmN0aW9uKCkge1xuICAgIGlmICh0aGlzLmNvbnRleHQpIHtcbiAgICAgIHJldHVybiB0aGlzLmdldHRlci5jYWxsKHRoaXMuY29udGV4dCk7XG4gICAgfVxuICB9LFxuXG4gIC8vIFNldHMgdGhlIHZhbHVlIG9mIHRoaXMgZXhwcmVzc2lvblxuICBzZXQ6IGZ1bmN0aW9uKHZhbHVlKSB7XG4gICAgaWYgKCF0aGlzLmNvbnRleHQpIHJldHVybjtcbiAgICBpZiAodGhpcy5zZXR0ZXIgPT09IGZhbHNlKSByZXR1cm47XG4gICAgaWYgKCF0aGlzLnNldHRlcikge1xuICAgICAgdHJ5IHtcbiAgICAgICAgdGhpcy5zZXR0ZXIgPSB0eXBlb2YgdGhpcy5leHByID09PSAnc3RyaW5nJ1xuICAgICAgICAgID8gZXhwcmVzc2lvbnMucGFyc2VTZXR0ZXIodGhpcy5leHByLCB0aGlzLm9ic2VydmF0aW9ucy5nbG9iYWxzLCB0aGlzLm9ic2VydmF0aW9ucy5mb3JtYXR0ZXJzKVxuICAgICAgICAgIDogZmFsc2U7XG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHRoaXMuc2V0dGVyID0gZmFsc2U7XG4gICAgICB9XG4gICAgICBpZiAoIXRoaXMuc2V0dGVyKSByZXR1cm47XG4gICAgfVxuXG4gICAgdHJ5IHtcbiAgICAgIHZhciByZXN1bHQgPSB0aGlzLnNldHRlci5jYWxsKHRoaXMuY29udGV4dCwgdmFsdWUpO1xuICAgIH0gY2F0Y2goZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGNhbid0IGV4cGVjdCBjb2RlIGluIGZyYWdtZW50cyBvdXRzaWRlIE9ic2VydmVyIHRvIGJlIGF3YXJlIG9mIFwic3luY1wiIHNpbmNlIG9ic2VydmVyIGNhbiBiZSByZXBsYWNlZCBieSBvdGhlclxuICAgIC8vIHR5cGVzIChlLmcuIG9uZSB3aXRob3V0IGEgYHN5bmMoKWAgbWV0aG9kLCBzdWNoIGFzIG9uZSB0aGF0IHVzZXMgYE9iamVjdC5vYnNlcnZlYCkgaW4gb3RoZXIgc3lzdGVtcy5cbiAgICB0aGlzLnN5bmMoKTtcbiAgICB0aGlzLm9ic2VydmF0aW9ucy5zeW5jKCk7XG4gICAgcmV0dXJuIHJlc3VsdDtcbiAgfSxcblxuXG4gIC8vIEluc3RydWN0cyB0aGlzIG9ic2VydmVyIHRvIG5vdCBjYWxsIGl0cyBgY2FsbGJhY2tgIG9uIHRoZSBuZXh0IHN5bmMsIHdoZXRoZXIgdGhlIHZhbHVlIGhhcyBjaGFuZ2VkIG9yIG5vdFxuICBza2lwTmV4dFN5bmM6IGZ1bmN0aW9uKCkge1xuICAgIHRoaXMuc2tpcCA9IHRydWU7XG4gIH0sXG5cblxuICAvLyBTeW5jcyB0aGlzIG9ic2VydmVyIG5vdywgY2FsbGluZyB0aGUgY2FsbGJhY2sgaW1tZWRpYXRlbHkgaWYgdGhlcmUgaGF2ZSBiZWVuIGNoYW5nZXNcbiAgc3luYzogZnVuY3Rpb24oKSB7XG4gICAgdmFyIHZhbHVlID0gdGhpcy5nZXQoKTtcblxuICAgIC8vIERvbid0IGNhbGwgdGhlIGNhbGxiYWNrIGlmIGBza2lwTmV4dFN5bmNgIHdhcyBjYWxsZWQgb24gdGhlIG9ic2VydmVyXG4gICAgaWYgKHRoaXMuc2tpcCB8fCAhdGhpcy5jYWxsYmFjaykge1xuICAgICAgdGhpcy5za2lwID0gZmFsc2U7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIElmIGFuIGFycmF5IGhhcyBjaGFuZ2VkIGNhbGN1bGF0ZSB0aGUgc3BsaWNlcyBhbmQgY2FsbCB0aGUgY2FsbGJhY2suIFRoaXNcbiAgICAgIHZhciBjaGFuZ2VkID0gZGlmZi52YWx1ZXModmFsdWUsIHRoaXMub2xkVmFsdWUpO1xuICAgICAgaWYgKCFjaGFuZ2VkICYmICF0aGlzLmZvcmNlVXBkYXRlTmV4dFN5bmMpIHJldHVybjtcbiAgICAgIHRoaXMuZm9yY2VVcGRhdGVOZXh0U3luYyA9IGZhbHNlO1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoY2hhbmdlZCkpIHtcbiAgICAgICAgdGhpcy5jYWxsYmFjay5jYWxsKHRoaXMuY2FsbGJhY2tDb250ZXh0LCB2YWx1ZSwgdGhpcy5vbGRWYWx1ZSwgY2hhbmdlZCk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmNhbGxiYWNrLmNhbGwodGhpcy5jYWxsYmFja0NvbnRleHQsIHZhbHVlLCB0aGlzLm9sZFZhbHVlKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAodGhpcy5nZXRDaGFuZ2VSZWNvcmRzKSB7XG4gICAgICAvLyBTdG9yZSBhbiBpbW11dGFibGUgdmVyc2lvbiBvZiB0aGUgdmFsdWUsIGFsbG93aW5nIGZvciBhcnJheXMgYW5kIG9iamVjdHMgdG8gY2hhbmdlIGluc3RhbmNlIGJ1dCBub3QgY29udGVudCBhbmRcbiAgICAgIC8vIHN0aWxsIHJlZnJhaW4gZnJvbSBkaXNwYXRjaGluZyBjYWxsYmFja3MgKGUuZy4gd2hlbiB1c2luZyBhbiBvYmplY3QgaW4gYmluZC1jbGFzcyBvciB3aGVuIHVzaW5nIGFycmF5IGZvcm1hdHRlcnNcbiAgICAgIC8vIGluIGJpbmQtZWFjaClcbiAgICAgIHRoaXMub2xkVmFsdWUgPSBkaWZmLmNsb25lKHZhbHVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5vbGRWYWx1ZSA9IHZhbHVlO1xuICAgIH1cbiAgfVxufSk7XG4iXX0=
