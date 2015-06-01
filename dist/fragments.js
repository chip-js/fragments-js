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
    element.setAttribute(this.name, value);
  } else {
    element.removeAttribute(this.name);
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
  binder.name = name;

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
function findBinder(name) {
  var binding = getBinder(name);

  if (!binding) {
    wildcards.some(function(binder) {
      if (binding = binder.expr.test(name)) {
        return true;
      }
    });
  }

  if (!binding && isBound(value)) {
    // Test if the attribute value is bound (e.g. `href="/posts/{{ post.id }}"`)
    binding = getBinder('{{attribute}}');
  }

  return binding;
}

// Creates a binding
function createBinding(binder, options) {
  binderMethods.forEach(function(key) {
    if (binder[key]) {
      options[key] = binder[key];
    }
  });
  if (binder.compiled) binder.compiled.call(options);
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
  return boundExpr.test(text);
}

function binderSort(a, b) {
  return b.priority - a.priority;
}

},{"./binding":2}],2:[function(require,module,exports){
module.exports = Binding;
var Observer = require('./observer');


function Binding(options, isTemplate) {
  if (!options.element || !options.view) {
    throw new TypeError('A binding must receive an element and a view');
  }

  // The element (or text node) this binding is bound to
  this.element = options.element;

  // The view this binding belongs to
  this.view = options.view;

  // The path from the view to the element, used on cloning (it is an array of node indexes)
  this.elementPath = options.elementPath || initNodePath(this.element, this.view);

  // The attribute or element name
  this.name = options.name;

  // The matched part of the name for wildcard attributes (e.g. `on-*` matching against `on-click` would have a match of
  // `click`). Use `this.camelCase` to get the match camelCased.
  this.match = options.match;

  // The expression this binding will use for its updates
  this.expression = options.expression;

  // The function to run when the element is created
  this.created = options.created;

  // The function to run when the expression's value changes
  this.updated = options.updated;

  // The function to run when the element is inserted into the DOM
  this.attached = options.attached;

  // The function to run when the element is removed from the DOM
  this.detached = options.detached;

  // The context the exression operates within
  this.context = null;

  // A template which this binding may use to stamp out views
  this.template = options.template;

  if (this.expression) {
    // An observer to observe value changes to the expression within a context
    this.observer = new Observer(this.expression, this.updated ? this.updated.bind(this) : null);
  }

  if (this.created && !isTemplate) this.created();
}

Binding.prototype = {
  get camelCase() {
    return (this.match || this.name || '').replace(/-+(\w)/g, function(_, char) {
      return char.toUpperCase();
    });
  },

  bind: function(context) {
    this.context = context;
    if (this.observer) this.observer.bind(context);
    if (this.attached) this.attached();
  },

  unbind: function() {
    this.context = null;
    if (this.observer) this.observer.ubind();
    if (this.detached) this.detached();
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

},{"./observer":8}],3:[function(require,module,exports){
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

},{}],4:[function(require,module,exports){
var addReferences, addThis, argSeparator, chainLink, chainLinks, continuation, currentIndex, currentReference, emptyQuoteExpr, expression, finishedChain, getFunctionCall, ignore, initParse, nextChain, parens, parseChain, parseExpr, parseFilters, parseFunction, parsePart, parsePropertyChains, pipeExpr, propExpr, pullOutStrings, putInStrings, quoteExpr, referenceCount, setterExpr, splitLinks, strings,
  slice = [].slice;

expression = exports;

expression.cache = {};

expression.globals = ['true', 'false', 'null', 'undefined', 'window', 'this'];

expression.get = function(expr, options) {
  var args, body, cacheKey, e, func;
  if (options == null) {
    options = {};
  }
  if (!options.args) {
    options.args = [];
  }
  args = options.args;
  cacheKey = expr + '|' + args.join(',');
  func = expression.cache[cacheKey];
  if (func) {
    return func;
  }
  args.unshift('_formatters_');
  body = expression.parse(expr, options);
  try {
    func = expression.cache[cacheKey] = Function.apply(null, slice.call(args).concat([body]));
  } catch (_error) {
    e = _error;
    if (console) {
      console.error('Bad expression:\n`' + expr + '`\n' + 'Compiled expression:\n' + body);
    }
    throw new Error(e.message);
  }
  return func;
};

expression.getSetter = function(expr, options) {
  if (options == null) {
    options = {};
  }
  options.args = ['value'];
  expr = expr.replace(/(\s*\||$)/, ' = value$1');
  return expression.get(expr, options);
};

expression.bind = function(expr, scope, options) {
  return expression.get(expr, options).bind(scope);
};

quoteExpr = /(['"\/])(\\\1|[^\1])*?\1/g;

emptyQuoteExpr = /(['"\/])\1/g;

pipeExpr = /\|(\|)?/g;

argSeparator = /\s*:\s*/g;

propExpr = /((\{|,|\.)?\s*)([a-z$_\$](?:[a-z_\$0-9\.-]|\[['"\d]+\])*)(\s*(:|\(|\[)?)/gi;

chainLinks = /\.|\[/g;

chainLink = /\.|\[|\(/;

setterExpr = /\s=\s/;

ignore = null;

strings = [];

referenceCount = 0;

currentReference = 0;

currentIndex = 0;

finishedChain = false;

continuation = false;

expression.parse = function(expr, options) {
  initParse(expr, options);
  expr = pullOutStrings(expr);
  expr = parseFilters(expr);
  expr = parseExpr(expr);
  expr = 'return ' + expr;
  expr = putInStrings(expr);
  expr = addReferences(expr);
  return expr;
};

initParse = function(expr, options) {
  referenceCount = currentReference = 0;
  ignore = expression.globals.concat((options != null ? options.globals : void 0) || [], (options != null ? options.args : void 0) || []);
  return strings.length = 0;
};

pullOutStrings = function(expr) {
  var javascript;
  return javascript = expr.replace(quoteExpr, function(str, quote) {
    strings.push(str);
    return quote + quote;
  });
};

putInStrings = function(expr) {
  return expr = expr.replace(emptyQuoteExpr, function() {
    return strings.shift();
  });
};

addReferences = function(expr) {
  var i, j, ref1, refs;
  if (referenceCount) {
    refs = [];
    for (i = j = 1, ref1 = referenceCount; 1 <= ref1 ? j <= ref1 : j >= ref1; i = 1 <= ref1 ? ++j : --j) {
      refs.push('_ref' + i);
    }
    expr = 'var ' + refs.join(', ') + ';\n' + expr;
  }
  return expr;
};

parseFilters = function(expr) {
  var filters, ref1, setter, value;
  expr = expr.replace(pipeExpr, function(match, orIndicator) {
    if (orIndicator) {
      return match;
    }
    return '@@@';
  });
  filters = expr.split(/\s*@@@\s*/);
  expr = filters.shift();
  if (!filters.length) {
    return expr;
  }
  if (setterExpr.test(expr)) {
    ref1 = expr.split(setterExpr), setter = ref1[0], value = ref1[1];
    setter += ' = ';
  } else {
    setter = '';
    value = expr;
  }
  filters.forEach(function(filter) {
    var args, filterName;
    args = filter.split(argSeparator);
    filterName = args.shift();
    args.unshift(value);
    if (setter) {
      args.push(true);
    }
    return value = "_formatters_." + filterName + ".call(this, " + (args.join(', ')) + ")";
  });
  return setter + value;
};

parseExpr = function(expr) {
  var negate, ref1, setter, value;
  if (setterExpr.test(expr)) {
    ref1 = expr.split(' = '), setter = ref1[0], value = ref1[1];
    negate = '';
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
};

parsePropertyChains = function(expr) {
  var javascript, js, previousIndexes;
  javascript = '';
  previousIndexes = [currentIndex, propExpr.lastIndex];
  currentIndex = 0;
  propExpr.lastIndex = 0;
  while ((js = nextChain(expr)) !== false) {
    javascript += js;
  }
  propExpr.lastIndex = previousIndexes.pop();
  currentIndex = previousIndexes.pop();
  return javascript;
};

nextChain = function(expr) {
  var colonOrParen, match, objIndicator, postfix, prefix, propChain, ref1, skipped;
  if (finishedChain) {
    return (finishedChain = false);
  }
  match = propExpr.exec(expr);
  if (!match) {
    finishedChain = true;
    return expr.slice(currentIndex);
  }
  ref1 = match, match = ref1[0], prefix = ref1[1], objIndicator = ref1[2], propChain = ref1[3], postfix = ref1[4], colonOrParen = ref1[5];
  skipped = expr.slice(currentIndex, propExpr.lastIndex - match.length);
  currentIndex = propExpr.lastIndex;
  if (objIndicator && colonOrParen === ':') {
    return skipped + match;
  }
  return skipped + parseChain(prefix, propChain, postfix, colonOrParen, expr);
};

splitLinks = function(chain) {
  var index, match, parts;
  index = 0;
  parts = [];
  while ((match = chainLinks.exec(chain))) {
    if (chainLinks.lastIndex === 1) {
      continue;
    }
    parts.push(chain.slice(index, chainLinks.lastIndex - 1));
    index = chainLinks.lastIndex - 1;
  }
  parts.push(chain.slice(index));
  return parts;
};

addThis = function(chain) {
  if (ignore.indexOf(chain.split(chainLink).shift()) === -1) {
    return "this." + chain;
  } else {
    return chain;
  }
};

parseChain = function(prefix, propChain, postfix, paren, expr) {
  var link, links, newChain;
  continuation = prefix === '.';
  if (continuation) {
    propChain = '.' + propChain;
    prefix = '';
  }
  links = splitLinks(propChain);
  newChain = '';
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
          newChain += "_ref" + currentReference + link + ")";
        } else {
          postfix = postfix.replace(paren, '');
          newChain += parseFunction(link, index, expr);
        }
      }
    });
  }
  return prefix + newChain + postfix;
};

parens = {
  '(': ')',
  '[': ']'
};

parseFunction = function(link, index, expr) {
  var call, insideParens, ref;
  call = getFunctionCall(expr);
  link += call.slice(0, 1) + '~~insideParens~~' + call.slice(-1);
  insideParens = call.slice(1, -1);
  if (expr.charAt(propExpr.lastIndex) === '.') {
    link = parsePart(link, index);
  } else if (index === 0) {
    link = parsePart(link, index);
    link += "_ref" + currentReference + ")";
  } else {
    link = "_ref" + currentReference + link + ")";
  }
  ref = currentReference;
  link = link.replace('~~insideParens~~', parsePropertyChains(insideParens));
  currentReference = ref;
  return link;
};

getFunctionCall = function(expr) {
  var close, endIndex, open, parenCount, startIndex;
  startIndex = propExpr.lastIndex;
  open = expr.charAt(startIndex - 1);
  close = parens[open];
  endIndex = startIndex - 1;
  parenCount = 1;
  while (endIndex++ < expr.length) {
    switch (expr.charAt(endIndex)) {
      case open:
        parenCount++;
        break;
      case close:
        parenCount--;
    }
    if (parenCount === 0) {
      break;
    }
  }
  currentIndex = propExpr.lastIndex = endIndex + 1;
  return open + expr.slice(startIndex, endIndex) + close;
};

parsePart = function(part, index) {
  var ref;
  if (index === 0 && !continuation) {
    if (ignore.indexOf(part.split(/\.|\(|\[/).shift()) === -1) {
      part = "this." + part;
    } else {
      part = "" + part;
    }
  } else {
    part = "_ref" + currentReference + part;
  }
  currentReference = ++referenceCount;
  ref = "_ref" + currentReference;
  return "(" + ref + " = " + part + ") == null ? undefined : ";
};


},{}],5:[function(require,module,exports){
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

},{}],6:[function(require,module,exports){
Formatter = require('./formatter');

// # Default Formatters

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
// <div>Check out <a href="https://github.com/teamsnap/chip" target="_blank">https://github.com/teamsnap/chip</a>!</div>
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
// <div><p>Check out <a href="https://github.com/teamsnap/chip" target="_blank">https://github.com/teamsnap/chip</a>!</p>
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
// <div>Check out <a href="https://github.com/teamsnap/chip" target="_blank">https://github.com/teamsnap/chip</a>!<br>
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
// <div><p>Check out <a href="https://github.com/teamsnap/chip" target="_blank">https://github.com/teamsnap/chip</a>!<br>
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
// <div>Check out <a href="https://github.com/teamsnap/chip" target="_blank">https://github.com/teamsnap/chip</a>!</div>
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

},{"./formatter":5}],7:[function(require,module,exports){
var Template = require('./template');
var Binder = require('./binder');
var Binding = require('./binding');
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
      var expr = codifyExpression(node.nodeValue);
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
      var binder = Binder.find(attr.name);
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
        expression: codifyExpression(value),
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


// Splits text nodes with expressions in them so they can be bound individually
function splitTextNode(node) {
  if (!node.processed) {
    node.processed = true;
    var content = node.nodeValue;
    if (boundExpr.test(content)) {
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
  return binding;
}

// A regex for determining whether some text has an expression in it
var boundExpr = /{{(.*?)}}/g;

// Tests whether some text has an expression in it. Something like `/user/{{user.id}}`.
function isBound(text) {
  return boundExpr.test(text);
}

// Reverts an inverted expression from `/user/{{user.id}}` to `"/user/" + user.id`
function codifyExpression(text) {
  text = '"' + text.replace(boundExpr, function(match, text) {
    return '" + (' + text + ') + "';
  }) + '"';
  return text.replace(/^"" \+ | "" \+ | \+ ""$/g, '');
}

function sortAttributes(a, b) {
  return b.binder.priority - a.binder.priority;
}

function notEmpty(value) {
  return !!value;
}

},{"./binder":1,"./binding":2,"./template":9}],8:[function(require,module,exports){
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
function Observer(expr, callback) {
  this.getter = expression.get(expr);
  if (!/['"']$/.test(expr)) {
    this.setter = expression.getSetter(expr);
  }
  this.callback = callback;
  this.skip = false;
  this.context = null;
  this.oldValue = undefined;
}

Observer.prototype = {

  // Binds this expression to a given context
  bind: function(context, skipUpdate) {
    this.context = context;
    Observer.add(this, skipUpdate);
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
        this.callback(value, this.oldValue, changed)
      } else {
        this.callback(value, this.oldValue);
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

},{"./diff":3,"./expression":4,"./formatter":5}],9:[function(require,module,exports){
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
  var node = fragment = toFragment(html);
  if (fragment.childNodes.length === 1) {
    node = fragment.removeChild(fragment.firstChild);
  } else if (fragment.childNodes.length === 0) {
    throw new Error('Cannot create a template from ' + html);
  }

  Object.keys(exports.templateMethods).forEach(function(key) {
    node[key] = exports.templateMethods[key];
  });

  node.pool = [];
  runHooks('compile', node);

  return node;
}


function templateCreateView() {
  return this.pool.pop() || createView(this.cloneNode(true), this);
}


function createView(node, template) {
  if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
    node.firstViewNode = node.firstChild;
    node.lastViewNode = node.lastChild;
  } else if (node instanceof Node) {
    node.firstViewNode = node.lastViewNode = node;
  } else {
    throw new TypeError('A view must be created from an HTML Node');
  }

  Object.keys(exports.viewMethods).forEach(function(key) {
    node[key] = exports.viewMethods[key];
  });

  node.template = template;

  runHooks('view', node);

  return node;
}


function removeView() {
  if (this.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) {
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

  } else {

    if (this.parentNode) {
      // Remove this node
      this.parentNode.removeChild(this);
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

},{"./toFragment":10}],10:[function(require,module,exports){
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

},{}],11:[function(require,module,exports){
exports.Observer = require('./src/observer');
exports.diff = require('./src/diff');
exports.Template = require('./src/template');
exports.expression = require('./src/expression');
exports.Binding = require('./src/binding');
exports.Binder = require('./src/binder');
exports.Formatter = require('./src/formatter');
exports.formatters = require('./src/formatters');
require('./src/initBinding');

},{"./src/binder":1,"./src/binding":2,"./src/diff":3,"./src/expression":4,"./src/formatter":5,"./src/formatters":6,"./src/initBinding":7,"./src/observer":8,"./src/template":9}]},{},[11])(11)
});